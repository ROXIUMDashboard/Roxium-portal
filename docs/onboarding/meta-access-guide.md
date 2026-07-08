# Meta Access Guide — Meta Ads, Instagram Insights, Facebook Page Insights

The Meta family (Facebook Page, Instagram account, ad account, and optionally the
pixel/dataset) lives in **one** business-asset ecosystem, so treat it as **one grant**,
not three separate requests. Done right, the client performs a single partner-access
action in Meta Business Suite and ROXIUM gets read access to everything at once.

**Two methods, in order of preference:**

1. **Partner access (default)** — the client shares assets with **ROXIUM's Business ID**.
   Clean, professional, survives staff turnover on both sides, and ROXIUM controls
   internally which team members can use the access.
2. **Person access (fallback)** — the client adds a specific ROXIUM-managed Meta user to
   each asset. Works, but scales badly (one person per asset per client) and looks less
   professional. Use only until ROXIUM's business portfolio exists, then migrate.

> **Prerequisite for method 1:** ROXIUM has its own Meta business portfolio and knows its
> Business ID. If that's not done yet, stop and do [`internal-setup.md`](internal-setup.md) first.

---

## Before asking for anything: the Instagram prerequisites

Instagram Insights only flows if all four of these are true. Check them on the kickoff
call (Tier 3) or put them at the top of the checklist you send (Tier 1/2):

1. **The IG account is a professional account** (Business or Creator), not personal.
   Personal accounts have no Insights to share. Converting is free and instant:
   Instagram app → Settings → Account type and tools → Switch to professional account.
2. **The IG account is connected to the client's Meta business assets** — either linked to
   their Facebook Page or added as an Instagram asset in their Business Manager /
   Business Suite. An IG account floating outside any business portfolio can't be
   partner-shared.
3. **The grant includes insights-level permission** on the Instagram asset (the
   view/insights option, not just messaging or content permissions).
4. **The person doing the granting actually controls the assets.** A front-desk employee
   who merely posts to Instagram often has no Business Suite admin rights. If nobody at
   the practice has full control of the Page/IG/Business Manager, that's a Tier 3
   situation — resolve ownership first (sometimes it's parked with an old agency or
   web developer; reclaiming it becomes step zero).

---

## Method 1 — Partner access via Meta Business Suite (default)

**What the client does** (send as written steps for Tier 1/2, or drive it live for Tier 3):

1. Go to **business.facebook.com** and make sure the correct business portfolio is
   selected (top-left switcher).
2. Open **Settings** (gear) → **Business settings**. (Meta moves this around; in newer
   Business Suite layouts it's Settings → the **Business portfolio / Partners** section.
   If lost, direct-link them to `business.facebook.com/settings/partners`.)
3. Go to **Partners** → **Add** → **"Give a partner access to your assets."**
4. Enter **ROXIUM's Business ID** (we provide this number in the request email) → Next.
5. Assign assets and permission levels:
   - **Ad accounts** → select the practice's ad account → enable **View performance**
     (the read/analyst-level option). Full "Manage ad account" is *not* needed for
     reporting.
   - **Pages** → select the practice's Facebook Page → enable the **insights/performance
     view** permission (Meta's granular Page permissions name this "View performance" /
     insights; the classic role equivalent is **Analyst**).
   - **Instagram accounts** → select the IG account → enable **Insights**.
   - **Datasets/Pixels** (optional, only if we've said we need conversion data later) →
     view-level.
6. Confirm. Assets appear in ROXIUM's Business Manager immediately — no invite email to
   wait on.

**Permission philosophy:** for reporting, insights/view-level on each asset is enough and
is what we request by default. If the engagement will grow into ROXIUM *operating* the ads
later, it's legitimate to request broader access on the ad account at that point — ask
again then rather than over-asking now. Under-asking builds trust; upgrading later is a
two-minute change on the same Partners screen.

**What ROXIUM does after the grant (internal):**

1. In our Business Manager → Partners/shared assets, confirm the ad account, Page, and IG
   account arrived.
2. Assign the assets internally to the reporting identity that Coefficient connects
   through.
3. Wire Coefficient → the client workbook's `Meta Ads` / `Instagram` / `Facebook` tabs →
   portal sources `marketing` / `instagram_insights` / `facebook_insights` → **Sync now**
   (see `../ROXIUM_ONBOARDING_SOP.md` §3 and `../coefficient-sheet-template.md`).
4. Mark Meta **Connected** on the Marketing Connections card.

---

## Method 2 — Person access (fallback, no ROXIUM Business ID yet)

The client adds a specific ROXIUM-managed Meta user (tied to our reporting email) to each
asset individually:

- **Ad account:** Business settings → Accounts → Ad accounts → select account →
  **Add people** → our account → **Analyst / View performance**.
- **Facebook Page:** Page → Settings → **Page access** (new Pages experience) → add our
  account with **insights/analyst-level** task access. (Classic Pages: Page roles →
  **Analyst**.)
- **Instagram:** shareable only through the Business Manager asset path; if the client has
  no Business Manager at all, they must create a free business portfolio first (5 minutes,
  we walk them through it on a Tier 3 call) — there is no clean personal-account way to
  delegate IG Insights.

**Limitations to be honest about internally:** person access hangs off one human's Meta
account (bus factor), must be repeated asset-by-asset, and can trip Meta's identity
checks. Treat it as temporary; once our business portfolio exists, ask the client to
re-share via Partners and remove the person-level access.

---

## Troubleshooting (the classics)

| Symptom | Likely cause | Fix |
|---|---|---|
| Client can't find "Partners" | They're in personal Facebook settings, or the wrong business portfolio, or they only have employee access | Direct-link `business.facebook.com/settings/partners`; confirm they're an admin of the portfolio |
| "Give a partner access" asks for a Business ID they don't have | They're reading our instructions backwards — the ID they enter is **ours** | Resend our Business ID; it's a number, not an email |
| IG account not listed under Instagram accounts | IG not connected to the portfolio, or still a personal account | Convert to professional; connect IG to the Page or add as an asset, then redo the grant |
| Page not listed | Page owned by a different portfolio or by a person (unowned) | Find who owns it (old agency?); transfer or grant from the owning side |
| Insights numbers missing in Coefficient despite access | Insights permission not ticked on the asset, or account only has ads permission | Client edits the partner grant on the same screen — add the insights permission |
| Nobody at the practice can grant anything | Assets are parked with a departed agency/web person | Tier 3: run asset-recovery first (contact the old holder; worst case use Meta's Page-ownership support flow), then onboard |

**The one email rule:** if the first async attempt fails for any Meta reason, do not start
an email thread of screenshots. Book the 30-minute Tier 3 call
([`tier3-call-script.md`](tier3-call-script.md)). Live-driving Meta Business settings is
always faster than describing it.
