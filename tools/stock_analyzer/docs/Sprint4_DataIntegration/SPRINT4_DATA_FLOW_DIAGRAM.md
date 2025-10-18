# Sprint 4 Data Flow Diagram

**Project**: Stock Analyzer - 100xFenok
**Purpose**: Visual representation of current and proposed data architecture
**Date**: 2025-10-18

---

## Current State: Data Flow (INCOMPLETE)

```
┌─────────────────────────────────────────────────────────────────┐
│                    stock_analyzer.html                          │
│                                                                 │
│  <script src="js/analytics/GrowthAnalytics.js"></script>       │
│  <script src="js/analytics/RankingAnalytics.js"></script>      │
│  <script src="js/analytics/EPSAnalytics.js"></script>          │
│  <script src="js/DashboardManager.js"></script>                │
│  <script src="modules/CFOAnalytics.js"></script>               │
│  <script src="modules/CorrelationEngine.js"></script>          │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    loadData() function
                              ↓
            fetch('data/global_scouter_integrated.json')
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         global_scouter_integrated.json (INCOMPLETE)             │
│                                                                 │
│  {                                                              │
│    "metadata": {                                                │
│      "totalCompanies": 6176                                     │
│    },                                                           │
│    "data": {                                                    │
│      "main": [ ... 6,176 companies ... ]  ✅ EXISTS            │
│      "technical": { ... }  ❌ MISSING                           │
│    }                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                   window.allData = jsonData.data.main
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                     window.dataManager                          │
│                                                                 │
│  {                                                              │
│    companies: [                                                 │
│      { ticker, name, sector, marketCap },                       │
│      ... 6,176 companies                                        │
│    ]                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
          ┌───────────────────┴───────────────────────────┐
          ↓                   ↓              ↓            ↓
┌──────────────────┐  ┌──────────────┐  ┌─────────┐  ┌──────────┐
│ GrowthAnalytics  │  │EPSAnalytics  │  │Ranking  │  │CFO       │
│                  │  │              │  │Analytics│  │Analytics │
│ Expects:         │  │ Expects:     │  │         │  │          │
│ data.technical   │  │ data.tech    │  │Expects: │  │Expects:  │
│ .T_Growth_C      │  │ .T_EPS_C     │  │data.tech│  │data.tech │
│                  │  │              │  │.T_Rank  │  │.T_CFO    │
│ ❌ NOT FOUND     │  │ ❌ NOT FOUND │  │❌ NOT   │  │❌ NOT    │
│ Returns false    │  │ Returns false│  │FOUND    │  │FOUND     │
└──────────────────┘  └──────────────┘  └─────────┘  └──────────┘

          ↓
┌─────────────────────────────────────────────────────────────────┐
│  Unused Individual JSON Files (NOT LOADED BY APPLICATION)       │
│                                                                 │
│  data/T_EPS_C.json         (1,250 companies)  ⏳ Not loaded    │
│  data/T_Growth_C.json      (1,250 companies)  ⏳ Not loaded    │
│  data/T_Rank.json          (1,250 companies)  ⏳ Not loaded    │
│  data/T_CFO.json           (1,264 companies)  ⏳ Not loaded    │
│  data/T_Correlation.json   (1,249 companies)  ⏳ Not loaded    │
└─────────────────────────────────────────────────────────────────┘

RESULT: All analytics modules fail to initialize due to missing
        data.technical section in global_scouter_integrated.json
```

---

## Proposed State: Data Flow (COMPLETE INTEGRATION)

```
┌─────────────────────────────────────────────────────────────────┐
│                    stock_analyzer.html                          │
│                                                                 │
│  <script src="modules/GrowthAnalytics.js"></script>            │
│  <script src="modules/RankingAnalytics.js"></script>           │
│  <script src="modules/EPSAnalytics.js"></script>               │
│  <script src="modules/CFOAnalytics.js"></script>               │
│  <script src="modules/CorrelationEngine.js"></script>          │
│  <script src="js/DashboardManager.js"></script>                │
└─────────────────────────────────────────────────────────────────┘
                              ↓
                    loadData() function
                              ↓
            fetch('data/global_scouter_integrated.json')
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│         global_scouter_integrated.json (COMPLETE)               │
│                                                                 │
│  {                                                              │
│    "metadata": {                                                │
│      "totalCompanies": 6176,                                    │
│      "technicalDataCompanies": 1250                             │
│    },                                                           │
│    "data": {                                                    │
│      "main": [ ... 6,176 companies ... ],  ✅ EXISTS           │
│      "technical": {  ✅ NEW SECTION                             │
│        "T_EPS_C": [ ... 1,250 companies ... ],                  │
│        "T_Growth_C": [ ... 1,250 companies ... ],               │
│        "T_Rank": [ ... 1,250 companies ... ],                   │
│        "T_CFO": [ ... 1,264 companies ... ],                    │
│        "T_Correlation": [ ... 1,249 companies ... ]             │
│      }                                                          │
│    }                                                            │
│  }                                                              │
│                                                                 │
│  File Size: ~1.2 MB (from 600 KB)                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
          ┌───────────────────┴───────────────────────────────────┐
          ↓                                                       ↓
  window.allData = jsonData.data.main              data.technical = jsonData.data.technical
          ↓                                                       ↓
┌─────────────────────────────────────────────────────────────────┐
│                     window.dataManager                          │
│                                                                 │
│  {                                                              │
│    companies: [                                                 │
│      { ticker, name, sector, marketCap },                       │
│      ... 6,176 companies                                        │
│    ]                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
          ↓
          ┌───────────────────┴───────────────────────────────────┐
          ↓                   ↓              ↓            ↓        ↓
┌──────────────────┐  ┌──────────────┐  ┌─────────┐  ┌──────────┐  ┌────────────────┐
│ GrowthAnalytics  │  │EPSAnalytics  │  │Ranking  │  │CFO       │  │Correlation     │
│                  │  │              │  │Analytics│  │Analytics │  │Engine          │
│ Loads:           │  │ Loads:       │  │         │  │          │  │                │
│ data.technical   │  │ data.tech    │  │Loads:   │  │Loads:    │  │Loads:          │
│ .T_Growth_C      │  │ .T_EPS_C     │  │data.tech│  │data.tech │  │data.technical  │
│                  │  │              │  │.T_Rank  │  │.T_CFO    │  │.T_Correlation  │
│ ✅ SUCCESS       │  │ ✅ SUCCESS   │  │✅ OK    │  │✅ OK     │  │✅ SUCCESS      │
│ 1,250 companies  │  │ 1,250 co's   │  │1,250    │  │1,264     │  │1,249 companies │
└──────────────────┘  └──────────────┘  └─────────┘  └──────────┘  └────────────────┘
          ↓                   ↓              ↓            ↓                 ↓
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      enrichXXXData() (Data Enrichment)                          │
│                                                                                 │
│  Matches technical data with main company data via Ticker:                     │
│                                                                                 │
│  Technical Data (T_EPS_C)          +          Main Data (M_Company)            │
│  ─────────────────────────────────────────────────────────────────             │
│  { Ticker: "NVDA",                           { Ticker: "NVDA",                 │
│    Corp: "NVIDIA",                             Corp: "NVIDIA",                 │
│    EPS: 4.49,                                  Price: 187.62,                  │
│    "EPS (Fwd)": 6.39 }                         "(USD mn)": 4559166 }           │
│                                                                                 │
│  =================================   MERGE   ==================================  │
│                                                                                 │
│  { Ticker: "NVDA",                                                              │
│    Corp: "NVIDIA",                                                              │
│    EPS: 4.49,                                                                   │
│    "EPS (Fwd)": 6.39,                                                           │
│    corpName: "NVIDIA",      ← from main data                                   │
│    price: 187.62,           ← from main data                                   │
│    marketCap: 4559166 }     ← from main data                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         DashboardManager                                        │
│                                                                                 │
│  Coordinates:                                                                   │
│  - Growth charts (Sales, OP, EPS growth rates)                                 │
│  - Ranking charts (Quality, Value, Momentum)                                   │
│  - EPS charts (Current, Forward, Growth trends)                                │
│  - CFO waterfall charts (FY-4 to FY+3)                                         │
│  - Correlation heatmaps (Portfolio diversification)                            │
│                                                                                 │
│  Events:                                                                        │
│  - Industry filter (업종 선택)                                                  │
│  - Refresh data                                                                 │
│  - Export CSV/PNG                                                               │
│  - Company detail modal                                                         │
└─────────────────────────────────────────────────────────────────────────────────┘
          ↓
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      Interactive Dashboard UI                                   │
│                                                                                 │
│  Tab 1: Dashboard (Overview)                                                    │
│    ├── Overview Cards (평균 성장률, Top 10 기업 수, 평균 EPS)                     │
│    ├── Growth Chart (Chart.js)                                                  │
│    ├── Ranking Chart (Chart.js)                                                 │
│    ├── EPS Chart (Chart.js)                                                     │
│    └── Combined Chart (Chart.js)                                                │
│                                                                                 │
│  Tab 2: Growth Analytics (성장률 상세 분석)                                       │
│  Tab 3: Ranking Analytics (순위 상세 분석)                                        │
│  Tab 4: EPS Analytics (EPS 상세 분석)                                            │
│  Tab 5: CFO Analytics (현금흐름 분석)                                             │
│  Tab 6: Correlation Analysis (상관관계 분석)                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

RESULT: All analytics modules initialize successfully and provide
        full functionality with integrated technical data.
```

---

## Data Coverage Map

```
┌───────────────────────────────────────────────────────────────┐
│              Data Coverage Visualization                      │
│                                                               │
│  M_Company (main):         6,176 companies  100%              │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓           │
│                                                               │
│  T_EPS_C:                  1,250 companies  20.2%             │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                               │
│  T_Growth_C:               1,250 companies  20.2%             │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                               │
│  T_Rank:                   1,250 companies  20.2%             │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                               │
│  T_CFO:                    1,264 companies  20.5%             │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                               │
│  T_Correlation:            1,249 companies  20.2%             │
│  ▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│                                                               │
│  Legend: ▓ = Has data    ░ = No data                          │
└───────────────────────────────────────────────────────────────┘

Insight: Technical datasets cover top ~20% of companies by
         market cap/liquidity. Remaining 80% have basic data only.
```

---

## Module Dependency Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                   Module Dependency Graph                       │
│                                                                 │
│                    DashboardManager                             │
│                           │                                     │
│         ┌─────────────────┼─────────────────┐                  │
│         │                 │                 │                  │
│         ↓                 ↓                 ↓                  │
│   GrowthAnalytics   RankingAnalytics   EPSAnalytics            │
│         │                 │                 │                  │
│         └─────────────────┼─────────────────┘                  │
│                           │                                     │
│         ┌─────────────────┴─────────────────┐                  │
│         ↓                                   ↓                  │
│   CFOAnalytics                    CorrelationEngine            │
│         │                                   │                  │
│         └───────────────┬───────────────────┘                  │
│                         ↓                                      │
│                  window.dataManager                            │
│                         ↓                                      │
│          global_scouter_integrated.json                        │
│                         │                                      │
│         ┌───────────────┴───────────────┐                      │
│         ↓                               ↓                      │
│    data.main                     data.technical                │
│   (6,176 companies)         (5 technical datasets)             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Enrichment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   Data Enrichment Process                       │
│                                                                 │
│  Step 1: Load Main Data                                        │
│  ─────────────────────────────────────────────────────────      │
│  window.allData ← global_scouter_integrated.json.data.main     │
│  [ { Ticker, Corp, Price, MarketCap, ... }, ... ]              │
│                                                                 │
│  Step 2: Create DataManager                                    │
│  ─────────────────────────────────────────────────────────      │
│  window.dataManager.companies ← map window.allData             │
│  [ { ticker, name, sector, marketCap }, ... ]                  │
│                                                                 │
│  Step 3: Initialize Analytics Modules                          │
│  ─────────────────────────────────────────────────────────      │
│  Each module:                                                   │
│    1. Load technical data from integrated JSON                 │
│    2. Build companyMap from dataManager.companies              │
│    3. Enrich technical data with main company data             │
│                                                                 │
│  Example (EPSAnalytics):                                       │
│  ────────────────────────────                                  │
│  const companyMap = new Map(                                   │
│      dataManager.companies.map(c => [c.Ticker, c])             │
│  );                                                             │
│                                                                 │
│  this.epsData = this.epsData.map(eps => {                      │
│      const company = companyMap.get(eps.Ticker);               │
│      return {                                                   │
│          ...eps,                     // Technical data          │
│          corpName: company?.corpName,  // From main            │
│          price: company?.Price,        // From main            │
│          marketCap: company?.['(USD mn)']  // From main        │
│      };                                                         │
│  });                                                            │
│                                                                 │
│  Step 4: Analytics Ready                                       │
│  ─────────────────────────────────────────────────────────      │
│  Each module now has complete data:                            │
│  - Technical metrics (EPS, Growth, Rank, CFO, Correlation)     │
│  - Company metadata (name, price, market cap)                  │
│  - Ready for analysis and visualization                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Integration Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                   Integration Process                           │
│                                                                 │
│  INPUT: Individual JSON Files                                  │
│  ─────────────────────────────────────────────────────────      │
│  data/T_EPS_C.json         (1,250 companies)                   │
│  data/T_Growth_C.json      (1,250 companies)                   │
│  data/T_Rank.json          (1,250 companies)                   │
│  data/T_CFO.json           (1,264 companies)                   │
│  data/T_Correlation.json   (1,249 companies)                   │
│                                                                 │
│  PROCESS: Integration Script                                   │
│  ─────────────────────────────────────────────────────────      │
│  1. Read existing global_scouter_integrated.json               │
│  2. Read all T_*.json files                                    │
│  3. Validate data structures and Ticker consistency            │
│  4. Create data.technical section                              │
│  5. Merge:                                                      │
│     • T_EPS_C.data → data.technical.T_EPS_C                    │
│     • T_Growth_C.data → data.technical.T_Growth_C              │
│     • T_Rank.data → data.technical.T_Rank                      │
│     • T_CFO.data → data.technical.T_CFO                        │
│     • T_Correlation.data → data.technical.T_Correlation        │
│  6. Update metadata section                                    │
│  7. Write new global_scouter_integrated.json                   │
│  8. Validate resulting file                                    │
│                                                                 │
│  OUTPUT: Integrated JSON                                       │
│  ─────────────────────────────────────────────────────────      │
│  global_scouter_integrated.json (COMPLETE)                     │
│  {                                                              │
│    "metadata": {                                                │
│      "totalCompanies": 6176,                                    │
│      "technicalDataCompanies": 1250                             │
│    },                                                           │
│    "data": {                                                    │
│      "main": [ ... ],                                           │
│      "technical": {                                             │
│        "T_EPS_C": [ ... ],                                      │
│        "T_Growth_C": [ ... ],                                   │
│        "T_Rank": [ ... ],                                       │
│        "T_CFO": [ ... ],                                        │
│        "T_Correlation": [ ... ]                                 │
│      }                                                          │
│    }                                                            │
│  }                                                              │
│                                                                 │
│  CLEANUP: Archive Old Files                                    │
│  ─────────────────────────────────────────────────────────      │
│  Move to backups/:                                             │
│  • T_EPS_C.json                                                │
│  • T_Growth_C.json                                             │
│  • T_Rank.json                                                 │
│  • T_CFO.json                                                  │
│  • T_Correlation.json                                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## Performance Optimization (CorrelationEngine)

```
┌─────────────────────────────────────────────────────────────────┐
│          CorrelationEngine O(n) Optimization                    │
│                                                                 │
│  PROBLEM: Naive correlation pair finding is O(n²)              │
│  ─────────────────────────────────────────────────────────      │
│  For 1,249 companies:                                          │
│  • Naive approach: 1,249 × 1,249 = 1,559,001 comparisons      │
│  • Time complexity: O(n²) → unacceptable at 10,000 scale      │
│                                                                 │
│  SOLUTION: Indexed Correlation Buckets                         │
│  ─────────────────────────────────────────────────────────      │
│  correlationIndex = {                                          │
│      veryLow: [],    // correlation < -0.5                     │
│      low: [],        // -0.5 ≤ correlation < -0.1             │
│      neutral: [],    // -0.1 ≤ correlation ≤ 0.1              │
│      medium: [],     // 0.1 < correlation ≤ 0.5               │
│      high: []        // correlation > 0.5                      │
│  }                                                              │
│                                                                 │
│  During matrix building (one-time cost):                       │
│  • Calculate pairwise correlations: O(n²)                      │
│  • Assign each pair to bucket: O(1) per pair                   │
│  • Total initialization: O(n²) but only once                   │
│                                                                 │
│  During pair finding (frequent operation):                     │
│  • findLowCorrelationPairs(threshold)                          │
│  • Filter only relevant buckets: O(bucket_size)                │
│  • Return results: O(k) where k << n                           │
│  • Time complexity: O(n) → acceptable at 10,000 scale          │
│                                                                 │
│  RESULT: Performance Improvement                               │
│  ─────────────────────────────────────────────────────────      │
│  1,249 companies:                                              │
│  • Naive: 1,559,001 comparisons every query                    │
│  • Indexed: ~250 comparisons per bucket (5x ~250 = 1,250)     │
│  • Speedup: ~1,247x faster                                     │
│                                                                 │
│  10,000 companies (projected):                                 │
│  • Naive: 100,000,000 comparisons → ~10 seconds               │
│  • Indexed: ~2,000 per bucket → <0.01 seconds                 │
│  • Speedup: ~1,000x faster, meets <5s target                  │
└─────────────────────────────────────────────────────────────────┘
```

---

**Diagram End**

**Related Documents**:
- SPRINT4_DATA_INTEGRATION_ANALYSIS.md (Detailed analysis)
- SPRINT4_DATA_INTEGRATION_DESIGN.md (Phase 1: To-Be Design)
