#!/usr/bin/env node

// Compact API/source fence for the first canonical-only producer batch.
// Happy-path writes and untouched-mirror behavior belong to each producer's
// focused test; this check only prevents mirror paths or dual-write interfaces
// from returning to the producer implementations.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCERS = Object.freeze([
  "scripts/fetch-sentiment.mjs",
  "scripts/fetch-fred-banking.mjs",
  "scripts/fetch-treasury-tga.mjs",
  "scripts/fetch-yahoo-ticker.mjs",
  // fred-macro joined the batch on 2026-08-21. Its direct public write was
  // never staged by its lane or its manifest, and the public mirror contract
  // asserts that no lane stages the mirror, so the file stayed dirty after
  // every run and persist-cloud-publish-outcome refused for ten consecutive
  // runs. sync-public-data.mjs already produces the mirror at build time.
  "scripts/fetch-fred-macro.mjs",
  // The tracked FDIC twin is already retired; the producer must leave its
  // generated public URL to the same generic sync boundary.
  "scripts/fetch-fdic-tier1.mjs",
]);

const sources = Object.fromEntries(PRODUCERS.map((relativePath) => [
  relativePath,
  fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8"),
]));

for (const [relativePath, source] of Object.entries(sources)) {
  assert.doesNotMatch(source, /100xfenok-next/u, `${relativePath} references the public mirror root`);
  assert.doesNotMatch(source, /public[\\/]+data/u, `${relativePath} references a public/data mirror path`);
  assert.doesNotMatch(source, /\bpublicPaths?\b/u, `${relativePath} exposes a public-path producer interface`);
}

assert.match(sources["scripts/fetch-sentiment.mjs"], /runSentiment\(\{[\s\S]*?\boutputDir\s*=/u);
assert.doesNotMatch(sources["scripts/fetch-sentiment.mjs"], /\boutputDirs\b/u);
assert.match(sources["scripts/fetch-yahoo-ticker.mjs"], /export function publishYahooOutputAtomic\(/u);
assert.doesNotMatch(sources["scripts/fetch-yahoo-ticker.mjs"], /publishYahooOutputPairAtomic/u);

console.log(`producer public-write fence: ok (${PRODUCERS.length} canonical-only APIs)`);
