#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync(new URL("../.github/workflows/fetch-fenok-private-options.yml", import.meta.url), "utf8");
const broadWorkflow = fs.readFileSync(new URL("../.github/workflows/fetch-yf-finance.yml", import.meta.url), "utf8");
const broadCollector = fs.readFileSync(new URL("./fetch-yf-finance.py", import.meta.url), "utf8");
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
assert.deepEqual(manualGitAdds, [], "private-options staging must be manifest-owned");
assert.equal(broadWorkflow.includes("include_options"), false);
assert.equal(broadWorkflow.includes("--include-options"), false);
assert.match(broadCollector, /--include-options is disabled; use fetch-fenok-private-options\.py/);
for (const forbidden of ["git add -- _private", "git add -- data/yf/finance", "100xfenok-next/public/data/yf/finance"]) {
  assert.equal(workflow.includes(forbidden), false, `unsafe staging surface: ${forbidden}`);
}

console.log("test-fetch-fenok-private-options-workflow: ok");
