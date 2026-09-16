/**
 * The staging seeder must converge, from any of the states staging can be in.
 *
 * Initialize STAGING #3 got all the way through the schema and the Edge
 * Functions and then died on:
 *
 *   PGRST102  "All object keys must match"
 *
 * — a bulk insert whose objects did not all carry the same key set. Nothing
 * checked the payload until PostgREST did, and by then four practices had
 * already been written, leaving staging half-seeded and the seeder unable to
 * finish on a re-run.
 *
 * These tests run the REAL scripts/seed-staging.mjs as a child process against a
 * REAL Postgres carrying the REAL bootstrap schema, through a PostgREST/Auth
 * front end that reproduces the behaviours that actually broke it (see
 * tests/helpers/fake-supabase.mjs). The seeder's production guard is left
 * completely intact: it is given a genuine https://<ref>.supabase.co URL and
 * only the socket destination is rewritten, by tests/helpers/redirect-fetch.mjs.
 *
 *   ROXIUM_TEST_PG=postgresql://postgres:postgres@localhost:5432/postgres \
 *   node --test tests/integration/staging-seed.test.mjs
 *
 * SKIPPED without ROXIUM_TEST_PG or psql. CI provides a throwaway Postgres
 * service; this never touches Supabase, staging or production.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildBootstrapSql } from '../../scripts/build-staging-bootstrap.mjs';
import { plan, expectedCounts, uid, USERS, PRACTICES, NATURAL_KEYS } from '../../scripts/lib/staging-fixtures.mjs';
import { startFakeSupabase } from '../helpers/fake-supabase.mjs';

const ADMIN = process.env.ROXIUM_TEST_PG || '';
const havePsql = spawnSync('psql', ['--version']).status === 0;
const READY = Boolean(ADMIN) && havePsql;

// In CI this is a gate, not an optional extra. A skip here would report success
// for a seeder nothing had run — the same false green `continue-on-error`
// produced on the deno check.
if (process.env.CI && !READY) {
  throw new Error(
    'staging seeder tests cannot run: ' +
    `ROXIUM_TEST_PG=${ADMIN ? 'set' : 'MISSING'}, psql=${havePsql ? 'present' : 'MISSING'}. ` +
    'In CI these must run — a skip here would be a false green.',
  );
}

const ROOT = new URL('../../', import.meta.url);
const STUB = new URL('fixtures/supabase-stub.sql', new URL('../', import.meta.url)).pathname;
const SEEDER = new URL('scripts/seed-staging.mjs', ROOT).pathname;
const SHIM = new URL('tests/helpers/redirect-fetch.mjs', ROOT).pathname;

// A real staging-shaped URL. Not production: the guard's own refusal list is
// asserted by tests/unit/staging-guard.test.mjs.
const FAKE_SUPABASE_URL = 'https://stagingtestref0000.supabase.co';

const dbUrl = (name) => ADMIN.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);
const made = [];
let BOOTSTRAP = '';

function admin(sql) {
  const r = spawnSync('psql', [ADMIN, '-q', '-c', sql], { encoding: 'utf8' });
  assert.equal(r.status, 0, `admin sql failed: ${sql}\n${r.stderr}`);
}
function sql(url, text) {
  const r = spawnSync('psql', [url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', text], { encoding: 'utf8' });
  assert.equal(r.status, 0, `sql failed: ${text}\n${r.stderr}`);
  return r.stdout.trim();
}
const count = (url, table, where = '') => Number(sql(url, `select count(*) from ${table} ${where}`));

/** A fresh database carrying the real generated bootstrap. */
function freshDb() {
  const name = `roxium_seed_${randomUUID().slice(0, 8)}`;
  admin(`create database ${name}`);
  made.push(name);
  const url = dbUrl(name);
  assert.equal(spawnSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', STUB]).status, 0, 'stub failed');
  const r = spawnSync('psql', [url, '-q', '-v', 'ON_ERROR_STOP=1', '-f', BOOTSTRAP], { encoding: 'utf8' });
  assert.equal(r.status, 0, `bootstrap failed:\n${(r.stderr || '').slice(-2000)}`);
  return url;
}

/**
 * Run a script as a child process and collect its output.
 *
 * spawnSync would deadlock: the fake Supabase runs in THIS process, so blocking
 * the event loop here means the child's first request is never answered.
 */
function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, out }));
  });
}

/** Run the real seeder against a fake Supabase in front of `url`. */
async function seed(url, args = []) {
  const fake = await startFakeSupabase(url);
  try {
    const r = await runNode(['--import', SHIM, SEEDER, ...args], {
      STAGING_SUPABASE_URL: FAKE_SUPABASE_URL,
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      STAGING_FIXTURE_PASSWORD: 'staging-fixture-password',
      ROXIUM_FAKE_SUPABASE_FROM: FAKE_SUPABASE_URL,
      ROXIUM_FAKE_SUPABASE_TO: fake.origin,
    });
    return { ...r, requests: [...fake.requests] };
  } finally {
    await fake.close();
  }
}

/** Assert the database matches expectedCounts() exactly. */
function assertConverged(url) {
  const expected = expectedCounts();
  const ids = PRACTICES.map((p) => `'${uid(`practice:${p.key}`)}'`).join(',');
  const scoped = {
    practices: `where id in (${ids})`,
    deliverables: `where practice_id in (${ids})`,
    milestones: `where practice_id in (${ids})`,
    video_pipeline: `where practice_id in (${ids})`,
    kpi_monthly: `where practice_id in (${ids})`,
    platform_connections: `where practice_id in (${ids})`,
    activity: `where practice_id in (${ids})`,
    practice_invites: `where practice_id in (${ids})`,
    memberships: `where practice_id in (${ids})`,
  };
  for (const [table, where] of Object.entries(scoped)) {
    assert.equal(count(url, table, where), expected[table], `${table} did not converge`);
  }
  assert.equal(count(url, 'auth.users'), expected.auth_users, 'auth users did not converge');
  assert.equal(count(url, 'profiles'), expected.profiles, 'profiles did not converge');
  // Nothing outside the fixture set may have appeared.
  assert.equal(count(url, 'practices'), expected.practices, 'a practice outside the fixture set exists');
}

describe('staging seeder', { skip: !READY && 'ROXIUM_TEST_PG / psql not available' }, () => {
  before(() => {
    BOOTSTRAP = join(tmpdir(), `seed-bs-${randomUUID().slice(0, 8)}.sql`);
    writeFileSync(BOOTSTRAP, buildBootstrapSql().sql, 'utf8');
  });
  after(() => { for (const n of made) spawnSync('psql', [ADMIN, '-q', '-c', `drop database if exists ${n}`]); });

  // ── A · the payload rules hold against real PostgREST semantics ──────────

  test('every bulk batch is accepted — no table repeats the PGRST102 failure', async () => {
    const url = freshDb();
    const r = await seed(url);
    assert.equal(r.status, 0, `seed failed:\n${r.out}`);
    assert.doesNotMatch(r.out, /PGRST102/, 'the seeder still produced a key-shape mismatch');
    assertConverged(url);
  });

  test('the harness really does reject a mismatched batch — for every bulk table', async () => {
    // A test that cannot fail proves nothing. Drop one key from one row of each
    // batch in turn and confirm PostgREST answers PGRST102, so the test above is
    // known to be checking something real for every table, not just deliverables.
    const url = freshDb();
    const fake = await startFakeSupabase(url);
    try {
      for (const b of plan().batches) {
        if (b.rows.length < 2) continue;         // one row can never mismatch itself
        const broken = b.rows.map((r, i) => (i === 1 ? Object.fromEntries(Object.entries(r).slice(0, -1)) : r));
        const res = await fetch(`${fake.origin}/rest/v1/${b.table}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify(broken),
        });
        assert.equal(res.status, 400, `${b.table}: a mismatched batch was not rejected`);
        assert.equal((await res.json()).code, 'PGRST102', `${b.table}: wrong error code`);
      }
    } finally { await fake.close(); }
  });

  test('every declared on_conflict target is backed by a real column index', async () => {
    // PostgREST passes on_conflict straight into ON CONFLICT (…), and Postgres
    // rejects a target that does not match an index with 42P10. This is the
    // check that would have caught practice_invites, whose unique key is an
    // EXPRESSION index and so cannot be an on_conflict target at all.
    const url = freshDb();
    for (const b of plan().batches) {
      if (!b.conflict) continue;
      const cols = b.conflict.split(',').map((c) => c.trim());
      const found = sql(url, `select count(*) from pg_index i
        where i.indrelid = 'public.${b.table}'::regclass and i.indisunique
          and i.indexprs is null
          and (select array_agg(a.attname order by array_position(i.indkey, a.attnum))
               from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any(i.indkey))
              = array[${cols.map((c) => `'${c}'`).join(',')}]::name[]`);
      // At least one: kpi_monthly carries the same unique index twice, under two
      // names, from schema.sql and a later migration that re-added it. Postgres
      // is happy to infer several arbiters, so that is not this test's business —
      // what matters is that a matching index exists at all.
      assert.ok(Number(found) >= 1,
        `${b.table}: on_conflict=${b.conflict} matches no unique column index — ON CONFLICT would fail with 42P10`);
    }
  });

  test('every natural-key index named in NATURAL_KEYS exists and really is expression-based', async () => {
    // If one of these ever becomes a plain column index, the sweep is dead
    // weight and the batch should upsert on it directly. If it disappears, the
    // sweep is guarding nothing. Either way this test fails loudly.
    const url = freshDb();
    for (const [table, nk] of Object.entries(NATURAL_KEYS)) {
      const row = sql(url, `select coalesce((select 'yes:' || (i.indexprs is not null) from pg_index i
        join pg_class c on c.oid = i.indexrelid where c.relname = '${nk.index}'
          and i.indrelid = 'public.${table}'::regclass), 'missing')`);
      assert.equal(row, 'yes:true', `${table}: index ${nk.index} is ${row === 'missing' ? 'gone' : 'no longer expression-based'}`);
    }
  });

  // ── B · first run, second run ────────────────────────────────────────────

  test('a second seed converges without duplicating anything', async () => {
    const url = freshDb();
    assert.equal((await seed(url)).status, 0);
    const first = sql(url, `select id from auth.users order by email`);

    const r = await seed(url);
    assert.equal(r.status, 0, `re-run failed:\n${r.out}`);
    assertConverged(url);
    assert.equal(sql(url, `select id from auth.users order by email`), first,
      'the re-run did not reuse the existing Auth identities');
    assert.match(r.out, /8 reused/, 'the re-run reported creating users it should have reused');
  });

  test('--reset then seed converges to the same state', async () => {
    const url = freshDb();
    assert.equal((await seed(url)).status, 0);
    const r = await seed(url, ['--reset']);
    assert.equal(r.status, 0, `reset run failed:\n${r.out}`);
    assertConverged(url);
  });

  // ── C · the state staging is actually in right now ───────────────────────

  test('recovers from the exact partial state PGRST102 left behind: practices only', async () => {
    const url = freshDb();
    // Reproduce it honestly — run the practices batch and nothing else, which is
    // precisely how far Initialize STAGING #3 got.
    const fake = await startFakeSupabase(url);
    try {
      const practices = plan().batches.find((b) => b.table === 'practices');
      const res = await fetch(`${fake.origin}/rest/v1/practices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify(practices.rows),
      });
      assert.equal(res.status, 201);
    } finally { await fake.close(); }
    assert.equal(count(url, 'practices'), 4);
    assert.equal(count(url, 'deliverables'), 0);

    const r = await seed(url);
    assert.equal(r.status, 0, `recovery seed failed:\n${r.out}`);
    assertConverged(url);
  });

  test('recovers when only some Auth users exist, reusing their ids', async () => {
    const url = freshDb();
    const partial = USERS.slice(0, 3);
    for (const u of partial) {
      sql(url, `insert into auth.users (email, raw_user_meta_data) values ('${u.email}', '{}'::jsonb)`);
    }
    const before = sql(url, `select email || '=' || id from auth.users order by email`);
    assert.equal(count(url, 'auth.users'), 3);

    const r = await seed(url);
    assert.equal(r.status, 0, `partial-auth seed failed:\n${r.out}`);
    assertConverged(url);
    assert.match(r.out, /5 created, 3 reused/, `expected 5 created / 3 reused, got:\n${r.out}`);

    const after = sql(url, `select email || '=' || id from auth.users where email in (${
      partial.map((u) => `'${u.email}'`).join(',')}) order by email`);
    assert.equal(after, before, 'an existing fixture identity was replaced instead of reused');
  });

  test('a stale random-id invite is swept, not left to collide forever', async () => {
    // What an older seeder — one that let the database generate the id — leaves
    // behind. The new row has a deterministic id, so a primary-key upsert hits
    // practice_invites_practice_email_uq with 23505 and can never converge.
    const url = freshDb();
    assert.equal((await seed(url)).status, 0);
    const pid = uid('practice:brightpath');
    sql(url, `delete from practice_invites where practice_id = '${pid}'`);
    sql(url, `insert into practice_invites (practice_id, email, full_name, role, status)
              values ('${pid}', 'Invited.NewStaff@roxium.test', 'Stale', 'member', 'sent')`);
    const staleId = sql(url, `select id from practice_invites where practice_id = '${pid}'`);

    const r = await seed(url);
    assert.equal(r.status, 0, `seed did not recover from the stale invite:\n${r.out}`);
    assert.match(r.out, /swept 1 stale practice_invites row/);
    assertConverged(url);
    assert.notEqual(sql(url, `select id from practice_invites where practice_id = '${pid}'`), staleId);
  });

  // ── D · it must refuse rather than damage ────────────────────────────────

  test('refuses a target holding a practice that is not a test fixture', async () => {
    const url = freshDb();
    sql(url, `insert into practices (name) values ('Real Clinic')`);
    const r = await seed(url);
    assert.notEqual(r.status, 0, 'the seeder wrote to a target holding real-looking data');
    assert.match(r.out, /not synthetic fixtures/);
    assert.equal(count(url, 'deliverables'), 0, 'it wrote data despite refusing');
    assert.equal(count(url, 'auth.users'), 0, 'it created Auth users despite refusing');
  });

  test('refuses an unrecognised "(TEST)" practice rather than seeding around it', async () => {
    const url = freshDb();
    sql(url, `insert into practices (name) values ('Someone Elses Thing (TEST)')`);
    const r = await seed(url);
    assert.notEqual(r.status, 0, 'the seeder merged into a target it did not recognise');
    assert.match(r.out, /did not create/);
    assert.equal(count(url, 'deliverables'), 0);
  });

  test('never issues an unscoped DELETE, even with --reset', async () => {
    const url = freshDb();
    assert.equal((await seed(url)).status, 0);
    const r = await seed(url, ['--reset']);
    const deletes = r.requests.filter((q) => q.startsWith('DELETE '));
    assert.ok(deletes.length > 0, 'the reset issued no deletes at all');
    for (const d of deletes) {
      assert.match(d, /\?(practice_id|id)=in\.\(/, `unscoped delete: ${d}`);
      assert.doesNotMatch(d, /in\.\(\)/, `delete with an empty id list: ${d}`);
    }
  });

  test('the production guard still refuses the production project ref', async () => {
    // No redirect shim and no fake server: if the guard ever stopped refusing,
    // this would reach for the real production host, so it has to refuse first.
    const r = await runNode([SEEDER], {
      STAGING_SUPABASE_URL: 'https://nchtmeqsjkpcvtuscxfy.supabase.co',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      ROXIUM_FAKE_SUPABASE_FROM: '',
      ROXIUM_FAKE_SUPABASE_TO: '',
    });
    assert.notEqual(r.status, 0);
    assert.match(r.out, /REFUSED \(production-target\)/);
  });

  // ── E · the verification step must be able to fail ───────────────────────

  test('the seeder reports failure when the target does not reach the expected state', async () => {
    // Delete a row behind the seeder's back, immediately after it wrote it, by
    // giving video_pipeline a row-count the fixtures cannot satisfy. If verify()
    // could not fail, every test above would be worthless.
    const url = freshDb();
    assert.equal((await seed(url)).status, 0);
    // A trigger that silently drops one deliverable on insert: the seed writes
    // 21 and the target ends up with 20, which verify() must catch.
    sql(url, `create function drop_one() returns trigger language plpgsql as $f$
              begin if new.id = '${plan().batches.find((b) => b.table === 'deliverables').rows[0].id}'
                    then return null; end if; return new; end $f$`);
    sql(url, `delete from deliverables`);
    sql(url, `create trigger drop_one_t before insert on deliverables for each row execute function drop_one()`);

    const r = await seed(url);
    assert.notEqual(r.status, 0, 'a short seed was reported as success');
    assert.match(r.out, /did not converge to the expected fixture state/);
    assert.match(r.out, /deliverables: expected 21, found 20/);
  });
});
