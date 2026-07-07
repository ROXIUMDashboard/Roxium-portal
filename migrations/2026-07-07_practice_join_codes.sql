-- ============================================================
-- Practice invite links (join codes) — self-service access for ANY email.
--
-- Unlike domain auto-join (which only works when a client controls their own
-- email domain), a join code works for gmail.com / personal emails too. You
-- share ONE link per practice — e.g. https://roxium.com/?join=A1B2C3D4 — and
-- anyone who opens it and signs in (any email) is added to THAT practice on
-- first sign-in. No per-email allowlisting, no SQL per person.
--
-- Apply once: paste this whole file into Supabase -> SQL Editor -> Run.
-- Idempotent (safe to re-run).
--
-- SECURITY: the code IS the credential (like a Slack/Notion invite link).
-- Anyone with the link can join that one practice as a 'member'. Rotate it with
-- rotate_practice_join_code() if a link leaks; clear it to disable self-join.
-- Join grants CLIENT membership only; ROXIUM platform admins are still promoted
-- separately with promote_platform_admin().
-- ============================================================

alter table practices add column if not exists join_code text;
create unique index if not exists practices_join_code_uq
  on practices (join_code) where join_code is not null;

-- who may manage a practice's link: ROXIUM team, or an owner of that practice
create or replace function _can_manage_join_code(p_practice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team() or exists (
    select 1 from memberships
    where user_id = auth.uid() and practice_id = p_practice and role = 'owner'
  );
$$;

-- get the practice's link, creating a code on first use (stable — same link on repeat calls)
create or replace function practice_join_link(p_practice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not _can_manage_join_code(p_practice) then
    raise exception 'only ROXIUM team or a practice owner can manage the invite link';
  end if;
  select join_code into code from practices where id = p_practice;
  if code is null then
    loop
      code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      exit when not exists (select 1 from practices where join_code = code);
    end loop;
    update practices set join_code = code where id = p_practice;
  end if;
  return code;
end $$;
grant execute on function practice_join_link(uuid) to authenticated;

-- rotate (invalidate the old link, mint a new one)
create or replace function rotate_practice_join_code(p_practice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not _can_manage_join_code(p_practice) then
    raise exception 'only ROXIUM team or a practice owner can manage the invite link';
  end if;
  loop
    code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from practices where join_code = code);
  end loop;
  update practices set join_code = code where id = p_practice;
  return code;
end $$;
grant execute on function rotate_practice_join_code(uuid) to authenticated;

-- disable self-join (clears the code)
create or replace function clear_practice_join_code(p_practice uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not _can_manage_join_code(p_practice) then
    raise exception 'only ROXIUM team or a practice owner can manage the invite link';
  end if;
  update practices set join_code = null where id = p_practice;
  return true;
end $$;
grant execute on function clear_practice_join_code(uuid) to authenticated;

-- validity check for the login gate (anon-callable): does this code map to a practice?
create or replace function join_code_practice(p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from practices where join_code = upper(btrim(p_code)) and p_code is not null and btrim(p_code) <> '';
$$;
grant execute on function join_code_practice(text) to anon, authenticated;

-- redeem a code after sign-in: add the caller to the practice (+ create profile)
create or replace function join_practice_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare uid uuid := auth.uid(); pid uuid; has_profile boolean;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  select id into pid from practices where join_code = upper(btrim(p_code));
  if pid is null then return null; end if;

  insert into memberships (user_id, practice_id, role) values (uid, pid, 'member')
    on conflict (user_id, practice_id) do nothing;

  select exists (select 1 from profiles where id = uid) into has_profile;
  if not has_profile then
    insert into profiles (id, role, practice_id) values (uid, 'client', pid)
      on conflict (id) do update set practice_id = coalesce(profiles.practice_id, excluded.practice_id);
  end if;

  return pid;
end $$;
grant execute on function join_practice_by_code(text) to authenticated;
