-- Persist the marketing-wizard opt-out on the practice, mirroring
-- wizard_completed_at, so "Continue without connecting" carries across every
-- device and co-owner instead of living in a single browser's localStorage.
--
-- Idempotent / safe to re-run.

-- 1 · Opt-out timestamp on the practice --------------------------------------
alter table practices add column if not exists wizard_declined_at timestamptz;

-- 2 · A practice member (or team) records / clears the opt-out ----------------
create or replace function decline_marketing_wizard(p_practice uuid, p_declined boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ( is_team() or exists (select 1 from memberships m
            where m.user_id = auth.uid() and m.practice_id = p_practice) ) then
    return jsonb_build_object('ok', false, 'error', 'not a member of this practice');
  end if;
  update practices
     set wizard_declined_at = case when p_declined then now() else null end
   where id = p_practice;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function decline_marketing_wizard(uuid, boolean) to authenticated;

-- 3 · Finishing the wizard supersedes any prior opt-out ----------------------
create or replace function complete_marketing_wizard(p_practice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ( is_team() or exists (select 1 from memberships m
            where m.user_id = auth.uid() and m.practice_id = p_practice) ) then
    return jsonb_build_object('ok', false, 'error', 'not a member of this practice');
  end if;
  update practices
     set wizard_completed_at = coalesce(wizard_completed_at, now()),
         wizard_declined_at  = null
   where id = p_practice;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function complete_marketing_wizard(uuid) to authenticated;
