-- Pinned updates
-- --------------------------------------------------------------------------
-- Lets the team pin an update so it stays at the top of the What's-New feed.
-- Team already has full write access to `activity` (see the "team activity"
-- policy), so no new RLS is needed — this only adds the column. Idempotent.

begin;

alter table activity add column if not exists pinned boolean not null default false;

commit;

-- ---------- VERIFY (read-only) ----------
-- select column_name, data_type from information_schema.columns
--   where table_name = 'activity' and column_name = 'pinned';
