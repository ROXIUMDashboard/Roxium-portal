// Mobile sanity. Not a visual-regression suite — it asserts the page is usable
// and does not scroll sideways, which is the failure mode that actually ships.
const { test, expect } = require('@playwright/test');
const { stubPortal } = require('./support/offline');

test('landing page has no horizontal overflow on a phone', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `page scrolls ${overflow}px sideways`).toBeLessThanOrEqual(1);
});

test('portal login is usable on a phone', async ({ page }) => {
  await stubPortal(page);
  await page.goto('/portal/');
  await expect(page.locator('#loginEmail')).toBeVisible();
  const box = await page.locator('#login .login-card').boundingBox();
  expect(box.width).toBeLessThanOrEqual(page.viewportSize().width);
});
