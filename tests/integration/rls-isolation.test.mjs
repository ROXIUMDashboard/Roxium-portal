/**
 * A client must never reach another practice's data.
 *
 * This is the check that has to hold before a real surgeon is given a login.
 * The portal's UI filters by practice, but UI filtering is not a security
 * boundary: a client holds their own Supabase access token, and can call
 * PostgREST directly with it. The only thing standing between them and another
 * practice's data is row-level security.
 *
 * So this tests RLS itself, against a REAL Postgres carrying the REAL generated
 * bootstrap, with the policies evaluated exactly as PostgREST evaluates them:
 * as the `authenticated` role, with the user's id in request.jwt.claims.
 *
 * Two things make the difference between a real test and a reassuring one:
 *
 *   1. auth.uid() must read the JWT claim. The test stub hard-codes it to NULL,
 *      under which every is_member_of() is false and every table looks perfectly
 *      isolated — a false green. The faithful definition is installed below.
 *   2. The `authenticated` role must actually hold table privileges. Supabase
 *      grants those by default; a plain Postgres does not. Without them every
 *      read fails with "permission denied" and the suite passes without RLS
 *      having been consulted at all. They are granted below, so a denial in
 *      these tests is always an RLS denial.
 *
 * A positive control runs first: each client must SEE their own rows. If that
 * fails, the isolation results below mean nothing.
 *
 *   ROXIUM_TEST_PG=postgresql://postgres:postgres@localhost:5432/postgres \
 *   node --test tests/integration/rls-isolation.test.mjs
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildBootstrapSql } from '../../scripts/build-staging-bootstrap.mjs';

const ADMIN = process.env.ROXIUM_TEST_PG || '';
const havePsql = spawnSync('psql', ['--version']).status === 0;
const READY = Boolean(ADMIN) && havePsql;

if (process.env.CI && !READY) {
  throw new Error(
    'RLS isolation tests cannot run: ' +
    `ROXIUM_TEST_PG=${ADMIN ? 'set' : 'MISSING'}, psql=${havePsql ? 'present' : 'MISSING'}. ` +
    'In CI these must run — this is the client-isolation gate, and a skip is a false green.',
  );
}

const STUB = new URL('../fixtures/supabase-stub.sql', import.meta.url).pathname;
const dbUrl = (n) => ADMIN.replace(/\/[^/?]*(\?|$)/, `/${n}$1`);
const made = [];
let URL_ = '';

/**
 * Tables a client is MEANT to read for their own practice, every one of them
 * scoped by membership. Derived from the policies themselves, not from a guess:
 * each carries `is_team() OR is_member_of(practice_id)` or the equivalent
 * memberships lookup.
 */
const CLIENT_READABLE = [
  'deliverables', 'milestones', 'video_pipeline', 'video_history',
  'kpi_monthly', 'kpi_daily', 'activity', 'notifications',
  'platform_connections', 'memberships', 'practice_invites',
];

/**
 * Internal tables a client must never read — not even for their own practice.
 * sheet_sources is team-only (`using (is_team())`); platform_tokens holds OAuth
 * secrets and has RLS enabled with NO policy at all, so nothing but the
 * service role reaches it.
 */
const TEAM_ONLY = ['sheet_sources', 'platform_tokens'];

/** Every table a client's own access token could be pointed at. */
const PRACTICE_SCOPED = [...CLIENT_READABLE, 'sheet_sources'];

const A = { practice: randomUUID(), user: randomUUID() };
const B = { practice: randomUUID(), user: randomUUID() };
const TEAM = { user: randomUUID() };
const REVOKED = { user: randomUUID() };

function sql(text, { as = null } = {}) {
  // `as` impersonates a signed-in user exactly as PostgREST does: the
  // `authenticated` role plus the user's id in the JWT claims.
  const preamble = as
    ? `set local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${as}","role":"authenticated"}', true);\n`
    : '';
  const body = as ? `begin;\n${preamble}${text}\ncommit;` : text;
  const r = spawnSync('psql', [URL_, '-At', '-v', 'ON_ERROR_STOP=1', '-c', body], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

/** Row count a given user can actually see in `table` for `practice`. */
function visible(table, practice, as) {
  const col = table === 'practices' ? 'id' : 'practice_id';
  const r = sql(`select count(*) from ${table} where ${col} = '${practice}';`, { as });
  assert.ok(r.ok, `${table} as ${as} errored (that is not an RLS denial): ${r.err}`);
  // `set local role` + the count leaves the count as the last line of output.
  const lines = r.out.split('\n').filter((l) => /^\d+$/.test(l));
  return Number(lines[lines.length - 1]);
}

describe('production RLS: client isolation', { skip: !READY && 'ROXIUM_TEST_PG / psql not available' }, () => {
  before(() => {
    const name = `roxium_rls_${randomUUID().slice(0, 8)}`;
    spawnSync('psql', [ADMIN, '-q', '-c', `create database ${name}`]);
    made.push(name);
    URL_ = dbUrl(name);
    assert.equal(spawnSync('psql', [URL_, '-q', '-v', 'ON_ERROR_STOP=1', '-f', STUB]).status, 0, 'stub failed');

    const bs = join(tmpdir(), `rls-bs-${randomUUID().slice(0, 8)}.sql`);
    writeFileSync(bs, buildBootstrapSql().sql, 'utf8');
    const r = spawnSync('psql', [URL_, '-q', '-v', 'ON_ERROR_STOP=1', '-f', bs], { encoding: 'utf8' });
    assert.equal(r.status, 0, `bootstrap failed:\n${(r.stderr || '').slice(-1500)}`);

    // (1) the faithful auth.uid(): read the claim, as Supabase does.
    let s = sql(`create or replace function auth.uid() returns uuid language sql stable as $fn$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid $fn$;`);
    assert.ok(s.ok, s.err);

    // (2) the privileges Supabase grants by default, so RLS is the only gate.
    s = sql(`grant usage on schema public to anon, authenticated;
      grant all on all tables in schema public to anon, authenticated;
      grant all on all sequences in schema public to anon, authenticated;`);
    assert.ok(s.ok, s.err);

    // Fixture tenants. Written as the table owner, bypassing RLS on purpose:
    // this is the setup, not the thing under test.
    s = sql(`
      insert into auth.users (id, email) values
        ('${A.user}','clienta@example.test'), ('${B.user}','clientb@example.test'),
        ('${TEAM.user}','team@example.test'), ('${REVOKED.user}','revoked@example.test');
      insert into practices (id, name) values ('${A.practice}','Practice A'), ('${B.practice}','Practice B');
      insert into profiles (id, full_name, role, practice_id, approval_status) values
        ('${A.user}','Client A','client','${A.practice}','approved'),
        ('${B.user}','Client B','client','${B.practice}','approved'),
        ('${TEAM.user}','Team','team',null,'approved'),
        ('${REVOKED.user}','Revoked','client','${A.practice}','approved');
      insert into memberships (user_id, practice_id, role) values
        ('${A.user}','${A.practice}','owner'),
        ('${B.user}','${B.practice}','owner'),
        ('${REVOKED.user}','${A.practice}','member');
      insert into deliverables (practice_id, phase, name, status) values
        ('${A.practice}','Foundation','A deliverable','promised'),
        ('${B.practice}','Foundation','B deliverable','promised');
      insert into milestones (practice_id, name, status) values
        ('${A.practice}','A milestone','current'), ('${B.practice}','B milestone','current');
      insert into video_pipeline (practice_id, item, stage) values
        ('${A.practice}','A video','planned'), ('${B.practice}','B video','planned');
      insert into kpi_monthly (practice_id, period, month, source) values
        ('${A.practice}','2026-01-01',1,'marketing'),
        ('${B.practice}','2026-01-01',1,'marketing');
      insert into kpi_daily (practice_id, day, source) values
        ('${A.practice}','2026-01-01','marketing'), ('${B.practice}','2026-01-01','marketing');
      insert into activity (practice_id, message) values
        ('${A.practice}','A activity'), ('${B.practice}','B activity');
      insert into notifications (practice_id, kind, message) values
        ('${A.practice}','stats','A notification'), ('${B.practice}','stats','B notification');
      insert into platform_connections (practice_id, provider, status) values
        ('${A.practice}','meta','connected'), ('${B.practice}','meta','connected');
      insert into sheet_sources (practice_id) values ('${A.practice}'), ('${B.practice}');
      insert into practice_invites (practice_id, email, role, status) values
        ('${A.practice}','invitee-a@example.test','member','sent'),
        ('${B.practice}','invitee-b@example.test','member','sent');
      insert into video_history (practice_id, video_id, stage)
        select practice_id, id, 'planned' from video_pipeline;
    `);
    assert.ok(s.ok, `fixture setup failed: ${s.err}`);
  });

  after(() => { for (const n of made) spawnSync('psql', [ADMIN, '-q', '-c', `drop database if exists ${n}`]); });

  // ── positive control ─────────────────────────────────────────────────────
  test('CONTROL: a client can see their OWN practice (or the rest proves nothing)', () => {
    const blind = [];
    for (const t of CLIENT_READABLE) if (visible(t, A.practice, A.user) === 0) blind.push(t);
    assert.deepEqual(blind, [],
      `client A cannot see their own rows in: ${blind.join(', ')} — the isolation results below would be meaningless`);
    assert.equal(visible('practices', A.practice, A.user), 1, 'client A cannot see their own practice');
  });

  // ── the mandatory check ──────────────────────────────────────────────────
  test('a client cannot read ANY of another practice\'s data', () => {
    const leaks = [];
    for (const t of PRACTICE_SCOPED) {
      const n = visible(t, B.practice, A.user);
      if (n !== 0) leaks.push(`${t}: client A saw ${n} of practice B's rows`);
    }
    const p = visible('practices', B.practice, A.user);
    if (p !== 0) leaks.push(`practices: client A saw practice B itself`);
    assert.deepEqual(leaks, [], `CROSS-TENANT LEAK:\n  ${leaks.join('\n  ')}`);
  });

  test('isolation holds in the other direction too', () => {
    const leaks = [];
    for (const t of PRACTICE_SCOPED) {
      const n = visible(t, A.practice, B.user);
      if (n !== 0) leaks.push(`${t}: client B saw ${n} of practice A's rows`);
    }
    assert.deepEqual(leaks, [], `CROSS-TENANT LEAK:\n  ${leaks.join('\n  ')}`);
  });

  test('a client cannot see another practice\'s users or memberships', () => {
    assert.equal(visible('memberships', B.practice, A.user), 0);
    // profiles is not practice-scoped: a client must see only their own row.
    const r = sql(`select count(*) from profiles;`, { as: A.user });
    const n = Number(r.out.split('\n').filter((l) => /^\d+$/.test(l)).pop());
    assert.equal(n, 1, `client A can see ${n} profiles; only their own may be visible`);
  });

  test('a client cannot WRITE to another practice', () => {
    const r = sql(`insert into deliverables (practice_id, phase, name, status)
                   values ('${B.practice}','Foundation','injected','promised');`, { as: A.user });
    assert.equal(r.ok, false, 'client A was able to insert a deliverable into practice B');
    assert.match(r.err, /row-level security/i, `expected an RLS denial, got: ${r.err}`);
  });

  test('a client cannot write to their OWN practice either (clients are read-only)', () => {
    const r = sql(`insert into deliverables (practice_id, phase, name, status)
                   values ('${A.practice}','Foundation','self-injected','promised');`, { as: A.user });
    assert.equal(r.ok, false, 'a client could create a deliverable in their own practice');
  });

  test('a client cannot read internal team-only tables, even for their own practice', () => {
    const leaks = [];
    for (const t of TEAM_ONLY) {
      const r = sql(`select count(*) from ${t};`, { as: A.user });
      assert.ok(r.ok, `${t} errored rather than filtering (that is not an RLS denial): ${r.err}`);
      const n = Number(r.out.split('\n').filter((l) => /^\d+$/.test(l)).pop());
      if (n !== 0) leaks.push(`${t}: ${n} row(s)`);
    }
    assert.deepEqual(leaks, [], `a client can read internal tables: ${leaks.join(', ')}`);
  });

  test('a client cannot read OAuth tokens for any practice', () => {
    const r = sql(`select count(*) from platform_tokens;`, { as: A.user });
    assert.ok(r.ok, `platform_tokens errored rather than filtering: ${r.err}`);
    assert.equal(Number(r.out.split('\n').filter((l) => /^\d+$/.test(l)).pop()), 0);
  });

  // ── revocation ───────────────────────────────────────────────────────────
  test('a revoked user loses access the moment the membership is gone', () => {
    assert.ok(visible('deliverables', A.practice, REVOKED.user) > 0, 'setup: revoked user should start with access');
    const r = sql(`delete from memberships where user_id = '${REVOKED.user}';`);
    assert.ok(r.ok, r.err);
    const leaks = PRACTICE_SCOPED.filter((t) => visible(t, A.practice, REVOKED.user) !== 0);
    assert.deepEqual(leaks, [], `a revoked user still reads: ${leaks.join(', ')}`);
    assert.equal(visible('practices', A.practice, REVOKED.user), 0, 'a revoked user still sees the practice');
  });

  test('approval_status alone does NOT gate data — the membership is what matters', () => {
    // Worth pinning down: RLS consults memberships, not profiles.approval_status.
    // Marking a profile rejected changes what the UI shows, not what the API
    // returns. Revocation must therefore remove the membership, which is what
    // remove_practice_member() does.
    const r = sql(`update profiles set approval_status = 'rejected' where id = '${B.user}';`);
    assert.ok(r.ok, r.err);
    assert.ok(visible('deliverables', B.practice, B.user) > 0,
      'if this ever returns 0, RLS has started consulting approval_status and this note is stale');
  });

  // ── team ─────────────────────────────────────────────────────────────────
  test('a team account can see every practice (the intended asymmetry)', () => {
    assert.ok(visible('deliverables', A.practice, TEAM.user) > 0);
    assert.ok(visible('deliverables', B.practice, TEAM.user) > 0);
  });

  test('a signed-in user with no membership at all sees nothing', () => {
    const nobody = randomUUID();
    sql(`insert into auth.users (id, email) values ('${nobody}','nobody@example.test');
         insert into profiles (id, full_name, role, approval_status)
         values ('${nobody}','Nobody','client','approved');`);
    const leaks = PRACTICE_SCOPED.filter((t) => visible(t, A.practice, nobody) !== 0);
    assert.deepEqual(leaks, [], `an unattached account reads: ${leaks.join(', ')}`);
  });
});
