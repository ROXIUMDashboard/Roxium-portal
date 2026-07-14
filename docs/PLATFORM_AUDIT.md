# ROXIUM Platform Audit & Rebuild Roadmap

_Full read-only audit by four senior reviewers (frontend/mobile, auth/onboarding
lifecycle, backend/SQL/deploy, UX/navigation). Findings are evidence-based with
`file:line` references. This document is the plan of record; nothing here is
implemented yet — build order is set with the owner before any code changes._

Severity: **P0** = correctness/broken or catastrophic UX · **P1** = important ·
**P2** = polish.

---

## The headline

The platform is in better shape than a codebase this size usually is — the CSS is
genuinely mobile-considered (documented breakpoint ladder, reflowing grids,
scroll-wrapped tables), KPI conflict keys are sound, FK cascades are thorough, and
`connHealth()` already implements the "only prompt reconnect on expiry" behavior
the owner wants. The real problems cluster in three places:

1. **Lifecycle correctness** — deletion doesn't remove auth users (deleted clients
   reappear), and the approval gate keys off the wrong column so reject/remove
   don't actually revoke access. *These are the "manual Supabase cleanup" bugs.*
2. **Accreted structure** — one 5,117-line `app.js`, hand-applied migrations with a
   stale `schema.sql`, 5 overlapping marketing-connect surfaces, dead code still
   shipping to every client.
3. **Missing "answer-first" client layer** — the portal shows numbers before it
   answers "what changed / what needs me / what's next."

None of this is rot; it's a platform that outgrew its original shape. The fixes are
mostly contained, not a rewrite.

---

## P0 — Correctness (fix first, before any features)

| # | Issue | Evidence | Fix |
|---|---|---|---|
| 1 | **Deleted clients reappear.** `delete_practice` never removes `auth.users`; next login `ensure_my_profile` recreates a pending profile. Requires manual Supabase cleanup. | `2026-06-23_delete_practice.sql:16-18`; `app.js:612` | Team-only **edge function** using `auth.admin.deleteUser` (an RPC cannot); revoke Composio connections too, then `delete_practice`. |
| 2 | **Phases all turn yellow at once.** Countdown anchor advances only on full delivery, so every incomplete phase shares the same start + thresholds and crosses `warn` the same day. | `app.js:3028-3070`; `PHASE_TIMING` `3011-3013` | Sequential clock: only the first-incomplete phase runs a live countdown; successors are "upcoming" (days=0) until their predecessor completes. Contained `app.js` change. |
| 3 | **Reject/remove don't revoke.** Approval gate needs `!practice_id` too, so any profile with a `practice_id` bypasses it; `reject_account`/`remove_practice_member` only flip flags → silent broken/empty portals, not honest "no access." | `app.js:626-628`; `account_approvals.sql:119-126`; `2026-06-24_...:144-152` | Gate on **membership + approval status**, never `practice_id`. Make reject/remove delete memberships, null `practice_id`, revert the invite. |
| 4 | **Schema/code drift, no migration runner.** SQL applied by hand; `schema.sql` is missing `platform_connections`, `kpi_dashboard_prefs`, `composio_connection_id`, etc. CI ships functions referencing un-migrated columns. | `deploy-functions.yml`; schema.sql grep (0 hits) | Tracked migration runner in CI; regenerate or retire `schema.sql`; squash the 4 overlapping connection migrations. |

## P1 — Important

**Lifecycle / access**
- Multi-practice client lockout: `delete_practice` deletes a client's whole profile even if they're a member elsewhere → stuck on Pending. Detach (null `practice_id`), don't delete, when other memberships exist. `2026-06-23_delete_practice.sql:16`
- Two divergent invite paths; `invite-user` pre-provisions membership + marks invite accepted, and the insert-only approval trigger misses conflict-updates → re-invite can leave a profile pending. Pick one path; explicitly approve on upsert. `invite-user/index.ts:113-121`
- No per-client delete (only whole-practice or membership-row). Add `delete_client(user_id)`.

**Backend / scale**
- N+1 sync with no concurrency/pagination/time budget (`pullMeta` = 7 serial Composio calls/practice; `asana-sync` truncates at 100). Bound concurrency + cursors. `sync-platforms/index.ts:216,115-133`
- 3 divergent inlined `authorize()` + copy-pasted `cors`/`json`/`UUID_RE`. Extract one `_shared` runtime module; migrate the 4 inlined functions. `sync-coefficient/invite-user/asana-*`
- Missing indexes: `memberships(user_id,practice_id)` (hit by every client read via `is_member_of`), plus `practice_id` on `deliverables/milestones/video_pipeline/activity`. `schema.sql:308-313`
- Client emails fire-and-forget with swallowed errors (`.catch(()=>{})`); no retry. Add a `notification_outbox` + cron drain. `app.js:2853-2865`

**Frontend / perf**
- `render()` rebuilds **every** view's innerHTML on each call; charts are destroyed+recreated instead of `.update()`. Scope rendering per active view; reuse chart instances. `app.js:1604,768-769,1003`
- Render-blocking `xlsx.full.min.js` (~430 KB) in `<head>` for admin-only export; Chart.js + Supabase also blocking. `defer` all; lazy-load xlsx on click. `portal/index.html:10-12`
- `backdrop-filter:blur()` on the **sticky** header repaints every scroll frame (mobile jank). De-blur or gate behind pointer:fine. `styles.css:19`
- Dead code shipping to every client: `youAreHere`, `renderOpsAccountability` (165 lines). Delete. `app.js:1679-1701,3768,3866-4032`

**UX / navigation**
- **5 marketing-connect surfaces → 2 UIs.** Banner + Metrics CTA + wizard modal + Connections tab + Settings marketing. Collapse to **one** (the Connections manager). `portal/index.html:77-85,157,357-364`; `app.js:1147,1419`
- **Settings tab is fully redundant** with Connections (its only content is a 2-provider subset). Merge into one Settings area (Connections / Team sub-tabs). `portal/index.html:357-364`
- **Numbers before answers.** Hero = 4 raw stat tiles, default view = Roadmap; no client "what changed / needs you / next." The landing page even *promises* "what needs attention, surfaced automatically" — undelivered. `app.js:1650-1667`; `index.html:249`
- **"Continue without connecting" never settles** (`wizard_completed_at` set only by Finish) → re-nagged every session. Persist a declined flag. `app.js:1227-1235`
- **Connections page is emoji-heavy** (📘🔍📸…) against the Cormorant/gold aesthetic; owner wants no-emoji. Replace with monoline SVG/monograms; standardize on the dot+label status list everywhere. `app.js:1324-1339,1455`

## P2 — Polish
- No `prefers-reduced-motion` anywhere (viewin/fadein/pulse/chart animations). Add a global reduce-motion guard. `styles.css:503,754`
- Landing is largely static (hardcoded sparklines, no count-up, no scroll reveals, no card hover lift, no mobile nav menu). Add restrained motion. `index.html:185-203,54`
- CSS accretion: "POLISH PASS" override block re-declares base rules; select-arrow theming defined 3–4×; landing duplicates the design tokens instead of sharing `styles.css`. Consolidate. `styles.css:554-612,227/414/605/756`
- A few team/ops edit surfaces lack a mobile-stacked layout (`.drow` edit controls, `.ops-client-head`). `styles.css:126-128,355-360`
- Dead functions still deployed (`asana-sync`/`asana-webhook` no caller; `weekly-digest` gated off). Split `SYNC_SECRET` into cron vs OAuth-state key. `asana-sync/index.ts:9`; `_shared/oauth.ts:24`
- Pages redeploys on every push (no `paths:` filter); prepare-pages allow-list needs a target-exists check. `deploy-pages.yml:12-15`

---

## Recommended build order (each phase = its own PR)

**Correctness before cosmetics.** Mobile and landing polish on top of broken
lifecycle logic is exactly the "layering fixes on bad architecture" to avoid.

- **Phase 0 — Quick wins (hours, low risk):** delete dead renderers, `defer`/lazy-load the 3 scripts, de-blur the sticky header, add `prefers-reduced-motion`, and the **phase-sequencing fix** (P0 #2 — small, high-visibility). Immediate perceptible improvement.
- **Phase 1 — Lifecycle correctness (P0/P1):** `delete_client`/`delete_practice` edge function (auth-user + Composio revoke), fix the approval gate to key on membership+status, make reject/remove real revokes, detach multi-practice clients, unify the invite path. *Kills the manual-cleanup bugs.*
- **Phase 2 — Infra hardening (P0/P1):** migration runner in CI + honest `schema.sql` + squash connection migrations + missing indexes; extract the shared edge runtime; sync concurrency/pagination; notification outbox.
- **Phase 3 — Mobile responsiveness pass:** the remaining `<640px` stacking gaps + per-view render scoping + chart `.update()` (the perf fixes that matter most on phones).
- **Phase 4 — Navigation & connections consolidation:** 8→5 tabs, 5→1 marketing surface, de-emoji + dot-status everywhere, merge Settings, persist declined.
- **Phase 5 — Client "answer-first" Overview:** new default view with "what changed / needs you / next" + a real insight layer (`buildKpiInsights`).
- **Phase 6 — Landing-page motion pass:** IntersectionObserver reveals, sparkline draw, stat count-up, hover lift, mobile menu — all reduced-motion-gated.
- **Phase 7 — Modularization + component library:** bundler (esbuild/Vite, no framework), split `app.js` along the existing `safe()`/`render*` seams, extract shared CSS tokens, pull buttons/cards/chips/KPI tiles into a real component package — which then becomes the thing synced to Claude Design (the design-system ask falls out of this, not before it).

Phases 3–6 can partially parallelize; 0–2 should land in order.
