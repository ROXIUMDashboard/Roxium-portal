-- ============================================================
-- 2026-06-23 · Sync observability + Demo-Practice March repair
--
-- Ships three things:
--   1. Per-client sync detail on sheet_sources (last_rows, last_months) so the
--      Admin panel can show "✓ synced 3m ago (12 rows · Mar, Apr, May)".
--   2. A sync_runs audit table — proof the every-2-hours automation actually ran:
--      when, what triggered it (scheduled vs the Admin "Sync now" button), how many
--      KPI rows it wrote, what it skipped, and which months it saw.
--   3. reopen_kpi_month() — a team-only repair helper that un-freezes (or deletes)
--      a finalized KPI month so the next sync can refill it. This is the fix for
--      Demo Practice's missing March: a March row that first synced under a bad
--      period/empty value got frozen by finalize_past_months(), and the
--      protect_finalized_kpi() trigger makes every later update a silent no-op — so
--      it can never self-correct via re-sync. Re-opening the month lets it heal.
--
-- Safe to run more than once (idempotent: IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================

-- 1 ───────── per-client sync detail ──────────────────────────────────────────
alter table sheet_sources add column if not exists last_rows   int;
alter table sheet_sources add column if not exists last_months text[];

-- 2 ───────── sync_runs audit table ───────────────────────────────────────────
create table if not exists sync_runs (
  id            uuid primary key default gen_random_uuid(),
  ran_at        timestamptz not null default now(),
  trigger       text not null default 'scheduled',  -- 'scheduled' (cron) | 'manual' (Admin button)
  ok            boolean not null default true,
  rows_seen     int not null default 0,             -- parsed upsert rows across all sources
  upserted      int not null default 0,             -- rows actually written to kpi_monthly
  skipped_count int not null default 0,
  months_seen   text[],                             -- distinct 'YYYY-MM' months touched this run
  sources       jsonb,                              -- per-client { ok, rows, months, error }
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists sync_runs_ran_at_idx on sync_runs (ran_at desc);

alter table sync_runs enable row level security;
-- team users read the audit log in the Admin panel
drop policy if exists "team reads sync_runs" on sync_runs;
create policy "team reads sync_runs" on sync_runs for select using (is_team());
-- only the service role (the Edge Function) inserts audit rows; clients never write
drop policy if exists "service inserts sync_runs" on sync_runs;
create policy "service inserts sync_runs" on sync_runs for insert
  with check (auth.role() = 'service_role');

-- 3 ───────── reopen_kpi_month() repair helper ────────────────────────────────
-- Un-freeze a finalized KPI month (or delete it outright) so the next sync run can
-- rewrite it. SECURITY DEFINER + an explicit is_team() guard so it bypasses the
-- protect_finalized_kpi() trigger's no-op behaviour while staying team-only.
create or replace function reopen_kpi_month(
  p_practice uuid,
  p_period   date,
  p_delete   boolean default false
) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_team() then
    raise exception 'reopen_kpi_month: team only';
  end if;
  if p_delete then
    delete from kpi_monthly where practice_id = p_practice and period = p_period;
    get diagnostics n = row_count;
  else
    -- the trigger no-ops finalized rows, so flip the flag in one statement and let
    -- the WHERE filter target exactly the frozen month
    update kpi_monthly set finalized = false
     where practice_id = p_practice and period = p_period;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;
revoke all on function reopen_kpi_month(uuid, date, boolean) from public, anon;

-- ============================================================
-- DIAGNOSTIC / REPAIR for Demo Practice (e4b26de2-ae93-4a2d-aaf5-db819a7c4668)
-- Run these by hand in the SQL editor to inspect and fix March 2026.
-- ============================================================
-- (a) What months/sources exist, and are they frozen?
--   select practice_id, period, source, finalized,
--          spend, reach, impr, clicks
--     from kpi_monthly
--    where practice_id = 'e4b26de2-ae93-4a2d-aaf5-db819a7c4668'
--    order by period, source;
--
-- (b) Is March there at all (any source), and is it frozen / empty?
--   select period, source, finalized, spend, impr, clicks
--     from kpi_monthly
--    where practice_id = 'e4b26de2-ae93-4a2d-aaf5-db819a7c4668'
--      and period = '2026-03-01';
--
-- (c) REPAIR · if a stuck/empty/wrong-source March row exists, delete it so the
--     next sync (with the fixed deterministic parser) writes a clean one:
--   select reopen_kpi_month('e4b26de2-ae93-4a2d-aaf5-db819a7c4668', '2026-03-01', true);
--   -- then trigger sync-coefficient (Admin "Sync now") and re-check (b).
--
-- (d) If March is simply frozen but otherwise correct and you only need it editable:
--   select reopen_kpi_month('e4b26de2-ae93-4a2d-aaf5-db819a7c4668', '2026-03-01', false);
