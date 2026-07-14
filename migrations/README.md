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
