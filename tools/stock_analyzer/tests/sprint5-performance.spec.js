/**
 * Sprint 5: Performance E2E Tests
 *
 * Purpose: Test Sprint 5 modules performance and benchmarks
 * Tests: 10+ comprehensive test cases
 * Coverage: Initialization speed, query performance, chart rendering, memory usage, stress tests
 */

import { test, expect } from '@playwright/test';

test.describe('Sprint 5 Performance - Module Initialization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  test('CFOAnalytics initialization should complete within 1.5 seconds', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      if (!window.cfoAnalytics.initialized) {
        await window.cfoAnalytics.initialize();
      }
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(1500);
    console.log(`CFOAnalytics initialization: ${duration.toFixed(2)}ms`);
  });

  test('CorrelationEngine initialization should complete within 2.0 seconds', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      if (!window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(2000);
    console.log(`CorrelationEngine initialization: ${duration.toFixed(2)}ms`);
  });

  test('Correlation matrix building should complete within matrix initialization', async ({ page }) => {
    const timings = await page.evaluate(async () => {
      const startInit = performance.now();
      if (!window.correlationEngine.initialized) {
        await window.correlationEngine.initialize();
      }
      const initTime = performance.now() - startInit;

      // Matrix should already be built during initialization
      const hasMatrix = window.correlationEngine.correlationMatrix !== null;

      return {
        initTime,
        hasMatrix,
        matrixSize: hasMatrix ? Object.keys(window.correlationEngine.correlationMatrix).length : 0
      };
    });

    expect(timings.hasMatrix).toBeTruthy();
    expect(timings.matrixSize).toBeGreaterThan(1000);
    console.log(`Matrix built: ${timings.matrixSize} companies in ${timings.initTime.toFixed(2)}ms`);
  });
});

test.describe('Sprint 5 Performance - Data Query Operations', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();
    });
  });

  test('Single getCompanyCFO query should complete within 50ms', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const ticker = window.cfoAnalytics.cfoData[0].Ticker;
      const start = performance.now();
      window.cfoAnalytics.getCompanyCFO(ticker);
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(50);
    console.log(`Single CFO query: ${duration.toFixed(2)}ms`);
  });

  test('100 CFO queries should complete within 200ms', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const ticker = window.cfoAnalytics.cfoData[i % window.cfoAnalytics.cfoData.length].Ticker;
        window.cfoAnalytics.getCompanyCFO(ticker);
      }
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(200);
    console.log(`100 CFO queries: ${duration.toFixed(2)}ms`);
  });

  test('getCorrelationMatrix for 100 companies should complete within 200ms', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 100).map(c => c.Ticker);
      const start = performance.now();
      window.correlationEngine.getCorrelationMatrix(tickers);
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(200);
    console.log(`Correlation matrix (100x100): ${duration.toFixed(2)}ms`);
  });

  test('findLowCorrelationPairs should complete within 500ms', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const start = performance.now();
      window.correlationEngine.findLowCorrelationPairs(-0.3, 0.3);
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(500);
    console.log(`Find low correlation pairs: ${duration.toFixed(2)}ms`);
  });

  test('getCFOHealthScore batch calculation (100 companies) should be efficient', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        const ticker = window.cfoAnalytics.cfoData[i].Ticker;
        window.cfoAnalytics.getCFOHealthScore(ticker);
      }
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(300);
    console.log(`100 health score calculations: ${duration.toFixed(2)}ms`);
  });
});

test.describe('Sprint 5 Performance - Chart Rendering', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();
    });
  });

  test('renderCFOAnalyticsCharts should complete within 800ms', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      await window.renderCFOAnalyticsCharts();
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(800);
    console.log(`CFO charts rendering: ${duration.toFixed(2)}ms`);
  });

  test('renderCorrelationAnalyticsCharts should complete within 800ms', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      await window.renderCorrelationAnalyticsCharts();
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(800);
    console.log(`Correlation charts rendering: ${duration.toFixed(2)}ms`);
  });

  test('Complete Sprint 5 dashboard rendering should complete within 2 seconds', async ({ page }) => {
    const duration = await page.evaluate(async () => {
      const start = performance.now();
      await window.renderSprint5Analytics();
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(2000);
    console.log(`Full Sprint 5 dashboard rendering: ${duration.toFixed(2)}ms`);
  });
});

test.describe('Sprint 5 Performance - Complex Operations', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();
    });
  });

  test('K-means clustering (5 clusters) should complete within 1 second', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const start = performance.now();
      window.correlationEngine.clusterByCorrelation(5);
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(1000);
    console.log(`K-means clustering (5 clusters): ${duration.toFixed(2)}ms`);
  });

  test('buildDiversifiedPortfolio (100 candidates, 10 selected) should be efficient', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 100).map(c => c.Ticker);
      const start = performance.now();
      window.correlationEngine.buildDiversifiedPortfolio(tickers, 10);
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(800);
    console.log(`Diversified portfolio building: ${duration.toFixed(2)}ms`);
  });

  test('Portfolio optimization (10 stocks, moderate risk) should complete within 500ms', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 10).map(c => c.Ticker);
      const start = performance.now();
      window.correlationEngine.optimizePortfolio(tickers, 'moderate');
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(500);
    console.log(`Portfolio optimization: ${duration.toFixed(2)}ms`);
  });
});

test.describe('Sprint 5 Performance - Memory Usage', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
  });

  test('Sprint 5 modules should not exceed 150MB memory usage', async ({ page }) => {
    await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();
      await window.renderSprint5Analytics();
    });

    // Wait for garbage collection
    await page.waitForTimeout(2000);

    const memoryUsage = await page.evaluate(() => {
      if (performance.memory) {
        return {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        };
      }
      return null;
    });

    if (memoryUsage) {
      const usedMB = memoryUsage.usedJSHeapSize / (1024 * 1024);
      expect(usedMB).toBeLessThan(150);
      console.log(`Memory usage: ${usedMB.toFixed(2)} MB`);
    }
  });
});

test.describe('Sprint 5 Performance - Stress Tests', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await page.evaluate(async () => {
      if (!window.cfoAnalytics?.initialized) await window.cfoAnalytics.initialize();
      if (!window.correlationEngine?.initialized) await window.correlationEngine.initialize();
    });
  });

  test('Repeated dashboard rendering (5 times) should maintain performance', async ({ page }) => {
    const timings = await page.evaluate(async () => {
      const results = [];
      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        await window.renderSprint5Analytics();
        results.push(performance.now() - start);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return results;
    });

    expect(timings.length).toBe(5);
    timings.forEach((time, idx) => {
      expect(time).toBeLessThan(2500); // Allow slightly longer for repeated renders
      console.log(`Render ${idx + 1}: ${time.toFixed(2)}ms`);
    });

    // Performance should not degrade significantly
    const firstTime = timings[0];
    const lastTime = timings[4];
    expect(lastTime).toBeLessThan(firstTime * 1.5); // No more than 50% slower
  });

  test('Large correlation matrix query (500x500) should be manageable', async ({ page }) => {
    const duration = await page.evaluate(() => {
      const tickers = window.correlationEngine.correlationData.slice(0, 500).map(c => c.Ticker);
      const start = performance.now();
      window.correlationEngine.getCorrelationMatrix(tickers);
      return performance.now() - start;
    });

    expect(duration).toBeLessThan(1500); // Larger matrix allowed more time
    console.log(`Large correlation matrix (500x500): ${duration.toFixed(2)}ms`);
  });
});

test.describe('Sprint 5 Performance - End-to-End Workflow', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
  });

  test('Complete Sprint 5 workflow should complete within 5 seconds', async ({ page }) => {
    const workflowTimings = await page.evaluate(async () => {
      const timings = {};

      // Step 1: Initialize modules
      const startInit = performance.now();
      await Promise.all([
        window.cfoAnalytics.initialize(),
        window.correlationEngine.initialize()
      ]);
      timings.initialization = performance.now() - startInit;

      // Step 2: Render dashboard
      const startRender = performance.now();
      await window.renderSprint5Analytics();
      timings.rendering = performance.now() - startRender;

      // Step 3: Perform analysis queries
      const startAnalysis = performance.now();
      const highCFO = window.cfoAnalytics.getHighCashFlowCompanies(50000, 'FY 0');
      const lowCorr = window.correlationEngine.findLowCorrelationPairs(-0.2, 0.2);
      const portfolio = window.correlationEngine.buildDiversifiedPortfolio(
        highCFO.slice(0, 50).map(c => c.ticker),
        10
      );
      timings.analysis = performance.now() - startAnalysis;

      timings.total = timings.initialization + timings.rendering + timings.analysis;

      return timings;
    });

    expect(workflowTimings.total).toBeLessThan(5000);
    console.log(`Complete workflow breakdown:`);
    console.log(`  Initialization: ${workflowTimings.initialization.toFixed(2)}ms`);
    console.log(`  Rendering: ${workflowTimings.rendering.toFixed(2)}ms`);
    console.log(`  Analysis: ${workflowTimings.analysis.toFixed(2)}ms`);
    console.log(`  Total: ${workflowTimings.total.toFixed(2)}ms`);
  });
});
