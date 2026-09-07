#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fetch-yf-finance.yml
// (#366 step 4). The lane's bounded store root is the only admin path this
// workflow commits; the gate keeps it that way in both directions.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-yf-finance.yml", import.meta.url), "utf8");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Indentation-aware job/step isolation: an assertion about a step must prove
// itself inside that step's own span. A whole-file lazy span lets an earlier
// pack-step condition stand in for the publish persist step, so a two-job
// acquire/artifact/publish split could otherwise pass falsely.
function extractJobSpan(text, jobName) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.ok(start !== -1, `job ${jobName} must exist`);
  let end = start + 1;
  while (end < lines.length && !/^  \S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

function extractStepSpan(jobSpan, stepName) {
  const lines = jobSpan.split("\n");
  const start = lines.findIndex((line) => line === `      - name: ${stepName}`);
  assert.ok(start !== -1, `step ${stepName} must exist in the job`);
  let end = start + 1;
  while (end < lines.length && !/^      - /.test(lines[end])) end += 1;
  return lines.slice(start, end).join("\n");
}

const acquireJob = extractJobSpan(workflowText, "acquire-yf-finance");
const publishJob = extractJobSpan(workflowText, "publish-yf-finance");

for (const input of [
  "untracked_only", "retry_limit", "regular_limit", "untracked_limit",
  "shard_cycle_index", "scheduled_weekday", "stable_shards",
]) {
  assert.match(workflowText, new RegExp(`^      ${input}:\\n`, "m"),
    `workflow_dispatch must expose bounded recovery input ${input}`);
}
assert.match(
  workflowText,
  /bounded untracked recovery requires stable_shards=true, shard=i\/6, shard_cycle_index, and scheduled_weekday/,
  "untracked recovery must fail closed without deterministic shard controls",
);
assert.match(
  workflowText,
  /bounded untracked recovery requires limit, retry_limit, regular_limit, and untracked_limit/,
  "untracked recovery must fail closed without explicit budgets",
);
assert.match(workflowText, /INPUT_UNTRACKED_LIMIT: \$\{\{ github\.event\.inputs\.untracked_limit \|\| '' \}\}/);
assert.match(workflowText, /INPUT_STABLE_SHARDS: \$\{\{ github\.event\.inputs\.stable_shards \|\| 'false' \}\}/);
assert.match(
  workflowText,
  /if \[ "\$EVENT_NAME" = "schedule" \] \|\| \[ "\$INPUT_UNTRACKED_ONLY" = "true" \]; then ARGS="\$ARGS --natural-run"; fi/,
  "bounded manual recovery must claim the natural retry queue while ordinary dispatches stay unchanged",
);
const gate = checkWorkflowCommitShardsAgainstRegistry({
  workflowText,
  workflowRel: ".github/workflows/fetch-yf-finance.yml",
  repoRoot,
});
assert.deepEqual(gate.missing_in_workflow, [],
  `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
assert.deepEqual(gate.undeclared_in_workflow, [],
  `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
assert.deepEqual(gate.lanes, ["yahoo_batch_quote_history"], "the registry must attribute this lane to fetch-yf-finance.yml");

// Acquisition stays read-only against the remote: local fetch/checkout are
// allowed, but no remote Git mutation or workflow dispatch command may appear
// inside the acquire job itself (workflow dispatch is `gh workflow run` in
// this repo's command vocabulary).
for (const forbidden of ["git add", "git commit", "git push", "git pull", "gh workflow run"]) {
  assert.ok(!acquireJob.includes(forbidden),
    `acquire-yf-finance must not contain "${forbidden}"`);
}

// The standard attempt shard step runs under the exact always/non-plan
// condition inside the acquire job, after the batch and before downstream
// refresh work.
{
  const emitStep = extractStepSpan(acquireJob, "Emit Yahoo batch detection attempt");
  assert.match(
    emitStep,
    /if: \$\{\{ always\(\) && env\.YF_PLAN_ONLY != 'true' \}\}/,
    "the attempt shard step must run under the exact always/non-plan condition",
  );
  assert.match(
    emitStep,
    /node scripts\/emit-yahoo-batch-quote-history-attempt\.mjs/,
    "the attempt shard step must call the standard emitter",
  );
  const refreshStep = extractStepSpan(acquireJob, "Refresh owned Yahoo quarter-close source");
  assert.ok(acquireJob.indexOf(refreshStep) > acquireJob.indexOf(emitStep),
    "the standard attempt shard must be emitted after the batch and before downstream refresh work");
}

// The non-plan persist step must carry, in order, the exact always/non-plan
// condition, this workflow's manifest staging invocation, the
// always_if_exists stage, a real git add, and the finance summary restore
// exclusion. The markers are proven inside the publish persist step's own
// span, so an earlier pack-step condition cannot satisfy this assertion.
{
  const persistStep = extractStepSpan(publishJob, "Commit and push fetched Yahoo source data");
  const persistMarkers = [
    "if: ${{ always() && env.YF_PLAN_ONLY != 'true' }}",
    "scripts/stage-lane-manifest.sh",
    "--workflow .github/workflows/fetch-yf-finance.yml",
    "--stage always_if_exists",
    "git add --",
    "git restore --staged --worktree -- data/yf/finance/_summary.json",
  ];
  let cursor = -1;
  for (const marker of persistMarkers) {
    const at = persistStep.indexOf(marker, cursor + 1);
    assert.ok(at > cursor,
      `publish persist step must contain "${marker}" in order after the previous persist marker`);
    cursor = at;
  }
}

// Cloud transfer is not a Git write. Keeping it inside the writer job held
// every other producer behind 20-53 minutes of upload/readback work. Check
// job boundaries, including the separate outcome writer, rather than timing
// or a particular spelling of the publisher command.
assert.doesNotMatch(publishJob, /publish-cloud-data-generation\.mjs/,
  "Yahoo cloud upload must not occupy the global Git writer job");
const cloudJob = extractJobSpan(workflowText, "publish-yf-cloud");
const outcomeJob = extractJobSpan(workflowText, "persist-yf-cloud-outcome");
assert.doesNotMatch(cloudJob, /fenok-data-writer-refs\/heads\/main/);
for (const forbidden of ["git add", "git commit", "git push", "persist-cloud-publish-outcome.mjs"]) {
  assert.ok(!cloudJob.includes(forbidden), `cloud-only job must not contain ${forbidden}`);
}
assert.match(cloudJob, /publish-cloud-data-generation\.mjs/);
assert.match(cloudJob, /ref: \$\{\{ needs\.publish-yf-finance\.outputs\.pushed_sha \}\}/,
  "the cloud job must publish the read-back source revision, not a moving branch");
assert.match(cloudJob, /persist-credentials: false/);
assert.match(cloudJob, /needs\.acquire-yf-finance\.result == 'success'/,
  "failed acquisition still records source evidence but cannot publish a cloud candidate");
const failureDispatch = extractStepSpan(publishJob, "Publish failed Yahoo attempt evidence");
assert.match(failureDispatch, /always\(\)/);
assert.match(failureDispatch, /steps\.readback\.outputs\.confirmed == 'true'/);
assert.doesNotMatch(failureDispatch, /needs\.publish-yf-cloud/,
  "source failure evidence must not depend on the cloud job that the failure skips");
assert.match(outcomeJob, /fenok-data-writer-refs\/heads\/main/);
assert.match(outcomeJob, /ref: \$\{\{ needs\.publish-yf-finance\.outputs\.pushed_sha \}\}/,
  "outcome merge starts at the same snapshot as publication before rebasing onto main");
assert.match(outcomeJob, /persist-cloud-publish-outcome\.mjs/);
assert.doesNotMatch(outcomeJob, /publish-cloud-data-generation\.mjs/);
assert.match(outcomeJob, /always\(\)/, "failed publication must still reach outcome persistence");

const edgarText = fs.readFileSync(new URL("../.github/workflows/fetch-edgar-filings.yml", import.meta.url), "utf8");
const edgarHeader = edgarText.split(/^jobs:/m)[0];
assert.doesNotMatch(edgarHeader, /fenok-data-writer-refs\/heads\/main/,
  "EDGAR must not hold the global writer lock across its whole workflow");
const edgarSource = extractJobSpan(edgarText, "fetch-edgar-filings");
const edgarCloud = extractJobSpan(edgarText, "publish-edgar-cloud");
const edgarOutcome = extractJobSpan(edgarText, "persist-edgar-cloud-outcome");
assert.match(edgarSource, /fenok-data-writer-refs\/heads\/main/);
assert.doesNotMatch(edgarSource, /publish-cloud-data-generation\.mjs/);
assert.doesNotMatch(edgarCloud, /fenok-data-writer-refs\/heads\/main/);
assert.match(edgarCloud, /ref: \$\{\{ needs\.fetch-edgar-filings\.outputs\.source_sha \}\}/);
assert.match(edgarCloud, /persist-credentials: false/);
assert.match(edgarCloud, /outputs\.plan_only != 'true'/);
assert.match(edgarCloud, /outputs\.verify_outcome == 'success'/);
assert.match(edgarCloud, /publish-cloud-data-generation\.mjs/);
assert.match(edgarOutcome, /fenok-data-writer-refs\/heads\/main/);
assert.match(edgarOutcome, /ref: \$\{\{ needs\.fetch-edgar-filings\.outputs\.source_sha \}\}/);
assert.match(edgarOutcome, /persist-cloud-publish-outcome\.mjs/);
assert.doesNotMatch(edgarOutcome, /publish-cloud-data-generation\.mjs/);
assert.match(edgarOutcome, /always\(\)/);
for (const tail of [outcomeJob, edgarOutcome]) {
  assert.doesNotMatch(tail, /result != 'cancelled'/,
    "cancellation must not discard a fresh outcome artifact already emitted by the cloud job");
  assert.match(tail, /result != 'skipped'/,
    "a cloud job that never ran must not start an outcome writer");
}

console.log("test-fetch-yf-finance-workflow: ok");
