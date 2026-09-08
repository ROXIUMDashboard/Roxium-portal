-- ===========================================================================
-- Beverly Hills Face Academy · 2027 Scientific Program planning room
-- Migration 0001 — initial schema
--
-- Every table is prefixed `bhfa_` so this schema can live safely beside other
-- applications in the same Supabase project.
--
-- Access model: there are no end-user accounts. The application server holds
-- the service-role key and is the only thing that touches these tables; the
-- browser never receives a Supabase key. Row Level Security is therefore
-- enabled with NO policies, which denies every anon/authenticated request
-- outright while the service role continues to bypass RLS.
-- ===========================================================================

create extension if not exists pgcrypto;

-- --------------------------------------------------------------------------
-- programs
-- --------------------------------------------------------------------------
create table if not exists bhfa_programs (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,
  title            text not null,
  subtitle         text not null default '',
  status_label     text not null default 'Working Program',
  location_label   text not null default '',
  date_range_label text not null default '',
  -- Monotonic counter bumped on every mutation; clients use it to detect a
  -- stale snapshot and refetch.
  revision         bigint not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- collaboration workspaces (the secret link)
--
-- Only the SHA-256 hash of the token is stored, so a database dump does not
-- hand out working links. `token_prefix` is the first 6 characters of the
-- token, kept purely so the UI can say which link is live after a rotation.
-- --------------------------------------------------------------------------
create table if not exists bhfa_workspaces (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references bhfa_programs(id) on delete cascade,
  token_hash   text not null unique,
  token_prefix text not null default '',
  label        text not null default 'Primary collaboration link',
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create index if not exists bhfa_workspaces_program_idx on bhfa_workspaces(program_id);

-- --------------------------------------------------------------------------
-- days
-- --------------------------------------------------------------------------
create table if not exists bhfa_days (
  id            uuid primary key default gen_random_uuid(),
  program_id    uuid not null references bhfa_programs(id) on delete cascade,
  key           text not null,
  day_number    int  not null,
  -- Plain calendar date. The application never converts this to an instant,
  -- so no timezone can move a session onto the wrong day.
  date          date not null,
  weekday_label text not null default '',
  short_label   text not null default '',
  title         text not null,
  subtitle      text,
  hours_label   text,
  sort_order    int  not null default 0,
  unique (program_id, key)
);

create index if not exists bhfa_days_program_idx on bhfa_days(program_id, sort_order);

-- --------------------------------------------------------------------------
-- faculty  (names only for V1; headshot_url is here so profiles can be added
--           later without a migration)
-- --------------------------------------------------------------------------
create table if not exists bhfa_faculty (
  id           uuid primary key default gen_random_uuid(),
  program_id   uuid not null references bhfa_programs(id) on delete cascade,
  name         text not null,
  credentials  text,
  headshot_url text,
  created_at   timestamptz not null default now()
);

create unique index if not exists bhfa_faculty_name_idx
  on bhfa_faculty(program_id, lower(name));

-- --------------------------------------------------------------------------
-- sessions
--
-- start_minute / end_minute are integer minutes from midnight of the day's own
-- calendar date. 0 = 12:00 AM, 1440 = midnight at the end of the day (the
-- Day 03 White Party), and up to 1740 for anything running to 5:00 AM.
-- --------------------------------------------------------------------------
create table if not exists bhfa_sessions (
  id              uuid primary key default gen_random_uuid(),
  day_id          uuid not null references bhfa_days(id) on delete cascade,
  sort_order      int  not null default 0,
  title           text not null default '',
  description     text,
  start_minute    int  not null,
  end_minute      int  not null,
  session_type    text not null default 'scientific_session',
  sponsor_name    text,
  sponsor_logo_url text,
  sponsor_url     text,
  room            text,
  status          text not null default 'draft',
  internal_notes  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      text,
  constraint bhfa_sessions_minutes_range check (
    start_minute >= 0 and start_minute <= 1740 and
    end_minute   >= 0 and end_minute   <= 1740
  ),
  constraint bhfa_sessions_type_valid check (session_type in (
    'scientific_session','live_surgery','cadaver_lab','panel','break','breakfast',
    'lunch','evening_event','ceremony','business','other'
  )),
  constraint bhfa_sessions_status_valid check (status in ('draft','confirmed','tentative'))
);

-- NOTE: end_minute <= start_minute is intentionally NOT a database constraint.
-- An invalid range is surfaced in the UI as a red error the planner can fix,
-- rather than a failed save that loses their typing.

create index if not exists bhfa_sessions_day_idx on bhfa_sessions(day_id, sort_order);

-- --------------------------------------------------------------------------
-- session speakers
--
-- A row may reference a faculty record, carry a one-off display_name, or
-- neither — a row with status 'tbd' and no name renders as "To be confirmed".
-- --------------------------------------------------------------------------
create table if not exists bhfa_session_speakers (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references bhfa_sessions(id) on delete cascade,
  faculty_id   uuid references bhfa_faculty(id) on delete set null,
  display_name text,
  role         text not null default 'speaker',
  status       text not null default 'confirmed',
  sort_order   int  not null default 0,
  constraint bhfa_speaker_role_valid   check (role   in ('speaker','moderator','panelist')),
  constraint bhfa_speaker_status_valid check (status in ('confirmed','invited','tbd'))
);

create index if not exists bhfa_session_speakers_session_idx
  on bhfa_session_speakers(session_id, sort_order);

-- --------------------------------------------------------------------------
-- change history  (append-only; restores add entries, never remove them)
-- --------------------------------------------------------------------------
create table if not exists bhfa_change_history (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references bhfa_programs(id) on delete cascade,
  session_id uuid,
  day_id     uuid,
  actor_name text not null default 'Someone',
  action     text not null,
  summary    text not null default '',
  before     jsonb,
  after      jsonb,
  undone     boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists bhfa_change_history_program_idx
  on bhfa_change_history(program_id, created_at desc);

-- --------------------------------------------------------------------------
-- revision bump: any session/speaker write advances the program revision so
-- realtime listeners can tell a stale snapshot from a current one.
-- --------------------------------------------------------------------------
create or replace function bhfa_bump_revision() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_program uuid;
begin
  if tg_table_name = 'bhfa_sessions' then
    select d.program_id into target_program
      from bhfa_days d
     where d.id = coalesce(new.day_id, old.day_id);
  elsif tg_table_name = 'bhfa_session_speakers' then
    select d.program_id into target_program
      from bhfa_sessions s join bhfa_days d on d.id = s.day_id
     where s.id = coalesce(new.session_id, old.session_id);
  end if;

  if target_program is not null then
    update bhfa_programs
       set revision = revision + 1, updated_at = now()
     where id = target_program;
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists bhfa_sessions_revision on bhfa_sessions;
create trigger bhfa_sessions_revision
  after insert or update or delete on bhfa_sessions
  for each row execute function bhfa_bump_revision();

drop trigger if exists bhfa_session_speakers_revision on bhfa_session_speakers;
create trigger bhfa_session_speakers_revision
  after insert or update or delete on bhfa_session_speakers
  for each row execute function bhfa_bump_revision();

-- --------------------------------------------------------------------------
-- Row Level Security: deny everything to anon/authenticated. No policies are
-- created on purpose. The service role (server only) bypasses RLS.
-- --------------------------------------------------------------------------
alter table bhfa_programs         enable row level security;
alter table bhfa_workspaces       enable row level security;
alter table bhfa_days             enable row level security;
alter table bhfa_faculty          enable row level security;
alter table bhfa_sessions         enable row level security;
alter table bhfa_session_speakers enable row level security;
alter table bhfa_change_history   enable row level security;

revoke all on bhfa_workspaces from anon, authenticated;

-- --------------------------------------------------------------------------
-- Realtime: the server (service role) subscribes to session changes and
-- relays them to browsers over SSE.
-- --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table bhfa_sessions;
    alter publication supabase_realtime add table bhfa_session_speakers;
    alter publication supabase_realtime add table bhfa_change_history;
  end if;
exception
  when duplicate_object then null;
end $$;
