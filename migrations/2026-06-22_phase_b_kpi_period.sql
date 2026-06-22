-- ============================================================
-- PHASE B — KPI history model: period-keyed monthly snapshots
-- ============================================================
-- Safe · additive · idempotent. Run once against the live database
-- (Supabase SQL editor, or `supabase db push` from a credentialed session).
--
-- WHY:
--   kpi_monthly was keyed by `month int (1..12)` with `unique(practice_id, month)`.
--   That has two production bugs:
--     1) Only ever 12 slots per practice — no concept of which YEAR a month belongs to.
--     2) Re-reporting "month 3" in a later year OVERWROTE the prior year's month 3,
--        i.e. later edits silently rewrote historical monthly views (the reported symptom).
--
-- FIX:
--   Move to a real `period` (first-of-month DATE) key, plus a `source` tag so marketing,
--   coefficient and future Asana data can coexist. Every (practice, calendar-month, source)
--   becomes its own independent snapshot row, so a new month can never clobber an old one.
--   `month` is kept and auto-derived from `period` so the existing check + notify trigger
--   keep working — nothing is dropped destructively.
-- ============================================================

begin;

-- 1) New columns (additive — existing rows are untouched).
alter table kpi_monthly add column if not exists period date;
alter table kpi_monthly add column if not exists source text not null default 'marketing';

-- 2) Backfill `period` for existing rows.
--    The old schema stored only a month number with no year, so we reconstruct the year
--    from when the row was last updated (the best signal available). If any row's intended
--    year differs, correct it afterwards from the team UI — each period is independent.
update kpi_monthly
   set period = make_date(extract(year from coalesce(updated_at, now()))::int, month, 1)
 where period is null;

-- 3) Keep `month` populated + valid (1..12) and refresh updated_at on every write,
--    derived from `period`. Non-destructive: the `month` column and its check stay.
create or replace function sync_kpi_month() returns trigger
language plpgsql as $$
begin
  if new.period is not null then
    new.month := extract(month from new.period)::int;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sync_kpi_month on kpi_monthly;
create trigger trg_sync_kpi_month before insert or update on kpi_monthly
  for each row execute function sync_kpi_month();

-- 4) Nicer "stats ready" banner now that we have real calendar months.
create or replace function notif_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform notify(new.practice_id, 'stats',
    'Your ' || to_char(new.period, 'Mon YYYY') || ' performance update is ready.');
  return new;
end $$;

-- 5) Enforce `period` and lock in the new uniqueness:
--    one snapshot per practice / calendar month / source.
alter table kpi_monthly alter column period set not null;
alter table kpi_monthly drop constraint if exists kpi_monthly_practice_id_month_key;
create unique index if not exists kpi_monthly_practice_period_source_uq
  on kpi_monthly (practice_id, period, source);

commit;

-- ---------- VERIFY (read-only; run after committing) ----------
-- select practice_id, period, source, month, spend, leads
--   from kpi_monthly order by practice_id, period;
