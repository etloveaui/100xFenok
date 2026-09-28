# Fenok ETF Signals Contract v0.1 - 2026-06-29

## Scope

ETF signals are a separate lane from stock signals. ETF rows must not increase stock coverage or leak into `fenok_signals.json`.

## Current Public State

- `data/computed/fenok_etf_signals.json` is the internal ETF lane payload.
- `data/computed/fenok_etf_signals_summary.json` is the compact public summary.
- `coverage.scored_public_etf` is now non-zero for eligible vanilla ETFs.
- Current local scored denominator: 4,431 eligible vanilla ETFs out of 5,580 collected ETF candidates.
- ETF rows must remain absent from `data/computed/fenok_signals.json`.
- UI/API consumption and a public summary mirror are now verified by the named ETF gate, so the coverage index can hold `public=true`.
- The full scored-ETF lane is PUBLIC/DAILY/GATED on the exact `4,431` scored eligible denominator: `4,431 = 3,642 complete + 0 fetchable + 740 inception-limited + 49 terminal-limited`. The two broader full-primary gaps, `FEAT` and `FIVY`, sit outside this exact scored plan and remain visible diagnostic/backfill work.
- ETF Core Daily Basket is a separate ETF service DAILY/GATED sublane with its own selected denominator. Current local regeneration is `1,580` structural candidates -> `99` selected core refresh tickers, `99` fresh and `0` stale, so `etf_core_daily_basket_ready=true`; this result does not set or clear full S3.
- This is not a full-universe paid-ready ETF claim. Paid-ready wording for broad ETF scoring still requires explicit owner approval of the product scope; full scored-lane and Core Basket readiness remain separately named claims.

## Signal Families

| Signal | Inputs | Public label | Score logic |
|---|---|---|---|
| `cost_efficiency` | expense ratio percentile within category | Cost efficiency | Category percentile of inverse expense ratio; fallback to global when category has fewer than 3 rows. |
| `liquidity` | AUM + average dollar volume | Liquidity | Average of global AUM percentile and 63-day average dollar-volume percentile. |
| `tracking_quality` | beta vs benchmark, history continuity | Tracking quality | Average of beta-closeness-to-1 and 1Y history continuity. |
| `momentum_trend` | 1M/YTD/1Y total returns | Momentum | Average of available global return percentiles. |
| `risk_adjusted_momentum` | 1Y return / annualized volatility | Risk-adjusted momentum | Global percentile of return divided by annualized volatility. |
| `income` | dividend yield | Income | Category percentile of dividend yield; fallback to global when needed. |
| `diversification` | holdings count, top-10 concentration, sector/country breadth | Diversification | Average of available breadth and concentration sub-scores. |

`classification_risk` was removed in formula
`fenok-etf-signals-v0.3-remove-classification-risk`: the current score rows
exclude leveraged/inverse/single-stock ETFs before scoring, so the axis could
only emit a constant `100`. Beta and expense ratio already belong to tracking
quality and cost efficiency and must not be double-counted as classification
risk. A future cross-class comparison requires a separate all-candidate
classification catalog and owner-approved schema.

## Current Coverage

| Signal | Non-null rows / 4,526 | Note |
|---|---:|---|
| `cost_efficiency` | 4,411 | Slow-changing, weekly refresh acceptable. |
| `liquidity` | 4,446 | ADV depends on daily history; Core Basket is the service refresh target, while full ETF history remains a rolling diagnostic/backfill lane. |
| `tracking_quality` | 4,473 | Missing beta/history creates null sub-score, not zero. |
| `momentum_trend` | 4,084 | Explicit 1Y return is the main gap. |
| `risk_adjusted_momentum` | 3,284 | Largest gap; needs return plus daily-history volatility. |
| `income` | 3,697 | Non-dividend ETFs can legitimately be null. |
| `diversification` | 4,474 | Holdings/sector/country fields are periodic, not daily. |

## Public Surface

- Raw full rows stay private/internal. The compact public summary exposes ticker, display name, asset type, category, AUM, expense ratio, dividend yield, beta, derived 0-100 scores, and scored-signal count.
- Missing values are excluded from present-axis coverage and never plotted as zero.
- Leveraged, inverse, single-stock, and single-stock/concentrated derivative-income ETFs are collected but excluded from the vanilla score denominator. The exclusion gate uses source classification plus conservative text/URL heuristics for known classification misses, including YieldMax/WeeklyPay/YieldBOOST/Option Income Strategy style funds. Because those rows are outside the scored denominator, no classification-safety score is published for the remaining vanilla-only rows.

## Output Files

- `data/computed/fenok_etf_signals.json` - full internal ETF signal payload.
- `data/computed/fenok_etf_signals_summary.json` - compact public ETF signal summary.
- `data/computed/etf_action_index.json` - internal ETF action-index preview. Derived composite score per eligible vanilla ETF; no public mirror.
  - schema `3`, formula `fenok-etf-action-index-v0.2-seven-signal-source`;
    records `source_formula_version` and keeps zero-signal rows honest as
    `signal_score=null`, `action_score=null`, `low_evidence=true`; such rows are
    excluded from score summaries and rankings.
- `data/admin/fenok-etf-core-daily-basket.json` - admin-only ETF Core Daily Basket manifest and refresh target list; no public mirror.
- `data/computed/fenok_etf_core_daily_basket_summary.json` - compact public-safe Core Basket summary.

## Gates

- `npm --prefix 100xfenok-next run qa:fenok-etf-signal-gate`
  - requires ETF payload/summary counts to match `coverage.scored_public_etf`
  - requires the compact public summary mirror to match the internal summary counts
  - requires the ETF signal API route and ETF detail UI card to exist
  - rejects a public full ETF signal payload mirror
  - requires every ETF row to carry `asset_type=etf`
  - rejects excluded leveraged/inverse/single-stock leakage into the vanilla score rows
  - requires no ETF row leakage into the stock signal lens
- `npm --prefix 100xfenok-next run qa:fenok-etf-action-index-gate`
  - requires the ETF action-index preview to regenerate from `data/computed/fenok_etf_signals_summary.json`
  - rejects any public mirror of `data/computed/etf_action_index.json`
  - requires row counts to match the source ETF signal payload
  - validates composite scores are 0..100 and coverage ratios are 0..1
  - requires action-index formula/schema and source formula lineage to match
    the seven-signal ETF source
- `npm --prefix 100xfenok-next run qa:fenok-etf-daily1y-dispatch-plan-gate`
  - requires the private dispatch plan to remain `owner_gated=true`
  - rejects any public mirror of the dispatch plan
  - requires shard size <= 120 and total planned tickers to match the exact admin fetchable-plan ticker count
  - requires workflow inputs `history_gaps_only=true`, `required_history_periods=daily_1y`, `incremental_etf_limit=120`
  - rejects any `done`, `daily_ready`, `gated_ready`, or `public_done_claim_allowed` claim
- `npm --prefix 100xfenok-next run qa:fenok-etf-core-daily-basket`
  - regenerates the Core Basket from `fenok_etf_signals_summary`, `etf_action_index`, ETF detail coverage, `new_etfs`, and per-ETF detail files
  - rejects public mirrors of the admin manifest
  - fails closed when selected Core Basket rows need refresh
  - requires no New ETF Radar row to enter the core basket
- `npm --prefix 100xfenok-next run qa:fenok-etf-new-radar-gate`
  - requires the source/public `new_etfs` surface to match
  - requires New ETF Radar rows to remain `watchlist_only` with `core_candidate_allowed=false`
  - requires Core Basket admin/summary/public-summary rows to have zero overlap with the New ETF Radar ticker set
  - requires the `new_etf_radar_only` exclusion count to match the current overlap between New ETF Radar and the scored ETF signal universe
- `npm --prefix 100xfenok-next run qa:fenok-edge-readiness`
  - includes the ETF signal gate, ETF action-index gate, Core Basket gate, New ETF Radar gate, and ETF daily 1Y dispatch-plan gate
  - fails closed if the ETF public surface, scored-lane freshness/count equation/exact daily-1Y gate, separately named Core Basket track, New ETF Radar watchlist-only contract, action-index privacy gate, or dispatch-plan privacy gate regresses; broader full-primary gaps remain required visible diagnostics but do not block full S3

## Readiness Flip Criteria

- `public=true` after the ETF route/card, compact public summary, and public mirror are all verified by `qa:fenok-etf-signal-gate`; file presence alone is not enough.
- Full `etf_scoring_lane.daily=true` is determined only from evidence measured over the scored eligible ETF denominator: the ETF signal and history artifacts are fresh, the exact scored-ETF daily-1Y fetchable gap is zero, the exact-plan count equation matches the scored denominator, and the scored-lane public/QA gates agree. Broader full-primary gaps outside the scored denominator remain visible diagnostic/backfill work and do not block this scored-lane flag.
- Core Daily Basket daily readiness is reported only through its separate `etf_core_daily_basket_ready=true` track, with `selected_count >= 75`, `stale_selected_count=0`, fresh generated artifacts, and the Core Basket QA gate.
- Core Daily Basket gated readiness requires its own gate plus the general edge readiness gate to pass; neither result can alter full `etf_scoring_lane.daily/gated`.
- `public_done_claim_allowed=true` only when `source_available`, `normalized`, `joined_to_target_universe`, `scored`, `public`, `daily`, and `gated` are all true.
- Current status: the full ETF scoring lane is PUBLIC/DAILY/GATED because the exact scored-ETF daily-1Y fetchable gap is zero and its scored-denominator gates agree. The broader full-primary report still has two fetchable rows, `FEAT` and `FIVY`, outside the exact scored plan; they remain explicit diagnostic/backfill work and do not alter full S3 readiness. ETF Core Daily Basket readiness is reported separately.

## Core Daily Basket Sublane

- Purpose: provide a separately measured service DAILY/GATED ETF set without redefining the full scored-lane denominator.
- Readiness label: `etf_core_daily_basket_ready`. Core Daily Basket is a separate ETF service DAILY/GATED sublane; its readiness must not set, clear, or substitute for full `etf_scoring_lane.daily/gated` in either direction.
- Current generated selection: `1,580` structural candidates -> `99` selected core refresh tickers (`50` Equity, `35` Fixed Income, `2` Alternatives, `6` Asset Allocation, `6` Commodity; Currency has no selected row).
- Current readiness: `fresh_selected_count=99`, `stale_selected_count=0`, blockers `[]`; therefore `core_daily_basket_ready=true`. The selection is data-driven and is not required to equal 100; the contract floor is `selected_count >= 75`.
- Exclusions by default: leveraged, inverse, single-stock, single-stock/concentrated derivative-income strategy, low-confidence classification, broken-history rows, and stale quote/volume rows.
- Candidate buckets: broad US equity, sector, factor/style/dividend, international, fixed income, commodity/currency, alternatives, and asset-allocation funds.
- Minimum proof before inclusion:
  - detail/classification present and not low-confidence;
  - daily history has at least `200` rows unless an explicit inception-limited exception is recorded;
  - non-stale quote and volume evidence exists;
  - enough scored ETF signal coverage exists for the public summary;
  - liquidity/AUM floors are met or the ticker is an owner-pinned exception with the exception recorded.
- New ETFs enter the New ETF Radar first. They are not core by default until detail, history, classification, and scoring gates pass; `qa:fenok-etf-new-radar-gate` keeps this watchlist-only contract fail-closed.
- Gate: `npm --prefix 100xfenok-next run qa:fenok-etf-core-daily-basket`.
- Automation path: default StockAnalysis ETF refresh now loads `data/admin/fenok-etf-core-daily-basket.json` and prioritizes `daily_refresh_universe.tickers` before the legacy focus ETF list.

## Daily Data Prerequisite

- StockAnalysis detail coverage supplies slower ETF fields such as expense ratio, AUM, dividend yield, holdings, classification, and fund metadata.
- The StockAnalysis scheduled workflow rebuilds the Core Basket after ETF detail/history work and mirrors only the compact Core Basket summary to public data.
- Daily ETF scoring quality still requires fresher price/volume and 1Y return history. The weekday YF schedule therefore runs with:
  - `profile=etf`
  - `stockanalysis_etfs=true`
  - `history_gaps_only=true`
  - one rolling shard per schedule, currently capped at 140 tickers per run
- The `etf_no_fetchable_daily_1y_gap` gate counts rows inside the exact scored ETF plan with fewer than 200 daily history rows, excluding inception-limited and recent provider-terminal rows. It is currently `0`, so the scored-denominator gate is green. The two full-primary rows, `FEAT` and `FIVY`, are outside this exact plan and remain visible only in the separate diagnostic/backfill output.
- For StockAnalysis S3 backfill, `--history-gaps-only --required-history-periods daily_1y` must stay bound to `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json`; it is not a generic ETF missing/fallback retry sweep.
- `qa:fenok-etf-daily1y-readiness` must pass before any full-universe daily-readiness claim; it checks the generated count equation and keeps the artifact admin-only.
- This is a bounded rotating shard for scored-universe health, independent of the separately reported Core Basket service refresh gate.

## Owner-Gated Daily 1Y Dispatch Plan

- A separate private plan wraps the exact admin fetchable-plan tickers into bounded owner-approved dispatch shards.
- Output: `_private/admin/fenok-etf-daily1y-dispatch-plan.json` (gitignored, never mirrored).
- Builder: `npm --prefix 100xfenok-next run build:fenok-etf-daily1y-dispatch-plan`.
- Gate: `npm --prefix 100xfenok-next run qa:fenok-etf-daily1y-dispatch-plan-gate`.
- Current selector count: `2` fetchable scored ETFs, `770` inception-limited, `70` terminal-limited, `3,684` complete; the exact private plan contains `RTOO` and `TKNZ` and remains within the `<=120`-ticker shard bound.
- The dispatch plan is owner-gated and private. The two current fetchable rows are bounded full-universe diagnostic/backfill work, not a public raw artifact or a Core Basket service blocker.
- 2026-07-09 local preflight: `qa:market-audit` reports `pass` with `no_actionable_plan=1`; remaining rows are inception-limited or provider-terminal/cooldown tracked. Verified locally: `qa:market-audit`, `qa:history-gap -- --write-report --required-history-periods daily_1y`, `qa:data-graph`, `qa:data-freshness`, and full `qa:fenok-edge-readiness`.

## Remaining Work

1. Keep the Core Basket schedule/gate green after clearing the current `stale_selected_count=0`, and keep the gate fail-closed for future regressions.
2. Keep New ETF Radar as watchlist-only until detail/history/classification/scoring gates pass.
3. Keep full ETF daily 1Y continuity as a rolling universe-health/backfill lane; do not make all `4,526` ETFs complete-history rows a service launch blocker.
4. Use the owner-gated private dispatch plan for bounded full-universe catch-up only when fetchable rows reappear; the current plan is empty.
5. Keep the ETF lane separate from stock scoring and denominator claims.
6. Keep ETF freshness evidence wired into fail-closed gated readiness.
7. Keep `PUBLIC + DAILY + GATED` as the only paid-ready completion claim.
