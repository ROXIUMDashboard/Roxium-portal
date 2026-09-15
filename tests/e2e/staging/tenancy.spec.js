// Tenant isolation against a REAL seeded staging environment.
//
// Skipped unless STAGING_BASE_URL is set, so CI stays green before staging exists.
// These assertions are the reason staging exists: they cannot be proven offline.
const { test, expect } = require('@playwright/test');

const BASE = process.env.STAGING_BASE_URL;
const CLIENT_A = process.env.STAGING_CLIENT_A_EMAIL;
const CLIENT_B = process.env.STAGING_CLIENT_B_EMAIL;
const TEAM = process.env.STAGING_TEAM_EMAIL;

test.skip(!BASE, 'STAGING_BASE_URL not set — staging environment not configured yet');
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  test.skip(!CLIENT_A || !CLIENT_B || !TEAM, 'staging fixture accounts not configured');
  await page.goto(`${BASE}/portal/`);
});

test('the staging deployment is unmistakably staging', async ({ page }) => {
  await expect(page.locator('#roxiumEnvBadge')).toHaveText('STAGING');
  const v = await (await page.request.get(`${BASE}/version.json`)).json();
  expect(v.environment).toBe('staging');
});

test('staging never points at the production database', async ({ page }) => {
  const url = await page.evaluate(() => (typeof CONFIG === 'undefined' ? null : CONFIG.SUPABASE_URL));
  expect(url, 'staging resolved no backend').toBeTruthy();
  expect(url, 'STAGING IS POINTING AT PRODUCTION').not.toContain('nchtmeqsjkpcvtuscxfy');
});

// The remaining journeys need the seeded fixtures and the staging test-OTP path.
// They are written here as the acceptance target for the staging bring-up.
test.fixme('client A sees only practice A', async () => {});
test.fixme('client A cannot reach practice B by URL', async () => {});
test.fixme('team fixture can open the Operations dashboard', async () => {});
test.fixme('Needs Attention renders the seeded overdue and at-risk scenarios', async () => {});
test.fixme('sign-out returns to the login card', async () => {});
