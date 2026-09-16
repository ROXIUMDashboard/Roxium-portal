# Infrastructure Simplification

**The question:** what is the smallest reliable stack that can run ROXIUM
professionally?

**The answer:** GitHub + Supabase + Cloudflare Pages + Resend, with Composio for
marketing OAuth. Everything else is either already gone or is a candidate for
removal once its replacement is proven.

Nothing was removed on the basis of looking redundant. Each classification below
states the evidence.

---

## Classification

| Component | Verdict | Evidence / reasoning |
|---|---|---|
| **GitHub** (code, PRs, Actions, Releases, Environments) | **KEEP** | The single control point for code, CI, release gating and approvals. Now also provides the production approval gate. |
| **Supabase** (Postgres, Auth, Storage, RLS, Edge Functions) | **KEEP** | The entire backend. Verified live: 22 tables, RLS holding against anonymous access on every one. |
| **Cloudflare Pages** | **KEEP** | Frontend hosting, and now both environments via branch deploys (`main` = production, `staging` = staging). Deployment history gives us a one-click frontend rollback. |
| **GitHub Actions** | **KEEP** | Verification and deploy orchestration. Three workflows, one job each. |
| **Playwright** | **KEEP** | Browser tests. Free, runs in Actions, already proven in `bhfa-2027/`. No paid testing SaaS added. |
| **Resend** | **KEEP** | Transactional email. Supabase Auth cannot brand or reliably deliver its own mail; this is the documented fix for the Outlook problem. |
| **Composio** | **KEEP (for now)** | Brokers every Meta/Google OAuth connection and holds the tokens, so ROXIUM registers no developer app. Removing it means rebuilding first-party OAuth + token refresh — a real project, open as Q4 in `handoff/15_…`. |
| **Netlify** | **ALREADY REMOVED** ✅ | **Verified gone**: no `netlify.toml` in the working tree, none in git history (`git log --all -- netlify.toml` is empty), no reference in any workflow or script. Only stale prose in `README.md` and `docs/DEPLOYMENT.md` still described it — corrected in this pass. |
| **Cloudflare Worker deploy path** (`wrangler.jsonc`) | **ALREADY REMOVED** ✅ | No wrangler config file exists anywhere. Only the Pages Action owns the project name. |
| **`deploy-functions.yml`** (push-to-main → production functions) | **REMOVED** ✅ | Deleted this pass. It deployed Edge Functions straight to the **production** Supabase project on every push to `main` — a direct-to-production path that bypassed every gate. Function deploys are now steps inside the staging and production release workflows, so they follow the same approval path as everything else. Ad-hoc redeploys: `bash scripts/deploy-functions.sh`. |
| **`deploy-pages.yml`** (push-to-main → production frontend) | **REPLACED** ✅ | Superseded by `deploy-staging.yml` + `deploy-production.yml`. Merging to `main` now updates staging; production needs an explicit, approved run. |
| **Coefficient + Google Sheets ingestion** | **DEPRECATE** 🟡 | Fully live and still the only path for channels without a Composio connector. Do **not** remove yet: `sync-coefficient` (46 KB), `sheet_sources`, `practices.workbook_sheet_id` and the Team Controls reporting admin all depend on it, and `buildOpsAlerts()` raises alerts from it. Needs a written deprecation date — Q5 in `handoff/15_…`. |
| **`platform_tokens` table + `providerConfig()`** | **REMOVE** (safe, deferred) 🟡 | Dead remnants of the abandoned first-party OAuth design. `platform_tokens` is never written; `providerConfig()` has zero importers. Their secrets (`META_APP_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET`) are unused. Removal is safe but is code cleanup, not infrastructure — scheduled for Pass 7 in `handoff/14_…`. |
| **Asana integration** | **OPTIONAL** 🟡 | Two Edge Functions, a column and a unique index — but no schedule, no UI and no webhook registration. Scaffolding, not a running dependency. Keep or delete; it costs nothing either way. |
| **`localStorage` fallbacks for server-owned state** | **NEEDS DECISION** | `roxium_ops_attention_v2` can overwrite the server copy on first load (`handoff/11_…` R-25), and `roxium_updates_seen_*` is per-browser only. These are product bugs, not infrastructure — Product Pass 3. |
| **Manual migration application** | **DEPRECATE** 🟡 | Being replaced by the Supabase CLI ledger. Blocked only on baselining — `docs/MIGRATIONS.md`. |
| **`supabase/config.toml`** | **KEEP, but understand it** | Supabase CLI *local* scaffolding. It is **not** applied to the hosted project. Do not read `enable_signup = true` there as evidence about production. |

---

## What changed in this pass

**Removed:** two workflows (`deploy-pages.yml`, `deploy-functions.yml`) — both
direct-to-production paths.

**Added:** three workflows with gates, a shared `scripts/deploy-functions.sh` so
staging and production deploy functions identically, and a fail-closed
environment resolver.

**Net effect on tool count: unchanged.** No new external service was introduced.
Playwright is a dev dependency, not a service. The simplification is in the number
of *paths to production*: **from two ungated to one gated**.

## Deliberately not done

- **No container platform, no Terraform, no secret manager, no observability SaaS,
  no paid testing service.** None is justified at this size.
- **Coefficient was not removed** — its replacement is not yet verified for every
  channel, and removing it would break live client reporting.
- **Composio was not removed** — that decision is a product/architecture call
  (Q4), not a simplification.
