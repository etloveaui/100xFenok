#!/usr/bin/env node
// Floor-free five-index canonical RIM builder.
//
// Authorities:
//   - Economics: data/computed/rim-index/feno-index-rim-five-canonical-
//     criteria.json (rules and gate limits only; no frozen result values).
//   - Math: canonicalGrid from scripts/build-rim-index-final.mjs, reused
//     ONLY as index-agnostic math (it takes every parameter explicitly and
//     never consults the frozen criteria). No other terminal implementation
//     is imported or reachable from this module.
//   - Operands: committed data/computed/rim-index/inputs.json (per-index
//     observed price, book value, forecast grid, payout, Rf, ERP) and the
//     per-index benchmark sections for the trailing-10y LTROE median
//     (deriveNormalizedLongTermRoe from scripts/build-rim-index.mjs).
//
// Hard rules:
//   - No published floor/headline evidence is read; no per-index target
//     constant; no order coefficient; no horizon conversion.
//   - Fail-closed rows: every required operand's availability date must be
//     <= the row price as-of (PIT), price freshness must be inside the
//     declared gate, operands must be direct exact-index inputs, the SOX
//     headline must be the Philadelphia Semiconductor index (never SOXX),
//     and a generic indices/sox.json path must carry explicit ^SOX identity,
//     and the pole/terminal/finite/monotonic gates must pass. Any failure
//     emits NULL with explicit blockers.
//   - CCMP (missing forecast/payout) and KOSPI (payout == 0 or unverified)
//     emit NULL, never value-plus-warning.
//   - The desired owner order is a boolean diagnostic only: rows are never
//     reordered, values never shifted, and a differing order never throws.
//   - Deterministic generated_at (options.generatedAt or the committed
//     inputs generated_at); the CLI writes the output path atomically.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { canonicalGrid } from "./build-rim-index-final.mjs";
import { deriveNormalizedLongTermRoe } from "./build-rim-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_REL = "data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json";
const CRITERIA_REL = "data/computed/rim-index/feno-index-rim-five-canonical-criteria.json";
const INPUTS_REL = "data/computed/rim-index/inputs.json";

export const FIVE_INDICES = Object.freeze(["SPX", "CCMP", "NDX", "SOX", "KOSPI"]);
export const EXACT_IDENTITIES = Object.freeze({
  SPX: Object.freeze({ id: "SPX", name: "S&P 500" }),
  CCMP: Object.freeze({ id: "CCMP", name: "Nasdaq Composite" }),
  NDX: Object.freeze({ id: "NDX", name: "Nasdaq-100" }),
  SOX: Object.freeze({ id: "SOX", name: "Philadelphia Semiconductor Index" }),
  KOSPI: Object.freeze({ id: "KOSPI", name: "KOSPI" }),
});

const BENCHMARKS = Object.freeze({
  SPX: Object.freeze({ file: "data/benchmarks/us.json", section: "sp500" }),
  NDX: Object.freeze({ file: "data/benchmarks/us.json", section: "nasdaq100" }),
  CCMP: Object.freeze({ file: "data/benchmarks/us.json", section: "nasdaq_composite" }),
  SOX: Object.freeze({ file: "data/benchmarks/micro_sectors.json", section: "philadelphia_semi" }),
  KOSPI: Object.freeze({ file: "data/benchmarks/emerging.json", section: "kospi" }),
});

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LOWER_HEX_64 = /^[a-f0-9]{64}$/;
const KOSPI_DART_POINTER_PATH = "computed/fenok-rim/kospi-dart-payout/current.json";
const KOSPI_DART_ARTIFACT_PATH = /^data\/computed\/fenok-rim\/kospi-dart-payout\/fy(\d{4})\.json$/;
const METHODOLOGY_WEIGHT_TIER = "methodology_derived_index_weight_source";
const ECONOMIC_DATE_KEYS = new Set([
  "as_of",
  "date",
  "availability_date",
  "availability_as_of",
  "benchmark_as_of",
  "coverage_date",
  "coverage_as_of",
  "effective_date",
  "erp_as_of",
  "forecast_as_of",
  "index_as_of",
  "observation_date",
  "observation_as_of",
  "payout_as_of",
  "period_date",
  "price_as_of",
  "rf_as_of",
  "source_date",
  "source_as_of",
  "stock_action_source_date",
  "sox_constituents_as_of",
  "krx_weight_as_of",
]);

function isValidEconomicDate(value) {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.toISOString().slice(0, 10) === value;
}

function readJson(root, rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

function finite(value) {
  return Number.isFinite(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function exactPriceIdentityBlocker(idx, price) {
  const identity = price?.identity;
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    return `${idx}: observed price exact identity metadata is missing`;
  }
  if (idx === "KOSPI") {
    return identity.market === "KOSPI"
      && identity.index_class === "KOSPI"
      && identity.index_name === "코스피"
      ? null
      : `${idx}: observed price identity must be exact KOSPI/KOSPI/코스피`;
  }
  const expectedSymbols = { SPX: "^GSPC", CCMP: "^IXIC", NDX: "^NDX", SOX: "^SOX" };
  return identity.provider_symbol === expectedSymbols[idx] && identity.canonical_index === idx
    ? null
    : `${idx}: observed price identity must be ${expectedSymbols[idx]} -> ${idx}`;
}

function attachKospiDirectProvenance(row, payoutObj, priceAsOf) {
  const coverage = payoutObj?.coverage;
  const clocks = coverage?.source_clocks;
  const artifactMatch = typeof coverage?.selected_artifact === "string"
    ? coverage.selected_artifact.match(KOSPI_DART_ARTIFACT_PATH)
    : null;
  const fields = {
    source_tier: payoutObj?.direct_source_tier,
    pointer_path: coverage?.pointer_path,
    selected_artifact: coverage?.selected_artifact,
    selected_artifact_sha256: coverage?.pointer_sha256,
    selected_fy: coverage?.selected_fy,
    first_knowable_at: coverage?.first_knowable_at,
    availability_as_of: coverage?.availability_as_of,
    payout_ratio: payoutObj?.value,
    covered_weight_ratio: coverage?.covered_weight_ratio,
    source_clocks: clocks,
  };
  const firstKnowableDate = typeof fields.first_knowable_at === "string"
    && Number.isFinite(Date.parse(fields.first_knowable_at))
    && /Z$/.test(fields.first_knowable_at)
    ? fields.first_knowable_at.slice(0, 10)
    : null;
  const clockKeys = [
    "pointer_first_knowable_at",
    "bridge_as_of",
    "benchmark_as_of",
    "availability_as_of",
    "all_used_inputs_at_or_before",
  ];
  const valid = fields.source_tier === "direct_official_derived"
    && fields.pointer_path === KOSPI_DART_POINTER_PATH
    && artifactMatch !== null
    && LOWER_HEX_64.test(fields.selected_artifact_sha256 ?? "")
    && Number(fields.selected_fy) === Number(artifactMatch?.[1])
    && firstKnowableDate !== null
    && isValidEconomicDate(fields.availability_as_of)
    && fields.availability_as_of <= priceAsOf
    && firstKnowableDate <= fields.availability_as_of
    && finite(fields.payout_ratio)
    && finite(fields.covered_weight_ratio)
    && fields.covered_weight_ratio >= 0.75
    && clocks && typeof clocks === "object" && !Array.isArray(clocks)
    && clockKeys.every((key) => isValidEconomicDate(clocks[key]) && clocks[key] <= priceAsOf)
    && clocks.pointer_first_knowable_at === firstKnowableDate
    && clocks.availability_as_of === fields.availability_as_of
    && clocks.all_used_inputs_at_or_before === fields.availability_as_of;
  if (!valid) {
    row.blockers.direct_input.push("KOSPI: verified OpenDART pointer/hash/provenance contract missing or invalid");
    return;
  }
  row.direct_provenance = cloneJson(fields);
}

function validateCcmpDirectForecastProof(row, forecast, priceAsOf) {
  const coverage = forecast?.coverage;
  const diagnostics = coverage?.index_diagnostics;
  const expectedFields = ["best_eps", "best_eps_fy2", "best_eps_fy3", "best_eps_asof"];
  const expectedSourceFields = ["best_eps", "best_eps_fy2", "best_eps_fy3"];
  const periods = forecast?.periods;
  const valid = forecast?.source_tier === "direct_index_source"
    && coverage?.source === BENCHMARKS.CCMP.file
    && coverage?.source_tier === "direct_index_source"
    && coverage?.availability_status === "available"
    && isValidEconomicDate(coverage?.benchmark_as_of)
    && isValidEconomicDate(coverage?.best_eps_asof)
    && coverage.best_eps_asof <= coverage.benchmark_as_of
    && coverage.best_eps_asof <= priceAsOf
    && JSON.stringify(coverage?.direct_fields) === JSON.stringify(expectedFields)
    && diagnostics?.index_id === "CCMP"
    && diagnostics?.index_key === "nasdaq_composite_direct_snapshot"
    && diagnostics?.source_tier === "observed_source"
    && diagnostics?.source === BENCHMARKS.CCMP.file
    && diagnostics?.benchmark_as_of === coverage.benchmark_as_of
    && diagnostics?.best_eps_asof === coverage.best_eps_asof
    && JSON.stringify(diagnostics?.direct_fields) === JSON.stringify(expectedFields)
    && Array.isArray(periods)
    && periods.length >= 3
    && periods.slice(0, 3).every((period, index) => (
      period?.period === ["fy1", "fy2", "fy3"][index]
      && period?.earnings_proxy?.source_tier === "observed_source"
      && period?.earnings_proxy?.source === BENCHMARKS.CCMP.file
      && period?.earnings_proxy?.source_field === `sections.nasdaq_composite.data[-1].${expectedSourceFields[index]}`
      && period?.earnings_proxy?.availability_as_of === coverage.best_eps_asof
      && period?.earnings_proxy?.as_of === coverage.best_eps_asof
    ));
  if (!valid) {
    row.blockers.direct_input.push(
      "CCMP: direct FY1/FY2/FY3 EPS and best_eps_asof provenance proof is missing or invalid",
    );
  }
}

// Economic observation/availability date keys, whitelisted. Only these key
// patterns count as an operand's economic clock; processing timestamps such
// as generated_at_date / *_generated_at / *_collected_at / *_fetched_at are
// explicitly excluded and never treated as an economic observation date.
function isEconomicDateKey(key) {
  if (!key || typeof key !== "string") return false;
  if (/generated|collected|fetched|processed|created|written|_at$/i.test(key)) return false;
  return ECONOMIC_DATE_KEYS.has(key.toLowerCase());
}

// Latest declared economic observation/availability date inside an operand
// payload, using only whitelisted date keys. Processing timestamps such as
// generated_at_date are deliberately ignored; malformed economic keys are
// retained as invalid evidence so a fallback clock cannot hide them.
function inspectEconomicDates(value) {
  let latest = null;
  let sawEconomicDate = false;
  const invalid = [];

  const visit = (node) => {
    if (node == null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (isEconomicDateKey(key)) {
        sawEconomicDate = true;
        if (isValidEconomicDate(child)) {
          if (latest === null || child > latest) latest = child;
        } else {
          invalid.push(`${key}=${child ?? "(missing)"}`);
        }
      }
      visit(child);
    }
  };

  visit(value);
  return { latest, sawEconomicDate, invalid };
}

// Directness: every required operand must carry an allowed exact-index
// source_tier; missing, blocked, house-assumption, proxy or methodology tiers
// emit a direct-input blocker. Nothing here is per-index fitted: the allowed
// set comes from the criteria authority.
function requireDirectTier(row, label, operand, allowed, prohibited, exceptionTiers = []) {
  const tier = operand?.source_tier ?? null;
  const exceptionAllowed = exceptionTiers.includes(tier);
  if (!tier || (!allowed.includes(tier) && !exceptionAllowed) || (prohibited.includes(tier) && !exceptionAllowed)) {
    row.blockers.direct_input.push(
      `${row.asset}: ${label} source_tier ${tier ?? "(missing)"} is not an allowed direct exact-index tier`,
    );
  }
}

function soxIdentityEvidence(entry, price) {
  const source = typeof price?.source === "string" ? price.source : "";
  const sourceField = typeof price?.source_field === "string" ? price.source_field : "";
  const providerSymbols = [
    entry?.observed?.identity?.provider_symbol,
    price?.identity?.provider_symbol,
  ].filter((value) => value !== undefined);
  const hasExactProviderSymbol = providerSymbols.some((value) => value === "^SOX");
  const hasInvalidProviderSymbol = providerSymbols.some((value) => value !== "^SOX");
  const identityMetadataText = providerSymbols
    .map((value) => typeof value === "string" ? value : JSON.stringify(value))
    .join(" ");
  const identityText = `${source} ${sourceField} ${identityMetadataText}`;
  const isDirectIndexSymbol = /(^|[^A-Za-z0-9])(\^|%5e)SOX([^A-Za-z0-9]|$)/i.test(identityText);
  const isPhiladelphiaBenchmark = /philadelphia_semi/i.test(sourceField);
  const isEtfOrProxy = /SOXX|SOXQ|SOXL|SOXS|ETF|PROXY|MSCI/i.test(identityText);
  return {
    source,
    sourceField,
    providerSymbols,
    hasExactProviderSymbol,
    hasInvalidProviderSymbol,
    identityMetadataText,
    identityText,
    isDirectIndexSymbol,
    isPhiladelphiaBenchmark,
    isEtfOrProxy,
    direct: !hasInvalidProviderSymbol
      && !isEtfOrProxy
      && (hasExactProviderSymbol || isDirectIndexSymbol || isPhiladelphiaBenchmark),
  };
}

function collectProvenanceStrings(value) {
  const collected = [];
  const collectStrings = (node) => {
    if (typeof node === "string") {
      collected.push(node);
    } else if (Array.isArray(node)) {
      for (const item of node) collectStrings(item);
    } else if (node && typeof node === "object") {
      for (const child of Object.values(node)) collectStrings(child);
    }
  };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (/^(notes?|caveats?)$/i.test(key)) continue;
      if (/source|provider|ticker|instrument|symbol|index_(id|key)|endpoint/i.test(key)) {
        collectStrings(child);
      }
      visit(child);
    }
  };
  visit(value);
  return collected;
}

function hasFairValueField(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasFairValueField(item));
  for (const [key, child] of Object.entries(value)) {
    if (/^fair[_-]?value$|^fairValue$/i.test(key)) return true;
    if (hasFairValueField(child)) return true;
  }
  return false;
}

function evaluateSoxMethodologyContract({ idx, entry, price, payoutObj, forecast, criteria }) {
  const diagnostics = forecast?.coverage?.index_diagnostics ?? null;
  const statusText = typeof forecast?.public_status === "string" ? forecast.public_status : "";
  const methodologyTierSeen = [
    payoutObj?.source_tier,
    forecast?.source_tier,
    diagnostics?.source_tier,
    ...(forecast?.periods ?? []).map((period) => period?.earnings_proxy?.source_tier),
  ].includes(METHODOLOGY_WEIGHT_TIER);
  const methodologyMarked = /methodology/i.test(statusText);
  if (!methodologyTierSeen && !methodologyMarked) {
    return { applicable: false, admissible: false, blockers: [], exception_tier: null };
  }

  const blockers = [];
  const fail = (message) => blockers.push(message);
  if (idx !== "SOX") {
    fail("methodology-derived weight exception is SOX-only");
    return { applicable: true, admissible: false, blockers, exception_tier: null };
  }

  const policy = criteria.directness?.sox_methodology_exception;
  if (!policy || typeof policy !== "object") {
    fail("criteria directness.sox_methodology_exception missing");
    return { applicable: true, admissible: false, blockers, exception_tier: null };
  }

  const identityEvidence = soxIdentityEvidence(entry, price);
  if (!identityEvidence.direct) fail("target identity is not direct ^SOX/philadelphia_semi");
  const expectEqual = (label, actual, expected) => {
    if (actual !== expected) fail(`${label} ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  };

  expectEqual("criteria admissible source tier", policy.admissible_source_tier, METHODOLOGY_WEIGHT_TIER);
  expectEqual("criteria official-weight disclosure", policy.required_official_weight_columns_available, false);
  expectEqual("criteria cap violation count", policy.required_cap_violation_count, 0);
  expectEqual("criteria matched weight ratio", policy.required_matched_weight_ratio, 1);
  expectEqual("criteria public surface", policy.public_surface_status, "QUARANTINED");
  expectEqual("source_tier", diagnostics?.source_tier, policy.admissible_source_tier);
  expectEqual("index_key", diagnostics?.index_key, policy.required_index_key);
  expectEqual("index_id", diagnostics?.index_id, policy.required_index_id);
  expectEqual("constituent source", diagnostics?.source, policy.required_constituent_source);
  expectEqual("GIW source URL", diagnostics?.source_url, policy.required_giw_source_url);
  expectEqual("source field", diagnostics?.source_field, policy.required_source_field);
  expectEqual("access scope", diagnostics?.access_scope, policy.required_access_scope);
  expectEqual("denominator method", diagnostics?.denominator?.method, policy.required_denominator_method);
  if (!finite(diagnostics?.total_market_cap) || diagnostics.total_market_cap <= 0) {
    fail(`total_market_cap ${JSON.stringify(diagnostics?.total_market_cap)} missing/non-positive`);
  }
  expectEqual("methodology URL", diagnostics?.methodology?.source_url, policy.required_methodology_url);
  expectEqual("weighting scheme", diagnostics?.methodology?.weighting_scheme, policy.required_weighting_scheme);
  expectEqual("redistribution", diagnostics?.methodology?.redistribution, policy.required_redistribution);
  expectEqual("official_weight_columns_available", diagnostics?.official_weight_columns_available,
    policy.required_official_weight_columns_available);
  expectEqual("payout official_weight_columns_available", payoutObj?.coverage?.official_weight_columns_available,
    policy.required_official_weight_columns_available);
  expectEqual("payout constituent source", payoutObj?.coverage?.sox_constituent_source, policy.required_constituent_source);
  expectEqual("payout methodology URL", payoutObj?.coverage?.methodology_source, policy.required_methodology_url);
  expectEqual("constituent_rows", diagnostics?.constituent_rows, policy.required_constituent_rows);
  expectEqual("methodology_weight_rows", diagnostics?.methodology_weight_rows, policy.required_weight_rows);
  expectEqual("methodology_weight_total", diagnostics?.methodology_weight_total, policy.required_weight_total);
  expectEqual("cap_violation_count", diagnostics?.cap_violation_count, policy.required_cap_violation_count);
  expectEqual("matched_stock_action_rows", diagnostics?.matched_stock_action_rows, policy.required_constituent_rows);
  expectEqual("matched_weight_ratio", diagnostics?.matched_weight_ratio, policy.required_matched_weight_ratio);
  expectEqual("diagnostic public_status", diagnostics?.public_status, policy.required_diagnostic_public_status);

  const expectedCaps = policy.required_cap_schedule ?? {};
  const actualCaps = diagnostics?.methodology?.cap_schedule ?? {};
  for (const [key, expected] of Object.entries(expectedCaps)) {
    expectEqual(`cap_schedule.${key}`, actualCaps[key], expected);
  }

  const coverageFloor = policy.min_financial_coverage_ratio;
  const coverageMetrics = {
    payout_covered_weight_ratio: payoutObj?.coverage?.covered_weight_ratio,
    dividend_yield_weight_ratio: diagnostics?.dividend_yield_weight_ratio,
    forward_eps_fy1_fy3_weight_ratio: diagnostics?.forward_eps_fy1_fy3_weight_ratio,
  };
  if (!finite(coverageFloor) || coverageFloor < 0 || coverageFloor > 1) {
    fail("criteria financial coverage floor missing/invalid");
  } else {
    for (const [label, value] of Object.entries(coverageMetrics)) {
      if (!finite(value) || value < coverageFloor) fail(`${label} ${JSON.stringify(value)} below ${coverageFloor}`);
    }
    expectEqual("diagnostic minimum coverage", diagnostics?.min_public_card_weight_ratio, coverageFloor);
  }

  const freshness = diagnostics?.freshness;
  expectEqual("freshness status", freshness?.status, criteria.freshness?.required_price_status);
  expectEqual("freshness unit", freshness?.freshness_unit, policy.required_freshness_unit);
  expectEqual("freshness calendar", freshness?.freshness_calendar, policy.required_freshness_calendar);
  expectEqual("freshness max days", freshness?.max_input_freshness_days, policy.max_freshness_days);
  expectEqual("future_date_anomaly", freshness?.future_date_anomaly, false);
  if (!finite(freshness?.calendar_age_days)
    || freshness.calendar_age_days < 0
    || freshness.calendar_age_days > policy.max_freshness_days) {
    fail(`freshness calendar_age_days ${JSON.stringify(freshness?.calendar_age_days)} exceeds policy`);
  }
  if (!isValidEconomicDate(diagnostics?.as_of)) fail("methodology availability as_of missing/invalid");

  const requiredStatusMarkers = Array.isArray(policy.required_forecast_status_markers)
    ? policy.required_forecast_status_markers
    : [];
  const forbiddenStatusMarkers = Array.isArray(policy.forbidden_forecast_status_markers)
    ? policy.forbidden_forecast_status_markers
    : [];
  for (const marker of requiredStatusMarkers) {
    if (!statusText.toLowerCase().includes(String(marker).toLowerCase())) {
      fail(`forecast public_status missing marker ${marker}`);
    }
  }
  for (const marker of forbiddenStatusMarkers) {
    if (statusText.toLowerCase().includes(String(marker).toLowerCase())) {
      fail(`forecast public_status contains forbidden marker ${marker}`);
    }
  }
  expectEqual("public surface status", criteria.public_surface?.status, policy.public_surface_status);
  if (hasFairValueField(forecast)) fail("forecast grid contains a fair-value output field");

  const forbiddenTokens = Array.isArray(policy.forbidden_source_tokens)
    ? policy.forbidden_source_tokens
    : [];
  const sourceEvidence = collectProvenanceStrings({ price, payoutObj, forecast })
    .filter((value) => !/^(forecast_grid_v1|derived|observed)\./i.test(value));
  for (const token of forbiddenTokens) {
    const hit = sourceEvidence.find((value) => value.toLowerCase().includes(String(token).toLowerCase()));
    if (hit) fail(`forbidden source token ${token} in ${hit}`);
  }

  return {
    applicable: true,
    admissible: blockers.length === 0,
    blockers,
    exception_tier: policy.admissible_source_tier,
  };
}

function buildRow({ idx, root, inputs, criteria, gMacro }) {
  const row = {
    asset: idx,
    identity: cloneJson(EXACT_IDENTITIES[idx]),
    market: idx === "KOSPI" ? "KR" : "US",
    status: "READY",
    as_of: null,
    spot: null,
    book_value: null,
    eps_path: null,
    payout: null,
    ke: null,
    g: null,
    ltroe: null,
    benchmark_as_of: null,
    fair_value: null,
    fair_value_as_of: null,
    fair_value_upside: null,
    direct_provenance: null,
    blockers: { direct_input: [], freshness: [], identity: [] },
    gates: null,
    source_clock: {
      price_as_of: null,
      benchmark_as_of: null,
      payout_availability: null,
      forecast_availability: null,
      rf_as_of: null,
      erp_as_of: null,
    },
  };
  const direct = row.blockers.direct_input;
  const freshness = row.blockers.freshness;
  const identity = row.blockers.identity;

  if (criteria.identity?.[idx] !== EXACT_IDENTITIES[idx].name) {
    identity.push(`${idx}: criteria identity must be exactly ${EXACT_IDENTITIES[idx].name}`);
  }

  const entry = inputs.indices?.[idx];
  if (!entry) {
    direct.push(`${idx}: inputs.json has no indices.${idx}`);
    row.status = "NULL";
    return row;
  }

  const price = entry.observed?.price ?? {};
  const priceAsOf = price.as_of ?? null;
  row.as_of = priceAsOf;
  row.spot = price.value ?? null;
  row.source_clock.price_as_of = priceAsOf;
  const priceIdentityBlocker = exactPriceIdentityBlocker(idx, price);
  if (priceIdentityBlocker) identity.push(priceIdentityBlocker);
  if (!isValidEconomicDate(priceAsOf)) {
    direct.push(`${idx}: observed price as_of missing/invalid (${priceAsOf})`);
    freshness.push(`${idx}: price availability/as_of missing/invalid (${priceAsOf})`);
  }
  if (!finite(row.spot) || row.spot <= 0) direct.push(`${idx}: observed price missing/non-positive`);

  // Price freshness gate (criteria rule + limit). Missing, malformed or
  // future-anomalous freshness metadata fails closed: no default is assumed.
  const priceFreshness = price.freshness ?? null;
  const requiredStatus = criteria.freshness?.required_price_status ?? null;
  const maxAge = criteria.freshness?.max_input_freshness_days ?? null;
  if (!finite(maxAge) || maxAge < 0) {
    freshness.push(`${idx}: criteria price freshness max_input_freshness_days missing/invalid`);
  }
  if (!priceFreshness || typeof priceFreshness !== "object" || Array.isArray(priceFreshness)) {
    freshness.push(`${idx}: price freshness metadata missing`);
  } else {
    if (typeof requiredStatus !== "string" || requiredStatus.length === 0) {
      freshness.push(`${idx}: criteria required_price_status missing/invalid`);
    } else if (priceFreshness.status !== requiredStatus) {
      freshness.push(`${idx}: price freshness status ${priceFreshness.status} != required ${requiredStatus}`);
    }
    if (!finite(priceFreshness.calendar_age_days) || priceFreshness.calendar_age_days < 0) {
      freshness.push(`${idx}: price freshness calendar_age_days missing/invalid`);
    }
    if (typeof priceFreshness.freshness_unit !== "string" || priceFreshness.freshness_unit.length === 0) {
      freshness.push(`${idx}: price freshness freshness_unit missing/invalid`);
    }
    if (typeof priceFreshness.freshness_calendar !== "string" || priceFreshness.freshness_calendar.length === 0) {
      freshness.push(`${idx}: price freshness freshness_calendar missing/invalid`);
    }
    if (!finite(priceFreshness.max_input_freshness_days) || priceFreshness.max_input_freshness_days < 0) {
      freshness.push(`${idx}: price freshness max_input_freshness_days missing/invalid`);
    }
    if (finite(priceFreshness.calendar_age_days)
      && finite(maxAge)
      && priceFreshness.calendar_age_days > maxAge) {
      freshness.push(`${idx}: price calendar age ${priceFreshness.calendar_age_days}d > max ${maxAge}d`);
    }
    if (finite(priceFreshness.calendar_age_days)
      && finite(priceFreshness.max_input_freshness_days)
      && priceFreshness.calendar_age_days > priceFreshness.max_input_freshness_days) {
      freshness.push(
        `${idx}: price calendar age ${priceFreshness.calendar_age_days}d > declared max ${priceFreshness.max_input_freshness_days}d`,
      );
    }
    if (typeof priceFreshness.future_date_anomaly !== "boolean") {
      freshness.push(`${idx}: price freshness future_date_anomaly missing/invalid`);
    } else if (priceFreshness.future_date_anomaly) {
      freshness.push(`${idx}: price freshness reports a future-date anomaly`);
    }
  }

  // Operands: book value, payout, forecast eps path, per-index Rf/ERP.
  const priceToBook = entry.observed?.price_to_book ?? null;
  const forwardEps = entry.observed?.forward_eps ?? null;
  const bookOperand = entry.derived?.book_value ?? null;
  const payoutObj = entry.derived?.payout_ratio ?? null;
  const forecast = entry.derived?.forecast_grid_v1 ?? null;
  const rf = entry.observed?.risk_free_rate ?? null;
  const erp = entry.observed?.equity_risk_premium ?? null;
  const allowedTiers = Array.isArray(criteria.directness?.allowed_source_tiers)
    ? criteria.directness.allowed_source_tiers
    : [];
  const prohibitedTiers = Array.isArray(criteria.directness?.prohibited_source_tiers)
    ? criteria.directness.prohibited_source_tiers
    : [];
  const soxMethodology = evaluateSoxMethodologyContract({
    idx,
    entry,
    price,
    payoutObj,
    forecast,
    criteria,
  });
  if (soxMethodology.applicable && !soxMethodology.admissible) {
    for (const blocker of soxMethodology.blockers) {
      direct.push(`${idx}: SOX methodology exception — ${blocker}`);
    }
  }
  const soxMethodologyExceptionTiers = soxMethodology.admissible
    ? [soxMethodology.exception_tier]
    : [];

  // Directness is an operand-level gate. Every object that supplies a value
  // or a required source clock is checked, including dependencies of derived
  // book value and the forecast path.
  const requiredDirectOperands = [
    ["price", price],
    ["price_to_book", priceToBook],
    ["forward_eps", forwardEps],
    ["book_value", bookOperand],
    ["payout_ratio", payoutObj],
    ["risk_free_rate", rf],
    ["equity_risk_premium", erp],
  ];
  for (const [label, operand] of requiredDirectOperands) {
    const exceptionTiers = label === "payout_ratio" ? soxMethodologyExceptionTiers : [];
    requireDirectTier(row, label, operand, allowedTiers, prohibitedTiers, exceptionTiers);
  }
  requireDirectTier(
    row,
    "forecast_grid_v1 coverage.index_diagnostics",
    forecast?.coverage?.index_diagnostics,
    allowedTiers,
    prohibitedTiers,
    soxMethodologyExceptionTiers,
  );

  const book = entry.derived?.book_value?.value ?? null;
  row.book_value = book;
  if (!finite(book) || book <= 0) direct.push(`${idx}: book_value missing/non-positive`);

  const payout = payoutObj?.value ?? null;
  row.payout = payout;
  if (payout == null || !finite(payout)) {
    direct.push(`${idx}: payout_ratio missing/non-finite`);
  } else if (payout === 0) {
    direct.push(`${idx}: payout_ratio is exactly 0 — unverified by policy; NULL row required`);
  }
  if (idx === "KOSPI") attachKospiDirectProvenance(row, payoutObj, priceAsOf);

  const epsPath = forecast?.periods?.slice(0, 3).map((period) => period?.earnings_proxy?.value) ?? null;
  row.eps_path = epsPath;
  for (const [i, period] of (forecast?.periods ?? []).slice(0, 3).entries()) {
    requireDirectTier(
      row,
      `forecast_grid_v1 FY${i + 1} earnings_proxy`,
      period?.earnings_proxy,
      allowedTiers,
      prohibitedTiers,
      soxMethodologyExceptionTiers,
    );
  }
  if (!Array.isArray(epsPath) || epsPath.length < 3 || epsPath.slice(0, 3).some((value) => !finite(value))) {
    direct.push(`${idx}: forecast_grid_v1 FY1-3 earnings_proxy missing/non-finite`);
  } else {
    if (idx === "CCMP") validateCcmpDirectForecastProof(row, forecast, priceAsOf);
    const statusText = forecast.public_status ?? "";
    if (typeof forecast.public_status !== "string" || forecast.public_status.length === 0) {
      direct.push(`${idx}: forecast_grid_v1 public_status missing/invalid`);
    }
    const banned = Array.isArray(criteria.directness?.forecast_public_status_ban)
      ? criteria.directness.forecast_public_status_ban
      : [];
    const hits = banned.filter((marker) => statusText.toLowerCase().includes(marker));
    for (const hit of hits) {
      if (String(hit).toLowerCase() === "methodology" && soxMethodology.applicable) continue;
      direct.push(`${idx}: forecast grid public_status "${statusText}" is ${hit}-marked; not direct exact-index inputs`);
    }
  }

  const rfValue = rf?.value ?? null;
  const erpValue = erp?.value ?? null;
  if (!finite(rfValue)) direct.push(`${idx}: risk_free_rate missing/non-finite`);
  if (!finite(erpValue)) direct.push(`${idx}: equity_risk_premium missing/non-finite`);
  if (finite(rfValue) && finite(erpValue)) row.ke = rfValue + erpValue;
  row.source_clock.rf_as_of = rf?.as_of ?? null;
  row.source_clock.erp_as_of = erp?.as_of ?? null;

  // Point-in-time: every required operand availability date must be <= the
  // row valuation price as-of. Violations land in the freshness group.
  const payoutClock = inspectEconomicDates(payoutObj);
  const forecastClock = inspectEconomicDates(forecast);
  const payoutAvailability = payoutClock.latest;
  const forwardEpsAsOf = forwardEps?.as_of ?? null;
  const forecastCandidates = [forecastClock.latest, payoutAvailability, forwardEpsAsOf]
    .filter((date) => isValidEconomicDate(date))
    .sort();
  const forecastAvailability = forecastCandidates.at(-1) ?? null;
  row.source_clock.payout_availability = payoutAvailability;
  row.source_clock.forecast_availability = forecastAvailability;
  const pit = (label, date) => {
    if (!isValidEconomicDate(date)) {
      freshness.push(`${idx}: ${label} availability missing/invalid (${date ?? "(missing)"})`);
      return;
    }
    if (isValidEconomicDate(priceAsOf) && date > priceAsOf) {
      freshness.push(`${idx}: PIT — ${label} availability ${date} is after price as-of ${priceAsOf}`);
    }
  };
  if (payoutClock.invalid.length > 0) {
    freshness.push(`${idx}: payout availability metadata invalid (${payoutClock.invalid.join(", ")})`);
  }
  if (!payoutClock.sawEconomicDate || payoutAvailability === null) {
    freshness.push(`${idx}: payout availability metadata missing`);
  }
  if (forecastClock.invalid.length > 0) {
    freshness.push(`${idx}: forecast availability metadata invalid (${forecastClock.invalid.join(", ")})`);
  }
  if (forecastAvailability === null) {
    freshness.push(`${idx}: forecast availability metadata missing`);
  }
  // The forecast clock may use the source-anchored forward EPS date when the
  // grid itself has no economic date, but that source clock is still required.
  pit("forward EPS", forwardEpsAsOf);
  pit("book value", priceToBook?.as_of ?? null);
  if (payoutAvailability !== null) pit("payout", payoutAvailability);
  if (forecastAvailability !== null) pit("forecast", forecastAvailability);
  pit("risk-free rate", rf?.as_of ?? null);
  pit("equity risk premium", erp?.as_of ?? null);

  // Benchmark section -> trailing-10y LTROE median (direct continuously
  // refreshed field; never a frozen per-index constant).
  const benchSpec = BENCHMARKS[idx];
  let benchRows = null;
  let benchAsOf = null;
  try {
    const payload = readJson(root, benchSpec.file);
    benchRows = payload?.sections?.[benchSpec.section]?.data ?? null;
  } catch {
    benchRows = null;
  }
  if (!Array.isArray(benchRows) || benchRows.length === 0) {
    direct.push(`${idx}: benchmark section ${benchSpec.file}#${benchSpec.section} missing/empty`);
  } else {
    benchAsOf = benchRows[benchRows.length - 1]?.date ?? null;
    row.benchmark_as_of = benchAsOf;
    row.source_clock.benchmark_as_of = benchAsOf;
    pit("benchmark", benchAsOf);
    if (isValidEconomicDate(benchAsOf)) {
      const ltroeYears = criteria.ltroe?.years;
      if (!finite(ltroeYears) || ltroeYears <= 0) {
        direct.push(`${idx}: criteria ltroe.years missing/invalid`);
      } else {
        const ltroe = deriveNormalizedLongTermRoe(benchRows, benchAsOf, ltroeYears);
        if (!finite(ltroe.base)) {
          direct.push(`${idx}: trailing-10y LTROE non-finite (${ltroe.n_observations} observations)`);
        } else {
          row.ltroe = ltroe.base;
        }
      }
    }
  }

  // SOX identity: the headline price must come from an exact direct
  // Philadelphia Semiconductor Index source — either the philadelphia_semi
  // benchmark section or a direct ^SOX daily index observation. SOXX/ETF or
  // other proxy identities are identity failures.
  if (idx === "SOX") {
    const evidence = soxIdentityEvidence(entry, price);
    if (evidence.hasInvalidProviderSymbol) {
      identity.push(`${idx}: explicit provider identity ${evidence.identityMetadataText || "(missing)"} is not exactly ^SOX`);
    } else if (evidence.isEtfOrProxy) {
      identity.push(`${idx}: price source ${evidence.identityText.trim()} is an ETF/proxy identity, not the Philadelphia Semiconductor index`);
    } else if (!evidence.direct) {
      identity.push(`${idx}: price source ${evidence.identityText.trim()} does not reference the philadelphia_semi index benchmark, direct ^SOX observation, or exact provider identity`);
    }
  }

  if (direct.length > 0 || freshness.length > 0 || identity.length > 0) {
    row.status = "NULL";
    return row;
  }

  // Stable-growth macro policy: g_macro is a criteria policy parameter with no
  // fallback. A missing/non-finite policy value fails closed with an explicit
  // blocker; it is never silently defaulted.
  if (gMacro == null || !finite(gMacro)) {
    direct.push(`${idx}: stable_growth.g_macro_value missing/non-finite in criteria; no default is applied`);
    row.status = "NULL";
    return row;
  }

  // Gates: pole / terminal share / stable retention / finite / monotonic,
  // evaluated from the engine's own grid diagnostics with the criteria limits.
  const g = Math.min(gMacro, rfValue);
  row.g = g;
  const halfErpPp = criteria.grid?.erp_half_width_pp;
  const halfLtroePp = criteria.grid?.ltroe_half_width_pp;
  const gates = criteria.hard_gates;
  const poleLimit = gates?.G1_pole_margin?.limit;
  const terminalShareLimit = gates?.G2_terminal_share?.limit;
  if (![halfErpPp, halfLtroePp, poleLimit, terminalShareLimit].every(finite)
    || halfErpPp < 0
    || halfLtroePp < 0) {
    direct.push(`${idx}: criteria grid/gate limits missing/non-finite; no defaults are applied`);
    row.status = "NULL";
    return row;
  }
  const halfErp = halfErpPp / 100;
  const halfLtroe = halfLtroePp / 100;
  const grid = canonicalGrid({
    b0: row.book_value,
    epsPath: row.eps_path,
    payout: row.payout,
    rf: rfValue,
    erp: { low: erpValue - halfErp, base: erpValue, high: erpValue + halfErp },
    ltroeGrid: { low: Math.max(0, row.ltroe - halfLtroe), base: row.ltroe, high: row.ltroe + halfLtroe },
    g,
  });
  const checks = {
    pole_margin: grid.min_pole_margin !== null && grid.min_pole_margin >= poleLimit,
    terminal_share: grid.base_terminal_share !== null && grid.base_terminal_share <= terminalShareLimit,
    stable_retention: grid.stable_retention_range !== null
      && grid.stable_retention_range.min >= 0
      && grid.stable_retention_range.max <= 1,
    finite: grid.all_finite === true,
    monotonic: grid.monotonicity_passed === true,
  };
  row.gates = checks;
  const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
  if (failed.length > 0) {
    direct.push(`${idx}: gate failures ${failed.join(", ")}`);
    row.status = "NULL";
    return row;
  }

  row.fair_value = grid.BASE;
  row.fair_value_as_of = priceAsOf;
  row.fair_value_upside = grid.BASE / row.spot - 1;
  return row;
}

function violationsOf(rows) {
  const byAsset = new Map(rows.map((row) => [row.asset, row]));
  const violations = [];
  for (let i = 0; i < FIVE_INDICES.length - 1; i += 1) {
    const a = byAsset.get(FIVE_INDICES[i]);
    const b = byAsset.get(FIVE_INDICES[i + 1]);
    if (a && b && finite(a.fair_value_upside) && finite(b.fair_value_upside)
      && !(b.fair_value_upside > a.fair_value_upside)) {
      violations.push({ asset_a: a.asset, asset_b: b.asset, value_a: a.fair_value_upside, value_b: b.fair_value_upside });
    }
  }
  return violations;
}

// Desired owner order, boolean diagnostic only. Pure: never mutates its input
// and never throws; a differing order or a non-finite row reports false.
export function fiveIndexOrderDiagnostic(rows) {
  const byAsset = new Map(rows.map((row) => [row.asset, row]));
  for (let i = 0; i < FIVE_INDICES.length - 1; i += 1) {
    const a = byAsset.get(FIVE_INDICES[i]);
    const b = byAsset.get(FIVE_INDICES[i + 1]);
    if (!a || !b || !finite(a.fair_value_upside) || !finite(b.fair_value_upside)) return false;
    if (!(b.fair_value_upside > a.fair_value_upside)) return false;
  }
  return true;
}

export function buildFiveIndexCanonical(root = ROOT, options = {}) {
  const criteria = readJson(root, CRITERIA_REL);
  const inputs = readJson(root, INPUTS_REL);
  // No fallback: a missing policy parameter is a fail-closed row blocker.
  const gMacro = criteria.stable_growth?.g_macro_value;
  const rows = FIVE_INDICES.map((idx) => buildRow({ idx, root, inputs, criteria, gMacro }));
  return {
    schema_version: "feno_rim_five_canonical_current.v1",
    criteria: CRITERIA_REL,
    generated_at: options.generatedAt ?? inputs.generated_at,
    exact_yoo: false,
    yoo_status: "NOT_IDENTIFIED",
    public_surface: {
      status: "QUARANTINED",
      rule: criteria.public_surface?.rule ?? "quarantined from public promotion until separate owner approval",
    },
    primary_scalar: "fair_value_upside",
    horizon: "same_as_of",
    rows,
    order_diagnostic: {
      desired_order: FIVE_INDICES,
      desired_order_met: fiveIndexOrderDiagnostic(rows),
      violations: violationsOf(rows),
      non_finite_rows: rows.filter((row) => !finite(row.fair_value_upside)).map((row) => row.asset),
      values_shifted: false,
    },
    source_clocks: Object.fromEntries(rows.map((row) => [row.asset, row.source_clock])),
  };
}

function writeJsonAtomic(destination, payload) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(temporary, destination);
}

function main() {
  const payload = buildFiveIndexCanonical(ROOT);
  writeJsonAtomic(path.join(ROOT, OUT_REL), payload);
  process.stdout.write(`wrote ${OUT_REL}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
