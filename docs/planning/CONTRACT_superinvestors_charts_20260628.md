# CONTRACT — Superinvestors Risk-Return Scatter (track-d slice-1)

> **Architect/Gate**: Claude (cc). **Implementor**: Kimi. **Visual critic**: AGY. Owner's "4" track (service 고도화 BACKLOG #323 (d)).
> **Chart work** → follow `docs/manuals/chart-dev-checklist.md` (required).
> Source recon: Kimi data scope (fh-303) + AGY visual recon (`superinvestors_visual_recon.md`).

## 0. Measured state (do not re-discover)
- `/superinvestors` already has `src/app/superinvestors/PortfolioCharts.tsx` with a per-guru **PerformanceChart** (line vs SPY — the 1 `<canvas>` AGY saw). So chart (a) cumulative-line ALREADY exists per-guru. Do NOT rebuild it.
- Chart libs installed: `chart.js ^4.5.1`, `react-chartjs-2 ^5.3.1`, `chartjs-chart-treemap ^3.1.0` → Scatter is available (register the needed elements per chart-dev-checklist).
- Data (same-origin, pre-computed): `data/sec-13f/analytics/portfolio_views.json` — **54/60 investors have a `performance` series** (22 dates 2021-03-31 ~ 2026-06-21) + an SPY baseline already computed. Tabs: consensus / gurus / by-ticker / trades / insights.

## 1. Scope — risk-return SCATTER (the NEW chart, this slice only)
- For each investor with a `performance` series: compute **annualized return** and **annualized volatility** from the pre-computed `performance.portfolio` series + `dates` (volatility = stdev of period returns × √(periods per year); returns from the series — do NOT recompute from raw prices).
- Render a **Scatter** (react-chartjs-2): X = volatility, Y = annualized return, one point per investor (≈54), each labeled by investor name. Add **SPY as a distinct reference point** (different color/marker) using its baseline series.
- Place it on `/superinvestors` — inside `PortfolioCharts.tsx` or a sibling component, on an appropriate tab (e.g. `insights`, or a new `성과·리스크` sub-view; your call, keep it discoverable). Match existing slate styling.
- Tooltip: investor name + annualized return % + volatility %. Optional light quadrant guide (top-left = high-return/low-vol = best).

## 2. Out of scope (do NOT do now)
- (a) cumulative-return line — already exists per-guru; do NOT rebuild (a cross-guru overlay can be a later slice).
- (c) factor-exposure radar — **deferred to v2**: per your scope, only proxy factors are possible (value=per/pbr/peg, quality=roe/opm, momentum=momentum3m, size=marketCap) with incomplete coverage and no true factor regression. Shipping a "factor" chart without Fama-French data would mislead. Revisit after a factor-data decision.

## 3. Constraints + acceptance
- Follow `docs/manuals/chart-dev-checklist.md`. tsc 0. Use the pre-computed `portfolio_views.json` `performance` series (do NOT recompute from raw prices). Null-safe: the ~6 investors lacking the series are excluded. same-origin only; NO new data/cron. Mobile responsive (chart resizes, no overflow).
- Acceptance: scatter renders ≈54 investors + SPY; positions sensible (SPY mid-field; high-return/low-vol gurus top-left); tooltips show name + return% + vol%; no console error; mobile ok; existing tabs/PerformanceChart/treemaps unchanged. AGY LIVE visual.
- Report: new component + touched line ranges + build result; do NOT commit/push — cc gates against this contract + ships.

## 4. Next (track-d roadmap)
- slice-2: cross-guru cumulative-return overlay (multi-line vs SPY) reusing the existing PerformanceChart data.
- v2 (separate, owner-gated): factor-exposure radar — requires a factor-data decision (proxy-only vs collect Fama-French).

---

## 5. SLICE-2 detail — cross-guru cumulative-return overlay (owner-approved 06-28)

> Multi-line cumulative-return overlay. Resolves the start-date caveat (Kimi scope) by restricting to SAME-period investors. ScreenerClient unaffected; edit PortfolioCharts.tsx + InsightsTab.tsx only.

### 5.1 Honesty fix (the key decision)
- **Restrict to the 54 investors that have the full 22-point series (2021-Q1 → 2026, same start)** → a TRUE same-period comparison (no "each from its own base" distortion). Investors with shorter series (15/12/8/5 obs) are EXCLUDED from the overlay (their short history would mislead). Label the card clearly: "2021-Q1 기준 누적 (동일기간 N명)".
- Default display = **top-10 of those 54 by annualized return** (readable; 54 lines is unreadable per your scope).

### 5.2 Build
- New `CumulativeReturnOverlay` component in PortfolioCharts.tsx: Chart.js Line, x = the 22 shared quarter dates, each selected investor's `portfolio` series rebased to **100 at 2021-Q1**, plus **SPY as a thick neutral line**. Up to ~10-15 lines distinguished by the existing `chartTheme.palette` (6) + dash/HSL.
- Interaction: investor multi-select + a "상위 10" button; **cap at 15 lines** (guard readability).
- Placement: InsightsTab, a "누적 수익 오버레이" card BELOW the existing risk-return scatter card (cross-guru analysis grouping).

### 5.3 Constraints + acceptance
- Follow `docs/manuals/chart-dev-checklist.md` (register LineController/elements as needed). tsc 0; same-origin `portfolio_views.json` (no new data/cron); rebase math = value/firstValue×100; null-safe; mobile responsive.
- Acceptance: overlay renders top-10 same-period gurus + SPY, all rebased to 100 at the same start; legend readable; multi-select + 상위 10 work; ≤15-line cap; scatter card + other tabs + per-guru chart unchanged. AGY LIVE.
- Report component + lines + build; do NOT commit — cc gates + ships.
