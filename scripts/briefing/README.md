# 100x Morning Brief article job

A 100x-lane daily job on M4. It turns the overnight US session into a Korean article
(`briefing-morning/v1`), commits it to `data/briefing/`, and sends one Telegram link per date.
Design and owner decisions: `claude-code-hub/docs/planning/PLAN_100x-morning-brief-article_20261008.md`.

## Flow (`run_morning.py`)

1. **Session.** The edition date is the KST date. The session reviewed is the ET day before it. Editions whose
   previous day was not a US trading day are skipped (NYSE rules in `market_pack.py`, extra closures in
   `config.json` `market.extra_closed_dates`).
2. **Readiness.** The job polls every 3 minutes for two AA files: the canonical AA brief
   `docs/outputs/intelligence/morning_brief_YYYYMMDD.md` and the fact cards
   `scripts/morning_brief/debug/newsdesk_fact_cards_YYYYMMDD_*.json`. If they are not there by 09:30 KST, the
   run fails. AA is read only.
3. **Market pack (`market_pack.py`).** Yahoo daily and 5-minute data, the Treasury par curve, FRED DGS10,
   Finviz breadth (latest session only) and the Nasdaq calendar. Before Treasury posts, the job uses the Yahoo
   ^TNX/^TYX closes. Every ET time gets a KST twin through `zoneinfo`.
4. **시장 체력 (`edge.py`).** This is the 100x formula. F&G is the value from the AA 06:00 prompt file, with the
   100x CNN history as the fallback. The 7-session strip and the previous score come from `data/briefing/index.json`.
5. **Writer (`writer.py`).** Opus 5.5 at effort medium writes first; Sonnet 5.5 runs if Opus fails (API error,
   stop reason, JSON or schema). The server-side refusal fallback is on. Each call appends a line to
   `~/.local/state/100x-briefing/usage.jsonl`.
6. **Checks (`validate.py`, `stats.py`).**
   - Hard gates: the writer schema and the `briefing-morning/v1` schema.
   - Ticker fixes: mover tickers that are not on the SEC list, or not named in the sources, are blanked.
   - Warnings only: the number check (it accepts rounded values, Korean unit forms such as 48만6,532 and 8.9만,
     and computed ratios) and polite-ending checks.
7. **Publish (`publish.py`).**
   - The job uses a dedicated sparse worktree, `~/.local/share/100x-briefing/repo`, and moves it to `origin/main`.
   - It writes `morning/<date>.json` and merges `index.json`.
   - It commits only those two paths and pushes them to `main`. If the push is rejected, it regenerates on a fresh tip.
   - `publish-briefing.yml` then copies the folder to R2.
   - The job waits up to 15 minutes for `/data/briefing/morning/<date>.json` to return 200.
8. **Telegram (`notify.py`).**
   - The job sends once per date, through the AA Publication Gateway (product `morning_brief`, class
     `publication`, run id `morning_article:<date>`).
   - The message carries the headline, the thesis, the two `story.why` lines and the article link.
   - A failure sends nothing. It is written to the run log and to `editions/<date>.json`.

## Commands (M4)

```zsh
# live run for today (what launchd runs at 06:05 KST, Tue-Sat)
~/.local/share/100x-briefing/repo/scripts/briefing/run_m4.sh
# a given edition, live
~/.local/share/100x-briefing/repo/scripts/briefing/run_m4.sh --edition 2026-10-09
# dry run: no commit, no push, no Telegram -> ~/.local/state/100x-briefing/runs/<date>-dry/
~/.local/share/100x-briefing/repo/scripts/briefing/run_m4.sh --edition 2026-10-08 --dry-run
# spend ledger
cd ~/.local/share/100x-briefing/repo/scripts && ~/.local/share/100x-briefing/venv/bin/python -m briefing.ledger
# tests
cd ~/.local/share/100x-briefing/repo/scripts && ~/.local/share/100x-briefing/venv/bin/python -m unittest discover -s briefing/tests -t .
```

Other flags:

- `--no-wait` fails at once when the AA files are missing.
- `--force` regenerates an edition that is already done. It does not send a second Telegram message, because both
  the state file and the Gateway run id block it.
- A rerun after a push resumes at the URL wait and the notification.

## Runtime on M4

| Item | Path |
|---|---|
| venv (`anthropic jsonschema yfinance pandas`) | `~/.local/share/100x-briefing/venv` |
| job worktree (sparse: `scripts/briefing`, `data/briefing`, `data/sentiment/cnn-fear-greed.json`) | `~/.local/share/100x-briefing/repo` |
| launchd agent (template in this folder) | `~/Library/LaunchAgents/com.fenok.100x-briefing-morning.plist` |
| logs, run outputs, state, usage ledger, caches | `~/.local/state/100x-briefing/` |

`run_m4.sh` exports only `ANTHROPIC_PLAN_CREDIT_API_KEY`, `SEC_USER_AGENT` and `FRED_API_KEY` from
`~/.secrets/all-keys.env`. It never prints them. All models, effort levels, token limits, prices, URLs and paths
are in `config.json`.
