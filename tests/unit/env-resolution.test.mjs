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
  for (const host of ['roxiumstudio.com', 'www.roxiumstudio.com',
                      'roxium.com', 'www.roxium.com', 'roxium-portal.pages.dev']) {
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
    // Exercise the branch deterministically by blanking the entry for the
    // duration of the test, so this keeps passing once staging is configured.
    const saved = ROXIUM_ENVIRONMENTS.staging.SUPABASE_URL;
    ROXIUM_ENVIRONMENTS.staging.SUPABASE_URL = '';
    try {
      const r = resolveRoxiumEnvironment('staging.roxium.com', UNSTAMPED);
      mustNotBeProduction(r);
      assert.equal(r.reason, 'unconfigured');
    } finally {
      ROXIUM_ENVIRONMENTS.staging.SUPABASE_URL = saved;
    }
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

describe('once staging IS configured, it must still never be production', () => {
  const configured = Boolean(ROXIUM_ENVIRONMENTS.staging.SUPABASE_URL
    && ROXIUM_ENVIRONMENTS.staging.SUPABASE_ANON_KEY);

  test('staging resolves to staging, and to a different project than production', (t) => {
    if (!configured) return t.skip('staging not configured yet (expected before go-live)');
    const r = resolveRoxiumEnvironment('staging.roxium.com', 'staging');
    assert.equal(r.ok, true);
    assert.equal(r.name, 'staging');
    assert.notEqual(r.env.SUPABASE_URL, ROXIUM_ENVIRONMENTS.production.SUPABASE_URL,
      'STAGING IS POINTING AT THE PRODUCTION PROJECT');
    assert.notEqual(r.env.SUPABASE_ANON_KEY, ROXIUM_ENVIRONMENTS.production.SUPABASE_ANON_KEY,
      'staging is using the production anon key');
  });

  test('a configured staging never leaks onto a production host', (t) => {
    if (!configured) return t.skip('staging not configured yet');
    assert.equal(resolveRoxiumEnvironment('roxium.com', 'staging').ok, false);
  });
});


// ---------------------------------------------------------------------------
// The live portal host.
//
// This exists because of a real, armed outage: config.js listed only roxium.com
// as production, while the portal serves from roxiumstudio.com. A
// production-stamped build fails the host cross-check on a host the environment
// does not claim and REFUSES TO BOOT — so the next release would have taken the
// portal down for every customer, with a fail-closed message.
//
// It had not fired only because production was last deployed before the
// cross-check existed. These assertions keep the registry and the real host in
// step.
// ---------------------------------------------------------------------------
describe('the live portal host resolves to production', () => {
  for (const host of ['roxiumstudio.com', 'www.roxiumstudio.com']) {
    test(`a production build served from ${host} boots`, () => {
      const r = resolveRoxiumEnvironment(host, 'production');
      assert.equal(r.ok, true, `${host} would REFUSE TO BOOT: ${r.reason} — ${r.detail}`);
      assert.equal(r.name, 'production');
    });

    test(`${host} resolves to production without a build stamp too`, () => {
      const r = resolveRoxiumEnvironment(host, UNSTAMPED);
      assert.equal(r.ok, true, `${host}: ${r.reason}`);
      assert.equal(r.name, 'production');
    });

    test(`a STAGING build refuses to run on ${host}`, () => {
      // The protection that matters in the other direction: staging code must
      // never serve real customers from the live portal host.
      const r = resolveRoxiumEnvironment(host, 'staging');
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'host-mismatch');
    });
  }

  test('the corporate domain still resolves, so traffic there is not refused', () => {
    assert.equal(resolveRoxiumEnvironment('roxium.com', 'production').ok, true);
  });

  test('a lookalike of the portal host is still refused', () => {
    for (const host of ['roxiumstudio.com.evil.test', 'notroxiumstudio.com', 'roxiumstudio.co']) {
      const r = resolveRoxiumEnvironment(host, 'production');
      assert.equal(r.ok, false, `${host} must not be treated as production`);
    }
  });
});

describe('config.js and the staging guard agree on what production is', () => {
  test('every production host in config.js is in PRODUCTION_HOSTS', async () => {
    // Two lists naming the same thing drift. PRODUCTION_HOSTS has no consumer
    // today, which is exactly how it went stale; this keeps it honest.
    const { PRODUCTION_HOSTS } = await import('../../scripts/lib/staging-guard.mjs');
    for (const h of ROXIUM_ENVIRONMENTS.production.hosts) {
      assert.ok(PRODUCTION_HOSTS.includes(h), `${h} is production in config.js but missing from PRODUCTION_HOSTS`);
    }
  });

  test('no staging host is claimed as production', () => {
    for (const h of ROXIUM_ENVIRONMENTS.staging.hosts.filter(Boolean)) {
      assert.ok(!ROXIUM_ENVIRONMENTS.production.hosts.includes(h), `${h} is claimed by both environments`);
    }
  });
});
