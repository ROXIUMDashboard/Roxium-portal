# 13 · External Configuration

Everything here requires the **account owner**, not a developer. Credential and
configuration items are listed **by name only** — no values appear in this repository's
handoff.

Legend: ✅ Already Implemented (code is done and wired) · 🟡 Needs Configuration (code is
ready, something external is missing or unverified) · 🔴 Missing (no code yet)

> Anything marked **UNVERIFIED** could not be checked from the repository. The status
> reflects *code readiness*; the external state must be confirmed in the relevant
> dashboard.

---

## 1 · GitHub

| | |
|---|---|
| **Purpose** | Source of truth for code; `main` triggers both deploys |
| **Status** | ✅ Already Implemented |
| **Config required by name** | Repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` |
| **Where it belongs** | GitHub → Settings → Secrets and variables → Actions |
| **Still requires external setup** | Confirm all four exist; the Pages workflow fails fast on the two Cloudflare ones, the Supabase workflow does not validate its two |

## 2 · Cloudflare Pages

| | |
|---|---|
| **Purpose** | Production hosting for the static portal + marketing site |
| **Status** | ✅ Already Implemented (🟡 for the custom domain) |
| **Config by name** | Pages project `roxium-portal`, production branch `main`; API token scoped to Cloudflare Pages:Edit; account id |
| **Where** | Cloudflare dashboard → Workers & Pages |
| **Still requires external setup** | (a) attach the custom domain; (b) **confirm no dashboard "Git integration" exists on this project** — a second auto-build races the Action; (c) consider adding a CSP via a Pages rule or `_headers` |
| **UNVERIFIED** | domain attachment, absence of a Git integration |

## 3 · Cloudflare DNS

| | |
|---|---|
| **Purpose** | The domain, plus every email-authentication record |
| **Status** | 🟡 Needs Configuration |
| **Config by name** | Resend DKIM record(s), SPF / return-path records, `_dmarc` TXT record. All must be added **DNS-only (grey cloud)** |
| **Still requires external setup** | Likely all of the email records — `docs/email-deliverability.md` assesses them as absent, which is the Outlook problem |

## 4 · Supabase — project & database

| | |
|---|---|
| **Purpose** | Postgres, Auth, Storage, RLS, Edge Functions. The backend |
| **Status** | ✅ Implemented · 🟡 for migration application |
| **Config by name** | `SUPABASE_URL` + anon key (already in `config.js`); service-role key (auto-injected into functions) |
| **Still requires external setup** | **Apply every file in `migrations/` in filename order and confirm it.** There is no ledger, no CI step and no way to verify from the repo. This is the highest-value single external action |
| **UNVERIFIED** | which migrations are applied |

## 5 · Supabase Auth

| | |
|---|---|
| **Purpose** | Magic-link / OTP sign-in |
| **Status** | 🟡 Needs Configuration |
| **Config by name** | Email provider enabled; **Site URL**; **Redirect URLs** (`https://<domain>/**`, plus `https://roxium-portal.pages.dev/**` while testing); **"Allow new users to sign up"**; rate limits (emails/hour, OTP verifications); email templates |
| **Where** | Authentication → Providers / URL Configuration / Rate Limits / Emails |
| **Still requires external setup** | (a) Site URL + Redirect URLs must include the **exact origin users load** — `emailRedirectTo` is `location.origin + '/portal/'`, and a mismatch is the documented cause of post-login 404s; (b) **decide and set the signup flag** — today the code says closed and the project setting is unknown; (c) raise the email rate limit before real onboarding volume; (d) paste `docs/email-templates/invite.html` and `magic-link.html` into the Invite and Magic Link templates with the subjects named in `docs/email-deliverability.md` |
| **UNVERIFIED** | all of the above |

## 6 · Supabase Edge Function secrets

**Status:** 🟡 Needs Configuration (code ✅ for all).
Set under Supabase → Edge Functions → Secrets. Names only:

| Secret | Required for | If absent |
|---|---|---|
| `SYNC_SECRET` | cron auth + OAuth state HMAC | `oauth-start` 500s; cron calls are rejected |
| `SITE_URL` | every email link + the OAuth bounce-back | links fall back to the project Site URL; invites may land on the wrong host |
| `RESEND_API_KEY` | all outbound email | functions succeed with `emailed:0` — invites are created but never delivered |
| `EMAIL_FROM` | all outbound email | defaults to `ROXIUM <updates@roxium.com>`, which must be Resend-verified |
| `COMPOSIO_API_KEY` | every self-service connection | `sync-platforms` 500s; `oauth-start` reports `configured:false` |
| `COMPOSIO_META_AUTH_CONFIG_ID` | Meta connect | Meta shows "our team will wire this up" |
| `COMPOSIO_GOOGLE_AUTH_CONFIG_ID` | Google Ads connect | Google shows the same |
| `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID` | any other provider | that provider cannot be connected — **no code change needed to add one** |
| `GOOGLE_SA_KEY` | Sheets/Drive ingestion | `sheets_api` mode throws |
| `INGESTION_MODE` | `csv` (default) / `sheets_api` | stays on the legacy public-CSV path |
| `REPORTING_FOLDER_ID` | workbook auto-discovery | the "Detect workbook" admin action cannot search |
| `CSV_URL`, `KPI_SOURCE` | legacy single-CSV job | that job does not run |
| `ASANA_TOKEN` | `asana-sync` | 500 |
| `ASANA_SECRET` | `asana-webhook` | returns 503 "not configured" |
| `DIGEST_ENABLED`, `DIGEST_TO` | weekly ops digest | digest returns early — **it is off by default** |
| `DEMO_NOTIFY_EMAIL` | demo-request routing | falls back to a hard-coded default |
| `META_APP_ID` / `META_APP_SECRET` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **nothing — dead code** | no effect; safe to delete |

## 7 · Supabase cron (pg_cron / pg_net)

| | |
|---|---|
| **Purpose** | The 2-hourly marketing sync and the weekly ops digest |
| **Status** | 🟡 Needs Configuration |
| **Config by name** | A scheduled job POSTing to `/functions/v1/sync-platforms` and `/functions/v1/sync-coefficient` with header `x-sync-key: <SYNC_SECRET>`; a weekly job for `/functions/v1/weekly-digest` |
| **Still requires external setup** | **No cron definition exists anywhere in the repository.** Whether these jobs exist and at what cadence must be checked in the database. Without them, data only refreshes when a client clicks "Refresh now" or a team member runs "Sync now" |
| **UNVERIFIED** | existence and schedule of every job |

## 8 · Composio

| | |
|---|---|
| **Purpose** | Holds every practice's Meta / Google OAuth token; brokers consent and tool execution. **ROXIUM registers no Meta or Google developer app for connections** |
| **Status** | ✅ Implemented (code) · 🟡 Needs Configuration |
| **Config by name** | Org API key; one **managed auth config** per toolkit (`metaads`, `googleads`, and any future toolkit), whose `ac_…` id becomes the matching `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID` secret |
| **OAuth redirect URLs** | **None on ROXIUM's side for the provider.** `oauth-start` passes `<SUPABASE_URL>/functions/v1/oauth-callback?state=…` as the Composio `callback_url`; Composio owns the provider-side redirect URI |
| **Scopes** | Set **in the Composio auth config**, not in this code. The scope arrays in `_shared/oauth.ts` belong to the dead first-party path and are not requested |
| **Required APIs** | Composio's `metaads` and `googleads` toolkits enabled on the account |
| **Tools used** | `METAADS_GET_AD_ACCOUNTS`, `METAADS_GET_INSIGHTS`, `GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS`, `GOOGLEADS_SEARCH_STREAM_GAQL` |
| **Still requires external setup** | Create/confirm the two auth configs and set their ids; confirm the plan's quota, since Composio's managed Google Ads auth uses a **shared developer token** whose daily quota the code explicitly handles as a 429 |
| **UNVERIFIED** | account existence, config ids, plan limits |

## 9 · Google Ads

| | |
|---|---|
| **Purpose** | Spend / impressions / clicks per campaign per day |
| **Status** | ✅ Implemented via Composio |
| **Config by name** | The client's Google account must have Google Ads access; a non-manager customer must be reachable |
| **Required APIs** | Google Ads API — **provided by Composio's managed auth**, including its developer token |
| **Verification/approval state** | ⚠ **ROXIUM's own Google Ads API Basic Access approval is not used by this pipeline.** It would only matter if the first-party OAuth path (`providerConfig()`, currently dead) were revived. If the intent is to use ROXIUM's approved developer token, that is a **new build**, not a configuration change — see Q4 in `15_…` |
| **Known failure modes** | no accessible customer; manager-only access (`REQUESTED_METRICS_FOR_MANAGER`); `RESOURCE_EXHAUSTED` on the shared token |
| **Gap** | Reach is not retrieved and is not available from the `campaign` resource — see `04_…` §6 |

## 10 · Meta (Facebook / Instagram) Ads

| | |
|---|---|
| **Purpose** | Spend / **reach** / impressions / clicks, monthly and daily |
| **Status** | ✅ Implemented via Composio |
| **Config by name** | The client's Facebook login must have access to the ad account |
| **Redirect URLs / scopes** | Owned by Composio |
| **Still requires external setup** | The Composio `metaads` auth config only. Note that Meta business-permission review lives on Composio's app, not ROXIUM's |

## 11 · Google Analytics · YouTube · Microsoft Ads · Google Business Profile · TikTok · LinkedIn · CallRail · HubSpot

| | |
|---|---|
| **Purpose** | Offered in the client-facing "Add data source" catalog |
| **Status** | 🔴 **Missing** — connect flow ✅ (registry-driven), **ingestion 🔴** |
| **Still requires** | (1) a Composio auth config + secret per provider to make Connect work; (2) **a `pull<Provider>()` implementation in `sync-platforms` for each** — without it the connection reports "synced" and imports nothing (bug R-13) |

## 12 · Google Cloud service account (Sheets / Drive)

| | |
|---|---|
| **Purpose** | The legacy Coefficient/Sheets ingestion path |
| **Status** | ✅ Implemented · 🟡 Needs Configuration |
| **Config by name** | Service-account JSON in `GOOGLE_SA_KEY`; `REPORTING_FOLDER_ID` |
| **Required APIs** | Google Sheets API, Google Drive API |
| **Scopes** | `spreadsheets.readonly`, `drive.readonly` (minted in-code as a JWT grant) |
| **Still requires external setup** | Each client's master workbook (and the master Drive folder) must be **shared as Viewer with the service-account email** |

## 13 · Coefficient

| | |
|---|---|
| **Purpose** | Pushes ad-platform data into each client's Google Sheet on a schedule |
| **Status** | 🟡 Needs Configuration — entirely external; no code touches Coefficient |
| **Still requires** | A Coefficient account, per-client sheet imports, and tab names matching `sheet_sources.tab_name`. `docs/coefficient-sheet-template.md` + `docs/coefficient-template.csv` define the expected layout |

## 14 · Resend

| | |
|---|---|
| **Purpose** | All transactional email, and (recommended) Supabase Auth SMTP |
| **Status** | ✅ Implemented (code) · 🟡 Needs Configuration |
| **Config by name** | API key; verified sending domain; the sender address used in `EMAIL_FROM` |
| **Still requires external setup** | (1) verify `roxium.com` or `mail.roxium.com`; (2) add the DKIM/SPF records in Cloudflare DNS-only; (3) add `_dmarc`; (4) point Supabase Auth custom SMTP at `smtp.resend.com` so **sign-in** emails are branded and deliverable |
| **UNVERIFIED** | domain verification state |

## 15 · Asana

| | |
|---|---|
| **Purpose** | Feed completed internal tasks into client-facing deliverables/activity |
| **Status** | 🟡 code scaffolded, **not operational** |
| **Config by name** | `ASANA_TOKEN` (PAT or app token); `ASANA_SECRET` for the webhook |
| **Still requires external setup** | A project id per practice (there is **no column to store it** — `asana-sync` takes `project_id` as a request parameter, so something must supply it); a schedule or webhook registration; and a UI/mapping. Treat as a build, not a config |

## 16 · Zapier / Make / LeadConnector

| | |
|---|---|
| **Status** | 🔴 Missing — **no code anywhere.** Mentioned only as suggestions in `README.md` and `ARCHITECTURE.md`. The `asana-webhook` function is generic enough to be called by any of them |

## 17 · Domain strategy (open decision)

`docs/DOMAIN_ARCHITECTURE.md` recommends moving the software to `roxiumstudio.com` /
`app.roxiumstudio.com` with marketing staying on `roxium.com`. **Status 🔴 not
implemented.** Nothing in the code hard-codes a host, so the work is: Pages custom domain,
Supabase Site URL + Redirect URLs, the `SITE_URL` secret, the Resend verified domain, and
the `roxium.com` back-links in `portal/index.html`.
**Note:** `roxium.studio` appears nowhere in the repository — the proposal is
`roxiumstudio.com`.
