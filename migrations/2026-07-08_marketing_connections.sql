-- Marketing Connections product layer (UI/onboarding state).
-- Backend sync still uses sheet_sources + kpi_monthly; this JSON tracks the
-- access pipeline (requested / waiting / not used) before OAuth lands.

alter table practices
  add column if not exists marketing_setup_type text
    check (marketing_setup_type is null or marketing_setup_type in ('agency','internal','none'));

alter table practices
  add column if not exists marketing_connections jsonb not null default '{}'::jsonb;

-- Team updates connection pipeline state for a practice.
create or replace function set_practice_marketing_connection(
  p_practice uuid,
  p_platform text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur jsonb;
  merged jsonb;
  full jsonb;
begin
  if not is_team() then
    raise exception 'Only team users can update marketing connections';
  end if;
  select coalesce(marketing_connections, '{}'::jsonb) into full
  from practices where id = p_practice;
  if full is null then
    raise exception 'Practice not found';
  end if;
  cur := coalesce(full -> p_platform, '{}'::jsonb);
  merged := cur || coalesce(p_patch, '{}'::jsonb) || jsonb_build_object('updated_at', now());
  full := jsonb_set(full, array[p_platform], merged, true);
  update practices
  set marketing_connections = full
  where id = p_practice;
  return full;
end $$;

create or replace function set_practice_marketing_setup_type(
  p_practice uuid,
  p_type text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_team() then
    raise exception 'Only team users can update marketing setup type';
  end if;
  if p_type is not null and p_type not in ('agency','internal','none') then
    raise exception 'Invalid marketing setup type';
  end if;
  update practices set marketing_setup_type = p_type where id = p_practice;
end $$;

revoke all on function set_practice_marketing_connection(uuid, text, jsonb) from public;
revoke all on function set_practice_marketing_setup_type(uuid, text) from public;
grant execute on function set_practice_marketing_connection(uuid, text, jsonb) to authenticated;
grant execute on function set_practice_marketing_setup_type(uuid, text) to authenticated;
