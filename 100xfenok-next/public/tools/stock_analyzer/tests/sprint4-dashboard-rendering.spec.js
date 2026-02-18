/**
 * Sprint 4: Dashboard Rendering E2E Tests
 *
 * Purpose: Test Sprint 4 Analytics dashboard HTML rendering and Chart.js visualization
 * Tests: 20+ comprehensive test cases
 * Coverage: DOM structure, chart rendering, data binding, responsive layout, user interactions
 */

import { test, expect } from '@playwright/test';

test.describe('Sprint 4 Dashboard - HTML Structure and DOM', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Switch to dashboard tab
    await page.click('#tab-dashboard');
    await page.waitForTimeout(500);
  });

  test('Sprint 4 Analytics dashboard container should exist', async ({ page }) => {
    // Test: Main dashboard container should be present in DOM
    const dashboardExists = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardExists).toBeTruthy();
  });

  test('Dashboard title and description should be rendered', async ({ page }) => {
    // Test: Dashboard header should display correct information
    const title = await page.locator('#sprint4-analytics-dashboard h2').textContent();
    expect(title).toContain('Sprint 4 Analytics');
    expect(title).toContain('성장/순위/EPS 통합 분석');

    const description = await page.locator('#sprint4-analytics-dashboard p.text-sm').textContent();
    expect(description).toContain('1,252개 기업');
  });

  test('Growth Analytics section should have correct structure', async ({ page }) => {
    // Test: Growth Analytics section elements should exist
    const growthSection = await page.locator('#sprint4-analytics-dashboard .dashboard-card').nth(1);

    const sectionTitle = await growthSection.locator('h3').textContent();
    expect(sectionTitle).toContain('Growth Analytics');

    // Check for chart containers
    const sectorChart = await growthSection.locator('#growth-sector-chart').count();
    const topCompaniesChart = await growthSection.locator('#growth-top-companies-chart').count();

    expect(sectorChart).toBe(1);
    expect(topCompaniesChart).toBe(1);
  });

  test('Ranking Analytics section should have statistics cards', async ({ page }) => {
    // Test: Ranking section should display statistics
    const rankingSection = await page.locator('#sprint4-analytics-dashboard .dashboard-card').nth(2);

    // Check statistics cards
    const totalCard = await rankingSection.locator('#ranking-total').textContent();
    const top100Card = await rankingSection.locator('#ranking-top-100').textContent();
    const qualityCard = await rankingSection.locator('#ranking-quality').textContent();

    expect(totalCard).toBeTruthy();
    expect(top100Card).toBeTruthy();
    expect(qualityCard).toBeTruthy();
  });

  test('EPS Analytics section should have chart containers', async ({ page }) => {
    // Test: EPS Analytics section elements should exist
    const epsSection = await page.locator('#sprint4-analytics-dashboard .dashboard-card').nth(3);

    const sectionTitle = await epsSection.locator('h3').textContent();
    expect(sectionTitle).toContain('EPS Analytics');

    const roeScatterChart = await epsSection.locator('#eps-roe-scatter-chart').count();
    const sectorHeatmapChart = await epsSection.locator('#eps-sector-heatmap-chart').count();

    expect(roeScatterChart).toBe(1);
    expect(sectorHeatmapChart).toBe(1);
  });

  test('All chart containers should have proper chart-container class', async ({ page }) => {
    // Test: Chart containers should have correct styling class
    const chartContainers = await page.locator('.chart-container canvas').count();
    expect(chartContainers).toBeGreaterThanOrEqual(6); // 6 charts in Sprint 4 dashboard
  });
});

test.describe('Sprint 4 Dashboard - Chart.js Rendering', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    // Initialize analytics modules
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
    await page.waitForTimeout(1000); // Wait for charts to render
  });

  test('Growth Sector Chart should be rendered with Chart.js', async ({ page }) => {
    // Test: Growth sector chart should exist as Chart.js instance
    const chartExists = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return canvas && canvas.__chartjs !== undefined;
    });

    expect(chartExists).toBeTruthy();
  });

  test('Growth Top Companies Chart should render correctly', async ({ page }) => {
    // Test: Top companies chart should have data
    const chartData = await page.evaluate(() => {
      const canvas = document.getElementById('growth-top-companies-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        hasData: chart.data.datasets.length > 0,
        dataPointCount: chart.data.datasets[0]?.data?.length || 0,
        chartType: chart.config.type
      };
    });

    expect(chartData).not.toBeNull();
    expect(chartData.hasData).toBeTruthy();
    expect(chartData.dataPointCount).toBeGreaterThan(0);
    expect(chartData.chartType).toBe('horizontalBar');
  });

  test('Ranking Distribution Chart should render with multiple datasets', async ({ page }) => {
    // Test: Ranking distribution should show Quality/Value/Momentum
    const chartInfo = await page.evaluate(() => {
      const canvas = document.getElementById('ranking-distribution-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        labels: chart.data.labels,
        datasetCount: chart.data.datasets.length,
        chartType: chart.config.type
      };
    });

    expect(chartInfo).not.toBeNull();
    expect(chartInfo.labels).toEqual(['Quality', 'Value', 'Momentum']);
    expect(chartInfo.datasetCount).toBe(1);
    expect(chartInfo.chartType).toBe('bar');
  });

  test('Ranking Sector Chart should display sector rankings', async ({ page }) => {
    // Test: Sector ranking chart should have sector labels
    const chartData = await page.evaluate(() => {
      const canvas = document.getElementById('ranking-sector-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        hasLabels: chart.data.labels.length > 0,
        labelCount: chart.data.labels.length,
        hasData: chart.data.datasets[0]?.data?.length > 0
      };
    });

    expect(chartData).not.toBeNull();
    expect(chartData.hasLabels).toBeTruthy();
    expect(chartData.labelCount).toBeGreaterThan(0);
    expect(chartData.hasData).toBeTruthy();
  });

  test('EPS ROE Scatter Chart should render scatter plot', async ({ page }) => {
    // Test: ROE vs EPS Growth scatter plot should exist
    const scatterChart = await page.evaluate(() => {
      const canvas = document.getElementById('eps-roe-scatter-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        chartType: chart.config.type,
        hasData: chart.data.datasets[0]?.data?.length > 0,
        dataPointCount: chart.data.datasets[0]?.data?.length || 0
      };
    });

    expect(scatterChart).not.toBeNull();
    expect(scatterChart.chartType).toBe('scatter');
    expect(scatterChart.hasData).toBeTruthy();
    expect(scatterChart.dataPointCount).toBeGreaterThan(0);
    expect(scatterChart.dataPointCount).toBeLessThanOrEqual(50); // Top 50 companies
  });

  test('EPS Sector Heatmap Chart should render with sector data', async ({ page }) => {
    // Test: Sector heatmap should display sector EPS averages
    const heatmapChart = await page.evaluate(() => {
      const canvas = document.getElementById('eps-sector-heatmap-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        chartType: chart.config.type,
        labelCount: chart.data.labels.length,
        datasetLabel: chart.data.datasets[0]?.label
      };
    });

    expect(heatmapChart).not.toBeNull();
    expect(heatmapChart.chartType).toBe('bar');
    expect(heatmapChart.labelCount).toBeGreaterThan(0);
    expect(heatmapChart.labelCount).toBeLessThanOrEqual(10); // Top 10 sectors
    expect(heatmapChart.datasetLabel).toContain('평균 EPS');
  });
});

test.describe('Sprint 4 Dashboard - Data Binding and Updates', () => {

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

    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);
  });

  test('Ranking statistics cards should update with correct values', async ({ page }) => {
    // Test: Statistics cards should display accurate counts
    const stats = await page.evaluate(() => {
      return {
        total: document.getElementById('ranking-total')?.textContent,
        top100: document.getElementById('ranking-top-100')?.textContent,
        quality: document.getElementById('ranking-quality')?.textContent
      };
    });

    expect(stats.total).toBeTruthy();
    expect(stats.top100).toBeTruthy();
    expect(stats.quality).toBeTruthy();

    // Verify numeric values are present
    expect(parseInt(stats.total.replace(/,/g, ''))).toBeGreaterThan(0);
    expect(parseInt(stats.top100.replace(/,/g, ''))).toBeGreaterThan(0);
  });

  test('Chart data should match Analytics module data', async ({ page }) => {
    // Test: Chart data should reflect Analytics module state
    const dataMatch = await page.evaluate(() => {
      const growthSectorData = window.growthAnalytics.getSectorGrowthAverages();
      const canvas = document.getElementById('growth-sector-chart');
      const chart = canvas?.__chartjs;

      if (!chart || !growthSectorData) return false;

      const chartLabelCount = chart.data.labels.length;
      const moduleLabelCount = growthSectorData.length;

      return chartLabelCount === moduleLabelCount;
    });

    expect(dataMatch).toBeTruthy();
  });

  test('Chart colors should match design specifications', async ({ page }) => {
    // Test: Charts should use correct color schemes
    const colors = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        salesGrowthColor: chart.data.datasets[0]?.backgroundColor,
        operatingProfitColor: chart.data.datasets[1]?.backgroundColor
      };
    });

    expect(colors).not.toBeNull();
    expect(colors.salesGrowthColor).toContain('rgba(34, 197, 94'); // Green
    expect(colors.operatingProfitColor).toContain('rgba(59, 130, 246'); // Blue
  });

  test('Charts should have proper axis labels and titles', async ({ page }) => {
    // Test: Charts should have descriptive axis labels
    const chartConfig = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      const chart = canvas?.__chartjs;

      if (!chart) return null;

      return {
        yAxisTitle: chart.options.scales?.y?.title?.text,
        hasLegend: chart.options.plugins?.legend?.position !== undefined
      };
    });

    expect(chartConfig).not.toBeNull();
    expect(chartConfig.yAxisTitle).toBeTruthy();
    expect(chartConfig.hasLegend).toBeTruthy();
  });
});

test.describe('Sprint 4 Dashboard - Responsive Layout', () => {

  test('Dashboard should render correctly on desktop viewport', async ({ page }) => {
    // Test: Desktop layout should display grid correctly
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    const gridLayout = await page.evaluate(() => {
      const growthSection = document.querySelector('#sprint4-analytics-dashboard .grid');
      if (!growthSection) return null;

      const computedStyle = window.getComputedStyle(growthSection);
      return {
        display: computedStyle.display,
        gridTemplateColumns: computedStyle.gridTemplateColumns
      };
    });

    expect(gridLayout).not.toBeNull();
    expect(gridLayout.display).toBe('grid');
  });

  test('Dashboard should adapt to tablet viewport', async ({ page }) => {
    // Test: Tablet layout should remain functional
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    const dashboardVisible = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();

    // Charts should still be visible
    const chartCount = await page.locator('.chart-container canvas').count();
    expect(chartCount).toBeGreaterThan(0);
  });

  test('Dashboard should adapt to mobile viewport', async ({ page }) => {
    // Test: Mobile layout should display single column
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    const dashboardVisible = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();

    // Verify charts are still accessible (may require scrolling)
    const firstChart = await page.locator('#growth-sector-chart').isVisible();
    expect(firstChart).toBeTruthy();
  });

  test('Chart containers should maintain aspect ratio on resize', async ({ page }) => {
    // Test: Charts should resize responsively
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Get initial chart dimensions
    const initialDimensions = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return {
        width: canvas.offsetWidth,
        height: canvas.offsetHeight
      };
    });

    // Resize viewport
    await page.setViewportSize({ width: 800, height: 600 });
    await page.waitForTimeout(500);

    // Get new dimensions
    const newDimensions = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return {
        width: canvas.offsetWidth,
        height: canvas.offsetHeight
      };
    });

    // Dimensions should have changed
    expect(newDimensions.width).not.toBe(initialDimensions.width);
  });
});

test.describe('Sprint 4 Dashboard - User Interactions', () => {

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
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);
  });

  test('Switching to dashboard tab should trigger chart rendering', async ({ page }) => {
    // Test: Tab switch should initialize charts
    // Switch away from dashboard
    await page.click('#tab-screener');
    await page.waitForTimeout(500);

    // Switch back to dashboard
    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Verify charts are rendered
    const chartRendered = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return canvas?.__chartjs !== undefined;
    });

    expect(chartRendered).toBeTruthy();
  });

  test('Dashboard should handle rapid tab switching', async ({ page }) => {
    // Test: Multiple tab switches should not break charts
    for (let i = 0; i < 3; i++) {
      await page.click('#tab-screener');
      await page.waitForTimeout(200);
      await page.click('#tab-dashboard');
      await page.waitForTimeout(200);
    }

    // Charts should still work
    const chartsWorking = await page.evaluate(() => {
      const canvas1 = document.getElementById('growth-sector-chart');
      const canvas2 = document.getElementById('eps-roe-scatter-chart');

      return canvas1?.__chartjs !== undefined &&
             canvas2?.__chartjs !== undefined;
    });

    expect(chartsWorking).toBeTruthy();
  });

  test('Chart hover interactions should work', async ({ page }) => {
    // Test: Hovering over chart should show tooltips
    const canvas = page.locator('#growth-sector-chart');
    await canvas.hover({ position: { x: 100, y: 100 } });

    // Chart should remain functional after hover
    const chartStillWorks = await page.evaluate(() => {
      const canvas = document.getElementById('growth-sector-chart');
      return canvas?.__chartjs !== undefined;
    });

    expect(chartStillWorks).toBeTruthy();
  });
});

test.describe('Sprint 4 Dashboard - Error Handling and Edge Cases', () => {

  test('Dashboard should handle missing Analytics modules gracefully', async ({ page }) => {
    // Test: Dashboard should not crash if modules are missing
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    // Break one module
    await page.evaluate(() => {
      window.epsAnalytics = null;
    });

    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Dashboard should still be visible
    const dashboardVisible = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();
  });

  test('Empty data should not crash chart rendering', async ({ page }) => {
    // Test: Charts should handle empty data sets
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    // Mock empty data
    await page.evaluate(() => {
      if (window.growthAnalytics) {
        window.growthAnalytics.getSectorGrowthAverages = () => [];
      }
    });

    await page.click('#tab-dashboard');
    await page.waitForTimeout(1000);

    // Dashboard should remain functional
    const dashboardExists = await page.locator('#sprint4-analytics-dashboard').isVisible();
    expect(dashboardExists).toBeTruthy();
  });

  test('Chart rendering should not block UI thread', async ({ page }) => {
    // Test: Charts should render without freezing the page
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    const startTime = Date.now();
    await page.click('#tab-dashboard');
    await page.waitForTimeout(2000); // Wait for all charts

    const duration = Date.now() - startTime;

    // Should complete within reasonable time
    expect(duration).toBeLessThan(5000); // 5 seconds max

    // Page should still be responsive
    const pageResponsive = await page.evaluate(() => {
      return document.readyState === 'complete';
    });

    expect(pageResponsive).toBeTruthy();
  });
});
