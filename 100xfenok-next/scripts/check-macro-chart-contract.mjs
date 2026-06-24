import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const strictMode = process.env.QA_MACRO_CHART_STRICT !== "0";
const expectedMaxSeries = 8;
const sharedRoute =
  process.env.QA_MACRO_CHART_ROUTE ||
  "/macro-chart?series=sp500,vix,tga,DGS10,M2SL,WALCL,WRESBAL,HY_spread&transform=rebase100,raw,rebase100,raw,yoy,rebase100,rebase100,raw&range=10Y&hidden=vix";
const expectedSharedParams = new URL(sharedRoute, "https://qa.local").searchParams;
const expectedSharedSeries = expectedSharedParams.get("series")?.split(",").filter(Boolean) ?? [];
const expectedSharedTransforms = expectedSharedParams.get("transform")?.split(",").filter(Boolean) ?? [];
const presetRoute = "/macro-chart?preset=activity&range=MAX&hidden=ism_mfg_headline";
const expectedPresetSeries = ["oecd_cli_us", "pmi_mfg_us_sp", "ism_mfg_headline", "ism_services_headline"];

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

function addFailure(failures, check, detail) {
  failures.push({ check, detail });
}

function splitParam(value) {
  return value?.split(",").filter(Boolean) ?? [];
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

async function collectPageOverflow(page) {
  return page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    return { viewportWidth, scrollWidth };
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
  if (params.series !== expectedSharedSeries.join(",")) {
    addFailure(failures, "share-series-roundtrip", `series=${params.series ?? "missing"}`);
  }
  if (params.transform !== expectedSharedTransforms.join(",")) {
    addFailure(failures, "share-transform-roundtrip", `transform=${params.transform ?? "missing"}`);
  }
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

  await page.getByLabel("TGA 축").selectOption("right");
  await page.waitForTimeout(200);
  const axisAfterSelect = splitParam(await page.evaluate(() => new URL(window.location.href).searchParams.get("axis")));
  if (!axisAfterSelect.includes("tga:right")) {
    addFailure(failures, "axis-url-update", `axis=${axisAfterSelect.join(",") || "missing"}`);
  }

  await page.getByLabel("프리셋 이름").fill("QA 저장 프리셋");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.waitForTimeout(200);
  const storedPreset = await page.evaluate(() => {
    const presets = JSON.parse(window.localStorage.getItem("100xfenok.macroChart.userPresets.v1") || "[]");
    return presets.find((preset) => preset.name === "QA 저장 프리셋") ?? null;
  });
  if (!storedPreset) {
    addFailure(failures, "user-preset-storage", "saved preset missing from localStorage");
  } else {
    if (storedPreset.rangeId !== "1Y") addFailure(failures, "user-preset-range", `range=${storedPreset.rangeId}`);
    if (storedPreset.axisById?.tga !== "right") {
      addFailure(failures, "user-preset-axis", `axis=${JSON.stringify(storedPreset.axisById ?? {})}`);
    }
    if ((storedPreset.selected ?? []).length !== expectedMaxSeries) {
      addFailure(failures, "user-preset-series", `selected=${(storedPreset.selected ?? []).length}`);
    }
  }

  await page.goto(routeUrl("/macro-chart"), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);
  await page.locator("button", { hasText: "QA 저장 프리셋" }).first().click();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("range") === "1Y", null, { timeout: 10_000 });
  const paramsAfterUserPreset = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  const userPresetAxis = splitParam(paramsAfterUserPreset.axis);
  if (splitParam(paramsAfterUserPreset.series).length !== expectedMaxSeries) {
    addFailure(failures, "user-preset-apply-series", `series=${paramsAfterUserPreset.series ?? "missing"}`);
  }
  if (!userPresetAxis.includes("tga:right")) {
    addFailure(failures, "user-preset-apply-axis", `axis=${paramsAfterUserPreset.axis ?? "missing"}`);
  }

  await page.getByLabel("TGA 축").selectOption("auto");
  await page.waitForTimeout(200);
  const axisAfterAuto = await page.evaluate(() => new URL(window.location.href).searchParams.get("axis"));
  if (axisAfterAuto?.includes("tga:right")) {
    addFailure(failures, "axis-auto-url-update", `axis=${axisAfterAuto}`);
  }

  await page.evaluate(() => {
    window.localStorage.setItem("100xfenok.macroChart.userPresets.v1", JSON.stringify([
      {
        id: "qa-corrupt",
        name: "QA 손상 프리셋",
        selected: [{ id: "sp500", transform: "rebase100" }],
        rangeId: "5Y",
        hiddenIds: [null, "sp500", 7],
        axisById: { sp500: "right" },
        updatedAt: new Date().toISOString(),
      },
    ]));
  });
  await page.goto(routeUrl("/macro-chart"), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);
  await page.locator("button", { hasText: "QA 손상 프리셋" }).first().click();
  await page.waitForTimeout(250);
  const paramsAfterCorruptPreset = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  if (paramsAfterCorruptPreset.hidden !== "sp500") {
    addFailure(failures, "user-preset-corrupt-hidden", `hidden=${paramsAfterCorruptPreset.hidden ?? "missing"}`);
  }
  if (!splitParam(paramsAfterCorruptPreset.axis).includes("sp500:right")) {
    addFailure(failures, "user-preset-keyed-axis", `axis=${paramsAfterCorruptPreset.axis ?? "missing"}`);
  }

  await page.goto(routeUrl(sharedRoute), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);
  await page.locator("#macro-series-search").fill("MOVE");
  await page.waitForTimeout(350);
  const moveCandidate = page.locator('button[aria-pressed="false"]').filter({ hasText: "MOVE" }).first();
  await moveCandidate.click();
  const limitVisible = await page.getByText("비교 시리즈는 최대 8개까지 선택할 수 있습니다.").isVisible();
  if (!limitVisible) addFailure(failures, "series-limit-copy", "limit notice was not visible after ninth selection");
  const seriesAfterLimit = await page.evaluate(() => new URL(window.location.href).searchParams.get("series"));
  const parsedSeriesAfterLimit = splitParam(seriesAfterLimit);
  if (parsedSeriesAfterLimit.length !== expectedMaxSeries || parsedSeriesAfterLimit.includes("move")) {
    addFailure(failures, "series-limit-enforced", `series=${seriesAfterLimit ?? "missing"}`);
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "CSV 저장" }).click();
  const download = await downloadPromise;
  if (!download.suggestedFilename().startsWith("100xfenok-macro-chart-")) {
    addFailure(failures, "csv-download-name", download.suggestedFilename());
  }
  const downloadPath = await download.path();
  if (!downloadPath) {
    addFailure(failures, "csv-download-path", "download path unavailable");
  } else {
    const csvHeader = (await readFile(downloadPath, "utf8")).split("\n")[0] ?? "";
    const expectedHeaders = expectedSharedSeries.map((id, index) => `${id}_${expectedSharedTransforms[index] ?? "raw"}`);
    const missingHeaders = ["date", ...expectedHeaders].filter((header) => !csvHeader.includes(`"${header}"`));
    if (missingHeaders.length) addFailure(failures, "csv-header-content", `missing=${missingHeaders.join(",")}`);
  }

  return { route: sharedRoute, viewport: "desktop", status: response?.status() ?? null, layout, failures };
}

async function inspectExplorePlaybooks(page) {
  const failures = [];
  const response = await page.goto(routeUrl("/explore"), { waitUntil: "networkidle", timeout: 60_000 });
  await page.getByRole("heading", { name: "매크로 플레이북" }).waitFor({ timeout: 20_000 });

  if (response?.status() !== 200) {
    addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
  }

  const layout = await collectPageOverflow(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "explore-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }

  const hrefs = await page.locator('a[href*="/macro-chart"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  if (hrefs.length < 4) addFailure(failures, "explore-playbook-count", `hrefs=${hrefs.length}`);
  if (!hrefs.some((href) => href.includes("series=sp500") && href.includes("axis="))) {
    addFailure(failures, "explore-risk-playbook-link", hrefs.join(" | "));
  }
  if (!hrefs.some((href) => href.includes("preset=activity"))) {
    addFailure(failures, "explore-activity-playbook-link", hrefs.join(" | "));
  }

  return { route: "/explore", viewport: "desktop", status: response?.status() ?? null, layout, failures };
}

async function inspectPresetRoute(page) {
  const failures = [];
  const response = await page.goto(routeUrl(presetRoute), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);
  const params = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  const actualSeries = splitParam(params.series);

  if (response?.status() !== 200) {
    addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
  }
  if (params.range !== "MAX") addFailure(failures, "preset-range-roundtrip", `range=${params.range ?? "missing"}`);
  if (params.hidden !== "ism_mfg_headline") {
    addFailure(failures, "preset-hidden-roundtrip", `hidden=${params.hidden ?? "missing"}`);
  }
  if (expectedPresetSeries.some((id) => !actualSeries.includes(id))) {
    addFailure(failures, "preset-series-roundtrip", `series=${params.series ?? "missing"}`);
  }

  return { route: presetRoute, viewport: "desktop", status: response?.status() ?? null, failures };
}

async function inspectRetry(context) {
  const failures = [];
  let blockedOnce = false;
  await context.route("**/data/indices/sp500.json", async (route) => {
    if (!blockedOnce) {
      blockedOnce = true;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(routeUrl(sharedRoute), { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (response?.status() !== 200) {
      addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
    }
    await page.getByText("차트 데이터를 불러오지 못했습니다.").waitFor({ timeout: 20_000 });
    await page.getByRole("button", { name: "다시 시도" }).click();
    await waitForMacroChart(page);
    if (!blockedOnce) addFailure(failures, "retry-forced-error", "intercept did not block first request");
  } catch (error) {
    addFailure(failures, "retry-path", String(error));
  } finally {
    await page.close();
    await context.unroute("**/data/indices/sp500.json");
  }

  return { route: sharedRoute, viewport: "desktop", status: null, failures };
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
  const params = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  if (params.range !== "10Y") addFailure(failures, "mobile-share-range-roundtrip", `range=${params.range ?? "missing"}`);
  if (params.hidden !== "vix") addFailure(failures, "mobile-share-hidden-roundtrip", `hidden=${params.hidden ?? "missing"}`);
  if (params.transform !== expectedSharedTransforms.join(",")) {
    addFailure(failures, "mobile-share-transform-roundtrip", `transform=${params.transform ?? "missing"}`);
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
  results.push(await inspectPresetRoute(desktopPage));
  results.push(await inspectRedirect(desktopPage));
  results.push(await inspectExplorePlaybooks(desktopPage));
  await desktopContext.close();

  const retryContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  results.push(await inspectRetry(retryContext));
  await retryContext.close();

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
