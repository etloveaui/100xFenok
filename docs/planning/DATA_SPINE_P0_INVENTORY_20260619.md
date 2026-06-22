# Data Spine P0 Inventory

Date: 2026-06-19
Status: MEASURED baseline, still P0 until disagreement policy and backlog rows
are ratified.

## Purpose

This is the dataset-level inventory required by
`DESIGN_data_spine_program_20260619.md`.

The table answers:

`dataset -> emitter -> schedule -> asOf/freshness -> provenance -> consumers`

It is generated from local DataPack files and code references. Do not use the
older `data/README.md` headline counts as the current source of truth; that
README is now a descriptive source/update-policy hint only.

## Reproduce

```sh
python3 scripts/audit-data-spine-inventory.py
python3 scripts/audit-data-spine-inventory.py --json
```

The audit is read-only. It does not fetch providers and does not write data.

## Measured Totals

| Metric | Value |
|---|---:|
| Root JSON files | 15,451 |
| Public JSON files | 15,505 |
| Inventory datasets | 28 |
| Inventory row root sum | 15,451 |
| Inventory row public sum | 15,505 |

## Root/Public Mirror Delta

| Metric | Value |
|---|---:|
| Root-only JSON files | 0 |
| Public-only JSON files | 54 |

Public-only by area:

- `metadata`: 52
- `benchmarks`: 1 (`benchmarks/conversion_report.json`)
- `reports-index.json`: 1

These public-only files are served artifacts. `benchmarks/conversion_report.json`
is accounted for in the `benchmarks` row, while `metadata/*.json` and
`reports-index.json` are accounted for in `public.report_metadata`.

## StockAnalysis Checkpoint

| Metric | Value |
|---|---:|
| ETF universe | 5,280 |
| ETF candidate total | 5,347 |
| ETF detail files | 5,265 |
| ETF detail missing | 82 |
| ETF detail coverage | 98.47% |
| Primary StockAnalysis detail coverage | 85.64% |
| Incremental ETF selected | 1,793 |
| Pending ledger tracked | 95 |
| Pending ledger cooldown | 81 |
| Surface count | 25 |
| Surface rows | 14,143 |

## Dataset Inventory

`Runtime` counts direct app/admin runtime references. `Pipeline` counts build,
audit, converter, or legacy content references. `Workflows` counts matching
`.github/workflows` files, not external converter jobs.

| Dataset | Root | Public | Freshness/asOf | Emitter | Schedule | Runtime | Pipeline | Workflows |
|---|---:|---:|---|---|---|---:|---:|---:|
| `computed.market_facts` | 6,446 | 6,446 | 2026-06-19T10:07:33Z | `finalize-market-data.py` -> `build-market-facts.py` | post source refresh / finalize | 3 | 2 | 3 |
| `computed.market_data_audit` | 1 | 1 | 2026-06-19T10:08:03Z | `finalize-market-data.py` -> `audit-market-data.py` | post source refresh / finalize | 4 | 1 | 3 |
| `computed.market_source_parity` | 1 | 1 | 2026-06-19T10:08:03Z | `finalize-market-data.py` -> `build-market-source-parity.py` | post source refresh / finalize | 5 | 2 | 3 |
| `computed.signals` | 1 | 1 | 2026-06-19T12:57:56Z | `export-computed-signals.mjs` | post macro/sentiment refresh | 4 | 3 | 3 |
| `computed.stock_action` | 2 | 2 | 2026-06-19T12:57:56Z | `build-phase2-closeout-indexes.mjs` | post source refresh / closeout | 4 | 2 | 3 |
| `computed.market_structure` | 1 | 1 | 2026-06-19T12:57:56Z | `build-phase2-closeout-indexes.mjs` | post source refresh / closeout | 4 | 1 | 3 |
| `stockanalysis.index_and_universe` | 4 | 4 | 2026-06-19T10:07:21Z | `fetch-stockanalysis.py`, ETF QA/report scripts | weekly / on demand / incremental | 4 | 2 | 1 |
| `stockanalysis.etf_details` | 5,265 | 5,265 | 2026-06-19T08:06:51Z | `fetch-stockanalysis.py` | weekly / on demand / staged backfill | 4 | 3 | 1 |
| `stockanalysis.stock_overview` | 40 | 40 | 2026-06-18T02:43:16Z | `fetch-stockanalysis.py` | focused / on demand | 2 | 3 | 1 |
| `stockanalysis.financial_candidates` | 40 | 40 | 2026-06-18T02:43:14Z | `fetch-stockanalysis.py`, `probe-stockanalysis-financials.py` | focused / on demand | 2 | 2 | 1 |
| `stockanalysis.surfaces` | 27 | 27 | 2026-06-19 | `fetch-stockanalysis.py`, surface consumer QA | surface refresh / on demand | 8 | 3 | 1 |
| `stockanalysis.backfill_ops` | 18 | 18 | 2026-06-19T10:08:10Z | `fetch-stockanalysis.py`, history-gap report | staged backfill / preflight / incremental | 3 | 3 | 1 |
| `yf.finance` | 1,820 | 1,820 | 2026-06-13T23:22:30Z | `fetch-yf-finance.py`, `rebuild-yf-finance-summary.py` | weekly / on demand | 3 | 8 | 2 |
| `yf.quarter_closes` | 1 | 1 | 2026-06-14T00:02:42Z | `build-quarter-closes.py` | 13F enrichment support / on demand | 0 | 5 | 2 |
| `global_scouter.core_and_detail` | 1,075 | 1,075 | 2026-06-19T10:54:18Z | converter publish, `build-stocks-analyzer.mjs`, `build-revision-movers.mjs` | on demand / workbook publish | 24 | 8 | 1 |
| `global_scouter.raw` | 9 | 9 | 2026-06-14T18:51:29Z | converter publish | on demand / workbook publish | 1 | 1 | 1 |
| `slickcharts.indexes_and_stocks` | 569 | 569 | 2026-06-19T10:54:18Z | `scripts/scrapers/*.py`, `build-slickcharts-discovery.mjs` | daily / weekly / monthly by scraper | 10 | 10 | 6 |
| `sec_13f` | 78 | 78 | 2026-06-19T10:54:17Z | 13F converter, `build-13f-*.mjs`, `build-guru-holders-index.mjs` | quarterly after filings / enrichment rebuilds | 28 | 10 | 1 |
| `benchmarks` | 8 | 9 | 2026-06-15 | benchmark converter | weekly, external converter-driven | 32 | 2 | 0 |
| `damodaran` | 8 | 8 | 2026-06-19T10:54:18Z | Damodaran converter, `build-industry-benchmarks.mjs` | yearly / ERP interim | 10 | 2 | 1 |
| `macro` | 10 | 10 | 2026-06-19T12:16:46Z | FRED/FDIC/OECD/PMI/stablecoin/TGA fetch or converter pipeline | daily / weekly / monthly / quarterly | 21 | 6 | 6 |
| `sentiment` | 14 | 14 | 2026-06-18 | `fetch-sentiment.mjs` | daily / weekly | 121 | 18 | 1 |
| `calendar` | 3 | 3 | 2026-06-19T10:54:27Z | calendar mirror, `build-calendar-prev.mjs` | daily / on edit | 3 | 1 | 1 |
| `yardney` | 1 | 1 | 2026-06-05 | Yardeni workbook converter | weekly, external converter-driven | 2 | 0 | 0 |
| `indices` | 3 | 3 | 2026-06-18 | manual/static index snapshots | manual, no repo cron | 7 | 0 | 0 |
| `admin.manifests` | 3 | 3 | 2026-06-19T12:57:56Z | `build-phase2-closeout-indexes.mjs`, `generate-stock-field-usage-manifest.mjs` | post source refresh / closeout | 1 | 2 | 2 |
| `catalog.manifest_and_schemas` | 3 | 3 | 2026-06-19T12:57:58Z | manual schema maintenance, `update-manifest.py` | post source refresh / schema update | 7 | 3 | 3 |
| `public.report_metadata` | 0 | 53 | 2026-01-28 (수) | 100x Daily Wrap index agent / report publication metadata | on report publish / manual or agent-driven | 8 | 2 | 0 |

## Workflow Evidence

Important caveat: workflow matching is repo-local only. Some datasets are
converter-driven outside this repo and legitimately show zero matching workflow
files here.

- Multi-area workflow: `.github/workflows/build-stocks-analyzer.yml` emits or
  refreshes Global Scouter derived indexes, 13F enrichment/indexes, Damodaran
  `industry_benchmarks`, SlickCharts `discovery-summary`, and Calendar previous
  values.
- No repo-local workflow writers:
  - `benchmarks`: external benchmark converter, public mirror has one
    additional `conversion_report.json`.
  - `yardney`: external Yardeni workbook converter.
  - `indices`: manual/static snapshots.
  - `public.report_metadata`: report publication metadata; no repo-local cron.
- Direct scheduled writers:
  - `stockanalysis/*`: `.github/workflows/fetch-stockanalysis.yml`.
  - `yf/*`: `.github/workflows/fetch-yf-finance.yml`, plus StockAnalysis
    fallback mirroring for selected ETF cases.
  - `slickcharts/*`: SlickCharts daily/weekly/monthly/history/symbol workflows.
  - `macro/*`: FRED/FDIC/DeFiLlama/TGA/Yahoo-ticker workflows plus converter
    lanes for activity surveys.
  - `sentiment/*`: `.github/workflows/fetch-sentiment.yml`.
  - `catalog.manifest_and_schemas`: manifest/schema updates through
    `update-manifest.yml` and adjacent source refresh workflows.

## Consumer Notes

- Every top-level data area has at least one measured runtime consumer in
  `100xfenok-next/src` or `admin`, except `yf.quarter_closes`, which is a
  pipeline enrichment dataset consumed by 13F/stock-action builders.
- `/api/data/atlas` is not a hidden data fetcher. It calls
  `getDataAtlas()` in `100xfenok-next/src/lib/server/data-loader.ts`, which
  composes `static-route-manifest` and the root data manifest into a catalog
  API. Classify it as metadata/catalog consumer, not as a source-specific
  dataset consumer.
- feno-data, feno-data-remote, and feno-value live in `claude-code-hub`; their
  references remain external/as-of evidence in `DESIGN_data_spine_program_20260619.md`.

## P0 Gaps Still Open

1. Continue closing direct provider fetch backlog rows:
   `ticker.ts` is ratified as the live gateway exception; `fetch-yf-finance-v0.py`
   is sunset; legacy `100x/daily-wrap/fetcher.py` and admin/IB GAS helpers still
   need one-by-one migrate / explicit-exception / sunset classification.
2. Promote this inventory into a v0 source contract only after P1 defines
   authority/fallback/tolerance/disagreement action per field.
3. Ratify ownership/update policy for public-only report metadata:
   `metadata/*.json` and `reports-index.json`.
4. Decide whether high-volume legacy HTML references under `100x/daily-wrap`
   should remain in runtime counts or move to a legacy-lane count in future
   inventory reports.
