# FORGE: feno-data Market IA

Date: 2026-06-12
Scope: `100xfenok-next` local data UI placement.

## Problem

Market-level datasets were present in `/data`, but `/market-valuation` only
rendered benchmark valuation and Yardeni/Damodaran context. This made the page
look like a narrow valuation card instead of the canonical market cockpit.

## Placement Map

| Data family | Canonical UI home | Role |
| --- | --- | --- |
| `benchmarks` | Market, Explore summary, Sectors | Valuation bands, earnings/multiple decomposition, sector/index comparisons |
| `macro/activity-surveys` | Market | PMI, ISM, OECD CLI growth pulse |
| `computed/signals` | Market, Explore summary | Liquidity, stress, banking, sentiment signal state |
| `sentiment` | Market, Home summary | VIX, Fear & Greed, AAII, MOVE, put/call risk tone |
| `calendar` | Market, Explore summary | Near-term event risk |
| `indices` | Market | S&P/Nasdaq trend and drawdown context |
| `slickcharts` | Market | Index concentration, drawdown, yearly return structure |
| `damodaran` | Market, stock detail | ERP anchor and industry valuation inputs |
| `yardney` | Market | Bond yield fair-value context |
| `global-scouter` | Screener, Stock, Explore | Company universe, revisions, watchlist, detail data |
| `sec-13f` | Superinvestors, Explore | Investor positions and hot topics |
| `yf` | Stock, Screener | Ticker fundamentals and price detail |
| `admin` | Admin | Ops metadata only |

## UI Rule

- `/market-valuation` is the canonical market data surface.
- `/explore` remains a 30-second routing and summary surface.
- No separate "data coverage" card; coverage should appear through actual
  decision panels, not metadata inventory.
- Mobile/card safety is mandatory: every new row uses constrained grids,
  `min-width: 0`, and wrapped detail text.

## Verification Plan

- Static data mapping by `rg`/`jq`.
- `git diff --check`.
- TypeScript check with `npx tsc --noEmit --pretty false`.
- Browser/Playwright/dev server intentionally skipped unless approved because
  the current incident constraint is low resource usage.
