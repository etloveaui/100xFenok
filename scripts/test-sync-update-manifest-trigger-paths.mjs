#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { replaceTriggerPathsBlock, renderTriggerPathsBlock } from "./sync-update-manifest-trigger-paths.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(root, ".github/workflows/update-manifest.yml");
const manifestPath = path.join(root, "data/admin/lane-commit-manifest.json");
const scriptPath = path.join(root, "scripts/sync-update-manifest-trigger-paths.mjs");
const startMarker = "      # BEGIN GENERATED lane-commit-manifest trigger_paths";
const endMarker = "      # END GENERATED lane-commit-manifest trigger_paths";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const triggerPaths = manifest.update_manifest.trigger_paths;
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.equal(triggerPaths.length, 46);
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
assert.equal(changedSetIncluded(["data/macro/fred-macro.json"]), true, "eligible-only push must trigger");
assert.equal(changedSetIncluded(negatives.map(representative)), false, "excluded-only push must not trigger");
assert.equal(changedSetIncluded([representative(negatives[0]), "scripts/update-manifest.py"]), true, "mixed push with one eligible path must trigger");

const directDispatchWorkflows = [
  "build-stocks-analyzer.yml",
  "fenok-edge-daily.yml",
  "fenok-edge-krx-daily.yml",
  "fetch-defillama.yml",
  "fetch-fdic.yml",
  "fetch-fenok-private-options.yml",
  "fetch-fred-banking.yml",
  "fetch-fred-macro.yml",
  "fetch-fred-yardeni.yml",
  "fetch-sentiment.yml",
  "fetch-stockanalysis.yml",
  "fetch-treasury-tga.yml",
  "fetch-yahoo-ticker.yml",
  "fetch-yf-finance.yml",
  "slickcharts-history.yml",
];
for (const workflowFile of directDispatchWorkflows) {
  const text = fs.readFileSync(path.join(root, ".github/workflows", workflowFile), "utf8");
  assert.match(text, /gh workflow run update-manifest\.yml/, `${workflowFile} must retain its direct dispatch`);
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
