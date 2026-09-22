-- ---------------------------------------------------------------------------
-- BHFA 2027 — Faculty workspace
--
-- Purely additive. No column is dropped or retyped, and no row is deleted, so
-- the faculty ids already referenced by bhfa_session_speakers keep working and
-- the agenda is untouched. Every statement is idempotent: run it twice safely.
--
-- Faculty planning has two independent dimensions:
--   region  — local | united_states | international
--   status  — confirmed | maybe        (the active pipeline)
--             declined  | not_pursuing (the inactive section)
--
-- `status` is deliberately NULL-able. A name typed into an agenda session is
-- promoted into this table so it resolves everywhere, but that person has not
-- necessarily been triaged into the invitation pipeline. NULL means exactly
-- that: known to the agenda, not yet placed in the faculty register.
-- ---------------------------------------------------------------------------

alter table bhfa_faculty add column if not exists region       text;
alter table bhfa_faculty add column if not exists status       text;

-- location
alter table bhfa_faculty add column if not exists city           text;
alter table bhfa_faculty add column if not exists state_province text;
alter table bhfa_faculty add column if not exists country        text;

-- planning
alter table bhfa_faculty add column if not exists specialty         text;
alter table bhfa_faculty add column if not exists proposed_role     text;
alter table bhfa_faculty add column if not exists invitation_status text;
alter table bhfa_faculty add column if not exists invitation_date   date;
alter table bhfa_faculty add column if not exists last_contact_date date;
alter table bhfa_faculty add column if not exists owner             text;
alter table bhfa_faculty add column if not exists priority          boolean not null default false;
alter table bhfa_faculty add column if not exists internal_notes    text;

-- optional / future-safe
alter table bhfa_faculty add column if not exists email        text;
alter table bhfa_faculty add column if not exists phone        text;
alter table bhfa_faculty add column if not exists institution  text;
alter table bhfa_faculty add column if not exists website      text;

-- bookkeeping
alter table bhfa_faculty add column if not exists sort_order  int not null default 0;
alter table bhfa_faculty add column if not exists updated_at  timestamptz not null default now();
alter table bhfa_faculty add column if not exists updated_by  text;

-- Constrain the two controlled vocabularies. NULL stays legal for status.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bhfa_faculty_region_check') then
    alter table bhfa_faculty add constraint bhfa_faculty_region_check
      check (region is null or region in ('local','united_states','international'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bhfa_faculty_status_check') then
    alter table bhfa_faculty add constraint bhfa_faculty_status_check
      check (status is null or status in ('confirmed','maybe','declined','not_pursuing'));
  end if;
end $$;

create index if not exists bhfa_faculty_status_idx on bhfa_faculty(program_id, status);
create index if not exists bhfa_faculty_region_idx on bhfa_faculty(program_id, region);

-- The two surgeons the program names as live-surgery leads are confirmed by
-- definition; everyone else stays untriaged until someone says otherwise.
update bhfa_faculty
   set status = 'confirmed'
 where status is null
   and lower(name) in ('dr. marc mani', 'dr. ashkan ghavami');

-- Change history already records session_id / day_id; faculty changes need the
-- same treatment so the existing history UI can show them.
alter table bhfa_change_history add column if not exists faculty_id uuid;
create index if not exists bhfa_change_history_faculty_idx
  on bhfa_change_history(program_id, faculty_id);

-- RLS: bhfa_faculty already has it enabled with no policies, so only the
-- server's secret key reaches it. Nothing here loosens that.
alter table bhfa_faculty enable row level security;
