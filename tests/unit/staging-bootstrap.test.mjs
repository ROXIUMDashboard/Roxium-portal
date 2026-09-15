/**
 * The generated bootstrap is the only thing that ever runs DDL against a fresh
 * staging database, so these tests assert the properties the safety argument
 * depends on: the right files, in the right order, with the ordering bug in
 * schema.sql corrected and the diagnostic migration left out.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXCLUDED, bootstrapFiles, buildBootstrapSql, hoistSecurityHelpers } from '../../scripts/build-staging-bootstrap.mjs';

const files = bootstrapFiles();
const { sql, digest } = buildBootstrapSql();

describe('bootstrap file selection', () => {
  test('schema.sql is first — every migration assumes the baseline exists', () => {
    assert.equal(files[0], 'schema.sql');
  });

  test('migrations follow in filename (chronological) order', () => {
    const migrations = files.slice(1);
    assert.deepEqual(migrations, [...migrations].sort());
    assert.ok(migrations.length > 30, `expected the full migration history, got ${migrations.length}`);
  });

  test('the diagnostic migration is excluded', () => {
    assert.ok(EXCLUDED['2026-06-22_diagnose_demo_kpi.sql'], 'the diagnostic must be on the exclusion list');
    assert.ok(!files.includes('2026-06-22_diagnose_demo_kpi.sql'));
    assert.ok(!sql.includes('diagnose_demo_kpi'), 'its contents must not reach the bundle either');
  });

  test('every selected file is represented in the output', () => {
    for (const f of files) assert.ok(sql.includes(f), `${f} is missing from the bundle`);
  });
});

describe('schema.sql ordering bug is corrected in the bundle, not in the file', () => {
  // schema.sql:259 uses is_team() in a policy but defines it at line 304. Applied
  // top-to-bottom to an empty database that fails with "function is_team() does
  // not exist". The generator hoists the helpers; schema.sql stays byte-identical
  // to Part B of 2026-07-07_catchup_reconcile.sql, which the safety argument needs.
  const lineOf = (needle, text) => text.slice(0, text.indexOf(needle)).split('\n').length;

  test('the source file still has the bug (so this test fails loudly if someone "fixes" it)', () => {
    const raw = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    assert.ok(lineOf('create policy "team sheet sources"', raw) < lineOf('create or replace function is_team()', raw));
  });

  test('in the bundle every helper is defined before the first policy', () => {
    const firstPolicy = sql.indexOf('\ncreate policy ');
    assert.ok(firstPolicy > 0);
    for (const fn of ['is_team', 'my_practice', 'is_member_of', 'is_practice_owner', 'can_invite_to_practice']) {
      const def = sql.indexOf(`create or replace function ${fn}(`);
      assert.ok(def > 0, `${fn} is not defined in the bundle at all`);
      assert.ok(def < firstPolicy, `${fn} is defined after the first CREATE POLICY — an empty-database apply would fail`);
    }
  });

  test('hoisting moves the block rather than duplicating or dropping it', () => {
    const raw = readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8');
    const hoisted = hoistSecurityHelpers(raw);
    const count = (t, n) => t.split(n).length - 1;
    for (const fn of ['is_team', 'my_practice', 'is_member_of', 'is_practice_owner', 'can_invite_to_practice']) {
      assert.equal(count(hoisted, `create or replace function ${fn}(`), count(raw, `create or replace function ${fn}(`),
        `${fn} was duplicated or lost by the hoist`);
    }
    // Same statements, just reordered: no SQL was invented or deleted. Strip the
    // banner the generator adds, then compare the two files line-multiset.
    const lines = (t) => t.split('\n').filter((l) => !l.startsWith('-- \u2500\u2500 hoisted by') && !l.startsWith('-- \u2500\u2500 the policies below')).filter((l) => l.trim() !== '').sort();
    assert.deepEqual(lines(hoisted), lines(raw), 'the hoist added or removed SQL rather than only moving it');
  });

  test('it refuses to emit a bundle if the helper block moves', () => {
    assert.throws(() => hoistSecurityHelpers('create table t();\ncreate policy p on t;'), /could not locate/i);
  });
});

describe('the bundle is deterministic', () => {
  test('two builds are byte-identical', () => {
    assert.equal(buildBootstrapSql().sql, sql);
  });
  test('it carries a content digest so a build can be traced', () => {
    assert.match(digest, /^[0-9a-f]{16}$/);
    assert.ok(sql.includes(`sha256:${digest}`));
  });
  test('the header warns against running it on production', () => {
    assert.match(sql.slice(0, 800), /never run against production/i);
  });
});
