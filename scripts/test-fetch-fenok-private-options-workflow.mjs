#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";
import { registryLaneById } from "./lib/lane-registry.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/fetch-fenok-private-options.yml", import.meta.url), "utf8");
const broadWorkflow = fs.readFileSync(new URL("../.github/workflows/fetch-yf-finance.yml", import.meta.url), "utf8");
const broadCollector = fs.readFileSync(new URL("./fetch-yf-finance.py", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../data/admin/lane-commit-manifest.json", import.meta.url), "utf8"));
const stages = manifest.workflows[".github/workflows/fetch-fenok-private-options.yml"].stages;
const manualGitAdds = [...workflow.matchAll(/^\s*git add -- (.+)$/gmu)]
  .map((match) => match[1].trim());

assert.match(workflow, /cron: ['"]10 1 \* \* 2-6['"]/);
assert.match(workflow, /workflow_dispatch:\s*\n\s+inputs:\s*\n\s+controlled_failure_key:/);
assert.match(workflow, /description: ['"]Owner-approved failure proof: target exactly one options key \(availability\)['"]/);
assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY: \$\{\{ github\.event\.inputs\.controlled_failure_key \|\| '' \}\}/);
assert.match(workflow, /\$RUNNER_TEMP\/yf-options/);
assert.match(workflow, /run-fenok-private-options\.mjs/);
assert.match(workflow, /DASH,UNH,PYPL,RDDT,COIN,MU,PLTR,NVDA/);
assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
assert.match(workflow, /--stage always_if_exists/);
assert.match(workflow, /--stage success_if_exists/);
assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
assert.deepEqual(stages, {
  always_if_exists: [
    {
      kind: "file",
      path: "data/admin/data-supply-state/detection-attempts/yahoo_private_options.json",
      required: false,
    },
    {
      kind: "directory",
      path: "data/admin/yahoo_private_options",
      required: false,
    },
  ],
  required_on_success: [],
  success_if_exists: [
    {
      kind: "file",
      path: "data/computed/fenok_yahoo_private_options_availability.json",
      required: true,
    },
  ],
  success_verify_not_plan_if_exists: [],
});
assert.deepEqual(manualGitAdds, [], "private-options staging must be manifest-owned");
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
assert.equal(registryLaneById("yahoo_private_options")?.enforcement, "live",
  "the targeted Yahoo options lane is live only after its natural scheduled evidence is committed");

console.log("test-fetch-fenok-private-options-workflow: ok");
