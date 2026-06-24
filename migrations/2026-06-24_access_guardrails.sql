-- ============================================================
-- Access guardrails: last admin / last owner protection + recovery helpers
-- ============================================================
-- Run in Supabase SQL editor after 2026-06-24_practice_invites_and_access.sql

-- ---- helpers ----
create or replace function count_team_admins()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from profiles where role = 'team';
$$;

create or replace function count_practice_owners(p_practice uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from memberships where practice_id = p_practice and role = 'owner';
$$;

create or replace function count_pending_owner_invites(p_practice uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from practice_invites
   where practice_id = p_practice and role = 'owner' and status in ('pending','sent');
$$;

-- Returns NULL if removal is allowed, else a human-readable block reason.
create or replace function member_removal_block_reason(p_practice uuid, p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare owners int; pending_owners int; is_owner boolean; is_plat boolean; admins int;
begin
  if p_user = auth.uid() then
    return 'You cannot remove your own access. Ask another administrator or practice owner.';
  end if;

  select exists (select 1 from profiles where id = p_user and role = 'team') into is_plat;
  if is_plat then
    select count_team_admins() into admins;
    if admins <= 1 then
      return 'Cannot remove the only platform administrator. Promote another admin first.';
    end if;
  end if;

  select exists (
    select 1 from memberships where practice_id = p_practice and user_id = p_user and role = 'owner'
  ) into is_owner;

  if is_owner then
    select count_practice_owners(p_practice) into owners;
    select count_pending_owner_invites(p_practice) into pending_owners;
    if owners <= 1 and pending_owners = 0 then
      return 'Cannot remove the last owner for this practice. Invite another owner first.';
    end if;
  end if;

  return null;
end $$;

-- ---- hardened mutations ----
create or replace function remove_practice_member(p_practice uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare reason text;
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  reason := member_removal_block_reason(p_practice, p_user);
  if reason is not null then
    raise exception '%', reason using errcode = 'check_violation';
  end if;
  delete from memberships where practice_id = p_practice and user_id = p_user;
end $$;

create or replace function set_practice_member_role(p_practice uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
declare
  new_role text := case when p_role = 'owner' then 'owner' else 'member' end;
  owners int;
  pending int;
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() and new_role <> 'owner' then
    select count_practice_owners(p_practice) into owners;
    select count_pending_owner_invites(p_practice) into pending;
    if owners <= 1 and pending = 0 then
      raise exception 'You are the last owner for this practice. Promote another owner before changing your role.'
        using errcode = 'check_violation';
    end if;
  end if;
  if exists (select 1 from memberships where practice_id = p_practice and user_id = p_user and role = 'owner')
     and new_role = 'member' then
    select count_practice_owners(p_practice) into owners;
    select count_pending_owner_invites(p_practice) into pending;
    if owners <= 1 and pending = 0 then
      raise exception 'Cannot demote the last owner for this practice. Invite another owner first.'
        using errcode = 'check_violation';
    end if;
  end if;
  update memberships set role = new_role where practice_id = p_practice and user_id = p_user;
end $$;
grant execute on function set_practice_member_role(uuid, uuid, text) to authenticated;

create or replace function revoke_practice_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr uuid; inv_role text; owners int; pending int;
begin
  select practice_id, role into pr, inv_role from practice_invites where id = p_invite;
  if pr is null then raise exception 'Invite not found'; end if;
  if not can_invite_to_practice(pr) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if inv_role = 'owner' then
    select count_practice_owners(pr) into owners;
    select count_pending_owner_invites(pr) into pending;
    if owners = 0 and pending <= 1 then
      raise exception 'Cannot revoke the last pending owner invite. Add another owner first.'
        using errcode = 'check_violation';
    end if;
  end if;
  update practice_invites set status = 'revoked' where id = p_invite and status in ('pending','sent');
end $$;

-- Platform admin roster (Admin panel only — not practice-scoped).
create or replace function get_platform_admins()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare rows jsonb; uid uuid := auth.uid(); admin_cnt int;
begin
  if not is_team() then raise exception 'Team access required' using errcode = 'insufficient_privilege'; end if;
  select count_team_admins() into admin_cnt;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'email', u.email,
    'full_name', p.full_name,
    'is_self', p.id = uid,
    'can_demote', p.id <> uid and admin_cnt > 1
  ) order by p.full_name), '[]'::jsonb) into rows
  from profiles p
  join auth.users u on u.id = p.id
  where p.role = 'team';
  return jsonb_build_object('admins', rows, 'admin_count', admin_cnt);
end $$;
grant execute on function get_platform_admins() to authenticated;

create or replace function demote_platform_admin(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then raise exception 'Team access required' using errcode = 'insufficient_privilege'; end if;
  if p_user = auth.uid() then
    raise exception 'You cannot remove your own platform administrator access.'
      using errcode = 'check_violation';
  end if;
  if count_team_admins() <= 1 then
    raise exception 'Cannot demote the only platform administrator. Promote another admin first.'
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from profiles where id = p_user and role = 'team') then
    raise exception 'User is not a platform administrator';
  end if;
  update profiles set role = 'client' where id = p_user and role = 'team';
end $$;
grant execute on function demote_platform_admin(uuid) to authenticated;

-- Trigger: never demote/delete the last profiles.role = 'team' row (even via Table Editor).
create or replace function protect_last_team_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'team' and count_team_admins() <= 1 then
      raise exception 'Cannot delete the only platform administrator.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and old.role = 'team' and new.role is distinct from 'team' then
    if count_team_admins() <= 1 then
      raise exception 'Cannot demote the only platform administrator.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_protect_last_team_admin on profiles;
create trigger trg_protect_last_team_admin
  before update or delete on profiles
  for each row execute function protect_last_team_admin();

-- Richer practice roster for UI (can_remove flags, platform admin badge).
create or replace function get_practice_roster(p_practice uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare members jsonb; invites jsonb; uid uuid := auth.uid(); client_view boolean;
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  client_view := not is_team();

  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id,
    'email', u.email,
    'full_name', p.full_name,
    'role', m.role,
    'joined_at', m.created_at,
    'is_self', m.user_id = uid,
    'is_platform_admin', p.role = 'team',
    'can_remove', (
      not client_view or p.role <> 'team'
    ) and member_removal_block_reason(p_practice, m.user_id) is null
  ) order by m.created_at), '[]'::jsonb) into members
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.practice_id = p_practice;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'email', i.email,
    'full_name', i.full_name,
    'role', i.role,
    'status', i.status,
    'created_at', i.created_at,
    'can_revoke', not (
      i.role = 'owner'
      and count_practice_owners(p_practice) = 0
      and count_pending_owner_invites(p_practice) <= 1
    )
  ) order by i.created_at), '[]'::jsonb) into invites
  from practice_invites i
  where i.practice_id = p_practice and i.status in ('pending','sent');

  return jsonb_build_object(
    'members', members,
    'invites', invites,
    'owner_count', count_practice_owners(p_practice),
    'pending_owner_invites', count_pending_owner_invites(p_practice)
  );
end $$;

-- ============================================================
-- RECOVERY (run manually if locked out of Admin):
--   select id, email from auth.users where email = 'you@example.com';
--   update profiles set role = 'team' where id = '<your-user-uuid>';
--   insert into memberships (user_id, practice_id, role)
--   values ('<uuid>', '<practice-uuid>', 'owner') on conflict do nothing;
-- ============================================================
