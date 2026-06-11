-- ============================================================
-- ROXIUM CLIENT PORTAL · SUPABASE SCHEMA
-- Run this once in Supabase: SQL Editor → New query → paste → Run
-- ============================================================

-- ---------- CORE TABLES ----------

create table practices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  go_live date,
  created_at timestamptz default now()
);

-- One row per logged-in user. role: 'team' (ROXIUM staff) or 'client' (practice).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'client' check (role in ('team','client')),
  practice_id uuid references practices(id),
  created_at timestamptz default now()
);

-- Monthly KPI inputs — mirrors the KPI workbook blue cells exactly.
create table kpi_monthly (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  month int not null check (month between 1 and 12),
  spend numeric, impr numeric, clicks numeric, lpv numeric, leads numeric,
  cons numeric, proc numeric, apv numeric, price numeric,
  sent numeric, opens numeric, eclk numeric, sms numeric,
  vid numeric, foll numeric, rank numeric, posts numeric,
  updated_at timestamptz default now(),
  unique (practice_id, month)
);

-- "Progress on the things we promised them" — the deliverables tracker.
create table deliverables (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  phase text not null,            -- e.g. 'Phase 2 · Authority'
  name text not null,             -- e.g. 'VSL produced and embedded'
  owner_seat text,                -- AL / BD / VP / WD / MB / SM / AT
  status text not null default 'promised' check (status in ('promised','in_progress','delivered')),
  due date,
  delivered_at timestamptz,
  sort int default 0
);

-- Milestone timeline — so the surgeon always knows where he is and what's next.
create table milestones (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  name text not null,             -- 'Milestone I — Foundation' etc.
  detail text,
  status text not null default 'upcoming' check (status in ('done','current','upcoming')),
  target_date date,
  sort int default 0
);

-- Video production pipeline — makes the cinematography bottleneck visible.
create table video_pipeline (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  item text not null,             -- e.g. 'Facelift recovery SEO video'
  stage text not null default 'scheduled' check (stage in
    ('scheduled','pre_production','shot','editing','delivered','posted')),
  blocked boolean default false,
  blocked_reason text,            -- e.g. 'Surgeon reviewing — awaiting approval'
  updated_at timestamptz default now()
);

-- Activity feed — team posts updates; later, Asana webhooks can write here too.
create table activity (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  message text not null,
  author text,
  source text default 'portal',   -- 'portal' | 'asana' | 'coefficient'
  created_at timestamptz default now()
);

-- ---------- ROW LEVEL SECURITY ----------
-- Clients see ONLY their own practice. Team sees and edits everything.

alter table practices     enable row level security;
alter table profiles      enable row level security;
alter table kpi_monthly   enable row level security;
alter table deliverables  enable row level security;
alter table milestones    enable row level security;
alter table video_pipeline enable row level security;
alter table activity      enable row level security;

create or replace function is_team() returns boolean language sql stable as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'team');
$$;

create or replace function my_practice() returns uuid language sql stable as $$
  select practice_id from profiles where id = auth.uid();
$$;

-- profiles: users read their own row; team reads all; team manages rows.
create policy "own profile"   on profiles for select using (id = auth.uid() or is_team());
create policy "team upserts profiles" on profiles for all using (is_team()) with check (is_team());

-- practices
create policy "read own practice" on practices for select using (is_team() or id = my_practice());
create policy "team writes practices" on practices for all using (is_team()) with check (is_team());

-- data tables: same pattern.
create policy "read kpi"   on kpi_monthly    for select using (is_team() or practice_id = my_practice());
create policy "team kpi"   on kpi_monthly    for all using (is_team()) with check (is_team());
create policy "read deliv" on deliverables   for select using (is_team() or practice_id = my_practice());
create policy "team deliv" on deliverables   for all using (is_team()) with check (is_team());
create policy "read miles" on milestones     for select using (is_team() or practice_id = my_practice());
create policy "team miles" on milestones     for all using (is_team()) with check (is_team());
create policy "read video" on video_pipeline for select using (is_team() or practice_id = my_practice());
create policy "team video" on video_pipeline for all using (is_team()) with check (is_team());
create policy "read activity" on activity    for select using (is_team() or practice_id = my_practice());
create policy "team activity" on activity    for all using (is_team()) with check (is_team());

-- ---------- STORAGE (deliverable files: videos, brand guidelines, reports) ----------
insert into storage.buckets (id, name, public) values ('deliverables','deliverables', false);
create policy "read own files" on storage.objects for select
  using (bucket_id = 'deliverables' and (is_team() or (storage.foldername(name))[1] = my_practice()::text));
create policy "team uploads" on storage.objects for insert
  with check (bucket_id = 'deliverables' and is_team());

-- ---------- SEED: demo practice + standard deliverables ----------
insert into practices (name, go_live) values ('Demo Practice', current_date) returning id;
-- Copy the returned id, then (after creating users in Auth) link profiles:
--   insert into profiles (id, full_name, role) values ('<auth-user-uuid>', 'Your Name', 'team');
--   insert into profiles (id, full_name, role, practice_id) values ('<client-uuid>', 'Dr. Client', 'client', '<practice-id>');
