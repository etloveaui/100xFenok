import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const strictMode = process.env.QA_MOBILE_UX_STRICT !== "0";
const browserChannel = process.env.QA_BROWSER_CHANNEL || "";
const browserExecutablePath = process.env.QA_CHROMIUM_EXECUTABLE_PATH || "";
const routes = (process.env.QA_MOBILE_UX_ROUTES || "/,/?v5=1,/explore,/workbench,/macro-chart,/multichart,/tools/stock-analyzer,/ib,/market-valuation,/regime,/market/events,/etfs,/screener,/sectors,/portfolio,/stock/NVDA,/stock/NVDA?tab=financials,/stock/NVDA?tab=ownership,/stock/NVDA?tab=estimates,/stock/NVDA?tab=filings,/superinvestors?tab=insights,/superinvestors?tab=gurus&guru=blackrock,/superinvestors?tab=by-ticker&ticker=NVDA,/superinvestors?tab=trades")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

const viewportCatalog = {
  mobile: { width: 390, height: 844 },
  narrow: { width: 375, height: 812 },
  desktop: { width: 1280, height: 900 },
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

    if (currentRoute === "/" || currentRoute.startsWith("/?")) {
      const homeSearch = document.querySelector("[data-home-search-first]");
      const homeSearchInput = homeSearch?.querySelector('[role="combobox"]');
      const homeSearchRect = homeSearchInput?.getBoundingClientRect();
      const homeSearchVisible = Boolean(
        homeSearchRect &&
        homeSearchRect.width > 0 &&
        homeSearchRect.height >= 32 &&
        homeSearchRect.top >= 0 &&
        homeSearchRect.top < window.innerHeight * 0.45,
      );
      if (!homeSearchVisible) {
        failures.push({
          check: "home-search-first-visible",
          detail: homeSearchRect
            ? `top=${homeSearchRect.top} height=${homeSearchRect.height}`
            : "missing [data-home-search-first] combobox",
        });
      }
      const featureTiles = Array.from(document.querySelectorAll("[data-home-feature-tile]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.top < window.innerHeight;
        });
      if (featureTiles.length < 4 || featureTiles.length > 6) {
        failures.push({ check: "home-feature-tile-count", detail: `visible tiles=${featureTiles.length}` });
      }
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
      const header = document.querySelector("[data-macro-chart-header]");
      const chartCanvas = document.querySelector("canvas");
      const presetButtons = Array.from(document.querySelectorAll("[data-macro-chart-preset]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const actionButtons = Array.from(document.querySelectorAll("[data-macro-chart-action]"))
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
      const pickerToggle = document.querySelector("[data-macro-chart-picker-toggle]");
      const formulaControls = Array.from(document.querySelectorAll("[data-macro-chart-formula-control]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const mobileStatus = document.querySelector("[data-macro-chart-mobile-status]");

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

      const expectedActions = ["zoom-in", "zoom-out", "png", "csv"];
      const actualActions = actionButtons.map((node) => node.getAttribute("data-macro-chart-action"));
      if (
        actionButtons.length !== expectedActions.length ||
        !expectedActions.every((action, index) => actualActions[index] === action)
      ) {
        failures.push({ check: "macro-chart-action-order", detail: `actual=${JSON.stringify(actualActions)} expected=${JSON.stringify(expectedActions)}` });
      }
      actionButtons.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "macro-chart-action-target", detail: `action ${index} height=${Math.round(rect.height)}` });
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
      const header = document.querySelector("[data-multichart-header]");
      const chartCanvas = document.querySelector("canvas");
      const marketLensButtons = Array.from(document.querySelectorAll("[data-macro-chart-market-lens]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const mobileChips = Array.from(document.querySelectorAll("[data-macro-chart-mobile-chip]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const symbolInput = document.querySelector("[data-macro-chart-symbol-input]");
      const symbolAdd = document.querySelector("[data-macro-chart-symbol-add]");
      const mobileStatus = document.querySelector("[data-macro-chart-mobile-status]");
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
      const actualChips = mobileChips.map((node) => node.getAttribute("data-macro-chart-mobile-chip"));
      if (
        viewportWidth < 1280 &&
        (mobileChips.length < expectedDefaultChips.length ||
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
      if (!frameSrc || frameSrc.pathname !== "/ib-helper/index.html") {
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

    if (new URL(currentRoute, window.location.origin).pathname === "/market-valuation") {
      const surface = document.querySelector("[data-market-valuation-surface]");
      const nav = document.querySelector("[data-market-section-nav]");
      const navLinks = Array.from(document.querySelectorAll("[data-market-section-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const sections = Array.from(document.querySelectorAll("[data-market-section]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const chartGrid = document.querySelector("[data-market-valuation-chart-grid]");
      const indexCards = Array.from(document.querySelectorAll("[data-market-index-card]"))
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

      const expectedSections = ["overview", "macro", "valuation", "structure", "context"];
      const actualSections = sections.map((node) => node.getAttribute("data-market-section"));
      if (
        sections.length !== expectedSections.length ||
        !expectedSections.every((key, index) => actualSections[index] === key)
      ) {
        failures.push({
          check: "market-valuation-section-order",
          detail: `actual=${JSON.stringify(actualSections)} expected=${JSON.stringify(expectedSections)}`,
        });
      }

      if (!chartGrid || chartGrid.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-valuation-chart-grid-visible", detail: "missing ERP/Yardeni chart grid" });
      }
      if (indexCards.length < 2) {
        failures.push({ check: "market-index-card-count", detail: `visible cards=${indexCards.length}` });
      }

      indexCards.forEach((card, cardIndex) => {
        const rows = Array.from(card.querySelectorAll("[data-market-valuation-row]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const rowMetrics = rows.map((node) => node.getAttribute("data-market-valuation-row"));
        if (rows.length !== 2 || rowMetrics[0] !== "pe" || rowMetrics[1] !== "pb") {
          failures.push({
            check: "market-index-card-valuation-rows",
            detail: `card=${cardIndex} rows=${JSON.stringify(rowMetrics)}`,
          });
        }
        rows.forEach((row, rowIndex) => {
          const gauge = row.querySelector("[data-market-valuation-gauge]");
          const verdict = row.querySelector("[data-market-valuation-verdict]");
          if (!gauge || gauge.getBoundingClientRect().height <= 0) {
            failures.push({ check: "market-valuation-gauge-visible", detail: `card=${cardIndex} row=${rowIndex}` });
          }
          if (!verdict || !(verdict.textContent || "").trim()) {
            failures.push({ check: "market-valuation-verdict-present", detail: `card=${cardIndex} row=${rowIndex}` });
          }
        });
      });
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
      const axisCards = Array.from(document.querySelectorAll("[data-regime-axis-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const sourceCards = Array.from(document.querySelectorAll("[data-regime-source-card]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });

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
      const actualDetailAxes = axisCards.map((node) => node.getAttribute("data-regime-axis-card"));
      if (
        summaryCards.length !== expectedAxes.length ||
        !expectedAxes.every((key, index) => actualSummaryAxes[index] === key)
      ) {
        failures.push({
          check: "regime-axis-summary-order",
          detail: `actual=${JSON.stringify(actualSummaryAxes)} expected=${JSON.stringify(expectedAxes)}`,
        });
      }
      if (
        axisCards.length !== expectedAxes.length ||
        !expectedAxes.every((key, index) => actualDetailAxes[index] === key)
      ) {
        failures.push({
          check: "regime-axis-detail-order",
          detail: `actual=${JSON.stringify(actualDetailAxes)} expected=${JSON.stringify(expectedAxes)}`,
        });
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

      axisCards.forEach((card, cardIndex) => {
        const axis = card.getAttribute("data-regime-axis-card") || "";
        const rows = Array.from(card.querySelectorAll(`[data-regime-evidence-axis="${axis}"]`))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        const tone = card.querySelector("[data-regime-axis-tone]");
        if (rows.length === 0) {
          failures.push({ check: "regime-axis-evidence-present", detail: `axis=${axis || cardIndex}` });
        }
        if (!tone || !(tone.textContent || "").trim()) {
          failures.push({ check: "regime-axis-tone-present", detail: `axis=${axis || cardIndex}` });
        }
      });

      if (sourceCards.length < 4) {
        failures.push({ check: "regime-source-card-count", detail: `visible source cards=${sourceCards.length}` });
      }
    }

    if (new URL(currentRoute, window.location.origin).pathname === "/market/events") {
      const surface = document.querySelector("[data-market-events-surface]");
      const activeNav = document.querySelector('[data-market-section-link="events"][aria-current="page"]');
      const navLinks = Array.from(document.querySelectorAll("[data-market-section-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const overview = document.querySelector("[data-market-events-overview]");
      const tabs = Array.from(document.querySelectorAll("[data-market-event-tab]"))
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

      if (!overview || overview.getBoundingClientRect().height <= 0) {
        failures.push({ check: "market-events-overview-visible", detail: "missing events overview panel" });
      }

      const expectedTabs = ["earnings", "actions", "ipo", "movers"];
      const actualTabs = tabs.map((node) => node.getAttribute("data-market-event-tab"));
      if (
        tabs.length !== expectedTabs.length ||
        !expectedTabs.every((key, index) => actualTabs[index] === key)
      ) {
        failures.push({
          check: "market-events-tab-order",
          detail: `actual=${JSON.stringify(actualTabs)} expected=${JSON.stringify(expectedTabs)}`,
        });
      }
      const selectedTab = tabs.find((node) => node.getAttribute("aria-selected") === "true");
      if (selectedTab?.getAttribute("data-market-event-tab") !== "earnings") {
        failures.push({
          check: "market-events-default-tab",
          detail: `selected=${selectedTab?.getAttribute("data-market-event-tab") || ""}`,
        });
      }
      tabs.forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "market-events-tab-target", detail: `tab ${index} height=${Math.round(rect.height)}` });
        }
      });

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
      const header = document.querySelector("[data-etfs-header]");
      const toolLinks = Array.from(document.querySelectorAll("[data-etfs-tool-link]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const snapshot = document.querySelector("[data-etfs-snapshot]");
      const snapshotRows = Array.from(document.querySelectorAll("[data-etfs-snapshot-row]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const snapshotKinds = new Set(snapshotRows.map((node) => node.getAttribute("data-etfs-snapshot-row")));
      const universe = document.querySelector("[data-etf-universe]");
      const controls = [
        { key: "search", node: document.querySelector("[data-etf-universe-search]") },
        { key: "category", node: document.querySelector("[data-etf-universe-category]") },
        { key: "asset", node: document.querySelector("[data-etf-universe-asset-class]") },
        { key: "issuer", node: document.querySelector("[data-etf-universe-issuer]") },
        { key: "aum", node: document.querySelector("[data-etf-universe-aum]") },
        { key: "expense", node: document.querySelector("[data-etf-universe-expense]") },
      ];
      const segmentButtons = Array.from(document.querySelectorAll("[data-etf-universe-segment]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const universeRows = Array.from(document.querySelectorAll("[data-etf-universe-row]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const loadMore = document.querySelector("[data-etf-universe-load-more]");

      if (!surface || surface.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etfs-surface-visible", detail: "missing ETF center surface" });
      }
      if (!header || header.getBoundingClientRect().height <= 0) {
        failures.push({ check: "etfs-header-visible", detail: "missing ETF header" });
      }

      const expectedToolLinks = [
        ["compare", "/etfs/compare"],
        ["new", "/etfs/new"],
      ];
      const actualToolLinks = toolLinks.map((node) => [
        node.getAttribute("data-etfs-tool-link"),
        node instanceof HTMLAnchorElement ? new URL(node.href, window.location.origin).pathname.replace(/\/+$/, "") : "",
      ]);
      if (
        toolLinks.length !== expectedToolLinks.length ||
        !expectedToolLinks.every((link, index) => actualToolLinks[index]?.[0] === link[0] && actualToolLinks[index]?.[1] === link[1])
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
      if (snapshotRows.length < 12) {
        failures.push({ check: "etfs-snapshot-row-count", detail: `visible rows=${snapshotRows.length}` });
      }
      ["new", "large", "volume", "change", "provider", "bitcoin"].forEach((kind) => {
        if (!snapshotKinds.has(kind)) {
          failures.push({ check: "etfs-snapshot-row-kind", detail: `missing kind=${kind}` });
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
      const actualSegments = segmentButtons.map((node) => node.getAttribute("data-etf-universe-segment"));
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
      if (activeSegment?.getAttribute("data-etf-universe-segment") !== "전체") {
        failures.push({ check: "etf-universe-default-segment", detail: `active=${activeSegment?.getAttribute("data-etf-universe-segment") || ""}` });
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
      universeRows.slice(0, 8).forEach((node, index) => {
        const rect = node.getBoundingClientRect();
        if (rect.height < 44) {
          failures.push({ check: "etf-universe-row-target", detail: `row ${index} height=${Math.round(rect.height)}` });
        }
      });
      if (!loadMore || loadMore.getBoundingClientRect().height < 44) {
        failures.push({ check: "etf-universe-load-more-target", detail: loadMore ? `height=${Math.round(loadMore.getBoundingClientRect().height)}` : "missing load more" });
      }
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

      if (viewportWidth < 768) {
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

      const densityControl = document.querySelector("[data-screener-density-control]");
      const densityButtons = densityControl
        ? Array.from(densityControl.querySelectorAll('button[aria-pressed]'))
          .filter((node) => node.getBoundingClientRect().width > 0)
        : [];
      if (densityButtons.length !== 3) {
        failures.push({ check: "screener-density-control", detail: `buttons=${densityButtons.length}` });
      }

      if (viewportWidth >= 768) {
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
    }

    if (currentRoute.startsWith("/sectors")) {
      if (viewportWidth < 768) {
        const viewSwitch = document.querySelector("[data-sector-view-switch]");
        const viewTabs = Array.from(document.querySelectorAll("[data-sector-view-tab]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!viewSwitch || viewSwitch.getBoundingClientRect().height <= 0) {
          failures.push({ check: "sector-view-switch-visible", detail: "missing visible sector view switch" });
        }

        const expectedTabs = ["heatmap", "etf", "valuation", "guru"];
        const actualTabs = viewTabs.map((node) => node.getAttribute("data-sector-view-tab"));
        if (
          viewTabs.length !== expectedTabs.length ||
          !expectedTabs.every((tab, index) => actualTabs[index] === tab)
        ) {
          failures.push({
            check: "sector-view-switch-tabs",
            detail: `actual=${JSON.stringify(actualTabs)} expected=${JSON.stringify(expectedTabs)}`,
          });
        }
        viewTabs.forEach((node, index) => {
          const rect = node.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "sector-view-switch-target", detail: `tab ${index} height=${Math.round(rect.height)}` });
          }
        });
      }

      const heatmapPanel = document.querySelector('[data-sector-panel="heatmap"]');
      if (!heatmapPanel || heatmapPanel.getBoundingClientRect().height <= 0) {
        failures.push({ check: "sector-heatmap-default-visible", detail: "default heatmap panel not visible" });
      }
      const relativeBars = document.querySelector("[data-sector-relative-bars]");
      const relativeBarRows = Array.from(document.querySelectorAll("[data-sector-relative-bar]"))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      const relativeSides = new Set(relativeBarRows.map((node) => node.getAttribute("data-sector-relative-side")));
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
        if (rect.width < 36 || rect.height < 36) {
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
        if (rect.width < 36 || rect.height < 36) {
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
        const valuationBand = summaryModules.find((entry) => entry.key === "valuation-band");
        const threeSecondSummary = summaryModules.find((entry) => entry.key === "three-second-summary");
        if (!summaryScore || !valuationBand) {
          failures.push({
            check: "stock-summary-valuation-modules-present",
            detail: `modules=${JSON.stringify(summaryModules.map((entry) => entry.key))}`,
          });
        } else if (summaryScore.rect.top > valuationBand.rect.top + 1) {
          failures.push({
            check: "stock-summary-before-valuation",
            detail: `summaryTop=${summaryScore.rect.top} valuationTop=${valuationBand.rect.top}`,
          });
        }
        if (summaryScore && threeSecondSummary && summaryScore.rect.top > threeSecondSummary.rect.top + 1) {
          failures.push({
            check: "stock-summary-score-first",
            detail: `summaryTop=${summaryScore.rect.top} threeSecondTop=${threeSecondSummary.rect.top}`,
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
        if (valuationBand) {
          const valuationTrack = valuationBand.rect.height > 0
            ? document.querySelector("[data-stock-valuation-band-track]")
            : null;
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
        const embeddedFilings = document.querySelector('[data-edgar-embedded="true"]');
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
      if (currentRoute.includes("tab=insights") && regions.length < 5) {
        failures.push({ check: "superinvestors-insights-scroll-regions", detail: `visible regions=${regions.length}` });
      }
      if (currentRoute.includes("tab=insights")) {
        const status = document.querySelector("[data-superinvestor-insights-status]");
        const quarter = document.querySelector("[data-superinvestor-insights-quarter]");
        const lag = document.querySelector("[data-superinvestor-insights-lag]");
        const stale = document.querySelector("[data-superinvestor-insights-stale]");
        const excludedCount = Number.parseInt(status?.getAttribute("data-superinvestor-insights-excluded-count") || "", 10);
        if (!status || status.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-insights-status-visible", detail: "missing visible insights status strip" });
        }
        if (!quarter || !/\d{4}-Q\d/.test(quarter.textContent || "")) {
          failures.push({ check: "superinvestors-insights-quarter", detail: `quarter=${quarter?.textContent || ""}` });
        }
        if (!lag || !(lag.textContent || "").includes("45")) {
          failures.push({ check: "superinvestors-insights-13f-lag", detail: `lag=${lag?.textContent || ""}` });
        }
        if (!Number.isFinite(excludedCount) || excludedCount < 0) {
          failures.push({ check: "superinvestors-insights-excluded-count", detail: `excluded=${status?.getAttribute("data-superinvestor-insights-excluded-count") || ""}` });
        }
        if (Number.isFinite(excludedCount) && excludedCount > 0 && (!stale || !/\d+명/.test(stale.textContent || ""))) {
          failures.push({ check: "superinvestors-insights-stale-chip", detail: `stale=${stale?.textContent || ""}` });
        }
        const heatmap = document.querySelector("[data-superinvestor-accumulation-heatmap]");
        const tiles = Array.from(document.querySelectorAll("[data-superinvestor-accumulation-tile]"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!heatmap || heatmap.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-accumulation-heatmap-visible", detail: "missing visible accumulation heat-map" });
        }
        if (tiles.length < 6) {
          failures.push({ check: "superinvestors-accumulation-heatmap-tiles", detail: `visible tiles=${tiles.length}` });
        }
        const investorCounts = tiles
          .map((node) => Number.parseInt(node.getAttribute("data-superinvestor-accumulation-investors") || "", 10))
          .filter(Number.isFinite);
        const sortedDescending = investorCounts.every((value, index) => index === 0 || investorCounts[index - 1] >= value);
        if (investorCounts.length !== tiles.length || !sortedDescending) {
          failures.push({
            check: "superinvestors-accumulation-heatmap-sort",
            detail: `investors=${JSON.stringify(investorCounts)}`,
          });
        }
        const stockLinks = tiles
          .filter((node) => node.matches("a[data-superinvestor-accumulation-link]"))
          .map((node) => ({
            href: node instanceof HTMLAnchorElement ? new URL(node.href, window.location.origin).pathname : "",
            rect: node.getBoundingClientRect(),
          }));
        if (stockLinks.length !== tiles.length || stockLinks.some((link) => !link.href.startsWith("/stock/"))) {
          failures.push({
            check: "superinvestors-accumulation-heatmap-stock-links",
            detail: `links=${JSON.stringify(stockLinks.map((link) => link.href))}`,
          });
        }
        stockLinks.forEach((link, index) => {
          if (link.rect.height < 44) {
            failures.push({ check: "superinvestors-accumulation-heatmap-touch-target", detail: `tile ${index} height=${Math.round(link.rect.height)}` });
          }
        });
      }
      if (currentRoute.includes("tab=trades")) {
        const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
        const landing = document.querySelector("[data-superinvestor-trades-landing]");
        const landingAsOf = landing?.querySelector("[data-superinvestor-trades-asof]");
        const landingLag = landing?.querySelector("[data-superinvestor-trades-lag]");
        const kpis = Array.from(document.querySelectorAll("[data-superinvestor-trades-kpi]"));
        const panels = Array.from(document.querySelectorAll("[data-superinvestor-trades-panel]"));
        const boughtPanel = document.querySelector('[data-superinvestor-trades-panel][data-superinvestor-trades-side="bought"]');
        const soldPanel = document.querySelector('[data-superinvestor-trades-panel][data-superinvestor-trades-side="sold"]');
        const rows = Array.from(document.querySelectorAll("[data-superinvestor-trades-row]"));
        const boughtRows = Array.from(document.querySelectorAll('[data-superinvestor-trades-row][data-superinvestor-trades-side="bought"]'));
        const soldRows = Array.from(document.querySelectorAll('[data-superinvestor-trades-row][data-superinvestor-trades-side="sold"]'));
        const stockLinks = Array.from(document.querySelectorAll("[data-superinvestor-trades-stock-link]"));
        const investorLinks = Array.from(document.querySelectorAll("[data-superinvestor-trades-investor-link]"));
        const actions = Array.from(document.querySelectorAll("[data-superinvestor-trades-action]"));

        if (!selectedTab || !(selectedTab.textContent || "").includes("매매")) {
          failures.push({ check: "superinvestors-trades-selected-tab", detail: `selected=${selectedTab?.textContent || ""}` });
        }
        if (!landing) {
          failures.push({ check: "superinvestors-trades-landing", detail: "missing trades landing strip" });
        } else {
          const landingRect = landing.getBoundingClientRect();
          if (landingRect.height <= 0 || landingRect.top >= window.innerHeight) {
            failures.push({ check: "superinvestors-trades-first-viewport", detail: `top=${Math.round(landingRect.top)} height=${Math.round(landingRect.height)} viewport=${window.innerHeight}` });
          }
        }
        if (!landingAsOf || !/\d{4}-Q\d/.test(landingAsOf.textContent || "")) {
          failures.push({ check: "superinvestors-trades-asof", detail: `asOf=${landingAsOf?.textContent || ""}` });
        }
        if (!landingLag || !(landingLag.textContent || "").includes("45")) {
          failures.push({ check: "superinvestors-trades-13f-lag", detail: `lag=${landingLag?.textContent || ""}` });
        }
        if (kpis.length < 3) {
          failures.push({ check: "superinvestors-trades-kpis", detail: `kpis=${kpis.length}` });
        }
        if (panels.length < 2 || !boughtPanel || !soldPanel) {
          failures.push({ check: "superinvestors-trades-panels", detail: `panels=${panels.length}` });
        }
        if (rows.length < 20 || boughtRows.length < 10 || soldRows.length < 10) {
          failures.push({ check: "superinvestors-trades-rows", detail: `rows=${rows.length} bought=${boughtRows.length} sold=${soldRows.length}` });
        }
        if (stockLinks.length < 12) {
          failures.push({ check: "superinvestors-trades-stock-links", detail: `links=${stockLinks.length}` });
        }
        if (investorLinks.length < 12) {
          failures.push({ check: "superinvestors-trades-investor-links", detail: `links=${investorLinks.length}` });
        }
        [...stockLinks.slice(0, 12), ...investorLinks.slice(0, 12)].forEach((link, index) => {
          const url = link instanceof HTMLAnchorElement ? new URL(link.href, window.location.origin) : null;
          const href = url ? `${url.pathname}${url.search}` : "";
          const isStock = link.matches("[data-superinvestor-trades-stock-link]");
          const isInvestor = link.matches("[data-superinvestor-trades-investor-link]");
          if (isStock && !href.startsWith("/stock/")) {
            failures.push({ check: "superinvestors-trades-stock-href", detail: `index=${index} href=${href}` });
          }
          if (isInvestor && !(url?.pathname.replace(/\/$/, "") === "/superinvestors" && url.searchParams.get("tab") === "gurus" && url.searchParams.get("guru"))) {
            failures.push({ check: "superinvestors-trades-investor-href", detail: `index=${index} href=${href}` });
          }
        });
        actions.slice(0, 24).forEach((link, index) => {
          const rect = link.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "superinvestors-trades-action-touch-target", detail: `index=${index} height=${Math.round(rect.height)}` });
          }
        });
      }
      if (currentRoute.includes("tab=gurus") && currentRoute.includes("guru=")) {
        const params = new URLSearchParams(currentRoute.split("?")[1] || "");
        const guruId = params.get("guru") || "";
        const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
        const landing = document.querySelector("[data-superinvestor-guru-landing]");
        const landingAsOf = landing?.querySelector("[data-superinvestor-guru-landing-asof]");
        const landingLag = landing?.querySelector("[data-superinvestor-guru-landing-lag]");
        const landingActions = Array.from(landing?.querySelectorAll("[data-superinvestor-guru-action]") || []);
        const landingStockLinks = Array.from(landing?.querySelectorAll("[data-superinvestor-guru-landing-stock-link]") || []);
        const cards = Array.from(document.querySelectorAll("[data-superinvestor-guru-card]"));
        const card = cards.find((node) => node.getAttribute("data-superinvestor-guru-id") === guruId);
        const profile = document.querySelector(`[data-superinvestor-guru-profile][data-superinvestor-guru-id="${guruId}"]`);
        const profileHero = profile?.querySelector("[data-superinvestor-guru-profile-hero]");
        const asOf = profile?.querySelector("[data-superinvestor-guru-asof]");
        const lag = profile?.querySelector("[data-superinvestor-guru-lag-disclosure]");
        const filing = profile?.querySelector("[data-superinvestor-guru-filing]");
        const kpis = Array.from(profile?.querySelectorAll("[data-superinvestor-guru-kpi]") || []);
        const portfolio = profile?.querySelector("[data-superinvestor-guru-portfolio]");
        const treemap = profile?.querySelector("[data-superinvestor-guru-treemap]");
        const topHoldings = profile?.querySelector("[data-superinvestor-guru-top-holdings]");
        const holdingRows = Array.from(profile?.querySelectorAll("[data-superinvestor-guru-holding-row]") || []);
        const top5Links = Array.from(card?.querySelectorAll("a[data-superinvestor-guru-top5-link]") || []);
        const holdingLinks = holdingRows
          .map((row) => row.querySelector('a[href^="/stock/"]'))
          .filter(Boolean);

        if (!selectedTab || !(selectedTab.textContent || "").includes("투자자")) {
          failures.push({ check: "superinvestors-guru-selected-tab", detail: `selected=${selectedTab?.textContent || ""}` });
        }
        if (!landing) {
          failures.push({ check: "superinvestors-guru-landing", detail: "missing selected guru landing strip" });
        } else {
          const landingRect = landing.getBoundingClientRect();
          if (landing.getAttribute("data-superinvestor-guru-id") !== guruId) {
            failures.push({ check: "superinvestors-guru-landing-id", detail: `landing=${landing.getAttribute("data-superinvestor-guru-id") || ""} expected=${guruId}` });
          }
          if (landingRect.height <= 0 || landingRect.top >= window.innerHeight) {
            failures.push({ check: "superinvestors-guru-first-viewport", detail: `top=${Math.round(landingRect.top)} height=${Math.round(landingRect.height)} viewport=${window.innerHeight}` });
          }
        }
        if (!landingAsOf || !/\d{4}-Q\d/.test(landingAsOf.textContent || "")) {
          failures.push({ check: "superinvestors-guru-landing-asof", detail: `asOf=${landingAsOf?.textContent || ""}` });
        }
        if (!landingLag || !(landingLag.textContent || "").includes("45")) {
          failures.push({ check: "superinvestors-guru-landing-lag", detail: `lag=${landingLag?.textContent || ""}` });
        }
        if (landingActions.length < 4) {
          failures.push({ check: "superinvestors-guru-landing-actions", detail: `actions=${landingActions.length}` });
        }
        if (!card) {
          failures.push({ check: "superinvestors-guru-card", detail: `guru=${guruId || "missing"}` });
        } else {
          if (card.getAttribute("data-superinvestor-guru-expanded") !== "true") {
            failures.push({ check: "superinvestors-guru-expanded", detail: `expanded=${card.getAttribute("data-superinvestor-guru-expanded") || ""}` });
          }
          if (cards[0] !== card) {
            failures.push({ check: "superinvestors-guru-pinned-first", detail: `first=${cards[0]?.getAttribute("data-superinvestor-guru-id") || ""} expected=${guruId}` });
          }
        }
        if (!profile || profile.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-guru-profile-visible", detail: `guru=${guruId || "missing"}` });
        }
        if (!profileHero || profileHero.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-guru-profile-hero", detail: "missing visible profile hero" });
        }
        if (!asOf || !/\d{4}-Q\d/.test(asOf.textContent || "")) {
          failures.push({ check: "superinvestors-guru-asof", detail: `asOf=${asOf?.textContent || ""}` });
        }
        if (!filing || !/\d{4}-\d{2}-\d{2}/.test(filing.textContent || "")) {
          failures.push({ check: "superinvestors-guru-filing-date", detail: `filing=${filing?.textContent || ""}` });
        }
        if (!lag || !(lag.textContent || "").includes("45")) {
          failures.push({ check: "superinvestors-guru-13f-lag", detail: `lag=${lag?.textContent || ""}` });
        }
        if (kpis.length < 4) {
          failures.push({ check: "superinvestors-guru-kpis", detail: `kpis=${kpis.length}` });
        }
        if (!portfolio || portfolio.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-guru-portfolio-visible", detail: "missing portfolio section" });
        }
        if (!treemap || Number.parseInt(treemap.getAttribute("data-superinvestor-guru-treemap-count") || "", 10) < 1) {
          failures.push({ check: "superinvestors-guru-treemap", detail: `count=${treemap?.getAttribute("data-superinvestor-guru-treemap-count") || ""}` });
        }
        if (!topHoldings || topHoldings.getBoundingClientRect().height <= 0 || holdingRows.length < 8) {
          failures.push({ check: "superinvestors-guru-top-holdings", detail: `rows=${holdingRows.length}` });
        }
        if (portfolio && topHoldings && !(portfolio.compareDocumentPosition(topHoldings) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          failures.push({ check: "superinvestors-guru-profile-order", detail: "portfolio should precede top holdings" });
        }
        if (top5Links.length < 3) {
          failures.push({ check: "superinvestors-guru-top5-stock-links", detail: `links=${top5Links.length}` });
        }
        if (holdingLinks.length < Math.min(8, holdingRows.length)) {
          failures.push({ check: "superinvestors-guru-holding-stock-links", detail: `links=${holdingLinks.length} rows=${holdingRows.length}` });
        }
        [...landingStockLinks, ...top5Links, ...holdingLinks.slice(0, 8)].forEach((link, index) => {
          const href = link instanceof HTMLAnchorElement ? new URL(link.href, window.location.origin).pathname : "";
          if (!href.startsWith("/stock/")) {
            failures.push({ check: "superinvestors-guru-action-href", detail: `index=${index} href=${href}` });
          }
        });
        [...landingActions, ...top5Links, ...holdingLinks.slice(0, 8)].forEach((link, index) => {
          const rect = link.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "superinvestors-guru-action-touch-target", detail: `index=${index} height=${Math.round(rect.height)}` });
          }
        });
      }
      if (currentRoute.includes("tab=by-ticker") && (currentRoute.includes("ticker=") || currentRoute.includes("symbol="))) {
        const params = new URLSearchParams(currentRoute.split("?")[1] || "");
        const ticker = (params.get("ticker") || params.get("symbol") || "").toUpperCase();
        const selectedTab = document.querySelector('[role="tab"][aria-selected="true"]');
        const landing = document.querySelector("[data-superinvestor-ticker-landing]");
        const panel = document.querySelector("[data-superinvestor-ticker-panel]");
        const result = document.querySelector("[data-superinvestor-ticker-result]");
        const landingAsOf = landing?.querySelector("[data-superinvestor-ticker-landing-asof]");
        const landingLag = landing?.querySelector("[data-superinvestor-ticker-landing-lag]");
        const panelAsOf = panel?.querySelector("[data-superinvestor-ticker-asof]");
        const panelLag = panel?.querySelector("[data-superinvestor-ticker-lag]");
        const kpis = Array.from(document.querySelectorAll("[data-superinvestor-ticker-kpi]"));
        const stockLinks = Array.from(document.querySelectorAll("[data-superinvestor-ticker-stock-link]"));
        const screenerLinks = Array.from(document.querySelectorAll("[data-superinvestor-ticker-screener-link]"));
        const investorLinks = Array.from(document.querySelectorAll("[data-superinvestor-ticker-investor-link], [data-superinvestor-ticker-holder-link]"));
        const holdersRegion = document.querySelector("[data-superinvestor-ticker-holders]");
        const rows = Array.from(document.querySelectorAll("[data-superinvestor-ticker-holder-row]"));
        const holderLinks = Array.from(document.querySelectorAll("[data-superinvestor-ticker-holder-link]"));

        if (!selectedTab || !(selectedTab.textContent || "").includes("종목별")) {
          failures.push({ check: "superinvestors-by-ticker-selected-tab", detail: `selected=${selectedTab?.textContent || ""}` });
        }
        if (!landing) {
          failures.push({ check: "superinvestors-by-ticker-landing", detail: "missing selected ticker landing strip" });
        } else {
          const landingRect = landing.getBoundingClientRect();
          if (landing.getAttribute("data-superinvestor-ticker-symbol") !== ticker) {
            failures.push({ check: "superinvestors-by-ticker-landing-symbol", detail: `landing=${landing.getAttribute("data-superinvestor-ticker-symbol") || ""} expected=${ticker}` });
          }
          if (landingRect.height <= 0 || landingRect.top >= window.innerHeight) {
            failures.push({ check: "superinvestors-by-ticker-first-viewport", detail: `top=${Math.round(landingRect.top)} height=${Math.round(landingRect.height)} viewport=${window.innerHeight}` });
          }
        }
        if (!panel || panel.getAttribute("data-superinvestor-ticker-symbol") !== ticker) {
          failures.push({ check: "superinvestors-by-ticker-panel", detail: `panel=${panel?.getAttribute("data-superinvestor-ticker-symbol") || ""} expected=${ticker}` });
        }
        if (!result || result.getBoundingClientRect().height <= 0) {
          failures.push({ check: "superinvestors-by-ticker-result-visible", detail: "missing visible ticker result" });
        }
        if (!landingAsOf || !/\d{4}-Q\d/.test(landingAsOf.textContent || "")) {
          failures.push({ check: "superinvestors-by-ticker-landing-asof", detail: `asOf=${landingAsOf?.textContent || ""}` });
        }
        if (!panelAsOf || !/\d{4}-Q\d/.test(panelAsOf.textContent || "")) {
          failures.push({ check: "superinvestors-by-ticker-panel-asof", detail: `asOf=${panelAsOf?.textContent || ""}` });
        }
        if (!landingLag || !(landingLag.textContent || "").includes("45") || !panelLag || !(panelLag.textContent || "").includes("45")) {
          failures.push({ check: "superinvestors-by-ticker-13f-lag", detail: `landing=${landingLag?.textContent || ""} panel=${panelLag?.textContent || ""}` });
        }
        if (kpis.length < 3) {
          failures.push({ check: "superinvestors-by-ticker-kpis", detail: `kpis=${kpis.length}` });
        }
        if (!holdersRegion || holdersRegion.getBoundingClientRect().height <= 0 || rows.length < 8) {
          failures.push({ check: "superinvestors-by-ticker-holder-rows", detail: `rows=${rows.length}` });
        }
        if (holderLinks.length < Math.min(8, rows.length)) {
          failures.push({ check: "superinvestors-by-ticker-holder-links", detail: `links=${holderLinks.length} rows=${rows.length}` });
        }
        if (stockLinks.length < 2) {
          failures.push({ check: "superinvestors-by-ticker-stock-links", detail: `links=${stockLinks.length}` });
        }
        if (screenerLinks.length < 2) {
          failures.push({ check: "superinvestors-by-ticker-screener-links", detail: `links=${screenerLinks.length}` });
        }
        [...stockLinks, ...screenerLinks, ...investorLinks.slice(0, 12)].forEach((link, index) => {
          const url = link instanceof HTMLAnchorElement ? new URL(link.href, window.location.origin) : null;
          const href = url ? `${url.pathname}${url.search}` : "";
          const isStock = link.matches("[data-superinvestor-ticker-stock-link]");
          const isScreener = link.matches("[data-superinvestor-ticker-screener-link]");
          const isInvestor = link.matches("[data-superinvestor-ticker-investor-link], [data-superinvestor-ticker-holder-link]");
          if (isStock && !href.startsWith(`/stock/${ticker}`)) {
            failures.push({ check: "superinvestors-by-ticker-stock-href", detail: `index=${index} href=${href}` });
          }
          if (isScreener && !(url?.pathname.replace(/\/$/, "") === "/screener" && url.searchParams.get("ticker") === ticker)) {
            failures.push({ check: "superinvestors-by-ticker-screener-href", detail: `index=${index} href=${href}` });
          }
          if (isInvestor && !(url?.pathname.replace(/\/$/, "") === "/superinvestors" && url.searchParams.get("tab") === "gurus" && url.searchParams.get("guru"))) {
            failures.push({ check: "superinvestors-by-ticker-investor-href", detail: `index=${index} href=${href}` });
          }
          const rect = link.getBoundingClientRect();
          if (rect.height < 44) {
            failures.push({ check: "superinvestors-by-ticker-action-touch-target", detail: `index=${index} height=${Math.round(rect.height)}` });
          }
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

async function collectScreenerExpandedChecks(page, route) {
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 768) {
    return {
      route,
      viewportWidth: viewport.width,
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

async function collectScreenerCardViewChecks(page, route) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width < 768) {
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

  const expandButton = page.locator('[data-screener-card-grid] [aria-controls^="screener-card-detail"]:visible').first();
  if ((await expandButton.count()) > 0) {
    await expandButton.click({ timeout: 10000 });
    await page.waitForTimeout(300);
  }

  return page.evaluate((currentRoute) => {
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
      failures,
    };
  }, route);
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
  const button = page.locator('[data-stock-estimates-granularity="quarterly"]').first();
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
  await page.waitForTimeout(300);

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

async function collectSectorViewSwitchChecks(page, route) {
  const viewport = page.viewportSize();
  if (!viewport || viewport.width >= 768) {
    return {
      route,
      failures: [],
      scrollWidth: null,
    };
  }

  const expectedTabs = ["heatmap", "etf", "valuation", "guru"];
  const failures = [];
  let clickScrollWidth = null;

  for (const tab of expectedTabs) {
    await page.locator(`[data-sector-view-tab="${tab}"]`).click();
    await page.waitForTimeout(150);
    const check = await page.evaluate((key) => {
      const localFailures = [];
      const viewportWidth = window.innerWidth;
      const scrollWidth = Math.max(
        document.documentElement.scrollWidth,
        document.body?.scrollWidth ?? 0,
      );
      const button = document.querySelector(`[data-sector-view-tab="${key}"]`);
      const panel = document.querySelector(`[data-sector-panel="${key}"]`);
      const current = document.querySelector("[data-sector-view-current]");
      const buttonPressed = button?.getAttribute("aria-pressed") === "true";
      const panelRect = panel?.getBoundingClientRect();
      const currentKey = current?.getAttribute("data-sector-view-current");

      if (!buttonPressed) {
        localFailures.push({ check: "sector-view-switch-click-state", detail: `tab=${key} aria-pressed=${button?.getAttribute("aria-pressed")}` });
      }
      if (!panel || !panelRect || panelRect.width <= 0 || panelRect.height <= 0) {
        localFailures.push({ check: "sector-view-switch-click-panel", detail: `tab=${key} panel not visible` });
      }
      if (currentKey !== key) {
        localFailures.push({ check: "sector-view-current-summary", detail: `tab=${key} current=${currentKey || ""}` });
      }
      if (scrollWidth > viewportWidth + 1) {
        localFailures.push({
          check: "sector-view-switch-no-horizontal-overflow",
          detail: `tab=${key} scrollWidth=${scrollWidth} viewport=${viewportWidth}`,
        });
      }
      return { failures: localFailures, scrollWidth };
    }, tab);
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
          const cardViewChecks = await collectScreenerCardViewChecks(page, route);
          result.failures.push(...cardViewChecks.failures);
          result.cardViewScrollWidth = cardViewChecks.scrollWidth;
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
        }
        if (route.startsWith("/sectors")) {
          const sectorViewChecks = await collectSectorViewSwitchChecks(page, route);
          result.failures.push(...sectorViewChecks.failures);
          result.sectorViewSwitchScrollWidth = sectorViewChecks.scrollWidth;
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
