#!/usr/bin/env tsx
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  gateMode,
  isGated,
  isAlwaysOpenPath,
  generateVerifySignature,
  verifyRequestToken,
  handleWorkerClosedSiteGate,
  hasBrowseCookie,
  createBrowseCookieHeader,
  createClearBrowseCookieHeader,
  isValidNextPath,
  CLOSED_SITE_ENV_VAR,
  FENOK_VERIFY_TOKEN_ENV_VAR,
  FX_PREVIEW_COOKIE_NAME,
  FX_BROWSE_COOKIE_NAME,
  VERIFY_HEADER_NAME,
} from "../src/lib/server/closed-site";
import {
  UserStoreCore,
  getInMemoryUserStore,
  type DurableObjectStorageLike,
} from "../src/lib/server/userStore";
import {
  resolveCurrentSession,
  createSessionCookieHeader,
  FX_SESSION_COOKIE_NAME,
} from "../src/lib/server/authSession";
import { middleware } from "../middleware";
import { GET as browseHandler } from "../src/app/api/intro/browse/route";
import { POST as logoutHandler } from "../src/app/api/auth/logout/route";


function createMemoryStorage(): DurableObjectStorageLike {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async put(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<boolean> {
      return map.delete(key);
    },
  };
}

const ORIGIN = "https://100xfenok.example";

function nextRequestFor(pathname: string, options: { cookie?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers = new Headers({
    "user-agent": "test-auth-closed-site-agent",
    ...(options.headers ?? {}),
  });
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  return new NextRequest(new URL(pathname, ORIGIN), { headers });
}

function standardRequestFor(pathname: string, options: { cookie?: string; headers?: Record<string, string> } = {}): Request {
  const headers = new Headers({
    "user-agent": "test-auth-closed-site-agent",
    ...(options.headers ?? {}),
  });
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  return new Request(new URL(pathname, ORIGIN).toString(), { headers });
}

// ---------------------------------------------------------------------------
// 1. Helper contract tests: gateMode
// ---------------------------------------------------------------------------

test("closed-site: gateMode parses off, preview, on, and truthy aliases correctly", () => {
  // Absent / undefined -> "off"
  assert.equal(gateMode(), "off");
  assert.equal(gateMode({}), "off");
  assert.equal(gateMode({ CLOSED_SITE: undefined }), "off");
  assert.equal(gateMode({ CLOSED_SITE: "" }), "off");

  // Explicit off
  assert.equal(gateMode({ CLOSED_SITE: "off" }), "off");
  assert.equal(gateMode({ CLOSED_SITE: "OFF" }), "off");

  // Preview
  assert.equal(gateMode({ CLOSED_SITE: "preview" }), "preview");
  assert.equal(gateMode({ CLOSED_SITE: "PREVIEW " }), "preview");

  // Intro
  assert.equal(gateMode({ CLOSED_SITE: "intro" }), "intro");
  assert.equal(gateMode({ CLOSED_SITE: "INTRO " }), "intro");

  // On and truthy aliases
  assert.equal(gateMode({ CLOSED_SITE: "on" }), "on");
  assert.equal(gateMode({ CLOSED_SITE: "ON" }), "on");
  assert.equal(gateMode({ CLOSED_SITE: "1" }), "on");
  assert.equal(gateMode({ CLOSED_SITE: "true" }), "on");
  assert.equal(gateMode({ CLOSED_SITE: " TRUE " }), "on");

  // Unknown values default to "off"
  assert.equal(gateMode({ CLOSED_SITE: "random" }), "off");
});

// ---------------------------------------------------------------------------
// 2. Helper contract tests: isGated
// ---------------------------------------------------------------------------

test("closed-site: isGated enforces off, on, and preview cookie correctly", () => {
  const reqNoCookie = standardRequestFor("/");
  const reqWithPreview = standardRequestFor("/", { cookie: "fx_preview=1" });
  const reqWithOtherCookie = standardRequestFor("/", { cookie: "fx_preview=0; other=xyz" });
  const reqWithMultiCookie = standardRequestFor("/", { cookie: "theme=dark; fx_preview=1; session=abc" });
  const reqWithBrowse = standardRequestFor("/", { cookie: "fx_browse=1" });
  const reqWithBrowseZero = standardRequestFor("/", { cookie: "fx_browse=0" });
  const reqWithMultiBrowse = standardRequestFor("/", { cookie: "theme=dark; fx_browse=1; session=abc" });

  // "off" mode never gates
  assert.equal(isGated(reqNoCookie, "off"), false);
  assert.equal(isGated(reqWithPreview, "off"), false);

  // "on" mode always gates
  assert.equal(isGated(reqNoCookie, "on"), true);
  assert.equal(isGated(reqWithPreview, "on"), true);
  assert.equal(isGated(reqWithOtherCookie, "on"), true);

  // "preview" mode gates ONLY when fx_preview=1 is present
  assert.equal(isGated(reqNoCookie, "preview"), false);
  assert.equal(isGated(reqWithOtherCookie, "preview"), false);
  assert.equal(isGated(reqWithPreview, "preview"), true);
  assert.equal(isGated(reqWithMultiCookie, "preview"), true);

  // "intro" mode gates ONLY when fx_browse=1 is NOT present
  assert.equal(isGated(reqNoCookie, "intro"), true);
  assert.equal(isGated(reqWithOtherCookie, "intro"), true);
  assert.equal(isGated(reqWithBrowseZero, "intro"), true);
  assert.equal(isGated(reqWithBrowse, "intro"), false);
  assert.equal(isGated(reqWithMultiBrowse, "intro"), false);
});

// ---------------------------------------------------------------------------
// 3. Helper contract tests: verifyRequestToken
// ---------------------------------------------------------------------------

test("closed-site: verifyRequestToken verifies HMAC-SHA256 signature for today and yesterday", async () => {
  const secret = "test-secret-fenok-token-12345";
  const now = new Date("2026-09-17T12:00:00Z");
  const todayDate = "2026-09-17";
  const yesterdayDate = "2026-09-16";
  const twoDaysAgoDate = "2026-09-15";

  const todaySig = await generateVerifySignature(secret, todayDate);
  const yesterdaySig = await generateVerifySignature(secret, yesterdayDate);
  const oldSig = await generateVerifySignature(secret, twoDaysAgoDate);

  assert.equal(todaySig.length, 64);
  assert.equal(yesterdaySig.length, 64);

  // No token configured -> false
  const reqWithSig = standardRequestFor("/", { headers: { "x-fenok-verify": todaySig } });
  assert.equal(await verifyRequestToken(reqWithSig, "", now), false);

  // Missing header -> false
  const reqNoHeader = standardRequestFor("/");
  assert.equal(await verifyRequestToken(reqNoHeader, secret, now), false);

  // Tampered signature -> false
  const reqTampered = standardRequestFor("/", { headers: { "x-fenok-verify": "a".repeat(64) } });
  assert.equal(await verifyRequestToken(reqTampered, secret, now), false);

  // Today's signature -> true
  assert.equal(await verifyRequestToken(reqWithSig, secret, now), true);

  // Yesterday's signature (midnight survival) -> true
  const reqYesterday = standardRequestFor("/", { headers: { "x-fenok-verify": yesterdaySig } });
  assert.equal(await verifyRequestToken(reqYesterday, secret, now), true);

  // 2-day-old signature -> false
  const reqOld = standardRequestFor("/", { headers: { "x-fenok-verify": oldSig } });
  assert.equal(await verifyRequestToken(reqOld, secret, now), false);
});

// ---------------------------------------------------------------------------
// 4. Helper contract tests: isAlwaysOpenPath
// ---------------------------------------------------------------------------

test("closed-site: isAlwaysOpenPath accurately identifies un-gated routes", () => {
  // Always open routes
  assert.equal(isAlwaysOpenPath("/intro"), true);
  assert.equal(isAlwaysOpenPath("/intro/"), true);
  assert.equal(isAlwaysOpenPath("/api/auth"), true);
  assert.equal(isAlwaysOpenPath("/api/auth/google"), true);
  assert.equal(isAlwaysOpenPath("/api/auth/logout"), true);
  assert.equal(isAlwaysOpenPath("/_next/static/chunks/app.js"), true);
  assert.equal(isAlwaysOpenPath("/api/health"), true);
  assert.equal(isAlwaysOpenPath("/api/health/ping"), true);
  assert.equal(isAlwaysOpenPath("/favicon.ico"), true);
  assert.equal(isAlwaysOpenPath("/robots.txt"), true);
  assert.equal(isAlwaysOpenPath("/sitemap.xml"), true);
  assert.equal(isAlwaysOpenPath("/manifest.webmanifest"), true);
  assert.equal(isAlwaysOpenPath("/manifest.json"), true);

  // Gated routes
  assert.equal(isAlwaysOpenPath("/"), false);
  assert.equal(isAlwaysOpenPath("/screener"), false);
  assert.equal(isAlwaysOpenPath("/portfolio"), false);
  assert.equal(isAlwaysOpenPath("/stock/NVDA"), false);
  assert.equal(isAlwaysOpenPath("/admin"), false);
  assert.equal(isAlwaysOpenPath("/admin/users"), false);
  assert.equal(isAlwaysOpenPath("/api/ticker/AAPL"), false);
  assert.equal(isAlwaysOpenPath("/data/benchmarks/summaries.json"), false);
});

// ---------------------------------------------------------------------------
// 5. Session pass-through verification
// ---------------------------------------------------------------------------

test("closed-site: resolveCurrentSession recognizes minted user session", async () => {
  const storage = createMemoryStorage();
  const store = new UserStoreCore({ storage });
  await store.saveProfile({
    sub: "test-google-user-777",
    email: "user777@example.com",
    name: "Closed Site Tester",
  });

  const { token } = await store.mintToken("test-device");
  const cookieHeader = `${FX_SESSION_COOKIE_NAME}=${token}`;
  const req = standardRequestFor("/screener", { cookie: cookieHeader });

  // Build a mock env with USER_STORE pointing to our store instance
  const mockEnv = {
    USER_STORE: {
      idFromName: (_name: string) => "user-id-777",
      get: (_id: unknown) => store,
    },
  };

  const session = await resolveCurrentSession(req, mockEnv);
  assert.ok(session);
  assert.equal(session.sub, "test-google-user-777");
  assert.equal(session.user.email, "user777@example.com");
});

// ---------------------------------------------------------------------------
// 6. Middleware tests: proving CLOSED_SITE=off has zero behavior change
// ---------------------------------------------------------------------------

test("middleware: CLOSED_SITE=off never redirects ordinary page requests to /intro", async () => {
  const originalEnv = process.env[CLOSED_SITE_ENV_VAR];
  try {
    process.env[CLOSED_SITE_ENV_VAR] = "off";

    const reqHome = nextRequestFor("/");
    const resHome = await middleware(reqHome);
    // When middleware allows a request through without redirect, x-middleware-next is "1" or status is not 302
    assert.notEqual(resHome.status, 302);
    assert.equal(resHome.headers.get("location"), null);

    const reqScreener = nextRequestFor("/screener");
    const resScreener = await middleware(reqScreener);
    assert.notEqual(resScreener.status, 302);
    assert.equal(resScreener.headers.get("location"), null);
  } finally {
    process.env[CLOSED_SITE_ENV_VAR] = originalEnv;
  }
});

// ---------------------------------------------------------------------------
// 7. Middleware tests: CLOSED_SITE=on redirects unauthenticated to /intro?next=...
// ---------------------------------------------------------------------------

test("middleware: CLOSED_SITE=on redirects unauthenticated page requests to /intro?next=...", async () => {
  const originalEnv = process.env[CLOSED_SITE_ENV_VAR];
  const originalToken = process.env[FENOK_VERIFY_TOKEN_ENV_VAR];
  try {
    process.env[CLOSED_SITE_ENV_VAR] = "on";
    process.env[FENOK_VERIFY_TOKEN_ENV_VAR] = "test-token-middleware";

    // 1. Root path "/" redirects to /intro?next=%2F
    const reqHome = nextRequestFor("/");
    const resHome = await middleware(reqHome);
    assert.equal(resHome.status, 302);
    const locHome = resHome.headers.get("location");
    assert.ok(locHome);
    const urlHome = new URL(locHome, ORIGIN);
    assert.equal(urlHome.pathname, "/intro");
    assert.equal(urlHome.searchParams.get("next"), "/");

    // 2. Deep page "/screener?tab=valuation" redirects to /intro?next=%2Fscreener%3Ftab%3Dvaluation
    const reqScreener = nextRequestFor("/screener?tab=valuation");
    const resScreener = await middleware(reqScreener);
    assert.equal(resScreener.status, 302);
    const locScreener = resScreener.headers.get("location");
    assert.ok(locScreener);
    const urlScreener = new URL(locScreener, ORIGIN);
    assert.equal(urlScreener.pathname, "/intro");
    assert.equal(urlScreener.searchParams.get("next"), "/screener?tab=valuation");

    // 3. Admin path "/admin" redirects to /intro?next=%2Fadmin
    const reqAdmin = nextRequestFor("/admin");
    const resAdmin = await middleware(reqAdmin);
    assert.equal(resAdmin.status, 302);
    const locAdmin = resAdmin.headers.get("location");
    assert.ok(locAdmin);
    const urlAdmin = new URL(locAdmin, ORIGIN);
    assert.equal(urlAdmin.pathname, "/intro");
    assert.equal(urlAdmin.searchParams.get("next"), "/admin");

    // 4. Always-open paths are NOT redirected
    const reqIntro = nextRequestFor("/intro");
    const resIntro = await middleware(reqIntro);
    assert.notEqual(resIntro.status, 302);

    const reqFavicon = nextRequestFor("/favicon.ico");
    const resFavicon = await middleware(reqFavicon);
    assert.notEqual(resFavicon.status, 302);

    // 5. Verification token bypasses the gate
    const todaySig = await generateVerifySignature("test-token-middleware", new Date().toISOString().slice(0, 10));
    const reqWithVerify = nextRequestFor("/screener", {
      headers: { [VERIFY_HEADER_NAME]: todaySig },
    });
    const resWithVerify = await middleware(reqWithVerify);
    assert.notEqual(resWithVerify.status, 302);

    // 6. Unauthenticated API request gets 401 JSON
    const reqApi = nextRequestFor("/api/ticker/AAPL");
    const resApi = await middleware(reqApi);
    assert.equal(resApi.status, 401);
    const bodyApi = await resApi.json();
    assert.deepEqual(bodyApi, { ok: false, error: "login required" });
  } finally {
    process.env[CLOSED_SITE_ENV_VAR] = originalEnv;
    process.env[FENOK_VERIFY_TOKEN_ENV_VAR] = originalToken;
  }
});

// ---------------------------------------------------------------------------
// 8. Middleware tests: CLOSED_SITE=preview enforces gate only with fx_preview=1
// ---------------------------------------------------------------------------

test("middleware: CLOSED_SITE=preview gates only requests with fx_preview=1 cookie", async () => {
  const originalEnv = process.env[CLOSED_SITE_ENV_VAR];
  try {
    process.env[CLOSED_SITE_ENV_VAR] = "preview";

    // Request without preview cookie passes
    const reqNoPreview = nextRequestFor("/screener");
    const resNoPreview = await middleware(reqNoPreview);
    assert.notEqual(resNoPreview.status, 302);

    // Request with preview cookie redirects to /intro
    const reqWithPreview = nextRequestFor("/screener", { cookie: "fx_preview=1" });
    const resWithPreview = await middleware(reqWithPreview);
    assert.equal(resWithPreview.status, 302);
    const loc = resWithPreview.headers.get("location");
    assert.ok(loc);
    const url = new URL(loc, ORIGIN);
    assert.equal(url.pathname, "/intro");
    assert.equal(url.searchParams.get("next"), "/screener");
  } finally {
    process.env[CLOSED_SITE_ENV_VAR] = originalEnv;
  }
});

// ---------------------------------------------------------------------------
// 9. Worker gate tests: /data/* and /api/data/* protection
// ---------------------------------------------------------------------------

test("worker gate: /data/* and /api/data/* are gated when CLOSED_SITE=on", async () => {
  const verifyToken = "test-worker-verify-token";
  const envOff = {
    CLOSED_SITE: "off",
    FENOK_VERIFY_TOKEN: verifyToken,
  };
  const envOn = {
    CLOSED_SITE: "on",
    FENOK_VERIFY_TOKEN: verifyToken,
  };

  // When OFF: /data/test.json passes gate (handleWorkerClosedSiteGate returns null)
  const reqOff = standardRequestFor("/data/test.json");
  const resOff = await handleWorkerClosedSiteGate(reqOff, envOff);
  assert.equal(resOff, null);

  // When ON: /data/test.json without auth returns 401 JSON with no-store
  const reqOn = standardRequestFor("/data/test.json");
  const resOn = await handleWorkerClosedSiteGate(reqOn, envOn);
  assert.ok(resOn);
  assert.equal(resOn.status, 401);
  assert.equal(resOn.headers.get("cache-control"), "no-store");
  const bodyOn = await resOn.json();
  assert.deepEqual(bodyOn, { ok: false, error: "login required" });

  // When ON: /api/data/intro-feed without auth returns 401 JSON with no-store
  const reqApiOn = standardRequestFor("/api/data/intro-feed");
  const resApiOn = await handleWorkerClosedSiteGate(reqApiOn, envOn);
  assert.ok(resApiOn);
  assert.equal(resApiOn.status, 401);
  assert.equal(resApiOn.headers.get("cache-control"), "no-store");
  const bodyApiOn = await resApiOn.json();
  assert.deepEqual(bodyApiOn, { ok: false, error: "login required" });

  // When ON: valid x-fenok-verify header passes gate (returns null)
  const todaySig = await generateVerifySignature(verifyToken, new Date().toISOString().slice(0, 10));
  const reqVerified = standardRequestFor("/data/test.json", {
    headers: { [VERIFY_HEADER_NAME]: todaySig },
  });
  const resVerified = await handleWorkerClosedSiteGate(reqVerified, envOn);
  assert.equal(resVerified, null);
});

// ---------------------------------------------------------------------------
// 10. Helper contract tests: fx_browse and isValidNextPath
// ---------------------------------------------------------------------------

test("closed-site: fx_browse cookie helpers and isValidNextPath validation", () => {
  assert.equal(isValidNextPath("/"), true);
  assert.equal(isValidNextPath("/screener"), true);
  assert.equal(isValidNextPath("/screener?tab=valuation"), true);
  assert.equal(isValidNextPath("/admin/users"), true);

  // Invalid: double slash, backslash, external, empty, non-string
  assert.equal(isValidNextPath("//evil.com"), false);
  assert.equal(isValidNextPath("/\\evil.com"), false);
  assert.equal(isValidNextPath("/path\\with\\backslash"), false);
  assert.equal(isValidNextPath("https://evil.com"), false);
  assert.equal(isValidNextPath("screener"), false);
  assert.equal(isValidNextPath(""), false);
  assert.equal(isValidNextPath(null), false);
  assert.equal(isValidNextPath(undefined), false);

  const header = createBrowseCookieHeader();
  assert.ok(header.includes("fx_browse=1"));
  assert.ok(header.includes("Path=/"));
  assert.ok(header.includes("Max-Age=43200"));
  assert.ok(header.includes("HttpOnly"));
  assert.ok(header.includes("Secure"));
  assert.ok(header.includes("SameSite=Lax"));

  const clearHeader = createClearBrowseCookieHeader();
  assert.ok(clearHeader.includes("fx_browse="));
  assert.ok(clearHeader.includes("Max-Age=0"));

  assert.equal(hasBrowseCookie(standardRequestFor("/")), false);
  assert.equal(hasBrowseCookie(standardRequestFor("/", { cookie: "fx_browse=1" })), true);
  assert.equal(hasBrowseCookie(standardRequestFor("/", { cookie: "fx_browse=0" })), false);
});

// ---------------------------------------------------------------------------
// 11. Middleware tests: CLOSED_SITE=intro soft mode
// ---------------------------------------------------------------------------

test("middleware: CLOSED_SITE=intro redirects unauthenticated visitor without cookie to /intro?next=...", async () => {
  const originalEnv = process.env[CLOSED_SITE_ENV_VAR];
  try {
    process.env[CLOSED_SITE_ENV_VAR] = "intro";

    // 1. Unauthenticated page request without cookie redirects to /intro?next=...
    const reqHome = nextRequestFor("/");
    const resHome = await middleware(reqHome);
    assert.equal(resHome.status, 302);
    const locHome = resHome.headers.get("location");
    assert.ok(locHome);
    const urlHome = new URL(locHome, ORIGIN);
    assert.equal(urlHome.pathname, "/intro");
    assert.equal(urlHome.searchParams.get("next"), "/");

    const reqScreener = nextRequestFor("/screener?tab=valuation");
    const resScreener = await middleware(reqScreener);
    assert.equal(resScreener.status, 302);
    const locScreener = resScreener.headers.get("location");
    assert.ok(locScreener);
    const urlScreener = new URL(locScreener, ORIGIN);
    assert.equal(urlScreener.pathname, "/intro");
    assert.equal(urlScreener.searchParams.get("next"), "/screener?tab=valuation");

    // 2. Pass with fx_browse=1 cookie
    const reqWithBrowse = nextRequestFor("/screener?tab=valuation", {
      cookie: "fx_browse=1",
    });
    const resWithBrowse = await middleware(reqWithBrowse);
    assert.notEqual(resWithBrowse.status, 302);

    // 3. Pass with valid user session (even without fx_browse=1)
    const testSub = "google-intro-session-user";
    const userStore = getInMemoryUserStore(testSub);
    await userStore.saveProfile({
      sub: testSub,
      email: "intro-user@example.com",
      name: "Intro User",
    });
    const { token } = await userStore.mintToken("test-device");
    const reqWithSession = nextRequestFor("/screener", {
      cookie: `${FX_SESSION_COOKIE_NAME}=${token}`,
    });
    const resWithSession = await middleware(reqWithSession);
    assert.notEqual(resWithSession.status, 302);

    // 4. API and data requests are untouched in intro mode (not 401, not 302)
    const reqApi = nextRequestFor("/api/ticker/AAPL");
    const resApi = await middleware(reqApi);
    assert.notEqual(resApi.status, 401);
    assert.notEqual(resApi.status, 302);

    const reqData = nextRequestFor("/data/test.json");
    const resData = await middleware(reqData);
    assert.notEqual(resData.status, 401);
    assert.notEqual(resData.status, 302);
  } finally {
    process.env[CLOSED_SITE_ENV_VAR] = originalEnv;
  }
});

test("worker gate: CLOSED_SITE=intro leaves data and API untouched", async () => {
  const envIntro = {
    CLOSED_SITE: "intro",
  };

  // /data/test.json without auth passes gate (handleWorkerClosedSiteGate returns null)
  const reqData = standardRequestFor("/data/test.json");
  const resData = await handleWorkerClosedSiteGate(reqData, envIntro);
  assert.equal(resData, null);

  // /api/data/intro-feed without auth passes gate (handleWorkerClosedSiteGate returns null)
  const reqApiData = standardRequestFor("/api/data/intro-feed");
  const resApiData = await handleWorkerClosedSiteGate(reqApiData, envIntro);
  assert.equal(resApiData, null);
});

// ---------------------------------------------------------------------------
// 12. GET /api/intro/browse and POST /api/auth/logout tests
// ---------------------------------------------------------------------------

test("GET /api/intro/browse: sets fx_browse=1 cookie and redirects to validated next path", async () => {
  // 1. Valid next path with query params
  const reqValid = new Request("https://100xfenok.example/api/intro/browse?next=/screener?tab=valuation");
  const resValid = await browseHandler(reqValid);
  assert.equal(resValid.status, 302);
  assert.equal(
    resValid.headers.get("location"),
    "https://100xfenok.example/screener?tab=valuation",
  );
  const cookieHeader = resValid.headers.get("Set-Cookie") || "";
  assert.ok(cookieHeader.includes("fx_browse=1"));
  assert.ok(cookieHeader.includes("Max-Age=43200"));
  assert.ok(cookieHeader.includes("HttpOnly"));
  assert.ok(cookieHeader.includes("Secure"));
  assert.ok(cookieHeader.includes("SameSite=Lax"));

  // 2. Open redirect attempt: double leading slash //evil.com -> fallback to /
  const reqDoubleSlash = new Request("https://100xfenok.example/api/intro/browse?next=//evil.com");
  const resDoubleSlash = await browseHandler(reqDoubleSlash);
  assert.equal(resDoubleSlash.status, 302);
  assert.equal(resDoubleSlash.headers.get("location"), "https://100xfenok.example/");

  // 3. Open redirect attempt: backslash /\\evil.com -> fallback to /
  const reqBackslash = new Request("https://100xfenok.example/api/intro/browse?next=/\\evil.com");
  const resBackslash = await browseHandler(reqBackslash);
  assert.equal(resBackslash.status, 302);
  assert.equal(resBackslash.headers.get("location"), "https://100xfenok.example/");

  // 4. External URL: https://evil.com -> fallback to /
  const reqExternal = new Request("https://100xfenok.example/api/intro/browse?next=https://evil.com");
  const resExternal = await browseHandler(reqExternal);
  assert.equal(resExternal.status, 302);
  assert.equal(resExternal.headers.get("location"), "https://100xfenok.example/");

  // 5. No next parameter -> fallback to /
  const reqNoNext = new Request("https://100xfenok.example/api/intro/browse");
  const resNoNext = await browseHandler(reqNoNext);
  assert.equal(resNoNext.status, 302);
  assert.equal(resNoNext.headers.get("location"), "https://100xfenok.example/");
});

test("POST /api/auth/logout: clears both fx_session and fx_browse cookies", async () => {
  const reqLogout = new Request("https://100xfenok.example/api/auth/logout", {
    method: "POST",
  });
  const resLogout = await logoutHandler(reqLogout);
  assert.equal(resLogout.status, 200);

  // Check Set-Cookie headers
  const setCookie = resLogout.headers.get("Set-Cookie") || "";
  assert.ok(setCookie.includes("fx_session=;"));
  assert.ok(setCookie.includes("fx_browse=;"));
  assert.ok(setCookie.includes("Max-Age=0"));

  // Check getSetCookie if available
  if (typeof resLogout.headers.getSetCookie === "function") {
    const cookies = resLogout.headers.getSetCookie();
    assert.ok(cookies.some((c) => c.includes("fx_session=;") && c.includes("Max-Age=0")));
    assert.ok(cookies.some((c) => c.includes("fx_browse=;") && c.includes("Max-Age=0")));
  }
});
