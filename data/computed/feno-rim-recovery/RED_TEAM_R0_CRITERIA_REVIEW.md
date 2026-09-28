# RED TEAM REPORT — R0 criteria pre-review + DEC-290 basis verification

> Author: cc (Claude Code, left pane) — independent red team per RED_TEAM_CHARTER_R0.md
> Date: 2026-08-07 · Handler: km · Criteria under review: `r0-criteria.json`
> sha256 verified on disk: `5d2758840814a9ec8bec8ce15d0f406adf5d949e1fd6b6b0eb7a48382e1ca5f2`
> **Independence statement**: every statistic below was computed with my own Python, no import of
> any handler module. I have NOT opened `r0-firm-panel.json` or `R0_ADJUDICATION.json`; this
> verdict is uncontaminated by R0 results.

**VERDICT ON THE CRITERIA: CONDITIONAL_PASS.**

---

## Part 1 — DEC-290 basis: CONFIRMED, and the defect is larger than the directive states

DEC-291 claims the deciding `-0.057 / -0.043` was a raw mean-IC difference rather than a
B/P-controlled incremental test. **Confirmed from the files.** Three additional facts:

| Claim | Evidence | Status |
|---|---|---|
| No multivariate / partial test exists in X2 | `scripts/feno-rim-v2/verify/x2-cross-sectional.mjs:66` computes `sp(vp,ret)` and `sp(bp,ret)` as two separate univariate Spearman correlations; `:75-77` reports `incremental = mv - mb`. No regression, residualization or partial correlation appears anywhere in the file. | CONFIRMED |
| **The deciding number carried no uncertainty estimate at all** | `:71` — `const ci=boot(v)` bootstraps `v = ic_vp` only. The CI was computed for the V/P IC *level*, never for the difference. `:80` gates on `A.incremental>0 && C.incremental>0` — a bare point-estimate sign test. | NEW — stronger than the directive claimed |
| The prior red team did not close this either | `X2X3_INDEPENDENT_AUDIT.json` `attack` = a1 terminal sensitivity, a2 B/P point-in-time symmetry, a3 member composition. All construction checks; no statistical control. `FINAL_RIM_DECISION.json` `primary_reason` rests on the same two point estimates. | CONFIRMED |
| The only residualization in the corpus is not a B/P control | `RIM_FACTOR_REGIME_CONTROL.json` (X1) residualizes the **origin-level** rho on Fama-French factors (`mkt_rf, hml, rmw, cma, mom`) — a time-series regime control on the top-down signal, not a cross-sectional B/P control on the firm panel. | CONFIRMED |

### What the difference looks like once uncertainty is attached (my own code)

Origins are **quarterly** (91-day spacing, verified across all 34 rows) and returns are **36-month**,
so consecutive origins share **11 of 12 quarters** of their return window.

| Set | mean D | NW t (lag 2) | NW t (lag 11) | block-4 CI | block-8 CI | block-12 CI |
|---|---|---|---|---|---|---|
| window_complete (n=18, X2's primary) | −0.0432 | −1.23 | −0.96 | [−0.108, +0.023] | [−0.111, +0.024] | [−0.097, +0.010] |
| all_origins (n=34) | −0.0572 | −2.50 | −1.99 | [−0.104, −0.007] | [−0.110, +0.004] | [−0.110, +0.009] |

**On its own primary set, DEC-290's deciding number is not distinguishable from zero under any
block length.** On the corroboration set only the shortest block excludes zero. The retirement
decision rested on a point estimate whose interval, when computed, straddles zero.

### Partial independent reproduction (return leg)

I rebuilt the member-eligibility and return legs from scratch (unadjusted closes + dividends,
36×30.44 days, 45-day tolerance) and reproduced **X2's per-origin `n` exactly on all 34 origins**
(27×7, 25×3, 24, 25×3, 24, 24, 25, 24, 23×5, 24, 25×5, 24, 25×4). The `V>0` filter drops nothing
beyond the book/price/shares/price-series filters.

---

## Part 2 — Criteria findings

### ISSUE 1 — Verdict mirror-image is under-specified and biases toward retirement
**SEVERITY: HIGH.** `r0-criteria.json:102` defines `R0_INCREMENTAL_NEGATIVE` as "Mirror image of
POSITIVE with all inequalities reversed." Reversing `NW p <= 0.05` yields `p >= 0.05`; reversing
`block-4 CI lower > 0` yields `CI lower < 0`. Read literally, **NEGATIVE is satisfied by almost any
negative point estimate including pure noise**, while POSITIVE requires significance. The intended
mirror is `mean b2 < 0 AND NW p <= 0.05 AND block-4 CI upper < 0`.
**RECOMMENDATION**: write NEGATIVE out in full — keep `p <= 0.05` un-reversed, replace "CI lower > 0"
with "CI upper < 0".

### ISSUE 2 — Variance treatment ignores the 12-quarter overlap and contradicts this project's own precedent
**SEVERITY: HIGH.** Criteria set NW lag = `max(2, floor(4*(T/100)^(2/9)))` = **2** (`:64`) and make
**block-4 primary** (`:63`) on data whose consecutive observations share 11/12 of their return
window. Measured on the published D series: acf(1) = **+0.45** (all) / **+0.54** (window_complete).
Applying X1's own effective-sample method (`n/(1+2·Σρ)`, 11 lags) gives effective n = **13.8** and
**8.2** against raw 34 and 18. X1 itself used `block_size_quarters: 12` and a 36-lag ESS
(`RIM_FACTOR_REGIME_CONTROL.json` → `origin_sets.*.ess`). R0 is strictly more permissive than the
earlier phase on the same data.
**RECOMMENDATION**: make an ESS-adjusted interval (or HAC with lag ≥ 11) primary; demote lag-2 /
block-4 to sensitivity. See ISSUE 3 before simply lengthening blocks.

### ISSUE 3 — A longer block is not a safe fix at T=18; block-12 is degenerate there
**SEVERITY: MEDIUM.** Measured: on window_complete the block-12 CI halfwidth (**0.0531**) is
*narrower* than block-8 (**0.0677**) — a circular block bootstrap of length 12 over 18 observations
resamples ~1.5 blocks and collapses toward a few block means. The robustness flag
("blocks 8 and 12 also exclude zero", `:101`) can therefore be satisfied for the wrong reason.
**RECOMMENDATION**: report the number of independent blocks beside every CI; do not treat block-12
on T=18 as the conservative case.

### ISSUE 4 — `R0_INCREMENTAL_ZERO` is unreachable, so the design cannot return affirmative evidence for retirement
**SEVERITY: HIGH.** Equivalence band on mean b2 is ±0.01 (`:88`, `:103`). Measured achievable
precision: cross-sectional sd of 3-year annualized returns averages **0.164** (all) / **0.170**
(window_complete); at n≈25 the per-origin unit-rank slope se ≈ **0.114**, so at ESS 13.8 / 8.2 the
95% CI halfwidth on mean b2 is ≈ **0.060 / 0.081** — **6× to 8× wider than the band**. ZERO can never
be declared. The realistic outcome space is POSITIVE (demanding) or INCONCLUSIVE (default), and
INCONCLUSIVE resolves to the status quo. An owner-directed re-adjudication that can only return
"rescued" or "unchanged" is not the two-sided adjudication the file describes.
**RECOMMENDATION**: widen the band to a power-justified value or drop ZERO, and state what
INCONCLUSIVE means for the decision. Report the minimum detectable effect beside the verdict either
way. For scale: POSITIVE needs mean b2 ≳ 0.08, i.e. the B/P-orthogonal part of V/P must carry
roughly half of V/P's total raw rank slope [estimate, not measured].

### ISSUE 5 — The reproduction gate validates only ordinal statistics; two of four tests consume cardinal returns
**SEVERITY: MEDIUM-HIGH.** `:56` gates on `ic_vp`/`ic_bp` within 1e-6 plus `n` and `complete`.
Spearman ICs are invariant to any monotone transform of returns, so a pipeline with a different
`rf0`, compounding exponent or dividend rule passes the gate and still moves `b2` (R0-C) and `S`
(R0-D), which are computed on `exc` levels.
**RECOMMENDATION**: extend the gate to the per-origin member symbol set and a checksum of the `tr`
vector before any R0-C/D number is reported.

### ISSUE 6 — Bootstrap interval construction is not pinned
**SEVERITY: MEDIUM.** `:63` fixes reps, block lengths and seed but not percentile vs basic vs
studentized, nor circular vs non-circular; "same generator as x2 boot()" inherits only the RNG.
X2's `boot()` (`x2-cross-sectional.mjs:10-16`) is circular-block with a percentile [2.5%, 97.5%]
interval. This is a live degree of freedom after results exist.
**RECOMMENDATION**: state "circular moving-block, percentile interval, identical to x2 `boot()`".

### ISSUE 7 — Size is not an independent control; it is the shared denominator of both regressors
**SEVERITY: MEDIUM.** `:83`/`:85` add `u(log(mc))` while B/P = `book/mc` and V/P = `V/mc`
(`x2-cross-sectional.mjs:64`). Model 2 regresses returns on two ratios and their own denominator at
n≈25 with four regressors. The criteria already declare Model 2 sensitivity-only (`:84`), which is
correct.
**RECOMMENDATION**: report b2's variance inflation vs Model 1 so the collinearity is visible.

### ISSUE 8 — R0-D has little discriminating power and no combined test
**SEVERITY: MEDIUM.** `:92-94`: at n≈25 a tercile holds ~8 members and the median split is 4 vs 4
(70 distinct within-tercile assignments). The reported aggregate is "share of origins with one-sided
p<0.05", whose null expectation is ~0.9 of 18 origins; overlapping windows correlate those p-values.
**RECOMMENDATION**: pre-register one combined statistic (permutation on mean S with the same block
structure) instead of counting per-origin significance.

### ISSUE 9 — R0-B residualizes only the regressor, and its interpretation line overstates the result
**SEVERITY: MEDIUM.** `:76-78` regresses rank(V/P) on rank(B/P) and Spearman-correlates the residual
with raw returns. The cleaner partial statistic residualizes returns on rank(B/P) as well.
**RECOMMENDATION**: report both; soften "carries return information not contained in B/P" to the
partial-correlation claim it actually supports.

### ISSUE 10 — A positive R0-B would not be new evidence; X1 already produced one and voided it
**SEVERITY: MEDIUM.** `RIM_FACTOR_REGIME_CONTROL.json` reports factor-residual rho **+0.500516** on
window_complete, and the verdict fired `INSUFFICIENT_MATCHED_UNIVERSE` at R² 0.4938 against a 0.50
bar with effective n 11.29.
**RECOMMENDATION**: the criteria should say in advance why a positive R0-B escapes the bar that
voided X1's, or the same objection lands on R0.

### ISSUE 11 — The primary set is a contiguous recent regime, not a random subsample
**SEVERITY: MEDIUM.** `complete=true` begins exactly at 2019-03-22 and runs to 2023-06-16, so
window_complete is the last 18 quarters and its return windows span 2019-2026 — COVID crash,
recovery, and the 2022 value rotation — at effective n 8.2. Naming it "primary" (`:99`) gives the
decision to the smallest and most regime-concentrated sample.
**RECOMMENDATION**: keep the pre-registration, but require the verdict to carry effective n and the
regime span, and treat an all_origins / window_complete disagreement as INCONCLUSIVE rather than
resolving it by the primary-set rule alone.

### ISSUE 12 — Survivorship is inherited and disclosed, but the criteria do not require it in the verdict
**SEVERITY: LOW-MEDIUM.** The basket is the **current** Dow 30 fixed list (panel `basket.name`,
sourced from a 2026-08-01 snapshot) applied to all 34 origins from 2015; NVDA and SHW joined the
index in 2024. The panel's own `survivorship_caveat` states the bias is common to all arms, which is
right for a within-basket contrast but does not bound external validity.
**RECOMMENDATION**: require the survivorship bound inside `R0_ADJUDICATION.json`, since the verdict
will be quoted outside the artifact.

---

## Part 3 — Attack surfaces I checked and found CLEAN

Recorded so the handler does not re-spend time here.

| Check | Result |
|---|---|
| Look-ahead in `ke` | Clean. DGS10 last obs ≤ origin; ERP filtered `first_knowable <= t0` (`x2-cross-sectional.mjs:49-52`). |
| Look-ahead in the RIM fade target | Clean. `roeBand` window is trailing-only (`rows[i].ms <= t`, 260 rows) — `e2-basket-panel.mjs:358-366`. |
| Split contamination in prices/dividends/momentum | Clean. Both legs are split-adjusted on the same basis: NVDA shows no discontinuity at the 2021-07-20 4:1 (18.78 → 18.61) or 2024-06-10 10:1 (120.89 → 121.79); NVDA 2019 dividend 0.004 = 0.16/40 and AAPL 2019 0.1925 = 0.77/4. Series is daily (5,421 one-day gaps of 6,926 rows), so momentum's 21/252 offsets mean what the criteria say. |
| Momentum point-in-time | Clean. Uses only pre-origin observations (`:86`). |
| `exc` vs `tr` | Immaterial. A per-origin location shift cancels in both the R0-C slope and the R0-D within-tercile difference, as the criteria note (`:62`). |
| Panel point-in-time rules | Clean. Facts filed ≤ origin, earliest filed per period, PIT shares snapshot with stale drops counted (`shares_stale: 1331`). |
| Freeze discipline (the DEC-290 procedural defect) | **Fixed.** `6d3ec4f29c` contains only `r0-criteria.json` + `r0-freeze-receipt.json`, is an ancestor of `origin/main`, and the on-disk criteria hash matches the declared value. |

---

## Part 4 — PROCESS FINDING: the pre-review window closed before this review was delivered

**SEVERITY: HIGH.** The charter (11:59) asked for criteria pre-review "before handler publishes R0
results". `r0-firm-panel.json` and `R0_ADJUDICATION.json` were written at **12:05**. The freeze
itself remains valid — the criteria commit at 11:57:20 precedes both — but criteria prohibition #2
(`:110`) forbids changing any threshold, seed, lag, band or set after results are observed. Every
recommendation above therefore can no longer be applied as an amendment to this run without
discarding the computed results.

**RECOMMENDATION**: pick one and record the choice **before** reading these findings against the
results —
(a) keep the run and record ISSUES 1-4 as declared limitations inside `R0_ADJUDICATION.json`, or
(b) delete the results, amend under a new freeze commit, re-run.
Choosing after seeing which option favours the verdict would reproduce exactly the defect DEC-291
was created to fix.

---

## Verdict

**CONDITIONAL_PASS.** The criteria are a real advance on X2: they add the controlled tests DEC-290
lacked (R0-B, R0-C), pre-commit sets and hierarchy, forbid post-hoc changes, and fix the freeze
defect the prior decision flagged as unverifiable. Two defects must be closed before any R0 verdict
is quoted:

1. **ISSUE 1** — as written, NEGATIVE can be returned on noise while POSITIVE requires significance.
2. **ISSUES 2-3** — the primary uncertainty instrument understates the variance of a 12-quarter
   overlapping panel, on a primary set whose effective n is 8.2.

**ISSUE 4** is not a defect in the statistics but in the decision space: the criteria cannot return
affirmative evidence for retirement, only failure to rescue. That should be stated in the verdict
rather than discovered by a later reader.
