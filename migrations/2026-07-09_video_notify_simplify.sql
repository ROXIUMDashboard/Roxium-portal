-- ============================================================
-- Video notifications: one meaningful event per stage move.
--
-- • No notification on INSERT (creation / Planned backlog).
-- • No notification while stage stays 'planned'.
-- • Intermediate forward moves → one "video" notification: "{name} moved to {stage}."
-- • Final delivery (delivered / posted) → "{name} was delivered." or posted message.
-- • Deduped per video (newest wins).
--
-- Apply once in Supabase → SQL Editor. Idempotent.
-- ============================================================

create or replace function notify_video_stage()
returns trigger language plpgsql security definer set search_path = public as $$
declare label text; msg text;
begin
  -- Creation / backlog seed — never notify.
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.stage is not distinct from old.stage then
    return new;
  end if;

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
    when new.stage = 'delivered' then new.item || ' was delivered.'
    else new.item || ' moved to ' || label || '.'
  end;

  delete from notifications
    where practice_id = new.practice_id and kind = 'video' and ref = new.id::text;
  insert into notifications (practice_id, kind, message, ref)
    values (new.practice_id, 'video', msg, new.id::text);

  return new;
end $$;

drop trigger if exists trg_notify_video_stage on video_pipeline;
create trigger trg_notify_video_stage
  after update of stage on video_pipeline
  for each row execute function notify_video_stage();
