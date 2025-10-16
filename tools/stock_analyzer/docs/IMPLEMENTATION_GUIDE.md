# Implementation Guide
## Quick Start for Developers

**Version**: 2.0
**Date**: 2025-10-17
**Prerequisites**: Read SYSTEM_ARCHITECTURE.md first

---

## Quick Start (5 minutes)

### Understanding the Architecture

**Current State**:
- 1 CSV integrated: M_Company (6,175 companies)
- 1 module: GrowthAnalytics (basic)
- Monolithic structure

**Target State**:
- 21 CSV files integrated (18,721+ rows)
- 9+ specialized modules
- Modular, event-driven architecture

**Core Components**:
```
DataManager → Loads/caches all datasets
EventBus → Module communication
CacheManager → 3-tier caching (Memory/Session/IndexedDB)
IndexManager → Fast lookups by ticker/sector/exchange
BaseAnalyticsModule → Base class for all modules
```

---

## Sprint 4 Implementation (Current)

### Task 1: Implement DataManager Core (3 days)

**File**: `modules/Core/DataManager.js`

**Step-by-step**:

1. **Create singleton pattern**:
```javascript
// modules/Core/DataManager.js
class DataManager {
    static instance = null;

    static getInstance() {
        if (!DataManager.instance) {
            DataManager.instance = new DataManager();
        }
        return DataManager.instance;
    }

    constructor() {
        if (DataManager.instance) {
            throw new Error('Use DataManager.getInstance()');
        }
        this.cache = new Map();
        this.integratedData = null;
        this.cacheManager = null; // Will add in Task 2
        this.indexManager = null;  // Will add in Task 3
    }
}
```

2. **Implement initialize()**:
```javascript
async initialize() {
    console.log('[DataManager] Initializing...');

    // Load integrated JSON
    this.integratedData = await this.loadIntegratedJSON();

    // Load critical M_Company dataset
    await this.loadDataset('M_Company');

    // Start background preloading S Tier
    this.preloadInBackground(['T_Growth_C', 'T_Rank', 'T_EPS_C', 'T_CFO']);

    console.log('[DataManager] Initialization complete');
}

async loadIntegratedJSON() {
    const response = await fetch('./data/global_scouter_integrated.json');
    if (!response.ok) {
        throw new Error(`Failed to load integrated JSON: ${response.status}`);
    }
    return await response.json();
}
```

3. **Implement loadDataset()**:
```javascript
async loadDataset(name) {
    // Check cache first
    if (this.cache.has(name)) {
        console.log(`[DataManager] Cache hit: ${name}`);
        return this.cache.get(name);
    }

    console.log(`[DataManager] Loading dataset: ${name}`);

    // Determine category
    const category = this.getCategoryForDataset(name);

    // Extract from integrated JSON
    const data = this.integratedData.data[category][name];

    if (!data) {
        throw new Error(`Dataset ${name} not found in category ${category}`);
    }

    // Cache the data
    this.cache.set(name, data);

    console.log(`[DataManager] Loaded ${name}: ${data.length} rows`);
    return data;
}

getCategoryForDataset(name) {
    if (name.startsWith('M_')) return 'main';
    if (name.startsWith('T_')) return 'technical';
    if (name.startsWith('A_')) return 'analysis';
    if (name.startsWith('S_')) return 'market';
    if (name.startsWith('E_')) return 'indicators';
    throw new Error(`Unknown dataset category for: ${name}`);
}
```

4. **Implement background preloading**:
```javascript
async preloadInBackground(datasets) {
    // Don't block initialization
    setTimeout(async () => {
        console.log('[DataManager] Starting background preload...');

        for (const dataset of datasets) {
            try {
                await this.loadDataset(dataset);
                // Yield to UI thread
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.error(`[DataManager] Failed to preload ${dataset}:`, error);
            }
        }

        console.log('[DataManager] Background preload complete');
    }, 3000); // Start after critical path (3s)
}
```

5. **Add helper methods**:
```javascript
getData(datasetName) {
    return this.cache.get(datasetName);
}

getCompanyData(ticker) {
    const companies = this.getData('M_Company');
    return companies?.find(c => c.Ticker === ticker);
}

async getEnrichedData(ticker, datasets) {
    const enriched = {};

    for (const dataset of datasets) {
        const data = await this.loadDataset(dataset);
        const row = data.find(r => r.Ticker === ticker);
        if (row) {
            enriched[dataset] = row;
        }
    }

    return enriched;
}
```

**Integration**:
```javascript
// In stock_analyzer_enhanced.js
async function init() {
    // OLD: Direct data loading
    // await loadData();

    // NEW: Use DataManager
    const dataManager = DataManager.getInstance();
    await dataManager.initialize();

    // Update global reference
    window.dataManager = dataManager;
    window.allData = dataManager.getData('M_Company');

    // Rest of initialization...
}
```

---

### Task 2: Implement CacheManager (2 days)

**File**: `modules/Core/CacheManager.js`

**Implementation**:

```javascript
class CacheManager {
    constructor() {
        this.memoryCache = new Map(); // L1
        this.sessionCache = sessionStorage; // L2
        this.maxMemorySizeMB = 50;
        this.currentSizeMB = 0;
    }

    get(key) {
        // L1: Memory cache
        if (this.memoryCache.has(key)) {
            const entry = this.memoryCache.get(key);
            entry.lastAccessed = Date.now();
            return entry.value;
        }

        // L2: SessionStorage
        try {
            const sessionData = this.sessionCache.getItem(key);
            if (sessionData) {
                const parsed = JSON.parse(sessionData);
                // Promote to L1
                this.set(key, parsed);
                return parsed;
            }
        } catch (e) {
            console.warn('[CacheManager] SessionStorage read failed:', e);
        }

        return null;
    }

    set(key, value, options = {}) {
        const entry = {
            value,
            lastAccessed: Date.now(),
            size: this.estimateSize(value)
        };

        // L1: Memory cache
        this.memoryCache.set(key, entry);
        this.currentSizeMB += entry.size;

        // Evict if needed
        this.evictIfNeeded();

        // L2: SessionStorage (for large datasets)
        if (entry.size > 1) { // > 1MB
            try {
                this.sessionCache.setItem(key, JSON.stringify(value));
            } catch (e) {
                console.warn('[CacheManager] SessionStorage write failed:', e);
            }
        }
    }

    estimateSize(obj) {
        // Rough estimate: 2 bytes per character in JSON
        const json = JSON.stringify(obj);
        return (json.length * 2) / 1024 / 1024; // MB
    }

    evictIfNeeded() {
        if (this.currentSizeMB <= this.maxMemorySizeMB) {
            return;
        }

        console.log(`[CacheManager] Memory pressure: ${this.currentSizeMB}MB / ${this.maxMemorySizeMB}MB`);

        // Get entries sorted by LRU
        const entries = Array.from(this.memoryCache.entries());
        entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        // Evict until under 80% capacity
        const target = this.maxMemorySizeMB * 0.8;
        while (this.currentSizeMB > target && entries.length > 0) {
            const [key, entry] = entries.shift();

            // Never evict M_Company
            if (key === 'M_Company') continue;

            this.memoryCache.delete(key);
            this.currentSizeMB -= entry.size;
            console.log(`[CacheManager] Evicted: ${key} (${entry.size.toFixed(2)}MB)`);
        }
    }

    clear() {
        this.memoryCache.clear();
        this.currentSizeMB = 0;
        try {
            this.sessionCache.clear();
        } catch (e) {
            console.warn('[CacheManager] SessionStorage clear failed:', e);
        }
    }
}
```

**Integration with DataManager**:
```javascript
// In DataManager constructor
this.cacheManager = new CacheManager();

// In loadDataset()
async loadDataset(name) {
    // Check CacheManager instead of Map
    const cached = this.cacheManager.get(name);
    if (cached) {
        return cached;
    }

    // Load data...
    const data = this.integratedData.data[category][name];

    // Cache using CacheManager
    this.cacheManager.set(name, data);

    return data;
}
```

---

### Task 3: Implement EventBus (1 day)

**File**: `modules/Core/EventBus.js`

**Implementation**:

```javascript
class EventBus {
    static instance = null;

    static getInstance() {
        if (!EventBus.instance) {
            EventBus.instance = new EventBus();
        }
        return EventBus.instance;
    }

    constructor() {
        this.listeners = new Map();
    }

    on(event, handler, options = {}) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        this.listeners.get(event).push({
            handler,
            once: options.once || false,
            priority: options.priority || 0
        });

        // Sort by priority (higher first)
        this.listeners.get(event).sort((a, b) => b.priority - a.priority);
    }

    off(event, handler) {
        if (!this.listeners.has(event)) return;

        const handlers = this.listeners.get(event);
        const index = handlers.findIndex(h => h.handler === handler);
        if (index !== -1) {
            handlers.splice(index, 1);
        }
    }

    async emit(event, data) {
        if (!this.listeners.has(event)) return;

        const handlers = this.listeners.get(event);

        for (const { handler, once } of handlers) {
            try {
                await handler(data);

                if (once) {
                    this.off(event, handler);
                }
            } catch (error) {
                console.error(`[EventBus] Error in ${event} handler:`, error);
            }
        }
    }
}
```

**Usage Examples**:

```javascript
// In DataManager
async loadDataset(name) {
    const data = ...; // Load data

    // Emit event
    const eventBus = EventBus.getInstance();
    eventBus.emit('data:loaded', {
        dataset: name,
        count: data.length
    });

    return data;
}

// In GrowthAnalytics
async initialize() {
    const eventBus = EventBus.getInstance();

    // Listen for data events
    eventBus.on('data:loaded', (payload) => {
        if (payload.dataset === 'T_Growth_C') {
            console.log('[GrowthAnalytics] Data ready, can initialize');
        }
    });

    // Load required data
    this.data = await dataManager.loadDataset('T_Growth_C');
}

// In RankingAnalytics
setupEventListeners() {
    eventBus.on('growth:high', (payload) => {
        // Update rankings when high-growth companies identified
        this.updateRankings(payload.companies);
    });
}
```

---

### Task 4: Implement RankingAnalytics Module (4 days)

**File**: `modules/RankingAnalytics.js`

**Step 1: Create base structure**:

```javascript
class RankingAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_Rank', 'M_Company'];
        this.currentMetric = 'ROE';
    }

    async initialize() {
        console.log('[RankingAnalytics] Initializing...');

        // Load required datasets
        await this.loadRequiredData();

        // Setup event listeners
        this.setupEventListeners();

        this.initialized = true;
        console.log('[RankingAnalytics] Initialization complete');
    }

    async loadRequiredData() {
        this.rankData = await this.dataManager.loadDataset('T_Rank');
        this.companyData = await this.dataManager.loadDataset('M_Company');
    }

    setupEventListeners() {
        // Listen for filter changes
        this.eventBus.on('filter:changed', (payload) => {
            this.applyFilter(payload);
        });
    }
}
```

**Step 2: Implement ranking logic**:

```javascript
// Get top N companies by metric
getTopRanked(metric, count = 50) {
    const rankField = `${metric}_Rank`;

    return this.rankData
        .filter(row => row[rankField] != null)
        .sort((a, b) => a[rankField] - b[rankField])
        .slice(0, count)
        .map(row => ({
            ticker: row.Ticker,
            corp: row.Corp,
            rank: row[rankField],
            value: row[metric]
        }));
}

// Multi-metric ranking with weights
getMultiMetricRanking(metrics, weights) {
    // metrics: ['ROE', 'OPM', 'Sales_Growth']
    // weights: [0.4, 0.3, 0.3]

    return this.rankData.map(row => {
        let score = 0;

        metrics.forEach((metric, i) => {
            const rankField = `${metric}_Rank`;
            const rank = row[rankField];

            if (rank != null) {
                // Normalize: rank 1 = score 1, rank N = score 0
                const normalizedScore = 1 - (rank / this.rankData.length);
                score += normalizedScore * weights[i];
            }
        });

        return {
            ticker: row.Ticker,
            corp: row.Corp,
            score,
            metrics: metrics.map(m => ({
                name: m,
                rank: row[`${m}_Rank`],
                value: row[m]
            }))
        };
    })
    .sort((a, b) => b.score - a.score);
}

// Sector-relative ranking
getSectorRanking(metric, sector) {
    const rankField = `${metric}_Rank`;

    return this.rankData
        .filter(row => row.WI26 === sector && row[rankField] != null)
        .sort((a, b) => a[rankField] - b[rankField])
        .map((row, index) => ({
            ticker: row.Ticker,
            corp: row.Corp,
            sectorRank: index + 1,
            overallRank: row[rankField],
            value: row[metric]
        }));
}
```

**Step 3: Implement rendering**:

```javascript
render(container) {
    const html = `
        <div class="ranking-dashboard">
            <div class="ranking-controls">
                <h4>📊 Company Rankings</h4>
                <div class="row mb-3">
                    <div class="col-md-6">
                        <label>Metric:</label>
                        <select id="ranking-metric" class="form-control">
                            <option value="ROE">Return on Equity (ROE)</option>
                            <option value="OPM">Operating Margin (OPM)</option>
                            <option value="Sales_Growth">Sales Growth</option>
                            <option value="EPS_Growth">EPS Growth</option>
                            <option value="FCF_Yield">Free Cash Flow Yield</option>
                        </select>
                    </div>
                    <div class="col-md-6">
                        <label>Show Top:</label>
                        <select id="ranking-count" class="form-control">
                            <option value="25">25</option>
                            <option value="50" selected>50</option>
                            <option value="100">100</option>
                        </select>
                    </div>
                </div>
                <button id="create-custom-ranking" class="btn btn-primary">
                    Create Custom Ranking
                </button>
            </div>

            <div id="ranking-chart" class="mt-4"></div>
            <div id="ranking-table" class="mt-4"></div>
        </div>
    `;

    container.innerHTML = html;

    // Attach event listeners
    this.attachEventListeners();

    // Initial render
    this.updateRanking();
}

attachEventListeners() {
    document.getElementById('ranking-metric').addEventListener('change', () => {
        this.updateRanking();
    });

    document.getElementById('ranking-count').addEventListener('change', () => {
        this.updateRanking();
    });

    document.getElementById('create-custom-ranking').addEventListener('click', () => {
        this.showCustomRankingModal();
    });
}

updateRanking() {
    const metric = document.getElementById('ranking-metric').value;
    const count = parseInt(document.getElementById('ranking-count').value);

    const topRanked = this.getTopRanked(metric, count);

    this.renderRankingChart(topRanked, metric);
    this.renderRankingTable(topRanked, metric);
}
```

**Step 4: Add chart rendering**:

```javascript
renderRankingChart(data, metric) {
    const container = document.getElementById('ranking-chart');

    const chartData = {
        labels: data.slice(0, 20).map(item => item.corp), // Top 20 for chart
        datasets: [{
            label: `${metric} Ranking`,
            data: data.slice(0, 20).map(item => item.value),
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 2
        }]
    };

    // Destroy existing chart
    if (this.chart) {
        this.chart.destroy();
    }

    // Create new chart
    const canvas = document.createElement('canvas');
    container.innerHTML = '';
    container.appendChild(canvas);

    this.chart = new Chart(canvas, {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Top 20 Companies by ${metric}`
                },
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

renderRankingTable(data, metric) {
    const container = document.getElementById('ranking-table');

    let html = `
        <table class="table table-striped table-hover">
            <thead>
                <tr>
                    <th>Rank</th>
                    <th>Ticker</th>
                    <th>Company</th>
                    <th>${metric}</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
    `;

    data.forEach((item, index) => {
        html += `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${item.ticker}</strong></td>
                <td>${item.corp}</td>
                <td>${item.value != null ? item.value.toFixed(2) : 'N/A'}</td>
                <td>
                    <button class="btn btn-sm btn-primary"
                            onclick="showCompanyDetail('${item.ticker}')">
                        View
                    </button>
                </td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    container.innerHTML = html;
}
```

---

### Task 5: Integration Testing (2 days)

**Test Cases**:

1. **DataManager Loading**:
```javascript
// Test: M_Company loads in <3s
const start = performance.now();
await dataManager.initialize();
const duration = performance.now() - start;
assert(duration < 3000, 'Initial load should be <3s');

// Test: Cache hit is instant
const start2 = performance.now();
const data = dataManager.getData('M_Company');
const duration2 = performance.now() - start2;
assert(duration2 < 10, 'Cache hit should be <10ms');
```

2. **CacheManager Eviction**:
```javascript
// Test: Eviction works under memory pressure
cacheManager.maxMemorySizeMB = 10; // Lower limit for testing

// Load datasets until eviction
for (const dataset of ['T_Growth_C', 'T_Rank', 'T_EPS_C', ...]) {
    await dataManager.loadDataset(dataset);
}

// Check that cache is under limit
assert(cacheManager.currentSizeMB < 10, 'Cache should be under limit');
```

3. **EventBus Communication**:
```javascript
// Test: Events propagate correctly
let received = false;

eventBus.on('test:event', (data) => {
    received = true;
});

eventBus.emit('test:event', { test: true });

await new Promise(resolve => setTimeout(resolve, 100));
assert(received, 'Event should be received');
```

4. **Module Activation Performance**:
```javascript
// Test: Module activation <500ms (cached)
await dataManager.loadDataset('T_Rank'); // Preload

const start = performance.now();
const rankingAnalytics = new RankingAnalytics(dataManager, eventBus);
await rankingAnalytics.initialize();
const duration = performance.now() - start;

assert(duration < 500, 'Module activation should be <500ms when cached');
```

---

## Common Patterns

### Pattern 1: Creating a New Analytics Module

```javascript
// 1. Extend BaseAnalyticsModule
class MyAnalytics extends BaseAnalyticsModule {
    constructor(dataManager, eventBus) {
        super(dataManager, eventBus);
        this.requiredDatasets = ['T_MyData', 'M_Company'];
    }

    // 2. Implement initialize()
    async initialize() {
        await this.loadRequiredData();
        this.setupEventListeners();
        this.initialized = true;
    }

    // 3. Implement render()
    render(container) {
        container.innerHTML = `<div>My Analytics</div>`;
    }

    // 4. Add your analysis methods
    analyzeData() {
        const data = this.data['T_MyData'];
        // Your analysis logic...
    }
}

// 5. Register module
moduleRegistry.register('MyAnalytics', MyAnalytics);
```

### Pattern 2: Cross-Module Communication

```javascript
// Module A: Emit event after analysis
class ModuleA extends BaseAnalyticsModule {
    performAnalysis() {
        const results = this.analyze();

        this.eventBus.emit('analysis:complete', {
            module: 'ModuleA',
            results: results
        });
    }
}

// Module B: Listen for event
class ModuleB extends BaseAnalyticsModule {
    setupEventListeners() {
        this.eventBus.on('analysis:complete', (payload) => {
            if (payload.module === 'ModuleA') {
                this.updateWithNewData(payload.results);
            }
        });
    }
}
```

### Pattern 3: Enriched Data Access

```javascript
// Get data from multiple datasets for a single ticker
async getCompanyInsights(ticker) {
    const enriched = await this.dataManager.getEnrichedData(ticker, [
        'M_Company',
        'T_Growth_C',
        'T_Rank',
        'T_EPS_C'
    ]);

    return {
        company: enriched['M_Company'],
        growth: enriched['T_Growth_C'],
        ranking: enriched['T_Rank'],
        eps: enriched['T_EPS_C']
    };
}
```

---

## Performance Checklist

**Before Committing**:

- [ ] Initial load < 3 seconds (measure with Performance API)
- [ ] Module activation < 500ms for cached data
- [ ] Memory usage < 100MB (check with performance.memory)
- [ ] No memory leaks (run extended session, monitor growth)
- [ ] Cache eviction works (test under pressure)
- [ ] All events propagate correctly
- [ ] Error handling covers edge cases

**Measurement**:
```javascript
// Add to each module
const start = performance.now();
// ... your code ...
const duration = performance.now() - start;
console.log(`[Performance] Operation took ${duration.toFixed(2)}ms`);

// Memory
if (performance.memory) {
    console.log(`[Memory] Used: ${(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`);
}
```

---

## Debugging Tips

**Enable verbose logging**:
```javascript
// Add to top of DataManager
const DEBUG = true;

if (DEBUG) {
    console.log('[DataManager] Detailed debug info...');
}
```

**Inspect cache state**:
```javascript
// In browser console
dataManager.cacheManager.memoryCache.forEach((entry, key) => {
    console.log(`${key}: ${entry.size.toFixed(2)}MB, last accessed ${Date.now() - entry.lastAccessed}ms ago`);
});
```

**Monitor events**:
```javascript
// Log all events
eventBus.on('*', (event, data) => {
    console.log(`[Event] ${event}:`, data);
});
```

---

## Next Steps

**After Sprint 4**:
1. Implement IndexManager (Sprint 5)
2. Add EPSAnalytics module (Sprint 5)
3. Add CashFlowAnalytics module (Sprint 5)
4. Continue with A/B Tier modules (Sprint 6+)

**Resources**:
- Full architecture: SYSTEM_ARCHITECTURE.md
- Diagrams: ARCHITECTURE_DIAGRAMS.md
- Data strategy: DATA_UTILIZATION_STRATEGY.md

---

**Document Version**: 2.0
**Last Updated**: 2025-10-17
**Status**: Ready for Implementation ✅
