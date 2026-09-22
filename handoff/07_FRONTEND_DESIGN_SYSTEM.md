# 07 · Frontend Design System (extracted, not redesigned)

**This file is the visual source of truth. Nothing here is a proposal — it is a
description of what `styles.css` and `app.js` already do.** Any future work should
extend these tokens and component classes rather than introduce a new system.

---

## 1 · Design tokens — `styles.css:1-43` (`:root`)

The palette is authored in **oklch**, not hex. Dark, warm, gold-accented, white
hairlines. There is **no light mode** and no `prefers-color-scheme` block.

```css
/* typography */
--font-display: "Fraunces","Cormorant Garamond",ui-serif,Georgia,serif;
--font-sans:    "Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;

/* surfaces */
--ink:        oklch(0.14 0.008 60);   /* app background */
--surface:    oklch(0.17 0.009 60);   /* cards */
--surface2:   oklch(0.21 0.011 60);   /* table headers, inputs */
--surface3:   oklch(0.24 0.012 60);
--sidebar-bg: oklch(0.128 0.008 60);  /* darker than content */

/* lines */
--line:      oklch(1 0 0 / 8%);       /* hairline — WHITE, not gold */
--line-soft: oklch(1 0 0 / 5%);

/* brand */
--gold:      oklch(0.82 0.14 82);
--gold-dim:  oklch(0.6 0.15 70);
--gold-soft: oklch(0.82 0.14 82 / 12%);

/* text */
--cream: oklch(0.96 0.005 80);
--muted: oklch(0.72 0.015 70);

/* status */
--green: oklch(0.74 0.12 155);  --amber: oklch(0.79 0.13 66);
--red:   oklch(0.66 0.19 25);   --tone-orange: oklch(0.72 0.16 48);
--good-soft / --warn-soft / --bad-soft  = the same hues at 14% alpha
--glass: linear-gradient(180deg, oklch(1 0 0 / 3%), oklch(1 0 0 / 1%));

/* spacing · 4px base */      --sp-1..8 = 4,8,12,16,24,32,48,64px
/* radii */                   --r-xs 6 · --r-sm 8 · --r-md 10 · --r-lg 12 · --r-xl 16 · --r-full 999
/* elevation */               --shadow-sm/md/lg + --glow (gold-tinted halo)
/* motion */                  --dur-1 120ms · --dur-2 200ms · --dur-3 320ms · --dur-4 520ms
                              --ease-out / --ease-in-out / --ease-spring
/* z-index */                 --z-header 10 · --z-overlay 40 · --z-modal 50 · --z-toast 60
```

A global `@media (prefers-reduced-motion: reduce)` block (`styles.css:45-47`) kills every
animation and transition. **Any new animation inherits this for free — do not add
per-component reduced-motion handling.**

---

## 2 · Typography hierarchy

| Element | Rule |
|---|---|
| `h1` | `--font-display`, weight 500, `clamp(34px, 5vw, 52px)`, line-height 1.05 |
| `h2` | display, 500, 28px → **31px** after the polish pass (`styles.css:700`) |
| `h3` | display, **600**, 19px, **gold** |
| `h1 em, h2 em` | italic + gold — the signature accent |
| body | Inter 400, `font-feature-settings:"ss01","cv11"` |
| `.eyebrow` | 11px, `letter-spacing:.32em`, uppercase, gold — the section kicker |
| `.mark` | the ROXIUM wordmark: 500, `letter-spacing:.42em`; `.mark b` = the gold **I** |
| `.card .k` | 10px, `.24em`, uppercase, gold — every metric label |
| `.card .big` | display 30px/600, `font-variant-numeric: tabular-nums` |
| `.note` | muted small text — used everywhere as the secondary voice |
| `th` | 10px, `.2em`, uppercase, gold on `--surface2` |

**The tell of this system is wide letter-spacing on small uppercase gold labels against a
serif display face.** Anything that drops that reads as generic.

---

## 3 · Core components

| Component | Class | Definition |
|---|---|---|
| **Primary button** | `.btn` | gold fill, `#171410` text, 11.5px, `.22em` uppercase, `padding 13px 26px`, `border-radius:3px` |
| Ghost | `.btn.ghost` | transparent, `1px solid var(--line)`; hover → gold border + gold text |
| Danger / Warn | `.btn.danger` / `.btn.warn` | outline in `--red` / `--amber`; hover inverts to a filled button |
| Sizes | `.btn.sm` (9/17px) · `.btn.xs` (2/8px) | |
| Interaction | hover `box-shadow:0 3px 14px rgba(201,168,76,.18)`; `:active translateY(1px)`; `:disabled opacity .5` |
| **Card** | `.card` | `--surface`, `1px solid --line`, `21px 24px 17px`; children `.k` / `.big` / `.tgt` / `.trend` |
| Card grid | `.cards` | `repeat(auto-fit, minmax(230px,1fr))`, gap 16 |
| **Stat (hero)** | `.stat` | right-aligned, `border-right:1px solid var(--gold)`, display 36px value + `.26em` uppercase label |
| **Table** | `table/th/td` | 13px, `border-collapse:collapse`; `th` gold-on-`surface2`; `td` bottom border `rgba(201,168,76,.1)` |
| **Modal** | `.modal` / `.modalcard` | fixed overlay `rgba(8,7,10,.78)` + `backdrop-filter:blur(4px)`; card `min(560px,94vw)`, `border:1px solid var(--gold)`, head/body/foot |
| **Dialog** | `.dlg-overlay` / `.dlg` | the themed replacement for native `confirm/alert/prompt`; entrance `translateY(8px) scale(.98)` → none over 180 ms |
| **Inputs** | `.cellinput`, `.f input`, `.dlg-input` | `--ink` bg, `--line` border, 14.5px, focus → gold border + `0 0 0 1px gold` |
| **Select** | `.picker`, `.f select` | `appearance:none` + an inline gold-chevron SVG data-URI, 34px right padding |
| Native date/month | `input[type=date|month]` | `color-scheme:dark` + a hue-rotate filter on the picker indicator so the calendar is never white |
| **Themed select** | `themedSelect()` `app.js:2791` / `enhanceNativeSelect()` `app.js:2833` | JS that replaces native `<select>` popups with positioned `.tsel-pop` lists; call `enhanceSelectsIn(root)` after injecting markup |
| **Sidebar** | `.sidebar` on `--sidebar-bg`, `.sb-link` with a CSS-variable icon mask | collapse state persisted; mobile becomes a drawer with `.sb-scrim` |
| **Topbar** | `.topbar` / `.tb-*` | search chip with `⌘K`, export, practice switcher, bell + `.tb-dot`, avatar menu |
| Sticky header | `header` | **deliberately opaque `#0F0E13`, not blurred** — a comment records that `backdrop-filter` on a sticky element janked on mobile |
| **Badges/pills** | `.sb-count`, `.sb-count-warn`, `.badge-plat`, `.badge-self`, `.ops-alert-badge-*`, `.agechip` | |
| **Status dots** | `.conn-dot`, `.sb-sync-dot`, `.sh-dot`, `.ov-dot` with `.ok/.warn/.bad/.off/.dot-syncing` | |

---

## 4 · Status colour language

| Tone | Token | Meaning |
|---|---|---|
| green `--green` | on track / connected / delivered / good trend |
| amber `--amber` | approaching / waiting on client / syncing / warn SLA |
| red `--red` | overdue / failed / needs reconnect |
| orange `--tone-orange` | pivotal but neutral events in the update feed |
| gold `--gold` | **brand accent, not a status** — labels, focus, primary action |
| muted `--muted` | not used / disconnected / no data |

Severity ranking is codified once in JS: `OPS_HEALTH_RANK = {red:0, yellow:1, green:2}`
(`app.js:4361`). `updToneOf()` (`app.js:2288`) maps feed events to tones:
video → amber, delivered → good, milestone/sync/connection → orange, else muted.

---

## 5 · Icon system

Three coexisting mechanisms:

1. **Sidebar** — monoline SVG data-URIs assigned to a `--i` custom property per
   `.sb-link[data-i="…"]` (`styles.css:1293-1303`) and painted with a mask, so the icon
   inherits `currentColor`. 12 icons: overview, roadmap, progress, video, metrics,
   updates, plug, invite, ops, controls, wrench.
2. **Inline SVG in JS** — `stageIconSvg()` + `STAGE_ICON` (`app.js:3479-3487`),
   `UPD_ICON` + `updIconSvg()` (`app.js:2272-2288`), the ops alert triangle
   (`renderOpsAlertItem`, `app.js:4761`). All are `viewBox="0 0 24 24"`, `fill:none`,
   `stroke:currentColor`, `stroke-width` 1.8–2, round caps/joins — a **Feather/Lucide-style
   monoline set**.
3. **Platform monograms** — `PLATFORM_CATALOG[].mono` (`M`, `FB`, `IG`, `G`, `GA`, `YT`,
   `MS`, `TT`, `Li`, `GB`, `CR`, `HS`) rendered in `.conn-mono`. This deliberately
   replaced an earlier emoji-based connections page.

**Emoji are effectively banned and the codebase honours it.** A scan of `app.js` finds
exactly **one** emoji (`💬`, the internal video-comment chip, `app.js:3521`). Everything
else is geometric symbols used as glyph controls: `✓ ✕ ⓘ ⋮ ▾ ▲ ▼ ⚠ ▶ ⤓ ⧉ ⚑ ★ ☆ ✎ ○ ●
＋ − ↻ ⌘ →`.

---

## 6 · Animation patterns

| Pattern | Where |
|---|---|
| `ov-pulse` — opacity 1 → .4 → 1 | live-sync dots, current roadmap step ring, wifi glyph |
| `ops-tile-pulse-red` (1.6 s) / `-amber` (2.4 s) — expanding box-shadow ring | Needs-Attention severity tiles only |
| `deeplinkpulse` (2.4 s) — gold double ring | the row a deep link lands on (`.deeplink-flash`) |
| `dsCountUp()` `app.js:1076` | numeric stat tiles count from previous to new value, keyed so an unchanged value does not re-animate |
| dialog entrance | `translateY(8px) scale(.98)` → none, 180 ms `cubic-bezier(.2,.8,.2,1)` |
| `.modalx:hover` | 90° rotate |
| Chart.js | animation **disabled** (`styles.css:1141` comment) — charts use static reveal, not tweens |

**There is no completion/celebration animation anywhere.** That is a gap, not a
principle — and the motion tokens for it already exist.

---

## 7 · Responsive patterns

Desktop-first, graceful down. 40+ media queries; the meaningful ladder is
**1320 → 1240 → 1180 → 980 → 900 → 820 → 760 → 720 → 640 → 600 → 520 → 480 → 400px**
(the sub-300px queries are container-width tricks, not viewport breakpoints).

The load-bearing tier is `max-width:640px` (17 queries, `styles.css:767-808`):
- `.wrap` padding 28 → 20 → 15px
- header wraps; the practice switcher goes full-width; the role label is dropped
- `.tabs` become a horizontal scroller with hidden scrollbars rather than wrapping
- every grid collapses: `.phasewrap`, `.entry`, `.status` → 1 col; `.cards` → 2 cols
  (→ 1 col at 400px)
- `.pipeline` stays a **horizontal-scroll kanban** with `scroll-snap-type:x proximity`
  and `grid-auto-columns:78vw` (86vw at 400px)
- modals and dialogs go to `94vw`
- tables live inside `overflow-x` wrappers; some hide a column
  (`.sh-th-client` at 760px)

---

## 8 · The best existing screens (use these as reference)

1. **Operations → Needs Attention** (`renderOpsAlertItem` `app.js:4759`,
   `styles.css:420-460`). Severity tiles, pulse only where it matters, grip/pin/snooze/
   dismiss affordances, paused/dismissed states that stay visible with Resume/Restore.
   The most complete piece of interaction design in the product.
2. **Client Overview "What changed / What needs you / What's next"**
   (`buildClientOverview` `app.js:1311`, `overviewCol` `app.js:1369`). Three-column
   answer-first layout with tone dots and inline CTAs. This is the product's thesis
   rendered as UI.
3. **Project Progress phase cards** (`ppPhaseCard` `app.js:2984`). Numbered badge,
   progress bar, state pill, collapsible body, consistent status icon set. Shared by
   client (read-only) and team (editable) — one visual language, two capability levels.
4. **Connections manager** (`renderConnectionsPage` `app.js:2072`). Monogram + dot +
   plain-English status + a details panel that answers "is my data actually flowing".
5. **Themed dialogs** (`uiDialog` `app.js:2734`, `.dlg*`). Including
   `requireText` type-the-name confirmation for destructive actions.
6. **Video pipeline summary cards + accordion** (`renderPipeline` `app.js:3547`).
   Icon/count/label filter chips over collapsible stage groups.

---

## 9 · Inconsistencies and things that break the language

| Issue | Evidence |
|---|---|
| **Two divergent token sets.** `index.html:27-34` declares its own `:root` with `--card`, `--line-strong`, `--gold-soft` redefined as a *lighter gold* (not an alpha), `--amber` aliased to `--gold`, and a flat `--radius:14px` instead of the `--r-*` scale. The marketing page and the portal will drift apart on any palette change. | `index.html:27-34` vs `styles.css:1-43` |
| **Two shadow/elevation vocabularies.** `--shadow-sm/md/lg/--glow` exist, but many components hand-roll `box-shadow:0 24px 70px rgba(0,0,0,.55)` etc. | `.dlg` `styles.css:730`, `.ops-*` |
| **Radius is inconsistent.** Tokens define 6/8/10/12/16px, but `.btn` uses `3px`, `.modalcard` `4px`, `.dangerzone` `4px`, `.dm-group` `6px`, `index.html` `14px`. `--r-*` is barely used. | grep `border-radius` |
| **A "polish pass" section overrides the base layer.** `styles.css:693-760` re-declares `.wrap`, `h2`, `.card`, `.btn`, `.tab`, `.picker` with new values. Editing the base rule silently does nothing. | `styles.css:693` |
| **Legacy top-tab nav coexists with the sidebar.** `.tab`/`.tabs` rules and `#tabnav` are still present and toggled by `syncChrome()` alongside `.sb-link`, so two navigation systems are kept in sync by hand. | `app.js:414-455` |
| **Colour literals bypass tokens.** `rgba(201,168,76,…)` (gold), `rgba(198,106,88,.4)` (red) and `#171410`, `#0F0E13` appear as hard-coded values in dozens of rules, so a palette change requires a find-and-replace, not a token edit. | throughout `styles.css` |
| **Hard-coded Chart.js series colours.** `INVEST_SERIES` (`app.js:948-953`) uses `#C9A84C / #7BA4D4 / #6B8F71 / #9A7FB8` — a *different* palette from the CSS tokens, so charts can drift from the UI. | `app.js:948` |
| **Duplicated pulse keyframes.** `ov-pulse`, `ops-tile-pulse-red`, `ops-tile-pulse-amber` and `.sh-dot.dot-syncing` all express "something is live" three different ways. | `styles.css:313, 435-441, 1286, 1485` |
| **Client notification bell has no attention state.** `.tb-dot` is static gold while the ops tiles pulse — an inconsistency in the attention language, not just a missing feature. | `styles.css:1543` |
| **Generic default components** — the raw `<input type="date">` is themed but still a native control with an OS calendar, and it is the only widget that looks like the host OS. `enhanceNativeSelect()` fixed this for selects; dates were never done. | `styles.css:752-758` |
| **142 KB of unminified CSS and 394 KB of unminified JS ship on every load**, cache-busted by `?v=<sha>` with `Cache-Control: no-cache, must-revalidate`. Every deploy is a full re-download. | `_headers`, `prepare-pages.sh` |

---

## 10 · Branding audit

- **`roxium.studio` appears nowhere in the repository.** A full-tree grep returns zero
  hits. Every reference is `roxium.com` (25 files), and the default `EMAIL_FROM` is
  `ROXIUM <updates@roxium.com>`. No cleanup is needed here.
- The wordmark is consistently `ROX<b>I</b>UM` with a gold **I**, in `.mark` in the app,
  `.sb-brand` in the sidebar, and as inline Georgia-serif HTML in all four email
  templates (web fonts do not load in Outlook, so a serif fallback is used deliberately).
- **The logo already routes correctly.** `#sbBrand` is `<a href="#overview">`
  (`portal/index.html:53`); for a real team user a click handler (`app.js:643-657`)
  intercepts it and calls `exitClientPortal()` → deselects the client and goes to
  `#operations`. No fix required.
- Role labels are normalised through one helper, `roleLabel()` (`app.js:215`) →
  Owner / Member / ROXIUM Team / Client / Admin, and are used in both rosters. The invite
  **email** gets a pre-capitalised `role_label` in user metadata because Supabase's Go
  templates have no `title` filter (`docs/email-deliverability.md`).
