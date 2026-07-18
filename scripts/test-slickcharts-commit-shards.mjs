#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for the slickcharts family
// (#366 step 4, script-side publisher slice). The family commits via
// scripts/publish-slickcharts-attempt.sh, so the allowlist is scanned across
// workflow text + the declared script source. slickcharts-daily owns the full
// admin store; the other four members commit only their merged shard row.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARD = "data/admin/data-supply-state/detection-attempts/slickcharts.json";
const STATE_ROOT = "data/admin/slickcharts-daily-delivery";

// primary: daily owns shard + full admin store
{
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "slickcharts-daily.yml"), "utf8"),
    workflowRel: ".github/workflows/slickcharts-daily.yml",
    repoRoot: REPO_ROOT,
  });
  assert.equal(gate.ok, true, JSON.stringify({ missing: gate.missing_in_workflow, undeclared: gate.undeclared_in_workflow }));
  assert.deepEqual(gate.lanes, ["slickcharts"], "slickcharts-daily must be the lane's primary owner");
  assert.equal(gate.scope, "primary");
  assert.equal(gate.declared_count, 2, "daily declares the shard and the admin store root");
}

// callers: the other four members own only their merged shard row
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
  assert.equal(gate.declared_count, 1, `${member} declares only its merged shard row`);
  assert.ok(gate.allowlist_count >= 2, `${member}'s publish script is scanned for the shard and store paths`);
}

// the publish script really carries both admin paths (contract of this gate)
{
  const script = fs.readFileSync(path.join(REPO_ROOT, "scripts", "publish-slickcharts-attempt.sh"), "utf8");
  assert.match(script, new RegExp(SHARD.replaceAll("/", "\\/").replaceAll(".", "\\.")));
  assert.match(script, new RegExp(STATE_ROOT.replaceAll("/", "\\/")));
}

console.log("test-slickcharts-commit-shards: ok");
