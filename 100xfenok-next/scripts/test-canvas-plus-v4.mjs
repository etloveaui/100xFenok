import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), "utf8");
}

function exists(relativePath) {
  return fs.existsSync(path.join(appRoot, relativePath));
}

const requiredFiles = [
  "src/app/lab/canvas-plus/charts/page.tsx",
  "src/app/lab/canvas-plus/stock-chart/page.tsx",
  "src/components/canvas-plus/charts/CpPriceChart.tsx",
  "src/components/canvas-plus/charts/CpPriceChartImpl.client.tsx",
  "src/components/canvas-plus/charts/types.ts",
  "src/components/canvas-plus/CpScreenerTanstackLabClient.tsx",
];

for (const file of requiredFiles) {
  assert.ok(exists(file), `${file} must exist`);
}

const packageJson = JSON.parse(read("package.json"));
assert.ok(packageJson.dependencies?.["lightweight-charts"], "V4 must add lightweight-charts");
assert.ok(!packageJson.dependencies?.recharts, "V4 must not add Recharts");
assert.ok(!packageJson.dependencies?.echarts, "V4 must not add ECharts");

const wrapperSource = read("src/components/canvas-plus/charts/CpPriceChart.tsx");
assert.ok(wrapperSource.includes('"use client"'), "CpPriceChart wrapper must be client-only");
assert.ok(wrapperSource.includes("next/dynamic"), "CpPriceChart wrapper must use next/dynamic");
assert.ok(wrapperSource.includes("ssr: false"), "CpPriceChart wrapper must disable SSR");
assert.ok(wrapperSource.includes("CpPriceChartImpl.client"), "CpPriceChart wrapper must dynamically import the client implementation");
assert.ok(!wrapperSource.includes("lightweight-charts"), "CpPriceChart wrapper must not import lightweight-charts");

const implSource = read("src/components/canvas-plus/charts/CpPriceChartImpl.client.tsx");
assert.ok(implSource.includes('"use client"'), "CpPriceChart implementation must be client-only");
assert.ok(implSource.includes("lightweight-charts"), "CpPriceChart implementation must be the sole lightweight-charts importer");
assert.ok(implSource.includes("closest(\".canvas-plus\")"), "CpPriceChart must read tokens from closest .canvas-plus scope");
assert.ok(implSource.includes("getComputedStyle"), "CpPriceChart must map CSS tokens via getComputedStyle");
assert.ok(implSource.includes("IntersectionObserver"), "CpPriceChart must defer chart mount with IntersectionObserver");
assert.ok(implSource.includes("prefers-reduced-motion"), "CpPriceChart must respect reduced-motion");
assert.ok(implSource.includes("data-cp-price-chart-summary"), "CpPriceChart must render visible summary fallback");
assert.ok(implSource.includes("data-cp-price-chart-canvas"), "CpPriceChart must expose a chart canvas marker");
assert.ok(implSource.includes("createChart"), "CpPriceChart must create a Lightweight Charts instance");

const chartImportFiles = [];
const lightweightChartsImportPattern =
  /(?:from\s+["']lightweight-charts["']|import\(\s*["']lightweight-charts["']\s*\)|require\(\s*["']lightweight-charts["']\s*\))/;
for (const relativeRoot of ["src/app", "src/components", "src/features", "src/lib"]) {
  const root = path.join(appRoot, relativeRoot);
  if (!fs.existsSync(root)) continue;
  for (const entry of fs.readdirSync(root, { recursive: true })) {
    const full = path.join(root, entry);
    if (!fs.statSync(full).isFile() || !/\.(ts|tsx|js|jsx)$/.test(entry)) continue;
    const relativePath = path.posix.join(relativeRoot, entry);
    const source = fs.readFileSync(full, "utf8");
    if (lightweightChartsImportPattern.test(source)) chartImportFiles.push(relativePath);
  }
}
assert.deepEqual(
  chartImportFiles,
  ["src/components/canvas-plus/charts/CpPriceChartImpl.client.tsx"],
  "lightweight-charts must be imported only by CpPriceChartImpl.client.tsx",
);

const typesSource = read("src/components/canvas-plus/charts/types.ts");
for (const token of [
  'CpChartKind = "line" | "area" | "candlestick" | "sparkline"',
  'CpChartRange = "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y" | "MAX"',
  "CpChartDatum",
  "CpPriceChartProps",
]) {
  assert.ok(typesSource.includes(token), `types.ts missing ${token}`);
}

const chartsPage = read("src/app/lab/canvas-plus/charts/page.tsx");
assert.ok(chartsPage.includes("data-canvas-plus-charts"), "charts route must carry V4 marker");
for (const kind of ["line", "area", "sparkline"]) {
  assert.ok(chartsPage.includes(`kind="${kind}"`) || chartsPage.includes(`kind: "${kind}"`), `charts route must render ${kind}`);
}
assert.ok(chartsPage.includes("data-cp-chart-fallback-demo"), "charts route must include fallback state coverage");

const stockChartPage = read("src/app/lab/canvas-plus/stock-chart/page.tsx");
assert.ok(stockChartPage.includes("data-canvas-plus-stock-chart"), "stock-chart route must carry V4 marker");
assert.ok(stockChartPage.includes('kind="candlestick"') || stockChartPage.includes('kind: "candlestick"'), "stock-chart route must render candlestick");
assert.ok(stockChartPage.includes("showVolume"), "stock-chart route must cover volume");

const css = read("src/styles/canvas-plus.css");
for (const className of [
  ".cp-chart-shell",
  ".cp-chart-skeleton",
  ".cp-chart-summary",
  ".cp-chart-fallback",
]) {
  assert.ok(css.includes(className), `canvas-plus.css must define ${className}`);
}

const routeContract = read("scripts/check-route-key-contract.mjs");
assert.ok(routeContract.includes("page_route_count: 51"), "route contract page count must include V4 lab routes");
assert.ok(routeContract.includes("out_of_scope_count: 10"), "route contract must classify V4 lab routes as out of scope");

for (const testFile of ["scripts/test-canvas-plus-v1.mjs", "scripts/test-canvas-plus-v2.mjs", "scripts/test-canvas-plus-v3.mjs"]) {
  const source = read(testFile);
  assert.ok(source.includes("page_route_count: 51"), `${testFile} must expect V4 route count`);
  assert.ok(source.includes("out_of_scope_count: 10"), `${testFile} must expect V4 out-of-scope count`);
}

const routesSource = read("src/lib/routes.ts");
const sitemapSource = read("src/app/sitemap.ts");
const mobileUxSource = read("scripts/check-mobile-ux-contract.mjs");
for (const labRoute of ["/lab/canvas-plus/charts", "/lab/canvas-plus/stock-chart"]) {
  assert.ok(!routesSource.includes(labRoute), `${labRoute} must stay out of ROUTES/nav SSOT`);
  assert.ok(!sitemapSource.includes(labRoute), `${labRoute} must stay out of sitemap`);
  assert.ok(!mobileUxSource.includes(labRoute), `${labRoute} must stay out of default mobile IA QA`);
}

const tanstackClientWrapper = read("src/components/canvas-plus/CpScreenerTanstackLabClient.tsx");
assert.ok(tanstackClientWrapper.includes('"use client"'), "V3 TanStack wrapper must be client-only");
assert.ok(tanstackClientWrapper.includes("next/dynamic"), "V3 TanStack wrapper must dynamic-load TanStack lab");
assert.ok(tanstackClientWrapper.includes("ssr: false"), "V3 TanStack wrapper must disable SSR for TanStack lab");
assert.ok(tanstackClientWrapper.includes("CpScreenerTanstackLab"), "V3 TanStack wrapper must import the TanStack lab lazily");

const tanstackPage = read("src/app/lab/canvas-plus/screener-tanstack/page.tsx");
assert.ok(tanstackPage.includes("CpScreenerTanstackLabClient"), "V3 TanStack page must mount the client-only wrapper");
assert.ok(!tanstackPage.includes("import CpScreenerTanstackLab from"), "V3 TanStack page must not statically import TanStack lab");

console.log("[test-canvas-plus-v4] OK");
