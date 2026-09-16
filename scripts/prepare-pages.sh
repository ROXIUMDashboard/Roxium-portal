#!/usr/bin/env bash
# Build the static site bundle for Cloudflare Pages / Workers assets deploy.
# Injects the current Git commit SHA so production always shows what was deployed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/site"
FULL_SHA="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
SHORT_SHA="${FULL_SHA:0:7}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Which Supabase project this bundle is allowed to talk to. Stamped into config.js
# below. Leave unset for a local build: config.js then resolves by hostname and
# still fails closed on an unknown host. It NEVER defaults to production.
ROXIUM_ENV="${ROXIUM_ENV:-}"
if [ -n "$ROXIUM_ENV" ] && [ "$ROXIUM_ENV" != "production" ] && [ "$ROXIUM_ENV" != "staging" ]; then
  echo "ERROR: ROXIUM_ENV must be 'production' or 'staging' (got '$ROXIUM_ENV')" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"

for f in index.html app.js styles.css config.js _headers; do
  cp "$ROOT/$f" "$OUT/"
done
if [ -f "$ROOT/_redirects" ]; then cp "$ROOT/_redirects" "$OUT/"; fi
mkdir -p "$OUT/portal"
cp "$ROOT/portal/index.html" "$OUT/portal/"

# Standalone static pages served at their own directory-index URLs
# (roxium.com/privacy, roxium.com/terms). Must be copied explicitly — the
# bundle is an allow-list, and the SPA fallback would otherwise serve the
# portal for these paths.
for d in privacy terms; do
  if [ -f "$ROOT/$d/index.html" ]; then
    mkdir -p "$OUT/$d"
    cp "$ROOT/$d/index.html" "$OUT/$d/"
  fi
done

# Inject deploy identity into HTML (cache-bust + footer label).
sed -i "s/BUILD_SHA/$SHORT_SHA/g" "$OUT/index.html" "$OUT/portal/index.html"

# Stamp the target environment into the bundled config.js. config.js cross-checks
# this against the hostname it is actually served from and refuses to connect on a
# mismatch, so a staging bundle can never be served to customers (or vice versa).
if [ -n "$ROXIUM_ENV" ]; then
  sed -i "s/__ROXIUM_BUILD_ENV__/$ROXIUM_ENV/g" "$OUT/config.js"
  grep -q "__ROXIUM_BUILD_ENV__" "$OUT/config.js" && { echo "ERROR: failed to stamp ROXIUM_ENV into config.js" >&2; exit 1; }
fi

# Staging's public Supabase values come from the GitHub `staging` environment so
# that nobody has to hand-edit config.js. Both are PUBLIC values (RLS protects the
# data) — a service-role key must never be passed here. Refuse if only one is set,
# and refuse outright if they point at production.
if [ -n "${ROXIUM_STAGING_SUPABASE_URL:-}" ] || [ -n "${ROXIUM_STAGING_SUPABASE_ANON_KEY:-}" ]; then
  if [ -z "${ROXIUM_STAGING_SUPABASE_URL:-}" ] || [ -z "${ROXIUM_STAGING_SUPABASE_ANON_KEY:-}" ]; then
    echo "ERROR: set BOTH ROXIUM_STAGING_SUPABASE_URL and ROXIUM_STAGING_SUPABASE_ANON_KEY, or neither" >&2
    exit 1
  fi
  case "$ROXIUM_STAGING_SUPABASE_URL" in
    *nchtmeqsjkpcvtuscxfy*)
      echo "ERROR: ROXIUM_STAGING_SUPABASE_URL points at the PRODUCTION project. Refusing." >&2
      exit 1 ;;
  esac
  python3 - "$OUT/config.js" "$ROXIUM_STAGING_SUPABASE_URL" "$ROXIUM_STAGING_SUPABASE_ANON_KEY" <<'PYEOF'
import sys
path, url, key = sys.argv[1], sys.argv[2], sys.argv[3]
t = open(path).read()
t = t.replace('__ROXIUM_STAGING_SUPABASE_URL__', url).replace('__ROXIUM_STAGING_SUPABASE_ANON_KEY__', key)
open(path, 'w').write(t)
PYEOF
  grep -q "__ROXIUM_STAGING_SUPABASE" "$OUT/config.js" && { echo "ERROR: failed to inject staging values" >&2; exit 1; }
  echo "  Staging Supabase values: injected"
fi

cat > "$OUT/version.json" <<EOF
{"sha":"$SHORT_SHA","full_sha":"$FULL_SHA","built_at":"$BUILT_AT","environment":"${ROXIUM_ENV:-unstamped}"}
EOF

echo "Prepared site/ for deploy"
echo "  SHA: $SHORT_SHA ($FULL_SHA)"
echo "  Environment: ${ROXIUM_ENV:-unstamped (resolves by hostname)}"
echo "  Output: $OUT"
ls -la "$OUT"
