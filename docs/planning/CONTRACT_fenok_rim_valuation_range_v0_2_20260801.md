# Fenok RIM Valuation Range Contract v0.2

> **Status**: **RETIRED HISTORY** — the RIM mission and automatic execution were
> closed under the parent project's DEC-302. This contract is retained as the
> v0.2 range-design record and is not a live deployment or promotion contract.

Date: 2026-08-01
Supersedes the output-scope section of `CONTRACT_fenok_rim_index_inputs_v0_1_20260708.md`.
Everything that contract says about source tiers, KOSPI risk-free inputs, and
private/admin raw rows remains in force and is not restated here.

## What changed, and why it is not a fair-value card

v0.1 stopped at inputs: `output_scope` was `inputs_only_no_fair_value`, so the
operands of a residual income model were published while the model itself was
not. That was a decision, not a gap — `policy.no_public_single_target` forbids
publishing one number for an index, and one number is what a fair-value card is.

v0.2 publishes the model as a **band between two named assumption sets** and
still refuses the single number.

- `schema_version`: `rim_index_inputs.v2`
- `output_scope`: `inputs_and_assumption_labelled_range_no_single_target`
- `policy.no_public_single_target`: stays `true` and is validated, not asserted
- New per-index block: `derived.valuation_range_v1`, **SPX and NDX only**

CCMP, KOSPI, and SOX carry **no** range block at all. An empty or refused block
for them would invite a consumer to build a card that can never fill.

## The model

For each primary index, with `r` = published `derived.cost_of_equity`:

```
value = book_value_beginning(fy1)
      + Σ(t=1..3) residual_income_proxy(t) / (1 + r)^t
      + continuing_value / (1 + r)^3
```

`residual_income_proxy` keeps its v0.1 name and formula
`(roe_on_beginning_book - cost_of_equity) * book_value_beginning`. It is now an
operand of the band; it was never renamed.

The two endpoints differ **only** in continuing value:

| Scenario | Continuing value at fy3 | Story |
|---|---|---|
| `conservative` | residual income fades linearly to zero over `fade_years`, growing at `terminal_growth.low` | competition erodes excess returns |
| `optimistic` | `RI(fy3) * (1 + g) / (r - g)` at `terminal_growth.high` | excess returns persist and grow |

House assumptions, labelled `house_assumption` and not observed from any source:
`terminal_growth.low = 0`, `terminal_growth.high = 0.025`, `fade_years = 10`.

**No middle scenario is published.** A base case is what every reader would
quote, which reintroduces the single target through the back door. `scenarios`
carries exactly two entries and validation rejects a third.

## Publication gates

All seven must pass or the block is emitted as `blocked_no_range` with null
endpoints, no scenarios, and a stated reason per failed gate.

| Gate | Meaning |
|---|---|
| `primary_index` | the index is SPX or NDX |
| `source_tier_satisfied` | price, price-to-book, risk-free, ERP are `observed_source`; cost of equity is `derived_formula` |
| `blockers_empty` | the index carries no open blocker |
| `operands_complete` | finite positive book value, three finite residual income periods, positive terminal residual income, and `r` above the optimistic growth |
| `source_clock_honest` | the fixed clock inventory below is complete and every entry resolves to a day |
| `payout_routes_reconciled` | the two payout routes agree on **payout** within 5% |
| `model_sensitivity_bounded` | the disagreement moves **retention** by at most 5% |

### Why the last two are separate

They answer different questions and merging them hid a real defect. Whether the
two routes AGREE is a source-quality question, judged on payout itself. How much
the disagreement MOVES the model is a sensitivity question, judged on retention.

Reporting only the second let NDX read as reconciled: its payout routes differ by
**15.44%** (`0.095018` index-weighted vs `0.112363` index-level) while retention
moves only 1.9166%. A small endpoint effect is not agreement.

**NDX therefore does not publish a band.** It emits `blocked_no_range` naming
`payout_routes_reconciled`, and stays input-only until the source disagreement is
resolved. The 5% payout bound stands until evidence supports another number; it
is not tuned to let a specific index through. SPX passes at 0.142%.

Divergence is normalised by the larger of the two magnitudes, so the metric does
not depend on which route is called the reference.

### Dividend-yield unit measurement

`computed/stock_action_index.json` stores `dividendYield` in **both** units in
the same field, and not split by market: AAPL (US) is `0.00321` while MTB (US)
is `2.43`. Averaging raw produced a weighted S&P 500 dividend yield of 8.4% and
a payout ratio of `1.642454`.

Magnitude cannot decide — a percent-encoded 0.4% yield is `0.4` and a
fraction-encoded one is `0.004`, both below 1. The unit is therefore **measured**
per row against that row's own `dividendHistory.ttm / price`, and a row with no
trailing dividend and no price is **dropped, not guessed**. The published
`dividend_yield_unit_mix` reports how many rows resolved each way.

`payout_routes_reconciled` then requires, all measured and republished under
`operands.payout_cross_check`:

- payout ratio strictly inside `(0, 1)`
- weighted dividend yield in `(0, 0.06]`
- unresolvable rows at most 25% of constituents
- payout divergence between the two routes at most 5%

The validator **rederives both divergences from the source operands**
(`derived.payout_ratio.value` and `derived.legacy_payout_ratio_qa.value`) and
rejects the payload when the published `payout_cross_check` numbers disagree with
that rederivation. Published cross-check fields are evidence for a reader, never
input to the gate.

## Source clock: an exact tuple inventory

Not "whatever happened to carry a date". Every clock is the tuple
`(source, route, kind, as_of)`, and the required inventory is fixed:

The allowed kinds below are the whole rule; the capability allowlist further
down is where they are enforced, and nothing may widen them at runtime.

| Route | Sources | Kind |
|---|---|---|
| main | `observed.price`, `observed.forward_eps`, `observed.price_to_book`, `observed.risk_free_rate`, `observed.equity_risk_premium`, `computed/stock_action_index.json`, `benchmark_row` | `source_as_of` only |
| reconciliation | `reconciliation.index_yield` | `collected_at` **only** — see the capability allowlist below |

The validator compares the declared tuples against recomputed ones **in both
directions and by exact tuple**, so changing a `route` or a `kind` is as loud as
changing a date. A repeated `(source, route)` pair is rejected. Only the
reconciliation route may stand on a collection time; a main route that tries is
rejected by name.

`contributing_source_dates`, `oldest_source`, `source_clock.as_of`, and
`range.as_of` are all **recomputed** from that inventory and rejected on
mismatch. `oldest_source` is the oldest **dated** route: an undated entry sorts
first only because it has nothing to sort on, and naming it would be a clock
claim resting on a missing clock.

Dates are validated as **real calendar days**, not by shape. `2026-02-31`,
`2026-13-01`, and `2026-02-29` are rejected; `2024-02-29` is accepted.

### Ratified collection-clock exception

The reconciliation provider publishes no economic observation date. The route may
therefore stand on `index_yield_collected_at` — **the time the value was
collected, which is not evidence of when it was observed** — and only while all
of the following hold:

- it comes from the **same successful fetch-and-parse response** as the reconciled
  value, recorded as `index_yield_provenance.same_response` and emitted only when
  that response actually carried the timestamp;
- it is a valid UTC instant and is **not in the future** relative to `generated_at`;
- its age is within the provider's **750-hour** monthly delivery SLA;
- it stays labelled `kind: "collected_at"` and is never promoted to `source_as_of`
  or `observed`.

**Absence, an impossible timestamp, a future timestamp, an SLA breach, or a
relabel each block `payout_routes_reconciled`, and therefore block publication.**
Nothing about this clock asserts an observation date, and the UI says so.

### Route capability allowlist — the one rule that does not live in the payload

Deriving the expected `kind` from payload evidence is not enough. A forger who
rewrites `index_yield_as_of`, its reason, the whole provenance block, the clock
tuple, and every derived clock field **together** produces a payload where no
internal cross-check can object, because they are all the same mutable evidence.

What a payload cannot rewrite is what the **provider is able to publish**. That
capability is stated in code, in `CLOCK_ROUTE_CAPABILITIES`, and mirrored in the
consumer:

| Source | Route | Kinds it can supply |
|---|---|---|
| the five `observed.*` fields, `computed/stock_action_index.json`, `benchmark_row` | main | `source_as_of` |
| `reconciliation.index_yield` | reconciliation | `collected_at` only — SlickCharts index yield publishes a value and a fetch time, never an economic observation date |

Consequences, each covered by a named regression:

- a reconciliation route carrying **any** `index_yield_as_of` is rejected, whether
  that date is a valid past day, today, a future day, or an impossible one;
- a clock declaring a `kind` its provider cannot supply is rejected;
- a clock on the wrong route, or a source outside the allowlist, is rejected;
- the provenance block must still exist and state why the route has no
  observation date.

The consumer applies the same allowlist. It previously read
`reconciliationUsesCollectionTime` off the row's own `kind`, so a relabel would
have made the panel **drop the caveat** and show a collection time as though
someone had observed the market that day. A row outside the allowlist now refuses
the whole band, and the caveat is derived from the allowlist rather than the row.

### Gate recomputation parity

The builder blocks `payout_routes_reconciled` on these failures, and the
validator's **recomputation of that gate does the same**. Without that parity a
forger could admit the clock gate failed — keeping every clock-side check in
agreement — and lie about the payout gate alone. That case is covered by a named
regression, and the parity check is the only thing that catches it.

## Validation is recomputation by an independent oracle

The validator does **not** call the producer's calculator. `validatorScenarioOracle`
is a second implementation written from this contract, deliberately expressed
differently (`(fadeYears - k)/fadeYears` rather than `1 - k/fadeYears`,
`RI + RI*g` rather than `RI*(1+g)`), so a bug in one is not blessed by the other.

`validateRimIndexInputs` independently recomputes and rejects on mismatch:

- retention equals `1 - payout` (the old `Math.max(0, ...)` clamp is gone, so the
  published formula and the arithmetic that runs are the same expression)
- book roll-forward, ROE, and residual income per period, and that each period
  opens where the previous one closed
- explicit present value, both continuing values, both endpoints, `width_ratio`,
  and the price position
- each scenario's `continuing_value_at_fy3`, `terminal_growth`, `formula`, and
  the prose in `terminal_treatment` that names the fade years and terminal growth
- each gate predicate, re-derived from the payload rather than read from it
- the exact seven-gate key set, so deleting a gate is as loud as failing one
- forbidden single-target keys **recursively**, at any depth

## Consumer fails closed on the whole clock inventory

The reader validates the **entire** inventory, not the rows that happen to be
present. Validating row by row let a payload DELETE the reconciliation row:
every remaining row checked out and the collection-time caveat silently vanished.
Suppression by omission is the same lie as suppression by relabel and is easier
to perform, so a missing, partial, duplicate, extra, or route-swapped row refuses
the band outright.

The reader also recomputes freshness against the document's own `generated_at`
rather than the row's declared age fields: a clock dated after the document, or a
`collected_at` clock older than the 750-hour SLA, refuses the band. A document
with no usable generation clock refuses too — freshness that cannot be checked is
not freshness that may be assumed.

### Source identity is bound to evidence, not to route and kind

`observed.price` and `benchmark_row` are both `main` / `source_as_of`, so a
capability check alone cannot tell them apart and two sources could swap dates
undetected. Each source is therefore bound to the **exact field its date must
come from**:

| Source | Evidence |
|---|---|
| `observed.*` | that field's own `as_of` |
| `computed/stock_action_index.json` | `forecast_grid_v1.coverage.stock_action_source_date` |
| `benchmark_row` | `payout_ratio.coverage.benchmark_as_of` |
| `reconciliation.index_yield` | `legacy_payout_ratio_qa.coverage.index_yield_collected_at` |

The producer's validator recomputes the whole inventory from that evidence, so a
moved date fails tuple comparison. The consumer resolves the same paths from the
index entry and refuses any row whose date is not its own source's.

### `generated_at` is a complete strict UTC instant

Freshness used to slice the first ten characters off whatever string arrived, so
`"2026-08-01 is when we think"` became a valid-looking day. It is now matched
against a full `YYYY-MM-DDTHH:MM:SS(.mmm)Z` pattern, parsed, and round-tripped;
a bare day, a missing `Z`, an impossible time, or trailing prose all refuse.

### Parity is a real comparison now

Producer and consumer each hold the capability allowlist, both **deeply frozen**,
and a parity regression asserts they stay identical.

The previous version of that regression was a lie: it compared with
`JSON.stringify(map, Object.keys(map).sort())`, and the second argument is a
**replacer allowlist of key names**, so passing the top-level source names
dropped every nested field. Two maps with completely different routes and kinds
serialised to `{"a":{},"b":{}}` and compared equal — only the source-name sets
were ever compared. It now canonicalises recursively with sorted keys, and seven
drift regressions (changed route, changed kind, added kind, removed kind, added
source, removed source, renamed source) each mutate a temp copy and assert the
comparison notices, with untouched and reordered copies as controls.

The SLA parity assertion was separate and did earn its place immediately: it
caught `INDEX_YIELD_COLLECTION_SLA_HOURS` never having been exported.

## Consumer restriction

`src/app/market-valuation/rimBand.ts` is the only place allowed to decide
whether a band may be drawn. It requires an eligible index, ready status,
`emits_single_target === false`, the **exact** gate key set with every gate
passing (an extra failed gate refuses, so the reader cannot ignore a refusal the
producer wrote down), a valid ISO-day `as_of`, a recursive forbidden-key scan,
two ordered finite endpoints, and complete assumptions with `g < r`. Anything
else renders nothing — one endpoint or a midpoint is the single target the
contract forbids.

NDX is an eligible index that currently renders nothing, because its payload is
`blocked_no_range`. Eligibility and publication are separate.

The UI must show both endpoint labels, `fade_years`, terminal growth, the
discount rate, and the band's own `as_of`. Assumptions are part of the band: a
reader who cannot see them cannot tell an opinion from a measurement.

## Gates in CI

`npm --prefix 100xfenok-next run qa:rim-index` runs the producer suite, the sole
writer check, the artifact freshness check, the consumer growth/range guard, and
`qa:rim-band`. It is reached from `qa:fenok-edge-public-bundle` in
`cf:build:steps`, so the band cannot deploy without them.

## Known open item

KOSPI's constituent rows in `stock_action_index.json` carry no price and no
trailing dividend, so 198 of 237 rows have an unmeasurable dividend unit. KOSPI
consequently degrades to `input_only_krx_exact_weights_with_caveats` with a
`kospi_payout_coverage_below_threshold` blocker. This is a measurement, not a
regression: the previous READY label rested on averaging rows whose unit was
never knowable. KOSPI is input-only by policy in either state, so no public
surface lost a number it was entitled to. Supplying price and trailing dividend
for KRX rows upstream would restore coverage on its own.
