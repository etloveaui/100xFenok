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
for (const command of [
  "node scripts/build-rim-index.mjs",
  "node scripts/build-rim-index-five-canonical.mjs",
  "node scripts/check-rim-index-five-canonical.mjs",
]) {
  assert.equal(exactLines(command).length, 0, `retired RIM command must stay absent: ${command}`);
}

const etfBuilds = exactLines("node scripts/build-fenok-etf-signals.mjs");
const actionBuilds = exactLines("node scripts/build-fenok-etf-action-index.mjs");
const coreChecks = exactLines("node scripts/build-fenok-etf-core-daily-basket.mjs --check");
assert.equal(etfBuilds.length, 2, "normal and retry paths must retain ETF signal generation");
assert.equal(actionBuilds.length, 2, "normal and retry paths must retain ETF action-index generation");
assert.equal(coreChecks.length, 2, "normal and retry paths must retain ETF core-basket validation");
for (const etfIndex of etfBuilds) {
  assert.equal(workflowLines[etfIndex + 1]?.trim(), "npm --prefix 100xfenok-next run build:history-gap-daily1y",
    `history-gap refresh must immediately follow ETF signal generation at line ${etfIndex + 1}`);
  assert.equal(workflowLines[etfIndex + 2]?.trim(), "node scripts/build-fenok-etf-action-index.mjs",
    `ETF action-index generation must immediately follow history-gap refresh at line ${etfIndex + 2}`);
}
for (const actionIndex of actionBuilds) {
  assert.equal(workflowLines[actionIndex + 1]?.trim(), "node scripts/build-fenok-etf-core-daily-basket.mjs --check",
    `ETF core-basket validation must immediately follow ETF action-index generation at line ${actionIndex + 1}`);
}

const kpiBuilds = exactLines("npm --prefix 100xfenok-next run build:fenok-data-health-kpi");
assert.equal(kpiBuilds.length, 2, "normal and retry paths must each build KPI once");
for (const kpiIndex of kpiBuilds) {
  const precedingCoreCheck = coreChecks.filter((index) => index < kpiIndex).at(-1);
  assert.ok(precedingCoreCheck !== undefined, `KPI at line ${kpiIndex + 1} must have a preceding ETF core-basket validation`);
  assert.ok(precedingCoreCheck < kpiIndex, `ETF core-basket validation must run before KPI at line ${kpiIndex + 1}`);
}

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
assert.equal(packageJson.scripts["build:rim-five-canonical"], "node ../scripts/build-rim-index-five-canonical.mjs");
assert.equal(
  packageJson.scripts["qa:rim-five-canonical"],
  "node ../scripts/test-check-rim-index-five-canonical.mjs && node ../scripts/test-build-feno-rim-five-index-canonical.mjs && node ../scripts/check-rim-index-five-canonical.mjs",
);

console.log("test-update-manifest-workflow: ok");
