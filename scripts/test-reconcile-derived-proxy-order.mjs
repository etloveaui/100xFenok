#!/usr/bin/env node
// Pipeline-order regression: the proxy coverage review generator must run inside
// reconcile:derived after every chain-resident input it reads, before public
// mirroring, and reconcile:verify must reach its proxy verification transitively
// WITHOUT re-running the generator (verification stays strict).

import assert from "node:assert/strict";
import fs from "node:fs";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"),
);
const scripts = packageJson.scripts;

const steps = (name) =>
  scripts[name].split("&&").map((entry) => entry.trim()).filter(Boolean);

const npmRun = /\bnpm run ([A-Za-z0-9:_-]+)/g;

// Transitive package-script reachability, same idiom as
// scripts/test-deploy-build-chain-no-retired-rim.mjs.
function reachableFrom(root) {
  const seen = new Set();
  const pending = [root];
  while (pending.length > 0) {
    const name = pending.pop();
    if (seen.has(name)) continue;
    assert.equal(typeof scripts[name], "string", `missing package script: ${name}`);
    seen.add(name);
    npmRun.lastIndex = 0;
    for (const match of scripts[name].matchAll(npmRun)) {
      if (!seen.has(match[1])) pending.push(match[1]);
    }
  }
  return seen;
}

const derived = steps("reconcile:derived");
const syncStatic = steps("sync-static");

const GENERATOR = "build:fenok-edge-proxy-coverage-review";
const GENERATOR_STEP = `npm run ${GENERATOR}`;
const PROXY_QA = "qa:fenok-edge-proxy-coverage-review";

// Chain-resident inputs of scripts/audit-fenok-edge-proxy-coverage.mjs:
// ledger via build:fenok-s0-source-ledger, signals via build:fenok-signals.
const CHAIN_RESIDENT_INPUTS = [
  "npm run build:fenok-signals",
  "npm run build:fenok-s0-source-ledger",
];

const generatorIndex = derived.indexOf(GENERATOR_STEP);
assert.notEqual(generatorIndex, -1, `reconcile:derived must include ${GENERATOR_STEP}`);
for (const input of CHAIN_RESIDENT_INPUTS) {
  const inputIndex = derived.indexOf(input);
  assert.notEqual(inputIndex, -1, `reconcile:derived must produce input: ${input}`);
  assert.ok(
    inputIndex < generatorIndex,
    `${input} must run before ${GENERATOR_STEP} (got ${inputIndex} vs ${generatorIndex})`,
  );
}

// Generation happens during sync-static (which drives reconcile:derived) and
// completes before the public mirror step, so refreshed inputs always reach a
// refreshed artifact before any later verification reads it.
const derivedIndex = syncStatic.indexOf("npm run reconcile:derived");
const mirrorIndex = syncStatic.findIndex((entry) => entry.includes("sync-public-data.mjs"));
assert.notEqual(derivedIndex, -1, "sync-static must run reconcile:derived");
assert.notEqual(mirrorIndex, -1, "sync-static must mirror public data");
assert.ok(
  derivedIndex < mirrorIndex,
  "reconcile:derived (incl. proxy generator) must finish before public mirroring",
);

// Verification reaches the proxy check transitively (via qa:fenok-edge-readiness)
// and must never regenerate the artifact itself.
const verifyReachable = reachableFrom("reconcile:verify");
assert.ok(
  verifyReachable.has(PROXY_QA),
  `reconcile:verify must reach ${PROXY_QA} transitively`,
);
assert.equal(
  verifyReachable.has(GENERATOR),
  false,
  "reconcile:verify must not re-run the generator (strict comparison)",
);

const derivedReachable = reachableFrom("reconcile:derived");
assert.ok(derivedReachable.has(GENERATOR), "reconcile:derived must reach the generator");

console.log(JSON.stringify({
  ok: true,
  suite: "reconcile-derived-proxy-order",
  generator_index: generatorIndex,
  input_indexes: Object.fromEntries(
    CHAIN_RESIDENT_INPUTS.map((input) => [input, derived.indexOf(input)]),
  ),
  derived_before_mirror: true,
  verify_reaches_proxy_qa: true,
  verify_does_not_regenerate: true,
}, null, 2));
