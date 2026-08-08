# FENO_YOO_SUCCESSOR_NEXT_FINAL_REPORT — P3 (worker: km)

Criteria: `p3-criteria.json` (6b7eebc773, sha 0001ced42b958ccc85264c3b60b2db5fd69bdfce45ed258c4790dc1c7e042536).
SUPPORTED is unreachable (P1 NOT_DEFENSIBLE, DEC-297) — this phase decides INCONCLUSIVE vs FAIL. All numbers below are inputs to that decision; the verdict is the handler's.

## 1. Forward-book paths (FENO_RIM_FORWARD_BOOK_PATHS_P3.json)

p1-criteria-v2 unchanged, forecast input = r1-edgar-panel-p2a.json (the adopted P2-A panel; P2-B panel and coefficients NOT used anywhere). Seven origins now have Path A: available counts 258/278/297/303/318/348/356 (RI) and 278/295/315/322/336/363/379 (EP); Path B 423/419/422/422/433/430/436.

**Recomputed core weight (P3 coverage, plainly stated):** 0.3707 / (2020 n/a from this run's summary — see file) / 0.2420-0.3340 band / 0.2335 / 0.2282 / 0.3256 — the 2024 and 2025 origins are now computable (P1 could not value them). Where the number is higher than the P1 adjudicated 0.2250–0.3603, that is P3 coverage, not a P1 revision; the P1 verdict stands.

## 2. The 16-combination valuation (FENO_YOO_SUCCESSOR_SPX_VALUATION_P3.json)

Axes: Ke {low, high} × forecast {RI, EP} × book path {A, B} × terminal {T1 perpetuity, T2 zero}. All 16 computed per eligible firm-origin (326/350/366/373/389/405/418 eligible). No selection, no weighting, no point estimate; the product is the V range and the FV/P range.

**SPX FV/P low/high per origin (of the 16):** 0.254/0.742 (2019), 0.262/0.922 (2020), 0.178/0.496 (2021), 0.224/0.531 (2022), 0.190/0.387 (2023), 0.180/0.370 (2024), 0.173/0.371 (2025). FV/P is the primary product; no price-level conversion attempted (no demonstrated divisor).

## 3. Validation (FENO_YOO_SUCCESSOR_VALIDATION_P3.json) — 12m primary, all 16 legs

Excess = 12-month total return minus the equal-weighted mean of the eligible set at that origin (p3 definition).

| leg family | rank IC mean | FM β (B/P-controlled) | FM t | HML spread | permutation p |
|---|---|---|---|---|---|
| low/ri/A/T1..high/ep/B/T2 (16) | 0.023–0.067 | 0.026–0.258 | 0.58–1.24 | +0.003–+0.026 | 0.069–0.438 |
| median over 16 | 0.042 | 0.092 | ~0.9 | positive all | none ≤ 0.05 |

- **rank IC positive at all 16 legs; per-origin positive count 7/7** (all origins, every leg).
- **FM β positive on every leg; median 0.092** — no leg is non-positive.
- **HML spread positive on every leg.**
- **Permutation p (1000 draws, seed 20260808 recorded in the artifact before the run): 0.069–0.438 — no leg reaches 0.05.**
- **SIGN REVERSAL — the check done before any headline: book path A vs B: 'same' on all 8 pairs; Ke low vs high: 'same' on all 8 pairs.** No FAIL-condition reversal exists in the data.
- 24/36-month diagnostics not yet run — noted as the remaining item if the handler wants them (overlap-aware only, never primary).

## 4. FAIL-condition checklist (the only reachable verdict, frozen)

| condition | measurement |
|---|---|
| B/P-controlled incremental coefficient non-positive at the median of the 16 | median β = +0.092, all 16 positive — NOT triggered |
| sign reversal between book path A and B | none (8/8 'same') — NOT triggered |
| sign reversal across the Ke range | none (8/8 'same') — NOT triggered |
| placebo or leakage check fires | no leakage (PIT rules held throughout); no placebo test exists in the criteria — its absence is stated, not hidden |

**Reading: FAIL is not triggered by any measured condition. The residual is INCONCLUSIVE — direction positive, magnitude small (IC 0.02–0.07), significance absent (perm p > 0.05 everywhere, |t| < 2 everywhere). Numbers only; the verdict is the handler's.**

## 5. Coverage (mandatory with every aggregate)

Eligible share of D(t0): see FENO_YOO_SUCCESSOR_SPX_VALUATION_P3.json per origin (0.60–0.85 range; exact per-origin values in the file). The departed-constituent floor stands: 0.123–0.149 of index weight has no price in any reachable source and cannot enter the market-cap denominator at any origin — disclosed, not noise.

## 6. Verification (verifier role)

1. V rebuilt from primary inputs (paths P3 + B1 Ke + P2-A FNI) for AAPL and JPM at 2019: exact match to 1e-6. PASS.
2. The unit bug was caught by the verifier pass: the first run divided total-dollar V by price (firm count, not V/P); the correction (V / market_cap) is the version reported. This is exactly the share-basis class of error the mission has been hunting.
3. Permutation seed recorded in the artifact before the run (20260808); all 16 legs run under it.
4. Audit vs p3 deliverable list: paths P3, valuation P3, validation P3 written; final report this file; final decision JSON left for the handler (owner_approval_required: true).

## 7. Would not defend

- **No placebo test** — the criteria name "a placebo or leakage check" as a FAIL condition but define no placebo; I ran the leakage discipline (PIT rules) and reported the absence of a placebo rather than inventing one.
- **24/36-month diagnostics not yet computed** (overlap-aware only; the 12m primary is complete).
- **FM t uses the between-origin standard error of per-origin betas** (7 origins) — a small-sample t; the per-origin coefficients are reported alongside, as the criteria require.
- **Coverage weights rest on the P1 D(t0) share basis** — itself a proxy (no float adjustment, declared).
- **Path B legs still use the sweep's forecast earnings for RI** — the axis controls the book path only, as the criteria specify; the earnings input is the same weak signal P2 recorded (RI ≈ RW at tau1).
- **The 2021 FV/P low (0.178) and the 2020 high (0.922)** are the widest ranges — T2 (zero terminal) at low Ke vs T1 (perpetuity) at high Ke are the honest interval ends; no leg was excluded.
