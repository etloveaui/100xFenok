# YOO_SUCCESSOR_BRIDGE_STATUS

> Written because mandate §16 requires it: even if G0–G4 all succeeded, the project is not
> complete. The north star is a sustainable FENO RIM that reproduces the economic judgement of the
> Yoo-style model — book value, ROE, required return, growth and retention, residual income,
> long-run normalisation — with no outcome-fitted constants, from point-in-time data, on an
> automatic refresh. GLS-ICC is the validation spine for that structure, not the destination.
>
> Adjudicated by cc (Opus), 2026-08-08, after all five release gates closed.

## Where the gates left us

| Gate | Verdict | What it settled |
|---|---|---|
| G0 | PASS | The market-cap basis is already consistent; the R0 defect is absent here |
| G1 | INCREMENTAL_SURVIVES | ICC is not a repackaged FY1 yield — but 40% of R3's coefficient was strip information |
| G2 | PASS | Not a leak, not an artifact of the solve |
| G3 | HORIZON_SPECIFIC | The 36-month significance was borrowed from overlapping windows; at 12 months t is 1.63 |
| G4 | DATA_INSUFFICIENT | 54% of the 36-month coefficient is small-at-origin firms; removal bias is unmeasurable here |

The ICC lens survives as a **direction**, at a magnitude roughly half what the first measurement
suggested, with statistical significance that does not hold once return windows stop overlapping.

## The five bridge components

### A. Point-in-time forward earnings and ROE path — **PARTIAL**

Mechanical Li–Mohanram forecasts are constructible and their signs are paper-consistent, and the
R1 tau1 gate came back INDETERMINATE with both the RI and EP paths carried forward. That is enough
to compute an ICC. It is not enough for a fair value: a fair-value level needs the forecast to be
right in level, not merely ordered correctly, and nothing here establishes that. Analyst
point-in-time forecasts would upgrade precision (§15) but are not obtainable without owner-approved
acquisition, and mechanical-forecast uncertainty did not propagate strongly into the ICC.

### B. Sustainable book-growth and payout contract — **BLOCKED**

This is the component the retired heuristic could never identify, and nothing in G0–G4 changed it.
Payout enters the current engine only inside an excluded branch. The 2026-08-04 work established
that payout is not separately identified from the risk premium on the available sheets, and the
2026-08-06 constituent aggregate could not compute a historical payout because it held four fiscal
years on *current* membership — the same point-in-time failure G4 hit from a different direction.
A fair-value successor needs a payout and book-growth rule that is defensible out of sample. We do
not have one, and we cannot build one from a universe defined by today's index membership.

### C. Independently identified cost of equity — **BLOCKED, and structurally so**

This is the binding constraint on the entire north star, and it is worth stating precisely because
it is easy to think the ICC solved it.

The GLS-ICC is the discount rate that makes the residual-income model reproduce **the current
price**. Feeding it back as the discount rate in a same-date fair value computes the current price
from the current price. Mandate §16 forbids exactly this, and the prohibition is not bureaucratic —
it is the difference between a valuation and a tautology.

A fair-value successor therefore needs a cost of equity identified from something other than the
price being valued: a term structure plus an equity risk premium with its own evidence, an
industry-level cost of equity anchored outside the firm, or a factor model whose loadings are
estimated out of sample. R2-A FL3 was deferred for precisely this reason — no defensible local
industry cost-of-equity anchor exists. Nothing acquired in G0–G4 supplies one.

### D. Residual-income persistence and terminal contract — **PARTIAL**

The GLS fade to an industry target over twelve years is implemented, self-tested against the paper's
worked example, and frozen across every gate. That is a defensible *structure*. What is missing is
evidence that this particular fade and terminal rule holds on our data rather than being inherited
from the source paper. Testing it would require exactly what G3 and G4 showed we lack: enough
non-overlapping origins, and a universe not defined by survivors.

### E. Out-of-sample fair-value interval calibration — **BLOCKED**

No fair-value interval can be calibrated out of sample yet, because A through D do not jointly
hold. The prior attempt at this — the automatic RANGE outputs of 2026-08-05 — is retired, and its
retirement survived correction: DEC-292 recorded that the direction of DEC-290 held while its
deciding statistics did not.

## Status summary

| Component | Status |
|---|---|
| A. Point-in-time forward earnings / ROE path | PARTIAL |
| B. Sustainable book-growth and payout contract | BLOCKED |
| C. Independently identified cost of equity | BLOCKED |
| D. Residual-income persistence and terminal contract | PARTIAL |
| E. Out-of-sample fair-value interval calibration | BLOCKED |

**Bridge status: NOT READY.** Three of five components are blocked, and C is blocked structurally
rather than for want of effort.

## What would actually move this

Ranked by how much each unblocks, not by how easy each is.

1. **Point-in-time record keeping, started now.** G4 failed because nobody kept index membership in
   2019. The RIM track could not compute a historical payout for the same reason. The ERP band
   needed twenty-five years restored from an external archive because we had three snapshots. Every
   quantitative question this project has failed in the past week failed for the same cause, and the
   cause is still operating daily. G5's shadow archive and BACKLOG #380's analyst-estimate archive
   are the same intervention aimed at different data. Their value compounds with elapsed time, which
   is exactly why deferring them has a real and unrecoverable cost.
2. **An independently identified cost of equity.** Without it, component C stays blocked and no
   fair-value successor is possible at any level of statistical rigour. This is a research question,
   not an engineering one.
3. **More non-overlapping origins.** Five annual origins is the binding statistical constraint. It
   improves only with elapsed time or with historical data we do not hold.
4. **A universe not defined by current membership.** Historical index membership and delisted price
   series would let G4 be run as specified rather than refused.

## What must not happen

- No feedback of a price-implied ICC into a same-date fair-value discount rate.
- No outcome-fitted constants, per-index multipliers, or offsets.
- No republication of the retired heuristic band under a new name.
- No public numeric release of the ICC lens without explicit owner approval — and on current
  evidence, mandate §11 and §17 both independently forbid it.
