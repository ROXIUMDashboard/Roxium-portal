/**
 * The staging fixture set is a contract: docs/STAGING_DATA.md promises 22 named
 * scenarios, and every row the seeder sends has to satisfy rules PostgREST and
 * Postgres will otherwise enforce mid-seed, against a half-written staging
 * database, with an error that names neither the table nor the row.
 *
 * These tests import the real module and exercise the real validator. An
 * earlier version matched the seeder's source TEXT with regexes; that passed
 * happily while the payload it described was the one PostgREST rejected with
 * PGRST102, because reading source is not the same as running it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  plan, validatePlan, normalizeBatch, expectedCounts, naturalKeyOf,
  FILL, NATURAL_KEYS, PRACTICES, USERS, INVITES, uid,
} from '../../scripts/lib/staging-fixtures.mjs';

const seederSrc = readFileSync(new URL('../../scripts/seed-staging.mjs', import.meta.url), 'utf8');

/** Deep-clone the plan so a mutation test cannot leak into the next test. */
const clone = (p) => ({
  ...p,
  batches: p.batches.map((b) => ({ ...b, rows: b.rows.map((r) => ({ ...r })) })),
  users: p.users.map((u) => ({ ...u })),
  invites: p.invites.map((i) => ({ ...i })),
  practices: p.practices.map((x) => ({ ...x })),
});

describe('staging fixtures', () => {
  test('the real fixture plan validates clean', () => {
    assert.doesNotThrow(() => validatePlan(plan()));
  });

  test('all 22 documented scenarios are covered by a practice or a user fixture', () => {
    const covered = new Set(PRACTICES.flatMap((p) => p.covers));
    // 15 (pending approval) and 17 (revoked) are user-level, not practice-level.
    if (USERS.some((u) => u.key === 'pending')) covered.add(15);
    if (USERS.some((u) => u.key === 'revoked')) covered.add(17);
    const missing = [];
    for (let i = 1; i <= 22; i++) if (!covered.has(i)) missing.push(i);
    assert.deepEqual(missing, [], `scenarios not covered by any fixture: ${missing.join(', ')}`);
  });

  test('every fixture address uses the reserved .test TLD', () => {
    const emails = [...USERS, ...INVITES].map((u) => u.email);
    assert.ok(emails.length >= 9, 'expected the user and invite fixtures to be present');
    for (const e of emails) assert.match(e, /@[a-z0-9.-]+\.test$/, `"${e}" is not on the reserved .test TLD`);
  });

  test('no fixture references the production project ref', () => {
    const src = readFileSync(new URL('../../scripts/lib/staging-fixtures.mjs', import.meta.url), 'utf8');
    assert.ok(!/nchtmeqsjkpcvtuscxfy/.test(src), 'fixtures must never mention the production project');
  });

  // ── the PGRST102 rule ────────────────────────────────────────────────────

  test('every batch sends exactly one key shape', () => {
    for (const b of plan().batches) {
      const shapes = new Set(b.rows.map((r) => Object.keys(r).sort().join(',')));
      assert.equal(shapes.size, 1, `${b.table} sends ${shapes.size} key shapes — PostgREST answers PGRST102`);
    }
  });

  test('validatePlan catches a mismatched key shape', () => {
    const p = clone(plan());
    delete p.batches.find((b) => b.table === 'deliverables').rows[0].status;
    assert.throws(() => validatePlan(p), /deliverables: 2 different key shapes/);
  });

  test('normalizeBatch fills a missing key rather than sending a short row', () => {
    const out = normalizeBatch('deliverables', [
      { id: 'a', practice_id: 'p', title: 'one', delivered_at: '2026-01-01', owner_seat: 'x' },
      { id: 'b', practice_id: 'p', title: 'two' },
    ]);
    assert.deepEqual(Object.keys(out[0]).sort(), Object.keys(out[1]).sort());
    assert.equal(out[1].delivered_at, null);
    assert.equal(out[1].owner_seat, null);
  });

  test('normalizeBatch preserves meaningful falsy values instead of nulling them', () => {
    // false, 0 and '' are data. A fill that overwrote them would quietly change
    // what the fixtures mean — an unblocked video is not an unknown one.
    const out = normalizeBatch('video_pipeline', [
      { id: 'a', practice_id: 'p', blocked: false, blocked_reason: '', video_url: null, planned_shoot_date: '2026-02-02' },
      { id: 'b', practice_id: 'p', blocked: true, blocked_reason: 'waiting', video_url: 'u', planned_shoot_date: '2026-02-03' },
    ]);
    assert.equal(out[0].blocked, false, 'explicit false was not preserved');
    assert.equal(out[0].blocked_reason, '', 'an intentional empty string was not preserved');
    assert.equal(out[0].video_url, null, 'an explicit null was not preserved');
    assert.equal(normalizeBatch('kpi_monthly', [{ id: 'a', leads: 0 }])[0].leads, 0, 'zero was not preserved');
  });

  test('normalizeBatch refuses to invent a value it was never told', () => {
    // The alternative — defaulting silently to null — is how a NOT NULL column
    // or a column whose database DEFAULT matters gets quietly clobbered.
    assert.throws(
      () => normalizeBatch('deliverables', [{ id: 'a', quantity: 3 }, { id: 'b' }]),
      /omits "quantity" and no fill value is declared/,
    );
  });

  test('video_pipeline.blocked fills with false, not null — it has a database default', () => {
    // Filling a boolean flag with null would make "not blocked" read as unknown
    // everywhere the portal tests truthiness.
    assert.equal(FILL.video_pipeline.blocked, false);
  });

  // ── re-run safety ────────────────────────────────────────────────────────

  test('every row carries a deterministic id, so a re-run updates rather than duplicates', () => {
    for (const b of plan().batches) {
      for (const [i, r] of b.rows.entries()) assert.ok(r.id, `${b.table}[${i}] has no id`);
    }
  });

  test('fixture ids are stable across calls', () => {
    const a = plan().batches.flatMap((b) => b.rows.map((r) => r.id));
    const c = plan().batches.flatMap((b) => b.rows.map((r) => r.id));
    assert.deepEqual(a, c, 'plan() is not deterministic');
  });

  test('no fixture id is reused by two rows', () => {
    const p = clone(plan());
    const d = p.batches.find((b) => b.table === 'deliverables');
    d.rows[1].id = d.rows[0].id;
    assert.throws(() => validatePlan(p), /duplicate fixture id/);
  });

  test('validatePlan catches a row with no id', () => {
    const p = clone(plan());
    delete p.batches.find((b) => b.table === 'milestones').rows[0].id;
    assert.throws(() => validatePlan(p), /key shapes|has no deterministic id/);
  });

  test('validatePlan catches a dangling practice reference', () => {
    const p = clone(plan());
    p.batches.find((b) => b.table === 'deliverables').rows[0].practice_id = '00000000-0000-4000-8000-000000000000';
    assert.throws(() => validatePlan(p), /references practice_id 00000000/);
  });

  test('validatePlan catches an on_conflict target no row carries', () => {
    const p = clone(plan());
    const kpi = p.batches.find((b) => b.table === 'kpi_monthly');
    for (const r of kpi.rows) delete r.source;
    assert.throws(() => validatePlan(p), /on_conflict names "source"/);
  });

  test('validatePlan catches two fixtures colliding under a natural unique index', () => {
    const p = clone(plan());
    const pr = p.batches.find((b) => b.table === 'practices');
    pr.rows[1].name = pr.rows[0].name.toUpperCase();   // lower(btrim(name)) makes these one row
    assert.throws(() => validatePlan(p), /collides with practices\[0\] under practices_name_lower_uq/);
  });

  test('naturalKeyOf mirrors lower(btrim(x)) — case and surrounding spaces do not distinguish rows', () => {
    const nk = NATURAL_KEYS.practice_invites;
    const a = naturalKeyOf({ practice_id: 'p', email: '  Invited.NewStaff@Roxium.Test  ' }, nk);
    const b = naturalKeyOf({ practice_id: 'p', email: 'invited.newstaff@roxium.test' }, nk);
    assert.equal(a, b);
    assert.notEqual(naturalKeyOf({ practice_id: 'q', email: 'invited.newstaff@roxium.test' }, nk), b);
  });

  // ── safety ───────────────────────────────────────────────────────────────

  test('validatePlan refuses a practice that is not marked (TEST)', () => {
    const p = clone(plan());
    p.practices[0].name = 'Real Clinic';
    assert.throws(() => validatePlan(p), /does not end in "\(TEST\)"/);
  });

  test('validatePlan refuses an address outside @roxium.test', () => {
    const p = clone(plan());
    p.users[0].email = 'real.person@gmail.com';
    assert.throws(() => validatePlan(p), /is not @roxium\.test/);
  });

  test('every practice name is unmistakably synthetic', () => {
    for (const p of PRACTICES) assert.match(p.name, /\(TEST\)$/);
  });

  // ── the counts the workflow reports ──────────────────────────────────────

  test('expectedCounts is derived from the plan, not typed in', () => {
    const p = plan();
    const counts = expectedCounts();
    for (const b of p.batches) assert.equal(counts[b.table], b.rows.length, `${b.table} count is out of step`);
    assert.equal(counts.profiles, USERS.length);
    assert.equal(counts.auth_users, USERS.length);
    assert.equal(counts.memberships, USERS.filter((u) => u.membership && u.practice).length);
  });

  test('expectedCounts covers every table the seeder writes', () => {
    const written = new Set(plan().batches.map((b) => b.table));
    for (const extra of ['profiles', 'memberships', 'auth_users']) written.add(extra);
    assert.deepEqual([...Object.keys(expectedCounts())].sort(), [...written].sort(),
      'a table the seeder writes is not verified afterwards');
  });

  test('docs/STAGING_DATA.md quotes the counts the seeder actually produces', () => {
    // The doc tells QA what a finished seed looks like. If it drifts, someone
    // verifies staging against numbers that were true a release ago.
    const doc = readFileSync(new URL('../../docs/STAGING_DATA.md', import.meta.url), 'utf8');
    const quoted = Object.fromEntries(
      [...doc.matchAll(/^\| `([a-z_]+)` \| (\d+) \|$/gm)].map((m) => [m[1], Number(m[2])]),
    );
    for (const [table, n] of Object.entries(expectedCounts())) {
      assert.equal(quoted[table], n,
        `docs/STAGING_DATA.md says ${table} = ${quoted[table]}, the fixtures produce ${n}`);
    }
  });

  // ── the seeder stays transport-only ──────────────────────────────────────

  test('the seeder validates the plan before it opens a socket', () => {
    const body = seederSrc.slice(seederSrc.indexOf('async function main()'));
    const validateAt = body.indexOf('validatePlan(');
    const guardAt = body.indexOf('assertStagingTarget(URL_)');
    const writes = ["method: 'POST'", "method: 'DELETE'", 'await rest(', 'await upsert(']
      .map((m) => body.indexOf(m)).filter((i) => i > 0);
    assert.ok(validateAt > 0, 'main() never validates the plan');
    assert.ok(guardAt > 0, 'main() never invokes the production guard');
    assert.ok(validateAt < guardAt, 'the plan must be validated before anything is contacted');
    assert.ok(guardAt < Math.min(...writes), 'the guard must run before the first write');
  });

  test('the seeder holds no fixture data of its own', () => {
    // Everything it writes has to come through the validated plan; a literal
    // fixture row here would bypass validatePlan entirely.
    // A local part before the domain means a specific account is named here.
    // The bare '@roxium.test' suffix is the safety check in ensureUser, which
    // belongs in the transport layer and must stay.
    const named = [...seederSrc.matchAll(/'([A-Za-z0-9._%+-]+@roxium\.test)'/g)].map((m) => m[1]);
    assert.deepEqual(named, [], `the seeder names fixture accounts directly: ${named.join(', ')}`);
    assert.ok(!/covers:\s*\[/.test(seederSrc), 'the seeder still declares practice fixtures');
  });

  test('the seeder never issues a DELETE that is not filtered by a fixture id', () => {
    for (const m of seederSrc.matchAll(/rest\(`([^`]+)`,\s*\{\s*method:\s*'DELETE'/g)) {
      assert.match(m[1], /\?(practice_id|id)=in\.\$\{inList\}|\?id=in\.\(/,
        `unscoped DELETE in the seeder: ${m[1]}`);
    }
  });

  test('the fixture password is read from the environment, never hard-coded', () => {
    assert.match(seederSrc, /STAGING_FIXTURE_PASSWORD/);
    assert.ok(!/password:\s*'[^']{6,}'/.test(seederSrc), 'a literal password is present in the seeder');
  });

  test('uid is a pure function of its input', () => {
    assert.equal(uid('practice:northstar'), uid('practice:northstar'));
    assert.notEqual(uid('practice:northstar'), uid('practice:brightpath'));
    assert.match(uid('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
