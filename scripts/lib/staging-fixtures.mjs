/**
 * Deterministic staging fixtures — pure definitions, no network, no I/O.
 *
 * Split out of scripts/seed-staging.mjs so the fixture PLAN can be validated and
 * tested without touching a Supabase project. seed-staging.mjs is now only
 * transport: it takes what this module produces and writes it.
 *
 * Two classes of bug motivated the split, both of which reached staging:
 *
 *   PGRST102 "All object keys must match"
 *     PostgREST requires every object in one bulk insert to carry the same keys.
 *     Fixture rows omitted optional fields on some rows and supplied them on
 *     others. `deliverables` failed first; `video_pipeline` would have failed
 *     immediately after. normalizeBatch() now guarantees a single key shape,
 *     and validatePlan() refuses to send a batch that does not have one.
 *
 *   Duplicate rows on a second run
 *     Four batches had no deterministic id and a natural unique constraint, so
 *     re-running would have raised a unique violation (and practice_invites
 *     swallowed its own failure). Every row now has a deterministic id, and
 *     batches with a natural key upsert on that key so they converge whatever
 *     id the existing row happens to carry.
 */
import { createHash } from 'node:crypto';

// Stable v5-style ids: the same fixture name always maps to the same uuid, so
// re-seeding updates rows instead of duplicating them, and --reset is exact.
const SEED_NAMESPACE = 'roxium-staging-fixtures-v1';
const uid = (name) => {
  const h = createHash('sha1').update(`${SEED_NAMESPACE}:${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString();
const day = (offset) => iso(Date.now() + offset * DAY).slice(0, 10);
const monthStart = (back) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - back); return d.toISOString().slice(0, 10); };

// ---------------------------------------------------------------- FIXTURES
// Each practice is chosen to cover specific scenarios from docs/STAGING_DATA.md.
// The `covers` list is the contract — keep it accurate when editing fixtures.
const PRACTICES = [
  { key: 'northstar', name: 'Northstar Facial Surgery (TEST)', go_live: day(-240),
    covers: [1, 8, 9, 13, 18, 20, 21] },
  { key: 'brightpath', name: 'Brightpath Aesthetics (TEST)', go_live: day(-9),
    covers: [2, 3, 5, 6, 16] },
  { key: 'cedarridge', name: 'Cedar Ridge Plastic Surgery (TEST)', go_live: day(-210),
    covers: [4, 7, 10, 11, 12, 14, 19] },
  { key: 'harborpoint', name: 'Harbor Point Cosmetic (TEST)', go_live: day(-60),
    covers: [22] },
];

const USERS = [
  { key: 'team',        email: 'team.ops@roxium.test',            name: 'Test Team Operator', role: 'team',   practice: null,          membership: null },
  { key: 'ns_owner',    email: 'owner.northstar@roxium.test',     name: 'Dr Test Northstar',  role: 'client', practice: 'northstar',   membership: 'owner'  },
  { key: 'ns_member',   email: 'staff.northstar@roxium.test',     name: 'Test Practice Manager', role: 'client', practice: 'northstar', membership: 'member' },
  { key: 'bp_owner',    email: 'owner.brightpath@roxium.test',    name: 'Dr Test Brightpath', role: 'client', practice: 'brightpath',  membership: 'owner'  },
  { key: 'cr_owner',    email: 'owner.cedarridge@roxium.test',    name: 'Dr Test Cedar',      role: 'client', practice: 'cedarridge',  membership: 'owner'  },
  { key: 'hp_owner',    email: 'owner.harborpoint@roxium.test',   name: 'Dr Test Harbor',     role: 'client', practice: 'harborpoint', membership: 'owner'  },
  // Scenario 15: signed up, no membership -> pending approval.
  { key: 'pending',     email: 'pending.applicant@roxium.test',   name: 'Test Pending Applicant', role: 'client', practice: null,      membership: null },
  // Scenario 17: had access, revoked -> auth user exists, membership removed.
  { key: 'revoked',     email: 'revoked.former@roxium.test',      name: 'Test Revoked User',  role: 'client', practice: null,          membership: null },
];

const PHASES = [
  'Phase 0 · Intelligence', 'Phase 1 · Brand Foundation', 'Phase 2 · Video & Authority',
  'Phase 3 · Web & Landing Pages', 'Phase 4 · Paid Media', 'Phase 5 · Nurture Engine',
];

function deliverablesFor(p) {
  const out = [];
  const add = (phase, name, status, extra = {}) =>
    out.push({ id: uid(`deliv:${p.key}:${name}`), practice_id: uid(`practice:${p.key}`),
               phase, name, status, sort: out.length + 1, phase_order: PHASES.indexOf(phase), ...extra });

  if (p.key === 'northstar') {                       // healthy, mostly delivered
    PHASES.slice(0, 4).forEach((ph, i) =>
      ['Discovery workshop', 'Asset handover'].forEach((n, j) =>
        add(ph, `${n} ${i}${j}`, 'delivered', { delivered_at: iso(Date.now() - (200 - i * 30) * DAY), due: day(-200 + i * 30) })));
    add(PHASES[4], 'Campaign build', 'in_progress', { due: day(21) });          // 5: in progress
    add(PHASES[4], 'Creative matrix', 'delivered', { delivered_at: iso(Date.now() - 3 * DAY), due: day(-4) }); // 8: completed
  } else if (p.key === 'brightpath') {               // brand new, phase 0 warming up
    add(PHASES[0], 'Intake & credentials collection', 'in_progress', { due: day(3) });   // 6: waiting on ROXIUM
    add(PHASES[0], 'Brand discovery session', 'promised', { due: day(5), owner_seat: 'CLIENT' }); // 7: waiting on client
    add(PHASES[0], 'Competitive landscape audit', 'promised', { due: day(6) });
    add(PHASES[1], 'Style scapes', 'promised', { due: day(24) });
  } else if (p.key === 'cedarridge') {               // in trouble
    PHASES.slice(0, 2).forEach((ph, i) => add(ph, `Foundation item ${i}`, 'delivered',
      { delivered_at: iso(Date.now() - (180 - i * 20) * DAY), due: day(-180 + i * 20) }));
    add(PHASES[2], 'Video scripts', 'in_progress', { due: day(-28) });          // 4 + overdue
    add(PHASES[2], 'On-site shoot', 'promised', { due: day(-12) });
    add(PHASES[2], 'Patient testimonial films', 'promised', { due: day(9) });
  } else {                                           // harborpoint — isolation control
    add(PHASES[0], 'HARBOR POINT PRIVATE ITEM', 'delivered',
        { delivered_at: iso(Date.now() - 20 * DAY), due: day(-22) });
    add(PHASES[1], 'Harbor brand guidelines', 'in_progress', { due: day(14) });
  }
  return out;
}

function videosFor(p) {
  const pid = uid(`practice:${p.key}`);
  const v = (name, stage, extra = {}) => ({ id: uid(`video:${p.key}:${name}`), practice_id: pid, item: name, stage,
                                            stage_since: iso(Date.now() - (extra._age ?? 2) * DAY), ...extra, _age: undefined });
  if (p.key === 'northstar') return [
    v('Recovery masterclass', 'delivered', { _age: 30, video_url: 'https://example.test/video/ns-1' }),
    v('SEO video — facelift', 'editing', { _age: 4, planned_shoot_date: day(18) }),          // 9: in progress
  ];
  if (p.key === 'brightpath') return [v('Welcome film', 'planned', { _age: 5 })];
  if (p.key === 'cedarridge') return [
    v('VSL production', 'scheduled', { _age: 6, planned_shoot_date: day(4) }),               // 10: approaching
    v('Testimonial #1', 'shot', { _age: 21, planned_shoot_date: day(-15) }),                 // 11: overdue
    v('Procedure explainer', 'editing', { _age: 12, blocked: true,
      blocked_reason: 'Waiting on surgeon approval of the edit' }),                          // 12: waiting on client
  ];
  return [v('Harbor welcome film', 'planned', { _age: 8 })];
}

function kpiFor(p) {
  const pid = uid(`practice:${p.key}`);
  const months = p.key === 'northstar' ? 8 : p.key === 'cedarridge' ? 6 : p.key === 'harborpoint' ? 3 : 1;
  const rows = [];
  for (let i = months - 1; i >= 0; i--) {                                                    // 20: KPI history
    const seed = (p.key.charCodeAt(0) + i) % 7;
    const spend = 3200 + seed * 420 + i * 130;
    rows.push({ id: uid(`kpi:${p.key}:${monthStart(i)}:marketing`),
      practice_id: pid, period: monthStart(i), source: 'marketing',
      spend, reach: Math.round(spend * 7.4), impr: Math.round(spend * 15.2),
      clicks: Math.round(spend * 0.38), lpv: Math.round(spend * 0.27),
      page_engagement: Math.round(spend * 0.9), finalized: i > 0 });
  }
  return rows;
}

function connectionsFor(p) {
  const pid = uid(`practice:${p.key}`);
  if (p.key === 'northstar') return [                                                        // 18: healthy
    { id: uid(`conn:${p.key}:meta`), practice_id: pid, provider: 'meta', status: 'connected', external_account_name: 'Northstar Ads (TEST)',
      connected_at: iso(Date.now() - 120 * DAY), last_synced_at: iso(Date.now() - 2 * 3600e3), last_error: null },
  ];
  if (p.key === 'cedarridge') return [                                                       // 19: failed
    { id: uid(`conn:${p.key}:meta`), practice_id: pid, provider: 'meta', status: 'error', external_account_name: 'Cedar Ridge Ads (TEST)',
      connected_at: iso(Date.now() - 90 * DAY), last_synced_at: iso(Date.now() - 9 * DAY),
      last_error: 'invalid_grant: access token expired — reconnect required' },
  ];
  return [];
}

function activityFor(p) {
  const pid = uid(`practice:${p.key}`);
  if (p.key === 'northstar') return [                                                        // 13: recent updates
    { id: uid(`act:${p.key}:1`), practice_id: pid, message: 'October creative refresh is live across both accounts.', author: 'ROXIUM', source: 'portal', created_at: iso(Date.now() - 1 * DAY) },
    { id: uid(`act:${p.key}:2`), practice_id: pid, message: 'Recovery masterclass published to the channel.', author: 'ROXIUM', source: 'portal', created_at: iso(Date.now() - 4 * DAY) },
  ];
  if (p.key === 'cedarridge') return [                                                       // 14: stale
    { id: uid(`act:${p.key}:1`), practice_id: pid, message: 'Shoot scheduling still pending with the practice.', author: 'ROXIUM', source: 'portal', created_at: iso(Date.now() - 47 * DAY) },
  ];
  return [];
}

// ----------------------------------------------------------------- BATCHES

/**
 * Values used to fill a key that some rows in a batch omit.
 *
 * SCHEMA-AWARE, not a blanket null. Every entry below was checked against the
 * real column definition:
 *
 *   deliverables.delivered_at     nullable, no default   -> null is correct
 *   deliverables.owner_seat       nullable, no default   -> null is correct
 *   video_pipeline.video_url      nullable, no default   -> null is correct
 *   video_pipeline.planned_shoot_date  nullable, no default -> null is correct
 *   video_pipeline.blocked_reason nullable, no default   -> null is correct
 *   video_pipeline.blocked        nullable, DEFAULT false -> false, NOT null.
 *                                 "not blocked" is false; null would lose that
 *                                 meaning and is the case the brief warns about.
 *
 * A column that is NOT NULL WITH a default must never appear here — filling it
 * would override the default with something we invented. normalizeBatch()
 * throws on any key it has no explicit decision for, so a new optional field
 * fails locally rather than silently becoming null in staging.
 *
 * tests/unit/staging-seed-shape.test.mjs asserts these against the live schema.
 */
export const FILL = {
  deliverables: { delivered_at: null, owner_seat: null },
  video_pipeline: { video_url: null, planned_shoot_date: null, blocked_reason: null, blocked: false },
};

/**
 * Give every row in a batch the same key set, in the same order.
 *
 * PostgREST rejects a bulk insert whose objects differ in keys (PGRST102). It
 * does not care about order, but a stable order keeps payloads diffable.
 *
 * @throws if a row omits a key this module has no documented fill value for.
 */
export function normalizeBatch(table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  const fill = FILL[table] || {};

  return rows.map((row, i) => {
    const out = {};
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(row, k)) {
        out[k] = row[k];            // explicit false / 0 / '' are preserved as-is
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(fill, k)) {
        throw new Error(
          `${table}[${i}] omits "${k}" and no fill value is declared for it. ` +
          'Add it to FILL in scripts/lib/staging-fixtures.mjs with the value the ' +
          'schema actually wants (null only if the column is nullable with no ' +
          'default), or supply the field on every row.',
        );
      }
      out[k] = fill[k];
    }
    return out;
  });
}

/**
 * The normalization Postgres applies inside an expression index.
 *
 * `lower(btrim(x))` with the default trim set removes SPACES only, so this
 * mirrors it rather than using String.trim(), which also strips tabs and
 * newlines. `lower()` is locale-aware in Postgres and toLowerCase() is not —
 * validatePlan therefore asserts every fixture value in a natural-key column is
 * plain ASCII, which is the range where the two provably agree.
 */
const lowerBtrim = (v) => String(v ?? '').replace(/^ +| +$/g, '').toLowerCase();

/**
 * Tables whose uniqueness is enforced by an EXPRESSION index.
 *
 * Postgres only accepts an ON CONFLICT target that matches a real index, and a
 * plain column list never matches `lower(btrim(col))`:
 *
 *   INSERT INTO practice_invites … ON CONFLICT (practice_id, email)
 *   ERROR:  there is no unique or exclusion constraint matching the ON CONFLICT
 *           specification                                         (SQLSTATE 42P10)
 *
 * PostgREST turns `?on_conflict=practice_id,email` into exactly that statement,
 * so these tables cannot use it. They upsert on the primary key instead, and the
 * seeder first removes any row that collides with a fixture under the index's own
 * normalization while carrying a different id — the leftover that an older,
 * random-id seeder would have written. Without that step the primary-key upsert
 * dies on a 23505 that no amount of retrying can clear.
 *
 * `index` is the index each entry mirrors; a test asserts it still exists and is
 * still expression-based, so this never drifts silently out of step with schema.sql.
 */
export const NATURAL_KEYS = {
  practices: {
    index: 'practices_name_lower_uq',
    columns: ['name'],
    normalize: { name: lowerBtrim },
    scope: null,                       // read every practice; they are all fixtures by now
  },
  practice_invites: {
    index: 'practice_invites_practice_email_uq',
    columns: ['practice_id', 'email'],
    normalize: { email: lowerBtrim },
    scope: 'practice_id',              // read only rows belonging to fixture practices
  },
};

/** The value a natural-key index actually compares, for one row. */
export function naturalKeyOf(row, nk) {
  return nk.columns
    .map((c) => (nk.normalize[c] ? nk.normalize[c](row[c]) : String(row[c] ?? '')))
    .join('\u0000');
}

/**
 * The write plan: ordered batches, plus the auth users and the one invite.
 *
 * `conflict` names the columns PostgREST should resolve on. Where a table has a
 * natural unique key we target THAT rather than the primary key, so a row that
 * already exists under a different id converges instead of colliding.
 */
export function plan() {
  const practices = [];
  const deliverables = [];
  const videos = [];
  const kpi = [];
  const connections = [];
  const activity = [];
  const milestones = [];

  for (const p of PRACTICES) {
    const pid = uid(`practice:${p.key}`);
    practices.push({ id: pid, name: p.name, go_live: p.go_live });
    deliverables.push(...deliverablesFor(p));
    videos.push(...videosFor(p));
    kpi.push(...kpiFor(p));
    connections.push(...connectionsFor(p));
    activity.push(...activityFor(p));
    milestones.push(
      { id: uid(`ms:${p.key}:1`), practice_id: pid, name: 'Milestone I — Foundation', status: 'done', target_date: day(-60), sort: 1 },
      { id: uid(`ms:${p.key}:2`), practice_id: pid, name: 'Milestone II — Brand Awareness', status: 'current', target_date: day(20), sort: 2 },
      { id: uid(`ms:${p.key}:3`), practice_id: pid, name: 'Milestone III — Full Funnel', status: 'upcoming', target_date: day(75), sort: 3 },
    );
  }

  const batches = [
    // practices first: everything below references practice_id.
    { table: 'practices', rows: practices, conflict: null, naturalKey: NATURAL_KEYS.practices },
    { table: 'deliverables', rows: deliverables, conflict: null },
    { table: 'milestones', rows: milestones, conflict: null },
    { table: 'video_pipeline', rows: videos, conflict: null },
    // Natural unique keys backed by a plain column index: resolve on those
    // rather than on the primary key, so a row that already exists under a
    // different id converges instead of colliding.
    { table: 'kpi_monthly', rows: kpi, conflict: 'practice_id,period,source' },
    { table: 'platform_connections', rows: connections, conflict: 'practice_id,provider' },
    { table: 'activity', rows: activity, conflict: null },
    // Last, because it references practices: its unique key is an expression
    // index, so it upserts on the primary key after a natural-key sweep.
    { table: 'practice_invites', rows: INVITES, conflict: null, naturalKey: NATURAL_KEYS.practice_invites },
  ].map((b) => ({ ...b, rows: normalizeBatch(b.table, b.rows) }));

  return { batches, users: USERS, practices: PRACTICES, invites: INVITES };
}

/** Scenario 16: an invitation sent but not yet accepted. */
export const INVITES = [
  { id: uid('invite:brightpath:invited.newstaff'),
    practice_id: uid('practice:brightpath'), email: 'invited.newstaff@roxium.test',
    full_name: 'Test Invited Staff', role: 'member', status: 'sent' },
];

/** The exact fixture state a successful seed converges to. Derived, not typed in. */
export function expectedCounts() {
  const { batches } = plan();
  const counts = Object.fromEntries(batches.map((b) => [b.table, b.rows.length]));
  counts.profiles = USERS.length;
  counts.memberships = USERS.filter((u) => u.membership && u.practice).length;
  counts.auth_users = USERS.length;
  return counts;
}

/**
 * Pre-flight validation. Runs BEFORE any network call, so a malformed fixture
 * set fails on a laptop with a precise message instead of half-way through a
 * remote seed — which is how the PGRST102 failure reached staging.
 *
 * @throws AggregateError-style Error listing every problem found.
 */
export function validatePlan(p = plan()) {
  const problems = [];
  const seenIds = new Map();

  for (const b of p.batches) {
    if (!b.rows.length) continue;

    // 1 · one key shape per batch — the PGRST102 rule.
    const shapes = new Set(b.rows.map((r) => Object.keys(r).sort().join(',')));
    if (shapes.size !== 1) {
      problems.push(`${b.table}: ${shapes.size} different key shapes in one bulk insert ` +
        '(PostgREST requires all object keys to match — PGRST102)');
    }

    for (const [i, r] of b.rows.entries()) {
      // 2 · every row carries a deterministic id, so a re-run updates instead
      //     of inserting a second copy.
      if (!r.id) { problems.push(`${b.table}[${i}] has no deterministic id`); continue; }
      const where = `${b.table}[${i}]`;
      if (seenIds.has(r.id)) problems.push(`duplicate fixture id ${r.id} in ${seenIds.get(r.id)} and ${where}`);
      else seenIds.set(r.id, where);

      // 3 · no fixture may reference a practice that is not part of the plan.
      if (b.table !== 'practices' && r.practice_id && !practiceIds(p).has(r.practice_id)) {
        problems.push(`${where} references practice_id ${r.practice_id}, which no fixture practice defines`);
      }
    }

    // 4 · a declared on_conflict target must name columns every row carries.
    //     PostgREST builds ON CONFLICT (…) from this verbatim; a column that is
    //     absent from the payload makes the statement resolve on a value the
    //     seeder never sent.
    if (b.conflict) {
      for (const col of b.conflict.split(',')) {
        const missing = b.rows.filter((r) => !Object.prototype.hasOwnProperty.call(r, col.trim())).length;
        if (missing) problems.push(`${b.table}: on_conflict names "${col.trim()}" but ${missing} row(s) omit it`);
      }
    }

    // 5 · no two fixtures may collide under a natural unique index, and the
    //     values must be ASCII so this module's lowerBtrim provably matches what
    //     Postgres computes inside the index.
    if (b.naturalKey) {
      const seen = new Map();
      for (const [i, r] of b.rows.entries()) {
        for (const col of b.naturalKey.columns) {
          const v = String(r[col] ?? '');
          // eslint-disable-next-line no-control-regex
          if (/[^\x00-\x7F]/.test(v)) {
            problems.push(`${b.table}[${i}].${col} = "${v}" is not ASCII; ` +
              `${b.naturalKey.index} normalizes with Postgres lower(), which this module cannot mirror exactly outside ASCII`);
          }
        }
        const k = naturalKeyOf(r, b.naturalKey);
        if (seen.has(k)) problems.push(`${b.table}[${i}] collides with ${b.table}[${seen.get(k)}] under ${b.naturalKey.index}`);
        else seen.set(k, i);
      }
    }
  }

  // 6 · every practice is unmistakably a test fixture.
  for (const pr of p.practices) {
    if (!pr.name.endsWith('(TEST)')) problems.push(`practice "${pr.name}" does not end in "(TEST)"`);
  }

  // 7 · every address uses the reserved .test TLD and appears once.
  const emails = new Set();
  for (const u of [...p.users, ...p.invites]) {
    const e = String(u.email || '').toLowerCase();
    if (!e.endsWith('@roxium.test')) problems.push(`fixture email "${u.email}" is not @roxium.test — refusing to touch a real address`);
    if (emails.has(e)) problems.push(`duplicate fixture email ${e}`);
    emails.add(e);
  }

  // 8 · a membership needs a practice, and vice versa.
  for (const u of p.users) {
    if (u.membership && !u.practice) problems.push(`user ${u.email} has a membership role but no practice`);
    if (u.practice && !p.practices.some((x) => x.key === u.practice)) {
      problems.push(`user ${u.email} references unknown practice key "${u.practice}"`);
    }
  }

  if (problems.length) {
    throw new Error(`the staging fixture plan is invalid:\n  - ${problems.join('\n  - ')}`);
  }
  return p;
}

function practiceIds(p) {
  return new Set(p.batches.find((b) => b.table === 'practices').rows.map((r) => r.id));
}

export { PRACTICES, USERS, PHASES, SEED_NAMESPACE, uid };
