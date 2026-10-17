#!/usr/bin/env bash
# This runs only in the disposable Update Manifest Actions checkout.
set -euo pipefail

candidate_base=""
for attempt in 1 2 3; do
  timeout 120 git fetch origin +main:refs/remotes/origin/main
  reuse=false
  # Treat every path as a possible input except documentation and the separate
  # M4 watcher. In particular, src is an input to the data-usage projection,
  # workflows supply lane schedules, and generated outputs must not be replaced
  # over a newer writer. Unknown changes therefore take the rebuild path.
  if [[ -n "$candidate_base" ]] \
    && git merge-base --is-ancestor "$candidate_base" origin/main \
    && git diff --quiet "$candidate_base" origin/main -- . \
      ':(exclude)docs' ':(exclude).claude' ':(exclude)scripts/datawatch' \
      ':(exclude)README.md' ':(exclude)AGENTS.md' ':(exclude)CLAUDE.md'; then
    if git rebase --onto origin/main "$candidate_base"; then
      reuse=true
      echo "Attempt $attempt: inputs unchanged; reused generated commit"
    else
      git rebase --abort
    fi
  fi

  if [[ "$reuse" != true ]]; then
    git reset --hard origin/main
    node scripts/stage-update-manifest-central.mjs --clean-untracked-after-reset
    node scripts/stage-update-manifest-central.mjs --assert-clean-after-reset
    # Git no longer carries the generated public tree. Recreate its empty root
    # before the existing route validator inspects it in this disposable checkout.
    mkdir -p 100xfenok-next/public/data
    node scripts/materialize-update-manifest-routes.mjs --all --validate-only --assert-no-untracked
    bash scripts/update-manifest-projections.sh

    central_status=0
    node scripts/stage-update-manifest-central.mjs --check || central_status=$?
    if [[ "$central_status" -eq 3 ]]; then
      echo "Attempt $attempt: manifest already current on latest main"
      echo "pushed=false" >> "$GITHUB_OUTPUT"
      exit 0
    fi
    if [[ "$central_status" -ne 0 ]]; then exit "$central_status"; fi
    node scripts/stage-update-manifest-central.mjs --stage
    git commit -m "chore: update computed signals and manifest"
  fi
  candidate_base=$(git rev-parse origin/main)

  # Reusing Git output must not bypass the existing live-generation fence.
  if [[ -n "${ETF_DETAIL_OVERLAY_RECEIPT:-}" ]]; then
    node scripts/materialize-cloud-data-plane-family.mjs \
      --family stockanalysis-etf-detail --verify-receipt "$ETF_DETAIL_OVERLAY_RECEIPT" >/dev/null
  fi
  if timeout 120 git push origin HEAD:main; then
    echo "Attempt $attempt: push succeeded"
    echo "pushed=true" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "Attempt $attempt: push rejected; checking incoming inputs before retry"
  if [[ "$attempt" -lt 3 ]]; then sleep $((attempt * 3)); fi
done
echo "All 3 push attempts failed" >&2
exit 1
