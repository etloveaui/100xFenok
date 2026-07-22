import fs from "node:fs";
import { pathToFileURL } from "node:url";

const GITHUB_API = "https://api.github.com";
const RUNS_PER_PAGE = 15;
const ALARM_STREAK_THRESHOLD = 2;
const ALERT_EXIT = 2;

// Publishing jobs whose consecutive failures block the deploy pipeline.
// Extending coverage is a one-line edit here.
const WATCHED_WORKFLOWS = [
  { file: "update-manifest.yml", label: "Update Manifest" },
  { file: "deploy-worker.yml", label: "Deploy Worker" },
  { file: "fenok-edge-daily.yml", label: "Fenok Edge Daily Data" },
];

const ISSUE_TITLE = "100xFenok pipeline job failure alarm";

function writeJson(path, payload) {
  if (!path) return;
  fs.writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function authHeaders(token) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "100xfenok-pipeline-job-health",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// Conclusions that count as a pipeline failure. `startup_failure` is GitHub's
// workflow-file/config-level refusal (the #357 class from 07-14); `timed_out`
// is a hung job — both are real outages and must count toward the streak.
const FAILURE_CONCLUSIONS = new Set(["failure", "startup_failure", "timed_out"]);
// Conclusions that are transparent: concurrency supersession (`cancelled`) and
// filtered/no-op runs (`skipped`) are not failures and must not break a streak.
const TRANSPARENT_CONCLUSIONS = new Set(["cancelled", "skipped"]);

/**
 * Count the streak of consecutive failure-class conclusions from the most
 * recent run backward. Transparent conclusions (cancelled, skipped) are passed
 * over; any other conclusion (success, neutral, action_required, ...) ends the
 * streak.
 *
 * Pure function — the test imports this directly.
 *
 * @param {Array<{conclusion: string}>} runs  most-recent-first list of runs
 * @returns {{streak: number, firstFailingIndex: number|null}}
 */
export function computeFailureStreak(runs) {
  let streak = 0;
  let firstFailingIndex = null;
  for (let i = 0; i < runs.length; i += 1) {
    const conclusion = runs[i]?.conclusion;
    if (TRANSPARENT_CONCLUSIONS.has(conclusion)) continue;
    if (FAILURE_CONCLUSIONS.has(conclusion)) {
      streak += 1;
      firstFailingIndex = i;
      continue;
    }
    break;
  }
  return { streak, firstFailingIndex };
}

/**
 * Evaluate a single watched workflow from its completed-run list.
 * Returns a per-workflow status object; never throws.
 */
export function evaluateWorkflow(workflow, runs) {
  const { streak, firstFailingIndex } = computeFailureStreak(runs);
  const latest = runs[0] || null;
  const base = {
    file: workflow.file,
    label: workflow.label,
    streak,
    alarming: streak >= ALARM_STREAK_THRESHOLD,
    latestRunUrl: latest?.html_url || null,
  };
  if (!base.alarming) {
    return { ...base, status: "ok" };
  }
  const firstFailing = firstFailingIndex === null ? null : runs[firstFailingIndex];
  return {
    ...base,
    status: "alarm",
    firstFailingRunId: firstFailing?.id ?? null,
    firstFailingRunUrl: firstFailing?.html_url || null,
    firstFailingStartedAt: firstFailing?.run_started_at || firstFailing?.created_at || null,
  };
}

function buildIssueBody(alarms) {
  const lines = [
    "[alert] Consecutive pipeline job failures detected.",
    "",
    "A publishing job failed at least twice in a row. On 07-16 a bad commit hard-failed",
    "every Update Manifest run for ~12h and blocked Deploy Worker with no alarm — this",
    "check exists to fire within ~20 minutes of that class of outage.",
    "",
  ];
  for (const alarm of alarms) {
    lines.push(`## ${alarm.label} (\`${alarm.file}\`)`);
    lines.push(`- Consecutive failures: ${alarm.streak}`);
    lines.push(
      `- First failing run: ${alarm.firstFailingRunId ?? "unknown"}` +
        (alarm.firstFailingStartedAt ? ` started ${alarm.firstFailingStartedAt}` : ""),
    );
    if (alarm.firstFailingRunUrl) lines.push(`- First failing run URL: ${alarm.firstFailingRunUrl}`);
    if (alarm.latestRunUrl) lines.push(`- Latest run URL: ${alarm.latestRunUrl}`);
    lines.push("- Read the failed step LOG (a green run means nothing here — inspect the actual failure).");
    lines.push("");
  }
  return lines.join("\n");
}

async function fetchCompletedRuns({ token, owner, repo, file }) {
  const url =
    `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${file}/runs` +
    `?status=completed&per_page=${RUNS_PER_PAGE}`;
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      if (payload?.message) detail = `${payload.message} (HTTP ${response.status})`;
    } catch {
      // keep the HTTP-status detail
    }
    throw new Error(detail);
  }
  const payload = await response.json();
  return Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
}

export async function main() {
  const token = process.env.GITHUB_TOKEN;
  const resultPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const [owner, repo] = repository.split("/");
  const checkedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const base = {
    checkedAtUtc,
    issueTitle: ISSUE_TITLE,
    repository,
    watched: WATCHED_WORKFLOWS.map((w) => w.file),
  };

  if (!owner || !repo) {
    const result = {
      ...base,
      status: "unknown",
      message: "GITHUB_REPOSITORY is not set (expected owner/repo).",
      workflows: [],
    };
    writeJson(resultPath, result);
    console.error(`[unknown] ${result.message}`);
    process.exit(0);
  }

  const workflows = [];
  for (const workflow of WATCHED_WORKFLOWS) {
    try {
      const runs = await fetchCompletedRuns({ token, owner, repo, file: workflow.file });
      workflows.push(evaluateWorkflow(workflow, runs));
    } catch (error) {
      // A transient API failure must never itself alarm — report unknown, keep exit 0.
      workflows.push({
        file: workflow.file,
        label: workflow.label,
        status: "unknown",
        message: error.message,
      });
    }
  }

  const alarms = workflows.filter((w) => w.status === "alarm");
  const unknowns = workflows.filter((w) => w.status === "unknown");
  const status = alarms.length > 0 ? "alarm" : unknowns.length > 0 ? "unknown" : "ok";

  const result = { ...base, status, workflows };
  if (alarms.length > 0) {
    result.issueBody = buildIssueBody(alarms);
  }
  writeJson(resultPath, result);

  console.log(
    workflows
      .map((w) => `${w.file}=${w.status}${w.streak !== undefined ? `(streak ${w.streak})` : ""}`)
      .join(" "),
  );

  process.exit(alarms.length > 0 ? ALERT_EXIT : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
