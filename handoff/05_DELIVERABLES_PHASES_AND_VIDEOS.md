# 05 · Deliverables, Phases & Videos

---

## 1 · The object model

| Concept | Table | Notes |
|---|---|---|
| **Phase** | *not a table* — `deliverables.phase` free text | e.g. `'Phase 2 · Video & Authority'`. Order = `parsePhaseNum()` then `phase_order` then label (`comparePhaseNames`, `app.js:2894`) |
| **Deliverable** | `deliverables` | `promised → in_progress → delivered`; `due date`; `status_since` (trigger-stamped); `delivered_at` |
| **Milestone** | `milestones` | `done / current / upcoming`; `target_date`; `completed_on` (trigger-stamped); `status_manual` |
| **Video asset** | `video_pipeline` | 7 DB stages folded into 5 display stages; `stage_since`, `planned_shoot_date`, `blocked`/`blocked_reason` |
| **Stage history** | `video_history` | written by triggers, forward moves only |

`seed_practice()` creates 34 deliverables across `Phase 0 · Intelligence` …
`Phase 6–7 · Retainer`, 4 milestones dated `kickoff + 21/35/42/49` days, and 10 videos
in `planned`.

---

## 2 · Phase deadline logic — **already sequential, and it already matches the spec**

`PHASE_TIMING` (`app.js:4352-4359`):

| Phase | `warn` (yellow) | `red` | Spec asked for | Match? |
|---|---|---|---|---|
| 0 | 7 d | 14 d | yellow @1 wk, red @2 wk | ✅ |
| 1 | 11 d | 21 d | yellow @1.5 wk (10.5 d), red @3 wk | ✅ (rounded up) |
| 2 | 152 d | 182 d | yellow @5 mo, red @6 mo | ✅ |
| 3 | 30 d | 60 d | yellow @1 mo, red @2 mo | ✅ |
| 4 | 30 d | 60 d | ✅ |
| 5 | 30 d | 60 d | ✅ |
| 6, 7 | *absent* | *absent* | no timing logic | ✅ (`Phase 6–7 · Retainer` parses to `6`, which has no rule) |

`computePracticePhaseState(practice, delivs)` (`app.js:4380-4432`) is a proper sequential
state machine:

```js
prevCompleteAt = practice.go_live ?? null
for each phase group in order:
    if no items            → state 'complete'
    else if all delivered  → state 'complete';
                             prevCompleteAt = max(delivered_at of this phase)   // anchor advances
    else if first incomplete → state 'current'  ← THE ONLY PHASE WITH A LIVE CLOCK
        phaseStart = prevCompleteAt ?? (go_live ?? practice.created_at)
        active = items where status !== 'promised'
        if active.length: phaseStart = min(active[].status_since)
        days = floor((now - phaseStart) / 86400000)
        health = days >= rule.red ? 'red' : days >= rule.warn ? 'yellow' : 'green'
    else                   → state 'upcoming'   (no clock, green)
```

**So the "all phases age simultaneously" bug is fixed in the current code.** The
`docs/PLATFORM_AUDIT.md` P0 #2 that describes it is historical; the fix landed with the
explanatory comment at `app.js:4373-4379`.

### Where the phase clock actually starts — and two real defects

1. **`phaseStart` is *overwritten*, not floored, by `min(status_since)` of active items.**
   ```js
   let phaseStart = prevCompleteAt || fallbackStart;
   const active = g.items.filter(d => d.status !== 'promised');
   if (active.length) { ...; phaseStart = new Date(Math.min(...starts)); }   // replaces
   ```
   If a phase has been running for three weeks and *every* touched item is later set back
   to `promised` except one that was just moved to `in_progress` today, `status_since`
   for that one item is today → `phaseStart = today` → `days = 0` → the phase goes green.
   **Editing a deliverable's status can reset its phase's overdue clock.**
2. **The anchor only advances on `delivered_at`.** A phase completed by an import or a
   direct SQL update with `delivered_at = null` leaves `prevCompleteAt` where it was, so
   the *next* phase's clock starts from an older date and can be born red.
3. **`fallbackStart` uses `practice.created_at`** when `go_live` is null — but
   `loadOperationsData()` does select `created_at` (`app.js:5274`), so this works; it is
   only wrong in the sense that "when we created the row" ≠ "when the engagement started".

### Where phase health is consumed
- `buildOpsAlerts()` (`app.js:4485-4491`) → `Phase overdue` / `Phase approaching deadline`
  with detail `"<phase> · <n> days in phase"`.
- `computeClientHealth()` (`app.js:4455`) → −30 for red, −12 for yellow.
- **Never shown to the client.** `ppPhaseCard()` (`app.js:2984`) passes `attn=false` and
  derives its pill from `phaseStateOf(g)` (a pure done/total calculation), not from
  `PHASE_TIMING`. Phase deadline state is a purely internal signal today.

---

## 3 · Deliverable deadlines, warning and overdue states

Three **different** overdue calculations exist for the same data:

| # | Where | Code | Comparison |
|---|---|---|---|
| A | `delivAttention()` `app.js:2938` | `due = new Date(x.due); due.setHours(23,59,59,999); return due < now` | **UTC-parsed** date, then pushed to end of **local** day |
| B | `buildOpsAlerts()` `app.js:4497` | `daysLeft = Math.ceil((new Date(d.due) - Date.now())/86400000)` | **UTC-parsed** midnight |
| C | `renderOpsClientDetail()` `app.js:5005`, ops exec cards `app.js:5117`, `computeClientHealth` `app.js:4461` | same `Math.ceil(...)` / `new Date(d.due) < new Date()` | **UTC-parsed** midnight |

Meanwhile **display** uses `fmtDate()` (`app.js:3432`), which explicitly appends
`'T00:00:00'` for ≤10-character strings → **local** midnight, and **milestones** use
`new Date(m.target_date + 'T12:00:00')` (`app.js:4576`) → **local noon**.

**`new Date('2026-09-16')` is parsed as UTC midnight** per ES spec; `new Date('2026-09-16T00:00:00')`
is parsed as local. In America/Los_Angeles (UTC−7) the first lands on **Sep 15, 17:00
local**. So the same due date is simultaneously "Sep 16" in the table and "Sep 15
evening" in the arithmetic. That is a guaranteed off-by-one for part of every day, in the
overdue direction, for deliverables and videos but **not** for milestones.

### Severity tiers (`buildOpsAlerts`, `app.js:4496-4503`)
```
daysLeft <  0  → red    'Deliverable overdue'
daysLeft <= 7  → yellow 'Deliverable due tomorrow' (if daysLeft<=1) else 'approaching deadline'
daysLeft <= 14 → green  'Deliverable upcoming'
else           → not flagged
```

---

## 4 · Videos

### Stage model
DB: `planned · scheduled · pre_production · shot · editing · delivered · posted`
(`STAGES`, `app.js:139`).
Display: 5 groups — `planned, scheduled, shooting (pre_production+shot), editing,
delivered (delivered+posted)` (`VIDEO_STAGES` / `STAGE_GROUP`, `app.js:3471-3478`).
The stage picker writes back the canonical value (`shot`, `delivered`), so moving a video
to "Shooting" always writes `shot` and **`pre_production` can never be set from the UI**.

### Age / SLA — `daysIn()` + `slaState()` (`app.js:3438-3445`)
```js
daysIn(stage_since) = max(0, floor((now - stage_since)/86400000))
slaState(since, isFinal) = !isTeamView()||isFinal||!since ? '' : d>=7 ? 'overdue' : d>=3 ? 'warn' : ''
```
This is a **time-in-stage** SLA (a flat 3/7-day rule for every stage), not a due date. It
is team-only and drives the `Nd` age chip and the ops "Videos overdue" tile.

### Due date — `planned_shoot_date`
Used by `buildOpsAlerts` (`app.js:4512-4520`) and `renderOpsClientDetail`
(`app.js:5021-5023`) with exactly the deliverable tiers, and by the client
"Next video" line (`app.js:1361`).

**But nothing in the Video tab can set it.** `openVideoDetail()` (`app.js:3653-3823`)
offers name, description, assignee, **`stage_since` ("date entered <stage>")**, blocked
reason, video URL, comments and history — there is **no `planned_shoot_date` field**. The
only editor is the shoot-date `<input type="date">` inside the Operations → client-detail
video table (`app.js:5030`). Seeded videos have `planned_shoot_date = null`, so **by
default no video is ever flagged overdue by due date** — only by the 3/7-day
time-in-stage SLA. That is precisely the reported "video due dates don't match
deliverable behaviour".

### Blocked / waiting on client
`blocked` + `blocked_reason` are set from the detail modal. Rendering:
- team: `⚑` with the reason as a tooltip (`app.js:3512`);
- client: `⚑ Needs your input` chip (`app.js:3540`) and an explicit
  "*"X" is waiting on you — <reason> · N days*" line in the Overview "What needs you"
  column (`app.js:1333-1337`);
- ops alert only after **7 days** (`app.js:4523-4527`), red at 14.
This is the clearest waiting-on-client signal in the product.

---

## 5 · "Everything says 1 day" — the candidate causes

I could not reproduce a runtime state, so these are ranked by how directly the code
produces the symptom.

1. **`daysLeft <= 1` collapses "due today" and "due tomorrow" into one label, and drops
   the count.** `app.js:4499` and `:4515`:
   ```js
   else if (daysLeft <= 7) { severity='yellow'; title = daysLeft<=1 ? 'Deliverable due tomorrow' : '…'; }
   const detail = `${d.name}${daysLeft<0 ? ` · ${…} overdue` : daysLeft<=1 ? '' : ` · ${daysLeft} days left`}`;
   ```
   An item due **today** produces `daysLeft = 0` (or `-0`, which fails the `< 0` test) and
   is therefore titled **"due tomorrow"** with no day count. Every item due today *or*
   tomorrow reads identically as a one-day item. **This is the most likely source.**
2. **The UTC/local parsing split (§3)** shifts `daysLeft` by one for part of every day,
   so a batch of items with different real due dates can converge on the same displayed
   number near the boundary.
3. **Bulk-seeded rows share one timestamp.** `seed_practice()` inserts all 34 deliverables
   and all 10 videos in one statement, so every `status_since`/`stage_since` is identical
   and every age chip shows the same `Nd`. After a "Reset all data" (`app.js:6380`), every
   video's `stage_since` is explicitly set to `new Date().toISOString()` — all identical.
4. **`Math.ceil` on a negative fraction yields `-0`**, which is `!== < 0`, so a just-passed
   deadline reads `0`/"due tomorrow" rather than "1 day overdue".

The clean fix for all four is one shared helper — parse `YYYY-MM-DD` at local noon
(as milestones already do), compute whole-day differences from local midnight, and label
`-n / 0 / 1 / n` as *"n days overdue" / "due today" / "due tomorrow" / "n days left"*.

---

## 6 · Completion logic & activity creation

### Deliverable completion — `updateDeliverableStatus()` (`app.js:3355`)
```
update deliverables {status, delivered_at: status==='delivered' ? now : null}
 if newly delivered:
   notifyClient('deliverable', `Deliverable completed: <name>.`, {email:false})
     → INSERT notifications  (no activity row: notifyClient skips the feed for this exact prefix)
   if every item in the phase is now delivered:
     notifyClient('deliverable', `Phase "<phase>" is complete …`, {email:true})
       → INSERT notifications + INSERT activity + POST notify-client (Resend)
 autoAdvanceMilestones()
 loadAll()
```
The ops-dashboard twin is `updateOpsDeliverable()` (`app.js:4734-4755`) — same
notifications, same phase check.

### Milestone auto-advance — `autoAdvanceMilestones()` (`app.js:3373`)
Recomputes `pct = delivered / total` from a **fresh** query, builds even thresholds
`[0, 25, 50, 75]` for 4 milestones, sets everything below the frontier `done`, the
frontier `current`, the rest `upcoming`, **skipping any milestone with
`status_manual = true`**. Emits a `milestone` notification (with email) on each change.
`milestoneDisplayStatusMap()` (`app.js:3831`) then normalises labels so an earlier
milestone can never read "Up next" after the roadmap has moved past it.

⚠ The first threshold is `0`, so with zero deliverables delivered the first milestone is
already `current` — intended, but it means `Milestone I` is never "upcoming".

### Video completion
Handled entirely by DB triggers: `log_video_stage()` restamps `stage_since`, auto-fills
`shot_date`/`posted_date`, and logs forward moves into `video_history`;
`notify_video_stage()` writes one de-duplicated `notifications` row per video (skipping
`planned`). `notify-video-ready` sends the Resend email when a finished URL is posted.

### The client update feed — `buildEngagementTimeline()` (`app.js:2214`)
Merges four sources in memory (no table):
- `activity` rows (team posts and `source='comment'`), de-duplicating legacy
  "Deliverable completed: X" rows against real delivered deliverables;
- `deliverables` where `status='delivered' && delivered_at` → `✓ Delivered`;
- `milestones` where `status='done' && completed_on` → `Milestone`;
- `video_history`, **skipping `planned` and skipping each video's first row** (the backlog
  seed), mapping `delivered`/`posted` to `✓ Delivered` and everything else to an Update.

Sorted newest-first, capped at 80 (or 300 in History view).

---

## 7 · Client-facing gaps in this area

- **Deliverables are not clickable.** `ppPhaseCard()` (`app.js:2984-3007`) renders name +
  status only. `deliverables` has **no `link_url` column** (only `milestones` does). This
  is a schema + UI change, not a UI-only one.
- **Clients never see due dates, overdue state, or phase health.** `delivStatusMeta` is
  called with `attn=false` in the client renderer (`app.js:2998`) — deliberate, per the
  code comments, but it means a client cannot see *when* something is promised.
- **No completion animation.** `styles.css` has a motion layer
  (`--dur-*`, `--ease-spring`, `ov-pulse`, `deeplinkpulse`, `ops-tile-pulse-*`) and
  `dsCountUp()` (`app.js:1076`) animates stat tiles, but nothing celebrates a delivery.
