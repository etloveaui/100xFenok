#!/usr/bin/env node
/**
 * Emit the privacy-filtered lane projection used by the owner Data Lab.
 *
 * The projection is deliberately not a second registry. Lane metadata comes
 * from the registry; control_room_state is a derived, public-safe join over
 * the calendar, KPI, attempt, recovery, and alarm evidence already committed
 * by their owning producers. Private run IDs and URLs stay server-only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import { matchesDayWeekday } from "./lib/schedule-day-weekday.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(REPO_ROOT, "data", "admin", "lane-registry-projection.json");
const PUBLIC_OUT_PATH = path.join(
  REPO_ROOT,
  "100xfenok-next",
  "public",
  "data",
  "admin",
  "lane-registry-projection.json",
);
const CALENDAR_PATH = path.join(REPO_ROOT, "scripts", "lib", "data-supply-detection-calendars.json");
const KPI_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-data-health-kpi.json");
const ALARM_PATH = path.join(REPO_ROOT, "data", "admin", "alarm-state.json");

export const PROJECTION_SCHEMA = "lane-registry-projection/v2";
export const CONTROL_ROOM_STATE_KEYS = Object.freeze([
  "incident",
  "latest_attempt",
  "queue",
  "recovery",
  "schedule",
  "source",
]);

// The provider registry has 26 external-data lanes and six lanes whose
// ownership is an owner-managed, proxy, runtime, or storage boundary. Those
// six are the control-room slice. The selection is derived from provider
// classes, never duplicated as a lane-id list.
export const CONTROL_ROOM_PROVIDER_CLASSES = Object.freeze([
  "owner_managed_data",
  "platform_proxy",
  "platform_runtime",
  "platform_storage",
]);

const CONTROL_ROOM_CLASSES = new Set(CONTROL_ROOM_PROVIDER_CLASSES);
const ATTEMPT_OUTCOMES = new Set(["success", "failed", "provider_wait", "unobserved", "unknown"]);
const FAILURE_CLASSES = new Set([
  "transport",
  "http",
  "rate_limited",
  "decode",
  "assertion",
  "provider_unsupported",
  "queue",
  "unknown",
]);
const SCHEDULE_STATUSES = new Set(["on_time", "overdue", "not_due", "unobserved"]);
const RECOVERY_STATES = new Set([
  "fresh_primary",
  "retained_lkg",
  "retry_pending",
  "provider_wait",
  "terminal",
  "unavailable",
]);
const INCIDENT_CLASSES = new Set(["engineering", "provider_wait", "queue", "unknown"]);
const QUEUE_EVIDENCE = new Set(["measured", "count_only", "unavailable"]);
const SOURCE_EVIDENCE = new Set(["observed", "not_instrumented", "unavailable"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const LANE_SOURCE_MAP = Object.freeze({
  // No canonical source-SLA row exists for these six boundaries today. Keep
  // the map explicit so a future source contract is an intentional change.
  yahoo_ticker_macro: {
    source_id: null,
    source_artifact: "data/admin/yahoo-hourly-ticker/index.json",
    source_artifact_keys_path: ["keys", "*"],
    source_artifact_dir: "data/admin/yahoo-hourly-ticker/keys",
    source_date_path: ["current", "source_as_of"],
    source_date_reason: "yahoo_hourly_ticker.current.source_as_of.oldest",
    no_source_reason: "yahoo hourly ticker current source_as_of is unavailable",
  },
  sentiment: {
    source_id: null,
    source_artifact: "data/admin/sentiment/index.json",
    source_date_path: ["items", "*", "current", "source_as_of"],
    source_date_reason: "sentiment_index.items.current.source_as_of.oldest",
    no_source_reason: "sentiment current source_as_of is unavailable",
  },
  admin_live_voice_logs: {
    source_id: null,
    no_source_evidence_status: "not_instrumented",
    no_source_reason: "not_instrumented: local runtime has no committed public-safe source stamp",
  },
  mona_production_study_state: {
    source_id: null,
    no_source_evidence_status: "not_instrumented",
    no_source_reason: "not_instrumented: owner SSOT runtime has no committed public-safe source stamp",
  },
  mona_vnext_kv: {
    source_id: null,
    no_source_evidence_status: "not_instrumented",
    no_source_reason: "not_instrumented: KV runtime has no committed public-safe source stamp",
  },
  global_scouter: {
    source_id: null,
    source_artifact: "data/global-scouter/core/metadata.json",
    source_date_field: "source_date",
    source_date_reason: "global_scouter_metadata.source_date",
    no_source_reason: "global_scouter metadata source_date is unavailable",
  },
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function finiteNonNegative(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeIso(value, { allowDate = true } = {}) {
  if (typeof value !== "string") return null;
  if (ISO_DATE.test(value) && allowDate) return value;
  if (!ISO_UTC.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? value : null;
}

function basename(value) {
  return typeof value === "string" && value.length > 0 ? path.posix.basename(value) : null;
}

function providerMap(providerRecords) {
  return new Map((Array.isArray(providerRecords) ? providerRecords : []).map((provider) => [provider.id, provider]));
}

export function isControlRoomLane(lane, providerRecords = LANE_REGISTRY.providers) {
  const providers = providerMap(providerRecords);
  return Array.isArray(lane?.provider_refs)
    && lane.provider_refs.some((ref) => CONTROL_ROOM_CLASSES.has(providers.get(ref.provider_id)?.class));
}

function projectCadence(lane, providers) {
  const providerLabels = (lane.provider_refs || []).map((ref) => providers.get(ref.provider_id)?.label);
  if (providerLabels.some((label) => typeof label !== "string" || label.length === 0)) {
    throw new Error(`lane-registry projection: unresolved provider for lane ${lane.id}`);
  }
  return {
    kind: lane.cadence?.kind ?? "unknown",
    provider: providerLabels.join(" + "),
  };
}

function parseCronField(raw, min, max) {
  const values = new Set();
  for (const token of String(raw).split(",")) {
    const [base, stepText] = token.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isSafeInteger(step) || step < 1) return null;
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
      return null;
    }
    if (start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

function parseCron(cron) {
  const fields = typeof cron === "string" ? cron.trim().split(/\s+/) : [];
  if (fields.length !== 5) return null;
  const minute = parseCronField(fields[0], 0, 59);
  const hour = parseCronField(fields[1], 0, 23);
  const day = parseCronField(fields[2], 1, 31);
  const month = parseCronField(fields[3], 1, 12);
  const weekday = parseCronField(fields[4], 0, 6);
  if (!minute || !hour || !day || !month || !weekday) return null;
  return {
    minute,
    hour,
    day,
    month,
    weekday,
    dayWildcard: fields[2] === "*",
    weekdayWildcard: fields[4] === "*",
  };
}

const calendarFormatters = new Map();

function calendarParts(epoch, timezone) {
  let formatter = calendarFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    calendarFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(epoch))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const ordinal = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: new Date(ordinal * 86_400_000).getUTCDay(),
    iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function cronMatches(epoch, parsed, calendar, schedule) {
  const utc = calendarParts(epoch, "UTC");
  const local = calendarParts(epoch, calendar.timezone);
  if (!parsed.minute.has(utc.minute) || !parsed.hour.has(utc.hour) || !parsed.month.has(local.month)) return false;
  const dayMatch = parsed.day.has(local.day);
  const weekdayMatch = parsed.weekday.has(local.weekday);
  return matchesDayWeekday({
    dayMatch,
    weekdayMatch,
    dayWildcard: parsed.dayWildcard,
    weekdayWildcard: parsed.weekdayWildcard,
    dayWeekdayMode: schedule?.day_weekday_mode,
    isHoliday: calendar.holidays?.includes(local.iso) ?? false,
  });
}

function findOccurrence(schedule, calendar, fromEpoch, direction) {
  const parsed = parseCron(schedule?.cron);
  if (!parsed || !calendar?.timezone) return null;
  const step = direction > 0 ? 60_000 : -60_000;
  let cursor = Math.floor(fromEpoch / 60_000) * 60_000;
  if (direction > 0) cursor += 60_000;
  const boundary = cursor + direction * 400 * 86_400_000;
  while (direction > 0 ? cursor <= boundary : cursor >= boundary) {
    if (cronMatches(cursor, parsed, calendar, schedule)) return cursor;
    cursor += step;
  }
  return null;
}

function normalizeScheduleRows(lane, context) {
  const workflow = basename(lane.owner_workflow);
  if (!workflow) return [];
  const explicit = context.workflowSchedules?.[workflow];
  let declarations = Array.isArray(explicit) ? explicit : null;
  if (!declarations) {
    const workflowPath = path.join(context.repoRoot, lane.owner_workflow);
    const source = (() => {
      try {
        return fs.readFileSync(workflowPath, "utf8");
      } catch {
        return "";
      }
    })();
    declarations = [...source.matchAll(/^\s*-\s*cron:\s*["']([^"']+)["']/gm)].map((match) => ({ cron: match[1] }));
  }
  const calendars = context.calendars?.calendars || [];
  const schedules = context.calendars?.schedules || [];
  return declarations.map((declaration) => {
    const cron = declaration?.cron;
    const calendarId = declaration?.calendar_id || declaration?.calendarId;
    const matches = schedules.filter((row) => row.cron === cron && (!calendarId || row.calendar_id === calendarId));
    const contract = declaration?.schedule_id
      ? schedules.find((row) => row.id === declaration.schedule_id)
      : matches.length === 1 ? matches[0] : null;
    const resolvedCalendarId = contract?.calendar_id || calendarId || null;
    const calendar = calendars.find((row) => row.id === resolvedCalendarId) || null;
    if (!contract || !calendar) return null;
    return { ...contract, calendar };
  }).filter(Boolean);
}

function latestAndNextSchedule(scheduleRows, nowEpoch) {
  if (scheduleRows.length === 0) return { latest: null, next: null };
  const latestValues = scheduleRows.map((row) => findOccurrence(row, row.calendar, nowEpoch, -1)).filter(Number.isFinite);
  const nextValues = scheduleRows.map((row) => findOccurrence(row, row.calendar, nowEpoch, 1)).filter(Number.isFinite);
  return {
    latest: latestValues.length > 0 ? Math.max(...latestValues) : null,
    next: nextValues.length > 0 ? Math.min(...nextValues) : null,
  };
}

function readAttemptRows(lane, context) {
  const provided = context.attempts?.[lane.id];
  if (Array.isArray(provided)) return provided;
  if (isObject(provided) && Array.isArray(provided.attempts)) return provided.attempts;
  const relative = lane.roots?.detection_attempt;
  if (!relative) return [];
  const document = readJson(path.join(context.repoRoot, relative));
  return Array.isArray(document?.attempts) ? document.attempts : [];
}

function latestAttempt(rows) {
  const valid = rows.filter((row) => safeIso(row?.observed_at, { allowDate: false }));
  return [...valid].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0] || null;
}

function failedAssertion(row) {
  return Array.isArray(row?.assertions) && row.assertions.some((assertion) => assertion?.passed === false);
}

function normalizeAttempt(row) {
  if (!row) return { observed_at: null, outcome: "unobserved", failure_class: null };
  const observedAt = safeIso(row.observed_at, { allowDate: false });
  if (row.execution === "unobserved") return { observed_at: observedAt, outcome: "unobserved", failure_class: null };
  const providerUnsupported = [row.exception_kind, row.retry_reason, row.outcome].includes("provider_unsupported");
  if (providerUnsupported) return { observed_at: observedAt, outcome: "provider_wait", failure_class: "provider_unsupported" };
  if (row.outcome === "no_fallback_candidates") return { observed_at: observedAt, outcome: "provider_wait", failure_class: "provider_unsupported" };
  if (row.rate_limited === true || row.http_status === 429) return { observed_at: observedAt, outcome: "failed", failure_class: "rate_limited" };
  if (row.exception_kind === "transport") return { observed_at: observedAt, outcome: "failed", failure_class: "transport" };
  if (row.http_status !== null && row.http_status !== undefined && (row.http_status < 200 || row.http_status >= 300)) {
    return { observed_at: observedAt, outcome: "failed", failure_class: "http" };
  }
  if (row.decode === "error") return { observed_at: observedAt, outcome: "failed", failure_class: "decode" };
  if (failedAssertion(row)) return { observed_at: observedAt, outcome: "failed", failure_class: "assertion" };
  if (row.outcome === "error" || row.execution === "threw" || row.payload === "empty") {
    return { observed_at: observedAt, outcome: "failed", failure_class: "unknown" };
  }
  if (row.execution === "returned" || row.outcome === "success" || row.outcome === undefined) {
    return { observed_at: observedAt, outcome: "success", failure_class: null };
  }
  return { observed_at: observedAt, outcome: "unknown", failure_class: "unknown" };
}

function kpiLaneFor(lane, context) {
  return (context.kpi?.lanes || []).find((candidate) => candidate?.id === lane.id) || null;
}

function sourceArtifactsFor(lane, mapping, context) {
  const provided = context.sourceArtifacts;
  if (isObject(provided) && Object.prototype.hasOwnProperty.call(provided, lane.id)) {
    const value = provided[lane.id];
    return Array.isArray(value) ? value : [value];
  }
  if (mapping.source_artifact_keys_path && mapping.source_artifact_dir) {
    const index = readJson(path.join(context.repoRoot, mapping.source_artifact));
    const keys = collectSourceDateValues(index, mapping.source_artifact_keys_path)
      .filter((value) => typeof value === "string" && value.length > 0);
    return keys
      .map((key) => readJson(path.join(context.repoRoot, mapping.source_artifact_dir, key)))
      .filter(Boolean);
  }
  return mapping.source_artifact
    ? [readJson(path.join(context.repoRoot, mapping.source_artifact))]
    : [];
}

function collectSourceDateValues(value, pathSegments) {
  if (pathSegments.length === 0) return [value];
  if (value === null || value === undefined) return [];
  const [segment, ...rest] = pathSegments;
  if (segment === "*") {
    if (!isObject(value) && !Array.isArray(value)) return [];
    return Object.values(value).flatMap((child) => collectSourceDateValues(child, rest));
  }
  return collectSourceDateValues(value?.[segment], rest);
}

function oldestSourceDate(values) {
  const valid = values
    .map((value) => safeIso(value))
    .filter(Boolean)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return valid[0] || null;
}

function buildSourceState(lane, context, kpiLane) {
  const mapping = LANE_SOURCE_MAP[lane.id] || { source_id: null, no_source_reason: "source SLA is not declared" };
  const sourceSla = mapping.source_id
    ? (context.kpi?.source_sla || []).find((row) => row?.source_id === mapping.source_id) || null
    : null;
  const sourceArtifacts = sourceArtifactsFor(lane, mapping, context);
  const artifactSourceDate = mapping.source_date_field
    ? oldestSourceDate(sourceArtifacts.map((artifact) => artifact?.[mapping.source_date_field]))
    : Array.isArray(mapping.source_date_path)
      ? oldestSourceDate(sourceArtifacts.flatMap((artifact) => collectSourceDateValues(artifact, mapping.source_date_path)))
      : null;
  const sourceDate = mapping.no_source_evidence_status === "not_instrumented"
    ? null
    : mapping.source_artifact
      ? artifactSourceDate
      : safeIso(kpiLane?.as_of) || null;
  const evidenceStatus = artifactSourceDate || sourceDate
    ? "observed"
    : mapping.no_source_evidence_status || "unavailable";
  return {
    source_date: sourceDate,
    source_date_reason: artifactSourceDate
      ? mapping.source_date_reason
      : sourceDate ? "kpi_lane_as_of" : mapping.no_source_reason,
    evidence_status: SOURCE_EVIDENCE.has(evidenceStatus) ? evidenceStatus : "unavailable",
    sla: sourceSla ? {
      unit: sourceSla.unit,
      calendar: sourceSla.calendar,
      max_staleness: sourceSla.max_staleness,
      age: finiteNonNegative(sourceSla.age),
      status: typeof sourceSla.status === "string" ? sourceSla.status : "unknown",
    } : null,
  };
}

function buildRecoveryState(kpiLane, attempt) {
  const details = kpiLane?.details;
  const nested = isObject(details?.recovery) ? details.recovery : null;
  const retrySet = Array.isArray(details?.recovery_retry_set)
    ? details.recovery_retry_set
    : Array.isArray(nested?.retry_keys) ? nested.retry_keys : null;
  const recovered = Array.isArray(details?.recovery_recovered)
    ? details.recovery_recovered
    : Array.isArray(nested?.recovery_details) ? nested.recovery_details : null;
  let state = "unavailable";
  if (retrySet && retrySet.length > 0) state = "retry_pending";
  else if (recovered && recovered.length > 0) {
    state = recovered.some((row) => row?.resolution_state === "fresh_primary") ? "fresh_primary" : "retained_lkg";
  } else if (attempt.outcome === "provider_wait") state = "provider_wait";
  const lastRecovered = recovered?.filter((row) => safeIso(row?.recovered_at, { allowDate: false }))
    .sort((a, b) => Date.parse(b.recovered_at) - Date.parse(a.recovered_at))[0] || null;
  return {
    state,
    retry_count: retrySet ? retrySet.length : null,
    recovered_at: safeIso(lastRecovered?.recovered_at, { allowDate: false }),
    lkg_source_date: safeIso(lastRecovered?.lkg_source_as_of || lastRecovered?.source_as_of),
  };
}

function safeIncidentClass(value) {
  return INCIDENT_CLASSES.has(value) ? value : null;
}

function buildIncidentState(lane, context) {
  const workflow = basename(lane.owner_workflow);
  const matching = (context.alarm?.open_incidents || []).filter((incident) => incident?.workflow === workflow);
  const incident = matching[0] || null;
  return {
    status: incident ? "open" : context.alarm?.status === "clear" ? "clear" : "unknown",
    workflow,
    class: safeIncidentClass(incident?.class),
  };
}

function buildQueueState(lane, context) {
  const workflow = basename(lane.owner_workflow);
  const evidence = context.queue?.[lane.id] || (workflow ? context.queue?.[workflow] : null);
  const status = QUEUE_EVIDENCE.has(evidence?.evidence_status) ? evidence.evidence_status : "unavailable";
  return {
    evidence_status: status,
    wait_ms: status === "measured" ? finiteNonNegative(evidence?.wait_ms) : null,
    depth: status === "unavailable" ? null : finiteNonNegative(evidence?.depth),
  };
}

function buildScheduleState(lane, context, attempt) {
  const workflow = basename(lane.owner_workflow);
  const rows = normalizeScheduleRows(lane, context);
  const nowEpoch = Date.parse(context.now);
  const { latest, next } = latestAndNextSchedule(rows, nowEpoch);
  const observedEpoch = attempt.observed_at ? Date.parse(attempt.observed_at) : NaN;
  let status = "unobserved";
  if (rows.length === 0) status = "unobserved";
  else if (latest === null) status = "not_due";
  else if (!Number.isFinite(observedEpoch) || observedEpoch > nowEpoch) status = "unobserved";
  else status = observedEpoch >= latest ? "on_time" : "overdue";
  const calendarIds = [...new Set(rows.map((row) => row.calendar_id))];
  const crons = [...new Set(rows.map((row) => row.cron))];
  const grace = rows.length === 1 ? rows[0].grace : null;
  return {
    workflow,
    cron: crons.length === 1 ? crons[0] : crons.length > 1 ? crons : null,
    calendar_id: calendarIds.length === 1 ? calendarIds[0] : null,
    grace,
    latest_expected_slot: latest === null ? null : new Date(latest).toISOString(),
    next_expected_slot: next === null ? null : new Date(next).toISOString(),
    status: SCHEDULE_STATUSES.has(status) ? status : "unobserved",
  };
}

export function buildControlRoomState(lane, context = {}) {
  const normalizedContext = createProjectionContext(context);
  const kpiLane = kpiLaneFor(lane, normalizedContext);
  const attempt = normalizeAttempt(latestAttempt(readAttemptRows(lane, normalizedContext)));
  const state = {
    schedule: buildScheduleState(lane, normalizedContext, attempt),
    latest_attempt: attempt,
    source: buildSourceState(lane, normalizedContext, kpiLane),
    recovery: buildRecoveryState(kpiLane, attempt),
    incident: buildIncidentState(lane, normalizedContext),
    queue: buildQueueState(lane, normalizedContext),
  };
  // Keep this assertion local so a future field cannot silently become a
  // public/private boundary regression.
  if (Object.keys(state).sort().join("\0") !== [...CONTROL_ROOM_STATE_KEYS].sort().join("\0")) {
    throw new Error(`control-room state shape changed for ${lane.id}`);
  }
  if (!ATTEMPT_OUTCOMES.has(state.latest_attempt.outcome)
    || (state.latest_attempt.failure_class !== null && !FAILURE_CLASSES.has(state.latest_attempt.failure_class))
    || !RECOVERY_STATES.has(state.recovery.state)) {
    throw new Error(`control-room state enum invalid for ${lane.id}`);
  }
  return state;
}

function createProjectionContext(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const now = safeIso(options.now, { allowDate: false }) || new Date().toISOString();
  return {
    ...options,
    repoRoot,
    now,
    calendars: options.calendars || readJson(CALENDAR_PATH) || { calendars: [], schedules: [] },
    kpi: options.kpi || readJson(path.join(repoRoot, path.relative(REPO_ROOT, KPI_PATH))),
    alarm: options.alarm || readJson(path.join(repoRoot, path.relative(REPO_ROOT, ALARM_PATH))),
    queue: options.queue || {},
    sourceArtifacts: options.sourceArtifacts || {},
    workflowSchedules: options.workflowSchedules || {},
  };
}

// The ONLY metadata fields crossing the public boundary. Paths and private
// execution identities are intentionally absent; control_room_state itself is
// a redacted operational projection and contains no run IDs or URLs.
export function projectLane(lane, providerRecords = LANE_REGISTRY.providers, context = {}) {
  const providers = providerMap(providerRecords);
  const projected = {
    id: lane.id,
    label: lane.label,
    store_kind: lane.store_kind,
    cadence: projectCadence(lane, providers),
    enforcement: lane.enforcement,
    privacy_class: lane.privacy_class,
    owner_workflow: lane.owner_workflow ? basename(lane.owner_workflow) : null,
  };
  if (isControlRoomLane(lane, providerRecords)) {
    projected.control_room_state = buildControlRoomState(lane, context);
  }
  return projected;
}

export function buildLaneRegistryProjection(registry = LANE_REGISTRY, options = {}) {
  const context = createProjectionContext(options);
  return {
    schema_version: PROJECTION_SCHEMA,
    generated_at: context.now,
    source_schema_version: registry.schema_version,
    purpose:
      "Admin-safe lane metadata and derived control-room projection for the owner data dashboard. No store roots, attempt/recovery paths, run identities, or repository directory structure.",
    lane_count: registry.lanes.length,
    lanes: registry.lanes.map((lane) => projectLane(lane, registry.providers, context)),
  };
}

function main() {
  const projection = buildLaneRegistryProjection();
  const json = `${JSON.stringify(projection, null, 2)}\n`;
  for (const target of [OUT_PATH, PUBLIC_OUT_PATH]) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
  }
  console.log(
    `lane-registry projection: ${projection.lanes.length} lanes -> ${path.relative(REPO_ROOT, OUT_PATH)} (+ public mirror)`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
