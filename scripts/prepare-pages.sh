#!/usr/bin/env bash
# Build the static site bundle for Cloudflare Pages / Workers assets deploy.
# Injects the current Git commit SHA so production always shows what was deployed.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/site"
FULL_SHA="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
SHORT_SHA="${FULL_SHA:0:7}"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

rm -rf "$OUT"
mkdir -p "$OUT"

for f in index.html app.js styles.css config.js _headers; do
  cp "$ROOT/$f" "$OUT/"
done
if [ -f "$ROOT/_redirects" ]; then cp "$ROOT/_redirects" "$OUT/"; fi

# Inject deploy identity into HTML (cache-bust + footer label).
sed -i "s/BUILD_SHA/$SHORT_SHA/g" "$OUT/index.html"

cat > "$OUT/version.json" <<EOF
{"sha":"$SHORT_SHA","full_sha":"$FULL_SHA","built_at":"$BUILT_AT"}
EOF

echo "Prepared site/ for deploy"
echo "  SHA: $SHORT_SHA ($FULL_SHA)"
echo "  Output: $OUT"
ls -la "$OUT"
