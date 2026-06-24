# DEC: Multichart Stooq Worker Data Path

Date: 2026-06-24
Status: accepted for P15-0/P9-G and extended for P15-Fusion

## Decision

`/multichart` and the fused `/macro-chart` market-symbol source may use the
owner-owned Stooq Worker proxy:

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
- `/macro-chart` remains Data Spine-native for macro definitions, and may also
  synthesize approved Stooq market-symbol definitions through the owner Worker
  proxy. The browser still must not call Stooq/Yahoo/Alpha Vantage directly.
- `/multichart` remains a URL-compatible entry point, but now renders the fused
  Macro Chart stock-compare mode instead of a separate iframe engine.
- Header product navigation should keep Analytics narrow: Radar, Insights, and
  Explore only. `/multichart`, ETF, Sector, Screener, and Investor stay out of
  the header, while AppShell rail/mobile tabs must still expose Sector, ETF,
  Screener, and Investor for in-product reachability.

## QA Contract

`qa:macro-chart` must verify:

- `/multichart` does not redirect to `/macro-chart` and renders the fused Macro
  Chart stock-compare mode.
- Market compare controls are visible: `+ 티커 추가`, `수익률 비교`,
  `실제 가격`, `벤치마크 대비`.
- The browser path can produce SPY/QQQ ratio output through the Worker-proxied
  Stooq source.
- Mixed daily/monthly compare (NVDA + M2) renders without crash/overflow and
  labels source/frequency honestly in UI and CSV.
- Routes removed from header navigation stay reachable through AppShell rail or
  an in-product hub; route absence from the header is not sufficient.
- Direct Stooq, Alpha Vantage, and Yahoo browser requests remain blocked.
