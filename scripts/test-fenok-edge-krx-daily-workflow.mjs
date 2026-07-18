#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fenok-edge-krx-daily.yml
// (#366 step 4). KRX is owner-gated with no registry lane and no lane store:
// the only admin path this workflow commits is the public-safe bridge index,
// which must stay covered by a declared exception. Zero-lane + zero-store is
// the asserted shape, not an oversight.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fenok-edge-krx-daily.yml", import.meta.url), "utf8");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fenok-edge-krx-daily.yml",
});
assert.deepEqual(gate.lanes, [], "KRX must stay owner-gated with no registry lane attribution");
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.allowlist_count, 1, "the KRX workflow commits exactly the public-safe bridge index");

console.log("test-fenok-edge-krx-daily-workflow: ok");
