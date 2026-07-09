# Fenok Edge Daily Auto Scheduler - 2026-06-29
## Intent

Make daily market-source refreshes accumulate without turning missing or stale data into a false done claim. The scheduler changes stay bounded, avoid raw private-data publication, and leave the existing readiness gates in the path before commits.

## Owner Carry-forward Plan - 2026-06-30

This document is the handoff-level plan for the current Fenok Edge S0 closure
and the next operational planning pass. It must not imply that daily operations,
legacy deletion, Cloudflare routing, or deployment changes are already approved.

Current owner decisions:

- Short-term Fenok Edge values require fresh daily source inputs for the signals
  that claim short-term meaning. The current green claim is full active S0
  source readiness: 1,172 public active stock rows are PUBLIC + DAILY + GATED
  through KRX, FINRA/OCC, and counted YF daily stock shards. This is not a claim
  that every optional metric axis is complete every day.
- StockAnalysis ETF schedule/deploy was owner-approved on 2026-06-30 for the
  bounded lanes below. Broader cron/GitHub Actions/Cloudflare/Mac mini ownership
  decisions still require separate approval before any new operating claim.
- High load must be managed by a collection lane. When the Mac mini load average
  decision value exceeds `6`, new heavy collection batches should defer instead
  of competing with already-running work.
- Platform backlog item `#296` in
  `/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/100xFenok-platform/docs/BACKLOG.md`
  is now the explicit next product-platform work: sunset legacy 100x, promote
  Next as the canonical root, and remove the confusing GitHub Pages / Cloudflare
  Pages / Workers dual-entry state. Actual deletion, redirect, routing, or deploy
  changes require separate owner approval.
- After this plan is complete, the current four long-running panes should be
  wound down sequentially by the owner. The next selected main Codex pane must
  receive an exact handoff packet before implementation continues.

Non-negotiable handoff contents for the next main pane:

- Clean S0 integration worktree: `/Volumes/M470/tmp/100xFenok-s0-priority-1699`.
- Default nested checkout caveat: `source/100xFenok` in the normal workspace is
  dirty and behind/diverged from the clean temp worktree context; do not copy
  blindly or overwrite user/peer changes.
- S0 completed scope: strict all-active S0 gate green; 1,172 active public stocks;
  current S0 daily/gated source denominator 1,172; KRX 337/337, plain-US
  FINRA/OCC source-ready 685/685, US_CLASS/non-plain YF 59/59, Asia ex-Taiwan
  YF 91/91.
- Verification to rerun before any done claim:
  `npm --prefix 100xfenok-next run qa:fenok-edge-readiness`,
  `npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated`,
  `npm --prefix 100xfenok-next run qa:fenok-s0-source-gaps`, and
  `git diff --check`.
- Open planning items: load-aware collection lane implementation, daily
  operation ownership design, and `#296` legacy-to-Next canonical-root plan.
- Collaboration rules: no polling for new handoff mail; use `feno-handoff`
  wrapper only; no raw tmux pane writes; one selected main pane owns integration;
  helper panes/subagents receive narrow goals and return evidence-backed
  summaries.

## Scheduler Changes

- `.github/workflows/fetch-yf-finance.yml`
  - Adds a KST Tue-Sat bounded ETF history-gap cross-check/backfill lane after the US close.
  - The KST Tue-Sat stock schedule covers the full normalized stock candidate universe each scheduled run, but executes it as 5 bounded shards capped at 260 candidates each. The default daily profile refreshes price/history/fast-info fields, merges non-null values into existing heavier payloads, keeps `stocks_only=true`, `max_age_hours=18`, 45 seconds per ticker attempt, and 1 retry. Manual dispatch can run the same all-shard daily lane with `daily_all_shards=true`; manual `full` dispatch remains a recovery/backfill tool, not the daily operating shape.
  - Scheduled runs override the manual defaults to `etf` profile, 6 rolling shards, 140 tickers per scheduled run, 1 second sleep, `max_age_hours=18`, `history_gaps_only=true`, and `stockanalysis_etfs=true`.
  - The default stock universe now includes both `global-scouter/stocks/detail/*.json` and `market_facts` rows where `asset_type=stock`; this keeps S1 stock candidates in the daily history/price accumulation lane without promoting them into public stock scores.
  - `stockanalysis_etfs=true` adds the full StockAnalysis ETF universe/screener candidate set so ETF daily history gaps can be filled by rotating shards.
  - After YF-derived market facts/audit rebuild, the workflow now rebuilds the local full `fenok_signals.json` plus the public `fenok_signals_summary.json` mirror before the dual-hexagon gate runs.
  - YF and StockAnalysis market-facts writers rebuild `data/computed/rim-index/inputs.json` and its Next public mirror before readiness QA, so `qa:rim-index` cannot fail on stale RIM inputs after fresh market data writes.
  - The workflow participates in the shared `fenok-data-writer-${{ github.ref }}` queue and uses the same 5-attempt rebase/push retry loop as the generated-data writers, so it does not race overlapping data commits.
  - YF JSON writes sanitize non-finite Yahoo values before writing and use `allow_nan=false` so `Infinity` / `NaN` cannot break the Node rebuild steps that parse the generated payloads.
  - Manual dispatch still keeps the existing full/profile/limit/shard controls.
- `.github/workflows/fetch-fred-yardeni.yml`
  - Weekly FRED Yardeni rebuild remains the canonical Feno Yardeni lane: public payload keeps only `date/spx/eps/bond_per/fair_value/premium_pct`, while raw FRED bond-yield components stay under `_private/admin/yardney`.
  - `scripts/build-feno-yardeni-model.mjs --check` now ignores run-generated `meta.generated_at` drift and fails only on substantive public payload differences.
- `.github/workflows/fetch-stockanalysis.yml`
  - Adds a KST Tue-Sat bounded Core Basket/surface refresh lane after the YF window.
  - Scheduled runs disable stock financial statements, full ETF universe discovery, and universe backfill.
  - Scheduled runs keep incremental ETF backfill on, capped at 40 ETF details, with Core Basket priority tickers, core surfaces, and 0.5 second sleep.
  - After StockAnalysis detail/history refreshes, the workflow now rebuilds ETF signals and the ETF action index before rebuilding the ETF Core Daily Basket. This keeps the committed Core Basket artifacts aligned with the same clean-base generation order used by the Cloudflare Worker build.
  - The workflow participates in the shared `fenok-data-writer-${{ github.ref }}` queue because it regenerates the same coverage/readiness/static-route artifacts as the Edge daily lanes.
- `.github/workflows/slickcharts-*.yml`
  - SlickCharts daily/weekly/monthly/symbols/history updates now participate in the same `fenok-data-writer-${{ github.ref }}` queue before pushing data commits.
  - After updating `data/slickcharts/` and the Next public mirror, these lanes rebuild S1 dry-run evidence, run `sync-static`, and must pass `qa:fenok-edge-readiness` plus `qa:fenok-s0-daily-gated` before commit/push.
  - Successful SlickCharts data commits dispatch `update-manifest.yml`, so bot-authored data updates still flow into manifest/RIM rebuild and the Worker deploy dispatch path.
- `.github/workflows/fenok-edge-daily.yml`
  - Adds a KST Tue-Sat 09:30 FINRA/OCC derived-proxy refresh.
  - FINRA defaults to a 7-day-to-yesterday window to tolerate holidays and source lag.
  - OCC runs sequential same-run batches with default `250` tickers x `5` batches. The per-batch request budget stays within `1500` because the default candidate window can require up to 3 dates x 2 option sides.
  - Shares `fenok-data-writer-${{ github.ref }}` with KRX/YF/StockAnalysis/FRED Banking/Update Manifest so overlapping generated JSON commits serialize before the commit/push step.
- `.github/workflows/fenok-edge-krx-daily.yml`
  - Adds a KST Mon-Fri 19:30 KRX Open API private daily refresh.
  - Scheduled runs start from the latest settled KRX date (`T-1` weekday) and auto-walk back up to 5 calendar days when required issuer daily rows are still empty. Each candidate stays bounded to one `basDd`, 31 endpoints, max 40 calls, concurrency 2, 250ms sleep, and fail threshold 0.
  - Raw KRX payloads stay under `_private/admin`; the tracked bridge index stores only counts and private path references.
  - The KRX lane now stages the regenerated `data/computed/rim-index/inputs.json` and Next public mirror so a successful KRX bridge refresh also publishes the latest KOSPI RIM input-only state.
  - Shares the same `fenok-data-writer-${{ github.ref }}` queue as Fenok Edge daily to prevent KRX bridge commits and FINRA/OCC commits from rebasing over conflicting regenerated artifacts.

## Load-aware Collection Lane

The current collectors are individually bounded, but the durable operating model
needs a cross-collector lane governor before broader daily coverage expands.
Until that governor exists, the daily system must not be described as "every
optional metric for every ticker fully refetched every day." The correct claim
is that S0 DAILY/GATED is maintained by bounded KRX, FINRA/OCC, and YF daily
source refreshes plus fail-closed readiness gates.

Target lane shape:

```text
load-aware collection lane
├─ priority 0: keep S0 freshness green
│  ├─ KRX daily issuer proof
│  ├─ FINRA active plain-US source-ready proof
│  ├─ OCC active plain-US source-ready proof
│  └─ YF daily source proof for US_CLASS/non-plain and HKEX/SSE/SZSE rows
├─ priority 1: repair S0 blockers only if strict gate turns red
├─ priority 2: S1/S3/ETF backfill and expansion work
└─ global guard: pause or defer new heavy fetch batches when system load is high
```

Minimum governor contract:

- Measure current load before starting any heavy local collector batch. Use the
  maximum of 1/5/15-minute load averages for the decision, and record the top
  collector-like process list from `ps` for diagnosis.
- Treat load average above `6` on the Mac mini as a stop-new-heavy-work signal.
  A scheduled fetch lane should exit `0` with `decision=defer`, not fail the
  workflow, when it skipped work solely due to load. A real collector/data error
  still fails normally.
- Keep a collector lock/state file so YF, StockAnalysis, KRX, FINRA, and OCC do
  not start broad fetch work at the same time on the same host. Proposed paths:
  `data/admin/fenok-collection-lane-status.json` for the admin-only status
  artifact, and `_tmp/fenok-collection-lane.lock/` for the atomic local lock.
  The lock is acquired with atomic directory creation, records owner pid, lane,
  command, run id, started_at, priority, and ttl_seconds, and is considered stale
  only when the pid is gone or the TTL has expired.
- Preserve lane priority: S0 freshness beats S0 repair; S0 repair beats S1/S3/ETF
  catch-up; ETF/S3 never preempts a red S0 gate.
- Require every lane output to pass `qa:fenok-edge-readiness` or the stricter
  S0 gate before any public done wording is allowed.
- Report the current lane, skipped/deferred batch, load snapshot, and next
  resumable batch in the operator readout.

Governed heavy commands:

- YF collection: `scripts/fetch-yf-finance.py` when not running plan/no-fetch
  diagnostics.
- StockAnalysis collection: `scripts/fetch-stockanalysis.py` when a fetch/backfill
  mode can touch network or large history batches.
- KRX collection: `scripts/fetch-fenok-krx-daily-private.mjs` when not `--no-fetch`
  or `--plan-only`.
- FINRA/OCC source refresh through `scripts/update-fenok-signal-lens-proxies.mjs`
  when not `--no-fetch` or `--dry-run`.

Exempt commands:

- No-fetch QA and reporting commands such as `qa:fenok-edge-readiness`,
  `qa:fenok-s0-daily-gated`, `qa:fenok-s0-source-gaps`, `qa:fenok-daily-accumulation`,
  and `git diff --check`.
- Plan-only/dry-run commands that do not fetch, write private raw payloads, or run
  broad batch work.

Lane status artifact draft:

```json
{
  "schema_version": "fenok-collection-lane-status/v0.1",
  "generated_at": "2026-06-30T00:00:00.000Z",
  "run_id": "local_or_workflow_run_id",
  "current_lane": "s0_freshness",
  "priority": 0,
  "lock_owner": {
    "pid": 12345,
    "command": "scripts/fetch-yf-finance.py ...",
    "started_at": "2026-06-30T00:00:00.000Z",
    "ttl_seconds": 7200
  },
  "load_avg": { "one": 2.1, "five": 3.0, "fifteen": 3.4, "decision_value": 3.4 },
  "decision": "run",
  "deferred_reason": null,
  "next_resumable_batch": null,
  "safe_to_resume": true
}
```

Implementation slices still open:

1. Add a small load-state helper that emits `load_avg`, top collector process,
   active lock owner, and recommended action (`run`, `defer`, `resume_later`).
2. Wire that helper into local/cron collection wrappers before YF/StockAnalysis
   and any broad OCC/FINRA/KRX run.
3. Add a generated admin-only lane status artifact so dashboards and handoffs can
   see why a batch ran, paused, or deferred without reading shell logs.
4. Extend `qa:fenok-daily-accumulation` to print lane status next to the existing
   source freshness and blocking-gate readout.

Acceptance criteria for the governor:

- A dry-run load check can prove `run` below the threshold and `defer` above the
  threshold without starting a network fetch.
- A second heavy collector invocation sees the active lock and exits with a
  resumable/deferred status instead of competing for CPU/network.
- A red strict S0 gate blocks S1/S3/ETF backfill from starting until the S0 lane
  is green or explicitly owner-overridden.
- A plan/no-fetch QA command remains exempt from the heavy-lane lock and can still
  run during a deferred fetch window.
- The lane status artifact contains no raw private cache paths, credentials, or
  fetched payload rows.
- The lane status artifact includes `current_lane`, `priority`, `lock_owner`,
  `load_avg`, `decision`, `deferred_reason`, `next_resumable_batch`, `generated_at`,
  `run_id`, and `safe_to_resume`.
- `npm --prefix 100xfenok-next run qa:fenok-edge-readiness` remains the final
  claim gate after any load-aware lane run.

## Gates

- Fenok Edge daily rebuilds `data/admin/fenok-edge-coverage-index.json` after FINRA/OCC proxy refresh.
- Fenok Edge KRX daily updates `data/admin/fenok-edge-korea-krx-daily-index.json`, then rebuilds `data/admin/fenok-edge-coverage-index.json`.
- Generated-data writers that touch overlapping Fenok Edge artifacts are serialized by the shared `fenok-data-writer-${{ github.ref }}` concurrency group. This was added after run `28981832204` proved that separate Edge/KRX queues can both pass data rebuilds but fail at commit time with real generated-JSON rebase conflicts. The fix commit `2556a02882` passed workflow YAML validation in run `28982488893`.
- Fenok Edge daily then runs `npm --prefix 100xfenok-next run sync-static`, which rebuilds `data/computed/rim-index/inputs.json` and its Next public mirror.
- Bot-authored generated-data commits do not start push-triggered deploy runs on their own because of GitHub recursion guards. `Update Manifest` now requests `actions: write` and dispatches `Deploy Worker (Cloudflare)` after a generated-data commit, while the scheduled deploy remains the safety-net reconciliation path.
- Every workflow that commits refreshed data now follows the same writer contract: `actions: write`, shared `fenok-data-writer-${{ github.ref }}` concurrency, guarded rebase retry before push (`pull` failure aborts the in-progress rebase before the next attempt), and an explicit post-push workflow dispatch. Edge/YF/StockAnalysis/SlickCharts/macro/FRED/Yardeni/DefiLlama/Sentiment/FDIC/TGA/Yahoo ticker/global-scouter/13F writers dispatch `update-manifest.yml`; EDGAR dispatches `deploy-worker.yml` directly because it updates `data/manifest.json` and the static route manifest inside its own run.
- 2026-07-09 verification: manual YF daily all-shards run `28989900069` succeeded with `daily_all_shards=true`, `profile=daily`, `merge_existing=true`, and produced `data/yf/finance/_summary.json` with `count=1248`, `ok=1248`, `failed=0`. Follow-up data commits `3a0af30821`, `0eec550af4`, and bot manifest commit `cd5b7013c5` were pulled to main; final explicit Worker deploy `28991274708` on `cd5b7013c5` passed build/deploy/public smokes. Live Worker verification returned the same YF summary and fresh RIM inputs from `/data/computed/rim-index/inputs.json`.
- RIM QA accepts both valid KOSPI operating states: `backlog_blocked` when no KRX bridge is available in the checkout, and `secondary_input_only` with KRX exact weights/KTS 10Y when the bridge is present.
- YF daily, Fenok Edge daily, Fenok Edge KRX daily, and StockAnalysis daily must pass `npm --prefix 100xfenok-next run qa:fenok-edge-readiness` before committing. Scheduled Edge/KRX/YF/StockAnalysis workflows also run the strict `npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated` gate directly before committing.
- `qa:fenok-edge-readiness` includes `qa:rim-index`, a no-fetch RIM input contract check that forbids public `fair_value` / `target_price` output and blocks KOSPI from using DGS10 as a fallback.
- `qa:fenok-edge-readiness` includes `qa:fenok-daily-accumulation`, a no-fetch truth report that fails only on unsafe public/daily/gated claims.
- `qa:fenok-edge-readiness` also includes `qa:fenok-s0-source-gaps`, a no-fetch S0 source-gap audit that classifies FINRA/OCC missing rows into collection candidates vs universe-mapping policy work.
- `qa:fenok-edge-readiness` includes `qa:fenok-occ-options`, a no-fetch unit/plan test for OCC selector, request budget, and no-record availability evidence handling.
- `qa:fenok-edge-readiness` includes `qa:fenok-s1-promotion-gate`, a no-fetch check that the durable non-public S1 promotion gate artifact can be regenerated without mutating S0/public outputs.
- ETF daily 1Y readiness uses the current `fenok_etf_signals_summary.json` plus ETF detail files as the exact selector. The StockAnalysis history-gap report remains a freshness/diagnostic input and may lag inside the same build after the ETF summary is regenerated.
- StockAnalysis run `28983683639` produced data commit `20ca24adf7`, but the following manual Worker deploy `28983982075` failed in `qa:fenok-etf-core-daily-basket` because the committed Core Basket payload was built before the refreshed ETF signals/action-index layer. Fix commit `e53ffc2747` regenerates `fenok_etf_signals`, `etf_action_index`, and the Core Basket artifacts in the workflow order; local `qa:fenok-etf-core-daily-basket` passed before push.
- YF run `28980507925` completed its batch fetch but failed at `Rebuild Fenok signal summary mirrors` because a Yahoo payload contained `Infinity`, which is valid under Python's default `json.dumps` but invalid for Node `JSON.parse`. Fix commit `5acdce1b7c` adds stable JSON serialization and a unit test so non-finite values are removed before write; rerun `28984738182` is the current main verification run.
- 2026-07-09 local verification after the all-active daily-source rebuild: `sync-static`, `qa:fenok-edge-readiness`, `qa:fenok-s0-daily-gated`, and `report-fenok-daily-accumulation --check` passed with S0 active stock `1172/1172` daily/gated, S1 `1178 = 1172 public + 6 blocked`, ETF service daily/gated true, and RIM primary index QA green.
- Existing build scripts still run `qa:fenok-edge-readiness` before runtime/static/Cloudflare builds.

## Daily Truth Table

Current local snapshot:

| Layer | Current stage | Scheduled cadence | Current backlog / next-run exposure | Remaining blocker |
| --- | --- | --- | --- | --- |
| S0 active stock scoring | PUBLIC + DAILY + GATED for the full active stock universe | `fenok-edge-krx-daily.yml` runs KST Mon-Fri 19:30 for bounded KRX private daily fetch; `fenok-edge-daily.yml` runs KST Tue-Sat 09:30 for FINRA/OCC; `fetch-yf-finance.yml` keeps US_CLASS/non-plain and HKEX/SSE/SZSE daily stock shards fresh | 1,172 scored/public stocks; all-active S0 daily/gated source scope is 1,172 rows: US 744 (`685` plain-US FINRA/OCC + `59` US_CLASS/non-plain YF), Korea 337, Asia ex-Taiwan 91. KRX source-ready 337/337, FINRA source-ready 685/685 (`682/685` metric-ready diagnostic), OCC source-ready 685/685 (`680` options-activity rows + `5` no-listed-options evidence), US_CLASS YF 59/59, Asia YF 91/91. Strict `qa:fenok-s0-daily-gated` is green | none for current strict S0; FINRA/OCC metric expansion for non-plain/class rows remains a separate signal-quality task, not a daily/gated blocker |
| S1 stock candidates | PUBLIC_GATED_WITH_BLOCKED_LEDGER | YF scheduled branch processes all 1,178 stock candidates per weekday run through 5 bounded daily shards, using merge-preserving `daily` profile; scheduled StockAnalysis stock-financial fetches remain disabled | 1,178 normalized stock candidates are fully accounted for by 1,172 public S0 rows plus 6 blocked/excluded rows. Current dry-run has `promotion_rows=0`, `excluded_blocked_rows=6`, and `public_s0_after_if_enabled=1172` | none for the current public/gated S1 accounting; blocked rows stay explicit repair candidates until a separate identity/source policy promotes them |
| S3 ETF public/full universe | PUBLIC service lane + DAILY/GATED service evidence; full daily-1Y remains diagnostic/backfill | YF scheduled branch processes ETF history gaps through one rolling shard per run, capped at 140; StockAnalysis daily-1Y branch drains exact diagnostic gaps at 120/run; Core Basket priority surface remains service-gated | 5,442 ETF candidates; 4,508 scored/public ETF rows in the separate ETF lane. Named ETF gates verify the compact public summary mirror, ETF signal API route, ETF action index, ETF detail UI card, and New ETF Radar. Generated admin diagnostic evidence is `data/admin/fenok-edge-etf-daily1y-readiness.json` with `4508 = 3703 complete + 216 fetchable + 589 inception-limited`; exact fetchable ticker plan is `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json` with 216 tickers / 2 bounded batches | No service blocker. The 216 fetchable daily-1Y rows are rolling diagnostic/backfill work with `service_gate=false`, not an ETF service readiness blocker |
| ETF Core Daily Basket | SERVICE DAILY + GATED, currently green | StockAnalysis Core Basket/surface branch refreshes the Core Basket priority list and rebuilds the Core Basket evidence | 115 selected rows; current local regeneration is 115 fresh / 0 stale, `core_daily_basket_ready=true`; excludes leveraged, inverse, single-stock, single-stock/concentrated derivative-income strategy, low-confidence, broken-history, stale, and New ETF Radar-only rows | No current blocker; keep the gate fail-closed if stale selected rows return |

Operational command:

```bash
npm --prefix 100xfenok-next run qa:fenok-daily-accumulation
npm --prefix 100xfenok-next run qa:fenok-etf-daily1y-readiness
npm --prefix 100xfenok-next run qa:fenok-occ-options
npm --prefix 100xfenok-next run qa:fenok-s0-source-gaps
npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated
```

The command reads existing derived JSON only. It does not fetch, write, promote S1 rows, or compute ETF scores. ETF service `done` wording is Core Basket scoped: Core Basket gate, fresh evidence, and `stale_selected_count=0` must be true. Full ETF no-fetchable history checks remain diagnostic/backfill and do not block the Core Basket service gate.

Operator readout rule:
- Each S0/S1/S3 row prints `status: sources=[...] blocking_gates=... done_claim_allowed=...`.
- Treat `sources=[...]` as the latest available derived source dates/timestamps, not as paid-ready proof.
- If `blocking_gates` is non-empty or `done_claim_allowed=false`, do not call that layer PUBLIC + DAILY + GATED.
- `active S0 evidence` shows the fail-closed blockers that must clear before `daily` or `gated` can flip; current all-active S0 evidence is green for 1,172/1,172 rows.
- The active S0 coverage index now carries derived blocker evidence directly under `public_scoring_readiness.tracks[].blocking_evidence`, so operators can see KRX, FINRA/OCC, US_CLASS YF, and HKEX/SSE/SZSE YF counts without reading raw/private manifests.
- The active/public scoring universe is 1,172. The current all-active S0 daily/gated source scope includes all 1,172 rows: Korea 337, plain-US FINRA/OCC 685, US_CLASS/non-plain YF 59, and Asia ex-Taiwan YF 91. `excluded_count` must remain 0 for an all-active S0 DAILY/GATED claim.
- The S0 source-gap audit remains the action splitter for signal-quality gaps: FINRA source-ready is 685/685 while metric-ready remains 682/685; US_CLASS/non-plain rows are daily-source-ready through YF, not FINRA/OCC metric-complete.
- OCC source-ready readiness is 685/685 for active plain-US rows: 680 rows have options-activity proxy output, and 5 both-side `no_record` rows count as no-listed-options source-ready evidence without fabricating options activity.
- Asia ex-Taiwan is now counted through the scheduled YF daily stock shard lane. If Asia YF freshness turns stale or incomplete, `qa:fenok-s0-daily-gated` must turn red rather than silently excluding those rows.
- `ETF evidence` separates public service proof, Core Basket service readiness, and full-universe diagnostic readiness. Current full-universe daily 1Y continuity still has 216 fetchable diagnostic gaps, but current Core Basket local regeneration is `115 fresh / 0 stale`; ETF service DAILY/GATED wording is service-scoped, not a full-history-complete claim.
- `data/admin/fenok-edge-etf-daily1y-readiness.json` is the generated full-universe daily 1Y diagnostic evidence, and `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json` is the exact no-fetch 216-ticker StockAnalysis diagnostic plan after the latest YF fallback-enabled run. Both must remain admin-only; `sync-static-overrides` removes the readiness public mirror and `qa:fenok-public-guard` forbids `public/data/admin/fenok-edge-etf-daily1y-readiness.json` and `public/data/admin/fenok-edge-etf-daily1y-fetchable-plan.json`.
- `scripts/fetch-stockanalysis.py --incremental-etf-backfill --incremental-etf-only --history-gaps-only --required-history-periods daily_1y --incremental-etf-limit 120` now treats `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json` as the exact dispatch source for full-universe diagnostic catch-up: it selects 120 from the 216 scored-ETF fetchable rows and does not broaden into generic missing/fallback/stale ETF retries.
- The strict goal gate remains `npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated`; it must stay green before any current S0 PUBLIC + DAILY + GATED wording is used.

## Resource Controls

- Current resource controls are per-collector throttles, not a full lane
  governor. They keep individual jobs bounded, while the load-aware collection
  lane above defines the next coordination layer.
- YF daily schedule is shard-limited without lowering the stock target: stock runs execute all 5 daily shards in the same scheduled run, capped at 260 candidates per shard with merge-preserving `daily` profile; this stock lane is now counted for US_CLASS/non-plain and HKEX/SSE/SZSE daily-source readiness. ETF runs use one of 6 rolling shards capped at 140 candidates and are history-gap-limited.
- YF daily ETF initial fill is expected to take multiple scheduled runs because each run processes one rolling shard capped at 140 candidates; large history-gap sets require repeated shard cycles before clearing. After gaps shrink, `history_gaps_only` and `max_age_hours` keep runs bounded; newly launched ETFs can remain inception-limited without blocking the ETF lane.
- `scripts/write-fenok-etf-daily1y-readiness.mjs --check` persists the S3 admin-only readiness artifact plus the exact fetchable plan, validates the count equation against the ETF signal summary, the StockAnalysis history-gap report, and the coverage index, and records that local YF-only history would over-select 4,113 scored ETFs. It does not fetch or write public files.
- S1 stock candidates are data-fill candidates only. `stock_action_index`, `fenok_signals`, and public stock scoring remain S0-only until a separate promotion/scoring-chain contract lands.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --scoring-contract-report --check` is the first S1 scoring-chain contract artifact. It is stdout-only, non-public, non-daily, non-gated, keeps all score outputs null, and does not mutate `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --score-preview-report --check` adds the next non-public S1 preview step. It uses the shared S0 scoring core, emits only stdout preview rows for joined-ready S1 stocks, keeps missing/unsupported axes explicit as `null` / `미확인`, and still does not mutate public S0, `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/write-fenok-s1-stock-public-promotion-dry-run.mjs --check` persists the current S1 public-gated-with-blocked-ledger evidence to `data/admin/fenok-s1-stock-public-promotion-dry-run.json`: 1,178 denominator, 1,172 public S0 rows, 6 blocked/excluded rows, and 0 promotion rows. It writes no S0 scoring file, no `fenok_signals`, and no public mirror beyond the derived admin evidence.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --blocked-unblock-diagnostics-report --check` keeps DAY/HOLX/MMC/STRC as blocker-only diagnostics with local source evidence and next repair targets; it still writes no `stock_action_index`, `fenok_signals`, or public mirror output.
- The S1 joined gate counts tickers present in the StockAnalysis corporate-action surface as the existing `stockanalysis` evidence family, deduped with StockAnalysis detail files. This removes DAY's evidence-family blocker but does not resolve DAY/HOLX/MMC identity scope.
- Blocked diagnostics expose `accepted_family_flags` separately from raw `source_flags`, so surface-only StockAnalysis evidence is visible without pretending the market_facts detail already has a StockAnalysis source flag.
- Blocked diagnostics and promotion plans also expose StockAnalysis corporate-action/alias policy evidence for DAY/HOLX/MMC. Acquired, delisted, or old-symbol rows remain diagnostics-only until an explicit terminal/alias policy exists; the audit must not copy MRSH identity into old ticker MMC or promote these rows by inference.
- StockAnalysis daily schedule is incremental-only for ETF detail plus core surfaces.
- Fenok Edge OCC daily schedule is batch-limited, request-limited, failure-thresholded, and sleep-throttled.
- `scripts/fetch-fenok-occ-options-volume.mjs --s0-occ-missing --batch-size 25 --batch-index 0 --date 20260626 --max-requests 50 --plan-only` selected 25 active plain-US OCC gaps for the 2026-06-30 eighth bounded OCC slice. It added 6 usable OCC rows; the later narrow partial follow-up resolved 13 one-side `partial_no_record_or_form_gap` rows into usable OCC rows, leaving 6 both-side `no_record` rows.
- OCC no-record and all-empty batches now have a derived evidence path: `data/computed/fenok_occ_options_availability.json`. This file must contain no raw CSV rows and no private cache paths; both-side no-record evidence is source-ready only when both C/P sides return no record for the counted source date.
- OCC accepted-form policy is explicit: future one-side `loaded` + one-side `no_record` rows may be represented as accepted-form rows with the `no_record` side set to zero volume, while both-side `no_record` counts as no-listed-options source-ready evidence for daily/gated readiness and does not fabricate options activity.
- The 20260626 narrow OCC partial follow-up resolved the 13 prior one-side loaded / one-side `no_record` rows into usable OCC rows. The 6 both-side `no_record` plain-US rows are now counted as no-listed-options source-ready evidence, so current plain-US OCC blocking count is 0.
- BRK class-share follow-up should use `scripts/fetch-fenok-occ-options-volume.mjs --s0-occ-class-share --plan-only --date 20260626 --max-requests 4` first; it maps the current `BRK-A`/`BRK-B` gaps to dotted OCC accepted-form candidates `BRK.A`/`BRK.B` without touching the 56 foreign-suffix mapping rows.
- Live OCC gap filling remains bounded and source-date guarded. The older 19-ticker / 38-side unresolved plain-US budget is closed for current S0 readiness: 13 rows became usable OCC rows, and 6 both-side `no_record` rows became no-listed-options source-ready evidence.
- `scripts/update-fenok-signal-lens-proxies.mjs --options-all-eligible` now defaults to `--options-max-walkback-days 2` when no explicit value is passed, so normal OCC publication lag does not make the daily all-eligible path same-day brittle.
- Fenok Edge KRX daily schedule is one-day by default, max-call-limited, concurrency-limited, sleep-throttled, and fails closed on failed files or empty KOSPI/KOSDAQ issuer daily rows unless manually overridden.
- Fenok Edge skips GDELT/news by default in the daily workflow.
- Manual workflow dispatch exposes `plan_only`, `no_fetch`, KRX date/day/request controls, FINRA date overrides, and OCC batch/request controls.

## Public-Safe Write Policy

- Raw KRX/FINRA/OCC caches remain under `_private/`, which is ignored by git.
- Fenok Edge daily commits only derived JSON, coverage indexes, and generated route metadata.
- Ignored public computed mirrors are not force-added; they are regenerated by `sync-static` during build/runtime preparation.

## Residual Expansion Gap

KRX, FINRA/OCC, YF stock shards, and ETF service gates now have scheduled daily source paths, and the current all-active S0 source scope is green. The coverage index counts only the latest non-empty KRX stock/KOSDAQ issuer daily proof plus the latest FINRA/OCC/YF source proofs, and `qa:fenok-edge-readiness` plus the strict `qa:fenok-s0-daily-gated` gate remain the source of truth for any PUBLIC + DAILY + GATED claim.

- Strict S0 is green when active stock count and track denominator are both 1,172 and `active_stock_scoring_current` has `requirements.daily=true`, `requirements.gated=true`, `readiness_status=ready`, `public_done_claim_allowed=true`, and `s0_daily_gated_scope.excluded_count=0`.
- Current daily proof: source/proxy rows are explicitly `not_public_scoring`; KRX covers 337/337 Korea rows, FINRA source-ready covers 685/685 active plain-US rows, OCC source-ready covers 685/685 active plain-US rows, US_CLASS/non-plain YF covers 59/59 rows, and HKEX/SSE/SZSE YF covers 91/91 rows.
- Current gated proof: the fail-closed promotion rule now turns complete daily evidence into `requirements.daily=true` and `requirements.gated=true` only after stale, missing, empty-source, raw-private, and public-mirror checks pass.
- If `qa:fenok-s0-daily-gated` turns red again, any S0 wording must immediately fall back to "PUBLIC, not DAILY/GATED" until the gate is repaired.
