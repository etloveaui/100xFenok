# Stock Analyzer System Architecture
## Complete Architecture for 21 CSV Global Scouter Integration

**Version**: 2.0
**Date**: 2025-10-17
**Author**: System Architect
**Status**: Design Complete - Ready for Implementation

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [System Overview](#2-system-overview)
3. [Data Layer Architecture](#3-data-layer-architecture)
4. [Module Architecture](#4-module-architecture)
5. [API Design](#5-api-design)
6. [Performance Architecture](#6-performance-architecture)
7. [Scalability Plan](#7-scalability-plan)
8. [Implementation Roadmap](#8-implementation-roadmap)

---

## 1. Executive Summary

### Current State
- **Implemented**: M_Company.csv (6,175 companies)
- **Module**: GrowthAnalytics.js (basic implementation)
- **Architecture**: Monolithic JavaScript with manual data loading

### Target State
- **Data Sources**: 21 CSV files (18,721+ rows)
- **Modules**: 9+ specialized analytics modules
- **Architecture**: Modular, lazy-loading, event-driven system
- **Performance**: <3s initial load, <500ms module activation

### Key Design Principles
1. **Lazy Loading**: Load data only when needed
2. **Progressive Enhancement**: Core features first, advanced features on-demand
3. **Event-Driven**: Modules communicate via events, not direct coupling
4. **Cache-First**: Intelligent caching at multiple layers
5. **Extensible**: Plugin architecture for future additions

---

## 2. System Overview

### 2.1 High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Dashboard   │  │   Tables     │  │   Charts     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
┌─────────┴──────────────────┴──────────────────┴─────────────────┐
│                    MODULE LAYER (9+ Modules)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Growth      │  │  Ranking     │  │    EPS       │          │
│  │  Analytics   │  │  Analytics   │  │  Analytics   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐          │
│  │  CashFlow    │  │  Checklist   │  │  Correlation │          │
│  │  Analytics   │  │  Analytics   │  │  Analytics   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐          │
│  │ Distribution │  │   Market     │  │   Economic   │          │
│  │  Analytics   │  │  Analytics   │  │  Dashboard   │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
┌─────────┴──────────────────┴──────────────────┴─────────────────┐
│                      EVENT BUS (Pub/Sub)                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Events: data:loaded, module:activated, filter:changed     │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────┴───────────────────────────────────┐
│                    DATA LAYER (Core)                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  DataManager │  │ CacheManager │  │ IndexManager │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
└─────────┼──────────────────┼──────────────────┼─────────────────┘
          │                  │                  │
┌─────────┴──────────────────┴──────────────────┴─────────────────┐
│                    DATA SOURCES (21 CSV Files)                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  global_scouter_integrated.json (Master File)              │ │
│  │  - main: M_Company, M_ETFs                                 │ │
│  │  - technical: T_Rank, T_Growth_C, T_EPS_C, T_CFO, etc.     │ │
│  │  - analysis: A_Company, A_Compare, A_Contrast, etc.        │ │
│  │  - market: S_Chart, S_Mylist, S_Valuation, UP_&_Down       │ │
│  │  - indicators: E_Indicators                                │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Relationship

```
DataManager (Core)
    ├── Manages all data loading/caching
    ├── Provides unified data access interface
    └── Coordinates with CacheManager & IndexManager

Analytics Modules (9+)
    ├── GrowthAnalytics (S Tier) - IMPLEMENTED
    ├── RankingAnalytics (S Tier) - NEXT
    ├── EPSAnalytics (S Tier)
    ├── CashFlowAnalytics (S Tier)
    ├── ChecklistAnalytics (A Tier)
    ├── CorrelationAnalytics (A Tier)
    ├── DistributionAnalytics (A Tier)
    ├── MarketAnalytics (B Tier)
    └── EconomicDashboard (A Tier) - EXISTS

Supporting Modules
    ├── ColumnManager - Column visibility/grouping
    ├── FilterManager - Advanced filtering
    ├── PerformanceManager - Performance monitoring
    ├── DeepCompare - Company comparison
    └── PortfolioBuilder - Portfolio management
```

---

## 3. Data Layer Architecture

### 3.1 DataManager (Core Component)

**Location**: `modules/Core/DataManager.js`

**Responsibilities**:
- Centralized data loading from integrated JSON
- Lazy loading of dataset categories
- Data enrichment and cross-referencing
- Unified query interface for modules

**API Surface**:
```javascript
class DataManager {
    // Singleton instance
    static getInstance()

    // Core Loading
    async initialize()
    async loadCategory(category) // 'main' | 'technical' | 'analysis' | 'market' | 'indicators'
    async loadDataset(name)      // e.g., 'T_Rank', 'T_Growth_C'

    // Data Access
    getData(datasetName)          // Get loaded dataset
    getCompanyData(ticker)        // Get company from M_Company
    getEnrichedData(ticker, datasets) // Merge data from multiple sources

    // Query Interface
    query(datasetName, filters)   // Filter dataset
    aggregate(datasetName, func)  // Aggregate operations
    join(dataset1, dataset2, key) // Join datasets

    // Cache Control
    clearCache()
    preloadDatasets(names[])
    getLoadedDatasets()

    // Events
    on(event, handler)
    emit(event, data)
}
```

**Data Loading Strategy**:
```javascript
// Phase 1: Initial Load (Critical Path)
initialize() {
    // Load only M_Company (6,175 companies)
    await this.loadDataset('M_Company');
    this.emit('data:core:loaded', { dataset: 'M_Company', count: 6175 });

    // Background: Start preloading S Tier datasets
    this.preloadInBackground(['T_Growth_C', 'T_Rank', 'T_EPS_C', 'T_CFO']);
}

// Phase 2: On-Demand Loading
loadDataset(name) {
    // Check cache first
    if (this.cache.has(name)) {
        return this.cache.get(name);
    }

    // Load from integrated JSON
    const category = this.getCategoryForDataset(name);
    const data = await this.loadFromIntegrated(category, name);

    // Cache and index
    this.cache.set(name, data);
    this.indexManager.buildIndex(name, data);

    this.emit('data:loaded', { dataset: name, count: data.length });
    return data;
}
```

### 3.2 CacheManager

**Location**: `modules/Core/CacheManager.js`

**Responsibilities**:
- Multi-tier caching (Memory → SessionStorage → IndexedDB)
- Cache invalidation and TTL management
- Size-based eviction (LRU strategy)

**Architecture**:
```javascript
class CacheManager {
    constructor() {
        this.memoryCache = new Map();        // L1: Fast in-memory cache
        this.sessionCache = sessionStorage;  // L2: Session persistence
        this.persistentCache = null;         // L3: IndexedDB (future)

        this.maxMemorySizeMB = 50;           // Configurable limit
        this.currentSizeMB = 0;
    }

    // Tiered Get Strategy
    async get(key) {
        // L1: Memory (fastest)
        if (this.memoryCache.has(key)) {
            return this.memoryCache.get(key);
        }

        // L2: SessionStorage
        const sessionData = this.sessionCache.getItem(key);
        if (sessionData) {
            const parsed = JSON.parse(sessionData);
            this.memoryCache.set(key, parsed); // Promote to L1
            return parsed;
        }

        // L3: IndexedDB (future)
        // const idbData = await this.persistentCache.get(key);

        return null;
    }

    // Tiered Set Strategy
    set(key, value, options = {}) {
        const { persist = false, ttl = null } = options;

        // L1: Always cache in memory
        this.memoryCache.set(key, value);
        this.updateMemorySize();

        // L2: Session cache for large datasets
        if (this.shouldCacheInSession(value)) {
            this.sessionCache.setItem(key, JSON.stringify(value));
        }

        // L3: Persistent cache if requested
        if (persist) {
            // Future: IndexedDB persistence
        }
    }

    // Eviction Strategy (LRU)
    evictIfNeeded() {
        if (this.currentSizeMB > this.maxMemorySizeMB) {
            // Evict least recently used entries
            const entries = Array.from(this.memoryCache.entries());
            const sorted = entries.sort((a, b) =>
                a[1].lastAccessed - b[1].lastAccessed
            );

            while (this.currentSizeMB > this.maxMemorySizeMB * 0.8) {
                const [key] = sorted.shift();
                this.memoryCache.delete(key);
                this.updateMemorySize();
            }
        }
    }
}
```

### 3.3 IndexManager

**Location**: `modules/Core/IndexManager.js`

**Responsibilities**:
- Build inverted indexes for fast lookups
- Maintain ticker → dataset mappings
- Support multi-field queries

**Index Structure**:
```javascript
class IndexManager {
    constructor() {
        this.indexes = {
            ticker: new Map(),      // ticker → [datasets]
            sector: new Map(),      // sector → [tickers]
            exchange: new Map(),    // exchange → [tickers]
            custom: new Map()       // user-defined indexes
        };
    }

    // Build index for a dataset
    buildIndex(datasetName, data) {
        data.forEach(row => {
            const ticker = row.Ticker || row.ticker;
            if (ticker) {
                // Add to ticker index
                if (!this.indexes.ticker.has(ticker)) {
                    this.indexes.ticker.set(ticker, []);
                }
                this.indexes.ticker.get(ticker).push({
                    dataset: datasetName,
                    row: row
                });

                // Add to sector index
                const sector = row.WI26 || row.sector;
                if (sector) {
                    if (!this.indexes.sector.has(sector)) {
                        this.indexes.sector.set(sector, new Set());
                    }
                    this.indexes.sector.get(sector).add(ticker);
                }
            }
        });
    }

    // Fast ticker lookup across all datasets
    getByTicker(ticker) {
        return this.indexes.ticker.get(ticker) || [];
    }

    // Fast sector lookup
    getBySector(sector) {
        const tickers = this.indexes.sector.get(sector);
        if (!tickers) return [];

        return Array.from(tickers).map(ticker =>
            this.getByTicker(ticker)
        ).flat();
    }

    // Multi-field query
    query(filters) {
        let results = new Set(this.indexes.ticker.keys());

        // Apply each filter
        if (filters.sector) {
            const sectorTickers = this.indexes.sector.get(filters.sector);
            results = new Set([...results].filter(t => sectorTickers.has(t)));
        }

        if (filters.exchange) {
            const exchangeTickers = this.indexes.exchange.get(filters.exchange);
            results = new Set([...results].filter(t => exchangeTickers.has(t)));
        }

        return Array.from(results).map(ticker => this.getByTicker(ticker));
    }
}
```

### 3.4 Data Loading Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Startup                         │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Initialize DataManager (Critical Path < 3s)            │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  1.1 Check SessionStorage cache                            │ │
│  │  1.2 Load M_Company.csv (6,175 rows) - REQUIRED           │ │
│  │  1.3 Build ticker index                                    │ │
│  │  1.4 Emit 'data:core:loaded' event                        │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: Background Preloading (S Tier Datasets)                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  2.1 T_Growth_C (1,252 rows) - GrowthAnalytics            │ │
│  │  2.2 T_Rank (1,252 rows) - RankingAnalytics               │ │
│  │  2.3 T_EPS_C (1,252 rows) - EPSAnalytics                  │ │
│  │  2.4 T_CFO (1,266 rows) - CashFlowAnalytics               │ │
│  │  (Load in parallel, cache immediately)                     │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: Module Activation (Lazy, On-Demand)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  User clicks "Growth Analytics" tab                        │ │
│  │  3.1 GrowthAnalytics.initialize()                          │ │
│  │  3.2 DataManager.getData('T_Growth_C')                     │ │
│  │  3.3 Cache hit → instant return (already preloaded)        │ │
│  │  3.4 Render charts/tables                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: On-Demand Loading (A/B Tier Datasets)                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  User activates ChecklistAnalytics                         │ │
│  │  4.1 DataManager.loadDataset('T_Chk')                      │ │
│  │  4.2 Cache miss → fetch from integrated JSON              │ │
│  │  4.3 Parse 78 columns × 1,252 rows                        │ │
│  │  4.4 Cache and index                                       │ │
│  │  4.5 Return data (first load: ~500ms, subsequent: <50ms)  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 Memory Management Strategy

**Target Memory Budget**: 100MB total
- M_Company: ~15MB (always loaded)
- S Tier (4 datasets): ~12MB (preloaded)
- A Tier (5 datasets): ~15MB (on-demand)
- B Tier (10 datasets): ~20MB (lazy)
- Cache overhead: ~10MB
- Module overhead: ~15MB
- Reserve: ~13MB

**Memory Monitoring**:
```javascript
class MemoryMonitor {
    getMemoryUsage() {
        if (performance.memory) {
            return {
                used: performance.memory.usedJSHeapSize / 1024 / 1024, // MB
                total: performance.memory.totalJSHeapSize / 1024 / 1024,
                limit: performance.memory.jsHeapSizeLimit / 1024 / 1024
            };
        }
        return null;
    }

    shouldEvictCache() {
        const usage = this.getMemoryUsage();
        return usage && (usage.used / usage.limit > 0.85); // 85% threshold
    }

    recommendEviction() {
        // Evict B Tier datasets first, then A Tier
        const evictionOrder = [
            'T_Chart', 'A_ETFs', 'UP_&_Down',     // C/B Tier
            'A_Distribution', 'T_Correlation'      // A Tier (low quality)
        ];
        return evictionOrder;
    }
}
```

---

## 4. Module Architecture

### 4.1 Module Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                      Module Lifecycle                            │
│                                                                   │
│  1. REGISTERED    → Module class defined, not instantiated       │
│         ↓                                                         │
│  2. INSTANTIATED  → new Module() called, constructor runs        │
│         ↓                                                         │
│  3. INITIALIZED   → initialize() called, data loaded             │
│         ↓                                                         │
│  4. ACTIVE        → Rendering UI, processing events              │
│         ↓                                                         │
│  5. SUSPENDED     → User navigates away, cleanup non-critical    │
│         ↓                                                         │
│  6. DESTROYED     → cleanup() called, resources released         │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Base Module Interface

**Location**: `modules/Core/BaseAnalyticsModule.js`

```javascript
class BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        this.dataManager = dataManager;
        this.eventBus = eventBus;
        this.state = 'REGISTERED';
        this.requiredDatasets = []; // Override in subclass
        this.data = {};
        this.cache = new Map();
    }

    // Lifecycle Methods
    async initialize() {
        console.log(`[${this.constructor.name}] Initializing...`);
        this.state = 'INITIALIZING';

        // Load required datasets
        await this.loadRequiredData();

        // Setup event listeners
        this.setupEventListeners();

        this.state = 'INITIALIZED';
        this.eventBus.emit('module:initialized', { module: this.constructor.name });

        return true;
    }

    async loadRequiredData() {
        const promises = this.requiredDatasets.map(dataset =>
            this.dataManager.loadDataset(dataset)
        );

        const results = await Promise.all(promises);

        this.requiredDatasets.forEach((dataset, i) => {
            this.data[dataset] = results[i];
        });
    }

    setupEventListeners() {
        // Override in subclass
    }

    activate() {
        this.state = 'ACTIVE';
        this.eventBus.emit('module:activated', { module: this.constructor.name });
    }

    suspend() {
        this.state = 'SUSPENDED';
        // Keep data cached, but cleanup UI
        this.cleanup(false);
    }

    cleanup(full = true) {
        if (full) {
            this.data = {};
            this.cache.clear();
            this.state = 'DESTROYED';
        }
    }

    // Abstract Methods (Must Override)
    render(container) {
        throw new Error('render() must be implemented by subclass');
    }

    update(filters) {
        throw new Error('update() must be implemented by subclass');
    }

    // Utility Methods
    getTickerData(ticker, datasets = null) {
        const sources = datasets || this.requiredDatasets;
        return this.dataManager.getEnrichedData(ticker, sources);
    }

    filterData(datasetName, predicate) {
        const data = this.data[datasetName];
        if (!data) return [];

        // Cache filtered results
        const cacheKey = `filtered:${datasetName}:${JSON.stringify(predicate)}`;
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const filtered = data.filter(predicate);
        this.cache.set(cacheKey, filtered);
        return filtered;
    }

    aggregateData(datasetName, field, aggregator = 'avg') {
        const data = this.data[datasetName];
        if (!data) return null;

        const values = data.map(row => parseFloat(row[field])).filter(v => !isNaN(v));

        switch (aggregator) {
            case 'avg':
                return values.reduce((a, b) => a + b, 0) / values.length;
            case 'sum':
                return values.reduce((a, b) => a + b, 0);
            case 'min':
                return Math.min(...values);
            case 'max':
                return Math.max(...values);
            case 'median':
                values.sort((a, b) => a - b);
                const mid = Math.floor(values.length / 2);
                return values.length % 2 === 0
                    ? (values[mid - 1] + values[mid]) / 2
                    : values[mid];
            default:
                return null;
        }
    }
}
```

### 4.3 Module Specifications

#### 4.3.1 RankingAnalytics (S Tier - NEXT TO IMPLEMENT)

**File**: `modules/RankingAnalytics.js`
**Priority**: Sprint 4
**Data**: T_Rank.csv (1,252 rows, 38 columns)

```javascript
class RankingAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_Rank', 'M_Company'];
    }

    // Get multi-metric ranking
    getMultiMetricRanking(metrics, weights) {
        // metrics: ['ROE', 'OPM', 'Sales Growth']
        // weights: [0.4, 0.3, 0.3]

        const data = this.data['T_Rank'];

        return data.map(company => {
            let score = 0;
            metrics.forEach((metric, i) => {
                const rank = company[`${metric}_Rank`];
                const normalizedRank = 1 - (rank / data.length);
                score += normalizedRank * weights[i];
            });

            return {
                ticker: company.Ticker,
                corp: company.Corp,
                score,
                ranks: metrics.map(m => company[`${m}_Rank`])
            };
        }).sort((a, b) => b.score - a.score);
    }

    // Sector-relative ranking
    getSectorRanking(metric, sector) {
        const data = this.filterData('T_Rank', row => row.WI26 === sector);
        return data.sort((a, b) => a[`${metric}_Rank`] - b[`${metric}_Rank`]);
    }

    // Custom ranking formula
    createCustomRanking(formula) {
        // formula: (company) => company.ROE * 0.5 + company.OPM * 0.3 + ...
        const data = this.data['T_Rank'];

        return data.map(company => ({
            ticker: company.Ticker,
            score: formula(company)
        })).sort((a, b) => b.score - a.score);
    }

    render(container) {
        // Render ranking dashboard with interactive controls
        const html = `
            <div class="ranking-dashboard">
                <div class="ranking-controls">
                    <select id="ranking-metric">
                        <option value="ROE">ROE Ranking</option>
                        <option value="OPM">Operating Margin</option>
                        <option value="Growth">Growth Rate</option>
                    </select>
                    <button id="create-custom-ranking">Custom Ranking</button>
                </div>
                <div id="ranking-chart"></div>
                <div id="ranking-table"></div>
            </div>
        `;
        container.innerHTML = html;

        this.renderRankingChart();
        this.renderRankingTable();
    }
}
```

#### 4.3.2 EPSAnalytics (S Tier)

**File**: `modules/EPSAnalytics.js`
**Priority**: Sprint 5
**Data**: T_EPS_C.csv (1,252 rows, 41 columns)

```javascript
class EPSAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_EPS_C', 'T_EPS_H', 'M_Company'];
    }

    // EPS Growth Analysis
    getEPSGrowth(ticker) {
        const current = this.data['T_EPS_C'].find(row => row.Ticker === ticker);
        if (!current) return null;

        return {
            eps_7y: this.parseGrowth(current['EPS (7)']),
            eps_3y: this.parseGrowth(current['EPS (3)']),
            eps_1y: this.parseGrowth(current['EPS (1)']),
            eps_fwd: parseFloat(current['EPS (Fwd)'])
        };
    }

    // PER Band Chart Data
    getPERBandData(ticker) {
        const history = this.data['T_EPS_H'].find(row => row.Ticker === ticker);
        if (!history) return null;

        // Extract historical PER values
        const pers = Object.keys(history)
            .filter(key => key.match(/^\d{5}/)) // Date columns
            .map(key => parseFloat(history[key]))
            .filter(v => !isNaN(v));

        const avg = pers.reduce((a, b) => a + b, 0) / pers.length;
        const std = Math.sqrt(
            pers.reduce((sq, n) => sq + Math.pow(n - avg, 2), 0) / pers.length
        );

        return {
            current: parseFloat(history['PER (Current)']),
            avg,
            std,
            bands: {
                high: avg + 2 * std,
                mid_high: avg + std,
                mid_low: avg - std,
                low: avg - 2 * std
            },
            history: pers
        };
    }

    // Earnings Quality Score
    getEarningsQuality(ticker) {
        const eps = this.getEPSGrowth(ticker);
        const company = this.dataManager.getCompanyData(ticker);

        // Quality factors
        const consistency = this.calculateConsistency(eps);
        const sustainability = eps.eps_7y > 0 && eps.eps_3y > 0 ? 1 : 0;
        const acceleration = eps.eps_3y > eps.eps_7y ? 1 : 0;
        const valuation = company.PER_Fwd < 25 ? 1 : 0;

        const score = (consistency * 0.4 + sustainability * 0.3 +
                      acceleration * 0.2 + valuation * 0.1) * 100;

        return {
            score,
            factors: { consistency, sustainability, acceleration, valuation }
        };
    }

    render(container) {
        // Render EPS dashboard with PER bands, growth charts, quality scores
    }
}
```

#### 4.3.3 CashFlowAnalytics (S Tier)

**File**: `modules/CashFlowAnalytics.js`
**Priority**: Sprint 5
**Data**: T_CFO.csv (1,266 rows, 36 columns)

```javascript
class CashFlowAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_CFO', 'M_Company'];
    }

    // Operating Cash Flow Trend
    getCFOTrend(ticker) {
        const cfo = this.data['T_CFO'].find(row => row.Ticker === ticker);
        if (!cfo) return null;

        // Extract historical CFO values
        const trend = Object.keys(cfo)
            .filter(key => key.match(/^CFO_\d{4}/))
            .map(key => ({
                year: key.replace('CFO_', ''),
                value: parseFloat(cfo[key])
            }))
            .filter(item => !isNaN(item.value))
            .sort((a, b) => a.year.localeCompare(b.year));

        return trend;
    }

    // Free Cash Flow Calculation
    getFCF(ticker) {
        const cfo = this.data['T_CFO'].find(row => row.Ticker === ticker);
        if (!cfo) return null;

        const operatingCashFlow = parseFloat(cfo['CFO_TTM']);
        const capex = parseFloat(cfo['CAPEX_TTM']);
        const fcf = operatingCashFlow - Math.abs(capex);

        const company = this.dataManager.getCompanyData(ticker);
        const marketCap = parseFloat(company['(USD mn)']);
        const fcfYield = (fcf / marketCap) * 100;

        return {
            fcf,
            fcfYield,
            operatingCashFlow,
            capex
        };
    }

    // Cash Flow Health Score
    getCashFlowHealth(ticker) {
        const cfo = this.data['T_CFO'].find(row => row.Ticker === ticker);
        if (!cfo) return null;

        const fcf = this.getFCF(ticker);
        const trend = this.getCFOTrend(ticker);

        // Health factors
        const positiveFCF = fcf.fcf > 0 ? 1 : 0;
        const growingCFO = trend.length >= 2 &&
            trend[trend.length - 1].value > trend[0].value ? 1 : 0;
        const highYield = fcf.fcfYield > 5 ? 1 : 0;
        const lowCapexRatio = Math.abs(fcf.capex / fcf.operatingCashFlow) < 0.4 ? 1 : 0;

        const score = (positiveFCF * 0.4 + growingCFO * 0.3 +
                      highYield * 0.2 + lowCapexRatio * 0.1) * 100;

        return {
            score,
            factors: { positiveFCF, growingCFO, highYield, lowCapexRatio }
        };
    }

    render(container) {
        // Render cash flow dashboard with FCF trends, health scores
    }
}
```

#### 4.3.4 ChecklistAnalytics (A Tier)

**File**: `modules/ChecklistAnalytics.js`
**Priority**: Sprint 7
**Data**: T_Chk.csv (1,252 rows, 78 columns)

```javascript
class ChecklistAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_Chk', 'M_Company'];
    }

    // Get checklist summary
    getChecklistSummary(ticker) {
        const checklist = this.data['T_Chk'].find(row => row.Ticker === ticker);
        if (!checklist) return null;

        // 78 checklist items: count pass/fail
        const items = Object.keys(checklist)
            .filter(key => key.startsWith('CHK_'))
            .map(key => ({
                name: key,
                value: checklist[key],
                passed: checklist[key] === 1 || checklist[key] === true
            }));

        const passCount = items.filter(item => item.passed).length;
        const totalCount = items.length;
        const passRate = (passCount / totalCount) * 100;

        return {
            ticker,
            passCount,
            totalCount,
            passRate,
            items
        };
    }

    // Quality filter: companies passing X% of checks
    getHighQualityCompanies(threshold = 80) {
        const data = this.data['T_Chk'];

        return data.map(row => {
            const summary = this.getChecklistSummary(row.Ticker);
            return {
                ticker: row.Ticker,
                corp: row.Corp,
                passRate: summary.passRate,
                quality: summary.passRate >= threshold ? 'HIGH' : 'MEDIUM'
            };
        })
        .filter(item => item.passRate >= threshold)
        .sort((a, b) => b.passRate - a.passRate);
    }

    // Risk warnings: identify failing critical checks
    getRiskWarnings(ticker) {
        const summary = this.getChecklistSummary(ticker);
        if (!summary) return [];

        const criticalChecks = [
            'CHK_Profitability',
            'CHK_Debt',
            'CHK_CashFlow',
            'CHK_Governance'
        ];

        return summary.items
            .filter(item =>
                criticalChecks.some(check => item.name.includes(check)) &&
                !item.passed
            )
            .map(item => ({
                check: item.name,
                severity: 'HIGH',
                recommendation: this.getRecommendation(item.name)
            }));
    }

    render(container) {
        // Render checklist dashboard with pass/fail visualization
    }
}
```

#### 4.3.5 Other Modules (Summary)

**CorrelationAnalytics** (A Tier, Sprint 6):
- T_Correlation.csv data (low quality - requires cleaning)
- Correlation matrix heatmap
- Portfolio diversification analysis
- Similar company recommendations

**DistributionAnalytics** (A Tier, Sprint 8):
- A_Distribution.csv data
- Valuation distribution charts (PER, PBR)
- Financial metric distributions
- Outlier detection

**MarketAnalytics** (B Tier, Sprint 9):
- S_Chart, S_Mylist, S_Valuation data
- Watchlist management
- Valuation snapshots
- Market sentiment indicators

**EconomicDashboard** (EXISTS - A Tier, Sprint 10):
- E_Indicators.csv data (1,032 indicators)
- Macro trend visualization
- Sector correlation with economic indicators
- Leading/lagging indicator analysis

---

## 5. API Design

### 5.1 Event Bus Architecture

**Location**: `modules/Core/EventBus.js`

```javascript
class EventBus {
    constructor() {
        this.listeners = new Map();
        this.eventQueue = [];
        this.processing = false;
    }

    // Subscribe to event
    on(event, handler, options = {}) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        this.listeners.get(event).push({
            handler,
            once: options.once || false,
            priority: options.priority || 0
        });

        // Sort by priority (higher = earlier execution)
        this.listeners.get(event).sort((a, b) => b.priority - a.priority);
    }

    // Unsubscribe from event
    off(event, handler) {
        if (!this.listeners.has(event)) return;

        const handlers = this.listeners.get(event);
        const index = handlers.findIndex(h => h.handler === handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }

    // Emit event (async queue)
    async emit(event, data) {
        this.eventQueue.push({ event, data, timestamp: Date.now() });

        if (!this.processing) {
            await this.processQueue();
        }
    }

    // Process event queue
    async processQueue() {
        this.processing = true;

        while (this.eventQueue.length > 0) {
            const { event, data } = this.eventQueue.shift();

            if (!this.listeners.has(event)) continue;

            const handlers = this.listeners.get(event);
            const results = [];

            for (const { handler, once } of handlers) {
                try {
                    const result = await handler(data);
                    results.push(result);

                    if (once) {
                        this.off(event, handler);
                    }
                } catch (error) {
                    console.error(`[EventBus] Error in ${event} handler:`, error);
                }
            }
        }

        this.processing = false;
    }

    // Emit synchronously (use sparingly)
    emitSync(event, data) {
        if (!this.listeners.has(event)) return;

        const handlers = this.listeners.get(event);
        handlers.forEach(({ handler }) => {
            try {
                handler(data);
            } catch (error) {
                console.error(`[EventBus] Error in ${event} handler:`, error);
            }
        });
    }
}
```

### 5.2 Standard Events

```javascript
// Data Layer Events
'data:core:loaded'         // M_Company loaded (initial)
'data:loaded'              // Any dataset loaded
'data:updated'             // Dataset refreshed
'data:enriched'            // Cross-reference complete

// Module Events
'module:registered'        // Module class registered
'module:initialized'       // Module initialize() complete
'module:activated'         // Module UI active
'module:suspended'         // Module UI hidden
'module:destroyed'         // Module cleanup complete

// UI Events
'filter:changed'           // User changed filter
'sort:changed'             // User changed sort
'search:query'             // User search query
'selection:changed'        // User selected company

// Analysis Events
'analysis:started'         // Analysis computation started
'analysis:complete'        // Analysis ready
'comparison:added'         // Company added to comparison
'chart:rendered'           // Chart rendering complete
```

### 5.3 Module Communication Patterns

**Pattern 1: Module → Module via EventBus**
```javascript
// GrowthAnalytics requests data refresh
growthAnalytics.on('growth:high-performers', (data) => {
    eventBus.emit('analysis:complete', {
        module: 'GrowthAnalytics',
        type: 'high-performers',
        data: data
    });
});

// RankingAnalytics listens and updates
rankingAnalytics.initialize() {
    this.eventBus.on('analysis:complete', (payload) => {
        if (payload.module === 'GrowthAnalytics') {
            this.updateRankings(payload.data);
        }
    });
}
```

**Pattern 2: Shared Data via DataManager**
```javascript
// Module A enriches data and caches
const enrichedData = dataManager.getEnrichedData(ticker, [
    'M_Company', 'T_Growth_C', 'T_EPS_C'
]);

// Module B retrieves from cache (fast)
const cachedData = dataManager.getEnrichedData(ticker, [
    'M_Company', 'T_Growth_C', 'T_EPS_C'
]);
// Returns instantly from cache
```

**Pattern 3: Coordinated Loading**
```javascript
// DataManager emits progress events
dataManager.on('data:loading', ({ dataset, progress }) => {
    loadingManager.updateProgress(dataset, progress);
});

// Multiple modules wait for same dataset
await Promise.all([
    growthAnalytics.initialize(),   // Needs T_Growth_C
    rankingAnalytics.initialize()   // Needs T_Growth_C (cached)
]);
```

### 5.4 Internal API Standards

**Query Interface**:
```javascript
// Standard query object
const query = {
    datasets: ['T_Growth_C', 'T_Rank'],
    filters: {
        sector: '반도체',
        exchange: 'NASDAQ',
        custom: (row) => parseFloat(row['ROE (Fwd)']) > 0.2
    },
    sort: {
        field: 'Sales (7)',
        order: 'desc'
    },
    limit: 50,
    offset: 0
};

const results = dataManager.query(query);
```

**Aggregation Interface**:
```javascript
// Standard aggregation
const sectorAverages = dataManager.aggregate({
    dataset: 'T_Growth_C',
    groupBy: 'WI26',
    metrics: {
        avgSalesGrowth: { field: 'Sales (7)', func: 'avg' },
        maxEPSGrowth: { field: 'EPS (7)', func: 'max' },
        companyCount: { func: 'count' }
    }
});

// Returns:
// [
//   { WI26: '반도체', avgSalesGrowth: 15.2, maxEPSGrowth: 45.3, companyCount: 120 },
//   { WI26: '소프트웨어', avgSalesGrowth: 22.1, maxEPSGrowth: 38.7, companyCount: 85 },
//   ...
// ]
```

---

## 6. Performance Architecture

### 6.1 Performance Budget

**Target Metrics**:
- **Initial Load**: < 3 seconds (M_Company only)
- **Module Activation**: < 500ms (cached data)
- **Module Activation**: < 2s (uncached data)
- **Chart Rendering**: < 300ms
- **Table Rendering**: < 500ms (50 rows)
- **Search Response**: < 100ms
- **Filter Application**: < 200ms

### 6.2 Lazy Loading Strategy

**Phase 1: Critical Path (0-3s)**
```javascript
async function initializeCriticalPath() {
    // 1. Load minimal UI (200ms)
    renderAppShell();

    // 2. Load M_Company (1.5s)
    await dataManager.loadDataset('M_Company');

    // 3. Render main table (1s)
    renderMainTable(dataManager.getData('M_Company'));

    // 4. Initialize core modules (300ms)
    await Promise.all([
        columnManager.initialize(),
        filterManager.initialize()
    ]);

    // Total: ~3s
}
```

**Phase 2: Background Preloading (3-10s)**
```javascript
async function preloadSTierDatasets() {
    // Preload in parallel, don't block UI
    const datasets = ['T_Growth_C', 'T_Rank', 'T_EPS_C', 'T_CFO'];

    for (const dataset of datasets) {
        // Load one at a time to avoid overwhelming network
        await dataManager.loadDataset(dataset);

        // Yield to UI thread
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    eventBus.emit('data:preload:complete', { datasets });
}
```

**Phase 3: On-Demand Loading**
```javascript
async function activateModule(moduleName) {
    const startTime = performance.now();

    // Check if module is already initialized
    if (moduleRegistry.isInitialized(moduleName)) {
        moduleRegistry.activate(moduleName);
        return;
    }

    // Show loading indicator
    loadingManager.show(`Loading ${moduleName}...`);

    // Initialize module (loads required datasets)
    const module = moduleRegistry.get(moduleName);
    await module.initialize();

    // Activate and render
    module.activate();
    module.render(getModuleContainer(moduleName));

    // Hide loading indicator
    loadingManager.hide();

    const duration = performance.now() - startTime;
    performanceManager.recordModuleActivation(moduleName, duration);
}
```

### 6.3 Progressive Enhancement

**Level 1: Basic Functionality** (Always Available)
- Main company table with M_Company data
- Basic search and filtering
- Column visibility controls

**Level 2: Enhanced Analytics** (Loaded on-demand)
- Growth/EPS/CashFlow analytics modules
- Interactive charts
- Deep comparison

**Level 3: Advanced Features** (Lazy loaded)
- Economic dashboard
- Portfolio builder
- Correlation analysis
- 3D visualizations (future)

### 6.4 Code Splitting

**Bundle Structure**:
```
bundle/
├── core.bundle.js          (150KB) - Critical path
│   ├── DataManager
│   ├── EventBus
│   ├── CacheManager
│   ├── IndexManager
│   └── Main app shell
│
├── analytics-s-tier.bundle.js (200KB) - S Tier modules
│   ├── GrowthAnalytics
│   ├── RankingAnalytics
│   ├── EPSAnalytics
│   └── CashFlowAnalytics
│
├── analytics-a-tier.bundle.js (180KB) - A Tier modules
│   ├── ChecklistAnalytics
│   ├── CorrelationAnalytics
│   ├── DistributionAnalytics
│   └── EconomicDashboard
│
├── analytics-b-tier.bundle.js (150KB) - B Tier modules
│   ├── MarketAnalytics
│   ├── HistoryAnalytics
│   └── ComparisonAnalytics
│
├── charts.bundle.js        (120KB) - Chart.js + extensions
└── vendor.bundle.js        (80KB) - Third-party libraries
```

**Dynamic Import**:
```javascript
async function loadAnalyticsTier(tier) {
    const bundleMap = {
        'S': () => import('./bundle/analytics-s-tier.bundle.js'),
        'A': () => import('./bundle/analytics-a-tier.bundle.js'),
        'B': () => import('./bundle/analytics-b-tier.bundle.js')
    };

    const module = await bundleMap[tier]();
    return module;
}
```

### 6.5 Caching Strategy

**Multi-Level Cache**:
```
L1: Memory Cache (50MB limit)
    ├── Hot data: M_Company (always resident)
    ├── Active modules: Currently loaded datasets
    └── Recent queries: Last 10 queries cached

L2: SessionStorage (10MB limit)
    ├── S Tier datasets: Persist across page refreshes
    ├── User preferences: Filters, sorts, column config
    └── Module state: Last active module, scroll position

L3: IndexedDB (Future - 500MB limit)
    ├── Historical data: Time series archives
    ├── User portfolios: Saved analyses
    └── Offline mode: Full dataset cache
```

**Cache Invalidation**:
```javascript
class CacheInvalidationManager {
    constructor() {
        this.ttl = {
            'M_Company': 24 * 60 * 60 * 1000,      // 24 hours
            'T_*': 12 * 60 * 60 * 1000,            // 12 hours (technical)
            'A_*': 6 * 60 * 60 * 1000,             // 6 hours (analysis)
            'E_Indicators': 2 * 60 * 60 * 1000     // 2 hours (economic)
        };
    }

    shouldInvalidate(key, timestamp) {
        const pattern = this.getPattern(key);
        const maxAge = this.ttl[pattern];
        const age = Date.now() - timestamp;

        return age > maxAge;
    }

    invalidateAll() {
        // Clear all caches (e.g., after data refresh)
        cacheManager.clear();
        sessionStorage.clear();
    }
}
```

### 6.6 Performance Monitoring

```javascript
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            moduleActivation: new Map(),
            dataLoading: new Map(),
            rendering: new Map(),
            userInteraction: new Map()
        };
    }

    recordModuleActivation(moduleName, duration) {
        if (!this.metrics.moduleActivation.has(moduleName)) {
            this.metrics.moduleActivation.set(moduleName, []);
        }
        this.metrics.moduleActivation.get(moduleName).push(duration);

        // Warn if over budget
        if (duration > 500) {
            console.warn(`[Performance] ${moduleName} activation took ${duration}ms (budget: 500ms)`);
        }
    }

    getReport() {
        const report = {};

        this.metrics.moduleActivation.forEach((durations, module) => {
            const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
            const max = Math.max(...durations);
            const min = Math.min(...durations);

            report[module] = {
                avg: avg.toFixed(2),
                max: max.toFixed(2),
                min: min.toFixed(2),
                count: durations.length,
                overBudget: durations.filter(d => d > 500).length
            };
        });

        return report;
    }

    // Real User Monitoring (RUM)
    captureRUM() {
        if (window.performance && window.performance.timing) {
            const timing = window.performance.timing;

            return {
                dns: timing.domainLookupEnd - timing.domainLookupStart,
                tcp: timing.connectEnd - timing.connectStart,
                request: timing.responseStart - timing.requestStart,
                response: timing.responseEnd - timing.responseStart,
                domParse: timing.domInteractive - timing.responseEnd,
                domReady: timing.domContentLoadedEventEnd - timing.domContentLoadedEventStart,
                load: timing.loadEventEnd - timing.loadEventStart,
                total: timing.loadEventEnd - timing.navigationStart
            };
        }
        return null;
    }
}
```

---

## 7. Scalability Plan

### 7.1 Extensibility Points

**Plugin Architecture**:
```javascript
class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.hooks = new Map();
    }

    // Register a new analytics plugin
    register(plugin) {
        if (!plugin.name || !plugin.initialize) {
            throw new Error('Invalid plugin: must have name and initialize()');
        }

        this.plugins.set(plugin.name, plugin);
        console.log(`[PluginManager] Registered plugin: ${plugin.name}`);
    }

    // Initialize all plugins
    async initializeAll(dataManager, eventBus) {
        const promises = [];

        this.plugins.forEach((plugin, name) => {
            promises.push(
                plugin.initialize(dataManager, eventBus)
                    .catch(error => {
                        console.error(`[PluginManager] Failed to initialize ${name}:`, error);
                    })
            );
        });

        await Promise.all(promises);
    }

    // Hook system for extending behavior
    registerHook(hookName, callback) {
        if (!this.hooks.has(hookName)) {
            this.hooks.set(hookName, []);
        }
        this.hooks.get(hookName).push(callback);
    }

    async runHook(hookName, data) {
        if (!this.hooks.has(hookName)) return data;

        let result = data;
        for (const callback of this.hooks.get(hookName)) {
            result = await callback(result);
        }
        return result;
    }
}

// Example plugin
class MyCustomAnalytics extends BaseAnalyticsModule {
    static get metadata() {
        return {
            name: 'MyCustomAnalytics',
            version: '1.0.0',
            requiredDatasets: ['T_Custom'],
            tier: 'C'
        };
    }

    async initialize(dataManager, eventBus) {
        super.initialize();
        // Plugin-specific initialization
    }

    render(container) {
        // Plugin-specific rendering
    }
}

// Register plugin
pluginManager.register(new MyCustomAnalytics());
```

### 7.2 Future CSV Integration

**Adding New CSV Files**:
```javascript
// 1. Add to automation/automation_master.py
NEW_DATASETS = [
    {
        'name': 'T_NewMetric',
        'source': 'Global_Scouter/T_NewMetric.xlsb',
        'category': 'technical',
        'tier': 'A',
        'priority': 70
    }
]

// 2. Update DataManager category mapping
const CATEGORY_MAP = {
    'T_NewMetric': 'technical',
    // ... existing mappings
};

// 3. Create module (optional)
class NewMetricAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_NewMetric', 'M_Company'];
    }

    // Implement module logic
}

// 4. Register module
moduleRegistry.register('NewMetricAnalytics', NewMetricAnalytics);
```

**Automatic Detection**:
```javascript
class DataSourceDiscovery {
    async scanIntegratedJSON() {
        const response = await fetch('./data/global_scouter_integrated.json');
        const data = await response.json();

        const discovered = [];

        for (const [category, datasets] of Object.entries(data.data)) {
            for (const [name, rows] of Object.entries(datasets)) {
                discovered.push({
                    name,
                    category,
                    rowCount: rows.length,
                    columns: Object.keys(rows[0] || {}),
                    tier: this.inferTier(rows.length, Object.keys(rows[0] || {}).length)
                });
            }
        }

        return discovered;
    }

    inferTier(rowCount, colCount) {
        if (rowCount > 1000 && colCount > 30) return 'S';
        if (rowCount > 500 && colCount > 20) return 'A';
        if (rowCount > 100) return 'B';
        return 'C';
    }
}
```

### 7.3 Horizontal Scaling

**Module Federation** (Future):
```javascript
// Load modules from remote sources
const remoteFederation = {
    'analytics-premium': 'https://cdn.example.com/premium-analytics.js',
    'analytics-ml': 'https://cdn.example.com/ml-analytics.js'
};

async function loadRemoteModule(name) {
    const script = document.createElement('script');
    script.src = remoteFederation[name];
    script.async = true;

    return new Promise((resolve, reject) => {
        script.onload = () => resolve(window[name]);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}
```

**Worker Pool** (Future):
```javascript
// Offload heavy computations to Web Workers
class WorkerPool {
    constructor(size = 4) {
        this.size = size;
        this.workers = [];
        this.taskQueue = [];

        for (let i = 0; i < size; i++) {
            this.workers.push(new Worker('./worker.js'));
        }
    }

    async execute(task, data) {
        const worker = this.getAvailableWorker();

        return new Promise((resolve, reject) => {
            worker.postMessage({ task, data });
            worker.onmessage = (e) => resolve(e.data);
            worker.onerror = reject;
        });
    }

    getAvailableWorker() {
        // Simple round-robin for now
        return this.workers[this.taskQueue.length % this.size];
    }
}

// Usage
const workerPool = new WorkerPool(4);

// Heavy correlation calculation in worker
const correlationMatrix = await workerPool.execute('calculateCorrelation', {
    dataset: 'T_Correlation',
    tickers: ['AAPL', 'MSFT', 'GOOGL', ...]
});
```

### 7.4 Data Growth Strategy

**Archival System**:
```javascript
// Archive old data to reduce active dataset size
class DataArchiver {
    async archiveOldData(dataset, cutoffDate) {
        const data = dataManager.getData(dataset);
        const [active, archived] = this.partition(data, cutoffDate);

        // Store archived data in IndexedDB
        await this.storeInIndexedDB(`${dataset}_archive`, archived);

        // Update active dataset
        dataManager.updateDataset(dataset, active);

        console.log(`[Archiver] Archived ${archived.length} rows from ${dataset}`);
    }

    async queryArchive(dataset, query) {
        // Query archived data from IndexedDB
        return await this.queryIndexedDB(`${dataset}_archive`, query);
    }
}
```

**Pagination for Large Datasets**:
```javascript
// Virtual scrolling for large tables
class VirtualTableRenderer {
    constructor(data, rowHeight = 50) {
        this.data = data;
        this.rowHeight = rowHeight;
        this.visibleRange = { start: 0, end: 20 };
        this.bufferSize = 10;
    }

    updateVisibleRange(scrollTop, containerHeight) {
        const start = Math.floor(scrollTop / this.rowHeight);
        const end = Math.ceil((scrollTop + containerHeight) / this.rowHeight);

        this.visibleRange = {
            start: Math.max(0, start - this.bufferSize),
            end: Math.min(this.data.length, end + this.bufferSize)
        };

        this.render();
    }

    render() {
        const visibleRows = this.data.slice(
            this.visibleRange.start,
            this.visibleRange.end
        );

        // Render only visible rows + buffer
        // Use transform: translateY() to position rows
    }
}
```

---

## 8. Implementation Roadmap

### 8.1 Sprint 4 (Current) - Weeks 1-2

**Goals**: Complete GrowthAnalytics, add RankingAnalytics

**Tasks**:
1. **DataManager Core** (3 days)
   - Implement singleton DataManager
   - Add lazy loading for integrated JSON
   - Build ticker index

2. **CacheManager** (2 days)
   - Implement L1/L2 caching
   - Add memory monitoring
   - Implement LRU eviction

3. **EventBus** (1 day)
   - Implement pub/sub system
   - Add priority queuing
   - Define standard events

4. **RankingAnalytics Module** (4 days)
   - Implement module class
   - Add multi-metric ranking
   - Add sector ranking
   - Build ranking dashboard UI

5. **Integration Testing** (2 days)
   - Test DataManager with all modules
   - Test cache performance
   - Test event propagation

**Deliverables**:
- DataManager, CacheManager, EventBus (Core)
- RankingAnalytics module complete
- GrowthAnalytics refactored to use Core
- Performance: Initial load < 3s

### 8.2 Sprint 5 - Weeks 3-4

**Goals**: Add EPSAnalytics, CashFlowAnalytics

**Tasks**:
1. **IndexManager** (2 days)
   - Implement multi-field indexes
   - Add query optimization
   - Add aggregation functions

2. **EPSAnalytics Module** (4 days)
   - Implement EPS growth analysis
   - Build PER band charts
   - Add earnings quality scoring

3. **CashFlowAnalytics Module** (4 days)
   - Implement CFO trend analysis
   - Calculate FCF and FCF yield
   - Add cash flow health scoring

4. **Module Integration** (2 days)
   - Integrate with existing dashboard
   - Add cross-module communication
   - Test module lifecycle

**Deliverables**:
- IndexManager complete
- EPSAnalytics module complete
- CashFlowAnalytics module complete
- 5 S Tier modules operational

### 8.3 Sprint 6 - Weeks 5-6

**Goals**: Add ChecklistAnalytics, CorrelationAnalytics

**Tasks**:
1. **Data Quality Pipeline** (3 days)
   - Implement data cleaning for T_Chk
   - Clean T_Correlation (86% null values)
   - Add quality monitoring

2. **ChecklistAnalytics Module** (4 days)
   - Parse 78 checklist items
   - Build quality filter
   - Add risk warnings

3. **CorrelationAnalytics Module** (5 days)
   - Clean correlation data
   - Build correlation matrix
   - Add diversification analysis
   - Implement similar company recommendations

**Deliverables**:
- Data quality pipeline operational
- ChecklistAnalytics complete
- CorrelationAnalytics complete
- 7 modules operational (5 S + 2 A Tier)

### 8.4 Sprint 7-9 - Weeks 7-12

**Goals**: Complete A/B Tier modules

**Sprint 7** (Weeks 7-8):
- DistributionAnalytics module
- A_Compare data integration
- A_Contrast analysis module

**Sprint 8** (Weeks 9-10):
- MarketAnalytics module (S_Chart, S_Mylist, S_Valuation)
- HistoryAnalytics (T_Growth_H, T_EPS_H)
- Enhanced DeepCompare with all datasets

**Sprint 9** (Weeks 11-12):
- ETF analysis modules (A_ETFs, M_ETFs)
- Watchlist integration (S_Mylist)
- User personalization features

**Deliverables**:
- All A Tier modules complete
- Most B Tier modules complete
- ~18 of 21 CSV files integrated

### 8.5 Sprint 10 - Weeks 13-14

**Goals**: Economic Dashboard enhancement

**Tasks**:
1. E_Indicators data cleaning (66% null values)
2. Select top 50 economic indicators
3. Build macro trend dashboard
4. Add sector correlation analysis

**Deliverables**:
- Enhanced Economic Dashboard
- 50 key indicators visualized
- Sector-economic indicator correlations

### 8.6 Future Phases (Sprints 11-15)

**Sprint 11**: AI-powered screening
- Machine learning models for stock scoring
- Predictive analytics for growth
- Anomaly detection

**Sprint 12**: Real-time updates
- WebSocket integration
- Live price updates
- Real-time alerts

**Sprint 13**: Backtesting framework
- Historical simulation engine
- Strategy performance testing
- Portfolio optimization

**Sprint 14**: 3D Visualization
- 3D scatter plots (valuation vs growth vs quality)
- Interactive 3D correlation networks
- VR/AR exploration (experimental)

**Sprint 15**: Mobile PWA
- Responsive design refinement
- Offline mode with IndexedDB
- Mobile-optimized charts
- Push notifications

---

## 9. Risk Management

### 9.1 Technical Risks

**Risk 1: Performance Degradation**
- **Impact**: High (user experience)
- **Probability**: Medium
- **Mitigation**:
  - Strict performance budgets (< 3s initial, < 500ms module)
  - Continuous performance monitoring
  - Lazy loading and code splitting
  - Memory management with eviction
- **Contingency**: Reduce feature scope, increase caching

**Risk 2: Data Quality Issues**
- **Impact**: High (analysis accuracy)
- **Probability**: High (7 files < 50% quality)
- **Mitigation**:
  - Data quality pipeline (Sprint 6)
  - Null value handling
  - Quality score monitoring
  - User warnings for low-quality data
- **Contingency**: Exclude low-quality datasets, seek alternative sources

**Risk 3: Module Complexity**
- **Impact**: Medium (development velocity)
- **Probability**: Medium
- **Mitigation**:
  - BaseAnalyticsModule abstraction
  - Standard patterns and APIs
  - Comprehensive documentation
  - Code reviews
- **Contingency**: Simplify module features, extend timeline

### 9.2 Scalability Risks

**Risk 4: Data Growth**
- **Impact**: Medium (memory usage)
- **Probability**: High (future CSV additions)
- **Mitigation**:
  - Plugin architecture for extensibility
  - Archival system for old data
  - IndexedDB for persistent storage
  - Virtual scrolling for large tables
- **Contingency**: Server-side processing, API backend

**Risk 5: Browser Compatibility**
- **Impact**: Low (limited user base)
- **Probability**: Low (modern browsers)
- **Mitigation**:
  - Progressive enhancement
  - Feature detection
  - Graceful degradation
  - Polyfills for older browsers
- **Contingency**: Drop support for IE11, require modern browsers

### 9.3 Mitigation Summary

| Risk | Severity | Mitigation Strategy | Owner |
|------|----------|---------------------|-------|
| Performance | HIGH | Budgets, monitoring, lazy loading | PerformanceManager |
| Data Quality | HIGH | Pipeline, cleaning, validation | DataManager |
| Complexity | MEDIUM | Abstractions, patterns, docs | Architect |
| Data Growth | MEDIUM | Archival, IndexedDB, virtual scroll | DataManager |
| Browser Compat | LOW | Progressive enhancement, polyfills | UIManager |

---

## 10. Success Criteria

### 10.1 Phase 4-1 (Sprints 4-6)

**Quantitative**:
- Initial load time: < 3 seconds ✅
- Module activation: < 500ms (cached) ✅
- 5 S Tier datasets: 100% integrated ✅
- Memory usage: < 100MB ✅
- Test coverage: > 80% ✅

**Qualitative**:
- Clean architecture with clear separation of concerns
- Easy to add new modules (< 1 day for simple module)
- Developer-friendly APIs
- User experience: smooth, responsive, no lag

### 10.2 Phase 4-2 (Sprints 7-9)

**Quantitative**:
- 5 A Tier datasets: 80% integrated ✅
- 10 B Tier datasets: 50% integrated ✅
- Total modules: 9+ operational ✅
- Data quality: All datasets > 80% quality score ✅

**Qualitative**:
- Comprehensive analytics coverage
- Cross-module insights (e.g., growth + ranking + checklist)
- Data quality improvements visible to users

### 10.3 Phase 4-3 & 5 (Sprints 10+)

**Quantitative**:
- 18 of 21 CSV files integrated (85%) ✅
- AI features: 3+ implemented ✅
- Mobile support: PWA ready ✅
- Offline mode: Basic functionality ✅

**Qualitative**:
- Professional-grade analytics platform
- AI-enhanced insights
- Mobile-first experience
- Production-ready quality

---

## 11. Conclusion

This architecture provides a **scalable, modular, and performant foundation** for integrating all 21 Global Scouter CSV files into the Stock Analyzer application.

### Key Architectural Decisions

1. **DataManager Core**: Centralized data management with lazy loading and multi-tier caching
2. **Module System**: BaseAnalyticsModule provides consistent interface for all analytics
3. **Event-Driven**: Loose coupling via EventBus enables independent module development
4. **Performance-First**: Strict budgets, lazy loading, and code splitting maintain <3s initial load
5. **Extensible**: Plugin architecture and standard APIs support future growth

### Implementation Priority

**Immediate (Sprint 4)**:
- DataManager, CacheManager, EventBus (Core)
- RankingAnalytics module

**Near-Term (Sprint 5-6)**:
- EPSAnalytics, CashFlowAnalytics (S Tier)
- ChecklistAnalytics, CorrelationAnalytics (A Tier)

**Long-Term (Sprint 7+)**:
- Remaining A/B Tier modules
- AI features, real-time updates, mobile PWA

### Next Steps

1. Review architecture with stakeholders
2. Begin Sprint 4 implementation (DataManager Core)
3. Refactor GrowthAnalytics to use new Core
4. Implement RankingAnalytics as first new module
5. Iterate based on performance measurements

---

**Document Version**: 2.0
**Last Updated**: 2025-10-17
**Next Review**: Sprint 6 completion
**Status**: ✅ APPROVED FOR IMPLEMENTATION
