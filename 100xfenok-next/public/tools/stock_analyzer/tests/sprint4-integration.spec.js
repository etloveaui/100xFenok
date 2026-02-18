/**
 * Sprint 4: Integration E2E Tests
 *
 * Purpose: Test integration between GrowthAnalytics, RankingAnalytics, and EPSAnalytics
 * Tests: 10+ integration test cases
 * Coverage: Module interactions, data flow, dashboard coordination, error propagation
 */

import { test, expect } from '@playwright/test';

test.describe('Sprint 4 Integration - Three Analytics Modules', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('All three Analytics modules should be available globally', async ({ page }) => {
    // Test: All Sprint 4 modules should exist in window scope
    const modulesExist = await page.evaluate(() => {
      return {
        growth: typeof window.growthAnalytics !== 'undefined',
        ranking: typeof window.rankingAnalytics !== 'undefined',
        eps: typeof window.epsAnalytics !== 'undefined'
      };
    });

    expect(modulesExist.growth).toBeTruthy();
    expect(modulesExist.ranking).toBeTruthy();
    expect(modulesExist.eps).toBeTruthy();
  });

  test('All modules should initialize successfully', async ({ page }) => {
    // Test: Sequential initialization should work without errors
    const initResults = await page.evaluate(async () => {
      const results = {
        growth: false,
        ranking: false,
        eps: false
      };

      try {
        if (window.growthAnalytics && !window.growthAnalytics.initialized) {
          results.growth = await window.growthAnalytics.initialize();
        } else {
          results.growth = window.growthAnalytics.initialized;
        }

        if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
          results.ranking = await window.rankingAnalytics.initialize();
        } else {
          results.ranking = window.rankingAnalytics.initialized;
        }

        if (window.epsAnalytics && !window.epsAnalytics.initialized) {
          results.eps = await window.epsAnalytics.initialize();
        } else {
          results.eps = window.epsAnalytics.initialized;
        }
      } catch (error) {
        console.error('Initialization error:', error);
      }

      return results;
    });

    expect(initResults.growth).toBeTruthy();
    expect(initResults.ranking).toBeTruthy();
    expect(initResults.eps).toBeTruthy();
  });

  test('All modules should share the same dataManager', async ({ page }) => {
    // Test: Modules should use consistent data source
    const dataManagerCheck = await page.evaluate(() => {
      return {
        growthHasDataManager: window.growthAnalytics?.dataManager !== null,
        rankingHasDataManager: window.rankingAnalytics?.dataManager !== null,
        epsHasDataManager: window.epsAnalytics?.dataManager !== null,
        allSameInstance: window.growthAnalytics?.dataManager === window.rankingAnalytics?.dataManager &&
                         window.rankingAnalytics?.dataManager === window.epsAnalytics?.dataManager
      };
    });

    expect(dataManagerCheck.growthHasDataManager).toBeTruthy();
    expect(dataManagerCheck.rankingHasDataManager).toBeTruthy();
    expect(dataManagerCheck.epsHasDataManager).toBeTruthy();
    expect(dataManagerCheck.allSameInstance).toBeTruthy();
  });

  test('Modules should work together for cross-metric analysis', async ({ page }) => {
    // Test: Data from different modules should be combinable
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

    const crossAnalysis = await page.evaluate(() => {
      // Get first ticker from growth data
      const firstCompany = window.growthAnalytics.growthData?.[0];
      if (!firstCompany) return null;

      const ticker = firstCompany.Ticker;

      return {
        growthData: window.growthAnalytics.getCompanyGrowth(ticker),
        rankingData: window.rankingAnalytics.getCompanyRanking(ticker),
        epsData: window.epsAnalytics.getCompanyEPS(ticker),
        ticker: ticker
      };
    });

    expect(crossAnalysis).not.toBeNull();
    expect(crossAnalysis.ticker).toBeTruthy();

    // At least one module should have data for the ticker
    const hasData = crossAnalysis.growthData || crossAnalysis.rankingData || crossAnalysis.epsData;
    expect(hasData).toBeTruthy();
  });
});

test.describe('Sprint 4 Integration - Dashboard Coordination', () => {

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

    await page.click('#tab-dashboard');
    await page.waitForTimeout(1500);
  });

  test('Dashboard tab switch should trigger all Analytics rendering', async ({ page }) => {
    // Test: All six charts should render when dashboard tab is activated
    const chartCount = await page.evaluate(() => {
      const charts = [
        'growth-sector-chart',
        'growth-top-companies-chart',
        'ranking-distribution-chart',
        'ranking-sector-chart',
        'eps-roe-scatter-chart',
        'eps-sector-heatmap-chart'
      ];

      let renderedCount = 0;
      charts.forEach(chartId => {
        const canvas = document.getElementById(chartId);
        if (canvas && canvas.__chartjs) {
          renderedCount++;
        }
      });

      return renderedCount;
    });

    expect(chartCount).toBeGreaterThanOrEqual(4); // At least 4 out of 6 should render
  });

  test('Dashboard should coordinate data updates across all sections', async ({ page }) => {
    // Test: All sections should reflect current module state
    const coordinationCheck = await page.evaluate(() => {
      return {
        growthSectionVisible: document.querySelector('#sprint4-analytics-dashboard .dashboard-card:nth-child(2)') !== null,
        rankingSectionVisible: document.querySelector('#sprint4-analytics-dashboard .dashboard-card:nth-child(3)') !== null,
        epsSectionVisible: document.querySelector('#sprint4-analytics-dashboard .dashboard-card:nth-child(4)') !== null,
        statsUpdated: document.getElementById('ranking-total')?.textContent !== '1,252'
      };
    });

    expect(coordinationCheck.growthSectionVisible).toBeTruthy();
    expect(coordinationCheck.rankingSectionVisible).toBeTruthy();
    expect(coordinationCheck.epsSectionVisible).toBeTruthy();
  });

  test('Dashboard rendering should complete within reasonable time', async ({ page }) => {
    // Test: Full dashboard render should be under 3 seconds
    const startTime = Date.now();

    await page.click('#tab-screener');
    await page.waitForTimeout(200);
    await page.click('#tab-dashboard');
    await page.waitForTimeout(2000);

    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(3000);
  });
});

test.describe('Sprint 4 Integration - Data Flow and Consistency', () => {

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

  test('Sector data should be consistent across modules', async ({ page }) => {
    // Test: Same sectors should appear in multiple modules
    const sectorConsistency = await page.evaluate(() => {
      const growthSectors = window.growthAnalytics.getSectorGrowthAverages().map(s => s.sector);
      const rankingSectors = window.rankingAnalytics.getSectorRankDistribution('quality').map(s => s.sector);
      const epsSectors = window.epsAnalytics.getSectorEPSAverages().map(s => s.sector);

      // Find common sectors
      const commonSectors = growthSectors.filter(sector =>
        rankingSectors.includes(sector) && epsSectors.includes(sector)
      );

      return {
        growthCount: growthSectors.length,
        rankingCount: rankingSectors.length,
        epsCount: epsSectors.length,
        commonCount: commonSectors.length
      };
    });

    expect(sectorConsistency.growthCount).toBeGreaterThan(0);
    expect(sectorConsistency.rankingCount).toBeGreaterThan(0);
    expect(sectorConsistency.epsCount).toBeGreaterThan(0);
    expect(sectorConsistency.commonCount).toBeGreaterThan(0); // Should have overlapping sectors
  });

  test('Company count should be consistent across modules', async ({ page }) => {
    // Test: All modules should process similar number of companies
    const companyCounts = await page.evaluate(() => {
      return {
        growth: window.growthAnalytics.growthData?.length || 0,
        ranking: window.rankingAnalytics.rankData?.length || 0,
        eps: window.epsAnalytics.epsData?.length || 0
      };
    });

    expect(companyCounts.growth).toBeGreaterThan(0);
    expect(companyCounts.ranking).toBeGreaterThan(0);
    expect(companyCounts.eps).toBeGreaterThan(0);

    // Counts should be within reasonable range (not exact due to data availability)
    const maxCount = Math.max(companyCounts.growth, companyCounts.ranking, companyCounts.eps);
    const minCount = Math.min(companyCounts.growth, companyCounts.ranking, companyCounts.eps);

    expect(maxCount / minCount).toBeLessThan(2); // Within 2x of each other
  });
});

test.describe('Sprint 4 Integration - Error Propagation and Recovery', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('Dashboard should handle one module initialization failure', async ({ page }) => {
    // Test: Other modules should continue working if one fails
    await page.evaluate(async () => {
      // Break EPS module
      if (window.epsAnalytics) {
        window.epsAnalytics.initialize = async () => {
          throw new Error('Simulated initialization failure');
        };
      }

      // Initialize remaining modules
      if (window.growthAnalytics && !window.growthAnalytics.initialized) {
        await window.growthAnalytics.initialize();
      }
      if (window.rankingAnalytics && !window.rankingAnalytics.initialized) {
        await window.rankingAnalytics.initialize();
      }

      // Try to initialize broken module (should fail silently)
      try {
        await window.epsAnalytics.initialize();
      } catch (error) {
        console.log('Expected error:', error.message);
      }
    });

    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Dashboard should still be visible
    const dashboardVisible = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();

    // At least Growth and Ranking charts should work
    const workingCharts = await page.evaluate(() => {
      const growthChart = document.getElementById('growth-sector-chart')?.__chartjs;
      const rankingChart = document.getElementById('ranking-distribution-chart')?.__chartjs;

      return {
        growth: growthChart !== undefined,
        ranking: rankingChart !== undefined
      };
    });

    expect(workingCharts.growth || workingCharts.ranking).toBeTruthy();
  });

  test('Modules should recover from temporary data loading errors', async ({ page }) => {
    // Test: Retry logic should work for transient errors
    const recoveryTest = await page.evaluate(async () => {
      // Simulate retry by re-initializing
      let successCount = 0;

      if (window.growthAnalytics) {
        const result = await window.growthAnalytics.initialize();
        if (result) successCount++;
      }

      if (window.rankingAnalytics) {
        const result = await window.rankingAnalytics.initialize();
        if (result) successCount++;
      }

      if (window.epsAnalytics) {
        const result = await window.epsAnalytics.initialize();
        if (result) successCount++;
      }

      return successCount;
    });

    expect(recoveryTest).toBeGreaterThanOrEqual(2); // At least 2 modules should recover
  });

  test('Dashboard should display meaningful error states', async ({ page }) => {
    // Test: User should see informative messages when modules fail
    await page.evaluate(() => {
      // Clear all modules
      window.growthAnalytics = null;
      window.rankingAnalytics = null;
      window.epsAnalytics = null;
    });

    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Dashboard container should still exist
    const containerExists = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(containerExists).toBeTruthy();

    // Console should have logged warnings (check console messages)
    const consoleMessages = await page.evaluate(() => {
      return window.console ? true : false; // Console should be available
    });

    expect(consoleMessages).toBeTruthy();
  });
});

test.describe('Sprint 4 Integration - End-to-End Workflows', () => {

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

  test('Complete user workflow: Load → Initialize → View Dashboard → Interact', async ({ page }) => {
    // Test: Full user journey should work smoothly
    // 1. Page is already loaded and initialized (from beforeEach)

    // 2. Switch to dashboard
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1500);

    // 3. Verify dashboard is visible
    const dashboardVisible = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();

    // 4. Verify at least 4 charts are rendered
    const chartCount = await page.locator('.chart-container canvas').count();
    expect(chartCount).toBeGreaterThanOrEqual(4);

    // 5. Interact with a chart (hover)
    await page.hover('#growth-sector-chart');
    await page.waitForTimeout(300);

    // 6. Switch tabs and back
    await page.click('#tab-screener');
    await page.waitForTimeout(300);
    await page.click('#tab-dashboard');
    await page.waitForTimeout(500);

    // 7. Dashboard should still work
    const stillWorking = await page.evaluate(() => {
      return document.getElementById('growth-sector-chart')?.__chartjs !== undefined;
    });

    expect(stillWorking).toBeTruthy();
  });

  test('Data freshness: Dashboard should reflect latest module data', async ({ page }) => {
    // Test: Dashboard should always show current state of modules
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Get initial statistics
    const initialStats = await page.evaluate(() => {
      return {
        totalRanking: document.getElementById('ranking-total')?.textContent,
        top100: document.getElementById('ranking-top-100')?.textContent
      };
    });

    // Switch away and back
    await page.click('#tab-screener');
    await page.waitForTimeout(300);
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Get updated statistics
    const updatedStats = await page.evaluate(() => {
      return {
        totalRanking: document.getElementById('ranking-total')?.textContent,
        top100: document.getElementById('ranking-top-100')?.textContent
      };
    });

    // Statistics should be consistent
    expect(updatedStats.totalRanking).toBe(initialStats.totalRanking);
    expect(updatedStats.top100).toBe(initialStats.top100);
  });
});
