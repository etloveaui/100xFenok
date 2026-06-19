# Data Lab DEV.md

> **Purpose**: Data Health Monitoring Dashboard
> **Location**: `admin/data-lab/`
> **Version**: 2.2.21 (ETF gap reason copy)
> **Redesign**: #168 (2026-01-20)

---

## Overview

| Item | Value |
|------|-------|
| Role | Data source health monitoring (admin only) |
| Target | 7 data folders via manifest.json |
| Architecture | Manifest-driven, config-only expansion |

---

## Architecture (v2.0)

```
admin/data-lab/
├── index.html                    (~100 lines - minimal shell)
├── app/
│   ├── dashboard.js              (main orchestrator)
│   ├── renderer.js               (UI rendering)
│   ├── ops-console.js            (read-only route/asset/freshness checks)
│   └── state-manager.js          (reactive state)
├── shared/
│   ├── config/
│   │   └── manifest-loader.js    (reads manifest.json + schemas)
│   ├── core/
│   │   ├── cache-manager.js      (3-tier caching)
│   │   ├── data-manager.js       (fetch with retry)
│   │   └── formatters.js         (number/date formatting)
│   ├── validators/
│   │   ├── schema-validator.js   (generic JSON validation)
│   │   └── freshness-checker.js  (update date checks)
│   └── ui/
│       └── status-card.js        (reusable status widget)
├── styles/
│   └── dashboard.css             (extracted styles)
└── index-legacy.html             (backup of v1.0, 1,716 lines)
```

---

## Data Flow

```
manifest.json → ManifestLoader → FreshnessChecker → StateManager → Renderer → UI
                     ↓
              schema.json (per folder)
                     ↓
              SchemaValidator → Status (🟢🟡🔴)
```

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Manifest-driven** | Reads `data/manifest.json` for data source discovery |
| **Config-only expansion** | Add new source with JSON only, no code changes |
| **Freshness signals** | 🟢 Fresh / 🟡 Stale / 🔴 Critical based on update frequency |
| **3-tier caching** | Memory → SessionStorage → Network |
| **Reactive state** | Observer pattern for automatic UI updates |
| **Market data audit** | Reads `data/computed/market_data_audit.json` for ETF backfill, market facts, and source parity |
| **StockAnalysis audit** | Reads `data/stockanalysis/index.json`, `coverage/etf_detail.json`, and `classification/latest.json` for ETF detail coverage, backfill, and leverage/inverse/single-stock classification visibility |
| **ETF universe snapshot** | Reads the ETF list API, `etf_universe.json`, `surfaces/new_etfs.json`, and `coverage/etf_detail.json` together so operators can see total ETF count, price/volume/holdings coverage, newest launches, and new-ETF detail gaps from live data |
| **ETF coverage gap drilldown** | Shows new-ETF/universe/screener missing counts and sample tickers from `coverage/etf_detail.json` |

---

## Adding New Data Source

**Zero code changes required!**

1. Add folder entry in `data/manifest.json`:
   ```json
   "new-source": {
     "version": "1.0.0",
     "updated": "2026-01-20",
     "update_frequency": "weekly",
     "source": "Source Name",
     "file_count": 5,
     "schema": true,
     "description": "Description here"
   }
   ```

2. Create `data/new-source/schema.json` (optional but recommended)

3. Dashboard auto-discovers and renders the new source

---

## Shared Modules (Valuation Lab Compatible)

| Module | Usage | Also in Valuation Lab |
|--------|-------|----------------------|
| `cache-manager.js` | 3-tier caching | ✅ (adapted) |
| `formatters.js` | Number/date formatting | ✅ (adapted) |
| `data-manager.js` | Fetch with retry | ✅ (adapted) |
| `status-card.js` | Status display | ⬜ (Data Lab only) |

---

## Freshness Thresholds

| Frequency | 🟢 Fresh | 🟡 Stale | 🔴 Critical |
|-----------|----------|----------|-------------|
| daily | ≤1 day | ≤3 days | >3 days |
| weekly | ≤7 days | ≤14 days | >14 days |
| monthly | ≤35 days | ≤60 days | >60 days |
| quarterly | ≤100 days | ≤150 days | >150 days |
| yearly | ≤400 days | ≤500 days | >500 days |

---

## Legacy Files

| File | Status | Purpose |
|------|--------|---------|
| `index-legacy.html` | Backup | Original 1,716-line monolithic version |
| `shared/validators.js` | Legacy | Old hardcoded validators (kept for reference) |
| `shared/data-lab-config.js` | Legacy | Old path config (kept for compatibility) |
| `shared/slickcharts-validator.js` | Legacy | Old SlickCharts validators |

---

## Operating Principles

- **Read-only**: No data modification
- **Validation-first**: Field/record change warnings
- **Separation**: Feature experiments in Valuation Lab, data monitoring in Data Lab
- **Incremental proof**: `data/stockanalysis/backfill/incremental_latest.json` is optional until the first scheduled/dispatch incremental ETF run. Data Lab fetches it only when audit says `proof_file_exists=true`, so missing proof renders as a neutral waiting state without console 404.
- **ETF queue visibility**: `data/stockanalysis/backfill/pending_ledger.json` is fetched directly for Admin-only drilldown rows. This shows pending/retry/failure tickers from the data refresh artifacts instead of static copy, including the earliest retry date, latest attempt date, and repeated-missing count.
- **ETF coverage proof**: `data/stockanalysis/coverage/etf_detail.json` is rebuilt from local files and uses the union of ETF universe, ETF screener, and new ETF launch rows as the candidate denominator.
- **ETF gap drilldown**: Data Lab reads `counts.missing_by_source` and `samples` from `coverage/etf_detail.json` so operators can see which new/listed ETFs still rely on fallback surfaces.
- **ETF universe snapshot**: Data Lab reads the ETF list API plus the full ETF universe and new-ETF surface, then joins those counts with `coverage/etf_detail.json`; the card must stay data-driven and must not use static launch counts.
- **ETF missing reasons**: `coverage/etf_detail.json` also exposes `missing_reason_summary` and `missing_status_summary`; Data Lab renders those as source-neutral Korean buckets (`ETF로 인식되지 않음`, `재시도 예약됨`, `다음 수집 후보`, `보조 가격 임시 적용`) while raw provider evidence remains in JSON. These are diagnostic categories, not a mutually exclusive partition; use `missing_detail_files` as the actual missing total.
- **Operator copy**: Provider-specific fallback labels are rendered as source-neutral auxiliary price/detail wording on the Data Lab surface; raw provider IDs stay in JSON only.
- **Surface consumers**: Data Lab reads `data/stockanalysis/surface_consumers.json` for public-route connection status instead of keeping the route map inside `renderer.js`. Keep the source file and public mirror byte-identical; `npm run qa:surface-consumers` verifies this against `surfaces/index.json` and active route/component files.
- **Update QA gate**: The StockAnalysis refresh workflow runs `qa:surface-consumers`, `qa:market-audit`, and `qa:copy` after generated data is rebuilt, so Data Lab structure, public labels, and active surface consumers fail before the data commit is pushed.
- **ETF API route smoke**: Ops Console probes `/api/data/stockanalysis/etf-universe` as JSON so the Admin surface catches route-level failures separately from static `etf_universe.json` freshness.

---

## Related Documents

- Manifest: `data/manifest.json`
- Schemas: `data/{folder}/schema.json`
- Planning: `docs/planning/data-lab-plan.md`
- BACKLOG: #168 Data Lab Redesign

---

## Changelog
| Version | Date | Changes |
|---------|------|---------|
| 2.2.21 | 2026-06-19 | Clarified ETF gap reason copy and separated missing samples into diagnostic buckets, with an explicit note that buckets can overlap |
| 2.2.20 | 2026-06-19 | Added Ops Console route smoke for the joined ETF list API |
| 2.2.19 | 2026-06-19 | Added ETF list API coverage metrics for price, volume, holdings, and screener-only rows |
| 2.2.18 | 2026-06-19 | Added Data Lab ETF universe/new-launch snapshot from live StockAnalysis files, including newest ETF rows and new-ETF detail gap counts |
| 2.2.17 | 2026-06-19 | Hardened `qa:surface-consumers` so every declared StockAnalysis consumer must map to an active route/component contract, including `/market/events` and `/stock/[ticker]` |
| 2.2.16 | 2026-06-19 | Wired StockAnalysis refresh CI to Data Lab UI QA gates (`qa:surface-consumers`, `qa:market-audit`, `qa:copy`) so generated data updates cannot silently regress admin labels or surface contracts |
| 2.2.15 | 2026-06-19 | Polished remaining Data Lab visible labels in mirror/usage and market-audit cards, and extended `qa:copy` to block the awkward `데이터 묶음` regression |
| 2.2.14 | 2026-06-19 | Added ETF missing-reason summary rendering so remaining uncovered details are separated into external classification mismatch, untracked, and retry-wait buckets |
| 2.2.13 | 2026-06-19 | Clarified ETF collection queue wording and added next-attempt dates for cooldown ledger rows so operators can see why missing ETF details are not retried immediately |
| 2.2.12 | 2026-06-19 | Added `surface_consumers.json` to Freshness Guard so missing/stale surface consumer maps are visible in Data Lab ops checks |
| 2.2.11 | 2026-06-19 | Moved StockAnalysis surface consumer map to `data/stockanalysis/surface_consumers.json` and added `qa:surface-consumers` drift gate |
| 2.2.10 | 2026-06-19 | Added StockAnalysis surface consumer check so Data Lab shows whether collected surface rows are connected to public routes |
| 2.2.9 | 2026-06-19 | Polished visible Data Lab operator copy for StockAnalysis catalog, freshness labels, and route-smoke labels while preserving raw JSON paths |
| 2.2.8 | 2026-06-19 | Neutralized visible ETF fallback, waiting-state, and source-parity wording while preserving raw provider evidence in JSON |
| 2.2.7 | 2026-06-19 | Added ETF coverage gap drilldown: new ETF/list/screener missing counts plus missing and auxiliary-fallback ticker chips linked to ETF detail pages |
| 2.2.6 | 2026-06-18 | Added ETF detail coverage proof from `coverage/etf_detail.json`; Data Lab now shows candidate total, covered detail files, primary-detail coverage, auxiliary fallback count, and missing detail count from the same generated contract |
| 2.2.5 | 2026-06-18 | Added ETF collection queue drilldown from `index.json`, `incremental_latest.json`, and `pending_ledger.json`; keep source `admin/data-lab/app/*` and public mirror aligned because `sync-static` copies source into public |
| 2.2.4 | 2026-06-18 | Removed the intentional legacy `/100xFenok/data/manifest.json` negative network probe from route smoke; workers.dev now uses base-path/root-manifest proof without console 404 noise |
| 2.2.3 | 2026-06-18 | Guarded optional incremental proof fetch behind `market_data_audit.incremental_etf.proof_file_exists` and added audit warn when proof exists but fetch index omits incremental selected count |
| 2.2.2 | 2026-06-18 | Added StockAnalysis surface catalog audit card from `data/stockanalysis/surfaces/index.json` so public Explore can remove catalog/coverage ops cards without losing visibility |
| 2.2.1 | 2026-06-18 | Added automatic ETF enrichment observation: audit status, incremental backfill proof file, auxiliary fallback counts, pending detail count, and market_facts fallback coverage |
| 2.2.0 | 2026-06-18 | Added ETF classification counts, latest StockAnalysis fetch index/backfill status, restored source-consistency detail in source, and freshness guards for classification/index/surface files |
| 2.1.0 | 2026-06-17 | Added market data audit cards and freshness guards for StockAnalysis ETF universe + computed market source parity |
| 2.0.1 | 2026-04-14 | Added `embed=1` shell mode to hide legacy header/footer inside Next.js iframe bridge (#269) |
| 2.0.0 | 2026-01-20 | Manifest-driven architecture, 94% code reduction (1,716→103 lines) |
| 1.1.0 | 2026-01-10 | SlickCharts integration (34 validators) |
| 1.0.0 | 2025-12-27 | Initial release (DEC-063) |
