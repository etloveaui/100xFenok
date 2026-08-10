# E0 — Yoo equation identification, bounded

Handler: cc (Opus), 2026-08-08. Contract: `FENO_RIM_EXECUTION_CONTRACT_OPUS_DEEPSEEK_20260808.md` §6.

## Verdict: `YOO_EXACT_EQUATION = NOT_VERIFIED`

Proceeding immediately with the FENO canonical terminal from the architecture plan §5.2, as §6
instructs. This pass did not stop the mission and cost one bounded analysis.

## What the fixture can and cannot settle

The Murata 2019-01-16 grid is fully published, so the functional **form** can be tested from the
nine cells alone — the book value cancels in ratios and no fitted constant is required to run the
test. That is the only fixture with complete numbers available locally; the Goldman/JPM matrices
are named in the contract but not held here, and §6 requires one common equation across multiple
fixtures before identification may be claimed. One fixture cannot identify, only refute.

| | ERP 7.0% | ERP 6.5% | ERP 6.0% |
|---|---:|---:|---:|
| LTROAE 14.5% | 20,910 | 21,859 | 22,808 |
| LTROAE 15.0% | 22,186 | 23,154 | 24,123 |
| LTROAE 15.5% | 23,506 | 24,494 | 25,482 |

## Finding 1 — the contract's own canonical candidate is refuted by this fixture

Candidate C, the zero-growth residual-income perpetuity the architecture plan adopts as the FENO
default, makes value **linear in long-run ROE** at fixed Ke:

```
V = B0 + Σ RI_t/(1+Ke)^t + [(LTROE − Ke)·B3 / Ke] / (1+Ke)^3
```

Only the last term carries LTROE, and it carries it linearly. So equal steps in LTROE must produce
equal steps in value. They do not:

| ERP | steps in value per 0.5pp of LTROE | ratio |
|---|---|---|
| 7.0% | 1,276 then 1,320 | 1.0345 |
| 6.5% | 1,295 then 1,340 | 1.0347 |
| 6.0% | 1,315 then 1,359 | 1.0335 |

The second step is consistently 3.4% larger than the first, at all three discount rates. Candidate A
fails the same test for the same reason. Whatever produced this grid is convex in LTROE, which a
fixed-B3 excess-return perpetuity is not.

## Finding 2 — the surface is close to separable, and each axis behaves unexpectedly

Cross-ratios deviate from perfect multiplicative separability by at most 0.61%, so the grid is
approximately `V = f(LTROE) × g(Ke)`. Published cells are whole yen, so rounding explains only
about 0.004% of that — the residual separability error is real but small.

Normalising to the centre cell:

| axis | observed factor | factor if V ∝ LTROE | factor if V ∝ 1/Ke |
|---|---|---|---|
| LTROE 14.5 / 15.0 / 15.5 | 0.9441 / 1 / 1.0579 | 0.9667 / 1 / 1.0333 | — |
| ERP 7.0 / 6.5 / 6.0 | 0.9582 / 1 / 1.0419 | — | 0.9286 / 1 / 1.0833 |

Value moves **more** than proportionally with long-run ROE and **less** than inversely with the
discount rate. The discount-rate factor is very nearly linear in ERP — its two steps are 0.041807
and 0.041850, equal to four decimals — which no single-stage perpetuity in Ke produces.

## Finding 3 — a sustainable-growth justified P/B does not recover it either

Testing `V = B·LTROE·(1−b)/(Ke − b·LTROE)` with `Ke = Rf + ERP`, solving B from the centre cell and
scoring all nine, the best fit lands at 2.40% RMS relative error with the search hitting its
boundaries at Rf = 1.99% and retention b = 0. A fit that runs to its bounds is not an
identification, and the errors are systematic across the grid rather than scattered.

## What this means for the mission

The FENO canonical terminal is adopted because the architecture plan specifies it and it is
defensible on its own terms — excess return as the value driver, no hidden growth knob. It is
**not** adopted because it reproduces Yoo's historical arithmetic, and this document is the record
that it does not.

That distinction matters later. When FENO numbers differ from a published Yoo figure, the first
explanation to reach for is that the two use different terminal mathematics, not that one of them
is wrong. Calibrating FENO's grid until the two agree remains forbidden.

Recorded limits: only one fixture was testable, the exact patent equation remains image-only and
unfetched, and no claim is made that the refuted candidates are refuted for Yoo's other reports.
