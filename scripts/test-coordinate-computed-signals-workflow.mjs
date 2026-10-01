#!/usr/bin/env node
// Coordinator / trigger / lane-manifest contract for the one-asset
// computed-signals pilot (dispatch-decoupling slice).
//
// Checks the committed workflows and canonical lane policies:
//   1. the six source workflows never dispatch update-manifest.yml per run and
//      keep their family publisher steps;
//   2. coordinate-computed-signals.yml listens to exactly those six workflow
//      names, is fail-closed to successful main completions, serializes
//      overlapping completions, resets to latest origin/main, and executes
//      export -> publish -> cleanup in that exact order with no
//      Deploy Worker dispatch and no signals Git commit surface;
//   3. the coordinator has no Git commit stage or recursive trigger path.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COMPUTED_SIGNALS_SOURCE_LANE_IDS,
  LANE_REGISTRY,
  PLANE_PUBLISH_FAMILY_BINDINGS,
} from "./lib/lane-registry.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");
const COORDINATOR = ".github/workflows/coordinate-computed-signals.yml";
const DISPATCH_CALL = "gh workflow run update-manifest.yml";
const GLOBAL_WRITER_GROUP = "fenok-data-writer-refs/heads/main";

function countOccurrences(source, needle) {
  return source.split(needle).length - 1;
}

function readWorkflow(name) {
  return fs.readFileSync(path.join(workflowsDir, name), "utf8");
}

function assertMinimalWriterPermissions(source, file) {
  const permissionsStart = source.indexOf("permissions:");
  const concurrencyStart = source.indexOf("\nconcurrency:", permissionsStart);
  assert.ok(permissionsStart >= 0 && concurrencyStart > permissionsStart,
    `${file} must declare top-level permissions before concurrency`);
  const permissionsBlock = source.slice(permissionsStart, concurrencyStart);
  assert.match(permissionsBlock, /^  contents: write$/m, `${file} must retain contents: write for its owned Git commit`);
  assert.doesNotMatch(permissionsBlock, /actions:\s*write/,
    `${file} no longer dispatches workflows and must not request actions: write`);
}

function workflowDisplayName(source, file) {
  const match = /^name:\s*(.+)$/m.exec(source);
  assert.ok(match, `${file} must declare a display name`);
  return match[1].trim();
}

// Derive the six owner workflows, their display names, and their plane family
// from the lane registry instead of maintaining a second six-row inventory in
// this test. The small lane-id selection constant is the only coordinator
// source authority; everything else comes from live registry/workflow data.
const SOURCE_WORKFLOWS = COMPUTED_SIGNALS_SOURCE_LANE_IDS.map((laneId) => {
  const lane = LANE_REGISTRY.lanes.find((candidate) => candidate.id === laneId);
  assert.ok(lane?.owner_workflow, `computed-signals source lane must have an owner: ${laneId}`);
  const bindings = Object.entries(PLANE_PUBLISH_FAMILY_BINDINGS)
    .filter(([, binding]) => binding.lane_id === laneId && binding.workflow === lane.owner_workflow);
  assert.equal(bindings.length, 1, `computed-signals source lane must have exactly one matching plane family: ${laneId}`);
  const [family] = bindings[0];
  const file = path.posix.basename(lane.owner_workflow);
  const source = readWorkflow(file);
  return { lane, laneId, workflow: lane.owner_workflow, file, family, name: workflowDisplayName(source, file), source };
});

// --- 1) Six source workflows: dispatch removed, publisher kept ---------------
assert.equal(SOURCE_WORKFLOWS.length, 6, "computed-signals must retain exactly six source lanes");
for (const { file, family, source } of SOURCE_WORKFLOWS) {
  assertMinimalWriterPermissions(source, file);
  assert.equal(
    countOccurrences(source, DISPATCH_CALL),
    0,
    `${file} must not dispatch update-manifest.yml per run`,
  );
  assert.ok(
    source.includes("coordinate-computed-signals workflow_run"),
    `${file} must document the coordinate-computed-signals fallback`,
  );
  assert.ok(
    source.includes("scheduled update-manifest.yml"),
    `${file} must document the scheduled update-manifest.yml reconciliation fallback`,
  );
  assert.equal(
    countOccurrences(source, `node scripts/publish-cloud-data-generation.mjs --family=${family} `),
    1,
    `${file} must keep exactly one ${family} plane publisher`,
  );

}

// --- 2) Coordinator structure -------------------------------------------------
{
  const source = readWorkflow("coordinate-computed-signals.yml");

  // Exactly the six registry-derived source workflow display names.
  const expectedNames = SOURCE_WORKFLOWS.map(({ name }) => name);
  const namesBlock = source.slice(source.indexOf("workflow_run:"), source.indexOf("types:"));
  const actualNames = [...namesBlock.matchAll(/^      - (.+)$/gm)].map((match) => match[1].trim());
  assert.deepEqual(actualNames, expectedNames, "coordinator workflow_run names must exactly match the six registry-derived owners");
  assert.ok(source.includes("    types:\n      - completed"), "workflow_run must react to completed only");
  assert.ok(source.includes("    branches:\n      - main"), "workflow_run must be scoped to main");

  // Fail-closed gate on the job itself.
  assert.ok(
    source.includes("if: ${{ github.event.workflow_run.conclusion == 'success' && github.event.workflow_run.head_branch == 'main' }}"),
    "coordinator job must be fail-closed to successful main completions",
  );

  // Exporter dependency must be present in the sparse checkout. Prove both the
  // import and its resolved file, not only a hand-written workflow string.
  const sparseBlock = source.slice(source.indexOf("sparse-checkout: |"), source.indexOf("\n\n      - name: Start from latest main"));
  assert.match(sparseBlock, /^            tools\/macro-monitor\/shared$/m,
    "coordinator sparse checkout must include the exporter dependency tree");
  const exporterSource = fs.readFileSync(path.join(repoRoot, "scripts", "export-computed-signals.mjs"), "utf8");
  const dependencyImport = /from ['"](\.\.\/tools\/macro-monitor\/shared\/signals-core\.mjs)['"]/.exec(exporterSource);
  assert.ok(dependencyImport, "exporter must import the shared signals core through the expected relative dependency");
  assert.equal(
    fs.existsSync(path.resolve(repoRoot, "scripts", dependencyImport[1])),
    true,
    "exporter shared signals-core dependency must resolve on disk",
  );

  // Latest-main reset precedes the exporter.
  const resetFetch = source.indexOf("git fetch --depth=1 origin +main:refs/remotes/origin/main");
  const resetCheckout = source.indexOf("git checkout -B main origin/main");
  const exportIndex = source.indexOf("run: node scripts/export-computed-signals.mjs");
  assert.ok(resetFetch >= 0 && resetCheckout >= 0, "coordinator must reset to the latest origin/main");
  assert.ok(resetFetch < exportIndex && resetCheckout < exportIndex, "latest-main reset must precede the exporter");

  // Exact build/publish/cleanup order.
  const publishCommand = "node scripts/publish-cloud-data-generation.mjs --family=computed-signals --tolerate-gate-block --json";
  const publishIndex = source.indexOf(publishCommand);
  assert.equal(countOccurrences(source, publishCommand), 1, "coordinator must publish computed-signals exactly once");
  assert.ok(exportIndex < publishIndex, "exporter must run before the publisher");
  assert.ok(
    source.slice(source.lastIndexOf("\n      - name:", publishIndex), publishIndex).includes("id: publish_cloud_generation"),
    "publisher step must carry id publish_cloud_generation",
  );
  const cleanupIndex = source.indexOf("git restore --source=HEAD --worktree --");
  const cleanupCanonicalIndex = source.indexOf("data/computed/signals.json", cleanupIndex);
  const cleanupPublicIndex = source.indexOf("100xfenok-next/public/data/computed/signals.json", cleanupIndex);
  assert.ok(cleanupIndex >= 0 && cleanupCanonicalIndex >= 0 && cleanupPublicIndex >= 0,
    "coordinator must restore both tracked signal files to HEAD");
  assert.ok(publishIndex < cleanupIndex, "cleanup must run after publish");
  assert.doesNotMatch(source, /rm\s+(?:-[^\s]+\s+)*[^\n]*signals\.json/,
    "coordinator must not delete tracked signal files during cleanup");
  // No Deploy Worker and no signals Git commit.
  assert.equal(countOccurrences(source, "gh workflow run"), 0, "coordinator must not dispatch any workflow");
  assert.ok(!source.includes("deploy-worker.yml"), "coordinator must not dispatch Deploy Worker");
  assert.ok(!source.includes("git add"), "coordinator must not git-add anything in YAML");
  assert.ok(!source.includes("git commit"), "coordinator must not git-commit anything in YAML");
  assert.ok(!source.includes("stage-lane-manifest.sh"), "coordinator must not stage lane files in YAML");
  assert.ok(!source.includes("- name: Commit"), "coordinator must have no Commit step");
  assert.ok(source.includes("environment: production"), "coordinator must run in the production environment for plane secrets");
  assertMinimalWriterPermissions(source, "coordinate-computed-signals.yml");
}

// All seven computed-signals workflows share Update Manifest's exact global
// writer queue. This eliminates source/UM Git races by construction;
// queue max retains every completion and cancel false preserves in-flight work.
{
  const updateManifestSource = readWorkflow("update-manifest.yml");
  const queued = [
    ...SOURCE_WORKFLOWS.map(({ file, source }) => ({ file, source })),
    { file: "coordinate-computed-signals.yml", source: readWorkflow("coordinate-computed-signals.yml") },
  ];
  assert.equal(queued.length, 7);
  for (const { file, source } of [{ file: "update-manifest.yml", source: updateManifestSource }, ...queued]) {
    const groups = [...source.matchAll(/^  group:\s*(.+)$/gm)].map((match) => match[1].trim());
    assert.deepEqual(groups, [GLOBAL_WRITER_GROUP], `${file} must declare exactly the shared global writer group`);
    assert.equal(countOccurrences(source, "  cancel-in-progress: false"), 1, `${file} must never cancel an in-flight writer`);
    assert.equal(countOccurrences(source, "  queue: max"), 1, `${file} must retain the global writer queue`);
  }
}

// --- 3) Coordinator metadata and recursion exclusion -------------------------
{
  const binding = PLANE_PUBLISH_FAMILY_BINDINGS["computed-signals"];
  assert.ok(binding, "computed-signals must be a bound plane publish family");
  assert.equal(binding.workflow, COORDINATOR, "computed-signals publish is owned by the coordinator");

  const entry = LANE_REGISTRY.workflow_policies[COORDINATOR];
  assert.ok(entry, "coordinator workflow policy must exist");
  assert.deepEqual(entry.lanes, [], "coordinator owns no acquisition lane");
  assert.deepEqual(entry.stages.always_if_exists, [], "coordinator owns no Git commit outputs");
  assert.deepEqual(entry.stages.success_if_exists, [], "coordinator must never stage canonical signal files");
  assert.deepEqual(entry.stages.success_verify_not_plan_if_exists, [], "coordinator must never verify-stage signal files");
  assert.deepEqual(entry.stages.required_on_success, [], "coordinator must never require signal files");
  assert.deepEqual(entry.exclude, [], "coordinator declares no exclusions");

  const declaredClass = LANE_REGISTRY.workflow_classes[COORDINATOR];
  assert.equal(declaredClass?.class, "platform_publisher", "coordinator must be a declared platform publisher");

  // Recursion exclusion: the coordinator never reacts to Update Manifest.
  const source = readWorkflow("coordinate-computed-signals.yml");
  const namesBlock = source.slice(source.indexOf("workflow_run:"), source.indexOf("types:"));
  assert.equal(namesBlock.includes("Update Manifest"), false, "coordinator must not listen to Update Manifest");


}

console.log("coordinate-computed-signals: coordinator and triggers ok");
