-- ============================================================
-- Practice invites (allowlist) + owner-managed access + auto-claim on login
-- ============================================================
-- Run once in the Supabase SQL editor. Safe + idempotent.

-- Pre-approved emails per practice. Status flow: pending → sent → accepted (or revoked).
-- Team or a practice owner can add rows; login checks this table for allowlist signup.
create table if not exists practice_invites (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'member' check (role in ('owner','member')),
  status text not null default 'pending' check (status in ('pending','sent','accepted','revoked')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz default now(),
  accepted_at timestamptz
);
create unique index if not exists practice_invites_practice_email_uq
  on practice_invites (practice_id, lower(btrim(email)));

alter table practice_invites enable row level security;

create or replace function is_practice_owner(p_practice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and practice_id = p_practice and role = 'owner'
  );
$$;

create or replace function can_invite_to_practice(p_practice uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_team() or is_practice_owner(p_practice);
$$;

drop policy if exists "team practice invites" on practice_invites;
create policy "team practice invites" on practice_invites
  for all using (is_team()) with check (is_team());

drop policy if exists "owner practice invites" on practice_invites;
create policy "owner practice invites" on practice_invites
  for all using (is_practice_owner(practice_id)) with check (is_practice_owner(practice_id));

-- Login gate: allow magic-link signup only for allowlisted emails or existing auth users.
create or replace function email_is_invited(p_email text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists (
    select 1 from practice_invites
    where lower(btrim(email)) = lower(btrim(p_email))
      and status in ('pending','sent')
  ) or exists (
    select 1 from auth.users u where lower(u.email) = lower(btrim(p_email))
  );
$$;
grant execute on function email_is_invited(text) to anon, authenticated;

-- After first login, wire profile + memberships from any pending/sent invites for this email.
create or replace function claim_invites_for_user()
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
  em text;
  inv record;
  claimed int := 0;
  first_practice uuid;
  disp_name text;
begin
  if uid is null then return jsonb_build_object('ok', false, 'error', 'not authenticated'); end if;
  select lower(email) into em from auth.users where id = uid;
  if em is null then return jsonb_build_object('ok', false, 'error', 'no email on account'); end if;

  for inv in
    select * from practice_invites
    where lower(btrim(email)) = em and status in ('pending','sent')
    order by created_at
  loop
    insert into memberships (user_id, practice_id, role)
    values (uid, inv.practice_id, inv.role)
    on conflict (user_id, practice_id) do update set role = excluded.role;
    update practice_invites set status = 'accepted', accepted_at = now() where id = inv.id;
    if first_practice is null then
      first_practice := inv.practice_id;
      disp_name := inv.full_name;
    end if;
    claimed := claimed + 1;
  end loop;

  if claimed > 0 then
    insert into profiles (id, role, practice_id, full_name)
    values (uid, 'client', first_practice, disp_name)
    on conflict (id) do update set
      practice_id = coalesce(profiles.practice_id, excluded.practice_id),
      full_name = coalesce(profiles.full_name, excluded.full_name);
  end if;

  return jsonb_build_object('ok', true, 'claimed', claimed, 'practice_id', first_practice);
end $$;
grant execute on function claim_invites_for_user() to authenticated;

-- Allowlist an email without sending the Supabase invite email yet (team or owner).
create or replace function add_practice_invite(
  p_practice uuid, p_email text, p_full_name text default null, p_role text default 'member'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  r text := case when p_role = 'owner' then 'owner' else 'member' end;
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed to invite to this practice' using errcode = 'insufficient_privilege';
  end if;
  select id into rid from practice_invites
   where practice_id = p_practice and lower(btrim(email)) = lower(btrim(p_email));
  if rid is null then
    insert into practice_invites (practice_id, email, full_name, role, status, invited_by)
    values (p_practice, lower(btrim(p_email)), nullif(btrim(p_full_name), ''), r, 'pending', auth.uid())
    returning id into rid;
  else
    update practice_invites set
      full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
      role = r,
      status = case when status = 'revoked' then 'pending' else status end,
      invited_by = auth.uid()
    where id = rid;
  end if;
  return rid;
end $$;
grant execute on function add_practice_invite(uuid, text, text, text) to authenticated;

create or replace function revoke_practice_invite(p_invite uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr uuid;
begin
  select practice_id into pr from practice_invites where id = p_invite;
  if pr is null then raise exception 'Invite not found'; end if;
  if not can_invite_to_practice(pr) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update practice_invites set status = 'revoked' where id = p_invite and status in ('pending','sent');
end $$;
grant execute on function revoke_practice_invite(uuid) to authenticated;

create or replace function remove_practice_member(p_practice uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_user = auth.uid() then raise exception 'Cannot remove yourself'; end if;
  delete from memberships where practice_id = p_practice and user_id = p_user;
end $$;
grant execute on function remove_practice_member(uuid, uuid) to authenticated;

-- Roster for admin / owner UI (emails from auth.users — not exposed to generic clients).
create or replace function get_practice_roster(p_practice uuid)
returns jsonb language plpgsql security definer set search_path = public, auth as $$
declare members jsonb; invites jsonb;
begin
  if not can_invite_to_practice(p_practice) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', m.user_id, 'email', u.email, 'full_name', p.full_name,
    'role', m.role, 'joined_at', m.created_at
  ) order by m.created_at), '[]'::jsonb) into members
  from memberships m
  join auth.users u on u.id = m.user_id
  left join profiles p on p.id = m.user_id
  where m.practice_id = p_practice;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'email', i.email, 'full_name', i.full_name,
    'role', i.role, 'status', i.status, 'created_at', i.created_at
  ) order by i.created_at), '[]'::jsonb) into invites
  from practice_invites i
  where i.practice_id = p_practice and i.status in ('pending','sent');

  return jsonb_build_object('members', members, 'invites', invites);
end $$;
grant execute on function get_practice_roster(uuid) to authenticated;

-- New practices get an empty sheet_sources row
create or replace function seed_practice(p_name text, p_kickoff date)
returns uuid language plpgsql as $$
declare pid uuid;
begin
  select id into pid from practices where lower(btrim(name)) = lower(btrim(p_name)) limit 1;
  if pid is not null then
    raise exception
      'A practice named "%" already exists (id %). Switch to it instead of creating a duplicate.',
      btrim(p_name), pid using errcode = 'unique_violation';
  end if;

  insert into practices (name, go_live) values (btrim(p_name), p_kickoff) returning id into pid;

  insert into deliverables (practice_id, phase, name, owner_seat, sort) values
    (pid,'Phase 0 · Intelligence','Intake & credentials collection','AL',1),
    (pid,'Phase 0 · Intelligence','Competitive landscape audit','MB',2),
    (pid,'Phase 0 · Intelligence','90-minute brand discovery session','AL',3),
    (pid,'Phase 0 · Intelligence','KPI baseline documented','AL',4),
    (pid,'Phase 1 · Brand Foundation','Style scapes — 2–3 visual directions','BD',5),
    (pid,'Phase 1 · Brand Foundation','Brand Interview & direction selection','AL',6),
    (pid,'Phase 1 · Brand Foundation','Brand guidelines & visual identity','BD',7),
    (pid,'Phase 1 · Brand Foundation','5-layer messaging framework','AL',8),
    (pid,'Phase 1 · Brand Foundation','Content angle & headline hook library','SM',9),
    (pid,'Phase 1 · Brand Foundation','SEO/GEO keyword map','MB',10),
    (pid,'Phase 2 · Video & Authority','Video scripts — SEO videos + VSL','VP',11),
    (pid,'Phase 2 · Video & Authority','Shoot scheduled + facility scout','AL',12),
    (pid,'Phase 2 · Video & Authority','On-site video shoot (1–2 days)','VP',13),
    (pid,'Phase 2 · Video & Authority','SEO education videos edited + captioned','VP',14),
    (pid,'Phase 2 · Video & Authority','Video Sales Letter (VSL) produced','VP',15),
    (pid,'Phase 2 · Video & Authority','Patient testimonial films','VP',16),
    (pid,'Phase 2 · Video & Authority','Platform cuts + thumbnails','VP',17),
    (pid,'Phase 2 · Video & Authority','30-day posting cadence live','SM',18),
    (pid,'Phase 2 · Video & Authority','Patient case classification (visible vs private)','SM',19),
    (pid,'Phase 3 · Web & Landing Pages','Landing page wireframes','WD',20),
    (pid,'Phase 3 · Web & Landing Pages','Recovery landing page','WD',21),
    (pid,'Phase 3 · Web & Landing Pages','Procedure landing pages','WD',22),
    (pid,'Phase 3 · Web & Landing Pages','Booking + thank-you pages','WD',23),
    (pid,'Phase 3 · Web & Landing Pages','Analytics & tracking pixels installed','WD',24),
    (pid,'Phase 4 · Paid Media','Google Ads campaigns built','MB',25),
    (pid,'Phase 4 · Paid Media','Meta creative matrix built','MB',26),
    (pid,'Phase 4 · Paid Media','Full-funnel QA + go-live','AL',27),
    (pid,'Phase 5 · Nurture Engine','7-touch email sequence loaded','AT',28),
    (pid,'Phase 5 · Nurture Engine','5-touch SMS sequence loaded','AT',29),
    (pid,'Phase 5 · Nurture Engine','CRM pipeline configured','AT',30),
    (pid,'Phase 6–7 · Retainer','Monthly analytics report & client call','AL',31),
    (pid,'Phase 6–7 · Retainer','Monthly video content batch','VP',32),
    (pid,'Phase 6–7 · Retainer','Monthly email/SMS sequence refresh','AT',33),
    (pid,'Phase 6–7 · Retainer','Quarterly strategy review','AL',34);

  insert into milestones (practice_id, name, detail, status, target_date, sort) values
    (pid,'Milestone I — Foundation','Marketing audit, brand discovery, style scapes, and your video shoot scheduled.','current', p_kickoff + 21, 1),
    (pid,'Milestone II — Brand Awareness & Value','Recovery videos, patient testimonials, webinars, and your posting cadence live.','upcoming', p_kickoff + 35, 2),
    (pid,'Milestone III — Full Funnel','Landing pages live, paid amplification on, nurture engine running.','upcoming', p_kickoff + 42, 3),
    (pid,'Go-Live & Growth','Campaigns live. Initial ROI window: 1.5–2 months.','upcoming', p_kickoff + 49, 4);

  insert into video_pipeline (practice_id, item, stage) values
    (pid,'Video Sales Letter (VSL)','planned'),
    (pid,'Recovery Masterclass (gated webinar)','planned'),
    (pid,'SEO video — facelift recovery','planned'),
    (pid,'SEO video — rhinoplasty healing','planned'),
    (pid,'SEO video — blepharoplasty','planned'),
    (pid,'SEO video — body contouring','planned'),
    (pid,'Patient testimonial #1','planned'),
    (pid,'Patient testimonial #2','planned'),
    (pid,'Patient testimonial #3','planned'),
    (pid,'Office walkthrough B-roll package','planned');

  insert into sheet_sources (practice_id, is_active, source_type)
  values (pid, true, 'google_sheet_csv')
  on conflict (practice_id) do nothing;

  return pid;
end $$;

-- Backfill sheet_sources for existing practices missing a row
insert into sheet_sources (practice_id, is_active, source_type)
select p.id, true, 'google_sheet_csv' from practices p
where not exists (select 1 from sheet_sources s where s.practice_id = p.id);
