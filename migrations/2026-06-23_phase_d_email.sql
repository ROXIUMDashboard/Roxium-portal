-- ============================================================
-- PHASE D · email recipients RPC + Asana mapping column
-- ============================================================
-- Run in the Supabase SQL editor. Safe + idempotent.

-- Emails of a practice's client users (members + client profiles). SECURITY DEFINER
-- so the Edge Functions (service role) can read auth.users; NOT granted to clients.
create or replace function practice_member_emails(p_id uuid)
returns table(email text)
language sql security definer set search_path = public, auth as $$
  select u.email from auth.users u
    join memberships m on m.user_id = u.id
   where m.practice_id = p_id and u.email is not null
  union
  select u.email from auth.users u
    join profiles pr on pr.id = u.id
   where pr.practice_id = p_id and pr.role = 'client' and u.email is not null;
$$;
revoke all on function practice_member_emails(uuid) from public, anon, authenticated;

-- Asana mapping: lets a deliverable be tied to an Asana task so syncs are idempotent.
alter table deliverables add column if not exists asana_task_id text;
create unique index if not exists deliverables_practice_asana_uq
  on deliverables (practice_id, asana_task_id) where asana_task_id is not null;
