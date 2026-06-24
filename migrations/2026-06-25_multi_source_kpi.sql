-- ============================================================
-- Multi-source KPIs: ONE master reporting workbook per client, with MULTIPLE
-- source tabs inside it (Meta Ads, Google Ads, Organic/Social, SEO, …).
-- ============================================================
-- Run in the Supabase SQL editor. Idempotent & backward compatible.
--
-- Model:
--   • practices.workbook_sheet_id = the client's ONE master Google Sheet. Every
--     source lives as a TAB inside this single workbook (share it once with the
--     backend service account and all tabs are reachable).
--   • sheet_sources                = one row per SOURCE TAB inside that workbook:
--                                    (practice_id, source) -> tab_name. Unique per
--                                    channel, so a client can have a Meta tab AND a
--                                    Google Ads tab AND any future source tab.
--   • kpi_monthly already keys on (practice_id, period, source), so the metric store
--     is multi-source already — this migration wires the ingestion CONFIG to match,
--     and lets new sources be added without touching the importer.

-- 1) Per-source tab config on sheet_sources -----------------------------------
alter table sheet_sources add column if not exists source text not null default 'marketing';
alter table sheet_sources add column if not exists label  text;
alter table sheet_sources add column if not exists gid    text;   -- optional tab gid (CSV-export-by-tab)

-- one row per channel per practice (was: one sheet per practice)
alter table sheet_sources drop constraint if exists sheet_sources_practice_id_key;
create unique index if not exists sheet_sources_practice_source_key
  on sheet_sources (practice_id, source);

-- friendly labels for the admin UI / observability
update sheet_sources set label = 'Meta Ads'         where label is null and source in ('marketing','meta','coefficient');
update sheet_sources set label = 'Google Ads'       where label is null and source = 'google_ads';
update sheet_sources set label = 'Organic / Social' where label is null and source = 'organic';
update sheet_sources set label = 'SEO / Website'    where label is null and source = 'seo';
update sheet_sources set label = initcap(replace(source,'_',' ')) where label is null;

-- 2) The master reporting workbook lives on the client ------------------------
alter table practices add column if not exists workbook_sheet_id text;

-- Backfill: the pre-workbook config stored a Google Sheet id on each source row.
-- Lift the first non-empty one up to the client so existing single-sheet clients
-- keep syncing without any reconfiguration. (The per-row sheet_id is still read as
-- a fallback by sync-coefficient, so nothing breaks if this backfill is skipped.)
update practices p
   set workbook_sheet_id = sub.sheet_id
  from (
    select distinct on (practice_id) practice_id, sheet_id
      from sheet_sources
     where sheet_id is not null and btrim(sheet_id) <> ''
     order by practice_id, source
  ) sub
 where sub.practice_id = p.id
   and (p.workbook_sheet_id is null or btrim(p.workbook_sheet_id) = '');
