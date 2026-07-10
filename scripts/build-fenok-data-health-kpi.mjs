#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { projectPublicKpi } from "./lib/kpi-runtime-projection.mjs";
import {
  calendar_version,
  businessDayAge,
  calendarDayAge,
  hoursAge,
  isoDateOf,
  isFutureSource,
  isRealCalendarDate,
} from "./lib/market-calendar.mjs";
import {
  CADENCE,
  TRACKED_CRONS,
  SOURCE_SLA_DEF,
  SOURCE_WORKFLOW_CRONS,
  REQUIRED_RIM_INDICES,
  REQUIRED_SURFACE_IDS,
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
  const satisfied = new Set(satisfiedSlotKeys || []);
  const deferred = new Set((cronDeferrals || []).map((d) => (typeof d === "string" ? d : d?.slot_key)));
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

export function buildRuntime({ nowIso, env, priorRuntime, overallStatus }) {
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
    status: overallStatus,
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
    warning: "주의",
    blocked: "차단",
    unavailable: "없음",
  }[status] || "점검";
}

function check(id, label, ok, detail, extra = {}) {
  const status = ok ? "ready" : "blocked";
  return { id, label, status, status_label: statusLabel(status), detail, ...extra };
}

function warningCheck(id, label, detail, extra = {}) {
  return { id, label, status: "warning", status_label: statusLabel("warning"), detail, ...extra };
}

function laneStatus(checks) {
  if (checks.some((item) => item.status === "blocked" || item.status === "unavailable")) return "blocked";
  if (checks.some((item) => item.status === "warning")) return "warning";
  return "ready";
}

function lane(id, label, checks, { required = true, counts = {}, details = {}, asOf = null } = {}) {
  const status = laneStatus(checks.filter((item) => item.required !== false));
  return {
    id,
    label,
    status,
    status_label: statusLabel(status),
    required,
    as_of: asOf,
    counts,
    details,
    checks,
  };
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
  const closedCount = number(counts.current_public_plus_blocked);
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
      s1_gap_total: number(counts.s1_gap_total),
      promotion_count: number(counts.promotion_rows),
      blocked_excluded_count: number(counts.blocked_excluded_rows),
      current_public_plus_blocked: closedCount,
    },
    asOf: promotion.artifact_generated_at || coverageIndex?.generated_at || null,
  });
}

function buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket) {
  const track = trackById(coverageIndex, "etf_scoring_lane");
  const counts = track?.evidence_based_readiness?.counts || {};
  const daily = etfDaily1y?.daily_1y_readiness || {};
  const core = etfCoreBasket?.readiness || {};
  const routeText = readText("100xfenok-next/src/app/api/data/fenok-etf-signals/[ticker]/route.ts");
  const staleRouteCaveat = /not PUBLIC\/DAILY\/GATED/i.test(routeText);
  return lane("etf_public_and_daily_gate", "ETF public scoring and daily gate", [
    check("requirements_complete", "PUBLIC+DAILY+GATED", allRequirementsReady(track?.requirements), track?.stage || "missing"),
    check("coverage_gate_ok", "coverage-index ETF gate", bool(track?.evidence_based_readiness?.gate_ok ?? track?.public_done_claim_allowed), track?.readiness_status || "missing"),
    check("fetchable_daily_1y_gap_zero", "daily 1Y fetchable gap", number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable) === 0, `${number(counts.fetchable_daily_1y_gap ?? daily.daily_1y_fetchable)} fetchable`),
    check("fetchable_plan_empty", "exact fetchable plan", number(etfFetchablePlan?.counts?.fetchable) === 0 && (etfFetchablePlan?.tickers || []).length === 0, `${number(etfFetchablePlan?.counts?.fetchable)} fetchable`),
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

function buildRimLane(rimInputs) {
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

function buildFinraOccLane(ledger) {
  const counts = ledger?.counts || {};
  const publicLedgerExists = exists("data/admin/fenok-s0-finra-occ-mapping-ledger.json", PUBLIC_DATA_ROOT);
  return lane("finra_occ_plain_us_and_mapping_policy", "FINRA/OCC source gate", [
    check("ledger_acceptance", "ledger acceptance", ledger?.source_audit?.acceptance_ok === true, ledger?.generated_at || "missing"),
    check("finra_plain_us_ready", "plain US FINRA", number(counts.plain_us_finra_source_ready) === number(counts.plain_us_finra_denominator), `${number(counts.plain_us_finra_source_ready)} / ${number(counts.plain_us_finra_denominator)}`),
    check("occ_plain_us_ready", "plain US OCC", number(counts.plain_us_occ_source_ready) === number(counts.plain_us_occ_denominator), `${number(counts.plain_us_occ_source_ready)} / ${number(counts.plain_us_occ_denominator)}`),
    check("non_plain_not_service_blocker", "non-plain policy", ledger?.service_boundary?.active_s0_daily_source_gate_blocker === false, ledger?.service_boundary?.reason || "missing"),
    check("ledger_private_only", "ledger public mirror", !publicLedgerExists && ledger?.raw_policy?.admin_local_only === true, publicLedgerExists ? "public mirror exists" : "admin-local only"),
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
    },
    asOf: ledger?.generated_at ?? null,
  });
}

function workflowCheck(file, token) {
  return readText(file).includes(token);
}

function buildAutomationLane() {
  return lane("automation_contract", "Daily automation and deploy gates", [
    check("sync_static_builds_kpi", "sync-static KPI build", workflowCheck("100xfenok-next/package.json", "build:fenok-data-health-kpi"), "package script wiring"),
    check("sync_static_checks_kpi", "sync-static KPI check", workflowCheck("100xfenok-next/package.json", "qa:fenok-data-health-kpi"), "package gate wiring"),
    check("update_manifest_rebuilds_kpi", "manifest reconciliation", workflowCheck(".github/workflows/update-manifest.yml", "build:fenok-data-health-kpi"), "update-manifest rebuild path"),
    check("deploy_worker_checks_kpi", "Worker deploy gate", workflowCheck(".github/workflows/deploy-worker.yml", "qa:fenok-data-health-kpi"), "deploy prebuild gate"),
    check("deploy_worker_smokes_kpi", "Worker live KPI smoke", workflowCheck(".github/workflows/deploy-worker.yml", "Smoke data health KPI"), "deploy post-smoke contract"),
    check("yf_daily_no_default_cap", "YF daily stock shards no silent cap", workflowCheck(".github/workflows/fetch-yf-finance.yml", 'INPUT_LIMIT="${YF_DAILY_STOCK_LIMIT:-}"'), "future active universe expansion does not silently fall outside freshness"),
    check("stockanalysis_daily1y_scheduled", "StockAnalysis daily-1Y schedule", workflowCheck(".github/workflows/fetch-stockanalysis.yml", "50 22 * * 1-5") && workflowCheck(".github/workflows/fetch-stockanalysis.yml", "daily_1y"), "weekday catch-up lane"),
    check("edge_daily_dispatches_manifest", "Edge daily manifest dispatch", workflowCheck(".github/workflows/fenok-edge-daily.yml", "gh workflow run update-manifest.yml"), "manifest/RIM/deploy chain"),
    check("krx_daily_dispatches_manifest", "KRX daily manifest dispatch", workflowCheck(".github/workflows/fenok-edge-krx-daily.yml", "gh workflow run update-manifest.yml"), "manifest/RIM/deploy chain"),
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
    check("kpi_public_mirror", "KPI public mirror", true, "root and public KPI are written together"),
    check("rim_public_private_paths_redacted", "RIM private paths", !forbidden.some((token) => rimPublicText.includes(token)), "public RIM mirror token scan"),
    check("coverage_public_private_paths_absent", "coverage private paths", !forbidden.some((token) => coveragePublicText.includes(token)), "public coverage mirror token scan"),
    check("forbidden_tokens_absent", "forbidden public tokens", !forbidden.some((token) => publicText.includes(token)), "aggregate public token scan"),
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
  }, { lanes: lanes.length, ready: 0, warning: 0, blocked: 0, unavailable: 0, required_not_ready: 0 });
  const overallStatus = totals.required_not_ready > 0 ? "blocked" : "ready";
  return { overallStatus, totals };
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

function buildSourceSla({ nowIso, finraOccLedger, rimInputs, etfCoreBasket, coverageIndex, productCoverage, etfDaily1y, priorProductSurfacePending }) {
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

  const lanes = [
    buildStockS0Lane(coverageIndex),
    buildStockS1Lane(coverageIndex),
    buildEtfLane(coverageIndex, etfDaily1y, etfFetchablePlan, etfCoreBasket),
    buildRimLane(rimInputs),
    buildProductSurfaceLane(productCoverage),
    buildFinraOccLane(finraOccLedger),
    buildAutomationLane(),
    buildPublicMirrorLane(rimInputs),
  ];
  const { overallStatus, totals } = summarize(lanes);
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
  });
  const runtime = buildRuntime({ nowIso, env: process.env, priorRuntime, overallStatus });

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: nowIso,
    status: overallStatus,
    status_label: statusLabel(overallStatus),
    purpose: "Admin-safe service data health KPI: current data freshness, daily gates, public mirror safety, and automation contracts.",
    raw_policy: {
      public_mirror_allowed: true,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      private_ledgers_included: false,
      source_artifacts_are_referenced_by_id_only: true,
    },
    runtime,
    source_sla: sourceSla,
    source_artifacts: [
      { id: "fenok_edge_coverage_index", generated_at: coverageIndex?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "rim_index_inputs", generated_at: rimInputs?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "product_surface_coverage", generated_at: productCoverage?.generated_at ?? null, public_mirror: true, public_safe: true },
      { id: "s0_finra_occ_mapping_ledger", generated_at: finraOccLedger?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "etf_daily1y_readiness_admin", generated_at: etfDaily1y?.generated_at ?? null, public_mirror: false, public_safe: false },
      { id: "etf_core_daily_basket_admin", generated_at: etfCoreBasket?.generated_at ?? null, public_mirror: false, public_safe: false },
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
    ok: rootDoc.status === "ready",
    schema_version: rootDoc.schema_version,
    status: rootDoc.status,
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
