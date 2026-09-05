import { chromium, webkit } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const isolated = process.env.QA_MOBILE_UX_ISOLATED === "1";
const isolatedOrigin = new URL(baseUrl).origin;
if (isolated && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(baseUrl).hostname)) {
  throw new Error("Isolated QA requires a loopback preview, never production.");
}
const blockedExternalRequests = [];
const strictMode = process.env.QA_MOBILE_UX_STRICT !== "0";
const browserChannel = process.env.QA_BROWSER_CHANNEL || "";
const browserExecutablePath = process.env.QA_CHROMIUM_EXECUTABLE_PATH || "";
const browserName = process.env.QA_BROWSER_NAME || "chromium";
if (!["chromium", "webkit"].includes(browserName)) {
  throw new Error("QA_BROWSER_NAME must be chromium or webkit.");
}
if (browserName === "webkit" && (browserChannel || browserExecutablePath)) {
  throw new Error("Chromium channel/executable overrides cannot be used with WebKit.");
}
const outputDir = process.env.QA_MOBILE_UX_OUTPUT_DIR?.trim()
  ? resolve(process.env.QA_MOBILE_UX_OUTPUT_DIR.trim())
  : "";
const routes = (process.env.QA_MOBILE_UX_ROUTES || "/,/?v5=1,/macro-chart,/multichart,/ib,/infinite-buying,/vr,/admin/data-console,/admin/data-lab,/radar,/radar?path=tools%2Fmacro-monitor%2Fdetails%2Fliquidity-flow.html,/market-valuation,/market-valuation/structure,/regime,/market/events,/changes,/etfs,/etfs/SPY,/etfs/new,/etfs/compare,/screener,/screener?mode=analyze,/sectors,/portfolio,/stock/NVDA,/stock/NVDA?tab=financials,/stock/NVDA?tab=ownership,/stock/NVDA?tab=estimates,/stock/NVDA?tab=filings,/superinvestors,/superinvestors?tab=investors,/superinvestors?guru=blackrock")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const viewportCatalog = {
  mobile: { width: 390, height: 844 },
  narrow: { width: 375, height: 812 },
  "tablet-portrait": { width: 768, height: 1024 },
  "tablet-mid": { width: 820, height: 1180 },
  tablet: { width: 1024, height: 1366 },
  "tablet-landscape": { width: 1180, height: 820 },
  desktop: { width: 1280, height: 900 },
  wide: { width: 1440, height: 900 },
};

const requestedViewports = (process.env.QA_MOBILE_UX_VIEWPORTS || "mobile,narrow")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);

const viewports = requestedViewports
  .map((name) => ({ name, viewport: viewportCatalog[name] }))
  .filter((entry) => entry.viewport);

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

function isAnalyzeScreenerRoute(route) {
  return new URL(route, baseUrl).searchParams.get("mode") === "analyze";
}

async function installQaPortfolio(context) {
  await context.addInitScript(() => {
    const doc = {
      version: 1,
      updated_at: "2026-06-24T00:00:00.000Z",
      portfolios: [
        {
          id: "qa-mobile",
          name: "QA 모바일",
          currency: "USD",
          cash: 1250,
          holdings: [
            { ticker: "NVDA", shares: 3, avg_cost: 96.1 },
            { ticker: "AAPL", shares: 5, avg_cost: 198.4 },
          ],
        },
      ],
    };
    window.localStorage.setItem("fenok.portfolio.v1", JSON.stringify(doc));
  });
}

async function prepareMacroChartRoute(page, route) {
  const pathname = new URL(route, baseUrl).pathname.replace(/\/+$/, "") || "/";
  if (pathname !== "/macro-chart" && pathname !== "/multichart") return;

  await page.locator("[data-macro-chart-workbench]").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("[data-macro-chart-workbench] canvas").waitFor({ state: "visible", timeout: 45_000 });

  const seriesEditor = page.locator('details[data-macro-chart-series-editor="true"]');
  if ((await seriesEditor.getAttribute("open")) === null) {
    await seriesEditor.locator("summary").click();
  }
  const connectionEditor = page.locator('details[data-macro-chart-connection-editor="true"]');
  if ((await connectionEditor.getAttribute("open")) === null) {
    await connectionEditor.locator("summary").click();
  }
  await page.waitForTimeout(200);
}

async function prepareDynamicRoute(page, route) {
  await prepareMacroChartRoute(page, route);
  const pathname = new URL(route, baseUrl).pathname.replace(/\/+$/, "") || "/";

  const readySelectors = {
    // The mobile list is hidden above 760px; include the desktop table so
    // tablet runs wait on the surface that is actually rendered.
    "/etfs": ".etf-mobile-card, .etf-table-desktop",
    "/market-valuation": ".mv-trow",
    "/regime": "[data-regime-axis-summary-card]",
    "/portfolio": '[data-portfolio-section="holdings"] button[aria-label$="삭제"]',
    "/sectors": "[data-sectors-flow-rows]",
  };
  const readySelector = readySelectors[pathname];
  if (readySelector) {
    await page.locator(readySelector).filter({ visible: true }).first().waitFor({ state: "visible", timeout: 45_000 });
  }

  if (pathname === "/etfs") {
    const filterDetails = page.locator("details").filter({ has: page.locator(".etf-filter-grid") }).first();
    if ((await filterDetails.count()) > 0 && (await filterDetails.getAttribute("open")) === null) {
      await filterDetails.locator("summary").click();
    }
    await page.locator(".etf-filter-field select:visible").first().waitFor({ state: "visible", timeout: 10_000 });
  }

  if (pathname.startsWith("/stock/") && route.includes("tab=ownership")) {
    await page.locator('[data-stock-tab-card="ownership-guru"]:visible').first().waitFor({ state: "visible", timeout: 45_000 });
  }
  if (pathname.startsWith("/stock/") && route.includes("tab=filings")) {
    await page.locator('[data-stock-tab-card="filings"]:visible').first().waitFor({ state: "visible", timeout: 45_000 });
  }
  if (pathname.startsWith("/stock/") && route.includes("tab=estimates")) {
    const estimateDetails = page.locator("details").filter({ has: page.locator('[data-stock-estimates-granularity="quarterly"]') }).first();
    if ((await estimateDetails.count()) > 0 && (await estimateDetails.getAttribute("open")) === null) {
      await estimateDetails.locator("summary").click();
    }
    await page.locator('[data-stock-estimates-granularity="quarterly"]:visible').first().waitFor({ state: "visible", timeout: 45_000 });
  }
  if (pathname === "/superinvestors") {
    await page.locator("[data-superinvestors-surface]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    // V3 default tab is signal (?guru= opens the dedicated guru detail view,
    // ?tab=investors opens the holders list).
    if (route.includes("guru=")) {
      await page.locator("[data-superinvestors-guru-detail-view]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
      // the holdings surface mounts after the detail fetch: wait on the guru
      // top-holdings block itself, never on an unscoped scroll region (the tab
      // strip is also a scroll-hint region and would satisfy a bare wait).
      await page.locator("[data-superinvestor-guru-top-holdings]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
      await page.locator("[data-superinvestor-guru-holding-row]:visible, [data-superinvestor-guru-desktop-holding-row]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    } else if (route.includes("tab=stocks")) {
      await page.locator("[data-superinvestors-whoholds-input]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    } else if (route.includes("tab=investors")) {
      await page.locator("[data-superinvestors-holder-row]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    } else if (route.includes("tab=trades")) {
      await page.locator("[data-superinvestor-trades-panel]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
      await page.locator("[data-superinvestor-trades-row]:visible, [data-superinvestor-trades-region] tbody tr:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    } else if (route.includes("tab=insights")) {
      await page.locator("[data-superinvestor-insights-status]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    } else if (route.includes("tab=graph")) {
      await page.locator("[data-superinvestors-graph]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    } else {
      await page.locator("[data-superinvestors-signal-row]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
    }
  }
  if (pathname === "/superinvestors" && route.includes("guru=")) {
    await page.locator("[data-superinvestors-holder-detail]:visible").first().waitFor({ state: "visible", timeout: 45_000 });
  }
}

function routeArtifactSlug(route) {
  const url = new URL(route, baseUrl);
  const value = `${url.pathname}${url.search}`
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "home";
}

async function captureBoundedScreenshots(page, route, viewportName, routeIndex) {
  if (!outputDir) return null;

  const routeDir = join(
    outputDir,
    viewportName,
    `route-${String(routeIndex + 1).padStart(2, "0")}-${routeArtifactSlug(route)}`,
  );
  await mkdir(routeDir, { recursive: true });

  const metrics = await page.evaluate(() => ({
    scrollHeight: Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
    viewportHeight: window.innerHeight,
  })).catch(() => ({ scrollHeight: 0, viewportHeight: 0 }));
  const bottom = Math.max(0, metrics.scrollHeight - metrics.viewportHeight);
  const evidenceTarget = isolated && route.includes("guru=")
    ? "[data-superinvestor-guru-top-holdings]"
    : isolated && route.includes("tab=trades")
      ? '[data-superinvestor-trades-panel][data-superinvestor-trades-side="bought"]'
      : null;
  const focusedMiddle = evidenceTarget ? await page.locator(evidenceTarget).first().evaluate((node) => {
    const inner = node.querySelector("[data-journey-holdings-scroll]");
    if (inner) inner.scrollTop = 0;
    return Math.max(0, node.getBoundingClientRect().top + window.scrollY - 120);
  }).catch(() => null) : null;
  const positions = [
    ["top", 0],
    ["middle", focusedMiddle ?? Math.max(0, Math.round(bottom / 2))],
    ["bottom", bottom],
  ];
  const screenshots = {};
  const errors = [];

  for (const [label, scrollY] of positions) {
    const screenshotPath = join(routeDir, `${label}.png`);
    try {
      await page.evaluate((nextScrollY) => window.scrollTo({ top: nextScrollY, left: 0, behavior: "instant" }), scrollY);
      await page.waitForTimeout(100);
      await page.screenshot({ path: screenshotPath, animations: "disabled" });
      screenshots[label] = screenshotPath;
    } catch (error) {
      errors.push({ label, detail: String(error) });
    }
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  return { paths: screenshots, errors };
}

async function collectRouteChecks(page, route) {
  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );

    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    const tabbar = document.querySelector(".fnk-shell .tabbar");
    if (viewportWidth < 768 && tabbar) {
      const tabs = Array.from(tabbar.querySelectorAll(".tab"))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (tabs.length !== 5) {
        failures.push({ check: "mobile-tab-count", detail: `visible tabs=${tabs.length}` });
      }
      const actualTabs = tabs.map((tab) => {
        const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
        const label = (tab.textContent || "").replace(/\s+/g, " ").trim();
        const href = tab instanceof HTMLAnchorElement ? normalizePath(new URL(tab.href, window.location.origin).pathname) : null;
        return { label, path: href };
      });
      const expected = [
        { label: "홈", path: "/" },
        { label: "시장", path: "/market-valuation" },
        { label: "스크리너", path: "/screener" },
        { label: "포트폴리오", path: "/portfolio" },
        { label: "더보기", path: null },
      ];
      const tabContractOk =
        actualTabs.length === expected.length &&
        expected.every((tab, index) => actualTabs[index]?.label === tab.label && actualTabs[index]?.path === tab.path);
      if (!tabContractOk) {
        failures.push({
          check: "mobile-tab-primary-ia",
          detail: `actual=${JSON.stringify(actualTabs)} expected=${JSON.stringify(expected)}`,
        });
      }
      tabs.forEach((tab, index) => {
        const style = window.getComputedStyle(tab);
        const fontSize = Number.parseFloat(style.fontSize || "0");
        const rect = tab.getBoundingClientRect();
        if (fontSize < 11) {
          failures.push({ check: "mobile-tab-font", detail: `tab ${index} font=${fontSize}` });
        }
        if (rect.height < 44) {
          failures.push({ check: "mobile-tab-target", detail: `tab ${index} height=${rect.height}` });
        }
      });
    }

    if (viewportWidth < 768) {
      const railButtons = Array.from(document.querySelectorAll("button"))
        .filter((node) => {
          const label = (node.textContent || "").trim();
          return label === "증거 보기" || label === "지금 재시도";
        })
        .filter((node) => node.getBoundingClientRect().width > 0);
      railButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "evidence-rail-button-target", detail: `button ${index} height=${Math.round(rect.height)}` });
        }
        const row = node.parentElement;
        if (row && row.scrollWidth > row.clientWidth + 1) {
          failures.push({ check: "evidence-rail-no-clip", detail: `button ${index} scroll=${row.scrollWidth} client=${row.clientWidth}` });
        }
      });
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/explore") {
      const surface = document.querySelector("[data-explore-surface]");
      const routeRail = document.querySelector("[data-explore-route-rail]");
      const routeCount = document.querySelector("[data-explore-route-count]");
      const routeSteps = Array.from(document.querySelectorAll("[data-explore-route-step]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const gateway = document.querySelector("[data-explore-gateway]");
      const ownerLinks = Array.from(document.querySelectorAll("[data-explore-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeTab = document.querySelector('.fnk-shell .tabbar .tab[aria-current="page"]');

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "explore-surface-visible", detail: "missing explore surface marker" });
      }

      if (!routeRail || routeRail.getBoundingClientRect().height <= 0) {
        failures.push({ check: "explore-route-rail-visible", detail: "missing visible explore route rail" });
      }

      const ownerRouteCount = Number.parseInt(routeRail?.getAttribute("data-explore-owner-route-count") || "", 10);
      if (ownerRouteCount !== 7 || !(routeCount?.textContent || "").includes("7")) {
        failures.push({
          check: "explore-route-owner-count",
          detail: `attr=${routeRail?.getAttribute("data-explore-owner-route-count") || "missing"} text=${routeCount?.textContent || ""}`,
        });
      }

      const expectedRouteSteps = ["01", "02", "03"];
      const actualRouteSteps = routeSteps.map((node) => node.getAttribute("data-explore-route-step-index"));
      if (
        routeSteps.length !== expectedRouteSteps.length ||
        !expectedRouteSteps.every((step, index) => actualRouteSteps[index] === step)
      ) {
        failures.push({
          check: "explore-route-step-order",
          detail: `actual=${JSON.stringify(actualRouteSteps)} expected=${JSON.stringify(expectedRouteSteps)}`,
        });
      }

      routeSteps.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "explore-route-step-target", detail: `step ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!gateway || gateway.getBoundingClientRect().height <= 0) {
        failures.push({ check: "explore-gateway-visible", detail: "missing visible explore gateway" });
      }

      const expectedLinks = [
        "/market-valuation",
        "/sectors",
        "/etfs",
        "/screener",
        "/superinvestors",
        "/portfolio",
        "/macro-chart",
      ];
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((href, index) => actualLinks[index] === href)
      ) {
        failures.push({
          check: "explore-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }

      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "explore-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const activeTabLabel = (activeTab?.textContent || "").replace(/\s+/g, " ").trim();
      const activeTabPath = activeTab instanceof HTMLAnchorElement ? normalizePath(new URL(activeTab.href, window.location.origin).pathname) : "";
      if (activeTabLabel !== "홈" || activeTabPath !== "/") {
        failures.push({
          check: "explore-mobile-tab-active",
          detail: `label=${activeTabLabel} path=${activeTabPath}`,
        });
      }

      if ((appTitle?.textContent || "").trim() !== "홈") {
        failures.push({ check: "explore-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (currentRoute.startsWith("/workbench")) {
      const routeRail = document.querySelector("[data-workbench-route-rail]");
      const routeCount = document.querySelector("[data-workbench-route-count]");
      const routeSteps = Array.from(document.querySelectorAll("[data-workbench-route-step]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const gateway = document.querySelector("[data-workbench-gateway]");
      const ownerLinks = Array.from(document.querySelectorAll("[data-workbench-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

      if (!routeRail || routeRail.getBoundingClientRect().height <= 0) {
        failures.push({ check: "workbench-route-rail-visible", detail: "missing visible route rail" });
      }

      const ownerRouteCount = Number.parseInt(routeRail?.getAttribute("data-workbench-owner-route-count") || "", 10);
      if (ownerRouteCount !== 7 || !(routeCount?.textContent || "").includes("7")) {
        failures.push({
          check: "workbench-route-owner-count",
          detail: `attr=${routeRail?.getAttribute("data-workbench-owner-route-count") || "missing"} text=${routeCount?.textContent || ""}`,
        });
      }

      const expectedRouteSteps = ["01", "02", "03"];
      const actualRouteSteps = routeSteps.map((node) => node.getAttribute("data-workbench-route-step-index"));
      if (
        routeSteps.length !== expectedRouteSteps.length ||
        !expectedRouteSteps.every((step, index) => actualRouteSteps[index] === step)
      ) {
        failures.push({
          check: "workbench-route-step-order",
          detail: `actual=${JSON.stringify(actualRouteSteps)} expected=${JSON.stringify(expectedRouteSteps)}`,
        });
      }

      routeSteps.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "workbench-route-step-target", detail: `step ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!gateway || gateway.getBoundingClientRect().height <= 0) {
        failures.push({ check: "workbench-gateway-visible", detail: "missing visible workbench gateway" });
      }

      const expectedLinks = [
        "/market-valuation",
        "/sectors",
        "/etfs",
        "/screener",
        "/superinvestors",
        "/portfolio",
        "/macro-chart",
      ];
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((href, index) => actualLinks[index] === href)
      ) {
        failures.push({
          check: "workbench-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }

      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "workbench-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/macro-chart") {
      const surface = document.querySelector("[data-macro-chart-surface]");
      const workbench = document.querySelector("[data-macro-chart-workbench]");
      const header = document.querySelector("[data-macro-chart-hero]");
      const chartCanvas = document.querySelector("canvas");
      const presetButtons = Array.from(document.querySelectorAll("[data-macro-chart-preset]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const lensButtons = Array.from(document.querySelectorAll("[data-macro-chart-lens]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const marketLensButtons = Array.from(document.querySelectorAll("[data-macro-chart-market-lens]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const contextLinks = Array.from(document.querySelectorAll("[data-macro-chart-context-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const connectionLinks = Array.from(document.querySelectorAll("[data-macro-chart-connection-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const pickerToggle = document.querySelector('[data-macro-chart-series-editor] summary');
      const formulaControls = Array.from(document.querySelectorAll("[data-macro-chart-formula-control]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const mobileStatus = document.querySelector("[data-macro-chart-verdict]");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "macro-chart-surface-visible", detail: "missing macro chart surface" });
      }
      if (!workbench || workbench.getBoundingClientRect().height <= 0) {
        failures.push({ check: "macro-chart-workbench-visible", detail: "missing macro chart workbench" });
      }
      if (!header || header.getBoundingClientRect().height <= 0) {
        failures.push({ check: "macro-chart-header-visible", detail: "missing macro chart header" });
      }
      if (!chartCanvas || chartCanvas.getBoundingClientRect().width < 260 || chartCanvas.getBoundingClientRect().height < 240) {
        const rect = chartCanvas?.getBoundingClientRect();
        failures.push({ check: "macro-chart-canvas-visible", detail: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "missing canvas" });
      }

      const expectedPresets = ["risk-liquidity", "liquidity", "activity"];
      const actualPresets = presetButtons.map((node) => node.getAttribute("data-macro-chart-preset"));
      if (
        presetButtons.length !== expectedPresets.length ||
        !expectedPresets.every((preset, index) => actualPresets[index] === preset)
      ) {
        failures.push({ check: "macro-chart-preset-order", detail: `actual=${JSON.stringify(actualPresets)} expected=${JSON.stringify(expectedPresets)}` });
      }
      presetButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-preset-target", detail: `preset ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (viewportWidth < 1280 && (!mobileStatus || mobileStatus.getBoundingClientRect().height <= 0)) {
        failures.push({ check: "macro-chart-mobile-status-visible", detail: "missing mobile status rail" });
      }

      if (lensButtons.length < 3) {
        failures.push({ check: "macro-chart-lens-count", detail: `lenses=${lensButtons.length}` });
      }
      lensButtons.slice(0, 3).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-lens-target", detail: `lens ${index} height=${Math.round(rect.height)}` });
        }
      });
      if (marketLensButtons.length < 3) {
        failures.push({ check: "macro-chart-market-lens-count", detail: `lenses=${marketLensButtons.length}` });
      }
      marketLensButtons.slice(0, 3).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-market-lens-target", detail: `lens ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedContextLinks = ["screener", "etf", "stock"];
      const actualContextLinks = contextLinks.map((node) => node.getAttribute("data-macro-chart-context-link"));
      if (
        contextLinks.length !== expectedContextLinks.length ||
        !expectedContextLinks.every((link, index) => actualContextLinks[index] === link)
      ) {
        failures.push({ check: "macro-chart-context-link-order", detail: `actual=${JSON.stringify(actualContextLinks)} expected=${JSON.stringify(expectedContextLinks)}` });
      }
      contextLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-context-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });
      if (connectionLinks.length < 2) {
        failures.push({ check: "macro-chart-connection-link-count", detail: `links=${connectionLinks.length}` });
      }
      connectionLinks.slice(0, 3).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-connection-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (viewportWidth < 1280) {
        if (!pickerToggle || pickerToggle.getBoundingClientRect().height < 44) {
          failures.push({ check: "macro-chart-picker-toggle-target", detail: pickerToggle ? `height=${Math.round(pickerToggle.getBoundingClientRect().height)}` : "missing picker toggle" });
        }
      }
      const actualFormulaControls = formulaControls.map((node) => node.getAttribute("data-macro-chart-formula-control"));
      const expectedFormulaControls = ["left", "operator", "right", "add"];
      if (
        formulaControls.length !== expectedFormulaControls.length ||
        !expectedFormulaControls.every((control, index) => actualFormulaControls[index] === control)
      ) {
        failures.push({ check: "macro-chart-formula-control-order", detail: `actual=${JSON.stringify(actualFormulaControls)} expected=${JSON.stringify(expectedFormulaControls)}` });
      }
      formulaControls.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-formula-control-target", detail: `control ${index} height=${Math.round(rect.height)}` });
        }
      });
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/multichart") {
      const surface = document.querySelector("[data-multichart-surface]");
      const workbench = document.querySelector("[data-multichart-workbench]");
      const header = document.querySelector("[data-macro-chart-hero]");
      const chartCanvas = document.querySelector("canvas");
      const marketLensButtons = Array.from(document.querySelectorAll("[data-macro-chart-market-lens]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const symbolInput = document.querySelector("[data-macro-chart-symbol-input]");
      const symbolAdd = document.querySelector("[data-macro-chart-symbol-add]");
      const mobileStatus = document.querySelector("[data-macro-chart-verdict]");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "multichart-surface-visible", detail: "missing multichart surface" });
      }
      if (!workbench || workbench.getAttribute("data-multichart-mode") !== "stock-compare") {
        failures.push({
          check: "multichart-stock-compare-mode",
          detail: `mode=${workbench?.getAttribute("data-multichart-mode") || "missing"}`,
        });
      }
      if (!header || header.getBoundingClientRect().height <= 0 || !(header.textContent || "").includes("시장 비교")) {
        failures.push({ check: "multichart-header-visible", detail: "missing visible 시장 비교 header" });
      }
      if (!chartCanvas || chartCanvas.getBoundingClientRect().width < 260 || chartCanvas.getBoundingClientRect().height < 240) {
        const rect = chartCanvas?.getBoundingClientRect();
        failures.push({ check: "multichart-canvas-visible", detail: rect ? `${Math.round(rect.width)}x${Math.round(rect.height)}` : "missing canvas" });
      }

      const expectedMarketLenses = ["returns", "price", "benchmark", "macro-stock"];
      const actualMarketLenses = marketLensButtons.map((node) => node.getAttribute("data-macro-chart-market-lens"));
      if (
        marketLensButtons.length !== expectedMarketLenses.length ||
        !expectedMarketLenses.every((lens, index) => actualMarketLenses[index] === lens)
      ) {
        failures.push({
          check: "multichart-market-lens-order",
          detail: `actual=${JSON.stringify(actualMarketLenses)} expected=${JSON.stringify(expectedMarketLenses)}`,
        });
      }
      marketLensButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "multichart-market-lens-target", detail: `lens ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedDefaultChips = ["stq~SPY.US", "stq~QQQ.US", "stq~IWM.US"];
      const actualChips = new URL(window.location.href).searchParams.get("series")?.split(",").filter(Boolean) ?? [];
      if (
        viewportWidth < 1280 &&
        (actualChips.length < expectedDefaultChips.length ||
          !expectedDefaultChips.every((chip, index) => actualChips[index] === chip))
      ) {
        failures.push({
          check: "multichart-default-symbol-chips",
          detail: `actual=${JSON.stringify(actualChips.slice(0, 3))} expected=${JSON.stringify(expectedDefaultChips)}`,
        });
      }

      if (viewportWidth < 1280 && (!mobileStatus || mobileStatus.getBoundingClientRect().height <= 0)) {
        failures.push({ check: "multichart-mobile-status-visible", detail: "missing mobile status rail" });
      }
      if (!symbolInput || symbolInput.getBoundingClientRect().height < 44) {
        failures.push({ check: "multichart-symbol-input-target", detail: symbolInput ? `height=${Math.round(symbolInput.getBoundingClientRect().height)}` : "missing symbol input" });
      }
      if (!symbolAdd || symbolAdd.getBoundingClientRect().height < 44) {
        failures.push({ check: "multichart-symbol-add-target", detail: symbolAdd ? `height=${Math.round(symbolAdd.getBoundingClientRect().height)}` : "missing symbol add" });
      }

      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "multichart-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "시장 비교") {
        failures.push({ check: "multichart-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/tools/stock-analyzer") {
      const surface = document.querySelector("[data-stock-analyzer-surface]");
      const owner = document.querySelector("[data-stock-analyzer-route-owner]");
      const boundary = document.querySelector("[data-stock-analyzer-boundary]");
      const chips = Array.from(document.querySelectorAll("[data-stock-analyzer-boundary-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const ownerLinks = Array.from(document.querySelectorAll("[data-stock-analyzer-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const legacyFrame = document.querySelector("[data-stock-analyzer-legacy-frame] iframe");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "stock-analyzer-surface-visible", detail: "missing stock analyzer surface" });
      }
      if (!owner || owner.getAttribute("data-stock-analyzer-route-owner") !== "legacy-iframe") {
        failures.push({
          check: "stock-analyzer-route-owner",
          detail: `owner=${owner?.getAttribute("data-stock-analyzer-route-owner") || "missing"}`,
        });
      }
      if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("종목분석 (레거시)")) {
        failures.push({ check: "stock-analyzer-boundary-visible", detail: "missing visible legacy boundary" });
      }

      const expectedChips = ["legacy-iframe", "native-preview", "v1-backdoor"];
      const actualChips = chips.map((node) => node.getAttribute("data-stock-analyzer-boundary-chip"));
      if (
        chips.length !== expectedChips.length ||
        !expectedChips.every((chip, index) => actualChips[index] === chip)
      ) {
        failures.push({
          check: "stock-analyzer-boundary-chip-order",
          detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
        });
      }

      const expectedLinks = [
        "/tools/stock-analyzer/native",
        "/screener",
        "/stock/NVDA",
      ];
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "stock-analyzer-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "stock-analyzer-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const frameSrc = legacyFrame instanceof HTMLIFrameElement
        ? new URL(legacyFrame.src, window.location.origin)
        : null;
      if (!frameSrc || frameSrc.pathname !== "/tools/stock_analyzer/stock_analyzer.html") {
        failures.push({
          check: "stock-analyzer-legacy-frame-src",
          detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
        });
      }

      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "stock-analyzer-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "종목분석") {
        failures.push({ check: "stock-analyzer-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/tools/stock-analyzer/native") {
      const surface = document.querySelector("[data-stock-analyzer-native-surface]");
      const owner = document.querySelector("[data-stock-analyzer-native-route-owner]");
      const dashboard = document.querySelector("[data-stock-analyzer-native]");
      const header = document.querySelector("[data-stock-analyzer-native-header]");
      const actions = Array.from(document.querySelectorAll("[data-stock-analyzer-native-action]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const tabs = Array.from(document.querySelectorAll("[data-stock-analyzer-native-tab]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const filters = Array.from(document.querySelectorAll("[data-stock-analyzer-native-filter]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const filterTargets = filters
        .map((node) => {
          if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLButtonElement) return node;
          return node.querySelector("input,select,button");
        })
        .filter(Boolean);
      const summaryCards = Array.from(document.querySelectorAll("[data-stock-analyzer-native-summary-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const quickSnapshot = document.querySelector("[data-stock-analyzer-native-quick-snapshot]");
      const filteredUniverse = document.querySelector("[data-stock-analyzer-native-filtered-universe]");
      const mobileList = document.querySelector("[data-stock-analyzer-native-mobile-list]");
      const table = document.querySelector("[data-stock-analyzer-native-table]");
      const selected = document.querySelector("[data-stock-analyzer-native-selected]");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "stock-analyzer-native-surface-visible", detail: "missing native surface" });
      }
      if (!owner || owner.getAttribute("data-stock-analyzer-native-route-owner") !== "native-dashboard") {
        failures.push({
          check: "stock-analyzer-native-route-owner",
          detail: `owner=${owner?.getAttribute("data-stock-analyzer-native-route-owner") || "missing"}`,
        });
      }
      if (!dashboard || dashboard.getBoundingClientRect().height <= 0) {
        failures.push({ check: "stock-analyzer-native-dashboard-visible", detail: "missing dashboard surface" });
      }
      if (!header || header.getBoundingClientRect().height <= 0 || !(header.textContent || "").includes("Stock Analyzer Dashboard")) {
        failures.push({ check: "stock-analyzer-native-header-visible", detail: "missing visible native header" });
      }

      const expectedActions = ["refresh", "legacy"];
      const actualActions = actions.map((node) => node.getAttribute("data-stock-analyzer-native-action"));
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      if (
        actions.length !== expectedActions.length ||
        !expectedActions.every((action, index) => actualActions[index] === action)
      ) {
        failures.push({
          check: "stock-analyzer-native-action-order",
          detail: `actual=${JSON.stringify(actualActions)} expected=${JSON.stringify(expectedActions)}`,
        });
      }
      const legacyAction = actions.find((node) => node.getAttribute("data-stock-analyzer-native-action") === "legacy");
      if (
        !(legacyAction instanceof HTMLAnchorElement) ||
        normalizePath(new URL(legacyAction.href, window.location.origin).pathname) !== "/tools/stock-analyzer"
      ) {
        failures.push({ check: "stock-analyzer-native-legacy-action-target", detail: "legacy action does not return to legacy route" });
      }
      actions.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "stock-analyzer-native-action-target", detail: `action ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedTabs = ["overview", "growth", "ranking", "eps", "portfolio", "compare"];
      const actualTabs = tabs.map((node) => node.getAttribute("data-stock-analyzer-native-tab"));
      if (
        tabs.length !== expectedTabs.length ||
        !expectedTabs.every((tab, index) => actualTabs[index] === tab)
      ) {
        failures.push({
          check: "stock-analyzer-native-tab-order",
          detail: `actual=${JSON.stringify(actualTabs)} expected=${JSON.stringify(expectedTabs)}`,
        });
      }
      tabs.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "stock-analyzer-native-tab-target", detail: `tab ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedFilters = ["search", "sector", "sort", "order", "reset"];
      const actualFilters = filters.map((node) => node.getAttribute("data-stock-analyzer-native-filter"));
      if (
        filters.length !== expectedFilters.length ||
        !expectedFilters.every((filter, index) => actualFilters[index] === filter)
      ) {
        failures.push({
          check: "stock-analyzer-native-filter-order",
          detail: `actual=${JSON.stringify(actualFilters)} expected=${JSON.stringify(expectedFilters)}`,
        });
      }
      filterTargets.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "stock-analyzer-native-filter-target", detail: `filter ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (summaryCards.length !== 4) {
        failures.push({ check: "stock-analyzer-native-summary-card-count", detail: `cards=${summaryCards.length}` });
      }
      if (!quickSnapshot || quickSnapshot.getBoundingClientRect().height <= 0) {
        failures.push({ check: "stock-analyzer-native-quick-snapshot-visible", detail: "missing quick snapshot" });
      }
      if (!filteredUniverse || filteredUniverse.getBoundingClientRect().height <= 0) {
        failures.push({ check: "stock-analyzer-native-filtered-universe-visible", detail: "missing filtered universe" });
      }
      if (viewportWidth < 768 && (!mobileList || mobileList.getBoundingClientRect().height <= 0)) {
        failures.push({ check: "stock-analyzer-native-mobile-list-visible", detail: "missing mobile list surface" });
      }
      if (viewportWidth >= 768 && (!table || table.getBoundingClientRect().height <= 0)) {
        failures.push({ check: "stock-analyzer-native-table-visible", detail: "missing desktop table" });
      }
      if (!selected || selected.getBoundingClientRect().height <= 0) {
        failures.push({ check: "stock-analyzer-native-selected-visible", detail: "missing selected snapshot" });
      }

      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "stock-analyzer-native-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "종목분석 네이티브") {
        failures.push({ check: "stock-analyzer-native-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/ib") {
      const surface = document.querySelector("[data-ib-surface]");
      const owner = document.querySelector("[data-ib-route-owner]");
      const boundary = document.querySelector("[data-ib-boundary]");
      const chips = Array.from(document.querySelectorAll("[data-ib-boundary-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const ownerLinks = Array.from(document.querySelectorAll("[data-ib-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const legacyFrame = document.querySelector("[data-ib-legacy-frame] iframe");
      const immersiveRoute = document.querySelector('[data-immersive-route="ib"]');
      const tabbar = document.querySelector(".fnk-shell .tabbar");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "ib-surface-visible", detail: "missing ib surface" });
      }
      if (!owner || owner.getAttribute("data-ib-route-owner") !== "legacy-v1") {
        failures.push({
          check: "ib-route-owner",
          detail: `owner=${owner?.getAttribute("data-ib-route-owner") || "missing"}`,
        });
      }
      if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("IB Helper (레거시)")) {
        failures.push({ check: "ib-boundary-visible", detail: "missing visible legacy boundary" });
      }

      const expectedChips = ["legacy-v1", "native-v2-preview", "v1-backdoor"];
      const actualChips = chips.map((node) => node.getAttribute("data-ib-boundary-chip"));
      if (
        chips.length !== expectedChips.length ||
        !expectedChips.every((chip, index) => actualChips[index] === chip)
      ) {
        failures.push({
          check: "ib-boundary-chip-order",
          detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
        });
      }

      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => {
        const url = new URL(node.href, window.location.origin);
        return `${normalizePath(url.pathname)}${url.search}`;
      });
      const expectedLinks = [
        "/ib?v2=1",
        "/admin/ib-helper",
        "/infinite-buying",
      ];
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "ib-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "ib-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const frameSrc = legacyFrame instanceof HTMLIFrameElement
        ? new URL(legacyFrame.src, window.location.origin)
        : null;
      if (!frameSrc || frameSrc.pathname !== "/ib/ib-helper/index.html") {
        failures.push({
          check: "ib-legacy-frame-src",
          detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
        });
      }
      if (!immersiveRoute || tabbar) {
        failures.push({
          check: "ib-immersive-route",
          detail: `immersive=${Boolean(immersiveRoute)} tabbar=${Boolean(tabbar)}`,
        });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/infinite-buying") {
      const surface = document.querySelector("[data-infinite-buying-surface]");
      const owner = document.querySelector("[data-infinite-buying-route-owner]");
      const boundary = document.querySelector("[data-infinite-buying-boundary]");
      const chips = Array.from(document.querySelectorAll("[data-infinite-buying-boundary-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const ownerLinks = Array.from(document.querySelectorAll("[data-infinite-buying-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const legacyFrame = document.querySelector("[data-infinite-buying-legacy-frame] iframe");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "infinite-buying-surface-visible", detail: "missing infinite buying surface" });
      }
      if (!owner || owner.getAttribute("data-infinite-buying-route-owner") !== "legacy-guide-calculator") {
        failures.push({
          check: "infinite-buying-route-owner",
          detail: `owner=${owner?.getAttribute("data-infinite-buying-route-owner") || "missing"}`,
        });
      }
      if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("Guide 계산기")) {
        failures.push({ check: "infinite-buying-boundary-visible", detail: "missing visible guide boundary" });
      }

      const expectedChips = ["legacy-guide", "ib-helper-owner", "native-preview"];
      const actualChips = chips.map((node) => node.getAttribute("data-infinite-buying-boundary-chip"));
      if (
        chips.length !== expectedChips.length ||
        !expectedChips.every((chip, index) => actualChips[index] === chip)
      ) {
        failures.push({
          check: "infinite-buying-boundary-chip-order",
          detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
        });
      }

      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => {
        const url = new URL(node.href, window.location.origin);
        return `${normalizePath(url.pathname)}${url.search}`;
      });
      const expectedLinks = [
        "/ib",
        "/ib?v2=1",
        "/vr",
      ];
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "infinite-buying-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "infinite-buying-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const frameSrc = legacyFrame instanceof HTMLIFrameElement
        ? new URL(legacyFrame.src, window.location.origin)
        : null;
      if (!frameSrc || frameSrc.pathname !== "/ib/ib-total-guide-calculator.html") {
        failures.push({
          check: "infinite-buying-legacy-frame-src",
          detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
        });
      }

      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "infinite-buying-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "Infinite Buying") {
        failures.push({ check: "infinite-buying-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/vr") {
      const surface = document.querySelector("[data-vr-surface]");
      const owner = document.querySelector("[data-vr-route-owner]");
      const boundary = document.querySelector("[data-vr-boundary]");
      const actionRail = document.querySelector("[data-vr-action-rail]");
      const chips = Array.from(document.querySelectorAll("[data-vr-boundary-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const ownerLinks = Array.from(document.querySelectorAll("[data-vr-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const cards = Array.from(document.querySelectorAll("[data-vr-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const formula = document.querySelector("[data-vr-formula]");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "vr-surface-visible", detail: "missing vr surface" });
      }
      if (!owner || owner.getAttribute("data-vr-route-owner") !== "legacy-guides") {
        failures.push({
          check: "vr-route-owner",
          detail: `owner=${owner?.getAttribute("data-vr-route-owner") || "missing"}`,
        });
      }
      if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("가이드와 계산기")) {
        failures.push({ check: "vr-boundary-visible", detail: "missing visible vr boundary" });
      }
      if (!actionRail || actionRail.getBoundingClientRect().height <= 0) {
        failures.push({ check: "vr-action-rail-visible", detail: "missing visible vr action rail" });
      }

      const expectedChips = ["legacy-guide", "calculator", "app-shell"];
      const actualChips = chips.map((node) => node.getAttribute("data-vr-boundary-chip"));
      if (
        chips.length !== expectedChips.length ||
        !expectedChips.every((chip, index) => actualChips[index] === chip)
      ) {
        failures.push({
          check: "vr-boundary-chip-order",
          detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
        });
      }
      chips.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (node.matches("a,button,[role=button]") && rect.height < 44) {
          failures.push({ check: "vr-boundary-chip-target", detail: `chip ${index} height=${Math.round(rect.height)}` });
        }
      });

      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => {
        const url = new URL(node.href, window.location.origin);
        return `${normalizePath(url.pathname)}${url.search}`;
      });
      const expectedLinks = [
        "/vr?path=vr/vr-complete-system.html",
        "/vr?path=vr/vr-total-guide-calculator.html",
        "/ib",
      ];
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "vr-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "vr-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedCards = ["system", "calculator"];
      const actualCards = cards.map((node) => node.getAttribute("data-vr-card"));
      if (
        cards.length !== expectedCards.length ||
        !expectedCards.every((card, index) => actualCards[index] === card)
      ) {
        failures.push({
          check: "vr-card-order",
          detail: `actual=${JSON.stringify(actualCards)} expected=${JSON.stringify(expectedCards)}`,
        });
      }
      cards.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "vr-card-target", detail: `card ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!formula || formula.getBoundingClientRect().height <= 0 || !(formula.textContent || "").includes("V₂")) {
        failures.push({ check: "vr-formula-visible", detail: "missing visible vr formula" });
      }
      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "vr-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "VR 전략 가이드") {
        failures.push({ check: "vr-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/admin/data-lab") {
      const surface = document.querySelector("[data-admin-data-lab-surface]");
      const owner = document.querySelector("[data-admin-data-lab-route-owner]");
      const boundary = document.querySelector("[data-admin-data-lab-boundary]");
      const chips = Array.from(document.querySelectorAll("[data-admin-data-lab-boundary-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const ownerLinks = Array.from(document.querySelectorAll("[data-admin-data-lab-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const legacyFrame = document.querySelector("[data-admin-data-lab-legacy-frame] iframe");
      const tabbar = document.querySelector(".fnk-shell .tabbar");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "admin-data-lab-surface-visible", detail: "missing admin data lab surface" });
      }
      if (!owner || owner.getAttribute("data-admin-data-lab-route-owner") !== "legacy-admin-data-lab") {
        failures.push({
          check: "admin-data-lab-route-owner",
          detail: `owner=${owner?.getAttribute("data-admin-data-lab-route-owner") || "missing"}`,
        });
      }
      if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("Data Lab (레거시)")) {
        failures.push({ check: "admin-data-lab-boundary-visible", detail: "missing visible data lab boundary" });
      }

      const expectedChips = ["admin-only", "legacy-html", "source-audit"];
      const actualChips = chips.map((node) => node.getAttribute("data-admin-data-lab-boundary-chip"));
      if (
        chips.length !== expectedChips.length ||
        !expectedChips.every((chip, index) => actualChips[index] === chip)
      ) {
        failures.push({
          check: "admin-data-lab-boundary-chip-order",
          detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
        });
      }

      const expectedLinks = [
        "/admin",
        "/market-valuation",
        "/explore",
      ];
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "admin-data-lab-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "admin-data-lab-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const frameSrc = legacyFrame instanceof HTMLIFrameElement
        ? new URL(legacyFrame.src, window.location.origin)
        : null;
      if (!frameSrc || frameSrc.pathname !== "/admin/data-lab/index.html") {
        failures.push({
          check: "admin-data-lab-legacy-frame-src",
          detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
        });
      }
      if (tabbar) {
        failures.push({ check: "admin-data-lab-admin-shell", detail: "admin route should not render product mobile tabbar" });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/100x/daily-wrap") {
      const surface = document.querySelector("[data-daily-wrap-surface]");
      const owner = document.querySelector("[data-daily-wrap-route-owner]");
      const boundary = document.querySelector("[data-daily-wrap-boundary]");
      const chips = Array.from(document.querySelectorAll("[data-daily-wrap-boundary-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const ownerLinks = Array.from(document.querySelectorAll("[data-daily-wrap-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const legacyFrame = document.querySelector("[data-daily-wrap-legacy-frame] iframe");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "daily-wrap-surface-visible", detail: "missing daily wrap surface" });
      }
      if (!owner || owner.getAttribute("data-daily-wrap-route-owner") !== "legacy-viewer") {
        failures.push({
          check: "daily-wrap-route-owner",
          detail: `owner=${owner?.getAttribute("data-daily-wrap-route-owner") || "missing"}`,
        });
      }
      if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("100x Daily Wrap (레거시)")) {
        failures.push({ check: "daily-wrap-boundary-visible", detail: "missing visible daily wrap boundary" });
      }

      const expectedChips = ["legacy-viewer", "native-preview", "date-filter"];
      const actualChips = chips.map((node) => node.getAttribute("data-daily-wrap-boundary-chip"));
      if (
        chips.length !== expectedChips.length ||
        !expectedChips.every((chip, index) => actualChips[index] === chip)
      ) {
        failures.push({
          check: "daily-wrap-boundary-chip-order",
          detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
        });
      }
      chips.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (node.matches("a,button,[role=button]") && rect.height < 44) {
          failures.push({ check: "daily-wrap-boundary-chip-target", detail: `chip ${index} height=${Math.round(rect.height)}` });
        }
      });

      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => {
        const url = new URL(node.href, window.location.origin);
        return `${normalizePath(url.pathname)}${url.search}`;
      });
      const expectedLinks = [
        "/100x/daily-wrap",
        "/100x/daily-wrap?v2=1",
        "/market/events",
      ];
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "daily-wrap-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "daily-wrap-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const frameSrc = legacyFrame instanceof HTMLIFrameElement
        ? new URL(legacyFrame.src, window.location.origin)
        : null;
      if (!frameSrc || frameSrc.pathname !== "/100x/daily-wrap/daily-wrap-viewer.html") {
        failures.push({
          check: "daily-wrap-legacy-frame-src",
          detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
        });
      }
      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "daily-wrap-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "100x Daily Wrap") {
        failures.push({ check: "daily-wrap-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    {
      const postsUrl = new URL(currentRoute, window.location.origin);
      const postsPath = postsUrl.pathname.replace(/\/+$/, "") || "/";
      if (postsPath === "/posts") {
        const legacyPath = postsUrl.searchParams.get("path");
        const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
        const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");
        const appTitle = document.querySelector(".fnk-shell .appbar .title");

        if (legacyPath) {
          const surface = document.querySelector("[data-posts-detail-surface]");
          const owner = document.querySelector("[data-posts-detail-route-owner]");
          const boundary = document.querySelector("[data-posts-detail-boundary]");
          const chips = Array.from(document.querySelectorAll("[data-posts-detail-boundary-chip]"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          const ownerLinks = Array.from(document.querySelectorAll("[data-posts-detail-owner-link]"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          const legacyFrame = document.querySelector("[data-posts-detail-legacy-frame] iframe");

          if (!surface || surface.getBoundingClientRect().height <= 0) {
            failures.push({ check: "posts-detail-surface-visible", detail: "missing posts detail surface" });
          }
          if (!owner || owner.getAttribute("data-posts-detail-route-owner") !== "legacy-post-html") {
            failures.push({
              check: "posts-detail-route-owner",
              detail: `owner=${owner?.getAttribute("data-posts-detail-route-owner") || "missing"}`,
            });
          }
          if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("레거시 리포트")) {
            failures.push({ check: "posts-detail-boundary-visible", detail: "missing visible posts detail boundary" });
          }

          const expectedChips = ["archive", "legacy-html", "research"];
          const actualChips = chips.map((node) => node.getAttribute("data-posts-detail-boundary-chip"));
          if (
            chips.length !== expectedChips.length ||
            !expectedChips.every((chip, index) => actualChips[index] === chip)
          ) {
            failures.push({
              check: "posts-detail-boundary-chip-order",
              detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
            });
          }
          chips.forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (node.matches("a,button,[role=button]") && rect.height < 44) {
              failures.push({ check: "posts-detail-boundary-chip-target", detail: `chip ${index} height=${Math.round(rect.height)}` });
            }
          });

          const expectedLinks = ["/", "/market-valuation", "/screener"];
          const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
          if (
            ownerLinks.length !== expectedLinks.length ||
            !expectedLinks.every((link, index) => actualLinks[index] === link)
          ) {
            failures.push({
              check: "posts-detail-owner-link-order",
              detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
            });
          }
          ownerLinks.forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.height < 44) {
              failures.push({ check: "posts-detail-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
            }
          });

          const frameSrc = legacyFrame instanceof HTMLIFrameElement
            ? new URL(legacyFrame.src, window.location.origin)
            : null;
          if (!frameSrc || frameSrc.pathname !== "/posts-raw/2026-02-21_tariff-ruling-comprehensive.html") {
            failures.push({
              check: "posts-detail-legacy-frame-src",
              detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
            });
          }
          const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
          if (!activeTabLabel.includes("더보기")) {
            failures.push({ check: "posts-detail-mobile-tab-active", detail: `active=${activeTabLabel}` });
          }
          if ((appTitle?.textContent || "").trim() !== "분석 아카이브 상세") {
            failures.push({ check: "posts-detail-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
          }
        } else {
          const surface = document.querySelector("[data-posts-surface]");
          const owner = document.querySelector("[data-posts-route-owner]");
          const boundary = document.querySelector("[data-posts-boundary]");
          const chips = Array.from(document.querySelectorAll("[data-posts-boundary-chip]"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          const ownerLinks = Array.from(document.querySelectorAll("[data-posts-owner-link]"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          const featured = document.querySelector("[data-posts-featured-card]");
          const archiveCards = Array.from(document.querySelectorAll("[data-posts-card]"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });

          if (!surface || surface.getBoundingClientRect().height <= 0) {
            failures.push({ check: "posts-surface-visible", detail: "missing posts landing surface" });
          }
          if (!owner || owner.getAttribute("data-posts-route-owner") !== "analysis-archive") {
            failures.push({
              check: "posts-route-owner",
              detail: `owner=${owner?.getAttribute("data-posts-route-owner") || "missing"}`,
            });
          }
          if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("분석 아카이브")) {
            failures.push({ check: "posts-boundary-visible", detail: "missing visible posts boundary" });
          }

          const expectedChips = ["archive", "legacy-html", "research"];
          const actualChips = chips.map((node) => node.getAttribute("data-posts-boundary-chip"));
          if (
            chips.length !== expectedChips.length ||
            !expectedChips.every((chip, index) => actualChips[index] === chip)
          ) {
            failures.push({
              check: "posts-boundary-chip-order",
              detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
            });
          }
          chips.forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (node.matches("a,button,[role=button]") && rect.height < 44) {
              failures.push({ check: "posts-boundary-chip-target", detail: `chip ${index} height=${Math.round(rect.height)}` });
            }
          });

          const expectedLinks = ["/posts", "/alpha-scout", "/100x/daily-wrap"];
          const actualLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
          if (
            ownerLinks.length !== expectedLinks.length ||
            !expectedLinks.every((link, index) => actualLinks[index] === link)
          ) {
            failures.push({
              check: "posts-owner-link-order",
              detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
            });
          }
          ownerLinks.forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.height < 44) {
              failures.push({ check: "posts-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
            }
          });
          if (!featured || featured.getBoundingClientRect().height <= 0) {
            failures.push({ check: "posts-featured-card-visible", detail: "missing featured post card" });
          }
          if (archiveCards.length === 0) {
            failures.push({ check: "posts-archive-card-visible", detail: "missing archive post cards" });
          }
          const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
          if (!activeTabLabel.includes("더보기")) {
            failures.push({ check: "posts-mobile-tab-active", detail: `active=${activeTabLabel}` });
          }
          if ((appTitle?.textContent || "").trim() !== "분석 아카이브") {
            failures.push({ check: "posts-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
          }
        }
      }
    }

    {
      const radarUrl = new URL(currentRoute, window.location.origin);
      const radarPath = radarUrl.pathname.replace(/\/+$/, "") || "/";
      if (radarPath === "/radar") {
        const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
        const surface = document.querySelector("[data-radar-surface]");
        const owner = document.querySelector("[data-radar-route-owner]");
        const boundary = document.querySelector("[data-radar-boundary]");
        const chips = Array.from(document.querySelectorAll("[data-radar-boundary-chip]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const ownerLinks = Array.from(document.querySelectorAll("[data-radar-owner-link]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const categoryLinks = Array.from(document.querySelectorAll("[data-radar-category-link]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const legacyFrame = document.querySelector("[data-radar-legacy-frame] iframe");
        const activeTab = document.querySelector(".fnk-shell .tabbar .tab.on");
        const appTitle = document.querySelector(".fnk-shell .appbar .title");

        if (!surface || surface.getBoundingClientRect().height <= 0) {
          failures.push({ check: "radar-surface-visible", detail: "missing radar surface" });
        }
        if (!owner || owner.getAttribute("data-radar-route-owner") !== "legacy-macro-monitor") {
          failures.push({
            check: "radar-route-owner",
            detail: `owner=${owner?.getAttribute("data-radar-route-owner") || "missing"}`,
          });
        }
        if (!boundary || boundary.getBoundingClientRect().height <= 0 || !(boundary.textContent || "").includes("Market Radar (레거시)")) {
          failures.push({ check: "radar-boundary-visible", detail: "missing visible radar boundary" });
        }

        const expectedChips = ["legacy-monitor", "native-macro", "detail-bridge"];
        const actualChips = chips.map((node) => node.getAttribute("data-radar-boundary-chip"));
        if (
          chips.length !== expectedChips.length ||
          !expectedChips.every((chip, index) => actualChips[index] === chip)
        ) {
          failures.push({
            check: "radar-boundary-chip-order",
            detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
          });
        }
        chips.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (node.matches("a,button,[role=button]") && rect.height < 44) {
            failures.push({ check: "radar-boundary-chip-target", detail: `chip ${index} height=${Math.round(rect.height)}` });
          }
        });

        const expectedOwnerLinks = ["/macro-chart", "/market/events", "/market-valuation"];
        const actualOwnerLinks = ownerLinks.map((node) => normalizePath(new URL(node.href, window.location.origin).pathname));
        if (
          ownerLinks.length !== expectedOwnerLinks.length ||
          !expectedOwnerLinks.every((link, index) => actualOwnerLinks[index] === link)
        ) {
          failures.push({
            check: "radar-owner-link-order",
            detail: `actual=${JSON.stringify(actualOwnerLinks)} expected=${JSON.stringify(expectedOwnerLinks)}`,
          });
        }
        ownerLinks.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "radar-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
          }
        });

        const expectedCategoryLinks = [
          "/radar",
          "/radar?category=liquidity",
          "/radar?category=rates",
          "/radar?category=sentiment",
        ];
        const actualCategoryLinks = categoryLinks.map((node) => {
          const url = new URL(node.href, window.location.origin);
          return `${normalizePath(url.pathname)}${url.search}`;
        });
        if (
          categoryLinks.length !== expectedCategoryLinks.length ||
          !expectedCategoryLinks.every((link, index) => actualCategoryLinks[index] === link)
        ) {
          failures.push({
            check: "radar-category-link-order",
            detail: `actual=${JSON.stringify(actualCategoryLinks)} expected=${JSON.stringify(expectedCategoryLinks)}`,
          });
        }
        categoryLinks.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "radar-category-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
          }
        });

        const frameSrc = legacyFrame instanceof HTMLIFrameElement
          ? new URL(legacyFrame.src, window.location.origin)
          : null;
        const expectedFramePath = radarUrl.searchParams.get("path")
          ? "/tools/macro-monitor/details/liquidity-flow.html"
          : "/tools/macro-monitor/index.html";
        if (!frameSrc || frameSrc.pathname !== expectedFramePath) {
          failures.push({
            check: "radar-legacy-frame-src",
            detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"} expected=${expectedFramePath}`,
          });
        }
        if (!radarUrl.searchParams.get("path") && radarUrl.searchParams.get("category") && frameSrc?.searchParams.get("category") !== radarUrl.searchParams.get("category")) {
          failures.push({
            check: "radar-category-forwarding",
            detail: `frameCategory=${frameSrc?.searchParams.get("category") || ""} expected=${radarUrl.searchParams.get("category")}`,
          });
        }

        const activeTabLabel = (activeTab?.textContent || "").replace(/\s+/g, " ").trim();
        if (activeTabLabel !== "홈") {
          failures.push({ check: "radar-mobile-tab-active", detail: `active=${activeTabLabel}` });
        }
        if ((appTitle?.textContent || "").trim() !== "Market Radar") {
          failures.push({ check: "radar-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
        }
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/alpha-scout") {
      const alphaUrl = new URL(currentRoute, window.location.origin);
      const hasLegacyDeepLink = Boolean(alphaUrl.searchParams.get("report") || alphaUrl.searchParams.get("path"));
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");
      const owner = document.querySelector("[data-alpha-scout-route-owner]");
      const ownerLinks = Array.from(document.querySelectorAll("[data-alpha-scout-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const linkTargets = ownerLinks.map((node) => {
        const href = node instanceof HTMLAnchorElement ? new URL(node.href, window.location.origin) : null;
        const pathname = href && href.pathname !== "/" ? href.pathname.replace(/\/+$/, "") : href?.pathname;
        return href ? `${pathname}${href.search}` : "";
      });

      if (hasLegacyDeepLink) {
        const surface = document.querySelector("[data-alpha-scout-report-surface]");
        const boundary = document.querySelector("[data-alpha-scout-boundary]");
        const chips = Array.from(document.querySelectorAll("[data-alpha-scout-boundary-chip]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const legacyFrame = document.querySelector("[data-alpha-scout-legacy-frame] iframe");
        const frameSrc = legacyFrame instanceof HTMLIFrameElement
          ? new URL(legacyFrame.src, window.location.origin)
          : null;

        if (!surface || surface.getBoundingClientRect().height <= 0) {
          failures.push({ check: "alpha-scout-report-surface-visible", detail: "missing alpha scout report surface" });
        }
        if (!owner || owner.getAttribute("data-alpha-scout-route-owner") !== "legacy-report-html") {
          failures.push({
            check: "alpha-scout-report-route-owner",
            detail: `owner=${owner?.getAttribute("data-alpha-scout-route-owner") || "missing"}`,
          });
        }
        if (!boundary || boundary.getBoundingClientRect().height <= 0) {
          failures.push({ check: "alpha-scout-report-boundary-visible", detail: "missing report boundary" });
        }
        const actualChips = chips.map((node) => node.getAttribute("data-alpha-scout-boundary-chip"));
        const expectedChips = ["legacy-html", "report-deeplink", "v2-owner"];
        if (JSON.stringify(actualChips) !== JSON.stringify(expectedChips)) {
          failures.push({
            check: "alpha-scout-report-boundary-chip-order",
            detail: `actual=${JSON.stringify(actualChips)} expected=${JSON.stringify(expectedChips)}`,
          });
        }
        chips.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (node.matches("a,button,[role=button]") && rect.height < 44) {
            failures.push({ check: "alpha-scout-report-boundary-chip-target", detail: `chip ${index} height=${Math.round(rect.height)}` });
          }
        });
        const expectedLinks = ["/alpha-scout", "/posts", "/100x/daily-wrap"];
        if (JSON.stringify(linkTargets) !== JSON.stringify(expectedLinks)) {
          failures.push({
            check: "alpha-scout-report-owner-link-order",
            detail: `actual=${JSON.stringify(linkTargets)} expected=${JSON.stringify(expectedLinks)}`,
          });
        }
        ownerLinks.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "alpha-scout-report-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
          }
        });
        if (!frameSrc || frameSrc.pathname !== "/alpha-scout/reports/2025-08-24_100x-alpha-scout.html") {
          failures.push({
            check: "alpha-scout-report-legacy-frame-src",
            detail: `src=${legacyFrame instanceof HTMLIFrameElement ? legacyFrame.src : "missing"}`,
          });
        }
      } else {
        const surface = document.querySelector("[data-alpha-scout-surface]");
        const previewStrip = document.querySelector("[data-alpha-scout-preview-strip]");
        const actionRail = document.querySelector("[data-alpha-scout-action-rail]");
        const filter = document.querySelector("[data-alpha-scout-filter]");
        const search = document.querySelector("[data-alpha-scout-search]");
        const tags = Array.from(document.querySelectorAll("[data-alpha-scout-tag]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const featured = document.querySelector("[data-alpha-scout-featured]");
        const cards = Array.from(document.querySelectorAll("[data-alpha-scout-card]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

        if (!surface || surface.getBoundingClientRect().height <= 0) {
          failures.push({ check: "alpha-scout-surface-visible", detail: "missing alpha scout surface" });
        }
        if (!owner || owner.getAttribute("data-alpha-scout-route-owner") !== "v2-report-archive") {
          failures.push({
            check: "alpha-scout-route-owner",
            detail: `owner=${owner?.getAttribute("data-alpha-scout-route-owner") || "missing"}`,
          });
        }
        if (!previewStrip || !(previewStrip.textContent || "").includes("미리보기") || !(previewStrip.textContent || "").includes("정적")) {
          failures.push({ check: "alpha-scout-preview-honesty", detail: `text=${previewStrip?.textContent || ""}` });
        }
        if (!actionRail || actionRail.getBoundingClientRect().height <= 0) {
          failures.push({ check: "alpha-scout-action-rail-visible", detail: "missing action rail" });
        }
        const expectedLinks = ["/posts", "/100x/daily-wrap", "/alpha-scout?report=2025-08-24_100x-alpha-scout.html"];
        if (JSON.stringify(linkTargets) !== JSON.stringify(expectedLinks)) {
          failures.push({
            check: "alpha-scout-owner-link-order",
            detail: `actual=${JSON.stringify(linkTargets)} expected=${JSON.stringify(expectedLinks)}`,
          });
        }
        ownerLinks.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "alpha-scout-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
          }
        });
        if (!filter || filter.getBoundingClientRect().height <= 0) {
          failures.push({ check: "alpha-scout-filter-visible", detail: "missing alpha scout filter" });
        }
        if (!search || search.getBoundingClientRect().height < 44) {
          failures.push({ check: "alpha-scout-search-target", detail: `height=${Math.round(search?.getBoundingClientRect().height || 0)}` });
        }
        if (tags.length < 4) {
          failures.push({ check: "alpha-scout-tag-count", detail: `visible tags=${tags.length}` });
        }
        tags.slice(0, 8).forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "alpha-scout-tag-target", detail: `tag ${index} height=${Math.round(rect.height)}` });
          }
        });
        if (!featured || featured.getBoundingClientRect().height <= 0) {
          failures.push({ check: "alpha-scout-featured-visible", detail: "missing featured issue" });
        }
        const cardKinds = cards.map((node) => node.getAttribute("data-alpha-scout-card"));
        if (!cardKinds.includes("featured") || !cardKinds.includes("archive")) {
          failures.push({ check: "alpha-scout-card-kinds", detail: `kinds=${JSON.stringify(cardKinds)}` });
        }
        cards.slice(0, 6).forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "alpha-scout-card-target", detail: `card ${index} height=${Math.round(rect.height)}` });
          }
        });
      }
      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "alpha-scout-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "Alpha Scout") {
        failures.push({ check: "alpha-scout-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/market-valuation") {
      const surface = document.querySelector("[data-market-valuation-surface]");
      const nav = document.querySelector("[data-market-section-nav]");
      const navLinks = Array.from(document.querySelectorAll("[data-market-section-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const chartGrid = document.querySelector("[data-market-valuation-chart-grid]");
      const indexCards = Array.from(document.querySelectorAll(".mv-trow"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-valuation-surface-visible", detail: "missing market valuation surface" });
      }
      if (!nav || nav.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-section-nav-visible", detail: "missing market section nav" });
      }

      const expectedLinks = ["valuation", "regime", "events", "sectors"];
      const actualLinks = navLinks.map((node) => node.getAttribute("data-market-section-link"));
      if (
        navLinks.length !== expectedLinks.length ||
        !expectedLinks.every((key, index) => actualLinks[index] === key)
      ) {
        failures.push({
          check: "market-section-nav-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }

      navLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "market-section-nav-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!chartGrid || chartGrid.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-valuation-chart-grid-visible", detail: "missing ERP/Yardeni chart grid" });
      }
      if (indexCards.length < 2) {
        failures.push({ check: "market-index-card-count", detail: `visible cards=${indexCards.length}` });
      }
      indexCards.forEach((card, cardIndex) => {
        if (!(card.textContent || "").trim() || card.getAttribute("role") !== "row") {
          failures.push({ check: "market-index-card-content", detail: `card=${cardIndex} empty-or-not-row` });
        }
      });
      if (viewportWidth < 768) {
        const thead = document.querySelector(".mv-thead");
        if (thead && thead.getBoundingClientRect().height > 0) {
          failures.push({ check: "market-valuation-stacked-thead-hidden", detail: `height=${Math.round(thead.getBoundingClientRect().height)}` });
        }
        indexCards.forEach((row, rowIndex) => {
          const rect = row.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "market-valuation-stacked-row-target", detail: `row ${rowIndex} height=${Math.round(rect.height)}` });
          }
          const name = row.querySelector(".mv-idx");
          const nameStart = name ? window.getComputedStyle(name).gridColumnStart : "";
          if (!name || nameStart === "auto") {
            failures.push({ check: "market-valuation-stacked-name-span", detail: `row ${rowIndex} gridColumnStart=${nameStart || "missing"}` });
          }
        });
        Array.from(document.querySelectorAll(".mv-horizons button"))
          .filter((node) => node.getBoundingClientRect().width > 0)
          .forEach((node, index) => {
            if (node.getBoundingClientRect().height < 44) {
              failures.push({ check: "market-valuation-horizons-target", detail: `button ${index} height=${Math.round(node.getBoundingClientRect().height)}` });
            }
          });
        Array.from(document.querySelectorAll(".mv-brow"))
          .filter((node) => node.getBoundingClientRect().width > 0)
          .forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.height < 44) {
              failures.push({ check: "market-valuation-brow-target", detail: `brow ${index} height=${Math.round(rect.height)}` });
            }
            const band = node.querySelector(".mv-band");
            const bandStart = band ? window.getComputedStyle(band).gridColumnStart : "";
            if (!band || bandStart === "auto") {
              failures.push({ check: "market-valuation-band-geometry", detail: `brow ${index} gridColumnStart=${bandStart || "missing"}` });
            } else {
              const bandRect = band.getBoundingClientRect();
              const nameRect = node.querySelector(".mv-bname")?.getBoundingClientRect();
              if (rect.width - bandRect.width > 40) {
                failures.push({ check: "market-valuation-band-geometry", detail: `brow ${index} band=${Math.round(bandRect.width)} brow=${Math.round(rect.width)}` });
              }
              if (nameRect && bandRect.top < nameRect.bottom - 2) {
                failures.push({ check: "market-valuation-band-geometry", detail: `brow ${index} band overlaps name row` });
              }
            }
          });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/market-valuation/structure") {
      const surface = document.querySelector("[data-market-structure-surface]");
      const owner = document.querySelector("[data-market-structure-route-owner]");
      const header = document.querySelector("[data-market-structure-header]");
      const ownerLinks = Array.from(document.querySelectorAll("[data-market-structure-owner-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const summary = document.querySelector("[data-market-structure-summary]");
      const summaryCards = Array.from(document.querySelectorAll("[data-market-structure-summary-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const slots = Array.from(document.querySelectorAll("[data-market-structure-slot]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMarketTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-structure-surface-visible", detail: "missing market structure surface" });
      }
      if (!owner || owner.getAttribute("data-market-structure-route-owner") !== "market-structure-detail") {
        failures.push({
          check: "market-structure-route-owner",
          detail: `owner=${owner?.getAttribute("data-market-structure-route-owner") || "missing"}`,
        });
      }
      if (!header || header.getBoundingClientRect().height <= 0 || !(header.textContent || "").includes("시장 구조 상세")) {
        failures.push({ check: "market-structure-header-visible", detail: "missing market structure header" });
      }

      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const actualLinks = ownerLinks.map((node) => {
        const url = new URL(node.href, window.location.origin);
        return normalizePath(url.pathname);
      });
      const expectedLinks = ["/market-valuation", "/"];
      if (
        ownerLinks.length !== expectedLinks.length ||
        !expectedLinks.every((link, index) => actualLinks[index] === link)
      ) {
        failures.push({
          check: "market-structure-owner-link-order",
          detail: `actual=${JSON.stringify(actualLinks)} expected=${JSON.stringify(expectedLinks)}`,
        });
      }
      ownerLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "market-structure-owner-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!summary || summary.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-structure-summary-visible", detail: "missing market structure summary" });
      }
      if (summaryCards.length < 4) {
        failures.push({ check: "market-structure-summary-card-count", detail: `cards=${summaryCards.length}` });
      }
      const expectedSlots = ["benchmark", "credit", "mag7", "membership", "liquidity", "concentration", "sentiment", "aaii"];
      const actualSlots = slots.map((node) => node.getAttribute("data-market-structure-slot"));
      if (
        slots.length !== expectedSlots.length ||
        !expectedSlots.every((slot, index) => actualSlots[index] === slot)
      ) {
        failures.push({
          check: "market-structure-slot-order",
          detail: `actual=${JSON.stringify(actualSlots)} expected=${JSON.stringify(expectedSlots)}`,
        });
      }

      const activeTabLabel = (activeMarketTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("시장")) {
        failures.push({ check: "market-structure-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "시장 구조") {
        failures.push({ check: "market-structure-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/regime") {
      const surface = document.querySelector("[data-regime-surface]");
      const headline = document.querySelector("[data-regime-headline]");
      const activeNav = document.querySelector('[data-market-section-link="regime"][aria-current="page"]');
      const navLinks = Array.from(document.querySelectorAll("[data-market-section-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const summaryCards = Array.from(document.querySelectorAll("[data-regime-axis-summary-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const actionRail = document.querySelector("[data-regime-action-rail]");
      const actionLinks = Array.from(document.querySelectorAll("[data-regime-action]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const axisHead = document.querySelector(".rgm-thead");
      const axisHeadText = (axisHead?.textContent || "").replace(/\s+/g, " ").trim();
      const compositeAsOf = document.querySelector("[data-regime-composite-asof]");
      const compositeAsOfText = (compositeAsOf?.textContent || "").replace(/\s+/g, " ").trim();
      const compositeRail = document.querySelector("[data-regime-composite-rail]");
      const compositeRailText = (compositeRail?.textContent || "").replace(/\s+/g, " ").trim();
      const axisAsOfRows = Array.from(document.querySelectorAll("[data-regime-axis-asof]"));
      const macroAxisAsOf = document.querySelector('[data-regime-axis-summary-card="macro"] [data-regime-axis-asof]');
      const macroAxisAsOfText = (macroAxisAsOf?.textContent || "").replace(/\s+/g, " ").trim();
      const historyPanel = document.querySelector("[data-regime-history]");
      const historyText = (historyPanel?.textContent || "").replace(/\s+/g, " ").trim();

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "regime-surface-visible", detail: "missing regime surface" });
      }
      if (!headline || headline.getBoundingClientRect().height <= 0) {
        failures.push({ check: "regime-headline-visible", detail: "missing regime headline" });
      }
      if (!activeNav) {
        failures.push({ check: "regime-market-nav-active", detail: "regime nav link is not aria-current page" });
      }
      if (!actionRail || actionRail.getBoundingClientRect().height <= 0) {
        failures.push({ check: "regime-action-rail-visible", detail: "missing regime action rail" });
      }

      const expectedNav = ["valuation", "regime", "events", "sectors"];
      const actualNav = navLinks.map((node) => node.getAttribute("data-market-section-link"));
      if (
        navLinks.length !== expectedNav.length ||
        !expectedNav.every((key, index) => actualNav[index] === key)
      ) {
        failures.push({
          check: "regime-market-nav-order",
          detail: `actual=${JSON.stringify(actualNav)} expected=${JSON.stringify(expectedNav)}`,
        });
      }

      navLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "regime-market-nav-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedAxes = ["structure", "signals", "macro", "valuation"];
      const actualSummaryAxes = summaryCards.map((node) => node.getAttribute("data-regime-axis-summary-card"));
      if (
        summaryCards.length !== expectedAxes.length ||
        !expectedAxes.every((key, index) => actualSummaryAxes[index] === key)
      ) {
        failures.push({
          check: "regime-axis-summary-order",
          detail: `actual=${JSON.stringify(actualSummaryAxes)} expected=${JSON.stringify(expectedAxes)}`,
        });
      }
      const expectedHeadColumns = ["축", "요약", "신호수", "상태"];
      if (
        !axisHead ||
        axisHead.getBoundingClientRect().height <= 0 ||
        !expectedHeadColumns.every((column) => axisHeadText.includes(column))
      ) {
        failures.push({ check: "regime-axis-table-head", detail: `head=${axisHeadText.slice(0, 80)}` });
      }
      if (
        !/^기준 \d{4}-\d{2}-\d{2}$/.test(compositeAsOfText) &&
        compositeAsOfText !== "기준일 확인 필요"
      ) {
        failures.push({ check: "regime-composite-observation-date", detail: `asOf=${compositeAsOfText || "missing"}` });
      }
      if (axisAsOfRows.length !== expectedAxes.length) {
        failures.push({ check: "regime-axis-asof-count", detail: `rows=${axisAsOfRows.length}` });
      }
      if (macroAxisAsOf && !macroAxisAsOfText.includes("기간 ")) {
        failures.push({ check: "regime-macro-period-label", detail: `asOf=${macroAxisAsOfText || "missing"}` });
      }
      if (/^기준 \d{4}-\d{2}-\d{2}$/.test(compositeAsOfText) && !compositeRailText.includes("가장 오래된 입력")) {
        failures.push({ check: "regime-oldest-input-disclosure", detail: "missing oldest input disclosure" });
      }
      if (!historyPanel || historyPanel.getBoundingClientRect().height <= 0 || historyText.length === 0) {
        failures.push({ check: "regime-history-visible", detail: "missing regime history panel" });
      }

      const expectedActions = [
        { key: "events", path: "/market/events" },
        { key: "sectors", path: "/sectors" },
        { key: "screener", path: "/screener" },
        { key: "portfolio", path: "/portfolio" },
      ];
      const actualActions = actionLinks.map((node) => node.getAttribute("data-regime-action"));
      if (
        actionLinks.length !== expectedActions.length ||
        !expectedActions.every((action, index) => actualActions[index] === action.key)
      ) {
        failures.push({
          check: "regime-action-order",
          detail: `actual=${JSON.stringify(actualActions)} expected=${JSON.stringify(expectedActions.map((action) => action.key))}`,
        });
      }
      actionLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        const href = node.getAttribute("href") || "";
        const expectedPath = expectedActions[index]?.path;
        const actualPath = href ? new URL(href, window.location.origin).pathname.replace(/\/$/, "") || "/" : "";
        if (rect.height < 44) {
          failures.push({ check: "regime-action-touch-target", detail: `action ${index} height=${Math.round(rect.height)}` });
        }
        if (expectedPath && actualPath !== expectedPath) {
          failures.push({ check: "regime-action-href", detail: `action ${index} href=${href} expected=${expectedPath}` });
        }
      });
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/market/events") {
      const surface = document.querySelector("[data-market-events-surface]");
      const owner = document.querySelector("[data-market-events-route-owner]");
      const activeNav = document.querySelector('[data-market-section-link="events"][aria-current="page"]');
      const navLinks = Array.from(document.querySelectorAll("[data-market-section-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const timeline = document.querySelector("[data-market-events-timeline]");
      const lanes = Array.from(document.querySelectorAll("[data-timeline-lane]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const drilldown = document.querySelector("[data-market-events-drilldown]");
      const drilldownRows = Array.from(document.querySelectorAll("[data-market-events-drilldown-row]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const controls = [
        { key: "search", node: document.querySelector("[data-market-events-search]") },
        { key: "section", node: document.querySelector("[data-market-events-section-filter]") },
        { key: "range", node: document.querySelector("[data-market-events-range-filter]") },
        { key: "sort", node: document.querySelector("[data-market-events-sort]") },
        { key: "csv", node: document.querySelector("[data-market-events-csv-action]") },
        { key: "from", node: document.querySelector("[data-market-events-from-date]") },
        { key: "to", node: document.querySelector("[data-market-events-to-date]") },
      ];

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-events-surface-visible", detail: "missing market events surface" });
      }
      if (!owner || owner.getAttribute("data-market-events-route-owner") !== "event-catalyst-center") {
        failures.push({
          check: "market-events-route-owner",
          detail: `owner=${owner?.getAttribute("data-market-events-route-owner") || "missing"}`,
        });
      }
      if (!activeNav) {
        failures.push({ check: "market-events-nav-active", detail: "events nav link is not aria-current page" });
      }

      const expectedNav = ["valuation", "regime", "events", "sectors"];
      const actualNav = navLinks.map((node) => node.getAttribute("data-market-section-link"));
      if (
        navLinks.length !== expectedNav.length ||
        !expectedNav.every((key, index) => actualNav[index] === key)
      ) {
        failures.push({
          check: "market-events-nav-order",
          detail: `actual=${JSON.stringify(actualNav)} expected=${JSON.stringify(expectedNav)}`,
        });
      }

      navLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "market-events-nav-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!timeline || timeline.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-events-timeline-visible", detail: "missing events timeline" });
      }

      const expectedLanes = ["macro-us", "macro-kr", "earnings", "dividend", "data-refresh", "options-expiry"];
      const actualLanes = lanes.map((node) => node.getAttribute("data-timeline-lane"));
      if (
        lanes.length !== expectedLanes.length ||
        !expectedLanes.every((key, index) => actualLanes[index] === key)
      ) {
        failures.push({
          check: "market-events-lane-order",
          detail: `actual=${JSON.stringify(actualLanes)} expected=${JSON.stringify(expectedLanes)}`,
        });
      }

      if (!drilldown || drilldown.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-events-drilldown-visible", detail: "missing drilldown panel" });
      }
      if (drilldownRows.length === 0) {
        failures.push({ check: "market-events-drilldown-populated", detail: "no visible drilldown rows" });
      }
      drilldownRows.slice(0, 5).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "market-events-drilldown-row-target", detail: `row ${index} height=${Math.round(rect.height)}` });
        }
      });

      controls.forEach(({ key, node }) => {
        if (!node || node.getBoundingClientRect().width <= 0) {
          failures.push({ check: "market-events-control-present", detail: `control=${key}` });
          return;
        }
        const rect = node.getBoundingClientRect();
        if (rect.height < 32) {
          failures.push({ check: "market-events-control-target", detail: `control=${key} height=${Math.round(rect.height)}` });
        }
      });
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/etfs") {
      const surface = document.querySelector("[data-etfs-surface]");
      const hero = document.querySelector(".etf-hero");
      const header = document.querySelector(".etf-eyebrow");
      const toolLinks = Array.from(document.querySelectorAll('.etf-tabs a[href="/etfs/compare"], .etf-tabs a[href="/etfs/new"]'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const snapshot = document.querySelector(".etf-today-grid");
      const snapshotRows = Array.from(document.querySelectorAll(".etf-today-stat"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const snapshotLabels = snapshotRows.map((node) => (node.querySelector(".etf-today-label")?.textContent || "").trim());
      const universe = document.querySelector(".etf-list-toolbar");
      const filterSelects = Array.from(document.querySelectorAll(".etf-filter-field select"));
      const controls = [
        { key: "search", node: document.querySelector(".etf-search") },
        { key: "category", node: filterSelects[0] },
        { key: "issuer", node: filterSelects[1] },
        { key: "aum", node: filterSelects[2] },
        { key: "expense", node: filterSelects[3] },
      ];
      const segmentButtons = Array.from(document.querySelectorAll(".etf-seg-pill"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const universeRows = Array.from(document.querySelectorAll(".etf-mobile-card, .etf-table-desktop tbody tr"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const loadMore = document.querySelector(".etf-load-more");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etfs-surface-visible", detail: "missing ETF center surface" });
      }
      if (!hero || hero.getBoundingClientRect().height <= 0 || !header || header.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etfs-header-visible", detail: "missing ETF header" });
      }

      const expectedToolLinks = [
        ["compare", "/etfs/compare"],
        ["new", "/etfs/new"],
      ];
      const actualToolLinks = toolLinks.map((node) => [
        (node.textContent || "").replace(/\s+/g, " ").trim(),
        node instanceof HTMLAnchorElement ? new URL(node.href, window.location.origin).pathname.replace(/\/+$/, "") : "",
      ]);
      if (
        toolLinks.length !== expectedToolLinks.length ||
        !expectedToolLinks.every((link, index) => actualToolLinks[index]?.[1] === link[1])
      ) {
        failures.push({
          check: "etfs-tool-link-order",
          detail: `actual=${JSON.stringify(actualToolLinks)} expected=${JSON.stringify(expectedToolLinks)}`,
        });
      }
      toolLinks.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etfs-tool-link-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!snapshot || snapshot.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etfs-snapshot-visible", detail: "missing ETF snapshot panel" });
      }
      if (snapshotRows.length < 3) {
        failures.push({ check: "etfs-snapshot-row-count", detail: `visible rows=${snapshotRows.length}` });
      }
      ["신규 상장 ETF", "거래량 상위 TOP 3", "변동률 상위 TOP 3"].forEach((label) => {
        if (!snapshotLabels.some((actual) => actual.includes(label))) {
          failures.push({ check: "etfs-snapshot-row-kind", detail: `missing label=${label}` });
        }
      });
      snapshotRows.slice(0, 8).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etfs-snapshot-row-target", detail: `row ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (!universe || universe.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etf-universe-visible", detail: "missing ETF universe panel" });
      }
      controls.forEach(({ key, node }) => {
        if (!node || node.getBoundingClientRect().width <= 0) {
          failures.push({ check: "etf-universe-control-present", detail: `control=${key}` });
          return;
        }
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-universe-control-target", detail: `control=${key} height=${Math.round(rect.height)}` });
        }
      });

      const expectedSegments = ["전체", "신규", "디지털자산", "레버리지", "단일종목 레버리지", "인버스"];
      const actualSegments = segmentButtons.map((node) => (node.textContent || "").replace(/\s*[\d,]+\s*$/, "").trim());
      if (
        segmentButtons.length !== expectedSegments.length ||
        !expectedSegments.every((key, index) => actualSegments[index] === key)
      ) {
        failures.push({
          check: "etf-universe-segment-order",
          detail: `actual=${JSON.stringify(actualSegments)} expected=${JSON.stringify(expectedSegments)}`,
        });
      }
      const activeSegment = segmentButtons.find((node) => node.getAttribute("aria-pressed") === "true");
      const activeSegmentLabel = (activeSegment?.textContent || "").replace(/\s*[\d,]+\s*$/, "").trim();
      if (activeSegmentLabel !== "전체") {
        failures.push({ check: "etf-universe-default-segment", detail: `active=${activeSegmentLabel}` });
      }
      segmentButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-universe-segment-target", detail: `segment ${index} height=${Math.round(rect.height)}` });
        }
      });

      if (universeRows.length < 20) {
        failures.push({ check: "etf-universe-row-count", detail: `visible rows=${universeRows.length}` });
      }
      const universeTargets = Array.from(document.querySelectorAll(".etf-mobile-card a, .etf-table-ticker"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      universeTargets.slice(0, 8).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-universe-row-target", detail: `link ${index} height=${Math.round(rect.height)}` });
        }
      });
      if (!loadMore || loadMore.getBoundingClientRect().height < 44) {
        failures.push({ check: "etf-universe-load-more-target", detail: loadMore ? `height=${Math.round(loadMore.getBoundingClientRect().height)}` : "missing load more" });
      }
    }

    {
      const detailUrl = new URL(currentRoute, window.location.origin);
      const normalizePath = (path) => (path && path !== "/" ? path.replace(/\/+$/, "") : path);
      const detailPath = normalizePath(detailUrl.pathname);
      if (/^\/etfs\/[^/]+$/.test(detailPath) && detailPath !== "/etfs/new" && detailPath !== "/etfs/compare") {
        const expectedSymbol = decodeURIComponent(detailPath.split("/").pop() || "").toUpperCase();
        const surface = document.querySelector("[data-etf-detail-surface]");
        const owner = document.querySelector("[data-etf-detail-route-owner]");
        const client = document.querySelector("[data-etf-detail-client]");
        const header = document.querySelector("[data-etf-detail-header]");
        const price = document.querySelector("[data-etf-detail-price]");
        const actionRail = document.querySelector("[data-etf-detail-action-rail]");
        const actions = Array.from(document.querySelectorAll("[data-etf-detail-owner-action]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const sections = Array.from(document.querySelectorAll("[data-etf-detail-section]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const metricCards = Array.from(document.querySelectorAll('[data-etf-detail-section="key-metrics"] [data-etf-detail-metric-card]'))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const holdings = document.querySelector('[data-etf-detail-section="holdings"]');
        const holdingsTable = document.querySelector("[data-etf-detail-holdings-table]");
        const holdingRows = Array.from(document.querySelectorAll("[data-etf-detail-holding-row]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const csvButton = document.querySelector("[data-etf-detail-holdings-csv]");
        const appTitle = document.querySelector(".fnk-shell .appbar .title");
        const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

        if (!surface || surface.getBoundingClientRect().height <= 0) {
          failures.push({ check: "etf-detail-surface-visible", detail: "missing ETF detail surface" });
        }
        if (!owner || owner.getAttribute("data-etf-detail-route-owner") !== "etf-detail") {
          failures.push({
            check: "etf-detail-route-owner",
            detail: `owner=${owner?.getAttribute("data-etf-detail-route-owner") || "missing"}`,
          });
        }
        if (!client || client.getAttribute("data-etf-detail-symbol") !== expectedSymbol) {
          failures.push({
            check: "etf-detail-symbol",
            detail: `symbol=${client?.getAttribute("data-etf-detail-symbol") || "missing"} expected=${expectedSymbol}`,
          });
        }
        if (!header || header.getBoundingClientRect().height <= 0 || !(header.textContent || "").includes(expectedSymbol)) {
          failures.push({ check: "etf-detail-header-visible", detail: `missing header for ${expectedSymbol}` });
        }
        if (!price || price.getBoundingClientRect().height <= 0) {
          failures.push({ check: "etf-detail-price-visible", detail: "missing price block" });
        }
        if (!actionRail || actionRail.getBoundingClientRect().height <= 0) {
          failures.push({ check: "etf-detail-action-rail-visible", detail: "missing action rail" });
        }

        const expectedActions = [
          ["etf-center", "/etfs", ""],
          ["compare", "/etfs/compare", expectedSymbol],
          ["portfolio", "/portfolio", expectedSymbol],
        ];
        const actualActions = actions.map((node) => {
          const url = node instanceof HTMLAnchorElement ? new URL(node.href, window.location.origin) : null;
          const path = url ? normalizePath(url.pathname) : "";
          return [
            node.getAttribute("data-etf-detail-owner-action"),
            path,
            url?.searchParams.get(path === "/portfolio" ? "ticker" : "tickers") || "",
          ];
        });
        if (
          actions.length !== expectedActions.length ||
          !expectedActions.every((action, index) => {
            const actual = actualActions[index] || [];
            const paramOk = action[2] === "" ? true : String(actual[2] || "").split(",").includes(action[2]);
            return actual[0] === action[0] && actual[1] === action[1] && paramOk;
          })
        ) {
          failures.push({
            check: "etf-detail-action-order",
            detail: `actual=${JSON.stringify(actualActions)} expected=${JSON.stringify(expectedActions)}`,
          });
        }
        actions.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "etf-detail-action-target", detail: `action ${index} height=${Math.round(rect.height)}` });
          }
        });

        const actualSections = sections.map((node) => node.getAttribute("data-etf-detail-section"));
        const expectedSections = ["key-metrics", "signals", "peers", "performance", "holdings", "asset-allocation", "sectors", "countries", "history"];
        expectedSections.forEach((section) => {
          if (!actualSections.includes(section)) {
            failures.push({ check: "etf-detail-section-visible", detail: `missing section=${section} actual=${JSON.stringify(actualSections)}` });
          }
        });
        if (metricCards.length < 4) {
          failures.push({ check: "etf-detail-key-metric-count", detail: `cards=${metricCards.length}` });
        }
        if (!holdings || holdings.getBoundingClientRect().height <= 0) {
          failures.push({ check: "etf-detail-holdings-visible", detail: "missing holdings section" });
        }
        if (!holdingsTable || holdingsTable.getBoundingClientRect().height <= 0) {
          failures.push({ check: "etf-detail-holdings-table-visible", detail: "missing holdings table" });
        }
        if (holdingRows.length < 5) {
          failures.push({ check: "etf-detail-holding-row-count", detail: `rows=${holdingRows.length}` });
        }
        if (!csvButton || csvButton.getBoundingClientRect().height < 44) {
          failures.push({ check: "etf-detail-holdings-csv-target", detail: csvButton ? `height=${Math.round(csvButton.getBoundingClientRect().height)}` : "missing csv button" });
        }

        const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
        if (!activeTabLabel.includes("더보기")) {
          failures.push({ check: "etf-detail-mobile-tab-active", detail: `active=${activeTabLabel}` });
        }
        if ((appTitle?.textContent || "").trim() !== expectedSymbol) {
          failures.push({ check: "etf-detail-app-title", detail: `title=${(appTitle?.textContent || "").trim()} expected=${expectedSymbol}` });
        }
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/etfs/new") {
      const surface = document.querySelector("[data-etf-new-surface]");
      const owner = document.querySelector("[data-etf-new-route-owner]");
      const header = document.querySelector("[data-etf-new-header]");
      const ownerLink = document.querySelector("[data-etf-new-owner-link]");
      const radar = document.querySelector("[data-etf-new-radar]");
      const controls = Array.from(document.querySelectorAll("[data-etf-new-control]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const typeFilters = Array.from(document.querySelectorAll("[data-etf-new-type-filter]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const csvButton = document.querySelector("[data-etf-new-csv]");
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etf-new-surface-visible", detail: "missing new ETF surface" });
      }
      if (!owner || owner.getAttribute("data-etf-new-route-owner") !== "new-etf-radar") {
        failures.push({
          check: "etf-new-route-owner",
          detail: `owner=${owner?.getAttribute("data-etf-new-route-owner") || "missing"}`,
        });
      }
      if (!header || header.getBoundingClientRect().height <= 0 || !(header.textContent || "").includes("신규 상장 ETF")) {
        failures.push({ check: "etf-new-header-visible", detail: "missing new ETF header" });
      }
      const ownerHref = ownerLink instanceof HTMLAnchorElement
        ? new URL(ownerLink.href, window.location.origin).pathname.replace(/\/+$/, "")
        : "";
      if (ownerHref !== "/etfs") {
        failures.push({ check: "etf-new-owner-link", detail: `href=${ownerHref || "missing"}` });
      }
      if (ownerLink && ownerLink.getBoundingClientRect().height < 44) {
        failures.push({ check: "etf-new-owner-link-target", detail: `height=${Math.round(ownerLink.getBoundingClientRect().height)}` });
      }
      if (!radar || radar.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etf-new-radar-visible", detail: "missing new ETF radar panel" });
      }

      const expectedControls = ["search", "date", "issuer", "sort"];
      const actualControls = controls.map((node) => node.getAttribute("data-etf-new-control"));
      if (
        controls.length !== expectedControls.length ||
        !expectedControls.every((key, index) => actualControls[index] === key)
      ) {
        failures.push({
          check: "etf-new-control-order",
          detail: `actual=${JSON.stringify(actualControls)} expected=${JSON.stringify(expectedControls)}`,
        });
      }
      controls.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-new-control-target", detail: `control ${index} height=${Math.round(rect.height)}` });
        }
      });

      const expectedTypes = ["전체", "레버리지", "단일종목 레버리지", "인버스"];
      const actualTypes = typeFilters.map((node) => node.getAttribute("data-etf-new-type-filter"));
      if (
        typeFilters.length !== expectedTypes.length ||
        !expectedTypes.every((key, index) => actualTypes[index] === key)
      ) {
        failures.push({
          check: "etf-new-type-filter-order",
          detail: `actual=${JSON.stringify(actualTypes)} expected=${JSON.stringify(expectedTypes)}`,
        });
      }
      [...typeFilters, csvButton].filter(Boolean).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-new-action-target", detail: `action ${index} height=${Math.round(rect.height)}` });
        }
      });

      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "etf-new-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "신규 상장 ETF") {
        failures.push({ check: "etf-new-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/etfs/compare") {
      const surface = document.querySelector("[data-etf-compare-surface]");
      const owner = document.querySelector("[data-etf-compare-route-owner]");
      const header = document.querySelector("[data-etf-compare-header]");
      const ownerLink = document.querySelector("[data-etf-compare-owner-link]");
      const panel = document.querySelector("[data-etf-compare-panel]");
      const controls = Array.from(document.querySelectorAll("[data-etf-compare-control]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const appTitle = document.querySelector(".fnk-shell .appbar .title");
      const activeMoreTab = document.querySelector(".fnk-shell .tabbar .tab.on");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etf-compare-surface-visible", detail: "missing ETF compare surface" });
      }
      if (!owner || owner.getAttribute("data-etf-compare-route-owner") !== "holdings-overlap") {
        failures.push({
          check: "etf-compare-route-owner",
          detail: `owner=${owner?.getAttribute("data-etf-compare-route-owner") || "missing"}`,
        });
      }
      if (!header || header.getBoundingClientRect().height <= 0 || !(header.textContent || "").includes("ETF 겹침 비교")) {
        failures.push({ check: "etf-compare-header-visible", detail: "missing ETF compare header" });
      }
      const ownerHref = ownerLink instanceof HTMLAnchorElement
        ? new URL(ownerLink.href, window.location.origin).pathname.replace(/\/+$/, "")
        : "";
      if (ownerHref !== "/etfs") {
        failures.push({ check: "etf-compare-owner-link", detail: `href=${ownerHref || "missing"}` });
      }
      if (ownerLink && ownerLink.getBoundingClientRect().height < 44) {
        failures.push({ check: "etf-compare-owner-link-target", detail: `height=${Math.round(ownerLink.getBoundingClientRect().height)}` });
      }
      if (!panel || panel.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etf-compare-panel-visible", detail: "missing ETF compare panel" });
      }

      const expectedControls = ["input", "submit", "csv"];
      const actualControls = controls.map((node) => node.getAttribute("data-etf-compare-control"));
      if (
        controls.length !== expectedControls.length ||
        !expectedControls.every((key, index) => actualControls[index] === key)
      ) {
        failures.push({
          check: "etf-compare-control-order",
          detail: `actual=${JSON.stringify(actualControls)} expected=${JSON.stringify(expectedControls)}`,
        });
      }
      controls.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-compare-control-target", detail: `control ${index} height=${Math.round(rect.height)}` });
        }
      });

      const activeTabLabel = (activeMoreTab?.textContent || "").replace(/\s+/g, " ").trim();
      if (!activeTabLabel.includes("더보기")) {
        failures.push({ check: "etf-compare-mobile-tab-active", detail: `active=${activeTabLabel}` });
      }
      if ((appTitle?.textContent || "").trim() !== "ETF 비교") {
        failures.push({ check: "etf-compare-app-title", detail: `title=${(appTitle?.textContent || "").trim()}` });
      }
    }

    if (currentRoute.startsWith("/screener")) {
      const isAnalyzeMode = Boolean(document.querySelector('[data-screener-mode="analyze"]'));
      const visibleCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
      });
      if (isAnalyzeMode) {
        visibleCheckboxes.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          const target = node.closest("[data-screener-checkbox-target]");
          if (!target) {
            failures.push({
              check: "screener-checkbox-target-hook",
              detail: `checkbox ${index} has no hit-target wrapper`,
            });
            return;
          }
          const targetRect = target.getBoundingClientRect();
          const pseudoStyle = window.getComputedStyle(target, "::before");
          const targetWidth = Math.max(targetRect.width, Number.parseFloat(pseudoStyle.width || "0"));
          const targetHeight = Math.max(targetRect.height, Number.parseFloat(pseudoStyle.height || "0"));
          if (targetWidth < 44 || targetHeight < 44) {
            failures.push({
              check: "screener-checkbox-target",
              detail: `checkbox ${index} target=${Math.round(targetWidth)}x${Math.round(targetHeight)}`,
            });
          }
          if (rect.width > 20 || rect.height > 20) {
            failures.push({
              check: "screener-checkbox-visual-size",
              detail: `checkbox ${index} visual=${Math.round(rect.width)}x${Math.round(rect.height)}`,
            });
          }
        });
      }

      if (isAnalyzeMode && viewportWidth < 768) {
        const mobileExpandButtons = Array.from(document.querySelectorAll('[aria-controls^="screener-mobile-detail"]'))
          .filter((node) => node.getBoundingClientRect().width > 0);
        if (mobileExpandButtons.length === 0) {
          failures.push({ check: "screener-mobile-expand-present", detail: "no visible mobile expand button" });
        }
        mobileExpandButtons.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 44 || rect.height < 44) {
            failures.push({
              check: "screener-expand-target",
              detail: `expand ${index} target=${Math.round(rect.width)}x${Math.round(rect.height)}`,
            });
          }
          const visual = node.querySelector(".cp-screener-expand-target__visual");
          const visualRect = visual?.getBoundingClientRect();
          if (!visualRect || Math.abs(visualRect.width - 39) > 1 || Math.abs(visualRect.height - 39) > 1) {
            failures.push({
              check: "screener-expand-visual-size",
              detail: `expand ${index} visual=${visualRect ? `${Math.round(visualRect.width)}x${Math.round(visualRect.height)}` : "missing"}`,
            });
          }
        });

        const mobileMetricGrid = document.querySelector('[data-testid="screener-mobile-metric-grid"]');
        const mobileMetricAlign = mobileMetricGrid
          ? window.getComputedStyle(mobileMetricGrid).alignItems
          : null;
        if (mobileMetricAlign && !["start", "flex-start"].includes(mobileMetricAlign)) {
          failures.push({
            check: "screener-mobile-metric-no-peer-stretch",
            detail: `alignItems=${mobileMetricAlign}`,
          });
        }

        const searchInput = document.querySelector("[data-canvas-plus-screener-search]");
        if (!searchInput || searchInput.getBoundingClientRect().height < 44) {
          failures.push({ check: "screener-search-target", detail: `height=${Math.round(searchInput?.getBoundingClientRect().height ?? 0)}` });
        }
        if (searchInput) {
          const style = window.getComputedStyle(searchInput);
          const textWidth = searchInput.clientWidth - parseFloat(style.paddingLeft || "0") - parseFloat(style.paddingRight || "0");
          if (textWidth < 120) {
            failures.push({ check: "screener-search-readable-width", detail: `text width=${Math.round(textWidth)}px; ticker/company query is cramped` });
          }
        }
        Array.from(document.querySelectorAll("[data-canvas-plus-screener-title] form button"))
          .filter((node) => node.getBoundingClientRect().width > 0)
          .forEach((node, index) => {
            if (node.getBoundingClientRect().height < 44) {
              failures.push({ check: "screener-search-reset-target", detail: `reset ${index} height=${Math.round(node.getBoundingClientRect().height)}` });
            }
          });
        const toolbarButtons = Array.from(document.querySelectorAll("[data-canvas-plus-screener-toolbar] button"))
          .filter((node) => node.getBoundingClientRect().width > 0);
        if (toolbarButtons.length === 0) {
          failures.push({ check: "screener-toolbar-controls", detail: "no visible toolbar controls" });
        }
        toolbarButtons.forEach((node, index) => {
          if (node.getBoundingClientRect().height < 44) {
            failures.push({ check: "screener-toolbar-target", detail: `control ${index} height=${Math.round(node.getBoundingClientRect().height)}` });
          }
        });
      }

      // The service mode keeps the desktop table/card controls hidden through
      // 920px, and the Canvas+ density control is intentionally hidden.
      if (isAnalyzeMode && viewportWidth >= 921) {
        const viewModeControl = document.querySelector("[data-screener-view-mode-control]");
        const viewModeButtons = viewModeControl
          ? Array.from(viewModeControl.querySelectorAll("[data-screener-view-mode-option]"))
            .filter((node) => node.getBoundingClientRect().width > 0)
          : [];
        const actualModes = viewModeButtons.map((node) => node.getAttribute("data-screener-view-mode-option"));
        if (viewModeButtons.length !== 2 || actualModes[0] !== "table" || actualModes[1] !== "card") {
          failures.push({ check: "screener-view-mode-control", detail: `modes=${JSON.stringify(actualModes)}` });
        }
      }

      // Desktop table renders at >=921px, paired with ScreenerClient
      // `hidden min-[921px]:block`; keep presence, column minimum, and page
      // overflow checks tied to that branch. Row/header heights are layout-owned.
      // Every rendered column honors its declared minimum
      // (ScreenerTanstackTable canvasPlusColumnWidth), table scrolls inside
      // the panel only.
      if (isAnalyzeMode && viewportWidth >= 921) {
        const desktopRows = Array.from(document.querySelectorAll('tr[data-testid="screener-desktop-row"]'))
          .filter((node) => node.getBoundingClientRect().width > 0);
        if (desktopRows.length === 0) {
          failures.push({ check: "screener-desktop-rows-present", detail: "no visible desktop rows" });
        } else {
          const columnMinWidths = {
            __select: 42,
            ticker: 160,
            name: 110,
            sector: 120,
            marketCap: 96,
            per: 96,
            fenokShortTermScore: 72,
            fenokLongTermScore: 72,
            fenokConvictionScore: 72,
            profitabilityScore: 72,
            growthScore: 72,
            technicalFlowScore: 72,
            durabilityProfitabilityScore: 72,
            upsidePotentialScore: 72,
            downsidePressureScore: 72,
            actionScore: 140,
            connectionCount: 112,
            perBandCurrent: 116,
          };
          Array.from(desktopRows[0].querySelectorAll("td[data-column-id]"))
            .filter((cell) => cell.getBoundingClientRect().width > 0)
            .forEach((cell) => {
              const columnId = cell.getAttribute("data-column-id") ?? "";
              const expected = columnMinWidths[columnId] ?? 88;
              const width = cell.getBoundingClientRect().width;
              if (width < expected - 1) {
                failures.push({ check: "screener-column-min-width", detail: `${columnId} width=${Math.round(width)} expected>=${expected}` });
              }
            });
        }
        if (document.documentElement.scrollWidth > window.innerWidth + 1) {
          failures.push({ check: "screener-no-page-scroll", detail: `scrollWidth=${document.documentElement.scrollWidth} innerWidth=${window.innerWidth}` });
        }
      }
      // Discover mode (default /screener): five question cards + mode toggle.
      // Runs on every viewport (mobile/narrow included) so the <768 card
      // touch check below is reachable. Existing analyze assertions above
      // stay untouched.
      const discoverRoot = document.querySelector('[data-discover="true"]');
      if (discoverRoot) {
        const discoverCards = Array.from(document.querySelectorAll("[data-discover-card]"))
          .filter((node) => node.getBoundingClientRect().width > 0);
        if (discoverCards.length !== 5) {
          failures.push({ check: "screener-discover-cards", detail: `cards=${discoverCards.length}` });
        }
        const modeToggle = document.querySelector('[data-screener-mode-toggle="true"]');
        if (!modeToggle || modeToggle.getBoundingClientRect().width <= 0) {
          failures.push({ check: "screener-discover-mode-toggle", detail: "missing visible mode toggle" });
        }
        if (viewportWidth < 768) {
          discoverCards.forEach((node, index) => {
            if (node.getBoundingClientRect().height < 44) {
              failures.push({ check: "screener-discover-card-target", detail: `card ${index} height=${Math.round(node.getBoundingClientRect().height)}` });
            }
          });
        }
      }
    }

    if (currentRoute.startsWith("/sectors")) {
      if (viewportWidth < 768) {
        const periodToggle = document.querySelector("[data-sectors-period-toggle]");
        const periodButtons = Array.from(document.querySelectorAll("[data-sectors-period-toggle] button"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!periodToggle || periodToggle.getBoundingClientRect().height <= 0) {
          failures.push({ check: "sector-period-toggle-visible", detail: "missing visible sector period toggle" });
        }

        const expectedPeriods = ["1주", "1개월", "3개월", "6개월", "연초이후"];
        const actualPeriods = periodButtons.map((node) => (node.textContent || "").replace(/\s+/g, " ").trim());
        if (
          periodButtons.length !== expectedPeriods.length ||
          !expectedPeriods.every((period, index) => actualPeriods[index] === period)
        ) {
          failures.push({
            check: "sector-period-toggle-buttons",
            detail: `actual=${JSON.stringify(actualPeriods)} expected=${JSON.stringify(expectedPeriods)}`,
          });
        }
        periodButtons.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "sector-period-toggle-target", detail: `period ${index} height=${Math.round(rect.height)}` });
          }
        });
      }

      const relativeBars = document.querySelector("[data-sectors-flow-rows]");
      const relativeBarRows = Array.from(document.querySelectorAll("[data-sectors-flow-row]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const relativeSides = new Set(relativeBarRows.map((node) => node.getAttribute("data-sectors-flow-side")));
      if (!relativeBars || relativeBars.getBoundingClientRect().height <= 0) {
        failures.push({ check: "sector-relative-bars-visible", detail: "missing S&P relative bar strip" });
      }
      if (relativeBarRows.length === 0) {
        failures.push({ check: "sector-relative-bars-populated", detail: "no visible relative bar rows" });
      }
      if (!relativeSides.has("up") && !relativeSides.has("down")) {
        failures.push({ check: "sector-relative-bars-side", detail: `sides=${JSON.stringify(Array.from(relativeSides))}` });
      }
      relativeBarRows.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "sector-relative-bar-target", detail: `row ${index} height=${Math.round(rect.height)}` });
        }
      });
    }

    if (currentRoute.startsWith("/portfolio")) {
      const editButtons = Array.from(document.querySelectorAll('button[aria-label$="수정 입력"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      const deleteButtons = Array.from(document.querySelectorAll('button[aria-label$="삭제"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (editButtons.length === 0) {
        failures.push({ check: "portfolio-edit-present", detail: "no visible edit action" });
      }
      if (deleteButtons.length === 0) {
        failures.push({ check: "portfolio-delete-present", detail: "no visible delete action" });
      }
      [...editButtons, ...deleteButtons].forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          failures.push({
            check: "portfolio-action-target",
            detail: `button ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });
      const connectionActions = Array.from(document.querySelectorAll('[data-portfolio-touch-action]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (connectionActions.length === 0) {
        failures.push({ check: "portfolio-connection-action-present", detail: "no visible connection action" });
      }
      connectionActions.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 44 || rect.height < 44) {
          failures.push({
            check: "portfolio-connection-action-target",
            detail: `action ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });
      const managementSections = [
        { key: "holdings", node: document.querySelector('[data-portfolio-section="holdings"]') },
        { key: "add-holding", node: document.querySelector('[data-portfolio-section="add-holding"]') },
        { key: "cash", node: document.querySelector('[data-portfolio-section="cash"]') },
      ];
      const connectionSection = document.querySelector('[data-portfolio-section="connections"]');
      if (!connectionSection || managementSections.some((entry) => !entry.node)) {
        failures.push({
          check: "portfolio-management-sections-present",
          detail: JSON.stringify({
            connection: Boolean(connectionSection),
            management: managementSections.map((entry) => [entry.key, Boolean(entry.node)]),
          }),
        });
      } else {
        const connectionTop = connectionSection.getBoundingClientRect().top;
        const lateSection = managementSections.find((entry) => entry.node.getBoundingClientRect().top > connectionTop);
        if (lateSection) {
          failures.push({
            check: "portfolio-management-before-connections",
            detail: `${lateSection.key} starts after connection service`,
          });
        }
      }
    }

    if (currentRoute.startsWith("/stock/")) {
      const stockRouteParams = new URL(currentRoute, window.location.origin).searchParams;
      const stockTab = stockRouteParams.get("tab") || "overview";
      const tabs = document.querySelector(".stock-tabs");
      if (tabs) {
        const overflowed = tabs.scrollWidth > tabs.clientWidth + 1;
        if (overflowed && !tabs.classList.contains("can-scroll")) {
          failures.push({
            check: "stock-tabs-scroll-affordance",
            detail: `scrollWidth=${tabs.scrollWidth} clientWidth=${tabs.clientWidth}`,
          });
        }
        const stockTabLabels = Array.from(tabs.querySelectorAll('[role="tab"]'))
          .filter((node) => node.getBoundingClientRect().width > 0)
          .map((node) => (node.textContent || "").replace(/\s+/g, " ").trim());
        const expectedStockTabOrder = ["요약", "밸류", "추정치", "재무", "보유기관", "공시"];
        if (stockTabLabels.includes("요약") && stockTabLabels.includes("공시")) {
          const actualPrimaryOrder = stockTabLabels.filter((label) => expectedStockTabOrder.includes(label));
          const orderOk =
            actualPrimaryOrder.length === expectedStockTabOrder.length &&
            expectedStockTabOrder.every((label, index) => actualPrimaryOrder[index] === label);
          if (!orderOk) {
            failures.push({
              check: "stock-pro-tab-order",
              detail: `actual=${JSON.stringify(stockTabLabels)} expected=${JSON.stringify(expectedStockTabOrder)}`,
            });
          }
        }
      }
      if (stockTab === "overview") {
        const summaryModules = Array.from(document.querySelectorAll("[data-stock-summary-module]"))
          .map((node) => ({
            key: node.getAttribute("data-stock-summary-module"),
            rect: node.getBoundingClientRect(),
          }))
          .filter((entry) => entry.rect.width > 0 && entry.rect.height > 0);
        const summaryScore = summaryModules.find((entry) => entry.key === "summary-score");
        if (!summaryScore) {
          failures.push({
            check: "stock-summary-action-strip-visible",
            detail: `modules=${JSON.stringify(summaryModules.map((entry) => entry.key))}`,
          });
        }
        if (summaryScore) {
          const axisLinks = Array.from(document.querySelectorAll("[data-stock-summary-axis-link]"))
            .filter((node) => {
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
          const expectedAxes = [
            ["밸류에이션", "statistics"],
            ["미래 성장", "estimates"],
            ["과거 실적", "financials"],
            ["재무 건전성", "financials"],
            ["배당", "financials"],
          ];
          const actualAxes = axisLinks.map((node) => [
            node.getAttribute("data-stock-summary-axis"),
            node.getAttribute("data-stock-summary-axis-tab"),
          ]);
          if (
            axisLinks.length !== expectedAxes.length ||
            !expectedAxes.every((axis, index) => actualAxes[index]?.[0] === axis[0] && actualAxes[index]?.[1] === axis[1])
          ) {
            failures.push({
              check: "stock-summary-axis-link-order",
              detail: `actual=${JSON.stringify(actualAxes)} expected=${JSON.stringify(expectedAxes)}`,
            });
          }
          axisLinks.forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.height < 44) {
              failures.push({ check: "stock-summary-axis-touch-target", detail: `axis ${index} height=${Math.round(rect.height)}` });
            }
          });
        }
        const valuationTrack = document.querySelector("[data-stock-valuation-band-track]");
        if (valuationTrack) {
          const valuationVerdict = document.querySelector("[data-stock-valuation-verdict]");
          const valuationZones = Array.from(document.querySelectorAll("[data-stock-valuation-zone]"))
            .map((node) => node.getAttribute("data-stock-valuation-zone"));
          const expectedZones = ["deep-discount", "discount", "neutral", "premium", "overheated"];
          if (!valuationTrack || valuationTrack.getBoundingClientRect().height <= 0) {
            failures.push({ check: "stock-valuation-band-track-visible", detail: "missing visible graduated valuation track" });
          }
          if (!valuationVerdict || !(valuationVerdict.textContent || "").trim()) {
            failures.push({ check: "stock-valuation-verdict-present", detail: "missing plain-language valuation verdict" });
          }
          if (
            valuationZones.length !== expectedZones.length ||
            !expectedZones.every((zone, index) => valuationZones[index] === zone)
          ) {
            failures.push({
              check: "stock-valuation-graduated-zones",
              detail: `actual=${JSON.stringify(valuationZones)} expected=${JSON.stringify(expectedZones)}`,
            });
          }
        }
      }
      if (stockTab === "filings") {
        const embeddedFilings = document.querySelector('[data-stock-tab-card="filings"]');
        const coverageBanner = document.querySelector("[data-edgar-coverage-banner]");
        const autoSummaryWarning = document.querySelector("[data-edgar-auto-summary-warning]");
        const generationSource = document.querySelector("[data-edgar-generation-source]");
        const visibleOverviewModules = Array.from(document.querySelectorAll("[data-stock-summary-module]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!embeddedFilings || embeddedFilings.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-filings-embedded-visible", detail: "missing visible embedded filings surface" });
        }
        if (coverageBanner) {
          failures.push({ check: "stock-filings-no-coverage-banner", detail: "embedded filings tab should not repeat the coverage banner" });
        }
        if (autoSummaryWarning) {
          failures.push({ check: "stock-filings-no-auto-summary-warning", detail: "embedded filings tab should not repeat standalone auto-summary warning" });
        }
        if ((generationSource?.textContent || "").includes("AI")) {
          failures.push({ check: "stock-filings-no-ai-noise-copy", detail: (generationSource?.textContent || "").trim() });
        }
        if (visibleOverviewModules.length > 0) {
          failures.push({
            check: "stock-filings-tab-specific-content",
            detail: `overview modules visible=${visibleOverviewModules.map((node) => node.getAttribute("data-stock-summary-module")).join(",")}`,
          });
        }
      }
      if (stockTab === "ownership") {
        const diff = document.querySelector('[data-smart-money-section="diff"]');
        const holdings = document.querySelector('[data-smart-money-section="holdings"]');
        const asOf = document.querySelector("[data-smart-money-asof]");
        const lagDisclosure = document.querySelector("[data-smart-money-lag-disclosure]");
        const reportColumn = document.querySelector("[data-smart-money-report-date-column]");
        const reportCells = Array.from(document.querySelectorAll("[data-smart-money-report-date-cell]"))
          .filter((node) => node.getBoundingClientRect().width > 0);
        if (!diff || !holdings || !asOf) {
          failures.push({
            check: "stock-smart-money-diff-modules-present",
            detail: JSON.stringify({ diff: Boolean(diff), holdings: Boolean(holdings), asOf: Boolean(asOf) }),
          });
        } else if (diff.getBoundingClientRect().top > holdings.getBoundingClientRect().top + 1) {
          failures.push({
            check: "stock-smart-money-diff-before-holdings",
            detail: `diffTop=${diff.getBoundingClientRect().top} holdingsTop=${holdings.getBoundingClientRect().top}`,
          });
        }
        if (!lagDisclosure || !(lagDisclosure.textContent || "").includes("최대 45일 지연")) {
          failures.push({ check: "stock-smart-money-13f-lag-disclosure", detail: lagDisclosure?.textContent || "missing lag disclosure" });
        }
        if (!reportColumn || reportCells.length === 0) {
          failures.push({
            check: "stock-smart-money-report-date-column",
            detail: JSON.stringify({ reportColumn: Boolean(reportColumn), reportCells: reportCells.length }),
          });
        }
        // Top Guru holder rows are two-line (name line, then metrics line):
        // every visible row must carry a non-empty rank label and its name
        // and metrics lines must not overlap each other at this viewport.
        const holderRows = Array.from(document.querySelectorAll('[data-smart-money-section="holdings"] [data-smart-money-report-date-cell]'))
          .filter((node) => node.getBoundingClientRect().width > 0);
        holderRows.forEach((row, index) => {
          const nameEl = row.querySelector("[data-guru-holder-name]");
          const metricsEl = row.querySelector("[data-guru-holder-metrics]");
          if (!nameEl || !((nameEl.textContent || "").trim())) {
            failures.push({ check: "stock-guru-holder-name-present", detail: `row=${index} empty rank label viewport=${window.innerWidth}` });
            return;
          }
          if (!metricsEl) {
            failures.push({ check: "stock-guru-holder-metrics-present", detail: `row=${index} missing metrics line viewport=${window.innerWidth}` });
            return;
          }
          const nameRect = nameEl.getBoundingClientRect();
          const metricsRect = metricsEl.getBoundingClientRect();
          const separated = metricsRect.left >= nameRect.right - 1
            || metricsRect.right <= nameRect.left + 1
            || metricsRect.top >= nameRect.bottom - 1
            || metricsRect.bottom <= nameRect.top + 1;
          if (!separated) {
            failures.push({
              check: "stock-guru-holder-row-geometry",
              detail: `row=${index} name/metrics overlap viewport=${window.innerWidth}`,
            });
          }
        });
      }
      if (stockTab === "estimates") {
        const disclosure = document.querySelector("[data-stock-estimate-disclosure]");
        if (!disclosure || disclosure.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-estimate-disclosure-present", detail: "missing visible estimate source/EPS basis disclosure" });
        }
        const consensusSummary = document.querySelector("[data-stock-estimates-consensus-summary]");
        const consensusCards = Array.from(document.querySelectorAll("[data-stock-estimates-consensus-card]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const granularityControl = document.querySelector("[data-stock-estimates-granularity-control]");
        const granularityButtons = Array.from(document.querySelectorAll("[data-stock-estimates-granularity]"))
          .filter((node) => node.getBoundingClientRect().width > 0);
        const annualPanel = document.querySelector("[data-stock-estimates-annual-panel]");
        const detailTable = document.querySelector("[data-stock-estimates-detail-table]");
        if (!consensusSummary || consensusSummary.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-estimates-consensus-summary-visible", detail: "missing visible consensus summary" });
        }
        if (consensusCards.length < 4) {
          failures.push({ check: "stock-estimates-consensus-card-count", detail: `cards=${consensusCards.length}` });
        }
        const expectedGranularity = ["annual", "quarterly"];
        const actualGranularity = granularityButtons.map((node) => node.getAttribute("data-stock-estimates-granularity"));
        if (
          !granularityControl ||
          granularityButtons.length !== expectedGranularity.length ||
          !expectedGranularity.every((key, index) => actualGranularity[index] === key)
        ) {
          failures.push({
            check: "stock-estimates-granularity-control",
            detail: `actual=${JSON.stringify(actualGranularity)} expected=${JSON.stringify(expectedGranularity)}`,
          });
        }
        if (consensusSummary && detailTable) {
          const summaryTop = consensusSummary.getBoundingClientRect().top;
          const detailTop = detailTable.getBoundingClientRect().top;
          if (summaryTop > detailTop + 1) {
            failures.push({
              check: "stock-estimates-consensus-before-detail",
              detail: `summaryTop=${summaryTop} detailTop=${detailTop}`,
            });
          }
        }
        if (!annualPanel || annualPanel.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-estimates-annual-panel-visible", detail: "missing visible annual estimates panel" });
        }
      }
      if (stockTab === "financials" || stockTab === "estimates") {
        const financialTables = Array.from(document.querySelectorAll("[data-stock-financial-table]"))
          .filter((table) => table.getBoundingClientRect().width > 0 && table.getBoundingClientRect().height > 0);
        if (financialTables.length === 0) {
          failures.push({ check: "stock-financial-table-present", detail: `tab=${stockTab}` });
        }
        financialTables.forEach((table, tableIndex) => {
          const firstHeader = table.querySelector("thead th:first-child");
          const firstCell = table.querySelector("tbody tr td:first-child");
          [
            { kind: "header", node: firstHeader },
            { kind: "cell", node: firstCell },
          ].forEach((entry) => {
            if (!entry.node) {
              failures.push({ check: "stock-financial-sticky-first-column-node", detail: `table=${tableIndex} missing=${entry.kind}` });
              return;
            }
            const style = window.getComputedStyle(entry.node);
            const left = Number.parseFloat(style.left || "999");
            if (style.position !== "sticky" || Math.abs(left) > 1) {
              failures.push({
                check: "stock-financial-sticky-first-column",
                detail: `table=${tableIndex} ${entry.kind} position=${style.position} left=${style.left}`,
              });
            }
          });
        });
      }
      if (stockTab === "financials") {
        const dividendPanel = document.querySelector('[data-stock-dividend-panel][id="dividend"]');
        if (!dividendPanel || dividendPanel.getBoundingClientRect().height <= 0) {
          failures.push({ check: "stock-dividend-panel-visible", detail: "missing visible #dividend panel on financials tab" });
        } else {
          const panelText = dividendPanel.textContent || "";
          [
            ["배당수익률", "yield"],
            ["배당성향", "payout"],
            ["배당 이력", "history"],
          ].forEach(([label, key]) => {
            const metric = dividendPanel.querySelector(`[data-stock-dividend-metric="${key}"]`);
            if (!metric || !(metric.textContent || "").includes(label)) {
              failures.push({ check: "stock-dividend-panel-label", detail: `missing ${label} (${key}); text=${panelText.slice(0, 120)}` });
            }
          });
        }
        const rowChartButtons = Array.from(document.querySelectorAll("[data-stock-financial-row-chart-button]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (rowChartButtons.length < 4) {
          failures.push({ check: "stock-financial-row-chart-buttons", detail: `visible buttons=${rowChartButtons.length}` });
        }
        rowChartButtons.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.width < 36 || rect.height < 28) {
            failures.push({
              check: "stock-financial-row-chart-target",
              detail: `button ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
            });
          }
        });
      }
    }

    if (currentRoute.startsWith("/superinvestors")) {
      const regions = Array.from(document.querySelectorAll('.scroll-hint-x[role="region"][tabindex="0"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (regions.length === 0) {
        failures.push({ check: "superinvestors-scroll-region", detail: "no visible scroll-hint region" });
      }
      const surface = document.querySelector("[data-superinvestors-surface]");
      const eyebrow = document.querySelector("[data-superinvestors-eyebrow]");
      const count = document.querySelector("[data-superinvestors-count]");
      const quarterPill = document.querySelector("[data-superinvestors-quarter]");
      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "superinvestors-surface", detail: "missing visible light-system surface" });
      }
      if (!eyebrow || !/13F/.test(eyebrow.textContent || "") || !/\d{4}-Q\d/.test(eyebrow.textContent || "")) {
        failures.push({ check: "superinvestors-header-quarter", detail: `eyebrow=${eyebrow?.textContent || ""}` });
      }
      if (!count || !/\d+명/.test(count.textContent || "")) {
        failures.push({ check: "superinvestors-header-count", detail: `count=${count?.textContent || ""}` });
      }
      if (!quarterPill || !/\d{4}-Q\d/.test(quarterPill.textContent || "")) {
        failures.push({ check: "superinvestors-header-asof", detail: `asof=${quarterPill?.textContent || ""}` });
      }
      const lagNote = Array.from(document.querySelectorAll(".sup-cta-note")).map((node) => node.textContent || "").join(" ");
      if (!lagNote.includes("45")) {
        failures.push({ check: "superinvestors-13f-lag", detail: `footer=${lagNote.slice(0, 80)}` });
      }
      // V3 tabs: holders/overlap live under the investors tab. S6: ?guru=
      // opens a dedicated detail view that replaces the list; the list is
      // asserted on the ?tab=investors route instead. Inactive tabs unmount,
      // so each route asserts only its visible tab; hooks are unchanged.
      const isGuruRoute = currentRoute.includes("guru=");
      const isInvestorsRoute = currentRoute.includes("tab=investors");
      const isStocksRoute = currentRoute.includes("tab=stocks");
      const sortBtns = Array.from(document.querySelectorAll("[data-superinvestors-sort]"));
      const tabBtns = Array.from(document.querySelectorAll("[data-superinvestors-tab]"));
      if (tabBtns.length !== 6 || tabBtns.filter((btn) => btn.getAttribute("aria-selected") === "true").length !== 1) {
        failures.push({ check: "superinvestors-tabs", detail: `tabs=${tabBtns.length}` });
      }
      const tabIds = tabBtns.map((btn) => btn.getAttribute("data-superinvestors-tab"));
      const expectedTabIds = ["signal", "investors", "stocks", "trades", "insights", "graph"];
      if (expectedTabIds.some((id) => !tabIds.includes(id))) {
        failures.push({ check: "superinvestors-tab-ids", detail: `tabs=${tabIds.join(",")}` });
      }
      if (viewportWidth <= 600 || window.matchMedia("(any-pointer: coarse)").matches) {
        for (const tab of tabBtns) {
          const rect = tab.getBoundingClientRect();
          const region = tab.closest(".sup-tabs")?.getBoundingClientRect();
          const left = Math.max(0, region?.left ?? 0);
          const right = Math.min(viewportWidth, region?.right ?? viewportWidth);
          if (rect.left < left - 1 || rect.right > right + 1 || rect.height < 44) {
            failures.push({ check: "superinvestors-tabs-discoverable", detail: `${tab.textContent?.trim()}: bounds=${Math.round(rect.left)}..${Math.round(rect.right)}, available=${Math.round(left)}..${Math.round(right)}, height=${Math.round(rect.height)}` });
          }
        }
      }
      if (isGuruRoute) {
        const params = new URLSearchParams(currentRoute.split("?")[1] || "");
        const guruId = params.get("guru") || "";
        const detail = document.querySelector(`[data-superinvestors-guru-detail-view][data-superinvestors-holder-detail-id="${guruId}"]`);
        if (!detail || detail.getBoundingClientRect().height <= 0 || !/\d{4}-Q\d/.test(detail.textContent || "")) {
          failures.push({ check: "superinvestors-guru-detail", detail: "missing visible guru detail with quarter" });
        }
        const back = detail?.querySelector("[data-superinvestors-guru-back]");
        if (!back || back.getBoundingClientRect().height < 44) {
          failures.push({ check: "superinvestors-guru-back", detail: "missing visible back control" });
        }
      } else if (isStocksRoute) {
        const input = document.querySelector("[data-superinvestors-whoholds-input]");
        if (!input || input.getBoundingClientRect().width <= 0) {
          failures.push({ check: "superinvestors-stocks-search", detail: "missing visible stock holdings search" });
        }
      } else if (isInvestorsRoute) {
        const holders = document.querySelector("[data-superinvestors-holders]");
        const holderRows = Array.from(document.querySelectorAll("[data-superinvestors-holder-row]"));
        const headCells = Array.from(holders?.querySelectorAll("thead th") || []);
        if (!holders || holders.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-holders", detail: "missing visible holders panel" });
        }
        if (holderRows.length < 10) {
          failures.push({ check: "superinvestors-holder-rows", detail: `rows=${holderRows.length}` });
        }
        if (headCells.length !== 5) {
          failures.push({ check: "superinvestors-holder-columns", detail: `columns=${headCells.length}` });
        }
        if (sortBtns.length !== 3 || sortBtns.filter((btn) => btn.getAttribute("aria-pressed") === "true").length !== 1) {
          failures.push({ check: "superinvestors-sort-tabs", detail: `tabs=${sortBtns.length}` });
        }
        const holderCells = holderRows[0]?.querySelectorAll("th, td").length ?? 0;
        if (holderRows.length > 0 && holderCells !== 5) {
          failures.push({ check: "superinvestors-holder-row-cells", detail: `cells=${holderCells}` });
        }
        if (viewportWidth <= 1199) {
          holderRows.slice(0, 5).forEach((row, index) => {
            for (const cell of row.querySelectorAll("th, td")) {
              const rect = cell.getBoundingClientRect();
              if (rect.width <= 0 || rect.left < -1 || rect.right > viewportWidth + 1) {
                failures.push({ check: "superinvestors-holder-fields-visible", detail: `row=${index} field=${cell.textContent?.trim().slice(0, 30)} left=${rect.left} right=${rect.right}` });
              }
            }
          });
        }
        const overlap = document.querySelector("[data-superinvestors-overlap]");
        const overlapRows = Array.from(document.querySelectorAll("[data-superinvestors-overlap-row]"));
        if (!overlap || overlap.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-overlap", detail: "missing visible overlap panel" });
        }
        if (overlapRows.length !== 4) {
          failures.push({ check: "superinvestors-overlap-rows", detail: `rows=${overlapRows.length}` });
        }
        const overlapHolders = overlapRows.map((node) => Number.parseInt(node.getAttribute("data-superinvestors-overlap-holders") || "", 10));
        const overlapDesc = overlapHolders.every((value, index) => index === 0 || (Number.isFinite(value) && Number.isFinite(overlapHolders[index - 1]) && overlapHolders[index - 1] >= value));
        if (overlapHolders.length !== overlapRows.length || !overlapDesc) {
          failures.push({ check: "superinvestors-overlap-sort", detail: `holders=${JSON.stringify(overlapHolders)}` });
        }
        overlapRows
          .filter((row) => row.getBoundingClientRect().width > 0 && row.getBoundingClientRect().height > 0)
          .forEach((row, index) => {
            const rowRect = row.getBoundingClientRect();
            const cells = Array.from(row.children).slice(0, 3);
            const cellRects = cells.map((cell) => cell.getBoundingClientRect());
            if (cells.length !== 3) {
              failures.push({ check: "superinvestors-overlap-row-cells", detail: `row=${index} cells=${cells.length}` });
              return;
            }
            cellRects.forEach((rect, cellIndex) => {
              const cell = cells[cellIndex];
              if (rect.left < rowRect.left - 1 || rect.right > rowRect.right + 1) {
                failures.push({ check: "superinvestors-overlap-cell-containment", detail: `row=${index} cell=${cellIndex} bounds=${Math.round(rect.left)}..${Math.round(rect.right)} row=${Math.round(rowRect.left)}..${Math.round(rowRect.right)}` });
              }
              const textWidth = Math.max(cell.scrollWidth, cell.clientWidth);
              if (textWidth > cell.clientWidth + 1) {
                failures.push({ check: "superinvestors-overlap-text-containment", detail: `row=${index} cell=${cellIndex} scrollWidth=${textWidth} clientWidth=${cell.clientWidth}` });
              }
            });
            for (let cellIndex = 1; cellIndex < cellRects.length; cellIndex += 1) {
              if (cellRects[cellIndex].left - cellRects[cellIndex - 1].right < 7) {
                failures.push({ check: "superinvestors-overlap-cell-separation", detail: `row=${index} cells=${cellIndex - 1}/${cellIndex} right=${Math.round(cellRects[cellIndex - 1].right)} nextLeft=${Math.round(cellRects[cellIndex].left)}` });
              }
            }
          });
      } else if (/tab=(trades|insights|graph)(?:&|$)/.test(currentRoute)) {
        const selectedTab = new URLSearchParams(currentRoute.split("?")[1] || "").get("tab");
        const selectors = { trades: "[data-superinvestor-trades-panel]", insights: "[data-superinvestor-insights-status]", graph: "[data-superinvestors-graph]" };
        const panel = document.querySelector(selectors[selectedTab]);
        if (!panel || panel.getBoundingClientRect().height <= 0) failures.push({ check: "superinvestors-active-tab-content", detail: selectedTab });
        const active = document.querySelector(`[data-superinvestors-tab="${selectedTab}"]`);
        if (active?.getAttribute("aria-selected") !== "true") failures.push({ check: "superinvestors-active-tab-identity", detail: selectedTab });
      } else {
        const signalLists = Array.from(document.querySelectorAll("[data-superinvestors-signal-list]"))
          .filter((node) => node.getBoundingClientRect().height > 0);
        const signalRows = Array.from(document.querySelectorAll("[data-superinvestors-signal-row]"))
          .filter((node) => node.getBoundingClientRect().height > 0);
        const followBtns = Array.from(document.querySelectorAll("[data-superinvestors-follow]"));
        if (signalLists.length !== 3) {
          failures.push({ check: "superinvestors-signal-lists", detail: `lists=${signalLists.length}` });
        }
        if (signalRows.length < 3) {
          failures.push({ check: "superinvestors-signal-rows", detail: `rows=${signalRows.length}` });
        }
        if (followBtns.length !== 2 || followBtns.filter((btn) => btn.getAttribute("aria-pressed") === "true").length !== 1) {
          failures.push({ check: "superinvestors-follow-toggle", detail: `tabs=${followBtns.length}` });
        }
        const whoholds = document.querySelector("[data-superinvestors-whoholds]");
        const whoholdsInput = document.querySelector("[data-superinvestors-whoholds-input]");
        if (!whoholds || whoholds.getBoundingClientRect().height <= 0 || !whoholdsInput || whoholdsInput.getBoundingClientRect().width <= 0) {
          failures.push({ check: "superinvestors-whoholds", detail: "missing visible who-holds search" });
        }
        followBtns.forEach((btn, index) => {
          const rect = btn.getBoundingClientRect();
          if (rect.height < 32 || rect.width <= 0) {
            failures.push({ check: "superinvestors-follow-touch-target", detail: `follow ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}` });
          }
        });
      }
      // The graph teaser lives in the investors-tab rail; the guru detail
      // view replaces that grid, so skip the teaser check on guru routes.
      const graphTeaser = document.querySelector("[data-superinvestors-graph-teaser]");
      if (isInvestorsRoute && !isGuruRoute && (!graphTeaser || graphTeaser.getBoundingClientRect().height <= 0 || !/그래프 보기/.test(graphTeaser.textContent || ""))) {
        failures.push({ check: "superinvestors-graph-teaser", detail: "missing visible graph teaser" });
      }
      sortBtns.forEach((btn, index) => {
        const rect = btn.getBoundingClientRect();
        if (rect.height < 32 || rect.width <= 0) {
          failures.push({ check: "superinvestors-sort-touch-target", detail: `tab ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}` });
        }
      });
      if (viewportWidth < 768) {
        Array.from(document.querySelectorAll("[data-superinvestors-holder-row]"))
          .filter((node) => node.getBoundingClientRect().width > 0)
          .forEach((node, index) => {
            const rect = node.getBoundingClientRect();
            if (rect.height < 44) {
              failures.push({ check: "superinvestors-holder-button-target", detail: `holder ${index} height=${Math.round(rect.height)}` });
            }
          });
      }
      // overlap + graph + guru checks live above; route-wide link checks retired
      // with the tab-specific panels (fh-590 light-system single view).
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectCohortPaintProbe(page) {
  const samples = [];
  for (const delayMs of [100, 1000, 5000]) {
    await page.waitForTimeout(delayMs);
    samples.push(await page.evaluate(() => {
      const panel = document.querySelector("[data-superinvestor-cohort-treemap]");
      const canvas = panel?.querySelector("canvas");
      if (!canvas) return { canvas: false, count: panel?.getAttribute("data-superinvestor-cohort-treemap-count") };
      const rect = canvas.getBoundingClientRect();
      const style = getComputedStyle(canvas);
      let ink = 0;
      try {
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        for (let i = 0; i < pixels.length; i += 64) {
          if (pixels[i + 3] > 0 && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) < 240) ink += 1;
        }
      } catch (error) { return { canvas: true, error: String(error) }; }
      return { canvas: true, width: rect.width, height: rect.height, backingWidth: canvas.width, backingHeight: canvas.height, ink, opacity: style.opacity, visibility: style.visibility };
    }));
  }
  return samples;
}

async function collectScreenerExpandedChecks(page, route) {
  const viewport = page.viewportSize();
  if (!viewport || !isAnalyzeScreenerRoute(route) || viewport.width >= 768) {
    return {
      route,
      viewportWidth: viewport?.width ?? null,
      scrollWidth: null,
      failures: [],
    };
  }

  const button = page.locator('[aria-controls^="screener-mobile-detail"]:visible').first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "screener-expanded-click-target", detail: "no mobile detail button to click" }],
    };
  }

  await button.click({ timeout: 10000 });
  await page.waitForTimeout(500);

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const detail = document.querySelector('[id^="screener-mobile-detail"]');
    const primaryCta = detail?.querySelector('.cpw4-primary-cta');

    if (!detail || detail.getBoundingClientRect().height <= 0) {
      failures.push({ check: "screener-expanded-detail-visible", detail: "expanded detail panel not visible" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "screener-expanded-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }
    if (!primaryCta) {
      failures.push({ check: "screener-expanded-primary-cta", detail: "expanded detail primary CTA missing" });
    } else {
      const style = window.getComputedStyle(primaryCta);
      if (style.color === style.backgroundColor) {
        failures.push({
          check: "screener-expanded-primary-cta-contrast",
          detail: `color=${style.color} background=${style.backgroundColor}`,
        });
      }
      if (style.webkitTapHighlightColor !== "rgba(0, 0, 0, 0)") {
        failures.push({
          check: "screener-expanded-primary-cta-tap-highlight",
          detail: `tapHighlight=${style.webkitTapHighlightColor}`,
        });
      }
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectScreenerCheckboxTargetChecks(page, route) {
  const viewport = page.viewportSize();
  if (!viewport || !isAnalyzeScreenerRoute(route) || viewport.width >= 768) {
    return { route, failures: [] };
  }

  const checkbox = page.locator('[data-screener-stock-card] [data-screener-checkbox-target] input[type="checkbox"]:visible').first();
  if ((await checkbox.count()) === 0) {
    return {
      route,
      failures: [{ check: "screener-checkbox-target-click", detail: "no visible card checkbox" }],
    };
  }

  await checkbox.scrollIntoViewIfNeeded();
  const hitArea = await checkbox.evaluate((node) => {
    const target = node.closest("[data-screener-checkbox-target]");
    const targetRect = target?.getBoundingClientRect();
    const checkboxRect = node.getBoundingClientRect();
    const pseudoStyle = target ? window.getComputedStyle(target, "::before") : null;
    const candidatePoints = targetRect ? [
      { x: targetRect.right - 2, y: targetRect.top + (targetRect.height / 2) },
      { x: targetRect.left + 2, y: targetRect.top + (targetRect.height / 2) },
      { x: targetRect.left + (targetRect.width / 2), y: targetRect.bottom - 2 },
      { x: targetRect.left + (targetRect.width / 2), y: targetRect.top + 2 },
    ] : [];
    const hitPoint = candidatePoints.find((point) => {
      const insideViewport = point.x >= 0 && point.x < window.innerWidth && point.y >= 0 && point.y < window.innerHeight;
      const insideCheckbox = point.x >= checkboxRect.left && point.x <= checkboxRect.right
        && point.y >= checkboxRect.top && point.y <= checkboxRect.bottom;
      if (!insideViewport || insideCheckbox) return false;
      const hitNode = document.elementFromPoint(point.x, point.y);
      return Boolean(hitNode && target && target.contains(hitNode));
    });
    return {
      checked: (node instanceof HTMLInputElement) ? node.checked : false,
      target: targetRect?.toJSON() ?? null,
      pseudoHeight: Number.parseFloat(pseudoStyle?.height || "0"),
      hitPoint: hitPoint ?? null,
    };
  });
  const failures = [];
  if (!hitArea.target || Math.max(hitArea.target.height, hitArea.pseudoHeight) < 44 || !hitArea.hitPoint) {
    failures.push({ check: "screener-checkbox-target-click", detail: "no label-owned 44px hit point outside the native checkbox" });
    return { route, failures };
  }

  await page.mouse.click(hitArea.hitPoint.x, hitArea.hitPoint.y);
  await page.waitForTimeout(100);
  if ((await checkbox.isChecked()) === hitArea.checked) {
    failures.push({
      check: "screener-checkbox-target-click",
      detail: `outside-native click at ${Math.round(hitArea.hitPoint.x)},${Math.round(hitArea.hitPoint.y)} did not toggle the checkbox`,
    });
  }
  return { route, failures };
}

async function collectScreenerCardViewChecks(page, route) {
  const viewport = page.viewportSize();
  if (!viewport || !isAnalyzeScreenerRoute(route) || viewport.width < 921) {
    return {
      route,
      viewportWidth: viewport?.width ?? null,
      scrollWidth: null,
      failures: [],
    };
  }

  const cardButton = page.locator('[data-screener-view-mode-option="card"]:visible').first();
  if ((await cardButton.count()) === 0) {
    return {
      route,
      viewportWidth: viewport.width,
      scrollWidth: null,
      failures: [{ check: "screener-card-view-button", detail: "no visible card view button" }],
    };
  }

  await cardButton.click({ timeout: 10000 });
  await page.waitForTimeout(500);

  const peerBaseline = await page.evaluate(() => {
    const grid = document.querySelector("[data-screener-card-grid]");
    const cards = grid
      ? Array.from(grid.querySelectorAll("[data-screener-desktop-stock-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
      : [];
    const targetRect = cards[0]?.getBoundingClientRect();
    const peerCardIndex = targetRect
      ? cards.findIndex((card, index) => (
        index > 0 && Math.abs(card.getBoundingClientRect().top - targetRect.top) <= 2
      ))
      : -1;
    if (peerCardIndex < 0) return null;
    return {
      peerCardIndex,
      peerHeight: cards[peerCardIndex].getBoundingClientRect().height,
    };
  });

  const expandButton = page.locator('[data-screener-card-grid] [aria-controls^="screener-card-detail"]:visible').first();
  if ((await expandButton.count()) > 0) {
    await expandButton.click({ timeout: 10000 });
    await page.waitForTimeout(300);
  }

  return page.evaluate(({ currentRoute, peerBaselineBefore }) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const grid = document.querySelector("[data-screener-card-grid]");
    const visibleCards = grid
      ? Array.from(grid.querySelectorAll("[data-screener-desktop-stock-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
      : [];
    const activeCardButton = document.querySelector('[data-screener-view-mode-option="card"][aria-pressed="true"]');
    const detail = document.querySelector('[id^="screener-card-detail"]');
    const peerCard = peerBaselineBefore
      ? visibleCards[peerBaselineBefore.peerCardIndex]
      : null;
    const peerHeightAfter = peerCard?.getBoundingClientRect().height ?? null;

    if (!grid || grid.getBoundingClientRect().height <= 0) {
      failures.push({ check: "screener-card-view-grid-visible", detail: "card grid is not visible" });
    }
    if (!activeCardButton) {
      failures.push({ check: "screener-card-view-active", detail: "card view button is not pressed" });
    }
    if (visibleCards.length === 0) {
      failures.push({ check: "screener-card-view-visible-cards", detail: "no visible stock cards after card view click" });
    }
    if (visibleCards.length > 0 && (!detail || detail.getBoundingClientRect().height <= 0)) {
      failures.push({ check: "screener-card-view-expanded-detail", detail: "expanded desktop card detail is not visible" });
    }
    if (peerBaselineBefore) {
      if (peerHeightAfter === null) {
        failures.push({
          check: "screener-card-view-peer-card-present",
          detail: `peer index=${peerBaselineBefore.peerCardIndex} missing after expansion`,
        });
      } else if (Math.abs(peerHeightAfter - peerBaselineBefore.peerHeight) > 2) {
        failures.push({
          check: "screener-card-view-no-peer-height-stretch",
          detail: `before=${peerBaselineBefore.peerHeight.toFixed(1)} after=${peerHeightAfter.toFixed(1)}`,
        });
      }
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "screener-card-view-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      peerHeightBefore: peerBaselineBefore?.peerHeight ?? null,
      peerHeightAfter,
      failures,
    };
  }, { currentRoute: route, peerBaselineBefore: peerBaseline });
}

async function collectStockFinancialChartChecks(page, route) {
  const button = page.locator("[data-stock-financial-row-chart-button]").first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "stock-financial-row-chart-click", detail: "no financial row chart button to click" }],
    };
  }

  await button.click({ timeout: 10000 });
  await page.waitForTimeout(250);

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const panel = document.querySelector("[data-stock-financial-row-chart-panel]");

    if (!panel || panel.getBoundingClientRect().height <= 0) {
      failures.push({ check: "stock-financial-row-chart-panel-visible", detail: "expanded row chart panel not visible" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "stock-financial-row-chart-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectStockEstimatesToggleChecks(page, route) {
  const button = page.locator('[data-stock-estimates-granularity="quarterly"]:visible').first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "stock-estimates-quarterly-toggle-click", detail: "no quarterly estimates toggle" }],
    };
  }

  await button.click({ timeout: 10000 });
  await page.waitForTimeout(250);

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const panel = document.querySelector("[data-stock-estimates-quarterly-panel]");
    const quarterlyButton = document.querySelector('[data-stock-estimates-granularity="quarterly"]');

    if (!panel || panel.getBoundingClientRect().height <= 0) {
      failures.push({ check: "stock-estimates-quarterly-panel-visible", detail: "quarterly estimates panel not visible after click" });
    }
    if (quarterlyButton?.getAttribute("aria-pressed") !== "true") {
      failures.push({ check: "stock-estimates-quarterly-toggle-state", detail: "quarterly toggle not pressed after click" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "stock-estimates-quarterly-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectStockSummaryAxisClickChecks(page, route) {
  const button = page.locator('[data-stock-summary-axis-tab="estimates"]').first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "stock-summary-axis-click-target", detail: "no estimates axis link" }],
    };
  }

  await button.click({ timeout: 10000 });
  // Consensus lives inside the user-expandable annual/quarterly detail.
  const estimateDetails = page.locator('details[data-stock-tab-card="estimates-yf"]');
  await estimateDetails.waitFor({ state: "visible", timeout: 15000 });
  if ((await estimateDetails.getAttribute("open")) === null) {
    await estimateDetails.locator("summary").click();
  }
  await page.locator('[data-stock-estimates-consensus-summary]:visible').first()
    .waitFor({ state: "visible", timeout: 10000 })
    .catch(() => {});

  return page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const estimatesPanel = document.querySelector("[data-stock-estimates-consensus-summary]");
    const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
    const params = new URLSearchParams(window.location.search);

    if (!estimatesPanel || estimatesPanel.getBoundingClientRect().height <= 0) {
      failures.push({ check: "stock-summary-axis-estimates-panel-visible", detail: "estimates panel not visible after axis click" });
    }
    if (params.get("tab") !== "estimates") {
      failures.push({ check: "stock-summary-axis-url-sync", detail: `tab=${params.get("tab") || "missing"}` });
    }
    if (!selectedTab || !(selectedTab.textContent || "").includes("추정치")) {
      failures.push({ check: "stock-summary-axis-selected-tab", detail: `selected=${selectedTab?.textContent || ""}` });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "stock-summary-axis-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
}

async function collectStockSummaryDividendAxisClickChecks(page, route) {
  await page.goto(routeUrl(route), {
    waitUntil: "networkidle",
    timeout: 45000,
  });
  await page.waitForTimeout(250);

  const button = page.locator('[data-stock-summary-axis="배당"]').first();
  if ((await button.count()) === 0) {
    return {
      route,
      viewportWidth: null,
      scrollWidth: null,
      failures: [{ check: "stock-summary-dividend-axis-click-target", detail: "no dividend axis link" }],
    };
  }

  const buttonBox = await button.boundingBox();
  const preClickFailures = [];
  if (!buttonBox || buttonBox.height < 44) {
    preClickFailures.push({ check: "stock-summary-dividend-axis-touch-target", detail: `height=${Math.round(buttonBox?.height || 0)}` });
  }
  await button.click({ timeout: 10000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate((currentRoute) => {
    const failures = [];
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const dividendPanel = document.querySelector('[data-stock-dividend-panel][id="dividend"]');
    const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
    const params = new URLSearchParams(window.location.search);

    if (!dividendPanel || dividendPanel.getBoundingClientRect().height <= 0) {
      failures.push({ check: "stock-summary-dividend-axis-panel-visible", detail: "dividend panel not visible after axis click" });
    }
    if (params.get("tab") !== "financials" || window.location.hash !== "#dividend") {
      failures.push({ check: "stock-summary-dividend-axis-url-sync", detail: `tab=${params.get("tab") || "missing"} hash=${window.location.hash || "missing"}` });
    }
    if (!selectedTab || !(selectedTab.textContent || "").includes("재무")) {
      failures.push({ check: "stock-summary-dividend-axis-selected-tab", detail: `selected=${selectedTab?.textContent || ""}` });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "stock-summary-dividend-axis-no-horizontal-overflow",
        detail: `scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
      });
    }

    return {
      route: currentRoute,
      viewportWidth,
      scrollWidth,
      failures,
    };
  }, route);
  result.failures.unshift(...preClickFailures);
  return result;
}

async function collectSectorViewSwitchChecks(page, route) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 768) {
    return {
      route,
      failures: [],
      scrollWidth: null,
    };
  }

  const expectedTabs = [
    { key: "1w", label: "1주" },
    { key: "1m", label: "1개월" },
    { key: "3m", label: "3개월" },
    { key: "6m", label: "6개월" },
    { key: "ytd", label: "연초이후" },
  ];
  const failures = [];
  let clickScrollWidth = null;

  for (const tab of expectedTabs) {
    const button = page.locator("[data-sectors-period-toggle] button").filter({ hasText: tab.label }).first();
    if ((await button.count()) === 0) {
      failures.push({ check: "sector-period-toggle-target", detail: `missing=${tab.key}` });
      continue;
    }
    await button.click();
    await page.waitForTimeout(150);
    const check = await page.evaluate((key) => {
      const localFailures = [];
      const viewportWidth = window.innerWidth;
      const scrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      );
      const buttons = Array.from(document.querySelectorAll("[data-sectors-period-toggle] button"));
      const button = buttons.find((node) => node.getAttribute("aria-pressed") === "true");
      const panel = document.querySelector(`[data-sectors-flow-rows][data-sectors-flow-window="${key}"]`);
      const buttonPressed = Boolean(button);
      const panelRect = panel?.getBoundingClientRect();

      if (!buttonPressed) {
        localFailures.push({ check: "sector-period-toggle-click-state", detail: `window=${key} no pressed button` });
      }
      if (!panel || !panelRect || panelRect.width <= 0 || panelRect.height <= 0) {
        localFailures.push({ check: "sector-period-toggle-click-panel", detail: `window=${key} panel not visible` });
      }
      if (scrollWidth > viewportWidth + 1) {
        localFailures.push({
          check: "sector-period-toggle-no-horizontal-overflow",
          detail: `window=${key} scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
        });
      }
      if (button && button.getBoundingClientRect().height < 44) {
        localFailures.push({ check: "sector-period-toggle-target", detail: `window=${key} height=${Math.round(button.getBoundingClientRect().height)}` });
      }
      return { failures: localFailures, scrollWidth };
    }, tab.key);
    failures.push(...check.failures);
    clickScrollWidth = Math.max(clickScrollWidth ?? 0, check.scrollWidth ?? 0);
  }

  return { route, failures, scrollWidth: clickScrollWidth };
}

if (routes.length === 0) {
  throw new Error("No QA_MOBILE_UX_ROUTES configured.");
}

if (viewports.length === 0) {
  throw new Error("No valid QA_MOBILE_UX_VIEWPORTS configured.");
}

async function collectInvestorStructureChecks(page, route, requests) {
  if (!isolated || !route.startsWith("/superinvestors")) return { failures: [], observations: [] };
  const observed = await page.evaluate(() => {
    const failures = [];
    const observations = [];
    const visible = (node) => node instanceof HTMLElement && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
    const pairs = [
      ["holdings", "[data-superinvestor-guru-top-holdings]", "[data-superinvestor-guru-holding-card]", "tr[data-superinvestor-guru-holding-row], [data-superinvestor-guru-desktop-holding-row]"],
      ["bought", '[data-superinvestor-trades-panel][data-superinvestor-trades-side="bought"]', "[data-superinvestor-trades-card]", "tbody tr"],
      ["sold", '[data-superinvestor-trades-panel][data-superinvestor-trades-side="sold"]', "[data-superinvestor-trades-card]", "tbody tr"],
    ];
    for (const [name, selector, cardSelector, tableSelector] of pairs) {
      const container = document.querySelector(selector);
      if (!container || !visible(container)) continue;
      const cards = [...container.querySelectorAll(cardSelector)].filter(visible);
      const rows = [...container.querySelectorAll(tableSelector)].filter(visible);
      observations.push({ name, cards: cards.length, rows: rows.length, firstRowFields: rows[0]?.querySelectorAll("td").length ?? 0 });
      if (cards.length > 0 && rows.length > 0) failures.push({ check: "investor-single-responsive-view", detail: `${name}: cards=${cards.length}, tableRows=${rows.length}` });
      if (!cards.length && !rows.length) failures.push({ check: "investor-responsive-content", detail: `${name}: no visible rows` });
      if (name === "holdings" && window.innerWidth <= 760) {
        if (!rows.length) failures.push({ check: "investor-holding-fields", detail: "missing semantic holding row on phone" });
        const cells = rows[0] ? [...rows[0].querySelectorAll("td")] : [];
        if (cells.length < 8) failures.push({ check: "investor-holding-fields", detail: `fields=${cells.length}` });
        for (const cell of cells) {
          const rect = cell.getBoundingClientRect();
          if (!visible(cell) || rect.left < -1 || rect.right > window.innerWidth + 1) failures.push({ check: "investor-holding-field-contained", detail: cell.textContent.slice(0, 60) });
        }
      }
    }
    return { failures, observations };
  });
  const { failures } = observed;
  const url = new URL(route, baseUrl);
  const tab = url.searchParams.get("tab") || "signal";
  const guruId = url.searchParams.get("guru");
  if (guruId && /^[a-z0-9_-]+$/i.test(guruId)) {
    const payload = JSON.parse(await readFile(resolve("../data/sec-13f/investors", `${guruId}.json`), "utf8"));
    const filing = payload.investor.filings.at(-1);
    const heldTickers = new Set(filing.holdings.map((holding) => holding.ticker).filter(Boolean));
    // Preserve the pre-remodel top-50 held plus up-to-50 fully sold contract.
    const soldCount = (filing.changes_summary?.sold ?? []).filter((holding) => holding.ticker && !heldTickers.has(holding.ticker)).length;
    const expectedRows = Math.min(50, heldTickers.size) + Math.min(50, soldCount);
    const holdingObservation = observed.observations.find((item) => item.name === "holdings");
    if (holdingObservation) holdingObservation.expectedRows = expectedRows;
    if (holdingObservation?.rows !== expectedRows) failures.push({ check: "investor-holding-row-preservation", detail: `expected=${expectedRows}, actual=${holdingObservation?.rows ?? 0}` });
  }
  // Guru charts consume portfolio_views and factor_exposures_summary;
  // only trades_ranking is unrelated to this destination.
  if (url.searchParams.has("guru") && requests.some((path) => path.endsWith("/trades_ranking.json"))) {
    failures.push({ check: "investor-guru-independent-feeds", detail: "guru requested unrelated trades feed" });
  }
  if (!url.searchParams.has("guru") && ["signal", "investors", "graph"].includes(tab)) {
    const unrelated = requests.filter((path) => /\/(trades_ranking|portfolio_views|factor_exposures_summary)\.json$/.test(path));
    if (unrelated.length) failures.push({ check: "investor-active-tab-feeds", detail: [...new Set(unrelated)].join(", ") });
  }
  return observed;
}

async function collectInvestorTabSwitchChecks(page, route, viewportName, requestPaths) {
  if (!isolated || route !== "/superinvestors" || !["mobile", "tablet-landscape"].includes(viewportName)) return [];
  const failures = [];
  try {
    for (const tab of ["stocks", "trades", "insights", "graph", "investors", "signal"]) {
      const button = page.locator(`[data-superinvestors-tab="${tab}"]`);
      await button.click();
      await prepareDynamicRoute(page, `/superinvestors?tab=${tab}`);
      if (await button.getAttribute("aria-selected") !== "true" || new URL(page.url()).searchParams.get("tab") !== tab) {
        throw new Error(`tab selection/URL mismatch: ${tab}`);
      }
      if (tab === "trades") {
        for (const side of ["bought", "sold"]) {
          const panel = page.locator(`[data-superinvestor-trades-panel][data-superinvestor-trades-side="${side}"]`);
          const rows = panel.locator("tbody tr");
          const toggle = panel.locator('button[aria-pressed]');
          if (await rows.count() !== 10) throw new Error(`${side}: expected 10 initial trade rows`);
          await toggle.click();
          if (await rows.count() <= 10 || await toggle.getAttribute("aria-pressed") !== "true") throw new Error(`${side}: trade expansion failed`);
          await toggle.click();
          if (await rows.count() !== 10) throw new Error(`${side}: trade collapse failed`);
        }
      }
    }
    const beforeReturn = requestPaths.length;
    await page.locator('[data-superinvestors-tab="stocks"]').click();
    await prepareDynamicRoute(page, "/superinvestors?tab=stocks");
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    const repeated = requestPaths.slice(beforeReturn).filter((path) => /\/(portfolio_views|trades_ranking|new_positions|buying_pressure|conviction)\.json$/.test(path));
    if (repeated.length) failures.push({ check: "investor-settled-tab-feed-reuse", detail: repeated.join(", ") });
    await page.locator('[data-superinvestors-tab="signal"]').click();
    await prepareDynamicRoute(page, "/superinvestors");
  } catch (error) {
    failures.push({ check: "investor-tab-switch", detail: String(error) });
  }
  return failures;
}

async function collectInvestorFeedRetryChecks(page, route, viewportName, requestPaths) {
  if (!isolated || route !== "/superinvestors" || viewportName !== "mobile") return [];
  const failures = [];
  const feedUrl = new URL("/data/sec-13f/analytics/new_positions.json", baseUrl).href;
  const failFeed = (requestRoute) => requestRoute.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  try {
    await page.route(feedUrl, failFeed);
    await page.reload({ waitUntil: "domcontentloaded" });
    const errorStrip = page.locator(".stale-state").filter({ hasText: "신규 매수 집계를 불러오지 못했습니다." });
    await errorStrip.waitFor({ state: "visible", timeout: 45000 });
    const increases = page.locator('[data-superinvestors-signal-list="increased"]');
    // One unavailable supplementary source must not erase the other lists.
    await increases.waitFor({ state: "visible", timeout: 45000 });
    await page.unroute(feedUrl, failFeed);
    const beforeRetry = requestPaths.length;
    await errorStrip.getByRole("button", { name: "다시 시도" }).click();
    await page.locator('[data-superinvestors-signal-list="new"]').waitFor({ state: "visible", timeout: 45000 });
    await errorStrip.waitFor({ state: "hidden", timeout: 45000 });
    const retryRequests = requestPaths.slice(beforeRetry);
    if (!retryRequests.some((path) => path.endsWith("/new_positions.json"))) throw new Error("retry did not request the failed source");
    const unrelated = retryRequests.filter((path) => /\/(buying_pressure|conviction|portfolio_views|trades_ranking)\.json$/.test(path));
    if (unrelated.length) throw new Error(`retry requested unrelated settled feeds: ${unrelated.join(", ")}`);
  } catch (error) {
    failures.push({ check: "investor-feed-retry-isolation", detail: String(error) });
  } finally {
    await page.unroute(feedUrl, failFeed);
    if (failures.length) await page.goto(routeUrl(route), { waitUntil: "domcontentloaded" });
    await prepareDynamicRoute(page, route);
  }
  return failures;
}

async function collectInvestorHoldingReturnChecks(page, route, viewportName) {
  if (!isolated || !route.includes("guru=") || !["mobile", "tablet-landscape"].includes(viewportName)) return [];
  const failures = [];
  try {
    const guruId = new URL(route, baseUrl).searchParams.get("guru");
    const region = page.locator("[data-journey-holdings-scroll]:visible").first();
    const links = page.locator('[data-superinvestor-guru-top-holdings] a[href*="/stock/"]:visible');
    const tablet = viewportName === "tablet-landscape";
    if (tablet) await region.evaluate((node) => { node.scrollTop = 240; });
    const link = tablet ? links.nth(12) : links.first();
    await link.scrollIntoViewIfNeeded();
    const expectedScroll = tablet ? await region.evaluate((node) => node.scrollTop) : 0;
    if (tablet && expectedScroll <= 0) throw new Error("holdings return requires a positive inner scroll baseline");
    const href = await link.getAttribute("href");
    const destination = new URL(href, page.url());
    if (!/^\/stock\/[^/]+\/?$/.test(destination.pathname)) throw new Error("holding link is not a stock destination");
    const returnTo = destination.searchParams.get("returnTo");
    if (!returnTo || new URL(returnTo, baseUrl).searchParams.get("guru") !== guruId) throw new Error("holding link lost guru return context");
    await link.click();
    await page.waitForURL((url) => url.pathname.replace(/\/$/, "") === destination.pathname.replace(/\/$/, ""), { timeout: 45000 });
    const back = page.locator('a[aria-label="투자자 화면으로 돌아가기"]:visible').first();
    await back.waitFor({ state: "visible", timeout: 45000 });
    await back.click();
    await prepareDynamicRoute(page, route);
    if (new URL(page.url()).searchParams.get("guru") !== guruId) throw new Error("return opened a different guru");
    if (tablet) {
      await page.waitForFunction(({ expected }) => {
        const node = document.querySelector("[data-journey-holdings-scroll]");
        return node && node.scrollTop > expected - 50;
      }, { expected: expectedScroll }, { timeout: 10000 });
    }
  } catch (error) {
    failures.push({ check: "investor-holding-return", detail: String(error) });
  }
  return failures;
}

async function collectInvestorNavigationChecks(page, route) {
  if (!isolated || !route.includes("tab=investors")) return [];
  const failures = [];
  try {
    const buttons = page.locator("[data-superinvestors-sort]");
    for (const button of await buttons.all()) {
      await button.click();
      if (await button.getAttribute("aria-pressed") !== "true") {
        failures.push({ check: "investor-sort-interaction", detail: await button.innerText() });
      }
    }
    // Reset to the first sort before testing the same row's round trip.
    await buttons.first().click();
    const row = page.locator("[data-superinvestors-holder-row]").first();
    const investorId = await row.getAttribute("data-superinvestors-holder-id");
    await row.focus();
    await page.keyboard.press("Enter");
    const detail = page.locator("[data-superinvestors-guru-detail-view]");
    await detail.waitFor({ state: "visible", timeout: 45000 });
    if (await detail.getAttribute("data-superinvestors-holder-detail-id") !== investorId) {
      failures.push({ check: "investor-open-identity", detail: `expected=${investorId}` });
    }
    await page.locator("[data-superinvestors-guru-back]").click();
    await row.waitFor({ state: "visible", timeout: 45000 });
    if (await row.getAttribute("data-superinvestors-holder-id") !== investorId) {
      failures.push({ check: "investor-return-order", detail: `expected=${investorId}` });
    }
    if (new URL(page.url()).searchParams.has("guru")) {
      failures.push({ check: "investor-return-url", detail: "guru context survived explicit list return" });
    }
  } catch (error) {
    failures.push({ check: "investor-navigation", detail: String(error) });
  }
  return failures;
}

async function collectScreenerInvestorFlowChecks(page, route, viewportName) {
  if (!isolated || route !== "/screener?mode=analyze" || !["mobile", "tablet-mid"].includes(viewportName)) return [];
  const failures = [];
  try {
    const index = JSON.parse(await readFile(resolve("../data/sec-13f/analytics/guru_holders_index.json"), "utf8"));
    const source = JSON.parse(await readFile(resolve("../data/global-scouter/core/stocks_analyzer.json"), "utf8"));
    const universe = new Set((source.data ?? []).map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean));
    const changes = index.holding_changes ?? {};
    if (Object.keys(changes).length === 0) throw new Error("Generated public holding-change evidence is missing");
    for (const [action, field] of [["guru_held", "held_count"], ["guru_new", "new_count"], ["guru_increased", "increased_count"]]) {
      const expected = new Set(Object.entries(changes).filter(([ticker, row]) => universe.has(ticker) && row[field] > 0).map(([ticker]) => ticker));
      // Exercise an actual current intersection, never a pinned ticker/count.
      if (expected.size === 0) throw new Error(`No current public intersection for ${action}; positive flow coverage unavailable`);
      await page.goto(routeUrl(`/screener?mode=analyze&action=${action}`), { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.locator('[data-screener-mode="analyze"][data-journey-ready="true"]').waitFor({ state: "visible", timeout: 45000 });
      const badges = page.locator('[data-testid="screener-guru-badge"]:visible');
      await badges.first().waitFor({ state: "visible", timeout: 45000 });
      const displayed = await badges.evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("data-ticker")))]);
      for (const ticker of displayed) {
        if (!expected.has(ticker)) failures.push({ check: "screener-investor-filter", detail: `${action}: unexpected ticker=${ticker}` });
      }
      const badge = badges.first();
      const ticker = await badge.getAttribute("data-ticker");
      const sourceUrl = new URL(page.url());
      if (sourceUrl.searchParams.get("action") !== action) failures.push({ check: "screener-investor-filter-url", detail: `${action}: ${sourceUrl.search}` });
      const origin = `${sourceUrl.pathname}${sourceUrl.search}${sourceUrl.hash}`;
      const href = new URL(await badge.getAttribute("href"), page.url());
      if (href.searchParams.get("returnTo") !== origin) failures.push({ check: "screener-investor-origin", detail: `${action}: return origin missing or changed` });
      await badge.click();
      await page.locator(`[data-superinvestors-whoholds-result="${ticker}"]`).waitFor({ state: "visible", timeout: 45000 });
      if (new URL(page.url()).searchParams.get("tab") !== "stocks") failures.push({ check: "screener-investor-tab", detail: page.url() });
      const back = page.getByRole("link", { name: "스크리너로 돌아가기", exact: true }).filter({ visible: true }).first();
      await back.click();
      await page.locator('[data-screener-mode="analyze"][data-journey-ready="true"]').waitFor({ state: "visible", timeout: 45000 });
      if (page.url() !== sourceUrl.href) failures.push({ check: "screener-investor-return", detail: `${action}: expected=${sourceUrl.href} actual=${page.url()}` });
    }
  } catch (error) {
    failures.push({ check: "screener-investor-flow", detail: String(error) });
  } finally {
    await page.goto(routeUrl(route), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.locator('[data-screener-mode="analyze"][data-journey-ready="true"]').waitFor({ state: "visible", timeout: 45000 });
  }
  return failures;
}

const browser = await (browserName === "webkit" ? webkit : chromium).launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
  ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
});
const results = [];
const captureEmulation = Boolean(outputDir);

function contextOptionsFor(viewport) {
  return {
    viewport,
    ...(isolated ? { serviceWorkers: "block" } : {}),
    ...(captureEmulation
      ? {
          hasTouch: true,
          isMobile: viewport.width < 768,
          deviceScaleFactor: 1,
          reducedMotion: "reduce",
        }
      : {}),
  };
}

try {
  for (const { name, viewport } of viewports) {
    const context = await browser.newContext(contextOptionsFor(viewport));
    if (isolated) {
      await context.route("**/*", async (requestRoute) => {
        const url = new URL(requestRoute.request().url());
        if (url.origin === isolatedOrigin) return requestRoute.continue();
        blockedExternalRequests.push({ viewport: name, origin: url.origin, path: url.pathname });
        return requestRoute.abort("blockedbyclient");
      });
    }
    await installQaPortfolio(context);
    const page = await context.newPage();
    let routeErrors = [];
    let routeRequests = [];
    page.on("request", (request) => routeRequests.push(new URL(request.url()).pathname));
    page.on("pageerror", (error) => routeErrors.push(String(error)));

    for (const [routeIndex, route] of routes.entries()) {
      const emulation = {
        hasTouch: captureEmulation,
        isMobile: captureEmulation && viewport.width < 768,
        deviceScaleFactor: captureEmulation ? 1 : null,
        reducedMotion: captureEmulation ? "reduce" : null,
      };
      const result = {
        viewport: name,
        route,
        status: null,
        failures: [],
      };
      if (outputDir) {
        result.viewportSize = viewport;
        result.emulation = emulation;
      }

      routeErrors = [];
      routeRequests = [];
      try {
        const navigationOptions = {
          waitUntil: outputDir ? "domcontentloaded" : "networkidle",
          timeout: 45000,
        };
        let response = await page.goto(routeUrl(route), navigationOptions);
        if (response?.status() === 429) {
          const requestedSeconds = Number(response.headers()["retry-after"]);
          const delayMs = Number.isFinite(requestedSeconds) && requestedSeconds > 0
            ? Math.max(1000, requestedSeconds * 1000)
            : 60000;
          // One bounded retry respects server backoff; a second 429 stays red.
          if (delayMs <= 60000) {
            result.navigationRetries = [{ status: 429, delayMs }];
            await page.waitForTimeout(delayMs);
            response = await page.goto(routeUrl(route), navigationOptions);
          }
        }
        result.status = response ? response.status() : null;
        if (response && !response.ok()) {
          result.failures.push({
            check: "http-response",
            detail: `status=${response.status()} url=${response.url()}`,
          });
          throw new Error(`HTTP ${response.status()} for ${response.url()}`);
        }
        if (outputDir) await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(250);
        await prepareDynamicRoute(page, route);
        const checks = await collectRouteChecks(page, route);
        result.failures = checks.failures;
        const structureChecks = await collectInvestorStructureChecks(page, route, routeRequests);
        result.failures.push(...structureChecks.failures);
        if (isolated) result.investorStructure = structureChecks.observations;
        if (isolated) result.dataRequests = [...new Set(routeRequests.filter((path) => path.startsWith("/data/")))];
        result.failures.push(...await collectInvestorTabSwitchChecks(page, route, name, routeRequests));
        result.failures.push(...await collectInvestorFeedRetryChecks(page, route, name, routeRequests));
        result.failures.push(...await collectInvestorNavigationChecks(page, route));
        result.failures.push(...await collectInvestorHoldingReturnChecks(page, route, name));
        result.viewportWidth = checks.viewportWidth;
        result.scrollWidth = checks.scrollWidth;
        if (route.includes("/superinvestors?tab=stocks")) {
          result.cohortPaint = await collectCohortPaintProbe(page);
          const last = result.cohortPaint.at(-1);
          if (!last?.canvas || !(last.ink > 20) || last.opacity === "0" || last.visibility === "hidden") {
            result.failures.push({ check: "superinvestors-cohort-painted", detail: JSON.stringify(result.cohortPaint) });
          }
        }
        if (route.startsWith("/screener")) {
          const expandedChecks = await collectScreenerExpandedChecks(page, route);
          result.failures.push(...expandedChecks.failures);
          result.expandedScrollWidth = expandedChecks.scrollWidth;
          const checkboxTargetChecks = await collectScreenerCheckboxTargetChecks(page, route);
          result.failures.push(...checkboxTargetChecks.failures);
          const cardViewChecks = await collectScreenerCardViewChecks(page, route);
          result.failures.push(...cardViewChecks.failures);
          result.cardViewScrollWidth = cardViewChecks.scrollWidth;
          result.cardViewPeerHeightBefore = cardViewChecks.peerHeightBefore;
          result.cardViewPeerHeightAfter = cardViewChecks.peerHeightAfter;
          result.failures.push(...await collectScreenerInvestorFlowChecks(page, route, name));
        }
        if (route.startsWith("/stock/") && route.includes("tab=financials")) {
          const financialChartChecks = await collectStockFinancialChartChecks(page, route);
          result.failures.push(...financialChartChecks.failures);
          result.financialChartScrollWidth = financialChartChecks.scrollWidth;
        }
        if (route.startsWith("/stock/") && route.includes("tab=estimates")) {
          const estimatesToggleChecks = await collectStockEstimatesToggleChecks(page, route);
          result.failures.push(...estimatesToggleChecks.failures);
          result.estimatesToggleScrollWidth = estimatesToggleChecks.scrollWidth;
        }
        if (route.startsWith("/stock/") && !route.includes("tab=")) {
          const summaryAxisChecks = await collectStockSummaryAxisClickChecks(page, route);
          result.failures.push(...summaryAxisChecks.failures);
          result.summaryAxisScrollWidth = summaryAxisChecks.scrollWidth;
          const dividendAxisChecks = await collectStockSummaryDividendAxisClickChecks(page, route);
          result.failures.push(...dividendAxisChecks.failures);
          result.summaryDividendAxisScrollWidth = dividendAxisChecks.scrollWidth;
        }
        if (route.startsWith("/sectors")) {
          const sectorViewChecks = await collectSectorViewSwitchChecks(page, route);
          result.failures.push(...sectorViewChecks.failures);
          result.sectorViewSwitchScrollWidth = sectorViewChecks.scrollWidth;
        }
      } catch (error) {
        if (!result.failures.some(({ check }) => check === "http-response")) {
          result.failures.push({ check: "navigation", detail: String(error) });
        }
      }

      result.pageErrors = routeErrors.slice(0, 8);
      if (outputDir) {
        result.capturedUrl = page.url();
        try {
          result.screenshotPaths = await captureBoundedScreenshots(page, route, name, routeIndex);
          for (const error of result.screenshotPaths.errors) {
            result.failures.push({ check: "responsive-capture", detail: error.detail });
          }
        } catch (error) {
          result.screenshotPaths = { paths: {}, errors: [{ detail: String(error) }] };
          result.failures.push({ check: "responsive-capture", detail: String(error) });
        }
      }

      results.push(result);
    }

    await context.close();
  }
} finally {
  await browser.close();
}

const failing = results.filter((result) => result.failures.length > 0);
const summary = {
  total: results.length,
  failing: failing.length,
  strictMode,
  ...(isolated ? { isolated: true, blockedExternalRequests } : {}),
  results,
};

if (outputDir) {
  Object.assign(summary, {
    browser: browserChannel || browserExecutablePath || `Playwright ${browserName === "webkit" ? "WebKit" : "Chromium"}`,
    emulation: {
      hasTouch: captureEmulation,
      isMobileRule: "viewport width < 768",
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
    },
    viewports: viewports.map(({ name, viewport }) => ({
      name,
      ...viewport,
      emulation: {
        hasTouch: true,
        isMobile: viewport.width < 768,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
      },
    })),
    outputDir,
  });
}

console.log(JSON.stringify(summary, null, 2));

if (outputDir) {
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

if (strictMode && (failing.length > 0 || (isolated && blockedExternalRequests.length > 0))) {
  process.exit(1);
}
