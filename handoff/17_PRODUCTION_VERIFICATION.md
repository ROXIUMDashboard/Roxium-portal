# 17 · Production State Verification & Migration Safety

**Pass date:** 2026-09-15 · **Repo commit:** `df7731f` · **Project:** `nchtmeqsjkpcvtuscxfy`
**Nothing in production was modified.** Every production interaction in this pass was an
HTTP `GET … limit=1` using the public anon key already committed in `config.js`.

---

## 1 · What I could and could not reach

| Credential / tool | Available? | Consequence |
|---|---|---|
| Supabase **service-role** key | ❌ | cannot read `pg_catalog`, policy bodies, functions, triggers, indexes |
| Postgres connection string | ❌ | `psql` is installed but has nothing to connect to |
| `supabase` CLI + access token | ❌ | cannot `link`, `db diff`, `migration repair` or `db push` |
| Supabase **dashboard** | ❌ | cannot read Auth settings, SMTP, cron jobs, backups |
| Supabase **anon** key (public, in `config.js`) | ✅ | PostgREST reads: table existence, **column existence**, anon RLS behaviour |
| Network egress to the project | ✅ | verified: `/rest/v1/` responds |

**The anon key turns out to be enough to prove more than expected.** PostgREST raises
Postgres error `42703` for an unknown column *before* RLS filters rows, so
`?select=<column>&limit=1` is a reliable column-existence oracle that returns `[]` for a
column that exists and `400 42703` for one that does not — with zero data access. That is
the basis of `scripts/verify-production-schema.mjs`.

**Probe technique validated before use** (`practices.name` → `200 []`;
`practices.definitely_not_a_real_column_xyz` → `400 42703`).

---

## 2 · Schema diff: repository vs production

**Verified: 22 tables/views, 222 expected columns. Result: 21/22 clean, one real gap.**

### ❌ The one confirmed drift

| Object | Expected from | Production | Evidence |
|---|---|---|---|
| `practices.archived_at` | `migrations/2026-07-21_practice_archive.sql` | **MISSING** | `GET /rest/v1/practices?select=archived_at` → `400 {"code":"42703","message":"column practices.archived_at does not exist"}` |

Its companion index (`practices_archived_at_idx`) and function (`set_practice_archived`)
are almost certainly missing too, since the same file creates all three — but **I could
not verify the function**, see §3.

**Everything else expected by the repository exists**, including every table and column
that `schema.sql` omits: `practice_domains`, `video_comments`, `platform_connections`
(incl. `composio_connection_id`, `accounts`), `platform_tokens`, `kpi_dashboard_prefs`,
`demo_requests`, `kpi_daily`, `profiles.approval_status` / `requested_at` /
`ops_attention_state`, `practices.join_code` / `wizard_completed_at` /
`wizard_declined_at`, `activity.pinned`, `notifications.ref`,
`sheet_sources.access_status` / `access_requested_at`, `video_pipeline.owner_seat`,
`milestones.link_url` / `completed_on`, `deliverables.status_since` / `asana_task_id`,
`kpi_monthly.page_engagement`.

### Blast radius of the gap — contained

| Call site | Behaviour today |
|---|---|
| `app.js:533` `loadTeamPractices()` | Uses `select('*')`, so **no query error**. `list.filter(p => !p.archived_at)` reads `undefined` → every practice is kept. Harmless no-op. |
| `app.js:6816` Archive button | `rpc('set_practice_archived')` fails → caught → the user is shown *"Archive needs a quick update … Apply migration 2026-07-21_practice_archive.sql"*. |

**Net effect: the Archive feature is inert; nothing else is affected, and the UI already
names the fix.** This is a textbook example of the fail-soft pattern — a whole feature
silently absent for ~8 weeks with no alert anywhere. That is the risk this pass exists to
close, and it is now detected automatically.

---

## 3 · What is still unverified, and why

I attempted an RPC-existence probe (POST `/rpc/<fn>` with a deliberately invalid argument
name, which makes PostgREST fail overload resolution **without ever executing the
function**). It returned `PGRST202` for `set_practice_archived` — but **also for
`is_team`**, which certainly exists because every RLS policy depends on it.

**The probe is therefore worthless as an existence test and I am discarding its results.**
A nonsense argument name fails resolution regardless of whether the function exists, and
functions granted only to `authenticated` are invisible to the anon role anyway.

Still unverified, requiring the SQL editor:

- **functions / RPCs** — all 45
- **triggers** — all 12
- **RLS policy bodies** — the actual `USING` / `WITH CHECK` expressions
- **indexes** — including `memberships_user_practice_idx`, the RLS hot path
- **constraints**, column types, defaults, NOT NULL
- **storage** bucket privacy and `storage.objects` policies
- **function grants** — in particular whether `email_is_invited` / `join_code_practice`
  really are executable by `anon`
- **which migration files were executed** — there is no ledger to read

`scripts/verify-production-schema.sql` covers every one of these. It is read-only
(SELECTs only) and takes one paste into the SQL editor.

---

## 4 · RLS verification against production

### Proven
**Anonymous access is fully blocked.** All 22 tables/views were queried with the anon key:
every one returned HTTP 200 with `[]` — reachable through PostgREST, zero rows disclosed.
No table returned data. `platform_tokens` (RLS on, zero policies) also returns `[]`.

That is the correct posture and it matches the repository's intent.

### Not proven — and deliberately not attempted
- **Client-to-client isolation** and **membership as the authorization boundary** require
  signing in as two real client users in two practices. Doing so means sending magic-link
  emails to real people and creating real sessions. **Out of bounds for a verification
  pass**; it belongs in the RLS test suite (`12_TESTING_MAP.md` Tier 2) against a local or
  branch database.
- **Write denial.** Testing that anon cannot INSERT means *attempting an insert against
  production*. If RLS were broken, the test itself would pollute the database. I did not
  run it, and it should only ever run against a disposable database.
- **Policy bodies.** Section 8 of the SQL script prints every `pg_policies` row.

**No RLS policy was read, modified, added or removed in this pass.**

---

## 5 · Auth configuration

**Unverifiable from this environment.** Supabase Auth settings live in the dashboard and
in the GoTrue admin API; both need credentials I do not have. `/auth/v1/health` returns
401 without a key, and the settings endpoint requires service-role.

`supabase/config.toml` contains `enable_signup = true` — but that file is **local CLI
scaffolding that is never applied to the hosted project** (nothing runs `supabase db push`
or `supabase start`), so it is *not* evidence about production. Do not read it as such.

The open question from the audit (`03_AUTH_AND_PERMISSIONS.md` §8, `15_…` Q1) therefore
stands unchanged: **the code says invite-only (`shouldCreateUser:false`) and the project
setting is unknown.** Exact steps for Max in §G of the summary.

---

## 6 · Fail-soft schema dependencies — complete inventory

18 sites. `Prod?` uses the column evidence from §2; function-backed guards are marked
unverified per §3.

| # | Location | Schema dependency | Fallback today | Prod? | Still needed? | Risk |
|---|---|---|---|---|---|---|
| 1 | `loadKpiPrefs` `app.js:95-101` | `kpi_dashboard_prefs` | localStorage keeps prefs | ✅ exists | No | Low — prefs only |
| 2 | `saveKpiPrefs` `app.js:107-116` | `kpi_dashboard_prefs` | localStorage only | ✅ exists | No | Low |
| 3 | `loadTeamPractices` `app.js:533` | `practices.archived_at` | `undefined` → keep all | ❌ **MISSING** | **Yes, firing now** | Low today; if archiving ships, archived clients would reappear |
| 4 | `afterLogin` `app.js:787` | `ensure_my_profile()` | silent skip → "setup failed" | ⚠ unverified | Yes | **High** — a signup with no profile dead-ends |
| 5 | `loadAll` `app.js:874-879` | `platform_connections` | `data.connections = []` | ✅ exists | No | Med — would silently hide all connection state |
| 6 | `loadAll` `app.js:884-888` | `video_comments` | `data.vcomments = []` | ✅ exists | No | Low — internal notes |
| 7 | `togglePinUpdate` `app.js:2399-2403` | `activity.pinned` | alert naming the migration | ✅ exists | No | Low |
| 8 | `openVideoDetail` `app.js:3763-3770` | `video_comments` | inline "run the migration" | ✅ exists | No | Low |
| 9 | `saveOpsAttentionState` `app.js:4303-4315` | `set_my_ops_attention_state()` | localStorage; error swallowed if `/does not exist/` | ⚠ unverified | Yes | Med — dismiss/snooze silently local-only |
| 10 | `initOpsAttentionState` `app.js:4318-4337` | `get_my_ops_attention_state()` | localStorage | ⚠ unverified | Yes | Med — see `11_…` R-25 |
| 11 | `loadOperationsData` `app.js:5286-5291` | `platform_connections` | `[]` → no connection alerts | ✅ exists | No | **High if it ever fires** — the Needs Attention queue would silently lose every connection failure |
| 12 | `loadOperationsData` `app.js:5292-5297` | `get_pending_accounts()` | `[]` | ⚠ unverified | No — result is never read (R-15) | None |
| 13 | `refreshOnboardChecklist` `app.js:5378-5380` | `get_practice_onboarding_status()` | bare `return` | ⚠ unverified | Yes | Low |
| 14 | `loadAccountApprovals` `app.js:5509-5514` | `get_pending_accounts()` | "Run migration …" | ⚠ unverified | Yes | Low |
| 15 | `loadPlatformAdmins` `app.js:5572-5577` | `get_platform_admins()` | "Run migration …" | ⚠ unverified | Yes | Med — admin management unavailable |
| 16 | `loadAccessRoster` `app.js:5598-5605` | `get_practice_roster()` | "Run migration …" | ⚠ unverified | Yes | Med — no roster ⇒ no invite/remove |
| 17 | `saveAccessStatus` `app.js:6287-6296` | `sheet_sources.access_status` | names the migration | ✅ exists | No | Low |
| 18 | `btnArchivePractice` `app.js:6812-6826` | `set_practice_archived()` | names the migration | ❌ **inferred missing** | **Yes, firing now** | Low — feature inert, message is accurate |

**Pattern.** The guards that *name the migration* (7, 8, 14, 15, 16, 17, 18) are good: a
human is told what to do. The guards that **swallow silently** (1, 2, 3, 5, 6, 11, 12) are
the dangerous ones — #11 in particular would remove every connection-failure alert from the
Operations dashboard with no trace. None were changed in this pass (out of scope); they are
now at least *detectable*, because `verify-production-schema.mjs` fails when the dependency
is gone.

---

## 7 · Migration tracking — designed, prepared, **not executed**

### Current state
No ledger. `supabase_migrations.schema_migrations` does not exist (section 10 of the SQL
script confirms). 44 `.sql` files are applied by hand in filename order with no record.
Verified consequence: `2026-07-21_practice_archive.sql` was missed while its same-day
sibling `2026-07-21_demo_requests.sql` was applied.

### Chosen design — the standard Supabase workflow, not a custom system
`supabase/migrations/` + `supabase db push` + the CLI's own
`supabase_migrations.schema_migrations` ledger, baselined with
`supabase migration repair --status applied` (which writes a ledger row and **executes no
SQL**).

### Why I did not execute it
1. **It needs credentials I do not have** — `supabase login` + `supabase link` require an
   access token and the database password.
2. **Creating `supabase/migrations/` before the ledger is baselined lays a loaded gun.**
   With an empty ledger, anyone running `supabase db push` would replay all 44 files
   against the live database. `2026-07-07_catchup_reconcile.sql` embeds a full historical
   copy of `schema.sql` and **would revert functions that later migrations replaced** —
   including `delete_practice`, `claim_invites_for_user` and `email_is_invited`. That is a
   production-breaking outcome I cannot prove safe, so per your instruction I stopped.

### What I shipped instead
`scripts/adopt-supabase-migrations.sh`, which **defaults to `plan` and writes nothing**:

- `plan` — prints the full 44-file → CLI-timestamp mapping and the ordered runbook.
- `write` — creates `supabase/migrations/` **locally only**, plus a generated
  `scripts/.baseline-repair.sh` containing one `migration repair` line per file.

It never calls `supabase db push`, and the banner states the ordering constraint in full.
Dry-run verified: `plan` mode left `supabase/` untouched (still only `config.toml` and
`functions/`).

---

## 8 · Guardrails added

| Artifact | What it does | Needs secrets? |
|---|---|---|
| `scripts/expected-schema.json` | 22 tables / 222 columns the repo expects, each post-baseline column tagged with the migration that introduced it | — |
| `scripts/verify-production-schema.mjs` | read-only drift check; exits 1 on drift. Batches one request per table, falls back to per-column on failure | No — public anon key |
| `scripts/verify-production-schema.sql` | everything the anon key cannot reach: indexes, constraints, triggers, functions, **RLS policy bodies**, grants, storage, ledger state. SELECTs only | Runs in the SQL editor |
| `scripts/adopt-supabase-migrations.sh` | plan/write for CLI migration adoption; never pushes | No |
| `.github/workflows/verify-schema.yml` | on push/PR + weekly: `node --check` on shipped JS, `bash -n` on scripts, then the drift check | No |

**The CI workflow is deliberately NOT wired into `deploy-pages.yml` or
`deploy-functions.yml`.** There is real drift right now, so a blocking check would
immediately break every production deploy. Promote it to a required check once
`practices.archived_at` is resolved.

---

## 9 · Validation performed

- `node --check app.js` → passes. `app.js`, `styles.css`, `portal/index.html`,
  `index.html`, `config.js`, `schema.sql`, `migrations/*.sql` and `supabase/functions/**`
  are **byte-for-byte unchanged** (`git diff --stat` confirms: additions only, all under
  `scripts/`, `.github/workflows/` and `handoff/`).
- `bash -n` on both shell scripts → passes.
- `verify-production-schema.mjs` run against production → exit 1, one finding, matching the
  independent manual probe.
- `adopt-supabase-migrations.sh plan` → wrote nothing (verified by `ls supabase/`).
- No INSERT, UPDATE, DELETE, RPC execution, auth request or email was issued against
  production at any point.
