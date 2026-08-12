#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import { buildLaneCommitManifest, centralCommitPathKind } from "./build-lane-commit-manifest.mjs";
import { scanWriterInventory } from "./check-lane-commit-manifest-inventory.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = buildLaneCommitManifest(LANE_REGISTRY);
const persistedManifest = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "data/admin/lane-commit-manifest.json"), "utf8"),
);
const validateWorkflowsText = fs.readFileSync(
  path.join(REPO_ROOT, ".github/workflows/validate-workflows.yml"),
  "utf8",
);
assert.equal(
  canonicalJson(persistedManifest),
  canonicalJson(manifest),
  "data/admin/lane-commit-manifest.json must match the canonical registry-derived manifest",
);
const UPDATE_MANIFEST_WORKFLOW = ".github/workflows/update-manifest.yml";
const UPDATE_MANIFEST_CENTRAL_HELPER = "scripts/stage-update-manifest-central.mjs";
const LANE_STAGE_HELPER = "scripts/stage-lane-manifest.sh";
const PERSIST_OUTCOME_HELPER = "scripts/persist-cloud-publish-outcome.mjs";
const SLICKCHARTS_ATTEMPT_SCRIPT = "scripts/publish-slickcharts-attempt.sh";
// Expected central policy is derived from the generated contract, never a
// copied list: the directory set and file count follow the builder's
// file/directory kind rule over the derived central path list (hand-maintained
// base + materialization destinations in route order). Ordering, kinds, and
// counts therefore flow from the builder's exported kind classifier instead of
// a second oracle.
const centralPaths = manifest.update_manifest.central_commit_paths;
const isDirectoryPath = (pathValue) => centralCommitPathKind(pathValue) === "directory";
const expectedCentralDirectories = centralPaths.filter(isDirectoryPath);

const ATTEMPT_SHARD_ROOT = "data/admin/data-supply-state/detection-attempts";

// All three tests and the detection-floor fixture are direct CI dependencies:
// each path must appear in both push and pull_request filters, and the three
// test commands must run inside the existing Update Manifest validation step
// (no separate job/step).
const validateFilterText = validateWorkflowsText.slice(0, validateWorkflowsText.indexOf("jobs:"));
for (const dependencyPath of [
  "scripts/test-update-manifest-central-staging.mjs",
  "scripts/test-lane-commit-manifest-parity.mjs",
  "scripts/test-build-data-supply-detection-floor.mjs",
  "scripts/fixtures/data_supply/detection_floor/**",
]) {
  assert.equal(
    (validateFilterText.match(new RegExp(dependencyPath.replaceAll(".", "\\.").replaceAll("*", "\\*"), "g")) ?? []).length,
    2,
    `${dependencyPath} must be in both validate-workflows path filters`,
  );
}
const updateValidationBlock = validateWorkflowsText
  .slice(validateWorkflowsText.indexOf("- name: Validate Update Manifest policy"))
  .split("      - name:", 2)[0];
assert.match(updateValidationBlock, /node scripts\/test-update-manifest-central-staging\.mjs/);
assert.match(updateValidationBlock, /node scripts\/test-lane-commit-manifest-parity\.mjs/);

function sourceRepresentsDynamicAttemptShard(sourceText, spec) {
  if (spec.kind !== "file" || !spec.path.startsWith(`${ATTEMPT_SHARD_ROOT}/`) || !spec.path.endsWith(".json")) return false;
  const laneId = path.posix.basename(spec.path, ".json");
  return sourceText.includes(`"${laneId}"`)
    && sourceText.includes(`path.join(REPO_ROOT, "${ATTEMPT_SHARD_ROOT}")`)
    && sourceText.includes("attemptShardPath: path.join(shardRoot, `${laneId}.json`)");
}

function sourceRepresentsSpec(sourceTexts, spec) {
  if (sourceTexts.some((sourceText) => sourceText.includes(spec.path))) return true;
  if (sourceTexts.some((sourceText) => sourceRepresentsDynamicAttemptShard(sourceText, spec))) return true;
  if (spec.kind !== "glob") return false;
  const directory = path.posix.dirname(spec.path);
  const pattern = path.posix.basename(spec.path);
  return sourceTexts.some((sourceText) => sourceText.includes(directory)
    && (sourceText.includes(`-name '${pattern}'`) || sourceText.includes(`-name "${pattern}"`)));
}

function workflowAppliesManifestExcludes(workflowText, workflowRel, stageHelperText) {
  return workflowText.includes("scripts/stage-lane-manifest.sh")
    && workflowText.includes(`--workflow ${workflowRel}`)
    && stageHelperText.includes('.workflows[$workflow].exclude[]?')
    && stageHelperText.includes('git restore --staged -- "$exclude_path"');
}

function workflowAppliesManifestStage(workflowText, workflowRel, stage) {
  return workflowText.includes("scripts/stage-lane-manifest.sh")
    && workflowText.includes(`--workflow ${workflowRel}`)
    && new RegExp(`--stage\\s+${stage}\\b`).test(workflowText);
}

const laneStageHelperText = fs.readFileSync(path.join(REPO_ROOT, LANE_STAGE_HELPER), "utf8");
const persistOutcomeHelperText = fs.readFileSync(path.join(REPO_ROOT, PERSIST_OUTCOME_HELPER), "utf8");

// The five SlickCharts composite workflows stage their publish-outcome shards
// DYNAMICALLY: the workflow names `--manifest-workflow <workflowRel>
// --manifest-always always_if_exists` on publish-slickcharts-attempt.sh, and
// the attempt script forwards exactly that pair to stage-lane-manifest.sh
// (`--workflow "$manifest_workflow" --stage "$manifest_always"`). The shard
// path is therefore never a literal in either file. This proof recognizes the
// contract ONLY when the whole interface holds: the invocation names the
// workflow's own manifest workflow with the always-if-exists stage in that
// order, the invocation's member token maps to the shard's family suffix
// (slickcharts-<member>.json), and the attempt script forwards both flags
// verbatim to the stage helper.
function attemptScriptForwardsManifestAlways(attemptScriptText) {
  return attemptScriptText.includes("scripts/stage-lane-manifest.sh")
    && attemptScriptText.includes('--workflow "$manifest_workflow"')
    && attemptScriptText.includes('--stage "$manifest_always"');
}

function slickchartsManifestAlwaysApplies({ workflowText, attemptScriptText, workflowRel, stage, specPath }) {
  if (stage !== "always_if_exists" || !attemptScriptForwardsManifestAlways(attemptScriptText)) {
    return false;
  }
  for (const block of workflowText.split("publish-slickcharts-attempt.sh").slice(1)) {
    const memberMatch = block.match(/^\s*\\\s*\r?\n\s*([A-Za-z0-9_-]+)/)
      ?? block.match(/^\s*([A-Za-z0-9_-]+)/);
    if (!memberMatch) continue;
    const member = memberMatch[1];
    const workflowFlagIndex = block.indexOf(`--manifest-workflow ${workflowRel}`);
    const alwaysFlagIndex = block.indexOf(`--manifest-always ${stage}`);
    if (workflowFlagIndex < 0 || alwaysFlagIndex < workflowFlagIndex) continue;
    if (specPath === `data/admin/data-supply-state/publish-outcomes/slickcharts-${member}.json`) {
      return true;
    }
  }
  return false;
}

// persist-cloud-publish-outcome.mjs is the manifest-driven consumer for
// per-family publish-outcome shards: the workflow names the family and its own
// workflow on the helper CLI, and the helper validates the owned shard against
// manifest.workflows[<workflow>].stages.always_if_exists before staging
// anything. The shard path is therefore never a literal in the workflow text
// (the computed-signals coordinator commits ONLY through this helper).
function persistOutcomeHelperApplies({ workflowText, helperText, workflowRel, stage, specPath }) {
  if (stage !== "always_if_exists") return false;
  const shardRoot = "data/admin/data-supply-state/publish-outcomes";
  if (!specPath.startsWith(`${shardRoot}/`) || !specPath.endsWith(".json")) return false;
  const family = path.posix.basename(specPath, ".json");
  return workflowText.includes(`node scripts/persist-cloud-publish-outcome.mjs --family=${family} --workflow=${workflowRel}`)
    && helperText.includes("PLANE_PUBLISH_OUTCOME_BINDINGS")
    && helperText.includes("persisted.workflows?.[workflow]?.stages?.always_if_exists")
    && helperText.includes(`${shardRoot}/\${family}.json`);
}

const slickchartsLane = LANE_REGISTRY.lanes.find((laneValue) => laneValue.id === "slickcharts");
assert.ok(
  slickchartsLane?.script_sources?.includes(SLICKCHARTS_ATTEMPT_SCRIPT),
  "the SlickCharts composite lane must declare the attempt script as its stager",
);
const slickchartsAttemptScriptText = fs.readFileSync(
  path.join(REPO_ROOT, slickchartsLane.script_sources.find((source) => source === SLICKCHARTS_ATTEMPT_SCRIPT)),
  "utf8",
);

const writerWorkflows = [...new Set(scanWriterInventory().map((entry) => entry.workflow))].sort();
for (const workflowRel of writerWorkflows) {
  const workflowText = fs.readFileSync(path.join(REPO_ROOT, workflowRel), "utf8");
  const scriptSources = new Set();
  for (const lane of LANE_REGISTRY.lanes) {
    if (lane.owner_workflow === workflowRel) for (const source of lane.script_sources ?? []) scriptSources.add(source);
    for (const caller of Object.values(lane.caller_workflows ?? {})) {
      if (lane.caller_workflows?.[workflowRel] === caller) for (const source of caller.script_sources ?? []) scriptSources.add(source);
    }
  }
  const sourceTexts = [workflowText, ...[...scriptSources].map((source) => fs.readFileSync(path.join(REPO_ROOT, source), "utf8"))];
  const sourceText = sourceTexts.join("\n");
  const entry = manifest.workflows[workflowRel];
  for (const [stage, specs] of Object.entries(entry.stages)) {
    if (workflowRel === UPDATE_MANIFEST_WORKFLOW && stage === "always_if_exists") {
      assert.deepEqual(specs.map((spec) => spec.path), centralPaths);
      assert.deepEqual(specs.filter((spec) => spec.kind === "directory").map((spec) => spec.path), expectedCentralDirectories);
      assert.equal(specs.filter((spec) => spec.kind === "file").length, centralPaths.length - expectedCentralDirectories.length);
      assert.equal(specs.every((spec) => spec.required === false), true);
      assert.match(workflowText, /node scripts\/stage-update-manifest-central\.mjs --(?:check|stage)/);
      continue;
    }
    for (const spec of specs) {
      if (spec.kind === "dynamic_set") continue;
      assert.ok(
        sourceRepresentsSpec(sourceTexts, spec)
          || workflowAppliesManifestStage(workflowText, workflowRel, stage)
          || slickchartsManifestAlwaysApplies({
            workflowText,
            attemptScriptText: slickchartsAttemptScriptText,
            workflowRel,
            stage,
            specPath: spec.path,
          })
          || persistOutcomeHelperApplies({
            workflowText,
            helperText: persistOutcomeHelperText,
            workflowRel,
            stage,
            specPath: spec.path,
          }),
        `${workflowRel} ${stage} path is not present in workflow/script source or an exact manifest-driven stage/helper: ${spec.path}`,
      );
    }
  }
  for (const spec of entry.exclude) {
    const represented = sourceText.includes(spec.path)
      || sourceText.includes(path.posix.basename(spec.path))
      || workflowAppliesManifestExcludes(workflowText, workflowRel, laneStageHelperText);
    assert.ok(represented, `${workflowRel} exclusion is not present in workflow/script source: ${spec.path}`);
  }
}

// Regression: all five SlickCharts publish-outcome shards are staged through
// the manifest-always contract (never as literal paths or lane-owned staging),
// and the recognition refuses the interface when any half of it is missing.
for (const member of ["daily", "weekly", "monthly", "history", "symbols"]) {
  const workflowRel = `.github/workflows/slickcharts-${member}.yml`;
  const shardPath = `data/admin/data-supply-state/publish-outcomes/slickcharts-${member}.json`;
  const workflowText = fs.readFileSync(path.join(REPO_ROOT, workflowRel), "utf8");
  const alwaysSpec = manifest.workflows[workflowRel].stages.always_if_exists
    .find((spec) => spec.path === shardPath);
  assert.ok(alwaysSpec, `${workflowRel} must stage its publish-outcome shard`);
  assert.equal(
    slickchartsManifestAlwaysApplies({
      workflowText,
      attemptScriptText: slickchartsAttemptScriptText,
      workflowRel,
      stage: "always_if_exists",
      specPath: shardPath,
    }),
    true,
    `${workflowRel} must satisfy the manifest-always contract for ${shardPath}`,
  );
  assert.equal(
    workflowText.includes(shardPath),
    false,
    `${workflowRel} must not hardcode the publish-outcome shard path`,
  );
}
{
  const workflowText = fs.readFileSync(
    path.join(REPO_ROOT, ".github/workflows/slickcharts-daily.yml"),
    "utf8",
  );
  const shardPath = "data/admin/data-supply-state/publish-outcomes/slickcharts-daily.json";
  // Wrong workflow named on the manifest-workflow flag -> not recognized.
  assert.equal(slickchartsManifestAlwaysApplies({
    workflowText,
    attemptScriptText: slickchartsAttemptScriptText,
    workflowRel: ".github/workflows/slickcharts-weekly.yml",
    stage: "always_if_exists",
    specPath: shardPath,
  }), false, "a workflow must not borrow another workflow's manifest contract");
  // Wrong stage -> not recognized.
  assert.equal(slickchartsManifestAlwaysApplies({
    workflowText,
    attemptScriptText: slickchartsAttemptScriptText,
    workflowRel: ".github/workflows/slickcharts-daily.yml",
    stage: "success_if_exists",
    specPath: shardPath,
  }), false, "only the always-if-exists stage is manifest-always staged");
  // Wrong member/shard pair -> not recognized.
  assert.equal(slickchartsManifestAlwaysApplies({
    workflowText,
    attemptScriptText: slickchartsAttemptScriptText,
    workflowRel: ".github/workflows/slickcharts-daily.yml",
    stage: "always_if_exists",
    specPath: "data/admin/data-supply-state/publish-outcomes/slickcharts-weekly.json",
  }), false, "the member token must map to the staged shard");
  // Attempt script that does not forward the flags -> not recognized.
  assert.equal(slickchartsManifestAlwaysApplies({
    workflowText,
    attemptScriptText: "scripts/stage-lane-manifest.sh\n",
    workflowRel: ".github/workflows/slickcharts-daily.yml",
    stage: "always_if_exists",
    specPath: shardPath,
  }), false, "the attempt script must forward the manifest-always pair verbatim");
}

const updateManifestText = fs.readFileSync(path.join(REPO_ROOT, UPDATE_MANIFEST_WORKFLOW), "utf8");
for (const triggerPath of manifest.update_manifest.trigger_paths) {
  assert.ok(updateManifestText.includes(triggerPath), `update-manifest trigger path is not represented in YAML: ${triggerPath}`);
}
const centralHelperText = fs.readFileSync(path.join(REPO_ROOT, UPDATE_MANIFEST_CENTRAL_HELPER), "utf8");
assert.match(centralHelperText, /manifest\.update_manifest\.central_commit_paths/);
assert.match(centralHelperText, /buildLaneCommitManifest\(\)\.update_manifest\.central_commit_paths/);
assert.ok(
  centralHelperText.includes("central_commit_paths must contain exactly \${builtPaths.length} unique paths"),
  "central staging count check must be derived from the generated manifest",
);
assert.match(updateManifestText, /stage-update-manifest-central\.mjs --check/);
assert.match(updateManifestText, /stage-update-manifest-central\.mjs --stage/);

console.log("test-lane-commit-manifest-parity: ok (declared paths represented by literal or exact manifest-driven consumers)");
