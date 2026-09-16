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

// ─────────────────────────────────────────────────────────────────────────────
// AUTHORIZATION REGRESSION.
//
// These were unreachable while login depended on an emailed code. With email +
// password a test can sign in as a real fixture account, so the membership
// boundary is now provable end to end rather than asserted in a comment.
//
// Requires STAGING_FIXTURE_PASSWORD — the same secret the seeder applies to the
// fixture accounts. Never a real customer password, never a production project.
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURE_PASSWORD = process.env.STAGING_FIXTURE_PASSWORD;

async function signIn(page, email) {
  await page.goto(`${BASE}/portal/`);
  await page.locator('#loginEmail').fill(email);
  await page.locator('#loginPassword').fill(FIXTURE_PASSWORD);
  await page.locator('#btnLogin').click();
  // Either the app shell or the waiting room — both mean authentication worked.
  await expect(page.locator('#app, #pendingPane').first()).toBeVisible({ timeout: 20000 });
}

test.describe('signed-in journeys', () => {
  test.beforeEach(() => {
    test.skip(!FIXTURE_PASSWORD, 'STAGING_FIXTURE_PASSWORD not set — fixture sign-in unavailable');
  });

  test('a client signs in with email and password, with no email round trip', async ({ page }) => {
    await signIn(page, CLIENT_A);
    await expect(page.locator('#app')).toBeVisible();
    // No code was ever requested, and no OTP control exists to request one.
    await expect(page.locator('#loginCode')).toHaveCount(0);
  });

  test('client A sees only practice A', async ({ page }) => {
    await signIn(page, CLIENT_A);
    await expect(page.locator('#app')).toBeVisible();
    const seen = await page.evaluate(() => (typeof data === 'undefined' ? null : data?.practice?.name || null));
    expect(seen, 'client A resolved no practice').toBeTruthy();
    // A client must not be offered anyone else's practice.
    const options = await page.locator('#practiceSwitcher option').allTextContents().catch(() => []);
    expect(options.filter((o) => o && !o.includes(seen))).toEqual([]);
  });

  test('client A cannot reach practice B by URL', async ({ page }) => {
    await signIn(page, CLIENT_A);
    const mine = await page.evaluate(() => (typeof practiceId === 'undefined' ? null : practiceId));
    expect(mine).toBeTruthy();
    // Ask PostgREST directly with client A's own session: RLS, not the UI, is
    // what must refuse. Any row returned here is a tenant-isolation failure.
    const leaked = await page.evaluate(async (myId) => {
      const { data } = await sb.from('practices').select('id,name').neq('id', myId);
      return data || [];
    }, mine);
    expect(leaked, 'client A could read another practice').toEqual([]);
  });

  test('a client is refused the team-only RPCs', async ({ page }) => {
    await signIn(page, CLIENT_A);
    const outcome = await page.evaluate(async () => {
      const { data, error } = await sb.rpc('get_pending_accounts');
      return { rows: (data || []).length, error: error ? error.message : null };
    });
    expect(outcome.rows, 'a client read the pending-accounts queue').toBe(0);
  });

  test('the team fixture can open the Operations dashboard', async ({ page }) => {
    await signIn(page, TEAM);
    await expect(page.locator('#app')).toBeVisible();
    const role = await page.evaluate(() => (typeof me === 'undefined' ? null : me?.role));
    expect(role).toBe('team');
    await page.goto(`${BASE}/portal/#operations`);
    await expect(page.locator('#sbOpsGroup')).toBeVisible();
  });

  test('sign-out returns to the sign-in card and clears the session', async ({ page }) => {
    await signIn(page, CLIENT_A);
    await expect(page.locator('#app')).toBeVisible();
    await page.locator('#btnLogout').click();
    await expect(page.locator('#login')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#app')).toHaveClass(/hidden/);
    // Reloading must not resurrect the session.
    await page.goto(`${BASE}/portal/`);
    await expect(page.locator('#login')).toBeVisible();
  });

  test('a session survives a reload without asking for the password again', async ({ page }) => {
    await signIn(page, CLIENT_A);
    await expect(page.locator('#app')).toBeVisible();
    await page.reload();
    await expect(page.locator('#app')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('#login')).toBeHidden();
  });

  test('a wrong password is refused', async ({ page }) => {
    await page.goto(`${BASE}/portal/`);
    await page.locator('#loginEmail').fill(CLIENT_A);
    await page.locator('#loginPassword').fill('definitely-not-the-password');
    await page.locator('#btnLogin').click();
    await expect(page.locator('#loginMsg')).toHaveText('The email or password you entered is incorrect.');
    await expect(page.locator('#app')).toHaveClass(/hidden/);
  });

  test('an unapproved account reaches no client data', async ({ page }) => {
    const pending = process.env.STAGING_PENDING_EMAIL;
    test.skip(!pending, 'STAGING_PENDING_EMAIL not set');
    await signIn(page, pending);
    await expect(page.locator('#pendingPane')).toBeVisible();
    await expect(page.locator('#app')).toHaveClass(/hidden/);
    const rows = await page.evaluate(async () => {
      const { data } = await sb.from('deliverables').select('id');
      return (data || []).length;
    });
    expect(rows, 'an unapproved account read client data').toBe(0);
  });
});

test.fixme('Needs Attention renders the seeded overdue and at-risk scenarios', async () => {});
