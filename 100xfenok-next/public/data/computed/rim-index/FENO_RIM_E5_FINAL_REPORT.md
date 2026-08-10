# E5 historical QA — final report

Handler: cc (Opus), sole adjudicator. Criteria frozen before any historical outcome was read:
`feno-index-rim-e5-criteria.json` (`a3f8781dab`) and the proxy addendum
`feno-index-rim-e5-criteria-v2.json` (`27c7643d99`). Candidate under test: B stable-growth RI
from `ab46a51077`, unchanged.

## Verdict: `FENO_INDEX_RIM_RESEARCH_ONLY`

Three READY gates fail. Two are about data and one is about the model.

| gate | result |
|---|---|
| D1 SPX model-equivalent PIT ≥ 5 | **FAIL — 0** |
| D2 NDX model-equivalent PIT ≥ 5 | **FAIL — 0** |
| F2 NDX current 100bp g shadow does not flip direction | **FAIL** |
| M1 monotonicity · M2 Ke−g ≥ 3pp · M3 terminal share ≤ 90% · M4 payout | pass |
| F1 SPX 100bp shadow does not flip | pass |
| P1–P10, F3–F6 | not evaluable — no primary origin exists |

## Why no origin can be model-equivalent

Three of candidate B's inputs have no historical vintage in this repository.

| input | historical | same source class as live |
|---|---|---|
| index level, P/B, FY1 EPS, ROE history | monthly 2010–2026 | yes |
| risk-free rate | daily 1999–2026 | yes |
| **FY2/FY3 EPS path** | **none** | no |
| **payout routes A and B** | **none** | no |
| ERP | annual, 66 observations | no — implied series, not the country-premium file |

`computed/stock_action_index.json` is a single current file generated today with nothing archived
behind it, and the slickcharts yield files carry only the current reading. A historical ERP does
exist, but as Damodaran's implied series while live B reads the country-premium file — a
source-class mismatch rather than a gap.

So the live product cannot be tested under its own semantics at any past origin. That is a
statement about the data estate, not about the model, and the frozen criteria say missing data
alone is never a RETIRE condition.

## The proxy lane, and why nothing rests on it

The proxy was frozen before outcomes with the least invention available: FY1 stays the live
anchor, FY2 and FY3 are held flat, ERP uses the historical implied series, and payout is derived
from the point-in-time book series itself.

| index | n | band hit | median width | direction hit | Base error | no-change error | ratio | Spearman |
|---|---|---|---|---|---|---|---|---|
| SPX | 7 | 14.3% | 20.5% | 14.3% | 33.7% | 12.1% | 2.78 | 0.000 |
| NDX | 7 | 0.0% | 17.0% | 14.3% | 42.2% | 22.1% | 1.91 | −0.036 |

Read alone those numbers look damning, and reporting them as a verdict on B would be wrong.

The derived payout lands between 87% and 100% at every origin. That is not a payout ratio — it is
an artifact of deriving retention from the benchmark's implied book, `price ÷ P/B`, which is a
market ratio rather than a clean-surplus accounting book. Retention comes out near zero, B3 barely
exceeds B0, and the terminal collapses. The flat FY2/FY3 path pushes the same direction.

**Both declared degeneracies bias Base downward, and every proxy miss is Base being too low.** The
proxy cannot separate a weak model from a weak proxy, which is exactly why the frozen criteria
forbade a proxy result from satisfying any READY gate. It satisfies none, and the verdict does not
rest on it.

## The failure that is about the model

F2 is not a data limitation.

| | Base at g = Rf | Base at g = Rf − 1pp | current price | direction |
|---|---:|---:|---:|---|
| SPX | 6,526 | 5,785 | 7,490 | below at both — no flip |
| NDX | **31,452** | **27,293** | 28,274 | **above, then below — flips** |

The Nasdaq-100 conclusion reverses from undervalued to overvalued on a one-point change in an
assumption that has no observable value. This was flagged when B was frozen — `g = Rf` is
Damodaran's cap and therefore the most generous rate theory allows — and the contract's own 100bp
shadow now measures the consequence. A target whose sign depends on a parameter chosen at the edge
of its defensible range is not public-grade.

SPX survives the same test, and the pole margin is comfortable everywhere: `Ke − g` is 4.53pp
currently and 4.00pp at the worst historical origin against a 3.00pp gate.

## Why not RETIRE

RETIRE is conditioned on having at least five model-equivalent origins for both indices, and there
are none. No structural condition fired either: no pole instability, terminal share 68.5% and 79.7%
against a 95% structural threshold, monotonicity intact at every cell, and no target-fitting was
needed to produce output.

The proxy lane does satisfy all three arms of the historical anti-signal test on both indices. That
test is explicitly gated on model-equivalent origins, and using proxy numbers to trigger it would
mean retiring a product on evidence the criteria declared inadmissible before the evidence existed.

## Live rebase — same model, fresher data

Only one input had a newer release: the risk-free rate moved from 4.63% (2026-08-05) to 4.69%
(2026-08-06). The benchmark row stays 2026-07-31 and the ERP stays 2026-04-01.

| | validation snapshot | live rebase | delta |
|---|---:|---:|---:|
| SPX Base | 6,526 | 6,494 | −0.49% |
| NDX Base | 31,452 | 31,329 | −0.39% |

No `SOURCE_CLOCK_SENSITIVITY` flag. Because `g = Rf`, a move in the risk-free rate lifts both the
discount rate and the growth rate, leaving `Ke − g` untouched — the terminal denominator does not
move at all, which is why a 6bp rate change produces a sub-1% valuation change.

## What is missing for READY, stated once

Two historical vintages: an archived FY2/FY3 consensus path and an archived payout series, both
with the same source class the live model reads. With those, the primary lane becomes computable
and D1/D2 can be met. F2 would still need answering separately, and F2 is about the terminal, not
about data.

This is not a research programme. It is two ingestion contracts that currently overwrite instead
of appending.
