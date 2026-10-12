# A1 workflow clock

The owner-authorized A1 user timer dispatches existing workflows on
`etloveaui/100xFenok`, branch `main`. GitHub schedules remain fallback.
The October 12 expansion resumes missing weekly/monthly collector slots. The
observed StockAnalysis publisher failure was unrelated stale code assertions;
ETF outcome evidence remains separate from successful trigger installation.

## Schedule and transport

`.github/workflows/*.yml` schedule declarations are the cadence source.
`CLOCK_FILES` in `external-clock.mjs` is the explicit admission list, including
weekly and monthly producers. The hourly Deploy catch-up remains the one
additional A1-only slot. The timer ticks once a minute; it contains no second
minute table. Independent due routes dispatch concurrently, with two bounded
20-second API calls per route and a 55-second service timeout.

Ordinary admitted workflows use `workflow_dispatch` with `external_clock` and
`external_clock_slot`. StockAnalysis and Yahoo already have 25 human inputs;
they instead accept only their named `repository_dispatch` event types. The
same marker and UTC slot live in `client_payload`, bind the Actions run title,
and are checked against the workflow's actual schedule. Malformed marked
requests fail before acquisition. All human controls keep their existing defaults.

The admission job emits the effective collection mode for StockAnalysis and
Yahoo. Stock daily, weekday ETF, general ETF, and Yahoo stock/ETF selection no
longer depend on repeating cron text in the publisher and earnings jobs.
The Yahoo shard weekday and cycle are bound to the original declared slot.
Queued work cannot silently switch to the runner-start day's shard.

A late GitHub fallback skips acquisition only when a successful marked run
proves the same workflow, main branch and exact declared slot. Failed, queued,
unmarked and unrelated slots cannot suppress it. API uncertainty preserves the
GitHub fallback; an unreadable marked admission fails visibly. Monthly lookup
supports day-of-month and month fields, including POSIX day/weekday OR semantics.
GitHub supplies cron and run creation time, not the original scheduled_at; its
fallback is bound to the latest matching slot at creation, never runner start.

Existing writer, collector and publisher concurrency remains. No workflow is
enabled by this clock: disabled workflow metadata returns a no-op. Same-slot
service restarts reuse the local dispatch state. There is no catch-up burst.
Both external transports count as automatic executions in the alarm; an ordinary
human dispatch can only mark recovery pending the next automatic success.
Three missing declared A1 slots raise a1_clock_stale; GitHub successes cannot
clear that clock incident. Admission dates must be the actual installation
boundary, so the never-ran case does not invent earlier missed slots.

Worker request and telemetry jobs are selected from their separate declarations.
An hourly request-budget slot does not run the twice-daily telemetry job.
The M4 watcher and the GitHub alarm retain their independent liveness coverage.

## Existing credential and installation

Use only the existing service EnvironmentFile at
`~/.config/fenok/external-clock.env`. This change creates and copies no credential.
If that existing route is unavailable, stop the installation and report it.
The FDIC collector and its status record keep their separate contract.

Install from the exact published revision on A1 after the proof reads. Stop only
this owned timer and let its current service finish before changing its runtime.
Preserve the existing credential and dispatch state. Install the workflow snapshot,
module and service environment together before restarting the timer.

```sh
systemctl --user stop feno-a1-external-clock.timer
for attempt in $(seq 1 55); do
  clock_state="$(systemctl --user show -p ActiveState --value feno-a1-external-clock.service)"
  case "$clock_state" in inactive|failed) break ;; esac
  sleep 1
done
case "$clock_state" in inactive|failed) : ;; *) echo "Clock service is still running; leave the timer stopped and investigate" >&2; exit 1 ;; esac
install -d "$HOME/.local/lib/fenok-external-clock/workflows"
for workflow in .github/workflows/*.yml; do
  install -m644 "$workflow" "$HOME/.local/lib/fenok-external-clock/workflows/"
done
install -m644 ops/a1-lanes/external-clock.mjs "$HOME/.local/lib/fenok-external-clock/external-clock.mjs.next"
mv "$HOME/.local/lib/fenok-external-clock/external-clock.mjs.next" "$HOME/.local/lib/fenok-external-clock/external-clock.mjs"
install -Dm644 ops/a1-lanes/feno-a1-external-clock.service "$HOME/.config/systemd/user/feno-a1-external-clock.service"
install -Dm644 ops/a1-lanes/feno-a1-external-clock.timer "$HOME/.config/systemd/user/feno-a1-external-clock.timer"
systemctl --user daemon-reload
systemctl --user restart feno-a1-external-clock.timer
systemctl --user list-timers feno-a1-external-clock.timer
journalctl --user -u feno-a1-external-clock.service --since today --no-pager
```

Read the first actual marked executions after installation. A successful dispatch
proves delivery only; the producer result and published source clocks remain
separate evidence. The existing `--probe` reads workflow metadata only and never
dispatches a collector.
