# Yahoo Finance Data

> **Source**: Yahoo Finance
> **Update**: Daily / on-demand
> **Files**: 1,100
> **Version**: 1.0.0

---

## Overview

Yahoo Finance payloads backfill ticker-level market and statement context for
Stock, Screener, Portfolio, and ETF surfaces.

The fetch universe is broader than `global-scouter/stocks/detail/`:

- Global Scouter stock detail symbols
- Global Scouter ETF symbols
- Dashboard sector ETF constants
- Portfolio time-series symbols
- Major market ETFs used by product views

Non-Yahoo index labels such as `KOSPI`, `NASDAQ`, `SHANGHAI`, `TOPIX`, and
`HSCEI` are excluded from the finance fetch universe.

## Structure

```
yf/
├── finance/
│   ├── _summary.json
│   ├── AAPL.json
│   └── ...
└── quarter_closes.json
```

## finance/{TICKER}.json

```json
{
  "ticker": "AAPL",
  "fetched_at": "2026-06-12T...",
  "data": {
    "info": {},
    "income_statement": {},
    "balance_sheet": {},
    "cash_flow": {}
  }
}
```

ETF payloads may have sparse statement blocks, but the file still counts as
coverage when Yahoo returns a usable quote/info payload.

## finance/_summary.json

```json
{
  "generated_at": "2026-06-12T...",
  "count": 1098,
  "ok": 1098,
  "failed": 0,
  "errors": []
}
```

`_summary.json` is rebuilt from local files after fetch. This prevents stale
fetch errors from reporting missing data for symbols that already have usable
finance JSON.
