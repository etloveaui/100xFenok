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
