# RIM Analyst Data Shadow Plan (Deliverable 12.7)

> Control-plane research plan for **point-in-time (PIT) analyst consensus data** — the data shadow
> for the canonical RIM path (R1 mechanical forecasts → R2/R3 canonical V/P).
> Handler: km (subagent). Date: 2026-08-07. Mission: FENO RIM RECOVERY (owner directive 2026-08-07).
> Hard constraint honored: **no logins, no payments, no account creation, no code changes**.
> This document commits nothing and sets no thresholds; it is a research plan + sample-request kit.
> Notation: `[verified]` = confirmed this run from the cited source; `[measured]` = our own probe;
> `[established]` = fixed by prior work (see provenance, §6); `[partially verified]` / `[not verified]`
> = stated as-is.

---

## 1. Purpose and the exact sample request

### 1.1 Why this plan exists

R0-CORRECTED closed the heuristic question: the historical-accounting V/P is decisively dead on
the current-Dow-30 basket — the canonical battery is uniformly negative as computed, its
significance does not survive removing five of thirty firms, and the ordering ("V/P adds nothing
over B/P; B/P ranks better") is robust on corrected data. The canonical path (R1 → R2/R3) proceeds.
The canonical path's forecast input is the missing piece: the literature RIM models take
**future-period analyst consensus forecasts** at each origin; our R1/R2 engines currently take
mechanical Li-Mohanram forecasts from EDGAR. This plan covers how to obtain **historical
point-in-time analyst consensus** — free first, sample-then-buy — so that R2/R3 can shadow-run
with the real consensus input and decompose the delta.

### 1.2 The exact sample request (what the data must satisfy)

- **Universe**: 30–50 US large-cap names (Dow-30 ∪ subset of S&P 500; the R1/R2 universe — see
  `r1-criteria-v2.json` `universe_precommitted`). All must be current large caps with dense
  analyst coverage so analyst count is meaningful.
- **Origins**: ~12 annual/semiannual origins spanning 2015–2023. Illustrative grid used for the
  yield measurements below: `2015-12-31, 2016-06-30, 2016-12-31, 2017-06-30, 2017-12-31, 2018-06-30,
  2018-12-31, 2019-06-30, 2020-06-30, 2021-06-30, 2022-06-30, 2023-06-30` (12 semiannual dates).
  Final grid is frozen by the recovery criteria, not by this plan.
- **Fields, per origin × firm**:
  - FY1 / FY2 / FY3 mean EPS consensus (fiscal-year-anchored, mapped to horizon τ = 1..3 by the
    R1 FYE rule),
  - long-term growth (LTG) where the product carries it,
  - analyst count / number of estimates,
  - **consensus timestamp** (the as-of date the snapshot reflects),
  - currency (USD required),
  - **adjustment basis** (GAAP vs non-GAAP/Street EPS — see §4.3 for why this is a first-class field).
- **Form**: as-was snapshot per origin — never restated. Either a true PIT product (daily/weekly
  as-of history) or, minimally, a snapshot file dated on/before each origin with a documented
  collection timestamp.

### 1.3 Why PIT (not restated) is the requirement

A restated consensus table (today's consensus with a "history" column) embeds revisions made
*after* the origin date. Feeding restated values into RIM at origin t contaminates the
information set: the value at t implicitly contains post-t information, which is exactly the
look-ahead bias the R0-CORRECTED unit lesson flagged on the price leg and the X2-era audit flagged
on the consensus leg (X0: `consensus: null` at every origin; the literature input was never in the
repo). The shadow comparison is only meaningful if both inputs — mechanical forecasts and analyst
consensus — observe the same information set at the same origin. A timestamped as-was snapshot is
therefore not a preference; it is the definition of the field.

---

## 2. Provider comparison (the four officially confirmed candidates)

### 2.1 Comparison table

| Provider | Documented PIT history start | Look-ahead handling | Coverage of requested fields | Trial/sample WITHOUT login or payment | Redistribution/licensing caveats |
|---|---|---|---|---|---|
| **FactSet Estimates Point-in-Time Consensus** | 2009-12, daily local-midnight snapshots, intraday 3× refresh `[established]` — <https://insight.factset.com/resources/at-a-glance-factset-estimates-point-in-time-consensus> · <https://www.factset.com/marketplace/catalog/product/factset-estimates-point-in-time-consensus> | Dedicated product design goal: "removes any aspect of look-ahead bias" `[established]` | Full estimates suite (FY1–FY3 EPS, LTG, estimate counts, currency, basis) — field-level detail `[not verified]`; PIT product exists precisely for this field set | **No self-serve.** Sales contact only (`sales@factset.com`); no trial without engagement `[verified]` (decision doc §행동) | Enterprise terms; public redistribution of derived values requires explicit grant — must be asked in writing `[established]` (decision doc §4) |
| **S&P Capital IQ Estimates (incl. Estimates Snapshot)** | Estimates detail: **1999 North America / 1996 ex-NA** `[verified]` — platform brochure <https://s38328.pcdn.co/wp-content/uploads/sp-global-capital-iq-platform-brochure.pdf>; dataset page: "History Initiated 1996", 60,000+ companies, global `[verified]` — <https://www.marketplace.spglobal.com/en/datasets/s-p-capital-iq-estimates-(1)> | **Estimates Snapshot** dataset (Xpressfeed/Snowflake, launched late 2025) = "a true point-in-time view of global consensus data for all periodic and non-periodic items, capturing exactly what was in the dataset as of a given date" `[verified]` — <https://www.linkedin.com/posts/s%26p-global-market-intelligence_today-we-are-pleased-to-announce-the-launch-activity-7366137486844112896-eNJN>; `spEffectiveDate`/`spToDate` columns `[established]` (decision doc) | 40+ estimate measures incl. EPS/revenue/EBITDA; 19,000+ active companies, 670+ contributors `[verified]` (brochure). Field-level FY1–FY3/LTG/analyst-count detail `[not verified]` | No self-serve; Marketplace lists the dataset but the page is a login-walled SPA (direct fetch returned shell only) `[verified]`; platform access via Capital IQ Pro contract | Enterprise contract; S&P Marketplace terms apply; derived-value publication must be contractually cleared `[not verified]` |
| **LSEG I/B/E/S** | **Summary History = monthly consensus snapshots; US since 1976, international since 1987** `[verified]` — <https://libguides.vu.nl/finding-data/ibes>; canonical guide: <https://www.library.kent.edu/files/IBES_Summary_History_User_Guide_December_2009.pdf>; LSEG Quant Analytics: end-of-day consensus back to 2001 `[verified]` — <https://www.lseg.com/content/dam/data-analytics/en_us/documents/brochures/data-for-quant-research.pdf> | Monthly snapshots are inherently as-was (not restated) `[verified]` (VU guide wording); API-level arbitrary-date estimates retrieval: DataScope Select user guide documents estimates with fiscal-year translation by report date `[partially verified]` — <https://developers.lseg.com/content/dam/devportal/api-families/datascope-select/datascope-select-rest-api/documentation/overview-and-concepts/dss_14_5_user_guide.pdf>; the exact "Historic Estimates Snapshot" feature name remains `[not verified]` | I/B/E/S covers EPS, revenue, cash flow, **long-term growth projections** `[verified]` (VU Workspace guide: <https://libguides.vu.nl/finding-data/LSEG_Workspace>); summary fields incl. mean/median, # analysts, per-currency values; unadjusted Summary History file is EPS-only `[established]` (WRDS note, decision doc) | No self-serve; Workspace/Datastream/DataScope contracts only | Academic access (WRDS) forbids commercial redistribution `[established]` (decision doc §4); enterprise terms separate |
| **Intrinio (Zacks-sourced estimates)** | "History 20+ years" on the Zacks EPS estimates tier `[verified]` — <https://intrinio.com/pricing>; product page: EPS estimates incl. **Long-Term Growth** consensus, high/low, mean/median, **number of estimates** `[verified]` — <https://intrinio.com/products/eps-estimates>; API fields include "long-term growth mean estimate − 30/60/90 Days Ago" `[verified]` (search-indexed docs) — <https://docs.intrinio.com/documentation/web_api/get_zacks_eps_estimates_v2> | As-of/history retrieval parameter `[not verified]` (docs page is JS-rendered on direct fetch); the −30/60/90-days-ago fields prove stored revision history, not arbitrary-date retrieval | FY1–FY3 mean EPS, LTG, estimate counts, high/low — listed on product/pricing pages `[verified]`; currency/basis metadata `[not verified]` | **14-day trial exists but requires account creation** ("create an account … Start Trial … API keys within minutes") `[verified]` — <https://intrinio.com/blog/budget-friendly-data-for-your-business> — so it is owner-only, not usable under this mission's constraint; paid plans from ~$100–333/mo `[verified]` (blog + <https://intrinio.com/pricing>) | Enterprise feed terms; S3/Snowflake delivery; public redistribution of derived output `[not verified]` — ask in writing |

### 2.2 Minimal sample request texts (owner can send as-is)

**FactSet** — priority candidate (only vendor whose PIT product is documented as look-ahead-free
by design, and its 2009-12 start covers our full 2015–2023 window `[established]`):

> Subject: Evaluation sample request — Estimates Point-in-Time Consensus, US large caps 2015–2023
> We are evaluating the Estimates Point-in-Time Consensus for academic-grade backtesting of
> residual-income valuation models. Please quote:
> 1) a sample extract (CSV) for a fixed list of 30–50 US large-cap tickers (list attached) at ~12
>    annual/semiannual as-of dates between 2015-12-31 and 2023-06-30 (date list attached), fields:
>    FY1/FY2/FY3 mean EPS, long-term growth, number of estimates, consensus timestamp, currency,
>    adjustment basis (GAAP vs non-GAAP), each as the as-was daily snapshot at the as-of date;
> 2) annual cost for that scope; and
> 3) whether derived indicators computed from the sample may be published on a public website
>    (index/ratio form, not raw estimates), and under which license.

**S&P Capital IQ**:

> Subject: Evaluation sample request — Estimates Snapshot / Estimates detail, US large caps
> We are evaluating S&P Capital IQ Estimates (incl. the Estimates Snapshot dataset) for
> point-in-time consensus at historical dates. Please quote: 1) a sample for 30–50 US large-cap
> tickers at ~12 as-of dates 2015-2023 (FY1–FY3 EPS consensus, LTG, # estimates, as-of timestamp,
> currency, adjustment basis); 2) annual cost via Xpressfeed/Snowflake or Marketplace; 3) whether
> derived (non-raw) indicators may be published on a public website, and the license for that.

**LSEG I/B/E/S**:

> Subject: Evaluation sample request — I/B/E/S Summary History / estimates snapshot, US 2015–2023
> We need as-was monthly consensus snapshots (Summary History or equivalent) for 30–50 US
> large caps at ~12 month-ends 2015–2023: FY1/FY2/FY3 mean EPS, long-term growth, # of analysts,
> estimate timestamp, currency, adjustment basis. Please quote 1) a sample extract; 2) annual cost
> (Workspace / DataScope Select estimates API); 3) redistribution terms for derived indicators on
> a public website.

**Intrinio** (account-creation required — owner-only path):

> We are evaluating the Zacks-sourced EPS Estimates API for point-in-time historical consensus
> (FY1–FY3, LTG, # estimates) for 30–50 US large caps at ~12 as-of dates 2015–2023. Please confirm
> (1) an as-of/history retrieval parameter with true as-was values (not restated), (2) a 14-day
> evaluation key for that endpoint, (3) cost, and (4) whether derived indicators may be published
> on a public website.

---

## 3. Free / no-auth paths, ranked by measured expected yield

Measured this run on a 4-name probe (AAPL, JPM, KO, MSFT) against the 12-origin grid with a ±14-day
capture tolerance, via the Wayback CDX API (no login; method in §6). "Origins served" = fraction of
the 12 origins with at least one usable capture.

| Rank | Path | Measured yield (4-name probe) | Fields actually present in captured snapshots | Covers requested fields? | Cost & auth |
|---|---|---|---|---|---|
| 1 | **FactSet Earnings Insight public archive** (index-level) | **27/34 quarterly origins 2015–2023 served (79%)**; forward-12m EPS **dollar value in 2 of 27** issues (2016-12, 2017-03) — after 2017-03 the reports publish only forward P/E; growth rate + forward P/E in 27/27 `[measured]` — `source/100xFenok/data/computed/feno-rim-v2/x3-factset-earnings-insight.json` | S&P 500 aggregate forward-12m EPS ($), growth rate, fwd P/E, trailing P/E (8/27) | **No** — index-level only, no per-name, no analyst count, no FY1/FY2/FY3 split; $ EPS only at 2 origins | Free, no auth (public PDFs on advantage.factset.com) |
| 2 | **MarketWatch `analystestimates` pages via Wayback** | **6.5/12 avg** (AAPL 12, MSFT 7, JPM 5, KO 2); total captures AAPL 1216 / MSFT 368 / JPM 171 / KO 82 `[measured]` | 2017-01 AAPL capture `[verified]`: **FY1 + FY2 mean EPS (8.98 / 10.01), # of Estimates (44 / 39), high/low, coefficient of variance**; quarterly EPS too; analyst-recommendation counts; **no LTG, no FY3**; currency/basis not stated | **Partial** — FY1/FY2 mean EPS + analyst count at capture date; no FY3/LTG/basis | Free, no auth (archive.org) |
| 3 | **Zacks `detailed-estimates` pages via Wayback** | **2.0/12 avg** (AAPL 7, JPM 0, KO 1, MSFT 0) `[measured]` (prior probe: real tables in 3/4 probes `[established]` — `x3-zacks-probe.json`) | 2018-06 AAPL capture `[verified]`: consensus **EPS table per Current Qtr / Next Qtr / Current Year / Next Year with # of Estimates, high, low, YoY growth** (sales table shown in probe evidence); **no LTG** on captured page | **Partial** — FY1/FY2 + analyst count; no FY3/LTG/basis | Free, no auth (archive.org) |
| 4 | **MarketBeat `earnings` pages via Wayback** | **2.25/12 avg** (AAPL 4, JPM 2, KO 1, MSFT 2) `[measured]` | 2018-12 AAPL capture `[verified]`: **FY1–FY3 annual EPS consensus (2018 $11.22 / 2019 $13.04 / 2020 $14.47)** + quarterly detail with # of estimates, low/high/average; no LTG | **Best horizon coverage of the free tier** — FY1/FY2/FY3 + analyst count; no LTG/basis | Free, no auth (archive.org) |
| 5 | **Nasdaq `analyst-research` pages via Wayback** | **1.0/12 avg** (AAPL 3, JPM 0, KO 0, MSFT 1) `[measured]` | 2019-09 AAPL capture: recommendations/price-target content only; EPS estimate tables absent `[verified]` (JS-heavy pages archive poorly) | **No** (as captured) | Free, no auth — but yield too low |
| 6 | **StockAnalysis.com `statistics` via Wayback** | **0.5/12 avg** `[measured]` | 2021-02 AAPL capture lacked the analyst-estimates table entirely `[verified]` | **No** (site launched ~2020; captured pages miss the table) | Free, no auth — not viable |

**Reading the measurement.** Per-name variance is wide (2–12 of 12 on MarketWatch): coverage
scales with crawl attention, not with our needs. Two consequences: (i) the Dow-30 subset will
include KO-grade names (floor ≈ 2/12), so no free path reliably serves all 12 origins for all
names; (ii) the fix is cheap — **a CDX pre-screen of all 30–50 names takes ~30 s per name, no
login** (`http://web.archive.org/cdx/search/cdx?url=marketwatch.com/investing/stock/{SYM}/analystestimates&from=2014&to=2024&collapse=timestamp:8&filter=statuscode:200`), so the universe
feasibility matrix can be computed before any parsing work.

**Ranking verdict**: the free tier can produce a *partial, uneven* per-name shadow panel
(MarketWatch + MarketBeat + Zacks combined cover FY1/FY2 (+FY3 via MarketBeat) mean EPS and
analyst count for a subset of name×origin cells), plus an index-level cross-check (FactSet EI).
It cannot produce the full requested field set (no LTG, no explicit basis/currency, missing
cells) — which is precisely why the provider sample path in §2 exists as the complement.

**Account-required cheap tier (owner-only; listed for completeness, not usable under this
mission's no-login constraint)**: Intrinio Zacks API (20+ yr history; §2 row); Nasdaq Data Link
ZEE/ZET Zacks premium feeds `[verified]` — <https://data.nasdaq.com/databases/ZEE> ·
<https://data.nasdaq.com/databases/ZET>; FMP financial-estimates API (EPS forecasts; historical
depth and PIT-ness `[not verified]`) — <https://site.financialmodelingprep.com/developer/docs/stable/financial-estimates>;
Finnhub EPS-estimates API (estimate-vs-actual history; PIT-ness and free-tier depth `[not verified]`) —
<https://finnhub.io/docs/api/company-eps-estimates>.

**Licensing note for the archive path** `[not verified]`: extracting tables from Wayback captures
for personal research is unremarkable, but republication of derived public indicators built from
those tables should be checked against the underlying publishers' terms (MarketWatch/Zacks/
MarketBeat) before the public surface uses them.

---

## 4. Shadow-comparison protocol (when a sample arrives)

Scope: this section defines *how* the comparison runs, not *what decides* it. Decision thresholds
are **not** set here — the recovery criteria phase will pre-commit them (same pattern as
`r1-criteria-v2.json`: freeze before results, no post-hoc change; `prohibitions` list applies).

1. **Build the consensus-input panel.** For each origin o and firm f: FY1/FY2/FY3 mean EPS, LTG,
   analyst count, consensus timestamp, currency, adjustment basis. Keep the snapshot as-received;
   never fill missing cells with later values. Record coverage per cell (name×origin×field) so the
   panel's shape is auditable.
2. **Swap forecast input only.** Run the FL3 and GLS engines twice at each origin: (a) mechanical
   forecasts (R1 pipeline, frozen formulas), (b) consensus values (mapped to horizon τ by the R1
   FYE rule). Identical formulas, identical winsorization, identical scaling — only the forecast
   input vector changes. Same-origin requirement: consensus timestamp ≤ origin and ≥ previous
   origin (as-was discipline), else the cell is excluded and counted.
3. **Report the delta, not a verdict.** Per origin × firm: ΔV/P(consensus − mechanical), sign
   agreement, and a decomposition into (i) forecast-level delta (mean EPS at τ) and (ii)
   growth-path delta (LTG / FY3 slope). Aggregate per origin (mean |Δ|, sign-agreement rate,
   correlation of the two V/P columns). Publish the full delta panel as an artifact.
4. **Basis flag is first-class.** Analyst consensus is often non-GAAP/Street EPS while R1
   mechanical forecasts are GAAP-basis EDGAR constructs; a systematic basis gap would masquerade
   as a model delta. Every cell carries its basis; any origin×firm where bases differ is reported
   separately (basis-delta vs residual-delta), never blended.
5. **Restated-vs-PIT diagnostic (free, if the vendor supplies both).** If a sample includes both
   as-was and restated series, run both to quantify look-ahead contamination. Diagnostic only —
   no gate.
6. **Thresholds.** The recovery criteria pre-commit, before any sample processing: acceptable
   |ΔV/P| band, sign-agreement floor, coverage floor per origin, and the stop/continue rule if the
   mechanical forecasts deviate structurally from consensus (this is the decision the data serves;
   it is not made in this document).

---

## 5. Owner decision frame (one paragraph)

R0-CORRECTED has already decided the heuristic question — the corrected battery is negative and
the ordering "V/P adds nothing over B/P" is robust, so no analyst dataset can or should resurrect
the retired heuristic product; what the data serves is the **canonical path only**: R1's
mechanical forecasts are being validated on a unit-consistent EDGAR panel, and this plan's sample
(buying or free) buys the ability to answer the one question the canonical path cannot answer
from EDGAR alone — *is the mechanical forecast's divergence from market consensus the reason
canonical V/P underperforms, and in which component (level vs growth)?* Concretely, buying a PIT
consensus sample buys: a reference panel to shadow-swap into FL3/GLS at the same origins, a
restated-vs-PIT contamination measurement, and a defensible decomposition of the canonical path's
failure modes; it does **not** buy: a return-sign conclusion (the R0 structural limit binds R2/R3
— a current-membership basket cannot answer sign questions; a PIT membership list is a separate,
binding requirement regardless of consensus data), justification for re-listing the heuristic
product, or redistribution rights (derived public indicators need explicit license terms from
whichever vendor is used — ask in the sample request). Given R0's corrected outcome, the correct
first move is the zero-cost one in §3 (CDX pre-screen + free-tier shadow panel), and a paid sample
is warranted only if the free panel proves too sparse for the pre-committed coverage floor.

---

## 6. Provenance, methods, unverified items

- **Prior-work facts cited as `[established]`** (this run did not re-verify): FactSet PIT daily
  history from 2009-12 with look-ahead removal; Intrinio Zacks-sourced estimates with 20+ years;
  FactSet EI archive coverage 27/34 with F12M EPS in 2/27; Zacks archive 3/4 real tables; CapIQ
  `spEffectiveDate`/`spToDate`; WRDS academic-use restriction. Sources:
  `docs/analysis/yoo-rim-audit/RIM_DATA_PROVIDER_DECISION.md` and
  `source/100xFenok/data/computed/feno-rim-v2/x3-factset-earnings-insight.json` +
  `x3-zacks-probe.json`.
- **Density/field measurements `[measured]`/`[verified]` this run** (2026-08-07): Wayback CDX
  (`collapse=timestamp:8`, `filter=statuscode:200`, 2014–2024) for
  `marketwatch.com/investing/stock/{sym}/analystestimates`,
  `nasdaq.com/market-activity/stocks/{sym}/analyst-research`,
  `marketbeat.com/stocks/{EX}/{sym}/earnings/`, `stockanalysis.com/stocks/{sym}/statistics/`,
  `www.zacks.com/stock/quote/{sym}/detailed-estimates` on AAPL/JPM/KO/MSFT; field content verified
  by fetching archived snapshots (MW 2017-01-09, MB 2018-12-24, Zacks 2018-06-01, NDAQ 2019-09-13,
  SA 2021-02-27). Web searches (8 of ~12 budget) via the owner's tavily API; S&P Marketplace page
  is a JS SPA and returned a shell — its cells rely on search-indexed content.
- **Claims not verified this run**: FactSet PIT field-level detail; S&P Snapshot's exact history
  start and per-field schema; the literal "Historic Estimates Snapshot" feature name in LSEG docs
  (arbitrary-date retrieval is only partially evidenced via DataScope Select); Intrinio as-of
  retrieval parameter; currency/basis metadata for Intrinio and MarketWatch; FMP/Finnhub PIT-ness;
  redistribution terms of every provider; archive-extraction republication rights.
