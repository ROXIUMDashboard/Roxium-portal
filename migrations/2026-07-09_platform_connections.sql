-- ============================================================
-- Platform connections — the OAuth backbone for self-service marketing setup.
--
-- A practice connects Meta / Google through the Marketing Setup Wizard; the
-- oauth-callback edge function stores the connection here. Tokens live in a
-- SEPARATE table with RLS enabled and NO policies, so they are reachable only
-- with the service-role key (edge functions) — never from the browser, never
-- by clients, never even by team members via the API.
--
-- Apply once in Supabase → SQL Editor (or via MCP). Idempotent.
-- ============================================================

-- 1 · Connection metadata (safe fields — no tokens here) ---------------------
create table if not exists platform_connections (
  id uuid primary key default gen_random_uuid(),
  practice_id uuid not null references practices(id) on delete cascade,
  provider text not null check (provider in ('meta','google')),
  status text not null default 'connected' check (status in ('connected','error','revoked')),
  external_account_id text,          -- e.g. Meta ad account id / Google customer id
  external_account_name text,        -- human label shown in the wizard ("Dr. Avery Aesthetics")
  accounts jsonb,                    -- discovered accounts list (ad accounts, properties…)
  scopes text[],
  connected_by uuid references auth.users(id),
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz,
  last_error text,
  unique (practice_id, provider)
);

alter table platform_connections enable row level security;
drop policy if exists "team platform connections" on platform_connections;
create policy "team platform connections" on platform_connections
  for all using (is_team()) with check (is_team());
-- Members may SEE their own practice's connection metadata (wizard status).
drop policy if exists "member reads own connections" on platform_connections;
create policy "member reads own connections" on platform_connections
  for select using (exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.practice_id = platform_connections.practice_id));

-- 2 · Tokens — service-role ONLY (RLS on, zero policies) ---------------------
create table if not exists platform_tokens (
  connection_id uuid primary key references platform_connections(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table platform_tokens enable row level security;
-- (no policies on purpose: only the service role can read/write tokens)

-- 3 · Wizard completion state on the practice --------------------------------
alter table practices add column if not exists wizard_completed_at timestamptz;

-- A practice member (or team) marks the wizard done/skipped.
create or replace function complete_marketing_wizard(p_practice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not ( is_team() or exists (select 1 from memberships m
            where m.user_id = auth.uid() and m.practice_id = p_practice) ) then
    return jsonb_build_object('ok', false, 'error', 'not a member of this practice');
  end if;
  update practices set wizard_completed_at = now()
   where id = p_practice and wizard_completed_at is null;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function complete_marketing_wizard(uuid) to authenticated;
