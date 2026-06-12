# DESIGN: G4 Data Coverage Program

Date: 2026-06-13
Status: D complete, E/H/U implemented in this slice
Baseline: post Pre-Phase3 data-depth audit

## Principle

The recurring failure mode is: data exists, product surfaces ignore it. G4 fixes
integrity first, then consumes depth, then polishes the expression layer without
adding unrelated pages or new formulas.

## Track D - Data Integrity Surgery

Status: complete and pushed before this slice.

- Normalize SEC 13F ticker keys and preserve alias evidence.
- Deduplicate 13F holder/consensus counts.
- Restore missing investor mirror coverage.
- Fix BRK.A/BRK.B and ETF/YF universe coverage.
- Restore 13F enrichment coverage through local YF enrichment.
- Keep worker data bundle fresh through scheduled deploy workflow.

## Track E - Estimates Everywhere

Status: implemented in this slice.

- Extend `stock_action_index` with Global Scouter detail estimate snapshots.
- Extend `stock_action_summary` with FY+1 forward PER/EPS and FY+1 revenue/EPS
  growth fields while keeping the slim summary under 250KB.
- Add Screener estimate columns, filters, and an estimate preset.
- Move deep stock detail sections out of overview into 재무/통계/추정치/보유기관
  tabs, with overview reduced to key snapshot cards and shortcuts.
- Plot FY+1~FY+3 estimates in stock detail PER/growth/financial visuals.

## Track H - Real History, Real Charts

Status: implemented in this slice.

- Replace the synthetic VIX sparkline with real VIX history from the dashboard
  snapshot path.
- Add compact TGA/stablecoin liquidity trends, CNN component trends, and AAII
  bull-bear history to `market_structure_index`.
- Replace the Damodaran country-risk list with US ERP history/regime context.
- Add Yardeni S&P 500 vs fair-value overlay with visible values and input
  decomposition.
- Join calendar event cards with previous values and as-of/series metadata.

## Track U - Expression And Layout Polish

Status: implemented in this slice.

- Rebalance Explore columns by moving action candidates into the left workflow
  column; no new cards.
- Rename source-branded card titles to function names and keep source
  attribution in footer captions.
- Replace "최근연도" with the actual latest year label when yearly return data is
  active.
- Render `benchmarkMatrix` inside Market structure so the fetched matrix is no
  longer unused.

## Gate

Low-resource verification only unless explicitly approved otherwise:

- generated-data script and mirror outputs
- targeted eslint
- `npx tsc --noEmit`
- `npm run test:live-bridge`
- data-size and schema probes
- `git diff --check`

[not verified] browser/Playwright rendering in this slice due the user's
resource-safety constraint.
