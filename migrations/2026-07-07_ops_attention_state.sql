-- Per-user Operations Dashboard attention queue preferences (team users).
-- Stores dismiss, snooze-until, pin, and custom sort order as JSON on profiles.

alter table profiles
  add column if not exists ops_attention_state jsonb not null default '{}'::jsonb;

create or replace function get_my_ops_attention_state()
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(ops_attention_state, '{}'::jsonb)
  from profiles
  where id = auth.uid();
$$;

create or replace function set_my_ops_attention_state(p_state jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_team() then
    raise exception 'Only team users can save operations attention preferences';
  end if;
  update profiles
  set ops_attention_state = coalesce(p_state, '{}'::jsonb)
  where id = auth.uid();
end $$;

revoke all on function get_my_ops_attention_state() from public;
revoke all on function set_my_ops_attention_state(jsonb) from public;
grant execute on function get_my_ops_attention_state() to authenticated;
grant execute on function set_my_ops_attention_state(jsonb) to authenticated;
