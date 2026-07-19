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

for (const workflowRel of enumerateCommitCapableWorkflows()) {
  const workflowText = fs.readFileSync(path.join(REPO_ROOT, workflowRel), "utf8");
  const scriptSources = new Set();
  for (const lane of LANE_REGISTRY.lanes) {
    if (lane.owner_workflow === workflowRel) for (const source of lane.script_sources ?? []) scriptSources.add(source);
    for (const caller of Object.values(lane.caller_workflows ?? {})) {
      if (lane.caller_workflows?.[workflowRel] === caller) for (const source of caller.script_sources ?? []) scriptSources.add(source);
    }
  }
  const sourceText = [workflowText, ...[...scriptSources].map((source) => fs.readFileSync(path.join(REPO_ROOT, source), "utf8"))].join("\n");
  const entry = manifest.workflows[workflowRel];
  for (const [stage, specs] of Object.entries(entry.stages)) {
    for (const spec of specs) {
      if (spec.kind === "dynamic_set") continue;
      assert.ok(sourceText.includes(spec.path), `${workflowRel} ${stage} path is not present in workflow/script source: ${spec.path}`);
    }
  }
  for (const spec of entry.exclude) {
    const represented = sourceText.includes(spec.path)
      || sourceText.includes(path.posix.basename(spec.path));
    assert.ok(represented, `${workflowRel} exclusion is not present in workflow/script source: ${spec.path}`);
  }
}

const updateManifestText = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/update-manifest.yml"), "utf8");
for (const triggerPath of manifest.update_manifest.trigger_paths) {
  assert.ok(updateManifestText.includes(triggerPath), `update-manifest trigger path is not represented in YAML: ${triggerPath}`);
}
for (const pathValue of manifest.update_manifest.central_commit_paths) {
  const text = updateManifestText;
  assert.ok(text.includes(pathValue), `update-manifest central path is not represented in YAML: ${pathValue}`);
}

console.log("test-lane-commit-manifest-parity: ok (all declared concrete paths represented in current producer surfaces)");
