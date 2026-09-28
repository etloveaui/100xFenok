#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for the slickcharts family
// (#366 step 4, script-side publisher slice). The family commits via
// scripts/publish-slickcharts-attempt.sh, so the allowlist is scanned across
// workflow text + the declared script source. slickcharts-daily owns the full
// admin store; the other four members commit composite recovery state.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY_STATE_ROOT = "data/admin/slickcharts-daily-delivery";
const COMPOSITE_STATE_ROOT = "data/admin/slickcharts-composite-recovery";

// primary: daily owns the full admin store
{
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "slickcharts-daily.yml"), "utf8"),
    workflowRel: ".github/workflows/slickcharts-daily.yml",
    repoRoot: REPO_ROOT,
  });
  assert.equal(gate.ok, true, JSON.stringify({ missing: gate.missing_in_workflow, undeclared: gate.undeclared_in_workflow }));
  assert.deepEqual(gate.lanes, ["slickcharts"], "slickcharts-daily must be the lane's primary owner");
  assert.equal(gate.scope, "primary");
  assert.equal(gate.declared_count, 2, "daily declares composite and compatibility daily stores");
}

// callers: the other four members own composite state
for (const member of ["weekly", "monthly", "history", "symbols"]) {
  const rel = `.github/workflows/slickcharts-${member}.yml`;
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"),
    workflowRel: rel,
    repoRoot: REPO_ROOT,
  });
  assert.equal(gate.ok, true, `${member}: ${JSON.stringify({ missing: gate.missing_in_workflow, undeclared: gate.undeclared_in_workflow })}`);
  assert.deepEqual(gate.lanes, ["slickcharts"], `${member} must resolve to the shared slickcharts lane`);
  assert.equal(gate.scope, "caller", `${member} must be a declared caller workflow, not the primary`);
  assert.equal(gate.declared_count, 1, `${member} declares composite state`);
  assert.ok(gate.allowlist_count >= 2, `${member}'s publish script is scanned for the store path`);
}

// the publish script really carries both admin state paths (contract of this gate)
{
  const script = fs.readFileSync(path.join(REPO_ROOT, "scripts", "publish-slickcharts-attempt.sh"), "utf8");
  assert.match(script, new RegExp(DAILY_STATE_ROOT.replaceAll("/", "\\/")));
  assert.match(script, new RegExp(COMPOSITE_STATE_ROOT.replaceAll("/", "\\/")));
}

console.log("test-slickcharts-commit-shards: ok");
