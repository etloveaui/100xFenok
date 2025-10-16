# API Documentation

**Version**: 1.0
**Last Updated**: October 17, 2025
**Target Audience**: Developers extending the Stock Analyzer

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Modules](#core-modules)
3. [Data Access](#data-access)
4. [Analytics Modules](#analytics-modules)
5. [UI Components](#ui-components)
6. [Extension Guide](#extension-guide)
7. [Testing](#testing)

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Stock Analyzer Application                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   UI Layer   │  │ Analytics    │  │  Portfolio   │      │
│  │              │  │  Layer       │  │  Layer       │      │
│  │ - Filtering  │  │ - Growth     │  │ - Builder    │      │
│  │ - Tables     │  │ - Ranking    │  │ - Optimizer  │      │
│  │ - Charts     │  │ - AI         │  │ - Risk       │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                   ┌────────▼─────────┐                       │
│                   │   Core Layer     │                       │
│                   │                  │                       │
│                   │ - DataManager    │                       │
│                   │ - EventBus       │                       │
│                   │ - StateManager   │                       │
│                   └────────┬─────────┘                       │
│                            │                                 │
│                   ┌────────▼─────────┐                       │
│                   │   Data Layer     │                       │
│                   │                  │                       │
│                   │ - CSV Files      │                       │
│                   │ - JSON Cache     │                       │
│                   │ - LocalStorage   │                       │
│                   └──────────────────┘                       │
└─────────────────────────────────────────────────────────────┘
```

### Technology Stack

**Frontend**:
- HTML5, CSS3 (Tailwind CSS)
- Vanilla JavaScript (ES6+)
- Chart.js for visualizations
- No frameworks (lightweight, fast)

**Data Processing**:
- Client-side JavaScript
- Pandas (Python, for data preparation)
- JSON for data interchange

**Storage**:
- Browser LocalStorage (portfolios, presets)
- Service Worker cache (offline mode)
- No backend database (static site)

---

## Core Modules

### DataManager

**Purpose**: Central data access and management

**Location**: `core/DataManager.js`

**Initialization**:
```javascript
class DataManager {
  constructor() {
    this.companies = [];
    this.growthData = null;
    this.rankingData = null;
    this.epsData = null;
    this.cfoData = null;
    this.isInitialized = false;
  }

  async initialize() {
    // Load M_Company.csv
    await this.loadCompanies();

    // Load integrated JSON (all T_ files)
    await this.loadIntegratedData();

    this.isInitialized = true;
  }
}
```

**Key Methods**:

```javascript
// Load company data
async loadCompanies()
  Returns: Array<Company>
  Throws: Error if fetch fails

// Get company by ticker
getCompany(ticker: string): Company | null
  Parameters:
    - ticker: Stock ticker symbol (e.g., "AAPL")
  Returns: Company object or null if not found

// Filter companies
filterCompanies(filters: FilterObject): Array<Company>
  Parameters:
    - filters: Object with filter criteria
  Returns: Filtered array of companies

// Search companies
searchCompanies(query: string): Array<Company>
  Parameters:
    - query: Search term (ticker, name, sector)
  Returns: Matching companies
```

**Company Object Schema**:
```javascript
{
  Ticker: "AAPL",
  Corp: "Apple Inc.",
  corpName: "Apple Inc.",
  Exchange: "NASDAQ",
  WI26: "Technology",
  Price: 178.50,
  "(USD mn)": 2847500,
  PER: 28.4,
  PBR: 7.2,
  PSR: 7.8,
  ROE: 147.4,
  ROA: 27.5,
  OPM: 30.2,
  NPM: 25.3,
  "Div Yield": 0.52,
  "Debt/Equity": 1.74,
  Beta: 1.24,
  Momentum: 72.5,
  // ... 34 total fields
}
```

---

### EventBus

**Purpose**: Decoupled component communication

**Location**: `core/EventBus.js`

**Usage**:
```javascript
// Subscribe to event
EventBus.on('company:selected', (company) => {
  console.log('Selected company:', company);
});

// Publish event
EventBus.emit('company:selected', companyObject);

// Unsubscribe
const handler = (data) => { /* ... */ };
EventBus.on('event', handler);
EventBus.off('event', handler);
```

**Built-in Events**:
```javascript
// Data events
'data:loaded'              // Data initialization complete
'data:error'               // Data loading error

// Filter events
'filter:applied'           // Filters applied, data: { filters, results }
'filter:cleared'           // All filters cleared

// Selection events
'company:selected'         // Company selected, data: Company object
'companies:compared'       // Multiple companies selected for comparison

// UI events
'modal:opened'             // Modal opened, data: { modalId }
'modal:closed'             // Modal closed
'tab:changed'              // Tab switched, data: { tabId }

// Portfolio events
'portfolio:created'        // New portfolio created
'portfolio:updated'        // Portfolio modified
'portfolio:optimized'      // Optimization completed

// Analytics events
'analytics:calculated'     // Analytics computed, data: results
```

---

### StateManager

**Purpose**: Global application state management

**Location**: `core/StateManager.js`

**State Structure**:
```javascript
{
  currentTab: 'screener',           // Active tab
  selectedCompany: null,            // Currently selected company
  filters: {},                      // Active filters
  viewMode: 'basic',                // Table view mode
  sortColumn: null,                 // Sort column
  sortDirection: 'asc',             // Sort direction
  pagination: {
    currentPage: 1,
    pageSize: 50,
    totalResults: 1250
  },
  portfolio: [],                    // Current portfolio
  compareList: []                   // Companies in comparison
}
```

**Methods**:
```javascript
// Get state
StateManager.get('currentTab')
  Returns: Current value

// Set state
StateManager.set('currentTab', 'dashboard')
  Triggers: state:changed event

// Update nested state
StateManager.update('pagination', { currentPage: 2 })
  Merges with existing pagination object

// Subscribe to changes
StateManager.subscribe('currentTab', (newValue, oldValue) => {
  console.log(`Tab changed from ${oldValue} to ${newValue}`);
});
```

---

### FilterManager

**Purpose**: Advanced filtering system

**Location**: `modules/FilterManager.js`

**Filter Types**:
```javascript
// Range filter
{
  type: 'range',
  field: 'PER',
  min: 10,
  max: 20
}

// Category filter (single value)
{
  type: 'category',
  field: 'Exchange',
  value: 'NASDAQ'
}

// Multi-select filter
{
  type: 'multiselect',
  field: 'WI26',
  values: ['Technology', 'Healthcare', 'Finance']
}

// Boolean filter
{
  type: 'boolean',
  field: 'Profitable',
  value: true
}

// Composite filter (QVM)
{
  type: 'composite',
  name: 'quality',
  filters: [
    { field: 'ROE', min: 15 },
    { field: 'Debt/Equity', max: 2.0 },
    { field: 'OPM', min: 10 }
  ]
}
```

**API**:
```javascript
class FilterManager {
  // Add filter
  addFilter(filter: FilterObject): void

  // Remove filter
  removeFilter(filterId: string): void

  // Clear all filters
  clearAll(): void

  // Apply filters to dataset
  apply(data: Array<Company>): Array<Company>

  // Get active filters
  getActive(): Array<FilterObject>

  // Save preset
  savePreset(name: string, filters: Array<FilterObject>): void

  // Load preset
  loadPreset(name: string): Array<FilterObject>
}
```

**Example Usage**:
```javascript
const filterManager = new FilterManager();

// Add filters
filterManager.addFilter({
  type: 'range',
  field: 'PER',
  min: 10,
  max: 20
});

filterManager.addFilter({
  type: 'multiselect',
  field: 'Exchange',
  values: ['NASDAQ', 'NYSE']
});

// Apply to data
const companies = dataManager.companies;
const filtered = filterManager.apply(companies);

console.log(`Filtered from ${companies.length} to ${filtered.length} companies`);
```

---

## Data Access

### Loading Data

**Integrated JSON Approach**:
```javascript
async function loadIntegratedData() {
  const response = await fetch('./data/global_scouter_integrated.json');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    technical: {
      T_Growth_C: data.data.technical.T_Growth_C,      // 1,252 companies
      T_Rank: data.data.technical.T_Rank,              // 1,252 companies
      T_EPS_C: data.data.technical.T_EPS_C,            // 1,252 companies
      T_CFO: data.data.technical.T_CFO                 // 1,266 companies
    },
    analysis: {
      A_Company: data.data.analysis.A_Company,         // 1,252 companies
      A_Distribution: data.data.analysis.A_Distribution // 1,177 companies
    },
    // ... other categories
  };
}
```

**Individual CSV Loading** (if needed):
```javascript
async function loadCSV(filename) {
  const response = await fetch(`./data/${filename}`);
  const text = await response.text();

  // Parse CSV (using Papa Parse or custom parser)
  const data = parseCSV(text);

  return data;
}
```

### Data Transformation

**Growth Analytics Example**:
```javascript
class GrowthAnalytics {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.growthData = null;
  }

  async initialize() {
    const integrated = await this.loadIntegratedData();
    this.growthData = integrated.data.technical.T_Growth_C;

    // Enrich with company data
    this.enrichGrowthData();
  }

  enrichGrowthData() {
    const companyMap = new Map(
      this.dataManager.companies.map(c => [c.Ticker, c])
    );

    this.growthData = this.growthData.map(growth => ({
      ...growth,
      corpName: companyMap.get(growth.Ticker)?.corpName,
      price: companyMap.get(growth.Ticker)?.Price
    }));
  }

  getCompanyGrowth(ticker) {
    const growth = this.growthData.find(g => g.Ticker === ticker);

    if (!growth) return null;

    return {
      ticker: growth.Ticker,
      sales_7y: this.parseGrowth(growth['Sales (7)']),
      sales_3y: this.parseGrowth(growth['Sales (3)']),
      op_7y: this.parseGrowth(growth['OP (7)']),
      op_3y: this.parseGrowth(growth['OP (3)']),
      eps_7y: this.parseGrowth(growth['EPS (7)']),
      eps_3y: this.parseGrowth(growth['EPS (3)'])
    };
  }

  parseGrowth(value) {
    if (value === null || value === undefined || value === '') return null;

    const num = parseFloat(value);
    if (isNaN(num)) return null;

    // Convert 0-1 range to percentage
    if (Math.abs(num) <= 1) {
      return num * 100;
    }

    return num;
  }
}
```

---

## Analytics Modules

### GrowthAnalytics Module

**File**: `modules/GrowthAnalytics.js`

**Public API**:
```javascript
class GrowthAnalytics {
  // Initialize module
  async initialize(): Promise<boolean>

  // Get company growth metrics
  getCompanyGrowth(ticker: string): GrowthMetrics | null

  // Get sector averages
  getSectorGrowthAverages(): Array<SectorGrowth>

  // Filter high-growth companies
  getHighGrowthCompanies(
    threshold: number = 20,
    metric: 'sales' | 'op' | 'eps' = 'sales',
    period: '7y' | '3y' = '7y'
  ): Array<CompanyGrowth>

  // Chart data for Chart.js
  getGrowthChartData(ticker: string): ChartData | null

  // Sector chart data
  getSectorGrowthChartData(topN: number = 10): ChartData

  // HTML summary for modals
  getGrowthSummaryHTML(ticker: string): string
}
```

**Data Types**:
```typescript
interface GrowthMetrics {
  ticker: string;
  corp: string;
  exchange: string;
  sector: string;
  sales_7y: number | null;
  sales_3y: number | null;
  op_7y: number | null;
  op_3y: number | null;
  eps_7y: number | null;
  eps_3y: number | null;
  roe_fwd: number | null;
  opm_fwd: number | null;
}

interface SectorGrowth {
  sector: string;
  count: number;
  sales_7y_avg: number | null;
  sales_3y_avg: number | null;
  op_7y_avg: number | null;
  op_3y_avg: number | null;
  eps_7y_avg: number | null;
  eps_3y_avg: number | null;
}

interface CompanyGrowth {
  ticker: string;
  corp: string;
  sector: string;
  growthRate: number;
  marketCap: number;
}
```

**Usage Example**:
```javascript
// Initialize
const growthAnalytics = new GrowthAnalytics(dataManager);
await growthAnalytics.initialize();

// Get company growth
const appleGrowth = growthAnalytics.getCompanyGrowth('AAPL');
console.log(`Apple 7y sales growth: ${appleGrowth.sales_7y}%`);

// Find high-growth stocks
const fastGrowers = growthAnalytics.getHighGrowthCompanies(25, 'eps', '3y');
console.log(`Found ${fastGrowers.length} companies with 3y EPS growth >25%`);

// Sector analysis
const sectorAverages = growthAnalytics.getSectorGrowthAverages();
const techSector = sectorAverages.find(s => s.sector === 'Technology');
console.log(`Tech sector avg growth: ${techSector.sales_7y_avg}%`);

// Generate chart
const chartData = growthAnalytics.getGrowthChartData('AAPL');
const chart = new Chart(ctx, {
  type: 'bar',
  data: chartData,
  options: { /* ... */ }
});
```

---

### SmartAnalytics Module

**File**: `modules/SmartAnalytics/SmartAnalytics.js`

**Public API**:
```javascript
class SmartAnalytics {
  // Calculate momentum score
  calculateMomentumScore(company: Company): MomentumScore

  // Detect patterns
  detectPatterns(company: Company): Array<Pattern>

  // Identify anomalies
  detectAnomalies(company: Company): Array<Anomaly>

  // Cluster companies
  clusterCompanies(companies: Array<Company>, method: string): ClusterResult
}
```

**Momentum Score Calculation**:
```javascript
function calculateMomentumScore(company) {
  // Weight factors
  const weights = {
    priceTrend: 0.30,
    volumeTrend: 0.20,
    financialStrength: 0.25,
    sectorPerformance: 0.15,
    marketSentiment: 0.10
  };

  // Calculate components (0-100 each)
  const priceTrend = calculatePriceTrend(company);
  const volumeTrend = calculateVolumeTrend(company);
  const financialStrength = calculateFinancialStrength(company);
  const sectorPerformance = calculateSectorPerformance(company);
  const marketSentiment = calculateMarketSentiment(company);

  // Weighted average
  const score =
    priceTrend * weights.priceTrend +
    volumeTrend * weights.volumeTrend +
    financialStrength * weights.financialStrength +
    sectorPerformance * weights.sectorPerformance +
    marketSentiment * weights.marketSentiment;

  return {
    overall: Math.round(score),
    components: {
      priceTrend,
      volumeTrend,
      financialStrength,
      sectorPerformance,
      marketSentiment
    }
  };
}
```

---

## UI Components

### Chart Rendering

**Using Chart.js**:
```javascript
function renderGrowthChart(ticker, canvasId) {
  const growthAnalytics = window.growthAnalytics;
  const chartData = growthAnalytics.getGrowthChartData(ticker);

  if (!chartData) {
    console.warn(`No growth data for ${ticker}`);
    return;
  }

  const ctx = document.getElementById(canvasId).getContext('2d');

  const chart = new Chart(ctx, {
    type: 'bar',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `Growth Rates - ${chartData.datasets[0].label}`
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              label += context.parsed.y.toFixed(2) + '%';
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: {
            display: true,
            text: 'Growth Rate (%)'
          }
        }
      }
    }
  });

  return chart;
}
```

### Modal System

**Opening Modal**:
```javascript
function openCompanyModal(ticker) {
  const company = dataManager.getCompany(ticker);

  if (!company) {
    console.error(`Company ${ticker} not found`);
    return;
  }

  // Populate modal content
  document.getElementById('modal-company-title').textContent = company.corpName;
  document.getElementById('modal-company-subtitle').textContent =
    `${company.Ticker} | ${company.Exchange} | ${company.WI26}`;

  document.getElementById('modal-per').textContent = company.PER?.toFixed(2) || 'N/A';
  document.getElementById('modal-pbr').textContent = company.PBR?.toFixed(2) || 'N/A';
  document.getElementById('modal-roe').textContent = company.ROE?.toFixed(2) + '%' || 'N/A';

  // Render charts
  renderRadarChart(company);
  renderComparisonBarChart(company);

  // Show modal
  const modal = document.getElementById('company-analysis-modal');
  modal.classList.add('active');

  // Emit event
  EventBus.emit('modal:opened', { modalId: 'company-analysis-modal', ticker });
}
```

---

## Extension Guide

### Adding a New Analytics Module

**Step 1: Create Module File**

Create `modules/MyNewAnalytics.js`:
```javascript
class MyNewAnalytics {
  constructor(dataManager) {
    this.dataManager = dataManager;
    this.myData = null;
    this.initialized = false;
  }

  async initialize() {
    console.log('[MyNewAnalytics] Initializing...');

    try {
      // Load your specific data
      const integratedData = await this.loadIntegratedData();
      this.myData = integratedData.data.technical.T_MyNewData;

      // Process data
      this.processData();

      this.initialized = true;
      console.log('[MyNewAnalytics] Initialized successfully');
      return true;

    } catch (error) {
      console.error('[MyNewAnalytics] Initialization failed:', error);
      return false;
    }
  }

  async loadIntegratedData() {
    const response = await fetch('./data/global_scouter_integrated.json');
    if (!response.ok) {
      throw new Error(`Failed to load data: ${response.status}`);
    }
    return await response.json();
  }

  processData() {
    // Your data processing logic
  }

  // Public API methods
  getMyMetric(ticker) {
    if (!this.initialized) {
      console.warn('[MyNewAnalytics] Not initialized');
      return null;
    }

    const data = this.myData.find(d => d.Ticker === ticker);
    return data ? this.formatMetric(data) : null;
  }

  formatMetric(data) {
    // Your formatting logic
    return {
      ticker: data.Ticker,
      value: data.MyValue,
      // ... other fields
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MyNewAnalytics;
}
```

**Step 2: Include in HTML**

Add to `stock_analyzer.html` before closing `</body>`:
```html
<script src="./modules/MyNewAnalytics.js"></script>
```

**Step 3: Initialize in Main Application**

In `stock_analyzer_enhanced.js`:
```javascript
// Initialize custom analytics
const myNewAnalytics = new MyNewAnalytics(dataManager);
await myNewAnalytics.initialize();

// Make globally accessible
window.myNewAnalytics = myNewAnalytics;
```

**Step 4: Add UI Integration**

Create UI components and wire up events:
```javascript
// Add button to UI
const button = document.createElement('button');
button.textContent = 'My New Analytics';
button.onclick = () => openMyNewAnalyticsModal();

// Modal function
function openMyNewAnalyticsModal() {
  const modal = document.getElementById('my-new-analytics-modal');

  // Populate with data
  const results = myNewAnalytics.getMyMetric('AAPL');
  // ... render results

  modal.classList.add('active');
}
```

---

### Adding a Custom Filter

**Step 1: Define Filter Logic**

```javascript
class CustomFilter {
  constructor(name, filterFunction) {
    this.name = name;
    this.filter = filterFunction;
  }

  apply(companies) {
    return companies.filter(this.filter);
  }
}

// Example: Filter companies with improving ROE
const improvingROEFilter = new CustomFilter(
  'Improving ROE',
  (company) => {
    // Your custom logic
    const currentROE = company.ROE;
    const historicalROE = getHistoricalROE(company.Ticker); // Your function

    return currentROE > historicalROE;
  }
);
```

**Step 2: Register with FilterManager**

```javascript
filterManager.registerCustomFilter(improvingROEFilter);
```

**Step 3: Add UI Control**

```html
<button onclick="applyImprovingROEFilter()">
  Improving ROE Filter
</button>
```

```javascript
function applyImprovingROEFilter() {
  filterManager.addFilter({
    type: 'custom',
    name: 'Improving ROE',
    filter: improvingROEFilter
  });

  filterManager.apply(dataManager.companies);
}
```

---

## Testing

### Unit Testing

**Framework**: Use Vitest or Jest

**Example Test**:
```javascript
// __tests__/GrowthAnalytics.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import GrowthAnalytics from '../modules/GrowthAnalytics';

describe('GrowthAnalytics', () => {
  let growthAnalytics;
  let mockDataManager;

  beforeEach(() => {
    mockDataManager = {
      companies: [
        { Ticker: 'AAPL', corpName: 'Apple Inc.' },
        { Ticker: 'MSFT', corpName: 'Microsoft Corp.' }
      ]
    };

    growthAnalytics = new GrowthAnalytics(mockDataManager);
  });

  it('should parse growth values correctly', () => {
    // Test decimal to percentage conversion
    expect(growthAnalytics.parseGrowth(0.25)).toBe(25);
    expect(growthAnalytics.parseGrowth(25)).toBe(25);
    expect(growthAnalytics.parseGrowth(null)).toBeNull();
  });

  it('should calculate sector averages', async () => {
    await growthAnalytics.initialize();

    const sectorAverages = growthAnalytics.getSectorGrowthAverages();

    expect(Array.isArray(sectorAverages)).toBe(true);
    expect(sectorAverages.length).toBeGreaterThan(0);
    expect(sectorAverages[0]).toHaveProperty('sector');
    expect(sectorAverages[0]).toHaveProperty('sales_7y_avg');
  });
});
```

### Integration Testing

**Test Data Loading**:
```javascript
describe('Data Integration', () => {
  it('should load all required data files', async () => {
    const dataManager = new DataManager();
    await dataManager.initialize();

    expect(dataManager.companies.length).toBeGreaterThan(6000);
    expect(dataManager.growthData.length).toBe(1252);
  });

  it('should join company data with growth data', async () => {
    const growthAnalytics = new GrowthAnalytics(dataManager);
    await growthAnalytics.initialize();

    const appleGrowth = growthAnalytics.getCompanyGrowth('AAPL');

    expect(appleGrowth).not.toBeNull();
    expect(appleGrowth.corpName).toBe('Apple Inc.');
    expect(appleGrowth.sales_7y).toBeTypeOf('number');
  });
});
```

### Manual Testing Checklist

**Basic Functionality**:
- [ ] Application loads without errors
- [ ] All 6,175+ companies load
- [ ] Search works for tickers, names, sectors
- [ ] Filters apply correctly
- [ ] Sorting works on all columns
- [ ] Pagination functions

**Analytics Modules**:
- [ ] GrowthAnalytics initializes
- [ ] Charts render correctly
- [ ] Sector averages calculate
- [ ] High-growth filtering works

**UI Components**:
- [ ] Modals open and close
- [ ] Tabs switch properly
- [ ] Charts are responsive
- [ ] Tables scroll smoothly

**Performance**:
- [ ] Initial load <10 seconds
- [ ] Filtering <1 second
- [ ] Sorting <500ms
- [ ] Chart rendering <2 seconds

---

## Best Practices

### Code Organization

**Module Structure**:
```
modules/
├── Core/
│   ├── DataManager.js
│   ├── EventBus.js
│   └── StateManager.js
├── Analytics/
│   ├── GrowthAnalytics.js
│   ├── RankingEngine.js
│   └── SmartAnalytics/
│       ├── SmartAnalytics.js
│       └── MomentumAI.js
├── UI/
│   ├── FilterManager.js
│   ├── ChartManager.js
│   └── PaginationManager.js
└── Portfolio/
    ├── PortfolioBuilder.js
    ├── PortfolioOptimizer.js
    └── RiskAnalyzer.js
```

### Error Handling

**Always handle errors gracefully**:
```javascript
async function loadData() {
  try {
    const response = await fetch('./data/companies.json');

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error('Failed to load data:', error);

    // Show user-friendly message
    showErrorMessage('Unable to load data. Please refresh the page.');

    // Return empty data to prevent crashes
    return [];
  }
}
```

### Performance Optimization

**Lazy Loading**:
```javascript
// Only load module when needed
let growthAnalytics = null;

async function openGrowthAnalytics() {
  if (!growthAnalytics) {
    growthAnalytics = new GrowthAnalytics(dataManager);
    await growthAnalytics.initialize();
  }

  // Use module
  const data = growthAnalytics.getSectorGrowthAverages();
  renderGrowthDashboard(data);
}
```

**Debouncing**:
```javascript
// Debounce search input
let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);

  searchTimeout = setTimeout(() => {
    performSearch(e.target.value);
  }, 300); // Wait 300ms after user stops typing
});
```

---

## Support & Resources

**Documentation**:
- USER_GUIDE.md: User-facing documentation
- FEATURE_DOCUMENTATION.md: Detailed feature specs
- DATA_DICTIONARY.md: All metrics explained

**Example Code**:
- See `modules/` for reference implementations
- Check `stock_analyzer_enhanced.js` for integration patterns

**Community**:
- GitHub Issues: Bug reports, feature requests
- Discussions: Q&A, ideas

---

**Document Version**: 1.0
**API Version**: 1.0
**Last Review**: October 17, 2025
