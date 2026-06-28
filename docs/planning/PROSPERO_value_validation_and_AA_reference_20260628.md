# Prospero Value Validation and Asset Allocator Reference

Date: 2026-06-28 KST
Branch: `wip-prospero-value-validation-aa-20260628`
Scope: Fenok Conviction follow-up after slice 1 shipped to `main`.

## Executive Answer

The current Fenok Conviction v0 data layer is directionally useful, but it does
not yet reproduce the Prospero screenshot semantics. The only close anchor is
DASH upside. Profitability and downside diverge materially for both DASH and
UNH, mostly because Fenok v0 uses sector-percentile margin/ROE and a
neutral-centered upside-downside net score, while Prospero displays separate
card scores.

Asset Allocator already has reusable building blocks, but they should be
absorbed as Fenok-native methodology rather than copied as a literal Prospero
clone:

- Long-horizon base: SSP Stage B composite factor screen.
- Tactical overlay: Prospero-style short-term combo from Forecast Arena.
- Quality gate: SSP thesis/process scoring and evidence compliance.
- Feedback loop: Forecast Arena Brier/logloss/hit metrics plus Intel
  signal-outcome alpha/hit scoring.
- Signal inventory: weekly pipeline that compresses broad intelligence into
  high-signal buckets.

## Value Validation

Prospero screenshot anchors supplied in handoff:

- UNH: Profitability 81, Upside 79, Downside 36.
- DASH: Profitability 53, Upside 58, Downside 30.

Fenok values checked from `data/computed/fenok_signals_summary.json` and full
private artifact `data/computed/fenok_signals.json`, formula version
`fenok-native-signals-v0.1.1`, generated at `2026-06-28T08:26:05.654Z`.

| Ticker | Axis | Prospero | Fenok public summary | Fenok full/internal comparable | Delta vs comparable | Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| DASH | Profitability | 53 | 19.31 | 19.31 | -33.69 | Diverges low |
| DASH | Upside | 58 | 55.57 net score | 62.14 upside | +4.14 | Roughly aligned |
| DASH | Downside | 30 | Not exposed separately | 51.00 downside | +21.00 | Too high |
| UNH | Profitability | 81 | 22.98 | 22.98 | -58.02 | Far too low |
| UNH | Upside | 79 | 46.49 net score | 44.69 upside | -34.31 | Far too low |
| UNH | Downside | 36 | Not exposed separately | 51.71 downside | +15.71 | Too high |

Important interpretation:

- Public `upsideDownsideScore` is not Prospero `Upside`. It is
  `50 + ((upside_score_0_100 - downside_score_0_100) / 2)`.
- Fenok full artifact has separate `upside_score_0_100` and
  `downside_score_0_100`, but the public summary currently exposes only the
  net score.
- Analyst target upside/downside is unavailable in the current source artifact;
  v0 uses valuation-band and forward-PE proxies.

Root causes:

- `profitabilityScore` is a peer-percentile proxy using gross margin,
  operating margin, and ROE. It penalizes low-margin business models even when
  absolute earnings durability may be strong.
- `downside_score_0_100` includes `profitability_gap = 100 - profitability`,
  so the low profitability proxy mechanically raises downside for both DASH and
  UNH.
- Prospero likely mixes absolute profitability, stability, expectations, and
  forward-looking upside/downside semantics. Fenok v0 is currently a transparent
  native proxy, not a Prospero-value replica.

## Asset Allocator References

Actual checked path:
`/Users/fenomenokim/agents-workspace/00_my_data/01_El_Fenomeno/00_Project/Asset_Allocator`.

The handoff path without `00_Project` did not exist on disk.

### 1. SSP Stage B Long-Horizon Base

`scripts/ssp_stage_b_screen.py` is the strongest reusable base for a durable
Fenok conviction score. It reads an equity master, computes an 8-factor
composite, then applies winsorize, sector-neutral z-score, weighted composite,
and a missingness penalty before ranking top candidates.

Relevant factors from `docs/products/ssp/config/ssp_stage_b_weights.yaml`:

- momentum_12_1
- liquidity_adv_z
- regime_tilt_score
- revision_proxy_3m
- profitability_roic
- valuation_ev_to_ebit
- growth_sales_2y_cagr
- balance_sheet_quality
- optional PIT factors for research paths

Status caveat: the YAML is marked `tentative`, so the structure is reusable but
the exact weights are not yet locked.

### 2. Prospero-Style Tactical Overlay

`docs/agent-work/forecast_arena/enriched_features.py` contains a
Prospero-style short-term combo:

- NetSocial high.
- NetOptions high.
- TechnicalFlow high.
- DarkPool rating low.
- ShortPressure low, with squeeze/press-down context.

The file ranks raw features into cross-sectional percentiles and treats the
Prospero combo as a 1-day/tactical signal. This is useful as an overlay, not as
the durable base.

Status caveat: `forecast_arena` is an agent-work/prototype area. It should be
promoted only after owner review.

Dark-pool caveat from that code:

- True proprietary dark-pool signal is excluded.
- Free proxy is FINRA off-exchange activity.
- Off-exchange includes ATS plus OTC/internalizers, so it is not true ATS-only
  dark-pool intent.

### 3. Evidence Quality Gate

SSP thesis/process scoring already has a contract for numeric `conviction` and
`confidence`, plus process scoring for:

- leak-free status
- evidence citation accuracy
- clone-awareness compliance
- invalidation trigger quality
- packet-bound compliance

This can become a penalty/quality multiplier for Fenok Conviction when a score
depends on narrative or agent-derived evidence.

### 4. Outcome and Calibration Loop

Two existing AA loops are reusable:

- Forecast Arena computes Brier, logloss, hit rate, and calibration bias, then
  updates method weights.
- `scripts/intel_signal_scorer.py` captures weekly topic signals and scores
  realized alpha/hit against SPY or mapped ticker groups.

This is the right path for gradual calibration: do not hard-code screenshot
targets; use Prospero screenshots as semantic anchors, then measure hit/alpha.

### 5. Weekly Signal Inventory

`scripts/weekly_signal_pipeline.py` reduces roughly 3,000 weekly intelligence
items into 50-80 high-signal items via velocity, quality, sentiment shift,
narrative acceleration, cross-source corroboration, and novelty dedup.

This can feed a medium-term narrative/confirmation layer for Fenok Conviction.

## Recommended Fenok Conviction v0.2 Shape

Proposed assembly:

```text
FenokConvictionV0.2 =
  long_horizon_quality_base
  + tactical_flow_overlay
  + evidence_quality_adjustment
  + outcome_calibration_adjustment
  - coverage_and_conflict_penalty
```

Implementation implications:

1. Keep v0.1.1 as the transparent native baseline.
2. Expose separate public fields for `upsidePotentialScore` and
   `downsidePressureScore`; keep net `upsideDownsideScore` only as a derived
   balance score.
3. Rework profitability into two layers:
   - peer efficiency: current gross margin, operating margin, ROE percentile
   - durability: positive earnings/FCF, margin trend, EPS stability, revision
     direction, balance-sheet resilience
4. Reduce downside over-penalty from low profitability by separating:
   - structural quality risk
   - valuation pressure
   - price momentum risk
   - estimate/revision risk
5. Add an AA-derived base score once SSP Stage B weight status is calibrated or
   owner-approved.
6. Add tactical overlay only where free-source contracts are clear:
   - options: yfinance/OCC/Cboe proxies where allowed
   - off-exchange: FINRA daily short-volume/off-exchange proxy
   - true ATS/dark-pool prints: not free-real-time; do not label as true dark
     pool
   - social: keep disabled until terms review passes
7. Build an outcome ledger for Fenok Conviction:
   - score snapshot date
   - ticker
   - component scores
   - 1w/1m/3m forward return
   - alpha vs benchmark
   - hit/miss by bucket
   - calibration drift

## Go-Forward Guardrails

- Do not claim Prospero parity from the current UNH/DASH values.
- Do not expose full raw/private signal JSON publicly; expose derived public
  scores only.
- Label FINRA-based data as off-exchange proxy, not true dark-pool intent.
- Treat Prospero screenshots as semantic calibration anchors, not target values
  to copy.
- Keep `marketSimilarityScore` excluded from the conviction average unless a
  new owner-reviewed rationale says otherwise.

## Evidence Pointers

100xFenok:

- `scripts/build-fenok-signals.mjs:294` - profitability component formula.
- `scripts/build-fenok-signals.mjs:343` - upside/downside formula.
- `scripts/build-fenok-signals.mjs:361` - net score formula.
- `scripts/build-fenok-signals.mjs:486` - conviction composite builder.
- `data/computed/fenok_signals.json:21545` - DASH full private artifact.
- `data/computed/fenok_signals.json:79457` - UNH full private artifact.
- `docs/planning/CONTRACT_fenok_native_signals_v0_1_20260628.md:206` -
  upstream proxy contract for upside/downside.

Asset Allocator:

- `scripts/ssp_stage_b_screen.py:1` - Stage B broad quant screen purpose.
- `scripts/ssp_stage_b_screen.py:74` - active price/fundamental factor sets.
- `scripts/ssp_stage_b_screen.py:360` - weighted composite with missing penalty.
- `docs/products/ssp/config/ssp_stage_b_weights.yaml:1` - Stage B factor SSOT.
- `docs/products/ssp/config/ssp_stage_b_weights.yaml:13` - tentative status.
- `docs/agent-work/forecast_arena/enriched_features.py:52` - 1d signal weights.
- `docs/agent-work/forecast_arena/enriched_features.py:1121` -
  Prospero-style combo.
- `docs/agent-work/forecast_arena/enriched_features.py:1631` -
  free/proxy feature map and dark-pool caveat.
- `scripts/ssp_iteration/process_scorer.py:438` - evidence/process scorecard.
- `scripts/intel_signal_scorer.py:120` - weekly signal capture.
- `scripts/intel_signal_scorer.py:179` - realized alpha/hit scoring.
- `scripts/weekly_signal_pipeline.py:5` - high-signal weekly compression.

## Verification

Commands used, read-only except this document:

- `rg`/`nl` over Asset Allocator docs/scripts for Prospero, conviction,
  composite, signal scorer, SSP, and weekly-signal references.
- `jq` over `data/computed/fenok_signals_summary.json`.
- `jq` over `data/computed/fenok_signals.json`.
- `git pull --ff-only` in the isolated documentation worktree before editing.

Not verified:

- Original screenshot image files were not re-opened in this slice.
- Prospero internal formulas are unavailable.
- AA prototype promotion readiness requires owner review.
