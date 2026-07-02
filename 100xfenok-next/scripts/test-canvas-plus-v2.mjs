import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const requiredFiles = [
  "src/app/lab/canvas-plus/home/page.tsx",
  "src/app/lab/canvas-plus/stock/page.tsx",
  "src/components/canvas-plus/CpHeroSearch.tsx",
  "src/components/canvas-plus/CpFeatureTile.tsx",
  "src/components/canvas-plus/CpValuationBand.tsx",
  "src/components/canvas-plus/CpInsightCard.tsx",
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(appRoot, file)), `${file} must exist`);
}

const css = fs.readFileSync(path.join(appRoot, "src/styles/canvas-plus.css"), "utf8");
for (const className of [
  ".cp-hero-search",
  ".cp-feature-tile",
  ".cp-valuation-band",
  ".cp-insight-card",
]) {
  assert.ok(css.includes(className), `canvas-plus.css must define ${className}`);
}
assert.ok(!css.includes(":root"), "CANVAS+ tokens must not be declared globally under :root");

const homePage = fs.readFileSync(path.join(appRoot, "src/app/lab/canvas-plus/home/page.tsx"), "utf8");
assert.ok(homePage.includes("data-canvas-plus"), "home POC route must carry the CANVAS+ scope marker");
assert.ok(homePage.includes("data-canvas-plus-home"), "home POC route must carry the home marker");
assert.ok(homePage.includes("CpHeroSearch"), "home POC must render CpHeroSearch");
const homeRenderSource = homePage.slice(homePage.indexOf("return ("));
assert.ok(homeRenderSource.indexOf("CpHeroSearch") < homeRenderSource.indexOf("CpFeatureTile"), "home POC must be search-first before feature tiles");

const stockPage = fs.readFileSync(path.join(appRoot, "src/app/lab/canvas-plus/stock/page.tsx"), "utf8");
assert.ok(stockPage.includes("data-canvas-plus"), "stock POC route must carry the CANVAS+ scope marker");
assert.ok(stockPage.includes("data-canvas-plus-stock"), "stock POC route must carry the stock marker");
const stockOrder = [
  'data-stock-section="summary"',
  'data-stock-section="valuation"',
  'data-stock-section="signals"',
  'data-stock-section="financials"',
];
for (const marker of stockOrder) {
  assert.ok(stockPage.includes(marker), `stock POC must include ${marker}`);
}
for (let index = 0; index < stockOrder.length - 1; index += 1) {
  assert.ok(
    stockPage.indexOf(stockOrder[index]) < stockPage.indexOf(stockOrder[index + 1]),
    `stock POC order must keep ${stockOrder[index]} before ${stockOrder[index + 1]}`,
  );
}

const routeContract = fs.readFileSync(path.join(appRoot, "scripts/check-route-key-contract.mjs"), "utf8");
assert.ok(routeContract.includes("page_route_count: 51"), "route contract page count must include V2 lab routes");
assert.ok(routeContract.includes("out_of_scope_count: 10"), "route contract must classify V2 lab routes as out of scope");

const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const forbiddenDependencies = ["@radix-ui", "shadcn", "motion", "recharts", "echarts"];
for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
  assert.ok(
    !forbiddenDependencies.some((needle) => dependencyName.toLowerCase().includes(needle)),
    `V2 must not add forbidden dependency ${dependencyName}`,
  );
}

console.log("[test-canvas-plus-v2] OK");
