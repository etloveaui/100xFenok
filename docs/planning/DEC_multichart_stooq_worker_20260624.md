# DEC: Multichart Stooq Worker Data Path

Date: 2026-06-24
Status: accepted for P15-0/P9-G

## Decision

`/multichart` may use the owner-owned Stooq Worker proxy:

`https://stooq-proxy.etloveaui.workers.dev`

The browser must not call Stooq directly. The Worker is the allowed public data
path for this restored stock/ETF/index comparison surface.

## Rationale

- The Worker returns long daily CSV history, verified with AAPL from 2016-06-24.
- It bypasses Stooq's browser/bot challenge without adding repo data accumulation.
- It stores nothing; the client keeps only a 24h per-symbol localStorage cache.
- This is narrower than a cron-backed local ticker x 10y JSON backfill and avoids
  repository growth.

## Boundaries

- No new production credential or paid-provider path.
- No Alpha Vantage fallback unless separately approved.
- `/macro-chart` remains the Data Spine-native macro workbench.
- Header/shell product navigation should route chart/tool discovery through
  Explore instead of separate Multichart/ETF/Sector/Screener/Investor entries.

## QA Contract

`qa:macro-chart` must verify:

- `/multichart` does not redirect to `/macro-chart`.
- `/multichart` renders the restored stock compare frame.
- The legacy controls are visible: `+ 티커 추가`, `수익률 비교`, `실제 가격`,
  `벤치마크 대비`.
- The browser path can produce SPY/QQQ result rows through the Worker.
- Direct Stooq, Alpha Vantage, and Yahoo browser requests remain blocked.
