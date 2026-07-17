#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { validateDetectionReport } from "./build-data-supply-detection-floor.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { projectPublicKpi } from "./lib/kpi-runtime-projection.mjs";
import { assertValidCronDeferrals, publicationGateForRuntime } from "./lib/kpi-runtime-slots.mjs";
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
  PRODUCT_SURFACE_STAMP_VERSION,
  PRODUCT_SURFACE_LEGACY_CLASSIFICATION,
  PRODUCT_SURFACE_LEGACY_DISPOSITION,
} from "./lib/kpi-contract-constants.mjs";
import { classifyProductSurfaceV2, nextProductSurfaceLineageV2 } from "./lib/product-surface-stamp-v2.mjs";

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

function appendHistory(priorHistory, entry, nowIso, retentionDays) {
  const key = (h) => `${h?.workflow || ""}|${h?.run_id || ""}|${h?.run_attempt ?? ""}`;
  const combined = [...(Array.isArray(priorHistory) ? priorHistory : [])];
  const idx = combined.findIndex((h) => key(h) === key(entry));
  if (idx >= 0) combined.splice(idx, 1);
  combined.push(entry);
  const floor = new Date(nowIso).getTime() - Number(retentionDays) * 86400000;
  return combined.filter((historyEntry) => {
    const slotMs = slotTimestampMs(historyEntry?.slot_key);
    const builtAtMs = new Date(historyEntry?.built_at).getTime();
    const evidenceMs = Number.isFinite(slotMs) ? slotMs : builtAtMs;
    return !Number.isFinite(evidenceMs) || evidenceMs >= floor;
  });
}

function deriveRuntimeSlotLedger({ priorRuntime, slotKey, nowIso, v2ActivatedAt }) {
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
  return {
    satisfied_slot_keys: satisfied,
    last_satisfied_slot_key: slotKey ?? (priorRuntime?.slots?.last_satisfied_slot_key ?? null),
    missed_slot_keys: missed,
    cron_deferrals: cronDeferrals,
  };
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
  const v2ActivatedAt = priorV2ActivatedAt ?? nowIso;
  const slotKey = auth.slot_key;

  // cadence is DEFINITIONAL — re-emitted canonical every build (never preserved),
  // so a prior malformed/tampered cadence cannot survive a rebuild. Only
  // v2_activated_at (watermark) is preserved state.
  const canonicalCadence = { ...CADENCE, v2_activated_at: v2ActivatedAt, calendar_version };
  const priorSlots = priorRuntime?.slots;
  assertValidCronDeferrals(priorSlots?.cron_deferrals ?? [], {
    satisfiedSlotKeys: priorSlots?.satisfied_slot_keys ?? [],
  });
  // Misses are clock-derived facts, not producer-success claims. Reconcile them on
  // every rebuild against this document's generated_at, even when the context is
  // non-authoritative. Producer identity, success history, and slot satisfaction
  // remain authority-gated below.
  const slots = deriveRuntimeSlotLedger({ priorRuntime, slotKey, nowIso, v2ActivatedAt });

  if (!auth.authoritative) {
    // Non-authoritative: preserve producer/history and never claim a satisfied slot.
    // The derived missed-slot ledger still advances with generated_at so the builder
    // and checker evaluate the same canonical clock.
    if (priorRuntime && typeof priorRuntime === "object") {
      return {
        producer_context: priorRuntime.producer_context ?? null,
        last_rebuild_context: lastRebuildContext,
        cadence: canonicalCadence,
        slots,
        successful_snapshot_history: priorRuntime.successful_snapshot_history ?? [],
        authoritative_context: { authoritative: false, reason: auth.reason },
      };
    }
    return {
      producer_context: null, // honest bootstrap; warn-only in Phase A
      last_rebuild_context: lastRebuildContext,
      cadence: canonicalCadence,
      slots,
      successful_snapshot_history: [],
      authoritative_context: { authoritative: false, reason: auth.reason },
    };
  }

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
    slots,
    successful_snapshot_history: appendHistory(
      priorRuntime?.successful_snapshot_history,
      historyEntry,
      nowIso,
      CADENCE.slot_retention_days,
    ),
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
const DETECTION_RECOVERY_CONFIG = Object.freeze({
  yahoo_ticker_macro: { lane_id: "yahoo_hourly_ticker", keys: ["TQQQ.json", "SOXL.json"] },
  slickcharts: { lane_id: "slickcharts_daily_delivery", keys: ["gainers.json", "losers.json", "treasury.json", "currency.json", "mortgage.json"] },
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

function validateRecoveryState(state, laneId) {
  if (state === null || state === undefined) return null;
  if (!state || typeof state !== "object" || Array.isArray(state)
    || state.schema_version !== "data-supply-lkg-state/v1"
    || state.lane_id !== laneId
    || !Array.isArray(state.retry_set)
    || !state.items || typeof state.items !== "object" || Array.isArray(state.items)) {
    throw new Error(`detection floor ${laneId} recovery state is malformed`);
  }
  const retrySet = [...state.retry_set];
  if (retrySet.some((key) => typeof key !== "string" || key === "")
    || new Set(retrySet).size !== retrySet.length
    || retrySet.some((key, index) => index > 0 && retrySet[index - 1].localeCompare(key) >= 0)) {
    throw new Error(`detection floor ${laneId} recovery retry_set is malformed`);
  }
  const itemRetryKeys = Object.entries(state.items)
    .filter(([, item]) => item?.retry === true)
    .map(([key, item]) => {
      if (item.key !== key) throw new Error(`detection floor ${laneId} recovery item ${key} identity is malformed`);
      return key;
    })
    .sort();
  if (JSON.stringify(itemRetryKeys) !== JSON.stringify(retrySet)) {
    throw new Error(`detection floor ${laneId} recovery retry_set omits active items`);
  }
  return { state, retrySet };
}

export function projectRecoveryRetrySet(state, laneId) {
  const validated = validateRecoveryState(state, laneId);
  if (validated === null) return [];
  const { retrySet } = validated;
  return retrySet.map((key) => {
    const item = state.items[key];
    const failureRunId = item?.latest_failure?.run_id;
    const failureRunAttempt = item?.latest_failure?.run_attempt;
    const failureObservedAt = item?.latest_failure?.observed_at;
    const failureReason = item?.latest_failure?.reason;
    const recoveredFromRunId = item?.recovered_from_run_id ?? null;
    const deferral = item?.latest_promotion_deferral ?? null;
    if (!item || item.key !== key || item.retry !== true
      || !["lkg_primary", "unavailable"].includes(item.resolution_state)
      || typeof failureRunId !== "string" || failureRunId === ""
      || !Number.isInteger(failureRunAttempt) || failureRunAttempt < 1
      || !isDetectionSourceStamp(failureObservedAt)
      || typeof failureReason !== "string" || failureReason === ""
      || (recoveredFromRunId !== null && (typeof recoveredFromRunId !== "string" || recoveredFromRunId === ""))) {
      throw new Error(`detection floor ${laneId} recovery item ${key} is malformed`);
    }
    if (deferral !== null && (typeof deferral !== "object" || Array.isArray(deferral)
      || !["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(deferral.reason)
      || typeof deferral.run_id !== "string" || deferral.run_id === ""
      || !Number.isInteger(deferral.run_attempt) || deferral.run_attempt < 1
      || !isDetectionSourceStamp(deferral.observed_at))) {
      throw new Error(`detection floor ${laneId} recovery deferral ${key} is malformed`);
    }
    if (item.resolution_state === "lkg_primary") {
      const current = item.current;
      const lkg = item.lkg;
      if (!current || !lkg
        || current.path !== `data/admin/${laneId}/lkg/${key}.json`
        || lkg.path !== current.path
        || !/^[0-9a-f]{64}$/.test(current.payload_sha256 ?? "")
        || lkg.payload_sha256 !== current.payload_sha256
        || lkg.source_as_of !== current.source_as_of
        || !isDetectionSourceStamp(current.source_as_of)) {
        throw new Error(`detection floor ${laneId} retained LKG ${key} is malformed`);
      }
    } else if (item.current != null || item.lkg != null) {
      throw new Error(`detection floor ${laneId} unavailable recovery item ${key} is contradictory`);
    }
    return {
      key,
      resolution_state: item.resolution_state,
      failure_run_id: failureRunId,
      promotion_deferral_reason: deferral?.reason ?? null,
      promotion_deferral_run_id: deferral?.run_id ?? null,
      recovered_from_run_id: recoveredFromRunId,
    };
  });
}

export function formatRecoveryRetryEvidence(items) {
  return items.map((item) => {
    const base = `${item.key} ${item.resolution_state} after run ${item.failure_run_id}`;
    return item.promotion_deferral_reason
      ? `${base}; ${item.promotion_deferral_reason} at run ${item.promotion_deferral_run_id}`
      : base;
  }).join("; ");
}

export function projectRecoveryRecoveredSet(state, laneId) {
  const validated = validateRecoveryState(state, laneId);
  if (validated === null) return [];
  return Object.entries(validated.state.items)
    .map(([key, item]) => {
      const naturalProofFields = [
        item?.recovery_run_id,
        item?.recovery_run_attempt,
        item?.recovery_event_name,
      ];
      const hasNaturalProof = naturalProofFields.some((value) => value !== null && value !== undefined);
      if (!hasNaturalProof) {
        // Pre-natural-gate dispatch recoveries used only recovered_from_run_id/recovered_at.
        // They remain stored for lineage but are not eligible KPI recovery proof.
        return null;
      }

      const current = item?.current;
      const lkg = item?.lkg;
      const lastFailure = item?.last_recovered_failure;
      if (!item || item.key !== key
        || item.resolution_state !== "fresh_primary" || item.retry !== false
        || typeof item.recovered_from_run_id !== "string" || item.recovered_from_run_id === ""
        || typeof item.recovery_run_id !== "string" || item.recovery_run_id === ""
        || item.recovery_run_id === item.recovered_from_run_id
        || item.recovery_run_attempt !== 1
        || item.recovery_event_name !== "schedule"
        || !isDetectionSourceStamp(item.recovered_at)
        || !current || typeof current.path !== "string" || current.path === ""
        || !/^[0-9a-f]{64}$/.test(current.payload_sha256 ?? "")
        || !isDetectionSourceStamp(current.source_as_of)
        || !lkg || lkg.path !== `data/admin/${laneId}/lkg/${key}.json`
        || !/^[0-9a-f]{64}$/.test(lkg.payload_sha256 ?? "")
        || !isDetectionSourceStamp(lkg.source_as_of)
        || Date.parse(current.source_as_of) <= Date.parse(lkg.source_as_of)
        || !lastFailure || lastFailure.run_id !== item.recovered_from_run_id
        || !Number.isInteger(lastFailure.run_attempt) || lastFailure.run_attempt < 1
        || !isDetectionSourceStamp(lastFailure.observed_at)
        || typeof lastFailure.reason !== "string" || lastFailure.reason === ""
        || Date.parse(item.recovered_at) < Date.parse(lastFailure.observed_at)) {
        throw new Error(`detection floor ${laneId} recovery provenance ${key} is malformed`);
      }
      return {
        key,
        resolution_state: item.resolution_state,
        retry: item.retry,
        recovered_from_run_id: item.recovered_from_run_id,
        recovery_run_id: item.recovery_run_id,
        recovery_run_attempt: item.recovery_run_attempt,
        recovery_event_name: item.recovery_event_name,
        recovered_at: item.recovered_at,
        lkg_source_as_of: lkg.source_as_of,
        source_as_of: current.source_as_of,
      };
    })
    .filter((item) => item !== null)
    .sort((left, right) => left.key.localeCompare(right.key));
}

export function compactRecoveryIndex(index) {
  if (!index || typeof index !== "object" || Array.isArray(index)) return null;
  return {
    lane_id: index.lane_id ?? null,
    generated_at: index.generated_at ?? null,
    keys: Array.isArray(index.keys) ? index.keys : [],
    counts: index.counts ?? null,
    retry_keys: Array.isArray(index.retry_keys) ? index.retry_keys : [],
    lkg_details: Array.isArray(index.lkg_details) ? index.lkg_details.map((row) => ({
      key: row?.key ?? null,
      payload_sha256: row?.payload_sha256 ?? null,
      source_as_of: row?.source_as_of ?? null,
      failure_run_id: row?.failure_run_id ?? null,
      failure_run_attempt: row?.failure_run_attempt ?? null,
    })) : [],
    recovery_details: Array.isArray(index.recovery_details) ? index.recovery_details.map((row) => ({
      key: row?.key ?? null,
      recovered_from_run_id: row?.recovered_from_run_id ?? null,
      recovery_run_id: row?.recovery_run_id ?? null,
      recovery_run_attempt: row?.recovery_run_attempt ?? null,
      recovery_event_name: row?.recovery_event_name ?? null,
      recovered_at: row?.recovered_at ?? null,
      source_as_of: row?.source_as_of ?? null,
    })) : [],
    promotion_deferral_details: Array.isArray(index.promotion_deferral_details)
      ? index.promotion_deferral_details.map((row) => ({
          key: row?.key ?? null,
          run_id: row?.run_id ?? null,
          run_attempt: row?.run_attempt ?? null,
          event_name: row?.event_name ?? null,
          observed_at: row?.observed_at ?? null,
          source_as_of: row?.source_as_of ?? null,
          reason: row?.reason ?? null,
        }))
      : [],
    current_attempt: index.current_attempt ? {
      run_id: index.current_attempt.run_id ?? null,
      run_attempt: index.current_attempt.run_attempt ?? null,
      event_name: index.current_attempt.event_name ?? null,
      observed_at: index.current_attempt.observed_at ?? null,
      attempted: index.current_attempt.attempted ?? null,
      successes: index.current_attempt.successes ?? null,
      failed: index.current_attempt.failed ?? null,
      failed_keys: Array.isArray(index.current_attempt.failed_keys) ? index.current_attempt.failed_keys : [],
      promotion_deferrals: index.current_attempt.promotion_deferrals ?? 0,
      promotion_deferral_keys: Array.isArray(index.current_attempt.promotion_deferral_keys)
        ? index.current_attempt.promotion_deferral_keys
        : [],
    } : null,
  };
}

export function validateProducerRecoveryAttempt(index) {
  const reasons = [];
  const reject = (condition, reason) => {
    if (!condition) reasons.push(reason);
  };
  // v1 indexes predate promotion-deferral evidence; they are validated against the
  // contract they were written under, never against fields they could not have produced.
  const legacyIndex = index?.schema_version === "producer-lkg-index/v1";
  if (!legacyIndex && index?.schema_version !== "producer-lkg-index/v2") {
    return {
      valid: false,
      reasons: [`index schema_version "${index?.schema_version ?? "<missing>"}" is not a supported producer-lkg-index contract`],
    };
  }
  const keys = Array.isArray(index?.keys) ? index.keys : [];
  const current = index?.current_attempt;
  const failedKeys = Array.isArray(current?.failed_keys) ? current.failed_keys : [];
  const deferralKeys = !legacyIndex && Array.isArray(current?.promotion_deferral_keys) ? current.promotion_deferral_keys : [];
  const details = !legacyIndex && Array.isArray(index?.promotion_deferral_details) ? index.promotion_deferral_details : [];
  const integerFields = legacyIndex
    ? ["attempted", "successes", "failed"]
    : ["attempted", "successes", "failed", "promotion_deferrals"];
  const orderedSubset = (values) => values.every((key) => typeof key === "string" && keys.includes(key))
    && new Set(values).size === values.length
    && JSON.stringify(values) === JSON.stringify(keys.filter((key) => values.includes(key)));

  reject(current && typeof current === "object" && !Array.isArray(current), "current_attempt is missing or malformed");
  reject(typeof current?.run_id === "string" && current.run_id !== "", "current attempt run_id is invalid");
  reject(Number.isInteger(current?.run_attempt) && current.run_attempt >= 1, "current attempt run_attempt is invalid");
  reject(["schedule", "workflow_dispatch"].includes(current?.event_name), "current attempt event_name is invalid");
  reject(isDetectionSourceStamp(current?.observed_at), "current attempt observed_at is invalid");
  for (const field of integerFields) {
    reject(Number.isInteger(current?.[field]) && current[field] >= 0, `current attempt ${field} is invalid`);
  }
  reject(Number.isInteger(current?.attempted) && current.attempted >= 1 && current.attempted <= keys.length,
    "current attempted denominator is outside the exact key-set bounds");
  reject(orderedSubset(failedKeys), "current failed_keys are not an ordered unique key subset");
  reject(current?.failed === failedKeys.length, "failed count does not match failed_keys");
  reject(Number(index?.counts?.failed) === current?.failed, "index failed count does not match the current attempt");
  reject(failedKeys.every((key) => index?.retry_keys?.includes(key)), "failed key is missing from retry_keys");
  if (legacyIndex) {
    reject(current?.attempted === current?.successes + current?.failed,
      "current attempt denominator does not reconcile");
    reject(!Object.hasOwn(current ?? {}, "promotion_deferrals")
      && !Object.hasOwn(current ?? {}, "promotion_deferral_keys")
      && !Object.hasOwn(index ?? {}, "promotion_deferral_details"),
    "legacy v1 index carries promotion evidence it cannot have produced");
    return { valid: reasons.length === 0, reasons };
  }
  reject(current?.attempted === current?.successes + current?.failed + current?.promotion_deferrals,
    "current attempt denominator does not reconcile");
  reject(orderedSubset(deferralKeys), "current promotion_deferral_keys are not an ordered unique key subset");
  reject(failedKeys.every((key) => !deferralKeys.includes(key)), "failed and promotion-deferral keys overlap");
  reject(current?.promotion_deferrals === deferralKeys.length, "promotion deferral count does not match its keys");
  reject(deferralKeys.every((key) => index?.retry_keys?.includes(key)), "promotion deferral key is missing from retry_keys");
  reject(details.length === deferralKeys.length
    && JSON.stringify(details.map((row) => row?.key)) === JSON.stringify(deferralKeys),
  "promotion deferral details do not match current keys");
  for (const detail of details) {
    reject(detail?.run_id === current?.run_id
      && detail?.run_attempt === current?.run_attempt
      && detail?.event_name === current?.event_name
      && detail?.observed_at === current?.observed_at,
    `promotion deferral ${detail?.key ?? "<unknown>"} is not bound to the current run`);
    reject(["recovery_requires_schedule", "foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(detail?.reason),
      `promotion deferral ${detail?.key ?? "<unknown>"} reason is invalid`);
    reject(isDetectionSourceStamp(detail?.source_as_of),
      `promotion deferral ${detail?.key ?? "<unknown>"} source_as_of is invalid`);
  }
  return { valid: reasons.length === 0, reasons };
}

function recoveryChecks(laneId, index) {
  const config = DETECTION_RECOVERY_CONFIG[laneId];
  if (!config) return { checks: [], details: null };
  const present = ["producer-lkg-index/v1", "producer-lkg-index/v2"].includes(index?.schema_version)
    && index?.lane_id === config.lane_id
    && Number(index?.counts?.keys) === config.keys.length
    && Array.isArray(index?.keys)
    && JSON.stringify(index.keys) === JSON.stringify(config.keys)
    && Array.isArray(index?.retry_keys)
    && Array.isArray(index?.lkg_details)
    && Array.isArray(index?.recovery_details);
  const currentValidation = validateProducerRecoveryAttempt(index);
  const current = present && currentValidation.valid;
  const retryEmpty = present
    && index.retry_keys.length === 0
    && Number(index.counts?.retry) === 0;
  const lkgIntegrity = present
    && Number(index.counts?.unavailable) === 0
    && index.lkg_details.every((row) => typeof row?.key === "string"
      && /^[a-f0-9]{64}$/u.test(row?.payload_sha256)
      && typeof row?.source_as_of === "string")
    && index.retry_keys.every((key) => index.lkg_details.some((row) => row?.key === key));
  return {
    checks: [
      check("recovery_state_present", "Recovery state", present, present ? `${config.keys.length} exact per-file keys are named` : "recovery index is missing or malformed"),
      check("recovery_current_attempt", "Recovery current attempt", current, current ? `run ${index.current_attempt.run_id}` : currentValidation.reasons.join("; ") || "current-attempt recovery evidence is missing"),
      check("recovery_retry_set_empty", "Recovery retry set", retryEmpty, retryEmpty ? "retry set is empty" : `${index?.retry_keys?.length ?? 0} key(s) remain on retained LKG`),
      check("recovery_lkg_integrity", "Recovery LKG integrity", lkgIntegrity, lkgIntegrity ? "all retained LKG rows are sha256-bound" : "LKG binding is missing, malformed, or unavailable"),
    ],
    details: compactRecoveryIndex(index),
  };
}

export function mapDetectionFloorRow(row, recoveryState = undefined) {
  const laneId = typeof row?.id === "string" && row.id !== "" ? row.id : "<unknown>";
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(`detection floor ${laneId} row is malformed`);
  }
  const laneConfig = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((item) => item.id === row.id);
  if (!laneConfig || laneConfig.enforcement !== "live" || laneConfig.kpi_required !== true
    || row.label !== laneConfig.label || row.enforcement !== "live" || row.kpi_required !== true) {
    throw new Error(`detection floor ${laneId} identity/enforcement contract is malformed`);
  }
  assertDetectionStatusReason(row, laneId, { allowUnavailableSchemaDrift: true });
  assertDetectionStatusReason(row.artifact, `${laneId}.artifact`, { allowUnavailableSchemaDrift: true });
  if (DETECTION_STATUS_SEVERITY[row.artifact.status] > DETECTION_STATUS_SEVERITY[row.status]) {
    throw new Error(`detection floor ${laneId} status is better than its artifact status`);
  }
  const sourceAsOf = row.artifact.source_as_of;
  const providerDateless = Array.isArray(laneConfig.freshness?.source_basis)
    && laneConfig.freshness.source_basis.length === 0;
  if (sourceAsOf !== null && !isDetectionSourceStamp(sourceAsOf)) {
    throw new Error(`detection floor ${laneId} artifact.source_as_of is malformed`);
  }
  if (providerDateless && sourceAsOf !== null) {
    throw new Error(`detection floor ${laneId} provider-dateless artifact carries fabricated source_as_of`);
  }
  if (!providerDateless && (row.artifact.status === "ready" || row.artifact.status === "stale") && sourceAsOf === null) {
    throw new Error(`detection floor ${laneId} artifact status contradicts null source_as_of`);
  }

  const targetRecovery = Object.hasOwn(DETECTION_RECOVERY_CONFIG, row.id) && recoveryState !== undefined;
  const recoveryRetrySet = targetRecovery ? null : projectRecoveryRetrySet(recoveryState, row.id);
  const recoveryRecovered = targetRecovery ? null : projectRecoveryRecoveredSet(recoveryState, row.id);
  const recovery = targetRecovery ? recoveryChecks(row.id, recoveryState) : null;
  const result = lane(row.id, row.label, [
    check(
      "detection_floor_status",
      "Detection floor status",
      row.status === "ready",
      `${row.reason}; source_as_of ${sourceAsOf ?? "null"}`,
    ),
    ...(targetRecovery
      ? recovery.checks
      : [check(
        "lkg_retry_set_empty",
        "LKG retry set empty",
        recoveryRetrySet.length === 0,
        recoveryRetrySet.length === 0
          ? "empty"
          : formatRecoveryRetryEvidence(recoveryRetrySet),
      )]),
  ], {
    asOf: sourceAsOf,
    details: targetRecovery
      ? { detection_reason: row.reason, recovery: recovery.details }
      : { recovery_retry_set: recoveryRetrySet, recovery_recovered: recoveryRecovered },
  });
  return {
    ...result,
    reason: targetRecovery && row.reason === "ok" && result.status !== "ready" ? "recovery_degraded" : row.reason,
    artifact: providerDateless
      ? { source_as_of: sourceAsOf, source_as_of_reason: "dateless_by_provider" }
      : { source_as_of: sourceAsOf },
  };
}

export function buildDetectionFloorLanes(report, recoveryStates = undefined) {
  const liveLaneConfigs = DATA_SUPPLY_DETECTION_CONFIG.lanes.filter((item) => item.enforcement === "live");
  if (report === null || report === undefined) {
    return liveLaneConfigs.map((laneConfig) => mapDetectionFloorRow({
      id: laneConfig.id,
      label: laneConfig.label,
      enforcement: "live",
      kpi_required: true,
      status: "unobserved",
      reason: "workflow_unobserved",
      artifact: { status: "unobserved", reason: "workflow_unobserved", source_as_of: null },
    }, recoveryStates === undefined ? undefined : recoveryStates[laneConfig.id] ?? null));
  }
  validateDetectionReport(report);
  if (report?.schema_version !== "data-supply-detection-floor/v1" || !Array.isArray(report?.lanes)) {
    throw new Error("detection floor report schema is malformed");
  }
  return liveLaneConfigs.map((laneConfig) => {
    const matches = report.lanes.filter((item) => item?.id === laneConfig.id);
    if (matches.length !== 1) throw new Error(`detection floor ${laneConfig.id} cardinality is ${matches.length}`);
    return mapDetectionFloorRow(matches[0], recoveryStates === undefined ? undefined : recoveryStates[laneConfig.id] ?? null);
  });
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

function stockanalysisRecoveryEvidence(state, kinds) {
  const allowed = new Set(kinds);
  const degraded = (Array.isArray(state?.degraded_details) ? state.degraded_details : [])
    .filter((item) => allowed.has(item?.artifact_kind))
    .slice(0, 40)
    .map((item) => ({
      artifact_kind: item?.artifact_kind ?? null,
      entity: item?.entity ?? null,
      resolution_state: item?.resolution_state ?? null,
      payload_sha256: item?.payload_sha256 ?? null,
      source_as_of: item?.source_as_of ?? null,
      failure_attempt_ref: item?.failure_run_id ?? null,
      data_loss: item?.data_loss === true,
    }));
  const recovered = (Array.isArray(state?.recovered_details) ? state.recovered_details : [])
    .filter((item) => allowed.has(item?.artifact_kind))
    .slice(0, 40)
    .map((item) => ({
      artifact_kind: item?.artifact_kind ?? null,
      entity: item?.entity ?? null,
      payload_sha256: item?.payload_sha256 ?? null,
      source_as_of: item?.source_as_of ?? null,
      recovered_from_attempt_ref: item?.recovered_from_run_id ?? null,
      recovered_at: item?.recovered_at ?? null,
    }));
  const currentErrors = (Array.isArray(state?.current_attempt?.errors) ? state.current_attempt.errors : [])
    .filter((item) => allowed.has(item?.artifact_kind));
  return {
    state_present: Boolean(state),
    generated_at: state?.generated_at ?? null,
    current_attempt_ref: state?.current_attempt?.run_id ?? null,
    current_attempt_number: number(state?.current_attempt?.run_attempt, 1),
    current_failed_count: currentErrors.length,
    degraded,
    recovered,
    degraded_entities: [...new Set(degraded.map((item) => item.entity).filter(Boolean))].sort(),
    recovered_entities: [...new Set(recovered.map((item) => item.entity).filter(Boolean))].sort(),
  };
}

function buildStockS1Lane(coverageIndex, stockanalysisRecovery) {
  const track = trackById(coverageIndex, "expanded_stock_candidates");
  const promotion = track?.promotion_gate_readiness || {};
  const counts = promotion.counts || {};
  const denominator = number(counts.denominator || track?.denominator);
  const closedCount = number(counts.current_public_candidate_overlap_plus_blocked);
  const recovery = stockanalysisRecoveryEvidence(stockanalysisRecovery, ["stock", "financial"]);
  return lane("stock_s1_candidate_gate", "S1 candidate promotion gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED with blocked ledger", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("artifact_present", "promotion artifact", bool(promotion.artifact_present), promotion.artifact_generated_at || "missing"),
    check("gap_partition_closed", "public plus blocked equals denominator", denominator > 0 && closedCount === denominator, `${closedCount.toLocaleString("ko-KR")} / ${denominator.toLocaleString("ko-KR")}`),
    check("promotion_queue_empty", "promotion queue", number(counts.promotion_rows) === 0, `${number(counts.promotion_rows)} rows`),
    check("blockers_empty", "gate blockers", (promotion.blockers || []).length === 0, `${(promotion.blockers || []).length} blockers`),
    diagnosticCheck("stockanalysis_recovery_state_present", "StockAnalysis stock/financial recovery state", recovery.state_present, recovery.generated_at || "missing", { service_gate: false }),
    diagnosticCheck("stockanalysis_retry_empty", "StockAnalysis stock/financial retry set", recovery.degraded.length === 0, `${recovery.degraded.length} deferred: ${recovery.degraded_entities.join(", ") || "none"}`, { service_gate: false }),
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
    details: { stockanalysis_recovery: recovery },
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
  const promotionDeferrals = (Array.isArray(state?.promotion_deferral_details) ? state.promotion_deferral_details : [])
    .slice(0, 20)
    .map((item) => ({
      symbol: item?.ticker ?? item?.symbol ?? null,
      reason: item?.reason ?? null,
      attempt_ref: item?.run_id ?? null,
      attempt_number: number(item?.run_attempt, 1),
      event_name: item?.event_name ?? null,
      observed_at: item?.observed_at ?? null,
      provider_quote_as_of: item?.provider_quote_as_of ?? null,
      provider_history_as_of: item?.provider_history_as_of ?? null,
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
  // One-time bridge for the exact pre-unavailable_details incident artifact.
  // Never infer names from bounded LKG/error lists: equal counts can still name
  // the wrong symbols. A subsequent state rebuild writes canonical details.
  const legacyIncidentSymbols = ["HOLX", "MMC"];
  const currentErrorSymbols = new Set(
    (Array.isArray(currentAttempt?.errors) ? currentAttempt.errors : [])
      .map((item) => item?.ticker ?? item?.symbol)
      .filter(Boolean),
  );
  const retrySymbols = new Set((Array.isArray(state?.retry_symbols) ? state.retry_symbols : []).filter(Boolean));
  const exactKnownLegacyIncident = currentAttempt?.run_id === "29378156187"
    && state?.generated_at === "2026-07-15T00:10:40Z"
    && number(counts.unavailable) === legacyIncidentSymbols.length
    && legacyIncidentSymbols.every((symbol) => currentErrorSymbols.has(symbol) && retrySymbols.has(symbol));
  const legacyUnavailableDetails = !Array.isArray(state?.unavailable_details)
    && exactKnownLegacyIncident
    ? legacyIncidentSymbols.map((symbol) => ({
        symbol,
        failure_run_id: currentAttempt.run_id ?? null,
        failure_observed_at: state?.generated_at ?? null,
        failure_kind: "legacy_unclassified",
        lkg_status: "absent",
        data_loss: false,
        deferred_acquisition: false,
        retry: true,
        expected_resolution: "next_natural_yahoo_run",
      }))
    : [];
  const unavailableDetails = (Array.isArray(state?.unavailable_details) ? state.unavailable_details : legacyUnavailableDetails)
    .slice(0, 20)
    .map((item) => ({
      symbol: item?.symbol ?? null,
      failure_attempt_ref: item?.failure_run_id ?? null,
      failure_observed_at: item?.failure_observed_at ?? null,
      failure_kind: item?.failure_kind ?? null,
      lkg_status: item?.lkg_status ?? null,
      data_loss: item?.data_loss === true,
      deferred_acquisition: item?.deferred_acquisition === true,
      retry: item?.retry === true,
      expected_resolution: item?.expected_resolution ?? null,
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
    failed_symbols: Array.isArray(currentAttempt.errors)
      ? [...new Set(currentAttempt.errors.map((row) => row?.ticker ?? row?.symbol).filter((value) => typeof value === "string" && value !== ""))].sort()
      : [],
    skipped: number(currentAttempt.skipped),
    fetch_attempts: number(currentAttempt.fetch_attempts),
    promotion_deferrals: number(currentAttempt.promotion_deferrals),
    promotion_deferral_symbols: Array.isArray(currentAttempt.promotion_deferral_symbols)
      ? [...new Set(currentAttempt.promotion_deferral_symbols.filter((value) => typeof value === "string"))].sort()
      : [],
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
  const unavailableDetail = unavailableDetails.length > 0
    ? unavailableDetails.map((item) => (
      item.deferred_acquisition
        ? `${item.symbol || "unknown"} has a transient provider miss without LKG; retry queued for the next natural Yahoo run.`
        : item.data_loss
          ? `${item.symbol || "unknown"} lost previously advertised Yahoo data/LKG.`
          : `${item.symbol || "unknown"} is unavailable after ${String(item.failure_kind || "unknown").replaceAll("_", " ")}.`
    )).join(" ")
    : `${number(counts.unavailable)} unavailable`;
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
    check("no_unavailable", "Yahoo unavailable", number(counts.unavailable) === 0, unavailableDetail),
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
      unavailable: unavailableDetails,
      promotion_deferrals: promotionDeferrals,
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

export function buildRimLane(rimInputs, soxRecoveryState = null) {
  const soxRecoveryStatePresent = soxRecoveryState?.schema_version === "data-supply-lkg-state/v1"
    && soxRecoveryState?.lane_id === "nasdaq_giw_sox";
  const recoveryRetrySet = projectRecoveryRetrySet(soxRecoveryState, "nasdaq_giw_sox");
  const recoveryRecovered = projectRecoveryRecoveredSet(soxRecoveryState, "nasdaq_giw_sox");
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
  checks.push(
    diagnosticCheck(
      "sox_recovery_state_present",
      "SOX recovery state",
      soxRecoveryStatePresent,
      soxRecoveryStatePresent ? "nasdaq_giw_sox state is present" : "nasdaq_giw_sox state is not yet observed",
      { service_gate: false },
    ),
    diagnosticCheck(
      "sox_retry_set_empty",
      "SOX LKG retry set",
      recoveryRetrySet.length === 0,
      recoveryRetrySet.length === 0
        ? "retry set is empty"
        : formatRecoveryRetryEvidence(recoveryRetrySet),
      { service_gate: false },
    ),
  );
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
      recovery_retry_set: recoveryRetrySet,
      recovery_recovered: recoveryRecovered,
    },
    asOf: rimInputs?.generated_at ?? null,
  });
}

function buildProductSurfaceLane(productCoverage, stockanalysisRecovery) {
  const totals = productCoverage?.totals || {};
  const recovery = stockanalysisRecoveryEvidence(stockanalysisRecovery, ["surface"]);
  const stampRows = productCoverage?.source_stamp_version === PRODUCT_SURFACE_STAMP_VERSION
    ? (Array.isArray(productCoverage?.surfaces) ? productCoverage.surfaces : [])
      .filter((surface) => REQUIRED_SURFACE_IDS.includes(surface?.id))
      .map((surface) => ({ id: surface.id, state: surface?.stamp_evidence?.state ?? "shape_error" }))
    : [];
  const nonStampedRows = stampRows.filter((row) => row.state !== "stamped");
  return lane("product_surface_freshness", "Product surface freshness", [
    check("surface_payload_present", "product-surface-coverage", Boolean(productCoverage), productCoverage?.generated_at || "missing"),
    check("no_stale_surfaces", "stale surfaces", number(totals.stale) === 0, `${number(totals.stale)} stale`),
    check("no_unavailable_surfaces", "unavailable surfaces", number(totals.unavailable) === 0, `${number(totals.unavailable)} unavailable`),
    check("no_error_surfaces", "error surfaces", number(totals.error) === 0, `${number(totals.error)} error`),
    ...(productCoverage?.source_stamp_version === PRODUCT_SURFACE_STAMP_VERSION
      ? [check(
        "stamp_taxonomy_v2_ready",
        "product surface true-date/collection taxonomy v2",
        stampRows.length === REQUIRED_SURFACE_IDS.length && nonStampedRows.length === 0,
        nonStampedRows.length
          ? nonStampedRows.map((row) => `${row.id}:${row.state}`).join(", ")
          : `${stampRows.length}/${REQUIRED_SURFACE_IDS.length} stamped`,
      )]
      : []),
    diagnosticCheck("stockanalysis_recovery_state_present", "StockAnalysis surface recovery state", recovery.state_present, recovery.generated_at || "missing", { service_gate: false }),
    diagnosticCheck("stockanalysis_retry_empty", "StockAnalysis surface retry set", recovery.degraded.length === 0, `${recovery.degraded.length} deferred: ${recovery.degraded_entities.join(", ") || "none"}`, { service_gate: false }),
  ], {
    counts: {
      surfaces: number(totals.surfaces),
      ready: number(totals.ready),
      partial: number(totals.partial),
      pending: number(totals.pending),
      stale: number(totals.stale),
      unavailable: number(totals.unavailable),
      error: number(totals.error),
      stamp_v2_stamped: stampRows.filter((row) => row.state === "stamped").length,
      stamp_v2_required: stampRows.length,
    },
    details: { stockanalysis_recovery: recovery, stamp_taxonomy_v2: stampRows },
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
    .map((s) => {
      const row = { id: s.id };
      if (hasOwn(s, "source_as_of")) row.source_as_of = s.source_as_of;
      if (hasOwn(s, "source_as_of_reason")) row.source_as_of_reason = s.source_as_of_reason;
      if (hasOwn(s, "stamp_evidence")) row.stamp_evidence = s.stamp_evidence;
      return row;
    });
}

function buildProductSurfaceEntry({ def, productCoverage, nowIso, priorPending }) {
  const requiredRows = productSurfaceRequiredRows(productCoverage);
  const stampMarkerPresent = hasOwn(productCoverage, "source_stamp_version");
  const stampMarkerValue = stampMarkerPresent ? productCoverage.source_stamp_version : undefined;
  const isV2 = stampMarkerPresent && stampMarkerValue === PRODUCT_SURFACE_STAMP_VERSION;
  if (!isV2 && priorPending?.v2) throw new Error("product_surface source_stamp_version downgrade from v2 is not allowed");
  const cls = isV2
    ? classifyProductSurfaceV2(requiredRows, nowIso, REQUIRED_SURFACE_IDS)
    : classifyProductSurface(requiredRows, nowIso, { stampMarkerPresent, stampMarkerValue });
  if (isV2) {
    const v2RequiredRows = cls.normalized_rows ?? requiredRows;
    const { lineage: stampLineage } = nextProductSurfaceLineageV2({
      priorLineage: priorPending?.v2 && priorPending?.superseded_v1
        ? { active_version: 2, v2: priorPending.v2, superseded_v1: priorPending.superseded_v1 }
        : null,
      legacyV1: priorPending,
      kind: cls.kind,
      nowIso,
    });
    const baseV2 = {
      source_id: def.source_id,
      freshness_basis: def.freshness_basis,
      unit: def.unit,
      calendar: def.calendar,
      max_staleness: def.max_staleness,
      required: def.required,
      source_stamp_version: stampMarkerValue,
      required_surface_rows: v2RequiredRows,
      stamp_lineage: stampLineage,
    };
    if (cls.kind === "shape_error") return { ...baseV2, source_date: null, age: null, status: "error", shape_error: true, shape_errors: cls.shape_errors };
    if (cls.kind === "future") return { ...baseV2, source_date: null, age: null, status: "future_date_anomaly", future_date_anomaly: true, shape_errors: cls.shape_errors ?? [] };
    if (cls.kind === "pending_true_date") return { ...baseV2, source_date: null, age: null, status: "degraded_pending_true_date", pending_true_date: true };
    if (cls.kind === "collection_stale") return { ...baseV2, source_date: null, age: null, status: "degraded_collection_stale", collection_stale: true };
    const age = evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso });
    return { ...baseV2, source_date: cls.source_date, age, status: slaStatusForAge(age, def.max_staleness) };
  }
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
  const stockanalysisRecovery = readJson("admin/stockanalysis-recovery/index.json");
  const nasdaqGiwSoxRecovery = readOptionalJsonStrict("admin/nasdaq_giw_sox/index.json");
  const occAvailability = readJson("computed/fenok_occ_options_availability.json");
  const detectionFloor = readOptionalJsonStrict("admin/data-supply-detection-floor.json");
  const generalRecoveryStates = Object.fromEntries(
    ["fred_macro", "fred_banking", "fdic_tier1", "sentiment", "treasury_tga"]
      .map((laneId) => [laneId, readOptionalJsonStrict(`admin/${laneId}/index.json`)]),
  );
  const detectionRecovery = {
    yahoo_ticker_macro: readOptionalJsonStrict("admin/yahoo-hourly-ticker/index.json"),
    slickcharts: readOptionalJsonStrict("admin/slickcharts-daily-delivery/index.json"),
  };
  const recoveryStates = { ...generalRecoveryStates, ...detectionRecovery };
  const slickchartsDelivery = assessSlickChartsDelivery(nowIso);

  const lanes = [
    buildStockS0Lane(coverageIndex),
    buildStockS1Lane(coverageIndex, stockanalysisRecovery),
    buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket),
    buildYahooBatchLane(yahooBatchState, nowIso),
    buildSlickChartsDeliveryLane(nowIso, { assessment: slickchartsDelivery }),
    buildRimLane(rimInputs, nasdaqGiwSoxRecovery),
    buildProductSurfaceLane(productCoverage, stockanalysisRecovery),
    buildFinraOccLane(finraOccLedger, occAvailability),
    buildAutomationLane(),
    buildPublicMirrorLane(rimInputs),
    ...buildDetectionFloorLanes(detectionFloor, recoveryStates),
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
  runtime.publication_gate = publicationGateForRuntime(runtime);

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
      { id: "stockanalysis_recovery_state", generated_at: stockanalysisRecovery?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "occ_options_availability", generated_at: occAvailability?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "data_supply_detection_floor", generated_at: detectionFloor?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "yahoo_hourly_ticker_recovery_state", generated_at: detectionRecovery.yahoo_ticker_macro?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "slickcharts_daily_delivery_recovery_state", generated_at: detectionRecovery.slickcharts?.generated_at ?? null, public_mirror: false, public_safe: false },
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
  if (entry?.source_stamp_version === PRODUCT_SURFACE_STAMP_VERSION || hasOwn(entry, "stamp_lineage")) {
    const lineage = entry?.stamp_lineage;
    const exactKeys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
      && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
    if (!exactKeys(lineage, ["active_version", "v2", "superseded_v1"])
      || lineage.active_version !== 2
      || !exactKeys(lineage.v2, ["pending_since", "ever_stamped"])
      || !exactKeys(lineage.superseded_v1, ["pending_since", "ever_stamped", "classification", "disposition"])) {
      throw new Error("prior product_surface v2 stamp_lineage missing/malformed; downgrade or deletion is not allowed");
    }
    for (const [name, marker] of [["v2", lineage.v2], ["superseded_v1", lineage.superseded_v1]]) {
      if (typeof marker.ever_stamped !== "boolean" || (marker.pending_since !== null && (typeof marker.pending_since !== "string" || !Number.isFinite(new Date(marker.pending_since).getTime())))) {
        throw new Error(`prior product_surface stamp_lineage.${name} malformed: ${JSON.stringify(marker)}`);
      }
    }
    if (lineage.superseded_v1.classification !== PRODUCT_SURFACE_LEGACY_CLASSIFICATION
      || lineage.superseded_v1.disposition !== PRODUCT_SURFACE_LEGACY_DISPOSITION) {
      throw new Error("prior product_surface superseded_v1 classification/disposition mutated");
    }
    return { v2: { ...lineage.v2 }, superseded_v1: { ...lineage.superseded_v1 } };
  }
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
