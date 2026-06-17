# StockAnalysis Data

> **Source**: StockAnalysis public JSON, Svelte/devalue payloads, and HTML table surfaces
> **Update**: Weekly / on-demand
> **Version**: `stockanalysis/v1`

---

## Overview

This folder preserves StockAnalysis as a separate 100x DataPack source layer.
It is used for ETF holdings, ETF metadata, quote/history cross-checks, stock
overview snapshots, and market event surfaces such as new ETFs, IPOs,
corporate actions, earnings calendars, market movers, and industry maps.

The full ETF universe is stored separately from deep ETF payloads. Universe
refresh is lightweight; deep holdings/history backfill is intentionally chunked
with `--universe-backfill --offset --limit-etfs` to avoid large request bursts.

Some StockAnalysis pages are SvelteKit/devalue payloads rather than simple REST
JSON. v1 now decodes the high-value non-financial surfaces where live probes
confirmed stable payloads (`new_etfs`, `etf_screener`, `actions_recent`,
`earnings_calendar`). Stock financial statements remain in the probe phase until
schema coverage is promoted, but the probe now has a fixture smoke path for the
devalue decoder and normalized statement rows.

## Structure

```
stockanalysis/
├── index.json
├── etf_universe.json
├── etfs/
│   ├── SPY.json
│   ├── TQQQ.json
│   └── ...
├── stocks/
│   ├── AAPL.json
│   └── ...
└── surfaces/
    ├── index.json
    ├── etf_screener.json
    ├── earnings_calendar.json
    └── ...
```

## SSOT Role

- ETF universe ticker/name/category/AUM list: primary source.
- ETF holdings and swap/counterparty rows: primary source.
- ETF screener full-field universe: primary source.
- New ETF launches, IPO calendars/filings, corporate actions, and earnings
  calendar: primary market event source.
- Market movers and industry maps: cross-check/source-enrichment layer.
- ETF quote/history/overview: cross-check and fallback to Yahoo Finance.
- Stock overview/quote/history: cross-check and fallback only.
- Stock financial statements: not covered in v1; use existing Yahoo/Global
  Scouter/SEC paths until the devalue parser is promoted.

## Normalized Payload

Each file keeps both normalized fields and raw endpoint payloads:

```json
{
  "schema_version": "stockanalysis/v1",
  "source": "stockanalysis",
  "asset_type": "etf",
  "ticker": "TQQQ",
  "fetched_at": "2026-06-17T...",
  "normalized": {
    "holdings": [],
    "asset_allocation": {},
    "sectors": {},
    "countries": {},
    "overview": {},
    "quote": {},
    "history": []
  },
  "raw": {}
}
```

Universe payload:

```json
{
  "schema_version": "stockanalysis/v1",
  "source": "stockanalysis",
  "asset_type": "etf",
  "counts": {"records": 5280, "pages": 11},
  "records": [
    {
      "ticker": "AAA",
      "name": "Alternative Access First Priority CLO Bond ETF",
      "category": "Fixed Income",
      "aum_raw": "39.98M",
      "aum": 39980000,
      "source_page": 1
    }
  ]
}
```

Surface payload:

```json
{
  "schema_version": "stockanalysis/v1",
  "source": "stockanalysis",
  "surface": "earnings_calendar",
  "format": "svelte_devalue",
  "counts": {"records": 3690, "days": 75, "weeks": 15},
  "records": [
    {
      "date": "2026-04-20",
      "symbol": "FLXS",
      "timing": "amc",
      "eps_estimate": 0.75,
      "revenue_estimate": 115391200
    }
  ],
  "metadata": {}
}
```

## Update Modes

```bash
# Lightweight daily/weekly universe refresh
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --universe-only

# Normal focused refresh: universe + default focus ETF list + selected stocks
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --stocks AAPL,NVDA,PLTR

# Refresh high-value source surfaces only
python3 scripts/fetch-stockanalysis.py --fetch-surfaces --surface-set core --surfaces-only

# Validate the financial devalue decoder without network access
python3 scripts/test-stockanalysis-financials-fixtures.py

# Validate fetcher parsers against local fixtures
python3 -m unittest scripts/test_fetch_stockanalysis_fixtures.py

# Validate fetcher surface definitions against current DataPack outputs
python3 -m unittest scripts/test_stockanalysis_surface_contract.py

# Inspect a saved financial __data.json fixture through the probe
python3 scripts/probe-stockanalysis-financials.py AAPL --statement income \
  --fixture scripts/fixtures/stockanalysis/aapl_income_annual__data.fixture.json

# Controlled full ETF backfill chunk
python3 scripts/fetch-stockanalysis.py --universe-backfill --offset 0 --limit-etfs 100 --sleep 0.25
```
