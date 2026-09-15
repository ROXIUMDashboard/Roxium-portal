# 00 · Executive System Map

> **Audit date:** 2026-09-14 · **Branch audited:** `claude/bhfa-2027-agenda-tool-o0ph8r` (equivalent to `main` for portal code) · **HEAD:** `e28a478`
>
> Everything in this document was verified by reading the code. Where a claim could
> not be verified from the repository alone (it depends on the live Supabase project,
> Cloudflare dashboard, Composio dashboard or DNS), it is marked **UNVERIFIED**.

---

## 1 · What the app is

ROXIUM Client Portal is a **multi-tenant B2B operating portal** for a plastic-surgery
marketing agency. One codebase serves two audiences from the same data:

- **ROXIUM team** — an operations console across *all* client practices: a Needs-Attention
  queue, per-client health scoring, deliverables/milestones/video editing, marketing-data
  sync health, access & invites, company-wide KPI rollups.
- **Client practices** (surgeons + practice staff) — a read-mostly portal scoped to their
  own practice: an answer-first Overview, roadmap/phase progress, video pipeline, live
  marketing KPIs, an update feed, and (for practice owners) self-service marketing
  connections and teammate invites.

There is **no build step**. The portal is hand-written HTML + one 6,931-line
`app.js` + one 1,905-line `styles.css`, served statically. All logic runs in the browser
against Supabase; privileged work happens in 13 Deno Edge Functions.

---

## 2 · Major user types

| Type | Where it is defined | How it is enforced |
|---|---|---|
| **Platform admin / ROXIUM team** | `profiles.role = 'team'` | `is_team()` SECURITY DEFINER fn; every table has a `for all using (is_team())` policy |
| **Practice owner** | `memberships.role = 'owner'` | `is_practice_owner()`, `can_invite_to_practice()`; unlocks Invite-team + Connections tabs (`app.js:260-264`) |
| **Practice member** | `memberships.role = 'member'` | `is_member_of(practice_id)` in every client read policy |
| **Pending / rejected account** | `profiles.approval_status` + **no membership** | `afterLogin()` `app.js:826-836` shows the waiting-room pane; RLS denies all practice data regardless |
| **Anonymous** | no session | Sees only the login card at `/portal/` and the public marketing page at `/` |

There is **no "client vs surgeon" distinction** in the data model — both are
`profiles.role = 'client'` + a membership. `owner` vs `member` is the only client-side
capability split.

---

## 3 · Major workflows

1. **Onboarding a practice** — team creates it via `seed_practice(name, kickoff)` (34 seeded
   deliverables across Phases 0–7, 4 milestones, 10 planned videos, one `sheet_sources`
   Meta row). `app.js:renderAdminClients()` / Team Controls → Clients.
2. **Granting access** — team or practice owner invites an email → `invite-user` Edge
   Function creates the auth user, profile, membership and (best effort) a Resend email.
3. **Client sign-in** — passwordless magic link **or** a typed 6-digit OTP
   (`app.js:594-640`). On sign-in `claim_invites_for_user()` claims invites, then falls back
   to domain auto-join (`practice_domains`), then a `?join=CODE` link.
4. **Delivering work** — team moves deliverables `promised → in_progress → delivered`
   and videos across 7 stages; DB triggers write `video_history` + `notifications`; the
   client sees progress bars, a "waiting on you" flag and an update feed.
5. **Marketing data** — a practice owner connects Meta / Google through **Composio**
   (`oauth-start` → Composio hosted consent → `oauth-callback`); a 2-hourly cron runs
   `sync-platforms`, which writes `kpi_monthly` + `kpi_daily`. A parallel legacy pipeline
   (`sync-coefficient`) reads Google Sheets tabs into the same tables.
6. **Operations morning check** — team lands on `#operations`: exec cards, severity
   summary, a dismiss/snooze/pin Needs-Attention queue, per-client expandable detail,
   company KPI rollup.

---

## 4 · Frontend architecture

```
/index.html          public marketing landing page (own <style> block, own tokens)
/portal/index.html   the application shell — every view's DOM skeleton, 974 lines
/app.js              ALL application logic, 6,931 lines, one global scope, no modules
/styles.css          the whole design system, 1,905 lines / 142 KB
/config.js           SUPABASE_URL + SUPABASE_ANON_KEY (committed on purpose)
/privacy, /terms     standalone static pages
```

- **Router:** hash-based. `VIEWS` (`app.js:242`) = `overview, operations, roadmap,
  deliverables, video, metrics, updates, connections, access, team, controls`.
  `showView()` (`app.js:377`) toggles `.view` sections and re-gates on every navigation.
- **Role gating is client-side only** in the UI (`TEAM_ONLY_VIEWS`, `canSeeAccessTab()`,
  `canSeeConnectionsTab()`); the *data* gate is RLS. See `03_AUTH_AND_PERMISSIONS.md`.
- **State:** module-level `let data = {...}` (current practice) and `let opsData = {...}`
  (all practices). `render()` (`app.js:2440`) re-renders every view's `innerHTML` on each
  call, wrapped in `safe(label, fn)` so one throwing section can't blank the page.
- **Third-party runtime:** `@supabase/supabase-js@2` and `chart.js@4.4.1` from jsDelivr,
  Google Fonts (Fraunces, Inter, Cormorant Garamond, Jost). No npm dependencies at the
  portal root — `node_modules/` is empty.

---

## 5 · Backend architecture

**Supabase Postgres** is the source of truth. ~20 tables, ~35 RPCs, 8 triggers, RLS on
every table. Full detail in `02_DATABASE_SCHEMA.md`.

**13 Edge Functions** (`supabase/functions/`):

| Function | Purpose | Auth model |
|---|---|---|
| `invite-user` | create auth user + profile + membership + Resend invite | caller JWT, team **or** practice owner |
| `delete-account` | practice/user teardown incl. `auth.admin.deleteUser` | caller JWT, team only |
| `oauth-start` | mint a Composio hosted-auth link | caller JWT, member or team |
| `oauth-callback` | verify Composio account, flip to `connected`, kick first sync | HMAC-signed `state` |
| `sync-platforms` | Composio → Meta/Google Ads → `kpi_monthly`/`kpi_daily` | `x-sync-key` **or** team JWT **or** member for own practice |
| `sync-coefficient` | Google Sheets/CSV → `kpi_monthly`/`kpi_daily` | `x-sync-key` or team JWT |
| `notify-client` | Resend email on team update | team JWT |
| `notify-video-ready` | Resend email when a video is posted | team JWT |
| `weekly-digest` | internal ops digest email | `x-sync-key` or team JWT |
| `asana-sync` | Asana project → `deliverables` | `x-sync-key` |
| `asana-webhook` | external webhook → `activity` | `x-asana-secret` |
| `book-demo` | public landing form → email + `demo_requests` | **public** |
| `_shared/` | `auth.ts`, `http.ts`, `oauth.ts`, `composio.ts` | — |

All functions deploy with `--no-verify-jwt` and gate internally
(`.github/workflows/deploy-functions.yml`).

---

## 6 · Authentication architecture

- **Supabase Auth, email only.** Magic link (`signInWithOtp`) with a typed-OTP fallback.
  No password, no social login, no MFA.
- `shouldCreateUser: false` (`app.js:612-614`) — the browser can never create an auth user.
  **Only `invite-user` creates accounts** (`auth.admin.createUser` with
  `email_confirm: true`).
- Access = **a row in `memberships`**. `afterLogin()` checks memberships directly, not
  `profiles.practice_id`, and sends anyone without one to the waiting-room pane.
- Three parallel ways a membership can be created on first sign-in:
  explicit `practice_invites`, `practice_domains` auto-join, `practices.join_code`.
- See `03_AUTH_AND_PERMISSIONS.md` for the complete trace and the answers to the
  explicit questions.

---

## 7 · Tenancy model

**Single database, shared tables, `practice_id` foreign key everywhere, RLS as the
isolation boundary.** There is no schema-per-tenant and no tenant id in the JWT.

- `practices` is the tenant root; 12 tables carry `practice_id … on delete cascade`.
- Client reads: `using (is_team() or is_member_of(practice_id))`.
- Client writes: essentially none — every practice-scoped table's write policy is
  `for all using (is_team()) with check (is_team())`. The only client-writable surfaces
  are `notifications.seen` (own practice), `kpi_dashboard_prefs` (own row), and a handful
  of SECURITY DEFINER RPCs (`set_my_name`, `complete_marketing_wizard`,
  `decline_marketing_wizard`, `disconnect_platform`, `join_practice_by_code`, and the
  owner-scoped invite/roster RPCs).
- A user may belong to **many** practices; `profiles.practice_id` is only a
  "default/active practice" pointer and is explicitly healed from memberships at
  `app.js:835`.

---

## 8 · Deployment model

```
git push → main
   ├─ .github/workflows/deploy-pages.yml
   │     scripts/prepare-pages.sh  →  site/   (allow-listed static copy + version.json)
   │     wrangler pages deploy site --project-name=roxium-portal --branch=main
   │     → Cloudflare Pages (production)
   └─ .github/workflows/deploy-functions.yml   (paths: supabase/functions/**)
         supabase functions deploy <each> --no-verify-jwt  → Supabase Edge Runtime

migrations/*.sql   →  ***APPLIED BY HAND in the Supabase SQL editor.*** No CI step.
```

Detail, risks and the exact env/secret list are in `08_DEPLOYMENT_AND_INFRASTRUCTURE.md`.

---

## 9 · Integration model

Two *different* generations of marketing ingestion are live simultaneously:

- **Generation 1 — Coefficient / Google Sheets** (`sync-coefficient`, `sheet_sources`,
  `practices.workbook_sheet_id`). ROXIUM holds a Google service account; each client has
  one master workbook whose tabs are channels. Still fully wired in code and in the
  Team Controls UI.
- **Generation 2 — Composio-brokered OAuth** (`oauth-start`/`oauth-callback`/
  `sync-platforms`, `platform_connections`). ROXIUM owns **no** Meta or Google developer
  app; Composio holds every practice's token, keyed by `user_id = practice_id`.

Both write the same rows into `kpi_monthly` / `kpi_daily` keyed by
`(practice_id, period, source)`, so downstream code cannot tell them apart. The obsolete
first-party OAuth design survives as dead code in
`supabase/functions/_shared/oauth.ts:50` (`providerConfig`) and the unwritten
`platform_tokens` table.

Asana is scaffolded but not scheduled. Zapier/Make/LeadConnector appear **nowhere in
code** — only as suggestions in `README.md` and `ARCHITECTURE.md`.

---

## 10 · Source-of-truth rules

| Concern | Source of truth | Notes |
|---|---|---|
| All product data | Supabase Postgres | no caches, no duplication |
| Schema | `migrations/*.sql` in filename order | `schema.sql` is a **stale snapshot**, see `02_…` |
| Design language | `styles.css` `:root` tokens (`styles.css:1-43`) | `index.html` has a *second, divergent* token block |
| Marketing metrics | `kpi_monthly` / `kpi_daily`, keyed `(practice_id, period, source)` | a `finalized` month is immutable (trigger) |
| Access | `memberships` — **not** `profiles.practice_id` | codified in `afterLogin()` and `lifecycle_fixes.sql` |
| Production build | `scripts/prepare-pages.sh` allow-list | the repo root is never deployed |
| Deployed commit | `/version.json` + the `build <sha>` footer | `showBuildVersion()` `app.js:573` force-reloads on mismatch |

---

## 11 · Important architectural constraints

1. **No build step, no modules, no tests.** `app.js` is one global scope. Any change is
   a whole-file change; there is no tree-shaking, no type checking, and zero automated
   tests for the portal (`12_TESTING_MAP.md`).
2. **The anon key ships to the browser.** This is correct *only* because RLS is complete.
   Any table added without RLS is immediately world-readable.
3. **Migrations are hand-applied.** Code can be deployed that references columns the live
   DB does not have. The codebase defends against this with `try{…}catch(_){}` fail-soft
   blocks in ~10 places (e.g. `app.js:875-890`), which also *hides* real errors.
4. **Composio is a hard dependency** for every self-service connection. No
   `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID` secret ⇒ `oauth-start` returns
   `{ok:true, configured:false}` and the UI degrades to "our team will connect this".
5. **All email is Resend, called directly from Edge Functions** — *except* Supabase's own
   auth emails (magic link / OTP), which Supabase sends itself and which the repo cannot
   configure. See `09_EMAIL_AND_TRANSACTIONAL_COMMS.md`.
6. **A second, unrelated application lives in `bhfa-2027/`** (Next.js 16 + React 19 on
   Railway, its own Supabase project, its own tests). It shares no code or tables.

---

## 12 · Architecture diagram

```
                         ┌───────────────────────────────────────────┐
  Browser                │  Cloudflare Pages  (project roxium-portal)│
  ───────                │   /            index.html   (marketing)   │
                         │   /portal/     index.html + app.js + css  │
                         │   /privacy /terms   static                │
                         │   _redirects: /* → /portal/index.html 200 │
                         └──────────────┬────────────────────────────┘
                                        │ supabase-js (anon key, RLS-enforced)
                                        ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │                        SUPABASE  (single project)                │
        │                                                                  │
        │  Auth ── magic link / 6-digit OTP ── auth.users                   │
        │    │        (signups disabled from browser: shouldCreateUser:false)│
        │    ▼                                                             │
        │  Postgres  practices ─┬─ memberships ── profiles ── auth.users    │
        │   + RLS               ├─ practice_invites / practice_domains      │
        │                       ├─ deliverables · milestones · video_*      │
        │                       ├─ activity · notifications                 │
        │                       ├─ kpi_monthly · kpi_daily                  │
        │                       ├─ sheet_sources  (Gen-1 ingestion config)  │
        │                       └─ platform_connections (Gen-2 OAuth state) │
        │                                                                  │
        │  Storage  bucket 'deliverables'  (per-practice folders)           │
        │                                                                  │
        │  Edge Functions (Deno)                                           │
        │   invite-user · delete-account · notify-client ·                  │
        │   notify-video-ready · weekly-digest · book-demo ─────► RESEND    │
        │   oauth-start ─┐                                                 │
        │   oauth-callback┤────────────────────────────────────► COMPOSIO ─┼─► Meta Ads
        │   sync-platforms┘                                                │   Google Ads
        │   sync-coefficient ──────────────► Google Sheets API ────────────┼─► Coefficient
        │   asana-sync / asana-webhook ────► Asana  (scaffolded, unscheduled)│   workbooks
        └──────────────────────────────────────────────────────────────────┘
                                        ▲
                                        │ GitHub Actions on push to main
        ┌───────────────────────────────┴──────────────────────────────────┐
        │ GitHub  main ── deploy-pages.yml ──► wrangler pages deploy site/  │
        │              └─ deploy-functions.yml ─► supabase functions deploy │
        │        migrations/*.sql ──► ✋ APPLIED BY HAND (no CI step)       │
        └──────────────────────────────────────────────────────────────────┘
```
