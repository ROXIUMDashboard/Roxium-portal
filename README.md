# ROXIUM Client Portal

One website, two audiences. Clients see their roadmap, deliverables, video pipeline,
and live KPIs. The ROXIUM team sees the same — plus the controls to update all of it.
No copying data between tools: Supabase is the single source of truth, Netlify serves
the front end, and everything updates for everyone the moment it's saved.

```
Front end (this repo)  →  Netlify   (static hosting, custom domain, HTTPS)
Backend                →  Supabase  (Postgres database, magic-link auth, file storage, row-level security)
Code                   →  GitHub    (push to deploy — Netlify rebuilds on every commit)
Data feeds (optional)  →  Coefficient  (ad platforms → spreadsheet → Supabase)
```

---

## Setup — about 30 minutes

### 1 · GitHub (5 min)
1. Create a new private repo, e.g. `roxium-portal`.
2. Push this folder to it (`git init && git add . && git commit -m "portal v1" && git push`).

### 2 · Supabase (10 min)
1. Create a project at supabase.com (free tier is fine to start).
2. **SQL Editor → New query** → paste the entire contents of `schema.sql` → **Run**.
   This creates all tables, security rules, and a demo practice.
   - **Already have a live DB from before Phase B?** Don't re-run `schema.sql`. Instead run the
     incremental migration in `migrations/2026-06-22_phase_b_kpi_period.sql` once — it's additive,
     idempotent, and backfills existing KPI rows to the new month-snapshot model without data loss.
3. **Authentication → Providers → Email**: leave Email enabled (magic links work out of the box).
4. **Authentication → URL Configuration**: set Site URL to your Netlify URL (step 3) once you have it.
5. **Settings → API**: copy the `Project URL` and `anon public` key into `config.js`. Commit + push.

### 3 · Hosting (Netlify or Cloudflare Pages)

#### Option A — Cloudflare Pages (recommended)

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick this repo. Use these settings:

| Setting | Value |
|---------|--------|
| Framework preset | **None** |
| Build command | *(leave empty)* |
| Build output directory | `/` |

3. **Do not** set the build command to `npx wrangler deploy` alone — run `bash scripts/prepare-pages.sh` first (output `site/`). See **`docs/DEPLOYMENT.md`** for the full pipeline and troubleshooting stale deploys.
4. Deploy. Your preview URL will be `https://<project-name>.pages.dev`.
5. Add a custom domain under **Custom domains** if you have one.
6. Supabase → **Authentication → URL configuration** → set **Site URL** and add **Redirect URLs**:
   - `https://<your-domain>/**`
   - `https://<project-name>.pages.dev/**` (while testing)

SPA routing (magic-link auth) works automatically — there is no `404.html`, so Pages serves `index.html` for unknown routes. `_headers` in the repo sets security + cache headers.

#### Option B — Netlify

1. netlify.com → **Add new site → Import an existing project** → pick your GitHub repo.
2. `netlify.toml` already sets **Build command** `bash scripts/prepare-pages.sh` and **Publish directory** `site` (same bundle as Cloudflare Pages).
3. Deploy. Then add your custom domain (e.g. `portal.roxium.co`) under **Domain settings**.
4. Go back to Supabase → Authentication → URL Configuration → set the Site URL to this domain.

> **Production host:** If you use Netlify for your custom domain, Cloudflare Pages deploys are optional — they do not update the site your users see on Netlify.

### 4 · Create users (5 min)
1. Supabase → **Authentication → Users → Add user** → enter your email (and each teammate's).
2. Supabase → **Table Editor → profiles** → add a row per **team** user:
   - `id` = the user's UUID from the Auth screen
   - `role` = `team` for ROXIUM staff
   - `practice_id` = optional home practice (the schema seeds one demo practice)

> **Clients are no longer added by hand.** After Phase C, team users add clients and
> invite surgeon/staff logins from the **Team → Clients & access** panel in the portal
> itself (multi-user practices, invite-only). See `docs/phase-c-onboarding.md` for the
> one-time setup (run the membership migration + deploy the `invite-user` Edge Function).

### 5 · Load the engagement (5 min)
- **Deliverables**: Table Editor → `deliverables` → add the promised items per phase
  (these come straight from the Execution Workbook checklists / Asana CSV).
- **Milestones**: add Milestone I / II / III rows with status `done` / `current` / `upcoming`.
- **Video pipeline**: add each planned video asset; the team updates stages as they move.
- **KPIs**: easiest path — Team view → *Import KPI workbook (.xlsx)* and upload the
  `ROXIUM_KPI_Dashboard.xlsx` file. It maps every metric automatically.

That's it. Clients sign in with a magic link (invite-only) and see only their own practice.
Row-level security in Postgres enforces this — not the front end.

---

## Day-to-day

| Who | Does what |
|---|---|
| Team | Signs in → picks the practice → updates KPIs, deliverable statuses, video stages, posts updates |
| Client | Signs in → sees roadmap position, promised-vs-delivered progress, video pipeline (with anything waiting on *them* flagged gold), live KPIs, and the update feed |

The gold "blocked" flag on video items is deliberate: when an asset is waiting on the
surgeon (script approval, shoot date, patient consent), the client sees exactly that —
which gently converts the cinematography bottleneck into a shared, visible to-do
instead of an awkward conversation.

## Wiring in Coefficient (optional, later)
Coefficient syncs ad-platform data (Google Ads, Meta) into Google Sheets on a schedule.
Two ways to land it in the portal:
1. **Manual-light**: Coefficient fills the sheet → export the KPI workbook → import via the portal (2 clicks/month).
2. **Fully automated**: Coefficient's Google Sheets → connect a small scheduled job
   (Supabase Edge Function or Make/Zapier) that reads the sheet and upserts `kpi_monthly`.
   The table schema in `schema.sql` is already shaped for it.

## Wiring in Asana (optional, last — as planned)
Add an Asana rule: *when a task is completed in the client's project → webhook → Zapier/Make
→ insert a row into the `activity` table* (`source = 'asana'`). Updates then appear in the
client feed automatically with zero copying.
