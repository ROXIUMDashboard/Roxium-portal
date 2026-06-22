-- ============================================================
-- FIX · video pipeline items should start in 'planned' (backlog), not 'scheduled'
-- ============================================================
-- Run in the Supabase SQL editor. Safe + idempotent.

-- 1) New items now default to 'planned'.
alter table video_pipeline alter column stage set default 'planned';

-- 2) (OPTIONAL) Move EXISTING backlog-y demo items that are still sitting in
--    'scheduled' back to 'planned', so the demo board starts in Planned/Backlog.
--    This is a BACKWARD move, so the forward-only stage-history trigger will NOT
--    log it as progression (no inflated history). Uncomment to apply.
--    Narrow it to the demo practice if you only want to touch the demo:
-- update video_pipeline set stage = 'planned', stage_since = now()
--  where stage = 'scheduled'
--    and practice_id = 'e4b26de2-ae93-4a2d-aaf5-db819a7c4668';  -- Demo Practice

-- Note: 'scheduled' is still a valid, later stage in the workflow
-- (planned → scheduled → pre_production → shot → editing → delivered → posted).
-- Only the DEFAULT changed; nothing about the stage order or the check constraint.
