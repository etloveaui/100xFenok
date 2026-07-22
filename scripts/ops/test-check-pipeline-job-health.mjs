import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NON_SCHEDULED_WORKFLOW_INCLUSIONS,
  SCHEDULED_WORKFLOW_EXCLUSIONS,
  buildWorkflowRunsUrl,
  computeFailureStreak,
  deriveWorkflowWatchPolicy,
  evaluateWorkflow,
  mergeWorkflowRunBatches,
  parseWorkflowRunsPayload,
} from "./check-pipeline-job-health.mjs";

// Runs are most-recent-first, matching the GitHub API `workflow_runs` ordering.
const F = (id) => ({ id, conclusion: "failure", html_url: `https://gh/run/${id}`, run_started_at: `t${id}` });
const S = (id) => ({ id, conclusion: "success", html_url: `https://gh/run/${id}` });
const C = (id) => ({ id, conclusion: "cancelled", html_url: `https://gh/run/${id}` });
const SU = (id) => ({ id, conclusion: "startup_failure", html_url: `https://gh/run/${id}`, run_started_at: `t${id}` });
const T = (id) => ({ id, conclusion: "timed_out", html_url: `https://gh/run/${id}`, run_started_at: `t${id}` });
const K = (id) => ({ id, conclusion: "skipped", html_url: `https://gh/run/${id}` });
const R = (id, event, createdAt) => ({ id, event, conclusion: "success", created_at: createdAt });

function writeWorkflow(root, file, source) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, file), source);
}

// Runs from pull requests must not enter the production streak for the
// explicitly included workflow-syntax gate. The API query is branch-scoped for
// every watched workflow, with main as the conservative project default.
{
  const url = new URL(buildWorkflowRunsUrl({
    owner: "owner with space",
    repo: "repo",
    file: "odd?ref#fragment.yml",
    event: "push",
  }));
  assert.equal(url.pathname, "/repos/owner%20with%20space/repo/actions/workflows/odd%3Fref%23fragment.yml/runs");
  assert.equal(url.searchParams.get("status"), "completed");
  assert.equal(url.searchParams.get("branch"), "main");
  assert.equal(url.searchParams.get("event"), "push");
  assert.equal(url.searchParams.get("per_page"), "15");
  assert.deepEqual(parseWorkflowRunsPayload({ workflow_runs: [{ id: 1 }] }), [{ id: 1 }]);
  assert.throws(
    () => parseWorkflowRunsPayload({ message: "unexpected success payload" }),
    /missing workflow_runs\[\]/,
    "a malformed HTTP-200 response must degrade to unknown, never healthy",
  );
}

// A newly added schedule is watched by construction. Removing `schedule` from
// the same fixture is the required mutation proving that the guard actually
// discriminates rather than accepting every YAML file.
{
  const workflowsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-watch-policy-"));
  writeWorkflow(workflowsDir, "future-scheduled.yml", [
    "name: Future Scheduled Job",
    "",
    "on:",
    "    schedule:",
    "        - cron: '7 7 * * *'",
    "    workflow_dispatch:",
    "",
  ].join("\n"));
  writeWorkflow(workflowsDir, "manual.yml", "name: Manual Only\non:\n  workflow_dispatch:\n");
  writeWorkflow(workflowsDir, "critical-gate.yml", "name: Critical Gate\n'on':\n  push:\n");
  writeWorkflow(workflowsDir, "self-alarm.yaml", "name: Self Alarm\n\"on\":\n  schedule:\n    - cron: '1 * * * *'\n");
  writeWorkflow(workflowsDir, "nested-key.yml", [
    "name: Nested Schedule Key",
    "on:",
    "    workflow_call:",
    "        inputs:",
    "            schedule:",
    "                required: false",
    "",
  ].join("\n"));
  writeWorkflow(
    workflowsDir,
    "inline-flow.yml",
    "name: Inline Flow Schedule\non: {\"schedule\": [{\"cron\": \"1 * * * *\"}], \"workflow_dispatch\": {}}\n",
  );

  const policy = deriveWorkflowWatchPolicy({
    workflowsDir,
    scheduledExclusions: {
      "self-alarm.yaml": "self-monitoring would create a recursive alarm loop",
    },
    nonScheduledInclusions: {
      "critical-gate.yml": "critical push gate must page despite having no schedule",
    },
  });
  assert.deepEqual(
    policy.watched.map((row) => row.file),
    ["critical-gate.yml", "future-scheduled.yml", "inline-flow.yml"],
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "future-scheduled.yml")?.events,
    ["schedule"],
    "manual dispatch must never enter the counted event set",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "inline-flow.yml")?.events,
    ["schedule"],
    "inline workflow_dispatch must also be excluded from the counted event set",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "critical-gate.yml")?.events,
    ["push"],
    "the explicit non-scheduled gate keeps its declared automatic event",
  );
  assert.deepEqual(policy.excluded, [{
    file: "self-alarm.yaml",
    label: "Self Alarm",
    reason: "self-monitoring would create a recursive alarm loop",
  }]);
  assert.equal(policy.scheduled_count, 3);

  const scheduledSource = fs.readFileSync(path.join(workflowsDir, "future-scheduled.yml"), "utf8");
  const scheduleRemoved = scheduledSource.replace("    schedule:", "    workflow_dispatch:");
  assert.notEqual(scheduleRemoved, scheduledSource, "schedule-removal mutation anchor must exist");
  fs.writeFileSync(path.join(workflowsDir, "future-scheduled.yml"), scheduleRemoved);
  const mutated = deriveWorkflowWatchPolicy({
    workflowsDir,
    scheduledExclusions: { "self-alarm.yaml": "self-monitoring would create a recursive alarm loop" },
    nonScheduledInclusions: { "critical-gate.yml": "critical push gate must page despite having no schedule" },
  });
  assert.equal(mutated.watched.some((row) => row.file === "future-scheduled.yml"), false,
    "removing the schedule trigger must remove the automatic watch classification");
  assert.equal(mutated.watched.some((row) => row.file === "nested-key.yml"), false,
    "a nested key named schedule must not be mistaken for an on.schedule trigger");

  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "manual.yml": "stale exclusion" },
      nonScheduledInclusions: {},
    }),
    /exclusion must reference a scheduled workflow/,
  );
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "" },
      nonScheduledInclusions: {},
    }),
    /reason must be a non-empty string/,
  );
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: {},
      nonScheduledInclusions: { "self-alarm.yaml": "stale inclusion" },
    }),
    /inclusion must reference a non-scheduled workflow/,
  );
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "self-monitoring loop" },
      nonScheduledInclusions: { "missing.yml": "missing gate" },
    }),
    /inclusion must reference an existing workflow/,
  );

  writeWorkflow(workflowsDir, "aliased-on.yml", "name: Aliased On\non: *shared_triggers\n");
  assert.throws(
    () => deriveWorkflowWatchPolicy({
      workflowsDir,
      scheduledExclusions: { "self-alarm.yaml": "self-monitoring loop" },
      nonScheduledInclusions: {},
    }),
    /aliased top-level on trigger is unsupported/,
    "an uninspectable trigger alias must fail closed instead of silently missing a schedule",
  );
}

// Real-repository contract: at least 31 scheduled workflows are discovered. The
// alarm itself is the sole declared exclusion, while the non-scheduled workflow
// syntax gate is an explicit inclusion. Operational observer/alarm workflows
// remain watched: their own repeated failure is also an outage worth paging.
// The floor catches accidental parser shrinkage without making future scheduled
// workflows wait for a hand-edited exact count.
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const policy = deriveWorkflowWatchPolicy({
    workflowsDir: path.join(repoRoot, ".github", "workflows"),
  });
  assert.ok(policy.scheduled_count >= 31, "the scheduled-workflow inventory must not shrink silently");
  assert.equal(
    policy.watched.length,
    policy.scheduled_count - Object.keys(SCHEDULED_WORKFLOW_EXCLUSIONS).length
      + Object.keys(NON_SCHEDULED_WORKFLOW_INCLUSIONS).length,
    "every scheduled workflow must be watched or explicitly excluded",
  );
  assert.deepEqual(policy.excluded, [{
    file: "pipeline-failure-alarm.yml",
    label: "Pipeline Failure Alarm",
    reason: SCHEDULED_WORKFLOW_EXCLUSIONS["pipeline-failure-alarm.yml"],
  }]);
  assert.equal(
    NON_SCHEDULED_WORKFLOW_INCLUSIONS["validate-workflows.yml"].reason,
    "critical workflow syntax gate must page despite having no schedule",
  );
  assert.deepEqual(
    NON_SCHEDULED_WORKFLOW_INCLUSIONS["validate-workflows.yml"].events,
    ["push"],
    "the non-scheduled gate must count main push runs only",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "validate-workflows.yml")?.events,
    ["push"],
    "the derived policy must carry the push-event filter to the API query",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "deploy-worker.yml")?.events,
    ["push", "schedule"],
    "every declared automatic trigger must count while manual dispatch stays excluded",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "slickcharts-history.yml")?.events,
    ["schedule"],
    "manual remediation runs must never contribute to the alarm streak",
  );
  for (const file of [
    "build-stocks-analyzer.yml",
    "fetch-us-indices-daily.yml",
    "global-writer-queue-observer.yml",
    "update-manifest.yml",
    "validate-workflows.yml",
    "worker-request-budget-alarm.yml",
  ]) {
    assert.ok(policy.watched.some((row) => row.file === file), `${file} must be watched`);
  }
}

// GitHub accepts one event filter per workflow-runs request. Event-scoped
// batches are merged newest-first and deduplicated before streak evaluation, so
// manual runs cannot crowd counted automatic runs out of the API page.
{
  const merged = mergeWorkflowRunBatches([
    [R(4, "push", "2026-07-22T04:00:00Z"), R(2, "push", "2026-07-22T02:00:00Z")],
    [R(3, "schedule", "2026-07-22T03:00:00Z"), R(2, "schedule", "2026-07-22T02:00:00Z")],
  ]);
  assert.deepEqual(merged.map((run) => run.id), [4, 3, 2]);
  assert.equal(merged.some((run) => run.event === "workflow_dispatch"), false);
}

// Required production regression: manual remediation failures do not page the
// monthly history workflow, while two real scheduled analyzer failures still do.
{
  const slickchartsRuns = mergeWorkflowRunBatches([[
    { ...F(303), event: "workflow_dispatch" },
    { ...F(302), event: "workflow_dispatch" },
    { ...S(301), event: "schedule" },
  ]]);
  const slickcharts = evaluateWorkflow(
    { file: "slickcharts-history.yml", label: "SlickCharts Historical Membership", events: ["schedule"] },
    slickchartsRuns,
  );
  assert.equal(slickcharts.status, "ok");
  assert.equal(slickcharts.streak, 0);
  assert.equal(slickcharts.latestRunUrl, "https://gh/run/301");

  const analyzerRuns = mergeWorkflowRunBatches([[F(203), F(202), S(201)]]);
  const analyzer = evaluateWorkflow(
    { file: "build-stocks-analyzer.yml", label: "Build Stocks Analyzer", events: ["schedule"] },
    analyzerRuns,
  );
  assert.equal(analyzer.status, "alarm");
  assert.equal(analyzer.streak, 2);
  assert.equal(analyzer.firstFailingRunId, 202);
}

// Multi-event workflow runs must be evaluated by chronology, not by batch order.
{
  const runs = mergeWorkflowRunBatches([
    [{ ...F(402), event: "push", run_started_at: "2026-07-22T04:02:00Z" }],
    [
      { ...F(403), event: "schedule", run_started_at: "2026-07-22T04:03:00Z" },
      { ...C(401), event: "schedule", run_started_at: "2026-07-22T04:01:00Z" },
      { ...S(400), event: "schedule", run_started_at: "2026-07-22T04:00:00Z" },
    ],
  ]);
  const result = evaluateWorkflow(
    { file: "multi.yml", label: "Multi Event", events: ["push", "schedule"] },
    runs,
  );
  assert.deepEqual(runs.map((run) => run.id), [403, 402, 401, 400]);
  assert.equal(result.status, "alarm");
  assert.equal(result.firstFailingRunId, 402);
}

// 2 consecutive failures -> alarm
{
  const { streak } = computeFailureStreak([F(2), F(1), S(0)]);
  assert.equal(streak, 2, "two consecutive failures = streak 2");
}

// failure, success, failure -> no alarm (streak 1)
{
  const { streak } = computeFailureStreak([F(3), S(2), F(1)]);
  assert.equal(streak, 1, "failure-success-failure = streak 1");
}

// cancelled runs are skipped: failure, cancelled, failure -> streak 2 -> alarm
{
  const { streak, firstFailingIndex } = computeFailureStreak([F(3), C(2), F(1)]);
  assert.equal(streak, 2, "cancelled between failures is transparent = streak 2");
  assert.equal(firstFailingIndex, 2, "first failing run is the oldest, past the cancelled one");
}

// leading cancelled runs are skipped before counting: cancelled, failure, failure -> streak 2
{
  const { streak } = computeFailureStreak([C(3), F(2), F(1)]);
  assert.equal(streak, 2, "leading cancelled runs do not break the streak");
}

// failure-class: failure followed by startup_failure (the #357 config-refusal class) -> streak 2 -> alarm
{
  const { streak } = computeFailureStreak([F(2), SU(1), S(0)]);
  assert.equal(streak, 2, "failure + startup_failure are both failure-class = streak 2");
}

// failure-class: two timed_out (hung jobs) -> streak 2 -> alarm
{
  const { streak } = computeFailureStreak([T(2), T(1), S(0)]);
  assert.equal(streak, 2, "consecutive timed_out = streak 2");
}

// skipped is transparent like cancelled: failure, skipped, failure -> streak 2
{
  const { streak, firstFailingIndex } = computeFailureStreak([F(3), K(2), F(1)]);
  assert.equal(streak, 2, "skipped between failures is transparent = streak 2");
  assert.equal(firstFailingIndex, 2, "first failing run is past the skipped one");
}

// single failure -> no alarm
{
  const { streak } = computeFailureStreak([F(1), S(0)]);
  assert.equal(streak, 1, "single failure = streak 1");
}

// No completed run has ever been observed: not an alarm, but never healthy.
{
  const workflow = { file: "brand-new-lane.yml", label: "Brand New Lane" };
  const result = evaluateWorkflow(workflow, []);
  const { streak, firstFailingIndex } = computeFailureStreak([]);
  assert.equal(streak, 0, "empty run list = streak 0");
  assert.equal(firstFailingIndex, null, "empty run list has no failing run");
  assert.equal(result.status, "unknown", "no observed completed run must not be reported healthy");
  assert.equal(result.alarming, false, "never-observed is unknown, not an alarm");
  assert.match(result.message, /no completed run observed/i);
}

// evaluateWorkflow: alarm shape carries first-failing metadata + latest url
{
  const wf = { file: "update-manifest.yml", label: "Update Manifest" };
  const result = evaluateWorkflow(wf, [F(9), C(8), F(7), S(6)]);
  assert.equal(result.status, "alarm");
  assert.equal(result.streak, 2);
  assert.equal(result.alarming, true);
  assert.equal(result.firstFailingRunId, 7, "reports the oldest run in the streak");
  assert.equal(result.firstFailingRunUrl, "https://gh/run/7");
  assert.equal(result.firstFailingStartedAt, "t7");
  assert.equal(result.latestRunUrl, "https://gh/run/9", "latest run is the most recent, even if cancelled/failed");
}

// evaluateWorkflow: healthy shape is ok, no first-failing fields
{
  const wf = { file: "deploy-worker.yml", label: "Deploy Worker" };
  const result = evaluateWorkflow(wf, [S(2), F(1)]);
  assert.equal(result.status, "ok");
  assert.equal(result.alarming, false);
  assert.equal(result.firstFailingRunId, undefined);
}

// Graceful-degradation path at the script level: a config/API failure must
// exit 0 with `unknown` status, never alarm. Exercised offline by running the
// script with GITHUB_REPOSITORY unset (deterministic, no network).
{
  const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "check-pipeline-job-health.mjs");
  const resultPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-health-")), "result.json");
  const run = spawnSync(process.execPath, [scriptPath], {
    env: { ...process.env, GITHUB_REPOSITORY: "", PIPELINE_JOB_HEALTH_RESULT: resultPath },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, "missing GITHUB_REPOSITORY must exit 0, not alarm");
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(result.status, "unknown", "missing repository reports unknown status");
  assert.ok(!("issueBody" in result), "unknown status must not produce an alarm issue body");
}

// Workflow YAML sanity: mirror the budget-alarm shape and honor #357 (no runner
// context in job-level env).
{
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const workflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "pipeline-failure-alarm.yml"),
    "utf8",
  );
  const updateManifestWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "update-manifest.yml"),
    "utf8",
  );
  const deployWorkerWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "deploy-worker.yml"),
    "utf8",
  );
  const edgeDailyWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "fenok-edge-daily.yml"),
    "utf8",
  );
  assert.match(workflow, /cron: '23 \* \* \* \*'/, "hourly schedule at minute 23");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(
    workflow,
    /workflow_run:\s*\n\s+workflows:\s*\['Update Manifest', 'Deploy Worker \(Cloudflare\)', 'Fenok Edge Daily Data'\]\s*\n\s+types:\s*\[completed\]/,
    "completed runs from the three fast-path publisher workflows trigger the alarm immediately",
  );
  assert.match(updateManifestWorkflow, /^name: Update Manifest$/m, "workflow_run display name stays exact");
  assert.match(deployWorkerWorkflow, /^name: Deploy Worker \(Cloudflare\)$/m, "workflow_run display name stays exact");
  assert.match(edgeDailyWorkflow, /^name: Fenok Edge Daily Data$/m, "workflow_run display name stays exact");
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /group: pipeline-failure-alarm/, "alarm runs share one serialized concurrency group");
  assert.match(workflow, /cancel-in-progress: false/, "concurrency must not cancel in progress");
  assert.match(workflow, /node scripts\/ops\/check-pipeline-job-health\.mjs/);
  assert.doesNotMatch(
    workflow,
    /run: npm --prefix 100xfenok-next run qa:pipeline-job-health/,
    "a contract-test failure must not block the production health scan",
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "100xfenok-next", "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["qa:pipeline-job-health"],
    "node ../scripts/ops/test-check-pipeline-job-health.mjs",
    "the watch-policy contract must have a stable package entrypoint",
  );
  assert.match(
    packageJson.scripts["qa:alarm-state"],
    /^npm run qa:pipeline-job-health && /,
    "the aggregate alarm QA must include the watch-policy contract",
  );
  const validateWorkflow = fs.readFileSync(
    path.join(repoRoot, ".github", "workflows", "validate-workflows.yml"),
    "utf8",
  );
  assert.match(
    validateWorkflow,
    /- name: Validate alarm workflow contracts\s+run: npm --prefix 100xfenok-next run qa:alarm-state/,
    "workflow changes must execute the aggregate alarm contract in CI",
  );
  for (const guardedPath of [
    "scripts/ops/check-pipeline-job-health.mjs",
    "scripts/ops/emit-alarm-state.mjs",
    "scripts/ops/test-check-pipeline-job-health.mjs",
    "scripts/ops/test-emit-alarm-state.mjs",
    "scripts/test-pipeline-failure-alarm-manifest.mjs",
  ]) {
    assert.equal(
      (validateWorkflow.match(new RegExp(guardedPath.replaceAll(".", "\\."), "g")) || []).length,
      2,
      `${guardedPath} must trigger both push and pull_request validation`,
    );
  }
  assert.match(workflow, /continue-on-error: true/);
  assert.match(workflow, /steps\.pipeline\.outcome == 'failure'/);
  assert.equal(
    (workflow.match(/if: steps\.pipeline\.outcome == 'failure'/g) || []).length,
    3,
    "healthy workflow_run completions remain quiet: issue preparation, mutation, and final failure are alarm-only",
  );
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\./, "must not reference the runner context in expressions (#357)");
}

console.log("check-pipeline-job-health tests passed");
