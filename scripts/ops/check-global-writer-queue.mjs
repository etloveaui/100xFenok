import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_POLICY_PATH = path.join(HERE, "global-writer-queue-policy.v1.json");
const ALERT_EXIT = 2;
const UNKNOWN_EXIT = 3;

function asPositiveInteger(value, name, { zero = false } = {}) {
  const parsed = Number(value);
  const minimum = zero ? 0 : 1;
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be an integer >= ${minimum}`);
  }
  return parsed;
}

function assertPlainObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

export function loadPolicy(policyPath = DEFAULT_POLICY_PATH) {
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  assertPlainObject(policy, "policy");
  if (policy.version !== 1) throw new Error("queue policy version must be 1");
  if (policy.metric !== "global-writer candidate queued runs") {
    throw new Error("queue policy metric must be global-writer candidate queued runs");
  }
  if (policy.concurrency_group !== "fenok-data-writer-refs/heads/main") {
    throw new Error("queue policy concurrency group is not the canonical global writer group");
  }
  if (policy.canonical_branch !== "main") {
    throw new Error("queue policy canonical_branch must be main");
  }
  if (policy.default_observation_mode !== "workflow_run") {
    throw new Error("queue policy default_observation_mode must be workflow_run");
  }
  if (!Array.isArray(policy.workflows) || policy.workflows.length === 0) {
    throw new Error("queue policy workflows must be a non-empty array");
  }
  const workflowSet = new Set();
  for (const workflow of policy.workflows) {
    if (typeof workflow !== "string" || !/^[^/]+\.ya?ml$/.test(workflow)) {
      throw new Error(`queue policy workflow is not a filename: ${workflow}`);
    }
    if (workflowSet.has(workflow)) throw new Error(`queue policy workflow is duplicated: ${workflow}`);
    workflowSet.add(workflow);
  }
  assertPlainObject(policy.job_level_targets, "policy.job_level_targets");
  for (const [workflow, target] of Object.entries(policy.job_level_targets)) {
    if (!workflowSet.has(workflow)) throw new Error(`job-level target is not a listed workflow: ${workflow}`);
    assertPlainObject(target, `policy.job_level_targets.${workflow}`);
    if (typeof target.job_name !== "string" || target.job_name.length === 0) {
      throw new Error(`job-level target job_name is missing: ${workflow}`);
    }
    if (typeof target.eligibility_predecessor !== "string" || target.eligibility_predecessor.length === 0) {
      throw new Error(`job-level target eligibility_predecessor is missing: ${workflow}`);
    }
    if (target.eligibility_predecessor === target.job_name) {
      throw new Error(`job-level target cannot be its own eligibility predecessor: ${workflow}`);
    }
    if (!Array.isArray(target.parent_run_statuses) || target.parent_run_statuses.length === 0) {
      throw new Error(`job-level target parent_run_statuses is missing: ${workflow}`);
    }
    if (!Array.isArray(target.candidate_statuses) || target.candidate_statuses.length === 0) {
      throw new Error(`job-level target candidate_statuses is missing: ${workflow}`);
    }
  }
  assertPlainObject(policy.api, "policy.api");
  asPositiveInteger(policy.api.runs_per_page, "policy.api.runs_per_page");
  if (policy.api.runs_per_page > 100) throw new Error("policy.api.runs_per_page must be <= 100");
  asPositiveInteger(policy.api.max_pages, "policy.api.max_pages");
  asPositiveInteger(policy.api.max_runs, "policy.api.max_runs");
  if (policy.api.max_runs > policy.api.runs_per_page * policy.api.max_pages) {
    throw new Error("policy.api.max_runs exceeds its page/depth bound");
  }
  asPositiveInteger(policy.api.jobs_per_page, "policy.api.jobs_per_page");
  if (policy.api.jobs_per_page > 100) throw new Error("policy.api.jobs_per_page must be <= 100");
  asPositiveInteger(policy.api.max_job_pages, "policy.api.max_job_pages");
  asPositiveInteger(policy.api.max_jobs_per_run, "policy.api.max_jobs_per_run");
  if (policy.api.max_jobs_per_run > policy.api.jobs_per_page * policy.api.max_job_pages) {
    throw new Error("policy.api.max_jobs_per_run exceeds its page/depth bound");
  }
  asPositiveInteger(policy.api.max_job_runs, "policy.api.max_job_runs");
  if (typeof policy.api.base_url !== "string" || !/^https:\/\//.test(policy.api.base_url)) {
    throw new Error("policy.api.base_url must be an HTTPS URL");
  }
  assertPlainObject(policy.thresholds, "policy.thresholds");
  asPositiveInteger(policy.thresholds.max_depth, "policy.thresholds.max_depth", { zero: true });
  asPositiveInteger(policy.thresholds.max_age_minutes, "policy.thresholds.max_age_minutes", { zero: true });
  if (!Array.isArray(policy.candidate_statuses) || policy.candidate_statuses.length === 0) {
    throw new Error("queue policy candidate_statuses must be a non-empty array");
  }
  assertPlainObject(policy.alert, "policy.alert");
  if (policy.alert.output !== "workflow-failure-and-json") {
    throw new Error("queue policy alert output must be workflow-failure-and-json");
  }
  if (policy.alert.exit_code !== ALERT_EXIT || policy.alert.unknown_exit_code !== UNKNOWN_EXIT) {
    throw new Error("queue policy alert exit codes must be alarm=2 and unknown=3");
  }
  return policy;
}

export function buildApiUrl({ baseUrl, owner, repo, workflow, page, perPage, branch = "main" }) {
  const root = String(baseUrl).replace(/\/$/, "");
  const url = new URL(
    `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  );
  url.searchParams.set("branch", branch);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  return url.toString();
}

export function buildJobsApiUrl({ baseUrl, owner, repo, runId, page, perPage }) {
  const root = String(baseUrl).replace(/\/$/, "");
  const url = new URL(
    `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/runs/${encodeURIComponent(runId)}/jobs`,
  );
  url.searchParams.set("filter", "latest");
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("page", String(page));
  return url.toString();
}

function authHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "100xfenok-global-writer-queue-observer",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function statusBucket(run, candidateStatuses) {
  const status = String(run?.status || "").toLowerCase();
  const conclusion = String(run?.conclusion || "").toLowerCase();
  const effectiveCandidateStatuses = Array.isArray(run?.candidate_statuses)
    ? run.candidate_statuses
    : candidateStatuses;
  if (conclusion === "cancelled" || status === "cancelled") return "cancelled";
  if (effectiveCandidateStatuses.includes(status)) return "candidate";
  if (status === "in_progress" || status === "running") return "running";
  if (status === "completed" || conclusion) return "completed";
  return "other";
}

function ageMinutes(createdAt, now) {
  const created = Date.parse(createdAt || "");
  const current = Date.parse(now || "");
  if (!Number.isFinite(created) || !Number.isFinite(current) || current < created) return null;
  return Math.floor((current - created) / 60_000);
}

function isCanonicalBranch(run, branch) {
  // Workflow-run payloads expose head_branch for push/schedule runs. Prefer it
  // over base_ref so a pull request targeting main is not mistaken for a main
  // writer run. Fixtures and alternate API payloads may expose ref/base_ref.
  const observed = run?.head_branch ?? run?.ref ?? run?.base_ref;
  if (observed === undefined || observed === null || observed === "") return false;
  return observed === branch || observed === `refs/heads/${branch}`;
}

function hasValidCompletedAt(job) {
  return job?.status === "completed"
    && typeof job.completed_at === "string"
    && Number.isFinite(Date.parse(job.completed_at));
}

/**
 * Evaluate runs returned by the workflow-runs REST endpoint. The endpoint does
 * not expose concurrency-group membership, so all candidate values retain an
 * explicit not_verified attribution.
 */
export function evaluateQueue(runs, { now = new Date().toISOString(), maxDepth, maxAgeMinutes, candidateStatuses = ["queued"] } = {}) {
  if (!Array.isArray(runs)) throw new Error("runs must be an array");
  const buckets = { candidate: [], cancelled: [], running: [], completed: [], other: [] };
  for (const run of runs) {
    buckets[statusBucket(run, candidateStatuses)].push(run);
  }
  const ages = buckets.candidate.map((run) => ageMinutes(run.created_at, now)).filter((age) => age !== null);
  const oldestCandidateAgeMinutes = ages.length > 0 ? Math.max(...ages) : null;
  const candidateDepth = buckets.candidate.length;
  const depthAlarm = maxDepth !== undefined && candidateDepth > maxDepth;
  const ageAlarm = maxAgeMinutes !== undefined && oldestCandidateAgeMinutes !== null && oldestCandidateAgeMinutes > maxAgeMinutes;
  return {
    metric: "global-writer candidate queued runs",
    attribution: "[not verified]",
    status: depthAlarm || ageAlarm ? "alarm" : "ok",
    candidateDepth,
    oldestCandidateAgeMinutes,
    thresholds: { maxDepth: maxDepth ?? null, maxAgeMinutes: maxAgeMinutes ?? null },
    runs: {
      candidate: buckets.candidate.length,
      queued: buckets.candidate.length,
      cancelled: buckets.cancelled.length,
      running: buckets.running.length,
      completed: buckets.completed.length,
      other: buckets.other.length,
    },
    candidateRunIds: buckets.candidate.map((run) => run.id).filter((id) => id !== undefined),
  };
}

async function fetchJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: authHeaders(token) });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.message) detail = `${payload.message} (HTTP ${response.status})`;
    } catch {
      // Preserve the HTTP status when the API body is not JSON.
    }
    throw new Error(detail);
  }
  return response.json();
}

export async function fetchWorkflowRuns({ policy, owner, repo, token, fetchImpl = fetch }) {
  const runs = [];
  for (const workflow of policy.workflows) {
    const workflowRuns = [];
    let workflowCount = 0;
    for (let page = 1; page <= policy.api.max_pages && workflowCount < policy.api.max_runs; page += 1) {
      const remaining = policy.api.max_runs - workflowCount;
      const perPage = Math.min(policy.api.runs_per_page, remaining);
      const payload = await fetchJson(
        buildApiUrl({
          baseUrl: policy.api.base_url,
          owner,
          repo,
          workflow,
          page,
          perPage,
          branch: policy.canonical_branch,
        }),
        token,
        fetchImpl,
      );
      if (!Array.isArray(payload?.workflow_runs)) {
        throw new Error(`GitHub workflow-runs response is malformed for ${workflow}`);
      }
      const pageRuns = payload.workflow_runs;
      workflowRuns.push(
        ...pageRuns
          .filter((run) => isCanonicalBranch(run, policy.canonical_branch))
          .map((run) => ({ ...run, workflow })),
      );
      workflowCount += pageRuns.length;
      if (pageRuns.length < perPage) break;
    }
    const jobTarget = policy.job_level_targets[workflow];
    if (!jobTarget) {
      runs.push(...workflowRuns);
      continue;
    }
    const parentRuns = workflowRuns.filter((run) => jobTarget.parent_run_statuses.includes(run.status));
    if (parentRuns.length > policy.api.max_job_runs) {
      throw new Error(`${workflow} active run count exceeds max_job_runs=${policy.api.max_job_runs}`);
    }
    for (const parentRun of parentRuns) {
      if (parentRun.id === undefined || parentRun.id === null) {
        throw new Error(`${workflow} active run is missing id`);
      }
      const jobs = [];
      let jobCount = 0;
      for (let page = 1; page <= policy.api.max_job_pages && jobCount < policy.api.max_jobs_per_run; page += 1) {
        const remaining = policy.api.max_jobs_per_run - jobCount;
        const perPage = Math.min(policy.api.jobs_per_page, remaining);
        const payload = await fetchJson(
          buildJobsApiUrl({
            baseUrl: policy.api.base_url,
            owner,
            repo,
            runId: parentRun.id,
            page,
            perPage,
          }),
          token,
          fetchImpl,
        );
        if (!Array.isArray(payload?.jobs)) {
          throw new Error(`GitHub jobs response is malformed for ${workflow} run ${parentRun.id}`);
        }
        const pageJobs = payload.jobs;
        jobs.push(...pageJobs);
        jobCount += pageJobs.length;
        if (pageJobs.length < perPage) break;
      }
      const predecessor = jobs.find(
        (job) => job.name === jobTarget.eligibility_predecessor && hasValidCompletedAt(job),
      );
      const eligibleAt = predecessor?.completed_at || null;
      runs.push(
        ...jobs
          .filter((job) => job.name === jobTarget.job_name)
          .filter((job) => !jobTarget.candidate_statuses.includes(job.status) || eligibleAt !== null)
          .map((job) => ({
            ...job,
            id: parentRun.id,
            job_id: job.id,
            workflow,
            observation_level: "job",
            writer_job: jobTarget.job_name,
            eligibility_predecessor: jobTarget.eligibility_predecessor,
            eligible_at: eligibleAt,
            candidate_statuses: jobTarget.candidate_statuses,
            created_at: eligibleAt,
          })),
      );
    }
  }
  return runs;
}

function thresholdFromEnv(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : asPositiveInteger(value, name, { zero: true });
}

export function buildResult(policy, { repository, checkedAtUtc, runs, error = null, maxDepth, maxAgeMinutes } = {}) {
  const evaluated = evaluateQueue(runs || [], {
    now: checkedAtUtc,
    maxDepth,
    maxAgeMinutes,
    candidateStatuses: policy.candidate_statuses,
  });
  return {
    policyVersion: policy.version,
    metric: policy.metric,
    concurrencyGroup: policy.concurrency_group,
    attribution: evaluated.attribution,
    repository,
    checkedAtUtc,
    status: error ? "unknown" : evaluated.status,
    message: error ? error.message : undefined,
    thresholds: evaluated.thresholds,
    candidateDepth: evaluated.candidateDepth,
    oldestCandidateAgeMinutes: evaluated.oldestCandidateAgeMinutes,
    runs: evaluated.runs,
    candidateRunIds: evaluated.candidateRunIds,
  };
}

export async function main({ fetchImpl = fetch } = {}) {
  const checkedAtUtc = process.env.QUEUE_OBSERVABILITY_NOW || new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const repository = process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repository.split("/");
  let result;
  try {
    const policyPath = process.env.QUEUE_OBSERVABILITY_POLICY || DEFAULT_POLICY_PATH;
    const policy = loadPolicy(policyPath);
    const maxDepth = thresholdFromEnv("QUEUE_OBSERVABILITY_MAX_DEPTH", policy.thresholds.max_depth);
    const maxAgeMinutes = thresholdFromEnv("QUEUE_OBSERVABILITY_MAX_AGE_MINUTES", policy.thresholds.max_age_minutes);
    if (!owner || !repo) {
      result = buildResult(policy, {
        repository,
        checkedAtUtc,
        runs: [],
        maxDepth,
        maxAgeMinutes,
        error: new Error("GITHUB_REPOSITORY is not set (expected owner/repo)"),
      });
    } else {
      const runs = await fetchWorkflowRuns({ policy, owner, repo, token: process.env.GITHUB_TOKEN, fetchImpl });
      result = buildResult(policy, { repository, checkedAtUtc, runs, maxDepth, maxAgeMinutes });
    }
  } catch (error) {
    // Configuration and transport failures are observation failures, not queue
    // alarms. Emit stable JSON and a distinct nonzero exit so missing evidence cannot be
    // mistaken for evidence of a writer lock wait.
    result = {
      policyVersion: null,
      metric: "global-writer candidate queued runs",
      concurrencyGroup: "fenok-data-writer-refs/heads/main",
      attribution: "[not verified]",
      repository,
      checkedAtUtc,
      status: "unknown",
      message: `observation error: ${error.message}`,
      thresholds: null,
      candidateDepth: null,
      oldestCandidateAgeMinutes: null,
      runs: null,
      candidateRunIds: [],
    };
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "alarm") {
    console.error(`[alarm] ${result.metric}: depth=${result.candidateDepth} oldest_age_minutes=${result.oldestCandidateAgeMinutes ?? "unknown"}`);
    process.exitCode = ALERT_EXIT;
  } else if (result.status === "unknown") {
    process.exitCode = UNKNOWN_EXIT;
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
