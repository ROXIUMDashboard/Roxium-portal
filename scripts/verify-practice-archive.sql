-- ============================================================================
-- verify-practice-archive.sql — READ-ONLY check that
-- migrations/2026-07-21_practice_archive.sql landed correctly.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--   Every statement is a SELECT. It creates nothing, alters nothing, deletes
--   nothing. Safe to run before or after the migration, as often as you like.
--
-- HOW TO READ IT
--   Five rows. Every `status` must read `ok`. Anything else means the migration
--   did not fully apply — send the output back before deploying.
-- ============================================================================

select '1. column practices.archived_at' as check,
       case when a.attname is null then 'MISSING'
            when not a.attnotnull and format_type(a.atttypid, a.atttypmod) = 'timestamp with time zone' then 'ok'
            else 'WRONG SHAPE: ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' NOT NULL' else '' end
       end as status,
       coalesce(format_type(a.atttypid, a.atttypmod), '-') as detail
from (select 1) _
left join pg_attribute a
       on a.attrelid = to_regclass('public.practices')
      and a.attname = 'archived_at' and a.attnum > 0 and not a.attisdropped;

select '2. index practices_archived_at_idx' as check,
       case when c.relname is null then 'MISSING' else 'ok' end as status,
       coalesce(pg_get_indexdef(c.oid), '-') as detail
from (select 1) _
left join pg_class c on c.relname = 'practices_archived_at_idx'
                    and c.relnamespace = 'public'::regnamespace;

select '3. function set_practice_archived' as check,
       case when p.proname is null then 'MISSING'
            when not p.prosecdef then 'NOT SECURITY DEFINER'
            else 'ok' end as status,
       coalesce(pg_get_function_identity_arguments(p.oid), '-') as detail
from (select 1) _
left join pg_proc p on p.proname = 'set_practice_archived'
                   and p.pronamespace = 'public'::regnamespace;

-- The function runs above RLS, so its ONLY protection is the is_team() gate in
-- its body. If that gate is ever missing, any signed-in client could archive any
-- practice. This asserts the gate is present in the deployed source.
select '4. is_team() gate in the body' as check,
       case when p.proname is null then 'FUNCTION MISSING'
            when pg_get_functiondef(p.oid) ilike '%is_team()%' then 'ok'
            else '*** NO is_team() GATE — DO NOT LEAVE THIS DEPLOYED ***' end as status,
       'security definer must gate on is_team()' as detail
from (select 1) _
left join pg_proc p on p.proname = 'set_practice_archived'
                   and p.pronamespace = 'public'::regnamespace;

-- No existing practice should have been archived by the migration itself: it
-- adds a nullable column and issues no UPDATE. Every row must still be active.
select '5. no practice was archived' as check,
       case when count(*) filter (where archived_at is not null) = 0 then 'ok'
            else '*** ' || count(*) filter (where archived_at is not null) || ' practice(s) archived ***' end as status,
       count(*)::text || ' practice row(s) total, all active' as detail
from practices;
