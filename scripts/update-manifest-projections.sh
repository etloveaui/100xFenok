#!/usr/bin/env bash
#
# Single source of truth for the Update Manifest rebuild/projection stack
# (S1-S14). Invoked by .github/workflows/update-manifest.yml from BOTH the
# initial path and the push-retry loop, so the projection sequence cannot
# drift between call sites. This is an extraction, not a redesign: command
# order, flags, and exit semantics are preserved from the workflow.
#
# The S15 "Check if manifest changed" probe stays in the workflow because its
# consumers differ (step outputs in the initial path, retry branching in the
# loop); it is a status probe, not a projection command.
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
#   RESET_ETF_SNAPSHOTS           "true" -> remove the immutable-snapshot root
#                                           before re-materializing
#                                 "false" -> preserve the fresh-checkout root
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
require_boolean RESET_ETF_SNAPSHOTS
if [[ ! "${BEFORE_SHA-}" =~ ^(AUTO|[0-9a-fA-F]{40})$ ]]; then
  echo "BEFORE_SHA must be AUTO or a 40-character hexadecimal commit id" >&2
  exit 2
fi

# --- S0: Adopt legacy site metadata into its canonical root ----------------
# The two legacy surfaces remain producer-owned. Their disjoint JSON outputs
# are merged fail-closed before any canonical/public projection consumes them.
node scripts/materialize-site-metadata.mjs --write

# --- S1: Rebuild and verify SlickCharts canonical source --------------------
if [ "$REBUILD_SLICKCHARTS" = "true" ]; then
  python scripts/scrapers/membership-tracker.py --quiet
  node scripts/build-slickcharts-discovery.mjs
fi

if [ "$VALIDATE_SLICKCHARTS_SKIP_PUBLIC" = "true" ]; then
  python3 scripts/validate-slickcharts-integrity.py --skip-public
fi

# --- S2: Build shared market and stock promotion state ----------------------
python3 scripts/rebuild-yf-finance-summary.py
python3 scripts/build-market-facts.py --no-public-mirror
python3 scripts/build-market-source-parity.py
python3 scripts/audit-market-data.py --output data/computed/market_data_audit.json --mirror-public
node scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check

# --- S3: Project manifest-owned public mirrors ------------------------------
node scripts/materialize-update-manifest-routes.mjs --all
# Run 30689758451 died at the immutable-snapshot guard: this attempt
# re-projected on top of the snapshot directory an earlier projection
# had already written into the working tree, and the guard compares
# bytes rather than replacing. A content-addressed directory may be
# replaced, never compared against a stale sibling, so every attempt
# starts from an empty snapshot root. `git reset --hard` above already
# restored the tracked snapshot, and the projector rewrites it, so an
# unchanged source produces an identical tree and no diff.
if [ "$RESET_ETF_SNAPSHOTS" = "true" ]; then
  rm -rf 100xfenok-next/public/data/stockanalysis/etfs/shards/snapshots
fi
node 100xfenok-next/scripts/sync-public-data.mjs --write --etf-shards-only
python3 scripts/validate-slickcharts-integrity.py
diff -qr data/slickcharts 100xfenok-next/public/data/slickcharts
# The surfaces mirror sat two producer cycles behind its source without
# anything noticing: the producer's own run of the surface contract
# overrides the comparison target with a copy of the source, so its
# byte-equality assertion cannot fail there. Prove the mirror where it is
# actually produced, exactly as SlickCharts already does above. Scoped to
# surfaces because `etfs/` is deliberately shard-only and excluded from
# this mirror.
diff -qr data/stockanalysis/surfaces 100xfenok-next/public/data/stockanalysis/surfaces

# --- S4: Export computed signals --------------------------------------------
node scripts/export-computed-signals.mjs

# --- S5: Build phase2 closeout indexes --------------------------------------
node scripts/build-phase2-closeout-indexes.mjs

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
  shard_root="$repo_root/data/admin/data-supply-state/detection-attempts"
  output_root="$(mktemp -d "/tmp/fenok-data-supply-detection-floor-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-XXXXXX")"
  report_path="$output_root/data-supply-detection-floor.json"
  installed_path="$repo_root/data/admin/data-supply-detection-floor.json"
  trap 'rm -rf "$output_root"' EXIT

  mkdir -p "$shard_root"
  chmod 0700 "$output_root"
  now="$(node -e 'process.stdout.write(new Date().toISOString())')"

  node scripts/build-data-supply-detection-floor.mjs \
    --artifact-root "$repo_root" \
    --attempt-shard-root "$shard_root" \
    --calendars "$repo_root/scripts/lib/data-supply-detection-calendars.json" \
    --now "$now" \
    --output-root "$output_root"
  node scripts/build-data-supply-detection-floor.mjs --verify-report "$report_path"

  install -m 0644 "$report_path" "$installed_path"
)

# --- S14: Build data health KPI ---------------------------------------------
npm --prefix 100xfenok-next run build:fenok-data-health-kpi
npm --prefix 100xfenok-next run build:lane-registry-projection
node 100xfenok-next/scripts/check-fenok-public-mirror-guard.mjs
npm --prefix 100xfenok-next run build:static-route-manifest
