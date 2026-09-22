// Unauthenticated access control, exercised in a real browser with NO backend.
//
// The portal's CDN libraries, config.js and every backend call are stubbed by
// tests/e2e/support/offline.js, so the real app.js boots and we can assert the
// security-relevant behaviour — a visitor with no session sees the login card
// and no client data — without a live project or any credentials.
const { test, expect } = require('@playwright/test');
const { stubPortal } = require('./support/offline');

test.beforeEach(async ({ page }) => { await stubPortal(page); });

test('a visitor with no session sees the login card', async ({ page }) => {
  await page.goto('/portal/');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#loginEmail')).toBeVisible();
  await expect(page.locator('#btnLogin')).toBeVisible();
});

test('a visitor with no session is shown no client application data', async ({ page }) => {
  await page.goto('/portal/');
  await expect(page.locator('#login')).toBeVisible();
  // The whole authenticated shell must stay hidden.
  await expect(page.locator('#app')).toHaveClass(/hidden/);
  for (const id of ['#sidebar', '#practiceSwitcher']) {
    const visible = await page.locator(id).isVisible().catch(() => false);
    expect(visible, `${id} must not be visible to a logged-out visitor`).toBeFalsy();
  }
});

test('deep-linking to a team route does not reveal the operations dashboard', async ({ page }) => {
  await page.goto('/portal/#operations');
  await expect(page.locator('#login')).toBeVisible();
  await expect(page.locator('#app')).toHaveClass(/hidden/);
});

test('the portal is marked noindex so it cannot be crawled', async ({ page }) => {
  await page.goto('/portal/');
  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  expect(robots).toMatch(/noindex/i);
});
