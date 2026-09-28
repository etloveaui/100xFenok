#!/usr/bin/env node
/**
 * A redirect only works where the adapter can see it.
 *
 * Measured live on 2026-08-23 against the deployed Worker:
 *
 *   /briefing          redirect(),          config entry     -> 307
 *   /filings/nvda-10k  redirect(),          config entry     -> 307
 *   /market            permanentRedirect(), NO config entry  -> 200 + meta refresh
 *   /live-bench        redirect(),          NO config entry  -> 200 + meta refresh
 *
 * The pair rules out both obvious explanations: /filings/nvda-10k exports a
 * metadata object and still emits 307, and /live-bench uses plain redirect()
 * and still degrades. What separates them is only where the redirect is
 * DECLARED. A page component that calls redirect() and has no next.config entry
 * is rendered by the adapter, which emits the destination as a meta refresh
 * inside a 200 body - and a 200 is indexable while a redirect is not.
 *
 * So: every page whose whole job is to redirect must also be declared in
 * next.config.ts. This checks that statically; it cannot see the deployment.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..", "100xfenok-next");
const appDir = join(app, "src/app");

const pages = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name === "page.tsx") pages.push(full);
  }
})(appDir);

// A redirect-only page: its default export body is a bare redirect call.
const REDIRECT_CALL = /\b(permanentRedirect|redirect)\s*\(/;
const redirectPages = [];
for (const file of pages) {
  const text = readFileSync(file, "utf8");
  if (!REDIRECT_CALL.test(text)) continue;
  // Ignore pages that merely redirect on a branch; we want the ones that do
  // nothing else. A body under ~25 non-import lines is that shape.
  const body = text
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("import ") && !l.trim().startsWith("//"));
  if (body.length > 25) continue;
  const route = "/" + relative(appDir, dirname(file)).replace(/\\/g, "/");
  redirectPages.push({ route: route === "/." ? "/" : route, file: relative(app, file) });
}

const config = readFileSync(join(app, "next.config.ts"), "utf8");
const declared = new Set([...config.matchAll(/source:\s*"([^"]+)"/g)].map((m) => m[1]));

const failures = [];
for (const { route, file } of redirectPages) {
  if (!declared.has(route)) {
    failures.push(
      `${file} redirects but ${route} has no next.config.ts redirects() entry; the adapter will serve it as 200 with a meta refresh`,
    );
  }
}

if (failures.length > 0) {
  console.error("test-redirect-declaration-site: FAIL");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log(
  `test-redirect-declaration-site: ok — ${redirectPages.length} redirect-only pages, all declared (${redirectPages.map((r) => r.route).join(", ")})`,
);
