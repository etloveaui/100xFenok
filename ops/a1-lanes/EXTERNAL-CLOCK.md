# A1 workflow clock

B-434, authorized 2026-10-11. One user timer on `ubuntu@feno-sin-a1`
dispatches existing GitHub workflows on `etloveaui/100xFenok`, branch `main`.
GitHub schedules remain enabled as fallback. There is no catch-up burst.

| Workflow | UTC cadence | Existing duplicate serialization |
|---|---|---|
| deploy-worker.yml | 49 each hour; 03:30 daily | hourly input-diff/code priority; daily fallback preserved |
| fetch-fred-macro.yml | 08:00 daily | shared writer; same-slot success receipt |
| fetch-fred-banking.yml | 07:00 daily | shared writer; default all frequencies |
| fetch-sentiment.yml | 22:00 Mon–Fri | shared writer |
| fetch-us-indices-daily.yml | 22:00 Mon–Fri | shared writer |
| fetch-nasdaq-giw-sox.yml | 23:50 Mon–Fri | shared writer |
| slickcharts-daily.yml | 06:00 daily | all five scrapers; full-run recovery semantics |
| fetch-fenok-apewisdom.yml | 13:17 daily | shared writer |
| fetch-fenok-private-options.yml | 01:10 Tue–Sat | shared writer |
| fenok-edge-daily.yml | 00:30 Tue–Sat | existing normal acquisition defaults |
| fenok-edge-krx-daily.yml | 10:30 Mon–Fri | existing normal acquisition defaults |
| check-sec13f-live-parity.yml | 10:15 daily | existing semantic parity probe |
| build-stocks-analyzer.yml | 06:07 daily | full non-push build; same Manifest dispatch |
| update-manifest.yml | 02:30 and 09:30 daily | both reconciliation slots |
| fetch-defillama.yml | 12 | global Git writer group |
| fetch-yahoo-ticker.yml | 05 | global Git writer + yahoo-ticker-macro-publish |
| global-writer-queue-observer.yml | 11 | global-writer-queue-observer |
| pins-autosync.yml | 07, 37 | global Git writer group; unchanged pins produce no commit |
| pipeline-failure-alarm.yml | 23 | pipeline-failure-alarm + global Git writer persistence |
| retention-restore.yml | 04, 19, 34, 49 | retention-restore; journal restore is a no-op when nothing is pending |
| worker-request-budget-alarm.yml | 07 | worker-request-budget-alarm; marked dispatch runs hourly check only |
| fetch-treasury-tga.yml | 00:00, 06:00, 12:00, 18:00 | global Git writer group |
| data-plane-serving-probe.yml | 00:41, 06:41, 12:41, 18:41 | data-plane-serving-probe |
| fetch-fenok-news-tone.yml | 06:43, 14:43, 22:43 | global Git writer group |

All 24 members declare `workflow_dispatch`. The existing frequent rows retain their
cadences. X8 (2026-10-11) adds thirteen daily/weekday workflows plus the daily
Deploy slot. Yahoo batch finance and StockAnalysis remain on GitHub pending the
lead's first natural-run read; weekly/monthly families are also deferred.

Every admitted workflow now has a small `clock-admission` job. A late GitHub
schedule skips every producer/publisher job only after the run API proves a
successful marked dispatch for the same workflow, main branch and declared slot.
Failed, queued, unrelated-slot and unmarked human runs cannot suppress a fallback.
Human dispatches and push events retain their original behavior. API uncertainty
preserves the GitHub fallback with a warning; malformed marked slots fail closed.
For daily and frequent schedules GitHub supplies the cron text and creation time,
not an original `scheduled_at`: the helper uses the latest matching instant at
run creation, never the later runner-start time. Cross-cadence scheduler delays
cannot be attributed to an earlier intended slot that GitHub does not expose.

Existing concurrency groups remain. They serialize the work; a duplicate fallback
still needs the short admission job, but does not collect or publish again. The
computed-signals coordinator checks source job outcomes, so a successful source
no-op does not cause an extra derived rebuild/publication. Alarm `workflow_run`
observations remain active. No new workflow/service or receipt registry is added.

The clock still checks workflow metadata and leaves disabled workflows disabled.
A same-slot service restart uses its existing local dispatch receipt. The existing
service timeout is 150 seconds, covering the largest three-workflow slot with two
20-second API bounds per workflow. Credentials and state location are unchanged.

X7b marked hourly Deploy compares full Git trees to the live provenance and
proceeds only for changed bundle inputs; pending/running code deploys take priority.
X8's marked 03:30 daily run keeps the original daily path, rather than the hourly
input-diff admission. GitHub daily fallback and SlickCharts recovery remain.

For `worker-request-budget-alarm.yml`, the marked hourly dispatch executes only
`check`. An unmarked human dispatch still executes both jobs. The separate
`data-supply-analytics` job keeps its GitHub-only `17 2,14 * * *` schedule;
an hourly external marker cannot satisfy that telemetry slot. Minute 07 already
exists in the shared timer calendar.

Dispatch inputs `external_clock=a1-v1` and `external_clock_slot=<UTC ISO minute>`
produce `external-clock/a1/v1 <workflow> <slot>` in the Actions run title.
The existing missed-slot detector admits only these bound titles at a declared
minute. Human dispatch defaults stay unmarked. Queued producer runs prove
creation; restore still requires completion or a running job under ten minutes.
Marked dispatches count as automatic executions for failure streaks, first-failure
evidence, lost slots and recovery. Unmarked human failures remain excluded.

The pipeline alarm separately measures marked-run creation for every clocked
workflow, including its own dispatch creation (not its own job failures).
Three consecutive declared slots without a marked run raise one `a1_clock_stale`
incident for the A1 external clock. GitHub fallback successes do not clear it.
Queued marked runs prove clock delivery. Admission timestamps prevent counting
slots before installation; unreadable run history remains unknown.

There is no reusable local-file failure channel: `check-a1-lane-health.mjs` reads
the committed FDIC-only `a1-lane-status/v1` document, requires `lane_id=fdic_tier1`
and a 96-hour cadence, and runs on GitHub. A local `OnFailure` file is neither
that status nor remotely visible. Do not overwrite the FDIC status or add a new
channel merely to attach `OnFailure`; inspect the service journal for immediate
local failure details, while the independent run-history alarm covers silence.

## Credential and rebuild

The token is only in `/home/ubuntu/.config/fenok/external-clock.env` (mode 600,
owned by ubuntu). The persistent service reads it via `EnvironmentFile=`; it is
not exported from shell profiles. `feno secret` currently handles only
`opencode-go-2`, and the dotfiles cloud bootstrap does not provision a GitHub
Actions credential. This dedicated env file is the authorized fallback.

From the authenticated Mac, re-provision the existing token over SSH stdin.
Never put the value in argv, terminal output, logs, Git, reports, or the keychain:

```sh
python3 - <<'PY'
import os, re, subprocess
token = os.environ.get('GH_TOKEN') or subprocess.check_output(['gh', 'auth', 'token'], text=True).strip()
if not re.fullmatch(r'[A-Za-z0-9_]+', token):
    raise SystemExit('GitHub token is missing or malformed')
remote = ('umask 077; mkdir -p ~/.config/fenok; '
          'cat > ~/.config/fenok/external-clock.env.new && '
          'chmod 600 ~/.config/fenok/external-clock.env.new && '
          'mv ~/.config/fenok/external-clock.env.new ~/.config/fenok/external-clock.env')
subprocess.run(['ssh', 'ubuntu@feno-sin-a1', remote], input='GH_TOKEN='+token+'\n', text=True, check=True)
PY
```

Install these tracked files from the verified published revision on A1:

```sh
install -Dm644 ops/a1-lanes/external-clock.mjs "$HOME/.local/lib/fenok-external-clock/external-clock.mjs"
install -Dm644 ops/a1-lanes/feno-a1-external-clock.service "$HOME/.config/systemd/user/feno-a1-external-clock.service"
install -Dm644 ops/a1-lanes/feno-a1-external-clock.timer "$HOME/.config/systemd/user/feno-a1-external-clock.timer"
systemctl --user daemon-reload
# Read-only credential proof before enabling any dispatch:
systemd-run --user --wait --pipe --collect \
  --property="EnvironmentFile=$HOME/.config/fenok/external-clock.env" \
  /usr/bin/node "$HOME/.local/lib/fenok-external-clock/external-clock.mjs" --probe
systemctl --user enable --now feno-a1-external-clock.timer
systemctl --user list-timers feno-a1-external-clock.timer
journalctl --user -u feno-a1-external-clock.service --since today --no-pager
```

The probe prints only workflow ID, path and state. Ubuntu lingering must remain
enabled (already enabled at installation). The service receipt is
`~/.local/state/fenok-external-clock/dispatches.json`, with no credential.
If a declared cron changes, update `EXTERNAL_CLOCK_CRONS` and the timer calendar
together, run the existing missed-slot tests, publish, then reinstall. To roll
back the clock, disable its user timer; GitHub schedules continue unchanged.
