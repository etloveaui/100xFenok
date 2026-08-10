# FENO Index RIM — E5 Historical QA (Worker Submission)

Worker: km (DeepSeek) | Handler: cc (Opus, sole adjudicator)
Criteria: `feno-index-rim-e5-criteria.json` (a3f8781dab) + `feno-index-rim-e5-criteria-v2.json` (27c7643d99)
Candidate: **B — stable-growth RI** (`ab46a51077`). Starting commit: ab46a51077.
**Every historical number below is PROXY** (RECONSTRUCTED_PIT_PROXY lane, v2 frozen construction).
Nothing here satisfies a READY gate. Verdict is the handler's, not the worker's.

---

## 1. PIT source ledger — handler inventory CONFIRMED

`FENO_RIM_E5_PIT_SOURCE_LEDGER.json`. Per-origin per-input source date, publication date,
first-knowable date and classification for all 7 fixed origins × SPX/NDX.

| input | classification at every origin | why |
|---|---|---|
| P0 | MODEL_EQUIVALENT | dated benchmark series, knowable at origin |
| P/B | MODEL_EQUIVALENT | same |
| FY1 EPS | MODEL_EQUIVALENT | live B takes FY1 from benchmark best_eps |
| FY2/FY3 EPS | **RETROSPECTIVE_ONLY** | stock_action_index.json is a single current file (2026-08-08); no historical vintage — handler inventory confirmed |
| ROE history (LTROE) | MODEL_EQUIVALENT | dated series (window <10y before 2020 disclosed, n≥496) |
| Rf | MODEL_EQUIVALENT | dated DGS10 series |
| ERP | **RECONSTRUCTED_PIT_PROXY** | historical_erp.json is Damodaran *implied* ERP (66 annual obs); live B reads the country-premium file — source-class mismatch, handler inventory confirmed |
| payout A | **RETROSPECTIVE_ONLY** | stock_action weighted dividend yield: current file only — confirmed |
| payout B | **RETROSPECTIVE_ONLY** | slickcharts yield files carry only the current reading — confirmed |

**Origin classification: RETROSPECTIVE_ONLY for all 7** (FY2/FY3 + payout are retro).
**MODEL_EQUIVALENT_PIT = {SPX: 0, NDX: 0}** → D1 and D2 fail → READY unreachable on data
grounds. Missing data is not a RETIRE condition (stated in criteria, not amended).

No contradiction found with the handler's inventory. The inventory is a data-availability
statement, not a model verdict.

## 2. Historical grid (PROXY lane, v2 frozen construction)

`FENO_RIM_E5_HISTORICAL_GRID.json`. Substitutions applied and labelled per origin:
FY1 = benchmark best_eps; FY2/FY3 = flat at FY1 (declared degenerate path, not a forecast);
ERP = `historical_erp years[origin_year].implied_erp_fcfe`; payout = 1 − retention with
retention = (B_t − B_(t−1)) / (ROE_t × B_(t−1)) clipped [0,1]. Everything else identical to B
(g = Rf(t0), stable retention g/LTROE, CV3 = (LTROE−Ke)·B3/(Ke−g), 3×3 ±50bp grids).

| origin | SPX Bear/Base/Bull | NDX Bear/Base/Bull |
|---|---|---|
| 2019-06-30 | 2,449 / 2,772 / 3,168 | 5,393 / 6,017 / 6,780 |
| 2020-06-30 | 2,594 / 2,936 / 3,357 | 5,654 / 6,349 / 7,205 |
| 2021-06-30 | 2,940 / 3,337 / 3,827 | 7,162 / 8,126 / 9,286 |
| 2022-06-30 | 2,804 / 3,173 / 3,625 | 6,686 / 7,588 / 8,672 |
| 2023-06-30 | 2,896 / 3,302 / 3,811 | 7,213 / 8,240 / 9,472 |
| 2024-06-30 | 3,892 / 4,509 / 5,306 | 9,340 / 10,659 / 12,229 |
| 2025-06-30 | 4,217 / 4,861 / 5,685 | 15,805 / 18,061 / 20,941 |

Monotonicity passed 100% (7/7 origins × both indices). min(Ke − g) ≥ 3.00pp in every canonical
cell (min observed 3.26pp). Base terminal share: SPX 0.55–0.69, NDX 0.68–0.83 (all GREEN/AMBER;
none >0.90).

## 3. 12-month target QA (PROXY lane) — `FENO_RIM_E5_12M_TARGET_QA.json`

P0 = last trading close ≤ origin; P12 = last trading close ≤ origin + 12 calendar months
(one convention, all origins). Aggregates over 7 origins:

| index | band hit | dir hit | median base err | median no-change err | base/naive | Spearman |
|---|---:|---:|---:|---:|---:|---:|
| SPX | 1/7 (14.3%) | 1/7 (14.3%) | 0.287 | 0.121 | 2.37× | +0.107 |
| NDX | 2/7 (28.6%) | 2/7 (28.6%) | 0.380 | 0.221 | 1.72× | −0.429 |

**PROXY results are weak**: band/direction hit rates far below any READY usefulness gate, Base
error worse than the no-change benchmark on both indices, NDX Spearman negative. These numbers
test B's terminal + required-return structure on a degenerate flat-EPS path, **not** B's forecast
leg. They are reported for adjudication, never merged into a primary aggregate, and never used to
satisfy a READY gate.

## 4. Terminal fragility — `FENO_RIM_E5_TERMINAL_FRAGILITY.json`

Canonical g0 = Rf(t0); shadows g1 = max(0, Rf−1pp), g2 = max(0, Rf−2pp). Base values:

| | current g0/g1/g2 | shift 100bp | flip 100bp | terminal share | min(Ke−g) |
|---|---:|---:|---:|---:|---:|
| SPX current | 6,526 / 5,785 / 5,255 | 11.4% | **no** | 68.5% | 4.66pp |
| NDX current | 31,452 / 27,293 / 24,318 | 13.2% | **YES** | 79.7% | 4.66pp |

Historical (7 origins): SPX median shift100 10.4%, flip rate 0/7; NDX median shift100 13.0%,
flip rate 1/7 (2024-06-30). g2: SPX no flips; NDX current flips (disclosure only, no auto-RETIRE).

**F2 (NDX current 100bp g shadow must not flip direction) FAILS on the current live snapshot**:
NDX Base is above today's price at g0 (+11.2%) and below it at g1 (−3.5%). SPX F1 passes.

## 5. No-change benchmark — `FENO_RIM_E5_BENCHMARK_COMPARISON.json`

naive target = P0 (no future information). Per origin and index: naive error vs Base error,
`base_beats_naive` flag. Aggregates: SPX 1/7 origins beat naive, NDX 1/7. Base does not beat the
no-change benchmark on either index under the proxy lane (P7/P8 would fail).

## 6. What the worker would not defend

1. The proxy forecast leg (FY2/FY3 = FY1 flat) is a degenerate stand-in; any usefulness numbers
   from it do not validate the live consensus forecast path.
2. The proxy ERP (implied_erp_fcfe) is a different series than live B's country premium.
3. The proxy payout is derived from the point-in-time book series and can differ materially from
   the live routes (e.g. NDX 2025-06-30 payout 0.728 vs live A 0.097) — the valuation impact of
   that substitution is part of the proxy result, not separately isolated.
4. NDX current direction flip at g−100bp is a real fragility signal on the live snapshot; it is
   reported as measured, not tuned away.

## 7. Files written (uncommitted)

`FENO_RIM_E5_PIT_SOURCE_LEDGER.json`, `FENO_RIM_E5_HISTORICAL_GRID.json`,
`FENO_RIM_E5_12M_TARGET_QA.json`, `FENO_RIM_E5_TERMINAL_FRAGILITY.json`,
`FENO_RIM_E5_BENCHMARK_COMPARISON.json`, this report. Runner: `scripts/build-rim-index-e5.mjs`.
Verifier: independent Python re-derivation of 2019-06-30 and 2025-06-30 for both indices —
max dev 2e-16 (exact match). `FENO_RIM_E6_FINAL_DECISION.json` is the handler's to write.

E6 verdict input summary for the handler (worker does not adjudicate): D1/D2 fail (0 PIT
origins), proxy usefulness weak, F2 fails on NDX current, mechanics (monotonicity, Ke−g,
terminal share) pass. Per criteria: READY unreachable on data grounds; RETIRE requires ≥5
model-equivalent origins which do not exist; the remaining adjudication is RESEARCH_ONLY vs
structural failure — that decision belongs to cc.
