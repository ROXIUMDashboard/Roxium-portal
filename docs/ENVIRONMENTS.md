# Environments

Two environments. They share no database, no users, no files and no secrets.

| | **Production** | **Staging** |
|---|---|---|
| Who uses it | Real ROXIUM customers | ROXIUM team only |
| Marketing site | `https://roxium.com/` | `https://staging.roxium.com/` |
| **Portal (live)** | **`https://roxiumstudio.com/portal/`** | `https://staging.roxium.com/portal/` |
| Cloudflare Pages | project `roxium-portal`, branch **`main`** | project `roxium-portal`, branch **`staging`** |
| Fallback URL | `https://roxium-portal.pages.dev` | `https://staging.roxium-portal.pages.dev` |
| Supabase project | `nchtmeqsjkpcvtuscxfy` | **separate project — to be created** |
| Data | real customer data | synthetic fixtures only (`docs/STAGING_DATA.md`) |
| Deployed by | `Release to PRODUCTION` (manual + approval) | `Deploy to STAGING` (automatic on merge to `main`) |
| Visual marker | none | gold **STAGING** badge, bottom-left |

> **On hostnames.** The live portal is **`roxiumstudio.com/portal/`**.
> `roxium.com` is the corporate/marketing domain; it also served the portal
> historically, so it is still claimed as production in `config.js` and traffic
> arriving there is not refused.
>
> `config.js`'s production `hosts` list is **load-bearing, not documentation**: a
> production build served from a host that is not in it fails the cross-check and
> refuses to boot. Add a host there *before* pointing it at the portal.
>
> **Open decision:** staging is still specified as `staging.roxium.com`. If the
> product is settling on the studio domain, `staging.roxiumstudio.com` is the
> consistent choice. Nothing has been changed either way — it needs a DNS
> decision, not a code change. See `docs/DOMAIN_ARCHITECTURE.md`.

---

## How a page decides which backend to use

`config.js` holds a registry of environments and a resolver. It is deliberately
**deny-by-default**: it will refuse to connect rather than guess.

```
1. ROXIUM_BUILD_ENV   stamped into config.js at build time by scripts/prepare-pages.sh
2. the hostname       matched against ENVIRONMENTS[].hosts / .hostSuffixes
3. nothing            -> FAIL CLOSED. No client is created; the page shows an error.
```

Then a cross-check: **the resolved environment must claim the hostname it is
served from.** A production bundle served at `staging.roxium.com` refuses; so does
a staging bundle served at `roxium.com`.

There is no default and no fallback to production. Every refusal path is covered
by `tests/unit/env-resolution.test.mjs` and asserted in a real browser by
`tests/e2e/env-safety.spec.js`.

### What a refusal looks like
A full-page ROXIUM-branded notice: *"This deployment is not configured"*, with the
reason, and the line *"No database connection was opened."* `app.js` then halts
before constructing a Supabase client. It is a safety stop, not a crash.

### Which hosts map where

| Host | Environment |
|---|---|
| `roxium.com`, `www.roxium.com`, `roxium-portal.pages.dev` | production |
| `staging.roxium.com`, `staging.roxium-portal.pages.dev` | staging |
| `*.roxium-portal.pages.dev` (any Pages preview build) | staging |
| `localhost`, `127.0.0.1` | staging |
| anything else | **refused** |

Preview builds resolve to **staging**, never production. That is deliberate: a
preview of an unreviewed branch must never be able to touch customer data.

---

## Environment variables and secrets

Nothing secret is in this repository. Anon keys are public by design — Row Level
Security is what protects the data.

### Frontend (browser)

| Name | Purpose | Public? | Where it lives | Status |
|---|---|---|---|---|
| `ROXIUM_ENVIRONMENTS.production.SUPABASE_URL` | production project URL | public | `config.js` | ✅ set |
| `ROXIUM_ENVIRONMENTS.production.SUPABASE_ANON_KEY` | production anon key | public | `config.js` | ✅ set |
| `ROXIUM_ENVIRONMENTS.staging.SUPABASE_URL` | staging project URL | public | injected at build time from the `STAGING_SUPABASE_URL` secret | 🟡 empty until the staging env is configured — fails closed |
| `ROXIUM_ENVIRONMENTS.staging.SUPABASE_ANON_KEY` | staging anon key | public | injected at build time from the `STAGING_SUPABASE_ANON_KEY` secret | 🟡 empty until the staging env is configured — fails closed |
| `ROXIUM_ENV` | build-time stamp (`production`/`staging`) | build var | set by the deploy workflow | ✅ |

### GitHub — repository secrets (shared by both environments)

| Name | Purpose | Supplied by | Status |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | deploy to Pages | Cloudflare | ✅ exists |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account | Cloudflare | ✅ exists |
| `SUPABASE_ACCESS_TOKEN` | deploy Edge Functions / CLI | Supabase | ✅ exists |

### GitHub — `production` environment

| Name | Kind | Purpose | Status |
|---|---|---|---|
| `SUPABASE_PROJECT_REF` | secret | production project ref | ✅ exists |
| `SUPABASE_URL` | secret | production project URL — **Provision Admin Account** only | 🟡 as needed |
| `SUPABASE_SERVICE_ROLE_KEY` | secret | production admin key — **Provision Admin Account** only | 🟡 as needed |
| `ADMIN_INITIAL_PASSWORD` | secret | first password for **Provision Admin Account** (delete it once used) | 🟡 as needed |
| *(required reviewers)* | setting | the approval gate | 🟡 to configure |

### GitHub — `staging` environment

| Name | Kind | Purpose | Status |
|---|---|---|---|
| `STAGING_BASE_URL` | **variable** | e.g. `https://staging.roxium.com` | 🔴 required |
| `STAGING_SUPABASE_PROJECT_REF` | secret | staging project ref — Edge Function deploys | 🔴 required |
| `STAGING_SUPABASE_URL` | secret | seeding + frontend build injection | 🔴 required |
| `STAGING_SUPABASE_ANON_KEY` | secret | frontend build injection (public value, kept here so the build has one source) | 🔴 required |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | secret | seeding (admin credential) | 🔴 required |
| `STAGING_SUPABASE_DB_URL` | secret | `Initialize STAGING` — the only thing that runs DDL (admin credential) | 🔴 required |
| `SUPABASE_ACCESS_TOKEN` | secret | Edge Function deploys from within the staging environment | 🔴 required |
| `STAGING_SUPABASE_DB_PASSWORD` | secret | `supabase db push` for ongoing migrations, once `supabase/migrations/` exists | 🟡 optional |
| `ADMIN_INITIAL_PASSWORD` | secret | first password for **Provision Admin Account** (delete it once used) | 🟡 as needed |
| `STAGING_FIXTURE_PASSWORD` | secret | password the seeder sets on the synthetic fixture accounts, so the authorization tests can sign in | 🟡 optional |

Set these once, via `docs/EXTERNAL_SETUP.md`. They exist **only** in the GitHub
`staging` environment; the production workflows cannot read them, and the staging
workflows cannot read production's.

### Supabase Edge Function secrets (set per project)

| Name | Production | Staging | Notes |
|---|---|---|---|
| `APP_ENV` | `production` (or unset) | **`staging`** | makes `siteUrl()` fail closed instead of defaulting to the live site |
| `SITE_URL` | `https://roxiumstudio.com` | `https://staging.roxium.com` | every email link and OAuth bounce-back — **set it explicitly on both projects**; the code default exists only as a backstop |
| `SYNC_SECRET` | own value | **different value** | cron auth + OAuth state HMAC |
| `RESEND_API_KEY` | own | own (or unset to disable mail) | |
| `EMAIL_FROM` | verified sender | e.g. `ROXIUM Staging <staging@…>` | |
| `COMPOSIO_API_KEY`, `COMPOSIO_*_AUTH_CONFIG_ID` | own | separate configs | never reuse production connections |
| `GOOGLE_SA_KEY`, `REPORTING_FOLDER_ID` | own | optional | |
| `ASANA_TOKEN`, `ASANA_SECRET` | own | optional | |
| `DIGEST_ENABLED` | as desired | leave unset | keeps staging from emailing anyone |

**Never reuse a production secret in staging.** Staging having its own
`SYNC_SECRET` is what stops a staging cron from triggering a production sync.
