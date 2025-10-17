# Sprint 4 Analytics Usage Guide

Comprehensive developer documentation for Sprint 4 Analytics modules: EPSAnalytics, RankingAnalytics, and GrowthAnalytics.

---

## Table of Contents

1. [EPSAnalytics Usage](#epsanalytics-usage)
2. [RankingAnalytics Usage](#rankinganalytics-usage)
3. [GrowthAnalytics Usage](#growthanalytics-usage)
4. [Dashboard Customization](#dashboard-customization)
5. [Integration Patterns](#integration-patterns)
6. [Common Use Cases](#common-use-cases)
7. [Troubleshooting](#troubleshooting)

---

## EPSAnalytics Usage

EPSAnalytics provides comprehensive EPS (Earnings Per Share) analysis with 13 methods for analyzing profitability metrics across 1,250 companies.

### Initialization

```javascript
// Analytics modules are automatically initialized during app startup
// Check initialization status:
if (window.epsAnalytics?.initialized) {
    console.log('EPSAnalytics ready to use');
} else {
    console.warn('EPSAnalytics not initialized');
}
```

### Method 1: Get Company EPS Data

**Purpose**: Retrieve comprehensive EPS metrics for a specific company

```javascript
const eps = window.epsAnalytics.getCompanyEPS('AAPL');

// Expected output structure:
{
    ticker: "AAPL",
    corp: "Apple Inc",
    exchange: "NASDAQ",
    sector: "Technology Hardware & Equipment",

    // Current EPS metrics
    eps_current: 6.15,      // Current earnings per share
    eps_fwd: 6.50,          // Forward EPS estimate
    eps_nxt: 6.85,          // Next year EPS estimate

    // EPS growth rates (in percentage)
    eps_growth_1y: 12.5,    // 1-year EPS growth
    eps_growth_3y: 18.3,    // 3-year EPS growth
    eps_growth_5y: 15.7,    // 5-year EPS growth

    // Profitability metrics
    roe: 145.2,             // Return on Equity (%)
    roe_fwd: 148.5,         // Forward ROE (%)
    profit_margin: 25.8,    // Profit margin (%)

    marketCap: 2800000      // Market cap in USD millions
}
```

**Use Case**: Display detailed EPS information on company detail pages

**Null Handling**: Returns `null` if ticker not found or data unavailable

---

### Method 2: Sector EPS Averages

**Purpose**: Calculate and compare average EPS metrics across different sectors

```javascript
const sectorAvg = window.epsAnalytics.getSectorEPSAverages();

// Returns array sorted by company count (descending)
[
    {
        sector: "Technology Hardware & Equipment",
        count: 145,                    // Number of companies in sector
        eps_current_avg: 5.23,         // Average current EPS
        eps_fwd_avg: 5.67,             // Average forward EPS
        eps_growth_3y_avg: 15.8,       // Average 3-year growth (%)
        roe_avg: 42.5,                 // Average ROE (%)
        profit_margin_avg: 22.3        // Average profit margin (%)
    },
    // ... more sectors
]
```

**Use Case**: Sector comparison dashboards, identifying high-performing industries

**Visualization**: Ideal for bar charts comparing sectors

---

### Method 3: High EPS Companies Filter

**Purpose**: Find companies meeting specific EPS thresholds

```javascript
// Find companies with 3-year EPS growth > 50%
const highGrowth = window.epsAnalytics.getHighEPSCompanies(50, 'epsGrowth3Y');

// Alternative metrics:
// 'current' - Current EPS value
// 'fwd'     - Forward EPS estimate
// 'growth'  - EPS growth rate (uses 3Y by default)

// Returns sorted array (highest to lowest)
[
    {
        ticker: "NVDA",
        corp: "NVIDIA Corporation",
        sector: "Semiconductors & Equipment",
        epsValue: 185.2,           // The filtered metric value
        marketCap: 1200000
    },
    // ... more companies
]
```

**Use Case**: Investment screening, growth stock identification

**Performance**: Filters 1,250 companies in ~5-10ms

---

### Method 4: ROE vs EPS Scatter Data (Chart.js)

**Purpose**: Generate scatter plot data showing relationship between ROE and EPS growth

```javascript
// Get data for top 100 companies
const scatterData = window.epsAnalytics.getROEvsEPSGrowthData(100);

// Chart.js compatible format
{
    datasets: [{
        label: 'ROE vs EPS Growth (3Y)',
        data: [
            { x: 45.2, y: 18.5, label: "Apple Inc" },      // x=ROE, y=EPS Growth
            { x: 32.8, y: 22.3, label: "Microsoft Corp" },
            // ... more points
        ],
        backgroundColor: 'rgba(153, 102, 255, 0.6)',
        borderColor: 'rgba(153, 102, 255, 1)',
        borderWidth: 1
    }]
}

// Render with Chart.js
const ctx = document.getElementById('roe-eps-chart').getContext('2d');
new Chart(ctx, {
    type: 'scatter',
    data: scatterData,
    options: {
        scales: {
            x: {
                title: { display: true, text: 'ROE (%)' }
            },
            y: {
                title: { display: true, text: 'EPS Growth 3Y (%)' }
            }
        },
        plugins: {
            tooltip: {
                callbacks: {
                    label: (context) => {
                        const point = context.raw;
                        return `${point.label}: ROE ${point.x}%, Growth ${point.y}%`;
                    }
                }
            }
        }
    }
});
```

**Use Case**: Quality screening - companies with high ROE AND high EPS growth represent quality investments

**Insight**: Upper-right quadrant companies show both operational excellence (ROE) and growth momentum

---

### Method 5: Sector EPS Heatmap Data

**Purpose**: Generate heatmap visualization data for sector-level EPS analysis

```javascript
const heatmap = window.epsAnalytics.getSectorEPSHeatmapData();

// Returns array optimized for heatmap libraries
[
    {
        sector: "Technology",
        eps_growth: 18.5,      // Average 3Y EPS growth (%)
        roe: 42.3,             // Average ROE (%)
        count: 145             // Number of companies (for weighting)
    },
    // ... more sectors
]

// Visualization Pattern (using custom heatmap or color mapping)
const maxGrowth = Math.max(...heatmap.map(d => d.eps_growth));
const maxROE = Math.max(...heatmap.map(d => d.roe));

heatmap.forEach(sector => {
    const growthIntensity = sector.eps_growth / maxGrowth;
    const roeIntensity = sector.roe / maxROE;
    const color = `rgba(75, 192, 192, ${Math.min(growthIntensity + roeIntensity, 1)})`;

    // Apply color to visualization element
    document.querySelector(`[data-sector="${sector.sector}"]`)
        .style.backgroundColor = color;
});
```

**Use Case**: Sector rotation strategies, identifying undervalued/overvalued sectors

**Visualization**: Grid layout with color intensity representing metrics

---

### Method 6: EPS Summary HTML (XSS-Safe)

**Purpose**: Generate formatted HTML summary for display in panels (sanitized output)

```javascript
const html = window.epsAnalytics.getEPSSummaryHTML('TSLA');

// Returns Bootstrap-styled HTML (XSS-safe through DOMPurify)
// Output example:
<div class="eps-summary">
    <h6 class="mb-2">💰 EPS Analysis - Tesla Inc</h6>
    <div class="row">
        <div class="col-md-4">
            <strong>Current EPS</strong>
            <p>EPS: 3.62</p>
            <p>EPS (Fwd): 4.15</p>
            <p>EPS (Nxt): 4.78</p>
        </div>
        <div class="col-md-4">
            <strong>EPS Growth Rates</strong>
            <p>1-Year: +45.20%</p>
            <p>3-Year: +85.50%</p>
            <p>5-Year: +125.30%</p>
        </div>
        <div class="col-md-4">
            <strong>Profitability</strong>
            <p>ROE: +28.50%</p>
            <p>ROE (Fwd): +32.10%</p>
            <p>Profit Margin: +15.20%</p>
        </div>
    </div>
    <div class="mt-2">
        <small class="text-muted">Sector: Automobiles | Market Cap: $750,000M</small>
    </div>
</div>

// Safe rendering (DOMPurify automatically applied)
document.getElementById('eps-panel').innerHTML = html;
```

**Use Case**: DeepCompare modal, company detail sidebars, tooltips

**XSS Protection**: All user data is sanitized through the HTML structure (no direct user input in HTML strings)

**Null Handling**: Returns "EPS data not available" message if no data

---

### Additional EPSAnalytics Methods

#### Compare Multiple Companies

```javascript
// Compare EPS metrics across multiple companies
const comparison = window.epsAnalytics.compareEPS(
    ['AAPL', 'MSFT', 'GOOGL'],  // Tickers
    'growth'                      // Metric: 'current', 'fwd', 'growth'
);

// Returns sorted array (highest to lowest)
[
    { ticker: "GOOGL", corp: "Alphabet Inc", epsValue: 25.8, sector: "...", marketCap: ... },
    { ticker: "AAPL", corp: "Apple Inc", epsValue: 18.3, sector: "...", marketCap: ... },
    { ticker: "MSFT", corp: "Microsoft Corp", epsValue: 16.5, sector: "...", marketCap: ... }
]
```

#### EPS Chart Data (Chart.js)

```javascript
// Get Chart.js formatted data for a single company
const chartData = window.epsAnalytics.getEPSChartData('AAPL');

// Render bar chart
new Chart(ctx, {
    type: 'bar',
    data: chartData,  // Contains labels and datasets
    options: { /* ... */ }
});
```

#### Sector EPS Chart Data

```javascript
// Get sector comparison chart data (top 10 sectors)
const sectorChart = window.epsAnalytics.getSectorEPSChartData(10);

// Renders multi-dataset bar chart with:
// - EPS Current Average
// - EPS Forward Average
// - ROE Average
```

---

## RankingAnalytics Usage

RankingAnalytics provides ranking tracking and analysis with 14 methods across multiple ranking dimensions (Quality, Value, Momentum, etc.) for 1,252 companies.

### Method 1: Company Ranking Lookup

**Purpose**: Get comprehensive ranking data for a specific company

```javascript
const ranking = window.rankingAnalytics.getCompanyRanking('MSFT');

// Expected output:
{
    ticker: "MSFT",
    corp: "Microsoft Corporation",
    exchange: "NASDAQ",
    sector: "Software & Services",

    // Overall composite rankings
    quality_rank: 15,         // Overall quality rank
    value_rank: 245,          // Overall value rank
    momentum_rank: 32,        // Overall momentum rank

    // Individual metric rankings
    roe_rank: 8,              // ROE ranking
    eps_growth_rank: 22,      // EPS growth ranking
    sales_growth_rank: 45,    // Sales growth ranking
    profit_margin_rank: 12,   // Profit margin ranking

    // Valuation rankings (lower = cheaper)
    per_rank: 380,            // P/E ratio ranking
    pbr_rank: 420,            // P/B ratio ranking
    psr_rank: 395,            // P/S ratio ranking

    // Momentum rankings
    price_momentum_rank: 28,  // Price momentum ranking
    volume_rank: 55,          // Trading volume ranking

    marketCap: 2300000
}
```

**Use Case**: Company scorecard display, multi-factor ranking analysis

**Ranking Scale**: 1 = best, higher numbers = lower rank (out of ~1,250 companies)

---

### Method 2: Top Ranked Companies

**Purpose**: Find top performers by specific ranking criteria

```javascript
// Get top 50 quality-ranked companies
const topQuality = window.rankingAnalytics.getTopRankedCompanies('quality', 50);

// Available ranking types:
// 'quality'          - Overall quality composite
// 'value'            - Overall value composite
// 'momentum'         - Overall momentum composite
// 'roe'              - Return on equity
// 'eps_growth'       - EPS growth rate
// 'sales_growth'     - Sales growth rate
// 'profit_margin'    - Profit margin
// 'per'              - P/E ratio (lower = better value)
// 'pbr'              - P/B ratio
// 'psr'              - P/S ratio
// 'price_momentum'   - Recent price momentum
// 'volume'           - Trading volume

// Returns sorted array
[
    {
        ticker: "MSFT",
        corp: "Microsoft Corporation",
        sector: "Software & Services",
        rank: 15,              // The ranking position
        marketCap: 2300000
    },
    // ... 49 more companies
]
```

**Use Case**: Investment screening, portfolio construction, sector leaders identification

**Strategy Examples**:
- **Quality Investing**: `getTopRankedCompanies('quality', 100)`
- **Value Investing**: `getTopRankedCompanies('value', 50)`
- **Momentum Trading**: `getTopRankedCompanies('momentum', 30)`
- **Growth Stocks**: `getTopRankedCompanies('eps_growth', 50)`

---

### Method 3: Sector Rank Distribution

**Purpose**: Analyze how rankings distribute across sectors

```javascript
// Get sector distribution for momentum rankings
const sectorRanks = window.rankingAnalytics.getSectorRankDistribution('momentum');

// Returns sectors sorted by best average ranking
[
    {
        sector: "Technology Hardware & Equipment",
        count: 145,              // Companies in sector
        averageRank: 285.5,      // Mean ranking
        medianRank: 220,         // Median ranking (less affected by outliers)
        topCount: 35             // Companies in top 100
    },
    {
        sector: "Software & Services",
        count: 132,
        averageRank: 310.2,
        medianRank: 275,
        topCount: 28
    },
    // ... more sectors
]
```

**Use Case**: Sector rotation, identifying sectors with best relative rankings

**Insights**:
- **Low average rank** = Sector has many high-ranked companies
- **High topCount** = Many sector leaders
- **Large gap between mean/median** = Sector has wide quality distribution

---

### Method 4: Compare Multiple Companies

**Purpose**: Side-by-side ranking comparison across companies

```javascript
// Compare momentum rankings
const comparison = window.rankingAnalytics.compareRankings(
    ['AAPL', 'MSFT', 'GOOGL'],
    'momentum'
);

// Returns sorted by rank (best to worst)
[
    { ticker: "AAPL", corp: "Apple Inc", rank: 28, sector: "..." },
    { ticker: "MSFT", corp: "Microsoft Corp", rank: 32, sector: "..." },
    { ticker: "GOOGL", corp: "Alphabet Inc", rank: 45, sector: "..." }
]
```

**Use Case**: Portfolio rebalancing, peer comparison analysis

---

### Ranking Chart Visualization

```javascript
// Get radar chart data for company rankings
const chartData = window.rankingAnalytics.getRankingChartData('AAPL');

// Render radar chart (note: rankings inverted for better visual - lower rank = better)
const ctx = document.getElementById('ranking-radar').getContext('2d');
new Chart(ctx, {
    type: 'radar',
    data: chartData,
    options: {
        scales: {
            r: {
                reverse: true,           // Lower rank = farther from center = better
                beginAtZero: true,
                ticks: { stepSize: 100 }
            }
        },
        plugins: {
            title: {
                display: true,
                text: 'Multi-Factor Rankings (Lower = Better)'
            }
        }
    }
});
```

---

### Ranking Summary HTML

```javascript
// Generate formatted ranking summary
const html = window.rankingAnalytics.getRankingSummaryHTML('AAPL');

// Returns Bootstrap-styled HTML with badge indicators
<div class="ranking-summary">
    <h6 class="mb-2">🏆 Rankings - Apple Inc</h6>
    <div class="row">
        <div class="col-md-4">
            <strong>Overall Rankings</strong>
            <p>Quality: #28 <span class="badge bg-success">Top 50</span></p>
            <p>Value: #520 <span class="badge bg-secondary">Other</span></p>
            <p>Momentum: #45 <span class="badge bg-success">Top 50</span></p>
        </div>
        <div class="col-md-4">
            <strong>Growth Rankings</strong>
            <p>EPS Growth: #35</p>
            <p>Sales Growth: #68</p>
            <p>ROE: #42</p>
        </div>
        <div class="col-md-4">
            <strong>Valuation Rankings</strong>
            <p>PER: #680</p>
            <p>PBR: #745</p>
            <p>PSR: #590</p>
        </div>
    </div>
    <div class="mt-2">
        <small><strong>Price Momentum:</strong> #32 | <strong>Volume:</strong> #8</small>
    </div>
</div>

// Badge colors:
// Top 50    = Green (bg-success)
// Top 100   = Blue (bg-info)
// Top 300   = Yellow (bg-warning)
// Other     = Gray (bg-secondary)
```

**Use Case**: Company detail modals, quick ranking overview

---

## GrowthAnalytics Usage

GrowthAnalytics provides growth rate analysis with 15 methods across Sales, Operating Profit, and EPS metrics for 1,250 companies.

### Method 1: Company Growth Data

**Purpose**: Retrieve comprehensive growth metrics for a company

```javascript
const growth = window.growthAnalytics.getCompanyGrowth('AMZN');

// Expected output:
{
    ticker: "AMZN",
    corp: "Amazon.com Inc",
    exchange: "NASDAQ",
    sector: "Retailing",

    // Sales growth rates (%)
    sales_7y: 28.5,        // 7-year sales CAGR
    sales_3y: 22.3,        // 3-year sales CAGR

    // Operating profit growth (%)
    op_7y: 35.2,           // 7-year OP CAGR
    op_3y: 42.8,           // 3-year OP CAGR

    // EPS growth rates (%)
    eps_7y: 48.5,          // 7-year EPS CAGR
    eps_3y: 65.2,          // 3-year EPS CAGR

    // Forward-looking profitability
    roe_fwd: 25.8,         // Forward ROE (%)
    opm_fwd: 8.5           // Forward operating margin (%)
}
```

**Use Case**: Growth stock screening, trend analysis

**Growth Interpretation**:
- **Positive numbers**: Growth/improvement
- **Negative numbers**: Decline
- **7y vs 3y**: Compare long-term vs recent trends

---

### Method 2: Sector Growth Averages

**Purpose**: Calculate average growth rates by sector

```javascript
const sectorGrowth = window.growthAnalytics.getSectorGrowthAverages();

// Returns sectors sorted by company count
[
    {
        sector: "Software & Services",
        count: 132,

        // Average growth rates across all metrics (%)
        sales_7y_avg: 18.5,
        sales_3y_avg: 22.3,
        op_7y_avg: 24.2,
        op_3y_avg: 28.7,
        eps_7y_avg: 32.5,
        eps_3y_avg: 38.2
    },
    // ... more sectors
]
```

**Use Case**: Sector rotation, identifying high-growth industries

**Analysis Pattern**:
```javascript
// Find accelerating sectors (3Y > 7Y growth)
const accelerating = sectorGrowth.filter(s =>
    s.sales_3y_avg > s.sales_7y_avg &&
    s.op_3y_avg > s.op_7y_avg
);

// Find decelerating sectors
const decelerating = sectorGrowth.filter(s =>
    s.sales_3y_avg < s.sales_7y_avg
);
```

---

### Method 3: High Growth Companies

**Purpose**: Filter companies by growth thresholds

```javascript
// Find companies with 7-year EPS growth > 30%
const highGrowth = window.growthAnalytics.getHighGrowthCompanies(
    30,        // threshold (%)
    'eps',     // metric: 'sales', 'op', 'eps'
    '7y'       // period: '7y', '3y'
);

// Returns sorted array (highest growth first)
[
    {
        ticker: "NVDA",
        corp: "NVIDIA Corporation",
        sector: "Semiconductors",
        growthRate: 125.8,     // 7-year EPS CAGR (%)
        marketCap: 1200000
    },
    // ... more companies
]

// Strategy examples:
// Long-term growers: getHighGrowthCompanies(15, 'sales', '7y')
// Recent accelerators: getHighGrowthCompanies(40, 'eps', '3y')
// Profit margin expansion: getHighGrowthCompanies(20, 'op', '3y')
```

**Use Case**: Growth stock screening, momentum strategies

---

### Growth Chart Data (Chart.js)

```javascript
// Get chart data for a company's growth profile
const chartData = window.growthAnalytics.getGrowthChartData('NVDA');

// Render multi-metric bar chart
const ctx = document.getElementById('growth-chart').getContext('2d');
new Chart(ctx, {
    type: 'bar',
    data: chartData,
    options: {
        indexAxis: 'y',  // Horizontal bars
        plugins: {
            title: {
                display: true,
                text: 'Growth Rates (%)'
            }
        },
        scales: {
            x: {
                title: { display: true, text: 'CAGR (%)' }
            }
        }
    }
});

// Chart includes 6 metrics:
// - Sales (7y), Sales (3y)
// - OP (7y), OP (3y)
// - EPS (7y), EPS (3y)
```

---

### Sector Growth Chart Data

```javascript
// Get sector comparison chart (top 10 sectors)
const sectorChart = window.growthAnalytics.getSectorGrowthChartData(10);

// Render grouped bar chart
new Chart(ctx, {
    type: 'bar',
    data: sectorChart,  // 3 datasets: Sales, OP, EPS (all 7y averages)
    options: {
        plugins: {
            title: {
                display: true,
                text: 'Sector Average Growth Rates (7-Year CAGR)'
            }
        },
        scales: {
            y: {
                title: { display: true, text: 'Growth Rate (%)' }
            }
        }
    }
});
```

---

### Growth Summary HTML

```javascript
const html = window.growthAnalytics.getGrowthSummaryHTML('TSLA');

// Returns formatted HTML
<div class="growth-summary">
    <h6 class="mb-2">📈 Growth Rates - Tesla Inc</h6>
    <div class="row">
        <div class="col-md-4">
            <strong>Sales Growth</strong>
            <p>7-year: +45.20%</p>
            <p>3-year: +52.30%</p>
        </div>
        <div class="col-md-4">
            <strong>Operating Profit</strong>
            <p>7-year: +85.50%</p>
            <p>3-year: +125.20%</p>
        </div>
        <div class="col-md-4">
            <strong>EPS Growth</strong>
            <p>7-year: +180.30%</p>
            <p>3-year: +250.50%</p>
        </div>
    </div>
    <div class="mt-2">
        <small><strong>ROE (Fwd):</strong> +28.50% | <strong>OPM (Fwd):</strong> +15.20%</small>
    </div>
</div>
```

---

## Dashboard Customization

### Adding New Charts

**Step 1: Define Chart Container in HTML**

```html
<!-- In stock_analyzer_enhanced.html -->
<div class="chart-container">
    <canvas id="my-custom-chart"></canvas>
</div>
```

**Step 2: Add Rendering Function**

```javascript
// In stock_analyzer_enhanced.js
async function renderMyCustomChart() {
    // Get data from Analytics module
    const data = window.epsAnalytics.getSectorEPSAverages();

    // Transform for visualization
    const chartData = {
        labels: data.map(d => d.sector).slice(0, 15),
        datasets: [{
            label: 'Average ROE (%)',
            data: data.map(d => d.roe_avg).slice(0, 15),
            backgroundColor: 'rgba(54, 162, 235, 0.6)',
            borderColor: 'rgba(54, 162, 235, 1)',
            borderWidth: 2
        }]
    };

    // Render chart
    const ctx = document.getElementById('my-custom-chart').getContext('2d');
    new Chart(ctx, {
        type: 'bar',
        data: chartData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'Sector ROE Comparison'
                },
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'ROE (%)' }
                }
            }
        }
    });
}
```

**Step 3: Call in Main Render Function**

```javascript
async function renderSprint4Analytics() {
    // Existing charts...
    await renderGrowthAnalyticsCharts();
    await renderRankingAnalyticsCharts();
    await renderEPSAnalyticsCharts();

    // Add your custom chart
    await renderMyCustomChart();
}
```

---

### Chart.js Configuration Options

#### Color Schemes

```javascript
// Predefined color palettes
const colorSchemes = {
    blue: {
        bg: 'rgba(54, 162, 235, 0.6)',
        border: 'rgba(54, 162, 235, 1)'
    },
    green: {
        bg: 'rgba(75, 192, 192, 0.6)',
        border: 'rgba(75, 192, 192, 1)'
    },
    yellow: {
        bg: 'rgba(255, 206, 86, 0.6)',
        border: 'rgba(255, 206, 86, 1)'
    },
    purple: {
        bg: 'rgba(153, 102, 255, 0.6)',
        border: 'rgba(153, 102, 255, 1)'
    },
    red: {
        bg: 'rgba(255, 99, 132, 0.6)',
        border: 'rgba(255, 99, 132, 1)'
    }
};

// Apply to dataset
datasets: [{
    label: 'My Data',
    data: [...],
    backgroundColor: colorSchemes.blue.bg,
    borderColor: colorSchemes.blue.border,
    borderWidth: 2
}]
```

#### Responsive Layout

```javascript
options: {
    responsive: true,
    maintainAspectRatio: false,  // Allow custom height

    // Layout padding
    layout: {
        padding: {
            left: 10,
            right: 10,
            top: 10,
            bottom: 10
        }
    }
}

// CSS for container
.chart-container {
    position: relative;
    height: 400px;  /* Fixed height when maintainAspectRatio: false */
    width: 100%;
}
```

#### Interactive Tooltips

```javascript
options: {
    plugins: {
        tooltip: {
            enabled: true,
            mode: 'index',              // Show all datasets at x-position
            intersect: false,           // Show even if not hovering directly

            // Custom tooltip content
            callbacks: {
                title: (context) => {
                    return `Sector: ${context[0].label}`;
                },
                label: (context) => {
                    const label = context.dataset.label || '';
                    const value = context.parsed.y;
                    return `${label}: ${value.toFixed(2)}%`;
                },
                afterLabel: (context) => {
                    // Additional info
                    return `(Top performer)`;
                }
            },

            // Styling
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            borderColor: 'rgba(255, 255, 255, 0.3)',
            borderWidth: 1
        }
    }
}
```

---

### Tab Visibility Control

```javascript
// Show/hide specific tabs programmatically
function showTab(tabId) {
    // Hide all tab contents
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.remove('show', 'active');
    });

    // Deactivate all tab buttons
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    // Activate selected tab
    const tabContent = document.getElementById(tabId);
    const tabButton = document.querySelector(`[data-bs-target="#${tabId}"]`);

    if (tabContent) tabContent.classList.add('show', 'active');
    if (tabButton) tabButton.classList.add('active');
}

// Usage:
showTab('growth-tab');      // Show Growth Analytics tab
showTab('ranking-tab');     // Show Ranking Analytics tab
showTab('eps-tab');         // Show EPS Analytics tab
```

---

## Integration Patterns

### Using Multiple Analytics Modules Together

**Pattern 1: Comprehensive Company Profile**

```javascript
async function generateCompanyProfile(ticker) {
    // Gather data from all modules
    const eps = window.epsAnalytics.getCompanyEPS(ticker);
    const ranking = window.rankingAnalytics.getCompanyRanking(ticker);
    const growth = window.growthAnalytics.getCompanyGrowth(ticker);

    // Validate data availability
    if (!eps || !ranking || !growth) {
        console.error(`Incomplete data for ${ticker}`);
        return null;
    }

    // Create comprehensive profile
    return {
        ticker,
        corp: eps.corp,
        sector: eps.sector,

        // Profitability score
        profitability: {
            roe: eps.roe,
            profit_margin: eps.profit_margin,
            roe_rank: ranking.roe_rank,
            score: calculateProfitabilityScore(eps, ranking)
        },

        // Growth score
        growth: {
            eps_3y: growth.eps_3y,
            sales_3y: growth.sales_3y,
            eps_growth_rank: ranking.eps_growth_rank,
            score: calculateGrowthScore(growth, ranking)
        },

        // Quality score
        quality: {
            quality_rank: ranking.quality_rank,
            value_rank: ranking.value_rank,
            momentum_rank: ranking.momentum_rank,
            score: calculateQualityScore(ranking)
        },

        // Overall composite score
        overallScore: calculateOverallScore(eps, ranking, growth)
    };
}

function calculateProfitabilityScore(eps, ranking) {
    // Custom scoring logic
    const roeScore = eps.roe > 20 ? 100 : (eps.roe / 20) * 100;
    const rankScore = Math.max(0, 100 - (ranking.roe_rank / 12.5));
    return (roeScore + rankScore) / 2;
}
```

**Pattern 2: Multi-Metric Screening**

```javascript
function advancedScreening(criteria) {
    // Get all companies that pass ALL criteria
    const results = [];

    // Get initial candidates from rankings
    const qualityCandidates = window.rankingAnalytics
        .getTopRankedCompanies('quality', criteria.maxQualityRank || 200);

    qualityCandidates.forEach(company => {
        const ticker = company.ticker;

        // Check EPS criteria
        const eps = window.epsAnalytics.getCompanyEPS(ticker);
        if (!eps) return;

        if (criteria.minROE && eps.roe < criteria.minROE) return;
        if (criteria.minEPSGrowth && eps.eps_growth_3y < criteria.minEPSGrowth) return;

        // Check growth criteria
        const growth = window.growthAnalytics.getCompanyGrowth(ticker);
        if (!growth) return;

        if (criteria.minSalesGrowth && growth.sales_3y < criteria.minSalesGrowth) return;

        // Check ranking criteria
        const ranking = window.rankingAnalytics.getCompanyRanking(ticker);
        if (!ranking) return;

        if (criteria.maxValueRank && ranking.value_rank > criteria.maxValueRank) return;

        // All criteria passed - add to results
        results.push({
            ticker,
            corp: company.corp,
            sector: company.sector,
            roe: eps.roe,
            eps_growth_3y: eps.eps_growth_3y,
            sales_growth_3y: growth.sales_3y,
            quality_rank: ranking.quality_rank,
            value_rank: ranking.value_rank,
            score: calculateCompositeScore(eps, growth, ranking)
        });
    });

    // Sort by composite score
    return results.sort((a, b) => b.score - a.score);
}

// Usage:
const topStocks = advancedScreening({
    maxQualityRank: 150,
    minROE: 20,
    minEPSGrowth: 15,
    minSalesGrowth: 10,
    maxValueRank: 300
});
```

**Pattern 3: Coordinated Chart Updates**

```javascript
// Update multiple charts when user selects a sector
function updateDashboardBySector(sectorName) {
    // Filter companies by sector
    const sectorCompanies = window.epsAnalytics.epsData
        .filter(c => c.WI26 === sectorName)
        .map(c => c.Ticker)
        .slice(0, 20);  // Top 20 by market cap

    // Update EPS chart
    const epsData = sectorCompanies.map(ticker => {
        const eps = window.epsAnalytics.getCompanyEPS(ticker);
        return {
            ticker,
            corp: eps.corp,
            value: eps.eps_growth_3y
        };
    });

    updateChart('eps-sector-chart', {
        labels: epsData.map(d => d.ticker),
        datasets: [{
            label: '3Y EPS Growth (%)',
            data: epsData.map(d => d.value),
            backgroundColor: 'rgba(75, 192, 192, 0.6)'
        }]
    });

    // Update ranking chart
    const rankData = sectorCompanies.map(ticker => {
        const rank = window.rankingAnalytics.getCompanyRanking(ticker);
        return {
            ticker,
            value: rank.quality_rank
        };
    });

    updateChart('ranking-sector-chart', {
        labels: rankData.map(d => d.ticker),
        datasets: [{
            label: 'Quality Rank',
            data: rankData.map(d => d.value),
            backgroundColor: 'rgba(255, 99, 132, 0.6)'
        }]
    });

    // Update growth chart
    const growthData = sectorCompanies.map(ticker => {
        const growth = window.growthAnalytics.getCompanyGrowth(ticker);
        return {
            ticker,
            value: growth.sales_3y
        };
    });

    updateChart('growth-sector-chart', {
        labels: growthData.map(d => d.ticker),
        datasets: [{
            label: '3Y Sales Growth (%)',
            data: growthData.map(d => d.value),
            backgroundColor: 'rgba(54, 162, 235, 0.6)'
        }]
    });
}

function updateChart(chartId, newData) {
    const canvas = document.getElementById(chartId);
    const chart = Chart.getChart(canvas);

    if (chart) {
        chart.data = newData;
        chart.update();
    }
}
```

---

### Error Handling Best Practices

```javascript
// Defensive data access pattern
function safeGetAnalytics(ticker) {
    try {
        // Check module initialization
        if (!window.epsAnalytics?.initialized) {
            throw new Error('EPSAnalytics not initialized');
        }

        // Retrieve data with validation
        const eps = window.epsAnalytics.getCompanyEPS(ticker);
        if (!eps) {
            console.warn(`No EPS data for ticker: ${ticker}`);
            return null;
        }

        // Validate critical fields
        if (eps.eps_current === null && eps.eps_fwd === null) {
            console.warn(`Incomplete EPS data for ${ticker}`);
            return null;
        }

        return eps;

    } catch (error) {
        console.error('Error retrieving analytics:', error);

        // Show user-friendly message
        showNotification('Unable to load company data. Please try again.', 'error');

        return null;
    }
}

// Batch operation with error recovery
async function batchAnalyze(tickers) {
    const results = [];
    const errors = [];

    for (const ticker of tickers) {
        try {
            const eps = window.epsAnalytics.getCompanyEPS(ticker);
            const ranking = window.rankingAnalytics.getCompanyRanking(ticker);
            const growth = window.growthAnalytics.getCompanyGrowth(ticker);

            // Skip if any module returns null
            if (!eps || !ranking || !growth) {
                errors.push({ ticker, reason: 'incomplete_data' });
                continue;
            }

            results.push({ ticker, eps, ranking, growth });

        } catch (error) {
            errors.push({ ticker, reason: error.message });
        }
    }

    // Log summary
    console.log(`Batch analyze: ${results.length} success, ${errors.length} failed`);
    if (errors.length > 0) {
        console.warn('Failed tickers:', errors);
    }

    return { results, errors };
}

// Global error handler for chart rendering
window.addEventListener('error', (event) => {
    if (event.filename?.includes('Chart.js')) {
        console.error('Chart rendering error:', event.message);

        // Attempt recovery
        setTimeout(() => {
            console.log('Attempting to re-render charts...');
            renderSprint4Analytics();
        }, 2000);
    }
});
```

---

### Performance Optimization Tips

**Tip 1: Cache Expensive Calculations**

```javascript
// Cache sector averages (computed once, reused multiple times)
const sectorCache = new Map();

function getCachedSectorAverages(module, forceRefresh = false) {
    const cacheKey = `${module.constructor.name}_sectors`;

    if (!forceRefresh && sectorCache.has(cacheKey)) {
        return sectorCache.get(cacheKey);
    }

    const data = module.getSectorEPSAverages();  // Or other sector method
    sectorCache.set(cacheKey, data);

    return data;
}

// Usage:
const sectors = getCachedSectorAverages(window.epsAnalytics);
```

**Tip 2: Lazy Load Charts**

```javascript
// Only render charts when tab becomes visible
document.querySelectorAll('[data-bs-toggle="tab"]').forEach(tab => {
    tab.addEventListener('shown.bs.tab', (event) => {
        const targetId = event.target.getAttribute('data-bs-target');

        if (targetId === '#eps-tab' && !window.epsChartsRendered) {
            renderEPSAnalyticsCharts();
            window.epsChartsRendered = true;
        }
        else if (targetId === '#ranking-tab' && !window.rankingChartsRendered) {
            renderRankingAnalyticsCharts();
            window.rankingChartsRendered = true;
        }
        else if (targetId === '#growth-tab' && !window.growthChartsRendered) {
            renderGrowthAnalyticsCharts();
            window.growthChartsRendered = true;
        }
    });
});
```

**Tip 3: Throttle Real-time Updates**

```javascript
// Throttle chart updates when filtering
let updateTimeout;

function onFilterChange(filterValue) {
    clearTimeout(updateTimeout);

    // Debounce updates by 300ms
    updateTimeout = setTimeout(() => {
        updateChartsWithFilter(filterValue);
    }, 300);
}

// Usage in search/filter input
document.getElementById('sector-filter').addEventListener('input', (e) => {
    onFilterChange(e.target.value);
});
```

**Tip 4: Limit Data Points in Charts**

```javascript
// For large datasets, show only top N
function renderOptimizedChart(data, maxPoints = 20) {
    // Sort and slice
    const topData = data
        .sort((a, b) => b.value - a.value)
        .slice(0, maxPoints);

    // Add "Others" category if needed
    if (data.length > maxPoints) {
        const othersSum = data
            .slice(maxPoints)
            .reduce((sum, item) => sum + item.value, 0);

        topData.push({
            label: `Others (${data.length - maxPoints})`,
            value: othersSum / (data.length - maxPoints)  // Average
        });
    }

    return topData;
}
```

---

## Common Use Cases

### Use Case 1: Investment Screening Workflow

**Objective**: Find high-quality growth stocks with reasonable valuations

```javascript
async function qualityGrowthScreener() {
    console.log('Starting quality growth screening...');

    // Step 1: Get quality-ranked companies (top 200)
    const qualityPool = window.rankingAnalytics
        .getTopRankedCompanies('quality', 200);

    console.log(`Step 1: ${qualityPool.length} quality candidates`);

    // Step 2: Filter by growth criteria
    const growthFiltered = qualityPool.filter(company => {
        const growth = window.growthAnalytics.getCompanyGrowth(company.ticker);

        return growth &&
               growth.eps_3y > 15 &&        // >15% EPS growth
               growth.sales_3y > 10;        // >10% sales growth
    });

    console.log(`Step 2: ${growthFiltered.length} with strong growth`);

    // Step 3: Filter by profitability
    const profitFiltered = growthFiltered.filter(company => {
        const eps = window.epsAnalytics.getCompanyEPS(company.ticker);

        return eps &&
               eps.roe > 20 &&              // >20% ROE
               eps.profit_margin > 10;      // >10% profit margin
    });

    console.log(`Step 3: ${profitFiltered.length} with high profitability`);

    // Step 4: Filter by valuation (not too expensive)
    const valuationFiltered = profitFiltered.filter(company => {
        const ranking = window.rankingAnalytics.getCompanyRanking(company.ticker);

        return ranking &&
               ranking.per_rank < 500;      // Not in bottom half by P/E
    });

    console.log(`Step 4: ${valuationFiltered.length} with reasonable valuation`);

    // Step 5: Calculate composite scores
    const scored = valuationFiltered.map(company => {
        const eps = window.epsAnalytics.getCompanyEPS(company.ticker);
        const ranking = window.rankingAnalytics.getCompanyRanking(company.ticker);
        const growth = window.growthAnalytics.getCompanyGrowth(company.ticker);

        // Simple scoring formula
        const qualityScore = Math.max(0, 100 - (ranking.quality_rank / 12.5));
        const growthScore = (growth.eps_3y / 100) * 100;  // Normalize
        const profitScore = (eps.roe / 50) * 100;         // Normalize

        const compositeScore = (qualityScore * 0.4) +
                              (growthScore * 0.4) +
                              (profitScore * 0.2);

        return {
            ...company,
            eps,
            ranking,
            growth,
            compositeScore: compositeScore.toFixed(2)
        };
    });

    // Sort by composite score
    const finalResults = scored.sort((a, b) => b.compositeScore - a.compositeScore);

    console.log(`Final: Top ${finalResults.length} quality growth stocks`);

    // Display results
    displayScreeningResults(finalResults);

    return finalResults;
}

function displayScreeningResults(results) {
    const tableBody = document.getElementById('screening-results');
    tableBody.innerHTML = '';

    results.forEach((stock, index) => {
        const row = `
            <tr>
                <td>${index + 1}</td>
                <td><strong>${stock.ticker}</strong></td>
                <td>${stock.corp}</td>
                <td>${stock.sector}</td>
                <td>${stock.compositeScore}</td>
                <td>${stock.ranking.quality_rank}</td>
                <td>${stock.growth.eps_3y.toFixed(2)}%</td>
                <td>${stock.eps.roe.toFixed(2)}%</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="showCompanyDetail('${stock.ticker}')">
                        Details
                    </button>
                </td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}
```

---

### Use Case 2: Sector Analysis Dashboard

**Objective**: Compare sectors across multiple dimensions

```javascript
async function buildSectorDashboard() {
    // Gather sector data from all modules
    const epsSectors = window.epsAnalytics.getSectorEPSAverages();
    const growthSectors = window.growthAnalytics.getSectorGrowthAverages();

    // Merge sector data
    const sectorMap = new Map();

    epsSectors.forEach(sector => {
        sectorMap.set(sector.sector, {
            name: sector.sector,
            count: sector.count,
            roe_avg: sector.roe_avg,
            eps_growth_avg: sector.eps_growth_3y_avg,
            profit_margin_avg: sector.profit_margin_avg
        });
    });

    growthSectors.forEach(sector => {
        if (sectorMap.has(sector.sector)) {
            const existing = sectorMap.get(sector.sector);
            existing.sales_growth_avg = sector.sales_3y_avg;
            existing.op_growth_avg = sector.op_3y_avg;
        }
    });

    // Add ranking data
    const rankingSectors = window.rankingAnalytics
        .getSectorRankDistribution('quality');

    rankingSectors.forEach(sector => {
        if (sectorMap.has(sector.sector)) {
            const existing = sectorMap.get(sector.sector);
            existing.avg_quality_rank = sector.averageRank;
            existing.top100_count = sector.topCount;
        }
    });

    // Calculate sector scores
    const sectors = Array.from(sectorMap.values())
        .map(sector => ({
            ...sector,
            attractiveness_score: calculateSectorScore(sector)
        }))
        .sort((a, b) => b.attractiveness_score - a.attractiveness_score);

    // Render dashboard
    renderSectorTable(sectors);
    renderSectorRadarChart(sectors.slice(0, 8));  // Top 8 sectors

    return sectors;
}

function calculateSectorScore(sector) {
    // Composite scoring
    const growthScore = (sector.sales_growth_avg || 0) + (sector.eps_growth_avg || 0);
    const profitScore = (sector.roe_avg || 0) + (sector.profit_margin_avg || 0);
    const qualityScore = Math.max(0, 100 - ((sector.avg_quality_rank || 500) / 12.5));

    return (growthScore * 0.4) + (profitScore * 0.3) + (qualityScore * 0.3);
}

function renderSectorRadarChart(topSectors) {
    const ctx = document.getElementById('sector-radar').getContext('2d');

    const datasets = topSectors.map((sector, index) => ({
        label: sector.name,
        data: [
            sector.sales_growth_avg || 0,
            sector.eps_growth_avg || 0,
            sector.roe_avg || 0,
            sector.profit_margin_avg || 0,
            Math.max(0, 100 - (sector.avg_quality_rank / 12.5))
        ],
        borderColor: `hsl(${index * 45}, 70%, 50%)`,
        backgroundColor: `hsla(${index * 45}, 70%, 50%, 0.2)`
    }));

    new Chart(ctx, {
        type: 'radar',
        data: {
            labels: ['Sales Growth', 'EPS Growth', 'ROE', 'Profit Margin', 'Quality Score'],
            datasets
        },
        options: {
            scales: {
                r: {
                    beginAtZero: true,
                    max: 50
                }
            }
        }
    });
}
```

---

### Use Case 3: Portfolio Construction Tool

**Objective**: Build diversified portfolio based on multiple factors

```javascript
async function buildBalancedPortfolio(targetSize = 20) {
    console.log(`Building portfolio with ${targetSize} positions...`);

    // Define sector allocation limits (max % per sector)
    const sectorLimits = {
        'Technology': 0.30,         // Max 30%
        'Healthcare': 0.20,
        'Financial Services': 0.15,
        'Consumer Discretionary': 0.15,
        'Industrials': 0.10,
        'Other': 0.10
    };

    const portfolio = [];
    const sectorCount = {};

    // Step 1: Get top quality companies
    const candidates = window.rankingAnalytics
        .getTopRankedCompanies('quality', 300);

    // Step 2: Filter and score candidates
    const scored = candidates.map(company => {
        const eps = window.epsAnalytics.getCompanyEPS(company.ticker);
        const growth = window.growthAnalytics.getCompanyGrowth(company.ticker);
        const ranking = window.rankingAnalytics.getCompanyRanking(company.ticker);

        if (!eps || !growth || !ranking) return null;

        // Multi-factor scoring
        const qualityScore = Math.max(0, 100 - (ranking.quality_rank / 12.5));
        const growthScore = Math.min(100, (growth.eps_3y / 50) * 100);
        const profitScore = Math.min(100, (eps.roe / 50) * 100);
        const valueScore = Math.max(0, 100 - (ranking.per_rank / 12.5));

        const totalScore = (qualityScore * 0.35) +
                          (growthScore * 0.25) +
                          (profitScore * 0.25) +
                          (valueScore * 0.15);

        return {
            ...company,
            eps,
            growth,
            ranking,
            totalScore
        };
    }).filter(c => c !== null)
      .sort((a, b) => b.totalScore - a.totalScore);

    // Step 3: Select companies with sector diversification
    for (const candidate of scored) {
        if (portfolio.length >= targetSize) break;

        const sector = candidate.sector || 'Other';
        const currentCount = sectorCount[sector] || 0;
        const maxCount = Math.floor(targetSize * (sectorLimits[sector] || 0.10));

        if (currentCount < maxCount) {
            portfolio.push(candidate);
            sectorCount[sector] = currentCount + 1;
        }
    }

    // Step 4: Calculate portfolio metrics
    const portfolioMetrics = {
        totalCompanies: portfolio.length,
        avgQualityRank: average(portfolio.map(c => c.ranking.quality_rank)),
        avgEPSGrowth: average(portfolio.map(c => c.growth.eps_3y)),
        avgROE: average(portfolio.map(c => c.eps.roe)),
        sectorDistribution: sectorCount
    };

    console.log('Portfolio constructed:', portfolioMetrics);

    // Display portfolio
    displayPortfolio(portfolio, portfolioMetrics);

    return { portfolio, metrics: portfolioMetrics };
}

function average(arr) {
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function displayPortfolio(portfolio, metrics) {
    // Render portfolio table
    const tbody = document.getElementById('portfolio-table');
    tbody.innerHTML = portfolio.map((stock, i) => `
        <tr>
            <td>${i + 1}</td>
            <td><strong>${stock.ticker}</strong></td>
            <td>${stock.corp}</td>
            <td>${stock.sector}</td>
            <td>${stock.totalScore.toFixed(2)}</td>
            <td>${stock.ranking.quality_rank}</td>
            <td>${stock.growth.eps_3y.toFixed(2)}%</td>
            <td>${stock.eps.roe.toFixed(2)}%</td>
        </tr>
    `).join('');

    // Display metrics
    document.getElementById('portfolio-count').textContent = metrics.totalCompanies;
    document.getElementById('portfolio-avg-quality').textContent = metrics.avgQualityRank.toFixed(0);
    document.getElementById('portfolio-avg-growth').textContent = `${metrics.avgEPSGrowth.toFixed(2)}%`;
    document.getElementById('portfolio-avg-roe').textContent = `${metrics.avgROE.toFixed(2)}%`;

    // Render sector pie chart
    renderSectorPieChart(metrics.sectorDistribution);
}
```

---

### Use Case 4: Risk Assessment Application

**Objective**: Identify potential risks in companies or portfolio

```javascript
function assessCompanyRisk(ticker) {
    const eps = window.epsAnalytics.getCompanyEPS(ticker);
    const growth = window.growthAnalytics.getCompanyGrowth(ticker);
    const ranking = window.rankingAnalytics.getCompanyRanking(ticker);

    if (!eps || !growth || !ranking) {
        return { risk: 'UNKNOWN', score: null, factors: [] };
    }

    const riskFactors = [];
    let riskScore = 0;

    // Factor 1: Declining growth
    if (growth.sales_3y < growth.sales_7y &&
        growth.eps_3y < growth.eps_7y) {
        riskFactors.push({
            factor: 'Growth Deceleration',
            severity: 'MEDIUM',
            description: 'Both sales and EPS growth slowing down'
        });
        riskScore += 20;
    }

    // Factor 2: Low profitability
    if (eps.roe < 10 || eps.profit_margin < 5) {
        riskFactors.push({
            factor: 'Low Profitability',
            severity: 'HIGH',
            description: 'ROE or profit margin below acceptable thresholds'
        });
        riskScore += 30;
    }

    // Factor 3: Poor rankings
    if (ranking.quality_rank > 800) {
        riskFactors.push({
            factor: 'Low Quality Rank',
            severity: 'MEDIUM',
            description: 'Company ranked in bottom 35% for quality'
        });
        riskScore += 20;
    }

    // Factor 4: Negative EPS growth
    if (eps.eps_growth_3y < 0) {
        riskFactors.push({
            factor: 'Negative EPS Growth',
            severity: 'HIGH',
            description: 'Earnings declining over 3 years'
        });
        riskScore += 30;
    }

    // Factor 5: High valuation with low growth
    if (ranking.per_rank < 200 && growth.eps_3y < 10) {
        riskFactors.push({
            factor: 'Valuation Risk',
            severity: 'MEDIUM',
            description: 'High valuation not supported by growth'
        });
        riskScore += 20;
    }

    // Determine overall risk level
    let riskLevel;
    if (riskScore >= 50) riskLevel = 'HIGH';
    else if (riskScore >= 25) riskLevel = 'MEDIUM';
    else riskLevel = 'LOW';

    return {
        ticker,
        corp: eps.corp,
        risk: riskLevel,
        score: riskScore,
        factors: riskFactors
    };
}

function displayRiskAssessment(ticker) {
    const assessment = assessCompanyRisk(ticker);

    const riskColors = {
        'HIGH': 'danger',
        'MEDIUM': 'warning',
        'LOW': 'success',
        'UNKNOWN': 'secondary'
    };

    const html = `
        <div class="risk-assessment">
            <h5>Risk Assessment: ${assessment.corp}</h5>
            <div class="alert alert-${riskColors[assessment.risk]}">
                <strong>Risk Level: ${assessment.risk}</strong> (Score: ${assessment.score}/100)
            </div>

            ${assessment.factors.length > 0 ? `
                <h6>Risk Factors:</h6>
                <ul class="list-group">
                    ${assessment.factors.map(f => `
                        <li class="list-group-item">
                            <span class="badge bg-${f.severity === 'HIGH' ? 'danger' : 'warning'}">
                                ${f.severity}
                            </span>
                            <strong>${f.factor}</strong>: ${f.description}
                        </li>
                    `).join('')}
                </ul>
            ` : '<p class="text-success">No significant risk factors identified.</p>'}
        </div>
    `;

    document.getElementById('risk-panel').innerHTML = html;
}
```

---

## Troubleshooting

### Common Issues and Solutions

#### Issue 1: Analytics Module Not Initialized

**Symptom**: `window.epsAnalytics?.initialized` returns `false` or `undefined`

**Causes**:
- Data file `global_scouter_integrated.json` not loaded
- Network error during initialization
- Missing module script in HTML

**Solutions**:

```javascript
// Check initialization status
async function diagnoseInitialization() {
    console.log('Diagnosing Analytics initialization...');

    // Check if modules exist
    console.log('EPSAnalytics exists:', !!window.epsAnalytics);
    console.log('RankingAnalytics exists:', !!window.rankingAnalytics);
    console.log('GrowthAnalytics exists:', !!window.growthAnalytics);

    // Check initialization status
    console.log('EPSAnalytics initialized:', window.epsAnalytics?.initialized);
    console.log('RankingAnalytics initialized:', window.rankingAnalytics?.initialized);
    console.log('GrowthAnalytics initialized:', window.growthAnalytics?.initialized);

    // Try manual initialization
    if (!window.epsAnalytics?.initialized) {
        console.log('Attempting manual EPSAnalytics initialization...');
        const success = await window.epsAnalytics.initialize();
        console.log('Result:', success ? 'SUCCESS' : 'FAILED');
    }
}

// Run diagnosis
diagnoseInitialization();
```

**Verify HTML includes modules**:
```html
<script src="modules/EPSAnalytics.js"></script>
<script src="modules/RankingAnalytics.js"></script>
<script src="modules/GrowthAnalytics.js"></script>
```

---

#### Issue 2: Data Returns Null

**Symptom**: `getCompanyEPS('AAPL')` returns `null`

**Causes**:
- Ticker doesn't exist in dataset
- Typo in ticker symbol
- Data filtering removed the company

**Solutions**:

```javascript
// Debug data availability
function debugDataAvailability(ticker) {
    console.log(`Checking data for: ${ticker}`);

    // Check raw data
    const epsRaw = window.epsAnalytics?.epsData?.find(e => e.Ticker === ticker);
    const rankRaw = window.rankingAnalytics?.rankData?.find(r => r.Ticker === ticker);
    const growthRaw = window.growthAnalytics?.growthData?.find(g => g.Ticker === ticker);

    console.log('EPS raw data:', epsRaw ? 'FOUND' : 'NOT FOUND');
    console.log('Ranking raw data:', rankRaw ? 'FOUND' : 'NOT FOUND');
    console.log('Growth raw data:', growthRaw ? 'FOUND' : 'NOT FOUND');

    // Try parsed data
    const eps = window.epsAnalytics?.getCompanyEPS(ticker);
    const ranking = window.rankingAnalytics?.getCompanyRanking(ticker);
    const growth = window.growthAnalytics?.getCompanyGrowth(ticker);

    console.log('EPS parsed:', eps ? 'SUCCESS' : 'NULL');
    console.log('Ranking parsed:', ranking ? 'SUCCESS' : 'NULL');
    console.log('Growth parsed:', growth ? 'SUCCESS' : 'NULL');

    // List similar tickers
    if (!epsRaw) {
        const similar = window.epsAnalytics?.epsData
            ?.map(e => e.Ticker)
            .filter(t => t.includes(ticker.substring(0, 2)))
            .slice(0, 10);

        console.log('Similar tickers:', similar);
    }
}

// Usage:
debugDataAvailability('AAPL');
```

---

#### Issue 3: Charts Not Rendering

**Symptom**: Canvas element exists but chart doesn't appear

**Causes**:
- Chart.js not loaded
- Canvas element dimensions are 0x0
- Data format incompatible with chart type
- Previous chart instance not destroyed

**Solutions**:

```javascript
// Debug chart rendering
function debugChartRendering(canvasId) {
    console.log(`Debugging chart: ${canvasId}`);

    // Check canvas element
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }

    console.log('Canvas dimensions:', {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight
    });

    // Check Chart.js loaded
    if (typeof Chart === 'undefined') {
        console.error('Chart.js not loaded!');
        return;
    }

    // Check for existing chart instance
    const existingChart = Chart.getChart(canvas);
    if (existingChart) {
        console.log('Existing chart found, destroying...');
        existingChart.destroy();
    }

    // Try simple test chart
    try {
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: ['Test'],
                datasets: [{
                    label: 'Test Data',
                    data: [100]
                }]
            }
        });
        console.log('Test chart rendered successfully!');
    } catch (error) {
        console.error('Chart rendering error:', error);
    }
}

// Usage:
debugChartRendering('eps-roe-scatter-chart');
```

**Fix zero dimensions**:
```css
.chart-container {
    position: relative;
    height: 400px;  /* Ensure non-zero height */
    width: 100%;
}
```

---

#### Issue 4: Performance Issues

**Symptom**: Dashboard loads slowly or becomes unresponsive

**Causes**:
- Too many data points in charts
- No data caching
- Synchronous operations blocking UI
- Memory leaks from undestroyed charts

**Solutions**:

```javascript
// Performance optimization wrapper
function optimizedRender() {
    console.time('Dashboard Render');

    // Show loading indicator
    showLoadingSpinner();

    // Use setTimeout to avoid blocking UI
    setTimeout(async () => {
        try {
            // Destroy existing charts to prevent memory leaks
            Chart.helpers.each(Chart.instances, (chart) => {
                chart.destroy();
            });

            // Render charts in batches
            await renderGrowthAnalyticsCharts();

            await new Promise(resolve => setTimeout(resolve, 100));  // Yield to UI

            await renderRankingAnalyticsCharts();

            await new Promise(resolve => setTimeout(resolve, 100));

            await renderEPSAnalyticsCharts();

            hideLoadingSpinner();

            console.timeEnd('Dashboard Render');

        } catch (error) {
            console.error('Render error:', error);
            hideLoadingSpinner();
        }
    }, 0);
}

// Monitor performance
function monitorPerformance() {
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            console.log(`${entry.name}: ${entry.duration.toFixed(2)}ms`);
        }
    });

    observer.observe({ entryTypes: ['measure'] });

    // Mark key operations
    performance.mark('dashboard-start');
    // ... render operations
    performance.mark('dashboard-end');
    performance.measure('Dashboard Full Render', 'dashboard-start', 'dashboard-end');
}
```

---

#### Issue 5: Data Type Errors

**Symptom**: `Cannot read property 'toFixed' of null` or similar errors

**Causes**:
- Missing data validation before formatting
- Null values in calculations
- Type coercion issues

**Solutions**:

```javascript
// Safe formatting utilities
const SafeFormat = {
    number: (value, decimals = 2) => {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }
        return Number(value).toFixed(decimals);
    },

    percent: (value, decimals = 2) => {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }
        const sign = value >= 0 ? '+' : '';
        return `${sign}${Number(value).toFixed(decimals)}%`;
    },

    rank: (value) => {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }
        return `#${Math.round(value)}`;
    },

    currency: (value, symbol = '$') => {
        if (value === null || value === undefined || isNaN(value)) {
            return 'N/A';
        }
        return `${symbol}${Number(value).toLocaleString()}`;
    }
};

// Usage:
const eps = window.epsAnalytics.getCompanyEPS('AAPL');
console.log('ROE:', SafeFormat.percent(eps?.roe));
console.log('EPS:', SafeFormat.number(eps?.eps_current));
```

---

### Debug Mode

**Enable comprehensive logging**:

```javascript
// Add to stock_analyzer_enhanced.js
window.DEBUG_ANALYTICS = true;

// Modified Analytics methods with logging
if (window.DEBUG_ANALYTICS) {
    const originalGetCompanyEPS = EPSAnalytics.prototype.getCompanyEPS;
    EPSAnalytics.prototype.getCompanyEPS = function(ticker) {
        console.log(`[DEBUG] getCompanyEPS called with: ${ticker}`);
        const result = originalGetCompanyEPS.call(this, ticker);
        console.log(`[DEBUG] getCompanyEPS result:`, result);
        return result;
    };

    // Similar wrappers for other methods...
}
```

---

### Getting Help

**Check browser console for errors**:
```javascript
// Open browser console (F12), then:
console.log('Analytics Status:', {
    eps: window.epsAnalytics?.initialized,
    ranking: window.rankingAnalytics?.initialized,
    growth: window.growthAnalytics?.initialized
});
```

**Export diagnostic report**:
```javascript
function exportDiagnostics() {
    const diagnostics = {
        timestamp: new Date().toISOString(),
        modules: {
            epsAnalytics: {
                exists: !!window.epsAnalytics,
                initialized: window.epsAnalytics?.initialized,
                dataCount: window.epsAnalytics?.epsData?.length
            },
            rankingAnalytics: {
                exists: !!window.rankingAnalytics,
                initialized: window.rankingAnalytics?.initialized,
                dataCount: window.rankingAnalytics?.rankData?.length
            },
            growthAnalytics: {
                exists: !!window.growthAnalytics,
                initialized: window.growthAnalytics?.initialized,
                dataCount: window.growthAnalytics?.growthData?.length
            }
        },
        browser: {
            userAgent: navigator.userAgent,
            platform: navigator.platform
        },
        performance: {
            memory: performance.memory?.usedJSHeapSize
        }
    };

    console.log('Diagnostics:', diagnostics);

    // Download as JSON
    const blob = new Blob([JSON.stringify(diagnostics, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'analytics-diagnostics.json';
    a.click();
}

// Run and download diagnostics
exportDiagnostics();
```

---

## Conclusion

This guide covers the essential usage patterns for Sprint 4 Analytics modules. For additional functionality or custom implementations, refer to the source code in:

- `modules/EPSAnalytics.js`
- `modules/RankingAnalytics.js`
- `modules/GrowthAnalytics.js`
- `stock_analyzer_enhanced.js` (integration examples)

**Quick Start Checklist**:
- ✅ Verify modules loaded in HTML
- ✅ Check initialization status: `window.epsAnalytics?.initialized`
- ✅ Use safe data access patterns (null checks)
- ✅ Apply proper error handling
- ✅ Optimize chart rendering (lazy loading, data limits)
- ✅ Cache expensive calculations
- ✅ Monitor performance with browser DevTools

**Next Steps**:
- Explore custom screening strategies
- Build interactive dashboards
- Integrate with portfolio management systems
- Create automated alerts based on metric thresholds

---

**Document Version**: 1.0
**Last Updated**: 2025-10-18
**Compatibility**: Sprint 4 Analytics (EPSAnalytics, RankingAnalytics, GrowthAnalytics)