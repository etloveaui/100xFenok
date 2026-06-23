# DESIGN: Public Copy Audit Pass

Date: 2026-06-18
Status: active guardrail
Scope: public 100xFenok tabs and stock/ETF detail pages

## Owner Correction

The public UI must not expose data-pipeline jargon or provider names as product
copy. Data can remain complete and inspectable, but the user-facing language
must explain what the data means.

## Public Copy Rules

- Do not use provider names (`StockAnalysis`, `SlickCharts`, `Yahoo`) in public
  page copy. Keep them in Admin/Data Lab, docs, API metadata, and diagnostics.
- Do not use internal pipeline terms: `surface`, `ledger`, `backfill`,
  `endpoint`, `DataPack`, `localStorage`, raw file paths, or raw JSON terms.
- Translate finance shorthand into user meaning:
  - `movers` -> 급등락
  - `revision` -> 추정치 변화
  - `action` -> 투자 신호 or 기업 이벤트, depending on context
  - `consensus` -> 시장 예상
  - `guru` -> 투자 대가 or 투자자
  - `MAX` -> 전체
- Empty states must tell the user what is happening, not which file is missing.
- Explore is not the first home for new data families. Build canonical tabs or
  dedicated routes first, then let Explore show one curated headline.

## 2026-06-18 First Pass

Applied a first public-copy pass across:

- Explore cards and inactive Explore helper cards.
- Market valuation and market structure detail.
- Sectors and smart-money panel copy.
- ETF search, ETF detail, and new ETF launch list.
- Screener filters/detail panel.
- Superinvestors/13F pages.
- Portfolio backup import/export.
- Stock detail page and ETF/13F detail panels.

The public forbidden-term grep now leaves only internal identifiers such as
`localStorage`, `JSON.parse`, `is_stale`, and legacy variable names.

## Open UX Follow-Up

- Mobile shell still has seven bottom tabs. Audit whether it should become
  five primary tabs plus a "More" sheet.
- ETF search still has full category select on mobile. Keep in `/etfs`, but
  Explore must not render that full working surface.
- Dedicated routes are still needed for earnings/actions, IPO, industry maps,
  and market movers before they re-enter Explore.

## 2026-06-18 ETF/Data Lab Follow-Up

- Replaced remaining public ETF shorthand (`AUM`) with user-facing
  `운용자산` on `/etfs` and ETF detail surfaces.
- Kept ETF type filters in the canonical `/etfs` route, including leveraged,
  single-stock leveraged, and inverse filters.
- Data Lab remains allowed to show provider/source names, but its StockAnalysis
  audit cards should prefer Korean operational labels over public-product
  jargon such as "surface", "DataPack", and raw error phrasing.
- Admin Data Lab now reads ETF collection queue details from
  `index.json`, `incremental_latest.json`, and `pending_ledger.json` instead
  of static copy, so pending/retry/failure rows update with each data refresh.
- Admin Data Lab also reads `coverage/etf_detail.json`, whose denominator is
  the union of ETF universe, ETF screener, and new ETF launch rows. Public ETF
  pages may show the meaning ("상세 보유 / 보강 / 누락") but should not expose
  raw file names or provider-path diagnostics.
- The same Data Lab renderer/dashboard changes must live in the tracked
  `admin/data-lab/app/*` source as well as the public mirror; `npm run dev`
  runs `sync-static` and will overwrite the mirror from that source.

## 2026-06-18 Stock Detail Follow-Up

- Stock detail overview now reads the collected stock overview API and renders
  it as `추가 지표 체크`, not as provider-branded copy.
- Public copy should keep this framing: the card is a cross-check layer for
  price, market cap, revenue, net income, EPS, PER, target price, dividend, and
  beta; source/provider names stay in Admin/API metadata only.

## 2026-06-18 Public Error/Source Copy Follow-Up

- Removed public-facing file/path diagnostics such as `stocks_analyzer.json`,
  `investors/{name}.json`, and `/data/sec-13f/...` from stock and guru error
  states.
- Source/provider labels in screener detail now map to user meanings such as
  price/financial 기준, 추가 지표, and 지수 구성 기준. Unknown raw source
  strings fall back to `확인 기준`.
- Replaced remaining public `보조 데이터` / `수집 전` / `데이터 묶음` phrasing in
  touched stock, market-event, and ETF summary surfaces with user-facing
  readiness or item-count language.

## 2026-06-23 Public Trust Hygiene Regression Gate

- Public pages must not mount coverage or diagnostic cards. Compact
  trust/freshness/unavailable copy is allowed; readiness scores, coverage
  percentages, raw JSON counts, parity candidate counts, and Data Lab links are
  Admin/Data Lab material.
- Removed the public `ProductSurfaceCoverageCard` mounts from market
  valuation, sectors, and ETF pages. The generated
  `product-surface-coverage.json` remains an admin observability artifact, not
  a public product card.
- Removed orphaned public Explore diagnostic cards (`DataCoverageCard`,
  `SurfaceCatalogCard`, `ActionCandidatesCard`) so they cannot be re-mounted
  accidentally.
- Superinvestors no longer displays enrichment coverage percentages publicly;
  it uses plain product copy for the enriched sector view.
- `npm run qa:copy` now blocks coverage-card imports and raw coverage counter
  identifiers on public routes.
