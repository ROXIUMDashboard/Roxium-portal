-- ============================================================
-- Marketing Connections 2.0 — self-service connections platform.
--
-- 1. Opens platform_connections.provider to ANY platform key (the old check
--    constraint allowed only meta/google) so new connectors ship without
--    schema changes — the connector registry lives in code + Composio.
-- 2. Per-user, per-practice KPI dashboard preferences (editable KPI cards).
-- 3. disconnect_platform() RPC — stops future syncs, PRESERVES historical
--    kpi rows, and leaves the row reconnectable.
--
-- Idempotent. Safe to run after 2026-07-14_composio_connections.sql.
-- ============================================================

-- 1 · Any provider key (registry-driven, not schema-driven) -------------------
alter table platform_connections drop constraint if exists platform_connections_provider_check;
alter table platform_connections
  add constraint platform_connections_provider_check
  check (provider ~ '^[a-z][a-z0-9_]{1,30}$');

-- 2 · Editable KPI dashboard preferences --------------------------------------
-- cards: ordered jsonb array of {"k":"spend","label":"Ad Spend"} entries.
create table if not exists kpi_dashboard_prefs (
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_id uuid not null references practices(id) on delete cascade,
  cards jsonb not null default '[]',
  updated_at timestamptz not null default now(),
  primary key (user_id, practice_id)
);
alter table kpi_dashboard_prefs enable row level security;
drop policy if exists "own kpi prefs" on kpi_dashboard_prefs;
create policy "own kpi prefs" on kpi_dashboard_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "team kpi prefs" on kpi_dashboard_prefs;
create policy "team kpi prefs" on kpi_dashboard_prefs
  for all using (is_team()) with check (is_team());

-- 3 · Disconnect (revoke) a connection — history preserved --------------------
create or replace function disconnect_platform(p_practice uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ( is_team() or exists (select 1 from memberships m
            where m.user_id = auth.uid() and m.practice_id = p_practice) ) then
    return jsonb_build_object('ok', false, 'error', 'not a member of this practice');
  end if;
  update platform_connections
     set status = 'revoked', last_error = null
   where practice_id = p_practice and provider = p_provider;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'connection not found');
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function disconnect_platform(uuid, text) to authenticated;
