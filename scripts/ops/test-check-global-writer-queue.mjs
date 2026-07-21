import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateQueue,
  loadPolicy,
  buildApiUrl,
  buildJobsApiUrl,
  fetchWorkflowRuns,
  main,
} from "./check-global-writer-queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = (name) => path.join(HERE, "fixtures", "global-writer-queue", `${name}.json`);
const readFixture = (name) => JSON.parse(fs.readFileSync(fixturePath(name), "utf8"));
const policy = loadPolicy();
const NOW = "2026-07-21T03:00:00Z";

assert.equal(policy.version, 1, "queue policy is explicitly versioned");
assert.equal(policy.metric, "global-writer candidate queued runs");
assert.equal(policy.concurrency_group, "fenok-data-writer-refs/heads/main");
assert.equal(policy.canonical_branch, "main", "writer workflows are observed only on main");
assert.equal(policy.default_observation_mode, "workflow_run", "other writers retain workflow-level observation");
assert.ok(Array.isArray(policy.workflows) && policy.workflows.length > 10, "writer workflow list is explicit");
assert.equal(new Set(policy.workflows).size, policy.workflows.length, "writer workflow list has no duplicates");
assert.equal(policy.api.runs_per_page, 100, "API page size stays within the REST limit");
assert.ok(policy.api.max_pages >= 1, "API query depth is bounded");
assert.ok(policy.thresholds.max_depth >= 0, "queue-depth threshold is configurable");
assert.ok(policy.thresholds.max_age_minutes >= 0, "queue-age threshold is configurable");
assert.equal(policy.alert.output, "workflow-failure-and-json", "alert output is machine-readable and non-mutating");
assert.equal(policy.alert.unknown_exit_code, 3, "unknown observation has a distinct nonzero exit");
assert.deepEqual(policy.job_level_targets["fetch-stockanalysis.yml"], {
  job_name: "publish-stockanalysis",
  eligibility_predecessor: "acquire-stockanalysis",
  parent_run_statuses: ["queued", "requested", "waiting", "pending", "in_progress"],
  candidate_statuses: ["queued", "waiting", "pending"],
}, "StockAnalysis observes only its writer-owning publish job");

const workflowsDir = path.resolve(HERE, "../../.github/workflows");
const actualWriterWorkflows = fs
  .readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yml"))
  .filter((file) => {
    const body = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    return body.includes("group: fenok-data-writer-refs/heads/main") || body.includes("group: fenok-data-writer-${{ github.ref }}");
  })
  .sort();
assert.deepEqual([...policy.workflows].sort(), actualWriterWorkflows, "policy list stays in parity with global-writer workflows");

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

// Malformed policy/threshold configuration is an unknown observation, not an
// alarm and not an uncaught process failure. The checker still emits JSON.
{
  const badPolicy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "queue-observer-")), "bad-policy.json");
  fs.writeFileSync(badPolicy, "{\"version\": 99}\n");
  const scriptPath = path.resolve(HERE, "check-global-writer-queue.mjs");
  const run = spawnSync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      GITHUB_REPOSITORY: "octo/repo",
      QUEUE_OBSERVABILITY_POLICY: badPolicy,
    },
    encoding: "utf8",
  });
  assert.equal(run.status, 3, "malformed policy must use the distinct unknown exit code");
  const result = JSON.parse(run.stdout);
  assert.equal(result.status, "unknown");
  assert.match(result.message, /observation error/);
}

// Dedicated observer is read-only and cannot enter the data-writer group.
{
  const workflow = fs.readFileSync(path.join(workflowsDir, "global-writer-queue-observer.yml"), "utf8");
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /actions:\s*write|contents:\s*write/);
  assert.match(workflow, /group: global-writer-queue-observer/);
  assert.doesNotMatch(workflow, /fenok-data-writer-refs\/heads\/main/);
  assert.match(workflow, /node scripts\/ops\/check-global-writer-queue\.mjs/);
}

console.log("check-global-writer-queue tests passed");
