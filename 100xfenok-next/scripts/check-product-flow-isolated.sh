#!/usr/bin/env bash
set -euo pipefail

bash scripts/load-guard.sh --assert-nested
export NEXT_TELEMETRY_DISABLED="1"
export QA_BASE_URL="http://127.0.0.1:3107"
export QA_SCREENSHOT_DIR="test-results/product-flow"
mkdir -p "$QA_SCREENSHOT_DIR"

# Keep model and browser RED evidence in the same hosted run. Neither a model
# failure nor the first browser failure should hide the other audited defects.
model_status=0
npm run test:product-flow-regressions || model_status=$?

# Reuse committed application assets and only generate build-time imports.
# Browser data is synthetic/intercepted; financial derivation remains owned by
# the unchanged production build and is not needed for this isolated surface.
npm run build:version
npm run build:lane-runid-map
npm run build:static-route-manifest
mkdir -p public/data/catalog
cp ../data/catalog/macro-series.json public/data/catalog/macro-series.json
npx playwright install --with-deps chromium webkit

bash scripts/load-guard.sh --assert-nested
NEXT_BUILD_TARGET=cloudflare npm run cf:build:next

server_pid=""
server_log="${RUNNER_TEMP:-/tmp}/product-flow-server.log"
cleanup() {
  if [ -n "$server_pid" ]; then
    kill "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
npm run start:qa -- --hostname 127.0.0.1 --port 3107 > "$server_log" 2>&1 &
server_pid="$!"
ready=false
for attempt in $(seq 1 45); do
  if curl -fsS "$QA_BASE_URL/portfolio/" -o /dev/null; then
    ready=true
    break
  fi
  sleep 2
done
if [ "$ready" != true ]; then
  sed -n '1,160p' "$server_log"
  exit 1
fi

browser_status=0
bash scripts/load-guard.sh --assert-nested
npm run qa:product-flow-browser || browser_status=$?
printf 'product-flow model_status=%s browser_status=%s\n' "$model_status" "$browser_status"
if [ "$model_status" -ne 0 ] || [ "$browser_status" -ne 0 ]; then
  exit 1
fi
