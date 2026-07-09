#!/usr/bin/env bash
# load-guard.sh — CWD-level throttle for heavy local commands (DEC-259).
#
# Any agent (Claude / Codex / Kimi / subagent / human) that runs a guarded npm
# script gets load-aware pacing automatically — no per-session instructions.
#
#   bash scripts/load-guard.sh <command...>
#
# Behavior:
#   - CI (CI=true), LOAD_GUARD_BYPASS=1, or an existing guarded parent
#     (LOAD_GUARD_ACTIVE=1) -> exec command directly (no-op).
#   - Waits while 1-min loadavg >= LOAD_GUARD_MAX (default 8; 10-core host).
#   - Serializes via mkdir lock (default /tmp/w5-build.lock, stale after 30min).
#   - Runs the command under nice -n 15.
set -u

if [ "${CI:-}" = "true" ] || [ "${LOAD_GUARD_BYPASS:-}" = "1" ] || [ "${LOAD_GUARD_ACTIVE:-}" = "1" ]; then
  exec "$@"
fi

MAX_LOAD="${LOAD_GUARD_MAX:-12}"
LOCK_DIR="${LOAD_GUARD_LOCK:-/tmp/w5-build.lock}"
STALE_SECONDS="${LOAD_GUARD_STALE:-1800}"
WAIT_STEP=20
MAX_WAIT_STEPS=90   # ~30 min ceiling, then proceed anyway (never deadlock work)

current_load() {
  # "{ 9.81 10.33 8.35 }" -> integer part of the 1-min average
  sysctl -n vm.loadavg 2>/dev/null | awk '{print int($2)}' || echo 0
}

steps=0
while [ "$(current_load)" -ge "$MAX_LOAD" ] && [ "$steps" -lt "$MAX_WAIT_STEPS" ]; do
  echo "[load-guard] loadavg $(current_load) >= ${MAX_LOAD}; waiting ${WAIT_STEP}s" >&2
  sleep "$WAIT_STEP"
  steps=$((steps + 1))
done

steps=0
while ! mkdir "$LOCK_DIR" 2>/dev/null; do
  if [ -d "$LOCK_DIR" ]; then
    lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0) ))
    if [ "$lock_age" -gt "$STALE_SECONDS" ]; then
      echo "[load-guard] stale lock (${lock_age}s), stealing" >&2
      rmdir "$LOCK_DIR" 2>/dev/null || true
      continue
    fi
  fi
  if [ "$steps" -ge "$MAX_WAIT_STEPS" ]; then
    echo "[load-guard] lock wait ceiling reached; proceeding without lock" >&2
    break
  fi
  echo "[load-guard] build lock held; waiting ${WAIT_STEP}s" >&2
  sleep "$WAIT_STEP"
  steps=$((steps + 1))
done

cleanup() { rmdir "$LOCK_DIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

LOAD_GUARD_ACTIVE=1 nice -n 15 "$@"
status=$?
exit "$status"
