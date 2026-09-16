#!/usr/bin/env node
/**
 * seed-staging.mjs — deterministic, re-runnable test data for the STAGING project.
 *
 *   node scripts/seed-staging.mjs --dry-run     # print the plan, touch nothing
 *   node scripts/seed-staging.mjs               # seed (converges; safe to re-run)
 *   node scripts/seed-staging.mjs --reset       # delete seeded rows, then seed
 *
 * Requires STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY.
 *
 * This file is TRANSPORT ONLY. The fixtures, their key shapes, their
 * deterministic ids and the pre-flight validation live in
 * scripts/lib/staging-fixtures.mjs, so the rules can be tested without a project.
 *
 * SAFETY
 *   • scripts/lib/staging-guard.mjs runs FIRST and hard-refuses the production
 *     project ref, an unparseable URL, or a missing URL. Deny by default.
 *   • A pre-flight check refuses to write if the target holds any practice whose
 *     name does not end in "(TEST)", or any fixture-shaped row that is not ours.
 *     The seeder checks this itself because it writes on the path where the
 *     initialization workflow skips DDL entirely.
 *   • Every row carries a deterministic id derived from SEED_NAMESPACE, so a
 *     re-run UPDATES the same rows. Every DELETE is filtered by fixture id or
 *     fixture practice_id; there is no unscoped DELETE anywhere in this file.
 *   • Auth users are matched by their @roxium.test address. No other account is
 *     created, updated or deleted, and ensureUser refuses a non-.test address
 *     even if one somehow reaches it.
 *   • No production data is read, copied or referenced. See docs/STAGING_DATA.md.
 *
 * Zero dependencies: talks to PostgREST and the Auth admin API over fetch.
 */
import { assertStagingTarget } from './lib/staging-guard.mjs';
import {
  plan, validatePlan, expectedCounts, naturalKeyOf, uid, PRACTICES, USERS,
} from './lib/staging-fixtures.mjs';

const ARGS = new Set(process.argv.slice(2));
const DRY = ARGS.has('--dry-run');
const RESET = ARGS.has('--reset');

const URL_ = process.env.STAGING_SUPABASE_URL || '';
const KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '';

// Fixture accounts get a password so the authorization walkthrough can actually
// sign in. It comes from STAGING_FIXTURE_PASSWORD — a secret, never a literal
// here — and is only ever applied to @roxium.test addresses on a project the
// guard has already proven is not production. Supabase Auth hashes it; we never
// store or log it.
const FIXTURE_PASSWORD = process.env.STAGING_FIXTURE_PASSWORD || '';

const authHeaders = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { ...authHeaders(), ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.status === 204 ? null : res.json().catch(() => null);
}

/**
 * The PGRST102 guard, applied to EVERY bulk write — including profiles and
 * memberships, which are assembled at run time from auth ids and so never pass
 * through validatePlan. PostgREST rejects a bulk insert whose objects do not all
 * carry an identical key set, and its error names neither the table nor the row.
 */
function assertOneShape(table, rows) {
  const shapes = new Map();
  for (const [i, r] of rows.entries()) {
    const k = Object.keys(r).sort().join(',');
    if (!shapes.has(k)) shapes.set(k, i);
  }
  if (shapes.size > 1) {
    const [[a, ai], [b, bi]] = [...shapes.entries()];
    const diff = [...new Set([...a.split(','), ...b.split(',')])]
      .filter((k) => !a.split(',').includes(k) || !b.split(',').includes(k));
    throw new Error(
      `${table}: ${shapes.size} different key shapes in one bulk insert — PostgREST ` +
      `would reject this with PGRST102 ("All object keys must match"). Rows [${ai}] and ` +
      `[${bi}] differ on: ${diff.join(', ')}.`,
    );
  }
}

/** Upsert one batch. `conflict` targets a natural unique key where one exists. */
async function upsert({ table, rows, conflict }) {
  if (!rows.length) return 0;
  assertOneShape(table, rows);
  const path = conflict ? `${table}?on_conflict=${encodeURIComponent(conflict)}` : table;
  await rest(path, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates' });
  return rows.length;
}

/**
 * Clear rows that collide with a fixture under an EXPRESSION unique index while
 * carrying a different primary key.
 *
 * Postgres will not accept an ON CONFLICT target that is not backed by a real
 * index, and a column list never matches lower(btrim(col)) — so these tables
 * cannot upsert on their natural key and must upsert on the primary key instead.
 * A leftover row written by an older, random-id seeder therefore collides on the
 * unique index with a 23505 that re-running can never clear. This removes
 * exactly those rows: matched by the index's own normalization, and only where
 * the id is not already the deterministic fixture id. Nothing else is touched.
 */
async function sweepNaturalKey({ table, rows, naturalKey }, scopeValues) {
  if (!naturalKey || !rows.length) return 0;
  const wanted = new Map(rows.map((r) => [naturalKeyOf(r, naturalKey), r.id]));
  const cols = [...new Set(['id', ...naturalKey.columns])].join(',');
  const filter = naturalKey.scope ? `&${naturalKey.scope}=in.(${scopeValues.join(',')})` : '';
  const existing = (await rest(`${table}?select=${cols}${filter}`)) || [];

  const stale = existing.filter((row) => {
    const k = naturalKeyOf(row, naturalKey);
    return wanted.has(k) && wanted.get(k) !== row.id;
  });
  if (!stale.length) return 0;

  // For practices this is reachable only under --reset: without it,
  // assertOnlyFixtures has already refused a practice it does not recognise, so
  // no same-named row with a different id can survive to here. Under --reset the
  // operator has typed the confirmation phrase, and a delete here cascades to
  // that practice's rows — which is why it is logged rather than done quietly.
  await rest(`${table}?id=in.(${stale.map((r) => r.id).join(',')})`, { method: 'DELETE' });
  console.log(`  swept ${stale.length} stale ${table} row(s) colliding on ${naturalKey.index}` +
    (table === 'practices' ? ' (cascades to their rows)' : ''));
  return stale.length;
}

/**
 * Every fixture auth user, fetched ONCE and paged to the end.
 *
 * The previous version re-listed for each user and read only the first 200
 * accounts: on a project with more users than that it would miss an existing
 * fixture, try to create it again, and die on the duplicate-email error. A
 * lookup that can silently miss is not a lookup.
 */
async function loadFixtureUsers() {
  const wanted = new Set(USERS.map((u) => u.email.toLowerCase()));
  const found = new Map();
  let scanned = 0;
  for (let page = 1; page <= 100; page++) {
    const res = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=1000`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`could not list auth users: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const users = (await res.json().catch(() => ({}))).users || [];
    scanned += users.length;
    for (const u of users) {
      const email = String(u.email || '').toLowerCase();
      if (wanted.has(email)) found.set(email, u.id);   // only our fixtures are ever recorded
    }
    if (users.length < 1000) return { found, scanned };
  }
  throw new Error('auth user listing did not terminate after 100 pages — refusing to guess');
}

/**
 * Converge one fixture account. Create when absent, update when present; the
 * user id — and so every membership and profile that references it — is
 * preserved across runs. Only @roxium.test addresses ever reach this function,
 * and the check is repeated here rather than trusted from the caller.
 */
async function ensureUser(u, existing) {
  if (!u.email.toLowerCase().endsWith('@roxium.test')) {
    throw new Error(`refusing to touch a non-fixture account: ${u.email}`);
  }
  const id = existing.get(u.email.toLowerCase());
  const meta = { full_name: u.name, seeded: true };

  if (id) {
    const patch = { email_confirm: true, user_metadata: meta };
    if (FIXTURE_PASSWORD) patch.password = FIXTURE_PASSWORD;
    const res = await fetch(`${URL_}/auth/v1/admin/users/${id}`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`could not update ${u.email}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return { id, created: false };
  }

  const body = { email: u.email, email_confirm: true, user_metadata: meta };
  if (FIXTURE_PASSWORD) body.password = FIXTURE_PASSWORD;
  const res = await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const created = await res.json().catch(() => ({}));
  if (!res.ok || !created.id) {
    throw new Error(`could not create ${u.email}: ${res.status} ${JSON.stringify(created).slice(0, 200)}`);
  }
  return { id: created.id, created: true };
}

/**
 * Refuse to write if the target holds data that is not ours.
 *
 * Two separate questions: is every practice a synthetic "(TEST)" fixture, and
 * does every fixture-named practice carry the deterministic id this seeder would
 * write? A "(TEST)" practice under an unexpected id means something else created
 * it, and merging our rows into it is not a safe assumption to make silently.
 */
async function assertOnlyFixtures(fixturePractices) {
  const rows = (await rest('practices?select=id,name')) || [];
  const foreign = rows.filter((r) => !String(r.name || '').endsWith('(TEST)'));
  if (foreign.length) {
    throw new Error(
      `target holds ${foreign.length} practice(s) that are not synthetic fixtures ` +
      `(e.g. "${foreign[0].name}"). Refusing to seed — this does not look like staging.`,
    );
  }
  const known = new Set(fixturePractices.map((p) => p.id));
  const unknown = rows.filter((r) => !known.has(r.id));
  return { total: rows.length, unknown };
}

/** Compare the target against expectedCounts(). A seed that cannot be verified did not succeed. */
async function verify(inList, userIds) {
  const expected = expectedCounts();
  const scoped = {
    practices: `practices?select=id&id=in.${inList}`,
    deliverables: `deliverables?select=id&practice_id=in.${inList}`,
    milestones: `milestones?select=id&practice_id=in.${inList}`,
    video_pipeline: `video_pipeline?select=id&practice_id=in.${inList}`,
    kpi_monthly: `kpi_monthly?select=id&practice_id=in.${inList}`,
    platform_connections: `platform_connections?select=id&practice_id=in.${inList}`,
    activity: `activity?select=id&practice_id=in.${inList}`,
    practice_invites: `practice_invites?select=id&practice_id=in.${inList}`,
    profiles: `profiles?select=id&id=in.(${userIds.join(',')})`,
    memberships: `memberships?select=id&practice_id=in.${inList}`,
  };

  // Re-listed, not inferred from what this run did: counting "found + created"
  // would always equal the fixture count and so could never fail.
  const actual = { auth_users: (await loadFixtureUsers()).found.size };
  for (const [name, path] of Object.entries(scoped)) actual[name] = ((await rest(path)) || []).length;

  const wrong = Object.entries(expected).filter(([k, n]) => actual[k] !== n);
  console.log('\nVerifying fixture state:');
  for (const [k, n] of Object.entries(expected)) {
    console.log(`  ${actual[k] === n ? 'ok  ' : 'FAIL'} ${String(actual[k]).padStart(4)} / ${String(n).padEnd(4)} ${k}`);
  }
  if (wrong.length) {
    throw new Error(
      'the seed did not converge to the expected fixture state:\n  - ' +
      wrong.map(([k, n]) => `${k}: expected ${n}, found ${actual[k]}`).join('\n  - '),
    );
  }
}

async function main() {
  console.log(`ROXIUM staging seed  (${DRY ? 'DRY RUN' : RESET ? 'RESET + SEED' : 'SEED'})\n`);

  // 1 ── validate the fixtures before anything leaves this machine. The
  //      PGRST102 failure that motivated this file reached staging because
  //      nothing checked the payload until PostgREST did.
  const p = validatePlan(plan());
  console.log('Fixture plan (validated):');
  for (const pr of PRACTICES) console.log(`  practice  ${pr.name.padEnd(42)} covers scenarios ${pr.covers.join(', ')}`);
  console.log('');
  for (const [k, n] of Object.entries(expectedCounts())) console.log(`  ${String(n).padStart(4)}  ${k}`);

  // 2 ── target guard.
  if (DRY && !URL_) {
    console.log('\nNo STAGING_SUPABASE_URL set — plan printed and validated, nothing contacted.');
    return;
  }
  const ref = assertStagingTarget(URL_);
  console.log(`\nTarget project: ${ref}  (verified NOT production)`);
  if (!KEY) throw new Error('STAGING_SUPABASE_SERVICE_ROLE_KEY is not set.');
  if (DRY) { console.log('\nDRY RUN — nothing was written.'); return; }

  const fixtureIds = PRACTICES.map((pr) => uid(`practice:${pr.key}`));
  const inList = `(${fixtureIds.join(',')})`;

  // 3 ── refuse a target that holds anything that is not ours.
  console.log('\nPre-flight:');
  const { total, unknown } = await assertOnlyFixtures(p.batches.find((b) => b.table === 'practices').rows);
  if (unknown.length && !RESET) {
    throw new Error(
      `target holds ${unknown.length} "(TEST)" practice(s) this seeder did not create ` +
      `(e.g. "${unknown[0].name}" / ${unknown[0].id}). Refusing to seed around unrecognised data. ` +
      'Re-run with --reset once you have confirmed the target is disposable.',
    );
  }
  console.log(`  ok  ${total} existing practice(s), all synthetic fixtures`);

  if (RESET) {
    console.log('\nResetting seeded rows (scoped to the fixture practice ids only)…');
    // Every one of these carries practice_id, so each delete is scoped and a
    // failure is a real failure. Nothing here is allowed to be swallowed: a
    // reset that quietly deletes nothing and reports success is worse than one
    // that stops.
    for (const t of ['activity', 'notifications', 'video_history', 'video_pipeline', 'deliverables',
                     'milestones', 'kpi_daily', 'kpi_monthly', 'platform_connections', 'sheet_sources',
                     'memberships', 'practice_invites']) {
      await rest(`${t}?practice_id=in.${inList}`, { method: 'DELETE' });
    }
    // profiles.practice_id is a plain REFERENCES with no ON DELETE action, so a
    // profile still pointing at a fixture practice REFUSES the delete below with
    // 23503. Detach rather than delete: the profile belongs to an Auth user, not
    // to the practice, and the seed re-attaches it a few lines later. This
    // mirrors what delete_practice() does in schema.sql.
    await rest(`profiles?practice_id=in.${inList}`, { method: 'PATCH', body: { practice_id: null } });
    await rest(`practices?id=in.${inList}`, { method: 'DELETE' });
    console.log('  reset complete.');
  }

  // 4 ── data. One key shape per batch and a stable id on every row, so a second
  //      run updates in place rather than inserting duplicates or colliding.
  console.log('\nSeeding…');
  for (const batch of p.batches) {
    await sweepNaturalKey(batch, fixtureIds);
    const n = await upsert(batch);
    if (n) console.log(`  ${String(n).padStart(4)}  ${batch.table}${batch.conflict ? `  (on_conflict=${batch.conflict})` : ''}`);
  }

  // 5 ── auth users, their profiles and their memberships.
  console.log('\nAuth users + access:');
  const { found: existing, scanned } = await loadFixtureUsers();
  console.log(`  scanned ${scanned} account(s); ${existing.size} of ${USERS.length} fixtures already present`);

  const profiles = [];
  const memberships = [];
  const userIds = [];
  let made = 0;
  for (const u of USERS) {
    const { id, created } = await ensureUser(u, existing);
    if (created) made++;
    userIds.push(id);
    const practice_id = u.practice ? uid(`practice:${u.practice}`) : null;
    profiles.push({ id, full_name: u.name, role: u.role, practice_id,
      approval_status: u.key === 'pending' ? 'pending' : u.key === 'revoked' ? 'rejected' : 'approved' });
    // No id: memberships resolve on their (user_id, practice_id) unique index,
    // which is a real column index, and memberships.user_id cascades when an
    // auth user is deleted — so there is nothing stale to collide with.
    if (u.membership && practice_id) memberships.push({ user_id: id, practice_id, role: u.membership });
    console.log(`  ${u.email.padEnd(38)} ${u.role}${u.membership ? ' / ' + u.membership : ''}` +
      `${created ? '  (created)' : '  (existing)'}` +
      `${u.key === 'pending' ? '  pending approval' : ''}${u.key === 'revoked' ? '  revoked' : ''}`);
  }
  console.log(`  ${made} created, ${USERS.length - made} reused`);

  await upsert({ table: 'profiles', rows: profiles, conflict: null });
  await upsert({ table: 'memberships', rows: memberships, conflict: 'user_id,practice_id' });

  // 6 ── prove it. Previously the invite write swallowed its own failure, so a
  //      unique violation there looked exactly like success.
  await verify(inList, userIds);

  console.log('\nStaging seed complete. All data is synthetic; all emails use the reserved .test TLD.');
}

main().catch((e) => { console.error(`\n${e.message}`); process.exit(1); });
