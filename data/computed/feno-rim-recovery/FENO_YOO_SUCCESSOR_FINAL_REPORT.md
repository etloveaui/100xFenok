# FENO Sustainable Yoo-Successor RIM — final report

- adjudicated 2026-08-08 by cc (Opus), handler. Worker: DeepSeek.
- mandate: `FENO_RIM_YOO_SUCCESSOR_BLOCKER_RESOLUTION_OPUS_DEEPSEEK.md`
- every criteria file frozen in a commit earlier than its result; no threshold moved after any result

## Verdict: `YOO_SUCCESSOR_INCONCLUSIVE`

The model can now be built. Whether it carries information cannot be determined from what
this data supports.

## Where each blocker ended

| Blocker | Start of day | End of day |
|---|---|---|
| Independent cost of equity | BLOCKED, structurally | **RANGE_ONLY** — solved, as a band |
| Point-in-time membership | BLOCKED | **RECONSTRUCTED** — 7 origins, zero unresolved |
| Sustainable payout / book growth | BLOCKED | **NOT_DEFENSIBLE** |
| Successor prototype | not attempted | **INCONCLUSIVE** |

Two blockers fell. The third did not, and it is the one that limits everything after it.

## What was established

**The circularity is gone.** Ke = Rf + industry levered beta × historical MRP, every input
dated on or before its origin, nothing derived from the same-date price of the asset being
valued. This is what made a successor possible at all: the GLS-ICC is solved *from* the
price, so feeding it back would have reproduced the price from the price.

It costs width. The median firm's Ke spans 4.05 to 5.17 percentage points, because a
century of annual data leaves the equity premium with a standard error near 2.1 points.
Every downstream number is therefore an interval, never a point.

**The universe stopped being survivors-only.** Point-in-time rosters for seven origins were
rebuilt from official S&P DJI change records, with zero unresolved names — including AGN,
CBS, SYMC, CTL, UTX and RTN, the departed firms G4 had declared unmeasurable.

**Book cannot be rolled forward for most of the index.** Three attempts at the clean-surplus
bridge, each adding a term the identity genuinely required, ended at admitted coverage of
39.6–63.1% of proxy index weight — and re-measurement on corrected share counts lowered
that to 23.5–52.8%. Roughly three quarters of the index by weight cannot have its book
projected from its own disclosed flows.

## The prototype, and why it cannot be judged

Eligible firms: 71 to 121 per origin. Coverage weight after correction: 23.1% to 32.5%.
Origins: five, not the seven the reconstruction supplied.

| statistic, 12-month primary horizon | measured | needed |
|---|---|---|
| rank IC mean | 0.001 – 0.021 | positive |
| incremental coefficient t | **0.26 – 0.97** | ≥ 2 |
| B/P-stratified spread positive | 4 of 5 origins | ≥ 5 of 7 |
| permutation p ≤ 0.05 | **0 of 5** | ≥ 5 of 7 |

Direction is positive nearly everywhere and nowhere significant. At 24 and 36 months the
two forecast paths disagree in sign — the RI path turns negative in the incremental
regression while EP stays weakly positive — which the frozen rules name as INCONCLUSIVE on
its own.

**This is not evidence that the lens is empty.** It is a quarter of an index, at five
annual origins, with 71 to 121 firms per cross-section. A test that weak would fail to
detect an effect that exists. The honest statement is that the question was not answered,
not that it was answered negatively.

## Two defects found in the statistics themselves

**The permutation test was not permuting.** All five origins returned p exactly 1.0 in
every combination, which is impossible beside a positive observed spread — a within-stratum
shuffle must centre the null at zero. The cause: the routine accepted a seed and then
re-sorted by the same key every replication, so all 10,000 draws reproduced the observation.
Fixed and rerun; the null now centres at 0.00002 with sd 0.066, and the corrected p values
range 0.05 to 0.67 with none reaching 0.05. **Only the permutation was rerun** — rerunning
statistics that were not broken is how a result drifts.

**Share counts carried unit errors.** Re-measurement found TFC recorded at 648 trillion
shares, SRE at 246 trillion, WST at 33 trillion. A single such value distorts an entire
weight aggregate. A sanity guard now excludes them, and many large caps were found to report
share counts only under the `dei` tag, which the original pass missed.

The B2-B verdict was **not** revised on the corrected weights, per the rule set before the
re-measurement: the verdict rests on the instrument used to reach it. As it happens the
correction moved the numbers *down* — 2021 from 39.57% to 24.20% — so the verdict became
more secure rather than less. The rule would have held either way.

## Why five origins and not seven

Two causes, one fixed and one not. The 2025 rows were price-less because the engine read a
price cache whose window ends 2024-08; repointed and closed, 421 of 421 now priced. The
2024 and 2025 third-year forecasts collapse structurally — 14 rows and 0 rows against
390–460 at earlier origins — so those origins cannot supply the complete tau 1–3 strip a
valuation requires. The fetch limit is closed; the structural one is a data availability
fact.

## What would change this answer

Ranked by effect, not by ease.

1. **Elapsed time with records kept.** The G5 shadow archive started today and BACKLOG #380
   remain the only interventions that grow the origin count honestly. Their value compounds;
   a day deferred is a day unrecoverable.
2. **A payout rule that does not depend on clean-surplus admission.** Three quarters of the
   index by weight is excluded by a test on flow disclosure, not by anything about the firms.
3. **Third-year forecast coverage at recent origins.** Two of seven reconstructed origins
   are unusable for valuation on a structural forecast condition.

## What must not happen

- No price-implied ICC as a same-date fair-value discount rate.
- No comparison of a fair-value band against a future price level — the test that cannot
  fail informatively, and part of why the retired heuristic survived as long as it did.
- No index price-level output without a proven divisor and unit bridge.
- No expansion to NDX, KOSPI, SOX, CCMP or RUT while SPX is INCONCLUSIVE.
- No public release. The quarantine held all day and was verified at every commit.
