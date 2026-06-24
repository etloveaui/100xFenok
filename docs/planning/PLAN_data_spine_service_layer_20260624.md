# P9 Data Spine Service Layer Plan

> Status: in progress. Goal: turn the Data Spine from "fresh and accurate datasets" into graph-backed service affordances across portfolio, screener, stock detail, and ETF workflows.

## Decisions

- Keep the existing three-layer graph shape: full `entity_graph.json`, lightweight `entity_graph_stock_index.json`, and detailed `entity_graph_stock_services.json`.
- Do not create a new DB or server-side portfolio sync in P9-C. Portfolio data remains browser-local; public DataPack JSON is read-only service context.
- Keep `connection_count` semantics as core four sources only: market facts, filings, 13F, index membership. Service expansion uses `service_count` and sidecars.
- Use source-specific freshness rules. 13F is quarterly and must not be judged by a seven-day rule.
- No bulk external fetch/backfill, notification hook, paid provider, or new production credential path in this slice.

## Phase P9-A — Residual Data Spine Cleanup

- [x] Remove macro-monitor FDIC browser external fallback. It now reads same-origin `/data/macro/fdic-tier1.json` only and fails visibly when the DataPack is unavailable.
- [ ] Classify remaining browser chart prototypes: `tools/asset/multichart.html`, `tools/asset/config.js`, and `admin/design-lab/charts/v*.html`.
- [ ] Classify non-quote GAS sentiment writers: `admin/market-radar/scripts/{cnn,cnn-components,cftc,move}.gs`.
- [ ] Keep quote.v1 and Treasury TGA closed unless building the deferred cached live-quote snapshot service.

## Phase P9-B — Graph Contract Hardening

- [x] Tighten `qa:data-graph` around service flags, `connection_count`, `service_count`, and stock-services sidecar parity.
- [x] Add source-specific freshness helper for graph consumers.
- [ ] Add future ETF lightweight index only if ETF service affordances need graph source_as_of without loading the full graph.

## Phase P9-C — User-Facing Service Layer

- [x] Add Portfolio data-connection service panel using existing graph index/services.
- [x] Support `/portfolio?ticker=...` prefill so stock/ETF/screener flows land in the add-holding form.
- [x] Add per-holding service actions: stock detail, filing tab, 13F view, single-stock ETF compare/detail, screener focus.
- [x] Add source freshness badges with 13F quarter-safe handling.
- [x] Surface compact connection state in portfolio mobile cards and desktop holdings table.
- [x] Add screener connection CSV export for filtered result sets.
- [x] Add screener detail-panel portfolio CTA and stock-detail footer portfolio CTA.
- [x] Add stock-detail sector deep link into `/screener?sector=...` using the actual screener sector value.

## Quality Gates

- `npm run qa:data-graph`
- `npm run qa:copy`
- `npx tsc --noEmit --pretty false`
- `npm run build`
- Browser smoke: `/portfolio?ticker=NVDA`, `/screener?sector=반도체`, `/stock/NVDA`, `/etfs/SPY`
- Mobile/a11y smoke: at least `/portfolio`, `/screener`, `/stock/NVDA`

## Notes

- P9-C is service scope, not recommendation scope. Copy must frame graph links as data navigation and provenance, not buy/sell advice.
- Missing or typo tickers in a local portfolio must degrade to "connection data unavailable" without breaking price evaluation.
- The stock index payload is about 1 MB; use the existing cached loader and do not fetch per holding.
