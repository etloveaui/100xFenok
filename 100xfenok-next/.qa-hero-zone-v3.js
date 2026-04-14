/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3000";
const adminPassword = process.env.QA_ADMIN_PASSWORD || "";

const heroRoute = "/";
const smokeRoutes = [
  { route: "/market", admin: false, iframe: true },
  { route: "/admin/macro-monitor", admin: true, iframe: true },
  { route: "/admin/data-lab", admin: true, iframe: true },
];

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 1024, height: 1366 },
  { name: "desktop", width: 1440, height: 900 },
];

const heroKickers = [
  "Market Regime",
  "Quick Indices",
  "Fear & Greed",
  "Breadth",
  "Liquidity",
  "Banking + Stress",
  "Positioning",
];

function isIgnoredConsoleMessage(message) {
  return (
    /Failed to load resource: the server responded with a status of 404/i.test(message) ||
    /Download the React DevTools/i.test(message) ||
    /\[HMR\]/i.test(message) ||
    /turbopack/i.test(message) ||
    /webpack-hmr/i.test(message)
  );
}

function isExpectedScenarioError(message, scenario) {
  if (scenario === "live") return false;
  return /Failed to load resource: the server responded with a status of 503/i.test(message);
}

function createConsoleCollector(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnoredConsoleMessage(text)) return;
    errors.push(text);
  });
  return errors;
}

async function createAdminSession(page) {
  if (!adminPassword) {
    throw new Error("QA_ADMIN_PASSWORD is required for admin route checks.");
  }
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
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
  }, adminPassword);
}

async function configureScenarioRoutes(page, scenario) {
  if (scenario === "live") return;

  await page.route("**/data/benchmarks/summaries.json", async (route) => {
    if (scenario === "partial") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced partial failure" }),
      });
      return;
    }
    await route.continue();
  });

  if (scenario === "offline") {
    await page.route("**/data/**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }),
      });
    });
    await page.route("**/api/ticker/**", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }),
      });
    });
  }
}

async function collectHeroSnapshot(page) {
  return page.evaluate(() => {
    const loadingText = "데이터를 확인하는 중입니다. 기본값은 흐리게 표시됩니다.";
    const partialText = "일부 데이터가 늦거나 미수신 상태입니다. 정상 수신된 타일만 선명하게 표시합니다.";
    const offlineText = "오프라인 기준값입니다. 실제 시장과 다를 수 있습니다.";

    const articles = Array.from(document.querySelectorAll("article"));
    const getOpacity = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      return Number.parseFloat(window.getComputedStyle(node).opacity || "1");
    };

    const tiles = articles.map((node) => {
      const kicker = node.querySelector("p")?.textContent?.trim() || "";
      const title = node.querySelector("h3")?.textContent?.trim() || "";
      const opacity = getOpacity(node);
      return { kicker, title, opacity };
    });

    const findTileByKicker = (kicker) => {
      return articles.find((node) => node.querySelector("p")?.textContent?.trim() === kicker) || null;
    };

    const quickTile = findTileByKicker("Quick Indices");
    const heroTile = findTileByKicker("Market Regime");
    const breadthTile = findTileByKicker("Breadth");

    const extractQuickCard = (label) => {
      if (!(quickTile instanceof HTMLElement)) return null;
      const paragraphs = Array.from(quickTile.querySelectorAll("p"));
      const labelNode = paragraphs.find((node) => node.textContent?.trim() === label);
      if (!(labelNode instanceof HTMLElement)) return null;
      const card = labelNode.closest("div.rounded-2xl") || labelNode.parentElement;
      if (!(card instanceof HTMLElement)) return null;
      const texts = Array.from(card.querySelectorAll("p"))
        .map((node) => node.textContent?.trim() || "")
        .filter(Boolean);
      return {
        label,
        texts,
        hasMarketStateBadge: !!card.querySelector(".market-state-badge"),
      };
    };

    const quickCards = ["SPY", "QQQ", "10Y", "HY"]
      .map(extractQuickCard)
      .filter(Boolean);

    let bannerType = "none";
    if (document.body?.innerText?.includes(loadingText)) bannerType = "loading";
    if (document.body?.innerText?.includes(partialText)) bannerType = "partial";
    if (document.body?.innerText?.includes(offlineText)) bannerType = "offline";

    const mutedKickers = tiles
      .filter((tile) => typeof tile.opacity === "number" && tile.opacity < 0.9)
      .map((tile) => tile.kicker)
      .filter(Boolean);

    return {
      bannerType,
      tiles,
      presentKickers: tiles.map((tile) => tile.kicker).filter(Boolean),
      presentTitles: tiles.map((tile) => tile.title).filter(Boolean),
      heroExists: !!heroTile,
      heroMuted: mutedKickers.includes("Market Regime"),
      quickMuted: mutedKickers.includes("Quick Indices"),
      breadthMuted: mutedKickers.includes("Breadth"),
      mutedKickers,
      quickCards,
      quickLivePriceCount: quickCards.filter((item) => item.texts.some((text) => text.startsWith("$"))).length,
      quickMarketStateBadgeCount: quickCards.filter((item) => item.hasMarketStateBadge).length,
      hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

function isHeroScenarioPass(snapshot, scenario) {
  const hasCoreTiles = heroKickers.every((kicker) => snapshot.presentKickers.includes(kicker));

  if (scenario === "live") {
    return (
      snapshot.bannerType === "none" &&
      snapshot.heroExists === true &&
      hasCoreTiles &&
      snapshot.quickLivePriceCount >= 2 &&
      snapshot.quickMarketStateBadgeCount >= 2 &&
      snapshot.hasHorizontalScroll === false
    );
  }

  if (scenario === "partial") {
    return (
      snapshot.bannerType === "partial" &&
      snapshot.heroExists === true &&
      hasCoreTiles &&
      snapshot.heroMuted === true &&
      snapshot.breadthMuted === true &&
      snapshot.quickMuted === false &&
      snapshot.quickLivePriceCount >= 2 &&
      snapshot.hasHorizontalScroll === false
    );
  }

  return (
    snapshot.bannerType === "offline" &&
    snapshot.heroExists === true &&
    hasCoreTiles &&
    snapshot.quickLivePriceCount === 0 &&
    snapshot.mutedKickers.length >= 7 &&
    snapshot.hasHorizontalScroll === false
  );
}

async function waitForHeroScenario(page, scenario) {
  const timeoutMs = scenario === "live" ? 20000 : 12000;
  const startedAt = Date.now();
  let snapshot = await collectHeroSnapshot(page);

  while (Date.now() - startedAt < timeoutMs) {
    if (isHeroScenarioPass(snapshot, scenario)) {
      return snapshot;
    }
    await page.waitForTimeout(1000);
    snapshot = await collectHeroSnapshot(page);
  }

  return snapshot;
}

async function runHeroScenario(browser, viewport, scenario) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const consoleErrors = createConsoleCollector(page);

  const record = {
    viewport: viewport.name,
    scenario,
    route: heroRoute,
    pass: false,
    consoleErrors: [],
    snapshot: null,
    error: null,
  };

  try {
    await configureScenarioRoutes(page, scenario);
    await page.goto(`${baseUrl}${heroRoute}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const snapshot = await waitForHeroScenario(page, scenario);
    record.snapshot = snapshot;
    record.consoleErrors = consoleErrors
      .filter((message) => !isExpectedScenarioError(message, scenario))
      .slice(0, 5);
    record.pass = isHeroScenarioPass(snapshot, scenario) && record.consoleErrors.length === 0;
  } catch (error) {
    record.error = String(error);
    record.consoleErrors = consoleErrors
      .filter((message) => !isExpectedScenarioError(message, scenario))
      .slice(0, 5);
  } finally {
    await context.close();
  }

  return record;
}

async function runA11yCheck(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const record = {
    viewport: viewport.name,
    route: heroRoute,
    pass: false,
    seriousOrCriticalCount: 0,
    violations: [],
    error: null,
  };

  try {
    await page.goto(`${baseUrl}${heroRoute}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForHeroScenario(page, "live");
    const analysis = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const violations = (analysis.violations || []).map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodeCount: violation.nodes?.length ?? 0,
    }));
    const seriousOrCriticalCount = violations.filter((item) => item.impact === "serious" || item.impact === "critical").length;
    record.seriousOrCriticalCount = seriousOrCriticalCount;
    record.violations = violations;
    record.pass = seriousOrCriticalCount === 0;
  } catch (error) {
    record.error = String(error);
  } finally {
    await context.close();
  }

  return record;
}

async function runSmokeRoute(browser, routeConfig) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors = createConsoleCollector(page);
  const record = {
    route: routeConfig.route,
    pass: false,
    status: null,
    consoleErrors: [],
    outerNavCount: null,
    outerFooterCount: null,
    hasIframe: null,
    innerVisibleNavCount: null,
    innerVisibleFooterCount: null,
    error: null,
  };

  try {
    if (routeConfig.admin) {
      await createAdminSession(page);
    }
    const response = await page.goto(`${baseUrl}${routeConfig.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    record.status = response ? response.status() : null;
    await page.waitForTimeout(1800);

    const outer = await page.evaluate(() => ({
      outerNavCount: document.querySelectorAll("#mainNav").length,
      outerFooterCount: document.querySelectorAll("footer").length,
      hasIframe: !!document.querySelector("iframe"),
      hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    }));
    Object.assign(record, outer);

    if (routeConfig.iframe) {
      const iframeHandle = await page.locator("iframe").first().elementHandle();
      if (!iframeHandle) {
        throw new Error("iframe_not_found");
      }
      const frame = await iframeHandle.contentFrame();
      if (!frame) {
        throw new Error("iframe_unavailable");
      }
      await frame.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await frame.waitForTimeout(900);
      const inner = await frame.evaluate(() => {
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
          ...Array.from(document.querySelectorAll(".nav-bar")),
        ]);
        const footerCandidates = dedupe([
          ...Array.from(document.querySelectorAll("footer")),
          ...Array.from(document.querySelectorAll("#mainFooter")),
          ...Array.from(document.querySelectorAll(".site-footer")),
          ...Array.from(document.querySelectorAll(".footer")),
        ]);
        return {
          innerVisibleNavCount: navCandidates.filter(isVisible).length,
          innerVisibleFooterCount: footerCandidates.filter(isVisible).length,
        };
      });
      Object.assign(record, inner);
    }

    record.consoleErrors = consoleErrors.slice(0, 5);
    record.pass =
      record.status === 200 &&
      record.outerNavCount === 1 &&
      record.outerFooterCount === 1 &&
      record.hasHorizontalScroll === false &&
      (!routeConfig.iframe || (record.innerVisibleNavCount === 0 && record.innerVisibleFooterCount === 0)) &&
      record.consoleErrors.length === 0;
  } catch (error) {
    record.error = String(error);
    record.consoleErrors = consoleErrors.slice(0, 5);
  } finally {
    await context.close();
  }

  return record;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const heroResults = [];
  const a11yResults = [];
  const smokeResults = [];

  for (const viewport of viewports) {
    heroResults.push(await runHeroScenario(browser, viewport, "live"));
    heroResults.push(await runHeroScenario(browser, viewport, "partial"));
    heroResults.push(await runHeroScenario(browser, viewport, "offline"));
    a11yResults.push(await runA11yCheck(browser, viewport));
  }

  for (const routeConfig of smokeRoutes) {
    smokeResults.push(await runSmokeRoute(browser, routeConfig));
  }

  await browser.close();

  const failures = [
    ...heroResults.filter((item) => !item.pass),
    ...a11yResults.filter((item) => !item.pass),
    ...smokeResults.filter((item) => !item.pass),
  ];

  const summary = {
    baseUrl,
    heroResults,
    a11yResults,
    smokeResults,
    failures,
    failureCount: failures.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    process.exit(1);
  }
})();
