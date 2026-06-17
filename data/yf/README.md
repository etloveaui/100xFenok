# Yahoo Finance Data

> **Source**: Yahoo Finance
> **Update**: Weekly / on-demand
> **Files**: 1,100
> **Version**: 2.0.0 fetch contract (existing files may remain v1 until the next refresh)

---

## Overview

Yahoo Finance payloads backfill ticker-level quote, market, statement,
ownership, analyst, event, and history context for Stock, Screener, Portfolio,
and ETF surfaces.

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
  "schema_version": "yf-finance/v2",
  "ticker": "AAPL",
  "fetched_at": "2026-06-12T...",
  "profile": "full",
  "data": {
    "info": {},
    "fast_info": {},
    "income_statement": {},
    "balance_sheet": {},
    "cash_flow": {},
    "institutional_holders": [],
    "mutualfund_holders": [],
    "insider_transactions": [],
    "earnings_dates": [],
    "sec_filings": [],
    "history_1y": []
  }
}
```

ETF payloads may have sparse statement blocks, but the file still counts as
coverage when Yahoo returns a usable quote/info payload.

### Fetch Profiles

- `core`: legacy compact payload for quote, holders, analyst targets,
  recommendations, dividends, and curated financial statements.
- `full`: `core` plus bounded extra depth: `fast_info`, actions/splits,
  recommendation summary, upgrades/downgrades, earnings calendar/history,
  EPS/revision/growth estimates, sustainability, mutual-fund holders,
  insider rows, SEC filing links, news, and one-year daily history.
- `--include-options`: targeted-only option-chain sample, off by default.
- `--include-shares-full`: targeted/full backfill for share-count history,
  used for buyback/dilution modeling after runtime validation.
- `--max-age-hours`: optional local fresh-file skip guard to reduce duplicate
  Yahoo requests during manual reruns.

## finance/_summary.json

```json
{
  "generated_at": "2026-06-12T...",
  "count": 1098,
  "ok": 1098,
  "failed": 0,
  "skipped": 0,
  "profile": "full",
  "include_options": false,
  "include_shares_full": false,
  "errors": []
}
```

`_summary.json` is rebuilt from local files after fetch. This prevents stale
fetch errors from reporting missing data for symbols that already have usable
finance JSON.
