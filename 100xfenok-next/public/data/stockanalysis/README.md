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

Latest measured ETF detail coverage (2026-06-19 KST / 2026-06-18 UTC): 5,347
candidate ETF symbols from `union(etf_universe, etf_screener, new_etfs)`, 5,199
detail files, 148 missing detail files, 639 Yahoo fallback detail files, 97.23%
detail coverage, and 85.28% primary StockAnalysis detail coverage. This proof
lives in `coverage/etf_detail.json` and is intentionally `warn` while detail
files are missing.

Latest measured incremental-only run (2026-06-19 KST / 2026-06-18 UTC): 730
eligible candidates (178 missing, 552 fallback retry), 120 selected, 120 total
ETF requests with the default focus set skipped, 87 OK, 33 still pending, 0
hard failures. All 87 OK records were source-tagged Yahoo Finance ETF/fund
fallbacks because StockAnalysis detail endpoints for that tail batch still
returned expected 404-style responses.

Some StockAnalysis pages are SvelteKit/devalue payloads rather than simple REST
JSON. v1 now decodes the high-value non-financial surfaces where live probes
confirmed stable payloads (`new_etfs`, `etf_screener`, `actions_recent`,
`earnings_calendar`). v1.1 promotes stock financial statements for a scoped
stock focus set into `financials/{TICKER}.json` with runtime field-count and
period-count sentinels. Those statements are preserved as cross-check
candidates and must not override Yahoo/current or future SEC EDGAR financial
statement SSOTs.

The `/market/events` industry tab consumes `industries_all`,
`sector_technology`, and `industry_semiconductors` directly. The
`qa:stockanalysis` route smoke verifies that those surfaces still contain enough
rows and the fields required by the industry map, sort/filter controls, and CSV
export.

The ETF snapshot API enriches the `new_etfs` rows with classification joined
from `etf_screener` or `etf_universe` by ticker. New ETF filtering should prefer
this joined classification over name-pattern inference when it is present. The
ETF center summary card also surfaces these joined hints for new leveraged,
single-stock, and inverse ETFs. `/api/data/stockanalysis/etf-universe` joins
`etf_universe` with `etf_screener` into a slim ETF catalog so `/etfs` can show
price, change, volume, holdings, and classification fields without downloading
the full screener surface separately. The snapshot API also uses `etf_screener`
for the `/etfs` AUM, volume, and absolute-change leaderboards so the lightweight
ETF list is visible before users open a detail page.

`npm --prefix 100xfenok-next run qa:etf-universe` is the serverless contract
gate for that joined ETF catalog. It rebuilds the same universe+screener merge
from the local DataPack, verifies public/source mirror parity, checks coverage
minimums, and keeps regression tickers such as IEFA, TQQQ, SQQQ, and TSLL
available with the expected detail and classification fields. The scheduled
`fetch-stockanalysis.yml` workflow runs this gate before committing refreshed
data.

## Structure

```
stockanalysis/
├── index.json
├── backfill/
│   ├── incremental_latest.json
│   ├── pending_ledger.json
│   └── ...
├── coverage/
│   └── etf_detail.json
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

Manifest note: `data/manifest.json` and the public mirror count JSON data files
with `schema.json` excluded. The raw filesystem total can be higher because it
also includes `README.md` and the schema file.

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

ETF detail coverage is rebuilt from local files and does not call the network.
The denominator is the union of the lightweight ETF list, ETF screener, and new
ETF launch surface so newly listed ETFs such as single-stock or leveraged funds
are visible before a full detail endpoint exists.

ETF classification is rebuilt with the lightweight catalog surfaces. The
classifier treats newer names such as `2X Long ADI Daily ETF` as single-stock
leveraged ETFs while excluding index, volatility, commodity, crypto, bond, and
futures contexts. Detail API fallback responses must carry the best available
classification from matched surfaces or `etf_universe` so new ETF pages can show
leverage/single-stock labels before a deep detail file exists.

```json
{
  "schema_version": "stockanalysis/v1",
  "asset_type": "etf_detail_coverage",
  "status": "warn",
  "counts": {
    "candidate_total": 5347,
    "covered_detail_files": 5199,
    "missing_detail_files": 148,
    "yahoo_fallback_files": 639,
    "coverage_pct": 97.23,
    "primary_stockanalysis_pct": 85.28
  },
  "missing_tickers": ["AAAD", "ACII", "..."]
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

# Validate the serverless ETF universe merge contract used by /etfs
npm --prefix 100xfenok-next run qa:etf-universe

# Inspect a saved financial __data.json fixture through the probe
python3 scripts/probe-stockanalysis-financials.py AAPL --statement income \
  --fixture scripts/fixtures/stockanalysis/aapl_income_annual__data.fixture.json

# Controlled full ETF backfill chunk
python3 scripts/fetch-stockanalysis.py --universe-backfill --offset 0 --limit-etfs 100 --sleep 0.25

# Scheduled-style incremental ETF detail self-heal
python3 scripts/fetch-stockanalysis.py --discover-etf-universe --fetch-surfaces \
  --incremental-etf-backfill --incremental-etf-limit 120 \
  --incremental-etf-max-age-hours 720 --yf-etf-fallback

# Incremental-only candidate batch after universe/surfaces are already fresh
python3 scripts/fetch-stockanalysis.py --incremental-etf-backfill \
  --incremental-etf-only --incremental-etf-limit 120 \
  --incremental-etf-max-age-hours 720 --yf-etf-fallback

# Rebuild ETF detail coverage proof without network fetches
python3 scripts/fetch-stockanalysis.py --coverage-only
```
