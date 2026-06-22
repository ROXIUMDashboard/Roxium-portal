# Automated KPI sync (Coefficient → Google Sheet → portal)

This wires marketing data into the portal automatically so the team never types
KPIs by hand. It's **Option A**: synced rows are written as `source = 'marketing'`,
which is what the dashboard reads, so data shows the moment it lands.

```
Ad platforms ─▶ Coefficient ─▶ Google Sheet (published as CSV)
                                   │  hourly
                          pg_cron ─┴▶ pg_net ─▶ Edge Function `sync-coefficient`
                                                   │  fetch CSV → parse → upsert
                                                   ▼
                                          Supabase  kpi_monthly  (source='marketing')
                                                   ▼
                                              portal (live)
```

Because `kpi_monthly` is keyed by `(practice_id, period, source)`, each sync only
updates **the current month's snapshot** — past months are never overwritten. The
current month therefore behaves like a live feed; finished months stay frozen.

---

## What's already deployed (live project `nchtmeqsjkpcvtuscxfy`)

- **Edge Function** `sync-coefficient` (`supabase/functions/sync-coefficient/index.ts`),
  deployed with `--no-verify-jwt` and protected by a shared secret.
- **Function secrets:** `CSV_URL` (the published sheet), `SYNC_SECRET` (shared
  secret), `KPI_SOURCE=marketing`. (`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
  are auto-injected by Supabase — the function writes with the service role, so it
  bypasses RLS safely on the server.)
- **Schedule:** a `pg_cron` job named `sync-coefficient` runs **hourly** (`0 * * * *`)
  and calls the function via `pg_net` with the secret header. `pg_cron` + `pg_net`
  extensions are enabled.

Verified end-to-end: cron → function returns `200`; placeholder rows are skipped;
a real-`practice_id` upsert writes correctly and auto-derives `month`.

---

## To go live with real data (the only thing left)

The published sheet currently holds the **template** (placeholder `practice_id`s),
so the sync safely skips every row. To turn it on:

1. Open the Google Sheet behind the published CSV.
2. Replace `PASTE_PRACTICE_UUID_HERE` with the real practice UUID(s):
   - **Balikian Plastic Surgery** → `19bbc12d-6e91-4d1c-a243-0419b62da729`
   - **Demo Practice** → `e4b26de2-ae93-4a2d-aaf5-db819a7c4668`
   - (find any practice id in Supabase → Table editor → `practices.id`)
3. Keep the headers exactly as in `docs/coefficient-sheet-template.md`. One row per
   practice·month. `period` is `YYYY-MM`. Leave a metric blank for "no data"
   (blank = NULL, not 0). `sms`/`vid` are fractions (`0.18`, not `18`).
4. The `source` column is ignored — every synced row is stored as `marketing`
   (Option A). You don't need to change it.
5. Point Coefficient at this sheet so it refreshes the numbers on its own schedule.

Within the hour the portal's Metrics tab will show the data; the current month
updates every refresh, past months stay put.

---

## Operating it

**Trigger a sync immediately (don't wait for the hour):**
```bash
curl -s -X POST \
  "https://nchtmeqsjkpcvtuscxfy.supabase.co/functions/v1/sync-coefficient" \
  -H "x-sync-key: <SYNC_SECRET>"
```
Returns JSON: `rows_seen`, `upserted`, `skipped_count`, and a `skipped` list with
the reason for any skipped row (e.g. a bad `practice_id` or `period`).

**Change the cadence** (e.g. every 15 min, or daily at 08:00 UTC):
```sql
select cron.unschedule('sync-coefficient');
select cron.schedule('sync-coefficient', '*/15 * * * *', $cmd$
  select net.http_post(
    url := 'https://nchtmeqsjkpcvtuscxfy.supabase.co/functions/v1/sync-coefficient',
    headers := jsonb_build_object('Content-Type','application/json','x-sync-key','<SYNC_SECRET>'),
    body := '{}'::jsonb);
$cmd$);
```

**Check recent runs:**
```sql
select status_code, left(content,200), created
  from net._http_response order by created desc limit 5;
```

**Rotate the secret:** `supabase secrets set SYNC_SECRET=<new>` then update the cron
command's header value.

---

## Redeploying the function (after code changes)
```bash
export SUPABASE_ACCESS_TOKEN=<token>
supabase functions deploy sync-coefficient --no-verify-jwt --project-ref nchtmeqsjkpcvtuscxfy
```

## Notes / future
- **Option B** (keep automated marketing data separate from manual overrides):
  set `KPI_SOURCE=coefficient` and update the app to read/merge that source. Today
  the app reads only `marketing`, so Option A keeps it visible with zero code change.
- The same function shape works for **future Asana** or other feeds — give them a
  different `source` and (for B) teach the dashboard to read it.
- Secrets (`SYNC_SECRET`, service role) live in Supabase, never in the repo.
