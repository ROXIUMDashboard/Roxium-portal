// The guard that stands between the seed tooling and the production database.
// If this is wrong, a `npm run reset:staging` could wipe live customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkStagingTarget, assertStagingTarget, projectRefFromUrl, PRODUCTION_PROJECT_REFS,
  checkStagingDbUrl, assertStagingDbUrl, projectRefFromDbUrl,
  assertAppEnvStaging, assertConfirmation,
} from '../../scripts/lib/staging-guard.mjs';

const PROD = 'https://nchtmeqsjkpcvtuscxfy.supabase.co';
const STAGING = 'https://abcdefghijklmnop.supabase.co';

describe('production is refused, unconditionally', () => {
  test('the production URL is refused', () => {
    const r = checkStagingTarget(PROD);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'production-target');
  });

  test('assertStagingTarget throws on production', () => {
    assert.throws(() => assertStagingTarget(PROD), /REFUSED \(production-target\)/);
  });

  test('case and trailing slash do not sneak production through', () => {
    for (const v of [PROD + '/', PROD.toUpperCase(), 'https://NCHTMEQSJKPCVTUSCXFY.supabase.co']) {
      assert.equal(checkStagingTarget(v).ok, false, `allowed ${v}`);
    }
  });

  test('the production ref list is not empty (guard cannot be vacuous)', () => {
    assert.ok(PRODUCTION_PROJECT_REFS.length > 0);
  });
});

describe('deny by default', () => {
  for (const [label, value] of [['empty', ''], ['undefined', undefined], ['null', null],
                                ['not a url', 'staging'], ['wrong host', 'https://evil.example.com'],
                                ['http not https', 'http://abc.supabase.co']]) {
    test(`${label} is refused`, () => {
      assert.equal(checkStagingTarget(value).ok, false);
    });
  }
});

describe('a legitimate staging target is allowed', () => {
  test('a non-production supabase project passes', () => {
    const r = checkStagingTarget(STAGING);
    assert.equal(r.ok, true);
    assert.equal(r.ref, 'abcdefghijklmnop');
  });

  test('an allowlist further narrows the target', () => {
    assert.equal(checkStagingTarget(STAGING, { allowRefs: ['abcdefghijklmnop'] }).ok, true);
    const r = checkStagingTarget(STAGING, { allowRefs: ['someotherref'] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-allowlisted');
  });
});

describe('lookalike hosts are not Supabase projects', () => {
  // A prefix match would read `https://<ref>.supabase.co.evil.test` as project
  // <ref>. The hostname must END at .supabase.co, so these must all be refused.
  for (const url of [
    'https://abcdefghijklmnop.supabase.co.evil.test',
    'https://abcdefghijklmnop.supabase.co.evil.test/rest/v1',
    'https://evil.test/abcdefghijklmnop.supabase.co',
    'https://abcdefghijklmnop.supabase.com',
  ]) {
    test(`refuses ${url}`, () => {
      assert.equal(checkStagingTarget(url).ok, false);
      assert.equal(projectRefFromUrl(url), null);
    });
  }
});

describe('projectRefFromUrl', () => {
  test('extracts the ref', () => assert.equal(projectRefFromUrl(PROD), 'nchtmeqsjkpcvtuscxfy'));
  test('returns null for junk', () => assert.equal(projectRefFromUrl('nope'), null));
});


// ---------------------------------------------------------------------------
// The database-URL guards. These stand in front of DDL, not just data, so a
// miss here is worse than a miss above: it would run the empty-database
// bootstrap against a database that has evolved past it.
// ---------------------------------------------------------------------------
const PROD_REF = PRODUCTION_PROJECT_REFS[0];
const DB_PROD_DIRECT = `postgresql://postgres:pw@db.${PROD_REF}.supabase.co:5432/postgres`;
const DB_PROD_POOLER = `postgresql://postgres.${PROD_REF}:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`;
const DB_STAGING_DIRECT = 'postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres';
const DB_STAGING_POOLER = 'postgresql://postgres.abcdefghijklmnop:pw@aws-0-eu-west-2.pooler.supabase.com:6543/postgres';

describe('checkStagingDbUrl refuses production in every connection-string shape', () => {
  for (const [label, url] of [['direct', DB_PROD_DIRECT], ['pooler', DB_PROD_POOLER]]) {
    test(`the production ${label} connection string is refused`, () => {
      const r = checkStagingDbUrl(url);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'production-target');
    });
  }

  test('the production ref is caught even in an unfamiliar shape', () => {
    // Belt-and-braces substring check: a shape we do not parse must still refuse.
    const r = checkStagingDbUrl(`postgresql://user:pw@proxy.internal/${PROD_REF}`);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'production-target');
  });

  test('assertStagingDbUrl throws rather than returning', () => {
    assert.throws(() => assertStagingDbUrl(DB_PROD_DIRECT), /REFUSED \(production-target\)/);
    assert.throws(() => assertStagingDbUrl(DB_PROD_POOLER), /REFUSED \(production-target\)/);
  });
});

describe('checkStagingDbUrl denies by default', () => {
  for (const [label, value, reason] of [
    ['an empty string', '', 'missing-db-url'],
    ['undefined', undefined, 'missing-db-url'],
    ['whitespace', '   ', 'missing-db-url'],
    ['a non-postgres url', 'https://abcdefghijklmnop.supabase.co', 'not-a-postgres-url'],
    ['a postgres url with no identifiable ref', 'postgresql://postgres:pw@10.0.0.5:5432/postgres', 'unrecognised-db-url'],
    ['a lookalike host', 'postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co.evil.test:5432/postgres', 'unrecognised-db-url'],
  ]) {
    test(`${label} is refused (${reason})`, () => {
      const r = checkStagingDbUrl(value);
      assert.equal(r.ok, false, `expected a refusal for ${label}`);
      assert.equal(r.reason, reason);
    });
  }
});

describe('checkStagingDbUrl allows a genuine staging database', () => {
  test('direct connection', () => {
    assert.deepEqual(checkStagingDbUrl(DB_STAGING_DIRECT), { ok: true, ref: 'abcdefghijklmnop' });
  });
  test('pooler connection', () => {
    assert.deepEqual(checkStagingDbUrl(DB_STAGING_POOLER), { ok: true, ref: 'abcdefghijklmnop' });
  });
  test('projectRefFromDbUrl agrees with projectRefFromUrl for the same project', () => {
    assert.equal(projectRefFromDbUrl(DB_STAGING_DIRECT), projectRefFromUrl(STAGING));
  });
  test('projectRefFromDbUrl returns null for junk', () => {
    assert.equal(projectRefFromDbUrl('nope'), null);
  });
});

describe('assertAppEnvStaging', () => {
  test('accepts exactly "staging", case-insensitively, with surrounding space', () => {
    for (const v of ['staging', 'STAGING', ' staging ']) {
      assert.doesNotThrow(() => assertAppEnvStaging(v));
    }
  });
  for (const v of ['production', 'prod', 'stagingx', '', undefined, null, 'dev']) {
    test(`refuses ${JSON.stringify(v)}`, () => {
      assert.throws(() => assertAppEnvStaging(v), /REFUSED \(app-env\)/);
    });
  }
});

describe('assertConfirmation is an exact match', () => {
  test('the exact phrase passes', () => {
    assert.doesNotThrow(() => assertConfirmation('INITIALIZE STAGING', 'INITIALIZE STAGING'));
  });
  for (const v of ['initialize staging', 'INITIALIZE  STAGING', 'INITIALIZE STAGING ', 'yes', '', undefined]) {
    test(`refuses ${JSON.stringify(v)}`, () => {
      assert.throws(() => assertConfirmation(v, 'INITIALIZE STAGING'), /REFUSED \(confirmation\)/);
    });
  }
  test('the reset phrase is distinct from the initialize phrase', () => {
    assert.throws(() => assertConfirmation('INITIALIZE STAGING', 'RESET STAGING DATA'), /REFUSED \(confirmation\)/);
  });
});
