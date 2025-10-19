/**
 * E2E Test Suite: EPSMonitoringProvider (Module 5)
 *
 * Purpose: Comprehensive testing of EPS forecast monitoring and trend analysis
 * Data Source: T_Chk.json (1,250 companies, 77 fields, 54 time-series)
 *
 * Test Coverage:
 * - Data loading and validation (1,250 companies, 371 days)
 * - Index structures (companyMap, activeCompanies, dateFields)
 * - Core analytics (getCompanyByTicker, getEPSHistory, calculateChangeRate, detectTrend)
 * - Alert system (identifyRapidChanges, getUpgradedCompanies, getDowngradedCompanies)
 * - Statistical analysis (getMarketSentiment, getIndustrySentiment, getTopMovers)
 * - Performance benchmarks (O(1) ticker lookup, O(n) filtering)
 * - Null safety and edge cases (sparse data, insufficient history)
 *
 * CRITICAL: Tests use FULL dataset (1,250 companies) - NO slicing!
 *
 * Module 5: EPSMonitoringProvider
 * Sprint 4 Phase 1
 * Data: T_Chk.json (FY forecast tracking, 2024-09-27 ~ 2025-10-03)
 */

import { test, expect } from '@playwright/test';

test.describe('EPSMonitoringProvider E2E Tests', () => {

  // Setup: Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
  });

  // ========================================
  // 1. DATA LOADING TESTS (4 tests)
  // ========================================

  test('1.1: Should successfully load T_Chk.json', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      const success = await provider.loadFromJSON('data/T_Chk.json');

      return {
        success,
        initialized: provider.initialized,
        hasData: provider.data !== null,
        hasMetadata: provider.metadata !== null,
        loadTime: provider.loadStartTime !== null
      };
    });

    expect(result.success).toBe(true);
    expect(result.initialized).toBe(true);
    expect(result.hasData).toBe(true);
  });

  test('1.2: Should load all 1,250 companies (FULL dataset)', async ({ page }) => {
    const companyCount = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');
      return provider.data.length;
    });

    expect(companyCount).toBe(1250);
  });

  test('1.3: Should build all required indexes', async ({ page }) => {
    const indexes = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      return {
        companyMapSize: provider.companyMap.size,
        activeCompaniesCount: provider.activeCompanies.length,
        dateFieldsCount: provider.dateFields.length,
        firstDate: provider.dateFields[0],
        lastDate: provider.dateFields[provider.dateFields.length - 1]
      };
    });

    expect(indexes.companyMapSize).toBe(1250);
    expect(indexes.activeCompaniesCount).toBeGreaterThan(0);
    expect(indexes.activeCompaniesCount).toBeLessThanOrEqual(1250);
    expect(indexes.dateFieldsCount).toBe(54); // 54 time-series fields
    // Dates should be descending (latest first)
    expect(parseFloat(indexes.firstDate)).toBeGreaterThan(parseFloat(indexes.lastDate));
  });

  test('1.4: Should correctly filter active companies (≥50% recent data)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      // Check active company criteria
      const recentDates = provider.dateFields.slice(0, 10);
      const sample = provider.activeCompanies[0];
      const populatedCount = recentDates.filter(d =>
        sample[d] !== null && sample[d] !== undefined
      ).length;

      return {
        totalCompanies: provider.data.length,
        activeCompanies: provider.activeCompanies.length,
        samplePopulated: populatedCount,
        activeRatio: provider.activeCompanies.length / provider.data.length
      };
    });

    expect(result.activeCompanies).toBeGreaterThan(500); // Should have active companies
    expect(result.samplePopulated).toBeGreaterThanOrEqual(5); // ≥50% of 10
    expect(result.activeRatio).toBeGreaterThan(0.3); // At least 30% active
  });

  // ========================================
  // 2. CORE ANALYTICS TESTS (5 tests)
  // ========================================

  test('2.1: getCompanyByTicker - Should return company with O(1) lookup', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const nvda = provider.getCompanyByTicker('NVDA');
      const aapl = provider.getCompanyByTicker('AAPL');
      const invalid = provider.getCompanyByTicker('INVALID_TICKER');

      return {
        nvdaFound: nvda !== null,
        nvdaTicker: nvda?.ticker,
        nvdaCorp: nvda?.corp,
        nvdaFY0: nvda?.fy0,
        aaplFound: aapl !== null,
        invalidFound: invalid !== null
      };
    });

    expect(result.nvdaFound).toBe(true);
    expect(result.nvdaTicker).toBe('NVDA');
    expect(result.nvdaCorp).toBeTruthy();
    expect(result.nvdaFY0).toBeTruthy();
    expect(result.aaplFound).toBe(true);
    expect(result.invalidFound).toBe(false);
  });

  test('2.2: getEPSHistory - Should return time-series data', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const history = provider.getEPSHistory('NVDA', 20);

      return {
        hasResult: history !== null,
        ticker: history?.ticker,
        corp: history?.corp,
        currentFY: history?.currentFY,
        nextFY: history?.nextFY,
        historyLength: history?.history.length,
        firstEntry: history?.history[0],
        hasDate: history?.history[0]?.date !== undefined,
        hasEpsValue: history?.history[0]?.epsValue !== undefined
      };
    });

    expect(result.hasResult).toBe(true);
    expect(result.ticker).toBe('NVDA');
    expect(result.corp).toBeTruthy();
    expect(result.historyLength).toBeGreaterThan(0);
    expect(result.historyLength).toBeLessThanOrEqual(20);
    expect(result.hasDate).toBe(true);
    expect(result.hasEpsValue).toBe(true);
  });

  test('2.3: calculateChangeRate - Should calculate 1w, 1m, 3m changes', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const ticker = provider.activeCompanies[0].ticker;
      const change1w = provider.calculateChangeRate(ticker, '1w');
      const change1m = provider.calculateChangeRate(ticker, '1m');
      const change3m = provider.calculateChangeRate(ticker, '3m');

      return {
        ticker,
        change1w,
        change1m,
        change3m,
        has1w: change1w !== null,
        has1m: change1m !== null,
        has3m: change3m !== null,
        is1wNumber: typeof change1w === 'number',
        is1mNumber: typeof change1m === 'number'
      };
    });

    // At least some changes should exist
    expect(result.ticker).toBeTruthy();
    if (result.has1w) {
      expect(result.is1wNumber).toBe(true);
      expect(Math.abs(result.change1w)).toBeLessThan(1); // Reasonable change (<100%)
    }
    if (result.has1m) {
      expect(result.is1mNumber).toBe(true);
    }
  });

  test('2.4: detectTrend - Should perform linear regression analysis', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const ticker = provider.activeCompanies[0].ticker;
      const trend = provider.detectTrend(ticker, 4);

      return {
        ticker,
        hasTrend: trend !== null,
        trendType: trend?.trend,
        slope: trend?.slope,
        confidence: trend?.confidence,
        validTrend: ['uptrend', 'downtrend', 'stable', 'insufficient_data'].includes(trend?.trend)
      };
    });

    expect(result.hasTrend).toBe(true);
    expect(result.validTrend).toBe(true);
    if (result.trendType !== 'insufficient_data') {
      expect(typeof result.slope).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  test('2.5: excelSerialToDate - Should convert Excel serial numbers correctly', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      // Known Excel serial: 45933 = 2025-10-03
      const date45933 = provider.excelSerialToDate(45933);
      // 45562 = 2024-09-27
      const date45562 = provider.excelSerialToDate(45562);

      return {
        date45933,
        date45562,
        isValidFormat: /^\d{4}-\d{2}-\d{2}$/.test(date45933)
      };
    });

    expect(result.isValidFormat).toBe(true);
    expect(result.date45933).toMatch(/^2025-/); // Year 2025
    expect(result.date45562).toMatch(/^2024-/); // Year 2024
  });

  // ========================================
  // 3. ALERT SYSTEM TESTS (5 tests)
  // ========================================

  test('3.1: identifyRapidChanges - Should detect changes above threshold', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const rapidChanges = provider.identifyRapidChanges(0.05); // 5% threshold

      return {
        hasChanges: rapidChanges.length > 0,
        count: rapidChanges.length,
        firstChange: rapidChanges[0],
        allHaveTicker: rapidChanges.every(c => c.ticker),
        allHaveChangeRate: rapidChanges.every(c => typeof c.changeRate === 'number'),
        allHaveDirection: rapidChanges.every(c => ['upgrade', 'downgrade'].includes(c.direction)),
        allAboveThreshold: rapidChanges.every(c => Math.abs(c.changeRate) >= 0.05)
      };
    });

    if (result.hasChanges) {
      expect(result.count).toBeGreaterThan(0);
      expect(result.allHaveTicker).toBe(true);
      expect(result.allHaveChangeRate).toBe(true);
      expect(result.allHaveDirection).toBe(true);
      expect(result.allAboveThreshold).toBe(true);
    }
  });

  test('3.2: getUpgradedCompanies - Should return positive revisions', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const upgraded = provider.getUpgradedCompanies('1w', 0.02);

      return {
        count: upgraded.length,
        allPositive: upgraded.every(c => c.changeRate > 0),
        allAboveMin: upgraded.every(c => c.changeRate >= 0.02),
        sortedDesc: upgraded.every((c, i, arr) => i === 0 || c.changeRate <= arr[i-1].changeRate)
      };
    });

    if (result.count > 0) {
      expect(result.allPositive).toBe(true);
      expect(result.allAboveMin).toBe(true);
      expect(result.sortedDesc).toBe(true);
    }
  });

  test('3.3: getDowngradedCompanies - Should return negative revisions', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const downgraded = provider.getDowngradedCompanies('1w', 0.02);

      return {
        count: downgraded.length,
        allNegative: downgraded.every(c => c.changeRate < 0),
        allBelowMin: downgraded.every(c => c.changeRate <= -0.02),
        sortedAsc: downgraded.every((c, i, arr) => i === 0 || c.changeRate >= arr[i-1].changeRate)
      };
    });

    if (result.count > 0) {
      expect(result.allNegative).toBe(true);
      expect(result.allBelowMin).toBe(true);
      expect(result.sortedAsc).toBe(true);
    }
  });

  test('3.4: Alert severity classification', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const rapidChanges = provider.identifyRapidChanges(0.05);
      const high = rapidChanges.filter(c => c.severity === 'high');
      const medium = rapidChanges.filter(c => c.severity === 'medium');

      return {
        totalAlerts: rapidChanges.length,
        highCount: high.length,
        mediumCount: medium.length,
        highAbove10: high.every(c => Math.abs(c.changeRate) > 0.10),
        mediumBelow10: medium.every(c => Math.abs(c.changeRate) <= 0.10)
      };
    });

    if (result.totalAlerts > 0) {
      if (result.highCount > 0) {
        expect(result.highAbove10).toBe(true);
      }
      if (result.mediumCount > 0) {
        expect(result.mediumBelow10).toBe(true);
      }
    }
  });

  test('3.5: Threshold sensitivity test', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const threshold1 = provider.identifyRapidChanges(0.01); // 1%
      const threshold5 = provider.identifyRapidChanges(0.05); // 5%
      const threshold10 = provider.identifyRapidChanges(0.10); // 10%

      return {
        count1: threshold1.length,
        count5: threshold5.length,
        count10: threshold10.length,
        decreasing: threshold1.length >= threshold5.length && threshold5.length >= threshold10.length
      };
    });

    expect(result.decreasing).toBe(true); // Higher threshold = fewer alerts
  });

  // ========================================
  // 4. STATISTICAL ANALYSIS TESTS (6 tests)
  // ========================================

  test('4.1: getMarketSentiment - Should analyze overall market', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const sentiment = provider.getMarketSentiment();

      return {
        hasSentiment: sentiment !== null,
        total: sentiment.total,
        upgrades: sentiment.upgrades,
        downgrades: sentiment.downgrades,
        stable: sentiment.stable,
        upgradeRate: sentiment.upgradeRate,
        downgradeRate: sentiment.downgradeRate,
        sentimentType: sentiment.sentiment,
        sumMatches: sentiment.upgrades + sentiment.downgrades + sentiment.stable === sentiment.total
      };
    });

    expect(result.hasSentiment).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.sumMatches).toBe(true);
    expect(['positive', 'negative', 'neutral']).toContain(result.sentimentType);
    expect(result.upgradeRate).toBeGreaterThanOrEqual(0);
    expect(result.upgradeRate).toBeLessThanOrEqual(1);
    expect(result.downgradeRate).toBeGreaterThanOrEqual(0);
    expect(result.downgradeRate).toBeLessThanOrEqual(1);
  });

  test('4.2: getIndustrySentiment - Should analyze by industry', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      // Get first active company's industry
      const industry = provider.activeCompanies[0].industry;
      const sentiment = provider.getIndustrySentiment(industry);

      return {
        industry,
        hasSentiment: sentiment !== null,
        sentimentIndustry: sentiment?.industry,
        companies: sentiment?.companies,
        total: sentiment?.total,
        upgrades: sentiment?.upgrades,
        downgrades: sentiment?.downgrades,
        stable: sentiment?.stable,
        upgradeRate: sentiment?.upgradeRate,
        sentimentType: sentiment?.sentiment
      };
    });

    expect(result.hasSentiment).toBe(true);
    expect(result.sentimentIndustry).toBe(result.industry);
    expect(result.companies).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
    expect(['positive', 'negative', 'neutral']).toContain(result.sentimentType);
  });

  test('4.3: getTopMovers - Should return top upgrades and downgrades', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const movers = provider.getTopMovers(20);

      return {
        hasTopUpgrades: movers.topUpgrades.length > 0,
        hasTopDowngrades: movers.topDowngrades.length > 0,
        upgradesCount: movers.topUpgrades.length,
        downgradesCount: movers.topDowngrades.length,
        upgradesPositive: movers.topUpgrades.every(c => c.changeRate > 0),
        downgradesNegative: movers.topDowngrades.every(c => c.changeRate < 0),
        upgradesSorted: movers.topUpgrades.every((c, i, arr) => i === 0 || c.changeRate <= arr[i-1].changeRate),
        downgradesSorted: movers.topDowngrades.every((c, i, arr) => i === 0 || c.changeRate >= arr[i-1].changeRate)
      };
    });

    if (result.hasTopUpgrades) {
      expect(result.upgradesPositive).toBe(true);
      expect(result.upgradesSorted).toBe(true);
      expect(result.upgradesCount).toBeLessThanOrEqual(20);
    }
    if (result.hasTopDowngrades) {
      expect(result.downgradesNegative).toBe(true);
      expect(result.downgradesSorted).toBe(true);
      expect(result.downgradesCount).toBeLessThanOrEqual(20);
    }
  });

  test('4.4: getCompanySummary - Should return comprehensive summary', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const ticker = provider.activeCompanies[0].ticker;
      const summary = provider.getCompanySummary(ticker);

      return {
        ticker,
        hasSummary: summary !== null,
        summaryTicker: summary?.ticker,
        corp: summary?.corp,
        exchange: summary?.exchange,
        industry: summary?.industry,
        currentFY: summary?.currentFY,
        nextFY: summary?.nextFY,
        hasChanges: summary?.changes !== null,
        hasTrend: summary?.trend !== null,
        changeFields: summary ? Object.keys(summary.changes) : []
      };
    });

    expect(result.hasSummary).toBe(true);
    expect(result.summaryTicker).toBe(result.ticker);
    expect(result.corp).toBeTruthy();
    expect(result.hasChanges).toBe(true);
    expect(result.hasTrend).toBe(true);
    expect(result.changeFields).toContain('oneWeek');
    expect(result.changeFields).toContain('oneMonth');
    expect(result.changeFields).toContain('threeMonths');
  });

  test('4.5: Industry coverage test', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const industries = new Set();
      for (const company of provider.activeCompanies) {
        if (company.industry) {
          industries.add(company.industry);
        }
      }

      return {
        industryCount: industries.size,
        industries: Array.from(industries).slice(0, 5)
      };
    });

    expect(result.industryCount).toBeGreaterThan(1); // Multiple industries
  });

  test('4.6: Statistical consistency check', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const market = provider.getMarketSentiment();
      const movers = provider.getTopMovers(20);

      // Market sentiment uses 1% threshold, top movers use 0% threshold
      // So topMovers may include 0~1% changes that market classifies as stable
      const hasMarketUpgrades = market.upgrades > 0;
      const hasMarketDowngrades = market.downgrades > 0;
      const hasTopUpgrades = movers.topUpgrades.length > 0;
      const hasTopDowngrades = movers.topDowngrades.length > 0;

      // Consistency: If market has significant changes (>1%), topMovers should too
      // But topMovers can have changes even if market has none (0~1% range)
      const consistency = (
        (!hasMarketUpgrades || hasTopUpgrades) &&  // market upgrade → top movers must have
        (!hasMarketDowngrades || hasTopDowngrades) // market downgrade → top movers must have
      );

      return {
        marketUpgrades: market.upgrades,
        marketDowngrades: market.downgrades,
        topUpgradesCount: movers.topUpgrades.length,
        topDowngradesCount: movers.topDowngrades.length,
        consistency,
        upgradeRelation: hasMarketUpgrades ? hasTopUpgrades : true,
        downgradeRelation: hasMarketDowngrades ? hasTopDowngrades : true
      };
    });

    // If market has significant upgrades (>1%), top movers should have them too
    expect(result.consistency).toBe(true);
    expect(result.upgradeRelation).toBe(true);
    expect(result.downgradeRelation).toBe(true);
  });

  // ========================================
  // 5. PERFORMANCE TESTS (3 tests)
  // ========================================

  test('5.1: O(1) ticker lookup performance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const tickers = provider.data.slice(0, 100).map(c => c.ticker);
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

    expect(result.time).toBeLessThan(100); // 100 lookups < 100ms
    expect(result.avgTime).toBeLessThan(1); // Avg < 1ms per lookup
  });

  test('5.2: Full dataset filtering performance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const start = performance.now();
      const upgraded = provider.getUpgradedCompanies('1w', 0.02);
      const downgraded = provider.getDowngradedCompanies('1w', 0.02);
      const end = performance.now();

      return {
        totalCompanies: provider.data.length,
        upgraded: upgraded.length,
        downgraded: downgraded.length,
        time: end - start
      };
    });

    expect(result.totalCompanies).toBe(1250);
    expect(result.time).toBeLessThan(1000); // Full filtering < 1s
  });

  test('5.3: Market sentiment calculation performance', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const start = performance.now();
      const sentiment = provider.getMarketSentiment();
      const movers = provider.getTopMovers(20);
      const end = performance.now();

      return {
        time: end - start,
        sentimentCalculated: sentiment !== null,
        moversCalculated: movers.topUpgrades.length > 0 || movers.topDowngrades.length > 0
      };
    });

    expect(result.time).toBeLessThan(500); // Statistical analysis < 500ms
    expect(result.sentimentCalculated).toBe(true);
  });

  // ========================================
  // 6. EDGE CASES & NULL SAFETY (8 tests)
  // ========================================

  test('6.1: Null/undefined ticker handling', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const nullResult = provider.getCompanyByTicker(null);
      const undefinedResult = provider.getCompanyByTicker(undefined);
      const emptyResult = provider.getCompanyByTicker('');

      return {
        nullResult: nullResult === null,
        undefinedResult: undefinedResult === null,
        emptyResult: emptyResult === null
      };
    });

    expect(result.nullResult).toBe(true);
    expect(result.undefinedResult).toBe(true);
    expect(result.emptyResult).toBe(true);
  });

  test('6.2: Invalid ticker handling', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const invalidTicker = provider.getCompanyByTicker('INVALID_TICKER_12345');
      const history = provider.getEPSHistory('INVALID_TICKER_12345');
      const change = provider.calculateChangeRate('INVALID_TICKER_12345', '1w');
      const trend = provider.detectTrend('INVALID_TICKER_12345');

      return {
        tickerNull: invalidTicker === null,
        historyNull: history === null,
        changeNull: change === null,
        trendNull: trend === null
      };
    });

    expect(result.tickerNull).toBe(true);
    expect(result.historyNull).toBe(true);
    expect(result.changeNull).toBe(true);
    expect(result.trendNull).toBe(true);
  });

  test('6.3: Insufficient data handling', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      // Find company with sparse data
      const sparseCompany = provider.data.find(c => {
        const recentDates = provider.dateFields.slice(0, 10);
        const populated = recentDates.filter(d => c[d] !== null && c[d] !== undefined).length;
        return populated < 3;
      });

      if (!sparseCompany) return { noSparseData: true };

      const trend = provider.detectTrend(sparseCompany.ticker, 4);

      return {
        ticker: sparseCompany.ticker,
        trend: trend?.trend,
        isInsufficientData: trend?.trend === 'insufficient_data',
        confidenceZero: trend?.confidence === 0
      };
    });

    if (!result.noSparseData) {
      expect(result.isInsufficientData).toBe(true);
      expect(result.confidenceZero).toBe(true);
    }
  });

  test('6.4: Null change rate handling (missing data)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      // Test with company that might have null values
      let nullChangeFound = false;
      for (const company of provider.data.slice(0, 100)) {
        const change = provider.calculateChangeRate(company.ticker, '3m');
        if (change === null) {
          nullChangeFound = true;
          break;
        }
      }

      return { nullChangeFound };
    });

    // Just verify no errors occur
    expect(typeof result.nullChangeFound).toBe('boolean');
  });

  test('6.5: Empty industry sentiment', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const invalidIndustry = provider.getIndustrySentiment('INVALID_INDUSTRY_XYZ');
      const nullIndustry = provider.getIndustrySentiment(null);

      return {
        invalidNull: invalidIndustry === null,
        nullInputNull: nullIndustry === null
      };
    });

    expect(result.invalidNull).toBe(true);
    expect(result.nullInputNull).toBe(true);
  });

  test('6.6: Zero division protection', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      // Test with company where previous value might be 0
      // Change rate should return null if previous === 0
      let zeroDivisionHandled = true;
      for (const company of provider.activeCompanies.slice(0, 50)) {
        const change = provider.calculateChangeRate(company.ticker, '1w');
        if (change !== null && !isFinite(change)) {
          zeroDivisionHandled = false;
          break;
        }
      }

      return { zeroDivisionHandled };
    });

    expect(result.zeroDivisionHandled).toBe(true);
  });

  test('6.7: parseNumber null safety', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const nullVal = provider.parseNumber(null);
      const undefinedVal = provider.parseNumber(undefined);
      const emptyVal = provider.parseNumber('');
      const nanVal = provider.parseNumber('not a number');
      const validVal = provider.parseNumber('123.45');

      return {
        nullResult: nullVal === null,
        undefinedResult: undefinedVal === null,
        emptyResult: emptyVal === null,
        nanResult: nanVal === null,
        validResult: validVal === 123.45
      };
    });

    expect(result.nullResult).toBe(true);
    expect(result.undefinedResult).toBe(true);
    expect(result.emptyResult).toBe(true);
    expect(result.nanResult).toBe(true);
    expect(result.validResult).toBe(true);
  });

  test('6.8: Date conversion edge cases', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new EPSMonitoringProvider();
      await provider.loadFromJSON('data/T_Chk.json');

      const date1 = provider.excelSerialToDate(1); // 1899-12-31
      const date0 = provider.excelSerialToDate(0); // 1899-12-30
      const dateNegative = provider.excelSerialToDate(-1); // 1899-12-29

      return {
        date1,
        date0,
        dateNegative,
        allValid: /^\d{4}-\d{2}-\d{2}$/.test(date1) &&
                  /^\d{4}-\d{2}-\d{2}$/.test(date0) &&
                  /^\d{4}-\d{2}-\d{2}$/.test(dateNegative)
      };
    });

    expect(result.allValid).toBe(true);
  });

});
