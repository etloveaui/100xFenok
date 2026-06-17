# Market Data Source Contract

Date: 2026-06-17
Status: active design note

## Goal

Unify overlapping market data sources into the 100x DataPack first, then let
100x UI, feno-data, feno-data-remote, and feno-value consume local/remote JSON
instead of scraping providers independently.

## Architecture

```
External sources
  ├─ Yahoo/yfinance          quote/history/options/fund profile/stock facts
  ├─ StockAnalysis           ETF holdings + ETF/stock quote/history/overview
  ├─ SlickCharts             direct index constituents + returns/dividends
  ├─ Global Scouter          stock forward estimates/revisions/detail rows
  ├─ Benchmark Excel         benchmark valuation/time-series context
  ├─ SEC EDGAR               filing/companyfacts source of record
  ├─ Damodaran/FRED/Yardeni  specialist macro/valuation factors
  └─ AA ETF universe         user/investable leveraged ETF registry

       ↓ scheduled/targeted fetchers

100x DataPack
  ├─ data/yf/
  ├─ data/stockanalysis/
  ├─ data/slickcharts/
  ├─ data/global-scouter/
  ├─ data/benchmarks/
  └─ data/computed/market_facts/

       ↓ local first, remote fallback

100x UI · feno-data · feno-data-remote · feno-value
```

## Source Roles

| Domain | SSOT | Fallback / cross-check | Notes |
|---|---|---|---|
| stock forward estimates, revisions | Global Scouter | Yahoo, StockAnalysis overview | Preserve FY+1~FY+3 and revision history. |
| stock quote/latest | computed market facts, then Yahoo | StockAnalysis quote, ticker worker | Keep source metadata and timestamps. |
| stock financial statements | Yahoo current, SEC EDGAR future | StockAnalysis financials parser later | StockAnalysis financials are devalue; phase 2. |
| stock overview ratios | Global Scouter/Yahoo | StockAnalysis overview | Use as cross-source parity signal. |
| analyst estimates/targets | Yahoo | StockAnalysis overview target | Yahoo has broader analyst modules today. |
| ETF quote/history/options | Yahoo | StockAnalysis quote/history | Yahoo options are targeted only. |
| ETF fund profile/top holdings | Yahoo funds_data | StockAnalysis overview | Yahoo gives fund overview/classes/sectors/top rows. |
| ETF holdings/swap rows | StockAnalysis | issuer CSV later | Especially useful for leveraged/single-stock ETF swap exposure. |
| direct index constituents | SlickCharts | StockAnalysis SPY/QQQ/DIA ETF proxy | Keep direct index because ETF proxy can drift. |
| index/stock returns/dividends | SlickCharts | Yahoo history/dividends | Existing Explore/Screener surfaces rely on this. |
| benchmark valuation context | Benchmark Excel | Damodaran | Distinct source; no consolidation into Yahoo. |
| macro factors | FRED/Yardeni/OECD/PMI/Damodaran | none | Specialist lanes stay specialist. |

## Implementation State

- `scripts/fetch-yf-finance.py`
  - now includes AA/focus leveraged ETF universe;
  - supports `profile=etf`;
  - collects Yahoo `funds_data` for ETF/fund-like tickers;
  - skips stock-only statement/holder/analyst modules for ETFs.
- `scripts/fetch-stockanalysis.py`
  - discovers the full StockAnalysis ETF universe into `data/stockanalysis/etf_universe.json`;
  - writes `data/stockanalysis/etfs/{TICKER}.json`;
  - writes `data/stockanalysis/stocks/{TICKER}.json` when stocks are requested;
  - supports chunked universe backfill with `--universe-backfill --offset --limit-etfs`;
  - mirrors generated JSON to `100xfenok-next/public/data/stockanalysis/`.
- `scripts/update-manifest.py`
  - knows the `stockanalysis` category and schema metadata.
- `scripts/build-market-facts.py`
  - builds `data/computed/market_facts/tickers/{TICKER}.json`;
  - merges Yahoo, StockAnalysis, and SlickCharts availability flags;
  - mirrors the normalized facts to `100xfenok-next/public/data/computed/market_facts/`.

## Next Contract

1. Add parity checks for Yahoo vs StockAnalysis vs SlickCharts where fields overlap.
2. Promote full ETF universe backfill gradually: top AUM and focus ETFs first, full 5k only via chunked manual/workflow dispatch.
3. Add StockAnalysis financial-statement devalue parser only after schema tests exist.
4. Route feno-value runtime fields from `computed/market_facts` before direct yfinance calls.
5. Keep direct provider scraping as explicit fallback, not the normal path.
