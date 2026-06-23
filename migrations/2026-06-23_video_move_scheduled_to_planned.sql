-- ============================================================
-- FIX · move existing video items out of 'scheduled' into 'planned' (backlog)
-- ============================================================
-- Run in the Supabase SQL editor. Safe + idempotent.
-- The earlier migration only changed the DEFAULT for NEW items and left this move
-- commented out, so demo/Balikian boards still show everything in "Scheduled".
-- This moves them to Planned/Backlog. It's a BACKWARD move, so the forward-only
-- stage-history trigger does NOT log it as progression (no inflated history).

-- 1) ensure the column default is 'planned' (no-op if already set)
alter table video_pipeline alter column stage set default 'planned';

-- 2) move ALL currently-scheduled assets to planned (every practice)
update video_pipeline
   set stage = 'planned', stage_since = now()
 where stage = 'scheduled';

-- 3) make sure NEW practices seed in 'planned' too (refresh the live function).
--    seed_practice in schema.sql is already the 'planned' version — re-running the
--    whole schema.sql (idempotent) updates it. This block keeps just the video seed
--    correct if you'd rather not re-run everything:
--    (the function body lives in schema.sql; re-run that file to update it.)

-- verify
-- select stage, count(*) from video_pipeline group by stage order by 1;
