import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const requiredFiles = [
  "src/app/lab/canvas-plus/screener-native/page.tsx",
  "src/app/lab/canvas-plus/screener-tanstack/page.tsx",
  "src/components/canvas-plus/CpScreenerLabModel.ts",
  "src/components/canvas-plus/CpScreenerNativeLab.tsx",
  "src/components/canvas-plus/CpScreenerTanstackLab.tsx",
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(appRoot, file)), `${file} must exist`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
assert.ok(packageJson.dependencies?.["@tanstack/react-table"], "V3 TanStack POC must add @tanstack/react-table");

const modelSource = fs.readFileSync(path.join(appRoot, "src/components/canvas-plus/CpScreenerLabModel.ts"), "utf8");
assert.ok(modelSource.includes("CP_SCREENER_ROW_TARGET = 1173"), "V3 fixture target must be 1173 rows");
assert.ok(modelSource.includes("CP_SCREENER_DENSITY_ROWS"), "V3 must expose desktop row density modes");
for (const rowHeight of ["compact: 32", "default: 40", "comfy: 48"]) {
  assert.ok(modelSource.includes(rowHeight), `V3 row density missing ${rowHeight}`);
}

const nativeSource = fs.readFileSync(path.join(appRoot, "src/components/canvas-plus/CpScreenerNativeLab.tsx"), "utf8");
assert.ok(!nativeSource.includes("@tanstack/react-table"), "native enhanced option must not import TanStack");
assert.ok(nativeSource.includes("data-canvas-plus-screener-native"), "native route must carry native marker");
assert.ok(nativeSource.includes("data-numeric-tabular-ratio"), "native route must expose numeric tabular ratio");

const tanstackSource = fs.readFileSync(path.join(appRoot, "src/components/canvas-plus/CpScreenerTanstackLab.tsx"), "utf8");
for (const token of ["@tanstack/react-table", "useReactTable", "getCoreRowModel", "getSortedRowModel"]) {
  assert.ok(tanstackSource.includes(token), `TanStack route missing ${token}`);
}
assert.ok(tanstackSource.includes("data-canvas-plus-screener-tanstack"), "TanStack route must carry TanStack marker");
assert.ok(tanstackSource.includes("data-numeric-tabular-ratio"), "TanStack route must expose numeric tabular ratio");

const css = fs.readFileSync(path.join(appRoot, "src/styles/canvas-plus.css"), "utf8");
for (const className of [
  ".cp-screener-lab",
  ".cp-screener-table",
  ".cp-screener-card",
  ".cp-screener-num",
]) {
  assert.ok(css.includes(className), `canvas-plus.css must define ${className}`);
}
assert.ok(css.includes("font-variant-numeric: tabular-nums"), "numeric cells must use tabular nums");
const mobileCardMinHeight = css.match(/\.cp-screener-card\s*\{[\s\S]*?min-height:\s*(\d+)px;/)?.[1];
assert.ok(mobileCardMinHeight, "mobile card min-height must be declared");
assert.ok(Number(mobileCardMinHeight) >= 320 && Number(mobileCardMinHeight) <= 420, "mobile card target height must stay 320-420px");

const routeContract = fs.readFileSync(path.join(appRoot, "scripts/check-route-key-contract.mjs"), "utf8");
assert.ok(routeContract.includes("page_route_count: 51"), "route contract page count must include V3 lab routes");
assert.ok(routeContract.includes("out_of_scope_count: 10"), "route contract must classify V3 lab routes as out of scope");

const routesSource = fs.readFileSync(path.join(appRoot, "src/lib/routes.ts"), "utf8");
const sitemapSource = fs.readFileSync(path.join(appRoot, "src/app/sitemap.ts"), "utf8");
const mobileUxSource = fs.readFileSync(path.join(appRoot, "scripts/check-mobile-ux-contract.mjs"), "utf8");
for (const labRoute of ["/lab/canvas-plus/screener-native", "/lab/canvas-plus/screener-tanstack"]) {
  assert.ok(!routesSource.includes(labRoute), `${labRoute} must stay out of ROUTES/nav SSOT`);
  assert.ok(!sitemapSource.includes(labRoute), `${labRoute} must stay out of sitemap`);
  assert.ok(!mobileUxSource.includes(labRoute), `${labRoute} must stay out of default mobile IA QA`);
}

console.log("[test-canvas-plus-v3] OK");
