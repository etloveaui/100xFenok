# RED TEAM CHARTER — R1 criteria pre-review (FENO RIM RECOVERY)

> Issued 2026-08-07 by km (handler). For cc (independent red team).
> bias_guard: for awareness, not endorsement. Attack both rescue and retirement directions.

## Sequencing promise kept

This charter lands AFTER the R1 freeze commit and BEFORE any R1 computation.
Handler will not run the forecast pipeline until your review returns (or 24h passes with
silence, whichever first). You committed not to open `r1-edgar-panel.json` or
`RIM_MECHANICAL_FORECAST_VALIDATION.json` before returning the review — neither exists yet.

## What to review

Frozen criteria: `source/100xFenok/data/computed/feno-rim-recovery/r1-criteria.json`
sha256 `0efd097f450205612fd924bce59a34f81002697d15f7b25c8074436d9fc69a77`,
commit `716f577c00` (separate earlier commit, receipt confirms both result paths absent).
Paper anchor committed beside it: `data/edgar/literature/li-mohanram-2014-rast.pdf/.txt`.

## Known typo, no amendment

Criteria key `" NegE"` (leading space) is a typo for `NegE`; semantics unambiguous
(`NegE = indicator E_t < 0`). Declared here instead of a v1.1 amendment.

## Attack surfaces worth your time

1. **E deviation** — EDGAR cannot separate special items; primary E =
   IncomeLossFromContinuingOperationsNetOfTaxAttributableToReportingEntity with NetIncomeLoss
   fallback. Does this threaten comparability with the paper's IB−SPI enough to distort the
   RI-vs-RW gate? (Paper footnote 4 says their SPI exclusion raised errors for all models
   without changing rank order — check my reading, paper text is committed.)
2. **IVAO proxy** (OtherNoncurrentAssets, else 0) inside Richardson TACC — bound the damage.
3. **FYE April-June guard** — is my restatement of the paper's rule (those firms use the prior
   fiscal year at a June-30 origin) faithful, and is the EDGAR implementation checkable?
4. **Winsorization timing** — boundaries from the estimation pool only; any leak path?
5. **Gate design** — necessary = RI beats RW on price-scaled MAE at tau 1 AND 2; sufficient =
   same; RI-vs-EP choice by pre-committed lower average MAE; no veto legs (your fh-023 asks).
   Is anything in this gate gameable after results?
6. **Universe** — current S&P500 ∪ rim-dow applied to all years with disclosed survivorship
   bound. Is the within-model-comparison-valid argument sound, and is 530 firms enough pool
   (min 300 firm-years per window)?
7. **Stooq price scaling** — end-of-June close for per-share error scaling; tolerance 10
   trading days; drop-don't-substitute on missing. PIT holes?
8. **Origins 2019-2023** — XBRL coverage from ~FY2009; tau=3 actuals thin at origin 2023.
   Does the design overclaim anywhere?

## Deliverable

One report mail: ISSUE / SEVERITY / RECOMMENDATION per finding + PASS / CONDITIONAL_PASS / FAIL
on the criteria. Do not rewrite the criteria; handler decides any amendment BEFORE running
(amendment = new freeze commit, new receipt, new window for you).

## Ground rules (unchanged from R0)

Stop conditions: future-info leak, post-result threshold choice, credential exposure,
repo-boundary breach, paid/login/deploy requirement. Otherwise record risk, continue.
Claims cite path:line or artifact pointer. Mark unavailable evidence [not verified].
Reply through the wrapper; no polling.
