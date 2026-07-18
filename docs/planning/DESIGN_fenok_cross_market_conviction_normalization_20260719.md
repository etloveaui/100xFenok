# DESIGN: Fenok Cross-Market Conviction Normalization

Date: 2026-07-19  
Status: design-only; gate pending, implementation not started  
Scope: Fenok stock short-term conviction / Edge Score formula family  
Target contract module: `scripts/lib/fenok-proxy-formula-contract.mjs`

## Decision

Use a staged three-score contract. Do not publish a cross-market-comparable
score from the current axes:

1. `shortTermCommonBasisScore` is the mean of the same three currently emitted
   inputs in every supported market. It discloses composition only and is not
   valid for cross-market ranking, filtering, or strength comparison.
2. `shortTermConvictionScore` remains the market-local score for compatibility.
   US rows may add the two US-only flow inputs; Korea and Asia remain on the
   three common inputs. Every row publishes its basis and actual input count.
3. `shortTermComparableScore` remains absent/null until the three underlying
   axes are rebuilt on common currency, benchmark, and fixed-scale contracts.
   Cross-market score features stay disabled until that producer is live.

Do not use per-market percentile anchoring in v1. Percentiles answer "rank
inside this market," not "same signal strength," and would erase measured
regime differences in the common-basis score.

This document does not change a formula version or regenerate artifacts.

## Problem

The current local score averages whichever inputs are present:

- common: `technical_flow`, `volume_liquidity_trend`,
  `short_term_relative_strength`;
- US-only enrichment: `net_options_proxy`, inverted
  `short_pressure_proxy`.

US rows can therefore use up to five inputs while Korea and Asia can use only
three. A mean does not become comparable merely because every output is on a
0-100 scale: the component set and its distribution differ. The three common
keys are not yet comparable either:

- `technical_flow` includes market-sector or market-scope percentile ranks;
- `volume_liquidity_trend` scores close times volume before conversion from
  local quote currency to USD;
- `short_term_relative_strength` compares local-currency returns with USD SPY
  returns without an FX-return adjustment.

Therefore "same three keys" is a common-basis disclosure, not proof of the
same economic signal strength.

The 2026-07-19 label slice discloses this basis in the UI. This design closes
the formula side without weakening that disclosure.

## Distribution Evidence

Measurement basis:

- 1,177 stock rows from `data/computed/fenok_signals.json`;
- common inputs from native-signal rows;
- US enrichment recomputed read-only by ticker from
  `fenok_flow_proxies.json` v0.3 and `fenok_occ_options_volume.json` v0.2;
- Type-7 interpolated quantiles; no artifacts were written;
- the native-signal artifact was still v0.2.1, so the enriched figures below
  are modeled from the current producer artifacts, not claimed as emitted
  v0.2.2 output.

| Market | Rows | Actual local input counts | Common-3 full | Common-basis p10 / p50 / p90 | Modeled local p10 / p50 / p90 |
|---|---:|---|---:|---|---|
| US | 749 | 1:1, 3:61, 4:2, 5:685 | 748 | 29.90 / 47.22 / 64.37 | 34.67 / 50.58 / 63.47 |
| Korea | 337 | 3:337 | 337 | 18.51 / 34.43 / 56.16 | same as common |
| Asia | 91 | 3:91 | 91 | 30.61 / 46.39 / 63.97 | same as common |

Additional findings:

- US common-vs-local correlation is 0.7898, so enrichment materially changes
  ordering rather than merely adding a constant offset.
- US local minus common has mean +2.50, standard deviation 8.08, p10 -7.63,
  median +2.07, and p90 +12.51.
- Exact-boundary saturation is not the remaining defect: neither common nor
  modeled local has mass at 100; only one US common/local row is exactly 0.
- Requiring all three common inputs would make 1/1,177 rows unavailable and
  preserve 1,176 common-basis rows.

The Korea median being lower than the US/Asia common-basis medians is visible
with the same keys, but it cannot yet be interpreted as a lower economic signal
level because the axes still mix cohort and currency bases. Per-market
percentile normalization would hide the difference without repairing those
bases, so it is not an acceptable shortcut.

## Formula Contract

### Inputs

```text
COMMON_KEYS = [
  technical_flow,
  volume_liquidity_trend,
  short_term_relative_strength,
]

US_ENRICHMENT_KEYS = [
  net_options_proxy,
  invert(short_pressure_proxy),
]
```

`off_exchange_activity_proxy` remains excluded because it is non-directional.

### Current common-basis score

```text
if market_scope not in {us, korea, asia}: null
if finite(COMMON_KEYS) != 3: null
shortTermCommonBasisScore = mean(COMMON_KEYS)
```

No missing common input is reweighted away. The field name deliberately does
not claim comparability.

### Market-local score

```text
if shortTermCommonBasisScore is null: null
if market_scope == us:
  shortTermConvictionScore = mean(COMMON_KEYS + present(US_ENRICHMENT_KEYS))
else:
  shortTermConvictionScore = shortTermCommonBasisScore
```

The local score must also emit:

- `shortTermInputCount`: integer 3-5;
- `shortTermBasisCode`: `us_enriched_v1` or `common_3_v1`;
- `shortTermCommonBasisCall` and `shortTermConvictionCall`, each derived from
  its own score using the declared call thresholds;
- `shortTermComparableScore` and `shortTermComparableCall`: absent/null until
  the normalized producer contract below is satisfied.

Call thresholds are exact: score >= 70 is `concentrated`, score <= 40 is
`diluted`, otherwise `mixed`; a null score always produces a null call.

There is no silent fallback from comparable to common-basis or local in a
cross-market consumer.

### Future normalized comparable score

The comparable producer may turn on only after all three axes use these common
contracts:

1. Price returns are computed in FX-adjusted USD price-return space, not total
   return. For quote currency `q`,
   `usd_price_t = split_adjusted_local_price_t * usd_per_q_t`; USD tickers use
   FX=1. The price source must identify split adjustment; dividends are
   explicitly excluded. Missing/stale FX or unverified split treatment fails
   the comparable axis closed.
2. Liquidity uses USD ADV20 (`close * volume * usd_per_q`) and the existing
   dimensionless volume ratios. Price confirmation uses USD return.
3. Relative strength subtracts the same-date SPY USD return from the ticker's
   USD return for every market.
4. Technical momentum removes market/sector percentile components. Each input
   maps through globally fixed, versioned ranges; cohort membership cannot
   change a ticker's score.
5. Dates are aligned to the latest common observations inside a declared
   trading-day tolerance. No forward-filled FX value beyond its freshness SLA
   is allowed.

Only then:

```text
if finite(NORMALIZED_COMPARABLE_KEYS) != 3: null
shortTermComparableScore = mean(NORMALIZED_COMPARABLE_KEYS)
shortTermComparableCall = call(shortTermComparableScore)
```

The exact technical-momentum ranges and FX source/SLA require a frozen evidence
calibration slice before implementation. Until those prerequisites are
approved and tested, the field remains null and cross-market ranking remains
blocked.

## Shared Module Boundary

Implementation should expand `fenok-proxy-formula-contract.mjs` into the
formula-family SSOT while keeping it a pure leaf:

- producer formula-version constants;
- common/enrichment key constants;
- pure score builders and basis metadata;
- assertion helpers for producer and consumer version parity.

The module must not import builders, artifacts, UI code, or data-supply config.
Builders and consumers import the contract, never the reverse.

## Consumer Rules

- Cross-market screener sort/filter: disabled until
  `shortTermComparableScore` is non-null under the normalized producer
  version; never use common-basis or local as fallback.
- Per-ticker Short Edge detail: market-local score plus the shipped basis label.
- Same-market ranking may use the local score only when labeled as market-local.
- Public summary and TypeScript provider must preserve common-basis/local
  scores and calls, nullable comparable fields, basis code, and input count.
- Existing `shortTermScore` compatibility alias remains local until every
  consumer is migrated; it must never be used for a new cross-market feature.

Consumer sweep:

- `scripts/build-fenok-signals.mjs`;
- `scripts/build-fenok-signal-lens-proxies.mjs`;
- `fenok-signals-summary-provider.ts` and `useScreenerData.ts`;
- Screener columns, filters, presets, and stock detail Edge sections;
- Signal Lens, freshness, public-mirror, and artifact-parity gates.

## Formula-Version and Artifact Protocol

The implementation is a user-visible formula change and requires a native
signal formula-version bump. The exact version string is chosen in the
implementation slice, not in this design-only commit.

No open stale-artifact window is allowed. Use an emitter-first two-stage
release:

1. RED tests land in the worktree before formula code.
2. Stage A adds the backward-compatible producer/schema fields, exact version
   assertions, regenerated root/public artifacts, and parity gates. Existing
   consumers continue using the local alias and ignore the new fields.
3. Push Stage A only with matching generated artifacts. Do not depend on a
   post-push producer dispatch to close parity.
4. Verify the committed/public artifact version and parity after Stage A.
5. Stage B flips consumers only after Stage A is green. The consumer requires
   the exact producer version and fails cross-market features closed when the
   comparable field is null or stale.
6. If normalized-axis or producer prerequisites are unavailable, do not land
   the comparable formula or Stage B consumer flip.

Do not hand-edit generated data files.

## Required Tests

1. Pure current-contract fixtures: US 3/4/5 inputs, Korea/Asia exactly 3,
   missing common input, unknown market, inverted short pressure, non-finite
   values, exact 70/40 boundaries, and null score -> null call.
2. Normalized-axis fixtures: USD and non-USD equivalent price paths produce the
   same result after FX conversion; pre/post-split equivalent paths remain
   invariant; stale/missing FX, unverified split treatment, misaligned dates,
   and market percentile leakage fail closed.
3. Distribution gate on a frozen normalized evidence fixture: no exact 0/100
   bucket over 20%, cross-market coverage meets the separately approved floor,
   and fixed-range outputs are invariant to cohort membership/order.
4. Schema/alias fixtures: common-basis/local scores and nullable comparable
   fields survive full artifact, compact summary, provider normalization, and
   public projection.
5. Consumer contract: cross-market sort/filter rejects both the local alias and
   common-basis score, and stays disabled for a null/stale comparable field.
6. Formula-version consumer sweep, stale-upstream fail-closed proof, Stage A
   root/public artifact parity, then Stage B deploy verification.

## Rejected Alternatives

### Per-market percentile anchoring

Rejected for v1 because it converts level into rank, forces each cohort toward
the same distribution, changes when cohort membership changes, and gives the
91-row Asia cohort roughly 1.1 percentile points per rank position.

It may be added later as a separately named `marketPercentileRank`, never as a
replacement for comparable level score.

### Input-count scaling

Multiplying or dividing a mean by 3/5 does not correct component-distribution
differences and would manufacture a deterministic market bias.

### Treating common three inputs as comparable

Rejected because current technical flow is cohort-ranked, volume liquidity is
not currency-normalized, and relative strength mixes local-currency ticker
returns with USD SPY returns. It remains useful only as an explicitly named
common-basis disclosure.

### Universal three-input replacement only

Using only the common score everywhere would discard useful US options/short
evidence. The staged contract preserves that evidence without presenting it as
cross-market comparable.

## Rollout and Rollback

Rollout order: normalized-axis calibration -> RED tests -> Stage A
builder/schema -> regenerated artifacts -> parity/freshness gates -> Stage B
consumer migration -> deploy verification/publication watch.

Rollback is the inverse consumer migration plus the prior formula/artifact set.
Never roll back code without its matching artifacts, or artifacts without their
matching version assertions.
