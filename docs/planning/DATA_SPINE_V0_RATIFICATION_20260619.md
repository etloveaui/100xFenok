# Data Spine V0 Ratification

Date: 2026-06-19
Last revalidated: 2026-06-22
Status: RATIFIED after peer review `fh-20260619-395-cc-138ca71d`;
amended by consumer guard `fh-20260619-400-cc-800917b0`;
final KEEP decision from `fh-20260619-402-cc-b2fff276`.

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
python3 scripts/test_data_spine_policy.py
```

No authority/fallback order is changed in this document. Implemented order still
comes from `scripts/build-market-facts.py FIELD_SOURCE_POLICY[...]`.
Ratified tolerance/action constants live in `scripts/data_spine_policy.py` and
are consumed by both the P1 and V0 audits.

## V0 Decisions

### `return_3m`

Decision: `authority_only_until_dedicated_fix`.

Serve `yf.history_1y` as the authority. Keep
`stockanalysis.detail.history` as provenance/cross-check context only; do not
use it to gate UI confidence until the formula/source mismatch is fixed.

Measured rationale:

- agreement: 64
- value drift: 234
- sign divergence: 243
- scale mismatch: 88
- value-drift spread: p50 5.4861pp, p90 27.0997pp, p95 49.7901pp

This is not a silent authority/fallback change. The current authority is already
`yf.history_1y`; V0 only disables noisy cross-source confidence gating.

### `public.report_metadata`

Decision: `keep_intentional_placeholder`.

Owner: future automated report-publishing pipeline.

Measured rationale:

- public-only files: `metadata/*.json` 52 + `reports-index.json`
- latest metadata id: `2026-01-28`
- latest title: `MarketLab Test Report - Auto Generated`
- latest summary: test automation placeholder text
- `reports-index.json` lists only 3 legacy `_data` files
- no root `data/` source and no active repo-local schedule
- user confirmed this placeholder is intentional for a future fully automated
  report-publishing pipeline

Consumer guard overturned the original data-only sunset. Live consumers still
read the report browser metadata/index:

- `100x/100x-main.html:94-96`
- `100xfenok-next/public/100x/100x-main.html:94-96`
- `admin/design-lab/reports/v5-unified-premium.html:797-799`
- `100x/daily-wrap/daily-wrap-system/renderer.js:273-276`
- `100xfenok-next/src/generated/static-route-manifest.ts:21-32`, consumed by
  `src/lib/server/data-loader.ts:4,151-175`

V0 action: keep the files in place. Track 1 data-only cleanup is permanently
cancelled.

Deferred backlog: revive publishing only after the future automation pipeline
exists. At that point, add a root source, publisher, owner, and Data Lab
freshness check.

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
| `change` | rel % | 0.5 | 0/24 (0.0%) | 61.7027/81.9372/87.6869 | low | sign divergence blocks |
| `change_pct` | pp | 0.5 | 10/16 (38.46%) | 0.9176/4.6459/6.2418 | low | sign divergence blocks |
| `dividend_yield` | pp | 0.5 | 13/5 (72.22%) | 0.095/3.056/16.7055 | low | flags distribution-basis outliers |
| `expense_ratio` | pp | 0.25 | n/a | n/a | no sample | all current rows agree |
| `forward_pe` | rel % | 5.0 | 0/31 (0.0%) | 14.984/31.1475/33.0507 | measured | severe samples fail |
| `market_cap` | rel % | 5.0 | 0/3 (0.0%) | 14.4118/17.4611/17.8422 | low | stale cleanup dominates |
| `previous_close` | rel % | 0.5 | 0/18 (0.0%) | 7.7237/16.1968/17.3115 | low | rare but severe drift fails |
| `price` | rel % | 0.5 | 0/3 (0.0%) | 14.3731/14.4038/14.4077 | low | strict quote guard |
| `return_10y_avg` | pp | 1.0 | n/a | n/a | no sample | long-window CAGR guard |
| `return_1m` | pp | 5.0 | 42/16 (72.41%) | 2.479/9.4515/14.3029 | measured | short-window mismatches stay visible |
| `return_1y` | pp | 10.0 | 840/112 (88.24%) | 3.7169/11.4561/18.0544 | measured | formula/timing mismatches stay visible |
| `return_3m` | authority-only | n/a | n/a | 5.4861/27.0997/49.7901 | measured | comparison disabled until fix |
| `return_3y_avg` | pp | 5.0 | 10/35 (22.22%) | 8.7902/37.2336/53.4176 | measured | leveraged-ETF outliers fail |
| `return_5y_avg` | pp | 1.25 | 8/2 (80.0%) | 0.438/1.4146/1.6108 | low | long-window CAGR guard |
| `return_max_avg` | pp | 5.0 | n/a | n/a | no sample | MAX start-date differences stay visible |
| `return_ytd` | pp | 7.0 | 247/137 (64.32%) | 3.1002/17.9185/30.2721 | measured | formula/timing mismatches stay visible |
| `total_assets` | rel % | 5.0 | 0/35 (0.0%) | 10.2065/41.9737/46.8457 | measured | definition drift stays visible |
| `trailing_pe` | rel % | 5.0 | n/a | n/a | no sample | stale cleanup dominates |

## Backlog Status

The direct-fetch backlog rows from P1 remain active until closed one by one.
`DS-P1-001` is a sanctioned live gateway exception. `DS-P1-005` is closed as a
sunset path because `scripts/fetch-sentiment.mjs` and
`.github/workflows/fetch-sentiment.yml` now own VIX sentiment updates. The other
rows remain migration, legacy exception, or sunset candidates.

## Exit Criteria

- Peer review confirmed the spread distribution and pass/fail fractions.
- Status changed from REVIEW DRAFT to RATIFIED before push.
- `public.report_metadata` is retained as an intentional future-automation
  placeholder; data-only cleanup is cancelled.
- Any future authority/fallback change is tagged `PROPOSED CHANGE`.
