# PLAN: Public Product Surface Cleanup

> Status: complete; release through `deploy-worker.yml` after main push
> Owner mandate: finish the full 1-6 cleanup goal, not just planning.
> Scope: public 100xFenok product surfaces in `100xfenok-next`.
> Out of scope without explicit approval: live deploy, bulk data backfill, top300/top400 expansion, ETF full backfill, long or parallel Playwright, multiple Next dev servers.

## User Decisions

- Public tone: expert plus easy explanation.
- Explore is a gateway and overview, not the depth owner.
- Dedicated destinations own depth: Market, Sectors, ETF, Screener, Guru, Portfolio, Stock, Filings.
- Internal diagnostics belong in Data Lab/Admin, not public product pages.
- Kimi is a near-peer IA/copy/design reviewer; Codex owns integration, implementation, and verification.

## Route Map

| Surface | Route | Depth Owner | Cleanup Rule |
| --- | --- | --- | --- |
| Home | `/` | Market brief entry | Keep first-read product value, no diagnostics. |
| Explore | `/explore` | Gateway/overview | Link into depth pages; avoid acting like a second ETF/market/screener owner. |
| Market | `/market`, `/market-valuation`, `/regime`, `/market/events` | Market ledger | Persistent section nav; no Explore peer-tab duplication. |
| Sectors | `/sectors` | Sector/industry taxonomy | Own industry maps and constituents. |
| ETF | `/etfs`, `/etfs/new`, `/etfs/[ticker]` | ETF depth | Own ETF filters, segments, provider lists, and ETF detail. |
| Screener | `/screener` | Stock search/workbench | Own broad stock filtering and drilldown. |
| Guru | `/superinvestors` | 13F/guru depth | Own investor and by-ticker 13F analysis. |
| Portfolio | `/portfolio` | Local portfolio tool | Device-local portfolio management only. |
| Stock | `/stock/[ticker]` | Ticker ledger | Own valuation, filings, events, 13F, ETF fallback. |
| Filings | `/stock/[ticker]?tab=filings`; `/filings/nvda-10k` alias | Stock filing tab | Summary/original/translation affordances; standalone pilot redirects to stock. |
| Admin | `/admin/*` | Internal diagnostics | Data Lab, Voice Lab, Design Lab, coverage/readiness/catalog tools. |

## Measured Risks

- `/live-bench` renders `AdminLiveBench` directly on a public route while `/admin/live` already exists behind `AdminLayout`.
- 2026-06-24 follow-up: `/live-bench` had been redirected, but middleware still rewrote `/admin/live` back to `/live-bench/`, bypassing `AdminLayout`. Remove that rewrite and keep `/live-bench` as the only redirecting alias.
- `/market/events` shows a source status board with 16 individual surface health chips; this is observability, not public product content.
- `/market/events` panel header shows the raw surface count (`Object.keys(SURFACES).length`) instead of a user-facing event count.
- `EdgarSummaryClient` renders raw summary fetch errors in a public filing surface.
- `/stock/[ticker]` formerly rendered a "data connection status" card with cache/auxiliary/internal connection wording in the public summary column.
- Kimi peer audit also found public wording risks in stock/ETF detail status lines, field-count labels, ETF new-list availability labels, hidden filing-tab discovery, market subnav consistency, ETF digital segment ambiguity, and small-screen tabbar density.

## Phases

### Phase 1 - Audit and Guardrails

- [x] Read project instructions and active handoff snapshot.
- [x] Verify nested repo status.
- [x] Verify Kimi right route and send peer audit.
- [x] Inventory public routes and key components.
- [x] Add public-copy guardrails for newly found diagnostic leaks.

Quality gate:

- `npm run qa:copy`

### Phase 2 - Public Diagnostic Cleanup

- [x] Move `/live-bench` to the authenticated Admin surface by redirecting it to `/admin/live`.
- [x] Remove the `/admin/live` middleware rewrite to `/live-bench/` so Voice Lab always goes through `AdminLayout`.
- [x] Remove public source-status board from `/market/events`.
- [x] Replace raw market surface count with user-facing event count.
- [x] Remove raw filing error text from `EdgarSummaryClient`.
- [x] Remove the internal-wording stock data-connection card while keeping normal data-state badges.

Quality gates:

- `npm run qa:copy` - pass, 63 files.
- `npx tsc --noEmit --pretty false` - pass.
- `npx eslint scripts/lint-public-copy.mjs src/app/live-bench/page.tsx src/app/market/events/MarketEventsClient.tsx src/components/filings/EdgarSummaryClient.tsx 'src/app/stock/[ticker]/StockDetailClient.tsx' src/app/screener/ScreenerClient.tsx` - pass.
- `git diff --check` - pass.
- `node scripts/ops/test-admin-auth-guards.mjs` now blocks any `/admin/live` middleware rewrite to `/live-bench/`.

### Phase 3 - Peer Integration

- [x] Pull Kimi's final audit through `feno-handoff`.
- [x] Integrate only evidence-backed findings that fit the approved IA.
- [x] Record any deferred findings here.

Accepted Kimi findings:

- Public/internal copy leaks: replaced `statusLine="내부 ..."` stock/ETF source states, "필드" field-count labels, "재무 보강 파일", ETF new-list "요약 제공"/"상세 상태", and added copy-lint guards.
- Filings discovery: `공시` tab is now visible for stock pages even when no Korean summary artifact is present; the embedded filings client owns the empty state and external links.
- Filings affordance: SEC form titles now include plain Korean labels before the form code.
- ETF segment clarity: `디지털` label now reads `디지털자산`, and `/etfs?digital=1` states that the filter is currently based on Bitcoin ETF coverage.
- Market nav/routing: legacy `Navbar` market active-state now covers `/market/*` and `/market-valuation/*`; `/market-valuation/structure` now shows the market section nav.
- Mobile density: shell bottom tabs get a narrow-width font/icon adjustment.

Deferred Kimi findings:

- `/etfs` reuses `explore/EtfUniverseCard` as a component implementation, but the route already owns ETF header, snapshot, filters, URL sync, and detail links. Full component split is a future maintainability refactor, not required for this product cleanup.
- `NavbarV3` is used by home design variants, not the current AppShell public product surfaces. Path-synced V3 menu/dropdown behavior is left for a chrome-specific pass.
- Industry map click-to-route and DataNav scroll indicators are lower-risk affordance improvements; no evidence of broken routing or overflow in this pass.

Follow-up accepted on 2026-06-24:

- Public product connection cards are allowed when backed by the lightweight entity graph stock index and expressed as user-facing service coverage. This is distinct from the removed internal/cache diagnostic card.
- `/screener` owns a `연결 데이터` view and 공시/13F/지수 filters; `/stock/[ticker]` owns a compact `데이터 연결` card with source dates.
- P5 SEO cleanup owns a public sitemap, live Worker-origin metadata base, stock/ETF/post canonical URLs, robots disallow for admin/live/travel aliases, and removal of the permanent `/travel/*` admin redirect. Live check showed `100xfenok.pages.dev` still serves the static legacy surface and 404s the Next sitemap/dynamic stock routes, so it must not be used as the canonical app origin until that host is moved.
- P4 filings UX owns the embedded `/stock/[ticker]?tab=filings` route, not a standalone `/filings/[ticker]` route yet. The stock tab now carries `AI 요약 · 200종목+`, and the filings panel shows the measured EDGAR summary range from the live index: 202 tickers, 2,424 filings, 834 summary artifacts at implementation time.
- P3 ETF depth owns an ETF connection map on `/etfs/[ticker]`: same issuer, same category, and top-holding-linked single-stock/leveraged ETF peers from the lightweight ETF universe response. The comparison route `/etfs/compare?tickers=SPY,VOO` is public and explicitly warns that holdings overlap is based on the top 25 displayed holdings, not the full ledger.
- P3 ETF center snapshot now uses API-provided `issuerCollections` for issuer tabs instead of component-hardcoded BlackRock/ProShares tab keys. Legacy `blackrock`/`proshares` fields remain in the API response for compatibility.
- Kimi follow-up anchor: `fh-20260624-009-km-f0c0c98f`.
- Kimi post-closeout audit anchor `fh-20260624-011-km-0e6e8858` found a real remaining SEO blocker: the Cloudflare build profile still applied `X-Robots-Tag: noindex, nofollow, noarchive` to every route. P5 hotfix removes the global `next.config.ts` header and keeps noindex only on admin/API-admin/travel/error-control responses through middleware/admin metadata/robots.
- The same post-closeout audit flagged P3 ETF wording/math risks. Follow-up keeps the ETF detail lane honest as a single-stock/leveraged connection lane, expands matching from ticker-only aliases to ticker plus top-holding company names, shows compare holdings dates per ETF, labels mixed compare dates, and moves overlap math into a tested helper.

Quality gate:

- Kimi final reply anchor: `fh-20260623-295-km-a2c1b0cb`.

### Phase 4 - Focused Browser Verification

- [x] Run one local dev server only if static gates pass.
- [x] Check core routes on desktop/mobile/narrow: `/market/events`, `/market-valuation/structure`, `/stock/NVDA?tab=filings`, `/stock/MSFT?tab=filings`, `/stock/ZZZZ`, `/etfs?digital=1`, `/etfs/new`, `/etfs/SPY`, `/etfs/compare?tickers=SPY,VOO`, `/explore`, `/live-bench`, `/admin/live`.

Quality gate:

- Playwright desktop/mobile/narrow pass for `/market/events`, `/market-valuation/structure`, `/stock/NVDA?tab=filings`, `/stock/MSFT?tab=filings`, `/etfs?digital=1`, `/etfs/SPY`, `/explore`, `/live-bench`, `/admin/live`: status 200, no forbidden public diagnostic copy, no horizontal overflow; `/live-bench` final URL `/admin/live/`.
- `/stock/ZZZZ` focused recheck pass on desktop/mobile/narrow: status 200, missing-ticker fallback and `종목 데이터 준비 전` shown, no horizontal overflow.
- `/etfs/new` focused recheck pass on desktop/mobile/narrow: availability copy uses `기본 정보`/`가격 중심`/`상세 가능` or empty-state copy; old `요약 제공`/`상세 상태` not visible.
- P3 ETF focused Playwright pass on desktop/mobile for `/etfs`, `/etfs/SPY`, `/etfs/compare?tickers=SPY,VOO`: status 200, no console issues, no horizontal page overflow, dynamic issuer labels visible, old `대형 운용사` label absent, ETF connection map visible, and compare overlap route visible. Mobile date-format recheck passed for full `Jun 17, 2026` display.
- P3 static gates passed: `npx tsc --noEmit --pretty false`, targeted `npx eslint`, `npm run qa:etf-universe`, `npm run qa:surface-consumers`, `npm run qa:seo-surface`, `npm run qa:copy`, `git diff --check`, and `npm run build`.
- P5 SEO hotfix gate adds `qa:seo-surface` protection against global public noindex headers. Local/live header checks must show public product routes without `X-Robots-Tag` while `/admin/*` and `/travel/*` stay noindex.
- P3 post-closeout gate adds `npm run qa:etf-compare` for top-25 overlap math and keeps compare 기준일 behavior explicit when the selected ETF set has mixed holdings dates.

### Phase 5 - Closeout

- [x] Update this plan with final verification results.
- [x] Prepare commit/push/deploy after explicit owner correction on 2026-06-24.
- [x] Use the existing Cloudflare deploy workflow triggered by `main` push; do not create a separate manual deploy path unless the workflow fails.

### Phase 6 - Data Connection Spine

- [x] Extend the lightweight entity graph into a service connection spine rather than a separate product DB.
- [x] Preserve `entity_graph_stock_index.connection_count` semantics: it still counts the original four core links only (`market_facts`, filings, 13F, index membership).
- [x] Add `single_stock_etfs` as a lightweight stock-index flag plus `service_count`; put the actual ETF list in `entity_graph_stock_services.json` root/public mirrors.
- [x] Add reverse stock -> single-stock ETF graph relations so ETF `tracks_underlying` can be reused by stock surfaces.
- [x] Add `/screener` connection filtering and badge support for `단일종목 ETF 연결`.
- [x] Add `/stock/[ticker]` service-list support so the connection card can link to related single-stock ETF detail/compare surfaces.

Measured P6 output:

- Stock service mirror schema: `data-entity-graph-stock-services/v1`.
- Service coverage: 67 stock underlyings and 122 single-stock ETF links.
- Examples after alias-aware underlying resolution: NVDA 7 ETF links, AAPL 3 ETF links, TSLA 10 ETF links.
- Kimi P6 critique anchor: `fh-20260624-016-km-f9d31e32`; accepted recommendation was to keep heavy ETF lists out of the client-fetched stock index.

Quality gate:

- `npm run qa:data-graph` - pass after graph/service mirror regeneration.

## Notes

- Current nested app status at goal start: `source/100xFenok` clean on `main...origin/main`.
- Parent project has pre-existing `.sec_cache/` untracked; leave it untouched.
- Kimi handoff anchor: `fh-20260623-294-cx-4c7b7f73`.
- Kimi final audit reply anchor: `fh-20260623-295-km-a2c1b0cb`.
