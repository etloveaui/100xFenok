# P9 Data Spine Service Layer Plan

> Status: in progress. Goal: turn the Data Spine from "fresh and accurate datasets" into graph-backed service affordances across portfolio, screener, stock detail, and ETF workflows.

## Decisions

- Keep the existing three-layer graph shape: full `entity_graph.json`, lightweight `entity_graph_stock_index.json`, and detailed `entity_graph_stock_services.json`.
- Do not create a new DB or server-side portfolio sync in P9-C. Portfolio data remains browser-local; public DataPack JSON is read-only service context.
- Keep `connection_count` semantics as core four sources only: market facts, filings, 13F, index membership. Service expansion uses `service_count` and sidecars.
- Use source-specific freshness rules. 13F is quarterly and must not be judged by a seven-day rule.
- No bulk external fetch/backfill, notification hook, paid provider, or new production credential path in this slice.
- Keep the native macro multi-chart as a separate P9-D/P10/P11 service route program, not mixed into the P9-C export/provenance patch. Direction accepted from the platform-level `docs/superpowers/specs/2026-06-24-macro-multichart-vision.md`: replace the legacy `/multichart` iframe with a Data Spine-native `/macro-chart` route.

## Phase P9-A — Residual Data Spine Cleanup

- [x] Remove macro-monitor FDIC browser external fallback. It now reads same-origin `/data/macro/fdic-tier1.json` only and fails visibly when the DataPack is unavailable.
- [x] Classify remaining browser chart prototypes: `tools/asset/multichart.html` + `tools/asset/config.js` are migrate candidates with public live-data config disabled; `admin/design-lab/charts/v1-v6.html` are retired live-data prototypes; `v7-singularity.html` is an explicit no-fetch design exception.
- [x] Classify non-quote GAS sentiment writers: `admin/market-radar/scripts/{cnn,cnn-components,cftc,move}.gs` are deprecated backups. Runtime ownership moved to `scripts/fetch-sentiment.mjs` + `.github/workflows/fetch-sentiment.yml`, with GAS execution guarded by `ALLOW_DEPRECATED_GAS_SENTIMENT=true`.
- [ ] Keep quote.v1 and Treasury TGA closed unless building the deferred cached live-quote snapshot service.

## Phase P9-B — Graph Contract Hardening

- [x] Tighten `qa:data-graph` around service flags, `connection_count`, `service_count`, and stock-services sidecar parity.
- [x] Add source-specific freshness helper for graph consumers.
- [x] Add alias-backed single-stock ETF underlying resolution with no silent ticker invention. Service links now expose `resolution_source`, `matched_alias`, and non-direct `resolution_note`; ambiguous alias collisions no longer resolve through first-wins fallback; unresolved single-stock ETFs are emitted as diagnostics; `qa:data-graph` enforces the fields and diagnostics shape.
- [ ] Add future ETF lightweight index only if ETF service affordances need graph source_as_of without loading the full graph.

## Phase P9-C — User-Facing Service Layer

- [x] Add Portfolio data-connection service panel using existing graph index/services.
- [x] Support `/portfolio?ticker=...` prefill so stock/ETF/screener flows land in the add-holding form.
- [x] Add per-holding service actions: stock detail, filing tab, 13F view, single-stock ETF compare/detail, screener focus.
- [x] Add source freshness badges with 13F quarter-safe handling.
- [x] Surface compact connection state in portfolio mobile cards and desktop holdings table.
- [x] Add screener connection CSV export for filtered result sets.
- [x] Add screener single-stock ETF sidecar fields to connection CSV and a compare shortcut for filtered rows with multiple service-linked ETFs.
- [x] Add stock-detail single-stock ETF CSV export plus explicit compare action.
- [x] Add screener detail-panel portfolio CTA and stock-detail footer portfolio CTA.
- [x] Add stock-detail sector deep link into `/screener?sector=...` using the actual screener sector value.
- [x] Add ETF compare CSV export from `/etfs/compare`.
- [x] Add ETF holdings CSV export from `/etfs/[ticker]`.
- [x] Add ETF detail underlying-stock and same-underlying ETF compare actions for graph-resolved single-stock ETFs.
- [x] Add portfolio JSON backup download and graph connection CSV export.

## Phase P9-D — Native Macro Chart

- [x] Review and accept the Kimi-authored final vision as a separate service-layer candidate, not a G2/G3 scope addition.
- [x] P0: add an initial 30-series macro catalog plus pure alignment/transform helpers for raw, rebase100, YoY, and period-change transforms.
- [x] P1: add native `/macro-chart` route with three default presets, searchable picker, URL state, CSV export, and legacy `/multichart` redirect.
- [x] P1a.5: harden `/macro-chart` as a public service route with mobile-first chart/picker layout, URL state for `range` + hidden series, explicit 8-series cap copy, search debounce, loading/error/retry affordances, CSV smoke, and `qa:macro-chart` contract coverage.
- [x] P2: add localStorage user presets, explicit auto/left/right axis controls, keyed axis URL round-trip, storage/corruption guards, saved preset QA, and Explore macro playbook entry points.
- [x] P3a: add dependency-free chart depth controls: 3M/6M/3Y ranges, zoom in/out range stepping, browser PNG export, spread/ratio derived formula series with URL/localStorage/CSV coverage, and shared Chart.js hover crosshair rendering.
- [ ] P1b: decide whether Chart.js `TimeScale` + adapter is worth adding. Current implementation intentionally keeps ISO category labels to avoid a new dependency/install boundary.
- [ ] P3b: evaluate true brush/wheel/pinch zoom and multi-chart crosshair sync only if the dependency/runtime tradeoff beats the current range-window controls.

## Phase P9-E — Product Affordance Deepening

- [x] Add screener row selection with page select, filtered-result select, selected connection CSV, and selected single-stock ETF compare action.
- [x] Add Explore macro playbook entry points into curated `/macro-chart` routes so the service is reachable from the discovery workflow.
- [ ] Continue Explore/Stock/ETF polish only where it strengthens existing service navigation. Avoid adding graph generation work unless a product surface needs a smaller artifact.

## Phase P9-F — Observability and Provider Policy

- [x] Add Admin/Data Lab service-layer status from existing generated artifacts: product surface readiness, entity graph, and macro-series catalog.
- [x] Keep workflow diagnostics Admin-only. Public pages keep the short `DataState` Korean status contract and do not expose coverage/provider/internal diagnostic copy.
- [ ] Notification hooks and active failed-source alerts remain deferred and approval-gated.
- [ ] Provider/quota policy remains contract-first: no new external fetch, paid provider, production credential, or live quota probe in this slice.
- [ ] Refresh external quota docs before relying on Gemini/Search-grounding limits. Current local reference was fetched 2026-06-05 and may be stale.

## Quality Gates

- `npm run qa:data-graph`
- `npm run qa:etf-compare`
- `npm run qa:copy`
- `npm run qa:macro-chart`
- `npx tsc --noEmit --pretty false`
- Scoped lint for touched product/data files
- `npm run build`
- Browser smoke: `/portfolio?ticker=NVDA`, `/screener?sector=반도체`, `/stock/NVDA`, `/etfs/SPY`
- Macro smoke: `/macro-chart`, `/multichart` redirect, CSV export, PNG export, mobile picker, share URL `range` + hidden-series + keyed axis + formula round trip, saved user preset apply, corrupted saved hidden-state handling, range zoom controls, Explore playbook links.
- Mobile/a11y smoke: at least `/portfolio`, `/screener`, `/stock/NVDA`

## Notes

- P9-C is service scope, not recommendation scope. Copy must frame graph links as data navigation and provenance, not buy/sell advice.
- Missing or typo tickers in a local portfolio must degrade to "connection data unavailable" without breaking price evaluation.
- The stock index payload is about 1 MB; use the existing cached loader and do not fetch per holding.
- `/macro-chart` reads only static `/data/...json` files. Time-axis and new dependency work is intentionally deferred until the install/runtime tradeoff is explicit. The P3a derived-series calculator runs on already-loaded transformed chart values, persists only URL/localStorage state, and does not introduce a server-side portfolio or account sync path.
