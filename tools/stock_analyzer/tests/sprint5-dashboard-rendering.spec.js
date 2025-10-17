/**
 * Sprint 5: Dashboard Rendering E2E Tests
 *
 * Purpose: Test Sprint 5 dashboard UI rendering (HTML +99, JS +330 lines)
 * Tests: 15+ comprehensive test cases
 * Coverage: HTML structure, statistics cards, Chart.js canvases, responsive design
 */

import { test, expect } from '@playwright/test';

test.describe('Sprint 5 Dashboard - HTML Structure', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('Sprint 5 Analytics dashboard section should exist', async ({ page }) => {
    const dashboardExists = await page.locator('#sprint5-analytics-dashboard').count();
    expect(dashboardExists).toBeGreaterThan(0);
  });

  test('Cash Flow Analytics section should exist', async ({ page }) => {
    const sectionVisible = await page.locator('text=Cash Flow Analytics').isVisible();
    expect(sectionVisible).toBeTruthy();
  });

  test('Correlation Analytics section should exist', async ({ page }) => {
    const sectionVisible = await page.locator('text=Correlation Analytics').isVisible();
    expect(sectionVisible).toBeTruthy();
  });

  test('Sprint 5 dashboard should have correct heading', async ({ page }) => {
    const heading = await page.locator('text=Sprint 5 Analytics - 현금흐름 & 상관관계 분석').textContent();
    expect(heading).toContain('Sprint 5 Analytics');
  });
});

test.describe('Sprint 5 Dashboard - CFO Statistics Cards', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000); // Wait for data and rendering
  });

  test('CFO Total Companies card should display count', async ({ page }) => {
    const totalElement = await page.locator('#cfo-total');
    const count = await totalElement.count();
    expect(count).toBeGreaterThan(0);

    const text = await totalElement.textContent();
    expect(text).toMatch(/\d{1,3}(,\d{3})*/); // Number with comma formatting
  });

  test('CFO Positive FCF card should display count', async ({ page }) => {
    const positiveElement = await page.locator('#cfo-positive');
    const count = await positiveElement.count();
    expect(count).toBeGreaterThan(0);

    const text = await positiveElement.textContent();
    expect(text).toMatch(/\d{1,3}(,\d{3})*/);
  });

  test('CFO Average CCC card should display value', async ({ page }) => {
    const cccElement = await page.locator('#cfo-avg-ccc');
    const count = await cccElement.count();
    expect(count).toBeGreaterThan(0);

    const text = await cccElement.textContent();
    expect(text).toMatch(/\d+/); // Should contain numeric value
  });

  test('All CFO statistics cards should be visible', async ({ page }) => {
    const cards = ['#cfo-total', '#cfo-positive', '#cfo-avg-ccc'];

    for (const cardId of cards) {
      const isVisible = await page.locator(cardId).isVisible();
      expect(isVisible).toBeTruthy();
    }
  });
});

test.describe('Sprint 5 Dashboard - Correlation Statistics Cards', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
  });

  test('Correlation Total Companies card should display count', async ({ page }) => {
    const totalElement = await page.locator('#corr-total');
    const count = await totalElement.count();
    expect(count).toBeGreaterThan(0);

    const text = await totalElement.textContent();
    expect(text).toMatch(/\d{1,3}(,\d{3})*/);
  });

  test('Correlation Low Pairs card should display count', async ({ page }) => {
    const pairsElement = await page.locator('#corr-low-pairs');
    const count = await pairsElement.count();
    expect(count).toBeGreaterThan(0);

    const text = await pairsElement.textContent();
    expect(text).toMatch(/\d{1,3}(,\d{3})*/);
  });

  test('Correlation Clusters card should display count', async ({ page }) => {
    const clustersElement = await page.locator('#corr-clusters');
    const count = await clustersElement.count();
    expect(count).toBeGreaterThan(0);

    const text = await clustersElement.textContent();
    expect(text).toMatch(/\d+/);
  });

  test('All Correlation statistics cards should be visible', async ({ page }) => {
    const cards = ['#corr-total', '#corr-low-pairs', '#corr-clusters'];

    for (const cardId of cards) {
      const isVisible = await page.locator(cardId).isVisible();
      expect(isVisible).toBeTruthy();
    }
  });
});

test.describe('Sprint 5 Dashboard - Chart.js Canvases', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
  });

  test('CFO Sector Heatmap canvas should exist', async ({ page }) => {
    const canvasExists = await page.locator('#cfo-sector-heatmap-chart').count();
    expect(canvasExists).toBeGreaterThan(0);
  });

  test('CFO Top Companies canvas should exist', async ({ page }) => {
    const canvasExists = await page.locator('#cfo-top-companies-chart').count();
    expect(canvasExists).toBeGreaterThan(0);
  });

  test('CFO vs ROE Scatter canvas should exist', async ({ page }) => {
    const canvasExists = await page.locator('#cfo-roe-scatter-chart').count();
    expect(canvasExists).toBeGreaterThan(0);
  });

  test('Correlation Heatmap canvas should exist', async ({ page }) => {
    const canvasExists = await page.locator('#corr-heatmap-chart').count();
    expect(canvasExists).toBeGreaterThan(0);
  });

  test('Correlation Sector canvas should exist', async ({ page }) => {
    const canvasExists = await page.locator('#corr-sector-chart').count();
    expect(canvasExists).toBeGreaterThan(0);
  });

  test('Correlation Cluster Scatter canvas should exist', async ({ page }) => {
    const canvasExists = await page.locator('#corr-cluster-scatter-chart').count();
    expect(canvasExists).toBeGreaterThan(0);
  });

  test('All 6 chart canvases should be present', async ({ page }) => {
    const canvases = [
      '#cfo-sector-heatmap-chart',
      '#cfo-top-companies-chart',
      '#cfo-roe-scatter-chart',
      '#corr-heatmap-chart',
      '#corr-sector-chart',
      '#corr-cluster-scatter-chart'
    ];

    for (const canvasId of canvases) {
      const count = await page.locator(canvasId).count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

test.describe('Sprint 5 Dashboard - Chart Rendering', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(4000); // Wait for charts to render
  });

  test('CFO charts should have Chart.js instances', async ({ page }) => {
    const hasChartInstances = await page.evaluate(() => {
      const canvases = [
        document.getElementById('cfo-sector-heatmap-chart'),
        document.getElementById('cfo-top-companies-chart'),
        document.getElementById('cfo-roe-scatter-chart')
      ];

      return canvases.every(canvas => {
        if (!canvas) return false;
        // Check if canvas has Chart.js instance attached
        return canvas.__chart__ !== undefined || canvas.chart !== undefined;
      });
    });

    expect(hasChartInstances).toBeTruthy();
  });

  test('Correlation charts should have Chart.js instances', async ({ page }) => {
    const hasChartInstances = await page.evaluate(() => {
      const canvases = [
        document.getElementById('corr-heatmap-chart'),
        document.getElementById('corr-sector-chart'),
        document.getElementById('corr-cluster-scatter-chart')
      ];

      return canvases.every(canvas => {
        if (!canvas) return false;
        return canvas.__chart__ !== undefined || canvas.chart !== undefined;
      });
    });

    expect(hasChartInstances).toBeTruthy();
  });

  test('renderSprint5Analytics function should exist', async ({ page }) => {
    const functionExists = await page.evaluate(() => {
      return typeof window.renderSprint5Analytics === 'function';
    });

    expect(functionExists).toBeTruthy();
  });

  test('renderCFOAnalyticsCharts function should exist', async ({ page }) => {
    const functionExists = await page.evaluate(() => {
      return typeof window.renderCFOAnalyticsCharts === 'function';
    });

    expect(functionExists).toBeTruthy();
  });

  test('renderCorrelationAnalyticsCharts function should exist', async ({ page }) => {
    const functionExists = await page.evaluate(() => {
      return typeof window.renderCorrelationAnalyticsCharts === 'function';
    });

    expect(functionExists).toBeTruthy();
  });
});

test.describe('Sprint 5 Dashboard - Responsive Design', () => {

  test('Dashboard should be visible on desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    const dashboardVisible = await page.locator('#sprint5-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();
  });

  test('Dashboard should be visible on tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    const dashboardVisible = await page.locator('#sprint5-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();
  });

  test('Dashboard should be visible on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/stock_analyzer.html');
    await page.waitForLoadState('networkidle');

    const dashboardVisible = await page.locator('#sprint5-analytics-dashboard').isVisible();
    expect(dashboardVisible).toBeTruthy();
  });
});
