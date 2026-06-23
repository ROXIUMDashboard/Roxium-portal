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

## Sync now (Admin button)
The Admin tab has a **↻ Sync now** button. It calls `sync-coefficient` with your
team login JWT (no secret in the browser). Redeploy the function **with JWT
verification ON** (default):

```bash
supabase functions deploy sync-coefficient --project-ref nchtmeqsjkpcvtuscxfy
```

Cron / `pg_net` still use `x-sync-key` — deploy a second copy is **not** needed;
the same function accepts either auth path. Cron must use `--no-verify-jwt` because
`pg_net` sends no bearer token.

## Troubleshooting 401 on cron / manual SQL sync

`select net.http_post(...)` returning a number like `22` is **not an error** — that
is the `pg_net` request id. Check the real HTTP status:

```sql
select id, status_code, left(content, 300) as body, created
  from net._http_response
 order by created desc limit 5;
```

A **401** almost always means the `x-sync-key` header does not exactly match the
`SYNC_SECRET` Edge Function secret:

1. Set the secret (no angle brackets — use your real value):
   ```bash
   supabase secrets set SYNC_SECRET=roxium-sync-2026xyz --project-ref nchtmeqsjkpcvtuscxfy
   ```
2. Use that **exact same string** in the cron SQL `x-sync-key` value.
3. Confirm it is set: Supabase dashboard → Edge Functions → Secrets.
4. Redeploy after secret changes: `supabase functions deploy sync-coefficient --no-verify-jwt`

Turning off JWT on the function only skips Supabase's gateway check — the function
still requires `x-sync-key` **or** a team JWT. A missing/wrong secret still 401s.

Other statuses:
- **500 `SYNC_SECRET not configured`** — secret never set; run `supabase secrets set`.
- **400 `no active sheet sources`** — paste CSV URLs in Admin and Save sheet first.
- **200 with `upserted: 0` and skips** — sheet missing `period` column, bad UUID, or placeholder rows.
