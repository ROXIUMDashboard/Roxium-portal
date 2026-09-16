# STAGING FIRST-TIME SETUP FOR MAX

Staging is a complete second copy of the portal with its own database. You test
there; customers never see it. This page sets it up once.

**8 actions. No Terminal. No SQL. No copying migration files.**

After action 6 you click one button and GitHub builds the whole thing.

> **What you need before starting:** a Supabase login, a GitHub login, and
> Cloudflare access. Roughly 25 minutes.

Legend — 🔴 blocking · 🟡 optional for now

---

## Action 1 · Create the staging Supabase project 🔴

**Where to click** https://supabase.com/dashboard → **New project**

**What to enter**

| Field | Value |
|---|---|
| Name | `roxium-portal-staging` |
| Organisation | the same one production uses |
| Region | the same one production uses |
| Database password | click **Generate**, then **copy it somewhere safe for 10 minutes** — you need it in Action 2 |

**What success looks like:** the project page says **Active** (it takes 1–2
minutes). The database is empty — that is expected and correct.

> ⚠️ Do not run any SQL here. Action 6 does that for you.

---

## Action 2 · Collect the five staging values 🔴

You are just copying five values out of Supabase. Paste each into a scratch note
as you go; Action 3 pastes them into GitHub.

**Where to click** your new staging project → **Settings ▸ API**

| Copy this | Called it in GitHub |
|---|---|
| **Project URL** (`https://…supabase.co`) | `STAGING_SUPABASE_URL` |
| **Project API keys → `anon` `public`** | `STAGING_SUPABASE_ANON_KEY` |
| **Project API keys → `service_role`** (click *Reveal*) | `STAGING_SUPABASE_SERVICE_ROLE_KEY` |
| **Reference ID** (also the code in the Project URL) | `STAGING_SUPABASE_PROJECT_REF` |

**Where to click next** → **Settings ▸ Database ▸ Connection string ▸ URI**

| Copy this | Called it in GitHub |
|---|---|
| The whole `postgresql://…` line, then replace `[YOUR-PASSWORD]` with the password from Action 1 | `STAGING_SUPABASE_DB_URL` |

**What success looks like:** five values in your note, and the connection string
contains a real password rather than the literal text `[YOUR-PASSWORD]`.

> 🔒 The `service_role` key and the connection string are **admin credentials**.
> They go into GitHub and nowhere else — not into Slack, not into a document, not
> into the code. The `anon` key is different: it is public by design.

---

## Action 3 · Create the GitHub `staging` environment and paste the values 🔴

**Where to click** GitHub → the `roxium-portal` repo → **Settings ▸ Environments**
→ **New environment** → name it exactly `staging` → **Configure environment**

**What to paste** — under **Environment secrets**, click **Add secret** six times:

| Name | Value |
|---|---|
| `STAGING_SUPABASE_URL` | from Action 2 |
| `STAGING_SUPABASE_ANON_KEY` | from Action 2 |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | from Action 2 |
| `STAGING_SUPABASE_PROJECT_REF` | from Action 2 |
| `STAGING_SUPABASE_DB_URL` | from Action 2 |
| `SUPABASE_ACCESS_TOKEN` | the same value already saved at repo level — copy it in here too, or ask Claude |

Then under **Environment variables** → **Add variable**:

| Name | Value |
|---|---|
| `STAGING_BASE_URL` | `https://staging.roxium.com` |

**What success looks like:** the `staging` environment lists **6 secrets** and
**1 variable**. You can no longer read the secret values back — that is normal.

**Now delete your scratch note.**

---

## Action 4 · Turn on the production approval gate 🔴

**Where to click** same page → **Environments** → **New environment** → name it
exactly `production` → **Configure environment**

**What to do** tick **Required reviewers**, add yourself, **Save protection rules**.

**What success looks like:** the `production` environment shows *Required
reviewers: 1*. From now on nothing reaches customers without you clicking
**Approve**.

---

## Action 5 · Point `staging.roxium.com` at Cloudflare 🔴

**Where to click** Cloudflare → **Workers & Pages** → `roxium-portal` →
**Custom domains** → **Set up a custom domain**

**What to enter** `staging.roxium.com`, and when asked which branch it serves,
choose **`staging`**.

**What success looks like:** the domain shows **Active**. Opening it right now
shows a page that refuses to load data — correct, because the database does not
exist yet. Action 6 fixes that.

---

## Action 6 · Click "Initialize STAGING" 🔴

**Where to click** GitHub → the repo → **Actions** tab → **Initialize STAGING**
in the left sidebar → **Run workflow** (button on the right)

**What to enter** in the box labelled *Type exactly*, type:

```
INITIALIZE STAGING
```

Leave both tick-boxes ticked. Click the green **Run workflow**.

**What success looks like:** after 5–10 minutes the run's summary page shows

```
STAGING INITIALIZATION
✅ Database
✅ Migrations
✅ RLS verification
✅ Edge Functions
✅ Seed data
✅ Environment isolation
✅ Tests
```

**If any line is ❌** the run stopped there and nothing after it was attempted.
Open the red step to read the exact reason. A *REFUSED* message means a safety
check did not pass and **nothing was written to any database** — that is the
system working correctly, not a broken setup. See *Troubleshooting* below.

---

## Action 7 · Turn on email + password sign-in 🔴

**Where to click** Supabase → the project → **Authentication ▸ Providers ▸ Email**

**What to set**

| Setting | Value |
|---|---|
| Email provider | **Enabled** |
| Allow new users to sign up | **Off** — ROXIUM invites clients; nobody signs themselves up |

**Where to click next** → **Authentication ▸ Policies**

| Setting | Value |
|---|---|
| Minimum password length | **10** (matches what the portal tells clients) |

**Where to click next** → **Authentication ▸ URL Configuration**

| Setting | Value |
|---|---|
| Site URL | `https://staging.roxium.com` (or `https://roxium.com` on production) |
| Redirect URLs | add `https://staging.roxium.com/portal/**` |

**What success looks like:** the Email provider shows as enabled, and the
redirect list contains your portal path. Do this **once per project** — staging
and production are configured separately.

---

## Action 8 · Create your administrator account 🔴

**Where to click** GitHub → **Settings ▸ Environments** → the environment
(`staging` or `production`) → **Add secret**

| Name | Value |
|---|---|
| `ADMIN_INITIAL_PASSWORD` | the password you want to start with, at least 10 characters |

Then GitHub → **Actions ▸ Provision Admin Account ▸ Run workflow**: choose the
project, type your email address, **Run workflow**. On `production` it pauses for
your own approval first.

**What success looks like:** the summary says the account can sign in and has
full platform-administrator rights. Open the portal, sign in with that email and
password — you land on the Operations dashboard.

> 🔒 **Change the password after your first sign-in**, using *Forgot password?*
> on the sign-in card. A password that has been typed into a chat, an email or a
> ticket should be treated as already disclosed. Then delete the
> `ADMIN_INITIAL_PASSWORD` secret.

---

## You are done

Open **https://staging.roxium.com** and sign in with one of the test accounts in
`docs/STAGING_DATA.md`. Everything you see there is invented data.

From here on, read `docs/RELEASE_RUNBOOK.md` — normal releases need none of this.

---
---

# Advanced / Troubleshooting

Nothing below is needed for normal use.

## What "Initialize STAGING" actually does

1. Checks seven independent safety conditions (below). Any failure stops the run
   before a single line of SQL executes.
2. Generates one bootstrap file from `schema.sql` plus all 43 migrations in
   chronological order, excluding one read-only diagnostic, and applies it with
   `ON_ERROR_STOP` so a failure cannot leave a half-built schema.
3. Re-queries the database independently and refuses to report success unless
   every core table exists and Row Level Security is on for **all** of them.
4. Deploys the Edge Functions to the staging project.
5. Loads the deterministic synthetic fixtures from `docs/STAGING_DATA.md`.
6. Runs the automated test suite.

It is safe to run again. Re-running on an already-initialised staging database
re-applies the same idempotent statements.

## Why it cannot touch production

Seven independent protections, any one of which aborts the run:

| # | Protection |
|---|---|
| 1 | Runs only in the GitHub `staging` environment; production secrets are scoped to the `production` environment and are not readable from it |
| 2 | `APP_ENV` must be exactly `staging` |
| 3 | You must type the confirmation phrase exactly |
| 4 | The production project ref is on a denylist, checked both as a substring and by parsing, in both Supabase connection-string shapes |
| 5 | The production Supabase URL is denylisted the same way |
| 6 | The target database is inspected first: if it holds any practice whose name does not end in `(TEST)`, the run is refused |
| 7 | The seeder re-checks the target itself before its first write |

Anything ambiguous — an unparseable URL, a host that only *looks* like Supabase,
a missing value — is **refused**, never guessed. There is no fallback path to
production.

**This method must never be used on production.** Production has evolved past
the 2026-07-07 snapshot embedded in `2026-07-07_catchup_reconcile.sql`; replaying
that bundle there would revert later work. Production migration baselining is a
separate, still-open problem — see `docs/MIGRATIONS.md`.

## Troubleshooting

| Message | Meaning | Fix |
|---|---|---|
| `missing staging secret: …` | A secret in Action 3 is absent or empty | Re-add it in the `staging` environment |
| `REFUSED (app-env)` | Something changed `APP_ENV` | Do not edit the workflow; re-run it as published |
| `REFUSED (confirmation)` | Typo in the phrase | Retype `INITIALIZE STAGING` exactly — capitals, one space |
| `REFUSED (production-target)` | A production value was pasted into a staging secret | Re-do Action 2 from the **staging** project |
| `REFUSED (unrecognised-db-url)` | The connection string is not a recognisable Supabase database | Re-copy it from *Settings ▸ Database ▸ Connection string ▸ URI* |
| `REFUSED (missing-db-url)` | `STAGING_SUPABASE_DB_URL` is empty | Add it in Action 3 |
| `… practice(s) that are not synthetic fixtures` | The target holds real-looking data | **Stop.** Confirm which project that connection string points at before doing anything else |
| `staging Supabase values were not injected` | Deploy ran without `STAGING_SUPABASE_URL` / `_ANON_KEY` | Add both in Action 3 |

## Resetting staging test data

**Actions ▸ Reset STAGING Data ▸ Run workflow**, type `RESET STAGING DATA`.

Deletes and rebuilds only the synthetic fixtures — it never changes the schema,
and it only deletes rows whose ids it generated itself. Tick **Preview only** to
see what it would do first.

## Remaining manual technical work (not staging)

| Item | Status |
|---|---|
| `practices.archived_at` missing in **production** | Still open — run `migrations/2026-07-21_practice_archive.sql` in the production SQL editor. Additive and idempotent: one nullable column, one index, one team-gated function |
| Production migration baselining | Still open — see `docs/MIGRATIONS.md`. Deliberately *not* automated by this pass |
| Staging Edge Function secrets (Resend, Composio, sync keys) | Optional. Staging works without them; the features that call out to those services will not |
| Production Auth settings | Do Action 7 again on the **production** project before the password login ships there |

## Already done — no action needed ✅

| Item | Status |
|---|---|
| Cloudflare Pages project `roxium-portal` | ✅ exists, production branch `main` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | ✅ already GitHub secrets |
| `SUPABASE_ACCESS_TOKEN` | ✅ already a repo-level GitHub secret |
| Production Supabase project | ✅ live, RLS verified holding |
| Netlify | ✅ already gone — nothing to remove |
| Production Edge Function secrets | ✅ unchanged by this pass |
| Resend / Composio production config | ✅ unchanged by this pass |
| Staging keys in `config.js` | ✅ no longer needed — the deploy injects them at build time |
