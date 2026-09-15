# Database Migrations

**Target workflow**

```
migration committed  ->  applied to STAGING  ->  staging verified  ->  human approval
                     ->  same migration applied to PRODUCTION  ->  production verified
```

**What we are eliminating:** *"find the SQL file, copy it, paste it into the
Supabase dashboard, hope every migration was applied."* That is how production
came to be missing `practices.archived_at` — see below.

---

## Where things stand

| | Status |
|---|---|
| Repository migrations | 44 files in `migrations/`, filename order = apply order |
| Supabase ledger (`supabase_migrations.schema_migrations`) | **absent** — nothing is tracked |
| Production drift | **one known gap**: `practices.archived_at` missing (`2026-07-21_practice_archive.sql` never applied) |
| Automated drift detection | ✅ `npm run verify:schema`, runs in CI on every push |
| Automated application | 🟡 staging: ready, runs on deploy once `supabase/migrations/` exists · production: **deliberately manual until baselined** |

We use **Supabase's own tooling** — `supabase/migrations/` + `supabase db push` +
the CLI's ledger. No second migration framework has been invented.

---

## Why production migrations are not yet automated

This is the single most dangerous thing in the repository and the guard stays on.

With an **empty ledger**, `supabase db push` would treat all 44 historical files
as un-applied and **replay them against the live database**. One of them,
`2026-07-07_catchup_reconcile.sql`, embeds a full historical copy of `schema.sql`
and would **revert functions that later migrations replaced** — including
`delete_practice`, `claim_invites_for_user` and `email_is_invited`.

So production must be **baselined first**: every historical migration marked as
already-applied, without executing any of it. `supabase migration repair --status
applied` does exactly that — it writes a ledger row and runs no SQL.

`.github/workflows/deploy-production.yml` therefore does **not** run `db push`.
It prints a notice pointing here.

---

## Bringing up staging (safe: the database is empty)

A brand-new staging project has no data to damage, so the full history can simply
be applied in order.

```bash
# In the STAGING project's SQL editor, in this order:
#   1. schema.sql
#   2. every file in migrations/ in filename order:
ls migrations/*.sql | sort
```

Then confirm:

```bash
STAGING_SUPABASE_URL=... node scripts/verify-production-schema.mjs
```

(The script name says "production"; it verifies whichever project you point it at
via `SUPABASE_URL`/`SUPABASE_ANON_KEY`.)

## Baselining production (one-time, needs Max)

```bash
./scripts/adopt-supabase-migrations.sh plan     # writes nothing; prints the mapping
```

Then, after taking a manual backup:

```bash
supabase login
supabase link --project-ref nchtmeqsjkpcvtuscxfy
./scripts/adopt-supabase-migrations.sh write    # creates supabase/migrations/ locally
./scripts/.baseline-repair.sh                   # marks all 44 as applied — runs NO SQL
supabase migration list                         # every row must read "Applied"
```

> **Order is not optional.** Do not run `supabase db push` until
> `supabase migration list` shows a fully populated ledger.

**Close the known gap too** — apply `migrations/2026-07-21_practice_archive.sql`
in the production SQL editor. It is idempotent and additive: one nullable column,
one index, one team-gated function. Then `npm run verify:schema` should exit 0.

---

## After baselining: the normal flow

```bash
supabase migration new add_deliverable_link_url     # creates supabase/migrations/<ts>_*.sql
# write the SQL, commit, open a PR
```

1. **Merge to `main`** → `deploy-staging.yml` runs `supabase db push` against
   **staging** automatically.
2. **Verify staging** — the app works, and `verify:schema` is green.
3. **Release to PRODUCTION** → approve → apply the same migration to production.
   Until production `db push` is enabled, that last step is run deliberately by a
   human against the production project, using the *same committed file*.

## Rules

- **Additive by default.** `add column if not exists`, `create or replace
  function`, `create index if not exists`. Additive migrations are safe to leave
  in place and safe to re-run.
- **Never edit an applied migration.** Write a new one.
- **Destructive changes get their own release.** Dropping a column or rewriting
  data is not reversible — see `docs/ROLLBACK.md`.
- **Rehearse on staging.** That is what it is for; `npm run reset:staging`
  restores a known baseline.
- **Verify after every production change**: `npm run verify:schema`, and
  `scripts/verify-production-schema.sql` in the SQL editor for indexes, triggers,
  functions and RLS policy bodies.

## Verification tooling

| Tool | Reaches | Secrets |
|---|---|---|
| `npm run verify:schema` | tables, columns, anon-exposure | none (public anon key) |
| `scripts/verify-production-schema.sql` | indexes, constraints, triggers, functions, **RLS policy bodies**, grants, storage, ledger state | SQL editor |
| `scripts/adopt-supabase-migrations.sh plan` | the baselining plan | none |
