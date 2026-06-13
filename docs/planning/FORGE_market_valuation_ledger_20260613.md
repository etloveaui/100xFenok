# FORGE Plan — /market-valuation: Preview → Pro Ledger

> Date: 2026-06-13 | Owner: Fenok | Architect/Gate: Claude (cc-29) | Builder: Codex (cx-9)
> Origin source: owner real-device feedback (11 points) on live Worker `100xfenok.etloveaui.workers.dev/market-valuation`
> Status: DRAFT → pending CHALLENGE (cx-9 red-team) → owner approval → EXECUTE
> Code truth = origin/main `07e594063`. Data truth = local `100xfenok-next/public/data/`.

## 0. Owner Mandates (constitution — binding on every slice)

1. Pro-investor product, NOT a preview/demo site.
2. Data depth AND breadth: zero dormant data. "If there are 100 units, the investor can reach all 100; curate the *default view*, never the *availability*." Curation lives in Explore, not Market.
3. "Technically connected" is NOT done.
4. Catch everything in the first pass — no vague "fix it later". Any deferral must be explicit + usage-gated + logged, never silent.
5. Free-tier-max; scoped, reversible changes; no deploy without Claude gate PASS; only owner declares "완료".

## 1. Problem & Evidence (what IS)

`/market-valuation` is broadly wired but shallow at the UI: deep data exists and is loaded, yet only latest/summary slices are shown. The rest is dormant.

| Panel / source | Raw depth available | Currently shown | Dormant |
|---|---|---|---|
| PMI / ISM / OECD (`activity-surveys.json`) | time series — oecd_cli 120, pmi_mfg 169, pmi_svc 169, ism_mfg 233, ism_svc 233 | latest value cards (5) | full time series, country breakdowns |
| Damodaran ERP (`damodaran/`) | 66yr history + per-country ERP + credit | US current + FCFE mini-trend | country ERP table (counted only) |
| Yardeni (`yardney_model.json`) | 1,872 weekly rows 1990-02-02..2026-06-05 | SVG downsampled (every 4th row, marker every 26th) | full resolution, axis, toggle |
| S&P annual returns (`indices/sp500.json`) | 101 years | 1px absolute buttons inside 760px scroll box | a real chart; extremes clip the card (#8) |
| Market Structure (`market_structure_index.json` + others) | chart-ready depth (concentration, matrix, liquidity, sentiment, AAII, credit) | text/badge grid, sliced (concentration→3, matrix→7, sentiment→4) | central interactive chart, full ledger |

Evidence: `src/hooks/useMarketValuation.ts:970-1015` (22 JSON fetch in one hook), `:334-336/:389-448` (latest-only PMI), `:479-534` (ISM snapshots only), `:552-579` (US ERP only); `src/app/market-valuation/MarketValuationClient.tsx:189-213/216-260/288-324/359-431/463-630`; `src/app/market-valuation/YardeniCard.tsx:86-116/163-213`.

Structural duplication (#9): chrome ticker (`AppShell.tsx:118-131`, YTD%) vs index cards (`MarketValuationClient.tsx:820-856`, valuation multiples) vs `benchmarkMatrix` inside MarketStructure (`:551-566`, YTD px/eps/pe) vs MarketThermometer — same indices shown up to 3× at different angles. MarketThermometer is the *same component* in Explore and Market (`src/components/market/MarketThermometer.tsx`, rendered `explore/page.tsx:39` + `MarketValuationClient.tsx:801`) → no Market/Explore differentiation today.

Brand (#3): header square is a real `<Image>` boxed tile, but assets diverge — V1 nav uses `/favicon-96x96.png` (`Navbar.tsx:275-284`); Shell/V2/V3 use `/100x-fenok-logo.png` (`AppShell.tsx:229-236`, `NavbarV2.tsx:51-63`, `NavbarV3.tsx:60-73`). That asset divergence is the "different per entry" the owner saw.

## 2. Locked Decisions

- **D1 (LOCK)**: Market `/market-valuation` = full ledger, zero dormant surfaced + reachable. Explore `/explore` = curated preview. Curation belongs in Explore only.
- **D2 (LOCK, Claude+cx-9 consensus)**: Market Structure becomes the FIRST real detail route now (not deferred) — densest mixed-domain panel. ERP / Yardeni / Annual Returns / PMI = in-page `MarketChartFrame` + drill drawers first; promote to own routes later only if usage warrants (explicit, logged — not silent).
- **Ordering constraint (cx-9)**: Slice A model/coverage layer lands before any route; route consumes the SAME adapters as ledger/Explore (no second model). `MarketChartFrame` thin, client-only. 125% readability scoped to route/data-page first.

## 3. Architecture

```
data/*.json ──> Slice A: model layer  src/lib/market-valuation/models/*
                 + coverage registry {source, series_count, displayed_count, dormant_count}
                        │ (single source of adapters)
        ┌───────────────┼────────────────────────────┐
   ledger view      MarketChartFrame              Market Structure
   (/market-         (thin client-only,            detail route
    valuation)        chart.js dynamic,            (/market-valuation/structure)
                      per-panel adapters)           consumes same adapters
   Explore preview ── reuses same adapters (curated subset)
```

- **Model layer (A)**: move transforms out of the monolithic hook into typed models per source; each model exposes `{ latest, series, meta }`. Coverage registry makes "dormant=0" measurable, not asserted.
- **MarketChartFrame (B)**: shared *frame/contract* (tooltip, range, series-toggle, axis chrome) + typed per-panel adapters (`erpHistoryModel`, `yardeniOverlayModel`, `annualReturnsModel`, `pmiActivityModel`). NOT one universal chart (avoids prop-soup). Client-only via `next/dynamic(..., {ssr:false})` — precedent `stock-analyzer-dashboard.tsx:13-25`.
- **Market Structure route (C)**: new route under `/market-valuation/structure`, AppShell `backHref` precedent `stock/[ticker]/`. Renders concentration-over-time, benchmark matrix with metric toggles, liquidity (TGA/stablecoins), sentiment components, AAII — full depth, no slicing-to-N.
- **Ledger vs preview**: Market renders full depth; Explore keeps `MarketStructureIndexCard` preview linking into the route. Dedups #9 by assigning one canonical home per metric (YTD%→ticker, valuation→index cards, structure→route).

## 4. Slices, Ordering, Cost

| Slice | Scope | Est | Depends |
|---|---|---|---|
| **A** | Model layer + coverage registry. No UI rewrite. Fix order-assumption transforms (sort by date, not `rows[len-1]`). | 0.5d | — |
| **C** | Market Structure detail route (full depth, toggles, charts). Default Market becomes ledger; Explore stays preview. | 2–3d | A |
| **B** | `MarketChartFrame` + adapters; upgrade ERP overlay, Yardeni full-res, Annual Returns real chart (fixes #8 clip), PMI time-series. | 1.5–2d | A (adapter) |
| **D** | Scoped `.market-pro` density tokens (~125% feel, NOT global), index dedup cleanup, brand/launcher icon swap. | 1d | B/C stable |

Total ≈ 5–6.5d. Ordering A → C → B(parallel once adapters exist) → D.

## 5. Feedback Traceability (nothing dropped)

| # | Owner point | Resolved by |
|---|---|---|
| 2 | bake 125% density | D (scoped tokens) |
| 3 | brand + launcher icons | separate imagen track (brief by Claude) + D swap |
| 4 | data connectivity / live reflection | A (coverage registry) + documented D8 cron window (≤8h, see Risk) |
| 5 | tab differentiation / PMI time-series / full data use | A + B (pmiActivityModel) + C (ledger vs preview) |
| 6 | ERP companion axis + detail page | B (erpHistoryModel S&P/PE overlay) + C (route = the detail-page pattern) |
| 7 | Market Structure interactive | C |
| 8 | annual returns overflow | B (annualReturnsModel real chart) |
| 9 | index widget dedup | C/D (one canonical home per metric) |
| 10 | Yardeni polish | B (yardeniOverlayModel) |

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Monolithic 22-fetch hook + 4s timeout → partial nulls | High | A extracts models incrementally, keep `Promise.all`, per-source error isolation, registry surfaces null/missing |
| Transforms assume source order = latest (`rows[len-1]`) — converter reorder silently flips | High | A: sort/validate by date in model layer (`useMarketValuation.ts:334-336`, `YardeniCard.tsx:86-90`) |
| Chart.js SSR on Worker | Med | client-only + `dynamic ssr:false`, precedent `stock-analyzer-charts.tsx:1-25` |
| **Open: chart.js+crosshair-plugin vs lightweight-charts** for overlay/crosshair charts | Med | decide in CHALLENGE/Slice B. chart.js = zero new dep (already installed) + working SSR precedent; lightweight-charts = native crosshair, 35kB, but new dep. Default: chart.js + minimal plugin unless crosshair quality insufficient |
| Global 125% blast radius (rail 232/topbar 60/ticker 34 fixed px) | High | scoped `.market-pro` tokens ONLY, no global `font-size` |
| New route bundle/perf | Med | MarketChartFrame thin, dynamic import, reuse adapters |

## 7. Rollback Strategy

Each slice is additive and gated behind the model layer. A = no UI change (safe). C = new route; old page untouched until explicit cutover. B = per-panel chart swap; revert by re-importing the prior SVG component. D = scoped CSS tokens; revert by removing the `.market-pro` block. Work on `main` (workspace rule: no branches; snapshot to `_archive/` if needed). One commit per slice = revertable. Worker deploy only after Claude PASS.

## 8. Quality Gate (per slice — Claude gates every push)

- `tsc --noEmit` clean · `eslint` clean · `npm run build` (and `cf:build` for deploy slices) succeeds.
- Data integrity: `jq` checks on touched models; coverage registry shows targeted sources `dormant_count → 0`.
- Live: `curl` 200 on `/market-valuation` (+ `/market-valuation/structure` after C); 5-series data parity vs local.
- No new console errors / hydration warnings.

## 9. Verification Report (3-layer — filled at VERIFY)

| Layer | Check | Status |
|---|---|---|
| 1 Static | tsc / eslint / build / code-review | [pending] |
| 2 E2E smoke | build + live route 200 + data parity + each new feature exercised | [pending] |
| 3 MVP | owner real-device confirm + no regression in Explore/other shell pages | [pending] |

## 10. Out-of-band track

- **#3 Icon system** (imagen): Claude writes a brand-mark + launcher-icon brief (style/dims/format) → owner-gated imagen generation → asset swap in D. Tracked here so it is not dropped; runs parallel, not blocking A–C.

---
*FORGE artifact. CHALLENGE next: cx-9 red-team for holes/missing-steps/wrong-refs/over-engineering before owner approval.*
