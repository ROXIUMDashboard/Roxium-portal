# 06 · Notifications & Attention

Three **separate, unconnected** systems share the word "notification":

| System | Audience | Storage | Lifecycle |
|---|---|---|---|
| **A · Client notifications** | practice members | `notifications` table | `seen` boolean, server-side |
| **B · Ops Needs-Attention queue** | ROXIUM team | **computed at render time**, never stored; only the *user's dismiss/snooze/pin/order* persists in `profiles.ops_attention_state` | per-team-user |
| **C · Updates "new" badge** | whoever is looking at a practice | pure `localStorage` timestamp | per-browser |

---

## A · Client notifications (`notifications` table)

### What creates a row — the complete list

| Event | Writer | Kind | Email? |
|---|---|---|---|
| KPI month first inserted | trigger `trg_notif_stats` → `notif_stats()` | `stats` | no (in-app only) |
| Video stage change (any forward move except `planned`) | trigger `trg_notify_video_stage` → `notify_video_stage()` | `video` | no; a separate `notify-video-ready` call sends the posted-video email |
| Deliverable marked delivered | `notifyClient()` from `updateDeliverableStatus` (`app.js:3360`) and `updateOpsDeliverable` (`app.js:4748`) | `deliverable` | **no** (`{email:false}`) |
| **Whole phase** completed | same, `app.js:3363` / `:4751` | `deliverable` | **yes** |
| Milestone becomes current / done (auto-advance) | `autoAdvanceMilestones()` `app.js:3396-3397` | `milestone` | yes |
| Milestone renamed/edited or status changed by hand | `openMilestoneEditor` `app.js:4076`, `updateMilestoneStatus` `app.js:4171` | `milestone` | yes |

### What does **not** create a notification
- **A failed sync of any kind.** Neither `sync-platforms` nor `sync-coefficient` writes to
  `notifications`; failures live only in `platform_connections.last_error` /
  `sheet_sources.last_error` and surface as computed ops alerts.
- **A broken or revoked marketing connection.**
- **An overdue deliverable, video or milestone.**
- **A new account awaiting approval**, an invite sent, an invite accepted, a member
  removed, or access revoked.
- **A team-posted update.** `postUpdateFromFeed()` (`app.js:2392`) inserts into `activity`
  only — so a brand-new client-facing update produces **no notification row and no
  attention indicator** on the client's side. (It *does* bump the sidebar Updates count,
  system C.)

So the reported "notifications may only cover videos" is close to right: videos are the
only *automatic, DB-driven* stream. Deliverable/phase/milestone completions do write
rows, but only through the team's own UI actions.

### Scope
Rows are **per practice**, never per user. Every member of a practice sees the same
notification list and `seen` is a **shared** flag — one member dismissing marks it seen
for everyone. There are no team-facing notification rows at all.

### Read / dismiss
- `loadAll()` fetches the newest 10 (`app.js:869`).
- `updateNotifDot()` (`app.js:713`) toggles `#tbNotifDot.hidden` on `unseen <= 0` — the
  **dot already disappears entirely when empty**, exactly as wanted. The bell button
  itself is always rendered.
- `renderNotifPop()` (`app.js:717`) lists up to 20 unseen with per-item ✕ and "Clear all".
- `dismissNotif()` / `clearAllNotifs()` (`app.js:728`, `:733`) update optimistically then
  `update {seen:true}` — permitted by the `client seen` RLS policy.
- `renderBanner()` (`app.js:4213`) shows the newest unseen as a dismissible top banner in
  the client view; dismissing marks **all** current unseen as seen. `stats` banners
  re-derive their month from the latest real KPI period so a bad stored message
  self-corrects.
- **There is no pulse on the bell.** `.tb-dot` (`styles.css:1543`) is a static gold dot.
  Pulse animations exist elsewhere (`ov-pulse`, `ops-tile-pulse-red/amber`,
  `.sb-sync-dot.dot-syncing`) but are not applied to the topbar indicator.
- There is **no snooze and no pin** for client notifications — those exist only in system B.

### Dedupe
Only videos dedupe: `notify_video_stage()` deletes prior rows with the same
`(practice_id, kind='video', ref=<video id>)` before inserting. Deliverable, milestone and
stats rows accumulate. `notifications.ref` is `text` with no FK.

---

## B · Ops "Needs attention" queue

### Generation — `buildOpsAlerts()` (`app.js:4480-4586`)
Recomputed from `opsData` on every render; nothing is stored. Per practice it emits:

| Alert | Severity rule | Source |
|---|---|---|
| Phase overdue / approaching deadline | `PHASE_TIMING` via `computePracticePhaseState` | `deliverables` |
| Deliverable overdue / due tomorrow / approaching / upcoming | `<0` red · `≤7` yellow · `≤14` green | `deliverables.due` |
| Video overdue / due tomorrow / approaching / upcoming | same tiers | `video_pipeline.planned_shoot_date`; skipped entirely for `delivered`/`posted` |
| Waiting on client approval | `≥7 d` yellow, `≥14 d` red | `video_pipeline.blocked` + `stage_since` |
| KPI sync failed | red | `sheet_sources.last_status='error'` |
| KPI sync stale | yellow (>26 h) | `sheet_sources.last_synced_at` |
| Access request pending / aging — escalate | `≥3 d` yellow, `≥7 d` red | `sheet_sources.access_status='requested'` |
| Access granted — finish wiring | yellow | `access_status='granted'` + no sync |
| Connection failed | red | `platform_connections.status in (error,revoked)` |
| Connection needs attention | yellow | `platform_connections.last_error` |
| Milestone overdue / approaching | `<0` red, `≤7` yellow | `milestones.target_date` |

**Not generated:** pending account approvals. `loadOperationsData()` fetches
`get_pending_accounts()` into `opsData.pendingAccounts` (`app.js:5292-5296`) and then
**never reads it** — the card was deliberately removed (commit `bdd5b54`). It is a dead
query today and a one-line reinstatement when wanted.

### Identity, sort and ordering
- `opsAlertId(a)` (`app.js:4587`) = `practiceId|linkView|title|delivId|videoId|milestoneId|phase|srcKey`
  joined by `|`. **The `title` is part of the id**, so an alert that changes tier (e.g.
  "approaching deadline" → "overdue") gets a **new id** and any dismiss/snooze/pin on the
  old one is silently dropped. That is arguably correct (re-surface on escalation) but it
  also means a pin never survives escalation.
- `defaultAlertSort` (`app.js:4590`): severity rank (`red 0 · yellow 1 · green 2`), then
  fewest days, then practice name. Pinned items float to the top; a user-defined `order`
  array overrides.
- `prepareOpsAttentionList()` (`app.js:4593`) garbage-collects dismissed/snoozed/pinned/
  order entries whose alerts no longer exist, then persists.

### Dismiss / snooze / pin / reorder — `opsAttentionState`
```js
{ dismissed: Set<id>, snoozed: { id: ISO }, pinned: [id], order: [id]|null }
```
- **Dismiss** is permanent for that team user until the alert id disappears and returns.
- **Snooze** = `snoozeUntilTomorrow()` (`app.js:4270`) → next local midnight;
  `getOpsAlertUiState()` expires it lazily on read.
- **Pin** floats to top; **drag** writes an explicit `order` array.
- Dismissed and snoozed items are **still rendered**, muted, with `Restore` / `Resume`
  buttons (`renderOpsAlertItem`, `app.js:4759`) — nothing is truly hidden.

### Persistence and the localStorage fallback
- Server: `profiles.ops_attention_state jsonb` via `get_my_ops_attention_state()` /
  `set_my_ops_attention_state()` (team-only, SECURITY DEFINER).
- Local: `localStorage['roxium_ops_attention_v2']`, with a read-through fallback to the
  older `roxium_ops_attention_v1` key.
- `saveOpsAttentionState()` (`app.js:4303`) always writes localStorage, then debounces the
  RPC by 450 ms; RPC errors matching `/does not exist|not find/` are swallowed so a
  pre-migration DB degrades silently.
- `initOpsAttentionState()` (`app.js:4318`): if the server copy is empty and the local
  copy is not, the **local copy wins and is pushed up**; otherwise the server wins and
  overwrites local. On a shared browser this means one team member's dismissals can be
  promoted into another's server state on first load.

### Visual urgency
`.ops-alert-red .ops-alert-tile` and `.ops-alert-yellow .ops-alert-tile` carry
`ops-tile-pulse-red` (1.6 s) / `ops-tile-pulse-amber` (2.4 s) expanding-ring animations
(`styles.css:435-441`). Green does not pulse. Muted (paused/dismissed) rows lose the
animation. A global `prefers-reduced-motion` block (`styles.css:45-47`) kills all of it.
**So "subtle pulsing only when attention exists" is already true on the ops dashboard —
just not on the client-side bell.**

---

## C · Updates feed & its badge

`buildEngagementTimeline()` (`app.js:2214`) merges `activity` + delivered `deliverables` +
done `milestones` + `video_history` in memory; see `05_…` §6.

`renderUpdates()` (`app.js:2303`) buckets by local day boundaries:
- **Pinned** (`activity.pinned`) — always first;
- **Today**, **Yesterday** — newest 5 each in summary mode;
- **This week** — `.filter(e => e.important)` then 5 (`classifyUpdate()` at `app.js:2206`
  marks connection/sync/milestone/delivery text important; comments and minor video moves
  are not);
- **Earlier** — only in History mode (`updHistBtn` toggles `updatesHistory`, raising the
  fetch cap from 120 to 300 events).

**This already matches the requested Today / Yesterday / This week (short, important
only) / History model.** Team retains compose, edit, delete and pin
(`postUpdateFromFeed`, `editFeedItem`, `togglePinUpdate`, `app.js:2392-2404`); pin
requires the `activity.pinned` column and the error handler names the migration if it is
missing.

### The badge
`renderUpdatesBadge()` (`app.js:2407`):
```js
seen  = +localStorage['roxium_updates_seen_' + practiceId] || 0
floor = max(seen, now - 7 days)          // never look back more than a week
n     = buildEngagementTimeline(120).filter(e => e.t > floor).length
```
`markUpdatesSeen()` is called from `showView('updates')`, so opening the tab clears it.
Counts **every** new item, not only important ones (deliberate, per the comment).

Limitations: purely per-browser, so it does not follow a user across devices; a fresh
browser always shows up to a week of "new"; and it is not an attention *indicator* in the
sense of "something needs you" — it is a recency counter.

`renderConnBadge()` (`app.js:2423`) is the one true client attention indicator: it counts
`platform_connections` rows with `status in (error, revoked)` or any `last_error` and
shows a red `.sb-count-warn` pill on the sidebar's Sync Health link, hidden at zero.

---

## Summary answers

- **Which events create notifications:** KPI month insert (`stats`), video stage moves
  (`video`), deliverable delivered + phase complete (`deliverable`), milestone
  current/done/edited (`milestone`).
- **Which do not:** sync failures, connection errors, overdue anything, account approvals,
  invites, access changes, and plain team-posted updates.
- **Does deliverable completion create anything?** Yes — a `notifications` row; and a
  `✓ Delivered` entry appears in the update feed derived from `delivered_at` (no
  `activity` row is written for the individual item, by design).
- **Do failed syncs create anything?** No notification row. Only a computed ops alert and
  the client-side Sync-Health badge.
- **Per user / practice / global?** Strictly **per practice**, shared `seen` flag. The ops
  queue is **per team user** (dismiss/snooze/pin/order on their own profile). The Updates
  badge is **per browser**.
- **Unread / dismissed state:** client = `notifications.seen` (server); ops =
  `profiles.ops_attention_state` (server, with localStorage mirror and fallback);
  updates = `localStorage` timestamp only.
