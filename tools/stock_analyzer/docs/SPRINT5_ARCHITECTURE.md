# Sprint 5 Architecture Documentation

## Overview

Sprint 5 introduces two advanced analytics modules for cash flow analysis and correlation-based portfolio optimization, built on top of the Stock Analyzer data skeleton framework.

**Completion Date**: 2025-10-18
**Total Implementation**: 1,863 lines of code + 85 E2E tests

---

## Module Architecture

### 1. CFOAnalytics Module

**File**: `modules/CFOAnalytics.js`
**Size**: 714 lines
**Methods**: 23
**Data Source**: T_CFO (1,264 companies)

#### Purpose
Analyze cash flow operations (CFO) to assess company financial health through Free Cash Flow, Cash Conversion Cycle, and health scoring algorithms.

#### Data Structure
```javascript
{
  "Ticker": "NVDA",
  "Corp": "NVIDIA",
  "Exchange": "NASDAQ",
  "WI26": "Semiconductors & Semiconductor Equipment",
  "CCC (FY 0)": "56.17",        // Cash Conversion Cycle (days)
  "OPM (Fwd)": "0.656",         // Operating Profit Margin
  "ROE (Fwd)": "0.7943",        // Return on Equity
  "FY-4": "4332",               // Historical cash flow
  "FY-3": "7643",
  "FY-2": "16791",
  "FY-1": "24020",
  "FY 0": "72880",              // Current year cash flow
  "FY+1": "97440",              // Forecast
  "FY+2": "133750",
  "FY+3": "180060",
  "(USD mn)": "2908000"         // Market cap
}
```

#### Core Methods

**Initialization**
- `async initialize()` - Load T_CFO data from integrated JSON
- `loadIntegratedData()` - Fetch global_scouter_integrated.json
- `enrichCFOData()` - Enrich with company data from dataManager

**Data Retrieval**
- `getCompanyCFO(ticker)` - Get complete CFO data for a company
- `getHighCashFlowCompanies(threshold, year)` - Filter by CFO threshold
- `getSectorCFOAverages()` - Calculate sector-level averages
- `compareCFO(tickers)` - Compare multiple companies

**Health Metrics**
- `getCFOHealthScore(ticker)` - Calculate 0-100 health score
  - Free Cash Flow (30%)
  - Cash Conversion Cycle (25%)
  - Operating Profit Margin (25%)
  - Cash Flow Growth (20%)

**Chart Data Generation**
- `getCFOWaterfallData(ticker)` - Waterfall chart for cash flow breakdown
- `getSectorCFOHeatmapData()` - Heatmap of sector CFO metrics
- `getCFOvsROEScatterData(topN)` - Scatter plot CFO vs ROE

**Utility Methods**
- `parseCashFlow(value)` - Parse cash flow string to number
- `parsePercentage(value)` - Parse percentage values
- `average(arr)` - Calculate average
- `median(arr)` - Calculate median

---

### 2. CorrelationEngine Module

**File**: `modules/CorrelationEngine.js`
**Size**: 720+ lines
**Methods**: 19
**Data Source**: T_Correlation (1,249 companies)

#### Purpose
Analyze stock correlations for portfolio diversification and risk management through correlation matrix operations, K-means clustering, and mean-variance optimization.

#### Data Structure
```javascript
{
  "Ticker": "NVDA",
  "Corp": "NVIDIA",
  "WI26": "Semiconductors & Semiconductor Equipment",
  "Fwd 12M Sales": "0.7940",    // Correlation with Sales growth
  "Fwd 12M EPS": "0.9747",      // Correlation with EPS growth
  "HYY": "0.1584",              // Correlation with High Yield
  "Treasury": "-0.0892",         // Correlation with Treasury
  "Corp Bond": "0.0123",
  // ... more correlation coefficients
}
```

#### Core Methods

**Initialization**
- `async initialize()` - Load T_Correlation data
- `buildCorrelationMatrix()` - Build NxN correlation matrix (cached)
- `enrichCorrelationData()` - Enrich with company data

**Matrix Operations**
- `getCorrelationMatrix(tickers)` - Get correlation matrix for specific stocks
- `getCorrelation(tickerA, tickerB)` - Get correlation between two stocks
- Properties:
  - Symmetric: corr(A,B) = corr(B,A)
  - Diagonal = 1.0: corr(A,A) = 1.0
  - Range: -1.0 ≤ correlation ≤ 1.0

**Portfolio Diversification**
- `findLowCorrelationPairs(minCorr, maxCorr)` - Find pairs with low correlation
- `buildDiversifiedPortfolio(tickers, targetCount)` - Greedy diversification algorithm
- `getAverageCorrelation(ticker, tickers)` - Calculate average correlation

**Clustering Analysis**
- `clusterByCorrelation(numClusters)` - K-means clustering
- `kMeansClustering(data, k, maxIterations)` - K-means algorithm implementation
- `getClusterScatterData(numClusters)` - Scatter plot with PCA projection

**Portfolio Optimization**
- `optimizePortfolio(tickers, riskTolerance)` - Mean-variance optimization
  - Conservative: Minimize risk
  - Moderate: Balance risk/return
  - Aggressive: Maximize return
- Returns: weights (sum = 1.0), expectedReturn, expectedRisk

**Sector Analysis**
- `getSectorCorrelation()` - Intra-sector vs inter-sector correlation
- `getCorrelationHeatmapData(tickers, limit)` - Heatmap data for Chart.js

**Chart Data Generation**
- `getCorrelationHeatmapData(tickers, limit)` - Color-coded heatmap
- `getSectorCorrelation()` - Sector correlation comparison
- `getClusterScatterData(numClusters)` - K-means visualization

---

## Dashboard Integration

### HTML Structure

**File**: `stock_analyzer.html`
**Lines Added**: +99 (lines 1056-1138 + 1525-1540)

#### Layout
```
Sprint 5 Analytics Dashboard
├── Cash Flow Analytics Section
│   ├── Statistics Cards (3)
│   │   ├── Total Companies (#cfo-total)
│   │   ├── Positive FCF Count (#cfo-positive)
│   │   └── Average CCC (#cfo-avg-ccc)
│   └── Charts (3)
│       ├── Sector CFO Heatmap (#cfo-sector-heatmap-chart)
│       ├── Top Companies Bar (#cfo-top-companies-chart)
│       └── CFO vs ROE Scatter (#cfo-roe-scatter-chart)
└── Correlation Analytics Section
    ├── Statistics Cards (3)
    │   ├── Total Companies (#corr-total)
    │   ├── Low Correlation Pairs (#corr-low-pairs)
    │   └── Cluster Count (#corr-clusters)
    └── Charts (3)
        ├── Correlation Heatmap (#corr-heatmap-chart)
        ├── Sector Correlation (#corr-sector-chart)
        └── Cluster Scatter (#corr-cluster-scatter-chart)
```

### JavaScript Integration

**File**: `stock_analyzer_enhanced.js`
**Lines Added**: +330 (lines 232-254 + 5139-5442)

#### Initialization Pattern
```javascript
// Parallel initialization in init()
Promise.all([
    window.cfoAnalytics.initialize(),
    window.correlationEngine.initialize()
]).then(() => {
    console.log('✅ Sprint 5 modules initialized');
    renderSprint5Analytics();
});
```

#### Rendering Functions
```javascript
async function renderSprint5Analytics() {
    await renderCFOAnalyticsCharts();
    await renderCorrelationAnalyticsCharts();
}

async function renderCFOAnalyticsCharts() {
    // 1. Sector CFO Heatmap (dual-axis bar)
    // 2. Top 10 Cash Flow Companies (horizontal bar)
    // 3. CFO vs ROE Scatter (bubble chart)
}

async function renderCorrelationAnalyticsCharts() {
    // 1. Correlation Heatmap (color-coded bar)
    // 2. Sector Correlation (intra vs inter)
    // 3. Cluster Scatter (K-means, 5 clusters)
}
```

---

## Data Flow

```
global_scouter_integrated.json
├── data.technical.T_CFO (1,264)
│   └── CFOAnalytics.initialize()
│       ├── enrichCFOData() → Match with dataManager.companies
│       ├── Health Score Calculation
│       ├── Sector Aggregation
│       └── Chart Data Generation
│
└── data.technical.T_Correlation (1,249)
    └── CorrelationEngine.initialize()
        ├── buildCorrelationMatrix() → NxN matrix (cached)
        ├── K-means Clustering
        ├── Portfolio Optimization
        └── Chart Data Generation
```

---

## Performance Characteristics

### Initialization
- **CFOAnalytics**: < 1.5 seconds (target: 1.5s)
- **CorrelationEngine**: < 2.0 seconds (includes matrix building)
- **Concurrent**: < 2.5 seconds (Promise.all)

### Query Operations
- **Single CFO Query**: < 50ms
- **100 CFO Queries**: < 200ms
- **Correlation Matrix (100x100)**: < 200ms
- **Find Low Correlation Pairs**: < 500ms
- **Health Score (100 companies)**: < 300ms

### Chart Rendering
- **CFO Charts (3)**: < 800ms
- **Correlation Charts (3)**: < 800ms
- **Full Dashboard**: < 2 seconds

### Memory Usage
- **Sprint 5 Modules**: < 150MB (including dashboard)

### Complex Operations
- **K-means Clustering (5 clusters)**: < 1 second
- **Diversified Portfolio (100 → 10)**: < 800ms
- **Portfolio Optimization (10 stocks)**: < 500ms

---

## Algorithm Details

### 1. CFO Health Score Algorithm

```javascript
healthScore =
    fcfScore * 0.30 +      // Free Cash Flow (positive = good)
    cccScore * 0.25 +      // Cash Conversion Cycle (lower = good)
    opmScore * 0.25 +      // Operating Profit Margin (higher = good)
    growthScore * 0.20;    // CFO Growth Rate (higher = good)

// Each component normalized to 0-100 scale
```

**Scoring Logic**:
- **FCF Score**: 100 if FCF > 0, scaled down if negative
- **CCC Score**: 100 if CCC < 30 days, decreases as CCC increases
- **OPM Score**: 100 if OPM > 30%, scaled proportionally
- **Growth Score**: Based on FY-4 to FY 0 CAGR

### 2. K-means Clustering Algorithm

```javascript
function kMeansClustering(data, k, maxIterations = 100) {
    // 1. Initialize centroids randomly
    // 2. Assign each point to nearest centroid
    // 3. Recalculate centroids as mean of assigned points
    // 4. Repeat 2-3 until convergence or maxIterations
    // 5. Return cluster assignments + centroids
}
```

**Distance Metric**: Euclidean distance in correlation space

### 3. Portfolio Optimization (Mean-Variance)

```javascript
function optimizePortfolio(tickers, riskTolerance) {
    // 1. Get correlation matrix for tickers
    // 2. Estimate expected returns (based on historical growth)
    // 3. Apply risk tolerance weights:
    //    - Conservative: 70% low-risk, 30% high-return
    //    - Moderate: 50/50 balance
    //    - Aggressive: 70% high-return, 30% low-risk
    // 4. Normalize weights to sum = 1.0
    // 5. Calculate portfolio return and risk
}
```

---

## Error Handling

### CFOAnalytics
- **Missing Data**: Returns `null` for missing companies
- **Invalid Ticker**: Returns `null` gracefully
- **Parse Errors**: Returns `null` for unparseable values
- **Uninitialized State**: Methods return safe defaults ([], null)

### CorrelationEngine
- **Missing Correlation**: Returns `null` for missing pairs
- **Matrix Building**: Handles partial data gracefully
- **Clustering Edge Cases**: Handles k=1, k>data.length
- **Optimization**: Validates ticker availability before optimization

---

## Integration Patterns

### 1. High CFO + Low Correlation Portfolio

```javascript
// Find companies with strong cash flow
const highCFO = cfoAnalytics.getHighCashFlowCompanies(50000, 'FY 0');
const topTickers = highCFO.slice(0, 100).map(c => c.ticker);

// Build diversified portfolio
const portfolio = correlationEngine.buildDiversifiedPortfolio(topTickers, 15);

// Optimize weights
const optimized = correlationEngine.optimizePortfolio(
    portfolio.map(p => p.ticker),
    'moderate'
);
```

### 2. Sector-Level Analysis

```javascript
// Get sector CFO averages
const sectorCFO = cfoAnalytics.getSectorCFOAverages();

// Get sector correlation patterns
const sectorCorr = correlationEngine.getSectorCorrelation();

// Cross-reference: High CFO sectors with low intra-correlation
const opportunities = sectorCFO
    .filter(s => s.avgCFO > 50000)
    .map(s => {
        const corr = sectorCorr.find(c => c.sector === s.sector);
        return { ...s, intraCorr: corr?.intraCorrelation };
    })
    .filter(s => s.intraCorr < 0.5); // Low correlation = diversification opportunity
```

---

## Dependencies

### Runtime
- **Chart.js**: Chart rendering library
- **DOMPurify**: XSS protection (if HTML output methods are used)
- **DataManager**: Company data enrichment

### Development
- **Playwright**: E2E testing framework
- **@playwright/test**: Testing utilities

---

## Future Enhancements

### Sprint 6+ Roadmap
1. **Historical CFO Trends**: T_CFO_H (historical time series)
2. **Advanced Clustering**: DBSCAN, hierarchical clustering
3. **Machine Learning**: Predictive models for cash flow forecasting
4. **Real-time Updates**: WebSocket integration for live correlation updates
5. **Sector Deep-Dive**: Sector-specific CFO and correlation analysis
6. **Risk Analytics**: VaR, CVaR calculations
7. **Backtesting**: Historical portfolio performance simulation

---

## File Structure

```
stock_analyzer/
├── modules/
│   ├── CFOAnalytics.js (714 lines, 23 methods)
│   └── CorrelationEngine.js (720+ lines, 19 methods)
├── stock_analyzer.html (+99 lines, dashboard section)
├── stock_analyzer_enhanced.js (+330 lines, initialization + rendering)
├── tests/
│   ├── sprint5-cfo-analytics.spec.js (18 tests)
│   ├── sprint5-correlation-engine.spec.js (16 tests)
│   ├── sprint5-dashboard-rendering.spec.js (22 tests)
│   ├── sprint5-integration.spec.js (12 tests)
│   └── sprint5-performance.spec.js (17 tests)
└── docs/
    ├── SPRINT5_ARCHITECTURE.md (this file)
    ├── SPRINT5_USAGE_GUIDE.md
    └── SPRINT5_TEST_REPORT.md
```

---

## Version History

**v1.0.0 - Sprint 5 Week 1** (2025-10-18)
- Initial implementation: CFOAnalytics + CorrelationEngine
- Dashboard integration with 6 charts
- 85 E2E tests (20 passed on Chromium)
- Architecture documentation

**Planned v1.1.0 - Sprint 5 Week 2**
- Complete missing method implementations
- Firefox/WebKit browser test support
- Additional chart types
- Performance optimizations

---

## Contact & Support

**Project**: Global Scouter - Stock Analyzer
**Sprint**: 5 (Cash Flow & Correlation Analytics)
**Documentation Date**: 2025-10-18
**Framework**: Data Skeleton Architecture + Event System
