# DESIGN: Explore IA Reset After StockAnalysis Expansion

Date: 2026-06-18
Scope: `100xfenok-next/src/app/explore`
Status: Inventory accepted; public Explore surface grid removed pending
dedicated-tab completion.

## Problem

`/explore` drifted from a curated 30-second guide into a long content list.
The bloated route rendered 14 cards:

- Top signal strip: `SignalStrip` (`page.tsx:37-38`)
- Two-column workspace: `MarketThermometer`, `ExploreDashboard`,
  `ActionCandidatesCard`, `MyWatchlistStrip`, `WeekAheadCard`,
  `RevisionMoversCard`, `SlickchartsDiscoveryCard` (`page.tsx:40-53`)
- StockAnalysis/data surface grid: `EtfUniverseCard`,
  `MarketEventSurfacesCard`, `StockanalysisSurfaceInsightCard`,
  `SurfaceCatalogCard`, `DataCoverageCard`, `MarketStructureIndexCard`
  (`page.tsx:56-63`)
- 13F strip: `ExploreHotTopics` (`page.tsx:65-66`)

Correction applied after owner review on 2026-06-18: public `/explore` no
longer renders the StockAnalysis/market data surface grid
(`EtfGatewayCard`, `MarketEventSurfacesCard`,
`StockanalysisSurfaceInsightCard`, `MarketStructureIndexCard`). These data
families must be completed in their own tabs/routes first; Explore will be
re-selected afterward as a compact guide, not a catch-all catalog.

Existing IA decisions still stand:

- `/explore` is a 30-second routing and summary surface
  (`FORGE_feno_data_market_ia_20260612.md:30-35`).
- Market is the full ledger; Explore is curated preview
  (`FORGE_market_valuation_ledger_20260613.md:48-51`).

## Current Card Inventory

| Card | Placement | Primary data source | Current user job | IA tier |
| --- | --- | --- | --- | --- |
| `SignalStrip` | route top | `/data/computed/signals.json`, `benchmarks/summaries.json` through `loadSummaries` (`SignalStrip.tsx:29`, `SignalStrip.tsx:73-96`, `MarketThermometer.tsx:30-34`) | 3-second macro LED + market YTD read | L1 keep |
| `MarketThermometer` | left col | `/data/benchmarks/summaries.json` (`MarketThermometer.tsx:30-34`) | explain index return by price/EPS/multiple | L1 keep, compact |
| `ExploreDashboard` | left col | `/data/benchmarks/summaries.json` (`ExploreDashboard.tsx:34-41`) | sector 1M ranking preview | L1/L2 compact; drill to `/sectors` |
| `ActionCandidatesCard` | left col | `/data/computed/stock_action_summary.json` (`ActionCandidatesCard.tsx:37-41`) | calculated stock candidates | L2 keep, but one preview row group only |
| `MyWatchlistStrip` | right col | local watchlist + `/data/global-scouter/core/stocks_analyzer.json` (`MyWatchlistStrip.tsx:18-21`) | personal quick check | L1 keep when watchlist exists; hide/collapse empty |
| `WeekAheadCard` | right col | `/data/calendar/usd-calendar.json`, `prev-values.json` (`WeekAheadCard.tsx:28-46`) | near-term macro event risk | L2 keep |
| `RevisionMoversCard` | right col | `/data/global-scouter/core/revision_movers.json` (`RevisionMoversCard.tsx:23-26`) | EPS revision movers | L2 keep |
| `SlickchartsDiscoveryCard` | right col | `/data/slickcharts/discovery-summary.json` (`SlickchartsDiscoveryCard.tsx:61`) | returns/dividend leaderboard | L2 or move behind drilldown; overlaps mover/candidate mental model |
| `EtfUniverseCard` | surface grid | `/data/stockanalysis/etf_universe.json` (`EtfUniverseCard.tsx:45`) | ETF search/filter preview | L3 move to `/etfs`; Explore shows only a compact CTA/insight |
| `MarketEventSurfacesCard` | surface grid | StockAnalysis surface APIs: new ETF, earnings, actions, splits, pre/after hours (`MarketEventSurfacesCard.tsx:100-106`) | earnings/actions/session radar | L2 keep as "Today's events" module, not catalog |
| `StockanalysisSurfaceInsightCard` | surface grid | 14 StockAnalysis surface APIs: movers, IPO, industries (`StockanalysisSurfaceInsightCard.tsx:89-102`) | broad surface sampler | L3 split: IPO/industry/movers drilldowns; do not show all at once |
| `SurfaceCatalogCard` | surface grid | `/api/data/stockanalysis` (`SurfaceCatalogCard.tsx:31`) | catalog/coverage metadata | Admin-only; remove from public Explore |
| `DataCoverageCard` | surface grid | `/api/data/stockanalysis`, `/api/data/market-quality` (`DataCoverageCard.tsx:65-68`) | collection health/coverage | Admin-only; remove from public Explore |
| `MarketStructureIndexCard` | surface grid | `/data/computed/market_structure_index.json` (`MarketStructureIndexCard.tsx:23-27`) | concentration/rebalance/sentiment preview | L3 one-line headline only; drill to `/market-valuation` |
| `ExploreHotTopics` | bottom | `/data/sec-13f/analytics/trades_ranking.json` (`ExploreHotTopics.tsx:73`) | 13F hot topics | L2 keep but compact strip |

## StockAnalysis Surface Inventory

`stockanalysis/surfaces/index.json` currently reports 25/25 successful surfaces,
37 tables, and 14,143 rows. The high-volume groups are:

- ETF: `etf_screener` 5,347 rows, `new_etfs` 100 rows.
- Earnings/actions: `earnings_calendar` 3,690 rows,
  `actions_recent` 1,958 rows, `actions_splits` 500 rows.
- IPO: `ipos_filings` 455, `ipos_recent` 205, `ipos_withdrawn` 129.
- Industry: `industries`, `industries_all`, `industry_semiconductors`,
  `sector_technology`.
- Market movers: 8 surfaces, 20 rows each.

ETF universe has 5,280 records and classification counts: leveraged 649,
inverse 246, single-stock 107. This belongs to `/etfs` as the canonical surface;
Explore should not render the full ETF working surface.

## Diagnosis

The page feels long because it now mixes four different jobs at the same level:

1. **Guide**: What matters now?
2. **Action**: What should I inspect next?
3. **Directory**: What datasets exist?
4. **Ops**: Is the pipeline healthy?

The guide/action jobs belong on `/explore`. Directory and ops jobs belong behind
`/etfs`, `/market-valuation`, `/superinvestors`, `/admin/data-lab`, or a specific
drilldown page.

## Peer Inventory Consensus

Right-pane read-only inventory independently matched the main conclusions:

- `EtfUniverseCard` is a full ETF working surface and should move to `/etfs`,
  with only a compact Explore CTA/insight remaining.
- `SurfaceCatalogCard` and `DataCoverageCard` are admin/ops visibility and
  should move to `/admin/data-lab`.
- `StockanalysisSurfaceInsightCard` is the largest information-wall risk because
  it packs gainers, losers, active, week/month/YTD movers, IPO, industry, and
  semiconductors into one public card.
- `ActionCandidatesCard`, `RevisionMoversCard`, `SlickchartsDiscoveryCard`,
  `MarketEventSurfacesCard`, and `ExploreHotTopics` all answer "what should I
  watch next"; they should be consolidated into a smaller L2 action rail rather
  than stacked as independent long cards.

Tier nuance:

- `WeekAheadCard` can act as L1 when a high-importance event is near; otherwise
  it belongs in the L2 event rail.
- `MarketStructureIndexCard` is valuable, but advanced market internals are L3;
  Explore should expose at most one headline and drill to `/market-valuation`.

## Proposed IA

### L1: 3-Second Market Brief

One first-screen block:

- `SignalStrip` as macro LEDs.
- One compact thermometer verdict: S&P 500 / Nasdaq / semis only, not six full
  mini-ledgers.
- One "what changed" line derived from the strongest L2 event: earnings/action,
  revision, structure, or 13F.

### L2: Today / This Week Action Rail

Three to five compact modules:

- Calendar + earnings/actions combined as "Event Risk".
- Revision movers + action candidates combined as "Stock Workbench Preview".
- Market structure + sector flow combined as "Market Internals".
- 13F hot topics as "Institutional Signal".

Each module must show one headline, 2-3 rows, and a route link. No raw catalog
counts unless they directly explain the investment action.

### L3: Exploration Hubs

Dedicated route or drawer surfaces:

- `/etfs`: ETF universe, leverage/single-stock/inverse filters, new ETF radar,
  provider/theme surfaces, holdings detail.
- `/market-valuation`: full market ledger and structure details.
- `/superinvestors`: 13F drilldown.
- `/screener`: action candidates and stock discovery.
- `/admin/data-lab`: catalog, freshness, coverage, parity warnings, pipeline
  health.

## Implementation Slices

1. **No-code inventory gate**: agree this map with the right pane and user.
2. **Public Explore cleanup first**: remove/collapse `SurfaceCatalogCard` and
   `DataCoverageCard` from public `/explore`; keep them in Admin Data Lab.
   Completed in the first cleanup slice:
   - Data Lab already exposed coverage, freshness, ETF classification,
     backfill, market facts, and source parity.
   - Data Lab was extended with a StockAnalysis surface catalog audit reading
     `data/stockanalysis/surfaces/index.json`.
   - Public `/explore` stopped rendering `SurfaceCatalogCard` and
     `DataCoverageCard`.
3. **ETF hub promotion**: keep `/etfs` as canonical. Public Explore must not
   host the ETF working surface or a dense ETF gateway until `/etfs` itself has
   the full owner-facing hierarchy: universe, leverage/single-stock/inverse
   filters, new ETF radar, provider/theme views, and detail pages.
   - `/etfs` remains the canonical ETF workspace and accepts `type` deep-links
     for leveraged, single-stock, and inverse filters.
   - Public `/explore` no longer renders `EtfGatewayCard`; any future ETF
     teaser must be one compact headline chosen after the ETF tab is complete.
4. **SurfaceInsight split, not collapse**: `StockanalysisSurfaceInsightCard`
   should not be compressed into a public all-in-one card. Movers, IPO,
   industry, earnings, and corporate actions need dedicated destination
   surfaces first, then Explore may route to them with one chosen headline.
   - Public `/explore` no longer renders `StockanalysisSurfaceInsightCard`.
   - `/market/events` is the first dedicated destination for earnings,
     corporate actions, IPO, industry, and market-mover surfaces. It reads the
     surface JSON/API directly and keeps Explore out of the catalog role.
   - Remaining route design: decide whether IPO, industry, and movers deserve
     their own deeper subroutes after `/market/events` stabilizes.
5. **Event module merge**: combine `WeekAheadCard` and
   `MarketEventSurfacesCard` into one "Event Risk" preview.
   Completed in the fourth cleanup slice:
   - `MarketEventSurfacesCard` now reads both macro calendar JSON
     (`usd-calendar.json`, `prev-values.json`) and StockAnalysis event
     surfaces through one loader/cache.
   - Public `/explore` no longer renders a separate `WeekAheadCard`.
   - The merged card uses compact tabs for Macro, Corporate, and Session risk,
     keeping mobile height controlled while preserving drilldown rows and Data
     Lab evidence access.
6. **Stock workbench merge**: combine `RevisionMoversCard`,
   `ActionCandidatesCard`, and the returns/dividend/mover leaderboard into one
   preview.
   Completed in the fifth cleanup slice:
   - Public `/explore` now renders a single `StockWorkbenchCard` instead of
     separate `ActionCandidatesCard`, `RevisionMoversCard`, and
     `SlickchartsDiscoveryCard` cards.
   - The merged card keeps compact tabs for Action, Revision, Movers, and
     Returns/Dividends. Action retains the guru/value/index sub-filters without
     expanding the whole page.
   - Daily StockAnalysis mover gateways stay in `StockanalysisSurfaceInsightCard`
     to avoid duplicate same-page fetch/render of the same market mover rows.
7. **Mobile smoke gate**: 390px and 1440px `/explore`, overflow 0, first-screen
   contains L1 + at least one L2 signal, no metadata-only cards.
8. **Dedicated tab gate before Explore re-entry**: a data family can return to
   Explore only after its canonical tab/route has a stable data contract,
   freshness label, filter/sort model, empty-state behavior, and detail
   navigation.

## Non-Negotiables

- Do not hide data forever. Move it to the correct home and keep it reachable.
- Do not use Explore as the first home for newly collected data. Canonical
  tabs/routes come first; Explore is selected afterward.
- Do not show provider/source names as product copy unless needed for evidence.
- Do not expose ops metadata on public Explore as a card.
- Every row must be generated from DataPack/API data, not static mock copy.
- Data updates must flow through existing JSON/API consumers without manual text
  edits.
