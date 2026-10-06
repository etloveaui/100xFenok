#!/usr/bin/env node
// Lane Registry ⇄ commit-shard completeness gate for fetch-yf-finance.yml
// (#366 step 4). The lane's bounded store root is the only admin path this
// workflow commits; the gate keeps it that way in both directions.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

// Execute the actual production loop under bash -e. Only the provider and
// aggregator process boundary is stubbed; Python fixtures validate their data.
const fetchStep = extractStepSpan(acquireJob, "Run batch fetch");
const loopStart = fetchStep.indexOf('          if [ "${INPUT_DAILY_ALL_SHARDS:-false}" = "true" ]');
assert.ok(loopStart >= 0, "daily all-shards branch must exist");
const dailyLines = fetchStep.slice(loopStart).split("\n");
const loopEnd = dailyLines.findIndex((line) => line.trim() && !line.startsWith("          "));
const dailyShell = dailyLines.slice(0, loopEnd < 0 ? undefined : loopEnd).map((line) => line.slice(10)).join("\n");
for (const scenario of [
  { name: "isolated", statuses: "1,0,0", exit: 1, calls: ["0/3", "1/3", "2/3", "aggregate"] },
  { name: "systemic", statuses: "2,0,0", exit: 2, calls: ["0/3", "aggregate"] },
  { name: "missing-evidence", statuses: "1,0,0", exit: 2, missing: "true", calls: ["0/3", "aggregate"] },
  { name: "success", statuses: "0,0,0", exit: 0, calls: ["0/3", "1/3", "2/3", "aggregate"] },
]) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "yf-shards-"));
  try {
    const bin = path.join(fixture, "bin");
    fs.mkdirSync(bin);
    const callsPath = path.join(fixture, "calls.txt");
    fs.writeFileSync(path.join(bin, "python3"), `#!/usr/bin/env bash
if [ "$1" = "scripts/rebuild-yf-finance-summary.py" ]; then
  echo aggregate >> "$FAKE_CALLS"
  exit "$FAKE_AGGREGATE_EXIT"
fi
if [ "$1" != "scripts/fetch-yf-finance.py" ]; then exit 99; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--shard" ]; then SHARD="$2"; break; fi
  shift
done
echo "$SHARD" >> "$FAKE_CALLS"
IFS=, read -r -a STATUSES <<< "$FAKE_SHARD_STATUSES"
if [ "$FAKE_MISSING_SUMMARY" != "true" ]; then
  mkdir -p data/yf/finance
  echo '{}' > data/yf/finance/_summary.json
fi
exit "\${STATUSES[\${SHARD%%/*}]}"
`, { mode: 0o755 });
    const result = spawnSync("bash", ["-e", "-c", dailyShell], {
      cwd: fixture,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: fixture,
        INPUT_DAILY_ALL_SHARDS: "true",
        INPUT_DAILY_STOCK_SHARDS: "3",
        INPUT_SHARD: "",
        INPUT_PLAN_ONLY: "false",
        ARGS: "",
        FAKE_CALLS: callsPath,
        FAKE_SHARD_STATUSES: scenario.statuses,
        FAKE_AGGREGATE_EXIT: String(scenario.exit),
        FAKE_MISSING_SUMMARY: scenario.missing ?? "false",
      },
    });
    assert.equal(result.status, scenario.exit, `${scenario.name}: ${result.stderr}`);
    assert.deepEqual(fs.readFileSync(callsPath, "utf8").trim().split("\n"), scenario.calls,
      `${scenario.name}: isolated failures continue; systemic failures stop and aggregate`);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

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

// Acquisition stays read-only against the remote: local fetch/checkout are
// allowed, but no remote Git mutation or workflow dispatch command may appear
// inside the acquire job itself (workflow dispatch is `gh workflow run` in
// this repo's command vocabulary).
for (const forbidden of ["git add", "git commit", "git push", "git pull", "gh workflow run"]) {
  assert.ok(!acquireJob.includes(forbidden),
    `acquire-yf-finance must not contain "${forbidden}"`);
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
assert.doesNotMatch(cloudJob, /fenok-data-writer-refs\/heads\/main/);
for (const forbidden of ["git add", "git commit", "git push"]) {
  assert.ok(!cloudJob.includes(forbidden), `cloud-only job must not contain ${forbidden}`);
}
assert.match(cloudJob, /publish-cloud-data-generation\.mjs/);
assert.match(cloudJob, /ref: \$\{\{ needs\.publish-yf-finance\.outputs\.pushed_sha \}\}/,
  "the cloud job must publish the read-back source revision, not a moving branch");
assert.match(cloudJob, /persist-credentials: false/);
const sharedDispatch = extractStepSpan(publishJob, "Dispatch shared projection rebuild");
assert.match(sharedDispatch, /always\(\)/);
assert.match(sharedDispatch, /success\(\)/);
assert.match(sharedDispatch, /needs\.acquire-yf-finance\.outputs\.fetch_outcome == 'failure'/);
assert.match(sharedDispatch, /steps\.readback\.outputs\.confirmed == 'true'/);
assert.doesNotMatch(sharedDispatch, /needs\.publish-yf-cloud/,
  "source failure evidence must not depend on cloud publication");
assert.equal(
  (publishJob.match(/gh workflow run update-manifest\.yml --ref main/g) ?? []).length,
  1,
  "the source job must dispatch one shared projection rebuild per run",
);
const edgarText = fs.readFileSync(new URL("../.github/workflows/fetch-edgar-filings.yml", import.meta.url), "utf8");
const edgarHeader = edgarText.split(/^jobs:/m)[0];
assert.doesNotMatch(edgarHeader, /fenok-data-writer-refs\/heads\/main/,
  "EDGAR must not hold the global writer lock across its whole workflow");
const edgarSource = extractJobSpan(edgarText, "fetch-edgar-filings");
const edgarCloud = extractJobSpan(edgarText, "publish-edgar-cloud");
assert.match(edgarSource, /fenok-data-writer-refs\/heads\/main/);
assert.doesNotMatch(edgarSource, /publish-cloud-data-generation\.mjs/);
assert.doesNotMatch(edgarCloud, /fenok-data-writer-refs\/heads\/main/);
assert.match(edgarCloud, /ref: \$\{\{ needs\.fetch-edgar-filings\.outputs\.source_sha \}\}/);
assert.match(edgarCloud, /persist-credentials: false/);
assert.match(edgarCloud, /outputs\.plan_only != 'true'/);
assert.match(edgarCloud, /outputs\.verify_outcome == 'success'/);
assert.match(edgarCloud, /publish-cloud-data-generation\.mjs/);
console.log("test-fetch-yf-finance-workflow: ok");
