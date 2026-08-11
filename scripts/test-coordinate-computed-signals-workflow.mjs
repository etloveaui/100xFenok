#!/usr/bin/env node
// Coordinator / trigger / lane-manifest contract for the one-asset
// computed-signals pilot (dispatch-decoupling slice).
//
// Proves, statically against the committed workflows and the canonical lane
// commit manifest:
//   1. the six source workflows never dispatch update-manifest.yml per run and
//      keep their family publisher + outcome persistence steps;
//   2. coordinate-computed-signals.yml listens to exactly those six workflow
//      names, is fail-closed to successful main completions, serializes
//      overlapping completions, resets to latest origin/main, and executes
//      export -> publish -> cleanup -> persist in that exact order with no
//      Deploy Worker dispatch and no signals Git commit surface;
//   3. the generated Update Manifest push contract excludes exactly the six
//      owned canonical/admin source paths while schedule/manual/unrelated
//      data triggers remain;
//   4. the computed-signals publish-outcome shard is authorized by the lane
//      manifest and excluded from every recursive trigger path.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildLaneCommitManifest,
  validateLaneCommitManifest,
} from "./build-lane-commit-manifest.mjs";
import {
  COMPUTED_SIGNALS_SOURCE_LANE_IDS,
  LANE_REGISTRY,
  PLANE_PUBLISH_OUTCOME_BINDINGS,
} from "./lib/lane-registry.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = path.join(repoRoot, ".github", "workflows");
const manifestPath = path.join(repoRoot, "data", "admin", "lane-commit-manifest.json");
const COORDINATOR = ".github/workflows/coordinate-computed-signals.yml";
const DISPATCH_CALL = "gh workflow run update-manifest.yml";
const OUTCOME_SHARD = "data/admin/data-supply-state/publish-outcomes/computed-signals.json";
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
  const bindings = Object.entries(PLANE_PUBLISH_OUTCOME_BINDINGS)
    .filter(([, binding]) => binding.lane_id === laneId && binding.workflow === lane.owner_workflow);
  assert.equal(bindings.length, 1, `computed-signals source lane must have exactly one matching plane family: ${laneId}`);
  const [family] = bindings[0];
  const file = path.posix.basename(lane.owner_workflow);
  const source = readWorkflow(file);
  return { lane, laneId, workflow: lane.owner_workflow, file, family, name: workflowDisplayName(source, file), source };
});

// --- 1) Six source workflows: dispatch removed, publisher/persist kept --------
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
    countOccurrences(source, `node scripts/publish-cloud-data-generation.mjs --family=${family} --tolerate-gate-block --json`),
    1,
    `${file} must keep exactly one ${family} plane publisher`,
  );
  assert.equal(
    countOccurrences(source, `persist-cloud-publish-outcome.mjs --family=${family}`),
    1,
    `${file} must keep exactly one ${family} outcome persistence step`,
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

  // Persistence dependency must be present in the sparse checkout. The
  // persistence helper always reads the lane manifest, so the coordinator
  // must materialize the exact manifest path next to the outcome shard or
  // persistence cannot start. Prove both the checked-out path and the helper
  // that reads it, not only a hand-written workflow string.
  assert.match(sparseBlock, /^            data\/admin\/lane-commit-manifest\.json$/m,
    "coordinator sparse checkout must include the lane commit manifest");
  const persistSource = fs.readFileSync(path.join(repoRoot, "scripts", "persist-cloud-publish-outcome.mjs"), "utf8");
  assert.ok(
    persistSource.includes('"data/admin/lane-commit-manifest.json"'),
    "outcome persistence must read the lane commit manifest at the checked-out path",
  );

  // Latest-main reset precedes the exporter.
  const resetFetch = source.indexOf("git fetch --depth=1 origin +main:refs/remotes/origin/main");
  const resetCheckout = source.indexOf("git checkout -B main origin/main");
  const exportIndex = source.indexOf("run: node scripts/export-computed-signals.mjs");
  assert.ok(resetFetch >= 0 && resetCheckout >= 0, "coordinator must reset to the latest origin/main");
  assert.ok(resetFetch < exportIndex && resetCheckout < exportIndex, "latest-main reset must precede the exporter");

  // Exact build/publish/cleanup/persist order.
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
  const persistIndex = source.indexOf("persist-cloud-publish-outcome.mjs --family=computed-signals --workflow=.github/workflows/coordinate-computed-signals.yml");
  assert.ok(cleanupIndex >= 0 && cleanupCanonicalIndex >= 0 && cleanupPublicIndex >= 0,
    "coordinator must restore both tracked signal files to HEAD");
  assert.ok(publishIndex < cleanupIndex && cleanupIndex < persistIndex, "cleanup must run after publish and before persistence");
  assert.doesNotMatch(source, /rm\s+(?:-[^\s]+\s+)*[^\n]*signals\.json/,
    "coordinator must not delete tracked signal files during cleanup");
  assert.equal(
    countOccurrences(source, "persist-cloud-publish-outcome.mjs --family=computed-signals --workflow=.github/workflows/coordinate-computed-signals.yml --publisher-outcome=${{ steps.publish_cloud_generation.outcome }}"),
    1,
    "coordinator must persist the computed-signals outcome with the exact publisher-outcome binding",
  );
  const persistStep = source.slice(source.lastIndexOf("\n      - name:", persistIndex));
  assert.ok(persistStep.includes("if: ${{ always() }}"), "outcome persistence must run unconditionally");

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
// writer queue. This eliminates source/outcome/UM Git races by construction;
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

// --- 3) Trigger narrowing (generated Update Manifest push contract) -----------
function globRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*")}$`);
}

function pathIncluded(triggerPaths, candidate) {
  let included = false;
  for (const entry of triggerPaths) {
    const negative = entry.startsWith("!");
    if (globRegex(negative ? entry.slice(1) : entry).test(candidate)) included = !negative;
  }
  return included;
}

{
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateLaneCommitManifest(manifest, { registry: LANE_REGISTRY });
  assert.equal(
    canonicalJson(manifest),
    canonicalJson(buildLaneCommitManifest(LANE_REGISTRY)),
    "committed lane-commit-manifest.json must match the canonical build",
  );
  const triggerPaths = manifest.update_manifest.trigger_paths;
  assert.ok(triggerPaths.includes("data/**"), "broad data trigger must remain for unrelated lanes");
  assert.ok(triggerPaths.includes("!data/computed/**"), "generic computed data must stay excluded");
  assert.ok(triggerPaths.includes("!data/admin/data-supply-state/**"), "outcome evidence root must stay excluded");

  const exactExclusions = [
    ...SOURCE_WORKFLOWS.flatMap(({ lane }) => lane.roots.canonical_outputs.map((output) => {
      const basename = path.posix.basename(output);
      return `!${basename.includes(".") ? output : `${output}/**`}`;
    })),
    ...SOURCE_WORKFLOWS.map(({ lane }) => `!${lane.roots.admin_store}/**`),
  ];
  assert.equal(new Set(exactExclusions).size, exactExclusions.length,
    "registry-derived computed-signals exclusions must be unique");
  for (const exclusion of exactExclusions) {
    assert.ok(triggerPaths.includes(exclusion), `trigger_paths must exclude ${exclusion}`);
  }

  // Every registry-manifest commit path of the six families must NOT trigger
  // UM. Materialize one representative for directories/globs; the trigger
  // matcher then proves the enclosing exclusion rather than a hand list.
  const ownedPaths = SOURCE_WORKFLOWS.flatMap(({ workflow }) => {
    const policy = manifest.workflows[workflow];
    assert.ok(policy, `manifest policy must exist for ${workflow}`);
    return Object.values(policy.stages).flat().map((spec) => {
      if (spec.kind === "directory") return `${spec.path}/fixture.json`;
      if (spec.kind === "glob") return spec.path.replace("*", "fixture");
      return spec.path;
    });
  });
  for (const owned of ownedPaths) {
    assert.equal(pathIncluded(triggerPaths, owned), false, `${owned} must not implicitly trigger Update Manifest`);
  }

  // Unrelated data and the outcome shard.
  assert.equal(pathIncluded(triggerPaths, "data/indices/sp500.json"), true, "unrelated data push must still trigger");
  assert.equal(pathIncluded(triggerPaths, "data/macro/yahoo-ticker.json"), true, "non-excluded macro push must still trigger");
  assert.equal(pathIncluded(triggerPaths, OUTCOME_SHARD), false, "computed-signals outcome shard must never trigger UM");
}

// --- 4) Lane manifest / outcome authorization + recursion exclusion ----------
{
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const binding = PLANE_PUBLISH_OUTCOME_BINDINGS["computed-signals"];
  assert.ok(binding, "computed-signals must be a bound plane publish family");
  assert.equal(binding.workflow, COORDINATOR, "computed-signals outcome must be owned by the coordinator");

  const entry = manifest.workflows[COORDINATOR];
  assert.ok(entry, "coordinator workflow must be declared in the lane-commit manifest");
  assert.deepEqual(entry.lanes, [], "coordinator owns no acquisition lane");
  assert.deepEqual(entry.stages.always_if_exists, [
    { kind: "file", path: OUTCOME_SHARD, required: false },
  ], "coordinator must own exactly the optional outcome shard");
  assert.deepEqual(entry.stages.success_if_exists, [], "coordinator must never stage canonical signal files");
  assert.deepEqual(entry.stages.success_verify_not_plan_if_exists, [], "coordinator must never verify-stage signal files");
  assert.deepEqual(entry.stages.required_on_success, [], "coordinator must never require signal files");
  assert.deepEqual(entry.exclude, [], "coordinator declares no exclusions");

  const declaredClass = LANE_REGISTRY.workflow_classes[COORDINATOR];
  assert.equal(declaredClass?.class, "platform_publisher", "coordinator must be a declared platform publisher");

  // Recursion exclusion: the coordinator never reacts to Update Manifest, and
  // the outcome shard is not part of UM's central commit set either.
  const source = readWorkflow("coordinate-computed-signals.yml");
  const namesBlock = source.slice(source.indexOf("workflow_run:"), source.indexOf("types:"));
  assert.equal(namesBlock.includes("Update Manifest"), false, "coordinator must not listen to Update Manifest");
  assert.equal(
    manifest.update_manifest.central_commit_paths.includes(OUTCOME_SHARD),
    false,
    "outcome shard must not be a central Update Manifest commit path",
  );
  assert.equal(
    manifest.update_manifest.central_commit_paths.includes("data/computed/signals.json"),
    true,
    "signals.json remains owned by Update Manifest reconciliation, not the coordinator",
  );
  assert.equal(
    manifest.update_manifest.central_commit_paths.includes("100xfenok-next/public/data/computed/signals.json"),
    true,
    "public signals mirror remains owned by Update Manifest reconciliation",
  );
}

console.log("coordinate-computed-signals: coordinator, triggers, and outcome authorization ok");
