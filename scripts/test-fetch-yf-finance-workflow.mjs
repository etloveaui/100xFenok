#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fetch-yf-finance.yml
// (#366 step 4). The lane's bounded store root is the only admin path this
// workflow commits; the gate keeps it that way in both directions.
import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-yf-finance.yml", import.meta.url), "utf8");
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fetch-yf-finance.yml",
});
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.lanes, ["yahoo_batch_quote_history"], "the registry must attribute this lane to fetch-yf-finance.yml");

console.log("test-fetch-yf-finance-workflow: ok");
