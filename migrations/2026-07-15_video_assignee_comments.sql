-- Video assignee + internal comment threads
-- --------------------------------------------------------------------------
-- Adds a per-video owner seat (assignee) and an INTERNAL, team-only comment
-- thread per video. Comments are never exposed to clients: there is no member
-- read policy, so RLS restricts every operation to team members.
--
-- Presentation/feature migration for the Video Pipeline redesign. Safe to run
-- more than once (idempotent).

begin;

-- 1) Per-video assignee — mirrors deliverables.owner_seat / milestones.owner_seat.
alter table video_pipeline add column if not exists owner_seat text;

-- 2) Internal comment threads on a video.
create table if not exists video_comments (
  id          uuid primary key default gen_random_uuid(),
  video_id    uuid not null references video_pipeline(id) on delete cascade,
  practice_id uuid not null references practices(id)      on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_video_comments_video on video_comments(video_id, created_at);

alter table video_comments enable row level security;

-- Team-only. Comments are internal notes; clients must never read them, so there
-- is deliberately NO is_member_of(...) read policy — only team gets access.
drop policy if exists "team video comments" on video_comments;
create policy "team video comments" on video_comments
  for all using (is_team()) with check (is_team());

commit;

-- ---------- VERIFY (read-only) ----------
-- select column_name from information_schema.columns
--   where table_name = 'video_pipeline' and column_name = 'owner_seat';
-- select policyname, cmd from pg_policies where tablename = 'video_comments';
