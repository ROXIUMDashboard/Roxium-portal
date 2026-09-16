-- ============================================================================
-- staging-state.sql — READ-ONLY structural classification of a staging database.
--
-- Emits one `key=value` line per marker. Every statement is a SELECT; it
-- creates, alters and deletes nothing, and is safe to run at any time.
--
-- The caller (scripts/initialize-staging-db.sh) classifies the result as:
--
--   NEW          nothing is there          -> run the one-time bootstrap
--   INITIALIZED  everything is there       -> SKIP the bootstrap
--   PARTIAL      some of it is there       -> fail closed, change nothing
--
-- Why the bootstrap must not simply be replayed: it is schema.sql plus the full
-- migration history, and `delete_practice(uuid)` changes its return type
-- (void -> jsonb) partway through that history. Replaying the older definition
-- over the newer one makes Postgres refuse with "cannot change return type of
-- existing function", which is exactly how Initialize STAGING #2 died.
--
-- The LATEST markers below are the important half of this file. Core tables
-- alone would be satisfied by schema.sql on its own, so a database that had
-- only the baseline applied would be misread as fully initialized. Each latest
-- marker comes from a late migration, including the return type of
-- delete_practice itself.
-- ============================================================================

-- 1 · Core tables (present in schema.sql; necessary but NOT sufficient).
select 'core_tables=' || count(*) || '/' || 10
from (values ('practices'),('profiles'),('memberships'),('deliverables'),('milestones'),
             ('video_pipeline'),('activity'),('notifications'),('kpi_monthly'),('kpi_daily')) as t(n)
where to_regclass('public.' || t.n) is not null;

-- 2 · Total base tables in public.
select 'total_tables=' || count(*)
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE';

-- 3 · Tables with RLS switched off. Must be 0 on an initialized database.
select 'rls_off=' || count(*)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 4 · Core functions the portal cannot work without.
select 'core_functions=' || count(*) || '/' || 8
from (values ('is_team'),('my_practice'),('is_member_of'),('ensure_my_profile'),
             ('claim_invites_for_user'),('approve_account'),('delete_practice'),('seed_practice')) as f(n)
where exists (select 1 from pg_proc p
              where p.proname = f.n and p.pronamespace = 'public'::regnamespace);

-- 5 · LATEST markers — each one proves a late migration ran, not just the
--     baseline. Without these, a schema.sql-only database would look complete.
select 'latest_markers=' || count(*) || '/' || 5 from (
  -- 2026-07-21_practice_archive
  select 1 where to_regclass('public.practices') is not null
    and exists (select 1 from pg_attribute
                where attrelid = to_regclass('public.practices') and attname = 'archived_at'
                  and attnum > 0 and not attisdropped)
  union all
  -- 2026-07-09_account_approvals
  select 1 where to_regclass('public.profiles') is not null
    and exists (select 1 from pg_attribute
                where attrelid = to_regclass('public.profiles') and attname = 'approval_status'
                  and attnum > 0 and not attisdropped)
  union all
  -- 2026-06-30_milestone_editor
  select 1 where to_regclass('public.milestones') is not null
    and exists (select 1 from pg_attribute
                where attrelid = to_regclass('public.milestones') and attname = 'link_url'
                  and attnum > 0 and not attisdropped)
  union all
  -- 2026-07-14_composio_connections
  select 1 where to_regclass('public.platform_connections') is not null
    and exists (select 1 from pg_attribute
                where attrelid = to_regclass('public.platform_connections')
                  and attname = 'composio_connection_id' and attnum > 0 and not attisdropped)
  union all
  -- 2026-07-14_lifecycle_fixes — delete_practice returns jsonb, not void.
  -- This is the exact object whose replay breaks, so it is the sharpest signal
  -- that the full history is already applied.
  select 1 from pg_proc p
  where p.proname = 'delete_practice' and p.pronamespace = 'public'::regnamespace
    and pg_get_function_result(p.oid) = 'jsonb'
) as m(x);
