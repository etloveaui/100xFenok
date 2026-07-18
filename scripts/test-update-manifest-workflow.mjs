#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for update-manifest.yml
// (#366 step 4). The central reconciler owns no lane but commits many admin
// control-plane artifacts; every one must be covered by a registry lane
// declaration or a declared exception.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/update-manifest.yml", import.meta.url), "utf8");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/update-manifest.yml",
});
assert.deepEqual(gate.lanes, [], "update-manifest is a central reconciler with no lane attribution");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.equal(gate.allowlist_count > 0, true, "update-manifest does commit admin control-plane artifacts");

console.log("test-update-manifest-workflow: ok");
