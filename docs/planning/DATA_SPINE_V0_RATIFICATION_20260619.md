# Data Spine V0 Ratification

Date: 2026-06-19
Status: RATIFIED after peer review `fh-20260619-395-cc-138ca71d`.

## Scope

V0 freezes the Data Spine contract decisions that remained DRAFT after P1:

- per-field tolerance bands backed by measured spread distributions
- `return_3m` handling
- `public.report_metadata` live/dead ownership
- `ticker.ts` direct live-fetch status

Reproduce:

```sh
python3 scripts/audit-data-spine-v0.py
python3 scripts/audit-data-spine-v0.py --json
```

No authority/fallback order is changed in this document. Implemented order still
comes from `scripts/build-market-facts.py FIELD_SOURCE_POLICY[...]`.

## V0 Decisions

### `return_3m`

Decision: `authority_only_until_dedicated_fix`.

Serve `yf.history_1y` as the authority. Keep
`stockanalysis.detail.history` as provenance/cross-check context only; do not
use it to gate UI confidence until the formula/source mismatch is fixed.

Measured rationale:

- agreement: 8
- value drift: 223
- sign divergence: 243
- scale mismatch: 88
- value-drift spread: p50 6.4796pp, p90 29.721pp, p95 51.9813pp

This is not a silent authority/fallback change. The current authority is already
`yf.history_1y`; V0 only disables noisy cross-source confidence gating.

### `public.report_metadata`

Decision: `sunset_from_public_mirror`.

Owner for cleanup: 100x Data Spine cleanup. Deprecated source owner was the
100x Daily Wrap index agent.

Measured rationale:

- public-only files: `metadata/*.json` 52 + `reports-index.json`
- latest metadata id: `2026-01-28`
- latest title: `MarketLab Test Report - Auto Generated`
- latest summary: test automation placeholder text
- `reports-index.json` lists only 3 legacy `_data` files
- no root `data/` source and no active repo-local schedule

V0 action: remove or archive `metadata/*.json` and `reports-index.json` from
the served public DataPack in a cleanup slice. Reintroduce only with a root
source, publisher, owner, and Data Lab freshness check.

### `ticker.ts`

Decision: `sanctioned_live_gateway_exception`.

`100xfenok-next/src/lib/server/ticker.ts` remains the only product-runtime live
fetch exception. It uses Yahoo chart live quote data with a ticker-worker
fallback.

Contract requirements:

- return `source` and `fetchedAt`
- keep no-store and short timeout behavior
- do not expand direct provider fetches outside this gateway
- migrate to a Data Spine live-quote service only when that service exists

## Tolerance Matrix

`VD in/out` means value-drift rows inside/outside the V0 tolerance. Percentile
columns are p50/p90/p95 over the chosen metric. For percent-point fields the
metric is `max(candidate_values) - min(candidate_values)` in percentage points;
otherwise it is relative spread percent from the parity builder.

| Field | Metric | Tol | VD in/out | p50/p90/p95 | Quality | Rationale |
|---|---|---:|---:|---|---|---|
| `beta` | abs | 0.10 | n/a | n/a | no sample | keep 0.10 absolute guard |
| `change` | rel % | 0.5 | n/a | n/a | no sample | sign divergence blocks |
| `change_pct` | pp | 0.5 | n/a | n/a | no sample | sign divergence blocks |
| `dividend_yield` | pp | 0.5 | 6/4 (60.0%) | 0.345/13.537/42.0535 | low | flags distribution-basis outliers |
| `expense_ratio` | pp | 0.25 | n/a | n/a | no sample | all current rows agree |
| `forward_pe` | rel % | 5.0 | 0/1 (0.0%) | 40.4445/40.4445/40.4445 | low | single severe sample fails |
| `market_cap` | rel % | 5.0 | n/a | n/a | no sample | stale cleanup dominates |
| `previous_close` | rel % | 0.5 | 0/14 (0.0%) | 8.7683/24.0072/27.7277 | low | rare but severe drift fails |
| `price` | rel % | 0.5 | n/a | n/a | no sample | strict quote guard |
| `return_10y_avg` | pp | 1.0 | 108/5 (95.58%) | 0.325/0.7408/0.9626 | measured | p95 rounded to 1pp |
| `return_1m` | pp | 5.0 | 3381/295 (91.97%) | 0.8229/4.1225/6.6755 | measured | p90 rounded to 5pp |
| `return_1y` | pp | 10.0 | 1677/162 (91.19%) | 2.207/8.9/14.648 | measured | p90 rounded to 10pp |
| `return_3m` | authority-only | n/a | n/a | 6.4796/29.721/51.9813 | measured | comparison disabled until fix |
| `return_3y_avg` | pp | 5.0 | 3/15 (16.67%) | 22.1948/58.8509/76.0766 | low | leveraged-ETF outliers fail |
| `return_5y_avg` | pp | 1.25 | 568/35 (94.2%) | 0.467/1.0404/1.3029 | measured | p90 rounded to 1.25pp |
| `return_max_avg` | pp | 5.0 | 511/45 (91.91%) | 0.7855/4.1895/8.1205 | measured | p90 rounded to 5pp |
| `return_ytd` | pp | 7.0 | 2699/262 (91.15%) | 1.384/6.1271/12.2881 | measured | p90 rounded to 7pp |
| `total_assets` | rel % | 5.0 | 0/25 (0.0%) | 12.3883/37.3558/42.5527 | low | definition drift stays visible |
| `trailing_pe` | rel % | 5.0 | n/a | n/a | no sample | stale cleanup dominates |

## Backlog Status

The 8 direct-fetch backlog rows from P1 remain active. `DS-P1-001` is now a
sanctioned live gateway exception; the other rows remain migration, legacy
exception, or sunset candidates.

## Exit Criteria

- Peer review confirmed the spread distribution and pass/fail fractions.
- Status changed from REVIEW DRAFT to RATIFIED before push.
- Cleanup slice removes/sunsets `public.report_metadata`.
- Any future authority/fallback change is tagged `PROPOSED CHANGE`.
