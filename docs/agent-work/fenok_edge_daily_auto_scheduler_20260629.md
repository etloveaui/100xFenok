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
- YF daily, Fenok Edge daily, and Fenok Edge KRX daily must pass `npm --prefix 100xfenok-next run qa:fenok-edge-readiness` before committing.
- `qa:fenok-edge-readiness` includes `qa:fenok-daily-accumulation`, a no-fetch truth report that fails only on unsafe public/daily/gated claims.
- `qa:fenok-edge-readiness` also includes `qa:fenok-s0-source-gaps`, a no-fetch S0 source-gap audit that classifies FINRA/OCC missing rows into collection candidates vs universe-mapping policy work.
- Existing build scripts still run `qa:fenok-edge-readiness` before runtime/static/Cloudflare builds.

## Daily Truth Table

Current local snapshot:

| Layer | Current stage | Scheduled cadence | Current backlog / next-run exposure | Remaining blocker |
| --- | --- | --- | --- | --- |
| S0 active stock scoring | PUBLIC, not DAILY/GATED | `fenok-edge-krx-daily.yml` runs KST Mon-Fri 19:30 for bounded KRX private daily fetch; `fenok-edge-daily.yml` runs KST Tue-Sat 09:30, refreshing FINRA 7-day-to-yesterday and one rolling OCC batch | 1,066 scored/public stocks; KRX 338/338, FINRA 587/637, OCC 228/637, Asia ex-Taiwan 91 outside current daily-source workstream; strict `qa:fenok-s0-daily-gated` remains red | `finra_full_us_source_ready`, `occ_full_us_source_ready`, `no_asia_ex_taiwan_gap`, `daily_ready` |
| S1 stock candidates | NORMALIZED / JOINED_READY staging, not scored | YF scheduled branch processes one rolling shard per run, capped at 140; scheduled StockAnalysis stock-financial fetches remain disabled | 1,178 normalized stock candidates, 1,066 scored/public stocks, 112 promotion-audit gap; current joined gate is 108 joined-ready and 4 blocked; blocker counts are `market_currency_country_scope=3`, `evidence_families_min3=1` | not scored/public/daily/gated as expanded stock coverage; remaining joined blockers are DAY, HOLX, MMC, STRC |
| S3 ETF lane | PUBLIC surface, not DAILY/GATED | YF scheduled branch processes ETF history gaps through one rolling shard per run, capped at 140; StockAnalysis scheduled branch backfills up to 40 ETF details per run | 5,301 normalized ETF candidates; 4,484 eligible vanilla ETFs scored in the separate ETF lane after classification plus conservative heuristic exclusions; named ETF gate verifies the compact public summary mirror, ETF signal API route, and ETF detail UI card; current ETF detail continuity evidence is `daily_1y_fetchable=584`, `inception_limited=534` | `daily=false`, `gated=false`, `public_done_claim_allowed=false`; fetchable 1Y continuity gaps still block ETF paid-ready wording |

Operational command:

```bash
npm --prefix 100xfenok-next run qa:fenok-daily-accumulation
npm --prefix 100xfenok-next run qa:fenok-s0-source-gaps
```

The command reads existing derived JSON only. It does not fetch, write, promote S1 rows, or compute ETF scores. ETF `done` wording is allowed only when the compact public surface, freshness gate, and no-fetchable-required-history gate are true together.

Operator readout rule:
- Each S0/S1/S3 row prints `status: sources=[...] blocking_gates=... done_claim_allowed=...`.
- Treat `sources=[...]` as the latest available derived source dates/timestamps, not as paid-ready proof.
- If `blocking_gates` is non-empty or `done_claim_allowed=false`, do not call that layer PUBLIC + DAILY + GATED.
- `active S0 evidence` shows the fail-closed blockers that must clear before `daily` or `gated` can flip.
- The active S0 coverage index now carries derived blocker evidence directly under `public_scoring_readiness.tracks[].blocking_evidence`, so operators can see the FINRA/OCC/Asia gap counts without reading raw/private manifests.
- The S0 source-gap audit is the action splitter for those blockers: current FINRA missing 50 are all `US_CLASS` foreign-suffix rows, so they are mapping/denominator work rather than FINRA fetch work. Current FINRA row-existence coverage is 587/637, but strict metric-ready coverage is 579/637 because eight rows are low-confidence placeholders; the owner must choose and encode which criterion clears `finra_full_us_source_ready`.
- Current OCC missing 409 splits into 351 plain US underlyings that still need bounded OCC collection or explicit no-listed-options evidence, 56 non-US suffix `US_CLASS` rows that need mapping/denominator policy, and 2 Berkshire class-share symbols that need OCC symbol-form testing before being marked unavailable.
- `ETF evidence` separates public surface proof from `daily`/`gated`; current 1Y continuity evidence still has fetchable gaps, so ETF paid-ready wording stays blocked even though the compact public surface is present.
- The strict goal gate remains `npm --prefix 100xfenok-next run qa:fenok-s0-daily-gated`; it is expected to stay red until the S0 `daily` and `gated` requirements become true.

## Resource Controls

- YF daily schedule is shard-limited and history-gap-limited.
- YF daily ETF initial fill is expected to take multiple scheduled runs because each run processes one rolling shard capped at 140 candidates; large history-gap sets require repeated shard cycles before clearing. After gaps shrink, `history_gaps_only` and `max_age_hours` keep runs bounded; newly launched ETFs can remain inception-limited without blocking the ETF lane.
- S1 stock candidates are data-fill candidates only. `stock_action_index`, `fenok_signals`, and public stock scoring remain S0-only until a separate promotion/scoring-chain contract lands.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --scoring-contract-report --check` is the first S1 scoring-chain contract artifact. It is stdout-only, non-public, non-daily, non-gated, keeps all score outputs null, and does not mutate `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --score-preview-report --check` adds the next non-public S1 preview step. It uses the shared S0 scoring core, emits only stdout preview rows for joined-ready S1 stocks, keeps missing/unsupported axes explicit as `null` / `미확인`, and still does not mutate public S0, `stock_action_index`, `fenok_signals`, or public mirrors.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --promotion-gate-plan-report --check` adds the next non-public S1 promotion gate plan. It turns the 108 joined-ready preview rows into shadow-candidate-only promotion rows, keeps the 4 blocked rows as explicit repair plans, and still writes no `stock_action_index`, `fenok_signals`, or public mirror output.
- `scripts/audit-fenok-stock-promotion-candidates.mjs --blocked-unblock-diagnostics-report --check` keeps DAY/HOLX/MMC/STRC as blocker-only diagnostics with local source evidence and next repair targets; it still writes no `stock_action_index`, `fenok_signals`, or public mirror output.
- The S1 joined gate counts tickers present in the StockAnalysis corporate-action surface as the existing `stockanalysis` evidence family, deduped with StockAnalysis detail files. This removes DAY's evidence-family blocker but does not resolve DAY/HOLX/MMC identity scope.
- Blocked diagnostics expose `accepted_family_flags` separately from raw `source_flags`, so surface-only StockAnalysis evidence is visible without pretending the market_facts detail already has a StockAnalysis source flag.
- Blocked diagnostics and promotion plans also expose StockAnalysis corporate-action/alias policy evidence for DAY/HOLX/MMC. Acquired, delisted, or old-symbol rows remain diagnostics-only until an explicit terminal/alias policy exists; the audit must not copy MRSH identity into old ticker MMC or promote these rows by inference.
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

- Strict S0 red is a readiness-contract failure, not a denominator failure: active stock count and track denominator are both 1,066, but `active_stock_scoring_current` still has `requirements.daily=false`, `requirements.gated=false`, `readiness_status=not_ready`, and `public_done_claim_allowed=false`.
- Missing daily proof: source/proxy rows are explicitly `not_public_scoring`; KRX covers 338/338 Korea rows, FINRA covers 587/637 US rows, OCC covers 228/637 US rows, the latest bounded US run covers 8/637 reference tickers, and 91 Asia ex-Taiwan rows remain outside the current daily-source workstream.
- Missing gated proof: a fail-closed promotion rule still has to turn complete daily evidence into `requirements.daily=true` and `requirements.gated=true` only after stale, missing, empty-source, raw-private, and public-mirror checks pass.
- Until both proofs land, `qa:fenok-s0-daily-gated` should stay red and any S0 wording must remain "PUBLIC, not DAILY/GATED."
