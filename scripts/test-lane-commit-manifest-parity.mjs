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
const packageJson = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "100xfenok-next/package.json"), "utf8"),
);
assert.equal(
  canonicalJson(persistedManifest),
  canonicalJson(manifest),
  "data/admin/lane-commit-manifest.json must match the canonical registry-derived manifest",
);
const UPDATE_MANIFEST_WORKFLOW = ".github/workflows/update-manifest.yml";
const UPDATE_MANIFEST_CENTRAL_HELPER = "scripts/stage-update-manifest-central.mjs";
const LANE_STAGE_HELPER = "scripts/stage-lane-manifest.sh";
// Expected central policy is derived from the generated contract, never a
// copied list: the directory set and file count follow the builder's
// file/directory kind rule over the derived central path list (hand-maintained
// base + materialization destinations in route order). Ordering, kinds, and
// counts therefore flow from the builder's exported kind classifier instead of
// a second oracle.
const centralPaths = manifest.update_manifest.central_commit_paths;
const isDirectoryPath = (pathValue) => centralCommitPathKind(pathValue) === "directory";
const expectedCentralDirectories = centralPaths.filter(isDirectoryPath);


// All three tests and the detection-floor fixture are CI dependencies: each
// path must appear in both push and pull_request filters. The parity contract
// runs through qa:pins so the Update Manifest validation step must invoke that
// gate without duplicating this command directly.
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
assert.match(updateValidationBlock, /npm --prefix 100xfenok-next run qa:pins/);
assert.doesNotMatch(updateValidationBlock, /node scripts\/test-lane-commit-manifest-parity\.mjs/);
assert.match(packageJson.scripts["qa:pins"], /node \.\.\/scripts\/test-lane-commit-manifest-parity\.mjs/);

function sourceRepresentsSpec(sourceTexts, spec) {
  if (sourceTexts.some((sourceText) => sourceText.includes(spec.path))) return true;
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

// A workflow that builds its own candidate digest list must derive the skipped
// paths from the same manifest exclusions the staging step removes. A path that
// is digested but never committed can never satisfy an origin/main payload
// readback, so the lane fails on every run until a human edits the file.
function workflowDerivesCandidateExcludes(workflowText, workflowRel, stageHelperText) {
  return workflowText.includes("scripts/stage-lane-manifest.sh")
    && workflowText.includes(`--workflow ${workflowRel}`)
    && workflowText.includes("--list-excludes")
    && stageHelperText.includes(".workflows[$workflow].exclude[]?.path");
}

function workflowAppliesManifestStage(workflowText, workflowRel, stage) {
  return workflowText.includes("scripts/stage-lane-manifest.sh")
    && workflowText.includes(`--workflow ${workflowRel}`)
    && new RegExp(`--stage\\s+${stage}\\b`).test(workflowText);
}

const laneStageHelperText = fs.readFileSync(path.join(REPO_ROOT, LANE_STAGE_HELPER), "utf8");
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
        `${workflowRel} ${stage} path is not present in workflow/script source or an exact manifest-driven stage/helper: ${spec.path}`,
      );
    }
  }
  for (const spec of entry.exclude) {
    // The exact path or the manifest-driven interface only: a bare basename can
    // be satisfied by an unrelated file that merely shares its name.
    const represented = sourceText.includes(spec.path)
      || workflowAppliesManifestExcludes(workflowText, workflowRel, laneStageHelperText);
    assert.ok(represented, `${workflowRel} exclusion is not present in workflow/script source: ${spec.path}`);
    if (workflowText.includes("candidate-digests.txt")) {
      assert.ok(
        workflowDerivesCandidateExcludes(workflowText, workflowRel, laneStageHelperText),
        `${workflowRel} builds a candidate digest list but does not derive manifest exclusions for ${spec.path}`,
      );
    }
  }
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
