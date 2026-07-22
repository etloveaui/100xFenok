import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "../lib/data-supply-detection-config.mjs";
import { TRACKED_CRONS } from "../lib/kpi-contract-constants.mjs";
import { classifyRuntimeSlots } from "../lib/kpi-runtime-slots.mjs";

const GITHUB_API = "https://api.github.com";
const RUNS_PER_PAGE = 15;
const FAST_CADENCE_FAILURE_STREAK_THRESHOLD = 2;
const SLOW_CADENCE_FAILURE_STREAK_THRESHOLD = 1;
const WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const GREGORIAN_CYCLE_START_MS = Date.UTC(2000, 0, 1);
const GREGORIAN_CYCLE_DAYS = 146_097;
const ALERT_EXIT = 2;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");
const DETECTION_CALENDARS_PATH = path.join(REPO_ROOT, "scripts", "lib", "data-supply-detection-calendars.json");
const KPI_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-data-health-kpi.json");
export const CADENCE_STATES = Object.freeze(["not_due", "overdue", "recovered", "no_declaration", "unknown"]);

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

function readJsonOrNull(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function workflowFileFromDeclaration(workflow) {
  return typeof workflow === "string" ? path.basename(workflow) : null;
}

function declarationRows(config) {
  const rows = [];
  for (const lane of config?.lanes ?? []) {
    for (const member of lane?.producer_members ?? []) {
      if (member?.cadence_declaration?.kind !== "github_workflow" || !Array.isArray(member.schedule) || member.schedule.length === 0) continue;
      const workflow = workflowFileFromDeclaration(member.workflow);
      if (!workflow) throw new Error(`declared cadence member ${member.id ?? "unknown"} has no workflow file`);
      for (const cron of member.schedule) {
        if (typeof cron !== "string" || cron.trim() === "") {
          throw new Error(`declared cadence member ${member.id ?? "unknown"} has an invalid cron`);
        }
        rows.push({
          workflow,
          workflow_path: member.workflow,
          member_id: member.id ?? null,
          cron,
          calendar_id: member.cadence_calendar,
        });
      }
    }
  }
  return rows;
}

function parseCronField(raw, min, max, context) {
  const values = new Set();
  for (const token of raw.split(",")) {
    const segments = token.split("/");
    if (segments.length > 2) throw new Error(`${context} has an invalid step`);
    const [base, stepRaw] = segments;
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isSafeInteger(step) || step < 1) throw new Error(`${context} has an invalid step`);
    let start;
    let end;
    if (base === "*") {
      start = min;
      end = max;
    } else if (/^\d+-\d+$/.test(base)) {
      [start, end] = base.split("-").map(Number);
    } else if (/^\d+$/.test(base)) {
      start = Number(base);
      end = start;
    } else {
      throw new Error(`${context} has an invalid token`);
    }
    if (start < min || end > max || start > end) throw new Error(`${context} is out of range`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

function parseDeclaredCron(cron) {
  const fields = typeof cron === "string" ? cron.trim().split(/\s+/) : [];
  if (fields.length !== 5) throw new Error("declared cadence cron must have five fields");
  return {
    minute: parseCronField(fields[0], 0, 59, "cron minute"),
    hour: parseCronField(fields[1], 0, 23, "cron hour"),
    day: parseCronField(fields[2], 1, 31, "cron day"),
    month: parseCronField(fields[3], 1, 12, "cron month"),
    weekday: parseCronField(fields[4], 0, 6, "cron weekday"),
    dayWildcard: fields[2] === "*",
    weekdayWildcard: fields[4] === "*",
  };
}

function cronMatchesUtcDay(date, parsed) {
  if (!parsed.month.has(date.getUTCMonth() + 1)) return false;
  const dayMatch = parsed.day.has(date.getUTCDate());
  const weekdayMatch = parsed.weekday.has(date.getUTCDay());
  if (parsed.dayWildcard && parsed.weekdayWildcard) return true;
  if (parsed.dayWildcard) return weekdayMatch;
  if (parsed.weekdayWildcard) return dayMatch;
  // Match the GitHub/POSIX cron rule and the detection-floor evaluator: when
  // both fields are restricted, either day-of-month or day-of-week may fire.
  return dayMatch || weekdayMatch;
}

const failureThresholdCache = new Map();

/**
 * Derive the paging threshold from the same producer cadence declarations used
 * by the overdue join. The 400-year Gregorian cycle makes the minimum combined
 * interval exact for five-field UTC cron without maintaining a second period
 * table. Any effective interval shorter than seven days keeps the two-failure
 * noise guard; weekly or slower declarations page on the first completed
 * failure. Workflows without a producer declaration conservatively retain 2.
 */
export function deriveFailureStreakThreshold(declarations) {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    return FAST_CADENCE_FAILURE_STREAK_THRESHOLD;
  }
  const crons = [...new Set(declarations.map((entry) => (
    typeof entry === "string" ? entry : entry?.cron
  )))].sort();
  if (crons.some((cron) => typeof cron !== "string" || cron.trim() === "")) {
    throw new Error("declared cadence has an invalid cron");
  }
  const cacheKey = crons.join("\u0000");
  if (failureThresholdCache.has(cacheKey)) return failureThresholdCache.get(cacheKey);

  const parsedCrons = crons.map(parseDeclaredCron);
  let firstOccurrence = null;
  let previousOccurrence = null;
  for (let dayOffset = 0; dayOffset < GREGORIAN_CYCLE_DAYS; dayOffset += 1) {
    const dayEpoch = GREGORIAN_CYCLE_START_MS + dayOffset * 86_400_000;
    const date = new Date(dayEpoch);
    const minuteOffsets = new Set();
    for (const parsed of parsedCrons) {
      if (!cronMatchesUtcDay(date, parsed)) continue;
      for (const hour of parsed.hour) {
        for (const minute of parsed.minute) minuteOffsets.add(hour * 60 + minute);
      }
    }
    for (const minuteOffset of [...minuteOffsets].sort((a, b) => a - b)) {
      const occurrence = dayEpoch + minuteOffset * 60_000;
      if (firstOccurrence === null) firstOccurrence = occurrence;
      if (previousOccurrence !== null && occurrence - previousOccurrence < WEEKLY_PERIOD_MS) {
        failureThresholdCache.set(cacheKey, FAST_CADENCE_FAILURE_STREAK_THRESHOLD);
        return FAST_CADENCE_FAILURE_STREAK_THRESHOLD;
      }
      previousOccurrence = occurrence;
    }
  }
  if (firstOccurrence === null) throw new Error("declared cadence produces no occurrence in a Gregorian cycle");
  const cycleEnd = GREGORIAN_CYCLE_START_MS + GREGORIAN_CYCLE_DAYS * 86_400_000;
  if (firstOccurrence + (cycleEnd - GREGORIAN_CYCLE_START_MS) - previousOccurrence < WEEKLY_PERIOD_MS) {
    failureThresholdCache.set(cacheKey, FAST_CADENCE_FAILURE_STREAK_THRESHOLD);
    return FAST_CADENCE_FAILURE_STREAK_THRESHOLD;
  }
  failureThresholdCache.set(cacheKey, SLOW_CADENCE_FAILURE_STREAK_THRESHOLD);
  return SLOW_CADENCE_FAILURE_STREAK_THRESHOLD;
}

/**
 * The detection calendar is the sole ordinary-producer grace authority.  This
 * deliberately has no numeric fallback: a declared GitHub schedule without one
 * exact grace contract is a configuration error, not an immediately-due slot.
 */
export function assertDeclaredScheduleGraceContracts({
  config = DATA_SUPPLY_DETECTION_CONFIG,
  calendars,
} = {}) {
  if (!Array.isArray(calendars?.schedules)) throw new Error("declared schedule calendar contracts are unavailable");
  const declarations = declarationRows(config);
  for (const declaration of declarations) {
    const matches = calendars.schedules.filter((schedule) => (
      schedule?.cron === declaration.cron && schedule?.calendar_id === declaration.calendar_id
    ));
    const declarationId = `${declaration.workflow}:${declaration.cron}`;
    if (matches.length !== 1) {
      throw new Error(`declared schedule ${declarationId} must have exactly one grace contract`);
    }
    const schedule = matches[0];
    if (!schedule?.grace || typeof schedule.grace !== "object" || Array.isArray(schedule.grace)) {
      throw new Error(`schedule ${schedule?.id ?? declarationId} has no grace block`);
    }
    if (typeof schedule.grace.unit !== "string" || !Number.isFinite(schedule.grace.value) || schedule.grace.value <= 0) {
      throw new Error(`schedule ${schedule.id ?? declarationId} has an invalid grace block`);
    }
  }
  return declarations;
}

function runtimeSlotKey(workflow, cron, expectedAt) {
  const expected = new Date(expectedAt);
  if (!Number.isFinite(expected.getTime())) return null;
  const stamp = expected.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
  return `${workflow}:${cron}@${stamp}`;
}

function recoveredRuntimeSlotKeys(runtime) {
  if (!runtime || typeof runtime !== "object") return new Set();
  try {
    return new Set(classifyRuntimeSlots(runtime).recovered_missed_slot_keys);
  } catch {
    return new Set();
  }
}

function cadenceEvidenceFromRows(rows, recoveredSlots) {
  const overdue = rows.filter((row) => row.state === "suspected_skip" || row.state === "attempt_gap");
  if (overdue.length === 0) return { state: "not_due", evidence: [] };
  const allRecovered = overdue.every((row) => {
    const workflow = workflowFileFromDeclaration(row.workflow);
    if (!workflow || !TRACKED_CRONS.some((tracked) => tracked.workflow_file === workflow && tracked.cron === row.cron)) return false;
    const slotKey = runtimeSlotKey(workflow, row.cron, row.expected_at);
    return slotKey !== null && recoveredSlots.has(slotKey);
  });
  const evidence = [...new Set(overdue.map((row) => row.state))].sort();
  return allRecovered ? { state: "recovered", evidence } : { state: "overdue", evidence };
}

/**
 * Project the existing detection/KPI slot evidence onto every watched workflow.
 * `overdue` is an observability result only; the paging path continues to use
 * completed-run failure streaks in evaluateWorkflow.
 */
export function deriveWorkflowCadenceProjection({
  watched,
  coverage = null,
  kpiRuntime = null,
  config = DATA_SUPPLY_DETECTION_CONFIG,
  calendars,
} = {}) {
  if (!Array.isArray(watched)) throw new Error("watched workflows must be an array");
  const declarations = assertDeclaredScheduleGraceContracts({ config, calendars });
  const byWorkflow = new Map();
  for (const declaration of declarations) {
    const rows = byWorkflow.get(declaration.workflow) ?? [];
    rows.push(declaration);
    byWorkflow.set(declaration.workflow, rows);
  }

  const coverageRows = Array.isArray(coverage?.rows) ? coverage.rows : null;
  const coverageByBinding = new Map();
  if (coverageRows) {
    for (const row of coverageRows) {
      const workflow = workflowFileFromDeclaration(row?.workflow);
      if (!workflow || typeof row?.cron !== "string" || typeof row?.member_id !== "string") continue;
      coverageByBinding.set(`${workflow}\u0000${row.cron}\u0000${row.member_id}`, row);
    }
  }
  const recoveredSlots = recoveredRuntimeSlotKeys(kpiRuntime);
  const state_counts = Object.fromEntries(CADENCE_STATES.map((state) => [state, 0]));
  const workflows = watched.map((workflow) => {
    const file = workflow?.file ?? null;
    const declared = byWorkflow.get(file) ?? [];
    const failure_streak_threshold = deriveFailureStreakThreshold(declared);
    let state;
    let evidence = [];
    if (declared.length === 0) {
      state = "no_declaration";
    } else if (!coverageRows) {
      state = "unknown";
    } else {
      const rows = declared.map((entry) => coverageByBinding.get(`${entry.workflow}\u0000${entry.cron}\u0000${entry.member_id}`) ?? null);
      if (rows.some((row) => row === null)) {
        state = "unknown";
      } else {
        ({ state, evidence } = cadenceEvidenceFromRows(rows, recoveredSlots));
      }
    }
    state_counts[state] += 1;
    return { file, state, evidence, failure_streak_threshold };
  });
  return { state_counts, workflows };
}

export function attachWorkflowCadence(workflows, cadenceProjection) {
  const cadenceByFile = new Map((cadenceProjection?.workflows ?? []).map((row) => [row.file, row]));
  return workflows.map((workflow) => {
    const cadence = cadenceByFile.get(workflow.file) ?? {
      state: "unknown",
      evidence: [],
      failure_streak_threshold: FAST_CADENCE_FAILURE_STREAK_THRESHOLD,
    };
    return {
      ...workflow,
      // Keep the run-failure classification intact. An overdue declared slot is
      // visible evidence, but never becomes an `alarm` or a paging decision here.
      cadence_status: cadence.state,
      cadence_evidence: cadence.evidence,
      failure_streak_threshold: cadence.failure_streak_threshold,
    };
  });
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
  const failureStreakThreshold = workflow.failure_streak_threshold === SLOW_CADENCE_FAILURE_STREAK_THRESHOLD
    ? SLOW_CADENCE_FAILURE_STREAK_THRESHOLD
    : FAST_CADENCE_FAILURE_STREAK_THRESHOLD;
  const base = {
    file: workflow.file,
    label: workflow.label,
    streak,
    failure_streak_threshold: failureStreakThreshold,
    alarming: streak >= failureStreakThreshold,
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
    "A scheduled or critical workflow reached its cadence-calibrated failure threshold. On 07-16 a bad commit hard-failed",
    "every Update Manifest run for ~12h and blocked Deploy Worker with no alarm — this",
    "check exists to detect that class of outage on the next hourly alarm sweep.",
    "",
  ];
  for (const alarm of alarms) {
    lines.push(`## ${alarm.label} (\`${alarm.file}\`)`);
    lines.push(`- Consecutive failures: ${alarm.streak}`);
    lines.push(`- Paging threshold: ${alarm.failure_streak_threshold}`);
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
  const calendars = readJsonOrNull(DETECTION_CALENDARS_PATH);
  const kpi = readJsonOrNull(KPI_PATH);
  const cadenceProjection = deriveWorkflowCadenceProjection({
    watched: policy.watched,
    coverage: kpi?.runtime?.fetch_cron_skip_detection ?? null,
    kpiRuntime: kpi?.runtime ?? null,
    calendars,
  });
  const calibratedWatched = attachWorkflowCadence(policy.watched, cadenceProjection);

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
    cadence_state_counts: cadenceProjection.state_counts,
  };

  if (!owner || !repo) {
    const result = {
      ...base,
      status: "unknown",
      message: "GITHUB_REPOSITORY is not set (expected owner/repo).",
      workflows: attachWorkflowCadence(
        policy.watched.map((workflow) => ({
          file: workflow.file,
          label: workflow.label,
          events: workflow.events,
          status: "unknown",
          message: "GitHub workflow runs were not evaluated because GITHUB_REPOSITORY is not set.",
        })),
        cadenceProjection,
      ),
    };
    writeJson(resultPath, result);
    console.error(`[unknown] ${result.message}`);
    process.exit(0);
  }

  const workflows = [];
  for (const workflow of calibratedWatched) {
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
        failure_streak_threshold: workflow.failure_streak_threshold,
        status: "unknown",
        message: error.message,
      });
    }
  }

  const classifiedWorkflows = attachWorkflowCadence(workflows, cadenceProjection);
  const alarms = classifiedWorkflows.filter((w) => w.status === "alarm");
  const unknowns = classifiedWorkflows.filter((w) => w.status === "unknown");
  const status = alarms.length > 0 ? "alarm" : unknowns.length > 0 ? "unknown" : "ok";

  const result = { ...base, status, workflows: classifiedWorkflows };
  if (alarms.length > 0) {
    result.issueBody = buildIssueBody(alarms);
  }
  writeJson(resultPath, result);

  console.log(
    classifiedWorkflows
      .map((w) => `${w.file}=${w.status}${w.streak !== undefined ? `(streak ${w.streak})` : ""}`)
      .join(" "),
  );

  process.exit(alarms.length > 0 ? ALERT_EXIT : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
