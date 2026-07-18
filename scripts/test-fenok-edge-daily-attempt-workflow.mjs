#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

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

// Lane Registry ⇄ commit-shard completeness gate (#366 step 4 pilot): every
// registry-declared commit shard of this workflow's lanes is git-added, and the
// allowlist names nothing undeclared — the false-green class (produced file
// never committed) is structurally unshippable here.
{
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: workflow,
    workflowRel: ".github/workflows/fenok-edge-daily.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), ["finra_short_volume", "occ_options_volume"].sort(),
    "the registry must attribute both edge lanes to fenok-edge-daily.yml");

  // value-changing registry injection (sol fh-168 pattern rule): an injected
  // registry whose edge lane declares one MORE admin shard must surface as
  // missing_in_workflow — injected config changes must flow end to end.
  const injectedRegistry = {
    ...LANE_REGISTRY,
    lanes: LANE_REGISTRY.lanes.map((lane) => lane.id === "finra_short_volume"
      ? { ...lane, commit_shards: [...lane.commit_shards, "data/admin/finra_short_volume/history/injected_extra.json"] }
      : lane),
  };
  const injected = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: workflow,
    workflowRel: ".github/workflows/fenok-edge-daily.yml",
    registry: injectedRegistry,
  });
  assert.equal(injected.ok, false, "an injected extra declared shard must fail the gate");
  assert.deepEqual(injected.missing_in_workflow, [{ shard: "data/admin/finra_short_volume/history/injected_extra.json", lane: "finra_short_volume" }],
    "the injected shard must be named by lane in missing_in_workflow");

  // empty-exceptions value-changing RED (sol fh-175): an admin path covered by
  // a DEFAULT declared exception must turn undeclared when the injected
  // registry drops all exceptions — direction 2 must honor the injected registry.
  const ghosted = `${workflow}\n# data/admin/fenok-data-health-kpi.json\n`;
  const coveredByDefault = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: ghosted,
    workflowRel: ".github/workflows/fenok-edge-daily.yml",
  });
  assert.equal(coveredByDefault.undeclared_in_workflow.includes("data/admin/fenok-data-health-kpi.json"), false,
    "fixture sanity: the KPI manifest path is covered by a default declared exception");
  const noExceptions = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: ghosted,
    workflowRel: ".github/workflows/fenok-edge-daily.yml",
    registry: { ...LANE_REGISTRY, declared_exceptions: [] },
  });
  assert.equal(noExceptions.ok, false, "dropping injected exceptions must fail the gate");
  assert.ok(noExceptions.undeclared_in_workflow.includes("data/admin/fenok-data-health-kpi.json"),
    "the exception-covered path must turn undeclared under an empty injected exception set");
}

console.log("test-fenok-edge-daily-attempt-workflow: ok");
