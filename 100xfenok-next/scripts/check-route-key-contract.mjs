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

function collectComponentFiles(rootDir, relativeRoot) {
  const results = [];
  const dir = path.join(APP_ROOT, relativeRoot);
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isFile() && entry.endsWith(".tsx")) {
      results.push(path.posix.join(relativeRoot, entry));
    }
  }
  return results;
}

const DRIFT_SCAN_FILES = [
  ...collectComponentFiles("src/app", "src/app"),
  ...collectComponentFiles("src/components", "src/components"),
  "src/app/sitemap.ts",
  "src/lib/macro-chart/context.ts",
];

const PRODUCT_LITERAL_ALLOWLIST = [
  // Home route — system component usage
  { file: "src/app/error.tsx", literal: "/", reason: "error boundary home link" },
  { file: "src/app/not-found.tsx", literal: "/", reason: "404 page home link" },
  { file: "src/app/admin/[...slug]/page.tsx", literal: "/", reason: "admin catch-all home link" },
  { file: "src/app/admin/personal/travel/page.tsx", literal: "/", reason: "travel page home link" },
  { file: "src/components/AdminAccessGate.tsx", literal: "/", reason: "admin gate home redirect" },
  { file: "src/components/AdminSessionControl.tsx", literal: "/", reason: "admin session home redirect" },
  { file: "src/components/footer/FooterMainBar.tsx", literal: "/", reason: "footer home link" },
  { file: "src/components/TransitionLink.tsx", literal: "/", reason: "TransitionLink base component default" },
  { file: "src/components/wrap/v2/Navbar.tsx", literal: "/", reason: "design-studio preview nav home link" },

  // Dashboard cards — radar deep-link query sentinels
  { file: "src/components/dashboard/BankingHealthCard.tsx", literal: "/radar", reason: "radar deep-link query sentinel (banking-health), not a bare nav route" },
  { file: "src/components/dashboard/LiquidityCard.tsx", literal: "/radar", reason: "radar deep-link query sentinel (liquidity-flow), not a bare nav route" },
  { file: "src/components/dashboard/RiskAppetiteCard.tsx", literal: "/radar", reason: "radar deep-link query sentinel (sentiment-signal), not a bare nav route" },
  { file: "src/components/dashboard/StressMonitorCard.tsx", literal: "/radar", reason: "radar deep-link query sentinel (liquidity-stress), not a bare nav route" },
  { file: "src/components/dashboard/HomeBentoGrid.tsx", literal: "/radar", reason: "radar deep-link query sentinel (sentiment-signal + liquidity-flow + banking-health), not a bare nav route" },

  // Design-studio preview files — excluded from SSOT enforcement
  { file: "src/components/HomeDesignPreview.tsx", literal: "/", reason: "design-studio preview, excluded from route SSOT" },
  { file: "src/components/HomeDesignPreview.tsx", literal: "/market-valuation", reason: "design-studio preview, excluded from route SSOT" },
  { file: "src/components/HomeDesignPreview.tsx", literal: "/sectors", reason: "design-studio preview, excluded from route SSOT" },
  { file: "src/components/HomeDesignPreview.tsx", literal: "/ib", reason: "design-studio preview, excluded from route SSOT" },
  { file: "src/components/HomeDesignPreview.tsx", literal: "/vr", reason: "design-studio preview, excluded from route SSOT" },

  // Design version toggle query params
  { file: "src/components/chrome/v2/NavbarV2.tsx", literal: "/", reason: "design-version toggle (/?v2=1), all hrefs point to home with query param" },
  { file: "src/components/chrome/v3/NavbarV3.tsx", literal: "/", reason: "design-version toggle (/?v3=1), all hrefs point to home with query param" },

  // Design-studio wrap components — excluded from SSOT enforcement
  { file: "src/components/wrap/v2/Navbar.tsx", literal: "/alpha-scout", reason: "design-studio wrap preview nav, excluded from route SSOT" },
  { file: "src/components/wrap/v2/Navbar.tsx", literal: "/ib", reason: "design-studio wrap preview nav, excluded from route SSOT" },
  { file: "src/components/wrap/v2/MarketWrapV2.tsx", literal: "/100x/daily-wrap", reason: "design-studio wrap preview nav, excluded from route SSOT" },

  // Macro chart deep-link with query params — context-dependent hrefs
  { file: "src/app/explore/MacroPlaybookCard.tsx", literal: "/macro-chart", reason: "macro-chart deep-link with complex query params, context-dependent href" },
  { file: "src/app/macro-chart/MacroChartClient.tsx", literal: "/market-valuation/structure", reason: "macro-chart cross-link with dynamic query params" },
  { file: "src/app/macro-chart/MacroChartClient.tsx", literal: "/market/events", reason: "macro-chart cross-link with dynamic query params" },
  { file: "src/app/macro-chart/MacroChartClient.tsx", literal: "/portfolio", reason: "macro-chart cross-link with dynamic query params" },
  { file: "src/app/macro-chart/page.tsx", literal: "/explore", reason: "macro-chart back-link to explore, context-dependent" },

  // Legacy embed route links — served via RouteEmbedFrame, not standard nav
  { file: "src/app/vr/page.tsx", literal: "/vr", reason: "VR route with legacy embed path query param, not a standard nav literal" },

  // Dynamic sentinel prefixes (existing allowlist)
  { file: "src/components/AppEnhancements.tsx", literal: "/etfs/", reason: "dynamic ETF detail prefix sentinel, not a navigable route literal" },
  { file: "src/components/AppEnhancements.tsx", literal: "/posts/", reason: "dynamic posts detail prefix sentinel, not a navigable route literal" },

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
  return PRODUCT_LITERAL_ALLOWLIST.some((item) => (item.file === "*" || item.file === file) && item.literal === literal);
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

function readAppSource(relativePath) {
  return fs.readFileSync(path.join(APP_ROOT, relativePath), "utf8");
}

function assertSourceTokens(source, tokens, label, errors) {
  for (const token of tokens) {
    assert(source.includes(token), `${label}: missing ${token}`, errors);
  }
}

function assertRouteIaContracts(errors) {
  const productNavSource = readAppSource("src/lib/product-nav.ts");
  const shellSource = readAppSource("src/components/shell/AppShell.tsx");
  const homeRouteSource = readAppSource("src/app/page.tsx");
  const homeV1Source = readAppSource("src/app/HomeV1Client.tsx");
  const homeV5Source = readAppSource("src/app/HomeV5Client.tsx");
  const workbenchSource = readAppSource("src/components/workbench/WorkbenchView.tsx");
  const explorePageSource = readAppSource("src/app/explore/page.tsx");
  const workbenchPageSource = readAppSource("src/app/workbench/page.tsx");

  assertSourceTokens(productNavSource, [
    "EXPLORE_ROUTE = ROUTES.home",
    'EXPLORE_NAV_LABEL = "홈"',
    'EXPLORE_PRODUCT_TITLE = "홈"',
    "WORKBENCH_ROUTE = ROUTES.workbench",
    'WORKBENCH_NAV_LABEL = "워크벤치"',
    'WORKBENCH_PRODUCT_TITLE = "워크벤치"',
    "CHART_ROUTE = ROUTES.macroChart",
    'CHART_NAV_LABEL = "차트"',
  ], "product-nav PRO IA", errors);

  assertSourceTokens(shellSource, [
    'id: "explore"',
    'label: EXPLORE_NAV_LABEL',
    "href: EXPLORE_ROUTE",
    'id: "workbench"',
    'group: "더보기"',
    "href: ROUTES.workbench",
    'label: WORKBENCH_NAV_LABEL',
    'id: "chart"',
    "href: CHART_ROUTE",
    "label: CHART_NAV_LABEL",
    'const PRIMARY_TAB_IDS: MobileTabId[] = ["explore", "market", "screener", "portfolio", "more"]',
    "const MORE_TAB_IDS: ShellPage[] = [",
    '"chart"',
    '"workbench"',
    '"sectors"',
    '"etfs"',
    '"superinvestors"',
  ], "AppShell PRO IA", errors);

  assert(
    !shellSource.includes('const PRIMARY_TAB_IDS: MobileTabId[] = ["explore", "market", "chart", "screener", "more"]'),
    "AppShell PRO IA: chart must stay out of the mobile primary tab bar",
    errors,
  );

  assertSourceTokens(homeRouteSource, [
    "HomeV5Client",
    "HomeV1Client",
  ], "home route PRO IA", errors);
  assert(!homeRouteSource.includes("WorkbenchView"), "home route PRO IA: root must not render WorkbenchView directly", errors);

  assertSourceTokens(homeV1Source, [
    "data-home-search-first",
    "data-home-feature-tile",
  ], "Home V1 PRO IA", errors);
  assertSourceTokens(homeV5Source, [
    "data-home-search-first",
    "data-home-feature-tile",
  ], "Home V5 PRO IA", errors);

  assertSourceTokens(workbenchSource, [
    '<AppShell active="workbench"',
    "data-workbench-gateway",
    "WORKBENCH_GATEWAY_LINKS",
  ], "Workbench PRO IA", errors);
  assertSourceTokens(explorePageSource, [
    "WorkbenchView",
  ], "Explore compatibility route", errors);
  assertSourceTokens(workbenchPageSource, [
    "WorkbenchView",
  ], "Workbench route", errors);
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

assertRouteIaContracts(errors);

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
