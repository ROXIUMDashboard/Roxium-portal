-- ============================================================
-- 2026-06-26 · Security hardening
--
-- Fixes flagged by Supabase linter + internal audit:
--   1. sheet_sync_status SECURITY DEFINER view → SECURITY INVOKER
--   2. notifications INSERT policy (was WITH CHECK (true))
--   3. finalize_past_months() callable by any authenticated user
--   4. seed_practice() team-only guard + explicit execute grant
--   5. reopen_kpi_month() revoke from authenticated
-- Safe to run more than once (DROP IF EXISTS / CREATE OR REPLACE).
-- ============================================================

-- 1 ───────── sheet_sync_status view (SECURITY DEFINER → SECURITY INVOKER) ───
-- A SECURITY DEFINER view runs as the view owner and bypasses RLS on
-- sheet_sources (team-only). Recreate with security_invoker so the querying
-- user's RLS policies apply. The portal reads sheet_sources directly; this view
-- is for SQL dashboards / linter compliance only.
drop view if exists public.sheet_sync_status;

create view public.sheet_sync_status
with (security_invoker = true) as
select
  s.id,
  s.practice_id,
  p.name as practice_name,
  s.source,
  s.label,
  s.is_active,
  s.tab_name,
  s.last_synced_at,
  s.last_status,
  s.last_error,
  s.last_rows,
  s.last_months,
  p.workbook_sheet_id
from sheet_sources s
join practices p on p.id = s.practice_id;

revoke all on public.sheet_sync_status from public;
grant select on public.sheet_sync_status to authenticated;

-- 2 ───────── notifications: stop open INSERT for any authenticated user ─────
drop policy if exists "insert notif" on notifications;
create policy "insert notif" on notifications
  for insert
  with check (is_team());
-- Trigger notify() is SECURITY DEFINER and bypasses RLS for stats/deliverable banners.

-- 3 ───────── finalize_past_months: service_role (sync-coefficient) only ───
create or replace function finalize_past_months()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' and not is_team() then
    raise exception 'finalize_past_months: not authorized'
      using errcode = 'insufficient_privilege';
  end if;
  update kpi_monthly set finalized = true
   where finalized = false
     and period < date_trunc('month', now())::date;
end;
$$;

revoke all on function finalize_past_months() from public, anon, authenticated;

-- 4 ───────── seed_practice: explicit team-only guard ───────────────────────
create or replace function seed_practice(p_name text, p_kickoff date)
returns uuid language plpgsql as $$
declare pid uuid;
begin
  if not is_team() then
    raise exception 'seed_practice: team only'
      using errcode = 'insufficient_privilege';
  end if;

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

  insert into sheet_sources (practice_id, source, label, is_active, source_type)
  values (pid, 'marketing', 'Meta Ads', true, 'google_sheet_private')
  on conflict (practice_id, source) do nothing;

  return pid;
end $$;

revoke all on function seed_practice(text, date) from public, anon;
grant execute on function seed_practice(text, date) to authenticated;

-- 5 ───────── reopen_kpi_month: team-only repair helper ─────────────────────
revoke all on function reopen_kpi_month(uuid, date, boolean) from public, anon, authenticated;
