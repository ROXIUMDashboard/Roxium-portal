# Domain architecture audit — `roxium.com` vs `roxiumstudio.com` vs `studio.roxium.com`

**Status: analysis only. Nothing is implemented.** This document compares the two
domain strategies for separating the ROXIUM marketing site from the ROXIUM software,
audits every integration that would change, and gives a recommendation + migration
plan.

---

## 0. The decision, up front

**Recommended: Option A — put the software on its own domain, `roxiumstudio.com`,
with the portal at `app.roxiumstudio.com`.** Marketing stays on `roxium.com`.

The reason this is an easy call *in this specific stack*: the usual technical reasons
to prefer a subdomain (shared auth cookies, shared TLS, simpler OAuth) **do not apply
here**, so the decision comes down to strategy and branding — where a separate product
domain clearly wins given your stated long-term plan (ROXIUM = parent/marketing,
ROXIUM STUDIO = the SaaS platform, with more products later).

If you would rather keep everything under one brand umbrella for now, Option B
(`studio.roxium.com`) is a perfectly safe fallback and the migration is nearly
identical — you can even start on a subdomain and move to the separate domain later
with low cost, because nothing in the codebase hard-codes the host.

---

## 1. Current state (facts this audit is based on)

| Piece | Today |
|---|---|
| Hosting | **One** Cloudflare Pages project (`roxium-portal`) |
| Marketing site | `roxium.com/` (root `index.html`) |
| Software (portal) | `roxium.com/portal/` (`portal/index.html` — one SPA, client + team + ops) |
| Legal | `roxium.com/privacy/`, `/terms/` |
| Auth | Supabase magic links; `emailRedirectTo = location.origin + '/portal/'`. **Session = JWT in `localStorage`, not cookies.** |
| DB / API | One Supabase project (`CONFIG.SUPABASE_URL`), RLS-enforced |
| Edge functions | Supabase-hosted; CORS `Access-Control-Allow-Origin: *`; read `SITE_URL` (default `https://roxium.com`) for email/redirect links |
| Marketing OAuth | Google/Meta **via Composio** — the provider redirect URIs live on **Composio's** side, not ours. Our `oauth-callback` only bounces the browser back to `SITE_URL`. |
| Email | Resend; `EMAIL_FROM = ROXIUM <updates@roxium.com>` (so `roxium.com` is the verified sending domain); links point to `SITE_URL + /portal/` |
| Invitations | `invite-user` edge function; `redirectTo = SITE_URL + /portal/` |
| Deploy | GitHub Actions → `wrangler pages deploy` on push to `main` |

**Key architectural fact:** marketing and software are the *same* deployment today
(one Pages project, `/` vs `/portal/`). Whichever option you choose, the real work is
**splitting that one deployment into two** (marketing on `roxium.com`, software on the
studio host). The apex-vs-subdomain choice barely changes that work.

---

## 2. Why the usual "subdomain is safer" arguments don't apply here

These are the three reasons teams normally pick a subdomain. In this stack each one is
neutralized:

1. **"Share the auth session/cookie across marketing + app."**
   Supabase stores the session as a **JWT in `localStorage`**, which is *per-origin* and
   never shared across hosts anyway — not with a subdomain, not with a separate domain.
   Marketing (`roxium.com`) has no login, and the app is a single origin. There is **no
   cross-origin session to preserve**, so the subdomain's classic cookie advantage is
   moot. (If you were on cookie-based auth, Option B would matter; you are not.)

2. **"OAuth redirect URIs are painful to move."**
   You go through **Composio**, which owns the Google/Meta redirect URIs. Our
   `oauth-start` hands the browser Composio's URL and `oauth-callback` returns to *our*
   function, then to the app via `SITE_URL`. **Changing our portal domain does not touch
   the Google or Meta app configuration at all** — only the `SITE_URL` env var. (Caveat:
   if you ever drop Composio for direct OAuth, redirect URIs become domain-bound — see
   §7 "Future".)

3. **"One TLS cert / one Cloudflare config is simpler."**
   Cloudflare issues Universal SSL automatically for both an apex domain and a subdomain,
   and both domains live in the **same Cloudflare account**. There is no meaningful cert
   or config difference.

Net: the technical delta between Option A and Option B here is **one email-domain
verification (optional), one env var, and one auth allow-list entry.** Everything else
is identical. So optimize for strategy.

---

## 3. System-by-system impact (identical work unless noted)

Legend: 🟢 no change · 🟡 one setting · 🔴 real work. "A" = `roxiumstudio.com`,
"B" = `studio.roxium.com`.

| System | What changes | A | B |
|---|---|---|---|
| **Cloudflare DNS** | Point the software host at the portal Pages project. A: add `roxiumstudio.com` as a zone (already owned) + `app` CNAME. B: add `studio`/`app` CNAME on the existing `roxium.com` zone. | 🟡 | 🟡 |
| **Cloudflare Pages** | Split into **two projects**: `roxium-marketing` (→ `roxium.com`) and `roxium-app` (→ the studio host). Same work either option. | 🔴 | 🔴 |
| **TLS/SSL** | Automatic (Universal SSL) for both. | 🟢 | 🟢 |
| **Supabase — DB/RLS** | Nothing. One project, domain-agnostic. | 🟢 | 🟢 |
| **Supabase — Auth allow-list** | Add the new portal origin to **Site URL** + **Redirect URLs** (`https://app.roxiumstudio.com/**` or `https://studio.roxium.com/**`). | 🟡 | 🟡 |
| **Supabase — Edge functions** | CORS is `*` (no change). Set **`SITE_URL`** to the new portal origin (drives email + invite + oauth-callback links). One variable. | 🟡 | 🟡 |
| **OAuth (Google/Meta via Composio)** | **No provider-side change** — Composio owns redirect URIs. Only `SITE_URL` (above). | 🟢 | 🟢 |
| **Google/Meta app settings** | None while on Composio. (If direct OAuth later: add the new origin/redirect URI — same one-time edit for A or B.) | 🟢 | 🟢 |
| **Email (Resend)** | Links follow `SITE_URL`. **Sending domain**: keep `updates@roxium.com` (already verified) *or* — only in Option A, if you want studio-branded mail — verify `roxiumstudio.com` in Resend (SPF/DKIM/DMARC DNS). This is the one extra task Option A *can* add, and it's optional. | 🟡* | 🟢 |
| **Magic links / invitations** | Governed entirely by `SITE_URL` (functions) + the auth allow-list. No code change. | 🟡 | 🟡 |
| **Marketing Connections** | Composio-mediated → domain-agnostic. `SITE_URL` for the post-connect bounce only. | 🟢 | 🟢 |
| **Notifications** | In-app (DB) + email (Resend). Email links follow `SITE_URL`. | 🟡 | 🟡 |
| **GitHub / repo** | Optionally split marketing and app into two folders/projects (recommended) or two repos. Independent of A vs B. | 🔴 | 🔴 |
| **Deployments** | Two Pages deploys instead of one (two workflows or a matrix). Independent of A vs B. | 🔴 | 🔴 |
| **Env vars** | `SITE_URL` (functions), and in the app `config.js` nothing host-specific today (`emailRedirectTo` uses `location.origin`, so it auto-follows the new host — no change). | 🟡 | 🟡 |
| **Client onboarding** | Invite email → `SITE_URL/portal/` (or new root). Works once `SITE_URL` + allow-list are set. | 🟡 | 🟡 |
| **Team onboarding** | Same as client — magic link + allow-list. | 🟡 | 🟡 |
| **SEO** | Marketing SEO stays 100% on `roxium.com`. App should be **`noindex`** on either host (it's gated software). Option A keeps the marketing domain's link equity fully separate; Option B shares the root domain's authority (irrelevant for a `noindex` app). Slight edge: **A** (cleaner separation, zero risk of app URLs diluting marketing). | 🟢 | 🟢 |
| **Branding** | A = distinct product identity (ROXIUM STUDIO). B = sub-brand under ROXIUM. Edge: **A** for your stated plan. | — | — |
| **Security / blast radius** | A = fully isolated origin, separate zone, separate Pages project → a marketing-site mistake can never affect the app cookie/JS context, and vice-versa. B = same registrable domain (still separate origins, so XSS/cookies don't cross, but they share the apex's DNS/registrar surface). Edge: **A**. | — | — |

`*` Optional and only for studio-branded email; you can ship Option A while still
sending from `roxium.com`.

---

## 4. Pros / cons

### Option A — `roxiumstudio.com` (separate product domain)
**Pros**
- Clean parent/product split: `roxium.com` = the company/marketing, `roxiumstudio.com`
  = the platform. Matches your 5–10-year plan and the "ROXIUM STUDIO becomes its own
  SaaS" story.
- Room to grow *within* the product without touching marketing:
  `app.roxiumstudio.com`, `api.roxiumstudio.com`, `analytics.roxiumstudio.com`,
  `ai.roxiumstudio.com`, per-product subdomains — a whole product family under one
  product apex.
- Maximum isolation: separate zone, separate Pages project, separate (optional) email
  domain → the marketing site literally cannot break the software, and it's trivial to
  spin the platform out or sell it later.
- You already own the domain, so there is no acquisition cost.

**Cons**
- One optional extra task: verify `roxiumstudio.com` in Resend if you want
  studio-branded email (DNS records). Skippable at launch.
- Two brand systems to maintain (also a pro).

### Option B — `studio.roxium.com` (subdomain)
**Pros**
- One brand, one registrable domain, one email-sending domain (already verified).
- Marginally fewer moving parts in DNS (one zone).

**Cons**
- Weaker product separation; harder to spin ROXIUM STUDIO out later (the platform's
  URLs are entangled with the marketing domain).
- Future products become `x.roxium.com`, mixing marketing and product namespaces on the
  same apex.
- The technical "simplicity" it usually buys (shared cookies/OAuth) **doesn't exist in
  this stack**, so you pay the branding cost without the technical benefit.

---

## 5. Recommendation & rationale

**Adopt Option A.** Put the software on `roxiumstudio.com`, portal at
**`app.roxiumstudio.com`** (reserve the bare `roxiumstudio.com` for a future product
landing page and keep other subdomains free for API/AI/analytics products). Keep
`roxium.com` marketing-only.

Why:
1. The technical penalties that normally favor a subdomain are neutralized here
   (localStorage auth, Composio-mediated OAuth, wildcard-free automatic TLS, `*` CORS).
2. It matches your explicit long-term direction (parent brand + product platform +
   multiple future products).
3. It maximizes isolation and future optionality (spin-out/sell/scale) at essentially
   the same migration cost as the subdomain.
4. The only Option-A-specific task (studio email-domain verification) is optional and
   can be deferred.

Serving path: move the app from `.../portal/` to the **root** of `app.roxiumstudio.com`
(cleaner URLs, `app.roxiumstudio.com/#overview`), and 301 `roxium.com/portal/*` →
`app.roxiumstudio.com/*` during transition.

---

## 6. Migration plan (phased, reversible)

**Phase 0 — Prep (no user impact)**
- Add `roxiumstudio.com` to Cloudflare (nameservers → Cloudflare).
- In the repo, split the build: `roxium-marketing` output (index/privacy/terms) and
  `roxium-app` output (the portal SPA + assets). Two Pages projects.
- Stand up `app.roxiumstudio.com` as a **preview** custom domain on the app project.

**Phase 1 — Backend allow-lists (additive, safe)**
- Supabase Auth → add `https://app.roxiumstudio.com/**` to Site URL + Redirect URLs
  (keep the old `roxium.com/portal/**` entry during transition).
- Set edge-function `SITE_URL = https://app.roxiumstudio.com` (functions redeploy).
- (Optional) Resend: verify `roxiumstudio.com`, switch `EMAIL_FROM` to
  `ROXIUM STUDIO <updates@roxiumstudio.com>`.

**Phase 2 — Cut over**
- Point `app.roxiumstudio.com` at the app Pages project (production).
- Add `roxium.com/portal/* → app.roxiumstudio.com/*` redirect (Cloudflare rule or
  `_redirects`) so old magic links/bookmarks keep working.
- Marketing project keeps `roxium.com`.

**Phase 3 — Cleanup (after a grace period)**
- Remove the old `roxium.com/portal/**` auth allow-list entry.
- Update docs, email templates, invite copy to the new host.
- Keep the 301 in place indefinitely (cheap insurance).

**Rollback:** at any phase, repoint DNS / revert `SITE_URL` / re-add the old allow-list
entry. Because nothing hard-codes the host, rollback is a config change, not a code
change.

---

## 7. Ownership split — you vs. me

### You configure (dashboard/DNS — I can't reach these)
- **Cloudflare:** add `roxiumstudio.com` zone; create the app Pages project; attach
  `app.roxiumstudio.com`; add the `roxium.com/portal/*` redirect.
- **Supabase dashboard:** Auth → Site URL + Redirect URLs; set `SITE_URL` (and, if used,
  `EMAIL_FROM`) function secrets.
- **Resend (optional):** verify `roxiumstudio.com` (SPF/DKIM/DMARC DNS on the new zone).
- **Composio / Google / Meta:** nothing now (Composio-mediated). Only if you later drop
  Composio for direct OAuth.
- **GitHub:** approve the deploy-workflow split (or a second repo if you want full
  separation).

### I can implement (in-repo, on request — not done yet)
- Split `scripts/prepare-pages.sh` into marketing vs app bundles and add a second Pages
  workflow (or a matrix) so `main` deploys both projects.
- Move the app off `/portal/` to the studio root and update internal links
  (`emailRedirectTo` already uses `location.origin`, so it follows automatically).
- Centralize any host references behind a single `config.js`/env value and confirm the
  app has **no** hard-coded `roxium.com`.
- Add `noindex` headers for the app host and the `roxium.com/portal/* → app...` redirect
  (`_redirects` / `_headers`).
- Update edge-function defaults/comments and email templates to the new `SITE_URL`,
  and update the docs (README, ARCHITECTURE, SOP) to the two-host model.

---

## 8. Answers to your specific questions

1. **Better for Supabase / Cloudflare / GitHub / OAuth / Google / Meta / security /
   auth / scalability / maintenance / deployments / SEO / branding / future products?**
   For every *technical* system the two are equivalent here (see §3). For **security,
   SEO, branding, scalability, and future products**, Option A is better. Nothing favors
   Option B except "one brand / one email domain," which is a preference, not a
   constraint.

2. **Would ROXIUM STUDIO as its own product/domain be advantageous?**
   Yes — that is precisely the upside of Option A: a clean ROXIUM (parent) → ROXIUM
   STUDIO (platform) split, its own domain to grow products under, and easy spin-out.

3. **Best UX / maintenance / auth safety / integrations / deployment / 5–10-yr scaling?**
   - UX: identical (users see one app host either way).
   - Maintenance: A is cleaner long-term (isolated projects; a marketing change can't
     touch the app).
   - Auth safety: identical (per-origin localStorage tokens; both are separate origins).
   - Integrations: identical today (Composio); A keeps room for `api.roxiumstudio.com`.
   - Deployment: identical effort (you split into two projects either way).
   - Scaling: A wins (product-family namespace under `roxiumstudio.com`).

**Bottom line:** choose **`roxiumstudio.com`** (Option A), portal at
`app.roxiumstudio.com`. Say the word and I'll implement everything in the "I can
implement" list; you handle the Cloudflare/Supabase/Resend dashboard steps in §7.

---

## 9. Option A — exact execution runbook (you chose this)

Target end state: `roxium.com` = marketing, **`app.roxiumstudio.com`** = the software.
Nothing in the code hard-codes the host, so this is almost entirely dashboard work.

There are two ways to land the app on the studio domain. Do **Path 1** first (10
minutes, zero repo risk); move to **Path 2** later if you want the app at the studio
*root* with clean URLs.

### Path 1 — attach the domain (fastest, app at `app.roxiumstudio.com/portal/`)
1. **Cloudflare → Add site** → `roxiumstudio.com`. Point the registrar's nameservers at
   the two Cloudflare NS it shows. Wait for "Active".
2. **Cloudflare → Workers & Pages → `roxium-portal` → Custom domains → Set up a domain**
   → `app.roxiumstudio.com`. Cloudflare creates the CNAME + cert automatically.
3. **Cloudflare → Rules → Redirect Rules → Create**:
   - When: `Hostname equals app.roxiumstudio.com` **and** `URI Path equals /`
   - Then: **Dynamic redirect**, 302, expression `concat("https://app.roxiumstudio.com/portal/")`
   - (So the studio root opens the app; deep links like `/portal/#overview` already work.)
4. **Supabase → Authentication → URL Configuration**:
   - **Site URL**: `https://app.roxiumstudio.com/portal/`
   - **Redirect URLs**: add `https://app.roxiumstudio.com/portal/**`
     (keep `https://roxium.com/portal/**` during transition).
5. **Supabase → Edge Functions → Secrets** (or `supabase secrets set`):
   - `SITE_URL = https://app.roxiumstudio.com`  (drives email + invite + oauth-callback links)
   - Redeploy the functions (or they pick it up on next invoke).
6. **Composio / Google / Meta**: nothing — Composio owns the OAuth redirect URIs.
7. **(Optional) Resend** — studio-branded email:
   - Add domain `roxiumstudio.com`, add the SPF/DKIM/DMARC DNS records it gives you.
   - `EMAIL_FROM = ROXIUM STUDIO <updates@roxiumstudio.com>` (function secret).
   - Skip this to keep sending from the already-verified `updates@roxium.com`.
8. **Test**: open `https://app.roxiumstudio.com` → lands on the portal login; send a
   magic link → confirm it returns to `app.roxiumstudio.com/portal/`; connect a data
   source → confirm the post-OAuth bounce lands back on the app.

That's the whole migration. `roxium.com` marketing is untouched.

### Path 2 — clean split (optional polish, app at `app.roxiumstudio.com/` root)
Only if you want `app.roxiumstudio.com/` (no `/portal/`) and a fully separate app
deploy. This is repo work I can do on request:
- Split `scripts/prepare-pages.sh` into a **marketing bundle** (index/privacy/terms) and
  an **app bundle** (portal SPA served at root), and add a second Pages project
  `roxium-app` with its own deploy workflow.
- Point `roxium.com` at the marketing project and `app.roxiumstudio.com` at the app
  project.
- Add `roxium.com/portal/* → app.roxiumstudio.com/*` 301 for old links/emails.
- Then Supabase Site URL/Redirect become `https://app.roxiumstudio.com/**` (no `/portal`).

Ask me to "do Path 2" and I'll prepare the build split + workflow; you'd create the
second Pages project and repoint the two custom domains.

### One-line summary of what actually changes
- **You (dashboards):** Cloudflare custom domain + one redirect rule · Supabase Site
  URL + Redirect URLs · `SITE_URL` secret · (optional) Resend domain + `EMAIL_FROM`.
- **Code:** nothing required for Path 1 (already host-agnostic). Path 2 is an optional
  build/deploy split I can implement.
