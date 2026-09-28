# FENO RIM — Sustainable payout and book growth: contract and verdict

- adjudicated 2026-08-08 by cc (Opus), handler. Worker: DeepSeek.
- criteria frozen across three versions, each in a commit earlier than its result:
  `b2b-criteria.json` → `-v2` (`1c98061dd8`) → `-v3` (`356cc294f1`). v1 and v2 preserved unedited.
- mandate §5

## Verdict: `PAYOUT_GROWTH_NOT_DEFENSIBLE`

By 0.43 percentage points, at one origin out of seven.

| origin | admitted firms | admitted index weight | floor |
|---|---|---|---|
| 2019 | 165 / 505 | 51.16% | pass |
| 2020 | 180 / 505 | 40.37% | pass |
| **2021** | **179 / 505** | **39.57%** | **FAIL — 40% required** |
| 2022 | 208 / 503 | 50.75% | pass |
| 2023 | 228 / 503 | 63.11% | pass |
| 2024 | 247 / 503 | 50.38% | pass |
| 2025 | 270 / 503 | 58.28% | pass |

The frozen rule is "below 40% at ANY origin". One origin is below. The threshold was set
before any number existed and is not moved now that a number exists — a bound that bends
when it is 0.43 points from binding was never a bound.

## What three attempts established

| version | identity | admitted weight range | outcome |
|---|---|---|---|
| v1 | NI − dividends − repurchases + issuance + OCI | 0.231 – 0.428 | NOT_DEFENSIBLE |
| v2 | v1 + share-based compensation | 0.337 – 0.506 | NOT_DEFENSIBLE |
| v3 | v2 − tax withholding on those awards | 0.396 – 0.631 | NOT_DEFENSIBLE |

Each term was necessary. None was sufficient. Median absolute bridge error among admitted
firms improved to 0.0033–0.0043 and clears its 0.005 bar at every origin, so the firms
that pass, pass cleanly. The problem is how many pass, not how well.

**No threshold was moved across three attempts.** Raising the admission bound was
considered and refused with its arithmetic recorded: 3% would admit 212–308 firms and 5%
would admit 280–367. Non-admitted residuals carry a p90 of 29.6–38.8% of opening book, so
the failures are structural rather than narrow, and no defensible bound reaches 70% weight.

## The two limits that matter more than the verdict

**The tag population.** 356 of 628 firms — 56.7% — carry no tax-withholding tag at all,
and among admitted firms 63–66% per origin lack it. The frozen absent-means-zero rule
treats a firm that tags differently identically to a firm that genuinely withheld nothing.
The admitted set is therefore heterogeneous on an axis the identity depends on. This is the
weakest joint in the result and it is not repairable by adding terms.

**The weight is a proxy.** Index weight is computed as last close before origin × shares
outstanding, with no float adjustment, and a firm with no price or no share count
contributes zero. Departed firms — the ones B2-A recovered specifically so the universe
would stop being survivors-only — have no price series, so they enlarge the denominator
without being able to enter the numerator. The proxy is therefore biased DOWNWARD at
origins carrying more departed names, and 2021 is such an origin. This is stated as a known
bias in the measuring instrument, not as grounds to overturn the verdict.

## What this does and does not block

Mandate §11 permits proceeding when only some firms clear the clean-surplus test, provided
coverage weight is published. So B3 proceeds on admitted firms with coverage disclosed at
every origin — 39.6% to 63.1%.

What it forbids is claiming a sustainable payout rule for the index. Roughly half the index
by weight cannot have its book rolled forward from its own disclosed flows, and the half
that can is not a random half: it is tilted toward firms with low share-based compensation.

Note also that even at 70% weight the verdict would have been PARTIAL rather than
IDENTIFIED, because the median net payout ratio moves 18.2 points between 2021 and 2022 and
20.1 points between 2023 and 2024, against a 15-point stability bar. Coverage was never the
only obstacle.

## Verification

Worker computed, then independently recomputed from raw facts by a separate route at each
version (36 checks at v2, 45 at v3, zero differences). Cross-checks against the committed
r1-panel extract and against direct SEC copies both returned zero differences on 706 and 25
sampled period-values.

Two concept corrections came from the worker rather than from me: v2 named no
tax-withholding tag, and the first candidate exists in none of the 5,801 cached CIKs while
the frozen one does. Eight CIK identifications were corrected during the rebuild, including
four resolved against a 2019 ticker snapshot rather than the current file — ticker reuse
that would otherwise have attached one company's history to another's name.

## Handler defects recorded

- v1's admission rationale named share-based compensation as a violation small enough for a
  2% bound to survive, and then gave the identity no term for it. The equation was
  incomplete, not the threshold too tight.
- v2 added the equity credit and omitted the cash debit that settles the same award,
  leaving the identity asymmetric.
- "index weight" was frozen without defining how weight is measured, so the verdict now
  turns partly on a proxy whose bias direction had to be characterised after the fact.
