#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for update-manifest.yml
// (#366 step 4). The central reconciler owns no lane but commits many admin
// control-plane artifacts; every one must be covered by a registry lane
// declaration or a declared exception.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowPath = new URL("../.github/workflows/update-manifest.yml", import.meta.url);
const workflowText = fs.readFileSync(workflowPath, "utf8");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/update-manifest.yml",
});
assert.deepEqual(gate.lanes, [], "update-manifest is a central reconciler with no lane attribution");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.equal(gate.allowlist_count > 0, true, "update-manifest does commit admin control-plane artifacts");

const workflowLines = workflowText.split("\n");
const exactLines = (needle) => workflowLines
  .map((line, index) => ({ line: line.trim(), index }))
  .filter((item) => item.line === needle)
  .map((item) => item.index);
const rimBuilds = exactLines("node scripts/build-rim-index.mjs");
const fiveBuilds = exactLines("node scripts/build-rim-index-five-canonical.mjs");
const fiveChecks = exactLines("node scripts/check-rim-index-five-canonical.mjs");
assert.ok(rimBuilds.length >= 2, "normal and retry paths must each retain a build-rim-index invocation");
assert.equal(fiveBuilds.length, rimBuilds.length, "each build-rim-index call needs a five-index builder");
assert.equal(fiveChecks.length, rimBuilds.length, "each build-rim-index call needs the five-index validator");
for (const buildIndex of rimBuilds) {
  assert.equal(workflowLines[buildIndex + 1]?.trim(), "node scripts/build-rim-index-five-canonical.mjs",
    `five-index builder must immediately follow build-rim-index at line ${buildIndex + 1}`);
  assert.equal(workflowLines[buildIndex + 2]?.trim(), "node scripts/check-rim-index-five-canonical.mjs",
    `five-index validator must immediately follow builder at line ${buildIndex + 1}`);
}

const kpiBuilds = exactLines("npm --prefix 100xfenok-next run build:fenok-data-health-kpi");
assert.equal(kpiBuilds.length, 2, "normal and retry paths must each build KPI once");
for (const kpiIndex of kpiBuilds) {
  const precedingCheck = fiveChecks.filter((index) => index < kpiIndex).at(-1);
  assert.ok(precedingCheck !== undefined, `KPI at line ${kpiIndex + 1} must have a preceding five-index validator`);
  assert.ok(precedingCheck < kpiIndex, `five-index validator must run before KPI at line ${kpiIndex + 1}`);
}

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
assert.equal(packageJson.scripts["build:rim-five-canonical"], "node ../scripts/build-rim-index-five-canonical.mjs");
assert.equal(
  packageJson.scripts["qa:rim-five-canonical"],
  "node ../scripts/test-check-rim-index-five-canonical.mjs && node ../scripts/test-build-feno-rim-five-index-canonical.mjs && node ../scripts/check-rim-index-five-canonical.mjs",
);

console.log("test-update-manifest-workflow: ok");
