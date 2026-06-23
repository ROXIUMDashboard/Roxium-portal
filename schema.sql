-- ============================================================
-- ROXIUM CLIENT PORTAL · SUPABASE SCHEMA
-- ------------------------------------------------------------
-- This file mirrors the LIVE database (project nchtmeqsjkpcvtuscxfy).
-- Run it once on a fresh Supabase project: SQL Editor → New query → paste → Run.
-- It is safe to re-run: every object uses CREATE ... IF NOT EXISTS / OR REPLACE
-- or DROP ... IF EXISTS first, so it will not clobber data on an existing project.
-- ============================================================

-- ---------- CORE TABLES ----------

create table if not exists practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  go_live date,
  created_at timestamptz default now()
);
-- One practice per name (trimmed, case-insensitive) — prevents duplicate "Balikians".
create unique index if not exists practices_name_lower_uq on practices (lower(btrim(name)));

-- One row per logged-in user. role: 'team' (ROXIUM staff) or 'client' (practice).
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'client' check (role in ('team','client')),
  practice_id uuid references practices(id),
  created_at timestamptz default now()
);

-- Monthly KPI snapshots — mirrors the KPI workbook blue cells exactly.
-- Keyed by `period` (first-of-month DATE) + `source`, so every calendar month is its
-- own immutable snapshot: re-reporting a later month can never overwrite an earlier one,
-- and marketing / coefficient / future Asana data coexist under one practice.
-- `month` is auto-derived from `period` (see sync_kpi_month) and kept only for the
-- 1..12 check + the "stats ready" notification copy.
create table if not exists kpi_monthly (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  period date not null,                                  -- first day of the reported month
  source text not null default 'marketing',              -- 'marketing' | 'coefficient' | 'asana' | …
  month int not null check (month between 1 and 12),     -- derived from period via trigger
  spend numeric, impr numeric, clicks numeric, lpv numeric, leads numeric,
  cons numeric, proc numeric, apv numeric, price numeric,
  sent numeric, opens numeric, eclk numeric, sms numeric,
  vid numeric, foll numeric, rank numeric, posts numeric,
  updated_at timestamptz default now(),
  unique (practice_id, period, source)
);

-- "Progress on the things we promised them" — the deliverables tracker.
-- Grouped into draggable phase cards in the UI: phase_order sets card order,
-- sort sets row order inside a card.
create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  phase text not null,            -- e.g. 'Phase 2 · Video & Authority'
  name text not null,             -- e.g. 'VSL produced and embedded'
  owner_seat text,                -- AL / BD / VP / WD / MB / SM / AT
  status text not null default 'promised' check (status in ('promised','in_progress','delivered')),
  due date,
  delivered_at timestamptz,
  sort int default 0,
  phase_order int default 0,
  description text,               -- client-facing "what this deliverable means" guide
  status_since timestamptz default now(),  -- when status last changed (drives team SLA colours)
  asana_task_id text             -- maps to an Asana task for promised/delivered sync (Phase D)
);
create unique index if not exists deliverables_practice_asana_uq
  on deliverables (practice_id, asana_task_id) where asana_task_id is not null;

-- Milestone timeline — so the surgeon always knows where he is and what's next.
create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  name text not null,             -- 'Milestone I — Foundation' etc.
  detail text,
  status text not null default 'upcoming' check (status in ('done','current','upcoming')),
  target_date date,
  sort int default 0
);

-- Video production pipeline — makes the cinematography bottleneck visible.
-- stage_since drives "days in stage"; shot_date/posted_date are auto-stamped
-- by the stage trigger; video_url is the finished asset shown to the client.
create table if not exists video_pipeline (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  item text not null,             -- e.g. 'Facelift recovery SEO video'
  stage text not null default 'planned' check (stage in
    ('planned','scheduled','pre_production','shot','editing','delivered','posted')),
  blocked boolean default false,
  blocked_reason text,            -- e.g. 'Surgeon reviewing — awaiting approval'
  updated_at timestamptz default now(),
  stage_since timestamptz default now(),
  planned_shoot_date date,
  shot_date date,
  posted_date date,
  video_url text,
  sort int default 0,
  description text
);

-- Per-asset stage history (auto-written by the triggers below).
create table if not exists video_history (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references video_pipeline(id) on delete cascade,
  practice_id uuid not null references practices(id) on delete cascade,
  stage text not null,
  note text,
  moved_at timestamptz default now()
);

-- Activity feed — team posts updates; later, Asana webhooks can write here too.
create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  message text not null,
  author text,
  source text default 'portal',   -- 'portal' | 'asana' | 'coefficient'
  created_at timestamptz default now(),
  edited_at timestamptz           -- set when a posted update is edited (shows "(edited)")
);

-- Client-facing banner notifications (deliverable shipped, video posted, stats ready).
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  kind text not null,             -- 'deliverable' | 'milestone' | 'video' | 'stats'
  message text not null,
  seen boolean default false,
  emailed boolean default false,
  created_at timestamptz default now()
);

-- Org membership: who can access which practice, and in what capacity.
-- This is the access-control layer (many users per practice, many practices per
-- user). `profiles.practice_id` is kept as each user's default/active practice.
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_id uuid not null references practices(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz default now(),
  unique (user_id, practice_id)
);

-- ---------- ROW LEVEL SECURITY ----------
-- Clients see ONLY their own practice. Team sees and edits everything.

alter table practices      enable row level security;
alter table profiles       enable row level security;
alter table kpi_monthly    enable row level security;
alter table deliverables   enable row level security;
alter table milestones     enable row level security;
alter table video_pipeline enable row level security;
alter table video_history  enable row level security;
alter table activity       enable row level security;
alter table notifications  enable row level security;
alter table memberships    enable row level security;

-- security definer: these helpers read profiles directly without re-triggering
-- the profiles RLS policy (prevents infinite recursion on profile lookups).
create or replace function is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'team');
$$;

create or replace function my_practice() returns uuid
language sql stable security definer set search_path = public as $$
  select practice_id from profiles where id = auth.uid();
$$;

-- Membership test: is the current user attached to this practice? Drives all
-- client-facing read policies, so a practice can have many users.
create or replace function is_member_of(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships where user_id = auth.uid() and practice_id = p
  );
$$;

-- profiles: users read their own row; team reads all; team manages rows.
drop policy if exists "own profile" on profiles;
create policy "own profile"   on profiles for select using (id = auth.uid() or is_team());
drop policy if exists "team upserts profiles" on profiles;
create policy "team upserts profiles" on profiles for all using (is_team()) with check (is_team());

-- memberships: user reads their own; team reads/manages all (invites write via service role).
drop policy if exists "read memberships" on memberships;
create policy "read memberships" on memberships for select using (is_team() or user_id = auth.uid());
drop policy if exists "team memberships" on memberships;
create policy "team memberships" on memberships for all using (is_team()) with check (is_team());

-- practices
drop policy if exists "read own practice" on practices;
create policy "read own practice" on practices for select using (is_team() or is_member_of(id));
drop policy if exists "team writes practices" on practices;
create policy "team writes practices" on practices for all using (is_team()) with check (is_team());

-- data tables: client reads its own practice, team does everything.
drop policy if exists "read kpi" on kpi_monthly;
create policy "read kpi"   on kpi_monthly    for select using (is_team() or is_member_of(practice_id));
drop policy if exists "team kpi" on kpi_monthly;
create policy "team kpi"   on kpi_monthly    for all using (is_team()) with check (is_team());

drop policy if exists "read deliv" on deliverables;
create policy "read deliv" on deliverables   for select using (is_team() or is_member_of(practice_id));
drop policy if exists "team deliv" on deliverables;
create policy "team deliv" on deliverables   for all using (is_team()) with check (is_team());

drop policy if exists "read miles" on milestones;
create policy "read miles" on milestones     for select using (is_team() or is_member_of(practice_id));
drop policy if exists "team miles" on milestones;
create policy "team miles" on milestones     for all using (is_team()) with check (is_team());

drop policy if exists "read video" on video_pipeline;
create policy "read video" on video_pipeline for select using (is_team() or is_member_of(practice_id));
drop policy if exists "team video" on video_pipeline;
create policy "team video" on video_pipeline for all using (is_team()) with check (is_team());

-- video_history: client reads its own; team manages; explicit delete for clarity.
drop policy if exists "read vh" on video_history;
create policy "read vh" on video_history for select using (is_team() or is_member_of(practice_id));
drop policy if exists "team vh" on video_history;
create policy "team vh" on video_history for all using (is_team()) with check (is_team());
drop policy if exists "team delete vh" on video_history;
create policy "team delete vh" on video_history for delete using (is_team());

drop policy if exists "read activity" on activity;
create policy "read activity" on activity    for select using (is_team() or is_member_of(practice_id));
drop policy if exists "team activity" on activity;
create policy "team activity" on activity    for all using (is_team()) with check (is_team());

-- notifications: client reads its own + can flag them seen; inserts come from the
-- notify() trigger helper (security definer) and from the team; team manages all.
drop policy if exists "read notif" on notifications;
create policy "read notif" on notifications for select using (is_team() or is_member_of(practice_id));
drop policy if exists "insert notif" on notifications;
create policy "insert notif" on notifications for insert with check (true);
drop policy if exists "client seen" on notifications;
create policy "client seen" on notifications for update using (is_member_of(practice_id)) with check (is_member_of(practice_id));
drop policy if exists "team notif" on notifications;
create policy "team notif" on notifications for all using (is_team()) with check (is_team());

-- ---------- TRIGGERS: history + notifications ----------

-- Drop one banner-notification row for a practice (used by triggers).
create or replace function notify(p_practice uuid, p_kind text, p_msg text) returns void
language sql security definer set search_path = public as $$
  insert into notifications(practice_id, kind, message) values (p_practice, p_kind, p_msg);
$$;

-- Log the starting stage when a video asset is created.
create or replace function log_video_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into video_history(video_id, practice_id, stage) values (new.id, new.practice_id, new.stage);
  return new;
end $$;

-- On a stage change: stamp stage_since, auto-fill shot/posted dates, and log
-- history ONLY for forward progression in the canonical workflow. Backward moves
-- still restamp stage_since/dates but must not inflate progression history.
create or replace function log_video_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ord text[] := array['planned','scheduled','pre_production','shot','editing','delivered','posted'];
  old_i int := array_position(ord, old.stage);
  new_i int := array_position(ord, new.stage);
begin
  if (new.stage is distinct from old.stage) then
    new.stage_since := now();
    if new.stage = 'shot'   and new.shot_date   is null then new.shot_date   := current_date; end if;
    if new.stage = 'posted' and new.posted_date is null then new.posted_date := current_date; end if;
    if new_i is not null and old_i is not null and new_i > old_i then
      insert into video_history(video_id, practice_id, stage) values (new.id, new.practice_id, new.stage);
    end if;
  end if;
  return new;
end $$;

-- Stamp deliverables.status_since whenever the status changes (drives team SLA colours).
create or replace function touch_deliv_status() returns trigger
language plpgsql as $$
begin
  if new.status is distinct from old.status then new.status_since := now(); end if;
  return new;
end $$;

-- Keep `month` derived from `period` and refresh updated_at on every KPI write.
create or replace function sync_kpi_month() returns trigger
language plpgsql as $$
begin
  if new.period is not null then
    new.month := extract(month from new.period)::int;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- When a KPI month is reported, drop the client a "stats ready" banner.
create or replace function notif_stats() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Skip implausible/future periods (typos like 2030) so they can't create a
  -- stale "Your <month> update is ready" banner.
  if new.period > (date_trunc('month', now()) + interval '1 month')::date then
    return new;
  end if;
  perform notify(new.practice_id, 'stats',
    'Your ' || to_char(new.period, 'Mon YYYY') || ' performance update is ready.');
  return new;
end $$;

drop trigger if exists trg_video_insert on video_pipeline;
create trigger trg_video_insert after insert on video_pipeline
  for each row execute function log_video_insert();

drop trigger if exists trg_video_stage on video_pipeline;
create trigger trg_video_stage before update on video_pipeline
  for each row execute function log_video_stage();

drop trigger if exists trg_sync_kpi_month on kpi_monthly;
create trigger trg_sync_kpi_month before insert or update on kpi_monthly
  for each row execute function sync_kpi_month();

drop trigger if exists trg_deliv_status on deliverables;
create trigger trg_deliv_status before update on deliverables
  for each row execute function touch_deliv_status();

drop trigger if exists trg_notif_stats on kpi_monthly;
create trigger trg_notif_stats after insert on kpi_monthly
  for each row execute function notif_stats();

-- ---------- STORAGE (deliverable files: videos, brand guidelines, reports) ----------
insert into storage.buckets (id, name, public) values ('deliverables','deliverables', false)
  on conflict (id) do nothing;
drop policy if exists "read own files" on storage.objects;
create policy "read own files" on storage.objects for select
  using (bucket_id = 'deliverables' and (is_team() or exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.practice_id::text = (storage.foldername(name))[1]
  )));
drop policy if exists "team uploads" on storage.objects;
create policy "team uploads" on storage.objects for insert
  with check (bucket_id = 'deliverables' and is_team());

-- ============================================================
-- SEED SYSTEM · one call creates a fully loaded practice
-- Usage (SQL Editor):  select seed_practice('Balikian Plastic Surgery', '2026-07-01');
-- Returns the new practice id. Run once per new client.
-- ============================================================

-- Delete a practice and everything under it (team-only). Practice-scoped data
-- (kpi/deliverables/milestones/video/history/notifications/memberships) cascades
-- via on-delete-cascade FKs; client profiles are removed, other profiles detached.
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

-- Phase D · emails of a practice's client users (for the email Edge Functions).
-- SECURITY DEFINER so the service-role functions can read auth.users; not for clients.
create or replace function practice_member_emails(p_id uuid)
returns table(email text)
language sql security definer set search_path = public, auth as $$
  select u.email from auth.users u
    join memberships m on m.user_id = u.id
   where m.practice_id = p_id and u.email is not null
  union
  select u.email from auth.users u
    join profiles pr on pr.id = u.id
   where pr.practice_id = p_id and pr.role = 'client' and u.email is not null;
$$;
revoke all on function practice_member_emails(uuid) from public, anon, authenticated;

create or replace function seed_practice(p_name text, p_kickoff date)
returns uuid language plpgsql as $$
declare pid uuid;
begin
  -- Guard against duplicate practices (the cause of the "two Balikians" bug):
  -- if a practice with the same trimmed, case-insensitive name already exists,
  -- refuse rather than silently create a second, empty one. The caller (team UI
  -- or SQL) gets a clear error and should use / switch to the existing practice.
  select id into pid from practices where lower(btrim(name)) = lower(btrim(p_name)) limit 1;
  if pid is not null then
    raise exception
      'A practice named "%" already exists (id %). Switch to it instead of creating a duplicate.',
      btrim(p_name), pid using errcode = 'unique_violation';
  end if;

  insert into practices (name, go_live) values (btrim(p_name), p_kickoff) returning id into pid;

  -- ---- Standard deliverables (from the Execution Workbook / Asana framework) ----
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

  -- ---- Milestone roadmap (dates computed from kickoff) ----
  insert into milestones (practice_id, name, detail, status, target_date, sort) values
    (pid,'Milestone I — Foundation','Marketing audit, brand discovery, style scapes, and your video shoot scheduled.','current', p_kickoff + 21, 1),
    (pid,'Milestone II — Brand Awareness & Value','Recovery videos, patient testimonials, webinars, and your posting cadence live.','upcoming', p_kickoff + 35, 2),
    (pid,'Milestone III — Full Funnel','Landing pages live, paid amplification on, nurture engine running.','upcoming', p_kickoff + 42, 3),
    (pid,'Go-Live & Growth','Campaigns live. Initial ROI window: 1.5–2 months.','upcoming', p_kickoff + 49, 4);

  -- ---- Standard video pipeline (assets start in 'planned' / backlog) ----
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

  return pid;
end $$;

-- Create your first practice (edit the name and kickoff date), then link users:
--   select seed_practice('Demo Practice', current_date);
--   insert into profiles (id, full_name, role) values ('<auth-user-uuid>', 'Your Name', 'team');
--   insert into profiles (id, full_name, role, practice_id) values ('<client-uuid>', 'Dr. Client', 'client', '<practice-id>');
