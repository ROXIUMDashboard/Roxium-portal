# ROXIUM Data Access Checklist (Universal, Internal)

One checklist per client. Copy this into the client's onboarding notes (or track it on the
practice's Marketing Connections card) and check off each source as access lands. The
right-hand columns map each grant to the reporting pipeline so the team can wire it up
without re-reading the SOP.

**Rules that apply to every row:**

- Access is granted **to ROXIUM's identities** (see [`internal-setup.md`](internal-setup.md)):
  the **Meta Business ID** for the Meta family, the **reporting Google account /
  Google Ads manager account** for the Google family.
- **Read/insights-level permission only.** If a platform's minimum viable role includes
  more (e.g. Google Business Profile has no view-only role), note it and tell the client.
- Never accept a password, a shared login, or a browser session. If a client offers,
  redirect: *"You don't need to do that — the platform has a built-in way to give us
  read-only access, and you stay in full control."*

---

## Required (most clients)

| ✓ | Source | What we ask for | Granted where | Permission level | Portal source key | Workbook tab |
|---|--------|-----------------|---------------|------------------|-------------------|--------------|
| ☐ | **Meta Ads** | Ad account shared with our Business ID as partner | Meta Business Suite → Settings → Business settings → Partners | Ads: **View performance** (Analyst-equivalent) | `marketing` (default) | `Meta Ads` |
| ☐ | **Instagram Insights** | IG professional account shared with our Business ID as partner | Same partner grant — Instagram is an asset in the same screen | **Insights** (view-level) | `instagram_insights` | `Instagram` |
| ☐ | **Facebook Page / Insights** | Facebook Page shared with our Business ID as partner | Same partner grant — Page is an asset in the same screen | **View performance / insights** (Analyst-equivalent) | `facebook_insights` | `Facebook` |
| ☐ | **Google Ads** | Client accepts a link request from our manager (MCC) account, or invites our reporting email | Google Ads → Admin → Access and security | **Read-only** | `google_ads` | `Google Ads` |

The three Meta rows are **one action** for the client — a single partner grant covers ad
account + Instagram + Page. Details and prerequisites: [`meta-access-guide.md`](meta-access-guide.md).

## Recommended (add when the client has them)

| ✓ | Source | What we ask for | Granted where | Permission level | Portal source key | Workbook tab |
|---|--------|-----------------|---------------|------------------|-------------------|--------------|
| ☐ | **Google Analytics (GA4)** | Our reporting email added at the property level | GA4 → Admin → Property access management | **Viewer** | `google_analytics` | `Google Analytics` |
| ☐ | **Google Business Profile** | Our reporting email added to the profile | business.google.com → profile → People and access | **Manager** (GBP has no view-only role — say so up front) | *(add as custom source when wired)* | `Google Business` |
| ☐ | **YouTube Analytics** | Our reporting email added to the channel | YouTube Studio → Settings → Permissions | **Viewer** | `youtube_analytics` | `YouTube` |

## Optional / later

| ✓ | Source | What we ask for | Permission level | Portal source key | Workbook tab |
|---|--------|-----------------|------------------|-------------------|--------------|
| ☐ | **Microsoft Ads** | Invite our reporting email under Account access | **Viewer** | `microsoft_ads` | `Microsoft Ads` |
| ☐ | **Call tracking (e.g. CallRail)** | Read/reporting user | Read-only | *(future — cost-per-lead)* | — |
| ☐ | **CRM / booking (consults & procedures)** | Export or reporting API access | Read-only | *(future — `cons`/`proc` fields exist in schema)* | — |
| ☐ | **Datasets / Pixel (Meta)** | Include in the partner grant if we'll need conversion data later | View | — | — |

---

## After each grant lands (team, internal — invisible to the client)

1. Connect the platform account in Coefficient (or confirm the existing connection can see
   the new asset).
2. Point a tab in the client's master workbook at it (one tab = one source; exact tab names
   above). See `../coefficient-sheet-template.md`.
3. Team Controls → practice → Reporting & KPI → add the source with the matching source key
   + tab name (the `marketing` Meta source already exists from practice creation).
4. **Sync now** → confirm `sheet_sources.last_status = ok` and numbers render on the client
   dashboard for the current month.
5. Flip the source to **Connected** on the Marketing Connections card.

## Verification quick-checks

- **Meta:** in *our* Business Manager, the client's ad account / Page / IG account appear
  under the partner-shared assets, and Ads Manager can open the account in read mode.
- **Google Ads:** the client account appears in our MCC (or our reporting email can open
  the account read-only).
- **GA4:** the property appears in our reporting account's Analytics home.
- **GBP / YouTube:** invitation accepted; profile/channel visible from the reporting account.
