import { chromium, FullConfig } from '@playwright/test';

/**
 * Global Setup for Stock Analyzer E2E Tests
 * Runs once before all test suites
 */
async function globalSetup(config: FullConfig) {
  console.log('🚀 Starting Stock Analyzer E2E Test Suite');
  console.log(`📊 Sprint 5 Week 3 - CFO + Correlation Engine Testing`);
  console.log(`🌐 Base URL: ${config.use?.baseURL || 'http://localhost:8080'}`);

  // Create browser instance for setup tasks
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Verify application is accessible
    const baseURL = config.use?.baseURL || 'http://localhost:8080';
    console.log(`\n✓ Verifying application accessibility...`);

    await page.goto(baseURL, { timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    console.log(`✓ Application is accessible at ${baseURL}`);

    // Check for critical dependencies
    const hasChartJS = await page.evaluate(() => {
      return typeof (window as any).Chart !== 'undefined';
    });

    const hasDataLoaded = await page.evaluate(() => {
      return typeof (window as any).allData !== 'undefined';
    });

    console.log(`✓ Chart.js loaded: ${hasChartJS}`);
    console.log(`✓ Data loaded: ${hasDataLoaded}`);

    // Warmup: Pre-cache data by navigating through key pages
    console.log(`\n🔥 Warming up application cache...`);

    // Navigate to main analytics tabs
    const tabs = ['growth-tab', 'ranking-tab', 'eps-tab'];
    for (const tabId of tabs) {
      const tab = page.locator(`#${tabId}`);
      if (await tab.count() > 0) {
        await tab.click();
        await page.waitForTimeout(500); // Allow tab content to load
      }
    }

    console.log(`✓ Cache warmup complete`);

    // Store environment info for tests
    const envInfo = {
      timestamp: new Date().toISOString(),
      baseURL,
      hasChartJS,
      hasDataLoaded,
      viewport: await page.viewportSize(),
    };

    // Save to file for test access
    const fs = await import('fs/promises');

    // Ensure test-results directory exists
    try {
      await fs.mkdir('./test-results', { recursive: true });
    } catch (error) {
      // Directory may already exist, ignore error
    }

    await fs.writeFile(
      './test-results/env-info.json',
      JSON.stringify(envInfo, null, 2)
    );

    console.log(`\n✅ Global setup completed successfully`);
  } catch (error) {
    console.error(`\n❌ Global setup failed:`, error);
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

export default globalSetup;
