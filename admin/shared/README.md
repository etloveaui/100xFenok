# admin/shared/ - Unified Shared Modules

> **Purpose**: Common modules for Data Lab and Valuation Lab
> **Created**: 2026-01-20
> **Version**: 1.0.0

---

## Overview

This folder contains unified JavaScript modules shared between:
- `admin/data-lab/` - Data management dashboard
- `admin/valuation-lab/` - Valuation analysis tools

**Benefits**:
- No duplicate code between labs
- Single source of truth for common functionality
- Consistent caching, formatting, and validation

---

## Module Structure

```
admin/shared/
├── config/
│   └── manifest-loader.js    # Manifest-driven data discovery
├── core/
│   ├── cache-manager.js      # 3-tier caching (Memory → Session → Fetch)
│   ├── data-manager.js       # Data loading with retry logic
│   └── formatters.js         # Number, date, signal formatting
├── ui/
│   └── status-card.js        # Reusable status card component
└── validators/
    ├── freshness-checker.js  # Data freshness monitoring (🟢🟡🔴)
    └── schema-validator.js   # JSON schema validation
```

---

## Usage

### HTML Import Order (Important!)

```html
<!-- 1. Config first -->
<script src="../shared/config/manifest-loader.js"></script>

<!-- 2. Core modules (CacheManager before DataManager) -->
<script src="../shared/core/cache-manager.js"></script>
<script src="../shared/core/data-manager.js"></script>
<script src="../shared/core/formatters.js"></script>

<!-- 3. Validators -->
<script src="../shared/validators/freshness-checker.js"></script>
<script src="../shared/validators/schema-validator.js"></script>

<!-- 4. UI components -->
<script src="../shared/ui/status-card.js"></script>
```

### CacheManager Initialization

Each lab should set its own prefix to avoid cache conflicts:

```javascript
// Data Lab
CacheManager.setPrefix('dlab_cache_');

// Valuation Lab
CacheManager.setPrefix('vlab_cache_');
```

### Loading Data from Manifest

```javascript
// Old way (hardcoded) - DON'T USE
const data = await fetch('/data/benchmarks/us.json');

// New way (manifest-driven) - USE THIS
const data = await DataManager.loadFromManifest('benchmarks', 'us.json');
```

---

## Module Details

### ManifestLoader

Reads `data/manifest.json` to discover all data sources dynamically.

```javascript
const manifest = await ManifestLoader.loadManifest();
const folders = await ManifestLoader.getFolders();
const schema = await ManifestLoader.loadSchema('benchmarks');
```

### CacheManager

3-tier caching with configurable prefix:

| Layer | Storage | TTL |
|-------|---------|-----|
| L1 | Memory (Map) | 5 min |
| L2 | SessionStorage | 30 min |
| L3 | Network Fetch | - |

```javascript
CacheManager.setPrefix('vlab_cache_');
const data = await CacheManager.get('key', () => fetch(url));
CacheManager.invalidate('key');
CacheManager.clear();
```

### DataManager

Data loading with timeout and retry:

```javascript
// Generic loading
const data = await DataManager.loadData(url, cacheKey);

// Manifest-driven loading (recommended)
const data = await DataManager.loadFromManifest('global-scouter', 'stocks.json');

// Batch loading
const results = await DataManager.loadMultipleFromManifest([
  { folder: 'benchmarks', file: 'us.json' },
  { folder: 'damodaran', file: 'industries.json' }
]);
```

### FreshnessChecker

Checks data freshness based on update frequency:

```javascript
const result = FreshnessChecker.checkFreshness('2026-01-20', 'weekly');
// Returns: { status: 'fresh', signal: '🟢', daysAgo: 0, label: 'Fresh' }

const allResults = FreshnessChecker.checkAllFolders(manifestFolders);
const summary = FreshnessChecker.getSummary(allResults);
const health = FreshnessChecker.getOverallHealth(summary);
```

### Formatters

Common formatting utilities:

```javascript
Formatters.formatNumber(1234.56, 2);     // "1,234.56"
Formatters.formatPercent(0.15, 1);       // "15.0%"
Formatters.formatDate('2026-01-20');     // "2026-01-20"
Formatters.formatCompact(1500000);       // "1.5M"
Formatters.formatSignal(25);             // { signal: '🟢', label: 'Good' }
```

---

## Adding New Modules

1. Create file in appropriate subfolder (`core/`, `validators/`, `ui/`)
2. Use IIFE pattern for encapsulation
3. Update this README
4. Update HTML imports in both labs

---

## References

- Architecture: `docs/planning/valuation-lab-architecture.md`
- Data Schema: `data/manifest.json`
- Migration: `docs/delegation/active/TASK-169-C_shared-module-migration.md`

---

*Version 1.0.0 | 2026-01-20*
