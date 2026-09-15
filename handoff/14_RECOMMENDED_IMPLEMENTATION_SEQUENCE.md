# 14 · Recommended Implementation Sequence

**No code was written in this pass.** This is a dependency-ordered plan, not a schedule.

Ordering principle: **make the ground safe before building on it.** Two things block
almost everything else — (a) nobody can prove which migrations are applied, and (b) the
auth policy in the code contradicts the auth policy in the design. Fix observability and
truth first, then correctness, then client-risk prevention, then integrations, then polish.

Each pass states whether it should be **one** Claude Code task or **split**. The rule
used: one task per coherent, independently-reviewable, independently-revertible change.
A task that touches both a migration and the frontend is fine; a task that touches auth
*and* KPIs is not.

---

## Pass 0 · Ground truth and guardrails
**Objective** Be able to know what is deployed, what is applied, and whether a change
broke something — before changing anything.

**Why now** Every later pass is unverifiable without it. Schema drift (R-22) is the single
most likely cause of a production incident, and nothing currently detects it.

**Dependencies** none.

**Work**
1. Adopt a migration runner: move `migrations/` under the Supabase CLI (or add a
   `schema_migrations` ledger + apply step) and run it in CI **before** the function
   deploy. Reconcile the live DB against the repo first and record the result.
2. Regenerate `schema.sql` from the live database (`supabase db dump --schema public`) and
   squash the four `platform_connections` migrations. Delete or clearly quarantine
   `2026-06-22_diagnose_demo_kpi.sql` and `2026-07-07_catchup_reconcile.sql`.
3. Add `node --check app.js` to CI and the five deployment smoke checks from `12_…` §2
   Tier 5.
4. Extract the pure date + KPI helpers out of `app.js` into a loadable module and add the
   Tier-1 unit tests for them (this is a **prerequisite refactor** for Passes 2 and 3, not
   optional polish).
5. Fix the stale docs that would cause a wrong action: the Netlify sections in `README.md`
   and `docs/DEPLOYMENT.md`, and the `ARCHITECTURE.md` data-flow diagram (R-33).

**Files/domains** `migrations/`, `schema.sql`, `.github/workflows/`, a new `lib/` module,
`README.md`, `docs/`.
**Migration risk** Medium — reconciling a drifted live DB is the risky part; do it
read-only first and produce a diff before applying anything.
**Regression risk** Low (the code change is an extraction with tests).
**Tests** Tier 1 unit tests; migration-replay test; smoke checks.
**Task shape** **Split into 3:** (0a) migration runner + baseline regeneration,
(0b) CI gates + smoke checks, (0c) helper extraction + unit tests.

---

## Pass 1 · Auth correctness and access revocation
**Objective** Make who-can-sign-in and who-can-see-what match a single stated policy, and
make revocation real.

**Why now** Security and client-confidentiality correctness outrank everything else, and
this pass answers the question ("who is allowed in?") that the invite, approval and
onboarding UX all depend on.

**Dependencies** Pass 0 (migration runner). **Blocked on product decisions Q1 and Q2 in
`15_…`** — do not start until they are answered.

**Work**
1. Settle the signup policy in code **and** in the Supabase dashboard so they agree
   (R-03).
2. Redefine `email_is_invited()` to mean *live invite / live membership / registered
   domain* — remove the `or exists in auth.users` clause — and call it before
   `signInWithOtp`. Enforce it server-side too (a `before_user_created` auth hook) so the
   public anon key cannot bypass the browser check (R-04).
3. Add a team-only **"Remove access entirely"** action wired to the existing
   `delete-account {user_id}` path; keep "Remove from practice" as the softer option.
   Fix the confirm copy that references a non-existent action (R-05).
4. Act on Q2: keep, restrict or remove join codes and domain auto-join. At minimum revoke
   `join_code_practice` from `anon` and add expiry/max-uses; surface "this practice has a
   live join link" in Team Controls (R-06).
5. Paginate or replace `listUsers({perPage:1000})` (R-20).
6. Split `SYNC_SECRET` into `SYNC_SECRET` + `OAUTH_STATE_SECRET` (R-21).
7. Clear portal `localStorage` on sign-out (R-25).

**Files/domains** `app.js` login + roster sections, `invite-user`, `delete-account`,
`_shared/oauth.ts`, new migration for `email_is_invited` + join-code expiry, Supabase
dashboard.
**Migration risk** Low-medium (function replacements, one column for code expiry).
**Regression risk** **High — this pass can lock people out.** Before shipping step 2, run
a read-only audit: *which current users would fail the new `email_is_invited`?* Anyone
whose access was never modelled as a membership must be repaired first.
**Tests** RLS isolation matrix (Tier 2); `claim_invites_for_user` precedence; revocation
tests; `invite-user` authorization tests.
**Task shape** **Split into 3:** (1a) signup policy + allowlist gate, (1b) revocation +
"remove access entirely", (1c) join-code/domain hardening + secret split.

---

## Pass 2 · Data correctness — dates, phases, and honest metrics
**Objective** Stop the portal from stating things that are not true: false zeros, false
overdue, false "due tomorrow".

**Why now** These are the findings most likely to be seen by a client or acted on in a
morning meeting. They are also self-contained and, after Pass 0c, testable.

**Dependencies** Pass 0c (extracted helpers + tests).

**Work**
1. One `parseDueDate()` (local noon) + `daysUntil()`; replace all six call sites (R-07).
2. Explicit day-label buckets: `n days overdue` / `due today` / `due tomorrow` /
   `n days left` (R-08).
3. `phaseStart` must take the **earlier** of the predecessor anchor and the first active
   item, never a bare replacement; advance the anchor on completion even when
   `delivered_at` is null (R-10).
4. Null-safe aggregates: `aggregateCompanyKpiByMonth()` and `summarizeKpiRange()` must
   distinguish "no data" from "zero" and render `—` (R-01).
5. Label reach as source-dependent in the UI so a Google-only practice is told reach is
   not available rather than shown a number (R-02, UI half only).

**Files/domains** the extracted helper module, `app.js` (ops alerts, ops client detail,
exec cards, client overview, phase engine).
**Migration risk** None.
**Regression risk** Medium — these functions feed the whole attention queue; snapshot the
alert list before and after on a real data fixture.
**Tests** Tier-1 date and phase table tests (multiple time zones), aggregate null
semantics, `buildOpsAlerts` snapshot.
**Task shape** **One task** — it is a single coherent "make the arithmetic honest" change
and the pieces share the same helpers and the same tests.

---

## Pass 3 · Client-risk prevention: notifications that fire on the things that matter
**Objective** Deliver the stated product objective — *detect and resolve broken promises
before the client complains*.

**Why now** Pass 2 makes the signals trustworthy; this pass makes sure someone is told.

**Dependencies** Pass 2 (otherwise you would notify on wrong numbers).

**Work**
1. Emit notifications for the currently-silent events: failed/stale sync, connection
   error, overdue deliverable/video/milestone, new account awaiting approval, new
   client-facing update (R-14, R-15, R-16). Decide per event whether it is client-facing
   or team-facing — **Q6**.
2. Per-user read state: a `notification_reads` join table so one member dismissing does
   not dismiss for the surgeon (R-18). **Migration.**
3. Add the subtle pulse to the client bell when attention exists, reusing the existing
   `ops-tile-pulse` vocabulary; keep the "disappears entirely when empty" behaviour that
   already works (`07_…` §6).
4. Reinstate the account-approvals card in Needs Attention (the data is already fetched).
5. Record email outcomes — write `notifications.emailed`, and log send failures somewhere
   queryable (R-36).

**Files/domains** new migration, DB triggers or an outbox, `app.js` notification
rendering, `sync-platforms` / `sync-coefficient` error paths.
**Migration risk** Medium (a new table + backfill of read state).
**Regression risk** Medium — notification volume can become noise fast. Ship behind a
per-practice or per-event toggle and watch the first week.
**Tests** Tier-2 trigger tests; a "no duplicate notification" test; Tier-4 E2E for the
client-visible path.
**Task shape** **Split into 2:** (3a) event coverage + emission, (3b) per-user read state
+ indicator behaviour.

---

## Pass 4 · Operational visibility
**Objective** Make the Operations dashboard the single morning-meeting surface, and make
sync failures diagnosable.

**Why now** It builds directly on Passes 2 and 3, and it is what the team uses daily.

**Dependencies** Passes 2, 3.

**Work**
1. `sync-platforms` writes `sync_runs` rows so "when did this last actually work" is
   answerable (R-27).
2. Reconcile the two sync-status models so a channel raises **one** alert, not two
   (R-23). This is a design decision as much as a code change — see Q5.
3. Bound sync concurrency and add a time budget; the current 20 serial calls per practice
   per run will hit the function wall-clock limit as the roster grows (R-28).
4. A real diagnostic panel for a failed connection: what failed, when, the last few runs,
   and the one action that fixes it.
5. Consider a distinct "ROXIUM imports this manually" connection state so the nine
   non-ingesting platforms stop claiming they synced (R-13).

**Files/domains** `sync-platforms`, `sync-coefficient`, `app.js` ops + connections.
**Migration risk** Low.
**Regression risk** Low-medium.
**Tests** Tier-3 edge-function tests for `authorize()` and error classification.
**Task shape** **Split into 2:** (4a) run logging + concurrency, (4b) alert reconciliation
+ diagnostic UX.

---

## Pass 5 · Marketing connections: selection, cancellation, and the reach question
**Objective** Make self-service connection genuinely self-service.

**Why now** It depends on the diagnostic surface from Pass 4 and on the honest-metrics
work from Pass 2. It is also the pass most likely to need external configuration, so it
should not block correctness work.

**Dependencies** Pass 4. **Blocked on Q3 (reach) and Q4 (Google Ads developer token).**

**Work**
1. Account/property picker — the data is already persisted in
   `platform_connections.accounts`; select the columns, render the picker, allow a change,
   and re-sync on change (R-11).
2. Cancel a pending connection; let a pending platform be re-offered in the catalog
   (R-12).
3. Act on Q3 for reach.
4. Act on Q4: either stay fully on Composio, or revive a first-party Google Ads path using
   ROXIUM's approved developer token. **The second option is a build, not a config
   change** — `providerConfig()`, `platform_tokens` and a refresh loop would all come back
   to life, and token storage/rotation becomes ROXIUM's responsibility again.
5. Add ingestion for whichever additional platforms the business actually needs — each is
   a `pull<Provider>()` in `sync-platforms` plus a Composio auth config.
6. Manual metric entry as a fallback: the `FIELDS` form exists for the ad metrics but there
   is **no column, no form and no UI for revenue, customers or conversions**. That is new
   schema + new UI — see Q7.

**Files/domains** `sync-platforms`, `app.js` connections, possibly a migration for manual
business metrics.
**Migration risk** Medium (only if manual business metrics are added).
**Regression risk** Medium — changing the selected account changes historical attribution;
decide whether old rows are kept, re-labelled or re-pulled.
**Tests** Tier-3 response-shape tests against recorded Composio payloads.
**Task shape** **Split into 3+:** (5a) account picker + cancel, (5b) reach decision,
(5c) each new platform is its own task, (5d) manual business metrics.

---

## Pass 6 · Client UX completion
**Objective** Finish the client-facing promises without touching the visual language.

**Why now** Everything it surfaces is now correct and trustworthy.

**Dependencies** Passes 2, 3.

**Work**
1. `deliverables.link_url` + editor + a clickable client-side anchor (R-17). **Migration.**
2. Storage UPDATE/DELETE policies so files can be replaced and removed, and so practice
   deletion cleans the bucket (R-19). **Migration.**
3. `planned_shoot_date` in the video detail modal (R-09).
4. Tasteful completion/progress animation using the existing motion tokens (R-35) — the
   `prefers-reduced-motion` guard is already global.
5. Unify the two token sets so the marketing page and the portal cannot drift (R-31).
6. Whether clients should see due dates at all is **Q8** — today they deliberately do not.

**Files/domains** migration, `app.js` deliverables/video/client renderers, `styles.css`,
`index.html`.
**Migration risk** Low.
**Regression risk** Low.
**Tests** Tier-4 E2E for the client journey.
**Task shape** **Split into 2:** (6a) link + storage + video due date (the functional
gaps), (6b) motion + token unification (the visual pass).

---

## Pass 7 · Debt reduction
**Objective** Reduce the cost of every future change.

**Why now** Last, deliberately. None of it changes behaviour, and doing it earlier would
collide with every pass above.

**Dependencies** all previous passes.

**Work**
- Delete dead code: `providerConfig()`, `platform_tokens`, the unreachable
  `connStateModel` branches, `opsData.pendingAccounts` (if not reinstated in Pass 3),
  `SHOW_VIDEO_PERF`, `XL_MAP`, the legacy `.tab` navigation (R-29, R-38).
- Migrate the four remaining Edge Functions onto `_shared/http.ts` + one `authorize()`.
- Split `app.js` into modules. **Do this only after Pass 0c has proven the extraction
  pattern**, and do it mechanically, one section at a time, with no behaviour change.
- Scope `render()` to the active view and reuse chart instances (R-24).
- Drop the 12 unused `kpi_monthly` columns (R-42). **Migration, irreversible — take a dump
  first.**
- Add a CSP (R-34).
- Reconcile `profiles.practice_id` vs `memberships` to one writer.

**Migration risk** High for the column drop, low for everything else.
**Regression risk** High for the `app.js` split — it is the one item here that can break
everything, which is why it goes last and gets its own task.
**Task shape** **Split into many small tasks**, one per bullet. Never combine dead-code
removal with a refactor.

---

## Ordering summary

```
Pass 0  ground truth + guardrails          ← start here, blocks everything
Pass 1  auth correctness + revocation      ← needs Q1, Q2
Pass 2  dates, phases, honest metrics      ← needs Pass 0c
Pass 3  notifications that matter          ← needs Pass 2, Q6
Pass 4  operational visibility             ← needs Pass 3
Pass 5  connections + reach                ← needs Pass 4, Q3, Q4, Q7
Pass 6  client UX completion               ← needs Pass 2/3, Q8
Pass 7  debt reduction                     ← last
```

**Passes 0 and 2 can start immediately and in parallel** (0c is the only shared piece, and
it belongs to 0). **Pass 1 must not start before Q1 and Q2 are answered.** Passes 5 and 6
are independent of each other and can run in parallel once 4 is done.
