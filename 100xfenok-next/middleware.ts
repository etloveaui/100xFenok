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
};

const STATIC_ASSET_PATH_PATTERN =
  /\.(?:avif|css|csv|gif|ico|jpe?g|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff2?)$/i;

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

function getRateLimitTier(request: NextRequest): RateLimitTier {
  const { pathname } = request.nextUrl;
  const ip = getClientIp(request);
  const hasUserAgent = Boolean(request.headers.get("user-agent")?.trim());

  if (pathname === "/api/admin/session" || pathname.startsWith("/admin")) {
    return {
      bindingName: "RL_ADMIN",
      key: `admin:${ip}`,
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
    };
  }

  if (!hasUserAgent) {
    return {
      bindingName: "RL_API",
      key: `suspect:${ip}`,
    };
  }

  return {
    bindingName: "RL_GLOBAL",
    key: `global:${ip}`,
  };
}

async function passesRateLimit(request: NextRequest): Promise<boolean> {
  if (shouldSkipBotProtection(request.nextUrl.pathname)) {
    return true;
  }

  try {
    const { env } = getCloudflareContext();
    const rateLimitEnv = env as RateLimitEnv;
    const tier = getRateLimitTier(request);
    const limiter = rateLimitEnv[tier.bindingName];

    if (!limiter) {
      return true;
    }

    const result = await limiter.limit({ key: tier.key });
    return result.success;
  } catch {
    return true;
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

  if (!(await passesRateLimit(request))) {
    return rateLimitResponse();
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
