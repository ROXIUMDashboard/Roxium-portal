# Deployment guide — Roxium Portal

This document explains how production deploys work, why Cloudflare can report “success” while the live site looks stale, and how to verify you are on the correct environment.

> **Production model (as of 2026-07-07):** production is **Cloudflare Pages**, deployed by the
> single GitHub Action `.github/workflows/deploy-pages.yml` (direct upload via `wrangler pages
> deploy`). The old Cloudflare **Worker** path (`wrangler.jsonc` / `.assetsignore`) has been
> **removed** so only one target owns the name `roxium-portal`. Do **not** also connect this repo
> as a Cloudflare dashboard "Git integration" — a second auto-build would re-create the
> split-brain this fixed. See `docs/INFRASTRUCTURE_AUDIT.md` for the full analysis. Netlify config
> is retained but is **not** the source of truth.

---

## How the site is built

The portal is a **static site** (no compile step). Production assets are:

| File | Purpose |
|------|---------|
| `index.html` | Shell |
| `app.js` | Application |
| `styles.css` | Styles |
| `config.js` | Supabase URL + anon key |
| `_headers` | Cache-control (no stale JS/CSS) |
| `version.json` | **Generated at deploy** — Git SHA + timestamp |

**Never deploy the raw repo root.** The repo also contains `supabase/`, `migrations/`, `docs/`, etc.

---

## Netlify (retained, non-production)

Netlify config is kept but Netlify is **no longer the source of truth** (production is Cloudflare
Pages — see below). `netlify.toml` configures:

| Setting | Value |
|---------|--------|
| Build command | `bash scripts/prepare-pages.sh` |
| Publish directory | `site` |

After merging to `main`, Netlify rebuilds automatically if the site is connected to GitHub. If the live site still shows an old footer SHA:

1. Netlify dashboard → **Deploys** → **Trigger deploy** → **Clear cache and deploy site**
2. Hard refresh the browser (**Cmd+Shift+R** / **Ctrl+Shift+R**)
3. Confirm footer `build <sha>` matches `main` and `/version.json`

---

## Cloudflare Pages (production)

### Build script

```bash
bash scripts/prepare-pages.sh
```

This creates `site/` with only the static files and replaces `BUILD_SHA` in `index.html` with the current Git commit (7 characters). The footer and `?v=` cache-bust query params use that SHA.

---

## Deploy paths (important)

There is now exactly **one** production deploy path. Do not add a second.

### A) GitHub Actions (`.github/workflows/deploy-pages.yml`) — the only path

- Triggers on **every push to `main`**
- Runs `prepare-pages.sh` → `wrangler pages deploy site`
- Targets **Cloudflare Pages** project: `roxium-portal`
- Requires GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

### B) Cloudflare dashboard "Git integration" — **do not use**

The old Worker path (`wrangler.jsonc` + `.assetsignore` + `npx wrangler deploy`) was **removed**
so it can't compete with the Action for the name `roxium-portal`. **Do not connect this repo as a
Cloudflare Pages/Worker Git integration** in the dashboard either — a dashboard auto-build plus the
Action = two deploys racing for the same project, which is exactly the split-brain that made
Cloudflare look stale. If such an integration already exists, **disconnect it**; deploys come only
from the Action.

**Symptoms of a rogue second deploy path (watch for these):**

- Footer shows the literal text `build BUILD_SHA` and `/version.json` 404s → something deployed the
  **raw repo** without running `prepare-pages.sh`.
- Deployment history shows commits you didn't push via the Action.
- Custom domain attached to a **different** project than the one the Action deploys to.

---

## Investigation: “Deploy succeeded but site still shows Build 55”

### 1. PR number ≠ build number

**PR #60** is a pull request number, not the footer build label. The footer used to be a **manually bumped integer** (`build 55`, `build 59`, …). It is now the **Git short SHA** (e.g. `build d772086`).

### 2. Wrong URL / wrong project

Confirm you are not still visiting:

- An old **Netlify** URL (`netlify.app`)
- A **preview** deployment (`*.pages.dev` with a commit preview URL)
- A **Worker** deployment while your domain points elsewhere
- A **second** Pages project created earlier with Git integration

**Check:**

1. Open `https://roxium-portal.pages.dev` directly (bypass custom domain).
2. Footer should match the latest `main` commit SHA.
3. Cloudflare → **Workers & Pages** → **roxium-portal** → **Deployments** → production should show the same commit hash.

### 3. `wrangler.jsonc` used to deploy the repo root

Previously:

```json
"assets": { "directory": "." }
```

That told Workers to serve the **entire repository**, not the prepared static bundle. GitHub Actions deployed a clean `site/` folder to **Pages**, while **Workers Git** could still serve an older or incorrect asset tree. **Fixed:** `directory` is now `./site`.

### 4. Dual deploy confusion

| Integration | What it updated |
|-------------|-----------------|
| GitHub Actions | Pages project `roxium-portal` via direct upload |
| Cloudflare Git (Worker) | Worker `roxium-portal` via `wrangler deploy` |

If your **custom domain** is on the Worker but only **Pages** received the GitHub Action upload (or vice versa), the dashboard shows success for one while the domain serves the other.

**Fix:** Pick one production target. Recommended:

- **Pages** for the static portal + custom domain on that Pages project  
- **Or** Worker with `prepare-pages.sh` + `wrangler deploy`  
- Disable the unused integration to avoid drift

### 5. Caching (stale build 55 with fresh version.json)

If `/version.json` shows the new SHA but the footer still says **build 55** and the UI looks old, your browser or Cloudflare cached **index.html** and **app.js** from an earlier deploy. `version.json` is often fetched fresh because it is a new file with no prior cache entry.

**Fix once:**

1. Cloudflare dashboard → **Caching** → **Configuration** → **Purge Everything**
2. Hard refresh: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows)
3. Or open the site with a cache-bust query: `https://your-domain/?_v=4cd21d2`

After PR #63, the portal auto-reloads once when it detects `app.js` does not match `version.json`.

### 6. Caching (general)

- No service worker in this app.
- `_headers` sets `Cache-Control: no-cache` on `index.html`, `*.js`, `*.css`.
- If `_headers` was missing from a bad deploy, hard-refresh (**Cmd+Shift+R**) or purge cache in Cloudflare → **Caching** → **Purge everything** once.

### 6. Verify deployed commit

**GitHub:** `main` latest commit → `git log -1 --oneline`

**GitHub Actions:** open the deploy workflow run → log shows `Deployed commit <sha>`

**Cloudflare:** Pages project → Deployments → production row → commit hash

**Live site:** footer `build <7-char-sha>` or fetch `/version.json`:

```json
{"sha":"d772086","full_sha":"d772086...","built_at":"..."}
```

All four should match.

---

## One-time Cloudflare dashboard checklist

1. **Workers & Pages** → open **roxium-portal** — is it under **Pages** or **Workers**?
2. **Custom domains** — which project owns your production domain?
3. **Settings → Builds** (if Git connected):
   - Build: `bash scripts/prepare-pages.sh`
   - Output: `site`
4. **Disconnect** any Cloudflare dashboard Git integration for this repo — the Action is the only deploy path.
5. Merge to `main` → confirm GitHub Action **Deploy Portal to Cloudflare Pages** succeeds.
6. Visit `https://roxium-portal.pages.dev` → confirm footer SHA.

---

## Local preview of production bundle

```bash
bash scripts/prepare-pages.sh
npx wrangler pages dev site
```

---

## Supabase (not part of static deploy)

Edge Functions (`invite-user`, `sync-coefficient`) deploy separately via Supabase CLI / `.github/workflows/deploy-functions.yml`. They do not affect the portal footer build number.
