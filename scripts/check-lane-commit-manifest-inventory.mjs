#!/usr/bin/env node

// Repo-wide inventory gate for commit-capable workflow surfaces. Unlike the
// legacy lane gate, this checks the complete workflow set, including platform
// publishers and script-backed SlickCharts callers.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = path.join(REPO_ROOT, ".github", "workflows");
const COMMIT_SURFACE_RE = /(?:\bgit\s+add\b|\bgit\s+commit\b|publish-slickcharts-attempt\.sh)/;

export function enumerateCommitCapableWorkflows({ repoRoot = REPO_ROOT } = {}) {
  const workflowDir = path.join(repoRoot, ".github", "workflows");
  return fs.readdirSync(workflowDir)
    .filter((name) => name.endsWith(".yml"))
    .map((name) => `.github/workflows/${name}`)
    .filter((workflowRel) => COMMIT_SURFACE_RE.test(fs.readFileSync(path.join(repoRoot, workflowRel), "utf8")))
    .sort();
}

const actual = enumerateCommitCapableWorkflows();
const declared = Object.keys(LANE_REGISTRY.workflow_policies).sort();
export function assertCommitSurfaceInventory() {
  assert.deepEqual(actual, declared, `commit-capable workflow inventory drifted: actual=${actual.join(",")} declared=${declared.join(",")}`);
  assert.equal(actual.length, 25, "repo-wide commit surface count must remain 25 until a conscious inventory update");
  return actual;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assertCommitSurfaceInventory();
  console.log(`check-lane-commit-manifest-inventory: ok (${actual.length} commit-capable workflow surfaces)`);
}
