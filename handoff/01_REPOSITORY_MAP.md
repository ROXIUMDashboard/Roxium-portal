# 01 · Repository Map

Verified against HEAD `e28a478`. Sizes are approximate.

---

## 1 · Top-level tree

```
Roxium-portal/
├── index.html                974 lines · PUBLIC MARKETING LANDING PAGE (self-contained
│                                          <style> block; NOT the portal)
├── portal/index.html          35 KB · THE APPLICATION SHELL (all view skeletons)
├── app.js                   6,931 lines / 394 KB · ALL portal logic, one global scope
├── styles.css               1,905 lines / 142 KB · the entire design system
├── config.js                  10 lines · SUPABASE_URL + SUPABASE_ANON_KEY (committed)
├── _headers                   Cloudflare Pages security + cache headers
├── _redirects                 Cloudflare Pages routing incl. the SPA fallback
├── privacy/index.html         standalone legal page
├── terms/index.html           standalone legal page
│
├── schema.sql                960 lines · ⚠ STALE baseline snapshot (see §7)
├── migrations/               45 hand-applied .sql files + README.md
│
├── supabase/
│   ├── config.toml           Supabase CLI scaffolding — NOT used by production
│   └── functions/            13 Deno Edge Functions + _shared/
│
├── scripts/prepare-pages.sh  the entire "build": copies an allow-list into site/
├── .github/workflows/        deploy-pages.yml · deploy-functions.yml
│
├── docs/                     19 markdown docs + docs/onboarding/ (9) + email-templates/ (2)
├── README.md                 setup guide (⚠ partly stale — see §8)
├── ARCHITECTURE.md           requirements + phase plan (⚠ describes an older data flow)
│
├── bhfa-2027/                A SEPARATE Next.js application. Shares no code or tables.
└── node_modules/             empty (no root package.json)
```

**There is no `package.json`, no lockfile, no bundler, no linter and no test runner at
the repository root.**

---

## 2 · Purpose of every important folder

| Path | Purpose | Notes |
|---|---|---|
| `/` (root files) | the deployed static site | only the allow-list in `prepare-pages.sh` ships |
| `portal/` | the app shell served at `/portal/` | must stay a **directory index** — `_redirects` explains the Safari redirect-loop that forced this |
| `migrations/` | **the schema source of truth** | filename order = apply order; applied by hand |
| `supabase/functions/` | privileged server logic | all deployed `--no-verify-jwt`, gate internally |
| `supabase/functions/_shared/` | shared auth/http/oauth/composio helpers | partially adopted — 4 functions still inline their own copies |
| `scripts/` | one build script | |
| `docs/` | operational + architectural documentation | several files are prior audits, not current state |
| `docs/onboarding/` | client-facing onboarding SOP collateral | the "onboarding SOP for adding a practice" the brief asks for **already exists** here and in `docs/ROXIUM_ONBOARDING_SOP.md` |
| `docs/email-templates/` | HTML to paste into Supabase Auth dashboard templates | not read by any code |
| `bhfa-2027/` | Beverly Hills Face Academy 2027 agenda planning room | Next.js 16 / React 19 / Railway / its own Supabase; has vitest + Playwright tests |

---

## 3 · Important entrypoints

| Entry | File | Notes |
|---|---|---|
| Public site | `index.html` | marketing page; forwards any auth hash/query to `/portal/` |
| Portal app | `portal/index.html` → `config.js` → `app.js` | scripts are `defer`red so order is preserved |
| App boot | `app.js:563 init()` → `boot()` → `afterLogin()` | `sb.auth.onAuthStateChange` (`app.js:571`) re-enters `boot()` once |
| Team landing | `#operations` → `renderOperationsDashboard()` `app.js:5083` | data via `loadOperationsData()` `app.js:5266` |
| Client landing | `#overview` → `renderOverview()` `app.js:1496` | data via `loadAll()` `app.js:853` |
| Cron ingestion | `POST /functions/v1/sync-platforms` and `/sync-coefficient` with `x-sync-key` | schedule lives in Supabase (pg_cron/pg_net) — **UNVERIFIED** from the repo |

---

## 4 · Important frontend files & functions (`app.js`)

`app.js` has no module boundaries; these are the de-facto sections.

| Lines | Section | Key functions |
|---|---|---|
| 1–230 | constants & metric model | `FIELDS`, `CORE_METRICS`, `OPTIONAL_METRICS`, `METRIC_REGISTRY`, `METRIC_INFO`, `DEFAULT_KPI_CARDS`, `CHANNELS`, `sourceKey`, `normalizeKpiRows`, `STAGES` |
| 230–550 | routing / chrome | `showView` (377), `syncChrome` (414), `hashParts` (266), `currentView` (280), `canSeeAccessTab` (261), `buildSwitcher` (477) |
| 550–900 | **auth** | `init` (563), `boot` (556), login handlers (594–640), `afterLogin` (768), `showPendingPane` (754), `loadAll` (853), notification popover (713–739) |
| 900–1290 | **KPI math & charts** | `computeKpi` (903), `mergeKpiByPeriod` (923), `mergeKpiByDay` (969), `buildDailyChartSeries` (999), `renderKpiCharts` (1232) |
| 1285–1660 | client Overview | `buildKpiInsights` (1285), `buildClientOverview` (1311), `renderOverview` (1496) |
| 1660–1940 | marketing setup wizard | `shouldPromptMarketingConnect` (1691), `renderSetupWizard` (1743), `PLATFORM_CATALOG` (1920) |
| 1940–2210 | **connections manager** | `connHealth` (1965), `connStateModel` (1980), `renderSidebarSync` (2007), `startPlatformConnect` (2050), `renderConnectionsPage` (2072) |
| 2206–2440 | **updates / activity** | `classifyUpdate` (2206), `buildEngagementTimeline` (2214), `renderUpdates` (2303), `renderUpdatesBadge` (2407) |
| 2440–2890 | render orchestration + UI kit | `render` (2440), `uiDialog` (2734), `themedSelect` (2791), `enhanceNativeSelect` (2833) |
| 2889–3440 | **deliverables & phases** | `phaseGroups` (2899), `delivAttention` (2938), `renderClientProgress` (3008), `renderTeamProgress` (3033), `updateDeliverableStatus` (3355), `autoAdvanceMilestones` (3373) |
| 3430–3830 | **video pipeline** | `daysIn` (3438), `slaState` (3441), `videoRow` (3506), `renderPipeline` (3547), `openVideoDetail` (3653) |
| 3827–4190 | milestones / roadmap | `renderClientRoadmap` (3861), `openMilestoneEditor` (4002), `updateMilestoneStatus` (4166) |
| 4191–4270 | notifications out | `notifyClient` (4191), `renderBanner` (4213) |
| 4270–4640 | **ops attention engine** | `PHASE_TIMING` (4352), `computePracticePhaseState` (4380), `computeClientHealth` (4455), `buildOpsAlerts` (4480), `prepareOpsAttentionList` (4593) |
| 4643–5360 | **operations dashboard** | `renderOpsCompanyKpi` (4643), `aggregateCompanyKpiByMonth` (4668), `renderOpsClientDetail` (4982), `renderOperationsDashboard` (5083), `loadOperationsData` (5266) |
| 5356–5760 | **access & approvals** | `sendPracticeInvite` (5402), `renderRoster` (5421), `loadAccountApprovals` (5509), `loadPlatformAdmins` (5572), `loadClientAccessRoster` (5613) |
| 5741–6440 | Team Controls / reporting admin | `renderSyncStatus` (5811), `renderAdminClients` (6062), `deployClient` (6110), `detectTabs` (6153), `deletePractice` (6338) |
| 6436–6931 | data management, exports, Sync Health | `practiceExportSections` (6452), `renderSyncHealth` (6637), `shRunSync` (6787) |

### `portal/index.html`
The DOM skeleton for every view: `#login`, `#pendingPane`, `#app` (sidebar + topbar +
`section.view[data-view=…]` per route), `#modal`, `#setupWizardModal`. `BUILD_SHA` is a
literal placeholder that `prepare-pages.sh` replaces with the deploy SHA.

---

## 5 · Important backend files

| File | Lines | Notes |
|---|---|---|
| `supabase/functions/sync-coefficient/index.ts` | ~1,200 (46 KB) | biggest function: Google Sheets/CSV ingestion, shape detection (wide vs long, daily vs monthly), workbook discovery, tab detection, `COLUMN_ALIASES` header mapping |
| `supabase/functions/sync-platforms/index.ts` | 19 KB | Composio → Meta + Google Ads → `kpi_monthly`/`kpi_daily` |
| `supabase/functions/invite-user/index.ts` | 11 KB | the *only* code path that creates an auth user |
| `supabase/functions/weekly-digest/index.ts` | 11 KB | internal ops email |
| `supabase/functions/delete-account/index.ts` | 5 KB | the only path that deletes an auth user |
| `supabase/functions/notify-client/index.ts` | 6.6 KB | branded Resend update email |
| `supabase/functions/oauth-start` / `oauth-callback` | 4.4 / 4.9 KB | Composio hosted-auth handshake, HMAC state |
| `supabase/functions/book-demo/index.ts` | 4.4 KB | **public, unauthenticated** endpoint |
| `supabase/functions/asana-sync` / `asana-webhook` | 3.7 / 3.0 KB | scaffolded, not scheduled |
| `supabase/functions/_shared/auth.ts` | `serviceClient`, `bearerToken`, `requireTeamUser`, `UUID_RE`, `json` |
| `supabase/functions/_shared/composio.ts` | `createLink`, `getConnectedAccount`, `executeTool`, `deleteConnectedAccount`, `composioProvider` |
| `supabase/functions/_shared/oauth.ts` | `signState`/`verifyState` (HMAC-SHA256 over `SYNC_SECRET`), `callbackUrl`, `portalUrl`, **and dead `providerConfig`** |
| `supabase/functions/_shared/http.ts` | shared `cors`/`respond`/`preflight`; its own header comment admits 4 functions still inline their own copies |

---

## 6 · Migrations (chronological)

45 files, `2026-06-22` → `2026-07-21`. Full per-object detail in `02_DATABASE_SCHEMA.md`.
The ones that matter most:

| File | What it establishes |
|---|---|
| `2026-06-22_phase_b_kpi_period.sql` | month-snapshot KPI model `(practice_id, period, source)` |
| `2026-06-22_phase_c_memberships.sql` | `memberships` — the access model |
| `2026-06-24_practice_invites_and_access.sql` | `practice_invites`, `claim_invites_for_user`, roster RPCs |
| `2026-06-24_access_guardrails.sql` | last-admin / last-owner protection, `protect_last_team_admin` trigger |
| `2026-06-26_security_hardening.sql` | view → `security_invoker`, `notifications` INSERT policy, `finalize_past_months` lockdown |
| `2026-07-07_catchup_reconcile.sql` | **54 KB** — Part A column/constraint reconcile + Part B a full inlined copy of `schema.sql` as of that date |
| `2026-07-07_domain_auto_join.sql` | `practice_domains`; rewrites `email_is_invited` + `claim_invites_for_user` |
| `2026-07-07_practice_join_codes.sql` | `practices.join_code`, `join_practice_by_code` |
| `2026-07-08/09/14 ×4` | the `platform_connections` evolution — **order-sensitive** (constraints added then replaced) |
| `2026-07-09_account_approvals.sql` | `profiles.approval_status`, `ensure_my_profile`, `get_pending_accounts`, `approve_account` |
| `2026-07-14_lifecycle_fixes.sql` | `delete_practice` returns ids, `delete_client`, real revocation in `reject_account` / `remove_practice_member` |
| `2026-07-14_phase2_indexes.sql` | the RLS-critical `memberships(user_id, practice_id)` index |
| `2026-07-21_practice_archive.sql` | `practices.archived_at`, `set_practice_archived` |

---

## 7 · CI/CD and configuration files

| File | Role |
|---|---|
| `.github/workflows/deploy-pages.yml` | on push to `main`: `prepare-pages.sh` → `wrangler pages deploy site` → project `roxium-portal`, branch `main`. Verifies `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, creates the Pages project if missing |
| `.github/workflows/deploy-functions.yml` | on push to `main` touching `supabase/functions/**`: deploys **every** function with 3 retries each (esm.sh flakiness), fails the job only if one never succeeds |
| `scripts/prepare-pages.sh` | copies `index.html app.js styles.css config.js _headers _redirects portal/ privacy/ terms/` into `site/`, substitutes `BUILD_SHA`, writes `version.json` |
| `_redirects` | `/portal.html`→`/portal/` 301, `/portal`→`/portal/` 301, `/privacy` + `/terms` 200 rewrites, then `/* → /portal/index.html 200` |
| `_headers` | `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`; `no-store` on the HTML entrypoints, `no-cache` on `*.js`/`*.css`. **No CSP.** |
| `config.js` | Supabase project URL + anon key, committed deliberately |
| `supabase/config.toml` | Supabase CLI local-dev scaffolding. **Not applied to production** — nothing runs `supabase db push` or `supabase start` |
| `.gitignore` | ignores `site/`, `*.zip` |

---

## 8 · Obsolete, suspicious, or misleading

| Item | Finding |
|---|---|
| `schema.sql` | Its own header says "ORIGINAL BASELINE… NOT a full mirror". It is actually a snapshot from ~2026-07-07 and **omits** `platform_connections`, `platform_tokens`, `kpi_dashboard_prefs`, `practice_domains`, `video_comments`, `demo_requests`, `profiles.approval_status`, `practices.join_code`/`archived_at`/`wizard_*`, `activity.pinned`, `notifications.ref`. Anyone reading it alone will build a wrong mental model. |
| `migrations/2026-07-07_catchup_reconcile.sql` Part B | Embeds a whole copy of the then-current `schema.sql`. Re-running it **reverts** any function later redefined by a migration that sorts *before* it. It happens to be safe today (it sorts first among the `07-07` files: `c` < `d` < `k` < `o` < `p`), but it is a re-run footgun. |
| `supabase/functions/_shared/oauth.ts:50` `providerConfig()` | Dead. Returns first-party Meta/Google OAuth config from `META_APP_ID`/`GOOGLE_CLIENT_ID` etc. **No file imports it** — connections run entirely through Composio. Its `META_APP_*` / `GOOGLE_CLIENT_*` secrets are therefore unused. |
| `platform_tokens` table | Created by `2026-07-09_platform_connections.sql`, RLS on with **zero policies**, and **never written to** — `2026-07-14_composio_connections.sql` says so explicitly. |
| `email_is_invited()` RPC | Granted to `anon`, but **never called from any frontend code** (`grep` returns zero hits outside SQL). The invite-only login gate it was written for does not exist in the UI. |
| `README.md` "Netlify is retained as a non-production fallback… Its `netlify.toml`" | **There is no `netlify.toml` in the repository** and none in git history. `docs/DEPLOYMENT.md` repeats the claim with a whole section. Stale. |
| `README.md` §4 "Create users… Table Editor → profiles" | Superseded by the invite flow. |
| `ARCHITECTURE.md` §2 data-flow diagram | Shows only Coefficient → sheet → `kpi_monthly`. It predates the entire Composio/`platform_connections` generation. |
| `ARCHITECTURE.md` §5 "Netlify free: 100GB bandwidth" | Stale. |
| `docs/PLATFORM_AUDIT.md` | A **prior** audit. Several of its P0s are now fixed in code (sequential phases, `delete-account`, membership-based gating) but the document still presents them as open. Read it as history, not state. |
| `docs/INFRASTRUCTURE_AUDIT.md`, `docs/UI_MIGRATION.md`, `docs/feature-rollout.md`, `docs/phase-*.md` | Point-in-time planning docs. Useful history; not current state. |
| `app.js:1980 connStateModel()` | Branches on statuses `'syncing'` and `'approval'` that the DB `platform_connections_status_check` constraint forbids (`pending|connected|error|revoked`). Unreachable. |
| `app.js:5295` `opsData.pendingAccounts` | Loaded on every ops refresh and then **never read** — account requests were deliberately dropped from Needs Attention (commit `bdd5b54`). Dead fetch. |
| `SHOW_VIDEO_PERF = false` (`app.js:3466`) | Parked feature flag; `videoPerfCell` returns `''`. |
| `docs/coefficient-*.md`, `docs/google-reporting-setup.md`, `docs/secure-kpi-ingestion.md` | Document Generation-1 ingestion, which is still live but is being superseded by Composio. Both generations are documented as if each were the plan. |
| `migrations/2026-06-22_diagnose_demo_kpi.sql` | A one-off diagnostic script kept in the apply-order folder. |
| `bhfa-2027/` | Unrelated product in the same repo, with its own Supabase project and deploy target (Railway). It is the **only** part of the repo with tests. |
