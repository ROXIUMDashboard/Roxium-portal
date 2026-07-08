# ROXIUM Marketing Data Onboarding System

> **Audience:** ROXIUM team. This directory is the complete, repeatable system for getting
> delegated read access to a client's marketing platforms and lighting up their portal
> dashboard. It complements `../ROXIUM_ONBOARDING_SOP.md` (which covers the portal side —
> creating the practice, invites, workbook, sync). This pack covers the **client side** —
> how the practice grants us access, tiered by how marketing-savvy they are.

**Non-negotiable principles (repeat these to clients):**

1. **No password sharing, ever.** Every platform has a native "add partner / add user /
   grant access" flow. That is the only mechanism we use.
2. **Delegated read access only.** We request the minimum permission that includes
   insights/performance visibility. We do not ask for publish, edit, or billing rights
   for reporting.
3. **Coefficient is internal.** Clients never hear the word Coefficient. The client-facing
   language is: *"We handle all reporting setup. We only need read-only access to your
   marketing platforms. You don't share any passwords. We connect your existing marketing
   data into your ROXIUM portal."*
4. **Meta is the anchor.** Instagram, Facebook Pages, and Meta Ads are one family of
   business assets granted in one place (Meta Business Suite → Partners). Get Meta right
   first; Google Ads / GA4 / GBP are separate modules on the same checklist.

---

## The 3-tier intake flow

The first question on every kickoff is: **"Who manages your marketing accounts today?"**
The answer routes the client into exactly one track:

| Tier | Client situation | Who does the granting | ROXIUM motion | Expected effort |
|------|------------------|----------------------|---------------|-----------------|
| **Tier 1 — Agency** | An existing agency runs their ads/social | The agency (they already know these flows) | Email the agency the [one-page agency checklist](agency-checklist.md) with our Business ID + reporting email. CC the client. Done async. | 10–15 min, fully async |
| **Tier 2 — In-house** | An office manager / coordinator handles marketing | The coordinator, self-serve | Send the [client-facing checklist](client-checklist.md) + the [demo video](demo-video-script.md). Offer a 15-min screen-share if they stall. | 15–30 min, async with light support |
| **Tier 3 — Nobody knows** | The surgeon "has an Instagram" but no one owns the accounts | ROXIUM, live, hand-in-hand | Book a 30–45 min screen-share and run the [live call script](tier3-call-script.md). We drive, they click. | 30–45 min live call |

**Routing rules:**

- If the answer is "our agency," it's Tier 1 — even if the client offers to do it
  themselves. Agencies finish in minutes; clients take days.
- If the client mentions a specific person by name ("Jessica handles our Facebook"),
  it's Tier 2. Send materials **to that person directly**, CC the doctor.
- Any hesitation, confusion, or "I think my old web guy set that up" → Tier 3.
  **Do not troubleshoot Meta permissions over email.** Async permission debugging is the
  single biggest time sink in onboarding; a live call is always faster.
- A client can be different tiers per platform (agency runs Meta Ads, nobody knows the
  GA4 login). Track each source separately on the checklist.

**Escalation:** if a Tier 1/2 client hasn't completed access within **5 business days**,
escalate one tier (send the video, then book the call). Never let access requests age
silently — the portal's per-client checklist (Access ✓ / Sheet ✓ / Sync ✓) and the
Needs-Attention queue are the tracking surface.

---

## Files in this pack

| File | What it is | Deliverable |
|------|-----------|-------------|
| [`data-access-checklist.md`](data-access-checklist.md) | Universal internal checklist — every platform, required/recommended/optional, with exact permission names | Internal |
| [`meta-access-guide.md`](meta-access-guide.md) | Meta family deep-dive: partner access, Instagram prerequisites, fallbacks | Internal + adaptable |
| [`google-access-guide.md`](google-access-guide.md) | Google Ads, GA4, Google Business Profile access | Internal + adaptable |
| [`tier3-call-script.md`](tier3-call-script.md) | 30-minute live onboarding call script | Internal |
| [`why-roxium.md`](why-roxium.md) | "Why not just Meta Business Suite?" — the value narrative | Client-facing |
| [`internal-setup.md`](internal-setup.md) | One-time ROXIUM setup: reporting identity, Meta Business ID, Google MCC, status card | Internal, do first |
| [`agency-checklist.md`](agency-checklist.md) | One-page checklist to send to a client's agency (Tier 1) | Send to agencies |
| [`client-checklist.md`](client-checklist.md) | Simplified plain-language checklist for in-house staff (Tier 2) | Send to clients |
| [`demo-video-script.md`](demo-video-script.md) | 2–4 min screen-recording script: granting Meta access | Record once, reuse |

**Order of operations for the team:**

1. Complete [`internal-setup.md`](internal-setup.md) **once** before onboarding at scale
   (without a Meta Business ID and reporting email, every guide below degrades to its
   fallback path).
2. On each kickoff call, ask the routing question, pick the tier, send the matching asset.
3. Track per-platform status on the practice's Marketing Connections card / onboarding
   checklist in the portal.
4. As each grant lands, the team wires Coefficient → workbook tab → portal source
   (see `../ROXIUM_ONBOARDING_SOP.md` §3–4 and `../google-reporting-setup.md`). The client
   never sees this step.
