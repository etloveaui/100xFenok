/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Phase 2 QA Script — v17.8-responsive.html bento widget migration
 *
 * Adapted 1:1 from source/100xFenok/100xfenok-next/.qa-hero-zone-v3.js (Phase 1 pattern).
 * Pass bar: 45/45 (36 bento-card + 3 a11y + 6 smoke).
 *
 * Spec reference: docs/planning/254-phase2-widget-migration-spec.md §5
 *
 * Usage:
 *   # Serve source/100xFenok/ from the repo root:
 *   #   cd source/100xFenok && python -m http.server 8000
 *   # Then:
 *   node --check .qa-main-v17.8-phase2.js          # syntax validate only
 *   npx playwright test .qa-main-v17.8-phase2.js   # full run (impl must be ready)
 *
 * STATUS: READY TO RUN once Phase 2 implementation lands in v17.8-responsive.html.
 */

const { chromium } = require("playwright");
const AxeBuilder = require("@axe-core/playwright").default;

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:8000";

const phase2Route = "/admin/design-lab/main/v17.8-responsive.html";

// Spec §5.4 + Phase 2 page itself (6 adjacent-page regression smoke checks).
const smokeRoutes = [
  { route: "/main.html", label: "legacy main (production baseline)" },
  { route: phase2Route, label: "Phase 2 design-lab prototype" },
  { route: "/index.html?path=tools/asset/multichart.html", label: "Multichart SPA" },
  { route: "/index.html?path=ib/ib-total-guide-calculator.html", label: "IB Helper SPA" },
  { route: "/notification-control-panel-web.html", label: "admin notification-control" },
  { route: "/admin/design-lab/index.html", label: "design-lab index" },
];

const viewports = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

// Phase 2 bento kickers present in v17.8-responsive.html (5 cards).
// FEAR & GREED, MARKET REGIME, QUICK INDICES are Hero Zone elements (Phase 1 only) — removed.
// SECTOR SNAPSHOT is the meta-summary card (mock, spec §2.2); not in connectedKickers but asserted here.
const bentoKickers = [
  "SECTOR SNAPSHOT",
  "LIQUIDITY FLOW",
  "SENTIMENT",
  "BANKING HEALTH",
  "STRESS INDEX",
];

// The 4 kickers wired to real data in Phase 2 (Sector Snapshot remains mock per spec §2.2).
const connectedKickers = ["LIQUIDITY FLOW", "SENTIMENT", "BANKING HEALTH", "STRESS INDEX"];

// Partial failure target (spec §5.2): fdic-tier1.json → 503.
// Blocks only the banking-health card's primary data source (one of the 4 Phase 2 widgets).
// Expected: BANKING HEALTH muted, other 3 connected cards stay live, partial banner fires.
// (summaries.json was the original target but is not consumed by v17.8-responsive.html.)
const PARTIAL_FAILURE_PATTERN = "**/data/macro/fdic-tier1.json";
// Kicker that should be muted in partial scenario (matches the blocked data source above).
const PARTIAL_MUTED_KICKER = "BANKING HEALTH";

const BANNER_TEXTS = {
  loading: "데이터를 확인하는 중입니다. 기본값은 흐리게 표시됩니다.",
  partial: "일부 데이터가 늦거나 미수신 상태입니다. 정상 수신된 타일만 선명하게 표시합니다.",
  offline: "오프라인 기준값입니다. 실제 시장과 다를 수 있습니다.",
};

// ─── Shared helpers ───────────────────────────────────────────────────────────

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

// ─── Route interception (spec §5.1) ──────────────────────────────────────────

async function configureScenarioRoutes(page, scenario) {
  if (scenario === "live") return;

  if (scenario === "offline") {
    // All same-origin JSON
    await page.route("**/data/**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }) });
    });
    // First-party ticker endpoint
    await page.route("**/api/ticker/**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }) });
    });
    // FRED proxy via Cloudflare Worker (spec §5.1: `**/*fred*`)
    await page.route("**/*fred*", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }) });
    });
    // Catch-all for other Cloudflare Worker proxy calls
    await page.route("**/*.workers.dev/**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }) });
    });
    // FDIC API fallback — fetchFDICTier1() falls through to api.fdic.gov when local JSON fails.
    // Must be blocked here or banking-health will still return data in offline scenario.
    await page.route("**/api.fdic.gov/**", async (route) => {
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "forced offline failure" }) });
    });
    return;
  }

  // partial: block fdic-tier1.json AND the api.fdic.gov fallback to force banking-health to fail.
  // fetchFDICTier1() silently falls through to api.fdic.gov when the local JSON returns 503;
  // both routes must be blocked for BANKING HEALTH to register as failed.
  await page.route(PARTIAL_FAILURE_PATTERN, async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "forced partial failure" }) });
  });
  await page.route("**/api.fdic.gov/**", async (route) => {
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "forced partial failure" }) });
  });
}

// ─── Snapshot collection ─────────────────────────────────────────────────────

async function collectBentoSnapshot(page) {
  return page.evaluate((args) => {
    const { connectedKickers, BANNER_TEXTS } = args;

    const articles = Array.from(document.querySelectorAll("article"));
    const getOpacity = (node) => {
      if (!(node instanceof HTMLElement)) return null;
      return Number.parseFloat(window.getComputedStyle(node).opacity || "1");
    };

    const tiles = articles.map((node) => {
      const kicker = node.querySelector("h3")?.textContent?.trim() || "";
      const opacity = getOpacity(node);
      return { kicker, opacity };
    });

    const findByKicker = (kicker) =>
      articles.find((node) => node.querySelector("h3")?.textContent?.trim() === kicker) || null;

    const mutedKickers = tiles
      .filter((t) => typeof t.opacity === "number" && t.opacity < 0.9)
      .map((t) => t.kicker)
      .filter(Boolean);

    let bannerType = "none";
    const bodyText = document.body?.innerText || "";
    if (bodyText.includes(BANNER_TEXTS.loading)) bannerType = "loading";
    if (bodyText.includes(BANNER_TEXTS.partial)) bannerType = "partial";
    if (bodyText.includes(BANNER_TEXTS.offline)) bannerType = "offline";

    // Market-state badge count — Phase 1 quickMarketStateBadgeCount equivalent (spec §5 required check).
    const bentoStateIndicatorCount = articles.filter((node) =>
      node.querySelector(".market-state-badge, [class*='state-']")
    ).length;

    const connectedCardStates = connectedKickers.map((kicker) => {
      const el = findByKicker(kicker);
      const opacity = el ? getOpacity(el) : null;
      return {
        kicker,
        exists: !!el,
        muted: typeof opacity === "number" && opacity < 0.9,
        opacity,
      };
    });

    return {
      bannerType,
      presentKickers: tiles.map((t) => t.kicker).filter(Boolean),
      mutedKickers,
      bentoStateIndicatorCount,
      connectedCardStates,
      connectedMutedCount: connectedCardStates.filter((c) => c.muted).length,
      hasHorizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  }, { connectedKickers, BANNER_TEXTS });
}

// ─── Pass conditions ──────────────────────────────────────────────────────────

function isBentoScenarioPass(snapshot, scenario) {
  const hasAllKickers = bentoKickers.every((k) => snapshot.presentKickers.includes(k));

  if (scenario === "live") {
    // bentoStateIndicatorCount removed — .market-state-badge is a Hero Zone element, not bento (Phase 1 carry-over).
    // connectedMutedCount === 0 required: prevents false-pass during CSS opacity 0.3s transition after unmuting.
    return (
      snapshot.bannerType === "none" &&
      hasAllKickers &&
      snapshot.connectedMutedCount === 0 &&
      snapshot.hasHorizontalScroll === false
    );
  }

  if (scenario === "partial") {
    // fdic-tier1.json fails → BANKING HEALTH muted; other 3 connected cards stay live.
    const bankingMuted = snapshot.connectedCardStates.find((c) => c.kicker === PARTIAL_MUTED_KICKER)?.muted === true;
    return (
      snapshot.bannerType === "partial" &&
      hasAllKickers &&
      bankingMuted &&
      snapshot.connectedMutedCount === 1 &&
      snapshot.hasHorizontalScroll === false
    );
  }

  // offline: all connected cards muted.
  return (
    snapshot.bannerType === "offline" &&
    hasAllKickers &&
    snapshot.connectedMutedCount === connectedKickers.length &&
    snapshot.hasHorizontalScroll === false
  );
}

// Per-card pass — emits 4 individual assertions per page load (36 bento-card total).
function isBentoCardPass(cardState, scenario) {
  if (!cardState.exists) return false;
  if (scenario === "live") return !cardState.muted;
  if (scenario === "partial") {
    // BANKING HEALTH must be muted (its data source is blocked); others must stay live.
    return cardState.kicker === PARTIAL_MUTED_KICKER ? cardState.muted : !cardState.muted;
  }
  return cardState.muted; // offline → each connected card must be muted
}

// ─── Polling wait ─────────────────────────────────────────────────────────────

async function waitForBentoScenario(page, scenario) {
  const timeoutMs = scenario === "live" ? 20000 : 12000;
  const startedAt = Date.now();
  let snapshot = await collectBentoSnapshot(page);

  while (Date.now() - startedAt < timeoutMs) {
    if (isBentoScenarioPass(snapshot, scenario)) return snapshot;
    await page.waitForTimeout(1000);
    snapshot = await collectBentoSnapshot(page);
  }

  return snapshot;
}

// ─── Test runners ─────────────────────────────────────────────────────────────

// 1 page load → 4 card results.  9 calls × 4 = 36 bento-card assertions.
async function runBentoScenario(browser, viewport, scenario) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const consoleErrors = createConsoleCollector(page);

  const pageRecord = {
    type: "bento-page",
    viewport: viewport.name,
    scenario,
    pass: false,
    consoleErrors: [],
    snapshot: null,
    error: null,
  };

  const cardRecords = connectedKickers.map((kicker) => ({
    type: "bento-card",
    viewport: viewport.name,
    scenario,
    kicker,
    pass: false,
    error: null,
  }));

  try {
    await configureScenarioRoutes(page, scenario);
    await page.goto(`${baseUrl}${phase2Route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const snapshot = await waitForBentoScenario(page, scenario);
    pageRecord.snapshot = snapshot;
    pageRecord.consoleErrors = consoleErrors
      .filter((m) => !isExpectedScenarioError(m, scenario))
      .slice(0, 5);
    pageRecord.pass = isBentoScenarioPass(snapshot, scenario) && pageRecord.consoleErrors.length === 0;
    for (const cardRecord of cardRecords) {
      const cardState = snapshot.connectedCardStates.find((c) => c.kicker === cardRecord.kicker);
      cardRecord.pass = !!cardState && isBentoCardPass(cardState, scenario);
    }
  } catch (error) {
    const msg = String(error);
    pageRecord.error = msg;
    pageRecord.consoleErrors = consoleErrors.filter((m) => !isExpectedScenarioError(m, scenario)).slice(0, 5);
    for (const cardRecord of cardRecords) {
      cardRecord.error = msg;
    }
  } finally {
    await context.close();
  }

  return { pageRecord, cardRecords };
}

// 3 a11y checks (1 per viewport, live scenario).  Zero serious/critical violations + .state-closed logged.
async function runA11yCheck(browser, viewport) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  const page = await context.newPage();
  const record = {
    type: "a11y",
    viewport: viewport.name,
    route: phase2Route,
    pass: false,
    seriousOrCriticalCount: 0,
    violations: [],
    stateClosedContrast: null,
    error: null,
  };

  try {
    await page.goto(`${baseUrl}${phase2Route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForBentoScenario(page, "live");

    const analysis = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const violations = (analysis.violations || []).map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodeCount: v.nodes?.length ?? 0,
    }));
    record.seriousOrCriticalCount = violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical"
    ).length;
    record.violations = violations;

    // .state-closed contrast probe — Phase 1 Hero Zone only; Phase 2 has no .state-closed element.
    // Probe retained for future use but result will always be null in Phase 2 context.
    record.stateClosedContrast = null; // Phase 2: element not present, skip evaluate.

    record.pass = record.seriousOrCriticalCount === 0;
  } catch (error) {
    record.error = String(error);
  } finally {
    await context.close();
  }

  return record;
}

// 6 smoke checks — adjacent-page regression, mobile viewport, console-error gate.
async function runSmokeRoute(browser, routeConfig) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const consoleErrors = createConsoleCollector(page);
  const record = {
    type: "smoke",
    route: routeConfig.route,
    label: routeConfig.label,
    pass: false,
    status: null,
    consoleErrors: [],
    error: null,
  };

  try {
    const response = await page.goto(`${baseUrl}${routeConfig.route}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    record.status = response ? response.status() : null;
    await page.waitForTimeout(1500);
    record.consoleErrors = consoleErrors.slice(0, 5);
    record.pass = record.status === 200 && record.consoleErrors.length === 0;
  } catch (error) {
    record.error = String(error);
    record.consoleErrors = consoleErrors.slice(0, 5);
  } finally {
    await context.close();
  }

  return record;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({ headless: true });
  const bentoPageResults = [];
  const bentoCardResults = [];
  const a11yResults = [];
  const smokeResults = [];

  // 36 bento-card assertions: 3 viewports × 3 scenarios × 4 cards
  for (const viewport of viewports) {
    for (const scenario of ["live", "partial", "offline"]) {
      const { pageRecord, cardRecords } = await runBentoScenario(browser, viewport, scenario);
      bentoPageResults.push(pageRecord);
      bentoCardResults.push(...cardRecords);
    }
  }

  // 3 a11y checks
  for (const viewport of viewports) {
    a11yResults.push(await runA11yCheck(browser, viewport));
  }

  // 6 smoke checks
  for (const routeConfig of smokeRoutes) {
    smokeResults.push(await runSmokeRoute(browser, routeConfig));
  }

  await browser.close();

  const failures = [
    ...bentoCardResults.filter((r) => !r.pass),
    ...a11yResults.filter((r) => !r.pass),
    ...smokeResults.filter((r) => !r.pass),
  ];

  const summary = {
    baseUrl,
    phase2Route,
    counts: {
      bentoCardAssertions: bentoCardResults.length,    // 36
      a11yChecks: a11yResults.length,                   // 3
      smokeChecks: smokeResults.length,                 // 6
      total: bentoCardResults.length + a11yResults.length + smokeResults.length, // 45
    },
    bentoPageResults,
    bentoCardResults,
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
