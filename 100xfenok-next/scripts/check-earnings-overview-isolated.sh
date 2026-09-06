#!/usr/bin/env bash
set -euo pipefail
bash scripts/load-guard.sh --assert-nested
export NEXT_TELEMETRY_DISABLED=1
export QA_BASE_URL=http://127.0.0.1:3107
npm run qa:earnings-overview
npm run qa:registry-contracts
npm run build:version
# Stock/screener QA consumes the committed canonical data through the normal
# public mirror. Full estate derivation and legacy-site copying belong to the
# production build; repeating them dominates a focused interaction rerun.
node scripts/sync-public-data.mjs --write
npm run build:lane-runid-map
npm run build:static-route-manifest
npx playwright install --with-deps chromium webkit
bash scripts/load-guard.sh --assert-nested
NEXT_BUILD_TARGET=cloudflare npm run cf:build:next
server_pid=""
server_log="${RUNNER_TEMP:-/tmp}/earnings-overview-server.log"
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
  if curl -fsS "$QA_BASE_URL/screener" -o /dev/null; then ready=true; break; fi
  sleep 2
done
if [ "$ready" != true ]; then sed -n '1,160p' "$server_log"; exit 1; fi
bash scripts/load-guard.sh --assert-nested
npm run qa:earnings-overview-browser
