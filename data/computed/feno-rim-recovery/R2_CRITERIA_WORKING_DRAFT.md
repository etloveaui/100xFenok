# R2 CRITERIA — HANDLER WORKING DRAFT (not frozen; freezes after R1 result)

> Working note by km. Inputs: R2_FL3_GLS_SPEC_DRAFT.md (15 open choices), owner directive R2
> section, REVIEW §13.1 universe limit. This becomes r2-criteria.json once R1's primary model
> is known. Owner-visible deviations from the directive are collected at the bottom.

## Decisions on the 15 open choices (draft)

1. Forecast source: R1 mechanical winner (RI expected; EP if the gate says so). No analyst data.
2. FY3: mechanical forecast direct at tau=3 (directive; deviation from GLS FY2x(1+Ltg) declared).
3. Explicit window: 3 years (GLS + directive).
4. Fade: years 4-12 linear interpolation (GLS).
5. Fade target ROE: median of IB/CEQ_lagged, 5-year trailing window, positive-earnings AND
   non-negative-book screen, computed PIT (facts filed <= estimation date) per FF industry.
6. Industry classification: FF 48 groups. PIT mapping: repo has Kenneth French data (X1 used
   it); SIC->FF48 mapping from the French library files in the repo; firm SIC from the R1
   submissions cache. Mapping vintage declared (current crosswalk applied historically -
   deviation disclosed, no PIT crosswalk exists free).
7. Fade horizon T = 12.
8. Terminal: GLS eq. 6 convention, exponent T-1 (GLS worked example matches; LM rendering
   differs by one period - declared). FL3: T=3 with the same perpetuity convention.
9. Payout: GLS full rule k = D/(0.06*TA), [0,1] clamp, D = trailing common dividends,
   TA = trailing total assets (from R1 panel tags + dividends from yf cache).
10. Book: CEQ analog = StockholdersEquity - PreferredStockValue, on today's split basis
    (v2.1 rule); shares = today-basis shares_basis. Synthetic announcement-window book:
    NOT implemented (deviation disclosed; needs quarterly clean-surplus assembly).
11. FL3 cost of equity: [FL98-not-on-disk]. Pre-committed construction (declared deviation,
    closest-available analog): r_f = 10y Treasury PIT (repo fred-banking-daily) + industry
    risk premium = trailing 60-month realized excess return of the FF-48 industry portfolio,
    computed PIT from repo price data, floored at 0, capped at 12%. NO per-stock fitted r.
    If FL98 text is obtained later, amendment = new freeze.
12. firm_icc_minus_rf: 10y Treasury at the estimation date.
13. Index aggregation: directive rules - report cap-weighted mean, cap-weighted median,
    trimmed mean (trim band pre-committed here: 5% each tail), PRIMARY = cap-weighted median.
    Equal-weighted GLS convention also reported as literature anchor (deviation documented).
14. Sample filters: June-30 estimation dates (the five R1 origins); universe = R1 panel firms
    with: price > $1, non-negative book, non-negative forecast at tau 1..3, shares available.
    Negative-forecast firms excluded per GLS requirement and counted.
15. Solver: bisection on r in [0.001, 0.60] for eq. 5, tolerance 1e-9 on price equality,
    max 200 iterations; non-convergence -> excluded and counted; firm_icc_percentile =
    cross-sectional percentile within each origin.

## Universe limit (REVIEW 13.1, binding)

R2/R3 must NOT read a return-sign conclusion off the current-membership panel. R2 outputs
(IC, V/P levels, spreads) are fine; any R3 return validation needs PIT membership or a
non-appreciation-selected universe - R3 criteria must state how (candidate: Russell 1000
historical membership is not free; declare the limit and validate on WITHIN-origin
cross-sectional rank relations only, plus time-series ICC vs subsequent index returns where
the index itself is the unit).

## Deviations from the owner directive (collected, to state in the freeze)

- D1: FY3 direct mechanical (directive-compliant deviation from GLS - as directed).
- D2: cap-weighted aggregation primary (directive overrides GLS equal-weight - as directed,
  documented).
- D3: FL98 industry cost of equity replaced by a declared analog ([FL98-not-on-disk]).
- D4: synthetic announcement-window book skipped (quarterly clean-surplus assembly deferred).
- D5: FF48 crosswalk current-vintage applied historically.

## GLS worked-example validation targets (from spec draft annex)

GM: B0=17.01, FY1=6.75, FY2=7.73, Ltg=7.3%, k=0.196, target ROE=0.160 -> r=13.94%.
JNJ: r=7.12%. Solver must reproduce both before any panel run (note: GM uses analyst Ltg -
the worked example validates the solver only, under the paper's own inputs).
