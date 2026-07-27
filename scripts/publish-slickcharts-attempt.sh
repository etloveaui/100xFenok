#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <member> <row-json> <commit-message> [--manifest-workflow <workflow> --manifest-always <stage> [--manifest-data <stage>] --] [data-path ...]" >&2
  exit 2
fi

member=$1
row_path=$2
commit_message=$3
shift 3

manifest_workflow=""
manifest_always=""
manifest_data=""
if [[ "${1:-}" == "--manifest-workflow" ]]; then
  [[ $# -ge 4 && -n "${2:-}" ]] || { echo "manifest workflow is missing" >&2; exit 2; }
  manifest_workflow=$2
  shift 2
  [[ "${1:-}" == "--manifest-always" && -n "${2:-}" ]] || { echo "manifest always stage is missing" >&2; exit 2; }
  manifest_always=$2
  shift 2
  if [[ "${1:-}" == "--manifest-data" ]]; then
    [[ -n "${2:-}" ]] || { echo "manifest data stage is missing" >&2; exit 2; }
    manifest_data=$2
    shift 2
  fi
  [[ "${1:-}" == "--" ]] || { echo "manifest options must end with --" >&2; exit 2; }
  shift
  expected_workflow=".github/workflows/slickcharts-${member}.yml"
  [[ "$manifest_workflow" == "$expected_workflow" ]] || { echo "manifest workflow does not match member" >&2; exit 2; }
elif [[ "${1:-}" == --manifest-* ]]; then
  echo "manifest options must start with --manifest-workflow" >&2
  exit 2
fi

shard_path="data/admin/data-supply-state/detection-attempts/slickcharts.json"
daily_state_root="data/admin/slickcharts-daily-delivery"
composite_state_root="data/admin/slickcharts-composite-recovery"
composite_index="$composite_state_root/index.json"
recovery_exit=0
publish_data=true
composite_stage=false

restore_composite_index_from_head() {
  if git cat-file -e "HEAD:$composite_index" 2>/dev/null; then
    mkdir -p -- "$(dirname "$composite_index")"
    local temporary="${RUNNER_TEMP:-/tmp}/slickcharts-${member}-index-restore-${GITHUB_RUN_ID:-local}.json"
    git show "HEAD:$composite_index" > "$temporary"
    mv -- "$temporary" "$composite_index"
  else
    rm -f -- "$composite_index"
  fi
}

if [[ "$member" == "daily" ]]; then
  if [[ -z "${SLICKCHARTS_RECOVERY_STATUS_PATH:-}" || ! -f "$SLICKCHARTS_RECOVERY_STATUS_PATH" ]]; then
    echo "SlickCharts daily recovery status is missing" >&2
    recovery_exit=2
    publish_data=false
  else
    recovery_exit=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); if (![0,2].includes(s.exit_code)) process.exit(2); process.stdout.write(String(s.exit_code))' "$SLICKCHARTS_RECOVERY_STATUS_PATH")
    publish_data=$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); process.stdout.write(s.publish_data === true ? "true" : "false")' "$SLICKCHARTS_RECOVERY_STATUS_PATH")
  fi
fi

composite_saved_index=""
if [[ -n "${SLICKCHARTS_COMPOSITE_STATUS_PATH:-}" ]]; then
  if [[ ! -f "$SLICKCHARTS_COMPOSITE_STATUS_PATH" || ! -f "$composite_index" ]]; then
    echo "SlickCharts composite recovery status/index is missing" >&2
    recovery_exit=2
    publish_data=false
    restore_composite_index_from_head
  elif ! composite_meta=$(node -e '
      const fs = require("fs");
      const status = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (status.schema_version !== "slickcharts-composite-run-status/v1"
        || status.lane_id !== "slickcharts"
        || status.member !== process.argv[2]
        || ![0, 2].includes(status.exit_code)
        || typeof status.publish_data !== "boolean") process.exit(2);
      process.stdout.write(`${status.exit_code} ${status.publish_data ? "true" : "false"}`);
    ' "$SLICKCHARTS_COMPOSITE_STATUS_PATH" "$member"); then
    echo "SlickCharts composite recovery status is invalid" >&2
    recovery_exit=2
    publish_data=false
    restore_composite_index_from_head
  elif ! node scripts/slickcharts-composite-recovery.mjs validate --index "$composite_index" >/dev/null; then
    echo "SlickCharts composite recovery index is invalid" >&2
    recovery_exit=2
    publish_data=false
    restore_composite_index_from_head
  else
    read -r composite_exit composite_publish <<< "$composite_meta"
    if [[ "$composite_exit" -ne 0 ]]; then recovery_exit="$composite_exit"; fi
    if [[ "$composite_publish" != "true" ]]; then publish_data=false; fi
    composite_stage=true
    composite_saved_index="${RUNNER_TEMP:-/tmp}/slickcharts-${member}-composite-index.json"
    cp -- "$composite_index" "$composite_saved_index"
  fi
fi

if [[ ! -f "$row_path" ]]; then
  echo "saved SlickCharts row is missing: $row_path" >&2
  exit 1
fi

merge_saved_row() {
  node scripts/emit-slickcharts-attempt.mjs \
    --member "$member" \
    --row-in "$row_path" \
    --shard "$shard_path"
}

merge_saved_composite() {
  [[ -n "$composite_saved_index" ]] || return 0
  node scripts/slickcharts-composite-recovery.mjs merge-member \
    --member "$member" \
    --base-index "$composite_index" \
    --saved-index "$composite_saved_index"
}

verify_live_composite() {
  [[ "$composite_stage" == "true" ]] || return 0
  node scripts/slickcharts-composite-recovery.mjs validate-live \
    --repo-root "$PWD" \
    --index "$composite_index"
}

stage_owned_paths() {
  if [[ $# -gt 0 && "$publish_data" == "true" ]]; then
    git add -- "$@"
  fi
  git add -- "$shard_path"
  if [[ "$composite_stage" == "true" && -d "$composite_state_root" ]]; then
    git add -- "$composite_state_root"
  fi
  if [[ "$member" == "daily" && -d "$daily_state_root" ]]; then
    git add -- "$daily_state_root"
  fi
}

stage_manifest_paths() {
  [[ -n "$manifest_workflow" ]] || return 0
  scripts/stage-lane-manifest.sh \
    --workflow "$manifest_workflow" \
    --stage "$manifest_always"
  if [[ "$publish_data" == "true" && -n "$manifest_data" ]]; then
    scripts/stage-lane-manifest.sh \
      --workflow "$manifest_workflow" \
      --stage "$manifest_data"
  fi
}

merge_saved_row
stage_manifest_paths
verify_live_composite
stage_owned_paths "$@"
if git diff --staged --quiet; then
  echo "No SlickCharts ${member} changes to publish"
  exit "$recovery_exit"
fi
git commit -m "$commit_message"

for attempt in $(seq 1 5); do
  git fetch origin main
  if ! git rebase origin/main; then
    mapfile -t conflicts < <(git diff --name-only --diff-filter=U)
    conflict_ok=true
    for conflict in "${conflicts[@]}"; do
      if [[ "$conflict" != "$shard_path" && "$conflict" != "$composite_index" ]]; then
        conflict_ok=false
      fi
    done
    if [[ ${#conflicts[@]} -eq 0 || "$conflict_ok" != "true" ]]; then
      echo "rebase conflict outside owned shard; refusing recovery" >&2
      printf '%s\n' "${conflicts[@]}" >&2
      git rebase --abort >/dev/null 2>&1 || true
      exit 1
    fi

    # During rebase, --ours is the latest upstream main. Reapply only this
    # workflow's saved member row so another member can never be clobbered.
    if printf '%s\n' "${conflicts[@]}" | grep -Fxq "$shard_path"; then
      git checkout --ours -- "$shard_path"
      merge_saved_row
      git add -- "$shard_path"
    fi
    if printf '%s\n' "${conflicts[@]}" | grep -Fxq "$composite_index"; then
      git checkout --ours -- "$composite_index"
      merge_saved_composite
      git add -- "$composite_index"
    fi
    GIT_EDITOR=true git rebase --continue
  fi

  # A clean textual merge can still retain a stale whole-document snapshot.
  # Canonicalize once more against the rebased shard before every push.
  merge_saved_row
  merge_saved_composite
  verify_live_composite
  git add -- "$shard_path"
  if [[ -n "$composite_saved_index" ]]; then git add -- "$composite_index"; fi
  if ! git diff --staged --quiet; then
    if [[ $(git rev-list --count origin/main..HEAD) -gt 0 ]]; then
      git commit --amend --no-edit
    else
      git commit -m "$commit_message"
    fi
  fi

  if git push origin HEAD:main; then
    if command -v gh >/dev/null 2>&1 && [[ -n "${GH_TOKEN:-}" ]]; then
      gh workflow run update-manifest.yml --ref main -f rebuild_slickcharts=true
    fi
    exit "$recovery_exit"
  fi
  echo "git push race on attempt ${attempt}; retrying with saved ${member} row"
  sleep 3
done

echo "git push failed after retrying concurrent main updates" >&2
exit 1
