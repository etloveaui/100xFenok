# S3 ETF signal gate report (FH-669)

## Changed files (intentional)

| File | Change |
|---|---|
| `scripts/build-phase2-closeout-indexes.mjs` | Every emitted `stock_action_index.json` row now includes `asset_type: "stock"`. |
| `scripts/build-fenok-signals.mjs` | Stock signal builder filters to rows where `(asset_type ?? "stock") === "stock"`, preventing any future ETF rows from entering the stock signal lens or S1 denominator. |
| `scripts/build-fenok-etf-signals.mjs` | New separate ETF signal gate builder. Reads `data/stockanalysis/etf_universe.json`, emits `data/computed/fenok_etf_signals.json` + `data/computed/fenok_etf_signals_summary.json` with `rows: []` and `scored_public_etf: 0`. |
| `docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md` | Updated status to "gate builder implemented; scoring formulas not implemented" and documented the implemented builder/output files. |

## Generated artifacts (from running builders)

- `data/computed/fenok_etf_signals.json`
- `data/computed/fenok_etf_signals_summary.json`
- `100xfenok-next/public/data/computed/fenok_etf_signals_summary.json` (public mirror)
- `data/computed/stock_action_index.json` regenerated with `asset_type: "stock"` on all 1,066 rows.
- `data/computed/fenok_signals.json` / `fenok_signals_summary.json` regenerated; still 1,066 stock rows.

## Exact `scored_public_etf` state

```json
{
  "candidate_etf_count": 5333,
  "eligible_etf_count": 4493,
  "scored_public_etf": 0
}
```

- 5,333 ETF candidates from `etf_universe.json`.
- 4,493 vanilla ETFs after excluding leveraged/inverse/single-stock.
- 0 scored/public ETF rows until scoring formulas are implemented.

## QA commands run

```bash
cd source/100xFenok
node --check scripts/build-fenok-etf-signals.mjs
node --check scripts/build-fenok-signals.mjs
node --check scripts/build-phase2-closeout-indexes.mjs
node scripts/build-fenok-etf-signals.mjs
node scripts/build-fenok-signals.mjs
node scripts/build-phase2-closeout-indexes.mjs
cd 100xfenok-next && npx tsc --noEmit
cd source/100xFenok && git diff --check
```

Results:
- All `node --check`: PASS
- `build-fenok-etf-signals.mjs`: emitted gate payload, `scored_public_etf=0`
- `build-fenok-signals.mjs`: output still 1,066 stock rows; no ETF leakage
- `build-phase2-closeout-indexes.mjs`: output 1,066 rows, all `asset_type: "stock"`
- `npx tsc --noEmit`: PASS
- `git diff --check`: PASS

## Notes

- The nested-repo `git status` shows additional modified files (`package.json`, `data-usage-manifest.json`, `check-fenok-edge-freshness.mjs`, `audit-fenok-stock-promotion-candidates.mjs`, generated public data mirrors) that were touched by other panes or by running the builders; they are outside the scope of this slice.
- No fetch/deploy performed.

## Remaining S3+ work

1. Implement `scripts/build-etf-action-index.mjs` with ETF-specific fields and peer groups.
2. Implement scoring formulas in `scripts/build-fenok-etf-signals.mjs` (cost_efficiency, liquidity, tracking_quality, momentum_trend, risk_adjusted_momentum, income, diversification, classification_risk).
3. Wire ETF scores to the UI once non-zero `scored_public_etf` exists.
