#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { projectPublicKpi, projectRuntime } from "../../scripts/lib/kpi-runtime-projection.mjs";
import {
  classifyRuntimeSlots,
  validateCronDeferrals,
} from "../../scripts/lib/kpi-runtime-slots.mjs";
import { isFutureSource, calendar_version } from "../../scripts/lib/market-calendar.mjs";
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
} from "../../scripts/lib/kpi-contract-constants.mjs";
import {
  enumerateDueSlots,
  deriveMissedSlots,
  evaluateSlaAge,
  slaStatusForAge,
  classifyProductSurface,
} from "../../scripts/build-fenok-data-health-kpi.mjs";

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

const REQUIRED_LANES = new Set([
  "stock_s0_active_daily_gate",
  "stock_s1_candidate_gate",
  "etf_public_and_daily_gate",
  "rim_inputs",
  "product_surface_freshness",
  "finra_occ_plain_us_and_mapping_policy",
  "automation_contract",
  "public_mirror_safety",
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

function push(list, condition, message) {
  if (!condition) list.push(message);
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

export function checkV2Runtime(rootDoc, { errors, warnings }, nowIso) {
  const runtime = rootDoc?.runtime;
  push(errors, runtime && typeof runtime === "object", "runtime block is required in v2");
  if (!runtime || typeof runtime !== "object") return;

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
    const cronDeferrals = runtime.slots?.cron_deferrals ?? [];
    const deferralErrors = validateCronDeferrals(cronDeferrals, { satisfiedSlotKeys });
    for (const error of deferralErrors) errors.push(`invalid cron deferral: ${error}`);
    if (deferralErrors.length === 0) {
      const missed = deriveMissedSlots({ dueSlots: due, satisfiedSlotKeys, cronDeferrals });
      const stored = [...(runtime.slots?.missed_slot_keys ?? [])].sort();
      push(errors, JSON.stringify(missed) === JSON.stringify(stored),
        `missed_slot_keys re-derivation mismatch: stored ${JSON.stringify(stored)} vs recomputed ${JSON.stringify(missed)}`);
    }
  }

  const slotClassification = classifyRuntimeSlots(runtime);
  if (slotClassification.status === "blocked") {
    errors.push(`${slotClassification.unrecovered_missed_slot_keys.length} retained missed slot(s) lack a later authoritative ready full-snapshot recovery`);
  } else if (slotClassification.status === "degraded") {
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

function validateV2({ rootDoc, publicDoc, publicKpiPath, nowIso }) {
  const errors = [];
  const warnings = [];
  validateCoreShape(rootDoc, errors, SCHEMA_VERSION_V2, warnings);
  // Public mirror keeps the same schema_version + lanes; only runtime is projected.
  validateCoreShape(publicDoc, errors, SCHEMA_VERSION_V2, warnings);
  scanForbiddenTokens(publicKpiPath, errors);
  checkV2Runtime(rootDoc, { errors, warnings }, nowIso);
  checkSourceSla(rootDoc, { errors, warnings }, nowIso);
  checkPublicProjection(rootDoc, publicDoc, { errors, warnings });
  const report = { schema: SCHEMA_VERSION_V2, freshness: freshnessReport(rootDoc, nowIso) };
  return { errors, warnings, report };
}

function main() {
  const { rootKpiPath, publicKpiPath } = resolvePaths();
  const nowIso = resolveNow();
  const rootDoc = readJson(rootKpiPath);
  const publicDoc = readJson(publicKpiPath);

  const version = rootDoc?.schema_version;
  const result = version === SCHEMA_VERSION_V2
    ? validateV2({ rootDoc, publicDoc, publicKpiPath, nowIso })
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
