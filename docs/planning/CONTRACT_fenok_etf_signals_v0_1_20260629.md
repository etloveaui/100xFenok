# Fenok ETF Signals Contract v0.1 - 2026-06-29

## Scope

ETF signals are a separate lane from stock signals. ETF rows must not increase stock coverage or leak into `fenok_signals.json`.

## Current Public State

- `data/computed/fenok_etf_signals.json` is the internal ETF lane payload.
- `data/computed/fenok_etf_signals_summary.json` is the compact public summary.
- `coverage.scored_public_etf` is now non-zero for eligible vanilla ETFs.
- Current local scored denominator: 4,484 eligible vanilla ETFs out of 5,333 StockAnalysis ETF records.
- ETF rows must remain absent from `data/computed/fenok_signals.json`.
- UI/API consumption and a public summary mirror are now verified by the named ETF gate, so the coverage index can hold `public=true`.
- The coverage index still holds `daily=false` and `gated=false`: five bounded live batches plus one explicit YF fallback residual batch reduced fetchable daily 1Y continuity gaps `584 -> 518 -> 441 -> 398 -> 315 -> 275 -> 244`; fetchable required-history gaps are now `0`.
- ETF Core Daily Basket is a separate planned sublane. It must not reuse the full `4,484` scored ETF denominator for a daily-ready claim.
- This is not a paid-ready ETF lane claim. Paid-ready requires PUBLIC + DAILY + GATED to be proven together for the separate `asset_type=etf` scoring lane.

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
| `classification_risk` | leveraged/inverse/single-stock flags | Classification risk | `100` for eligible vanilla ETFs; excluded ETFs are not scored in this lane. |

## Current Coverage

| Signal | Non-null rows / 4,484 | Note |
|---|---:|---|
| `cost_efficiency` | 4,378 | Slow-changing, weekly refresh acceptable. |
| `liquidity` | 4,349 | ADV depends on daily history; true all-ETF daily refresh remains a target. |
| `tracking_quality` | 4,415 | Missing beta/history creates null sub-score, not zero. |
| `momentum_trend` | 4,403 | Explicit 1Y return is the main gap. |
| `risk_adjusted_momentum` | 3,231 | Largest gap; needs return plus daily-history volatility. |
| `income` | 3,686 | Non-dividend ETFs can legitimately be null. |
| `diversification` | 4,415 | Holdings/sector/country fields are periodic, not daily. |
| `classification_risk` | 4,484 | Static-ish classification lane plus conservative heuristic exclusion. |

## Public Surface

- Raw full rows stay private/internal. The compact public summary exposes ticker, display name, asset type, category, AUM, expense ratio, dividend yield, beta, derived 0-100 scores, and scored-signal count.
- Missing values are excluded from present-axis coverage and never plotted as zero.
- Leveraged, inverse, and single-stock ETFs are collected but excluded from the vanilla score denominator. The exclusion gate uses source classification plus conservative text/URL heuristics for known classification misses.

## Output Files

- `data/computed/fenok_etf_signals.json` - full internal ETF signal payload.
- `data/computed/fenok_etf_signals_summary.json` - compact public ETF signal summary.
- `data/computed/etf_action_index.json` - internal ETF action-index preview. Derived composite score per eligible vanilla ETF; no public mirror.

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
- `npm --prefix 100xfenok-next run qa:fenok-etf-daily1y-dispatch-plan-gate`
  - requires the private dispatch plan to remain `owner_gated=true`
  - rejects any public mirror of the dispatch plan
  - requires shard size <= 120 and total planned tickers to match the exact admin fetchable-plan ticker count
  - requires workflow inputs `history_gaps_only=true`, `required_history_periods=daily_1y`, `incremental_etf_limit=120`
  - rejects any `done`, `daily_ready`, `gated_ready`, or `public_done_claim_allowed` claim
- `npm --prefix 100xfenok-next run qa:fenok-edge-readiness`
  - includes the ETF signal gate, ETF action-index gate, and ETF daily 1Y dispatch-plan gate
  - fails closed if the ETF public surface, freshness evidence, fetchable required-history gate, fetchable daily 1Y history-continuity gate, action-index privacy gate, or dispatch-plan privacy gate regresses

## Readiness Flip Criteria

- `public=true` after the ETF route/card, compact public summary, and public mirror are all verified by `qa:fenok-etf-signal-gate`; file presence alone is not enough.
- `daily=true` only after coverage index consumes ETF freshness evidence, including ETF signal timestamp/history-gap status, a bounded max-age rule, and zero fetchable daily 1Y history gaps among scored ETFs.
- `gated=true` only after `qa:fenok-etf-signal-gate` and the ETF freshness gate are both wired into the same fail-closed readiness track.
- `public_done_claim_allowed=true` only when `source_available`, `normalized`, `joined_to_target_universe`, `scored`, `public`, `daily`, and `gated` are all true.
- Current status is PUBLIC surface only, not DAILY/GATED. The current report has `fetchable_required_history=0`, but the scored ETF lane still has fetchable daily 1Y continuity gaps, so `daily=false`, `gated=false`, and `public_done_claim_allowed=false`. The durable generated evidence is `data/admin/fenok-edge-etf-daily1y-readiness.json`, currently proving `4484 = 3703 complete + 244 fetchable + 537 inception-limited` for the scored ETF denominator.

## Core Daily Basket Sublane (Planned)

- Purpose: provide a smaller ETF set that can truthfully be kept daily-fresh before the full ETF lane is daily-ready.
- Readiness label: `etf_core_daily_basket_ready`; do not flip full `S3 ETF daily_ready`.
- Exclusions by default: leveraged, inverse, single-stock, low-confidence classification, broken-history rows, and stale quote/volume rows.
- Candidate buckets: broad US equity, sector, factor/style/dividend, international, fixed income, commodity/currency, alternatives, and asset-allocation funds.
- Minimum proof before inclusion:
  - detail/classification present and not low-confidence;
  - daily history has at least `200` rows unless an explicit inception-limited exception is recorded;
  - non-stale quote and volume evidence exists;
  - enough scored ETF signal coverage exists for the public summary;
  - liquidity/AUM floors are met or the ticker is an owner-pinned exception with the exception recorded.
- New ETFs enter the New ETF Radar first. They are not core by default until detail, history, classification, and scoring gates pass.
- Planned gate: `npm --prefix 100xfenok-next run qa:fenok-etf-core-daily-basket`.

## Daily Data Prerequisite

- StockAnalysis detail coverage supplies slower ETF fields such as expense ratio, AUM, dividend yield, holdings, classification, and fund metadata.
- Daily ETF scoring quality still requires fresher price/volume and 1Y return history. The weekday YF schedule therefore runs with:
  - `profile=etf`
  - `stockanalysis_etfs=true`
  - `history_gaps_only=true`
  - one rolling shard per schedule, currently capped at 140 tickers per run
- The `etf_no_fetchable_daily_1y_gap` gate counts scored ETFs with fewer than 200 daily history rows, excluding inception-limited funds. Until this count is zero, `daily=false`.
- For StockAnalysis S3 backfill, `--history-gaps-only --required-history-periods daily_1y` must stay bound to `data/admin/fenok-edge-etf-daily1y-fetchable-plan.json`; it is not a generic ETF missing/fallback retry sweep.
- `qa:fenok-etf-daily1y-readiness` must pass before any ETF daily-readiness claim; it checks the generated count equation and keeps the artifact admin-only.
- This is a bounded rotating shard, not a true all-ETF daily refresh.

## Owner-Gated Daily 1Y Dispatch Plan

- A separate private plan wraps the exact admin fetchable-plan tickers into bounded owner-approved dispatch shards.
- Output: `_private/admin/fenok-etf-daily1y-dispatch-plan.json` (gitignored, never mirrored).
- Builder: `npm --prefix 100xfenok-next run build:fenok-etf-daily1y-dispatch-plan`.
- Gate: `npm --prefix 100xfenok-next run qa:fenok-etf-daily1y-dispatch-plan-gate`.
- Current clean-base selector count: `244` fetchable scored ETFs, `537` inception-limited, `3703` complete, `3` shards at `<=120` tickers.
- The dispatch plan has `owner_gated=true`, `network=none`, and no done/daily/gated claim. Running the actual external StockAnalysis backfill still requires explicit owner approval.

## Remaining Work

1. Define and gate the ETF Core Daily Basket before any deploy/package claim that implies ETF daily service readiness.
2. Keep the scheduled ETF freshness loop running so new ETFs move from fetchable gaps to complete, inception-limited, or radar-only status.
3. Prove a daily all-ETF or eligible-ETF price/history refresh path beyond the current bounded rotating shard.
4. Use the owner-gated private dispatch plan for the next bounded daily 1Y catch-up run; do not flip full ETF `daily` or `gated` until the fetchable gap count reaches zero.
5. Keep the ETF lane separate from stock scoring and denominator claims.
6. Keep ETF freshness evidence wired into fail-closed gated readiness.
7. Keep `PUBLIC + DAILY + GATED` as the only paid-ready completion claim.
