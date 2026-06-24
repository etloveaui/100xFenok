# CONTRACT — Stock (Stooq) Source Fusion into /macro-chart

> Status: **S1-S5 pushed, deployed, and live-verified**. Architect: Claude. Implementor: Codex.
> Decision basis: owner pivot to fusion (2026-06-24). Feasibility confirmed twice —
> Claude (catalog `source_path` + `{date,value}` abstraction) and Codex (loader audit:
> `loadMacroSeries` normalizes definitions → rawPoints → transforms/alignment/CSV/PNG).

## Current State Correction

- P15-0/P9-G is live: `/multichart` renders the restored Stooq Worker-proxied
  stock compare frame.
- P15 connect slice `0dc75960f` was pushed and **did deploy** through the
  repository's push-triggered `Deploy Worker (Cloudflare)` workflow
  (`28105232537`, success). A live `qa:macro-chart` run against
  `https://100xfenok.etloveaui.workers.dev` passed 8/8 with the strengthened
  P15-A/B/C/D checks.
- Owner decision closed after the pivot: absorb the P15 connect work into Fusion
  and preserve `/multichart` as a compatibility entry into the fused chart.
- Production push/deploy is complete for this slice: nested commits
  `a5a00147b` + `53df5b095` + `e6b57fba5`, Deploy Worker run
  `28112072108` success, and live `qa:macro-chart` passed 9/9 against
  `https://100xfenok.etloveaui.workers.dev`.

## Goal

One `/macro-chart` that compares **macro series AND stock tickers together** (e.g. NVDA price
vs M2 money supply vs 10Y yield), reusing the existing transform / axis / formula / 8-series /
URL-share / CSV / PNG pipeline. The restored multichart stock-compare folds in here.

## Decisions (owner-recommended — confirm or amend in review)

- **D1** — Stooq stocks become a new **source kind** inside the macro-chart series model, not a
  separate route/engine.
- **D2** — accepted: keep the `/multichart` URL but route it into macro-chart
  "stock mode" (preserves the owner's known URL). The legacy
  `multichart.html` file is kept as rollback/reference, but the route no longer
  frames it after S4.
- **D3** — Chart engine stays **Chart.js** for this fusion slice. Engine swap
  (Lightweight Charts / ECharts) is deferred to the design-remodel track (research ③).
- **D4** — accepted: absorb the P15 connect slice (`0dc75960f`, pushed and
  deployed by the push workflow). The macro context card and cross-surface links
  stay, re-expressed on the fused chart.

## Blockers (from Codex loader audit) → contract resolution

- **B1 — source kind.** `MacroSeriesDefinition` requires static `sourcePath` + `fetch().json()`.
  → Add a `kind` field: `"local-json"` (existing) | `"stooq"`. For `"stooq"`, the loader fetches
  `${STOOQ_PROXY}/${encodeURIComponent("https://stooq.com/q/d/l/?s={sym}&i=d")}`, parses CSV →
  `{date, value: Close}`, normalizes to rawPoints. **Reuse the exact parser** already in
  `public/tools/asset/multichart.html` (`fetchStooq` / `toStooqSymbol`).
- **B2 — dynamic ids.** `seriesById` + the URL parser discard unknown ids.
  → Support runtime Stooq ids across: URL `series` parser, `seriesById` resolver
  (synthesize a definition on the fly), picker selection, formula refs, axis keys, preset
  save/load. Invalid/unknown id → graceful skip with a visible notice, never a crash.
  **Do not use `stooq:{TICKER}` unless the axis/formula URL grammar is replaced**:
  current params use colon delimiters (`axis={id}:{axis}`,
  `formula={operator}:{leftId}:{rightId}`). MVP id format should be delimiter-safe,
  e.g. `stq~NVDA.US`, `stq~SPY.US`, `stq~QQQ.US`.
- **B3 — Worker-proxy policy.** Symbol validation + cache + policy must be explicit.
  → Symbol allowlist (e.g. `^[A-Za-z0-9.\-]{1,12}$`) + `toStooqSymbol` `.us`/`.kr` mapping;
  24h `localStorage` cache (reuse `stooq_cache_` key). Policy: macro-chart now performs a runtime
  owner-Worker-proxied fetch — extend `DEC_multichart_stooq_worker_20260624` to cover macro-chart
  (the same-origin exception is already granted to the owner Worker proxy).
- **B4 — mixed resolution.** Daily stock vs monthly/weekly macro.
  → Align via the existing label/alignment layer (date labels). Current
  `alignMacroPoints` behavior carries the latest known value forward after a
  series starts, so mixed daily/monthly overlays and formulas are possible but
  must be labeled as aligned chart values, not raw same-day observations. QA must
  cover NVDA (daily) vs M2 (monthly) under raw / rebase100 and one formula smoke
  that exercises the same aligned-value behavior.

## Picker

Keep the 30 fixed macro series. Add a **ticker search input** that adds delimiter-safe
Stooq selections such as `stq~NVDA.US`. The 8-series cap is shared across macro + stock. Each selected series is tagged by
**source (macro vs stock) and frequency** in UI + CSV (honesty rule carried from the prior
resolution-note pattern).

## QA gates (extend `check-macro-chart-contract.mjs`)

- stooq source loads: select `stq~NVDA.US` → series renders, points > 0, fetch only via the
  owner Worker host (zero direct `stooq.com` / `alphavantage` / `yahoo`).
- mixed compare: NVDA (daily) + M2 (monthly) under raw / rebase100 → both render,
  no crash, no overflow, and source/frequency tags remain visible.
- stock-stock formula smoke: SPY + QQQ ratio works on matching daily dates and
  preserves delimiter-safe formula URL state.
- dynamic id round-trip: `series=stq~NVDA.US,M2SL` restored on reload; preset save/load with a stooq id.
- `/multichart` disposition per D2: the URL remains live, renders the fused
  Macro Chart stock-compare mode, and does not lose stock compare affordances.
- Navigation reachability: header Analytics is intentionally narrow
  (`/radar`, `/posts`, `/explore`), while the AppShell rail/mobile tabs must
  expose `/explore`, `/market-valuation`, `/sectors`, `/etfs`, `/screener`,
  `/superinvestors`, and `/portfolio`. Header absence alone is not a QA pass.
- CSV honesty: exports include source/frequency metadata rows for local macro,
  Stooq market symbol, and computed formula series.
- existing macro contract stays green (no regression).

## Slices (Codex implements; Claude gates each; push only after owner OK)

- **S1** — source-kind model + stooq loader branch + CSV parser port (no UI) +
  loader/unit test. **Local implementation landed in worktree**: `sourceKind:
  "stooq"`, delimiter-safe `stq~...`-compatible definitions, owner Worker proxy,
  24h browser cache, and `qa:macro-chart:stooq-loader`.
- **S2** — dynamic id support (URL parser, `seriesById`, formula/axis/preset) +
  ticker picker UI. **Local implementation verified**: `stq~NVDA.US` restores from
  URL, axis/formula params stay delimiter-safe, the picker adds Stooq symbols into
  the existing 8-series selection model, and local `qa:macro-chart` includes a
  proxy-only NVDA+M2 fusion route.
- **S3** — mixed-resolution alignment + source/frequency honesty tags + QA
  extension (NVDA daily vs M2 monthly plus stock-stock ratio). **Implemented locally.**
- **S4** — `/multichart` disposition (D2) + P15 connect absorption (D4).
  **Implemented locally**: `/multichart` now renders `MacroChartClient` in
  `stock-compare` mode while `/macro-chart` remains the fused workbench.
- **S5** — full `qa:macro-chart` green + LIVE gate + docs (PLAN / DEC /
  CHANGELOG). **Complete**: local and live `qa:macro-chart` passed 9/9, and
  Deploy Worker run `28112072108` completed successfully.

## Decision Gate

Closed by owner direction to proceed with the fused service workbench. Empirical
gate passed: QA proved mixed data, stock compare, route reachability, CSV
honesty, deployment, and live production behavior.

## Rollback

Each slice is revertible. The Stooq source kind is isolated as a source kind in
the Macro Chart pipeline, and `multichart.html` is kept as rollback/reference
while the live route points at the fused chart.

## Out of scope

Chart engine swap (design-remodel track), providers beyond Stooq, server-side stock cache.
