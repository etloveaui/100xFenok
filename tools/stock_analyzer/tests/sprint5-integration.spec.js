/**
 * Sprint 5: Integration E2E Tests
 *
 * Purpose: Test Sprint 5 cross-module integration and workflows
 * Tests: 12+ comprehensive test cases
 * Coverage: Module integration, dashboard coordination, cross-module queries, portfolio workflows
 */

import { test, expect } from '@playwright/test';

test.describe('Sprint 5 Integration - Module Initialization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('Both Sprint 5 modules should be available globally', async ({ page }) => {
    const bothModulesExist = await page.evaluate(() => {
      return typeof window.cfoAnalytics !== 'undefined' &&
             typeof window.correlationEngine !== 'undefined';
    });

    expect(bothModulesExist).toBeTruthy();
  });

  test('Both modules should initialize successfully', async ({ page }) => {
    const initResults = await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }

      return {
        cfoInitialized: window.cfoAnalytics?.initialized || false,
        corrInitialized: window.correlationEngine?.initialized || false
      };
    });

    expect(initResults.cfoInitialized).toBeTruthy();
    expect(initResults.corrInitialized).toBeTruthy();
  });

  test('Both modules should share common tickers', async ({ page }) => {
    const sharedTickers = await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();

      const cfoTickers = new Set(window.cfoAnalytics.cfoData.map(c => c.Ticker));
      const corrTickers = new Set(window.correlationEngine.correlationData.map(c => c.Ticker));

      // Find intersection
      const commonTickers = [...cfoTickers].filter(t => corrTickers.has(t));

      return {
        cfoCount: cfoTickers.size,
        corrCount: corrTickers.size,
        commonCount: commonTickers.length
      };
    });

    expect(sharedTickers.commonCount).toBeGreaterThan(1000);
    expect(sharedTickers.commonCount).toBeLessThanOrEqual(Math.min(sharedTickers.cfoCount, sharedTickers.corrCount));
  });
});

test.describe('Sprint 5 Integration - Cross-Module Queries', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('Should find companies with high CFO and low correlation', async ({ page }) => {
    const highCFOLowCorr = await page.evaluate(() => {
      // Get companies with high cash flow
      const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(50000, 'FY 0');
      if (highCFO.length === 0) return [];

      // Get tickers from high CFO companies
      const highCFOTickers = highCFO.map(c => c.ticker);

      // Find pairs with low correlation among these companies
      const lowCorrPairs = window.correlationEngine.findLowCorrelationPairs(-0.2, 0.2);
      const highCFOLowCorrPairs = lowCorrPairs.filter(pair =>
        highCFOTickers.includes(pair.tickerA) && highCFOTickers.includes(pair.tickerB)
      );

      return highCFOLowCorrPairs.slice(0, 10);
    });

    expect(Array.isArray(highCFOLowCorr)).toBeTruthy();
    // May or may not find pairs depending on data, but should not error
  });

  test('Should build diversified portfolio from high CFO health score companies', async ({ page }) => {
    const portfolio = await page.evaluate(() => {
      // Get companies with high CFO health scores
      const cfoData = window.cfoAnalytics.cfoData || [];
      const companiesWithScores = cfoData
        .map(c => ({
          ticker: c.Ticker,
          score: window.cfoAnalytics.getCFOHealthScore(c.Ticker)
        }))
        .filter(c => c.score !== null && c.score > 70)
        .sort((a, b) => b.score - a.score)
        .slice(0, 50);

      const topTickers = companiesWithScores.map(c => c.ticker);

      // Build diversified portfolio from these top CFO companies
      return window.correlationEngine.buildDiversifiedPortfolio(topTickers, 10);
    });

    expect(Array.isArray(portfolio)).toBeTruthy();
    expect(portfolio.length).toBeGreaterThan(0);
    expect(portfolio.length).toBeLessThanOrEqual(10);
  });

  test('Should analyze correlation patterns among sector leaders by CFO', async ({ page }) => {
    const sectorAnalysis = await page.evaluate(() => {
      // Get sector averages from CFO
      const sectorCFO = window.cfoAnalytics.getSectorCFOAverages();
      if (sectorCFO.length === 0) return null;

      // Get top 3 sectors by CFO
      const topSectors = sectorCFO.slice(0, 3);

      // For each sector, get top companies and analyze their correlations
      return topSectors.map(sector => {
        const sectorCompanies = window.cfoAnalytics.cfoData.filter(c => c.WI26 === sector.sector);
        const sectorTickers = sectorCompanies.map(c => c.Ticker).slice(0, 10);

        // Get average correlation within this sector
        let correlations = [];
        const matrix = window.correlationEngine.correlationMatrix;
        for (let i = 0; i < sectorTickers.length; i++) {
          for (let j = i + 1; j < sectorTickers.length; j++) {
            const corr = matrix[sectorTickers[i]]?.[sectorTickers[j]];
            if (corr !== null) correlations.push(corr);
          }
        }

        const avgCorr = correlations.length > 0
          ? correlations.reduce((sum, c) => sum + c, 0) / correlations.length
          : 0;

        return {
          sector: sector.sector,
          avgCFO: sector.avgCFO,
          avgCorrelation: avgCorr,
          companyCount: sectorCompanies.length
        };
      });
    });

    expect(sectorAnalysis).not.toBeNull();
    expect(Array.isArray(sectorAnalysis)).toBeTruthy();
    sectorAnalysis.forEach(sector => {
      expect(sector).toHaveProperty('sector');
      expect(sector).toHaveProperty('avgCFO');
      expect(sector).toHaveProperty('avgCorrelation');
    });
  });
});

test.describe('Sprint 5 Integration - Dashboard Coordination', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000); // Wait for dashboard rendering
  });

  test('renderSprint5Analytics should coordinate both CFO and Correlation rendering', async ({ page }) => {
    const renderResult = await page.evaluate(async () => {
      // Call main render function
      await window.renderSprint5Analytics();

      // Check if charts were created
      const cfoCharts = [
        document.getElementById('cfo-sector-heatmap-chart').__chart__,
        document.getElementById('cfo-top-companies-chart').__chart__,
        document.getElementById('cfo-roe-scatter-chart').__chart__
      ];

      const corrCharts = [
        document.getElementById('corr-heatmap-chart').__chart__,
        document.getElementById('corr-sector-chart').__chart__,
        document.getElementById('corr-cluster-scatter-chart').__chart__
      ];

      return {
        cfoChartsCreated: cfoCharts.every(c => c !== undefined),
        corrChartsCreated: corrCharts.every(c => c !== undefined)
      };
    });

    expect(renderResult.cfoChartsCreated).toBeTruthy();
    expect(renderResult.corrChartsCreated).toBeTruthy();
  });

  test('Statistics cards should update with real data', async ({ page }) => {
    const statsUpdated = await page.evaluate(() => {
      const cfoTotal = document.getElementById('cfo-total')?.textContent;
      const corrTotal = document.getElementById('corr-total')?.textContent;

      return {
        cfoHasNumber: /\d/.test(cfoTotal),
        corrHasNumber: /\d/.test(corrTotal),
        cfoValue: cfoTotal,
        corrValue: corrTotal
      };
    });

    expect(statsUpdated.cfoHasNumber).toBeTruthy();
    expect(statsUpdated.corrHasNumber).toBeTruthy();
  });
});

test.describe('Sprint 5 Integration - Portfolio Recommendation Workflow', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (window.cfoAnalytics && !window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
      if (window.correlationEngine && !window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
    });
  });

  test('Complete portfolio recommendation workflow: CFO health + Diversification', async ({ page }) => {
    const workflow = await page.evaluate(() => {
      const results = {};

      // Step 1: Identify companies with strong cash flow health
      const allCompanies = window.cfoAnalytics.cfoData || [];
      const companiesWithHealth = allCompanies
        .map(c => ({
          ticker: c.Ticker,
          corp: c.Corp,
          healthScore: window.cfoAnalytics.getCFOHealthScore(c.Ticker)
        }))
        .filter(c => c.healthScore !== null && c.healthScore > 60)
        .sort((a, b) => b.healthScore - a.healthScore);

      results.healthyCompaniesCount = companiesWithHealth.length;
      results.topHealthScores = companiesWithHealth.slice(0, 5).map(c => c.healthScore);

      // Step 2: Get tickers for top healthy companies
      const candidateTickers = companiesWithHealth.slice(0, 100).map(c => c.ticker);
      results.candidatesCount = candidateTickers.length;

      // Step 3: Build diversified portfolio from candidates
      const portfolio = window.correlationEngine.buildDiversifiedPortfolio(candidateTickers, 15);
      results.portfolioSize = portfolio.length;
      results.portfolioAvgCorr = portfolio.reduce((sum, p) => sum + p.avgCorrelation, 0) / portfolio.length;

      // Step 4: Optimize portfolio weights
      const portfolioTickers = portfolio.map(p => p.ticker);
      const optimized = window.correlationEngine.optimizePortfolio(portfolioTickers, 'moderate');
      results.expectedReturn = optimized.expectedReturn;
      results.expectedRisk = optimized.expectedRisk;

      // Step 5: Get CFO details for final portfolio
      results.finalPortfolio = portfolioTickers.map(ticker => {
        const cfoData = window.cfoAnalytics.getCompanyCFO(ticker);
        return {
          ticker,
          corp: cfoData?.corp,
          healthScore: window.cfoAnalytics.getCFOHealthScore(ticker),
          weight: optimized.weights[ticker]
        };
      });

      return results;
    });

    expect(workflow.healthyCompaniesCount).toBeGreaterThan(50);
    expect(workflow.portfolioSize).toBeGreaterThan(0);
    expect(workflow.portfolioSize).toBeLessThanOrEqual(15);
    expect(workflow.portfolioAvgCorr).toBeLessThan(0.6); // Diversified
    expect(Array.isArray(workflow.finalPortfolio)).toBeTruthy();
    expect(workflow.finalPortfolio.length).toBe(workflow.portfolioSize);

    // Verify all portfolio items have health scores above 60
    workflow.finalPortfolio.forEach(item => {
      expect(item.healthScore).toBeGreaterThan(60);
    });
  });

  test('Risk-adjusted portfolio: Conservative vs Aggressive comparison', async ({ page }) => {
    const comparison = await page.evaluate(() => {
      // Get top CFO health companies
      const topCompanies = window.cfoAnalytics.cfoData
        .map(c => ({
          ticker: c.Ticker,
          score: window.cfoAnalytics.getCFOHealthScore(c.Ticker)
        }))
        .filter(c => c.score > 65)
        .sort((a, b) => b.score - a.score)
        .slice(0, 30)
        .map(c => c.ticker);

      // Build diversified subset
      const diversified = window.correlationEngine.buildDiversifiedPortfolio(topCompanies, 10);
      const tickers = diversified.map(d => d.ticker);

      // Compare conservative vs aggressive optimization
      const conservative = window.correlationEngine.optimizePortfolio(tickers, 'conservative');
      const aggressive = window.correlationEngine.optimizePortfolio(tickers, 'aggressive');

      return {
        tickers,
        conservative: {
          return: conservative.expectedReturn,
          risk: conservative.expectedRisk
        },
        aggressive: {
          return: aggressive.expectedReturn,
          risk: aggressive.expectedRisk
        }
      };
    });

    expect(comparison.tickers.length).toBeGreaterThan(0);
    expect(comparison.conservative.risk).toBeLessThan(comparison.aggressive.risk);
  });
});

test.describe('Sprint 5 Integration - Performance', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
  });

  test('Both modules should initialize concurrently within 3 seconds', async ({ page }) => {
    const startTime = Date.now();

    await page.evaluate(async () => {
      await Promise.all([
        window.cfoAnalytics.initialize(),
        window.correlationEngine.initialize()
      ]);
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(3000);
  });

  test('Complete Sprint 5 dashboard rendering should complete within 5 seconds', async ({ page }) => {
    await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();
    });

    const startTime = Date.now();

    await page.evaluate(async () => {
      await window.renderSprint5Analytics();
    });

    const duration = Date.now() - startTime;
    expect(duration).toBeLessThan(5000);
  });
});
