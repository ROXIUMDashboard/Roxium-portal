-- Minimal Supabase-shaped scaffolding so the ROXIUM bootstrap can be applied to a
-- plain Postgres for validation. NOT a Supabase replica — just the objects the
-- migrations reference (auth schema/users/uid/role, storage buckets/objects, roles).
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);
-- The columns the Auth admin API actually reads and writes. Added separately so
-- an existing stub table from an earlier run is upgraded rather than skipped by
-- the "if not exists" above.
alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}'::jsonb;
alter table auth.users add column if not exists encrypted_password text;
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists created_at timestamptz default now();
-- Supabase Auth rejects a duplicate address; without this a test could not tell
-- a reused fixture identity from a second one silently created alongside it.
create unique index if not exists auth_users_email_uq on auth.users (lower(email));
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;
