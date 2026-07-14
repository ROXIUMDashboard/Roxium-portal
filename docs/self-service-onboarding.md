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

- **Connect** → `oauth-start` asks **Composio** for a hosted auth link
  (`user_id` = practice id) and hands the browser Composio's redirect URL
  (our callback carries an `SYNC_SECRET`-signed state); the client consents
  with their own Facebook / Google login; Composio bounces back to
  `oauth-callback`, which confirms the connection is ACTIVE and owned by that
  practice, marks it connected, and lands on the wizard with a success flash.
- **Before Composio is wired up** the same button degrades to "our team will
  connect this with you" — the wizard ships safely today.
- **Tokens** are held by **Composio**, never by us — there is no ROXIUM Meta
  or Google developer app and no token table to secure. `platform_connections`
  stores only safe metadata (provider, status, Composio connection id, account
  label) and is member-readable for the client's own practice. (The legacy
  `platform_tokens` table is left in place, unused.)
- **Team visibility:** connections appear to the team via the existing
  data-connection surfaces; the day-2 client experience stays plumbing-free
  per the standing client-visibility rule.

## Ingestion — how "no spreadsheets" actually happens

`sync-platforms` (cron, same auth pattern as the existing 2-hour sync) calls
**Composio's tool-execute API** for each connected practice — Composio injects
that practice's stored token — and writes **the exact same `kpi_monthly` rows**
the Coefficient path writes — same conflict keys, same source keys
(`marketing`, `google_ads`) — so dashboards, snapshots, channel pickers, and
insights all work unchanged. Meta uses `METAADS_GET_AD_ACCOUNTS` (ad account
discovered once, then persisted) + `METAADS_GET_INSIGHTS` per month for the
last six months. Google Ads uses `GOOGLEADS_SEARCH_STREAM_GAQL` (monthly
cost/impressions/clicks) — **no Google Ads developer token required**, since
Composio's managed Google Ads auth config carries its own approved token. The
Coefficient pipeline keeps working in parallel for practices not yet migrated —
per practice+source, whichever pipeline ran last wins, so migrate a practice by
connecting through the wizard and removing its sheet tab mapping.

## Deployment

Everything deploys on merge (Pages + all edge functions). Manual, in order:

1. **Run the migrations** (Supabase → SQL Editor, idempotent, ~1 min total):
   `migrations/2026-07-09_account_approvals.sql`,
   `migrations/2026-07-09_platform_connections.sql`, then
   `migrations/2026-07-14_composio_connections.sql`.
2. **Enable signups:** Supabase → Authentication → Sign In / Up → make sure
   **"Allow new users to sign up" is ON** (it was previously recommended OFF
   for the old invite-gate model; the approval layer replaces that defense).
3. **Schedule the platform sync** alongside the existing sync cron (weekly
   digest SQL pattern, URL `…/functions/v1/sync-platforms`, every 2h).
4. **Composio setup** (replaces the DIY Meta/Google developer apps):
   - In the Composio dashboard, create a **managed auth config** for the
     `metaads` toolkit and one for the `googleads` toolkit. Copy each `ac_…` id.
   - Set the Supabase Edge Function secrets: `COMPOSIO_API_KEY`,
     `COMPOSIO_META_AUTH_CONFIG_ID`, `COMPOSIO_GOOGLE_AUTH_CONFIG_ID`
     (plus the already-set `SYNC_SECRET` and `SITE_URL`).
   - No provider-side redirect URI to register and **no Meta App Review / Google
     Ads developer token** — Composio owns the underlying developer apps and
     approved tokens. The wizard Connect buttons go live the moment the three
     secrets exist.

## Verification

- **Option A:** invite a test email → sign in with it → no pending screen,
  wizard appears. **Option B:** sign in with a random email → waiting room;
  approve it in Team Controls → sign in again → wizard.
- **Wizard degrade:** with the Composio secrets unset, Connect shows the
  "our team will connect this" note (never an error).
- **Composio (once configured):** Connect Meta as a practice member → Composio
  consent → lands back with the success flash → `platform_connections` row flips
  to `connected` → `sb.functions.invoke('sync-platforms',{body:{}})` as team →
  kpi rows appear → Metrics renders them like any other month.
