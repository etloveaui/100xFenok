#!/usr/bin/env node
/**
 * #296 route-backed iframe live-equivalence gate.
 *
 * Reads the canonical QA route catalog, then checks a local Next.js runtime:
 * route HTML -> iframe src -> public legacy asset with ?embed=1.
 * This is read-only and localhost-only by default.
 */

import { EXPECTED_IFRAME_SRC_BY_ROUTE } from "./qa-route-catalog.mjs";

const DEFAULT_BASE_URL = "http://127.0.0.1:3105";
const REQUEST_TIMEOUT_MS = Number(process.env.QA_ROUTE_IFRAME_TIMEOUT_MS ?? 15000);

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.QA_BASE_URL ?? process.env.QA_ROUTE_IFRAME_BASE_URL ?? DEFAULT_BASE_URL,
    json: false,
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
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
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

async function fetchRouteHtml(baseUrl, route) {
  const url = new URL(route, baseUrl);
  const response = await withTimeout(
    (signal) => fetch(url, { redirect: "follow", signal }),
    `GET ${route}`,
  );
  const text = await response.text();
  return {
    status: response.status,
    finalUrl: response.url,
    text,
  };
}

async function fetchAssetStatus(baseUrl, iframeSrc) {
  const url = new URL(iframeSrc.replaceAll("&amp;", "&"), baseUrl);
  const response = await withTimeout(
    (signal) => fetch(url, { method: "HEAD", redirect: "manual", signal }),
    `HEAD ${url.pathname}${url.search}`,
  );
  return response.status;
}

function firstIframeSrc(html) {
  return html.match(/<iframe\b[^>]*\bsrc="([^"]+)"/i)?.[1] ?? null;
}

function expectedEmbedSrc(targetPath) {
  const glue = targetPath.includes("?") ? "&" : "?";
  return `${targetPath}${glue}embed=1`;
}

function normalizePathAndSearch(src, baseUrl) {
  const url = new URL(src.replaceAll("&amp;", "&"), baseUrl);
  return `${url.pathname}${url.search}`;
}

function checkIframeTarget(baseUrl, route, expectedTarget, iframeSrc) {
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
  const baseUrl = normalizeBaseUrl(args.baseUrl);
  assertLocalBaseUrl(baseUrl);

  const rows = [];
  const errors = [];
  const entries = Object.entries(EXPECTED_IFRAME_SRC_BY_ROUTE);

  for (const [route, expectedTarget] of entries) {
    try {
      const routeResponse = await fetchRouteHtml(baseUrl, route);
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

      errors.push(...checkIframeTarget(baseUrl, route, expectedTarget, iframeSrc));
      const assetStatus = await fetchAssetStatus(baseUrl, iframeSrc);
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
    routes_checked: entries.length,
    rows,
    errors,
  };

  if (errors.length > 0) fail(errors, report, args.json);
  if (args.json) {
    printJson(report);
  } else {
    console.log(`[qa:route-iframe-contract] OK routes=${entries.length} base=${baseUrl.origin}`);
  }
}

main().catch((error) => {
  console.error(`[qa:route-iframe-contract] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
