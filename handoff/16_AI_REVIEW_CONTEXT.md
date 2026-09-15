# 16 · AI Review Context — ROXIUM Client Portal

*A self-contained briefing for an AI acting as product/architecture reviewer and as the
middle layer between the owner and Claude Code. Audited 2026-09-14 at commit `e28a478`.
Everything here was verified by reading the code; items that depend on a dashboard or the
live database are marked **UNVERIFIED**.*

---

## 1 · What the product is

A multi-tenant B2B operating portal for **ROXIUM**, a marketing agency serving plastic
surgeons. One codebase, two audiences:

- **ROXIUM team** — an operations console across all client practices: a Needs-Attention
  queue, per-client health scores, deliverables/milestones/video editing, marketing-sync
  health, access & invites, company KPI rollups.
- **Client practices** (surgeon + staff) — a portal scoped to their own practice: an
  answer-first Overview ("what changed / what needs you / what's next"), phase progress,
  video pipeline, live marketing KPIs, an update feed, and — for practice owners —
  self-service marketing connections and teammate invites.

Two strategic objectives drive priorities: (1) clients should connect their own marketing
platforms and get a reporting workspace with no spreadsheets or API vocabulary exposed;
(2) the portal should let ROXIUM **detect and fix broken promises before the client
complains**. Deadlines, overdue states, waiting-on-client flags, notifications and the
internal attention queue are therefore product-critical, not cosmetic.

## 2 · Architecture in one screen

```
Browser ──► Cloudflare Pages (static)  /  = marketing page,  /portal/ = the app
                 index.html · portal/index.html · app.js (6,931 lines) · styles.css · config.js
   │  supabase-js with the public anon key — RLS is the only isolation boundary
   ▼
Supabase ── Postgres (~20 tables, ~35 RPCs, 8 triggers, RLS everywhere)
         ── Auth (magic link + 6-digit OTP; no passwords, no social, no MFA)
         ── Storage (private bucket `deliverables`, per-practice folders)
         ── 13 Deno Edge Functions ──► Resend (email) · Composio (Meta/Google OAuth)
                                   ──► Google Sheets API (legacy ingestion) · Asana (scaffold)

GitHub main ─► deploy-pages.yml   → prepare-pages.sh → wrangler pages deploy site
            ─► deploy-functions.yml → supabase functions deploy (all, --no-verify-jwt)
            ─► migrations/*.sql  → ✋ APPLIED BY HAND. No CI step. No ledger.
```

**No build step, no framework, no bundler, no npm dependencies, no tests, no linter, no
type checking.** `app.js` is one global scope. A second, unrelated Next.js app lives in
`bhfa-2027/` and shares nothing.

## 3 · Business rules that matter

- **Access is a `memberships` row**, never `profiles.practice_id` (which is only a
  "default practice" pointer). `afterLogin()` checks memberships directly; no membership
  ⇒ waiting-room pane.
- **Roles:** `profiles.role ∈ {team, client}`; `memberships.role ∈ {owner, member}`.
  `team` is global and unscoped — any team user can read/write every practice, with no
  audit log.
- **Clients write almost nothing.** Every practice table is `for all using (is_team())`.
  The only client-writable surfaces are `notifications.seen`, `kpi_dashboard_prefs`, and a
  few owner-scoped RPCs.
- **KPI months are immutable snapshots** keyed `(practice_id, period, source)`; a
  `finalized` month silently ignores writes (a trigger returns OLD).
- **Phases are sequential.** Exactly one phase runs a live clock — the first not fully
  delivered. Thresholds (`app.js:4352`) already match the intended spec:
  P0 7/14 d · P1 11/21 d · P2 152/182 d · P3-5 30/60 d · P6-7 none.
- **Guardrails exist** against removing the last platform admin or the last practice
  owner, including from the Supabase Table Editor.
- Deliberate product choices worth knowing: clients never see due dates, overdue flags or
  phase health; a whole-phase completion emails the client but an individual deliverable
  does not; the video "waiting on you" flag is the intentional way to make the
  cinematography bottleneck a shared to-do.

## 4 · Current state — what already works well

Do **not** rebuild these; they are better than the notes suggest.

- The **sequential phase engine** — the "all phases age at once" bug is fixed.
- The **Operations dashboard** — exec cards, severity summary, a dismiss/snooze/pin/
  drag-reorder attention queue that syncs to the user's profile, per-client expandable
  detail, deep links into the client portal.
- **Updates** already has Today / Yesterday / This week (important-only, short) / History,
  with team edit/delete/pin.
- The **notification dot already disappears when empty**; ops severity tiles already pulse
  only when attention exists.
- The **logo already routes correctly** (clients → Overview; team → exit to Operations).
- **`roxium.studio` appears nowhere** — every reference is `roxium.com`. No cleanup needed.
- **Setup prompts already disappear** once a platform is connected, data exists, or the
  client declines (persisted on the practice, not in a browser).
- **Deletion lifecycle** is genuinely handled: an Edge Function revokes Composio
  connections, detaches multi-practice clients and deletes single-practice auth users.
- The **design system is strong and coherent** — oklch tokens, Fraunces + Inter, a
  monoline SVG icon set, exactly one emoji in 6,931 lines, a global reduced-motion guard.

## 5 · Major bugs (full detail in `10_CURRENT_BUG_REGISTER.md`)

**P0**
1. **R-01 Reach shows a confident `0`** — `aggregateCompanyKpiByMonth()` and
   `summarizeKpiRange()` coerce `null → 0`. The per-client cards correctly show `—`.
2. **R-02 Google Ads never retrieves reach** — the GAQL query selects only
   cost/impressions/clicks. A Google-only practice has no reach, ever.
3. **R-03 Self-service signup is unreachable** — `shouldCreateUser:false` contradicts the
   entire account-approvals design, so that queue is permanently empty.
4. **R-04 Any address already in `auth.users` can always request a sign-in link** — there
   is no allowlist check on the send path; `email_is_invited()` exists, is `anon`-callable,
   and is never called (and would not block a revoked user anyway).
5. **R-05 Removal revokes data, not authentication** — the per-user delete exists
   server-side and has **no UI**.
6. **R-06 Join codes + domain auto-join bypass invite-only** — permanent, unexpiring,
   `anon`-enumerable.
7. **R-07 Due dates are parsed UTC but rendered local** — a guaranteed off-by-one for part
   of every day, for deliverables and videos but not milestones.

**P1 highlights** — R-08 "due today" is labelled "due tomorrow" and drops the count (this
is the reported *"everything says 1 day"*); R-09 videos have no due-date field in the
Video tab, so most are never flagged; R-10 editing one deliverable can reset a phase's
overdue clock; R-11 no account/property picker (the data is already persisted, the UI was
never built); R-12 no way to cancel a pending connection; R-13 nine of twelve catalog
platforms connect, import nothing, and report "synced"; R-14 sync failures notify nobody;
R-17 deliverables have no link column so they cannot be clickable; R-18
`notifications.seen` is shared across a whole practice.

## 6 · Integrations

- **Composio is the broker for all self-service connections.** ROXIUM registers **no**
  Meta or Google developer app and stores **no** token; Composio holds each practice's
  token keyed by `user_id = practice_id`, and injects it at tool-execution time. Scopes
  live in the Composio dashboard, not in this code. Adding a provider needs only a
  `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID` secret — plus a `pull<Provider>()` in
  `sync-platforms`, which is the part that is missing for nine platforms.
- **Working ingestion:** Meta (spend/reach/impressions/clicks, monthly whole-window for
  true dedup'd reach + a capped single-day walker for daily) and Google Ads (one
  180-day date-segmented GAQL query; customer discovery with MCC fallback).
- **A second, fully live legacy pipeline:** `sync-coefficient` reads each client's master
  Google Sheet via a service account, with wide/long and daily/monthly shape detection and
  ~45 header aliases. Both pipelines write the same tables and both raise their own ops
  alerts.
- **Asana is scaffolding** — two functions, a column, docs; no schedule, no UI.
- **Zapier / Make / LeadConnector appear nowhere in code.** Only as prose suggestions.
- **Resend** sends invites, update emails, video-ready emails, the weekly digest and demo
  requests. Supabase Auth's **own** sign-in emails are **not** Resend unless custom SMTP
  is configured in the dashboard (**UNVERIFIED**) — that is the Outlook problem.

## 7 · Deployment

Cloudflare Pages project `roxium-portal`, production branch `main`, direct upload via a
GitHub Action. A second Action deploys all 13 Edge Functions. `_redirects` supplies the
SPA fallback and the `/privacy` + `/terms` rewrites; `/portal/` **must** stay a directory
index (a bare `portal.html` caused an infinite 308 loop). `_headers` sets XFO/nosniff/
Referrer-Policy — **no CSP**. `version.json` + a forced one-time reload defends against
stale caches. There is **no staging environment**; `config.js` is hard-coded to one
Supabase project. **Migrations are the only un-automated link in the chain.**

## 8 · Design language (do not replace it)

Dark, warm, gold-accented, oklch-authored. `--ink 0.14 / --surface 0.17 / --gold 0.82 0.14 82 /
--cream 0.96`, white 8% hairlines. **Fraunces** (display, italic-gold accents) + **Inter**
(sans). The signature is *wide letter-spaced small uppercase gold labels against a serif
display face*. 4px spacing scale, `--r-*` radii, `--dur-*`/`--ease-*` motion tokens, a
global `prefers-reduced-motion` kill switch. Status: green on-track, amber approaching,
red overdue/failed, gold = brand not status. Icons are monoline 24×24 SVG (sidebar via
CSS masks, inline in JS elsewhere) plus two-letter platform monograms. Best reference
screens: Ops Needs-Attention, the client Overview three-column layout, the phase cards,
the Connections manager, the themed dialogs. Known inconsistencies: `index.html` declares
its **own divergent token set**; radii are ad-hoc (3/4/6/14px) despite the scale; a
"polish pass" block at `styles.css:693` overrides the base layer; chart colours are
hard-coded hex outside the tokens.

## 9 · Risks, ranked

1. **Hand-applied migrations with no ledger** — code ships on merge, schema does not.
   ~15 fail-soft `try/catch` blocks convert a missing column into a silently missing
   feature. This is the most likely cause of the next incident.
2. **False data shown as fact** — reach zeros, off-by-one deadlines, "due tomorrow" for
   everything. The portal's credibility in a client meeting depends on these.
3. **Revocation that does not revoke authentication**, plus two unexpiring side doors into
   practice membership.
4. **Silent integration failure** — no notification, no run log for the Composio pipeline,
   error classification by regex on a vendor's message string.
5. **Zero tests, no linter, no type checking, no CI gate** on a 6,931-line single-scope
   file that is deployed straight to production.
6. Secondary: `SYNC_SECRET` doing two jobs; no CSP with the session in `localStorage`;
   serial per-practice sync that will hit the function time limit as the roster grows;
   storage objects that can never be deleted.

## 10 · Recommended order (detail in `14_…`)

```
0  ground truth + guardrails   migration runner, regenerated baseline, node --check,
                               smoke checks, extract date/KPI helpers + unit tests
1  auth correctness            signup policy, real allowlist gate, "remove access
                               entirely", join-code/domain hardening, split SYNC_SECRET
2  data correctness            one date helper, honest day labels, phase-clock fix,
                               null-safe aggregates
3  notifications that matter   cover sync failures/overdue/approvals, per-user read state,
                               client bell pulse
4  operational visibility      sync_runs for Composio, reconcile the two alert models,
                               bound concurrency, real diagnostics
5  connections                 account picker, cancel pending, reach decision, more
                               connectors, manual business metrics
6  client UX completion        deliverable links (+migration), storage delete policy,
                               video due date, completion motion, token unification
7  debt reduction              delete dead code, unify edge-function helpers, split
                               app.js, scope render(), CSP
```
Passes 0 and 2 can start now. **Pass 1 is blocked on product decisions.**

## 11 · Unresolved product decisions (full text in `15_…`)

| # | Question | Blocks | My recommendation |
|---|---|---|---|
| Q1 | Can a stranger create an account and request access? | Pass 1 | Invite-only for now — and make the Supabase dashboard signup setting agree |
| Q2 | Keep join links / domain auto-join? | Pass 1 | Keep expiring join links; drop domain auto-join |
| Q3 | What should Reach show for a Google-only client? | Pass 5 | "—" / not-available; never a zero |
| Q4 | Composio vs ROXIUM's own Google/Meta apps? | Pass 5 | Hybrid, but not yet — decide after Pass 4 |
| Q5 | Is the Coefficient/Sheets pipeline being retired? | Pass 4 | Internal-only, with a written deprecation date |
| Q6 | Which events email the client vs stay internal? | Pass 3 | Deliveries/milestones/stats to the client; all operational signals team-only; waiting-on-client is the exception |
| Q7 | Should anyone enter revenue/consults/procedures? | Pass 5 | Team-entered only |
| Q8 | Should clients see due dates and overdue state? | Pass 6 | Show a promised *window*, never an overdue flag |
| Q9 | Do we need a scoped or read-only team role? | — | Not yet; decide the trigger before the first non-founder gets access |
| Q10 | Is the software moving to its own domain? | Pass 1 email work | Decide **before** verifying a sending domain, not after |
| Q11 | Target client count in 12 months? | Pass 4 priority | Under ~25 ⇒ concurrency work can wait |

## 12 · How to work with this codebase

- **Read before assuming.** The README, `ARCHITECTURE.md` and `docs/PLATFORM_AUDIT.md` are
  all partly stale; several bugs they list are fixed and several things they describe
  (a `netlify.toml`, an `.xlsx` importer) no longer exist.
- **`migrations/` is the schema source of truth, in filename order.** `schema.sql` is a
  stale snapshot.
- **Any schema change needs a human to apply it.** Write the migration, say so explicitly,
  and assume it has not been run until confirmed.
- **Never introduce a new visual system.** Extend `styles.css` tokens and the existing
  component classes. No emoji. No generic SaaS styling.
- **Prefer small, revertible tasks.** One concern per task; never combine an auth change
  with a data change, or dead-code removal with a refactor.
- **Treat fail-soft `try{}catch(_){}` as a smell, not a pattern** — it is why drift is
  invisible.
