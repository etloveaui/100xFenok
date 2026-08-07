# RIM RETIRE DECISION REVIEW (R0)

> Contract deliverable 12.1 of the 2026-08-07 owner recovery directive.
> Handler: km. Red team: cc.
>
> **Record order**: v1 freeze `r0-criteria.json` (`5d275884…1ca5f2`, commit `6d3ec4f29c`) → v1 run
> `R0_ADJUDICATION.json` → red-team criteria review `RED_TEAM_R0_CRITERIA_REVIEW.md`
> (CONDITIONAL_PASS, ISSUES 1-12) → **option (b): v1 run authority discarded, artifacts preserved** →
> v2 freeze `r0-criteria-v2.json` (`8b42c0d1…1a00`, commit `c94a4ffb01`) → v2 run
> `R0_ADJUDICATION_V2.json`. **Sections 3-8 below are the superseded v1 record, kept intact;
> sections 9-11 carry the current verdict.** The v1/v2 split exists because the red team found
> the v1 variance treatment (NW lag 2, block-4 primary) understated the 12-quarter overlap of
> 36-month returns — the same data on which X1 itself used block 12 / 36-lag ESS.

## 1. What the old RETIRE logic was

DEC-290 rested on one deciding measurement (X2): per-origin Spearman IC of the deployable
heuristic V/P vs future 36m annualized total return, compared with the IC of plain B/P,
on a Dow-30 point-in-time basket, 34 weekly-grid origins 2015-03~2023-06, 18 window-complete.
The frozen bar required `incremental = mean IC(V/P) − mean IC(B/P) > 0` on both origin sets.
Result: −0.057 (all) and −0.043 (window-complete) → `X2_FAILS_FROZEN_BAR` →
`RETIRE_RIM_PUBLIC_PRODUCT` with "no incremental information over B/P" as the primary reason.

## 2. The defect — statistical specification, not arithmetic

R0 reproduced the X2 pipeline verbatim; the reproduction gate PASSED (34 origins, per-origin
ic_vp/ic_bp/n/complete flags all within 1e-6). The arithmetic was never the problem.

The problem: `mean IC(V/P) − mean IC(B/P)` is not an incremental-information test. The
literature definition (Frankel–Lee 1998) is the coefficient on V/P in a cross-sectional
regression that already controls B/P (and size), or V/P performance inside B/P-controlled
portfolios. Two signals can be strongly correlated — V/P contains B/P's book input by
construction — so the raw IC comparison measures dominance, not increment. A negative raw
difference with a positive controlled coefficient is the standard Frankel–Lee pattern, not a
contradiction. X2 never computed the controlled coefficient (`b2_admitted=false` at every
origin, per the resolution report §4).

## 3. R0-A — paired IC difference uncertainty

`D_t = IC_t(V/P) − IC_t(B/P)`, unchanged X2 rows.

| set | mean D | median D | D>0 share | naive 95% CI | MBB b4 | b8 | b12 | NW t / p |
|---|---|---|---|---|---|---|---|---|
| all (34) | −0.057 | −0.060 | 35% | [−0.094, −0.020] | [−0.105, −0.008] | [−0.111, +0.004] | [−0.110, +0.008] | −2.50 / 0.013 |
| wc (18) | −0.043 | −0.048 | 39% | [−0.098, +0.012] | [−0.108, +0.023] | [−0.112, +0.025] | [−0.096, +0.010] | −1.23 / 0.217 |

The raw difference is real in direction but, on the primary window-complete set, every CI
includes zero and the NW test is not significant. Even the original basis was weaker than the
decision language suggested. No block-length sign flip (`unstable_block_sensitivity=false`).

## 4. R0-B — B/P-residualized V/P

Per-origin OLS of rank(V/P) on rank(B/P); Spearman IC of the residual with future returns.

| set | mean resid IC | >0 share | MBB b4 | b8 | b12 | NW p |
|---|---|---|---|---|---|---|
| all (34) | +0.044 | 53% | [−0.065, +0.155] | [−0.067, +0.169] | [−0.043, +0.157] | 0.391 |
| wc (18) | +0.078 | 50% | [−0.090, +0.247] | [−0.094, +0.255] | [−0.070, +0.225] | 0.328 |

Direction positive on both sets; underpowered — CIs include zero. This leg cannot confirm or
deny increment on its own at n=18/34.

## 5. R0-C — Fama–MacBeth incremental regression (the test X2 never ran)

`exc = 36m annualized total return − origin DGS10` (location shift; slopes invariant).
Unit ranks in [0,1]; b2 = annualized-return spread of V/P from rank 0 to 1 holding B/P fixed.

Model 1 (`exc ~ u(B/P) + u(V/P)`), PRIMARY:

| set | mean b2 | median | >0 share | NW t / p | MBB b4 | b8 | b12 | LOO |
|---|---|---|---|---|---|---|---|---|
| all (34) | +0.073 | +0.032 | 68% | 2.10 / 0.036 | [+0.003, +0.150] | [−0.006, +0.167] | [−0.002, +0.163] | max Δ 0.011, no flip |
| wc (18) | +0.120 | +0.074 | 78% | 2.40 / 0.017 | [+0.024, +0.227] | [+0.020, +0.225] | [+0.034, +0.206] | max Δ 0.018, no flip |

Model 2 (+ size + 12-1 momentum), sensitivity: b2 = +0.075 (all, p=0.068), +0.116 (wc, p=0.053);
no origin voided; attenuation mild. Independent Python re-derivation (Frisch–Waugh) matches the
node OLS to 6 decimals on spot-checked origins.

This is the decisive new fact: after controlling B/P, the heuristic V/P coefficient is positive
and significant at the 5% level on both origin sets, robust to leave-one-out, and largely
robust to block length on the primary set (all-origin b8/b12 lower bounds dip 0.002~0.006 below
zero). X2's "no increment" conclusion does not survive the correct test.

## 6. R0-D — B/P-stratified permutation

B/P terciles; within-tercile V/P median split; 10,000 within-strata label permutations per origin.

| set | mean S | S>0 share | sig+ (p<0.05) share |
|---|---|---|---|
| all (34) | +0.049 | 71% | 9% |
| wc (18) | +0.062 | 72% | 17% |

Direction corroborates; per-origin power at n≈25 is too small for origin-level significance —
expected for this design, recorded as corroboration, not a gate.

## 7. New adjudication

Frozen verdict mapping result: **`R0_INCONCLUSIVE`** with `unstable_block_sensitivity=false`.

- `R0_INCREMENTAL_POSITIVE` missed on one leg only: R0-B residual IC is positive but its CI
  includes zero (the gate requires CI exclusion). R0-C passed all its conditions.
- `R0_INCREMENTAL_ZERO` and `R0_INCREMENTAL_NEGATIVE` are decisively rejected: no equivalence
  band contains the CIs, and the controlled coefficient is significantly positive.

Substantive reading (pre-committed hierarchy: controlled tests decide; raw difference
corroborates): the DEC-290 basis — "RIM adds no incremental information over B/P" — is no
longer established. The controlled evidence points to a small but real increment
(~7~12pp annualized spread per unit V/P rank, holding B/P fixed) for this heuristic V/P.
What stands: this V/P is still the historical-accounting heuristic (consensus null, ROE-fade,
restored-ERP discount), and its raw dominance fails — the increment is not large enough to
make the old product promotable on X2 evidence alone.

## 8. Consequences (v1 — superseded by section 11)

1. `FINAL_RIM_DECISION.json` stays preserved; its primary reason is annotated by this review,
   not overwritten. `public_surface = KEEP_QUARANTINED` unchanged.
2. The question moves from "did the heuristic beat B/P" to "does a literature-canonical RIM
   (mechanical Li–Mohanram forecasts → Frankel–Lee V/P, GLS ICC) carry validated information"
   — Phases R1~R4 proceed per the owner directive regardless of R0's label.
3. Red-team independent recomputation of R0-A..D is requested before the verdict is treated as
   final input to later phases (criteria charter task 2).

## 9. Red-team criteria review and the option (b) reset

cc's pre-review (`RED_TEAM_R0_CRITERIA_REVIEW.md`, written before it had seen any R0 result,
independence statement inside) returned CONDITIONAL_PASS with twelve findings. The three that
forced a reset:

1. **ISSUE 1 (HIGH)** — the v1 NEGATIVE verdict was defined as a literal mirror of POSITIVE,
   which read as "p ≥ 0.05 satisfies NEGATIVE": retirement on noise, rescue on significance.
2. **ISSUE 2/3 (HIGH)** — origins are quarterly and returns 36-month, so consecutive origins
   share 11 of 12 quarters. Measured acf(1) of the D series +0.45/+0.54; effective n 13.8/8.2
   against raw 34/18. v1's NW lag 2 + block-4 was strictly more permissive than X1's own
   block-12 / 36-lag-ESS treatment of the same data; and block-12 on T=18 is degenerate
   (resamples ~1.5 blocks), so the robustness flag could pass for the wrong reason.
3. **ISSUE 4 (HIGH)** — the ±0.01 equivalence band on b2 is 6-8x narrower than the smallest
   achievable CI at this sample size: ZERO is structurally unreachable, so the design could
   only ever return "rescued" or "unchanged", never affirmative retirement evidence.

Plus: the v1 reproduction gate validated only ordinal ICs while R0-C/D consume cardinal returns;
R0-B should residualize both legs; X1's voided residual +0.5005 needed a stated reason why
R0-B escapes that bar; window_complete is a contiguous 2019-2023 regime block at effective n 8.2;
the current Dow 30 (NVDA/SHW members only from 2024) is applied back to 2015.

The handler chose **option (b)** — discard the v1 run's authority, amend, re-run — and recorded
the choice BEFORE weighing the findings against the v1 numbers. The choice basis is visible from
the criteria text alone (ISSUES 1, 2, 4), which is the test that keeps it honest. v1 artifacts
stay on disk, superseded, not deleted. The red team also strengthened the case against DEC-290:
`x2-cross-sectional.mjs:71` bootstraps `ic_vp` only — **the deciding difference never had a
confidence interval at all** — and `:80` gates on a bare sign test.

## 10. R0 v2 results (honest variance: ESS-adjusted CI + NW lag 11 primary)

Reproduction gate v2 PASSED (ordinal 1e-6 match plus cardinal tr/rf0/symbol-set checksums).
Primary inference per v2 freeze; block battery and NW lag 2 demoted to sensitivity.

| test | all origins | window-complete |
|---|---|---|
| R0-A mean D | −0.057, ESS 13.0, CI [−0.115, +0.001], NW11 p=.047 | −0.043, ESS 5.4, CI [−0.136, +0.050], NW11 p=.337 |
| R0-B partial corr (primary) | −0.023, CI [−0.168, +0.122] | +0.022, ESS 3 (clamped), CI [−0.223, +0.266] |
| R0-B regressor-only (sens.) | +0.044, CI incl. 0 | +0.078, CI [−0.170, +0.325] |
| R0-C M1 b2 | +0.073, ESS 7.0, CI [−0.031, +0.177], NW11 p=.106 | +0.120, ESS 3.5, CI [−0.033, +0.273], NW11 p=.051 |
| R0-C M2 b2 (sens.) | +0.075, p=.068 (lag2 basis) | +0.116, NW11 p=.093, se-inflation ratio 1.13 |
| R0-D mean S (combined) | +0.049 | +0.062, ESS 3.7, CI [+0.008, +0.116], NW11 p=.0009 |

Independent Python re-derivation matches the node ESS CI to 6 decimals and a spot-checked
per-origin partial correlation exactly.

## 11. Final R0 adjudication

Frozen v2 verdict mapping result: **`R0_INCONCLUSIVE`** with `disagreement_between_sets = true`
(R0-B partial correlation is negative on all_origins, positive on window_complete; the v2
disagreement rule forces INCONCLUSIVE regardless of primary-set statistics).

What this verdict establishes, both directions honestly weighted:

1. **The DEC-290 basis does not stand as affirmative evidence.** Its deciding number never had
   a CI; with honest variance the raw difference on the primary set is indistinguishable from
   zero (ESS CI [−0.136, +0.050], NW11 p=.337). "No incremental information" was never shown;
   a point estimate with a sign-test gate was shown.
2. **The recovery also cannot affirm an increment from this evidence.** Under honest variance
   the controlled b2 is positive on both sets (+0.073/+0.120) but not significant (NW11
   p=.106/.051; ESS CIs include zero), and the partial-correlation leg flips sign across sets.
   The v1 claim of a significant controlled increment was itself an artefact of lag-2/block-4
   variance understatement — recorded here against the handler's own first report.
3. **Corroboration, not decision weight**: R0-D's within-strata statistic survives ESS
   correction (wc CI excludes zero, p=.0009), pointing in the increment direction; R0-A on
   all_origins is marginally significant at NW11 (p=.047) against the increment.
4. **Structural limits declared in the verdict**: effective n 3.5~13 on the controlled series,
   window_complete = contiguous 2019-2023 regime block, ZERO unreachable at this sample size,
   survivorship bound (current Dow 30 back to 2015; NVDA/SHW from 2024). A re-adjudication at
   n=18/34 cannot settle the question either way — which is precisely why the owner directive
   routes the decision to the canonical path instead.

**Consequence**: `RETIRE_RIM_PUBLIC_PRODUCT` loses its statistical basis and is preserved as
history only; nothing in R0 affirmatively rescues the heuristic V/P either. The decision moves
to R1-R4 as directed: Li–Mohanram mechanical forecasts → Frankel–Lee V/P and GLS ICC on a
proper PIT foundation, validated with the honest-variance instruments established here.
Quarantine unchanged.

## 12. Red-team task 2 and instrument invariance (record close-out)

cc's independent recomputation (`RED_TEAM_R0_INDEPENDENT_RECOMPUTATION.md`, own Python, no
handler imports, written against v1 before seeing any v1 result artifact) **confirmed every v1
number** — reproduction gate passed on their side too, verdict reproduced, implementation
cleared. Two follow-on facts that shape the final record:

1. **ESS retraction, accepted.** cc retracted the ESS-primary recommendation after measuring
   negative autocorrelation in the R0-B/R0-D series, which drives the ESS denominator under 1
   and inflates ESS past the sample size — an artefact that would have manufactured a positive
   R0-B in exactly the leg that decides the verdict. The v2 freeze had already been committed
   when the retraction arrived; v2's ESS formula clamps below at 3 but not above at T.
   Disclosure: no v2 series actually inflated (all ESS ≤ T), but the vulnerability is recorded
   here against the instrument, and the addendum below re-checks the verdict under the red
   team's replacement rule.
2. **Instrument invariance.** `R0_INSTRUMENT_SENSITIVITY.json` (computed from the frozen v2
   artifacts; verdict mapping untouched) applies the red team's strictest rule — significance
   must survive ALL HAC lags {2,4,8,11} plus the block battery:
   - R0-C M1 b2 does NOT survive: wc p = .017/.043/.063/.051 by lag; all = .036/.074/.106/.106
     (matches cc's independent values exactly). Lag-2-only significance is the most favourable
     of eight configurations and is not decision-grade.
   - R0-A raw difference survives in the NEGATIVE direction on all_origins (p .013~.047) but not
     on window_complete.
   - R0-D mean S survives in the POSITIVE direction on BOTH sets under every instrument
     (p < .003 at all lags; block-4/8 CIs exclude zero; tightest cross-phase dispersion). By the
     frozen hierarchy R0-D is corroboration — its strength is disclosed, not promoted post-hoc.
   - Under both the frozen v2 mapping and the red team's all-lags rule the verdict is
     **R0_INCONCLUSIVE**. The verdict is invariant to the instrument philosophy; the two
     adversarial instrument designs converge on the same answer.

What remains true after every attack, both directions: the retirement basis never had a CI and
cannot be affirmed; the heuristic increment is positive in direction, robust within strata, but
not confirmable at this sample under honest variance. That is precisely the gap R1-R4 exist to
close — with literature-grade forecasts and a larger PIT universe instead of 18~34 overlapping
Dow origins.
