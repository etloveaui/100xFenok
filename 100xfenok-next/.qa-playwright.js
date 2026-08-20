/* eslint-disable @typescript-eslint/no-require-imports */
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const qaCatalog = await import("./scripts/qa-route-catalog.mjs");

const base = process.env.QA_BASE_URL || "http://127.0.0.1:4173";
const baseOrigin = new URL(base).origin;
const adminPassword = process.env.QA_ADMIN_PASSWORD || "";
const screenshotDir = process.env.QA_SCREENSHOT_DIR || "";
const outputJsonPath = process.env.QA_OUTPUT_JSON || "";
const strictMode = process.env.QA_BROWSER_STRICT === "1";
const browserChannel = process.env.QA_BROWSER_CHANNEL || "";
const browserExecutablePath = process.env.QA_CHROMIUM_EXECUTABLE_PATH || "";

function parseCsvEnv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function stripEmbedParam(raw) {
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, baseOrigin);
    parsed.searchParams.delete("embed");
    const nextQuery = parsed.searchParams.toString();
    return `${parsed.pathname}${nextQuery ? `?${nextQuery}` : ""}${parsed.hash || ""}`;
  } catch {
    return raw.replace(/([?&])embed=1(&|$)/, "$1").replace(/[?&]$/, "");
  }
}

function isExternalUrl(url) {
  try {
    return new URL(url, base).origin !== baseOrigin;
  } catch {
    return false;
  }
}

function extractExplicitExternalEvidence(message) {
  const text = String(message || "");
  const urls = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const hasExternalUrl = urls.some((url) => isExternalUrl(url.replace(/[),.;]+$/g, "")));
  const hasKnownExternalHost = /(?:api\.allorigins\.win|query1\.finance\.yahoo\.com|fred\.stlouisfed\.org|api\.stlouisfed\.org|fiscaldata\.treasury\.gov|api\.treasury\.gov)/i.test(text);
  return hasExternalUrl || hasKnownExternalHost;
}

function isIgnoredRequestFailure(failure) {
  return /ERR_ABORTED|ERR_CANCELED/i.test(failure.errorText || "");
}

function isSameOriginDataUrl(url) {
  if (isExternalUrl(url)) return false;
  return /\/api\//i.test(url) || /\/data\//i.test(url) || /\.json(?:[?#]|$)/i.test(url);
}

function isCriticalSameOriginDataFailure(failure) {
  if (!isSameOriginDataUrl(failure.url)) return false;
  if (isIgnoredRequestFailure(failure)) return false;
  return true;
}

function isExternalFetchNoise(message) {
  if (!extractExplicitExternalEvidence(message)) return false;
  return (
    /TypeError:\s*Failed to fetch/i.test(message) ||
    /api\.allorigins\.win/i.test(message) ||
    /query1\.finance\.yahoo\.com/i.test(message) ||
    /fred\.stlouisfed\.org/i.test(message) ||
    /(?:api\.stlouisfed\.org|fiscaldata\.treasury\.gov|api\.treasury\.gov)/i.test(message) ||
    /has been blocked by CORS policy/i.test(message) ||
    /No 'Access-Control-Allow-Origin' header is present/i.test(message) ||
    /Failed to load resource: net::ERR_FAILED/i.test(message)
  );
}

function responsePath(url) {
  try {
    return new URL(url, base).pathname;
  } catch {
    return "";
  }
}

function isExplicitNonBlockingHttpFailure(failure, route) {
  if (failure.status !== 404 || route !== "/100x/daily-wrap") return false;
  return /^\/100x\/daily-wrap\/data\/[^/]+-data\.json$/i.test(responsePath(failure.url));
}

function isExpectedNegativeRouteResponse(failure, route) {
  if (route !== "/this-route-should-not-exist") return false;
  try {
    return new URL(failure.url, base).pathname === route;
  } catch {
    return false;
  }
}

function isNonBlockingConsoleNoise(message, route, httpFailures) {
  // Daily Wrap's dated report data is an explicit, route-scoped optional input.
  if (/리포트 데이터를 불러오는 데 실패했습니다/i.test(message)) {
    return route === "/100x/daily-wrap";
  }

  // A bare browser 404 message has no URL. It is non-blocking only when every
  // same-origin 404 response observed for this route matches the narrow
  // Daily Wrap data contract above; all other 404s remain blocking.
  if (!/Failed to load resource: the server responded with a status of 404/i.test(message)) {
    return false;
  }
  if (route !== "/100x/daily-wrap") return false;
  const sameOriginHttpFailures = httpFailures.filter(
    (failure) => !isExternalUrl(failure.url) && failure.status === 404,
  );
  return (
    sameOriginHttpFailures.length > 0 &&
    sameOriginHttpFailures.every((failure) => isExplicitNonBlockingHttpFailure(failure, route))
  );
}

function isDevServerNoise(message) {
  return (
    // HMR / Fast Refresh messages
    /\[HMR\]/i.test(message) ||
    /\[Fast Refresh\]/i.test(message) ||
    /webpack-hmr/i.test(message) ||
    // Turbopack compilation messages
    /turbopack/i.test(message) ||
    /\[Turbopack\]/i.test(message) ||
    // React hydration mismatch warnings (dev-only)
    /Hydration failed because/i.test(message) ||
    /There was an error while hydrating/i.test(message) ||
    /Text content does not match/i.test(message) ||
    /did not match\. Server/i.test(message) ||
    // Next.js internal dev messages
    /__nextjs/i.test(message) ||
    /__next/i.test(message) ||
    /next-router-state-tree/i.test(message) ||
    // Chunk load errors from hot reload
    /ChunkLoadError/i.test(message) ||
    /Loading chunk/i.test(message) ||
    // Dev server WebSocket reconnection
    /WebSocket connection/i.test(message) ||
    /\[webpack-dev-server\]/i.test(message) ||
    // React dev mode warnings
    /Warning: Each child in a list/i.test(message) ||
    /Warning: validateDOMNesting/i.test(message) ||
    /Download the React DevTools/i.test(message)
  );
}

const postsDeepLinkRoute = qaCatalog.postsDeepLinkRoute;
const vrDeepLinkRoute = qaCatalog.vrDeepLinkRoute;
const alphaReportDeepLinkRoute = qaCatalog.alphaReportDeepLinkRoute;
const designLabNativeRoute = qaCatalog.designLabNativeRoute;
const tabSectorsRoute = qaCatalog.tabSectorsRoute;
const tabLiquidityRoute = qaCatalog.tabLiquidityRoute;
const tabSentimentRoute = qaCatalog.tabSentimentRoute;
const p2DataStateRoutes = qaCatalog.P2_DATA_STATE_ROUTES;

const defaultRoutes = qaCatalog.PLAYWRIGHT_ROUTES;
const requestedRoutes = parseCsvEnv(process.env.QA_ROUTES);
const routes = requestedRoutes.length > 0 ? requestedRoutes : defaultRoutes;

const expectedIframeRoutes = qaCatalog.EXPECTED_IFRAME_ROUTES;

const expectedInnerShellCleanRoutes = qaCatalog.EXPECTED_INNER_SHELL_CLEAN_ROUTES;

const expectedIframeSrcByRoute = qaCatalog.EXPECTED_IFRAME_SRC_BY_ROUTE;

const viewportCatalog = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "fold", width: 540, height: 720 },
];
const defaultViewportNames = new Set(["desktop", "mobile", "fold"]);
const requestedViewportNames = parseCsvEnv(process.env.QA_VIEWPORTS).map((value) =>
  value.toLowerCase(),
);
const viewports =
  requestedViewportNames.length > 0
    ? viewportCatalog.filter((viewport) =>
        requestedViewportNames.includes(viewport.name),
      )
    : viewportCatalog.filter((viewport) => defaultViewportNames.has(viewport.name));

const isDevServer = base.includes(":3000") || process.env.QA_DEV === "1";
const p2DataStateRouteSet = new Set(p2DataStateRoutes);

const currentHomeRailRoutes = [
  { name: "home", href: "/" },
  { name: "market", href: "/market-valuation" },
  { name: "screener", href: "/screener" },
  { name: "portfolio", href: "/portfolio" },
];

if (routes.length === 0) {
  throw new Error("No routes configured. Set QA_ROUTES or use default routes.");
}

if (viewports.length === 0) {
  throw new Error(
    "No viewports configured. Set QA_VIEWPORTS with desktop,mobile,tablet,fold or use defaults.",
  );
}

if (screenshotDir) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

if (outputJsonPath) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
}

function screenshotName(viewport, route) {
  const safeRoute = route.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "root";
  return `${viewport}-${safeRoute}.png`;
}

async function maybeCaptureScreenshot(page, viewport, route) {
  if (!screenshotDir) return null;
  const file = path.join(screenshotDir, screenshotName(viewport, route));
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

function isRadarFrameUrl(url) {
  return !isExternalUrl(url) && /\/tools\/macro-monitor\//i.test(responsePath(url));
}

function isRadarActivityUrl(url) {
  if (isExternalUrl(url)) return false;
  const pathname = responsePath(url);
  return /\/tools\/macro-monitor\//i.test(pathname) || /\/data\/(?:macro|sentiment)\//i.test(pathname);
}

async function waitForRadarSettle(page, activeRequests, getActivity) {
  const startedAt = Date.now();
  const deadline = startedAt + 12000;
  const quietWindowMs = 800;
  let lastActivity = getActivity();
  let lastFrameSignature = "";
  let quietSince = startedAt;
  let observedFrameCount = 0;
  let observedActiveCount = activeRequests.size;

  while (Date.now() < deadline) {
    const frameSignature = page.frames()
      .map((frame) => frame.url())
      .filter(isRadarFrameUrl)
      .sort()
      .join("|");
    const activity = getActivity();
    if (activity !== lastActivity || frameSignature !== lastFrameSignature) {
      lastActivity = activity;
      lastFrameSignature = frameSignature;
      quietSince = Date.now();
    }
    const nestedFrameCount = frameSignature ? frameSignature.split("|").length : 0;
    observedFrameCount = nestedFrameCount;
    observedActiveCount = activeRequests.size;
    if (
      nestedFrameCount === 5 &&
      observedActiveCount === 0 &&
      Date.now() - quietSince >= quietWindowMs
    ) {
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(
    `radar settle timeout: frames=${observedFrameCount}/5 activeRequests=${observedActiveCount} quietMs=${Math.max(0, Date.now() - quietSince)}/800`,
  );
}

async function inspectHomeShell(page) {
  return page.evaluate((expectedRoutes) => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const roots = Array.from(document.querySelectorAll(".fnk-shell"));
    const current = Array.from(document.querySelectorAll(".fnk-shell.cp-home-shell"));
    const legacy = Array.from(document.querySelectorAll("#mainNav"));
    const shell = current[0] || null;
    const rail = shell ? Array.from(shell.querySelectorAll(".rail")) : [];
    const railNav = shell?.querySelector(".rail-nav") || null;
    const tabbar = shell?.querySelector(".tabbar") || null;
    const more = tabbar?.querySelector('button[aria-controls="mobile-more-sheet"]') || null;
    const keyRouteLinks = expectedRoutes.map(({ name, href }) => {
      const links = railNav
        ? Array.from(railNav.querySelectorAll("a[href]")).filter((link) => link.getAttribute("href") === href)
        : [];
      return { name, href, count: links.length, visibleCount: links.filter(visible).length };
    });
    const tabLinks = expectedRoutes.map(({ name, href }) => {
      const links = tabbar
        ? Array.from(tabbar.querySelectorAll("a[href]")).filter((link) => link.getAttribute("href") === href)
        : [];
      return { name, href, count: links.length, visibleCount: links.filter(visible).length };
    });
    const currentRailVisible = current.reduce(
      (count, node) => count + Array.from(node.querySelectorAll(".rail")).filter(visible).length,
      0,
    );
    const currentTabbarVisible = current.reduce(
      (count, node) => count + Array.from(node.querySelectorAll(".tabbar")).filter(visible).length,
      0,
    );
    const legacyDesktopVisible = legacy.reduce(
      (count, node) => count + Array.from(node.querySelectorAll('button[aria-controls="desktop-market-menu"]')).filter(visible).length,
      0,
    );
    const legacyMobileVisible = legacy.reduce(
      (count, node) => count + Array.from(node.querySelectorAll('button[aria-controls="mobile-navigation-panel"]')).filter(visible).length,
      0,
    );
    const family =
      roots.length === 1 && current.length === 1 && legacy.length === 0
        ? "current"
        : roots.length === 0 && current.length === 0 && legacy.length === 1
          ? "legacy"
          : null;
    const layout =
      family === "current" && currentRailVisible === 1 && currentTabbarVisible === 0
        ? "desktop"
        : family === "current" && currentRailVisible === 0 && currentTabbarVisible === 1
          ? "mobile"
          : family === "legacy" && legacyDesktopVisible === 1 && legacyMobileVisible === 0
            ? "desktop"
            : family === "legacy" && legacyDesktopVisible === 0 && legacyMobileVisible === 1
              ? "mobile"
              : null;
    return {
      family,
      layout,
      shellRootCount: roots.length,
      shellVisible: Boolean(shell && visible(shell)),
      railCount: rail.length,
      railVisibleCount: rail.filter(visible).length,
      railNavVisible: Boolean(railNav && visible(railNav)),
      keyRouteLinks,
      tabbarCount: tabbar ? 1 : 0,
      tabbarVisible: Boolean(tabbar && visible(tabbar)),
      tabCount: tabbar?.querySelectorAll(".tab").length || 0,
      moreButtonCount: more ? 1 : 0,
      moreButtonVisible: Boolean(more && visible(more)),
      initialExpanded: more?.getAttribute("aria-expanded") || null,
      initialControls: more?.getAttribute("aria-controls") || null,
      tabLinks,
      legacyDesktopVisible,
      legacyMobileVisible,
    };
  }, currentHomeRailRoutes);
}

async function runCurrentHomeMobileInteraction(page, state) {
  const result = { check: "currentHomeMobileTabs", shellFamily: "current", pass: false, ...state };
  const tabLinksPass = state.tabLinks.every((link) => link.count === 1 && link.visibleCount === 1);
  const structurePass =
    state.family === "current" &&
    state.layout === "mobile" &&
    state.shellVisible &&
    state.tabbarCount === 1 &&
    state.tabbarVisible &&
    state.tabCount === 5 &&
    state.moreButtonCount === 1 &&
    state.moreButtonVisible &&
    state.initialExpanded === "false" &&
    state.initialControls === "mobile-more-sheet" &&
    tabLinksPass;
  if (!structurePass) return result;

  try {
    const more = page.locator('.fnk-shell.cp-home-shell .tabbar button[aria-controls="mobile-more-sheet"]').first();
    const sheet = page.locator("#mobile-more-sheet").first();
    await more.click();
    await sheet.waitFor({ state: "visible", timeout: 3000 });
    const close = sheet.locator("button.mobile-more-close").first();
    const openPass =
      (await more.getAttribute("aria-expanded")) === "true" &&
      (await sheet.getAttribute("role")) === "dialog" &&
      (await sheet.getAttribute("aria-modal")) === "true" &&
      (await close.isVisible()) &&
      (await sheet.locator(".mobile-more-item").count()) > 0;
    await close.click();
    await sheet.waitFor({ state: "detached", timeout: 3000 });
    const closePass = (await more.getAttribute("aria-expanded")) === "false";
    result.openPass = openPass;
    result.closePass = closePass;
    result.pass = openPass && closePass;
  } catch (err) {
    result.error = String(err);
  }
  return result;
}

async function runLegacyHomeMobileChecks(page) {
  const result = { check: "legacyMobileMenu", shellFamily: "legacy", pass: false };
  const open = page.locator(
    'button[aria-controls="mobile-navigation-panel"], button[aria-label="Open menu"], button[aria-label="메뉴 열기"]',
  ).first();
  if (!(await open.count()) || !(await open.isVisible())) {
    result.error = "legacy mobile menu button missing or hidden";
    return result;
  }
  try {
    const initialExpanded = await open.getAttribute("aria-expanded");
    await open.click();
    const panel = page.locator("#mobile-navigation-panel").first();
    await panel.waitFor({ state: "visible", timeout: 3000 });
    const overlay = page.locator('button[aria-label="Close mobile menu overlay"]').first();
    const close = page.locator('button[aria-label="메뉴 닫기"], button[aria-label="Close menu"]').first();
    const menuState = { panelVisible: await panel.isVisible(), overlayVisible: (await overlay.count()) > 0 };
    if (menuState.overlayVisible) {
      await page.mouse.click(12, Math.max(12, Math.floor((await page.evaluate(() => window.innerHeight)) / 2)));
      await page.waitForTimeout(200);
    }
    if (await page.locator("#mobile-navigation-panel").count() && (await close.count())) {
      await close.click();
      await page.waitForTimeout(200);
    }
    const afterClose = await page.evaluate(() => ({
      panelVisible: Boolean(document.querySelector("#mobile-navigation-panel")),
      overlayVisible: Boolean(document.querySelector(".mobile-overlay.visible")),
      bodyOverflow: document.body.style.overflow || "",
      bodyPosition: document.body.style.position || "",
    }));
    result.initialExpanded = initialExpanded;
    result.menuState = menuState;
    result.afterClose = afterClose;
    result.pass =
      initialExpanded === "false" &&
      menuState.panelVisible &&
      menuState.overlayVisible &&
      !afterClose.panelVisible &&
      !afterClose.overlayVisible &&
      afterClose.bodyOverflow === "" &&
      afterClose.bodyPosition === "";
  } catch (err) {
    result.error = String(err);
  }
  return result;
}

async function runHomeShellChecks(page) {
  const state = await inspectHomeShell(page);
  const familyCheck = {
    check: "homeShellFamily",
    pass: state.family !== null && state.layout !== null,
    family: state.family,
    layout: state.layout,
    shellRootCount: state.shellRootCount,
  };
  if (!familyCheck.pass) return [familyCheck];
  if (state.family === "current" && state.layout === "desktop") {
    const keyLinksPass = state.keyRouteLinks.every((link) => link.count === 1 && link.visibleCount === 1);
    return [
      familyCheck,
      {
        check: "currentHomeDesktopShell",
        shellFamily: "current",
        pass:
          state.shellVisible &&
          state.railCount === 1 &&
          state.railVisibleCount === 1 &&
          state.railNavVisible &&
          keyLinksPass,
        railCount: state.railCount,
        railVisibleCount: state.railVisibleCount,
        keyRouteLinks: state.keyRouteLinks,
      },
    ];
  }
  if (state.family === "current") return [familyCheck, await runCurrentHomeMobileInteraction(page, state)];
  if (state.layout === "desktop") {
    const dropdownChecks = await runDesktopDropdownChecks(page);
    return [familyCheck, ...dropdownChecks.map((check) => ({ ...check, shellFamily: "legacy" }))];
  }
  return [familyCheck, await runLegacyHomeMobileChecks(page)];
}

async function prewarmRoutes() {
  if (!isDevServer) return;
  console.error("[QA] Dev server detected — pre-warming routes for Turbopack compilation...");
  for (const route of routes) {
    await new Promise((resolve) => {
      const req = http.get(`${base}${route}`, (res) => {
        res.resume();
        res.on("end", resolve);
      });
      req.on("error", resolve);
      req.setTimeout(60000, () => { req.destroy(); resolve(); });
    });
  }
  // Extra wait for compilation to settle
  await new Promise((r) => setTimeout(r, 3000));
  console.error("[QA] Pre-warm complete.");
}

async function runDesktopDropdownChecks(page) {
  const menuConfigs = [
    { label: "MARKET", itemText: "Market Wrap", hrefPrefix: "/market", panelId: "#desktop-market-menu", openWith: "click", expectFocusMove: false },
    { label: "ANALYTICS", itemText: "Multichart", hrefPrefix: "/multichart", panelId: "#desktop-analytics-menu", openWith: "enter", expectFocusMove: true },
    { label: "STRATEGIES", itemText: "IB Helper", hrefPrefix: "/ib", panelId: "#desktop-strategies-menu", openWith: "space", expectFocusMove: true },
  ];

  const checks = [];

  const openMenu = async (button, openWith) => {
    if (openWith === "click") {
      await button.click();
      return;
    }
    if (openWith === "enter") {
      await button.focus();
      await page.keyboard.press("Enter");
      return;
    }
    if (openWith === "space") {
      await button.focus();
      await page.keyboard.press("Space");
      return;
    }
    await button.focus();
    await page.keyboard.press("ArrowDown");
  };

  for (const config of menuConfigs) {
    const button = page.getByRole("button", { name: config.label }).first();
    await button.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(1100);
    await openMenu(button, config.openWith);

    const waitForPanelOpen = () =>
      page.waitForFunction(
        (panelId) => {
          const panel = document.querySelector(panelId);
          return (
            panel instanceof HTMLElement &&
            window.getComputedStyle(panel).visibility === "visible"
          );
        },
        config.panelId,
        { timeout: 2500 },
      );

    try {
      await waitForPanelOpen();
    } catch {
      await page.waitForTimeout(450);
      await openMenu(button, config.openWith);
      await waitForPanelOpen();
    }

    const item = page.locator(`${config.panelId} a[href^="${config.hrefPrefix}"]`).first();
    await item.waitFor({ state: "visible", timeout: 5000 });
    await page.waitForTimeout(220);

    const ariaExpanded = await button.getAttribute("aria-expanded");
    const itemVisible = await item.isVisible();
    const focusedState = await page.evaluate(() => {
      if (!(document.activeElement instanceof HTMLElement)) return "";
      const activeHref = document.activeElement.getAttribute("href");
      const activeText = document.activeElement.innerText || document.activeElement.textContent || "";
      return `${activeHref || ""} ${activeText}`.trim();
    });
    const focusMoved = focusedState.includes(config.hrefPrefix) || focusedState.includes(config.itemText);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(120);
    const ariaExpandedAfterClose = await button.getAttribute("aria-expanded");

    checks.push({
      menu: config.label,
      openWith: config.openWith,
      itemText: config.itemText,
      ariaExpanded,
      ariaExpandedAfterClose,
      itemVisible,
      focusMoved,
      pass:
        ariaExpanded === "true" &&
        itemVisible &&
        ariaExpandedAfterClose === "false",
    });
  }

  return checks;
}

async function runStockAnalyzerNativeChecks(page) {
  const sortLabel = page.locator('[data-stock-sort-label="true"]');
  await sortLabel.waitFor({ state: "visible", timeout: 10000 });

  const readState = async () => ({
    sortLabel: await sortLabel.textContent(),
    firstSymbol:
      (await page.locator('tbody tr td').first().textContent().catch(() => null)) ||
      (await page.locator('button[key], [data-stock-analyzer-native="true"] button').first().textContent().catch(() => null)),
  });

  const clickTabAndWait = async (buttonName, expectedText) => {
    const button = page.getByRole("button", { name: buttonName });
    await button.scrollIntoViewIfNeeded();
    await button.click({ force: true });
    await page.waitForFunction(
      ({ selector, expected }) => {
        const element = document.querySelector(selector);
        return (
          element instanceof HTMLElement &&
          element.textContent &&
          element.textContent.includes(expected)
        );
      },
      { selector: '[data-stock-sort-label="true"]', expected: expectedText },
      { timeout: 3000 },
    );
  };

  await clickTabAndWait("Growth View", "Growth");
  const growthState = await readState();

  await clickTabAndWait("Ranking View", "Rank");
  const rankingState = await readState();

  await clickTabAndWait("EPS View", "EPS");
  const epsState = await readState();

  return {
    growthState,
    rankingState,
    epsState,
    pass:
      String(growthState.sortLabel || "").includes("Growth") &&
      String(rankingState.sortLabel || "").includes("Rank") &&
      String(epsState.sortLabel || "").includes("EPS"),
  };
}

async function runEtfChecks(page, route) {
  const checks = [];
  const detailTicker =
    route !== "/etfs/new" && route.startsWith("/etfs/")
      ? route.replace(/^\/etfs\//, "").replace(/\/$/, "").split("?")[0]
      : "";

  if (detailTicker) {
    const ticker = detailTicker.toUpperCase();
    const h1 = page.locator("h1").first();
    await h1.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    const h1Text = await h1.textContent().catch(() => null);
    const h1Visible = await h1.isVisible().catch(() => false);
    const metaText = await page.locator(".stock-meta").first().textContent().catch(() => null);
    checks.push({
      check: "etfDetailIdentity",
      pass: h1Visible && String(h1Text || "").trim().toUpperCase() === ticker && !!String(metaText || "").trim(),
      h1: h1Text?.slice(0, 80),
      meta: metaText?.slice(0, 80),
    });

    const shell = page.locator(".stock-shell").first();
    const shellVisible = await shell.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
    checks.push({ check: "etfDetailShell", pass: shellVisible });

    const readySection = page.getByText("가격 히스토리").first();
    const readyVisible = await readySection.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
    const bodyText = await page.locator("body").innerText().catch(() => "");
    checks.push({
      check: "etfDetailLoaded",
      pass: readyVisible && !bodyText.includes("ETF 정보 확인 중"),
      readyVisible,
      stillLoading: bodyText.includes("ETF 정보 확인 중"),
    });
  } else if (route === "/etfs" || route === "/etfs?type=single-stock") {
    const heading = page.locator('h2:has-text("ETF 목록")').first();
    const headingVisible = await heading.isVisible().catch(() => false);
    const rows = await page.locator(".mv-row").count();
    checks.push({
      check: route === "/etfs" ? "etfListContent" : "etfFilteredListContent",
      pass: headingVisible && rows > 0,
      headingVisible,
      rows,
    });
  } else if (route === "/etfs/new") {
    const heading = page.locator('h2:has-text("신규 상장 ETF 탐색")').first();
    const headingVisible = await heading.isVisible().catch(() => false);
    const rows = await page.locator(".mv-row").count();
    checks.push({
      check: "etfNewContent",
      pass: headingVisible && rows > 0,
      headingVisible,
      rows,
    });
  }

  return checks;
}

async function runDataStateSurfaceChecks(page, route) {
  if (!p2DataStateRouteSet.has(route)) return [];
  const stateLocator = page.locator('[data-testid="data-state-notice"], [data-testid="data-state-badge"]');
  await stateLocator.first().waitFor({ state: "attached", timeout: 8000 }).catch(() => {});
  const states = await page
    .locator('[data-testid="data-state-notice"], [data-testid="data-state-badge"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        status: node.getAttribute("data-data-state") || "",
        text: (node.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
      })),
    )
    .catch(() => []);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  return [
    {
      check: "p2DataStateVisible",
      pass: states.length > 0 && !/예상치 못한 오류|일시적인 내부 오류|Cannot read|TypeError/i.test(bodyText),
      stateCount: states.length,
      statuses: Array.from(new Set(states.map((state) => state.status).filter(Boolean))),
      samples: states.slice(0, 3),
    },
  ];
}

(async () => {
  await prewarmRoutes();
  const browser = await chromium.launch({
    headless: true,
    ...(browserChannel ? { channel: browserChannel } : {}),
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
  });
  const results = [];

  for (const vp of viewports) {
    let context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    let page = await context.newPage();

    for (const route of routes) {
      const item = {
        viewport: vp.name,
        route,
        status: null,
        navigationError: null,
        hasNav: null,
        hasFooter: null,
        outerNavCount: null,
        outerFooterCount: null,
        hasIframe: null,
        iframeSrc: null,
        expectedIframeSrcMatched: null,
        iframeOverlapFooter: null,
        innerNavCount: null,
        innerFooterCount: null,
        innerVisibleNavCount: null,
        innerVisibleFooterCount: null,
        innerShellProbeError: null,
        hasHorizontalScroll: null,
        hasMobileMenuButton: null,
        linkedChecks: [],
        errorCount: 0,
        warningCount: 0,
        blockingConsoleErrorCount: 0,
        nonBlockingConsoleErrorCount: 0,
        externalFetchErrorCount: 0,
        sameOriginRequestFailureCount: 0,
        externalRequestFailureCount: 0,
        criticalSameOriginDataFailureCount: 0,
        sameOriginHttpFailureCount: 0,
        externalHttpFailureCount: 0,
        criticalSameOriginHttpFailureCount: 0,
        blockingConsoleErrors: [],
        consoleErrors: [],
        httpFailures: [],
        screenshot: null,
      };

      const consoleErrors = [];
      const consoleWarnings = [];
      const requestFailures = [];
      const httpFailures = [];
      const activeRadarRequests = new Set();
      let radarActivity = 0;

      page.removeAllListeners("console");
      page.removeAllListeners("request");
      page.removeAllListeners("requestfinished");
      page.removeAllListeners("requestfailed");
      page.removeAllListeners("response");

      page.on("console", (msg) => {
        if (msg.type() === "error") consoleErrors.push(msg.text());
        if (msg.type() === "warning") consoleWarnings.push(msg.text());
      });
      page.on("request", (req) => {
        if (route === "/radar" && isRadarActivityUrl(req.url())) {
          activeRadarRequests.add(req);
          radarActivity += 1;
        }
      });
      page.on("requestfinished", (req) => {
        if (activeRadarRequests.delete(req)) radarActivity += 1;
      });
      page.on("requestfailed", (req) => {
        if (activeRadarRequests.delete(req)) radarActivity += 1;
        requestFailures.push({
          url: req.url(),
          errorText: req.failure()?.errorText || "request_failed",
        });
      });
      page.on("response", (response) => {
        if (response.status() < 400) return;
        httpFailures.push({
          url: response.url(),
          status: response.status(),
          resourceType: response.request().resourceType(),
        });
      });

      try {
        if (route.startsWith("/admin")) {
          if (!adminPassword) {
            throw new Error("QA_ADMIN_PASSWORD is required for admin route checks.");
          }
          await page.goto(`${base}/`, {
            waitUntil: "domcontentloaded",
            timeout: isDevServer ? 90000 : 45000,
          }).catch(() => {});
          await page.evaluate(async (password) => {
            await fetch("/api/admin/session", {
              method: "POST",
              cache: "no-store",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ password }),
            });
          }, adminPassword).catch(() => {});
        }
        const response = await page.goto(`${base}${route}`, { waitUntil: "domcontentloaded", timeout: isDevServer ? 90000 : 45000 });
        item.status = response ? response.status() : null;
      } catch (err) {
        item.navigationError = String(err);
        // Dev server: recover from page crash by recreating context
        if (isDevServer && /Page crashed|ERR_CONNECTION_REFUSED/i.test(String(err))) {
          try { await context.close(); } catch { /* ignore */ }
          context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
          page = await context.newPage();
        }
      }

      if (!item.navigationError) {
        try {
          await page.waitForTimeout(700);
          if (route === "/radar") {
            await waitForRadarSettle(page, activeRadarRequests, () => radarActivity);
          }
          if (expectedInnerShellCleanRoutes.has(route)) {
            await page.waitForTimeout(350);
          }
          const snapshot = await page.evaluate(() => {
            const navNodes = document.querySelectorAll("#mainNav");
            const footerNodes = document.querySelectorAll("footer");
            const nav = navNodes[0];
            const footer = footerNodes[0];
            const iframe = document.querySelector("iframe");
            const menuOpen = document.querySelector('button[aria-label="Open menu"]');
            const html = document.documentElement;
            const isScrollable = html.scrollHeight > window.innerHeight + 1;

            let iframeOverlapFooter = null;
            if (iframe && footer) {
              const i = iframe.getBoundingClientRect();
              const f = footer.getBoundingClientRect();
              iframeOverlapFooter = i.bottom > f.top + 1 && !isScrollable;
            }

            return {
              hasNav: navNodes.length > 0,
              hasFooter: footerNodes.length > 0,
              outerNavCount: navNodes.length,
              outerFooterCount: footerNodes.length,
              hasIframe: !!iframe,
              iframeSrc: iframe ? iframe.getAttribute("src") : null,
              iframeOverlapFooter,
              isScrollable,
              hasHorizontalScroll: html.scrollWidth > window.innerWidth + 1,
              hasMobileMenuButton: !!menuOpen,
            };
          });
          Object.assign(item, snapshot);
          item.screenshot = await maybeCaptureScreenshot(page, vp.name, route);
          const expectedIframeSrc = expectedIframeSrcByRoute[route];
          if (expectedIframeSrc) {
            item.expectedIframeSrcMatched = stripEmbedParam(snapshot.iframeSrc) === expectedIframeSrc;
          }

          if (snapshot.hasIframe) {
            try {
              const iframeHandle = await page.$("iframe");
              if (!iframeHandle) {
                item.innerShellProbeError = "iframe_not_found_for_probe";
              } else {
                const frame = await iframeHandle.contentFrame();
                if (!frame) {
                  item.innerShellProbeError = "iframe_content_unavailable";
                } else {
                  await frame.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
                  if (expectedInnerShellCleanRoutes.has(route)) {
                    await frame.waitForTimeout(950);
                  }
                  const innerSnapshot = await frame.evaluate(() => {
                    const dedupe = (nodes) => Array.from(new Set(nodes));
                    const isVisible = (el) => {
                      if (!(el instanceof HTMLElement)) return false;
                      const style = window.getComputedStyle(el);
                      if (style.display === "none" || style.visibility === "hidden") return false;
                      const rect = el.getBoundingClientRect();
                      return rect.width > 0 && rect.height > 0;
                    };

                    const navCandidates = dedupe([
                      ...Array.from(document.querySelectorAll("#mainNav")),
                      ...Array.from(document.querySelectorAll("body > nav")),
                      ...Array.from(document.querySelectorAll("body > header nav")),
                      ...Array.from(document.querySelectorAll(".sticky-header")),
                      ...Array.from(document.querySelectorAll("header.sticky-header")),
                      ...Array.from(document.querySelectorAll(".top-nav")),
                      ...Array.from(document.querySelectorAll(".global-nav")),
                    ]);
                    const footerCandidates = dedupe([
                      ...Array.from(document.querySelectorAll("footer")),
                      ...Array.from(document.querySelectorAll("#mainFooter")),
                      ...Array.from(document.querySelectorAll(".site-footer")),
                      ...Array.from(document.querySelectorAll(".footer")),
                    ]);

                    return {
                      innerNavCount: navCandidates.length,
                      innerFooterCount: footerCandidates.length,
                      innerVisibleNavCount: navCandidates.filter(isVisible).length,
                      innerVisibleFooterCount: footerCandidates.filter(isVisible).length,
                    };
                  });
                  Object.assign(item, innerSnapshot);
                }
              }
            } catch (innerErr) {
              item.innerShellProbeError = String(innerErr);
            }
          }
        } catch (err) {
          item.navigationError = `snapshot_error: ${String(err)}`;
        }

        if (route === "/vr" || route === "/posts") {
          try {
            const hrefs = await page.$$eval("a[href]", (anchors) =>
              anchors
                .map((a) => a.getAttribute("href"))
                .filter((href) => !!href && href.startsWith("/"))
            );
            const unique = [...new Set(hrefs)].filter((href) =>
              route === "/vr"
                ? href.startsWith("/vr/") || href.startsWith("/vr?path=")
                : href.startsWith("/posts/") || href.startsWith("/posts?path=")
            );
            for (const href of unique.slice(0, 5)) {
              const res = await page.request.get(`${base}${href}`);
              item.linkedChecks.push({ href, status: res.status() });
            }
          } catch (err) {
            item.linkedChecks.push({ href: "__link_check_error__", status: 0, error: String(err) });
          }
        }
      }

      const externalFetchErrors = consoleErrors.filter((msg) => isExternalFetchNoise(msg));
      const relevantRequestFailures = requestFailures.filter(
        (req) => !isIgnoredRequestFailure(req),
      );
      const sameOriginRequestFailures = relevantRequestFailures.filter((req) => !isExternalUrl(req.url));
      const externalRequestFailures = relevantRequestFailures.filter((req) => isExternalUrl(req.url));
      const criticalSameOriginDataFailures = relevantRequestFailures.filter((req) =>
        isCriticalSameOriginDataFailure(req),
      );
      const sameOriginHttpFailures = httpFailures.filter((failure) => !isExternalUrl(failure.url));
      const externalHttpFailures = httpFailures.filter((failure) => isExternalUrl(failure.url));
      const criticalSameOriginHttpFailures = sameOriginHttpFailures.filter(
        (failure) =>
          !isExplicitNonBlockingHttpFailure(failure, route) &&
          !isExpectedNegativeRouteResponse(failure, route),
      );
      const blockingConsoleErrors = consoleErrors.filter(
        (msg) =>
          !isExternalFetchNoise(msg) &&
          !isNonBlockingConsoleNoise(msg, route, httpFailures) &&
          !isDevServerNoise(msg),
      );
      const nonBlockingConsoleErrors = consoleErrors.filter((msg) =>
        isNonBlockingConsoleNoise(msg, route, httpFailures),
      );

      item.errorCount = consoleErrors.length;
      item.warningCount = consoleWarnings.length;
      item.blockingConsoleErrorCount = blockingConsoleErrors.length;
      item.nonBlockingConsoleErrorCount = nonBlockingConsoleErrors.length;
      item.externalFetchErrorCount = externalFetchErrors.length;
      item.sameOriginRequestFailureCount = sameOriginRequestFailures.length;
      item.externalRequestFailureCount = externalRequestFailures.length;
      item.criticalSameOriginDataFailureCount = criticalSameOriginDataFailures.length;
      item.sameOriginHttpFailureCount = sameOriginHttpFailures.length;
      item.externalHttpFailureCount = externalHttpFailures.length;
      item.criticalSameOriginHttpFailureCount = criticalSameOriginHttpFailures.length;
      item.blockingConsoleErrors = blockingConsoleErrors.slice(0, 3);
      item.consoleErrors = consoleErrors.slice(0, 3);
      item.httpFailures = httpFailures.slice(0, 8);
      item.criticalSameOriginDataFailures = criticalSameOriginDataFailures.slice(0, 3);
      item.criticalSameOriginHttpFailures = criticalSameOriginHttpFailures.slice(0, 8);

      results.push(item);

      if (route === "/" && !item.navigationError) {
        try {
          const homeChecks = await runHomeShellChecks(page);
          homeChecks.forEach((check) => {
            results.push({ viewport: vp.name, route: "/", ...check });
          });
        } catch (err) {
          results.push({
            viewport: vp.name,
            route: "/",
            check: "homeShellFamily",
            pass: false,
            error: String(err),
          });
        }
      }

      if (route === "/tools/stock-analyzer/native" && !item.navigationError) {
        try {
          const nativeCheck = await runStockAnalyzerNativeChecks(page);
          results.push({
            viewport: vp.name,
            route,
            check: "stockAnalyzerNativeTabs",
            ...nativeCheck,
          });
        } catch (err) {
          results.push({
            viewport: vp.name,
            route,
            check: "stockAnalyzerNativeTabs",
            pass: false,
            error: String(err),
          });
        }
      }

      if (route.startsWith("/etfs") && !item.navigationError) {
        try {
          const etfChecks = await runEtfChecks(page, route);
          etfChecks.forEach((check) => {
            results.push({ viewport: vp.name, route, ...check });
          });
        } catch (err) {
          results.push({
            viewport: vp.name,
            route,
            check: "etfChecks",
            pass: false,
            error: String(err),
          });
        }
      }

      if (p2DataStateRouteSet.has(route) && !item.navigationError) {
        try {
          const dataStateChecks = await runDataStateSurfaceChecks(page, route);
          dataStateChecks.forEach((check) => {
            results.push({ viewport: vp.name, route, ...check });
          });
        } catch (err) {
          results.push({
            viewport: vp.name,
            route,
            check: "p2DataStateVisible",
            pass: false,
            error: String(err),
          });
        }
      }
    }

    await context.close();
  }

  await browser.close();

  const failures = results.filter((r) => {
    if (
      r.check === "homeShellFamily" ||
      r.check === "currentHomeDesktopShell" ||
      r.check === "currentHomeMobileTabs" ||
      r.check === "legacyMobileMenu"
    ) {
      return r.pass === false;
    }
    if (r.check === "desktopDropdown") return r.pass === false;
    if (r.check === "stockAnalyzerNativeTabs") return r.pass === false;
    if (r.check && r.check.startsWith("etf") && r.pass === false) return true;
    if (r.navigationError) return true;
    if (r.status && r.status >= 400 && r.route !== "/this-route-should-not-exist") return true;
    if (r.hasHorizontalScroll) return true;
    if (r.iframeOverlapFooter === true) return true;
    if (expectedIframeRoutes.has(r.route) && !r.hasIframe) return true;
    if (
      expectedInnerShellCleanRoutes.has(r.route) &&
      ((r.innerVisibleNavCount || 0) > 0 || (r.innerVisibleFooterCount || 0) > 0)
    ) {
      return true;
    }
    if (r.route === "/tools/stock-analyzer" && r.expectedIframeSrcMatched === false) return true;
    if (r.check === "p2DataStateVisible") return r.pass === false;
    if (r.linkedChecks && r.linkedChecks.some((c) => c.status >= 400)) return true;
    if ((r.criticalSameOriginDataFailureCount || 0) > 0) return true;
    if ((r.criticalSameOriginHttpFailureCount || 0) > 0) return true;
    // 404 test route: console errors from the 404 page itself are expected
    if (r.blockingConsoleErrorCount > 0 && r.route !== "/this-route-should-not-exist") return true;
    return false;
  });

  const summary = { total: results.length, failures: failures.length, failuresDetail: failures.slice(0, 60), results };
  if (outputJsonPath) {
    fs.writeFileSync(outputJsonPath, JSON.stringify(summary, null, 2));
  }
  console.log(JSON.stringify(summary, null, 2));
  if (strictMode && failures.length > 0) {
    process.exit(1);
  }
})();
