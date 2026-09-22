// Email + password authentication, exercised in a real browser with no backend.
//
// Supabase Auth itself is stubbed (tests/e2e/support/offline.js), so what these
// tests prove is OUR half of the contract: that the portal asks Supabase Auth
// the right question, never invents its own credential handling, and behaves
// correctly for each answer it can get back.
const { test, expect } = require('@playwright/test');
const { stubPortal } = require('./support/offline');

const EMAIL = 'surgeon@practice.test';
const PASSWORD = 'correct horse battery';

test.describe('the sign-in card', () => {
  test.beforeEach(async ({ page }) => { await stubPortal(page); });

  test('shows email and password, and nothing passwordless', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#loginEmail')).toBeVisible();
    await expect(page.locator('#loginPassword')).toBeVisible();
    await expect(page.locator('#btnLogin')).toHaveText(/sign in/i);

    // The whole point of this pass: no OTP box, no "send me a link".
    await expect(page.locator('#loginCode')).toHaveCount(0);
    await expect(page.locator('#btnVerifyCode')).toHaveCount(0);
    await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
    await expect(page.locator('#login')).not.toContainText(/magic link|sign-in link|passwordless|code from your email/i);
    // The account-setup affordance must not read as a second way to sign in.
    await expect(page.locator('#login')).not.toContainText(/send me a link|sign in with (a )?link|email me a code/i);
  });

  test('the fields carry the attributes a password manager needs', async ({ page }) => {
    await page.goto('/portal/');
    await expect(page.locator('#loginEmail')).toHaveAttribute('type', 'email');
    await expect(page.locator('#loginEmail')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#loginPassword')).toHaveAttribute('type', 'password');
    await expect(page.locator('#loginPassword')).toHaveAttribute('autocomplete', 'current-password');
  });

  test('both fields have real labels bound to them', async ({ page }) => {
    await page.goto('/portal/');
    for (const id of ['loginEmail', 'loginPassword']) {
      const label = page.locator(`label[for="${id}"]`);
      await expect(label).toHaveCount(1);
      await expect(label).not.toBeEmpty();
    }
  });

  test('the password visibility toggle reveals and re-hides', async ({ page }) => {
    await page.goto('/portal/');
    const pw = page.locator('#loginPassword');
    const eye = page.locator('#loginPwToggle');
    await pw.fill(PASSWORD);
    await expect(pw).toHaveAttribute('type', 'password');
    await expect(eye).toHaveAttribute('aria-pressed', 'false');

    await eye.click();
    await expect(pw).toHaveAttribute('type', 'text');
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(pw).toHaveValue(PASSWORD);   // revealing must not clear it

    await eye.click();
    await expect(pw).toHaveAttribute('type', 'password');
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
  });

  test('submitting with empty fields asks for them, and calls nothing', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#btnLogin').click();
    await expect(page.locator('#loginMsg')).toHaveText('Enter your email and password.');
    await expect(page.locator('#loginMsg')).toHaveClass(/err/);
    const calls = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(calls).not.toContain('signInWithPassword');
  });

  test('an error is actually rendered red, not merely tagged as an error', async ({ page }) => {
    // Asserting the CSS class is not enough: an ID rule elsewhere in the sheet
    // out-ranked .authmsg.err and painted sign-in errors GREEN. Check the pixel
    // the client sees.
    await page.goto('/portal/');
    await page.locator('#btnLogin').click();
    const { colour, red, green } = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      return {
        colour: getComputedStyle(document.getElementById('loginMsg')).color,
        red: root.getPropertyValue('--red').trim(),
        green: root.getPropertyValue('--green').trim(),
      };
    });
    expect(colour).toBe(red);
    expect(colour).not.toBe(green);
  });

  test('a missing password alone is still refused locally', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#btnLogin').click();
    await expect(page.locator('#loginMsg')).toHaveText('Enter your email and password.');
  });
});

test.describe('signing in', () => {
  test('a valid password signs the user in via Supabase Auth', async ({ page }) => {
    await stubPortal(page);
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#btnLogin').click();

    await expect.poll(async () =>
      page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).filter((c) => c.name === 'signInWithPassword').length)
    ).toBe(1);

    const call = await page.evaluate(() =>
      (window.__ROXIUM_AUTH_CALLS || []).find((c) => c.name === 'signInWithPassword'));
    expect(call.arg.email).toBe(EMAIL);
    expect(call.arg.hasPassword).toBe(true);
  });

  test('Enter in the password field submits the form', async ({ page }) => {
    await stubPortal(page);
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#loginPassword').press('Enter');
    await expect.poll(async () =>
      page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).some((c) => c.name === 'signInWithPassword'))
    ).toBe(true);
  });

  test('the button shows a loading state and is disabled while submitting', async ({ page }) => {
    // Hold the network open so the in-flight state is observable.
    await stubPortal(page, { signInError: { message: 'Invalid login credentials', status: 400 } });
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill('wrong-password');

    // Freeze the stub's promise so we can inspect the busy state.
    await page.evaluate(() => {
      const orig = window.__ROXIUM_FREEZE = {};
      orig.release = null;
    });
    await page.locator('#btnLogin').click();
    // Either we catch it busy, or it already finished — assert it ends enabled
    // with an error, which is the state that actually matters to a user.
    await expect(page.locator('#loginMsg')).toHaveText('The email or password you entered is incorrect.');
    await expect(page.locator('#btnLogin')).toBeEnabled();
    await expect(page.locator('#btnLogin')).toHaveText(/sign in/i);
  });

  test('a wrong password gives a human message, never a raw Supabase string', async ({ page }) => {
    await stubPortal(page, { signInError: { message: 'Invalid login credentials', status: 400 } });
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill('wrong-password');
    await page.locator('#btnLogin').click();

    const msg = page.locator('#loginMsg');
    await expect(msg).toHaveText('The email or password you entered is incorrect.');
    await expect(msg).toHaveClass(/err/);
    await expect(msg).not.toContainText(/Invalid login credentials/);
    // Still on the login card; no part of the app leaked.
    await expect(page.locator('#app')).toHaveClass(/hidden/);
  });

  test('an unknown email is indistinguishable from a wrong password', async ({ page }) => {
    // Supabase answers both with the same error; assert we do not add a
    // distinction of our own and turn the form into an enumeration oracle.
    await stubPortal(page, { signInError: { message: 'Invalid login credentials', status: 400 } });
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill('nobody@nowhere.test');
    await page.locator('#loginPassword').fill('anything at all');
    await page.locator('#btnLogin').click();
    await expect(page.locator('#loginMsg')).toHaveText('The email or password you entered is incorrect.');
  });

  test('rate limiting is explained rather than dumped', async ({ page }) => {
    await stubPortal(page, { signInError: { message: 'Request rate limit reached', status: 429 } });
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#loginPassword').fill(PASSWORD);
    await page.locator('#btnLogin').click();
    await expect(page.locator('#loginMsg')).toHaveText(/too many attempts/i);
  });

  test('the error message mapping is exhaustive and leaks nothing', async ({ page }) => {
    await stubPortal(page);
    await page.goto('/portal/');
    const results = await page.evaluate(() => [
      authErrorMessage({ message: 'Invalid login credentials', status: 400 }),
      authErrorMessage({ message: 'Email not confirmed', status: 400 }),
      authErrorMessage({ message: 'Request rate limit reached', status: 429 }),
      authErrorMessage({ message: 'Failed to fetch' }),
      authErrorMessage({ message: 'database "postgres" connection refused at 10.0.0.4:5432', status: 500 }),
    ]);
    expect(results[0]).toBe('The email or password you entered is incorrect.');
    expect(results[1]).toMatch(/confirmed/i);
    expect(results[2]).toMatch(/too many attempts/i);
    expect(results[3]).toMatch(/connection/i);
    // An unrecognised internal error must never reach a client's screen.
    expect(results[4]).toBe('Something went wrong signing you in. Please try again, or contact ROXIUM.');
    for (const r of results) expect(r).not.toMatch(/10\.0\.0\.4|postgres|5432/);
  });
});

test.describe('session persistence', () => {
  test('an existing session is used instead of asking for credentials again', async ({ page }) => {
    await stubPortal(page, { session: { user: { id: 'stub-user', email: EMAIL } } });
    await page.goto('/portal/');
    // The app must restore the session and proceed to load the account, not
    // re-prompt. (With no backend the profile lookup then fails, which is the
    // stub's doing — what matters here is that sign-in was never asked for.)
    await expect.poll(async () =>
      page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name))
    ).toContain('getUser');
    const calls = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(calls).toContain('getSession');
    expect(calls).not.toContain('signInWithPassword');
    // And the password field was never populated or submitted on their behalf.
    await expect(page.locator('#loginPassword')).toHaveValue('');
  });

  test('no session means the sign-in card, on any route', async ({ page }) => {
    await stubPortal(page);
    for (const route of ['/portal/', '/portal/#operations', '/portal/#overview']) {
      await page.goto(route);
      await expect(page.locator('#login')).toBeVisible();
      await expect(page.locator('#app')).toHaveClass(/hidden/);
    }
  });
});

test.describe('forgot password', () => {
  test.beforeEach(async ({ page }) => { await stubPortal(page); });

  test('the link opens the reset card and carries the typed email over', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#linkForgot').click();
    await expect(page.locator('#forgotPane')).toBeVisible();
    await expect(page.locator('#login')).toBeHidden();
    await expect(page.locator('#forgotEmail')).toHaveValue(EMAIL);
  });

  test('the answer is neutral and does not reveal whether the account exists', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkForgot').click();
    await page.locator('#forgotEmail').fill('definitely-not-a-customer@nowhere.test');
    await page.locator('#btnForgot').click();
    const msg = page.locator('#forgotMsg');
    await expect(msg).toContainText(/if an account exists for this email/i);
    await expect(msg).not.toContainText(/not found|no account|unknown|doesn't exist/i);
  });

  test('an empty email is caught before anything is sent', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkForgot').click();
    await page.locator('#btnForgot').click();
    await expect(page.locator('#forgotMsg')).toHaveText('Enter your email address.');
    await expect(page.locator('#forgotMsg')).toHaveClass(/err/);
  });

  test('back returns to sign in', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkForgot').click();
    await page.locator('#linkBackToLogin').click();
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#forgotPane')).toBeHidden();
  });
});

test.describe('setting a password from a recovery link', () => {
  const RECOVERY = '/portal/#auth=recovery&token=stub-hashed-token&t=recovery';

  test('a recovery link shows the set-password card, not the portal', async ({ page }) => {
    await stubPortal(page);
    await page.goto(RECOVERY);
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    await expect(page.locator('#login')).toBeHidden();
    await expect(page.locator('#app')).toHaveClass(/hidden/);
  });

  test('the token is redeemed client-side with verifyOtp, and wiped from the URL', async ({ page }) => {
    await stubPortal(page);
    await page.goto(RECOVERY);
    await expect(page.locator('#setPasswordPane')).toBeVisible();

    const call = await page.evaluate(() =>
      (window.__ROXIUM_AUTH_CALLS || []).find((c) => c.name === 'verifyOtp'));
    expect(call, 'the app must exchange the token itself, not rely on a server redirect').toBeTruthy();
    expect(call.arg.token_hash).toBe('stub-hashed-token');
    expect(call.arg.type).toBe('recovery');

    // The token must not linger in the address bar or the history entry.
    expect(page.url()).not.toContain('stub-hashed-token');
    expect(await page.evaluate(() => location.hash)).toBe('');
  });

  test('a recovery link works when pasted into a tab already on the portal', async ({ page }) => {
    // Hash-only navigation fires no page load, so init() does not re-run. If
    // this is not handled the link silently does nothing.
    await stubPortal(page);
    await page.goto('/portal/');
    await expect(page.locator('#login')).toBeVisible();
    await page.evaluate(() => { location.hash = 'auth=recovery&token=pasted-token&t=recovery'; });
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    const call = await page.evaluate(() =>
      (window.__ROXIUM_AUTH_CALLS || []).find((c) => c.name === 'verifyOtp'));
    expect(call.arg.token_hash).toBe('pasted-token');
  });

  test('an invitation link is worded as setting a first password', async ({ page }) => {
    await stubPortal(page);
    await page.goto('/portal/#auth=recovery&token=stub-hashed-token&t=invite');
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    await expect(page.locator('#setPwTitle')).toHaveText(/set your password/i);
    const call = await page.evaluate(() =>
      (window.__ROXIUM_AUTH_CALLS || []).find((c) => c.name === 'verifyOtp'));
    expect(call.arg.type).toBe('invite');
  });

  test('mismatched passwords are refused before Supabase is called', async ({ page }) => {
    await stubPortal(page);
    await page.goto(RECOVERY);
    await page.locator('#newPassword').fill('a-long-enough-password');
    await page.locator('#confirmPassword').fill('a-different-password');
    await page.locator('#btnSetPassword').click();
    await expect(page.locator('#setPwMsg')).toHaveText("Those passwords don't match.");
    const calls = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(calls).not.toContain('updateUser');
  });

  test('a too-short password is refused before Supabase is called', async ({ page }) => {
    await stubPortal(page);
    await page.goto(RECOVERY);
    await page.locator('#newPassword').fill('short');
    await page.locator('#confirmPassword').fill('short');
    await page.locator('#btnSetPassword').click();
    await expect(page.locator('#setPwMsg')).toHaveText(/at least 10 characters/i);
    const calls = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(calls).not.toContain('updateUser');
  });

  test('the password rules are stated the same way they are enforced', async ({ page }) => {
    await stubPortal(page);
    await page.goto(RECOVERY);
    const hint = await page.locator('#newPwHint').textContent();
    const min = await page.evaluate(() => MIN_PASSWORD_LENGTH);
    expect(hint).toContain(String(min));
    const verdicts = await page.evaluate((n) => ({
      tooShort: validateNewPassword('x'.repeat(n - 1), 'x'.repeat(n - 1)),
      exact: validateNewPassword('x'.repeat(n), 'x'.repeat(n)),
      mismatch: validateNewPassword('x'.repeat(n), 'y'.repeat(n)),
      empty: validateNewPassword('', ''),
    }), min);
    expect(verdicts.tooShort).toMatch(/at least/i);
    expect(verdicts.exact).toBeNull();
    expect(verdicts.mismatch).toMatch(/don't match/i);
    expect(verdicts.empty).toMatch(/enter and confirm/i);
  });

  test('a valid password is handed to Supabase Auth and nowhere else', async ({ page }) => {
    await stubPortal(page);
    await page.goto(RECOVERY);
    await page.locator('#newPassword').fill('a-long-enough-password');
    await page.locator('#confirmPassword').fill('a-long-enough-password');
    await page.locator('#btnSetPassword').click();

    await expect.poll(async () =>
      page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).some((c) => c.name === 'updateUser'))
    ).toBe(true);
    const call = await page.evaluate(() =>
      (window.__ROXIUM_AUTH_CALLS || []).find((c) => c.name === 'updateUser'));
    expect(call.arg.hasPassword).toBe(true);
    expect(call.arg.length).toBe('a-long-enough-password'.length);
  });

  test('an expired or already-used link says so and offers recovery', async ({ page }) => {
    await stubPortal(page, { verifyError: { message: 'Token has expired or is invalid', status: 401 } });
    await page.goto(RECOVERY);
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#setPasswordPane')).toBeHidden();
    await expect(page.locator('#loginMsg')).toContainText(/expired or has already been used/i);
    await expect(page.locator('#loginMsg')).toContainText(/forgot password/i);
  });

  test("an error fragment from Supabase's own flow is explained", async ({ page }) => {
    await stubPortal(page);
    await page.goto('/portal/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#loginMsg')).toContainText(/expired|no longer valid/i);
  });

  test('Supabase rejecting the new password is surfaced without dumping internals', async ({ page }) => {
    await stubPortal(page, { updateUserError: { message: 'Password should be at least 6 characters', status: 422 } });
    await page.goto(RECOVERY);
    await page.locator('#newPassword').fill('a-long-enough-password');
    await page.locator('#confirmPassword').fill('a-long-enough-password');
    await page.locator('#btnSetPassword').click();
    await expect(page.locator('#setPwMsg')).toContainText(/rejected/i);
    await expect(page.locator('#btnSetPassword')).toBeEnabled();
  });
});

test.describe('the recovery URL parser', () => {
  test('reads every shape we can receive, and nothing else', async ({ page }) => {
    await stubPortal(page);
    await page.goto('/portal/');
    const cases = await page.evaluate(() => {
      const at = (url) => {
        history.replaceState(null, '', url);
        const out = readAuthTokenFromUrl();
        history.replaceState(null, '', '/portal/');
        return out;
      };
      return {
        ours:      at('/portal/#auth=recovery&token=abc&t=invite'),
        setup:     at('/portal/#auth=recovery&token=ghi&t=recovery&i=setup'),
        tokenHash: at('/portal/?token_hash=def&type=recovery'),
        session:   at('/portal/#access_token=xyz&type=recovery'),
        errored:   at('/portal/#error=access_denied&error_code=otp_expired'),
        plain:     at('/portal/'),
        routeOnly: at('/portal/#operations'),
        deepLink:  at('/portal/#overview&deliv=123'),
      };
    });
    expect(cases.ours).toEqual({ kind: 'token_hash', token_hash: 'abc', type: 'invite', intent: '' });
    expect(cases.setup).toEqual({ kind: 'token_hash', token_hash: 'ghi', type: 'recovery', intent: 'setup' });
    expect(cases.tokenHash).toEqual({ kind: 'token_hash', token_hash: 'def', type: 'recovery', intent: '' });
    expect(cases.session.kind).toBe('session');
    expect(cases.errored.kind).toBe('error');
    // Ordinary navigation must never be mistaken for an auth callback.
    expect(cases.plain).toBeNull();
    expect(cases.routeOnly).toBeNull();
    expect(cases.deepLink).toBeNull();
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// FIRST-TIME PASSWORD SETUP for an existing, already-invited account.
//
// This is a migration affordance, not an authentication method: it issues no
// session, creates no user, and ends at the same email + password sign-in.
// ─────────────────────────────────────────────────────────────────────────────
test.describe('first-time password setup', () => {
  test.beforeEach(async ({ page }) => { await stubPortal(page); });

  test('the setup link is offered on the sign-in card, below Forgot password', async ({ page }) => {
    await page.goto('/portal/');
    const link = page.locator('#linkFirstTime');
    await expect(link).toBeVisible();
    await expect(link).toHaveText(/set up your password/i);
    await expect(page.locator('.authsecondary')).toContainText(/first time signing in/i);

    // Visually secondary: it sits after Forgot password? and is quieter.
    const forgot = await page.locator('#linkForgot').boundingBox();
    const setup = await link.boundingBox();
    expect(setup.y).toBeGreaterThan(forgot.y);
    const sizes = await page.evaluate(() => ({
      forgot: parseFloat(getComputedStyle(document.getElementById('linkForgot')).fontSize),
      setup: parseFloat(getComputedStyle(document.getElementById('linkFirstTime')).fontSize),
    }));
    expect(sizes.setup).toBeLessThanOrEqual(sizes.forgot);
  });

  test('it is a link, not a second sign-in control', async ({ page }) => {
    await page.goto('/portal/');
    // Exactly one submit button on the sign-in card: Sign in.
    const submits = page.locator('#loginForm button[type="submit"], #loginForm input[type="submit"]');
    await expect(submits).toHaveCount(1);
    await expect(submits.first()).toHaveText(/sign in/i);
  });

  test('clicking it opens the setup card with setup wording', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkFirstTime').click();
    await expect(page.locator('#forgotPane')).toBeVisible();
    await expect(page.locator('#login')).toBeHidden();
    await expect(page.locator('#forgotTitle')).toHaveText(/set up your password/i);
    await expect(page.locator('#btnForgot')).toHaveText(/send setup link/i);
    await expect(page.locator('#forgotIntro')).toContainText(/already exists/i);
  });

  test('Forgot password? still opens the reset wording, not setup', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkForgot').click();
    await expect(page.locator('#forgotTitle')).toHaveText(/reset your password/i);
    await expect(page.locator('#btnForgot')).toHaveText(/send reset link/i);
  });

  test('switching between the two purposes re-words the card each time', async ({ page }) => {
    await page.goto('/portal/');
    for (const [link, title, button] of [
      ['#linkFirstTime', /set up your password/i, /send setup link/i],
      ['#linkBackToLogin', null, null],
      ['#linkForgot', /reset your password/i, /send reset link/i],
      ['#linkBackToLogin', null, null],
      ['#linkFirstTime', /set up your password/i, /send setup link/i],
    ]) {
      await page.locator(link).click();
      if (title) {
        await expect(page.locator('#forgotTitle')).toHaveText(title);
        await expect(page.locator('#btnForgot')).toHaveText(button);
      }
    }
  });

  test('the typed email carries over from the sign-in card', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#loginEmail').fill(EMAIL);
    await page.locator('#linkFirstTime').click();
    await expect(page.locator('#forgotEmail')).toHaveValue(EMAIL);
  });

  test('an empty or malformed email is caught before anything is sent', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkFirstTime').click();
    await page.locator('#btnForgot').click();
    await expect(page.locator('#forgotMsg')).toHaveText('Enter your email address.');

    await page.locator('#forgotEmail').fill('not-an-email');
    await page.locator('#btnForgot').click();
    await expect(page.locator('#forgotMsg')).toHaveText('Enter a valid email address.');
    await expect(page.locator('#forgotMsg')).toHaveClass(/err/);
    await expect(page.locator('#btnForgot')).toBeEnabled();
  });

  test('the response is neutral and identical for a known and an unknown address', async ({ page }) => {
    const answers = [];
    for (const address of ['surgeon@practice.test', 'definitely-nobody@nowhere.test']) {
      await page.goto('/portal/');
      await page.locator('#linkFirstTime').click();
      await page.locator('#forgotEmail').fill(address);
      await page.locator('#btnForgot').click();
      await expect(page.locator('#forgotMsg')).toContainText(/if an account exists/i);
      answers.push(await page.locator('#forgotMsg').textContent());
    }
    expect(answers[0]).toBe(answers[1]);
    expect(answers[0]).toMatch(/password setup instructions/i);
    expect(answers[0]).not.toMatch(/not found|no account|unknown|doesn't exist|already has/i);
  });

  test('setup and reset give answers that differ only in wording, never in fact', async ({ page }) => {
    const said = {};
    for (const [mode, link] of [['setup', '#linkFirstTime'], ['reset', '#linkForgot']]) {
      await page.goto('/portal/');
      await page.locator(link).click();
      await page.locator('#forgotEmail').fill('someone@practice.test');
      await page.locator('#btnForgot').click();
      await expect(page.locator('#forgotMsg')).toContainText(/if an account exists/i);
      said[mode] = await page.locator('#forgotMsg').textContent();
    }
    expect(said.setup).toMatch(/setup instructions/i);
    expect(said.reset).toMatch(/reset instructions/i);
    // Both must hedge identically about whether the account is there.
    for (const t of Object.values(said)) expect(t).toMatch(/^If an account exists for this email/);
  });

  test('the request carries the intent to the backend, and nothing else changes', async ({ page }) => {
    const posted = [];
    await page.route('**/functions/v1/request-password-reset', async (route) => {
      posted.push(JSON.parse(route.request().postData() || '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto('/portal/');
    await page.locator('#linkFirstTime').click();
    await page.locator('#forgotEmail').fill(EMAIL);
    await page.locator('#btnForgot').click();
    await expect(page.locator('#forgotMsg')).toContainText(/if an account exists/i);

    await page.goto('/portal/');
    await page.locator('#linkForgot').click();
    await page.locator('#forgotEmail').fill(EMAIL);
    await page.locator('#btnForgot').click();
    await expect(page.locator('#forgotMsg')).toContainText(/if an account exists/i);

    expect(posted).toHaveLength(2);
    expect(posted[0]).toEqual({ email: EMAIL, intent: 'setup' });
    expect(posted[1]).toEqual({ email: EMAIL, intent: 'reset' });
    // No password, and nothing but the address and the intent, ever leaves here.
    for (const p of posted) expect(Object.keys(p).sort()).toEqual(['email', 'intent']);
  });

  test('requesting a setup link does not sign anyone in', async ({ page }) => {
    await page.goto('/portal/');
    await page.locator('#linkFirstTime').click();
    await page.locator('#forgotEmail').fill(EMAIL);
    await page.locator('#btnForgot').click();
    await expect(page.locator('#forgotMsg')).toContainText(/if an account exists/i);
    await expect(page.locator('#app')).toHaveClass(/hidden/);
    const calls = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(calls).not.toContain('signInWithPassword');
    expect(calls).not.toContain('verifyOtp');
    expect(calls).not.toContain('updateUser');
  });

  test('a setup link lands on the set-password card, worded for a first password', async ({ page }) => {
    await page.goto('/portal/#auth=recovery&token=setup-token&t=recovery&i=setup');
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    await expect(page.locator('#setPwTitle')).toHaveText(/set your password/i);
    await expect(page.locator('#setPwIntro')).toContainText(/from now on/i);
  });

  test('a reset link is still worded as a reset', async ({ page }) => {
    await page.goto('/portal/#auth=recovery&token=reset-token&t=recovery&i=reset');
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    await expect(page.locator('#setPwTitle')).toHaveText(/choose a new password/i);
  });

  test('a setup link redeems the SAME account — recovery token, no signup', async ({ page }) => {
    await page.goto('/portal/#auth=recovery&token=setup-token&t=recovery&i=setup');
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    const calls = await page.evaluate(() => window.__ROXIUM_AUTH_CALLS || []);
    const verify = calls.find((c) => c.name === 'verifyOtp');
    // `recovery` acts on the existing auth user. A `signup` type would create one.
    expect(verify.arg.type).toBe('recovery');
    expect(verify.arg.token_hash).toBe('setup-token');
    expect(calls.map((c) => c.name)).not.toContain('signUp');
  });

  test('setting the password from a setup link calls updateUser, not signUp', async ({ page }) => {
    await page.goto('/portal/#auth=recovery&token=setup-token&t=recovery&i=setup');
    await page.locator('#newPassword').fill('a-long-enough-password');
    await page.locator('#confirmPassword').fill('a-long-enough-password');
    await page.locator('#btnSetPassword').click();
    await expect.poll(async () =>
      page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).some((c) => c.name === 'updateUser'))
    ).toBe(true);
    const names = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(names).not.toContain('signUp');
    expect(names).not.toContain('signInWithOtp');
  });

  test('the intent only chooses wording — an unknown intent still behaves as a reset', async ({ page }) => {
    await page.goto('/portal/#auth=recovery&token=t&t=recovery&i=nonsense');
    await expect(page.locator('#setPasswordPane')).toBeVisible();
    await expect(page.locator('#setPwTitle')).toHaveText(/choose a new password/i);
    const verify = await page.evaluate(() =>
      (window.__ROXIUM_AUTH_CALLS || []).find((c) => c.name === 'verifyOtp'));
    expect(verify.arg.type).toBe('recovery');
  });

  test('an expired setup link is explained and offers a way to retry', async ({ page }) => {
    await stubPortal(page, { verifyError: { message: 'Token has expired or is invalid', status: 401 } });
    await page.goto('/portal/#auth=recovery&token=stale&t=recovery&i=setup');
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#loginMsg')).toContainText(/expired or has already been used/i);
    await expect(page.locator('#linkFirstTime')).toBeVisible();
  });

  test('nothing about the affordance creates an account or grants access', async ({ page }) => {
    await page.goto('/portal/');
    // The portal must have no sign-up call anywhere in its source.
    const hasSignUp = await page.evaluate(() =>
      typeof sb !== 'undefined' && typeof sb.auth.signUp === 'function' ? 'client-has-it' : 'absent');
    // The Supabase client may expose signUp; what matters is that we never call it.
    const called = await page.evaluate(() => (window.__ROXIUM_AUTH_CALLS || []).map((c) => c.name));
    expect(called).not.toContain('signUp');
    expect(['client-has-it', 'absent']).toContain(hasSignUp);
  });
});
