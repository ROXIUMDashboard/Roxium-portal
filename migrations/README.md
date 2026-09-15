# Migrations

The **source of truth** for every schema change since the original baseline
(`../schema.sql`). Each file is idempotent (`create ... if not exists` /
`create or replace` / `drop ... if exists`) and safe to re-run.

## Canonical apply order

**Filename order = apply order.** Files are date-prefixed (`YYYY-MM-DD_*.sql`)
and a lexical sort is the correct chronological sequence:

```bash
ls migrations/*.sql | sort
```

To bootstrap a **fresh** Supabase project:

1. Run `../schema.sql` (the original baseline).
2. Run every file in `migrations/` in the sorted order above.

Order matters for the few files that evolve the same object over time — notably
the `platform_connections` provider/status constraints, which are added then
replaced across `2026-07-08_marketing_connections`, `2026-07-09_platform_connections`,
`2026-07-14_composio_connections`, and `2026-07-14_connections_2_0`. Applied out
of order they diverge; applied in filename order they converge.

## Known drift & the recommended fix

`../schema.sql` is the **original baseline only** — it does NOT contain the
tables/columns added by these migrations. That gap (code referencing
`platform_connections`, `kpi_dashboard_prefs`, `composio_connection_id`, etc.
that exist only here) is the schema-drift risk called out in
`../docs/PLATFORM_AUDIT.md` (Phase 2).

Two follow-ups to close it properly (require live Supabase access / an infra
decision, so they're deferred from the code-only Phase 2 pass):

1. **Regenerate the baseline** from the live DB so `schema.sql` is truthful
   again:
   ```bash
   supabase db dump --schema public -f schema.sql
   ```
   then squash the settled connection-evolution migrations into it.
2. **Adopt a tracked runner** so migrations apply automatically and in order
   instead of by hand. Either the Supabase CLI (`supabase db push`, migrations
   moved to `supabase/migrations/`) run in CI before the edge-function deploy,
   or a `schema_migrations` ledger table + a small apply step. This removes the
   "CI ships functions referencing un-migrated columns" hazard.

Until a runner is adopted, apply new migrations by hand in the Supabase SQL
Editor in filename order.

---

## Verifying what production actually has (added 2026-09-15)

Filename order is still the apply order, and migrations are still applied by hand — but
you no longer have to *guess* whether production matches this folder.

```bash
# Read-only. No secrets: uses the public anon key from config.js.
# Exits 1 if a table or column this repo expects is missing from production.
node scripts/verify-production-schema.mjs
```

It also runs automatically on every push and weekly
(`.github/workflows/verify-schema.yml`). It is intentionally **not** wired into the
deploy workflows yet — see `handoff/17_PRODUCTION_VERIFICATION.md` §8.

For everything the anon key cannot reach — indexes, constraints, triggers, functions,
**RLS policy bodies**, grants, storage policies and the ledger — paste
`scripts/verify-production-schema.sql` into the Supabase SQL editor. It is SELECT-only
and safe to run on production at any time.

### Verified state as of 2026-09-15 (commit `df7731f`)

All 22 expected tables/views and 221 of 222 expected columns are present. One gap:

| Missing | From | Effect |
|---|---|---|
| `practices.archived_at` | `2026-07-21_practice_archive.sql` | The Archive feature is inert. `loadTeamPractices()` degrades harmlessly; the Archive button reports the missing migration. |

Apply `2026-07-21_practice_archive.sql` to close it (it is idempotent, additive, and adds
one nullable column, one index and one team-gated function).

### Adopting the standard Supabase migration workflow

`scripts/adopt-supabase-migrations.sh plan` prints the full mapping and runbook without
writing anything.

> **Order is not optional.** Baseline the ledger with `supabase migration repair --status
> applied` **before** `supabase db push` ever runs. With an empty ledger, `db push` would
> replay all 44 files — and `2026-07-07_catchup_reconcile.sql` would revert functions that
> later migrations replaced.
