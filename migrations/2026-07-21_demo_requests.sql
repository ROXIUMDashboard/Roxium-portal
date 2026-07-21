-- ============================================================
-- demo_requests — captures "Book a demo" submissions from the public landing.
-- The book-demo edge function inserts here (service role) and emails the team.
-- Email is the primary channel; this table is a durable log so leads aren't lost.
--
-- Apply live: paste into the Supabase SQL editor and run. (Optional — the form
-- already works via email without it; this just keeps a record.)
-- ============================================================
create table if not exists demo_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  practice text not null,
  email text not null,
  channels text,
  created_at timestamptz not null default now()
);

alter table demo_requests enable row level security;

-- No public policies: only the service role (edge function) writes, and only the
-- team reads via the dashboard. Team read access:
drop policy if exists demo_requests_team_read on demo_requests;
create policy demo_requests_team_read on demo_requests
  for select using (is_team());
