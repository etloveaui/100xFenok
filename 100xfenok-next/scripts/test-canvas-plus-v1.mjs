import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const appRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

const requiredFiles = [
  "src/styles/canvas-plus.css",
  "src/components/canvas-plus/CpCard.tsx",
  "src/components/canvas-plus/CpButton.tsx",
  "src/components/canvas-plus/CpBadge.tsx",
  "src/components/canvas-plus/CpTabs.tsx",
  "src/app/lab/canvas-plus/ui-system/page.tsx",
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(appRoot, file)), `${file} must exist`);
}

const css = fs.readFileSync(path.join(appRoot, "src/styles/canvas-plus.css"), "utf8");
assert.ok(!css.includes(":root"), "CANVAS+ tokens must not be declared globally under :root");
assert.match(css, /\.canvas-plus\s*\{/, "CANVAS+ tokens must be scoped to .canvas-plus");

const expectedTokens = {
  "--cp-bg": "#f7f8fb",
  "--cp-surface": "#ffffff",
  "--cp-surface-muted": "#f2f5f8",
  "--cp-surface-strong": "#e9eef4",
  "--cp-border": "#d9e1ea",
  "--cp-border-strong": "#bec9d6",
  "--cp-divider": "#e6ebf2",
  "--cp-text": "#111827",
  "--cp-text-strong": "#0f172a",
  "--cp-text-muted": "#637083",
  "--cp-text-soft": "#8a94a6",
  "--cp-accent": "#2684ff",
  "--cp-accent-strong": "#1b6bff",
  "--cp-accent-soft": "rgba(38, 132, 255, 0.12)",
  "--cp-focus-ring": "rgba(38, 132, 255, 0.24)",
  "--cp-positive": "#0f8f53",
  "--cp-positive-soft": "rgba(15, 143, 83, 0.12)",
  "--cp-negative": "#e05a3a",
  "--cp-negative-soft": "rgba(224, 90, 58, 0.12)",
  "--cp-warning": "#c88912",
  "--cp-warning-soft": "rgba(200, 137, 18, 0.12)",
  "--cp-neutral": "#64748b",
  "--cp-chart-bg": "#ffffff",
  "--cp-chart-grid": "#e5ebf2",
  "--cp-chart-axis": "#8792a2",
  "--cp-chart-crosshair": "#758696",
  "--cp-chart-line-1": "#1f78ff",
  "--cp-chart-line-2": "#7a3ff2",
  "--cp-chart-line-3": "#ff6a2b",
  "--cp-chart-positive-line": "#10a35a",
  "--cp-chart-negative-line": "#e05a3a",
  "--cp-radius-sm": "8px",
  "--cp-radius-md": "12px",
  "--cp-radius-lg": "16px",
  "--cp-radius-xl": "20px",
  "--cp-row-compact": "32px",
  "--cp-row-default": "40px",
  "--cp-row-comfy": "48px",
  "--cp-toolbar-height": "44px",
  "--cp-input-height": "40px",
  "--cp-tab-height": "36px",
};

for (const [token, value] of Object.entries(expectedTokens)) {
  assert.match(css, new RegExp(`${token}: ${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};`), `${token} must match blueprint value`);
}

const page = fs.readFileSync(path.join(appRoot, "src/app/lab/canvas-plus/ui-system/page.tsx"), "utf8");
assert.ok(page.includes("data-canvas-plus"), "ui-system route must carry the CANVAS+ scope marker");
for (const density of ["compact", "default", "comfy"]) {
  assert.ok(page.includes(`density="${density}"`) || page.includes(`density: "${density}"`), `ui-system route must render ${density} density`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
assert.ok(!Object.keys(packageJson.dependencies ?? {}).some((name) => /radix|shadcn|motion|recharts|echarts/i.test(name)), "V1 must not add new UI/chart dependencies");

const routeContract = fs.readFileSync(path.join(appRoot, "scripts/check-route-key-contract.mjs"), "utf8");
assert.ok(routeContract.includes("page_route_count: 45"), "route contract page count must include the lab route");
assert.ok(routeContract.includes("out_of_scope_count: 4"), "route contract must classify the lab route as out of scope");

const allowlistGenerator = fs.readFileSync(path.join(appRoot, "scripts/generate-raw-color-allowlist.mjs"), "utf8");
assert.ok(allowlistGenerator.includes('"src/styles/canvas-plus.css"'), "raw color allowlist generator must classify canvas-plus.css");

const rawColorAllowlist = JSON.parse(fs.readFileSync(path.join(appRoot, "scripts/raw-color-allowlist.json"), "utf8"));
assert.equal(rawColorAllowlist.file_categories?.["src/styles/canvas-plus.css"]?.category, "token-source");
assert.equal(rawColorAllowlist.files?.["src/styles/canvas-plus.css"]?.["#f7f8fb"], 1);
assert.equal(rawColorAllowlist.files?.["src/styles/canvas-plus.css"]?.["rgba(15, 23, 42, 0.04)"], 2);

console.log("[test-canvas-plus-v1] OK");
