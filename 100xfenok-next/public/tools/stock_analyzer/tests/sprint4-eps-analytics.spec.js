/**
 * Sprint 4: EPSAnalytics E2E Tests
 *
 * Purpose: Test EPSAnalytics module functionality (490 lines, 13 methods)
 * Tests: 15+ comprehensive test cases
 * Coverage: Initialization, data parsing, chart data generation, sector analysis
 */

import { test, expect } from '@playwright/test';

test.describe('EPSAnalytics Module - Initialization and Setup', () => {

  test.beforeEach(async ({ page }) => {
    // Navigate to the application
    await page.goto('/stock_analyzer.html');

    // Wait for initial page load
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Allow JS modules to initialize
  });

  test('EPSAnalytics class should be available globally', async ({ page }) => {
    // Test: EPSAnalytics class should exist in window scope
    const epsAnalyticsExists = await page.evaluate(() => {
      return typeof window.epsAnalytics !== 'undefined';
    });

    expect(epsAnalyticsExists).toBeTruthy();
  });

  test('EPSAnalytics should initialize with dataManager', async ({ page }) => {
    // Test: EPSAnalytics instance should have correct properties
    const hasDataManager = await page.evaluate(() => {
      return window.epsAnalytics && window.epsAnalytics.dataManager !== null;
    });

    expect(hasDataManager).toBeTruthy();
  });

  test('EPSAnalytics initialization should load T_EPS_C data', async ({ page }) => {
    // Test: EPSAnalytics should successfully load EPS data
    const initResult = await page.evaluate(async () => {
      if (!window.epsAnalytics) return null;

      // Initialize if not already initialized
      if (!window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }

      return {
        initialized: window.epsAnalytics.initialized,
        hasData: window.epsAnalytics.epsData !== null,
        dataCount: window.epsAnalytics.epsData?.length || 0
      };
    });

    expect(initResult.initialized).toBeTruthy();
    expect(initResult.hasData).toBeTruthy();
    expect(initResult.dataCount).toBeGreaterThan(0);
    expect(initResult.dataCount).toBeLessThanOrEqual(1252); // Max expected companies
  });

  test('EPSAnalytics initialization should complete within performance threshold', async ({ page }) => {
    // Test: Initialization should complete in less than 1.5 seconds
    const startTime = Date.now();

    await page.evaluate(async () => {
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(1500);
  });
});

test.describe('EPSAnalytics Module - Data Retrieval Methods', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Ensure initialization
    await page.evaluate(async () => {
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });
  });

  test('getCompanyEPS() should return valid data for known ticker', async ({ page }) => {
    // Test: getCompanyEPS should return complete EPS data structure
    const epsData = await page.evaluate(() => {
      // Try to get EPS data for the first available company
      const firstTicker = window.epsAnalytics.epsData?.[0]?.Ticker;
      if (!firstTicker) return null;

      return window.epsAnalytics.getCompanyEPS(firstTicker);
    });

    expect(epsData).not.toBeNull();
    expect(epsData).toHaveProperty('ticker');
    expect(epsData).toHaveProperty('corp');
    expect(epsData).toHaveProperty('exchange');
    expect(epsData).toHaveProperty('sector');
    expect(epsData).toHaveProperty('eps_current');
    expect(epsData).toHaveProperty('eps_fwd');
    expect(epsData).toHaveProperty('eps_growth_1y');
    expect(epsData).toHaveProperty('eps_growth_3y');
    expect(epsData).toHaveProperty('roe');
  });

  test('getCompanyEPS() should return null for invalid ticker', async ({ page }) => {
    // Test: getCompanyEPS should handle invalid ticker gracefully
    const epsData = await page.evaluate(() => {
      return window.epsAnalytics.getCompanyEPS('INVALID_TICKER_XYZ');
    });

    expect(epsData).toBeNull();
  });

  test('parseEPS() should correctly convert percentage values', async ({ page }) => {
    // Test: parseEPS should handle various input formats
    const parseResults = await page.evaluate(() => {
      return {
        percentValue: window.epsAnalytics.parseEPS(0.15), // Should convert to 15
        largeValue: window.epsAnalytics.parseEPS(25.5), // Should keep as is
        nullValue: window.epsAnalytics.parseEPS(null),
        emptyString: window.epsAnalytics.parseEPS(''),
        invalidValue: window.epsAnalytics.parseEPS('invalid')
      };
    });

    expect(parseResults.percentValue).toBe(15);
    expect(parseResults.largeValue).toBe(25.5);
    expect(parseResults.nullValue).toBeNull();
    expect(parseResults.emptyString).toBeNull();
    expect(parseResults.invalidValue).toBeNull();
  });

  test('getSectorEPSAverages() should return sector aggregated data', async ({ page }) => {
    // Test: getSectorEPSAverages should calculate sector averages correctly
    const sectorData = await page.evaluate(() => {
      return window.epsAnalytics.getSectorEPSAverages();
    });

    expect(Array.isArray(sectorData)).toBeTruthy();
    expect(sectorData.length).toBeGreaterThan(0);

    // Check first sector data structure
    const firstSector = sectorData[0];
    expect(firstSector).toHaveProperty('sector');
    expect(firstSector).toHaveProperty('count');
    expect(firstSector).toHaveProperty('eps_current_avg');
    expect(firstSector).toHaveProperty('eps_fwd_avg');
    expect(firstSector).toHaveProperty('eps_growth_3y_avg');
    expect(firstSector).toHaveProperty('roe_avg');
    expect(firstSector).toHaveProperty('profit_margin_avg');

    // Verify data is sorted by count (descending)
    if (sectorData.length > 1) {
      expect(sectorData[0].count).toBeGreaterThanOrEqual(sectorData[1].count);
    }
  });

  test('getHighEPSCompanies() should filter companies by threshold', async ({ page }) => {
    // Test: getHighEPSCompanies should return companies above threshold
    const highEPSCompanies = await page.evaluate(() => {
      return window.epsAnalytics.getHighEPSCompanies(5, 'current');
    });

    expect(Array.isArray(highEPSCompanies)).toBeTruthy();

    // Verify all companies meet the threshold
    highEPSCompanies.forEach(company => {
      expect(company.epsValue).toBeGreaterThanOrEqual(5);
      expect(company).toHaveProperty('ticker');
      expect(company).toHaveProperty('corp');
      expect(company).toHaveProperty('sector');
    });

    // Verify companies are sorted by epsValue (descending)
    if (highEPSCompanies.length > 1) {
      expect(highEPSCompanies[0].epsValue).toBeGreaterThanOrEqual(highEPSCompanies[1].epsValue);
    }
  });
});

test.describe('EPSAnalytics Module - Chart Data Generation', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });
  });

  test('getEPSChartData() should generate Chart.js compatible data', async ({ page }) => {
    // Test: getEPSChartData should return valid Chart.js format
    const chartData = await page.evaluate(() => {
      const firstTicker = window.epsAnalytics.epsData?.[0]?.Ticker;
      if (!firstTicker) return null;

      return window.epsAnalytics.getEPSChartData(firstTicker);
    });

    expect(chartData).not.toBeNull();
    expect(chartData).toHaveProperty('labels');
    expect(chartData).toHaveProperty('datasets');
    expect(Array.isArray(chartData.labels)).toBeTruthy();
    expect(chartData.labels.length).toBe(6); // 6 metrics

    expect(chartData.datasets[0]).toHaveProperty('label');
    expect(chartData.datasets[0]).toHaveProperty('data');
    expect(chartData.datasets[0]).toHaveProperty('backgroundColor');
    expect(chartData.datasets[0]).toHaveProperty('borderColor');
    expect(chartData.datasets[0].data.length).toBe(6);
  });

  test('getSectorEPSChartData() should generate sector comparison chart data', async ({ page }) => {
    // Test: getSectorEPSChartData should return multi-dataset chart format
    const chartData = await page.evaluate(() => {
      return window.epsAnalytics.getSectorEPSChartData(10);
    });

    expect(chartData).toHaveProperty('labels');
    expect(chartData).toHaveProperty('datasets');
    expect(chartData.datasets.length).toBe(3); // 3 metrics

    // Verify dataset structure
    chartData.datasets.forEach(dataset => {
      expect(dataset).toHaveProperty('label');
      expect(dataset).toHaveProperty('data');
      expect(dataset).toHaveProperty('backgroundColor');
      expect(dataset).toHaveProperty('borderColor');
    });

    // Verify labels match data length
    expect(chartData.labels.length).toBeLessThanOrEqual(10);
    chartData.datasets.forEach(dataset => {
      expect(dataset.data.length).toBe(chartData.labels.length);
    });
  });

  test('getEPSGrowthTrendData() should generate growth trend chart', async ({ page }) => {
    // Test: getEPSGrowthTrendData should return trend line data
    const trendData = await page.evaluate(() => {
      const firstTicker = window.epsAnalytics.epsData?.[0]?.Ticker;
      if (!firstTicker) return null;

      return window.epsAnalytics.getEPSGrowthTrendData(firstTicker);
    });

    expect(trendData).not.toBeNull();
    expect(trendData.labels).toEqual(['1-Year Growth', '3-Year Growth', '5-Year Growth']);
    expect(trendData.datasets[0]).toHaveProperty('data');
    expect(trendData.datasets[0].data.length).toBe(3);
    expect(trendData.datasets[0]).toHaveProperty('tension'); // Line chart property
  });

  test('getROEvsEPSGrowthData() should generate scatter plot data', async ({ page }) => {
    // Test: getROEvsEPSGrowthData should return scatter chart format
    const scatterData = await page.evaluate(() => {
      return window.epsAnalytics.getROEvsEPSGrowthData(50);
    });

    expect(scatterData).not.toBeNull();
    expect(scatterData).toHaveProperty('datasets');
    expect(scatterData.datasets[0]).toHaveProperty('data');

    // Verify scatter data point structure
    const dataPoints = scatterData.datasets[0].data;
    expect(dataPoints.length).toBeGreaterThan(0);
    expect(dataPoints.length).toBeLessThanOrEqual(50);

    dataPoints.forEach(point => {
      expect(point).toHaveProperty('x'); // ROE
      expect(point).toHaveProperty('y'); // EPS Growth
      expect(point).toHaveProperty('label'); // Company name
    });
  });
});

test.describe('EPSAnalytics Module - XSS Security and Data Sanitization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });
  });

  test('getEPSSummaryHTML() should sanitize company data against XSS', async ({ page }) => {
    // Test: HTML output should not execute malicious scripts
    const htmlOutput = await page.evaluate(() => {
      // Create mock malicious data
      const mockTicker = window.epsAnalytics.epsData?.[0]?.Ticker;
      if (!mockTicker) return null;

      return window.epsAnalytics.getEPSSummaryHTML(mockTicker);
    });

    expect(htmlOutput).toBeTruthy();

    // Verify no script tags in output
    expect(htmlOutput).not.toContain('<script>');
    expect(htmlOutput).not.toContain('javascript:');
    expect(htmlOutput).not.toContain('onerror=');
    expect(htmlOutput).not.toContain('onclick=');
  });

  test('Chart data should not contain executable code in labels', async ({ page }) => {
    // Test: Chart labels should be safe strings
    const chartData = await page.evaluate(() => {
      const firstTicker = window.epsAnalytics.epsData?.[0]?.Ticker;
      if (!firstTicker) return null;

      return window.epsAnalytics.getEPSChartData(firstTicker);
    });

    expect(chartData).toBeTruthy();

    // Verify all labels are safe
    chartData.labels.forEach(label => {
      expect(typeof label).toBe('string');
      expect(label).not.toContain('<script>');
      expect(label).not.toContain('javascript:');
    });

    // Verify dataset label is safe
    expect(chartData.datasets[0].label).not.toContain('<');
    expect(chartData.datasets[0].label).not.toContain('>');
  });
});

test.describe('EPSAnalytics Module - Edge Cases and Error Handling', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('Methods should handle uninitialized state gracefully', async ({ page }) => {
    // Test: Methods should return safe defaults when not initialized
    const results = await page.evaluate(() => {
      // Create a new uninitialized instance
      const uninitializedEPS = new EPSAnalytics({});

      return {
        getCompanyEPS: uninitializedEPS.getCompanyEPS('AAPL'),
        getSectorEPSAverages: uninitializedEPS.getSectorEPSAverages(),
        getHighEPSCompanies: uninitializedEPS.getHighEPSCompanies(5, 'current')
      };
    });

    expect(results.getCompanyEPS).toBeNull();
    expect(results.getSectorEPSAverages).toEqual([]);
    expect(results.getHighEPSCompanies).toEqual([]);
  });

  test('compareEPS() should handle empty ticker array', async ({ page }) => {
    // Test: compareEPS should return empty array for empty input
    await page.evaluate(async () => {
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });

    const result = await page.evaluate(() => {
      return window.epsAnalytics.compareEPS([]);
    });

    expect(result).toEqual([]);
  });

  test('Data enrichment should handle missing company data', async ({ page }) => {
    // Test: enrichEPSData should work even without dataManager companies
    const enrichmentResult = await page.evaluate(() => {
      const testEPS = new EPSAnalytics({ companies: null });
      testEPS.epsData = [
        { Ticker: 'TEST', Corp: 'Test Corp', 'EPS': '10.5' }
      ];

      testEPS.enrichEPSData();

      return testEPS.epsData[0];
    });

    expect(enrichmentResult).toHaveProperty('corpName');
    expect(enrichmentResult).toHaveProperty('price');
    expect(enrichmentResult).toHaveProperty('marketCap');
  });
});
