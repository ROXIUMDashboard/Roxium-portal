-- ============================================================
-- Onboarding checklist: gate "reporting sheet" on the master-workbook model.
-- ============================================================
-- Run in the Supabase SQL editor. Redefines get_practice_onboarding_status so
-- the "reporting sheet connected" step only turns green when the client is
-- actually syncable: an active source tab exists AND it is reachable — either the
-- client's master workbook is set (sheets_api), or the source carries its own
-- legacy csv_url / sheet_id. Also reports the most-recent sync across all tabs.

create or replace function get_practice_onboarding_status(p_practice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  member_cnt int;
  pending_cnt int;
  has_sheet boolean;
  has_sync boolean;
  sheet_synced_at timestamptz;
begin
  if not is_team() then
    raise exception 'Team access required' using errcode = 'insufficient_privilege';
  end if;

  select count(*)::int into member_cnt
  from memberships where practice_id = p_practice;

  select count(*)::int into pending_cnt
  from practice_invites
  where practice_id = p_practice and status in ('pending', 'sent');

  -- Ready to sync = an active source tab that is reachable: the client's master
  -- workbook is set (so the tab can be read), OR the row has its own csv_url /
  -- legacy sheet_id. This requires BOTH a workbook and a source in the normal path.
  select exists (
    select 1 from sheet_sources s
    where s.practice_id = p_practice and s.is_active
      and (
        (s.csv_url  is not null and btrim(s.csv_url)  <> '')
        or (s.sheet_id is not null and btrim(s.sheet_id) <> '')
        or exists (
          select 1 from practices p
          where p.id = p_practice
            and p.workbook_sheet_id is not null and btrim(p.workbook_sheet_id) <> ''
        )
      )
  ) into has_sheet;

  select max(last_synced_at) into sheet_synced_at
  from sheet_sources where practice_id = p_practice;

  select (
    sheet_synced_at is not null
    or exists (select 1 from kpi_monthly where practice_id = p_practice limit 1)
  ) into has_sync;

  return jsonb_build_object(
    'practice_id', p_practice,
    'has_access', member_cnt > 0 or pending_cnt > 0,
    'member_count', member_cnt,
    'pending_invites', pending_cnt,
    'has_sheet', has_sheet,
    'has_sync', has_sync,
    'last_synced_at', sheet_synced_at
  );
end $$;
grant execute on function get_practice_onboarding_status(uuid) to authenticated;
