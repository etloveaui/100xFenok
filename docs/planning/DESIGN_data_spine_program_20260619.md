# Data Spine Program

Date/status: 2026-06-19; P0 inventory measured, P1 passed, v0 ratification RATIFIED.

## Purpose

Data Spine is the umbrella program that connects the current 100x market data
work with feno-data, feno-data-remote, and feno-value without turning every
follow-up into one mega-epic.

The spine has two layers:

1. Contract layer: provider roles, provenance, freshness, parity, fallback, and
   disagreement policy.
2. Consumer layer: 100x UI surfaces, feno-data reads, feno-data-remote reads,
   and feno-value provider adapters consuming the contract-served data.

The contract layer is load-bearing. UI work may continue in parallel only when
it consumes data already emitted through the DataPack or a documented API route.

## Non-Negotiables

- DRAFT/UNVERIFIED sections are not authoritative.
- The v0 per-field contract is not frozen until the P0 inventory is complete.
- "Use all data" means every served value needs source/provenance/freshness
  context, not merely a larger UI.
- feno-value must keep independent golden-output gates; provider changes cannot
  be driven by UI deadlines.
- Korean filing summaries are a separate LLM/cost/verification track.

## P0 Inventory Snapshot

Measured locally on 2026-06-19 from `data/` in this repo.

Current durable P0 inventory artifacts:
`DATA_SPINE_P0_INVENTORY_20260619.md` and
`scripts/audit-data-spine-inventory.py`. The script is the read-only baseline
for `dataset -> emitter -> schedule -> asOf/freshness -> provenance -> consumers`,
separating runtime consumers, pipeline references, and repo-local workflow
evidence.

Current headline: 28 dataset groups, 15,451 root JSON files, and 15,505 public
JSON files. `data/README.md` still reports older headline counts; use the P0
inventory artifact for current counts until the catalog README is refreshed. The
0 root-only / 54 public-only delta is accounted for through `benchmarks` and
`public.report_metadata`; consumer guard later found `public.report_metadata`
is live-consumed. User decision: KEEP as an intentional placeholder for a
future report-publishing pipeline; revival is deferred until automation exists.

## StockAnalysis / ETF Coverage Baseline

Measured from `data/stockanalysis/index.json` and
`data/computed/market_data_audit.json`.

| Metric | Value | P0 status |
|---|---:|---|
| ETF universe records | 5,280 | MEASURED |
| ETF candidate symbols | 5,347 | MEASURED |
| ETF detail files | 5,265 | MEASURED |
| ETF detail coverage | 98.47% | MEASURED |
| Primary StockAnalysis detail coverage | 85.64% | MEASURED |
| Yahoo fallback ETF detail files in market facts | 686 | MEASURED |
| StockAnalysis stock detail files | 40 | MEASURED |
| StockAnalysis financial candidate files | 40 | MEASURED |
| Backfill hard errors | 0 | MEASURED |
| Backfill expected 404 rows | 723 | MEASURED |
| Backfill ready for finalize | true | MEASURED |

## Current Parity / Disagreement Baseline

Measured from `data/computed/market_source_parity.json` generated at
`2026-06-21T00:43:25Z`. These counts are a data snapshot; rerun
`scripts/audit-data-spine-p1.py` after refreshes.

| Metric | Value |
|---|---:|
| Inspected ticker files | 6,445 |
| Fields with parity checks | 19 |
| Multi-candidate field rows | 26,629 |
| Agreement rows | 22,309 |
| Value-drift rows | 1,841 |
| Stale rows | 1,953 |
| Sign-divergence rows | 418 |
| Percent-scale warnings | 108 |

Sample top disagreements already prove that parity alerts need an action policy:

| Ticker | Field | Selected source | Other source | Diagnosis |
|---|---|---|---|---|
| TDSB | `return_1m` | `stockanalysis.detail.performance` -0.2240 | `stockanalysis.etf_screener.performance` +0.2244 | sign_divergence |
| FXB | `return_1y` | `yf.history_1y` +1.2328 | `yf` -1.2296 | sign_divergence |
| GDXW | `return_3m` | `yf.history_1y` -6.8462 | `stockanalysis.detail.history` +6.7927 | sign_divergence |

V0 ratification: `DATA_SPINE_V0_RATIFICATION_20260619.md` +
`scripts/audit-data-spine-v0.py`; authority/fallback still mirrors
`scripts/build-market-facts.py`, while ratified tolerance/action constants live
in `scripts/data_spine_policy.py` and are consumed by the P1/V0 audits.

## Direct Provider Fetch Leak Inventory

P0 grep command:

```sh
rg -n "stockanalysis\\.com|slickcharts\\.com|query[12]\\.finance\\.yahoo|finance\\.yahoo\\.com|yfinance" \
  100xfenok-next/src admin ib scripts 100x \
  --glob '!**/node_modules/**' --glob '*.{py,ts,tsx,js,jsx,gs,html,mjs}'
```

Raw result: 59 hits across 50 unique files. The table below groups every hit by
file/pattern and separates real fetchers from tests and string-only references.

### Classified grep output

| Hits | File / pattern | Match type | P0 classification |
|---:|---|---|---|
| 1 | `100xfenok-next/src/lib/server/ticker.ts` | live provider fetch | RATIFIED: sanctioned live quote gateway until a Data Spine live-quote service exists |
| 1 | `ib/ib-total-guide-calculator.html` | same-origin `/api/ticker/{symbol}` consumer | CLOSED 2026-06-22: browser Yahoo/CORS proxy removed; long-term quote-service migration remains under `ticker.ts` |
| 1 | `ib/ib-helper/apps-script/yahoo-quotes.gs` | legacy GAS provider fetch | CLASSIFIED 2026-06-22: explicit IB exception |
| 1 | `admin/market-data/yahoo-quotes.gs` | admin GAS provider fetch | CLASSIFIED 2026-06-22: explicit admin exception |
| 1 | `admin/market-radar/scripts/yahoo-quotes.gs` | admin/radar GAS provider fetch | CLASSIFIED 2026-06-22: explicit admin/radar exception |
| 1 | `admin/market-radar/scripts/vix.gs` | deprecated admin/radar GAS provider fetch | CLOSED 2026-06-22: sunset; replaced by scheduled `scripts/fetch-sentiment.mjs` collector |
| 3 | `100x/daily-wrap/fetcher.py` | deprecated legacy publication PoC | CLOSED 2026-06-22: sunset; future Daily Wrap automation should use Data Spine/report contracts |
| 1 | `scripts/fetch-yf-finance.py` | allowed scheduled collector | Allowed collector |
| 1 | `scripts/fetch-stockanalysis.py` | allowed scheduled collector | Allowed collector |
| 1 | `scripts/probe-stockanalysis-financials.py` | allowed read-only probe | Allowed collector/probe |
| 2 | `scripts/build-quarter-closes.py` | allowed generated-data builder using yfinance | Allowed collector |
| 2 | `scripts/fetch-sentiment.mjs` | allowed generated-data builder using Yahoo chart API | Allowed collector |
| 37 | `scripts/scrapers/*.py` | allowed SlickCharts scrapers | Allowed collector |
| 3 | `scripts/fetch-yf-finance-v0.py` | deprecated old PoC fetcher | CLOSED 2026-06-22: sunset; replaced by `fetch-yf-finance.py` + workflow |
| 1 | `scripts/test_fetch_stockanalysis_fixtures.py` | test fixture string | Test/string reference, not a fetch leak |
| 1 | `scripts/test_fetch_yf_finance_selection.py` | test stub string | Test/string reference, not a fetch leak |
| 1 | `scripts/build-market-facts.py` | source/provenance string reference | Build string reference, not a fetch leak |

Generated/public mirror hits are intentionally excluded from the action list
unless the source file above remains active.

### 2026-06-22 expanded recheck

Peer/subagent recheck expanded the scan beyond the original P0 pattern to
`tools/`, macro providers, GAS endpoints, and CCH consumers. Result:

- No unexplained runtime `StockAnalysis` / `SlickCharts` / Yahoo scrape was found
  in the Next product surfaces. StockAnalysis runtime reads go through
  `/api/data/stockanalysis/*` or `/data/stockanalysis/*`; SlickCharts/YF runtime
  reads are DataPack JSON except for the sanctioned quote gateway.
- `100xfenok-next/src/lib/server/ticker.ts:1-2` remains the single sanctioned
  live quote gateway; exposed by `/api/ticker` routes and used by dashboard,
  sector data, footer ticker bar, and admin-live tools.
- `tools/macro-monitor/shared/data-fetcher.js` is a partial legacy live-data
  module, not part of the Next product Data Spine surface. Current code reads
  FRED macro files, Treasury TGA, and stablecoins from same-origin JSON first
  (`:534-594`, `:612-639`, `:699-717`), while FDIC still keeps an external
  `api.fdic.gov` fallback after the local JSON attempt (`:650-675`). Classify as
  migration debt: remove or proxy the FDIC fallback when this tool is promoted
  back into product runtime.
- GAS endpoints are legacy/admin exceptions, not Data Spine consumers:
  `notification-control-panel-web.html:219,294`, `admin/stats.html:131,141`,
  `admin/api-test.html:105,125,144,169`, and
  `admin/design-lab/main/main-candidate.html:249`.
- Scheduled workflow collectors are allowed emitters, not product runtime leaks:
  `.github/workflows/fetch-fdic.yml`, `fetch-fred-banking.yml`,
  `fetch-fred-macro.yml`, `fetch-treasury-tga.yml`, and `fetch-defillama.yml`.

## Consumer Inventory

Known consumers from the current contract note, grep, the inventory script, and
CCH skill files.

Measured commands:

```sh
python3 scripts/audit-data-spine-inventory.py --json
rg -n "fetch\\(|/api/data/|/data/" 100xfenok-next/src/app 100xfenok-next/src/components \
  100xfenok-next/src/lib admin tools
```

Measured snapshot as of 2026-06-22:

- root JSON files: 17,273; public JSON files: 17,327; tracked datasets: 28.
- DataPack datasets with runtime consumers include `computed.market_facts`,
  `computed.market_data_audit`, `computed.market_source_parity`,
  `computed.signals`, `computed.stock_action`, `computed.market_structure`,
  StockAnalysis index/ETF/stock/financial/surface/backfill, `yf.finance`,
  Global Scouter, SlickCharts, SEC 13F, benchmarks, Damodaran, macro, sentiment,
  calendar, yardney, indices, admin manifests, catalog manifests, and public
  report metadata.

File-level consumer map:

- Central reader/facades:
  - `100xfenok-next/src/lib/server/data-loader.ts:67-95` reads local public JSON
    with Cloudflare asset fallback.
  - `data-loader.ts:201-234` maps public paths to consumer lanes.
  - `data-loader.ts:536-665` exposes StockAnalysis manifests, assets, ETF
    universe, and surfaces from DataPack.
  - `data-loader.ts:714-790` exposes SEC 13F and market-quality manifests.
  - `/api/data/*` route facades cover atlas, benchmarks, damodaran, macro,
    market-quality, sec-13f, sentiment, slickcharts, and StockAnalysis.
- Stock and filings:
  - `/stock/[ticker]` reads Global Scouter, cached YF finance, StockAnalysis
    ETF/stock/financials, SEC 13F, Damodaran benchmarks, and per-ticker surfaces
    (`StockDetailClient.tsx:61,90,193,206,219,241`,
    `StockTabs.tsx:144`, `TickerSurfaceEventsCard.tsx:48`).
  - Korean filing summaries read `/data/edgar-korean-summaries/*`
    (`edgarKoreanSummaries.ts:1,55,61,100`; `EdgarSummaryClient.tsx:317`).
- ETF center:
  - `/etfs`, `/etfs/new`, and `/etfs/[ticker]` read StockAnalysis snapshot,
    surfaces, coverage, ETF detail, and computed market facts
    (`EtfSurfaceSnapshotCard.tsx:101,307`, `NewEtfsList.tsx:74,93`,
    `EtfDetailClient.tsx:178,212`).
- Explore / market / sectors / screener / superinvestors:
  - Explore reads benchmarks, market-quality, StockAnalysis surfaces, computed
    signals/actions/market structure, calendar, Global Scouter, SlickCharts, and
    SEC 13F analytics (`ExploreDashboard.tsx:40`, `DataCoverageCard.tsx:65,68`,
    `MarketEventSurfacesCard.tsx:115-122`, `SignalStrip.tsx:29`,
    `StockWorkbenchCard.tsx:108-110`, `EtfUniverseCard.tsx:150,166`).
  - Market events and sectors read StockAnalysis surfaces through contract routes
    (`MarketEventsClient.tsx:138`, `IndustryMapPanel.tsx:62`).
  - Screener detail reads SEC 13F, SlickCharts stock rows, computed market facts,
    and Global Scouter detail (`ScreenerClient.tsx:796,807`,
    `StockDetailPanel.tsx:562,603,721,773`).
  - Superinvestors reads SEC 13F analytics
    (`InsightsTab.tsx:26-86`, `SuperinvestorsClient.tsx:73,131,744`,
    `GuruTrendBlock.tsx:48,66`, `PortfolioCharts.tsx:42`).
- Admin/Data Lab and admin-live:
  - `admin/data-lab` reads manifest, field usage, market audit/parity,
    StockAnalysis coverage/backfill, and freshness surfaces.
  - `100xfenok-next/src/lib/server/admin-live-tools.ts:318-325` exposes a
    `feno-data` live tool that reads local DataPack context; the UI toggle lives
    at `components/admin-live/AdminLiveBench.tsx:376-380`.
- feno-data local:
  - exposes `data audit`, `data stockanalysis {etf|stock|financials|surface|coverage}`,
    and public categories including `computed`, `stockanalysis`, `yf`,
    `slickcharts`, `sec-13f`, `benchmarks`, `macro`, `calendar`, and `yardney`.
- feno-data-remote:
  - exposes the same public financial categories except `admin`; helper reads
    Cloudflare first and GitHub Raw fallback.
- feno-value:
  - `DataPackProvider` resolves local `100xFenok/data` first, then public data
    route and GitHub Raw fallback.
  - provider helpers cover `computed/market_facts`,
    `computed/market_data_audit`, `computed/market_source_parity`, `yf/finance`,
    StockAnalysis ETF universe/screener/new ETF/coverage/stock/financial/surface.
  - `fetch_financial_statement_candidate()` keeps StockAnalysis financials as
    cross-check candidates only, not DCF inputs.
  - Boundary: feno-value still contains direct provider paths for yfinance, SEC
    EDGAR, SEC 13F live fallback, Stooq, Siblis, and mixed EV/Sales fallback
    flows. Do not count those paths as Data Spine consumers until each one is
    explicitly routed through DataPack or documented as a valuation-engine
    exception.

Evidence:

- `claude-code-hub/docs/products/skills/feno-data/SKILL.md:45-50`
- `claude-code-hub/docs/products/skills/feno-data/SKILL.md:195-212`
- `claude-code-hub/docs/products/skills/feno-data/SKILL.md:320-328`
- `claude-code-hub/docs/products/skills/feno-data-remote/SKILL.md:24-38`
- `claude-code-hub/docs/products/skills/feno-data-remote/SKILL.md:45-60`
- `claude-code-hub/docs/products/skills/feno-value/SKILL.md:167-181`
- `claude-code-hub/docs/products/skills/feno-value/scripts/providers/datapack.py:122-154`
- `claude-code-hub/docs/products/skills/feno-value/scripts/providers/datapack.py:316-377`
- `claude-code-hub/docs/products/skills/feno-value/scripts/core/policy.py:303-356`

P0 consumer inventory is now file-level measured for 100x Next/admin surfaces and
CCH skill consumers. It does not claim browser runtime execution success; live
route smoke belongs to the implementation slices that change those surfaces.

## Draft Contract Matrix

This matrix is intentionally DRAFT/UNVERIFIED. It records the expected contract
shape, not the frozen v0 policy.

SSOT relationship:

- Implemented-now resolver behavior lives in
  `DESIGN_market_data_source_contract_20260617.md` under `Resolver Policy` and
  mirrors `scripts/build-market-facts.py`.
- The matrix below is the future Data Spine v0 target to ratify after P0
  inventory, exception classification, and P1 disagreement-policy work.
- If this matrix conflicts with the implemented resolver policy before v0
  ratification, the implemented resolver policy wins.

| Field group | Candidate authority | Fallback / cross-check | Disagreement action |
|---|---|---|---|
| Stock quote/latest | computed market facts | Yahoo, StockAnalysis quote, ticker route | DRAFT/UNVERIFIED |
| ETF holdings/swap rows | StockAnalysis ETF detail | issuer CSV later, Yahoo funds data | DRAFT/UNVERIFIED |
| ETF quote/history | Yahoo history or market facts | StockAnalysis detail history/performance | DRAFT/UNVERIFIED |
| Direct index constituents | SlickCharts | StockAnalysis ETF proxies SPY/QQQ/DIA | DRAFT/UNVERIFIED |
| Stock forward estimates/revisions | Global Scouter | Yahoo, StockAnalysis overview | DRAFT/UNVERIFIED |
| Stock financial statements | Yahoo current, SEC EDGAR future | StockAnalysis financial candidates | DRAFT/UNVERIFIED |
| 13F holdings/positions | SEC EDGAR converted DataPack | market facts enrichment | DRAFT/UNVERIFIED |
| Market events | StockAnalysis surfaces | Yahoo/SEC later | DRAFT/UNVERIFIED |
| Macro/valuation factors | FRED/Yardeni/Damodaran/Benchmark Excel | none or source-specific mirrors | DRAFT/UNVERIFIED |

## Proposed Phase Gates

These gates are proposed. They become ratified only when P1 freezes the v0
contract and the disagreement policy.

### P0 Done

- Dataset inventory lists source path, emitter, freshness/asOf, provenance
  status, and current consumers.
- Direct-provider fetch leaks are measured by grep and classified.
- At least one sample disagreement report is attached from local parity output.
- All unfilled contract sections remain marked DRAFT/UNVERIFIED.

### P1 Done

- Enumerated per-field authority/fallback/tolerance/disagreement action matrix.
- Provider promotion policy is documented.
- Served values expose source/provenance/freshness.
- Direct provider exceptions are either documented or converted to contract
  routes.

### B Done

- Enumerated fields are within tolerance or intentionally flagged.
- Every served value has provenance.
- Data Lab can show freshness, parity, and unresolved disagreement status.

### A Done

- 100x features consume only contract-served data or explicitly documented
  legacy exceptions.
- No unexplained direct Yahoo/StockAnalysis/SlickCharts provider fetch remains
  in product runtime.
- Dedicated StockAnalysis routes vs service-map overlap has a decided IA policy.

### feno-value Gate

- Frozen input snapshot and output golden are paired.
- Rebaseline requires explicit approval.
- Provider expansion cannot auto-regenerate baselines.

## Open Design Decisions

1. StockAnalysis dedicated routes vs service-map overlap:
   - **RESOLVED by DEC-246 (2026-06-20)**: dedicated pages own their surfaces; Explore is preview-only. Cross-route ownership SSOT = `FORGE_feno_data_market_ia_20260612.md` (Placement Map), NOT service-map. Industry→`/sectors`, filings→stock `공시` tab, ETF families→`/etfs` segments, shared market 3-tab nav. UI plan is NOT duplicated here — see DEC-246.
2. Live quote route policy:
   - RATIFIED: `ticker.ts` is a sanctioned live-gateway exception until a
     Data Spine live-quote service exists.
3. Data catalog refresh:
   - DRAFT/UNVERIFIED: reconcile `data/README.md` counts with measured current
     data counts.
4. Korean filing summaries:
   - DRAFT/UNVERIFIED: separate LLM track with cost/provider/anchor validation.
   - Surface/route RESOLVED by DEC-246 (stock `공시` tab first; NVDA pilot → `/stock/NVDA?tab=filings`; by-ticker manifest). Cost/provider/scaling stays user-gated.
5. Legacy runtime fetch exceptions:
   - `ticker.ts` is ratified as a live quote exception.
   - `macro-monitor` FDIC fallback and GAS/admin HTML endpoints are classified,
     but not yet migrated.
   - feno-value has a DataPackProvider consumer path, but direct valuation-engine
     providers remain separate exceptions until each path is promoted or routed.

## Next Work

1. Keep Daily Wrap report metadata; defer revival until report automation exists.
2. P1: freeze the per-field authority/fallback/tolerance/disagreement matrix
   using the measured 28-dataset inventory and `market_source_parity`.
3. P1: decide exception handling for `macro-monitor` FDIC fallback, GAS/admin
   HTML endpoints, and feno-value direct provider paths.
4. Filings: prioritize the foreign-filer 6-K / 20-F / 40-F path before any
   top-300/top-400 EDGAR expansion.
5. Revisit low-sample `total_assets` and `forward_pe` authority-only candidates.
