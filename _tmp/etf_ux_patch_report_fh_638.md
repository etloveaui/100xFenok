# ETF ticker-first UX patch report (FH-638)

## Changed files

| File | Change |
|---|---|
| `100xfenok-next/src/app/explore/etfUniverseUtils.ts` | `formatTypeHint` now accepts `{ includeTicker?: boolean }`; added `etfClassificationLabels()` helper. |
| `100xfenok-next/src/app/explore/EtfUniverseCard.tsx` | List rows now show **ticker primary**, full name + metadata secondary; added leveraged/inverse/single-stock classification badges. |
| `100xfenok-next/src/app/etfs/EtfSurfaceSnapshotCard.tsx` | Snapshot `EtfLink` shows **ticker primary**, full name secondary; removed 34-char JS truncation. |
| `100xfenok-next/src/app/etfs/new/NewEtfsList.tsx` | New-ETF rows show **ticker primary**, full name + metadata secondary. |
| `100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx` | Detail header `<h1>` is now the ticker; full fund name moved to the meta line. |
| `100xfenok-next/src/app/stock/[ticker]/StockDetailClient.tsx` | ETF fallback header `<h1>` is now the ticker; full fund name moved to the meta line. |
| `docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md` | Added separate-lane contract with signal families, public/private policy, and stop rules; no fake scores wired. |

## Before/after behavior

- `/etfs` list: previously the verbose fund name ellipsized and the ticker was buried in a crowded metadata line. Now the ticker is the primary label and the full name is readable in the secondary line.
- `/etfs` snapshot and `/etfs/new`: same ticker-first swap; no more silent 34-character name truncation.
- `/etfs/[ticker]` and `/stock/[ticker]` for ETFs: page title is the ticker, full name is shown as subtitle metadata.
- Classification badges now appear on `/etfs` list rows for leveraged/inverse/single-stock ETFs.

## Verification

- `npx eslint` on all touched `.ts/.tsx` files: 0 errors, 0 warnings.
- `npx tsc --noEmit`: PASS.
- `git diff --check` (source/100xFenok nested repo): PASS.
- No fetch/deploy.

## Notes

- `docs/agent-work/fenok_edge_product_readiness_failure_register_20260629.md` was modified by the coordinator pane (cx-1709) to integrate the ETF plan; this pane did not edit it.
- ETF remains S3: `scored_public_etf=0` until the builder in the contract is implemented.

## Remaining scoring tasks

1. Implement `scripts/build-etf-action-index.mjs` → `data/computed/etf_action_index.json`.
2. Implement `scripts/build-fenok-etf-signals.mjs` → `data/computed/fenok_etf_signals.json` + summary.
3. Wire `fenok_etf_signals` into `src/lib/server/data-loader.ts` and ETF detail UI once scores exist.
4. Decide universe scope (all 5,333 vs liquid subset) and leveraged/inverse handling.
