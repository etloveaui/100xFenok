#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { projectPublicKpi, projectRuntime } from "../../scripts/lib/kpi-runtime-projection.mjs";
import {
  classifyRuntimeSlots,
  isCanonicalRuntimeSlotKey,
  parseRuntimeSlotKey,
  publicationGateForRuntime,
  validateCronDeferrals,
} from "../../scripts/lib/kpi-runtime-slots.mjs";
import { isFutureSource, isRealCalendarDate, yahooBusinessDayAge, calendar_version } from "../../scripts/lib/market-calendar.mjs";
// Canonical definitions come from the CONSTANTS module, NOT the artifact and NOT
// the builder — the checker validates the artifact against these.
import {
  CADENCE,
  TRACKED_CRONS,
  SOURCE_SLA_DEF,
  SLA_DEFINITIONAL_KEYS,
  PUBLIC_RUNTIME_DENY_KEYS,
  TOLERANCE_MINUTES,
  PENDING_MAX_AGE_DAYS,
  PLATFORM_BLOCKING_CHECK_KEYS,
  SLICKCHARTS_DELIVERY_GROUPS,
  YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
} from "../../scripts/lib/kpi-contract-constants.mjs";
import {
  enumerateDueSlots,
  deriveMissedSlots,
  evaluateSlaAge,
  slaStatusForAge,
  classifyProductSurface,
  compactRecoveryIndex,
  projectRecoveryRecoveredSet,
  projectRecoveryRetrySet,
} from "../../scripts/build-fenok-data-health-kpi.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "../../scripts/lib/data-supply-detection-config.mjs";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const SCHEMA_VERSION_V1 = "fenok-data-health-kpi/v1";
const SCHEMA_VERSION_V2 = "fenok-data-health-kpi/v2";
// Phase A is warn-only; Phase B flips producer-null / stale-required / over-ceiling
// age into hard failures. Default OFF so this commit stays warn-only. NOTE: a
// DEFINITION tamper (cadence/SLA table not matching canonical) is ALWAYS a hard
// error regardless of this flag.
const STRICT = process.env.KPI_STRICT === "1" || process.argv.includes("--strict");
const FRESHNESS_TOLERANCE_MINUTES = TOLERANCE_MINUTES;

const DETECTION_LIVE_LANE_CONFIGS = DATA_SUPPLY_DETECTION_CONFIG.lanes.filter((item) => item.enforcement === "live");
const REQUIRED_LANES = new Set([
  "stock_s0_active_daily_gate",
  "stock_s1_candidate_gate",
  "etf_public_and_daily_gate",
  "yahoo_batch_quote_history",
  "slickcharts_delivery_freshness",
  "rim_inputs",
  "product_surface_freshness",
  "finra_occ_plain_us_and_mapping_policy",
  "automation_contract",
  "public_mirror_safety",
  ...DETECTION_LIVE_LANE_CONFIGS.map((item) => item.id),
]);
const FORBIDDEN_PUBLIC_TOKENS = [
  "_private/",
  "\"private_manifest_file\"",
  "\"manifest_file\"",
  "\"tickers\"",
];

function getArg(flag) {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

function resolvePaths() {
  const dataRoot = getArg("--data-root");
  if (dataRoot) {
    return {
      rootKpiPath: path.join(dataRoot, "data", "admin", "fenok-data-health-kpi.json"),
      publicKpiPath: path.join(dataRoot, "public", "data", "admin", "fenok-data-health-kpi.json"),
    };
  }
  return {
    rootKpiPath: path.join(REPO_ROOT, "data", "admin", "fenok-data-health-kpi.json"),
    publicKpiPath: path.join(APP_ROOT, "public", "data", "admin", "fenok-data-health-kpi.json"),
  };
}

function resolveNow() {
  const fake = process.env.KPI_FAKE_NOW;
  if (fake) {
    const t = new Date(fake);
    if (Number.isFinite(t.getTime())) return t.toISOString();
  }
  return new Date().toISOString();
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} read failed: ${error.message}`);
  }
}

function readOptionalJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error(`${filePath} read failed: ${error.message}`);
  }
}

function push(list, condition, message) {
  if (!condition) list.push(message);
}

const DETECTION_KPI_REASONS = new Set([
  "ok", "missing_artifact", "workflow_unobserved", "transport_error", "http_error",
  "auth_error", "rate_limited", "decode_error", "schema_drift", "empty_payload",
  "future_source", "stale", "unexpected_error", "recovery_degraded",
]);
const TARGET_RECOVERY_LANE_IDS = new Set(["yahoo_ticker_macro", "slickcharts"]);

function isDetectionSourceStamp(value) {
  if (typeof value !== "string") return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isRealCalendarDate(value);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && isRealCalendarDate(value.slice(0, 10))
    && Number.isFinite(new Date(value).getTime());
}

export function checkDetectionFloorLane(lane, errors, expectedConfig) {
  const laneId = expectedConfig?.id ?? lane?.id ?? "<unknown>";
  const sourceAsOf = lane?.artifact?.source_as_of;
  const statusCheck = (lane?.checks || []).find((item) => item?.id === "detection_floor_status");
  const recoveryChecks = (lane?.checks || []).filter((item) => String(item?.id ?? "").startsWith("recovery_"));
  const targetRecovery = TARGET_RECOVERY_LANE_IDS.has(laneId);
  const detectionReason = targetRecovery ? lane?.details?.detection_reason : lane?.reason;
  const expectedDetectionStatus = detectionReason === "ok" ? "ready" : "blocked";
  const recoveryRetrySet = lane?.details?.recovery_retry_set;
  const recoveryRecovered = lane?.details?.recovery_recovered;
  const retrySetValid = targetRecovery ? true : Array.isArray(recoveryRetrySet) && recoveryRetrySet.every((item) => {
    const keys = item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item).sort() : [];
    return JSON.stringify(keys) === JSON.stringify([
      "failure_run_id", "key", "recovered_from_run_id", "resolution_state",
    ])
      && typeof item.key === "string" && item.key !== ""
      && ["lkg_primary", "unavailable"].includes(item.resolution_state)
      && typeof item.failure_run_id === "string" && item.failure_run_id !== ""
      && (item.recovered_from_run_id === null
        || (typeof item.recovered_from_run_id === "string" && item.recovered_from_run_id !== ""));
  }) && new Set(recoveryRetrySet.map((item) => item.key)).size === recoveryRetrySet.length
    && recoveryRetrySet.every((item, index) => index === 0 || recoveryRetrySet[index - 1].key.localeCompare(item.key) < 0);
  const recoveredValid = targetRecovery ? true : Array.isArray(recoveryRecovered) && recoveryRecovered.every((item) => {
    const keys = item && typeof item === "object" && !Array.isArray(item) ? Object.keys(item).sort() : [];
    return JSON.stringify(keys) === JSON.stringify([
      "key", "lkg_source_as_of", "recovered_at", "recovered_from_run_id", "recovery_event_name",
      "recovery_run_attempt", "recovery_run_id", "resolution_state", "retry", "source_as_of",
    ])
      && typeof item.key === "string" && item.key !== ""
      && item.resolution_state === "fresh_primary" && item.retry === false
      && typeof item.recovered_from_run_id === "string" && item.recovered_from_run_id !== ""
      && typeof item.recovery_run_id === "string" && item.recovery_run_id !== ""
      && item.recovery_run_id !== item.recovered_from_run_id
      && item.recovery_run_attempt === 1 && item.recovery_event_name === "schedule"
      && isDetectionSourceStamp(item.recovered_at)
      && isDetectionSourceStamp(item.lkg_source_as_of)
      && isDetectionSourceStamp(item.source_as_of)
      && Date.parse(item.source_as_of) > Date.parse(item.lkg_source_as_of);
  }) && new Set(recoveryRecovered.map((item) => item.key)).size === recoveryRecovered.length
    && recoveryRecovered.every((item, index) => index === 0 || recoveryRecovered[index - 1].key.localeCompare(item.key) < 0)
    && recoveryRecovered.every((item) => !recoveryRetrySet.some((retryItem) => retryItem.key === item.key));
  const hasRetry = !targetRecovery && Array.isArray(recoveryRetrySet) && recoveryRetrySet.length > 0;
  const expectedStatus = targetRecovery
    ? (lane?.reason === "recovery_degraded" || detectionReason !== "ok" ? "degraded" : "ready")
    : (lane?.reason === "ok" && !hasRetry ? "ready" : "degraded");
  const retryCheck = (lane?.checks || []).find((item) => item?.id === "lkg_retry_set_empty");
  push(errors, expectedConfig?.enforcement === "live" && expectedConfig?.kpi_required === true,
    `${laneId}: canonical detection-floor config is not live/required`);
  push(errors, lane?.id === expectedConfig?.id, `${laneId}: lane identity is invalid`);
  push(errors, lane?.label === expectedConfig?.label, `${laneId}: label is invalid`);
  push(errors, lane?.required === true, `${laneId}: lane must be required`);
  push(errors, DETECTION_KPI_REASONS.has(lane?.reason), `${laneId}: reason is invalid (${lane?.reason})`);
  push(errors, DETECTION_KPI_REASONS.has(detectionReason) && detectionReason !== "recovery_degraded",
    `${laneId}: detection reason is invalid (${detectionReason})`);
  push(errors, lane?.status === expectedStatus,
    `${laneId}: status ${lane?.status} contradicts reason ${lane?.reason}`);
  push(errors, !targetRecovery || lane?.reason !== "recovery_degraded"
    || (detectionReason === "ok" && recoveryChecks.some((item) => item?.status === "blocked")),
    `${laneId}: recovery_degraded lacks a failed named recovery check`);
  push(errors, lane?.deployment_blocking === false, `${laneId}: must remain lane-local and non-deployment-blocking`);
  push(errors, sourceAsOf === null || isDetectionSourceStamp(sourceAsOf),
    `${laneId}: artifact.source_as_of is malformed`);
  push(errors, !["ok", "stale"].includes(detectionReason) || sourceAsOf !== null,
    `${laneId}: ready/stale reason contradicts null source_as_of`);
  push(errors, lane?.as_of === sourceAsOf, `${laneId}: as_of must preserve artifact.source_as_of`);
  push(errors, statusCheck?.status === expectedDetectionStatus,
    `${laneId}: detection_floor_status check does not match detection reason`);
  push(errors, statusCheck?.platform_blocking === false,
    `${laneId}: detection_floor_status must not be platform blocking`);
  if (targetRecovery) {
    const expectedRecoveryIds = [
      "recovery_state_present",
      "recovery_current_attempt",
      "recovery_retry_set_empty",
      "recovery_lkg_integrity",
    ];
    push(errors,
      JSON.stringify(recoveryChecks.map((item) => item?.id)) === JSON.stringify(expectedRecoveryIds),
      `${laneId}: named recovery checks are incomplete or out of order`);
    for (const recoveryCheck of recoveryChecks) {
      push(errors, ["ready", "blocked"].includes(recoveryCheck?.status),
        `${laneId}: ${recoveryCheck?.id} status is invalid`);
      push(errors, recoveryCheck?.platform_blocking === false,
        `${laneId}: ${recoveryCheck?.id} must not be platform blocking`);
    }
  } else {
    push(errors, retrySetValid, `${laneId}: details.recovery_retry_set is malformed`);
    push(errors, recoveredValid, `${laneId}: details.recovery_recovered is malformed`);
    push(errors, retryCheck?.status === (hasRetry ? "blocked" : "ready"),
      `${laneId}: lkg_retry_set_empty check does not match retry evidence`);
    push(errors, retryCheck?.platform_blocking === false,
      `${laneId}: lkg_retry_set_empty must not be platform blocking`);
  }
}

export function checkRecoveryStateSources(rootDoc, rootKpiPath, errors) {
  const adminRoot = path.dirname(rootKpiPath);
  const lanesById = new Map((rootDoc?.lanes || []).map((lane) => [lane?.id, lane]));
  for (const laneId of ["fred_macro", "fred_banking", "fdic_tier1"]) {
    let expectedRetry;
    let expectedRecovered;
    try {
      const state = readOptionalJson(path.join(adminRoot, laneId, "index.json"));
      expectedRetry = projectRecoveryRetrySet(state, laneId);
      expectedRecovered = projectRecoveryRecoveredSet(state, laneId);
    } catch (error) {
      errors.push(`${laneId}: recovery state source is invalid (${error.message})`);
      continue;
    }
    const actualRetry = lanesById.get(laneId)?.details?.recovery_retry_set;
    const actualRecovered = lanesById.get(laneId)?.details?.recovery_recovered;
    push(errors, JSON.stringify(actualRetry) === JSON.stringify(expectedRetry),
      `${laneId}: KPI recovery_retry_set does not match its source index`);
    push(errors, JSON.stringify(actualRecovered) === JSON.stringify(expectedRecovered),
      `${laneId}: KPI recovery_recovered does not match its source index`);
  }
  for (const [laneId, stateDir] of [
    ["yahoo_ticker_macro", "yahoo-hourly-ticker"],
    ["slickcharts", "slickcharts-daily-delivery"],
  ]) {
    const state = readOptionalJson(path.join(adminRoot, stateDir, "index.json"));
    const lane = lanesById.get(laneId);
    if (state === null && !Object.hasOwn(lane?.details ?? {}, "recovery")) continue;
    const expected = compactRecoveryIndex(state);
    const actual = lane?.details?.recovery;
    push(errors, JSON.stringify(actual) === JSON.stringify(expected),
      `${laneId}: KPI recovery evidence does not match its source index`);
  }
  try {
    const state = readOptionalJson(path.join(adminRoot, "nasdaq_giw_sox", "index.json"));
    const rimLane = lanesById.get("rim_inputs");
    const hasKpiEvidence = Object.hasOwn(rimLane?.details ?? {}, "recovery_retry_set")
      || Object.hasOwn(rimLane?.details ?? {}, "recovery_recovered");
    if (state !== null || hasKpiEvidence) {
      const expectedRetry = projectRecoveryRetrySet(state, "nasdaq_giw_sox");
      const expectedRecovered = projectRecoveryRecoveredSet(state, "nasdaq_giw_sox");
      push(errors, JSON.stringify(rimLane?.details?.recovery_retry_set) === JSON.stringify(expectedRetry),
        "rim_inputs: SOX KPI recovery_retry_set does not match its source index");
      push(errors, JSON.stringify(rimLane?.details?.recovery_recovered) === JSON.stringify(expectedRecovered),
        "rim_inputs: SOX KPI recovery_recovered does not match its source index");
      const soxChecks = (rimLane?.checks || []).filter((row) => String(row?.id ?? "").startsWith("sox_"));
      push(errors, JSON.stringify(soxChecks.map((row) => row?.id)) === JSON.stringify([
        "sox_recovery_state_present",
        "sox_retry_set_empty",
      ]), "rim_inputs: SOX named recovery checks are incomplete or out of order");
      const stateCheck = soxChecks[0];
      const retryCheck = soxChecks[1];
      const expectedRetryDetail = expectedRetry.length === 0
        ? "retry set is empty"
        : expectedRetry.map((item) => `${item.key} ${item.resolution_state} after run ${item.failure_run_id}`).join("; ");
      push(errors, stateCheck?.status === (state === null ? "warning" : "ready"),
        "rim_inputs: SOX recovery-state check contradicts its source index");
      push(errors, retryCheck?.status === (expectedRetry.length === 0 ? "ready" : "warning"),
        "rim_inputs: SOX retry check contradicts its source index");
      push(errors, retryCheck?.detail === expectedRetryDetail,
        "rim_inputs: SOX retry check detail contradicts its source index");
      for (const check of soxChecks) {
        push(errors, check?.required === false, `rim_inputs: ${check?.id ?? "SOX check"} must remain non-required`);
        push(errors, check?.platform_blocking === false, `rim_inputs: ${check?.id ?? "SOX check"} must remain non-platform-blocking`);
      }
    }
  } catch (error) {
    errors.push(`rim_inputs: SOX recovery state source is invalid (${error.message})`);
  }
}

function ageHoursBetween(fromIso, nowIso) {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(now)) return null;
  return (now - from) / 3600000;
}

// ── shared lane/shape validation (v1 + v2) ──────────────────────────────────

function validateCoreShape(payload, errors, expectedVersion, warnings = []) {
  const isV2 = expectedVersion === SCHEMA_VERSION_V2;
  push(errors, payload?.schema_version === expectedVersion, `schema_version must be ${expectedVersion}, got ${payload?.schema_version ?? "missing"}`);
  push(errors, typeof payload?.generated_at === "string" && payload.generated_at.length >= 10, "generated_at is required");
  if (isV2) {
    push(errors, ["ready", "degraded", "blocked"].includes(payload?.status),
      `status must be ready/degraded/blocked, got ${payload?.status ?? "missing"}`);
  } else {
    push(errors, payload?.status === "ready", `status must be ready, got ${payload?.status ?? "missing"}`);
  }
  push(errors, payload?.raw_policy?.public_mirror_allowed === true, "raw_policy.public_mirror_allowed must be true");
  push(errors, payload?.raw_policy?.raw_rows_included === false, "raw_policy.raw_rows_included must be false");
  push(errors, payload?.raw_policy?.private_artifact_paths_included === false, "raw_policy.private_artifact_paths_included must be false");
  push(errors, payload?.raw_policy?.private_ledgers_included === false, "raw_policy.private_ledgers_included must be false");
  push(errors, Array.isArray(payload?.lanes) && payload.lanes.length >= REQUIRED_LANES.size, "lanes are required");

  const lanesById = new Map((payload?.lanes || []).map((lane) => [lane?.id, lane]));
  const platformBlockingKeys = new Set(PLATFORM_BLOCKING_CHECK_KEYS);
  const derivedIntegrityBlockers = [];
  let derivedRequiredNotReady = 0;
  for (const laneId of REQUIRED_LANES) {
    const lane = lanesById.get(laneId);
    let laneIntegrityBlockerCount = 0;
    push(errors, Boolean(lane), `${laneId}: lane missing`);
    if (isV2) {
      push(errors, ["ready", "degraded", "blocked", "warning"].includes(lane?.status),
        `${laneId}: lane status is invalid (${lane?.status})`);
      if (lane?.required !== false && lane?.status !== "ready") derivedRequiredNotReady += 1;
      if (lane?.status !== "ready") warnings.push(`${laneId}: lane is ${lane?.status} — ${lane?.status_message || "not ready"}`);
    } else {
      push(errors, lane?.status === "ready", `${laneId}: lane status must be ready`);
    }
    for (const check of lane?.checks || []) {
      const key = `${laneId}/${check?.id || "check"}`;
      const canonicalPlatformBlocking = platformBlockingKeys.has(key);
      if (isV2) {
        push(errors, check?.platform_blocking === canonicalPlatformBlocking,
          `${key}: platform_blocking must match canonical (${canonicalPlatformBlocking})`);
        if (canonicalPlatformBlocking && check?.status !== "ready") {
          laneIntegrityBlockerCount += 1;
          derivedIntegrityBlockers.push({ lane_id: laneId, check_id: check.id, label: check.label, detail: check.detail });
        } else if (check?.required !== false && check?.status !== "ready") {
          warnings.push(`${key}: lane-local required check is ${check?.status}`);
        }
      } else if (check?.required !== false) {
        push(errors, check?.status === "ready", `${key}: required check is ${check?.status}`);
      }
    }
    if (isV2) {
      push(errors, Boolean(lane?.deployment_blocking) === (laneIntegrityBlockerCount > 0),
        `${laneId}: deployment_blocking does not match canonical integrity checks`);
    }
  }

  if (isV2) {
    const laneRows = Array.isArray(payload?.lanes) ? payload.lanes : [];
    const statusCounts = laneRows.reduce((acc, row) => {
      if (Object.hasOwn(acc, row?.status)) acc[row.status] += 1;
      return acc;
    }, { ready: 0, degraded: 0, warning: 0, blocked: 0, unavailable: 0 });
    push(errors, laneRows.length === REQUIRED_LANES.size,
      `totals.lanes requires exactly ${REQUIRED_LANES.size} lanes, got ${laneRows.length}`);
    push(errors, Number(payload?.totals?.lanes) === laneRows.length,
      `totals.lanes mismatch: ${payload?.totals?.lanes} vs derived ${laneRows.length}`);
    for (const [status, count] of Object.entries(statusCounts)) {
      push(errors, Number(payload?.totals?.[status]) === count,
        `totals.${status} mismatch: ${payload?.totals?.[status]} vs derived ${count}`);
    }
    for (const laneConfig of DETECTION_LIVE_LANE_CONFIGS) {
      checkDetectionFloorLane(lanesById.get(laneConfig.id), errors, laneConfig);
    }
    push(errors, Number(payload?.totals?.required_not_ready) === derivedRequiredNotReady,
      `totals.required_not_ready mismatch: ${payload?.totals?.required_not_ready} vs derived ${derivedRequiredNotReady}`);
    push(errors, Number(payload?.totals?.platform_blocking_not_ready) === derivedIntegrityBlockers.length,
      `totals.platform_blocking_not_ready mismatch: ${payload?.totals?.platform_blocking_not_ready} vs derived ${derivedIntegrityBlockers.length}`);
    const integrity = payload?.deployment_integrity;
    push(errors, integrity && typeof integrity === "object", "deployment_integrity is required in v2");
    const expectedIntegrityStatus = derivedIntegrityBlockers.length > 0 ? "blocked" : "ready";
    push(errors, integrity?.status === expectedIntegrityStatus,
      `deployment_integrity.status mismatch: ${integrity?.status} vs ${expectedIntegrityStatus}`);
    push(errors, Number(integrity?.blocker_count) === derivedIntegrityBlockers.length,
      `deployment_integrity.blocker_count mismatch: ${integrity?.blocker_count} vs ${derivedIntegrityBlockers.length}`);
    push(errors, JSON.stringify(integrity?.blockers || []) === JSON.stringify(derivedIntegrityBlockers),
      "deployment_integrity.blockers do not match canonical platform-blocking checks");
    push(errors, expectedIntegrityStatus === "ready",
      `platform deployment integrity is ${expectedIntegrityStatus}`);
    const expectedStatus = expectedIntegrityStatus === "blocked"
      ? "blocked"
      : derivedRequiredNotReady > 0 ? "degraded" : "ready";
    push(errors, payload?.status === expectedStatus,
      `top-level status mismatch: ${payload?.status} vs derived ${expectedStatus}`);
  }

  const artifacts = Array.isArray(payload?.source_artifacts) ? payload.source_artifacts : [];
  const unsafe = artifacts.filter((a) => a?.public_mirror === true && a?.public_safe !== true);
  push(errors, unsafe.length === 0, `public source artifacts must be public_safe: ${unsafe.map((i) => i.id).join(", ")}`);
  if (isV2) {
    const yahoo = lanesById.get("yahoo_batch_quote_history");
    const yahooCounts = yahoo?.counts || {};
    const countKeys = ["active", "untracked", "fresh", "lkg", "pending_history", "unavailable", "retry", "failed", "stale"];
    for (const key of countKeys) {
      push(errors, typeof yahooCounts[key] === "number" && Number.isInteger(yahooCounts[key]) && yahooCounts[key] >= 0,
        `yahoo_batch_quote_history.counts.${key} must be a non-negative integer`);
    }
    const active = Number(yahooCounts.active);
    const classified = Number(yahooCounts.untracked) + Number(yahooCounts.fresh) + Number(yahooCounts.lkg)
      + Number(yahooCounts.pending_history) + Number(yahooCounts.unavailable);
    push(errors, classified === active,
      `yahoo_batch_quote_history classified count mismatch: ${classified} vs active ${active}`);
    push(errors, Number(yahooCounts.retry) <= Number(yahooCounts.lkg) + Number(yahooCounts.pending_history) + Number(yahooCounts.unavailable),
      "yahoo_batch_quote_history retry count exceeds non-fresh states");
    push(errors, Number(yahooCounts.failed) <= Number(yahooCounts.lkg) + Number(yahooCounts.unavailable),
      "yahoo_batch_quote_history failed count exceeds LKG/unavailable states");
    push(errors, Number(yahooCounts.stale) <= Number(yahooCounts.lkg),
      "yahoo_batch_quote_history stale count exceeds LKG states");
    const oldestDate = yahooCounts.oldest_source_date;
    const oldestStamp = yahoo?.as_of;
    const oldestValid = typeof oldestStamp === "string"
      && (/^\d{4}-\d{2}-\d{2}$/.test(oldestStamp)
        || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(oldestStamp))
      && isRealCalendarDate(oldestStamp.slice(0, 10))
      && Number.isFinite(new Date(oldestStamp).getTime())
      && oldestDate === oldestStamp.slice(0, 10);
    push(errors, oldestStamp === null || oldestValid,
      "yahoo_batch_quote_history oldest source timestamp/date is malformed or inconsistent");
    const stateGeneratedAt = yahoo?.details?.state_generated_at;
    const stateTimestampRequired = active > 0 || oldestStamp !== null;
    const stateTimestampValid = typeof stateGeneratedAt === "string" && Number.isFinite(new Date(stateGeneratedAt).getTime());
    push(errors, !stateTimestampRequired || stateTimestampValid,
      "yahoo_batch_quote_history state_generated_at is required");
    push(errors, !oldestValid || (stateTimestampValid && new Date(oldestStamp).getTime() <= new Date(stateGeneratedAt).getTime()),
      "yahoo_batch_quote_history oldest source timestamp follows state_generated_at");
    const sourceAge = oldestValid
      ? yahooBusinessDayAge(oldestDate, payload.generated_at, yahooCounts.oldest_source_symbol)
      : null;
    push(errors, yahooCounts.oldest_source_age_business_days === sourceAge,
      `yahoo_batch_quote_history oldest source age mismatch: ${yahooCounts.oldest_source_age_business_days} vs ${sourceAge}`);
    push(errors, yahooCounts.max_source_age_business_days === YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
      "yahoo_batch_quote_history max source age differs from canonical");
    const latestAttempt = yahoo?.details?.latest_attempt;
    push(errors, latestAttempt && typeof latestAttempt === "object",
      "yahoo_batch_quote_history.details.latest_attempt is required");
    for (const key of ["attempt_number", "attempted", "successes", "failed", "skipped", "fetch_attempts"]) {
      push(errors, typeof latestAttempt?.[key] === "number" && Number.isInteger(latestAttempt[key]) && latestAttempt[key] >= 0,
        `yahoo_batch_quote_history.details.latest_attempt.${key} must be a non-negative integer`);
    }
    push(errors, Number(latestAttempt?.attempted) === Number(latestAttempt?.successes) + Number(latestAttempt?.failed) + Number(latestAttempt?.skipped),
      "yahoo_batch_quote_history latest attempt totals do not reconcile");
    push(errors, Number(latestAttempt?.fetch_attempts) >= Number(latestAttempt?.attempted) - Number(latestAttempt?.skipped),
      "yahoo_batch_quote_history fetch_attempts is below non-skipped attempts");
    const yahooReady = active > 0
      && Number(yahooCounts.untracked) === 0
      && Number(yahooCounts.fresh) === active
      && Number(yahooCounts.lkg) === 0
      && Number(yahooCounts.pending_history) === 0
      && Number(yahooCounts.unavailable) === 0
      && Number(yahooCounts.retry) === 0
      && Number(latestAttempt?.failed) === 0
      && oldestValid
      && sourceAge != null
      && sourceAge <= YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS;
    push(errors, yahoo?.status === (yahooReady ? "ready" : "degraded"),
      `yahoo_batch_quote_history status mismatch: ${yahoo?.status} vs ${yahooReady ? "ready" : "degraded"}`);
    push(errors, yahoo?.deployment_blocking === false,
      "yahoo_batch_quote_history must remain lane-local and non-deployment-blocking");
    const detailRules = [
      ["lkg", new Set(["symbol", "payload_sha256", "source_as_of", "failure_attempt_ref", "failure_observed_at"])],
      ["pending_history", new Set(["symbol", "discovered_from", "missing", "first_trade_date", "initial_attempt_ref", "expected_resolution", "reason"])],
      ["unavailable", new Set(["symbol", "failure_attempt_ref", "failure_observed_at", "failure_kind", "lkg_status", "data_loss", "deferred_acquisition", "retry", "expected_resolution"])],
    ];
    for (const [key, allowlist] of detailRules) {
      const rows = yahoo?.details?.[key] ?? [];
      push(errors, Array.isArray(rows) && rows.length <= 20,
        `yahoo_batch_quote_history.details.${key} must be an array of at most 20 rows`);
      for (const row of Array.isArray(rows) ? rows : []) {
        const extraKeys = Object.keys(row || {}).filter((field) => !allowlist.has(field));
        push(errors, extraKeys.length === 0,
          `yahoo_batch_quote_history.details.${key} contains non-public fields: ${extraKeys.join(", ")}`);
      }
    }
    const unavailableDetails = yahoo?.details?.unavailable ?? [];
    const unavailableSymbols = [];
    push(errors, Array.isArray(unavailableDetails)
      && unavailableDetails.length === Math.min(Number(yahooCounts.unavailable), 20),
      `yahoo_batch_quote_history unavailable detail count mismatch: ${Array.isArray(unavailableDetails) ? unavailableDetails.length : "invalid"} vs ${Math.min(Number(yahooCounts.unavailable), 20)}`);
    for (const row of Array.isArray(unavailableDetails) ? unavailableDetails : []) {
      push(errors, typeof row?.symbol === "string" && row.symbol.length > 0,
        "yahoo_batch_quote_history unavailable symbol must be a non-empty string");
      unavailableSymbols.push(row?.symbol);
      push(errors, row?.retry === true,
        "yahoo_batch_quote_history unavailable detail must remain in the retry set");
      push(errors, ["absent", "lost"].includes(row?.lkg_status),
        "yahoo_batch_quote_history unavailable LKG status is invalid");
      push(errors, typeof row?.data_loss === "boolean",
        "yahoo_batch_quote_history unavailable data_loss must be boolean");
      push(errors, typeof row?.deferred_acquisition === "boolean",
        "yahoo_batch_quote_history unavailable deferred_acquisition must be boolean");
      push(errors, typeof row?.failure_kind === "string" && row.failure_kind.length > 0,
        "yahoo_batch_quote_history unavailable failure kind is required");
      push(errors, typeof row?.failure_attempt_ref === "string" && row.failure_attempt_ref.length > 0,
        "yahoo_batch_quote_history unavailable failure attempt is required");
      push(errors, typeof row?.failure_observed_at === "string" && Number.isFinite(new Date(row.failure_observed_at).getTime()),
        "yahoo_batch_quote_history unavailable failure timestamp is invalid");
      push(errors, row?.expected_resolution === "next_natural_yahoo_run",
        "yahoo_batch_quote_history unavailable recovery path is invalid");
      const expectedDataLoss = row?.lkg_status === "lost";
      push(errors, row?.data_loss === expectedDataLoss,
        "yahoo_batch_quote_history data-loss provenance is invalid");
      const expectedDeferred = row?.failure_kind === "transient_provider_miss"
        && row?.lkg_status === "absent"
        && row?.data_loss === false;
      push(errors, row?.deferred_acquisition === expectedDeferred,
        "yahoo_batch_quote_history deferred acquisition provenance is invalid");
    }
    push(errors, new Set(unavailableSymbols).size === unavailableSymbols.length,
      "yahoo_batch_quote_history unavailable symbols must be unique");
    const staleGroups = yahoo?.details?.stale_groups ?? [];
    push(errors, Array.isArray(staleGroups) && staleGroups.length <= active,
      "yahoo_batch_quote_history.details.stale_groups must be bounded by the active universe");
    const staleSymbols = [];
    for (const row of Array.isArray(staleGroups) ? staleGroups : []) {
      const allowlist = new Set(["source_as_of", "source_age_business_days", "max_source_age_business_days", "expected_resolution", "symbols"]);
      const extraKeys = Object.keys(row || {}).filter((field) => !allowlist.has(field));
      push(errors, extraKeys.length === 0,
        `yahoo_batch_quote_history.details.stale_groups contains non-public fields: ${extraKeys.join(", ")}`);
      push(errors, Array.isArray(row?.symbols) && row.symbols.every((symbol) => typeof symbol === "string" && symbol.length > 0),
        "yahoo_batch_quote_history stale group symbols must be non-empty strings");
      staleSymbols.push(...(Array.isArray(row?.symbols) ? row.symbols : []));
      const sourceDate = typeof row?.source_as_of === "string" ? row.source_as_of.slice(0, 10) : null;
      const expectedAge = sourceDate && row?.symbols?.[0]
        ? yahooBusinessDayAge(sourceDate, payload.generated_at, row.symbols[0])
        : null;
      push(errors, isRealCalendarDate(sourceDate), "yahoo_batch_quote_history stale group source_as_of is invalid");
      push(errors, row?.source_age_business_days === expectedAge,
        `yahoo_batch_quote_history stale group source age mismatch: ${row?.source_age_business_days} vs ${expectedAge}`);
      push(errors, row?.max_source_age_business_days === YAHOO_BATCH_MAX_SOURCE_BUSINESS_DAYS,
        "yahoo_batch_quote_history stale group max age differs from canonical");
      push(errors, row?.expected_resolution === "next_natural_yahoo_run",
        "yahoo_batch_quote_history stale group recovery path is invalid");
    }
    push(errors, new Set(staleSymbols).size === staleSymbols.length,
      "yahoo_batch_quote_history stale group symbols must be unique");
    push(errors, staleSymbols.length === Number(yahooCounts.stale),
      `yahoo_batch_quote_history stale detail count mismatch: ${staleSymbols.length} vs ${yahooCounts.stale}`);
    push(errors, artifacts.some((item) => item?.id === "yahoo_batch_quote_history_state"),
      "yahoo_batch_quote_history_state source artifact is required");

    const slick = lanesById.get("slickcharts_delivery_freshness");
    const slickCounts = slick?.counts || {};
    for (const key of ["required", "fixed", "current_universe", "current", "missing", "stale", "invalid"]) {
      push(errors, typeof slickCounts[key] === "number" && Number.isInteger(slickCounts[key]) && slickCounts[key] >= 0,
        `slickcharts_delivery_freshness.counts.${key} must be a non-negative integer`);
    }
    const fixedCount = SLICKCHARTS_DELIVERY_GROUPS.reduce((sum, group) => sum + group.files.length, 0);
    push(errors, Number(slickCounts.fixed) === fixedCount,
      `slickcharts_delivery_freshness fixed count mismatch: ${slickCounts.fixed} vs ${fixedCount}`);
    push(errors, Number(slickCounts.required) === Number(slickCounts.fixed) + Number(slickCounts.current_universe),
      "slickcharts_delivery_freshness required count does not equal fixed + current universe");
    push(errors, Number(slickCounts.required) === Number(slickCounts.current) + Number(slickCounts.missing) + Number(slickCounts.stale) + Number(slickCounts.invalid),
      "slickcharts_delivery_freshness classified counts do not reconcile");
    const workflowSla = slick?.details?.workflow_sla;
    push(errors, Array.isArray(workflowSla) && workflowSla.length === SLICKCHARTS_DELIVERY_GROUPS.length,
      "slickcharts_delivery_freshness must expose all five workflow SLA groups");
    const bySourceId = new Map((Array.isArray(workflowSla) ? workflowSla : []).map((row) => [row?.source_id, row]));
    for (const group of SLICKCHARTS_DELIVERY_GROUPS) {
      const row = bySourceId.get(group.id);
      const expectedRequired = group.files.length + (group.include_current_universe ? Number(slickCounts.current_universe) : 0);
      push(errors, row?.workflow_id === group.workflow, `${group.id}: workflow id differs from canonical`);
      push(errors, row?.max_hours === group.max_hours, `${group.id}: max hours differs from canonical`);
      push(errors, row?.required === expectedRequired, `${group.id}: required artifact count mismatch`);
      push(errors, Number(row?.required) === Number(row?.current) + Number(row?.missing) + Number(row?.stale) + Number(row?.invalid),
        `${group.id}: classified artifact counts do not reconcile`);
    }
    const slickChecks = new Map((slick?.checks || []).map((row) => [row?.id, row]));
    const slickIntegrityBlocked = ["json_integrity", "universe_identity"].some((id) => slickChecks.get(id)?.status !== "ready");
    const slickDeliveryReady = Number(slickCounts.missing) === 0 && Number(slickCounts.stale) === 0 && Number(slickCounts.invalid) === 0
      && slickChecks.get("delivery_ready")?.status === "ready";
    const expectedSlickStatus = slickIntegrityBlocked ? "blocked" : slickDeliveryReady ? "ready" : "degraded";
    push(errors, slick?.status === expectedSlickStatus,
      `slickcharts_delivery_freshness status mismatch: ${slick?.status} vs ${expectedSlickStatus}`);
    push(errors, slick?.deployment_blocking === slickIntegrityBlocked,
      "slickcharts_delivery_freshness deployment blocking must follow corruption checks only");
    const offenders = slick?.details?.offenders;
    push(errors, Array.isArray(offenders) && offenders.length <= 20,
      "slickcharts_delivery_freshness offenders must be an array of at most 20 rows");
    const offenderAllowlist = new Set(["workflow_id", "artifact", "symbol", "reason", "delivery_at", "age_hours", "max_hours", "status"]);
    for (const row of Array.isArray(offenders) ? offenders : []) {
      const extraKeys = Object.keys(row || {}).filter((field) => !offenderAllowlist.has(field));
      push(errors, extraKeys.length === 0,
        `slickcharts_delivery_freshness offender contains non-public fields: ${extraKeys.join(", ")}`);
    }
  }
}

function scanForbiddenTokens(publicKpiPath, errors) {
  const text = fs.readFileSync(publicKpiPath, "utf8");
  for (const token of FORBIDDEN_PUBLIC_TOKENS) {
    push(errors, !text.includes(token), `public KPI contains forbidden token ${token}`);
  }
}

// ── v1 gate (unchanged behavior; committed data stays green) ─────────────────

function validateV1({ rootDoc, publicDoc, publicKpiPath }) {
  const errors = [];
  validateCoreShape(rootDoc, errors, SCHEMA_VERSION_V1);
  validateCoreShape(publicDoc, errors, SCHEMA_VERSION_V1);
  scanForbiddenTokens(publicKpiPath, errors);
  push(errors, JSON.stringify(rootDoc) === JSON.stringify(publicDoc), "public KPI mirror must match root KPI");
  return { errors, warnings: [], report: { schema: SCHEMA_VERSION_V1 } };
}

// ── v2 runtime self-proof ────────────────────────────────────────────────────

// The canonical definitional subset of cadence (v2_activated_at is per-build state).
function canonicalCadenceSubset() {
  return {
    crons_utc: CADENCE.crons_utc,
    slot_grace_minutes: CADENCE.slot_grace_minutes,
    hard_max_age_hours: CADENCE.hard_max_age_hours,
    slot_retention_days: CADENCE.slot_retention_days,
    calendar_version,
  };
}

export function checkV2Runtime(rootDoc, { errors, warnings }, nowIso, { context = "deploy" } = {}) {
  const runtime = rootDoc?.runtime;
  push(errors, runtime && typeof runtime === "object", "runtime block is required in v2");
  if (!runtime || typeof runtime !== "object") return;
  push(errors, context === "deploy" || context === "reconcile",
    `checker context must be deploy or reconcile, got ${JSON.stringify(context)}`);

  const producer = runtime.producer_context;
  const strictBucket = STRICT ? errors : warnings;
  push(strictBucket, producer != null, "producer_context is null (no authoritative scheduled run yet)");

  // DEFINITION tamper: cadence definitional fields must deep-equal canonical.
  // Always a hard error (never warn-only) — the artifact cannot redefine thresholds.
  const cad = runtime.cadence || {};
  const cadSubset = {
    crons_utc: cad.crons_utc,
    slot_grace_minutes: cad.slot_grace_minutes,
    hard_max_age_hours: cad.hard_max_age_hours,
    slot_retention_days: cad.slot_retention_days,
    calendar_version: cad.calendar_version,
  };
  push(errors, JSON.stringify(cadSubset) === JSON.stringify(canonicalCadenceSubset()),
    `cadence definitional fields do not match canonical: ${JSON.stringify(cadSubset)}`);

  // producer_context shape (when non-null): parseable built_at + identity fields.
  // A built_at in the FUTURE vs the checker clock (beyond the skew band) is invalid
  // and rejected outright — always a hard error, not just missing/unparseable.
  if (producer) {
    const builtMs = new Date(producer.built_at).getTime();
    push(errors, Number.isFinite(builtMs),
      `producer_context.built_at is not a parseable timestamp: ${producer.built_at}`);
    if (Number.isFinite(builtMs)) {
      const futureByMs = builtMs - new Date(nowIso).getTime();
      push(errors, futureByMs <= FRESHNESS_TOLERANCE_MINUTES * 60000,
        `producer_context.built_at is in the future vs checker clock: ${producer.built_at} > ${nowIso}`);
    }
    for (const field of ["run_id", "workflow", "event_name"]) {
      push(errors, producer[field] != null && producer[field] !== "",
        `producer_context.${field} is required when producer is present`);
    }
  }

  // Missed-slot re-derivation must match what the builder stored, at the build clock,
  // using CANONICAL tracked crons + retention (never the artifact's).
  const buildNow = rootDoc.generated_at;
  const watermark = runtime.cadence?.v2_activated_at;
  push(errors, typeof watermark === "string" && Number.isFinite(new Date(watermark).getTime()),
    "cadence.v2_activated_at must be a parseable timestamp");
  if (typeof watermark === "string") {
    const due = enumerateDueSlots({
      trackedCrons: TRACKED_CRONS,
      watermarkIso: watermark,
      nowIso: buildNow,
      retentionDays: CADENCE.slot_retention_days,
      graceMinutes: CADENCE.slot_grace_minutes,
    });
    const satisfiedSlotKeys = runtime.slots?.satisfied_slot_keys ?? [];
    push(errors, Array.isArray(satisfiedSlotKeys),
      "runtime.slots.satisfied_slot_keys must be an array");
    const canonicalSatisfiedSlotKeys = Array.isArray(satisfiedSlotKeys) ? satisfiedSlotKeys : [];
    const buildNowMs = new Date(buildNow).getTime();
    canonicalSatisfiedSlotKeys.forEach((slotKey, index) => {
      const canonical = isCanonicalRuntimeSlotKey(slotKey);
      push(errors, canonical,
        `runtime.slots.satisfied_slot_keys[${index}] must be a canonical tracked cron occurrence: ${slotKey}`);
      if (canonical) {
        const occurrenceMs = parseRuntimeSlotKey(slotKey).occurrence_ms;
        push(errors, Number.isFinite(buildNowMs) && occurrenceMs <= buildNowMs,
          `runtime.slots.satisfied_slot_keys[${index}] is in the future vs generated_at: ${slotKey} > ${buildNow}`);
      }
    });
    const successfulSnapshotHistory = runtime.successful_snapshot_history ?? [];
    push(errors, Array.isArray(successfulSnapshotHistory),
      "runtime.successful_snapshot_history must be an array");
    (Array.isArray(successfulSnapshotHistory) ? successfulSnapshotHistory : []).forEach((entry, index) => {
      if (entry?.slot_key == null) return;
      const canonical = isCanonicalRuntimeSlotKey(entry.slot_key);
      push(errors, canonical,
        `runtime.successful_snapshot_history[${index}].slot_key must be a canonical tracked cron occurrence: ${entry.slot_key}`);
      const builtAtMs = new Date(entry?.built_at).getTime();
      push(errors, Number.isFinite(builtAtMs),
        `runtime.successful_snapshot_history[${index}].built_at must be a parseable timestamp: ${entry?.built_at}`);
      if (canonical && Number.isFinite(builtAtMs)) {
        const occurrenceMs = parseRuntimeSlotKey(entry.slot_key).occurrence_ms;
        push(errors, occurrenceMs <= builtAtMs,
          `runtime.successful_snapshot_history[${index}].built_at precedes its slot occurrence: ${entry.built_at} < ${entry.slot_key}`);
        push(errors, Number.isFinite(buildNowMs) && builtAtMs <= buildNowMs,
          `runtime.successful_snapshot_history[${index}].built_at is in the future vs generated_at: ${entry.built_at} > ${buildNow}`);
      }
    });
    const cronDeferrals = runtime.slots?.cron_deferrals ?? [];
    const deferralErrors = validateCronDeferrals(cronDeferrals, { satisfiedSlotKeys: canonicalSatisfiedSlotKeys });
    for (const error of deferralErrors) errors.push(`invalid cron deferral: ${error}`);
    if (deferralErrors.length === 0) {
      const missed = deriveMissedSlots({ dueSlots: due, satisfiedSlotKeys: canonicalSatisfiedSlotKeys, cronDeferrals });
      const stored = [...(runtime.slots?.missed_slot_keys ?? [])].sort();
      push(errors, JSON.stringify(missed) === JSON.stringify(stored),
        `missed_slot_keys re-derivation mismatch: stored ${JSON.stringify(stored)} vs recomputed ${JSON.stringify(missed)}`);
    }
  }

  const slotClassification = classifyRuntimeSlots(runtime);
  const expectedPublicationGate = publicationGateForRuntime(runtime);
  push(errors, JSON.stringify(runtime.publication_gate) === JSON.stringify(expectedPublicationGate),
    `runtime.publication_gate mismatch: stored ${JSON.stringify(runtime.publication_gate)} vs recomputed ${JSON.stringify(expectedPublicationGate)}`);
  if (slotClassification.status === "blocked") {
    const blockingMessage = `${slotClassification.blocking_unrecovered_missed_slot_keys.length} retained missed slot(s) lack a later authoritative ready full-snapshot recovery: ${slotClassification.blocking_unrecovered_missed_slot_keys.join(", ")}`;
    if (context === "reconcile") {
      warnings.push(`Publication halted; deployment_blocking:true; ${blockingMessage}`);
    } else {
      errors.push(blockingMessage);
    }
  }
  if (slotClassification.lane_local_unrecovered_missed_slot_keys.length > 0) {
    warnings.push(`incremental/owner-gated missed slot(s) remain lane-local degraded; deployment_blocking:false: ${slotClassification.lane_local_unrecovered_missed_slot_keys.join(", ")}`);
  }
  if (slotClassification.recovered_missed_slot_keys.length > 0) {
    warnings.push(`${slotClassification.recovered_missed_slot_keys.length} retained missed slot(s) recovered by later authoritative ready full snapshot(s)`);
  }

  // Producer freshness judged against the CHECKER'S CURRENT clock (not the doc's
  // generated_at) and the CANONICAL ceiling (not the artifact's), with a 10-minute
  // tolerance band absorbing projector-vs-checker clock skew. Frozen-green docs
  // (built_at stale but never rebuilt) trip this.
  if (producer && Number.isFinite(new Date(producer.built_at).getTime())) {
    const age = ageHoursBetween(producer.built_at, nowIso);
    const ceilingWithBand = CADENCE.hard_max_age_hours + FRESHNESS_TOLERANCE_MINUTES / 60;
    if (age != null && age > ceilingWithBand) {
      strictBucket.push(`producer_context.built_at over hard ceiling vs checker clock: ${age.toFixed(2)}h > ${CADENCE.hard_max_age_hours}h (+${FRESHNESS_TOLERANCE_MINUTES}m band)`);
    }
  }
}

export function checkSourceSla(rootDoc, { errors, warnings }, nowIso) {
  // No real-clock fallback: staleness must be judged against the caller's injected clock
  // (KPI_FAKE_NOW in CI/tests, resolveNow() in prod). A missing clock is a caller bug, not
  // a silent Date.now() — fail-closed so the trap class this contract kills cannot regrow.
  if (typeof nowIso !== "string" || nowIso.length < 10) {
    throw new Error("checkSourceSla requires an explicit nowIso clock (no real-clock fallback)");
  }
  const entries = Array.isArray(rootDoc?.source_sla) ? rootDoc.source_sla : null;
  push(errors, entries != null, "source_sla array is required in v2");
  if (!entries) return;
  // Fail-closed: an empty SLA set is not "all clear".
  push(warnings, entries.length > 0, "source_sla is empty (no source freshness evidence)");
  const buildNow = rootDoc.generated_at;
  const defById = new Map(SOURCE_SLA_DEF.map((d) => [d.source_id, d]));

  // DEFINITION tamper (always hard error, never warn-only): duplicate IDs, unknown/
  // extra IDs, or a present row whose definitional fields differ from canonical.
  // MISSING required IDs (incl. empty) is a fail-closed AVAILABILITY signal, not a
  // tamper -> warn Phase A / hard strict (below).
  const ids = entries.map((e) => e?.source_id);
  const uniqueIds = new Set(ids);
  push(errors, uniqueIds.size === ids.length, `source_sla has duplicate source_id(s): ${ids.join(", ")}`);
  for (const def of SOURCE_SLA_DEF) {
    if (def.required && !uniqueIds.has(def.source_id)) {
      warnings.push(`${def.source_id}: required source missing from source_sla`);
    }
  }

  for (const entry of entries) {
    const def = defById.get(entry.source_id);
    push(errors, Boolean(def), `source_sla unknown source_id ${entry.source_id}`);
    if (!def) continue;

    // Definitional deep-equality: freshness_basis/unit/calendar/max_staleness/required
    // must match canonical. Requiredness is read from the CANONICAL def, never the entry.
    const entryDef = Object.fromEntries(SLA_DEFINITIONAL_KEYS.map((k) => [k, entry[k]]));
    const canonDef = Object.fromEntries(SLA_DEFINITIONAL_KEYS.map((k) => [k, def[k]]));
    push(errors, JSON.stringify(entryDef) === JSON.stringify(canonDef),
      `${entry.source_id}: SLA definitional fields tampered — got ${JSON.stringify(entryDef)} vs canonical ${JSON.stringify(canonDef)}`);
    const required = def.required; // canonical

    // product_surface_coverage: shape-strict re-derivation from the emitted evidence
    // (required_surface_rows). Re-classify with the SHARED classifier and validate
    // (rev5.4). Shape errors / status mismatch = hard error always.
    if (entry.source_id === "product_surface_coverage") {
      const rows = entry.required_surface_rows;
      const hasLineage = Object.prototype.hasOwnProperty.call(entry, "required_surface_rows");
      push(errors, Array.isArray(rows), "product_surface_coverage: required_surface_rows evidence missing");
      // Re-derive the schema marker INDEPENDENTLY (own-property presence + exact value),
      // and re-classify with it. The exact-1 check lives in the shared classifier.
      const stampMarkerPresent = Object.prototype.hasOwnProperty.call(entry, "source_stamp_version");
      const cls = classifyProductSurface(Array.isArray(rows) ? rows : [], buildNow, { stampMarkerPresent, stampMarkerValue: entry.source_stamp_version });
      // Marker shape validated BEFORE any state early-exit (rev5.6): ever_stamped must
      // be boolean; pending_since must be string OR null on EVERY state (an object /
      // number pending_since on a future or stamped row is hard, not warn). A doc with
      // stamp-slice lineage but the pending marker DELETED must fail HERE too (rev5.6
      // addendum) — the checker never relies on the builder alone.
      const pending = entry.pending;
      push(errors, pending && typeof pending === "object" && typeof pending.ever_stamped === "boolean",
        `product_surface_coverage: pending.{pending_since,ever_stamped} marker missing/malformed${hasLineage ? " (lineage present, marker deleted)" : ""}`);
      push(errors, pending == null || pending.pending_since === null || typeof pending.pending_since === "string",
        `product_surface_coverage: pending.pending_since must be string or null, got ${JSON.stringify(pending?.pending_since)}`);
      const everStamped = pending?.ever_stamped === true;
      if (cls.kind === "shape_error") {
        for (const m of cls.shape_errors) errors.push(`product_surface_coverage shape error: ${m}`);
        continue;
      }
      const expectedStatus = {
        future: "future_date_anomaly",
        pending: "unavailable_pending_source_stamp",
        stamped: slaStatusForAge(evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso: buildNow }), def.max_staleness),
      }[cls.kind];
      push(errors, entry.status === expectedStatus,
        `product_surface_coverage status mismatch: stored ${entry.status} vs re-derived ${expectedStatus}`);

      if (cls.kind === "future") {
        push(errors, entry.future_date_anomaly === true, "product_surface_coverage future must flag future_date_anomaly");
        errors.push("product_surface_coverage: required source date in the future (anomaly)");
        continue;
      }
      if (cls.kind === "pending") {
        // ANTI-OSCILLATION (rev5.4): if product_surface has EVER been fully stamped,
        // any later regression to pending is a strict hard error immediately — no
        // fresh 14-day grace.
        if (everStamped) {
          warnings.push("product_surface_coverage: regressed to pending after having been fully stamped (ever_stamped) — lane degraded");
          continue;
        }
        // Bootstrap pending: pending_since must be a valid past-or-present ISO STRING
        // (numeric = hard; ANY future = hard with NO tolerance band — the skew band is
        // for producer age only, rev5.5), then age vs CHECKER clock + PENDING_MAX_AGE_DAYS.
        const ps = pending?.pending_since;
        if (typeof ps !== "string") { errors.push(`product_surface_coverage pending.pending_since must be a string, got ${JSON.stringify(ps)}`); continue; }
        const psMs = new Date(ps).getTime();
        if (!Number.isFinite(psMs)) { errors.push(`product_surface_coverage pending.pending_since unparseable: ${ps}`); continue; }
        if (psMs > new Date(nowIso).getTime()) {
          errors.push(`product_surface_coverage pending.pending_since is in the future (no tolerance): ${ps}`); continue;
        }
        const ageDays = (new Date(nowIso).getTime() - psMs) / 86400000;
        if (ageDays > PENDING_MAX_AGE_DAYS) {
          warnings.push(`product_surface_coverage pending exceeded ${PENDING_MAX_AGE_DAYS}d grace (${ageDays.toFixed(1)}d since ${ps}) — lane degraded`);
        } else {
          // within grace: warn-only even under --strict (the pending exemption is active).
          warnings.push(`product_surface_coverage pending within ${PENDING_MAX_AGE_DAYS}d grace (${ageDays.toFixed(1)}d)`);
        }
        continue;
      }
      // stamped: ever_stamped must be true (monotonic); pending_since must be null on a
      // stamped row (a non-null/future pending_since on a stamped row is corruption).
      push(errors, everStamped, "product_surface_coverage stamped entry must carry pending.ever_stamped=true");
      push(errors, pending?.pending_since === null,
        `product_surface_coverage stamped entry must have pending.pending_since=null, got ${JSON.stringify(pending?.pending_since)}`);
      push(errors, entry.source_date === cls.source_date,
        `product_surface_coverage source_date mismatch: ${entry.source_date} vs ${cls.source_date}`);
      const stampedAge = evaluateSlaAge({ sourceDate: cls.source_date, unit: def.unit, calendar: def.calendar, nowIso: buildNow });
      const parityPS = (stampedAge == null && entry.age == null)
        || (stampedAge != null && entry.age != null && Math.abs(stampedAge - entry.age) < 0.01);
      push(errors, parityPS, `product_surface_coverage age mismatch: ${entry.age} vs ${stampedAge}`);
      if (entry.status === "stale") warnings.push("product_surface_coverage: required source stale — lane degraded");
      continue;
    }

    // KILL THE GENERIC FLAG BYPASS (rev5.6): pending_source_stamp is honored ONLY in
    // the product_surface dedicated branch above. Its PRESENCE (by own-property, even
    // pending_source_stamp:false) on ANY other source row is a hard error.
    push(errors, !Object.prototype.hasOwnProperty.call(entry, "pending_source_stamp"),
      `${entry.source_id}: pending_source_stamp property is only valid on product_surface_coverage`);

    // Future-dated source: recompute the anomaly and require the honest status.
    const future = isFutureSource(entry.source_date, buildNow, def.unit);
    if (future || entry.future_date_anomaly) {
      push(errors, entry.status === "future_date_anomaly" && future,
        `${entry.source_id}: future-dated source must be flagged future_date_anomaly (never clamped to ready)`);
      if (required) errors.push(`${entry.source_id}: required source date ${entry.source_date} is in the future (anomaly)`);
      continue;
    }

    // Age math parity: recompute from the emitted source_date at the build clock,
    // using the CANONICAL unit/calendar/max_staleness (not the artifact's).
    const recomputedAge = evaluateSlaAge({
      sourceDate: entry.source_date,
      unit: def.unit,
      calendar: def.calendar,
      nowIso: buildNow,
    });
    const parity = (recomputedAge == null && entry.age == null)
      || (recomputedAge != null && entry.age != null && Math.abs(recomputedAge - entry.age) < 0.01);
    push(errors, parity, `${entry.source_id}: SLA age mismatch stored ${entry.age} vs recomputed ${recomputedAge}`);
    // Status must match recompute unless the basket gate override forced stale.
    // (pending_source_stamp is NOT honored here — rejected above for non-product_surface.)
    const recomputedStatus = slaStatusForAge(recomputedAge, def.max_staleness);
    if (!entry.gate_override_stale) {
      push(errors, entry.status === recomputedStatus,
        `${entry.source_id}: SLA status mismatch stored ${entry.status} vs recomputed ${recomputedStatus}`);
    }
    // Fail-closed: a canonical-required source that is stale OR unavailable/unknown is
    // a blocked signal (warn-only in Phase A, hard error under --strict).
    if (required && entry.status === "stale") {
      warnings.push(`${entry.source_id}: required source stale (age ${entry.age} ${def.unit} > ${def.max_staleness}) — lane degraded`);
    } else if (required && entry.status !== "ready") {
      warnings.push(`${entry.source_id}: required source not ready (status ${entry.status}) — lane degraded`);
    }
  }
}

function deepFindDenyKey(node, denySet, pathStr = "$") {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const hit = deepFindDenyKey(node[i], denySet, `${pathStr}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (node && typeof node === "object") {
    for (const key of Object.keys(node)) {
      if (denySet.has(key)) return `${pathStr}.${key}`;
      const hit = deepFindDenyKey(node[key], denySet, `${pathStr}.${key}`);
      if (hit) return hit;
    }
  }
  return null;
}

export function checkPublicProjection(rootDoc, publicDoc, { errors }) {
  const publicRuntime = publicDoc?.runtime;
  push(errors, publicRuntime && typeof publicRuntime === "object", "public runtime block is required in v2");
  if (!publicRuntime || typeof publicRuntime !== "object") return;

  // Redaction: no deny key may appear ANYWHERE in the public doc (recursive), not
  // just at runtime top-level — producer identity must not leak nested anywhere.
  const denyHit = deepFindDenyKey(publicDoc, new Set(PUBLIC_RUNTIME_DENY_KEYS));
  push(errors, denyHit == null, `public doc exposes forbidden runtime-identity key at ${denyHit}`);

  // Exact equality: projecting root at the PUBLIC's stored evaluated_at reproduces public.
  const storedEvaluatedAt = publicRuntime.evaluated_at;
  push(errors, typeof storedEvaluatedAt === "string", "public runtime.evaluated_at is required");
  if (typeof storedEvaluatedAt === "string") {
    const expected = projectPublicKpi(rootDoc, storedEvaluatedAt);
    push(errors, JSON.stringify(expected) === JSON.stringify(publicDoc),
      "public projection mismatch: projectPublicKpi(root, stored evaluated_at) != public mirror");
  }
}

// Separate current-clock freshness signals with a 10-minute tolerance band.
export function freshnessReport(rootDoc, nowIso) {
  const runtime = rootDoc?.runtime;
  if (!runtime || typeof runtime !== "object") return null;
  const current = projectRuntime(runtime, nowIso);
  const producerBuiltAt = runtime.producer_context?.built_at ?? null;
  const rebuildBuiltAt = runtime.last_rebuild_context?.built_at ?? null;
  return {
    producer_freshness: {
      built_at: producerBuiltAt,
      age_hours: producerBuiltAt ? ageHoursBetween(producerBuiltAt, nowIso) : null,
      fresh: current.fresh,
      hard_age_ok: current.hard_age_ok,
    },
    rebuild_freshness: {
      built_at: rebuildBuiltAt,
      age_hours: rebuildBuiltAt ? ageHoursBetween(rebuildBuiltAt, nowIso) : null,
    },
    tolerance_minutes: FRESHNESS_TOLERANCE_MINUTES,
  };
}

function validateV2({ rootDoc, publicDoc, rootKpiPath, publicKpiPath, nowIso, context }) {
  const errors = [];
  const warnings = [];
  validateCoreShape(rootDoc, errors, SCHEMA_VERSION_V2, warnings);
  // Public mirror keeps the same schema_version + lanes; only runtime is projected.
  validateCoreShape(publicDoc, errors, SCHEMA_VERSION_V2, warnings);
  scanForbiddenTokens(publicKpiPath, errors);
  checkV2Runtime(rootDoc, { errors, warnings }, nowIso, { context });
  checkSourceSla(rootDoc, { errors, warnings }, nowIso);
  checkRecoveryStateSources(rootDoc, rootKpiPath, errors);
  checkPublicProjection(rootDoc, publicDoc, { errors, warnings });
  const report = { schema: SCHEMA_VERSION_V2, freshness: freshnessReport(rootDoc, nowIso) };
  return { errors, warnings, report };
}

function main() {
  const { rootKpiPath, publicKpiPath } = resolvePaths();
  const nowIso = resolveNow();
  const rootDoc = readJson(rootKpiPath);
  const publicDoc = readJson(publicKpiPath);
  const context = getArg("--context") ?? "deploy";

  const version = rootDoc?.schema_version;
  const result = version === SCHEMA_VERSION_V2
    ? validateV2({ rootDoc, publicDoc, rootKpiPath, publicKpiPath, nowIso, context })
    : validateV1({ rootDoc, publicDoc, publicKpiPath });

  for (const warning of result.warnings) console.warn(`::warning:: fenok KPI [warn-only] ${warning}`);

  if (result.errors.length) {
    console.error("fenok data health KPI check failed");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    schema_version: rootDoc.schema_version,
    generated_at: rootDoc.generated_at,
    status: rootDoc.status,
    lanes: rootDoc.totals?.lanes ?? rootDoc.lanes.length,
    warnings: result.warnings.length,
    report: result.report,
  }, null, 2));
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) main();
