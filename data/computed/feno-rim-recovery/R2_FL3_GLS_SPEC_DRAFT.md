# R2 Spec Draft — FL3-V/P and GLS-ICC
> FENO RIM RECOVERY — literature spec sheet for the two canonical residual-income constructions (R2-A FL3-V/P, R2-B GLS-ICC). Research-only deliverable; no implementation intent. All citations are line numbers in the local extraction `.txt` files.
> 2026-08-07.

Sources used (all local):
- **GLS** = `source/100xFenok/data/edgar/literature/gebhardt-lee-swaminathan-2001-jar.txt` (Gebhardt, Lee & Swaminathan 2001, JAR, "Toward an Implied Cost of Capital"; 3511 lines)
- **LM** = `source/100xFenok/data/edgar/literature/li-mohanram-2014-rast.txt` (Li & Mohanram 2014, RAST, "Evaluating Cross-Sectional Forecasting Models for Implied Cost of Capital"; 2128 lines)
- **BR** = `source/100xFenok/data/edgar/literature/brunel-rim-stock-returns-fulltext.txt` (Haboub & Kartsaklas, "Residual Income Valuation and Stock Returns — Evidence from a Value-to-Price Investment Strategy", Brunel; 1428 lines)
- **AUDIT** = `docs/analysis/yoo-rim-audit/RIM_LITERATURE_REPLICATION_MATRIX.md` (93 lines)

Status conventions:
- `[AUTH]` — directly quotable from local primary text (line refs given).
- `[FL98-not-on-disk]` — the Frankel & Lee (1998) PDF is NOT in the local library; the piece rests on the owner directive and/or Brunel's secondary characterization only.
- `[DIRECTIVE]` — owner directive (R2 contract) choice, no primary-text anchor.
- `⚠ conflict` — local text contradicts or deviates from the owner-directive summary; details flagged inline and collected in the handoff reply.

---

## A. GLS-ICC spec from the actual GLS text

### A.1 The valuation equation as printed

GLS start from the DDM (GLS:456-460), then derive the RIM identity (GLS:485-493):

```
P_t = B_t + Σ_{i=1..∞} E_t[NI_{t+i} − r_e·B_{t+i−1}] / (1+r_e)^i
     = B_t + Σ_{i=1..∞} E_t[(ROE_{t+i} − r_e)·B_{t+i−1}] / (1+r_e)^i        (eq. 4)
```
with `B_t` = book value at time t, `E_t[.]` = expectation at t, `NI_{t+i}` = net income for t+i, `r_e` = cost of equity, `ROE_{t+i}` = after-tax return on book equity (GLS:496-505). Clean surplus is defined in footnote 14 (GLS:2797-2802): `b_t = b_{t−1} + NI_t − D_t` (all gains/losses affecting book in earnings; change in book = earnings minus net dividends).

The **finite-horizon estimate actually used** (GLS:560-566, eq. 5):
```
P_t = B_t + (FROE_{t+1} − r_e)/(1+r_e) · B_t
          + (FROE_{t+2} − r_e)/(1+r_e)^2 · B_{t+1} + TV                    (eq. 5)
```
Variable definitions (GLS:572-602):
- `B_t` = book value from the most recent financial statement ÷ shares outstanding in the current month from I/B/E/S.
- `FROE_{t+i}` = forecasted ROE for period t+i. For the first three years: `FROE_{t+i} = FEPSt+i / B_{t+i−1}`, where `FEPSt+i` is the I/B/E/S mean forecasted EPS for year t+i and `B_{t+i−1}` the book value per share for year t+i−1. Beyond year 3: linear interpolation to the industry median ROE.
- `B_{t+i} = B_{t+i−1} + FEPSt+i − FDPSt+i`, with `FDPSt+i` = forecasted dividend per share = `FEPSt+i · k` (current payout ratio).

**Terminal value (GLS:606-616, eq. 6):**
```
TV = Σ_{i=3}^{T−1} (FROE_{t+i} − r_e)/(1+r_e)^i · B_{t+i−1}
     + (FROE_{t+T} − r_e) / (r_e·(1+r_e)^{T−1}) · B_{t+T−1}               (eq. 6)
```
i.e., residual income for years 3..T−1 discounted year by year, plus a perpetuity of the **period-T residual income** (the present value of period-T residual income as a perpetuity; GLS:542-556). Footnote 16 (GLS:2816-2819): this does not mean earnings stop growing after T — it means incremental economic profits (from net new investments) after year T are zero; any post-T growth is value-neutral.

### A.2 Explicit-forecast horizon

- Two-stage approach (GLS:526-536): (1) forecast earnings **explicitly for the next three years**; (2) beyond year three, mean-revert the period t+3 ROE to the median industry ROE by period t+T.
- FY1/FY2: I/B/E/S mean one- and two-year-ahead EPS forecasts (`FEPSt+1`, `FEPSt+2`); FY3: `FEPSt+3 = FEPSt+2 · (1 + Ltg)` where Ltg = I/B/E/S long-term growth consensus (GLS:642-663). Pre-1981 (I/B/E/S did not report Ltg): composite growth implicit in FY1 and FY2 (footnote 19, GLS:2835-2838); when Ltg is missing, use the ratio FY2/FY1 and **eliminate firms with negative FY1 or FY2** (footnote 23, GLS:2862-2865).
- **T = 12 in the reported results** ("we forecast earnings up to 12 future years and estimate a terminal value TV for cash flows beyond year 12 (T=12)", GLS:621-623); robustness at T = 6, 9, 15, 18, 21 with "very similar" cross-sectional results (GLS:623-626).

### A.3 ROE fade rule

- "We forecast earnings beyond year three implicitly, by mean reverting the period t+3 ROE to the median industry ROE … by period t+T. The mean reversion is achieved through **simple linear interpolation between period t+3 ROE and the industry median ROE**" (GLS:526-541). Linear in ROE levels.
- **Target**: "To compute a target industry ROE, we group all stocks into the same **48 industry classifications as Fama and French (1997)**. The industry target ROE is a **moving median of past ROEs from all firms in the same industry**. We **exclude loss firms** on the basis that the population of profitable firms better reflects long-term industry equilibrium rates of returns. We use **at least five years, and up to ten years**, of past data to compute this median" (GLS:627-639). Footnote 18 (GLS:2829-2834): median chosen to control for outliers; using means "does not change the results appreciably."
- **Worked-example verification** (Appendix A GM, GLS:2591-2621; Appendix B JNJ, GLS:2627-2656): GM FROE path 0.397 (FY1), 0.345 (FY2), 0.289 (FY3), then 0.275, 0.261, … 0.160 in year 12, with target industry ROE 16%; JNJ same shape to 18%. The step from FY3 to target is exactly `FROE3 − (FROE3 − med)/9` per year for years 4–12 (9 equal steps; the median is reached exactly at year T=12). E.g., GM: 0.2893 → 0.160 over 9 steps ≈ −0.0144/yr ⇒ 0.2749, 0.2606, …, 0.1600 (table GLS:2610). So the fade occupies **years t+4 … t+12**, FROE3 stays as the year-3 forecast, and the target is attained at t+T.
- The appendix labels the target "Target ROE (industry avg.)" (GLS:2602, 2638) — a labeling inconsistency only; the text (GLS:532, 627-631) is unambiguous that the target is the **median**.
- Footnote 15 (GLS:2804-2815): GLS explicitly acknowledge fade rates are likely industry-specific but know of "no empirically implementable approaches" to estimate them, and impose constant (uniform-linear) mean reversion; measurement-error discussion in §4.3 (GLS:1617-1653: no industry- or firm-level adjustments to the ROE fade target; payout estimated from prior years' patterns, share repurchases excluded).

### A.4 Dividend/payout treatment in the clean-surplus roll-forward

- `k` = "actual dividends from the most recent fiscal year / earnings over the same time period" (GLS:714-719). Share repurchases **excluded** (GLS:719-726; caveat in §5.2, GLS:2087-2094: may understate actual payout of persistent repurchasers).
- **Negative-earnings rule**: "For firms experiencing negative earnings, we divide the dividends paid by (0.06·total assets) to derive an estimate of the payout ratio" (GLS:726-729). Footnote 20 (GLS:2839-2844): the long-run return on total assets in the US is ≈ 6%, so 6% of total assets proxies normal earnings.
- **Clamp**: "We assign payout ratios of less than zero (greater than one) a value of zero (one)" (GLS:730-731).
- Book roll-forward: `B_{t+1} = B_t + NI_{t+1}·(1 − k)` (GLS:732-736). The appendix computes per-share books exactly this way (GM: `22.437 = 17.01 + 6.75·(1−0.196)`, GLS:2604-2608).
- **Book-matching to forecast vintage** (GLS §2.5, 665-709): from the earnings-announcement month until four months after fiscal year end, a **synthetic book value** `B_t = B_{t−1} + EPS_t − D_t` is used; from the fourth month after FYE until the next forecast update, the actual Compustat book value is used.

### A.5 Solving procedure and risk premium output

- "We estimate the IRR for each firm at the end of **June each year** by substituting the forecasted future earnings, book values, and terminal values into equation (5) and solving the resulting **non-linear equation**" (GLS:802-805). `r_e` is the internal rate of return equating price to the RHS (GLS:151-155, 428-431).
- "We then subtract the **end-of-month yield on long-term (10-year) Treasury bonds** from the IRR measure to obtain an (annualized) implied risk premium" (GLS:806-810). The rf subtraction happens after solving; rf is not an input inside the model.

### A.6 Aggregation to industries/portfolios (what GLS actually does)

- **Industry level** (Table II, GLS:1183-1199): "We compute **equal-weighted average** risk premium for each industry group each year, and then average the annual cross-sectional means over time." Industries = Fama-French 1997 48 groups.
- **Market level** (GLS:1227-1241): "the market risk premia is an average of all the individual stock risk premia for a given year" — equal-weighted across stocks.
- **Portfolios** (Table III, GLS:1251-1257): firms sorted into **quintiles on their implied risk premium** as of June 30 each year; realized returns compared across quintiles.
- ⚠ conflict: GLS uses **equal weighting only**. There is **no market-cap weighting, no trimmed mean, and no pre-designated "primary"** anywhere in the paper — the owner directive's market-cap-weighted mean/median/trimmed index aggregation is a directive extension, not a GLS convention.

### A.7 Data requirements (paper's own variable names)

- Universe: all U.S. companies excluding ADRs at the intersection of (a) CRSP NYSE/AMEX return files and (b) merged COMPUSTAT annual industrial file (incl. PST, full coverage, research files); require book values, earnings, dividends, and long-term debt in COMPUSTAT; CRSP prices, volume, shares; **I/B/E/S one- and two-year-ahead EPS forecasts required** (GLS:770-798). Sample 1979-95, ~1,000-1,300 firms/yr.
- Inputs per firm-year: `Bt` (book per share, most recent financial statement ÷ I/B/E/S shares), `FEPSt+1`, `FEPSt+2`, `Ltg`, payout `k` (dividends/earnings, with 0.06·TA negative-earnings rule), industry classification (FF 1997, 48 groups), moving median industry ROE (5-10 yrs, loss firms excluded), current price, 10-year Treasury yield.
- GLS do **not** use analyst forecasts beyond FY3 and do **not** use any "other information" variable (unlike Dechow/Hutton/Sloan dynamics; cf. AUDIT:32, 64-66).

### A.8 Places GLS leaves a choice open (explicitly or by silence)

1. Forecast source — I/B/E/S means, but nothing pins the *provider*; any consensus EPS service is consistent with the mechanics.
2. Industry classification granularity — 48 FF industries used; the paper gives no rule for reclassification over time (point-in-time vintage is our problem).
3. Median window — "at least five, up to ten years" is a range; the exact window is a free choice (LM fixed it at 5, §B.2).
4. Median vs mean target — median used, means "do not change results appreciably" (fn 18).
5. `Ltg` for FY3 — the paper uses it, but flags missing-Ltg fallbacks (composite growth; drop negative FY1/FY2).
6. T — 12 primary, but 6/9/15/18/21 all defensible (GLS:623-626).
7. Fade rate — uniform linear imposed by necessity (fn 15); industry-specific rates explicitly acknowledged as unestimated.
8. Payout — trailing-year dividends/earnings chosen "due to practical problems" with buybacks (GLS:719-726); the negative-earnings denominator (0.06·TA) is a judgment constant.
9. Book-vintage matching window (synthetic clean-surplus book vs reported book; §2.5).
10. rf instrument — 10-year Treasury end-of-month used; no discussion of alternatives.
11. Sample date — end of June; price/forecast timing left to implementation (synthetic-book window already covers the earnings-announcement gap).

---

## B. FL3-V/P reconstruction spec (R2-A)

### B.0 Inventory — what we have authoritative text for vs not

| Piece of the FL3 construction | Status |
|---|---|
| FL98 used a residual income model with **analysts' forecasts** to estimate V; V/P predicts returns up to 3 years | [AUTH via BR:188-193]; FL98 primary [FL98-not-on-disk] |
| FL98's implementation was intentionally **simple**, based on analysts' forecasts, "future research may adopt different valuation approaches that refine the model parameters" | [AUTH via BR fn 6, BR:124-129] |
| FL98: price < $1 ⇒ unstable V/P, poor liquidity | [AUTH via BR fn 35, BR:617-619] |
| FL98 controlled for beta, size, B/M in return tests | [AUTH via BR:195-197, 741-748] — return-test design, NOT discount-rate construction |
| V = B0 + 3-year explicit forecast + payout + clean-surplus roll-forward + forecast ROE + residual income + terminal | Mechanics [AUTH from GLS eq. 5/6 structure]; the *specific FL98 3-period terminal* [FL98-not-on-disk] |
| FY3 handling — FL98 used analysts' FY3 (per audit matrix, AUDIT:25: "point-in-time 애널리스트 컨센서스 FY1~FY3 EPS") | [FL98-not-on-disk]; the audit itself states it did **not** collate against primary texts (AUDIT:76-78) |
| Cost of equity = FL98's **industry-specific risk approach** (FF classification, PIT risk-free, trailing industry risk premium, no per-stock fitted r) | [DIRECTIVE]; NOT in any local text — see B.4 ⚠ |
| Payout = PIT trailing common dividends / common earnings; negative-earnings rule | [AUTH: GLS:712-736; LM:1611-1614] |
| Mechanical FY1-FY3 forecasts (no analyst input, no invented LTG) | [AUTH for the mechanical *model*: LM RI model, LM:388-410; the R2 choice to use it for FY1-FY3 is [DIRECTIVE]] |
| BR's own V/P implementation | NOT FL98-style — see B.5 ⚠ |

**Brunel corroboration scope (explicit)**: BR corroborates only the *characterization* of FL98 (simple, analyst-forecast-based RIM; 3-year predictability; $1 price filter; beta/size/B-M risk controls). BR's own valuation (BR:378-498) is a Feltham-Ohlson linear-information model with SUR joint estimation — a different RIM family — and must NOT be used as a template for FL3 mechanics. BR also shows the FL98 conventions survived in later work: June portfolio formation (BR:624-628), six-month gap between FYE and portfolio date (BR:606-608), equal-weighted portfolio returns (BR:639-641).

### B.1 The reconstructed FL3-V/P construction

With FL98 absent, the reconstruction is: **GLS mechanics (eq. 5/6) with the explicit horizon cut at 3 years (T=3, no fade), forecast inputs mechanical, discount rate industry-level**. Equation (per GLS:564-566 with eq. 6 evaluated at T=3 — the inner sum is empty):

```
V_t = B_t + (FEPS_{t+1} − r·B_t)/(1+r) + (FEPS_{t+2} − r·B_{t+1})/(1+r)^2 + TV3
TV3 = (FROE_{t+3} − r)·B_{t+2} / (r·(1+r)^2)          [GLS eq. 6 at T=3, [AUTH-mechanics]]
V/P = V_t / P_t
```
where `FROE_{t+i} = FEPS_{t+i}/B_{t+i−1}` (GLS:580-590). Note the GLS exponent convention: with T=3 the perpetuity is discounted to period T−1 = 2, i.e., `r(1+r)^2` (see A.4/A.8 and the ⚠ below on LM's `(1+r)^12` variant).

### B.2 Clean-surplus roll-forward and payout

- Roll-forward: `B_{t+i} = B_{t+i−1} + FEPS_{t+i}·(1 − k)` (GLS:732-736; per-share, from current book `B_t` = most recent financial statement book ÷ current shares, GLS:572-576).
- Payout: `k = PIT trailing common dividends / common earnings` ([AUTH: GLS "actual dividends from the most recent fiscal year … by earnings over the same time period", 714-719; LM uses DVC/IB, LM:1611-1614]).
- **Negative-earnings rule (pre-committed)**: `k = D / (0.06 · TA)` with the [0,1] clamp (GLS:726-731). LM Appendix B states the same 6%-of-AT rule for negative IB (LM:1612-1614) but does **not** restate the clamp — the clamp is GLS-only; keep it ([AUTH GLS]).
- Buybacks excluded (GLS:719-726). Book-vintage matching: GLS's synthetic-book window (§2.5) is available for point-in-time fidelity; otherwise reported book with a lag (choice C10).

### B.3 Terminal convention options (FL3)

1. **GLS T=3 perpetuity** (recommended anchor, above): PV of year-3 residual income as a perpetuity, `TV3 = (FROE3 − r)B2/(r(1+r)^2)`. Textually exact evaluation of GLS eq. 6 at T=3.
2. **Fade-to-industry terminal**: GLS full mechanics (fade FROE3 → industry median by year 12, then perpetuity) — but this *is* the GLS-ICC construction; using it for FL3 makes FL3 ≡ GLS structure with an external r. Not FL98-like ([FL98-not-on-disk]).
3. **No-growth perpetuity of year-3 earnings** (`V = B0 + Σ… + FEPS3/(r(1+r)^2)`-style): common in simplified implementations; **no local text anchor** ([DIRECTIVE]-only; AUDIT:31 notes the earlier E2 used a no-growth perpetuity / 10-year fade sweep).
The 3-period convention itself matches the FL98-known horizon (BR:188-189: "up to three years") and the audit's description of the literature's FY1-FY3 consensus input (AUDIT:25).

### B.4 Industry-specific cost of equity — as far as local sources support

- Owner directive: "Frankel-Lee's industry-specific risk approach (FF industry classification, PIT risk-free, trailing-information industry risk premium, no per-stock fitted discount rates)".
- ⚠ conflict: **no local text describes an industry-specific, non-fitted discount rate for FL-style valuation.** GLS and LM both solve a *per-firm* r (GLS:802-805; LM:1603-1604); BR uses a **flat 12%** with robustness at 8-16% and CAPM/FF3 five-year rolling rates (BR:415-420). The FL98-specific construction is [FL98-not-on-disk]. The audit matrix's "literature = 기업별 위험 조정 (firm-specific risk adjustment)" claim (AUDIT:30, 56-58) is the audit's own summary and was not verified against primary texts (AUDIT:76-78).
- Local support that DOES exist for the directive's components:
  - **FF industry classification as the industry scheme**: GLS:627-629 (FF 1997, 48 groups), LM:1596-1598 (FF 1997), BR:445-446 (FF, 12 sectors). ✓ [AUTH]
  - **PIT risk-free**: GLS's 10-year Treasury, end-of-month, subtracted from the solved IRR (GLS:806-810); LM subtracts "the risk-free rate" from ICCs (LM:533-536) but never names the instrument. A PIT 10-year Treasury is the best-anchored choice. ✓ [AUTH-GLS]
  - **Trailing-information industry risk premium**: NO local estimator. GLS's industry premia (Table II) are *full-sample* time-series averages over 1979-95 (GLS:1185-1199), not point-in-time. Any trailing-window industry premium construction is [DIRECTIVE] + [FL98-not-on-disk].

### B.5 The mechanical forecast input (FY1-FY3)

- LM's **RI forecast model** (the only mechanical forecasting engine with a full spec on disk): `E_{t+τ} = χ0 + χ1·NegE_t + χ2·E_t + χ3·NegE_t·E_t + χ4·B_t + χ5·TACC_t` (LM:402, eq. 7), derived from Feltham-Ohlson dynamics (LM:376-400). Estimation: cross-sectional, previous **ten years** of data per horizon, strictly out-of-sample, as of June 30, **per-share**, earnings = income before special and extraordinary items, all variables winsorized annually at the 1st/99th percentiles (LM:427-457). Coefficients reported in LM Table 1 Panel C (LM:1655-1661). TACC = total accruals (Richardson et al. 2005) as the capx proxy (LM:392-396).
- GLS's own FY3 is analyst-Ltg-based (`FEPSt+3 = FEPSt+2(1+Ltg)`, GLS:656-658); ⚠ conflict: the directive's "FY3 uses the mechanical RI forecast directly (no invented LTG)" replaces that rule — a deliberate deviation from GLS (and from FL98's analyst-based FY3 [FL98-not-on-disk]). LM's ICCGLS precedent is the closest local analog: "We depart from GLS by using the model forecasts explicitly for years 1 through 5 and then applying ROE convergence" (LM:1614-1615) — LM used model forecasts for years 1-5, not only FY3.

---

## C. OPEN CHOICES — to be pre-committed in the R2 criteria freeze

Each item is one degree of freedom (one free parameter or one rule). Handler must fix each before implementation; the recommended anchor from the local texts is stated after each.

1. **FY1/FY2/FY3 forecast source (R2-B and FL3)**: mechanical RI model (LM:402) vs analyst consensus (GLS:644-658). Anchor: mechanical RI model; if used, pre-commit the exact spec — per-share, 10-year estimation window, June-30 vintage, IB (before special/extraordinary), 1%/99% winsorization, TACC = total accruals, missing AC/TACC set to 0 (LM:427-474).
2. **FY3 construction when forecasts are model-based**: GLS's `FY2×(1+Ltg)` is excluded by directive ("no invented LTG"); the LM fallback rules (composite FY2/FY1 growth; drop negative FY1/FY2, GLS:2835-2838, 2862-2865) are the textual alternatives if a growth-linked FY3 is ever needed. Anchor: mechanical RI model direct at τ=3.
3. **Explicit-forecast window before fade (R2-B)**: 3 years (GLS) vs 5 years (LM:1614-1615). Anchor: 3 years (owner directive, and GLS's own two-stage design).
4. **Fade start year (R2-B)**: fade occupies years 4-12 (GLS; interpolation between FROE3 and the industry median, verified arithmetically in GLS:2610) vs years 6-12 (LM 5-year-explicit departure). Anchor: years 4-12.
5. **Fade target ROE definition**: ROE = IB/CEQ_lagged (LM:1600-1602) vs EPS/beginning book per share (GLS:580-590); target = median (GLS:627-631; fn 18) vs mean (GLS robustness); estimation window = 5 years (LM) vs 5-10 years (GLS); screen = positive earnings only (GLS) vs positive earnings AND non-negative book (LM:1596-1599). Anchor: median of IB/CEQ_lagged over a pre-committed window (5 vs 10 yrs is itself a sub-choice), positive-earnings screen, non-negative-book screen.
6. **Industry classification source/vintage**: FF 1997 48 groups (GLS/LM) vs FF divided into 12 sectors (BR:445-446); point-in-time industry definitions vs current vintage. Anchor: FF 1997, 48 groups, with a pre-committed PIT mapping.
7. **Fade horizon T (R2-B)**: 12 (primary in GLS and LM) vs GLS robustness set {6,9,15,18,21} (GLS:621-626). Anchor: T=12.
8. **Terminal-value formula (R2-B and FL3)**: GLS eq. 6 `(FROE_T − r)·B_{T−1}/(r(1+r)^{T−1})` (exponent T−1, GLS:610-616) vs LM's rendering `(eps12 − r·B11)/(r(1+r)^12)` (exponent T, LM:1605-1608) — the two sources differ by one discounting period; for FL3 additionally: T=3 perpetuity (eq. 6 at T=3) vs fade-then-perpetuity vs no-growth perpetuity. Anchor: GLS eq. 6 convention throughout; FL3 = T=3.
9. **Payout negative-earnings rule**: `k = D/(0.06·TA)` (GLS:726-729; LM:1612-1614) — pre-commit the 0.06 constant, the earnings definition (common dividends / income before extraordinary items), and whether the [0,1] clamp applies (GLS:730-731 — yes; LM silent). Anchor: GLS full rule including clamp.
10. **Book value & share count**: reported book at most recent FYE ÷ current shares (GLS:572-576) vs synthetic clean-surplus book in the announcement-to-4-months window (GLS:665-709); CEQ (common equity) as the book definition (LM:1601-1602). Anchor: CEQ ÷ shares with the synthetic-book window only if PIT fidelity is required.
11. **FL3 cost of equity (R2-A)**: industry-specific construction per directive — pre-commit (a) FF classification (choice 6), (b) PIT risk-free instrument (10-yr Treasury, GLS:806-810), (c) the trailing industry-risk-premium estimator, which has NO local anchor (GLS Table II premia are full-sample averages; BR uses flat 12%) — [FL98-not-on-disk]. No per-stock fitted r.
12. **Risk-free instrument for `firm_icc_minus_rf`**: 10-year Treasury, end-of-month (GLS:806-810) vs unspecified (LM:533-536). Anchor: 10-year Treasury as of the June-30 estimation date.
13. **Index aggregation**: equal-weighted industry/market means (GLS:1185-1199, 1227-1231) vs owner's market-cap-weighted mean/median/trimmed with a pre-designated primary — GLS text does not support cap-weighting; pre-commit the primary statistic and the trim band. Anchor per directive, but document that the literature convention is equal-weighted.
14. **Sample filters & estimation date**: June 30 (GLS:802; LM:450; BR:624-628); GLS requires FY1+FY2 forecasts (GLS:788-791); BR: TA ≥ $10M, price > $1, no negative book, no negative forecast, Dec FYE only (BR:596-608); FL98's $1 price filter corroborated (BR:617-619); LM winsorizes (LM:431). Pre-commit the universe screen (incl. negative-book/negative-forecast exclusion — LM's ICCGLS needs non-negative book for the fade target, and the RI forecast needs B_t).
15. **Numerical solver for R2-B**: per-firm IRR root-finding of eq. 5 (GLS:802-805) — pre-commit bracket/initial guess, convergence tolerance, non-convergence fallback (e.g., 0% vs 100% endpoints), and the cross-sectional percentile basis for `firm_icc_percentile`.

---

### Annex — worked-example arithmetic (verification anchors for the handler)

GM (GLS:2591-2621): B0=17.01, FY1=6.75, FY2=7.73, Ltg=7.3% ⇒ FY3=8.29; k=0.196; industry target ROE=0.160; solved r=13.94% ⇒ implied premium = 13.94% − 6.19% = 7.75% (10-yr yield, GLS:754-758). Book roll: 22.437 = 17.01 + 6.75·(1−0.196); 28.652 = 22.437 + 7.73·(1−0.196). ROE path: 0.397, 0.345, 0.289, then −0.0144/yr to 0.160 at year 12. JNJ (GLS:2627-2656): r=7.12%, premium 0.93%. These two rows are exact targets for solver validation.
