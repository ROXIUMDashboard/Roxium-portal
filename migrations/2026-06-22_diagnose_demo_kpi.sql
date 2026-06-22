-- ============================================================
-- DIAGNOSTIC · why isn't the demo practice showing the imported CSV data?
-- ============================================================
-- Read-only. Run in the Supabase SQL editor. The frontend fix (read ALL sources,
-- not just 'marketing') already handles the most common cause; these queries tell
-- you whether the data is mis-SOURCED or mis-MAPPED so you can fix the sheet.

-- 1) What KPI rows exist for the demo practice, and under which source?
select practice_id, source, period, leads, spend, cons, updated_at
from kpi_monthly
where practice_id = 'e4b26de2-ae93-4a2d-aaf5-db819a7c4668'   -- Demo Practice
order by period, source;

-- 2) If step 1 is EMPTY, the rows never attached to the demo practice. See where
--    the sync actually wrote them (e.g. a different/typo'd practice_id from the sheet):
select practice_id, source, count(*) rows, min(period) first_period, max(period) last_period
from kpi_monthly
group by practice_id, source
order by rows desc;

-- 3) Confirm the demo practice id/name match the sheet you're feeding:
select id, name from practices order by name;

-- ── How to fix based on what you see ──────────────────────────────────────────
-- • Rows show up in step 1 under source='coefficient' (or anything non-marketing):
--     Already fixed — the app now reads every source. Just redeploy the frontend.
-- • Rows show in step 2 under a WRONG practice_id (a placeholder/typo UUID):
--     Fix the practice_id column in the Google Sheet to e4b26de2-… and re-run the
--     sync (curl the function or wait for the hourly cron). Optionally re-point the
--     stray rows:
--     -- update kpi_monthly set practice_id='e4b26de2-ae93-4a2d-aaf5-db819a7c4668'
--     --  where practice_id='<WRONG_UUID_FROM_STEP_2>';
-- • Step 1 empty and step 2 shows no coefficient rows at all:
--     The sync isn't writing — check the function logs / SYNC_SECRET / CSV_URL and
--     that the sheet's practice_id isn't still the PASTE_PRACTICE_UUID_HERE placeholder.
