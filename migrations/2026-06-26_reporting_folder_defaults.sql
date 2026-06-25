-- ============================================================
-- Default global reporting Drive folder + workbook name hint
-- ============================================================

-- Seed the team-wide reporting folder (only if not already set).
insert into app_settings (key, value)
values ('master_reporting_drive_folder', '1SDfpxHnD7OSO6rWjdQDM73XE_e8h8sqD')
on conflict (key) do nothing;

alter table practices add column if not exists workbook_name_hint text;

-- Onboarding: expose workbook-linked step separately from source-tab mapping.
create or replace function get_practice_onboarding_status(p_practice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  member_cnt int;
  pending_cnt int;
  has_workbook boolean;
  has_sheet boolean;
  has_sync boolean;
  sheet_synced_at timestamptz;
begin
  if not is_team() then
    raise exception 'Team access required' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::int into member_cnt from memberships where practice_id = p_practice;
  select count(*)::int into pending_cnt from practice_invites
    where practice_id = p_practice and status in ('pending', 'sent');

  select exists (
    select 1 from practices p
    where p.id = p_practice and p.workbook_sheet_id is not null and btrim(p.workbook_sheet_id) <> ''
  ) into has_workbook;

  select exists (
    select 1 from sheet_sources s
    where s.practice_id = p_practice and s.is_active
      and btrim(coalesce(s.tab_name, '')) <> ''
      and (
        exists (
          select 1 from practices p
          where p.id = p_practice and p.workbook_sheet_id is not null and btrim(p.workbook_sheet_id) <> ''
        )
        or (s.csv_url is not null and btrim(s.csv_url) <> '')
        or (s.sheet_id is not null and btrim(s.sheet_id) <> '')
      )
  ) into has_sheet;

  select max(last_synced_at) into sheet_synced_at from sheet_sources where practice_id = p_practice;
  select (sheet_synced_at is not null or exists (
    select 1 from kpi_monthly where practice_id = p_practice limit 1
  )) into has_sync;

  return jsonb_build_object(
    'practice_id', p_practice,
    'has_access', member_cnt > 0 or pending_cnt > 0,
    'member_count', member_cnt,
    'pending_invites', pending_cnt,
    'has_workbook', has_workbook,
    'has_sheet', has_sheet,
    'has_sync', has_sync,
    'last_synced_at', sheet_synced_at
  );
end $$;
