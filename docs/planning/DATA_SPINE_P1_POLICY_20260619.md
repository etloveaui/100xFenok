# Data Spine P1 Policy

Date: 2026-06-19
Last revalidated: 2026-06-22
Status: PARTIALLY RATIFIED BY V0; remaining direct-fetch backlog stays open.

## Purpose

P1 turns the P0 inventory into a reproducible data trust contract. It does not
add UI features. It defines how duplicated provider values are selected,
compared, flagged, or blocked.

## Reproduce

```sh
python3 scripts/audit-data-spine-p1.py
python3 scripts/audit-data-spine-p1.py --json
python3 scripts/audit-data-spine-v0.py
python3 scripts/audit-data-spine-v0.py --json
python3 scripts/test_data_spine_policy.py
```

## Policy SSOT

| Policy layer | Source of truth | Status |
|---|---|---|
| authority/fallback order | `scripts/build-market-facts.py FIELD_SOURCE_POLICY` | implemented |
| tolerance/action policy | `scripts/data_spine_policy.py V0_FIELD_POLICY` | ratified by V0 |
| current disagreement counts | `data/computed/market_source_parity.json` + `scripts/audit-data-spine-p1.py` | generated snapshot |
| V0 decisions | `DATA_SPINE_V0_RATIFICATION_20260619.md` + `scripts/audit-data-spine-v0.py` | ratified |

Do not hand-edit field tolerance values in this document. Update
`scripts/data_spine_policy.py`, then rerun the commands above.

## Guardrails

- Implemented resolver order wins unless a future document marks a `PROPOSED CHANGE`.
- Every served value must expose source and freshness/provenance.
- Disagreement actions use the five parity categories:
  `agreement`, `value_drift`, `stale`, `sign_divergence`, `scale_mismatch`.
- Tolerance is per field. No global tolerance.
- `sign_divergence` and unresolved `scale_mismatch` are action-bearing, not
  informational only.
- `return_3m` is authority-only until a dedicated formula/source fix lands.

## Current Parity Snapshot

Measured from `data/computed/market_source_parity.json`, generated at
`2026-06-21T00:43:25Z`. These numbers are a snapshot; rerun the P1 audit after
each data refresh.

| Metric | Value |
|---|---:|
| Inspected ticker files | 6,445 |
| Fields with parity checks | 19 |
| Multi-candidate field rows | 26,629 |
| Agreement | 22,309 |
| Value drift | 1,841 |
| Stale | 1,953 |
| Sign divergence | 418 |
| Scale mismatch | 108 |

## V0-Resolved P1 Items

| Item | V0 decision | Evidence |
|---|---|---|
| field tolerance matrix | ratified; shared in `scripts/data_spine_policy.py` | `scripts/test_data_spine_policy.py` locks P1/V0 parity |
| `return_3m` | `authority_only_until_dedicated_fix` | `DATA_SPINE_V0_RATIFICATION_20260619.md` |
| `public.report_metadata` | keep intentional placeholder for future automated report publishing | `DATA_SPINE_V0_RATIFICATION_20260619.md` |
| `DS-P1-001` / `ticker.ts` | sanctioned product-runtime live quote gateway exception | `DATA_SPINE_V0_RATIFICATION_20260619.md` |

## Direct Fetch Backlog

`DS-P1-001` is ratified as a live gateway exception. The remaining rows are not
closed by V0 and stay as migration, legacy exception, or sunset candidates.

| ID | File | Provider | Current shape | Target | Priority |
|---|---|---|---|---|---|
| `DS-P1-001` | `100xfenok-next/src/lib/server/ticker.ts` | Yahoo query1 + ticker worker | product-runtime live fetch | ratified live-gateway exception until Data Spine live-quote service exists | P1-high |
| `DS-P1-002` | `100x/daily-wrap/fetcher.py` | Yahoo yfinance + FRED | legacy Daily Wrap publication fetcher | legacy-exception or migrate-to-contract | P2 |
| `DS-P1-003` | `admin/market-data/yahoo-quotes.gs` | Yahoo query1 | admin GAS quote helper | legacy-exception or contract route | P2 |
| `DS-P1-004` | `admin/market-radar/scripts/yahoo-quotes.gs` | Yahoo query1 + Stooq + GOOGLEFINANCE | market-radar GAS quote helper | legacy-exception or contract route | P2 |
| `DS-P1-005` | `admin/market-radar/scripts/vix.gs` | Yahoo query1 + GitHub contents API | market-radar VIX collector writing repo data | migrate-to-contract under sentiment collector or explicit admin exception | P1-medium |
| `DS-P1-006` | `ib/ib-helper/apps-script/yahoo-quotes.gs` | CNBC + Yahoo + Stooq + GOOGLEFINANCE | IB helper GAS live quote helper | legacy-exception until AA/IB route exists | P2 |
| `DS-P1-007` | `ib/ib-total-guide-calculator.html` | browser Yahoo/CORS proxy | legacy browser provider fetch | sunset or contract route | P2 |
| `DS-P1-008` | `scripts/fetch-yf-finance-v0.py` | Yahoo yfinance | old PoC collector | sunset/archive | P1-medium |

## Exit Criteria

- `scripts/audit-data-spine-p1.py` and `scripts/audit-data-spine-v0.py` consume
  the same shared policy constants.
- `scripts/test_data_spine_policy.py` passes and blocks future P1/V0 drift.
- Current parity counts regenerate from `market_source_parity.json`; they are not
  manually maintained here.
- Direct-fetch rows `DS-P1-002` through `DS-P1-008` remain tracked until each is
  migrated, explicitly excepted, or sunset.
