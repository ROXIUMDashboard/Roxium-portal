#!/usr/bin/env bash
# Deploy every Supabase Edge Function to ONE project.
#
#   SUPABASE_ACCESS_TOKEN=... PROJECT_REF=... bash scripts/deploy-functions.sh
#
# Shared by deploy-staging.yml and deploy-production.yml so staging and production
# deploy the same way to different projects. Each function enforces its own auth
# (team JWT, shared sync key, or signed callback state), so all deploy with
# --no-verify-jwt and gate internally.
#
# Deliberately no `set -e`: esm.sh intermittently 522s while bundling, so each
# function is retried, and the script fails only if one is still broken at the end.
set -uo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is required}"
: "${PROJECT_REF:?PROJECT_REF is required}"

command -v supabase >/dev/null || npm install -g supabase@latest

fail=0
for dir in supabase/functions/*/; do
  name="$(basename "$dir")"
  [ "$name" = "_shared" ] && continue
  ok=0
  for attempt in 1 2 3; do
    echo "::group::deploy $name -> $PROJECT_REF (attempt $attempt/3)"
    if supabase functions deploy "$name" --project-ref "$PROJECT_REF" --no-verify-jwt; then
      ok=1; echo "::endgroup::"; break
    fi
    echo "::endgroup::"
    echo "deploy of $name failed (attempt $attempt) — retrying after backoff"
    sleep $((attempt * 10))
  done
  [ "$ok" = "1" ] || { echo "::error::failed to deploy $name after 3 attempts"; fail=1; }
done
exit $fail
