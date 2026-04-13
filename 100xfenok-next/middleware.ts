import type { NextRequest } from "next/server";
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
];

function isBlockedAiBot(userAgent: string | null): boolean {
  if (!userAgent) {
    return false;
  }

  return BLOCKED_AI_BOT_PATTERNS.some((pattern) => pattern.test(userAgent));
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

  if (pathname !== "/robots.txt" && isBlockedAiBot(request.headers.get("user-agent"))) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
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
