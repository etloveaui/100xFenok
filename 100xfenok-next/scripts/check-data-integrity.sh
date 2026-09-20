#!/usr/bin/env bash
set -u
bash scripts/load-guard.sh --assert-nested || exit $?
result=0
check() { "$@" || result=1; }
check node ../scripts/test-data-integrity-fixes.mjs
check python3 ../scripts/test_build_market_facts.py BuildMarketFactsTest.test_previous_close_uses_regular_session_close
check python3 ../scripts/test_stockanalysis_workflow_contract.py
check npx --no-install tsx scripts/test-fenok-etf-signal-route.ts
check npx --no-install tsx scripts/test-dashboard-integrity.ts
check node ../scripts/test-cloud-data-plane-publisher.mjs
check node ../scripts/test-cloud-data-plane-generation.mjs
exit "$result"
