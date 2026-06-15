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

-- ============================================================
-- SEED SYSTEM · one call creates a fully loaded practice
-- Usage (SQL Editor):  select seed_practice('Balikian Plastic Surgery', '2026-07-01');
-- Returns the new practice id. Run once per new client.
-- ============================================================

create or replace function seed_practice(p_name text, p_kickoff date)
returns uuid language plpgsql as $$
declare pid uuid;
begin
  insert into practices (name, go_live) values (p_name, p_kickoff) returning id into pid;

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

  -- ---- Standard video pipeline ----
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

-- Create your first practice now (edit the name and kickoff date):
select seed_practice('Demo Practice', current_date);

-- After creating users under Authentication → Users, link them:
--   insert into profiles (id, full_name, role) values ('<auth-user-uuid>', 'Your Name', 'team');
--   insert into profiles (id, full_name, role, practice_id) values ('<client-uuid>', 'Dr. Client', 'client', '<practice-id>');
