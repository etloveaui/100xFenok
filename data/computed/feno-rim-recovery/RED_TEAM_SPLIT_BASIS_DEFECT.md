# RED TEAM FINDING — market cap is built from two different share bases

> Author: cc (independent red team) · 2026-08-07 · found during the R1 criteria pre-review
> Severity: **STOP**. Invalidates X2, the DEC-290 basis, and every leg of R0.
> Method: own Python, no handler modules. Evidence is internal to the repo except three
> market-cap reference values noted as external.

## The defect

`data/computed/feno-rim-v2/e2-basket-panel.json` records `mc = price * shares` where

- `price` comes from `data/yf/finance/{SYM}.unadjusted.json` → `history_unadjusted`, which is
  **back-adjusted to today's split basis** (established in the R0 review: the series shows no
  discontinuity at NVDA's 2021-07-20 4:1 or 2024-06-10 10:1), and
- `shares` comes from EDGAR `CommonStockSharesOutstanding`, which is **as-reported at the origin**.

These are different units whenever a split falls between the origin and today.

## Proof, internal to the repo

AAPL's share count in the panel jumps between two adjacent origins:

| origin | AAPL shares | ratio |
|---|---|---|
| 2020-09-18 | 4,275,634,000 | — |
| 2020-12-18 | 17,001,802,000 | 3.98 |

That is the August 2020 4:1 split. The price series shows no jump across the same date. One series
jumps at splits and the other does not; they cannot share a basis.

## Magnitude

| firm · origin | panel `mc` | true market cap | ratio |
|---|---|---|---|
| AAPL 2015-03-27 | 183.3B | ~718B (123.25 × 5.825B) | 3.9 |
| NVDA 2021-03-19 | 8.0B | ~319B (514 × 620M) | 39.9 |
| JPM 2015-03-27 | 230.2B | ~226B | 1.0 |
| KO 2015-03-27 | 177.5B | ~177B | 1.0 |

Firms carrying no entry in `data.splits` are correct. Firms carrying one are wrong by exactly the
cumulative post-origin factor. (The "true market cap" figures are external reference values; the
ratios are reproducible from the panel alone via `data/yf/finance/{SYM}.json` → `data.splits`.)

**Correction to the first version of this note.** MMM 2015-03-27 (panel 88.4B) was listed here as
a clean no-split control. It is not — it is a contaminated cell. The series close that day is
136.71 and 136.71 × 1.196 = 163.5, matching MMM's actual late-March-2015 price of ≈164; true
market cap was ≈103.8B. The "~89B" reference used originally was a recalled approximation that
happened to agree with the contaminated value, which is exactly how a bad control survives. JPM
and KO remain valid controls.

## Spinoffs are contaminated the same way

The price series is back-adjusted for spinoff ratios as well as for splits, so the same
understatement applies at factors of 1.05–1.20:

| event | series closes across the event | as-reported move |
|---|---|---|
| MMM Solventum, 2024-04-01 | 88.69 → 94.02 (no drop) | ≈106 → ≈91 |
| IBM Kyndryl, 2021-11-04 | 121.54 → 120.85 (no drop) | ≈139 → ≈120 |

The correction is about the price series' basis, and the price series treats splits and spinoffs
identically. Every entry in `data.splits` should therefore be applied, regardless of kind.

## The correction factor is anchored on the share fact, not the origin

The factor is `S(period_end_of_the_share_fact, today)`, not `S(origin, today)`:

    adjusted_price(t0) = as_reported_price(t0) / S(t0, today)
    shares_true(t0)    = shares_reported(pe) × S(pe, t0)
    ⇒ true_mcap(t0)    = panel_mc × S(pe, today)

The origin-anchored version used in the first computation below misses any split falling in
`(period_end, origin]`.

## Why it is a look-ahead leak, not noise

The split factor is information from **after** the origin. Understating `mc` inflates both
`B/P = book/mc` and `V/P = V/mc`, so contaminated firms rank as the cheapest names in the
cross-section. Firms split because their price rose, and these kept rising. The construction
therefore assigns top cheapness rank to the largest subsequent winners.

**274 of 848 member-origin cells (32.3%)** carry a factor above 1: AAPL, AMZN, GOOGL, NVDA, SHW,
WMT, NKE at true-split factors of 2 to 40, plus HON, IBM, MMM, MRK at spinoff-adjustment factors
of 1.05 to 1.20.

## Effect on the R0 statistics

Recomputed with `mc` restored to as-reported basis, construction otherwise identical. **These
figures use the origin-anchored factor and include spinoff ratios**, so they are a first
approximation, not the final corrected values — the share-fact-anchored factor is the correct one
and the authoritative re-run is pending under it:

| | mean IC(V/P) | mean IC(B/P) | incremental | mean b2 (R0-C M1) |
|---|---|---|---|---|
| as-published, all_origins | +0.1986 | +0.2558 | −0.0572 | +0.0729 |
| as-published, window_complete | +0.2919 | +0.3351 | −0.0432 | +0.1198 |
| **corrected, all_origins** | **−0.0940** | **−0.0233** | −0.0707 | **−0.1341** |
| **corrected, window_complete** | **+0.1127** | **+0.1746** | −0.0619 | **−0.0805** |

The entire positive cross-sectional signal — for V/P **and** for B/P — is an artifact of the units
mismatch. R0-C's `b2`, the leg adjudicated all day and positive under every point estimate,
**flips sign to negative on both sets**.

Correcting the defect does not rescue RIM. It removes the evidence that RIM ranks returns at all,
and it removes B/P's edge with it.

## Scope

- **Invalid**: X2's per-origin ICs; DEC-290's "residual-income V/P does rank subsequent returns"
  claim; every leg of R0-A/B/C/D and both adjudications built on them.
- **Not affected**: realized returns. `tr` uses only the price series, which is internally
  consistent. The damage is confined to the valuation ratios, where it is total.
- **Would recur**: R1 as frozen repeats the mismatch in two forms — EDGAR as-reported shares
  against adjusted Stooq prices, and per-share regressors at year *t* against a per-share
  dependent at year *t+τ* on a different share count.

## Correction to my own R0 audit

In the R0 criteria review I recorded "split contamination in prices/dividends/momentum" as CLEAN.
That clearance was accurate for what it covered — price-vs-dividend and price-vs-momentum
consistency — and it did not cover price-vs-shares. This finding is the gap in that audit.

## Recommended order

1. Put every per-share and market-cap quantity on one declared share basis.
2. Add a unit-consistency assertion to the reproduction gate: for a firm with a known split inside
   the window, per-share earnings must not jump by the split factor.
3. Re-run X2 and R0 on corrected market caps and record the outcome, whatever it is.
4. Re-freeze R1 afterwards.
