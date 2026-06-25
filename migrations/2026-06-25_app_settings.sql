-- ============================================================
-- Global admin settings (key/value). First use: the one master Google Drive
-- folder that holds every client's reporting workbook, configured once for the
-- whole system instead of per client.
-- ============================================================
-- Run in the Supabase SQL editor.

create table if not exists app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

alter table app_settings enable row level security;

-- Only ROXIUM team members can read/write global settings.
drop policy if exists "team reads settings" on app_settings;
create policy "team reads settings" on app_settings for select using (is_team());
drop policy if exists "team writes settings" on app_settings;
create policy "team writes settings" on app_settings for all using (is_team()) with check (is_team());
