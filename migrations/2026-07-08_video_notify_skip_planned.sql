-- ============================================================
-- Video notifications: skip the Planned / Backlog stage.
--
-- A video sitting in Planned/Backlog should NOT generate a client notification or
-- "latest update" — it only becomes news once it moves forward (Scheduled and
-- beyond). This updates notify_video_stage() to no-op on 'planned'. (The Updates
-- timeline already skips planned; this makes the notification match.)
--
-- Apply once in Supabase → SQL Editor. Idempotent (create or replace).
-- ============================================================

create or replace function notify_video_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare label text; msg text;
begin
  -- only act when the stage actually changed (INSERT always evaluates)
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return new;
  end if;

  -- Planned / Backlog is not an event — don't notify until the video moves forward.
  if new.stage = 'planned' then
    return new;
  end if;

  label := case new.stage
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

  -- keep only the newest notification for this video
  delete from notifications
    where practice_id = new.practice_id and kind = 'video' and ref = new.id::text;
  insert into notifications (practice_id, kind, message, ref)
    values (new.practice_id, 'video', msg, new.id::text);

  return new;
end $$;
