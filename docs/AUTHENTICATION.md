# Authentication

ROXIUM Portal signs people in with **email + password**, using **Supabase Auth**.

There is no custom authentication anywhere in this repository. We store no
password, no password hash, and nothing derived from one. Every credential
operation is a call to Supabase Auth:

| What | Call |
|---|---|
| Sign in | `sb.auth.signInWithPassword({ email, password })` |
| Redeem an invitation or reset link | `sb.auth.verifyOtp({ token_hash, type })` |
| Set or change a password | `sb.auth.updateUser({ password })` |
| Sign out | `sb.auth.signOut()` |
| Mint a link (server side, service role) | `admin.auth.admin.generateLink(...)` |

**Authentication answers "who is this?". It grants nothing.** What a signed-in
user may see is decided exactly as before — by `profiles.role`, practice
membership, `approval_status`, and Row Level Security. None of that changed in
this pass. A brand-new account with a valid password and no membership reaches
the waiting room and no client data.

---

## Why passwords replaced magic links

The portal used to email a magic link and a one-time code. For this customer
base that failed in practice:

- Corporate mail security (Microsoft Defender Safe Links and equivalents) can
  delay delivery by ~10 minutes, by which time the **code had expired**.
- Following a link from a mail client opens **whichever browser the OS prefers**,
  not the one the user was working in.
- Scanners **pre-fetch** links. Supabase's default email links to
  `GET /auth/v1/verify`, which consumes the one-time token on first fetch — so a
  scanner could burn the link before the human ever clicked it.

Email is now only involved in account setup and recovery.

### How the remaining emails avoid the scanner problem

Both account emails are minted by an Edge Function and delivered through Resend,
and both link to **our own page with the token in the URL fragment**:

```
https://roxium.com/portal/#auth=recovery&token=<hashed_token>&t=recovery
```

Two independent properties make this survive a scanner:

1. **A fragment is never sent to a server.** A scanner fetching the URL
   transmits only `https://roxium.com/portal/`.
2. **The token is redeemed in JavaScript**, by `verifyOtp()` in
   `handleAuthCallback()`. A scanner fetches static HTML and does not run it.

This is the pattern Supabase's own community settled on for institutional mail
environments — see the references at the end.

The portal also still understands Supabase's default shapes
(`?token_hash=…&type=…` and `#access_token=…&type=recovery`, plus the
`PASSWORD_RECOVERY` event), so nothing breaks if a link is ever sent by
Supabase's built-in mailer instead.

---

## The flows

### Normal sign-in

1. Open the portal → **Sign in** card.
2. Email, password, **Sign in**.
3. In the portal. No email, no code, no link.

The session is Supabase's own: persisted in `localStorage` and refreshed in the
background. A refresh, a new tab, or navigating the portal does not ask again.
When a session genuinely expires, `onAuthStateChange` returns the user cleanly
to the Sign in card.

### Forgot password

1. **Forgot password?** → enter email → **Send reset link**.
2. The answer is always *"If an account exists for this email, we've sent
   password reset instructions."* — the same for a registered and an unregistered
   address, so the form cannot be used to discover who ROXIUM's clients are.
3. `request-password-reset` mints a recovery token and emails the fragment link.
4. The link opens **Choose a new password** → new + confirm → back into the portal.

Expired, already-used and malformed links all say so and point at
*Forgot password?*.

### New client invitation (unchanged principle: INVITE FIRST)

1. ROXIUM team (or a practice owner) invites an email address from Team Controls.
2. `invite-user` creates the auth user, the profile, the membership and the
   allowlist row — exactly as before — then emails a **Set your password** link.
3. The client sets a password and lands in their portal.
4. Every later sign-in is email + password.

**There is no public sign-up.** The portal has no sign-up form, and the login
card cannot create an account: `signInWithPassword` never creates users. Access
still requires a membership that a team member or practice owner granted.

### Existing users who have never had a password

Their accounts are **not** touched, deleted or recreated. User ids, memberships,
practice associations, roles and history all stay exactly as they are.

To establish a password on an existing account, either:

- the client uses **Forgot password?** themselves, or
- ROXIUM re-invites them from Team Controls — `invite-user` detects the existing
  account and sends a `recovery` link rather than creating anything.

Both routes end in `updateUser({ password })` against **the same auth user**.
What to tell a client: *"Set your password once — use Forgot password? on the
sign-in screen. Everything in your portal stays exactly where it is."*

---

## Password policy

`MIN_PASSWORD_LENGTH` in `app.js` is **10**, and the set-password card states
that rule before it enforces it. Supabase enforces its own minimum server-side;
set it to match so the portal never promises a rule the server does not keep:

**Dashboard ▸ Authentication ▸ Policies ▸ Minimum password length → 10**
(per project — staging and production are set separately).

`supabase/config.toml` carries the same number, but that file configures the
**local CLI only** and does not reach a hosted project.

---

## Supabase dashboard settings this depends on

Per project (production and staging are configured separately):

| Setting | Where | Required value | Why |
|---|---|---|---|
| Email provider | Authentication ▸ Providers ▸ Email | **Enabled** | `signInWithPassword` needs it |
| Confirm email | Authentication ▸ Providers ▸ Email | Either is fine | Invited users are created with `email_confirm: true`, so they are already confirmed |
| Minimum password length | Authentication ▸ Policies | **10** | match the portal |
| Site URL | Authentication ▸ URL Configuration | the portal origin | link building |
| Redirect URLs | Authentication ▸ URL Configuration | `<origin>/portal/**` | `generateLink` rejects an unlisted `redirectTo` |
| Allow new users to sign up | Authentication ▸ Providers ▸ Email | **Off** is safest | invite-first; nothing in the portal calls `signUp` either way |

Edge Function secrets, per project: `SITE_URL` (required — the links are built
from it), `RESEND_API_KEY`, `EMAIL_FROM`, and `APP_ENV=staging` on staging.

**Turning the old magic-link path off is not a setting.** It disappeared with
the UI; the Email provider stays enabled because password sign-in uses it.

---

## Provisioning a platform administrator

**Actions ▸ Provision Admin Account ▸ Run workflow** — choose the project, enter
the email, run it. Choosing `production` requests the `production` environment,
so it waits for a reviewer.

The password comes from the `ADMIN_INITIAL_PASSWORD` **secret** in that
environment, never from a workflow input (inputs are stored in run metadata in
plain text; secrets are not). `scripts/provision-admin.mjs` creates the auth user
with that password — or sets it on the existing account, keeping its id and every
membership — then ensures `profiles.role = 'team'` and verifies the result.

It refuses to run without an explicit `ROXIUM_TARGET`, and production
additionally needs `CONFIRM="PROVISION PRODUCTION ADMIN"`.

> Change an initial password after the first sign-in, from **Forgot password?**.
> An initial password that has been shared over chat or email should be treated
> as already disclosed.

---

## Testing

| Layer | File |
|---|---|
| Login UI, errors, session, recovery, URL parsing | `tests/e2e/auth-password.spec.js` (32 tests, no backend) |
| Email-link security properties | `tests/unit/auth-email-links.test.mjs` (22 tests) |
| Authorization regression against real staging | `tests/e2e/staging/tenancy.spec.js` |

The staging suite needs `STAGING_FIXTURE_PASSWORD` — the same secret the seeder
applies to the synthetic fixture accounts. Password auth is what makes those
tests possible at all: they were unreachable while sign-in needed an emailed code.

---

## References

Patterns taken from, rather than invented:

- [Supabase — Password-based Auth](https://supabase.com/docs/guides/auth/passwords) — `signInWithPassword`, `resetPasswordForEmail`, `PASSWORD_RECOVERY`, and the rule that `updateUser()` requires a session first.
- [Supabase — `resetPasswordForEmail` reference](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail) — reset link then `updateUser()`; the method only sends the mail.
- [supabase/auth#1214 — Magic links invalidated by corporate link scanning](https://github.com/supabase/auth/issues/1214) and [supabase discussion #41618](https://github.com/orgs/supabase/discussions/41618) — the fragment + `token_hash`/`verifyOtp` mitigation this implements.
- [Supabase — Email templates](https://supabase.com/docs/guides/auth/auth-email-templates) — `{{ .TokenHash }}`, the supported way to build a link the app redeems itself.

No authentication framework or dependency was added. The portal still has no
build step and no runtime dependencies beyond supabase-js.
