import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GITHUB_API = "https://api.github.com";
const DATA_HEALTH_KPI_PATH = "data/admin/fenok-data-health-kpi.json";
const VALID_KPI_STATUSES = new Set(["fresh", "delayed", "stopped"]);
const RUNS_PER_PAGE = 15;
const FAST_CADENCE_FAILURE_STREAK_THRESHOLD = 2;
const SLOW_CADENCE_FAILURE_STREAK_THRESHOLD = 1;
const WEEKLY_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
const GREGORIAN_CYCLE_START_MS = Date.UTC(2000, 0, 1);
const GREGORIAN_CYCLE_DAYS = 146_097;
const ALERT_EXIT = 2;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOWS_DIR = path.join(REPO_ROOT, ".github", "workflows");

// The alarm used to fail open. Any GitHub API failure marked that workflow
// "unknown", unknowns are not alarms, and the final exit was
// `alarms.length > 0 ? ALERT_EXIT : 0` - so a run that could not read a single
// workflow exited 0 and the workflow, which gates all reporting on a failing
// step, reported nothing. An API outage made all 34 watched workflows
// unreadable and the alarm said everything was fine.
//
// The original intent is correct and is kept: a transient API failure must
// never itself alarm. What was missing is a bound. A transient failure hits one
// workflow; blindness is correlated and hits most at once. A minority of
// unknowns therefore stays as quiet as before, and a majority means the alarm's
// "ok" describes a minority of what it claims to watch, which is not evidence
// of health. Majority rather than a tuned number: it is the point at which
// "everything I watch is fine" stops being mostly true.
export const BLINDNESS_REASON =
  "the alarm could not evaluate a majority of the workflows it watches, so its result is not evidence of health";

export function classifyAlarmBlindness({ watched, unknown } = {}) {
  const blind = { blind: true, reason: BLINDNESS_REASON };
  if (!Number.isInteger(watched) || !Number.isInteger(unknown)) return blind;
  if (watched <= 0) return blind;            // asserting health over nothing
  if (unknown < 0 || unknown > watched) return blind;
  return unknown * 2 > watched ? blind : { blind: false, reason: null };
}

export function buildBlindnessBody({ watched, unknown, unknownWorkflows }) {
  const lines = [
    "[alert] The pipeline alarm could not see.",
    "",
    `${unknown} of ${watched} watched workflows could not be evaluated, so this run's`,
    "result does not assert that the pipeline is healthy - only that the alarm was",
    "unable to look. A minority of unreadable workflows is tolerated as transient;",
    "a majority is reported because it cannot be.",
    "",
    "Unreadable workflows:",
  ];
  for (const workflow of unknownWorkflows) {
    lines.push(`- ${workflow.file}: ${workflow.message ?? "no message"}`);
  }
  return lines.join("\n");
}

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
  // Carried so a watched workflow can be measured against its own declared
  // schedule; a slot that never became a run leaves no other evidence.
  const crons = [...source.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']\s*$/gm)].map((match) => match[1]);

  return { file, label: unquoteYamlScalar(nameMatch[1]), scheduled, triggers, crons };
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
    .map(({ file, label, triggers, crons }) => {
      const events = inclusionConfigs.get(file)?.events
        ?? triggers.filter((event) => event !== "workflow_dispatch");
      if (events.length === 0) {
        throw new Error(`${file}: watched workflow has no countable automatic event`);
      }
      const declaredCrons = crons ?? [];
      return {
        file,
        label,
        events,
        crons: declaredCrons,
        failure_streak_threshold: deriveFailureStreakThreshold(declaredCrons),
      };
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

// Cache the cron-derived failure threshold by normalized schedule set.
const failureThresholdCache = new Map();

/**
 * Derive the workflow failure threshold from its GitHub cron declarations. The
 * 400-year Gregorian cycle makes the minimum combined interval exact for
 * five-field UTC cron: schedules faster than weekly keep the two-failure noise
 * guard, while weekly or slower schedules page on their first completed failure.
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

async function readApiJson(response, url) {
  if (!response?.ok) {
    throw new Error(`GitHub API request failed for ${url}: HTTP ${response?.status ?? "unknown"}`);
  }
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`GitHub API returned invalid JSON for ${url}`);
  }
  if (payload && typeof payload === "object" && payload.encoding === "base64" && typeof payload.content === "string") {
    const decoded = Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
    try {
      return JSON.parse(decoded);
    } catch {
      throw new Error(`GitHub API returned invalid file JSON for ${url}`);
    }
  }
  return payload;
}

function buildKpiHistoryCommitsUrl({ owner, repo, branch = "main" }) {
  const segments = [owner, repo].map((segment) => encodeURIComponent(segment));
  const query = new URLSearchParams({
    path: DATA_HEALTH_KPI_PATH,
    sha: branch,
    per_page: "2",
  });
  return `${GITHUB_API}/repos/${segments[0]}/${segments[1]}/commits?${query}`;
}

function buildKpiGenerationContentUrl({ owner, repo, sha }) {
  const segments = [owner, repo].map((segment) => encodeURIComponent(segment));
  const file = DATA_HEALTH_KPI_PATH.split("/").map(encodeURIComponent).join("/");
  const query = new URLSearchParams({ ref: sha });
  return `${GITHUB_API}/repos/${segments[0]}/${segments[1]}/contents/${file}?${query}`;
}

function kpiGenerationStatuses(generation) {
  if (!generation || typeof generation !== "object" || Array.isArray(generation)
    || typeof generation.generated_at !== "string"
    || !Number.isFinite(Date.parse(generation.generated_at))
    || !Array.isArray(generation.sets) || generation.sets.length === 0) return null;
  const statuses = new Map();
  for (const row of generation.sets) {
    if (!row || typeof row.set !== "string" || row.set.trim() === ""
      || !VALID_KPI_STATUSES.has(row.status) || statuses.has(row.set)) return null;
    statuses.set(row.set, row.status);
  }
  return statuses;
}

/** Compare the two newest committed KPI generations; unreadable history is unknown, never clear. */
export function classifyKpiGenerationStoppage(generations) {
  if (!Array.isArray(generations) || generations.length !== 2) {
    return { status: "unknown", reason: "two_kpi_generations_unavailable", stopped_sets: [] };
  }
  const [latest, previous] = generations;
  const latestStatuses = kpiGenerationStatuses(latest);
  const previousStatuses = kpiGenerationStatuses(previous);
  const latestTime = Date.parse(latest?.generated_at ?? "");
  const previousTime = Date.parse(previous?.generated_at ?? "");
  if (!latestStatuses || !previousStatuses || latestTime <= previousTime) {
    return { status: "unknown", reason: "kpi_generation_history_invalid", stopped_sets: [] };
  }
  const stopped_sets = [...latestStatuses]
    .filter(([set, status]) => status === "stopped" && previousStatuses.get(set) === "stopped")
    .map(([set]) => set)
    .sort();
  return {
    status: stopped_sets.length > 0 ? "alarm" : "ok",
    stopped_sets,
    latest_generated_at: latest.generated_at,
    previous_generated_at: previous.generated_at,
  };
}

/** Load exactly the latest two committed versions of the slim KPI from GitHub. */
export async function fetchKpiGenerationSnapshots({ token, owner, repo, branch = "main", fetchFn = fetch } = {}) {
  if (typeof owner !== "string" || owner === "" || typeof repo !== "string" || repo === "") {
    throw new Error("KPI history requires an owner and repository");
  }
  const commitsUrl = buildKpiHistoryCommitsUrl({ owner, repo, branch });
  const commits = await readApiJson(
    await fetchFn(commitsUrl, { headers: authHeaders(token) }),
    commitsUrl,
  );
  const shas = Array.isArray(commits)
    ? commits.slice(0, 2).map((row) => row?.sha).filter((sha) => typeof sha === "string" && /^[0-9a-f]{40}$/i.test(sha))
    : [];
  if (shas.length !== 2 || shas[0] === shas[1]) {
    throw new Error("GitHub returned fewer than two committed KPI generations");
  }
  return Promise.all(shas.map(async (sha) => {
    const url = buildKpiGenerationContentUrl({ owner, repo, sha });
    const response = await fetchFn(url, {
      headers: { ...authHeaders(token), Accept: "application/vnd.github.raw+json" },
    });
    return readApiJson(response, url);
  }));
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
  const evictedRunUrls = [];
  for (let i = 0; i < runs.length; i += 1) {
    const run = runs[i];
    // A run GitHub evicted from the writer queue executed nothing, so it is
    // evidence about contention, not about the producer. It must not inflate
    // the streak and must not break one either — but it is named on the way
    // past, because a lost acquisition slot that reads as ordinary noise is
    // exactly how the 07-24 news-tone slot disappeared for a day.
    if (run?.queue_evicted === true) {
      if (run?.html_url) evictedRunUrls.push(run.html_url);
      continue;
    }
    const conclusion = run?.conclusion;
    if (TRANSPARENT_CONCLUSIONS.has(conclusion)) continue;
    if (FAILURE_CONCLUSIONS.has(conclusion)) {
      streak += 1;
      firstFailingIndex = i;
      continue;
    }
    break;
  }
  return { streak, firstFailingIndex, evictedRunUrls };
}

/**
 * True when GitHub never executed the run: every job was cancelled without
 * entering a single step. That is the legacy concurrency-queue replacement
 * signature retained for historical evidence and isolated groups. Empty job
 * data does not prove this signature; scheduled `jobs=[]` is classified
 * separately as a lost schedule slot.
 *
 * Pure function — the test imports this directly.
 *
 * @param {Array<{conclusion: string, steps?: Array<unknown>}>|null|undefined} jobs
 * @returns {boolean}
 */
export function isQueueEvictedRun(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return false;
  return jobs.every((job) => job?.conclusion === "cancelled" && (job?.steps?.length ?? 0) === 0);
}

// A slot that ran and produced nothing is already visible as a lost slot. A
// slot that never became a run has no object to inspect in the completed-run
// list, so these workflows also use their own cron to detect silence. The
// restore watchdog additionally reads recent in-progress schedule runs so a
// legitimate bounded execution is not mistaken for an absent trigger.
//
// Scope is deliberately the detectors. A workflow that follows its producers
// rather than owning a clock - Update Manifest, Deploy Worker,
// build-stocks-analyzer - has no schedule of its own to be late against.
export const MISSED_WINDOW_WORKFLOWS = new Set([
  "data-plane-serving-probe.yml",
  "check-sec13f-live-parity.yml",
  "global-writer-queue-observer.yml",
  "worker-request-budget-alarm.yml",
  "retention-restore.yml",
]);

// The restore watchdog is bounded to ten minutes and runs every fifteen. Only
// an actually running scheduled job, younger than that timeout, is extra
// liveness evidence; a queued run can wait indefinitely because job timeouts do
// not include queue time. This supplements the existing GitHub run-history
// check for a missing scheduled slot.
export const MISSED_WINDOW_ACTIVE_RUN_WORKFLOWS = new Set([
  "retention-restore.yml",
]);
export const MISSED_WINDOW_ACTIVE_RUN_MAX_AGE_MS = 10 * 60_000;

// GitHub drops scheduled runs routinely, so one skipped slot is normal and two
// consecutive ones are not. Measured 2026-08-21T01:30Z, the hourly observers had
// missed exactly two while daily and six-hourly lanes ran normally.
//
// This counts SLOTS, not elapsed multiples. Elapsed time was the first attempt
// and it silently failed the very case it was written for: those observers last
// ran at 23:35Z against an hourly cron, so at 01:30Z only 1.91 intervals had
// elapsed and a 2x elapsed rule missed it by 0.09h - while the 00:11 and 01:11
// slots had both plainly passed unrun.
export const MISSED_WINDOW_MULTIPLIER = 2;

// Preserve the existing detector policy and its independent-observer parity.
// Exact declared instants are a separate restore-watchdog contract below.
export function missedSlotCount(cron, sinceMs, nowMs) {
  const intervalHours = cronIntervalHours(cron);
  if (intervalHours === null || !Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return null;
  const fields = cron.trim().split(/\s+/);
  const minute = Number(fields[0]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const stepMs = intervalHours * 3_600_000;
  // Walk from the slot at or before `since` forward, so a slot is counted only
  // once it has actually passed.
  const start = new Date(sinceMs);
  const anchor = Date.UTC(
    start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate(),
    start.getUTCHours(), minute, 0, 0,
  );
  let slot = (intervalHours === 1 || anchor <= sinceMs) ? anchor + stepMs : anchor;
  let missed = 0;
  while (slot <= nowMs && missed <= 1000) { missed += 1; slot += stepMs; }
  return missed;
}

// Scheduled instants strictly after `since` and at or before `now`. Reuse the
// existing cron parser so minute lists such as the restore watchdog's
// `4,19,34,49` are counted as real schedule slots rather than rejected as a
// non-numeric minute field. Stop after 1001 slots: callers only need to know
// whether the two-slot alarm threshold was crossed, and the cap bounds stale
// records without changing their alarm result.
export function declaredMissedSlotCount(cron, sinceMs, nowMs) {
  if (!Number.isFinite(sinceMs) || !Number.isFinite(nowMs)) return null;
  let parsed;
  try {
    parsed = parseDeclaredCron(cron);
  } catch {
    return null;
  }
  if (nowMs <= sinceMs) return 0;
  const dayMs = 86_400_000;
  const hourMs = 3_600_000;
  const minuteMs = 60_000;
  const firstDay = Math.floor(sinceMs / dayMs) * dayMs;
  const hours = [...parsed.hour].sort((a, b) => a - b);
  const minutes = [...parsed.minute].sort((a, b) => a - b);
  let missed = 0;
  let scannedDays = 0;
  for (let dayEpoch = firstDay; dayEpoch <= nowMs && scannedDays < 146_097; dayEpoch += dayMs) {
    scannedDays += 1;
    const date = new Date(dayEpoch);
    if (!Number.isFinite(date.getTime()) || !cronMatchesUtcDay(date, parsed)) continue;
    for (const hour of hours) {
      for (const minute of minutes) {
        const slot = dayEpoch + hour * hourMs + minute * minuteMs;
        if (slot <= sinceMs || slot > nowMs) continue;
        missed += 1;
        if (missed > 1000) return missed;
      }
    }
  }
  return missed;
}

// Coarse by design: the question is only "how many hours between slots", so a
// cadence class is enough and a full cron model would add precision this rule
// never uses.
export function cronIntervalHours(cron) {
  if (typeof cron !== "string") return null;
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [, hour, dayOfMonth, , dayOfWeek] = fields;
  if (dayOfMonth !== "*") return 24 * 31;
  if (dayOfWeek !== "*") return 24 * 7;
  const stepped = /^\*\/(\d+)$/.exec(hour);
  if (stepped) {
    const step = Number(stepped[1]);
    return Number.isFinite(step) && step > 0 ? step : null;
  }
  return hour === "*" ? 1 : 24;
}

export function isLostScheduledSlot(run) {
  return run?.event === "schedule"
    && (run?.jobs_empty === true || run?.queue_evicted === true);
}

/**
 * Evaluate a single watched workflow from its completed-run list.
 * Returns a per-workflow status object; never throws.
 */
// A missed_schedule_window verdict hinges entirely on the run page's newest
// entry, and a stale or truncated page fabricates it. Measured twice
// (2026-09-13T12:10:47Z, 2026-09-14T08:11:53Z): the serving-probe row anchored
// at 2026-08-19T07:24:30Z with 105 counted slots while run 34809685448 had
// succeeded on 2026-09-14T05:27:04Z. The verdict is therefore re-read once
// with a wide page and the second read adjudicates; genuine silence reproduces.
export function needsMissedWindowReverification(row) {
  return row?.missed_schedule_window_hours != null;
}

export function evaluateWorkflow(workflow, runs, { now = Date.now(), activeScheduledRuns = [] } = {}) {
  const countedRuns = runs.filter((run) => {
    if (run?.event === "workflow_dispatch") return false;
    return !Array.isArray(workflow.events) || !run?.event || workflow.events.includes(run.event);
  });
  const { streak, firstFailingIndex, evictedRunUrls } = computeFailureStreak(countedRuns);
  // A lost scheduled slot means "this refresh never happened". Any strictly
  // newer successful run of the same workflow — workflow_dispatch included —
  // is proof the refresh has since happened, so the slot stops paging. Without
  // this, one evicted monthly slot pages hourly until the NEXT natural slot
  // (the 2026-08-01 storm left OECD paging toward September 1 past five
  // dispatch recoveries). Dispatch runs stay excluded from streak/alarm
  // counting above; they participate only as recovery evidence, the same
  // admission rule the promotion gate adopted in 1f3fc3518f. Run ids are
  // monotonic, so "newer" is an id comparison.
  const newestSuccessId = runs.reduce((max, run) => {
    if (run?.conclusion !== "success") return max;
    const id = Number(run?.id);
    return Number.isFinite(id) && id > max ? id : max;
  }, -Infinity);
  const lostSlotCandidates = countedRuns.filter(isLostScheduledSlot);
  const lostScheduledSlots = lostSlotCandidates.filter((run) => {
    const id = Number(run?.id);
    return !Number.isFinite(id) || id > newestSuccessId;
  });
  const resolvedLostSlotCount = lostSlotCandidates.length - lostScheduledSlots.length;
  const lostScheduledSlotRunUrls = lostScheduledSlots
    .map((run) => run?.html_url)
    .filter(Boolean);
  // The same recovery rule applies to a failure streak: on a slow-cadence
  // lane the streak can otherwise only break at the NEXT natural slot, so a
  // producer fixed and proven by dispatch keeps paging for weeks. The newest
  // run the streak counted is the first failure-class, non-transparent run
  // from the top; a success minted after it means the producer ran clean
  // more recently than it last failed.
  const newestStreakFailure = countedRuns.find((run) =>
    run?.queue_evicted !== true
      && !TRANSPARENT_CONCLUSIONS.has(run?.conclusion)
      && FAILURE_CONCLUSIONS.has(run?.conclusion));
  const streakRecovered = Boolean(
    newestStreakFailure
      && Number.isFinite(Number(newestStreakFailure.id))
      && Number(newestStreakFailure.id) < newestSuccessId,
  );
  const latest = countedRuns[0] || null;
  const failureStreakThreshold = workflow.failure_streak_threshold === SLOW_CADENCE_FAILURE_STREAK_THRESHOLD
    ? SLOW_CADENCE_FAILURE_STREAK_THRESHOLD
    : FAST_CADENCE_FAILURE_STREAK_THRESHOLD;
  const alarmReasons = [];
  if (streak >= failureStreakThreshold && !streakRecovered) alarmReasons.push("failure_streak");
  if (lostScheduledSlots.length > 0) alarmReasons.push("lost_schedule_slot");

  // The newest counted run's timestamp was previously computed and discarded.
  const latestStartedAt = latest?.run_started_at || latest?.created_at || null;
  const intervals = (Array.isArray(workflow.crons) ? workflow.crons : [])
    .map(cronIntervalHours)
    .filter((value) => Number.isFinite(value) && value > 0);
  // The most frequent schedule is the honest bound when a workflow has several.
  const intervalHours = intervals.length > 0 ? Math.min(...intervals) : null;
  let missedWindowHours = null;
  let missedSlots = null;
  if (MISSED_WINDOW_WORKFLOWS.has(workflow.file) && intervalHours !== null) {
    const isRestoreWatchdog = MISSED_WINDOW_ACTIVE_RUN_WORKFLOWS.has(workflow.file);
    // Existing detectors retain their newest-counted-run anchor, including
    // queue-delayed execution order. Only restore observes schedule liveness.
    let sinceMs = latestStartedAt ? Date.parse(latestStartedAt) : null;
    if (isRestoreWatchdog) {
      // A manual dispatch is useful recovery evidence for a lost acquisition
      // slot, but it is not evidence that the schedule itself remains live.
      // Anchor missed-window counting only to scheduled runs, with an additional
      // recent in-progress schedule observation for the bounded restore watchdog.
      const completedLivenessRuns = countedRuns.filter((run) => run?.event === "schedule");
      const completedScheduleEvidence = completedLivenessRuns
        .map((run) => run?.run_started_at || run?.created_at)
        .map((timestamp) => Date.parse(timestamp))
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp <= now);
      const inProgressScheduleEvidence = Array.isArray(activeScheduledRuns)
        ? activeScheduledRuns
          .filter((run) => run?.event === "schedule" && run?.status === "in_progress")
          // Use actual execution start, not created_at: a long queue wait is
          // outside the job timeout and cannot establish a healthy run window.
          .map((run) => Date.parse(run?.run_started_at))
          .filter((startedAt) => Number.isFinite(startedAt)
            && startedAt <= now
            && now - startedAt <= MISSED_WINDOW_ACTIVE_RUN_MAX_AGE_MS)
        : [];
      const scheduleEvidence = [...completedScheduleEvidence, ...inProgressScheduleEvidence];
      sinceMs = scheduleEvidence.length > 0 ? Math.max(...scheduleEvidence) : null;
    }
    const tightestCron = (Array.isArray(workflow.crons) ? workflow.crons : [])
      .find((cron) => cronIntervalHours(cron) === intervalHours) ?? null;
    const countSlots = isRestoreWatchdog ? declaredMissedSlotCount : missedSlotCount;
    missedSlots = tightestCron === null || sinceMs === null ? null : countSlots(tightestCron, sinceMs, now);
    if (Number.isFinite(missedSlots) && missedSlots >= MISSED_WINDOW_MULTIPLIER) {
      missedWindowHours = (now - sinceMs) / 3_600_000;
    }
  }
  if (missedWindowHours !== null) alarmReasons.push("missed_schedule_window");

  const base = {
    file: workflow.file,
    label: workflow.label,
    streak,
    failure_streak_threshold: failureStreakThreshold,
    alarming: alarmReasons.length > 0,
    alarm_reasons: alarmReasons,
    latestRunUrl: latest?.html_url || null,
    latest_run_started_at: latestStartedAt,
    missed_schedule_window_hours: missedWindowHours === null ? null : Number(missedWindowHours.toFixed(2)),
    missed_schedule_slot_count: missedSlots,
    queue_evicted_run_urls: evictedRunUrls,
    lost_schedule_slot_count: lostScheduledSlots.length,
    resolved_lost_schedule_slot_count: resolvedLostSlotCount,
    lost_schedule_slot_run_urls: lostScheduledSlotRunUrls,
    failure_streak_recovered: streakRecovered,
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
    ...(firstFailing ? {
      firstFailingRunId: firstFailing.id ?? null,
      firstFailingRunUrl: firstFailing.html_url || null,
      firstFailingStartedAt: firstFailing.run_started_at || firstFailing.created_at || null,
    } : {}),
  };
}

export function buildIssueBody(alarms) {
  const lines = [
    "[alert] Pipeline health incidents detected.",
    "",
    "A watched workflow failed or missed its scheduled slots in GitHub run history,",
    "or a data set remained stopped in two committed health KPI generations.",
    "",
  ];
  for (const alarm of alarms) {
    if (Array.isArray(alarm.kpi_stopped_sets)) {
      lines.push("## Data stopped advancing");
      lines.push("- KPI status: stopped in two consecutive generations");
      lines.push(`- Data sets: ${alarm.kpi_stopped_sets.join(", ")}`);
      lines.push(`- Latest KPI generation: ${alarm.latest_generated_at ?? "unknown"}`);
      lines.push(`- Previous KPI generation: ${alarm.previous_generated_at ?? "unknown"}`);
      lines.push("");
      continue;
    }
    lines.push(`## ${alarm.label} (\`${alarm.file}\`)`);
    const reasons = Array.isArray(alarm.alarm_reasons) ? alarm.alarm_reasons : [];
    lines.push(`- Alarm reasons: ${reasons.join(", ") || "unknown"}`);
    if (reasons.includes("lost_schedule_slot")) {
      lines.push(`- Lost scheduled slots: ${alarm.lost_schedule_slot_count ?? 0}`);
      for (const url of alarm.lost_schedule_slot_run_urls ?? []) {
        lines.push(`- Lost scheduled run URL: ${url}`);
      }
    }
    if (reasons.includes("missed_schedule_window")) {
      lines.push(`- Scheduled slots passed with no run: ${alarm.missed_schedule_slot_count ?? "unknown"}`);
      lines.push(`- Last run started: ${alarm.latest_run_started_at ?? "unknown"}`
        + ` (${alarm.missed_schedule_window_hours ?? "unknown"}h ago)`);
      lines.push("- This detector did not merely fail, it did not run. Check whether its schedule"
        + " is still being served, then whether the workflow is disabled.");
    }
    if (reasons.includes("failure_streak")) {
      lines.push(`- Consecutive failures: ${alarm.streak}`);
      lines.push(`- Paging threshold: ${alarm.failure_streak_threshold}`);
      lines.push(
        `- First failing run: ${alarm.firstFailingRunId ?? "unknown"}` +
          (alarm.firstFailingStartedAt ? ` started ${alarm.firstFailingStartedAt}` : ""),
      );
      if (alarm.firstFailingRunUrl) lines.push(`- First failing run URL: ${alarm.firstFailingRunUrl}`);
      lines.push("- Read the failed step log for the failing run.");
    }
    if (alarm.latestRunUrl) lines.push(`- Latest run URL: ${alarm.latestRunUrl}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function buildWorkflowRunsUrl({
  owner,
  repo,
  file,
  branch = "main",
  event = null,
  perPage = RUNS_PER_PAGE,
  status = "completed",
}) {
  const query = new URLSearchParams({
    status,
    branch,
    per_page: String(perPage),
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

async function fetchWorkflowRuns({ token, owner, repo, file, branch, event, perPage = RUNS_PER_PAGE, status = "completed" }) {
  const url = buildWorkflowRunsUrl({ owner, repo, file, branch, event, perPage, status });
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
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
    } catch (error) {
      lastError = error;
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function fetchRunJobs({ token, owner, repo, runId }) {
  const segments = [owner, repo].map((segment) => encodeURIComponent(segment));
  const url = `${GITHUB_API}/repos/${segments[0]}/${segments[1]}/actions/runs/${encodeURIComponent(runId)}/jobs?per_page=100`;
  const response = await fetch(url, { headers: authHeaders(token) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.jobs) ? payload.jobs : [];
}

// Only the leading failure-class or scheduled-cancellation prefix can change an
// incident verdict, so that is the only place worth spending job-level API calls.
// The lookup is capped and fail-open: an API error preserves the run-list result.
export const QUEUE_EVICTION_INSPECTION_LIMIT = 5;

export async function annotateQueueEvictions({ runs, fetchJobsFn, limit = QUEUE_EVICTION_INSPECTION_LIMIT }) {
  if (!Array.isArray(runs) || typeof fetchJobsFn !== "function") return runs;
  let inspected = 0;
  for (const run of runs) {
    const inspectable = FAILURE_CONCLUSIONS.has(run?.conclusion)
      || (run?.event === "schedule" && run?.conclusion === "cancelled");
    if (!inspectable) break;
    if (inspected >= limit) break;
    inspected += 1;
    try {
      const jobs = await fetchJobsFn(run.id);
      if (Array.isArray(jobs) && jobs.length === 0) run.jobs_empty = true;
      else if (isQueueEvictedRun(jobs)) run.queue_evicted = true;
    } catch {
      // keep the run-list classification
    }
  }
  return runs;
}

export async function main() {
  const token = process.env.GITHUB_TOKEN;
  const resultPath = process.env.PIPELINE_JOB_HEALTH_RESULT || "pipeline-job-health-result.json";
  const repository = process.env.GITHUB_REPOSITORY || "";
  const branch = process.env.PIPELINE_JOB_HEALTH_BRANCH || "main";
  const [owner, repo] = repository.split("/");
  const checkedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const policy = deriveWorkflowWatchPolicy();
  let dataHealthKpi;
  if (!owner || !repo) {
    dataHealthKpi = {
      status: "unknown",
      reason: "repository_unset",
      stopped_sets: [],
    };
  } else {
    try {
      dataHealthKpi = classifyKpiGenerationStoppage(await fetchKpiGenerationSnapshots({
        token,
        owner,
        repo,
        branch,
      }));
    } catch {
      dataHealthKpi = {
        status: "unknown",
        reason: "kpi_history_unavailable",
        stopped_sets: [],
      };
    }
  }

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
    data_health_kpi: dataHealthKpi,
  };

  if (!owner || !repo) {
    const result = {
      ...base,
      status: "unknown",
      message: "GITHUB_REPOSITORY is not set (expected owner/repo).",
      workflows: policy.watched.map((workflow) => ({
        file: workflow.file,
        label: workflow.label,
        events: workflow.events,
        failure_streak_threshold: workflow.failure_streak_threshold,
        status: "unknown",
        message: "GitHub workflow runs were not evaluated because GITHUB_REPOSITORY is not set.",
      })),
    };
    writeJson(resultPath, result);
    // Deliberately exit 0. This path is reached only when GITHUB_REPOSITORY is
    // empty, which the Actions runner always sets, so in CI it is unreachable -
    // it exists for running this script by hand offline. Making a local
    // invocation alarm would be noise, and the real fail-open defect was the API
    // path below, which is now bounded by classifyAlarmBlindness.
    console.error(`[unknown] ${result.message}`);
    process.exit(0);
  }

  const workflows = [];
  for (const workflow of policy.watched) {
    try {
      const batches = [];
      // workflow_dispatch is fetched even when it is not a counted event:
      // evaluateWorkflow uses dispatch successes purely as lost-slot recovery
      // evidence, never for streak or alarm counting.
      const fetchEvents = workflow.events.includes("workflow_dispatch")
        ? workflow.events
        : [...workflow.events, "workflow_dispatch"];
      for (const event of fetchEvents) {
        batches.push(await fetchWorkflowRuns({
          token,
          owner,
          repo,
          file: workflow.file,
          branch,
          event,
        }));
      }
      const fetchInProgressScheduledRuns = async () => {
        if (!MISSED_WINDOW_ACTIVE_RUN_WORKFLOWS.has(workflow.file)) return [];
        return fetchWorkflowRuns({
          token,
          owner,
          repo,
          file: workflow.file,
          branch,
          event: "schedule",
          perPage: 5,
          status: "in_progress",
        });
      };
      let activeScheduledRuns = await fetchInProgressScheduledRuns();
      const runs = await annotateQueueEvictions({
        runs: mergeWorkflowRunBatches(batches),
        fetchJobsFn: (runId) => fetchRunJobs({ token, owner, repo, runId }),
      });
      let evaluated = evaluateWorkflow(workflow, runs, { activeScheduledRuns });
      if (needsMissedWindowReverification(evaluated)) {
        const verifyBatches = [];
        for (const event of fetchEvents) {
          verifyBatches.push(await fetchWorkflowRuns({
            token,
            owner,
            repo,
            file: workflow.file,
            branch,
            event,
            perPage: 100,
          }));
        }
        activeScheduledRuns = await fetchInProgressScheduledRuns();
        evaluated = evaluateWorkflow(workflow, await annotateQueueEvictions({
          runs: mergeWorkflowRunBatches([...batches, ...verifyBatches]),
          fetchJobsFn: (runId) => fetchRunJobs({ token, owner, repo, runId }),
        }), { activeScheduledRuns });
      }
      workflows.push(evaluated);
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

  const classifiedWorkflows = workflows;
  const workflowAlarms = classifiedWorkflows.filter((w) => w.status === "alarm");
  const kpiAlarm = dataHealthKpi.status === "alarm"
    ? {
        label: "Data stopped advancing",
        kpi_stopped_sets: dataHealthKpi.stopped_sets,
        latest_generated_at: dataHealthKpi.latest_generated_at,
        previous_generated_at: dataHealthKpi.previous_generated_at,
      }
    : null;
  const alarms = [...workflowAlarms, ...(kpiAlarm ? [kpiAlarm] : [])];
  const unknowns = classifiedWorkflows.filter((w) => w.status === "unknown");
  const status = alarms.length > 0
    ? "alarm"
    : unknowns.length > 0 || dataHealthKpi.status === "unknown" ? "unknown" : "ok";

  const blindness = classifyAlarmBlindness({
    watched: classifiedWorkflows.length,
    unknown: unknowns.length,
  });
  const result = {
    ...base,
    status: blindness.blind ? "blind" : status,
    blind: blindness.blind,
    blind_reason: blindness.reason,
    workflows: classifiedWorkflows,
  };
  if (alarms.length > 0) {
    result.issueBody = buildIssueBody(alarms);
  }
  if (blindness.blind) {
    const blindBody = buildBlindnessBody({
      watched: classifiedWorkflows.length,
      unknown: unknowns.length,
      unknownWorkflows: unknowns,
    });
    // Blindness leads: an incident list assembled while most of the estate was
    // unreadable must not be presented as the whole picture.
    result.issueBody = result.issueBody ? `${blindBody}\n\n---\n\n${result.issueBody}` : blindBody;
  }
  writeJson(resultPath, result);

  console.log(
    classifiedWorkflows
      .map((w) => `${w.file}=${w.status}${w.streak !== undefined ? `(streak ${w.streak})` : ""}`)
      .join(" "),
  );

  process.exit(alarms.length > 0 || blindness.blind ? ALERT_EXIT : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
