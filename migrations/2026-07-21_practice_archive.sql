-- ============================================================
-- Practice soft-archive (Sync Health → Archive).
-- Archiving hides a practice from the active roster and stops scheduled syncs,
-- but keeps every record so it can be restored exactly as it was. Team-only.
--
-- Apply live:  paste into Supabase SQL editor and run.
-- ============================================================

-- 1 · nullable archive marker (NULL = active, timestamp = archived-at)
alter table practices add column if not exists archived_at timestamptz;

create index if not exists practices_archived_at_idx on practices (archived_at);

-- 2 · team-only setter (security-definer so it runs above RLS but still gates on is_team)
create or replace function set_practice_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_team() then
    raise exception 'Only team members can archive a practice';
  end if;
  update practices
     set archived_at = case when p_archived then now() else null end
   where id = p_id;
end;
$$;

grant execute on function set_practice_archived(uuid, boolean) to authenticated;
