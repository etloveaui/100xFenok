#!/usr/bin/env node
// Contract tests for the recovery deploy gate wiring (Luna review corrections).
// Reads the workflow files and asserts the durable contracts:
//  1. publish-stockanalysis-artifact-recovery.yml dispatches update-manifest and
//     therefore must have actions: write.
//  2. deploy-worker.yml has the workflow_run requeue trigger for both recovery
//     workflows with types [completed].
//  3. deploy-worker.yml recovery-gate job grants contents: read + actions: read.
//  4. deploy-worker.yml has the check-then-start race re-check step.
//  5. update-manifest.yml dispatch step is gated on the recovery-gate output.
//  6. slickcharts-history.yml keeps actions: write (commits + fetches).
//  7. the recovery writer lock is workflow-scoped so queued parent runs are visible.
//  8. recovery checkout retains history needed to validate the artifact base.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WF = (name) => fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", name), "utf8");

const recoveryYml = WF("publish-stockanalysis-artifact-recovery.yml");
const historyYml = WF("slickcharts-history.yml");
const deployYml = WF("deploy-worker.yml");
const manifestYml = WF("update-manifest.yml");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

check("recovery writer concurrency is workflow-scoped", () => {
  assert.equal((recoveryYml.match(/^concurrency:\n/gm) ?? []).length, 1);
  assert.match(
    recoveryYml,
    /^concurrency:\n  group: fenok-data-writer-refs\/heads\/main\n  cancel-in-progress: false\n  queue: max/m,
  );
  assert.doesNotMatch(recoveryYml, /^ {4}concurrency:/m, "the recovery writer lock must not remain job-scoped");
});

check("recovery checkout includes the artifact base history", () => {
  assert.match(
    recoveryYml,
    /uses: actions\/checkout@v4[\s\S]*?fetch-depth: 0/,
    "recovery cannot validate an older acquisition base from a depth-1 checkout",
  );
});

check("recovery workflow dispatches update-manifest", () => {
  assert.match(recoveryYml, /gh workflow run update-manifest\.yml --ref main/);
});
check("recovery workflow has actions: write (dispatch permission)", () => {
  assert.match(recoveryYml, /actions:\s*write/);
});
check("recovery workflow does not still carry actions: read", () => {
  assert.doesNotMatch(recoveryYml, /actions:\s*read/);
});
check("deploy-worker has workflow_run requeue trigger with exact DISPLAY names", () => {
  assert.match(deployYml, /workflow_run:/);
  // workflow_run.workflows matches display names (name:), not file names.
  assert.match(deployYml, /SlickCharts History/);
  assert.match(deployYml, /Publish StockAnalysis Artifact Recovery/);
  assert.match(deployYml, /types:\s*\[completed\]/);
  // File names must NOT appear in the trigger (would silently match nothing).
  assert.doesNotMatch(deployYml, /workflows:\s*\[slickcharts-history\.yml/);
  assert.doesNotMatch(deployYml, /workflows:\s*\[.*publish-stockanalysis-artifact-recovery\.yml/);
});
check("workflow display names match their files' name: fields", () => {
  assert.match(recoveryYml, /^name:\s*Publish StockAnalysis Artifact Recovery/m);
  assert.match(historyYml, /^name:\s*SlickCharts History/m);
});
check("deploy-worker recovery-gate job grants contents: read + actions: read", () => {
  assert.match(deployYml, /contents:\s*read/);
  assert.match(deployYml, /actions:\s*read/);
});
check("deploy-worker has the check-then-start race re-check step", () => {
  assert.match(deployYml, /Re-check recovery gate \(check-then-start race\)/);
  assert.match(deployYml, /SUPERSEDED=true/);
});
check("update-manifest dispatch step is gated on recovery-gate output", () => {
  assert.match(manifestYml, /steps\.recovery-gate\.outputs\.skip\s*!=\s*'true'/);
});
check("update-manifest guard step maps proceed-uncertain to a warning", () => {
  assert.match(manifestYml, /proceed-uncertain/);
  assert.match(manifestYml, /::warning::/);
});
check("slickcharts-history keeps actions: write", () => {
  assert.match(historyYml, /actions:\s*write/);
});

console.log(`\n${passed} contract tests passed`);
