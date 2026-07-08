# ROXIUM Portal — Internal Operations & Onboarding SOP

> **Audience:** ROXIUM team members. **Purpose:** everything a new employee needs to run
> the portal — platform concepts, client onboarding, marketing-data setup, reporting
> architecture, and the daily workflow. This is an internal manual; it is **not** part of
> the client-facing product.

---

## 1. Platform Overview

The **ROXIUM Portal** is one website with two audiences, backed by one database — no copying
data between tools. It runs on **Cloudflare Pages** (frontend, `roxium.com`) + **Supabase**
(Postgres database, magic-link auth, file storage, Row-Level Security) + **Resend** (email).
Marketing data flows in from ad platforms via **Coefficient → Google Sheets → Supabase**.

**Access model (roles):**
- **`team`** — ROXIUM staff. Platform administrators. See the global Operations Dashboard,
  Team Controls, and every client.
- **`client`** — a practice's users, with a per-practice membership role of **Owner** or
  **Member**. Owners can invite/remove their own team. Access is gated by RLS so a client only
  ever sees their own practice.

**The screens:**

| Screen | Who | What it's for |
|--------|-----|----------------|
| **Operations Dashboard** | Team | Company-wide command center: Needs-Attention queue, company KPI rollup across all clients, and a searchable client overview with inline edits. |
| **Team Controls** (Admin) | Team | Create/delete clients, configure reporting sources, manage Access & Invites, promote/remove platform admins, global settings (master Drive folder). |
| **Client Dashboard** | Client (and Team via "Preview as client") | The practice's roadmap, deliverables, video pipeline, live KPIs, and updates feed. |
| **Roadmap / Milestones** | Both | Phased milestones (Planned → current → Complete), auto-advanced by deliverable completion. |
| **Deliverables** | Both | Work items grouped by **phase**, each `promised → in_progress → delivered`. |
| **Video Production (VSL pipeline)** | Both | Video items moving through stages: Planned → Scheduled → Pre-production → Shot → Editing → Delivered → Posted. |
| **KPI Reporting (Metrics)** | Both | Ad-performance metrics per reporting month or an All-Months trend, per channel or All channels. |

**Notifications & email cadence:**
- **In-app notification** (client banner) for every completion/stage change.
- **Email** only on the "big" events: a **phase** of deliverables completing, each **video** posted,
  each **milestone**. (Not one email per individual deliverable.)
- Video stage changes fire an in-app notification automatically via a DB trigger, deduped so only
  the newest status per video shows.

---

## 2. New Client Onboarding (end to end)

Do these in order. All steps are in the portal unless noted.

1. **Create the client / practice.** Team Controls → Clients → add the practice name + go-live
   date. This seeds a starter roadmap (milestones), a starter deliverables set, starter video
   items, and a default **Meta Ads** reporting source.
2. **Configure the practice.** Confirm the name, go-live date, and set the **master workbook**
   (the client's Google Sheet) once it exists (see §3/§4).
3. **Invite the doctor (Owner).** Team Controls → **Access & Invites** → select the practice →
   enter the doctor's email → role **Owner** → Send invite. They receive a branded magic-link
   email (or can type the 6-digit code — the Outlook-safe path).
4. **Invite additional practice team members.** Either you add them (role **Member**), or the
   doctor (Owner) invites their own staff from their **Invite team** area. No SQL, no per-email
   approval — the allowlist + RLS handle access.
5. **Verify permissions.** Have the Owner sign in once. Confirm they see only their practice,
   can edit what they should, and appear in the roster as **Owner**. Confirm Members are
   **Member**. Remove anyone added by mistake with the **Remove** button (removes access to that
   practice only, not their account).
6. **Connect reporting.** Create/point the client's **workbook** and add one **tab per marketing
   source** (see §3). In Team Controls, set the practice's workbook + map each source tab.
7. **Verify KPI sync.** Run **Sync now** for the practice. Confirm `sheet_sources` shows
   `last_status = ok` and a recent `last_synced_at`, and that rows landed in the reporting month.
8. **Verify dashboards.** Open the Client Dashboard (or "Preview as client"): the hero cards
   (Amount Spent / Reach / Link Clicks) and KPI cards should show real numbers for **All Months**
   and for a specific month; the Metrics graph should render.
9. **Confirm onboarding complete.** The onboarding checklist (Access ✓, Sheet ✓, Sync ✓) is
   green, the doctor has logged in, and at least one reporting month is live.

---

## 3. Marketing Data Onboarding (what we need from every client)

**How it works end to end:** the client grants us access to their ad platform → **Coefficient**
pulls that platform's metrics into a **tab** in the client's Google **workbook** → our
`sync-coefficient` job reads each tab → writes rows into `kpi_monthly` (and `kpi_daily`) in
Supabase → the portal renders them. One **tab = one source/channel**; "All channels" on the
dashboard sums every source for the month.

**General access pattern (all platforms):** the client adds our Coefficient/reporting Google
account (or service account) as a **read-only/Viewer/Analyst** user on their ad account, then we
connect that account in Coefficient and point a workbook tab at it. Never ask for passwords — use
the platform's native "add user / grant access" flow.

Metrics we standardize on per source (as available): **Spend, Reach, Impressions, Link Clicks**
(+ derived CTR / CPM / CPC), and where provided: **Landing Page Views, Page Likes, Page
Engagement, Followers**. Empty metrics are hidden automatically.

| Platform | Access required | How the client grants it | Coefficient connection | Workbook tab | Portal source key |
|----------|-----------------|--------------------------|------------------------|--------------|-------------------|
| **Meta Ads** | Ad account **Analyst** (read) | Business Settings → Ad Accounts → Add People → our account, Analyst | Coefficient → Meta Ads connector → select ad account | `Meta Ads` tab | `marketing` (default) |
| **Instagram Insights** | IG linked to the Business/Meta account, read access | Same Meta Business access (IG asset) | Meta / Instagram connector | `Instagram` tab | `instagram_insights` |
| **Facebook Insights** | Page **Analyst** role | Page → Settings → Page Access → add our account | Meta / Facebook Pages connector | `Facebook` tab | `facebook_insights` |
| **Google Ads** | Account **Read-only** access (via customer ID) | Google Ads → Admin → Access → invite our email, Read-only | Coefficient → Google Ads connector | `Google Ads` tab | `google_ads` |
| **Google Analytics (GA4)** | Property **Viewer** | GA4 Admin → Property Access → add our email, Viewer | Coefficient → GA4 connector | `Google Analytics` tab | `google_analytics` (custom) |
| **YouTube Analytics** | Channel **Viewer/Analyst** (via Brand Account) | YouTube/Google → channel permissions → add our account | Coefficient → YouTube connector | `YouTube` tab | `youtube_analytics` |
| **Microsoft Ads** | Account **Viewer** | Microsoft Advertising → Account access → invite our email | Coefficient → Microsoft Ads connector | `Microsoft Ads` tab | `microsoft_ads` |

**Adding a source in the portal:** Team Controls → the practice → Reporting & KPI → add source →
pick the source key + the tab name in the workbook. The default `marketing` (Meta) source is
created automatically at practice creation.

**Recommended future additions:** call/lead tracking (CallRail) for **cost-per-lead**; CRM/booking
data for **consults & procedures** (fields already exist in the schema: `cons`, `proc`);
LinkedIn Ads and TikTok Ads connectors; server-side conversions for more reliable click→lead
attribution.

---

## 4. Reporting Workbook Structure

- **One Google Drive master folder** holds every client's workbook. It's set once, globally, in
  Team Controls (the `master_reporting_drive_folder` setting).
- **One workbook per client** (a single Google Sheet), linked to the practice.
- **One worksheet / tab per marketing source** (Meta Ads, Google Ads, …). The tab name is what we
  map to a source key.
- **Automatic tab detection.** When a workbook is linked, the system can discover the tabs and map
  them to sources; you confirm/adjust the mapping.
- **Automatic KPI synchronization.** The `sync-coefficient` job reads each active tab and writes
  `kpi_monthly` (monthly snapshots) and, where present, `kpi_daily` (daily rows for the month-zoom
  charts). Runs on a schedule and on demand via **Sync now**.
- **Monthly snapshots.** Each reported month is stored as an immutable per-period snapshot
  (`kpi_monthly`, keyed by practice + period + source). Past months are frozen (`finalized`).
- **Live current month.** The most recent month updates as new data syncs; earlier months are
  archived snapshots. The dashboard labels which is live vs archived.

**Ingestion modes:** CSV (published-CSV per tab) or Sheets API (`INGESTION_MODE=sheets_api` with a
Google service-account key). Sheets API is preferred for private workbooks.

---

## 5. Daily Team Workflow

1. **Open the Operations Dashboard.** Start on the company view: the KPI rollup (all clients, all
   channels) and the client overview.
2. **Work the Needs-Attention queue.** Triage flagged items (overdue deliverables, stuck videos,
   sync failures, blocked work). Snooze, dismiss, pin, or reorder — state syncs to your profile
   across devices.
3. **Update deliverables.** Move items to `in_progress` / `delivered`. Completing an item notifies
   the client in-app; completing the **last item in a phase** emails them ("Phase X complete").
4. **Manage video production.** Advance each VSL through its stage (Planned → … → Posted). Every
   stage change auto-notifies the client (deduped to the latest status). Use **Post** to publish
   the finished video (moves to Posted, emails the client, records history).
5. **Verify KPI syncs.** Check `sheet_sources` status per client; re-run **Sync now** for any with
   errors or stale `last_synced_at`. Confirm the current month's numbers look sane.
6. **Respond to client notifications / updates.** Post updates to the client feed as needed; keep
   messaging in the portal so both sides always see the same source of truth.
7. **Close out completed work.** Mark delivered items done, confirm milestone auto-advance reflects
   reality, and clear resolved items from the attention queue.

---

## 6. Best Practices & Troubleshooting

**Operational standards**
- One tab per source, named consistently; keep the source→tab mapping accurate so "All channels"
  totals are correct.
- Invite the **doctor as Owner** first; let Owners manage their own team to reduce your load.
- Never register a **public email domain** for auto-join; invite personal-email users individually
  or via the invite flow.
- Keep past months **finalized** — never overwrite historical snapshots.

**Common troubleshooting**
- **"Could not add client / ON CONFLICT" or removal buttons don't work** → the DB is behind on
  migrations. Apply the latest `migrations/*.sql` (especially the catch-up/reconcile file) in the
  Supabase SQL Editor.
- **Client sees no KPI numbers** → check `sheet_sources.last_status`; re-run Sync; confirm the tab
  has data for that month (monthly rows, not just daily).
- **Completion emails not arriving** → confirm `notify-client` / `notify-video-ready` are deployed
  (the deploy workflow deploys all functions on merge), `practice_member_emails` exists (catch-up
  migration), and Resend secrets (`RESEND_API_KEY`, `SITE_URL`, optional `EMAIL_FROM`) are set.
- **Outlook users can't click the sign-in link** → they should type the 6-digit code from the
  email instead (Outlook Safe Links can consume single-use links). Ensure Resend SPF/DKIM + DMARC
  are set on `roxium.com`.
- **Metrics graph blank on first open** → resolved in-app (chart resizes on tab open); if stale,
  hard-refresh to get the latest build.

**Consistency across practices**
- Same workbook layout, same tab naming, same source keys for every client.
- Confirm each new client passes the onboarding checklist (Access ✓ / Sheet ✓ / Sync ✓) before
  handing the portal to the doctor.
- Review the attention queue daily so nothing ages silently.

---

*Living document — update it as the platform evolves (new sources, new stages, new automations).*
