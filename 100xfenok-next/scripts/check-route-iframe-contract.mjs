#!/usr/bin/env node
/**
 * #296 route-backed iframe live-equivalence gate.
 *
 * Reads the canonical QA route catalog, then checks a local Next.js runtime:
 * route HTML -> iframe src -> public legacy asset with ?embed=1.
 * The admin scope also checks static asset authentication at the live edge.
 * This is read-only and localhost-only by default.
 */

import { pathToFileURL } from "node:url";
import { EXPECTED_IFRAME_SRC_BY_ROUTE } from "./qa-route-catalog.mjs";
import { DEPLOY_SMOKE_ATTEMPTS, fetchTextWithBoundedRetry } from "./deploy-smoke-retry.mjs";
import { liveRequestHeaders } from "../../scripts/lib/live-request-headers.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:3105";
const REQUEST_TIMEOUT_MS = Number(process.env.QA_ROUTE_IFRAME_TIMEOUT_MS ?? 15000);
const ROUTE_FETCH_RETRY_DELAY_MS = Number(process.env.QA_ROUTE_IFRAME_RETRY_DELAY_MS ?? 1500);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.QA_BASE_URL ?? process.env.QA_ROUTE_IFRAME_BASE_URL ?? DEFAULT_BASE_URL,
    json: false,
    scope: process.env.QA_ROUTE_IFRAME_SCOPE ?? "all",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--base-url") {
      args.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      args.baseUrl = arg.slice("--base-url=".length);
      continue;
    }
    if (arg === "--scope") {
      args.scope = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--scope=")) {
      args.scope = arg.slice("--scope=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function normalizeScope(rawScope) {
  const scope = String(rawScope ?? "all").trim().toLowerCase();
  if (["all", "public", "admin", "admin-static"].includes(scope)) return scope;
  throw new Error(`unknown scope: ${rawScope}`);
}

function normalizeBaseUrl(rawBaseUrl) {
  const url = new URL(rawBaseUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function assertLocalBaseUrl(baseUrl) {
  const host = baseUrl.hostname.toLowerCase();
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (localHosts.has(host) || host.endsWith(".localhost")) return;
  if (process.env.QA_ROUTE_IFRAME_ALLOW_REMOTE === "1") return;
  throw new Error(`refusing non-local QA base URL: ${baseUrl.origin}`);
}

function withTimeout(operation, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return operation(controller.signal).finally(() => clearTimeout(timer)).catch((error) => {
    if (error?.name === "AbortError") throw new Error(`${label} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw error;
  });
}

async function fetchAdminSessionCookie(baseUrl) {
  const password = process.env.QA_ADMIN_PASSWORD;
  if (!password) return process.env.QA_ADMIN_SESSION_COOKIE ?? "";

  const response = await withTimeout(
    (signal) => fetch(new URL("/api/admin/session/", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      redirect: "manual",
      signal,
    }),
    "POST /api/admin/session/",
  );
  if (!response.ok) {
    throw new Error(`admin session login returned ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/\bfenok_admin_session=[^;]+/);
  if (!match) {
    throw new Error("admin session login did not return fenok_admin_session cookie");
  }
  return match[0];
}

// Intro-first mode redirects a page request without the browse cookie to
// /intro before the admin layout sees the session, so every request carries
// fx_browse=1, as in the mobile UX contract.
function requestHeaders(cookieHeader) {
  return { Cookie: cookieHeader ? `${cookieHeader}; fx_browse=1` : "fx_browse=1" };
}

export async function fetchRouteHtml(baseUrl, route, cookieHeader, options = {}) {
  const url = new URL(route, baseUrl);
  const { response, text } = await fetchTextWithBoundedRetry(
    url,
    {
      headers: requestHeaders(cookieHeader),
      redirect: "follow",
    },
    {
      attempts: options.attempts ?? DEPLOY_SMOKE_ATTEMPTS,
      delayMs: options.delayMs ?? ROUTE_FETCH_RETRY_DELAY_MS,
      fetchImpl: options.fetchImpl,
      label: `GET ${route}`,
      sleep: options.sleep,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    },
  );
  return {
    status: response.status,
    finalUrl: response.url,
    text,
  };
}

export async function fetchAssetStatus(baseUrl, iframeSrc, cookieHeader, options = {}) {
  const url = new URL(iframeSrc.replaceAll("&amp;", "&"), baseUrl);
  const { response } = await fetchTextWithBoundedRetry(
    url,
    {
      method: "HEAD",
      headers: requestHeaders(cookieHeader),
      redirect: "manual",
    },
    {
      attempts: options.attempts ?? DEPLOY_SMOKE_ATTEMPTS,
      delayMs: options.delayMs ?? ROUTE_FETCH_RETRY_DELAY_MS,
      fetchImpl: options.fetchImpl,
      label: `HEAD ${url.pathname}${url.search}`,
      sleep: options.sleep,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    },
  );
  return response.status;
}

const ADMIN_STATIC_PATHS = [
  "/admin/DEV.md",
  "/admin/data-lab/index.html?embed=1",
  "/admin/data-lab/app/renderer.js",
];
const PUBLIC_STATIC_PATH = "/ib/ib-helper/index.html?embed=1";
const ADMIN_IMAGE_SOURCE = "/admin/design-lab/screenshots/figma-profile-avatar.jpg";
const ADMIN_IMAGE_HOST_ALIAS = `/\\foreign.invalid${ADMIN_IMAGE_SOURCE}`;
const PUBLIC_IMAGE_SOURCE = "/pwa-icon-192-v6.png";

export async function fetchStaticProbe(baseUrl, pathname, cookieHeader = "", options = {}) {
  const url = new URL(pathname, baseUrl);
  const { response, text } = await fetchTextWithBoundedRetry(
    url,
    {
      method: "GET",
      headers: requestHeaders(cookieHeader),
      redirect: "manual",
    },
    {
      attempts: options.attempts ?? DEPLOY_SMOKE_ATTEMPTS,
      delayMs: options.delayMs ?? ROUTE_FETCH_RETRY_DELAY_MS,
      fetchImpl: options.fetchImpl,
      label: `GET ${url.pathname}${url.search}`,
      sleep: options.sleep,
      timeoutMs: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    },
  );
  return {
    status: response.status,
    location: response.headers.get("location"),
    bodyBytes: Buffer.byteLength(text),
  };
}

export function staticProbeErrors(baseUrl, pathname, result, expected) {
  const label = `${expected} ${pathname}`;
  if (expected === "authenticated" || expected === "public") {
    return result.status === 200 && result.bodyBytes > 0
      ? []
      : [`${label}: expected nonempty HTTP 200, got ${result.status} (${result.bodyBytes} bytes)`];
  }
  if (result.status < 300 || result.status >= 400 || !result.location) {
    return [`${label}: expected redirect without protected bytes, got ${result.status}`];
  }
  if (result.bodyBytes !== 0) {
    return [`${label}: redirect carried ${result.bodyBytes} protected byte(s)`];
  }
  const target = new URL(result.location, baseUrl);
  const expectedPath = pathname.startsWith("/admin/data-lab/index.html")
    ? "/admin/data-lab"
    : "/admin";
  const validTarget = target.origin === baseUrl.origin
    && (target.pathname === expectedPath || target.pathname === `${expectedPath}/`);
  return validTarget ? [] : [`${label}: unexpected redirect target ${target.origin}${target.pathname}`];
}

export async function fetchImageOptimizerProbe(baseUrl, source, options = {}) {
  const url = new URL("/_next/image/", baseUrl);
  url.searchParams.set("url", source);
  url.searchParams.set("w", "640");
  url.searchParams.set("q", "75");
  return withTimeout(async (signal) => {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "GET",
      headers: { ...liveRequestHeaders(), ...requestHeaders("") },
      redirect: "manual",
      signal,
    });
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      bodyBytes: body.byteLength,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
    };
  }, `GET ${url.pathname} for ${source}`);
}

export function imageOptimizerProbeErrors(source, result, expected) {
  if (expected === "denied") {
    return result.status === 403 && result.bodyBytes === 0 && /\bno-store\b/i.test(result.cacheControl ?? "")
      ? []
      : [`optimizer ${source}: expected empty HTTP 403 with no-store, got ${result.status} (${result.bodyBytes} bytes, cache=${result.cacheControl})`];
  }
  return result.status === 200 && result.bodyBytes > 0 && /^image\//i.test(result.contentType ?? "")
    ? []
    : [`optimizer ${source}: expected nonempty public image HTTP 200, got ${result.status} (${result.bodyBytes} bytes, type=${result.contentType})`];
}

async function checkAdminStaticBoundary(baseUrl, adminCookie) {
  const rows = [];
  const errors = [];
  const probes = [
    ...ADMIN_STATIC_PATHS.flatMap((pathname) => [
      { pathname, cookie: "", expected: "anonymous" },
      { pathname, cookie: "fenok_admin_session=malformed", expected: "malformed" },
    ]),
    { pathname: PUBLIC_STATIC_PATH, cookie: "", expected: "public" },
    ...(adminCookie ? ADMIN_STATIC_PATHS.map((pathname) => ({
      pathname, cookie: adminCookie, expected: "authenticated",
    })) : []),
    ...(adminCookie ? ADMIN_STATIC_PATHS.map((pathname) => ({
      pathname, cookie: "", expected: "anonymous-recheck",
    })) : []),
  ];
  for (const { pathname, cookie, expected } of probes) {
    try {
      const result = await fetchStaticProbe(baseUrl, pathname, cookie);
      rows.push({ pathname, expected, ...result });
      errors.push(...staticProbeErrors(baseUrl, pathname, result, expected));
    } catch (error) {
      errors.push(`${expected} ${pathname}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const [source, expected] of [
    [ADMIN_IMAGE_SOURCE, "denied"],
    [ADMIN_IMAGE_HOST_ALIAS, "denied"],
    [PUBLIC_IMAGE_SOURCE, "public"],
  ]) {
    try {
      const result = await fetchImageOptimizerProbe(baseUrl, source);
      rows.push({ pathname: "/_next/image/", source, expected, ...result });
      errors.push(...imageOptimizerProbeErrors(source, result, expected));
    } catch (error) {
      errors.push(`optimizer ${source}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { rows, errors };
}

export function firstIframeSrc(html) {
  return html.match(/<iframe\b[^>]*\bsrc="([^"]+)"/i)?.[1] ?? null;
}

function expectedEmbedSrc(targetPath) {
  const glue = targetPath.includes("?") ? "&" : "?";
  return `${targetPath}${glue}embed=1`;
}

function isAdminRoute(route) {
  return route === "/admin" || route.startsWith("/admin/");
}

function normalizePathAndSearch(src, baseUrl) {
  const url = new URL(src.replaceAll("&amp;", "&"), baseUrl);
  return `${url.pathname}${url.search}`;
}

export function checkIframeTarget(baseUrl, route, expectedTarget, iframeSrc) {
  const actualUrl = new URL(iframeSrc.replaceAll("&amp;", "&"), baseUrl);
  const expectedUrl = new URL(expectedTarget, baseUrl);
  const errors = [];

  if (actualUrl.pathname !== expectedUrl.pathname) {
    errors.push(`iframe path mismatch: actual=${actualUrl.pathname} expected=${expectedUrl.pathname}`);
  }
  if (actualUrl.searchParams.get("embed") !== "1") {
    errors.push(`iframe must include embed=1: actual=${actualUrl.pathname}${actualUrl.search}`);
  }

  return errors.map((detail) => `${route}: ${detail}`);
}

function printJson(report) {
  console.log(JSON.stringify(report, null, 2));
}

function fail(errors, report, json) {
  if (json) printJson(report);
  console.error(`[qa:route-iframe-contract] failed (${errors.length} violation(s))`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scope = normalizeScope(args.scope);
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  assertLocalBaseUrl(baseUrl);
  const adminCookie = scope === "public" || scope === "admin-static"
    ? ""
    : await fetchAdminSessionCookie(baseUrl);

  const rows = [];
  const errors = [];
  const allEntries = Object.entries(EXPECTED_IFRAME_SRC_BY_ROUTE);
  const entries = scope === "admin-static" ? [] : allEntries.filter(([route]) => {
    const adminRoute = isAdminRoute(route);
    if (scope === "public") return !adminRoute;
    if (scope === "admin") return adminRoute;
    return true;
  });

  if (entries.length === 0 && scope !== "admin-static") {
    throw new Error(`route iframe scope selected zero routes: ${scope}`);
  }

  const staticBoundary = scope === "public"
    ? { rows: [], errors: [] }
    : await checkAdminStaticBoundary(baseUrl, adminCookie);
  errors.push(...staticBoundary.errors);

  for (const [route, expectedTarget] of entries) {
    try {
      const routeResponse = await fetchRouteHtml(baseUrl, route, adminCookie);
      const iframeSrc = firstIframeSrc(routeResponse.text);
      const row = {
        route,
        expected_target: expectedTarget,
        expected_embed_src: expectedEmbedSrc(expectedTarget),
        route_status: routeResponse.status,
        final_url: routeResponse.finalUrl,
        iframe_src: iframeSrc ? normalizePathAndSearch(iframeSrc, baseUrl) : null,
        asset_status: null,
      };
      rows.push(row);

      if (routeResponse.status < 200 || routeResponse.status >= 300) {
        errors.push(`${route}: route returned ${routeResponse.status}`);
        continue;
      }
      if (!iframeSrc) {
        errors.push(`${route}: route HTML has no iframe`);
        continue;
      }

      const targetErrors = checkIframeTarget(baseUrl, route, expectedTarget, iframeSrc);
      errors.push(...targetErrors);
      if (targetErrors.length > 0) continue;

      const assetStatus = await fetchAssetStatus(baseUrl, iframeSrc, adminCookie);
      row.asset_status = assetStatus;
      if (assetStatus < 200 || assetStatus >= 300) {
        errors.push(`${route}: iframe asset returned ${assetStatus}`);
      }
    } catch (error) {
      errors.push(`${route}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const report = {
    ok: errors.length === 0,
    base_url: baseUrl.origin,
    scope,
    admin_cookie: Boolean(adminCookie),
    routes_checked: entries.length,
    routes_total: allEntries.length,
    rows,
    static_rows: staticBoundary.rows,
    errors,
  };

  if (errors.length > 0) fail(errors, report, args.json);
  if (args.json) {
    printJson(report);
  } else {
    console.log(`[qa:route-iframe-contract] OK scope=${scope} routes=${entries.length} static=${staticBoundary.rows.length} base=${baseUrl.origin}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[qa:route-iframe-contract] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
