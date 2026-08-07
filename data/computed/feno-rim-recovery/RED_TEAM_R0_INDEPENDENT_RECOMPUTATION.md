# RED TEAM REPORT — task 2: independent recomputation of R0-A..D and attack on the verdict

> Author: cc (independent red team) · 2026-08-07 · Handler: km
> Implementation: own Python, ~330 lines, no import of any handler module (handler code is `.mjs`).
> Inputs read: `e2-basket-panel.json`, `E1_E2_FORENSIC_AUDIT.json`, `fred-banking-daily.json`,
> `erp-archive-restoration.json`, `data/yf/finance/*.unadjusted.json`, and
> `RIM_CROSS_SECTIONAL_BOTTOM_UP.json` (gate reference only).
> **Not read**: `R0_ADJUDICATION.json`, `r0-firm-panel.json`, `r0-adjudication.mjs`. Every number
> below was produced before opening any handler result artifact.

## 0. Headline

**The handler's engine is correct.** I rebuilt V/P, B/P, returns, ranks and all four statistics
from the source panel and reproduce every figure km reported. I also **reproduce the
`R0_INCONCLUSIVE` verdict** under the criteria as written, and confirm R0-B is the single leg
blocking the POSITIVE gate.

**But I am retracting part of my own task-1 recommendation.** The ESS-adjusted interval I told km
to make primary in v2 is invalid on half these series and, applied literally, would have
manufactured a positive R0-B. Detail in §4 — read that before finalising v2.

## 1. Reproduction gate — PASS

| Check | Result |
|---|---|
| Origins rebuilt | 34 / 34 |
| `ic_vp`, `ic_bp` vs X2 within 1e-6 | 34 / 34, zero mismatches |
| Per-origin `n` and `complete` flags | identical |

## 2. Independent values vs km's report

| Statistic | Set | my value | km reported | agree |
|---|---|---|---|---|
| R0-A mean D | all / wc | −0.0572 / −0.0432 | −0.057 / −0.043 | yes |
| R0-B mean residual IC | all / wc | +0.0439 / +0.0777 | +0.044 / +0.078 | yes |
| R0-C Model 1 mean b2 | all | +0.0729, NW(2) p = .036 | +0.073, p .036 | yes |
| R0-C Model 1 mean b2 | wc | +0.1198, NW(2) p = .017 | +0.120, p .017 | yes |
| R0-C LOO stability | both | max abs delta 0.0106 / 0.0178, no sign flip | LOO-stable | yes |
| R0-D | both | mean S +0.0492 / +0.0619, S>0 in 28/34 and 16/18 | direction corroborates | yes |
| Verdict under criteria as written | — | INCONCLUSIVE; R0-B block-4 lower = −0.0903 is the sole failing condition | INCONCLUSIVE, R0-B blocking | yes |

Additional values km did not report:

| Statistic | all_origins | window_complete |
|---|---|---|
| R0-C **Model 2** mean b2 | +0.0749, NW(2) p = **.068** | +0.1159, NW(2) p = **.053** |
| R0-B NW(2) p | .391 | .328 |
| R0-D block-4 CI on mean S | [+0.0222, +0.0766] | [+0.0254, +0.1006] |
| R0-D origins with one-sided p<0.05 | 3 / 34 | 3 / 18 |

## 3. Attack — against the rescue (is b2 > 0 real?)

**3.1 The significance of R0-C is a function of the HAC lag, and lag 2 is the most favourable
choice available.** Origins are quarterly and returns are 36-month, so consecutive observations
share 11 of 12 quarters.

| series | NW lag 2 | lag 4 | lag 8 | lag 11 |
|---|---|---|---|---|
| Model 1, window_complete | t +2.40 **p .017** | +2.03 p .043 | +1.86 p .063 | +1.95 **p .051** |
| Model 1, all_origins | t +2.10 **p .036** | +1.79 p .074 | +1.62 p .106 | +1.62 **p .106** |
| Model 2, window_complete | t +1.93 p .053 | +1.72 p .086 | +1.61 p .107 | +1.68 p .093 |
| Model 2, all_origins | t +1.83 p .068 | +1.62 p .105 | +1.53 p .125 | +1.57 p .117 |

On the corroboration set b2 is not significant at any lag ≥ 4. On the primary set it fails at lag 8
and sits exactly on the boundary at lag 11. **Adding the two pre-registered controls (Model 2)
removes significance even at lag 2, on both sets.** The single configuration that clears 5%
everywhere is Model 1 at lag 2 — one of eight (2 sets × 2 models × 4 lags).

**3.2 With genuinely independent windows there is almost nothing to test.** Taking every 12th
origin gives 12 phases of 2-3 non-overlapping observations:

| statistic | full-sample mean | phase-mean range | phases positive | sd across phases |
|---|---|---|---|---|
| R0-C b2 | +0.0729 | [−0.0502, +0.1566] | 10 / 12 | 0.0647 |
| R0-B residual IC | +0.0439 | [−0.1562, +0.1703] | 8 / 12 | 0.1042 |
| R0-A D | −0.0572 | [−0.1293, +0.0616] | 1 / 12 | 0.0520 |
| R0-D S | +0.0492 | [−0.0013, +0.0756] | 10 / 12 | 0.0250 |

The cross-phase spread of b2 is comparable to its mean.

**3.3 Sign tests collapse once overlap is respected.** b2 > 0 in 14/18 on window_complete is
two-sided binomial p = .031 treating origins as independent; rescaled to the overlap-implied
effective n it is 6/8, p = .289. On all_origins, 23/34 (p = .058) becomes 9/14 (p = .424).

## 4. RETRACTION — my task-1 ISSUE 2 recommendation is unsafe as stated

I recommended making the ESS-adjusted interval primary, and km adopted it for v2. **The ESS
estimator is invalid on half these series.** Measured `sum_rho(1..11)`:

| series | T | sum_rho | ESS | status |
|---|---|---|---|---|
| R0-A all / wc | 34 / 18 | +0.730 / +0.600 | 13.8 / 8.2 | usable |
| R0-C M1 all / wc | 34 / 18 | +1.325 / +0.411 | 9.3 / 9.9 | usable |
| R0-B all / wc | 34 / 18 | **−0.354 / −0.040** | **116.3 / 19.6** | **INVALID — ESS > T** |
| R0-D all / wc | 34 / 18 | **−0.324 / −0.430** | **96.4 / 128.0** | **INVALID — ESS > T** |

A negative autocorrelation sum drives the denominator below 1 and inflates ESS above the raw
sample size. The consequence is not academic: the ESS interval for **R0-B on all_origins is
[+0.0083, +0.0796], which excludes zero**, while every block bootstrap CI includes it
([−0.065, +0.155] at block 4) and NW(2) gives p = .391. R0-B is the one leg blocking the POSITIVE
gate. **My own recommendation, applied literally, would have flipped the blocking leg and pushed
the verdict toward rescue on an artefact.**

**Replacement recommendation for v2**: cap ESS at T and report it as a diagnostic only; keep the
interval on a HAC t reported at lags 2/4/8/11 together with the block battery, and require the
verdict to survive *all* reported lags rather than a nominated one. Do not let any single interval
instrument decide a leg.

## 5. Attack — against retirement (what argues for the rescue)

**5.1 Direction is stable everywhere significance is not.** b2 > 0 in 68% and 78% of origins;
leave-one-out max abs delta 0.0106 / 0.0178 with no sign flip; Model 2's point estimate is
essentially unchanged (+0.075 / +0.116); 10 of 12 non-overlapping phases positive.

**5.2 R0-D is the strongest leg in the battery and the criteria hide it.** Mean S is +0.0492 and
+0.0619, positive in 28/34 and 16/18 origins, with block-4 and block-8 CIs excluding zero on both
sets, and the tightest cross-phase dispersion of any statistic (sd 0.025). The criteria report
R0-D as "share of origins with one-sided p<0.05" — 3/34 and 3/18 — which reads as weak because
that aggregate has a null expectation near 1 origin in 18 and no combined test. This is task-1
ISSUE 8, and it happens to suppress evidence *for* the rescue. v2's combined mean-S test will
change this leg materially; it should be run before anyone treats R0-D as mere corroboration.

**5.3 R0-A's negative is real but is not evidence for retirement.** D is robustly negative — the
only statistic whose non-overlapping phase means are near-uniformly negative (1/12 positive). A
negative raw difference alongside a positive controlled coefficient is the Frankel-Lee pattern the
criteria's own hierarchy anticipates (`r0-criteria.json:105`), not a contradiction. Both readings
are simultaneously supported by these data.

## 6. Divergence on `unstable_block_sensitivity`

km recorded `false`. My run flags all_origins as unstable: block-4 gives a CI excluding zero on the
negative side ([−0.1047, −0.0081]) while blocks 8 and 12 include zero ([−0.1109, +0.0037],
[−0.1099, +0.0082]). Under the criteria's literal wording — "the sign of the conclusion (positive
vs non-positive)" (`:72`) — all three are non-positive, so **km is correct as written**. Under a
three-way reading (positive / zero / negative) the set is unstable. The distinction the verdict
mapping actually needs is NEGATIVE vs ZERO, and that one does flip. v2 must state which
classification governs.

## 7. Bottom line for v2

1. The engine reproduces. Nothing in the implementation needs re-verification.
2. Under any overlap-aware inference, **R0-C's positive b2 is borderline on the primary set and
   absent on the corroboration set**, and it does not survive the pre-registered Model-2 controls.
3. **R0-D is stronger than reported** and its combined test is the single change most likely to
   move the v2 verdict — in the rescue direction.
4. **Do not make the ESS interval primary** (§4). This corrects my own task-1 advice.
5. My numbers above are recorded before the v2 run and can be used as the external check on it.
   Any v2 figure that differs from §2 by more than rounding indicates a change in construction,
   not in inference, and should be investigated as such.
