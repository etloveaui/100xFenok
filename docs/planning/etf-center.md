# ETF Center

> Scope: public ETF surfaces in 100xFenok (`/etfs`, `/etfs/new`, `/etfs/[ticker]`).
> Last updated: 2026-06-30.

## 1. Overview

The ETF Center is the dedicated surface for discovering, filtering, and inspecting exchange-traded funds. It consolidates data from the StockAnalysis ETF universe, the StockAnalysis ETF screener, individual ETF detail files, and Yahoo Finance fallback facts.

Current coverage (2026-06-30 local DataPack):

- ETF universe records: 5,333
- ETF candidate symbols: 5,390
- ETF detail coverage: 98.07% (5,286 / 5,390)
- Primary StockAnalysis detail files: 4,588
- Yahoo ETF fallback files: 715
- Market-facts normalized ETF rows: 5,301
- Fenok Edge ETF scoring lane: 4,484 eligible/scored vanilla ETFs
- Fenok Edge ETF daily-1Y readiness: `4484 = 3672 complete + 275 fetchable + 537 inception-limited`
- Remaining distinction: ETF Center UI/data coverage is surface-ready, but Fenok Edge ETF paid-ready wording stays blocked until `daily=false` and `gated=false` clear.

Design principles:

- No mock UI; every displayed field is backed by a durable, auto-updating data source.
- Fallback states are explicit to the user (e.g., "price-only", "summary-only").
- All public data is mirrored from `data/stockanalysis/**` to `100xfenok-next/public/data/stockanalysis/**`.

## 2. Page Structure

### 2.1 `/etfs` — ETF List & Discovery

Entry point for the ETF Center.

- **Header**: title "ETF 센터". **A unified segment toggle (전체 / 신규 / 레버리지 / 단일종목 / 인버스 / 디지털) with self-active state drives the `EtfUniverseCard` filter inline (DEC-246, 2026-06-20).** The previous standalone "신규 상장" pill link is replaced by the 신규 segment; `/etfs/new` is still reachable as a deep view from that segment (see 2.2). The segment maps to existing URL params: 신규 → `new=1`, 레버리지 → `type=leveraged`, 단일종목 → `type=single-stock`, 인버스 → `type=inverse`, 디지털 → `asset`-class value (confirm the digital/crypto asset value exists in `etf_screener.assetClass`; if absent it is a small data addition, not a new route).
- **Surface snapshot card** (`EtfSurfaceSnapshotCard`): quick leaderboards and curated collections.
  - Volume leaders / change leaders from `etf_screener`.
  - Curated provider collections (BlackRock, ProShares) and strategy/digital-asset buckets.
  - Provider collections intentionally keep the initial snapshot light (20 rows per provider) and lazy-load the full provider list only after the user clicks "전체 목록 불러오기". Current provider totals: BlackRock 485, ProShares 167.
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

> **DEC-246 (2026-06-20)**: `/etfs/new` is NOT demoted to a dumb redirect. It stays a deep view reachable from the `/etfs` 신규 segment because it carries features the universe list does not: the date-window filter (7/14/30 days anchored on surface `fetched_at`), coverage status chips (상세 가능 / 가격 제공 / 요약 제공 from `coverage/etf_detail.json`), date sort, and CSV export. Only the separate top-nav pill entry is replaced by the segment. If/when these features are ported into the 신규 segment, `/etfs/new` may then become an alias.

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
  - transient fetch failures are shown separately from missing/backfill-pending data and expose an in-place retry action.

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
  - `blackrock`, `proshares`: capped at 20 rows each with full `counts.rows` preserved for shown/total UI.
  - `bitcoin`: full digital-asset ETF bucket.

Full provider lists are not copied into the snapshot payload. `EtfSurfaceSnapshotCard` uses the existing `/api/data/stockanalysis/surfaces/{surface}/` route on demand so provider full-view growth does not slow the initial `/etfs` load.

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
  - Commit/push retries a concurrent `main` advance up to 5 times by rebasing
    before each push attempt.
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
  scans local primary StockAnalysis ETF detail files, reconciles the dispatch
  plan in `incremental_plan_latest.json` against the full-scan report, separates
  fetchable gaps from inception-limited recent-launch ETFs, and prints the
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
  - Dispatch only when the report shows `fetchable_required_history > 0`.
    Current E5c state is `missing_required_history=11`,
    `fetchable_required_history=0`, and `inception_limited_required_history=11`;
    all 11 are recent-launch ETFs younger than the requested 3Y/5Y windows, so
    `recommended_dispatch.status` is `not_recommended`.
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
- merged `classification` coverage = 100%
- when merged records equal the screener universe, leveraged / single-stock / inverse counts must exactly match `etf_screener` source classification counts

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
| 3Y return coverage | effectively backfilled / inception-limited | `market_facts` now uses StockAnalysis ETF catalog performance for 1M, YTD, 1Y, 5Y CAGR, 10Y CAGR, and inception-to-date CAGR. 3M is derived from local StockAnalysis detail history when Yahoo daily history is missing. 3Y CAGR can now be derived from StockAnalysis multi-year monthly history when `monthly_3y` or `monthly_5y` detail data exists. Current local 3Y CAGR coverage is 2,863 / 5,267, including 2,634 StockAnalysis-history-derived records; the history-gap report shows 4,568 / 4,579 primary detail files complete, 11 missing required-history rows, 0 fetchable rows, and 11 inception-limited recent-launch rows. |
| Chart granularity | code-ready / source-gap limited | ETF detail fetcher stores `daily_1y`, `weekly_1y`, `monthly_1y`, `weekly_3y`, `monthly_3y`, and `monthly_5y` when fetched; detail UI enables only ranges that exist in the payload. Current local detail files are almost fully backfilled for 3Y/5Y; the remaining 11 open progressively only if source history appears. |
| Missing multi-year history UX | done / data-dependent | ETF detail pages show the current 1Y chart/table and a short pending-data note when 3Y/5Y history ranges are not present, so disabled ranges are not mistaken for a broken chart. |
| Browser QA for ETF routes | content/a11y assertions added | `.qa-playwright.js`, `.qa-a11y.js`, and `qa:stockanalysis` include `/etfs`, `/etfs/new`, `/etfs/SPY`, and `/etfs/ADIU`. Playwright is pinned as a dev dependency, and ETF list/new/detail content plus ETF route color-contrast checks pass on the local Next dev server; screenshot-level visual assertions remain a follow-up. |
| ETF detail transient fetch | improved | ETF detail client no longer stores a failed ETF detail or market-facts response as a permanent module-level `null`, distinguishes transient fetch failure from missing/backfill-pending data, and exposes an in-place retry action. |
| ETF snapshot transient fetch | improved | The `/etfs` snapshot card clears failed surface fetches, avoids stale failed pending state, and shows a retry callout instead of rendering empty leaderboards as if data were valid. |
| Provider full-list reachability | done / lazy | `/etfs` shows provider shown/total from the capped snapshot, then loads BlackRock/ProShares full provider rows from `/api/data/stockanalysis/surfaces/{surface}/` only when the user clicks "전체 목록 불러오기". Gate covered snapshot cap unchanged, click-before surface requests 0, BlackRock 485/485 rendered after click, desktop/mobile overflow false. |
| New ETF date/filter cache | improved | `/etfs/new` date filters use the surface `fetched_at` date as the "recent N days" anchor, show an explicit no-date-baseline note if a recent-period filter cannot be evaluated, and new-ETF snapshot/coverage loaders no longer keep failed non-OK responses as permanent pending promises. |
| Global focus indicator | improved / browser-smoked | The app-wide `:focus-visible` outline now uses the brand interaction token and has an interactive-element override so controls that use utility `outline-none` still keep a visible keyboard focus. Browser focus checks covered Superinvestors and new-ETF filter inputs. |
| Table header semantics | improved | ETF detail, sector desktop tables, and market-valuation benchmark tables declare column and row header scope so assistive technologies can map table cells to their headers reliably. |
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
