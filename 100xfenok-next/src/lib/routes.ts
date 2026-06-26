import { normalizeForRouteTicker } from "@/lib/ticker";

export type ProductRoutePath = `/${string}`;

export const ROUTES = {
  home: "/",
  explore: "/explore",
  market: "/market-valuation",
  // Legacy bookmark target only; `/market` redirects to `ROUTES.market`.
  marketLegacy: "/market",
  marketStructure: "/market-valuation/structure",
  regime: "/regime",
  marketEvents: "/market/events",
  sectors: "/sectors",
  etfs: "/etfs",
  etfCompare: "/etfs/compare",
  etfNew: "/etfs/new",
  screener: "/screener",
  superinvestors: "/superinvestors",
  portfolio: "/portfolio",
  posts: "/posts",
  alphaScout: "/alpha-scout",
  ib: "/ib",
  infiniteBuying: "/infinite-buying",
  vr: "/vr",
  radar: "/radar",
  dailyWrap: "/100x/daily-wrap",
  macroChart: "/macro-chart",
  multichart: "/multichart",
  stockAnalyzer: "/tools/stock-analyzer",
  stockAnalyzerNative: "/tools/stock-analyzer/native",
  stock: (ticker: string) => `/stock/${encodeURIComponent(normalizeForRouteTicker(ticker))}`,
  stockFilings: (ticker: string) => `/stock/${encodeURIComponent(normalizeForRouteTicker(ticker))}?tab=filings`,
  etf: (ticker: string) => `/etfs/${encodeURIComponent(normalizeForRouteTicker(ticker))}`,
  screenerTicker: (ticker: string) => withQuery("/screener", { ticker: normalizeForRouteTicker(ticker) }),
  portfolioTicker: (ticker: string) => withQuery("/portfolio", { ticker: normalizeForRouteTicker(ticker) }),
  superinvestorsByTicker: (ticker: string) =>
    withQuery("/superinvestors", { tab: "by-ticker", ticker: normalizeForRouteTicker(ticker) }),
  etfCompareTickers: (tickers: readonly string[]) =>
    withQuery("/etfs/compare", { tickers: tickers.map(normalizeForRouteTicker).filter(Boolean).join(",") }),
  macroChartQuery: (query: string | URLSearchParams | Record<string, string | number | boolean | null | undefined>) =>
    withQuery("/macro-chart", query),
} as const;

export type RouteKey = keyof typeof ROUTES;

export const APP_ROUTE_PATTERNS = [
  "/",
  "/explore",
  "/market",
  "/market-valuation",
  "/market-valuation/structure",
  "/regime",
  "/market/events",
  "/sectors",
  "/etfs",
  "/etfs/[ticker]",
  "/etfs/compare",
  "/etfs/new",
  "/screener",
  "/superinvestors",
  "/portfolio",
  "/posts",
  "/alpha-scout",
  "/ib",
  "/infinite-buying",
  "/vr",
  "/radar",
  "/100x/daily-wrap",
  "/macro-chart",
  "/multichart",
  "/tools/stock-analyzer",
  "/tools/stock-analyzer/native",
  "/stock/[ticker]",
] as const satisfies readonly ProductRoutePath[];

export const STATIC_PRODUCT_ROUTE_PATHS = [
  ROUTES.home,
  ROUTES.explore,
  ROUTES.market,
  ROUTES.marketStructure,
  ROUTES.regime,
  ROUTES.marketEvents,
  ROUTES.sectors,
  ROUTES.etfs,
  ROUTES.etfCompare,
  ROUTES.etfNew,
  ROUTES.screener,
  ROUTES.superinvestors,
  ROUTES.portfolio,
  ROUTES.posts,
  ROUTES.alphaScout,
  ROUTES.ib,
  ROUTES.infiniteBuying,
  ROUTES.vr,
  ROUTES.radar,
  ROUTES.dailyWrap,
  ROUTES.macroChart,
  ROUTES.multichart,
  ROUTES.stockAnalyzer,
  ROUTES.stockAnalyzerNative,
] as const satisfies readonly ProductRoutePath[];

export const PRIMARY_PRODUCT_ROUTES = [
  ROUTES.explore,
  ROUTES.market,
  ROUTES.regime,
  ROUTES.sectors,
  ROUTES.etfs,
  ROUTES.screener,
  ROUTES.superinvestors,
  ROUTES.portfolio,
  ROUTES.macroChart,
] as const satisfies readonly ProductRoutePath[];

export const DOCK_PRODUCT_ROUTES = [
  ROUTES.home,
  ROUTES.market,
  ROUTES.alphaScout,
  ROUTES.sectors,
  ROUTES.etfs,
  "/etfs/",
  ROUTES.explore,
  ROUTES.screener,
  ROUTES.superinvestors,
  ROUTES.portfolio,
  ROUTES.posts,
  "/posts/",
  ROUTES.macroChart,
  ROUTES.multichart,
  ROUTES.radar,
  ROUTES.stockAnalyzer,
  ROUTES.stockAnalyzerNative,
  ROUTES.dailyWrap,
  ROUTES.ib,
  ROUTES.infiniteBuying,
  ROUTES.vr,
] as const satisfies readonly ProductRoutePath[];

export const SITEMAP_PRODUCT_ROUTES = [
  { path: ROUTES.home, changeFrequency: "daily", priority: 1 },
  { path: ROUTES.explore, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.market, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.marketStructure, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.regime, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.marketEvents, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.sectors, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.etfs, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.etfCompare, changeFrequency: "daily", priority: 0.75 },
  { path: ROUTES.etfNew, changeFrequency: "daily", priority: 0.7 },
  { path: ROUTES.screener, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.superinvestors, changeFrequency: "weekly", priority: 0.8 },
  { path: ROUTES.portfolio, changeFrequency: "weekly", priority: 0.7 },
  { path: ROUTES.posts, changeFrequency: "weekly", priority: 0.7 },
  { path: ROUTES.alphaScout, changeFrequency: "weekly", priority: 0.7 },
  { path: ROUTES.ib, changeFrequency: "monthly", priority: 0.7 },
  { path: ROUTES.vr, changeFrequency: "monthly", priority: 0.6 },
  { path: ROUTES.radar, changeFrequency: "daily", priority: 0.7 },
  { path: ROUTES.dailyWrap, changeFrequency: "daily", priority: 0.7 },
  { path: ROUTES.macroChart, changeFrequency: "daily", priority: 0.75 },
  { path: ROUTES.multichart, changeFrequency: "weekly", priority: 0.6 },
] as const;

export function normalizePathname(pathname: string): string {
  if (!pathname || pathname === "/") return "/";
  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function isRouteOrChild(pathname: string, route: ProductRoutePath): boolean {
  const normalized = normalizePathname(pathname);
  const target = normalizePathname(route);
  return normalized === target || normalized.startsWith(`${target}/`);
}

export function isDockRoutePath(pathname: string): boolean {
  const normalized = normalizePathname(pathname);
  return DOCK_PRODUCT_ROUTES.some((route) => {
    if (route.endsWith("/")) return normalized.startsWith(route.slice(0, -1) + "/");
    return normalized === route;
  });
}

export function withQuery(
  path: ProductRoutePath,
  query: string | URLSearchParams | Record<string, string | number | boolean | null | undefined>,
): string {
  const params =
    typeof query === "string"
      ? query.replace(/^\?/, "")
      : query instanceof URLSearchParams
        ? query.toString()
        : new URLSearchParams(
            Object.entries(query).flatMap(([key, value]) =>
              value === null || value === undefined || value === "" ? [] : [[key, String(value)]],
            ),
          ).toString();
  return params ? `${path}?${params}` : path;
}
