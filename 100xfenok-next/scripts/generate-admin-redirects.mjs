#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ADMIN_CANONICAL_REDIRECT_ROUTES } from "./qa-route-catalog.mjs";

export const ADMIN_REDIRECTS_START = "# BEGIN GENERATED ADMIN REDIRECTS";
export const ADMIN_REDIRECTS_END = "# END GENERATED ADMIN REDIRECTS";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REDIRECTS_PATH = path.join(APP_ROOT, "public", "_redirects");

export function validateAdminCanonicalRoutes(routes) {
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new Error("admin canonical routes must be a non-empty array");
  }
  const seen = new Set();
  for (const route of routes) {
    if (
      typeof route !== "string"
      || (route !== "/admin" && !route.startsWith("/admin/"))
      || route.endsWith("/")
      || route.includes("?")
      || route.includes("#")
      || /\s/.test(route)
    ) {
      throw new Error(`invalid admin canonical route: ${String(route)}`);
    }
    if (seen.has(route)) throw new Error(`duplicate admin canonical route: ${route}`);
    seen.add(route);
  }
  return routes;
}

export function renderAdminRedirectBlock(routes = ADMIN_CANONICAL_REDIRECT_ROUTES) {
  validateAdminCanonicalRoutes(routes);
  return [
    ADMIN_REDIRECTS_START,
    ...routes.map((route) => `${route} ${route}/ 308`),
    ADMIN_REDIRECTS_END,
  ].join("\n");
}

export function updateAdminRedirectBlock(content, routes = ADMIN_CANONICAL_REDIRECT_ROUTES) {
  const start = content.indexOf(ADMIN_REDIRECTS_START);
  const end = content.indexOf(ADMIN_REDIRECTS_END);
  const startIsStandalone = start >= 0
    && (start === 0 || content[start - 1] === "\n")
    && content[start + ADMIN_REDIRECTS_START.length] === "\n";
  const endIsStandalone = end > 0
    && content[end - 1] === "\n"
    && (
      end + ADMIN_REDIRECTS_END.length === content.length
      || content[end + ADMIN_REDIRECTS_END.length] === "\n"
    );
  if (
    start === -1
    || end === -1
    || start >= end
    || !startIsStandalone
    || !endIsStandalone
    || content.lastIndexOf(ADMIN_REDIRECTS_START) !== start
    || content.lastIndexOf(ADMIN_REDIRECTS_END) !== end
  ) {
    throw new Error("public/_redirects must contain exactly one ordered generated admin block with standalone markers");
  }
  return `${content.slice(0, start)}${renderAdminRedirectBlock(routes)}${content.slice(end + ADMIN_REDIRECTS_END.length)}`;
}

export function checkAdminRedirects(content, routes = ADMIN_CANONICAL_REDIRECT_ROUTES) {
  const expected = updateAdminRedirectBlock(content, routes);
  if (content !== expected) {
    throw new Error("public/_redirects admin block is stale; run npm run gen:admin-redirects");
  }
}

function main() {
  const mode = process.argv[2];
  if (!['--check', '--write'].includes(mode) || process.argv.length !== 3) {
    throw new Error("usage: generate-admin-redirects.mjs --check|--write");
  }
  const content = fs.readFileSync(REDIRECTS_PATH, "utf8");
  if (mode === "--check") {
    checkAdminRedirects(content);
    console.log(`PASS admin redirects (${ADMIN_CANONICAL_REDIRECT_ROUTES.length})`);
    return;
  }
  fs.writeFileSync(REDIRECTS_PATH, updateAdminRedirectBlock(content));
  console.log(`WROTE admin redirects (${ADMIN_CANONICAL_REDIRECT_ROUTES.length})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
