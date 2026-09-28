# FENO RIM — P3 adjudication: the model can be built; it cannot be shown to work

Adjudicated 2026-08-08 by cc (Opus), handler. Worker: DeepSeek.
Criteria: `p3-criteria.json` (`6b7eebc773`), frozen before any P3 result.
Mandate: §7, §8, §9.

## Verdict: `YOO_SUCCESSOR_INCONCLUSIVE`

`YOO_SUCCESSOR_SUPPORTED` was unreachable before the phase began — mandate §9 conditions it on P1
returning DEFENSIBLE or a sufficient PARTIAL, and P1 returned NOT_DEFENSIBLE. That was written into
the criteria before any number existed, precisely so a good-looking coefficient could not later be
read as support.

`YOO_SUCCESSOR_FAIL` was genuinely reachable and was not reached. Of its four stated conditions,
three were testable this run and none fired.

| FAIL condition | measured |
|---|---|
| median B/P-controlled coefficient non-positive | positive on **all 16 legs**, median +0.092 |
| sign reverses between book path A and B | same on **8 of 8** pairs |
| sign reverses across the Ke range | same on **8 of 8** pairs |
| placebo or leakage check fires | **no test existed** — handler defect, see below |

## What the twelve-month primary actually says

| statistic | across the 16 legs |
|---|---|
| rank IC, mean | 0.023 to 0.067 — positive on every leg |
| rank IC, **per-origin sign** | **4 to 5 of 7** |
| Fama-MacBeth coefficient | positive on every leg, median +0.092 |
| t | 0.58 to 1.24 |
| B/P-tercile high-minus-low spread | mean positive every leg; per-origin **4 to 6 of 7** |
| permutation p, 1000 draws, seed 20260808 | 0.069 to 0.438 — **nothing reaches 0.05** |

Direction is weakly positive and it is stable in the ways that matter: it does not depend on which
book path is used, nor on where in the independent Ke band the discount rate sits. Magnitude is
small. Significance is absent. And per-origin consistency — four or five origins out of seven — is
barely better than a coin flip, which is the honest headline and the one to quote.

The 24 and 36 month diagnostics show larger mean ICs (0.075–0.121 and 0.120–0.157, positive on all
16 legs). They are overlap-aware and they are not permitted to rescue anything. Origins are one
year apart, so only the twelve-month window is non-overlapping — the G3 finding, and the reason a
longer horizon looking better is expected rather than informative.

The word `VALIDATED` does not appear in this record and may not, on seven annual origins, whatever
the statistics say. Seven is more than five and it is still not enough.

## The valuation, and the two coverage numbers that must be read together

SPX fair value over price, min and max across all 16 legs, after the aggregation correction:

| origin | FV/P range | valued weight |
|---|---|---|
| 2019-06-30 | 0.351 – 0.902 | 0.675 – 0.786 |
| 2020-06-30 | 0.349 – 1.089 | 0.695 – 0.805 |
| 2021-06-30 | 0.259 – 0.628 | 0.647 – 0.760 |
| 2022-06-30 | 0.325 – 0.679 | 0.631 – 0.733 |
| 2023-06-30 | 0.277 – 0.507 | 0.643 – 0.725 |
| 2024-06-30 | 0.221 – 0.418 | 0.772 – 0.846 |
| 2025-06-30 | 0.212 – 0.407 | 0.763 – 0.874 |

The interval is wide because the two frozen terminal forms are its ends — third-year residual income
persisting forever, or vanishing at once. No fade, no decay, no weighting: a weighted blend would be
a fitted choice wearing an interval's clothes.

**The two coverage numbers are the point.** P3 values 63 to 87 percent of measurable index weight.
P1 established that only 22 to 36 percent has a forward book the two independent constructions
agree on. The valuation therefore covers a great many firms whose forward book is not corroborated,
and mandate §9 hinges on the smaller number, not the larger one. Quoting the coverage of the
valuation without the coverage of the forward book would make this look far more solid than it is.

No price-level SPX fair value was produced. The divisor and unit bridge was not demonstrated, so
under the criteria it is not produced. FV/P needs no divisor.

## Verified independently

`redteam-scripts/p1_handler_independent.py` and a direct rebuild from primary inputs, sharing no
code with the worker.

| check | result |
|---|---|
| V rebuilt from primary inputs, 7 origins × 6 legs | **246 values, 0 mismatches** |
| V re-diffed after the aggregation fix | **246 values, 0 mismatches** — the fix touched nothing else |
| SPX FV/P rebuilt from scratch, all 16 legs × 7 origins | matches to 1e-6 at every origin |
| permutation seed | 20260808, recorded in the artifact |

Prices and split factors remain a shared input from the r1 cache, as at P1. That is declared, not
verified.

## Two defects, and they were found in opposite directions

**The index aggregate treated an unvaluable firm as worth zero.** At the 2019 origin on one leg,
258 firms had a value and the denominator summed market cap over all 326. Every origin was affected
in the same direction, by a factor of 1.20 to 1.40, making the index look more overvalued than the
model says. The criteria define eligibility per leg; a firm failing it leaves both sums. Corrected,
re-verified, and the firm-level values were untouched by the correction.

**The worker's summary overstated sign consistency.** Its message reported rank IC "positive 7/7
origins every leg" where the artifact said 4 or 5 of 7 — the mean was being read as the per-origin
count. The artifact was right throughout. Had the message been taken at face value this adjudication
would have claimed 7/7, and the result would read far stronger than it is. The worker corrected it
and restated with the weaker number when asked.

**And one of mine.** The criteria named "a placebo or leakage check fires" as a FAIL condition and
never defined the test. The worker reported the absence rather than inventing one, which is right —
a placebo defined after the results exist tests nothing. FAIL therefore had three testable
conditions this run, not four, and the verdict should be read knowing that.

## What this closes and what it does not

The mandate's three phases are complete. The infrastructure the successor RIM needs now exists and
is real: seven point-in-time origins, rosters that include the firms that left, a cost of equity
derived without touching the same-date price, forward book built two independent ways, and a
sixteen-leg uncertainty sweep with no preferred leg.

What does not exist is evidence that it predicts anything. The relation is positive, stable under
the choices that could have broken it, too small to separate from noise, and consistent at four or
five origins out of seven.

`PUBLIC_ROWS` stays `[]` and `PUBLIC_STATE` stays `MODEL_REVALIDATION`. Mandate §12 forbids any
index extension before SPX returns, and SPX has not returned support. No expansion follows.
