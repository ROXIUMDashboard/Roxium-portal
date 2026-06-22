# ROXIUM Portal · Architecture & Requirements

The answer to "what do I need to make this possible" — accounts, data, integration
points, and the phased build plan with testing criteria.

---

## 1 · What you need (the complete list)

**Accounts (all have free tiers to start)**
- GitHub — code lives here; pushing to `main` auto-deploys
- Supabase — one project = database + auth + file storage + API
- Netlify — connects to the GitHub repo; serves the site; holds the custom domain
- Coefficient — only when you automate ad-data sync (Phase C below)
- A subdomain — `portal.roxium.co` (added in Netlify, one DNS record)

**Keys & values (only two, both in `config.js`)**
- Supabase Project URL
- Supabase anon public key (safe to ship — row-level security does the protecting)

**Data you must collect per client at kickoff**
- Practice name + go-live date → `practices`
- Client emails (surgeon, practice manager) → Auth users + `profiles` (role `client`)
- The promised deliverables list (from the Execution Workbook / Asana CSV) → `deliverables`
- Milestone plan (I/II/III with dates) → `milestones`
- Planned video assets → `video_pipeline`
- KPI baseline (discovery call Block F numbers) → `kpi_monthly` month 0/1

## 2 · Data flow (no copying, one source of truth)

```
Google Ads / Meta ──→ Coefficient ──→ Google Sheet ──→ kpi_monthly ─┐
Team manual entry ───────────────────────────────────→ kpi_monthly ─┤
KPI workbook (.xlsx) ── portal import ───────────────→ kpi_monthly ─┤
                                                                    ├──→ Supabase (Postgres)
Asana task completed ──→ webhook (Zapier/Make) ──────→ activity ────┤        │
Team posts update ───────────────────────────────────→ activity ────┘        ▼
                                                              Netlify front end
                                                         (client view + team view,
                                                          role-gated by RLS)
```

Sales-side data (consults booked, procedures, pricing) enters once — through the team
view or the monthly workbook import — and is instantly visible to both audiences.

## 3 · Dashboard requirements → what's implemented

| Requirement (from planning notes) | Where it lives |
|---|---|
| Client-facing AND firm-facing in one website | Same app; `profiles.role` gates the team panel; RLS gates the data |
| Show progress on the things we promised | `deliverables` table + promised-vs-delivered progress bar |
| Surgeon knows where he is and what's next | `milestones` timeline — "You are here" marker |
| Cinematography bottleneck visibility | `video_pipeline` board; blocked items flagged gold with the reason |
| KPIs from ads/marketing/sales in one place | `kpi_monthly` keyed by `(practice_id, period, source)` — one immutable snapshot per calendar month + data source (`marketing`/`coefficient`/`asana`); latest period = live view, older periods are history. Same formulas as the KPI workbook. |
| Asana updates (integrated last) | `activity` feed accepts webhook rows (`source='asana'`) |
| File storage for deliverables | Supabase Storage bucket `deliverables`, per-practice folders |
| No data the client must give us | Everything is ROXIUM-entered or auto-synced; client only views |

## 4 · Phased build (ship value early, integrate later)

**Phase A — Static dashboard (done).** The standalone HTML dashboard; no accounts needed.
Use it today in client calls.

**Phase B — Portal MVP (this repo).** Auth, roles, roadmap, deliverables, video pipeline,
KPIs, feed. *User-testing criteria before inviting clients:*
- A `client` login can see only its own practice (test with two practices, two accounts)
- A client CANNOT insert/update any table (try it from the browser console — RLS must reject)
- Magic-link sign-in works on the custom domain on mobile
- Workbook import round-trips correctly (import → numbers match the xlsx)
- A surgeon can answer "what's done, what's next, what's waiting on me" in under 30 seconds

**Phase C — Automation.** Coefficient → scheduled sync into `kpi_monthly`;
Asana webhook → `activity`. *Criteria:* one month runs with zero manual KPI entry;
every completed Asana task appears in the feed within 5 minutes.

**Phase D — Tier expansion.** The elevated package (10% video production add-on +
conversion-LP execution deliverables) becomes new rows in `deliverables` with its own
phase label — the portal showcases the higher tier without any code change. Per-practice
file delivery via the storage bucket.

## 5 · Cost & effort reality check
- Free tiers cover the first several practices (Supabase free: 500MB DB + 1GB storage;
  Netlify free: 100GB bandwidth). First paid step is Supabase Pro (~$25/mo) when storage
  or row counts grow.
- Time to first deployed portal: ~30 minutes following README.md.
- Time per new practice after that: ~15 minutes (practice row, users, deliverables import).
