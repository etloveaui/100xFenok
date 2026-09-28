# CONTRACT — Superinvestors Risk-Return Scatter (track-d slice-1)

> **Architect/Gate**: Claude (cc). **Implementor**: Kimi. **Visual critic**: AGY. Owner's "4" track (service 고도화 BACKLOG #323 (d)).
> **Chart work** → follow `docs/manuals/chart-dev-checklist.md` (required).
> Source recon: Kimi data scope (fh-303) + AGY visual recon (`superinvestors_visual_recon.md`).

## 0. Measured state (do not re-discover)
- `/superinvestors` already has `src/app/superinvestors/PortfolioCharts.tsx` with a per-guru **PerformanceChart** (line vs SPY — the 1 `<canvas>` AGY saw). So chart (a) cumulative-line ALREADY exists per-guru. Do NOT rebuild it.
- Chart libs installed: `chart.js ^4.5.1`, `react-chartjs-2 ^5.3.1`, `chartjs-chart-treemap ^3.1.0` → Scatter is available (register the needed elements per chart-dev-checklist).
- Data (same-origin, pre-computed): `data/sec-13f/analytics/portfolio_views.json` — the current Q2 artifact has 60 investors; 51 share the modal full window (21 quarterly points, 2021-06-30 ~ 2026-06-30) and shorter histories remain excluded. Tabs: consensus / gurus / by-ticker / trades / insights.

## 1. Scope — risk-return SCATTER (the NEW chart, this slice only)
- For each investor with a `performance` series: compute **annualized return** and **annualized volatility** from the pre-computed `performance.portfolio` series + `dates` (volatility = stdev of period returns × √(periods per year); returns from the series — do NOT recompute from raw prices).
- Render a **Scatter** (react-chartjs-2): X = volatility, Y = annualized return, one point per investor (≈54), each labeled by investor name. Add **SPY as a distinct reference point** (different color/marker) using its baseline series.
- Place it on `/superinvestors` — inside `PortfolioCharts.tsx` or a sibling component, on an appropriate tab (e.g. `insights`, or a new `성과·리스크` sub-view; your call, keep it discoverable). Match existing slate styling.
- Tooltip: investor name + annualized return % + volatility %. Optional light quadrant guide (top-left = high-return/low-vol = best).

## 2. Out of scope (do NOT do now)
- (a) cumulative-return line — already exists per-guru; do NOT rebuild (a cross-guru overlay can be a later slice).
- (c) factor-exposure radar — the initial slice deferred this until a factor-data decision. The later v2 implementation is now derived-only: it uses private Ken French source files, emits slim public scores, and must refresh from the same Q2 portfolio artifact without exposing raw factor files.

## 3. Constraints + acceptance
- Follow `docs/manuals/chart-dev-checklist.md`. tsc 0. Use the pre-computed `portfolio_views.json` `performance` series (do NOT recompute from raw prices). Null-safe: the ~6 investors lacking the series are excluded. same-origin only; NO new data/cron. Mobile responsive (chart resizes, no overflow).
- Acceptance: scatter renders ≈54 investors + SPY; positions sensible (SPY mid-field; high-return/low-vol gurus top-left); tooltips show name + return% + vol%; no console error; mobile ok; existing tabs/PerformanceChart/treemaps unchanged. AGY LIVE visual.
- Report: new component + touched line ranges + build result; do NOT commit/push — cc gates against this contract + ships.

## 4. Next (track-d roadmap)
- slice-2: cross-guru cumulative-return overlay (multi-line vs SPY) reusing the existing PerformanceChart data.
- v2 (now maintained): factor-exposure radar — derived public scores only; raw Ken French files remain private and the output is refreshed from the canonical portfolio artifact.

---

## 5. SLICE-2 detail — cross-guru cumulative-return overlay (owner-approved 06-28)

> Multi-line cumulative-return overlay. Resolves the start-date caveat (Kimi scope) by restricting to SAME-period investors. ScreenerClient unaffected; edit PortfolioCharts.tsx + InsightsTab.tsx only.

### 5.1 Honesty fix (the key decision)
- **Derive the modal shared window from the current artifact** instead of hardcoding a start quarter or demanding an obsolete 22-point count. Require at least 20 quarterly observations, then retain only investors whose dates exactly match the selected start/end window. The current Q2 artifact yields 51 investors and 21 points (2021-Q2 → 2026-Q2); missing Q1 history is not invented.
- Default display = **top-10 of the shared-window cohort by annualized return** (readable; the full cohort is not rendered as 51 lines).

### 5.2 Build
- New `CumulativeReturnOverlay` component in PortfolioCharts.tsx: Chart.js Line, x = the derived shared quarter dates, each selected investor's `portfolio` series rebased to **100 at the selected start quarter**, plus **SPY as a thick neutral line**. Up to ~10-15 lines distinguished by the existing `chartTheme.palette` (6) + dash/HSL.
- Interaction: investor multi-select + a "상위 10" button; **cap at 15 lines** (guard readability).
- Placement: InsightsTab, a "누적 수익 오버레이" card BELOW the existing risk-return scatter card (cross-guru analysis grouping).

### 5.3 Constraints + acceptance
- Follow `docs/manuals/chart-dev-checklist.md` (register LineController/elements as needed). tsc 0; same-origin `portfolio_views.json` (no new raw data/cron); rebase math = value/firstValue×100; shared-window selection is artifact-derived with a 20-quarter minimum; null-safe; mobile responsive.
- Acceptance: overlay renders the top-10 shared-window investors + SPY when the artifact has a valid window, all rebased to 100 at the same start; the card states the selected dates/count; legend readable; multi-select + 상위 10 work; ≤15-line cap; scatter card + other tabs + per-guru chart unchanged. If no valid shared window exists, the empty state is truthful. AGY LIVE.
- Report component + lines + build; do NOT commit — cc gates + ships.
