# Phase C — Org model, onboarding & invite-only access

Multi-user practices, a team "Add client / Invite surgeon" flow, and invite-only
sign-in. This replaces the old one-user-per-practice assumption and the manual
"insert a profile in Supabase by hand" onboarding.

## What changed

| Area | Before | After |
|---|---|---|
| Access model | `profiles.practice_id` (one practice per user) | `memberships` join table (many users ↔ many practices); `profiles.practice_id` kept as the user's default/active practice |
| Client RLS | `practice_id = my_practice()` | `is_member_of(practice_id)` |
| Onboarding | hand-write rows in Supabase | Team panel → **Add client** + **Send invite** |
| Sign-up | magic link auto-created any email | **invite-only** (`shouldCreateUser: false`); only invited users can sign in |

## Deploy steps (in order)

### 1. Run the migration (DB)
Supabase → SQL Editor → run `migrations/2026-06-22_phase_c_memberships.sql`.
It's additive/idempotent: creates `memberships`, backfills it from existing
profiles (every current login keeps working), and switches the read policies to
membership. Verify with the query at the bottom of the file.

> Fresh project instead? `schema.sql` already includes all of this.

### 2. Deploy the invite Edge Function
The "Send invite" button calls an Edge Function that needs the service-role key
(it creates auth users), so it can't run in the browser.

```bash
# one-time
supabase login
supabase link --project-ref nchtmeqsjkpcvtuscxfy

# set the portal origin used as the invite redirect (your live URL)
supabase secrets set SITE_URL="https://YOUR-PORTAL-DOMAIN"
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically on Supabase.

supabase functions deploy invite-user
```

> No CLI access? You can also create the function in the Supabase dashboard
> (Edge Functions → New function → paste `supabase/functions/invite-user/index.ts`)
> and set the `SITE_URL` secret there.

### 3. Turn off open sign-ups (defense in depth)
Supabase → Authentication → Providers → Email → **disable "Allow new users to sign up"**.
The frontend already passes `shouldCreateUser: false`; turning the project setting
off as well makes invite-only enforced server-side regardless of client code.

### 4. Invite emails
Invites use Supabase Auth's built-in invite email out of the box. For branded
sending from your own domain, wire Resend in **Phase D** (Auth → SMTP, or a custom
email hook) — no code change needed here.

## Using it (team)
1. Sign in as a team user → header **⚙ Admin**.
2. **Create client** → onboarding checklist appears.
3. **Allowlist only** or **Send invite** for doctor emails.
4. Configure reporting sheet + sync (section 3).

Client owners invite their own staff from the **Team access** tab (not Admin).

See `docs/phase-e-access-onboarding.md` for the full access model.

## Env vars summary
| Name | Where | Purpose |
|---|---|---|
| `SUPABASE_URL` | Edge Function (auto on Supabase) | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function (auto on Supabase) | admin: create users, write profile/membership |
| `SITE_URL` | Edge Function secret | invite redirect back to the portal |

## QA checklist
- [ ] Migration runs clean; backfill query lists existing users as members.
- [ ] Existing client + team logins still work (no access regression).
- [ ] Add client → new practice appears in switcher, seeded with deliverables.
- [ ] Invite a brand-new email → they receive a link, sign in, land on that practice.
- [ ] Invite a second user to the same practice → both see the same data (multi-user).
- [ ] Random (un-invited) email at login → gets the "no invite found" message, no email.
- [ ] A client of practice A cannot read practice B (RLS holds).
