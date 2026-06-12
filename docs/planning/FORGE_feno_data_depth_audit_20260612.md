# FORGE: feno-data Depth Audit and UI Design

Date: 2026-06-12
Scope: `100xfenok-next` nested data depth, real consumer usage, and next UI placement.
Status: Investigation/design plus P0 Market slice implementation.

## Mandate

The previous atlas phase closed the file/category visibility problem: every
`public/data/**/*.json` file now has at least one visible inventory path.

This depth phase asks a stricter question:

- Is each nested series, history block, aggregate table, and provenance payload
  either used in a product decision surface or intentionally held in Admin?
- If not, where should it go before implementation starts?

The answer is: category coverage is broadly closed, but depth coverage is not.
The current app still uses many rich datasets as latest-value summaries.

## Collaboration State

| Source | State | Notes |
| --- | --- | --- |
| Main agent | Done | Read-only `rg`/`jq`/file inspection and integration. |
| Internal explorers | Done | 6 read-only agents: benchmarks, macro/sentiment, SlickCharts, scouter/YF, SEC 13F/Damodaran, app usage tracing. |
| Right pane MiMo | Done | Final handoff received and integrated with corrections where code evidence diverged. |

Right-pane handoff anchor:
`fh-20260612-015-cx-56e2c34c`.

Initial wrapper diagnosis:
`verdict=input-pending`; right pane `%10/mc`; the target had accepted the mail and
was delegating.

Final right-pane response:
`fh-20260612-016-mc-a596fc41`.

## Right-Pane Delta

Accepted from the right-pane audit:

- Stronger placement emphasis for `global-scouter/indicators/economic.json`:
  high-yield spreads, treasury rates, and breakeven inflation belong in Market
  bond/risk signal panels.
- `stocks/detail/*.json` has more unused per-stock depth than the first pass
  surfaced: scale series, cash-flow line items, margin/ROA expansion, PBR/PCR/PSR
  /PEG, BPS/CPS/SPS, weekly revisions, and EPS weekly consensus.
- 13F investor detail can expose ownership structure fields such as voting
  authority, class, discretion, and confidential omission flags in Guru detail.
- YF `recommendations`, dividends, and quarterly statements should be promoted
  in Stock/Portfolio after the P0 revision/financial-depth work.

Corrected from the right-pane audit:

- SlickCharts is not "UI fetch 0". `useMarketValuation.ts` already fetches
  `sp500`, `nasdaq100`, drawdown, and index return files. The gap is broad
  depth, especially per-stock `metrics_history`, movers, dividends, treasury,
  currency, and large aggregate files.
- Indices are not "UI fetch 0". `useMarketValuation.ts` already fetches
  `sp500.json` and `nasdaq.json` and `MarketValuationClient` renders
  `indexTrends`. The gap is long-history/global integration, not total absence.
- Damodaran ERP is fetched and stored in hook state, but not rendered by
  `MarketValuationClient`; this remains a P0 render gap.
- Deleting "duplicate index files" is not accepted as a design decision yet.
  Files such as `stocks_index.json`, `per_bands_index.json`, `slick_index.json`,
  `dashboard.json`, and `metadata.json` should first be classified as runtime,
  build-aggregate, or admin-provenance assets by the depth usage manifest.

## Decision Summary

| Decision | Why |
| --- | --- |
| Keep Atlas as file coverage, but stop treating it as depth usage proof. | `consumerLane` is path heuristic; it does not prove field-level use. |
| Add a depth usage manifest before broad UI changes. | We need `file -> route/component -> field path` evidence, not just `file exists`. |
| Put decision-grade history into Market/Stock/Screener/Guru, and keep raw/provenance in Admin. | This prevents metadata cards from replacing actual data consumption. |
| Prioritize P0 runtime-impact holes before broad visual expansion. | Some data is fetched but not rendered, or fetched with likely shape mismatch. |
| Continue low-resource validation until approved otherwise. | No dev server/browser/Playwright was run in this audit. |

## Current Architecture Finding

```text
public/data/**/*.json
  -> static-route-manifest.ts
  -> /api/data/atlas
  -> Admin Data Lab inventory

Client pages
  -> mostly direct fetch('/data/...json')
  -> component-specific field parsing

Gap
  -> Atlas knows files.
  -> App knows selected fields.
  -> Nothing records nested field coverage across the app.
```

The next foundation should be a generated depth/usage layer:

```text
scripts/generate-data-usage-manifest.mjs
  inputs:
    - public/data/**/*.json shape summary
    - src/**/* fetch('/data/...') references
    - known dynamic fetch patterns
  outputs:
    - src/generated/data-usage-manifest.ts
    - Admin Data Lab "Depth Coverage" table
    - CI/report warning for unused important depth
```

This does not need to be perfect AST analysis on day one. A conservative
`rg`/parser hybrid is enough if it separates:

- inventory coverage: file exists in Atlas
- route coverage: file is fetched by code
- field coverage: nested field family is rendered or validated
- admin-only coverage: raw/provenance intentionally kept out of product UI

## Priority Map

| Priority | Work | Target surface |
| --- | --- | --- |
| P0 | ERP fetch-but-not-render, SlickCharts Admin shape mismatch, mirror health, stock revision history | Market, Admin, Stock/Screener |
| P0 | `weekly_revision_history`, `raw_financials`, `metrics_history`, `gainers/losers` | Stock, Screener, Explore |
| P1 | global benchmark regions, yearly returns, macro history drilldowns, sentiment internals | Market, Explore |
| P1 | 13F enhanced consensus, conviction entries, sector guru concentration | Superinvestors, Sectors |
| P1 | Damodaran region metrics, credit-rating spreads, historical ERP regimes | Market, Stock |
| P2 | raw converter sheets, fallback/provenance blocks, stale reference files | Admin Data Lab only |

## Implementation Slice 1: Market P0

Implemented in `100xfenok-next`:

- `/market-valuation` now renders Damodaran ERP instead of only fetching it:
  current US ERP, historical FCFE ERP latest year, historical percentile, country
  count, and top-risk countries from `damodaran/erp.json` plus
  `damodaran/historical_erp.json`.
- `/market-valuation` now surfaces ISM depth from `macro/activity-surveys.json`:
  manufacturing/services subcomponents, 1-month deltas, and expansion vs
  contraction counts.
- `/market-valuation` now surfaces bond/rates depth from
  `global-scouter/indicators/economic.json`: HY spread, 10Y yield, 10Y-2Y curve,
  and 10Y breakeven inflation with 4-week changes.
- `/market-valuation` now renders S&P 500 annual returns from
  `slickcharts/sp500-returns.json` as a constrained, horizontally scrollable
  history chart.
- Screener PER-band display/filter now ignores invalid band tuples instead of
  treating them as cheap, reducing false "저평가" rows and click-time display
  risk.

Deferred from this slice:

- Stock/Screener revision tabs and raw-financial depth.
- Explore movers leaderboard from large SlickCharts gainers/losers payloads.
- Superinvestors enhanced consensus and conviction panels.
- Admin Data Lab generated field-usage manifest.

Low-resource verification for this slice:

- PASS: `npx tsc --noEmit --pretty false`
- PASS: `npx eslint src/lib/market-valuation/types.ts src/hooks/useMarketValuation.ts src/app/market-valuation/MarketValuationClient.tsx src/lib/screener/bands.ts src/app/screener/ScreenerClient.tsx`
- PASS: `git diff --check`
- `[not verified]` browser/dev-server/Playwright rendering; intentionally skipped
  because the active constraint is low resource usage on the Mac mini.

## Implementation Slice 1B: UI Detail and Depth-2 Planning

Implemented in `100xfenok-next` after the second measured pass:

- `MarketThermometer` now exposes the already-present benchmark periods
  `1w`, `1m`, `3m`, `6m`, `ytd`, plus the latest completed yearly return from
  `yearly_returns`. The first viewport still stays on the six core index
  rows; the full 37-section benchmark matrix is reserved for a lower fold,
  drawer, or sub-route to avoid card overflow.
- `/market-valuation` S&P 500 annual returns now has visible latest/best/worst
  readouts, decade ticks, and hover/focus selection for year + return value.
- Screener expanded detail and `/stock/[ticker]` PER-band charts now place
  actual FY points and FY+1 on the same x-axis, with FY labels inside the SVG
  coordinate system and per-point value/title metadata.
- Screener revenue/EPS sparklines now preserve FY labels and can show FY+1
  estimate points instead of dropping nulls into an unlabeled value-only line.
- `/stock/[ticker]` financial bar charts now expose per-bar titles and a
  latest/next-estimate readout; the profitability panel also renders
  gross margin, operating margin, net margin, ROE, and ROA when present.

Depth-2 plan locked by measured coverage and peer/agent cross-check:

- Next product slice should be Stock/Screener revision and raw-financial depth.
  Data coverage is already broad: 1,066 detail files, `raw_financials` for all
  1,066, and weekly revision history for essentially the full universe.
- Do not bulk-fetch all 1,066 detail payloads into the screener list. Use
  on-demand detail panels, a focused revision tab, or precomputed lightweight
  summary indexes.
- Follow-up depth order: Stock/Screener `weekly_revision_history` +
  `raw_financials`; then SlickCharts per-stock `metrics_history`/returns/
  dividends; then Explore gainers/losers with freshness labels; then Guru
  enhanced consensus/conviction/by-sector.
- Desktop 125% type-scale is deferred from this patch. Measured risk is high
  for global font-size or browser-zoom style changes because AppShell rail,
  ticker, tabs, fixed table widths, and `nowrap` labels can reintroduce
  overflow. The safer path is a scoped `.fnk-shell` small-text enlargement
  pass with browser overflow QA.

## Implementation Slice 2A: Stock/Screener Revision and Raw Depth

Implemented in `100xfenok-next`:

- `/stock/[ticker]` overview now has a `리비전·원재무 깊이` section between
  financial trends and profitability/growth. It reads only the already-fetched
  Global Scouter detail payload.
- Screener expanded rows now reuse the same on-demand detail fetch and show
  compact `리비전·컨센서스` plus `원재무 깊이` blocks. The main screener list
  still fetches only `stocks_analyzer.json`.
- `eps_consensus.weekly.fy_plus_1/2/3` is used for the freshest EPS consensus
  readout and 1-week change. `weekly_revision_history.weekly_consensus_revision`
  is displayed as recent source-history rows, not as the primary latest signal.
- `raw_financials.periods` is the table axis for the canonical 8-period
  FY-4..FY+3 view. It is intentionally not zipped against legacy `years`
  because `years` is only FY-4..FY0.
- Unknown or missing tickers such as `SCHD` and `KORU` remain fail-closed:
  the app does not fabricate rows from absent detail/YF payloads.

Measured data shape for this slice:

- Detail files sampled: `AAPL`, `NVDA`, `MSFT`, `BNY`; all had
  `raw_financials.periods` length 8 and EPS weekly consensus rows.
- Local universe check: 1,066 detail files; `raw_financials.periods >= 8` for
  1,066; `eps_consensus.weekly.fy_plus_1 >= 2` for 1,066;
  `weekly_revision_history.weekly_consensus_revision >= 2` for 1,060.
- `SCHD` and `KORU` were absent from `data/global-scouter/stocks/detail`, so
  they are unsupported symbols in this local universe, not chart-data errors.

Deferred from 2A:

- Screener list-level revision presets/filters. They should use a generated
  lightweight summary index, not 1,066 detail JSON fetches in the browser.
- SlickCharts per-stock `metrics_history`, returns, and dividends. This is the
  next product slice after 2A.
- Browser/Playwright visual QA. It remains intentionally skipped during
  Mac-mini low-resource work unless explicitly approved.

Low-resource verification for this slice:

- PASS: `npx eslint src/app/screener/StockDetailPanel.tsx 'src/app/stock/[ticker]/StockDetailClient.tsx'`
- PASS: `git diff --check`
- `[blocked]` full `npx tsc --noEmit --pretty false` in the current worktree is
  blocked by an unrelated dirty `src/components/admin-live/AdminLiveBench.tsx`
  comparison error. This slice did not stage or edit that file.
- `[not verified]` browser/dev-server/Playwright rendering; intentionally
  skipped because the active constraint is low resource usage on the Mac mini.

## Implementation Slice 2B: SlickCharts Per-Stock Depth

Implemented in `100xfenok-next`:

- `/stock/[ticker]` now renders a `가격·수익률·배당` section after valuation,
  backed by `/data/slickcharts/stocks/{TICKER}.json`.
- Screener expanded rows now reuse the same on-demand SlickCharts component after
  the PER/revenue/EPS quick charts, before revision/raw-financial blocks.
- The new client hook uses a module-level cache and fail-closed 404 handling, so
  unsupported tickers do not trigger list-wide fetches or render errors.
- Rendered fields cover `current` plus `metrics_history` for price, market cap,
  trailing/forward PER, forward EPS, dividend yield, recent annual returns, and
  recent dividend rows.
- The component treats SlickCharts `dividend_yield` as a percent-number
  (`0.34 = 0.34%`), not as a fraction, and filters sparse/null metric rows before
  doing deltas.

Measured data shape for this slice:

- Per-stock SlickCharts files: 529 in both `data/slickcharts/stocks` and
  `100xfenok-next/public/data/slickcharts/stocks`.
- Source/public mirror check: filename diff 0 and content diff 0 in the read-only
  subagent audit.
- `metrics_history`: non-empty in 529 of 529, length range 1..6.
- `returns`: non-empty in 520 of 529, length range 0..65.
- `dividends`: non-empty in 431 of 529, length range 0..266.
- Sampled supported files: `AAPL`, `NVDA`, `MSFT`, `JPM`, `BNY`.
- `SCHD` and `KORU` remain absent from this SlickCharts universe and should stay
  normal missing-coverage cases.

Deferred from 2B:

- Full return-history charts and dividend cash-flow projection. The first product
  slice intentionally uses compact tables to reduce overflow and runtime risk.
- Screener list-level SlickCharts presets. They should use a generated summary
  index, not 529 per-row client fetches.
- Browser/Playwright visual QA. It remains intentionally skipped during
  Mac-mini low-resource work unless explicitly approved.

## Implementation Slice 2C: Explore Discovery Summary

Implemented in `100xfenok-next`:

- Added `scripts/build-slickcharts-discovery.mjs` to generate a lightweight
  `data/slickcharts/discovery-summary.json` plus public mirror.
- `/explore` now renders a `SlickCharts 리더보드` card in the right column after
  `리비전 무버`.
- The card exposes three compact views from the summary index:
  - latest SlickCharts daily gainers/losers,
  - 1Y return leaders/laggards,
  - high dividend yield and high DPS TTM names.
- The Explore footer data caption now includes SlickCharts.

Measured data shape for this slice:

- Raw `gainers.json`: 2.73 MB, 58 snapshots, latest 2026-06-08 with 251 rows.
- Raw `losers.json`: 3.02 MB, 59 snapshots, latest 2026-06-08 with 252 rows.
- Directly fetching both raw mover histories in Explore would cost about 5.7 MB,
  so the product surface reads only the generated 24 KB discovery summary.
- Summary sources include `gainers`, `losers`, `universe`,
  `global-scouter/core/stocks_analyzer`, and `global-scouter/core/slick_index`.

Deferred from 2C:

- Screener membership/weight filters. They should be added only after deciding
  whether to extend `stocks_analyzer.json` or create a dedicated screener index.
- `membership-changes`, `magnificent7`, and index concentration cards. These are
  good follow-up Explore/Market cards, but not needed for the first low-risk
  discovery slice.
- Static-route manifest refresh for the new summary file if Admin Data Lab needs
  to inventory it. Direct `/data/slickcharts/discovery-summary.json` fetch works
  from the public mirror without it.

## Dataset Findings

### Benchmarks, Indices, Yardeni

Measured depth:

- Benchmark raw files: 6 files, 37 sections, 30,441 weekly rows.
- `summaries.json`: 37 sections across `momentum`, `yearly_returns`,
  `source_summaries`.
- Canonical `data/indices` is one row fresher than `public/data/indices` for
  S&P 500 and Nasdaq.
- `yardney_model.json`: 1,872 rows, 1990-02-02 to 2026-06-05.

Current use:

- `/market-valuation` reads US benchmark series, summaries, S&P/Nasdaq trend,
  and Yardeni `spx/fair_value/premium_pct`.
- Global benchmark regions and `yearly_returns` are mostly Admin/legacy.
- Yardeni bond fields and metadata are mostly unused.

Placement:

- Market: global/region valuation matrix, yearly-return heatmap, factor detail
  drawer for `px_last`, `best_eps`, `best_pe_ratio`, `px_to_book_ratio`, `roe`.
- Yardeni card: add bond-yield inputs, spread context, and freshness/methodology
  drawer.
- Admin: show mirror health when root `data` and `public/data` drift.

### Macro, Sentiment, Computed, Calendar

Measured depth:

- Macro: 9 files; FRED has 22 series; `activity-surveys` has 924 records; TGA
  has 5,195 rows; stablecoins has 3,117 rows.
- Sentiment: 13 files; VIX 9,206 rows; CNN Fear & Greed 3,914 rows; Crypto Fear
  & Greed 3,047 rows; AAII 2,023 rows; CNN components 162 rows.
- Computed: 4 signals, including sentiment combo details.
- Calendar: 388 USD events, 234 future events, plus 11 previous-value joins.

Current use:

- Home/Market/Explore mainly render latest values, `overallStatus`, short event
  lists, and selected sentiment numbers.
- Rich history is mostly in legacy macro-monitor pages.
- Calendar previous-value join is title-based, not stable-id based.

Placement:

- Market: macro liquidity/rates strip, activity pulse drilldown, sentiment
  internals panel, stablecoin/TGA liquidity context.
- Explore: signal detail drawer for combo conditions and warning/buy reasons.
- Calendar: event detail tooltip with source link, previous value, category, and
  release freshness.
- Admin: raw TGA/stablecoin provenance and mirror health.

### SlickCharts

Measured depth:

- Top-level SlickCharts JSON: 39 files.
- Per-stock files: 529.
- `stocks/*.json` shape: `current`, `metrics_history`, `returns`, `dividends`.
- `metrics_history`: present in all 529 stock files, average length 5.74.
- Returns: average length 34.51, years 1962-2026.
- Dividends: non-empty in 431 of 529 files.
- Movers: `gainers` 58 history snapshots, latest 251 rows; `losers` 59 snapshots.
- `nasdaq100-ratio`: 6,848 rows.

Current use:

- Public Market fetches only `sp500`, `nasdaq100`, drawdown, and index returns.
- Admin Valuation Lab uses stock returns/dividends and per-stock current data.
- `metrics_history` is effectively unused.
- Admin Economy likely reads `treasury.rates` / `currency.data`, while files
  expose `history[0].rates` / `history[0].currencies`.

Placement:

- Stock: valuation strip from `metrics_history`; returns/dividends mini tabs.
- Explore: gainers/losers leaderboard and unusual movers.
- Market: concentration, ratio, drawdown, yearly return structure.
- Admin P0 fix: normalize treasury/currency reader shape.

### Global Scouter and YF

Measured depth:

- Global Scouter detail files: 1,066.
- YF finance files: 1,066 ticker files plus `_summary.json`.
- Detail coverage: `raw_financials` 8 periods for all 1,066; weekly revision in
  1,065; price history in 1,017.
- YF coverage: annual statements in 1,066; quarterly income in 1,047; dividends
  in 886; recommendations in 1,010.
- `_summary.json` says BRK.A/BRK.B failed, but current files exist; summary may
  be stale.

Current use:

- Screener list maps `stocks_analyzer.json` into flat fields.
- Expanded screener/stock detail uses some detail JSON, PER bands, financials,
  EPS, YF tabs, and 13F.
- Portfolio mostly uses price only.
- Revision history, standardized raw financials, weekly consensus changes, and
  detailed PER/Growth/PBR bands remain underused.

Placement:

- Stock: Revision tab from `weekly_revision_history`; raw financials as the
  canonical FY-4 to FY+3 table; PER/Growth/PBR valuation band detail.
- Screener: revision columns/filters, band filters, estimate-change presets.
- Portfolio: dividend cash-flow estimate from YF/SlickCharts dividends.
- Admin: raw consensus sheets and workbook inventory as provenance/QA only.

### SEC 13F

Measured depth:

- Manifest: v3.4.0, 46 files.
- Investors: 30 files, 614 filings, latest filing max 2026-05-15.
- `by_ticker`: 1,035 tickers.
- `by_sector`: 12 sectors.
- Analytics: consensus 1,019; enhanced consensus 1,019; buying pressure 1,218;
  new positions 544; conviction entries 114 + 75; portfolio views 30.

Current use:

- Superinvestors uses consensus, summary, by-ticker, investors, buying pressure,
  trades, new positions, HHI, conviction, portfolio views, turnover, trends, and
  options hedge.
- Stock uses by-ticker and trades ranking.
- `enhanced_consensus`, `conviction_entries`, and `by_sector` still have product
  value that is not fully surfaced.

Placement:

- Superinvestors Insights: enhanced consensus and conviction entry panels.
- Sectors/Guru: sector concentration and top-guru ownership by sector.
- Stock: "guru conviction" detail when ticker has enhanced consensus coverage.

### Damodaran

Measured depth:

- Manifest: v2.3.0, 7 files.
- `erp.json`: 178 countries; US ERP 5.03%; source date 2026-04-01.
- `historical_erp.json`: 66 years, 1960-2025.
- `industry_metrics.json`: 96 industries, 12 metric families.
- `industry_metrics_regions.json`: 7 regions, 17 dataset families.
- `credit_ratings.json`: 3 lookup tables, 15 rows each.
- `industry_benchmarks.json`: 96 industries and 123 YF industry mappings.

Current use:

- Stock uses `industry_benchmarks.json`.
- Market fetches `erp.json` but `MarketValuationClient` does not render the
  value.
- Historical ERP, region industry metrics, and credit-rating spreads are mostly
  Admin/legacy.

Placement:

- Market P0: current US ERP plus 1960-2025 percentile/regime chart.
- Stock: region-aware industry metrics for ADR/non-US comparisons.
- Valuation/WACC: credit-rating spread lookup.
- Admin: Damodaran explorer should load regional metrics too.

### Legacy `/100x/data`

`/market` still embeds legacy `/100x/data/*` surfaces outside the `/data` Atlas.
The category atlas is therefore not the whole app-data atlas. Add a separate
legacy manifest or migrate those files into the same inventory vocabulary.

## Implementation Design

### Phase 1: Depth Foundation

Deliverables:

- `scripts/generate-data-usage-manifest.mjs`
- `src/generated/data-usage-manifest.ts`
- Admin Data Lab "Depth Coverage" section:
  - file path
  - nested families
  - observed fetch route/component
  - product/Admin/no-consumer classification
  - latest date / row count / stale flag
- Mirror health card for root `data` vs `public/data`.

Low-resource verification:

- `node scripts/generate-data-usage-manifest.mjs`
- `node --check` for new scripts.
- `npx tsc --noEmit --pretty false`
- targeted lint for changed TS/JS.
- `git diff --check`.

### Phase 2: P0 Product Surfacing

Deliverables:

- Market:
  - render Damodaran US ERP and historical percentile/regime.
  - add macro/sentiment drilldowns without new hero/card sprawl.
- Stock/Screener:
  - add revision and raw-financial depth.
  - expose SlickCharts `metrics_history`, returns, dividends.
- Explore:
  - add gainers/losers leaderboard and signal detail drawer.
- Admin:
  - fix SlickCharts treasury/currency shape reader.

UI constraints:

- Dense, operational layouts; no decorative coverage card as a substitute for
  data use.
- Every card/table row must use constrained grid/flex, `min-width: 0`, wrapping
  text, and stable dimensions.
- Long tables may scroll inside a dedicated table viewport, not overflow their
  parent card.

### Phase 3: P1 Expansion

Deliverables:

- Market global benchmark matrix and yearly-return heatmap.
- Yardeni bond-field methodology drawer.
- Superinvestors enhanced consensus and conviction entries.
- Sector guru concentration view.
- Stock region-aware Damodaran metrics and credit-rating spread lookup.
- Portfolio dividend cash-flow estimate.

### Phase 4: P2 Admin-Only Depth

Deliverables:

- Raw converter/provenance drilldowns.
- Stale summary warnings, including YF `_summary.json`.
- Explicit "admin-only" badges for reference/fallback files.

## Verification Boundaries

Performed in this audit:

- `rg`, `jq`, `cmp`, `nl`, static file reads.
- `fh.sh diagnose` and `fh.sh peek` for right-pane state.
- No code writes except this planning document.

Not performed:

- `[not verified]` browser rendering.
- `[not verified]` dev server.
- `[not verified]` Playwright.
- `[not verified]` build.
- `[not verified]` runtime screenshots.

These remain intentionally skipped under the current low-resource constraint.

## Open Follow-up

When the right pane returns its final MiMo-side audit, merge only evidence-backed
delta into this document. Do not replace the current plan with peer opinion
unless it points to concrete file/line or measured data evidence.

## Implementation Slice 2C: Phase 2 Closeout Indexes

Implemented after the follow-up agent/Kimi review:

- Added `scripts/build-phase2-closeout-indexes.mjs`.
- Generated and mirrored:
  - `data/admin/data-usage-manifest.json`
  - `data/computed/stock_action_index.json`
  - `data/computed/market_structure_index.json`
  - matching files under `100xfenok-next/public/data/**`
- `stock_action_index` uses Global Scouter, YF quarter closes, SEC 13F
  holders/enhanced consensus/conviction/by-sector, SlickCharts universe,
  index analysis, returns, and dividends. It includes ticker normalization,
  market classification, action bucket/score, reasons, quarter-close coverage,
  and quality flags.
- `market_structure_index` uses benchmarks summaries, computed signal as-of
  dates, Damodaran credit-rating lookup tables, TGA/stablecoin histories, CNN
  component sentiment, membership changes, Mag7, and index concentration.
- Admin Data Lab now renders a `데이터 깊이 커버리지` proof section from
  `data/admin/data-usage-manifest.json` and freshness-guards the three generated
  files.
- Screener now fetches `stock_action_index` once, adds action labels/scores and
  an action filter/preset without bulk-fetching 1,066 detail payloads.
- Explore now has `액션 후보` and `시장 구조 인덱스` cards.
- Market Valuation now adds a cached `시장 구조 깊이` panel below the existing
  market-structure panel, without adding another item to the main
  `useMarketValuation` `Promise.all`.
- `static-route-manifest.ts` was regenerated once so the generated data files
  and the prior SlickCharts discovery summary are in the static data manifest.

Low-resource verification for this slice:

- PASS: `node --check scripts/build-phase2-closeout-indexes.mjs`
- PASS: `node scripts/build-phase2-closeout-indexes.mjs`
- PASS: `jq empty` for the three generated root JSON files and public mirrors.
- PASS: root/public `cmp` for the three generated mirrors.
- PASS: targeted ESLint for Screener, Explore, Market Valuation changed TS/TSX.
- PASS: `node --check` for Data Lab `dashboard.js`, `renderer.js`,
  `ops-console.js`.
- `[not verified]` browser/dev-server/Playwright rendering; intentionally
  skipped under the active low-resource Mac mini constraint.
