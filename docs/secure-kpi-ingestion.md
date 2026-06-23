# Secure KPI ingestion — architecture decision & migration

## The problem with today's setup
Each client's marketing data lives in a Google Sheet (fed by Coefficient). The
portal's `sync-coefficient` Edge Function pulls each sheet's **published-to-web CSV**
URL (`/export?format=csv`, gid-based) every 2 hours and upserts it into
`kpi_monthly`. Those URLs are stored in `sheet_sources.csv_url` and were entered/edited
through the Admin UI.

Two problems:

1. **Security.** "Publish to web" makes the whole sheet readable by *anyone with the
   link* — no auth, no expiry. The link is a permanent public data leak surface, and
   it has to round-trip through the browser to be entered/edited.
2. **Operability.** Publishing is a manual per-client step that silently breaks if the
   sheet owner unpublishes, changes tabs, or shares a different gid.

## Options considered

**Option A — Make.com (or Zapier) middleware.** Make connects to Google Sheets with
OAuth, then pushes rows to Supabase via the REST API or a webhook.
- ✅ No Google service-account plumbing to write.
- ❌ Adds a **paid third-party** in the critical path, another set of credentials to
  manage, another vendor outage to absorb, and another place multi-client scoping can
  go wrong. It also duplicates infrastructure this repo *already has*.

**Option B — Private server-side Google Sheets sync (RECOMMENDED).** Keep the existing
`sync-coefficient` Edge Function + `pg_cron` + `sheet_sources` infrastructure, but read
each sheet through the **Google Sheets API v4** using a **service account**, with the
sheet shared privately (Viewer) to the service-account email. The key is a Supabase
secret; the browser never sees it.

## Decision: Option B

This repo already owns the hard parts — an Edge Function, a 2-hour cron, a
per-client `sheet_sources` table (which **already has `sheet_id` and `tab_name`
columns**), team-JWT auth, and the freeze/finalize logic. Option B is therefore the
**smaller delta**: we swap the *reader* (public CSV fetch → authenticated Sheets API
call) and leave the entire pipeline, scoping, and dashboard untouched. It adds **no new
vendor and no recurring cost**, and it satisfies every security requirement:

- The frontend never needs (and never holds) a sheet URL. Config is a `sheet_id`
  entered in the team-only Admin panel.
- Sheet access is private: shared only with the backend service account.
- No client-facing or public surface exposes a reporting-sheet link.
- Multi-client scoping is unchanged — still one `sheet_sources` row per practice,
  still upserted on `(practice_id, period, source)`.

## What changed in code (this pass)

- **`sync-coefficient/index.ts`** now supports two ingestion modes via an
  `INGESTION_MODE` env var:
  - `csv` (default) — legacy public-CSV behaviour, unchanged, so nothing breaks
    during migration.
  - `sheets_api` — reads `sheet_sources.sheet_id` (+ optional `tab_name`) through the
    Sheets API using a service-account JWT (`GOOGLE_SA_KEY` secret). New helpers:
    `googleAccessToken()` (RS256 JWT → OAuth token) and `readSheetGrid()` (returns the
    same string-grid shape `parseCSV` produced, so the parser is reused verbatim).
- **Admin UI (`app.js` / `index.html`)** now takes a **private Sheet ID + tab** as the
  preferred per-client config; the legacy CSV field remains but is visually de-emphasised
  and marked "being phased out". `saveSheetSource()` writes `sheet_id`/`tab_name` and
  sets `source_type = 'google_sheet_private'` when a Sheet ID is present.

## Go-live steps (one-time, done outside the sandbox)

1. **Create a Google Cloud service account**, enable the **Google Sheets API**, and
   download its JSON key.
2. In Supabase: `supabase secrets set GOOGLE_SA_KEY='<the full JSON>'` and
   `supabase secrets set INGESTION_MODE=sheets_api`.
3. For each client, **share their sheet (Viewer)** with the service-account email
   (`...@<project>.iam.gserviceaccount.com`).
4. In the Admin panel, paste each client's **Sheet ID** (the long token in the sheet
   URL between `/d/` and `/edit`) and the **tab name**; Save.
5. Click **Sync now** and confirm the new Auto-sync status banner shows rows/months.
6. Once every client is migrated, **un-publish** the sheets and clear `csv_url`.

## Why not flip the default to `sheets_api` immediately
Default stays `csv` so a deploy without the secret/sharing in place keeps working.
Flip `INGESTION_MODE=sheets_api` only after step 3 is done for every active client.
