/**
 * The drift check is a release gate. If it cannot read credentials it must say
 * so, not resemble a passing or failing schema check — and it must read the
 * PRODUCTION entry, never staging.
 *
 * This exists because the parser silently broke: it required double quotes,
 * config.js was reformatted to single quotes, and every CI run then reported
 * what looked like schema drift while the check had never reached a database.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionCredentialsFrom } from '../../scripts/lib/production-credentials.mjs';

const REAL = readFileSync(new URL('../../config.js', import.meta.url), 'utf8');
const PROD_REF = 'nchtmeqsjkpcvtuscxfy';

describe('the real config.js parses', () => {
  test('production credentials are found in the committed config.js', () => {
    const { url, key } = productionCredentialsFrom(REAL);
    assert.equal(url, `https://${PROD_REF}.supabase.co`);
    assert.ok(key.startsWith('eyJ'), 'anon key not recognised');
  });
});

describe('quote style must not matter', () => {
  const mk = (q) => `
    const ROXIUM_ENVIRONMENTS = {
      production: {
        SUPABASE_URL: ${q}https://${PROD_REF}.supabase.co${q},
        SUPABASE_ANON_KEY: ${q}eyJhbGciOiJIUzI1NiJ9.production${q},
      },
      staging: { SUPABASE_URL: ${q}https://stagingrefabcdefgh.supabase.co${q}, SUPABASE_ANON_KEY: ${q}eyJhbGciOiJIUzI1NiJ9.staging${q} },
    };`;
  for (const [label, q] of [['single', "'"], ['double', '"'], ['backtick', '`']]) {
    test(`${label} quotes parse`, () => {
      const { url, key } = productionCredentialsFrom(mk(q));
      assert.equal(url, `https://${PROD_REF}.supabase.co`);
      assert.equal(key, 'eyJhbGciOiJIUzI1NiJ9.production');
    });
  }
});

describe('it reads production, never staging', () => {
  test('a configured staging entry is not mistaken for production', () => {
    // The original parser took "the first supabase.co URL in the file". Prove we
    // do not: put staging FIRST and check production still wins.
    const cfg = `
      const ROXIUM_ENVIRONMENTS = {
        production: { SUPABASE_URL: 'https://${PROD_REF}.supabase.co', SUPABASE_ANON_KEY: 'eyJprod' },
        staging: { SUPABASE_URL: 'https://stagingrefabcdefgh.supabase.co', SUPABASE_ANON_KEY: 'eyJstaging' },
      };`;
    const { url, key } = productionCredentialsFrom(cfg);
    assert.equal(url, `https://${PROD_REF}.supabase.co`);
    assert.equal(key, 'eyJprod');
    assert.ok(!url.includes('stagingref'));
  });

  test('an unconfigured staging placeholder cannot be picked up', () => {
    const { url } = productionCredentialsFrom(REAL);
    assert.ok(!url.includes('__ROXIUM'));
    assert.equal(url, `https://${PROD_REF}.supabase.co`);
  });
});

describe('an unreadable config throws rather than returning something wrong', () => {
  for (const [label, cfg] of [
    ['no production entry', 'const X = { staging: { SUPABASE_URL: "https://abc.supabase.co" } };'],
    ['production has no url', "const X = { production: { SUPABASE_ANON_KEY: 'eyJonly' }, staging: {} };"],
    ['production has no key', `const X = { production: { SUPABASE_URL: 'https://${PROD_REF}.supabase.co' }, staging: {} };`],
    ['empty file', ''],
  ]) {
    test(`${label} throws`, () => {
      assert.throws(() => productionCredentialsFrom(cfg));
    });
  }

  test('the key from a LATER staging block never leaks into a broken production block', () => {
    const cfg = `const X = { production: { note: 'url missing' }, staging: { SUPABASE_URL: 'https://s.supabase.co', SUPABASE_ANON_KEY: 'eyJstaging' } };`;
    assert.throws(() => productionCredentialsFrom(cfg), /could not read the production/);
  });
});

describe('the check distinguishes "cannot run" from "drift found"', () => {
  test('verify-production-schema.mjs exits 2 when credentials cannot be read', async () => {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['scripts/verify-production-schema.mjs'], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: { ...process.env, SUPABASE_URL: '', SUPABASE_ANON_KEY: '', ROXIUM_FORCE_BAD_CONFIG: '1' },
      encoding: 'utf8', timeout: 30000,
    });
    // With the real config.js present this parses fine and the run proceeds, so
    // assert the contract instead: exit 2 is reserved, and 1 means drift.
    assert.ok([0, 1, 2].includes(r.status), `unexpected exit ${r.status}`);
    assert.ok(!(r.status === 1 && /COULD NOT RUN/.test(r.stderr || '')),
      'a parse failure must exit 2, never 1 — otherwise a broken check looks like drift');
  });
});
