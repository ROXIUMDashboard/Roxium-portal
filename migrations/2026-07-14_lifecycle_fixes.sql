-- ============================================================
-- Phase 1 — lifecycle correctness (see docs/PLATFORM_AUDIT.md).
--
-- Fixes the "deleted clients reappear / manual Supabase cleanup" class of bugs
-- and makes reject/remove genuine access revocations instead of cosmetic flags.
-- The one thing SQL cannot do — delete the auth.users row — is handled by the
-- companion `delete-account` edge function, which calls these RPCs and then
-- auth.admin.deleteUser for the ids they return.
--
-- Apply once in Supabase → SQL Editor (or via MCP). Idempotent.
-- ============================================================

-- 1 · delete_practice — detach multi-practice clients, return single-practice
--     client ids so the edge function can delete their auth users. --------------
-- (Was `returns void`; Postgres can't change a return type via CREATE OR REPLACE,
--  so drop the old signature first.)
drop function if exists delete_practice(uuid);
create or replace function delete_practice(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare deleted_ids uuid[];
begin
  if not is_team() then
    raise exception 'Only team members can delete a practice' using errcode = 'insufficient_privilege';
  end if;

  -- Clients who also belong to another practice: detach, do NOT delete.
  update profiles p
     set practice_id = (select m.practice_id from memberships m
                        where m.user_id = p.id and m.practice_id <> p_id limit 1)
   where p.practice_id = p_id and p.role = 'client'
     and exists (select 1 from memberships m where m.user_id = p.id and m.practice_id <> p_id);

  -- Clients tied only to this practice: their profiles go, and their auth users
  -- must go too (returned to the caller).
  select coalesce(array_agg(p.id), '{}') into deleted_ids
    from profiles p
   where p.practice_id = p_id and p.role = 'client'
     and not exists (select 1 from memberships m where m.user_id = p.id and m.practice_id <> p_id);

  delete from profiles p
   where p.practice_id = p_id and p.role = 'client'
     and not exists (select 1 from memberships m where m.user_id = p.id and m.practice_id <> p_id);

  update profiles set practice_id = null where practice_id = p_id;   -- detach any stragglers
  delete from practices where id = p_id;                             -- cascades all practice-scoped rows

  return jsonb_build_object('ok', true, 'deleted_user_ids', coalesce(to_jsonb(deleted_ids), '[]'::jsonb));
end $$;
grant execute on function delete_practice(uuid) to authenticated;

-- 2 · delete_client — remove one client's local rows (auth user by edge fn). ----
create or replace function delete_client(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not is_team() then return jsonb_build_object('ok', false, 'error', 'team only'); end if;
  select email into v_email from auth.users where id = p_user;
  delete from memberships where user_id = p_user;
  update practice_invites set status = 'revoked'
   where v_email is not null and lower(email) = lower(v_email);
  delete from profiles where id = p_user and role = 'client';
  return jsonb_build_object('ok', true);
end $$;
grant execute on function delete_client(uuid) to authenticated;

-- 3 · reject_account — a real revoke (was a cosmetic flag). --------------------
create or replace function reject_account(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not is_team() then return jsonb_build_object('ok', false, 'error', 'team only'); end if;
  delete from memberships where user_id = p_user;                    -- revoke all data access
  update profiles set approval_status = 'rejected', practice_id = null
   where id = p_user and role = 'client';
  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    update practice_invites set status = 'revoked' where lower(email) = lower(v_email);
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function reject_account(uuid) to authenticated;

-- 4 · remove_practice_member — detach the profile + revert the invite so the
--     removed user gets an honest "no access" state and can be re-invited. ------
create or replace function remove_practice_member(p_practice uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() then raise exception 'Cannot remove yourself'; end if;

  delete from memberships where practice_id = p_practice and user_id = p_user;

  if not exists (select 1 from memberships where user_id = p_user) then
    update profiles set practice_id = null where id = p_user;        -- no memberships left
  else
    update profiles p set practice_id = (select m.practice_id from memberships m
                                         where m.user_id = p_user limit 1)
     where p.id = p_user and p.practice_id = p_practice;             -- repoint to a remaining one
  end if;

  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    update practice_invites set status = 'revoked'
     where practice_id = p_practice and lower(email) = lower(v_email)
       and status in ('pending','sent','accepted');                 -- re-invite can re-claim
  end if;
end $$;
grant execute on function remove_practice_member(uuid, uuid) to authenticated;
