# Data Lab DEV.md

> **Purpose**: Data Health Monitoring Dashboard
> **Location**: `admin/data-lab/`
> **Version**: 2.2.0 (Manifest + StockAnalysis audit architecture)
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
| **StockAnalysis audit** | Reads `data/stockanalysis/index.json` and `classification/latest.json` for ETF detail backfill + leverage/inverse/single-stock classification visibility |

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
- **Incremental proof**: `data/stockanalysis/backfill/incremental_latest.json` can be 404 before the first scheduled/dispatch incremental ETF run; Data Lab treats that as waiting, not failure.

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
| 2.2.1 | 2026-06-18 | Added automatic ETF enrichment observation: audit status, incremental backfill proof file, Yahoo fallback counts, pending detail count, and market_facts fallback coverage |
| 2.2.0 | 2026-06-18 | Added ETF classification counts, latest StockAnalysis fetch index/backfill status, restored Source Parity detail in source, and freshness guards for classification/index/surface files |
| 2.1.0 | 2026-06-17 | Added market data audit cards and freshness guards for StockAnalysis ETF universe + computed market source parity |
| 2.0.1 | 2026-04-14 | Added `embed=1` shell mode to hide legacy header/footer inside Next.js iframe bridge (#269) |
| 2.0.0 | 2026-01-20 | Manifest-driven architecture, 94% code reduction (1,716→103 lines) |
| 1.1.0 | 2026-01-10 | SlickCharts integration (34 validators) |
| 1.0.0 | 2025-12-27 | Initial release (DEC-063) |
