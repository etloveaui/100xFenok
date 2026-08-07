# RIM RETIRE DECISION REVIEW (R0)

> Contract deliverable 12.1 of the 2026-08-07 owner recovery directive.
> Handler: km. Criteria frozen before any result: `r0-criteria.json` sha256
> `5d275884…1ca5f2`, separate earlier commit `6d3ec4f29c` (fixes the DEC-290 procedural defect).
> Machine record: `R0_ADJUDICATION.json` (same directory). Red-team independent recomputation pending.

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

## 8. Consequences

1. `FINAL_RIM_DECISION.json` stays preserved; its primary reason is annotated by this review,
   not overwritten. `public_surface = KEEP_QUARANTINED` unchanged.
2. The question moves from "did the heuristic beat B/P" to "does a literature-canonical RIM
   (mechanical Li–Mohanram forecasts → Frankel–Lee V/P, GLS ICC) carry validated information"
   — Phases R1~R4 proceed per the owner directive regardless of R0's label.
3. Red-team independent recomputation of R0-A..D is requested before the verdict is treated as
   final input to later phases (criteria charter task 2).
