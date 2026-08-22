// QA Route Catalog — single SSOT for all QA test route arrays.
// Purpose: deduplicate route lists hardcoded in smoke + playwright scripts.
// Zero dependencies, plain CJS-compatible ESM. Do NOT import from src/lib/routes.ts (TS-only).

// ---- Deep-link route variants (used by playwright only) ----
export const postsDeepLinkRoute = "/posts/?path=posts/2026-02-21_tariff-ruling-comprehensive.html";
export const vrDeepLinkRoute = "/vr/?path=vr/vr-complete-system.html";
export const alphaReportDeepLinkRoute = "/alpha-scout?report=2025-08-24_100x-alpha-scout.html";
export const designLabNativeRoute = "/admin/design-lab?mode=native";
export const tabSectorsRoute = "/?tab=sectors";
export const tabLiquidityRoute = "/?tab=liquidity";
export const tabSentimentRoute = "/?tab=sentiment";

// ---- Cloudflare canonical admin redirects (source paths, no trailing slash) ----
// This list is the only source for the generated block in public/_redirects.
export const ADMIN_CANONICAL_REDIRECT_ROUTES = [
  "/admin",
  "/admin/data-lab",
  "/admin/design-gallery",
  "/admin/design-lab",
  "/admin/design-lab/cp-kit",
  "/admin/live",
  "/admin/macro-monitor",
  "/admin/market-radar",
  "/admin/valuation-lab",
  "/admin/personal",
  "/admin/personal/travel",
  "/admin/ib-helper",
];

// ---- Smoke test page routes (stockanalysis API surface) ----
export const SMOKE_PAGE_ROUTES = [
  "/explore",
  "/etfs",
  "/etfs?type=leveraged",
  "/etfs?type=single-stock",
  "/etfs?type=inverse",
  "/etfs?new=1",
  "/etfs?digital=1",
  "/etfs?asset=Equity&issuer=Vanguard&aum=large&fee=low",
  "/etfs/new",
  "/etfs/new?type=single-stock&days=14&sort=change",
  "/etfs/IEFA",
  "/etfs/SQQQ",
  "/etfs/TSLL",
  "/etfs/ADIU",
  "/admin/data-lab/",
  "/sectors",
  "/market/events",
  "/market/events?section=IPO%20%EC%8B%A0%EC%B2%AD&range=30&sort=section",
];

// ---- Smoke test fatal markers (load error signatures) ----
export const FATAL_MARKERS = [
  "예상치 못한 오류",
  "일시적인 내부 오류",
  "asOfDate is not a function",
  "stocks_analyzer.json에 존재하지 않는 티커",
];

// ---- Playwright default routes (comprehensive crawl set) ----
export const PLAYWRIGHT_ROUTES = [
  "/",
  tabSectorsRoute,
  tabLiquidityRoute,
  tabSentimentRoute,
  "/market",
  "/alpha-scout",
  alphaReportDeepLinkRoute,
  "/multichart",
  "/radar",
  "/ib",
  "/infinite-buying",
  "/vr",
  vrDeepLinkRoute,
  "/posts",
  postsDeepLinkRoute,
  "/explore",
  "/screener",
  "/stock/NVDA",
  "/market-valuation",
  "/sectors",
  "/etfs",
  "/etfs?type=single-stock",
  "/etfs/new",
  "/etfs/SPY",
  "/etfs/ADIU",
  "/market/events",
  "/100x/daily-wrap",
  ...ADMIN_CANONICAL_REDIRECT_ROUTES,
  designLabNativeRoute,
  "/tools/stock-analyzer",
  "/tools/stock-analyzer/native",
  "/this-route-should-not-exist",
];

// ---- P2 data-state route subset (used by playwright p2-browser mode) ----
export const P2_DATA_STATE_ROUTES = [
  "/explore",
  "/screener",
  "/stock/NVDA",
  "/stock/ZZZZ",
  "/market-valuation",
  "/sectors",
];

// ---- Negative test routes (expected to exist but return empty/error) ----
export const NEGATIVE_ROUTES = [
  "/stock/ZZZZ",
  "/this-route-should-not-exist",
];

// ---- Expected iframe-embed routes (playwright inner-shell checks) ----
export const EXPECTED_IFRAME_ROUTES = new Set([
  "/ib",
  "/infinite-buying",
  vrDeepLinkRoute,
  postsDeepLinkRoute,
  alphaReportDeepLinkRoute,
  "/admin/design-lab",
  "/admin/data-lab",
  "/admin/macro-monitor",
  "/admin/market-radar",
  "/admin/valuation-lab",
  "/admin/ib-helper",
  "/tools/stock-analyzer",
]);

// ---- Expected inner-shell clean routes (no v5 chrome wrapping) ----
export const EXPECTED_INNER_SHELL_CLEAN_ROUTES = new Set([
  vrDeepLinkRoute,
]);

// ---- Expected iframe src map (route -> embed target path) ----
export const EXPECTED_IFRAME_SRC_BY_ROUTE = {
  [alphaReportDeepLinkRoute]: "/alpha-scout/reports/2025-08-24_100x-alpha-scout.html",
  [postsDeepLinkRoute]: "/posts-raw/2026-02-21_tariff-ruling-comprehensive.html",
  [vrDeepLinkRoute]: "/vr/vr-complete-system.html",
  "/ib": "/ib/ib-helper/index.html",
  "/admin/design-lab": "/admin/design-lab/index.html",
  "/admin/data-lab": "/admin/data-lab/index.html",
  "/admin/macro-monitor": "/admin/market-radar/index.html",
  "/admin/market-radar": "/admin/market-radar/index.html",
  "/admin/valuation-lab": "/admin/valuation-lab/index.html",
  "/admin/ib-helper": "/ib/ib-helper/index.html",
  "/tools/stock-analyzer": "/tools/stock_analyzer/stock_analyzer.html",
};
