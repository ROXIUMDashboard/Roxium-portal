-- ============================================================
-- Cleanup + schema: deliverable SLA timestamps, and fix the bad "Jan 2030" banner
-- ============================================================
-- Run in the Supabase SQL editor. Safe + idempotent.

-- ---- Item 4: deliverables need a "time in current status" source of truth ----
alter table deliverables add column if not exists status_since timestamptz default now();

create or replace function touch_deliv_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then new.status_since := now(); end if;
  return new;
end $$;

drop trigger if exists trg_deliv_status on deliverables;
create trigger trg_deliv_status before update on deliverables
  for each row execute function touch_deliv_status();

-- Backfill: don't false-flag existing rows as overdue. Anchor unfinished items to
-- now() (fresh clock); leave finished ones at delivered_at if present.
update deliverables
   set status_since = coalesce(
     case when status = 'delivered' then delivered_at end, now())
 where status_since is null;

-- ---- Item 1: stop future-dated periods from creating "Your <month> is ready" ----
create or replace function notif_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.period > (date_trunc('month', now()) + interval '1 month')::date then
    return new;  -- skip implausible/future periods (e.g. a 2030 typo)
  end if;
  perform notify(new.practice_id, 'stats',
    'Your ' || to_char(new.period, 'Mon YYYY') || ' performance update is ready.');
  return new;
end $$;

-- Remove the bad future-dated KPI rows (the "Jan 2030" source) and the stale
-- 'stats' notifications they spawned. Adjust the cutoff if you intentionally have
-- next-month data.
delete from kpi_monthly
 where period > (date_trunc('month', now()) + interval '1 month')::date;

delete from notifications
 where kind = 'stats'
   and message ~ '20[3-9][0-9]';   -- any 'stats' banner referencing 2030+ (typo years)

-- After this, the in-app banner also self-corrects: it now re-derives the month
-- from the latest real KPI period instead of trusting the stored message.
