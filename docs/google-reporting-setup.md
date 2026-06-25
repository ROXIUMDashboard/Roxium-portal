# Google Reporting Setup — Master Workbook + Source Tabs

How to connect a client's marketing data (Meta Ads, Google Ads, …) to the portal.

**The model in one line:** each client has **one** Google Sheet ("master workbook").
Inside it, **each tab is one source/channel**. The portal reads each tab and stores
KPIs per `(client, month, source)`. Add a channel = add a tab + one row in the admin.

---

## Part A — One-time platform setup (do this once, ever)

This creates the backend "robot" account that reads client sheets privately.

1. **console.cloud.google.com** → create project `roxium-portal`.
2. **APIs & Services → Library** → enable **Google Sheets API**.
3. **APIs & Services → Credentials → Create Credentials → Service account**
   → name `roxium-sync` → Create → Done.
4. Open the service account → **Keys → Add key → Create new key → JSON**. A `.json`
   file downloads. This is the secret key.
5. **Copy the service-account email** (looks like
   `roxium-sync@roxium-portal.iam.gserviceaccount.com`). You share every client
   sheet with this address.
6. In **Supabase → Project Settings → Edge Functions → Secrets**, set:
   - `GOOGLE_SA_KEY` = the entire contents of the JSON file
   - `INGESTION_MODE` = `sheets_api`
   - `SYNC_SECRET` = any long random string (used by the 2-hour cron)
7. Deploy: `supabase functions deploy sync-coefficient --no-verify-jwt`

Done. You never repeat Part A.

---

## Part B — Per client (repeat for each surgeon)

### What gets created in Google Drive

1. Create **one** Google Sheet for the client, e.g. **"Dr. Balikian — Reporting"**.
2. Add **one tab per source**. Name them clearly — the tab name is what you type
   into the portal:
   - `Meta Ads`
   - `Google Ads` (when ready)
   - `Organic`, `SEO`, … (future)
3. In each tab, put that source's data with a **`Date`** (or `Period`/`Month`) column
   plus metric columns. Coefficient imports drop straight into these tabs.
   Recognized headers (case-insensitive): `Date`, `Amount spent`, `Reach`,
   `Impressions`, `Link clicks`, `Landing page views`, `Page engagement`,
   `Followers`. CPM/CTR/CPC are ignored (the portal derives them).

### Share it with the robot (this keeps it private)

4. **Share** the sheet → paste the service-account email from Part A step 5 →
   role **Viewer** → uncheck "Notify" → Share. Only the backend can read it; no
   public link needed.

### Copy the link

5. Copy the sheet's URL (or just the ID). The portal accepts either —
   `https://docs.google.com/spreadsheets/d/<ID>/edit` or the bare `<ID>`.

---

## Part C — Connect it in the portal (Admin)

1. **Admin → the client → Master reporting workbook** → paste the link/ID → **Save workbook**.
2. **+ Add source** → pick **Meta Ads** (or custom) → set **Tab name** = the exact
   tab name (`Meta Ads`) → **Add** → **Save Meta Ads tab**.
3. Repeat **+ Add source** for each additional tab (Google Ads, etc.).
4. **Sync now** → each source flips to ✓ synced with row/month counts. The
   onboarding checklist's "reporting sheet" step turns green once the workbook
   **and** at least one tab are set.

---

## Who does what

| Step | Who / when |
|------|------------|
| Service account + Supabase secrets (Part A) | Team, **once ever** |
| Create the client sheet + tabs | Team, once per client |
| Share sheet with the service-account email | Team, once per client (**required** — skip it and sync gets a 403) |
| Paste workbook link + add source tabs in Admin | Team, once per client (and again when adding a new channel) |
| Pull every client's every tab on a schedule | **Automatic** — every 2 hours |
| "Sync now" button | Team, only to test immediately |

Adding a new channel later = add a tab + run Coefficient into it + add one source
row in Admin. No code changes, no new sheet.

---

## Troubleshooting (what the Sync-now message tells you)

| Message | Cause | Fix |
|---------|-------|-----|
| `no tab configured for this source` | Source has no tab name | Set the source's Tab name to the exact tab |
| `no/invalid practice_id` (all rows) | Data pulled via the global `CSV_URL`, not a client source | Use the per-client workbook+tab (or put the CSV link on the client's source row); don't rely on `CSV_URL` |
| `sheets api 403` | Sheet not shared with the service account | Share it with the service-account email as Viewer |
| `sheets api 404` | Wrong Sheet ID or tab name | Recheck the ID and that the tab name matches exactly |
| `GOOGLE_SA_KEY not set` | Secret missing / function not redeployed | Set the secret, redeploy the function |
| Card empty but status ✓ | A header the parser doesn't recognize | Send the header; it's a one-line alias add |
