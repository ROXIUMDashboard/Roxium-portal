#!/usr/bin/env bash
# =============================================================================
# initialize-staging-db.sh — bring an EMPTY staging Supabase database up to the
# current schema, automatically and safely.
#
#   STAGING_SUPABASE_DB_URL=... APP_ENV=staging CONFIRM='INITIALIZE STAGING' \
#     bash scripts/initialize-staging-db.sh
#
# FIVE INDEPENDENT GUARDS, ALL OF WHICH MUST PASS (fail closed on any doubt):
#   1. APP_ENV must be exactly "staging"
#   2. the operator must type the confirmation phrase exactly
#   3. the connection string must not reference the production project ref
#      (checked as a substring AND by parsed ref, for both URL shapes)
#   4. the connection string must be an identifiable Supabase project
#   5. the target database must contain no real data — any practice whose name
#      does not end in "(TEST)" aborts the run
#
# Guard 5 is the backstop: even if every other check were somehow bypassed, a
# database containing real practices is refused.
#
# NEVER run this against production. Production has evolved past the 2026-07-07
# snapshot embedded in catchup_reconcile; replaying it there would revert later
# work. This path is for an empty database applied in chronological order only.
# =============================================================================
set -uo pipefail

DB_URL="${STAGING_SUPABASE_DB_URL:-}"
OUT="${BOOTSTRAP_OUT:-build/staging-bootstrap.sql}"

fail() { echo "::error::$1"; echo; echo "REFUSED: $1" >&2; exit 1; }

echo "── Guards ───────────────────────────────────────────────"
node --input-type=module -e "
import { assertStagingDbUrl, assertAppEnvStaging, assertConfirmation } from './scripts/lib/staging-guard.mjs';
try {
  assertAppEnvStaging(process.env.APP_ENV);                              // guard 1
  assertConfirmation(process.env.CONFIRM, 'INITIALIZE STAGING');         // guard 2
  const ref = assertStagingDbUrl(process.env.STAGING_SUPABASE_DB_URL);   // guards 3 + 4
  console.log('  ok  APP_ENV is staging');
  console.log('  ok  confirmation phrase matched');
  console.log('  ok  target project ref: ' + ref + '  (verified NOT production)');
} catch (e) { console.error('  ' + e.message); process.exit(1); }
" || fail "guard check failed — nothing was written"

command -v psql >/dev/null || fail "psql is not installed"

echo
echo "── Target verification ──────────────────────────────────"
HAS_TABLE="$(psql "$DB_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_name='practices';" 2>/dev/null)" \
  || fail "could not connect to the staging database (check STAGING_SUPABASE_DB_URL)"

if [ "$HAS_TABLE" = "0" ]; then
  echo "  ok  database is empty — first initialization"
else
  REAL="$(psql "$DB_URL" -tAc "select count(*) from practices where name not like '%(TEST)';" 2>/dev/null)" \
    || fail "could not inspect the practices table"
  if [ "${REAL:-1}" != "0" ]; then
    fail "target contains ${REAL} practice(s) that are not synthetic fixtures. This does not look like a staging database. Refusing to run DDL."
  fi
  TOTAL="$(psql "$DB_URL" -tAc "select count(*) from practices;" 2>/dev/null)"
  echo "  ok  already initialized; ${TOTAL} practice(s), all synthetic fixtures — safe to re-apply"
fi

echo
echo "── Assembling bootstrap ─────────────────────────────────"
node scripts/build-staging-bootstrap.mjs --out "$OUT" || fail "could not assemble the bootstrap"

echo
echo "── Applying ─────────────────────────────────────────────"
# ON_ERROR_STOP makes psql abort on the first failed statement rather than
# limping onward and leaving a half-built schema.
if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$OUT" > /tmp/bootstrap.log 2>&1; then
  echo "  bootstrap FAILED — last 25 lines:"
  tail -25 /tmp/bootstrap.log | sed 's/^/    /'
  fail "schema bootstrap failed. The database may be partially initialized; fix the error and re-run."
fi
echo "  ok  schema applied"

TABLES="$(psql "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
RLS_OFF="$(psql "$DB_URL" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")"
echo "  ok  ${TABLES} tables in public schema"
if [ "${RLS_OFF:-1}" != "0" ]; then
  fail "${RLS_OFF} table(s) have Row Level Security DISABLED. Refusing to report success."
fi
echo "  ok  Row Level Security enabled on every table"
