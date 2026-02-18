# Sprint 5 Usage Guide

Complete guide for using CFOAnalytics and CorrelationEngine modules in Stock Analyzer application.

---

## Quick Start

### 1. Module Initialization

Both modules are automatically initialized when `stock_analyzer.html` loads:

```javascript
// Automatic initialization in stock_analyzer_enhanced.js
Promise.all([
    window.cfoAnalytics.initialize(),
    window.correlationEngine.initialize()
]).then(() => {
    console.log('✅ Sprint 5 modules ready');
});
```

### 2. Check Module Availability

```javascript
// Check if modules are loaded and initialized
if (window.cfoAnalytics && window.cfoAnalytics.initialized) {
    console.log('CFOAnalytics ready');
}

if (window.correlationEngine && window.correlationEngine.initialized) {
    console.log('CorrelationEngine ready');
}
```

---

## CFOAnalytics Usage

### Basic Company CFO Query

```javascript
// Get complete CFO data for a company
const cfoData = window.cfoAnalytics.getCompanyCFO('NVDA');

console.log(cfoData);
/*
{
    ticker: "NVDA",
    corp: "NVIDIA",
    exchange: "NASDAQ",
    sector: "Semiconductors & Semiconductor Equipment",
    ccc: 56.17,          // Cash Conversion Cycle (days)
    opm: 0.656,          // Operating Profit Margin
    roe: 0.7943,         // Return on Equity
    marketCap: 2908000   // USD million
}
*/
```

### Find Companies with Strong Cash Flow

```javascript
// Get companies with CFO > $50,000 million in current year
const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(50000, 'FY 0');

// Results sorted by CFO (descending)
highCFO.forEach(company => {
    console.log(`${company.corp}: $${company.cfo}M CFO`);
});

// Example output:
// NVIDIA: $72,880M CFO
// Apple: $110,543M CFO
// Microsoft: $87,582M CFO
```

### Calculate CFO Health Score

```javascript
// Get 0-100 health score for a company
const healthScore = window.cfoAnalytics.getCFOHealthScore('AAPL');

console.log(`Apple Health Score: ${healthScore}/100`);

// Score components:
// - Free Cash Flow (30%)
// - Cash Conversion Cycle (25%)
// - Operating Profit Margin (25%)
// - Cash Flow Growth (20%)
```

### Sector Analysis

```javascript
// Get sector-level CFO averages
const sectorAverages = window.cfoAnalytics.getSectorCFOAverages();

// Results sorted by company count (descending)
sectorAverages.forEach(sector => {
    console.log(`
        Sector: ${sector.sector}
        Companies: ${sector.count}
        Avg CFO: $${sector.avgCFO}M
        Avg CCC: ${sector.avgCCC} days
        Avg OPM: ${(sector.avgOPM * 100).toFixed(1)}%
    `);
});
```

### Compare Multiple Companies

```javascript
// Compare CFO metrics across companies
const tickers = ['AAPL', 'MSFT', 'GOOGL', 'NVDA'];
const comparison = window.cfoAnalytics.compareCFO(tickers);

// Results sorted by CFO (descending)
comparison.forEach(company => {
    console.log(`${company.corp}: $${company.cfo}M, CCC: ${company.ccc} days`);
});
```

### Generate Chart Data

#### Waterfall Chart
```javascript
// Get waterfall data for cash flow breakdown
const waterfallData = window.cfoAnalytics.getCFOWaterfallData('NVDA');

// Use with Chart.js
new Chart(ctx, {
    type: 'bar',
    data: waterfallData,
    options: {
        plugins: {
            title: { text: 'NVIDIA Cash Flow Waterfall' }
        }
    }
});
```

#### Sector Heatmap
```javascript
// Get sector CFO heatmap data
const heatmapData = window.cfoAnalytics.getSectorCFOHeatmapData();

// Dual-axis chart: avgCFO (bars) + avgCCC (line)
new Chart(ctx, {
    type: 'bar',
    data: {
        labels: heatmapData.labels,  // Sector names
        datasets: [
            {
                label: 'Avg CFO',
                data: heatmapData.avgCFO,
                yAxisID: 'y1'
            },
            {
                label: 'Avg CCC',
                data: heatmapData.avgCCC,
                type: 'line',
                yAxisID: 'y2'
            }
        ]
    }
});
```

#### Scatter Plot: CFO vs ROE
```javascript
// Get scatter data for top companies
const scatterData = window.cfoAnalytics.getCFOvsROEScatterData(50);

// Bubble chart: x=CFO, y=ROE, size=marketCap
scatterData.forEach(point => {
    console.log(`${point.corp}: CFO=$${point.cfo}M, ROE=${(point.roe * 100).toFixed(1)}%`);
});
```

---

## CorrelationEngine Usage

### Get Correlation Between Two Stocks

```javascript
// Get correlation coefficient between two companies
const correlation = window.correlationEngine.getCorrelation('AAPL', 'MSFT');

console.log(`AAPL-MSFT Correlation: ${correlation.toFixed(3)}`);

// Interpretation:
// > 0.7: Strong positive correlation
// 0.3-0.7: Moderate positive
// -0.3-0.3: Low correlation (good for diversification)
// -0.7--0.3: Moderate negative
// < -0.7: Strong negative correlation
```

### Build Correlation Matrix

```javascript
// Get NxN correlation matrix for specific stocks
const tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA'];
const matrix = window.correlationEngine.getCorrelationMatrix(tickers);

// Access correlations
console.log(`AAPL-MSFT: ${matrix['AAPL']['MSFT']}`);
console.log(`GOOGL-AMZN: ${matrix['GOOGL']['AMZN']}`);

// Matrix properties:
// - Symmetric: matrix[A][B] = matrix[B][A]
// - Diagonal = 1.0: matrix[A][A] = 1.0
// - Range: -1.0 <= correlation <= 1.0
```

### Find Low Correlation Pairs

```javascript
// Find pairs with correlation between -0.3 and 0.3
const lowCorrPairs = window.correlationEngine.findLowCorrelationPairs(-0.3, 0.3);

console.log(`Found ${lowCorrPairs.length} pairs with low correlation`);

lowCorrPairs.slice(0, 10).forEach(pair => {
    console.log(`${pair.tickerA} - ${pair.tickerB}: ${pair.correlation.toFixed(3)}`);
});

// Use for diversification:
// - Pairs with low correlation reduce portfolio risk
// - Ideal for balanced portfolio construction
```

### Build Diversified Portfolio

```javascript
// Start with candidate stocks
const candidates = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', /* ... 45 more */];

// Build diversified portfolio (greedy algorithm)
const portfolio = window.correlationEngine.buildDiversifiedPortfolio(candidates, 10);

// Results sorted by average correlation (ascending)
portfolio.forEach(stock => {
    console.log(`
        ${stock.ticker}
        Avg Correlation: ${stock.avgCorrelation.toFixed(3)}
    `);
});

// Algorithm:
// 1. Start with stock having lowest average correlation
// 2. Add stock with lowest correlation to portfolio
// 3. Repeat until reaching target count
```

### K-means Clustering

```javascript
// Cluster all companies into 5 groups by correlation patterns
const clusterResult = window.correlationEngine.clusterByCorrelation(5);

console.log(`Created ${clusterResult.clusters.length} clusters`);

clusterResult.clusters.forEach((cluster, idx) => {
    console.log(`Cluster ${idx + 1}: ${cluster.length} companies`);
    console.log(cluster.slice(0, 5).join(', '));  // Show first 5
});

// Use cases:
// - Identify groups of similarly-behaving stocks
// - Find representative stocks from each cluster
// - Reduce portfolio overlap
```

### Portfolio Optimization

```javascript
// Optimize portfolio weights for 10 stocks
const tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA',
                 'TSLA', 'META', 'BRK.B', 'JPM', 'JNJ'];

// Conservative: Minimize risk
const conservative = window.correlationEngine.optimizePortfolio(tickers, 'conservative');
console.log(`Conservative - Return: ${(conservative.expectedReturn * 100).toFixed(2)}%, Risk: ${(conservative.expectedRisk * 100).toFixed(2)}%`);

// Moderate: Balance risk/return
const moderate = window.correlationEngine.optimizePortfolio(tickers, 'moderate');
console.log(`Moderate - Return: ${(moderate.expectedReturn * 100).toFixed(2)}%, Risk: ${(moderate.expectedRisk * 100).toFixed(2)}%`);

// Aggressive: Maximize return
const aggressive = window.correlationEngine.optimizePortfolio(tickers, 'aggressive');
console.log(`Aggressive - Return: ${(aggressive.expectedReturn * 100).toFixed(2)}%, Risk: ${(aggressive.expectedRisk * 100).toFixed(2)}%`);

// Check weights sum to 1.0
const weightSum = Object.values(moderate.weights).reduce((sum, w) => sum + w, 0);
console.log(`Weight sum: ${weightSum.toFixed(4)}`);
```

### Sector Correlation Analysis

```javascript
// Get intra-sector vs inter-sector correlation
const sectorCorr = window.correlationEngine.getSectorCorrelation();

sectorCorr.forEach(sector => {
    console.log(`
        Sector: ${sector.sector}
        Companies: ${sector.count}
        Intra-Sector Correlation: ${sector.intraCorrelation.toFixed(3)}
        Inter-Sector Correlation: ${sector.interCorrelation.toFixed(3)}
    `);
});

// Insight:
// - High intra-sector correlation: Sector moves together
// - Low inter-sector correlation: Good diversification across sectors
```

### Generate Chart Data

#### Correlation Heatmap
```javascript
// Get correlation heatmap for top 30 companies
const heatmapData = window.correlationEngine.getCorrelationHeatmapData(null, 30);

// Color-coded bar chart
const backgroundColors = heatmapData.avgCorrelations.map(val => {
    if (val > 0.7) return 'rgba(239, 68, 68, 0.6)';    // Red (high positive)
    if (val > 0.3) return 'rgba(251, 146, 60, 0.6)';   // Orange
    if (val > -0.3) return 'rgba(34, 197, 94, 0.6)';   // Green (low)
    return 'rgba(59, 130, 246, 0.6)';                  // Blue (negative)
});

new Chart(ctx, {
    type: 'bar',
    data: {
        labels: heatmapData.labels,
        datasets: [{
            data: heatmapData.avgCorrelations,
            backgroundColor: backgroundColors
        }]
    }
});
```

#### Cluster Scatter Plot
```javascript
// Get scatter data for K-means clusters
const scatterData = window.correlationEngine.getClusterScatterData(5);

// Create dataset for each cluster
const datasets = scatterData.clusters.map((cluster, idx) => ({
    label: `Cluster ${idx + 1}`,
    data: cluster.points.map(p => ({ x: p.x, y: p.y })),
    backgroundColor: colors[idx]
}));

new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
        scales: {
            x: { title: { text: 'PC1' } },
            y: { title: { text: 'PC2' } }
        }
    }
});
```

---

## Advanced Use Cases

### 1. High CFO + Low Correlation Portfolio

```javascript
async function buildOptimalPortfolio() {
    // Step 1: Find companies with strong cash flow (>$50B)
    const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(50000, 'FY 0');
    console.log(`Found ${highCFO.length} companies with strong CFO`);

    // Step 2: Filter by CFO health score > 70
    const healthyCompanies = highCFO
        .map(c => ({
            ...c,
            healthScore: window.cfoAnalytics.getCFOHealthScore(c.ticker)
        }))
        .filter(c => c.healthScore > 70)
        .sort((a, b) => b.healthScore - a.healthScore);

    console.log(`${healthyCompanies.length} companies pass health screen`);

    // Step 3: Build diversified portfolio
    const candidates = healthyCompanies.slice(0, 100).map(c => c.ticker);
    const portfolio = window.correlationEngine.buildDiversifiedPortfolio(candidates, 15);

    console.log(`Selected ${portfolio.length} stocks with avg correlation ${
        (portfolio.reduce((sum, p) => sum + p.avgCorrelation, 0) / portfolio.length).toFixed(3)
    }`);

    // Step 4: Optimize weights
    const portfolioTickers = portfolio.map(p => p.ticker);
    const optimized = window.correlationEngine.optimizePortfolio(portfolioTickers, 'moderate');

    // Step 5: Final portfolio with details
    const finalPortfolio = portfolioTickers.map(ticker => {
        const cfoData = window.cfoAnalytics.getCompanyCFO(ticker);
        return {
            ticker,
            corp: cfoData.corp,
            weight: optimized.weights[ticker],
            healthScore: window.cfoAnalytics.getCFOHealthScore(ticker),
            cfo: cfoData['FY 0']
        };
    });

    // Display results
    console.table(finalPortfolio);
    console.log(`Portfolio Expected Return: ${(optimized.expectedReturn * 100).toFixed(2)}%`);
    console.log(`Portfolio Expected Risk: ${(optimized.expectedRisk * 100).toFixed(2)}%`);

    return finalPortfolio;
}

// Run the workflow
const portfolio = await buildOptimalPortfolio();
```

### 2. Sector Deep Dive

```javascript
function analyzeSectorOpportunities() {
    // Get sector CFO metrics
    const sectorCFO = window.cfoAnalytics.getSectorCFOAverages();

    // Get sector correlation patterns
    const sectorCorr = window.correlationEngine.getSectorCorrelation();

    // Combine data
    const opportunities = sectorCFO.map(cfo => {
        const corr = sectorCorr.find(c => c.sector === cfo.sector);
        return {
            sector: cfo.sector,
            companies: cfo.count,
            avgCFO: cfo.avgCFO,
            avgCCC: cfo.avgCCC,
            intraCorr: corr?.intraCorrelation || null,
            interCorr: corr?.interCorrelation || null
        };
    });

    // Find opportunities: High CFO + Low intra-sector correlation
    const topOpportunities = opportunities
        .filter(s => s.avgCFO > 30000 && s.intraCorr < 0.5)
        .sort((a, b) => b.avgCFO - a.avgCFO);

    console.log('Top Sector Opportunities (High CFO + Low Correlation):');
    console.table(topOpportunities);

    return topOpportunities;
}

analyzeSectorOpportunities();
```

### 3. Risk Comparison: Concentrated vs Diversified

```javascript
function comparePortfolioStrategies() {
    // Strategy 1: Concentrated (top 5 by CFO)
    const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(10000, 'FY 0');
    const concentrated = highCFO.slice(0, 5).map(c => c.ticker);

    // Strategy 2: Diversified (low correlation)
    const diversified = window.correlationEngine.buildDiversifiedPortfolio(
        highCFO.slice(0, 50).map(c => c.ticker),
        5
    ).map(p => p.ticker);

    // Optimize both
    const concentratedOpt = window.correlationEngine.optimizePortfolio(concentrated, 'moderate');
    const diversifiedOpt = window.correlationEngine.optimizePortfolio(diversified, 'moderate');

    // Compare metrics
    const matrix1 = window.correlationEngine.getCorrelationMatrix(concentrated);
    const matrix2 = window.correlationEngine.getCorrelationMatrix(diversified);

    // Calculate average correlation
    const avgCorr1 = calculateAvgCorrelation(concentrated, matrix1);
    const avgCorr2 = calculateAvgCorrelation(diversified, matrix2);

    console.log('Concentrated Portfolio:');
    console.log(`  Tickers: ${concentrated.join(', ')}`);
    console.log(`  Avg Correlation: ${avgCorr1.toFixed(3)}`);
    console.log(`  Expected Return: ${(concentratedOpt.expectedReturn * 100).toFixed(2)}%`);
    console.log(`  Expected Risk: ${(concentratedOpt.expectedRisk * 100).toFixed(2)}%`);

    console.log('\nDiversified Portfolio:');
    console.log(`  Tickers: ${diversified.join(', ')}`);
    console.log(`  Avg Correlation: ${avgCorr2.toFixed(3)}`);
    console.log(`  Expected Return: ${(diversifiedOpt.expectedReturn * 100).toFixed(2)}%`);
    console.log(`  Expected Risk: ${(diversifiedOpt.expectedRisk * 100).toFixed(2)}%`);

    return { concentrated: concentratedOpt, diversified: diversifiedOpt };
}

function calculateAvgCorrelation(tickers, matrix) {
    let sum = 0, count = 0;
    for (let i = 0; i < tickers.length; i++) {
        for (let j = i + 1; j < tickers.length; j++) {
            const corr = matrix[tickers[i]]?.[tickers[j]];
            if (corr !== null) {
                sum += Math.abs(corr);
                count++;
            }
        }
    }
    return count > 0 ? sum / count : 0;
}

comparePortfolioStrategies();
```

---

## Error Handling

### CFOAnalytics Errors

```javascript
// Handle missing companies
const cfoData = window.cfoAnalytics.getCompanyCFO('INVALID');
if (cfoData === null) {
    console.log('Company not found');
}

// Handle uninitialized state
if (!window.cfoAnalytics.initialized) {
    await window.cfoAnalytics.initialize();
}

// Handle empty results
const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(1000000, 'FY 0');
if (highCFO.length === 0) {
    console.log('No companies meet threshold');
}
```

### CorrelationEngine Errors

```javascript
// Handle missing correlations
const corr = window.correlationEngine.getCorrelation('AAPL', 'INVALID');
if (corr === null) {
    console.log('Correlation not available');
}

// Handle edge cases in clustering
try {
    const clusters = window.correlationEngine.clusterByCorrelation(0);  // Invalid k
} catch (error) {
    console.error('Clustering failed:', error.message);
}

// Handle empty ticker lists
const portfolio = window.correlationEngine.buildDiversifiedPortfolio([], 10);
// Returns empty array gracefully
```

---

## Performance Tips

1. **Cache Results**: Store frequently-used data locally
   ```javascript
   const cfoCache = new Map();
   function getCachedCFO(ticker) {
       if (!cfoCache.has(ticker)) {
           cfoCache.set(ticker, window.cfoAnalytics.getCompanyCFO(ticker));
       }
       return cfoCache.get(ticker);
   }
   ```

2. **Batch Operations**: Process multiple queries together
   ```javascript
   // Good: Single call
   const comparison = window.cfoAnalytics.compareCFO(tickers);

   // Bad: Multiple individual calls
   tickers.forEach(t => window.cfoAnalytics.getCompanyCFO(t));
   ```

3. **Limit Chart Data**: Use `topN` parameters
   ```javascript
   // Good: Top 50 companies
   const scatter = window.cfoAnalytics.getCFOvsROEScatterData(50);

   // Bad: All 1,264 companies
   const scatter = window.cfoAnalytics.getCFOvsROEScatterData(1264);
   ```

4. **Reuse Correlation Matrix**: Cache matrix for repeated queries
   ```javascript
   const cachedMatrix = window.correlationEngine.correlationMatrix;
   // Access directly instead of rebuilding
   const corr = cachedMatrix['AAPL']['MSFT'];
   ```

---

## Integration with Other Modules

### With GrowthAnalytics

```javascript
// Find companies with strong growth AND strong cash flow
const highGrowth = window.growthAnalytics.getHighGrowthCompanies(0.2, 'EPS');
const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(30000, 'FY 0');

const intersection = highGrowth.filter(g =>
    highCFO.some(c => c.ticker === g.ticker)
);

console.log(`${intersection.length} companies with both high growth and high CFO`);
```

### With RankingAnalytics

```javascript
// Find top-ranked companies with good CFO health
const topQuality = window.rankingAnalytics.getTopRankedCompanies('quality', 100);

const qualityWithHealth = topQuality
    .map(q => ({
        ...q,
        cfoHealth: window.cfoAnalytics.getCFOHealthScore(q.ticker)
    }))
    .filter(q => q.cfoHealth > 70);

console.log(`${qualityWithHealth.length} quality companies with CFO health > 70`);
```

### With EPSAnalytics

```javascript
// Correlate EPS growth with CFO growth
const companies = window.dataManager.companies.slice(0, 100);

const analysis = companies.map(c => {
    const eps = window.epsAnalytics.getCompanyEPS(c.Ticker);
    const cfo = window.cfoAnalytics.getCompanyCFO(c.Ticker);

    return {
        ticker: c.Ticker,
        corp: c.corpName,
        epsGrowth: eps?.eps_growth_3y,
        cfoGrowth: calculateCFOGrowth(cfo),
        correlation: calculateCorrelation(eps, cfo)
    };
}).filter(a => a.epsGrowth !== null && a.cfoGrowth !== null);

console.table(analysis);
```

---

## Troubleshooting

### Module Not Loaded
```javascript
// Check if scripts are included
if (typeof CFOAnalytics === 'undefined') {
    console.error('CFOAnalytics.js not loaded');
}

// Check global instances
if (!window.cfoAnalytics) {
    console.error('window.cfoAnalytics not initialized');
}
```

### Data Not Loading
```javascript
// Check data file availability
fetch('./data/global_scouter_integrated.json')
    .then(response => {
        if (!response.ok) {
            console.error('Data file not found');
        }
        return response.json();
    })
    .then(data => {
        console.log('T_CFO count:', data.data.technical.T_CFO.length);
        console.log('T_Correlation count:', data.data.technical.T_Correlation.length);
    });
```

### Performance Issues
```javascript
// Enable performance monitoring
window.enablePerformanceMonitoring = true;

// Check initialization time
performance.mark('init-start');
await window.cfoAnalytics.initialize();
performance.mark('init-end');
performance.measure('CFO-init', 'init-start', 'init-end');

const measure = performance.getEntriesByName('CFO-init')[0];
console.log(`Initialization time: ${measure.duration.toFixed(2)}ms`);
```

---

## Next Steps

1. **Explore the Dashboard**: View Sprint 5 analytics in `stock_analyzer.html`
2. **Run Tests**: `npm run test:sprint5`
3. **Read Architecture**: `SPRINT5_ARCHITECTURE.md`
4. **Check Test Results**: `SPRINT5_TEST_REPORT.md`

---

**Last Updated**: 2025-10-18
**Version**: 1.0.0 (Sprint 5 Week 1)
