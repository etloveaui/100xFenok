#!/usr/bin/env bash
set -euo pipefail

bash scripts/load-guard.sh --assert-nested

export NEXT_TELEMETRY_DISABLED="1"
export NEXT_ADMIN_PASSWORD_HASH="ec2cdb05a5c068029063f9b110bf80fa04630c989080f2097ff5b69aa767e904"
export NEXT_ADMIN_SESSION_SECRET="winddown-stage1-synthetic-session-${GITHUB_RUN_ID:?}"
export WINDDOWN_QA_ADMIN_PASSWORD="winddown-stage1-synthetic-admin"
export WINDDOWN_QA_ISOLATED="1"
export WINDDOWN_DATA_WORKSPACE="qa"
export QA_BASE_URL="http://127.0.0.1:3107"
export QA_SCREENSHOT_DIR="test-results/winddown-preservation"

bash scripts/load-guard.sh --assert-nested
if [ "${WINDDOWN_QA_SCOPE:-preservation}" = "story" ]; then
  npm run test:winddown-story-gate
fi
npm run build:version
if [ "${WINDDOWN_QA_SCOPE:-preservation}" = "story" ] || [ "${WINDDOWN_QA_SCOPE:-preservation}" = "coach" ]; then
  # Story/coach requests use committed art and intercepted synthetic APIs. Reuse the
  # pushed public assets and generate only build imports; financial derivation
  # is unrelated to this isolated surface and remains in the production build.
  npm run build:lane-runid-map
  npm run build:static-route-manifest
  mkdir -p public/data/catalog
  cp ../data/catalog/macro-series.json public/data/catalog/macro-series.json
else
  npm run sync-static
fi
if [ "${WINDDOWN_QA_SCOPE:-preservation}" = "coach" ]; then
  npm run test:winddown-coach-gate
elif [ "${WINDDOWN_QA_SCOPE:-preservation}" = "continuity" ]; then
  npm run test:winddown-continuity-gate
elif [ "${WINDDOWN_QA_SCOPE:-preservation}" != "story" ]; then
  npm run test:winddown-preservation-gate
fi
npx playwright install --with-deps chromium webkit

bash scripts/load-guard.sh --assert-nested
if ! NEXT_BUILD_TARGET=cloudflare npm run cf:build:next; then
  # Next reports only its first type error; collect the complete diagnostics.
  npx tsc --noEmit --incremental false
  exit 1
fi

server_pid=""
server_log="${RUNNER_TEMP:-/tmp}/winddown-preservation-server.log"
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
  if curl -fsS "$QA_BASE_URL/winddown/learn/" -o /dev/null; then
    ready=true
    break
  fi
  sleep 2
done
if [ "$ready" != true ]; then
  sed -n '1,240p' "$server_log"
  exit 1
fi

bash scripts/load-guard.sh --assert-nested
if [ "${WINDDOWN_QA_SCOPE:-preservation}" = "coach" ]; then
  npx tsx scripts/check-winddown-coach-browser.ts
else
  npm run qa:winddown-preservation-browser
fi
