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
# Data safety first, and it applies to BOTH paths below: even when no DDL runs,
# the caller goes on to seed synthetic fixtures, which must never land on a
# database holding real practices.
CAN_CONNECT="$(psql "$DB_URL" -tAc "select 1;" 2>/dev/null)" \
  || fail "could not connect to the staging database (check STAGING_SUPABASE_DB_URL)"

if [ "$(psql "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name='practices';" 2>/dev/null)" != "0" ]; then
  REAL="$(psql "$DB_URL" -tAc "select count(*) from practices where name not like '%(TEST)';" 2>/dev/null)" \
    || fail "could not inspect the practices table"
  if [ "${REAL:-1}" != "0" ]; then
    fail "target contains ${REAL} practice(s) that are not synthetic fixtures. This does not look like a staging database. Refusing to proceed."
  fi
  echo "  ok  $(psql "$DB_URL" -tAc "select count(*) from practices;" 2>/dev/null) practice row(s), all synthetic fixtures"
else
  echo "  ok  no practices table yet"
fi

# ---------------------------------------------------------------------------
# State classification.
#
# The bootstrap is schema.sql PLUS the whole migration history, and that history
# is NOT infinitely replayable: delete_practice(uuid) changes its return type
# (void -> jsonb) partway through, so replaying the older definition over the
# newer one makes Postgres refuse with "cannot change return type of existing
# function". That is what killed Initialize STAGING #2 on a database that was
# otherwise perfectly healthy.
#
# So the bootstrap runs ONCE, on a database that has nothing. An already
# initialized database is verified and left alone. Anything in between is
# refused rather than guessed at.
# ---------------------------------------------------------------------------
echo
echo "── State ────────────────────────────────────────────────"
STATE_SQL="$(dirname "$0")/staging-state.sql"
[ -f "$STATE_SQL" ] || fail "missing $STATE_SQL"
MARKERS="$(psql "$DB_URL" -tA -f "$STATE_SQL" 2>/dev/null)" || fail "could not read the database state"

printf '%s\n' "$MARKERS" | sed 's/^/  /'

# Classification lives in scripts/lib/staging-state.mjs so that this script and
# the tests that prove it correct cannot drift apart.
CLASSIFY="$(printf '%s\n' "$MARKERS" | node --input-type=module -e '
import { classify } from "./scripts/lib/staging-state.mjs";
let raw = ""; process.stdin.setEncoding("utf8");
for await (const c of process.stdin) raw += c;
const r = classify(raw);
console.log(r.state);
if (r.reasons.length) console.error(r.reasons.join("; "));
' 2>/tmp/state-reasons.txt)" || fail "could not classify the database state"
STATE="$CLASSIFY"
REASONS="$(cat /tmp/state-reasons.txt 2>/dev/null || true)"
echo
echo "  STATE: $STATE"
[ -n "$REASONS" ] && echo "  why:   $REASONS"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "state=$STATE" >> "$GITHUB_OUTPUT"

case "$STATE" in
  PARTIAL)
    echo
    echo "REFUSED: the database is PARTIALLY initialized." >&2
    echo >&2
    echo "Some of the schema is present and some is not. Replaying the bootstrap" >&2
    echo "over it would fail part-way and could leave it in a worse state, so" >&2
    echo "nothing has been written." >&2
    echo >&2
    echo "What is off: ${REASONS:-see the markers above}" >&2
    echo >&2
    echo "Most likely: only schema.sql was applied, without the migrations; or a" >&2
    echo "previous run was interrupted." >&2
    echo >&2
    echo "The safe fix on a STAGING database with no real data is to drop the" >&2
    echo "public schema and re-run this, so the bootstrap starts from nothing:" >&2
    echo "  drop schema public cascade; create schema public;" >&2
    echo "Do that deliberately, never as part of an automated run." >&2
    exit 1
    ;;

  INITIALIZED)
    echo "  The schema is already complete. SKIPPING the bootstrap — replaying the"
    echo "  migration history over an initialized database is not safe (see above)."
    echo "  Verifying what is actually there instead."
    ;;

  NEW)
    echo
    echo "── Assembling bootstrap ─────────────────────────────────"
    node scripts/build-staging-bootstrap.mjs --out "$OUT" || fail "could not assemble the bootstrap"

    echo
    echo "── Applying (one time only) ─────────────────────────────"
    # ON_ERROR_STOP makes psql abort on the first failed statement rather than
    # limping onward and leaving a half-built schema.
    if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -q -f "$OUT" > /tmp/bootstrap.log 2>&1; then
      echo "  bootstrap FAILED — last 25 lines:"
      tail -25 /tmp/bootstrap.log | sed 's/^/    /'
      fail "schema bootstrap failed. The database may be partially initialized; see the PARTIAL guidance above."
    fi
    echo "  ok  schema applied"
    ;;
esac

# ---------------------------------------------------------------------------
# Verification runs on BOTH paths — a skipped bootstrap still has to prove the
# schema it skipped over is sound.
# ---------------------------------------------------------------------------
echo
echo "── Verification ─────────────────────────────────────────"
TABLES="$(psql "$DB_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE';")"
RLS_OFF="$(psql "$DB_URL" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")"
echo "  ok  ${TABLES} tables in public schema"
if [ "${RLS_OFF:-1}" != "0" ]; then
  fail "${RLS_OFF} table(s) have Row Level Security DISABLED. Refusing to report success."
fi
echo "  ok  Row Level Security enabled on every table"

# Re-read the markers so a skipped bootstrap is held to the same bar as a fresh one.
POST="$(psql "$DB_URL" -tA -f "$STATE_SQL" 2>/dev/null)" || fail "could not re-read the database state"
POST_CORE="$(printf '%s\n' "$POST" | sed -n 's/^core_tables=//p')"
POST_FUNCS="$(printf '%s\n' "$POST" | sed -n 's/^core_functions=//p')"
POST_LATEST="$(printf '%s\n' "$POST" | sed -n 's/^latest_markers=//p')"
[ "$POST_CORE" = "10/10" ]   || fail "after initialization only $POST_CORE core tables are present."
[ "$POST_FUNCS" = "8/8" ]    || fail "after initialization only $POST_FUNCS core functions are present."
[ "$POST_LATEST" = "5/5" ]   || fail "after initialization only $POST_LATEST latest-migration markers are present."
echo "  ok  core tables $POST_CORE, core functions $POST_FUNCS, latest markers $POST_LATEST"
echo
echo "  Result: $STATE -> schema verified."
