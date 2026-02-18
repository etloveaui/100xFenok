/**
 * E2E Test Suite: CompanyMasterProvider
 *
 * Purpose: Comprehensive testing of CompanyMasterProvider functionality
 * Data Source: M_Company.json (6,176 companies)
 *
 * Test Coverage:
 * - Data loading and validation
 * - Index structure verification
 * - O(1) lookup performance
 * - Industry/Exchange queries
 * - Filtering operations
 * - Search functionality
 * - Statistics and aggregations
 * - Edge cases and error handling
 *
 * CRITICAL: Tests use FULL dataset (6,176 companies) - NO slicing!
 */

import { test, expect } from '@playwright/test';

test.describe('CompanyMasterProvider E2E Tests', () => {

  // Setup: Navigate to the page before each test
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:8080/stock_analyzer.html');

    // Wait for page to be fully loaded
    await page.waitForLoadState('networkidle');
  });

  // ========================================
  // 1. DATA LOADING TESTS
  // ========================================

  test('1.1: Should successfully load M_Company.json', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      const success = await provider.loadFromJSON('data/M_Company.json');

      return {
        success,
        initialized: provider.initialized,
        hasCompanies: provider.companies !== null,
        hasMetadata: provider.metadata !== null
      };
    });

    expect(result.success).toBe(true);
    expect(result.initialized).toBe(true);
    expect(result.hasCompanies).toBe(true);
    expect(result.hasMetadata).toBe(true);
  });

  test('1.2: Should load all 6,176 companies', async ({ page }) => {
    const companyCount = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return provider.companies.length;
    });

    expect(companyCount).toBe(6176);
  });

  test('1.3: Should validate metadata structure', async ({ page }) => {
    const metadata = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        hasMetadata: provider.metadata !== null,
        hasRecordCount: 'recordCount' in provider.metadata,
        hasSource: 'source' in provider.metadata,
        recordCount: provider.metadata.recordCount
      };
    });

    expect(metadata.hasMetadata).toBe(true);
    expect(metadata.hasRecordCount).toBe(true);
    expect(metadata.hasSource).toBe(true);
    expect(metadata.recordCount).toBe(6176);
  });

  test('1.4: Should handle missing file gracefully', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      const success = await provider.loadFromJSON('data/nonexistent.json');

      return {
        success,
        initialized: provider.initialized
      };
    });

    expect(result.success).toBe(false);
    expect(result.initialized).toBe(false);
  });

  // ========================================
  // 2. INDEX STRUCTURE TESTS
  // ========================================

  test('2.1: Should build companyMap index', async ({ page }) => {
    const indexStats = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        size: provider.companyMap.size,
        hasEntries: provider.companyMap.size > 0
      };
    });

    expect(indexStats.hasEntries).toBe(true);
    expect(indexStats.size).toBe(6176);
  });

  test('2.2: Should build industryIndex', async ({ page }) => {
    const industryStats = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const industries = Array.from(provider.industryIndex.keys());
      let totalCompaniesInIndex = 0;

      for (const [industry, companies] of provider.industryIndex.entries()) {
        totalCompaniesInIndex += companies.length;
      }

      return {
        industryCount: provider.industryIndex.size,
        hasIndustries: industries.length > 0,
        totalCompaniesInIndex,
        sampleIndustries: industries.slice(0, 5)
      };
    });

    expect(industryStats.hasIndustries).toBe(true);
    expect(industryStats.industryCount).toBeGreaterThan(0);
    expect(industryStats.totalCompaniesInIndex).toBeGreaterThan(0);
  });

  test('2.3: Should build exchangeIndex', async ({ page }) => {
    const exchangeStats = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const exchanges = Array.from(provider.exchangeIndex.keys());
      let totalCompaniesInIndex = 0;

      for (const [exchange, companies] of provider.exchangeIndex.entries()) {
        totalCompaniesInIndex += companies.length;
      }

      return {
        exchangeCount: provider.exchangeIndex.size,
        hasExchanges: exchanges.length > 0,
        totalCompaniesInIndex,
        sampleExchanges: exchanges.slice(0, 5)
      };
    });

    expect(exchangeStats.hasExchanges).toBe(true);
    expect(exchangeStats.exchangeCount).toBeGreaterThan(0);
    expect(exchangeStats.totalCompaniesInIndex).toBeGreaterThan(0);
  });

  test('2.4: Should build indexes in less than 1 second', async ({ page }) => {
    const indexingTime = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();

      const start = Date.now();
      await provider.loadFromJSON('data/M_Company.json');
      const loadTime = Date.now() - start;

      const indexStart = Date.now();
      provider.buildIndexes();
      const indexTime = Date.now() - indexStart;

      return {
        loadTime,
        indexTime,
        totalTime: loadTime
      };
    });

    console.log(`Indexing performance: ${indexingTime.indexTime}ms`);
    expect(indexingTime.indexTime).toBeLessThan(1000);
  });

  // ========================================
  // 3. O(1) LOOKUP PERFORMANCE TESTS
  // ========================================

  test('3.1: Should lookup company by ticker (NVDA) in < 10ms', async ({ page }) => {
    const lookupResult = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      // Warm up
      provider.getCompanyByTicker('NVDA');

      // Measure performance
      const iterations = 1000;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        provider.getCompanyByTicker('NVDA');
      }

      const end = performance.now();
      const avgTime = (end - start) / iterations;

      const company = provider.getCompanyByTicker('NVDA');

      return {
        avgTime,
        found: company !== null,
        ticker: company?.ticker,
        corp: company?.corp
      };
    });

    console.log(`Average lookup time: ${lookupResult.avgTime.toFixed(4)}ms`);
    expect(lookupResult.avgTime).toBeLessThan(10);
    expect(lookupResult.found).toBe(true);
    expect(lookupResult.ticker).toBe('NVDA');
  });

  test('3.2: Should lookup Korean company by ticker (005930.KS)', async ({ page }) => {
    const lookupResult = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const company = provider.getCompanyByTicker('005930.KS');

      return {
        found: company !== null,
        ticker: company?.ticker,
        corp: company?.corp,
        exchange: company?.exchange
      };
    });

    expect(lookupResult.found).toBe(true);
    expect(lookupResult.ticker).toBe('005930.KS');
  });

  test('3.3: Should return null for non-existent ticker', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const company = provider.getCompanyByTicker('INVALID999');

      return {
        found: company !== null,
        company
      };
    });

    expect(result.found).toBe(false);
    expect(result.company).toBeNull();
  });

  test('3.4: Should handle null/undefined ticker input', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        nullResult: provider.getCompanyByTicker(null),
        undefinedResult: provider.getCompanyByTicker(undefined),
        emptyResult: provider.getCompanyByTicker('')
      };
    });

    expect(results.nullResult).toBeNull();
    expect(results.undefinedResult).toBeNull();
    expect(results.emptyResult).toBeNull();
  });

  // ========================================
  // 4. INDUSTRY/EXCHANGE QUERY TESTS
  // ========================================

  test('4.1: Should retrieve companies by industry (반도체)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const companies = provider.getCompaniesByIndustry('반도체');

      return {
        count: companies.length,
        hasCompanies: companies.length > 0,
        allHaveIndustry: companies.every(c => c.industry === '반도체'),
        sampleTickers: companies.slice(0, 5).map(c => c.ticker)
      };
    });

    expect(result.hasCompanies).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.allHaveIndustry).toBe(true);
  });

  test('4.2: Should retrieve companies by exchange (NASDAQ)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const companies = provider.getCompaniesByExchange('NASDAQ');

      return {
        count: companies.length,
        hasCompanies: companies.length > 0,
        allHaveExchange: companies.every(c => c.exchange === 'NASDAQ'),
        sampleTickers: companies.slice(0, 5).map(c => c.ticker)
      };
    });

    expect(result.hasCompanies).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.allHaveExchange).toBe(true);
  });

  test('4.3: Should return empty array for non-existent industry', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const companies = provider.getCompaniesByIndustry('NonExistentIndustry');

      return {
        isArray: Array.isArray(companies),
        isEmpty: companies.length === 0
      };
    });

    expect(result.isArray).toBe(true);
    expect(result.isEmpty).toBe(true);
  });

  test('4.4: Should handle null/undefined industry/exchange input', async ({ page }) => {
    const results = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        nullIndustry: provider.getCompaniesByIndustry(null),
        undefinedIndustry: provider.getCompaniesByIndustry(undefined),
        nullExchange: provider.getCompaniesByExchange(null),
        undefinedExchange: provider.getCompaniesByExchange(undefined)
      };
    });

    expect(Array.isArray(results.nullIndustry)).toBe(true);
    expect(results.nullIndustry.length).toBe(0);
    expect(Array.isArray(results.undefinedIndustry)).toBe(true);
    expect(results.undefinedIndustry.length).toBe(0);
    expect(Array.isArray(results.nullExchange)).toBe(true);
    expect(results.nullExchange.length).toBe(0);
    expect(Array.isArray(results.undefinedExchange)).toBe(true);
    expect(results.undefinedExchange.length).toBe(0);
  });

  // ========================================
  // 5. FILTERING TESTS
  // ========================================

  test('5.1: Should filter by market cap range', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      // Filter for large cap: > 10,000 million USD
      const largeCap = provider.filterByMarketCap(10000, Infinity);

      // Filter for mid cap: 1,000 - 10,000 million USD
      const midCap = provider.filterByMarketCap(1000, 10000);

      return {
        largeCapCount: largeCap.length,
        midCapCount: midCap.length,
        largeCapAllValid: largeCap.every(c => c.marketCap >= 10000),
        midCapAllValid: midCap.every(c => c.marketCap >= 1000 && c.marketCap <= 10000),
        sampleLargeCap: largeCap.slice(0, 3).map(c => ({
          ticker: c.ticker,
          marketCap: c.marketCap
        }))
      };
    });

    expect(result.largeCapCount).toBeGreaterThan(0);
    expect(result.midCapCount).toBeGreaterThan(0);
    expect(result.largeCapAllValid).toBe(true);
    expect(result.midCapAllValid).toBe(true);
  });

  test('5.2: Should filter by PER range', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      // Filter for low PER: 0 - 15
      const lowPER = provider.filterByPER(0, 15);

      // Filter for medium PER: 15 - 30
      const mediumPER = provider.filterByPER(15, 30);

      return {
        lowPERCount: lowPER.length,
        mediumPERCount: mediumPER.length,
        lowPERAllValid: lowPER.every(c => c.per >= 0 && c.per <= 15),
        mediumPERAllValid: mediumPER.every(c => c.per >= 15 && c.per <= 30),
        sampleLowPER: lowPER.slice(0, 3).map(c => ({
          ticker: c.ticker,
          per: c.per
        }))
      };
    });

    expect(result.lowPERCount).toBeGreaterThan(0);
    expect(result.mediumPERCount).toBeGreaterThan(0);
    expect(result.lowPERAllValid).toBe(true);
    expect(result.mediumPERAllValid).toBe(true);
  });

  test('5.3: Should handle boundary values (0 and Infinity)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const allMarketCap = provider.filterByMarketCap(0, Infinity);
      const allPER = provider.filterByPER(0, Infinity);

      return {
        allMarketCapCount: allMarketCap.length,
        allPERCount: allPER.length,
        totalCompanies: provider.companies.length
      };
    });

    expect(result.allMarketCapCount).toBeGreaterThan(0);
    expect(result.allPERCount).toBeGreaterThan(0);
    expect(result.allMarketCapCount).toBeLessThanOrEqual(result.totalCompanies);
    expect(result.allPERCount).toBeLessThanOrEqual(result.totalCompanies);
  });

  test('5.4: Should exclude companies with null/undefined values', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const filtered = provider.filterByMarketCap(0, Infinity);

      return {
        hasNullValues: filtered.some(c => c.marketCap === null || c.marketCap === undefined)
      };
    });

    expect(result.hasNullValues).toBe(false);
  });

  // ========================================
  // 6. SEARCH TESTS
  // ========================================

  test('6.1: Should search by company name (partial match)', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const results = provider.searchByName('삼성');

      return {
        count: results.length,
        hasResults: results.length > 0,
        allMatch: results.every(c => c.corp.includes('삼성')),
        sampleCompanies: results.slice(0, 5).map(c => ({
          ticker: c.ticker,
          corp: c.corp
        }))
      };
    });

    expect(result.hasResults).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.allMatch).toBe(true);
  });

  test('6.2: Should be case-insensitive', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const lowerCase = provider.searchByName('apple');
      const upperCase = provider.searchByName('APPLE');
      const mixedCase = provider.searchByName('ApPlE');

      return {
        lowerCaseCount: lowerCase.length,
        upperCaseCount: upperCase.length,
        mixedCaseCount: mixedCase.length,
        allEqual: lowerCase.length === upperCase.length && upperCase.length === mixedCase.length
      };
    });

    expect(result.allEqual).toBe(true);
  });

  test('6.3: Should enforce minimum 2 character requirement', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const oneChar = provider.searchByName('a');
      const twoChar = provider.searchByName('mi'); // 'mi' appears in Microsoft, etc

      return {
        oneCharCount: oneChar.length,
        twoCharCount: twoChar.length,
        oneCharEmpty: oneChar.length === 0
      };
    });

    expect(result.oneCharEmpty).toBe(true);
    expect(result.twoCharCount).toBeGreaterThan(0);
  });

  test('6.4: Should handle empty string and null input', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        emptyString: provider.searchByName(''),
        nullValue: provider.searchByName(null),
        undefinedValue: provider.searchByName(undefined)
      };
    });

    expect(Array.isArray(result.emptyString)).toBe(true);
    expect(result.emptyString.length).toBe(0);
    expect(Array.isArray(result.nullValue)).toBe(true);
    expect(result.nullValue.length).toBe(0);
    expect(Array.isArray(result.undefinedValue)).toBe(true);
    expect(result.undefinedValue.length).toBe(0);
  });

  // ========================================
  // 7. STATISTICS TESTS
  // ========================================

  test('7.1: Should return comprehensive statistics', async ({ page }) => {
    const stats = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return provider.getStatistics();
    });

    expect(stats).not.toBeNull();
    expect(stats.totalCompanies).toBe(6176);
    expect(stats.totalIndustries).toBeGreaterThan(0);
    expect(stats.totalExchanges).toBeGreaterThan(0);
    expect(Array.isArray(stats.topIndustries)).toBe(true);
    expect(Array.isArray(stats.topExchanges)).toBe(true);
  });

  test('7.2: Should return sorted industry list', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const industries = provider.getAllIndustries();

      // Check if sorted
      const isSorted = industries.every((val, i, arr) =>
        i === 0 || arr[i - 1] <= val
      );

      return {
        count: industries.length,
        isSorted,
        sample: industries.slice(0, 5)
      };
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.isSorted).toBe(true);
  });

  test('7.3: Should return sorted exchange list', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const exchanges = provider.getAllExchanges();

      // Check if sorted
      const isSorted = exchanges.every((val, i, arr) =>
        i === 0 || arr[i - 1] <= val
      );

      return {
        count: exchanges.length,
        isSorted,
        sample: exchanges.slice(0, 5)
      };
    });

    expect(result.count).toBeGreaterThan(0);
    expect(result.isSorted).toBe(true);
  });

  test('7.4: Should return top industries by company count', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      const topIndustries = provider.getTopIndustries(5);

      // Check if sorted by count descending
      const isSorted = topIndustries.every((val, i, arr) =>
        i === 0 || arr[i - 1].count >= val.count
      );

      return {
        count: topIndustries.length,
        isSorted,
        hasIndustryField: topIndustries.every(item => 'industry' in item),
        hasCountField: topIndustries.every(item => 'count' in item),
        topIndustries
      };
    });

    expect(result.count).toBeLessThanOrEqual(5);
    expect(result.isSorted).toBe(true);
    expect(result.hasIndustryField).toBe(true);
    expect(result.hasCountField).toBe(true);
  });

  // ========================================
  // 8. EDGE CASES & ERROR HANDLING
  // ========================================

  test('8.1: Should handle uninitialized provider gracefully', async ({ page }) => {
    const result = await page.evaluate(() => {
      const provider = new CompanyMasterProvider();

      return {
        initialized: provider.initialized,
        companies: provider.companies,
        stats: provider.getStatistics()
      };
    });

    expect(result.initialized).toBe(false);
    expect(result.companies).toBeNull();
    expect(result.stats).toBeNull();
  });

  test('8.2: Should handle malformed data gracefully', async ({ page }) => {
    const consoleMessages = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text());
      }
    });

    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();

      // Try to load malformed JSON (will fail)
      const success = await provider.loadFromJSON('data/nonexistent.json');

      return {
        success,
        initialized: provider.initialized
      };
    });

    expect(result.success).toBe(false);
    expect(result.initialized).toBe(false);
  });

  test('8.3: Should handle empty results consistently', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        emptyIndustry: provider.getCompaniesByIndustry('NonExistent'),
        emptyExchange: provider.getCompaniesByExchange('NonExistent'),
        emptySearch: provider.searchByName('xyz123impossiblequery999'),
        emptyMarketCap: provider.filterByMarketCap(999999999, 999999999),
        allAreArrays: true
      };
    });

    expect(Array.isArray(result.emptyIndustry)).toBe(true);
    expect(result.emptyIndustry.length).toBe(0);
    expect(Array.isArray(result.emptyExchange)).toBe(true);
    expect(result.emptyExchange.length).toBe(0);
    expect(Array.isArray(result.emptySearch)).toBe(true);
    expect(result.emptySearch.length).toBe(0);
    expect(Array.isArray(result.emptyMarketCap)).toBe(true);
    expect(result.emptyMarketCap.length).toBe(0);
  });

  test('8.4: Should handle invalid data types gracefully', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();
      await provider.loadFromJSON('data/M_Company.json');

      return {
        numberInput: provider.getCompanyByTicker(12345),
        objectInput: provider.getCompaniesByIndustry({ invalid: 'object' }),
        arrayInput: provider.searchByName(['array', 'input'])
      };
    });

    // Should handle gracefully without throwing
    expect(result.numberInput).toBeNull();
    expect(Array.isArray(result.objectInput)).toBe(true);
    expect(result.objectInput.length).toBe(0);
    expect(Array.isArray(result.arrayInput)).toBe(true);
    expect(result.arrayInput.length).toBe(0);
  });

  // ========================================
  // PERFORMANCE SUMMARY TEST
  // ========================================

  test('Performance Summary: Full dataset operations', async ({ page }) => {
    const performanceResults = await page.evaluate(async () => {
      const provider = new CompanyMasterProvider();

      // Measure load time
      const loadStart = performance.now();
      await provider.loadFromJSON('data/M_Company.json');
      const loadTime = performance.now() - loadStart;

      // Measure O(1) lookup performance
      const lookupIterations = 1000;
      const lookupStart = performance.now();
      for (let i = 0; i < lookupIterations; i++) {
        provider.getCompanyByTicker('NVDA');
      }
      const lookupTime = (performance.now() - lookupStart) / lookupIterations;

      // Measure filtering performance (O(n))
      const filterStart = performance.now();
      const filtered = provider.filterByMarketCap(10000, Infinity);
      const filterTime = performance.now() - filterStart;

      // Measure search performance (O(n))
      const searchStart = performance.now();
      const searched = provider.searchByName('samsung');
      const searchTime = performance.now() - searchStart;

      return {
        loadTime,
        lookupTime,
        filterTime,
        searchTime,
        totalCompanies: provider.companies.length,
        filteredCount: filtered.length,
        searchedCount: searched.length
      };
    });

    console.log('\n========================================');
    console.log('PERFORMANCE SUMMARY (6,176 companies)');
    console.log('========================================');
    console.log(`Load Time:       ${performanceResults.loadTime.toFixed(2)}ms`);
    console.log(`Lookup Time:     ${performanceResults.lookupTime.toFixed(4)}ms (avg over 1000 ops)`);
    console.log(`Filter Time:     ${performanceResults.filterTime.toFixed(2)}ms`);
    console.log(`Search Time:     ${performanceResults.searchTime.toFixed(2)}ms`);
    console.log(`Total Companies: ${performanceResults.totalCompanies}`);
    console.log(`Filtered Count:  ${performanceResults.filteredCount}`);
    console.log(`Searched Count:  ${performanceResults.searchedCount}`);
    console.log('========================================\n');

    // Assertions
    expect(performanceResults.lookupTime).toBeLessThan(10); // O(1) lookup < 10ms
    expect(performanceResults.loadTime).toBeLessThan(5000); // Load < 5s
    expect(performanceResults.totalCompanies).toBe(6176);
  });

});
