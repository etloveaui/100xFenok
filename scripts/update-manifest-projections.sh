#!/usr/bin/env bash
#
# Rebuild the disposable checkout from its already materialized active inputs.
# publish-update-manifest.sh promotes the resulting platform generation.
#
# Environment contract (all values are required and validated before S1):
#   REBUILD_SLICKCHARTS           "true" -> rebuild SlickCharts canonical source
#                                           (membership-tracker + discovery)
#                                           before anything else
#                                 "false" -> skip the rebuild
#   VALIDATE_SLICKCHARTS_SKIP_PUBLIC
#                                 "true" -> run validate-slickcharts-integrity.py
#                                           --skip-public right after the
#                                           rebuild
#                                 "false" -> skip the initial-only validation
#   BEFORE_SHA                    passed through to update-manifest.py (push
#                                 covers ALL commits; scheduled/manual runs use
#                                 AUTO)
#   GITHUB_RUN_ID / GITHUB_RUN_ATTEMPT
#                                 name the detection-floor attempt scratch dir
#
# Exit semantics match GitHub's default bash shell (`bash -e -o pipefail`): any
# failing command or pipeline aborts the runner; update-manifest.py exit 1
# (warnings only) is tolerated and the run proceeds. The S13 subshell retains
# its original additional `-u` behavior.

set -eo pipefail

require_boolean() {
  local name="$1"
  local value="${!name-}"
  case "$value" in
    true|false) ;;
    *)
      echo "$name must be explicitly set to true or false" >&2
      exit 2
      ;;
  esac
}

require_boolean REBUILD_SLICKCHARTS
require_boolean VALIDATE_SLICKCHARTS_SKIP_PUBLIC
if [[ ! "${BEFORE_SHA-}" =~ ^(AUTO|[0-9a-fA-F]{40})$ ]]; then
  echo "BEFORE_SHA must be AUTO or a 40-character hexadecimal commit id" >&2
  exit 2
fi

node scripts/materialize-cloud-data-plane-family.mjs --hydrate-canonical
node scripts/materialize-cloud-data-plane-family.mjs --hydrate-small-macro
node scripts/materialize-cloud-data-plane-family.mjs --hydrate-public-family sentiment
node scripts/materialize-cloud-data-plane-family.mjs --hydrate-public-family nasdaq-giw-sox
node scripts/materialize-cloud-data-plane-family.mjs --hydrate-public-family us-indices-daily
node scripts/materialize-cloud-data-plane-family.mjs --hydrate-private-family gdelt-news-tone
# Reuse the already verified active Yahoo tree; derive indexes without another read.
if [[ -n "${YAHOO_ACTIVE_PROJECTION_ROOT:-}" ]]; then
  cp -R "$YAHOO_ACTIVE_PROJECTION_ROOT/." data/yf/
  if [[ -f data/yf/_acquisition-state.json ]]; then
    python3 scripts/yahoo_batch_state.py hydrate-generation --state-root data/admin/yahoo-batch-quote-history
  fi
fi

# --- S0: Metadata comes from the active platform-projections generation ----

# --- S1: Rebuild and verify SlickCharts canonical source --------------------
if [ "$REBUILD_SLICKCHARTS" = "true" ]; then
  python scripts/scrapers/membership-tracker.py --quiet
  node scripts/build-slickcharts-discovery.mjs
fi

# Weekly holdings may advance before monthly history. Accept retained-history
# coverage gaps only while its producer-bound bytes remain intact; acquisition
# workflows keep the validator's strict default.
node scripts/slickcharts-composite-recovery.mjs validate-live --index data/admin/slickcharts-composite-recovery/index.json
if [ "$VALIDATE_SLICKCHARTS_SKIP_PUBLIC" = "true" ]; then
  python3 scripts/validate-slickcharts-integrity.py --skip-public --allow-history-coverage-lag
fi

# --- S2: Build shared market and stock promotion state ----------------------
python3 scripts/rebuild-yf-finance-summary.py
python3 scripts/build-market-facts.py --no-public-mirror
python3 scripts/build-market-source-parity.py
python3 scripts/audit-market-data.py --output data/computed/market_data_audit.json --mirror-public
node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check

# --- S3: Project manifest-owned public mirrors ------------------------------
node scripts/materialize-update-manifest-routes.mjs --all
python3 scripts/validate-slickcharts-integrity.py --allow-history-coverage-lag
diff -qr data/slickcharts 100xfenok-next/public/data/slickcharts
# The surfaces mirror sat two producer cycles behind its source without
# anything noticing: the producer's own run of the surface contract
# overrides the comparison target with a copy of the source, so its
# byte-equality assertion cannot fail there. Prove the mirror where it is
# actually produced, exactly as SlickCharts already does above. Scoped to
# surfaces because `etfs/` is served privately from its active generation.
diff -qr data/stockanalysis/surfaces 100xfenok-next/public/data/stockanalysis/surfaces

# --- S4: Export computed signals --------------------------------------------
node scripts/export-computed-signals.mjs

# --- S5: Build phase2 closeout indexes --------------------------------------
node scripts/build-phase2-closeout-indexes.mjs

# --- S5b: Refresh the review-only SEC 13F bridge index -----------------------
# The bridge seals input fingerprints for stock_action_index.json,
# market_facts/index.json and the market-facts detail set. Update Manifest owns
# the git copies of all three (CENTRAL_COMMIT_PATHS), so the seal has to be
# rebuilt here or it goes stale on every computed-signals refresh. Its other
# owner, build-stocks-analyzer.yml, cannot cover that: pushes made by a
# workflow do not trigger another workflow, so its own push trigger never fires
# for these commits and only its daily cron heals the seal.
node scripts/build-sec13f-bridge-index.mjs

# --- S6: Build Fenok stock signals ------------------------------------------
node scripts/build-fenok-signals.mjs

# --- S7: Build ETF projections ----------------------------------------------
node scripts/build-fenok-etf-signals.mjs
npm --prefix 100xfenok-next run build:history-gap-daily1y
node scripts/build-fenok-etf-action-index.mjs
node scripts/build-fenok-etf-core-daily-basket.mjs --check
node scripts/materialize-update-manifest-routes.mjs \
  --route-source data/computed/fenok_etf_core_daily_basket_summary.json

# --- S8: Build Fenok edge projections ---------------------------------------
node scripts/build-fenok-edge-coverage-index.mjs
node scripts/audit-fenok-s0-source-gaps.mjs --check --write-ledger
node scripts/write-fenok-etf-daily1y-readiness.mjs --check
npm --prefix 100xfenok-next run build:fenok-etf-daily1y-dispatch-plan

# --- S9: Run update-manifest.py ---------------------------------------------
# Exit code 1 = warnings only (orphan files / missing folders).
# These are non-fatal — the manifest update still proceeds.
# BEFORE_SHA: covers ALL commits in the push (not just HEAD~1).
# Scheduled/manual runs infer the last manifest refresh commit.
status=0
python3 scripts/update-manifest.py || status=$?
if [ "$status" -ne 0 ] && [ "$status" -ne 1 ]; then
  echo "update-manifest.py exited with $status" >&2
  exit "$status"
fi

node scripts/test-manifest-halves-agree.mjs

# --- S10: Build data entity graph after manifest refresh --------------------
npm --prefix 100xfenok-next run build:data-entity-graph

# --- S11: Build product surface coverage ------------------------------------
node scripts/generate-product-surface-coverage.mjs

# --- S12: Sync static overrides ---------------------------------------------
(cd 100xfenok-next && node sync-static-overrides.mjs)

# --- S13: Build data supply detection floor ---------------------------------
(
  set -euo pipefail

  repo_root="$(pwd -P)"
  output_root="$(mktemp -d "${RUNNER_TEMP:-/tmp}/fenok-data-supply-detection-floor-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-XXXXXX")"
  report_path="$output_root/data-supply-detection-floor.json"
  installed_path="$repo_root/data/admin/data-supply-detection-floor.json"
  trap 'rm -rf "$output_root"' EXIT

  chmod 0700 "$output_root"
  now="$(node -e 'process.stdout.write(new Date().toISOString())')"

  node scripts/build-data-supply-detection-floor.mjs \
    --artifact-root "$repo_root" \
    --calendars "$repo_root/scripts/lib/data-supply-detection-calendars.json" \
    --now "$now" \
    --output-root "$output_root"
  node scripts/build-data-supply-detection-floor.mjs --verify-report "$report_path"

  install -m 0644 "$report_path" "$installed_path"
)

# --- S14: Build data health KPI ---------------------------------------------
npm --prefix 100xfenok-next run build:fenok-data-health-kpi
npm --prefix 100xfenok-next run qa:fenok-data-health-kpi:artifact
npm --prefix 100xfenok-next run build:lane-registry-projection
node 100xfenok-next/scripts/check-fenok-public-mirror-guard.mjs
npm --prefix 100xfenok-next run build:static-route-manifest

# Publish the refreshed bridge together with its active Scouter core inputs.
node scripts/publish-cloud-data-generation.mjs --family=scouter-derived --json
