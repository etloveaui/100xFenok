# Fenok Conviction v0.2 Recalibration Plan

Date: 2026-06-28 KST
Status: plan only; no data or code changes in this slice
Branch: `wip-fenok-conviction-v0-2-recalibration-20260628`
Owner gate: required before changing shipped signal definitions

## Executive Answer

Fenok Conviction v0.1.1 should not be silently redefined to chase Prospero
screenshot numbers. The defensible path is a v0.2 schema that keeps the current
transparent native baseline, adds Prospero-comparable axes where Fenok has
enough evidence, and then recalibrates the public conviction composite under an
explicit owner-review gate.

The minimum v0.2 change should be:

1. Keep current `profitabilityScore` semantics available as peer-relative
   efficiency.
2. Add an absolute/durability profitability axis that can read closer to
   Prospero's profitability card.
3. Split `upsideDownsideScore` into public `upsidePotentialScore` and
   `downsidePressureScore`; keep the current net score as a derived balance
   field only.
4. Recompute conviction only after the owner approves which axes are user-facing
   and which are compatibility aliases.
5. Wire Asset Allocator methods in layers: SSP Stage B as a durable base,
   Forecast Arena-style Prospero combo as tactical overlay, SSP evidence gate as
   quality multiplier, and outcome loops as calibration feedback.

## Why v0.2 Is Needed

The value-validation slice found that current Fenok values diverge from
Prospero screenshot semantics:

- DASH: profitability 19.31 vs Prospero 53; internal upside 62.14 vs 58;
  internal downside 51.00 vs 30.
- UNH: profitability 22.98 vs Prospero 81; internal upside 44.69 vs 79;
  internal downside 51.71 vs 36.

This is not an arithmetic bug. It is a semantics mismatch:

- Current profitability is a sector peer-percentile of gross margin, operating
  margin, and ROE.
- Current public `upsideDownsideScore` is a neutral-centered net score:
  `50 + ((upside - downside) / 2)`.
- Current full artifact already has separate upside/downside internals, but the
  public summary does not expose them.
- Current source contract says analyst target upside/downside is not available
  in the source artifact, so v0 uses valuation-band and forward-PE proxies.

## Prospero-Comparable Axes, Where Defensible

### 1. Profitability

Do not replace the current peer percentile. It is useful, but it should be
renamed or mirrored as `profitabilityPeerScore` in v0.2.

Add a new `profitabilityQualityScore` or `profitabilityDurabilityScore` with
absolute scaling. This is the defensible Prospero-comparable axis.

Candidate components:

- absolute positive earnings: net income, operating income, EPS above zero
- cash durability: CFO/FCF positive, FCF margin where available
- margin durability: gross, operating, net margin level plus trend
- returns: ROE/ROA/ROIC, with sector-aware caps rather than pure percentile
- stability: multi-year positive EPS/FCF count and drawdown penalty
- estimate support: FY1/FY2/FY3 EPS trend and revision direction

Mapping rule:

- Use absolute thresholds first, then sector adjustment as a secondary modifier.
- Cap one weak peer-relative margin from dominating the score when absolute
  profit and cash durability are strong.
- Preserve `profitabilityPeerScore` for relative screening and radar continuity.

Expected anchor behavior:

- UNH should no longer be forced into the 20s solely because healthcare managed
  care has low gross/operating margin percentiles.
- DASH should improve only if positive earnings/cash and trend evidence support
  it; do not force it to Prospero 53 without evidence.

### 2. Upside

Expose `upsidePotentialScore` as a first-class public field.

Source priority:

1. analyst target upside or fair-value upside, only when source contract permits
2. valuation room from PER band / forward-PE discount
3. growth support
4. technical confirmation
5. revision support

Rules:

- If analyst target/fair-value data is absent, label the score as proxy-based.
- Do not compare current net `upsideDownsideScore` directly to Prospero Upside.
- Keep public copy clear: "upside potential proxy", not price target.

### 3. Downside

Expose `downsidePressureScore` as a first-class public field.

Important: this axis is risk pressure. Higher means more downside pressure; lower
is better. UI coloring must invert relative to positive axes.

Candidate components:

- valuation pressure
- forward-PE pressure
- negative momentum
- estimate/revision pressure
- balance-sheet or cash-flow fragility
- profitability durability gap, not raw `100 - peer profitability`

Rules:

- Stop using low peer-profitability as a direct large downside penalty.
- Separate "structural quality risk" from "near-term downside pressure".
- Keep current neutral net score as `upsideDownsideBalanceScore` or
  compatibility `fenokEdgeScore`, but do not present it as Upside.

### 4. Conviction

v0.1.1 conviction is a simple average of profitability, growth, technical flow,
and net upside/downside.

v0.2 conviction should use a two-layer composite:

```text
base_quality =
  profitabilityDurability
  + growth
  + technicalFlow
  + upsidePotential
  + (100 - downsidePressure)

fenokConviction =
  base_quality
  + tactical_overlay
  + evidence_quality_adjustment
  + outcome_calibration_adjustment
  - coverage_conflict_penalty
```

The final formula must stay explainable. If fewer than the required axes are
present, fall back to `mixed` and expose coverage/confidence rather than
over-claiming.

## Asset Allocator Reuse Plan

### SSP Stage B Base

Use SSP Stage B as the long-horizon quality base after owner review. It already
has the right skeleton: winsorize, sector-neutral z-score, weighted composite,
missingness penalty, and top-candidate ranking.

Use as:

- `aaStageBBaseScore`
- optional input to `base_quality`
- calibration reference for quality/valuation/growth weights

Do not use the current SSP weights blindly. The AA YAML is marked tentative and
must be calibrated before becoming a production Fenok signal source.

### Forecast Arena Prospero-Style Tactical Overlay

Use Forecast Arena only as a tactical overlay, not as the durable base. Its
Prospero-style combo is useful because it models:

- NetSocial high
- NetOptions high
- TechnicalFlow high
- DarkPool rating low
- ShortPressure low, with squeeze/press-down context

Free-source constraints:

- true proprietary dark-pool signal: unavailable
- FINRA off-exchange proxy: allowed only as off-exchange proxy, not true ATS
  intent
- social: disabled until terms review passes
- options: use only approved free/proxy source contracts

### SSP Evidence Gate

Use SSP process scoring as a quality multiplier when a score depends on
narrative, agent-derived, or evidence-pack inputs.

Candidate multiplier:

```text
evidence_quality_adjustment =
  citation_accuracy
  + leak_free
  + packet_bound_compliance
  + invalidation_trigger_quality
  + clone_awareness
```

This should reduce confidence or cap conviction; it should not create a bullish
score by itself.

### Outcome Loops

Use AA outcome loops to calibrate weights over time:

- Forecast Arena: Brier, logloss, hit rate, calibration bias, method weights.
- Intel signal scorer: weekly topic signal capture, realized alpha, hit/miss.

Fenok-specific outcome ledger should record:

- score snapshot date
- ticker
- formula version
- component scores
- 1w/1m/3m forward returns
- alpha vs benchmark
- bucket hit/miss
- calibration drift

### Weekly Signal Inventory

Use weekly signal pipeline output as a medium-term narrative layer only after it
is mapped to tickers and quality-gated. It should support conviction, not
override hard numeric data.

## Data and Contract Impact

New v0.2 contract should be written before implementation:

- `docs/planning/CONTRACT_fenok_native_signals_v0_2_20260628.md`

Recommended public summary fields:

```text
profitabilityPeerScore
profitabilityPeerDirection
profitabilityDurabilityScore
profitabilityDurabilityDirection
growthScore
growthDirection
technicalFlowScore
technicalFlowDirection
upsidePotentialScore
upsidePotentialDirection
downsidePressureScore
downsidePressureDirection
upsideDownsideBalanceScore
marketSimilarityScore
marketSimilarityDirection
convictionScore
convictionCall
convictionFormulaVersion
```

Compatibility choice requiring owner review:

- Option A: keep `profitabilityScore` as current peer score, add durability
  under a new name.
- Option B: move current peer score to `profitabilityPeerScore` and redefine
  `profitabilityScore` as durability score.

Recommendation: Option A for one release, because Phase B UI already consumes
`profitabilityScore`.

## UI and Re-Ship Impact

Changing semantics affects shipped Phase B surfaces. This must be treated as a
re-ship, not a hidden data refresh.

Must update:

- signal builder: `scripts/build-fenok-signals.mjs`
- native-signal contract doc
- full private artifact: `data/computed/fenok_signals.json`
- public summary: `data/computed/fenok_signals_summary.json`
- public mirror under `100xfenok-next/public/data/computed/`
- provider interface and normalizer
- screener data hook mapping
- screener types, sort keys, presets, filters
- `Fenok Edge` column/tooltip wording
- `Fenok 컨빅션` column/tooltip wording
- expanded-row `FenokSignalRadar`
- stock detail signal summary card

Current code evidence:

- Builder formula version and signal keys are defined in
  `scripts/build-fenok-signals.mjs:10`.
- Current profitability formula is peer-margin/ROE percentile at
  `scripts/build-fenok-signals.mjs:294`.
- Current net upside/downside formula is at
  `scripts/build-fenok-signals.mjs:343` and `scripts/build-fenok-signals.mjs:361`.
- Current conviction average and buckets are at
  `scripts/build-fenok-signals.mjs:486`.
- Current public fields are emitted at `scripts/build-fenok-signals.mjs:499`.
- Provider type lists conviction and signal fields at
  `100xfenok-next/src/features/stock-analyzer/data/fenok-signals-summary-provider.ts:13`.
- Provider normalizer currently maps profitability/growth/technical/net edge but
  must be checked/fixed for all v0/v0.2 fields at
  `100xfenok-next/src/features/stock-analyzer/data/fenok-signals-summary-provider.ts:92`.
- Screener hook maps `upsideDownsideScore` to `fenokEdgeScore` at
  `100xfenok-next/src/hooks/useScreenerData.ts:179`.
- Screener columns expose `Fenok Edge`, `Fenok 컨빅션`, and signal axes at
  `100xfenok-next/src/app/screener/ScreenerClient.tsx:52`.
- Screener URL/filter state already has `fenokEdgeMin`, `convictionMin`, and
  `fenokPicks` preset wiring at `100xfenok-next/src/lib/screener/filter-url.ts:21`.
- Expanded-row radar uses the four current axes at
  `100xfenok-next/src/components/screener/FenokSignalRadar.tsx:40`.
- Stock detail card repeats the same current axes at
  `100xfenok-next/src/app/screener/StockDetailPanel.tsx:2027`.
- `/stock/[ticker]` Fenok signal lens still uses `upsideDownsideScore` and
  `marketSimilarityScore` chips at
  `100xfenok-next/src/app/stock/[ticker]/FenokSignalLensCard.tsx:21`.

Can stay unchanged initially:

- raw/private policy: full `fenok_signals.json` stays private/admin-only
- `marketSimilarityScore` remains excluded from conviction unless separately
  approved
- action-score pipeline remains separate
- 13F factor radar `profitabilityScore` is a separate Fama-French factor output
  and must not be swept into this rename automatically
- no social/firehose, true dark-pool, borrow fee, or paid data

## Owner-Review Gate

No implementation should start until the owner approves:

1. Whether v0.2 redefines `profitabilityScore` or adds parallel fields first.
2. Whether public UI should show both peer profitability and durability
   profitability.
3. Whether `Fenok Edge` should remain net upside/downside or be renamed to
   `Balance`.
4. Whether downside pressure should appear as a standalone visible axis, with
   inverted color semantics.
5. Whether conviction formula should use `100 - downsidePressure`.
6. Whether SSP Stage B tentative weights can be used, or only its structure.
7. Whether Forecast Arena prototype code can be promoted into production.
8. Which free-source overlays are permitted:
   - FINRA off-exchange proxy
   - OCC/Cboe/yfinance options proxy
   - social/news sentiment
9. Whether outcome calibration can alter weights automatically or only produce
   owner-review reports.

## Proposed Implementation Phases

### Phase 0: Owner Gate and Contract

- Write v0.2 contract.
- Freeze names, semantics, display copy, and public/private policy.
- Decide compatibility aliases.
- Define anchor calibration set beyond UNH/DASH.

### Phase 1: Schema-Only Compatibility

- Add new fields to builder output with null or mirrored values only if owner
  approves.
- Update provider/types/hooks to parse v0.2 fields without breaking v0.1.1.
- Add tests/fixtures for array-field order.

### Phase 2: Profitability Durability Axis

- Add absolute/durability scoring.
- Keep peer score for comparison.
- Run UNH/DASH anchor review plus broad distribution sanity check.

### Phase 3: Split Upside and Downside

- Expose `upsidePotentialScore`.
- Expose `downsidePressureScore`.
- Keep `upsideDownsideBalanceScore`.
- Update UI copy and color inversion for downside.

### Phase 4: Conviction Recalibration

- Recompute conviction from the v0.2 axes.
- Compare bucket distribution vs v0.1.1.
- Keep prior formula version available in manifest/history.

### Phase 5: AA Overlay and Outcome Ledger

- Add SSP Stage B base only after weight approval.
- Add tactical overlay only from approved free-source contracts.
- Add outcome ledger before allowing auto-calibrated weights.

Implementation verification should include builder syntax, generated JSON schema
diff, public/private mirror `cmp`, provider parse tests, frontend typecheck/build,
screener filter/sort smoke, anchor ticker tables, bucket migration tables, and
owner review before any auto-weight change.

## Acceptance Criteria For The Next Implementation Slice

- Owner gate decision is recorded.
- v0.2 contract exists before code changes.
- No raw/private full artifact is exposed publicly.
- Existing v0.1.1 fields remain backward-compatible for one release unless the
  owner explicitly approves a breaking rename.
- Public UI labels distinguish:
  - peer profitability
  - durability profitability
  - upside potential
  - downside pressure
  - net balance / Fenok Edge
- Validation reports show UNH/DASH, but do not optimize only to those two
  screenshots.

## Non-Goals

- No data changes in this planning slice.
- No implementation in this planning slice.
- No claim of Prospero parity.
- No paid data.
- No true real-time dark-pool print.
- No StockTwits/social ingestion before terms review.
- No owner-gate bypass for shipped signal semantics.

## Verification For This Plan

Performed:

- Read handoff `fh-20260628-522-cc-78549335`.
- Read previous Prospero value-validation/AA reference doc from branch
  `wip-prospero-value-validation-aa-20260628`.
- Inspected latest `origin/main` worktree at `3bec77043c`.
- Inspected current builder, provider, screener hook, screener UI, radar, stock
  detail card, and v0.1.1 contract.

Not verified:

- Original screenshot images were not reopened.
- Prospero internal formula remains unavailable.
- No runtime/browser smoke was run because this is plan-only.
