#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(repoRoot, ".github/workflows/fenok-edge-daily.yml"), "utf8");

function extractIndentedBlock(source, headerPattern) {
  const lines = source.split("\n");
  const headerIndex = lines.findIndex((line) => headerPattern.test(line));
  assert.notEqual(headerIndex, -1, `missing block matching ${headerPattern}`);
  const headerIndent = lines[headerIndex].match(/^\s*/)[0].length;
  const block = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.match(/^\s*/)[0].length <= headerIndent) break;
    block.push(line);
  }
  return block.join("\n");
}

function extractStepRun(source, stepName) {
  const startMarker = `      - name: ${stepName}\n`;
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `missing workflow step: ${stepName}`);
  const nextStepIndex = source.indexOf("\n      - name: ", startIndex + startMarker.length);
  const step = source.slice(startIndex, nextStepIndex === -1 ? source.length : nextStepIndex);
  const match = step.match(/^        run: \|\n((?:          .*\n?)*)/m);
  assert.ok(match, `missing run block for workflow step: ${stepName}`);
  return match[1]
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}

function runControlledFailureValidation(overrides = {}) {
  const validationScript = extractStepRun(workflow, "Resolve bounded window").split("\nOCC_BATCH_SIZE=")[0];
  return spawnSync("bash", ["-e", "-u", "-o", "pipefail", "-c", `${validationScript}\nprintf '%s' "$CONTROLLED_FAILURE_LANES"`], {
    encoding: "utf8",
    env: {
      ...process.env,
      INPUT_CONTROLLED_FAILURE_LANES: "",
      INPUT_PLAN_ONLY: "false",
      INPUT_NO_FETCH: "false",
      INPUT_OCC_BATCH_INDEX: "",
      ...overrides,
    },
  });
}

const dispatchInputs = extractIndentedBlock(workflow, /^\s{4}inputs:\s*$/);
const inputNames = [...dispatchInputs.matchAll(/^\s{6}([a-z0-9_]+):\s*$/gm)].map((match) => match[1]);
const runBlocks = [...workflow.matchAll(/^(\s+)run:\s*\|\n((?:(?:\1  ).*\n?)*)/gm)].map((match) => match[2]);

assert.match(workflow, /node scripts\/test-data-supply-attempt-producer\.mjs/);
assert.match(workflow, /node scripts\/test-fetch-fenok-finra-daily-private\.mjs/);
assert.match(workflow, /node scripts\/test-fetch-fenok-occ-options-volume\.mjs/);
assert.match(workflow, /detection-attempts\/finra_short_volume\.json/);
assert.match(workflow, /detection-attempts\/occ_options_volume\.json/);
assert.match(workflow, /- name: Commit and push owned source artifacts\n\s+if: \$\{\{ always\(\) \}\}/);
assert.doesNotMatch(workflow, /git add -A/);

assert.equal(inputNames.length, 11, "workflow_dispatch must expose exactly 11 inputs");
assert.ok(inputNames.includes("controlled_failure_lanes"));
assert.match(
  workflow,
  /INPUT_CONTROLLED_FAILURE_LANES:\s*\$\{\{ github\.event\.inputs\.controlled_failure_lanes \|\| '' \}\}/,
);
assert.match(workflow, /controlled_failure_lanes=\$CONTROLLED_FAILURE_LANES/);
assert.match(workflow, /INPUT_CONTROLLED_FAILURE_LANES:\s*\$\{\{ steps\.window\.outputs\.controlled_failure_lanes \}\}/);
assert.match(workflow, /occ_options_volume\|finra_short_volume/);
assert.match(workflow, /empty controlled failure lane token/i);
assert.match(workflow, /unknown controlled failure lane/i);
assert.match(workflow, /controlled failure lanes cannot be combined with plan_only/i);
assert.match(workflow, /controlled failure lanes cannot be combined with no_fetch/i);
assert.match(workflow, /occ_options_volume controlled failure cannot use occ_batch_index/i);
assert.ok(
  runBlocks.every((block) => !block.includes("${{ github.event.inputs")),
  "workflow dispatch expressions must not be interpolated directly into shell blocks",
);

const normalizedLanes = runControlledFailureValidation({
  INPUT_CONTROLLED_FAILURE_LANES: " occ_options_volume , finra_short_volume ",
});
assert.equal(normalizedLanes.status, 0, normalizedLanes.stderr);
assert.equal(normalizedLanes.stdout, "occ_options_volume,finra_short_volume");

for (const [name, overrides, errorPattern] of [
  [
    "plan_only",
    { INPUT_CONTROLLED_FAILURE_LANES: "finra_short_volume", INPUT_PLAN_ONLY: "true" },
    /plan_only/i,
  ],
  [
    "no_fetch",
    { INPUT_CONTROLLED_FAILURE_LANES: "finra_short_volume", INPUT_NO_FETCH: "true" },
    /no_fetch/i,
  ],
  [
    "OCC batch index",
    { INPUT_CONTROLLED_FAILURE_LANES: "occ_options_volume", INPUT_OCC_BATCH_INDEX: "2" },
    /occ_batch_index/i,
  ],
  ["empty token", { INPUT_CONTROLLED_FAILURE_LANES: "finra_short_volume," }, /empty/i],
  ["unknown token", { INPUT_CONTROLLED_FAILURE_LANES: "unknown_lane" }, /unknown/i],
]) {
  const result = runControlledFailureValidation(overrides);
  assert.notEqual(result.status, 0, `${name} validation unexpectedly succeeded`);
  assert.match(result.stderr, errorPattern);
}

const finraWithOccIndex = runControlledFailureValidation({
  INPUT_CONTROLLED_FAILURE_LANES: "finra_short_volume",
  INPUT_OCC_BATCH_INDEX: "2",
});
assert.equal(finraWithOccIndex.status, 0, finraWithOccIndex.stderr);

const noInjectionControls = runControlledFailureValidation({
  INPUT_PLAN_ONLY: "true",
  INPUT_NO_FETCH: "true",
  INPUT_OCC_BATCH_INDEX: "2",
});
assert.equal(noInjectionControls.status, 0, noInjectionControls.stderr);

console.log("test-fenok-edge-daily-attempt-workflow: ok");
