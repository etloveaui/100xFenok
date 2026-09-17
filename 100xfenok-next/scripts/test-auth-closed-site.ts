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
  CLOSED_SITE_ENV_VAR,
  FENOK_VERIFY_TOKEN_ENV_VAR,
  FX_PREVIEW_COOKIE_NAME,
  VERIFY_HEADER_NAME,
} from "../src/lib/server/closed-site";
import {
  UserStoreCore,
  type DurableObjectStorageLike,
} from "../src/lib/server/userStore";
import {
  resolveCurrentSession,
  createSessionCookieHeader,
  FX_SESSION_COOKIE_NAME,
} from "../src/lib/server/authSession";
import { middleware } from "../middleware";


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
