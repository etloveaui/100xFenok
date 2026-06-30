# Independent QA — 4-pane repair plan verification (FH-599)

## Current state vs. repair plan

The failure register (`docs/agent-work/fenok_edge_product_readiness_failure_register_20260629.md`) correctly resets the ladder and lists the five FAILs. However, the repair plan is only partially landed and one change would break the existing freshness gate.

## PASS/FAIL matrix (current state)

| Product axis | COLLECTED | NORMALIZED | JOINED | SCORED | PUBLIC | DAILY | GATED |
|---|---|---|---|---|---|---|---|
| **Active stock scoring chain (1,066)** | PASS | PASS | PASS | PASS | PASS | FAIL | FAIL |
| **Expanded stock candidates (112 gap)** | PASS | PASS | FAIL | FAIL | FAIL | FAIL | FAIL |
| **ETF scoring lane** | PASS | PASS | FAIL | FAIL | FAIL | FAIL | FAIL |
| **Taiwan current numerator** | PASS | PARTIAL | FAIL | FAIL | FAIL | FAIL | FAIL |
| **US daily edge flow proxy** | PASS | PASS | PASS | PASS | PARTIAL | FAIL | FAIL |
| **KR daily edge flow proxy** | PASS | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |

Notes:
- Active stock chain is public-scored but daily refresh and fail-closed readiness gate are not proven.
- Expanded stock candidates (`market_facts` stock=1,178) are not promoted into `fenok_signals` (gap 112).
- ETF candidates (`market_facts` ETF=5,301) are normalized but never joined/scored in `fenok_signals`.
- Taiwan source collection is active; normalization has a bridge but no `.TW`/`.TWO` market-scope handling (`2454.TW` is still `US_CLASS`/`us`).
- US flow proxy is scored for public US rows, but the source is 2026-06-26 (3 days stale) and no cron is installed.
- KR flow proxy is collected privately but never normalized/joined into `fenok_signals` (0/338 Korea rows have non-null flow proxies).

## Verified counts

- `fenok_signals.json`: 1,066 rows; all 11 signal axes non-null = 227/1,066 (21.3%).
- Korea rows with non-null `net_options/off_exchange/short_pressure` = 0/338.
- `market_facts/index.json`: 6,479 assets; stock=1,178, ETF=5,301.
- `fenok_signals.json` ETF rows = 0; `asset_type` field absent.
- `2454.TW` appears once in `fenok_signals.json` as `market_scope=us`, `market=US_CLASS`.
- Freshness gate PASSes on 2026-06-26 data with `max_calendar_age_days=4`.

## Wording still allowing paid-service false positives

1. `docs/agent-work/fenok_edge_global_market_source_plan_20260629.md:74`: "Taiwan is launch-ready as a no-key market" — this is collector-ready, not product-launch-ready. Must be reworded or it will be quoted as product readiness.
2. `docs/ACTIVE_TASKS.md:19-20`: "Phase A+B SHIPPED LIVE" without the adjacent failure-register context can be read as paid-service done. Keep the failure-register paragraph directly attached to any "shipped" claim.
3. Coverage index output still reports `combined_coverage.latest_available_kr_plus_us_flow = 925/1066 (86.77%)` under v0.1 schema. Even though caveats exist, the field name and percentage are exactly the false claim the failure register warns about.

## Critical implementation mismatch

- `scripts/build-fenok-edge-coverage-index.mjs` is already at `schema_version: fenok-edge-coverage-index/v0.2` with `active_scoring_universe`, `source_availability`, `public_scoring_readiness`, etc.
- `data/admin/fenok-edge-coverage-index.json` is still `v0.1` (generated 2026-06-29T13:03:12Z).
- `scripts/check-fenok-edge-freshness.mjs` hardcodes `schema_version must be fenok-edge-coverage-index/v0.1` and expects `index.universe`, `index.source_coverages`, and `index.combined_coverage`.

If the v0.2 builder is run, the output will upgrade to v0.2 and the freshness checker will immediately fail. The checker must be updated to v0.2 before the builder output is regenerated.

## Required stop rules (from failure register, verified as still needed)

1. Do not collect new data to hide a broken join/score/public chain.
2. Do not call a source `ready` without a `claim_scope`.
3. Do not use `1066` as a universal denominator; say `active_scoring_universe=1066`.
4. Do not count Taiwan in current coverage until Taiwan symbols are in the active scoring universe.
5. Do not imply ETF scoring exists until an ETF cohort appears in a public scoring output.
6. Do not close the work until public-facing proof and the failure gate both exist.
7. Do not regenerate `fenok-edge-coverage-index.json` with the v0.2 builder until `check-fenok-edge-freshness.mjs` is updated to read v0.2 schema.

## Exact evidence paths

- `docs/agent-work/fenok_edge_product_readiness_failure_register_20260629.md`
- `docs/agent-work/fenok_edge_global_market_source_plan_20260629.md:74`
- `docs/ACTIVE_TASKS.md:13-25`
- `docs/CHANGELOG.md:7-24`
- `source/100xFenok/scripts/build-fenok-edge-coverage-index.mjs:224`
- `source/100xFenok/data/admin/fenok-edge-coverage-index.json:2`
- `source/100xFenok/scripts/check-fenok-edge-freshness.mjs:40-42`
- `source/100xFenok/data/computed/fenok_signals.json`
- `source/100xFenok/data/computed/market_facts/index.json`
- `source/100xFenok/scripts/build-phase2-closeout-indexes.mjs:390,421-425`
