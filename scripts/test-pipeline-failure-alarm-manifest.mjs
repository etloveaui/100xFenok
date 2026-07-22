#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/pipeline-failure-alarm.yml"), "utf8");

const INCIDENT_TRANSITION_IF =
  "if: steps.pipeline.outcome == 'failure' && steps.alarm_state.outputs.incident_changed != 'false'";
const FAIL_ON_ALARM_IF = "if: steps.pipeline.outcome == 'failure'";

function stepBlock(source, name) {
  // The exact six-space delimiter is intentionally fail-closed: if workflow
  // step indentation drifts, the block over-runs and the exact assertions fail.
  const marker = `- name: ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} step must exist`);
  const next = source.indexOf("\n      - name:", start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

function assertIncidentTransitionGuards(source) {
  const emitStep = stepBlock(source, "Emit alarm state");
  assert.equal(
    emitStep.split("\n").find((line) => line.trimStart().startsWith("id:"))?.trim(),
    "id: alarm_state",
    "Emit alarm state must publish the alarm_state step id",
  );

  for (const name of ["Prepare issue body", "Open or update OPS issue"]) {
    const block = stepBlock(source, name);
    const ifLines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("if:"));
    assert.deepEqual(
      ifLines,
      [INCIDENT_TRANSITION_IF],
      `${name} must gate exactly on an alarm incident transition`,
    );
  }

  const failStep = stepBlock(source, "Fail on alarm");
  const failIfLines = failStep
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("if:"));
  assert.deepEqual(
    failIfLines,
    [FAIL_ON_ALARM_IF],
    "Fail on alarm must remain red for every unresolved incident",
  );
  assert.equal(
    failStep.split("\n").find((line) => line.trimStart().startsWith("run:"))?.trim(),
    "run: exit 1",
    "Fail on alarm must exit non-zero",
  );
}

function replaceStepCondition(source, name, condition) {
  const block = stepBlock(source, name);
  const mutated = block.replace(/^\s*if:.*$/m, `        ${condition}`);
  assert.notEqual(mutated, block, `${name} fixture mutation must replace its condition`);
  return source.replace(block, mutated);
}

assert.doesNotMatch(workflow, /git add (?:-A|--all)/);
const commitStep = workflow.slice(
  workflow.indexOf("- name: Commit alarm state"),
  workflow.indexOf("- name: Prepare issue body"),
);
assert.match(commitStep, /if: always\(\)/);
assert.match(commitStep, /continue-on-error: true/);
assert.match(
  commitStep,
  /scripts\/stage-lane-manifest\.sh[\s\S]*?--workflow \.github\/workflows\/pipeline-failure-alarm\.yml[\s\S]*?--stage always_if_exists \|\| exit 0/,
  "manifest publication failure must remain non-primary",
);
const manifestCall = commitStep.indexOf("scripts/stage-lane-manifest.sh");
const legacyAdd = commitStep.indexOf("git add data/admin/alarm-state.json");
assert.ok(manifestCall >= 0 && manifestCall < legacyAdd, "manifest staging must precede the retained literal add");
assert.match(commitStep, /git add data\/admin\/alarm-state\.json 100xfenok-next\/public\/data\/admin\/alarm-state\.json \|\| exit 0/);
assertIncidentTransitionGuards(workflow);

assert.throws(
  () => assertIncidentTransitionGuards(workflow.replace(/^\s*id: alarm_state\s*$/m, "")),
  /Emit alarm state must publish the alarm_state step id/,
  "removing the output-producing step id must fail the guard",
);
for (const name of ["Prepare issue body", "Open or update OPS issue"]) {
  const weakened = replaceStepCondition(
    workflow,
    name,
    "if: steps.pipeline.outcome == 'failure'",
  );
  assert.throws(
    () => assertIncidentTransitionGuards(weakened),
    /must gate exactly on an alarm incident transition/,
    `removing incident_changed from ${name} must fail the guard`,
  );
}

const silencedFailure = replaceStepCondition(
  workflow,
  "Fail on alarm",
  INCIDENT_TRANSITION_IF,
);
assert.throws(
  () => assertIncidentTransitionGuards(silencedFailure),
  /Fail on alarm must remain red for every unresolved incident/,
  "gating Fail on alarm on incident_changed must fail the guard",
);

console.log("test-pipeline-failure-alarm-manifest: ok");
