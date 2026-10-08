#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

import { derivedPrivateFileOutputs } from "./lib/derived-asset-registry.mjs";
import { PLANE_ENROLLMENT_PRIVATE_DENY } from "../100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-enrollment.generated.mjs";
import {
  EXPLICIT_WORKER_FIRST_PATH_VALUES,
  FINAL_WORKER_FIRST_PATTERNS,
  PRIVATE_PUBLIC_PATHS,
  PRIVATE_PUBLIC_PATH_VALUES,
  deriveWorkerFirstPatterns,
} from "../100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs";

function extractRunWorkerFirstPatterns(source) {
  const match = source.match(/"run_worker_first"\s*:\s*\[([\s\S]*?)\]/u);
  assert.ok(match, "wrangler run_worker_first array exists");
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/gu)]
    .map(([, encoded]) => JSON.parse(`"${encoded}"`));
}

const wrangler = fs.readFileSync(new URL("../100xfenok-next/wrangler.jsonc", import.meta.url), "utf8");
assert.deepEqual(
  extractRunWorkerFirstPatterns(wrangler),
  FINAL_WORKER_FIRST_PATTERNS,
  "static Wrangler patterns must equal the derived final list",
);
assert.deepEqual(
  FINAL_WORKER_FIRST_PATTERNS,
  deriveWorkerFirstPatterns(),
  "final patterns must derive from generated enrollment authority",
);
assert.deepEqual(FINAL_WORKER_FIRST_PATTERNS, [
  "/data/briefing/*",
  "/data/computed/*",
  "/data/damodaran/*",
  "/data/earnings-overview/*",
  "/data/edgar-korean-summaries/*",
  "/data/global-scouter/*",
  "/data/indices/*",
  "/data/macro/*",
  "/data/sentiment/*",
  "/data/slickcharts/*",
  "/data/yardney/*",
  "/data/sec-13f/investors/griffin.json",
  "/admin/*",
], "selective contract preserves the eleven public families, Griffin, and the admin asset tree");
assert.equal(FINAL_WORKER_FIRST_PATTERNS.includes("/data/*"), false, "broad data glob is absent");
assert.equal(FINAL_WORKER_FIRST_PATTERNS.some((pattern) => pattern.startsWith("!")), false, "no negative override can bypass Worker-first");
assert.equal(Object.isFrozen(FINAL_WORKER_FIRST_PATTERNS), true, "Worker-first list is immutable");
assert.equal(Object.isFrozen(PRIVATE_PUBLIC_PATHS), true, "private deny authority is immutable");
assert.equal(Object.isFrozen(PRIVATE_PUBLIC_PATH_VALUES), true, "private deny paths are immutable");
assert.equal(Object.isFrozen(EXPLICIT_WORKER_FIRST_PATH_VALUES), true, "explicit worker-first paths are immutable");
assert.equal(
  FINAL_WORKER_FIRST_PATTERNS.includes("/admin/*"),
  true,
  "all admin assets must be forced through the Worker so the admin session gate runs",
);
for (const pathname of [
  "/admin/DEV.md",
  "/admin/data-lab/index.html",
  "/admin/data-lab/app/renderer.js",
  "/admin/design-lab/screenshots/figma-profile-avatar.jpg",
]) {
  assert.equal(
    FINAL_WORKER_FIRST_PATTERNS.some((pattern) => pattern.endsWith("*")
      ? pathname.startsWith(pattern.slice(0, -1))
      : pathname === pattern),
    true,
    `${pathname} must be Worker-first`,
  );
}
assert.equal(
  FINAL_WORKER_FIRST_PATTERNS.some((pattern) => pattern.endsWith("*")
    ? "/ib/ib-helper/index.html".startsWith(pattern.slice(0, -1))
    : "/ib/ib-helper/index.html" === pattern),
  false,
  "public IB asset must remain asset-first",
);

const expectedDerivedPrivatePaths = derivedPrivateFileOutputs().map((relativePath) => `/${relativePath}`);
assert.deepEqual(
  PLANE_ENROLLMENT_PRIVATE_DENY,
  expectedDerivedPrivatePaths,
  "generated private deny export matches derived registry outputs",
);
assert.deepEqual(
  PRIVATE_PUBLIC_PATH_VALUES,
  [...new Set([...expectedDerivedPrivatePaths, "/data/sec-13f/investors/griffin.json"])].sort(),
  "final private deny authority is exactly derived outputs plus Griffin",
);

for (const relativePath of [
  "data/sec-13f/investors/griffin.json",
  ...derivedPrivateFileOutputs(),
]) {
  assert.equal(
    PRIVATE_PUBLIC_PATHS.has(`/${relativePath}`),
    true,
    `private deny authority must retain /${relativePath}`,
  );
}

console.log("cloud-data-plane routing authority: ok (12 selective patterns; all private deny paths retained)");
