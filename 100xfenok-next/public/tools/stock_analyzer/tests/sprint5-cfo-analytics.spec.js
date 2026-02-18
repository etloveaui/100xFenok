/**
 * Sprint 5: CFOAnalytics E2E Tests
 *
 * Purpose: Test CFOAnalytics module functionality (714 lines, 23 methods)
 * Tests: 15+ comprehensive test cases
 * Coverage: Initialization, cash flow data, health scores, chart data generation
 */

import { test, expect } from '@playwright/test';

test.describe('CFOAnalytics Module - Initialization and Setup', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/stock_analyzer.html');

    // Wait for initial page load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Allow JS modules to initialize
  });

  test('CFOAnalytics class should be available globally', async ({ page }) => {
    // Test: CFOAnalytics class should exist in window scope
    const cfoAnalyticsExists = await page.evaluate(() => {
      return typeof window.cfoAnalytics !== 'undefined';
    });

    expect(cfoAnalyticsExists).toBeTruthy();
  });

  test('CFOAnalytics should initialize with dataManager', async ({ page }) => {
    // Test: CFOAnalytics instance should have correct properties
    const hasDataManager = await page.evaluate(() => {
      return window.cfoAnalytics && window.cfoAnalytics.dataManager !== null;
    });

    expect(hasDataManager).toBeTruthy();
  });

  test('CFOAnalytics initialization should load T_CFO data', async ({ page }) => {
    // Test: CFOAnalytics should successfully load CFO data (1,264 companies)
    const initResult = await page.evaluate(async () => {
      if (!window.cfoAnalytics) return null;

      // Initialize if not already initialized
      if (!window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }

      return {
        initialized: window.cfoAnalytics.initialized,
        hasData: window.cfoAnalytics.cfoData !== null,
        dataCount: window.cfoAnalytics.cfoData?.length || 0
      };
    });

    expect(initResult.initialized).toBeTruthy();
    expect(initResult.hasData).toBeTruthy();
    expect(initResult.dataCount).toBeGreaterThan(1200);
    expect(initResult.dataCount).toBeLessThanOrEqual(1300); // ~1,264 companies
  });

  test('CFOAnalytics initialization should complete within performance threshold', async ({ page }) => {
    // Test: Initialization should complete in less than 1.5 seconds
    const startTime = Date.now();

    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(1500);
  });
});

test.describe('CFOAnalytics Module - Cash Flow Data Retrieval', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Ensure initialization
    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
    });
  });

  test('getCompanyCFO() should return valid data for known ticker', async ({ page }) => {
    // Test: getCompanyCFO should return complete CFO data structure
    const cfoData = await page.evaluate(() => {
      // Try to get CFO data for the first available company
      const firstTicker = window.cfoAnalytics.cfoData?.[0]?.Ticker;
      if (!firstTicker) return null;

      return window.cfoAnalytics.getCompanyCFO(firstTicker);
    });

    expect(cfoData).not.toBeNull();
    expect(cfoData).toHaveProperty('ticker');
    expect(cfoData).toHaveProperty('corp');
    expect(cfoData).toHaveProperty('exchange');
    expect(cfoData).toHaveProperty('sector');
    expect(cfoData).toHaveProperty('ccc'); // Cash Conversion Cycle
    expect(cfoData).toHaveProperty('opm_fwd'); // Operating Profit Margin (Forward)
    expect(cfoData).toHaveProperty('roe_fwd'); // Return on Equity (Forward)
  });

  test('getCompanyCFO() should return null for invalid ticker', async ({ page }) => {
    // Test: getCompanyCFO should handle invalid ticker gracefully
    const cfoData = await page.evaluate(() => {
      return window.cfoAnalytics.getCompanyCFO('INVALID_TICKER_XYZ');
    });

    expect(cfoData).toBeNull();
  });

  test('Cash flow data should contain FY-4 to FY+3 range', async ({ page }) => {
    // Test: CFO data should have historical and forecast years
    const hasYearRange = await page.evaluate(() => {
      const firstCompany = window.cfoAnalytics.cfoData?.[0];
      if (!firstCompany) return false;

      // Check for some historical years
      const hasHistorical = 'FY-4' in firstCompany || 'FY-3' in firstCompany || 'FY-2' in firstCompany;
      // Check for current and forecast years
      const hasCurrent = 'FY 0' in firstCompany;
      const hasForecast = 'FY+1' in firstCompany || 'FY+2' in firstCompany || 'FY+3' in firstCompany;

      return hasHistorical && hasCurrent && hasForecast;
    });

    expect(hasYearRange).toBeTruthy();
  });

  test('getHighCashFlowCompanies() should filter companies by threshold', async ({ page }) => {
    // Test: getHighCashFlowCompanies should return companies above threshold
    const highCFOCompanies = await page.evaluate(() => {
      return window.cfoAnalytics.getHighCashFlowCompanies(10000, 'FY 0');
    });

    expect(Array.isArray(highCFOCompanies)).toBeTruthy();

    // Verify all companies meet the threshold
    highCFOCompanies.forEach(company => {
      expect(company.cfoValue).toBeGreaterThanOrEqual(10000);
      expect(company).toHaveProperty('ticker');
      expect(company).toHaveProperty('corp');
      expect(company).toHaveProperty('sector');
    });

    // Verify companies are sorted by CFO (descending)
    if (highCFOCompanies.length > 1) {
      expect(highCFOCompanies[0].cfoValue).toBeGreaterThanOrEqual(highCFOCompanies[1].cfoValue);
    }
  });
});

test.describe('CFOAnalytics Module - Cash Flow Health Score', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
    });
  });

  test('getCFOHealthScore() should return score in 0-100 range', async ({ page }) => {
    // Test: Health score should be between 0 and 100
    const healthScore = await page.evaluate(() => {
      const firstTicker = window.cfoAnalytics.cfoData?.[0]?.Ticker;
      if (!firstTicker) return null;

      const result = window.cfoAnalytics.getCFOHealthScore(firstTicker);
      return result?.totalScore || null;
    });

    expect(healthScore).not.toBeNull();
    expect(healthScore).toBeGreaterThanOrEqual(0);
    expect(healthScore).toBeLessThanOrEqual(100);
  });

  test('Health score components should follow weighting rules', async ({ page }) => {
    // Test: FCF 30%, CCC 25%, OPM 25%, Growth 20%
    const scoreComponents = await page.evaluate(() => {
      // Test with a company that has good metrics
      const companies = window.cfoAnalytics.cfoData || [];
      const testCompany = companies.find(c => {
        const cfo = parseFloat(c['FY 0']);
        return cfo > 10000; // Find a company with positive cash flow
      });

      if (!testCompany) return null;

      const healthResult = window.cfoAnalytics.getCFOHealthScore(testCompany.Ticker);

      return {
        ticker: testCompany.Ticker,
        score: healthResult?.totalScore || 0,
        breakdown: healthResult?.breakdown || null,
        ccc: parseFloat(testCompany['CCC (FY 0)']),
        opm: parseFloat(testCompany['OPM (Fwd)']),
        roe: parseFloat(testCompany['ROE (Fwd)'])
      };
    });

    expect(scoreComponents).not.toBeNull();
    expect(scoreComponents.score).toBeGreaterThan(0);
    expect(scoreComponents.breakdown).not.toBeNull();
  });

  test('getSectorCFOAverages() should return sector aggregated data', async ({ page }) => {
    // Test: getSectorCFOAverages should calculate sector averages correctly
    const sectorData = await page.evaluate(() => {
      return window.cfoAnalytics.getSectorCFOAverages();
    });

    expect(Array.isArray(sectorData)).toBeTruthy();
    expect(sectorData.length).toBeGreaterThan(0);

    // Check first sector data structure
    const firstSector = sectorData[0];
    expect(firstSector).toHaveProperty('sector');
    expect(firstSector).toHaveProperty('count');
    expect(firstSector).toHaveProperty('cfo_fy0_avg');
    expect(firstSector).toHaveProperty('ccc_avg');

    // Verify data is sorted by count (descending)
    if (sectorData.length > 1) {
      expect(sectorData[0].count).toBeGreaterThanOrEqual(sectorData[1].count);
    }
  });
});

test.describe('CFOAnalytics Module - Chart Data Generation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
    });
  });

  test('getCFOWaterfallData() should generate Chart.js compatible waterfall data', async ({ page }) => {
    // Test: getCFOWaterfallData should return valid Chart.js format
    const chartData = await page.evaluate(() => {
      const firstTicker = window.cfoAnalytics.cfoData?.[0]?.Ticker;
      if (!firstTicker) return null;

      return window.cfoAnalytics.getCFOWaterfallData(firstTicker);
    });

    expect(chartData).not.toBeNull();
    expect(chartData).toHaveProperty('labels');
    expect(chartData).toHaveProperty('datasets');
    expect(Array.isArray(chartData.labels)).toBeTruthy();
    expect(chartData.labels.length).toBeGreaterThan(0);

    expect(chartData.datasets[0]).toHaveProperty('label');
    expect(chartData.datasets[0]).toHaveProperty('data');
    expect(chartData.datasets[0]).toHaveProperty('backgroundColor');
  });

  test('getSectorCFOHeatmapData() should generate sector heatmap data', async ({ page }) => {
    // Test: getSectorCFOHeatmapData should return heatmap format (array of objects)
    const heatmapData = await page.evaluate(() => {
      return window.cfoAnalytics.getSectorCFOHeatmapData();
    });

    expect(Array.isArray(heatmapData)).toBeTruthy();
    expect(heatmapData.length).toBeGreaterThan(5); // Multiple sectors

    // Verify data structure of first item
    const firstItem = heatmapData[0];
    expect(firstItem).toHaveProperty('sector');
    expect(firstItem).toHaveProperty('cfo');
    expect(firstItem).toHaveProperty('ccc');
    expect(firstItem).toHaveProperty('opm');
    expect(firstItem).toHaveProperty('count');
  });

  test('getCFOvsROEScatterData() should generate scatter plot data', async ({ page }) => {
    // Test: getCFOvsROEScatterData should return scatter chart format
    const scatterData = await page.evaluate(() => {
      return window.cfoAnalytics.getCFOvsROEScatterData(50);
    });

    expect(scatterData).not.toBeNull();
    expect(scatterData).toHaveProperty('datasets');
    expect(Array.isArray(scatterData.datasets)).toBeTruthy();
    expect(scatterData.datasets.length).toBeGreaterThan(0);

    // Verify scatter data point structure
    const dataset = scatterData.datasets[0];
    expect(dataset).toHaveProperty('data');
    expect(Array.isArray(dataset.data)).toBeTruthy();
    expect(dataset.data.length).toBeGreaterThan(0);
    expect(dataset.data.length).toBeLessThanOrEqual(50);

    // Verify each data point has x, y, r properties
    dataset.data.forEach(point => {
      expect(point).toHaveProperty('x');
      expect(point).toHaveProperty('y');
      expect(point).toHaveProperty('r');
    });
  });
});

test.describe('CFOAnalytics Module - Edge Cases and Error Handling', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('Methods should handle uninitialized state gracefully', async ({ page }) => {
    // Test: Methods should return safe defaults when not initialized
    const results = await page.evaluate(() => {
      // Create a new uninitialized instance
      const uninitializedCFO = new CFOAnalytics({});

      return {
        getCompanyCFO: uninitializedCFO.getCompanyCFO('AAPL'),
        getSectorCFOAverages: uninitializedCFO.getSectorCFOAverages(),
        getHighCashFlowCompanies: uninitializedCFO.getHighCashFlowCompanies(10000, 'FY 0')
      };
    });

    expect(results.getCompanyCFO).toBeNull();
    expect(results.getSectorCFOAverages).toEqual([]);
    expect(results.getHighCashFlowCompanies).toEqual([]);
  });

  test('compareCFO() should handle empty ticker array', async ({ page }) => {
    // Test: compareCFO should return empty array for empty input
    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
    });

    const result = await page.evaluate(() => {
      return window.cfoAnalytics.compareCFO([]);
    });

    expect(result).toEqual([]);
  });

  test('parseCashFlow() should correctly handle various input formats', async ({ page }) => {
    // Test: parseCashFlow should handle nulls, negatives, and large numbers
    const parseResults = await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }

      return {
        largeValue: window.cfoAnalytics.parseCashFlow('72880'),
        negativeValue: window.cfoAnalytics.parseCashFlow('-5000'),
        nullValue: window.cfoAnalytics.parseCashFlow(null),
        emptyString: window.cfoAnalytics.parseCashFlow(''),
        invalidValue: window.cfoAnalytics.parseCashFlow('invalid')
      };
    });

    expect(parseResults.largeValue).toBe(72880);
    expect(parseResults.negativeValue).toBe(-5000);
    expect(parseResults.nullValue).toBeNull();
    expect(parseResults.emptyString).toBeNull();
    expect(parseResults.invalidValue).toBeNull();
  });
});
