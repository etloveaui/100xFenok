# FENO RIM — P1 adjudication: the forward book is not identified

Adjudicated 2026-08-08 by cc (Opus), handler. Worker: DeepSeek.
Criteria: `p1-criteria-v2.json` (`8c1f74200a`), superseding `p1-criteria.json` (`251f4bcc21`).
Mandate: `FENO_RIM_YOO_SUCCESSOR_NEXT_EXECUTION_OPUS_DEEPSEEK.md` §5.

## Verdict: `FORWARD_BOOK_NOT_DEFENSIBLE`

Not by a margin. Four of the five binding origins sit below the `PARTIAL` floor, the worst by
eleven points.

| origin | core weight | ≥ 0.3333 |
|---|---|---|
| 2019-06-30 | 0.3603 | pass |
| 2020-06-30 | 0.3102 | **fail** |
| 2021-06-30 | 0.2424 | **fail** |
| 2022-06-30 | 0.2349 | **fail** |
| 2023-06-30 | 0.2250 | **fail** |

Payout stability, the other half of the `DEFENSIBLE` test, passes cleanly: adjacent-origin moves in
the median firm-rule payout ratio are 0.0209, 0.0884, 0.0414 and 0.0095 against a 15-point bar. So
the multi-year normalisation did the job B2-B's single-year ratio could not. That is a real gain,
and it is not enough, because coverage is what fails.

## The finding, which matters more than the verdict

**This is not a coverage artifact.** Path A needs a forecast and the forecast engine only ever ran
on the current index, so a ceiling was expected. The ceiling is real but small: weight with no
forecast at all is 0.123 to 0.149. Genuine disagreement — both paths computed, both available, and
they contradict — is **0.29 to 0.38**, two to three times larger, and it is the dominant term at
every origin.

Two independent constructions of the same forward book, sharing only the opening balance, disagree
about a third of the S&P 500 by weight.

What separates them is economic, not clerical. At the 2019 origin the firms that agree carry a
median forecast return on equity of 0.148 against median historical book growth of 0.042. The firms
that disagree carry 0.193 against 0.027. The gap between what the forecast says a firm earns on its
book and what its book has actually done is 0.097 for agreeing firms and **0.186 for disagreeing
ones** — the discriminator is that distance, not the payout ratio, whose median is 0.722 for
agreeing firms and 0.720 for disagreeing ones.

The mechanism is the one B2-B found from the other side. A residual-income rollforward moves book by
retained earnings; US large-cap book does not move that way, because equity is also reduced by
repurchases executed far above book value and increased by share-based compensation. `OEA = 0` was
my declared simplification, and it is the binding one. B2-B proved every omitted term was necessary;
P1 shows what omitting them costs when you stop using the identity as a gate and start using it as
a path.

## What was verified independently, and how far that goes

`redteam-scripts/p1_handler_independent.py` was committed at `2378773885` **before any worker result
existed**, reads the SEC companyfacts cache directly, and shares no code with the worker.

| quantity | check | result |
|---|---|---|
| `r_payout` | 120-cell random sample, 5 binding origins | 108 of 108 comparable exact to 1e-9 |
| per-origin median `r_payout` | all five recomputed | 0.7999 / 0.8208 / 0.7325 / 0.6911 / 0.7006, exact |
| `g_B` | 60-cell random sample | 56 of 56 comparable exact to 1e-9 |
| `core_weight` | rebuilt from the frozen rule at every binding origin | max difference 1.4e-16 |
| weight normalisation | sum over each origin's denominator | exactly 1.000000 |

Twelve to sixteen cells per sample fell outside the M470 companyfacts cache and could not be
recomputed by this route; see the reproducibility gap below.

**What this verification does not cover.** Prices and the split factors behind the share basis come
from the same r1 cache the worker used. I verified the arithmetic chain from primary XBRL for both
book statistics and the aggregation logic deterministically, but the price leg is a shared input,
not an independently sourced one. A price error would pass this check.

## The defect that voided the first run

The worker's first run reported `core_weight` of 0.2696 / 0.2693 / 0.3302 / 0.3334 / 0.2345. Those
numbers are void and are not comparable to the ones above.

Its `instant_map()` carried no form filter while its `annual_map()` did, so Path B's "6 most recent
annual observations" were six *quarterly* ones spanning fifteen months, and the median of five
quarterly growth rates was compounded as an annual rate for three years. MMM's reported `g_B` of
-0.044106 reproduces exactly as the quarterly median; the annual-only value is -0.128156. The same
missing filter put a 10-Q balance at 2019-03-31 in as the opening book.

The rerun fixed both, and MMM now reproduces my reference exactly. Full detail is in
`p1-freeze-receipt-v2.json`; the void artifacts are preserved uncommitted at
`_tmp/handoff/p1-run/VOID-run-20260808-1424/`.

## Handler criteria defects, five of them

Recorded so the next criteria file does not repeat them. Every one is the same shape: a phrase that
felt decidable later, or several quantities aggregated into one word.

1. **Share basis.** v1 added a per-share forecast to a total-dollar book — the mandate §4 stop
   condition. Caught from the worker's script header before its results were reported. v2 carries
   everything in total dollars with one shared share count.
2. **RI versus EP unnamed.** v1 said "the mechanical forecast". R1's gate does pre-register a
   primary, but its margin is four parts in a thousand of MAE, and §7.3 makes the choice a sweep
   axis. v2 computes both and requires agreement under both.
3. **The forecast universe.** v1 treated a missing forecast as a per-firm data gap. It is
   structural: the engine ran on the current index, so departed firms — the ones B2-A recovered to
   remove survivorship — can never have one.
4. **Concept precedence resolved per firm.** "Use the first concept that has a qualifying fact"
   picks `PaymentsOfDividendsCommonStock` on the strength of stale years and then zeroes the window.
   PLD tags it only for 2009-2013 and the generic concept for 2016-2021; HUM tags it for 2021
   alone. Measured blast radius: **34 of 2,274 firm-origins** would have returned an all-zero
   payout. The worker resolved precedence per period end and was right to. Declared deviation.
5. **Two states matching the same firm.** v2's `BOOK_PATH_DISAGREES` and `BOOK_PATH_SINGLE_ONLY`
   both match a firm with Path A available and Path B absent. The worker read it as `DISAGREES`,
   which is literal but wrong in substance — a firm with no second path cannot contradict one.
   Weight affected: 0.016 to 0.043 per origin. It does not touch `core_weight` or the verdict, but
   it inflates the reported disagreement, so the corrected figures are the ones quoted above.

## A reproducibility gap that outlives P1

**59 of the 627 roster symbols exist only in an uncommitted temporary directory**
(`_tmp/handoff/b2b-run/facts`). They are absent from the M470 companyfacts cache and from
`data/edgar/r1-panel/`, which `.gitignore` line 167 excludes from the repository. 138 of 2,274
firm-origins on the binding origins — 6.1% — depend on them.

The list is not random: ABMD, AGN, ALXN, APC, CBS, CELG, CERN, CTXS, CXO, ETFC, FLIR and their
neighbours are precisely the departed names B2-A recovered so the universe would stop being
survivors-only. If that temp directory is cleaned, the survivorship correction silently reverts and
nobody is told. This is not a P1 result; it is a standing hazard to everything B2-A established, and
it needs those extracts moved to the SSD with receipts under the storage-split rule.

## What this does and does not block

Mandate §5.5 lets `NOT_DEFENSIBLE` proceed only with core and sensitivity weight reported and with
P3 disclosing that its core is a minority. So P2 proceeds — and P2 is now better motivated than when
it was written, because the forecast-coverage ceiling it repairs is the *smaller* of the two
problems and repairing it will not by itself lift `core_weight` above the floor.

What is forbidden is any index-level statement built on this forward book. Roughly two thirds of
S&P 500 weight either cannot be rolled forward at all or is rolled forward two ways that contradict
each other. `PUBLIC_ROWS` stays `[]` and `PUBLIC_STATE` stays `MODEL_REVALIDATION`.
