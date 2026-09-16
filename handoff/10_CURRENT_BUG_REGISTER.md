# 10 · Current Bug Register

**Nothing in this pass was fixed.** Severity: **P0** = data-integrity, security, or a
client-visible falsehood · **P1** = important correctness/UX · **P2** = polish/debt ·
**P3** = nice to have.

Confidence: **Confirmed** = proven by reading the code · **High** = the code clearly
produces it but I could not run it · **Medium** = depends on runtime/external state ·
**Needs verification** = requires dashboard or live-DB access.

---

## P0

### R-01 · Reach reads a confident `0` instead of "no data" in every aggregate
- **Area** Marketing / KPI
- **User impact** The Operations dashboard and every All-Months view tell the team (and
  any client on an all-months view) that reach is **zero**, which is a false statement
  about client performance rather than an honest "we don't have this".
- **Observed** "Total reach 0" while Meta reach exists for some practices and Google-only
  practices have none.
- **Root cause** `aggregateCompanyKpiByMonth()` (`app.js:4668-4682`) and
  `summarizeKpiRange()` (`app.js:1031-1040`) seed totals at `0` and add `N(r,k) || 0`,
  coercing `null` → `0`. The per-client cards do it correctly via `fmtNum(null) === '—'`
  (`app.js:1261`). Compounded by R-02.
- **Files** `app.js:4668`, `app.js:1031`, `app.js:5195`
- **DB** `kpi_monthly.reach`, `kpi_daily.reach`
- **Confidence** Confirmed
- **Fix direction** Track "has any non-null contribution" per metric and render `—` when
  there is none; keep `0` only when a real zero was reported.
- **Dependencies** none · **Safe to fix independently** ✅

### R-02 · Google Ads never produces Reach (and the pipeline claims it synced fine)
- **Area** Marketing / Google Ads
- **User impact** Any practice whose only connection is Google Ads shows no reach
  forever, with no indication that reach is not a metric this source provides.
- **Observed** `google_ads` rows have `reach = null`; combined with R-01 this renders `0`.
- **Root cause** The GAQL query selects only `segments.date, metrics.cost_micros,
  metrics.impressions, metrics.clicks`; the row builders construct objects with no
  `reach` key at all.
- **Files** `supabase/functions/sync-platforms/index.ts:213-215, 275-286`
- **DB** `kpi_monthly`/`kpi_daily` `source='google_ads'`
- **Confidence** Confirmed
- **Fix direction** Product decision first (see `15_…` Q3): either mark reach as
  "Meta only" in the UI per source, or add a Google reach-capable report. Do **not**
  fabricate a value.
- **Dependencies** R-01 · **Safe to fix independently** ✅ (UI side)

### R-03 · Self-service signup is unreachable, so Account Approvals can never populate
- **Area** Auth
- **User impact** The "request access → team approves" product promise does not work.
  The Account-Approvals queue in Team Controls is permanently empty; a prospective user
  who types their email at `/portal/` is told *"No account is set up for that email
  yet — please contact ROXIUM staff."*
- **Root cause** `signInWithOtp({… shouldCreateUser:false})` (`app.js:613`) directly
  contradicts the comment three lines above it and the entire design of
  `migrations/2026-07-09_account_approvals.sql`. `ensure_my_profile()` can therefore
  only ever run for a user created elsewhere.
- **Files** `app.js:594-625`, `app.js:787`, `migrations/2026-07-09_account_approvals.sql`
- **DB** `profiles.approval_status`, `get_pending_accounts()`
- **Confidence** Confirmed
- **Fix direction** Decide the policy (Q1 in `15_…`), then make the code and the Supabase
  dashboard signup setting agree. If self-service is wanted, allow user creation **and**
  gate the send on a real allowlist (R-04).
- **Dependencies** R-04, R-05 · **Safe to fix independently** ❌ — needs the policy decision

### R-04 · Any address already in `auth.users` can always request a sign-in link
- **Area** Auth / security
- **User impact** A removed, rejected or long-departed user keeps receiving valid sign-in
  emails and keeps authenticating (they land in the waiting room, but the session is
  real). This is the reported *"invalid/non-approved users still trigger login emails"*.
- **Root cause** There is **no allowlist check on the send path**. `email_is_invited()`
  exists, is granted to `anon`, and is **never called** (zero references outside SQL).
  Worse, its own definition returns `true` for anyone already in `auth.users`
  (`migrations/2026-07-07_domain_auto_join.sql`), so even if it were wired in it would
  not block a revoked user.
- **Files** `app.js:610-625`; `migrations/2026-07-07_domain_auto_join.sql`
- **DB** `email_is_invited(text)`, `practice_invites`, `memberships`
- **Confidence** Confirmed
- **Fix direction** Redefine `email_is_invited` as "has a live invite / membership /
  registered domain", call it before `signInWithOtp`, and enforce it server-side in a
  `before_user_created` / pre-token auth hook so the public anon key cannot bypass it.
- **Dependencies** R-03 · **Safe to fix independently** ⚠ — will lock out anyone whose
  access was never modelled as a membership; audit first

### R-05 · Removing a user never removes their ability to authenticate
- **Area** Auth / lifecycle
- **User impact** "Remove member" and "Reject account" revoke **data**, not **login**.
  The auth user persists, can keep requesting links, and appears in `auth.users` forever.
  This is the reported *"deleted users may still be able to authenticate"*.
- **Root cause** `remove_practice_member()` / `reject_account()` only touch
  `memberships` / `profiles` (an RPC cannot delete an auth user). The Edge Function that
  **can** — `delete-account` with `{user_id}` — and the `delete_client()` RPC both exist
  and are **never invoked from the UI**: `grep -n "delete-account" app.js` returns exactly
  one hit, the practice-level call at `app.js:6350`. The removal confirm dialog even
  points the user at a *"Delete selected client"* action that does not exist
  (`app.js:5458`).
- **Files** `app.js:5456-5466`, `app.js:6350`; `supabase/functions/delete-account/index.ts`;
  `migrations/2026-07-14_lifecycle_fixes.sql`
- **DB** `memberships`, `profiles`, `auth.users`
- **Confidence** Confirmed
- **Fix direction** Add a team-only "Remove access entirely" action wired to
  `delete-account {user_id}`; keep "Remove from practice" as the softer option.
- **Dependencies** none · **Safe to fix independently** ✅

### R-06 · Join codes and domain auto-join bypass invite-only entirely
- **Area** Auth / security
- **User impact** Anyone holding an 8-character code (`?join=A1B2C3D4`) who can
  authenticate becomes a member of that practice with no approval. `join_code_practice()`
  is granted to **anon**, making the code enumerable against the public REST endpoint.
  Domain auto-join grants membership to **every** address at a registered domain.
- **Root cause** Deliberate features (`2026-07-07_practice_join_codes.sql`,
  `2026-07-07_domain_auto_join.sql`) that predate the invite-first decision. Codes never
  expire, are not usage-limited, and have no rate limiting in application code.
- **Files** `app.js:593`, `app.js:777-781`; both migrations
- **DB** `practices.join_code`, `practice_domains`, `join_practice_by_code()`
- **Confidence** Confirmed
- **Fix direction** Product decision (Q2). At minimum: revoke `join_code_practice` from
  `anon`, add expiry + max-uses, and surface "this practice has a live join link" in
  Team Controls so it is never forgotten.
- **Dependencies** R-03 · **Safe to fix independently** ⚠

### R-07 · Deliverable and video day-maths parse dates as UTC while the UI renders them as local
- **Area** Deliverables / Videos / Ops
- **User impact** For part of every day (all afternoon/evening in US Pacific) every
  due-date countdown is off by one, and items can flip to "overdue" a day early. The
  numbers in the ops table disagree with the dates in the same row.
- **Root cause** `new Date('YYYY-MM-DD')` is **UTC midnight** per spec. Used in
  `delivAttention` (`app.js:2939`), `buildOpsAlerts` (`app.js:4497`, `:4514`),
  `renderOpsClientDetail` (`app.js:5005`, `:5022`), the exec cards (`app.js:5117`) and
  `computeClientHealth` (`app.js:4461`). **Display** uses `fmtDate()` which appends
  `'T00:00:00'` → local. **Milestones** use `+'T12:00:00'` → local noon, so milestones are
  right and deliverables/videos are wrong.
- **Files** as listed · **DB** `deliverables.due`, `video_pipeline.planned_shoot_date`
- **Confidence** Confirmed
- **Fix direction** One shared `parseDueDate()` (local noon) + `daysUntil()` helper;
  replace all six call sites.
- **Dependencies** none · **Safe to fix independently** ✅

---

## P1

### R-08 · "Due today" is labelled "due tomorrow" and loses its day count
- **Area** Ops / Needs Attention
- **User impact** The reported *"everything says 1 day"*. Items due today and tomorrow are
  indistinguishable, and neither shows a number.
- **Root cause** `daysLeft <= 1 ? 'Deliverable due tomorrow' : …` and
  `daysLeft <= 1 ? '' : \` · ${daysLeft} days left\`` (`app.js:4499-4502`, `:4515-4518`).
  `Math.ceil` of a small negative yields `-0`, which fails the `< 0` test, so a
  just-passed deadline also lands here.
- **Files** `app.js:4496-4520` · **Confidence** Confirmed
- **Fix direction** Explicit buckets: `n days overdue` / `due today` / `due tomorrow` /
  `n days left`. Combine with R-07.
- **Safe to fix independently** ✅

### R-09 · Videos have no due-date editor in the Video tab
- **Area** Video pipeline
- **User impact** `planned_shoot_date` drives every video due/overdue alert, but the video
  detail modal cannot set it — only the Operations → client-detail table can
  (`app.js:5030`). Seeded videos have it `null`, so **by default no video is ever flagged
  overdue by due date**; only the flat 3/7-day time-in-stage SLA fires. This is the
  reported "video due dates don't match deliverable behaviour".
- **Root cause** `openVideoDetail()` (`app.js:3653-3823`) exposes name, description,
  assignee, `stage_since`, blocked reason, URL, comments and history — no shoot date.
- **Files** `app.js:3653`, `app.js:4512`, `app.js:5021`
- **Confidence** Confirmed · **Safe to fix independently** ✅

### R-10 · Editing a deliverable's status can reset its phase's overdue clock
- **Area** Phases
- **User impact** A red phase can silently go green because someone touched one item.
- **Root cause** `computePracticePhaseState()` **overwrites** `phaseStart` with
  `min(status_since)` of non-`promised` items instead of taking the earlier of that and
  the predecessor-completion anchor (`app.js:4408-4414`).
- **Secondary** the anchor only advances on `delivered_at`, so a phase completed without
  timestamps leaves the next phase's clock anchored too early.
- **Files** `app.js:4380-4432` · **Confidence** Confirmed (High that it is user-visible)
- **Fix direction** `phaseStart = min(prevCompleteAt ?? fallback, …)`, never a bare
  replacement.
- **Safe to fix independently** ✅

### R-11 · No account/property picker when one identity exposes several accounts
- **Area** Marketing connections
- **User impact** A surgeon with several Meta ad accounts or Google customers gets
  whichever one the code found first, with no way to change it and no visibility into
  what was picked.
- **Root cause** `sync-platforms` discovers and persists the full list into
  `platform_connections.accounts` (`index.ts:129-142`, `:246-249`), and its own comment
  says "the Connections UI account picker renders platform_connections.accounts" — but
  **no such UI exists**, and `loadAll()` / `reloadConnections()` do not even `select` the
  `accounts` or `external_account_id` columns (`app.js:877`, `:2038`).
- **Files** `app.js:2072-2200`, `sync-platforms/index.ts:124-150, 230-260`
- **DB** `platform_connections.accounts`, `.external_account_id`
- **Confidence** Confirmed · **Safe to fix independently** ✅ (data is already there)

### R-12 · No way to cancel a pending/stuck connection
- **Area** Marketing connections
- **User impact** A half-finished OAuth leaves `status='pending'` forever. The card offers
  only "Reconnect"; the platform is also removed from the "Add data source" catalog
  (`activeKeys` excludes only `revoked`, `app.js:2121`), so the practice cannot start over
  cleanly. `disconnect_platform` is only offered when `status='connected'`.
- **Files** `app.js:2085-2090`, `app.js:2121`
- **Confidence** Confirmed · **Safe to fix independently** ✅

### R-13 · Nine of twelve catalog platforms connect but import nothing, and report "synced"
- **Area** Marketing connections
- **User impact** A client connects TikTok / GA / YouTube / Microsoft Ads and the UI says
  *"Connected · Last sync: just now"* while zero data arrives.
- **Root cause** `PLATFORM_CATALOG` lists 12 platforms (`app.js:1920`); `sync-platforms`
  handles only `meta` and `google`, and for everything else returns
  `{skipped:"ingestion for this platform is handled by ROXIUM"}` **and still stamps
  `last_synced_at = now()`** (`index.ts:318-323`).
- **Confidence** Confirmed
- **Fix direction** Either hide un-ingested platforms, or give them a distinct
  "Connected — ROXIUM imports this manually" state that does not stamp a sync time.
- **Safe to fix independently** ✅

### R-14 · Failed syncs and connection errors produce no notification
- **Area** Notifications
- **User impact** A broken data connection is only visible to someone who happens to open
  the Operations dashboard or the client's Sync Health tab. Nobody is told.
- **Root cause** Neither sync function writes to `notifications`; the ops queue is
  computed at render time and stored nowhere.
- **Files** `sync-platforms/index.ts:325-345`, `sync-coefficient/index.ts:790-812`,
  `app.js:4480`
- **Confidence** Confirmed · **Safe to fix independently** ✅

### R-15 · Pending account approvals are fetched and thrown away
- **Area** Ops
- **User impact** No alert anywhere when an account is waiting. (Moot until R-03, but it
  is also a dead round-trip on every ops refresh.)
- **Root cause** `opsData.pendingAccounts` is populated at `app.js:5292-5296` and never
  read; the card was removed in commit `bdd5b54`.
- **Confidence** Confirmed · **Safe to fix independently** ✅

### R-16 · Team-posted client updates create no attention signal for the client
- **Area** Notifications / Updates
- **User impact** A new client-facing update only bumps a **localStorage** counter on the
  sidebar. On a different device or a cleared browser it is invisible; no notification row,
  no banner, no email.
- **Root cause** `postUpdateFromFeed()` (`app.js:2392`) inserts into `activity` only.
  `renderUpdatesBadge()` (`app.js:2407`) is purely `localStorage`-based.
- **Confidence** Confirmed · **Safe to fix independently** ✅

### R-17 · Deliverables are not clickable for clients (no link field exists)
- **Area** Client UX / schema
- **User impact** A delivered asset cannot be opened from the portal.
- **Root cause** `deliverables` has **no `link_url` column** (only `milestones` does), and
  `ppPhaseCard()` renders name + status only (`app.js:2984-3007`).
- **Confidence** Confirmed
- **Fix direction** Migration adding `deliverables.link_url`, an editor field, and a
  client-side anchor. **Requires a migration** — not code-only.
- **Safe to fix independently** ✅ (with the migration)

### R-18 · `notifications.seen` is shared across a whole practice
- **Area** Notifications
- **User impact** One member dismissing a banner dismisses it for the surgeon too.
- **Root cause** `notifications` is keyed by `practice_id` with a single `seen` boolean;
  the `client seen` RLS policy lets any member flip it.
- **Confidence** Confirmed
- **Fix direction** A `notification_reads(user_id, notification_id)` join table, or a
  per-user notifications model. **Requires a migration.**
- **Safe to fix independently** ⚠ (schema change)

### R-19 · Uploaded deliverable files can never be deleted or replaced
- **Area** Storage / lifecycle
- **User impact** A wrong file uploaded to a client's folder is permanent; deleting a
  practice leaves its files in the bucket forever (a data-retention problem).
- **Root cause** `storage.objects` has SELECT and INSERT policies only — **no UPDATE, no
  DELETE** (`schema.sql`, STORAGE section).
- **Confidence** Confirmed · **Safe to fix independently** ✅ (policy migration)

### R-20 · `listUsers({perPage:1000})` will break invites past 1000 users
- **Area** Auth / scale
- **Root cause** `invite-user/index.ts:138-141` — single unpaginated page used to resolve
  an existing user.
- **Confidence** Confirmed · **Fix** use `getUserByEmail`/`listUsers` with a filter, or
  paginate. **Safe to fix independently** ✅

### R-21 · `SYNC_SECRET` is both the cron bearer token and the OAuth state HMAC key
- **Area** Security / infrastructure
- **User impact** Leaking it allows forging OAuth state **and** triggering arbitrary
  syncs. Rotating it breaks in-flight OAuth handshakes.
- **Files** `_shared/oauth.ts:22-46`, `sync-platforms/index.ts:62-66`,
  `sync-coefficient`, `weekly-digest`, `asana-sync`
- **Confidence** Confirmed · **Fix** split into `SYNC_SECRET` and `OAUTH_STATE_SECRET`.
- **Safe to fix independently** ✅ (coordinate the secret rollout)

---

## P2

### R-22 · Schema drift is undetectable
No migration ledger, no CI application, and ~10 fail-soft `try/catch` blocks that turn a
missing column into a silently missing feature (`app.js:875-890`, `:1676`, `:5292`,
`loadKpiPrefs`, `saveOpsAttentionState`). `schema.sql` is a stale snapshot that `README.md`
still presents as step 1. **Confirmed.**

### R-23 · Two ingestion-config models raise duplicate, contradictory alerts
`sheet_sources.access_status` and `platform_connections.status` both feed
`buildOpsAlerts()`, so one practice/channel can show "Access request pending" *and*
"Connection failed" simultaneously. **Confirmed.** `app.js:4528-4570`.

### R-24 · `render()` rebuilds every view on every call
`render()` (`app.js:2440`) re-renders all sections' `innerHTML` regardless of the active
view, and charts are destroyed and recreated rather than `.update()`d
(`destroyKpiCharts`, `app.js:965`). Noticeable on large practices; also loses scroll/focus.
**Confirmed.**

### R-25 · Ops attention state can leak between users on a shared browser
`initOpsAttentionState()` (`app.js:4318-4337`): if the server copy is empty and the local
copy is not, the **local** copy wins and is pushed to the server. `signOut()` clears no
`localStorage`. **Confirmed.**

### R-26 · An alert's identity includes its title, so escalation drops pins and snoozes
`opsAlertId()` (`app.js:4587`) concatenates `title`, so "approaching deadline" → "overdue"
is a different id. Re-surfacing on escalation is defensible; losing a pin is not.
**Confirmed.**

### R-27 · `sync-platforms` writes no run log
`sync_runs` is only written by `sync-coefficient` (`index.ts:806`). The Composio pipeline
has no history, so "when did this last actually work" is unanswerable. **Confirmed.**

### R-28 · Serial, unbounded sync work per practice
`pullMeta` makes up to 6 + 14 = 20 **serial** Composio calls per practice per run, all
practices in one invocation, with no concurrency limit and no time budget. Edge Functions
have a wall-clock limit. **Confirmed** (impact scales with client count).

### R-29 · Dead code and dead branches shipping to every client
`providerConfig()` (`_shared/oauth.ts:50`), `platform_tokens`, `email_is_invited` (unused),
`connStateModel()`'s `'syncing'`/`'approval'` branches (`app.js:1986-1988`),
`opsData.pendingAccounts`, `SHOW_VIDEO_PERF`, `XL_MAP` (importer UI removed).
**Confirmed.**

### R-30 · `pre_production` is unreachable from the UI
The stage picker writes only the canonical group values, so `pre_production` can be set by
SQL but never by a user, while `STAGES` and the notification labels still list it.
`app.js:3471-3495`. **Confirmed.**

### R-31 · Two divergent design-token sets
`index.html:27-34` redefines `--gold-soft`, `--amber`, `--radius` differently from
`styles.css:1-43`. The marketing page and portal will drift on any palette change.
**Confirmed.**

### R-32 · `autoAdvanceMilestones()` does an N+1 write loop with a fresh query each call
Called on every deliverable status change; re-queries all deliverables and issues one
`update` per changed milestone with an `await` inside the loop (`app.js:3373-3400`).
**Confirmed.**

### R-33 · Stale documentation actively misleads
`README.md` + `docs/DEPLOYMENT.md` describe a `netlify.toml` that does not exist;
`ARCHITECTURE.md`'s data-flow diagram predates Composio entirely;
`docs/PLATFORM_AUDIT.md` lists as open several P0s that are now fixed. **Confirmed.**

### R-34 · No CSP
`_headers` sets XFO/nosniff/Referrer-Policy only. With a 394 KB string-built-HTML
application and a public anon key in `localStorage`, a CSP is meaningful defence in depth.
**Confirmed.**

---

## P3

- **R-35** No completion/progress animation on delivery, despite a full motion token set.
  `styles.css:36-39`.
- **R-36** `notifications.emailed` never written — no record of what was emailed.
- **R-37** `notify-video-ready` uses an older div-based email template while the others use
  the branded table-based one.
- **R-38** The legacy top-tab nav (`.tab`, `#tabnav`) is still maintained in parallel with
  the sidebar by `syncChrome()` (`app.js:414-455`).
- **R-39** `daysIn()` floors, so anything under 24 h reads `0d`; combined with bulk seeding
  every item in a practice shows the same age.
- **R-40** `migrations/2026-06-22_diagnose_demo_kpi.sql` is a one-off diagnostic sitting in
  the apply-order folder.
- **R-41** Chart series colours (`app.js:948-953`) are hard-coded hex outside the token
  system.
- **R-42** `kpi_monthly` carries 12 legacy business columns with no writer and no reader.
