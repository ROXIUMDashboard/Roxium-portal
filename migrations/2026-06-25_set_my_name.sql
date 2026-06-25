-- ============================================================
-- Let any signed-in user set their own display name (full_name) safely.
-- ============================================================
-- Run in the Supabase SQL editor.
--
-- Profiles RLS only lets team members write profiles, so clients couldn't fix
-- their own name (which is seeded from the invite's "Name" field — that's how a
-- placeholder like "DJQWDQ" ends up showing). This SECURITY DEFINER RPC updates
-- ONLY full_name for the calling user — it can't touch role or practice_id, so
-- there's no privilege-escalation surface.

create or replace function set_my_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set full_name = nullif(btrim(p_name), '') where id = auth.uid();
end $$;
grant execute on function set_my_name(text) to authenticated;

-- One-off data fix for an existing mis-seeded name (edit the email, then uncomment):
-- update profiles set full_name = 'Marek Kornelius Ciszewski'
--  where id = (select id from auth.users where lower(email) = lower('marek@example.com'));
