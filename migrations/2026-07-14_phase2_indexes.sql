-- ============================================================
-- Phase 2 — performance indexes (see docs/PLATFORM_AUDIT.md).
--
-- Additive only. No data changes, safe to run anytime, idempotent.
--
-- The RLS helper is_member_of() runs
--   select 1 from memberships where user_id = auth.uid() and practice_id = p
-- on EVERY row of EVERY client read, and the practice-scoped tables are filtered
-- by practice_id per RLS — all without supporting indexes today. These close
-- that gap before the client base grows.
-- ============================================================

-- Hit by is_member_of on every client read (user_id-leading).
create index if not exists memberships_user_practice_idx on memberships (user_id, practice_id);
-- Roster / team lookups filter by practice_id alone (needs its own leading col).
create index if not exists memberships_practice_idx on memberships (practice_id);

-- Practice-scoped tables filtered by practice_id under RLS + in app queries.
create index if not exists deliverables_practice_idx   on deliverables   (practice_id);
create index if not exists milestones_practice_idx     on milestones     (practice_id);
create index if not exists video_pipeline_practice_idx on video_pipeline (practice_id);
create index if not exists activity_practice_idx       on activity       (practice_id);

-- Activity/feed is read newest-first per practice.
create index if not exists activity_practice_created_idx on activity (practice_id, created_at desc);
