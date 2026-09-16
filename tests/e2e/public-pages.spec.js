// Core regression: the pages every visitor can reach must load, serve the right
// content, and raise no fatal JavaScript errors.
const { test, expect } = require('@playwright/test');

/** Collect page errors and genuinely-fatal console errors. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Expected in the offline harness: staging has no Supabase project configured,
    // and there is no network. Those are asserted explicitly elsewhere.
    if (/environment not resolved|Failed to load resource|net::ERR|ERR_NAME_NOT_RESOLVED/i.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

test('marketing landing page loads', async ({ page }) => {
  const errors = watchErrors(page);
  const res = await page.goto('/');
  expect(res.status()).toBe(200);
  await expect(page).toHaveTitle(/ROXIUM/i);
  expect(errors, `unexpected JS errors: ${errors.join(' | ')}`).toEqual([]);
});

test('landing page has no unsubstituted build placeholder', async ({ page }) => {
  await page.goto('/');
  expect(await page.content()).not.toContain('BUILD_SHA');
});

test('privacy and terms serve themselves, not the portal', async ({ page }) => {
  for (const path of ['/privacy', '/terms']) {
    const res = await page.goto(path);
    expect(res.status(), `${path} status`).toBe(200);
    // The SPA fallback would have served the portal login instead.
    await expect(page.locator('#login'), `${path} served the portal app`).toHaveCount(0);
  }
});

test('/portal redirects to /portal/ rather than looping', async ({ page }) => {
  const res = await page.goto('/portal');
  expect(res.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe('/portal/');
});

test('critical assets load', async ({ page }) => {
  const seen = new Map();
  page.on('response', (r) => seen.set(new URL(r.url()).pathname, r.status()));
  await page.goto('/portal/');
  for (const asset of ['/app.js', '/styles.css', '/config.js']) {
    expect(seen.get(asset), `${asset} did not load`).toBe(200);
  }
});

test('version.json reports the environment the bundle was built for', async ({ request }) => {
  const res = await request.get('/version.json');
  expect(res.status()).toBe(200);
  const v = await res.json();
  expect(v.sha).toBeTruthy();
  expect(v.environment).toBe('staging'); // the local harness always builds staging
});
