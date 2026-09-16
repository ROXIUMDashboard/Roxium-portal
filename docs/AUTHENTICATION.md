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
https://roxiumstudio.com/portal/#auth=recovery&token=<hashed_token>&t=recovery
```

Two independent properties make this survive a scanner:

1. **A fragment is never sent to a server.** A scanner fetching the URL
   transmits only `https://roxiumstudio.com/portal/`.
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

### First-time setup for an existing account

The sign-in card carries a quiet second line beneath *Forgot password?*:

> First time signing in? **Set up your password**

This is **not a second way to sign in**. It issues no session, creates no user
and grants nothing. It exists for one situation: an account that ROXIUM already
created — from the magic-link era, or an invitation whose email was lost — and
that has never had a password.

1. **Set up your password** → enter the email → **Send setup link**.
2. Neutral answer: *"If an account exists for this email, we've sent password
   setup instructions."*
3. The email leads to the same set-password card, worded for a first password.
4. From then on: email + password, like everyone else.

Because it means production rollout does **not** depend on clients acting on an
email before the new login ships, this is what makes the migration self-service.

#### Why it is safe

It mints a **`recovery` token against the existing auth user** — the identical
mechanism as *Forgot password?*. That is exactly why identity survives:

| Preserved | How |
|---|---|
| auth user id | `generateLink({type:'recovery'})` resolves an existing user; it cannot create one |
| profile, role | never written by this path |
| memberships, practice assignments | never written by this path |
| history | every row keys off the unchanged user id |

`request-password-reset` **never calls `createUser` or `signUp`, and performs no
database write at all** — asserted in `tests/unit/auth-email-links.test.mjs`. An
address with no account receives no email, and the caller cannot tell.

A password by itself still grants nothing: the account reaches the waiting room
unless it has a membership a team member or practice owner granted.

### The distinction between the two

Same secure mechanism, different question being asked:

| | Forgot password? | First time signing in? |
|---|---|---|
| The user is saying | "I had a password and forgot it." | "I have an account but have never had a password." |
| Card heading | Reset your password | Set up your password |
| Button | Send reset link | Send setup link |
| Email subject | Set a new ROXIUM portal password | Set up your ROXIUM portal password |
| Confirmation | …password **reset** instructions | …password **setup** instructions |
| Token | `recovery` | `recovery` |

The `intent` travels as `&i=setup` inside the link fragment and **chooses wording
only**. An unrecognised intent falls back to `reset`; the token path never reads
it. Duplicating the backend for the second case would have added a second way to
mint credentials, which is the opposite of what makes this safe.

### What to tell an existing client

*"Go to the portal and click 'First time signing in? Set up your password'. Use
the email address ROXIUM already has for you. Everything in your portal stays
exactly where it is."*

No advance email campaign is required — though one still helps.

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
| Login UI, errors, session, recovery, first-time setup, URL parsing | `tests/e2e/auth-password.spec.js` (50 tests, no backend) |
| Email-link and shared-mechanism security properties | `tests/unit/auth-email-links.test.mjs` (30 tests) |
| Identity preservation, end to end against a real project | `tests/integration/password-migration.test.mjs` (`npm run test:integration`) |
| Authorization regression against real staging | `tests/e2e/staging/tenancy.spec.js` |

`tests/integration/` proves the central claim with a live Supabase project:
create a passwordless user with a membership, mint a setup link, redeem it, set a
password, sign in, and assert the id, profile, role, membership and practice are
byte-identical either side — plus that the token cannot be replayed. It **skips**
without `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` and
`STAGING_SUPABASE_ANON_KEY`, and the staging guard refuses production before
anything is created, so it can never touch live data.

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
