#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  projectUpdateManifestTriggerPaths,
  replaceTriggerPathsBlock,
  renderTriggerPathsBlock,
} from "./sync-update-manifest-trigger-paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github/workflows/update-manifest.yml");
const manifestPath = path.join(root, "data/admin/lane-commit-manifest.json");
const scriptPath = path.join(root, "scripts/sync-update-manifest-trigger-paths.mjs");
const startMarker = "      # BEGIN GENERATED lane-commit-manifest trigger_paths";
const endMarker = "      # END GENERATED lane-commit-manifest trigger_paths";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const baseTriggerPaths = manifest.update_manifest.trigger_paths;
const triggerPaths = projectUpdateManifestTriggerPaths(baseTriggerPaths);
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.ok(baseTriggerPaths.length > 0);
assert.deepEqual(triggerPaths, baseTriggerPaths, "generated trigger paths must be exactly the canonical manifest paths");
assert.throws(
  () => projectUpdateManifestTriggerPaths([...baseTriggerPaths, "scripts/archive/RIM-five-audit.mjs"]),
  /RIM path token is forbidden/,
  "RIM path tokens must fail closed before workflow projection",
);
for (const entry of [
  "scripts/build-rim-index.mjs",
  "scripts/test-build-rim-index.mjs",
  "scripts/build-rim-index-five-canonical.mjs",
  "scripts/check-rim-index-five-canonical.mjs",
  "scripts/test-check-rim-index-five-canonical.mjs",
  "scripts/test-build-feno-rim-five-index-canonical.mjs",
  "100xfenok-next/package.json",
  "data/computed/rim-index/feno-index-rim-five-canonical-criteria.json",
]) {
  assert.equal(triggerPaths.includes(entry), false, `retired RIM-only trigger path must stay absent: ${entry}`);
}
assert.equal(triggerPaths.includes("data/computed/**"), false, "generic computed data must remain excluded");
const expectedBlock = [
  startMarker,
  ...triggerPaths.map((entry) => `      - '${entry.replaceAll("'", "''")}'`),
  endMarker,
].join("\n");
assert.equal(renderTriggerPathsBlock(triggerPaths), expectedBlock);
assert.ok(workflow.includes(expectedBlock), "committed push.paths block must exactly match the generated manifest order");
assert.throws(() => replaceTriggerPathsBlock("paths:\n", expectedBlock), /markers are missing/);
assert.throws(
  () => replaceTriggerPathsBlock(`${expectedBlock}\n${startMarker}\n${endMarker}`, expectedBlock),
  /markers are invalid/,
);
assert.throws(() => replaceTriggerPathsBlock(`${endMarker}\n${startMarker}`, expectedBlock), /markers are invalid/);

function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*")}$`);
}

function pathIncluded(candidate) {
  let included = false;
  for (const entry of triggerPaths) {
    const negative = entry.startsWith("!");
    if (globRegex(negative ? entry.slice(1) : entry).test(candidate)) included = !negative;
  }
  return included;
}

function representative(entry) {
  const pattern = entry.startsWith("!") ? entry.slice(1) : entry;
  return pattern.endsWith("/**") ? `${pattern.slice(0, -3)}/fixture.json` : pattern;
}

for (const entry of triggerPaths) {
  assert.ok(!entry.includes("*") || entry.endsWith("/**"), `unsupported path-filter grammar: ${entry}`);
  assert.equal(entry.slice(0, -3).includes("*"), false, `wildcards must be terminal /** only: ${entry}`);
}
const positives = triggerPaths.filter((entry) => !entry.startsWith("!"));
const negatives = triggerPaths.filter((entry) => entry.startsWith("!"));
for (const entry of positives) assert.equal(pathIncluded(representative(entry)), true, `${entry} must trigger`);
for (const entry of negatives) assert.equal(pathIncluded(representative(entry)), false, `${entry} must not self-trigger`);

const changedSetIncluded = (changedPaths) => changedPaths.some((candidate) => pathIncluded(candidate));
// The six coordinator-source families' owned canonical/admin paths are
// excluded (their completions drive coordinate-computed-signals instead);
// unrelated macro data stays eligible.
assert.equal(changedSetIncluded(["data/macro/yahoo-ticker.json"]), true, "eligible-only push must trigger");
assert.equal(changedSetIncluded(negatives.map(representative)), false, "excluded-only push must not trigger");
assert.equal(changedSetIncluded([representative(negatives[0]), "scripts/update-manifest.py"]), true, "mixed push with one eligible path must trigger");

// Exact owned commit paths of the six decoupled families must never implicitly
// trigger the full Update Manifest reconciliation.
for (const ownedPath of [
  "data/macro/fred-macro.json",
  "data/macro/tga.json",
  "data/macro/stablecoins.json",
  "data/macro/fred-banking-daily.json",
  "data/macro/fred-banking-weekly.json",
  "data/macro/fred-banking-monthly.json",
  "data/macro/fred-banking-quarterly.json",
  "data/macro/fdic-tier1.json",
  "data/sentiment/vix.json",
  "data/admin/fred_macro/index.json",
  "data/admin/treasury_tga/lkg/tga.json",
  "data/admin/defillama_stablecoins/index.json",
  "data/admin/fred_banking/lkg/daily.json",
  "data/admin/fdic_tier1/lkg/fdic_tier1.json",
  "data/admin/sentiment/current/cnn-fear-greed.json",
  "data/admin/sentiment/source-observations/crypto.json",
]) {
  assert.equal(pathIncluded(ownedPath), false, `${ownedPath} must not implicitly trigger Update Manifest`);
}

const liveCheck = spawnSync(process.execPath, [scriptPath, "--check"], { cwd: root, encoding: "utf8" });
assert.equal(liveCheck.status, 0, `${liveCheck.stderr}\n${liveCheck.stdout}`);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "update-manifest-trigger-paths-"));
const driftedWorkflow = path.join(tempRoot, "update-manifest.yml");
fs.writeFileSync(driftedWorkflow, workflow.replace("      - 'data/**'", "      - 'data/drift/**'"));
const driftCheck = spawnSync(process.execPath, [scriptPath, "--check", "--workflow", driftedWorkflow], { cwd: root, encoding: "utf8" });
assert.notEqual(driftCheck.status, 0);
assert.match(driftCheck.stderr, /generated trigger_paths block is stale/);

const staleManifestPath = path.join(tempRoot, "lane-commit-manifest.json");
const staleManifest = structuredClone(manifest);
staleManifest.update_manifest.trigger_paths[0] = "data/drift/**";
fs.writeFileSync(staleManifestPath, `${JSON.stringify(staleManifest, null, 2)}\n`);
const staleManifestCheck = spawnSync(process.execPath, [scriptPath, "--check", "--manifest", staleManifestPath], { cwd: root, encoding: "utf8" });
assert.notEqual(staleManifestCheck.status, 0);
assert.match(staleManifestCheck.stderr, /manifest trigger_paths are stale/);

const reorderedManifestPath = path.join(tempRoot, "lane-commit-manifest-reordered.json");
const reorderedManifest = structuredClone(manifest);
[reorderedManifest.update_manifest.trigger_paths[0], reorderedManifest.update_manifest.trigger_paths[1]] = [
  reorderedManifest.update_manifest.trigger_paths[1],
  reorderedManifest.update_manifest.trigger_paths[0],
];
fs.writeFileSync(reorderedManifestPath, `${JSON.stringify(reorderedManifest, null, 2)}\n`);
const reorderedManifestCheck = spawnSync(process.execPath, [scriptPath, "--check", "--manifest", reorderedManifestPath], { cwd: root, encoding: "utf8" });
assert.notEqual(reorderedManifestCheck.status, 0);
assert.match(reorderedManifestCheck.stderr, /manifest trigger_paths are stale/);

console.log("test-sync-update-manifest-trigger-paths: ok");
