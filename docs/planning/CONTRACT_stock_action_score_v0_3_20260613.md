# CONTRACT: stock_action_index actionScore v0.3

Date: 2026-06-13
Scope: `scripts/build-phase2-closeout-indexes.mjs` -> `data/computed/stock_action_index.json`
Status: G0 contract plus G1 cron wiring target

## Purpose

`stock_action_index.json` is a product-ranking helper, not a valuation verdict.
It must be fair across markets with uneven data coverage and auditable by UI,
Admin, and peer verification.

## Output Contract

Top-level:

- `schema_version`: `2`
- `score_contract.version`: `action-score-v0.3`
- `score_contract.config`: exact generator constants
- `coverage.signal_score_percentiles_by_scope`: per `marketScope` p50/p90
- `coverage.family_coverage`: per-family eligible/present counts

Each row keeps the previous UI fields:

- `actionScore`
- `actionLabel`
- `actionBucket`
- `actionReasons`

Each row adds the v0.3 audit fields:

- `signalScore`: 0-100 strength over present eligible evidence
- `coverageRatio`: 0-1 present evidence weight over market-eligible evidence weight
- `confidenceLabel`: `high`, `medium`, or `low`
- `eligibleFamilyCount`
- `presentFamilyCount`
- `families.<family>`: `{ present, eligible, score, max }`
- `marketScope`: `us`, `korea`, `asia`, or `other`
- `canonicalSector`: sector-map canonical label
- `quality_flags`: includes `low_evidence` when evidence guard fails

## Constants

```json
{
  "schema_version": 2,
  "confidenceBlend": {
    "signalWeight": 0.7,
    "coverageWeight": 0.3
  },
  "confidenceThresholds": {
    "high": 0.75,
    "medium": 0.5
  },
  "evidenceGuard": {
    "minEligibleFamiliesForAction": 3,
    "minPresentFamiliesForAction": 3,
    "lowEvidenceActionScoreCap": 49
  },
  "familyMax": {
    "valuation": 20,
    "momentum_revision": 22,
    "income": 10,
    "index_structure": 18,
    "smart_money": 25,
    "sector_smart_money": 5
  },
  "bucketThresholds": {
    "smart_money": { "minSmartMoneyPct": 0.5, "minCoverageRatio": 0.5 },
    "value_momentum": { "minValuationPct": 0.5, "minMomentumPct": 0.4, "minCoverageRatio": 0.5 },
    "index_core": { "minIndexPct": 0.5, "minCoverageRatio": 0.5 },
    "income": { "minIncomePct": 0.45, "minCoverageRatio": 0.5 },
    "momentum": { "minMomentumPct": 0.55, "minCoverageRatio": 0.5 }
  }
}
```

## Formulas

Family scoring:

- Every family score is bounded: `0 <= score <= max`.
- Negative evidence maps to low score, never a negative total.
- Missing market-ineligible evidence is not counted in the eligible denominator.
- US-only evidence families are not eligible for non-US rows unless actual evidence is present.

Aggregate scoring:

```text
presentMax = sum(family.max where family.present)
eligibleMax = sum(family.max where family.eligible)
familyScore = sum(family.score where family.present)

signalScore = presentMax > 0 ? familyScore / presentMax * 100 : 0
coverageRatio = eligibleMax > 0 ? presentMax / eligibleMax : 0
actionScore = signalScore * (0.70 + 0.30 * coverageRatio)
```

Confidence:

```text
lowEvidence -> low
coverageRatio >= 0.75 -> high
coverageRatio >= 0.50 -> medium
else -> low
```

Evidence guard:

```text
eligibleFamilyCount < 3 OR presentFamilyCount < 3
  -> actionBucket = watch
  -> actionLabel = 관찰
  -> quality_flags includes low_evidence
  -> actionScore is capped at 49
```

## Family Rules

`valuation`

- Eligible when PER band, forward PER, or current PER exists.
- PER band is primary. High PER band gives a low positive score, not a penalty.

`momentum_revision`

- Eligible when 12M return, 3M momentum/growth, or EPS revision exists.
- Downward revision gives a low positive score, not a penalty.

`income`

- Eligible when dividend yield, TTM dividend, or dividend history exists.
- Yield tiers graduate from low score to max score.

`index_structure`

- Eligible for US scope, or any row with SlickCharts membership/weight evidence.
- Non-US rows without index evidence are not penalized by this family.

`smart_money`

- Eligible for US scope, or any row with guru/consensus/conviction evidence.
- Conviction is a contribution, not an automatic `smart_money` bucket override.

`sector_smart_money`

- Uses `100xfenok-next/src/lib/design/sector-map.json` as SSOT.
- 13F GICS sector names map through `gicsToCanonical`.
- Global Scouter Korean sector names map through `scouterToCanonical`.
- Coverage must report `sector_smart_money_joined_count > 0`.

## Bucket Contract

Buckets are selected from passing candidates by strongest family contribution.

- `smart_money`: smart-money family threshold + coverage threshold
- `value_momentum`: valuation threshold + momentum/revision threshold + coverage threshold
- `index_core`: index-structure threshold + coverage threshold
- `income`: income threshold + coverage threshold
- `momentum`: momentum/revision threshold + coverage threshold
- fallback: `watch`

## Comparability

`actionScore` is rank-comparable only within the same `marketScope`.
Any UI that surfaces `actionScore` should pair it with `confidenceLabel`.
This UI pairing is a G3 dependency, not part of G0/G1 wiring.

## Verification Gate

Required low-resource checks before push:

- `node scripts/build-phase2-closeout-indexes.mjs`
- `jq` checks:
  - `schema_version == 2`
  - `coverage.sector_smart_money_joined_count > 0`
  - each `coverage.signal_score_percentiles_by_scope[]` has `p50/p90`
  - no row has `actionScore < 0` or `actionScore > 100`
  - no non-watch bucket violates `eligibleFamilyCount >= 3` and `presentFamilyCount >= 3`
- root/public mirrors match for generated JSON outputs
- `git diff --check`

Browser/dev-server/Playwright checks are not part of this gate unless the user
explicitly approves resource-heavy verification.
