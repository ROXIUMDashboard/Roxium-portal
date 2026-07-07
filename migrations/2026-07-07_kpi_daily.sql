-- Daily KPI snapshots for month-zoom charts (Coefficient daily rows).
-- Monthly rollups remain in kpi_monthly; this table stores per-day metrics.

create table if not exists kpi_daily (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  day date not null,
  source text not null default 'marketing',
  spend numeric, reach numeric, impr numeric, clicks numeric, lpv numeric,
  page_likes numeric, page_engagement numeric, foll numeric,
  finalized boolean not null default false,
  updated_at timestamptz default now(),
  unique (practice_id, day, source)
);

create index if not exists kpi_daily_practice_day_idx on kpi_daily (practice_id, day);
create index if not exists kpi_daily_day_idx on kpi_daily (day);

alter table kpi_daily enable row level security;

drop policy if exists "read kpi daily" on kpi_daily;
create policy "read kpi daily" on kpi_daily
  for select using (is_team() or is_member_of(practice_id));

drop policy if exists "team kpi daily" on kpi_daily;
create policy "team kpi daily" on kpi_daily
  for all using (is_team()) with check (is_team());

-- Freeze past-month daily rows alongside monthly snapshots.
create or replace function protect_finalized_kpi_daily()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then return old; end if;
  if old.finalized then return old; end if;
  return new;
end $$;

drop trigger if exists trg_protect_finalized_kpi_daily on kpi_daily;
create trigger trg_protect_finalized_kpi_daily before update on kpi_daily
  for each row execute function protect_finalized_kpi_daily();

create or replace function finalize_past_months()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' and not is_team() then
    raise exception 'finalize_past_months: not authorized'
      using errcode = 'insufficient_privilege';
  end if;
  update kpi_monthly set finalized = true
   where finalized = false and period < date_trunc('month', now())::date;
  update kpi_daily set finalized = true
   where finalized = false and day < date_trunc('month', now())::date;
end $$;
