# External Setup — actions only Max can perform

Everything that could be built in the repository **is** built. What remains needs
ownership of an external account.

Work top to bottom. **Step 1 is the only one that blocks everything else.**

Legend — ✅ done · 🟡 needs configuration · 🔴 blocking

---

## 1 · Create the staging Supabase project 🔴

**Platform** Supabase · **Location** https://supabase.com/dashboard → **New project**

| Setting | Value |
|---|---|
| Name | `roxium-portal-staging` |
| Organisation | same as production |
| Region | same as production |
| Database password | generate and save it — needed in step 3 |

**Why:** staging must have its own database, Auth, Storage and secrets. Pointing
staging at the production database is the one thing this whole design exists to
prevent.

Then, **in the new project's SQL editor**, run in this order:
1. the whole of `schema.sql`
2. every file in `migrations/` in filename order (`ls migrations/*.sql | sort`)

Safe: the database is empty, so there is nothing to damage.

---

## 2 · Put the staging keys into `config.js` 🔴

**Platform** Supabase → staging project → **Settings ▸ API**

Copy **Project URL** and the **`anon` `public`** key into `config.js`:

```js
staging: {
  ...
  SUPABASE_URL: 'https://<your-staging-ref>.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ…',
}
```

Commit and push. **Until this is done staging fails closed** — which is correct,
but it means staging will not work.

> The anon key is public by design; RLS protects the data. Never put a
> service-role key in this file.

---

## 3 · Add the GitHub secrets and variables 🔴

**Platform** GitHub → repo → **Settings ▸ Environments**

Create an environment named **`staging`**:

| Name | Kind | Value |
|---|---|---|
| `STAGING_BASE_URL` | **Variable** | `https://staging.roxium.com` |
| `STAGING_SUPABASE_PROJECT_REF` | Secret | the staging ref (the `<ref>` from step 2) |
| `STAGING_SUPABASE_DB_PASSWORD` | Secret | from step 1 |
| `STAGING_SUPABASE_URL` | Secret | `https://<ref>.supabase.co` |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Secret | Settings ▸ API ▸ `service_role` |

Create an environment named **`production`**:

| Name | Kind | Value |
|---|---|---|
| `SUPABASE_PROJECT_REF` | Secret | `nchtmeqsjkpcvtuscxfy` |

**Why:** the deploy workflows fail closed without these rather than guessing.

---

## 4 · Turn on the production approval gate 🔴

**Platform** GitHub → **Settings ▸ Environments ▸ production**

1. Tick **Required reviewers**.
2. Add yourself (and anyone else who may approve a release).
3. **Save protection rules**.

**Why:** this is what makes production releases pause for a human. Without it the
workflow still runs, but nobody is asked to approve. It cannot be set from the
repository — GitHub only exposes it in the UI.

---

## 5 · Point the staging hostname at Cloudflare 🟡

**Platform** Cloudflare → **Workers & Pages ▸ roxium-portal ▸ Custom domains**

1. **Set up a custom domain** → `staging.roxium.com`
2. Cloudflare adds the DNS record automatically (same zone as `roxium.com`).
3. Attach it to the **`staging`** branch, not production.

Until then staging is reachable at `https://staging.roxium-portal.pages.dev` —
which already works and is already recognised by `config.js`. If you use that URL
instead, set `STAGING_BASE_URL` to it in step 3.

**Why:** gives staging a stable address and keeps it visibly separate.

---

## 6 · Set the staging Edge Function secrets 🟡

**Platform** Supabase → staging project → **Edge Functions ▸ Secrets**

| Secret | Value | Why |
|---|---|---|
| `APP_ENV` | `staging` | **Important.** Makes `siteUrl()` fail closed instead of defaulting to the live site. |
| `SITE_URL` | `https://staging.roxium.com` | every email link and OAuth bounce-back |
| `SYNC_SECRET` | a **new** random value | must differ from production |
| `RESEND_API_KEY` | optional | leave unset and staging sends no email at all |
| `EMAIL_FROM` | e.g. `ROXIUM Staging <staging@roxium.com>` | only if you set a Resend key |

Leave `DIGEST_ENABLED` unset so staging never emails the team.

**Never copy a production secret here.** Staging having its own `SYNC_SECRET` is
what stops a staging cron from triggering a production sync.

---

## 7 · Configure staging Auth 🟡

**Platform** Supabase → staging project → **Authentication**

- **URL Configuration ▸ Site URL** → `https://staging.roxium.com`
- **Redirect URLs** → add `https://staging.roxium.com/**` and
  `https://staging.roxium-portal.pages.dev/**`
- **Sign In / Providers ▸ Email** → enabled

**Why:** magic links use `location.origin + '/portal/'`; an origin that is not
allow-listed lands users on the wrong host.

---

## 8 · Seed staging 🟡

Once steps 1–3 are done, GitHub ▸ Actions ▸ **Deploy to STAGING** ▸ *Run
workflow*. Then locally (or ask Claude):

```bash
STAGING_SUPABASE_URL=... STAGING_SUPABASE_SERVICE_ROLE_KEY=... npm run seed:staging
```

Creates four fake practices and eight `.test` users — `docs/STAGING_DATA.md`.

---

## 9 · Close the known production schema gap 🟡

**Platform** Supabase → **production** project → SQL Editor

Paste and run `migrations/2026-07-21_practice_archive.sql`.

**Why:** production is missing `practices.archived_at`, so the Archive feature is
inert. Idempotent and additive: one nullable column, one index, one team-gated
function. Afterwards `npm run verify:schema` exits 0 and CI goes green.

---

## 10 · Baseline production migrations 🟡 *(do after 1–9 are working)*

Follow `docs/MIGRATIONS.md` → *Baselining production*. Take a manual backup
first. This is the step that finally ends hand-applied migrations.

---

## Already done — no action needed ✅

| Item | Status |
|---|---|
| Cloudflare Pages project `roxium-portal` | ✅ exists, production branch `main` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ✅ already GitHub secrets |
| `SUPABASE_ACCESS_TOKEN` | ✅ already a GitHub secret |
| Production Supabase project | ✅ live, RLS verified holding |
| Netlify | ✅ already gone — nothing to remove |
| Production Edge Function secrets | ✅ unchanged by this pass |
| Resend / Composio production config | ✅ unchanged by this pass |
