// Proves, in a real browser, that the environment gate fails closed.
//
// This is the isolation guarantee the whole staging design rests on: a bundle
// must refuse to open a database connection unless it is certain which one it
// is allowed to talk to.
const { test, expect } = require('@playwright/test');

test('an unconfigured environment fails closed and opens no connection', async ({ page }) => {
  // The harness builds a STAGING bundle, and staging has no Supabase project
  // configured yet in config.js — so this is the real unconfigured path.
  const supabaseCalls = [];
  await page.route('**://*.supabase.co/**', (route) => { supabaseCalls.push(route.request().url()); route.abort(); });

  await page.goto('/portal/');
  await page.waitForLoadState('domcontentloaded');

  const state = await page.evaluate(() => ({
    env: window.ROXIUM_ENV,
    error: window.ROXIUM_ENV_ERROR ? window.ROXIUM_ENV_ERROR.reason : null,
    config: typeof CONFIG === 'undefined' ? 'undefined' : CONFIG,
  }));

  expect(state.env, 'must not resolve an environment').toBeNull();
  expect(state.error, 'must record why it refused').toBe('unconfigured');
  expect(state.config, 'CONFIG must be null so app.js cannot build a client').toBeNull();
  expect(supabaseCalls, 'no Supabase request may be attempted').toEqual([]);
});

test('the failure is explained on screen, not a blank page', async ({ page }) => {
  await page.goto('/portal/');
  await expect(page.getByRole('alert')).toContainText(/not configured/i);
  await expect(page.getByRole('alert')).toContainText(/no database connection was opened/i);
});

// NOTE: the "STAGING" badge only renders when an environment RESOLVES and is
// non-production. This harness deliberately builds an UNCONFIGURED staging bundle
// to exercise the fail-closed path, so the badge cannot appear here. It is
// asserted against the real deployment in tests/e2e/staging/tenancy.spec.js.
