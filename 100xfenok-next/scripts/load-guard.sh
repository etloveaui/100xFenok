#!/usr/bin/env bash
# load-guard.sh — fail-closed remote dispatcher for registered heavy work.
#
# A developer invocation always queues one of the fixed hosted suites. Only the
# hosted workflow's explicit nested-execution marker may run the corresponding
# registered steps locally. CI alone is intentionally not a bypass.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/load-guard.sh <command...>" >&2
  exit 64
fi

GIT_BIN="git"
GH_BIN="gh"
REMOTE_WORKFLOW="remote-heavy-verification.yml"

blocked() {
  echo "REMOTE_HEAVY_VERIFICATION_BLOCKED reason=$1 next_action=$2" >&2
  exit 75
}

remote_suite_for_command() {
  case "$*" in
    "npm run build:runtime:steps") printf '%s\n' "runtime-build" ;;
    "npm run build:static:steps") printf '%s\n' "static-build" ;;
    "npm run cf:build:steps") printf '%s\n' "cloudflare-build" ;;
    "npm run qa:registry-contracts") printf '%s\n' "contracts" ;;
    *) return 1 ;;
  esac
}

allow_hosted_nested_execution() {
  [ "${FENOK_REMOTE_HEAVY_NESTED_EXECUTION:-}" = "1" ] || return 1
  [ "${GITHUB_ACTIONS:-}" = "true" ] || blocked "nested_execution_identity_invalid" "run_only_inside_the_hosted_verification_workflow"
  if [[ ! "${GITHUB_RUN_ID:-}" =~ ^[0-9]+$ ]] || [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
    blocked "nested_execution_identity_invalid" "run_only_inside_the_hosted_verification_workflow"
  fi
  if [[ ! "${FENOK_REMOTE_HEAVY_EXPECTED_REVISION:-}" =~ ^[0-9a-f]{40}$ ]]; then
    blocked "nested_execution_identity_invalid" "run_only_inside_the_hosted_verification_workflow"
  fi
  if [ "${GITHUB_SHA}" != "${FENOK_REMOTE_HEAVY_EXPECTED_REVISION}" ]; then
    blocked "nested_revision_mismatch" "run_the_requested_revision_from_the_hosted_workflow"
  fi

  local repo_root nested_head
  repo_root="$("$GIT_BIN" rev-parse --show-toplevel 2>/dev/null)" || blocked "nested_checkout_unavailable" "run_from_the_hosted_checkout"
  nested_head="$("$GIT_BIN" -C "$repo_root" rev-parse --verify HEAD^{commit} 2>/dev/null)" || blocked "nested_HEAD_unavailable" "run_from_the_hosted_checkout"
  if [ "$nested_head" != "${FENOK_REMOTE_HEAVY_EXPECTED_REVISION}" ]; then
    blocked "nested_revision_mismatch" "run_the_requested_revision_from_the_hosted_workflow"
  fi
  return 0
}

dispatch_remote_suite() {
  local suite repo_root head remote_result remote_head worktree_status
  suite="$(remote_suite_for_command "$@")" || blocked "remote_suite_not_allowlisted" "use_an_allowlisted_heavy_npm_script"

  if allow_hosted_nested_execution; then
    if ! command -v "$1" >/dev/null 2>&1; then
      blocked "nested_exec_failed" "hosted_command_could_not_execute"
    fi
    "$@"
    nested_status=$?
    exit "$nested_status"
  fi

  repo_root="$("$GIT_BIN" rev-parse --show-toplevel 2>/dev/null)" || blocked "git_repository_unavailable" "run_from_the_repository_checkout"
  worktree_status="$("$GIT_BIN" -C "$repo_root" status --porcelain=v1 --untracked-files=all 2>/dev/null)" || blocked "git_status_unavailable" "run_from_a_healthy_repository_checkout"
  if [ -n "$worktree_status" ]; then
    blocked "dirty_worktree" "use_a_clean_current_origin_checkout"
  fi

  head="$("$GIT_BIN" -C "$repo_root" rev-parse --verify HEAD^{commit} 2>/dev/null)" || blocked "HEAD_unavailable" "use_a_clean_current_origin_checkout"
  if [[ ! "$head" =~ ^[0-9a-f]{40}$ ]]; then
    blocked "HEAD_revision_invalid" "use_a_clean_current_origin_checkout"
  fi

  if ! remote_result="$("$GIT_BIN" -C "$repo_root" ls-remote --exit-code origin refs/heads/main 2>/dev/null)"; then
    blocked "origin_main_unavailable" "use_a_clean_current_origin_checkout"
  fi
  if [[ "$remote_result" =~ ^([0-9a-f]{40})[[:space:]]+refs/heads/main$ ]]; then
    remote_head="${BASH_REMATCH[1]}"
  else
    blocked "origin_main_revision_invalid" "use_a_clean_current_origin_checkout"
  fi
  if [ "$head" != "$remote_head" ]; then
    blocked "HEAD_stale_against_origin_main" "use_a_clean_current_origin_checkout"
  fi
  if ! command -v "$GH_BIN" >/dev/null 2>&1; then
    blocked "gh_unavailable" "install_or_authenticate_gh"
  fi
  if ! "$GH_BIN" workflow run "$REMOTE_WORKFLOW" --ref main -f "suite=$suite" -f "revision=$head" >/dev/null; then
    blocked "workflow_dispatch_failed" "retry_gh_workflow_dispatch"
  fi
  printf '{"status":"queued","suite":"%s","revision":"%s"}\n' "$suite" "$head"
}

dispatch_remote_suite "$@"
