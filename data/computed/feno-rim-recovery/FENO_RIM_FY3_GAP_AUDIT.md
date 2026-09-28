# FENO_RIM_FY3_GAP_AUDIT.md — the §6 audit, measured

Phase P2. The mandate §6 directed this phase to find the data-path defect that stops FY3 from being generated, listing eight candidate causes. **The audit returns NO DEFECT FOUND in the generation path: FY3 is generated at every origin and horizon; the panel refuses to STORE a forecast row whose realized outcome does not yet exist.** Each candidate below is answered with a measurement, not a narrative. Every number is reproducible from the committed artifacts.

## The actual cause, stated once

`scripts/feno-rim-recovery/r1-forecast-ext.mjs`, emission loop:

```
const dep = (j < ys.length) ? ys[j] : null;
...
const actual = (dep && dep.facts.E && dep.facts.E.filed <= EVAL_CUTOFF) ? dep.facts.E.v / shBasis : null;
```

In the committed engine the emission was gated on the outcome: a row was written only when the realized dependent existed and was filed by the evaluation cutoff (2026-08-07). A forecast whose outcome had not yet been filed was never written down. The committed panel is therefore a *validation panel* — every stored row has an actual — and its sparseness at 2024_tau3 / 2025_tau2 / 2025_tau3 is a calendar artifact: those cells point at fiscal 2026/2027 outcomes that mostly did not exist by the cutoff.

Evidence, all measurable:

1. **The gate itself** — committed code, line 338 (pool) and the emission loop: the row is skipped when `dep.facts.E == null || dep.facts.E.filed > EVAL_CUTOFF`.
2. **Stored rows = scored rows** — in `r1-edgar-panel-ext.json`, `rows` equals `with_actual` at all 21 origin-tau cells (verified by counting; 6,880 rows, 6,880 with an outcome).
3. **The pools are healthy where the panel is empty** — `RIM_MECHANICAL_FORECAST_VALIDATION_EXT.json` pools: 2024_3 n=3571, 2025_2 n=3719, 2025_3 n=3635, all far above the frozen minimum of 300. The model is estimable at every cell that the panel leaves blank.
4. **The surviving rows match the calendar** — 2024_tau3 retains exactly 14 rows and 2025_tau2 exactly 16: those are the filers whose fiscal year ends early enough for the tau-k outcome to be on file by 2026-08-07. A data-quality survivor set would not align to the calendar this precisely.

## The eight candidate defects, each with its measurement

1. **Fiscal-year alignment** — NOT THE CAUSE. The base-year selection (latest fiscal year with filed ≤ origin, FYE guard for April–June filers) is unchanged in P2-A; removing the outcome gate changed no stored row (regression test below). A misalignment would have moved existing rows.
2. **Report timing** — NOT THE CAUSE. The gate is about the *outcome's* filing date, not the base's. 2024_tau3's missing rows are exactly the firms whose 2026/2027 FYE outcome is filed after the cutoff; the 14 that exist are the early-FYE filers. Timing is the *explanation of the survivor pattern*, not a defect in generation.
3. **Duration filters** — NOT THE CAUSE. Annual identification (10-K/10-K-A, 300–400 days) is identical in P2-A; the regression test (6,880 byte-identical rows) would have caught any duration-induced change.
4. **Fiscal-month mapping** — NOT THE CAUSE. No fiscal-month logic differs between the committed engine and P2-A; the FYE guard is untouched.
5. **Training-window availability** — NOT THE CAUSE. Pool n at the supposedly-empty cells: 2024_3 3571, 2025_2 3719, 2025_3 3635 (min 300). The training window exists wherever the panel is empty.
6. **Training universe size** — NOT THE CAUSE. The pools have been well above 300 since long before 2024; the panel's collapse at 2024/2025 coincides with the outcome-gate calendar, not with pool size.
7. **Lags** — NOT THE CAUSE. The tau span check (9–15 months per tau) is unchanged; P2-A's regression test shows zero movement in existing rows, so no lag rule changed anything.
8. **Delisted/IPO handling** — NOT THE CAUSE. Delisted names were absent from the *forecast universe* (a P2-B issue — survivor bias, measured at 0.123–0.149 of D(t0) weight in P1), but that affects WHICH firms get forecasts, not whether FY3 is generated for firms in the universe. The FY3 collapse exists even within the current-universe panel (2025_tau3 has zero rows while its pool has 3,635 firm-years).

## What P2-A changed

One output filter only: rows are now emitted whenever the forecast is computable, with `actual = null` when the outcome does not exist. The estimation pool, base-year window, FYE guard, winsorization, share basis and price basis are untouched.

**The regression test (the whole safety argument):** the P2-A panel has 8,476 rows; all 6,880 committed rows reproduce byte-identically (eps_t, rw, ep, ri, price_scaled, actual — 0 mismatches); the 1,596 new rows all carry `actual = null`, concentrated at 2024_tau3 (404), 2025_tau2 (413) and 2025_tau3 (430), with 16–24 rows in each other cell (firms whose tau-k outcome is filed after the cutoff — same calendar mechanism). If the outcome had been participating in estimation, existing values would have moved; none did.

## What P2-B changed (universe)

Forecast universe = PIT roster union (628 symbols with a cik). Estimation pools *shrank* at every cell (−50 to −106 firm-years) because the 2026-08-02 snapshot universe included ~30 rim-dow members that are not SPX PIT members and left the pool, while departed SPX names added fewer rows than those removed. Coefficients moved accordingly — max |Δβ| per cell: EP up to 0.064, RI up to 0.119 (both at 2019_tau3/2020_tau3/2021_tau3, where pool composition changed most). This is a reported universe-extension effect, not a silent re-estimation: the pool rule admits every firm in the universe that has the required facts, and the movement is quantified cell by cell in FENO_RIM_FORECAST_COVERAGE_2019_2025.json.

## Bottom line

FY3 was never unavailable. It was unscored, and the panel only stored scored rows. The fix is storage, not estimation. Anyone who believes a data defect caused the FY3 collapse can reproduce the four measurements above from the committed artifacts; the gate line, the rows=with_actual identity, the pool sizes, and the calendar-aligned survivor counts.
