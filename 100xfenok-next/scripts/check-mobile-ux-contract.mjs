import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const strictMode = process.env.QA_MOBILE_UX_STRICT !== "0";
const browserChannel = process.env.QA_BROWSER_CHANNEL || "";
const browserExecutablePath = process.env.QA_CHROMIUM_EXECUTABLE_PATH || "";
const routes = (process.env.QA_MOBILE_UX_ROUTES || "/screener,/portfolio,/stock/NVDA,/superinvestors?tab=insights")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const viewportCatalog = {
  mobile: { width: 390, height: 844 },
  narrow: { width: 375, height: 812 },
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
    if (tabbar) {
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

    if (currentRoute.startsWith("/screener")) {
      const visibleCheckboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      visibleCheckboxes.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.width < 20 || rect.height < 20) {
          failures.push({
            check: "screener-checkbox-size",
            detail: `checkbox ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });

      const mobileExpandButtons = Array.from(document.querySelectorAll('[aria-controls^="screener-mobile-detail"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (mobileExpandButtons.length === 0) {
        failures.push({ check: "screener-mobile-expand-present", detail: "no visible mobile expand button" });
      }
      mobileExpandButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({
            check: "screener-expand-target",
            detail: `expand ${index} height=${Math.round(rect.height)}`,
          });
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
        if (rect.width < 36 || rect.height < 36) {
          failures.push({
            check: "portfolio-action-target",
            detail: `button ${index} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
          });
        }
      });
    }

    if (currentRoute.startsWith("/stock/")) {
      const tabs = document.querySelector(".stock-tabs");
      if (tabs) {
        const overflowed = tabs.scrollWidth > tabs.clientWidth + 1;
        if (overflowed && !tabs.classList.contains("can-scroll")) {
          failures.push({
            check: "stock-tabs-scroll-affordance",
            detail: `scrollWidth=${tabs.scrollWidth} clientWidth=${tabs.clientWidth}`,
          });
        }
      }
    }

    if (currentRoute.startsWith("/superinvestors")) {
      const regions = Array.from(document.querySelectorAll('.scroll-hint-x[role="region"][tabindex="0"]'))
        .filter((node) => node.getBoundingClientRect().width > 0);
      if (regions.length === 0) {
        failures.push({ check: "superinvestors-scroll-region", detail: "no visible scroll-hint region" });
      }
      if (currentRoute.includes("tab=insights") && regions.length < 5) {
        failures.push({ check: "superinvestors-insights-scroll-regions", detail: `visible regions=${regions.length}` });
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

async function collectScreenerExpandedChecks(page, route) {
  const button = page.locator('[aria-controls^="screener-mobile-detail"]').first();
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

    if (!detail || detail.getBoundingClientRect().height <= 0) {
      failures.push({ check: "screener-expanded-detail-visible", detail: "expanded detail panel not visible" });
    }
    if (scrollWidth > viewportWidth + 1) {
      failures.push({
        check: "screener-expanded-no-horizontal-overflow",
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

if (routes.length === 0) {
  throw new Error("No QA_MOBILE_UX_ROUTES configured.");
}

if (viewports.length === 0) {
  throw new Error("No valid QA_MOBILE_UX_VIEWPORTS configured.");
}

const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
  ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
});
const results = [];

try {
  for (const { name, viewport } of viewports) {
    const context = await browser.newContext({ viewport });
    await installQaPortfolio(context);
    const page = await context.newPage();

    for (const route of routes) {
      const result = {
        viewport: name,
        route,
        status: null,
        failures: [],
      };

      try {
        const response = await page.goto(routeUrl(route), {
          waitUntil: "networkidle",
          timeout: 45000,
        });
        result.status = response ? response.status() : null;
        await page.waitForTimeout(250);
        const checks = await collectRouteChecks(page, route);
        result.failures = checks.failures;
        result.viewportWidth = checks.viewportWidth;
        result.scrollWidth = checks.scrollWidth;
        if (route.startsWith("/screener")) {
          const expandedChecks = await collectScreenerExpandedChecks(page, route);
          result.failures.push(...expandedChecks.failures);
          result.expandedScrollWidth = expandedChecks.scrollWidth;
        }
      } catch (error) {
        result.failures = [{ check: "navigation", detail: String(error) }];
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
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (strictMode && failing.length > 0) {
  process.exit(1);
}
