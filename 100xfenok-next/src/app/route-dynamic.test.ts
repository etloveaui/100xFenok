import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Every App Router page must render dynamically. On this OpenNext/Cloudflare
// deployment a statically prerendered page is served with s-maxage=31536000,
// and the client router's segment prefetch for it (next-router-segment-prefetch:
// /_tree) is re-requested about every 30 ms while a page that links to it is
// open. /research, linked from the shell nav on every page, did this: 39,983
// Worker requests in two hours on 2026-09-27 against a 100,000/day account
// quota; /changes looped the same way until it became force-dynamic.
// A page passes when it exports dynamic = "force-dynamic" or reads a dynamic
// API (searchParams, params, cookies(), headers()), which also opts it out of
// prerendering.
const APP_DIR = path.resolve(import.meta.dirname);
const DYNAMIC_EXPORT = /export const dynamic = ["']force-dynamic["']/;
const DYNAMIC_API = /\b(searchParams|params)\b|\bcookies\(|\bheaders\(/;

function pageFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pageFiles(full);
    return entry.name === "page.tsx" ? [full] : [];
  });
}

test("every app page renders dynamically (no prerendered page for the router to re-prefetch)", () => {
  const pages = pageFiles(APP_DIR);
  assert.ok(pages.length > 30, `expected the app's pages, found ${pages.length}`);
  const staticPages = pages
    .filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return !DYNAMIC_EXPORT.test(text) && !DYNAMIC_API.test(text);
    })
    .map((file) => path.relative(APP_DIR, file));
  assert.deepEqual(staticPages, [], `add export const dynamic = "force-dynamic" to: ${staticPages.join(", ")}`);
});
