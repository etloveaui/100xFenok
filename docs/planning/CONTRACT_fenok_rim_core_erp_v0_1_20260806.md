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
| `data/macro/fred-banking-daily.json` — `DGS10` (6,847 rows, 1999-03-22 → 2026-08-03), `IRLTLT01KRM156N` (309 rows, 2000-10-01 → 2026-06-01), `BAMLH0A0HYM2` | US (DGS10); KR (IRLTLT01KRM156N) — but these are **10Y sovereign yields (risk-free input, SPEC §4), not ERP** | daily rows | as above | NO per-row fields — rows are `{date, value}` only; file-level `fetched_at` present on 22/37 committed versions (from 07-14) | daily cron `0 7 * * *` UTC (`fetch-fred-banking.yml`) | 37 commits (07-06 → 08-05); 22/37 carry `fetched_at` == attempt-shard `observed_at`; KR series ends 2026-06-01; `fred-banking-monthly.json` inspected 2026-08-06 and carries the identical series (309 rows, same 2000-10-01 → 2026-06-01 span) — not an alternative source, and the lag is this series' publication cadence (§5 gap 4) |
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

- **Window** (amended 2026-08-06, owner ruling): W = 52 is **52 point-in-time WEEKLY STATES, not 52 independent releases**. `ERP(week w) = the most recent OFFICIAL ERP published on or before week w`; the band is the min/max over the 52 weekly states. The **count of distinct official releases** inside the window is published separately, so nobody reads 52 weekly states as 52 observations. Until |states(t)| ≥ W, the band is NOT PROVEN for that market and the row stays NULL.
- **Endpoints rule**: `ERP_band(m,t) = [ min_v ∈ V(m,t), max_v ∈ V(m,t) ]` where V = {ERP_m(s) : s ∈ O(t) window}, ERP_US(s) = snapshot us_erp, ERP_KR(s) = snapshot `countries["Korea"].equity_risk_premium`. Min/max over the window; no percentiles, no smoothing, no fitted constants.
- **First-knowable date per observation** (amended 2026-08-06, owner ruling): for repo-fetched snapshots, `observed_at` from `data/admin/damodaran/history.json` (or the matching attempt shard `observed_at` / `owner-guard.json fetched_at`) at the commit that introduced the snapshot; where no receipt exists, the commit timestamp is an upper bound flagged `first_knowable=commit_time_upper_bound`. For RESTORED history (see §6), the priority order is: (1) the official file/archive of the time; (2) the official publication/update date; (3) where no official date exists, the EARLIEST valid web-archive **Memento-Datetime**. A Memento timestamp is a conservative UPPER BOUND on first-knowable — "it was public no later than this" — which delays availability rather than admitting look-ahead, so it cannot leak (§6).
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

**Receipt verification rule (resolved 2026-08-06).** A recorded `file_sha256` is
verified as `sha256(JSON.stringify(JSON.parse(file_bytes)))` — the compact
serialization of the parsed document, not the committed bytes. The producer
hashes the in-memory document (`scripts/fetch-damodaran-shadow.mjs:308`) while
the same document is written pretty-printed (two-space indent plus a trailing
newline), so a byte-level comparison necessarily fails and is not evidence of a
broken chain. Verified both ways on the 07-27 observation: `erp.json`
`86186864…9280` and `historical_erp.json` `3e55368e…540a` reproduce exactly
under the compact rule and match nothing under file-byte or pretty-print
hashing. Any receipt checker must apply this rule.

Known fragility of the rule: compact serialization depends on key insertion
order, which `JSON.parse` preserves from the file. A reformat that reorders keys
would break verification without changing any value. If receipts are ever
required to survive reformatting, the producer should hash canonicalized bytes
(sorted keys) and the change must be versioned, not applied retroactively.

## 5. Gaps (why NOT PROVEN today, and the forward path)

1. **Observation count** (amended 2026-08-06, owner ruling): 3 Damodaran snapshot versions in repo (2 shadow runs: 07-25, 07-27; 1 pre-workflow import). The forward path is no longer weekly accrual alone: past ERP is **restored** per the §6 priority order, and the W=52 weekly states are built from the restored official releases. The distinct-release count is published separately from the state count (§3, §6).
2. ~~**Receipt integrity**~~ — **CLOSED 2026-08-06, this was a verification defect, not a data defect.** The recorded hashes are correct and the chain is trustworthy; the earlier check compared against committed bytes while the producer hashes the compact serialization of the parsed document. Both files of the 07-27 observation reproduce exactly under the rule now stated in §4. Nothing needs fixing in the producer, and requirement (2) is no longer blocked by receipt integrity — it is blocked by observation count alone (gap 1).
3. **Per-observation dates absent everywhere**: no candidate file carries per-row fetch timestamps; all granularity is file-version. The snapshot series is the only mechanism that yields per-observation dates (one per snapshot), which is why the contract is snapshot-based.
4. **KR series thin**: no KR ERP history. The KR risk-free gap is now measured rather than assumed: `data/macro/fred-banking-monthly.json` carries the *same* `IRLTLT01KRM156N` series as the daily file — 309 rows, 2000-10-01 → 2026-06-01, identical end date. The monthly counterpart is therefore not an alternative source and the earlier `[not verified]` is discharged. A roughly two-month lag is the publication cadence of this OECD-sourced monthly series, not a stalled fetch, so the forward path is either an alternative dated KR 10Y source or an explicit point-in-time policy that admits the publication lag. Treating it as staleness to be "resolved" mis-states the problem.
5. **Annual series excluded from the hull by §5 itself** (stress diagnostic only) and unusable for per-observation first-knowable (wholesale import, one date for 66 observations).
6. **Benchmarks carry no ERP fields** (verified 0 hits) — excluded as candidates.

## 6. Owner ruling 2026-08-06 — restoration semantics (FROZEN)

> Frozen as of 2026-08-06, **before any ERP-bearing result is produced**. Not
> open for redesign. Authority: owner ruling relayed via the main handler.

**Restoration priority (for each past ERP observation).** Do not wait for
weekly accrual to fill the window; restore history in this order:

1. the official file/archive of the time;
2. the official publication/update date;
3. where no official date exists, the **earliest valid web-archive
   Memento-Datetime**.

**Memento-Datetime semantics.** The archive timestamp is NOT a claim about
exact first publication. It is a conservative **UPPER BOUND** on
first-knowable — "it was public no later than this". That delays availability
rather than admitting look-ahead, so it cannot leak: any evaluation uses an
observation only from a date by which it is *certainly* public, never earlier.

**W=52 corrected meaning.** W = 52 is 52 point-in-time WEEKLY STATES:
`ERP(week w) = the most recent OFFICIAL ERP published on or before week w`;
band = min/max over the states. The **count of distinct official releases**
must be published separately, so 52 states are never read as 52 observations
(§3).

**Per-market sources.**
- US: Damodaran monthly implied ERP series, restored — the **core** candidate.
- KR: Damodaran country ERP, the official publication of the time, restored as
  a **step function** (value constant between official releases).
- Kroll US ERP: an **independent benchmark only, never core**.
- The trailing 10-year min/max of the dated Damodaran implied-ERP series stays
  a **stress diagnostic** (§5 of SPEC v3.0), never the public hull.
- **Providers are never averaged or blended** — one core source per market,
  one benchmark at most, each reported separately.

**B2 / payout (deferred).** B2 is not deleted but is off the core path; B1 is
completed and validated first. payout gets its point-in-time first-knowable
check only when B2 is switched back on — the fail-closed guard
(`b2_admitted && payout_consumed !== true` throws) already enforces exactly
this. The ETF payout proxy is not used. No paid historical constituent data is
purchased at this stage. B1 is labelled **`Empirical Book Growth Residual
Income Model`** and must not claim clean-surplus reproduction.


## 7. Sources
- `docs/analysis/yoo-rim-audit/FENO_RIM_RECONSTRUCTION_SPEC_v3_0.md` §5 (proof requirements), §3 (first_knowable_at semantics), §8/§11 (NULL, confidence)
- `docs/analysis/yoo-rim-audit/YOO_RIM_AUDIT_FINAL.md` §3 (ERP lattice verdicts: SPX/CCMP/RUT IDENTIFIED printed, NDX/SOX PROXY, KOSPI HAND_SET — all barred; nothing shipped feeds this contract)
- `source/100xFenok/data/damodaran/{erp.json, historical_erp.json, README.md, schema.json}`
- `source/100xFenok/data/macro/fred-banking-daily.json`
- `source/100xFenok/data/benchmarks/{README.md, schema.json, us.json, msci.json, emerging.json}`
- `source/100xFenok/.github/workflows/{fetch-damodaran-shadow.yml, fetch-fred-banking.yml}`
- `source/100xFenok/data/admin/damodaran/{history.json, owner-guard.json, index.json}`
- `source/100xFenok/data/admin/data-supply-state/detection-attempts/{damodaran.json, fred_banking.json}`
- `source/100xFenok/scripts/{fetch-fred-banking.mjs, fetch-damodaran-shadow.mjs}` (producers)
