# Comprehensive Test Strategy
## Stock Analyzer System - 21 CSV Data Integration Testing

**Document Version**: 1.0
**Created**: 2025-10-17
**Author**: Quality Engineer (Claude Code)
**Project**: Global Scouter Stock Analyzer
**Status**: Draft for Review

---

## Executive Summary

This document defines a comprehensive testing strategy for the Stock Analyzer system integrating 21 CSV files (18,721 total rows) with quality scores ranging from 0-93.6%. The strategy follows industry-standard test pyramid principles while addressing specific data quality challenges identified in the system.

**Key Metrics Targets**:
- Test Coverage: ≥80%
- Data Quality Score: ≥95% (currently 91.0 for M_Company.csv)
- Performance: < 3 seconds load time
- Bug Density: < 1 critical bug per 1000 LOC
- Regression Detection: 100% for critical paths

---

## 1. Test Pyramid Strategy

### 1.1 Test Distribution

```
                    /\
                   /  \
                  / E2E \ (10%)
                 /------\
                /        \
               /Integration\ (30%)
              /------------\
             /              \
            /   Unit Tests   \ (60%)
           /------------------\
```

**Rationale**: Follow industry-standard 60-30-10 distribution to maximize test efficiency and maintenance:
- **Unit Tests (60%)**: Fast feedback, isolate module logic
- **Integration Tests (30%)**: Data flow validation across modules
- **E2E Tests (10%)**: Critical user workflows

### 1.2 Test Coverage Targets

| Layer | Coverage Target | Execution Time | Priority |
|-------|----------------|----------------|----------|
| Unit Tests | 80% | < 30 seconds | High |
| Integration Tests | 70% | < 2 minutes | High |
| E2E Tests | 100% of critical paths | < 5 minutes | Critical |
| Performance Tests | 100% of data operations | < 10 minutes | Medium |

---

## 2. Unit Testing Strategy

### 2.1 Module-Level Unit Tests

**Framework**: Vitest (already configured in package.json)

#### 2.1.1 GrowthAnalytics Module Tests

**File**: `tests/unit/GrowthAnalytics.test.js`

```javascript
// Test Cases:
describe('GrowthAnalytics', () => {
  // Initialization Tests
  test('initialize() loads T_Growth_C data successfully', async () => {
    // Assert: growthData is populated with 1252 records
  });

  test('initialize() handles missing T_Growth_C gracefully', async () => {
    // Assert: returns false, logs warning
  });

  // Data Parsing Tests
  test('parseGrowth() converts decimal to percentage correctly', () => {
    // Input: 0.15 → Output: 15
  });

  test('parseGrowth() handles null values', () => {
    // Input: null → Output: null
  });

  test('parseGrowth() handles invalid strings', () => {
    // Input: "N/A" → Output: null
  });

  // Business Logic Tests
  test('getCompanyGrowth() retrieves correct growth data', () => {
    // Given: ticker "AAPL"
    // Then: returns sales_7y, sales_3y, op_7y, etc.
  });

  test('getSectorGrowthAverages() calculates sector averages', () => {
    // Assert: returns array sorted by company count
  });

  test('getHighGrowthCompanies() filters by threshold', () => {
    // Given: threshold 20%
    // Then: returns only companies with ≥20% growth
  });

  // Edge Cases
  test('handles empty dataset gracefully', () => {});
  test('handles all-null growth values', () => {});
  test('handles extreme values (infinity, -infinity)', () => {});
});
```

**Coverage Target**: ≥85%

#### 2.1.2 RankingAnalytics Module Tests (Sprint 4)

**File**: `tests/unit/RankingAnalytics.test.js`

```javascript
describe('RankingAnalytics', () => {
  // T_Rank.csv (1252 rows, 38 columns, Quality 93.6)
  test('initialize() loads T_Rank data with 1252 records', async () => {});
  test('getRanking() returns correct multi-indicator rankings', () => {});
  test('getSectorRanking() filters by sector correctly', () => {});
  test('getCustomRanking() applies user-defined weights', () => {});
  test('handles ranking ties correctly', () => {});
  test('handles missing rank values (null handling)', () => {});
});
```

**Coverage Target**: ≥85%

#### 2.1.3 EPSAnalytics Module Tests (Sprint 5)

**File**: `tests/unit/EPSAnalytics.test.js`

```javascript
describe('EPSAnalytics', () => {
  // T_EPS_C.csv (1252 rows, 41 columns, Quality 93.4)
  test('initialize() loads T_EPS_C data successfully', async () => {});
  test('getEPSGrowth() calculates 7y and 3y EPS growth', () => {});
  test('calculatePERBand() generates PER band ranges', () => {});
  test('getEarningsQuality() evaluates earnings consistency', () => {});
  test('handles negative EPS values correctly', () => {});
  test('handles EPS discontinuities (null periods)', () => {});
});
```

**Coverage Target**: ≥85%

#### 2.1.4 CashFlowAnalytics Module Tests (Sprint 5)

**File**: `tests/unit/CashFlowAnalytics.test.js`

```javascript
describe('CashFlowAnalytics', () => {
  // T_CFO.csv (1266 rows, 36 columns, Quality 92.9)
  test('initialize() loads T_CFO data with 1266 records', async () => {});
  test('getOperatingCashFlow() retrieves CFO trends', () => {});
  test('calculateFCF() computes Free Cash Flow correctly', () => {});
  test('getCashConversionCycle() calculates CCC', () => {});
  test('getCashFlowHealthScore() rates cash flow health', () => {});
  test('handles negative cash flow periods', () => {});
  test('handles incomplete cash flow data (nulls)', () => {});
});
```

**Coverage Target**: ≥85%

### 2.2 Utility Function Tests

**File**: `tests/unit/utils.test.js`

```javascript
describe('Data Validation Utilities', () => {
  test('isValidNumber() validates numeric data', () => {});
  test('sanitizeCSVData() removes malformed rows', () => {});
  test('calculateQualityScore() computes data quality', () => {});
  test('handleNullValues() applies correct null strategies', () => {});
  test('detectOutliers() identifies statistical anomalies', () => {});
});

describe('Performance Utilities', () => {
  test('paginationManager handles 18,721 rows efficiently', () => {});
  test('lazyLoadData() loads data incrementally', () => {});
  test('cacheManager caches frequently accessed data', () => {});
});
```

**Coverage Target**: ≥90% (critical utility functions)

---

## 3. Data Quality Testing

### 3.1 CSV Validation Rules

**Framework**: Custom validation pipeline (existing in stock_analyzer_enhanced.js)

#### 3.1.1 Schema Validation

**Test File**: `tests/data-quality/schema-validation.test.js`

```javascript
describe('CSV Schema Validation', () => {
  const csvFiles = [
    { name: 'M_Company.csv', expectedRows: 6178, expectedCols: 34 },
    { name: 'T_Rank.csv', expectedRows: 1252, expectedCols: 38 },
    { name: 'T_Growth_C.csv', expectedRows: 1252, expectedCols: 50 },
    { name: 'T_EPS_C.csv', expectedRows: 1252, expectedCols: 41 },
    { name: 'T_CFO.csv', expectedRows: 1266, expectedCols: 36 }
  ];

  csvFiles.forEach(file => {
    test(`${file.name} has expected row count`, () => {
      // Assert: actual rows ≈ expected rows (±5% tolerance)
    });

    test(`${file.name} has expected column count`, () => {
      // Assert: column count matches schema
    });

    test(`${file.name} has required columns`, () => {
      // Assert: Ticker, Corp, Exchange columns exist
    });
  });
});
```

#### 3.1.2 Data Type Validation

```javascript
describe('Data Type Validation', () => {
  test('M_Company.csv numeric columns contain valid numbers', () => {
    // Columns: ROE, OPM, PER, PBR, etc.
    // Assert: no strings in numeric fields
  });

  test('T_Growth_C.csv growth rates are within reasonable bounds', () => {
    // Assert: -100% ≤ growth ≤ 10000%
  });

  test('T_Rank.csv ranks are positive integers', () => {
    // Assert: rank values are 1, 2, 3, ... N
  });
});
```

#### 3.1.3 Data Integrity Checks

**Test File**: `tests/data-quality/integrity.test.js`

```javascript
describe('Data Integrity', () => {
  test('All Ticker symbols are unique within M_Company.csv', () => {
    // Assert: no duplicate tickers
  });

  test('Foreign key integrity: T_Growth_C.Ticker exists in M_Company', () => {
    // Assert: all growth data maps to valid companies
  });

  test('No orphaned records across CSV files', () => {
    // Assert: referential integrity maintained
  });

  test('Date fields follow ISO 8601 format', () => {
    // Assert: dates are YYYY-MM-DD
  });
});
```

### 3.2 Quality Score Verification

**Target**: ≥95% (currently 91.0 for M_Company.csv)

**Test File**: `tests/data-quality/quality-score.test.js`

```javascript
describe('Quality Score Calculation', () => {
  test('M_Company.csv quality score ≥ 91%', () => {
    // Current: 91.0, Target: 95.0
  });

  test('S Tier files (5 files) maintain quality score ≥ 92%', () => {
    // T_Rank: 93.6, T_Growth_C: 92.8, T_EPS_C: 93.4, T_CFO: 92.9
  });

  test('Quality score calculation includes null%, outlier%, consistency%', () => {});
});

describe('Quality Improvement Tracking', () => {
  test('Track quality score improvements over time', () => {
    // Baseline → Target progression
  });

  test('Alert on quality score regression', () => {
    // If score drops > 5%, trigger alert
  });
});
```

### 3.3 Edge Case Handling

**Test File**: `tests/data-quality/edge-cases.test.js`

```javascript
describe('Null Value Handling', () => {
  test('T_Correlation.csv with 86.1% nulls handled gracefully', () => {
    // Strategy: Filter out null rows, use only valid data
  });

  test('E_Indicators.csv with 66.5% nulls displays warning', () => {
    // Assert: user sees "Low Data Quality" warning
  });

  test('A_ETFs.csv with 0% quality score skips processing', () => {
    // Assert: file not loaded, error logged
  });
});

describe('Infinity and NaN Handling', () => {
  test('Division by zero returns null, not Infinity', () => {});
  test('Invalid calculations return null, not NaN', () => {});
  test('Chart.js receives only valid numbers (no NaN/Infinity)', () => {});
});

describe('Extreme Value Handling', () => {
  test('Growth rates > 1000% capped or flagged as outliers', () => {});
  test('Negative market cap values rejected', () => {});
  test('PER > 1000 or < -100 flagged as unreliable', () => {});
});
```

---

## 4. Integration Testing Strategy

### 4.1 Data Flow Integration Tests

**Framework**: Vitest with DOM simulation (jsdom)

**Test File**: `tests/integration/data-flow.test.js`

```javascript
describe('Data Loading Pipeline', () => {
  test('loadData() successfully loads 6175 companies from M_Company.csv', async () => {
    // Given: server running
    // When: loadData() called
    // Then: allData contains 6175 records
  });

  test('loadIntegratedData() loads global_scouter_integrated.json', async () => {
    // Assert: Contains 21 CSV datasets in JSON structure
  });

  test('enrichGrowthData() merges T_Growth_C with M_Company', async () => {
    // Assert: Growth data includes company metadata
  });
});

describe('Module Integration', () => {
  test('GrowthAnalytics → DeepCompare panel integration', async () => {
    // Given: company selected
    // When: DeepCompare opened
    // Then: Growth summary displayed
  });

  test('RankingAnalytics → Screener filtering integration', async () => {
    // Given: ranking filter applied
    // When: applyFilters() called
    // Then: table shows only ranked companies
  });

  test('DashboardManager → Multiple analytics modules', async () => {
    // Assert: Dashboard aggregates data from all modules
  });
});

describe('Chart Integration', () => {
  test('GrowthAnalytics data → Chart.js visualization', () => {
    // Assert: Chart receives valid datasets
  });

  test('Chart resizing on tab switch (lazy initialization)', () => {
    // Given: dashboard tab switched
    // Then: Charts resize correctly
  });
});
```

### 4.2 User Interaction Integration Tests

**Test File**: `tests/integration/user-interactions.test.js`

```javascript
describe('Search and Filter Integration', () => {
  test('Search → Filter → Pagination flow', async () => {
    // Given: 6175 companies loaded
    // When: User searches "Apple" → Filters by sector → Pages to page 2
    // Then: Correct subset displayed
  });

  test('Advanced Filter → Column Visibility → Sorting', async () => {
    // Simulate complex user workflow
  });
});

describe('State Management Integration', () => {
  test('Sort state persists across pagination', () => {});
  test('Filter state persists across tab switches', () => {});
  test('Column configuration persists in localStorage', () => {});
});
```

---

## 5. End-to-End (E2E) Testing Strategy

### 5.1 Critical User Workflows

**Framework**: Playwright (recommended for browser automation)

#### 5.1.1 E2E Test Cases

**Test File**: `tests/e2e/critical-paths.spec.js`

```javascript
// E2E Test 1: Basic Stock Screening
test('User can search and view stock details', async ({ page }) => {
  // 1. Navigate to app
  await page.goto('http://localhost:5173');

  // 2. Wait for data load (6175 companies)
  await page.waitForSelector('#stock-table');

  // 3. Search for "Apple"
  await page.fill('#search-input', 'Apple');

  // 4. Verify search results
  const rows = await page.locator('tbody tr').count();
  expect(rows).toBeGreaterThan(0);

  // 5. Click on first result
  await page.locator('tbody tr').first().click();

  // 6. Verify detail panel opens
  await page.waitForSelector('#detail-panel');
  expect(await page.locator('#detail-panel').isVisible()).toBe(true);
});

// E2E Test 2: Advanced Filtering
test('User can apply advanced filters', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // 1. Open advanced filter panel
  await page.click('#advanced-filter-btn');

  // 2. Set ROE filter ≥ 15%
  await page.fill('#roe-min', '15');

  // 3. Set sector filter = "Technology"
  await page.selectOption('#sector-select', 'Technology');

  // 4. Apply filters
  await page.click('#apply-filters-btn');

  // 5. Verify filtered results
  const filteredCount = await page.locator('#result-count').textContent();
  expect(parseInt(filteredCount)).toBeLessThan(6175);

  // 6. Verify all results meet criteria
  const roeValues = await page.locator('.roe-cell').allTextContents();
  roeValues.forEach(val => {
    expect(parseFloat(val)).toBeGreaterThanOrEqual(15);
  });
});

// E2E Test 3: Growth Analytics Dashboard
test('User can view growth analytics', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // 1. Switch to Dashboard tab
  await page.click('#tab-dashboard');

  // 2. Wait for charts to render
  await page.waitForSelector('#growth-chart', { timeout: 10000 });

  // 3. Verify chart canvas exists
  const chartCanvas = await page.locator('#growth-chart canvas');
  expect(await chartCanvas.count()).toBeGreaterThan(0);

  // 4. Interact with chart (hover)
  await chartCanvas.hover();

  // 5. Verify tooltip appears
  await page.waitForSelector('.chart-tooltip');
});

// E2E Test 4: Deep Compare Workflow
test('User can compare two companies', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // 1. Search for "Microsoft"
  await page.fill('#search-input', 'Microsoft');
  await page.press('#search-input', 'Enter');

  // 2. Click compare button on first result
  await page.click('button[data-action="compare"]');

  // 3. Search for "Apple"
  await page.fill('#search-input', 'Apple');
  await page.press('#search-input', 'Enter');

  // 4. Click compare button on first result
  await page.click('button[data-action="compare"]');

  // 5. Verify comparison panel opens
  await page.waitForSelector('#comparison-panel');

  // 6. Verify both companies displayed
  const companies = await page.locator('.company-card').count();
  expect(companies).toBe(2);
});

// E2E Test 5: Data Load Performance
test('Data loads within 3 seconds', async ({ page }) => {
  const startTime = Date.now();

  await page.goto('http://localhost:5173');
  await page.waitForSelector('#stock-table tbody tr');

  const loadTime = Date.now() - startTime;
  expect(loadTime).toBeLessThan(3000); // < 3 seconds target
});
```

### 5.2 Browser Compatibility Tests

**Browsers to Test**:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

**Test File**: `tests/e2e/browser-compatibility.spec.js`

```javascript
const browsers = ['chromium', 'firefox', 'webkit'];

browsers.forEach(browserType => {
  test(`Works on ${browserType}`, async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('http://localhost:5173');
    await page.waitForSelector('#stock-table');

    // Verify core functionality
    const tableVisible = await page.locator('#stock-table').isVisible();
    expect(tableVisible).toBe(true);

    await context.close();
  });
});
```

### 5.3 Mobile Responsiveness Tests

**Test File**: `tests/e2e/mobile-responsive.spec.js`

```javascript
const devices = [
  { name: 'iPhone 13', viewport: { width: 390, height: 844 } },
  { name: 'iPad Pro', viewport: { width: 1024, height: 1366 } },
  { name: 'Samsung Galaxy S21', viewport: { width: 360, height: 800 } }
];

devices.forEach(device => {
  test(`Responsive on ${device.name}`, async ({ page }) => {
    await page.setViewportSize(device.viewport);
    await page.goto('http://localhost:5173');

    // Verify mobile menu visible
    const mobileMenu = await page.locator('#mobile-menu');
    expect(await mobileMenu.isVisible()).toBe(true);

    // Verify table scrolls horizontally
    const tableContainer = await page.locator('#table-container');
    const scrollWidth = await tableContainer.evaluate(el => el.scrollWidth);
    expect(scrollWidth).toBeGreaterThan(device.viewport.width);
  });
});
```

---

## 6. Regression Testing Strategy

### 6.1 Critical User Paths

**Regression Test Suite**: Run before every release

**Priority 1 - Critical Paths** (Must Pass 100%):
1. Data loading and display (6175 companies)
2. Search functionality
3. Basic filtering (sector, exchange)
4. Sorting (all columns)
5. Pagination (50 rows per page)
6. Detail panel opening
7. Chart rendering (Growth, Dashboard)

**Priority 2 - Important Paths** (Target 95%):
1. Advanced filtering (multi-criteria)
2. Deep compare (2 companies)
3. Column visibility toggling
4. Export functionality
5. Theme switching

**Priority 3 - Nice-to-Have** (Target 80%):
1. Advanced search (fuzzy matching)
2. Portfolio builder
3. Custom screener creation

### 6.2 Data Accuracy Verification

**Test File**: `tests/regression/data-accuracy.test.js`

```javascript
describe('Data Accuracy Regression', () => {
  // Baseline: Known-good dataset snapshots
  const baselineSnapshot = {
    M_Company: { rowCount: 6178, qualityScore: 91.0 },
    T_Growth_C: { rowCount: 1252, qualityScore: 92.8 }
  };

  test('M_Company row count matches baseline', () => {
    // Assert: current rowCount === baseline
  });

  test('Key financial ratios unchanged for stable companies', () => {
    // Given: company with no recent updates
    // Then: ROE, PER, PBR match baseline
  });

  test('Growth calculations consistent with previous sprint', () => {
    // Assert: No regression in growth rate formulas
  });
});
```

### 6.3 Performance Regression Detection

**Test File**: `tests/regression/performance.test.js`

```javascript
describe('Performance Regression', () => {
  const performanceBaseline = {
    dataLoadTime: 2500, // ms
    renderTime: 500,
    searchTime: 100,
    filterTime: 200
  };

  test('Data load time ≤ baseline', async () => {
    const startTime = Date.now();
    await loadData();
    const loadTime = Date.now() - startTime;

    expect(loadTime).toBeLessThanOrEqual(performanceBaseline.dataLoadTime);
  });

  test('Search performance ≤ baseline', async () => {
    // Measure search execution time
  });

  test('Memory usage within acceptable range', () => {
    // Assert: Heap size < 500 MB for 18,721 rows
  });
});
```

---

## 7. Automated Testing Framework

### 7.1 CI/CD Pipeline Integration

**Platform**: GitHub Actions (recommended)

**Pipeline Configuration**: `.github/workflows/test.yml`

```yaml
name: Test Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18

      - name: Install dependencies
        run: npm install

      - name: Run unit tests
        run: npm run test:run

      - name: Generate coverage report
        run: npm run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3

  integration-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3

      - name: Install dependencies
        run: npm install

      - name: Start test server
        run: npm run dev &

      - name: Run integration tests
        run: npm run test:integration

  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3

      - name: Install Playwright
        run: npx playwright install --with-deps

      - name: Start app
        run: npm run dev &

      - name: Run E2E tests
        run: npx playwright test

      - name: Upload test results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: playwright-report/

  data-quality-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Validate CSV schemas
        run: npm run test:data-quality

      - name: Check quality scores
        run: npm run test:quality-score
```

### 7.2 Test Execution Commands

**Update package.json scripts**:

```json
{
  "scripts": {
    "test": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest --coverage",
    "test:run": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:data-quality": "vitest run tests/data-quality",
    "test:regression": "vitest run tests/regression",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:report": "playwright show-report",
    "test:all": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

### 7.3 Playwright Configuration

**File**: `playwright.config.js`

```javascript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results.json' }]
  ],

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] }
    },
    {
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] }
    }
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000
  }
});
```

### 7.4 Visual Regression Testing

**Tool**: Playwright Visual Comparisons

**Test File**: `tests/e2e/visual-regression.spec.js`

```javascript
test('Homepage visual regression', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.waitForLoadState('networkidle');

  // Take screenshot and compare with baseline
  await expect(page).toHaveScreenshot('homepage.png', {
    maxDiffPixels: 100
  });
});

test('Dashboard chart visual regression', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await page.click('#tab-dashboard');
  await page.waitForSelector('#growth-chart canvas');

  const chartElement = page.locator('#growth-chart');
  await expect(chartElement).toHaveScreenshot('growth-chart.png');
});
```

---

## 8. Load Testing Strategy

### 8.1 Performance Benchmarks

**Target**: Handle 18,721 rows efficiently

**Tool**: Custom load testing script with timing measurements

**Test File**: `tests/performance/load-test.js`

```javascript
describe('Load Testing - 18,721 Rows', () => {
  test('Initial load time < 3 seconds', async () => {
    const startTime = performance.now();

    await fetch('./data/global_scouter_integrated.json');
    const data = await response.json();

    const loadTime = performance.now() - startTime;
    expect(loadTime).toBeLessThan(3000);
  });

  test('Search across 6175 companies < 100ms', async () => {
    const startTime = performance.now();

    const results = allData.filter(company =>
      company.corpName.includes('Apple')
    );

    const searchTime = performance.now() - startTime;
    expect(searchTime).toBeLessThan(100);
  });

  test('Complex filter (3 criteria) < 200ms', async () => {
    const startTime = performance.now();

    const results = allData.filter(company =>
      company.ROE >= 15 &&
      company.Sector === 'Technology' &&
      company.PER <= 20
    );

    const filterTime = performance.now() - startTime;
    expect(filterTime).toBeLessThan(200);
  });

  test('Pagination renders 50 rows < 50ms', async () => {
    const startTime = performance.now();

    const page1 = allData.slice(0, 50);
    renderTable(page1);

    const renderTime = performance.now() - startTime;
    expect(renderTime).toBeLessThan(50);
  });
});
```

### 8.2 Memory Profiling

```javascript
describe('Memory Usage', () => {
  test('Heap size remains < 500 MB for full dataset', () => {
    // Use Chrome DevTools Memory Profiler
    // Assert: Heap snapshot < 500 MB after all data loaded
  });

  test('No memory leaks after 100 search operations', async () => {
    const initialHeap = performance.memory.usedJSHeapSize;

    for (let i = 0; i < 100; i++) {
      await performSearch('test');
      clearSearch();
    }

    const finalHeap = performance.memory.usedJSHeapSize;
    const heapGrowth = finalHeap - initialHeap;

    expect(heapGrowth).toBeLessThan(10 * 1024 * 1024); // < 10 MB growth
  });
});
```

---

## 9. Manual Testing Checklist

### 9.1 Sprint-Level Acceptance Criteria

#### Sprint 4 (Current - Growth & Ranking)

**GrowthAnalytics Module**:
- [ ] 1252 growth records load successfully
- [ ] Growth rates display correctly (Sales 7y/3y, OP 7y/3y, EPS 7y/3y)
- [ ] Sector average calculations accurate
- [ ] High-growth filter works (threshold selection)
- [ ] Growth chart renders with correct data
- [ ] Chart.js tooltips show on hover
- [ ] Growth data integrates with DeepCompare panel

**RankingAnalytics Module** (Task 4.4):
- [ ] 1252 ranking records load successfully
- [ ] Multi-indicator rankings display (ROE, OPM, Growth)
- [ ] Sector-specific rankings work
- [ ] Custom weight ranking calculator functions
- [ ] Ranking ties handled correctly
- [ ] Ranking visualization clear and actionable

#### Sprint 5 (EPS & Cash Flow)

**EPSAnalytics Module**:
- [ ] 1252 EPS records load successfully
- [ ] EPS growth rates calculated correctly (7y, 3y)
- [ ] PER band chart displays historical PER ranges
- [ ] Earnings quality score calculated
- [ ] Negative EPS values handled gracefully

**CashFlowAnalytics Module**:
- [ ] 1266 CFO records load successfully
- [ ] Operating Cash Flow trends displayed
- [ ] FCF (Free Cash Flow) calculated correctly
- [ ] Cash Conversion Cycle computed
- [ ] Cash flow health score generated
- [ ] Negative cash flow periods flagged

#### Sprint 6 (Correlation & Distribution)

**Correlation Analysis**:
- [ ] T_Correlation.csv (86.1% null) processed with warnings
- [ ] Valid correlation data extracted
- [ ] Correlation matrix heatmap rendered
- [ ] Portfolio diversification insights generated

**Distribution Analysis**:
- [ ] A_Distribution.csv (76.3% null) filtered for valid data
- [ ] Valuation distribution charts (PER, PBR) displayed
- [ ] Percentile calculations accurate
- [ ] Outlier detection flags extreme values

### 9.2 User Acceptance Testing (UAT)

**Test Scenarios for End Users**:

1. **Stock Screening Workflow**:
   - User opens app → sees 6175 companies
   - User searches "Technology" → results filter correctly
   - User sorts by ROE → descending order verified
   - User clicks company → detail panel opens
   - User switches tabs → no data loss

2. **Advanced Analysis Workflow**:
   - User opens Dashboard tab → charts load within 3 seconds
   - User hovers over growth chart → tooltip shows accurate data
   - User switches to Portfolio tab → portfolio builder loads
   - User adds 5 companies to portfolio → portfolio metrics calculate

3. **Data Quality Verification**:
   - User opens low-quality dataset (E_Indicators.csv) → warning displayed
   - User sees "Data Quality: 33.5%" badge → understands data limitations
   - User applies filters → null values excluded from results

### 9.3 Browser Compatibility Checklist

**Test on Each Browser**:
- [ ] **Chrome**: All features work, no console errors
- [ ] **Firefox**: Charts render correctly, data loads
- [ ] **Safari**: No WebKit-specific bugs, animations smooth
- [ ] **Edge**: Compatibility with Chromium features verified

**Cross-Browser Issues to Check**:
- [ ] Chart.js canvas rendering (Safari may differ)
- [ ] localStorage persistence across browsers
- [ ] Fetch API CORS handling (local server)
- [ ] CSS Grid and Flexbox layout consistency
- [ ] JavaScript ES6+ feature support (arrow functions, async/await)

### 9.4 Mobile Responsiveness Checklist

**Test on Mobile Devices**:
- [ ] **iPhone 13** (390x844): Responsive layout, touch interactions work
- [ ] **iPad Pro** (1024x1366): Tablet-optimized layout, charts readable
- [ ] **Samsung Galaxy S21** (360x800): Android compatibility, no layout breaks

**Mobile-Specific Tests**:
- [ ] Horizontal scrolling for wide tables
- [ ] Mobile menu navigation
- [ ] Touch gestures (swipe, pinch-to-zoom on charts)
- [ ] Viewport meta tag prevents zooming issues
- [ ] Font sizes readable without zoom

---

## 10. Quality Metrics & Gates

### 10.1 Code Coverage Targets

| Sprint | Unit Coverage | Integration Coverage | E2E Coverage |
|--------|--------------|---------------------|--------------|
| Sprint 4 | ≥75% | ≥60% | 100% critical paths |
| Sprint 5 | ≥80% | ≥65% | 100% critical paths |
| Sprint 6 | ≥80% | ≥70% | 100% critical paths |
| Sprint 7+ | ≥85% | ≥75% | 100% critical paths |

**Critical Modules** (Must achieve ≥85% coverage):
- GrowthAnalytics.js
- RankingAnalytics.js
- EPSAnalytics.js
- CashFlowAnalytics.js
- stock_analyzer_enhanced.js (core)

### 10.2 Bug Density Targets

**Definition**: Bugs per 1000 Lines of Code (LOC)

| Severity | Target Density | Current Baseline |
|----------|----------------|------------------|
| Critical | 0 per 1000 LOC | TBD |
| High | < 1 per 1000 LOC | TBD |
| Medium | < 3 per 1000 LOC | TBD |
| Low | < 5 per 1000 LOC | TBD |

**Bug Tracking**:
- Use GitHub Issues with labels: `bug-critical`, `bug-high`, `bug-medium`, `bug-low`
- Track bug discovery phase: unit-test, integration-test, e2e-test, production
- Target: 80% of bugs found during unit/integration testing (not E2E or production)

### 10.3 Performance Benchmarks

| Metric | Target | Current | Sprint to Achieve |
|--------|--------|---------|-------------------|
| Initial Load Time | < 3 sec | TBD | Sprint 4 |
| Search Response | < 100 ms | TBD | Sprint 4 |
| Filter Response | < 200 ms | TBD | Sprint 4 |
| Chart Rendering | < 500 ms | TBD | Sprint 4 |
| Pagination Switch | < 50 ms | TBD | Sprint 4 |
| Memory Usage | < 500 MB | TBD | Sprint 5 |

### 10.4 User Satisfaction Metrics

**Collection Method**: Post-sprint user feedback surveys

| Metric | Target | Measurement |
|--------|--------|-------------|
| Feature Usability Score | ≥4.0/5.0 | User surveys (Sprint completion) |
| Data Accuracy Confidence | ≥4.5/5.0 | User trust in data quality |
| Performance Satisfaction | ≥4.0/5.0 | Perceived speed and responsiveness |
| Bug Report Rate | < 5 per sprint | GitHub Issues count |

---

## 11. Quality Gates (Sprint-Level)

### 11.1 Sprint 4 Quality Gates

**Must Pass Before Sprint 4 Completion**:

1. **Unit Tests**: ≥75% coverage for GrowthAnalytics.js and RankingAnalytics.js
2. **Integration Tests**: Data flow from T_Growth_C → GrowthAnalytics → DeepCompare verified
3. **E2E Tests**: Growth dashboard loads and displays charts correctly
4. **Data Quality**: T_Growth_C quality score ≥92.8% maintained
5. **Performance**: Initial load time < 3 seconds for 6175 companies
6. **Manual Testing**: All Sprint 4 acceptance criteria checked (see 9.1)

**Regression Gate**: No new critical or high-severity bugs introduced

**Blocker Resolution**: All P0 (critical) bugs fixed before sprint closure

### 11.2 Sprint 5 Quality Gates

**Must Pass Before Sprint 5 Completion**:

1. **Unit Tests**: ≥80% coverage for EPSAnalytics.js and CashFlowAnalytics.js
2. **Integration Tests**: EPS and CFO data integrated with main dashboard
3. **E2E Tests**: EPS chart and Cash Flow chart render correctly
4. **Data Quality**: T_EPS_C (93.4%) and T_CFO (92.9%) quality maintained
5. **Performance**: Chart rendering < 500ms for all analytics modules
6. **Regression**: All Sprint 4 tests still passing (no regression)

### 11.3 Sprint 6+ Quality Gates

**Continuous Quality Standards**:

1. **Coverage Maintenance**: No coverage drops > 5% from previous sprint
2. **Performance**: No regression > 10% for any performance metric
3. **Bug Density**: < 1 high-severity bug per 1000 LOC
4. **Data Quality**: All S-Tier files maintain quality score ≥90%
5. **E2E Tests**: 100% pass rate for critical paths
6. **Browser Compatibility**: All major browsers tested (Chrome, Firefox, Safari, Edge)

---

## 12. Test Data Management

### 12.1 Test Data Strategy

**Data Sources**:
1. **Production-like Data**: Use real CSV files from Global Scouter (21 files)
2. **Synthetic Data**: Generate edge cases (all nulls, extreme values, empty datasets)
3. **Snapshots**: Baseline snapshots for regression testing

**Test Data Location**:
- `tests/fixtures/csv/` - Sample CSV files for unit tests
- `tests/fixtures/json/` - JSON equivalents for integration tests
- `tests/fixtures/snapshots/` - Baseline snapshots for regression

### 12.2 Data Mocking Strategy

**For Unit Tests**: Mock fetch() calls with test data

```javascript
// Example: Mock global_scouter_integrated.json
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      data: {
        technical: {
          T_Growth_C: [
            { Ticker: 'AAPL', Corp: 'Apple', 'Sales (7)': 0.15, ... }
          ]
        }
      }
    })
  })
);
```

**For Integration Tests**: Use test server with fixture data

```javascript
// Start test server with fixtures
const testServer = await startTestServer({
  dataPath: './tests/fixtures/json'
});
```

### 12.3 Data Quality Test Fixtures

**Create fixtures for edge cases**:

1. **all-nulls.json**: Dataset where all growth values are null
2. **extreme-values.json**: Dataset with outliers (growth > 1000%, negative values)
3. **missing-columns.json**: Dataset missing required columns
4. **duplicate-tickers.json**: Dataset with duplicate Ticker entries
5. **invalid-types.json**: Dataset with strings in numeric columns

---

## 13. Risk Mitigation

### 13.1 Testing Risks

| Risk | Impact | Probability | Mitigation Strategy |
|------|--------|-------------|---------------------|
| Low data quality (66%-86% null in some CSVs) | High | High | Implement robust null handling, quality score warnings, filter invalid data |
| Performance degradation with 18,721 rows | Medium | Medium | Load testing early (Sprint 4), optimize pagination, lazy loading |
| Browser compatibility issues | Medium | Low | E2E tests on all major browsers, Playwright multi-browser testing |
| Test flakiness in CI/CD | Medium | Medium | Retry logic (2 retries), increase timeouts, isolate tests |
| Incomplete test coverage | High | Medium | Coverage gates (≥80%), code review emphasis on testability |
| Missing edge cases | Medium | High | Data quality tests with extreme values, fuzz testing |

### 13.2 Mitigation Actions

**Immediate Actions (Sprint 4)**:
1. Set up Vitest framework with coverage reporting
2. Create GrowthAnalytics and RankingAnalytics unit tests
3. Implement data quality validation pipeline
4. Set up Playwright for E2E tests (1-2 critical paths)
5. Establish performance baseline measurements

**Short-term Actions (Sprint 5-6)**:
1. Expand unit test coverage to ≥80% for all modules
2. Add integration tests for module interactions
3. Implement visual regression testing
4. Set up CI/CD pipeline with automated test runs
5. Create comprehensive E2E test suite (10+ scenarios)

**Long-term Actions (Sprint 7+)**:
1. Achieve ≥85% overall test coverage
2. Implement load testing for 100k+ row datasets (future scalability)
3. Add mutation testing to verify test effectiveness
4. Establish continuous performance monitoring
5. Integrate security testing (OWASP best practices)

---

## 14. Tools & Dependencies

### 14.1 Testing Tools

**Unit & Integration Testing**:
- **Vitest** (already configured): Fast unit testing with coverage
- **jsdom**: DOM simulation for browser-based code
- **@vitest/ui**: Interactive test UI
- **vitest-fetch-mock**: Mock fetch API calls

**E2E Testing**:
- **Playwright**: Cross-browser automation
- **@playwright/test**: Test runner and assertions

**Data Quality Testing**:
- **csv-parse**: CSV parsing and validation
- **joi** or **zod**: Schema validation

**Performance Testing**:
- **Chrome DevTools Protocol**: Memory profiling
- **Lighthouse CI**: Performance metrics in CI/CD

**Visual Regression**:
- **Playwright Visual Comparisons**: Built-in screenshot diffing

### 14.2 Installation Commands

```bash
# Unit & Integration Testing
npm install --save-dev vitest @vitest/ui jsdom vitest-fetch-mock

# E2E Testing
npm install --save-dev @playwright/test
npx playwright install --with-deps

# Data Validation
npm install --save-dev csv-parse zod

# Code Coverage
npm install --save-dev @vitest/coverage-v8
```

### 14.3 Configuration Files to Create

1. **vitest.config.js** - Vitest configuration
2. **playwright.config.js** - Playwright configuration (see Section 7.3)
3. **.github/workflows/test.yml** - CI/CD pipeline (see Section 7.1)
4. **tests/setup.js** - Test environment setup
5. **tests/fixtures/** - Test data directory structure

---

## 15. Implementation Roadmap

### 15.1 Sprint 4 Testing Tasks (Current Sprint)

**Week 1-2**:
- [ ] Task 4.T1: Set up Vitest framework and initial configuration
- [ ] Task 4.T2: Create GrowthAnalytics.test.js with ≥75% coverage
- [ ] Task 4.T3: Create RankingAnalytics.test.js with ≥75% coverage
- [ ] Task 4.T4: Implement data quality validation tests
- [ ] Task 4.T5: Set up Playwright and create 2 E2E tests (critical paths)
- [ ] Task 4.T6: Establish performance baseline measurements
- [ ] Task 4.T7: Document testing process in README.md

**Acceptance Criteria**:
- Unit tests running with `npm run test`
- Coverage report generated with `npm run test:coverage`
- E2E tests passing with `npx playwright test`
- All quality gates met (see 11.1)

### 15.2 Sprint 5 Testing Tasks

**Week 1-2**:
- [ ] Task 5.T1: Create EPSAnalytics.test.js with ≥80% coverage
- [ ] Task 5.T2: Create CashFlowAnalytics.test.js with ≥80% coverage
- [ ] Task 5.T3: Add integration tests for module interactions
- [ ] Task 5.T4: Expand E2E test suite to 5+ scenarios
- [ ] Task 5.T5: Implement browser compatibility tests (Chrome, Firefox, Safari)
- [ ] Task 5.T6: Set up CI/CD pipeline (GitHub Actions)
- [ ] Task 5.T7: Create mobile responsiveness tests

**Acceptance Criteria**:
- Overall coverage ≥80% for Sprint 5 modules
- CI/CD pipeline running on every commit
- All browsers passing E2E tests
- Performance regression checks in place

### 15.3 Sprint 6+ Testing Tasks

**Ongoing**:
- [ ] Task 6.T1: Maintain ≥80% coverage for all new modules
- [ ] Task 6.T2: Add regression tests for each new feature
- [ ] Task 6.T3: Implement visual regression testing
- [ ] Task 6.T4: Create load testing suite for 100k+ rows (future-proofing)
- [ ] Task 6.T5: Add security testing (XSS, injection prevention)
- [ ] Task 6.T6: Continuous performance monitoring setup
- [ ] Task 6.T7: Monthly test suite maintenance and refactoring

---

## 16. Success Criteria

### 16.1 Sprint-Level Success

**Sprint 4**:
- ✅ 75% unit test coverage achieved
- ✅ 2+ E2E tests passing
- ✅ Data quality validation implemented
- ✅ Performance baseline established (< 3s load time)

**Sprint 5**:
- ✅ 80% unit test coverage achieved
- ✅ 5+ E2E tests passing across 3 browsers
- ✅ CI/CD pipeline operational
- ✅ No performance regression from Sprint 4

**Sprint 6+**:
- ✅ 85% overall test coverage
- ✅ 10+ E2E tests covering all critical workflows
- ✅ Visual regression testing active
- ✅ Zero critical bugs in production

### 16.2 Long-Term Success Indicators

**By Sprint 9 (End of Phase 4-2)**:
- ✅ Comprehensive test suite covering 21 CSV files
- ✅ Automated CI/CD with quality gates
- ✅ Bug density < 1 per 1000 LOC
- ✅ User satisfaction score ≥4.0/5.0
- ✅ 100% uptime for critical features
- ✅ Performance benchmarks consistently met

**By Sprint 15 (End of Phase 5 - AI & Automation)**:
- ✅ Full test automation for 100% of features
- ✅ AI-driven test generation and maintenance
- ✅ Real-time monitoring and alerting
- ✅ Mobile PWA fully tested and deployed
- ✅ Production-ready quality standards achieved

---

## 17. Documentation & Knowledge Sharing

### 17.1 Testing Documentation

**Documents to Maintain**:
1. **This Strategy Document**: Update quarterly or when major changes occur
2. **Test Case Catalog**: Comprehensive list of all test cases (Excel or Markdown)
3. **Bug Report Templates**: Standardized bug reporting format
4. **Performance Benchmarks**: Historical performance data tracking
5. **Coverage Reports**: Automated coverage reports from CI/CD
6. **E2E Test Reports**: Playwright HTML reports with screenshots

### 17.2 Team Knowledge Sharing

**Practices**:
- Weekly test review meetings (Sprint retrospectives)
- Pair testing sessions for complex features
- Test-driven development (TDD) workshops
- Code review checklist includes testability review
- Post-mortem analysis for production bugs

### 17.3 Testing Best Practices Guide

**Create**: `docs/TESTING_BEST_PRACTICES.md`

**Topics to Cover**:
- How to write effective unit tests
- When to mock vs. use real data
- E2E test patterns and anti-patterns
- Performance testing guidelines
- Data quality testing strategies
- Debugging flaky tests

---

## 18. Appendix

### 18.1 Testing Glossary

- **Unit Test**: Test of individual function/method in isolation
- **Integration Test**: Test of multiple modules working together
- **E2E Test**: Test of complete user workflow from start to finish
- **Regression Test**: Test to ensure existing features still work after changes
- **Smoke Test**: Quick test of critical functionality (build sanity check)
- **Load Test**: Test of system performance under expected load
- **Stress Test**: Test of system behavior under extreme load
- **Flaky Test**: Test that intermittently fails without code changes
- **Test Coverage**: Percentage of code executed by tests
- **Test Fixture**: Predefined data or state used in tests

### 18.2 CSV File Reference

**S Tier Files** (5 files - Immediate Testing Priority):
1. M_Company.csv (6178 rows, 34 cols, Quality 91.0) - Main dataset
2. T_Rank.csv (1252 rows, 38 cols, Quality 93.6) - Rankings
3. T_Growth_C.csv (1252 rows, 50 cols, Quality 92.8) - Growth data
4. T_EPS_C.csv (1252 rows, 41 cols, Quality 93.4) - EPS data
5. T_CFO.csv (1266 rows, 36 cols, Quality 92.9) - Cash flow data

**A Tier Files** (5 files - Sprint 6-9 Testing):
6. A_Company.csv (1252 rows, 52 cols, Quality 93.8)
7. T_Chk.csv (1252 rows, 78 cols, Quality 86.2)
8. E_Indicators.csv (1032 rows, 68 cols, Quality 33.5) - **Low quality warning**
9. T_Correlation.csv (1251 rows, 42 cols, Quality 13.9) - **Very low quality**
10. A_Distribution.csv (1177 rows, 61 cols, Quality 23.7) - **Low quality**

**B Tier Files** (10 files - Sprint 10+ Testing):
11-21. Various smaller datasets (55-491 rows each)

### 18.3 Quality Score Calculation

**Formula**:
```
Quality Score = (Valid Data % × 0.4) + (Completeness % × 0.3) +
                (Consistency % × 0.2) + (Accuracy % × 0.1)

Where:
- Valid Data % = (Total Cells - Null Cells) / Total Cells × 100
- Completeness % = (Rows with All Required Fields) / Total Rows × 100
- Consistency % = (Rows Passing Type Validation) / Total Rows × 100
- Accuracy % = (Rows Within Expected Ranges) / Total Rows × 100
```

### 18.4 Contact & Support

**Testing Lead**: Quality Engineer (Claude Code)
**Development Team**: Sprint 4 Development Team
**Questions**: Raise in Sprint retrospective or create GitHub Discussion
**Bug Reports**: GitHub Issues with `bug` label
**Performance Issues**: GitHub Issues with `performance` label

---

## Document Approval

**Prepared by**: Quality Engineer (Claude Code)
**Date**: 2025-10-17
**Version**: 1.0 - Initial Draft
**Status**: **Awaiting User Review and Approval**

**Next Steps**:
1. User review and feedback
2. Approval and sign-off
3. Implementation in Sprint 4 (Testing Tasks 4.T1-4.T7)
4. Continuous refinement based on learnings

---

**END OF DOCUMENT**
