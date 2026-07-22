#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import { buildLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { enumerateCommitCapableWorkflows } from "./check-lane-commit-manifest-inventory.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = buildLaneCommitManifest(LANE_REGISTRY);
const UPDATE_MANIFEST_WORKFLOW = ".github/workflows/update-manifest.yml";
const UPDATE_MANIFEST_CENTRAL_HELPER = "scripts/stage-update-manifest-central.mjs";
const LANE_STAGE_HELPER = "scripts/stage-lane-manifest.sh";
const UPDATE_MANIFEST_CENTRAL_DIRECTORIES = [
  "data/computed/market_facts",
  "100xfenok-next/public/data/yf/finance",
  "100xfenok-next/public/data/stockanalysis",
  "100xfenok-next/public/data/slickcharts",
];

const ATTEMPT_SHARD_ROOT = "data/admin/data-supply-state/detection-attempts";

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

const laneStageHelperText = fs.readFileSync(path.join(REPO_ROOT, LANE_STAGE_HELPER), "utf8");

for (const workflowRel of enumerateCommitCapableWorkflows()) {
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
      assert.deepEqual(specs.map((spec) => spec.path), manifest.update_manifest.central_commit_paths);
      assert.deepEqual(specs.filter((spec) => spec.kind === "directory").map((spec) => spec.path), UPDATE_MANIFEST_CENTRAL_DIRECTORIES);
      assert.equal(specs.filter((spec) => spec.kind === "file").length, 56);
      assert.equal(specs.every((spec) => spec.required === false), true);
      assert.match(workflowText, /node scripts\/stage-update-manifest-central\.mjs --(?:check|stage)/);
      continue;
    }
    for (const spec of specs) {
      if (spec.kind === "dynamic_set") continue;
      assert.ok(sourceRepresentsSpec(sourceTexts, spec), `${workflowRel} ${stage} path is not present in workflow/script source: ${spec.path}`);
    }
  }
  for (const spec of entry.exclude) {
    const represented = sourceText.includes(spec.path)
      || sourceText.includes(path.posix.basename(spec.path))
      || workflowAppliesManifestExcludes(workflowText, workflowRel, laneStageHelperText);
    assert.ok(represented, `${workflowRel} exclusion is not present in workflow/script source: ${spec.path}`);
  }
}

const updateManifestText = fs.readFileSync(path.join(REPO_ROOT, UPDATE_MANIFEST_WORKFLOW), "utf8");
for (const triggerPath of manifest.update_manifest.trigger_paths) {
  assert.ok(updateManifestText.includes(triggerPath), `update-manifest trigger path is not represented in YAML: ${triggerPath}`);
}
const centralHelperText = fs.readFileSync(path.join(REPO_ROOT, UPDATE_MANIFEST_CENTRAL_HELPER), "utf8");
assert.match(centralHelperText, /manifest\.update_manifest\.central_commit_paths/);
assert.match(centralHelperText, /buildLaneCommitManifest\(\)\.update_manifest\.central_commit_paths/);
assert.match(centralHelperText, /central_commit_paths must contain exactly 60 unique paths/);
assert.match(updateManifestText, /stage-update-manifest-central\.mjs --check/);
assert.match(updateManifestText, /stage-update-manifest-central\.mjs --stage/);

console.log("test-lane-commit-manifest-parity: ok (declared paths represented by literal or exact manifest-driven consumers)");
