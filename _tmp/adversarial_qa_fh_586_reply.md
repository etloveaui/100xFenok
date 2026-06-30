# Independent Adversarial QA — Fenok Edge Product Chain

## Bottom line

The product is **not product-ready** for paid service. Collection works, but the public signal surface is missing Korea daily flow, all ETFs, all Taiwan names, and the freshness gate is green on stale data. The coverage index falsely claims 86.77% KR+US flow coverage when only **21.3%** of rows have all 11 signal axes populated.

## PASS/FAIL matrix

| Product axis | COLLECTED | NORMALIZED | JOINED | SCORED | PUBLIC | DAILY | GATED |
|---|---|---|---|---|---|---|---|
| **Stock / KR daily flow** | PASS | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| **US stock daily flow** | PASS | PASS | PASS | PASS | PARTIAL | PASS | PASS |
| **ETFs** | PASS | PASS | FAIL | FAIL | FAIL | FAIL | FAIL |
| **Taiwan** | PASS | FAIL | FAIL | FAIL | FAIL | FAIL | FAIL |
| **Coverage-index claims** | — | — | — | — | — | — | FAIL |

Key:
- **KR daily flow**: KRX raw collected, but `computed/fenok_flow_proxies.json` is US-only and `fenok_signals.json` Korea rows have `null` for all flow proxies.
- **ETFs**: `market_facts` has 5,301 ETFs, but `fenok_signals.json` has 0 ETF rows and no `asset_type` field.
- **Taiwan**: explicit_taiwan bucket = 0; `2454.TW` is misclassified as `US_CLASS`/`us`.
- **Coverage**: `latest_available_kr_plus_us_flow = 925/1066` adds raw KRX manifest rows to US FINRA rows, not derived signals.
- **Freshness**: gate passes with `max_calendar_age_days=4` on 2026-06-26 data; no cron installed.

## Verified counts

- `fenok_signals.json`: 1,066 rows; `us=637`, `korea=338`, `asia=91`.
- Korea rows with non-null `net_options_proxy` / `off_exchange_activity_proxy` / `short_pressure_proxy`: **0 / 338**.
- Rows with all 11 signals non-null: **227 / 1066 (21.3%)**.
- `fenok_flow_proxies.json`: 587 rows, all US, source_date `2026-06-26`.
- `market_facts/tickers`: 5,301 ETF + 1,178 stock files; Korea files source only `yf`, never `krx`.
- `2454.TW` in `fenok_signals.json`: count=1, `market_scope=us`, `market=US_CLASS`.

## Ranked fixes by product-trust impact

1. **Stop coverage index from counting raw KRX collection as product coverage** (`scripts/build-fenok-edge-coverage-index.mjs:188,313-318`). Current claim 86.77% is false; true all-axis coverage is 21.3%.
2. **Build KRX normalizer + Korea flow-proxy join** (`scripts/build-fenok-flow-proxies.mjs` US-only filter; `_private/admin/fenok-edge-korea/.../raw/` unreferenced). 338 Korea issuers currently have zero daily flow signals.
3. **Fix Taiwan ticker normalization** (`scripts/build-phase2-closeout-indexes.mjs:390,421-425`) and add Taiwan market scope/pipeline.
4. **Add ETFs to signal ladder** (`scripts/build-stocks-analyzer.mjs`, `build-phase2-closeout-indexes.mjs:905-907`, `build-fenok-signals.mjs:1070-1139`). Add `asset_type` to public signals.
5. **Harden freshness gate**: shorten 4-day window, require a newer source date from the latest run, and install daily cron for US + KR.

## Exact evidence paths

- `source/100xFenok/data/computed/fenok_signals.json` — 1066 rows, Korea flow nulls, 227 all-signal rows.
- `source/100xFenok/data/computed/fenok_flow_proxies.json` — 587 US rows, source_date 2026-06-26.
- `source/100xFenok/scripts/build-fenok-flow-proxies.mjs` — US-only universe filter.
- `source/100xFenok/scripts/build-fenok-signals.mjs` — joins flow proxies, no KRX input.
- `source/100xFenok/data/admin/fenok-edge-coverage-index.json` — `combined_coverage.latest_available_kr_plus_us_flow 925/1066`; `raw_policy.raw_rows_included=false`.
- `source/100xFenok/scripts/build-fenok-edge-coverage-index.mjs` — KRX proof + FINRA combined.
- `source/100xFenok/scripts/check-fenok-edge-freshness.mjs` — 4-day threshold.
- `source/100xFenok/scripts/build-phase2-closeout-indexes.mjs:390,421-425` — dotted ticker → `US_CLASS`.
- `source/100xFenok/data/computed/market_facts/tickers/XLK.json` — `asset_type: etf`; contrast with `fenok_signals.json`.
- `source/100xFenok/_private/admin/fenok-edge-korea/backfill/20260629/krx_backfill_20d_20260626/manifest.json` — raw collection not normalized.
- `source/100xFenok/data/admin/taiwan-data-bridge-index.json` — active collection, no scoring pipeline.
