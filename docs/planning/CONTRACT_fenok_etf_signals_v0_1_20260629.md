# Fenok ETF Signals Contract v0.1 - 2026-06-29

## Scope

ETF signals are a separate lane from stock signals. ETF data can be collected and validated before ETF scores are published, but ETF rows must not increase stock coverage or leak into `fenok_signals.json`.

## Current Public State

- `data/computed/fenok_etf_signals.json` exists as the internal ETF lane payload.
- `data/computed/fenok_etf_signals_summary.json` is the compact public summary.
- `coverage.scored_public_etf` must remain `0` until ETF scoring formulas are implemented deliberately.
- ETF rows must remain absent from `data/computed/fenok_signals.json`.

## Daily Data Prerequisite

- StockAnalysis detail coverage supplies slower ETF fields such as expense ratio, AUM, dividend yield, holdings, classification, and fund metadata.
- Daily ETF scoring also requires price/volume and 1Y return history. The weekday YF schedule therefore runs with:
  - `profile=etf`
  - `stockanalysis_etfs=true`
  - `history_gaps_only=true`
  - one rolling shard per schedule, currently capped at 140 tickers per run
- Initial ETF YF history fill is expected to take multiple scheduled runs and repeated shard cycles; scoring must stay gated while the gap cycle is incomplete.

## Gates

- `npm --prefix 100xfenok-next run qa:fenok-etf-signal-gate`
  - requires `scored_public_etf=0`
  - requires ETF signal rows to stay empty
  - requires no ETF row leakage into the stock signal lens
- `npm --prefix 100xfenok-next run qa:fenok-edge-readiness`
  - includes the ETF gate
  - does not claim ETF scoring is live

## Next Contract Before Nonzero ETF Scores

Before relaxing the zero-score gate:

1. Build an ETF action-index script with explicit ETF formulas.
2. Prove enough daily ETF price/history coverage for the scoring denominator.
3. Wire the ETF action index into `scripts/build-fenok-etf-signals.mjs`.
4. Replace the zero-score gate with denominator, freshness, and leakage checks.
5. Keep stock and ETF denominators reported separately.
