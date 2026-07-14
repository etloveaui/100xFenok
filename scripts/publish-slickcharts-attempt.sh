#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <member> <row-json> <commit-message> [data-path ...]" >&2
  exit 2
fi

member=$1
row_path=$2
commit_message=$3
shift 3

shard_path="data/admin/data-supply-state/detection-attempts/slickcharts.json"

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

stage_owned_paths() {
  if [[ $# -gt 0 ]]; then
    git add -- "$@"
  fi
  git add -- "$shard_path"
}

merge_saved_row
stage_owned_paths "$@"
if git diff --staged --quiet; then
  echo "No SlickCharts ${member} changes to publish"
  exit 0
fi
git commit -m "$commit_message"

for attempt in $(seq 1 5); do
  git fetch origin main
  if ! git rebase origin/main; then
    mapfile -t conflicts < <(git diff --name-only --diff-filter=U)
    if [[ ${#conflicts[@]} -ne 1 || "${conflicts[0]}" != "$shard_path" ]]; then
      echo "rebase conflict outside owned shard; refusing recovery" >&2
      printf '%s\n' "${conflicts[@]}" >&2
      git rebase --abort >/dev/null 2>&1 || true
      exit 1
    fi

    # During rebase, --ours is the latest upstream main. Reapply only this
    # workflow's saved member row so another member can never be clobbered.
    git checkout --ours -- "$shard_path"
    merge_saved_row
    git add -- "$shard_path"
    GIT_EDITOR=true git rebase --continue
  fi

  # A clean textual merge can still retain a stale whole-document snapshot.
  # Canonicalize once more against the rebased shard before every push.
  merge_saved_row
  git add -- "$shard_path"
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
    exit 0
  fi
  echo "git push race on attempt ${attempt}; retrying with saved ${member} row"
  sleep 3
done

echo "git push failed after retrying concurrent main updates" >&2
exit 1
