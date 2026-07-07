-- ============================================================
-- Domain auto-join — self-service access by email domain.
--
-- Register a domain ONCE per practice (e.g. "smileclinic.com" -> Practice X).
-- After that, anyone who signs in with an email at that domain is added to the
-- practice automatically on first sign-in — no per-email allowlisting, no SQL
-- per person. Explicit practice_invites still work exactly as before.
--
-- Apply once: paste this whole file into Supabase -> SQL Editor -> Run.
-- Idempotent (safe to re-run).
--
-- SECURITY: never register a PUBLIC email domain (gmail.com, outlook.com, ...)
-- — that would let anyone on the internet into the practice. add_practice_domain
-- rejects the common ones. Only register domains the client actually controls.
-- Domain auto-join grants CLIENT membership to a practice; to make someone a
-- ROXIUM platform admin, promote them with promote_platform_admin() instead.
-- ============================================================

create table if not exists practice_domains (
  id          uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  domain      text not null,
  role        text not null default 'member' check (role in ('owner','member')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now()
);

-- one domain maps to exactly one practice (deterministic routing)
create unique index if not exists practice_domains_domain_uq
  on practice_domains (lower(btrim(domain)));

alter table practice_domains enable row level security;
drop policy if exists "team manages domains" on practice_domains;
create policy "team manages domains" on practice_domains
  for all using (is_team()) with check (is_team());

-- normalized domain part of an email address
create or replace function email_domain(p_email text)
returns text language sql immutable as $$
  select lower(btrim(split_part(btrim(p_email), '@', 2)));
$$;

-- email may sign in if: explicitly invited, already a user, OR its domain is registered
create or replace function email_is_invited(p_email text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from practice_invites
    where lower(btrim(email)) = lower(btrim(p_email)) and status in ('pending','sent')
  ) or exists (
    select 1 from auth.users u where lower(u.email) = lower(btrim(p_email))
  ) or exists (
    select 1 from practice_domains d where lower(btrim(d.domain)) = email_domain(p_email)
  );
$$;
grant execute on function email_is_invited(text) to anon, authenticated;

-- on sign-in: claim explicit invites first, then fall back to domain auto-join
create or replace function claim_invites_for_user()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  em text; dom text; inv record; dm record;
  claimed int := 0; first_practice uuid; disp_name text; has_profile boolean;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not authenticated'); end if;
  select lower(email) into em from auth.users where id = uid;
  if em is null then return jsonb_build_object('ok', false, 'error', 'no email'); end if;
  select exists (select 1 from profiles where id = uid) into has_profile;

  -- 1) explicit allowlist invites
  for inv in select * from practice_invites where lower(btrim(email)) = em and status in ('pending','sent') order by created_at
  loop
    insert into memberships (user_id, practice_id, role) values (uid, inv.practice_id, inv.role)
    on conflict (user_id, practice_id) do update set role = excluded.role;
    update practice_invites set status = 'accepted', accepted_at = coalesce(accepted_at, now()) where id = inv.id;
    if first_practice is null then first_practice := inv.practice_id; disp_name := inv.full_name; end if;
    claimed := claimed + 1;
  end loop;

  -- 2) domain auto-join (only when no explicit invite matched)
  if claimed = 0 then
    dom := email_domain(em);
    for dm in select * from practice_domains where lower(btrim(domain)) = dom
    loop
      insert into memberships (user_id, practice_id, role) values (uid, dm.practice_id, dm.role)
      on conflict (user_id, practice_id) do nothing;
      if first_practice is null then first_practice := dm.practice_id; end if;
      claimed := claimed + 1;
    end loop;
  end if;

  -- create the profile row on first access
  if claimed > 0 and not has_profile then
    insert into profiles (id, role, practice_id, full_name) values (uid, 'client', first_practice, disp_name)
    on conflict (id) do update set practice_id = coalesce(profiles.practice_id, excluded.practice_id),
      full_name = coalesce(profiles.full_name, excluded.full_name);
  end if;

  return jsonb_build_object('ok', true, 'claimed', claimed, 'practice_id', first_practice);
end $$;
grant execute on function claim_invites_for_user() to authenticated;

-- team-only admin RPCs to manage domains from the app (or a one-line SQL call)
create or replace function add_practice_domain(p_practice uuid, p_domain text, p_role text default 'member')
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid; d text := lower(btrim(regexp_replace(p_domain, '^@', ''))); r text := case when p_role = 'owner' then 'owner' else 'member' end;
begin
  if not is_team() then raise exception 'only ROXIUM team can register domains'; end if;
  if d = '' or position('.' in d) = 0 then raise exception 'invalid domain: %', p_domain; end if;
  if d in ('gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','yahoo.com','ymail.com',
           'icloud.com','me.com','mac.com','aol.com','proton.me','protonmail.com','gmx.com','gmx.net','msn.com') then
    raise exception 'public email domains cannot be used for auto-join (%). Invite those users individually instead.', d;
  end if;
  insert into practice_domains (practice_id, domain, role, created_by)
  values (p_practice, d, r, auth.uid())
  on conflict (lower(btrim(domain))) do update set practice_id = excluded.practice_id, role = excluded.role
  returning id into rid;
  return rid;
end $$;
grant execute on function add_practice_domain(uuid, text, text) to authenticated;

create or replace function remove_practice_domain(p_domain text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then raise exception 'only ROXIUM team can remove domains'; end if;
  delete from practice_domains where lower(btrim(domain)) = lower(btrim(regexp_replace(p_domain, '^@', '')));
  return true;
end $$;
grant execute on function remove_practice_domain(text) to authenticated;
