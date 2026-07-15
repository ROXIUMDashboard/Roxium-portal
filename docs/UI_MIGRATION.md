# ROXIUM → Lovable design-language migration

**This is a UI/UX migration, not a template swap.** The Lovable implementation
supplies *only* the visual layer — layouts, motion, interactions, transitions,
responsiveness, component design, page hierarchy. **ROXIUM supplies everything
else** and stays the source of truth:

```
100% ROXIUM backend + 100% ROXIUM logic + 100% ROXIUM features
+ Lovable UI/UX layer  =  New ROXIUM
```

Non-negotiables:
- **No feature removed.** If ROXIUM has something Lovable doesn't, it gets a home
  in the new design — never deleted.
- **Live data only.** Every number/list pulls from the existing KPI tables, sync
  functions, edge functions, RLS RPCs. No mock data, no duplicate systems.
- **One design system.** Landing, client portal, ops — same tokens, motion,
  spacing, typography, cards, transitions.
- **Architecture untouched.** No changes to SQL, edge functions, OAuth/Composio,
  RLS, routing semantics, or business logic. Presentation layer only.

## Method (how the migration is done without touching the backend)

The Lovable app is React+Tailwind+shadcn; ROXIUM is a vanilla-JS SPA. We do **not**
port React. We port the **design system** onto ROXIUM's existing markup/JS:
- **Tokens remapped** in `styles.css` `:root` to Lovable's oklch palette + Fraunces/
  Inter + white hairlines + radius/shadow scale. Because ROXIUM's components already
  reference `var(--line)`/`var(--gold)`/etc., they inherit the look with no rewrite.
- **Component reskin** — existing classes (`.phasecard`, `.conn-card`, `.btn`…) get
  the glass-card / hairline / rounded treatment.
- **New composition where Lovable adds structure** (e.g. the Overview dashboard),
  built as vanilla render functions wired to the **same** `data.*` the tabs use.

## Feature audit + target mapping

Legend: ✅ migrated · 🟡 in progress · ⬜ pending

| ROXIUM feature | Current home | Lovable analogue | Target in new design | Live source | Status |
|---|---|---|---|---|---|
| App shell (nav) | top tabs + team topnav | sidebar + top bar | Left sidebar (Client Portal / Operations groups) + top utility bar | — | ✅ |
| Design system | gold-line editorial | Fraunces/Inter + oklch + glass | Token remap + component reskin | — | ✅ |
| Client Overview | hero + stat band | Overview dashboard | KPI cards + perf chart + current phase + live sync + video pipeline + updates | kpi_monthly, video_pipeline, platform_connections, activity/milestones | ✅ |
| Top-bar search (⌘K) | team-only palette | Search + CmdMenu | Search button → command palette (client + team, role-scoped) | in-app nav | ✅ |
| Notifications | notify bar | bell dropdown | Top-bar bell + dropdown | notifications table | ✅ |
| User menu | whoami chip + logout | avatar dropdown | Avatar + name + practice, Edit name / Preview / Sign out | profiles/auth | ✅ |
| Export report | KPI CSV (team panel) | Export report action | Top-bar Export (print/PDF) + keep CSV in Metrics | kpi_monthly | 🟡 |
| Roadmap / milestones | horizontal timeline | "From foundation to optimize." phase cards | Stacked phase cards: numbered badge, status pill, % bar, deliverables with status icons — **all still editable** (client can edit milestones/phases/dates/status, drag-reorder) | milestones, deliverables | ⬜ |
| Deliverables (Progress) | phase board | folded into Roadmap phases | Phase cards list deliverables; keep drag/edit/status/add | deliverables | ⬜ |
| Video pipeline | stage board | "Planned → Posted." board + table | Stage board + table with StagePill; keep drag between stages, edit, blocked flag | video_pipeline, video_history | ⬜ |
| Metrics (KPI dashboard) | cards + Chart.js + month/channel pickers | (not in Lovable) | Dedicated **Metrics** page in new design: full KPI grid (editable cards), animated charts, month + channel + range selectors, monthly & historical, CSV export | kpi_monthly, kpi_daily, editable prefs | ⬜ |
| Editable KPI cards | Customize modal | (n/a) | Keep + extend: customizable cards/widgets/layout with sensible defaults | kpi_dashboard_prefs | ⬜ |
| Updates / timeline | feed | "Everything that changed." grouped by day | Day-grouped activity stream | activity + derived events | ⬜ |
| Marketing Connections | connections manager | (n/a) | Connections page in new design: per-source card (connected, last synced, account, refresh, disconnect, details, view metrics), Add data source catalog | platform_connections + Composio | ⬜ |
| OAuth (Composio) | oauth-start/callback | (n/a) | Unchanged backend; connect flow reskinned in Connections | edge functions | ⬜ |
| Operations dashboard | ops panel | "Needs attention." queue | Ops command center: Needs attention (High/Med/Low), client health, deliverables, videos, marketing, sync, activity | ops RPCs / aggregates | ⬜ |
| Clients (team) | practice switcher / roster | "All clients." card grid | Client card grid (avatar, phase, %, spend, attention) → opens portal | practices + aggregates | ⬜ |
| Sync Health | sync observability panel | "Sync health." telemetry table | Per-source telemetry table + status pills | sync logs / platform_connections | ⬜ |
| Approvals | Team Controls panel | (n/a) | Section within Team Controls / Ops, reskinned | account approvals RPCs | ⬜ |
| Invitations | access panels | (n/a) | Settings → Invitations + client Invite team | invites RPCs | ⬜ |
| Settings | single marketing tab (removed) | (n/a) | Grouped Settings: Marketing Connections · Permissions · Notifications · Invitations · Integrations · Dashboard Preferences · Account | various | ⬜ |
| Permissions / memberships | access roster | (n/a) | Settings → Permissions | memberships RPCs | ⬜ |
| Account management | scattered | user menu | Settings → Account + user menu | profiles | ⬜ |
| Team Controls | admin panel | (n/a) | Reskinned admin surface (reporting, sources, admins, approvals, danger zone) | admin RPCs | ⬜ |
| Landing page | own inline styles | landing (hero, sections, motion) | Migrate onto the shared design system (tokens, motion, reveals) | marketing copy | ⬜ |

## ROXIUM-only features → assigned homes (nothing lost)

- **Sync Health** → new Operations sidebar item (mirrors Lovable's "Sync health").
- **Metrics / historical KPI / graphs** → dedicated **Metrics** page (Lovable's
  Overview only teases KPIs; the deep analysis stays a first-class page).
- **Marketing Connections + OAuth** → **Connections** page (client) with the full
  connect/refresh/disconnect/details lifecycle.
- **Approvals / Invitations / Permissions / Team Controls / Reporting sources /
  Danger zone** → grouped under **Settings** (client) and **Team Controls** (team).
- **Editable KPI cards / dashboard prefs** → kept and extended on Overview + Metrics.

## Navigation / information architecture (reconciled)

Sidebar, role-aware (already built; groups fill in as pages migrate):
- **Client Portal:** Overview · Roadmap · Progress · Video · Metrics · Updates ·
  Connections · Invite team
- **Operations (team):** Operations (Needs attention) · Clients · Sync health ·
  Team Controls · Client Controls
- **Account:** user menu → Settings (grouped) · Sign out

## Migration order

0. ✅ Shell (sidebar + top bar), design tokens, glass reskin.
1. ✅ Overview dashboard (live) + interactive top bar (search/export/notify/user).
2. ⬜ Roadmap + Progress (phase cards, editable) — flagship inner page.
3. ⬜ Video pipeline (board + table, editable).
4. ⬜ Metrics (full KPI dashboard + charts + selectors + editable cards).
5. ⬜ Updates (day-grouped stream).
6. ⬜ Connections (lifecycle) + Settings (grouped).
7. ⬜ Operations command center + Clients grid + Sync Health.
8. ⬜ Landing page onto the shared system.
9. ⬜ Mobile pass + a11y (keyboard/ARIA/focus/reduced-motion/contrast) + perf
   (GPU transforms, no layout thrash, smooth with large KPI tables).

## Guardrails (every step)

- Do not remove functionality; find it a home.
- Live data only; reuse existing `data.*`, RPCs, edge functions — no duplicate systems.
- Keep everything editable that is editable today (milestones, deliverables, phases,
  dates, statuses, KPI cards).
- Reduced-motion safe; keyboard-navigable; sufficient contrast.
- Verify each page (headless render) before commit; keep `node --check` + balanced CSS green.
- Presentation-only diffs — no SQL, no edge-function, no auth/RLS changes.
