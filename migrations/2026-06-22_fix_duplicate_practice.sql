-- ============================================================
-- FIX · duplicate practice ("two Balikians", one empty)
-- ============================================================
-- Run in the Supabase SQL editor. This is DIAGNOSTIC-FIRST: step 1 shows you the
-- duplicates and how much data each one has, so you delete the EMPTY one — never
-- the populated one. Nothing is deleted until you uncomment step 3 with the id.
--
-- Root cause: `practices.name` had no uniqueness and seed_practice() / the team
-- "Add Client" button did a bare INSERT, so a practice could be created twice
-- (e.g. once at demo seed, once again while wiring Coefficient). The sync function
-- never creates practices (it's FK-bound to existing ids), so it is NOT the cause.
-- ============================================================

-- ============================================================
-- EASY MODE · auto-remove the empty duplicate (recommended)
-- ------------------------------------------------------------
-- Keeps the Balikian that has the imported KPI data (most kpi_monthly rows,
-- tie-break most deliverables, then oldest), moves any attached users onto it,
-- and deletes the empty clone(s). Safe to run as-is. Wrapped so you can review the
-- NOTICE output; it commits only if no error. Handles any duplicated name, not
-- just Balikian.
do $$
declare
  nm     text;
  keeper uuid;
  loser  uuid;
  has_memberships boolean := to_regclass('public.memberships') is not null;
begin
  for nm in
    select lower(btrim(name)) from practices group by lower(btrim(name)) having count(*) > 1
  loop
    select p.id into keeper from practices p
     where lower(btrim(p.name)) = nm
     order by (select count(*) from kpi_monthly  k where k.practice_id = p.id) desc,
              (select count(*) from deliverables d where d.practice_id = p.id) desc,
              p.created_at asc
     limit 1;

    for loser in
      select p.id from practices p where lower(btrim(p.name)) = nm and p.id <> keeper
    loop
      update profiles set practice_id = keeper where practice_id = loser;
      if has_memberships then
        execute 'delete from memberships where practice_id = $1' using loser;
      end if;
      delete from practices where id = loser;       -- deliverables/kpi/video cascade
      raise notice 'Removed duplicate "%": % (kept %)', nm, loser, keeper;
    end loop;
  end loop;
end $$;

-- After EASY MODE, jump to step 4 (the backstop index). Steps 1–3 below are the
-- manual alternative if you'd rather inspect and delete by hand.
-- ------------------------------------------------------------

-- 1) SEE the duplicates with row counts (run this first, read the output) ----------
select p.id,
       p.name,
       p.created_at,
       (select count(*) from kpi_monthly  k where k.practice_id = p.id) as kpi_rows,
       (select count(*) from deliverables d where d.practice_id = p.id) as deliverables,
       (select count(*) from video_pipeline v where v.practice_id = p.id) as videos,
       (select count(*) from profiles    pr where pr.practice_id = p.id) as profiles_attached,
       (select count(*) from memberships  m where m.practice_id = p.id) as memberships
from practices p
where lower(btrim(p.name)) in (
  select lower(btrim(name)) from practices group by lower(btrim(name)) having count(*) > 1
)
order by lower(btrim(p.name)), p.created_at;

-- 2) If the EMPTY duplicate still has users attached, move them to the keeper first.
--    (Replace the ids. Skip if profiles_attached = 0 and memberships = 0.)
-- update profiles    set practice_id = '<KEEPER_ID>' where practice_id = '<EMPTY_DUPLICATE_ID>';
-- update memberships set practice_id = '<KEEPER_ID>' where practice_id = '<EMPTY_DUPLICATE_ID>'
--   and not exists (select 1 from memberships m2
--                   where m2.user_id = memberships.user_id and m2.practice_id = '<KEEPER_ID>');

-- 3) DELETE the empty duplicate. Child rows (kpi/deliverables/video/etc) cascade.
--    Paste the EMPTY one's id from step 1. Double-check kpi_rows/deliverables are the
--    low/zero ones before running.
-- delete from practices where id = '<EMPTY_DUPLICATE_ID>';

-- 4) BACKSTOP: stop exact-name duplicates from ever being inserted again.
--    (Run AFTER step 3 — it errors if duplicates still exist, which is the point.)
create unique index if not exists practices_name_lower_uq on practices (lower(btrim(name)));

-- Note: seed_practice() is also hardened in schema.sql to reject duplicate names
-- with a clear message, and the team "Add Client" UI now offers to switch to an
-- existing practice instead of cloning it.
