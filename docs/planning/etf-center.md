# ETF Center

> Scope: public ETF surfaces in 100xFenok (`/etfs`, `/etfs/new`, `/etfs/[ticker]`).
> Last updated: 2026-06-19.

## 1. Overview

The ETF Center is the dedicated surface for discovering, filtering, and inspecting exchange-traded funds. It consolidates data from the StockAnalysis ETF universe, the StockAnalysis ETF screener, individual ETF detail files, and Yahoo Finance fallback facts.

Current coverage (2026-06-19 local DataPack):

- ETF universe candidates: 5,347
- ETF detail coverage: 98.47% (5,265 / 5,347)
- Primary StockAnalysis detail files: 4,579
- Yahoo ETF fallback files: 686
- Price coverage in joined universe API: 5,347 / 5,347
- Expense ratio coverage: 5,213
- Performance coverage: 4,579
- Market-facts ETF return coverage: 1M 5,143 / 5,267, 3M 5,041 / 5,267, YTD 4,903 / 5,267, 1Y 4,328 / 5,267, 3Y CAGR 229 / 5,267, 5Y CAGR 2,037 / 5,267, 10Y CAGR 1,138 / 5,267, max CAGR 3,637 / 5,267

Design principles:

- No mock UI; every displayed field is backed by a durable, auto-updating data source.
- Fallback states are explicit to the user (e.g., "price-only", "summary-only").
- All public data is mirrored from `data/stockanalysis/**` to `100xfenok-next/public/data/stockanalysis/**`.

## 2. Page Structure

### 2.1 `/etfs` — ETF List & Discovery

Entry point for the ETF Center.

- **Header**: title "ETF 센터", link to `/etfs/new`.
- **Surface snapshot card** (`EtfSurfaceSnapshotCard`): quick leaderboards and curated collections.
  - Volume leaders / change leaders from `etf_screener`.
  - Curated provider collections (BlackRock, ProShares) and strategy/digital-asset buckets.
- **ETF universe card** (`EtfUniverseCard`): searchable, filterable list with load-more.
  - Loads from `/api/data/stockanalysis/etf-universe`.
  - Merges `etf-snapshot.newEtfs` so newly listed ETFs keep classification tags before the next deep detail refresh.
  - URL-synced filters: `type`, `new`, `asset`, `issuer`, `aum`, `fee`.
  - Columns: ticker, name, type tags, AUM, price, change, volume, holdings count, expense ratio, returns.

Implementation pointers:

- `100xfenok-next/src/app/etfs/page.tsx`
- `100xfenok-next/src/app/explore/EtfUniverseCard.tsx`
- `100xfenok-next/src/app/etfs/EtfSurfaceSnapshotCard.tsx`

### 2.2 `/etfs/new` — New Launch Radar

Recently listed ETFs.

- Data source: `etf-snapshot.newEtfs` (from `surfaces/new_etfs.json`).
- Filters: query, type (leveraged / single-stock / inverse), date range (7 / 14 / 30 days), issuer, sort (date / ticker / change / price).
- Status chips: "상세 가능", "가격 제공", "요약 제공" based on `coverage/etf_detail.json`.
- CSV export.

Implementation pointers:

- `100xfenok-next/src/app/etfs/new/page.tsx`
- `100xfenok-next/src/app/etfs/new/NewEtfsList.tsx`

### 2.3 `/etfs/[ticker]` — ETF Detail

Detail page for a single ETF.

- Loads ETF detail from `/api/data/stockanalysis/etfs/{ticker}`.
- Loads normalized market facts from `/data/computed/market_facts/tickers/{ticker}.json`.
- Sections:
  - Header: ticker, name, classification tags.
  - Key metrics: price, change, AUM, expense ratio, dividend yield, beta, P/E, 52-week range.
  - Performance: 1M, YTD, 1Y, CAGR 3Y/5Y/10Y/max (raw StockAnalysis `performance` + normalized `market_facts`).
  - Holdings: top holdings, sector/country/asset allocation breakdowns.
  - History: available period chart + table from detail `history_periods`.
- Fallback states:
  - `full`: complete detail available.
  - `surface_only` / `universe_only`: only price/summary data available; user-facing copy explains missing depth.
  - `yf_fallback`: Yahoo Finance auxiliary data is used temporarily.

Implementation pointers:

- `100xfenok-next/src/app/etfs/[ticker]/page.tsx`
- `100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx`

## 3. Data Flow

### 3.1 Source Data Files

| File | Contents | Updated By |
|------|----------|------------|
| `data/stockanalysis/etf_universe.json` | Full ETF list: ticker, name, category, AUM | `fetch-stockanalysis.py --discover-etf-universe` |
| `data/stockanalysis/surfaces/etf_screener.json` | Price, change, volume, holdings, assetClass | `fetch-stockanalysis.py --fetch-surfaces` |
| `data/stockanalysis/surfaces/new_etfs.json` | Recently listed ETFs | `fetch-stockanalysis.py --fetch-surfaces` |
| `data/stockanalysis/etfs/{TICKER}.json` | Individual ETF detail (overview, holdings, `history_periods`, performance) | `fetch-stockanalysis.py --incremental-etf-backfill` / `--universe-backfill` |
| `data/stockanalysis/backfill/incremental_plan_latest.json` | No-network preflight plan for the next incremental ETF detail/history refresh | `fetch-stockanalysis.py --plan-only --write-plan` |
| `data/stockanalysis/backfill/incremental_latest.json` | Post-run proof from a completed incremental ETF detail refresh | `fetch-stockanalysis.py --incremental-etf-backfill` |
| `data/stockanalysis/coverage/etf_detail.json` | Coverage counts and missing samples | coverage builder |
| `data/computed/market_facts/tickers/{TICKER}.json` | Normalized facts (price, returns, expense_ratio, etc.) | `build-market-facts.py` |
| `data/yf/finance/{TICKER}.json` | Yahoo Finance fallback info + history | `fetch-yf-finance.py` |

### 3.2 Join API

`/api/data/stockanalysis/etf-universe` (`route.ts`):

- Server-joins `etf_universe.json` + `etf_screener.json` by ticker.
- Promotes fields from ETF detail overview when available: `expenseRatio`, `expense_ratio`, `dividendYield`, `dividend_yield`, `sharesOut`, `beta`, `inceptionDate`, `provider_page`, `etf_website`, `performance`.
- Response includes counts and sorted records (AUM desc, then ticker).
- Cache: 5 minutes (`s-maxage=300, stale-while-revalidate=900`).

### 3.3 Snapshot API

`/api/data/stockanalysis/etf-snapshot`:

- Returns curated subsets:
  - `newEtfs`: up to 100 newest ETFs with joined classification.
  - `screener`: AUM top 5 + volume leaders + change leaders.
  - `blackrock`, `proshares`, `bitcoin`: provider/strategy surfaces.

### 3.4 Detail API

`/api/data/stockanalysis/etfs/{ticker}`:

- Returns StockAnalysis detail file if it exists.
- Falls back to surface/universe data when detail is missing.
- Preserves `detail_status`: `full`, `surface_only`, `universe_only`, `yf_fallback`.

### 3.5 Fallback Strategy

1. Primary source: StockAnalysis ETF detail endpoints.
2. If StockAnalysis detail 404s or returns non-ETF quoteType, use Yahoo Finance `yfinance` fallback (`yf_etf_fallback=true`).
3. If both fail, serve surface/universe summary data with an explicit fallback status.
4. Retry/cooldown logic tracks missing tickers in `data/stockanalysis/backfill/pending_ledger.json`.

### 3.6 Refresh Cadence

- **Weekly full refresh**: `fetch-stockanalysis.yml` runs Sundays 23:20 UTC.
  - Discovers ETF universe.
  - Fetches surfaces.
  - Runs incremental ETF backfill (default 120 ETFs per run).
  - Builds market facts, source parity, market audit.
  - Mirrors to `public/` and commits.
- **Weekly Yahoo refresh**: `fetch-yf-finance.yml` runs Saturdays 22:00 UTC.
  - Fetches Yahoo info + 1-year daily history for focus / major / portfolio / scouter / dashboard tickers.
  - Optional `--stockanalysis-etfs` flag for staged full-ETF backfills.
  - `--plan-only` can preview the exact AUM-prioritized candidate slice before any Yahoo call or data write.
  - Non-plan runs rebuild market facts, source parity, and market data audit, then run `qa:market-audit` and `qa:copy` before committing so YF-driven return changes are visible in Data Lab automatically.
- **Incremental backfill**: scheduled default is conservative; staged full-ETF backfills are triggered manually via `workflow_dispatch`.
- **Multi-year history gap plan**: before a live 3Y/5Y ETF history refresh, run
  `python3 scripts/fetch-stockanalysis.py --incremental-etf-backfill --incremental-etf-only --history-gaps-only --plan-only --write-plan --incremental-etf-limit <N>`
  to preview only existing primary StockAnalysis ETF detail files that lack
  `monthly_3y` / `monthly_5y`, without network calls. The written
  `incremental_plan_latest.json` is a plan artifact; `incremental_latest.json`
  remains the completed-run evidence.
- **History gap QA summary**: run `npm run qa:history-gap` from
  `100xfenok-next/` before dispatching a live history refresh. It directly
  scans local primary StockAnalysis ETF detail files, compares the current
  missing-history count to `incremental_plan_latest.json`, and prints the
  recommended workflow inputs without making network calls. Use
  `-- --required-history-periods <comma-list>` when the workflow dispatch is
  intentionally staged to a subset of periods.
- **History gap report artifact**: run
  `npm run qa:history-gap -- --write-report` to persist the same direct-scan
  result to `data/stockanalysis/backfill/history_gap_report_latest.json` and
  `100xfenok-next/public/data/stockanalysis/backfill/history_gap_report_latest.json`.
  Data Lab reads this as a preflight report, not as completed-run evidence.
- **Workflow dispatch controls**:
  - `history_gap_plan=true` writes the same no-network
    `incremental_plan_latest.json` artifact. The workflow treats the normal
    default incremental limit (`120`) as `0` in this plan-only mode so the full
    local candidate set is visible unless the operator overrides the limit.
  - `history_gaps_only=true` runs a focused live ETF-detail refresh for primary
    StockAnalysis ETF files missing the required multi-year history periods. It
    skips the normal surface/financial refresh bundle and uses
    `incremental_etf_limit` as the chunk size.
  - After a live `history_gaps_only=true` chunk, the workflow regenerates the
    no-network plan artifact so `incremental_plan_latest.json` reflects the
    remaining gap, then runs `qa:history-gap` before committing.
  - Every StockAnalysis refresh now writes the history-gap report after market
    audit generation, so Data Lab's preflight card follows generated data
    automatically.

## 4. Filters & Display Fields

### 4.1 `/etfs` Filters

| Filter | Query Param | Values | Source |
|--------|-------------|--------|--------|
| Type | `type` | all / leveraged / single-stock / inverse | `classification` |
| New only | `new` | `1` / `true` | `is_new` flag |
| Asset class | `asset` | string from `assetClass` | `etf_screener.assetClass` |
| Issuer | `issuer` | string derived from name | `issuerNameFromEtfName()` |
| AUM | `aum` | mega / large / mid / small / unknown | `aum` |
| Expense ratio | `fee` | ultra-low / low / mid / high / unknown | `expense_ratio` / `expenseRatio` |

### 4.2 Displayed Fields

| Field | `/etfs` list | `/etfs/[ticker]` | Source |
|-------|-------------|-------------------|--------|
| Ticker | yes | yes | universe / screener |
| Name | yes | yes | universe |
| Asset class | filter | yes | screener / detail |
| Issuer | filter | yes | derived / detail |
| AUM | yes | yes | universe / screener |
| Price | yes | yes | screener / detail |
| Change (1D) | yes | yes | screener / detail |
| Volume | yes | yes | screener |
| Holdings count | yes | yes | screener / detail |
| Expense ratio | yes | yes | detail overview / market facts |
| Dividend yield | no | yes | detail overview / market facts |
| Beta | no | yes | detail overview / market facts |
| P/E | no | yes | detail overview / market facts |
| 52-week range | no | yes | detail overview / market facts |
| Returns (1M/YTD/1Y/CAGR) | yes | yes | raw `performance` + market facts |
| Top holdings | no | yes | detail holdings |
| Sector/country allocation | no | yes | detail breakdowns |
| History chart | no | yes | detail `history_periods` (`daily_1y`, `weekly_1y`, `monthly_1y`, `weekly_3y`, `monthly_3y`, `monthly_5y`; legacy `history` fallback) |

### 4.3 `/etfs/new` Filters

| Filter | Query Param | Values |
|--------|-------------|--------|
| Query | `q` | free text on ticker/name |
| Type | `type` | leveraged / single-stock / inverse |
| Days | `days` | 7 / 14 / 30 |
| Issuer | `issuer` | derived issuer name |
| Sort | `sort` | date / ticker / change / price |

## 5. QA / Contract

### 5.1 Scripts

| Script | Purpose |
|--------|---------|
| `npm run qa:etf-universe` | Validates merged ETF universe contract (mirror parity, counts, coverage, ticker contracts). |
| `npm run qa:stockanalysis` | Smoke-tests public routes and API responses. |
| `npm run qa:surface-consumers` | Validates that every declared surface has an active route/component consumer. |
| `npm run qa:market-audit` | Validates Data Lab renderer labels and market audit contracts. |
| `npm run qa:history-gap` | Prints the current primary StockAnalysis ETF multi-year history gap and verifies it matches the no-network plan artifact. |
| `npm run qa:history-gap -- --write-report` | Writes the durable history-gap report JSON plus the public mirror for Data Lab. |
| `npm run qa:copy` | Lints public-facing Korean copy. |

### 5.2 ETF Universe Contract Thresholds

From `100xfenok-next/scripts/check-stockanalysis-etf-universe.mjs`:

- `etf_universe` source rows >= 5,200
- `etf_screener` source rows >= 5,250
- merged records >= 5,250
- price coverage >= 5,000
- volume coverage >= 4,500
- holdings coverage >= 4,900
- expense ratio coverage >= 5,000
- performance coverage >= 4,400

Representative ticker contracts:

- `VOO`: numeric `aum`, `price`, `volume`, `holdings`, `expense_ratio`; `performance.tr1y` promoted.
- `IEFA`: numeric `aum`, `price`, `volume`, `holdings`.
- `TQQQ`: leveraged, not single-stock, leverage factor 3, not inverse.
- `SQQQ`: leveraged, not single-stock, inverse.
- `TSLL`: leveraged, single-stock, leverage factor 2, not inverse.

### 5.3 CI Gate

`fetch-stockanalysis.yml` runs `qa:etf-universe`, `qa:surface-consumers`, `qa:market-audit`, `qa:copy` after data rebuilds and before the data commit/push step.

`fetch-yf-finance.yml` runs `qa:market-audit` and `qa:copy` after rebuilding market facts/source parity/audit, except in `plan_only` mode.

`deploy-worker.yml` runs `qa:stockanalysis` after `wrangler deploy` with retries.

## 6. Known Improvements / Remaining Gaps

| Gap | Status | Notes |
|-----|--------|-------|
| 3Y return coverage | plan-ready / live data backfill needed | `market_facts` now uses StockAnalysis ETF catalog performance for 1M, YTD, 1Y, 5Y CAGR, 10Y CAGR, and inception-to-date CAGR. 3M is derived from local StockAnalysis detail history when Yahoo daily history is missing. 3Y CAGR can now be derived from StockAnalysis multi-year monthly history when `monthly_3y` or `monthly_5y` detail data is backfilled. `fetch-stockanalysis.py --history-gaps-only --plan-only` previews the exact local candidate slice first. Current local coverage remains 229 / 5,267 until that live history refresh runs. |
| Chart granularity | code-ready / data backfill needed | ETF detail fetcher stores `daily_1y`, `weekly_1y`, `monthly_1y`, `weekly_3y`, `monthly_3y`, and `monthly_5y` when fetched; detail UI enables only ranges that exist in the payload. Current local detail files still mostly hold the 1Y keys, so 3Y/5Y charts open progressively after detail backfill. |
| Missing multi-year history UX | done / data-dependent | ETF detail pages show the current 1Y chart/table and a short pending-data note when 3Y/5Y history ranges are not present, so disabled ranges are not mistaken for a broken chart. |
| Browser QA for ETF routes | content/a11y assertions added | `.qa-playwright.js`, `.qa-a11y.js`, and `qa:stockanalysis` include `/etfs`, `/etfs/new`, `/etfs/SPY`, and `/etfs/ADIU`. Playwright is pinned as a dev dependency, and ETF list/new/detail content plus ETF route color-contrast checks pass on the local Next dev server; screenshot-level visual assertions remain a follow-up. |
| ETF detail transient fetch | improved | ETF detail client no longer stores a failed ETF detail or market-facts response as a permanent module-level `null`, so a transient route/API failure can recover on a later retry or navigation. |
| Header logo style | unified | Extracted shared `BrandLogo` component and applied to root `Navbar` and `AppShell` (rail + appbar). Both now use the same white rounded background, shadow, and border. |

## 7. Related Files

- `100xfenok-next/src/app/etfs/page.tsx`
- `100xfenok-next/src/app/etfs/new/page.tsx`
- `100xfenok-next/src/app/etfs/[ticker]/page.tsx`
- `100xfenok-next/src/app/explore/EtfUniverseCard.tsx`
- `100xfenok-next/src/app/etfs/EtfSurfaceSnapshotCard.tsx`
- `100xfenok-next/src/app/etfs/new/NewEtfsList.tsx`
- `100xfenok-next/src/app/etfs/[ticker]/EtfDetailClient.tsx`
- `100xfenok-next/src/components/BrandLogo.tsx`
- `100xfenok-next/src/app/api/data/stockanalysis/etf-universe/route.ts`
- `100xfenok-next/src/app/api/data/stockanalysis/etf-snapshot/route.ts`
- `100xfenok-next/src/app/api/data/stockanalysis/etfs/[ticker]/route.ts`
- `scripts/fetch-stockanalysis.py`
- `scripts/fetch-yf-finance.py`
- `scripts/build-market-facts.py`
- `100xfenok-next/scripts/check-stockanalysis-etf-universe.mjs`
- `100xfenok-next/scripts/smoke-stockanalysis-routes.mjs`
- `.github/workflows/fetch-stockanalysis.yml`
- `.github/workflows/deploy-worker.yml`
