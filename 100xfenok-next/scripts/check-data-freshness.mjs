#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { businessDayAge } from "../../scripts/lib/market-calendar.mjs";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ROOT_COVERAGE_PATH = path.join(REPO_ROOT, "data", "admin", "product-surface-coverage.json");
const PUBLIC_COVERAGE_PATH = path.join(APP_ROOT, "public", "data", "admin", "product-surface-coverage.json");
const MARKET_FACTS_INDEX_PATH = path.join(REPO_ROOT, "data", "computed", "market_facts", "index.json");
const RIM_INPUTS_PATH = path.join(REPO_ROOT, "data", "computed", "rim-index", "inputs.json");
const YARDENI_MODEL_PATH = path.join(REPO_ROOT, "data", "yardney", "yardney_model.json");
const STOCKS_ANALYZER_PATH = path.join(REPO_ROOT, "data", "global-scouter", "core", "stocks_analyzer.json");
const ALLOWED_STATUSES = new Set(["ready", "partial", "pending", "stale", "unavailable", "error"]);
const STATUS_PRIORITY = ["error", "unavailable", "stale", "pending", "partial", "ready"];
const NO_AGGREGATE_SOURCE_DATE = "provider publishes no aggregate source date";
const SOURCE_FLOOR_UNAVAILABLE = "producer has not emitted a complete source-date floor";
const INTERNAL_ARTIFACT_CLOCK = "internal artifact uses generation time; no upstream source date";
const REQUIRED_NULL_SOURCE_REASONS = new Map([
  ["market_events", NO_AGGREGATE_SOURCE_DATE],
  ["etf_center", NO_AGGREGATE_SOURCE_DATE],
  ["admin_data_lab", INTERNAL_ARTIFACT_CLOCK],
]);

function readJsonState(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, payload: null, error: null };
  try {
    return { exists: true, payload: JSON.parse(fs.readFileSync(filePath, "utf8")), error: null };
  } catch (error) {
    return { exists: true, payload: null, error };
  }
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readProducedPair(label, rootPath, publicPath, errors, warnings) {
  const root = readJsonState(rootPath);
  const publicMirror = readJsonState(publicPath);
  if (!root.exists && !publicMirror.exists) {
    warnings.push(`${label}: root and public artifacts are both missing`);
    return null;
  }
  assert(root.exists === publicMirror.exists, `${label}: root/public mirror divergence (one artifact is missing)`, errors);
  if (root.error) errors.push(`${path.relative(REPO_ROOT, rootPath)} is malformed: ${root.error.message}`);
  if (publicMirror.error) errors.push(`${path.relative(REPO_ROOT, publicPath)} is malformed: ${publicMirror.error.message}`);
  if (root.payload !== null && publicMirror.payload !== null) {
    assert(isDeepStrictEqual(root.payload, publicMirror.payload), `${label}: root/public mirror divergence`, errors);
  }
  return root.payload !== null && publicMirror.payload !== null
    ? { root: root.payload, publicMirror: publicMirror.payload }
    : null;
}

function readOptionalProducer(label, filePath, errors, warnings) {
  const state = readJsonState(filePath);
  if (!state.exists) {
    warnings.push(`${label}: producer artifact is missing`);
    return null;
  }
  if (state.error) {
    errors.push(`${label}: producer artifact is malformed: ${state.error.message}`);
    return null;
  }
  if (!plainObject(state.payload)) {
    errors.push(`${label}: producer artifact must be a JSON object`);
    return null;
  }
  validateFiniteNumbers(state.payload, `${label} producer`, errors);
  return state.payload;
}

function isRealCalendarDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sourceDay(value) {
  if (!nonEmptyString(value)) return null;
  const day = value.slice(0, 10);
  if (!isRealCalendarDay(day)) return null;
  if (value.length === 10) return day;
  return Number.isFinite(new Date(value).getTime()) ? day : null;
}

function producerDay(payload, value, label, errors, warnings) {
  if (!payload) return null;
  if (value === null || value === undefined || value === "") {
    warnings.push(`${label}: producer source evidence is missing`);
    return null;
  }
  const day = isRealCalendarDay(value) ? value : null;
  if (!day) {
    errors.push(`${label}: producer source evidence must be a real, non-future source date`);
    return null;
  }
  return day;
}

function oldestCompleteSourceDay(values) {
  return values.length > 0 && values.every(Boolean) ? [...values].sort()[0] : null;
}

function buildProducerEvidence(errors, warnings) {
  const marketFacts = readOptionalProducer("market_facts", MARKET_FACTS_INDEX_PATH, errors, warnings);
  const rimInputs = readOptionalProducer("rim_inputs", RIM_INPUTS_PATH, errors, warnings);
  const yardeni = readOptionalProducer("yardeni", YARDENI_MODEL_PATH, errors, warnings);
  const stocksAnalyzer = readOptionalProducer("stocks_analyzer", STOCKS_ANALYZER_PATH, errors, warnings);

  const marketFactsDay = producerDay(
    marketFacts,
    marketFacts?.core_surface_source_as_of,
    "market_facts.core_surface_source_as_of",
    errors,
    warnings,
  );
  const rimKospiDay = producerDay(
    rimInputs,
    rimInputs?.indices?.KOSPI?.observed?.price?.as_of,
    "rim_inputs.KOSPI.observed.price.as_of",
    errors,
    warnings,
  );
  const rimSoxDay = producerDay(
    rimInputs,
    rimInputs?.indices?.SOX?.observed?.price?.as_of,
    "rim_inputs.SOX.observed.price.as_of",
    errors,
    warnings,
  );
  if (yardeni && yardeni.data !== undefined && !Array.isArray(yardeni.data)) {
    errors.push("yardeni.data must be an array when present");
  }
  const yardeniLatest = Array.isArray(yardeni?.data) ? yardeni.data.at(-1) : null;
  const yardeniDay = producerDay(
    yardeni,
    yardeniLatest?.date ?? yardeni?.meta?.last_update?.last_public_date,
    "yardeni latest public date",
    errors,
    warnings,
  );
  const screenerDay = producerDay(
    stocksAnalyzer,
    stocksAnalyzer?.source_date,
    "stocks_analyzer.source_date",
    errors,
    warnings,
  );
  const rimDay = oldestCompleteSourceDay([rimKospiDay, rimSoxDay]);

  return new Map([
    ["stock_detail", { expected: marketFactsDay, intentionalNull: false, verifiable: Boolean(marketFacts) }],
    ["market_valuation", {
      expected: oldestCompleteSourceDay([rimDay, yardeniDay, marketFactsDay]),
      intentionalNull: false,
      verifiable: Boolean(marketFacts && rimInputs && yardeni),
    }],
    ["market_events", { expected: null, intentionalNull: true }],
    ["sectors", { expected: marketFactsDay, intentionalNull: false, verifiable: Boolean(marketFacts) }],
    ["etf_center", { expected: null, intentionalNull: true }],
    ["screener", { expected: screenerDay, intentionalNull: false, verifiable: Boolean(stocksAnalyzer) }],
    ["admin_data_lab", { expected: null, intentionalNull: true }],
  ]);
}

function expectedSurfaceStatus(checks) {
  return STATUS_PRIORITY.find((status) => (Array.isArray(checks) ? checks : []).some((check) => check?.status === status)) || "ready";
}

function validateFiniteNumbers(value, context, errors) {
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${context} must be finite`, errors);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateFiniteNumbers(item, `${context}[${index}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateFiniteNumbers(item, `${context}.${key}`, errors);
  }
}

function expectedAgeDays(value, calendar, errors, context) {
  const parsed = new Date(value);
  const now = new Date();
  if (!Number.isFinite(parsed.getTime())) return null;
  assert(parsed.getTime() <= now.getTime(), `${context}: source date cannot be in the future`, errors);
  if (calendar !== null && calendar !== undefined) {
    assert(calendar === "us_market" || calendar === "krx_market", `${context}: unknown market calendar ${calendar}`, errors);
    if (calendar !== "us_market" && calendar !== "krx_market") return null;
    return businessDayAge(sourceDay(value), now.toISOString().slice(0, 10), calendar);
  }
  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000)));
}

function validateCoverage(payload, producerEvidence, errors, warnings) {
  assert(payload?.schema_version === "product-surface-coverage/v1", "schema_version must be product-surface-coverage/v1", errors);
  assert(payload?.source_stamp_version === 1, "source_stamp_version must be exactly numeric 1", errors);
  assert(nonEmptyString(payload?.generated_at) && Number.isFinite(new Date(payload.generated_at).getTime()), "generated_at must be a valid timestamp", errors);
  assert(Array.isArray(payload?.surfaces) && payload.surfaces.length > 0, "surfaces are required", errors);
  assert(payload?.raw_policy?.public_mirror_allowed === true, "raw_policy must allow the public mirror", errors);
  assert(payload?.raw_policy?.raw_rows_included === false, "raw_policy must forbid raw rows", errors);
  assert(payload?.raw_policy?.private_artifact_paths_included === false, "raw_policy must forbid private artifact paths", errors);
  validateFiniteNumbers(payload, "coverage", errors);

  const seenIds = new Set();
  const actualTotals = Object.fromEntries([...ALLOWED_STATUSES].map((status) => [status, 0]));
  const surfaces = Array.isArray(payload?.surfaces) ? payload.surfaces : [];

  for (const surface of surfaces) {
    const id = surface?.id || "(unknown)";
    const checks = Array.isArray(surface?.checks) ? surface.checks : [];
    assert(nonEmptyString(surface?.id), "every surface needs an id", errors);
    assert(!seenIds.has(id), `duplicate surface id: ${id}`, errors);
    seenIds.add(id);
    assert(ALLOWED_STATUSES.has(surface?.status), `${id}: unknown surface status ${surface?.status}`, errors);
    assert(surface?.status !== "error", `${id}: surface status error is deployment-blocking`, errors);
    if (ALLOWED_STATUSES.has(surface?.status)) actualTotals[surface.status] += 1;
    assert(Array.isArray(surface?.checks) && surface.checks.length > 0, `${id}: checks are required`, errors);
    assert(surface?.status === expectedSurfaceStatus(checks), `${id}: surface status must derive from its checks`, errors);
    assert(nonEmptyString(surface?.as_of) && Number.isFinite(new Date(surface.as_of).getTime()), `${id}: surface as_of must remain a valid collection/build timestamp`, errors);

    const sourceAsOf = surface?.source_as_of;
    const sourceReason = surface?.source_as_of_reason;
    const requiredNullReason = REQUIRED_NULL_SOURCE_REASONS.get(id);
    if (requiredNullReason) {
      assert(sourceAsOf === null, `${id}: aggregate/internal surface source_as_of must be null`, errors);
      assert(sourceReason === requiredNullReason, `${id}: source_as_of_reason must explain the honest null`, errors);
    } else if (sourceAsOf === null) {
      assert(nonEmptyString(sourceReason), `${id}: null source_as_of requires source_as_of_reason`, errors);
    } else {
      assert(sourceDay(sourceAsOf) !== null, `${id}: source_as_of must be a real source date`, errors);
      assert(sourceReason === null || sourceReason === undefined, `${id}: dated source_as_of must not carry a missing-date reason`, errors);
    }
    if (sourceAsOf === null && nonEmptyString(sourceReason)) {
      warnings.push(`${id}: source_as_of is unavailable (${sourceReason.trim()})`);
    }

    const evidence = producerEvidence.get(id);
    if (evidence?.intentionalNull) {
      assert(sourceAsOf === null, `${id}: source_as_of is unsupported by producer evidence`, errors);
    } else if (evidence) {
      const actualDay = sourceDay(sourceAsOf);
      if (!evidence.expected) {
        if (sourceAsOf !== null && evidence.verifiable) {
          errors.push(`${id}: source_as_of has no producer evidence`);
        } else if (sourceAsOf !== null) {
          warnings.push(`${id}: source_as_of cannot be verified because its producer artifact is missing`);
        }
      } else if (sourceAsOf === null) {
        warnings.push(`${id}: source_as_of is behind producer evidence ${evidence.expected}`);
      } else if (actualDay && actualDay > evidence.expected) {
        errors.push(`${id}: source_as_of ${actualDay} is newer than producer evidence ${evidence.expected}`);
      } else if (actualDay && actualDay < evidence.expected) {
        warnings.push(`${id}: source_as_of ${actualDay} is behind producer evidence ${evidence.expected}`);
      }
    }

    const freshnessChecks = checks.filter((check) => Object.prototype.hasOwnProperty.call(check || {}, "max_age_days"));
    assert(freshnessChecks.length > 0, `${id}: at least one freshness check is required`, errors);
    const coreSourceDays = [];

    for (const check of checks) {
      assert(ALLOWED_STATUSES.has(check?.status), `${id}/${check?.label || "(check)"}: unknown status ${check?.status}`, errors);
      assert(check?.status !== "error", `${id}/${check?.label || "(check)"}: error is deployment-blocking`, errors);
    }

    for (const check of freshnessChecks) {
      const label = check?.label || "(freshness check)";
      assert(Number.isFinite(check?.max_age_days) && check.max_age_days >= 0, `${id}/${label}: max_age_days must be a non-negative finite number`, errors);
      assert(ALLOWED_STATUSES.has(check?.status), `${id}/${label}: unknown status ${check?.status}`, errors);
      if (check?.as_of === null) {
        assert(check?.age_days === null, `${id}/${label}: missing source date requires age_days null`, errors);
        assert(nonEmptyString(check?.reason), `${id}/${label}: missing source date requires an explicit reason`, errors);
        assert(check?.status === "pending" || check?.status === "unavailable", `${id}/${label}: missing source date must be pending or unavailable`, errors);
        if (nonEmptyString(check?.reason)) warnings.push(`${id}/${label}: source date is missing (${check.reason.trim()})`);
      } else {
        const day = sourceDay(check?.as_of);
        assert(day !== null, `${id}/${label}: as_of must be a real source date`, errors);
        assert(Number.isFinite(check?.age_days) && check.age_days >= 0, `${id}/${label}: age_days must be a non-negative finite number`, errors);
        const expectedAge = day ? expectedAgeDays(check.as_of, check?.calendar, errors, `${id}/${label}`) : null;
        if (Number.isFinite(expectedAge)) {
          assert(check?.age_days === expectedAge, `${id}/${label}: age_days must be ${expectedAge} for source date ${day}`, errors);
        }
        if (Number.isFinite(expectedAge) && Number.isFinite(check?.max_age_days)) {
          const expectedStatus = expectedAge > check.max_age_days ? "stale" : "ready";
          assert(check?.status === expectedStatus, `${id}/${label}: status must be ${expectedStatus} for age ${expectedAge}/${check.max_age_days}`, errors);
        }
        if (day && check?.warn_only !== true) coreSourceDays.push(day);
      }
    }

    if (sourceDay(sourceAsOf) && coreSourceDays.length > 0) {
      const expectedFloor = [...coreSourceDays].sort()[0];
      assert(sourceDay(sourceAsOf) === expectedFloor, `${id}: source_as_of must equal the oldest required source check (${expectedFloor})`, errors);
    }
    if (sourceReason === NO_AGGREGATE_SOURCE_DATE) {
      assert(freshnessChecks.every((check) => check?.as_of === null), `${id}: no-aggregate-date reason cannot accompany a dated freshness check`, errors);
    }
    if (sourceReason === SOURCE_FLOOR_UNAVAILABLE) {
      assert(freshnessChecks.some((check) => check?.as_of === null && check?.warn_only !== true), `${id}: incomplete-floor reason requires a missing required source check`, errors);
    }
  }

  assert(Number.isInteger(payload?.totals?.surfaces) && payload.totals.surfaces === payload?.surfaces?.length, "totals.surfaces must match surface count", errors);
  for (const status of ALLOWED_STATUSES) {
    assert(Number.isInteger(payload?.totals?.[status]) && payload.totals[status] === actualTotals[status], `totals.${status} must match surface statuses`, errors);
  }
  assert(payload?.totals?.error === 0, "totals.error must be zero for deploy", errors);
}

const errors = [];
const warnings = [];
const coveragePair = readProducedPair(
  "product-surface coverage",
  ROOT_COVERAGE_PATH,
  PUBLIC_COVERAGE_PATH,
  errors,
  warnings,
);
const rootCoverage = coveragePair?.root ?? null;
const producerEvidence = buildProducerEvidence(errors, warnings);

if (rootCoverage) {
  validateCoverage(rootCoverage, producerEvidence, errors, warnings);
}

if (errors.length) {
  console.error("data freshness check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const degradedSurfaces = (rootCoverage?.surfaces || []).filter(
  (surface) => surface.status !== "ready" || surface.source_as_of === null,
);
for (const surface of (rootCoverage?.surfaces || []).filter((item) => item.status !== "ready")) {
  warnings.push(`product surface ${surface.id} is ${surface.status}: ${surface.summary}`);
}
for (const warning of [...new Set(warnings)]) console.warn(`::warning:: data freshness degraded: ${warning}`);

console.log(JSON.stringify({
  ok: true,
  status: warnings.length > 0 || degradedSurfaces.length > 0 ? "degraded" : "ready",
  warnings: [...new Set(warnings)],
  generated_at: rootCoverage?.generated_at ?? null,
  surfaces: rootCoverage?.surfaces?.length ?? 0,
  statuses: (rootCoverage?.surfaces || []).reduce((acc, surface) => {
    acc[surface.status] = (acc[surface.status] || 0) + 1;
    return acc;
  }, {}),
  degraded_surfaces: degradedSurfaces.map((surface) => ({
    id: surface.id,
    status: surface.status,
    source_as_of: surface.source_as_of,
    source_as_of_reason: surface.source_as_of_reason ?? null,
  })),
}, null, 2));
