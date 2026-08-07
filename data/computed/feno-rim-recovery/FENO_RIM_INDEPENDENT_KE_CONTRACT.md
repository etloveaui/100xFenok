# FENO RIM — Independent Cost of Equity: contract and verdict

- adjudicated 2026-08-08 by cc (Opus), handler. Worker: DeepSeek.
- criteria frozen in an earlier commit: `b1-criteria.json`, commit `b63db9fd73`
- industry map frozen separately: `FENO_RIM_SIC_TO_DAMODARAN_INDUSTRY_MAP.json`, commit `56fbe5c6f0`
- mandate §3 of `FENO_RIM_YOO_SUCCESSOR_BLOCKER_RESOLUTION_OPUS_DEEPSEEK.md`

## Verdict: `KE_CORE_RANGE_ONLY`

Every condition for identification is met except width. The cost of equity is defensible,
reproducible from dated sources, and free of the circularity this blocker exists to remove —
but it cannot be stated as a number. It is a band.

| Condition (frozen before any result) | Outcome |
|---|---|
| all three components resolve at every origin from sources published on or before that origin | met — 7/7 origins |
| industry mapping covers ≥90% of index weight | met — 504 of 505 firms; only FRC excluded |
| no component derives from a same-date price of a valued asset | met |
| median firm's Ke range ≤ 3 percentage points | **NOT met — 4.05 to 5.17pp** |

Mandate §3.6 is explicit that `RANGE_ONLY` does not block the successor RIM. It changes what
the successor may emit: ranges, never points.

## The contract as executed

```
Ke(firm, origin) = Rf(origin) + beta_levered(industry, edition) × MRP_hist(origin)
Ke_low  uses MRP − 1 standard error
Ke_high uses MRP + 1 standard error
```

**Rf** — DGS10, last observation on or before the origin. 2.00 / 0.66 / 1.45 / 2.98 / 3.81 /
4.36 / 4.24 percent across 2019–2025.

**beta** — Damodaran US industry levered beta. All nine annual editions 2018–2025 were obtained;
zero missing, zero fallback substitutions. Selection is the greatest publication date on or
before the origin, never interpolated. The 2024 origin uses the May-2024 correction rather than
the January edition, and both are retained raw.

**MRP_hist** — arithmetic mean of annual S&P 500 total return minus annual 10-year Treasury bond
return, expanding from 1928 to the last full year ending strictly before the origin.

| origin | window | years | MRP | standard error |
|---|---|---|---|---|
| 2019 | 1928–2018 | 91 | 6.26% | 2.22 |
| 2020 | 1928–2019 | 92 | 6.43% | 2.20 |
| 2021 | 1928–2020 | 93 | 6.43% | 2.18 |
| 2022 | 1928–2021 | 94 | 6.71% | 2.17 |
| 2023 | 1928–2022 | 95 | 6.64% | 2.15 |
| 2024 | 1928–2023 | 96 | 6.80% | 2.14 |
| 2025 | 1928–2024 | 97 | 7.00% | 2.12 |

## Result

| origin | firms | median beta | median Ke | median range width |
|---|---|---|---|---|
| 2019 | 504 | 1.125 | 9.04% | 5.00pp |
| 2020 | 504 | 1.135 | 7.95% | 5.00pp |
| 2021 | 504 | 0.930 | 7.43% | 4.05pp |
| 2022 | 502 | 1.120 | 10.50% | 4.87pp |
| 2023 | 503 | 1.200 | 11.78% | 5.17pp |
| 2024 | 503 | 1.030 | 11.36% | 4.40pp |
| 2025 | 503 | 1.000 | 11.24% | 4.25pp |

**Why the band is this wide, and why that is the finding rather than a defect.** The width is
`beta × 2 × standard error`. A century of annual data leaves the equity premium with a standard
error near 2.1 percentage points, and no amount of care in the rest of the model shrinks it. A
Ke published as a point estimate would conceal the dominant source of error in every valuation
built on it. The criteria required a range for exactly this reason, before the number was known.

## Context lane — separate, and it must stay separate

`Ke_context = Rf + beta × implied ERP`, using Damodaran's implied ERP series.

The context Ke runs **below** the core at every origin: −1.30, −1.66, −1.50, −1.82, −2.46,
−2.89, −2.75 percentage points on the mean. The market's implied premium has been persistently
lower than the realised historical premium, and the gap widens through 2024.

This is a reading about regime, not an input. The implied ERP is backed out of the same-date
index price, so substituting it into the core would reintroduce the circularity one level up —
the successor would discount by a rate derived from the price it is trying to value. It is
recorded, compared, and never used as a core endpoint.

## Handler defect recorded

The industry-map commit `56fbe5c6f0` claimed coverage of "368/368 firms, 100% of index weight".
That was measured against the R2 panel — the **current-roster** universe — after the
point-in-time reconstruction had already replaced it with 505 firms per origin. The worker
measured the real gap: 129 firms missing a SIC at the 2019 origin, 153 across the union, because
the SIC cache had only ever been fetched for the current roster.

The map itself was not wrong; my verification of it was, and it was the same class of error G4
had already exposed — checking a new universe against an old universe's denominator. The worker
closed 152 of 153 from official SEC endpoints with a per-symbol receipt carrying CIK and fetch
time. One firm, FRC, is unresolved: no operating filings are reachable at any official endpoint.
It is excluded from the core at its four origins and disclosed rather than guessed.

## Verification

Three independent passes agree. The worker computed, then re-derived from raw files by a
separate route (45 checks, exact to 1e-12). I re-parsed the raw historical-returns file with my
own extractor and recomputed all seven expanding windows: arithmetic means match to rounding at
every origin, standard errors match, and the median range widths reproduce the worker's summary
exactly.

One definitional split was found and resolved rather than averaged away: the geometric premium
differs depending on whether it is `geo(stocks) − geo(bonds)` (4.66→5.44) or the geometric mean
of the return ratio (4.45→5.21). Both are now stored with explicit definitions. No threshold
attaches to either.

## Not defended

- Damodaran publication dates are bracketed by archive capture windows rather than directly
  observed; every selected edition was in effect strictly before its origin under either reading.
- A single January-2026 vintage of the historical-returns file serves all seven origins. This is
  technically look-ahead; the measured effect is 0.0008 percentage points on the means against a
  premium of 6.3 to 7.0, and per-origin vintages were judged not worth rebuilding.
- Acquired firms carry their current on-file SIC at EDGAR rather than an origin-vintage SIC.
- FRC excluded at four origins.
