import { chromium } from "playwright";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const strictMode = process.env.QA_MACRO_CHART_STRICT !== "0";
const sharedRoute =
  process.env.QA_MACRO_CHART_ROUTE ||
  "/macro-chart?series=sp500,vix,tga,DGS10,M2SL,WALCL,WRESBAL,HY_spread&transform=rebase100,raw,rebase100,raw,yoy,rebase100,rebase100,raw&range=10Y&hidden=vix";

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

function addFailure(failures, check, detail) {
  failures.push({ check, detail });
}

async function waitForMacroChart(page) {
  await page.waitForSelector('[role="group"][aria-label*="매크로 시계열 비교 차트"] canvas', {
    timeout: 45_000,
  });
  await page.waitForTimeout(350);
}

async function collectLayout(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const chartGroup = document.querySelector('[role="group"][aria-label*="매크로 시계열 비교 차트"]');
    const canvas = chartGroup?.querySelector("canvas") ?? null;
    const canvasRect = canvas?.getBoundingClientRect();
    return {
      viewportWidth,
      scrollWidth,
      chartGroups: chartGroup ? 1 : 0,
      canvasWidth: canvasRect?.width ?? 0,
      canvasHeight: canvasRect?.height ?? 0,
    };
  });
}

async function inspectSharedDesktop(page) {
  const failures = [];
  const response = await page.goto(routeUrl(sharedRoute), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);

  if (response?.status() !== 200) {
    addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
  }

  const layout = await collectLayout(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "desktop-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }
  if (layout.chartGroups === 0 || layout.canvasWidth < 240 || layout.canvasHeight < 180) {
    addFailure(failures, "desktop-chart-visible", `canvas=${Math.round(layout.canvasWidth)}x${Math.round(layout.canvasHeight)}`);
  }

  const params = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  if (params.range !== "10Y") addFailure(failures, "share-range-roundtrip", `range=${params.range ?? "missing"}`);
  if (params.hidden !== "vix") addFailure(failures, "share-hidden-roundtrip", `hidden=${params.hidden ?? "missing"}`);

  const range10y = page.getByRole("group", { name: "기간 선택" }).getByRole("button", { name: "10Y" });
  const rangePressed = await range10y.getAttribute("aria-pressed");
  if (rangePressed !== "true") addFailure(failures, "range-button-state", `10Y aria-pressed=${rangePressed}`);

  const vixToggle = page.getByRole("group", { name: "시리즈 토글" }).getByRole("button", { name: /VIX/ }).first();
  const vixPressed = await vixToggle.getAttribute("aria-pressed");
  if (vixPressed !== "false") addFailure(failures, "hidden-toggle-state", `VIX aria-pressed=${vixPressed}`);
  await vixToggle.click();
  await page.waitForTimeout(250);
  const hiddenAfterToggle = await page.evaluate(() => new URL(window.location.href).searchParams.get("hidden"));
  if (hiddenAfterToggle?.includes("vix")) {
    addFailure(failures, "hidden-url-update", `hidden=${hiddenAfterToggle}`);
  }

  await page.getByRole("button", { name: "1Y", exact: true }).click();
  await page.waitForTimeout(200);
  const rangeAfterClick = await page.evaluate(() => new URL(window.location.href).searchParams.get("range"));
  if (rangeAfterClick !== "1Y") addFailure(failures, "range-url-update", `range=${rangeAfterClick}`);

  await page.locator("#macro-series-search").fill("MOVE");
  await page.waitForTimeout(350);
  const moveCandidate = page.locator('button[aria-pressed="false"]').filter({ hasText: "MOVE" }).first();
  await moveCandidate.click();
  const limitVisible = await page.getByText("비교 시리즈는 최대 8개까지 선택할 수 있습니다.").isVisible();
  if (!limitVisible) addFailure(failures, "series-limit-copy", "limit notice was not visible after ninth selection");

  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "CSV 저장" }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().startsWith("100xfenok-macro-chart-")) {
    addFailure(failures, "csv-download-name", download.suggestedFilename());
  }

  return { route: sharedRoute, viewport: "desktop", status: response?.status() ?? null, layout, failures };
}

async function inspectMobile(page) {
  const failures = [];
  const response = await page.goto(routeUrl(sharedRoute), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);

  if (response?.status() !== 200) {
    addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
  }

  const layout = await collectLayout(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "mobile-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }
  if (layout.canvasWidth < 260 || layout.canvasHeight < 240) {
    addFailure(failures, "mobile-chart-visible", `canvas=${Math.round(layout.canvasWidth)}x${Math.round(layout.canvasHeight)}`);
  }

  const search = page.locator("#macro-series-search");
  if (await search.isVisible()) {
    addFailure(failures, "mobile-picker-initially-collapsed", "search input visible before opening picker");
  }
  await page.getByRole("button", { name: "열기" }).first().click();
  await page.waitForTimeout(200);
  if (!(await search.isVisible())) {
    addFailure(failures, "mobile-picker-opens", "search input hidden after opening picker");
  }
  if (!(await page.getByText("8/8 선택").isVisible())) {
    addFailure(failures, "mobile-selection-count", "8/8 count not visible");
  }

  return { route: sharedRoute, viewport: "mobile", status: response?.status() ?? null, layout, failures };
}

async function inspectRedirect(page) {
  const failures = [];
  const response = await page.goto(routeUrl("/multichart"), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);
  const pathname = await page.evaluate(() => window.location.pathname);
  if (pathname.replace(/\/$/, "") !== "/macro-chart") {
    addFailure(failures, "multichart-redirect", `pathname=${pathname}`);
  }
  return { route: "/multichart", viewport: "desktop", status: response?.status() ?? null, failures };
}

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const desktopPage = await desktopContext.newPage();
  results.push(await inspectSharedDesktop(desktopPage));
  results.push(await inspectRedirect(desktopPage));
  await desktopContext.close();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
  });
  const mobilePage = await mobileContext.newPage();
  results.push(await inspectMobile(mobilePage));
  await mobileContext.close();
} finally {
  await browser.close();
}

const failures = results.flatMap((result) =>
  result.failures.map((failure) => `${result.viewport} ${result.route}: ${failure.check} (${failure.detail})`),
);
const summary = {
  total: results.length,
  failing: failures.length,
  strictMode,
  failures,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (strictMode && failures.length > 0) {
  process.exit(1);
}
