# 12 · Testing Map

---

## 1 · Current state — the portal

| Kind | Status |
|---|---|
| Unit tests | **none** |
| Integration tests | **none** |
| Browser / E2E tests | **none** |
| Database tests | **none** |
| Migration tests | **none** |
| Auth tests | **none** |
| RLS tests | **none** |
| Deployment checks | partial — see below |
| Linter | **none** |
| Type checking | **none** (plain JS, no JSDoc types, no `tsconfig`) |
| Formatter | **none** |
| CI gate before deploy | **none** — `deploy-pages.yml` goes straight from checkout to `wrangler pages deploy` |

There is no `package.json`, no lockfile and no test runner at the repository root;
`node_modules/` is empty. Verified by `find`.

### What does exist as verification

| Mechanism | What it catches |
|---|---|
| `deploy-pages.yml` "Verify Cloudflare credentials" step | missing `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`; runs `wrangler whoami` |
| `deploy-functions.yml` 3-attempt retry loop | transient esm.sh bundling failures; fails the job if a function never deploys |
| `showBuildVersion()` (`app.js:573`) | a stale cached `app.js` — forces one reload when `/version.json` disagrees with the loaded `?v=` |
| `safe(label, fn)` (`app.js:238`) | a throwing render section blanking the page (console-only) |
| Fail-soft `try/catch` around ~15 optional queries | a missing migration hard-failing the page (also hides real errors) |
| DB constraints and triggers | duplicate practices (`practices_name_lower_uq`), last-admin/last-owner deletion, finalized-month writes, KPI conflict keys |
| Manual criteria in `ARCHITECTURE.md` §4 | a written, never-automated Phase-B acceptance checklist (two practices / two accounts / client cannot insert / magic link on mobile / workbook round-trip) |
| `migrations/*.sql` VERIFY comments | several migrations end with commented-out read-only verification queries to paste manually |

### The one tested area: `bhfa-2027/`
The sibling app has `vitest` + `@testing-library/react` + Playwright:
`tests/api.test.ts`, `ordering.test.ts`, `room.test.tsx`, `schedule.test.ts`,
`security.test.ts`, `time.test.ts`, and `e2e/collaboration.spec.ts` (runs the real app
against an in-process driver with **no database credentials**, `playwright.config.ts`).
`security.test.ts` in particular asserts token entropy, hash-only storage, validation and
rate limiting. **This is the model to copy** — same repo, same team, proven to work.

---

## 2 · Missing high-value tests

Ordered by (risk reduced ÷ effort). The top block is worth doing before any of the
implementation passes in `14_…`.

### Tier 1 — pure functions, no infrastructure needed (a Node test runner + `import` is enough)

| Test | Guards | Bug IDs |
|---|---|---|
| `daysUntil()` / due-date parsing across time zones (TZ=UTC, America/Los_Angeles, Australia/Sydney) at 00:01, 12:00 and 23:59 | the UTC-vs-local off-by-one and every label bucket | R-07, R-08 |
| `computePracticePhaseState()` table tests: empty phase, all-delivered-with-null-`delivered_at`, first-incomplete, later phases stay `upcoming`, warn/red thresholds per phase number, "touching one item must not reset the clock" | the entire sequential phase machine | R-10 |
| `mergeKpiByPeriod()` / `aggregateCompanyKpiByMonth()` / `summarizeKpiRange()` null semantics — assert `null` in ⇒ `—` out, `0` in ⇒ `0` out | Reach reading as a false zero | R-01, R-02 |
| `normalizeKpiRows()` / `sourceKey()` — `meta`/`coefficient`/`null` all fold to `marketing`, newest `updated_at` wins | double counting | — |
| `parsePhaseNum()` / `comparePhaseNames()` — `Phase 6–7`, renamed phases, `phase_order` ties | silent loss of deadline rules | R-42-adjacent |
| `classifyUpdate()` / `updToneOf()` / `buildEngagementTimeline()` bucketing | the client update feed | — |
| `buildOpsAlerts()` given a fixture practice — snapshot every alert, severity and detail string | the entire attention engine | R-08, R-23 |
| `esc()` against `<script>`, quotes, and unicode | XSS in string-built HTML | R-34 |
| `humanizeSyncError()` for each regex branch | clients seeing raw JSON | — |

*Prerequisite:* `app.js` has no exports. Either add a small `module.exports`/`export`
footer guarded for the browser, or extract these pure helpers into a `lib/` file that both
`app.js` and the tests load. **Extracting the date and KPI helpers is worth doing anyway**
— it is the same refactor the bug fixes need.

### Tier 2 — database / RLS (Supabase CLI local project, or a disposable branch)

| Test | Guards |
|---|---|
| **RLS isolation matrix** — two practices × {team, owner, member, no-membership, anon} × every table × {select, insert, update, delete}. Assert a client can read only their practice and can write **nothing** | the single boundary the whole product rests on |
| Removing a membership immediately zeroes every practice read for that user | R-05 |
| `reject_account()` / `remove_practice_member()` actually delete memberships | R-05 |
| Last-admin and last-owner guards raise, including via direct table writes | lockout |
| `delete_practice()` — multi-practice client detached not deleted; returns the right `deleted_user_ids` | orphaned accounts |
| `claim_invites_for_user()` precedence: explicit invite beats domain; join code only when neither matched | R-06 |
| `join_practice_by_code()` with a bad/rotated/cleared code | R-06 |
| Finalized-month protection: an update to a finalized `kpi_monthly` row is a no-op | silent data loss |
| Trigger coverage: `notify_video_stage` dedupe, `stamp_milestone_completion`, `touch_deliv_status`, `approve_profile_on_membership` (including the conflict-update gap) | notification correctness |
| **Migration replay** — run `schema.sql` + every migration in filename order on a clean DB, then diff against the live schema | R-22 |

### Tier 3 — Edge Functions (Deno test, mocked fetch)

| Test | Guards |
|---|---|
| `signState`/`verifyState` — tamper, truncate, wrong secret, expiry | OAuth state forgery, R-21 |
| `oauth-callback` rejects ownership mismatch, non-ACTIVE status, missing state | cross-tenant connection hijack |
| `invite-user` authorization: non-team non-owner → 403; existing user path; `emailed:false` when Resend is absent | R-20, invite reliability |
| `sync-platforms` `authorize()` matrix: `x-sync-key`, team JWT, member JWT scoped to own practice, anonymous | unauthorized sync triggering |
| `rows()` response-shape helper against real recorded Composio payloads | R-02, the reach-shape uncertainty |
| Error classification: which messages flip a connection to `error` vs leave it `connected` | R-14 |
| `sync-coefficient` `detectShape()` / `parseGrid()` / `COLUMN_ALIASES` against fixture CSVs (wide, long, daily, monthly, messy headers) | silent KPI corruption |

### Tier 4 — E2E (Playwright, mirroring `bhfa-2027/`)

| Journey |
|---|
| Team invites a client → client signs in with the typed OTP → sees only their practice |
| A second practice's client cannot reach the first practice's data by URL manipulation |
| Team marks a deliverable delivered → client sees it in Updates and in phase progress |
| Team blocks a video → client sees "Needs your input" in Overview → team unblocks |
| Practice owner connects a platform (Composio stubbed) → status goes pending → connected → setup prompts disappear |
| Team removes a member → that member is sent to the waiting room on next sign-in |
| Ops: dismiss / snooze / pin an alert → reload → state persists |

### Tier 5 — deployment smoke checks (cheap, high value, add to `deploy-pages.yml`)

- After deploy, `GET /version.json` and assert `sha === $GITHUB_SHA[0:7]`.
- `GET /portal/` returns 200 and contains the substituted sha, **not** the literal
  `BUILD_SHA`.
- `GET /privacy` and `/terms` return their own pages, not the portal (the `_redirects`
  ordering is fragile and has broken before).
- `GET /portal.html` → 301 → `/portal/` (the Safari redirect-loop regression guard).
- A `HEAD` on each Edge Function's URL returns a non-5xx, confirming deployment.
- A pre-deploy syntax gate: `node --check app.js` costs nothing and would catch the single
  worst failure mode of a 6,931-line unbundled file.

---

## 3 · Recommended minimum bar before any behaviour change ships

1. `node --check app.js` in CI. *(minutes)*
2. Extract the date + KPI pure helpers and cover them with Tier-1 tests. *(hours, and it
   is the same refactor the P0 fixes need anyway)*
3. The RLS isolation matrix. *(a day, and it is the only test that protects the product's
   core promise)*
4. The five deployment smoke checks. *(hours)*

Everything else can follow the implementation passes in `14_…`.
