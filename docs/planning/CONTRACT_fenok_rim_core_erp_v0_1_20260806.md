# CONTRACT — FENO RIM core ERP band (v0.1, 2026-08-06)

> Status: **NOT PROVEN — P2 stays NULL** (SPEC v3.0 §5). This document is the dated
> proof contract: what the repo holds today, which of the three proof requirements
> are met per market, the band construction that WOULD be proven, the replay recipe,
> and the gaps. Author: right-pane red team (read-only lane). Companion authority:
> `docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md` §5,
> `YOO_RIM_AUDIT_FINAL.md` §3. No product code, no data mutation, no commits
> performed beyond this file.

## 1. Series inventory (repo-held, source/100xFenok)

| Series | Market | Observations in file | Observed dates (first → last) | Per-observation first-knowable date? | Update cadence | Repo-held history (git) |
|---|---|---|---|---|---|---|
| `data/damodaran/erp.json` — country ERP snapshot (178 countries; `countries["United States"].equity_risk_premium` 0.0503; `countries["Korea"].equity_risk_premium` 0.0549077, `country_risk_premium` 0.0072077, rating Aa2) | US + KR (+176) | point-in-time snapshot | vintage `source_date: "April 1, 2026"`; `generated_at` 2026-07-27T08:28:39Z | NO per-country dates — document-level only (`source_date`, `generated_at`) | upstream quarterly/yearly; shadow workflow weekly (`fetch-damodaran-shadow.yml` cron `17 11 * * 6`) | 3 committed versions (06-29 add, 07-25, 07-27); exactly 1 with a recorded fetch receipt (`history.json observed_at` 2026-07-27T08:28:35.146Z, run 30249876677) |
| `data/damodaran/historical_erp.json` — annual implied ERP (66 rows 1960–2025; fields `tbond_rate` + `implied_erp_ddm` + `implied_erp_fcfe`; `scope: "US market historical implied ERP"`) | US only | 66 annual observations | 1960 → 2025 (year keys) | NO — year key + document-level `source_date: "January 2026"`; no per-year dates | upstream yearly; shadow weekly | 3 committed versions (same commits as erp.json) |
| `data/macro/fred-banking-daily.json` — `DGS10` (6,847 rows, 1999-03-22 → 2026-08-03), `IRLTLT01KRM156N` (309 rows, 2000-10-01 → 2026-06-01), `BAMLH0A0HYM2` | US (DGS10); KR (IRLTLT01KRM156N) — but these are **10Y sovereign yields (risk-free input, SPEC §4), not ERP** | daily rows | as above | NO per-row fields — rows are `{date, value}` only; file-level `fetched_at` present on 22/37 committed versions (from 07-14) | daily cron `0 7 * * *` UTC (`fetch-fred-banking.yml`) | 37 commits (07-06 → 08-05); 22/37 carry `fetched_at` == attempt-shard `observed_at`; KR series stale (ends 2026-06-01; monthly counterpart `fred-banking-monthly.json` not inspected [not verified]) |
| `data/benchmarks/*.json` (us/developed/emerging/msci/micro_sectors/us_sectors/summaries) | US/KR (msci.korea, emerging.kospi, micro_sectors.kosdaq_150) | rows `{date, px_last, best_eps, best_pe_ratio, px_to_book_ratio, roe}` | 2010-01-01 → 2026-07-31 | NO — value dates only | weekly (Bloomberg manual) | not ERP-bearing: recursive scan for risk/premium/erp/crp keys: 0 hits — **excluded as ERP candidates** |

## 2. Proof requirements — verdicts (SPEC v3.0 §5, per market)

| Req | US market | KR market |
|---|---|---|
| (1) same-market series | **PROVEN** — `historical_erp.json` is explicitly US-market implied ERP (`scope`/`description`); `erp.json us_erp` 0.0503 is US | **PROVEN** — `erp.json countries["Korea"]` is a KR-market ERP (composite incl. country risk); no other KR ERP series exists |
| (2) first-knowable date per observation, replayable from raw fetch history | **NOT PROVEN** — annual series is a wholesale import: 66 observations arrive in one fetch, one document-level `source_date` ("January 2026"); per-observation publication dates are not held. Weekly snapshot series: only 3 repo-held versions, 1 with an exact fetch receipt (07-27); 07-25 has commit-time proxy only; the 06-29 initial version predates the shadow workflow (`generated_at` 2026-06-05, no fetch evidence). Granularity is file-version, never observation-row | **NOT PROVEN** — KR exists only as a point-in-time snapshot; no KR ERP time series; same 3-version history as US; nothing per-observation |
| (3) stated country-risk combination rule, no Yoo discretion | **PROVEN** — rule: `ERP_US(t) = erp.json.us_erp` of the dated snapshot; no combination arithmetic; no discretion | **PROVEN** — rule: `ERP_KR(t) = erp.json.countries["Korea"].equity_risk_premium` of the SAME dated snapshot as the US base. Disclosed caveat: additive US+CRP (0.0503 + 0.0072077 = 0.0575) does NOT equal the producer's composite (0.0549) — the contract reads the producer's composite field, never additive arithmetic |

**Overall: NOT PROVEN.** No market today can supply a dated trailing-window ERP band whose observations each carry a replayable first-knowable date. Per §5, P2 publishes NULL. The trailing 10-year min/max of the dated Damodaran implied-ERP series remains a stress diagnostic only (never the public hull), as §5 states.

## 3. Band construction (target contract — takes effect when (2) becomes provable)

For market m at evaluation date t, with observation set O(t) = {snapshot s : first_knowable(s) ≤ t} drawn from repo-held dated Damodaran snapshots:

- **Window**: trailing W dated snapshots by first_knowable(s), W = 52 (one year of weekly shadow runs; window is stated in the artifact and fixed — not a search parameter). Until |O(t)| ≥ W, the band is NOT PROVEN for that market and the row stays NULL.
- **Endpoints rule**: `ERP_band(m,t) = [ min_v ∈ V(m,t), max_v ∈ V(m,t) ]` where V = {ERP_m(s) : s ∈ O(t) window}, ERP_US(s) = snapshot us_erp, ERP_KR(s) = snapshot `countries["Korea"].equity_risk_premium`. Min/max over the window; no percentiles, no smoothing, no fitted constants.
- **First-knowable date per snapshot**: `first_knowable(s) = observed_at` from `data/admin/damodaran/history.json` (or the matching attempt shard `observed_at` / `owner-guard.json fetched_at`) recorded at the commit that introduced snapshot s; where no receipt exists, the commit timestamp is an upper bound and the observation is flagged `first_knowable=commit_time_upper_bound` (never silently promoted).
- **Risk-free**: unchanged per §4 (sovereign 10Y: US DGS10, KR IRLTLT01KRM156N — dated, point-in-time; KR series staleness must be resolved before KR risk_free use [blocked: KR fred daily series ends 2026-06-01]).
- **Confidence**: row stays `confidence: UNVERIFIED` (§11) until Gate 4; the ERP band proof is necessary, not sufficient.

## 4. Replay recipe (hash-stable)

Inputs (all repo-held): `data/damodaran/erp.json` versions v0..vn (git history), `data/admin/damodaran/history.json`, `data/admin/damodaran/owner-guard.json` (fetched_at per version), `data/admin/data-supply-state/detection-attempts/damodaran.json` (observed_at per run), the snapshot metadata (`source_date`, `generated_at`).

Steps:
1. Enumerate committed versions of `data/damodaran/erp.json` (`git log --format='%h %ad' --date=iso -- data/damodaran/erp.json`), oldest → newest.
2. For each version, extract `us_erp`, `countries["Korea"].equity_risk_premium`, `metadata.source_date`, `metadata.generated_at`; bind `first_knowable` from the run receipts (history.json/index.json/attempt shard) recorded at that commit; fallback per §3 with explicit flag.
3. Filter to `first_knowable(s) ≤ t`; sort by first_knowable; take the trailing W; compute min/max per market.
4. Serialize the band record deterministically: `{schema_version, market, window, observations: [{vintage, source_date, first_knowable, erp}], low, high, construction: "trailing_min_max", producer: "Damodaran Online", producer_url}` — fixed key order, no timestamps outside the receipts, no locale-dependent formatting.
5. Assert: same inputs + same tool version ⇒ byte-identical artifact (hash-stable; test asserts equality over a re-run).

## 5. Gaps (why NOT PROVEN today, and the forward path)

1. **Observation count**: 3 Damodaran snapshot versions in repo (2 shadow runs: 07-25, 07-27; 1 pre-workflow import). Window W=52 unreachable; ~52 weekly runs from the shadow workflow would fill it (first reachable ≈ 2027-07).
2. **Receipt integrity**: `history.json` records `file_sha256` values that do not match any committed blob (all normalizations tested) [not verified — likely pre-normalization hashing]; receipts are not yet a trustworthy hash chain. Must be fixed before (2) can be claimed.
3. **Per-observation dates absent everywhere**: no candidate file carries per-row fetch timestamps; all granularity is file-version. The snapshot series is the only mechanism that yields per-observation dates (one per snapshot), which is why the contract is snapshot-based.
4. **KR series thin**: no KR ERP history; KR fred yield series stale (2026-06-01) with monthly counterpart uninspected [not verified].
5. **Annual series excluded from the hull by §5 itself** (stress diagnostic only) and unusable for per-observation first-knowable (wholesale import, one date for 66 observations).
6. **Benchmarks carry no ERP fields** (verified 0 hits) — excluded as candidates.

## 6. Sources

- `docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md` §5 (proof requirements), §3 (first_knowable_at semantics), §8/§11 (NULL, confidence)
- `docs/analysis/yoo-rim-audit/YOO_RIM_AUDIT_FINAL.md` §3 (ERP lattice verdicts: SPX/CCMP/RUT IDENTIFIED printed, NDX/SOX PROXY, KOSPI HAND_SET — all barred; nothing shipped feeds this contract)
- `source/100xFenok/data/damodaran/{erp.json, historical_erp.json, README.md, schema.json}`
- `source/100xFenok/data/macro/fred-banking-daily.json`
- `source/100xFenok/data/benchmarks/{README.md, schema.json, us.json, msci.json, emerging.json}`
- `source/100xFenok/.github/workflows/{fetch-damodaran-shadow.yml, fetch-fred-banking.yml}`
- `source/100xFenok/data/admin/damodaran/{history.json, owner-guard.json, index.json}`
- `source/100xFenok/data/admin/data-supply-state/detection-attempts/{damodaran.json, fred_banking.json}`
- `source/100xFenok/scripts/{fetch-fred-banking.mjs, fetch-damodaran-shadow.mjs}` (producers)
