import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NON_SCHEDULED_WORKFLOW_INCLUSIONS,
  SCHEDULED_WORKFLOW_EXCLUSIONS,
  buildIssueBody,
  buildWorkflowRunsUrl,
  computeFailureStreak,
  deriveFailureStreakThreshold,
  deriveWorkflowWatchPolicy,
  QUEUE_EVICTION_INSPECTION_LIMIT,
  annotateQueueEvictions,
  classifyKpiGenerationStoppage,
  evaluateWorkflow,
  fetchKpiGenerationSnapshots,
  isQueueEvictedRun,
  mergeWorkflowRunBatches,
  needsMissedWindowReverification,
  parseWorkflowRunsPayload,
  runtimeSlotKey,
} from "./check-pipeline-job-health.mjs";

// The alarm's data-stoppage input is two committed KPI generations. A single
// stopped generation is not yet a K3 incident; unreadable history is unknown,
// never a healthy result that can clear an open issue.
{
  const generation = (generated_at, rows) => ({
    generated_at,
    sets: Object.entries(rows).map(([set, status]) => ({ set, status })),
  });
  const current = generation("2026-09-28T11:34:19.757Z", {
    fred_macro: "fresh",
    stockanalysis_etf_detail: "stopped",
    sentiment: "stopped",
  });
  const previous = generation("2026-09-28T10:21:42.000Z", {
    fred_macro: "fresh",
    stockanalysis_etf_detail: "stopped",
    sentiment: "delayed",
  });
  assert.deepEqual(classifyKpiGenerationStoppage([current, previous]), {
    status: "alarm",
    stopped_sets: ["stockanalysis_etf_detail"],
    latest_generated_at: current.generated_at,
    previous_generated_at: previous.generated_at,
  });
  assert.equal(
    classifyKpiGenerationStoppage([
      generation("2026-09-28T11:34:19Z", { stockanalysis_etf_detail: "stopped" }),
      generation("2026-09-28T10:21:42Z", { stockanalysis_etf_detail: "fresh" }),
    ]).status,
    "ok",
    "the set pages only when it is stopped in both latest generations",
  );
  const oneStopped = classifyKpiGenerationStoppage([
    generation("2026-09-28T11:34:19Z", { stockanalysis_etf_detail: "stopped" }),
    generation("2026-09-28T10:21:42Z", { stockanalysis_etf_detail: "delayed" }),
  ]);
  assert.equal(oneStopped.status, "ok", "one stopped generation does not page");
  assert.deepEqual(oneStopped.stopped_sets, []);
  assert.equal(classifyKpiGenerationStoppage([current]).status, "unknown", "one snapshot cannot clear or page");
  assert.equal(classifyKpiGenerationStoppage([previous, current]).status, "unknown", "out-of-order generations stay unknown");
  assert.equal(classifyKpiGenerationStoppage([
    generation("2026-09-28T11:34:19Z", { stockanalysis_etf_detail: "stopped" }),
    generation("2026-09-28T10:21:42Z", {}),
  ]).status, "unknown", "malformed generations stay unknown");

  const kpiBody = buildIssueBody([{
    label: "Data stopped advancing",
    kpi_stopped_sets: ["stockanalysis_etf_detail"],
    latest_generated_at: current.generated_at,
    previous_generated_at: previous.generated_at,
  }]);
  assert.match(kpiBody, /stockanalysis_etf_detail/);
  assert.match(kpiBody, /two committed health KPI generations/);
  assert.match(kpiBody, /2026-09-28T11:34:19\.757Z/);

  const requested = [];
  const snapshots = await fetchKpiGenerationSnapshots({
    token: "test-token",
    owner: "owner",
    repo: "repo",
    branch: "main",
    fetchFn: async (url, options) => {
      requested.push({ url: String(url), options });
      if (requested.length === 1) {
        return new Response(JSON.stringify([{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(requested.length === 2 ? current : previous), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.deepEqual(snapshots, [current, previous], "the API snapshots remain newest-first");
  assert.match(requested[0].url, /commits\?.*path=data%2Fadmin%2Ffenok-data-health-kpi\.json.*per_page=2/);
  assert.match(requested[0].url, /sha=main/);
  assert.equal(requested[0].options.headers.Authorization, "Bearer test-token");
  assert.match(requested[1].url, /contents\/data\/admin\/fenok-data-health-kpi\.json\?ref=/);
  assert.equal(requested[1].options.headers.Accept, "application/vnd.github.raw+json");
}

assert.equal(runtimeSlotKey("update-manifest.yml", "30 2 * * *", null), null);
assert.equal(runtimeSlotKey("update-manifest.yml", "30 2 * * *", ""), null);

assert.equal(deriveFailureStreakThreshold([{ cron: "0 7 * * 0" }]), 1,
  "a weekly workflow pages on its first completed failure");
assert.equal(deriveFailureStreakThreshold([{ cron: "0 6 * * *" }]), 2,
  "a faster-than-weekly workflow keeps the two-failure guard");
assert.equal(deriveFailureStreakThreshold([
  { cron: "0 7 * * 0" },
  { cron: "0 6 * * *" },
]), 2, "a workflow with both weekly and daily schedules uses its faster cadence");

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
// syntax gate is an explicit inclusion. The serving probe is watched, not
// excluded: its own run turns red only on machinery failure (issue/API), so a
// genuine probe failure is an outage worth paging, and a stale exclusion would
// hide it. The floor catches accidental parser shrinkage without making future
// scheduled workflows wait for a hand-edited exact count.
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
    ["push", "schedule", "workflow_run"],
    "every declared automatic trigger must count while manual dispatch stays excluded",
  );
  assert.deepEqual(
    policy.watched.find((row) => row.file === "slickcharts-history.yml")?.events,
    ["schedule"],
    "manual remediation runs must never contribute to the alarm streak",
  );
  for (const file of [
    "build-stocks-analyzer.yml",
    "data-plane-serving-probe.yml",
    "fetch-us-indices-daily.yml",
    "global-writer-queue-observer.yml",
    "update-manifest.yml",
    "validate-workflows.yml",
    "worker-request-budget-alarm.yml",
  ]) {
    assert.ok(policy.watched.some((row) => row.file === file), `${file} must be watched`);
  }
  assert.deepEqual(
    policy.watched.find((row) => row.file === "data-plane-serving-probe.yml")?.events,
    ["schedule"],
    "the probe contributes its scheduled cadence only; manual dispatch stays excluded",
  );
  assert.equal(
    policy.watched.find((row) => row.file === "slickcharts-weekly.yml")?.failure_streak_threshold,
    1,
    "the weekly workflow must retain its run-history paging threshold",
  );
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

// --- Queue eviction is its own state, not a producer failure ----------------
// A scheduled run cancelled before any job exists is a lost natural slot. It
// must page without inflating the producer failure streak. Manual cancellations
// remain outside the counted automatic event set.
const jobsOf = (...jobs) => ({ jobs });
const evictedJobs = jobsOf({ name: "fetch", conclusion: "cancelled", steps: [] });
const ranJobs = jobsOf({ name: "fetch", conclusion: "failure", steps: [{ name: "Run", conclusion: "failure" }] });

{
  assert.equal(isQueueEvictedRun(evictedJobs.jobs), true, "cancelled job with zero steps never executed");
  assert.equal(isQueueEvictedRun(ranJobs.jobs), false, "a job that ran steps is a real failure");
  // The discriminator is ZERO STEPS, not the cancelled conclusion. Update
  // Manifest runs 30151994315 and 30157494401 were both cancelled mid-flight
  // with 26 steps each: real work, superseded. Reading those as evictions
  // would launder genuine interruptions into "nothing happened".
  assert.equal(
    isQueueEvictedRun([{ conclusion: "cancelled", steps: new Array(26).fill({ name: "step" }) }]),
    false,
    "a cancelled job that entered steps ran; it was not evicted",
  );
  assert.equal(
    isQueueEvictedRun([{ conclusion: "cancelled", steps: [{ name: "Set up job" }] }]),
    false,
    "even one entered step disproves eviction",
  );
  assert.equal(isQueueEvictedRun([]), false, "no job data proves nothing");
  assert.equal(isQueueEvictedRun(null), false, "missing job data proves nothing");
  assert.equal(
    isQueueEvictedRun([{ conclusion: "cancelled", steps: [] }, { conclusion: "failure", steps: [{ name: "Run" }] }]),
    false,
    "one executed job means the run was not evicted",
  );
}

{
  // An evicted run must not inflate the streak: it says nothing about the producer.
  const evicted = { ...F(2), queue_evicted: true };
  const { streak, evictedRunUrls } = computeFailureStreak([evicted, F(1), S(0)]);
  assert.equal(streak, 1, "an evicted run is not a producer failure");
  assert.deepEqual(evictedRunUrls, ["https://gh/run/2"], "but it must be named, never silently dropped");
}

{
  // Nor may it break a genuine streak the way a success does.
  const { streak } = computeFailureStreak([F(3), { ...F(2), queue_evicted: true }, F(1)]);
  assert.equal(streak, 2, "an evicted run between failures is transparent to the streak");
}

{
  // The healthy path must not sprout eviction vocabulary.
  const { evictedRunUrls } = computeFailureStreak([S(2), S(1)]);
  assert.deepEqual(evictedRunUrls, []);
}

{
  // evaluateWorkflow must carry the eviction out to the caller, not absorb it.
  const result = evaluateWorkflow(
    { file: "fetch-fenok-news-tone.yml", label: "News Tone", events: ["schedule"] },
    [
      { ...F(2), event: "schedule", queue_evicted: true },
      { ...S(1), event: "schedule" },
    ],
  );
  assert.equal(result.streak, 0, "eviction is not a producer failure");
  assert.equal(result.status, "alarm", "a lost scheduled slot must page");
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
  assert.deepEqual(result.queue_evicted_run_urls, ["https://gh/run/2"]);
}

{
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(30694384064), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.streak, 0);
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.deepEqual(result.lost_schedule_slot_run_urls, ["https://gh/run/30694384064"]);
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
}

{
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(10), event: "workflow_dispatch", jobs_empty: true },
      { ...S(9), event: "schedule" },
    ],
  );
  assert.equal(result.status, "ok", "normal manual cancellation must not become a lost scheduled slot");
  assert.equal(result.lost_schedule_slot_count, 0);
  assert.deepEqual(result.alarm_reasons, []);
}

{
  // A lost scheduled slot is RESOLVED by any strictly newer successful run,
  // including workflow_dispatch. The 2026-08-01 eviction storm left monthly
  // lanes (OECD, slickcharts-monthly) paging hourly toward their NEXT natural
  // slot on September 1 even after repeated dispatch successes refreshed the
  // same data — recovery evidence the alarm never fetched.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "ok", "a newer successful run resolves the lost slot");
  assert.equal(result.lost_schedule_slot_count, 0);
  assert.equal(result.resolved_lost_schedule_slot_count, 1);
  assert.deepEqual(result.lost_schedule_slot_run_urls, []);
  assert.deepEqual(result.alarm_reasons, []);
}

{
  // A newer dispatch FAILURE is not recovery evidence; the slot still pages.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...F(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.equal(result.resolved_lost_schedule_slot_count, 0);
  assert.deepEqual(result.alarm_reasons, ["lost_schedule_slot"]);
}

{
  // A jobs_empty run executed nothing, exactly like a queue eviction — it is
  // contention evidence, not producer evidence, so it neither inflates nor
  // breaks a streak (it still pages separately as a lost scheduled slot).
  const { streak } = computeFailureStreak([F(3), { ...C(2), jobs_empty: true }, F(1)]);
  assert.equal(streak, 2, "a never-executed run is transparent to the streak");
}

{
  // A failure streak is recovered by a strictly newer successful run of any
  // event. slickcharts-monthly live case: schedule failed 07-01, its 08-01
  // slot was evicted, three dispatch successes then proved the producer end
  // to end — yet the streak could only break on the NEXT monthly slot.
  const result = evaluateWorkflow(
    { file: "slickcharts-monthly.yml", label: "Monthly", events: ["schedule"] },
    [
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...F(30700000001), event: "schedule" },
      { ...S(30690000000), event: "schedule" },
    ],
  );
  assert.equal(result.status, "ok", "a newer success of any event recovers the streak");
  assert.equal(result.failure_streak_recovered, true);
  assert.deepEqual(result.alarm_reasons, []);
}

{
  // A dispatch success OLDER than the newest failure recovers nothing.
  const result = evaluateWorkflow(
    { file: "slickcharts-monthly.yml", label: "Monthly", events: ["schedule"] },
    [
      { ...F(30700000020), event: "schedule" },
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...F(30700000001), event: "schedule" },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.ok(result.alarm_reasons.includes("failure_streak"));
  assert.equal(result.failure_streak_recovered, false);
}

{
  // Mixed ages: only slots older than the newest success resolve; a slot
  // newer than every success keeps paging.
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    [
      { ...C(30700000020), event: "schedule", jobs_empty: true },
      { ...S(30700000010), event: "workflow_dispatch" },
      { ...C(30700000001), event: "schedule", jobs_empty: true },
    ],
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
  assert.equal(result.resolved_lost_schedule_slot_count, 1);
  assert.deepEqual(result.lost_schedule_slot_run_urls, ["https://gh/run/30700000020"]);
}

// --- The classifier must actually be wired to run data ----------------------
{
  const asked = [];
  const runs = await annotateQueueEvictions({
    runs: [F(3), F(2), S(1)],
    fetchJobsFn: async (id) => {
      asked.push(id);
      return id === 3 ? evictedJobs.jobs : ranJobs.jobs;
    },
  });
  assert.deepEqual(asked, [3, 2], "only the leading failure-class prefix is inspected");
  assert.equal(runs[0].queue_evicted, true);
  assert.equal(runs[1].queue_evicted, undefined, "a run that executed steps is left alone");
  assert.equal(runs[2].queue_evicted, undefined, "the success past the prefix is never fetched");
}

{
  const asked = [];
  await annotateQueueEvictions({
    runs: [S(9), F(8)],
    fetchJobsFn: async (id) => { asked.push(id); return []; },
  });
  assert.deepEqual(asked, [], "a healthy latest run spends no API calls at all");
}

{
  const asked = [];
  const runs = await annotateQueueEvictions({
    runs: [{ ...C(30694384064), event: "schedule" }, { ...S(1), event: "schedule" }],
    fetchJobsFn: async (id) => { asked.push(id); return []; },
  });
  assert.deepEqual(asked, [30694384064], "a leading cancelled schedule must inspect job execution evidence");
  assert.equal(runs[0].jobs_empty, true);
  const result = evaluateWorkflow(
    { file: "fetch-oecd-cli.yml", label: "OECD", events: ["schedule"] },
    runs,
  );
  assert.equal(result.status, "alarm");
  assert.equal(result.lost_schedule_slot_count, 1);
}

{
  const asked = [];
  await annotateQueueEvictions({
    runs: [F(9), F(8), F(7), F(6), F(5), F(4), F(3)],
    fetchJobsFn: async (id) => { asked.push(id); return []; },
    limit: QUEUE_EVICTION_INSPECTION_LIMIT,
  });
  assert.equal(asked.length, QUEUE_EVICTION_INSPECTION_LIMIT,
    "a long red history must not turn one health check into a rate-limit incident");
}

{
  // Fail-open: a job lookup that throws leaves the run-list verdict untouched.
  const runs = await annotateQueueEvictions({
    runs: [F(4)],
    fetchJobsFn: async () => { throw new Error("HTTP 502"); },
  });
  assert.equal(runs[0].queue_evicted, undefined);
  assert.equal(computeFailureStreak(runs).streak, 1, "an unreadable run stays a failure");
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
  assert.equal(
    result.watched.length,
    deriveWorkflowWatchPolicy().watched.length,
    "the offline result covers every current watched workflow",
  );
  assert.equal(result.workflows.length, result.watched.length, "the offline result emits one row per watched workflow");
  assert.equal(result.data_health_kpi.status, "unknown", "missing repository cannot make KPI history look healthy");
  assert.ok(result.workflows.every((workflow) => workflow.status === "unknown"));
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
    2,
    "healthy workflow_run completions remain quiet: issue preparation and issue update are alarm-only, and the run concludes green when reporting succeeded",
  );
  assert.doesNotMatch(workflow, /\$\{\{\s*runner\./, "must not reference the runner context in expressions (#357)");
}

// fh-258 adjudication boundary: only a row that actually carries a
// missed-window verdict triggers the widened re-read, and the runs URL keeps
// its default page size while exposing the override the re-read uses.
assert.equal(needsMissedWindowReverification({ missed_schedule_window_hours: 624.78 }), true);
assert.equal(needsMissedWindowReverification({ missed_schedule_window_hours: null }), false);
assert.equal(
  needsMissedWindowReverification({
    alarming: true,
    alarm_reasons: ["failure_streak"],
    missed_schedule_window_hours: null,
  }),
  false,
  "failure-streak rows must not trigger the re-read",
);
assert.equal(needsMissedWindowReverification({}), false);
assert.equal(needsMissedWindowReverification(null), false);
assert.match(buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml" }), /per_page=15/);
assert.match(
  buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml" }),
  /status=completed/,
  "the completed-run query remains the default",
);
assert.match(
  buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml", event: "schedule", perPage: 100 }),
  /per_page=100/,
);
assert.match(
  buildWorkflowRunsUrl({ owner: "o", repo: "r", file: "x.yml", event: "schedule", status: "in_progress" }),
  /status=in_progress.*event=schedule/,
  "the restore liveness query can inspect active scheduled runs",
);

console.log("check-pipeline-job-health tests passed");
