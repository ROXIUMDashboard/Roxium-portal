-- ============================================================
-- "Your part" — let CLIENTS see which platform-access requests are waiting on
-- them, without opening sheet_sources (which is team-only under RLS).
--
-- A security-definer RPC returns only the safe fields (source, label, state,
-- request age) and only for a practice the caller belongs to (or team).
--
-- REQUIRES: 2026-07-08_marketing_connections.sql (access_status columns).
-- Apply once in Supabase → SQL Editor, AFTER the marketing-connections file.
-- Idempotent.
-- ============================================================

create or replace function public.get_my_pending_access(p_practice uuid)
returns table(source text, label text, access_status text, requested_days int)
language sql security definer stable set search_path = public as $$
  select s.source,
         coalesce(nullif(s.label,''), s.source),
         s.access_status,
         case when s.access_requested_at is not null
              then greatest(0, (now()::date - s.access_requested_at))::int
              else null end
  from sheet_sources s
  where s.practice_id = p_practice
    and s.is_active
    and s.access_status in ('requested','granted')
    and ( is_team()
          or exists (select 1 from memberships m
                     where m.user_id = auth.uid() and m.practice_id = p_practice) )
  order by s.access_requested_at nulls last;
$$;

grant execute on function public.get_my_pending_access(uuid) to authenticated;
