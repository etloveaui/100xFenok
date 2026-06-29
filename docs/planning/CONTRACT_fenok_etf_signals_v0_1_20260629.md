# Fenok ETF Signals Contract v0.1 - 2026-06-29

## Scope

ETF signals are a separate lane from stock signals. ETF rows must not increase stock coverage or leak into `fenok_signals.json`.

## Current Public State

- `data/computed/fenok_etf_signals.json` is the internal ETF lane payload.
- `data/computed/fenok_etf_signals_summary.json` is the compact public summary.
- `coverage.scored_public_etf` is now non-zero for eligible vanilla ETFs.
- Current local scored denominator: 4,484 eligible vanilla ETFs out of 5,333 StockAnalysis ETF records.
- ETF rows must remain absent from `data/computed/fenok_signals.json`.
- This is still not a paid-ready ETF product claim until DAILY + GATED are proven.

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
- Future: `data/computed/etf_action_index.json` if the action-index layer is separated from the signal builder.

## Gates

- `npm --prefix 100xfenok-next run qa:fenok-etf-signal-gate`
  - requires ETF payload/summary counts to match `coverage.scored_public_etf`
  - requires every ETF row to carry `asset_type=etf`
  - rejects excluded leveraged/inverse/single-stock leakage into the vanilla score rows
  - requires no ETF row leakage into the stock signal lens
- `npm --prefix 100xfenok-next run qa:fenok-edge-readiness`
  - includes the ETF gate
  - still does not claim ETF is PUBLIC + DAILY + GATED

## Daily Data Prerequisite

- StockAnalysis detail coverage supplies slower ETF fields such as expense ratio, AUM, dividend yield, holdings, classification, and fund metadata.
- Daily ETF scoring quality still requires fresher price/volume and 1Y return history. The weekday YF schedule therefore runs with:
  - `profile=etf`
  - `stockanalysis_etfs=true`
  - `history_gaps_only=true`
  - one rolling shard per schedule, currently capped at 140 tickers per run
- This is a bounded rotating shard, not a true all-ETF daily refresh.

## Remaining Blockers

1. Prove a daily all-ETF or eligible-ETF price/history refresh path.
2. Keep the ETF lane separate from stock scoring and denominator claims.
3. Add UI consumption for ETF signals without implying stock-equivalent scores.
4. Keep `PUBLIC + DAILY + GATED` as the only paid-ready completion claim.
