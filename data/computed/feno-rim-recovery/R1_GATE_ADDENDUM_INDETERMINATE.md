# R1 GATE ADDENDUM — verdict INDETERMINATE; both RI and EP carried to R2

> 2026-08-07 · handler km · supersedes the gate routing implied by `RIM_MECHANICAL_FORECAST_VALIDATION.json`
> (criteria 0ca58d16d4e4, results commit 8ecca56b77). Red-team anchor fh-20260807-088-cc-f0f7ccd9.

## Verdict

**R1 gate = INDETERMINATE at the observed margin.** Neither the PASS nor the FAIL reading is
defensible at this precision, and the gate therefore carries no model-selection or
retirement weight.

## Why

Two independent clean implementations of the same frozen v2.6 text return opposite gate
verdicts, and the margin is smaller than the disagreement between the implementations:

| build | tau1 RW | tau1 RI | tau1 gate | tau2 gate |
|---|---|---|---|---|
| km (this repo) | 0.0339 | 0.0352 | FAIL by 0.0013 | RI beats RW |
| cc (independent) | 0.0373 | 0.0354 | PASS by 0.0019 (opposite) | RI beats RW |

The disagreement between the two builds on RI alone is ~0.005; the margin that decides the
tau1 gate is 0.0013 (km) / 0.0019 (cc), in opposite directions. A verdict decided on a number
smaller than the implementation noise is a property of implementation choices the criteria do
not pin down (share-fact selection window, outlier-rejection placement, row inclusion), not a
property of the data.

## Implementation choices that drive the gap (stated plainly)

- **km does NOT winsorize the realized actual.** `actual = dep.facts.E.v / shBasis` (raw);
  the metric error uses that raw actual. The only winsorized dependent is `eps_dep_w`, used to
  fit the pooled regressions (estimation, per the paper).
- **km's v2.6 plausibility guard truncates the target's fat tail**: it drops rows with
  |eps|/price > 1 (13 rows: MRNA, CCL, NCLH, DVN, BLDR, EXE). Those are exactly the transitory
  earnings RW carries forward at full weight, so removing them lowers RW's MAE most. This is a
  target-truncation effect in the same direction cc's actual-clipping hypothesis pointed at.
- **Row composition differs**: km n=1891 vs cc n=1793, because the share-fact selection window
  ([end-183d, end+90d]) and the placement of the outlier rejection (inside sharesAt on
  candidates) keep different rows.

## Decision

- Carry **both RI and EP** into R2 as parallel forecast inputs. RI-vs-EP is statistically tied
  (km avg-MAE margin 2e-6), so neither has a claim to be primary on R1 evidence.
- R2/R3 evidence (does the GLS implied cost of capital / FL value ratio carry incremental
  return information) chooses between them, or retires the path. R1 does not pre-decide.
- The scientifically expected backdrop is retained: Li-Mohanram Table 2/D predicts RI≈RW for
  large caps, so a tau1 gate decided at ±0.002 is uninformative by construction.

## Secondary record checks (red-team, in progress)

Executed unit assertions, effective-universe declaration, per-(tau,origin) pool sizes vs the
300 floor, and the filed>origin spot-check remain open with cc and will be appended here.
