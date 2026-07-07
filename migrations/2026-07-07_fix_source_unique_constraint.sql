-- ============================================================
-- Fix: "Could not add client: there is no unique or exclusion constraint
-- matching the ON CONFLICT specification".
--
-- seed_practice() (add client) and the KPI / sheet-source upserts use
--   ON CONFLICT (practice_id, source)          -- sheet_sources
--   ON CONFLICT (practice_id, period, source)  -- kpi_monthly
-- but this live DB was created before the per-channel model and is missing those
-- unique indexes (schema drift). This adds them idempotently and drops the obsolete
-- (practice_id)-only constraint. Safe to run once; safe to re-run.
--
-- If CREATE UNIQUE INDEX errors with "could not create unique index … duplicate key",
-- you have duplicate rows for the same (practice_id, source) / (practice_id, period,
-- source) — remove the extras, then re-run. (This migration never deletes data.)
-- ============================================================

-- sheet_sources: exactly one row per (practice, channel/source)
alter table sheet_sources drop constraint if exists sheet_sources_practice_id_key;
create unique index if not exists sheet_sources_practice_source_uq
  on sheet_sources (practice_id, source);

-- kpi_monthly: exactly one row per (practice, month, source)
create unique index if not exists kpi_monthly_practice_period_source_uq
  on kpi_monthly (practice_id, period, source);
