# Product Decisions

A running log of product-requirement decisions that future implementation passes
must follow. Newest first.

Each entry is **binding on future work**. Where an entry contradicts something in
`handoff/`, this file wins and the handoff file has been corrected to point here.

---

## PD-005 · Video dates
**Decided:** 2026-09-15 · **Status:** binding, not yet implemented

**Shoot date** — one exact event date, **shared**. A shoot is an event both sides
attend, so there is no internal/client split and no buffer: the surgeon has to be
there on the day. Existing field `video_pipeline.planned_shoot_date` already
models this correctly; it needs an editor in the Video tab
(`handoff/10_…` R-09), not a new column.

**Video delivery** — follows the deliverable model in PD-001/PD-002 exactly:
an internal target date, a client expected delivery date, and On Track / At Risk
/ Overdue computed internally. The client sees one expected delivery date.

Supersedes PD-001 open point **B**.

---

## PD-004 · Milestones keep month/period granularity
**Decided:** 2026-09-15 · **Status:** binding — no change required

Milestones are **directional**, not promised deliveries. They may continue to
show a broader month or period ("Planned Mar 2026"), which is what
`prettyDate(d,'month')` already renders (`app.js:129`).

PD-001's single-exact-date rule applies to **promised deliverables**, not to
roadmap milestones. **No work is required for this decision** — current behaviour
is already correct.

Supersedes PD-001 open point **A**.

---

## PD-003 · Client visibility, enforced at the data layer
**Decided:** 2026-09-15 · **Status:** binding, not yet implemented

Clients **must not** see:

- the internal target date
- the **At Risk** status (team-only)
- internal warning thresholds (phase timing, video SLA)

> **This must be enforced at the DATA ACCESS layer, not in the UI.** A client user
> must not be able to retrieve an internal target date through the Supabase API.

`deliverables` has a single **row**-level read policy
(`using (is_team() or is_member_of(practice_id))`). Postgres RLS is row-level, so
a practice member can read every column of their own rows straight from PostgREST
with the public anon key. Not rendering a column is **not** protection.

**Required approach** — a client-safe view:

1. Create a view (e.g. `client_deliverables`) exposing only client-appropriate
   columns: id, practice_id, phase, name, status, `client_expected_date`,
   `delivered_at`, sort, description. **Not** the internal target.
2. Move the member read policy onto that view; **remove member SELECT from the
   base table** so `deliverables` becomes team-only.
3. Point the client frontend at the view.

Chosen over column-level `REVOKE` because a view is explicit, reviewable, and
testable with a single query. Chosen over a separate table because it needs no
data migration and no dual-write.

**Acceptance test (required, not optional):** authenticate as a seeded client
fixture and `select *` from every client-reachable relation; assert no internal
target date is returned. A UI assertion does not satisfy this decision.

Supersedes PD-001 open point **C** and firms up PD-001 Constraint 1.

---

## PD-002 · Delivery status thresholds
**Decided:** 2026-09-15 · **Status:** binding, not yet implemented

Team-side status is computed from two dates:

| Status | Condition |
|---|---|
| **On Track** | the current date has **not** passed `internal_target_date` |
| **At Risk** | `internal_target_date` has passed, `client_expected_date` has **not** |
| **Overdue** | `client_expected_date` has passed |

**Overdue therefore means an actual client commitment was missed.** At Risk is the
buffer doing its job and is team-only (PD-003).

This confirms the interpretation PD-001 flagged as needing confirmation; that
flag is resolved.

**Implementation notes**
- Both comparisons are date-only, at day granularity, in a single consistent
  timezone. The current code parses `YYYY-MM-DD` as UTC midnight while rendering
  it as local (`handoff/10_…` R-07), which would make these thresholds flip a day
  early. **Product Pass 2 must land first.**
- A delivered item is neither At Risk nor Overdue regardless of dates.
- If `client_expected_date` is null, the item has no client commitment: it can be
  On Track or At Risk, never Overdue.

---

## PD-001 · Client-facing delivery dates are a SINGLE date, never a range
**Decided:** 2026-09-15 · **Status:** binding, not yet implemented
**Applies to:** Product Pass 6 (client UX) and any future delivery-date work

### The rule

Clients see **one clear expected delivery date**. No ranges, no windows, no
approximations.

```
✗ OLD   Expected delivery: Sep 20–22
✗ OLD   Expected delivery: expected this month
✓ NEW   Expected delivery: Sep 22
```

ROXIUM keeps a **separate, earlier internal target date** as operational buffer.

| Surface | Shows |
|---|---|
| **Client view** | `Expected delivery: Sep 22` |
| **ROXIUM team view** | `Internal target: Sep 19`<br>`Client expected delivery: Sep 22`<br>`Status: On Track / At Risk / Overdue` |

**The internal target date is never exposed to the client** — not in the UI, not
in an email, not in an API response. See *Constraint 1* below: this is harder
than hiding it in the UI.

### Where this stands today (verified, 2026-09-15)

- **No code renders a date range anywhere.** There is nothing to remove — this is
  a requirement for work not yet built, not a correction to shipped behaviour.
- **Clients currently see no deliverable dates at all.** `ppPhaseCard()`
  (`app.js:2984`) renders name + status only; `delivStatusMeta` is called with
  `attn=false` so no overdue signal reaches the client.
- **`deliverables.due` is already a single date**, and is already internal-only.
  It drives every internal alert: `delivAttention()` (`app.js:2938`),
  `buildOpsAlerts()` (`app.js:4497`), `renderOpsClientDetail()` (`app.js:5005`),
  `computeClientHealth()` (`app.js:4461`).
- **The only imprecise client-facing dates are milestones**, rendered at month
  granularity — `prettyDate(d,'month')` → `"Mar 2026"` (`app.js:129`, used at
  `app.js:1354-1355`, `3901-3902`, `3955`). See *Open point A*.

### Recommended field mapping (for the implementation pass)

Keep `deliverables.due` as the **internal target**; add a **new** column for the
client-facing date.

| Field | Meaning | Visible to |
|---|---|---|
| `deliverables.due` *(existing)* | internal target — the operational buffer date | team only |
| *new column, e.g.* `client_expected_date` | the single date the client is promised | client + team |

**Why this direction and not the reverse:** every existing `due` value was
entered as an internal date that no client has ever seen. Re-labelling `due` as
client-facing would silently convert the entire existing backlog into
client-visible promises — including dates already missed. Adding a new,
initially-null column means a client sees an expected delivery date only once
someone deliberately sets one. It also leaves all existing internal alert logic
untouched.

### Status semantics — **confirmed, see PD-002**

The three statuses were specified; their thresholds were not. The reading that
makes the buffer meaningful:

| Status | Condition |
|---|---|
| **On Track** | today ≤ internal target |
| **At Risk** | past internal target, on or before client expected delivery |
| **Overdue** | past client expected delivery |

Under this reading "Overdue" means a promise to the client was actually broken,
and "At Risk" is the buffer doing its job. **Confirm before implementing** — the
alternative (Overdue keyed to the internal target) would make the team view red
while the client is still within their promised date.

### Constraints the implementation must respect

**Constraint 1 — hiding the internal target in the UI is not sufficient.**
`deliverables` has a single row-level read policy:
```sql
create policy "read deliv" on deliverables
  for select using (is_team() or is_member_of(practice_id));
```
Postgres RLS is **row**-level, not column-level. Any practice member can read
every column of their own practice's deliverables straight from the REST API
with the public anon key — so simply not rendering the internal target would
still leak it. Satisfying *"do not expose the internal target to the client"*
requires one of:

1. a **client-safe view** (e.g. `client_deliverables`) exposing only
   client-appropriate columns, with the client read policy moved to it and
   removed from the base table;
2. **column-level privileges** — `revoke select (due) ... from authenticated`
   plus a grant on the remaining columns; or
3. moving internal scheduling fields to a **separate team-only table**.

Option 1 is the most conventional and the easiest to verify with a test. This is
a security requirement, not a presentation detail — it must be settled before any
client-facing date ships.

**Constraint 2 — fix the date arithmetic first.** Deliverable dates are currently
parsed as UTC midnight while being rendered as local (`handoff/10_…` R-07), and
"due today" is labelled "due tomorrow" (R-08). Showing a client a date that is
off by one is worse than showing nothing. **Product Pass 2 must land before this
becomes client-visible.**

**Constraint 3 — no overdue flag to the client.** The client sees the expected
delivery date. Whether a *late* item is visibly marked late to the client is a
separate decision and is **not** authorised by this one.

### Open points — **all resolved 2026-09-15**

| Point | Resolution |
|---|---|
| A · Milestone granularity | **PD-004** — milestones keep month/period granularity; no change required |
| B · Video dates | **PD-005** — shoot date is one shared exact date; video *delivery* follows this model |
| C · Is "At Risk" client-visible? | **PD-003** — no, team-only, enforced at the data layer |
| Status thresholds | **PD-002** — On Track / At Risk / Overdue confirmed as recommended |

### Implementation scope, when authorised

1. Migration: add the client-facing date column **and** the chosen isolation
   mechanism from Constraint 1.
2. Team UI: two date fields, clearly labelled internal vs client, plus the
   three-state status.
3. Client UI: one line — `Expected delivery: <date>` — and nothing else new.
4. Tests: a client fixture must be **unable to read the internal target through
   the API**, not merely unable to see it on screen.

**Not authorised by this decision:** any change to phase timing thresholds,
video SLA rules, the Operations dashboard, or notifications.
