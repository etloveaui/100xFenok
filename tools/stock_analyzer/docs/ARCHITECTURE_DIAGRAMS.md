# Architecture Diagrams
## Visual Reference for Stock Analyzer System

**Version**: 2.0
**Date**: 2025-10-17
**Companion to**: SYSTEM_ARCHITECTURE.md

---

## 1. Data Flow Architecture

### 1.1 Request Flow (User → Data)

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER ACTION                              │
│         (Click tab, Search, Filter, Sort, Compare)               │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    UI EVENT HANDLERS                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  onClick    │  │  onSearch   │  │  onFilter   │            │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘            │
└─────────┼─────────────────┼─────────────────┼───────────────────┘
          │                 │                 │
          └─────────────────┴─────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      EVENT BUS                                   │
│     emit('module:activate', { name: 'GrowthAnalytics' })        │
│     emit('filter:changed', { field: 'sector', value: '반도체' })│
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MODULE REGISTRY                               │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  getModule('GrowthAnalytics')                              │ │
│  │  → Check if initialized                                     │ │
│  │  → If not: module.initialize()                             │ │
│  │  → If yes: module.activate()                               │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                 ANALYTICS MODULE                                 │
│                 (e.g., GrowthAnalytics)                          │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  initialize() {                                            │ │
│  │    this.data = await dataManager.loadDataset('T_Growth_C')│ │
│  │  }                                                         │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA MANAGER                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  loadDataset('T_Growth_C') {                               │ │
│  │    1. Check cacheManager.get('T_Growth_C')                │ │
│  │    2. If cached: return immediately                        │ │
│  │    3. If not: fetch from integrated JSON                   │ │
│  │    4. Build index in indexManager                          │ │
│  │    5. Cache in cacheManager                                │ │
│  │    6. Return data                                          │ │
│  │  }                                                         │ │
│  └────────────────────────┬───────────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────────┘
                            │
           ┌────────────────┴────────────────┐
           │                                  │
           ▼                                  ▼
┌─────────────────────┐            ┌─────────────────────┐
│   CACHE MANAGER     │            │   INDEX MANAGER     │
│                     │            │                     │
│  L1: Memory Cache   │            │  ticker → datasets  │
│  L2: SessionStorage │            │  sector → tickers   │
│  L3: IndexedDB      │            │  exchange → tickers │
└──────────┬──────────┘            └──────────┬──────────┘
           │                                  │
           └────────────────┬─────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│              GLOBAL_SCOUTER_INTEGRATED.JSON                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  {                                                         │ │
│  │    "metadata": { "total_files": 21 },                     │ │
│  │    "data": {                                               │ │
│  │      "main": { "M_Company": [...] },                       │ │
│  │      "technical": { "T_Growth_C": [...], "T_Rank": [...] }│ │
│  │      ...                                                   │ │
│  │    }                                                       │ │
│  │  }                                                         │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Module Initialization Flow

### 2.1 Application Startup Sequence

```
TIME: 0ms
┌─────────────────────────────────────────────────────────────────┐
│  1. DOMContentLoaded Event                                       │
│     └─> init() called                                            │
└────────────────────────┬────────────────────────────────────────┘
                         │
TIME: 50ms               ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Core System Initialization                                   │
│     ├─> DataManager.getInstance()                                │
│     ├─> EventBus.getInstance()                                   │
│     ├─> CacheManager.getInstance()                               │
│     └─> IndexManager.getInstance()                               │
└────────────────────────┬────────────────────────────────────────┘
                         │
TIME: 100ms              ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. Critical Path Data Loading                                   │
│     └─> DataManager.loadDataset('M_Company')                     │
│         ├─> Check SessionStorage cache                           │
│         ├─> If not cached: fetch from integrated JSON            │
│         ├─> Parse 6,175 rows                                     │
│         ├─> Build ticker index                                   │
│         └─> Cache in L1 + L2                                     │
└────────────────────────┬────────────────────────────────────────┘
                         │
TIME: 2000ms             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Initial UI Render                                            │
│     ├─> renderMainTable(M_Company data)                          │
│     ├─> renderScreenerPanel()                                    │
│     └─> initialize supporting modules:                           │
│         ├─> ColumnManager                                        │
│         ├─> FilterManager                                        │
│         └─> ResponsiveManager                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
TIME: 3000ms ✅          ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. CRITICAL PATH COMPLETE - App Usable                          │
│     └─> emit('app:ready')                                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ├─────────────────────────────────────────┐
TIME: 3000-10000ms       │                                         │
┌────────────────────────▼───────────────┐  ┌─────────────────────▼────┐
│  6a. Background Preloading (S Tier)    │  │  6b. Lazy Module Init    │
│      └─> Preload in sequence:          │  │      └─> User triggers:  │
│          ├─> T_Growth_C (1.5s)         │  │          ├─> GrowthAnalytics│
│          ├─> T_Rank (1s)               │  │          ├─> RankingAnalytics│
│          ├─> T_EPS_C (1s)              │  │          └─> etc.         │
│          └─> T_CFO (1s)                │  │                           │
│      Total: ~5s background             │  │      On-demand: 200-500ms │
└────────────────────────────────────────┘  └──────────────────────────┘
                         │
TIME: 10000ms+           ▼
┌─────────────────────────────────────────────────────────────────┐
│  7. Full Application Ready                                       │
│     ├─> All S Tier datasets cached                               │
│     ├─> All core modules initialized                             │
│     └─> User can activate any feature instantly                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Module Activation (On-Demand)

```
USER CLICKS "Growth Analytics" TAB
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  ModuleRegistry.activate('GrowthAnalytics')                      │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
                   ┌──────────┐
                   │ Initialized? │
                   └──────┬───────┘
                          │
              ┌───────────┴───────────┐
              │                       │
             YES                     NO
              │                       │
              ▼                       ▼
    ┌──────────────────┐    ┌──────────────────┐
    │ FAST PATH        │    │ SLOW PATH        │
    │ (< 100ms)        │    │ (200-500ms)      │
    ├──────────────────┤    ├──────────────────┤
    │ 1. Get module    │    │ 1. new GrowthAnalytics()│
    │ 2. activate()    │    │ 2. initialize()  │
    │ 3. render()      │    │    └─> loadDataset()│
    │                  │    │        (cache hit!)│
    │ Already cached   │    │ 3. activate()    │
    │ Data ready       │    │ 4. render()      │
    └────────┬─────────┘    └────────┬─────────┘
             │                       │
             └───────────┬───────────┘
                         │
                         ▼
           ┌──────────────────────────┐
           │  emit('module:activated')│
           │  { name: 'GrowthAnalytics' }│
           └──────────┬───────────────┘
                      │
                      ▼
           ┌──────────────────────────┐
           │  Update UI               │
           │  - Hide previous module  │
           │  - Show new module       │
           │  - Update navigation     │
           └──────────────────────────┘
```

---

## 3. Data Layer Architecture

### 3.1 Cache Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                    CACHE HIERARCHY (3 Tiers)                     │
└─────────────────────────────────────────────────────────────────┘

L1: MEMORY CACHE (Fast, Volatile)
╔═════════════════════════════════════════════════════════════════╗
║  Max Size: 50MB                                                  ║
║  Eviction: LRU (Least Recently Used)                             ║
║  Access Time: < 1ms                                              ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ M_Company (15MB) - ALWAYS RESIDENT                          │║
║  │ T_Growth_C (3MB) - S Tier (preloaded)                       │║
║  │ T_Rank (3MB) - S Tier (preloaded)                           │║
║  │ T_EPS_C (3MB) - S Tier (preloaded)                          │║
║  │ T_CFO (3MB) - S Tier (preloaded)                            │║
║  │ [Active Module Data] (10MB) - Currently in use              │║
║  │ [Query Results Cache] (5MB) - Recent queries                │║
║  │ [Reserve] (8MB) - For new activations                       │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
                          │
                          │ Cache miss
                          ▼
L2: SESSION STORAGE (Persistent within session)
╔═════════════════════════════════════════════════════════════════╗
║  Max Size: 10MB                                                  ║
║  Eviction: Manual on memory pressure                             ║
║  Access Time: 5-10ms                                             ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ S Tier Datasets (compressed JSON)                           │║
║  │ User Preferences (filters, sorts, column config)            │║
║  │ Module State (last active module, scroll position)          │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
                          │
                          │ Cache miss
                          ▼
L3: INDEXED DB (Future - Persistent across sessions)
╔═════════════════════════════════════════════════════════════════╗
║  Max Size: 500MB                                                 ║
║  Eviction: TTL-based (time-to-live)                              ║
║  Access Time: 20-50ms                                            ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ Historical Data Archives                                     │║
║  │ User Portfolios                                              │║
║  │ Offline Mode Cache (full datasets)                          │║
║  │ Large Query Results                                          │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
                          │
                          │ Cache miss (or first load)
                          ▼
SOURCE: INTEGRATED JSON FILE
╔═════════════════════════════════════════════════════════════════╗
║  global_scouter_integrated.json (~150MB uncompressed)            ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ 21 CSV files consolidated                                   │║
║  │ - main: M_Company, M_ETFs                                   │║
║  │ - technical: T_Rank, T_Growth_C, T_EPS_C, T_CFO, etc.       │║
║  │ - analysis: A_Company, A_Compare, A_Contrast, etc.          │║
║  │ - market: S_Chart, S_Mylist, S_Valuation, UP_&_Down         │║
║  │ - indicators: E_Indicators                                  │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
```

### 3.2 Index Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                     INDEX MANAGER                                │
│              (Fast lookups across all datasets)                  │
└─────────────────────────────────────────────────────────────────┘

PRIMARY INDEX: Ticker → Datasets
╔═════════════════════════════════════════════════════════════════╗
║  Map<string, Array<DatasetReference>>                            ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ "AAPL" → [                                                  │║
║  │   { dataset: "M_Company", row: {...} },                     │║
║  │   { dataset: "T_Growth_C", row: {...} },                    │║
║  │   { dataset: "T_Rank", row: {...} },                        │║
║  │   { dataset: "T_EPS_C", row: {...} },                       │║
║  │   ...                                                        │║
║  │ ]                                                            │║
║  │                                                              │║
║  │ "NVDA" → [...]                                              │║
║  │ "MSFT" → [...]                                              │║
║  │ ...                                                          │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
           │
           │ Supports: getByTicker('AAPL') → All data for AAPL
           │

SECONDARY INDEX: Sector → Tickers
╔═════════════════════════════════════════════════════════════════╗
║  Map<string, Set<string>>                                        ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ "반도체" → Set("NVDA", "AMD", "INTC", "TSM", ...)          │║
║  │ "소프트웨어" → Set("MSFT", "ORCL", "SAP", "ADBE", ...)     │║
║  │ "자동차" → Set("TSLA", "F", "GM", "TM", ...)               │║
║  │ ...                                                          │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
           │
           │ Supports: getBySector('반도체') → All semiconductor stocks
           │

TERTIARY INDEX: Exchange → Tickers
╔═════════════════════════════════════════════════════════════════╗
║  Map<string, Set<string>>                                        ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ "NASDAQ" → Set("AAPL", "MSFT", "GOOGL", "NVDA", ...)       │║
║  │ "NYSE" → Set("BAC", "JPM", "XOM", "JNJ", ...)              │║
║  │ "KRX" → Set("005930", "000660", "035420", ...)             │║
║  │ ...                                                          │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
           │
           │ Supports: getByExchange('NASDAQ') → All NASDAQ stocks
           │

CUSTOM INDEXES: User-defined
╔═════════════════════════════════════════════════════════════════╗
║  Map<string, Map<any, Set<string>>>                              ║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ "highGrowth" → Map(                                         │║
║  │   true → Set("NVDA", "TSLA", ...),                          │║
║  │   false → Set(...)                                          │║
║  │ )                                                            │║
║  │                                                              │║
║  │ "valuation" → Map(                                          │║
║  │   "undervalued" → Set(...),                                 │║
║  │   "fair" → Set(...),                                        │║
║  │   "overvalued" → Set(...)                                   │║
║  │ )                                                            │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
           │
           │ Supports: Custom queries like "all high-growth undervalued stocks"
           │

QUERY OPTIMIZATION: Multi-field queries
╔═════════════════════════════════════════════════════════════════╗
║  query({ sector: '반도체', exchange: 'NASDAQ', growth: 'high' })║
║  ┌─────────────────────────────────────────────────────────────┐║
║  │ Step 1: Get sector tickers → Set A                         │║
║  │ Step 2: Get exchange tickers → Set B                        │║
║  │ Step 3: Get high growth tickers → Set C                    │║
║  │ Step 4: Intersection: A ∩ B ∩ C → Result Set               │║
║  │ Step 5: Fetch full data from primary index                 │║
║  │ Time: O(n) where n = result set size (typically < 100)     │║
║  └─────────────────────────────────────────────────────────────┘║
╚═════════════════════════════════════════════════════════════════╝
```

---

## 4. Module Communication Architecture

### 4.1 Event-Driven Communication

```
┌─────────────────────────────────────────────────────────────────┐
│                         EVENT BUS                                │
│                    (Central Communication Hub)                   │
└─────────────────────────────────────────────────────────────────┘
           ↑                     ↑                     ↑
           │                     │                     │
    emit() │              emit() │              emit() │
           │                     │                     │
┌──────────┴────────┐  ┌────────┴────────┐  ┌────────┴────────┐
│  GrowthAnalytics  │  │ RankingAnalytics│  │  EPSAnalytics   │
│                   │  │                 │  │                 │
│  - Analyzes       │  │  - Ranks        │  │  - EPS growth   │
│    growth rates   │  │    companies    │  │  - PER bands    │
│                   │  │    by metrics   │  │                 │
│  Emits:           │  │                 │  │  Emits:         │
│  'growth:high'    │  │  Emits:         │  │  'eps:quality'  │
│  'growth:sector'  │  │  'rank:top100'  │  │  'eps:surprise' │
└────────┬──────────┘  └────────┬────────┘  └────────┬────────┘
         │                      │                     │
         │ on()                 │ on()                │ on()
         │                      │                     │
         └──────────────────────┴─────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  EVENT LISTENERS (Cross-Module)                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ RankingAnalytics.on('growth:high', (data) => {            │ │
│  │   // Update rankings with high-growth companies            │ │
│  │   this.updateRankings(data);                               │ │
│  │ });                                                        │ │
│  │                                                            │ │
│  │ DeepCompare.on('growth:sector', (data) => {               │ │
│  │   // Add sector average to comparison                      │ │
│  │   this.addSectorBenchmark(data);                           │ │
│  │ });                                                        │ │
│  │                                                            │ │
│  │ Dashboard.on('rank:top100', (data) => {                   │ │
│  │   // Update top performers widget                          │ │
│  │   this.refreshTopPerformers(data);                         │ │
│  │ });                                                        │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

Example: User filters by "high growth" in GrowthAnalytics
┌──────────────────────────────────────────────────────────────────┐
│  1. GrowthAnalytics identifies high-growth companies             │
│     └─> companies = this.getHighGrowthCompanies(threshold=20)    │
│                                                                   │
│  2. Emit event with results                                      │
│     └─> eventBus.emit('growth:high', {                           │
│           companies: companies,                                  │
│           threshold: 20,                                         │
│           count: companies.length                                │
│         })                                                       │
│                                                                   │
│  3. RankingAnalytics receives event                              │
│     └─> Automatically updates rankings to include growth score   │
│                                                                   │
│  4. DeepCompare receives event                                   │
│     └─> Suggests high-growth companies for comparison            │
│                                                                   │
│  5. Dashboard receives event                                     │
│     └─> Updates "High Growth Stocks" widget                      │
│                                                                   │
│  Result: One action triggers coordinated updates across modules  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Shared Data Access

```
                    ┌─────────────────┐
                    │  DATA MANAGER   │
                    │  (Shared State) │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │  Module A   │  │  Module B   │  │  Module C   │
    └─────────────┘  └─────────────┘  └─────────────┘
         │                  │                  │
         │ getData()        │ getData()        │ getData()
         │                  │                  │
         └──────────────────┴──────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  CACHE MANAGER  │
                    │  (Single Source)│
                    └─────────────────┘

Benefits:
✅ Single source of truth
✅ No data duplication
✅ Automatic cache management
✅ Cross-module consistency
```

---

## 5. Performance Flow Diagram

### 5.1 Critical Path Optimization

```
GOAL: Initial Load < 3 seconds

TIME: 0ms ─────────────────────────────────────────────────────────
START
│
├─> [200ms] Render app shell (HTML/CSS only)
│   └─> Empty table, loading indicators
│
├─> [1500ms] Load M_Company.csv (CRITICAL)
│   ├─> Check SessionStorage cache (50ms)
│   ├─> If cached: parse JSON (100ms) ✅
│   ├─> If not: fetch + parse (1500ms) ❌
│   └─> Build ticker index (100ms)
│
├─> [800ms] Render main table
│   ├─> Filter top 50 rows (10ms)
│   ├─> Generate HTML (300ms)
│   ├─> Insert DOM (400ms)
│   └─> Apply styles (90ms)
│
├─> [300ms] Initialize core modules
│   ├─> ColumnManager (100ms)
│   ├─> FilterManager (100ms)
│   └─> ResponsiveManager (100ms)
│
└─> [200ms] Event binding + finalization
    └─> Attach event listeners
    └─> Emit 'app:ready'

TIME: 3000ms ───────────────────────────────────────────────────────
CRITICAL PATH COMPLETE ✅ App is usable

─── BACKGROUND TASKS (non-blocking) ───────────────────────────────

├─> [5000ms] Preload S Tier datasets (BACKGROUND)
│   ├─> T_Growth_C (1200ms) - Parallel fetch
│   ├─> T_Rank (1000ms)
│   ├─> T_EPS_C (1300ms)
│   └─> T_CFO (1500ms)
│   (Total wall time: 1500ms due to parallel loading)
│
├─> [2000ms] Initialize analytics modules (LAZY)
│   ├─> GrowthAnalytics (if cached: 200ms, else: 1500ms)
│   ├─> RankingAnalytics (if cached: 200ms, else: 1200ms)
│   └─> etc.
│
└─> [Ongoing] Performance monitoring
    └─> Memory usage, load times, user interactions

TIME: 10000ms+ ─────────────────────────────────────────────────────
FULL APPLICATION READY ✅ All features available
```

### 5.2 Module Activation Performance

```
SCENARIO 1: First Activation (Cold Start)
┌────────────────────────────────────────────┐
│ User clicks "Growth Analytics" tab         │
└─────────────────┬──────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │ Module not initialized     │
    └─────────────┬──────────────┘
                  │
    [100ms] Show loading indicator
    [1200ms] Load T_Growth_C dataset
    [50ms] Build indexes
    [150ms] Initialize module state
    [300ms] Render charts/tables
    ──────────────────────────────
    TOTAL: 1800ms ❌ (Over budget: 500ms)

SCENARIO 2: Subsequent Activation (Warm Cache)
┌────────────────────────────────────────────┐
│ User clicks "Growth Analytics" tab again   │
└─────────────────┬──────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │ Module already initialized │
    │ Data already cached        │
    └─────────────┬──────────────┘
                  │
    [10ms] Check cache (HIT ✅)
    [50ms] Activate module
    [200ms] Render (DOM updates only)
    ──────────────────────────────
    TOTAL: 260ms ✅ (Under budget: 500ms)

SCENARIO 3: Preloaded Module (Best Case)
┌────────────────────────────────────────────┐
│ User clicks "Growth Analytics" tab         │
│ (After background preload complete)        │
└─────────────────┬──────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │ Module not initialized     │
    │ BUT data already preloaded │
    └─────────────┬──────────────┘
                  │
    [10ms] Check cache (HIT ✅)
    [50ms] Initialize module state
    [200ms] Render charts/tables
    ──────────────────────────────
    TOTAL: 260ms ✅ (Under budget: 500ms)

OPTIMIZATION: Preload S Tier datasets in background
             → Reduces first activation from 1800ms to 260ms
             → 85% improvement ✅
```

---

## 6. Memory Management

### 6.1 Memory Budget Allocation

```
┌─────────────────────────────────────────────────────────────────┐
│              TOTAL MEMORY BUDGET: 100MB                          │
└─────────────────────────────────────────────────────────────────┘

╔═══════════════════════════════════════════════════════════════╗
║  TIER: CRITICAL (Always Resident)                              ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │ M_Company (6,175 rows × 34 cols)                15MB      │ ║
║  │ Core System (DataManager, EventBus, etc.)        5MB      │ ║
║  │ UI Framework (HTML/CSS/JS)                       5MB      │ ║
║  │                                          TOTAL: 25MB      │ ║
║  └───────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════╗
║  TIER: S (Preloaded, High Priority)                            ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │ T_Growth_C (1,252 rows × 50 cols)                3MB      │ ║
║  │ T_Rank (1,252 rows × 38 cols)                    3MB      │ ║
║  │ T_EPS_C (1,252 rows × 41 cols)                   3MB      │ ║
║  │ T_CFO (1,266 rows × 36 cols)                     3MB      │ ║
║  │                                          TOTAL: 12MB      │ ║
║  └───────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════╗
║  TIER: A (On-Demand, Medium Priority)                          ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │ A_Company (1,252 rows × 52 cols)                 4MB      │ ║
║  │ T_Chk (1,252 rows × 78 cols)                     5MB      │ ║
║  │ T_Correlation (1,251 rows × 42 cols)             3MB      │ ║
║  │ A_Distribution (1,177 rows × 61 cols)            3MB      │ ║
║  │                                          TOTAL: 15MB      │ ║
║  │                            (Load 2-3 at a time max)       │ ║
║  └───────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════╗
║  TIER: B (Lazy, Low Priority)                                  ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │ 10 smaller datasets (avg 100 rows each)         10MB      │ ║
║  │                            (Load 1-2 at a time max)       │ ║
║  └───────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝

╔═══════════════════════════════════════════════════════════════╗
║  DYNAMIC ALLOCATION                                             ║
║  ┌───────────────────────────────────────────────────────────┐ ║
║  │ Active Module State                              5MB      │ ║
║  │ Query Result Cache                               5MB      │ ║
║  │ Chart.js Canvases                                8MB      │ ║
║  │ DOM Nodes                                        5MB      │ ║
║  │ Reserve (for peaks)                             10MB      │ ║
║  │                                          TOTAL: 33MB      │ ║
║  └───────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════╝

TOTAL ALLOCATION:
  Critical:  25MB
  S Tier:    12MB
  A Tier:    15MB (partial)
  B Tier:    10MB (partial)
  Dynamic:   33MB
  ───────────────
  TOTAL:    ~95MB ✅ (Under 100MB budget)
```

### 6.2 Eviction Strategy

```
MEMORY PRESSURE DETECTED (>85% usage)
           │
           ▼
┌─────────────────────────────────────────┐
│  Step 1: Identify Eviction Candidates   │
│  ┌─────────────────────────────────────┐│
│  │ - B Tier datasets (lowest priority) ││
│  │ - Inactive module state             ││
│  │ - Old query results                 ││
│  └─────────────────────────────────────┘│
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Step 2: Calculate LRU Scores           │
│  ┌─────────────────────────────────────┐│
│  │ score = (now - lastAccessed) / size ││
│  │ Higher score = more likely evicted  ││
│  └─────────────────────────────────────┘│
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Step 3: Evict Until <80% Usage         │
│  ┌─────────────────────────────────────┐│
│  │ while (usage > 80%) {               ││
│  │   evict(highestLRU);                ││
│  │   usage = calculateUsage();         ││
│  │ }                                   ││
│  └─────────────────────────────────────┘│
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  Step 4: Log Eviction Event             │
│  └─> eventBus.emit('cache:evicted', {   │
│        datasets: [...],                  │
│        freedMB: 15                       │
│      })                                  │
└──────────────────────────────────────────┘

PROTECTION: Never evict
  ✅ M_Company (critical)
  ✅ Currently active module data
  ✅ S Tier datasets (if accessed recently)
```

---

## 7. Extensibility Architecture

### 7.1 Plugin System

```
┌─────────────────────────────────────────────────────────────────┐
│                       PLUGIN MANAGER                             │
│                  (Dynamic Module Registration)                   │
└─────────────────────────────────────────────────────────────────┘
           │
           │ register(plugin)
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│  PLUGIN REGISTRY                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Map<string, Plugin>                                        │ │
│  │ {                                                          │ │
│  │   'GrowthAnalytics': GrowthAnalyticsPlugin,                │ │
│  │   'RankingAnalytics': RankingAnalyticsPlugin,              │ │
│  │   'CustomAnalytics': CustomAnalyticsPlugin, // User plugin │ │
│  │   ...                                                      │ │
│  │ }                                                          │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

PLUGIN INTERFACE (All plugins must implement):
┌─────────────────────────────────────────────────────────────────┐
│  class Plugin {                                                  │
│    static metadata = {                                           │
│      name: 'MyPlugin',                                          │
│      version: '1.0.0',                                          │
│      requiredDatasets: ['T_Custom'],                            │
│      tier: 'C'                                                  │
│    };                                                           │
│                                                                  │
│    async initialize(dataManager, eventBus) { /* ... */ }        │
│    render(container) { /* ... */ }                              │
│    update(filters) { /* ... */ }                                │
│    cleanup() { /* ... */ }                                      │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘

HOOK SYSTEM (Extend core behavior):
┌─────────────────────────────────────────────────────────────────┐
│  pluginManager.registerHook('data:enriched', async (data) => {   │
│    // Custom enrichment logic                                   │
│    return enhancedData;                                         │
│  });                                                            │
│                                                                  │
│  pluginManager.registerHook('module:render', async (html) => {   │
│    // Inject custom HTML                                        │
│    return modifiedHTML;                                         │
│  });                                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Error Handling & Recovery

### 8.1 Error Flow

```
ERROR OCCURS (e.g., network failure, parse error)
           │
           ▼
┌─────────────────────────────────────────┐
│  Try/Catch Block                        │
│  ┌─────────────────────────────────────┐│
│  │ try {                               ││
│  │   await dataManager.loadDataset()   ││
│  │ } catch (error) {                   ││
│  │   errorHandler.handle(error);       ││
│  │ }                                   ││
│  └─────────────────────────────────────┘│
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│  ErrorHandler.handle(error)             │
│  ┌─────────────────────────────────────┐│
│  │ 1. Classify error type:             ││
│  │    - NetworkError                   ││
│  │    - ParseError                     ││
│  │    - ModuleError                    ││
│  │    - Unknown                        ││
│  │                                     ││
│  │ 2. Determine severity:              ││
│  │    - CRITICAL (blocks app)          ││
│  │    - HIGH (blocks feature)          ││
│  │    - MEDIUM (degraded)              ││
│  │    - LOW (cosmetic)                 ││
│  └─────────────────────────────────────┘│
└─────────────────┬───────────────────────┘
                  │
      ┌───────────┴───────────┐
      │                       │
   CRITICAL              NON-CRITICAL
      │                       │
      ▼                       ▼
┌──────────────┐       ┌──────────────┐
│ Show Error   │       │ Log Error    │
│ Screen       │       │ Show Toast   │
│              │       │ Continue     │
│ Offer Reload │       │ Operation    │
└──────────────┘       └──────────────┘
```

---

**Document Version**: 2.0
**Last Updated**: 2025-10-17
**Companion to**: SYSTEM_ARCHITECTURE.md
