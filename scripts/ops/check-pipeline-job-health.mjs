import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GITHUB_API = "https://api.github.com";
const RUNS_PER_PAGE = 15;
const ALARM_STREAK_THRESHOLD = 2;
const ALERT_EXIT = 2;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

// Every exception is a declared policy entry, not an invisible parser escape.
// Validation below fails closed if an exclusion stops being scheduled or if an
// inclusion becomes scheduled (and therefore no longer needs special policy).
export const SCHEDULED_WORKFLOW_EXCLUSIONS = Object.freeze({
  "pipeline-failure-alarm.yml": "self-monitoring would create a recursive alarm loop",
});

export const NON_SCHEDULED_WORKFLOW_INCLUSIONS = Object.freeze({
  "validate-workflows.yml": Object.freeze({
    reason: "critical workflow syntax gate must page despite having no schedule",
    events: Object.freeze(["push"]),
  }),
});

const ISSUE_TITLE = "100xFenok pipeline job failure alarm";

function unquoteYamlScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function splitTopLevelFlow(value, separator = ",") {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (char === quote && value[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
    } else if (char === "[" || char === "{") {
      depth += 1;
    } else if (char === "]" || char === "}") {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function inlineTriggerNames(value) {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return splitTopLevelFlow(trimmed.slice(1, -1)).map(unquoteYamlScalar).filter(Boolean);
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return splitTopLevelFlow(trimmed.slice(1, -1)).map((entry) => {
      const [key] = splitTopLevelFlow(entry, ":");
      return unquoteYamlScalar(key);
    }).filter(Boolean);
  }
  return [unquoteYamlScalar(trimmed)];
}

function workflowMetadata(file, source) {
  const nameMatch = source.match(/^name:\s*(.+?)\s*$/m);
  if (!nameMatch) throw new Error(`${file}: top-level name is required`);

  const lines = source.split(/\r?\n/);
  const onIndex = lines.findIndex((line) => /^(?:on|["']on["']):(?:\s*.*)?$/.test(line));
  if (onIndex === -1) throw new Error(`${file}: top-level on trigger is required`);

  const inlineOn = lines[onIndex].replace(/^(?:on|["']on["']):\s*/, "");
  if (/^\*/.test(inlineOn)) {
    throw new Error(`${file}: aliased top-level on trigger is unsupported`);
  }
  const inlineTriggers = inlineTriggerNames(inlineOn);
  const triggerKeys = [];
  for (let index = onIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[^\s#][^:]*:/.test(line)) break;
    const keyMatch = line.match(/^(\s+)(?:([A-Za-z_][\w-]*)|["']([^"']+)["']):/);
    if (keyMatch) {
      triggerKeys.push({ indent: keyMatch[1].length, key: keyMatch[2] ?? keyMatch[3] });
    }
  }
  const triggerIndent = triggerKeys.length > 0
    ? Math.min(...triggerKeys.map((row) => row.indent))
    : null;
  const blockTriggers = triggerKeys
    .filter((row) => row.indent === triggerIndent)
    .map((row) => row.key);
  const triggers = [...new Set([...inlineTriggers, ...blockTriggers])];
  const scheduled = triggers.includes("schedule");

  return { file, label: unquoteYamlScalar(nameMatch[1]), scheduled, triggers };
}

function validateReason(kind, file, reason) {
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error(`${kind} ${file}: reason must be a non-empty string`);
  }
}

function normalizeInclusion(file, entry) {
  const config = typeof entry === "string" ? { reason: entry } : entry;
  if (!config || typeof config !== "object") {
    throw new Error(`non-scheduled inclusion ${file}: policy must be a reason string or object`);
  }
  validateReason("non-scheduled inclusion", file, config.reason);
  const events = config.events ?? (config.event === undefined ? null : [config.event]);
  if (events === null) return { reason: config.reason.trim(), events: null };
  if (!Array.isArray(events) || events.length === 0 || events.some((event) => typeof event !== "string" || event.trim() === "")) {
    throw new Error(`non-scheduled inclusion ${file}: events must be a non-empty string array`);
  }
  const normalizedEvents = [...new Set(events.map((event) => event.trim()))];
  if (normalizedEvents.includes("workflow_dispatch")) {
    throw new Error(`non-scheduled inclusion ${file}: workflow_dispatch can never be counted`);
  }
  return { reason: config.reason.trim(), events: normalizedEvents };
}

/**
 * Derive the alarm watch policy from the workflow directory. All scheduled
 * workflows are watched automatically unless they have a validated, explained
 * exclusion. Critical non-scheduled gates must be declared individually.
 */
export function deriveWorkflowWatchPolicy({
  workflowsDir = WORKFLOWS_DIR,
  scheduledExclusions = SCHEDULED_WORKFLOW_EXCLUSIONS,
  nonScheduledInclusions = NON_SCHEDULED_WORKFLOW_INCLUSIONS,
  } = {}) {
  const rows = fs.readdirSync(workflowsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => workflowMetadata(
      entry.name,
      fs.readFileSync(path.join(workflowsDir, entry.name), "utf8"),
    ));
  const byFile = new Map(rows.map((row) => [row.file, row]));
  const inclusionConfigs = new Map(
    Object.entries(nonScheduledInclusions).map(([file, entry]) => [file, normalizeInclusion(file, entry)]),
  );

  for (const [file, reason] of Object.entries(scheduledExclusions)) {
    validateReason("scheduled exclusion", file, reason);
    const row = byFile.get(file);
    if (!row?.scheduled) {
      throw new Error(`${file}: exclusion must reference a scheduled workflow`);
    }
  }
  for (const [file] of inclusionConfigs) {
    const row = byFile.get(file);
    if (!row) throw new Error(`${file}: inclusion must reference an existing workflow`);
    if (row.scheduled) {
      throw new Error(`${file}: inclusion must reference a non-scheduled workflow`);
    }
  }

  const watched = rows
    .filter((row) => (row.scheduled && !(row.file in scheduledExclusions)) || row.file in nonScheduledInclusions)
    .map(({ file, label, triggers }) => {
      const events = inclusionConfigs.get(file)?.events
        ?? triggers.filter((event) => event !== "workflow_dispatch");
      if (events.length === 0) {
        throw new Error(`${file}: watched workflow has no countable automatic event`);
      }
      return { file, label, events };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
  const excluded = Object.entries(scheduledExclusions)
    .map(([file, reason]) => ({ file, label: byFile.get(file).label, reason: reason.trim() }))
    .sort((a, b) => a.file.localeCompare(b.file));

  return {
    watched,
    excluded,
    scheduled_count: rows.filter((row) => row.scheduled).length,
  };
}

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
  const countedRuns = runs.filter((run) => {
    if (run?.event === "workflow_dispatch") return false;
    return !Array.isArray(workflow.events) || !run?.event || workflow.events.includes(run.event);
  });
  const { streak, firstFailingIndex } = computeFailureStreak(countedRuns);
  const latest = countedRuns[0] || null;
  const base = {
    file: workflow.file,
    label: workflow.label,
    streak,
    alarming: streak >= ALARM_STREAK_THRESHOLD,
    latestRunUrl: latest?.html_url || null,
  };
  if (workflow.events) base.events = workflow.events;
  if (countedRuns.length === 0) {
    return {
      ...base,
      status: "unknown",
      message: "No completed run observed for this workflow and filter.",
    };
  }
  if (!base.alarming) {
    return { ...base, status: "ok" };
  }
  const firstFailing = firstFailingIndex === null ? null : countedRuns[firstFailingIndex];
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
    "A scheduled or critical workflow failed at least twice in a row. On 07-16 a bad commit hard-failed",
    "every Update Manifest run for ~12h and blocked Deploy Worker with no alarm — this",
    "check exists to detect that class of outage on the next hourly alarm sweep.",
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

export function buildWorkflowRunsUrl({ owner, repo, file, branch = "main", event = null }) {
  const query = new URLSearchParams({
    status: "completed",
    branch,
    per_page: String(RUNS_PER_PAGE),
  });
  if (event) query.set("event", event);
  const segments = [owner, repo, file].map((segment) => encodeURIComponent(segment));
  return `${GITHUB_API}/repos/${segments[0]}/${segments[1]}/actions/workflows/${segments[2]}/runs?${query}`;
}

export function parseWorkflowRunsPayload(payload) {
  if (!Array.isArray(payload?.workflow_runs)) {
    throw new Error("GitHub workflow-runs response is missing workflow_runs[]");
  }
  return payload.workflow_runs;
}

export function mergeWorkflowRunBatches(batches) {
  const byId = new Map();
  for (const run of batches.flat()) {
    const key = run?.id ?? `${run?.run_started_at ?? run?.created_at ?? ""}:${run?.html_url ?? ""}`;
    if (!byId.has(key)) byId.set(key, run);
  }
  return [...byId.values()].sort((a, b) => {
    const aTime = Date.parse(a?.run_started_at ?? a?.created_at ?? "") || 0;
    const bTime = Date.parse(b?.run_started_at ?? b?.created_at ?? "") || 0;
    if (aTime !== bTime) return bTime - aTime;
    return Number(b?.id ?? 0) - Number(a?.id ?? 0);
  });
}

async function fetchCompletedRuns({ token, owner, repo, file, branch, event }) {
  const url = buildWorkflowRunsUrl({ owner, repo, file, branch, event });
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
  return parseWorkflowRunsPayload(payload);
}

export async function main() {
  const token = process.env.GITHUB_TOKEN;
  const resultPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const branch = process.env.PIPELINE_JOB_HEALTH_BRANCH || "main";
  const [owner, repo] = repository.split("/");
  const checkedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const policy = deriveWorkflowWatchPolicy();

  const base = {
    checkedAtUtc,
    issueTitle: ISSUE_TITLE,
    repository,
    branch,
    watched: policy.watched.map((workflow) => workflow.file),
    event_filters: policy.watched
      .map((workflow) => ({ file: workflow.file, events: workflow.events })),
    excluded: policy.excluded,
    scheduled_count: policy.scheduled_count,
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
  for (const workflow of policy.watched) {
    try {
      const batches = [];
      for (const event of workflow.events) {
        batches.push(await fetchCompletedRuns({
          token,
          owner,
          repo,
          file: workflow.file,
          branch,
          event,
        }));
      }
      const runs = mergeWorkflowRunBatches(batches);
      workflows.push(evaluateWorkflow(workflow, runs));
    } catch (error) {
      // A transient API failure must never itself alarm — report unknown, keep exit 0.
      workflows.push({
        file: workflow.file,
        label: workflow.label,
        events: workflow.events,
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
