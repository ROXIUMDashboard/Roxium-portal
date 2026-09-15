// Proves, in a real browser, that the environment gate fails closed.
//
// This is the isolation guarantee the whole staging design rests on: a bundle
// must refuse to open a database connection unless it is certain which one it
// is allowed to talk to.
//
// These tests exercise the REAL config.js, re-stamped on the fly, so they are
// independent of whether the staging project has been configured yet. That
// matters: configuring staging must not turn its own pipeline red.
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

/** Serve the real built config.js with its build stamp replaced. */
async function serveConfigStampedAs(page, stamp) {
  const real = readFileSync(join(__dirname, '..', '..', 'site', 'config.js'), 'utf8');
  const body = real.replace(/ROXIUM_BUILD_ENV = '[^']*'/, `ROXIUM_BUILD_ENV = '${stamp}'`);
  await page.route(/\/config\.js(\?|$)/, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body }));
}

test('an unresolvable environment opens no connection at all', async ({ page }) => {
  const supabaseCalls = [];
  await page.route('**://*.supabase.co/**', (route) => { supabaseCalls.push(route.request().url()); route.abort(); });
  await serveConfigStampedAs(page, 'definitely-not-an-environment');

  await page.goto('/portal/');
  await page.waitForLoadState('domcontentloaded');

  const state = await page.evaluate(() => ({
    env: window.ROXIUM_ENV,
    reason: window.ROXIUM_ENV_ERROR ? window.ROXIUM_ENV_ERROR.reason : null,
    config: typeof CONFIG === 'undefined' ? 'undefined' : CONFIG,
  }));

  expect(state.env, 'must not resolve an environment').toBeNull();
  expect(state.reason).toBe('unknown-build-env');
  expect(state.config, 'CONFIG must be null so app.js cannot build a client').toBeNull();
  expect(supabaseCalls, 'no Supabase request may be attempted').toEqual([]);
});

test('a production bundle served from a non-production host refuses', async ({ page }) => {
  const supabaseCalls = [];
  await page.route('**://*.supabase.co/**', (route) => { supabaseCalls.push(route.request().url()); route.abort(); });
  // The harness serves from 127.0.0.1, which production does not claim.
  await serveConfigStampedAs(page, 'production');

  await page.goto('/portal/');
  await page.waitForLoadState('domcontentloaded');

  const state = await page.evaluate(() => ({
    env: window.ROXIUM_ENV,
    reason: window.ROXIUM_ENV_ERROR ? window.ROXIUM_ENV_ERROR.reason : null,
  }));

  expect(state.env).toBeNull();
  expect(state.reason, 'a production bundle on the wrong host must refuse').toBe('host-mismatch');
  expect(supabaseCalls, 'no Supabase request may be attempted').toEqual([]);
});

test('the failure is explained on screen, not a blank page', async ({ page }) => {
  await serveConfigStampedAs(page, 'definitely-not-an-environment');
  await page.goto('/portal/');
  await expect(page.getByRole('alert')).toContainText(/not configured/i);
  await expect(page.getByRole('alert')).toContainText(/no database connection was opened/i);
});

test('the shipped bundle never points a non-production host at the production project', async ({ page }) => {
  // Whatever state staging is in, resolving on this host must not yield production.
  await page.goto('/portal/');
  await page.waitForLoadState('domcontentloaded');
  const url = await page.evaluate(() => (typeof CONFIG === 'undefined' || !CONFIG ? null : CONFIG.SUPABASE_URL));
  if (url !== null) {
    expect(url, 'a non-production host resolved to the PRODUCTION project').not.toContain('nchtmeqsjkpcvtuscxfy');
  }
});

// NOTE: the "STAGING" badge only renders when an environment RESOLVES and is
// non-production, so it cannot be asserted here while staging may be
// unconfigured. It is asserted against the real deployment in
// tests/e2e/staging/tenancy.spec.js.
