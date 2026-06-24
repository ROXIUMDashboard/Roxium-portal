# Phase E — Access, allowlist invites & onboarding

Central admin controls + client-owner team invites + automatic signup for allowlisted emails.

## Architecture

| Piece | Purpose |
|---|---|
| `practice_invites` | Allowlist: email + practice + role before/at signup |
| `email_is_invited()` | Login gate — returns true for allowlisted or existing users |
| `claim_invites_for_user()` | First login wires `profiles` + `memberships` from allowlist |
| `invite-user` Edge Function | Sends Supabase invite email; team **or practice owner** may call |
| Admin `#admin` | Global: create client, allowlist, invite, sheets, sync |
| Client `#access` tab | Practice **owners** invite their own team members |

## Signup flows

**Option A — Team allowlists then doctor signs up**
1. Admin → **Allowlist only** (no email yet)
2. Doctor enters email on login → magic link sent (`shouldCreateUser: true`)
3. `claim_invites_for_user()` creates profile + membership

**Option B — Team sends invite**
1. Admin → **Send invite** → `invite-user` creates auth user + emails link
2. Doctor clicks link → lands in portal

**Option C — Owner invites staff**
1. Client owner → **Team access** tab → Invite team member
2. Same `invite-user` function (owner auth)

## Deploy (existing projects)

1. SQL Editor → run `migrations/2026-06-24_practice_invites_and_access.sql`
2. Redeploy Edge Function:
   ```bash
   supabase functions deploy invite-user --project-ref nchtmeqsjkpcvtuscxfy
   ```
3. Netlify deploys front end from `main`

## New client checklist (Admin)

1. **Create client** — seeds deliverables, roadmap, video, empty `sheet_sources` row
2. **Allowlist / invite** doctor email (owner role for invite capability)
3. **Save sheet** — Sheet ID or CSV URL
4. Connect Coefficient → cron sync every 2h
