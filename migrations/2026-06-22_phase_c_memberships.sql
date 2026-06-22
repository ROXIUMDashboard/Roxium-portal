-- ============================================================
-- PHASE C — Org / membership model + invite-only access
-- ============================================================
-- Safe · additive · idempotent. Run once against the live database
-- (Supabase SQL editor, or `supabase db push` from a credentialed session).
--
-- WHY:
--   The portal assumed one user per practice: access was `profiles.practice_id`
--   (a single uuid) checked by `my_practice()`. The team needs many users per
--   practice, and a user (esp. staff) may relate to many practices.
--
-- WHAT:
--   Introduce a real `memberships` join table (user × practice × role) as the
--   access-control layer, backfill it from existing profiles so every current
--   login keeps working, and switch client-facing RLS from "= my_practice()" to
--   "is a member of this practice". `profiles.practice_id` is KEPT (non-destructive)
--   as each user's default/active practice for the UI.
-- ============================================================

begin;

-- 1) Join table: who can see which practice, and in what capacity.
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  practice_id uuid not null references practices(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz default now(),
  unique (user_id, practice_id)
);
alter table memberships enable row level security;

-- 2) Membership test helper (security definer: reads memberships without
--    re-triggering its own RLS — same pattern as is_team()/my_practice()).
create or replace function is_member_of(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships where user_id = auth.uid() and practice_id = p
  );
$$;

-- 3) Backfill: every profile with a practice becomes a membership of it.
--    Team profiles map to 'owner', clients to 'member'. Idempotent.
insert into memberships (user_id, practice_id, role)
select p.id, p.practice_id,
       case when p.role = 'team' then 'owner' else 'member' end
from profiles p
where p.practice_id is not null
on conflict (user_id, practice_id) do nothing;

-- 4) RLS on memberships: a user reads their own rows; team reads/manages all.
drop policy if exists "read memberships" on memberships;
create policy "read memberships" on memberships for select
  using (is_team() or user_id = auth.uid());
drop policy if exists "team memberships" on memberships;
create policy "team memberships" on memberships for all
  using (is_team()) with check (is_team());

-- 5) Switch client-facing read policies from `= my_practice()` to membership.
--    Backfill above guarantees existing clients stay members, so nothing breaks;
--    multi-user practices now work. Team write policies are unchanged.
drop policy if exists "read own practice" on practices;
create policy "read own practice" on practices for select
  using (is_team() or is_member_of(id));

drop policy if exists "read kpi" on kpi_monthly;
create policy "read kpi" on kpi_monthly for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "read deliv" on deliverables;
create policy "read deliv" on deliverables for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "read miles" on milestones;
create policy "read miles" on milestones for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "read video" on video_pipeline;
create policy "read video" on video_pipeline for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "read vh" on video_history;
create policy "read vh" on video_history for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "read activity" on activity;
create policy "read activity" on activity for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "read notif" on notifications;
create policy "read notif" on notifications for select
  using (is_team() or is_member_of(practice_id));

drop policy if exists "client seen" on notifications;
create policy "client seen" on notifications for update
  using (is_member_of(practice_id)) with check (is_member_of(practice_id));

-- 6) Storage: clients read files in folders for practices they belong to.
drop policy if exists "read own files" on storage.objects;
create policy "read own files" on storage.objects for select
  using (bucket_id = 'deliverables' and (is_team() or exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.practice_id::text = (storage.foldername(name))[1]
  )));

commit;

-- ---------- VERIFY (read-only) ----------
-- select m.role, pr.name, p.email
--   from memberships m
--   join practices pr on pr.id = m.practice_id
--   left join auth.users u on u.id = m.user_id
--   left join profiles  p on p.id = m.user_id
--   order by pr.name;
