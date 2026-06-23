# Phase C — KPI / Coefficient / Google Sheet architecture (rebuilt around the real ad data)

## Audit of what was here before
- **Ingestion:** `supabase/functions/sync-coefficient` pulled **one** published CSV
  (`CSV_URL` secret) whose rows carried a `practice_id` column, and upserted into
  `kpi_monthly`. Scheduled hourly via `pg_cron` + `pg_net`. The frontend read **only
  Supabase** (never the sheet) — that part was already correct.
- **Storage:** `kpi_monthly`, wide table keyed `(practice_id, period, source)`,
  `period` = first-of-month date. Each row is a month; "latest period" was treated
  as live and older ones as archived — but there was **no explicit freeze**.
- **Broken metrics:** the dashboard depended on **business** fields the ad sheet does
  not provide — `cons` (consults), `proc`, `apv`, `price`, `leads`, email/SMS/social —
  so Cost-per-lead, Cost-per-consult, LP-conversion, ROAS, Close-rate, etc. rendered
  empty / nonsensical. CTR was the only thing computable from real data.

## What changed
### 1. Dashboard rebuilt on the real ad metrics
Default cards now come from `CORE_METRICS` in `app.js`, **rendered only when the
value exists** (no broken cards):
- **Amount Spent, Reach, Impressions, Link Clicks** (raw from the sheet)
- **CTR, CPM, CPC** (derived: `clicks/impr`, `spend/(impr/1000)`, `spend/clicks`)
Optional secondary metrics shown only if present: **Landing Page Views, Page Likes,
Followers**. Business/consult/revenue cards were removed. Team manual-entry fields and
the `.xlsx` mapping were switched to the same ad set.

### 2. Storage (reuse + extend, not a parallel system)
`kpi_monthly` keeps its keying and the stabilized per-practice month UI. Added
`reach`, `page_likes`, and `finalized boolean`. (CTR/CPM/CPC derived, not stored.)

### 3. Live current month + frozen snapshots (explicit)
- `finalize_past_months()` sets `finalized = true` on every month **before** the
  current calendar month. The sync calls it each run.
- `protect_finalized_kpi()` trigger makes finalized rows **immutable** — the sync (or
  a manual edit) silently no-ops on them. So the current month stays live; closed
  months are frozen exactly as they ended. Rollover is automatic per client.

### 4. Per-client sheet sources
New table **`sheet_sources`** (one row per practice: `csv_url`, `is_active`,
`last_synced_at`, `last_status`, `last_error`). The **Admin tab** lets the team paste
each client's published-CSV URL and shows sync status. The sync **loops every active
source** (practice_id comes from the row, so a per-client tab doesn't even need a
`practice_id` column). Legacy single `CSV_URL` still works as a fallback.

### 5. Sync cadence → every 2 hours
`select cron.schedule('sync-coefficient','0 */2 * * *', …)` (snippet in
`migrations/2026-06-23_phase_c_ad_kpi_rebuild.sql`).

## Decisions / answers
- **One spreadsheet, one tab per client** (recommended & implemented): each tab is
  published as its own CSV and stored in `sheet_sources.csv_url`. Easiest to manage,
  isolates clients, and maps 1:1 to a sync job. (Per-client separate spreadsheets work
  identically — just a different URL per row.)
- **Polling, not webhook (recommended):** Coefficient refreshes the sheet on its own
  schedule; the portal **pulls** every 2h. There is no reliable Coefficient→app push,
  and polling keeps Supabase the single source of truth. A webhook could later *trigger*
  the same function, but it's not required.
- **No `client_id` rename:** `practice_id` already *is* the client id across the whole
  schema; reusing it avoids forking the model and regressing the month UI.

## New-client workflow
1. Admin → **Add client** (seeds deliverables/roadmap/pipeline).
2. Admin → paste that client's **published-CSV URL** in its row → **Save sheet**.
3. Connect Coefficient to feed that client's tab/sheet.
4. The 2-hour sync ingests it into Supabase; **current month is live, past months freeze**.
   Remaining manual step: creating the tab + the Coefficient connection (Google Sheet
   auto-provisioning needs Google API creds that aren't in this repo — the data model
   and sync are ready for it).

## Validation
- **Live month:** `viewPeriod === latestPeriod` → labelled "(live)"; the sync keeps
  updating it until the month rolls over.
- **Historical:** older periods are `finalized` + immutable → "(archived snapshot)".
- **Multi-client isolation:** RLS (`is_member_of` / `is_team`) unchanged; month
  selection is per-practice; sync writes each row under its own `practice_id`.
- **Run SQL:** `migrations/2026-06-23_phase_c_ad_kpi_rebuild.sql`. **Redeploy**
  `sync-coefficient`. Set the cron to `0 */2 * * *`.
