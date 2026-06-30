# Fenok Edge Daily Auto Scheduler - 2026-06-29
## Intent

Make daily market-source refreshes accumulate without turning missing or stale data into a false done claim. The scheduler changes stay bounded, avoid raw private-data publication, and leave the existing readiness gates in the path before commits.

## Owner Carry-forward Plan - 2026-06-30

This document is the handoff-level plan for the current Fenok Edge S0 closure
and the next operational planning pass. It must not imply that daily operations,
legacy deletion, Cloudflare routing, or deployment changes are already approved.

Current owner decisions:

- Short-term Fenok Edge values require fresh daily source inputs for the signals
  that claim short-term meaning. The current green claim is narrower: S0 is
  PUBLIC + DAILY + GATED under the current Korea+US source scope, not "all 1,066
  tickers fully refetched every day."
- Daily operation remains a future design conversation. Do not finalize cron,
  GitHub Actions, Cloudflare, or local Mac mini ownership in this pass.
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
- S0 completed scope: strict S0 Korea+US gate green; 1,066 active public stocks;
  current S0 daily/gated source denominator 975; OCC source-ready 579/579; FINRA
  active plain-US metric-ready 579/579; KRX 338/338.
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
  - Adds a weekday bounded catch-up schedule after the US close.
  - Scheduled runs override the manual defaults to `etf` profile, 6 rolling shards, 140 tickers per scheduled run, 1 second sleep, `max_age_hours=18`, `history_gaps_only=true`, and `stockanalysis_etfs=true`.
  - The default stock universe now includes both `global-scouter/stocks/detail/*.json` and `market_facts` rows where `asset_type=stock`; this keeps S1 stock candidates in the daily history/price accumulation lane without promoting them into public stock scores.
  - `stockanalysis_etfs=true` adds the full StockAnalysis ETF universe/screener candidate set so ETF daily history gaps can be filled by rotating shards.
  - Manual dispatch still keeps the existing full/profile/limit/shard controls.
- `.github/workflows/fetch-stockanalysis.yml`
  - Adds a weekday bounded ETF/surface catch-up schedule after the YF window.
  - Scheduled runs disable stock financial statements, full ETF universe discovery, and universe backfill.
  - Scheduled runs keep incremental ETF backfill on, capped at 40 ETF details, with core surfaces and 0.5 second sleep.
- `.github/workflows/fenok-edge-daily.yml`
  - Adds a KST Tue-Sat 09:30 FINRA/OCC derived-proxy refresh.
  - FINRA defaults to a 7-day-to-yesterday window to tolerate holidays and source lag.
  - OCC rotates through eligible tickers using `GITHUB_RUN_NUMBER % occ_batch_count`, defaulting to 50 tickers across 13 batches.
- `.github/workflows/fenok-edge-krx-daily.yml`
  - Adds a KST Mon-Fri 19:30 KRX Open API private daily refresh.
  - Scheduled runs default to one `basDd`, 31 endpoints, max 40 calls, concurrency 2, 250ms sleep, and fail threshold 0.
  - Raw KRX payloads stay under `_private/admin`; the tracked bridge index stores only counts and private path references.

## Load-aware Collection Lane

The current collectors are individually bounded, but the durable operating model
needs a cross-collector lane governor before broader daily coverage expands.
Until that governor exists, the daily system must not be described as "all 1,066
tickers fully refetched every day." The correct claim is that S0 DAILY/GATED is
maintained by bounded Korea+US source refreshes plus fail-closed readiness gates,
with Asia ex-Taiwan still requiring a separate daily-source lane.

Target lane shape:

```text
load-aware collection lane
├─ priority 0: keep S0 freshness green
│  ├─ KRX daily issuer proof
│  ├─ FINRA active plain-US metric-ready proof
│  └─ OCC active plain-US source-ready proof
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
- Fenok Edge daily then runs `npm --prefix 100xfenok-next run sync-static`.
- YF daily, Fenok Edge daily, and Fenok Edge KRX daily must pass `npm --prefix 100xfenok-next run qa:fenok-edge-readiness` before committing.
- `qa:fenok-edge-readiness` includes `qa:fenok-daily-accumulation`, a no-fetch truth report that fails only on unsafe public/daily/gated claims.
- `qa:fenok-edge-readiness` also includes `qa:fenok-s0-source-gaps`, a no-fetch S0 source-gap audit that classifies FINRA/OCC missing rows into collection candidates vs universe-mapping policy work.
- `qa:fenok-edge-readiness` includes `qa:fenok-occ-options`, a no-fetch unit/plan test for OCC selector, request budget, and no-record availability evidence handling.
- `qa:fenok-edge-readiness` includes `qa:fenok-s1-promotion-gate`, a no-fetch check that the durable non-public S1 promotion gate artifact can be regenerated without mutating S0/public outputs.
- Existing build scripts still run `qa:fenok-edge-readiness` before runtime/static/Cloudflare builds.

## Daily Truth Table

Current local snapshot:

| Layer | Current stage | Scheduled cadence | Current backlog / next-run exposure | Remaining blocker |
| --- | --- | --- | --- | --- |
| S0 active stock scoring | PUBLIC + DAILY + GATED under current Korea+US S0 scope | `fenok-edge-krx-daily.yml` runs KST Mon-Fri 19:30 for bounded KRX private daily fetch; `fenok-edge-daily.yml` runs KST Tue-Sat 09:30, refreshing FINRA 7-day-to-yesterday and one rolling OCC batch | 1,066 scored/public stocks; current S0 daily/gated source scope is 975 Korea+US rows, with 91 HKEX/SSE/SZSE rows explicitly excluded until a separate Asia daily-source workstream exists; KRX 338/338, FINRA metric-ready 579/579 for active plain-US rows, OCC source-ready 579/579 (`573` options-activity rows + `6` both-side no-record no-listed-options evidence); strict `qa:fenok-s0-daily-gated` is green | none for current strict S0; US_CLASS/non-plain/class-share and Asia lanes remain expansion work |
| S1 stock candidates | NORMALIZED / JOINED_READY staging, not scored | YF scheduled branch processes one rolling shard per run, capped at 140; scheduled StockAnalysis stock-financial fetches remain disabled | 1,178 normalized stock candidates, 1,066 scored/public stocks, 112 promotion-audit gap; current joined gate is 108 joined-ready and 4 blocked; blocker counts are `market_currency_country_scope=3`, `evidence_families_min3=1` | not scored/public/daily/gated as expanded stock coverage; remaining joined blockers are DAY, HOLX, MMC, STRC |
| S3 ETF lane | PUBLIC surface, not DAILY/GATED | YF scheduled branch processes ETF history gaps through one rolling shard per run, capped at 140; StockAnalysis scheduled branch backfills up to 40 ETF details per run | 5,301 normalized ETF candidates; 4,484 eligible vanilla ETFs scored in the separate ETF lane after classification plus conservative heuristic exclusions; named ETF gate verifies the compact public summary mirror, ETF signal API route, and ETF detail UI card; generated admin readiness evidence is `data/admin/fenok-edge-etf-daily1y-readiness.json` with `4484 = 3703 complete + 244 fetchable + 537 inception-limited`; exact fetchable ticker plan is `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json` with 244 tickers / 3 bounded batches at 120 each | `daily=false`, `gated=false`, `public_done_claim_allowed=false`; fetchable 1Y continuity gaps still block ETF paid-ready wording |

Operational command:

```bash
npm --prefix 100xfenok-next run qa:fenok-daily-accumulation
npm --prefix 100xfenok-next run qa:fenok-etf-daily1y-readiness
npm --prefix 100xfenok-next run qa:fenok-occ-options
npm --prefix 100xfenok-next run qa:fenok-s0-source-gaps
npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated
```

The command reads existing derived JSON only. It does not fetch, write, promote S1 rows, or compute ETF scores. ETF `done` wording is allowed only when the compact public surface, freshness gate, and no-fetchable-required-history gate are true together.

Operator readout rule:
- Each S0/S1/S3 row prints `status: sources=[...] blocking_gates=... done_claim_allowed=...`.
- Treat `sources=[...]` as the latest available derived source dates/timestamps, not as paid-ready proof.
- If `blocking_gates` is non-empty or `done_claim_allowed=false`, do not call that layer PUBLIC + DAILY + GATED.
- `active S0 evidence` shows the fail-closed blockers that must clear before `daily` or `gated` can flip; for the current S0 Korea+US scope this evidence is now green.
- The active S0 coverage index now carries derived blocker evidence directly under `public_scoring_readiness.tracks[].blocking_evidence`, so operators can see the FINRA/OCC/Asia gap counts without reading raw/private manifests.
- The active/public scoring universe remains 1,066. The current S0 daily/gated source scope is explicitly Korea+US only: 975 eligible rows (`US`/`US_CLASS` 637 + `KRX`/`KOSDAQ` 338), with 91 HKEX/SSE/SZSE rows excluded from this daily gate rather than counted as a hidden fetch blocker.
- The S0 source-gap audit is the action splitter for those blockers: FINRA readiness now uses active plain-US metric-ready rows (`market=US`) and is 579/579. The old row-existence diagnostic remains 587/637, with 50 `US_CLASS` foreign-suffix rows and eight low-confidence placeholders tracked as mapping/semantic evidence, not FINRA refetch work.
- OCC source-ready readiness is 579/579 for active plain-US rows: 573 rows have options-activity proxy output, and 6 both-side `no_record` rows now count as no-listed-options source-ready evidence without fabricating options activity. The legacy 64-row activity diagnostic remains visible as expansion evidence: 56 non-US suffix `US_CLASS` mapping/denominator rows, 2 Berkshire class-share symbol-form rows, and the 6 source-ready no-listed-options rows.
- Asia ex-Taiwan is no longer allowed to masquerade as an S0 daily blocker. It stays visible as explicit exclusion evidence; an all-1,066 daily/gated claim requires a separate HKEX/SSE/SZSE source lane.
- `ETF evidence` separates public surface proof from `daily`/`gated`; current 1Y continuity evidence still has fetchable gaps, so ETF paid-ready wording stays blocked even though the compact public surface is present.
- `data/admin/fenok-edge-etf-daily1y-readiness.json` is the generated S3 daily 1Y evidence, and `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json` is the exact no-fetch 244-ticker StockAnalysis daily-1Y blocker plan after five bounded live batches plus one explicit YF fallback residual batch reduced fetchable gaps `584 -> 518 -> 441 -> 398 -> 315 -> 275 -> 244`. Both must remain admin-only; `sync-static-overrides` removes the readiness public mirror and `qa:fenok-public-guard` forbids `public/data/admin/fenok-edge-etf-daily1y-readiness.json` and `public/data/admin/fenok-edge-etf-daily1y-fetchable-plan.json`.
- `scripts/fetch-stockanalysis.py --incremental-etf-backfill --incremental-etf-only --history-gaps-only --required-history-periods daily_1y --incremental-etf-limit 120` now treats `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json` as the exact dispatch source for this S3 blocker: it selects 120 from the 244 scored-ETF fetchable rows and does not broaden into generic missing/fallback/stale ETF retries.
- The strict goal gate remains `npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated`; it must stay green before any current S0 PUBLIC + DAILY + GATED wording is used.

## Resource Controls

- Current resource controls are per-collector throttles, not a full lane
  governor. They keep individual jobs bounded, while the load-aware collection
  lane above defines the next coordination layer.
- YF daily schedule is shard-limited and history-gap-limited.
- YF daily ETF initial fill is expected to take multiple scheduled runs because each run processes one rolling shard capped at 140 candidates; large history-gap sets require repeated shard cycles before clearing. After gaps shrink, `history_gaps_only` and `max_age_hours` keep runs bounded; newly launched ETFs can remain inception-limited without blocking the ETF lane.
- `scripts/write-fenok-etf-daily1y-readiness.mjs --check` persists the S3 admin-only readiness artifact plus the exact fetchable plan, validates the count equation against the ETF signal summary, the StockAnalysis history-gap report, and the coverage index, and records that local YF-only history would over-select 4,113 scored ETFs. It does not fetch or write public files.
- S1 stock candidates are data-fill candidates only. `stock_action_index`, `fenok_signals`, and public stock scoring remain S0-only until a separate promotion/scoring-chain contract lands.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --scoring-contract-report --check` is the first S1 scoring-chain contract artifact. It is stdout-only, non-public, non-daily, non-gated, keeps all score outputs null, and does not mutate `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --score-preview-report --check` adds the next non-public S1 preview step. It uses the shared S0 scoring core, emits only stdout preview rows for joined-ready S1 stocks, keeps missing/unsupported axes explicit as `null` / `미확인`, and still does not mutate public S0, `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --promotion-gate-plan-report --check` adds the next non-public S1 promotion gate plan. It turns the 108 joined-ready preview rows into shadow-candidate-only promotion rows, keeps the 4 blocked rows as explicit repair plans, and still writes no `stock_action_index`, `fenok_signals`, or public mirror output.
- `scripts/write-fenok-s1-promotion-gate-plan.mjs --check` persists that S1 promotion gate plan to `data/admin/fenok-s1-stock-promotion-gate-plan.json` as admin-only derived evidence. It still writes no S0 scoring file, no `fenok_signals`, and no public mirror.
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

KRX now has a scheduled private daily fetch path, and the current S0 Korea+US source scope is green. The coverage index counts only the latest non-empty KRX stock/KOSDAQ issuer daily proof, and `qa:fenok-edge-readiness` plus the strict `qa:fenok-s0-daily-gated` gate remain the source of truth for any PUBLIC + DAILY + GATED claim.

- Strict S0 is green when active stock count and track denominator are both 1,066 and `active_stock_scoring_current` has `requirements.daily=true`, `requirements.gated=true`, `readiness_status=ready`, and `public_done_claim_allowed=true`.
- Current daily proof: source/proxy rows are explicitly `not_public_scoring`; KRX covers 338/338 Korea rows, FINRA metric-ready covers 579/579 active plain-US rows, OCC source-ready covers 579/579 active plain-US rows, and the latest bounded US run remains a diagnostic reference only. The 91 Asia ex-Taiwan rows are explicit exclusion evidence for the current 975-row Korea+US daily scope; they must move into a new HKEX/SSE/SZSE source lane before any all-1,066 daily-source claim.
- Current gated proof: the fail-closed promotion rule now turns complete daily evidence into `requirements.daily=true` and `requirements.gated=true` only after stale, missing, empty-source, raw-private, and public-mirror checks pass.
- If `qa:fenok-s0-daily-gated` turns red again, any S0 wording must immediately fall back to "PUBLIC, not DAILY/GATED" until the gate is repaired.
