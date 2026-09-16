# 02 · Database Schema

Reconstructed by reading `schema.sql` **plus every file in `migrations/` in filename
order**. `schema.sql` alone is wrong — see §5.

> **UNVERIFIED:** this document describes what the SQL *would* produce if every
> migration has been applied. No one can confirm the live database matches without
> querying Supabase. Several migrations carry "apply once in the SQL editor" notes,
> and there is no ledger table, so **drift is possible and undetectable from the repo.**

---

## 1 · Table catalogue

### `practices` — the tenant root
- **PK** `id uuid default gen_random_uuid()`
- **Columns:** `name text not null`, `go_live date`, `workbook_sheet_id text` (Gen-1
  master Google Sheet), `created_at`, `join_code text` (`2026-07-07_practice_join_codes`),
  `wizard_completed_at timestamptz` + `wizard_declined_at timestamptz`
  (`platform_connections` / `wizard_declined` migrations), `archived_at timestamptz`
  (`2026-07-21_practice_archive`).
- **Indexes:** `practices_name_lower_uq` on `lower(btrim(name))` (blocks duplicate
  practices — the "two Balikians" bug); `practices_join_code_uq` partial on
  `join_code where not null`; `practices_archived_at_idx`.
- **RLS:** read `is_team() or is_member_of(id)`; write team-only.
- **Relationships:** parent of 12 tables via `practice_id … on delete cascade`.

### `profiles` — one row per portal user
- **PK** `id uuid references auth.users(id) on delete cascade`
- **Columns:** `full_name`, `role text not null default 'client' check (role in ('team','client'))`,
  `practice_id uuid references practices(id)` *(a default/active pointer, **not** the
  access grant)*, `ops_attention_state jsonb not null default '{}'`,
  `approval_status text not null default 'pending' check in ('pending','approved','rejected')`,
  `requested_at timestamptz`, `created_at`.
- **Triggers:** `trg_protect_last_team_admin` (BEFORE UPDATE OR DELETE) — refuses to
  demote or delete the only `role='team'` row, even from the Supabase Table Editor.
- **RLS:** `select using (id = auth.uid() or is_team())`; `for all using (is_team())`.
  A client can therefore **never** write their own profile directly — name changes go
  through `set_my_name()`.
- **⚠ No FK from `profiles.practice_id` with ON DELETE behaviour** — `delete_practice()`
  nulls it manually. A hand-deleted practice row would violate the FK instead.

### `memberships` — **the actual access-control table**
- **PK** `id uuid`; **unique** `(user_id, practice_id)`
- `user_id → auth.users(id) cascade`, `practice_id → practices(id) cascade`,
  `role text check in ('owner','member')`, `created_at`.
- **Indexes:** `memberships_user_practice_idx (user_id, practice_id)` and
  `memberships_practice_idx (practice_id)` — added late in
  `2026-07-14_phase2_indexes.sql`. These are **load-bearing**: `is_member_of()` runs on
  every row of every client read.
- **Trigger:** `trg_memberships_approve` (AFTER INSERT) → `approve_profile_on_membership()`
  flips `profiles.approval_status` to `approved` and backfills `practice_id`.
  ⚠ **INSERT-only** — an `on conflict do update` re-invite does not fire it
  (`invite-user/index.ts` compensates with an explicit `update`).
- **RLS:** `select using (is_team() or user_id = auth.uid())`; `for all using (is_team())`.

### `practice_invites` — per-email allowlist
- **PK** `id`; **unique index** `practice_invites_practice_email_uq (practice_id, lower(btrim(email)))`
- `email`, `full_name`, `role ('owner','member')`,
  `status ('pending','sent','accepted','revoked')`, `invited_by → auth.users`,
  `created_at`, `accepted_at`.
- **RLS:** team-all **and** `is_practice_owner(practice_id)`-all.

### `practice_domains` — domain auto-join (`2026-07-07_domain_auto_join`)
- **PK** `id`; **unique** `lower(btrim(domain))` → one domain maps to exactly one practice.
- `practice_id`, `domain`, `role`, `created_by`, `created_at`.
- **RLS:** team-only for everything.
- `add_practice_domain()` rejects 16 public mail domains (gmail, outlook, icloud…).

### `deliverables` — the promise tracker
- **PK** `id`; `practice_id` cascade.
- `phase text not null` (a **free-text label** like `'Phase 2 · Video & Authority'` — the
  phase number is parsed out of it by regex), `name`, `owner_seat`,
  `status ('promised','in_progress','delivered')`, `due date`, `delivered_at timestamptz`,
  `sort int`, `phase_order int`, `description text`, `status_since timestamptz`,
  `asana_task_id text`.
- **Indexes:** `deliverables_practice_asana_uq (practice_id, asana_task_id) where not null`;
  `deliverables_practice_idx (practice_id)`.
- **Trigger:** `trg_deliv_status` BEFORE UPDATE → stamps `status_since` on status change.
- **RLS:** read team-or-member; write **team only** (clients cannot tick anything off).
- **⚠ No `link_url` column** — this is why deliverables are not clickable for clients.

### `milestones`
- `name`, `detail`, `status ('done','current','upcoming')`, `target_date date`,
  `completed_on date`, `owner_seat`, `phase text default 'Roadmap'`,
  `progress_pct int 0..100`, `notes`, `link_url text`, `status_manual boolean`, `sort`.
- **Trigger:** `trg_stamp_milestone_completion` BEFORE INSERT/UPDATE — sets
  `completed_on = current_date` on entry to `done`, clears it on re-open.
- **RLS:** read team-or-member; write team-only. Index `milestones_practice_idx`.

### `video_pipeline`
- `item`, `stage check in ('planned','scheduled','pre_production','shot','editing','delivered','posted')`,
  `blocked boolean`, `blocked_reason text`, `updated_at`, `stage_since timestamptz`,
  `planned_shoot_date date`, `shot_date`, `posted_date`, `video_url`, `sort`,
  `description`, `owner_seat` (`2026-07-15_video_assignee_comments`).
- **Triggers:**
  - `trg_video_insert` AFTER INSERT → `log_video_insert()` writes the starting stage to
    `video_history`.
  - `trg_video_stage` BEFORE UPDATE → `log_video_stage()` restamps `stage_since`,
    auto-fills `shot_date`/`posted_date`, and logs history **only for forward moves**
    along the canonical 7-stage order.
  - `trg_notify_video_stage` AFTER UPDATE OF stage → `notify_video_stage()` writes a
    de-duplicated `notifications` row (skips `planned`).
- **RLS:** read team-or-member; write team-only. Index `video_pipeline_practice_idx`.

### `video_history`
- `video_id` cascade, `practice_id` cascade, `stage`, `note`, `moved_at`.
- RLS: read team-or-member; team-all; explicit team-delete policy.
- This table is what `buildEngagementTimeline()` turns into the client update feed.

### `video_comments` (`2026-07-15_video_assignee_comments`)
- `video_id` cascade, `practice_id` cascade, `author_id`, `author_name`, `body`, `created_at`.
- Index `idx_video_comments_video (video_id, created_at)`.
- **RLS: team-only, deliberately no member read policy** — internal notes.

### `activity` — the update feed
- `message not null`, `author`, `source text default 'portal'` (`portal|comment|asana|coefficient`),
  `created_at`, `edited_at`, `pinned boolean not null default false`.
- Indexes `activity_practice_idx`, `activity_practice_created_idx (practice_id, created_at desc)`.
- RLS: read team-or-member; write team-only.

### `notifications`
- `kind text` (`deliverable|milestone|video|stats`), `message`, `seen boolean`,
  `emailed boolean`, `created_at`, `ref text` (dedupe key — the video id).
- Index `notifications_ref_idx (practice_id, kind, ref)`.
- **RLS:** read team-or-member; `insert with check (is_team())`;
  `update using (is_member_of(practice_id))` — this is how a client marks one seen;
  team-all. The `notify()` helper is SECURITY DEFINER so triggers bypass the insert policy.

### `kpi_monthly` — the metric store
- **Unique** `(practice_id, period, source)` (also as index
  `kpi_monthly_practice_period_source_uq`).
- `period date` (first of month), `source text default 'marketing'`, `month int 1..12`
  (derived), and the metric columns:
  `spend, reach, impr, clicks, lpv, page_likes, page_engagement, foll` (the live ad
  metrics) plus the **legacy business columns** `leads, cons, proc, apv, price, sent,
  opens, eclk, sms, vid, rank, posts`, plus `finalized boolean`, `updated_at`.
- **Triggers:** `trg_sync_kpi_month` BEFORE INS/UPD (derives `month`, touches
  `updated_at`); `trg_protect_finalized_kpi` BEFORE UPDATE (a finalized row silently
  returns OLD — **writes are ignored, not rejected**); `trg_notif_stats` AFTER INSERT
  (writes a "stats ready" notification unless the period is more than one month future).
- RLS: read team-or-member; write team-only.

### `kpi_daily`
- Same shape keyed `(practice_id, day, source)`; `finalized`, `updated_at`.
- Indexes `kpi_daily_practice_day_idx`, `kpi_daily_day_idx`.
- Trigger `trg_protect_finalized_kpi_daily`. Same RLS.

### `sheet_sources` — Generation-1 ingestion config
- **Unique** `(practice_id, source)`.
- `source_type` (`google_sheet_csv|google_sheet_private`), `source` (channel key),
  `label`, `csv_url`, `sheet_id`, `tab_name`, `gid`, `is_active`,
  `last_synced_at`, `last_status`, `last_error`, `last_rows`, `last_months text[]`,
  `access_status ('requested','granted','connected')`, `access_requested_at date`.
- **Trigger:** `trg_sheet_sources_access_stamp` BEFORE INS/UPD — stamps
  `access_requested_at`, and auto-promotes `access_status` to `connected` whenever
  `last_synced_at is not null and last_status='ok'`.
- **RLS: team-only for everything** — clients cannot see their own source config.

### `platform_connections` — Generation-2 OAuth state
- **Unique** `(practice_id, provider)`.
- `provider text check (provider ~ '^[a-z][a-z0-9_]{1,30}$')` (opened up from the
  original `meta|google` enum in `connections_2_0`),
  `status check in ('pending','connected','error','revoked')`,
  `external_account_id`, `external_account_name`, `accounts jsonb` (discovered account
  list for a picker), `scopes text[]`, `connected_by`, `connected_at`,
  `last_synced_at`, `last_error`, `composio_connection_id text`.
- **RLS:** team-all; **plus** `member reads own connections` (SELECT for practice members).
- Written by `oauth-start`, `oauth-callback`, `sync-platforms` (service role) and by the
  `disconnect_platform()` RPC.

### `platform_tokens` — **dead**
- PK `connection_id` cascade; `access_token`, `refresh_token`, `expires_at`, `updated_at`.
- RLS enabled with **zero policies** (service-role-only by design).
- **Never written.** The DIY-OAuth design it belonged to was replaced by Composio.

### `kpi_dashboard_prefs`
- PK `(user_id, practice_id)`, `cards jsonb`, `updated_at`.
- RLS: `user_id = auth.uid()` for all; team-all.

### `sync_runs` — ingestion audit log
- `ran_at`, `trigger`, `ok`, `rows_seen`, `upserted`, `skipped_count`, `months_seen text[]`,
  `sources jsonb`, `error`. Index on `ran_at desc`.
- RLS: team SELECT; `insert with check (auth.role() = 'service_role')`.
- **Only `sync-coefficient` writes here. `sync-platforms` does not** — the Composio
  pipeline has no run log.

### `app_settings` — global key/value (e.g. `master_reporting_drive_folder`)
- PK `key`; team-only RLS.

### `demo_requests` (`2026-07-21`)
- `name`, `practice`, `email`, `channels`, `created_at`. RLS: team SELECT only; written by
  the `book-demo` service-role client.

### Storage
- Bucket `deliverables`, **private**.
- `read own files`: `bucket_id='deliverables' and (is_team() or membership matches
  (storage.foldername(name))[1])` — i.e. the first path segment must be the practice id.
- `team uploads`: INSERT team-only.
- **⚠ No DELETE or UPDATE policy on `storage.objects`** — nobody, including team, can
  delete or overwrite an uploaded deliverable file through the API.

### View
- `public.sheet_sync_status` — `security_invoker = true` (hardened in
  `2026-06-26_security_hardening`), `revoke all from public`, `grant select to
  authenticated`. Not read by `app.js`; kept for SQL dashboards.

---

## 2 · Functions / RPCs

**Security helpers (SECURITY DEFINER, `set search_path = public`)**
`is_team()`, `my_practice()`, `is_member_of(uuid)`, `is_practice_owner(uuid)`,
`can_invite_to_practice(uuid)`, `email_domain(text)`, `_can_manage_join_code(uuid)`.

**Access & lifecycle**
| RPC | Grantee | Guard |
|---|---|---|
| `email_is_invited(text)` | **anon**, authenticated | none — leaks whether an email exists. **Unused by the app.** |
| `claim_invites_for_user()` | authenticated | `auth.uid()` |
| `ensure_my_profile(text)` | authenticated | creates a `pending`/`client` profile, never escalates |
| `add_practice_invite(uuid,text,text,text)` | authenticated | `can_invite_to_practice` |
| `revoke_practice_invite(uuid)` | authenticated | `can_invite_to_practice` + last-owner guard |
| `get_practice_roster(uuid)` | authenticated | `can_invite_to_practice` |
| `remove_practice_member(uuid,uuid)` | authenticated | `can_invite_to_practice`, refuses self |
| `set_practice_member_role(uuid,uuid,text)` | authenticated | `can_invite_to_practice` + last-owner guards |
| `member_removal_block_reason(uuid,uuid)` | — | helper |
| `get_platform_admins()` / `demote_platform_admin(uuid)` / `promote_platform_admin(text)` | authenticated | `is_team()` + last-admin guards |
| `count_team_admins()` / `count_practice_owners(uuid)` / `count_pending_owner_invites(uuid)` | — | helpers |
| `get_pending_accounts()` | authenticated | `where is_team()` inside the SQL |
| `approve_account(uuid,uuid,text)` / `reject_account(uuid)` | authenticated | `is_team()` |
| `delete_practice(uuid)` → jsonb | authenticated | `is_team()`; returns `deleted_user_ids` |
| `delete_client(uuid)` → jsonb | authenticated | `is_team()` |
| `set_practice_archived(uuid,bool)` | authenticated | `is_team()` |
| `add_practice_domain` / `remove_practice_domain` | authenticated | `is_team()` |
| `practice_join_link` / `rotate_practice_join_code` / `clear_practice_join_code` | authenticated | team or practice owner |
| `join_code_practice(text)` | **anon**, authenticated | none |
| `join_practice_by_code(text)` | authenticated | code match only |
| `practice_member_emails(uuid)` | **revoked from all** | service role only |
| `seed_practice(text,date)` | authenticated | `is_team()` + duplicate-name guard |
| `get_practice_onboarding_status(uuid)` | authenticated | `is_team()` |
| `set_my_name(text)` | authenticated | own row, `full_name` only |
| `get_my_ops_attention_state()` / `set_my_ops_attention_state(jsonb)` | authenticated | setter requires `is_team()` |
| `complete_marketing_wizard(uuid)` / `decline_marketing_wizard(uuid,bool)` | authenticated | member or team |
| `disconnect_platform(uuid,text)` | authenticated | member or team |
| `finalize_past_months()` | **revoked from public/anon/authenticated** | service role or team |
| `reopen_kpi_month(uuid,date,bool)` | **revoked from authenticated** | team repair helper |

**Trigger functions**
`notify()`, `notify_video_stage()`, `notif_stats()`, `log_video_insert()`,
`log_video_stage()`, `touch_deliv_status()`, `stamp_milestone_completion()`,
`sync_kpi_month()`, `protect_finalized_kpi()`, `protect_finalized_kpi_daily()`,
`protect_last_team_admin()`, `approve_profile_on_membership()`,
`sheet_sources_access_stamp()`.

---

## 3 · Who can read / write what

| Table | Client (member) READ | Client WRITE | Team READ | Team WRITE |
|---|---|---|---|---|
| practices | own | — | all | all |
| profiles | own row | via `set_my_name()` only | all | all |
| memberships | own rows | — | all | all |
| practice_invites | **owner only** (own practice) | owner, via RPCs | all | all |
| practice_domains | — | — | all | all |
| deliverables / milestones / video_pipeline / video_history | own practice | — | all | all |
| video_comments | **no** | — | all | all |
| activity | own practice | — | all | all |
| notifications | own practice | `seen` flag only | all | all |
| kpi_monthly / kpi_daily | own practice | — | all | all |
| sheet_sources | **no** | — | all | all |
| platform_connections | own practice (SELECT) | via `disconnect_platform()` | all | all |
| platform_tokens | **no** | — | **no** | — (service role only) |
| kpi_dashboard_prefs | own row | own row | all | all |
| sync_runs | — | — | all | service role inserts |
| app_settings / demo_requests | — | — | all | team / service role |
| storage `deliverables` | own practice folder | — | all | INSERT only |

---

## 4 · Relationship map

```
auth.users ──1:1── profiles ──*:1(soft)── practices
     │                                        │
     └──*:*── memberships ────────────────────┤  (THE access edge)
                                              ├── practice_invites   (email allowlist)
                                              ├── practice_domains   (domain allowlist)
                                              ├── deliverables ─(asana_task_id)→ Asana
                                              ├── milestones
                                              ├── video_pipeline ──1:*── video_history
                                              │                  └─1:*── video_comments
                                              ├── activity
                                              ├── notifications  (ref → video_pipeline.id, untyped)
                                              ├── kpi_monthly    ┐ keyed (practice, period, source)
                                              ├── kpi_daily      ┘ keyed (practice, day,    source)
                                              ├── sheet_sources        (Gen-1 config)
                                              ├── platform_connections (Gen-2 config)
                                              │        └─1:1── platform_tokens  [DEAD]
                                              └── kpi_dashboard_prefs (also → auth.users)
```

---

## 5 · Schema inconsistencies

1. **`schema.sql` is not the schema.** It omits ~7 tables and ~12 columns that shipped
   after it. Its own header admits it, but `README.md` still tells a new operator to run
   it as step 1. Anyone building a mental model from it will be wrong.
2. **No migration ledger.** Nothing records which migrations were applied. Drift is
   invisible; the code compensates with ~10 `try{…}catch(_){}` fail-soft blocks.
3. **Two competing "which practice am I in" sources:** `profiles.practice_id` vs
   `memberships`. `afterLogin()` and `lifecycle_fixes.sql` declare memberships
   authoritative, but `delete_practice`, `approve_account`,
   `approve_profile_on_membership` and `claim_invites_for_user` all still write
   `profiles.practice_id`, and `practice_member_emails()` still **unions** both.
4. **Two competing ingestion-config models:** `sheet_sources` (Gen-1, team-only,
   `access_status` state machine) and `platform_connections` (Gen-2, member-visible,
   `status` state machine). `buildOpsAlerts()` raises alerts from **both**, so one
   practice can show both "Access request pending" and "Connection failed" for the same
   channel.
5. **`kpi_monthly.month`** is fully derived from `period` and exists only for a CHECK
   constraint and some notification copy — redundant.
6. **`notifications.ref`** is an untyped `text` pointing at `video_pipeline.id` with no FK.
   Deleting a video leaves an orphan notification (nothing cascades).
7. **`platform_connections.status` allows 4 values; `connStateModel()` handles 6.**
8. **`deliverables.phase` is free text** whose phase number is recovered by
   `/Phase\s*(\d+)/i` (`app.js:4362`). A phase renamed to "Discovery" silently loses all
   its deadline rules. `Phase 6–7 · Retainer` parses to `6`, which has no `PHASE_TIMING`
   entry — intended, but fragile.
9. **`practices.workbook_sheet_id` vs `sheet_sources.sheet_id`** — the latter is
   documented as a "legacy per-row fallback" and still read by the sync function.

## 6 · Orphan-risk areas

- `profiles.practice_id` has **no ON DELETE action**. Every deletion path nulls it in
  application code; a manual `delete from practices` in the SQL editor will fail on the FK.
- `notifications.ref` → no FK (above).
- `deliverables.asana_task_id` → no integrity with Asana; a renamed/removed task
  silently strands the row.
- Storage objects: no DELETE policy, so removing a practice cascades its DB rows but
  **leaves its files in the `deliverables` bucket forever**.
- Composio connected accounts: `delete-account` revokes them best-effort inside a
  `try/catch` that swallows failures — a Composio outage during teardown leaves a live
  third-party token with no local record.
- `practice_domains` survives its practice via cascade, but if a practice is
  **archived** (not deleted) the domain still auto-joins new users into it.

## 7 · Fields that appear unused

| Field | Evidence |
|---|---|
| `kpi_monthly.apv, price, sent, opens, eclk, sms, vid, rank, posts` | not in `FIELDS`, `CORE_METRICS`, `OPTIONAL_METRICS` or `XL_MAP`; only `sent/opens/eclk/sms/vid/posts` appear in `KPI_ADDITIVE` |
| `kpi_monthly.leads, cons, proc` | `leads`/`cpl` render in `OPTIONAL_METRICS`; `cons`/`proc` only in the ops rollup. **No UI writes any of them** — they were workbook-import fields |
| `platform_connections.scopes` | never written (Composio owns scopes) |
| `platform_connections.accounts` | **written** by `sync-platforms`, but `loadAll()`/`reloadConnections()` do not even `select` it, and no picker UI exists |
| `platform_tokens.*` | table never written |
| `milestones.progress_pct, notes, status_manual` | `status_manual` is read by `milestoneDisplayStatusMap()`; `progress_pct`/`notes` appear only in the editor modal |
| `video_pipeline.shot_date, posted_date` | auto-stamped by trigger, never displayed |
| `notifications.emailed` | never set — emails go through `notify-client`, which does not write back |
| `sheet_sources.gid, csv_url` | legacy CSV path; `INGESTION_MODE=sheets_api` is the documented target |
| `profiles.requested_at` | written on insert, read only by `get_pending_accounts()` |

## 8 · Migration history that matters

- **`2026-06-22_phase_b_kpi_period.sql`** established the immutable month-snapshot model.
  Everything KPI-related depends on `(practice_id, period, source)`.
- **`2026-06-22_phase_c_memberships.sql` → `2026-06-24_practice_invites_and_access.sql`
  → `2026-06-24_access_guardrails.sql`** is the access model's spine.
- **`2026-07-07_catchup_reconcile.sql`** is a repair migration for a drifted live DB. Its
  Part B re-runs a whole schema snapshot. Treat it as a one-time rescue, not a normal
  migration; **do not re-run it after later migrations without reading it**.
- **The four `platform_connections` migrations are order-sensitive**
  (`marketing_connections` → `platform_connections` → `composio_connections` →
  `connections_2_0`). Applied out of order the CHECK constraints diverge.
  `migrations/README.md` calls this out.
- **`2026-07-14_lifecycle_fixes.sql`** is the most behaviourally significant recent
  migration: it changed `delete_practice`'s **return type** (requiring a `drop function`
  first) and turned `reject_account` / `remove_practice_member` from cosmetic flags into
  real revocations.
- **`2026-07-14_phase2_indexes.sql`** — until this was applied, every client page load
  did a sequential scan of `memberships` per row. If it has not been applied to
  production, that is a live performance cliff.
