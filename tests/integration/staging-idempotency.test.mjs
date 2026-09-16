/**
 * Initialize STAGING must be safe to run twice.
 *
 * Initialize STAGING #2 failed against a perfectly healthy database with
 * "cannot change return type of existing function ... delete_practice(uuid)".
 * The bootstrap is schema.sql plus the whole migration history, and that
 * history is NOT replayable: delete_practice changes its return type
 * (void -> jsonb) partway through, so replaying the older definition over the
 * newer one is refused by Postgres.
 *
 * These tests run against a REAL Postgres, applying the REAL generated
 * bootstrap, and assert the property that matters: an already-initialized
 * database is recognised and the history is never replayed over it.
 *
 *   ROXIUM_TEST_PG=postgresql://postgres:postgres@localhost:5432/postgres \
 *   node --test tests/integration/staging-idempotency.test.mjs
 *
 * SKIPPED without ROXIUM_TEST_PG or psql. CI provides a throwaway Postgres
 * service; this never touches Supabase, staging or production.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildBootstrapSql, hoistSecurityHelpers } from '../../scripts/build-staging-bootstrap.mjs';
import { classify } from '../../scripts/lib/staging-state.mjs';

const ADMIN = process.env.ROXIUM_TEST_PG || '';
const havePsql = spawnSync('psql', ['--version']).status === 0;
const READY = Boolean(ADMIN) && havePsql;

// In CI this is a gate, not an optional extra. Skipping when the database is
// missing would make the job green without having checked anything — the same
// shape of false green that `continue-on-error` produced on the deno check.
if (process.env.CI && !READY) {
  throw new Error(
    'staging idempotency tests cannot run: ' +
    `ROXIUM_TEST_PG=${ADMIN ? 'set' : 'MISSING'}, psql=${havePsql ? 'present' : 'MISSING'}. ` +
    'In CI these must run — a skip here would be a false green.',
  );
}

const ROOT = new URL('../../', import.meta.url);
const STUB = new URL('fixtures/supabase-stub.sql', new URL('../', import.meta.url)).pathname;
const STATE_SQL = new URL('scripts/staging-state.sql', ROOT).pathname;

const dbUrl = (name) => ADMIN.replace(/\/[^/?]*(\?|$)/, `/${name}$1`);

function psql(url, args) {
  return spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8' });
}
function admin(sql) {
  const r = spawnSync('psql', [ADMIN, '-q', '-c', sql], { encoding: 'utf8' });
  assert.equal(r.status, 0, `admin sql failed: ${sql}\n${r.stderr}`);
}
/** Run staging-state.sql and classify, exactly as the init script does. */
function stateOf(url) {
  const r = spawnSync('psql', [url, '-tA', '-f', STATE_SQL], { encoding: 'utf8' });
  assert.equal(r.status, 0, `state query failed:\n${r.stderr}`);
  return { ...classify(r.stdout), raw: r.stdout.trim() };
}

let BOOTSTRAP = '';
const made = [];
function freshDb() {
  const name = `roxium_idem_${randomUUID().slice(0, 8)}`;
  admin(`create database ${name}`);
  made.push(name);
  const url = dbUrl(name);
  assert.equal(psql(url, ['-f', STUB]).status, 0, 'supabase stub failed to apply');
  return url;
}

describe('Initialize STAGING idempotency', { skip: !READY && 'ROXIUM_TEST_PG / psql not available' }, () => {
  before(() => {
    BOOTSTRAP = join(tmpdir(), `bs-${randomUUID().slice(0, 8)}.sql`);
    writeFileSync(BOOTSTRAP, buildBootstrapSql().sql, 'utf8');
  });
  after(() => { for (const n of made) spawnSync('psql', [ADMIN, '-q', '-c', `drop database if exists ${n}`]); });

  test('an empty database classifies as NEW', () => {
    const url = freshDb();
    const s = stateOf(url);
    assert.equal(s.state, 'NEW', s.raw);
  });

  test('RUN 1: the bootstrap applies to an empty database', () => {
    const url = freshDb();
    const r = psql(url, ['-f', BOOTSTRAP]);
    assert.equal(r.status, 0, `first apply failed:\n${r.stderr.slice(-2000)}`);
    const s = stateOf(url);
    assert.equal(s.state, 'INITIALIZED', s.raw);
    assert.match(s.raw, /core_tables=10\/10/);
    assert.match(s.raw, /rls_off=0/);
    assert.match(s.raw, /latest_markers=5\/5/);
  });

  test('RUN 2: the same database is recognised as INITIALIZED, so the history is never replayed', () => {
    const url = freshDb();
    assert.equal(psql(url, ['-f', BOOTSTRAP]).status, 0);
    // This is the decision the init script makes on a second run.
    const s = stateOf(url);
    assert.equal(s.state, 'INITIALIZED', `a second run must skip the bootstrap, got ${s.state}: ${s.raw}`);
    assert.deepEqual(s.reasons, []);
  });

  test('the replay hazard is real — replaying WOULD fail, which is why we skip', () => {
    // If this ever starts passing, the history has become replayable and the
    // skip is merely an optimisation rather than a necessity. Either way the
    // skip stays correct; this test documents which world we are in.
    const url = freshDb();
    assert.equal(psql(url, ['-f', BOOTSTRAP]).status, 0);
    const again = psql(url, ['-f', BOOTSTRAP]);
    assert.notEqual(again.status, 0, 'expected the replay to fail');
    assert.match(again.stderr, /cannot change return type of existing function/i);
  });

  test('a replay that is allowed to continue does not REVERT the schema', () => {
    // Reassurance about the failure mode: the errors abort, they do not corrupt.
    const once = freshDb();
    const twice = freshDb();
    assert.equal(psql(once, ['-f', BOOTSTRAP]).status, 0);
    assert.equal(psql(twice, ['-f', BOOTSTRAP]).status, 0);
    const tolerant = BOOTSTRAP + '.tolerant';
    writeFileSync(tolerant, readFileSync(BOOTSTRAP, 'utf8').replace('\\set ON_ERROR_STOP on', '\\set ON_ERROR_STOP off'));
    spawnSync('psql', [twice, '-q', '-f', tolerant], { encoding: 'utf8' });
    const dump = (u) => spawnSync('pg_dump', ['--schema-only', '--no-owner', '--no-acl', '-d', u], { encoding: 'utf8' })
      .stdout.split('\n').filter((l) => l && !l.startsWith('--') && !/^\\(un)?restrict /.test(l)).join('\n');
    assert.equal(dump(twice), dump(once), 'a replay changed the schema');
  });

  test('PARTIAL: a baseline-only database is refused, not bootstrapped over', () => {
    // schema.sql without the migrations. Naive "does practices exist" detection
    // would call this INITIALIZED and skip 43 migrations.
    const url = freshDb();
    const baseline = join(tmpdir(), `base-${randomUUID().slice(0, 8)}.sql`);
    writeFileSync(baseline, hoistSecurityHelpers(readFileSync(new URL('schema.sql', ROOT), 'utf8')), 'utf8');
    assert.equal(psql(url, ['-f', baseline]).status, 0, 'baseline failed to apply');
    const s = stateOf(url);
    assert.equal(s.state, 'PARTIAL', `baseline-only must be PARTIAL, got ${s.state}: ${s.raw}`);
    assert.ok(s.reasons.length > 0);
    assert.match(s.raw, /core_tables=10\/10/, 'core tables alone are not enough to call it initialized');
    assert.ok(!/latest_markers=5\/5/.test(s.raw), 'the latest-migration markers are what expose it');
  });

  test('PARTIAL: a database missing one late migration is refused', () => {
    const url = freshDb();
    assert.equal(psql(url, ['-f', BOOTSTRAP]).status, 0);
    // Undo exactly one late marker.
    spawnSync('psql', [url, '-q', '-c', 'alter table practices drop column archived_at'], { encoding: 'utf8' });
    const s = stateOf(url);
    assert.equal(s.state, 'PARTIAL', s.raw);
    assert.match(s.reasons.join(' '), /latest-migration markers 4\/5/);
  });

  test('PARTIAL: a table with RLS switched off is refused', () => {
    const url = freshDb();
    assert.equal(psql(url, ['-f', BOOTSTRAP]).status, 0);
    spawnSync('psql', [url, '-q', '-c', 'alter table activity disable row level security'], { encoding: 'utf8' });
    const s = stateOf(url);
    assert.equal(s.state, 'PARTIAL', s.raw);
    assert.match(s.reasons.join(' '), /RLS disabled/);
  });
});
