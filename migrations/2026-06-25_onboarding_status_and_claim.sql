-- ============================================================
-- Onboarding status RPC + claim invites on every login
-- Run after 2026-06-24_access_guardrails.sql
-- ============================================================

-- Claim pending/sent allowlist rows whenever the user signs in — not only on first
-- profile creation. Idempotent for already-accepted invites; adds memberships when an
-- existing auth user is allowlisted to a new practice.
create or replace function claim_invites_for_user()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  em text;
  inv record;
  claimed int := 0;
  first_practice uuid;
  disp_name text;
  has_profile boolean;
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;

  select lower(email) into em from auth.users where id = uid;
  if em is null then
    return jsonb_build_object('ok', false, 'error', 'no email');
  end if;

  select exists (select 1 from profiles where id = uid) into has_profile;

  for inv in
    select * from practice_invites
    where lower(btrim(email)) = em and status in ('pending', 'sent')
    order by created_at
  loop
    insert into memberships (user_id, practice_id, role)
    values (uid, inv.practice_id, inv.role)
    on conflict (user_id, practice_id) do update set role = excluded.role;

    update practice_invites
    set status = 'accepted', accepted_at = coalesce(accepted_at, now())
    where id = inv.id;

    if first_practice is null then
      first_practice := inv.practice_id;
      disp_name := inv.full_name;
    end if;
    claimed := claimed + 1;
  end loop;

  if claimed > 0 and not has_profile then
    insert into profiles (id, role, practice_id, full_name)
    values (uid, 'client', first_practice, disp_name)
    on conflict (id) do update
      set practice_id = coalesce(profiles.practice_id, excluded.practice_id),
          full_name = coalesce(profiles.full_name, excluded.full_name);
  end if;

  return jsonb_build_object('ok', true, 'claimed', claimed, 'practice_id', first_practice);
end $$;

-- Admin onboarding wizard: which setup steps are complete for a practice.
create or replace function get_practice_onboarding_status(p_practice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  member_cnt int;
  pending_cnt int;
  has_sheet boolean;
  has_sync boolean;
  sheet_synced_at timestamptz;
begin
  if not is_team() then
    raise exception 'Team access required' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::int into member_cnt
  from memberships where practice_id = p_practice;

  select count(*)::int into pending_cnt
  from practice_invites
  where practice_id = p_practice and status in ('pending', 'sent');

  select exists (
    select 1 from sheet_sources
    where practice_id = p_practice
      and (
        (sheet_id is not null and btrim(sheet_id) <> '')
        or (csv_url is not null and btrim(csv_url) <> '')
      )
  ) into has_sheet;

  select last_synced_at into sheet_synced_at
  from sheet_sources where practice_id = p_practice;

  select (
    sheet_synced_at is not null
    or exists (select 1 from kpi_monthly where practice_id = p_practice limit 1)
  ) into has_sync;

  return jsonb_build_object(
    'practice_id', p_practice,
    'has_access', member_cnt > 0 or pending_cnt > 0,
    'member_count', member_cnt,
    'pending_invites', pending_cnt,
    'has_sheet', has_sheet,
    'has_sync', has_sync,
    'last_synced_at', sheet_synced_at
  );
end $$;
grant execute on function get_practice_onboarding_status(uuid) to authenticated;
