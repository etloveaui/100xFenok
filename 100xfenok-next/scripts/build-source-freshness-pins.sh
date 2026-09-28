#!/usr/bin/env bash
set -euo pipefail

bash scripts/load-guard.sh --assert-nested
repo_root="$(git rev-parse --show-toplevel)"

node ../scripts/test-sparse-checkout-import-coverage.mjs
node --input-type=module -e 'import { emitDetectionExpectedFixture } from "../scripts/build-data-supply-detection-floor.mjs"; emitDetectionExpectedFixture();'

floor_output="$(mktemp -d /tmp/fenok-source-freshness-floor-XXXXXX)"
trap 'rm -rf "$floor_output"' EXIT
node ../scripts/build-data-supply-detection-floor.mjs \
  --artifact-root "$repo_root" \
  --calendars "$repo_root/scripts/lib/data-supply-detection-calendars.json" \
  --now "$(node -e 'process.stdout.write(new Date().toISOString())')" \
  --output-root "$floor_output"
node ../scripts/build-data-supply-detection-floor.mjs --verify-report "$floor_output/data-supply-detection-floor.json"
install -m 0644 "$floor_output/data-supply-detection-floor.json" "$repo_root/data/admin/data-supply-detection-floor.json"

npm run build:fenok-edge-coverage-index
npm run qa:fenok-edge-coverage-index
npm run build:fenok-data-health-kpi
npm run qa:source-freshness-policy
npm run qa:fenok-data-health-kpi:artifact
