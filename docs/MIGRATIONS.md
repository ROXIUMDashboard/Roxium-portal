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

**Automated. Do not do this by hand.**

**Actions ▸ Initialize STAGING ▸ Run workflow**, type `INITIALIZE STAGING`.
See `docs/EXTERNAL_SETUP.md`.

`scripts/build-staging-bootstrap.mjs` assembles one deterministic file —
`schema.sql` followed by every migration in filename order, excluding
`2026-06-22_diagnose_demo_kpi.sql` (a read-only diagnostic that references a
production practice id) — and `scripts/initialize-staging-db.sh` applies it with
`ON_ERROR_STOP=1` behind seven independent safety guards. The workflow then
re-queries the database and refuses to report success unless every core table
exists with RLS enabled.

The generator also **hoists the five SECURITY DEFINER helpers**
(`is_team`, `my_practice`, `is_member_of`, `is_practice_owner`,
`can_invite_to_practice`) to above the first `create policy`. `schema.sql` uses
`is_team()` at line 259 but defines it at line 304, so applying it top-to-bottom
to a genuinely empty database fails. Production never hit this because it was
built up incrementally. `schema.sql` is deliberately left unmodified: it is
byte-identical to Part B of `2026-07-07_catchup_reconcile.sql`, and that identity
is what makes the bootstrap ordering argument checkable.

> ⚠️ **This method is for an empty database only.** Production has evolved past
> the 2026-07-07 snapshot embedded in `catchup_reconcile`; replaying that bundle
> against production would revert later work. Production baselining is the
> separate, still-open problem described below.

To confirm a database independently:

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
