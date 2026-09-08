# BHFA 2027 · Scientific Program Planning Room

A live, collaborative working draft of the **Beverly Hills Face Academy 2027 scientific
program**. Founders, scientific chairs and faculty open one private link, type their name,
and edit the agenda directly — no accounts, no admin backend, no publish step.

The product principle: **the agenda itself is the editor.** Nothing on screen looks like
software until a session is touched.

```
Next.js (App Router, TypeScript)   →  Railway
Postgres + Realtime                →  Supabase (server-side only)
Drag and drop                      →  dnd-kit
Source                             →  GitHub
```

---

## Quick start

```bash
npm install
npm run dev
```

With no database configured the app boots on the **in-memory driver**, seeds the full
2027 draft, and prints a collaboration link to the terminal:

```
BHFA 2027 · in-memory driver (no database configured).
Collaboration link: /program/8Kq2…
```

That mode is for local work and tests only — it forgets everything when the process stops.
For anything real, configure Supabase.

---

## Supabase setup (about ten minutes)

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query** → paste all of `supabase/migrations/0001_bhfa_program.sql` → **Run**.
   Every statement is idempotent, so re-running is safe. (`npm run db:migrate` lists the files
   to run and their paths.)
3. Copy `.env.example` to `.env.local` and fill in the values below. `.env.local` is
   gitignored — the secret key must never reach the repository:

   | Variable | Where it comes from | Notes |
   |---|---|---|
   | `SUPABASE_URL` | Project settings → API → Project URL | |
   | `SUPABASE_SECRET_KEY` | Project settings → API keys → secret key (`sb_secret_…`) | **Server only.** Never prefix with `NEXT_PUBLIC_`. A project still on the legacy JWT key can use `SUPABASE_SERVICE_ROLE_KEY` instead. |
   | `COLLAB_TOKEN_PEPPER` | Any long random string you generate once | Mixed into the token hash. Changing it invalidates every existing link. |
   | `PROGRAM_DATA_DRIVER` | `supabase` | Optional; inferred from `SUPABASE_URL`. |
   | `SEED_COLLAB_TOKEN` | — | Optional. Pins a known link in staging. Leave empty in production. |
   | `PORT` | Railway injects it | |

4. Seed the program and issue the first collaboration link:

   ```bash
   npm run db:seed
   ```

   It prints the link **once** — only its SHA-256 hash is stored. Re-running the seed never
   overwrites a day that already has sessions (pass `--force-sessions` if you really want to
   reset a day back to the printed draft).

5. Check what actually landed against the transcribed draft:

   ```bash
   npm run db:verify
   ```

   It compares every day, session, time, type, description and speaker status in the database
   with the 2027 draft and exits non-zero on any mismatch, so it can gate a deploy. It only reads.

6. Need a new link later? `npm run token:issue` — or use **••• → Rotate collaboration link**
   inside the app. The previous link stops working immediately.

---

## Deploying to Railway

1. **New Project → Deploy from GitHub repo**, pick this repository.
2. **Settings → Root Directory:** `bhfa-2027` (this app lives beside the main portal).
3. **Variables:** add `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `COLLAB_TOKEN_PEPPER`.
   Railway provides `PORT` automatically — do not set it yourself.
4. Build and start commands come from `railway.json`:
   - build: `npm ci && npm run build`
   - start: `npm start` (binds `$PORT`)
   - health check: `GET /api/health`
5. Deploy, then run `npm run db:seed` **once** from your machine (with the same `.env.local`)
   to load the program and mint the first link.
6. Open `https://<your-app>.up.railway.app/program/<token>`.

`/` deliberately shows nothing but a note that a link is required, and every page is served
`X-Robots-Tag: noindex`.

---

## How it works

### The time model

Session times are **integer minutes from midnight of that session's own calendar date**
(`start_minute`, `end_minute`) — never `Date` objects, never strings like `"10:30–11:15"`.

- No timezone can move a session onto the wrong day.
- Midnight is representable: the Day 03 White Party ends at exactly `1440`. The editor shows it
  as **12:00 AM** with a **Next day** toggle beside the end time — never `11:59 PM` — and the
  agenda prints it as **Midnight**. Editing any other field leaves the 1440 untouched.
- Duration is always `end − start`, so it can never disagree with the displayed times.
- Anything up to `1740` (5:00 AM the next morning) is accepted for events that run late.

### Smart time changes

Extend a session and the app measures the delta against the last *saved* times, then asks
one question:

> This session is now 15 min longer.
> **[ Shift following sessions +15 min ]  [ Change this session only ]**

Shifting moves every later session on that day by exactly that delta, preserving each
session's own duration, and writes a single history entry that Undo can reverse in one step.

### Conflicts and gaps

Recomputed on every render from the ordered day:

- **Red** — and red appears nowhere else in the interface — for a real overlap
  (`15 MIN OVERLAP`) or an end time at or before the start (`INVALID TIME`). A **Fix**
  action offers: start after the previous session, shift this session and all following, or
  edit manually. The flag disappears the moment the overlap does.
- **Amber**, advisory only, for an unscheduled gap (`45 MIN UNSCHEDULED GAP`). Deliberate
  evening spacing — the faculty dinner, the White Party — is never flagged.

### Realtime, without a key in the browser

The browser never receives a Supabase key. Each browser opens a token-authenticated
**SSE stream**; the server subscribes to Supabase Realtime on its behalf and relays
mutations and presence. Broadcasts also travel over a Supabase channel, so several Railway
instances stay in sync. A browser ignores the echo of its own change (already applied
optimistically).

### Collaboration and safety

- **Identity** — a name in `localStorage`. Not authentication; it labels history entries and
  powers "Marc is editing".
- **Autosave** — 650 ms after typing stops, and immediately when the editor closes. It writes
  only the fields you actually touched, so a change arriving from another collaborator can
  never turn into an automatic save of your stale copy. A transient failure keeps the change
  on screen and says so in plain language.
- **Two people, one session** — fields you have not touched update live in your open editor.
  If your save does land on a newer version (you were offline, or you were both typing in the
  same field), the write still goes through — your typing is never thrown away — and an amber
  notice names who changed it, shows *theirs* beside *yours* field by field, and offers
  **Use their version** in one click. Both versions stay in the change history.
- **History** — every mutation records actor, action, summary and the prior state. Restoring
  writes a *new* entry; nothing is ever deleted from the record.
- **Undo** — one tap on the toast for deletes, cross-day moves and bulk shifts.

---

## Security model

The requirement is explicit: *anyone with the secret link may edit*. Within that:

- Tokens are 32 random bytes (base64url, 43 chars) — never sequential, never derived.
- Only `sha256(pepper + token)` is stored, so a database dump yields no working links.
- Every request re-validates the token server-side; an unknown or rotated link is a 404 that
  reveals nothing about the program.
- All database access happens inside route handlers with the server-side secret key. RLS is
  enabled on every table with **no policies**, so anon/authenticated access is denied outright.
  A publishable or anon key in the server slot is refused at boot rather than quietly reading
  back an empty programme.
- Inputs are validated and sanitised (control characters stripped, lengths capped, enums
  checked, sponsor links restricted to `http(s)`).
- Mutations are rate limited per address; CSP, `X-Frame-Options: DENY`, `noindex` and friends
  are set in `next.config.ts`.
- No debug or reset endpoints exist. `/api/health` reports liveness only.

---

## Tests

```bash
npm test        # 94 unit + integration tests (Vitest)
npm run test:e2e  # the full two-browser acceptance workflow (Playwright)
npm run typecheck
```

`tests/` covers the time model, conflict and gap detection, bulk shifting, ordering, the
full route-handler surface (including token rejection, history, undo and realtime
broadcast), input validation, and the interface itself — that the agenda shows no form
fields until a session is touched, that a blank sponsor renders nothing at all, and that
internal notes never reach the agenda.

`e2e/collaboration.spec.ts` runs the whole acceptance script in two browsers: drag to
reorder, live speaker change, extend a session and choose "change this session only",
watch the next session turn red, fix it by shifting, add and remove a sponsor, drag a
session onto another day, refresh, read the change history, restore, and confirm both
browsers agree.

---

## Project layout

```
app/
  program/[token]/       the planning room (server-validated token)
  api/program/[token]/   snapshot, sessions, reorder, shift, history, presence, stream, rotate
components/              header, day selector, agenda, session row, in-place editor, panels
lib/
  domain/                time model, conflict + gap analysis, ordering — pure and unit tested
  data/                  repository interface + supabase and memory drivers
  server/                tokens, validation, rate limiting, realtime relay, program service
  seed/                  the 2027 draft, transcribed from the chair-review PDF
  client/                identity, API client, room state
supabase/migrations/     schema
scripts/                 migrate, seed, issue-token
```

---

## Design

The palette, type and rhythm come from the BHFA brand kit and the printed draft: warm ivory
`#F4EEDF`, dark olive `#393F1E`, one acid accent `#A5A526`, hairline rules, large day
numerals, and a great deal of air. Superclarendon, Lenia Mono and Inclusive Sans are named
first in every font stack and render natively where licensed; self-hosted equivalents
(Bitter, IBM Plex Mono, Inclusive Sans) guarantee the same rhythm everywhere else. No
external font or script is fetched at runtime.

Mobile is first class: one-line masthead, swipeable day selector, 44 px touch targets, 16 px
inputs so iOS never zooms, and a long-press drag that leaves normal scrolling alone.
