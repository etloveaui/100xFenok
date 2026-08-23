#!/usr/bin/env node
/**
 * Every product route is either in the sitemap or says why not.
 *
 * Five of the twenty-seven string paths in ROUTES were absent from
 * SITEMAP_PRODUCT_ROUTES on 2026-08-23. Two carried a reason in a code comment,
 * which no check can read; three carried none at all and served 200 live, so
 * three working public pages were unlisted and nothing recorded whether that was
 * a decision. This makes the answer machine-readable and mandatory.
 *
 * It deliberately does NOT judge which answer is right. A route declared
 * `undecided` passes here and is surfaced by the summary line, because a gate
 * that blocks CI on an open product question just gets disabled.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..", "100xfenok-next");
const tsx = resolve(app, "node_modules/.bin/tsx");
if (!existsSync(tsx)) {
  console.error("test-sitemap-coverage: tsx binary missing at", tsx);
  process.exit(1);
}

const probe = `
  import { ROUTES, SITEMAP_PRODUCT_ROUTES, SITEMAP_EXCLUSIONS } from "./src/lib/routes.ts";
  console.log(JSON.stringify({
    routes: Object.fromEntries(Object.entries(ROUTES).filter(([, v]) => typeof v === "string")),
    sitemap: SITEMAP_PRODUCT_ROUTES.map((e) => e.path),
    exclusions: SITEMAP_EXCLUSIONS,
  }));
`;
const raw = execFileSync(tsx, ["-e", probe], { cwd: app, encoding: "utf8" });
const { routes, sitemap, exclusions } = JSON.parse(raw.trim().split("\n").pop());

const sitemapPaths = new Set(sitemap);
const failures = [];
const undecided = [];

for (const [key, path] of Object.entries(routes)) {
  const listed = sitemapPaths.has(path);
  const excused = Object.hasOwn(exclusions, key);
  if (listed && excused) {
    failures.push(`${key} (${path}) is in the sitemap AND carries an exclusion; one of the two is wrong`);
    continue;
  }
  if (!listed && !excused) {
    failures.push(`${key} (${path}) is in neither the sitemap nor SITEMAP_EXCLUSIONS; decide and declare it`);
    continue;
  }
  if (excused) {
    const reason = exclusions[key];
    if (typeof reason !== "string" || reason.trim().length < 20) {
      failures.push(`${key}: an exclusion needs a reason a reader can act on, got ${JSON.stringify(reason)}`);
    } else if (reason.startsWith("undecided")) {
      undecided.push(key);
    }
  }
}

for (const key of Object.keys(exclusions)) {
  if (!Object.hasOwn(routes, key)) {
    failures.push(`SITEMAP_EXCLUSIONS names ${key}, which is not a ROUTES key`);
  }
}

const orphans = sitemap.filter((p) => !Object.values(routes).includes(p));
for (const p of orphans) failures.push(`sitemap lists ${p}, which no ROUTES entry produces`);

if (failures.length > 0) {
  console.error("test-sitemap-coverage: FAIL");
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
const counts = `${Object.keys(routes).length} routes, ${sitemapPaths.size} listed, ${Object.keys(exclusions).length} excluded`;
console.log(
  undecided.length > 0
    ? `test-sitemap-coverage: ok — ${counts}; ${undecided.length} still UNDECIDED (${undecided.join(", ")})`
    : `test-sitemap-coverage: ok — ${counts}`,
);
