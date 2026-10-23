import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const isCI = Boolean(process.env.CI);
const isLiveObservation = process.env.SUITE === "live";
const visualPort = process.env.QA_VISUAL_PORT ?? process.env.PORT ?? "3107";
const baseURL = process.env.QA_BASE_URL ?? `http://127.0.0.1:${visualPort}`;
const shouldStartServer = !process.env.QA_BASE_URL;
const localChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const chromiumExecutablePath =
  process.env.QA_CHROME_PATH ?? (!isCI && fs.existsSync(localChromePath) ? localChromePath : undefined);

// Load the existing ESM helper natively; Playwright's CJS transform cannot
// evaluate its import.meta CLI guard through a static TS import.
export default (async () => {
const { liveRequestHeaders } = await import("../scripts/lib/live-request-headers.mjs");
return defineConfig({
  testDir: "tests/visual",
  timeout: 45_000,
  outputDir: "test-results/visual",
  preserveOutput: isLiveObservation ? "always" : "failures-only",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isLiveObservation ? 0 : isCI ? 1 : 0,
  failOnFlakyTests: isCI,
  workers: 1,
  reporter: [
    ["dot"],
    ["html", { outputFolder: "playwright-report/visual", open: "never" }],
    ["json", { outputFile: "test-results/visual/results.json" }],
  ],
  snapshotPathTemplate: "qa-baselines/visual/v6/{projectName}/{arg}{ext}",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      stylePath: ["tests/visual/screenshot.css"],
      threshold: 0.12,
      maxDiffPixels: 80,
    },
  },
  use: {
    baseURL,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
    trace: isLiveObservation ? "off" : "retain-on-failure",
    screenshot: isLiveObservation ? "off" : "only-on-failure",
    video: "off",
    // Live observations add this header through a same-origin route only.
    extraHTTPHeaders: isLiveObservation ? {} : liveRequestHeaders(),
    launchOptions: {
      args: ["--hide-scrollbars", "--disable-features=Translate"],
      ...(chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {}),
    },
  },
  projects: isLiveObservation ? [{
    name: "live-observation",
    testMatch: "live-observation.spec.ts",
    use: { browserName: "chromium", deviceScaleFactor: 1 },
  }] : [
    {
      name: "desktop-1440",
      testIgnore: "live-observation.spec.ts",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: "mobile-390",
      testIgnore: "live-observation.spec.ts",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: shouldStartServer
    ? {
        command: `npm run start -- --hostname 127.0.0.1 --port ${visualPort}`,
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
        env: {
          FENOK_LOCAL_PROD_QA: "1",
        },
      }
    : undefined,
});
})();
