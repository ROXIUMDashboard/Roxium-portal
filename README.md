# ROXIUM Client Portal

One website, two audiences. Clients see their roadmap, deliverables, video pipeline,
and live KPIs. The ROXIUM team sees the same — plus the controls to update all of it.
No copying data between tools: Supabase is the single source of truth, Cloudflare Pages
serves the front end, and everything updates for everyone the moment it's saved.

```
Front end (this repo)  →  Cloudflare Pages  (static hosting, custom domain, HTTPS)
Backend                →  Supabase  (Postgres database, magic-link auth, file storage, row-level security)
Code                   →  GitHub    (merge to main → GitHub Action deploys to Cloudflare Pages)
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
   - **Operations Dashboard attention sync (snooze / dismiss / pin / order across devices)?** Run
     `migrations/2026-07-07_ops_attention_state.sql` once on live DBs. Without it, the dashboard
     still works using browser localStorage only.
   - **Daily KPI charts (reporting month zoom)?** Run `migrations/2026-07-07_kpi_daily.sql` once,
     redeploy `sync-coefficient`, then run **Sync now** so daily rows populate from Coefficient sheets.
3. **Authentication → Providers → Email**: leave Email enabled (magic links work out of the box).
4. **Authentication → URL Configuration**: set **Site URL** to your Cloudflare Pages URL
   (`https://<project>.pages.dev`, or your custom domain once attached) and add it to
   **Redirect URLs** as `https://<your-domain>/**`. The app signs in with
   `emailRedirectTo: location.origin`, so the origin you actually load **must** be allow-listed
   here — otherwise Supabase falls back to Site URL after the magic link and you land on the
   wrong host (a common cause of a post-login 404).
5. **Settings → API**: copy the `Project URL` and `anon public` key into `config.js`. Commit + push.

### 3 · Hosting — Cloudflare Pages (production)

Production is **Cloudflare Pages**, deployed by one GitHub Action
(`.github/workflows/deploy-pages.yml`) on every merge to `main`. This is the single
production deploy path — do **not** also connect a Cloudflare dashboard "Git integration"
(a second auto-build races the Action and produces confusing preview-only deploys).

1. In GitHub, add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
   (Settings → Secrets and variables → Actions). The Action creates the Pages project
   `roxium-portal` (production branch `main`) if it doesn't exist and uploads `site/`.
2. Merge to `main` → the Action runs `scripts/prepare-pages.sh` → `wrangler pages deploy site`.
   Only a deploy from the **production branch (`main`)** is a Production deployment; any other
   branch is a **Preview**. If Cloudflare only shows Previews, you have unmerged work and/or a
   stray dashboard Git integration building feature branches.
3. Verify at `https://roxium-portal.pages.dev` — footer `build <sha>` must match `main`.
4. Add your custom domain under **Custom domains** (on this Pages project).
5. Supabase → **Authentication → URL configuration** → set **Site URL** and **Redirect URLs**:
   - `https://<your-domain>/**`
   - `https://roxium-portal.pages.dev/**` (while testing)

SPA routing (magic-link auth) is handled by `_redirects` (`/* /index.html 200`) — Cloudflare
Pages does **not** serve `index.html` for unknown paths on its own, so that rule is required.
`_headers` sets security + cache headers.

> **Netlify** is retained as a non-production fallback only. Its `netlify.toml` uses the same
> build. See **`docs/DEPLOYMENT.md`** and **`docs/INFRASTRUCTURE_AUDIT.md`** for the full
> pipeline, the Cloudflare split-brain history, and stale-deploy troubleshooting.

---

## Operations Dashboard (team)

- **Needs attention** — dismiss (permanent), snooze until tomorrow (⏸), pin, drag-reorder; syncs to your profile when `migrations/2026-07-07_ops_attention_state.sql` is applied (localStorage fallback otherwise).
- **Company KPI** — monthly spend, reach, impressions, and link-clicks charts; month selector for live vs archived reporting periods.

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

---

## Also in this repository

**`bhfa-2027/`** — the Beverly Hills Face Academy 2027 scientific-program planning room:
a separate Next.js application (Supabase + Railway) where founders, chairs and faculty
edit the working agenda together over one private link. It shares no code or database
tables with the portal above. See [`bhfa-2027/README.md`](bhfa-2027/README.md).
