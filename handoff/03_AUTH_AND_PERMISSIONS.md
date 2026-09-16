# 03 · Auth & Permissions

Every claim below is traced to code. Supabase **dashboard** settings (Auth providers,
SMTP, redirect URLs, rate limits) cannot be read from the repository and are marked
**UNVERIFIED**.

---

## 1 · The complete sign-in flow

```
/portal/  → portal/index.html → config.js → app.js
   │
   ├─ app.js:563  init()
   │     sb.auth.getSession()
   │        no session → show #login  ──────────────────────────────┐
   │        session    → boot() → afterLogin()                       │
   │                                                                 │
   ├─ app.js:571  sb.auth.onAuthStateChange → boot() (deduped by `booted`)
   │                                                                 │
   └─ LOGIN CARD ◄──────────────────────────────────────────────────┘
         app.js:594  #btnLogin
           redirectTo = location.origin + '/portal/' (+ ?join=CODE if stored)
           sb.auth.signInWithOtp({ email, options:{ emailRedirectTo, shouldCreateUser:false }})
             ok    → reveal the typed-code row, "Check your email…"
             error → if /signups? not allowed|disabled|not found|no user|invalid/
                        "No account is set up for that email yet — contact ROXIUM staff."
                     else surface the raw message
         app.js:627  #btnVerifyCode  (Outlook-link-scanner fallback)
           verifyOtp({email, token, type:'email'})
             on failure retry verifyOtp({..., type:'invite'})
```

### After a session exists — `afterLogin()` (`app.js:768-852`)

1. `sb.auth.getUser()` → `uid`, `authEmail`.
2. **`rpc('claim_invites_for_user')`** — SECURITY DEFINER. In order:
   - every `practice_invites` row matching `lower(email)` with status `pending|sent`
     → upsert `memberships`, mark invite `accepted`;
   - **only if none matched**, every `practice_domains` row matching the email's domain
     → insert membership;
   - if anything was claimed and no profile exists, insert `profiles(role='client')`.
3. If nothing was claimed and a `?join=CODE` was stashed in `localStorage`
   (`app.js:593`), `rpc('join_practice_by_code')` → membership + profile.
4. `select * from profiles where id = uid`. If absent → `rpc('ensure_my_profile')`
   (creates `role='client', approval_status='pending'`) and re-read.
5. **The access gate** (`app.js:826-836`):
   ```js
   if (me.role !== 'team') {
     if (me.approval_status === 'rejected')           → showPendingPane('rejected')
     const mems = await sb.from('memberships')…       // the real check
     if (!mems.length)                                → showPendingPane('pending')
     if (!me.practice_id) me.practice_id = mems[0].practice_id   // heal the pointer
   }
   ```
   This is correct and deliberate: **access is a membership**, not a profile flag.
6. Team users → `loadTeamPractices()`, land on `#operations` with **no** client selected.
   Clients → `practiceId = me.practice_id`, `loadMyMembership()`.
7. `showView(currentView())` → `loadAll()`.

### Logout
`app.js:641` — `sb.auth.signOut()` then `location.reload()`. The pending pane has its own
signout at `app.js:765`. Nothing else is cleared: `localStorage` keeps
`roxium_join`, `roxium_ops_attention_v2`, `roxium_kpi_cards_<pid>`,
`roxium_updates_seen_<pid>`, `lastAdminTab`, sidebar prefs. **On a shared machine the
next user inherits the previous user's ops-attention state and KPI card layout until
the server copy loads.**

---

## 2 · Invite flow (`supabase/functions/invite-user/index.ts`)

Caller: team **or** the practice's owner (`canInvite()` checks `profiles.role='team'`
then `memberships.role='owner'`).

1. Upsert `practice_invites` → `pending`.
2. **`admin.auth.admin.createUser({ email, email_confirm: true, user_metadata })`**
   — this is the *only* place an auth user is created. If the user already exists, it
   falls back to `listUsers({perPage:1000})` and finds them.
   ⚠ `listUsers` is **capped at 1000** and not paginated — past 1000 users, re-inviting
   an existing user fails with "Could not create the account".
3. `practice_invites → 'sent'`, upsert `profiles`, upsert `memberships`,
   explicit `profiles.approval_status = 'approved'` (because the approval trigger is
   INSERT-only), `practice_invites → 'accepted'`.
4. **Email, best-effort and explicitly non-blocking:**
   `admin.auth.admin.generateLink({type:'magiclink', email, options:{redirectTo: SITE_URL + '/portal/'}})`
   → POST to `https://api.resend.com/emails` with an inline-CSS, table-based branded
   template. Returns `{ok:true, emailed:false, email_note:"…"}` if anything failed.

**The invite is complete without the email.** The account, profile and membership exist
regardless; the user can sign in from the login card at any time.

There is a second, email-less path: `sendPracticeInvite(..., {sendEmail:false})`
(`app.js:5402`) calls `rpc('add_practice_invite')`, which only writes the allowlist row.

---

## 3 · Account approval flow

Designed (in `migrations/2026-07-09_account_approvals.sql`) as: anyone may create an
account; nobody gets data until approved; an invitation *is* the approval.

Implemented pieces: `profiles.approval_status`, `ensure_my_profile()`,
`get_pending_accounts()`, `approve_account()`, `reject_account()`, the
`trg_memberships_approve` trigger, the waiting-room pane (`app.js:754`), and the
Team Controls → Account approvals UI (`app.js:5509`).

**But the queue is structurally unreachable from the portal.** `signInWithOtp` is called
with `shouldCreateUser: false` (`app.js:613`), so a stranger's email never creates an
auth user and never receives a link. A `pending` profile can therefore only come from:
- a legacy account created before that flag, or
- a user created out-of-band in the Supabase dashboard, or
- a `?join=CODE` / domain auto-join user *whose membership insert failed*.

So: **the approval mechanism is sound, the entry point is closed.** This is the single
biggest gap between the intended and actual auth architecture.

---

## 4 · Practice assignment & multi-user practices

- Multi-user practices are fully supported: `memberships` is `(user_id, practice_id)`
  with `owner`/`member` roles, `unique(user_id, practice_id)`, and a user may hold many.
- Assignment happens in four places: `invite-user` (upsert), `claim_invites_for_user()`,
  `join_practice_by_code()`, `approve_account()`.
- Owners can invite, revoke, remove and re-role within their own practice
  (`can_invite_to_practice()`); the Invite-team tab is gated on
  `canSeeAccessTab()` = `role==='client' && myMembership.role==='owner' && !previewMode`
  (`app.js:260-261`).
- Guardrails prevent lockout: `member_removal_block_reason()` blocks removing yourself,
  the last practice owner, or the only platform admin; `protect_last_team_admin` enforces
  the last-admin rule even from the Table Editor.
- **Team role has no practice scoping at all.** Any `profiles.role='team'` user reads and
  writes *every* practice. There is no read-only team role, no per-account-manager
  scoping, and no audit log of team writes.

---

## 5 · Roles

| Role | Storage | Grants |
|---|---|---|
| `team` | `profiles.role='team'` | everything, every practice, plus Team Controls, Sync Health, Operations, delete/reset |
| `owner` | `memberships.role='owner'` | own practice: invite/revoke/remove members, manage marketing connections, manage the join link |
| `member` | `memberships.role='member'` | own practice: read-only + mark notifications seen + own KPI card prefs |
| `client` | `profiles.role='client'` | the tenancy label; the real capability comes from the membership row |

`roleLabel()` (`app.js:215`) maps these to display strings — Owner / Member / ROXIUM Team
/ Client / Admin. Role display is consistent in the rosters
(`renderRoster` `app.js:5421`, `renderPlatformAdmins` `app.js:5478`).

---

## 6 · Deletion & revocation

| Action | Code | What actually happens |
|---|---|---|
| **Remove member** (roster) | `app.js:5456` → `rpc('remove_practice_member')` | deletes the membership, reverts `practice_invites` to `revoked`, repoints/nulls `profiles.practice_id`. **The `auth.users` row survives.** |
| **Revoke invite** | `rpc('revoke_practice_invite')` | status → `revoked` (last-owner-invite guard) |
| **Reject account** | `rpc('reject_account')` | deletes **all** memberships, `approval_status='rejected'`, nulls `practice_id`, revokes invites. **`auth.users` survives.** |
| **Demote admin** | `rpc('demote_platform_admin')` | `role` → `client` |
| **Disconnect platform** | `rpc('disconnect_platform')` | `platform_connections.status='revoked'`; KPI history preserved |
| **Delete practice** | `app.js:6350` → `functions.invoke('delete-account', {practice_id})` | revokes Composio accounts → `delete_practice()` (detaches multi-practice clients, deletes single-practice client profiles, cascades every practice-scoped row) → `auth.admin.deleteUser` for the returned ids. **This is the only path that removes auth users.** |
| **Delete one client account** | `delete_client()` RPC + `delete-account {user_id}` | **Both exist server-side but nothing in the UI calls them.** `grep -n "delete-account" app.js` returns exactly one hit — the practice path. The removal confirm text at `app.js:5458` even points the user at a "Delete selected client" action that does not exist. |

---

## 7 · RLS enforcement

Enforced in Postgres, not the browser. Every practice-scoped table has:
```sql
for select using (is_team() or is_member_of(practice_id))
for all    using (is_team()) with check (is_team())
```
`is_team()` / `is_member_of()` are `stable security definer` so they read `profiles` /
`memberships` without re-triggering `profiles` RLS (the documented recursion fix).

Verified hardening already in place:
- `sheet_sync_status` view is `security_invoker`.
- `notifications` INSERT is `with check (is_team())` (was `true`).
- `finalize_past_months`, `reopen_kpi_month`, `practice_member_emails` are revoked from
  `authenticated`.
- `platform_tokens` has RLS on with zero policies.
- `seed_practice` is team-gated and revoked from `anon`.

Weak points:
- `email_is_invited(text)` and `join_code_practice(text)` are granted to **anon**.
  The first is an email-existence oracle; the second is a join-code oracle. Both are
  callable directly against the public REST endpoint with the shipped anon key.
- `join_practice_by_code()` grants a membership to any authenticated caller who knows an
  8-character uppercase-hex code. The code is the credential and is never expired or
  rate-limited in application code.
- **No CSP header** (`_headers` sets XFO/nosniff/Referrer-Policy only), so an XSS in the
  portal would run with the victim's Supabase session. `esc()` (`app.js:2730`) is applied
  consistently in the render paths reviewed, but `app.js` is 6,931 lines of string-built
  HTML with no automated check.

---

## 8 · The explicit questions

### Can an unknown email receive an auth email?
**No — not from the portal login.** `shouldCreateUser: false` (`app.js:613`) means
Supabase refuses to create a user, and no email is sent; the UI shows "No account is set
up for that email yet."

**But an email that already exists in `auth.users` always gets a link**, regardless of
whether the person still has access. There is no allowlist check on the send path
(`email_is_invited()` is never called). So a removed, rejected or orphaned user **can
still trigger a sign-in email and still complete authentication** — they simply land in
the waiting-room pane. That matches the reported symptom "invalid/non-approved users
still trigger login emails", and it is working exactly as written.

**Caveat (UNVERIFIED):** whether Supabase Auth "Allow new users to sign up" is enabled
in the dashboard, and whether any other client (a curl against `/auth/v1/otp` with the
public anon key and `should_create_user: true`) could create a user. The anon key is
public by design, so **if dashboard signups are enabled, anyone on the internet can
create an auth user and receive a Supabase-branded email.** This should be verified and
signups disabled at the project level.

### Can an unknown user create a Supabase Auth account?
Not through this code. `invite-user` (`auth.admin.createUser`) is the only creation path
in the repo, and it is gated on a team/owner JWT. Subject to the dashboard caveat above.

### Can a deleted portal user still exist in `auth.users`?
**Yes, in the common case.** Removing a member, rejecting an account, and revoking an
invite all leave `auth.users` intact by design. Only "Delete practice" removes auth
users, and only for clients whose *sole* membership was that practice. The per-user
delete exists in code (`delete_client` + `delete-account {user_id}`) but **has no UI**.

### What happens when someone is deleted in the UI?
Two distinct actions:
- **Remove (roster):** membership deleted, invite revoked, `practice_id` repointed. They
  can still sign in and see the "your access needs review" waiting room. RLS returns
  nothing. Re-inviting restores them.
- **Delete practice:** Composio connections revoked → all practice rows cascade →
  single-practice client profiles deleted → their `auth.users` rows deleted. Multi-practice
  clients are detached, not deleted. Storage files in the `deliverables` bucket are **not**
  removed.

### Is access truly blocked at the DB layer or only in the frontend?
**At the DB layer.** RLS is on for every table and every client read requires
`is_member_of(practice_id)`. The frontend gating (`showView`, `canSeeAccessTab`,
`isTeamView`) is UX only — a client who forces `#operations` sees an empty dashboard
because the queries return nothing, not because the router stopped them. The one thing
the frontend *does* gate exclusively is **cosmetic exposure of internal signals**
(`delivAttention` is passed `false` in the client renderer, `app.js:2998`) — internal
overdue flags are hidden by render logic, but the underlying `due` dates are readable by
any practice member through the API.

### How do invites currently work?
See §2. Short version: `invite-user` creates and fully provisions the account
synchronously, then tries to email a magic link through Resend. The invite **succeeds
even when the email fails**, and the UI is told so via `emailed:false` + `email_note`.

### Why might welcome/invite emails currently fail?
In likelihood order:
1. **`RESEND_API_KEY` is not set as a Supabase Edge Function secret** → the function
   returns `email_note: "Account created, but no invite email was sent — RESEND_API_KEY
   isn't configured yet."` and no email is attempted. Note the docstring claims
   `inviteUserByEmail` is a fallback — **the code has no such fallback**.
2. **`EMAIL_FROM` is not a Resend-verified sender.** The default is
   `ROXIUM <updates@roxium.com>`; if `roxium.com` is not verified in Resend the API
   returns 4xx and the function reports `resend 4xx: …`.
3. **`SITE_URL` is unset** → `REDIRECT` is `undefined` → `generateLink` falls back to the
   project's Site URL. If that does not match the origin the user opens, the link 404s
   or bounces (the exact failure `README.md` warns about).
4. **`generateLink` failure** — e.g. the Supabase project's rate limit on generated
   links, or an `email_confirm` edge case — throws before Resend is called.
5. **Deliverability**, once sending works: `docs/email-deliverability.md` correctly
   diagnoses that Supabase's *own* auth emails (magic link / OTP) go from a shared
   Supabase sender with no SPF/DKIM aligned to `roxium.com`, which Microsoft silently
   junks. That affects the **login** email, not the invite email, because the invite
   email goes through Resend directly.
6. **The function may simply not be deployed.** `deploy-functions.yml` only runs on
   pushes that touch `supabase/functions/**`; it deploys everything when it does run,
   but a failed deploy only warns per-function.

### What would need to change to implement invite-first + pending approval safely?
The building blocks are all present. The missing pieces, in dependency order:

1. **Decide and enforce the signup policy at the Supabase project level** (dashboard):
   if self-service request-access is wanted, signups must be *enabled* there and the
   portal must stop passing `shouldCreateUser: false`; if not, signups must be
   *disabled* there so the public anon key cannot be used to create users out of band.
   Today the code says "closed" and the project setting is unknown — that ambiguity is
   the actual bug.
2. **Gate the send path on the allowlist.** Call the existing `email_is_invited()` before
   `signInWithOtp` (and, better, enforce it server-side in a `before_user_created` auth
   hook — `supabase/config.toml` documents the hook slot). Today nothing checks it.
3. **Make `email_is_invited()` mean "invited"**, not "invited **or already exists**".
   Its current `or exists (select 1 from auth.users …)` clause is what lets revoked users
   keep requesting links.
4. **Give revocation a real endpoint.** Wire `delete-account {user_id}` (and/or a
   `ban_duration` via `auth.admin.updateUserById`) to a "Remove access entirely" button,
   so removal can actually stop authentication rather than only stopping data.
5. **Close the join-code / domain side doors or make them explicit product features** —
   both currently bypass invite-first entirely.
6. **Brand the auth emails** by pointing Supabase Auth at Resend SMTP (see
   `09_EMAIL_AND_TRANSACTIONAL_COMMS.md`); that also fixes Outlook.
7. **Add an approval notification** — today an account landing in `pending` produces no
   alert anywhere (the ops dashboard fetches `pendingAccounts` and discards it,
   `app.js:5292-5296`).
