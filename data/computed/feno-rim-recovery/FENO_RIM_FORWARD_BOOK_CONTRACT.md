# FENO RIM — Forward-book contract

Frozen 2026-08-08 by cc (Opus), handler, before any P1 result exists. Worker: DeepSeek.
Mandate: `FENO_RIM_YOO_SUCCESSOR_NEXT_EXECUTION_OPUS_DEEPSEEK.md` §5.

**This document contains no results.** It states what will be computed and how the verdict will be
read. `p1-criteria-v2.json` is the machine-readable authority; where the two differ, the JSON
governs. `p1-criteria.json` (v1) is preserved unedited and superseded.

## What v2 corrected, before anything was computed

The worker began implementing and its first script header read *FNI = ri forecast, primary model
per engine gate*. I stopped it, and reviewing the clause it was resolving found three defects in
my own v1 — one of them a mandate §4 stop condition v1 would have walked into.

**The share basis was wrong.** v1 added the mechanical forecast to `StockholdersEquity`. The
forecast panel states its rows are per-share; stockholders' equity is total dollars. v1 would have
produced a forward book wrong by a factor of the share count at every firm. v2 carries everything
in total dollars and converts the forecast with the panel's own share basis, the same one the index
weight uses — one share count, not two.

**RI versus EP was never named.** The worker chose RI by citing R1's preregistered gate, and that
gate is real. But its margin is 0.03575813 against 0.03589537 average price-scaled MAE — four parts
in a thousand. That is a tie, and mandate §7.3 makes the RI/EP choice an axis to sweep, not a
selection to make. v2 computes both and requires agreement under both.

**Path A cannot see departed firms.** The committed forecast engine ran on the current index
snapshot, so firms that left before 2026-08-02 have no forecast at any origin. B2-A recovered those
firms specifically to stop the universe being survivors-only, and the forecast leg silently puts
them back. Path A is therefore survivor-biased where Path B is not, and coverage is capped from
above by something that has nothing to do with whether the book paths agree.

## What changed and why

B2-B asked one question — does the accounting identity close within 2% — and used the answer as an
admission gate. It closed for 179 of 628 firms at the 2021 origin. B3 then inherited that gate, and
`NOT_ADMITTED_B2B` removed 311 to 360 firms per origin, more than every other exclusion reason
combined. The successor RIM was being asked to describe the S&P 500 from roughly a third of it.

The bridge was not wrong. Three attempts established that each term it was missing was necessary and
none was sufficient, and that the firms which pass, pass cleanly. What was wrong was making a
bookkeeping test decide who gets valued.

So the forward book is now computed two ways that share no inputs beyond the opening book, and the
question moves from *does the identity close* to *do two independent constructions agree*.

## The two paths

**Path A — shareholder-payout rollforward.** Book grows by forecast earnings and shrinks by what the
firm returns to shareholders. Run twice, once with each mechanical forecast:

```
B_A_m(k) = B_A_m(k-1) + FNI_m(k) - Payout_m(k),   k = 1..3,  m ∈ {RI, EP}
FNI_m(k) = FEPS_m(k) × S                          per-share forecast → total dollars
Payout_m(k) = r_payout × FNI_m(k)                 when FNI_m(k) > 0
            = median dividends                    when FNI_m(k) ≤ 0
```

`S` is the origin share count from the forecast panel's own basis — cover-page `dei` shares,
split-adjusted, with R1's eligibility band. The same `S` is used for the index weight, so the
forecast leg and the weight leg cannot drift onto different share counts. It is held fixed across
the three years: buybacks reduce book through the payout term and do not additionally shrink the
share count. That is a declared simplification, not an estimate.

`us-gaap:CommonStockSharesOutstanding` is not used for `S` at all. R1 measured filers reporting it
in millions while tagging it as shares — PEG at 504 against a `dei` count of 497,000,000.

`r_payout` is a ratio of medians — median net shareholder payout over median net income across up to
five annual years ending at or before the origin. Not a single year extended forward, which the
mandate forbids, and not a median of ratios, which detonates when one year's earnings approach zero.
Firms whose own history cannot produce the ratio inherit their Damodaran industry's median; firms
whose industry has fewer than five such peers inherit the all-firm median. Every fallback is flagged
and its index weight reported.

Share-based compensation and its tax withholding are not in the payout. They belong to the equity
bridge, and the bridge is now a diagnostic.

**Path B — empirical book growth.** Book grows at the rate the firm's own book has actually grown,
with no accounting identity and no forecast earnings:

```
B_B(k) = B_B(k-1) × (1 + g_B),   k = 1..3
g_B    = median of up to five annual book growth rates, each clipped to ±50%
```

Median rather than CAGR, because a CAGR is decided by two endpoints and one restructuring year at
either end sets the entire path. At least four clean growth rates are required, which means five
clean annual observations; below that the median is decided by one or two firm-years and is not a
growth estimate.

## How agreement is read

The paths are compared as annualised three-year growth rates. Path A produces two of them, one per
forecast, so agreement is decided per forecast and then combined:

| state | condition | how it is used |
|---|---|---|
| `BOOK_PATH_AGREES` | agrees under **both** RI and EP | fair-value core |
| `FORECAST_PATH_SENSITIVE` | agrees under exactly one | not core; weight disclosed |
| `BOOK_PATH_DISAGREES` | both forecasts run, neither agrees | excluded, weight disclosed |
| `BOOK_PATH_SINGLE_ONLY` | only one of the two paths available | sensitivity only |
| `BOOK_PATH_UNAVAILABLE` | neither available | excluded, reason counted |

Requiring agreement under both is the point, not pedantry. The gate that picked RI over EP
separated them by four parts in a thousand. A firm that agrees under one and contradicts under the
other has not been shown to have an identified forward book — it has been shown to depend on a coin
flip. Mandate §9 already lists sign reversal under book-path choice as a FAIL condition; this is the
same failure one level up, so it is counted rather than absorbed into the core.

The 5-point tolerance is not arbitrary. The independent cost-of-equity band from B1 is itself
4.05 to 5.17 points wide. A disagreement narrower than the discount-rate uncertainty already being
carried into the valuation is not a contradiction the model can resolve.

A growth rate inside ±0.5 points counts as flat, and flat agrees with either direction — a book that
is not moving contradicts neither a rising nor a falling path.

## The measuring instrument, stated before it measures

B2-B's own adjudication recorded that it froze the phrase "index weight" without defining how weight
is measured, and that firms with no price series enlarged the denominator while being unable to
enter the numerator — biasing coverage downward exactly at the origins carrying more departed names.

P1 defines it. Weight is last close before the origin times shares outstanding from the latest
filing at or before the origin, over the sum of that same product across roster members for which
both exist. Firms whose weight cannot be measured leave the denominator, and what left is published
as `roster_marketcap_coverage` at every origin rather than being absorbed silently.

The consequence is that **P1 coverage percentages cannot be compared to B2-B's 39.6–63.1%.** They
are shares of a different denominator. Any report that puts them side by side without saying so is
misreporting.

## A prerequisite that was missing

The seven point-in-time S&P 500 rosters that B2-A reconstructed — recorded in DEC-294 as zero
unresolved — exist as a finding but not as a file. What is committed is a 628-symbol union evaluated
identically at every origin, with no per-origin membership. The weight denominator above is defined
over roster members, so P1 cannot be evaluated until the roster is a real artifact.

Materialising it is not reopening DEC-294. If re-materialisation disagrees with the recorded
505/505/505/503/503/503/503 counts, the disagreement is reported and explained, never adjusted away.

## A ceiling that sits above the whole phase

Because Path A needs a forecast and the forecast engine only ever ran on the current index, the
agreeing weight can never exceed the weight that has a forecast at all. That ceiling has nothing to
do with whether the two book paths agree, and it would be easy to misread a low number as the
contract failing when the contract was never given the firms to work with.

So every origin that falls short of a band must publish the shortfall broken into its causes: weight
with no forecast, weight failing Path A for some other reason, weight failing Path B, weight
sensitive to the RI/EP choice, and weight where both paths ran and genuinely disagreed. A verdict
without that split is not a P1 result and I will not adjudicate on one.

One more thing belongs on the record before any number arrives. R1's own gate reports that the RI
forecast does **not** beat a random walk at one year — 0.03130 against 0.03024 — and R1 pre-committed
that this is the outcome the source paper predicts for a large-cap universe and is not grounds to
stop. It is not grounds to stop here either. But if Path A and Path B disagree, one live explanation
is that Path A's earnings input carries little information beyond a random walk, and that
explanation has to compete with the others rather than be discovered afterwards.

## Verdict, frozen

Read over the five origins 2019 through 2023. The 2024 and 2025 origins are computed and reported
but do not bind, because their mechanical forecast strips are broken — FY3 at the 2024 origin has 14
rows against 394 at FY2 — and repairing that is P2's work. P1 therefore never claims seven-origin
coverage.

| verdict | condition |
|---|---|
| `FORWARD_BOOK_DEFENSIBLE` | agreeing weight ≥ 60% at every binding origin **and** payout stability holds |
| `FORWARD_BOOK_PARTIAL` | otherwise, agreeing weight ≥ 33.3% at every binding origin |
| `FORWARD_BOOK_NOT_DEFENSIBLE` | otherwise |

Payout stability carries B2-B's 15-point bar over unchanged: the median normalised payout ratio may
not move more than 15 points between adjacent origins. B2-B measured single-year moves of 4.9, 7.6,
16.4, 4.9, 18.4 and 13.1 points, and two of them exceeded the bar. Multi-year normalisation is
precisely the thing that is supposed to remove that swing. If it still moves, the normalisation did
not work, and no amount of coverage makes the contract defensible.

**These thresholds do not move.** If 60% is missed by any margin the verdict is `PARTIAL`. If 33.3%
is missed by any margin the verdict is `NOT_DEFENSIBLE`. A bound that bends when it is close to
binding was never a bound — that was settled at B2-B and it is settled here.

## What P1 does not do

It does not touch the ICC, the Ke contract, the terminal rule or the horizon. It does not repair the
forecast collapse; that is P2. It does not value anything; that is P3. It does not extend to another
index, build any interface, or change the public surface, which stays at zero rows in
`MODEL_REVALIDATION` throughout.
