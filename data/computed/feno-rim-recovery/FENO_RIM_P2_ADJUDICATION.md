# FENO RIM — P2 adjudication: two origins were never missing

Adjudicated 2026-08-08 by cc (Opus), handler. Worker: DeepSeek.
Criteria: `p2-criteria.json` (`b5a528a331`). Mandate: §6.

## Verdict: `SEVEN_ORIGINS_READY`

Achieved by P2-A alone, on the preregistered model. P2-B is **not adopted**; see below.

Share of the frozen P1 weight denominator `D(t0)` carrying a complete tau 1-3 strip under both
RI and EP, recomputed by the handler from the panels and P1's own weights:

| origin | \|D\| | before | after | bar 0.60 |
|---|---|---|---|---|
| 2019-06-30 | 355 | 0.7467 | 0.7645 | ready |
| 2020-06-30 | 379 | 0.7664 | 0.7843 | ready |
| 2021-06-30 | 391 | 0.7889 | 0.8054 | ready |
| 2022-06-30 | 405 | 0.7758 | 0.7956 | ready |
| 2023-06-30 | 420 | 0.8039 | 0.8247 | ready |
| **2024-06-30** | 440 | **0.0994** | **0.8479** | ready |
| **2025-06-30** | 449 | **0.0000** | **0.8499** | ready |

Both twelve-month outcome windows closed before today, so the second readiness clause binds on
neither. The two origins B3 discarded are now the best-covered of the seven.

Nothing was computed that was not being computed before. The forecasts existed; the emitter
refused to write down any row whose future outcome had not happened yet, and every reader
downstream took the silence for absence.

## The regression test, run by the handler on the full panel

`redteam-scripts/p2_handler_regression.py`, committed at `c3b57154b3` before this run existed and
verified in both directions before commit — it passes the baseline against itself and fails on a
single value perturbed by 1e-12.

| | |
|---|---|
| baseline rows | 6,880 |
| reproduced byte-identically | **6,880** |
| changed | 0 |
| missing | 0 |
| added | 1,596, **all with `actual = null`** |

Additions land where the calendar predicts: 404 at 2024 tau3, 413 at 2025 tau2, 430 at 2025 tau3,
and 16 to 24 in every other cell — firms whose tau-k outcome is filed after the evaluation cutoff,
the same mechanism at smaller scale.

Not sampled. The claim being made is universal, and the only way removing an output filter can
corrupt a forecast is if the filter was participating in estimation. It was not.

## P2-B is not adopted, and the reason is measured

The universe extension was supposed to end the forecast leg's survivorship: P1 measured 0.123 to
0.149 of index weight held by departed firms that can never have a forecast because the engine ran
on today's index. 153 departed names were fetched from SEC and 64 prices acquired.

**It added nothing.** Distinct symbols: baseline 416, P2-A 434, P2-B **420**. P2-B added zero
symbols to P2-A and removed fourteen — the rim-dow members that are not S&P 500 point-in-time
constituents and which the roster-union universe definition excludes. Not one P2-B-only symbol sits
inside `D(t0)` at any origin, because entering `D` needs both a price and a share basis, and 61 of
the delisted names have no price in any accessible source.

What it did change was the model. The estimation pool moved by −50 to −106 firm-years at every
origin-tau cell, and coefficients moved by up to 0.119 (RI) and 0.064 (EP) at the tau3 cells. The
worker reported this without being asked and named it first in what it would not defend.

So P2-B costs a re-estimated, unregistered model and buys no coverage. Adopting it would replace a
preregistered forecast with an unregistered one for no measurable gain. **P3 uses the P2-A panel.**

That the readiness numbers are identical under both panels is not an argument for adopting P2-B —
readiness measures strip availability, which P2-B did not change, while the coefficient movement
changes forecast *values*, which is what P3 consumes.

## What stays open

**Forecast-leg survivorship is unresolved.** P1's 0.123 to 0.149 hole is still there. The
diagnosis is now sharper than it was: it is not that the engine was pointed at the wrong universe,
it is that departed constituents have no price series in any source we can reach, so they cannot
enter a market-cap weighted denominator even when their filings are recovered. B2-A recovered their
accounting; nobody has recovered their prices. P3 must disclose this as a floor on what any
index-level statement can cover, not treat it as noise.

Four further limits the worker disclosed and I accept as stated: SBNY and FRC have no forecast
anywhere; departed prices came from stockanalysis, outside the yahoo/r1 source family used
everywhere else; the price-coverage gate denominator was narrowed to forecast-computable names, a
criteria-adjacent judgment made rather than asked; and rim-dow names leave the universe by the
roster-union definition, which is by design.

## Mandate §6, answered

The audit §6 ordered was run and returned **no defect found**, with `FENO_RIM_FY3_GAP_AUDIT.md`
answering each of the eight candidate causes with a measurement. The preregistered fallback
hierarchy for the FY3-unavailable case was never reached, because FY3 was available the whole time.

The finding is not really about FY3. A validation panel was read as a forecast panel, and two years
of the mission's evidence were discarded on that reading — B3 dropped the origins, P1 inherited the
drop and made them non-binding, and both were correct given what they were looking at. The artifact
never lied; it was only ever answering a different question than the one being asked of it.

Public surface untouched: `rows=[]`, `MODEL_REVALIDATION`.
