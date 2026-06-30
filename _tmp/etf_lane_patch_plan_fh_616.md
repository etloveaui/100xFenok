# ETF Scoring Lane + Ticker-First UX Patch Plan (FH-616)

## Verified current state

- `data/computed/market_facts/index.json`: 6,479 assets; ETF=5,301, stock=1,178.
- `data/stockanalysis/etf_universe.json`: 5,333 ETF records, `asset_type: "etf"`.
- `data/computed/fenok_signals.json`: 1,066 rows; `asset_type` field absent; ETF rows=0.
- `data/computed/stock_action_index.json`: 1,066 rows; no ETFs; no `asset_type`.
- UI already detects ETFs via `asset_type === "etf"` in `/stock/[ticker]` and screener detail, but the main `/etfs` list renders **name-first**, burying the ticker.

## Core decision

Create a **separate ETF lane**; do not merge ETFs into the stock scoring pipeline. Stock signals depend on estimates, profitability, PER bands, and financial statements that do not apply to ETFs.

## Patch plan

### 1. Data contract

Create `docs/planning/CONTRACT_fenok_etf_signals_v0_1_20260629.md`:
- Universe: `data/stockanalysis/etf_universe.json` (5,333) filtered by AUM/liquidity and classification rules.
- Public/private policy: raw rows private; public JSON exposes derived 0-100 scores, freshness, lag, caveat codes.
- Signal families: `cost_efficiency`, `liquidity`, `tracking_quality`, `momentum_trend`, `risk_adjusted_momentum`, `income`, `diversification`, `classification_risk`.
- Peer groups: by `category` and broad `asset_class`; no mixing with stock percentiles.
- Missing-state rule: unsupported axes excluded, never plotted as zero.

### 2. Build ETF action index

Create `scripts/build-etf-action-index.mjs` → `data/computed/etf_action_index.json`:
- Inputs: `data/stockanalysis/etf_universe.json`, `data/stockanalysis/etfs/{TICKER}.json`, `data/computed/market_facts/tickers/{TICKER}.json`, `data/yf/finance/{TICKER}.json`.
- Emit rows with `asset_type: "etf"`, plus `category`, `aum`, `expense_ratio`, `dividend_yield`, `beta`, `returns`, `holdings_count`, `top_ten_concentration`, `sector_breadth`, `classification`.
- Exclude or flag leveraged/inverse/single-stock ETFs per owner decision.

### 3. Build ETF signals

Create `scripts/build-fenok-etf-signals.mjs` → `data/computed/fenok_etf_signals.json` + `data/computed/fenok_etf_signals_summary.json`.
- Compute percentiles within ETF peer groups only.
- Output a compact public summary with ticker, short display name, full legal name, issuer/provider, category, AUM, expense ratio, score axes, and `missing` state.

### 4. Guard the stock lane

Modify `scripts/build-fenok-signals.mjs` line ~1070:
- Add a defensive filter/branch so rows with `asset_type !== "stock"` do not corrupt stock peer stats or output.
- Keep existing stock output unchanged.

Modify `scripts/build-phase2-closeout-indexes.mjs` lines ~957-996:
- Add `asset_type: "stock"` to every emitted `stock_action_index.json` row.

### 5. Ticker-first UX patches

Change main ETF surfaces to show ticker as primary label and full name as secondary:

| File | Current | Change |
|---|---|---|
| `src/app/explore/EtfUniverseCard.tsx:637-647` | `.n` = name; ticker in `.tk` | `.n` = ticker; `.tk` = name + metadata |
| `src/app/etfs/EtfSurfaceSnapshotCard.tsx:207,302` | `short(name,34)` name-first | ticker-first; remove JS truncation |
| `src/app/etfs/new/NewEtfsList.tsx:481-494` | `.n` = name; ticker in `.tk` | `.n` = ticker; `.tk` = name + metadata |
| `src/app/etfs/[ticker]/EtfDetailClient.tsx:~1427` | `<h1>{displayName}</h1>` | `<h1>{symbol}</h1>` + full name subtitle |
| `src/app/stock/[ticker]/StockDetailClient.tsx:~1087` | same name-first header | same ticker-first change |

Add classification badges (leveraged/inverse/single-stock) to `EtfUniverseCard.tsx` rows, mirroring `PeerEtfCard`.

### 6. Wire ETF score into UI

- `100xfenok-next/src/lib/server/data-loader.ts`: add `fenok_etf_signals` consumer mapping.
- `src/app/etfs/[ticker]/EtfDetailClient.tsx`: load and display ETF signal summary or explicit missing-state.
- `src/app/etfs/page.tsx` / `EtfUniverseCard.tsx`: optionally show a compact `Edge` score chip once signals exist.

### 7. QA gates

- `node scripts/build-etf-action-index.mjs --plan-only` dry-run.
- `node scripts/build-fenok-etf-signals.mjs --no-write` validation.
- Spot-check SPY/QQQ/XLK/VTI scores and percentiles.
- Verify `fenok_signals.json` still has 1,066 stock rows and no ETF leakage.
- UI smoke: `/etfs`, `/etfs/SPY`, `/stock/SPY` render ticker-first without clipping.

## Owner decisions needed

1. Universe scope: all 5,333 ETFs or curated subset (e.g. top 500 by AUM, exclude leveraged/inverse/single-stock)?
2. Score surface: add to existing `/etfs` list, or a new `/etfs/scores` view?
3. Integration: should ETF scores feed a unified Fenok Edge ranking or remain a separate lens?
4. Refresh cadence: weekly with StockAnalysis ETF refresh, or daily with YF price refresh?

## Evidence paths

- `source/100xFenok/data/computed/market_facts/index.json`
- `source/100xFenok/data/stockanalysis/etf_universe.json`
- `source/100xFenok/data/computed/fenok_signals.json`
- `source/100xFenok/data/computed/stock_action_index.json`
- `source/100xFenok/scripts/build-fenok-signals.mjs:10-15,1070-1193`
- `source/100xFenok/scripts/build-phase2-closeout-indexes.mjs:906-999`
- `source/100xFenok/scripts/build-stocks-analyzer.mjs:19-228`
- `source/100xFenok/100xfenok-next/src/app/explore/EtfUniverseCard.tsx:637-647`
- `source/100xFenok/100xfenok-next/src/app/etfs/EtfSurfaceSnapshotCard.tsx:207,302`
- `source/100xFenok/100xfenok-next/src/app/etfs/new/NewEtfsList.tsx:481-494`
- `source/100xFenok/100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx:~1427`
- `source/100xFenok/100xfenok-next/src/app/stock/[ticker]/StockDetailClient.tsx:~1087,1031`
- `source/100xFenok/docs/planning/etf-center.md`
