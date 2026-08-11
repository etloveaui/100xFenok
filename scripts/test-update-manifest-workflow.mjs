#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for update-manifest.yml
// (#366 step 4). The central reconciler owns no lane but commits many admin
// control-plane artifacts; every one must be covered by a registry lane
// declaration or a declared exception.
//
// The S1-S14 projection stack now lives in ONE shared runner invoked by both
// the initial path and the push-retry loop, so the ETF/KPI generation-order
// contract is asserted against scripts/update-manifest-projections.sh instead
// of duplicated workflow blocks.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowPath = new URL("../.github/workflows/update-manifest.yml", import.meta.url);
const runnerPath = new URL("../scripts/update-manifest-projections.sh", import.meta.url);
const workflowText = fs.readFileSync(workflowPath, "utf8");
const runnerText = fs.readFileSync(runnerPath, "utf8");
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
const runnerLines = runnerText.split("\n");
const exactLineIndices = (lines, needle) => lines
  .map((line, index) => ({ line: line.trim(), index }))
  .filter((item) => item.line === needle)
  .map((item) => item.index);
for (const source of [workflowLines, runnerLines]) {
  for (const command of [
    "node scripts/build-rim-index.mjs",
    "node scripts/build-rim-index-five-canonical.mjs",
    "node scripts/check-rim-index-five-canonical.mjs",
  ]) {
    assert.equal(exactLineIndices(source, command).length, 0, `retired RIM command must stay absent: ${command}`);
  }
}

// Both paths must reach the SAME runner (one source of truth).
assert.equal(exactLineIndices(workflowLines, "run: bash scripts/update-manifest-projections.sh").length, 1,
  "initial path must invoke the shared runner exactly once");
assert.equal(exactLineIndices(workflowLines, "bash scripts/update-manifest-projections.sh").length, 1,
  "retry path must invoke the shared runner exactly once");

// ETF/KPI generation order lives in the runner exactly once.
const etfBuilds = exactLineIndices(runnerLines, "node scripts/build-fenok-etf-signals.mjs");
const actionBuilds = exactLineIndices(runnerLines, "node scripts/build-fenok-etf-action-index.mjs");
const coreChecks = exactLineIndices(runnerLines, "node scripts/build-fenok-etf-core-daily-basket.mjs --check");
assert.equal(etfBuilds.length, 1, "runner must retain ETF signal generation exactly once");
assert.equal(actionBuilds.length, 1, "runner must retain ETF action-index generation exactly once");
assert.equal(coreChecks.length, 1, "runner must retain ETF core-basket validation exactly once");
for (const etfIndex of etfBuilds) {
  assert.equal(runnerLines[etfIndex + 1]?.trim(), "npm --prefix 100xfenok-next run build:history-gap-daily1y",
    `history-gap refresh must immediately follow ETF signal generation at runner line ${etfIndex + 1}`);
  assert.equal(runnerLines[etfIndex + 2]?.trim(), "node scripts/build-fenok-etf-action-index.mjs",
    `ETF action-index generation must immediately follow history-gap refresh at runner line ${etfIndex + 2}`);
}
for (const actionIndex of actionBuilds) {
  assert.equal(runnerLines[actionIndex + 1]?.trim(), "node scripts/build-fenok-etf-core-daily-basket.mjs --check",
    `ETF core-basket validation must immediately follow ETF action-index generation at runner line ${actionIndex + 1}`);
}
const kpiBuilds = exactLineIndices(runnerLines, "npm --prefix 100xfenok-next run build:fenok-data-health-kpi");
assert.equal(kpiBuilds.length, 1, "runner must build KPI exactly once");
for (const kpiIndex of kpiBuilds) {
  const precedingCoreCheck = coreChecks.filter((index) => index < kpiIndex).at(-1);
  assert.ok(precedingCoreCheck !== undefined, `KPI at runner line ${kpiIndex + 1} must have a preceding ETF core-basket validation`);
  assert.ok(precedingCoreCheck < kpiIndex, `ETF core-basket validation must run before KPI at runner line ${kpiIndex + 1}`);
}

const packageJson = JSON.parse(fs.readFileSync(new URL("../100xfenok-next/package.json", import.meta.url), "utf8"));
assert.equal(packageJson.scripts["build:rim-five-canonical"], "node ../scripts/build-rim-index-five-canonical.mjs");
assert.equal(
  packageJson.scripts["qa:rim-five-canonical"],
  "node ../scripts/test-check-rim-index-five-canonical.mjs && node ../scripts/test-build-feno-rim-five-index-canonical.mjs && node ../scripts/check-rim-index-five-canonical.mjs",
);

console.log("test-update-manifest-workflow: ok");
