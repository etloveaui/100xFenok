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

# --- S-1: Verified stockanalysis-etf-detail cloud overlay (optional) ----------
# Natural StockAnalysis ETF runs publish the verified ETF canonical generation
# to the private cloud plane. Update Manifest materializes that generation ONCE
# outside the checkout (see update-manifest.yml) and exports
# ETF_DETAIL_OVERLAY_ROOT (external snapshot root) plus
# ETF_DETAIL_OVERLAY_RECEIPT (the materializer's verified receipt line). When
# BOTH are present, every projection pass in this runner:
#   * binds the verified receipt and overlay tree to the SAME generation
#     already persisted as the plane outcome on checked-out main, and to the
#     checked-out data-supply active state (generation drift fails closed using
#     existing metadata only; no payload re-fetch);
#   * snapshots the exact Git LKG data/stockanalysis/etfs tree, overlays the
#     verified external tree for the WHOLE S1-S14 pass so every canonical-ETF
#     consumer sees the same cloud generation, and restores the exact LKG
#     bytes + file-set on success, failure, HUP, INT and TERM before the
#     caller's change probe / central staging;
#   * asserts the scoped canonical ETF tree is bit-clean afterwards.
# Raw canonical ETF files are never staged or committed; Git keeps the static
# LKG tree. When the env pair is absent, overlay mode is OFF and the pass is
# byte-for-byte the previous behavior (non-ETF schedules and manual runs).
ETF_OVERLAY_MODE="false"
if [[ -n "${ETF_DETAIL_OVERLAY_ROOT:-}" || -n "${ETF_DETAIL_OVERLAY_RECEIPT:-}" ]]; then
  ETF_OVERLAY_MODE="true"
fi
ETF_LKG_TREE="data/stockanalysis/etfs"
ETF_OVERLAY_BACKUP_ROOT=""
ETF_OVERLAY_INSTALLED="false"

require_etf_overlay_env() {
  local overlay_root="${ETF_DETAIL_OVERLAY_ROOT:-}"
  local receipt_path="${ETF_DETAIL_OVERLAY_RECEIPT:-}"
  if [[ -z "$overlay_root" || -z "$receipt_path" ]]; then
    echo "ETF cloud overlay mode requires both ETF_DETAIL_OVERLAY_ROOT and ETF_DETAIL_OVERLAY_RECEIPT" >&2
    exit 2
  fi
  case "$overlay_root" in
    /*) ;;
    *) echo "ETF_DETAIL_OVERLAY_ROOT must be an absolute path" >&2; exit 2 ;;
  esac
  if [[ "$overlay_root" == *".."* ]]; then
    echo "ETF_DETAIL_OVERLAY_ROOT must not contain '..'" >&2
    exit 2
  fi
  if [[ ! -d "$overlay_root" || -L "$overlay_root" ]]; then
    echo "ETF_DETAIL_OVERLAY_ROOT must be an existing real directory" >&2
    exit 2
  fi
  if [[ ! -f "$receipt_path" || ! -r "$receipt_path" ]]; then
    echo "ETF_DETAIL_OVERLAY_RECEIPT must be a readable file" >&2
    exit 2
  fi
}

verify_etf_overlay_pointer_current() {
  node scripts/materialize-cloud-data-plane-family.mjs \
    --family stockanalysis-etf-detail \
    --verify-receipt "$ETF_DETAIL_OVERLAY_RECEIPT" \
    >/dev/null
}

# Binds the verified external generation to the existing checked-out
# authorities (persisted plane outcome shard + data-supply active state) and
# verifies the overlay tree shape. Uses only existing metadata; no payloads are
# re-fetched and the cloud is never mutated.
verify_etf_overlay_binding() {
  python3 - "$PWD" "$ETF_DETAIL_OVERLAY_ROOT" "$ETF_DETAIL_OVERLAY_RECEIPT" <<'PYEOF'
import hashlib
import json
import re
import sys
from pathlib import Path

repo_root = Path(sys.argv[1]).resolve()
overlay_root = Path(sys.argv[2]).resolve()
receipt_path = Path(sys.argv[3]).resolve()

def fail(message):
    print(f"ETF overlay binding: {message}", file=sys.stderr)
    raise SystemExit(2)

try:
    receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
except Exception as error:
    fail(f"verified receipt is unreadable: {error}")
if not isinstance(receipt, dict):
    fail("verified receipt must be a JSON object")
if receipt.get("family") != "stockanalysis-etf-detail":
    fail(f"receipt family mismatch: {receipt.get('family')!r}")
for key in ("generation_id", "manifest_sha256"):
    value = receipt.get(key)
    if not isinstance(value, str) or not value:
        fail(f"receipt {key} is missing")
if not re.fullmatch(r"[0-9a-f]{64}", receipt["manifest_sha256"]):
    fail("receipt manifest_sha256 must be 64 lowercase hex characters")

etfs_root = overlay_root
if not etfs_root.is_dir() or etfs_root.is_symlink():
    fail("overlay canonical ETF root is missing")
entries = sorted(etfs_root.iterdir())
if not entries:
    fail("overlay canonical ETF root is empty")
name_pattern = re.compile(r"^[A-Z0-9][A-Z0-9._-]*\.json$")
for entry in entries:
    if entry.is_symlink() or not entry.is_file() or not name_pattern.fullmatch(entry.name):
        fail(f"overlay canonical ETF entry must be a top-level JSON file: {entry.name}")
try:
    receipt_output_root = Path(receipt["output_root"]).resolve()
except Exception as error:
    fail(f"receipt output_root is invalid: {error}")
if receipt_output_root != etfs_root:
    fail(f"receipt output_root differs from the verified overlay root: {receipt_output_root}")
if receipt.get("asset_count") != len(entries):
    fail(f"receipt asset_count does not match the overlay file set: {receipt.get('asset_count')!r} vs {len(entries)}")
actual_total_bytes = sum(entry.stat().st_size for entry in entries)
if receipt.get("total_bytes") != actual_total_bytes:
    fail(f"receipt total_bytes does not match the overlay tree: {receipt.get('total_bytes')!r} vs {actual_total_bytes}")

shard_path = repo_root / "data/admin/data-supply-state/publish-outcomes/stockanalysis-etf-detail.json"
try:
    shard = json.loads(shard_path.read_text(encoding="utf-8"))
except Exception as error:
    fail(f"persisted plane outcome is unreadable on checked-out main: {error}")
records = shard.get("records") if isinstance(shard, dict) else None
if not isinstance(records, list) or not records:
    fail("persisted plane outcome has no records on checked-out main")
latest = records[-1]
if latest.get("generation_id") != receipt["generation_id"]:
    fail(
        "cloud generation drifted: overlay receipt generation differs from the "
        f"persisted outcome ({latest.get('generation_id')!r} vs {receipt['generation_id']!r})"
    )
if latest.get("result") not in ("published", "resumed"):
    fail(f"persisted plane outcome is not a successful generation ({latest.get('result')!r})")

sys.path.insert(0, str(repo_root / "scripts"))
from data_supply_state import DataSupplyStateStore  # existing read authority

try:
    active = DataSupplyStateStore(
        repo_root / "data/admin/data-supply-state/v1",
        defer_maintenance=True,
    ).read_active_domain("etf_detail")
except Exception as error:
    fail(f"checked-out data-supply active state is unreadable: {error}")
if not isinstance(active.get("transaction_id"), str) or not active["transaction_id"]:
    fail("checked-out data-supply active state has no resolved transaction")
current = active.get("current") or {}
if not isinstance(current, dict):
    fail("checked-out data-supply active state current map is invalid")
for ticker, selection in current.items():
    if not isinstance(selection, dict) or selection.get("provider") != "stockanalysis":
        continue
    asset = etfs_root / f"{ticker}.json"
    if not asset.is_file() or asset.is_symlink():
        fail(f"verified overlay generation is missing primary asset for selected entity {ticker}")
    payload_sha256 = selection.get("payload_sha256")
    if not isinstance(payload_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", payload_sha256):
        fail(f"data-supply selection for {ticker} carries no payload sha256")
    actual = hashlib.sha256(asset.read_bytes()).hexdigest()
    if actual != payload_sha256:
        fail(
            f"checked-out data-supply active state does not match the verified overlay "
            f"generation for {ticker} ({actual} vs {payload_sha256})"
        )
print(
    "ETF overlay binding ok: "
    f"generation={receipt['generation_id']} assets={len(entries)} "
    f"transaction={active['transaction_id'][:12]}"
)
PYEOF
}

# Restores the exact Git LKG tree (bytes + file set) for the canonical ETF
# directory only, then asserts the scoped git state is clean for that tree.
restore_etf_lkg_tree() {
  [[ "$ETF_OVERLAY_INSTALLED" == "true" ]] || return 0
  rm -rf "$ETF_LKG_TREE" || return 1
  mkdir -p "$ETF_LKG_TREE" || return 1
  cp -a "$ETF_OVERLAY_BACKUP_ROOT/etfs/." "$ETF_LKG_TREE/" || return 1
  if ! diff -qr "$ETF_OVERLAY_BACKUP_ROOT/etfs" "$ETF_LKG_TREE" >/dev/null 2>&1; then
    echo "ETF overlay restore failed file-set or byte parity against the Git LKG snapshot" >&2
    return 1
  fi
  if ! git diff --quiet -- "$ETF_LKG_TREE" \
    || ! git diff --cached --quiet -- "$ETF_LKG_TREE" \
    || [[ -n "$(git ls-files --others --exclude-standard -- "$ETF_LKG_TREE")" ]]; then
    echo "canonical ETF tree is not clean after overlay restoration" >&2
    git status --porcelain=v1 --untracked-files=all -- "$ETF_LKG_TREE" || true
    return 1
  fi
  return 0
}

etf_overlay_restore_and_exit() {
  local code=$?
  local restore_status=0
  if [[ "$ETF_OVERLAY_MODE" == "true" ]]; then
    restore_etf_lkg_tree || restore_status=$?
    if [[ -n "$ETF_OVERLAY_BACKUP_ROOT" ]]; then
      rm -rf "$ETF_OVERLAY_BACKUP_ROOT" || true
    fi
  fi
  trap - EXIT HUP INT TERM
  if [[ "$restore_status" -ne 0 ]]; then
    exit 91
  fi
  exit "$code"
}

if [[ "$ETF_OVERLAY_MODE" == "true" ]]; then
  require_etf_overlay_env
  verify_etf_overlay_pointer_current
  verify_etf_overlay_binding
  ETF_OVERLAY_BACKUP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/fenok-etf-lkg-backup-XXXXXX")"
  mkdir -p "$ETF_OVERLAY_BACKUP_ROOT/etfs"
  cp -a "$ETF_LKG_TREE/." "$ETF_OVERLAY_BACKUP_ROOT/etfs/"
  ETF_OVERLAY_INSTALLED="true"
  trap 'etf_overlay_restore_and_exit' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  rm -rf "$ETF_LKG_TREE"
  mkdir -p "$ETF_LKG_TREE"
  cp -a "$ETF_DETAIL_OVERLAY_ROOT/." "$ETF_LKG_TREE/"
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

# --- S5b: Refresh the review-only SEC 13F bridge index -----------------------
# The bridge seals input fingerprints for stock_action_index.json,
# market_facts/index.json and the market-facts detail set. Update Manifest owns
# the git copies of all three (CENTRAL_COMMIT_PATHS), so the seal has to be
# rebuilt here or it goes stale on every computed-signals refresh. Its other
# owner, build-stocks-analyzer.yml, cannot cover that: pushes made by a
# workflow do not trigger another workflow, so its own push trigger never fires
# for these commits and only its daily cron heals the seal.
node scripts/build-sec13f-bridge-index.mjs
node scripts/test-sec13f-bridge-index.mjs

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

# Do not commit a projection from a generation that ceased to be current while
# this pass was running. The check reads only the active pointer and manifest;
# payloads remain pinned in the one-time verified overlay.
if [[ "$ETF_OVERLAY_MODE" == "true" ]]; then
  verify_etf_overlay_pointer_current
fi
