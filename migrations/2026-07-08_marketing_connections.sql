-- ============================================================
-- Marketing Connections — track a source's ACCESS state, not just its sync state.
--
-- Before: sheet_sources only knew about a source once it was fully wired
-- (tab mapped, Coefficient flowing). The chase that happens BEFORE that —
-- "we asked the client for access on Tuesday and nothing has happened" —
-- lived in nobody's head. Now every source carries an access state machine:
--
--   requested  → we asked the client/agency for platform access
--   granted    → access arrived; ROXIUM still has to wire Coefficient + tab
--   connected  → data is flowing (auto-set the moment a sync succeeds)
--
-- access_requested_at records when the ask went out so the portal can age it
-- (the onboarding SOP escalates any request older than 5 business days).
--
-- Apply once in Supabase → SQL Editor. Idempotent.
-- ============================================================

-- Existing rows predate the state machine and are, by definition, already wired:
-- backfill them as 'connected' via the column default, THEN flip the default to
-- 'requested' so every NEW source starts at the beginning of the pipeline.
alter table sheet_sources
  add column if not exists access_status text not null default 'connected';
alter table sheet_sources
  add column if not exists access_requested_at date;

do $$ begin
  alter table sheet_sources
    add constraint sheet_sources_access_status_chk
    check (access_status in ('requested','granted','connected'));
exception when duplicate_object then null; end $$;

alter table sheet_sources alter column access_status set default 'requested';

-- Stamp the request date automatically when a row is born (or re-enters)
-- 'requested' without an explicit date.
create or replace function sheet_sources_access_stamp()
returns trigger language plpgsql as $$
begin
  if new.access_status = 'requested' and new.access_requested_at is null then
    new.access_requested_at := now()::date;
  end if;
  -- A successful sync IS the definition of connected — no one should have to
  -- remember to flip the state by hand.
  if new.last_synced_at is not null and new.last_status = 'ok' then
    new.access_status := 'connected';
  end if;
  return new;
end $$;

drop trigger if exists trg_sheet_sources_access_stamp on sheet_sources;
create trigger trg_sheet_sources_access_stamp
  before insert or update on sheet_sources
  for each row execute function sheet_sources_access_stamp();
