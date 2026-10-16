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
import { briefingPublishedAt } from "./lib/fenok-data-health-freshness.mjs";

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
export const DEFAULT_PROJECTION_OUTPUT_PATHS = Object.freeze([OUT_PATH, PUBLIC_OUT_PATH]);
const CALENDAR_PATH = path.join(REPO_ROOT, "scripts", "lib", "data-supply-detection-calendars.json");
const KPI_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-data-health-kpi.json");
const ALARM_PATH = path.join(REPO_ROOT, "data", "admin", "alarm-state.json");

export const PROJECTION_SCHEMA = "lane-registry-projection/v2";
export const CONTROL_ROOM_STATE_KEYS = Object.freeze([
  "coverage",
  "incident",
  "latest_attempt",
  "queue",
  "recovery",
  "schedule",
  "source",
]);

const ATTEMPT_OUTCOMES = new Set(["success", "partial", "retained", "failed", "provider_wait", "unobserved", "unknown"]);
// The shared producer stores several acquisition contracts in one index.
const STOCKANALYSIS_KINDS = Object.freeze({
  stockanalysis_etf_universe: ["universe"],
  stockanalysis_etf_detail: ["etf"],
  stockanalysis_stock_financial: ["stock", "financial"],
  stockanalysis_surfaces: ["surface"],
});
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
  if (lane.external_timer) {
    let source = "";
    try { source = fs.readFileSync(path.join(context.repoRoot, lane.external_timer), "utf8"); } catch {}
    const daily = source.match(/^OnCalendar=\*-\*-\* (\d{2}):(\d{2}):00 UTC$/m);
    const calendar = context.calendars?.calendars?.find((row) => row.id === "utc");
    const status = readJson(path.join(context.repoRoot, lane.external_status));
    return daily && calendar ? [{
      cron: `${Number(daily[2])} ${Number(daily[1])} * * *`,
      calendar_id: "utc", calendar,
      grace: Number.isFinite(status?.grace_hours) ? { unit: "hours", value: status.grace_hours } : null,
    }] : [];
  }
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

function recoveryStoreFor(lane, context) {
  if (context.recoveryStores) return context.recoveryStores[lane.id] || null;
  return lane.recovery_store ? readJson(path.join(context.repoRoot, lane.recovery_store)) : null;
}

function countAttempt(row) {
  if (!safeIso(row?.observed_at, { allowDate: false }) || !(row.attempted > (row.skipped || 0))) return null;
  return {
    observed_at: row.observed_at,
    outcome: !Number.isInteger(row.failed) || !Number.isInteger(row.successes) ? "unknown"
      : row.failed > 0 ? row.successes > 0 ? "partial" : "failed"
        : row.successes > 0 ? "success" : "unknown",
  };
}

function recoveryAttemptRows(lane, store) {
  if (!store) return [];
  if (safeIso(store.last_run?.observed_at, { allowDate: false })) {
    return [{ ...store.last_run, outcome: ({ published: "success", retained: "retained", unavailable: "failed" })[store.last_run.outcome] || "unknown" }];
  }
  if (store.current_attempt?.decision) {
    const decision = store.current_attempt.decision;
    return [{ observed_at: store.current_attempt.observed_at,
      outcome: ["candidate_promoted", "recovered_and_promoted"].includes(decision) ? "success"
        : ["retained_lkg", "bootstrap_failure_retained"].includes(decision) ? "retained" : "failed" }];
  }
  const kinds = STOCKANALYSIS_KINDS[lane.id];
  if (kinds) return kinds.map((kind) => countAttempt(store.current_results?.by_kind?.[kind])).filter(Boolean);
  const counted = countAttempt(store.current_attempt || store.current_results);
  if (counted) return [counted];
  // Item clocks are written by recordSuccess/recordFailure. The envelope's
  // generated_at is not attempt evidence and must never stand in for one.
  return Object.values(store.items || {}).map((item) => ({
    observed_at: item.updated_at,
    outcome: item.resolution_state === "fresh_primary" ? "success"
      : item.resolution_state === "lkg_primary" ? "retained"
        : item.resolution_state === "unavailable" ? "failed" : "unknown",
  }));
}

function readAttemptRows(lane, context, store) {
  const provided = context.attempts?.[lane.id];
  if (Array.isArray(provided)) return provided;
  if (isObject(provided) && Array.isArray(provided.attempts)) return provided.attempts;
  const relative = lane.roots?.detection_attempt;
  const document = relative ? readJson(path.join(context.repoRoot, relative)) : null;
  return [...(Array.isArray(document?.attempts) ? document.attempts : []), ...recoveryAttemptRows(lane, store)];
}

function latestAttempt(rows) {
  const valid = rows.filter((row) => safeIso(row?.observed_at, { allowDate: false }));
  const newest = [...valid].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
  if (!newest) return null;
  const sameRun = valid.filter((row) => Date.parse(row.observed_at) === Date.parse(newest.observed_at));
  const outcomes = sameRun.map((row) => normalizeAttempt(row).outcome);
  if (outcomes.includes("partial") || (outcomes.includes("success") && outcomes.some((outcome) => ["failed", "retained"].includes(outcome)))) {
    return { observed_at: newest.observed_at, outcome: "partial" };
  }
  return sameRun.find((row) => normalizeAttempt(row).outcome === "failed") || newest;
}

function failedAssertion(row) {
  return Array.isArray(row?.assertions) && row.assertions.some((assertion) => assertion?.passed === false);
}

export function normalizeAttempt(row) {
  if (!row) return { observed_at: null, outcome: "unobserved", failure_class: null };
  const observedAt = safeIso(row.observed_at, { allowDate: false });
  if (["partial", "retained", "failed"].includes(row.outcome)) {
    return { observed_at: observedAt, outcome: row.outcome, failure_class: row.outcome === "failed" ? "unknown" : null };
  }
  if (row.execution === "unobserved") return { observed_at: observedAt, outcome: "unobserved", failure_class: null };
  if (row.outcome === "primary_succeeded_skip") return { observed_at: observedAt, outcome: "success", failure_class: null };
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
  if (row.execution === "returned" || ["success", "published"].includes(row.outcome)) {
    return { observed_at: observedAt, outcome: "success", failure_class: null };
  }
  return { observed_at: observedAt, outcome: "unknown", failure_class: "unknown" };
}

function kpiLaneFor(lane, context) {
  return (context.kpi?.sets || []).find((candidate) => candidate?.set === lane.id)
    || (context.kpi?.lanes || []).find((candidate) => candidate?.id === lane.id) || null;
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
  const external = lane.external_status ? readJson(path.join(context.repoRoot, lane.external_status)) : null;
  const externalSourceDate = safeIso(external?.last_run?.source_as_of);
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
      : kpiLane?.date_basis === "collected" ? null : safeIso(kpiLane?.newest_source_date || kpiLane?.as_of) || externalSourceDate;
  const evidenceStatus = artifactSourceDate || sourceDate
    ? "observed"
    : mapping.no_source_evidence_status || "unavailable";
  return {
    source_date: sourceDate,
    source_date_reason: artifactSourceDate
      ? mapping.source_date_reason
      : sourceDate ? externalSourceDate === sourceDate ? "external_collector_source_date" : "data_health_source_date" : mapping.no_source_reason,
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

function buildRecoveryState(lane, store, kpiLane, attempt) {
  const details = kpiLane?.details;
  const nested = isObject(details?.recovery) ? details.recovery : null;
  const kinds = STOCKANALYSIS_KINDS[lane.id];
  const storedRetry = kinds ? store?.retry_artifacts?.filter((row) => kinds.includes(row.artifact_kind))
    : store?.retry_set || store?.retry_keys || store?.retry_symbols || store?.retry_members;
  const retrySet = Array.isArray(storedRetry) ? storedRetry : Array.isArray(details?.recovery_retry_set)
    ? details.recovery_retry_set
    : Array.isArray(nested?.retry_keys) ? nested.retry_keys : null;
  const recovered = Array.isArray(details?.recovery_recovered)
    ? details.recovery_recovered
    : Array.isArray(nested?.recovery_details) ? nested.recovery_details : null;
  let state = "unavailable";
  const items = Object.values(store?.items || store?.members || {});
  const retained = items.filter((item) => item?.resolution_state === "lkg_primary");
  const lkgCount = kinds ? kinds.reduce((sum, kind) => sum + (store?.counts_by_kind?.[kind]?.lkg || 0), 0)
    : store?.counts?.lkg || 0;
  if (retained.length || lkgCount || attempt.outcome === "retained") state = "retained_lkg";
  else if (retrySet && retrySet.length > 0) state = "retry_pending";
  else if (recovered && recovered.length > 0) {
    state = recovered.some((row) => row?.resolution_state === "fresh_primary") ? "fresh_primary" : "retained_lkg";
  } else if (attempt.outcome === "provider_wait") state = "provider_wait";
  else if (attempt.outcome === "success") state = "fresh_primary";
  const lastRecovered = recovered?.filter((row) => safeIso(row?.recovered_at, { allowDate: false }))
    .sort((a, b) => Date.parse(b.recovered_at) - Date.parse(a.recovered_at))[0] || null;
  return {
    state,
    retry_count: retrySet ? retrySet.length : null,
    recovered_at: safeIso(lastRecovered?.recovered_at, { allowDate: false }),
    lkg_source_date: oldestSourceDate(retained.map((item) => item.current?.source_as_of))
      || safeIso(lastRecovered?.lkg_source_as_of || lastRecovered?.source_as_of),
  };
}

function safeIncidentClass(value) {
  return INCIDENT_CLASSES.has(value) ? value : null;
}

function buildIncidentState(lane, context) {
  const workflow = basename(lane.owner_workflow);
  const externalIncident = lane.external_status ? `a1-${lane.id.replaceAll("_", "-")}` : null;
  const matching = (context.alarm?.open_incidents || []).filter((incident) =>
    (workflow && incident?.workflow === workflow) || (externalIncident && incident?.workflow === externalIncident));
  const incident = matching[0] || null;
  return {
    status: incident ? "open" : context.alarm?.status === "clear" ? "clear" : "unknown",
    workflow: workflow || externalIncident,
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

// The KPI and board read the same actual attempt evidence. Generated envelope
// clocks never become collection attempts.
export function readLaneAttempt(lane, context = {}) {
  const normalized = { ...context, repoRoot: context.repoRoot || REPO_ROOT };
  if (lane.id === "fred_macro") {
    const payload = readJson(path.join(normalized.repoRoot, "data/macro/fred-macro.json"));
    // This clock belongs to the last promoted payload, never this projection.
    return normalizeAttempt({ observed_at: payload?.updated, outcome: "success" });
  }
  if (lane.id === "earnings_overview") {
    const summary = readJson(path.join(normalized.repoRoot, "data/admin/earnings_overview/refresh-summary.json"));
    const rows = Object.values(summary?.tickers ?? {});
    const succeeded = rows.filter(row => row.ok === true).length;
    return normalizeAttempt({ observed_at: summary?.attemptedAt,
      outcome: rows.length === 0 ? "unknown" : succeeded === rows.length ? "success" : succeeded ? "partial" : "failed" });
  }
  if (lane.id === "briefing") {
    const index = readJson(path.join(normalized.repoRoot, "data/briefing/index.json"));
    const editions = (index?.editions ?? []).filter(row => row.edition_date === index?.latest?.[row.product]);
    const rows = editions.map(edition => {
      if (typeof edition.path !== "string" || edition.path.startsWith("/") || edition.path.split("/").includes("..")) return null;
      const document = readJson(path.join(normalized.repoRoot, "data/briefing", edition.path));
      const epoch = Date.parse(document?.edition_date === edition.edition_date ? briefingPublishedAt(document) : null);
      return Number.isFinite(epoch) ? { observed_at: new Date(epoch).toISOString(), outcome: "success" } : null;
    }).filter(Boolean);
    return normalizeAttempt(latestAttempt(rows));
  }
  if (lane.external_status) {
    const status = readJson(path.join(normalized.repoRoot, lane.external_status));
    if (status?.last_run) {
      const epoch = Date.parse(status.last_run.observed_at);
      return normalizeAttempt({ ...status.last_run,
        observed_at: Number.isFinite(epoch) ? new Date(epoch).toISOString() : null });
    }
    if (status?.enabled && status.updated_at) return normalizeAttempt({
      observed_at: status.updated_at,
      outcome: status.consecutive_failures > 0 ? "failed" : "success",
    });
  }
  return normalizeAttempt(latestAttempt(readAttemptRows(lane, normalized, recoveryStoreFor(lane, normalized))));
}

export function buildControlRoomState(lane, context = {}) {
  const normalizedContext = createProjectionContext(context);
  const kpiLane = kpiLaneFor(lane, normalizedContext);
  const store = recoveryStoreFor(lane, normalizedContext);
  const attempt = readLaneAttempt(lane, normalizedContext);
  const state = {
    schedule: buildScheduleState(lane, normalizedContext, attempt),
    latest_attempt: attempt,
    source: buildSourceState(lane, normalizedContext, kpiLane),
    recovery: buildRecoveryState(lane, store, kpiLane, attempt),
    incident: buildIncidentState(lane, normalizedContext),
    queue: buildQueueState(lane, normalizedContext),
  };
  const missing = [];
  if (!attempt.observed_at || ["unobserved", "unknown"].includes(attempt.outcome)) missing.push("attempt");
  if (!kpiLane) missing.push("health");
  if (state.source.evidence_status !== "observed") missing.push("source");
  if ((lane.owner_workflow || lane.external_timer) && !state.schedule.cron) missing.push("schedule");
  state.coverage = { status: missing.length ? "not_covered" : "covered", missing };
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
  projected.control_room_state = buildControlRoomState(lane, context);
  return projected;
}

export function buildLaneRegistryProjection(registry = LANE_REGISTRY, options = {}) {
  const context = createProjectionContext(options);
  const projection = {
    schema_version: PROJECTION_SCHEMA,
    generated_at: context.now,
    source_schema_version: registry.schema_version,
    purpose:
      "Admin-safe lane metadata and derived control-room projection for the owner data dashboard. No store roots, attempt/recovery paths, run identities, or repository directory structure.",
    lane_count: registry.lanes.length,
    lanes: registry.lanes.map((lane) => projectLane(lane, registry.providers, context)),
  };
  // Semantic guard: generated_at must not precede any embedded observation timestamp
  const genEpoch = Date.parse(projection.generated_at);
  for (const lane of projection.lanes) {
    const observed = lane.control_room_state?.latest_attempt?.observed_at;
    if (observed && Date.parse(observed) > genEpoch) {
      throw new Error(
        `generated_at ${projection.generated_at} precedes ${lane.id} observed_at ${observed}`,
      );
    }
  }
  return projection;
}

export function emitLaneRegistryProjection({
  registry = LANE_REGISTRY,
  outputPaths = DEFAULT_PROJECTION_OUTPUT_PATHS,
  options = {},
} = {}) {
  const projection = buildLaneRegistryProjection(registry, options);
  const json = `${JSON.stringify(projection, null, 2)}\n`;
  for (const target of outputPaths) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, json);
  }
  return projection;
}

function main() {
  const projection = emitLaneRegistryProjection();
  console.log(
    `lane-registry projection: ${projection.lanes.length} lanes -> ${path.relative(REPO_ROOT, OUT_PATH)} (+ public mirror)`,
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
