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
  - supports `--stop-on-hard-error` so expected holdings 404s are recorded while
    rate-limit/blocking/schema errors stop the run;
  - mirrors generated JSON to `100xfenok-next/public/data/stockanalysis/`.
- `scripts/update-manifest.py`
  - knows the `stockanalysis` category and schema metadata.
- `scripts/build-market-facts.py`
  - builds `data/computed/market_facts/tickers/{TICKER}.json`;
  - merges Yahoo, StockAnalysis, and SlickCharts availability flags;
  - resolves overlapping fields with an explicit per-field source policy;
  - preserves all non-null source candidates under each selected fact so
    discarded-but-available data remains inspectable;
  - prefers `stockanalysis/etfs/{TICKER}.json` over the stock folder on any
    ticker collision so ETF holdings are not silently lost;
  - marks percent-like fields as `unit=percent_points` and adds Yahoo-derived
    change/change_pct candidates when raw quote change fields are absent;
  - mirrors the normalized facts to `100xfenok-next/public/data/computed/market_facts/`.
- `scripts/audit-market-data.py`
  - read-only audit for ETF universe backfill progress, failure classes,
    market-facts coverage, resolver candidate preservation, policy-source
    mismatches, and large percent-scale candidate disagreements;
  - reports completed/missing backfill offsets, next expected offset, hard-error
    count, and finalization readiness for the full ETF universe run;
  - can publish the same audit payload to
    `data/computed/market_data_audit.json` and the Next public data mirror when
    called with `--output data/computed/market_data_audit.json --mirror-public`.
- `scripts/finalize-market-data.py`
  - post-refresh closeout command that rebuilds `computed/market_facts`, writes
    `computed/market_data_audit`, updates `data/manifest.json`, and refreshes the
    Next static data-route manifest in the required order;
  - runs an audit preflight first and stops unless `ready_for_finalize=true`
    (`--allow-incomplete` is an explicit override for local experiments only).
- `docs/products/skills/feno-value/scripts/core/policy.py` (CCH)
  - reads `computed/market_facts` through DataPack policy as a fallback layer for
    common quote/valuation/fund fields before analyzer-specific provider work.
- `100xfenok-next/src/lib/server/data-loader.ts`
  - classifies `stockanalysis` ETF/stock details as stock data, ETF universe as
    explore inventory, and backfill indexes as admin fetch-audit artifacts.
- `100xfenok-next/src/app/screener/StockDetailPanel.tsx`
  - reads `computed/market_facts/tickers/{TICKER}.json`;
  - shows selected values, user-facing source-role labels, candidate counts, and
    ETF holdings/allocation/sector/country breakdowns without exposing provider
    brand names in the product UI.
- `100xfenok-next/src/app/stock/[ticker]/StockDetailClient.tsx`
  - falls back to `market_facts` when a ticker is absent from
    `global-scouter/core/stocks_analyzer.json`, allowing ETF-first pages such
    as leveraged funds to render instead of hard-failing.

## Resolver Policy

`computed/market_facts` exposes a selected value at `facts.{field}.value`, but
the same object also carries `policy`, `candidates`, and `candidate_count`.
This keeps UI consumption simple while preserving overlapping source evidence.

| Field | Priority |
|---|---|
| price | Yahoo → Yahoo fast_info → StockAnalysis quote → SlickCharts |
| previous_close | Yahoo → StockAnalysis quote |
| change / change_pct | StockAnalysis quote → Yahoo → Yahoo-derived current vs previous close |
| market_cap | Yahoo → StockAnalysis overview → SlickCharts |
| total_assets | Yahoo → StockAnalysis overview |
| trailing_pe | Yahoo → SlickCharts |
| forward_pe | Yahoo → StockAnalysis overview → SlickCharts |
| dividend_yield | Yahoo → StockAnalysis overview → SlickCharts |
| beta | Yahoo → StockAnalysis overview |
| expense_ratio | Yahoo → StockAnalysis overview |

This is intentionally not a single-provider takeover. Yahoo, SlickCharts, and
StockAnalysis all remain visible when their values overlap.

## Next Contract

1. Add parity checks for Yahoo vs StockAnalysis vs SlickCharts where fields overlap.
2. Complete full ETF universe backfill through chunked manual/workflow dispatch;
   finalize only when audit reports no missing offsets and no hard errors.
3. Run `scripts/finalize-market-data.py` after full backfill, then commit the
   generated DataPack + public mirror outputs as a separate data commit.
4. Add StockAnalysis financial-statement devalue parser only after schema tests exist.
5. Extend analyzer-specific feno-value providers beyond the common DataPack
   fallback path.
6. Keep direct provider scraping as explicit fallback, not the normal path.
