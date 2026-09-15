// The guard that stands between the seed tooling and the production database.
// If this is wrong, a `npm run reset:staging` could wipe live customer data.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkStagingTarget, assertStagingTarget, projectRefFromUrl, PRODUCTION_PROJECT_REFS }
  from '../../scripts/lib/staging-guard.mjs';

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

describe('projectRefFromUrl', () => {
  test('extracts the ref', () => assert.equal(projectRefFromUrl(PROD), 'nchtmeqsjkpcvtuscxfy'));
  test('returns null for junk', () => assert.equal(projectRefFromUrl('nope'), null));
});
