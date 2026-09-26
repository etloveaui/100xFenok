import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { normalizeShellPathname, resolveShellRoute } from "./shell-routes";

const SRC_ROOT = path.resolve(import.meta.dirname, "../..");
const APP_ROOT = path.join(SRC_ROOT, "app");

test("normalizes trailing slashes, queries and empty paths", () => {
  assert.equal(normalizeShellPathname("/screener/"), "/screener");
  assert.equal(normalizeShellPathname("/screener/?ticker=NVDA"), "/screener");
  assert.equal(normalizeShellPathname("/"), "/");
  assert.equal(normalizeShellPathname(""), "/");
  assert.equal(normalizeShellPathname(null), "/");
});

test("resolves static and dynamic shell routes", () => {
  assert.deepEqual(resolveShellRoute("/"), { active: "explore", title: "홈" });
  assert.equal(resolveShellRoute("/screener/")?.active, "screener");
  assert.equal(resolveShellRoute("/market-valuation/structure")?.title, "시장 구조");
  const stock = resolveShellRoute("/stock/nvda/");
  assert.equal(stock?.title, "NVDA");
  assert.equal(stock?.backHref, "/screener?ticker=NVDA");
  assert.equal(resolveShellRoute("/etfs/SPY")?.title, "SPY");
  assert.equal(resolveShellRoute("/etfs/compare")?.title, "ETF 비교");
  assert.equal(resolveShellRoute("/posts/2026/some-post")?.active, "posts");
});

test("keeps immersive and private surfaces out of the shell", () => {
  for (const pathname of ["/ib", "/intro", "/admin", "/admin/live", "/winddown", "/lab/canvas-plus/home", "/cache-reset"]) {
    assert.equal(resolveShellRoute(pathname), null, pathname);
  }
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function importsModule(source: string, file: string): boolean {
  const base = path.basename(file).replace(/\.tsx?$/, "");
  return new RegExp(`from\\s+["'][^"']*/${base}["']`).test(source);
}

function samplePathFor(pageFile: string): string {
  const segments = path
    .relative(APP_ROOT, path.dirname(pageFile))
    .split(path.sep)
    .filter((segment) => segment && !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith("[...") ? "sample/entry" : segment.startsWith("[") ? "NVDA" : segment));
  return `/${segments.join("/")}`;
}

// Drift guard: a page that renders <AppShell> but has no row in shell-routes.ts
// still works (AppShell draws its own chrome) but silently loses the persistent
// frame — the chrome would blink on every navigation to it again.
test("every page that renders AppShell has a shell route", () => {
  const files = walk(SRC_ROOT).filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"));
  const shellModules = files.filter(
    (file) => !file.endsWith(`${path.sep}AppShell.tsx`) && fs.readFileSync(file, "utf8").includes("<AppShell"),
  );
  const pages = walk(APP_ROOT).filter((file) => file.endsWith(`${path.sep}page.tsx`));
  const shellPages = pages.filter((page) => {
    const source = fs.readFileSync(page, "utf8");
    return source.includes("<AppShell") || shellModules.some((module) => module !== page && importsModule(source, module));
  });
  assert.ok(shellPages.length >= 25, `expected the product pages to render AppShell, found ${shellPages.length}`);
  const missing = shellPages
    .map((page) => samplePathFor(page))
    .filter((pathname) => resolveShellRoute(pathname) === null);
  assert.deepEqual(missing, [], `add these routes to SHELL_ROUTE_RULES in shell-routes.ts: ${missing.join(", ")}`);
});
