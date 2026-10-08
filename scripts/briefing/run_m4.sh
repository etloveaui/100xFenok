#!/bin/zsh
# run_m4.sh [run_morning args]: M4 entry for the 100x Morning Brief job (launchd com.fenok.100x-briefing-morning).
# Loads only the three needed secrets, moves the job worktree to origin/main, then runs the orchestrator
# from that worktree. BRIEFING_NO_SYNC=1 skips the worktree sync.
# The body is one function, called on the last line, so zsh has parsed all of it before the sync rewrites this file.
BRIEFING_HERE=${0:A:h}
main() {
  emulate -L zsh
  set -u
  local repo=${BRIEFING_HERE:h:h}
  local venv=${BRIEFING_VENV:-$HOME/.local/share/100x-briefing/venv}
  local secrets=${BRIEFING_SECRETS:-$HOME/.secrets/all-keys.env}
  local name line value
  export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin
  for name in ANTHROPIC_PLAN_CREDIT_API_KEY SEC_USER_AGENT FRED_API_KEY; do
    line=$(rg -N -m1 "^(export )?${name}=" "$secrets") || { print -u2 "run_m4: $name missing in $secrets"; return 2 }
    value=${line#*=}
    value=${value#[\"\']}
    value=${value%[\"\']}
    export "$name=$value"
  done
  if [[ ${BRIEFING_NO_SYNC:-0} != 1 ]]; then
    git -C "$repo" fetch -q origin +refs/heads/main:refs/remotes/origin/main \
      && git -C "$repo" checkout -q --detach --force origin/main \
      || print -u2 "run_m4: worktree sync failed; running the checked-out code"
  fi
  cd "$repo/scripts" || return 2
  "$venv/bin/python" -m briefing.run_morning "$@"
}
main "$@"; exit $?
