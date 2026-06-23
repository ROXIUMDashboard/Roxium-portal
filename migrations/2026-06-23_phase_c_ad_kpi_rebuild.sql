-- ============================================================
-- PHASE C REBUILD · ad-performance KPI model + per-client sheet sources
--                    + live-current-month / frozen-snapshot logic
-- ============================================================
-- Run in the Supabase SQL editor. Safe + additive + idempotent.
-- Keeps the existing kpi_monthly keying (practice_id, period, source) and the
-- stabilized per-practice month UI — only ADDS the real ad metrics, a freeze flag,
-- and a per-client sheet-source table.

-- 1) Real ad-performance columns the Coefficient/Meta sheet actually provides.
--    (spend / impr / clicks / lpv / foll already exist and are reused as
--     Amount Spent / Impressions / Link Clicks / Landing Page Views / Followers.
--     CTR / CPM / CPC are DERIVED from spend·impr·clicks, so they need no columns.)
alter table kpi_monthly add column if not exists reach      numeric;
alter table kpi_monthly add column if not exists page_likes numeric;

-- 2) Freeze flag: a finalized month is an immutable archived snapshot.
alter table kpi_monthly add column if not exists finalized boolean not null default false;

-- 3) A finalized KPI row can never be overwritten (by sync OR by hand).
create or replace function protect_finalized_kpi() returns trigger
language plpgsql as $$
begin
  if old.finalized then return old; end if;   -- discard the update, keep the snapshot
  return new;
end $$;
drop trigger if exists trg_protect_finalized_kpi on kpi_monthly;
create trigger trg_protect_finalized_kpi before update on kpi_monthly
  for each row execute function protect_finalized_kpi();

-- 4) Roll over: freeze every month before the current calendar month. The current
--    month stays live (finalized = false) and keeps syncing.
create or replace function finalize_past_months() returns void
language sql security definer set search_path = public as $$
  update kpi_monthly set finalized = true
   where finalized = false
     and period < date_trunc('month', now())::date;
$$;

-- 5) Per-client reporting sheet source (one row per practice). Each client gets its
--    own published-CSV URL (a tab in the master sheet, or a per-client sheet).
create table if not exists sheet_sources (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  source_type text not null default 'google_sheet_csv',
  csv_url text,                         -- published-to-web CSV link for this client's tab/sheet
  sheet_id text,                        -- Google Sheet id (optional, for provisioning)
  tab_name text,                        -- tab / gid (optional)
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_status text,                     -- 'ok' | 'error'
  last_error text,
  created_at timestamptz default now(),
  unique (practice_id)
);
alter table sheet_sources enable row level security;
drop policy if exists "team sheet sources" on sheet_sources;
create policy "team sheet sources" on sheet_sources for all using (is_team()) with check (is_team());

-- ---- cron: switch the Coefficient sync to every 2 hours (was hourly) ----
-- select cron.unschedule('sync-coefficient');
-- select cron.schedule('sync-coefficient', '0 */2 * * *', $cmd$
--   select net.http_post(
--     url := 'https://nchtmeqsjkpcvtuscxfy.supabase.co/functions/v1/sync-coefficient',
--     headers := jsonb_build_object('Content-Type','application/json','x-sync-key','<SYNC_SECRET>'),
--     body := '{}'::jsonb);
-- $cmd$);
