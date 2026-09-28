import { isSafeSlugSegments } from "@/lib/admin-legacy-candidates";

export type RetiredPublicRoute = {
  source: string;
  destination: string;
};

export type RetiredPublicSurface = {
  id: string;
  title: string;
  badge: string;
  description: string;
  href: string;
  routes: readonly RetiredPublicRoute[];
};

export const RETIRED_PUBLIC_SURFACES = [
  {
    id: "stock-analyzer",
    title: "Stock Analyzer",
    badge: "TOOLS",
    description: "레거시 종목 분석 도구와 네이티브 미리보기를 보관합니다.",
    href: "/tools/stock-analyzer",
    routes: [
      { source: "/tools/stock-analyzer", destination: "/screener" },
      { source: "/tools/stock-analyzer/native", destination: "/screener" },
    ],
  },
  {
    id: "alpha-scout",
    title: "Alpha Scout",
    badge: "RESEARCH",
    description: "알파 스카우트 리서치 리포트와 원본 자산을 보관합니다.",
    href: "/alpha-scout",
    routes: [{ source: "/alpha-scout", destination: "/" }],
  },
  {
    id: "posts",
    title: "Posts",
    badge: "ARCHIVE",
    description: "시장 분석 포스트와 역사적 퍼머링크를 보관합니다.",
    href: "/posts",
    routes: [{ source: "/posts", destination: "/" }],
  },
  {
    id: "daily-wrap",
    title: "Daily Wrap",
    badge: "MARKET",
    description: "데일리 마켓 브리핑과 날짜별 리포트를 보관합니다.",
    href: "/100x/daily-wrap",
    routes: [{ source: "/100x/daily-wrap", destination: "/" }],
  },
  {
    id: "workbench",
    title: "Workbench",
    badge: "DASHBOARD",
    description: "워크벤치 대시보드와 Explore 호환 경로를 보관합니다.",
    href: "/workbench",
    routes: [
      { source: "/workbench", destination: "/" },
      { source: "/explore", destination: "/" },
    ],
  },
] as const satisfies readonly RetiredPublicSurface[];

const RETIRED_PUBLIC_DESTINATIONS = new Map<string, string>(
  RETIRED_PUBLIC_SURFACES.flatMap((surface) =>
    surface.routes.map(({ source, destination }) => [source, destination] as const),
  ),
);

function normalizeRetiredPublicPath(pathname: string): string {
  if (pathname === "/") return pathname;
  return pathname.replace(/\/+$/, "") || "/";
}

export function getRetiredPublicDestination(pathname: string): string | null {
  return RETIRED_PUBLIC_DESTINATIONS.get(normalizeRetiredPublicPath(pathname)) ?? null;
}

function decodeSearchValue(value: string | null): string | null {
  if (!value) return null;

  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function stripLegacyPathSuffix(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const suffixIndex =
    queryIndex === -1
      ? hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex);

  return suffixIndex === -1 ? value : value.slice(0, suffixIndex);
}

function isSafeRetiredPath(value: string | null, prefix: string): boolean {
  const decoded = decodeSearchValue(value);
  if (decoded === null) return false;

  const normalized = stripLegacyPathSuffix(decoded).trim().replace(/^\/+/, "");
  if (!normalized.startsWith(prefix) || !normalized.endsWith(".html")) return false;

  return isSafeSlugSegments(normalized.split("/"));
}

function isSafeAlphaReport(value: string | null): boolean {
  const decoded = decodeSearchValue(value);
  if (decoded === null) return false;

  const normalized = decoded.trim();
  if (!/^[A-Za-z0-9._-]+\.html$/.test(normalized)) return false;
  return !normalized.startsWith(".") && !normalized.includes("..");
}

/**
 * Whether an exact retired root carries a legacy content selector that should
 * remain reachable. URLSearchParams has already decoded one URL layer; the
 * page bridges decode a second layer, which is handled here without importing
 * the server-only legacy bridge.
 */
export function isRetiredPublicDeepLink(
  pathname: string,
  searchParams: URLSearchParams,
): boolean {
  const normalizedPath = normalizeRetiredPublicPath(pathname);

  if (normalizedPath === "/alpha-scout") {
    return (
      isSafeAlphaReport(searchParams.get("report")) ||
      isSafeRetiredPath(searchParams.get("path"), "alpha-scout/")
    );
  }

  if (normalizedPath === "/posts") {
    return isSafeRetiredPath(searchParams.get("path"), "posts/");
  }

  if (normalizedPath === "/100x/daily-wrap") {
    return /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("date") ?? "");
  }

  return false;
}
