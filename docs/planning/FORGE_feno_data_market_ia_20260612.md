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
| `stockanalysis/industries*` | **Sectors** (owner); Market events teaser only | Industry map / taxonomy / constituents / CSV owned by `/sectors`; `/market/events` keeps a one-line industry-momentum teaser + cross-link (DEC-246) |
| `stockanalysis/etf_*` | **ETF center** (`/etfs` segments) | ETF universe + 신규/레버리지/단일종목/인버스/디지털 as a `/etfs` segment toggle; `/etfs/new` is a deep view reachable from the 신규 segment, not a separate top-nav pill (DEC-246) |
| `edgar-korean-summaries` | **Stock detail 공시 tab** | Per-ticker filings list (10-K/10-Q/8-K/13F) + 원문/요약/번역 actions; NVDA pilot routes to `/stock/NVDA?tab=filings` (DEC-246) |

> **2026-06-20 ownership correction (DEC-246)** — This Placement Map is the cross-route ownership SSOT. `service-map.md` is the strategy/convergence SSOT only and points here; it does not carry the ownership matrix. Industry ownership moved from `/market/events` to `/sectors` (supersedes `DESIGN_explore_ia_reset_20260618.md` lines 184/188-189). Filings live on stock detail. ETF families are `/etfs` segments.

## UI Rule

- `/market-valuation` is the canonical market data surface.
- **Market section nav = a shared 3-tab component (밸류에이션 / 국면 / 이벤트) with self-active (`aria-current`); 탐색 is NOT in the market nav. `구조 상세` is a sub of 밸류에이션, not a 4th tab. Nav-decision SSOT = `FORGE_market_valuation_ledger_20260613.md` (DEC-246).**
- `/explore` remains a 30-second routing and summary surface.
- No separate "data coverage" card; coverage should appear through actual
  decision panels, not metadata inventory.
- Mobile/card safety is mandatory: every new row uses constrained grids,
  `min-width: 0`, and wrapped detail text.

## P0 Implementation

Shipped as the first depth slice:

- ISM internal diffusion panel from `macro/activity-surveys.json`.
- Damodaran ERP panel from `damodaran/erp.json` and
  `damodaran/historical_erp.json`.
- Bond signal panel from `global-scouter/indicators/economic.json`.
- S&P 500 annual-return history panel from `slickcharts/sp500-returns.json`.

## Verification Plan

- Static data mapping by `rg`/`jq`.
- `git diff --check`.
- TypeScript check with `npx tsc --noEmit --pretty false`.
- Browser/Playwright/dev server intentionally skipped unless approved because
  the current incident constraint is low resource usage.
