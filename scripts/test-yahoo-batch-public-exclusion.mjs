#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PRIVATE_DATA_SUPPLY_ROOTS,
  isPrivateDataSupplyPath,
} from "./build-phase2-closeout-indexes.mjs";
import { deriveForbiddenPrivateDataSupplyRoots } from "./lib/lane-routing.mjs";
import {
  FORBIDDEN_PUBLIC_TOKENS,
  forbiddenPublicTokensInText,
} from "../100xfenok-next/scripts/check-fenok-public-mirror-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privateRoot = "admin/yahoo-batch-quote-history";
const privateToken = `${privateRoot}/`;

const derivedPrivateRoots = deriveForbiddenPrivateDataSupplyRoots();
assert.equal(derivedPrivateRoots.includes(privateRoot), true);
assert.deepEqual(
  [...PRIVATE_DATA_SUPPLY_ROOTS].sort(),
  derivedPrivateRoots
    .map((root) => root.endsWith(".json") ? root : `${root}/`)
    .sort(),
  "usage-manifest private roots must stay in exact registry-derived parity",
);
assert.equal(PRIVATE_DATA_SUPPLY_ROOTS.includes(privateToken), true);
assert.equal(isPrivateDataSupplyPath(`${privateRoot}/tickers/AAPL.json`), true);
assert.equal(isPrivateDataSupplyPath("admin/yahoo-batch-quote-history-safe.json"), false);

assert.equal(FORBIDDEN_PUBLIC_TOKENS.includes(privateToken), true);
const syntheticInlineReference = JSON.stringify({
  payload_path: `${privateRoot}/tickers/AAPL.json`,
});
assert.deepEqual(forbiddenPublicTokensInText(syntheticInlineReference), [privateToken]);

const canonicalManifestPath = path.join(repoRoot, "data", "admin", "data-usage-manifest.json");
const publicManifestPath = path.join(
  repoRoot,
  "100xfenok-next",
  "public",
  "data",
  "admin",
  "data-usage-manifest.json",
);
const canonicalBytes = fs.readFileSync(canonicalManifestPath);
const publicBytes = fs.readFileSync(publicManifestPath);
assert.equal(canonicalBytes.equals(publicBytes), true, "data-usage manifests must remain byte-identical");
assert.deepEqual(forbiddenPublicTokensInText(canonicalBytes.toString("utf8")), []);

console.log("[test-yahoo-batch-public-exclusion] OK");
