#!/usr/bin/env bash
set -euo pipefail
bash scripts/load-guard.sh --assert-nested
npx playwright install --with-deps chromium webkit
export EARNINGS_QA_LIVE=1
export QA_BASE_URL=https://100xfenok.etloveaui.workers.dev
npm run qa:earnings-overview-browser
