-- ============================================================
-- Admin: delete-practice RPC (team-only, cascading)
-- ============================================================
-- Run in the Supabase SQL editor. Safe + idempotent.
-- Powers the "Delete" buttons in the global Admin tab. Practice-scoped data
-- (kpi_monthly, deliverables, milestones, video_pipeline, video_history,
-- notifications, memberships) is removed by their on-delete-cascade FKs; client
-- profiles are deleted and any other profile pointing at the practice is detached.

create or replace function delete_practice(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then
    raise exception 'Only team members can delete a practice' using errcode = 'insufficient_privilege';
  end if;
  delete from profiles where practice_id = p_id and role = 'client';
  update profiles set practice_id = null where practice_id = p_id;
  delete from practices where id = p_id;   -- cascades all practice-scoped rows
end $$;

-- Make it callable from the browser (RLS is enforced inside via is_team()).
grant execute on function delete_practice(uuid) to authenticated;
