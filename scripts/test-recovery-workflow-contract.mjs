#!/usr/bin/env node
// Contract tests for the recovery deploy gate wiring (Luna review corrections).
// Reads the workflow files and asserts the durable contracts that survive the
// 2026-08-12 retirement of the one-off StockAnalysis artifact recovery lane:
//  1. deploy-worker.yml has the workflow_run requeue trigger for the surviving
//     SlickCharts History recovery workflow with types [completed].
//  2. deploy-worker.yml recovery-gate job grants contents: read + actions: read.
//  3. deploy-worker.yml has the check-then-start race re-check step.
//  4. both recovery gate call sites (deploy-worker + update-manifest) name only
//     the surviving slickcharts-history.yml — retired lanes must not reappear.
//  5. update-manifest.yml dispatch step is gated on the recovery-gate output.
//  6. slickcharts-history.yml keeps actions: write (commits + fetches).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const WF = (name) => fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", name), "utf8");

const historyYml = WF("slickcharts-history.yml");
const deployYml = WF("deploy-worker.yml");
const manifestYml = WF("update-manifest.yml");

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

function recoveryWorkflowArgs(yml) {
  return [...yml.matchAll(/--recovery-workflows ([a-z0-9-]+\.yml(?:,[a-z0-9-]+\.yml)*)/g)].map((m) => m[1]);
}

check("deploy-worker has workflow_run requeue trigger with the SlickCharts display name", () => {
  assert.match(deployYml, /workflow_run:/);
  // workflow_run.workflows matches display names (name:), not file names.
  assert.match(deployYml, /SlickCharts History/);
  assert.match(deployYml, /types:\s*\[completed\]/);
  // File names must NOT appear in the trigger (would silently match nothing).
  assert.doesNotMatch(deployYml, /workflows:\s*\[slickcharts-history\.yml/);
});
check("workflow display name matches its file's name: field", () => {
  assert.match(historyYml, /^name:\s*SlickCharts History/m);
});
check("deploy-worker recovery gate names only the surviving slickcharts-history.yml", () => {
  const args = recoveryWorkflowArgs(deployYml);
  assert.ok(args.length >= 2, "both deploy gate call sites carry the recovery-workflows argument");
  for (const arg of args) {
    assert.equal(arg, "slickcharts-history.yml", "retired recovery lanes must not reappear in the gate");
  }
});
check("deploy-worker recovery-gate job grants contents: read + actions: read", () => {
  assert.match(deployYml, /contents:\s*read/);
  assert.match(deployYml, /actions:\s*read/);
});
check("deploy-worker has the check-then-start race re-check step", () => {
  assert.match(deployYml, /Re-check recovery gate \(check-then-start race\)/);
  assert.match(deployYml, /SUPERSEDED=true/);
});
check("update-manifest recovery gate names only the surviving slickcharts-history.yml", () => {
  const args = recoveryWorkflowArgs(manifestYml);
  assert.ok(args.length >= 1, "update-manifest carries the recovery-workflows argument");
  for (const arg of args) {
    assert.equal(arg, "slickcharts-history.yml", "retired recovery lanes must not reappear in the gate");
  }
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
