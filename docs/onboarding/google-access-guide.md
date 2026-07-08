# Google Access Guide — Google Ads, GA4, Google Business Profile

Unlike Meta, Google's products are **separate modules with separate access systems** —
one grant does not cover the others. Request each one the client actually uses, as
separate checklist lines. All grants go to ROXIUM's identities from
[`internal-setup.md`](internal-setup.md): the **manager (MCC) account** for Google Ads
(preferred) and the **reporting Google account** everywhere else.

---

## 1. Google Ads

**Preferred — manager account (MCC) link.** This is Google's equivalent of Meta partner
access: business-to-business, no individual logins on the client's account.

1. Ask the client for their **10-digit Google Ads customer ID** (top-right corner of any
   Google Ads screen, format `123-456-7890`).
2. ROXIUM sends a link request from our manager account: MCC → **Accounts** →
   **Sub-account settings** → **+ Link existing account** → enter their customer ID.
3. The client accepts: Google Ads → **Admin** (wrench) → **Access and security** →
   **Managers** tab → the pending ROXIUM request → **Accept**.
4. On our side, keep our own usage at read/reporting level — we are not managing their
   campaigns unless the engagement says so.

**Fallback — direct email invite** (client has no objection but we want it simple, or the
MCC isn't set up yet):

1. Client: Google Ads → **Admin** → **Access and security** → **Users** → **+** →
   enter ROXIUM's reporting email → access level **Read-only** → Send.
2. We accept the emailed invitation from the reporting account.

**Gotchas:** "Billing-only" and "Email-only" levels exist — make sure they pick
**Read-only**, which includes full reporting visibility. If the client can't find Admin →
Access, they're probably logged into the wrong Google account or only have read access
themselves — that's a Tier 3 flag.

---

## 2. Google Analytics 4 (GA4)

1. Client: **analytics.google.com** → **Admin** (gear, bottom-left) → in the **Property**
   column, **Property access management**.
2. **+** → **Add users** → enter ROXIUM's reporting email → role **Viewer** →
   uncheck "Notify by email" if they prefer → **Add**.
3. Nothing to accept on our side — the property simply appears for the reporting account.

**Notes:**
- **Property**-level Viewer is what we want. Account-level also works but grants more
  scope than we need; don't ask for it.
- If they only have Universal Analytics (deprecated) or no Analytics at all, note it —
  installing GA4 is a separate (billable) task, not an access request.
- If their agency owns the GA4 property under the agency's account, this becomes a
  Tier 1 line on the agency checklist.

---

## 3. Google Business Profile (GBP)

**Honest caveat first:** GBP has **no view-only role** — the available roles are
**Owner** and **Manager**, and Manager can edit the profile. Tell the client this
straight: *"Google doesn't offer a read-only option for Business Profiles, so the
minimum we can be added as is Manager. We'll only use it to read performance data."*
That candor is on-brand and prevents the request from looking like over-reach.

1. Client: go to **business.google.com** (or search their business name in Google while
   signed in and use the profile panel) → select the profile.
2. Open **Business Profile settings** (⋮ menu) → **People and access** (formerly
   "Managers"/"Users").
3. **Add** → enter ROXIUM's reporting email → role **Manager** → **Invite**.
4. We accept the invitation from the reporting account. (New managers of a profile may
   have some capabilities restricted by Google for the first days — expected, harmless
   for reporting.)

**Gotchas:** many practices have never claimed their profile, or an old SEO vendor owns
it. Unclaimed/hostage profiles are an ownership-recovery task (Google has a request-access
flow that emails the current owner with a 3-day response window) — flag it, don't let it
block the rest of onboarding.

---

## 4. YouTube Analytics (recommended tier, same family)

1. Client: **studio.youtube.com** → **Settings** → **Permissions** → **Invite** →
   ROXIUM's reporting email → role **Viewer** → Save.
   (Channels on a classic Brand Account can alternatively add us at
   myaccount.google.com → Brand accounts → manage permissions.)
2. We accept the invite from the reporting account.

---

## After each grant lands (team, internal)

Same pattern as every source (client never sees this): connect the account in Coefficient
from the reporting identity → point the matching workbook tab (`Google Ads`,
`Google Analytics`, `Google Business`, `YouTube`) → add the source in Team Controls with
the matching key (`google_ads`, `google_analytics`, custom key for GBP,
`youtube_analytics`) → **Sync now** → verify numbers → mark **Connected** on the
Marketing Connections card. Pipeline details: `../ROXIUM_ONBOARDING_SOP.md` §3–4,
`../google-reporting-setup.md`.
