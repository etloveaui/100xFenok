# CONTRACT: Fenok Native Signals v0.2 Phase A

Date: 2026-06-28
Status: owner-approved additive production builder slice
Scope: `scripts/build-fenok-signals.mjs` -> private full + public slim summary

## Purpose

v0.2 Phase A extends the Fenok-native signal layer with derived, auditable
scores that reuse existing Fenok data plus local `stockanalysis/financials`
cross-check files. It does not collect new external data during the builder
run, does not copy third-party scores, and does not change `actionScore`,
`stock_action_index.json`, or `stock_action_summary.json`.

## Source Boundary

Inputs are limited to existing local artifacts:

- `data/computed/stock_action_index.json`
- stock-action snapshots sourced from Global Scouter, revisions, Yahoo Finance,
  and SlickCharts through the existing index
- `data/stockanalysis/financials/*.json` as local financial statement
  cross-check candidates

Public payload rules:

- Public data exposes only Fenok-derived summary scores.
- The full signal artifact remains private/root-only.
- `raw_policy.full_public_mirror` remains `false`.
- `raw_policy.third_party_raw_public` remains `false`.
- Raw FINRA/OCC/Cboe/social/news rows are not published by this builder.

## Public Additions

The slim summary keeps the existing v0.1.1 field prefix unchanged and appends:

- `durabilityProfitabilityScore`
- `durabilityProfitabilityCoverage`
- `upsidePotentialScore`
- `downsidePressureScore`

`durabilityProfitabilityScore` is an observed-only absolute/capped score. Missing
components are omitted and the observed weights are renormalized.

`durabilityProfitabilityCoverage` is the separate completeness/uncertainty
ratio. It is not multiplied into the public score. The private full artifact may
include a coverage-adjusted diagnostic field for admin review only.

`upsidePotentialScore` and `downsidePressureScore` expose the existing internal
split from `signals.upside_downside`. Higher downside pressure means higher risk
pressure; UI may invert it separately only as a labeled display transform.

## Formula Version

- `formula_version`: `fenok-native-signals-v0.2.0-phase-a`
- `public_surface_status`:
  `phase_a_v0_2_stock_signal_lens_approved_summary_public`

The conviction composite remains unchanged: it averages the present
`profitability`, `growth`, `technical_flow`, and `upside_downside` scores when at
least three are available. `market_similarity` and
`durability_profitability` are not conviction inputs in this slice.

## Durability Profitability

Top-level component weights:

- positive earnings: 0.20
- cash durability: 0.20
- margin level: 0.25
- ROE/ROIC efficiency: 0.25
- multi-year stability: 0.10

Sector caps:

- Technology: gross margin 100, operating margin 60, ROE 70, ROIC 70, FCF margin
  55
- Healthcare: gross margin 65, operating margin 30, ROE 35, ROIC 35, FCF margin
  12
- Industrials: gross margin 70, operating margin 40, ROE 45, ROIC 45, FCF margin
  25
- Default: gross margin 75, operating margin 40, ROE 45, ROIC 45, FCF margin 25

Completed annual values exclude TTM when the first period is `TTM`.

## Non-Goals

- No new options, dark-pool, short-pressure, borrow, utilization, or social
  collection.
- No real-time flow claims.
- No buy/sell recommendation language.
- No public raw third-party redistribution.

## Verification

Expected commands:

```bash
node --check scripts/build-fenok-signals.mjs
node scripts/build-fenok-signals.mjs
jq '.formula_version,.public_surface_status,.raw_policy' data/computed/fenok_signals.json
cmp data/computed/fenok_signals_summary.json 100xfenok-next/public/data/computed/fenok_signals_summary.json
test ! -e 100xfenok-next/public/data/computed/fenok_signals.json
```
