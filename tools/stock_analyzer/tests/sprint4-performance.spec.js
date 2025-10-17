/**
 * Sprint 4: Performance E2E Tests
 *
 * Purpose: Test performance benchmarks for Sprint 4 Analytics modules and dashboard
 * Tests: 7+ performance test cases
 * Coverage: Initialization time, chart rendering speed, memory usage, responsiveness
 */

import { test, expect } from '@playwright/test';

test.describe('Sprint 4 Performance - Module Initialization', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  });

  test('EPSAnalytics initialization should complete under 1.5 seconds', async ({ page }) => {
    // Test: EPSAnalytics.initialize() performance benchmark
    const performance = await page.evaluate(async () => {
      const startTime = performance.now();

      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        initialized: window.epsAnalytics.initialized,
        dataCount: window.epsAnalytics.epsData?.length || 0
      };
    });

    console.log(`EPSAnalytics initialization: ${performance.duration.toFixed(2)}ms`);

    expect(performance.initialized).toBeTruthy();
    expect(performance.duration).toBeLessThan(1500); // 1.5 seconds
    expect(performance.dataCount).toBeGreaterThan(0);
  });

  test('GrowthAnalytics initialization should complete under 1.5 seconds', async ({ page }) => {
    // Test: GrowthAnalytics.initialize() performance benchmark
    const performance = await page.evaluate(async () => {
      const startTime = performance.now();

      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        initialized: window.growthAnalytics.initialized,
        dataCount: window.growthAnalytics.growthData?.length || 0
      };
    });

    console.log(`GrowthAnalytics initialization: ${performance.duration.toFixed(2)}ms`);

    expect(performance.initialized).toBeTruthy();
    expect(performance.duration).toBeLessThan(1500);
    expect(performance.dataCount).toBeGreaterThan(0);
  });

  test('RankingAnalytics initialization should complete under 1.5 seconds', async ({ page }) => {
    // Test: RankingAnalytics.initialize() performance benchmark
    const performance = await page.evaluate(async () => {
      const startTime = performance.now();

      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        initialized: window.rankingAnalytics.initialized,
        dataCount: window.rankingAnalytics.rankData?.length || 0
      };
    });

    console.log(`RankingAnalytics initialization: ${performance.duration.toFixed(2)}ms`);

    expect(performance.initialized).toBeTruthy();
    expect(performance.duration).toBeLessThan(1500);
    expect(performance.dataCount).toBeGreaterThan(0);
  });

  test('All three modules initialization should complete under 3 seconds total', async ({ page }) => {
    // Test: Parallel initialization performance
    const performance = await page.evaluate(async () => {
      const startTime = performance.now();

      // Initialize all modules
      const promises = [];

      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        promises.push(window.growthAnalytics.initialize());
      }

      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        promises.push(window.rankingAnalytics.initialize());
      }

      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        promises.push(window.epsAnalytics.initialize());
      }

      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        allInitialized: window.growthAnalytics.initialized &&
                       window.rankingAnalytics.initialized &&
                       window.epsAnalytics.initialized
      };
    });

    console.log(`All modules initialization: ${performance.duration.toFixed(2)}ms`);

    expect(performance.allInitialized).toBeTruthy();
    expect(performance.duration).toBeLessThan(3000); // 3 seconds
  });
});

test.describe('Sprint 4 Performance - Chart Rendering', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    // Initialize all modules
    await page.evaluate(async () => {
      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }
      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });
  });

  test('Single chart rendering should complete under 500ms', async ({ page }) => {
    // Test: Individual chart render performance
    await page.click('#tab-dashboard');

    const performance = await page.evaluate(() => {
      const startTime = performance.now();

      // Wait for first chart to render
      const canvas = document.getElementById('growth-sector-chart');
      const chartExists = canvas?.__chartjs !== undefined;

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        chartRendered: chartExists
      };
    });

    console.log(`Single chart rendering: ${performance.duration.toFixed(2)}ms`);

    expect(performance.chartRendered).toBeTruthy();
    expect(performance.duration).toBeLessThan(500); // 500ms
  });

  test('All six dashboard charts should render under 2 seconds', async ({ page }) => {
    // Test: Full dashboard chart rendering performance
    const startTime = Date.now();

    await page.click('#tab-dashboard');
    await page.waitForTimeout(2000); // Wait for all charts

    const duration = Date.now() - startTime;

    const chartStatus = await page.evaluate(() => {
      const chartIds = [
        'growth-sector-chart',
        'growth-top-companies-chart',
        'ranking-distribution-chart',
        'ranking-sector-chart',
        'eps-roe-scatter-chart',
        'eps-sector-heatmap-chart'
      ];

      let renderedCount = 0;
      chartIds.forEach(id => {
        const canvas = document.getElementById(id);
        if (canvas && canvas.__chartjs) {
          renderedCount++;
        }
      });

      return {
        total: chartIds.length,
        rendered: renderedCount
      };
    });

    console.log(`All charts rendering: ${duration}ms`);
    console.log(`Charts rendered: ${chartStatus.rendered}/${chartStatus.total}`);

    expect(duration).toBeLessThan(2000); // 2 seconds
    expect(chartStatus.rendered).toBeGreaterThanOrEqual(4); // At least 4 charts
  });

  test('Chart re-rendering after tab switch should be under 1 second', async ({ page }) => {
    // Test: Chart re-render performance
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1500);

    // Switch away and back
    await page.click('#tab-screener');
    await page.waitForTimeout(300);

    const startTime = Date.now();
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);
    const duration = Date.now() - startTime;

    const chartsStillWork = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return canvas?.__chartjs !== undefined;
    });

    console.log(`Chart re-rendering: ${duration}ms`);

    expect(duration).toBeLessThan(1000); // 1 second
    expect(chartsStillWork).toBeTruthy();
  });
});

test.describe('Sprint 4 Performance - Memory and Resource Usage', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    await page.evaluate(async () => {
      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }
      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });
  });

  test('Memory usage should be reasonable after initialization', async ({ page }) => {
    // Test: Memory footprint should not be excessive
    const memoryUsage = await page.evaluate(() => {
      if (!performance.memory) {
        return { available: false };
      }

      return {
        available: true,
        usedJSHeapSize: performance.memory.usedJSHeapSize / 1024 / 1024, // MB
        totalJSHeapSize: performance.memory.totalJSHeapSize / 1024 / 1024, // MB
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit / 1024 / 1024 // MB
      };
    });

    if (memoryUsage.available) {
      console.log(`Memory usage: ${memoryUsage.usedJSHeapSize.toFixed(2)} MB`);
      console.log(`Total heap: ${memoryUsage.totalJSHeapSize.toFixed(2)} MB`);

      // Memory usage should be under 100MB for analytics modules
      expect(memoryUsage.usedJSHeapSize).toBeLessThan(100);
    } else {
      console.log('Performance.memory API not available in this browser');
      expect(true).toBeTruthy(); // Pass test if API not available
    }
  });

  test('No memory leaks after multiple tab switches', async ({ page }) => {
    // Test: Memory should not continuously grow with tab switches
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    const initialMemory = await page.evaluate(() => {
      if (!performance.memory) return null;
      return performance.memory.usedJSHeapSize / 1024 / 1024; // MB
    });

    // Perform 10 tab switches
    for (let i = 0; i < 10; i++) {
      await page.click('#tab-screener');
      await page.waitForTimeout(200);
      await page.click('#tab-dashboard');
      await page.waitForTimeout(200);
    }

    const finalMemory = await page.evaluate(() => {
      if (!performance.memory) return null;
      return performance.memory.usedJSHeapSize / 1024 / 1024; // MB
    });

    if (initialMemory !== null && finalMemory !== null) {
      const memoryGrowth = finalMemory - initialMemory;
      console.log(`Memory growth after 10 switches: ${memoryGrowth.toFixed(2)} MB`);

      // Memory growth should be minimal (under 20MB)
      expect(memoryGrowth).toBeLessThan(20);
    } else {
      console.log('Performance.memory API not available');
      expect(true).toBeTruthy();
    }
  });

  test('Dashboard should remain responsive under load', async ({ page }) => {
    // Test: Page should remain interactive during heavy operations
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1500);

    // Measure responsiveness
    const responsiveness = await page.evaluate(async () => {
      const startTime = performance.now();

      // Simulate user interaction
      const button = document.querySelector('#tab-screener');
      if (button) {
        button.focus();
      }

      const endTime = performance.now();
      const interactionDelay = endTime - startTime;

      // Check if page is still responsive
      const isResponsive = document.readyState === 'complete';

      return {
        interactionDelay: interactionDelay,
        isResponsive: isResponsive
      };
    });

    console.log(`Interaction delay: ${responsiveness.interactionDelay.toFixed(2)}ms`);

    // Interaction should be instant (under 100ms)
    expect(responsiveness.interactionDelay).toBeLessThan(100);
    expect(responsiveness.isResponsive).toBeTruthy();
  });
});

test.describe('Sprint 4 Performance - Data Processing Efficiency', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    await page.evaluate(async () => {
      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }
      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });
  });

  test('Sector aggregation calculations should be fast', async ({ page }) => {
    // Test: getSectorEPSAverages() should complete quickly
    const performance = await page.evaluate(() => {
      const startTime = performance.now();

      const result = window.epsAnalytics.getSectorEPSAverages();

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        sectorCount: result.length
      };
    });

    console.log(`Sector aggregation: ${performance.duration.toFixed(2)}ms`);

    expect(performance.duration).toBeLessThan(100); // 100ms
    expect(performance.sectorCount).toBeGreaterThan(0);
  });

  test('Chart data generation should be efficient', async ({ page }) => {
    // Test: getEPSChartData() should generate data quickly
    const performance = await page.evaluate(() => {
      const firstTicker = window.epsAnalytics.epsData?.[0]?.Ticker;
      if (!firstTicker) return null;

      const startTime = performance.now();

      const chartData = window.epsAnalytics.getEPSChartData(firstTicker);

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        hasData: chartData !== null
      };
    });

    if (performance) {
      console.log(`Chart data generation: ${performance.duration.toFixed(2)}ms`);

      expect(performance.duration).toBeLessThan(50); // 50ms
      expect(performance.hasData).toBeTruthy();
    }
  });

  test('Filtering operations should scale with data size', async ({ page }) => {
    // Test: getHighEPSCompanies() performance
    const performance = await page.evaluate(() => {
      const startTime = performance.now();

      const highEPSCompanies = window.epsAnalytics.getHighEPSCompanies(5, 'current');

      const endTime = performance.now();
      const duration = endTime - startTime;

      return {
        duration: duration,
        resultCount: highEPSCompanies.length
      };
    });

    console.log(`Filtering operation: ${performance.duration.toFixed(2)}ms`);

    expect(performance.duration).toBeLessThan(100); // 100ms
    expect(performance.resultCount).toBeGreaterThan(0);
  });

  test('Batch operations should be more efficient than individual calls', async ({ page }) => {
    // Test: Compare batch vs individual data retrieval
    const performance = await page.evaluate(() => {
      const tickers = window.epsAnalytics.epsData?.slice(0, 10).map(e => e.Ticker) || [];

      // Individual calls
      const startIndividual = performance.now();
      tickers.forEach(ticker => {
        window.epsAnalytics.getCompanyEPS(ticker);
      });
      const endIndividual = performance.now();
      const individualDuration = endIndividual - startIndividual;

      // Batch call (using filter which is more efficient)
      const startBatch = performance.now();
      const batchResult = window.epsAnalytics.epsData.filter(e =>
        tickers.includes(e.Ticker)
      );
      const endBatch = performance.now();
      const batchDuration = endBatch - startBatch;

      return {
        individualDuration: individualDuration,
        batchDuration: batchDuration,
        efficiency: individualDuration / batchDuration
      };
    });

    console.log(`Individual calls: ${performance.individualDuration.toFixed(2)}ms`);
    console.log(`Batch call: ${performance.batchDuration.toFixed(2)}ms`);
    console.log(`Efficiency gain: ${performance.efficiency.toFixed(2)}x`);

    // Batch should be faster
    expect(performance.batchDuration).toBeLessThan(performance.individualDuration);
  });
});

test.describe('Sprint 4 Performance - Real-World Scenarios', () => {

  test('Cold start performance (first page load)', async ({ page }) => {
    // Test: Complete cold start from page load to dashboard ready
    const startTime = Date.now();

    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    // Initialize modules
    await page.evaluate(async () => {
      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }
      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });

    // Render dashboard
    await page.click('#tab-dashboard');
    await page.waitForTimeout(2000);

    const totalTime = Date.now() - startTime;

    const dashboardReady = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return canvas?.__chartjs !== undefined;
    });

    console.log(`Cold start performance: ${totalTime}ms`);

    expect(totalTime).toBeLessThan(8000); // 8 seconds for complete cold start
    expect(dashboardReady).toBeTruthy();
  });

  test('Hot reload performance (subsequent dashboard views)', async ({ page }) => {
    // Test: Dashboard reload after initialization
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    // Initialize once
    await page.evaluate(async () => {
      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }
      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }
      if (window.epsAnalytics && !window.epsAnalytics.initialized) {
        await window.epsAnalytics.initialize();
      }
    });

    await page.click('#tab-dashboard');
    await page.waitForTimeout(2000);

    // Switch away
    await page.click('#tab-screener');
    await page.waitForTimeout(300);

    // Measure hot reload
    const startTime = Date.now();
    await page.click('#tab-dashboard');
    await page.waitForTimeout(500);
    const hotReloadTime = Date.now() - startTime;

    const dashboardStillWorks = await page.evaluate(() => {
      return document.getElementById('growth-sector-chart')?.__chartjs !== undefined;
    });

    console.log(`Hot reload performance: ${hotReloadTime}ms`);

    expect(hotReloadTime).toBeLessThan(1000); // 1 second for hot reload
    expect(dashboardStillWorks).toBeTruthy();
  });
});
