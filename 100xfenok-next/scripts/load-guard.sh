#!/usr/bin/env bash
# load-guard.sh — local heavy-work guard with fail-closed remote dispatch.
#
# CI and nested guarded commands are local no-ops. On a developer machine,
# a load at or above LOAD_GUARD_MAX (default 12) never waits and then runs a
# heavy command locally: only one fixed npm command can dispatch one fixed
# remote suite at the clean, origin-reachable HEAD.
set -u

if [ "$#" -eq 0 ]; then
  echo "usage: bash scripts/load-guard.sh <command...>" >&2
  exit 64
fi

if [ "${CI:-}" = "true" ] || [ "${LOAD_GUARD_ACTIVE:-}" = "1" ]; then
  exec "$@"
fi

MAX_LOAD="${LOAD_GUARD_MAX:-12}"
LOCK_DIR="${LOAD_GUARD_LOCK:-/tmp/w5-build.lock}"
STALE_SECONDS="${LOAD_GUARD_STALE:-1800}"
GIT_BIN="git"
GH_BIN="gh"
REMOTE_WORKFLOW="remote-heavy-verification.yml"

blocked() {
  echo "REMOTE_HEAVY_VERIFICATION_BLOCKED reason=$1 next_action=$2" >&2
  exit 75
}

current_load() {
  if sysctl -n vm.loadavg >/dev/null 2>&1; then
    sysctl -n vm.loadavg | awk '{print $2}'
    return
  fi
  awk '{print $1}' /proc/loadavg 2>/dev/null || printf '0\n'
}

load_is_high() {
  awk -v load="$(current_load)" -v max="$MAX_LOAD" 'BEGIN { exit !(load >= max) }'
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

dispatch_remote_suite() {
  local suite repo_root head
  suite="$(remote_suite_for_command "$@")" || blocked "remote_suite_not_allowlisted" "use_an_allowlisted_heavy_npm_script"
  repo_root="$("$GIT_BIN" rev-parse --show-toplevel 2>/dev/null)" || blocked "git_repository_unavailable" "run_from_the_repository_checkout"
  if ! "$GIT_BIN" -C "$repo_root" diff --quiet || ! "$GIT_BIN" -C "$repo_root" diff --cached --quiet; then
    blocked "dirty_worktree" "commit_or_revert_local_changes"
  fi
  head="$("$GIT_BIN" -C "$repo_root" rev-parse HEAD 2>/dev/null)" || blocked "HEAD_unavailable" "create_a_commit_before_remote_verification"
  if ! "$GIT_BIN" -C "$repo_root" merge-base --is-ancestor "$head" origin/main; then
    blocked "HEAD_not_on_origin_main" "push_HEAD_to_origin_main"
  fi
  if ! command -v "$GH_BIN" >/dev/null 2>&1; then
    blocked "gh_unavailable" "install_or_authenticate_gh"
  fi
  if ! "$GH_BIN" workflow run "$REMOTE_WORKFLOW" --ref main -f "suite=$suite" -f "revision=$head"; then
    blocked "workflow_dispatch_failed" "retry_gh_workflow_dispatch"
  fi
  echo "REMOTE_HEAVY_VERIFICATION_DISPATCHED suite=$suite ref=$head"
}

if load_is_high; then
  dispatch_remote_suite "$@"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  lock_mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || printf '0')"
  lock_age=$(( $(date +%s) - lock_mtime ))
  if [ "$lock_age" -gt "$STALE_SECONDS" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || blocked "stale_lock_unremovable" "remove_the_stale_load_guard_lock"
    mkdir "$LOCK_DIR" 2>/dev/null || blocked "local_lock_held" "wait_for_the_current_local_heavy_job"
  else
    blocked "local_lock_held" "wait_for_the_current_local_heavy_job"
  fi
fi

cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
LOAD_GUARD_ACTIVE=1 nice -n 15 "$@"
