# Data Spine Program

Date/status: 2026-06-19; P0 inventory measured, P1 passed, v0 ratification RATIFIED.
Updated: 2026-06-23; productization bridge added after feno-value provider-boundary closure.

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
| ETF universe records | 5,333 | MEASURED |
| ETF candidate symbols | 5,390 | MEASURED |
| ETF covered detail files | 5,286 | MEASURED |
| ETF detail coverage | 98.07% | MEASURED |
| Primary StockAnalysis detail coverage | 84.81% | MEASURED |
| Yahoo fallback ETF detail files | 715 | MEASURED |
| Fenok Edge scored ETF lane | 4,484 | MEASURED |
| Fenok Edge full ETF fetchable daily-1Y gaps | 243 | MEASURED / FULL-UNIVERSE DIAGNOSTIC |
| Fenok Edge ETF Core Daily Basket | 118 fresh / 0 stale | MEASURED / SERVICE GATE READY |
| StockAnalysis stock detail files | 40 | MEASURED |
| StockAnalysis financial candidate files | 40 | MEASURED |
| Backfill hard errors | 0 | MEASURED |
| Backfill pending tracked ETF rows | 117 | MEASURED |
| Backfill ready for finalize | warn | MEASURED |

## 2026-06-23 Productization Bridge

This section converts the Data Spine from "data contract cleanup" to product
work. The feno-value provider-boundary phase is closed in CCH as of
2026-06-23, so the next work is not more adapter cleanup by default. The next
load-bearing question is which 100x screens expose the contract, freshness, and
unavailable states clearly.

Measured current baseline:

```sh
python3 scripts/audit-data-spine-inventory.py --json
```

- `generated_at`: `2026-06-23T07:52:05Z`
- root JSON files: 17,273
- public JSON files: 17,326
- tracked dataset groups: 28
- `computed/market_facts/tickers`: 6,445 ticker payloads
- `yf/finance`: 1,820 cached finance payloads
- `global-scouter/stocks/detail`: 1,066 stock detail payloads
- `stockanalysis/etfs`: 5,286 covered ETF detail payloads across 5,390 candidates
- `stockanalysis/stocks`: 40 stock overview payloads
- `stockanalysis/financials`: 40 financial candidate payloads
- `edgar-korean-summaries`: 1,821 JSON files, 202 by-ticker manifests
- `sec-13f`: 78 JSON files
- `slickcharts`: 569 JSON files

### 2026-06-23 F2 foreign-filer closeout

The filings layer is no longer the immediate Data Spine blocker. The 20
previously uncovered foreign filers now each have one evidence-grounded Korean
summary artifact generated through the self/session path, with no external
LLM/API quota used:

- coverage: 202/202 by-ticker manifests have at least one ready summary
- QA: `node scripts/check-edgar-summary-evidence.mjs` passed across 2,424
  filings, 7,513 bullets, and 4,636 evidence rows
- mirror: source and public by-ticker manifests are byte-identical for the 20
  foreign-filer updates
- exception: BNS best-per-ticker accession `0001193125-26-258920` lacked a
  substantive evidence body and was logged as skipped; replacement accession
  `0001193125-26-240503` is a valid BNS 6-K and is the ready summary row

Next Data Spine work should therefore focus on the residual quote/treasury
mirror productization path, not another feno-value adapter cleanup pass.

Product judgment:

- ETF Center data/UI coverage is surface-ready: 5,390 candidates, 5,293 covered
  detail files, 98.20% detail coverage, 716 auxiliary Yahoo fallback files, and
  explicit missing/retry status.
- Fenok Edge ETF scoring is split: 4,484 eligible/scored ETFs are PUBLIC-surfaced
  plus rolling full-universe daily-1Y diagnostic
  (`3,703 complete + 243 fetchable + 538 inception-limited`), while the ETF
  service DAILY/GATED gate is the Core Daily Basket (`118 fresh / 0 stale`).
- Stock detail is usable for covered names, but not yet a universal financial
  statement product: StockAnalysis stock/financial candidate coverage is 40
  files, while Global Scouter stock detail is 1,066 and cached finance is 1,820.
- Filing summaries are a valuable stock-detail layer, but not a standalone URL
  family. The pilot route redirects to `/stock/NVDA?tab=filings`; keep stock
  detail as the public owner.
- Market/event/sector surfaces are substantial enough to productize:
  `earnings_calendar` has 3,690 records, `actions_recent` has 1,958 records,
  `new_etfs` has 100 records, `industries` has 11 tables / 145 rows, and
  `ipos_statistics` is available as a table surface.
- Market source parity remains action-bearing: 26,629 multi-candidate rows,
  22,309 agreements, 1,841 value drifts, 1,953 stale rows, 418 sign
  divergences, and 108 percent-scale warnings. Product surfaces must show
  coverage/freshness state instead of silently treating all values as equal.

### Surface Responsibility Map

| Public surface | Product responsibility | Data Spine owner |
|---|---|---|
| `/explore` | 30-second routing/summary surface only | show compact signals and links, not raw catalogs |
| `/market-valuation` | market valuation and regime reads | benchmarks, Damodaran/Yardeni, macro, sentiment, market structure |
| `/market/events` | earnings, actions, IPO, movers event workspace | StockAnalysis surfaces and event-specific DataPack files |
| `/sectors` | sector/industry taxonomy and constituents | benchmarks, StockAnalysis industries, 13F sector overlays |
| `/etfs` and `/etfs/new` | ETF universe, new launches, segments, detail routing | StockAnalysis ETF universe/screener/details/coverage + market facts |
| `/stock/[ticker]` | ticker-level unified analysis | market facts, Global Scouter, cached finance, StockAnalysis candidates, 13F, filings |
| `/screener` | stock discovery and sortable table | static analyzer provider + computed action indexes |
| `/superinvestors` | 13F investor intelligence | SEC 13F converted DataPack and enrichment audit |
| `/admin/data-lab` | operator audit, coverage, freshness, QA | market audit, parity, ETF coverage, surface consumers, freshness guards |

### Strict Unavailable Matrix for Product Surfaces

feno-value strict mode already has a required-field registry in
`claude-code-hub/docs/products/skills/feno-value/references/DATA_SPINE_PROVIDER_CLEANUP.md`
and a test guard at
`docs/products/skills/feno-value/scripts/tests/unit/test_data_spine_required_fields.py`.
100x should surface those unavailable states as product state, not hide them.

| Domain | Current DataPack coverage | Product rule |
|---|---|---|
| Price / market cap / beta | `market_facts` canonical, 6,445 payloads | show as connected when market facts exist; otherwise no valuation claim |
| Cached finance / estimates | 1,820 cached finance payloads | financial/statistics tabs are available only when cache exists |
| Global Scouter detail | 1,066 detail payloads | keep as stock-detail/screener base, not universal stock coverage |
| StockAnalysis stock/financial candidates | 40 + 40 payloads | display as cross-check/auxiliary only; do not claim SSOT valuation input |
| ETF details | 5,293 covered detail payloads | ETF Center surface-ready; missing detail candidates should render fallback/pending states |
| Fenok Edge ETF scored lane | 4,484 scored ETFs; full daily-1Y diagnostic is `3,703 complete + 243 fetchable + 538 inception-limited`; Core Basket is `118 fresh / 0 stale` | Full lane is PUBLIC + diagnostic/backfill only; ETF service DAILY/GATED is Core Basket scoped |
| 13F / superinvestors | 78 SEC 13F JSON files | show reporting-delay disclaimers; enrichment coverage percentages stay Admin-only |
| Korean filings | 1,821 JSON files / 202 by-ticker manifests | stock `공시` tab owner; source links and AI-summary disclaimer required |
| Market parity | 26,629 multi-candidate checks | Data Lab keeps drift/stale/sign diagnostics; public product copy stays compact |

### 1-5 Productization Goal

1. Data Coverage Matrix: keep regenerated inventory and strict unavailable
   matrix visible in this program doc and Data Lab.
2. Site map / screen responsibility: keep the surface map above as the
   routing rule; Explore is a guide, dedicated pages own detail.
3. Initial implementation: stock detail now shows a data-driven "데이터 연결
   상태" card from the loaded DataPack mirrors, without exposing provider brand
   names in public copy.
4. Interpretation engine v1: deterministic first, LLM later. Start with
   coverage-aware copy generated from data states, then promote to report
   snippets only when source/freshness/provenance are attached.
5. Legacy cleanup: treat `/market` iframe, old static report HTML, macro-monitor
   live fallbacks, and non-quote GAS/admin HTML endpoints as audit candidates.
   Do not delete until an owner, replacement route, and redirect/archival policy
   are decided.

### Legacy / Cleanup Audit Baseline

Read-only route inventory on 2026-06-23:

- Next app `page.tsx`: 40
- API `route.ts`: 25
- public HTML files: 185
- `RouteEmbedFrame` wrapper pages: 16

Cleanup candidates are candidates only; deletion requires a replacement route,
redirect/archive policy, and explicit approval.

| Candidate | Current evidence | Product action |
|---|---|---|
| `/market` | `src/app/market/page.tsx` previously embedded `/100x/100x-main.html` through `RouteEmbedFrame` by default | default `/market` now redirects to `/market-valuation`; `?path=100x/...` remains a compatibility bridge until legacy Market Wrap retirement is approved |
| Static asset sync | `100xfenok-next/package.json` `sync-static` copies `../100x`, `../alpha-scout`, `../tools`, `../ib`, `../admin`, and `../data` into `public/` | audit which copied folders still have public owners before removing |
| Legacy bridge | `src/lib/server/legacy-bridge.ts` sanitizes public file paths for embedded legacy pages | keep while wrapper pages exist; remove only with wrapper retirement |
| GitHub Pages/static SPA traces | root `README.md`, `_legacy/onesignal`, and root `initBaseHref.js` document old static hosting/notification paths | `initBaseHref.js` now treats both `pages.dev` and `workers.dev` as root-base Cloudflare hosts; archive static-host docs only after live Cloudflare route policy is final |
| Legacy indexing policy | root `robots.txt` allows standard crawlers while root `index.html` carries `noindex, nofollow` | decision pending; do not change indexing/robots until owner chooses public-indexing SSOT for the legacy mirror |
| Superinvestors duplicate load | `portfolio_views.json` is read by both `SuperinvestorsClient` and `PortfolioCharts` | candidate for shared hook/cache, not user-visible priority |
| Admin/GAS quote helpers | routed exceptions still keep legacy fallbacks | keep under quote.v1 policy until live quote service exists |

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
| 1 | `100xfenok-next/src/lib/server/ticker.ts` + `100xfenok-next/src/lib/quote-contract.ts` | `quote.v1` live quote gateway | RATIFIED 2026-06-22: shared quote contract; provider internals remain sanctioned live exception until a Data Spine live-quote service exists |
| 1 | `ib/ib-total-guide-calculator.html` | same-origin `/api/ticker/{symbol}` consumer | CLOSED 2026-06-22: browser Yahoo/CORS proxy removed; long-term quote-service migration remains under `ticker.ts` |
| 1 | `ib/ib-helper/apps-script/yahoo-quotes.gs` | CNBC primary + quote.v1 fallback GAS quote helper | ROUTED 2026-06-22: CNBC remains primary; quote.v1 is first fallback before direct Yahoo |
| 1 | `admin/market-data/yahoo-quotes.gs` | quote.v1 primary admin GAS quote helper | ROUTED 2026-06-22: quote.v1 primary plus Yahoo OHLC enrichment; Yahoo fallback retained |
| 1 | `admin/market-radar/scripts/yahoo-quotes.gs` | quote.v1 primary admin/radar GAS quote helper | ROUTED 2026-06-22: quote.v1 primary plus Yahoo OHLC enrichment for Prices sheet |
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
- `100xfenok-next/src/lib/quote-contract.ts` defines the shared `quote.v1`
  boundary for `/api/ticker/{symbol}` and `/api/ticker?symbol={symbol}`.
  `100xfenok-next/src/lib/server/ticker.ts` remains the single sanctioned live
  provider gateway behind that contract; consumers use the route boundary.
- `tools/macro-monitor/shared/data-fetcher.js` is a partial legacy live-data
  module, not part of the Next product Data Spine surface. Current code reads
  FRED macro files, Treasury TGA, stablecoins, and FDIC Tier1 from same-origin
  JSON DataPacks. The FDIC `api.fdic.gov` browser fallback was removed on
  2026-06-24. Later on 2026-06-24, the asset chart prototype live providers
  were retired from public browser execution and non-quote admin/GAS sentiment
  writers were absorbed into the scheduled sentiment collector.
- GAS endpoints are legacy/admin routed exceptions, not primary Next Data Spine
  consumers. As of 2026-06-22, the three live quote helpers route through
  quote.v1 where safe while preserving legacy fallbacks:
  `admin/market-data/yahoo-quotes.gs`,
  `admin/market-radar/scripts/yahoo-quotes.gs`, and
  `ib/ib-helper/apps-script/yahoo-quotes.gs`.
  Other GAS/admin endpoints remain classified:
  `notification-control-panel-web.html:219,294`, `admin/stats.html:131,141`,
  `admin/api-test.html:105,125,144,169`, and
  `admin/design-lab/main/main-candidate.html:249`.
- Scheduled workflow collectors are allowed emitters, not product runtime leaks:
  `.github/workflows/fetch-fdic.yml`, `fetch-fred-banking.yml`,
  `fetch-fred-macro.yml`, `fetch-treasury-tga.yml`, and `fetch-defillama.yml`.
- `/api/data?dataset=treasury-tga` is now a compatibility facade over the
  scheduled `data/macro/tga.json` DataPack mirror first, with live FiscalData as
  fallback only when the mirror is unavailable.

### 2026-06-23 product-state slice

P1 productization is bounded to a status layer, not a full live-quote snapshot
pipeline. The quote gateway keeps its sanctioned live provider internals, but
the contract now exposes freshness/status fields so consumers can say whether
the value is live/transitional, stale, unavailable, or error.

Implemented product state primitives:

- `100xfenok-next/src/lib/data-state.ts` defines the shared screen state union:
  `ready`, `partial`, `stale`, `pending`, `unavailable`, `error`.
- `100xfenok-next/src/components/DataStateNotice.tsx` is the public render
  primitive for compact readiness/freshness copy; diagnostic variants stay out
  of public routes.
  `label`, `detail`, `reason`, and hover titles are user-facing copy and must
  stay free of source names, raw route counts, coverage percentages, and audit
  links.
- `100xfenok-next/src/lib/quote-contract.ts` carries `state.quoteStatus`,
  `asOf`, and `staleAfter` so quote consumers can distinguish delayed and
  unavailable values without adding a snapshot pipeline.
- `100xfenok-next/src/app/api/data/route.ts` now exposes
  `schemaVersion: "treasury-tga.v1"`, `dataset`, `lastUpdated`, `staleAfter`,
  and shared `DataState` metadata for the legacy Treasury TGA facade. The normal
  path is still the scheduled DataPack mirror; live Treasury FiscalData remains a
  compatibility fallback, but successful fallback data is still marked `ready`
  and only `source`/`reason` expose the mirror outage.
- `portfolio`, `screener`, screener detail, stock detail connection/price, and
  all mounted `/explore` cards consume the shared state primitive for
  unavailable, pending, partial, and error states instead of silent blank
  panels.
- Stock detail keeps its small local `DataConnectionState` adapter as a
  compatibility shim in this slice; the rendered status is mapped to
  `DataReadinessStatus`. A later cleanup may remove the adapter once the tab
  panels are fully migrated.
- `/market-valuation` and `/sectors` are render-layer retrofits only: their
  existing freshness/source hooks remain intact while their public badges use
  the same state primitive.
- `100xfenok-next/src/app/portfolio/PortfolioClient.tsx` no longer fabricates
  sample prices. Missing quotes render as unavailable/partial and are excluded
  from valuation totals instead of using hard-coded values.
- `scripts/generate-product-surface-coverage.mjs` builds
  `data/admin/product-surface-coverage.json` from existing local DataPack
  coverage/freshness files. This is an observability aid, not a substitute for
  screen-level state handling.
- Admin/Data Lab reads the product-surface coverage artifact to expose
  screen-level readiness diagnostics. Public `/market-valuation`, `/sectors`,
  and `/etfs` must keep this as compact freshness/trust copy, not a diagnostic
  card.
- 2026-06-23 P2 reliability hardening extends the state contract to the browser
  gate itself: `/explore`, `/screener`, `/stock/NVDA`, `/stock/ZZZZ`,
  `/market-valuation`, and `/sectors` must expose at least one public
  `DataStateNotice` or `DataStateBadge` on desktop/mobile/fold checks.
- `/explore` keeps the compact product surface: the signal strip shows a
  readiness/as-of badge, not an admin-style coverage card. Admin diagnostics
  stay in Data Lab.
- Stock detail and screener detail empty states should prefer the shared
  DataState primitive over silent empty grids or standalone "no data" strings.
- `npm run build` intentionally runs `sync-static`; when root DataPack/static
  sources are newer than the mirrored `100xfenok-next/public/...` files, the
  build-clean action is a separate static mirror refresh commit rather than
  mixing large generated diffs into product-code commits.

Verification gate:

- `npm run qa:quote-contract`
- `npm run qa:treasury-contract`
- `npm run qa:copy`
- `npm run qa:market-audit`
- `npm run qa:data-state`
- Dev route gate: run Next dev on a free port, for example
  `npx next dev --webpack -p 3107`, then
  `QA_BASE_URL=http://127.0.0.1:3107 QA_DEV=1 npm run qa:browser:p2`.
- Local production route gate: `npm run start:qa -- -p 3106`, then
  `QA_BASE_URL=http://127.0.0.1:3106 npm run qa:browser:p2` and
  `QA_BASE_URL=http://127.0.0.1:3106 npm run qa:a11y:p2`.
  `start:qa` sets `FENOK_LOCAL_PROD_QA=1`; deployed Workers do not set this
  env, so the local 5000-request rate-limit allowance remains QA-only.
- `npm run build`
- scoped ESLint on touched Next files and QA scripts
- `npx tsc --noEmit --pretty false`
- `git diff --check`

Known non-blocking build warning class:

- Turbopack can warn about broad dynamic filesystem reads in
  `100xfenok-next/src/lib/server/data-loader.ts` and
  `100xfenok-next/src/lib/server/public-assets.ts`. These readers intentionally
  support local `public/data` files plus Cloudflare `ASSETS` fallback. Treat the
  warning as a documented P3 infrastructure cleanup unless it becomes a build
  failure or a trivial misconfigured glob is identified. Do not let warning
  chasing block the P2 product-state closeout.

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
   - RATIFIED: `quote.v1` is the shared `/api/ticker` contract. `ticker.ts`
     remains a sanctioned internal provider exception until a Data Spine
     live-quote service exists. P1 exposes freshness/status metadata only; a
     full cached quote snapshot service remains deferred.
3. Data catalog refresh:
   - DRAFT/UNVERIFIED: reconcile `data/README.md` counts with measured current
     data counts.
4. Korean filing summaries:
   - DRAFT/UNVERIFIED: separate LLM track with cost/provider/anchor validation.
   - Surface/route RESOLVED by DEC-246 (stock `공시` tab first; NVDA pilot → `/stock/NVDA?tab=filings`; by-ticker manifest). Cost/provider/scaling stays user-gated.
5. Legacy runtime fetch exceptions:
   - `quote.v1` + `ticker.ts` are ratified as the live quote gateway contract
     and internal provider exception.
   - Static stock-analyzer product consumers are now routed through
     `StaticStockAnalyzerDataProvider` and `action-summary-provider`; direct UI
     reads of `global-scouter/core/stocks_analyzer.json` and
     `computed/stock_action_summary.json` are closed outside those provider
     boundaries.
   - `DS-P1-003/004/006` GAS quote helpers are now routed exceptions: quote.v1
     is used as the shared price boundary, but legacy fallbacks remain for OHLC
     and CNBC pre/post-market quality.
   - `macro-monitor` FDIC fallback, non-quote GAS sentiment writers, and legacy
     chart prototype live provider paths were closed on 2026-06-24.
   - `/api/data?dataset=treasury-tga` is routed through the scheduled TGA mirror
     first; live Treasury FiscalData remains fallback-only and now emits
     `treasury-tga.v1` state/freshness metadata when used.
     The scheduled workflow writes source + public mirrors and runs
     `qa:treasury-contract` before committing.
   - feno-value has a DataPackProvider consumer path, but direct valuation-engine
     providers remain separate exceptions until each path is promoted or routed.

## Next Work

1. Keep Daily Wrap report metadata; defer revival until report automation exists.
2. P1: freeze the per-field authority/fallback/tolerance/disagreement matrix
   using the measured 28-dataset inventory and `market_source_parity`.
3. P1/P2: residual legacy direct-provider surfaces were closed on 2026-06-24:
   `tools/asset` public chart config was stripped of live proxy/key values,
   `multichart.html` is reopened only under the P15-0 owner-owned Stooq Worker
   proxy exception with no repo accumulation and 24h browser localStorage cache,
   `admin/design-lab` chart variants v1-v6 are retired from live data, and
   `admin/market-radar/scripts/{cnn,cnn-components,cftc,move}.gs` are
   deprecated backups behind an explicit opt-in guard. Quote and Treasury are
   contracted/routed; do not reopen them unless building the deferred cached
   live-quote snapshot service.
4. Filings: prioritize the foreign-filer 6-K / 20-F / 40-F path before any
   top-300/top-400 EDGAR expansion.
5. Revisit low-sample `total_assets` and `forward_pe` authority-only candidates.
