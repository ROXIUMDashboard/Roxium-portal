-- ============================================================
-- Composio-managed marketing connections.
--
-- Connections now run through Composio: Composio holds each practice's OAuth
-- token (keyed by user_id = practice_id), so ROXIUM stores only the Composio
-- connection id + an in-flight 'pending' state. The platform_tokens table from
-- the previous (DIY OAuth) design is left in place but is no longer written to.
--
-- Apply once in Supabase → SQL Editor (or via MCP). Idempotent. Safe to run
-- after 2026-07-09_platform_connections.sql.
-- ============================================================

-- Composio connected-account id (ca_…) for this practice+provider.
alter table platform_connections
  add column if not exists composio_connection_id text;

-- Allow the in-flight 'pending' state used between oauth-start and the callback.
alter table platform_connections drop constraint if exists platform_connections_status_check;
alter table platform_connections
  add constraint platform_connections_status_check
  check (status in ('pending','connected','error','revoked'));
