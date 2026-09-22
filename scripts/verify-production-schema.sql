-- ============================================================================
-- verify-production-schema.sql — READ-ONLY production verification.
--
-- Answers the questions scripts/verify-production-schema.mjs cannot reach with
-- the public anon key: indexes, constraints, triggers, functions, RLS POLICY
-- BODIES, grants and storage policies.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
--   Every statement is a SELECT. It creates nothing, alters nothing, deletes
--   nothing. It is safe to run on production at any time, as often as you like.
--
-- HOW TO READ IT
--   Each section prints `check` and `status`. Anything that is not `ok` is drift.
--   Send the full output back to the engineer before any migration work.
-- ============================================================================

-- ---------------------------------------------------------------- 1 · TABLES
select '1. tables' as check,
       t.expected as object,
       case when c.relname is null then 'MISSING' else 'ok' end as status,
       case when c.relrowsecurity then 'rls on' else '*** RLS OFF ***' end as rls
from (values
  ('practices'),('profiles'),('memberships'),('practice_invites'),('practice_domains'),
  ('deliverables'),('milestones'),('video_pipeline'),('video_history'),('video_comments'),
  ('activity'),('notifications'),('kpi_monthly'),('kpi_daily'),('sheet_sources'),
  ('platform_connections'),('platform_tokens'),('kpi_dashboard_prefs'),('sync_runs'),
  ('app_settings'),('demo_requests')
) as t(expected)
left join pg_class c on c.relname = t.expected
     and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by status desc, object;

-- ------------------------------------------------ 2 · COLUMNS KNOWN TO DRIFT
-- Post-baseline columns. A MISSING row names the migration that must be applied.
select '2. columns' as check, x.tbl || '.' || x.col as object,
       case when a.attname is null then 'MISSING' else 'ok' end as status,
       x.migration as expected_from
from (values
  ('practices','join_code','2026-07-07_practice_join_codes'),
  ('practices','wizard_completed_at','2026-07-09_platform_connections'),
  ('practices','wizard_declined_at','2026-07-15_wizard_declined'),
  ('practices','archived_at','2026-07-21_practice_archive'),
  ('profiles','ops_attention_state','2026-07-07_ops_attention_state'),
  ('profiles','approval_status','2026-07-09_account_approvals'),
  ('profiles','requested_at','2026-07-09_account_approvals'),
  ('deliverables','status_since','2026-06-22_deliv_sla_and_future_period_fix'),
  ('deliverables','asana_task_id','2026-06-23_phase_d_email'),
  ('milestones','completed_on','2026-06-25_milestone_completion_date'),
  ('milestones','link_url','2026-06-30_milestone_editor'),
  ('video_pipeline','owner_seat','2026-07-15_video_assignee_comments'),
  ('activity','pinned','2026-07-15_activity_pinned'),
  ('notifications','ref','2026-07-08_video_stage_notifications'),
  ('kpi_monthly','page_engagement','2026-06-24_page_engagement'),
  ('sheet_sources','access_status','2026-07-08_marketing_connections'),
  ('sheet_sources','access_requested_at','2026-07-08_marketing_connections'),
  ('platform_connections','composio_connection_id','2026-07-14_composio_connections'),
  ('platform_connections','accounts','2026-07-09_platform_connections')
) as x(tbl,col,migration)
left join pg_attribute a
       on a.attrelid = to_regclass('public.' || x.tbl)
      and a.attname = x.col and a.attnum > 0 and not a.attisdropped
order by status desc, object;

-- -------------------------------------------------------------- 3 · INDEXES
select '3. indexes' as check, i.expected as object,
       case when c.relname is null then 'MISSING' else 'ok' end as status,
       i.why
from (values
  ('memberships_user_practice_idx','RLS hot path: is_member_of() on every client read'),
  ('memberships_practice_idx','roster lookups'),
  ('deliverables_practice_idx','practice-scoped reads'),
  ('milestones_practice_idx','practice-scoped reads'),
  ('video_pipeline_practice_idx','practice-scoped reads'),
  ('activity_practice_idx','practice-scoped reads'),
  ('activity_practice_created_idx','feed newest-first'),
  ('practices_name_lower_uq','blocks duplicate practices'),
  ('practices_join_code_uq','join-code uniqueness'),
  ('practice_invites_practice_email_uq','one invite per email per practice'),
  ('practice_domains_domain_uq','one domain -> one practice'),
  ('kpi_monthly_practice_period_source_uq','KPI upsert conflict target'),
  ('kpi_daily_practice_day_idx','daily KPI reads'),
  ('deliverables_practice_asana_uq','Asana idempotency'),
  ('notifications_ref_idx','video notification dedupe'),
  ('sync_runs_ran_at_idx','sync history'),
  ('idx_video_comments_video','comment threads'),
  ('practices_archived_at_idx','archive filter')
) as i(expected,why)
left join pg_class c on c.relname = i.expected and c.relnamespace = 'public'::regnamespace
order by status desc, object;

-- ---------------------------------------------------------- 4 · CONSTRAINTS
select '4. constraints' as check, conname as object, 'present' as status,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
  and conname in ('profiles_approval_status_chk','platform_connections_status_check',
                  'platform_connections_provider_check','sheet_sources_access_status_chk')
order by conname;

-- ----------------------------------------------------------- 5 · RPC/FUNCTIONS
-- The anon key CANNOT verify these; this is the only reliable check.
select '5. functions' as check, f.expected as object,
       case when p.proname is null then 'MISSING' else 'ok' end as status,
       case when p.prosecdef then 'security definer' else 'invoker' end as security,
       coalesce(pg_get_function_identity_arguments(p.oid),'') as args
from (values
  ('is_team'),('my_practice'),('is_member_of'),('is_practice_owner'),('can_invite_to_practice'),
  ('set_my_name'),('get_my_ops_attention_state'),('set_my_ops_attention_state'),
  ('email_is_invited'),('email_domain'),('claim_invites_for_user'),('ensure_my_profile'),
  ('add_practice_invite'),('revoke_practice_invite'),('get_practice_roster'),
  ('remove_practice_member'),('set_practice_member_role'),('member_removal_block_reason'),
  ('count_team_admins'),('count_practice_owners'),('count_pending_owner_invites'),
  ('get_platform_admins'),('promote_platform_admin'),('demote_platform_admin'),
  ('get_pending_accounts'),('approve_account'),('reject_account'),
  ('delete_practice'),('delete_client'),('seed_practice'),
  ('get_practice_onboarding_status'),('practice_member_emails'),
  ('add_practice_domain'),('remove_practice_domain'),
  ('practice_join_link'),('rotate_practice_join_code'),('clear_practice_join_code'),
  ('join_code_practice'),('join_practice_by_code'),
  ('complete_marketing_wizard'),('decline_marketing_wizard'),('disconnect_platform'),
  ('finalize_past_months'),('notify'),('set_practice_archived')
) as f(expected)
left join pg_proc p on p.proname = f.expected and p.pronamespace = 'public'::regnamespace
order by status desc, object;

-- -------------------------------------------------- 6 · FUNCTION EXECUTE GRANTS
-- Watch for anything granted to `anon` that should not be.
select '6. grants' as check, p.proname as object,
       case when has_function_privilege('anon', p.oid, 'EXECUTE') then '*** anon CAN execute ***' else 'anon cannot' end as status,
       case when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'authenticated yes' else 'authenticated no' end as authed
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('email_is_invited','join_code_practice','join_practice_by_code',
                    'finalize_past_months','practice_member_emails','seed_practice',
                    'delete_practice','delete_client','approve_account','reject_account',
                    'promote_platform_admin','set_practice_archived')
order by object;

-- --------------------------------------------------------------- 7 · TRIGGERS
select '7. triggers' as check, t.expected as object,
       case when g.tgname is null then 'MISSING' else 'ok' end as status,
       coalesce(c.relname,'') as on_table
from (values
  ('trg_stamp_milestone_completion'),('trg_video_insert'),('trg_video_stage'),
  ('trg_notify_video_stage'),('trg_deliv_status'),('trg_protect_finalized_kpi'),
  ('trg_protect_finalized_kpi_daily'),('trg_sync_kpi_month'),('trg_notif_stats'),
  ('trg_protect_last_team_admin'),('trg_memberships_approve'),
  ('trg_sheet_sources_access_stamp')
) as t(expected)
left join pg_trigger g on g.tgname = t.expected and not g.tgisinternal
left join pg_class c on c.oid = g.tgrelid
order by status desc, object;

-- ------------------------------------------------------- 8 · RLS POLICY BODIES
-- The authoritative answer to "does production RLS match the repository?"
select '8. policies' as check, tablename || ' :: ' || policyname as object,
       cmd, roles::text, coalesce(qual,'(none)') as using_expr,
       coalesce(with_check,'(none)') as with_check_expr
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- Any public table with RLS enabled but NO policy at all (silent full lockout),
-- or RLS disabled entirely (silent full exposure).
select '8b. rls sanity' as check, c.relname as object,
       case when not c.relrowsecurity then '*** RLS DISABLED ***'
            when count(p.polname) = 0 then 'rls on, zero policies (service-role only)'
            else 'ok' end as status,
       count(p.polname) as policy_count
from pg_class c
left join pg_policy p on p.polrelid = c.oid
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by status desc, object;

-- ---------------------------------------------------------------- 9 · STORAGE
select '9. storage bucket' as check, id as object,
       case when public then '*** PUBLIC BUCKET ***' else 'private (ok)' end as status
from storage.buckets where id = 'deliverables';

select '9b. storage policies' as check, policyname as object, cmd, coalesce(qual,'(none)') as using_expr
from pg_policies where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- ------------------------------------------------- 10 · MIGRATION LEDGER STATE
select '10. ledger' as check,
       case when to_regclass('supabase_migrations.schema_migrations') is null
            then 'ABSENT — migrations are untracked (this is the state the audit found)'
            else 'present' end as status;

-- RUN 10b ONLY IF 10 REPORTED `present`. If the ledger does not exist this
-- statement errors with `relation "supabase_migrations.schema_migrations" does
-- not exist` — that error IS the answer, and it does not affect the sections above.
-- select '10b. ledger rows' as check, version as object, coalesce(name,'') as name
-- from supabase_migrations.schema_migrations order by version;
