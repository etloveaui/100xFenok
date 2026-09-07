import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateQueue,
  loadPolicy,
  buildApiUrl,
  buildJobsApiUrl,
  fetchWorkflowRuns,
  main,
  deriveWriterJobTargets,
} from "./check-global-writer-queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (name) => path.join(HERE, "fixtures", "global-writer-queue", `${name}.json`);
const readFixture = (name) => JSON.parse(fs.readFileSync(fixturePath(name), "utf8"));
const splitTargets = deriveWriterJobTargets([
  { workflow: ".github/workflows/split.yml", groupScope: "job", job: "save-source", needs: ["acquire"] },
  { workflow: ".github/workflows/split.yml", groupScope: "job", job: "save-outcome", needs: ["save-source", "upload"] },
  { workflow: ".github/workflows/root.yml", groupScope: "job", job: "source", needs: [] },
]);
assert.deepEqual(splitTargets["split.yml"].map((target) => target.job_name), ["save-source", "save-outcome"],
  "one workflow may release the writer lock during cloud I/O and reacquire it for evidence");
assert.deepEqual(splitTargets["split.yml"][1].eligibility_predecessors, ["save-source", "upload"],
  "outcome queue eligibility waits for every dependency, including the cloud upload");
assert.equal(splitTargets["root.yml"][0].job_name, "source", "root writer jobs remain observable");
const policy = loadPolicy();
const NOW = "2026-07-21T03:00:00Z";

assert.equal(policy.version, 1, "queue policy is explicitly versioned");
assert.equal(policy.metric, "global-writer candidate queued runs");
assert.equal(policy.concurrency_group, "fenok-data-writer-refs/heads/main");
assert.equal(policy.queue_mode, "max", "loss-intolerant writers use GitHub's deep pending queue");
assert.equal(policy.canonical_branch, "main", "writer workflows are observed only on main");
assert.equal(policy.default_observation_mode, "workflow_run", "other writers retain workflow-level observation");
assert.ok(Array.isArray(policy.workflows) && policy.workflows.length > 10, "writer workflow set is derived");
assert.equal(new Set(policy.workflows).size, policy.workflows.length, "writer workflow list has no duplicates");
assert.equal(policy.api.runs_per_page, 100, "API page size stays within the REST limit");
assert.ok(policy.api.max_pages >= 1, "API query depth is bounded");
assert.ok(policy.thresholds.max_depth >= 0, "queue-depth threshold is configurable");
assert.ok(policy.thresholds.max_age_minutes >= 0, "queue-age threshold is configurable");
assert.equal(policy.alert.output, "workflow-failure-and-json", "alert output is machine-readable and non-mutating");
assert.equal(policy.alert.unknown_exit_code, 3, "unknown observation has a distinct nonzero exit");
assert.deepEqual(policy.job_level_targets["fetch-stockanalysis.yml"][0], {
  job_name: "publish-stockanalysis",
  eligibility_predecessors: ["acquire-stockanalysis"],
  parent_run_statuses: ["queued", "requested", "waiting", "pending", "in_progress"],
  candidate_statuses: ["queued", "waiting", "pending"],
}, "StockAnalysis observes only its writer-owning publish job");
assert.deepEqual(policy.job_level_targets["pipeline-failure-alarm.yml"][0], {
  job_name: "persist-alarm-state",
  eligibility_predecessors: ["check"],
  parent_run_statuses: ["queued", "requested", "waiting", "pending", "in_progress"],
  candidate_statuses: ["queued", "waiting", "pending"],
}, "the alarm observes only its dependent global-writer persistence job");

const runs = readFixture("mixed");
const evaluated = evaluateQueue(runs, { now: NOW, maxDepth: 2, maxAgeMinutes: 30 });
assert.equal(evaluated.metric, "global-writer candidate queued runs");
assert.equal(evaluated.candidateDepth, 2, "queued candidates count only queued state");
assert.equal(evaluated.oldestCandidateAgeMinutes, 45, "oldest queued candidate age is measured from created_at");
assert.equal(evaluated.status, "alarm", "depth or age threshold breach alarms");
assert.equal(evaluated.attribution, "[not verified]", "REST results do not prove concurrency-group attribution");
assert.equal(evaluated.runs.cancelled, 1, "cancelled runs are reported separately");
assert.equal(evaluated.runs.running, 1, "running runs are reported separately");

const below = evaluateQueue(readFixture("queued"), { now: NOW, maxDepth: 3, maxAgeMinutes: 60 });
assert.equal(below.candidateDepth, 2);
assert.equal(below.status, "ok", "queue below both configured thresholds is healthy");

const cancelled = evaluateQueue(readFixture("cancelled"), { now: NOW, maxDepth: 0, maxAgeMinutes: 0 });
assert.equal(cancelled.candidateDepth, 0, "cancelled fixture contributes no queue candidates");
assert.equal(cancelled.status, "ok", "cancelled runs do not alarm");

const running = evaluateQueue(readFixture("running"), { now: NOW, maxDepth: 0, maxAgeMinutes: 0 });
assert.equal(running.candidateDepth, 0, "running fixture contributes no queue candidates");
assert.equal(running.status, "ok", "running runs do not alarm");

const url = buildApiUrl({
  baseUrl: "https://api.github.com",
  owner: "octo",
  repo: "repo",
  workflow: "fetch-stockanalysis.yml",
  page: 2,
  perPage: 100,
});
assert.equal(
  url,
  "https://api.github.com/repos/octo/repo/actions/workflows/fetch-stockanalysis.yml/runs?branch=main&per_page=100&page=2",
  "REST query is bounded to main and omits status so cancelled/running fixtures stay distinct",
);

const jobsUrl = buildJobsApiUrl({
  baseUrl: "https://api.github.com",
  owner: "octo",
  repo: "repo",
  runId: 7001,
  page: 1,
  perPage: 100,
});
assert.equal(
  jobsUrl,
  "https://api.github.com/repos/octo/repo/actions/runs/7001/jobs?filter=latest&per_page=100&page=1",
  "job-level writer observation uses the bounded Actions jobs API",
);

function fixtureFetch(fixture) {
  return async (requestUrl) => {
    const url = new URL(requestUrl);
    if (url.pathname.includes("/actions/workflows/")) {
      return { ok: true, async json() { return { workflow_runs: fixture.workflow_runs }; } };
    }
    const runId = url.pathname.match(/\/actions\/runs\/(\d+)\/jobs$/)?.[1];
    if (runId) {
      return { ok: true, async json() { return { jobs: fixture.jobs_by_run[runId] || [] }; } };
    }
    throw new Error(`unexpected fixture URL: ${requestUrl}`);
  };
}

// A slow cloud stage is not writer contention. Once it completes, only the
// time since the last dependency completed contributes to the tail's age.
{
  const fixture = {
    workflow_runs: [{ id: 9901, head_branch: "main", status: "in_progress", created_at: "2026-07-21T02:00:00Z" }],
    jobs_by_run: { 9901: [
      { id: 1, name: "acquire", status: "completed", completed_at: "2026-07-21T02:05:00Z" },
      { id: 2, name: "save-source", status: "completed", completed_at: "2026-07-21T02:06:00Z" },
      { id: 3, name: "upload", status: "in_progress", completed_at: null },
      { id: 4, name: "save-outcome", status: "queued", completed_at: null },
    ] },
  };
  const splitPolicy = { ...policy, workflows: ["split.yml"], job_level_targets: splitTargets };
  let calls = 0;
  const transport = fixtureFetch(fixture);
  const fetchImpl = async (url) => { if (url.includes("/jobs?")) calls += 1; return transport(url); };
  let observed = await fetchWorkflowRuns({ policy: splitPolicy, owner: "octo", repo: "repo", fetchImpl });
  assert.equal(evaluateQueue(observed, { now: NOW, maxDepth: 0, maxAgeMinutes: 0 }).candidateDepth, 0,
    "a queued tail is not eligible while cloud I/O is running");
  assert.equal(calls, 1, "multiple writer targets share one jobs API read per parent run");
  fixture.jobs_by_run[9901][2] = { id: 3, name: "upload", status: "completed", completed_at: "2026-07-21T02:59:00Z" };
  observed = await fetchWorkflowRuns({ policy: splitPolicy, owner: "octo", repo: "repo", fetchImpl: fixtureFetch(fixture) });
  const afterUpload = evaluateQueue(observed, { now: NOW, maxDepth: 3, maxAgeMinutes: 30 });
  assert.equal(afterUpload.candidateDepth, 1);
  assert.equal(afterUpload.oldestCandidateAgeMinutes, 1, "53 minutes of cloud work are excluded from writer wait");
}

{
  const observed = await fetchWorkflowRuns({
    policy: { ...policy, workflows: ["root.yml"], job_level_targets: splitTargets },
    owner: "octo", repo: "repo",
    fetchImpl: fixtureFetch({
      workflow_runs: [{ id: 9902, head_branch: "main", status: "in_progress", created_at: "2026-07-21T02:00:00Z", run_started_at: "2026-07-21T02:59:00Z" }],
      jobs_by_run: { 9902: [{ id: 5, name: "source", status: "queued", completed_at: null }] },
    }),
  });
  const queuedRoot = evaluateQueue(observed, { now: NOW, maxDepth: 3, maxAgeMinutes: 30 });
  assert.equal(queuedRoot.candidateDepth, 1, "root source writes are still represented alongside detached tails");
  assert.equal(queuedRoot.oldestCandidateAgeMinutes, 1, "root writer wait starts when its workflow run started");
}

const stockanalysisPolicy = {
  ...policy,
  workflows: ["fetch-stockanalysis.yml"],
  api: {
    ...policy.api,
    max_pages: 1,
    max_runs: 10,
    runs_per_page: 10,
    max_job_runs: 10,
    max_job_pages: 1,
    max_jobs_per_run: 10,
    jobs_per_page: 10,
  },
};

{
  const observed = await fetchWorkflowRuns({
    policy: stockanalysisPolicy,
    owner: "octo",
    repo: "repo",
    fetchImpl: fixtureFetch(readFixture("stockanalysis-nonqueued")),
  });
  const evaluatedJobs = evaluateQueue(observed, { now: NOW, maxDepth: 0, maxAgeMinutes: 0 });
  assert.equal(evaluatedJobs.candidateDepth, 0, "publish cannot count before a valid predecessor completion timestamp");
  assert.equal(evaluatedJobs.runs.running, 1, "running publish job remains separately observable");
}

{
  const observed = await fetchWorkflowRuns({
    policy: stockanalysisPolicy,
    owner: "octo",
    repo: "repo",
    fetchImpl: fixtureFetch(readFixture("stockanalysis-publish-queued")),
  });
  const evaluatedJobs = evaluateQueue(observed, { now: NOW, maxDepth: 3, maxAgeMinutes: 30 });
  assert.equal(evaluatedJobs.candidateDepth, 1, "queued publish-stockanalysis job is a writer-queue candidate");
  assert.equal(evaluatedJobs.oldestCandidateAgeMinutes, 1, "87-minute acquire plus 1-minute publish wait measures only the publish wait");
  assert.equal(evaluatedJobs.status, "ok", "long acquisition must not create a false publish-wait alarm");
  assert.deepEqual(evaluatedJobs.candidateRunIds, [7001], "candidate identity remains the parent workflow run");
}

{
  const observed = await fetchWorkflowRuns({
    policy: stockanalysisPolicy,
    owner: "octo",
    repo: "repo",
    fetchImpl: fixtureFetch(readFixture("stockanalysis-publish-old")),
  });
  const evaluatedJobs = evaluateQueue(observed, { now: NOW, maxDepth: 3, maxAgeMinutes: 30 });
  assert.equal(evaluatedJobs.candidateDepth, 1);
  assert.equal(evaluatedJobs.oldestCandidateAgeMinutes, 60, "eligible publish wait age begins at predecessor completed_at");
  assert.equal(evaluatedJobs.status, "alarm", "truly old eligible publish wait must alarm");
}

// The checker queries all states so a REST response can distinguish queued
// candidates from cancelled and running runs. A fake transport keeps this
// contract test offline and deterministic.
{
  const calls = [];
  const fakeFetch = async (requestUrl) => {
    calls.push(requestUrl);
    return {
      ok: true,
      async json() {
        return { workflow_runs: [] };
      },
    };
  };
  const fetchPolicy = {
    ...policy,
    workflows: ["fetch-stockanalysis.yml"],
    api: { ...policy.api, max_pages: 1, max_runs: 2, runs_per_page: 2 },
  };
  const fetched = await fetchWorkflowRuns({
    policy: fetchPolicy,
    owner: "octo",
    repo: "repo",
    token: "test-token",
    fetchImpl: fakeFetch,
  });
  assert.deepEqual(fetched, []);
  assert.equal(calls.length, 1, "empty page stops bounded REST traversal");
  assert.match(calls[0], /branch=main&per_page=2&page=1/);
}

// A defensive filter keeps a non-main response from becoming a false queue
// candidate even if an API/mock ignores the branch query parameter.
{
  const otherBranch = readFixture("other-branch");
  const fetched = await fetchWorkflowRuns({
    policy: { ...policy, workflows: ["fetch-stockanalysis.yml"], api: { ...policy.api, max_pages: 1, max_runs: 1, runs_per_page: 1 } },
    owner: "octo",
    repo: "repo",
    fetchImpl: async () => ({ ok: true, async json() { return { workflow_runs: otherBranch }; } }),
  });
  assert.deepEqual(fetched, [], "non-main runs are excluded from writer candidates");
}

// Missing branch identity is not enough evidence for a main writer run.
{
  const fetched = await fetchWorkflowRuns({
    policy: { ...policy, workflows: ["fetch-stockanalysis.yml"], api: { ...policy.api, max_pages: 1, max_runs: 1, runs_per_page: 1 } },
    owner: "octo",
    repo: "repo",
    fetchImpl: async () => ({ ok: true, async json() { return { workflow_runs: [{ id: 5002, status: "queued" }] }; } }),
  });
  assert.deepEqual(fetched, [], "missing branch identity fails closed");
}

// Transport/API failures are observation failures, not configuration alarms.
{
  const previousRepository = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "octo/repo";
  const result = await main({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      async json() { return { message: "service unavailable" }; },
    }),
  });
  if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = previousRepository;
  assert.equal(result.status, "unknown", "API failure must not look like an empty queue");
  assert.match(result.message, /observation error:.*service unavailable/);
  assert.equal(process.exitCode, 3, "API observation failure exits with the distinct unknown code");
  process.exitCode = 0;
}

// Invalid threshold configuration is an unknown observation, not an alarm.
{
  const previousRepository = process.env.GITHUB_REPOSITORY;
  const previousDepth = process.env.QUEUE_OBSERVABILITY_MAX_DEPTH;
  process.env.GITHUB_REPOSITORY = "octo/repo";
  process.env.QUEUE_OBSERVABILITY_MAX_DEPTH = "invalid";
  const result = await main({
    fetchImpl: async () => {
      throw new Error("invalid threshold must fail before transport");
    },
  });
  if (previousRepository === undefined) delete process.env.GITHUB_REPOSITORY;
  else process.env.GITHUB_REPOSITORY = previousRepository;
  if (previousDepth === undefined) delete process.env.QUEUE_OBSERVABILITY_MAX_DEPTH;
  else process.env.QUEUE_OBSERVABILITY_MAX_DEPTH = previousDepth;
  assert.equal(result.status, "unknown");
  assert.match(result.message, /observation error/);
  assert.equal(process.exitCode, 3, "invalid configuration uses the distinct unknown exit code");
  process.exitCode = 0;
}

// Dedicated observer is read-only and cannot enter the data-writer group.
{
  const workflowsDir = path.resolve(HERE, "../../.github/workflows");
  const workflow = fs.readFileSync(path.join(workflowsDir, "global-writer-queue-observer.yml"), "utf8");
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /actions:\s*write|contents:\s*write/);
  assert.match(workflow, /group: global-writer-queue-observer/);
  assert.doesNotMatch(workflow, /fenok-data-writer-refs\/heads\/main/);
  assert.match(workflow, /node scripts\/ops\/check-global-writer-queue\.mjs/);
}

console.log("check-global-writer-queue tests passed");
