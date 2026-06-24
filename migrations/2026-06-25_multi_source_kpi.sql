-- ============================================================
-- Multi-source KPIs: one reporting sheet per ad channel, per practice
-- ============================================================
-- Run in Supabase SQL editor.
--
-- kpi_monthly already keys on (practice_id, period, source), so the metric store
-- is multi-channel already. The blocker was sheet_sources, which allowed only ONE
-- sheet per practice. This lets a practice have a Meta sheet AND a Google Ads sheet,
-- each syncing under its own kpi source. Fully backward compatible: the existing
-- single row becomes the 'marketing' (Meta) channel.

alter table sheet_sources add column if not exists source text not null default 'marketing';
alter table sheet_sources add column if not exists label  text;

-- Replace the one-sheet-per-practice constraint with one-per-channel.
alter table sheet_sources drop constraint if exists sheet_sources_practice_id_key;
create unique index if not exists sheet_sources_practice_source_key
  on sheet_sources (practice_id, source);

-- Friendly channel labels for the admin UI / observability.
update sheet_sources set label = 'Meta Ads'
 where label is null and source in ('marketing','meta','coefficient');
update sheet_sources set label = 'Google Ads'
 where label is null and source = 'google_ads';
update sheet_sources set label = initcap(replace(source,'_',' '))
 where label is null;
