# Infrastructure Audit — Cloudflare vs Netlify, GitHub, Supabase & SQL

**Date:** 2026-07-07 · **Branch:** `claude/infrastructure-audit-cloudflare-netlify-aeqvi6`
**Scope of this report:** everything verifiable from the Git repository and the GitHub API.

> **See also: [Update 2 — live deployment findings](#update-2--live-deployment-findings)** at the
> bottom (trigger "duplicates", Cloudflare preview-only deploys, and the magic-link 404), added
> after the first round of dashboard testing.

> ### Access boundary (read this first)
> This audit was run from the **repository and GitHub only**. I do **not** have login
> access to the Cloudflare dashboard, the Netlify dashboard, or the live Supabase
> project/database. Anything that lives *only* in one of those dashboards (DNS records,
> which project owns the custom domain, live table row counts, RLS as actually applied,
> storage buckets, secrets, cron jobs) is marked **⚠ needs dashboard confirmation** and
> is accompanied by the exact click-path to verify it. I have not invented values for
> things I cannot see.

---

## 0. TL;DR — the answer to "why is Cloudflare stale while Netlify isn't"

**Netlify is fine because it was explicitly fixed** (PR #65 / current `netlify.toml`): it now
runs `bash scripts/prepare-pages.sh` and publishes the generated `site/` folder.

**Cloudflare is almost certainly a "split-brain": more than one Cloudflare deploy
mechanism points at the name `roxium-portal`, and the URL/domain you look at is fed by a
*different* mechanism than the one that is actually up to date.** The GitHub Action that
deploys to Cloudflare Pages is **green and current** — run #12 deployed the current `main`
HEAD (`56f02c1`) successfully on 2026-07-07. So the code is being pushed to Cloudflare
correctly. The staleness is a *routing/target* problem, not a build failure.

The three deploy descriptors that currently coexist in the repo are the source of the
ambiguity:

| # | Descriptor | Product it targets | Runs `prepare-pages.sh`? |
|---|-----------|--------------------|--------------------------|
| 1 | `.github/workflows/deploy-pages.yml` | Cloudflare **Pages** `roxium-portal` (direct upload via `wrangler pages deploy`) | ✅ yes |
| 2 | `wrangler.jsonc` (`wrangler deploy`) | Cloudflare **Worker** `roxium-portal` (assets) | ❌ only if a human runs the script first |
| 3 | `netlify.toml` | Netlify | ✅ yes |

Plus a possible **4th, invisible-to-me** path: a **Cloudflare "Git integration"** connected
in the dashboard (Pages or Worker auto-build on push). If that exists with the wrong build
settings (output `/` or `.`, or no build command), it serves the raw repo — where
`index.html` still literally contains the string `BUILD_SHA` and `version.json` does not
exist — which is the classic "stale / build 55 / broken" signature.

**Recommendation (detail in §7):** collapse to **one** Cloudflare path — Cloudflare **Pages**,
fed by the **existing green GitHub Action** — delete the Worker descriptor, and disconnect
any dashboard Git integration so nothing competes. Then attach the domain to that one Pages
project.

---

## 1. Deployment Pipeline Audit

### What the repo actually does today
- **Static site, no compile step.** Production assets: `index.html`, `app.js`, `styles.css`,
  `config.js`, `_headers`. `site/` is generated at deploy time and is git-ignored.
- **Version stamping** (`scripts/prepare-pages.sh`): copies the static files into `site/`,
  replaces every `BUILD_SHA` token in `index.html` with the 7-char Git SHA, and writes
  `version.json` (`sha`, `full_sha`, `built_at`). This is already a correct
  Git-SHA-based versioning scheme (see §8).
- **Two GitHub Actions:**
  - `deploy-pages.yml` → on push to `main` → `prepare-pages.sh` → `wrangler pages deploy site`
    → Cloudflare Pages project `roxium-portal`. **History: runs #3–#12 all succeeded**
    (#1–#2 failed on 2026-07-02, before secrets were set).
  - `deploy-functions.yml` → on push to `main` touching `supabase/functions/sync-coefficient/**`
    → deploys **only** `sync-coefficient` via Supabase CLI.

### Root-cause determination (per the brief)
- ❌ Not "Cloudflare failing silently during build" — the Action is green.
- ❌ Not "building the wrong branch" — Action is pinned to `main`.
- ✅ **Most likely: the custom domain / the URL you check is attached to a different
  Cloudflare target than the Action updates** (Worker vs Pages, or a second Git-connected
  Pages project). This is documented as a known risk in your own `docs/DEPLOYMENT.md`
  ("Dual deploy confusion") — this audit confirms the repo still ships the conditions for it.
- ✅ **Secondary: edge/browser cache** could hold an old `index.html`/`app.js` if a bad
  deploy ever shipped without `_headers`. Mitigated but see §9.

**⚠ needs dashboard confirmation** — the single check that resolves it:
`Cloudflare → Workers & Pages → roxium-portal` — is it listed under **Pages** or **Workers**?
And `Custom domains` — which project owns the production hostname? If the domain is on a
Worker (or a second Pages project) while the Action uploads to the Pages project, that is the bug.

---

## 2. Cloudflare Configuration Audit

Verifiable from repo:
- `wrangler.jsonc`: name `roxium-portal`, `assets.directory = ./site`,
  `not_found_handling = single-page-application`, `compatibility_date 2026-06-29`. This is a
  **Workers-assets** config — i.e. it describes a `wrangler deploy` (Worker), *not* the Pages
  upload the Action uses. Its presence is a large part of the split-brain.
- `_headers` / `_redirects`: SPA + no-cache headers present and correct.
- `.assetsignore`: correctly excludes `supabase/`, `migrations/`, `docs/`, `*.sql`, the zip,
  etc. from a `wrangler deploy`.

**⚠ needs dashboard confirmation** (I cannot see these):
- Connected GitHub repo / connected branch / build command / output dir / framework preset
- Environment variables, build logs, deployment history, Worker bindings, routes, custom
  domains, DNS.

**Concrete checklist to run in the Cloudflare dashboard:**
1. Workers & Pages → is `roxium-portal` a **Pages** project or a **Worker**? (Decides everything.)
2. If Pages **and** "connected to Git": Settings → Builds must be
   `Build command: bash scripts/prepare-pages.sh`, `Output: site`, `Production branch: main`.
   If output is `/` or `.`, that is the stale-content cause — fix or disconnect.
3. Custom domains → confirm the production hostname is on the **same** project the Action deploys to.
4. Deployments → newest production row should show commit `56f02c1` (current `main`).

---

## 3. Netlify Configuration Audit

From `netlify.toml` (authoritative, in `main`):
- Build command `bash scripts/prepare-pages.sh`, publish `site` — **matches Cloudflare's build**. ✅
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`) — match `_headers`. ✅
- `no-cache` on `/index.html`, `/*.js`, `/*.css` — match `_headers`. ✅
- SPA redirect `/* → /index.html 200`. ✅ (Cloudflare gets the equivalent from
  `not_found_handling: single-page-application`.)

**Difference vs Cloudflare:** none of substance in the build. The *only* real difference is
**which platform owns your domain and users**. Netlify config is healthy; the problem is
purely that Cloudflare has competing targets.

**⚠ needs dashboard confirmation:** Netlify env vars, build plugins, production branch, and
whether the site is still connected to GitHub (it appears to be, since Netlify tracks `main`).

---

## 4. GitHub Audit

- **Default branch:** `main`. **Latest commit:** `56f02c1` (merge of PR #70).
- **Branch protection:** **NONE.** `main` is reported `protected: false`. For a
  production product this is a gap (see §12 / CI-CD).
- **Merge strategy:** merge commits ("Merge pull request #NN …"). Note the GitHub API reports
  `merged: false` on every PR even though the work is in `main` — the merges were done in a way
  that didn't flip the PR's merged flag (e.g. merged from a mirror/fork ref). Cosmetic, but it
  means "open" vs "closed" is the only reliable PR signal, not "merged."
- **Webhooks / required checks:** none enforced (no branch protection ⇒ no required status checks).
- **All three deploy platforms build the same commit?** GitHub Action: yes (`main`).
  Netlify: yes if still connected to `main`. Cloudflare Git integration: **⚠ unknown** — the
  crux of §1.

---

## 5. SQL / Database Cleanup

> **Method note:** this is **static analysis** of `schema.sql`, the 26 files in `migrations/`,
> and every `.from()` / `.rpc()` call in `app.js` + edge functions. A *definitive* dead-object
> list requires live introspection (`pg_stat_user_tables`, `pg_stat_user_indexes`, `pg_depend`)
> which needs Supabase access I don't have. Do **not** drop anything below without confirming
> zero rows / zero dependencies in the live DB first.

**Tables in `schema.sql` (15):** `activity, app_settings, deliverables, kpi_daily, kpi_monthly,
memberships, milestones, notifications, practice_invites, practices, profiles, sheet_sources,
sync_runs, video_history, video_pipeline`. **All 15 are referenced by `app.js`** — no obviously
dead table. (`app.js` also queries `milestone_history`, which is not in `schema.sql`; it is
created by a migration — confirm it exists in the live DB.)

**Functions (~40):** the ones called directly by the app (`get_practice_roster`, `seed_practice`,
`add_practice_invite`, `claim_invites_for_user`, `promote/demote_platform_admin`,
`get_/set_my_ops_attention_state`, `set_my_name`, `delete_practice`, `revoke_practice_invite`,
`remove_practice_member`, `get_practice_onboarding_status`, `get_platform_admins`,
`email_is_invited`) are live. The rest (`is_member_of`, `my_practice`, `protect_*`, `notify`,
`log_video_*`, `finalize_past_months`, `touch_deliv_status`, `stamp_milestone_completion`, …)
are **trigger/RLS helper functions** invoked from SQL, not the client — **do not** flag these as
dead just because `app.js` doesn't call them.

**Migrations that are one-off / diagnostic and safe to archive** (they were run once against
the live DB; they are not a replayable migration chain and add noise):
- `2026-06-22_diagnose_demo_kpi.sql` (a diagnostic SELECT, not a schema change)
- `2026-06-22_fix_duplicate_practice.sql`, `2026-06-25_fix_seed_practice_conflict.sql` (data repairs)
- `2026-06-23_delete_practice.sql`, `2026-06-23_video_move_scheduled_to_planned.sql` (one-off data ops)
- `2026-06-25_promote_platform_admin.sql`, `2026-06-25_set_my_name.sql` (one-off admin actions)

> Recommendation: move these to `migrations/archive/` (keep for history) rather than delete, and
> document in the README that `schema.sql` is the source of truth for a fresh DB and the dated
> files are an applied-once log.

**⚠ needs Supabase confirmation:** unused indexes, broken FKs, dead triggers, duplicate KPI
tables, legacy invite/auth tables — none are visible as "dead" from static analysis; they must be
checked with the introspection queries provided in §6.

---

## 6. Supabase Audit

**Repo-visible:**
- `supabase/config.toml` — local-dev config (Postgres 17, storage 50 MiB, no custom buckets
  declared, no SMTP configured in-repo, auth `site_url = http://127.0.0.1:3000` — a **local**
  value; production redirect URLs live in the hosted dashboard).
- **6 Edge Functions** exist: `invite-user`, `asana-sync`, `asana-webhook`, `notify-video-ready`,
  `sync-coefficient`, `notify-client` (+ `_shared/auth.ts`).
- **CI gap (verified):** `deploy-functions.yml` auto-deploys **only `sync-coefficient`**. The
  other **five** functions have **no CI path** — they must be deployed by hand and can silently
  drift from `main`. This is a real production risk. Recommendation: extend the workflow to deploy
  all functions on change (a matrix or `supabase functions deploy` per changed dir).

**⚠ needs Supabase confirmation** (run in SQL editor):
```sql
-- unused indexes
select relname, indexrelname, idx_scan from pg_stat_user_indexes where idx_scan = 0 order by 1;
-- table liveness (spot zero-row / legacy tables)
select relname, n_live_tup from pg_stat_user_tables order by n_live_tup;
-- invalid / broken constraints
select conrelid::regclass, conname, convalidated from pg_constraint where not convalidated;
-- triggers
select event_object_table, trigger_name from information_schema.triggers order by 1;
```
Also confirm in the dashboard: RLS enabled on every table in `public`, Storage buckets, Secrets,
scheduled/cron jobs, installed extensions, materialized views.

---

## 7. Deployment Consistency — recommended single architecture

**Decision: Cloudflare = production.** To make it authoritative and eliminate the split-brain,
pick **one** of these and remove the others. Recommended = **Option A**.

**Option A — Cloudflare Pages via the existing GitHub Action (recommended).**
- Keep `.github/workflows/deploy-pages.yml` (already green).
- **Delete `wrangler.jsonc`** and `.assetsignore` (they only exist for the Worker `wrangler deploy`
  path you would no longer use).
- **Disconnect** any Cloudflare dashboard **Git integration** for this repo so it can't produce a
  competing build. Deploys happen *only* via the Action's direct upload.
- Attach the production domain to the **Pages** project `roxium-portal`.
- Pro: no build minutes on Cloudflare, no dashboard build settings to get wrong, deterministic.

**Option B — Cloudflare Pages via native Git integration.**
- **Delete `deploy-pages.yml`**, connect the repo in the Cloudflare dashboard with
  `Build: bash scripts/prepare-pages.sh`, `Output: site`, `Branch: main`.
- Pro: native per-PR preview deployments. Con: build settings live in a dashboard (the exact thing
  that caused this incident), and you'd re-introduce a secret-free but less auditable path.

**Either way: retire the Worker path** (`wrangler.jsonc`) so `roxium-portal` is unambiguously a
**Pages** project, and **designate Netlify as non-production** (see §11 end-goal).

---

## 8. Build Versioning

**Already correct.** `prepare-pages.sh` injects the **Git commit SHA** into `index.html`
(`build <sha>`, `?v=<sha>` cache-bust) and writes `version.json`. `app.js` fetches `version.json`
and, since PR #63, auto-reloads once when the loaded `app.js` doesn't match. No change needed —
the earlier "build 55/59" confusion was the *old* manually-bumped integer, now gone. The only
requirement is that **whatever deploy path wins actually runs the script** (see §1/§7) — a raw-repo
deploy ships the literal token `BUILD_SHA`, which is the visible symptom to watch for.

---

## 9. Cache Audit

- **No service worker** in the app (verified) — nothing to invalidate there.
- `_headers` / `netlify.toml` both set `no-cache` on HTML/JS/CSS. ✅
- Assets are additionally cache-busted by `?v=<sha>`. ✅ (belt-and-suspenders)
- **Residual risk:** Cloudflare's **edge cache** can still hold an old asset if a deploy ever
  shipped without `_headers`, or if a Cloudflare cache rule overrides origin headers. One-time fix
  after cutover: `Cloudflare → Caching → Purge Everything`, then hard-refresh.
- **⚠ needs dashboard confirmation:** no Cloudflare "Cache Rule" / Page Rule is force-caching HTML.

---

## 10. Domain Readiness Audit (before attaching the new domain)

Repo-side readiness: SPA routing ✅, security headers ✅, cache headers ✅, Git-SHA versioning ✅.

**Must be set in dashboards before/at cutover (⚠ not visible to me):**
- **Cloudflare:** domain on the *correct* Pages project; SSL/TLS mode **Full (strict)**; HTTPS
  (Always Use HTTPS on); DNS proxied (orange cloud); SPA fallback confirmed on the real domain.
- **Supabase Auth:** add the new domain to **Site URL** + **Redirect URLs** (magic-link / OAuth
  callbacks currently point at `127.0.0.1`/the old host — they will break on the new domain until
  updated).
- **Resend / email:** verify the sending domain (SPF/DKIM) and any links that hard-code the old host.
- **CORS:** Supabase allows any origin for the anon key by default, but confirm Edge Functions
  (`invite-user`, `notify-client`, `asana-webhook`, …) don't allow-list an old origin.
- **OAuth redirect URIs:** update any provider (Google, etc.) to the new callback URL.

---

## 11 & 12. Repository & GitHub Cleanup — categorized

### 🟥 Safe to delete / remove (reversible via Git history)
**Stale branches** (work already superseded and living on `main`; none are `main`'s ancestor
because of the merge-commit style, but their content shipped long ago):
| Branch | Age / state | Why |
|--------|-------------|-----|
| `migrations/2026-06-22_phase_c_memberships.sql` | tip **is in main** | A branch accidentally named after a **file path** — pure namespace pollution. |
| `cursor/phase-a` | 41 commits, last 2026-06-22 | Phase A shipped via closed PR #3. |
| `cursor/coefficient-sync` | 48 commits, last 2026-06-22 | Shipped via closed PR #6. |
| `cursor/deliverables-default-expanded` | 44 commits, last 2026-06-22 | Shipped via closed PR #4. |
| `cursor/netlify-build-script-baea` | PR #65 (draft), 1 commit | Its change (`prepare-pages.sh` in `netlify.toml`) is **already in `main`**. Superseded. |
| `cursor/deploy-history-metadata-baea` | PR #61, 1 commit | Deploy metadata (`--commit-hash`/`--commit-message`) is **already in** `deploy-pages.yml`. Superseded. |

**Stale open PRs to close (not merge):**
- **#65** — superseded (Netlify already runs `prepare-pages.sh`).
- **#61** — superseded (metadata already in the Action).
- **#35** — "Admin refactor" superseded by the later Admin PRs (#36–#48) that shipped.

**Repo artifacts:**
- `roxium-portal.zip` (24 KB, tracked) — a distributable committed into the repo. Remove and add
  to `.gitignore`.

**Deploy-config to retire when Cloudflare becomes sole prod (§7 Option A):**
- `wrangler.jsonc`, `.assetsignore` (Worker path), and eventually `netlify.toml` /`_redirects` once
  Netlify is decommissioned (or keep `netlify.toml` if Netlify stays as a labelled staging env).

### 🟨 Needs review (confirm before acting)
- **Netlify's fate** — retire entirely, or keep as an explicitly-labelled **staging/preview**
  environment? Affects whether `netlify.toml` stays.
- **One-off migrations** (§5) — archive to `migrations/archive/` vs delete.
- **`config.js` anon key in Git** — this is *safe by design* (anon key + RLS), but confirm RLS is
  actually enforced on every table before relying on it.
- **`docs/` phase notes** (`phase-a`…`phase-e`, coefficient templates) — historical; keep or move
  to a `docs/history/` folder.

### 🟩 Keep (actively used)
- All 15 tables, all app-referenced RPCs, all 6 edge functions, `deploy-pages.yml`,
  `deploy-functions.yml`, `scripts/prepare-pages.sh`, `_headers`, core static assets, `schema.sql`
  (source of truth for a fresh DB), `ARCHITECTURE.md`, `README.md`, `docs/DEPLOYMENT.md`.

---

## Recommended execution order
1. **Confirm the Cloudflare target** (§2 checklist) — this alone likely explains the staleness.
2. **Collapse to one deploy path** (§7 Option A): delete `wrangler.jsonc` + `.assetsignore`,
   disconnect dashboard Git integration, attach domain to the Pages project.
3. **Purge Cloudflare cache once**, verify footer SHA == `main`.
4. **Close** PRs #35/#61/#65; **delete** the 6 stale branches; **remove** `roxium-portal.zip`.
5. **Extend `deploy-functions.yml`** to cover all 6 edge functions.
6. **Add branch protection** on `main` (require the deploy check / a review).
7. **Archive** one-off migrations; document `schema.sql` as source of truth.
8. **Update Supabase Auth redirect URLs + Resend + OAuth** for the new domain, then attach it.
9. Run the Supabase introspection queries (§6) and drop confirmed-dead objects.

---

# Update 2 — live deployment findings

*Added after dashboard testing (Cloudflare preview-only deploys, magic-link 404, Worker deleted).
These four items were investigated against the live symptoms; root causes below, with the repo-side
fixes already applied on this branch.*

## A. SQL trigger "duplicates" — NOT real duplicates (nothing to remove)

The audit query used `information_schema.triggers`, which returns **one row per
`event_manipulation`**. A trigger declared on two events shows up as two rows. Verified in-repo:

| Trigger | Table | Declared events | Rows expected |
|---------|-------|-----------------|---------------|
| `trg_sync_kpi_month` | `kpi_monthly` | `before insert or update` | 2 (INSERT+UPDATE) |
| `trg_stamp_milestone_completion` | `milestones` | `before insert or update` | 2 |
| `trg_protect_last_team_admin` | `profiles` | `before update or delete` | 2 |
| `enforce_bucket_name_length_trigger` | `storage.buckets` | Supabase-managed (INSERT+UPDATE) | 2 |
| `tr_check_filters` | `realtime.subscription` | Supabase-managed | 2 |

**Postgres forbids two triggers of the same name on the same table**, so genuine duplicates are
impossible here. Every migration that (re)creates these triggers first runs
`drop trigger if exists … ;` (verified in `schema.sql` and the `migrations/` files), so re-applying
`schema.sql` *and* a later migration is idempotent — it does not stack duplicates.

**Verdict: false alarm. Do not drop anything.** The `buckets`/`objects`/`subscription` triggers are
Supabase's own storage/realtime internals, not ours. To confirm there is exactly one trigger object
per name, use `pg_trigger` (one row per trigger) instead of `information_schema.triggers`:
```sql
select tgrelid::regclass as table, tgname, count(*)
from pg_trigger where not tgisinternal
group by 1,2 having count(*) > 1;   -- returns 0 rows = no real duplicates
```

## B. Cloudflare "only Preview deployments" — working as designed + a stray Git integration

**Root cause (two parts):**
1. In Cloudflare Pages, a deployment is **Production only when it comes from the project's
   Production branch (`main`)**. Every other branch is a **Preview** — by design. The current PR
   (#71) has **not been merged**, so no new Production deployment has been produced. The "deployed
   13 min ago (Preview)" entry corresponds to the **PR branch push**, not a `main` deploy.
2. That preview could only have been produced by a **Cloudflare dashboard Git integration** — the
   GitHub Action (`deploy-pages.yml`) triggers **only on push to `main`**, never on a PR branch. So
   a dashboard Git integration is (still) connected and auto-building feature branches. With the
   Action *also* deploying on `main`, the next merge triggers **two** production deploys racing for
   the same project — the original split-brain, now live.

**Why the Worker failed / is it still needed:** No. The Worker path (`wrangler deploy` driven by
`wrangler.jsonc`) was the wrong product for a static SPA and has been **removed from the repo**
(`wrangler.jsonc` + `.assetsignore` deleted); you also deleted the Worker in the dashboard. Pages
alone should serve the frontend. No repo file references a Worker anymore.

**Fix to reach a single Production path:**
- **Merge PR #71 → `main`** → the Action produces a Production deployment (with the SPA fix in D).
- **Disconnect the Cloudflare dashboard Git integration** for this repo (Workers & Pages → project →
  Settings → Builds & deployments → disconnect). This stops the preview-only race *and* the
  confusing feature-branch previews. Deploys then come only from the Action, only on `main`.
- Confirm the Pages project's **Production branch = `main`** and that the **custom domain** is on
  this same project.

## C. Magic-link → Cloudflare "404 · nothing here yet" — Supabase Auth URLs + missing SPA fallback

The app calls `signInWithOtp({ options:{ emailRedirectTo: location.origin } })` (`app.js`). Two
independent causes, both now addressed:

1. **Supabase Auth URL configuration (primary).** Supabase only honours `emailRedirectTo` when that
   exact origin is in **Authentication → URL Configuration → Redirect URLs**. If it isn't, Supabase
   redirects to the project's **Site URL** after verifying the link. The in-repo `supabase/config.toml`
   still carries local defaults (`site_url = http://127.0.0.1:3000`), and the README historically told
   you to point Site URL at **Netlify** — so the hosted Site URL is almost certainly **not** the
   Cloudflare origin. Result: after a successful magic link you're bounced to a host that has no
   content there → Cloudflare's "nothing here yet" page.
   **Fix (dashboard):** set **Site URL** = `https://roxium-portal.pages.dev` (later your custom
   domain) and add **Redirect URLs**: `https://roxium-portal.pages.dev/**` and
   `https://<custom-domain>/**`. If you test from preview URLs too, add `https://*.roxium-portal.pages.dev/**`.
2. **Missing Pages SPA fallback (repo bug, fixed).** The README claimed Pages "serves index.html for
   unknown routes automatically" — **false**. Cloudflare Pages returns its default 404 for any path
   with no matching file unless a `_redirects` rule says otherwise. The repo's `_redirects` had the
   rule intentionally *omitted* (to avoid a Workers-only error). Now that the Worker path is gone,
   `_redirects` has been set to `/* /index.html 200` — the correct, recommended Pages SPA rule — so
   any path-based landing (and future client routes) resolve to the app instead of 404ing.

## D. Deployment cleanup — leftover references (repo-side done)

Applied on this branch:
- `_redirects` → real SPA fallback for Pages (was a no-op comment).
- `app.js` header comment "Front end: Netlify" → "Cloudflare Pages".
- `README.md` hosting section rewritten: Cloudflare Pages = production via the Action; corrected the
  false "SPA works automatically" claim; corrected the Site URL guidance (Cloudflare, not Netlify).
- `.github/workflows/deploy-pages.yml` header comment: removed stale Worker/Git-integration guidance,
  added the "do not connect a second Git integration" warning.
- (Earlier on this branch) removed `wrangler.jsonc`, `.assetsignore`, `roxium-portal.zip`.

**Deliberately left as-is (need your call / dashboard action):**
- `netlify.toml`, `_headers`'s Netlify-equivalents, and `ARCHITECTURE.md`/`docs/phase-*` mentions of
  Netlify — **not removed**, because Netlify is your *currently working* host and deleting
  `netlify.toml` would make Netlify redeploy the raw repo root (broken). Correct order: get Cloudflare
  green as production → disconnect Netlify in its dashboard → *then* remove `netlify.toml`.
- `supabase/config.toml` localhost values are **local-dev** defaults (used by `supabase start`), not
  the hosted project config — safe to leave; the hosted Site URL is set in the dashboard (see C).
- `deploy-functions.yml` still deploys only `sync-coefficient` (the other 5 Edge Functions have no CI)
  — unchanged to avoid redeploying them with wrong flags; flagged for a deliberate fix.

## Cutover checklist (do in this order before attaching the domain)
1. Merge **PR #71** → `main` (ships the SPA `_redirects` fix).
2. Confirm the Action's Production deploy is green; visit `https://roxium-portal.pages.dev`, footer
   SHA == `main`.
3. **Disconnect** the Cloudflare dashboard Git integration (leave only the Action).
4. Supabase → set **Site URL** + **Redirect URLs** to the Cloudflare origin(s) (see C).
5. Re-test the magic link end-to-end → you should land **in the app**, not a 404.
6. Cloudflare → Caching → **Purge Everything** once.
7. Attach the custom domain to the Pages project; add it to Supabase Redirect URLs; re-test.
8. (Later) disconnect Netlify, then remove `netlify.toml`.
