# StockAnalysis Data

> **Source**: StockAnalysis public JSON, Svelte/devalue payloads, and HTML table surfaces
> **Update**: Weekly / on-demand
> **Version**: `stockanalysis/v1`

---

## Overview

This folder preserves StockAnalysis as a separate 100x DataPack source layer.
It is used for ETF holdings, ETF metadata, quote/history cross-checks, stock
overview snapshots, stock financial statement cross-check candidates, and
market event surfaces such as new ETFs, IPOs, corporate actions, earnings
calendars, market movers, and industry maps.

The full ETF universe is stored separately from deep ETF payloads. Universe
refresh is lightweight. Routine scheduled runs now add an incremental detail
backfill for new, missing, previously Yahoo-filled, and stale ETF records so new
ETF detail pages self-heal without a manual freshness step. Full holdings/history
backfill remains intentionally chunked with `--universe-backfill --offset
--limit-etfs` to avoid large request bursts.

Latest measured incremental run (2026-06-18): 728 eligible candidates
(563 missing, 165 fallback retry), 120 selected, 166 total ETF requests
including the default focus set, 158 OK, 8 still pending, 0 hard failures. Of the
OK records, 43 came from StockAnalysis and 115 were source-tagged Yahoo Finance
ETF/fund fallbacks. The generated audit state is intentionally `warn` while
`pending_details_remain` is true.

Some StockAnalysis pages are SvelteKit/devalue payloads rather than simple REST
JSON. v1 now decodes the high-value non-financial surfaces where live probes
confirmed stable payloads (`new_etfs`, `etf_screener`, `actions_recent`,
`earnings_calendar`). v1.1 promotes stock financial statements for a scoped
stock focus set into `financials/{TICKER}.json` with runtime field-count and
period-count sentinels. Those statements are preserved as cross-check
candidates and must not override Yahoo/current or future SEC EDGAR financial
statement SSOTs.

## Structure

```
stockanalysis/
├── index.json
├── backfill/
│   ├── incremental_latest.json
│   ├── pending_ledger.json
│   └── ...
├── etf_universe.json
├── etfs/
│   ├── SPY.json
│   ├── TQQQ.json
│   └── ...
├── stocks/
│   ├── AAPL.json
│   └── ...
├── financials/
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
- Stock financial statements: cross-check candidate only. Use existing
  Yahoo/current and future SEC EDGAR paths as valuation SSOTs.

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

When StockAnalysis ETF REST endpoints are not indexed yet but Yahoo Finance
already exposes a valid ETF/fund profile, the same `etfs/{TICKER}.json` path may
temporarily hold a source-tagged fallback payload:

```json
{
  "schema_version": "stockanalysis/v1",
  "source": "yahoo_finance",
  "source_provider": "yahoo_finance",
  "detail_status": "yf_fallback",
  "asset_type": "etf",
  "ticker": "BSJY",
  "role": "ETF detail fallback while StockAnalysis ETF REST endpoints are not indexed yet",
  "stockanalysis_error": "HTTPError: HTTP Error 404: Not Found",
  "normalized": {
    "overview": {},
    "quote": {"ex": "yahoo_finance"}
  }
}
```

The next scheduled incremental run still retries those fallback records against
StockAnalysis first; once the StockAnalysis endpoint starts returning detail
JSON, the fallback file is replaced by a normal StockAnalysis payload.

Incremental selection prioritizes never-fetched missing ETF detail records before
retrying existing Yahoo fallback records. Within the same reason bucket, tickers
with fewer prior expected-missing failures are selected first; `new_etfs` still
wins only when the prior-failure count is the same. Fallback retries and repeated
missing attempts must not starve ETF universe records that do not have any local
detail yet.

Repeated expected-missing ETF detail failures are tracked in
`backfill/pending_ledger.json`. After 3 consecutive expected 404-style failures,
the ticker is skipped for 7 days before becoming eligible again. This keeps each
incremental chunk focused on undiscovered detail candidates instead of spending
slots on the same hard-tail tickers. The ledger only cools down expected missing
detail failures; hard failures still surface through the fetch index and audit.

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

Financials payload:

```json
{
  "schema_version": "stockanalysis/v1",
  "source": "stockanalysis",
  "asset_type": "stock",
  "ticker": "AAPL",
  "role": "financial statement cross-check candidate; not valuation SSOT",
  "statements": {
    "annual": {
      "income": {
        "periods": ["2025-09-27", "2024-09-28"],
        "rows": [
          {"field": "revenue", "title": "Revenue", "values": [391035000000, 383285000000]}
        ]
      }
    }
  },
  "summary": {}
}
```

## Update Modes

```bash
# Lightweight daily/weekly universe refresh
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --universe-only

# Normal focused refresh: universe + default focus ETF list + selected stocks
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --stocks AAPL,NVDA,PLTR

# Focused stock financial statement refresh
python3 scripts/fetch-stockanalysis.py --stocks AAPL,NVDA,PLTR --fetch-financials

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

# Scheduled-style incremental ETF detail self-heal
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --fetch-surfaces \
  --incremental-etf-backfill --incremental-etf-limit 120 \
  --incremental-etf-max-age-hours 720 --yf-etf-fallback
```
