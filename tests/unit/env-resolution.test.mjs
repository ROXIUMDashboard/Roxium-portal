// Unit tests for the environment resolver in config.js.
//
// This is the highest-risk new logic in the repository: if it resolves wrongly,
// a staging test could write to the production database, or a customer could be
// pointed at staging. Every branch is covered, and the assertions are written as
// safety properties ("must NOT resolve to production") rather than mechanics.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveRoxiumEnvironment, ROXIUM_ENVIRONMENTS } = require('../../config.js');

const UNSTAMPED = '__ROXIUM_BUILD_ENV__';

describe('production resolution (must keep working exactly as today)', () => {
  for (const host of ['roxium.com', 'www.roxium.com', 'roxium-portal.pages.dev']) {
    test(`${host} resolves to production`, () => {
      const r = resolveRoxiumEnvironment(host, UNSTAMPED);
      assert.equal(r.ok, true);
      assert.equal(r.name, 'production');
      assert.match(r.env.SUPABASE_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
      assert.ok(r.env.SUPABASE_ANON_KEY.startsWith('eyJ'));
    });
  }

  test('a production build served from a production host is accepted', () => {
    const r = resolveRoxiumEnvironment('roxium.com', 'production');
    assert.equal(r.ok, true);
    assert.equal(r.name, 'production');
  });
});

describe('FAIL CLOSED: never silently fall back to production', () => {
  const mustNotBeProduction = (r) => {
    assert.equal(r.ok, false, 'expected a refusal, got a resolved environment');
    assert.ok(!('name' in r) || r.name !== 'production');
  };

  test('an unknown hostname refuses rather than guessing', () => {
    const r = resolveRoxiumEnvironment('evil.example.com', UNSTAMPED);
    mustNotBeProduction(r);
    assert.equal(r.reason, 'unknown-host');
  });

  test('a staging build served from the production host refuses', () => {
    const r = resolveRoxiumEnvironment('roxium.com', 'staging');
    mustNotBeProduction(r);
    assert.equal(r.reason, 'host-mismatch');
  });

  test('a production build served from a staging host refuses', () => {
    const r = resolveRoxiumEnvironment('staging.roxium.com', 'production');
    mustNotBeProduction(r);
    assert.equal(r.reason, 'host-mismatch');
  });

  test('an unrecognised build stamp refuses', () => {
    const r = resolveRoxiumEnvironment('roxium.com', 'prod');
    mustNotBeProduction(r);
    assert.equal(r.reason, 'unknown-build-env');
  });

  test('an environment with no Supabase project configured refuses', () => {
    const r = resolveRoxiumEnvironment('staging.roxium.com', UNSTAMPED);
    mustNotBeProduction(r);
    assert.equal(r.reason, 'unconfigured');
  });

  test('every refusal carries an explanatory detail for the operator', () => {
    for (const [host, build] of [['evil.example.com', UNSTAMPED], ['roxium.com', 'staging'], ['staging.roxium.com', 'production']]) {
      const r = resolveRoxiumEnvironment(host, build);
      assert.equal(r.ok, false);
      assert.ok(r.detail && r.detail.length > 20, `missing detail for ${host}/${build}`);
    }
  });
});

describe('staging + preview hosts belong to staging, never production', () => {
  for (const host of ['staging.roxium.com', 'staging.roxium-portal.pages.dev',
                      'abc123.roxium-portal.pages.dev', 'feature-x.roxium-portal.pages.dev',
                      'localhost', '127.0.0.1']) {
    test(`${host} is claimed by staging only`, () => {
      const claimed = Object.keys(ROXIUM_ENVIRONMENTS).filter((n) => {
        const e = ROXIUM_ENVIRONMENTS[n];
        return (e.hosts || []).includes(host) || (e.hostSuffixes || []).some((s) => host.endsWith(s));
      });
      assert.deepEqual(claimed, ['staging'], `${host} should be claimed by staging alone, got [${claimed}]`);
    });
  }

  test('the production apex is NOT caught by the pages.dev preview suffix', () => {
    // roxium-portal.pages.dev must stay production; only *.roxium-portal.pages.dev is a preview.
    const r = resolveRoxiumEnvironment('roxium-portal.pages.dev', UNSTAMPED);
    assert.equal(r.ok, true);
    assert.equal(r.name, 'production');
  });
});

describe('no host is claimed by two environments', () => {
  test('host sets are disjoint', () => {
    const seen = new Map();
    for (const [name, env] of Object.entries(ROXIUM_ENVIRONMENTS)) {
      for (const h of env.hosts || []) {
        assert.ok(!seen.has(h), `host "${h}" claimed by both ${seen.get(h)} and ${name}`);
        seen.set(h, name);
      }
    }
  });
});
