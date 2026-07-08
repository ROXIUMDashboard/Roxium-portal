# Feature Rollout Guide — Portal Features 1–10

> **Audience:** ROXIUM team. Step-by-step deployment and verification for the ten
> product features (Riviera-inspired operating-system upgrades) shipped across
> PR #88's follow-ups. Frontend and edge functions deploy **automatically** on
> merge to `main`; anything manual is marked **⚠ MANUAL**.

## The one-screen version

| # | Feature | Ships itself on merge? | Manual step |
|---|---------|------------------------|-------------|
| 1 | Sync-freshness age chips | ✅ | none |
| 2 | Marketing Connections (access states) | frontend ✅ | **⚠ run migration** `2026-07-08_marketing_connections.sql` |
| 3 | Action-plan queue (verbs + new alerts) | ✅ | none (access alerts need #2's migration) |
| 4 | KPI insights strip | ✅ | none |
| 5 | Engagement timeline | ✅ | none |
| 6 | "Your part" client block | frontend ✅ | **⚠ run migration** `2026-07-08_client_your_part.sql` (after #2's) |
| 7 | Weekly digest email | function deploys ✅ | **⚠ schedule the weekly cron** (+ optional `DIGEST_TO` secret) |
| 8 | Delivery accountability panel | ✅ | none |
| 9 | "You are here" hero line | ✅ | none |
| 10 | Command palette (⌘K) | ✅ | none |

**Order of manual steps:** migration #2 → migration #6 → digest cron. Nothing
else. Both migrations are idempotent (safe to re-run).

---

## Feature 1 — Sync-freshness age chips

**What it does:** every reporting source shows *when* it last synced and colors
staleness (ok <6h · amber 6–26h · red >26h — the sync runs every 2h, so >26h of
silence is a real failure, not noise). Appears on Team Controls → Reporting
source rows and as a "Last sync" metric on the ops client card.

**Deploy:** nothing — pure frontend, live on merge.

**Verify:** Team Controls → Reporting & KPI → any client: each source row reads
`✓ 2h ago · N row(s) · <months>`. Temporarily stop the cron and the chip turns
amber after 6h — that's the feature working, not a bug.

## Feature 2 — Marketing Connections (access states)

**What it does:** each source carries an access pipeline —
`requested → granted → connected` — with the request date, so "we asked the
client for Google Ads access 9 days ago" is a red row on the client card
instead of tribal knowledge. A successful sync auto-snaps the state to
`connected` (a DB trigger — the state can never lie about flowing data).

**⚠ MANUAL — run once in Supabase → SQL Editor:**
`migrations/2026-07-08_marketing_connections.sql`
- Backfills every existing source as `connected` (they're already wired).
- New sources default to `requested` with today stamped as the request date.

**Verify:** after running it, Team Controls source rows grow a
Requested/Granted/Connected dropdown; the ops client detail shows a
"Marketing connections" section. Add a test source, leave it `requested`, and
confirm the aging note appears (`access requested 0d ago`). Until the migration
runs, the UI simply hides these controls — nothing breaks.

## Feature 3 — Action-plan attention queue

**What it does:** the Needs-Attention queue now covers the whole data pipeline —
new alert types for stale syncs (>26h), aging access requests (amber 3d, red 7d,
matching the onboarding SOP's 5-business-day escalation), and
granted-but-never-wired sources — and sync alerts carry a one-click **Sync now**
button that fixes the problem from the queue. A "Data connections" exec card
summarizes pending/error/stale counts.

**Deploy:** nothing — frontend. The access-request alerts only appear once
feature 2's migration has run.

**Verify:** Operations Dashboard → break something on purpose (rename a tab so
a source errors) → a red "KPI sync failed" alert appears with a `Sync now`
button; fix the tab, click the button, alert clears itself.

## Feature 4 — KPI insights strip

**What it does:** rule-based sentences above the Metrics charts ("Reach ↑ 27%
vs June", "Best CPC of all 6 reported months", "No Google Ads data for July
yet") for clients and team. Deterministic — top two ≥10% month-over-month
moves, records only against 3+ months, missing-channel callout in All-channels
view. Hides entirely when there's nothing to say.

**Deploy:** nothing. **Verify:** open any practice with ≥2 reported months →
Metrics tab → chips render above the chart and change with the channel picker.

## Feature 5 — Engagement timeline

**What it does:** the Updates tab is now one chronological story per practice:
team-posted updates merged with deliverables delivered, milestones completed,
and video stage moves, each with a type tag. No new tables — it merges data the
dashboard already loads (capped at 80 events).

**Deploy:** nothing. **Verify:** open a practice with history → Updates tab →
system events (tagged Delivered / Milestone / Video) interleave with posted
updates in date order. Team ✎/✕ still work on posted updates only.

## Feature 6 — "Your part" client block

**What it does:** a gold block under the client's hero listing the only things
ROXIUM is waiting on *them* for: video approvals (days-waiting, red at 7d) and
platform-access requests they haven't granted (request age). Hidden when empty;
never shown in the team's own view (use Preview-as-client to see it).

**⚠ MANUAL — run once in Supabase → SQL Editor, AFTER feature 2's migration:**
`migrations/2026-07-08_client_your_part.sql`
- Creates `get_my_pending_access()` — a security-definer RPC exposing only
  safe fields (source, label, state, request age) to the practice's own
  members. `sheet_sources` itself stays team-only under RLS.

**Verify:** mark a source `requested` on a test practice, set a video to
blocked → Preview as client → the block lists both with ages. Databases without
the migration just never show the block (the app fails soft).

## Feature 7 — Weekly digest email

**What it does:** one Monday email to the team summarizing every client:
delivered/posted in the last 7 days, open overdue, stuck videos, sync + access
health, and latest-month spend/reach with deltas — with a deep link to the
Operations Dashboard.

**Deploys itself:** `supabase/functions/weekly-digest` goes live on merge (the
deploy-functions workflow iterates every function directory).

**⚠ MANUAL — two steps:**
1. *(optional)* Supabase → Edge Functions → Secrets: set `DIGEST_TO` to a
   comma-separated recipient list. Without it, the digest emails every
   `role='team'` profile's auth email. (Uses the existing `RESEND_API_KEY`,
   `EMAIL_FROM`, `SITE_URL`, `SYNC_SECRET` secrets — nothing new required.)
2. Schedule the weekly cron — same mechanism as the 2-hour sync cron, weekly
   cadence. With pg_cron + pg_net in the Supabase SQL Editor:
   ```sql
   select cron.schedule('roxium-weekly-digest', '0 14 * * 1',  -- Mon 14:00 UTC ≈ 7am PT
     $$ select net.http_post(
          url    := 'https://<project-ref>.supabase.co/functions/v1/weekly-digest',
          headers:= jsonb_build_object('Content-Type','application/json',
                                       'x-sync-key','<SYNC_SECRET value>'),
          body   := '{}'::jsonb ) $$);
   ```
   (Or any external scheduler POSTing with the `x-sync-key` header.)

**Verify without waiting for Monday:** as a signed-in team member, run from the
browser console: `sb.functions.invoke('weekly-digest', { body: {} })` — the
response returns `{ok, emailed, clients, flags}`. Without `RESEND_API_KEY` it's
a safe no-op that returns what it *would* have sent.

## Feature 8 — Delivery accountability panel

**What it does:** a per-client execution scoreboard at the bottom of the
Operations Dashboard, worst-first: delivered last 30d, on-time rate (delivered
vs due, only for items that had a due date; green ≥80% / amber ≥50% / red),
open overdue, longest in-progress item (amber 7d, red 14d).

**Deploy:** nothing. **Verify:** Operations Dashboard → "Delivery
accountability" panel below the client overview. On-time rate shows an em-dash
until a client has delivered items that carried due dates — expected, not
missing data.

## Feature 9 — "You are here" hero line

**What it does:** one line under the dashboard headline: current phase with
delivered/total progress and the next milestone with its target date — the
journey frames the numbers instead of the reverse.

**Deploy:** nothing. **Verify:** any practice with deliverables → the line
renders under the headline for both audiences; practices with everything
delivered read "All phases delivered".

## Feature 10 — Command palette (⌘K / Ctrl+K)

**What it does:** team-only overlay — type to jump to any client (switches the
active practice), any view, or run the reporting sync. Arrows + Enter, Esc
closes.

**Deploy:** nothing. **Verify:** sign in as team → press ⌘K (Ctrl+K on
Windows) → type a client's name → Enter → their dashboard loads. Clients never
see it.

---

## Post-merge checklist (copy into the PR / run top-to-bottom)

1. ☐ Merge → confirm both GitHub Actions are green (Pages deploy + functions deploy).
2. ☐ Supabase SQL Editor: run `2026-07-08_marketing_connections.sql`.
3. ☐ Supabase SQL Editor: run `2026-07-08_client_your_part.sql`.
4. ☐ *(optional)* set `DIGEST_TO`; schedule the weekly digest cron (SQL above).
5. ☐ Hard-refresh the portal (or wait for the cache-bust) and spot-check:
   source rows show sync ages · access dropdowns present · queue shows a
   `Sync now` verb on any sync alert · Metrics shows insight chips ·
   Updates tab shows tagged system events · Preview-as-client shows
   "Your part" + "You are here" · ops shows the accountability panel ·
   ⌘K opens the palette.
6. ☐ Trigger the digest once manually (console invoke above) and confirm the
   email arrives.
