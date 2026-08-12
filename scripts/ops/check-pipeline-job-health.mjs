import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "../lib/data-supply-detection-config.mjs";
import { TRACKED_CRONS } from "../lib/kpi-contract-constants.mjs";
import { classifyRuntimeSlots } from "../lib/kpi-runtime-slots.mjs";
import { PLANE_PUBLISH_OUTCOME_BINDINGS } from "../lib/lane-registry.mjs";
import {
  PUBLISH_OUTCOME_SHARD_SCHEMA,
  validatePublishOutcomeShard,
} from "../lib/publish-outcome-shard.mjs";

export { PLANE_PUBLISH_OUTCOME_BINDINGS };

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
export const PUBLISH_OUTCOME_ROOT = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "publish-outcomes");
export const CADENCE_STATES = Object.freeze(["not_due", "overdue", "recovered", "no_declaration", "unknown"]);
export const PLANE_PUBLISH_ALARM_REASONS = Object.freeze({
  gate_blocked: "plane_publish_gate_blocked",
  failed: "plane_publish_failed",
});
const PLANE_PUBLISH_SUCCESS_RESULTS = new Set(["published", "resumed"]);

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

function publishOutcomeRecords(shard) {
  if (!shard || typeof shard !== "object" || Array.isArray(shard)) return null;
  // Only the writer's canonical schema is readable. A different, missing or
  // legacy schema_version must yield no projection: the alarm must never
  // reason about shapes the writer does not produce (no invented alarms).
  if (shard.schema_version !== PUBLISH_OUTCOME_SHARD_SCHEMA) return null;
  if (Array.isArray(shard.records)) return shard.records;
  return null;
}

/**
 * Read the newest valid outcome from one per-family shard. A missing or
 * malformed shard returns null so the existing workflow alarm stays the sole
 * source of truth for that evaluation.
 */
export function latestPublishOutcomeFromShard(shard, family) {
  if (typeof family !== "string" || family.length === 0) return null;
  const records = publishOutcomeRecords(shard);
  if (!records || records.length === 0) return null;
  try {
    validatePublishOutcomeShard(shard, family);
  } catch {
    return null;
  }
  return records.reduce((latest, record) => {
    if (!latest) return record;
    const latestAt = Date.parse(latest.observed_at);
    const recordAt = Date.parse(record.observed_at);
    return recordAt >= latestAt ? record : latest;
  }, null);
}

function shardForFamily(shards, family) {
  if (shards instanceof Map) return shards.get(family) ?? null;
  return shards && typeof shards === "object" ? shards[family] ?? null : null;
}

/**
 * Join family-named outcome shards to the workflow files that own their
 * publication. The returned Map is intentionally pure/testable and contains
 * only valid latest records.
 */
export function derivePublishOutcomeProjection({
  shards = {},
  bindings = PLANE_PUBLISH_OUTCOME_BINDINGS,
} = {}) {
  const projection = new Map();
  for (const [family, binding] of Object.entries(bindings ?? {})) {
    const latest = latestPublishOutcomeFromShard(shardForFamily(shards, family), family);
    if (!latest || !binding || typeof binding.workflow !== "string") continue;
    projection.set(path.basename(binding.workflow), {
      ...latest,
      family,
      lane_id: binding.lane_id,
      workflow: binding.workflow,
    });
  }
  return projection;
}

export function readPublishOutcomeProjection({
  root = PUBLISH_OUTCOME_ROOT,
  bindings = PLANE_PUBLISH_OUTCOME_BINDINGS,
} = {}) {
  const shards = {};
  for (const family of Object.keys(bindings ?? {})) {
    shards[family] = readJsonOrNull(path.join(root, `${family}.json`));
  }
  return derivePublishOutcomeProjection({ shards, bindings });
}

function projectedOutcomeForWorkflow(projection, workflowFile) {
  if (projection instanceof Map) return projection.get(workflowFile) ?? null;
  return projection && typeof projection === "object" ? projection[workflowFile] ?? null : null;
}

/**
 * Add the latest plane publication assertion to the existing workflow alarm
 * result. A successful publish removes only the two additive plane reasons;
 * all canonical failure, schedule, and cadence reasons remain untouched.
 */
export function attachPublishOutcomeAlarms(workflows, projection) {
  if (!Array.isArray(workflows)) return workflows;
  return workflows.map((workflow) => {
    const outcome = projectedOutcomeForWorkflow(projection, workflow?.file);
    const alarmReasons = Array.isArray(workflow?.alarm_reasons)
      ? [...new Set(workflow.alarm_reasons)]
      : [];
    const planeReasons = new Set(Object.values(PLANE_PUBLISH_ALARM_REASONS));
    if (outcome?.result === "gate_blocked") {
      alarmReasons.splice(0, alarmReasons.length, ...alarmReasons.filter((reason) => reason !== PLANE_PUBLISH_ALARM_REASONS.failed));
      if (!alarmReasons.includes(PLANE_PUBLISH_ALARM_REASONS.gate_blocked)) {
        alarmReasons.push(PLANE_PUBLISH_ALARM_REASONS.gate_blocked);
      }
    } else if (outcome?.result === "failed") {
      alarmReasons.splice(0, alarmReasons.length, ...alarmReasons.filter((reason) => reason !== PLANE_PUBLISH_ALARM_REASONS.gate_blocked));
      if (!alarmReasons.includes(PLANE_PUBLISH_ALARM_REASONS.failed)) {
        alarmReasons.push(PLANE_PUBLISH_ALARM_REASONS.failed);
      }
    } else if (PLANE_PUBLISH_SUCCESS_RESULTS.has(outcome?.result)) {
      alarmReasons.splice(0, alarmReasons.length, ...alarmReasons.filter((reason) => !planeReasons.has(reason)));
    }
    const planeAlarm = outcome?.result === "gate_blocked" || outcome?.result === "failed";
    const alarming = workflow?.alarming === true || planeAlarm;
    return {
      ...workflow,
      ...(outcome ? { plane_publish_outcome: outcome } : {}),
      status: alarming ? "alarm" : workflow.status,
      alarming,
      alarm_reasons: alarmReasons,
    };
  });
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

export function runtimeSlotKey(workflow, cron, expectedAt) {
  if (typeof expectedAt !== "string" || expectedAt.length === 0) return null;
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
 * An overdue slot is already beyond its declared grace window, so it is an
 * independent paging reason even when the latest completed run is green.
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
  const preActivationBindings = new Set();
  if (coverageRows) {
    for (const row of coverageRows) {
      const workflow = workflowFileFromDeclaration(row?.workflow);
      if (!workflow || typeof row?.cron !== "string" || typeof row?.member_id !== "string") continue;
      coverageByBinding.set(`${workflow}\u0000${row.cron}\u0000${row.member_id}`, row);
    }
    for (const row of Array.isArray(coverage?.pre_activation_members)
      ? coverage.pre_activation_members
      : []) {
      const workflow = workflowFileFromDeclaration(row?.workflow);
      if (!workflow || typeof row?.cron !== "string" || typeof row?.member_id !== "string") continue;
      preActivationBindings.add(`${workflow}\u0000${row.cron}\u0000${row.member_id}`);
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
      const rows = [];
      let hasUnknownBinding = false;
      for (const entry of declared) {
        const key = `${entry.workflow}\u0000${entry.cron}\u0000${entry.member_id}`;
        const row = coverageByBinding.get(key);
        if (row) rows.push(row);
        else if (!preActivationBindings.has(key)) hasUnknownBinding = true;
      }
      if (hasUnknownBinding) {
        state = "unknown";
      } else if (rows.length === 0) {
        state = "not_due";
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
    const alarmReasons = Array.isArray(workflow.alarm_reasons)
      ? [...new Set(workflow.alarm_reasons)]
      : [];
    if (cadence.state === "overdue" && !alarmReasons.includes("unrecovered_overdue")) {
      alarmReasons.push("unrecovered_overdue");
    }
    const alarming = workflow.alarming === true || cadence.state === "overdue";
    return {
      ...workflow,
      status: alarming ? "alarm" : workflow.status,
      alarming,
      alarm_reasons: alarmReasons,
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

export function isLostScheduledSlot(run) {
  return run?.event === "schedule"
    && (run?.jobs_empty === true || run?.queue_evicted === true);
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
  const base = {
    file: workflow.file,
    label: workflow.label,
    streak,
    failure_streak_threshold: failureStreakThreshold,
    alarming: alarmReasons.length > 0,
    alarm_reasons: alarmReasons,
    latestRunUrl: latest?.html_url || null,
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

function buildIssueBody(alarms) {
  const lines = [
    "[alert] Pipeline health incidents detected.",
    "",
    "A watched workflow lost a scheduled slot, remained overdue after its documented grace,",
    "or reached its cadence-calibrated failure threshold.",
    "",
  ];
  for (const alarm of alarms) {
    lines.push(`## ${alarm.label} (\`${alarm.file}\`)`);
    const reasons = Array.isArray(alarm.alarm_reasons) ? alarm.alarm_reasons : [];
    lines.push(`- Alarm reasons: ${reasons.join(", ") || "unknown"}`);
    if (reasons.includes("lost_schedule_slot")) {
      lines.push(`- Lost scheduled slots: ${alarm.lost_schedule_slot_count ?? 0}`);
      for (const url of alarm.lost_schedule_slot_run_urls ?? []) {
        lines.push(`- Lost scheduled run URL: ${url}`);
      }
    }
    if (reasons.includes("unrecovered_overdue")) {
      lines.push("- Declared cadence remains overdue after its documented grace.");
    }
    if (reasons.includes(PLANE_PUBLISH_ALARM_REASONS.gate_blocked)) {
      lines.push("- Plane publication was blocked by the cost gate.");
    }
    if (reasons.includes(PLANE_PUBLISH_ALARM_REASONS.failed)) {
      lines.push("- Plane publication failed after the workflow completed.");
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
  const calendars = readJsonOrNull(DETECTION_CALENDARS_PATH);
  const kpi = readJsonOrNull(KPI_PATH);
  const publishOutcomeProjection = readPublishOutcomeProjection();
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
      workflows: attachPublishOutcomeAlarms(
        attachWorkflowCadence(
          policy.watched.map((workflow) => ({
            file: workflow.file,
            label: workflow.label,
            events: workflow.events,
            status: "unknown",
            message: "GitHub workflow runs were not evaluated because GITHUB_REPOSITORY is not set.",
          })),
          cadenceProjection,
        ),
        publishOutcomeProjection,
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
      // workflow_dispatch is fetched even when it is not a counted event:
      // evaluateWorkflow uses dispatch successes purely as lost-slot recovery
      // evidence, never for streak or alarm counting.
      const fetchEvents = workflow.events.includes("workflow_dispatch")
        ? workflow.events
        : [...workflow.events, "workflow_dispatch"];
      for (const event of fetchEvents) {
        batches.push(await fetchCompletedRuns({
          token,
          owner,
          repo,
          file: workflow.file,
          branch,
          event,
        }));
      }
      const runs = await annotateQueueEvictions({
        runs: mergeWorkflowRunBatches(batches),
        fetchJobsFn: (runId) => fetchRunJobs({ token, owner, repo, runId }),
      });
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

  const classifiedWorkflows = attachPublishOutcomeAlarms(
    attachWorkflowCadence(workflows, cadenceProjection),
    publishOutcomeProjection,
  );
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
