-- ============================================================
-- Video (VSL) stage notifications — fire on EVERY stage change, de-duplicated.
--
-- Before: only the "Post" action wrote a notification, so most stage transitions
-- (Planned → Scheduled → Editing → …) fired nothing, and changes from the ops
-- dashboard fired nothing. Now a trigger creates a notification on every stage
-- change from ANY path (client drag, ops dropdown, publish), and keeps only the
-- NEWEST notification per video so the feed never piles up duplicates.
--
-- Apply once in Supabase → SQL Editor. Idempotent.
-- ============================================================

-- Dedupe key: which object a notification is about (here, the video id).
alter table notifications add column if not exists ref text;
create index if not exists notifications_ref_idx on notifications (practice_id, kind, ref);

create or replace function notify_video_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare label text; msg text;
begin
  -- only act when the stage actually changed (INSERT always acts)
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;

  label := case new.stage
    when 'planned'        then 'Planned'
    when 'scheduled'      then 'Scheduled'
    when 'pre_production' then 'Pre-production'
    when 'shot'           then 'Shot'
    when 'editing'        then 'Editing'
    when 'delivered'      then 'Delivered'
    when 'posted'         then 'Posted'
    else initcap(replace(coalesce(new.stage,''), '_', ' '))
  end;

  msg := case
    when new.stage = 'posted' then new.item || ' is posted — watch it in your portal.'
    else new.item || ' — ' || label || '.'
  end;

  -- keep only the newest notification for this video: drop prior ones, insert current
  delete from notifications
    where practice_id = new.practice_id and kind = 'video' and ref = new.id::text;
  insert into notifications (practice_id, kind, message, ref)
    values (new.practice_id, 'video', msg, new.id::text);

  return new;
end $$;

drop trigger if exists trg_notify_video_stage on video_pipeline;
create trigger trg_notify_video_stage
  after insert or update of stage on video_pipeline
  for each row execute function notify_video_stage();
