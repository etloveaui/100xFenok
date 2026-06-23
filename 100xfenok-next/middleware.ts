import type { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionToken,
} from "@/lib/server/admin-session";

const BLOCKED_AI_BOT_PATTERNS = [
  /\bClaudeBot\b/i,
  /\bClaude-Web\b/i,
  /\banthropic-ai\b/i,
  /\bGPTBot\b/i,
  /\bChatGPT-User\b/i,
  /\bOAI-SearchBot\b/i,
  /\bGoogle-Extended\b/i,
  /\bApplebot-Extended\b/i,
  /\bPerplexityBot\b/i,
  /\bCCBot\b/i,
  /\bBytespider\b/i,
  /\bAmazonbot\b/i,
  /\bFacebookBot\b/i,
  /\bDiffbot\b/i,
  /\bMetaExternalAgent\b/i,
  /\bAhrefsBot\b/i,
  /\bSemrushBot\b/i,
  /\bMJ12bot\b/i,
  /\bDotBot\b/i,
  /\bBLEXBot\b/i,
  /\bPetalBot\b/i,
  /\bBaiduspider\b/i,
  /\bYandexBot\b/i,
  /\bSogou\b/i,
  /\bAwario\b/i,
  /\bDataForSeoBot\b/i,
  /\bImagesiftBot\b/i,
  /\bomgili\b/i,
  /\bMeltwater\b/i,
  /\bSeznamBot\b/i,
  /\bSeekportBot\b/i,
];

type RateLimitBinding = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

type RateLimitEnv = {
  RL_GLOBAL?: RateLimitBinding;
  RL_API?: RateLimitBinding;
  RL_ADMIN?: RateLimitBinding;
};

type RateLimitTier = {
  bindingName: keyof RateLimitEnv;
  key: string;
  fallbackLimit: number;
  periodMs: number;
};

type LocalRateLimitEntry = {
  count: number;
  resetAt: number;
};

const STATIC_ASSET_PATH_PATTERN =
  /\.(?:avif|css|csv|gif|ico|jpe?g|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff2?)$/i;
const ONE_MINUTE_MS = 60_000;
const localRateLimitStore = new Map<string, LocalRateLimitEntry>();

function isBlockedAiBot(userAgent: string | null): boolean {
  if (!userAgent) {
    return false;
  }

  return BLOCKED_AI_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
}

function shouldSkipBotProtection(pathname: string): boolean {
  return (
    pathname === "/robots.txt" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/_next/image/") ||
    STATIC_ASSET_PATH_PATTERN.test(pathname)
  );
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function isLocalHostRequest(request: NextRequest): boolean {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function isLocalQaRateLimitAllowanceEnabled(): boolean {
  return process.env.FENOK_LOCAL_PROD_QA === "1";
}

function getFallbackLimit(request: NextRequest, fallbackLimit: number): number {
  // Local production QA can exercise dozens of routes in one minute; deployed Workers do not set this env.
  if (isLocalHostRequest(request) && isLocalQaRateLimitAllowanceEnabled()) {
    return Math.max(fallbackLimit, 5000);
  }
  return fallbackLimit;
}

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isAdminApiPath(pathname: string): boolean {
  return pathname === "/api/admin" || pathname.startsWith("/api/admin/");
}

function isPublicLiveBenchPath(pathname: string): boolean {
  return pathname === "/admin/live" || pathname.startsWith("/admin/live/");
}

function getRateLimitTier(request: NextRequest): RateLimitTier {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);
  const hasUserAgent = Boolean(request.headers.get("user-agent")?.trim());

  if (isAdminApiPath(pathname) || isAdminPath(pathname)) {
    return {
      bindingName: "RL_ADMIN",
      key: `admin:${ip}`,
      fallbackLimit: getFallbackLimit(request, 120),
      periodMs: ONE_MINUTE_MS,
    };
  }

  if (pathname.startsWith("/api/")) {
    const apiClass = pathname.startsWith("/api/ticker")
      ? "ticker"
      : pathname.startsWith("/api/data")
        ? "data"
        : "other";

    return {
      bindingName: "RL_API",
      key: `api:${apiClass}:${ip}`,
      fallbackLimit: getFallbackLimit(request, 120),
      periodMs: ONE_MINUTE_MS,
    };
  }

  if (!hasUserAgent) {
    return {
      bindingName: "RL_API",
      key: `suspect:${ip}`,
      fallbackLimit: getFallbackLimit(request, 120),
      periodMs: ONE_MINUTE_MS,
    };
  }

  return {
    bindingName: "RL_GLOBAL",
    key: `global:${ip}`,
    fallbackLimit: getFallbackLimit(request, 600),
    periodMs: ONE_MINUTE_MS,
  };
}

function passesLocalRateLimit(tier: RateLimitTier, now = Date.now()): boolean {
  const current = localRateLimitStore.get(tier.key);
  if (!current || current.resetAt <= now) {
    localRateLimitStore.set(tier.key, {
      count: 1,
      resetAt: now + tier.periodMs,
    });
    return true;
  }

  current.count += 1;
  return current.count <= tier.fallbackLimit;
}

async function passesRateLimit(request: NextRequest): Promise<boolean> {
  const { pathname } = request.nextUrl;
  if (
    shouldSkipBotProtection(pathname) ||
    isAdminPath(pathname) ||
    isAdminApiPath(pathname)
  ) {
    return true;
  }

  const tier = getRateLimitTier(request);

  try {
    const { env } = await getCloudflareContext({ async: true });
    const rateLimitEnv = env as RateLimitEnv;
    const limiter = rateLimitEnv[tier.bindingName];

    if (!limiter) {
      return passesLocalRateLimit(tier);
    }

    const result = await limiter.limit({ key: tier.key });
    // Cloudflare's Rate Limiting binding is permissive and edge-local; this is only
    // a best-effort backstop, with the isolate-local counter covering obvious bursts.
    return result.success && passesLocalRateLimit(tier);
  } catch {
    return passesLocalRateLimit(tier);
  }
}

function rateLimitResponse(): NextResponse {
  return new NextResponse("Too Many Requests", {
    status: 429,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "60",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function getAdminTrailingSlashRedirect(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!isAdminPath(pathname) || pathname.endsWith("/")) {
    return null;
  }

  const targetUrl = request.nextUrl.clone();
  targetUrl.pathname = `${pathname}/`;
  return NextResponse.redirect(targetUrl, 308);
}

function normalizeAdminLegacyPath(pathname: string): string | null {
  if (!pathname.startsWith("/admin/") || !pathname.endsWith(".html")) {
    return null;
  }

  if (pathname.startsWith("/admin/personal/travel/")) {
    const targetPath = pathname.replace(/^\//, "");
    return `/admin/personal/travel?path=${encodeURIComponent(targetPath)}`;
  }

  if (pathname.endsWith("/index.html")) {
    return pathname.replace(/\/index\.html$/, "");
  }

  return pathname.replace(/\.html$/, "");
}

function normalizeLegacyTravelPath(pathname: string): string | null {
  if (!pathname.startsWith("/travel/")) {
    return null;
  }

  const tail = pathname.replace(/^\/travel\//, "");
  if (!tail) {
    return "/admin/personal/travel";
  }

  return `/admin/personal/travel?path=${encodeURIComponent(
    `admin/personal/travel/${tail}`,
  )}`;
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!shouldSkipBotProtection(pathname) && isBlockedAiBot(request.headers.get("user-agent"))) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  if (isPublicLiveBenchPath(pathname)) {
    const targetUrl = request.nextUrl.clone();
    targetUrl.pathname = "/live-bench/";
    return NextResponse.rewrite(targetUrl);
  }

  if (!(await passesRateLimit(request))) {
    return rateLimitResponse();
  }

  const adminTrailingSlashRedirect = getAdminTrailingSlashRedirect(request);
  if (adminTrailingSlashRedirect) {
    return adminTrailingSlashRedirect;
  }

  const normalizedAdminPath = normalizeAdminLegacyPath(pathname);
  const normalizedTravelPath = normalizeLegacyTravelPath(pathname);

  if (!normalizedAdminPath && !normalizedTravelPath) {
    return NextResponse.next();
  }

  const redirectTarget = normalizedAdminPath ?? normalizedTravelPath;
  if (!redirectTarget) {
    return NextResponse.next();
  }

  const targetUrl = request.nextUrl.clone();
  const [targetPathname, targetSearch = ""] = redirectTarget.split("?", 2);
  targetUrl.pathname = targetPathname;
  targetUrl.search = targetSearch ? `?${targetSearch}` : "";
  if (!targetUrl.searchParams.has("redirect")) {
    targetUrl.searchParams.set("redirect", `${pathname}${search}`);
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
  const authenticated = await verifyAdminSessionToken(token);

  if (
    normalizedAdminPath &&
    request.nextUrl.searchParams.get("embed") === "1" &&
    authenticated
  ) {
    return NextResponse.next();
  }

  if (normalizedTravelPath && !authenticated) {
    return NextResponse.redirect(targetUrl);
  }

  return NextResponse.redirect(targetUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
