#!/usr/bin/env node

import { strict as assert } from "node:assert";
import path from "node:path";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

process.env.NODE_ENV = "production";
process.env.NEXT_ADMIN_PASSWORD_HASH =
  "8736ca6f3957409305f60068e93215c85f8751e4dcdc9303832b325a72c7789f";
process.env.NEXT_ADMIN_SESSION_SECRET = "fenok-admin-static-auth-guard";

const jiti = createJiti(path.join(process.cwd(), "_admin-static-auth-test.js"), {
  alias: { "@": path.join(process.cwd(), "src") },
  fsCache: false,
});

const { middleware } = jiti("./middleware.ts");
const { ADMIN_SESSION_COOKIE, ADMIN_SESSION_DEFAULT_TTL_MS, createAdminSessionToken } = jiti(
  "./src/lib/server/admin-session.ts",
);

const ORIGIN = "https://100xfenok.example";

function requestFor(pathname, cookie) {
  const headers = new Headers({
    "user-agent": "fenok-admin-static-auth-qa",
  });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(pathname, ORIGIN), { headers });
}

function isNext(response) {
  return response.headers.get("x-middleware-next") === "1";
}

function assertRedirectsToAdminGate(response, originalPath) {
  assert.equal(
    isNext(response),
    false,
    `${originalPath} must not pass through middleware without an admin session`,
  );
  assert(
    response.status >= 300 && response.status < 400,
    `${originalPath} should redirect to the admin gate, got ${response.status}`,
  );
  const location = response.headers.get("location");
  assert(location, `${originalPath} redirect must include a Location header`);
  const url = new URL(location, ORIGIN);
  assert(
    url.pathname === "/admin" || url.pathname === "/admin/",
    `${originalPath} should redirect to /admin, got ${url.pathname}`,
  );
  assert.equal(url.searchParams.get("redirect"), originalPath);
  assert.equal(
    response.headers.get("x-robots-tag"),
    "noindex, nofollow, noarchive",
  );
}

function assertRedirectsToPath(response, expectedPath, label) {
  assert.equal(isNext(response), false, `${label} must not pass through middleware`);
  assert(
    response.status >= 300 && response.status < 400,
    `${label} should redirect, got ${response.status}`,
  );
  const location = response.headers.get("location");
  assert(location, `${label} redirect must include a Location header`);
  const url = new URL(location, ORIGIN);
  assert.equal(url.pathname, expectedPath);
}

function assertPasses(response, label) {
  assert.equal(
    isNext(response),
    true,
    `${label} should pass through middleware`,
  );
}

const adminStaticPaths = [
  "/admin/DEV.md",
  "/admin/data-lab/app/renderer.js",
  "/admin/design-lab/screenshots/figma-profile-avatar.jpg",
];
const expiredToken = await createAdminSessionToken(Date.now() - ADMIN_SESSION_DEFAULT_TTL_MS - 1000);
for (const cookie of [
  "",
  `${ADMIN_SESSION_COOKIE}=malformed`,
  `${ADMIN_SESSION_COOKIE}=${expiredToken}`,
]) {
  for (const pathname of adminStaticPaths) {
    const response = await middleware(requestFor(pathname, cookie));
    assertRedirectsToAdminGate(response, pathname);
  }
}

const token = await createAdminSessionToken();
const authenticatedCookie = `${ADMIN_SESSION_COOKIE}=${token}`;
for (const pathname of adminStaticPaths) {
  const response = await middleware(requestFor(pathname, authenticatedCookie));
  assertPasses(response, `authenticated admin static asset ${pathname}`);
}

const anonymousAdminHtmlEmbed = await middleware(
  requestFor("/admin/data-lab/index.html?embed=1"),
);
assertRedirectsToPath(
  anonymousAdminHtmlEmbed,
  "/admin/data-lab",
  "anonymous admin HTML embed",
);
for (const cookie of [
  `${ADMIN_SESSION_COOKIE}=malformed`,
  `${ADMIN_SESSION_COOKIE}=${expiredToken}`,
]) {
  const response = await middleware(requestFor("/admin/data-lab/index.html?embed=1", cookie));
  assertRedirectsToPath(response, "/admin/data-lab", "invalid admin HTML embed session");
}

const authenticatedAdminHtmlEmbed = await middleware(
  requestFor("/admin/data-lab/index.html?embed=1", authenticatedCookie),
);
assertPasses(authenticatedAdminHtmlEmbed, "authenticated admin HTML embed");

const publicIbEmbed = await middleware(
  requestFor("/ib/ib-helper/index.html?embed=1"),
);
assertPasses(publicIbEmbed, "public IB helper embed");

console.log("admin-static-auth-guard PASS");
