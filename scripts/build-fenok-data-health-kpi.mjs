#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validateDetectionReport } from "./build-data-supply-detection-floor.mjs";
import { projectPublicKpi } from "./lib/kpi-runtime-projection.mjs";
import { assertValidCronDeferrals } from "./lib/kpi-runtime-slots.mjs";
import {
  calendar_version,
  businessDayAge,
  calendarDayAge,
  hoursAge,
  isoDateOf,
  isFutureSource,
  isRealCalendarDate,
  yahooBusinessDayAge,
} from "./lib/market-calendar.mjs";
import {
  CADENCE,
  TRACKED_CRONS,
  SOURCE_SLA_DEF,
  SOURCE_WORKFLOW_CRONS,
  REQUIRED_RIM_INDICES,
  REQUIRED_SURFACE_IDS,
  PLATFORM_BLOCKING_CHECK_KEYS,
  SLICKCHARTS_DELIVERY_GROUPS,
  YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
} from "./lib/kpi-contract-constants.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCHEMA_VERSION = "fenok-data-health-kpi/v2";
const KPI_REL_PATH = "admin/fenok-data-health-kpi.json";
const SCRIPT_START_MS = Date.now();

function getArg(flag) {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

// Injectable data root (fixture temp roots) + injectable clock.
const DATA_ROOT_ARG = getArg("--data-root");
let DATA_ROOT = DATA_ROOT_ARG
  ? path.join(DATA_ROOT_ARG, "data")
  : path.join(ROOT, "data");
let PUBLIC_DATA_ROOT = DATA_ROOT_ARG
  ? path.join(DATA_ROOT_ARG, "public", "data")
  : path.join(ROOT, "100xfenok-next", "public", "data");

function resolveNow() {
  const fake = process.env.KPI_FAKE_NOW;
  if (fake) {
    const t = new Date(fake);
    if (Number.isFinite(t.getTime())) return t.toISOString();
  }
  return new Date().toISOString();
}

// ── Runtime self-proof (contract §1-3) ──────────────────────────────────────
// CADENCE / TRACKED_CRONS / SOURCE_SLA_DEF / SOURCE_WORKFLOW_CRONS are canonical
// (scripts/lib/kpi-contract-constants.mjs). The builder only EMITS from them; the
// checker VALIDATES the artifact against them. Never redefine them here.
const ENVELOPE_SOURCE_ALLOWLIST = new Set(Object.keys(SOURCE_WORKFLOW_CRONS));

function parseCron(cron) {
  const [min, hour, , , dow] = String(cron).trim().split(/\s+/);
  return { minute: Number(min), hour: Number(hour), dow: parseDow(dow) };
}

function parseDow(dow) {
  if (dow == null || dow === "*") return null;
  const range = String(dow).match(/^(\d)-(\d)$/);
  if (range) {
    const set = new Set();
    for (let d = Number(range[1]); d <= Number(range[2]); d += 1) set.add(d % 7);
    return set;
  }
  return new Set(String(dow).split(",").map((x) => Number(x) % 7));
}

function cronAllowsDay(parsed, jsDay) {
  return !parsed.dow || parsed.dow.has(jsDay % 7);
}

function occurrenceKey(workflowFile, cron, occMs) {
  return `${workflowFile}:${cron}@${new Date(occMs).toISOString().slice(0, 16)}Z`;
}

function parseSlotKey(slotKey) {
  const text = String(slotKey ?? "");
  const at = text.lastIndexOf("@");
  if (at < 0) return null;
  const left = text.slice(0, at);
  const tsRaw = text.slice(at + 1);
  const colon = left.indexOf(":");
  if (colon < 0) return null;
  if (!/Z$/.test(tsRaw)) return null;
  const timestamp = tsRaw.slice(0, -1);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(timestamp)) return null;
  return { workflow_file: left.slice(0, colon), cron: left.slice(colon + 1), timestamp };
}

function isValidOccurrence(cron, timestamp) {
  const parsed = parseCron(cron);
  const occ = new Date(`${timestamp}:00Z`);
  if (!Number.isFinite(occ.getTime())) return false;
  return occ.getUTCHours() === parsed.hour
    && occ.getUTCMinutes() === parsed.minute
    && cronAllowsDay(parsed, occ.getUTCDay());
}

function validateOriginSlotKey(slotKey, sourceWorkflow, { nowIso, graceMinutes }) {
  const parsed = parseSlotKey(slotKey);
  if (!parsed || parsed.workflow_file !== sourceWorkflow) return false;
  const crons = SOURCE_WORKFLOW_CRONS[sourceWorkflow];
  if (!crons || !crons.includes(parsed.cron)) return false;
  if (!isValidOccurrence(parsed.cron, parsed.timestamp)) return false;
  // §3: the slot must be a RECENT occurrence within grace of the source cron — not
  // a stale canonical key replayed from days ago. Occurrence must sit at/before now
  // and within slot_grace_minutes of now.
  const occMs = new Date(`${parsed.timestamp}:00Z`).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(occMs) || !Number.isFinite(nowMs)) return false;
  return occMs <= nowMs && nowMs - occMs <= Number(graceMinutes) * 60000;
}

function latestOccurrenceOnOrBefore(parsed, jobStartMs) {
  for (let back = 0; back < 21; back += 1) {
    const day = new Date(jobStartMs - back * 86400000);
    const occ = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), parsed.hour, parsed.minute, 0, 0);
    if (occ <= jobStartMs && cronAllowsDay(parsed, new Date(occ).getUTCDay())) return occ;
  }
  return null;
}

export function inferSlotKey({ crons, workflowFile, jobStartedAtIso, graceMinutes, runAttempt }) {
  if (Number(runAttempt) > 1) return null; // §2: re-runs are always slotless
  const jobStart = new Date(jobStartedAtIso).getTime();
  if (!Number.isFinite(jobStart)) return null;
  let best = null;
  for (const cron of crons) {
    const occ = latestOccurrenceOnOrBefore(parseCron(cron), jobStart);
    if (occ == null) continue;
    if (best == null || occ > best.occMs) best = { occMs: occ, cron };
  }
  if (best == null) return null;
  if (jobStart - best.occMs > Number(graceMinutes) * 60000) return null; // outside grace -> slotless
  return occurrenceKey(workflowFile, best.cron, best.occMs);
}

// GRACE-AWARE (hotfix): a slot only becomes MISSABLE after its grace window expires —
// now > occurrence + slot_grace_minutes. A slot still inside grace (a delayed
// scheduled run can still legitimately claim it) must NOT be enumerated as due, or
// builder emission (missed=[]) and checker re-derivation would disagree the moment a
// deploy rebuild refreshes generated_at a few minutes past the slot.
export function enumerateDueSlots({ trackedCrons, watermarkIso, nowIso, retentionDays, graceMinutes }) {
  const now = new Date(nowIso).getTime();
  const watermark = new Date(watermarkIso).getTime();
  if (!Number.isFinite(now) || !Number.isFinite(watermark)) return [];
  const graceMs = Number(graceMinutes) * 60000;
  const startMs = Math.max(watermark, now - Number(retentionDays) * 86400000);
  const startDay = new Date(startMs);
  startDay.setUTCHours(0, 0, 0, 0);
  const out = [];
  for (let t = startDay.getTime(); t <= now; t += 86400000) {
    const day = new Date(t);
    for (const { workflow_file, cron } of trackedCrons) {
      const parsed = parseCron(cron);
      if (!cronAllowsDay(parsed, day.getUTCDay())) continue;
      const occ = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), parsed.hour, parsed.minute, 0, 0);
      // Missable only once past retention floor AND past the grace window.
      if (occ < startMs || occ + graceMs >= now) continue;
      out.push(occurrenceKey(workflow_file, cron, occ));
    }
  }
  return [...new Set(out)].sort();
}

export function deriveMissedSlots({ dueSlots, satisfiedSlotKeys, cronDeferrals }) {
  assertValidCronDeferrals(cronDeferrals ?? [], { satisfiedSlotKeys });
  const satisfied = new Set(satisfiedSlotKeys || []);
  const deferred = new Set((cronDeferrals || []).map((d) => d.slot_key));
  return dueSlots.filter((s) => !satisfied.has(s) && !deferred.has(s)).sort();
}

function slotTimestampMs(slotKey) {
  const parsed = parseSlotKey(slotKey);
  return parsed ? new Date(`${parsed.timestamp}:00Z`).getTime() : NaN;
}

function trimByRetention(slotKeys, nowIso, retentionDays) {
  const floor = new Date(nowIso).getTime() - Number(retentionDays) * 86400000;
  return [...new Set(slotKeys)]
    .filter((s) => {
      const ms = slotTimestampMs(s);
      return !Number.isFinite(ms) || ms >= floor;
    })
    .sort();
}

function readGithubContext(env) {
  const ref = env.GITHUB_WORKFLOW_REF || "";
  const fileMatch = ref.match(/\.github\/workflows\/([^@]+)/);
  return {
    run_id: env.GITHUB_RUN_ID || null,
    run_attempt: env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : null,
    event_name: env.GITHUB_EVENT_NAME || null,
    workflow: env.GITHUB_WORKFLOW || null,
    workflow_file: fileMatch ? fileMatch[1] : null,
    sha: env.GITHUB_SHA || null,
    actor: env.GITHUB_ACTOR || null,
    ref: env.GITHUB_REF || null,
  };
}

function readOriginEnvelope(env) {
  const sourceWorkflow = env.KPI_ORIGIN_SOURCE_WORKFLOW || "";
  if (!sourceWorkflow) return null;
  return {
    source_workflow: sourceWorkflow,
    source_run_id: env.KPI_ORIGIN_SOURCE_RUN_ID || null,
    source_run_attempt: env.KPI_ORIGIN_SOURCE_RUN_ATTEMPT ? Number(env.KPI_ORIGIN_SOURCE_RUN_ATTEMPT) : null,
    original_event: env.KPI_ORIGIN_ORIGINAL_EVENT || null,
    slot_key: env.KPI_ORIGIN_SLOT_KEY || null,
  };
}

function classifyAuthoritative({ github, origin, jobStartedAtIso, nowIso, eventSchedule }) {
  if (github.event_name === "schedule" && github.workflow_file === "update-manifest.yml") {
    // §2: infer ONLY on the run's OWN cron. GitHub passes the triggering cron in
    // github.event.schedule (KPI_EVENT_SCHEDULE). A delayed 02:30 run must never
    // claim the 09:30 slot by "latest occurrence across crons".
    const ownCron = eventSchedule && CADENCE.crons_utc.includes(eventSchedule) ? eventSchedule : null;
    return {
      authoritative: true,
      reason: ownCron ? "schedule" : "schedule_unknown_cron",
      slot_key: ownCron
        ? inferSlotKey({
            crons: [ownCron],
            workflowFile: "update-manifest.yml",
            jobStartedAtIso,
            graceMinutes: CADENCE.slot_grace_minutes,
            runAttempt: github.run_attempt,
          })
        : null, // own cron unidentifiable -> slotless, never cross-cron guess
    };
  }
  if (github.event_name === "workflow_dispatch" && origin) {
    const failures = [];
    if (github.actor !== "github-actions[bot]") failures.push("actor");
    if (github.ref !== "refs/heads/main") failures.push("ref");
    if (!ENVELOPE_SOURCE_ALLOWLIST.has(origin.source_workflow)) failures.push("source_workflow");
    if (origin.original_event !== "schedule") failures.push("original_event");
    if (!validateOriginSlotKey(origin.slot_key, origin.source_workflow, { nowIso, graceMinutes: CADENCE.slot_grace_minutes })) {
      failures.push("origin_slot_key");
    }
    if (failures.length === 0) {
      // §2: a re-run of EITHER the dispatch run or the source run is always slotless.
      const slotless = Number(github.run_attempt) > 1 || Number(origin.source_run_attempt) > 1;
      return {
        authoritative: true,
        reason: slotless ? "valid_dispatch_slotless_rerun" : "valid_dispatch",
        slot_key: slotless ? null : origin.slot_key,
      };
    }
    return { authoritative: false, reason: `invalid_envelope:${failures.join(",")}`, slot_key: null };
  }
  return { authoritative: false, reason: "non_authoritative_context", slot_key: null };
}

function appendHistory(priorHistory, entry, cap) {
  const key = (h) => `${h?.workflow || ""}|${h?.run_id || ""}|${h?.run_attempt ?? ""}`;
  const combined = [...(Array.isArray(priorHistory) ? priorHistory : [])];
  const idx = combined.findIndex((h) => key(h) === key(entry));
  if (idx >= 0) combined.splice(idx, 1);
  combined.push(entry);
  return combined.slice(-cap);
}

export function buildRuntime({ nowIso, env, priorRuntime, snapshotStatus }) {
  const github = readGithubContext(env);
  const origin = readOriginEnvelope(env);
  const jobStartedAtIso = env.KPI_JOB_STARTED_AT || nowIso;
  const auth = classifyAuthoritative({
    github,
    origin,
    jobStartedAtIso,
    nowIso,
    eventSchedule: env.KPI_EVENT_SCHEDULE || null,
  });
  const lastRebuildContext = {
    built_at: nowIso,
    run_id: github.run_id,
    workflow: github.workflow,
    event_name: github.event_name,
    sha: github.sha,
  };
  const priorV2ActivatedAt = priorRuntime?.cadence?.v2_activated_at ?? null;

  // cadence is DEFINITIONAL — re-emitted canonical every build (never preserved),
  // so a prior malformed/tampered cadence cannot survive a rebuild. Only
  // v2_activated_at (watermark) is preserved state.
  const canonicalCadence = { ...CADENCE, v2_activated_at: priorV2ActivatedAt ?? nowIso, calendar_version };
  const priorSlots = priorRuntime?.slots;
  assertValidCronDeferrals(priorSlots?.cron_deferrals ?? [], {
    satisfiedSlotKeys: priorSlots?.satisfied_slot_keys ?? [],
  });

  if (!auth.authoritative) {
    // Non-authoritative: preserve producer/slots/history verbatim; only rebuild ctx
    // + the definitional cadence update.
    if (priorRuntime && typeof priorRuntime === "object") {
      return {
        producer_context: priorRuntime.producer_context ?? null,
        last_rebuild_context: lastRebuildContext,
        cadence: canonicalCadence,
        slots: priorRuntime.slots ?? { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] },
        successful_snapshot_history: priorRuntime.successful_snapshot_history ?? [],
        authoritative_context: { authoritative: false, reason: auth.reason },
      };
    }
    return {
      producer_context: null, // honest bootstrap; warn-only in Phase A
      last_rebuild_context: lastRebuildContext,
      cadence: canonicalCadence,
      slots: { satisfied_slot_keys: [], last_satisfied_slot_key: null, missed_slot_keys: [], cron_deferrals: [] },
      successful_snapshot_history: [],
      authoritative_context: { authoritative: false, reason: auth.reason },
    };
  }

  const v2ActivatedAt = priorV2ActivatedAt ?? nowIso;
  const slotKey = auth.slot_key;
  const durationMs = Date.now() - SCRIPT_START_MS;
  const producerContext = {
    built_at: nowIso,
    duration_ms: durationMs,
    run_id: github.run_id,
    run_attempt: github.run_attempt,
    event_name: github.event_name,
    workflow: github.workflow,
    sha: github.sha,
    slot_key: slotKey,
    origin: origin ?? null,
  };
  const priorSatisfied = priorRuntime?.slots?.satisfied_slot_keys ?? [];
  const cronDeferrals = priorRuntime?.slots?.cron_deferrals ?? [];
  const satisfied = trimByRetention(
    [...priorSatisfied, ...(slotKey ? [slotKey] : [])],
    nowIso,
    CADENCE.slot_retention_days,
  );
  const dueSlots = enumerateDueSlots({
    trackedCrons: TRACKED_CRONS,
    watermarkIso: v2ActivatedAt,
    nowIso,
    retentionDays: CADENCE.slot_retention_days,
    graceMinutes: CADENCE.slot_grace_minutes,
  });
  const missed = deriveMissedSlots({ dueSlots, satisfiedSlotKeys: satisfied, cronDeferrals });
  const historyEntry = {
    built_at: nowIso,
    slot_key: slotKey,
    run_id: github.run_id,
    run_attempt: github.run_attempt,
    workflow: github.workflow,
    status: snapshotStatus,
    duration_ms: durationMs,
  };
  return {
    producer_context: producerContext,
    last_rebuild_context: lastRebuildContext,
    cadence: canonicalCadence,
    slots: {
      satisfied_slot_keys: satisfied,
      last_satisfied_slot_key: slotKey ?? (priorRuntime?.slots?.last_satisfied_slot_key ?? null),
      missed_slot_keys: missed,
      cron_deferrals: cronDeferrals,
    },
    successful_snapshot_history: appendHistory(priorRuntime?.successful_snapshot_history, historyEntry, 14),
    authoritative_context: { authoritative: true, reason: auth.reason },
  };
}

// ── Per-source SLA evaluation (contract §5) ─────────────────────────────────

export function evaluateSlaAge({ sourceDate, unit, calendar, nowIso }) {
  if (sourceDate == null) return null;
  if (unit === "hours") return hoursAge(sourceDate, nowIso);
  if (unit === "calendar_days") return calendarDayAge(sourceDate, nowIso);
  return businessDayAge(sourceDate, nowIso, calendar); // business_days
}

export function slaStatusForAge(age, maxStaleness) {
  if (age == null) return "unavailable";
  return age <= Number(maxStaleness) ? "ready" : "stale";
}

// Fail-closed OLDEST: if ANY listed input is null/unparseable, the aggregate is
// null (unavailable) — a missing required input must never be silently dropped
// so the surviving inputs mask it (contract §5).
function oldestRequiredIsoDate(values) {
  const dates = values.map(isoDateOf);
  if (dates.some((d) => !d)) return null;
  return [...dates].sort()[0] ?? null;
}

function hasOwn(obj, key) {
  return obj != null && Object.prototype.hasOwnProperty.call(obj, key);
}

// Shared shape-strict classifier for product_surface_coverage (rev5.6). Both the
// builder and the checker call this on the SAME required-surface rows + stamp marker
// so they agree by construction. hasStampMarker = artifact carried root
// source_stamp_version.
//  - Markerless artifact: EVERY required row absent => genuine bootstrap pending;
//    any present source_as_of on a markerless artifact => structural corruption (hard).
//  - Marked artifact: EVERY required row MUST carry own-property source_as_of; ANY
//    absence (one row or ALL rows — e.g. an all-typo-key artifact) => hard.
//  - shape_error (ALWAYS hard): missing/duplicate id; absence under a marker; a
//    non-null source_as_of that is not a REAL-CALENDAR date.
//  - future: any present value is a future date (PER value, BEFORE the fold).
//  - pending: every id present exactly once, each value EXACTLY null or a real
//    NON-FUTURE date, AT LEAST ONE null.  stamped: all values real dates.
export const STAMP_MARKER_VALUE = 1;

export function classifyProductSurface(requiredRows, nowIso, { stampMarkerPresent = false, stampMarkerValue } = {}) {
  const rows = Array.isArray(requiredRows) ? requiredRows : [];
  const counts = new Map();
  for (const row of rows) counts.set(row?.id, (counts.get(row?.id) || 0) + 1);
  const shapeErrors = [];
  for (const id of REQUIRED_SURFACE_IDS) {
    const c = counts.get(id) || 0;
    if (c === 0) shapeErrors.push(`missing required surface ${id}`);
    else if (c > 1) shapeErrors.push(`duplicate required surface ${id}`);
  }
  if (shapeErrors.length) return { kind: "shape_error", source_date: null, shape_errors: shapeErrors };

  // Marker value must be EXACTLY the number 1 when present ("1"/true/2/{} all hard).
  if (stampMarkerPresent && stampMarkerValue !== STAMP_MARKER_VALUE) {
    return { kind: "shape_error", source_date: null, shape_errors: [`source_stamp_version must be exactly ${STAMP_MARKER_VALUE} (number), got ${JSON.stringify(stampMarkerValue)}`] };
  }
  const hasStampMarker = stampMarkerPresent; // value === 1 guaranteed past the guard

  const byId = new Map();
  for (const row of rows) if (REQUIRED_SURFACE_IDS.includes(row?.id)) byId.set(row.id, row);
  const presentValues = [];
  const absentIds = [];
  for (const id of REQUIRED_SURFACE_IDS) {
    const row = byId.get(id);
    if (hasOwn(row, "source_as_of")) presentValues.push({ id, value: row.source_as_of });
    else absentIds.push(id);
  }

  if (!hasStampMarker) {
    // Markerless = genuine pre-stamp-era artifact. Bootstrap ONLY if EVERY row absent.
    if (presentValues.length === 0) return { kind: "pending", source_date: null, bootstrap: true };
    return { kind: "shape_error", source_date: null, shape_errors: ["markerless artifact carries source_as_of on some rows (structural)"] };
  }
  // Marked = stamp-aware generator. EVERY required row MUST carry the property.
  if (absentIds.length > 0) {
    return { kind: "shape_error", source_date: null, shape_errors: [`marked artifact lacks own-property source_as_of on: ${absentIds.join(", ")}`] };
  }
  for (const { id, value } of presentValues) {
    if (value !== null && !isRealCalendarDate(value)) shapeErrors.push(`malformed source_as_of for ${id}: ${JSON.stringify(value)}`);
  }
  if (shapeErrors.length) return { kind: "shape_error", source_date: null, shape_errors: shapeErrors };

  const values = presentValues.map((p) => p.value);
  const dates = values.filter((v) => v !== null);
  if (dates.some((d) => isFutureSource(d, nowIso, "business_days"))) {
    return { kind: "future", source_date: oldestRequiredIsoDate(dates) };
  }
  if (values.some((v) => v === null)) return { kind: "pending", source_date: null };
  return { kind: "stamped", source_date: oldestRequiredIsoDate(dates) };
}

function readJson(relPath, root = DATA_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relPath), "utf8"));
  } catch {
    return null;
  }
}

function readOptionalJsonStrict(relPath, root = DATA_ROOT) {
  const filePath = path.join(root, relPath);
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`${relPath} read failed: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${relPath} is malformed JSON: ${error.message}`);
  }
}

function readText(relPath, root = ROOT) {
  try {
    return fs.readFileSync(path.join(root, relPath), "utf8");
  } catch {
    return "";
  }
}

function exists(relPath, root = ROOT) {
  return fs.existsSync(path.join(root, relPath));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return value === true;
}

function dateOnly(value) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function statusLabel(status) {
  return {
    ready: "정상",
    degraded: "저하",
    warning: "주의",
    blocked: "차단",
    unavailable: "없음",
  }[status] || "점검";
}

function check(id, label, ok, detail, extra = {}) {
  const status = ok ? "ready" : "blocked";
  return {
    id,
    label,
    status,
    status_label: statusLabel(status),
    detail,
    platform_blocking: extra.platform_blocking === true,
    ...extra,
  };
}

function warningCheck(id, label, detail, extra = {}) {
  return {
    id,
    label,
    status: "warning",
    status_label: statusLabel("warning"),
    detail,
    platform_blocking: false,
    ...extra,
  };
}

function diagnosticCheck(id, label, ok, detail, extra = {}) {
  return ok
    ? check(id, label, true, detail, { required: false, ...extra })
    : warningCheck(id, label, detail, { required: false, ...extra });
}

function laneStatus(checks) {
  const failed = checks.filter((item) => item.status === "blocked" || item.status === "unavailable");
  if (failed.some((item) => item.platform_blocking === true)) return "blocked";
  if (failed.length > 0) return "degraded";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function lane(id, label, checks, { required = true, counts = {}, details = {}, asOf = null } = {}) {
  const platformBlockingKeys = new Set(PLATFORM_BLOCKING_CHECK_KEYS);
  const classifiedChecks = checks.map((item) => ({
    ...item,
    platform_blocking: platformBlockingKeys.has(`${id}/${item.id}`),
  }));
  const requiredChecks = classifiedChecks.filter((item) => item.required !== false);
  const status = laneStatus(requiredChecks);
  const failed = requiredChecks.filter((item) => item.status !== "ready");
  const statusMessage = status === "ready"
    ? `${label} is ready.`
    : status === "blocked"
      ? `Platform integrity blocked by ${failed.map((item) => `${item.label}: ${item.detail}`).join("; ")}.`
      : `${label} is not ready: ${failed.map((item) => `${item.label}: ${item.detail}`).join("; ")}. Other lanes may publish.`;
  return {
    id,
    label,
    status,
    status_label: statusLabel(status),
    status_message: statusMessage,
    deployment_blocking: failed.some((item) => item.platform_blocking === true),
    required,
    as_of: asOf,
    counts,
    details,
    checks: classifiedChecks,
  };
}

const DETECTION_STATUS_SEVERITY = Object.freeze({ ready: 0, unobserved: 1, stale: 2, drift: 3, unavailable: 4 });
const DETECTION_REASON_STATUS = Object.freeze({
  ok: "ready",
  workflow_unobserved: "unobserved",
  stale: "stale",
  schema_drift: "drift",
  decode_error: "drift",
  missing_artifact: "unavailable",
  transport_error: "unavailable",
  http_error: "unavailable",
  auth_error: "unavailable",
  rate_limited: "unavailable",
  empty_payload: "unavailable",
  future_source: "unavailable",
  unexpected_error: "unavailable",
});

function isDetectionSourceStamp(value) {
  if (typeof value !== "string") return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isRealCalendarDate(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && isRealCalendarDate(value.slice(0, 10))
    && Number.isFinite(new Date(value).getTime());
}

function assertDetectionStatusReason(row, context, { allowUnavailableSchemaDrift = false } = {}) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`detection floor ${context} is malformed`);
  const compatible = DETECTION_REASON_STATUS[row.reason] === row.status
    || (allowUnavailableSchemaDrift && row.status === "unavailable" && row.reason === "schema_drift");
  if (!compatible) {
    throw new Error(`detection floor ${context} status/reason is contradictory`);
  }
}

export function mapDetectionFloorTgaRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error("detection floor treasury_tga row is malformed");
  }
  if (row.label !== "US Treasury TGA" || row.enforcement !== "live" || row.kpi_required !== true) {
    throw new Error("detection floor treasury_tga identity/enforcement contract is malformed");
  }
  assertDetectionStatusReason(row, "treasury_tga", { allowUnavailableSchemaDrift: true });
  assertDetectionStatusReason(row.artifact, "treasury_tga.artifact", { allowUnavailableSchemaDrift: true });
  if (DETECTION_STATUS_SEVERITY[row.artifact.status] > DETECTION_STATUS_SEVERITY[row.status]) {
    throw new Error("detection floor treasury_tga status is better than its artifact status");
  }
  const sourceAsOf = row.artifact.source_as_of;
  if (sourceAsOf !== null && !isDetectionSourceStamp(sourceAsOf)) {
    throw new Error("detection floor treasury_tga artifact.source_as_of is malformed");
  }
  if ((row.artifact.status === "ready" || row.artifact.status === "stale") && sourceAsOf === null) {
    throw new Error("detection floor treasury_tga artifact status contradicts null source_as_of");
  }

  const result = lane("treasury_tga", row.label, [
    check(
      "detection_floor_status",
      "Detection floor status",
      row.status === "ready",
      `${row.reason}; source_as_of ${sourceAsOf ?? "null"}`,
    ),
  ], { asOf: sourceAsOf });
  return {
    ...result,
    reason: row.reason,
    artifact: { source_as_of: sourceAsOf },
  };
}

export function buildDetectionFloorTgaLane(report) {
  if (report === null || report === undefined) {
    return mapDetectionFloorTgaRow({
      id: "treasury_tga",
      label: "US Treasury TGA",
      enforcement: "live",
      kpi_required: true,
      status: "unobserved",
      reason: "workflow_unobserved",
      artifact: { status: "unobserved", reason: "workflow_unobserved", source_as_of: null },
    });
  }
  validateDetectionReport(report);
  if (report?.schema_version !== "data-supply-detection-floor/v1" || !Array.isArray(report?.lanes)) {
    throw new Error("detection floor report schema is malformed");
  }
  const matches = report.lanes.filter((item) => item?.id === "treasury_tga");
  if (matches.length !== 1) throw new Error(`detection floor treasury_tga cardinality is ${matches.length}`);
  return mapDetectionFloorTgaRow(matches[0]);
}

function trackById(coverageIndex, id) {
  return (coverageIndex?.public_scoring_readiness?.tracks || []).find((item) => item?.id === id) || null;
}

function allRequirementsReady(requirements) {
  return ["source_available", "normalized", "joined_to_target_universe", "scored", "public", "daily", "gated"]
    .every((key) => requirements?.[key] === true);
}

function compactEvidenceCheck(item) {
  return {
    id: item?.id ?? null,
    status: item?.status ?? null,
    source_date: item?.source_date ?? item?.latest_source_date ?? null,
    age_days: typeof item?.age_days === "number" ? item.age_days : null,
    max_age_days: typeof item?.max_age_days === "number" ? item.max_age_days : null,
    covered_count: typeof item?.covered_count === "number" ? item.covered_count : null,
    denominator: typeof item?.denominator === "number" ? item.denominator : null,
    missing_count: typeof item?.missing_count === "number" ? item.missing_count : null,
  };
}

function buildStockS0Lane(coverageIndex) {
  const track = trackById(coverageIndex, "active_stock_scoring_current");
  const evidence = track?.blocking_evidence || {};
  const evidenceChecks = (evidence.checks || []).map(compactEvidenceCheck);
  const readinessChecks = evidenceChecks.map((item) => check(
    item.id || "source_check",
    item.id || "source check",
    item.status === "ready" && item.missing_count === 0,
    `${number(item.covered_count).toLocaleString("ko-KR")} / ${number(item.denominator).toLocaleString("ko-KR")} · ${dateOnly(item.source_date) || "-"}`,
    item,
  ));
  return lane("stock_s0_active_daily_gate", "S0 active stocks daily gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("daily_ready", "daily ready", bool(evidence.daily_ready), "all active stock source lanes fresh"),
    check("gated_ready", "gated ready", bool(evidence.gated_ready), "gate blockers empty"),
    check("blockers_empty", "blockers", (evidence.blockers || []).length === 0, `${(evidence.blockers || []).length} blockers`),
    ...readinessChecks,
  ], {
    counts: {
      active_total: number(coverageIndex?.active_scoring_universe?.total),
      by_market: coverageIndex?.active_scoring_universe?.by_market || [],
      buckets: coverageIndex?.active_scoring_universe?.buckets || {},
      denominator: number(track?.denominator),
    },
    asOf: coverageIndex?.generated_at ?? null,
  });
}

function buildStockS1Lane(coverageIndex) {
  const track = trackById(coverageIndex, "expanded_stock_candidates");
  const promotion = track?.promotion_gate_readiness || {};
  const counts = promotion.counts || {};
  const denominator = number(counts.denominator || track?.denominator);
  const closedCount = number(counts.current_public_candidate_overlap_plus_blocked);
  return lane("stock_s1_candidate_gate", "S1 candidate promotion gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED with blocked ledger", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("artifact_present", "promotion artifact", bool(promotion.artifact_present), promotion.artifact_generated_at || "missing"),
    check("gap_partition_closed", "public plus blocked equals denominator", denominator > 0 && closedCount === denominator, `${closedCount.toLocaleString("ko-KR")} / ${denominator.toLocaleString("ko-KR")}`),
    check("promotion_queue_empty", "promotion queue", number(counts.promotion_rows) === 0, `${number(counts.promotion_rows)} rows`),
    check("blockers_empty", "gate blockers", (promotion.blockers || []).length === 0, `${(promotion.blockers || []).length} blockers`),
  ], {
    counts: {
      denominator,
      current_public_stock: number(counts.current_public_stock),
      current_public_candidate_overlap: number(counts.current_public_candidate_overlap),
      s1_gap_total: number(counts.s1_gap_total),
      promotion_count: number(counts.promotion_rows),
      blocked_excluded_count: number(counts.blocked_excluded_rows),
      current_public_candidate_overlap_plus_blocked: closedCount,
    },
    asOf: promotion.artifact_generated_at || coverageIndex?.generated_at || null,
  });
}

export function buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket) {
  const track = trackById(coverageIndex, "etf_scoring_lane");
  const counts = track?.evidence_based_readiness?.counts || {};
  const daily = etfDaily1y?.daily_1y_readiness || {};
  const core = etfCoreBasket?.readiness || {};
  const routeText = readText("100xfenok-next/src/app/api/data/fenok-etf-signals/[ticker]/route.ts");
  const staleRouteCaveat = /not PUBLIC\/DAILY\/GATED/i.test(routeText);
  return lane("etf_public_and_daily_gate", "ETF public scoring and daily gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("coverage_gate_ok", "coverage-index ETF gate", bool(track?.evidence_based_readiness?.gate_ok ?? track?.public_done_claim_allowed), track?.readiness_status || "missing"),
    diagnosticCheck("fetchable_daily_1y_gap_zero", "full scored-ETF daily 1Y diagnostic", number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable) === 0, `${number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable)} fetchable`, { service_gate: false }),
    diagnosticCheck("fetchable_plan_empty", "full scored-ETF exact fetchable plan", number(etfFetchablePlan?.counts?.fetchable) === 0 && (etfFetchablePlan?.tickers || []).length === 0, `${number(etfFetchablePlan?.counts?.fetchable)} fetchable`, { service_gate: false }),
    check("core_basket_ready", "ETF core daily basket", bool(core.core_daily_basket_ready) && number(core.stale_selected_count) === 0 && number(core.selected_count) >= number(core.min_selected_count), `${number(core.fresh_selected_count)} fresh / ${number(core.selected_count)} selected`),
    check("route_caveat_consistent", "ETF API public label", !staleRouteCaveat, staleRouteCaveat ? "route still says not PUBLIC/DAILY/GATED" : "route caveat matches ready public lane"),
  ], {
    counts: {
      eligible_etf_count: number(counts.eligible_etf_count || track?.denominator),
      scored_public_etf: number(counts.scored_public_etf),
      fetchable_daily_1y_gap: number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable),
      inception_limited_daily_1y_gap: number(counts.inception_limited_daily_1y_gap ?? daily.inception_limited_daily_1y_gap),
      terminal_limited_daily_1y_gap: number(counts.terminal_limited_daily_1y_gap ?? daily.terminal_limited_daily_1y_gap),
      core_selected_count: number(core.selected_count),
      core_fresh_selected_count: number(core.fresh_selected_count),
      core_stale_selected_count: number(core.stale_selected_count),
    },
    details: {
      full_daily_1y_diagnostic_service_gate: etfDaily1y?.raw_policy?.service_gate === true,
      exact_plan_batch_count: number(etfFetchablePlan?.bounded_batches?.batch_count),
    },
    asOf: etfDaily1y?.generated_at || coverageIndex?.generated_at || null,
  });
}

export function buildYahooBatchLane(state, nowIso = state?.generated_at) {
  const counts = state?.counts || {};
  const currentAttempt = state?.current_attempt || {};
  const pendingDetails = (Array.isArray(state?.pending_details) ? state.pending_details : [])
    .slice(0, 20)
    .map((item) => ({
      symbol: item?.symbol ?? null,
      discovered_from: Array.isArray(item?.discovered_from) ? item.discovered_from.slice(0, 8) : [],
      missing: Array.isArray(item?.missing) ? item.missing.slice(0, 8) : [],
      first_trade_date: item?.first_trade_date ?? null,
      initial_attempt_ref: item?.initial_run_id ?? null,
      expected_resolution: item?.expected_resolution ?? null,
      reason: item?.reason ?? "newly_discovered_no_history",
    }));
  const lkgDetails = (Array.isArray(state?.lkg_details) ? state.lkg_details : [])
    .filter((item) => typeof item?.failure_run_id === "string" && item.failure_run_id.length > 0)
    .slice(0, 20)
    .map((item) => ({
      symbol: item?.symbol ?? null,
      payload_sha256: item?.payload_sha256 ?? null,
      source_as_of: item?.source_as_of ?? null,
      failure_attempt_ref: item?.failure_run_id ?? null,
      failure_observed_at: item?.failure_observed_at ?? null,
    }));
  const staleGroups = (Array.isArray(state?.stale_groups) ? state.stale_groups : [])
    .map((item) => {
      const sourceAsOf = item?.source_as_of ?? null;
      return {
        source_as_of: sourceAsOf,
        source_age_business_days: sourceAsOf
          ? yahooBusinessDayAge(dateOnly(sourceAsOf), nowIso, (item?.symbols || [])[0])
          : null,
        max_source_age_business_days: YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
        expected_resolution: item?.expected_resolution ?? "next_natural_yahoo_run",
        symbols: Array.isArray(item?.symbols)
          ? [...new Set(item.symbols.filter((value) => typeof value === "string"))].sort()
          : [],
      };
    })
    .filter((item) => item.symbols.length > 0);
  const oldestSourceAsOf = state?.oldest_source_as_of;
  const oldestSourceDate = dateOnly(oldestSourceAsOf);
  const oldestSourceValid = typeof oldestSourceAsOf === "string"
    && (/^\d{4}-\d{2}-\d{2}$/.test(oldestSourceAsOf)
      || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(oldestSourceAsOf))
    && isRealCalendarDate(oldestSourceDate)
    && Number.isFinite(new Date(oldestSourceAsOf).getTime());
  const oldestSourceFuture = oldestSourceValid
    && Number.isFinite(new Date(state?.generated_at).getTime())
    && new Date(oldestSourceAsOf).getTime() > new Date(state.generated_at).getTime();
  const oldestSourceAge = oldestSourceValid
    ? yahooBusinessDayAge(oldestSourceDate, nowIso, state?.oldest_source_ticker)
    : null;
  const oldestSourceFresh = oldestSourceAge != null && oldestSourceAge <= YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS;
  const publicAttempt = {
    attempt_ref: currentAttempt.run_id ?? null,
    attempt_number: number(currentAttempt.run_attempt, 1),
    event_name: currentAttempt.event_name ?? null,
    schedule: currentAttempt.schedule ?? null,
    natural: currentAttempt.natural === true,
    attempted: number(currentAttempt.attempted),
    successes: number(currentAttempt.successes),
    failed: number(currentAttempt.failed),
    skipped: number(currentAttempt.skipped),
    fetch_attempts: number(currentAttempt.fetch_attempts),
  };
  const exclusiveCount = number(counts.fresh)
    + number(counts.lkg)
    + number(counts.pending_history)
    + number(counts.unavailable);
  const pendingDetail = pendingDetails.length > 0
    ? pendingDetails.map((item) => (
      `${item.symbol || "unknown"} is ${item.reason === "recent_listing" ? "a recent listing" : "newly discovered"} from ${(item.discovered_from || []).join(", ") || "an active-universe source"}; `
      + `${(item.missing || ["history"]).join(", ")} is missing and will self-resolve on the next natural Yahoo run.`
    )).join(" ")
    : `${number(counts.pending_history)} pending-history symbol(s)`;
  const lkgDetail = lkgDetails.length > 0
    ? lkgDetails.map((item) => (
      `${item.symbol || "unknown"} holds LKG after failing run ${item.failure_attempt_ref || "unknown"}; `
      + `source date ${dateOnly(item.source_as_of) || "unstamped"}; payload hash ${item.payload_sha256 || "missing"}.`
    )).join(" ")
    : `${number(counts.lkg)} LKG symbol(s)`;
  const staleDetail = staleGroups.length > 0
    ? staleGroups.map((item) => (
      `${item.symbols.join(", ")} hold LKG because Yahoo source date ${dateOnly(item.source_as_of) || "unstamped"} `
      + `is ${item.source_age_business_days ?? "unknown"} business days old, beyond the ${item.max_source_age_business_days}-day bound; `
      + "queued for the next natural Yahoo run."
    )).join(" ")
    : "";
  const lkgStatusDetail = [lkgDetail, staleDetail].filter(Boolean).join(" ");
  return lane("yahoo_batch_quote_history", "Yahoo batch quote/history", [
    check("state_artifact_present", "Yahoo bounded state", Boolean(state), state?.generated_at || "missing"),
    check(
      "active_universe_accounted",
      "active-universe state coverage",
      number(counts.active) > 0 && number(counts.untracked) === 0 && exclusiveCount === number(counts.active),
      `${exclusiveCount} classified / ${number(counts.active)} active; ${number(counts.untracked)} untracked`,
    ),
    check(
      "current_attempt_evidence",
      "current attempt evidence",
      typeof currentAttempt.run_id === "string"
        && ["attempted", "successes", "failed", "skipped", "fetch_attempts"].every((key) => Number.isFinite(Number(currentAttempt[key]))),
      `run ${currentAttempt.run_id || "missing"}: attempted=${number(currentAttempt.attempted)}, success=${number(currentAttempt.successes)}, failed=${number(currentAttempt.failed)}, skipped=${number(currentAttempt.skipped)}, fetch_attempts=${number(currentAttempt.fetch_attempts)}`,
    ),
    check("oldest_source_stamp_valid", "oldest Yahoo source timestamp", oldestSourceValid, oldestSourceAsOf || "missing"),
    check("oldest_source_not_future", "Yahoo source timestamp chronology", oldestSourceValid && !oldestSourceFuture, oldestSourceFuture ? `${oldestSourceAsOf} follows ${state?.generated_at || "missing build time"}` : oldestSourceAsOf || "missing"),
    check("oldest_source_fresh", "oldest Yahoo source age", oldestSourceFresh, `${oldestSourceAge ?? "unknown"} / ${YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS} business days`),
    check("no_current_failures", "current Yahoo attempt failures", number(currentAttempt.failed) === 0, `run ${currentAttempt.run_id || "missing"}: ${number(currentAttempt.failed)} failed`),
    check("no_lkg_primary", "LKG primary", number(counts.lkg) === 0, lkgStatusDetail),
    check("no_pending_history", "pending Yahoo history", number(counts.pending_history) === 0, pendingDetail),
    check("no_unavailable", "Yahoo unavailable", number(counts.unavailable) === 0, `${number(counts.unavailable)} unavailable`),
    check("retry_set_empty", "Yahoo retry set", number(counts.retry) === 0, `${number(counts.retry)} active-universe retry candidate(s)`),
  ], {
    counts: {
      active: number(counts.active),
      untracked: number(counts.untracked),
      fresh: number(counts.fresh),
      lkg: number(counts.lkg),
      pending_history: number(counts.pending_history),
      unavailable: number(counts.unavailable),
      retry: number(counts.retry),
      failed: number(counts.failed),
      stale: number(counts.stale),
      oldest_source_date: oldestSourceValid ? oldestSourceDate : null,
      oldest_source_symbol: state?.oldest_source_ticker ?? null,
      oldest_source_age_business_days: oldestSourceAge,
      max_source_age_business_days: YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
    },
    details: {
      latest_attempt: publicAttempt,
      state_generated_at: state?.generated_at ?? null,
      lkg: lkgDetails,
      stale_groups: staleGroups,
      pending_history: pendingDetails,
      recovery_policy: "Retry active failures first on the next natural Yahoo run; promote fresh automatically on success.",
    },
    asOf: oldestSourceValid ? oldestSourceAsOf : null,
  });
}

const STRICT_ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function findNonFinite(value, pointer = "$") {
  if (typeof value === "number" && !Number.isFinite(value)) return pointer;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNonFinite(value[index], `${pointer}[${index}]`);
      if (found) return found;
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const found = findNonFinite(child, `${pointer}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

function readSlickChartsArtifact(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { kind: "missing", reason: "file is missing" };
    return { kind: "corrupt", reason: `file cannot be read: ${error?.message || "unknown error"}` };
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    return { kind: "corrupt", reason: `malformed JSON: ${error.message}` };
  }
  const nonFiniteAt = findNonFinite(payload);
  if (nonFiniteAt) return { kind: "corrupt", reason: `non-finite number at ${nonFiniteAt}` };
  return { kind: "parsed", payload };
}

function strictDeliveryTimestamp(value, nowIso) {
  if (typeof value !== "string" || !STRICT_ISO_TIMESTAMP_RE.test(value)) {
    return { valid: false, reason: "updated is missing or not an ISO timestamp with timezone" };
  }
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return { valid: false, reason: "updated is not a real timestamp" };
  const normalized = new Date(ms).toISOString();
  if (isFutureSource(normalized, nowIso, "hours")) {
    return { valid: false, reason: `updated ${normalized} is in the future` };
  }
  return { valid: true, normalized, age_hours: hoursAge(normalized, nowIso) };
}

export function assessSlickChartsDelivery(nowIso, { dataRoot = DATA_ROOT } = {}) {
  const base = path.join(dataRoot, "slickcharts");
  const universeResult = readSlickChartsArtifact(path.join(base, "universe.json"));
  const identityIssues = [];
  const scopeIssues = [];
  let symbols = [];
  if (universeResult.kind === "parsed") {
    const rows = universeResult.payload?.stocks;
    if (!Array.isArray(rows) || rows.length === 0) {
      identityIssues.push("universe.json stocks is missing or empty");
    } else {
      const rawSymbols = rows.map((row) => String(row?.symbol || "").trim().toUpperCase());
      if (rawSymbols.some((symbol) => !symbol)) identityIssues.push("universe.json contains a blank symbol");
      const duplicates = [...new Set(rawSymbols.filter((symbol, index) => symbol && rawSymbols.indexOf(symbol) !== index))].sort();
      if (duplicates.length > 0) identityIssues.push(`universe.json contains duplicate symbols: ${duplicates.slice(0, 20).join(", ")}`);
      symbols = [...new Set(rawSymbols.filter(Boolean))].sort();
      if (Number(universeResult.payload?.uniqueCount) !== symbols.length) {
        identityIssues.push(`universe.json uniqueCount ${universeResult.payload?.uniqueCount ?? "missing"} does not match ${symbols.length}`);
      }
    }
  } else if (universeResult.kind === "missing") {
    scopeIssues.push("universe.json is missing; current stock-file scope cannot be enumerated");
  } else {
    scopeIssues.push(`universe.json is invalid: ${universeResult.reason}`);
  }

  const artifacts = [];
  for (const group of SLICKCHARTS_DELIVERY_GROUPS) {
    for (const filename of group.files) {
      artifacts.push({ group, artifact: filename, symbol: null, filePath: path.join(base, filename) });
    }
    if (group.include_current_universe) {
      for (const symbol of symbols) {
        artifacts.push({ group, artifact: `stocks/${symbol}.json`, symbol, filePath: path.join(base, "stocks", `${symbol}.json`) });
      }
    }
  }

  const offenders = [];
  const rows = [];
  let corruptionCount = universeResult.kind === "corrupt" ? 1 : 0;
  for (const item of artifacts) {
    const read = readSlickChartsArtifact(item.filePath);
    if (read.kind === "missing") {
      rows.push({ ...item, status: "missing", delivery_at: null, age_hours: null, reason: read.reason });
      continue;
    }
    if (read.kind === "corrupt") {
      corruptionCount += 1;
      rows.push({ ...item, status: "invalid", delivery_at: null, age_hours: null, reason: read.reason, integrity: "corrupt" });
      continue;
    }
    if (item.symbol && String(read.payload?.symbol || "").trim().toUpperCase() !== item.symbol) {
      identityIssues.push(`${item.artifact} identity ${read.payload?.symbol ?? "missing"} does not match ${item.symbol}`);
      rows.push({ ...item, status: "invalid", delivery_at: null, age_hours: null, reason: "payload symbol does not match universe identity", integrity: "identity" });
      continue;
    }
    const stamp = strictDeliveryTimestamp(read.payload?.updated, nowIso);
    if (!stamp.valid) {
      rows.push({ ...item, status: "invalid", delivery_at: null, age_hours: null, reason: stamp.reason, integrity: "delivery" });
      continue;
    }
    rows.push({
      ...item,
      status: stamp.age_hours > item.group.max_hours ? "stale" : "current",
      delivery_at: stamp.normalized,
      age_hours: stamp.age_hours,
      reason: stamp.age_hours > item.group.max_hours
        ? `${stamp.age_hours}h old exceeds ${item.group.max_hours}h delivery SLA`
        : null,
    });
  }

  for (const row of rows.filter((item) => item.status !== "current")) {
    offenders.push({
      workflow_id: row.group.workflow,
      artifact: row.artifact,
      symbol: row.symbol,
      reason: row.reason,
      delivery_at: row.delivery_at,
      age_hours: row.age_hours,
      max_hours: row.group.max_hours,
      status: row.status,
    });
  }
  for (const issue of scopeIssues) offenders.unshift({
    workflow_id: "slickcharts-history",
    artifact: "universe.json",
    symbol: null,
    reason: issue,
    delivery_at: null,
    age_hours: null,
    max_hours: 750,
    status: "missing",
  });
  for (const issue of identityIssues) offenders.unshift({
    workflow_id: "slickcharts-history",
    artifact: "universe.json",
    symbol: null,
    reason: issue,
    delivery_at: null,
    age_hours: null,
    max_hours: 750,
    status: "invalid",
  });

  const workflowSla = SLICKCHARTS_DELIVERY_GROUPS.map((group) => {
    const groupRows = rows.filter((row) => row.group.id === group.id);
    const validDeliveries = groupRows.filter((row) => row.delivery_at).map((row) => row.delivery_at).sort();
    const complete = groupRows.length > 0 && groupRows.every((row) => ["current", "stale"].includes(row.status));
    return {
      source_id: group.id,
      workflow_id: group.workflow,
      max_hours: group.max_hours,
      required: groupRows.length,
      current: groupRows.filter((row) => row.status === "current").length,
      missing: groupRows.filter((row) => row.status === "missing").length,
      stale: groupRows.filter((row) => row.status === "stale").length,
      invalid: groupRows.filter((row) => row.status === "invalid").length,
      oldest_delivery_at: complete ? validDeliveries[0] ?? null : null,
    };
  });
  const counts = {
    required: rows.length,
    fixed: SLICKCHARTS_DELIVERY_GROUPS.reduce((sum, group) => sum + group.files.length, 0),
    current_universe: symbols.length,
    current: rows.filter((row) => row.status === "current").length,
    missing: rows.filter((row) => row.status === "missing").length,
    stale: rows.filter((row) => row.status === "stale").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
  };
  const validDeliveries = rows.filter((row) => row.delivery_at).map((row) => row.delivery_at).sort();
  return {
    counts,
    corruption_count: corruptionCount,
    identity_issues: identityIssues,
    scope_issues: scopeIssues,
    offenders: offenders.slice(0, 20),
    workflow_sla: workflowSla,
    oldest_delivery_at: validDeliveries[0] ?? null,
    timestamp_semantics: "updated is Fenok fetch/write delivery time, not provider publication time.",
  };
}

export function buildSlickChartsDeliveryLane(nowIso, { dataRoot = DATA_ROOT, assessment = null } = {}) {
  const result = assessment || assessSlickChartsDelivery(nowIso, { dataRoot });
  const counts = result.counts;
  const first = result.offenders[0];
  const summary = `${counts.current} current, ${counts.missing} missing, ${counts.stale} stale, ${counts.invalid} invalid`
    + (first ? `; ${first.workflow_id}/${first.artifact}: ${first.reason}` : "");
  return lane("slickcharts_delivery_freshness", "SlickCharts delivery freshness", [
    check("json_integrity", "SlickCharts JSON integrity", result.corruption_count === 0, result.corruption_count === 0 ? "all required JSON is parseable and finite" : `${result.corruption_count} malformed or non-finite artifact(s)`),
    check("universe_identity", "SlickCharts universe identity", result.identity_issues.length === 0, result.identity_issues[0] || "universe identities are consistent"),
    check("delivery_ready", "SlickCharts delivery readiness", counts.missing === 0 && counts.stale === 0 && counts.invalid === 0 && result.scope_issues.length === 0, summary),
  ], {
    counts,
    details: {
      workflow_sla: result.workflow_sla,
      offenders: result.offenders,
      timestamp_semantics: result.timestamp_semantics,
      scope_issues: result.scope_issues,
    },
    asOf: result.oldest_delivery_at,
  });
}

export function buildRimLane(rimInputs) {
  const indexRows = Object.entries(rimInputs?.indices || {}).map(([id, item]) => {
    const blockers = Array.isArray(item?.blockers) ? item.blockers : [];
    return {
      id,
      role: item?.role ?? null,
      public_status: item?.public_status ?? null,
      forecast_status: item?.derived?.forecast_grid_v1?.public_status ?? null,
      blocker_count: blockers.length,
      required: REQUIRED_RIM_INDICES.includes(id),
    };
  });
  const checks = REQUIRED_RIM_INDICES.map((id) => {
    const item = rimInputs?.indices?.[id];
    const blockers = Array.isArray(item?.blockers) ? item.blockers : [];
    return check(
      `rim_${id.toLowerCase()}_ready`,
      `${id} RIM input`,
      item?.public_status === "ready_inputs_and_forecast_grid" && blockers.length === 0,
      item?.derived?.forecast_grid_v1?.public_status || item?.public_status || "missing",
      { index_id: id, role: item?.role ?? null, blocker_count: blockers.length },
    );
  });
  const ccmp = rimInputs?.indices?.CCMP;
  if (ccmp) {
    checks.push(warningCheck("rim_ccmp_input_only", "CCMP public card", "CCMP remains input-only/blocked for public result cards", {
      required: false,
      blocker_count: (ccmp.blockers || []).length,
      public_status: ccmp.public_status,
    }));
  }
  return lane("rim_inputs", "RIM inputs", checks, {
    counts: {
      required_ready: checks.filter((item) => item.required !== false && item.status === "ready").length,
      required_total: REQUIRED_RIM_INDICES.length,
      indices: indexRows,
    },
    details: {
      output_scope: rimInputs?.output_scope ?? null,
      no_public_single_target: rimInputs?.policy?.no_public_single_target === true,
      public_mirror_policy: rimInputs?.public_mirror_policy ?? null,
    },
    asOf: rimInputs?.generated_at ?? null,
  });
}

function buildProductSurfaceLane(productCoverage) {
  const totals = productCoverage?.totals || {};
  return lane("product_surface_freshness", "Product surface freshness", [
    check("surface_payload_present", "product-surface-coverage", Boolean(productCoverage), productCoverage?.generated_at || "missing"),
    check("no_stale_surfaces", "stale surfaces", number(totals.stale) === 0, `${number(totals.stale)} stale`),
    check("no_unavailable_surfaces", "unavailable surfaces", number(totals.unavailable) === 0, `${number(totals.unavailable)} unavailable`),
    check("no_error_surfaces", "error surfaces", number(totals.error) === 0, `${number(totals.error)} error`),
  ], {
    counts: {
      surfaces: number(totals.surfaces),
      ready: number(totals.ready),
      partial: number(totals.partial),
      pending: number(totals.pending),
      stale: number(totals.stale),
      unavailable: number(totals.unavailable),
      error: number(totals.error),
    },
    asOf: productCoverage?.generated_at ?? null,
  });
}

export function buildFinraOccLane(ledger, occAvailability = null) {
  const counts = ledger?.counts || {};
  const publicLedgerExists = exists("data/admin/fenok-s0-finra-occ-mapping-ledger.json", PUBLIC_DATA_ROOT);
  const occAttempt = occAvailability?.current_attempt;
  const occAttemptReady = ["ready_current", "no_selected_scope"].includes(occAttempt?.status);
  const publicOccAttempt = occAttempt && typeof occAttempt === "object" ? {
    attempt_ref: occAttempt.attempt_ref ?? null,
    attempt_number: number(occAttempt.attempt_number, 1),
    observed_at: occAttempt.observed_at ?? null,
    target_source_date: occAttempt.target_source_date ?? null,
    served_source_date: occAttempt.served_source_date ?? null,
    status: occAttempt.status ?? "unavailable",
    fallback_active: occAttempt.fallback_active === true,
    selected_symbol_count: number(occAttempt.selected_tickers),
    message: occAttempt.message ?? "OCC current-attempt verdict is missing.",
  } : null;
  return lane("finra_occ_plain_us_and_mapping_policy", "FINRA/OCC source gate", [
    check("ledger_acceptance", "ledger acceptance", ledger?.source_audit?.acceptance_ok === true, ledger?.generated_at || "missing", { platform_blocking: true }),
    check("finra_plain_us_ready", "plain US FINRA", number(counts.plain_us_finra_source_ready) === number(counts.plain_us_finra_denominator), `${number(counts.plain_us_finra_source_ready)} / ${number(counts.plain_us_finra_denominator)}`),
    check("occ_plain_us_ready", "plain US OCC", number(counts.plain_us_occ_source_ready) === number(counts.plain_us_occ_denominator), `${number(counts.plain_us_occ_source_ready)} / ${number(counts.plain_us_occ_denominator)}`),
    check("occ_current_delivery_ready", "OCC current delivery", occAttemptReady, publicOccAttempt?.message || "OCC current-attempt evidence is missing; prior data may still be served."),
    check("non_plain_not_service_blocker", "non-plain policy", ledger?.service_boundary?.active_s0_daily_source_gate_blocker === false, ledger?.service_boundary?.reason || "missing"),
    check("ledger_private_only", "ledger public mirror", !publicLedgerExists && ledger?.raw_policy?.admin_local_only === true, publicLedgerExists ? "public mirror exists" : "admin-local only", { platform_blocking: true }),
  ], {
    counts: {
      active_us_total: number(counts.active_us_total),
      plain_us_finra_denominator: number(counts.plain_us_finra_denominator),
      plain_us_finra_source_ready: number(counts.plain_us_finra_source_ready),
      plain_us_occ_denominator: number(counts.plain_us_occ_denominator),
      plain_us_occ_source_ready: number(counts.plain_us_occ_source_ready),
      non_plain_daily_ready: number(counts.finra_excluded_us_class_or_non_plain_daily_ready || counts.occ_excluded_us_class_or_non_plain_daily_ready),
      mapping_required_count: number(counts.finra_mapping_required_missing_row) + number(counts.occ_non_plain_mapping_required) + number(counts.occ_class_share_normalization_required),
    },
    details: {
      source_dates: ledger?.source_audit?.source_dates ?? null,
      action_policy: ledger?.action_policy ?? [],
      occ_current_attempt: publicOccAttempt,
    },
    asOf: ledger?.generated_at ?? null,
  });
}

function workflowCheck(file, token) {
  return readText(file).includes(token);
}

function buildAutomationLane() {
  return lane("automation_contract", "Daily automation and deploy gates", [
    check("sync_static_builds_kpi", "sync-static KPI build", workflowCheck("100xfenok-next/package.json", "build:fenok-data-health-kpi"), "package script wiring", { platform_blocking: true }),
    check("sync_static_checks_kpi", "sync-static KPI check", workflowCheck("100xfenok-next/package.json", "qa:fenok-data-health-kpi"), "package gate wiring", { platform_blocking: true }),
    check("update_manifest_rebuilds_kpi", "manifest reconciliation", workflowCheck(".github/workflows/update-manifest.yml", "build:fenok-data-health-kpi"), "update-manifest rebuild path", { platform_blocking: true }),
    check("deploy_worker_checks_kpi", "Worker deploy gate", workflowCheck(".github/workflows/deploy-worker.yml", "qa:fenok-data-health-kpi"), "deploy prebuild gate", { platform_blocking: true }),
    check("deploy_worker_smokes_kpi", "Worker live KPI smoke", workflowCheck(".github/workflows/deploy-worker.yml", "Smoke data health KPI"), "deploy post-smoke contract", { platform_blocking: true }),
    check("phase_b_checker_strict", "Phase B checker strict mode", workflowCheck("100xfenok-next/package.json", "check-fenok-data-health-kpi.mjs --strict"), "strict checker wiring", { platform_blocking: true }),
    check("phase_b_pending_max_age", "Phase B pending age enforcement", workflowCheck("100xfenok-next/scripts/check-fenok-data-health-kpi.mjs", "PENDING_MAX_AGE_DAYS") && workflowCheck("100xfenok-next/package.json", "check-fenok-data-health-kpi.mjs --strict"), "14-day pending exemption expiry is active under strict", { platform_blocking: true }),
    check("deploy_worker_smoke_strict", "Worker live KPI smoke strict mode", workflowCheck(".github/workflows/deploy-worker.yml", "KPI v2 producer freshness (strict, Phase B)"), "live producer freshness fails closed", { platform_blocking: true }),
    check("yf_daily_no_default_cap", "YF daily stock shards no silent cap", workflowCheck(".github/workflows/fetch-yf-finance.yml", 'INPUT_LIMIT="${YF_DAILY_STOCK_LIMIT:-}"'), "future active universe expansion does not silently fall outside freshness", { platform_blocking: true }),
    check("stockanalysis_daily1y_scheduled", "StockAnalysis daily-1Y schedule", workflowCheck(".github/workflows/fetch-stockanalysis.yml", "50 22 * * 1-5") && workflowCheck(".github/workflows/fetch-stockanalysis.yml", "daily_1y"), "weekday catch-up lane", { platform_blocking: true }),
    check("edge_daily_dispatches_manifest", "Edge daily manifest dispatch", workflowCheck(".github/workflows/fenok-edge-daily.yml", "gh workflow run update-manifest.yml"), "manifest/RIM/deploy chain", { platform_blocking: true }),
    check("krx_daily_dispatches_manifest", "KRX daily manifest dispatch", workflowCheck(".github/workflows/fenok-edge-krx-daily.yml", "gh workflow run update-manifest.yml"), "manifest/RIM/deploy chain", { platform_blocking: true }),
  ], {
    details: {
      credential_dependent_for_build: false,
      github_api_polling_required: false,
      deploy_secret_required_only_for_wrangler: true,
    },
    asOf: new Date().toISOString(),
  });
}

function buildPublicMirrorLane(rimInputs) {
  const rimPublicText = readText("data/computed/rim-index/inputs.json", PUBLIC_DATA_ROOT);
  const coveragePublicText = readText("data/admin/fenok-edge-coverage-index.json", PUBLIC_DATA_ROOT);
  const forbidden = ["_private/", "\"private_manifest_file\"", "\"manifest_file\""];
  const publicText = `${rimPublicText}\n${coveragePublicText}`;
  return lane("public_mirror_safety", "Public mirror safety", [
    check("kpi_public_mirror", "KPI public mirror", true, "root and public KPI are written together", { platform_blocking: true }),
    check("rim_public_private_paths_redacted", "RIM private paths", !forbidden.some((token) => rimPublicText.includes(token)), "public RIM mirror token scan", { platform_blocking: true }),
    check("coverage_public_private_paths_absent", "coverage private paths", !forbidden.some((token) => coveragePublicText.includes(token)), "public coverage mirror token scan", { platform_blocking: true }),
    check("forbidden_tokens_absent", "forbidden public tokens", !forbidden.some((token) => publicText.includes(token)), "aggregate public token scan", { platform_blocking: true }),
  ], {
    details: {
      rim_public_mirror_policy: rimInputs?.public_mirror_policy ?? null,
      full_finra_occ_ledger_public: exists("data/admin/fenok-s0-finra-occ-mapping-ledger.json", PUBLIC_DATA_ROOT),
      full_etf_daily1y_readiness_public: exists("data/admin/fenok-edge-etf-daily1y-readiness.json", PUBLIC_DATA_ROOT),
    },
  });
}

function summarize(lanes) {
  const totals = lanes.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    if (item.required !== false && item.status !== "ready") acc.required_not_ready += 1;
    return acc;
  }, { lanes: lanes.length, ready: 0, degraded: 0, warning: 0, blocked: 0, unavailable: 0, required_not_ready: 0 });
  const blockers = lanes.flatMap((item) => (item.checks || [])
    .filter((entry) => entry.platform_blocking === true && entry.status !== "ready")
    .map((entry) => ({ lane_id: item.id, check_id: entry.id, label: entry.label, detail: entry.detail })));
  totals.platform_blocking_not_ready = blockers.length;
  const deploymentIntegrity = {
    status: blockers.length > 0 ? "blocked" : "ready",
    status_label: statusLabel(blockers.length > 0 ? "blocked" : "ready"),
    status_message: blockers.length > 0
      ? `${blockers.length} platform integrity blocker(s) must halt publication.`
      : "Platform integrity gates are ready; degraded lanes may publish independently.",
    blocker_count: blockers.length,
    blockers,
  };
  const overallStatus = deploymentIntegrity.status === "blocked"
    ? "blocked"
    : totals.required_not_ready > 0 ? "degraded" : "ready";
  return { overallStatus, totals, deploymentIntegrity };
}

// product_surface_coverage source stamp = OLDEST of the required surfaces' TRUE
// source dates (.surfaces[REQUIRED_SURFACE_IDS].source_as_of), stamped by
// generate-product-surface-coverage.mjs — NEVER the rebuild as_of. Fail-closed: if
// ANY required surface lacks a real stamp (source_as_of null), the aggregate is null
// and the KPI keeps it unavailable_pending_source_stamp (no guessing). It lifts to
// ready/stale automatically once every required surface carries a true stamp.
function productSurfaceRequiredRows(productCoverage) {
  // Preserve duplicates (do NOT collapse via a Map) AND preserve own-property presence
  // of source_as_of (do NOT `?? null` normalize) so the classifier can distinguish
  // ABSENT (bootstrap / structural) from EXACT null (rev5.5).
  return (Array.isArray(productCoverage?.surfaces) ? productCoverage.surfaces : [])
    .filter((s) => REQUIRED_SURFACE_IDS.includes(s?.id))
    .map((s) => (hasOwn(s, "source_as_of") ? { id: s.id, source_as_of: s.source_as_of } : { id: s.id }));
}

function buildProductSurfaceEntry({ def, productCoverage, nowIso, priorPending }) {
  const requiredRows = productSurfaceRequiredRows(productCoverage);
  const stampMarkerPresent = hasOwn(productCoverage, "source_stamp_version");
  const stampMarkerValue = stampMarkerPresent ? productCoverage.source_stamp_version : undefined;
  const cls = classifyProductSurface(requiredRows, nowIso, { stampMarkerPresent, stampMarkerValue });
  const priorPendingSince = priorPending?.pending_since ?? null;
  const priorEverStamped = priorPending?.ever_stamped === true;
  // ever_stamped is MONOTONIC: true once fully-stamped is ever observed; no build path
  // may write it back to false (anti-oscillation, rev5.4).
  const everStamped = priorEverStamped || cls.kind === "stamped";
  const base = {
    source_id: def.source_id,
    freshness_basis: def.freshness_basis,
    unit: def.unit,
    calendar: def.calendar,
    max_staleness: def.max_staleness,
    required: def.required,
    // Emit source_stamp_version as an OWN property ONLY when the artifact carried it
    // (mirrors the artifact so the checker re-derives absent-vs-present, incl. bad values).
    ...(stampMarkerPresent ? { source_stamp_version: stampMarkerValue } : {}),
    required_surface_rows: requiredRows,
  };
  // ANOMALY / hard states PRESERVE the prior pending_since UNCHANGED (rev5.6) — never
  // reset it to null (that laundered the 14d clock: pending -> future -> pending
  // restarted at now). Only pending sets it, only stamped clears it.
  if (cls.kind === "shape_error") {
    return { ...base, source_date: null, age: null, status: "error", shape_error: true, shape_errors: cls.shape_errors, pending: { pending_since: priorPendingSince, ever_stamped: everStamped } };
  }
  if (cls.kind === "future") {
    return {
      ...base,
      source_date: cls.source_date,
      age: evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso }),
      status: "future_date_anomaly",
      future_date_anomaly: true,
      pending: { pending_since: priorPendingSince, ever_stamped: everStamped },
    };
  }
  if (cls.kind === "pending") {
    // Sticky pending_since: preserve the prior first-seen timestamp (incl. one carried
    // THROUGH an anomaly state); only initialize to now when there was truly no prior.
    return {
      ...base,
      source_date: null,
      age: null,
      status: "unavailable_pending_source_stamp",
      pending_source_stamp: true,
      pending: { pending_since: priorPendingSince ?? nowIso, ever_stamped: everStamped },
    };
  }
  // stamped: clears the pending clock (pending_since null), ever_stamped true.
  const age = evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso });
  return { ...base, source_date: cls.source_date, age, status: slaStatusForAge(age, def.max_staleness), pending: { pending_since: null, ever_stamped: true } };
}

function buildSourceSla({ nowIso, finraOccLedger, rimInputs, etfCoreBasket, coverageIndex, productCoverage, etfDaily1y, priorProductSurfacePending, slickchartsDelivery }) {
  const sourceDates = {
    s0_finra_occ_mapping_ledger: oldestRequiredIsoDate([
      finraOccLedger?.source_audit?.source_dates?.finra_source_date,
      finraOccLedger?.source_audit?.source_dates?.occ_source_date,
    ]),
    rim_index_inputs: oldestRequiredIsoDate(
      REQUIRED_RIM_INDICES.map((id) => rimInputs?.indices?.[id]?.observed?.price?.as_of),
    ),
    etf_core_daily_basket_admin: oldestRequiredIsoDate(
      (Array.isArray(etfCoreBasket?.rows) ? etfCoreBasket.rows : []).map((row) => row?.proof?.quote_date),
    ),
    fenok_edge_coverage_index: isoDateOf(coverageIndex?.source_as_of),
    // product_surface_coverage handled by buildProductSurfaceEntry (shape-strict).
    // hours unit keeps the raw timestamp (not date-truncated).
    etf_daily1y_readiness_admin: etfDaily1y?.generated_at ?? null,
    ...Object.fromEntries((slickchartsDelivery?.workflow_sla || []).map((row) => [row.source_id, row.oldest_delivery_at])),
  };

  return SOURCE_SLA_DEF.map((def) => {
    // product_surface_coverage: shape-strict classify + sticky pending_since (rev5.3).
    if (def.source_id === "product_surface_coverage") {
      return buildProductSurfaceEntry({ def, productCoverage, nowIso, priorPending: priorProductSurfacePending });
    }

    const sourceDate = sourceDates[def.source_id] ?? null;
    const flags = {};

    // Future-dated source: age helpers clamp future to 0 (would read fresh); flag it.
    if (isFutureSource(sourceDate, nowIso, def.unit)) {
      return {
        source_id: def.source_id,
        freshness_basis: def.freshness_basis,
        source_date: sourceDate,
        unit: def.unit,
        calendar: def.calendar,
        max_staleness: def.max_staleness,
        required: def.required,
        age: evaluateSlaAge({ sourceDate, unit: def.unit, calendar: def.calendar, nowIso }),
        status: "future_date_anomaly",
        future_date_anomaly: true,
      };
    }

    const age = evaluateSlaAge({ sourceDate, unit: def.unit, calendar: def.calendar, nowIso });
    let status = slaStatusForAge(age, def.max_staleness);
    if (def.source_id === "etf_core_daily_basket_admin") {
      // Reuse the existing basket gate: not-ready or any stale selection forces stale.
      const coreReady = etfCoreBasket?.readiness?.core_daily_basket_ready === true;
      const staleSelected = Number(etfCoreBasket?.coverage?.stale_selected_count) || 0;
      if (status === "ready" && (!coreReady || staleSelected > 0)) {
        status = "stale";
        flags.gate_override_stale = true;
      }
    }
    return {
      source_id: def.source_id,
      freshness_basis: def.freshness_basis,
      source_date: sourceDate,
      unit: def.unit,
      calendar: def.calendar,
      max_staleness: def.max_staleness,
      required: def.required,
      age,
      status,
      ...flags,
    };
  });
}

function buildPayload(nowIso, priorRuntime, priorProductSurfacePending) {
  const coverageIndex = readJson("admin/fenok-edge-coverage-index.json");
  const rimInputs = readJson("computed/rim-index/inputs.json") || readJson("computed/rim-index/inputs.json", PUBLIC_DATA_ROOT);
  const productCoverage = readJson("admin/product-surface-coverage.json");
  const finraOccLedger = readJson("admin/fenok-s0-finra-occ-mapping-ledger.json");
  const etfDaily1y = readJson("admin/fenok-edge-etf-daily1y-readiness.json");
  const etfFetchablePlan = readJson("admin/fenok-edge-etf-daily1y-fetchable-plan.json");
  const etfCoreBasket = readJson("admin/fenok-etf-core-daily-basket.json");
  const yahooBatchState = readJson("admin/yahoo-batch-quote-history/index.json");
  const occAvailability = readJson("computed/fenok_occ_options_availability.json");
  const detectionFloor = readOptionalJsonStrict("admin/data-supply-detection-floor.json");
  const slickchartsDelivery = assessSlickChartsDelivery(nowIso);

  const lanes = [
    buildStockS0Lane(coverageIndex),
    buildStockS1Lane(coverageIndex),
    buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket),
    buildYahooBatchLane(yahooBatchState, nowIso),
    buildSlickChartsDeliveryLane(nowIso, { assessment: slickchartsDelivery }),
    buildRimLane(rimInputs),
    buildProductSurfaceLane(productCoverage),
    buildFinraOccLane(finraOccLedger, occAvailability),
    buildAutomationLane(),
    buildPublicMirrorLane(rimInputs),
    buildDetectionFloorTgaLane(detectionFloor),
  ];
  const { overallStatus, totals, deploymentIntegrity } = summarize(lanes);
  const nonReadyChecks = lanes.flatMap((item) => (item.checks || [])
    .filter((entry) => entry.status !== "ready")
    .map((entry) => ({
      lane_id: item.id,
      check_id: entry.id,
      status: entry.status,
      label: entry.label,
      detail: entry.detail,
      required: entry.required !== false && item.required !== false,
    })));

  const sourceSla = buildSourceSla({
    nowIso,
    finraOccLedger,
    rimInputs,
    etfCoreBasket,
    coverageIndex,
    productCoverage,
    etfDaily1y,
    priorProductSurfacePending,
    slickchartsDelivery,
  });
  const runtime = buildRuntime({
    nowIso,
    env: process.env,
    priorRuntime,
    snapshotStatus: deploymentIntegrity.status,
  });

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso,
    status: overallStatus,
    status_label: statusLabel(overallStatus),
    status_message: overallStatus === "ready"
      ? "All required lanes and platform integrity gates are ready."
      : overallStatus === "degraded"
        ? `${totals.required_not_ready} required lane(s) are not ready; healthy lanes may still publish.`
        : deploymentIntegrity.status_message,
    purpose: "Admin-safe service data health KPI: current data freshness, daily gates, public mirror safety, and automation contracts.",
    raw_policy: {
      public_mirror_allowed: true,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      private_ledgers_included: false,
      source_artifacts_are_referenced_by_id_only: true,
    },
    deployment_integrity: deploymentIntegrity,
    runtime,
    source_sla: sourceSla,
    source_artifacts: [
      { id: "fenok_edge_coverage_index", generated_at: coverageIndex?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "rim_index_inputs", generated_at: rimInputs?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "product_surface_coverage", generated_at: productCoverage?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "s0_finra_occ_mapping_ledger", generated_at: finraOccLedger?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "etf_daily1y_readiness_admin", generated_at: etfDaily1y?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "etf_core_daily_basket_admin", generated_at: etfCoreBasket?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "yahoo_batch_quote_history_state", generated_at: yahooBatchState?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "occ_options_availability", generated_at: occAvailability?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "data_supply_detection_floor", generated_at: detectionFloor?.generated_at ?? null, public_mirror: false, public_safe: false },
    ],
    totals,
    lanes,
    non_ready_checks: nonReadyChecks.slice(0, 25),
  };
}

function readPriorKpiDoc() {
  const priorPath = path.join(DATA_ROOT, KPI_REL_PATH);
  let text;
  try {
    text = fs.readFileSync(priorPath, "utf8");
  } catch {
    return null; // file MISSING -> genuine bootstrap
  }
  // File EXISTS: unparseable = corruption, FAIL-CLOSED (never silently bootstrap).
  let prior;
  try {
    prior = JSON.parse(text);
  } catch (error) {
    throw new Error(`prior KPI at ${KPI_REL_PATH} exists but is unparseable JSON: ${error.message}`);
  }
  return prior?.schema_version === SCHEMA_VERSION ? prior : null; // v1/other -> bootstrap
}

function priorRuntimeOf(priorDoc) {
  return priorDoc?.runtime && typeof priorDoc.runtime === "object" ? priorDoc.runtime : null;
}

// Carry-forward the prior product_surface pending marker { pending_since, ever_stamped }
// from the prior committed root KPI (rev5.6, FAIL-CLOSED).
//  - priorDoc null (missing / v1) -> genuine bootstrap.
//  - prior v2 with NO stamp-slice lineage (no `pending` AND no required_surface_rows —
//    a pre-stamp-slice Phase-A doc) -> legitimate migration, init as bootstrap.
//  - prior v2 WITH stamp-slice lineage but the `pending` marker DELETED -> hard.
//  - `pending` present but malformed (non-object / non-boolean ever_stamped /
//    non-string-non-null / unparseable pending_since) -> hard.
//  - `pending` present, status pending, pending_since === null -> hard (a pending
//    state must carry a pending_since; never init a fresh clock).
// pending_since is carried for ANY prior state (incl. one preserved through an anomaly
// state), never gated on prior status — that gating was the clock-reset laundering path.
function priorProductSurfacePendingOf(priorDoc) {
  if (!priorDoc) return { pending_since: null, ever_stamped: false }; // genuine bootstrap
  const entry = (Array.isArray(priorDoc.source_sla) ? priorDoc.source_sla : [])
    .find((s) => s?.source_id === "product_surface_coverage");
  const hasLineage = entry && (hasOwn(entry, "required_surface_rows") || hasOwn(entry, "source_stamp_version") || hasOwn(entry, "pending"));
  if (!entry || !hasLineage) return { pending_since: null, ever_stamped: false }; // pre-stamp-slice -> init
  const prior = entry.pending;
  if (prior == null) {
    throw new Error("prior product_surface has stamp-slice lineage but its pending marker is deleted");
  }
  if (typeof prior !== "object" || Array.isArray(prior) || typeof prior.ever_stamped !== "boolean") {
    throw new Error(`prior product_surface pending marker malformed (ever_stamped): ${JSON.stringify(prior)}`);
  }
  if (prior.pending_since !== null
    && (typeof prior.pending_since !== "string" || !Number.isFinite(new Date(prior.pending_since).getTime()))) {
    throw new Error(`prior product_surface pending.pending_since malformed: ${JSON.stringify(prior.pending_since)}`);
  }
  if (entry.status === "unavailable_pending_source_stamp" && prior.pending_since === null) {
    throw new Error("prior product_surface is pending but pending_since is null (malformed)");
  }
  return { pending_since: prior.pending_since, ever_stamped: prior.ever_stamped === true };
}

// temp-file -> validate -> rename (contract §4, both mirrors).
function writeJsonAtomic(absPath, payload) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  JSON.parse(fs.readFileSync(tmp, "utf8")); // validate serialized JSON before publish
  fs.renameSync(tmp, absPath);
}

export function buildKpiDocuments(nowIso = resolveNow()) {
  const priorDoc = readPriorKpiDoc();
  const rootDoc = buildPayload(nowIso, priorRuntimeOf(priorDoc), priorProductSurfacePendingOf(priorDoc));
  const publicDoc = projectPublicKpi(rootDoc, nowIso);
  return { rootDoc, publicDoc };
}

function main() {
  const nowIso = resolveNow();
  const { rootDoc, publicDoc } = buildKpiDocuments(nowIso);
  writeJsonAtomic(path.join(DATA_ROOT, KPI_REL_PATH), rootDoc);
  writeJsonAtomic(path.join(PUBLIC_DATA_ROOT, KPI_REL_PATH), publicDoc);

  console.log(JSON.stringify({
    ok: rootDoc.deployment_integrity?.status === "ready",
    schema_version: rootDoc.schema_version,
    status: rootDoc.status,
    deployment_integrity: rootDoc.deployment_integrity?.status ?? null,
    degraded_lanes: rootDoc.lanes.filter((lane) => lane.status === "degraded").map((lane) => lane.id),
    generated_at: rootDoc.generated_at,
    lanes: rootDoc.totals.lanes,
    non_ready_checks: rootDoc.non_ready_checks.length,
    runtime_authoritative: rootDoc.runtime?.authoritative_context?.authoritative ?? null,
    producer_slot_key: rootDoc.runtime?.producer_context?.slot_key ?? null,
    missed_slot_count: rootDoc.runtime?.slots?.missed_slot_keys?.length ?? 0,
    source_sla_stale: rootDoc.source_sla.filter((s) => s.status === "stale").map((s) => s.source_id),
  }, null, 2));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
