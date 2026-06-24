-- ============================================================
-- Fix: client creation fails with "no unique or exclusion constraint matching
-- the ON CONFLICT specification".
-- ============================================================
-- Run in the Supabase SQL editor (after 2026-06-25_multi_source_kpi.sql).
--
-- Root cause: seed_practice() seeds a default sheet_sources row with
--   ON CONFLICT (practice_id) DO NOTHING
-- but the multi-source migration replaced the unique(practice_id) constraint with
-- unique(practice_id, source). With no constraint on (practice_id) alone, Postgres
-- raises the ON CONFLICT error and the whole seed_practice transaction aborts —
-- so no client gets created. This redefines the function with the correct conflict
-- target (and seeds an inert Meta row that only syncs once a tab is configured).

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

  -- default Meta source row — inert until an admin sets the master workbook + tab.
  -- Conflict target now matches the per-channel unique index (practice_id, source).
  insert into sheet_sources (practice_id, source, label, is_active, source_type)
  values (pid, 'marketing', 'Meta Ads', true, 'google_sheet_private')
  on conflict (practice_id, source) do nothing;

  return pid;
end $$;
