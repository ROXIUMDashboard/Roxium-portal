# Self-Service Onboarding — Accounts, Approvals & the Marketing Setup Wizard

> **What this is:** the architecture shipped for Stripe/Shopify-style onboarding:
> a surgeon creates their own account, gets approved (automatically via
> invitation, or manually by the team), and connects their marketing platforms
> with their own logins — no spreadsheets, no workbook IDs, no CSV URLs, no
> "Sync now", no technical language.

## The flow

```
Create account (email magic link — anyone may sign up)
        ↓
Invitation match?
        ↓
Yes ────────────────────────→ APPROVED automatically
 │                                   ↓
 No                          Marketing Setup Wizard
 │                            (connect Meta / Google with their own logins)
 Pending Approval                    ↓
 (sees waiting room,          Data flows into the portal
  zero data access)           (sync-platforms cron, same KPI tables)
 │
 Team approves in Team Controls → Access & Invites → Account approvals
 │
 Marketing Setup Wizard → …
```

## Account approval architecture

**Security invariant:** nobody sees client data on signup alone. Every account
is either (a) auto-approved because its email matches a practice invitation —
the invitation IS the approval — or (b) held in `pending` with **zero
memberships**, and RLS already denies every practice table without a
membership. The pending pane is honest UX on top of a database that was never
going to show them anything anyway.

- **Option A (primary, unchanged):** admin creates the practice → invites the
  doctor's email → doctor signs in with that email → the existing invite-claim
  creates the membership → a DB trigger flips the profile to `approved` →
  straight into the wizard. Zero admin follow-up.
- **Option B (request access):** un-invited signup → `ensure_my_profile()`
  bootstraps a `pending` client profile → waiting-room pane → the team sees
  the request in **Team Controls → Access & Invites → Account approvals**
  (and an "Account requests" card on the Operations Dashboard) → assigns a
  practice + role and Approves (optionally with the branded welcome email) or
  Rejects. Approval works by creating the membership, so the same trigger
  applies; rejection is reversible.

**Pieces** (`migrations/2026-07-09_account_approvals.sql`, idempotent):
`profiles.approval_status/requested_at` + constraint; legitimacy backfill;
`approve_profile_on_membership` trigger; `ensure_my_profile()`,
`get_pending_accounts()`, `approve_account()`, `reject_account()` RPCs
(team-only where it matters, all `security definer`).

## Marketing Setup Wizard

Shown to approved clients until their practice completes/skips it
(`practices.wizard_completed_at`). Two Connect cards (Facebook & Instagram ·
Google) plus "Everything else — handled by ROXIUM". Copy is entirely
non-technical: *read-only, no passwords, disconnect anytime, ~2 minutes.*

- **Connect** → `oauth-start` returns the provider authorize URL (state is
  HMAC-signed with `SYNC_SECRET`); browser round-trips through consent;
  `oauth-callback` exchanges the code, stores the connection, and lands back
  on the wizard with a success flash.
- **Before the developer apps exist** the same button degrades to "our team
  will connect this with you" — the wizard ships safely today.
- **Tokens** live in `platform_tokens`: RLS enabled with **no policies**, so
  only the service role (edge functions) can ever touch them. Clients/team see
  metadata only (`platform_connections`, member-readable for their own
  practice).
- **Team visibility:** connections appear to the team via the existing
  data-connection surfaces; the day-2 client experience stays plumbing-free
  per the standing client-visibility rule.

## Ingestion — how "no spreadsheets" actually happens

`sync-platforms` (cron, same auth pattern as the existing 2-hour sync) reads
each connected practice's tokens and writes **the exact same
`kpi_monthly`/`kpi_daily` rows** the Coefficient path writes — same conflict
keys, same source keys (`marketing`, `google_ads`) — so dashboards, snapshots,
channel pickers, and insights all work unchanged. Meta ingestion is complete
(6 months monthly + live-month daily). Google Ads ingestion activates itself
the moment `GOOGLE_ADS_DEVELOPER_TOKEN` exists. The Coefficient pipeline keeps
working in parallel for practices not yet migrated — per practice+source,
whichever pipeline ran last wins, so migrate a practice by connecting OAuth
and removing its sheet tab mapping.

## Deployment

Everything deploys on merge (Pages + all edge functions). Manual, in order:

1. **Run both migrations** (Supabase → SQL Editor, idempotent, ~1 min total):
   `migrations/2026-07-09_account_approvals.sql`, then
   `migrations/2026-07-09_platform_connections.sql`.
2. **Enable signups:** Supabase → Authentication → Sign In / Up → make sure
   **"Allow new users to sign up" is ON** (it was previously recommended OFF
   for the old invite-gate model; the approval layer replaces that defense).
3. **Schedule the platform sync** alongside the existing sync cron (weekly
   digest SQL pattern, URL `…/functions/v1/sync-platforms`, every 2h).
4. **External provider setup** — see "Remaining external integrations" in the
   PR / final handoff: Meta developer app, Google Cloud OAuth client, secrets
   (`META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, optional `GOOGLE_ADS_DEVELOPER_TOKEN`), and the
   OAuth redirect URI `https://<project-ref>.supabase.co/functions/v1/oauth-callback`
   registered with both providers.

## Verification

- **Option A:** invite a test email → sign in with it → no pending screen,
  wizard appears. **Option B:** sign in with a random email → waiting room;
  approve it in Team Controls → sign in again → wizard.
- **Wizard degrade:** with no provider secrets set, Connect shows the
  "our team will connect this" note (never an error).
- **OAuth (once configured):** Connect Meta with a test user → lands back
  with the success flash → `sb.functions.invoke('sync-platforms',{body:{}})`
  as team → kpi rows appear → Metrics renders them like any other month.
