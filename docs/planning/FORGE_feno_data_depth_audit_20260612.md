# FORGE: feno-data Depth Audit and UI Design

Date: 2026-06-12
Scope: `100xfenok-next` nested data depth, real consumer usage, and next UI placement.
Status: Investigation/design. No runtime code changes in this document.

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
