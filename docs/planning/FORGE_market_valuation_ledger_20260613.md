# FORGE Plan — /market-valuation: Preview → Pro Ledger

> Date: 2026-06-13 | Owner: Fenok | Architect/Gate: Claude (cc-29) | Builder: Codex (cx-9)
> Origin source: owner real-device feedback (11 points) on live Worker `100xfenok.etloveaui.workers.dev/market-valuation`
> Status: v3 EXECUTE — A0/A1/B0/C/B implemented locally; D density/icon/dedup pending
> Code truth = local main worktree pending split push. Data truth = local `100xfenok-next/public/data/`.

**Revision log**
- v1 → v2 (cx-9 CHALLENGE `fh-128`, all findings accepted): reordered A0→A1→B0→C→B→D (B0 chart contract before route); added raw-depth lazy reachability policy; field/range/surface coverage registry; traceability +#1/#11; fixed annual-returns source ref; named exact live-gate domain; locked chart.js-first verdict; added chart-dev-checklist gates.
- v2 → v3 (2026-06-13 B integration): Market Structure route C accepted by peer gate; B moved ERP, S&P annual returns, Yardeni, and PMI/ISM/OECD onto `MarketChartFrame`; Yardeni/PMI coverage entries added; legacy fixed-width/manual SVGs removed from `/market-valuation`; scoped lint + tsc + single-route browser smoke passed.

## Execution Ledger

| Slice | Current state | Evidence |
|---|---|---|
| A0/A1 | typed model layer, coverage helpers, lazy/source loaders, market-structure + annual-return adapters present | `src/lib/market-valuation/models/*` |
| B0 | shared `MarketChartFrame` + client-only Chart.js engine present; initial hidden series honored | `src/lib/market-valuation/charts/MarketChartFrame.tsx` |
| C | `/market-valuation/structure` route present; peer browser gate PASS (200, 4 slots, 4 canvases, hover/toggle, 0 console/request errors) | `src/app/market-valuation/structure/*` |
| B | ERP, annual returns, Yardeni, PMI/ISM/OECD panels integrated in `/market-valuation` | `src/lib/market-valuation/charts/ledgerChartPanels.tsx`, `src/app/market-valuation/MarketValuationClient.tsx` |
| D | pending | scoped 125% density, icon/brand cleanup, index dedup |

## 0. Owner Mandates (constitution — binding on every slice)

1. Pro-investor product, NOT a preview/demo site.
2. Data depth AND breadth: zero dormant data. "If there are 100 units, the investor can reach all 100; curate the *default view*, never the *availability*." Curation lives in Explore, not Market.
3. "Technically connected" is NOT done.
4. Catch everything in the first pass — no vague "fix it later". Any deferral must be explicit + usage-gated + logged, never silent.
5. Free-tier-max; scoped, reversible changes; no deploy without Claude gate PASS; only owner declares "완료".

## 1. Problem & Evidence (what IS)

`/market-valuation` is broadly wired but shallow at the UI: deep data exists and is loaded, yet only latest/summary slices are shown. Worse — the file the UI reads is itself already downsampled, so the real depth never reaches the page.

| Panel / source | Raw depth available | Currently shown | Dormant |
|---|---|---|---|
| PMI / ISM / OECD (`activity-surveys.json`) | time series — oecd_cli 120, pmi_mfg 169, pmi_svc 169, ism_mfg 233, ism_svc 233 | latest value cards (5) | full time series, country breakdowns |
| Damodaran ERP (`damodaran/`) | 66yr history + per-country ERP + credit | US current + FCFE mini-trend | country ERP table (counted only) |
| Yardeni (`yardney_model.json`) | 1,872 weekly rows 1990..2026 | SVG downsampled (every 4th row, marker every 26th) | full resolution, axis, toggle |
| S&P annual returns (`slickcharts/sp500-returns.json`) | 101 years | 1px absolute buttons inside 760px scroll box | a real chart; extremes clip the card (#8) |
| Market Structure (`market_structure_index.json` = SUMMARY) | summary already truncates raw: TGA 5196→trend 42, stablecoins 3118→42, AAII 2024→52, sentiment →30 | text/badge grid, sliced (concentration→3, matrix→7, sentiment→4) | full raw series live in `macro/tga.json` (756KB), `macro/stablecoins.json` (1.0MB), `sentiment/*`, AAII |

Evidence: `src/hooks/useMarketValuation.ts:970-1015` (22 JSON fetch in one hook), `:334-336/:389-448` (latest-only PMI), `:479-534` (ISM snapshots only), `:552-579` (US ERP only), `:667-675`/`:1013` (annual returns from `slickcharts/sp500-returns.json`); `src/app/market-valuation/MarketValuationClient.tsx:189-213/216-260/288-324/359-431/463-630`; `YardeniCard.tsx:86-116/163-213`.

Structural duplication (#9): chrome ticker (`AppShell.tsx:118-131`, YTD%) vs index cards (`MarketValuationClient.tsx:820-856`, valuation multiples) vs `benchmarkMatrix` inside MarketStructure (`:551-566`, YTD px/eps/pe) vs MarketThermometer (`src/components/market/MarketThermometer.tsx`, rendered `explore/page.tsx:39` + `MarketValuationClient.tsx:801`) — same indices up to 3×, and Thermometer is identical in Explore and Market → no differentiation.

Brand (#3): header square is a real `<Image>` boxed tile, assets diverge — V1 nav `/favicon-96x96.png` (`Navbar.tsx:277`); Shell/V2/V3 `/100x-fenok-logo.png` (`AppShell.tsx:231/285`, `NavbarV2.tsx:51-63`, `NavbarV3.tsx:60-73`). That divergence is the "different per entry" the owner saw.

## 2. Locked Decisions

- **D1 (LOCK)**: Market = full ledger, zero dormant surfaced + reachable. Explore = curated preview. Curation belongs in Explore only.
- **D2 (LOCK, Claude+cx-9 consensus)**: Market Structure = FIRST real detail route now (densest mixed-domain panel). ERP / Yardeni / Annual Returns / PMI = in-page `MarketChartFrame` + drill drawers first; promote to own routes later only if usage warrants (explicit, logged).
- **Ordering constraint (cx-9)**: model/coverage + a minimal chart contract land before the route; route reuses the SAME adapters as ledger/Explore (no second model). `MarketChartFrame` thin, client-only. 125% scoped first.

## 3. Architecture

```
data/*.json (raw)  ──>  A0 model layer  src/lib/market-valuation/models/*
   summary + RAW          + coverage registry (field/range/surface)
   (lazy raw loaders)     + raw-vs-summary policy
                                 │  (single adapter source)
        ┌────────────────────────┼───────────────────────────┐
   B0 MarketChartFrame      C  Market Structure          ledger view
   (thin client-only,          detail route               (/market-valuation)
    chart.js dynamic:          (/market-valuation/         + Explore preview
    tooltip+hover marker,       structure) reuses          (curated subset of
    range, series toggle)       B0 + A1 adapters,           same adapters)
                                summary default +
                                lazy raw/MAX expand
```

**Raw-depth reachability policy (C2 fix)**: the UI's `market_structure_index.json` is a summary that already drops raw points. To honor "zero dormant", models default to the summary for the first paint, and **lazy-load raw** (`macro/tga.json`, `macro/stablecoins.json`, `sentiment/*`, AAII) on MAX/expand. Dormant=0 means *reachable*, not *eager-loaded* — protects Worker/client payload (raw TGA 756KB, stablecoins 1.0MB).

**Coverage registry (C3 fix)** — per source, per surface (ledger-default / drawer / route / Explore-preview):
`{ source, raw_source, available_count, reachable_count, default_visible_count, preview_visible_count, downsample_policy, last_verified }`
Invariants: Market `reachable_count == available_count`; Explore `preview_visible_count < reachable_count` allowed. "Zero dormant" = every source has `reachable_count == available_count` on the Market surface.

**MarketChartFrame**: shared frame/contract (tooltip, range, series-toggle, axis chrome) + typed per-panel adapters (`erpHistoryModel`, `yardeniOverlayModel`, `annualReturnsModel`, `pmiActivityModel`). NOT one universal chart. Client-only `next/dynamic(...,{ssr:false})` — precedent `stock-analyzer-dashboard.tsx:13-25`, registration `stock-analyzer-charts.tsx:1-25`, `PortfolioCharts.tsx:1-29`.

**Market Structure route**: `/market-valuation/structure`, AppShell `backHref` (`AppShell.tsx:201-210/277-286`, `stock/[ticker]/page.tsx:29`) PLUS a desktop breadcrumb/back affordance (mobile-only back is insufficient).

## 4. Slices, Ordering, Cost

| Slice | Scope | Est | Depends |
|---|---|---|---|
| **A0** | Data inventory + typed adapter contracts + coverage registry schema + raw-vs-summary policy + lazy raw loaders. No UI. | 0.5d | — |
| **A1** | Migrate ONLY Market Structure + annual-returns adapters (not all 22). Fix order-assumption transforms (sort by date, not `rows[len-1]`). | 0.5d | A0 |
| **B0** | Minimal `MarketChartFrame` contract: client-only chart.js, native tooltip + vertical hover marker, range selector, series toggle. No plugin yet. | 0.5d | A0 |
| **C** | Market Structure detail route: full depth via summary default + lazy raw/MAX; metric toggles; desktop back/breadcrumb. Market becomes ledger; Explore stays preview. | 2–3d | A1, B0 |
| **B** | Remaining panel migrations onto `MarketChartFrame`: ERP S&P/PE overlay, Yardeni full-res, Annual Returns real chart (fixes #8), PMI time-series + remaining adapters. | implemented | B0, A0 |
| **D** | Scoped `.market-pro` density tokens (~125%, NOT global), index dedup (one canonical home per metric), brand/launcher icon swap. | 1d | B/C stable |

Total ≈ 5.5–7d. Ordering **A0 → A1 → B0 → C → B → D** (B0 may overlap A1; B panels migrate after B0).

## 5. Feedback Traceability (all 11, nothing dropped)

| # | Owner point | Resolved by |
|---|---|---|
| 1 | Codex collaboration | Claude↔cx-9 handoff loop (operational, this whole forge) |
| 2 | bake 125% density | D (scoped `.market-pro` tokens) |
| 3 | brand + launcher icons | imagen track (Claude brief: canonical asset + manifest/PWA/apple sizes + rollback) → D swap |
| 4 | data connectivity / live reflection | A0 coverage registry + documented D8 cron window (≤8h, see Risk) |
| 5 | tab differentiation / PMI time-series / full data use | A0 + B (pmiActivityModel) + C (ledger vs preview) |
| 6 | ERP companion axis + detail page | B (erpHistoryModel S&P/PE overlay) + C (route = detail-page pattern) |
| 7 | Market Structure interactive | C |
| 8 | annual returns overflow | B (annualReturnsModel real chart) |
| 9 | index widget dedup | C/D (one canonical home per metric) |
| 10 | Yardeni polish | B (yardeniOverlayModel) |
| 11 | scope = Explore + Market only | in scope by design; other tabs OUT of scope this cycle |

## 6. Risk Assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Monolithic 22-fetch hook + 4s timeout → partial nulls | High | A0 extracts models incrementally; A1 only migrates 2 panels (no 22-fetch big-bang); keep `Promise.all`; per-source error isolation; registry surfaces null/missing |
| Transforms assume source order = latest (`rows[len-1]`) | High | A1: sort/validate by date (`useMarketValuation.ts:334-336`, `YardeniCard.tsx:86-90`) |
| Raw depth payload weight (TGA 756KB, stablecoins 1.0MB) | High | summary default + lazy raw/MAX only; never eager-load raw into first paint |
| Chart.js SSR on Worker | Med | client-only + `dynamic ssr:false`, precedent `stock-analyzer-charts.tsx:1-25` |
| Crosshair quality | Med | native Chart.js tooltip + vertical hover marker first; add `chartjs-plugin-crosshair` ONLY if B0 acceptance fails (no blind dep) |
| Global 125% blast radius (rail 232/topbar 60/ticker 34 fixed px) | High | scoped `.market-pro` tokens ONLY, no global `font-size` |

**Chart library verdict (locked)**: Chart.js first — already in `package.json:41,45`, lockfile resolved, working SSR + registration precedent. `lightweight-charts` not installed; no new dep until Chart.js is proven insufficient on crosshair/tooltip.

## 7. Rollback Strategy

Each slice additive, gated behind the model layer. A0/A1 = no UI change (safe). B0 = new isolated component. C = new route; old page untouched until explicit cutover. B = per-panel chart swap; revert by re-importing prior SVG. D = scoped CSS tokens + asset swap; revert by removing `.market-pro` block / restoring prior asset. Work on `main` (no branches; snapshot to `_archive/` if needed). One commit per slice = revertable. Worker deploy only after Claude PASS.

## 8. Quality Gate (per slice — Claude gates every push)

- `tsc --noEmit` clean · `eslint` clean · `npm run build` (and `cf:build` for deploy slices) succeeds.
- Data integrity: `jq` on touched models; coverage registry shows targeted sources `reachable_count == available_count` (Market surface).
- Live: `curl` 200 on `https://100xfenok.etloveaui.workers.dev/market-valuation` (+ `/market-valuation/structure` after C). Note: `100xfenok.pages.dev` 404s app routes — workers.dev is the gate domain.
- Chart work follows `docs/manuals/chart-dev-checklist.md:45-132` (MAX range, frequency mismatch / fill-forward, annotation bounds, period selector) and `:136-170` (a11y).
- No new console errors / hydration warnings.

## 9. Verification Report (3-layer — filled at VERIFY)

| Layer | Check | Status |
|---|---|---|
| 1 Static | `npx eslint` scoped to touched market files; `npx tsc --noEmit --pretty false` | PASS |
| 2 E2E smoke | local webpack dev `/market-valuation` 200; H1 present; 4 chart canvases; PMI/ERP/annual/Yardeni headings present; console/page/request errors 0; NaN/undefined 0 | PASS |
| 3 MVP | owner real-device confirm + no regression in Explore/other shell pages | [pending] |

Verification note: `next dev` default Turbopack is [blocked] by an unrelated workspace path panic from `src/app/globals.css` → `../../../../../../02_For_Mona/00_Project/mona-life/data/english`. The same route passes under `next dev --webpack`; do not count the Turbopack panic as a market-valuation regression without fixing that upstream path.

## 10. Out-of-band track

- **#3 Icon system** (imagen): Claude brief = canonical brand mark + launcher icons, exact dims, format (PNG transparent), manifest + PWA + apple-touch sizes, rollback to prior asset → owner-gated imagen generation → asset swap in D. Parallel, non-blocking A–C.

---
*FORGE artifact v2. CHALLENGE round 1 incorporated. Round-2 confirm with cx-9 pending, then owner approval → EXECUTE.*
