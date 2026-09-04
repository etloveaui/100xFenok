#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TSX_BIN = path.join(
  APP_ROOT,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);
const strictMode = process.env.QA_MACRO_CHART_STRICT !== "0";

function addFailure(failures, check, detail) {
  failures.push({ check, detail });
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
    shellSource,
    shellStyleSource,
    productNavSource,
    registrySource,
    loaderSource,
    engineSource,
    chartRegistrySource,
    chartThemeSource,
    macroStyleSource,
  ] = await Promise.all([
    readFile(new URL("../src/app/macro-chart/MacroChartClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/macro-chart/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/macro-chart/context.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/market/MarketQuickLinks.tsx", import.meta.url), "utf8"),
    // canonical-only mirror: validate the source of truth, not the generated public copy
    readFile(new URL("../../data/catalog/macro-series.json", import.meta.url), "utf8"),
    readFile(new URL("../src/app/screener/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/screener/ScreenerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/etfs/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/stock/[ticker]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/multichart/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/tools/asset/multichart.html", import.meta.url), "utf8"),
    readFile(new URL("../src/components/shell/AppShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/app-shell.css", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/product-nav.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/macro-chart/registry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/macro-chart/loader.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/market-valuation/charts/MarketChartEngineClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/market-valuation/charts/chartJsRegistry.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/chart-theme.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/cp-w5-macro-chart.css", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogSource);

  if (!macroSource.includes("defaultRangeId={DEFAULT_RANGE_ID}") || !macroSource.includes("rangeId={rangeId}")) {
    addFailure(failures, "macro-frame-range-contract", "MacroChartClient must pass controlled range + default range");
  }
  if (!macroSource.includes("useState(() => defaultChartState(initialMode))") || !macroSource.includes("if (!clientStateReady")) {
    addFailure(failures, "hydration-safe-initial-state", "MacroChartClient must defer URL/localStorage state until after hydration");
  }
  if (!macroPageSource.includes('className="fnk-shell"')) {
    addFailure(failures, "macro-shell-wrapper", "MacroChartPage must use fnk-shell wrapper");
  }
  if (!macroSource.includes("변환 CSV 저장됨") || !macroSource.includes("CSV는 선택 기간·변환 후 실제 표시값 기준")) {
    addFailure(failures, "csv-plotted-export-copy", "plotted CSV export copy missing");
  }
  if (!registrySource.includes('macro-series.json') || !macroSource.includes('macro-chart/registry')) {
    addFailure(failures, "runtime-catalog-ssot", "runtime must import the tracked JSON catalog through the registry");
  }
  for (const token of ["cutoffPoints(rawPoints", "aggregateMacroPoints(windowPoints", "applyMacroTransform(aggregatedPoints", "downsampleMacroPoints(applyMacroTransform", "payloadErrors", "transformedUnitGroup"]) {
    if (!loaderSource.includes(token)) addFailure(failures, "transform-pipeline-contract", `${token} missing`);
  }
  if (
    !engineSource.includes("spanGaps = false") ||
    !engineSource.includes("spanGaps,") ||
    !macroSource.includes("spanGaps")
  ) {
    addFailure(failures, "sparse-series-gap-contract", "macro charts must expose caller-controlled source-gap rendering");
  }
  if (!engineSource.includes("animation: false")) {
    addFailure(failures, "deterministic-chart-animation", "shared chart animation must be disabled for deterministic capture");
  }
  if (!engineSource.includes("Pretendard, Noto Sans KR, system-ui, sans-serif")) {
    addFailure(failures, "macro-v2-chart-ui-font", "axis and tooltip labels must use the UI font stack");
  }
  for (const token of [
    'data-macro-v2-topbar="true"',
    'data-macro-v2-typeahead="true"',
    'data-macro-v2-global-controls="true"',
    'data-macro-v2-legend-overlay="true"',
    'data-macro-v2-series-editor="true"',
    'data-macro-v2-event-state="unavailable"',
    '이벤트 피드 없음',
    '침체 음영',
    '축 그룹 자동',
    '링크',
    'data-macro-v2-formula-jump="true"',
    '+ 수식',
  ]) {
    if (!macroSource.includes(token)) addFailure(failures, "macro-v2-reading-first", `${token} missing`);
  }
  for (const token of [
    'NBER Business Cycle Dating',
    'peakMonth: "2001-03", troughMonth: "2001-11"',
    'peakMonth: "2007-12", troughMonth: "2009-06"',
    'peakMonth: "2020-02", troughMonth: "2020-04"',
  ]) {
    if (!registrySource.includes(token)) addFailure(failures, "macro-v2-recession-registry", `${token} missing`);
  }
  for (const token of [
    'data-macro-v2-recession-overlay="hero"',
    'data-macro-v2-recession-overlay="lens"',
    'dateBands={showRecessionShading ? NBER_RECESSION_DATE_BANDS : undefined}',
  ]) {
    if (!macroSource.includes(token)) addFailure(failures, "macro-v2-recession-shading", `${token} missing`);
  }
  for (const token of [
    'id: "market-chart-date-bands"',
    'beforeDatasetsDraw(chart)',
    'xScale.getPixelForValue(start)',
  ]) {
    if (!engineSource.includes(token)) addFailure(failures, "market-chart-date-bands", `${token} missing`);
  }
  if (!shellStyleSource.includes('--c-band:var(--fnk-neutral-200)')) {
    addFailure(failures, "macro-v2-recession-band-token", "dedicated neutral band token missing");
  }
  for (const token of ['band: "--c-band"', 'band: "lightgray"']) {
    if (!chartThemeSource.includes(token)) addFailure(failures, "macro-v2-recession-band-token", `${token} missing`);
  }
  for (const token of ['theme.token("band")', 'ctx.globalAlpha = 0.55']) {
    if (!engineSource.includes(token)) addFailure(failures, "macro-v2-recession-band-hero", `${token} missing`);
  }
  for (const token of ['fill: var(--c-band)', 'opacity: 0.55']) {
    if (!macroStyleSource.includes(token)) addFailure(failures, "macro-v2-recession-band-lens", `${token} missing`);
  }
  for (const label of ["리스크·유동성", "성장", "인플레이션", "금리·신용", "내 컬렉션"]) {
    if (!macroSource.includes(label)) addFailure(failures, "macro-v2-lens-bar", `${label} missing`);
  }
  for (const label of ["수준", "변화", "% 변화", "YoY", "100 기준"]) {
    if (!registrySource.includes(label)) addFailure(failures, "macro-v2-series-editor-controls", `${label} missing`);
  }
  for (const label of ["평균", "합", "기말", "왼쪽", "오른쪽", "자동 그룹", "제거"]) {
    if (!macroSource.includes(label)) addFailure(failures, "macro-v2-series-editor-controls", `${label} missing`);
  }
  if (!macroSource.includes('spanGaps={false}')) {
    addFailure(failures, "macro-v2-missing-date-gaps", "Macro V2 must keep missing dates as visible gaps");
  }
  for (const token of [
    'legacyChange && value === "change"',
    'params.set("transformVersion", "2")',
    'subtract: "a − b"',
    'ratio: "a / b"',
    'scale: "a × k"',
    'formulaLabel: displayFormula',
    'unitLabel: metadata.unitLabel',
    'data-macro-v2-derived-legend={formula.operator}',
    'data-macro-v2-formula-presets="guarded"',
    'seriesById(preset.leftId) && seriesById(preset.rightId)',
    'data-macro-v2-tile-evidence="analysis"',
    'data-macro-v2-tile-evidence="lens"',
    'buildMarketSeries(loaded, { alignDates: false, preserveCadenceGaps: true })',
    'xScaleMode="time"',
  ]) {
    if (!macroSource.includes(token)) addFailure(failures, "macro-v2-derived-series", `${token} missing`);
  }
  for (const token of [
    'type MacroSurfaceState = "loading" | "empty" | "error" | "stale" | "ready"',
    'data-macro-v2-lens-collection="true"',
    'data-macro-v2-lens-sparkline=',
    'data-macro-v2-lens-preview-state=',
    'data-macro-v2-collection-state=',
    'data-macro-v2-collection-action="rename"',
    '이 브라우저 세션에만 저장됨',
    'data-macro-v2-tile-evidence="compare"',
    'data-macro-v2-table-drawer="true"',
    'data-macro-v2-table-state={tableState}',
    '변환 후 값 · ${tableHeaderSummary}',
    'tableSeriesHeader(item, selected, rangeLabel(rangeId))',
    '<CpDataTable',
    '기준 100 대비',
    'className="cpw5-macro-verdict__text"',
  ]) {
    if (!macroSource.includes(token)) addFailure(failures, "macro-v2-reuse", `${token} missing`);
  }
  for (const token of [
    ".cpw5-macro-lens-sparkline",
    ".cpw5-macro-lens-card:focus-within",
    ".cpw5-macro-table-panel",
    ".cpw5-macro-collection-editor",
  ]) {
    if (!macroStyleSource.includes(token)) addFailure(failures, "macro-v2-reuse-states", `${token} missing`);
  }
  for (const token of [
    'const timePoints = item.points.map((point) => ({ x: Date.parse(point.label), y: point.value }))',
    'data: xScaleMode === "time" ? timePoints : values',
    'type: "time"',
    'xScaleMode = "category"',
    'if (value == null) return null',
  ]) {
    if (!engineSource.includes(token)) addFailure(failures, "macro-v2-time-scale", `${token} missing`);
  }
  if (!loaderSource.includes("const alignDates = options.alignDates ?? true")) {
    addFailure(failures, "macro-v2-shared-chart-default", "legacy date alignment must remain the loader default");
  }
  for (const token of ["TimeScale", "TimeSeriesScale", "_adapters._date.override"]) {
    if (!chartRegistrySource.includes(token)) addFailure(failures, "macro-v2-time-adapter", `${token} missing`);
  }
  for (const token of ["min-height: 720px", "height: 360px", "var(--c-brand)", "var(--c-panel)"]) {
    if (!macroStyleSource.includes(token)) addFailure(failures, "macro-v2-light-system-layout", `${token} missing`);
  }
  if (!macroSource.includes('MACRO_TEN_YEAR_COLOR = okabeItoPalette[1]') || !chartThemeSource.includes('"#E69F00"')) {
    addFailure(failures, "macro-v2-ten-year-color", "10Y series must use Okabe-Ito orange");
  }
  if (!engineSource.includes('item.lineRole === "primary" ? 2.5') || !engineSource.includes("[6, 4]")) {
    addFailure(failures, "line-role-contract", "primary/secondary line weight and dash encoding missing");
  }
  for (const color of ["#0072B2", "#E69F00", "#009E73", "#D55E00", "#CC79A7", "#56B4E9", "#F0E442", "#000000"]) {
    if (!chartThemeSource.includes(color)) addFailure(failures, "okabe-ito-palette", `${color} missing`);
  }
  if (!macroSource.includes("macroContextId") || !macroSource.includes('aria-label="매크로 인사이트"')) {
    addFailure(failures, "macro-context-state", "MacroChartClient must carry macro context state and render the insight section");
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
  if (
    multichartPageSource.includes("redirect(") ||
    !multichartPageSource.includes("MacroChartClient") ||
    !multichartPageSource.includes('initialMode="stock-compare"')
  ) {
    addFailure(failures, "multichart-route", "multichart must render the fused stock-compare Macro Chart mode instead of redirecting or iframe-only legacy");
  }
  if (!multichartHtmlSource.includes("stooq-proxy.etloveaui.workers.dev") || !multichartHtmlSource.includes("stooq_cache_") || !macroSource.includes("MARKET_COMPARE_LENSES")) {
    addFailure(failures, "multichart-stooq-worker", "Stooq Worker proxy + 24h cache contract missing");
  }
  for (const label of ["시장 비교", "수익률 비교", "실제 가격", "벤치마크 대비", "+ 티커 추가"]) {
    if (!macroSource.includes(label)) {
      addFailure(failures, "market-compare-workbench", `${label} missing from MacroChartClient`);
    }
  }
  if (!macroSource.includes("__meta_source") || !macroSource.includes("__meta_frequency") || !macroSource.includes("definitionMetaLabel")) {
    addFailure(failures, "source-frequency-honesty", "source/frequency UI and CSV metadata contract missing");
  }
  for (const item of [
    ['id: "explore"', 'href: EXPLORE_ROUTE', 'label: EXPLORE_NAV_LABEL'],
    ['id: "workbench"', 'href: ROUTES.workbench', 'label: WORKBENCH_NAV_LABEL', 'group: "더보기"'],
    ['id: "market"', 'href: ROUTES.market', 'label: "시장"'],
    ['id: "sectors"', 'href: ROUTES.sectors', 'label: "섹터"'],
    ['id: "etfs"', 'href: ROUTES.etfs', 'label: "ETF"'],
    ['id: "screener"', 'href: ROUTES.screener', 'label: "스크리너"'],
    ['id: "superinvestors"', 'href: ROUTES.superinvestors', 'label: "투자자"'],
    ['id: "portfolio"', 'href: ROUTES.portfolio', 'label: "포트폴리오"'],
    ['id: "chart"', 'href: CHART_ROUTE', 'label: CHART_NAV_LABEL'],
  ]) {
    for (const token of item) {
      if (!shellSource.includes(token)) {
        addFailure(failures, "app-shell-rail-reachability", `${token} missing from AppShell rail`);
      }
    }
  }
  for (const token of [
    'EXPLORE_ROUTE = ROUTES.home',
    'EXPLORE_NAV_LABEL = "홈"',
    'WORKBENCH_ROUTE = ROUTES.workbench',
    'WORKBENCH_NAV_LABEL = "워크벤치"',
    'CHART_NAV_LABEL = "차트"',
    'CHART_ROUTE = ROUTES.macroChart',
  ]) {
    if (!productNavSource.includes(token)) {
      addFailure(failures, "product-nav-labels", `${token} missing from product-nav constants`);
    }
  }
  if (
    !shellSource.includes('const PRIMARY_TAB_IDS: MobileTabId[] = ["explore", "market", "screener", "portfolio", "more"]') ||
    !shellSource.includes('const MORE_TAB_IDS: ShellPage[] = [') ||
    !shellSource.includes('"chart"') ||
    !shellSource.includes('"workbench"') ||
    !shellSource.includes('"sectors"') ||
    !shellSource.includes('"etfs"') ||
    !shellSource.includes('"superinvestors"')
  ) {
    addFailure(failures, "app-shell-mobile-tabs", "mobile primary starts at home/market/screener/portfolio; chart/workbench live under more");
  }

  return { route: "static:macro-chart", viewport: "static", status: null, failures };
}

function inspectPlottedRanges() {
  const failures = [];
  if (!existsSync(TSX_BIN)) {
    addFailure(failures, "tsx-runtime", `tsx binary missing: ${TSX_BIN}`);
    return { route: "static:macro-chart-ranges", viewport: "node", status: null, failures, ranges: [] };
  }

  const probe = `
    import fs from "node:fs";
    import path from "node:path";
    import { aggregateMacroPoints, loadMacroSeries, buildMarketSeries } from "./src/lib/macro-chart/loader.ts";
    import { seriesById } from "./src/lib/macro-chart/registry.ts";

    (async () => {
    const appRoot = process.cwd();
    globalThis.fetch = async (input) => {
      const pathname = new URL(String(input), "https://qa.local").pathname;
      const candidates = [
        path.resolve(appRoot, "..", "." + pathname),
        path.resolve(appRoot, "public", "." + pathname),
      ];
      const filePath = candidates.find((candidate) => fs.existsSync(candidate));
      if (!filePath) return new Response("not found", { status: 404 });
      return new Response(fs.readFileSync(filePath), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const ids = ["sp500", "DGS10", "HY_spread", "M2SL"];
    const definitions = ids.map((id) => {
      const definition = seriesById(id);
      if (!definition) throw new Error("missing macro definition: " + id);
      return definition;
    });
    const transforms = new Map([
      ["sp500", "rebase100"],
      ["DGS10", "raw"],
      ["HY_spread", "raw"],
      ["M2SL", "yoy"],
    ]);
    const loaded = await loadMacroSeries(definitions, transforms, { months: 60 });
    const plotted = buildMarketSeries(loaded);
    const ranges = ids.map((id) => {
      const source = loaded.find((item) => item.definition.id === id);
      const series = plotted.find((item) => item.id === id);
      if (!source || source.error || !series) {
        return { id, error: source?.error ?? "series missing after pipeline" };
      }
      const values = series.points
        .map((point) => point.value)
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      return {
        id,
        count: values.length,
        min: Math.min(...values),
        max: Math.max(...values),
        first: values[0],
        last: values.at(-1),
        unitGroup: series.unitGroup,
        axis: series.yAxisId,
      };
    });
    const aggregationFixture = [
      { date: "2026-01-02", value: 10 },
      { date: "2026-01-20", value: 20 },
      { date: "2026-02-05", value: 30 },
    ];
    const aggregations = {
      average: aggregateMacroPoints(aggregationFixture, "daily", "monthly", "average"),
      sum: aggregateMacroPoints(aggregationFixture, "daily", "monthly", "sum"),
      end: aggregateMacroPoints(aggregationFixture, "daily", "monthly", "end"),
      noUpsample: aggregateMacroPoints(aggregationFixture.slice(0, 1), "monthly", "daily", "average"),
    };
    console.log(JSON.stringify({ ranges, aggregations }));
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;

  const result = spawnSync(TSX_BIN, ["--eval", probe], {
    cwd: APP_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    addFailure(
      failures,
      "plotted-range-pipeline",
      (result.stderr || result.stdout || `exit=${result.status}`).trim(),
    );
    return { route: "static:macro-chart-ranges", viewport: "node", status: result.status, failures, ranges: [] };
  }

  let ranges;
  try {
    const parsed = JSON.parse(result.stdout);
    ranges = parsed.ranges;
    const aggregations = parsed.aggregations;
    if (aggregations?.average?.[0]?.value !== 15 || aggregations?.sum?.[0]?.value !== 30 || aggregations?.end?.[0]?.value !== 20) {
      addFailure(failures, "frequency-aggregation", JSON.stringify(aggregations));
    }
    if (aggregations?.noUpsample?.length !== 1 || aggregations?.noUpsample?.[0]?.date !== "2026-01-02") {
      addFailure(failures, "frequency-no-upsample", JSON.stringify(aggregations?.noUpsample));
    }
  } catch (error) {
    addFailure(failures, "plotted-range-json", `${String(error)} output=${result.stdout.trim()}`);
    return { route: "static:macro-chart-ranges", viewport: "node", status: result.status, failures, ranges: [] };
  }

  const expected = {
    sp500: { count: 628, min: 79.3521, max: 172.4418, first: 100, last: 169.9466, unitGroup: "level", axis: "y" },
    DGS10: { count: 625, min: 1.29, max: 4.93, first: 1.3, last: 4.75, unitGroup: "percent", axis: "y1" },
    HY_spread: { count: 785, min: 2.59, max: 4.61, first: 3.81, last: 2.63, unitGroup: "percent", axis: "y1" },
    M2SL: { count: 47, min: -4.6398, max: 5.4142, first: 2.6485, last: 5.4142, unitGroup: "percent", axis: "y1" },
  };
  const tolerance = 0.001;

  for (const [id, wanted] of Object.entries(expected)) {
    const actual = ranges.find((item) => item.id === id);
    if (!actual || actual.error) {
      addFailure(failures, "plotted-range-series", `${id}: ${actual?.error ?? "missing"}`);
      continue;
    }
    for (const field of ["count", "unitGroup", "axis"]) {
      if (actual[field] !== wanted[field]) {
        addFailure(failures, "plotted-range-contract", `${id}.${field}: expected ${wanted[field]}, got ${actual[field]}`);
      }
    }
    for (const field of ["min", "max", "first", "last"]) {
      if (!Number.isFinite(actual[field]) || Math.abs(actual[field] - wanted[field]) > tolerance) {
        addFailure(
          failures,
          "plotted-range-contract",
          `${id}.${field}: expected ${wanted[field]} ± ${tolerance}, got ${actual[field]}`,
        );
      }
    }
  }

  return { route: "static:macro-chart-ranges", viewport: "node", status: result.status, failures, ranges };
}

const results = [await inspectStaticContracts(), inspectPlottedRanges()];
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
