-- ============================================================
-- Roadmap: record the real completion date of each milestone
-- ============================================================
-- Run in Supabase SQL editor.
--
-- target_date stays the *planned* date (de-emphasized in the UI). completed_on
-- is stamped automatically the moment a milestone becomes 'done' — by the app's
-- auto-advance, a manual status change, or a Table-Editor edit — and cleared if
-- it's ever re-opened. The client roadmap shows completed_on prominently.

alter table milestones add column if not exists completed_on date;

create or replace function stamp_milestone_completion()
returns trigger language plpgsql as $$
begin
  if new.status = 'done' then
    -- first time it lands on 'done' (or inserted as done): stamp today, keep any existing date
    if (tg_op = 'INSERT' or old.status is distinct from 'done') and new.completed_on is null then
      new.completed_on := current_date;
    end if;
  else
    new.completed_on := null;   -- re-opened milestone: drop the stale completion date
  end if;
  return new;
end $$;

drop trigger if exists trg_stamp_milestone_completion on milestones;
create trigger trg_stamp_milestone_completion
  before insert or update on milestones
  for each row execute function stamp_milestone_completion();

-- Backfill existing done milestones (best-effort: use the planned date, else today).
update milestones
   set completed_on = coalesce(target_date, current_date)
 where status = 'done' and completed_on is null;
