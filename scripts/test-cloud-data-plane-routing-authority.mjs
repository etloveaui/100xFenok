#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

import { derivedPrivateFileOutputs } from "./lib/derived-asset-registry.mjs";
import {
  FINAL_WORKER_FIRST_PATTERNS,
  PRIVATE_PUBLIC_PATHS,
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
  "/data/computed/*",
  "/data/damodaran/*",
  "/data/edgar-korean-summaries/*",
  "/data/indices/*",
  "/data/macro/*",
  "/data/sentiment/*",
  "/data/slickcharts/*",
  "/data/yardney/*",
  "/data/sec-13f/investors/griffin.json",
], "selective contract preserves the eight public families plus Griffin");
assert.equal(FINAL_WORKER_FIRST_PATTERNS.includes("/data/*"), false, "broad data glob is absent");
assert.equal(FINAL_WORKER_FIRST_PATTERNS.some((pattern) => pattern.startsWith("!")), false, "no negative override can bypass Worker-first");
assert.equal(Object.isFrozen(FINAL_WORKER_FIRST_PATTERNS), true, "Worker-first list is immutable");
assert.equal(Object.isFrozen(PRIVATE_PUBLIC_PATHS), true, "private deny authority is immutable");

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

console.log("cloud-data-plane routing authority: ok (9 selective patterns; all private deny paths retained)");
