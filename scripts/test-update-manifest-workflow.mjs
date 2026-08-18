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

// One call site, inside the commit/retry step. The workflow used to compute the
// projection twice — once before the writer-critical section and once inside the
// retry after `git reset --hard origin/main` discarded the first result — so this
// contract existed to stop the two call sites drifting. With a single call site
// there is nothing left to drift, and the stronger property is that the shared
// runner is invoked exactly once and only after the reset.
assert.equal(exactLineIndices(workflowLines, "run: bash scripts/update-manifest-projections.sh").length, 0,
  "the pre-commit projection pass must stay deleted; it recomputes under the writer lock for nothing");
const runnerCallSites = exactLineIndices(workflowLines, "bash scripts/update-manifest-projections.sh");
assert.equal(runnerCallSites.length, 1,
  "the shared runner must be invoked exactly once");
const resetIndices = exactLineIndices(workflowLines, "git reset --hard origin/main");
assert.equal(resetIndices.length, 1, "the retry loop must reset to origin/main exactly once");
assert.equal(resetIndices[0] < runnerCallSites[0], true,
  "the shared runner must run after the reset, so the commit is a function of current origin/main");

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

// StockAnalysis ETF cloud overlay: Update Manifest materializes the verified
// cloud generation EXACTLY ONCE (before S1), both projection passes consume
// that same external snapshot through the shared runner, and the runner owns
// the backup/overlay/restore + scoped git-clean contract per pass. The runner
// never re-materializes and never stages raw canonical ETF files.
{
  const materializerCommand = "node scripts/materialize-cloud-data-plane-family.mjs \\";
  const materializeCalls = exactLineIndices(workflowLines, materializerCommand);
  assert.equal(materializeCalls.length, 1,
    "workflow must materialize the verified cloud overlay exactly once per job");
  for (const argument of [
    "--family stockanalysis-etf-detail \\",
    "--manifest-prefix data/stockanalysis/etfs/ \\",
  ]) {
    assert.equal(exactLineIndices(workflowLines, argument).length, 1,
      `workflow must pass the required materializer argument: ${argument}`);
  }
  const materializeIndex = materializeCalls[0];
  const initialRunnerIndex = exactLineIndices(workflowLines, "run: bash scripts/update-manifest-projections.sh")[0];
  const retryRunnerIndex = exactLineIndices(workflowLines, "bash scripts/update-manifest-projections.sh")[0];
  assert.ok(materializeIndex < initialRunnerIndex,
    "materialization must precede the first projection pass");
  assert.ok(materializeIndex < retryRunnerIndex,
    "materialization must precede the retry projection pass (reused snapshot)");
  assert.equal(workflowLines.filter((line) => line.includes("ETF_DETAIL_OVERLAY_ROOT")).length, 1,
    "the overlay root must be exported exactly once for both runner call sites");
  assert.equal(workflowLines.filter((line) => line.includes("ETF_DETAIL_OVERLAY_RECEIPT")).length, 1,
    "the verified receipt path must be exported exactly once for both runner call sites");

  for (const marker of [
    'ETF_LKG_TREE="data/stockanalysis/etfs"',
    "require_etf_overlay_env",
    "verify_etf_overlay_pointer_current() {",
    "verify_etf_overlay_binding",
    "restore_etf_lkg_tree() {",
    "etf_overlay_restore_and_exit() {",
    "trap 'etf_overlay_restore_and_exit' EXIT",
    "trap 'exit 129' HUP",
    "trap 'exit 130' INT",
    "trap 'exit 143' TERM",
    'git ls-files --others --exclude-standard -- "$ETF_LKG_TREE"',
  ]) {
    assert.ok(runnerLines.some((line) => line.includes(marker)),
      `runner must carry overlay marker: ${marker}`);
  }
  assert.equal(
    runnerLines.filter((line) => line.includes("materialize-cloud-data-plane-family")).length,
    1,
    "runner must use the materializer only for its manifest-only receipt verification mode",
  );
  assert.equal(exactLineIndices(runnerLines, '--verify-receipt "$ETF_DETAIL_OVERLAY_RECEIPT" \\').length, 1,
    "runner must verify the pinned receipt without re-materializing payloads");
  assert.equal(exactLineIndices(runnerLines, "verify_etf_overlay_pointer_current").length, 2,
    "runner must verify the active pointer before and after every projection pass");
  const backupCopy = 'cp -a "$ETF_LKG_TREE/." "$ETF_OVERLAY_BACKUP_ROOT/etfs/"';
  const overlayCopy = 'cp -a "$ETF_DETAIL_OVERLAY_ROOT/." "$ETF_LKG_TREE/"';
  const backupCopyIndex = runnerLines.findIndex((line) => line.includes(backupCopy));
  const overlayCopyIndex = runnerLines.findIndex((line) => line.includes(overlayCopy));
  assert.ok(backupCopyIndex >= 0 && overlayCopyIndex >= 0 && backupCopyIndex < overlayCopyIndex,
    "Git LKG snapshot must be taken before the overlay replaces the tree");
}

console.log("test-update-manifest-workflow: ok");
