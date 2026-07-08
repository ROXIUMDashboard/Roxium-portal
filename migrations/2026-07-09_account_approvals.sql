-- ============================================================
-- Account approvals — self-service signup, invite-only ACCESS.
--
-- Anyone may create a ROXIUM account (Stripe-style self-service), but nobody
-- reaches client data until they are approved:
--   • Invitation match (Option A): signing in with an invited email claims the
--     invite → membership is created → a trigger auto-approves the profile.
--     The invitation IS the approval; no admin action needed.
--   • Request access (Option B): an un-invited signup gets a profile in
--     'pending' state with NO memberships — RLS already denies every practice
--     table without a membership, so a pending account can see nothing. Team
--     reviews it in Team Controls → Access & Invites → Account approvals.
--
-- Apply once in Supabase → SQL Editor (or via MCP). Idempotent.
-- ============================================================

-- 1 · Approval state on profiles ------------------------------------------
alter table profiles add column if not exists approval_status text not null default 'pending';
alter table profiles add column if not exists requested_at timestamptz default now();

do $$ begin
  alter table profiles
    add constraint profiles_approval_status_chk
    check (approval_status in ('pending','approved','rejected'));
exception when duplicate_object then null; end $$;

-- Backfill: any profile with existing legitimacy is approved. (Semantically
-- idempotent — team members, anyone holding a membership / practice link, or
-- anyone whose email matches a practice invite was already vetted.)
update profiles p set approval_status = 'approved'
 where p.approval_status = 'pending'
   and ( p.role = 'team'
      or p.practice_id is not null
      or exists (select 1 from memberships m where m.user_id = p.id)
      or exists (select 1 from practice_invites i
                 join auth.users u on u.id = p.id
                 where lower(i.email) = lower(coalesce(u.email,''))) );

-- 2 · Membership = approval -------------------------------------------------
-- Whatever path creates a membership (invite claim, join code, admin action),
-- the profile becomes approved — an assignment to a practice IS the approval.
create or replace function approve_profile_on_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles
     set approval_status = 'approved',
         practice_id = coalesce(practice_id, new.practice_id)
   where id = new.user_id and approval_status <> 'approved';
  return new;
end $$;

drop trigger if exists trg_memberships_approve on memberships;
create trigger trg_memberships_approve
  after insert on memberships
  for each row execute function approve_profile_on_membership();

-- 3 · Self-service profile bootstrap ---------------------------------------
-- Un-invited signups have an auth user but no profile row (clients cannot
-- insert into profiles under RLS). The portal calls this right after sign-in;
-- it is safe to call repeatedly and never escalates an existing profile.
create or replace function ensure_my_profile(p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;
  insert into profiles (id, full_name, role, approval_status)
  values (auth.uid(), nullif(trim(coalesce(p_name,'')), ''), 'client', 'pending')
  on conflict (id) do nothing;
  select approval_status into v_status from profiles where id = auth.uid();
  return jsonb_build_object('ok', true, 'status', coalesce(v_status,'pending'));
end $$;
grant execute on function ensure_my_profile(text) to authenticated;

-- 4 · Team review RPCs -------------------------------------------------------
-- Pending / rejected client accounts, with the email from auth (profiles does
-- not store emails). Team-only.
create or replace function get_pending_accounts()
returns table(id uuid, email text, full_name text, requested_at timestamptz, status text)
language sql security definer stable set search_path = public as $$
  select p.id, u.email, p.full_name, coalesce(p.requested_at, p.created_at), p.approval_status
  from profiles p
  join auth.users u on u.id = p.id
  where is_team()
    and p.role = 'client'
    and p.approval_status <> 'approved'
  order by coalesce(p.requested_at, p.created_at) desc;
$$;
grant execute on function get_pending_accounts() to authenticated;

-- Approve + assign to a practice in one step (the membership trigger flips the
-- profile to approved). Also marks any matching allowlist invite accepted.
create or replace function approve_account(p_user uuid, p_practice uuid, p_role text default 'member')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if not is_team() then return jsonb_build_object('ok', false, 'error', 'team only'); end if;
  if p_role not in ('owner','member') then p_role := 'member'; end if;
  if not exists (select 1 from practices where id = p_practice) then
    return jsonb_build_object('ok', false, 'error', 'practice not found');
  end if;
  insert into memberships (user_id, practice_id, role)
  values (p_user, p_practice, p_role)
  on conflict (user_id, practice_id) do update set role = excluded.role;
  update profiles set approval_status = 'approved',
                      practice_id = coalesce(practice_id, p_practice)
   where id = p_user;
  select email into v_email from auth.users where id = p_user;
  if v_email is not null then
    update practice_invites set status = 'accepted', accepted_at = now()
     where practice_id = p_practice and lower(email) = lower(v_email);
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function approve_account(uuid, uuid, text) to authenticated;

-- Reject (revocable: approving later still works via approve_account).
create or replace function reject_account(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_team() then return jsonb_build_object('ok', false, 'error', 'team only'); end if;
  update profiles set approval_status = 'rejected'
   where id = p_user and role = 'client';
  return jsonb_build_object('ok', true);
end $$;
grant execute on function reject_account(uuid) to authenticated;
