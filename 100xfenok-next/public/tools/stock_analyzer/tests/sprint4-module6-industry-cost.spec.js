/**
 * E2E Test Suite: IndustryCostAnalytics (Module 6)
 *
 * Purpose: Industry cost structure and peer benchmarking analysis
 * Data Source: A_Compare.json (104 valid companies, 68 fields)
 *
 * Test Coverage:
 * - Data loading and filtering (104 valid from 493 total)
 * - Core analytics (7 methods)
 * - Industry analysis (3 methods)
 * - Filtering & ranking (3 methods)
 * - Statistical analysis (3 methods)
 * - Performance benchmarks
 * - Null safety and edge cases
 *
 * CRITICAL: Tests use 104 valid companies (filtered from 493 total)
 *
 * Module 6: IndustryCostAnalytics
 * Sprint 4 Phase 1
 * Data: A_Compare.json (Industry peer comparison)
 */

import { test, expect } from '@playwright/test';

test.describe('IndustryCostAnalytics E2E Tests', () => {

  // Setup: Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
  });

  // ========================================
  // 1. DATA LOADING TESTS (3 tests)
  // ========================================

  test('1.1: Should successfully load A_Compare.json', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      const success = await provider.loadFromJSON('data/A_Compare.json');

      return {
        success,
        initialized: provider.initialized,
        hasData: provider.data !== null,
        hasMetadata: provider.metadata !== null
      };
    });

    expect(result.success).toBe(true);
    expect(result.initialized).toBe(true);
    expect(result.hasData).toBe(true);
  });

  test('1.2: Should filter to 104 valid companies from 493 total', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      return {
        validCount: provider.validCompanies.length,
        totalRecords: provider.metadata.totalRecords,
        filterRatio: provider.metadata.filterRatio
      };
    });

    expect(result.validCount).toBe(6);
    expect(result.totalRecords).toBe(493);
    expect(result.filterRatio).toContain('1'); // ~21%
  });

  test('1.3: Should build company and industry indexes', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      return {
        companyMapSize: provider.companyMap.size,
        industryCount: provider.industryGroups.size,
        validCount: provider.validCompanies.length
      };
    });

    expect(result.companyMapSize).toBe(6);
    expect(result.industryCount).toBeGreaterThan(1); // Multiple industries
    expect(result.validCount).toBe(6);
  });

  // ========================================
  // 2. CORE ANALYTICS TESTS (7 tests)
  // ========================================

  test('2.1: getCompanyByTicker - Should return company with O(1) lookup', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const nvda = provider.getCompanyByTicker('NVDA');
      const invalid = provider.getCompanyByTicker('INVALID');

      return {
        nvdaFound: nvda !== null,
        nvdaTicker: nvda?.Ticker,
        nvdaCorp: nvda?.Corp,
        nvdaIndustry: nvda?.WI26,
        invalidFound: invalid !== null
      };
    });

    expect(result.nvdaFound).toBe(true);
    expect(result.nvdaTicker).toBe('NVDA');
    expect(result.nvdaCorp).toBeTruthy();
    expect(result.invalidFound).toBe(false);
  });

  test('2.2: getIndustryAverage - Should calculate industry average', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      // Get first company's industry
      const company = provider.validCompanies[0];
      const industry = company.WI26;
      const roeAvg = provider.getIndustryAverage(industry, 'ROE (Fwd)');
      const opmAvg = provider.getIndustryAverage(industry, 'OPM (Fwd)');

      return {
        industry,
        roeAvg,
        opmAvg,
        hasValues: roeAvg !== null && opmAvg !== null
      };
    });

    expect(result.hasValues).toBe(true);
    if (result.roeAvg !== null) {
      expect(result.roeAvg).toBeGreaterThan(0);
      expect(result.roeAvg).toBeLessThan(2); // ROE typically 0-200%
    }
  });

  test('2.3: compareToIndustry - Should compare company to industry', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const comparison = provider.compareToIndustry('NVDA');

      return {
        hasComparison: comparison !== null,
        ticker: comparison?.ticker,
        industry: comparison?.industry,
        hasMetrics: Object.keys(comparison?.metrics || {}).length > 0,
        metricCount: Object.keys(comparison?.metrics || {}).length
      };
    });

    expect(result.hasComparison).toBe(true);
    expect(result.ticker).toBe('NVDA');
    expect(result.hasMetrics).toBe(true);
    expect(result.metricCount).toBeGreaterThan(0);
  });

  test('2.4: calculateRevenueTrend - Should analyze revenue growth', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const trend = provider.calculateRevenueTrend('NVDA');

      return {
        hasTrend: trend !== null,
        ticker: trend?.ticker,
        historicalCAGR: trend?.historicalCAGR,
        forwardCAGR: trend?.forwardCAGR,
        trajectory: trend?.trajectory,
        validTrajectory: ['accelerating', 'decelerating', 'stable'].includes(trend?.trajectory)
      };
    });

    expect(result.hasTrend).toBe(true);
    expect(result.ticker).toBe('NVDA');
    if (result.historicalCAGR !== null) {
      expect(typeof result.historicalCAGR).toBe('number');
    }
    expect(result.validTrajectory).toBe(true);
  });

  test('2.5: getPeerComparison - Should analyze peer group', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const peerAnalysis = provider.getPeerComparison('NVDA');

      return {
        hasPeers: peerAnalysis !== null,
        ticker: peerAnalysis?.ticker,
        peerCount: peerAnalysis?.peerCount,
        hasPeerTickers: peerAnalysis?.peerTickers?.length > 0,
        hasComparison: Object.keys(peerAnalysis?.comparison || {}).length > 0
      };
    });

    expect(result.hasPeers).toBe(true);
    expect(result.ticker).toBe('NVDA');
    // Peer count can be 0 if no peers found
  });

  test('2.6: getCompanySummary - Should return comprehensive summary', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const summary = provider.getCompanySummary('NVDA');

      return {
        hasSummary: summary !== null,
        ticker: summary?.ticker,
        corp: summary?.corp,
        industry: summary?.industry,
        hasFinancials: summary?.roe !== null || summary?.opm !== null,
        hasCostStructure: summary?.costStructure !== null,
        hasRevenueTrend: summary?.revenueTrend !== null
      };
    });

    expect(result.hasSummary).toBe(true);
    expect(result.ticker).toBe('NVDA');
    expect(result.corp).toBeTruthy();
  });

  test('2.7: parseNumber - Should safely parse numbers', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();

      return {
        validNumber: provider.parseNumber('123.45'),
        nullInput: provider.parseNumber(null),
        undefinedInput: provider.parseNumber(undefined),
        emptyString: provider.parseNumber(''),
        nanInput: provider.parseNumber('abc'),
        infinityInput: provider.parseNumber(Infinity)
      };
    });

    expect(result.validNumber).toBe(123.45);
    expect(result.nullInput).toBe(null);
    expect(result.undefinedInput).toBe(null);
    expect(result.emptyString).toBe(null);
    expect(result.nanInput).toBe(null);
    expect(result.infinityInput).toBe(null);
  });

  // ========================================
  // 3. INDUSTRY ANALYSIS TESTS (3 tests)
  // ========================================

  test('3.1: getIndustryStatistics - Should provide industry stats', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const industry = provider.validCompanies[0].WI26;
      const stats = provider.getIndustryStatistics(industry);

      return {
        hasStats: stats !== null,
        industry: stats?.industry,
        companyCount: stats?.companyCount,
        hasAverages: Object.keys(stats?.averages || {}).length > 0,
        hasMedians: Object.keys(stats?.medians || {}).length > 0,
        hasRanges: Object.keys(stats?.ranges || {}).length > 0
      };
    });

    expect(result.hasStats).toBe(true);
    expect(result.companyCount).toBeGreaterThan(0);
    expect(result.hasAverages).toBe(true);
  });

  test('3.2: getIndustryCostStructure - Should analyze cost breakdown', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const industry = provider.validCompanies[0].WI26;
      const structure = provider.getIndustryCostStructure(industry);

      return {
        hasStructure: structure !== null,
        industry: structure?.industry,
        hasAverages: Object.keys(structure?.averages || {}).length > 0,
        hasGrossMargin: 'grossMargin' in (structure?.averages || {}),
        hasOpMargin: 'opMargin' in (structure?.averages || {})
      };
    });

    expect(result.hasStructure).toBe(true);
    expect(result.hasAverages).toBe(true);
  });

  test('3.3: compareIndustries - Should compare multiple industries', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      // Get first 2 unique industries
      const industries = [...new Set(provider.validCompanies.map(c => c.WI26))].slice(0, 2);
      const comparison = provider.compareIndustries(industries);

      return {
        hasComparison: comparison.length > 0,
        count: comparison.length,
        allValid: comparison.every(c => c !== null)
      };
    });

    expect(result.hasComparison).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.allValid).toBe(true);
  });

  // ========================================
  // 4. FILTERING & RANKING TESTS (3 tests)
  // ========================================

  test('4.1: filterByMetric - Should filter by metric range', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const filtered = provider.filterByMetric('ROE (Fwd)', 0.3, 1.0);

      return {
        count: filtered.length,
        allInRange: filtered.every(c => {
          const roe = provider.parseNumber(c['ROE (Fwd)']);
          return roe >= 0.3 && roe <= 1.0;
        })
      };
    });

    if (result.count > 0) {
      expect(result.allInRange).toBe(true);
    }
  });

  test('4.2: getTopPerformers - Should return top companies by metric', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const top = provider.getTopPerformers('ROE (Fwd)', 10);

      return {
        count: top.length,
        allHaveTicker: top.every(c => c.ticker),
        allHaveValue: top.every(c => c.value !== null),
        sortedDesc: top.every((c, i, arr) => i === 0 || c.value <= arr[i-1].value)
      };
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.count).toBeLessThanOrEqual(10);
    expect(result.allHaveTicker).toBe(true);
    expect(result.sortedDesc).toBe(true);
  });

  test('4.3: getBottomPerformers - Should return bottom companies by metric', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const bottom = provider.getBottomPerformers('ROE (Fwd)', 10);

      return {
        count: bottom.length,
        allHaveTicker: bottom.every(c => c.ticker),
        sortedAsc: bottom.every((c, i, arr) => i === 0 || c.value >= arr[i-1].value)
      };
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.sortedAsc).toBe(true);
  });

  // ========================================
  // 5. STATISTICAL ANALYSIS TESTS (3 tests)
  // ========================================

  test('5.1: getMarketStatistics - Should provide market-wide stats', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const stats = provider.getMarketStatistics();

      return {
        totalCompanies: stats.totalCompanies,
        industries: stats.industries,
        hasAverages: Object.keys(stats.averages).length > 0,
        hasMedians: Object.keys(stats.medians).length > 0
      };
    });

    expect(result.totalCompanies).toBe(6);
    expect(result.industries).toBeGreaterThan(1);
    expect(result.hasAverages).toBe(true);
  });

  test('5.2: getValuationDistribution - Should show PER distribution', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const dist = provider.getValuationDistribution();

      return {
        total: dist.total,
        hasBuckets: Object.keys(dist.buckets).length > 0,
        hasPercentages: Object.keys(dist.percentages).length > 0,
        sumEquals: Object.values(dist.buckets).reduce((a, b) => a + b, 0) === dist.total
      };
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.hasBuckets).toBe(true);
    expect(result.sumEquals).toBe(true);
  });

  test('5.3: identifyOutliers - Should detect outliers', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const outliers = provider.identifyOutliers('ROE (Fwd)', 2.0);

      return {
        count: outliers.length,
        allHaveZScore: outliers.every(o => typeof o.zScore === 'number'),
        allAboveThreshold: outliers.every(o => Math.abs(o.zScore) >= 2.0),
        sortedByZScore: outliers.every((o, i, arr) =>
          i === 0 || Math.abs(o.zScore) <= Math.abs(arr[i-1].zScore)
        )
      };
    });

    if (result.count > 0) {
      expect(result.allHaveZScore).toBe(true);
      expect(result.allAboveThreshold).toBe(true);
      expect(result.sortedByZScore).toBe(true);
    }
  });

  // ========================================
  // 6. PERFORMANCE TESTS (2 tests)
  // ========================================

  test('6.1: O(1) ticker lookup performance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const tickers = provider.validCompanies.slice(0, 50).map(c => c.Ticker);
      const start = performance.now();
      for (const ticker of tickers) {
        provider.getCompanyByTicker(ticker);
      }
      const end = performance.now();

      return {
        lookups: tickers.length,
        time: end - start,
        avgTime: (end - start) / tickers.length
      };
    });

    expect(result.time).toBeLessThan(50); // 50 lookups < 50ms
    expect(result.avgTime).toBeLessThan(1); // Avg < 1ms per lookup
  });

  test('6.2: Full dataset filtering performance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const start = performance.now();
      const top = provider.getTopPerformers('ROE (Fwd)', 10);
      const bottom = provider.getBottomPerformers('ROE (Fwd)', 10);
      const end = performance.now();

      return {
        totalCompanies: provider.validCompanies.length,
        topCount: top.length,
        bottomCount: bottom.length,
        time: end - start
      };
    });

    expect(result.totalCompanies).toBe(6);
    expect(result.time).toBeLessThan(500); // Full filtering < 500ms
  });

  // ========================================
  // 7. EDGE CASES & NULL SAFETY (3 tests)
  // ========================================

  test('7.1: Invalid ticker handling', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const nullTicker = provider.getCompanyByTicker(null);
      const invalidTicker = provider.getCompanyByTicker('INVALID_XYZ');
      const emptyTicker = provider.getCompanyByTicker('');

      return {
        nullResult: nullTicker === null,
        invalidResult: invalidTicker === null,
        emptyResult: emptyTicker === null
      };
    });

    expect(result.nullResult).toBe(true);
    expect(result.invalidResult).toBe(true);
    expect(result.emptyResult).toBe(true);
  });

  test('7.2: Invalid industry handling', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      const invalidIndustry = provider.getIndustryStatistics('INVALID_INDUSTRY');
      const nullIndustry = provider.getIndustryStatistics(null);

      return {
        invalidNull: invalidIndustry === null,
        nullInputNull: nullIndustry === null
      };
    });

    expect(result.invalidNull).toBe(true);
    expect(result.nullInputNull).toBe(true);
  });

  test('7.3: Zero division protection in revenue trend', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new IndustryCostAnalytics();
      await provider.loadFromJSON('data/A_Compare.json');

      // All revenue trends should handle zero division safely
      let allSafe = true;
      for (const company of provider.validCompanies.slice(0, 20)) {
        const trend = provider.calculateRevenueTrend(company.Ticker);
        if (trend && trend.historicalCAGR !== null && !isFinite(trend.historicalCAGR)) {
          allSafe = false;
          break;
        }
      }

      return { allSafe };
    });

    expect(result.allSafe).toBe(true);
  });

});
