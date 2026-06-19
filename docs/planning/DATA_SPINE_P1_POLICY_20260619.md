# Data Spine P1 Policy Draft

Date: 2026-06-19
Status: DRAFT; authority/fallback mirrors implemented code, tolerance/action is
not ratified.

## Purpose

P1 turns the P0 inventory into a data trust contract. It does not add UI
features. It defines how duplicated provider values are selected, compared,
flagged, or blocked.

Reproduce:

```sh
python3 scripts/audit-data-spine-p1.py
python3 scripts/audit-data-spine-p1.py --json
```

## Guardrails

- Implemented resolver wins until v0 ratification.
- Authority and fallback must mirror `scripts/build-market-facts.py`.
- Disagreement actions use only the existing five parity categories:
  `agreement`, `value_drift`, `stale`, `sign_divergence`, `scale_mismatch`.
- Tolerance is per field. No global tolerance.
- Every served value must expose source and freshness/provenance.

## Parity Baseline

Measured from `data/computed/market_source_parity.json`.

| Metric | Value |
|---|---:|
| Inspected ticker files | 6,445 |
| Fields with parity checks | 19 |
| Multi-candidate field rows | 25,396 |
| Agreement | 12,354 |
| Value drift | 10,039 |
| Stale | 2,163 |
| Sign divergence | 716 |
| Scale mismatch | 124 |

## Diagnosis Actions

| Diagnosis | Action |
|---|---|
| `agreement` | Serve selected value. |
| `stale` | Prefer fresher candidate over static authority; keep stale source as warning/provenance. |
| `scale_mismatch` | Normalize units to `percent_points` before compare/serve; fail normalization if unresolved. |
| `sign_divergence` | Never silently pick; block confidence UI or require explicit authority tiebreak. |
| `value_drift` | Apply per-field tolerance; outside tolerance means warning or hold from confidence UI. |

## Field Matrix

`Authority` and `Fallback` are implemented. `Tolerance` and `Action` are P1 draft.
`A/D/S/Sign/Scale` are agreement, value drift, stale, sign divergence, scale
mismatch counts.

| Field | Authority | Fallback chain | Unit | Tolerance | A/D/S/Sign/Scale |
|---|---|---|---|---|---:|
| `beta` | `yf` ([ref](../../scripts/build-market-facts.py#L38)) | `yf -> stockanalysis.overview -> yf.stockanalysis_fallback.overview` | ratio | 0.10 absolute | 2/0/38/0/0 |
| `change` | `stockanalysis.quote` ([ref](../../scripts/build-market-facts.py#L31)) | `stockanalysis.quote -> yf -> yf.derived -> yf.stockanalysis_fallback.quote` | currency | same sign; <=0.5% of price | 1/0/38/1/0 |
| `change_pct` | `stockanalysis.quote` ([ref](../../scripts/build-market-facts.py#L32)) | `stockanalysis.quote -> yf -> yf.derived -> yf.stockanalysis_fallback.quote` | percent_points | same sign; <=0.5 pp | 1/0/38/1/0 |
| `dividend_yield` | `yf` ([ref](../../scripts/build-market-facts.py#L37)) | `yf -> stockanalysis.overview -> yf.stockanalysis_fallback.overview -> slickcharts` | percent_points | 25 bps | 398/10/351/0/0 |
| `expense_ratio` | `yf` ([ref](../../scripts/build-market-facts.py#L39)) | `yf -> stockanalysis.overview -> yf.stockanalysis_fallback.overview` | percent_points | 25 bps | 683/0/0/0/0 |
| `forward_pe` | `yf` ([ref](../../scripts/build-market-facts.py#L36)) | `yf -> stockanalysis.overview -> yf.stockanalysis_fallback.overview -> slickcharts` | ratio | 5% relative | 0/1/408/0/0 |
| `market_cap` | `yf` ([ref](../../scripts/build-market-facts.py#L33)) | `yf -> stockanalysis.overview -> slickcharts` | currency | 5% relative | 0/0/412/0/0 |
| `previous_close` | `yf` ([ref](../../scripts/build-market-facts.py#L30)) | `yf -> stockanalysis.quote -> yf.stockanalysis_fallback.quote` | currency | 0.5% relative | 709/14/67/0/0 |
| `price` | `yf` ([ref](../../scripts/build-market-facts.py#L29)) | `yf -> yf.fast_info -> stockanalysis.quote -> yf.stockanalysis_fallback.quote -> slickcharts` | currency | 0.5% relative | 0/0/412/0/0 |
| `return_10y_avg` | `stockanalysis.detail.performance` ([ref](../../scripts/build-market-facts.py#L68)) | `stockanalysis.detail.performance -> stockanalysis.etf_screener.performance -> stockanalysis.etf_universe.performance` | percent_points | 5 pp; sign blocks | 1024/113/0/1/0 |
| `return_1m` | `yf.history_1y` ([ref](../../scripts/build-market-facts.py#L40)) | `yf.history_1y -> stockanalysis.detail.performance -> stockanalysis.etf_screener.performance -> stockanalysis.etf_universe.performance` | percent_points | 2 pp; sign blocks | 647/3676/0/220/14 |
| `return_1y` | `yf.history_1y` ([ref](../../scripts/build-market-facts.py#L54)) | `yf.history_1y -> stockanalysis.detail.performance -> stockanalysis.etf_screener.performance -> stockanalysis.etf_universe.performance -> yf` | percent_points | 5 pp; sign blocks | 2367/1839/12/100/11 |
| `return_3m` | `yf.history_1y` ([ref](../../scripts/build-market-facts.py#L46)) | `yf.history_1y -> stockanalysis.detail.history` | percent_points | 3 pp; sign blocks | 8/223/0/243/88 |
| `return_3y_avg` | `yf` ([ref](../../scripts/build-market-facts.py#L61)) | `yf -> stockanalysis.detail.history` | percent_points | 5 pp; sign blocks | 0/18/0/1/0 |
| `return_5y_avg` | `yf` ([ref](../../scripts/build-market-facts.py#L62)) | `yf -> stockanalysis.detail.performance -> stockanalysis.etf_screener.performance -> stockanalysis.etf_universe.performance` | percent_points | 5 pp; sign blocks | 1262/603/0/13/1 |
| `return_max_avg` | `stockanalysis.detail.performance` ([ref](../../scripts/build-market-facts.py#L73)) | `stockanalysis.detail.performance -> stockanalysis.etf_screener.performance -> stockanalysis.etf_universe.performance` | percent_points | 5 pp; sign blocks | 3069/556/0/8/2 |
| `return_ytd` | `yf.history_1y` ([ref](../../scripts/build-market-facts.py#L47)) | `yf.history_1y -> stockanalysis.detail.performance -> stockanalysis.etf_screener.performance -> stockanalysis.etf_universe.performance -> yf` | percent_points | 3 pp; sign blocks | 1593/2961/0/128/8 |
| `total_assets` | `yf` ([ref](../../scripts/build-market-facts.py#L34)) | `yf -> stockanalysis.overview -> yf.stockanalysis_fallback.overview` | currency | 5% relative | 590/25/0/0/0 |
| `trailing_pe` | `yf` ([ref](../../scripts/build-market-facts.py#L35)) | `yf -> slickcharts` | ratio | 5% relative | 0/0/387/0/0 |

Hotspot: return fields dominate unresolved action load. Quote/profile fields are
mostly stale-source cleanup, not sign-risk.

## Direct Fetch Backlog Rows

| ID | File | Provider | Current shape | Target | Owner | Priority |
|---|---|---|---|---|---|---|
| `DS-P1-001` | `100xfenok-next/src/lib/server/ticker.ts` | Yahoo query1 + ticker worker | product-runtime live fetch | migrate-to-contract or explicit live-gateway exception | 100x Next runtime | P1-high |
| `DS-P1-002` | `100x/daily-wrap/fetcher.py` | Yahoo yfinance + FRED | legacy Daily Wrap publication fetcher | legacy-exception or migrate-to-contract | Daily Wrap legacy | P2 |
| `DS-P1-003` | `admin/market-data/yahoo-quotes.gs` | Yahoo query1 | admin GAS quote helper | legacy-exception or contract route | admin market-data | P2 |
| `DS-P1-004` | `admin/market-radar/scripts/yahoo-quotes.gs` | Yahoo query1 + Stooq + GOOGLEFINANCE | market-radar GAS quote helper | legacy-exception or contract route | admin market-radar | P2 |
| `DS-P1-005` | `admin/market-radar/scripts/vix.gs` | Yahoo query1 + GitHub contents API | market-radar VIX collector writing repo data | sentiment collector or admin exception | admin market-radar | P1-medium |
| `DS-P1-006` | `ib/ib-helper/apps-script/yahoo-quotes.gs` | CNBC + Yahoo + Stooq + GOOGLEFINANCE | IB helper GAS live quote helper | legacy-exception until AA/IB route exists | IB helper / AA bridge | P2 |
| `DS-P1-007` | `ib/ib-total-guide-calculator.html` | browser Yahoo/CORS proxy | legacy browser provider fetch | sunset or contract route | IB legacy docs | P2 |
| `DS-P1-008` | `scripts/fetch-yf-finance-v0.py` | Yahoo yfinance | old PoC collector | sunset/archive | data pipeline | P1-medium |

## Public Report Metadata

`public.report_metadata` is not ratified. Current asOf is `2026-01-28`.

Decision required before v0:

- If live: assign owner, publication command, freshness check, and Data Lab
  status.
- If dead: remove from public mirror or archive it outside served DataPack.

## P1 Exit Criteria

- This matrix is reviewed and either ratified or amended with explicit
  `PROPOSED CHANGE` rows.
- `sign_divergence` and unresolved `scale_mismatch` are action-bearing, not
  informational only.
- `DS-P1-001` has a live-gateway contract or migration path.
- `public.report_metadata` has owner/update policy or a sunset decision.
