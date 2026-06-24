# Phase E — Access, allowlist invites & onboarding

Central admin controls + client-owner team invites + automatic signup for allowlisted emails.

## Architecture

| Piece | Purpose |
|---|---|
| `practice_invites` | Allowlist: email + practice + role before/at signup |
| `email_is_invited()` | Login gate — allowlisted emails or existing auth users |
| `claim_invites_for_user()` | Runs on **every** sign-in; wires `memberships` (+ profile on first signup) |
| `add_practice_invite()` | Allowlist-only (no email) — doctor self-signup path |
| `invite-user` Edge Function | Sends Supabase invite email + allowlist + profile + membership |
| `get_practice_onboarding_status()` | Admin wizard step completion |
| Admin `#admin` | Global: create client, access, sheets, sync (not inside a client dashboard) |
| Client `#access` tab | Practice **owners** invite multiple team members |

## Signup flows

**Option A — Team sends invite (email + allowlist)**
1. Admin → **Send invite** (with “Send welcome email” checked)
2. `invite-user` creates allowlist row, auth user, profile, membership; emails link
3. Doctor clicks link → lands in portal

**Option B — Team allowlists, doctor signs up**
1. Admin → **Send invite** with “Send welcome email” **unchecked** → `add_practice_invite` only
2. Doctor enters same email on login → magic link (`shouldCreateUser: true`)
3. `claim_invites_for_user()` creates profile + membership automatically

**Option C — Owner invites staff**
1. Client owner → **Invite team** tab → **Send invite**
2. Same `invite-user` function; supports **multiple members** per practice

## Admin onboarding (new client)

1. **Create client** — `seed_practice` seeds deliverables, roadmap, video, empty `sheet_sources`
2. **Access** — invite doctor (owner role) or allowlist email
3. **Sheet** — Sheet ID or CSV URL → Save
4. **Coefficient** — connect trackers to sheet tab (manual in Google Sheets)
5. **Sync** — **Sync now** or wait for 2h cron → KPI data flows automatically

The onboarding checklist in Admin shows ✓/○ status via `get_practice_onboarding_status()`.

## Deploy (existing projects)

Run migrations in order:
1. `2026-06-22_phase_c_memberships.sql`
2. `2026-06-24_practice_invites_and_access.sql`
3. `2026-06-24_access_guardrails.sql`
4. `2026-06-25_onboarding_status_and_claim.sql`

Then:
```bash
supabase functions deploy invite-user --project-ref nchtmeqsjkpcvtuscxfy
```
Set Edge Function secret `SITE_URL` = portal URL.

Disable open signups in Supabase Auth (invite-only defense in depth).

Netlify deploys front end from `main`.

## Recovery (locked out of Admin)

```sql
select id, email from auth.users where email = 'you@example.com';
update profiles set role = 'team' where id = 'your-uuid-without-brackets';
```
