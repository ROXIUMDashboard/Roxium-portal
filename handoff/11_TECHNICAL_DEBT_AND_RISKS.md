# 11 · Technical Debt & Risks

Cross-references bug IDs from `10_CURRENT_BUG_REGISTER.md`.

---

## 1 · Security risks

| Risk | Detail |
|---|---|
| **Two anon-callable oracles** | `email_is_invited(text)` (email-existence oracle) and `join_code_practice(text)` (join-code oracle) are granted to `anon` and reachable with the public key. Neither is used by the frontend. [R-04, R-06] |
| **Join code = permanent bearer credential** | 8 uppercase hex chars, never expires, no max uses, no app-level rate limit, grants practice membership to any authenticated caller. [R-06] |
| **Domain auto-join is a standing grant** | Everyone at a registered domain joins automatically, forever, including after the engagement ends. Public domains are blocked, private ones are not re-checked. [R-06] |
| **Revocation does not revoke authentication** | [R-05] |
| **One secret, two jobs** | `SYNC_SECRET` is both cron bearer token and OAuth-state HMAC key. [R-21] |
| **No CSP / HSTS / Permissions-Policy** | `_headers` sets only XFO, nosniff, Referrer-Policy. 394 KB of string-concatenated HTML + a session in `localStorage` = an XSS is a full account takeover. [R-34] |
| **`book-demo` is fully public** | `--no-verify-jwt`, no captcha, no rate limit beyond Supabase's; writes to `demo_requests` with the service role and sends email. Spam/abuse surface. |
| **CORS `*` on every function** | Deliberate for the static origin, but combined with `--no-verify-jwt` it means each function's internal auth check is the only boundary. |
| **Service-role key in 13 functions** | Any logic error in any one of them is a full-database compromise. `delete-account` correctly re-scopes to the caller's JWT for the delete RPCs; others do not need to. |
| **No audit log of team writes** | A `team` user can edit or delete any practice's data with no record. `sync_runs` and `video_history` are the only audit trails. |
| **Team role has no scoping** | No read-only team role, no per-account-manager restriction. |

## 2 · RLS risks

- **RLS is the *only* isolation boundary.** Any new table added without `enable row level
  security` is immediately world-readable with the shipped anon key.
- **`is_member_of()` runs per row** on every client read. The supporting index arrived late
  (`2026-07-14_phase2_indexes.sql`); if that migration was never applied, every client page
  load sequentially scans `memberships`. **Needs verification against the live DB.**
- **`notifications` UPDATE is broad** — `using (is_member_of(practice_id))` with no column
  restriction, so a member could in principle write any column of any notification for
  their practice, not just `seen`.
- **Storage has no DELETE/UPDATE policy** [R-19] — files are immutable and immortal.
- **SECURITY DEFINER surface is large** (~35 functions). Every one sets
  `search_path = public`, which is correct; each still needs its own guard, and
  `join_practice_by_code()` deliberately has none beyond knowing the code.
- **`protect_finalized_kpi()` returns OLD instead of raising**, so a write to a finalized
  month silently no-ops. Debugging "my correction didn't save" will be confusing.

## 3 · Auth inconsistencies

- Code says invite-only (`shouldCreateUser:false`); migrations, comments and the whole
  approvals UI say self-service-with-approval. [R-03]
- Three parallel membership-granting paths (invite / domain / join code) with different
  trust levels and no single place that says which is enabled. [R-06]
- `profiles.practice_id` vs `memberships` — declared resolved, still written by five
  different code paths.
- `approve_profile_on_membership` is INSERT-only; `invite-user` compensates manually. A
  future third path that upserts a membership will silently skip approval.
- `verifyOtp` tries `type:'email'` then `type:'invite'` — a reasonable hack that hides
  which flow the user is actually in.

## 4 · Stale migrations & schema debt

- `schema.sql` is a stale snapshot presented as a baseline. [R-22, R-33]
- `2026-07-07_catchup_reconcile.sql` embeds a whole schema copy; re-running it after later
  migrations would revert functions. It is safe **today** only because of lexical
  filename luck.
- Four order-sensitive `platform_connections` migrations that must be squashed.
- `2026-06-22_diagnose_demo_kpi.sql` is a diagnostic living in the apply path.
- No down-migrations anywhere; no rollback story for a bad schema change.
- 12 unused legacy columns on `kpi_monthly`. [R-42]

## 5 · Frontend / backend duplication

- **KPI aggregation exists twice**, with different null semantics: `mergeKpiByPeriod()`
  (skips nulls) vs `aggregateCompanyKpiByMonth()` / `summarizeKpiRange()` (coerce to 0).
  That divergence *is* R-01.
- **Deliverable-completion notification logic exists twice** —
  `updateDeliverableStatus()` (`app.js:3355`) and `updateOpsDeliverable()` (`app.js:4734`)
  — with the same phase-completion check copy-pasted.
- **Four sync-status renderers** from two data models. [R-23]
- **Two date-parsing conventions** in the same file. [R-07]
- **Edge-function boilerplate**: `_shared/http.ts` exists, but `sync-coefficient`,
  `invite-user`, `asana-sync` and `asana-webhook` still inline their own `cors`, `json`,
  `UUID_RE` and `authorize`. The shared file's own header admits it.
- **Three `authorize()` implementations** with different acceptance rules.

## 6 · localStorage fallbacks (and what breaks when they diverge)

| Key | Purpose | Risk |
|---|---|---|
| `roxium_ops_attention_v2` (+ `_v1` read fallback) | dismiss/snooze/pin/order | local can overwrite server on first load [R-25]; not cleared on signout |
| `roxium_kpi_cards_<pid>` | KPI card prefs | read **before** the server row, so a stale local layout flashes in |
| `roxium_updates_seen_<pid>` | the Updates "new" badge | per-browser only; a new device shows a week of "new" [R-16] |
| `roxium_join` | pending join code | persists indefinitely; a code captured months ago is replayed on the next successful sign-in |
| `lastAdminTab`, sidebar collapse, `roxium_cache_bust<sha>` | UI prefs | benign |
| `INVEST_METRICS_KEY` (sessionStorage) | chart series toggles | benign |
| **Supabase session** | the JWT itself | `localStorage`, so any XSS is game over [R-34] |

## 7 · Race conditions & ordering hazards

- `boot()` is deduped by a `booted` flag against the double-fire of `getSession()` +
  `onAuthStateChange` — handled, but fragile: the flag is reset in the `catch`, so a
  transient failure can re-enter `afterLogin()`.
- `loadOperationsData()` has an `opsLoadPromise` guard; `loadAll()` has **none** — rapid
  practice switching can interleave two loads and land the wrong practice's data in
  `data`.
- Optimistic notification dismissal (`app.js:728-738`) mutates local state then fires a
  write inside `try{}catch(_){}` — a failed write leaves the UI lying until reload.
- `saveOpsAttentionState()` debounces 450 ms; navigating away inside that window loses the
  change server-side while `localStorage` keeps it → permanent divergence.
- `autoAdvanceMilestones()` awaits inside a loop and is called after every status change;
  two team members editing concurrently can interleave milestone writes.
- `oauth-callback` fires the first sync with `EdgeRuntime.waitUntil` best-effort; if it is
  dropped the connection sits at "first import queued" until the next cron tick.
- `sync-platforms` reads `max(kpi_daily.day)` then walks forward — two concurrent runs
  (cron + a client "Refresh now") will duplicate work; the upserts make it safe, not
  efficient.

## 8 · Brittle date logic (beyond R-07/R-08)

- `monthWindows()` and `monthDayCalendar()` mix `Date.UTC` and local `new Date(y, m, 0)`.
- `buildDailyChartSeries()` compares a UTC-derived day number to `today.getDate()` (local).
- `notif_stats()` guards only *future* periods, not absurd past ones.
- `snoozeUntilTomorrow()` uses local midnight, `getOpsAlertUiState()` compares to
  `Date.now()` — correct, but the only place that does it right by accident of symmetry.
- `accessAgeDays()` correctly appends `T12:00:00`; nothing else in the file does.
- `relTime()` and `connAgo()` round, so "1 hour ago" can mean 31 minutes.

## 9 · Stale integrations

- Gen-1 Coefficient/Sheets pipeline is fully live and fully documented alongside Gen-2 as
  if each were the plan. No deprecation path is written down. [R-23]
- `providerConfig()` + `platform_tokens` + `META_APP_*` / `GOOGLE_CLIENT_*` secrets are a
  complete dead OAuth design. [R-29]
- Asana: two functions, a schema column, a unique index and documentation — **no schedule,
  no UI, no webhook registration**. It is scaffolding presented as a feature.
- Nine catalog platforms that connect but import nothing. [R-13]
- The `.xlsx` workbook importer is referenced in `README.md` and `XL_MAP` survives, but the
  UI and the `xlsx` library are gone.

## 10 · Deployment risks

See `08_…` §5. Summary: migrations are the only un-automated link in the chain [R-22];
docs still point at a deleted Netlify config [R-33]; a Cloudflare dashboard Git
integration cannot be ruled out from the repo; there is no staging environment and
`config.js` is hard-coded to one Supabase project; partial function deploys are possible
by design.

## 11 · Error handling weaknesses

- **Fail-soft `try{}catch(_){}` with an empty body appears ~15 times.** It is the right
  instinct (a missing migration must not blank the page) and the wrong implementation:
  a real error is indistinguishable from a missing feature, and nothing is logged.
- **Email failures are never recorded.** [R-36]
- **`notifyClient()` swallows everything** — `catch(e){ /* non-blocking */ }`.
- **`sync-platforms` classifies errors by regex on the message string** — a wording change
  upstream silently reclassifies a dead connection as healthy.
- **No error reporting service.** The only diagnostics are `console.error` in `safe()` and
  the per-source `last_error` columns. A client-side exception in production is invisible.
- **`safe(label, fn)` is applied in `render()` but not in `loadAll()`** — a failed initial
  load shows an empty portal.

## 12 · Test coverage gaps

**There are zero tests for the portal.** See `12_TESTING_MAP.md`. No unit, integration,
E2E, RLS, migration or smoke tests; no linter; no type checking; no CI gate of any kind
before a production deploy. The `bhfa-2027/` sibling app has vitest + Playwright, which
shows the team knows how — the portal simply predates it.

## 13 · What could cause a client-facing failure tomorrow

Ranked by (likelihood × blast radius):

1. **A hand-applied migration is missed or applied out of order** → a feature silently
   disappears behind a fail-soft catch, or a function 500s. [R-22]
2. **Reach/aggregate zeros are read as real performance** in a client meeting. [R-01, R-02]
3. **Composio quota or auth change** stops all marketing data with no notification to
   anyone and no run log to diagnose it. [R-14, R-27]
4. **A removed user signs in** and the team believes access was revoked. [R-05]
5. **Invite emails silently not sending** because a secret is unset — the account works,
   the client never hears about it. [R-09-adjacent, see `09_…`]
6. **A join code leaks** and an unintended person joins a practice. [R-06]
7. **Off-by-one deadlines** cause a false "overdue" escalation to a client. [R-07, R-08]
8. **An XSS in string-built HTML** with no CSP. [R-34]
