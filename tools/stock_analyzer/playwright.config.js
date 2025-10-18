/**
 * Playwright Configuration for Sprint 4 E2E Tests
 * Stock Analyzer - 100xFenok Project
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  // Global setup and teardown
  globalSetup: './tests/global-setup.ts',
  globalTeardown: './tests/global-teardown.ts',

  // Timeout configuration
  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000 // 10 seconds for assertions
  },

  // Test execution settings
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],

  // Global test setup
  use: {
    // Base URL for tests
    baseURL: 'http://localhost:8080',

    // Browser context options
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Viewport
    viewport: { width: 1280, height: 720 },

    // Timeouts
    actionTimeout: 15000,
    navigationTimeout: 30000
  },

  // Test projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    // Mobile viewports
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },

    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 12'] },
    },
  ],

  // Development server configuration
  webServer: {
    command: 'npx http-server -p 8080',
    port: 8080,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
