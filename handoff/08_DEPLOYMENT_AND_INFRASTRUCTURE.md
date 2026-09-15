# 08 · Deployment & Infrastructure

**No secret values appear in this document. Names only.**

---

## 1 · The production path

```
developer → PR → merge to main
     │
     ├── .github/workflows/deploy-pages.yml           (on: push branches:[main], workflow_dispatch)
     │      1. actions/checkout@v4
     │      2. bash scripts/prepare-pages.sh          → builds site/
     │      3. npm install -g wrangler@4
     │      4. verify CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, `wrangler whoami`
     │      5. create Pages project `roxium-portal` (--production-branch main) if absent
     │      6. wrangler pages deploy site
     │           --project-name=roxium-portal --branch=main
     │           --commit-hash=$GITHUB_SHA --commit-message="<first line of commit msg>"
     │      7. print `wrangler pages deployment list --environment=production`
     │
     └── .github/workflows/deploy-functions.yml       (on: push main, paths: supabase/functions/**)
            for each supabase/functions/*/ except _shared:
              supabase functions deploy <name> --project-ref $PROJECT_REF --no-verify-jwt
              3 attempts with 10/20 s backoff (esm.sh returns 522s during bundling)
            job fails only if a function never succeeded

migrations/*.sql  →  ✋ NO AUTOMATION. Applied by hand in the Supabase SQL editor.
```

### `scripts/prepare-pages.sh` — the entire build
An **allow-list copy**, not a bundler:
```
site/index.html  app.js  styles.css  config.js  _headers  _redirects
site/portal/index.html
site/privacy/index.html   site/terms/index.html
sed -i "s/BUILD_SHA/$SHORT_SHA/g"  site/index.html site/portal/index.html
site/version.json  = {"sha","full_sha","built_at"}
```
`app.js:573 showBuildVersion()` fetches `/version.json?t=<now>` with `cache:'no-store'`,
writes `build <sha>` into the footer, and — if the loaded `app.js?v=` does not contain that
sha — **force-reloads the page once** with `?_v=<sha>` (guarded by a `sessionStorage` key).
This is a genuinely good stale-asset defence.

---

## 2 · Cloudflare configuration

| Item | Value | Source |
|---|---|---|
| Product | Cloudflare **Pages** (direct upload, not Git integration) | `deploy-pages.yml` |
| Project | `roxium-portal` | `env.PAGES_PROJECT` |
| Production branch | `main` — only a `--branch=main` deploy is a Production deployment | `deploy-pages.yml` |
| Preview URL | `https://roxium-portal.pages.dev` | README |
| Custom domain | `roxium.com` — **UNVERIFIED**, attached in the dashboard | `docs/DOMAIN_ARCHITECTURE.md` |
| Wrangler config | **none in the repo.** No `wrangler.toml` / `wrangler.jsonc`; all flags are on the CLI | verified by `find` |

### `_redirects` — SPA routing
```
/portal.html   /portal/              301   # old links from the brief window that URL existed
/portal        /portal/              301
/privacy       /privacy/index.html   200   # explicit rewrites BEFORE the SPA fallback
/privacy/      /privacy/index.html   200
/terms         /terms/index.html     200
/terms/        /terms/index.html     200
/*             /portal/index.html    200   # SPA fallback (magic-link callbacks, hash routes)
```
The file carries a long comment explaining why the portal **must** be a directory index:
Pages 308-normalises `/portal.html` → `/portal`, which then falls into the `/*` rewrite
and 308s again — an infinite redirect loop (Safari: "too many redirects").
**Do not convert `portal/index.html` back into `portal.html`.**

### `_headers`
```
/*            X-Frame-Options: DENY · X-Content-Type-Options: nosniff
              Referrer-Policy: strict-origin-when-cross-origin
/index.html   Cache-Control: no-cache, no-store, must-revalidate
/portal/ and /portal/index.html   same
/*.js  /*.css Cache-Control: no-cache, must-revalidate
```
**No `Content-Security-Policy`, no `Strict-Transport-Security`, no `Permissions-Policy`.**
Adding a CSP is complicated by the inline `<style>` and inline handlers in `index.html`,
but the portal itself loads only jsDelivr + Google Fonts and would be straightforward.

---

## 3 · Supabase environment

**Project ref:** `nchtmeqsjkpcvtuscxfy` (visible in `config.js`; the anon key is public by
design).

### Edge Function secrets — by name only

| Secret | Used by | Required for |
|---|---|---|
| `SUPABASE_URL` | all | auto-injected |
| `SUPABASE_SERVICE_ROLE_KEY` | all | auto-injected |
| `SUPABASE_ANON_KEY` | `delete-account` | building a caller-scoped client so `auth.uid()` is set inside the delete RPCs |
| `SYNC_SECRET` | `oauth-start`, `oauth-callback`, `sync-platforms`, `sync-coefficient`, `weekly-digest`, `asana-sync` | cron auth (`x-sync-key`) **and** OAuth state HMAC |
| `SITE_URL` | `invite-user`, `notify-client`, `notify-video-ready`, `oauth-callback`, `weekly-digest` | every link in every email + the OAuth bounce-back. Defaults to `https://roxium.com` |
| `RESEND_API_KEY` | all email functions | without it, functions succeed and report `emailed:0` |
| `EMAIL_FROM` | all email functions | default `ROXIUM <updates@roxium.com>` |
| `DEMO_NOTIFY_EMAIL` | `book-demo` | where demo requests land |
| `DIGEST_TO`, `DIGEST_ENABLED` | `weekly-digest` | recipients / kill switch |
| `COMPOSIO_API_KEY` | `_shared/composio.ts` | all self-service connections |
| `COMPOSIO_META_AUTH_CONFIG_ID` | `oauth-start` | Meta connect |
| `COMPOSIO_GOOGLE_AUTH_CONFIG_ID` | `oauth-start` | Google connect |
| `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID` | `oauth-start` | any additional provider — **no code change needed** |
| `GOOGLE_SA_KEY` | `sync-coefficient` | Sheets/Drive service-account JSON |
| `INGESTION_MODE` | `sync-coefficient` | `csv` (default) or `sheets_api` |
| `REPORTING_FOLDER_ID` | `sync-coefficient` | Drive folder for workbook auto-discovery |
| `CSV_URL`, `KPI_SOURCE` | `sync-coefficient` | legacy single-CSV job |
| `ASANA_TOKEN` | `asana-sync` | Asana import |
| `ASANA_SECRET` | `asana-webhook` | webhook shared secret |
| `META_APP_ID`, `META_APP_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | **nothing — `providerConfig()` is dead code** | — |

### Dashboard settings the repo cannot see (all **UNVERIFIED**)
- Auth → Providers → Email enabled; **"Allow new users to sign up"** on/off
- Auth → URL Configuration → **Site URL** and **Redirect URLs** (must include
  `https://<domain>/**`; `emailRedirectTo` is `location.origin + '/portal/'`, so the
  *origin actually loaded* must be allow-listed or the magic link lands on the wrong host
  — the documented cause of post-login 404s)
- Auth → SMTP (custom SMTP vs Supabase's shared sender) and rate limits
- Auth → Email templates (the repo ships `docs/email-templates/*.html` to paste in)
- **Cron schedules.** The 2-hourly sync and the weekly digest are described in docs as
  pg_cron/pg_net jobs POSTing with `x-sync-key`. **No cron definition exists in the
  repository** — it lives only in the database.
- Storage bucket `deliverables` existence/visibility
- Which migrations have actually been applied

### Edge Function deployment
All 13 deploy with `--no-verify-jwt`; each enforces its own auth. `_shared/` is skipped as
a deploy target but is bundled into each function that imports it. Deploys are triggered
**only** by a push touching `supabase/functions/**` — a change to a `_shared` helper does
trigger it (the path glob covers `_shared`), but a schema change that a function depends
on does not.

### Migration process
1. Open the Supabase SQL editor.
2. Run `migrations/*.sql` in **filename order** (`ls migrations/*.sql | sort`).
3. For a fresh project: `schema.sql` first, then every migration.
There is no ledger, no `supabase db push`, no CI step, and no verification. The repo's own
`migrations/README.md` proposes adopting a tracked runner and regenerating the baseline;
neither has been done.

---

## 4 · Environment variables required by the frontend

Exactly two, and both are compiled in at `config.js`:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`. There is no `.env`, no runtime config fetch, and no
per-environment build. **A staging deployment would require editing `config.js`** — there
is no mechanism to point the same bundle at a different Supabase project.

---

## 5 · Split-brain and stale-deploy risk

### Resolved
- The Cloudflare **Worker** path (`wrangler.jsonc`, `.assetsignore`) was removed; only the
  Pages Action owns the name `roxium-portal`. Verified: no wrangler config exists.
- `netlify.toml` is **gone** from the working tree and from git history
  (`git log --all -- netlify.toml` is empty).

### Still live
| # | Risk | Detail |
|---|---|---|
| 1 | **Docs still describe Netlify as a maintained fallback.** | `README.md` and a whole section of `docs/DEPLOYMENT.md` reference a `netlify.toml` that does not exist. If anyone acts on it and reconnects Netlify, the split-brain returns. |
| 2 | **A Cloudflare dashboard "Git integration" cannot be ruled out from the repo.** | If one exists on the same project it races the Action and produces preview-only or raw-repo deploys (where `index.html` literally contains the string `BUILD_SHA`). **Verify in the dashboard.** `deploy-pages.yml` warns about this in a header comment. |
| 3 | **Schema/code split-brain — the largest real risk.** | Functions and `app.js` ship on merge; migrations do not. A deploy referencing an un-applied column fails at runtime. The code hides this with ~10 fail-soft `try/catch` blocks (`app.js:875-890`, `:5292`, `:1676`, `loadKpiPrefs`, `saveOpsAttentionState`…), which turn a hard error into a silently missing feature. |
| 4 | **`--no-verify-jwt` on every function.** | Correct for the cron/webhook/callback functions; it means auth correctness rests entirely on each function's own code. `book-demo` is genuinely public and unauthenticated (rate limiting is Supabase's only defence). |
| 5 | **Partial function-deploy success.** | The loop deliberately omits `set -e`, so a run can deploy 12 of 13 functions and still fail the job. The 12 are live. Re-running is safe (idempotent) but the failure mode is "some functions are newer than others". |
| 6 | **No rollback path.** | Cloudflare Pages keeps deployment history (dashboard rollback works), but a bad **migration** has no down-script anywhere in the repo. |
| 7 | **No staging environment.** | One Supabase project, one Pages project, `config.js` hard-coded. Every change is tested in production. |
| 8 | **Single-key blast radius.** | `SYNC_SECRET` is simultaneously the cron bearer token and the OAuth state HMAC key. Rotating it invalidates in-flight OAuth handshakes; leaking it allows arbitrary sync triggering **and** forged OAuth state. These should be two secrets. |
| 9 | **Domain change would touch several places.** | `docs/DOMAIN_ARCHITECTURE.md` recommends moving the software to `roxiumstudio.com` / `app.roxiumstudio.com`. Nothing in the code hard-codes a host (`emailRedirectTo` uses `location.origin`), so the work is: Pages custom domain, Supabase Site URL + Redirect URLs, the `SITE_URL` secret, the Resend verified sending domain, and the `<a href="https://roxium.com">` back-links in `portal/index.html`. **Note: `roxium.studio` appears nowhere; the proposal is `roxiumstudio.com`.** |
