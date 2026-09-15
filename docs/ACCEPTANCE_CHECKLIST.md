# Staging Acceptance Checklist

Run against **https://staging.roxium.com/portal/** before approving a production
release. About ten minutes.

Fixture logins are in `docs/STAGING_DATA.md`. All are `@roxium.test`.

> This checklist covers the product **as it is today**. It will grow when Product
> Pass 1 lands. Items marked **⚠ known** are scheduled defects — see
> `docs/TESTING.md`; note them, do not treat them as release blockers.

---

## 0 · You are on staging

- [ ] Gold **STAGING** badge, bottom-left
- [ ] Practice names all end in **(TEST)**
- [ ] `https://staging.roxium.com/version.json` shows `"environment":"staging"` and the commit you expect

## 1 · Client — sign in

- [ ] Sign in as `owner.northstar@roxium.test`
- [ ] Login page is clean and the sign-in link/code flow works
- [ ] Lands on **Overview**

## 2 · Client — the portal

- [ ] **Overview** — "What changed / What needs you / What's next" all populate
- [ ] **Progress** — phase cards expand; progress bars and percentages look right
- [ ] Roadmap milestones show a sensible "You are here"
- [ ] **Video** — assets listed by stage; a blocked item reads *"Needs your input"*
- [ ] **Updates** — Today / Yesterday / This week populate; History opens
- [ ] **Metrics** — KPI cards and charts render; month selector works; **no crash**
- [ ] ⚠ known: Reach may read `0` rather than "—" in aggregates (R-01/R-02)
- [ ] Sidebar navigation works on every tab
- [ ] Logo returns to **Overview**
- [ ] **Sign out** works and returns to the login card

## 3 · Client — the unhappy paths

- [ ] Sign in as `owner.cedarridge@roxium.test`
- [ ] Overdue work is visible and the tone is right for a client to see
- [ ] The failed marketing connection shows plain-English wording, not a JSON blob
- [ ] Sign in as `owner.brightpath@roxium.test` — a brand-new client looks sensible, not broken or empty

## 4 · Team — Operations

- [ ] Sign in as `team.ops@roxium.test`
- [ ] Lands on **Operations** with **no** client selected
- [ ] Exec cards populate (active clients, need attention, overdue, due soon)
- [ ] **Needs Attention** lists the seeded risks: phase overdue, deliverable overdue, video overdue, video waiting on client, failed connection, stale sync
- [ ] Dismiss / snooze / pin work, and survive a page reload
- [ ] ⚠ known: some items may read "due tomorrow" when due today (R-08)
- [ ] Company KPI rollup renders; month picker works

## 5 · Team — client management

- [ ] Client switcher opens and filters
- [ ] Switching to a client opens their portal view
- [ ] Deliverables editable: status, due date, drag to reorder
- [ ] Videos editable: stage change, detail modal, internal comments
- [ ] Posting an update appears in that client's Updates
- [ ] **Team Controls** loads: clients, access & invites, admins
- [ ] Account approvals screen loads and shows `pending.applicant@roxium.test`
- [ ] ⚠ known: the approvals queue cannot fill from real signups (R-03)
- [ ] Notification bell shows unseen items and clears when dismissed

## 6 · Security sanity — do not skip

- [ ] As `owner.harborpoint@roxium.test`, confirm **Harbor Point data only**. No Northstar, Brightpath or Cedar Ridge anywhere.
- [ ] Note a practice id from another client's URL while signed in as team, then sign in as `owner.harborpoint@roxium.test` and put that id in the URL → **no other practice's data appears**
- [ ] Sign out, then open `/portal/#operations` directly → **login card only**, no dashboard
- [ ] `revoked.former@roxium.test` cannot reach any practice data
- [ ] ⚠ known: a revoked user can still authenticate and reach the waiting room (R-05)

## 7 · Responsive

- [ ] Desktop (~1440px): no overlap, no clipped text
- [ ] Phone (~390px): no sideways scrolling; sidebar becomes a drawer; tables scroll inside their own container
- [ ] Tablet (~820px): layout reflows sensibly

## 8 · Regression

- [ ] Browser console shows no red errors on Overview, Progress, Video, Metrics, Updates or Operations
- [ ] `https://staging.roxium.com/privacy` and `/terms` serve the legal pages, **not** the portal
- [ ] Footer shows `build <sha>` matching the release

---

## Verdict

- [ ] **APPROVE** — proceed to *Release to PRODUCTION*
- [ ] **REJECT** — note what failed and hand it back

Anything unexpected that is **not** marked ⚠ known: stop and report it.
