#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TSX_BIN = path.join(APP_ROOT, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

const REQUIRED_ROUTE_KEYS = [
  "explore",
  "market",
  "sectors",
  "etfs",
  "screener",
  "superinvestors",
  "portfolio",
  "macroChart",
  "stock",
  "etf",
  "posts",
  "multichart",
  "radar",
];

const DRIFT_SCAN_FILES = [
  "src/components/shell/AppShell.tsx",
  "src/components/DataNav.tsx",
  "src/components/AppEnhancements.tsx",
  "src/components/Navbar.tsx",
  "src/components/market/MarketSectionNav.tsx",
  "src/components/market/MarketQuickLinks.tsx",
  "src/app/sitemap.ts",
  "src/app/market/page.tsx",
  "src/app/stock/[ticker]/page.tsx",
  "src/app/etfs/[ticker]/page.tsx",
  "src/app/multichart/page.tsx",
  "src/lib/macro-chart/context.ts",
];

const PRODUCT_LITERAL_ALLOWLIST = [
  {
    file: "src/components/AppEnhancements.tsx",
    literal: "/etfs/",
    reason: "dynamic ETF detail prefix sentinel, not a navigable route literal",
  },
  {
    file: "src/components/AppEnhancements.tsx",
    literal: "/posts/",
    reason: "dynamic posts detail prefix sentinel, not a navigable route literal",
  },
];

const SYSTEM_PATH_EXEMPTIONS = [
  { prefix: "/api/", reason: "API endpoint namespace, not a product navigation route" },
  { prefix: "/data/", reason: "static data asset namespace; source_path is checked separately" },
  { prefix: "/admin/", reason: "admin/system surface, outside public product route registry" },
  { prefix: "/_next/", reason: "Next.js static runtime asset namespace" },
  { prefix: "/favicon", reason: "static browser asset" },
  { prefix: "/robots", reason: "metadata route, not product navigation" },
];

function fail(message, details = []) {
  console.error(`[qa:routes] route/key contract failed: ${message}`);
  for (const detail of details) console.error(`  - ${detail}`);
  process.exit(1);
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function importRoutes() {
  if (!fs.existsSync(TSX_BIN)) fail(`tsx binary missing: ${TSX_BIN}`);
  const probe = `
    import { APP_ROUTE_PATTERNS, ROUTES, SITEMAP_PRODUCT_ROUTES, STATIC_PRODUCT_ROUTE_PATHS } from "./src/lib/routes.ts";
    console.log(JSON.stringify({
      appRoutePatterns: APP_ROUTE_PATTERNS,
      sitemapProductRoutes: SITEMAP_PRODUCT_ROUTES,
      staticProductRoutePaths: STATIC_PRODUCT_ROUTE_PATHS,
      routes: Object.fromEntries(Object.entries(ROUTES).map(([key, value]) => [key, typeof value === "function" ? "__function__" : value])),
    }));
  `;
  const result = spawnSync(TSX_BIN, ["--eval", probe], {
    cwd: APP_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) fail("could not import src/lib/routes.ts", [result.stderr || result.stdout || "no output"]);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    fail("routes export probe returned invalid JSON", [String(error), result.stdout]);
  }
}

function routePatternPage(routePattern) {
  if (routePattern === "/") return path.join(APP_ROOT, "src", "app", "page.tsx");
  return path.join(APP_ROOT, "src", "app", ...routePattern.slice(1).split("/"), "page.tsx");
}

function collectSourcePathsFromJson(value, sink) {
  if (Array.isArray(value)) {
    for (const item of value) collectSourcePathsFromJson(item, sink);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nextValue] of Object.entries(value)) {
    if (key === "source_path" && typeof nextValue === "string") sink.add(nextValue);
    collectSourcePathsFromJson(nextValue, sink);
  }
}

function collectDeclaredSourcePaths() {
  const sourcePaths = new Set();
  const jsonPath = path.join(APP_ROOT, "public", "data", "catalog", "macro-series.json");
  collectSourcePathsFromJson(JSON.parse(fs.readFileSync(jsonPath, "utf8")), sourcePaths);

  const catalogTs = fs.readFileSync(path.join(APP_ROOT, "src", "lib", "macro-chart", "catalog.ts"), "utf8");
  const sourcePathPattern = /\bsourcePath:\s*["']([^"']+)["']/g;
  let match;
  while ((match = sourcePathPattern.exec(catalogTs))) {
    sourcePaths.add(match[1]);
  }
  return [...sourcePaths];
}

function isSystemPath(literal) {
  return SYSTEM_PATH_EXEMPTIONS.some((item) => literal.startsWith(item.prefix));
}

function isAllowlisted(file, literal) {
  return PRODUCT_LITERAL_ALLOWLIST.some((item) => item.file === file && item.literal === literal);
}

function extractStringLiterals(source) {
  const literals = [];
  const pattern = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = pattern.exec(source))) {
    literals.push(match[2]);
  }
  return literals;
}

function pathPart(literal) {
  if (!literal.startsWith("/")) return null;
  return literal.split(/[?#]/, 1)[0];
}

const routeExports = importRoutes();
const errors = [];
const routesSource = fs.readFileSync(path.join(APP_ROOT, "src", "lib", "routes.ts"), "utf8");

assert(routesSource.includes("export const ROUTES"), "src/lib/routes.ts must export ROUTES", errors);

for (const key of REQUIRED_ROUTE_KEYS) {
  assert(Boolean(routeExports.routes?.[key]), `ROUTES.${key} is missing`, errors);
}

for (const routePattern of routeExports.appRoutePatterns ?? []) {
  const pagePath = routePatternPage(routePattern);
  assert(fs.existsSync(pagePath), `${routePattern} has no matching page.tsx (${path.relative(APP_ROOT, pagePath)})`, errors);
}

for (const sourcePath of collectDeclaredSourcePaths()) {
  if (sourcePath.startsWith("stooq:")) continue;
  if (!sourcePath.startsWith("/data/")) {
    errors.push(`${sourcePath}: declared macro source path must be /data/* or stooq:*`);
    continue;
  }
  const filePath = path.join(APP_ROOT, "public", sourcePath);
  assert(fs.existsSync(filePath), `${sourcePath} points to missing public file`, errors);
}

const productPaths = new Set(routeExports.staticProductRoutePaths ?? []);
for (const file of DRIFT_SCAN_FILES) {
  const fullPath = path.join(APP_ROOT, file);
  if (!fs.existsSync(fullPath)) {
    errors.push(`${file}: drift scan target missing`);
    continue;
  }
  const source = fs.readFileSync(fullPath, "utf8");
  for (const literal of extractStringLiterals(source)) {
    const literalPath = pathPart(literal);
    if (!literalPath || isSystemPath(literalPath) || isAllowlisted(file, literalPath)) continue;
    if (productPaths.has(literalPath)) {
      errors.push(`${file}: inline product route literal ${JSON.stringify(literal)} must come from ROUTES`);
    }
  }
}

if (errors.length) fail(`${errors.length} violation(s)`, errors);

console.log(
  `[qa:routes] route/key contract OK (${routeExports.appRoutePatterns.length} app routes, ${collectDeclaredSourcePaths().length} source paths, ${DRIFT_SCAN_FILES.length} drift scopes)`,
);
