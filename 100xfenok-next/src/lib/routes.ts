import { normalizeForRouteTicker } from "@/lib/ticker";

export type ProductRoutePath = `/${string}`;

export const ROUTES = {
  home: "/",
  explore: "/explore",
  workbench: "/workbench",
  // Legacy alias only. It redirects to home and must not appear as a separate nav/sitemap product.
  briefing: "/briefing",
  market: "/market-valuation",
  // Legacy bookmark target only; `/market` redirects to `ROUTES.market`.
  marketLegacy: "/market",
  marketStructure: "/market-valuation/structure",
  regime: "/regime",
  marketEvents: "/market/events",
  changes: "/changes",
  sectors: "/sectors",
  /** Static JSON evidence backing the sectors rotation rails (not a product route). */
  sectorMomentumJson: "/data/benchmarks/summaries.json",
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
  dataConsole: "/admin/data-console",
  stockAnalyzer: "/tools/stock-analyzer",
  stockAnalyzerNative: "/tools/stock-analyzer/native",
  stock: (ticker: string) => `/stock/${encodeURIComponent(normalizeForRouteTicker(ticker))}`,
  stockFilings: (ticker: string) => `/stock/${encodeURIComponent(normalizeForRouteTicker(ticker))}?tab=filings`,
  etf: (ticker: string) => `/etfs/${encodeURIComponent(normalizeForRouteTicker(ticker))}`,
  screenerTicker: (ticker: string) => withQuery("/screener", { ticker: normalizeForRouteTicker(ticker) }),
  portfolioTicker: (ticker: string) => withQuery("/portfolio", { ticker: normalizeForRouteTicker(ticker) }),
  superinvestorsByTicker: (ticker: string) =>
    withQuery("/superinvestors", { tab: "by-ticker", ticker: normalizeForRouteTicker(ticker) }),
  superinvestorsGuru: (guru: string) =>
    withQuery("/superinvestors", { tab: "gurus", guru: String(guru ?? "").trim() }),
  etfCompareTickers: (tickers: readonly string[]) =>
    withQuery("/etfs/compare", { tickers: tickers.map(normalizeForRouteTicker).filter(Boolean).join(",") }),
  macroChartQuery: (query: string | URLSearchParams | Record<string, string | number | boolean | null | undefined>) =>
    withQuery("/macro-chart", query),
} as const;

export type RouteKey = keyof typeof ROUTES;

export const APP_ROUTE_PATTERNS = [
  "/",
  "/explore",
  "/workbench",
  "/briefing",
  "/market",
  "/market-valuation",
  "/market-valuation/structure",
  "/regime",
  "/market/events",
  "/changes",
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
  ROUTES.workbench,
  ROUTES.market,
  ROUTES.marketStructure,
  ROUTES.regime,
  ROUTES.marketEvents,
  ROUTES.changes,
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

/**
 * Why a product route is deliberately absent from the sitemap.
 *
 * Every string path in `ROUTES` must be either in `SITEMAP_PRODUCT_ROUTES` or
 * here — `test-sitemap-coverage.mjs` fails the build otherwise. Before this
 * existed, five routes were missing from the sitemap and nothing anywhere said
 * whether that was a decision or an oversight; two carried a reason in a code
 * comment that no check could read, and three carried none at all.
 *
 * A reason of `retired` is a real state, not a placeholder to be ignored: it
 * means the route implementation remains preserved for the authenticated
 * archive while the public root is no longer promoted or indexed.
 */
export const SITEMAP_EXCLUSIONS: Partial<Record<RouteKey, string>> = {
  sectorMomentumJson: "Static JSON evidence asset behind the sectors rotation rails; not a product route, never indexed or linked from public surfaces.",
  dataConsole: "admin-only — behind AdminAccessGate; never indexed or linked from public surfaces.",
  briefing: "Legacy alias. Redirects to home (307 verified live 2026-08-23) and must not appear as a separate product.",
  marketLegacy: "Legacy bookmark target. Redirects to ROUTES.market — verified live 2026-08-23, though as a 200 with a meta refresh rather than the 308 the source requests; see BACKLOG B-404.",
  infiniteBuying: "undecided — serves 200 live and is reachable, but nobody has chosen whether it should be indexed. See BACKLOG B-403.",
  explore: "retired — compatibility alias preserved for the authenticated archive; the public root is Home.",
  workbench: "retired — implementation preserved for the authenticated archive and removed from public discovery.",
  posts: "retired — archive implementation and historical permalinks are preserved without public root promotion.",
  alphaScout: "retired — report HTML and JSON assets are preserved without public root promotion.",
  dailyWrap: "retired — dated reports, viewer, and data assets are preserved without public root promotion.",
  stockAnalyzer: "retired — legacy analyzer implementation and shared data are preserved without public root promotion.",
  stockAnalyzerNative: "retired — native preview implementation and shared data are preserved without public root promotion.",
};

export const SITEMAP_PRODUCT_ROUTES = [
  { path: ROUTES.home, changeFrequency: "daily", priority: 1 },
  { path: ROUTES.market, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.marketStructure, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.regime, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.marketEvents, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.changes, changeFrequency: "weekly", priority: 0.7 },
  { path: ROUTES.sectors, changeFrequency: "daily", priority: 0.8 },
  { path: ROUTES.etfs, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.etfCompare, changeFrequency: "daily", priority: 0.75 },
  { path: ROUTES.etfNew, changeFrequency: "daily", priority: 0.7 },
  { path: ROUTES.screener, changeFrequency: "daily", priority: 0.9 },
  { path: ROUTES.superinvestors, changeFrequency: "weekly", priority: 0.8 },
  { path: ROUTES.portfolio, changeFrequency: "weekly", priority: 0.7 },
  { path: ROUTES.ib, changeFrequency: "monthly", priority: 0.7 },
  { path: ROUTES.vr, changeFrequency: "monthly", priority: 0.6 },
  { path: ROUTES.radar, changeFrequency: "daily", priority: 0.7 },
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
