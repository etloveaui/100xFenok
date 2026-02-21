/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const includeIframeRoutes = process.env.QA_A11Y_INCLUDE_IFRAME_ROUTES === "1";
const strictMode = process.env.QA_A11Y_STRICT === "1";

const routes = (
  process.env.QA_A11Y_ROUTES ||
  "/,/posts,/vr,/tools/stock-analyzer/native,/market,/alpha-scout,/ib"
)
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const viewportCatalog = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
  tablet: { width: 1024, height: 1366 },
  fold: { width: 540, height: 720 },
};

const requestedViewports = (
  process.env.QA_A11Y_VIEWPORTS || "desktop,mobile,fold"
)
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

const viewports = requestedViewports
  .map((name) => ({ name, viewport: viewportCatalog[name] }))
  .filter((entry) => !!entry.viewport);

if (routes.length === 0) {
  throw new Error("No QA_A11Y_ROUTES configured.");
}

if (viewports.length === 0) {
  throw new Error("No valid QA_A11Y_VIEWPORTS configured.");
}

function compactViolations(violations) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    description: violation.description,
    help: violation.help,
    nodeCount: violation.nodes?.length ?? 0,
    sampleTargets: (violation.nodes ?? [])
      .slice(0, 3)
      .map((node) => (Array.isArray(node.target) ? node.target.join(" ") : "")),
  }));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const { name, viewport } of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    for (const route of routes) {
      const url = `${baseUrl}${route}`;
      const record = {
        viewport: name,
        route,
        status: null,
        scanned: false,
        skippedReason: null,
        violations: [],
        seriousOrCriticalCount: 0,
      };

      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        record.status = response ? response.status() : null;
      } catch (error) {
        record.skippedReason = `navigation_error: ${String(error)}`;
        results.push(record);
        continue;
      }

      const iframeCount = await page.locator("iframe").count();
      if (iframeCount > 0 && !includeIframeRoutes) {
        record.skippedReason = "iframe_route_skipped";
        results.push(record);
        continue;
      }

      const analysis = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .analyze();

      record.scanned = true;
      record.violations = compactViolations(analysis.violations);
      record.seriousOrCriticalCount = analysis.violations.filter((violation) =>
        violation.impact === "serious" || violation.impact === "critical",
      ).length;

      results.push(record);
    }

    await context.close();
  }

  await browser.close();

  const scannedResults = results.filter((result) => result.scanned);
  const failingResults = scannedResults.filter(
    (result) => result.seriousOrCriticalCount > 0,
  );

  const summary = {
    total: results.length,
    scanned: scannedResults.length,
    skipped: results.length - scannedResults.length,
    failing: failingResults.length,
    includeIframeRoutes,
    strictMode,
    results,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (strictMode && failingResults.length > 0) {
    process.exit(1);
  }
})();
