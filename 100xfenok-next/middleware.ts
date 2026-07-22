import type { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";
import { ADMIN_LEGACY_HTML_FILES, POST_HTML_FILES } from "@/generated/static-route-manifest";
// Pure module on purpose: @/lib/server/legacy-bridge reaches node:fs via
// publicAssetExists and cannot be imported into the edge bundle.
import {
  decodeSlugSegments,
  isSafeSlugSegments,
  resolveAdminLegacyCandidates,
} from "@/lib/admin-legacy-candidates";
import { resolvePostCandidates } from "@/lib/post-candidates";
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
const ADMIN_STATIC_FILE_PATH_PATTERN =
  /\.(?:avif|css|csv|gif|gs|html?|ico|jpe?g|js|json|map|md|mjs|png|svg|txt|webmanifest|webp|woff2?)$/i;
const ONE_MINUTE_MS = 60_000;
const NOINDEX_HEADER_VALUE = "noindex, nofollow, noarchive";
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
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedFor) return forwardedFor;

  const fallbackMaterial = [
    request.headers.get("host")?.trim() || "no-host",
    request.headers.get("user-agent")?.trim() || "no-user-agent",
    request.headers.get("accept-language")?.trim() || "no-language",
  ].join("|");
  let hash = 2166136261;
  for (let i = 0; i < fallbackMaterial.length; i += 1) {
    hash ^= fallbackMaterial.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fallback:${(hash >>> 0).toString(36)}`;
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

function isAdminStaticFilePath(pathname: string): boolean {
  return pathname.startsWith("/admin/") && ADMIN_STATIC_FILE_PATH_PATTERN.test(pathname);
}

function isProtectedAdminStaticAssetPath(pathname: string): boolean {
  return isAdminStaticFilePath(pathname) && !pathname.endsWith(".html");
}

function withNoindexHeader(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", NOINDEX_HEADER_VALUE);
  return response;
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
  if (shouldSkipBotProtection(pathname)) {
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
      "X-Robots-Tag": NOINDEX_HEADER_VALUE,
    },
  });
}

// Concrete /admin routes backed by their own page.tsx. Next resolves these
// BEFORE [...slug], so they never reach the legacy bridge and six of them have no
// backing HTML asset at all - including /admin/live, the Mona English surface.
// A manifest-only test would 404 them. Derived from `find src/app/admin -name
// page.tsx`; adding an admin page without adding it here 404s that new page.
export const ADMIN_CONCRETE_ROUTES = new Set<string>([
  "/admin",
  "/admin/data-lab",
  "/admin/design-gallery",
  "/admin/design-lab",
  "/admin/design-lab/cp-kit",
  "/admin/live",
  "/admin/macro-monitor",
  "/admin/personal",
  "/admin/personal/travel",
]);

const ADMIN_LEGACY_ASSET_SET = new Set<string>(ADMIN_LEGACY_HTML_FILES);
const POST_HTML_FILE_SET = new Set<string>(POST_HTML_FILES);

function decodeRequestPathSegments(pathname: string, prefix: string): string[] | null {
  const rawSegments = pathname.slice(prefix.length).split("/");
  // Allow only the one empty tail created by trailingSlash. Internal or repeated
  // empty segments are ambiguous and must fail open rather than emit a false 404.
  if (rawSegments.some((segment, index) => !segment && index !== rawSegments.length - 1)) {
    return null;
  }

  const encodedSegments = rawSegments.filter(Boolean);
  if (encodedSegments.length === 0) return null;
  const decodedSegments = decodeSlugSegments(encodedSegments);
  if (!decodedSegments || !isSafeSlugSegments(decodedSegments)) return null;
  return decodedSegments;
}

type DecodedAdminRequestPath = {
  pathname: string;
  slug: string[];
};

function decodeAdminRequestPath(pathname: string): DecodedAdminRequestPath | null {
  const decodedSegments = decodeRequestPathSegments(pathname, "/");
  if (!decodedSegments || decodedSegments[0] !== "admin") return null;
  return {
    pathname: `/${decodedSegments.join("/")}`,
    slug: decodedSegments.slice(1),
  };
}

function isConcreteAdminRoute(decodedPathname: string): boolean {
  return ADMIN_CONCRETE_ROUTES.has(decodedPathname);
}

function adminLegacyResolves(slug: string[]): boolean {
  if (slug.length === 0) return false;
  return resolveAdminLegacyCandidates(slug).some((candidate) => ADMIN_LEGACY_ASSET_SET.has(candidate));
}

// An /admin path that resolves to nothing must leave with a real 404.
//
// The bridge page already calls notFound(), but that status never reaches the
// wire: streaming commits the status line before the page throws, so the response
// goes out as 200 carrying the not-found BODY. Measured on production - the reply
// pairs HTTP 200 with fixHeadersForError's 404-only cache-control, proving the
// status was 404 internally and was simply too late.
//
// Rewriting to /_not-found WITH an explicit status escapes that: middleware.ts in
// the OpenNext core propagates an explicit rewrite status as rewriteStatusCode,
// /_not-found is prerendered with initialStatus 404 so the cache interceptor
// engages for it, and the interceptor gives rewriteStatusCode precedence over the
// cached status. The interceptor returns a complete buffered result, so there is
// no early flush to lose the status to.
//
// The candidate logic is shared with the page through a pure module - importing
// it from `legacy-bridge` would drag `node:fs` into the edge bundle - so
// middleware and page cannot disagree about what resolves.
export function getAdminNotFoundRewrite(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!isAdminPath(pathname) || isAdminApiPath(pathname)) return null;
  // Static admin files are owned by the assets layer and the auth gate below;
  // a missing .html is normalised to its extensionless form first and reaches
  // this check on the next pass.
  if (isAdminStaticFilePath(pathname)) return null;
  const decodedAdminPath = decodeAdminRequestPath(pathname);
  if (!decodedAdminPath) return null;
  if (isConcreteAdminRoute(decodedAdminPath.pathname)) return null;
  if (adminLegacyResolves(decodedAdminPath.slug)) return null;

  const targetUrl = request.nextUrl.clone();
  targetUrl.pathname = "/_not-found";
  targetUrl.search = "";
  return NextResponse.rewrite(targetUrl, { status: 404 });
}

/**
 * Whether an otherwise-routable posts request must leave middleware as a 404.
 * Invalid or ambiguous inputs deliberately fail open to the page-level bridge.
 */
export function shouldRewritePostsNotFound(
  pathname: string,
  postHtmlFileSet: ReadonlySet<string> = POST_HTML_FILE_SET,
): boolean {
  // The landing page owns both the catalog and its `?path=` query bridge.
  if (pathname === "/posts" || pathname === "/posts/") return false;
  if (!pathname.startsWith("/posts/")) return false;

  const slug = decodeRequestPathSegments(pathname, "/posts/");
  if (!slug) return false;
  return !resolvePostCandidates(slug).some((candidate) => postHtmlFileSet.has(candidate));
}

export function getPostsNotFoundRewrite(request: NextRequest): NextResponse | null {
  if (!shouldRewritePostsNotFound(request.nextUrl.pathname)) return null;

  const targetUrl = request.nextUrl.clone();
  targetUrl.pathname = "/_not-found";
  targetUrl.search = "";
  return NextResponse.rewrite(targetUrl, { status: 404 });
}

// Serve the canonical trailing-slash form INTERNALLY instead of redirecting to
// it. A 308 here produced an infinite self-loop in production: the Location that
// reached the wire was byte-identical to the request path (the appended slash was
// lost somewhere below this code — the responsible layer is still unidentified),
// so every unknown /admin/** path redirected to itself forever. A rewrite emits
// no Location at all, which makes the loop structurally impossible regardless of
// which layer was dropping the slash.
//
// Canonicalisation for real admin routes is NOT lost: public/_redirects carries a
// generated 308 per catalogued admin route and runs ahead of this middleware.
// What reaches here is the uncatalogued remainder, where the canonical URL is
// moot because the destination is the not-found bridge.
function getAdminTrailingSlashRewrite(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (
    isAdminApiPath(pathname) ||
    !isAdminPath(pathname) ||
    pathname.endsWith("/") ||
    isAdminStaticFilePath(pathname)
  ) {
    return null;
  }

  const targetUrl = request.nextUrl.clone();
  targetUrl.pathname = `${pathname}/`;
  return NextResponse.rewrite(targetUrl);
}

function getAdminGateRedirect(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const targetUrl = request.nextUrl.clone();
  targetUrl.pathname = "/admin/";
  targetUrl.search = "";
  targetUrl.searchParams.set("redirect", `${pathname}${search}`);
  return withNoindexHeader(NextResponse.redirect(targetUrl));
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
  if (pathname !== "/travel" && !pathname.startsWith("/travel/")) {
    return null;
  }

  const tail = pathname === "/travel" ? "" : pathname.replace(/^\/travel\//, "");
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
        "X-Robots-Tag": NOINDEX_HEADER_VALUE,
      },
    });
  }

  if (!(await passesRateLimit(request))) {
    return rateLimitResponse();
  }

  // Ahead of any bridge response: a safe, known-missing post must leave with
  // a real 404 rather than a 200 carrying a not-found body.
  const postsNotFoundRewrite = getPostsNotFoundRewrite(request);
  if (postsNotFoundRewrite) {
    return withNoindexHeader(postsNotFoundRewrite);
  }

  // Ahead of the canonicaliser: an unresolvable path must 404 rather than be
  // rewritten into the bridge, which would answer 200 with a not-found body.
  const adminNotFoundRewrite = getAdminNotFoundRewrite(request);
  if (adminNotFoundRewrite) {
    return withNoindexHeader(adminNotFoundRewrite);
  }

  const adminTrailingSlashRewrite = getAdminTrailingSlashRewrite(request);
  if (adminTrailingSlashRewrite) {
    return withNoindexHeader(adminTrailingSlashRewrite);
  }

  const normalizedAdminPath = normalizeAdminLegacyPath(pathname);
  const normalizedTravelPath = normalizeLegacyTravelPath(pathname);
  let authenticated: boolean | null = null;
  const hasAdminSession = async () => {
    if (authenticated === null) {
      const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? null;
      authenticated = await verifyAdminSessionToken(token);
    }
    return authenticated;
  };

  if (!normalizedAdminPath && !normalizedTravelPath) {
    if (isProtectedAdminStaticAssetPath(pathname) && !(await hasAdminSession())) {
      return getAdminGateRedirect(request);
    }
    const response = NextResponse.next();
    return isAdminPath(pathname) || isAdminApiPath(pathname) ? withNoindexHeader(response) : response;
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

  if (
    normalizedAdminPath &&
    request.nextUrl.searchParams.get("embed") === "1" &&
    (await hasAdminSession())
  ) {
    return withNoindexHeader(NextResponse.next());
  }

  if (normalizedTravelPath) {
    return withNoindexHeader(NextResponse.redirect(targetUrl));
  }

  return withNoindexHeader(NextResponse.redirect(targetUrl));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
