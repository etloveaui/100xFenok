import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const baseUrl = process.env.QA_BASE_URL || "http://127.0.0.1:3105";
const strictMode = process.env.QA_MACRO_CHART_STRICT !== "0";
const expectedMaxSeries = 8;
const sharedRoute =
  process.env.QA_MACRO_CHART_ROUTE ||
  "/macro-chart?macro=risk-liquidity&series=sp500,vix,tga,DGS10,M2SL,WALCL,WRESBAL,HY_spread&transform=rebase100,raw,rebase100,raw,yoy,rebase100,rebase100,raw&range=10Y&hidden=vix";
const expectedSharedParams = new URL(sharedRoute, "https://qa.local").searchParams;
const expectedSharedSeries = expectedSharedParams.get("series")?.split(",").filter(Boolean) ?? [];
const expectedSharedTransforms = expectedSharedParams.get("transform")?.split(",").filter(Boolean) ?? [];
const presetRoute = "/macro-chart?macro=activity&preset=activity&range=MAX&hidden=ism_mfg_headline";
const expectedPresetSeries = ["oecd_cli_us", "pmi_mfg_us_sp", "ism_mfg_headline", "ism_services_headline"];

function routeUrl(route) {
  return new URL(route, baseUrl).toString();
}

function addFailure(failures, check, detail) {
  failures.push({ check, detail });
}

function watchHydrationErrors(page, failures) {
  const seen = new Set();
  const record = (source, text) => {
    if (!/Hydration failed|hydration mismatch|server rendered HTML didn't match/i.test(text)) return;
    const key = `${source}:${text.slice(0, 160)}`;
    if (seen.has(key)) return;
    seen.add(key);
    addFailure(failures, "hydration-error", `${source}: ${text.slice(0, 500)}`);
  };
  page.on("console", (message) => {
    if (message.type() === "error") record("console", message.text());
  });
  page.on("pageerror", (error) => {
    record("pageerror", error.message);
  });
}

function watchExternalProviderRequests(page, failures) {
  const localOrigin = new URL(baseUrl).origin;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === localOrigin) return;
    if (url.hostname === "stooq-proxy.etloveaui.workers.dev") return;
    if (!/stooq|alphavantage|query\d+\.finance\.yahoo|stockanalysis\.com/i.test(url.hostname)) return;
    addFailure(failures, "external-provider-request", url.href);
  });
}

function splitParam(value) {
  return value?.split(",").filter(Boolean) ?? [];
}

async function hasVisibleText(page, text) {
  return page.evaluate((needle) => {
    return [...document.querySelectorAll("body *")].some((node) => {
      if (!node.textContent?.includes(needle)) return false;
      const element = node;
      return Boolean(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    });
  }, text);
}

async function inspectStaticContracts() {
  const failures = [];
  const [
    macroSource,
    macroPageSource,
    macroContextSource,
    quickLinksSource,
    catalogSource,
    screenerPageSource,
    screenerClientSource,
    etfsPageSource,
    stockPageSource,
    multichartPageSource,
    multichartHtmlSource,
    navbarSource,
    shellSource,
    appEnhancementsSource,
  ] = await Promise.all([
    readFile(new URL("../src/app/macro-chart/MacroChartClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/macro-chart/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/macro-chart/context.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/market/MarketQuickLinks.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/data/catalog/macro-series.json", import.meta.url), "utf8"),
    readFile(new URL("../src/app/screener/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/screener/ScreenerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/etfs/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/stock/[ticker]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/multichart/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/tools/asset/multichart.html", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Navbar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shell/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/AppEnhancements.tsx", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogSource);

  if (!macroSource.includes("defaultRangeId={DEFAULT_RANGE_ID}") || !macroSource.includes("rangeId={rangeId}")) {
    addFailure(failures, "macro-frame-range-contract", "MacroChartClient must pass controlled range + default range");
  }
  if (!macroSource.includes("useState(() => defaultChartState())") || !macroSource.includes("if (!clientStateReady")) {
    addFailure(failures, "hydration-safe-initial-state", "MacroChartClient must defer URL/localStorage state until after hydration");
  }
  if (!macroPageSource.includes('className="fnk-shell"')) {
    addFailure(failures, "macro-shell-wrapper", "MacroChartPage must use fnk-shell wrapper");
  }
  if (!macroSource.includes("전체 CSV 저장") || !macroSource.includes("전체 CSV는 선택한 시리즈의 전체 로딩 범위 기준")) {
    addFailure(failures, "csv-full-export-copy", "full CSV export copy missing");
  }
  if (!macroSource.includes("macroContextId") || !macroSource.includes("매크로 인사이트 카드")) {
    addFailure(failures, "macro-context-state", "MacroChartClient must carry macro context state and render the insight card");
  }
  for (const id of ["risk-liquidity", "bank-credit", "activity", "crypto-liquidity"]) {
    if (!macroContextSource.includes(`id: "${id}"`) || !macroContextSource.includes(`macro=${id}`)) {
      addFailure(failures, "macro-context-registry", `${id} context href contract missing`);
    }
  }
  if (!quickLinksSource.includes("formula=ratio:sp500:DGS10") || !quickLinksSource.includes("리스크")) {
    addFailure(failures, "quick-link-macro-lenses", "MarketQuickLinks macro lens links missing");
  }
  if (catalog.schema_version !== "macro-series-catalog/v1") {
    addFailure(failures, "catalog-schema-version", `schema=${catalog.schema_version ?? "missing"}`);
  }
  if (!Array.isArray(catalog.series) || catalog.series.length !== 30) {
    addFailure(failures, "catalog-series-count", `count=${catalog.series?.length ?? "missing"}`);
  }
  if (!Array.isArray(catalog.analysis_lenses) || catalog.analysis_lenses.length < 4) {
    addFailure(failures, "catalog-analysis-lenses", `count=${catalog.analysis_lenses?.length ?? "missing"}`);
  }
  const lensWithoutMacro = (catalog.analysis_lenses ?? []).filter((item) => !String(item.href ?? "").includes("macro="));
  if (lensWithoutMacro.length) {
    addFailure(failures, "catalog-analysis-lens-macro", lensWithoutMacro.map((item) => item.id).join(","));
  }
  if (!Array.isArray(catalog.connection_surfaces) || !catalog.connection_surfaces.some((item) => item.surface === "screener")) {
    addFailure(failures, "catalog-connection-surfaces", "screener connection missing");
  }
  const bareConnectionSurfaces = (catalog.connection_surfaces ?? []).filter((item) => !String(item.href ?? "").includes("macro="));
  if (bareConnectionSurfaces.length) {
    addFailure(failures, "catalog-connection-macro", bareConnectionSurfaces.map((item) => item.surface).join(","));
  }
  if (
    !screenerPageSource.includes("initialMacroContextId") ||
    !screenerPageSource.includes("initialPreset") ||
    !screenerClientSource.includes("MacroContextCard") ||
    !screenerClientSource.includes("initialConnectionFilter")
  ) {
    addFailure(failures, "screener-macro-deeplink", "Screener must accept macro/preset/connection deep-link context");
  }
  if (!etfsPageSource.includes("MacroContextCard") || !etfsPageSource.includes("macroContextFromParam")) {
    addFailure(failures, "etf-macro-deeplink", "ETF page must accept macro context");
  }
  if (!stockPageSource.includes("MacroContextCard") || !stockPageSource.includes("macroContextFromParam")) {
    addFailure(failures, "stock-macro-deeplink", "Stock page must accept macro context");
  }
  if (multichartPageSource.includes("redirect(") || !multichartPageSource.includes("RouteEmbedFrame")) {
    addFailure(failures, "multichart-route", "multichart must render the restored stock compare frame instead of redirecting");
  }
  if (!multichartHtmlSource.includes("stooq-proxy.etloveaui.workers.dev") || !multichartHtmlSource.includes("stooq_cache_")) {
    addFailure(failures, "multichart-stooq-worker", "Stooq Worker proxy + 24h cache contract missing");
  }
  for (const href of ['href="/multichart"', 'href="/etfs"', 'href="/sectors"', 'href="/screener"', 'href="/superinvestors"']) {
    if (navbarSource.includes(href) || shellSource.includes(href) || appEnhancementsSource.includes(href)) {
      addFailure(failures, "single-explore-entry", `${href} still appears in top-level navigation`);
    }
  }
  for (const href of ["'/multichart'", "'/etfs'", "'/sectors'", "'/screener'", "'/superinvestors'"]) {
    if (appEnhancementsSource.includes(`href: ${href}`) || shellSource.includes(`href: ${href.replace(/'/g, '"')}`)) {
      addFailure(failures, "single-explore-entry", `${href} still appears as a top-level navigation href`);
    }
  }

  return { route: "static:macro-chart", viewport: "static", status: null, failures };
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
  watchHydrationErrors(page, failures);
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
  if (params.macro !== "risk-liquidity") addFailure(failures, "share-macro-roundtrip", `macro=${params.macro ?? "missing"}`);
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

  await page.getByRole("button", { name: "확대" }).click();
  await page.waitForTimeout(200);
  const rangeAfterZoomIn = await page.evaluate(() => new URL(window.location.href).searchParams.get("range"));
  if (rangeAfterZoomIn !== "6M") addFailure(failures, "zoom-in-url-update", `range=${rangeAfterZoomIn}`);
  await page.getByRole("button", { name: "축소" }).click();
  await page.waitForTimeout(200);
  const rangeAfterZoomOut = await page.evaluate(() => new URL(window.location.href).searchParams.get("range"));
  if (rangeAfterZoomOut !== "1Y") addFailure(failures, "zoom-out-url-update", `range=${rangeAfterZoomOut}`);

  await page.getByLabel("TGA 축").selectOption("right");
  await page.waitForTimeout(200);
  const axisAfterSelect = splitParam(await page.evaluate(() => new URL(window.location.href).searchParams.get("axis")));
  if (!axisAfterSelect.includes("tga:right")) {
    addFailure(failures, "axis-url-update", `axis=${axisAfterSelect.join(",") || "missing"}`);
  }

  await page.getByLabel("합성 왼쪽 시리즈").selectOption("sp500");
  await page.getByLabel("합성 계산식").selectOption("ratio");
  await page.getByLabel("합성 오른쪽 시리즈").selectOption("DGS10");
  await page.getByRole("button", { name: "합성 추가" }).click();
  await page.waitForTimeout(300);
  const formulaAfterAdd = await page.evaluate(() => new URL(window.location.href).searchParams.get("formula"));
  if (formulaAfterAdd !== "ratio:sp500:DGS10") {
    addFailure(failures, "formula-url-update", `formula=${formulaAfterAdd ?? "missing"}`);
  }
  if (!(await hasVisibleText(page, "S&P 500/10Y ×100"))) {
    addFailure(failures, "formula-series-visible", "S&P 500/10Y ×100 not visible");
  }
  if (!(await page.getByText("카탈로그 2026-06-24 · 30개 시리즈").isVisible())) {
    addFailure(failures, "catalog-provenance-copy", "catalog provenance copy missing");
  }
  if (!(await page.getByText("전체 CSV는 선택한 시리즈의 전체 로딩 범위 기준").isVisible())) {
    addFailure(failures, "csv-provenance-copy", "full CSV provenance copy missing");
  }
  if (!(await page.locator('[aria-label="매크로 분석 요약"]').getByText("연결 데이터").isVisible())) {
    addFailure(failures, "analysis-summary-visible", "analysis summary missing");
  }
  const insightCard = page.locator('[aria-label="매크로 인사이트 카드"]');
  if (!(await insightCard.getByText("리스크·유동성").isVisible())) {
    addFailure(failures, "macro-insight-context", "risk-liquidity insight card missing");
  }
  if (!(await insightCard.getByRole("link", { name: "스크리너" }).isVisible())) {
    addFailure(failures, "macro-insight-screener-link", "insight screener link missing");
  }
  const insightStockHref = await insightCard.getByRole("link", { name: "NVDA" }).getAttribute("href");
  if (!insightStockHref?.includes("/stock/NVDA") || !insightStockHref.includes("macro=risk-liquidity")) {
    addFailure(failures, "macro-insight-stock-link", `href=${insightStockHref ?? "missing"}`);
  }
  const screenerConnection = page.getByRole("link", { name: /스크리너/ }).first();
  if (!(await screenerConnection.isVisible())) {
    addFailure(failures, "connection-link-visible", "screener connection link missing");
  }
  const screenerHref = await screenerConnection.getAttribute("href");
  if (!screenerHref?.includes("/screener") || !screenerHref.includes("macro=risk-liquidity") || !screenerHref.includes("preset=connected")) {
    addFailure(failures, "connection-screener-href", `href=${screenerHref ?? "missing"}`);
  }
  const etfConnection = page.getByRole("link", { name: /ETF 센터/ }).first();
  const etfHref = await etfConnection.getAttribute("href");
  if (!etfHref?.includes("/etfs") || !etfHref.includes("macro=risk-liquidity")) {
    addFailure(failures, "connection-etf-href", `href=${etfHref ?? "missing"}`);
  }
  const stockConnection = page.getByRole("link", { name: /대표 종목 NVDA/ }).first();
  const stockHref = await stockConnection.getAttribute("href");
  if (!stockHref?.includes("/stock/NVDA") || !stockHref.includes("macro=risk-liquidity")) {
    addFailure(failures, "connection-stock-href", `href=${stockHref ?? "missing"}`);
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
    if ((storedPreset.formulas ?? []).length !== 1 || storedPreset.formulas?.[0]?.id !== "formula-ratio-sp500-DGS10") {
      addFailure(failures, "user-preset-formula", `formulas=${JSON.stringify(storedPreset.formulas ?? [])}`);
    }
    if ((storedPreset.selected ?? []).length !== expectedMaxSeries) {
      addFailure(failures, "user-preset-series", `selected=${(storedPreset.selected ?? []).length}`);
    }
    if (storedPreset.macroContextId !== "risk-liquidity") {
      addFailure(failures, "user-preset-macro", `macroContextId=${storedPreset.macroContextId ?? "missing"}`);
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
  if (paramsAfterUserPreset.formula !== "ratio:sp500:DGS10") {
    addFailure(failures, "user-preset-apply-formula", `formula=${paramsAfterUserPreset.formula ?? "missing"}`);
  }
  if (paramsAfterUserPreset.macro !== "risk-liquidity") {
    addFailure(failures, "user-preset-apply-macro", `macro=${paramsAfterUserPreset.macro ?? "missing"}`);
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

  await page.getByLabel("합성 왼쪽 시리즈").selectOption("sp500");
  await page.getByLabel("합성 계산식").selectOption("ratio");
  await page.getByLabel("합성 오른쪽 시리즈").selectOption("DGS10");
  await page.getByRole("button", { name: "합성 추가" }).click();
  await page.waitForTimeout(300);

  const pngPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "PNG 저장" }).click();
  const pngDownload = await pngPromise;
  if (!pngDownload.suggestedFilename().endsWith(".png")) {
    addFailure(failures, "png-download-name", pngDownload.suggestedFilename());
  }
  const pngPath = await pngDownload.path();
  if (!pngPath) {
    addFailure(failures, "png-download-path", "download path unavailable");
  } else {
    const signature = await readFile(pngPath);
    const pngMagic = signature.subarray(0, 8).toString("hex");
    if (pngMagic !== "89504e470d0a1a0a") addFailure(failures, "png-download-signature", pngMagic);
    if (signature.byteLength < 1024) addFailure(failures, "png-download-size", `bytes=${signature.byteLength}`);
  }

  const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "전체 CSV 저장" }).click();
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
    const missingHeaders = ["date", ...expectedHeaders, "formula-ratio-sp500-DGS10"].filter((header) => !csvHeader.includes(`"${header}"`));
    if (missingHeaders.length) addFailure(failures, "csv-header-content", `missing=${missingHeaders.join(",")}`);
  }

  await page.getByRole("button", { name: "은행·신용 렌즈" }).click();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("formula") === "spread:bank_credit:deposits", null, { timeout: 10_000 });
  const paramsAfterLens = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  if (!splitParam(paramsAfterLens.series).includes("bank_credit")) {
    addFailure(failures, "analysis-lens-series", `series=${paramsAfterLens.series ?? "missing"}`);
  }
  if (paramsAfterLens.formula !== "spread:bank_credit:deposits") {
    addFailure(failures, "analysis-lens-formula", `formula=${paramsAfterLens.formula ?? "missing"}`);
  }
  if (paramsAfterLens.macro !== "bank-credit") {
    addFailure(failures, "analysis-lens-macro", `macro=${paramsAfterLens.macro ?? "missing"}`);
  }

  return { route: sharedRoute, viewport: "desktop", status: response?.status() ?? null, layout, failures };
}

async function inspectExplorePlaybooks(page) {
  const failures = [];
  watchHydrationErrors(page, failures);
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
  for (const id of ["risk-liquidity", "bank-credit", "activity", "crypto-liquidity"]) {
    if (!hrefs.some((href) => href.includes(`macro=${id}`))) {
      addFailure(failures, "explore-macro-context-link", `${id} missing in ${hrefs.join(" | ")}`);
    }
  }
  if (!(await page.getByRole("heading", { name: "ETF 목록" }).isVisible())) {
    addFailure(failures, "explore-etf-entry", "ETF card missing from Explore hub");
  }

  return { route: "/explore", viewport: "desktop", status: response?.status() ?? null, layout, failures };
}

async function inspectConnectedSurfaces(page) {
  const failures = [];
  watchHydrationErrors(page, failures);

  let response = await page.goto(routeUrl("/screener?macro=risk-liquidity&preset=connected&connection=indexMembership"), {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.getByRole("heading", { name: "종목 스크리너" }).waitFor({ timeout: 30_000 });
  if (response?.status() !== 200) {
    addFailure(failures, "screener-http-status", `status=${response?.status() ?? "unknown"}`);
  }
  let layout = await collectPageOverflow(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "screener-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }
  let macroCard = page.locator('[aria-label="매크로 연결 맥락"]');
  if (!(await macroCard.getByText("리스크·유동성").isVisible())) {
    addFailure(failures, "screener-macro-card", "risk-liquidity context missing");
  }
  const connectedPreset = page.getByRole("button", { name: "연결 데이터", exact: true });
  const presetPressed = await connectedPreset.getAttribute("aria-pressed");
  if (presetPressed !== "true") {
    addFailure(failures, "screener-preset-state", `aria-pressed=${presetPressed}`);
  }
  const connectionValue = await page.getByLabel("연결 범위").inputValue();
  if (connectionValue !== "indexMembership") {
    addFailure(failures, "screener-connection-state", `value=${connectionValue}`);
  }

  response = await page.goto(routeUrl("/etfs?macro=crypto-liquidity&digital=1"), {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.getByRole("heading", { name: "ETF 센터" }).waitFor({ timeout: 30_000 });
  if (response?.status() !== 200) {
    addFailure(failures, "etf-http-status", `status=${response?.status() ?? "unknown"}`);
  }
  layout = await collectPageOverflow(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "etf-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }
  macroCard = page.locator('[aria-label="매크로 연결 맥락"]');
  if (!(await macroCard.getByText("크립토 유동성").isVisible())) {
    addFailure(failures, "etf-macro-card", "crypto-liquidity context missing");
  }
  const digitalSegment = page.getByRole("group", { name: "ETF 세그먼트" }).getByRole("button", { name: /디지털자산/ });
  const digitalPressed = await digitalSegment.getAttribute("aria-pressed");
  if (digitalPressed !== "true") {
    addFailure(failures, "etf-digital-state", `aria-pressed=${digitalPressed}`);
  }

  response = await page.goto(routeUrl("/stock/NVDA?macro=risk-liquidity"), {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  await page.locator('[aria-label="매크로 연결 맥락"]').waitFor({ timeout: 30_000 });
  if (response?.status() !== 200) {
    addFailure(failures, "stock-http-status", `status=${response?.status() ?? "unknown"}`);
  }
  layout = await collectPageOverflow(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "stock-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }
  macroCard = page.locator('[aria-label="매크로 연결 맥락"]');
  if (!(await macroCard.getByText("리스크·유동성").isVisible())) {
    addFailure(failures, "stock-macro-card", "risk-liquidity context missing");
  }

  return { route: "/screener + /etfs + /stock macro-context", viewport: "desktop", status: null, failures };
}

async function inspectPresetRoute(page) {
  const failures = [];
  watchHydrationErrors(page, failures);
  const response = await page.goto(routeUrl(presetRoute), { waitUntil: "networkidle", timeout: 60_000 });
  await waitForMacroChart(page);
  const params = await page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries()));
  const actualSeries = splitParam(params.series);

  if (response?.status() !== 200) {
    addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
  }
  if (params.macro !== "activity") addFailure(failures, "preset-macro-roundtrip", `macro=${params.macro ?? "missing"}`);
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
  watchHydrationErrors(page, failures);

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
  watchHydrationErrors(page, failures);
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
  if (params.macro !== "risk-liquidity") addFailure(failures, "mobile-share-macro-roundtrip", `macro=${params.macro ?? "missing"}`);
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
  await page.getByLabel("합성 왼쪽 시리즈").selectOption("sp500");
  await page.getByLabel("합성 계산식").selectOption("ratio");
  await page.getByLabel("합성 오른쪽 시리즈").selectOption("DGS10");
  await page.getByRole("button", { name: "합성 추가" }).click();
  await page.waitForTimeout(300);
  const mobileStatus = page.locator('[aria-label="모바일 매크로 상태"]');
  if (!(await mobileStatus.getByText("합성 1개").isVisible())) {
    addFailure(failures, "mobile-formula-count-chip", "formula count chip missing");
  }
  if (!(await mobileStatus.getByRole("button", { name: /S&P 500\/10Y ×100 삭제/ }).isVisible())) {
    addFailure(failures, "mobile-formula-chip", "formula chip missing");
  }

  return { route: sharedRoute, viewport: "mobile", status: response?.status() ?? null, layout, failures };
}

async function inspectMultichartRoute(page) {
  const failures = [];
  watchHydrationErrors(page, failures);
  watchExternalProviderRequests(page, failures);
  const route = "/multichart";
  const response = await page.goto(routeUrl(route), { waitUntil: "networkidle", timeout: 60_000 });
  const frame = page.frameLocator('iframe[title="100x 멀티차트"]');
  await frame.getByRole("heading", { name: /100x\s*멀티차트/ }).waitFor({ timeout: 45_000 });
  const pathname = await page.evaluate(() => window.location.pathname);
  if (response?.status() !== 200) {
    addFailure(failures, "http-status", `status=${response?.status() ?? "unknown"}`);
  }
  if (pathname.replace(/\/$/, "") !== "/multichart") {
    addFailure(failures, "multichart-route", `pathname=${pathname}`);
  }
  const layout = await collectPageOverflow(page);
  if (layout.scrollWidth > layout.viewportWidth + 1) {
    addFailure(failures, "multichart-overflow", `scrollWidth=${layout.scrollWidth} viewport=${layout.viewportWidth}`);
  }
  for (const label of ["+ 티커 추가", "수익률 비교", "실제 가격", "벤치마크 대비"]) {
    if (!(await frame.getByText(label, { exact: true }).isVisible())) {
      addFailure(failures, "multichart-control-visible", `${label} missing`);
    }
  }
  await frame.getByRole("button", { name: "분석 실행" }).click();
  await frame.getByRole("cell", { name: "SPY", exact: true }).waitFor({ timeout: 45_000 });
  if (!(await frame.getByRole("cell", { name: "QQQ", exact: true }).isVisible())) {
    addFailure(failures, "multichart-result-row", "QQQ result row missing");
  }
  return { route, viewport: "desktop", status: response?.status() ?? null, layout, failures };
}

const results = [await inspectStaticContracts()];
const browser = await chromium.launch({ headless: true });

try {
  const desktopContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  const desktopPage = await desktopContext.newPage();
  results.push(await inspectSharedDesktop(desktopPage));
  results.push(await inspectPresetRoute(desktopPage));
  results.push(await inspectMultichartRoute(desktopPage));
  results.push(await inspectExplorePlaybooks(desktopPage));
  results.push(await inspectConnectedSurfaces(desktopPage));
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
