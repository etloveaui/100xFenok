#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/fetch-fenok-private-options.yml", import.meta.url), "utf8");
const broadWorkflow = fs.readFileSync(new URL("../.github/workflows/fetch-yf-finance.yml", import.meta.url), "utf8");
const broadCollector = fs.readFileSync(new URL("./fetch-yf-finance.py", import.meta.url), "utf8");

assert.match(workflow, /cron: ['"]10 1 \* \* 2-6['"]/);
assert.match(workflow, /\$RUNNER_TEMP\/yf-options/);
assert.match(workflow, /run-fenok-private-options\.mjs/);
assert.match(workflow, /DASH,UNH,PYPL,RDDT,COIN,MU,PLTR,NVDA/);
assert.match(workflow, /data\/computed\/fenok_yahoo_private_options_availability\.json/);
assert.match(workflow, /data\/admin\/yahoo_private_options/);
assert.match(workflow, /detection-attempts\/yahoo_private_options\.json/);
assert.equal(broadWorkflow.includes("include_options"), false);
assert.equal(broadWorkflow.includes("--include-options"), false);
assert.match(broadCollector, /--include-options is disabled; use fetch-fenok-private-options\.py/);
for (const forbidden of ["git add -- _private", "git add -- data/yf/finance", "100xfenok-next/public/data/yf/finance"]) {
  assert.equal(workflow.includes(forbidden), false, `unsafe staging surface: ${forbidden}`);
}

const registryGate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText: workflow,
  workflowRel: ".github/workflows/fetch-fenok-private-options.yml",
});
assert.equal(registryGate.ok, true, JSON.stringify(registryGate));
assert.deepEqual(registryGate.lanes, ["yahoo_private_options"]);

console.log("test-fetch-fenok-private-options-workflow: ok");
