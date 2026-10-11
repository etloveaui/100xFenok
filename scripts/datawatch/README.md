# 100x data watch

M4 launchd job `com.fenok.100x-data-watch`. Every 30 minutes `watch.py` reads four things from GitHub
`etloveaui/100xFenok` (4 API calls) and sends one Korean line per state CHANGE through AA's ops-alert route
(`scripts/briefing/alert.py` `ops_send`, Gateway class `ops_alert`). It needs neither GitHub's scheduler nor A1.

| Read | Sends a line when | Bound and its source |
|---|---|---|
| Open issues whose title ends with `alarm` | opened; closed (recovered); a new incident or reason in the body | none |
| Newest successful `pipeline-failure-alarm.yml` run (completion) | it is older than the bound; it is back | 2 h = 2 x the hourly cadence |
| Newest `workflow_dispatch` run titled `external-clock/a1/v1 ...` | same | 45 min = 3 x the longest declared slot gap (15 min) |
| `generated_at` of `data/admin/fenok-data-health-kpi.json` | same | 6 h (median commit gap 0.73 h) |

A read that keeps failing for 2 hours sends one "감시 불가" line. The first run is a silent baseline. A growing
streak alone sends nothing. An undelivered line is retried on the next run; nothing in AA is ever restarted.

- State: `~/.local/state/100x-data-watch/` holds `state.json`, `status.json` (time, open incidents, the three ages;
  for agents), `watch.log` (one line per run) and `launchd.log` (tracebacks).
- GitHub token: `GITHUB_TOKEN` from `~/.secrets/all-keys.env`; without it the public API is read anonymously.
- Code on M4: `~/.local/share/100x-data-watch/watch.py`, copied each run from the local `origin/main` object (the plist says why); it imports `briefing.alert` from the briefing worktree.
- Run once by hand: `~/.local/share/100x-briefing/venv/bin/python ~/.local/share/100x-data-watch/watch.py --dry-run`
  prints the lines instead of sending (state in `dry-run/`); `launchctl kickstart gui/$(id -u)/com.fenok.100x-data-watch` is a real run.
- Install: `mkdir -p ~/.local/state/100x-data-watch`, copy the plist to `~/Library/LaunchAgents/`, then
  `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.fenok.100x-data-watch.plist`.
- Stop: `launchctl bootout gui/$(id -u)/com.fenok.100x-data-watch`
