# Fenok Edge Daily Auto Scheduler - 2026-06-29

## Intent

Make daily market-source refreshes accumulate without turning missing or stale data into a false done claim. The scheduler changes stay bounded, avoid raw private-data publication, and leave the existing readiness gates in the path before commits.

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

## Gates

- Fenok Edge daily rebuilds `data/admin/fenok-edge-coverage-index.json` after FINRA/OCC proxy refresh.
- Fenok Edge KRX daily updates `data/admin/fenok-edge-korea-krx-daily-index.json`, then rebuilds `data/admin/fenok-edge-coverage-index.json`.
- Fenok Edge daily then runs `npm --prefix 100xfenok-next run sync-static`.
- Fenok Edge daily and Fenok Edge KRX daily must pass `npm --prefix 100xfenok-next run qa:fenok-edge-readiness` before committing.
- `qa:fenok-edge-readiness` includes `qa:fenok-daily-accumulation`, a no-fetch truth report that fails only on unsafe public/daily/gated claims.
- Existing build scripts still run `qa:fenok-edge-readiness` before runtime/static/Cloudflare builds.

## Daily Truth Table

Current local snapshot:

| Layer | Current stage | Scheduled cadence | Current backlog / next-run exposure | Remaining blocker |
| --- | --- | --- | --- | --- |
| S0 active stock scoring | PUBLIC, not DAILY/GATED | `fenok-edge-krx-daily.yml` runs KST Mon-Fri 19:30 for bounded KRX private daily fetch; `fenok-edge-daily.yml` runs KST Tue-Sat 09:30, refreshing FINRA 7-day-to-yesterday and one rolling OCC batch | 1,066 scored/public stocks; strict `qa:fenok-s0-daily-gated` remains red | `active_stock_scoring_current.requirements.daily=false`, `gated=false` |
| S1 stock candidates | NORMALIZED / JOINED_READY staging, not scored | YF scheduled branch processes one rolling shard per run, capped at 140; scheduled StockAnalysis stock-financial fetches remain disabled | 1,178 normalized stock candidates, 1,066 scored/public stocks, 112 promotion-audit gap; current joined gate is 108 joined-ready and 4 blocked | not scored/public/daily/gated as expanded stock coverage; remaining joined blockers are DAY, HOLX, MMC, STRC |
| S3 ETF lane | SCORED, not PUBLIC/DAILY/GATED | YF scheduled branch processes ETF history gaps through one rolling shard per run, capped at 140; StockAnalysis scheduled branch backfills up to 40 ETF details per run | 5,301 normalized ETF candidates; 4,484 eligible vanilla ETFs scored in the separate ETF lane after classification plus conservative heuristic exclusions; ETF detail UI consumes the separate ETF signal route/card; StockAnalysis history report shows 12 required-history gaps, 1 fetchable, 11 inception-limited | public-daily-gated proof and gated readiness are not complete |

Operational command:

```bash
npm --prefix 100xfenok-next run qa:fenok-daily-accumulation
```

The command reads existing derived JSON only. It does not fetch, write, promote S1 rows, or compute ETF scores. If ETF score artifacts exist, it reports them as `SCORED` and still blocks any `done` wording until DAILY/GATED readiness is true.

## Resource Controls

- YF daily schedule is shard-limited and history-gap-limited.
- YF daily ETF initial fill is expected to take multiple scheduled runs because each run processes one rolling shard capped at 140 candidates; large history-gap sets require repeated shard cycles before clearing. After gaps shrink, `history_gaps_only` and `max_age_hours` keep runs bounded.
- S1 stock candidates are data-fill candidates only. `stock_action_index`, `fenok_signals`, and public stock scoring remain S0-only until a separate promotion/scoring-chain contract lands.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --scoring-contract-report --check` is the first S1 scoring-chain contract artifact. It is stdout-only, non-public, non-daily, non-gated, keeps all score outputs null, and does not mutate `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --score-preview-report --check` adds the next non-public S1 preview step. It uses the shared S0 scoring core, emits only stdout preview rows for joined-ready S1 stocks, keeps missing/unsupported axes explicit as `null` / `미확인`, and still does not mutate public S0, `stock_action_index`, `fenok_signals`, or public mirrors.
- StockAnalysis daily schedule is incremental-only for ETF detail plus core surfaces.
- Fenok Edge OCC daily schedule is batch-limited, request-limited, failure-thresholded, and sleep-throttled.
- Fenok Edge KRX daily schedule is one-day by default, max-call-limited, concurrency-limited, sleep-throttled, and fails closed on failed files or empty KOSPI/KOSDAQ issuer daily rows unless manually overridden.
- Fenok Edge skips GDELT/news by default in the daily workflow.
- Manual workflow dispatch exposes `plan_only`, `no_fetch`, KRX date/day/request controls, FINRA date overrides, and OCC batch/request controls.

## Public-Safe Write Policy

- Raw KRX/FINRA/OCC caches remain under `_private/`, which is ignored by git.
- Fenok Edge daily commits only derived JSON, coverage indexes, and generated route metadata.
- Ignored public computed mirrors are not force-added; they are regenerated by `sync-static` during build/runtime preparation.

## Remaining Gap

KRX now has a scheduled private daily fetch path, but this still does not make S0 paid-ready by itself. The coverage index counts only the latest non-empty KRX stock/KOSDAQ issuer daily proof, and `qa:fenok-edge-readiness` plus the strict `qa:fenok-s0-daily-gated` gate must remain the source of truth for PUBLIC + DAILY + GATED claims.
