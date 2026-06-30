-- ============================================================
-- 2026-06-30 · Fully editable milestones + change history
-- Safe to run more than once (IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================

alter table milestones add column if not exists owner_seat text;
alter table milestones add column if not exists phase text default 'Roadmap';
alter table milestones add column if not exists progress_pct int;
alter table milestones add column if not exists notes text;
alter table milestones add column if not exists link_url text;
alter table milestones add column if not exists status_manual boolean not null default false;

do $$ begin
  alter table milestones add constraint milestones_progress_pct_range
    check (progress_pct is null or (progress_pct >= 0 and progress_pct <= 100));
exception when duplicate_object then null;
end $$;

create table if not exists milestone_history (
  id            uuid primary key default gen_random_uuid(),
  milestone_id  uuid not null references milestones(id) on delete cascade,
  practice_id   uuid not null references practices(id) on delete cascade,
  field         text not null,
  old_value     text,
  new_value     text,
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now()
);
create index if not exists milestone_history_ms_idx on milestone_history (milestone_id, changed_at desc);

alter table milestone_history enable row level security;
drop policy if exists "team reads milestone_history" on milestone_history;
create policy "team reads milestone_history" on milestone_history
  for select using (is_team());
drop policy if exists "team inserts milestone_history" on milestone_history;
create policy "team inserts milestone_history" on milestone_history
  for insert with check (is_team());
