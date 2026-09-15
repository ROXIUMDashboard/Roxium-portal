# 04 · Marketing Data Architecture

---

## 0 · The headline

There are **two complete, simultaneously-live ingestion pipelines** writing into the same
two tables, plus a third (manual) path that no longer has a UI.

```
GEN-2 (current)   practice owner → Composio hosted consent → platform_connections
                  cron/POST → sync-platforms → Composio tools API → Meta / Google Ads
                            → kpi_monthly (source 'marketing' | 'google_ads')
                            → kpi_daily   (same source keys)

GEN-1 (legacy,    ROXIUM Google service account → client's master Google Sheet
 still live)      cron/POST → sync-coefficient → tabs named in sheet_sources
                            → kpi_monthly / kpi_daily (source = the tab's channel key)
                            → sync_runs (audit) → finalize_past_months()

GEN-0 (retired)   .xlsx KPI workbook import  → XL_MAP → kpi_monthly
                  Referenced in README.md; the importer UI is no longer present in app.js.
```

Downstream, `app.js` cannot tell them apart: everything is folded by
`normalizeKpiRows()` → `mergeKpiByPeriod()` on `(period, canonical source)`.

**No Composio/Zapier/Make/LeadConnector logic exists beyond Composio itself.**
`grep -ri "zapier\|make\.com\|leadconnector"` across the code returns only prose in
`README.md` and `ARCHITECTURE.md`. There is no intermediary automation layer in code.

---

## 1 · Composio (the integration broker)

`supabase/functions/_shared/composio.ts`

- Base `https://backend.composio.dev/api/v3`, auth header `x-api-key: COMPOSIO_API_KEY`.
- **Provider registry is env-driven, not code-driven:**
  `composioProvider('meta')` reads `COMPOSIO_META_AUTH_CONFIG_ID`;
  `composioProvider('google_analytics')` reads `COMPOSIO_GOOGLE_ANALYTICS_AUTH_CONFIG_ID`.
  A provider with no secret returns `null` → `oauth-start` answers
  `{ok:true, configured:false}` and the UI says "our team wires this one up for you".
- `createLink(authConfigId, userId, callbackUrl)` → `POST /connected_accounts/link`.
  **`userId` is the ROXIUM `practice_id`** — that is the entire tenancy mapping into
  Composio.
- `getConnectedAccount(id)` → status / user_id / toolkit / label; used by the callback to
  reject a replayed or mismatched connection.
- `executeTool(slug, userId, args, connectedAccountId)` → `POST /tools/execute/<slug>`
  with `{arguments, user_id, version:'latest'}`. Composio injects the practice's token.
- `deleteConnectedAccount(id)` → used best-effort during account teardown.

**ROXIUM holds no Meta or Google OAuth credentials for the connections path.** There is
no client_id, no client_secret, no access token, no refresh token, and no refresh logic
anywhere in this pipeline. That is by design and it removes a whole class of token bugs
— at the cost of a hard dependency on Composio and on Composio's shared developer-token
quotas (which the code explicitly handles with a 429 retry, `sync-platforms/index.ts:50-58`).

---

## 2 · Credential storage — where every secret lives

| Credential | Stored where | Used by |
|---|---|---|
| Supabase URL + **anon** key | `config.js`, committed | browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Edge secret (auto-injected) | every function |
| `COMPOSIO_API_KEY` | Edge secret | `_shared/composio.ts` |
| `COMPOSIO_<PROVIDER>_AUTH_CONFIG_ID` | Edge secret, one per provider | `oauth-start` |
| Meta / Google **user tokens** | **Composio**, keyed by `practice_id` | never in our DB |
| `GOOGLE_SA_KEY` (service-account JSON) | Edge secret | `sync-coefficient` sheets/Drive |
| `SYNC_SECRET` | Edge secret | HMAC state signing + `x-sync-key` cron auth |
| `RESEND_API_KEY`, `EMAIL_FROM` | Edge secret | all outbound email |
| `ASANA_TOKEN`, `ASANA_SECRET` | Edge secret | asana functions |
| `META_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET` | Edge secret (**unused**) | dead `providerConfig()` |
| `platform_tokens` table | exists, RLS-locked, **never written** | nothing |

---

## 3 · OAuth flow (Gen-2), end to end

```
1. app.js:2050 startPlatformConnect(provider)
      sb.functions.invoke('oauth-start', {provider, practice_id})       [caller JWT]

2. oauth-start/index.ts
      verify caller is team OR a member of practice_id
      composioProvider(provider) → authConfigId   (else → configured:false)
      state = signState({p:practice_id, v:provider, u:uid, ts:now}, SYNC_SECRET)
              = base64url(JSON) + '.' + HMAC-SHA256
      cb = <SUPABASE_URL>/functions/v1/oauth-callback?state=<state>
      createLink(authConfigId, practice_id, cb) → Composio redirect URL
      upsert platform_connections {status:'pending', composio_connection_id, connected_by}
      → browser location.href = redirectUrl

3. Composio-hosted consent (Meta / Google login) — ROXIUM never sees the credentials

4. oauth-callback/index.ts    GET ?state=…&status=success&connected_account_id=ca_…
      verifyState(state, SYNC_SECRET)   — rejects tampering, 2-hour max age
      getConnectedAccount(caId)
        acct.userId  must equal state.p          → else "connection ownership mismatch"
        acct.status  must be ACTIVE|CONNECTED    → else "not active yet"
      upsert platform_connections {status:'connected', external_account_name, last_error:null}
      fire-and-forget POST sync-platforms {practice_id, provider} with x-sync-key
      302 → <SITE_URL>/portal/?connected=<provider>     (or ?connect_error=<reason>)

5. app.js:1832 maybeOpenWizardFromOAuthReturn() reads ?connected / ?connect_error
```

**Scopes:** decided entirely by the Composio auth config in Composio's dashboard.
The scope arrays in `_shared/oauth.ts:50-78` belong to the dead first-party path and are
**not** what is requested. `platform_connections.scopes` is never written.

**Refresh:** none in our code. Composio refreshes. When it can't, `executeTool` throws
and `sync-platforms` classifies the message:
`/expired|invalid_grant|revoked|not active|reconnect|unauthorized|\b401\b/` → `status='error'`
(client sees "Needs reconnecting"); everything else stays `connected` with `last_error`
set, and the cron retries.

---

## 4 · Per-integration detail

### 4.1 Meta / Facebook / Instagram Ads — `pullMeta()` (`sync-platforms/index.ts:118-196`)

| | |
|---|---|
| Connect | Composio `metaads` toolkit via `COMPOSIO_META_AUTH_CONFIG_ID` |
| Account discovery | `METAADS_GET_AD_ACCOUNTS` `{limit:50, fields:"id,account_id,name"}` → persisted to `platform_connections.accounts`, first account auto-selected into `external_account_id` |
| Monthly | for each of the last **6** months: `METAADS_GET_INSIGHTS` `{object_id, level:'account', time_range:{since,until}, fields:['spend','reach','impressions','clicks']}` — a whole-month window, deliberately, because Meta deduplicates reach across the window |
| Daily | one **single-day** `METAADS_GET_INSIGHTS` call per day, walking from `max(kpi_daily.day) - 2` (or `today-30` with no history), capped at `MAX_DAY_CALLS = 14` per run. The Composio tool has no `time_increment`, so a multi-day pull would collapse to one aggregate row |
| Writes | `kpi_monthly` (`source:'marketing'`) `spend, reach, impr, clicks`; `kpi_daily` (same) |
| Cost | up to 6 + 14 = 20 serial Composio calls per practice per run |

### 4.2 Google Ads — `pullGoogleAds()` (`sync-platforms/index.ts:200-294`)

| | |
|---|---|
| Connect | Composio `googleads` toolkit via `COMPOSIO_GOOGLE_AUTH_CONFIG_ID`. **No ROXIUM developer token** — Composio's managed auth carries its own |
| Account discovery | `GOOGLEADS_LIST_ACCESSIBLE_CUSTOMERS`, then a recursive walk for `customers/<digits>` or bare 10-digit ids; the full list is persisted to `accounts`; then it **tries each customer in turn** until one answers the metrics query (managers/MCC reject with `REQUESTED_METRICS_FOR_MANAGER`) |
| Query | one `GOOGLEADS_SEARCH_STREAM_GAQL`:<br>`SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks FROM campaign WHERE segments.date BETWEEN '<today-180d>' AND '<today>'` |
| Writes | `kpi_daily` (`source:'google_ads'`) `spend (cost_micros/1e6, rounded to cents), impr, clicks`; `kpi_monthly` derived by summing days |
| **Does NOT write** | `reach` — see §6 |
| Known history | the discovery step exists *because* omitting `customer_id` made Google answer `403 PERMISSION_DENIED`; commit `b8c6c1c` "fix(sync-platforms): Google customer_id discovery + daily KPI ingestion" |

**Why Google Ads may still be failing:**
1. `COMPOSIO_GOOGLE_AUTH_CONFIG_ID` unset → `oauth-start` returns `configured:false` and
   the Connect button shows the "our team will wire this up" message. This looks like a
   failed connection to a user.
2. The connecting Google identity has no Google Ads access → `discoverGoogleCustomers`
   returns `[]` → "no google ads account accessible for this connection".
3. Only manager (MCC) accounts are accessible → every candidate rejects metrics → the
   last error is surfaced.
4. Composio's shared Google Ads developer token hits a **daily** quota →
   `RESOURCE_EXHAUSTED`; the single 5-second retry (`withRetry429`) does not help, the
   connection stays `connected` with `last_error`, and the client sees
   "Connected — last sync had an issue".
5. **Basic Access approval on ROXIUM's own Google Ads developer token is irrelevant to
   this pipeline** — the tokens are Composio's, not ROXIUM's. If the intent is to use
   ROXIUM's own approved developer token, that requires the *first-party* path, which is
   dead code today.

### 4.3 Google Analytics, YouTube, Microsoft Ads, GBP, TikTok, LinkedIn, CallRail, HubSpot
Present in `PLATFORM_CATALOG` (`app.js:1920-1933`) so the "Add data source" catalog
offers 12 platforms. **Only `meta` and `google` have ingestion.** `sync-platforms` ends
with:
```js
else result = { skipped: "ingestion for this platform is handled by ROXIUM" };
```
and marks `last_synced_at = now()`, so a connected TikTok account reports "Connected,
last sync just now" while importing nothing. Facebook/Instagram Insights, YouTube and
Microsoft Ads also have `CHANNELS` entries (`app.js:188`) for the Gen-1 sheet path.

### 4.4 Coefficient / Google Sheets — `sync-coefficient`

| | |
|---|---|
| Auth to Google | service-account JSON in `GOOGLE_SA_KEY`, RS256 JWT grant, scopes `spreadsheets.readonly` + `drive.readonly` |
| Modes | `INGESTION_MODE=csv` (**default**, legacy published-CSV per tab) or `sheets_api` (private workbook, the documented target) |
| Config | `practices.workbook_sheet_id` = one master workbook per client; `sheet_sources` rows map channel → `tab_name`/`gid` |
| Discovery | `driveListInFolder(REPORTING_FOLDER_ID)` + `matchWorkbook()` fuzzy name match; `listTabs()` + `guessSource()` for the admin "Detect tabs" button |
| Parsing | `detectShape()` handles **wide** (metrics down rows, months across columns) and **long** layouts, and `classifyGranularity()` decides daily vs monthly. `COLUMN_ALIASES` (lines 24-36) maps ~45 human header spellings onto DB columns, normalized by `normHeader()` |
| Additive set | `spend, impr, clicks, lpv, reach, page_engagement` are summed per month; followers / page likes take latest |
| Writes | `kpi_monthly`, `kpi_daily`, then `rpc('finalize_past_months')`, then a `sync_runs` audit row, then per-source `last_synced_at/last_status/last_error/last_rows/last_months` |
| Side effect | the `sheet_sources` trigger auto-flips `access_status` → `connected` on a successful sync |

`CSV_URL` and `KPI_SOURCE` env vars still support a single global legacy CSV job.

### 4.5 Manual entry
`FIELDS` + `fillKpiForm()` (`app.js:2681`) render a team-only manual KPI form for
`spend, reach, impr, clicks, lpv, page_likes, foll` against `entryPeriod()`.
`XL_MAP` (`app.js:15`) still maps workbook headers, but the **.xlsx import UI referenced
in `README.md` is no longer present in `app.js`** (`xlsx.full.min.js` is not loaded by
`portal/index.html`). There is **no** calculator/manual entry for revenue, customers or
conversions — those columns (`cons`, `proc`, `apv`, `price`) exist in the table but have
no writer.

### 4.6 Asana
`asana-sync` maps sections→`phase`, tasks→`deliverables.name`, `completed`→`delivered`,
idempotent on `deliverables.asana_task_id`; truncates at 100 tasks; requires
`ASANA_TOKEN` + `SYNC_SECRET`. `asana-webhook` inserts `{practice_id, message}` into
`activity` behind `x-asana-secret`. **Neither is scheduled and neither has a UI.**

---

## 5 · Metric-by-metric trace

`app.js:24-46` defines the metric model. `metricValue(def, m)` = `def.derive(m)` for
derived metrics, else `N(m, def.k)` (`null` when the column is null/empty — a null metric
renders `—` and its card is not drawn).

| Metric | Key | Source of truth | Path |
|---|---|---|---|
| **Spend** | `spend` | Meta `spend`; Google `metrics.cost_micros / 1e6`; sheet `amount spent\|cost\|ad spend\|…` | additive across sources (`KPI_ADDITIVE`, `app.js:899`) |
| **Impressions** | `impr` | Meta `impressions`; Google `metrics.impressions`; sheet `impressions\|impr\|…` | additive |
| **Clicks** | `clicks` | Meta `clicks ?? inline_link_clicks`; Google `metrics.clicks`; sheet `link clicks\|outbound clicks\|…` | additive |
| **Reach** | `reach` | **Meta only** | see §6 |
| **Landing page views** | `lpv` | sheet only | additive; `hideIfZero` |
| **Page engagement / likes / followers** | `page_engagement`, `page_likes`, `foll` | sheet only | `page_engagement` additive; the other two take latest |
| **CTR** | derived | `clicks / impr` | `app.js:30` |
| **CPM** | derived | `spend / (impr/1000)` | `lowerBetter` |
| **CPC** | derived | `spend / clicks` | `lowerBetter` |
| **Frequency** | derived | `impr / reach` | **inherits every Reach problem** |
| **Leads / CPL** | `leads`, derived | *no writer exists* | CPL is a default dashboard card (`DEFAULT_KPI_CARDS`, `app.js:84`) that will always render `—` |
| **Consults / Procedures** | `cons`, `proc` | *no writer exists* | ops rollup only |
| **Revenue** | — | **does not exist** | no column, no metric, no UI |
| **Conversions** | — | **does not exist** as such | closest proxies are `lpv` and `leads` |

Aggregation rules:
- `normalizeKpiRows()` (`app.js:171`) folds `meta`/`coefficient`/null onto the canonical
  `marketing` source and keeps the most recently `updated_at` row per `(period, source)`.
- `mergeKpiByPeriod()` (`app.js:923`) sums `KPI_ADDITIVE` keys across sources for a month
  and takes last-write-wins for everything else. **Null values are skipped**, so a null
  stays null.
- `aggregateCompanyKpiByMonth()` (`app.js:4668`) and `summarizeKpiRange()` (`app.js:1031`)
  do **not** skip nulls — they seed at `0` and add `N(r,k) || 0`.

**Date periods.** `period` is always the first of the month as a plain `date`. There is no
"today / this week" KPI concept anywhere: the smallest granularity is a `kpi_daily` row,
and the pickers offer months (`monthOptions`, `buildOpsMonthPicker`) plus an
`ALL_MONTHS` sentinel. `buildDailyChartSeries()` (`app.js:999`) builds a full calendar
month and nulls out future days of the live month. "Today", "This week" and
"This month" as first-class KPI ranges **do not exist and would be new work.**

---

## 6 · Reach — the exact trace, and why it can read 0

**Code path**
```
Meta:   sync-platforms/index.ts:151  fields:['spend','reach','impressions','clicks']
        :155  agg.reach += num(row.reach)          ← num() returns 0 for non-finite
        :161  kpi_monthly.upsert({ …, reach: agg.reach, source:'marketing' })
        :186  kpi_daily.upsert({ …, reach: agg.reach, source:'marketing' })

Google: sync-platforms/index.ts:213  GAQL selects ONLY cost_micros, impressions, clicks
        :277  daily rows  = { spend, impr, clicks }        ← no `reach` key at all
        :282  monthly rows= { spend, impr, clicks }        ← no `reach` key at all

Sheets: sync-coefficient/index.ts:27  "reach"|"unique reach"|"people reached" → reach
        :45  ADDITIVE includes "reach" → daily rows SUM into the month
```

**Database fields**: `kpi_monthly.reach numeric`, `kpi_daily.reach numeric` — both
nullable, no default.

**Render path**
```
client card    app.js:27   {k:'reach', fmt:v=>fmtNum(v)}
               app.js:47   metricValue → N(m,'reach') → null when the column is null
               app.js:1261 fmtNum(null) === '—'          ← so a MISSING reach shows "—"
ops rollup     app.js:4675 agg.reach = 0; agg.reach += N(r,'reach')||0
               app.js:5195 { l:'Total reach', v: fmtNum(rollup.reach) }   ← shows "0"
all-months     app.js:1036 totals.reach starts at 0, same ||0 coercion    ← shows "0"
```

**Why Reach is 0 — five distinct causes, in likelihood order**

1. **Google Ads structurally has no reach in this pipeline.** The GAQL query never asks
   for it, and the `campaign` resource has no equivalent metric (Google's unique-reach
   metrics live in different resources/report types). Any practice whose only connection
   is Google Ads has `reach = null` for every `google_ads` row, forever.
2. **The ops/company rollups coerce null → 0.** `aggregateCompanyKpiByMonth` and
   `summarizeKpiRange` both seed at `0` and add `|| 0`. That turns "we have no reach
   data" into a confident, wrong **`0`** on the Operations dashboard and in every
   All-Months view. The per-client Metrics cards do this correctly (`—`); the aggregates
   do not. **This is the most likely thing being reported as "Reach shows 0".**
3. **Meta insight-row shape.** `rows(r, ["data"])` (`sync-platforms:88-95`) hunts for the
   first array under `data`. If Composio's `METAADS_GET_INSIGHTS` response nests the rows
   elsewhere, `insight.length === 0` and the month is skipped entirely (no row, so `—`);
   if it returns a row *without* a `reach` field, `num(undefined)` → `0` and a literal
   **zero** is persisted. That persisted zero then shows as `0` everywhere. **UNVERIFIED**
   — needs one live response body to settle.
4. **Sheet-sourced reach is summed, not deduplicated.** `ADDITIVE` includes `reach`
   (`sync-coefficient:45`), with an explicit comment that this matches the sheet column
   total. Summing daily reach over-counts monthly unique reach — the opposite error, but
   worth knowing when Meta-direct and sheet numbers disagree.
5. **`mergeKpiByPeriod` sums reach across channels** (`reach` is in `KPI_ADDITIVE`).
   Meta reach + Google's absent reach is fine today, but the moment a second reach-bearing
   source appears, unique reach will be double-counted.

**Frequency (`impr / reach`) inherits all of the above** — with a persisted `reach = 0`
it divides by zero and renders `—` via the `r ? i/r : null` guard (`app.js:33`).

---

## 7 · Failure handling & sync status

**`sync-platforms`** (`index.ts:325-345`): each connection is wrapped; the error message
is condensed from a JSON blob to `STATUS: message`, truncated to 300 chars, and written
to `platform_connections.last_error`. Only auth-shaped errors flip `status` to `error`.
`humanizeSyncError()` (`app.js:1951`) translates that to client-safe English for four
cases (quota, expired, permission, generic).

**`sync-coefficient`**: per-source `last_status`/`last_error`/`last_rows`/`last_months`
plus a `sync_runs` audit row per run. **`sync-platforms` writes no `sync_runs` row** —
the Composio pipeline has no run history.

**Sync status in the UI** — four separate surfaces, from two separate data models:
- sidebar footer `renderSidebarSync()` (`app.js:2007`) — `platform_connections` only;
- Connections page `connHealth()` (`app.js:1965`) — `platform_connections`;
- Sync Health / Team Controls `renderSyncStatus()` (`app.js:5811`) — `sheet_sources`;
- Needs Attention `buildOpsAlerts()` (`app.js:4480`) — **both**, producing
  `KPI sync failed`/`KPI sync stale`/`Access request pending`/`Access granted — finish
  wiring` from `sheet_sources` *and* `Connection failed`/`Connection needs attention`
  from `platform_connections`.

---

## 8 · Connection management UI — what exists and what is missing

`renderConnectionsPage()` (`app.js:2072`), visible to practice **owners** and to team in
client-preview (`canSeeConnectionsTab()`, `app.js:264`).

Per connection it renders a status dot + label, the account name, a details panel
(account, connected-by/when, last successful sync, months imported, last sync note) and
these actions:

| Action | Shown when | Effect |
|---|---|---|
| Refresh now | `status='connected'` | `functions.invoke('sync-platforms', {practice_id, provider})` |
| Reconnect | `status` is `error`, `pending` or `revoked` | re-runs `oauth-start` |
| View details | always | local toggle |
| Disconnect | `status='connected'` | `rpc('disconnect_platform')` → `revoked`, history preserved |

**Missing, verified by reading the code:**
- **No account/property picker.** `platform_connections.accounts` is populated by
  `sync-platforms`, but `loadAll()` (`app.js:876`) and `reloadConnections()`
  (`app.js:2037`) do not even `select` the `accounts` or `external_account_id` columns,
  and no UI renders them. The first discovered account is silently auto-selected. The
  comment in `sync-platforms:124` ("the Connections UI account picker renders
  platform_connections.accounts") describes a UI that does not exist.
- **No cancel for a pending/awaiting connection.** A `pending` row offers only
  "Reconnect"; there is no way to abandon a half-finished connect. The row is also
  excluded from `activeKeys` only when `revoked`, so a stuck `pending` Meta row hides
  Meta from the "Add data source" catalog permanently.
- **No diagnostic / error-fix UX beyond one sentence.** `humanizeSyncError()` gives a
  single line; there is no "what to check", no raw-error reveal for team, no retry
  history, no last-N-runs view.
- **Setup prompts do disappear once connected** — `marketingOnboardingSettled()`
  (`app.js:1688`) returns true when `wizard_completed_at` is set, **or** any connection
  is `connected`, **or** any KPI row has spend/reach/clicks, **or** `wizard_declined_at`
  is set. `shouldPromptMarketingConnect()` gates both the Metrics CTA and the wizard.
  This one already works as intended.
- **`connStateModel()` handles `'syncing'` and `'approval'` statuses the DB CHECK
  constraint forbids** — dead branches that suggest a richer state machine was planned.
