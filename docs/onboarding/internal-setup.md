# ROXIUM Internal Setup — Do Once, Before Scaling Onboarding

Every guide in this pack assumes ROXIUM has a small set of central identities. Without
them, each onboarding degrades to fragile personal-account fallbacks. Budget half a day,
do this once, record the results in the team vault.

## 1. Dedicated reporting email account

Create one address on the company domain — e.g. `reporting@roxium.com` (or the Novexis
domain, but pick **one** and never mix) — used **only** for platform access:

- receives Google Ads / GA4 / GBP / YouTube / Microsoft Ads invitations,
- backs the Google account used for Coefficient and Google Sheets connectors,
- backs the Meta user that administers our Business Manager access internally.

Rules: strong unique password + 2FA in the vault; **never** used as a personal login by
any team member; recovery methods point at company-controlled destinations. This account
is the bus-factor fix — access granted to a departing employee's personal account is the
#1 way agencies lose client connections.

## 2. Meta business portfolio + Business ID

1. At business.facebook.com, create (or claim) the **ROXIUM business portfolio**, owned
   via the reporting identity, with at least two team members as admins (redundancy).
2. Note the **Business ID** (Business settings → Business info — a long number). This is
   the number every client enters in the Partners flow; put it in every template.
3. Complete business verification if prompted — verified portfolios hit fewer friction
   walls when clients share assets.

Until this exists, all Meta onboarding runs on the person-access fallback in
[`meta-access-guide.md`](meta-access-guide.md) — workable, not scalable. Once it exists,
migrate fallback clients to partner access at the next touchpoint.

## 3. Google identities

- **Reporting Google account** — the Google side of `reporting@roxium.com`. Used for GA4
  Viewer grants, GBP Manager grants, YouTube Viewer grants, and as the Coefficient /
  Sheets connector identity.
- **Google Ads manager account (MCC)** — create at ads.google.com/home/tools/manager-accounts
  under the reporting account. Client Google Ads accounts link to this via customer-ID
  requests — the professional, per-client-loginless path.
- The Sheets **service account** (`roxium-sync@…`) for portal ingestion already exists —
  see `../google-reporting-setup.md` Part A. It's separate from the reporting account and
  stays that way (robot reads sheets; human-ish account holds platform access).

## 4. The onboarding kit (assemble once, reuse forever)

- ☐ This docs pack, with **Business ID + reporting email filled into** the
  [agency checklist](agency-checklist.md) and [client checklist](client-checklist.md).
- ☐ The recorded [demo video](demo-video-script.md) hosted at a stable link.
- ☐ Email templates: Tier 1 (to agency), Tier 2 (to coordinator), Tier 3 (call booking),
  and the post-call recap — each embedding the matching checklist/video.
- ☐ Internal FAQ: the troubleshooting tables from the Meta/Google guides.

## 5. Marketing Connections status card (portal)

Per practice, the team needs one glanceable answer to "what's live and what's stuck?"

**Today:** the practice's `sheet_sources` rows already carry `last_status` /
`last_synced_at` — Team Controls → Reporting & KPI plus the onboarding checklist
(Access ✓ / Sheet ✓ / Sync ✓) is the interim card. Track not-yet-granted platforms in the
Needs-Attention queue so nothing ages silently.

**Build next (small portal enhancement):** a per-practice **Marketing Connections** card
showing each source as `Requested → Granted → Connected → Syncing ✓ / Error`, with a
requested-date so the 5-business-day escalation rule (see [README](README.md)) is visible
company-wide from the Operations Dashboard. The gap between today's card and this spec:
`sheet_sources` only knows about sources after they're wired — the card adds the
pre-pipeline states (Requested/Granted) so access-chasing is tracked in the same place.

## Quick-reference block (fill in and pin)

| Item | Value |
|---|---|
| Reporting email | `reporting@…` *(fill in)* |
| Meta Business ID | *(fill in)* |
| Google Ads MCC customer ID | *(fill in)* |
| Sheets service account | `roxium-sync@roxium-portal.iam.gserviceaccount.com` |
| Demo video link | *(fill in)* |
