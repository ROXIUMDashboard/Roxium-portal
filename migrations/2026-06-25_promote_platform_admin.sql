-- ============================================================
-- Promote an existing portal user to platform administrator (Admin panel UI)
-- ============================================================
-- Run in Supabase SQL editor after 2026-06-24_access_guardrails.sql
--
-- Pairs with demote_platform_admin(): lets a current admin grant Admin-panel
-- access by email, instead of editing profiles.role by hand in the Table Editor.
-- The target must already have signed in once (so a profiles row exists).

create or replace function promote_platform_admin(p_email text)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare target_id uuid; target_role text; norm text := lower(trim(p_email));
begin
  if not is_team() then
    raise exception 'Team access required' using errcode = 'insufficient_privilege';
  end if;
  if norm = '' or norm is null then
    raise exception 'Enter an email to promote.' using errcode = 'check_violation';
  end if;

  select p.id, p.role into target_id, target_role
  from profiles p
  join auth.users u on u.id = p.id
  where lower(u.email) = norm;

  if target_id is null then
    raise exception 'No portal account uses %. Ask them to sign in once, then promote them.', p_email
      using errcode = 'no_data_found';
  end if;
  if target_role = 'team' then
    raise exception '% is already a platform administrator.', p_email
      using errcode = 'unique_violation';
  end if;

  update profiles set role = 'team' where id = target_id;
  return jsonb_build_object('user_id', target_id, 'email', norm, 'promoted', true);
end $$;
grant execute on function promote_platform_admin(text) to authenticated;
