/**
 * E2E Test Suite: CompanyAnalyticsProvider
 *
 * Purpose: Comprehensive testing of CompanyAnalyticsProvider functionality
 * Data Source: A_Company.json (1,250 companies, 50 fields)
 *
 * Test Coverage:
 * - Data loading and validation (1,250 companies)
 * - Index structure verification (PEG, Return, Growth buckets)
 * - Core analytics methods (5)
 * - Filtering and search operations (5)
 * - Statistical analysis methods (5)
 * - Performance benchmarks (O(n) optimization)
 * - Null safety and edge cases
 *
 * CRITICAL: Tests use FULL dataset (1,250 companies) - NO slicing!
 *
 * Module 4: CompanyAnalyticsProvider
 * Sprint 4 Phase 1
 */

import { test, expect } from '@playwright/test';

test.describe('CompanyAnalyticsProvider E2E Tests', () => {

  // Setup: Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
  });

  // ========================================
  // 1. DATA LOADING TESTS
  // ========================================

  test('1.1: Should successfully load A_Company.json', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      const success = await provider.loadFromJSON('data/A_Company.json');

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
    expect(result.hasMetadata).toBe(true);
  });

  test('1.2: Should load all 1,250 companies (FULL dataset)', async ({ page }) => {
    const companyCount = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.data.length;
    });

    expect(companyCount).toBe(1250);
  });

  test('1.3: Should validate metadata structure', async ({ page }) => {
    const metadata = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return {
        hasMetadata: provider.metadata !== null,
        hasRecordCount: 'recordCount' in provider.metadata,
        recordCount: provider.metadata.recordCount
      };
    });

    expect(metadata.hasMetadata).toBe(true);
    expect(metadata.hasRecordCount).toBe(true);
    expect(metadata.recordCount).toBe(1250);
  });

  test('1.4: Should build all required indexes', async ({ page }) => {
    const indexes = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return {
        hasCompanyMap: provider.companyMap.size > 0,
        hasPegIndex: provider.pegIndex.size > 0,
        hasReturnIndex: provider.returnIndex.size > 0,
        hasGrowthIndex: provider.growthIndex.size > 0,
        companyMapSize: provider.companyMap.size,
        pegBuckets: Array.from(provider.pegIndex.keys()),
        returnBuckets: Array.from(provider.returnIndex.keys()),
        growthBuckets: Array.from(provider.growthIndex.keys())
      };
    });

    expect(indexes.hasCompanyMap).toBe(true);
    expect(indexes.hasPegIndex).toBe(true);
    expect(indexes.hasReturnIndex).toBe(true);
    expect(indexes.hasGrowthIndex).toBe(true);
    expect(indexes.companyMapSize).toBe(1250);

    // Verify bucket structure
    expect(indexes.pegBuckets).toContain('undervalued');
    expect(indexes.pegBuckets).toContain('fair');
    expect(indexes.pegBuckets).toContain('overvalued');
    expect(indexes.pegBuckets).toContain('invalid');

    expect(indexes.returnBuckets).toContain('excellent');
    expect(indexes.returnBuckets).toContain('good');
    expect(indexes.returnBuckets).toContain('average');

    expect(indexes.growthBuckets).toContain('hypergrowth');
    expect(indexes.growthBuckets).toContain('high');
    expect(indexes.growthBuckets).toContain('moderate');
  });

  // ========================================
  // 2. CORE ANALYTICS TESTS (5 methods)
  // ========================================

  test('2.1: getCompanyByTicker - valid ticker (NVDA)', async ({ page }) => {
    const company = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getCompanyByTicker('NVDA');
    });

    expect(company).not.toBeNull();
    expect(company.ticker).toBe('NVDA');
    expect(company.corp).toContain('NVIDIA');
    expect(company.peg).toBeGreaterThan(0);
  });

  test('2.2: getCompanyByTicker - invalid ticker returns null', async ({ page }) => {
    const company = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getCompanyByTicker('INVALID_TICKER');
    });

    expect(company).toBeNull();
  });

  test('2.3: getCompanyByTicker - null/undefined returns null', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return {
        nullResult: provider.getCompanyByTicker(null),
        undefinedResult: provider.getCompanyByTicker(undefined)
      };
    });

    expect(result.nullResult).toBeNull();
    expect(result.undefinedResult).toBeNull();
  });

  test('2.4: getTopByReturn - returns top 10 by expected return', async ({ page }) => {
    const top = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getTopByReturn(10);
    });

    expect(top.length).toBeLessThanOrEqual(10);
    expect(top.length).toBeGreaterThan(0);

    // Verify sorted descending
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i].returnY).toBeGreaterThanOrEqual(top[i + 1].returnY);
    }
  });

  test('2.5: getTopByPEG - returns top 10 undervalued (ascending)', async ({ page }) => {
    const top = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getTopByPEG(10, true);
    });

    expect(top.length).toBeLessThanOrEqual(10);
    expect(top.length).toBeGreaterThan(0);

    // Verify sorted ascending and positive PEG
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i].peg).toBeLessThanOrEqual(top[i + 1].peg);
      expect(top[i].peg).toBeGreaterThan(0);
    }
  });

  test('2.6: getTopByPEG - descending sort', async ({ page }) => {
    const top = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getTopByPEG(10, false);
    });

    expect(top.length).toBeGreaterThan(0);

    // Verify sorted descending
    for (let i = 0; i < top.length - 1; i++) {
      expect(top[i].peg).toBeGreaterThanOrEqual(top[i + 1].peg);
    }
  });

  test('2.7: getHighGrowthCompanies - default min 20% CAGR', async ({ page }) => {
    const highGrowth = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getHighGrowthCompanies(0.20);
    });

    expect(highGrowth.length).toBeGreaterThan(0);

    // All companies should have Sales (3) >= 0.20
    for (const company of highGrowth) {
      expect(company.salesCAGR3).toBeGreaterThanOrEqual(0.20);
    }
  });

  test('2.8: getHighGrowthCompanies - custom threshold 30%', async ({ page }) => {
    const hyperGrowth = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getHighGrowthCompanies(0.30);
    });

    expect(hyperGrowth.length).toBeGreaterThan(0);

    // All companies should have Sales (3) >= 0.30
    for (const company of hyperGrowth) {
      expect(company.salesCAGR3).toBeGreaterThanOrEqual(0.30);
    }
  });

  test('2.9: getValueOpportunities - PEG <1.5 AND Return >15%', async ({ page }) => {
    const opportunities = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getValueOpportunities();
    });

    expect(opportunities.length).toBeGreaterThan(0);

    // Verify filter criteria
    for (const company of opportunities) {
      expect(company.peg).toBeLessThan(1.5);
      expect(company.returnY).toBeGreaterThan(0.15);  // 15% = 0.15
    }
  });

  // ========================================
  // 3. FILTERING & SEARCH TESTS (5 methods)
  // ========================================

  test('3.1: filterByReturn - range 10% to 20%', async ({ page }) => {
    const filtered = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.filterByReturn(0.10, 0.20);  // 10%-20% in ratio form
    });

    expect(filtered.length).toBeGreaterThan(0);

    for (const company of filtered) {
      expect(company.returnY).toBeGreaterThanOrEqual(0.10);  // 10% = 0.10
      expect(company.returnY).toBeLessThanOrEqual(0.20);     // 20% = 0.20
    }
  });

  test('3.2: filterByReturn - min only', async ({ page }) => {
    const filtered = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.filterByReturn(0.15, Infinity);  // 15%+ in ratio form
    });

    expect(filtered.length).toBeGreaterThan(0);

    for (const company of filtered) {
      expect(company.returnY).toBeGreaterThanOrEqual(0.15);  // 15% = 0.15
    }
  });

  test('3.3: filterByPEG - undervalued range 0 to 1.5', async ({ page }) => {
    const filtered = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.filterByPEG(0, 1.5);
    });

    expect(filtered.length).toBeGreaterThan(0);

    for (const company of filtered) {
      expect(company.peg).toBeGreaterThanOrEqual(0);
      expect(company.peg).toBeLessThanOrEqual(1.5);
    }
  });

  test('3.4: filterByPEG - fair range 1.0 to 2.0', async ({ page }) => {
    const filtered = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.filterByPEG(1.0, 2.0);
    });

    expect(filtered.length).toBeGreaterThan(0);

    for (const company of filtered) {
      expect(company.peg).toBeGreaterThanOrEqual(1.0);
      expect(company.peg).toBeLessThanOrEqual(2.0);
    }
  });

  test('3.5: filterByGrowth - hypergrowth 30%+', async ({ page }) => {
    const filtered = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.filterByGrowth(0.30, Infinity);
    });

    expect(filtered.length).toBeGreaterThan(0);

    for (const company of filtered) {
      expect(company.salesCAGR3).toBeGreaterThanOrEqual(0.30);
    }
  });

  test('3.6: filterByGrowth - moderate range 10% to 20%', async ({ page }) => {
    const filtered = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.filterByGrowth(0.10, 0.20);
    });

    expect(filtered.length).toBeGreaterThan(0);

    for (const company of filtered) {
      expect(company.salesCAGR3).toBeGreaterThanOrEqual(0.10);
      expect(company.salesCAGR3).toBeLessThanOrEqual(0.20);
    }
  });

  test('3.7: searchByName - partial match "NVIDIA"', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.searchByName('NVIDIA');
    });

    expect(results.length).toBeGreaterThan(0);

    for (const company of results) {
      expect(company.corp.toLowerCase()).toContain('nvidia');
    }
  });

  test('3.8: searchByName - case insensitive', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.searchByName('apple');
    });

    expect(results.length).toBeGreaterThan(0);

    for (const company of results) {
      expect(company.corp.toLowerCase()).toContain('apple');
    }
  });

  test('3.9: searchByName - empty/short query returns empty', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return {
        empty: provider.searchByName(''),
        oneChar: provider.searchByName('A')
      };
    });

    expect(results.empty.length).toBe(0);
    expect(results.oneChar.length).toBe(0);
  });

  test('3.10: getCompanySummary - structured output (NVDA)', async ({ page }) => {
    const summary = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getCompanySummary('NVDA');
    });

    expect(summary).not.toBeNull();
    expect(summary.ticker).toBe('NVDA');
    expect(summary.corp).toContain('NVIDIA');

    // Valuation object
    expect(summary.valuation).toBeDefined();
    expect(summary.valuation.per).toBeDefined();
    expect(summary.valuation.pbr).toBeDefined();
    expect(summary.valuation.peg).toBeDefined();

    // Growth object
    expect(summary.growth).toBeDefined();
    expect(summary.growth.salesCAGR3).toBeDefined();

    // Return object
    expect(summary.return).toBeDefined();
    expect(summary.return.returnY).toBeDefined();

    // Dividend object
    expect(summary.dividend).toBeDefined();
  });

  test('3.11: getCompanySummary - invalid ticker returns null', async ({ page }) => {
    const summary = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getCompanySummary('INVALID');
    });

    expect(summary).toBeNull();
  });

  // ========================================
  // 4. STATISTICAL ANALYSIS TESTS (5 methods)
  // ========================================

  test('4.1: getMarketStatistics - aggregates calculated correctly', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getMarketStatistics();
    });

    expect(stats).toBeDefined();
    expect(stats.avgPEG).toBeGreaterThan(0);
    expect(stats.medianReturn).toBeDefined();
    expect(stats.avgGrowth).toBeDefined();

    // Counts
    expect(stats.totalCompanies).toBe(1250);
    expect(stats.validPEGCount).toBeGreaterThan(0);
    expect(stats.validReturnCount).toBeGreaterThan(0);
    expect(stats.validGrowthCount).toBeGreaterThan(0);
  });

  test('4.2: getValuationDistribution - bucket counts sum to total', async ({ page }) => {
    const dist = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.getValuationDistribution();
    });

    expect(dist).toBeDefined();
    expect(dist.pegBuckets).toBeDefined();
    expect(dist.returnBuckets).toBeDefined();
    expect(dist.growthBuckets).toBeDefined();

    // PEG buckets sum to 1250
    const pegTotal = dist.pegBuckets.undervalued + dist.pegBuckets.fair +
                     dist.pegBuckets.overvalued + dist.pegBuckets.invalid;
    expect(pegTotal).toBe(1250);

    // All bucket counts should be non-negative
    expect(dist.pegBuckets.undervalued).toBeGreaterThanOrEqual(0);
    expect(dist.pegBuckets.fair).toBeGreaterThanOrEqual(0);
    expect(dist.pegBuckets.overvalued).toBeGreaterThanOrEqual(0);

    expect(dist.returnBuckets.excellent).toBeGreaterThanOrEqual(0);
    expect(dist.returnBuckets.good).toBeGreaterThanOrEqual(0);
    expect(dist.returnBuckets.average).toBeGreaterThanOrEqual(0);

    expect(dist.growthBuckets.hypergrowth).toBeGreaterThanOrEqual(0);
    expect(dist.growthBuckets.high).toBeGreaterThanOrEqual(0);
    expect(dist.growthBuckets.moderate).toBeGreaterThanOrEqual(0);
  });

  test('4.3: identifyOutliers - extreme PEG and Return values', async ({ page }) => {
    const outliers = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.identifyOutliers();
    });

    expect(outliers).toBeDefined();
    expect(outliers.pegOutliers).toBeDefined();
    expect(outliers.returnOutliers).toBeDefined();

    // Verify outlier criteria
    for (const company of outliers.pegOutliers) {
      const peg = company.peg;
      expect(peg > 100 || peg < -10).toBe(true);
    }

    for (const company of outliers.returnOutliers) {
      const ret = company.returnY;
      expect(ret > 1.0 || ret < -0.5).toBe(true);
    }
  });

  test('4.4: compareCompanies - NVDA vs AAPL', async ({ page }) => {
    const comparison = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return provider.compareCompanies('NVDA', 'AAPL');
    });

    expect(comparison).not.toBeNull();

    // Company 1
    expect(comparison.company1).toBeDefined();
    expect(comparison.company1.ticker).toBe('NVDA');
    expect(comparison.company1.corp).toContain('NVIDIA');

    // Company 2
    expect(comparison.company2).toBeDefined();
    expect(comparison.company2.ticker).toBe('AAPL');
    expect(comparison.company2.corp).toContain('Apple');

    // Comparison (differences)
    expect(comparison.comparison).toBeDefined();
    expect(comparison.comparison.pegDiff).toBeDefined();
    expect(comparison.comparison.returnDiff).toBeDefined();
    expect(comparison.comparison.growthDiff).toBeDefined();
  });

  test('4.5: compareCompanies - invalid ticker returns null', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return {
        invalid1: provider.compareCompanies('INVALID', 'AAPL'),
        invalid2: provider.compareCompanies('NVDA', 'INVALID'),
        bothInvalid: provider.compareCompanies('INVALID1', 'INVALID2')
      };
    });

    expect(results.invalid1).toBeNull();
    expect(results.invalid2).toBeNull();
    expect(results.bothInvalid).toBeNull();
  });

  // ========================================
  // 5. PERFORMANCE TESTS (O(n) optimization)
  // ========================================

  test('5.1: Filter operations complete in <100ms (O(n) optimization)', async ({ page }) => {
    const timings = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      const results = {};

      const start1 = performance.now();
      provider.filterByReturn(10, 20);
      results.filterReturn = performance.now() - start1;

      const start2 = performance.now();
      provider.filterByPEG(0, 1.5);
      results.filterPEG = performance.now() - start2;

      const start3 = performance.now();
      provider.filterByGrowth(0.20, Infinity);
      results.filterGrowth = performance.now() - start3;

      return results;
    });

    expect(timings.filterReturn).toBeLessThan(100);
    expect(timings.filterPEG).toBeLessThan(100);
    expect(timings.filterGrowth).toBeLessThan(100);
  });

  test('5.2: Ticker lookup is O(1) - completes in <1ms', async ({ page }) => {
    const timing = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      const start = performance.now();
      provider.getCompanyByTicker('NVDA');
      const end = performance.now();

      return end - start;
    });

    expect(timing).toBeLessThan(1);
  });

  test('5.3: Full data load completes in <2000ms', async ({ page }) => {
    const timing = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();

      const start = performance.now();
      await provider.loadFromJSON('data/A_Company.json');
      const end = performance.now();

      return end - start;
    });

    expect(timing).toBeLessThan(2000);
  });

  // ========================================
  // 6. NULL SAFETY & EDGE CASES
  // ========================================

  test('6.1: Methods handle null/undefined gracefully', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      return {
        nullTicker: provider.getCompanyByTicker(null),
        undefinedTicker: provider.getCompanyByTicker(undefined),
        emptySearch: provider.searchByName(''),
        shortSearch: provider.searchByName('A'),
        invalidCompare: provider.compareCompanies('NVDA', 'INVALID'),
        invalidSummary: provider.getCompanySummary('INVALID')
      };
    });

    expect(results.nullTicker).toBeNull();
    expect(results.undefinedTicker).toBeNull();
    expect(results.emptySearch.length).toBe(0);
    expect(results.shortSearch.length).toBe(0);
    expect(results.invalidCompare).toBeNull();
    expect(results.invalidSummary).toBeNull();
  });

  test('6.2: All 1,250 companies have required fields', async ({ page }) => {
    const validation = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      const requiredFields = ['ticker', 'corp', 'peg', 'returnY', 'salesCAGR3'];
      const issues = [];

      for (const company of provider.data) {
        for (const field of requiredFields) {
          if (!(field in company)) {
            issues.push(`${company.ticker || 'UNKNOWN'}: missing ${field}`);
          }
        }
      }

      return issues;
    });

    expect(validation.length).toBe(0);
  });

  test('6.3: Numeric fields handle null values correctly', async ({ page }) => {
    const validation = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      let nullPEG = 0;
      let nullReturn = 0;
      let nullGrowth = 0;

      for (const company of provider.data) {
        if (company.peg === null) nullPEG++;
        if (company.returnY === null) nullReturn++;
        if (company.salesCAGR3 === null) nullGrowth++;
      }

      return { nullPEG, nullReturn, nullGrowth };
    });

    // Some nulls are expected, verify they're handled
    expect(validation.nullPEG).toBeGreaterThanOrEqual(0);
    expect(validation.nullReturn).toBeGreaterThanOrEqual(0);
    expect(validation.nullGrowth).toBeGreaterThanOrEqual(0);

    // But not all should be null
    expect(validation.nullPEG).toBeLessThan(1250);
    expect(validation.nullReturn).toBeLessThan(1250);
    expect(validation.nullGrowth).toBeLessThan(1250);
  });

  // ========================================
  // 7. INTEGRATION TESTS
  // ========================================

  test('7.1: Value opportunities are both undervalued and high return', async ({ page }) => {
    const validation = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      const opportunities = provider.getValueOpportunities();

      let allValid = true;
      for (const company of opportunities) {
        if (company.peg >= 1.5 || company.returnY <= 0.15) {  // 15% = 0.15
          allValid = false;
          break;
        }
      }

      return { count: opportunities.length, allValid };
    });

    expect(validation.count).toBeGreaterThan(0);
    expect(validation.allValid).toBe(true);
  });

  test('7.2: High growth filter results match bucket index', async ({ page }) => {
    const validation = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      const hyperGrowth = provider.getHighGrowthCompanies(0.30);
      const hyperBucket = provider.growthIndex.get('hypergrowth') || [];

      // All hypergrowth companies should have >= 30% growth
      let allHyperValid = true;
      for (const company of hyperBucket) {
        if (company.salesCAGR3 < 0.30) {
          allHyperValid = false;
          break;
        }
      }

      return { hyperGrowthCount: hyperGrowth.length, allHyperValid };
    });

    expect(validation.hyperGrowthCount).toBeGreaterThan(0);
    expect(validation.allHyperValid).toBe(true);
  });

  test('7.3: Top 10 PEG (ascending) are actually the lowest', async ({ page }) => {
    const validation = await page.evaluate(async () => {
      const provider = new CompanyAnalyticsProvider();
      await provider.loadFromJSON('data/A_Company.json');

      const top10 = provider.getTopByPEG(10, true);

      // Get the 11th lowest PEG manually
      const allValidPEG = provider.data
        .filter(c => c.peg !== null && c.peg > 0)
        .map(c => c.peg)
        .sort((a, b) => a - b);

      const maxInTop10 = top10[top10.length - 1].peg;
      const eleventhLowest = allValidPEG[10]; // 0-indexed, so 10 is 11th

      return {
        top10Count: top10.length,
        maxInTop10,
        eleventhLowest,
        isCorrect: maxInTop10 <= eleventhLowest
      };
    });

    expect(validation.top10Count).toBe(10);
    expect(validation.isCorrect).toBe(true);
  });

});
