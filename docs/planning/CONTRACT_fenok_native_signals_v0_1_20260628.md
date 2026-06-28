# CONTRACT: Fenok Native Signals v0.1

Date: 2026-06-28
Status: additive Class A signal layer
Scope: `scripts/build-fenok-signals.mjs` -> private full + public slim summary

## Purpose

`fenok_signals.json` absorbs Prospero-like methodology into Fenok-native,
auditable signals without copying third-party scores or collecting new external
data.

The artifact is additive. It must not change `actionScore`,
`stock_action_index.json`, or `stock_action_summary.json`.

## Source Boundary

Inputs are limited to existing Fenok generated fields already present in:

- `data/computed/stock_action_index.json`
- `global-scouter/stocks/detail/*.json` via the stock action index snapshots
- `global-scouter/core/revision_movers.json` via the stock action index
- `yf/quarter_closes.json` via the stock action index
- `slickcharts/stocks-returns.json` via the stock action index

No external collection is performed by this builder.

Public payload rule:

- Derived Fenok scores only.
- The full signal artifact is private/root-only.
- The public artifact is a compact tuple summary under 200KB.
- No raw FINRA/OCC/Cboe/StockTwits/GDELT rows.
- Phase A public product consumption is approved for the `/stock/[ticker]`
  Fenok signal lens card only. Screener/default-table consumption remains
  owner-gated until a separate Phase B approval.

## Full Output Contract

Path:

- `data/computed/fenok_signals.json`

Public mirror:

- none

This full artifact is intended for admin/developer analysis and future
surface-generation jobs. It is not shipped under `100xfenok-next/public/`.

Top-level:

- `schema_version`: `1`
- `formula_version`: `fenok-native-signals-v0.1.0`
- `source_file`: `computed/stock_action_index.json`
- `source_generated_at`: inherited source timestamp
- `public_surface_status`: `phase_a_stock_signal_lens_approved_summary_public`
- `raw_policy.external_collection`: `false`
- `raw_policy.full_public_mirror`: `false`
- `raw_policy.third_party_raw_public`: `false`
- `raw_policy.public_payload`: `computed/fenok_signals_summary.json`
- `missing_class_a_inputs`: explicit unavailable or source-contract-pending
  inputs
- `coverage.signal_counts`: per native signal count
- `rows`: per ticker derived signal rows

Each row:

- `ticker`
- `company`
- `market_scope`
- `canonical_sector`
- `as_of`
- `formula_version`
- `confidence`
- `coverage_ratio`
- `source_families`
- `stock_action_context`
- `signals`

## Slim Summary Contract

Paths:

- `data/computed/fenok_signals_summary.json`
- `100xfenok-next/public/data/computed/fenok_signals_summary.json`

The summary is the only public data artifact from this slice. It is approved
for the `/stock/[ticker]` Fenok signal lens card only.

Top-level:

- `schema_version`: `1`
- `generated_at`
- `source_file`: `computed/fenok_signals.json`
- `formula_version`
- `public_surface_status`: `phase_a_stock_signal_lens_approved_summary_public`
- `fields`
- `coverage`
- `rows`

Each summary row is a compact tuple with this field order:

- `ticker`
- `company`
- `marketScope`
- `canonicalSector`
- `asOf`
- `confidence`
- `coverageRatio`
- `profitabilityScore`
- `profitabilityDirection`
- `growthScore`
- `growthDirection`
- `technicalFlowScore`
- `technicalFlowDirection`
- `upsideDownsideScore`
- `upsideDownsideDirection`
- `marketSimilarityScore`
- `marketSimilarityDirection`

Signal keys:

- `profitability`
- `growth`
- `technical_flow`
- `upside_downside`
- `market_similarity`

## Scoring Method

Most numeric components are converted to peer-percentile scores. Peer groups
are selected in this order:

1. same `marketScope` + same `canonicalSector`
2. same `marketScope`
3. all rows

The sector group is used only when there are enough comparable rows. Otherwise
the builder falls back to the wider market or global group.

Confidence follows the existing stock-action coverage style:

```text
blendedCoverage = nativeSignalCoverage * 0.70 + stockActionCoverage * 0.30
>= 0.75 -> high
>= 0.50 -> medium
else low
```

## Signal Definitions

`profitability`

- gross margin weighted FY1/FY2/FY3 percentile
- operating margin weighted FY1/FY2/FY3 percentile
- ROE weighted FY1/FY2/FY3 percentile

`growth`

- revenue growth weighted FY1/FY2/FY3 percentile
- EPS growth weighted FY1/FY2/FY3 percentile
- forward EPS FY1-to-FY3 growth span percentile
- EPS revision direction rule score when available

`technical_flow`

- 12M return percentile
- 1Y return percentile
- SlickCharts latest return percentile
- momentum consistency rule score

This is not true order flow. Volume surge, borrow pressure, options flow, and
dark-pool activity are excluded until source contracts pass.

`upside_downside`

- `upside_score_0_100`: valuation room, forward PE discount, growth support,
  technical confirmation, and revision support
- `downside_score_0_100`: valuation crowding, forward PE pressure, negative
  momentum, profitability gap, and revision pressure
- `score_0_100`: neutral-centered net score

Analyst target upside/downside is not available in the current source artifact;
v0 uses valuation-band and forward-PE proxies instead.

`market_similarity`

- nearest peers by normalized vector distance
- candidate set prefers same market and same canonical sector
- falls back to same market, then global
- vector features: market cap rank, forward PE rank, PER-band rank,
  profitability score, growth score, technical-flow score, 12M-return rank

The score is a comparability score, not a buy/sell signal.

## Non-Goals

- Do not duplicate or replace action-score.
- Do not add UI exposure outside the approved `/stock/[ticker]` Phase A card.
- Do not collect FINRA/OCC/Cboe/StockTwits/GDELT data in this builder.
- Do not publish raw third-party rows.
- Do not infer unavailable analyst target, true options flow, dark-pool intent,
  borrow fee, utilization, or social firehose data.

## Verification

Expected commands:

```bash
node scripts/build-fenok-signals.mjs
jq '.schema_version,.formula_version,.coverage' data/computed/fenok_signals.json
cmp data/computed/fenok_signals_summary.json 100xfenok-next/public/data/computed/fenok_signals_summary.json
test ! -e 100xfenok-next/public/data/computed/fenok_signals.json
git diff -- data/computed/stock_action_index.json data/computed/stock_action_summary.json
```
