# StockAnalysis Data

> **Source**: StockAnalysis REST-shaped public JSON endpoints
> **Update**: Weekly / on-demand
> **Version**: `stockanalysis/v1`

---

## Overview

This folder preserves StockAnalysis as a separate 100x DataPack source layer.
It is used for ETF holdings, ETF metadata, quote/history cross-checks, and
stock overview snapshots.

The full ETF universe is stored separately from deep ETF payloads. Universe
refresh is lightweight; deep holdings/history backfill is intentionally chunked
with `--universe-backfill --offset --limit-etfs` to avoid large request bursts.

Stock financial statements are intentionally not included in v1 because those
pages are SvelteKit/devalue payloads, not simple REST JSON. They belong in a
later parser phase after endpoint and licensing risk review.

## Structure

```
stockanalysis/
├── index.json
├── etf_universe.json
├── etfs/
│   ├── SPY.json
│   ├── TQQQ.json
│   └── ...
└── stocks/
    ├── AAPL.json
    └── ...
```

## SSOT Role

- ETF universe ticker/name/category/AUM list: primary source.
- ETF holdings and swap/counterparty rows: primary source.
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

## Update Modes

```bash
# Lightweight daily/weekly universe refresh
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --universe-only

# Normal focused refresh: universe + default focus ETF list + selected stocks
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --stocks AAPL,NVDA,PLTR

# Controlled full ETF backfill chunk
python3 scripts/fetch-stockanalysis.py --universe-backfill --offset 0 --limit-etfs 100 --sleep 0.25
```
