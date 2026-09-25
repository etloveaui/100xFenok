/**
 * Which URLs render inside the persistent product shell, and the chrome they
 * start with.
 *
 * The shell (rail, top bar, ticker tape, mobile app bar and tab bar) lives in
 * the root layout so it survives client navigation. The root layout cannot see
 * a page's props, so the first paint of the chrome — server render and the
 * loading state of a client navigation — uses this table. Once the page mounts,
 * its `<AppShell active title backHref …>` props replace these defaults, so a
 * page always has the final word; this table only has to be right enough that
 * nothing visibly changes when that happens.
 *
 * A route that is not listed here renders without the persistent shell. If its
 * page still renders `<AppShell>`, AppShell falls back to drawing its own chrome
 * (the pre-frame behaviour), so a missing row costs persistence, not a page.
 * `/ib` is deliberately absent: it is an immersive, chrome-less route.
 */

import type { ShellPage } from "@/components/shell/AppShell";
import { EXPLORE_PRODUCT_TITLE, WORKBENCH_PRODUCT_TITLE } from "@/lib/product-nav";
import { ROUTES } from "@/lib/routes";
import { normalizeForRouteTicker } from "@/lib/ticker";

export interface ShellRouteMeta {
  active?: ShellPage;
  title: string;
  backHref?: string;
  backLabel?: string;
}

type ShellRouteRule = {
  pattern: RegExp;
  meta: (match: RegExpMatchArray) => ShellRouteMeta;
};

function fixed(meta: ShellRouteMeta): (match: RegExpMatchArray) => ShellRouteMeta {
  return () => meta;
}

function tickerFrom(match: RegExpMatchArray): string {
  let raw = match[1] ?? "";
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // keep the raw segment; the page reports an invalid ticker itself
  }
  return normalizeForRouteTicker(raw);
}

const SHELL_ROUTE_RULES: readonly ShellRouteRule[] = [
  { pattern: /^\/$/, meta: fixed({ active: "explore", title: EXPLORE_PRODUCT_TITLE }) },
  { pattern: /^\/explore$/, meta: fixed({ active: "explore", title: EXPLORE_PRODUCT_TITLE }) },
  { pattern: /^\/workbench$/, meta: fixed({ active: "workbench", title: WORKBENCH_PRODUCT_TITLE }) },
  { pattern: /^\/radar$/, meta: fixed({ active: "explore", title: "Market Radar", backHref: ROUTES.home }) },
  { pattern: /^\/market-valuation$/, meta: fixed({ active: "market", title: "시장", backHref: ROUTES.home }) },
  { pattern: /^\/market-valuation\/structure$/, meta: fixed({ active: "market", title: "시장 구조", backHref: ROUTES.market }) },
  { pattern: /^\/market\/events$/, meta: fixed({ active: "market", title: "시장 이벤트", backHref: ROUTES.market }) },
  { pattern: /^\/regime$/, meta: fixed({ active: "regime", title: "시황" }) },
  { pattern: /^\/sectors$/, meta: fixed({ active: "sectors", title: "섹터", backHref: ROUTES.home }) },
  { pattern: /^\/changes$/, meta: fixed({ title: "무엇이 바뀌었나", backHref: ROUTES.home }) },
  { pattern: /^\/etfs$/, meta: fixed({ active: "etfs", title: "ETF", backHref: ROUTES.home }) },
  { pattern: /^\/etfs\/new$/, meta: fixed({ active: "etfs", title: "신규 상장 ETF" }) },
  { pattern: /^\/etfs\/compare$/, meta: fixed({ active: "etfs", title: "ETF 비교", backHref: ROUTES.etfs }) },
  {
    pattern: /^\/etfs\/([^/]+)$/,
    meta: (match) => ({ active: "etfs", title: tickerFrom(match), backHref: ROUTES.etfs }),
  },
  { pattern: /^\/screener$/, meta: fixed({ active: "screener", title: "스크리너", backHref: ROUTES.home }) },
  { pattern: /^\/superinvestors$/, meta: fixed({ active: "superinvestors", title: "투자자" }) },
  { pattern: /^\/portfolio$/, meta: fixed({ active: "portfolio", title: "포트폴리오" }) },
  {
    pattern: /^\/stock\/([^/]+)$/,
    meta: (match) => {
      const symbol = tickerFrom(match);
      return { title: symbol, backHref: ROUTES.screenerTicker(symbol) };
    },
  },
  { pattern: /^\/macro-chart$/, meta: fixed({ active: "chart", title: "차트", backHref: ROUTES.home }) },
  { pattern: /^\/multichart$/, meta: fixed({ active: "chart", title: "시장 비교", backHref: ROUTES.macroChart }) },
  { pattern: /^\/research$/, meta: fixed({ active: "research", title: "리서치", backHref: ROUTES.home }) },
  { pattern: /^\/posts$/, meta: fixed({ active: "posts", title: "분석 아카이브", backHref: ROUTES.home }) },
  { pattern: /^\/posts\/.+$/, meta: fixed({ active: "posts", title: "분석 아카이브", backHref: ROUTES.posts }) },
  { pattern: /^\/alpha-scout$/, meta: fixed({ active: "alphaScout", title: "Alpha Scout", backHref: ROUTES.home }) },
  { pattern: /^\/100x\/daily-wrap$/, meta: fixed({ active: "dailyWrap", title: "100x Daily Wrap", backHref: ROUTES.home }) },
  { pattern: /^\/vr$/, meta: fixed({ active: "vr", title: "VR 전략 가이드", backHref: ROUTES.home }) },
  { pattern: /^\/infinite-buying$/, meta: fixed({ active: "ib", title: "Infinite Buying", backHref: ROUTES.home }) },
  { pattern: /^\/tools\/stock-analyzer$/, meta: fixed({ active: "stockAnalyzer", title: "종목분석", backHref: ROUTES.home }) },
  {
    pattern: /^\/tools\/stock-analyzer\/native$/,
    meta: fixed({ active: "stockAnalyzer", title: "종목분석 네이티브", backHref: ROUTES.stockAnalyzer }),
  },
  { pattern: /^\/privacy$/, meta: fixed({ title: "개인정보처리방침", backHref: ROUTES.home }) },
  { pattern: /^\/terms$/, meta: fixed({ title: "서비스 이용약관", backHref: ROUTES.home }) },
];

/** `/screener/` and `/screener` are the same page (next.config trailingSlash). */
export function normalizeShellPathname(pathname: string | null | undefined): string {
  const path = String(pathname ?? "").split(/[?#]/, 1)[0] || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/** Chrome defaults for a URL, or null when the URL is not a shell route. */
export function resolveShellRoute(pathname: string | null | undefined): ShellRouteMeta | null {
  const path = normalizeShellPathname(pathname);
  for (const rule of SHELL_ROUTE_RULES) {
    const match = path.match(rule.pattern);
    if (match) return rule.meta(match);
  }
  return null;
}
