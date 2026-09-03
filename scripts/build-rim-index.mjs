#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  businessDayAge,
  isFutureSource,
  isRealCalendarDate,
} from "./lib/market-calendar.mjs";
import { SOURCE_SLA_DEF } from "./lib/kpi-contract-constants.mjs";
import { resolveDividendYieldFraction } from "./lib/dividend-yield-unit.mjs";
import {
  deriveTrailingIndexDividendYield,
  dividendYieldToPayout,
} from "./lib/index-dividend-yield.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const SCHEMA_VERSION = "rim_index_inputs.v2";
const OUTPUT_SCOPE = "inputs_and_assumption_labelled_range_no_single_target";

// --- RIM successor: an assumption-labelled valuation RANGE -------------------
// One index-level number would be a public single target, which policy forbids
// and which no set of inputs honestly supports. The published shape is a BAND
// between two named economic stories, computed from the SAME published
// operands; only the terminal treatment differs between the endpoints.
//
//   conservative  excess returns compete away -- residual income fades linearly
//                 to zero over FADE_YEARS, no perpetuity at all
//   optimistic    excess returns persist -- residual income grows forever at
//                 TERMINAL_GROWTH_OPTIMISTIC
//
// There is deliberately NO middle scenario. A base case is what every reader
// would quote, which reintroduces the single target through the back door.
const VALUATION_RANGE_SCHEMA = "rim_valuation_range_v1";
const VALUATION_RANGE_METHOD = "residual_income_three_period_plus_terminal_treatment_band";
const TERMINAL_GROWTH_CONSERVATIVE = 0;
const TERMINAL_GROWTH_OPTIMISTIC = 0.025;
const FADE_YEARS = 10;
const REQUIRED_RANGE_SCENARIOS = ["conservative", "optimistic"];
// The exact gate set. Pinned as a list so DELETING a gate is as loud as failing
// one -- an empty `gates` object used to validate cleanly.
const REQUIRED_RANGE_GATES = [
  "primary_index",
  "source_tier_satisfied",
  "blockers_empty",
  "operands_complete",
  "source_clock_honest",
  "payout_routes_reconciled",
  "model_sensitivity_bounded",
];
// TWO separate questions, deliberately not merged. Whether the two payout routes
// AGREE is a source-quality question and is judged on payout itself. How much
// the disagreement MOVES the model is a sensitivity question and is judged on
// retention. Reporting only the second let a 15.44% payout disagreement read as
// "reconciled" because its endpoint effect happened to be small.
const PAYOUT_ROUTE_DIVERGENCE_LIMIT = 0.05;
const PAYOUT_RETENTION_DIVERGENCE_LIMIT = 0.05;
const MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD = 0.06;
const MAX_UNRESOLVED_DIVIDEND_UNIT_SHARE = 0.25;
const CCMP_PRICE_RETURN_SERIES = "NASDAQCOM";
const CCMP_TOTAL_RETURN_SERIES = "NASDAQXCMP";
const CCMP_DIRECT_EPS_MIN_GROWTH = -0.9;
const CCMP_DIRECT_EPS_MAX_GROWTH = 2;
// Any of these appearing as a KEY at ANY depth is a single target trying to
// re-enter through a nested object.
const FORBIDDEN_TARGET_KEYS = [
  "point_target",
  "target",
  "target_price",
  "price_target",
  "fair_value",
  "fairValue",
  "intrinsic_value",
  "intrinsicValue",
  "single_target",
  "estimate",
  "valuation",
];

function findForbiddenTargetKeyPaths(node, trail = []) {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => findForbiddenTargetKeyPaths(item, [...trail, String(index)]));
  }
  if (!node || typeof node !== "object") return [];
  const found = [];
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN_TARGET_KEYS.includes(key)) found.push([...trail, key].join("."));
    found.push(...findForbiddenTargetKeyPaths(value, [...trail, key]));
  }
  return found;
}
const DEFAULT_OUTPUT = "computed/rim-index/inputs.json";
const DEFAULT_MIN_COVERED_WEIGHT = 0.75;
const KOSPI_EXACT_SPOT_FILE = "computed/fenok-edge-korea-krx-index-daily.json";
const KOSPI_EXACT_SPOT_SOURCE_FIELD = "indices[market=KOSPI,index_class=KOSPI,index_name=코스피].close";
const KOSPI_KRX_BRIDGE_FILE = "admin/fenok-edge-korea-krx-daily-index.json";
const KOSPI_KRX_WEIGHT_KEY = "kospi_krx_mktcap";
const KOSPI_DART_POINTER_FILE = "computed/fenok-rim/kospi-dart-payout/current.json";
const KOSPI_DART_POINTER_SCHEMA = "kospi_dart_payout_pointer.v1";
const KOSPI_DART_ARTIFACT_SCHEMA = "kospi_dart_payout.v1";
const KOSPI_DART_ARTIFACT_ROOT = "data/computed/fenok-rim/kospi-dart-payout";
const KOSPI_DART_SOURCE_TIER = "direct_official_derived";
const KOSPI_DART_PAYOUT_FORMULA = "kospi_dart_payout_artifact.payout_ratio";
const KOSPI_INPUT_FRESHNESS_MAX_DAYS = 2;
const SOX_GIW_CONSTITUENTS_FILE = "indices/nasdaq-giw-sox-constituents.json";
const SOX_DERIVED_WEIGHT_KEY = "sox_nasdaq_giw_methodology_mktcap";
const SOX_INPUT_FRESHNESS_MAX_DAYS = 7;
const ASSUMPTION_VERSION = "rim-assumptions-20260708";
const REVIEWED_AT = "2026-07-08";
const RIM_INPUT_SLA = SOURCE_SLA_DEF.find((row) => row.source_id === "rim_index_inputs");

if (!RIM_INPUT_SLA) {
  throw new Error("rim_index_inputs SLA definition is required");
}

class LaneUnavailableError extends Error {
  constructor(message, source = null) {
    super(message);
    this.name = "LaneUnavailableError";
    this.source = source;
  }
}

const PRIMARY_INDICES = [
  {
    id: "SPX",
    label: "S&P 500",
    benchmarkFile: "benchmarks/us.json",
    benchmarkSection: "sp500",
    spotFile: "indices/sp500.json",
    spotIdentity: Object.freeze({ provider_symbol: "^GSPC", canonical_index: "SPX" }),
    slickchartsIndex: "sp500",
    yieldFile: "slickcharts/sp500-yield.json",
  },
  {
    id: "NDX",
    label: "Nasdaq 100",
    benchmarkFile: "benchmarks/us.json",
    benchmarkSection: "nasdaq100",
    spotFile: "indices/nasdaq100.json",
    spotIdentity: Object.freeze({ provider_symbol: "^NDX", canonical_index: "NDX" }),
    slickchartsIndex: "nasdaq100",
    yieldFile: "slickcharts/nasdaq100-yield.json",
  },
];

const SECONDARY_INDICES = [
  {
    id: "CCMP",
    label: "Nasdaq Composite",
    role: "secondary_input_only",
    benchmarkFile: "benchmarks/us.json",
    benchmarkSection: "nasdaq_composite",
    spotFile: "indices/nasdaq.json",
    spotIdentity: Object.freeze({ provider_symbol: "^IXIC", canonical_index: "CCMP" }),
    blockers: [
      "missing_named_constituent_weight_path",
      "missing_named_index_yield_path",
      "payout_and_growth_not_public_card_ready",
    ],
  },
  {
    id: "KOSPI",
    label: "KOSPI",
    role: "backlog_blocked",
    benchmarkFile: "benchmarks/emerging.json",
    benchmarkSection: "kospi",
    spotFile: KOSPI_EXACT_SPOT_FILE,
    spotMarket: "krx_market",
    country: "Korea",
    blockers: [
      "country_risk_free_source_solved_not_wired",
      "missing_kospi_constituent_weight_path",
    ],
  },
  {
    id: "SOX",
    label: "PHLX Semiconductor / SOX",
    role: "secondary_input_only",
    benchmarkFile: "benchmarks/micro_sectors.json",
    benchmarkSection: "philadelphia_semi",
    spotFile: "indices/sox.json",
    spotIdentity: Object.freeze({ provider_symbol: "^SOX", canonical_index: "SOX" }),
    blockers: [
      "missing_sox_constituent_weight_path",
      "missing_sox_payout_coverage",
    ],
  },
];

const INDEX_CONFIG_BY_ID = new Map(
  [...PRIMARY_INDICES, ...SECONDARY_INDICES].map((indexConfig) => [indexConfig.id, indexConfig]),
);

const PROXY_CONSTITUENT_CANDIDATES = {
  CCMP: {
    proxyTicker: "ONEQ",
    source: "stockanalysis/etfs/ONEQ.json",
    exactIndexSubstitute: false,
    notes: [
      "Fidelity Nasdaq Composite ETF holdings are a proxy candidate only, not official Nasdaq Composite constituent weights.",
      "Top holding coverage is below the primary public-card threshold, so exact CCMP blockers remain.",
    ],
  },
  KOSPI: {
    proxyTicker: "EWY",
    source: "stockanalysis/etfs/EWY.json",
    exactIndexSubstitute: false,
    diagnosticStatus: "rejected_not_kospi_benchmark",
    notes: [
      "iShares MSCI South Korea ETF holdings are MSCI Korea ETF holdings, not KOSPI constituent weights.",
      "Do not use EWY for KOSPI RIM when KRX KOSPI market-cap source files are available.",
    ],
  },
  SOX: {
    proxyTicker: "SOXX",
    source: "stockanalysis/etfs/SOXX.json",
    exactIndexSubstitute: false,
    notes: [
      "iShares Semiconductor ETF holdings are a proxy candidate only, not literal PHLX Semiconductor Index weights.",
      "SOXX is diagnostics-only; SOX RIM inputs use Nasdaq GIW official constituents when available.",
    ],
  },
};

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value) {
  const num = Number(value);
  return finite(num) ? num : null;
}

function round(value, digits = 6) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readOptionalJson(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return readJson(absPath);
}

function readDataJson(relPath, root = dataRoot) {
  try {
    return readJson(path.join(root, relPath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new LaneUnavailableError(`${relPath}: source file is unavailable`, relPath);
    }
    throw error;
  }
}

function invalidKospiDartPayout(message, source = KOSPI_DART_POINTER_FILE) {
  throw new LaneUnavailableError(`KOSPI DART payout: ${message}`, source);
}

function perIssuerKeyPaths(node, trail = []) {
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => perIssuerKeyPaths(item, [...trail, String(index)]));
  }
  if (!node || typeof node !== "object") return [];
  const matches = [];
  for (const [key, value] of Object.entries(node)) {
    const next = [...trail, key];
    if (key === "per_issuer") matches.push(next.join("."));
    matches.push(...perIssuerKeyPaths(value, next));
  }
  return matches;
}

function loadKospiDartPayout(dataRootForReads, minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT) {
  const pointerAbs = path.join(dataRootForReads, KOSPI_DART_POINTER_FILE);
  let pointerBytes;
  try {
    pointerBytes = fs.readFileSync(pointerAbs);
  } catch (error) {
    invalidKospiDartPayout(
      error?.code === "ENOENT" ? "current pointer is unavailable" : "current pointer cannot be read",
    );
  }

  let pointer;
  try {
    pointer = JSON.parse(pointerBytes.toString("utf8"));
  } catch {
    invalidKospiDartPayout("current pointer is invalid JSON");
  }
  if (!pointer || typeof pointer !== "object" || Array.isArray(pointer)) {
    invalidKospiDartPayout("current pointer must be a JSON object");
  }
  if (pointer.schema_version !== KOSPI_DART_POINTER_SCHEMA) {
    invalidKospiDartPayout(`current pointer schema must be ${KOSPI_DART_POINTER_SCHEMA}`);
  }
  if (!Number.isInteger(pointer.fy) || pointer.fy < 2000) {
    invalidKospiDartPayout("current pointer FY is invalid");
  }
  if (typeof pointer.selected_artifact !== "string"
    || pointer.selected_artifact !== `${KOSPI_DART_ARTIFACT_ROOT}/fy${pointer.fy}.json`) {
    invalidKospiDartPayout(
      `current pointer selected_artifact must be ${KOSPI_DART_ARTIFACT_ROOT}/fy${pointer.fy}.json`,
    );
  }
  if (typeof pointer.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(pointer.sha256)) {
    invalidKospiDartPayout("current pointer SHA-256 is invalid");
  }
  if (!isRealCalendarDate(pointer.as_of)) {
    invalidKospiDartPayout("current pointer as_of is invalid");
  }
  if (parseUtcInstant(pointer.first_knowable_at) === null) {
    invalidKospiDartPayout("current pointer first_knowable_at is invalid");
  }

  const minimumCoverage = numberOrNull(minCoveredWeight);
  if (!finite(minimumCoverage) || minimumCoverage < DEFAULT_MIN_COVERED_WEIGHT || minimumCoverage > 1) {
    invalidKospiDartPayout(`requested coverage floor ${minCoveredWeight} is invalid`);
  }
  const validateCoverage = (coverage, label) => {
    if (!coverage || typeof coverage !== "object" || Array.isArray(coverage)
      || coverage.pass !== true
      || !finite(coverage.covered_weight)
      || coverage.covered_weight < minimumCoverage
      || coverage.covered_weight > 1
      || !finite(coverage.gate)
      || coverage.gate < DEFAULT_MIN_COVERED_WEIGHT
      || coverage.gate > 1
      || coverage.covered_weight < coverage.gate) {
      invalidKospiDartPayout(`${label} coverage does not pass the enforced floor`);
    }
  };
  validateCoverage(pointer.coverage, "current pointer");

  const selectedArtifactDataRel = pointer.selected_artifact.slice("data/".length);
  const dataRootAbs = path.resolve(dataRootForReads);
  const artifactAbs = path.resolve(dataRootAbs, selectedArtifactDataRel);
  const relativeArtifact = path.relative(dataRootAbs, artifactAbs);
  if (relativeArtifact.startsWith("..") || path.isAbsolute(relativeArtifact)) {
    invalidKospiDartPayout("selected FY artifact resolves outside the data root");
  }

  let artifactBytes;
  try {
    artifactBytes = fs.readFileSync(artifactAbs);
  } catch (error) {
    invalidKospiDartPayout(
      error?.code === "ENOENT" ? "selected FY artifact is unavailable" : "selected FY artifact cannot be read",
      pointer.selected_artifact,
    );
  }
  const actualSha256 = createHash("sha256").update(artifactBytes).digest("hex");
  if (actualSha256 !== pointer.sha256) {
    invalidKospiDartPayout("selected FY artifact SHA-256 does not match current pointer", pointer.selected_artifact);
  }

  let artifact;
  try {
    artifact = JSON.parse(artifactBytes.toString("utf8"));
  } catch {
    invalidKospiDartPayout("selected FY artifact is invalid JSON", pointer.selected_artifact);
  }
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    invalidKospiDartPayout("selected FY artifact must be a JSON object", pointer.selected_artifact);
  }
  if (artifact.schema_version !== KOSPI_DART_ARTIFACT_SCHEMA || artifact.ok !== true || artifact.status !== "ready") {
    invalidKospiDartPayout(`selected FY artifact schema/status is invalid`, pointer.selected_artifact);
  }
  if (artifact.fy !== pointer.fy || !isRealCalendarDate(artifact.asOf) || artifact.asOf !== pointer.as_of) {
    invalidKospiDartPayout("selected FY artifact FY/as_of does not match the pointer", pointer.selected_artifact);
  }
  if (artifact.first_knowable_at !== pointer.first_knowable_at
    || parseUtcInstant(artifact.first_knowable_at) === null
    || artifact.first_knowable_at.slice(0, 10) > artifact.asOf) {
    invalidKospiDartPayout("selected FY artifact first_knowable_at is invalid or does not match the pointer", pointer.selected_artifact);
  }
  validateCoverage(artifact.coverage, "selected FY artifact");
  if (artifact.coverage.covered_weight !== pointer.coverage.covered_weight
    || artifact.coverage.gate !== pointer.coverage.gate
    || artifact.coverage.pass !== pointer.coverage.pass) {
    invalidKospiDartPayout("selected FY artifact coverage does not match the current pointer", pointer.selected_artifact);
  }
  const issuerLeaks = perIssuerKeyPaths(artifact);
  if (issuerLeaks.length > 0) {
    invalidKospiDartPayout(
      `selected FY artifact carries per-issuer data at ${issuerLeaks.join(", ")}`,
      pointer.selected_artifact,
    );
  }
  if (!Number.isInteger(artifact.per_issuer_rows) || artifact.per_issuer_rows < 0) {
    invalidKospiDartPayout("selected FY artifact per_issuer_rows count is invalid", pointer.selected_artifact);
  }
  if (!finite(artifact.index_dividend_yield) || artifact.index_dividend_yield < 0
    || artifact.index_dividend_yield > MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD
    || !finite(artifact.earnings_yield) || artifact.earnings_yield <= 0
    || !finite(artifact.payout_ratio) || artifact.payout_ratio < 0 || artifact.payout_ratio > 1
    || Math.abs(artifact.payout_ratio - (artifact.index_dividend_yield / artifact.earnings_yield)) > 1e-12) {
    invalidKospiDartPayout("selected FY artifact payout operands are invalid", pointer.selected_artifact);
  }

  const bridge = artifact.provenance?.bridge;
  const benchmark = artifact.provenance?.benchmark;
  if (!bridge || typeof bridge !== "object"
    || typeof bridge.source !== "string" || !bridge.source.trim()
    || typeof bridge.source_field !== "string" || !bridge.source_field.trim()
    || !isRealCalendarDate(bridge.as_of)
    || !Number.isInteger(bridge.row_count) || bridge.row_count <= 0
    || !benchmark || typeof benchmark !== "object"
    || typeof benchmark.source !== "string" || !benchmark.source.trim()
    || !isRealCalendarDate(benchmark.as_of)
    || bridge.as_of > artifact.asOf
    || benchmark.as_of > artifact.asOf) {
    invalidKospiDartPayout("selected FY artifact bridge/benchmark provenance is invalid", pointer.selected_artifact);
  }

  const firstKnowableDate = artifact.first_knowable_at.slice(0, 10);
  const availabilityAsOf = [firstKnowableDate, bridge.as_of, benchmark.as_of].sort().at(-1);
  return {
    pointer_path: KOSPI_DART_POINTER_FILE,
    pointer_schema_version: pointer.schema_version,
    pointer_sha256: pointer.sha256,
    pointer_batch_date: pointer.as_of,
    selected_artifact: pointer.selected_artifact,
    artifact_schema_version: artifact.schema_version,
    fy: artifact.fy,
    artifact_batch_date: artifact.asOf,
    first_knowable_at: artifact.first_knowable_at,
    availability_as_of: availabilityAsOf,
    coverage: artifact.coverage,
    payout_ratio: artifact.payout_ratio,
    index_dividend_yield: artifact.index_dividend_yield,
    earnings_yield: artifact.earnings_yield,
    provenance: {
      bridge: {
        source: bridge.source,
        source_field: bridge.source_field,
        as_of: bridge.as_of,
        row_count: bridge.row_count,
      },
      benchmark: {
        source: benchmark.source,
        as_of: benchmark.as_of,
      },
    },
  };
}

function dataRootToRepoRoot(dataRootForReads) {
  return path.resolve(dataRootForReads, "..");
}

function toPosixPath(inputPath) {
  return String(inputPath ?? "").split(path.sep).join("/");
}

function parseKrxDate(dateValue) {
  const compact = String(dateValue ?? "").replaceAll("-", "");
  return /^\d{8}$/.test(compact) ? compact : null;
}

function daysBetweenIsoDates(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

// A provider's calendar date is a DATE, not an instant, and it must normalize to
// the same day everywhere. Date.parse of a zoneless string like "April 1, 2026"
// yields LOCAL midnight, so projecting it through toISOString moved it a day back
// anywhere east of UTC: measured, this file resolved the Damodaran ERP source date
// to 2026-04-01 on a UTC runner and 2026-03-31 in Asia/Seoul, which made
// build-rim-index --check report the committed artifact stale on any developer
// machine that is not on UTC. A string that carries its own time or offset is an
// instant and keeps UTC projection.
const ZONELESS_DATE_TEXT = /^(?!.*(?:[zZ]|[+-]\d{2}:?\d{2}|\d:\d))\D*\d/;

function normalizeSourceDate(value, label) {
  if (isRealCalendarDate(value)) return value;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new Error(`${label}: invalid source date ${text}`);
  const instant = new Date(parsed);
  if (!ZONELESS_DATE_TEXT.test(text)) return instant.toISOString().slice(0, 10);
  const month = String(instant.getMonth() + 1).padStart(2, "0");
  const day = String(instant.getDate()).padStart(2, "0");
  return `${instant.getFullYear()}-${month}-${day}`;
}

function marketInputFreshness(asOf, generatedAt, { market, maxDays }) {
  const generatedDate = String(generatedAt ?? "").slice(0, 10);
  const validDates = isRealCalendarDate(asOf) && isRealCalendarDate(generatedDate);
  const calendarAgeDays = validDates ? daysBetweenIsoDates(asOf, generatedDate) : null;
  const businessAgeDays = validDates ? businessDayAge(asOf, generatedDate, market) : null;
  const futureDateAnomaly = validDates
    ? isFutureSource(asOf, generatedDate, "business_days")
    : false;
  return {
    generated_at_date: isRealCalendarDate(generatedDate) ? generatedDate : null,
    calendar_age_days: calendarAgeDays,
    business_age_days: businessAgeDays,
    freshness_unit: "business_days",
    freshness_calendar: market,
    max_input_freshness_days: maxDays,
    future_date_anomaly: futureDateAnomaly,
    status: validDates
      && !futureDateAnomaly
      && finite(businessAgeDays)
      && businessAgeDays <= maxDays
      ? "fresh_enough_for_input_slice"
      : "refresh_recommended",
  };
}

function rimObservedPriceFreshness(asOf, generatedAt, market = "us_market") {
  if (market === "krx_market") {
    return marketInputFreshness(asOf, generatedAt, {
      market,
      maxDays: RIM_INPUT_SLA.max_staleness,
    });
  }
  const generatedDate = String(generatedAt ?? "").slice(0, 10);
  const validDates = isRealCalendarDate(asOf) && isRealCalendarDate(generatedDate);
  const ageDays = validDates ? daysBetweenIsoDates(asOf, generatedDate) : null;
  const futureDateAnomaly = validDates ? asOf > generatedDate : false;
  return {
    generated_at_date: isRealCalendarDate(generatedDate) ? generatedDate : null,
    calendar_age_days: ageDays,
    freshness_unit: RIM_INPUT_SLA.unit,
    freshness_calendar: RIM_INPUT_SLA.calendar,
    max_input_freshness_days: RIM_INPUT_SLA.max_staleness,
    future_date_anomaly: futureDateAnomaly,
    status: validDates
      && !futureDateAnomaly
      && finite(ageDays)
      && ageDays <= RIM_INPUT_SLA.max_staleness
      ? "fresh_enough_for_input_slice"
      : "refresh_recommended",
  };
}

function spotFreshnessForIndex(indexConfig, asOf, generatedAt) {
  return rimObservedPriceFreshness(asOf, generatedAt, indexConfig.spotMarket ?? "us_market");
}

function spotFreshnessForId(id, asOf, generatedAt) {
  return spotFreshnessForIndex(INDEX_CONFIG_BY_ID.get(id) ?? {}, asOf, generatedAt);
}

export function krxInputFreshness(asOf, generatedAt) {
  return marketInputFreshness(asOf, generatedAt, {
    market: "krx_market",
    maxDays: KOSPI_INPUT_FRESHNESS_MAX_DAYS,
  });
}

export function soxInputFreshness(asOf, generatedAt) {
  return marketInputFreshness(asOf, generatedAt, {
    market: "us_market",
    maxDays: SOX_INPUT_FRESHNESS_MAX_DAYS,
  });
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body, "utf8");
  }
}

// A private artifact reference is a PATH, and a path has no whitespace. Matching on
// the words instead let the rule swallow its own documentation: strings like
// "Raw KRX rows stay private/admin" explain why raw rows are absent and expose
// nothing, while the actual leak was a bare `admin/....json` published twice. Keep
// the segment anchors so `admin/x.json` and `data/admin/x.json` both redact.
const PRIVATE_PATH_SEGMENT = /(?:^|\/)(?:_private|admin)\//i;

function isPrivateArtifactPath(value) {
  if (/\s/.test(value)) return false;
  return PRIVATE_PATH_SEGMENT.test(value);
}

function sanitizePublicRimMirror(node) {
  if (Array.isArray(node)) {
    return node.map((item) => sanitizePublicRimMirror(item));
  }
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, sanitizePublicRimMirror(value)]),
    );
  }
  if (typeof node === "string" && isPrivateArtifactPath(node)) {
    return "private_path_redacted";
  }
  return node;
}

export function buildPublicRimMirror(payload) {
  return {
    ...sanitizePublicRimMirror(payload),
    public_mirror_policy: {
      raw_public: false,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      // Describe the rule WITHOUT spelling any forbidden public token: the mirror
      // guard scans these bytes too, and a policy sentence that names the token it
      // forbids fails the build exactly as a real leak would.
      private_path_redaction: "path-shaped strings (no whitespace) whose leading or interior segment is a private or admin root are replaced with private_path_redacted; prose describing the policy is preserved",
    },
  };
}

function latestDatedRow(rows, label) {
  if (rows === null || rows === undefined) {
    throw new LaneUnavailableError(`${label}: source rows are unavailable`, label.split(":")[0]);
  }
  if (!Array.isArray(rows)) throw new Error(`${label}: rows must be an array`);
  if (rows.length === 0) {
    throw new LaneUnavailableError(`${label}: source rows are empty`, label.split(":")[0]);
  }
  const usable = rows
    .filter((row) => typeof row?.date === "string")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (usable.length === 0) throw new Error(`${label}: rows do not carry a date`);
  return usable.at(-1);
}

function latestBenchmarkRow(payload, section, sourceLabel) {
  if (payload === null || payload === undefined) {
    throw new LaneUnavailableError(`${sourceLabel}: source payload is unavailable`, sourceLabel);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${sourceLabel}: root payload must be an object`);
  }
  if (!payload.sections || typeof payload.sections !== "object" || Array.isArray(payload.sections)) {
    throw new Error(`${sourceLabel}: sections must be an object`);
  }
  if (!Object.hasOwn(payload.sections, section)) {
    throw new LaneUnavailableError(`${sourceLabel}:${section}: benchmark section is unavailable`, sourceLabel);
  }
  const rows = payload?.sections?.[section]?.data;
  const row = latestDatedRow(rows, `${sourceLabel}:${section}`);
  if (!isRealCalendarDate(row.date)) throw new Error(`${sourceLabel}:${section}: invalid source date ${row.date}`);
  const pxLast = numberOrNull(row.px_last);
  const bestEps = numberOrNull(row.best_eps);
  const priceToBook = numberOrNull(row.px_to_book_ratio);
  const roe = numberOrNull(row.roe);
  if (!finite(pxLast) || pxLast <= 0) throw new Error(`${sourceLabel}:${section}: invalid px_last`);
  if (!finite(bestEps) || bestEps <= 0) throw new Error(`${sourceLabel}:${section}: invalid best_eps`);
  if (!finite(priceToBook) || priceToBook <= 0) throw new Error(`${sourceLabel}:${section}: invalid px_to_book_ratio`);
  const optional = {};
  for (const key of ["best_eps_fy2", "best_eps_fy3", "best_eps_asof"]) {
    if (Object.hasOwn(row, key)) optional[key] = row[key];
  }
  return {
    date: row.date,
    px_last: pxLast,
    best_eps: bestEps,
    best_pe_ratio: numberOrNull(row.best_pe_ratio),
    px_to_book_ratio: priceToBook,
    roe,
    ...optional,
  };
}

function latestExactSpot(payload, indexConfig) {
  const sourceLabel = indexConfig.spotFile;
  if (payload === null || payload === undefined) {
    throw new LaneUnavailableError(`${sourceLabel}: source payload is unavailable`, sourceLabel);
  }

  if (indexConfig.id === "KOSPI") {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new LaneUnavailableError(`${sourceLabel}: official KOSPI payload is invalid`, sourceLabel);
    }
    const exactRows = Array.isArray(payload.indices)
      ? payload.indices.filter((row) => (
        row?.market === "KOSPI"
        && row?.index_class === "KOSPI"
        && row?.index_name === "코스피"
      ))
      : [];
    if (exactRows.length === 0) {
      throw new LaneUnavailableError(
        `${sourceLabel}: official KOSPI row identity mismatch; exact market/index_class/index_name row is required`,
        sourceLabel,
      );
    }
    let row;
    try {
      row = latestDatedRow(exactRows, `${sourceLabel}:${KOSPI_EXACT_SPOT_SOURCE_FIELD}`);
    } catch (error) {
      throw new LaneUnavailableError(`${sourceLabel}: official KOSPI exact rows are invalid`, sourceLabel);
    }
    const sameDateRows = exactRows.filter((candidate) => candidate.date === row.date);
    if (sameDateRows.length !== 1) {
      throw new LaneUnavailableError(
        `${sourceLabel}: official KOSPI exact row is duplicated for ${row.date}`,
        sourceLabel,
      );
    }
    if (!isRealCalendarDate(row.date) || !isRealCalendarDate(payload.as_of) || row.date !== payload.as_of) {
      throw new LaneUnavailableError(
        `${sourceLabel}: official KOSPI exact row date does not match payload as_of`,
        sourceLabel,
      );
    }
    const value = numberOrNull(row.close);
    if (!finite(value) || value <= 0) {
      throw new LaneUnavailableError(`${sourceLabel}: official KOSPI exact close is unavailable`, sourceLabel);
    }
    return {
      value,
      asOf: row.date,
      source: sourceLabel,
      sourceField: KOSPI_EXACT_SPOT_SOURCE_FIELD,
      sourceGeneratedAt: typeof payload.generated_at === "string" ? payload.generated_at : null,
      identity: {
        market: row.market,
        index_class: row.index_class,
        index_name: row.index_name,
      },
    };
  }

  const pinnedIdentity = indexConfig.spotIdentity;
  if (!pinnedIdentity
    || typeof pinnedIdentity.provider_symbol !== "string"
    || !pinnedIdentity.provider_symbol.trim()
    || typeof pinnedIdentity.canonical_index !== "string"
    || !pinnedIdentity.canonical_index.trim()) {
    throw new LaneUnavailableError(
      `${sourceLabel}: pinned exact index identity is invalid`,
      sourceLabel,
    );
  }
  if (!Array.isArray(payload)) {
    throw new LaneUnavailableError(`${sourceLabel}: exact spot rows are invalid`, sourceLabel);
  }
  let row;
  try {
    row = latestDatedRow(payload, sourceLabel);
  } catch (error) {
    throw new LaneUnavailableError(`${sourceLabel}: exact spot rows are invalid`, sourceLabel);
  }
  if (!isRealCalendarDate(row.date)) {
    throw new LaneUnavailableError(`${sourceLabel}: exact spot source date is invalid`, sourceLabel);
  }
  const value = numberOrNull(row.value);
  if (!finite(value) || value <= 0) {
    throw new LaneUnavailableError(`${sourceLabel}: exact spot close is unavailable`, sourceLabel);
  }
  return {
    value,
    asOf: row.date,
    source: sourceLabel,
    sourceField: "rows[-1].value",
    sourceGeneratedAt: null,
    identity: { ...pinnedIdentity },
  };
}

function buildExactSpotObserved(indexConfig, spot, generatedAt) {
  const observed = observedValue({
    value: round(spot.value, 4),
    source: spot.source ?? indexConfig.spotFile,
    sourceField: spot.sourceField ?? "rows[-1].value",
    asOf: spot.asOf,
  });
  observed.freshness = spotFreshnessForIndex(indexConfig, spot.asOf, generatedAt);
  if (spot.sourceGeneratedAt) observed.source_generated_at = spot.sourceGeneratedAt;
  if (spot.identity) observed.identity = spot.identity;
  return observed;
}

function observedValue({ value, source, sourceField, asOf, label = null, freshness = null }) {
  return {
    value,
    source,
    source_field: sourceField,
    source_tier: "observed_source",
    as_of: asOf,
    ...(label ? { label } : {}),
    ...(freshness ? { freshness } : {}),
  };
}

function derivedValue({ value, formula, sources, coverage = null, qa = null, notes = [] }) {
  return {
    value,
    formula,
    sources,
    source_tier: "derived_formula",
    ...(coverage ? { coverage } : {}),
    ...(qa ? { qa } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function formulaValue({ value, formula, sources, sourceTier = "derived_formula", coverage = null, notes = [] }) {
  return {
    value,
    formula,
    sources,
    source_tier: sourceTier,
    ...(coverage ? { coverage } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function blockedValue({ reason, candidate = null, sourceTier = "blocked_missing_source" }) {
  return {
    value: null,
    source_tier: sourceTier,
    reason,
    ...(candidate ? { candidate } : {}),
  };
}

function loadDgs10(macroPayload) {
  const row = latestDatedRow(macroPayload?.series?.DGS10, "macro/fred-banking-daily.json:series.DGS10");
  const value = numberOrNull(row.value);
  if (!finite(value) || value <= 0) throw new Error("DGS10 latest value is missing or invalid");
  return {
    value: round(value / 100, 8),
    date: row.date,
    raw_value_percent: value,
  };
}

function loadKr10y(macroPayload) {
  const rows = macroPayload?.series?.IRLTLT01KRM156N;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = latestDatedRow(rows, "macro/fred-banking-daily.json:series.IRLTLT01KRM156N");
  const value = numberOrNull(row.value);
  if (!finite(value) || value <= 0) return null;
  return {
    value: round(value / 100, 8),
    date: row.date,
    raw_value_percent: value,
  };
}

function loadKrxBridge(dataRootForReads) {
  const bridgePath = path.join(dataRootForReads, KOSPI_KRX_BRIDGE_FILE);
  const bridge = readOptionalJson(bridgePath);
  if (!bridge?.private_artifacts?.raw_root || !bridge?.as_of) return null;
  const dateKey = parseKrxDate(bridge.as_of);
  if (!dateKey) return null;
  const repoRootForReads = dataRootToRepoRoot(dataRootForReads);
  return {
    bridge,
    bridge_source: KOSPI_KRX_BRIDGE_FILE,
    repo_root: repoRootForReads,
    raw_root_rel: toPosixPath(bridge.private_artifacts.raw_root),
    as_of: bridge.as_of,
    date_key: dateKey,
    raw_public: bridge.raw_public === true,
    license_or_terms_note: bridge.license_or_terms_note ?? null,
  };
}

function krxPrivatePath(bridgeInfo, ...parts) {
  const relPath = toPosixPath(path.posix.join(bridgeInfo.raw_root_rel, ...parts));
  return {
    relPath,
    absPath: path.join(bridgeInfo.repo_root, relPath),
  };
}

function loadKrxKospiBridgeWeights(bridgeInfo, generatedAt) {
  const input = bridgeInfo?.bridge?.derived_rim_inputs?.kospi_weights;
  const inputRows = Array.isArray(input?.rows) ? input.rows : [];
  const rows = inputRows
    .map((row) => {
      const weight = numberOrNull(row?.weight);
      const weightPct = numberOrNull(row?.weight_pct);
      return {
        code: String(row?.code ?? "").trim().toUpperCase(),
        name: String(row?.name ?? "").trim(),
        weight: finite(weight) ? weight : (finite(weightPct) ? weightPct / 100 : null),
        weight_pct: finite(weightPct) ? weightPct : (finite(weight) ? weight * 100 : null),
      };
    })
    .filter((row) => row.code && finite(row.weight) && row.weight > 0 && finite(row.weight_pct) && row.weight_pct > 0);
  if (!rows.length) return null;
  return {
    source: input?.source ?? `${bridgeInfo.bridge_source}#derived_rim_inputs.kospi_weights`,
    bridge_source: bridgeInfo.bridge_source,
    source_field: input?.source_field ?? "derived_rim_inputs.kospi_weights.rows[].weight",
    as_of: input?.as_of ?? bridgeInfo.as_of,
    raw_public: input?.raw_public === true,
    license_or_terms_note: input?.license_or_terms_note ?? bridgeInfo.license_or_terms_note,
    row_count: numberOrNull(input?.row_count) ?? rows.length,
    total_market_cap: numberOrNull(input?.total_market_cap),
    denominator: input?.denominator ?? {
      method: "issuer_level_market_cap_sum",
      label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
      unit: "KRW",
      value: numberOrNull(input?.total_market_cap),
    },
    freshness: krxInputFreshness(input?.as_of ?? bridgeInfo.as_of, generatedAt),
    derived_bridge_input: true,
    rows,
  };
}

function loadKrxKospiMarketCapWeights(dataRootForReads, generatedAt) {
  const bridgeInfo = loadKrxBridge(dataRootForReads);
  if (!bridgeInfo) return null;
  const bridgeFallback = loadKrxKospiBridgeWeights(bridgeInfo, generatedAt);
  const sourcePath = krxPrivatePath(
    bridgeInfo,
    "core_stock_index",
    "stk_bydd_trd",
    `${bridgeInfo.date_key}.json`,
  );
  const payload = readOptionalJson(sourcePath.absPath);
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const kospiRows = rows
    .filter((row) => row?.MKT_NM === "KOSPI")
    .map((row) => ({
      code: String(row?.ISU_CD ?? "").trim().toUpperCase(),
      name: String(row?.ISU_NM ?? "").trim(),
      close_price: numberOrNull(row?.TDD_CLSPRC),
      listed_shares: numberOrNull(row?.LIST_SHRS),
      market_cap: numberOrNull(row?.MKTCAP),
    }))
    .filter((row) => row.code && finite(row.market_cap) && row.market_cap > 0);
  const totalMktCap = kospiRows.reduce((sum, row) => sum + row.market_cap, 0);
  if (!finite(totalMktCap) || totalMktCap <= 0) return bridgeFallback;
  return {
    source: sourcePath.relPath,
    bridge_source: bridgeInfo.bridge_source,
    source_field: "OutBlock_1[MKT_NM=KOSPI].MKTCAP / sum(OutBlock_1[MKT_NM=KOSPI].MKTCAP)",
    as_of: bridgeInfo.as_of,
    raw_public: bridgeInfo.raw_public,
    license_or_terms_note: bridgeInfo.license_or_terms_note,
    row_count: kospiRows.length,
    total_market_cap: totalMktCap,
    denominator: {
      method: "issuer_level_market_cap_sum",
      label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
      unit: "KRW",
      value: totalMktCap,
    },
    freshness: krxInputFreshness(bridgeInfo.as_of, generatedAt),
    rows: kospiRows.map((row) => ({
      ...row,
      weight: row.market_cap / totalMktCap,
      weight_pct: (row.market_cap / totalMktCap) * 100,
    })),
  };
}

function loadKrxKorea10yBridge(bridgeInfo) {
  const input = bridgeInfo?.bridge?.derived_rim_inputs?.korea_10y;
  const value = numberOrNull(input?.value);
  if (!finite(value) || value <= 0) return null;
  return {
    value,
    date: input?.date ?? bridgeInfo.as_of,
    raw_value_percent: numberOrNull(input?.raw_value_percent),
    source: input?.source ?? `${bridgeInfo.bridge_source}#derived_rim_inputs.korea_10y`,
    source_field: input?.source_field ?? "derived_rim_inputs.korea_10y.value",
    label: input?.label ?? "KRX KTS 10Y benchmark government bond yield",
    raw_public: input?.raw_public === true,
    license_or_terms_note: input?.license_or_terms_note ?? bridgeInfo.license_or_terms_note,
    derived_bridge_input: true,
  };
}

function loadKrxKorea10y(dataRootForReads) {
  const bridgeInfo = loadKrxBridge(dataRootForReads);
  if (!bridgeInfo) return null;
  const bridgeFallback = loadKrxKorea10yBridge(bridgeInfo);
  const sourcePath = krxPrivatePath(
    bridgeInfo,
    "bond_commodity_esg",
    "kts_bydd_trd",
    `${bridgeInfo.date_key}.json`,
  );
  const payload = readOptionalJson(sourcePath.absPath);
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const candidates = rows
    .map((row) => ({
      row,
      yieldPercent: numberOrNull(row?.CLSPRC_YD),
      term: String(row?.BND_EXP_TP_NM ?? "").trim(),
      benchmarkType: String(row?.GOVBND_ISU_TP_NM ?? "").trim(),
      name: String(row?.ISU_NM ?? "").trim(),
    }))
    .filter((item) => item.term === "10" && item.benchmarkType === "지표" && finite(item.yieldPercent) && item.yieldPercent > 0)
    .sort((a, b) => Number(a.name.includes("물가")) - Number(b.name.includes("물가")));
  const selected = candidates.find((item) => !item.name.includes("물가")) ?? candidates[0];
  if (!selected) return bridgeFallback;
  return {
    value: round(selected.yieldPercent / 100, 8),
    date: bridgeInfo.as_of,
    raw_value_percent: selected.yieldPercent,
    source: sourcePath.relPath,
    source_field: `OutBlock_1[ISU_NM=${selected.name},BND_EXP_TP_NM=10,GOVBND_ISU_TP_NM=지표].CLSPRC_YD / 100`,
    label: "KRX KTS 10Y benchmark government bond yield",
    raw_public: bridgeInfo.raw_public,
    license_or_terms_note: bridgeInfo.license_or_terms_note,
  };
}

function loadUsErp(erpPayload) {
  if (erpPayload === null || erpPayload === undefined) {
    throw new LaneUnavailableError("damodaran/erp.json: source payload is unavailable", "damodaran/erp.json");
  }
  if (!Object.hasOwn(erpPayload, "us_erp") || erpPayload.us_erp === null || erpPayload.us_erp === "") {
    throw new LaneUnavailableError("damodaran/erp.json: us_erp is unavailable", "damodaran/erp.json");
  }
  const value = numberOrNull(erpPayload?.us_erp);
  if (!finite(value) || value <= 0) throw new Error("damodaran/erp.json: us_erp is invalid");
  return {
    value: round(value, 8),
    source_date: normalizeSourceDate(erpPayload?.metadata?.source_date, "damodaran/erp.json"),
    generated_at: erpPayload?.metadata?.generated_at ?? null,
  };
}

function buildBenchmarkObservedInputs(indexConfig, benchmarkRow, benchmarkFreshness) {
  const source = indexConfig.benchmarkFile;
  const prefix = `sections.${indexConfig.benchmarkSection}.data[-1]`;
  return {
    benchmark_price: observedValue({
      value: round(benchmarkRow.px_last, 4),
      source,
      sourceField: `${prefix}.px_last`,
      asOf: benchmarkRow.date,
      freshness: benchmarkFreshness,
    }),
    forward_eps: observedValue({
      value: round(benchmarkRow.best_eps, 4),
      source,
      sourceField: `${prefix}.best_eps`,
      asOf: benchmarkRow.date,
      freshness: benchmarkFreshness,
    }),
    forward_pe: observedValue({
      value: round(benchmarkRow.best_pe_ratio, 4),
      source,
      sourceField: `${prefix}.best_pe_ratio`,
      asOf: benchmarkRow.date,
      freshness: benchmarkFreshness,
    }),
    price_to_book: observedValue({
      value: round(benchmarkRow.px_to_book_ratio, 4),
      source,
      sourceField: `${prefix}.px_to_book_ratio`,
      asOf: benchmarkRow.date,
      freshness: benchmarkFreshness,
    }),
    roe: observedValue({
      value: round(benchmarkRow.roe, 4),
      source,
      sourceField: `${prefix}.roe`,
      asOf: benchmarkRow.date,
      freshness: benchmarkFreshness,
    }),
  };
}

function buildBookValue(benchmarkRow, currentSpot) {
  return derivedValue({
    value: round(currentSpot / benchmarkRow.px_to_book_ratio, 4),
    formula: "current_price / price_to_book",
    sources: ["observed.price", "observed.price_to_book"],
  });
}

function buildPayoutRatio(indexConfig, benchmarkRow, yieldPayload, {
  dataRootForReads = dataRoot,
  yfRoot = path.join(dataRootForReads, "yf", "finance"),
} = {}) {
  if (yieldPayload === null || yieldPayload === undefined || !Object.hasOwn(yieldPayload, "yield")) {
    throw new LaneUnavailableError(`${indexConfig.yieldFile}: yield is unavailable`, indexConfig.yieldFile);
  }
  const dividendYieldPct = numberOrNull(yieldPayload?.yield);
  if (!finite(dividendYieldPct) || dividendYieldPct < 0) {
    throw new Error(`${indexConfig.yieldFile}: yield is invalid`);
  }
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = earningsYield > 0 ? (dividendYieldPct / 100) / earningsYield : null;
  const holdingsSource = `slickcharts/${indexConfig.slickchartsIndex}.json`;
  const holdingsPayload = readDataJson(holdingsSource, dataRootForReads);
  if (!Array.isArray(holdingsPayload?.holdings)) {
    throw new Error(`${holdingsSource}: holdings must be an array`);
  }
  if (holdingsPayload.holdings.length === 0) {
    throw new LaneUnavailableError(`${holdingsSource}: holdings are empty`, holdingsSource);
  }
  const holdings = holdingsPayload.holdings;
  const qa = weightedYfPayoutRatio(holdings, yfRoot);
  const indexYieldAsOf = normalizeSourceDate(
    yieldPayload?.source_as_of ?? yieldPayload?.as_of ?? yieldPayload?.date ?? yieldPayload?.metadata?.source_date,
    indexConfig.yieldFile,
  );
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "(index_dividend_yield_pct / 100) / (benchmark_best_eps / benchmark_px_last)",
    sources: [indexConfig.yieldFile, indexConfig.benchmarkFile],
    coverage: {
      primary_formula: "index_yield_over_benchmark_earnings_yield",
      index_yield_as_of: indexYieldAsOf,
      index_yield_as_of_reason: indexYieldAsOf ? null : "provider publishes no source date for the index yield observation",
      // Canonical UTC (Z). The provider sends +00:00; the same instant is
      // published in one canonical form so every reader parses one shape, and
      // the raw string is kept beside it as provenance.
      index_yield_collected_at: canonicalUtcInstant(yieldPayload?.updated) ?? null,
      index_yield_collected_at_provider: yieldPayload?.updated ?? null,
      // Both the reconciled value and this timestamp are read off the SAME
      // parsed response object above. Recorded explicitly so the collection
      // clock can be accepted on evidence rather than on the reader's trust,
      // and so an absent timestamp fails closed instead of silently passing.
      index_yield_provenance: {
        same_response: Object.hasOwn(yieldPayload ?? {}, "updated")
          && typeof yieldPayload.updated === "string"
          && yieldPayload.updated.trim().length > 0,
        source_file: indexConfig.yieldFile,
        clock_kind: indexYieldAsOf ? "source_as_of" : "collected_at",
        note: "collection time, not an economic observation date",
      },
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
    },
    qa: {
      formula: "index-weighted YF payoutRatio cross-check",
      ...qa,
    },
    notes: ["Not an observed index-level payout series; coverage-tagged derived input only."],
  });
}

function weightedYfPayoutRatio(holdings, yfRoot) {
  let totalWeight = 0;
  let coveredWeight = 0;
  let weighted = 0;
  const missingSample = [];
  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? "").toUpperCase();
    const weight = numberOrNull(holding?.weight);
    if (!symbol || !finite(weight) || weight <= 0) continue;
    totalWeight += weight;
    const filePath = path.join(yfRoot, `${symbol}.json`);
    let payoutRatio = null;
    if (fs.existsSync(filePath)) {
      payoutRatio = numberOrNull(readJson(filePath)?.data?.info?.payoutRatio);
    }
    if (finite(payoutRatio) && payoutRatio >= 0 && payoutRatio < 2) {
      coveredWeight += weight;
      weighted += weight * payoutRatio;
    } else if (missingSample.length < 10) {
      missingSample.push(symbol);
    }
  }
  return {
    value: coveredWeight > 0 ? round(weighted / coveredWeight, 6) : null,
    total_weight: round(totalWeight, 4),
    covered_weight: round(coveredWeight, 4),
    covered_weight_ratio: totalWeight > 0 ? round(coveredWeight / totalWeight, 6) : null,
    missing_sample: missingSample,
  };
}

function stockActionBySymbol(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return new Map(rows.map((row) => [String(row.symbol ?? row.ticker_normalized ?? "").toUpperCase(), row]));
}

function addStockActionLookupKey(map, key, row) {
  const normalized = String(key ?? "").trim().toUpperCase();
  if (normalized) map.set(normalized, row);
}

function stockActionLookup(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const map = new Map();
  for (const row of rows) {
    addStockActionLookupKey(map, row?.symbol, row);
    addStockActionLookupKey(map, row?.ticker_normalized, row);
    const ticker = String(row?.ticker_normalized ?? "").trim().toUpperCase();
    if (/^\d{6}$/.test(ticker)) {
      addStockActionLookupKey(map, `!KRX/${ticker}`, row);
      addStockActionLookupKey(map, `${ticker}.KS`, row);
      addStockActionLookupKey(map, `${ticker}.KQ`, row);
    }
  }
  return map;
}

function stockActionRowsForIndex(stockActionPayload, indexKey) {
  const rows = Array.isArray(stockActionPayload?.rows) ? stockActionPayload.rows : [];
  return rows
    .map((row) => ({
      row,
      indexWeight: (row?.indexWeights ?? []).find((item) => item?.index === indexKey),
    }))
    .filter(({ indexWeight }) => finite(numberOrNull(indexWeight?.weight)) && numberOrNull(indexWeight.weight) > 0);
}

function stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights) {
  if (!krxWeights?.rows?.length) {
    return { indexRows: [], denominatorRows: [], missingSample: [] };
  }
  const lookup = stockActionLookup(stockActionPayload);
  const denominatorRows = [];
  const indexRows = [];
  const missingSample = [];
  for (const krxRow of krxWeights.rows) {
    const indexWeight = {
      index: KOSPI_KRX_WEIGHT_KEY,
      weight: krxRow.weight_pct,
      source_weight_unit: "percent",
    };
    denominatorRows.push({
      row: {
        symbol: krxRow.code,
        ticker_normalized: krxRow.code,
        company: krxRow.name,
      },
      indexWeight,
      krxRow,
    });
    const stockActionRow = lookup.get(krxRow.code);
    if (stockActionRow) {
      indexRows.push({ row: stockActionRow, indexWeight, krxRow });
    } else if (missingSample.length < 10) {
      missingSample.push(`${krxRow.code}:${krxRow.name}`);
    }
  }
  return { indexRows, denominatorRows, missingSample };
}

function capForSoxMarketCapRank(rankIndex) {
  if (rankIndex === 0) return 12;
  if (rankIndex === 1) return 10;
  if (rankIndex === 2) return 8;
  return 4;
}

function cappedSoxMarketCapWeights(rows) {
  const totalMarketCap = rows.reduce((sum, row) => sum + row.market_cap, 0);
  if (!finite(totalMarketCap) || totalMarketCap <= 0) return [];
  const byMarketCap = rows
    .map((row) => ({
      ...row,
      initial_weight_pct: (row.market_cap / totalMarketCap) * 100,
    }))
    .sort((a, b) => b.market_cap - a.market_cap);
  let working = byMarketCap.map((row, index) => ({
    ...row,
    market_cap_rank: index + 1,
    cap_pct: capForSoxMarketCapRank(index),
    weight_pct: row.initial_weight_pct,
    capped: false,
  }));
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const overCap = working.filter((row) => row.weight_pct > row.cap_pct + 1e-10);
    if (!overCap.length) break;
    const excess = overCap.reduce((sum, row) => sum + (row.weight_pct - row.cap_pct), 0);
    const overSet = new Set(overCap.map((row) => row.symbol));
    working = working.map((row) => overSet.has(row.symbol)
      ? { ...row, weight_pct: row.cap_pct, capped: true }
      : row);
    const receivers = working.filter((row) => !overSet.has(row.symbol) && row.weight_pct < row.cap_pct - 1e-10);
    const receiverMarketCap = receivers.reduce((sum, row) => sum + row.market_cap, 0);
    if (!receivers.length || !finite(receiverMarketCap) || receiverMarketCap <= 0) break;
    working = working.map((row) => {
      if (!receivers.some((receiver) => receiver.symbol === row.symbol)) return row;
      return {
        ...row,
        weight_pct: row.weight_pct + (excess * row.market_cap / receiverMarketCap),
      };
    });
  }
  return working
    .map((row) => ({
      ...row,
      weight_pct: round(row.weight_pct, 8),
      weight: round(row.weight_pct / 100, 10),
      initial_weight_pct: round(row.initial_weight_pct, 8),
    }))
    .sort((a, b) => a.giw_rank - b.giw_rank);
}

function loadNasdaqGiwSoxConstituents(dataRootForReads) {
  const payload = readOptionalJson(path.join(dataRootForReads, SOX_GIW_CONSTITUENTS_FILE));
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const normalizedRows = rows
    .map((row, index) => ({
      giw_rank: numberOrNull(row?.rank) ?? index + 1,
      name: String(row?.name ?? "").trim(),
      symbol: String(row?.symbol ?? "").trim().toUpperCase(),
    }))
    .filter((row) => row.symbol);
  if (payload?.schema_version !== "nasdaq_giw_sox_constituents.v1"
    || payload?.index_id !== "SOX"
    || normalizedRows.length < 25) {
    return null;
  }
  return {
    ...payload,
    rows: normalizedRows,
    row_count: numberOrNull(payload?.row_count) ?? normalizedRows.length,
  };
}

function loadSoxMethodologyWeights(dataRootForReads, stockActionPayload, generatedAt) {
  const constituents = loadNasdaqGiwSoxConstituents(dataRootForReads);
  if (!constituents) return null;
  const lookup = stockActionLookup(stockActionPayload);
  const missingSample = [];
  const marketCapRows = [];
  for (const constituent of constituents.rows) {
    const stockActionRow = lookup.get(constituent.symbol);
    const marketCap = numberOrNull(stockActionRow?.marketCap);
    if (stockActionRow && finite(marketCap) && marketCap > 0) {
      marketCapRows.push({
        ...constituent,
        market_cap: marketCap,
        stock_action_symbol: String(stockActionRow.symbol ?? constituent.symbol).trim().toUpperCase(),
      });
    } else if (missingSample.length < 10) {
      missingSample.push(constituent.symbol);
    }
  }
  if (marketCapRows.length < 25) return null;
  const totalMarketCap = marketCapRows.reduce((sum, row) => sum + row.market_cap, 0);
  const rows = cappedSoxMarketCapWeights(marketCapRows);
  return {
    index_id: constituents.index_id,
    index_key: SOX_DERIVED_WEIGHT_KEY,
    source_tier: "methodology_derived_index_weight_source",
    source: SOX_GIW_CONSTITUENTS_FILE,
    source_url: constituents.source_url ?? "https://indexes.nasdaqomx.com/Index/Weighting/SOX",
    source_field: "rows[].symbol + computed/stock_action_index.marketCap -> SOX methodology capped weights",
    access_scope: constituents.access_scope ?? "public_free_constituent_view_no_official_weight_columns",
    as_of: constituents.as_of ?? null,
    row_count: rows.length,
    total_market_cap: totalMarketCap,
    denominator: {
      method: "stock_action_market_cap_sum_for_official_giw_constituents",
      label: "SOX official Nasdaq GIW constituents weighted by stock_action market cap and SOX methodology caps",
      unit: "USD",
      value: totalMarketCap,
    },
    methodology: {
      source: "Nasdaq SOX methodology",
      source_url: "https://indexes.nasdaqomx.com/docs/methodology_SOX.pdf",
      weighting_scheme: "modified_market_capitalization_weighted",
      cap_schedule: {
        largest_market_cap: 0.12,
        second_largest_market_cap: 0.10,
        third_largest_market_cap: 0.08,
        other_constituents: 0.04,
      },
      redistribution: "excess_weight_proportionally_redistributed_to_lower_weighted_index_securities_iteratively",
    },
    freshness: soxInputFreshness(constituents.as_of, generatedAt),
    official_weight_columns_available: false,
    missing_sample: missingSample,
    rows,
    notes: [
      "Constituent identities come from Nasdaq GIW public SOX weighting endpoint.",
      "Official GIW weight columns are not available in the public free view, so weights are methodology-derived from stock_action market caps.",
      "SOXX/SOXQ ETF holdings remain diagnostics-only and are not promoted as exact SOX weights.",
    ],
  };
}

function stockActionRowsForSoxWeights(stockActionPayload, soxWeights) {
  if (!soxWeights?.rows?.length) {
    return { indexRows: [], denominatorRows: [], missingSample: [] };
  }
  const lookup = stockActionLookup(stockActionPayload);
  const denominatorRows = [];
  const indexRows = [];
  const missingSample = [];
  for (const soxRow of soxWeights.rows) {
    const indexWeight = {
      index: SOX_DERIVED_WEIGHT_KEY,
      weight: soxRow.weight_pct,
      source_weight_unit: "percent",
    };
    denominatorRows.push({
      row: {
        symbol: soxRow.symbol,
        ticker_normalized: soxRow.symbol,
        company: soxRow.name,
      },
      indexWeight,
      soxRow,
    });
    const stockActionRow = lookup.get(soxRow.symbol);
    if (stockActionRow) {
      indexRows.push({ row: stockActionRow, indexWeight, soxRow });
    } else if (missingSample.length < 10) {
      missingSample.push(soxRow.symbol);
    }
  }
  return { indexRows, denominatorRows, missingSample };
}

function weightedMetric(indexRows, metricFn, { denominatorRows = indexRows, missingLimit = 10 } = {}) {
  const denominatorWeight = denominatorRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  let coveredWeight = 0;
  let coveredRows = 0;
  let weighted = 0;
  const missingSample = [];
  for (const item of indexRows) {
    const weight = numberOrNull(item.indexWeight.weight);
    const value = metricFn(item.row);
    if (finite(value)) {
      coveredWeight += weight;
      coveredRows += 1;
      weighted += weight * value;
    } else if (missingSample.length < missingLimit) {
      missingSample.push(String(item.row?.symbol ?? item.row?.ticker_normalized ?? "unknown"));
    }
  }
  return {
    value: coveredWeight > 0 ? round(weighted / coveredWeight, 9) : null,
    covered_rows: coveredRows,
    total_rows: denominatorRows.length,
    total_weight: round(denominatorWeight, 4),
    covered_weight: round(coveredWeight, 4),
    covered_weight_ratio: denominatorWeight > 0 ? round(coveredWeight / denominatorWeight, 6) : null,
    missing_sample: missingSample,
  };
}

function stockActionIndexDiagnostics(stockActionPayload, indexKey) {
  const indexRows = stockActionRowsForIndex(stockActionPayload, indexKey);
  const totalWeight = indexRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const forwardRows = indexRows.filter(({ row }) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0;
  });
  return {
    index_key: indexKey,
    source_tier: "exact_index_weight_source",
    index_weight_rows: indexRows.length,
    index_weight_total: round(totalWeight, 4),
    forward_eps_fy1_fy3_rows: forwardRows.length,
    forward_eps_fy1_fy3_weight: round(forwardRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0), 4),
  };
}

function hasForwardEpsFy1Fy3(row) {
  const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
  const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
  return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0;
}

function stockActionRowsForProxyCandidate(stockActionPayload, config, dataRootForReads) {
  const lookup = stockActionLookup(stockActionPayload);
  const payload = readDataJson(config.source, dataRootForReads);
  if (!Array.isArray(payload?.normalized?.holdings)) {
    throw new Error(`${config.source}: normalized.holdings must be an array`);
  }
  if (payload.normalized.holdings.length === 0) {
    throw new LaneUnavailableError(`${config.source}: normalized.holdings is empty`, config.source);
  }
  const holdings = payload.normalized.holdings;
  const indexKey = `${String(config.proxyTicker).toLowerCase()}_etf_proxy`;
  const denominatorRows = [];
  const indexRows = [];
  const missingSample = [];
  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? "").trim().toUpperCase();
    const weight = numberOrNull(holding?.weight_pct ?? holding?.weight);
    if (!finite(weight) || weight <= 0) continue;
    const indexWeight = {
      index: indexKey,
      weight,
      source_weight_unit: "percent",
    };
    denominatorRows.push({
      row: {
        symbol,
        ticker_normalized: symbol,
        company: String(holding?.name ?? holding?.company ?? "").trim(),
      },
      indexWeight,
      holding,
    });
    const row = lookup.get(symbol);
    if (row) {
      indexRows.push({ row, indexWeight, holding });
    } else if (missingSample.length < 10) {
      missingSample.push(symbol || "(blank)");
    }
  }
  return { payload, holdings, indexKey, denominatorRows, indexRows, missingSample };
}

function proxyDiagnosticStatus(config, forwardWeightRatio) {
  if (config.diagnosticStatus) return config.diagnosticStatus;
  if (config.exactIndexSubstitute) return "exact_candidate";
  return forwardWeightRatio >= DEFAULT_MIN_COVERED_WEIGHT
    ? "proxy_financials_coverage_ready_exact_index_blocked"
    : "proxy_coverage_below_threshold";
}

function proxyCandidateDiagnostic(config, joined) {
  const reportedWeight = joined.denominatorRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const resolvedWeight = joined.indexRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const forwardRows = joined.indexRows.filter(({ row }) => hasForwardEpsFy1Fy3(row));
  const forwardWeight = forwardRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const resolvedWeightRatio = resolvedWeight / 100;
  const forwardWeightRatio = forwardWeight / 100;
  return {
    proxy_ticker: config.proxyTicker,
    source: config.source,
    source_tier: "proxy_diagnostic",
    exact_index_substitute: config.exactIndexSubstitute,
    fetched_at: joined.payload?.fetched_at ?? null,
    holdings_updated: joined.payload?.normalized?.holdings_updated ?? null,
    reported_holding_count: joined.payload?.normalized?.holding_count ?? joined.holdings.length,
    sampled_holding_rows: joined.holdings.length,
    reported_weight_total: round(reportedWeight, 4),
    resolved_rows: joined.indexRows.length,
    resolved_weight: round(resolvedWeight, 4),
    resolved_weight_ratio: round(resolvedWeightRatio, 6),
    resolved_weight_ratio_of_reported_holdings: reportedWeight > 0 ? round(resolvedWeight / reportedWeight, 6) : null,
    forward_eps_fy1_fy3_rows: forwardRows.length,
    forward_eps_fy1_fy3_weight: round(forwardWeight, 4),
    forward_eps_fy1_fy3_weight_ratio: round(forwardWeightRatio, 6),
    min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
    diagnostic_status: proxyDiagnosticStatus(config, forwardWeightRatio),
    missing_sample: joined.missingSample,
    notes: config.notes,
  };
}

function proxyConstituentCandidateDiagnostics(stockActionPayload, dataRootForReads) {
  const diagnostics = {};
  for (const [indexId, config] of Object.entries(PROXY_CONSTITUENT_CANDIDATES)) {
    try {
      const joined = stockActionRowsForProxyCandidate(stockActionPayload, config, dataRootForReads);
      diagnostics[indexId] = proxyCandidateDiagnostic(config, joined);
    } catch (error) {
      if (!(error instanceof LaneUnavailableError)) throw error;
      diagnostics[indexId] = {
        proxy_ticker: config.proxyTicker,
        source: config.source,
        source_tier: "proxy_diagnostic",
        exact_index_substitute: config.exactIndexSubstitute,
        diagnostic_status: "source_unavailable",
        reason: error.message,
      };
    }
  }
  return diagnostics;
}

function krxKospiWeightDiagnostics(stockActionPayload, krxWeights) {
  if (!krxWeights) return null;
  const joined = stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const matched = weightedMetric(joined.indexRows, () => 1, denominatorOptions);
  const dividendYield = weightedDividendYieldFraction(joined.indexRows, denominatorOptions);
  const forwardGrowth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  return {
    index_key: KOSPI_KRX_WEIGHT_KEY,
    source_tier: "exact_index_weight_source",
    source: krxWeights.source,
    bridge_source: krxWeights.bridge_source,
    source_field: krxWeights.source_field,
    as_of: krxWeights.as_of,
    raw_public: krxWeights.raw_public,
    license_or_terms_note: krxWeights.license_or_terms_note,
    krx_rows: krxWeights.row_count,
    total_market_cap: krxWeights.total_market_cap,
    denominator: krxWeights.denominator,
    freshness: krxWeights.freshness,
    matched_stock_action_rows: joined.indexRows.length,
    matched_weight_ratio: matched.covered_weight_ratio,
    dividend_yield_rows: dividendYield.covered_rows,
    dividend_yield_weight_ratio: dividendYield.covered_weight_ratio,
    weighted_dividend_yield: round(dividendYield.value, 8),
    forward_eps_fy1_fy3_rows: forwardGrowth.covered_rows,
    forward_eps_fy1_fy3_weight_ratio: forwardGrowth.covered_weight_ratio,
    weighted_forward_eps_3y_cagr: round(forwardGrowth.value, 6),
    min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
    public_status: forwardGrowth.covered_weight_ratio >= DEFAULT_MIN_COVERED_WEIGHT
      ? "krx_exact_weights_financials_coverage_ready"
      : "krx_exact_weights_financials_coverage_below_threshold",
    missing_sample: joined.missingSample,
    notes: [
      "KOSPI weights use KRX issuer-level MKTCAP / total KOSPI MKTCAP, not ETF proxy holdings.",
      "The current denominator is the KOSPI stock-daily issuer MKTCAP sum, matching the KOSPI including foreign shares aggregate.",
      "Raw KRX rows stay private/admin; public payload carries derived coverage and private path references only.",
    ],
  };
}

function soxWeightDiagnostics(stockActionPayload, soxWeights) {
  if (!soxWeights) return null;
  const joined = stockActionRowsForSoxWeights(stockActionPayload, soxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const matched = weightedMetric(joined.indexRows, () => 1, denominatorOptions);
  const dividendYield = weightedDividendYieldFraction(joined.indexRows, denominatorOptions);
  const forwardGrowth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  const methodologyWeightTotal = soxWeights.rows.reduce((sum, row) => sum + numberOrNull(row.weight_pct), 0);
  const capViolationCount = soxWeights.rows.filter((row) => numberOrNull(row.weight_pct) > numberOrNull(row.cap_pct) + 0.000001).length;
  return {
    index_id: soxWeights.index_id,
    index_key: SOX_DERIVED_WEIGHT_KEY,
    source_tier: soxWeights.source_tier,
    source: soxWeights.source,
    source_url: soxWeights.source_url,
    source_field: soxWeights.source_field,
    access_scope: soxWeights.access_scope,
    as_of: soxWeights.as_of,
    official_weight_columns_available: soxWeights.official_weight_columns_available,
    methodology: soxWeights.methodology,
    constituent_rows: soxWeights.row_count,
    methodology_weight_rows: soxWeights.rows.length,
    methodology_weight_total: round(methodologyWeightTotal, 6),
    cap_violation_count: capViolationCount,
    top_weight_sample: soxWeights.rows
      .slice()
      .sort((a, b) => numberOrNull(b.weight_pct) - numberOrNull(a.weight_pct))
      .slice(0, 10)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        market_cap_rank: row.market_cap_rank,
        initial_weight_pct: row.initial_weight_pct,
        cap_pct: row.cap_pct,
        weight_pct: row.weight_pct,
        capped: row.capped,
      })),
    total_market_cap: soxWeights.total_market_cap,
    denominator: soxWeights.denominator,
    freshness: soxWeights.freshness,
    matched_stock_action_rows: joined.indexRows.length,
    matched_weight_ratio: matched.covered_weight_ratio,
    dividend_yield_rows: dividendYield.covered_rows,
    dividend_yield_weight_ratio: dividendYield.covered_weight_ratio,
    weighted_dividend_yield: round(dividendYield.value, 8),
    forward_eps_fy1_fy3_rows: forwardGrowth.covered_rows,
    forward_eps_fy1_fy3_weight_ratio: forwardGrowth.covered_weight_ratio,
    weighted_forward_eps_3y_cagr: round(forwardGrowth.value, 6),
    min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
    public_status: forwardGrowth.covered_weight_ratio >= DEFAULT_MIN_COVERED_WEIGHT
      ? "sox_methodology_weights_financials_coverage_ready"
      : "sox_methodology_weights_financials_coverage_below_threshold",
    missing_sample: Array.from(new Set([...soxWeights.missing_sample, ...joined.missingSample])).slice(0, 10),
    notes: soxWeights.notes,
  };
}

function koreaCoverageDiagnostics(stockActionPayload, krxWeights = null) {
  const rows = Array.isArray(stockActionPayload?.rows) ? stockActionPayload.rows : [];
  const koreaRows = rows.filter((row) => row?.marketScope === "korea");
  const forwardRows = koreaRows.filter((row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0;
  });
  const marketCapForwardRows = forwardRows.filter((row) => finite(numberOrNull(row?.marketCap)) && numberOrNull(row.marketCap) > 0);
  const kospiWeightRows = rows.filter((row) => (row?.indexWeights ?? []).some((item) => item?.index === "kospi"));
  return {
    market_scope: "korea",
    korea_rows: koreaRows.length,
    forward_eps_fy1_fy3_rows: forwardRows.length,
    market_cap_forward_rows: marketCapForwardRows.length,
    kospi_index_weight_rows: kospiWeightRows.length,
    krx_kospi_weights: krxKospiWeightDiagnostics(stockActionPayload, krxWeights),
    public_status: krxWeights
      ? "krx_exact_weights_available"
      : (kospiWeightRows.length > 0 ? "candidate_ready" : "blocked_missing_kospi_index_weights"),
    notes: [
      krxWeights
        ? "KRX KOSPI market-cap weights are available; EWY is not used for KOSPI RIM inputs."
        : "Korea forward estimates exist, but KRX KOSPI index weights are required before public KOSPI RIM output.",
      "KOSPI RIM output publishes generated inputs only; raw KRX rows stay private/admin.",
    ],
  };
}

// One rule, one module. This used to be a private copy here, which is how it
// came to disagree with the writer: the local helper turned an ABSENT yield into
// a measured 0% (Number(null) === 0), so 74 rows with no dividend data at all
// were averaged in as genuine zero-yield companies. The shared rule fails closed
// on absence. A parity test pins the two together over the whole published
// population, not just fixtures.
export { resolveDividendYieldFraction as normalizeDividendYieldFraction } from "./lib/dividend-yield-unit.mjs";

function weightedDividendYieldFraction(indexRows, options) {
  const weighted = weightedMetric(indexRows, (row) => resolveDividendYieldFraction(row).value, options);
  const unitMix = { percent: 0, fraction: 0, zero: 0, unresolved: 0 };
  for (const item of indexRows) {
    const { unit } = resolveDividendYieldFraction(item.row);
    if (unit in unitMix) unitMix[unit] += 1;
  }
  return { ...weighted, dividend_yield_unit_mix: unitMix };
}

function buildStockActionPayoutRatio(indexConfig, benchmarkRow, stockActionPayload) {
  const indexRows = stockActionRowsForIndex(stockActionPayload, indexConfig.slickchartsIndex);
  const dividendYield = weightedDividendYieldFraction(indexRows);
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "stock_action_index_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: indexConfig.slickchartsIndex,
      weighted_dividend_yield: round(dividendYield.value, 8),
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      ...dividendYield,
    },
    notes: ["Index-weighted direct dividend-yield route; retained with SlickCharts/YF cross-checks in legacy_payout_ratio_qa."],
  });
}

function buildKrxKospiPayoutRatio(indexConfig, benchmarkRow, stockActionPayload, krxWeights) {
  const joined = stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const dividendYield = weightedDividendYieldFraction(joined.indexRows, denominatorOptions);
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "krx_kospi_mktcap_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", krxWeights.source, indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: KOSPI_KRX_WEIGHT_KEY,
      krx_weight_as_of: krxWeights.as_of,
      krx_weight_source: krxWeights.source,
      raw_public: krxWeights.raw_public,
      weighted_dividend_yield: round(dividendYield.value, 8),
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      unmatched_krx_sample: joined.missingSample,
      ...dividendYield,
    },
    notes: [
      "KRX KOSPI issuer market-cap weights are used directly; EWY/MSCI Korea ETF holdings are not used.",
      "Raw KRX rows stay private/admin; output is an input-only derived field, not a fair value.",
    ],
  });
}

function buildKospiDartPayoutRatio(dartPayout, unavailableReason = null) {
  if (!dartPayout) {
    const field = blockedValue({
      reason: unavailableReason ?? "KOSPI OpenDART current pointer is unavailable or invalid; no payout fallback is permitted.",
      sourceTier: "blocked_missing_source",
    });
    field.formula = KOSPI_DART_PAYOUT_FORMULA;
    field.sources = [KOSPI_DART_POINTER_FILE];
    field.direct_source_tier = KOSPI_DART_SOURCE_TIER;
    field.availability_status = "blocked";
    field.availability_as_of = null;
    field.coverage = {
      source_tier: KOSPI_DART_SOURCE_TIER,
      availability_status: "blocked",
      availability_as_of: null,
      covered_weight: null,
      covered_weight_ratio: null,
      gate: null,
      pass: false,
      source_clocks: {
        pointer_first_knowable_at: null,
        bridge_as_of: null,
        benchmark_as_of: null,
        availability_as_of: null,
        all_used_inputs_at_or_before: null,
      },
    };
    return field;
  }

  const coverage = dartPayout.coverage;
  const firstKnowableDate = dartPayout.first_knowable_at.slice(0, 10);
  const field = derivedValue({
    value: dartPayout.payout_ratio,
    formula: KOSPI_DART_PAYOUT_FORMULA,
    sources: [
      dartPayout.pointer_path,
      dartPayout.selected_artifact,
      dartPayout.provenance.bridge.source,
      dartPayout.provenance.benchmark.source,
    ],
    coverage: {
      source_tier: KOSPI_DART_SOURCE_TIER,
      availability_status: "available",
      availability_as_of: dartPayout.availability_as_of,
      covered_weight: coverage.covered_weight,
      covered_weight_ratio: coverage.covered_weight,
      gate: coverage.gate,
      pass: coverage.pass,
      selected_fy: dartPayout.fy,
      index_dividend_yield: dartPayout.index_dividend_yield,
      earnings_yield: dartPayout.earnings_yield,
      pointer_path: dartPayout.pointer_path,
      pointer_schema_version: dartPayout.pointer_schema_version,
      pointer_sha256: dartPayout.pointer_sha256,
      pointer_batch_date: dartPayout.pointer_batch_date,
      selected_artifact: dartPayout.selected_artifact,
      artifact_schema_version: dartPayout.artifact_schema_version,
      artifact_batch_date: dartPayout.artifact_batch_date,
      first_knowable_at: dartPayout.first_knowable_at,
      source_clocks: {
        pointer_first_knowable_at: firstKnowableDate,
        bridge_as_of: dartPayout.provenance.bridge.as_of,
        benchmark_as_of: dartPayout.provenance.benchmark.as_of,
        availability_as_of: dartPayout.availability_as_of,
        all_used_inputs_at_or_before: dartPayout.availability_as_of,
      },
      provenance: dartPayout.provenance,
    },
    notes: [
      "Top-level KOSPI payout is read from the exact OpenDART current pointer's selected FY index-level artifact.",
      "The pointer and artifact are independently path-, byte-hash-, schema-, date-, coverage-, and provenance-validated before this value is available.",
      "The legacy stock_action dividend-yield route remains diagnostics-only and is never a payout fallback.",
    ],
  });
  field.direct_source_tier = KOSPI_DART_SOURCE_TIER;
  field.source = dartPayout.pointer_path;
  field.source_field = "selected_artifact.payout_ratio";
  field.availability_status = "available";
  field.availability_as_of = dartPayout.availability_as_of;
  return field;
}

function buildKrxKospiForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  krxWeights,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
) {
  const joined = stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const growth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  return derivedValue({
    value: round(growth.value, 6),
    formula: "krx_kospi_mktcap_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", krxWeights.source],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: KOSPI_KRX_WEIGHT_KEY,
      krx_weight_as_of: krxWeights.as_of,
      krx_weight_source: krxWeights.source,
      raw_public: krxWeights.raw_public,
      min_covered_weight_ratio: minCoveredWeight,
      unmatched_krx_sample: joined.missingSample,
      ...growth,
    },
    notes: [
      "Not a live index-level consensus field; KRX exact market-cap weights are combined with stock_action forward EPS snapshots.",
      "KRX daily latest pull may need refresh before public card promotion.",
    ],
  });
}

function buildSoxPayoutRatio(indexConfig, benchmarkRow, stockActionPayload, soxWeights) {
  const joined = stockActionRowsForSoxWeights(stockActionPayload, soxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const dividendYield = weightedDividendYieldFraction(joined.indexRows, denominatorOptions);
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "sox_methodology_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", soxWeights.source, indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: SOX_DERIVED_WEIGHT_KEY,
      sox_constituents_as_of: soxWeights.as_of,
      sox_constituent_source: soxWeights.source,
      official_weight_columns_available: soxWeights.official_weight_columns_available,
      methodology_source: soxWeights.methodology.source_url,
      weighted_dividend_yield: round(dividendYield.value, 8),
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      unmatched_sox_sample: joined.missingSample,
      ...dividendYield,
    },
    notes: [
      "SOX official constituent identities are sourced from Nasdaq GIW public data.",
      "Weights are methodology-derived from stock_action market caps because GIW free view does not expose official weight columns.",
      "SOXX ETF holdings are not used in this top-level SOX payout input.",
    ],
  });
}

function buildSoxForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  soxWeights,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
) {
  const joined = stockActionRowsForSoxWeights(stockActionPayload, soxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const growth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  return derivedValue({
    value: round(growth.value, 6),
    formula: "sox_methodology_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", soxWeights.source],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: SOX_DERIVED_WEIGHT_KEY,
      sox_constituents_as_of: soxWeights.as_of,
      sox_constituent_source: soxWeights.source,
      official_weight_columns_available: soxWeights.official_weight_columns_available,
      methodology_source: soxWeights.methodology.source_url,
      min_covered_weight_ratio: minCoveredWeight,
      unmatched_sox_sample: joined.missingSample,
      ...growth,
    },
    notes: [
      "Not a live index-level consensus field; Nasdaq GIW constituents and methodology-derived weights are combined with stock_action forward EPS snapshots.",
      "A refreshed Nasdaq GIW file and stock_action rebuild are required before public card promotion.",
    ],
  });
}

function buildProxyPayoutRatio(indexConfig, benchmarkRow, stockActionPayload, proxyConfig, joined) {
  const dividendYield = weightedMetric(joined.indexRows, (row) => numberOrNull(row?.dividendYield), {
    denominatorRows: joined.denominatorRows,
  });
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "proxy_etf_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", proxyConfig.source, indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      proxy_ticker: proxyConfig.proxyTicker,
      proxy_source: proxyConfig.source,
      proxy_holdings_updated: joined.payload?.normalized?.holdings_updated ?? null,
      exact_index_substitute: proxyConfig.exactIndexSubstitute,
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      weighted_dividend_yield: round(dividendYield.value, 8),
      unmatched_proxy_sample: joined.missingSample,
      ...dividendYield,
    },
    notes: [
      "ETF holdings are used only as proxy inputs; they are not official index constituent weights.",
      "Proxy payout is not promoted to the exact index payout_ratio field.",
    ],
  });
}

function buildProxyForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  proxyConfig,
  joined,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
) {
  const growth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, { denominatorRows: joined.denominatorRows });
  return derivedValue({
    value: round(growth.value, 6),
    formula: "proxy_etf_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", proxyConfig.source],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      proxy_ticker: proxyConfig.proxyTicker,
      proxy_source: proxyConfig.source,
      proxy_holdings_updated: joined.payload?.normalized?.holdings_updated ?? null,
      exact_index_substitute: proxyConfig.exactIndexSubstitute,
      min_covered_weight_ratio: minCoveredWeight,
      unmatched_proxy_sample: joined.missingSample,
      ...growth,
    },
    notes: [
      "ETF holdings are used only as proxy inputs; they are not official index constituent weights.",
      "Proxy growth is not promoted to the exact index explicit_eps_growth_3y field.",
    ],
  });
}

function buildProxyInputs(indexConfig, benchmarkRow, context) {
  const proxyConfig = PROXY_CONSTITUENT_CANDIDATES[indexConfig.id];
  if (!proxyConfig || proxyConfig.diagnosticStatus?.startsWith("rejected_")) return null;
  const joined = stockActionRowsForProxyCandidate(context.stockActionPayload, proxyConfig, context.dataRoot);
  const diagnostic = proxyCandidateDiagnostic(proxyConfig, joined);
  if (diagnostic.forward_eps_fy1_fy3_weight_ratio < context.minCoveredWeight) return null;
  const payoutRatio = buildProxyPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload, proxyConfig, joined);
  const explicitEpsGrowth3y = buildProxyForwardEpsGrowth(
    indexConfig,
    context.stockActionPayload,
    proxyConfig,
    joined,
    context.minCoveredWeight,
  );
  const costOfEquityValue = context.dgs10.value + context.usErp.value;
  return {
    schema_version: "proxy_inputs_v1",
    public_status: "proxy_input_only_exact_index_blocked",
    source_tier: "proxy_diagnostic",
    input_basis: "etf_holdings_proxy_not_official_index_weights",
    proxy_ticker: proxyConfig.proxyTicker,
    source: proxyConfig.source,
    exact_index_substitute: proxyConfig.exactIndexSubstitute,
    diagnostic_status: diagnostic.diagnostic_status,
    fetched_at: diagnostic.fetched_at,
    holdings_updated: diagnostic.holdings_updated,
    coverage: diagnostic,
    key_inputs: {
      payout_ratio: payoutRatio,
      explicit_eps_growth_3y: explicitEpsGrowth3y,
      cost_of_equity: derivedValue({
        value: round(costOfEquityValue, 8),
        formula: "risk_free_rate + equity_risk_premium",
        sources: ["macro/fred-banking-daily.json:series.DGS10", "damodaran/erp.json:us_erp"],
        notes: ["US proxy inputs use the same US risk-free and ERP policy as SPX/NDX."],
      }),
    },
    forecast_grid_v1: buildForecastGrid(
      indexConfig,
      benchmarkRow,
      context.stockActionPayload,
      payoutRatio,
      costOfEquityValue,
      explicitEpsGrowth3y,
      {
        currentSpot: context.spot?.value,
        indexRows: joined.indexRows,
        denominatorRows: joined.denominatorRows,
        indexKey: joined.indexKey,
        sourceRefs: ["computed/stock_action_index.json", proxyConfig.source],
        publicStatus: "proxy_input_only_no_fair_value_exact_index_blocked",
        indexDiagnostics: diagnostic,
        notes: [
          "This forecast grid is nested under proxy_inputs_v1 and must not be treated as public-ready exact index output.",
          "SOX top-level output must use Nasdaq GIW constituents or another verified index source; ETF proxy holdings are never exact index weights.",
        ],
      },
    ),
    blockers: [
      {
        code: "proxy_not_exact_index_constituents",
        severity: "public_blocker",
      },
      ...indexConfig.blockers.map((code) => ({
        code,
        severity: "public_blocker",
      })),
    ],
    notes: [
      "Proxy inputs are scenario diagnostics only; top-level exact payout_ratio and explicit_eps_growth_3y remain blocked.",
      ...proxyConfig.notes,
    ],
  };
}

function buildForecastGrid(
  indexConfig,
  benchmarkRow,
  stockActionPayload,
  payoutRatioField,
  costOfEquityValue,
  explicitEpsGrowth3yField,
  {
    currentSpot = null,
    indexRows = null,
    denominatorRows = null,
    indexKey = indexConfig.slickchartsIndex,
    sourceRefs = ["computed/stock_action_index.json"],
    publicStatus = "ready_inputs_only_no_fair_value",
    indexDiagnostics = null,
    payoutFormula = "stock_action_index_weighted_dividend_yield / benchmark_earnings_yield",
    forecastAvailabilityAsOf = null,
    exactSpotAsOf = null,
    notes = [],
  } = {},
) {
  const rowsForGrid = indexRows ?? stockActionRowsForIndex(stockActionPayload, indexKey);
  const metricOptions = denominatorRows ? { denominatorRows } : {};
  const fy1Growth = weightedMetric(rowsForGrid, (row) => {
    const value = numberOrNull(row?.estimateSnapshot?.epsGrowth?.fy1);
    return finite(value) ? value / 100 : null;
  }, metricOptions);
  const fy12Growth = weightedMetric(rowsForGrid, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy2 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy2);
    return finite(fy1) && fy1 > 0 && finite(fy2) && fy2 > 0 ? (fy2 / fy1) - 1 : null;
  }, metricOptions);
  const fy23Growth = weightedMetric(rowsForGrid, (row) => {
    const fy2 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy2);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy2) && fy2 > 0 && finite(fy3) && fy3 > 0 ? (fy3 / fy2) - 1 : null;
  }, metricOptions);
  const weightedRoe = {
    fy1: weightedMetric(rowsForGrid, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy1);
      return finite(value) ? value / 100 : null;
    }, metricOptions),
    fy2: weightedMetric(rowsForGrid, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy2);
      return finite(value) ? value / 100 : null;
    }, metricOptions),
    fy3: weightedMetric(rowsForGrid, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy3);
      return finite(value) ? value / 100 : null;
    }, metricOptions),
  };
  const payoutRatio = payoutRatioField?.value === null || payoutRatioField?.value === undefined
    ? null
    : numberOrNull(payoutRatioField.value);
  // No clamp. `Math.max(0, 1 - payout)` used to publish retention 0 alongside a
  // formula string that said "1 - payout_ratio", so a payout above 1 silently
  // froze the book roll-forward instead of shrinking the book. A payout above 1
  // is a real state -- the index distributes more than it earns -- and the
  // arithmetic below is now exactly what the published formula claims.
  const retentionRatio = finite(payoutRatio) ? 1 - payoutRatio : null;
  const price = numberOrNull(currentSpot);
  const costOfEquity = numberOrNull(costOfEquityValue);
  const canonicalPegGrowth = numberOrNull(explicitEpsGrowth3yField?.value);
  let beginningBook = finite(price) ? price / benchmarkRow.px_to_book_ratio : null;
  let earningsProxy = benchmarkRow.best_eps;
  const periods = [
    {
      period: "fy1",
      growth: fy1Growth,
      growthFormula: "weighted_average(stock_action.estimateSnapshot.epsGrowth.fy1) / 100",
      derivationDepth: "source_anchored_or_one_step",
      sourceConfidence: "source_snapshot_base_effect_sensitive",
      growthBasis: "source_reported_eps_growth_snapshot",
      growthUsage: "context_only_not_earnings_roll_forward",
      growthNotes: [
        "FY1 eps_growth is the source-reported analyst growth snapshot; it is base-effect sensitive and is not applied to the FY1 earnings_proxy anchor.",
      ],
    },
    {
      period: "fy2",
      growth: fy12Growth,
      growthFormula: "weighted_average((forward_eps_fy2 / forward_eps_fy1) - 1)",
      derivationDepth: "chained_roll_forward",
      sourceConfidence: "compounded_derived",
      growthBasis: "forward_eps_ratio",
      growthUsage: "earnings_path_roll_forward",
      growthNotes: ["Forward EPS ratio used to roll the prior earnings_proxy into this period."],
    },
    {
      period: "fy3",
      growth: fy23Growth,
      growthFormula: "weighted_average((forward_eps_fy3 / forward_eps_fy2) - 1)",
      derivationDepth: "chained_roll_forward",
      sourceConfidence: "compounded_derived",
      growthBasis: "forward_eps_ratio",
      growthUsage: "earnings_path_roll_forward",
      growthNotes: ["Forward EPS ratio used to roll the prior earnings_proxy into this period."],
    },
  ];
  const rows = [];
  for (const item of periods) {
    if (item.period === "fy2" && finite(item.growth.value)) earningsProxy *= (1 + item.growth.value);
    if (item.period === "fy3" && finite(item.growth.value)) earningsProxy *= (1 + item.growth.value);
    const endingBook = finite(retentionRatio) ? beginningBook + earningsProxy * retentionRatio : null;
    const roeBeginning = beginningBook > 0 ? earningsProxy / beginningBook : null;
    const peRatio = earningsProxy > 0 ? price / earningsProxy : null;
    const pegRatio = finite(canonicalPegGrowth) && canonicalPegGrowth > 0 ? peRatio / (canonicalPegGrowth * 100) : null;
    const residualIncomeProxy = finite(roeBeginning) && finite(costOfEquity)
      ? (roeBeginning - costOfEquity) * beginningBook
      : null;
    rows.push({
      period: item.period,
      derivation_depth: item.derivationDepth,
      source_confidence: item.sourceConfidence,
      growth_basis: item.growthBasis,
      growth_usage: item.growthUsage,
      earnings_proxy: formulaValue({
        value: round(earningsProxy, 4),
        formula: item.period === "fy1" ? "benchmark_best_eps_anchor" : "prior_period_earnings_proxy * (1 + weighted_forward_eps_growth)",
        sources: [indexConfig.benchmarkFile, ...sourceRefs],
        notes: item.period === "fy1"
          ? ["FY1 row anchors to benchmark_best_eps; row eps_growth is context-only and not multiplied into earnings_proxy."]
          : ["Row eps_growth is applied before this period's earnings_proxy is calculated."],
      }),
      eps_growth: formulaValue({
        value: round(item.growth.value, 6),
        formula: item.growthFormula,
        sources: sourceRefs,
        coverage: item.growth,
        notes: item.growthNotes,
      }),
      book_value_beginning: formulaValue({
        value: round(beginningBook, 4),
        formula: item.period === "fy1" ? "current_price / benchmark_px_to_book_ratio" : "prior_period_book_value_ending",
        sources: item.period === "fy1"
          ? ["observed.price", "observed.price_to_book"]
          : ["prior_period"],
      }),
      book_value_ending: formulaValue({
        value: round(endingBook, 4),
        formula: "book_value_beginning + earnings_proxy * (1 - payout_ratio)",
        sources: ["forecast_grid_v1.earnings_proxy", "derived.payout_ratio"],
      }),
      roe_on_beginning_book: formulaValue({
        value: round(roeBeginning, 6),
        formula: "earnings_proxy / book_value_beginning",
        sources: ["forecast_grid_v1.earnings_proxy", "forecast_grid_v1.book_value_beginning"],
      }),
      stock_action_weighted_roe: formulaValue({
        value: round(weightedRoe[item.period].value, 6),
        formula: `weighted_average(stock_action.profitabilitySnapshot.roe.${item.period}) / 100`,
        sources: sourceRefs,
        coverage: weightedRoe[item.period],
      }),
      payout_ratio: formulaValue({
        value: round(payoutRatio, 6),
        formula: payoutFormula,
        sources: ["derived.payout_ratio"],
      }),
      retention_ratio: formulaValue({
        value: round(retentionRatio, 6),
        formula: "1 - payout_ratio",
        sources: ["forecast_grid_v1.payout_ratio"],
      }),
      dividend_yield_implied: formulaValue({
        value: round(finite(payoutRatio) ? payoutRatio * (earningsProxy / price) : null, 8),
        formula: "payout_ratio * (earnings_proxy / current_price)",
        sources: ["forecast_grid_v1.payout_ratio", "forecast_grid_v1.earnings_proxy", "observed.price"],
      }),
      pe_ratio: formulaValue({
        value: round(peRatio, 4),
        formula: "current_price / earnings_proxy",
        sources: ["observed.price", "forecast_grid_v1.earnings_proxy"],
      }),
      peg_ratio: formulaValue({
        value: round(pegRatio, 4),
        formula: "pe_ratio / (derived.explicit_eps_growth_3y * 100)",
        sources: ["forecast_grid_v1.pe_ratio", "derived.explicit_eps_growth_3y"],
        notes: ["Canonical PEG denominator uses explicit_eps_growth_3y; row eps_growth remains path-growth context."],
      }),
      residual_income_proxy: formulaValue({
        value: round(residualIncomeProxy, 4),
        formula: "(roe_on_beginning_book - cost_of_equity) * book_value_beginning",
        sources: ["forecast_grid_v1.roe_on_beginning_book", "derived.cost_of_equity", "forecast_grid_v1.book_value_beginning"],
        notes: [
          "Operand of derived.valuation_range_v1; the field name and formula are unchanged.",
          "It feeds a two-endpoint assumption band only. No single index value is emitted from it.",
        ],
      }),
    });
    if (finite(endingBook)) beginningBook = endingBook;
  }
  return {
    schema_version: "forecast_grid_v1",
    public_status: publicStatus,
    periods: rows,
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      stock_action_generated_at: stockActionPayload?.generated_at ?? null,
      ...(forecastAvailabilityAsOf ? { availability_as_of: forecastAvailabilityAsOf } : {}),
      ...(exactSpotAsOf ? { exact_spot_as_of: exactSpotAsOf } : {}),
      index_key: indexKey,
      index_diagnostics: indexDiagnostics ?? stockActionIndexDiagnostics(stockActionPayload, indexKey),
    },
    notes: [
      "Forecast grid is a source-tiered input grid, not a target price or fair-value output.",
      "FY labels are stock_action forward estimate buckets; calendar-year labels require a separate reporting-period contract.",
      "PEG uses derived.explicit_eps_growth_3y as the canonical growth denominator.",
      "FY1 eps_growth is a source-reported context snapshot and is not used to roll earnings_proxy; FY2/FY3 eps_growth values are forward-EPS roll-forward ratios.",
      ...notes,
    ],
  };
}

function directPositiveNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function inspectCcmpDirectForecastFields(benchmarkRow, spotAsOf, generatedAt) {
  const optionalFields = ["best_eps_fy2", "best_eps_fy3", "best_eps_asof"];
  const missing = optionalFields.filter((key) => !Object.hasOwn(benchmarkRow, key));
  if (missing.length > 0) {
    return {
      ok: false,
      code: "ccmp_direct_forecast_fields_missing",
      reason: `CCMP direct forecast requires best_eps_fy2, best_eps_fy3, and best_eps_asof together; missing ${missing.join(", ")}`,
    };
  }

  if (!directPositiveNumber(benchmarkRow.best_eps_fy2)
    || !directPositiveNumber(benchmarkRow.best_eps_fy3)) {
    return {
      ok: false,
      code: "ccmp_direct_forecast_fields_invalid",
      reason: "CCMP direct FY2/FY3 EPS must be positive finite numeric Bloomberg fields; N-A, null, strings, and non-positive values are rejected",
    };
  }
  const asOf = benchmarkRow.best_eps_asof;
  if (!isRealCalendarDate(asOf)) {
    return {
      ok: false,
      code: "ccmp_direct_forecast_asof_invalid",
      reason: `CCMP best_eps_asof must be a real calendar date; got ${String(asOf)}`,
    };
  }
  const generatedDate = String(generatedAt ?? "").slice(0, 10);
  if (!isRealCalendarDate(generatedDate)
    || asOf > benchmarkRow.date
    || asOf > spotAsOf
    || asOf > generatedDate) {
    return {
      ok: false,
      code: "ccmp_direct_forecast_asof_invalid",
      reason: `CCMP best_eps_asof ${asOf} must be no later than benchmark ${benchmarkRow.date}, exact spot ${spotAsOf}, and generated ${generatedDate}`,
    };
  }

  const epsFy1 = benchmarkRow.best_eps;
  const growths = [
    { label: "FY1→FY2", value: benchmarkRow.best_eps_fy2 / epsFy1 },
    { label: "FY2→FY3", value: benchmarkRow.best_eps_fy3 / benchmarkRow.best_eps_fy2 },
  ].map((item) => ({ ...item, growth: item.value - 1 }));
  const outOfGate = growths.find((item) => (
    !Number.isFinite(item.growth)
    || item.growth < CCMP_DIRECT_EPS_MIN_GROWTH
    || item.growth > CCMP_DIRECT_EPS_MAX_GROWTH
  ));
  if (outOfGate) {
    return {
      ok: false,
      code: "ccmp_direct_forecast_fields_out_of_gate",
      reason: `CCMP direct EPS ${outOfGate.label} growth ${outOfGate.growth} is outside [${CCMP_DIRECT_EPS_MIN_GROWTH}, ${CCMP_DIRECT_EPS_MAX_GROWTH}]`,
    };
  }

  return {
    ok: true,
    epsFy1,
    epsFy2: benchmarkRow.best_eps_fy2,
    epsFy3: benchmarkRow.best_eps_fy3,
    asOf,
    growthFy1Fy2: growths[0].growth,
    growthFy2Fy3: growths[1].growth,
    sourceFields: {
      fy1: "best_eps",
      fy2: "best_eps_fy2",
      fy3: "best_eps_fy3",
      asOf: "best_eps_asof",
    },
  };
}

function blockedCcmpForecastGrid(reason, source = "benchmarks/us.json") {
  return {
    schema_version: "forecast_grid_v1",
    public_status: "blocked_missing_direct_forecast",
    source_tier: "blocked_missing_source",
    periods: [],
    coverage: {
      source: source,
      source_tier: "blocked_missing_source",
      availability_status: "blocked",
    },
    reason,
    notes: [
      "CCMP forecast output is fail-closed until direct converter FY2/FY3 EPS levels and best_eps_asof pass the builder gates.",
      "No EPS extrapolation, interpolation, proxy, or constituent methodology is used.",
    ],
  };
}

function ccmpDirectFormulaValue({
  value,
  formula,
  sources,
  sourceTier = "derived_formula",
  asOf = null,
  notes = [],
}) {
  const field = formulaValue({ value, formula, sources, sourceTier, notes });
  if (asOf) field.as_of = asOf;
  return field;
}

function ccmpDirectEpsValue({ value, sourceField, asOf, benchmarkFile }) {
  const field = ccmpDirectFormulaValue({
    value,
    formula: `benchmark_${sourceField}_direct`,
    sources: [`${benchmarkFile}:sections.nasdaq_composite.data[-1].${sourceField}`],
    sourceTier: "observed_source",
    asOf,
    notes: ["Direct Nasdaq Composite benchmark EPS level; no constituent-weight methodology or EPS roll-forward is applied."],
  });
  field.source = benchmarkFile;
  field.source_field = `sections.nasdaq_composite.data[-1].${sourceField}`;
  field.availability_status = "available";
  field.availability_as_of = asOf;
  return field;
}

function buildCcmpDirectForecastGrid(indexConfig, benchmarkRow, directForecast, payoutRatioField, costOfEquityValue, currentSpot, explicitGrowthField) {
  const price = numberOrNull(currentSpot);
  const payoutRatio = numberOrNull(payoutRatioField?.value);
  const costOfEquity = numberOrNull(costOfEquityValue);
  const explicitGrowth = numberOrNull(explicitGrowthField?.value);
  const epsLevels = [directForecast.epsFy1, directForecast.epsFy2, directForecast.epsFy3];
  const growths = [null, directForecast.growthFy1Fy2, directForecast.growthFy2Fy3];
  const rows = [];
  let beginningBook = finite(price) ? price / benchmarkRow.px_to_book_ratio : null;

  for (const [index, period] of ["fy1", "fy2", "fy3"].entries()) {
    const earnings = epsLevels[index];
    const endingBook = finite(beginningBook) && finite(payoutRatio)
      ? beginningBook + earnings * (1 - payoutRatio)
      : null;
    const roeBeginning = finite(beginningBook) && beginningBook > 0 ? earnings / beginningBook : null;
    const peRatio = finite(price) && earnings > 0 ? price / earnings : null;
    const pegRatio = finite(explicitGrowth) && explicitGrowth > 0 ? peRatio / (explicitGrowth * 100) : null;
    const residualIncomeProxy = finite(roeBeginning) && finite(costOfEquity)
      ? (roeBeginning - costOfEquity) * beginningBook
      : null;
    const growth = growths[index];
    rows.push({
      period,
      derivation_depth: "source_anchored_direct",
      source_confidence: "direct_benchmark_snapshot",
      growth_basis: index === 0 ? "not_published" : "direct_forward_eps_ratio",
      growth_usage: index === 0 ? "context_only_not_earnings_roll_forward" : "direct_eps_level_path",
      earnings_proxy: ccmpDirectEpsValue({
        value: earnings,
        sourceField: directForecast.sourceFields[["fy1", "fy2", "fy3"][index]],
        asOf: directForecast.asOf,
        benchmarkFile: indexConfig.benchmarkFile,
      }),
      eps_growth: ccmpDirectFormulaValue({
        value: growth,
        formula: index === 0
          ? "direct_benchmark_eps_fy1_growth_not_published"
          : `direct_benchmark_eps_fy${index}_to_fy${index + 1} / direct_benchmark_eps_fy${index}`,
        sources: [
          `${indexConfig.benchmarkFile}:sections.nasdaq_composite.data[-1].best_eps`,
          `${indexConfig.benchmarkFile}:sections.nasdaq_composite.data[-1].best_eps_fy2`,
          `${indexConfig.benchmarkFile}:sections.nasdaq_composite.data[-1].best_eps_fy3`,
        ],
        asOf: directForecast.asOf,
        notes: index === 0
          ? ["The converter does not publish a separate FY1 growth field; no FY1 growth is inferred."]
          : ["Growth is calculated only from the direct benchmark EPS levels supplied for the adjacent periods."],
      }),
      book_value_beginning: ccmpDirectFormulaValue({
        value: round(beginningBook, 4),
        formula: index === 0 ? "current_price / benchmark_px_to_book_ratio" : "prior_period_book_value_ending",
        sources: index === 0 ? ["observed.price", "observed.price_to_book"] : ["prior_period"],
      }),
      book_value_ending: ccmpDirectFormulaValue({
        value: round(endingBook, 4),
        formula: "book_value_beginning + earnings_proxy * (1 - payout_ratio)",
        sources: ["forecast_grid_v1.earnings_proxy", "derived.payout_ratio"],
      }),
      roe_on_beginning_book: ccmpDirectFormulaValue({
        value: round(roeBeginning, 6),
        formula: "earnings_proxy / book_value_beginning",
        sources: ["forecast_grid_v1.earnings_proxy", "forecast_grid_v1.book_value_beginning"],
      }),
      direct_index_roe: ccmpDirectFormulaValue({
        value: round(roeBeginning, 6),
        formula: "earnings_proxy / book_value_beginning",
        sources: ["forecast_grid_v1.earnings_proxy", "forecast_grid_v1.book_value_beginning"],
        notes: ["Direct-index implied ROE is disclosed separately; no constituent-weight ROE is substituted."],
      }),
      payout_ratio: ccmpDirectFormulaValue({
        value: round(payoutRatio, 12),
        formula: "derived.payout_ratio",
        sources: ["derived.payout_ratio"],
      }),
      retention_ratio: ccmpDirectFormulaValue({
        value: round(finite(payoutRatio) ? 1 - payoutRatio : null, 12),
        formula: "1 - payout_ratio",
        sources: ["forecast_grid_v1.payout_ratio"],
      }),
      dividend_yield_implied: ccmpDirectFormulaValue({
        value: round(finite(payoutRatio) && finite(price) ? payoutRatio * (earnings / price) : null, 12),
        formula: "payout_ratio * (earnings_proxy / current_price)",
        sources: ["forecast_grid_v1.payout_ratio", "forecast_grid_v1.earnings_proxy", "observed.price"],
      }),
      pe_ratio: ccmpDirectFormulaValue({
        value: round(peRatio, 4),
        formula: "current_price / earnings_proxy",
        sources: ["observed.price", "forecast_grid_v1.earnings_proxy"],
      }),
      peg_ratio: ccmpDirectFormulaValue({
        value: round(pegRatio, 4),
        formula: "pe_ratio / (derived.explicit_eps_growth_3y * 100)",
        sources: ["forecast_grid_v1.pe_ratio", "derived.explicit_eps_growth_3y"],
      }),
      residual_income_proxy: ccmpDirectFormulaValue({
        value: round(residualIncomeProxy, 4),
        formula: "(roe_on_beginning_book - cost_of_equity) * book_value_beginning",
        sources: ["forecast_grid_v1.roe_on_beginning_book", "derived.cost_of_equity", "forecast_grid_v1.book_value_beginning"],
      }),
    });
    if (finite(endingBook)) beginningBook = endingBook;
  }

  return {
    schema_version: "forecast_grid_v1",
    public_status: "ready_inputs_only_no_fair_value",
    source_tier: "direct_index_source",
    periods: rows,
    coverage: {
      source: indexConfig.benchmarkFile,
      source_tier: "direct_index_source",
      availability_status: "available",
      benchmark_as_of: benchmarkRow.date,
      best_eps_asof: directForecast.asOf,
      exact_spot_as_of: null,
      direct_fields: [
        "best_eps",
        "best_eps_fy2",
        "best_eps_fy3",
        "best_eps_asof",
      ],
      index_diagnostics: {
        index_id: "CCMP",
        index_key: "nasdaq_composite_direct_snapshot",
        source_tier: "observed_source",
        source: indexConfig.benchmarkFile,
        benchmark_as_of: benchmarkRow.date,
        best_eps_asof: directForecast.asOf,
        direct_fields: [
          "best_eps",
          "best_eps_fy2",
          "best_eps_fy3",
          "best_eps_asof",
        ],
      },
    },
    notes: [
      "CCMP FY1/FY2/FY3 earnings levels are direct converter benchmark fields; no extrapolation or constituent-weight methodology is used.",
      "Book, payout, retention, cost-of-equity, and residual-income formulas remain the canonical formulas.",
    ],
  };
}

function deriveCcmpMeasuredPayout(macroPayload, spot, benchmarkRow) {
  const measured = deriveTrailingIndexDividendYield({
    totalReturnRows: macroPayload?.series?.[CCMP_TOTAL_RETURN_SERIES],
    priceReturnRows: macroPayload?.series?.[CCMP_PRICE_RETURN_SERIES],
    asOf: spot.asOf,
    maximumYield: MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD,
    totalReturnSeriesId: CCMP_TOTAL_RETURN_SERIES,
    priceReturnSeriesId: CCMP_PRICE_RETURN_SERIES,
    provider: "FRED (Nasdaq, Inc.)",
  });
  if (!measured.ok) return measured;
  if (measured.date !== spot.asOf
    || measured.source_clocks?.used_observation !== spot.asOf
    || measured.source_clocks?.all_used_inputs_at_or_before !== spot.asOf) {
    return {
      ok: false,
      code: "ccmp_fred_spot_date_mismatch",
      reason: `CCMP FRED measured yield must use an exact aligned observation on spot as_of ${spot.asOf}; used ${measured.date}`,
    };
  }
  const futureClock = Object.entries(measured.source_clocks ?? {})
    .find(([, value]) => isRealCalendarDate(value) && value > spot.asOf);
  if (futureClock) {
    return {
      ok: false,
      code: "ccmp_fred_future_source_clock",
      reason: `CCMP FRED source clock ${futureClock[0]}=${futureClock[1]} is after exact spot as_of ${spot.asOf}`,
    };
  }
  const payout = dividendYieldToPayout({
    dividendYield: measured.value,
    price: spot.value,
    epsFy1: benchmarkRow.best_eps,
    maximumYield: MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD,
    maximumPayout: 1,
  });
  if (!payout.ok) return payout;
  return { ok: true, measured, payout };
}

function buildCcmpPayoutRatio(indexConfig, benchmarkRow, spot, context) {
  const result = deriveCcmpMeasuredPayout(context.macroPayload, spot, benchmarkRow);
  if (!result.ok) {
    return {
      result,
      field: blockedValue({
        reason: `CCMP FRED measured index yield unavailable: ${result.reason}`,
        sourceTier: "blocked_missing_source",
      }),
    };
  }
  const { measured, payout } = result;
  const field = derivedValue({
    value: payout.value,
    formula: "trailing_measured_index_dividend_yield * exact_spot / benchmark_best_eps",
    sources: [
      `macro/fred-banking-daily.json:series.${CCMP_TOTAL_RETURN_SERIES}`,
      `macro/fred-banking-daily.json:series.${CCMP_PRICE_RETURN_SERIES}`,
      "observed.price",
      "observed.forward_eps",
    ],
    coverage: {
      availability_status: "available",
      availability_as_of: measured.first_knowable_at,
      dividend_yield: measured.value,
      dividend_yield_unit: measured.unit,
      dividend_yield_as_of: measured.date,
      dividend_yield_source: measured.source,
      dividend_yield_formula: measured.formula,
      dividend_yield_tier: measured.tier,
      dividend_yield_first_knowable_at: measured.first_knowable_at,
      source_clocks: measured.source_clocks,
      exact_spot_as_of: spot.asOf,
      exact_spot_value: spot.value,
      benchmark_as_of: benchmarkRow.date,
      benchmark_eps_fy1: benchmarkRow.best_eps,
      benchmark_earnings_yield_on_exact_spot: benchmarkRow.best_eps / spot.value,
      payout_formula: payout.formula,
      payout_basis: payout.basis,
    },
    notes: [
      "Measured trailing Nasdaq Composite yield is derived from exact-date aligned FRED price-return and total-return series.",
      "Payout uses the exact ^IXIC→CCMP spot as_of and benchmark FY1 EPS; no ETF, proxy, or constituent fallback is used.",
    ],
  });
  field.availability_status = "available";
  field.availability_as_of = measured.first_knowable_at;
  return { result, field };
}

function buildCcmpExplicitEpsGrowth(benchmarkRow, directForecast) {
  if (!directForecast.ok) {
    return blockedValue({
      reason: directForecast.reason,
      sourceTier: "blocked_missing_source",
    });
  }
  return derivedValue({
    value: (directForecast.epsFy3 / directForecast.epsFy1) ** (1 / 2) - 1,
    formula: "((benchmark_best_eps_fy3 / benchmark_best_eps_fy1)^(1/2)) - 1",
    sources: [
      "benchmarks/us.json:sections.nasdaq_composite.data[-1].best_eps",
      "benchmarks/us.json:sections.nasdaq_composite.data[-1].best_eps_fy2",
      "benchmarks/us.json:sections.nasdaq_composite.data[-1].best_eps_fy3",
    ],
    coverage: {
      source_tier: "direct_index_source",
      availability_status: "available",
      availability_as_of: directForecast.asOf,
      benchmark_as_of: benchmarkRow.date,
      best_eps_asof: directForecast.asOf,
      eps_fy1: directForecast.epsFy1,
      eps_fy2: directForecast.epsFy2,
      eps_fy3: directForecast.epsFy3,
    },
    notes: ["Direct benchmark EPS levels only; no constituent-weight growth or extrapolation is used."],
  });
}

function buildCcmpIndex(indexConfig, context, benchmarkRow, spot, observed, baseBlockers, baseWarnings = []) {
  const dgs10 = context.dgs10;
  const usErp = context.usErp;
  const ccmpPayout = buildCcmpPayoutRatio(indexConfig, benchmarkRow, spot, context);
  const directForecast = inspectCcmpDirectForecastFields(benchmarkRow, spot.asOf, context.generatedAt);
  const explicitEpsGrowth3y = buildCcmpExplicitEpsGrowth(benchmarkRow, directForecast);
  const blockers = [...baseBlockers];

  if (!ccmpPayout.result.ok) {
    blockers.push({
      code: "ccmp_measured_index_yield_unavailable",
      severity: "lane_degraded",
      source: `macro/fred-banking-daily.json:series.${CCMP_TOTAL_RETURN_SERIES}/${CCMP_PRICE_RETURN_SERIES}`,
      reason: ccmpPayout.result.reason,
    });
  }
  if (!directForecast.ok) {
    blockers.push({
      code: directForecast.code,
      severity: "lane_degraded",
      source: `${indexConfig.benchmarkFile}:sections.${indexConfig.benchmarkSection}`,
      reason: directForecast.reason,
    });
  }
  if (!dgs10) {
    blockers.push({
      code: "risk_free_rate_source_missing",
      severity: "lane_degraded",
      source: "macro/fred-banking-daily.json:series.DGS10",
    });
  }
  if (!usErp) {
    blockers.push({
      code: "equity_risk_premium_source_missing",
      severity: "lane_degraded",
      source: "damodaran/erp.json:us_erp",
    });
  }

  if (dgs10) {
    observed.risk_free_rate = observedValue({
      value: dgs10.value,
      source: "macro/fred-banking-daily.json",
      sourceField: "series.DGS10[-1].value / 100",
      asOf: dgs10.date,
      label: "US 10Y Treasury",
    });
    observed.risk_free_rate.availability_status = "available";
    observed.risk_free_rate.availability_as_of = dgs10.date;
  } else {
    observed.risk_free_rate = blockedValue({
      reason: "US DGS10 is unavailable; CCMP does not reuse a non-US or proxy rate.",
    });
    observed.risk_free_rate.availability_status = "blocked";
  }
  if (usErp) {
    observed.equity_risk_premium = observedValue({
      value: usErp.value,
      source: "damodaran/erp.json",
      sourceField: "us_erp",
      asOf: usErp.source_date,
      label: "Damodaran US ERP",
    });
    observed.equity_risk_premium.availability_status = "available";
    observed.equity_risk_premium.availability_as_of = usErp.source_date;
  } else {
    observed.equity_risk_premium = blockedValue({
      reason: "Damodaran US ERP is unavailable; CCMP does not reuse a proxy or house premium.",
    });
    observed.equity_risk_premium.availability_status = "blocked";
  }

  const costOfEquityValue = dgs10 && usErp ? dgs10.value + usErp.value : null;
  const costOfEquity = finite(costOfEquityValue)
    ? derivedValue({
      value: round(costOfEquityValue, 8),
      formula: "risk_free_rate + equity_risk_premium",
      sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
      notes: ["CCMP uses the same US DGS10 plus Damodaran US ERP policy as US indices; no house premium adjustment is included."],
    })
    : blockedValue({ reason: "CCMP cost of equity requires both US DGS10 and Damodaran US ERP." });

  const forecastGrid = directForecast.ok && ccmpPayout.result.ok && finite(costOfEquityValue)
    ? buildCcmpDirectForecastGrid(
      indexConfig,
      benchmarkRow,
      directForecast,
      ccmpPayout.field,
      costOfEquityValue,
      spot.value,
      explicitEpsGrowth3y,
    )
    : blockedCcmpForecastGrid(
      directForecast.ok
        ? "CCMP direct forecast is blocked until measured payout and US cost of equity are available."
        : directForecast.reason,
      indexConfig.benchmarkFile,
    );
  forecastGrid.coverage.exact_spot_as_of = spot.asOf;

  return {
    id: indexConfig.id,
    label: indexConfig.label,
    role: "secondary_input_only",
    public_status: blockers.length === 0 && forecastGrid.periods.length === 3
      ? "ready_inputs_and_forecast_grid"
      : "input_only_ccmp_direct_with_caveats",
    observed: {
      ...observed,
      risk_free_rate: observed.risk_free_rate,
      equity_risk_premium: observed.equity_risk_premium,
    },
    derived: {
      book_value: buildBookValue(benchmarkRow, spot.value),
      payout_ratio: ccmpPayout.field,
      explicit_eps_growth_3y: explicitEpsGrowth3y,
      cost_of_equity: costOfEquity,
      forecast_grid_v1: forecastGrid,
    },
    assumptions: {},
    blockers,
    warnings: [...baseWarnings],
  };
}

function buildForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
  dataRootForReads = dataRoot,
) {
  const holdingsSource = `slickcharts/${indexConfig.slickchartsIndex}.json`;
  const holdingsPayload = readDataJson(holdingsSource, dataRootForReads);
  if (!Array.isArray(holdingsPayload?.holdings)) {
    throw new Error(`${holdingsSource}: holdings must be an array`);
  }
  if (holdingsPayload.holdings.length === 0) {
    throw new LaneUnavailableError(`${holdingsSource}: holdings are empty`, holdingsSource);
  }
  const holdings = holdingsPayload.holdings;
  const bySymbol = stockActionBySymbol(stockActionPayload);
  let totalWeight = 0;
  let coveredWeight = 0;
  let weightedCagr = 0;
  let coveredRows = 0;
  const missingSample = [];
  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? "").toUpperCase();
    const weight = numberOrNull(holding?.weight);
    if (!symbol || !finite(weight) || weight <= 0) continue;
    totalWeight += weight;
    const row = bySymbol.get(symbol);
    const indexWeight = (row?.indexWeights ?? []).find((item) => item?.index === indexConfig.slickchartsIndex);
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    if (indexWeight && finite(fy1) && finite(fy3) && fy1 > 0 && fy3 > 0) {
      const cagr = Math.exp(Math.log(fy3 / fy1) / 2) - 1;
      coveredWeight += weight;
      weightedCagr += weight * cagr;
      coveredRows += 1;
    } else if (missingSample.length < 10) {
      missingSample.push(symbol);
    }
  }
  const coveredWeightRatio = totalWeight > 0 ? coveredWeight / totalWeight : null;
  const value = coveredWeight > 0 ? weightedCagr / coveredWeight : null;
  return derivedValue({
    value: round(value, 6),
    formula: "weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", `slickcharts/${indexConfig.slickchartsIndex}.json`],
    coverage: {
      total_weight: round(totalWeight, 4),
      covered_weight: round(coveredWeight, 4),
      covered_weight_ratio: round(coveredWeightRatio, 6),
      covered_rows: coveredRows,
      min_covered_weight_ratio: minCoveredWeight,
      missing_sample: missingSample,
    },
    notes: ["Not a live index-level consensus field; coverage-tagged derived input only."],
  });
}

function requireAvailableSource(value, source, unavailableSources = null) {
  if (value === null || value === undefined) {
    throw unavailableSources?.get(source)
      ?? new LaneUnavailableError(`${source}: source payload is unavailable`, source);
  }
  return value;
}

function unavailableIndex(indexConfig, error, { spot = null, generatedAt = null } = {}) {
  const reason = error?.message || `${indexConfig.id}: required source is unavailable`;
  const source = error?.source ?? null;
  const unavailable = () => blockedValue({ reason, sourceTier: "blocked_missing_source" });
  const primary = PRIMARY_INDICES.some((item) => item.id === indexConfig.id);
  const observed = {
    price: spot ? buildExactSpotObserved(indexConfig, spot, generatedAt) : unavailable(),
    benchmark_price: unavailable(),
    forward_eps: unavailable(),
    forward_pe: unavailable(),
    price_to_book: unavailable(),
    roe: unavailable(),
    risk_free_rate: unavailable(),
    equity_risk_premium: unavailable(),
  };
  const costOfEquity = unavailable();
  const forecastGrid = {
    schema_version: "forecast_grid_v1",
    public_status: primary
      ? "input_only_primary_with_caveats_no_fair_value"
      : "input_only_unavailable_no_fair_value",
    source_tier: "blocked_missing_source",
    reason,
    periods: [],
  };
  const blockers = [{
    code: "source_unavailable",
    severity: "lane_degraded",
    ...(source ? { source } : {}),
    reason,
  }];
  // An age-only SLA overrun keeps a valid last-known spot usable and disclosed.
  const warnings = [];
  if (spot) {
    const spotFreshness = observed.price.freshness;
    if (spotFreshness?.status === "refresh_recommended") {
      warnings.push({
        code: "spot_source_refresh_recommended",
        severity: "freshness_warning",
        source: indexConfig.spotFile,
        as_of: spot.asOf,
      });
    }
  }
  return {
    id: indexConfig.id,
    label: indexConfig.label,
    role: primary ? "primary_public_v1" : indexConfig.role,
    public_status: primary ? "input_only_primary_with_caveats" : "blocked_or_input_only",
    observed,
    derived: {
      book_value: unavailable(),
      payout_ratio: unavailable(),
      explicit_eps_growth_3y: unavailable(),
      cost_of_equity: costOfEquity,
      forecast_grid_v1: forecastGrid,
      // A primary index still reports WHY no band exists. Omitting the block
      // when sources vanish would make an unavailable lane look like a lane
      // that was never in scope for one.
      ...(primary
        ? {
          valuation_range_v1: buildValuationRange({
            indexConfig,
            observed,
            costOfEquity,
            forecastGrid,
            blockers,
          }),
        }
        : {}),
    },
    assumptions: {},
    blockers,
    warnings,
  };
}

function buildIndexWithAvailability(indexConfig, context, builder) {
  try {
    return builder(indexConfig, context);
  } catch (error) {
    if (error instanceof LaneUnavailableError) {
      return unavailableIndex(indexConfig, error, {
        spot: context.exactSpots?.get(indexConfig.id) ?? null,
        generatedAt: context.generatedAt,
      });
    }
    throw error;
  }
}

// A real calendar day, not a shape. The regex alone accepted 2026-02-31 and
// 2025-02-29, which then propagated into clock comparisons as if they were days.
export function isIsoDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year
    && probe.getUTCMonth() === month - 1
    && probe.getUTCDate() === day;
}

// A COMPLETE instant that is explicitly UTC, matched with the same rule the
// consumer applies. Date.parse alone accepts a bare day, a missing zone, and
// other partial forms, so `parseUtcInstant` used to let a day masquerade as an
// instant. `Z` and `+00:00`/`-00:00` are the same clock and providers use both
// -- SlickCharts emits `+00:00` -- but a real offset like `+09:00` is a
// different clock and is refused rather than silently shifted.
const STRICT_UTC_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)(Z|[+-]00:00)$/;

export function parseUtcInstant(value) {
  if (typeof value !== "string") return null;
  const match = STRICT_UTC_INSTANT.exec(value);
  if (!match) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  if (!isIsoDay(match[1])) return null;
  // Round-trip, so an impossible calendar date cannot become a clock.
  return new Date(ms).toISOString().slice(0, 10) === match[1] ? ms : null;
}

// The canonical published form. The provider's raw string is preserved beside
// it so normalisation never erases what the provider actually sent.
export function canonicalUtcInstant(value) {
  const ms = parseUtcInstant(value);
  return ms === null ? null : new Date(ms).toISOString();
}

export const INDEX_YIELD_COLLECTION_SLA_HOURS = 750;

// The ratified exception, enforced rather than described. The reconciliation
// provider publishes no economic observation date, so the collection time of the
// SAME fetch-and-parse response stands in for it -- but only while it is a real
// non-future UTC instant inside the provider's monthly delivery SLA, and only
// while it stays labelled as a collection time.
// ROUTE POLICY, derived from the provider evidence rather than read off the
// declared `kind`. A relabel that also edits the declared tuple stays internally
// coherent, so the tuple comparison alone cannot catch it; what cannot be made
// coherent is the provider's own record of whether it published an observation
// date. `index_yield_as_of`, `index_yield_as_of_reason`, and
// `index_yield_provenance.clock_kind` state that one fact three ways, and this
// checks that they agree before anything is allowed to claim `source_as_of`.
export function reconciliationClockPolicyFailures(coverage, generatedAt) {
  const failures = [];
  const provenance = coverage?.index_yield_provenance;
  if (!provenance || typeof provenance !== "object") {
    return ["reconciliation route publishes no clock provenance"];
  }
  if (typeof provenance.source_file !== "string" || !provenance.source_file.trim()) {
    failures.push("reconciliation clock provenance names no source file");
  }
  // The capability, not the payload, decides what this route may claim.
  const capability = clockRouteCapability("reconciliation.index_yield");
  const expectedKind = capability?.kinds?.[0] ?? "collected_at";
  if (capability?.publishes_observation_date === false
    && coverage?.index_yield_as_of !== null && coverage?.index_yield_as_of !== undefined) {
    failures.push(
      `reconciliation route carries a source date (${coverage.index_yield_as_of}) that its provider`
      + ` (${capability.provider}) does not publish`,
    );
  }
  if (provenance.clock_kind !== expectedKind) {
    failures.push(
      `reconciliation clock provenance claims ${provenance.clock_kind} while its provider can only supply ${expectedKind}`,
    );
  }
  const reason = coverage?.index_yield_as_of_reason;
  if (typeof reason !== "string" || !reason.trim()) {
    failures.push("reconciliation route must state why it carries no observation date");
  }
  {
    const evaluation = evaluateCollectionClock(coverage?.index_yield_collected_at, generatedAt, {
      sameResponse: provenance.same_response,
    });
    failures.push(...evaluation.failures);
  }
  return failures;
}

export function evaluateCollectionClock(collectedAt, generatedAt, { sameResponse } = {}) {
  const failures = [];
  const collectedMs = parseUtcInstant(collectedAt);
  const generatedMs = parseUtcInstant(generatedAt);
  if (sameResponse !== true) {
    failures.push("the collection time is not from the same fetch-and-parse response as the reconciled value");
  }
  if (collectedMs === null) {
    failures.push(`index yield collection time ${collectedAt ?? "(absent)"} is not a valid UTC timestamp`);
    return { failures, ageHours: null, day: null };
  }
  if (generatedMs !== null && collectedMs > generatedMs) {
    failures.push("index yield collection time is in the future");
  }
  const ageHours = generatedMs === null ? null : (generatedMs - collectedMs) / 3_600_000;
  if (finite(ageHours) && ageHours > INDEX_YIELD_COLLECTION_SLA_HOURS) {
    failures.push(
      `index yield collection is ${Math.round(ageHours)}h old, beyond the`
      + ` ${INDEX_YIELD_COLLECTION_SLA_HOURS}h provider delivery SLA`,
    );
  }
  const day = new Date(collectedMs).toISOString().slice(0, 10);
  return { failures, ageHours, day: isIsoDay(day) ? day : null };
}

function rangeGate(passed, reason) {
  return { passed, reason: passed ? "" : reason };
}

// Normalised by the larger magnitude so the metric does not depend on which
// route is called the reference, and does not explode when one route is small.
export function payoutRouteDivergence(indexWeighted, indexLevel) {
  if (!finite(indexWeighted) || !finite(indexLevel)) return null;
  const scale = Math.max(Math.abs(indexWeighted), Math.abs(indexLevel));
  return scale > 0 ? Math.abs(indexWeighted - indexLevel) / scale : null;
}

export function retentionRouteDivergence(indexWeighted, indexLevel) {
  if (!finite(indexWeighted) || !finite(indexLevel)) return null;
  const scale = Math.max(Math.abs(1 - indexWeighted), Math.abs(1 - indexLevel));
  return scale > 0 ? Math.abs(indexWeighted - indexLevel) / scale : null;
}

// Value AT THE TERMINAL PERIOD, not at t0. Residual income decays linearly to
// zero over `fadeYears` while growing at `growth`, so the excess return is gone
// by the end of the fade and nothing is capitalised into perpetuity.
function fadeContinuingValue(terminalResidualIncome, discountRate, growth, fadeYears) {
  let total = 0;
  for (let year = 1; year <= fadeYears; year += 1) {
    const surviving = 1 - year / fadeYears;
    total += (terminalResidualIncome * (1 + growth) ** year * surviving) / (1 + discountRate) ** year;
  }
  return total;
}

function perpetuityContinuingValue(terminalResidualIncome, discountRate, growth) {
  return (terminalResidualIncome * (1 + growth)) / (discountRate - growth);
}

// ONE implementation, used by the builder to emit and by the validator to
// recompute. A validator that only checks that the emitted fields agree with
// each other cannot tell a computed band from a typed-in one.
export function computeRimScenarioValues({
  bookValueBeginning,
  residualIncome,
  discountRate,
  terminalGrowthLow = TERMINAL_GROWTH_CONSERVATIVE,
  terminalGrowthHigh = TERMINAL_GROWTH_OPTIMISTIC,
  fadeYears = FADE_YEARS,
}) {
  const explicitPresentValue = residualIncome.reduce(
    (total, value, index) => total + value / (1 + discountRate) ** (index + 1),
    0,
  );
  const terminalResidualIncome = residualIncome.at(-1);
  const discountToToday = (1 + discountRate) ** residualIncome.length;
  const conservativeContinuingValue = fadeContinuingValue(
    terminalResidualIncome,
    discountRate,
    terminalGrowthLow,
    fadeYears,
  );
  const optimisticContinuingValue = perpetuityContinuingValue(
    terminalResidualIncome,
    discountRate,
    terminalGrowthHigh,
  );
  return {
    explicitPresentValue,
    conservativeContinuingValue,
    optimisticContinuingValue,
    conservative: bookValueBeginning + explicitPresentValue + conservativeContinuingValue / discountToToday,
    optimistic: bookValueBeginning + explicitPresentValue + optimisticContinuingValue / discountToToday,
  };
}

// The FIXED required clock inventory. Not "whatever happened to carry a date":
// a named list of every route the band depends on, main and reconciliation, each
// of which must resolve to a real day or the band does not publish. A clock that
// reports only the freshest layer hides the stale one underneath it, and a route
// silently omitted from the list is the same failure with no evidence left behind.
export const REQUIRED_MAIN_CLOCK_SOURCES = [
  "observed.price",
  "observed.forward_eps",
  "observed.price_to_book",
  "observed.risk_free_rate",
  "observed.equity_risk_premium",
  "computed/stock_action_index.json",
  "benchmark_row",
];
export const REQUIRED_RECONCILIATION_CLOCK_SOURCES = ["reconciliation.index_yield"];

export function collectRangeSourceClocks({ observed, forecastGrid, payoutRatio, legacyPayoutRatio, generatedAt }) {
  const entries = [];
  const push = (source, asOf, route, kind, extra = {}) => {
    entries.push({ source, route, kind, as_of: isIsoDay(asOf) ? asOf : null, ...extra });
  };
  for (const key of ["price", "forward_eps", "price_to_book", "risk_free_rate", "equity_risk_premium"]) {
    push(`observed.${key}`, observed?.[key]?.as_of, "main", "source_as_of");
  }
  push("computed/stock_action_index.json", forecastGrid?.coverage?.stock_action_source_date, "main", "source_as_of");
  push("benchmark_row", payoutRatio?.coverage?.benchmark_as_of, "main", "source_as_of");

  const coverage = legacyPayoutRatio?.coverage ?? {};
  const policyFailures = reconciliationClockPolicyFailures(coverage, generatedAt);
  // The KIND is the provider's capability. A payload cannot promote it.
  const reconciliationKind = clockRouteCapability("reconciliation.index_yield")?.kinds?.[0] ?? "collected_at";
  {
    const evaluation = evaluateCollectionClock(coverage.index_yield_collected_at, generatedAt, {
      sameResponse: coverage.index_yield_provenance?.same_response,
    });
    push(
      "reconciliation.index_yield",
      policyFailures.length === 0 ? evaluation.day : null,
      "reconciliation",
      reconciliationKind,
      {
        reason: coverage.index_yield_as_of_reason || "provider publishes no source date",
        collection_age_hours: finite(evaluation.ageHours) ? round(evaluation.ageHours, 2) : null,
        collection_sla_hours: INDEX_YIELD_COLLECTION_SLA_HOURS,
        clock_policy_failures: policyFailures,
      },
    );
  }
  return entries.sort((a, b) => {
    if (a.as_of && b.as_of) return a.as_of.localeCompare(b.as_of) || a.source.localeCompare(b.source);
    if (a.as_of) return -1;
    if (b.as_of) return 1;
    return a.source.localeCompare(b.source);
  });
}

export const REQUIRED_CLOCK_TUPLES = [
  ...REQUIRED_MAIN_CLOCK_SOURCES.map((source) => ({ source, route: "main" })),
  ...REQUIRED_RECONCILIATION_CLOCK_SOURCES.map((source) => ({ source, route: "reconciliation" })),
];

// ROUTE CAPABILITY ALLOWLIST -- the one piece of this contract that does not
// live in the payload.
//
// Deriving the expected clock kind from payload fields fails against a coherent
// forgery: edit index_yield_as_of, its reason, the provenance block, the clock
// tuple and the derived clock fields together and every cross-check agrees,
// because they are all the same mutable evidence. What a payload cannot edit is
// what the PROVIDER is capable of publishing. That is a property of the source,
// it is stated here in code, and a payload claiming a capability its provider
// does not have is rejected however self-consistent it is.
function deepFreeze(value) {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

// Deeply frozen: Object.freeze is shallow, so a plain freeze would still let
// anything push a kind onto one of these arrays at runtime.
export const CLOCK_ROUTE_CAPABILITIES = deepFreeze({
  "observed.price": { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  "observed.forward_eps": { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  "observed.price_to_book": { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  "observed.risk_free_rate": { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  "observed.equity_risk_premium": { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  "computed/stock_action_index.json": { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  benchmark_row: { route: "main", kinds: ["source_as_of"], publishes_observation_date: true },
  // SlickCharts index-yield: publishes a value and a fetch time, never an
  // economic observation date. Its clock can therefore ONLY ever be a
  // collection time, and no payload may promote it.
  "reconciliation.index_yield": {
    route: "reconciliation",
    kinds: ["collected_at"],
    publishes_observation_date: false,
    provider: "slickcharts index yield",
  },
});

export function clockRouteCapability(source) {
  return Object.hasOwn(CLOCK_ROUTE_CAPABILITIES, source) ? CLOCK_ROUTE_CAPABILITIES[source] : null;
}

export function rangeClockInventoryFailures(entries) {
  const failures = [];
  const seen = new Map();
  for (const row of entries) {
    const key = `${row?.source}|${row?.route}`;
    if (seen.has(key)) failures.push(`${row?.source} appears more than once on route ${row?.route}`);
    seen.set(key, row);
  }
  for (const { source, route } of REQUIRED_CLOCK_TUPLES) {
    const row = seen.get(`${source}|${route}`);
    if (!row) {
      failures.push(`${source} is missing from the ${route} clock inventory`);
      continue;
    }
    const capability = clockRouteCapability(source);
    if (!capability) failures.push(`${source} has no declared route capability`);
    else {
      if (capability.route !== route) failures.push(`${source} belongs to route ${capability.route}, not ${route}`);
      if (!capability.kinds.includes(row.kind)) {
        failures.push(
          `${source} declares clock kind ${row.kind}, which its provider cannot supply`
          + ` (allowed: ${capability.kinds.join(", ")})`,
        );
      }
    }
    if (Array.isArray(row.clock_policy_failures) && row.clock_policy_failures.length > 0) {
      failures.push(`${source}: ${row.clock_policy_failures.join("; ")}`);
    }
    if (!isIsoDay(row.as_of)) failures.push(`${source} carries no usable calendar date`);
  }
  const required = new Set(REQUIRED_CLOCK_TUPLES.map(({ source, route }) => `${source}|${route}`));
  for (const row of entries) {
    if (!required.has(`${row?.source}|${row?.route}`)) {
      failures.push(`${row?.source} on route ${row?.route} is not a declared clock tuple`);
    }
  }
  return failures;
}

export function clockTupleKey(row) {
  return JSON.stringify([row?.source ?? null, row?.route ?? null, row?.kind ?? null, row?.as_of ?? null]);
}

function buildValuationRange({
  indexConfig,
  observed,
  costOfEquity,
  forecastGrid,
  blockers,
  payoutRatio,
  legacyPayoutRatio,
  generatedAt = null,
}) {
  const isPrimary = PRIMARY_INDICES.some((item) => item.id === indexConfig.id);
  const periods = Array.isArray(forecastGrid?.periods) ? forecastGrid.periods : [];
  const residualIncomeByPeriod = periods.map((row) => ({
    period: row?.period ?? null,
    value: row?.residual_income_proxy?.value ?? null,
    source: "derived.forecast_grid_v1.residual_income_proxy",
  }));
  const bookValueBeginning = periods[0]?.book_value_beginning?.value ?? null;
  const discountRate = costOfEquity?.value ?? null;
  const observedFields = Object.entries(observed ?? {});
  const sourceClockEntries = collectRangeSourceClocks({
    observed, forecastGrid, payoutRatio, legacyPayoutRatio, generatedAt,
  });
  const clockFailures = rangeClockInventoryFailures(sourceClockEntries);
  const contributingSourceDates = sourceClockEntries.map((entry) => entry.as_of).filter((day) => isIsoDay(day));
  // The band is only as current as its OLDEST operand. Reporting the newest
  // would let one fresh input hide a stale one behind it.
  const asOf = contributingSourceDates[0] ?? null;

  const requiredTiers = [
    ["observed.price", observed?.price?.source_tier, "observed_source"],
    ["observed.price_to_book", observed?.price_to_book?.source_tier, "observed_source"],
    ["observed.risk_free_rate", observed?.risk_free_rate?.source_tier, "observed_source"],
    ["observed.equity_risk_premium", observed?.equity_risk_premium?.source_tier, "observed_source"],
    ["derived.cost_of_equity", costOfEquity?.source_tier, "derived_formula"],
  ];
  const tierFailures = requiredTiers
    .filter(([, actual, expected]) => actual !== expected)
    .map(([label, actual]) => `${label}=${actual ?? "(missing)"}`);

  const terminalResidualIncome = residualIncomeByPeriod.at(-1)?.value ?? null;
  const operandFailures = [];
  if (!finite(bookValueBeginning) || bookValueBeginning <= 0) operandFailures.push("book_value_beginning");
  if (!finite(discountRate) || discountRate <= TERMINAL_GROWTH_OPTIMISTIC) {
    operandFailures.push("cost_of_equity must exceed the optimistic terminal growth");
  }
  if (residualIncomeByPeriod.length !== 3 || residualIncomeByPeriod.some((row) => !finite(row.value))) {
    operandFailures.push("three finite residual_income_proxy periods");
  } else if (!(terminalResidualIncome > 0)) {
    // With negative terminal residual income the perpetuity is the LOWER
    // endpoint, so "optimistic" would name the pessimistic number. Refuse
    // rather than publish an inverted band under honest-looking labels.
    operandFailures.push("terminal residual_income_proxy must be positive for the band to be correctly ordered");
  }

  const undatedObserved = observedFields
    .filter(([, field]) => !isIsoDay(field?.as_of))
    .map(([key]) => key);

  // Two independent routes reach the same payout: the index-weighted
  // constituent yields, and the index-level published yield kept as
  // legacy_payout_ratio_qa. Reconcile on RETENTION, because retention is the
  // number the book roll-forward actually consumes.
  const payoutValue = payoutRatio?.value ?? null;
  const legacyPayoutValue = legacyPayoutRatio?.value ?? null;
  const unitMix = payoutRatio?.coverage?.dividend_yield_unit_mix ?? null;
  const unitMixTotal = unitMix
    ? unitMix.percent + unitMix.fraction + unitMix.zero + unitMix.unresolved
    : 0;
  const unresolvedShare = unitMixTotal > 0 ? unitMix.unresolved / unitMixTotal : 1;
  const weightedDividendYield = payoutRatio?.coverage?.weighted_dividend_yield ?? null;
  const payoutDivergence = payoutRouteDivergence(payoutValue, legacyPayoutValue);
  const retentionDivergence = retentionRouteDivergence(payoutValue, legacyPayoutValue);

  const routeFailures = [];
  if (!finite(payoutValue) || payoutValue <= 0 || payoutValue >= 1) {
    routeFailures.push(`payout ratio ${payoutValue} is outside the plausible range (0, 1)`);
  }
  if (!finite(weightedDividendYield) || weightedDividendYield <= 0
    || weightedDividendYield > MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD) {
    routeFailures.push(`weighted dividend yield ${weightedDividendYield} is not plausible for a broad index`);
  }
  if (unresolvedShare > MAX_UNRESOLVED_DIVIDEND_UNIT_SHARE) {
    routeFailures.push(`${round(unresolvedShare * 100, 1)}% of constituent rows have an unmeasurable dividend unit`);
  }
  const reconciliationClock = sourceClockEntries.find((row) => row.route === "reconciliation");
  if (Array.isArray(reconciliationClock?.clock_policy_failures) && reconciliationClock.clock_policy_failures.length > 0) {
    // Ratified rule: absence, SLA breach, or a relabel of the reconciliation
    // clock blocks the reconciliation gate, and therefore blocks publication.
    routeFailures.push(...reconciliationClock.clock_policy_failures);
  }
  if (!finite(payoutDivergence)) {
    routeFailures.push("no independent payout route is available to reconcile against");
  } else if (payoutDivergence > PAYOUT_ROUTE_DIVERGENCE_LIMIT) {
    routeFailures.push(
      `the two payout routes differ by ${round(payoutDivergence * 100, 2)}%,`
      + ` above the ${PAYOUT_ROUTE_DIVERGENCE_LIMIT * 100}% limit`,
    );
  }

  const sensitivityFailures = [];
  if (!finite(retentionDivergence)) {
    sensitivityFailures.push("retention sensitivity cannot be measured without a second payout route");
  } else if (retentionDivergence > PAYOUT_RETENTION_DIVERGENCE_LIMIT) {
    sensitivityFailures.push(
      `retention moves ${round(retentionDivergence * 100, 2)}% between the payout routes,`
      + ` above the ${PAYOUT_RETENTION_DIVERGENCE_LIMIT * 100}% limit`,
    );
  }

  const gates = {
    primary_index: rangeGate(isPrimary, `${indexConfig.id} is not a primary index; secondary lanes stay input-only`),
    source_tier_satisfied: rangeGate(
      tierFailures.length === 0,
      `required source tiers not met: ${tierFailures.join(", ")}`,
    ),
    blockers_empty: rangeGate(
      Array.isArray(blockers) && blockers.length === 0,
      `${blockers?.length ?? 0} open blocker(s): ${(blockers ?? []).map((row) => row?.code).join(", ")}`,
    ),
    operands_complete: rangeGate(
      operandFailures.length === 0,
      `incomplete operands: ${operandFailures.join(", ")}`,
    ),
    source_clock_honest: rangeGate(
      clockFailures.length === 0 && undatedObserved.length === 0 && Boolean(asOf),
      [
        ...clockFailures,
        ...(undatedObserved.length > 0 ? [`observed inputs without a source date: ${undatedObserved.join(", ")}`] : []),
      ].join("; ") || "no contributing clock resolves to a day",
    ),
    payout_routes_reconciled: rangeGate(routeFailures.length === 0, routeFailures.join("; ")),
    model_sensitivity_bounded: rangeGate(sensitivityFailures.length === 0, sensitivityFailures.join("; ")),
  };

  const assumptions = {
    assumption_version: ASSUMPTION_VERSION,
    reviewed_at: REVIEWED_AT,
    terminal_growth: {
      low: TERMINAL_GROWTH_CONSERVATIVE,
      high: TERMINAL_GROWTH_OPTIMISTIC,
      source_tier: "house_assumption",
      assumption_version: ASSUMPTION_VERSION,
      reviewed_at: REVIEWED_AT,
      notes: ["Not observed from any source; the two values are the band's only growth inputs."],
    },
    fade_years: {
      value: FADE_YEARS,
      source_tier: "house_assumption",
      assumption_version: ASSUMPTION_VERSION,
      reviewed_at: REVIEWED_AT,
      notes: ["Applies to the conservative endpoint only; the optimistic endpoint never fades."],
    },
    discount_rate: {
      value: discountRate,
      source_tier: "derived_formula",
      sources: ["derived.cost_of_equity"],
      notes: ["The published cost of equity is reused as-is; the band adds no private premium."],
    },
  };

  const operands = {
    book_value_beginning: {
      value: bookValueBeginning,
      source: "derived.forecast_grid_v1.periods[0].book_value_beginning",
    },
    residual_income_by_period: residualIncomeByPeriod,
    discount_rate: { value: discountRate, source: "derived.cost_of_equity" },
    payout_cross_check: {
      index_weighted_route: payoutValue,
      index_level_route: legacyPayoutValue,
      payout_divergence: finite(payoutDivergence) ? round(payoutDivergence, 6) : null,
      payout_divergence_limit: PAYOUT_ROUTE_DIVERGENCE_LIMIT,
      retention_divergence: finite(retentionDivergence) ? round(retentionDivergence, 6) : null,
      retention_divergence_limit: PAYOUT_RETENTION_DIVERGENCE_LIMIT,
      weighted_dividend_yield: weightedDividendYield,
      dividend_yield_unit_mix: unitMix,
      unresolved_unit_share: round(unresolvedShare, 6),
    },
  };

  const sourceClock = {
    basis: "oldest_contributing_observed_source",
    as_of: asOf,
    contributing_source_dates: contributingSourceDates,
    contributing_sources: sourceClockEntries,
    // The oldest DATED route. An undated entry sorts first only because it has
    // nothing to sort on; naming it the oldest source would be a clock claim
    // resting on a missing clock.
    oldest_source: sourceClockEntries.find((row) => isIsoDay(row.as_of))?.source ?? null,
  };

  const scenarioFormula = "book_value_beginning"
    + " + sum(residual_income_proxy_t / (1 + discount_rate)^t for t in fy1..fy3)"
    + " + continuing_value / (1 + discount_rate)^3";

  const blocked = Object.values(gates).some((gate) => !gate.passed);
  if (blocked) {
    return {
      schema_version: VALUATION_RANGE_SCHEMA,
      public_status: "blocked_no_range",
      method: VALUATION_RANGE_METHOD,
      emits_single_target: false,
      as_of: asOf,
      unit: "index_points",
      source_clock: sourceClock,
      gates,
      assumptions,
      operands,
      range: { low: null, high: null },
      scenarios: [],
      price_context: { observed_price: observed?.price?.value ?? null, position: null },
      notes: [
        "No band is published while any gate is open; the inputs above remain readable.",
        "A partial band would be indistinguishable from a measured one to a reader.",
      ],
    };
  }

  const computed = computeRimScenarioValues({
    bookValueBeginning,
    residualIncome: residualIncomeByPeriod.map((row) => row.value),
    discountRate,
  });
  const scenarioDefinitions = [
    {
      id: "conservative",
      growth: TERMINAL_GROWTH_CONSERVATIVE,
      terminalTreatment: `residual income fades linearly to zero over ${FADE_YEARS} years; no perpetuity`,
      continuingValue: computed.conservativeContinuingValue,
      value: computed.conservative,
    },
    {
      id: "optimistic",
      growth: TERMINAL_GROWTH_OPTIMISTIC,
      terminalTreatment: `residual income persists and grows at ${TERMINAL_GROWTH_OPTIMISTIC} in perpetuity`,
      continuingValue: computed.optimisticContinuingValue,
      value: computed.optimistic,
    },
  ];

  const scenarios = scenarioDefinitions.map((definition) => ({
    id: definition.id,
    value: round(definition.value, 2),
    source_tier: "assumption_labelled_scenario",
    assumption_version: ASSUMPTION_VERSION,
    reviewed_at: REVIEWED_AT,
    terminal_growth: definition.growth,
    terminal_treatment: definition.terminalTreatment,
    continuing_value_at_fy3: round(definition.continuingValue, 2),
    formula: scenarioFormula,
  }));

  const [low, high] = scenarios.map((scenario) => scenario.value);
  const observedPrice = observed?.price?.value ?? null;
  const position = !finite(observedPrice)
    ? null
    : observedPrice < low
      ? "below_range"
      : observedPrice > high
        ? "above_range"
        : "within_range";

  return {
    schema_version: VALUATION_RANGE_SCHEMA,
    public_status: "ready_range_no_single_target",
    method: VALUATION_RANGE_METHOD,
    emits_single_target: false,
    as_of: asOf,
    unit: "index_points",
    source_clock: sourceClock,
    gates,
    assumptions,
    operands,
    range: { low, high, width_ratio: round(high / low, 4) },
    scenarios,
    price_context: { observed_price: observedPrice, position },
    notes: [
      "A band between two named assumption sets, not an estimate of where the index should trade.",
      "The endpoints differ only in terminal treatment; every other operand is shared and published above.",
      "No middle case is published: it would be quoted as a single number, which policy forbids.",
      "Both endpoints move with the house assumptions, which are opinions and are labelled as such.",
    ],
  };
}

function buildPrimaryIndex(indexConfig, context) {
  const benchmarkPayload = context.benchmarkPayloads.get(indexConfig.benchmarkFile);
  const spot = requireAvailableSource(
    context.exactSpots.get(indexConfig.id),
    indexConfig.spotFile,
    context.unavailableSources,
  );
  const benchmarkRow = latestBenchmarkRow(benchmarkPayload, indexConfig.benchmarkSection, indexConfig.benchmarkFile);
  const dgs10 = requireAvailableSource(context.dgs10, "macro/fred-banking-daily.json:series.DGS10");
  const usErp = requireAvailableSource(context.usErp, "damodaran/erp.json:us_erp");
  requireAvailableSource(context.stockActionPayload, "computed/stock_action_index.json");
  const yieldPayload = readDataJson(indexConfig.yieldFile, context.dataRoot);
  const payoutRatio = buildStockActionPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload);
  const legacyPayoutRatio = buildPayoutRatio(indexConfig, benchmarkRow, yieldPayload, {
    dataRootForReads: context.dataRoot,
  });
  const explicitEpsGrowth3y = buildForwardEpsGrowth(
    indexConfig,
    context.stockActionPayload,
    context.minCoveredWeight,
    context.dataRoot,
  );
  const forecastGrid = buildForecastGrid(
    indexConfig,
    benchmarkRow,
    context.stockActionPayload,
    payoutRatio,
    dgs10.value + usErp.value,
    explicitEpsGrowth3y,
    { currentSpot: spot.value },
  );
  const spotFreshness = spotFreshnessForIndex(indexConfig, spot.asOf, context.generatedAt);
  const benchmarkFreshness = rimObservedPriceFreshness(benchmarkRow.date, context.generatedAt);
  const blockers = [];
  // Age-only SLA overruns keep otherwise valid inputs usable and disclosed.
  const warnings = [];
  if (spotFreshness.status === "refresh_recommended") {
    warnings.push({
      code: "spot_source_refresh_recommended",
      severity: "freshness_warning",
      source: indexConfig.spotFile,
      as_of: spot.asOf,
    });
  }
  if (benchmarkFreshness.status === "refresh_recommended") {
    warnings.push({
      code: "benchmark_source_refresh_recommended",
      severity: "freshness_warning",
      source: indexConfig.benchmarkFile,
      as_of: benchmarkRow.date,
    });
  }
  for (const [code, ratio] of [
    ["payout_coverage_below_threshold", payoutRatio.coverage?.covered_weight_ratio],
    ["forward_eps_coverage_below_threshold", explicitEpsGrowth3y.coverage?.covered_weight_ratio],
  ]) {
    if (!finite(ratio) || ratio < context.minCoveredWeight) {
      blockers.push({ code, severity: "lane_degraded" });
    }
  }
  for (const row of forecastGrid.periods) {
    for (const [metric, field] of [
      ["eps_growth", row.eps_growth],
      ["weighted_roe", row.stock_action_weighted_roe],
    ]) {
      const ratio = field?.coverage?.covered_weight_ratio;
      if (!finite(ratio) || ratio < context.minCoveredWeight) {
        blockers.push({ code: `${row.period}_${metric}_coverage_below_threshold`, severity: "lane_degraded" });
      }
    }
  }
  if (blockers.length > 0) {
    forecastGrid.public_status = "input_only_primary_with_caveats_no_fair_value";
  }
  const observed = {
    price: buildExactSpotObserved(indexConfig, spot, context.generatedAt),
    ...buildBenchmarkObservedInputs(indexConfig, benchmarkRow, benchmarkFreshness),
    risk_free_rate: observedValue({
      value: dgs10.value,
      source: "macro/fred-banking-daily.json",
      sourceField: "series.DGS10[-1].value / 100",
      asOf: dgs10.date,
      label: "US 10Y Treasury",
    }),
    equity_risk_premium: observedValue({
      value: usErp.value,
      source: "damodaran/erp.json",
      sourceField: "us_erp",
      asOf: usErp.source_date,
      label: "Damodaran US ERP",
    }),
  };
  const costOfEquity = derivedValue({
    value: round(dgs10.value + usErp.value, 8),
    formula: "risk_free_rate + equity_risk_premium",
    sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
    notes: ["No house premium adjustment included in public inputs slice."],
  });
  return {
    id: indexConfig.id,
    label: indexConfig.label,
    role: "primary_public_v1",
    public_status: blockers.length > 0
      ? "input_only_primary_with_caveats"
      : "ready_inputs_and_forecast_grid",
    observed,
    derived: {
      book_value: buildBookValue(benchmarkRow, spot.value),
      payout_ratio: payoutRatio,
      legacy_payout_ratio_qa: legacyPayoutRatio,
      explicit_eps_growth_3y: explicitEpsGrowth3y,
      cost_of_equity: costOfEquity,
      forecast_grid_v1: forecastGrid,
      valuation_range_v1: buildValuationRange({
        indexConfig,
        observed,
        costOfEquity,
        forecastGrid,
        blockers,
        payoutRatio,
        legacyPayoutRatio,
        generatedAt: context.generatedAt,
      }),
    },
    assumptions: {
      terminal_growth: {
        value: null,
        source_tier: "house_assumption",
        assumption_version: ASSUMPTION_VERSION,
        reviewed_at: REVIEWED_AT,
        status: "not_in_inputs_slice",
      },
      fade_years: {
        value: null,
        source_tier: "house_assumption",
        assumption_version: ASSUMPTION_VERSION,
        reviewed_at: REVIEWED_AT,
        status: "not_in_inputs_slice",
      },
    },
    blockers,
    warnings,
  };
}

function buildSecondaryIndex(indexConfig, context) {
  const benchmarkPayload = context.benchmarkPayloads.get(indexConfig.benchmarkFile);
  const spot = requireAvailableSource(
    context.exactSpots.get(indexConfig.id),
    indexConfig.spotFile,
    context.unavailableSources,
  );
  const benchmarkRow = latestBenchmarkRow(benchmarkPayload, indexConfig.benchmarkSection, indexConfig.benchmarkFile);
  if (indexConfig.id !== "CCMP") {
    requireAvailableSource(context.stockActionPayload, "computed/stock_action_index.json");
  }
  const spotFreshness = spotFreshnessForIndex(indexConfig, spot.asOf, context.generatedAt);
  const benchmarkFreshness = rimObservedPriceFreshness(benchmarkRow.date, context.generatedAt);
  const observed = {
    price: buildExactSpotObserved(indexConfig, spot, context.generatedAt),
    ...buildBenchmarkObservedInputs(indexConfig, benchmarkRow, benchmarkFreshness),
  };
  const baseBlockers = [];
  // Age-only SLA overruns keep otherwise valid inputs usable and disclosed.
  const baseWarnings = [];
  if (spotFreshness.status === "refresh_recommended") {
    baseWarnings.push({
      code: "spot_source_refresh_recommended",
      severity: "freshness_warning",
      source: indexConfig.spotFile,
      as_of: spot.asOf,
    });
  }
  if (benchmarkFreshness.status === "refresh_recommended") {
    baseWarnings.push({
      code: "benchmark_source_refresh_recommended",
      severity: "freshness_warning",
      source: indexConfig.benchmarkFile,
      as_of: benchmarkRow.date,
    });
  }
  if (indexConfig.id === "KOSPI") {
    requireAvailableSource(context.erpPayload, "damodaran/erp.json");
    const krRiskFree = context.krxKr10y ?? context.kr10y;
    if (krRiskFree) {
      observed.risk_free_rate = observedValue({
        value: krRiskFree.value,
        source: krRiskFree.source ?? "macro/fred-banking-daily.json",
        sourceField: krRiskFree.source_field ?? "series.IRLTLT01KRM156N[-1].value / 100",
        asOf: krRiskFree.date,
        label: krRiskFree.label ?? "Korea 10Y Government Bond Yield",
      });
      if (typeof krRiskFree.raw_public === "boolean") observed.risk_free_rate.raw_public = krRiskFree.raw_public;
      if (krRiskFree.license_or_terms_note) observed.risk_free_rate.license_or_terms_note = krRiskFree.license_or_terms_note;
    } else {
      observed.risk_free_rate = blockedValue({
        reason: "KR10Y source is not present in local 100x macro data and no KRX KTS 10Y bridge source was found.",
        candidate: {
          sources: ["FRED/OECD IRLTLT01KRM156N", "KRX KTS 10Y benchmark government bond yield"],
          note: "Collect before any public KOSPI RIM output; do not reuse DGS10.",
        },
        sourceTier: "blocked_not_wired",
      });
    }
    const koreaErpRaw = context.erpPayload?.countries?.Korea?.equity_risk_premium;
    if (koreaErpRaw === null || koreaErpRaw === undefined || koreaErpRaw === "") {
      throw new LaneUnavailableError("damodaran/erp.json: Korea equity_risk_premium is unavailable", "damodaran/erp.json");
    }
    const koreaErp = numberOrNull(koreaErpRaw);
    if (!finite(koreaErp) || koreaErp <= 0) {
      throw new Error("damodaran/erp.json: Korea equity_risk_premium is invalid");
    }
    observed.equity_risk_premium = observedValue({
      value: round(koreaErp, 8),
      source: "damodaran/erp.json",
      sourceField: "countries.Korea.equity_risk_premium",
      asOf: normalizeSourceDate(context.erpPayload?.metadata?.source_date, "damodaran/erp.json"),
      label: "Damodaran Korea ERP",
    });
    if (context.krxKospiWeights) {
      const joined = stockActionRowsForKrxKospiWeights(context.stockActionPayload, context.krxKospiWeights);
      const legacyPayoutRatio = buildKrxKospiPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload, context.krxKospiWeights);
      const dartPayoutError = context.unavailableSources.get(KOSPI_DART_POINTER_FILE);
      const payoutRatio = buildKospiDartPayoutRatio(
        context.kospiDartPayout,
        dartPayoutError?.message,
      );
      const explicitEpsGrowth3y = buildKrxKospiForwardEpsGrowth(
        indexConfig,
        context.stockActionPayload,
        context.krxKospiWeights,
        context.minCoveredWeight,
      );
      const costOfEquityValue = krRiskFree && finite(observed.equity_risk_premium.value)
        ? krRiskFree.value + observed.equity_risk_premium.value
        : null;
      const forecastAvailabilityCandidates = [
        context.stockActionPayload?.source_date,
        context.krxKospiWeights.as_of,
      ].filter((date) => isRealCalendarDate(date));
      const forecastAvailabilityAsOf = forecastAvailabilityCandidates.sort().at(-1) ?? null;
      const blockers = [...baseBlockers];
      const warnings = [...baseWarnings];
      if (!krRiskFree) {
        blockers.push({
          code: "country_risk_free_source_missing",
          severity: "lane_degraded",
        });
      }
      if (context.krxKospiWeights.freshness?.status === "refresh_recommended") {
        warnings.push({
          code: "krx_kospi_daily_refresh_recommended",
          severity: "freshness_warning",
          source: context.krxKospiWeights.source,
          as_of: context.krxKospiWeights.as_of,
        });
      }
      if (!context.kospiDartPayout) {
        blockers.push({
          code: "kospi_dart_payout_pointer_unavailable",
          severity: "lane_degraded",
          source: KOSPI_DART_POINTER_FILE,
          reason: dartPayoutError?.message ?? "KOSPI OpenDART current pointer is unavailable or invalid; no payout fallback is permitted.",
        });
      } else if ((payoutRatio.coverage?.covered_weight_ratio ?? 0) < context.minCoveredWeight) {
        blockers.push({
          code: "kospi_payout_coverage_below_threshold",
          severity: "lane_degraded",
        });
      }
      if (context.kospiDartPayout?.availability_as_of > spot.asOf) {
        blockers.push({
          code: "kospi_dart_payout_after_exact_price",
          severity: "pit_blocker",
          source: KOSPI_DART_POINTER_FILE,
          as_of: context.kospiDartPayout.availability_as_of,
        });
      }
      if (forecastAvailabilityAsOf && forecastAvailabilityAsOf > spot.asOf) {
        blockers.push({
          code: "kospi_forecast_after_exact_price",
          severity: "pit_blocker",
          as_of: forecastAvailabilityAsOf,
        });
      }
      if (krRiskFree?.date && isRealCalendarDate(krRiskFree.date) && krRiskFree.date > spot.asOf) {
        blockers.push({
          code: "kospi_risk_free_after_exact_price",
          severity: "pit_blocker",
          as_of: krRiskFree.date,
        });
      }
      if ((explicitEpsGrowth3y.coverage?.covered_weight_ratio ?? 0) < context.minCoveredWeight) {
        blockers.push({
          code: "kospi_forward_eps_coverage_below_threshold",
          severity: "lane_degraded",
        });
      }
      return {
        id: indexConfig.id,
        label: indexConfig.label,
        role: "secondary_input_only",
        public_status: blockers.length
          ? "input_only_krx_exact_weights_with_caveats"
          : "ready_inputs_and_forecast_grid",
        observed,
        derived: {
          book_value: buildBookValue(benchmarkRow, spot.value),
          payout_ratio: payoutRatio,
          legacy_payout_ratio_qa: legacyPayoutRatio,
          explicit_eps_growth_3y: explicitEpsGrowth3y,
          cost_of_equity: finite(costOfEquityValue)
            ? derivedValue({
              value: round(costOfEquityValue, 8),
              formula: "risk_free_rate + equity_risk_premium",
              sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
              notes: ["KOSPI uses Korea risk-free inputs only; DGS10 fallback is forbidden."],
            })
            : blockedValue({
              reason: "Cost of equity requires Korea risk-free rate and Korea ERP.",
            }),
          forecast_grid_v1: finite(costOfEquityValue)
            ? buildForecastGrid(
              indexConfig,
              benchmarkRow,
              context.stockActionPayload,
              payoutRatio,
              costOfEquityValue,
              explicitEpsGrowth3y,
              {
                currentSpot: spot.value,
                indexRows: joined.indexRows,
                denominatorRows: joined.denominatorRows,
                indexKey: KOSPI_KRX_WEIGHT_KEY,
                sourceRefs: ["computed/stock_action_index.json", context.krxKospiWeights.source],
                publicStatus: "input_only_krx_exact_weights_no_fair_value",
                indexDiagnostics: krxKospiWeightDiagnostics(context.stockActionPayload, context.krxKospiWeights),
                payoutFormula: "derived.payout_ratio",
                forecastAvailabilityAsOf,
                exactSpotAsOf: spot.asOf,
                notes: [
                  "KOSPI forecast grid uses KRX MKTCAP weights and stock_action financial snapshots.",
                  "KOSPI forecast availability is the stock_action/weights clock; it remains separate from the exact KRX spot clock and the OpenDART payout availability clock.",
                  "Raw KRX rows stay private/admin; generated RIM inputs are safe for this public payload.",
                ],
              },
            )
            : blockedValue({
              reason: "Forecast grid requires a finite Korea cost of equity.",
            }),
        },
        assumptions: {},
        blockers,
        warnings,
      };
    }
  }
  if (indexConfig.id === "CCMP") {
    return buildCcmpIndex(indexConfig, context, benchmarkRow, spot, observed, baseBlockers, baseWarnings);
  }
  if (indexConfig.id === "SOX") {
    const dgs10 = requireAvailableSource(context.dgs10, "macro/fred-banking-daily.json:series.DGS10");
    const usErp = requireAvailableSource(context.usErp, "damodaran/erp.json:us_erp");
    observed.risk_free_rate = observedValue({
      value: dgs10.value,
      source: "macro/fred-banking-daily.json",
      sourceField: "series.DGS10[-1].value / 100",
      asOf: dgs10.date,
      label: "US 10Y Treasury",
    });
    observed.equity_risk_premium = observedValue({
      value: usErp.value,
      source: "damodaran/erp.json",
      sourceField: "us_erp",
      asOf: usErp.source_date,
      label: "Damodaran US ERP",
    });
    if (context.soxWeights) {
      const joined = stockActionRowsForSoxWeights(context.stockActionPayload, context.soxWeights);
      const payoutRatio = buildSoxPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload, context.soxWeights);
      const explicitEpsGrowth3y = buildSoxForwardEpsGrowth(
        indexConfig,
        context.stockActionPayload,
        context.soxWeights,
        context.minCoveredWeight,
      );
      const costOfEquityValue = dgs10.value + usErp.value;
      const blockers = [...baseBlockers];
      const warnings = [...baseWarnings];
      if (context.soxWeights.freshness?.status === "refresh_recommended") {
        warnings.push({
          code: "sox_giw_daily_refresh_recommended",
          severity: "freshness_warning",
          source: context.soxWeights.source,
          as_of: context.soxWeights.as_of,
        });
      }
      if ((payoutRatio.coverage?.covered_weight_ratio ?? 0) < context.minCoveredWeight) {
        blockers.push({
          code: "sox_payout_coverage_below_threshold",
          severity: "lane_degraded",
        });
      }
      if ((explicitEpsGrowth3y.coverage?.covered_weight_ratio ?? 0) < context.minCoveredWeight) {
        blockers.push({
          code: "sox_forward_eps_coverage_below_threshold",
          severity: "lane_degraded",
        });
      }
      return {
        id: indexConfig.id,
        label: indexConfig.label,
        role: "secondary_input_only",
        public_status: blockers.length
          ? "input_only_sox_methodology_weights_with_caveats"
          : "ready_inputs_and_forecast_grid",
        observed,
        derived: {
          book_value: buildBookValue(benchmarkRow, spot.value),
          payout_ratio: payoutRatio,
          explicit_eps_growth_3y: explicitEpsGrowth3y,
          cost_of_equity: derivedValue({
            value: round(costOfEquityValue, 8),
            formula: "risk_free_rate + equity_risk_premium",
            sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
            notes: ["SOX uses US risk-free and Damodaran US ERP inputs; no house premium adjustment included."],
          }),
          forecast_grid_v1: buildForecastGrid(
            indexConfig,
            benchmarkRow,
            context.stockActionPayload,
            payoutRatio,
            costOfEquityValue,
            explicitEpsGrowth3y,
            {
              currentSpot: spot.value,
              indexRows: joined.indexRows,
              denominatorRows: joined.denominatorRows,
              indexKey: SOX_DERIVED_WEIGHT_KEY,
              sourceRefs: ["computed/stock_action_index.json", context.soxWeights.source],
              publicStatus: "input_only_sox_methodology_weights_no_fair_value",
              indexDiagnostics: soxWeightDiagnostics(context.stockActionPayload, context.soxWeights),
              notes: [
                "SOX forecast grid uses Nasdaq GIW official constituents plus methodology-derived stock_action market-cap weights.",
                "Official GIW weight columns are not available in the public free view; generated weights are not licensed official weights.",
                "SOXX/SOXQ ETF holdings remain diagnostics-only and are not used as top-level SOX RIM weights.",
              ],
            },
          ),
        },
        assumptions: {},
        blockers,
        warnings,
      };
    }
  }
  const proxyInputs = buildProxyInputs(indexConfig, benchmarkRow, { ...context, spot });
  const fallbackPayout = indexConfig.id === "KOSPI"
    ? buildKospiDartPayoutRatio(
      null,
      context.unavailableSources.get(KOSPI_DART_POINTER_FILE)?.message,
    )
    : blockedValue({
      reason: "Exact index payout derivation requires named constituent weights and/or index yield coverage.",
    });
  return {
    id: indexConfig.id,
    label: indexConfig.label,
    role: indexConfig.role,
    public_status: "blocked_or_input_only",
    observed,
    derived: {
      book_value: buildBookValue(benchmarkRow, spot.value),
      payout_ratio: fallbackPayout,
      explicit_eps_growth_3y: blockedValue({
        reason: "Exact index growth derivation requires named constituent weights with sufficient forward EPS coverage.",
      }),
      ...(proxyInputs ? { proxy_inputs_v1: proxyInputs } : {}),
    },
    assumptions: {},
    blockers: [
      ...baseBlockers,
      ...indexConfig.blockers
      .filter((code) => !(indexConfig.id === "KOSPI" && context.kr10y && code === "country_risk_free_source_solved_not_wired"))
      .map((code) => ({
        code,
        severity: "lane_degraded",
      })),
      ...(indexConfig.id === "KOSPI" && !context.kospiDartPayout
        ? [{
          code: "kospi_dart_payout_pointer_unavailable",
          severity: "lane_degraded",
          source: KOSPI_DART_POINTER_FILE,
          reason: context.unavailableSources.get(KOSPI_DART_POINTER_FILE)?.message
            ?? "KOSPI OpenDART current pointer is unavailable or invalid; no payout fallback is permitted.",
        }]
        : []),
    ],
    warnings: [...baseWarnings],
  };
}

function collectSourceTierCounts(node, counts = {}) {
  if (Array.isArray(node)) {
    for (const item of node) collectSourceTierCounts(item, counts);
  } else if (node && typeof node === "object") {
    if (typeof node.source_tier === "string") {
      counts[node.source_tier] = (counts[node.source_tier] ?? 0) + 1;
    }
    for (const value of Object.values(node)) collectSourceTierCounts(value, counts);
  }
  return counts;
}

function scanForbiddenKeys(node, pathParts = [], matches = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanForbiddenKeys(item, [...pathParts, String(index)], matches));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const next = [...pathParts, key];
      if (["fair_value", "target_price"].includes(key)) matches.push(next.join("."));
      scanForbiddenKeys(value, next, matches);
    }
  }
  return matches;
}

export function buildRimIndexInputs({
  dataRootOverride = dataRoot,
  generatedAt = new Date().toISOString(),
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
} = {}) {
  const originalDataRoot = dataRootOverride;
  const unavailableSources = new Map();
  const readFrom = (relPath) => {
    try {
      return readDataJson(relPath, originalDataRoot);
    } catch (error) {
      if (error instanceof LaneUnavailableError) {
        unavailableSources.set(relPath, error);
        return null;
      }
      throw error;
    }
  };
  const loadAvailable = (source, loader) => {
    if (unavailableSources.has(source)) return null;
    try {
      return loader();
    } catch (error) {
      if (error instanceof LaneUnavailableError) {
        unavailableSources.set(source, error);
        return null;
      }
      throw error;
    }
  };
  const benchmarkPayloads = new Map();
  for (const item of [...PRIMARY_INDICES, ...SECONDARY_INDICES]) {
    if (!benchmarkPayloads.has(item.benchmarkFile)) benchmarkPayloads.set(item.benchmarkFile, readFrom(item.benchmarkFile));
  }
  const macroPayload = readFrom("macro/fred-banking-daily.json");
  const erpPayload = readFrom("damodaran/erp.json");
  const stockActionPayload = readFrom("computed/stock_action_index.json");
  const exactSpotPayloads = new Map();
  for (const item of [...PRIMARY_INDICES, ...SECONDARY_INDICES]) {
    if (!exactSpotPayloads.has(item.spotFile)) exactSpotPayloads.set(item.spotFile, readFrom(item.spotFile));
  }
  const exactSpots = new Map();
  for (const item of [...PRIMARY_INDICES, ...SECONDARY_INDICES]) {
    exactSpots.set(
      item.id,
      loadAvailable(item.spotFile, () => latestExactSpot(exactSpotPayloads.get(item.spotFile), item)),
    );
  }
  const context = {
    benchmarkPayloads,
    exactSpots,
    macroPayload,
    dgs10: loadAvailable("macro/fred-banking-daily.json", () => loadDgs10(macroPayload)),
    kr10y: loadKr10y(macroPayload),
    krxKr10y: loadKrxKorea10y(originalDataRoot),
    krxKospiWeights: loadKrxKospiMarketCapWeights(originalDataRoot, generatedAt),
    kospiDartPayout: loadAvailable(
      KOSPI_DART_POINTER_FILE,
      () => loadKospiDartPayout(originalDataRoot, minCoveredWeight),
    ),
    usErp: loadAvailable("damodaran/erp.json", () => loadUsErp(erpPayload)),
    erpPayload,
    stockActionPayload,
    soxWeights: loadSoxMethodologyWeights(originalDataRoot, stockActionPayload, generatedAt),
    minCoveredWeight,
    dataRoot: originalDataRoot,
    generatedAt,
    unavailableSources,
  };
  const indices = {};
  for (const item of PRIMARY_INDICES) {
    indices[item.id] = buildIndexWithAvailability(item, context, buildPrimaryIndex);
  }
  for (const item of SECONDARY_INDICES) {
    indices[item.id] = buildIndexWithAvailability(item, context, buildSecondaryIndex);
  }
  const payload = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    generated_by: "scripts/build-rim-index.mjs",
    product: "Fenok Index RIM Workbench",
    output_scope: OUTPUT_SCOPE,
    path: DEFAULT_OUTPUT,
    policy: {
      no_public_single_target: true,
      valuation_range_scope: "SPX_NDX_only_assumption_labelled_range_no_single_target",
      valuation_range_shape: "two labelled endpoint scenarios and no middle case; a collapsed or single-valued range is rejected",
      no_kospi_dgs10_fallback: true,
      exact_spot_source_policy: {
        us: "SPX/CCMP/NDX/SOX use the latest positive close from their named data/indices series",
        kospi: `${KOSPI_EXACT_SPOT_FILE} exact row market=KOSPI,index_class=KOSPI,index_name=코스피 only`,
        fallback: "no ETF, Global Scouter, Investing, or legacy bridge price fallback",
      },
      source_tier_required: true,
      forecast_grid_v1_scope: "SPX_NDX_plus_direct_CCMP_when_converter_FY2_FY3_PIT_fields_pass_plus_KOSPI_when_krx_exact_weights_available; proxy grids stay nested under proxy_inputs_v1",
      ccmp_payout_source_policy: "FRED NASDAQXCMP/NASDAQCOM exact-date aligned trailing measured yield at the exact ^IXIC spot as_of; no ETF, proxy, or fallback",
      ccmp_direct_forecast_policy: "best_eps_fy2/best_eps_fy3/best_eps_asof are optional direct converter fields; missing, invalid, implausible, or future fields block the grid without extrapolation",
      primary_indices: PRIMARY_INDICES.map((item) => item.id),
      secondary_or_backlog_indices: SECONDARY_INDICES.map((item) => item.id),
      kospi_weight_method: "KRX KOSPI issuer MKTCAP / total KOSPI MKTCAP when available",
      kospi_etf_proxy_policy: "EWY/MSCI Korea is diagnostics-only and must not be used as KOSPI RIM weights",
      sox_weight_method: "Nasdaq GIW official SOX constituents + stock_action market caps + published SOX methodology caps; not official GIW weight columns",
      proxy_input_policy: "ETF proxy inputs are not exact index substitutes and must not set publication_ready.",
    },
    indices,
    coverage_diagnostics: {
      stock_action: {
        SPX: stockActionIndexDiagnostics(context.stockActionPayload, "sp500"),
        NDX: stockActionIndexDiagnostics(context.stockActionPayload, "nasdaq100"),
        KOSPI: koreaCoverageDiagnostics(context.stockActionPayload, context.krxKospiWeights),
        SOX: soxWeightDiagnostics(context.stockActionPayload, context.soxWeights),
      },
      proxy_constituent_candidates: context.stockActionPayload
        ? proxyConstituentCandidateDiagnostics(context.stockActionPayload, originalDataRoot)
        : {},
    },
  };
  payload.source_tier_counts = collectSourceTierCounts(payload);
  return payload;
}

function validateExactSpotIdentity(field, id, errors) {
  const identity = field?.identity;
  if (id === "KOSPI") {
    for (const [key, expected] of Object.entries({
      market: "KOSPI",
      index_class: "KOSPI",
      index_name: "코스피",
    })) {
      if (identity?.[key] !== expected) {
        errors.push(`${id}.observed.price.identity.${key} must remain the exact KRX row identity ${expected}`);
      }
    }
    return;
  }
  const expected = INDEX_CONFIG_BY_ID.get(id)?.spotIdentity;
  if (!expected) return;
  if (identity?.provider_symbol !== expected.provider_symbol) {
    errors.push(
      `${id}.observed.price.identity.provider_symbol must be the pinned ${expected.provider_symbol}`,
    );
  }
  if (identity?.canonical_index !== expected.canonical_index) {
    errors.push(
      `${id}.observed.price.identity.canonical_index must be the pinned ${expected.canonical_index}`,
    );
  }
}

function approximatelyEqual(actual, expected, tolerance = 1e-4) {
  return finite(actual) && finite(expected) && Math.abs(actual - expected) <= tolerance;
}

function validateUnavailableIndexShape(item, id, errors, warnings, payload) {
  if (item.public_status === "ready_inputs_and_forecast_grid") {
    errors.push(`${id}: source-unavailable index must not claim ready`);
  }
  if (!Array.isArray(item.blockers) || !item.blockers.some((row) => row?.code === "source_unavailable")) {
    errors.push(`${id}: source_unavailable blocker is required`);
  }
  const validateNullReason = (field, label) => {
    if (field?.value !== null) errors.push(`${label}: unavailable value must be null`);
    if (field?.source_tier !== "blocked_missing_source") {
      errors.push(`${label}: blocked_missing_source tier required`);
    }
    if (typeof field?.reason !== "string" || !field.reason.trim()) {
      errors.push(`${label}: non-empty reason is required`);
    }
  };
  const exactSpot = item.observed?.price;
  if (exactSpot?.value === null || exactSpot?.value === undefined) {
    validateNullReason(exactSpot, `${id}.observed.price`);
  } else {
    if (!finite(exactSpot.value) || exactSpot.value <= 0) errors.push(`${id}.observed.price: positive finite value required`);
    if (exactSpot.source_tier !== "observed_source") errors.push(`${id}.observed.price: observed_source tier required`);
    if (typeof exactSpot.source !== "string" || !exactSpot.source.trim()) errors.push(`${id}.observed.price: source is required`);
    if (typeof exactSpot.source_field !== "string" || !exactSpot.source_field.trim()) errors.push(`${id}.observed.price: source_field is required`);
    validateObservedSourceDate(exactSpot, `${id}.observed.price`, payload?.generated_at, errors);
    validateExactSpotIdentity(exactSpot, id, errors);
    const expectedFreshness = spotFreshnessForId(id, exactSpot.as_of, payload?.generated_at);
    for (const key of ["generated_at_date", "calendar_age_days", "business_age_days", "freshness_unit", "freshness_calendar", "max_input_freshness_days", "future_date_anomaly", "status"]) {
      if (exactSpot.freshness?.[key] !== expectedFreshness[key]) {
        errors.push(`${id}.observed.price.freshness.${key}: does not match canonical SLA computation`);
      }
    }
    if (expectedFreshness.future_date_anomaly) errors.push(`${id}: spot source date anomaly`);
    if (expectedFreshness.status === "refresh_recommended") {
      if (!item.warnings?.some((row) => row?.code === "spot_source_refresh_recommended")) {
        errors.push(`${id}: stale spot source must be named in warnings`);
      } else {
        warnings.push(`${id}: stale spot source; last-known spot retained with as-of disclosed`);
      }
    }
  }
  for (const key of ["benchmark_price", "forward_eps", "forward_pe", "price_to_book", "roe", "risk_free_rate", "equity_risk_premium"]) {
    validateNullReason(item.observed?.[key], `${id}.observed.${key}`);
  }
  for (const key of ["book_value", "payout_ratio", "explicit_eps_growth_3y", "cost_of_equity"]) {
    validateNullReason(item.derived?.[key], `${id}.derived.${key}`);
  }
  const grid = item.derived?.forecast_grid_v1;
  if (grid?.schema_version !== "forecast_grid_v1") errors.push(`${id}.forecast_grid_v1: schema_version required`);
  if (grid?.source_tier !== "blocked_missing_source") errors.push(`${id}.forecast_grid_v1: blocked_missing_source tier required`);
  if (typeof grid?.reason !== "string" || !grid.reason.trim()) errors.push(`${id}.forecast_grid_v1: non-empty reason required`);
  if (!Array.isArray(grid?.periods) || grid.periods.length !== 0) {
    errors.push(`${id}.forecast_grid_v1: unavailable periods must be an empty array`);
  }
  warnings.push(`${id}: source unavailable; lane remains deployable with an explicit null reason`);
}

function validateObservedSourceDate(field, label, generatedAt, errors) {
  if (!isRealCalendarDate(field?.as_of)) {
    errors.push(`${label}: real source as_of date required`);
    return;
  }
  const generatedDate = String(generatedAt ?? "").slice(0, 10);
  if (!isRealCalendarDate(generatedDate)) {
    errors.push("generated_at must carry a real calendar date");
  } else if (field.as_of > generatedDate) {
    errors.push(`${label}: source as_of must not be after generated_at`);
  }
}

function validateObservedFreshness(field, label, generatedAt, errors, market = "us_market") {
  const expected = rimObservedPriceFreshness(field?.as_of, generatedAt, market);
  for (const key of ["generated_at_date", "calendar_age_days", "business_age_days", "freshness_unit", "freshness_calendar", "max_input_freshness_days", "future_date_anomaly", "status"]) {
    if (field?.freshness?.[key] !== expected[key]) {
      errors.push(`${label}.freshness.${key}: does not match canonical SLA computation`);
    }
  }
  return expected;
}

function validateCoreFormulaIntegrity(item, id, errors) {
  const observed = item?.observed ?? {};
  const derived = item?.derived ?? {};
  const expectedPayoutFormula = {
    SPX: "stock_action_index_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    NDX: "stock_action_index_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    KOSPI: KOSPI_DART_PAYOUT_FORMULA,
    SOX: "sox_methodology_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
  }[id];
  const expectedGrowthFormula = {
    SPX: "weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    NDX: "weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    KOSPI: "krx_kospi_mktcap_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    SOX: "sox_methodology_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
  }[id];
  for (const [field, formula, label] of [
    [derived.book_value, "current_price / price_to_book", "book_value"],
    [derived.payout_ratio, expectedPayoutFormula, "payout_ratio"],
    [derived.explicit_eps_growth_3y, expectedGrowthFormula, "explicit_eps_growth_3y"],
    [derived.cost_of_equity, "risk_free_rate + equity_risk_premium", "cost_of_equity"],
  ]) {
    if (formula && field?.formula !== formula) errors.push(`${id}.${label}: canonical formula required`);
  }
  for (const [label, yieldCoverage] of [
    ["payout_ratio", derived.payout_ratio?.coverage],
    ["legacy_payout_ratio_qa", derived.legacy_payout_ratio_qa?.coverage],
  ]) {
    if (!yieldCoverage || !Object.hasOwn(yieldCoverage, "index_yield_as_of")) continue;
    if (yieldCoverage.index_yield_as_of === null || yieldCoverage.index_yield_as_of === undefined) {
      if (typeof yieldCoverage.index_yield_as_of_reason !== "string" || !yieldCoverage.index_yield_as_of_reason.trim()) {
        errors.push(`${id}.${label}: null index_yield_as_of requires an explicit reason`);
      }
    } else if (!isRealCalendarDate(yieldCoverage.index_yield_as_of)) {
      errors.push(`${id}.${label}: index_yield_as_of must be a real source date or null`);
    }
  }
  if (finite(observed.price?.value) && finite(observed.price_to_book?.value)) {
    const expectedBook = observed.price.value / observed.price_to_book.value;
    if (!approximatelyEqual(derived.book_value?.value, expectedBook)) {
      errors.push(`${id}.book_value: value does not reconcile to current price / price_to_book`);
    }
  }
  if (finite(observed.risk_free_rate?.value) && finite(observed.equity_risk_premium?.value)) {
    const expectedCost = observed.risk_free_rate.value + observed.equity_risk_premium.value;
    if (!approximatelyEqual(derived.cost_of_equity?.value, expectedCost, 1e-7)) {
      errors.push(`${id}.cost_of_equity: value does not reconcile to observed sources`);
    }
  }
}

// The whole point of the successor slice is that it can never become a target.
// These checks are the enforcement; the builder's shape is only the intent.

// A SECOND implementation of the band arithmetic, written from the contract
// rather than from the producer's code, and deliberately not sharing a single
// function with it. The producer uses computeRimScenarioValues; this oracle is
// what the validator uses. If both agree the number is checked twice; if one has
// a bug the other does not automatically bless it. Note the different shapes:
// (fadeYears - k)/fadeYears instead of 1 - k/fadeYears, and (RI + RI*g) instead
// of RI*(1+g). Same mathematics, independently expressed.
function validatorScenarioOracle({ bookValueBeginning, residualIncome, discountRate, growthLow, growthHigh, fadeYears }) {
  const discount = (years) => (1 + discountRate) ** years;
  let explicitPresentValue = 0;
  for (let period = 1; period <= residualIncome.length; period += 1) {
    explicitPresentValue += residualIncome[period - 1] / discount(period);
  }
  const terminal = residualIncome[residualIncome.length - 1];
  let fadeValue = 0;
  for (let year = 1; year <= fadeYears; year += 1) {
    const survivingShare = (fadeYears - year) / fadeYears;
    fadeValue += (terminal * (1 + growthLow) ** year * survivingShare) / discount(year);
  }
  const perpetuityValue = (terminal + terminal * growthHigh) / (discountRate - growthHigh);
  const horizon = discount(residualIncome.length);
  return {
    explicitPresentValue,
    conservativeContinuingValue: fadeValue,
    optimisticContinuingValue: perpetuityValue,
    conservative: bookValueBeginning + explicitPresentValue + fadeValue / horizon,
    optimistic: bookValueBeginning + explicitPresentValue + perpetuityValue / horizon,
  };
}

const EXPECTED_SCENARIO_FORMULA = "book_value_beginning"
  + " + sum(residual_income_proxy_t / (1 + discount_rate)^t for t in fy1..fy3)"
  + " + continuing_value / (1 + discount_rate)^3";

function validateValuationRange(item, id, errors, payload) {
  const range = item?.derived?.valuation_range_v1;
  if (!range) {
    errors.push(`${id}.valuation_range_v1: a primary index must report a range block, even when refused`);
    return;
  }
  if (range.schema_version !== VALUATION_RANGE_SCHEMA) {
    errors.push(`${id}.valuation_range_v1: schema_version must be ${VALUATION_RANGE_SCHEMA}`);
  }
  if (range.emits_single_target !== false) {
    errors.push(`${id}.valuation_range_v1: emits_single_target must be false`);
  }
  // Recursive, over the whole block. A direct-key check let a nested
  // `notes[0].point_target` through, which is the same number in a costume.
  for (const path of findForbiddenTargetKeyPaths(range)) {
    errors.push(`${id}.valuation_range_v1: forbidden single-target key at ${path}`);
  }

  const gates = range.gates ?? {};
  const declaredGateKeys = Object.keys(gates).sort();
  if (declaredGateKeys.join(",") !== [...REQUIRED_RANGE_GATES].sort().join(",")) {
    errors.push(
      `${id}.valuation_range_v1: gates must be exactly ${REQUIRED_RANGE_GATES.join(", ")};`
      + ` found ${declaredGateKeys.join(", ") || "(none)"}`,
    );
  }
  const failedGates = Object.entries(gates).filter(([, gate]) => gate?.passed !== true).map(([key]) => key);
  for (const [key, gate] of Object.entries(gates)) {
    if (gate?.passed !== true && !String(gate?.reason ?? "").trim()) {
      errors.push(`${id}.valuation_range_v1: failed gate ${key} must state a reason`);
    }
  }

  // MEASURED, not declared. Everything below is recomputed from the payload the
  // range sits inside, so a hand-edited `passed: true` or a typed-in date cannot
  // survive review just by being internally consistent.
  const measuredBlockersEmpty = Array.isArray(item?.blockers) && item.blockers.length === 0;
  if (gates.blockers_empty?.passed !== measuredBlockersEmpty) {
    errors.push(
      `${id}.valuation_range_v1: gate blockers_empty declares ${gates.blockers_empty?.passed}`
      + ` but the index carries ${item?.blockers?.length ?? 0} blocker(s)`,
    );
  }
  const measuredClocks = collectRangeSourceClocks({
    observed: item?.observed,
    forecastGrid: item?.derived?.forecast_grid_v1,
    payoutRatio: item?.derived?.payout_ratio,
    legacyPayoutRatio: item?.derived?.legacy_payout_ratio_qa,
    generatedAt: payload?.generated_at,
  });
  const measuredDatedClocks = measuredClocks.filter((row) => isIsoDay(row.as_of));
  const measuredAsOf = measuredDatedClocks.map((row) => row.as_of).sort()[0] ?? null;

  // EXACT TUPLES, both directions. Matching on `source` alone let route, kind,
  // and duplicate entries drift without anything noticing.
  const declaredClocks = Array.isArray(range.source_clock?.contributing_sources)
    ? range.source_clock.contributing_sources
    : [];
  const declaredTupleCounts = new Map();
  for (const row of declaredClocks) {
    const key = clockTupleKey(row);
    declaredTupleCounts.set(key, (declaredTupleCounts.get(key) ?? 0) + 1);
  }
  const declaredPairCounts = new Map();
  for (const row of declaredClocks) {
    const pair = `${row?.source}|${row?.route}`;
    declaredPairCounts.set(pair, (declaredPairCounts.get(pair) ?? 0) + 1);
  }
  for (const [pair, count] of declaredPairCounts) {
    if (count > 1) {
      errors.push(`${id}.valuation_range_v1: source clock declares ${pair.replace("|", " on route ")} ${count} times`);
    }
  }
  const measuredTupleCounts = new Map();
  for (const row of measuredClocks) {
    const key = clockTupleKey(row);
    measuredTupleCounts.set(key, (measuredTupleCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of measuredTupleCounts) {
    if ((declaredTupleCounts.get(key) ?? 0) !== count) {
      const [source, route, kind, asOf] = JSON.parse(key);
      errors.push(
        `${id}.valuation_range_v1: source clock omits contributing source ${source}`
        + ` (route ${route}, kind ${kind}, as_of ${asOf})`,
      );
    }
  }
  for (const [key] of declaredTupleCounts) {
    if (!measuredTupleCounts.has(key)) {
      const [source, route, kind, asOf] = JSON.parse(key);
      errors.push(
        `${id}.valuation_range_v1: source clock declares ${source} (route ${route}, kind ${kind},`
        + ` as_of ${asOf}), which is not a contributing route`,
      );
    }
  }

  // Derived clock fields recomputed from that exact inventory, never trusted.
  const expectedDates = measuredDatedClocks.map((row) => row.as_of);
  const declaredDates = Array.isArray(range.source_clock?.contributing_source_dates)
    ? range.source_clock.contributing_source_dates
    : null;
  if (!declaredDates || JSON.stringify(declaredDates) !== JSON.stringify(expectedDates)) {
    errors.push(
      `${id}.valuation_range_v1: contributing_source_dates does not recompute from the clock inventory`,
    );
  }
  const expectedOldestSource = measuredDatedClocks[0]?.source ?? null;
  if ((range.source_clock?.oldest_source ?? null) !== expectedOldestSource) {
    errors.push(
      `${id}.valuation_range_v1: oldest_source ${range.source_clock?.oldest_source} does not recompute`
      + ` (expected ${expectedOldestSource})`,
    );
  }
  const inventoryFailures = rangeClockInventoryFailures(measuredClocks);
  const measuredClockHonest = inventoryFailures.length === 0
    && Boolean(measuredAsOf)
    && Object.values(item?.observed ?? {}).every((field) => isIsoDay(field?.as_of));
  if (gates.source_clock_honest?.passed !== measuredClockHonest) {
    errors.push(
      `${id}.valuation_range_v1: gate source_clock_honest declares ${gates.source_clock_honest?.passed}`
      + ` but the required clock inventory says ${measuredClockHonest}`
      + (inventoryFailures.length ? ` (${inventoryFailures.join("; ")})` : ""),
    );
  }
  if (measuredAsOf && range.as_of !== measuredAsOf) {
    errors.push(
      `${id}.valuation_range_v1: as_of ${range.as_of} is not the oldest contributing operand date ${measuredAsOf}`,
    );
  }
  if (measuredAsOf && range.source_clock?.as_of !== measuredAsOf) {
    errors.push(
      `${id}.valuation_range_v1: source_clock.as_of ${range.source_clock?.as_of} must equal the oldest`
      + ` contributing clock ${measuredAsOf}`,
    );
  }
  const measuredPrimary = PRIMARY_INDICES.some((row) => row.id === id);
  if (gates.primary_index?.passed !== measuredPrimary) {
    errors.push(`${id}.valuation_range_v1: gate primary_index does not match the index role`);
  }
  const measuredTierSatisfied = [
    [item?.observed?.price?.source_tier, "observed_source"],
    [item?.observed?.price_to_book?.source_tier, "observed_source"],
    [item?.observed?.risk_free_rate?.source_tier, "observed_source"],
    [item?.observed?.equity_risk_premium?.source_tier, "observed_source"],
    [item?.derived?.cost_of_equity?.source_tier, "derived_formula"],
  ].every(([actual, expected]) => actual === expected);
  if (gates.source_tier_satisfied?.passed !== measuredTierSatisfied) {
    errors.push(
      `${id}.valuation_range_v1: gate source_tier_satisfied declares ${gates.source_tier_satisfied?.passed}`
      + ` but the published source tiers say ${measuredTierSatisfied}`,
    );
  }
  const measuredGridPeriods = item?.derived?.forecast_grid_v1?.periods ?? [];
  const measuredResidualIncome = measuredGridPeriods.map((row) => row?.residual_income_proxy?.value);
  const measuredBookValue = measuredGridPeriods[0]?.book_value_beginning?.value;
  const measuredCostOfEquity = item?.derived?.cost_of_equity?.value;
  const measuredOperandsComplete = finite(measuredBookValue) && measuredBookValue > 0
    && finite(measuredCostOfEquity) && measuredCostOfEquity > TERMINAL_GROWTH_OPTIMISTIC
    && measuredResidualIncome.length === 3
    && measuredResidualIncome.every((value) => finite(value))
    && measuredResidualIncome.at(-1) > 0;
  if (gates.operands_complete?.passed !== measuredOperandsComplete) {
    errors.push(
      `${id}.valuation_range_v1: gate operands_complete declares ${gates.operands_complete?.passed}`
      + ` but the published operands say ${measuredOperandsComplete}`,
    );
  }
  // Rederived from the SOURCE operands, not read from operands.payout_cross_check.
  // Trusting the published divergence would let a payload declare its own
  // agreement, which is exactly how a 15.44% payout gap passed as reconciled.
  const crossCheck = range.operands?.payout_cross_check;
  const sourcePayout = item?.derived?.payout_ratio?.value;
  const sourceLegacyPayout = item?.derived?.legacy_payout_ratio_qa?.value;
  const sourceUnitMix = item?.derived?.payout_ratio?.coverage?.dividend_yield_unit_mix;
  const sourceWeightedYield = item?.derived?.payout_ratio?.coverage?.weighted_dividend_yield;
  const sourceUnitTotal = sourceUnitMix
    ? sourceUnitMix.percent + sourceUnitMix.fraction + sourceUnitMix.zero + sourceUnitMix.unresolved
    : 0;
  const sourceUnresolvedShare = sourceUnitTotal > 0 ? sourceUnitMix.unresolved / sourceUnitTotal : 1;
  const rederivedPayoutDivergence = payoutRouteDivergence(sourcePayout, sourceLegacyPayout);
  const rederivedRetentionDivergence = retentionRouteDivergence(sourcePayout, sourceLegacyPayout);

  for (const [field, published, rederived] of [
    ["payout_divergence", crossCheck?.payout_divergence, rederivedPayoutDivergence],
    ["retention_divergence", crossCheck?.retention_divergence, rederivedRetentionDivergence],
  ]) {
    if (!finite(rederived)) continue;
    if (!finite(published) || Math.abs(published - rederived) > 1e-5) {
      errors.push(
        `${id}.valuation_range_v1: published ${field} ${published} does not rederive from the payout`
        + ` operands (expected ${round(rederived, 6)})`,
      );
    }
  }

  // PARITY. The builder blocks this gate on collection-clock and route-policy
  // failures; the validator's recomputation must do the same, or a payload whose
  // clock is absent, stale, future-dated, or relabelled can declare the gate
  // passed and the validator will agree with it.
  const measuredReconciliationPolicyFailures = reconciliationClockPolicyFailures(
    item?.derived?.legacy_payout_ratio_qa?.coverage,
    payload?.generated_at,
  );
  if (measuredReconciliationPolicyFailures.length > 0
    && gates.payout_routes_reconciled?.passed === true) {
    errors.push(
      `${id}.valuation_range_v1: payout_routes_reconciled is declared passed while the reconciliation`
      + ` clock policy fails: ${measuredReconciliationPolicyFailures.join("; ")}`,
    );
  }
  const measuredRoutesReconciled = measuredReconciliationPolicyFailures.length === 0
    && finite(rederivedPayoutDivergence)
    && rederivedPayoutDivergence <= PAYOUT_ROUTE_DIVERGENCE_LIMIT
    && finite(sourceWeightedYield)
    && sourceWeightedYield > 0
    && sourceWeightedYield <= MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD
    && sourceUnresolvedShare <= MAX_UNRESOLVED_DIVIDEND_UNIT_SHARE
    && finite(sourcePayout)
    && sourcePayout > 0
    && sourcePayout < 1;
  if (gates.payout_routes_reconciled?.passed !== measuredRoutesReconciled) {
    errors.push(
      `${id}.valuation_range_v1: gate payout_routes_reconciled declares`
      + ` ${gates.payout_routes_reconciled?.passed} but the rederived payout divergence`
      + ` ${round(rederivedPayoutDivergence, 6)} says ${measuredRoutesReconciled}`,
    );
  }
  const measuredSensitivityBounded = finite(rederivedRetentionDivergence)
    && rederivedRetentionDivergence <= PAYOUT_RETENTION_DIVERGENCE_LIMIT;
  if (gates.model_sensitivity_bounded?.passed !== measuredSensitivityBounded) {
    errors.push(
      `${id}.valuation_range_v1: gate model_sensitivity_bounded declares`
      + ` ${gates.model_sensitivity_bounded?.passed} but the rederived retention divergence says`
      + ` ${measuredSensitivityBounded}`,
    );
  }

  if (range.public_status === "blocked_no_range") {
    if (failedGates.length === 0) {
      errors.push(`${id}.valuation_range_v1: a refused range must name at least one failed gate`);
    }
    if (range.range?.low !== null || range.range?.high !== null) {
      errors.push(`${id}.valuation_range_v1: a refused range must publish null endpoints`);
    }
    if (!Array.isArray(range.scenarios) || range.scenarios.length !== 0) {
      errors.push(`${id}.valuation_range_v1: a refused range must publish no scenarios`);
    }
    return;
  }

  if (range.public_status !== "ready_range_no_single_target") {
    errors.push(`${id}.valuation_range_v1: invalid public_status ${range.public_status ?? "(missing)"}`);
    return;
  }
  if (failedGates.length > 0) {
    errors.push(
      `${id}.valuation_range_v1: ready status requires every gate to pass, but ${failedGates.join(", ")} failed`,
    );
  }

  const scenarios = Array.isArray(range.scenarios) ? range.scenarios : [];
  if (scenarios.length !== REQUIRED_RANGE_SCENARIOS.length) {
    errors.push(
      `${id}.valuation_range_v1: exactly ${REQUIRED_RANGE_SCENARIOS.length} endpoint scenarios are allowed;`
      + ` a middle scenario would be read as a single target`,
    );
    return;
  }
  if (scenarios.map((row) => row?.id).join(",") !== REQUIRED_RANGE_SCENARIOS.join(",")) {
    errors.push(`${id}.valuation_range_v1: scenario ids must be ${REQUIRED_RANGE_SCENARIOS.join(", ")}`);
  }
  for (const scenario of scenarios) {
    if (!finite(scenario?.value)) errors.push(`${id}.valuation_range_v1.${scenario?.id}: finite scenario value required`);
    if (scenario?.source_tier !== "assumption_labelled_scenario") {
      errors.push(`${id}.valuation_range_v1.${scenario?.id}: assumption_labelled_scenario tier required`);
    }
    if (scenario?.assumption_version !== ASSUMPTION_VERSION) {
      errors.push(`${id}.valuation_range_v1.${scenario?.id}: assumption_version must be ${ASSUMPTION_VERSION}`);
    }
  }

  const [low, high] = scenarios.map((row) => row?.value);
  if (range.range?.low !== low || range.range?.high !== high) {
    errors.push(`${id}.valuation_range_v1: range endpoints must equal the two scenario values`);
  }
  if (finite(low) && finite(high) && !(low < high)) {
    errors.push(`${id}.valuation_range_v1: range endpoints must differ; a collapsed range is a single target`);
  }
  if (!isIsoDay(range.as_of)) {
    errors.push(`${id}.valuation_range_v1: as_of must be an ISO day taken from the oldest operand`);
  }
  if (range.source_clock?.basis !== "oldest_contributing_observed_source") {
    errors.push(`${id}.valuation_range_v1: source clock must be the oldest contributing observed source`);
  }
  if (range.assumptions?.terminal_growth?.source_tier !== "house_assumption"
    || range.assumptions?.fade_years?.source_tier !== "house_assumption") {
    errors.push(`${id}.valuation_range_v1: terminal growth and fade years must be labelled house assumptions`);
  }
  if (range.assumptions?.discount_rate?.value !== item?.derived?.cost_of_equity?.value) {
    errors.push(`${id}.valuation_range_v1: the discount rate must be the published cost of equity`);
  }
  const publishedResidualIncome = (item?.derived?.forecast_grid_v1?.periods ?? [])
    .map((row) => row?.residual_income_proxy?.value);
  const operandResidualIncome = (range.operands?.residual_income_by_period ?? []).map((row) => row?.value);
  if (JSON.stringify(publishedResidualIncome) !== JSON.stringify(operandResidualIncome)) {
    errors.push(`${id}.valuation_range_v1: operands must equal the published residual_income_proxy values`);
  }
  const publishedBookValue = item?.derived?.forecast_grid_v1?.periods?.[0]?.book_value_beginning?.value;
  if (range.operands?.book_value_beginning?.value !== publishedBookValue) {
    errors.push(
      `${id}.valuation_range_v1: operand book_value_beginning ${range.operands?.book_value_beginning?.value}`
      + ` does not match the published grid value ${publishedBookValue}`,
    );
  }

  const terminalGrowthHigh = range.assumptions?.terminal_growth?.high;
  const terminalGrowthLow = range.assumptions?.terminal_growth?.low;
  const discountRate = range.assumptions?.discount_rate?.value;
  if (!finite(terminalGrowthHigh) || !finite(discountRate) || !(terminalGrowthHigh < discountRate)) {
    errors.push(
      `${id}.valuation_range_v1: terminal growth ${terminalGrowthHigh} must stay below the discount rate`
      + ` ${discountRate}; at or above it the perpetuity is undefined or negative`,
    );
  } else if (
    finite(publishedBookValue)
    && operandResidualIncome.length === 3
    && operandResidualIncome.every((value) => finite(value))
    && finite(terminalGrowthLow)
    && finite(range.assumptions?.fade_years?.value)
  ) {
    const fadeYears = range.assumptions.fade_years.value;
    // Independent oracle. Not the producer's calculator.
    const oracle = validatorScenarioOracle({
      bookValueBeginning: publishedBookValue,
      residualIncome: operandResidualIncome,
      discountRate,
      growthLow: terminalGrowthLow,
      growthHigh: terminalGrowthHigh,
      fadeYears,
    });
    const expectations = [
      { scenario: scenarios[0], value: oracle.conservative, continuing: oracle.conservativeContinuingValue, growth: terminalGrowthLow },
      { scenario: scenarios[1], value: oracle.optimistic, continuing: oracle.optimisticContinuingValue, growth: terminalGrowthHigh },
    ];
    for (const { scenario, value, continuing, growth } of expectations) {
      if (!finite(scenario?.value) || Math.abs(scenario.value - value) > 0.05) {
        errors.push(
          `${id}.valuation_range_v1.${scenario?.id}: published scenario value ${scenario?.value}`
          + ` does not recompute from the published operands (expected ${round(value, 2)})`,
        );
      }
      // The intermediate the endpoint was built from must also survive review.
      // Tampering with it alone used to leave the endpoint agreeing with itself.
      if (!finite(scenario?.continuing_value_at_fy3)
        || Math.abs(scenario.continuing_value_at_fy3 - continuing) > 0.05) {
        errors.push(
          `${id}.valuation_range_v1.${scenario?.id}: continuing_value_at_fy3`
          + ` ${scenario?.continuing_value_at_fy3} does not recompute (expected ${round(continuing, 2)})`,
        );
      }
      if (scenario?.terminal_growth !== growth) {
        errors.push(
          `${id}.valuation_range_v1.${scenario?.id}: terminal_growth ${scenario?.terminal_growth}`
          + ` does not match the declared assumption ${growth}`,
        );
      }
      if (scenario?.formula !== EXPECTED_SCENARIO_FORMULA) {
        errors.push(`${id}.valuation_range_v1.${scenario?.id}: formula is not the contract formula`);
      }
      if (typeof scenario?.terminal_treatment !== "string" || !scenario.terminal_treatment.trim()) {
        errors.push(`${id}.valuation_range_v1.${scenario?.id}: terminal_treatment must state the terminal rule`);
      }
    }
    // The prose must name the numbers it describes, or an assumption can move
    // while the sentence a reader trusts stays put.
    const conservativeTreatment = scenarios[0]?.terminal_treatment ?? "";
    if (!conservativeTreatment.includes(String(fadeYears))) {
      errors.push(`${id}.valuation_range_v1.conservative: terminal_treatment must name the fade years ${fadeYears}`);
    }
    const optimisticTreatment = scenarios[1]?.terminal_treatment ?? "";
    if (!optimisticTreatment.includes(String(terminalGrowthHigh))) {
      errors.push(`${id}.valuation_range_v1.optimistic: terminal_treatment must name the terminal growth ${terminalGrowthHigh}`);
    }
    if (finite(range.operands?.discount_rate?.value) && range.operands.discount_rate.value !== discountRate) {
      errors.push(`${id}.valuation_range_v1: operand discount_rate disagrees with the declared assumption`);
    }
  }

  // Recompute the model chain the band rests on, period by period. Endpoint
  // agreement alone would still accept a grid whose book roll-forward, ROE, or
  // residual income were quietly inconsistent underneath it.
  const gridPeriods = item?.derived?.forecast_grid_v1?.periods ?? [];
  for (const [index, period] of gridPeriods.entries()) {
    const beginning = period?.book_value_beginning?.value;
    const earnings = period?.earnings_proxy?.value;
    const payout = period?.payout_ratio?.value;
    const retention = period?.retention_ratio?.value;
    const ending = period?.book_value_ending?.value;
    const roe = period?.roe_on_beginning_book?.value;
    const residualIncome = period?.residual_income_proxy?.value;
    if (![beginning, earnings, payout, retention, ending, roe, residualIncome].every((value) => finite(value))) {
      continue;
    }
    if (Math.abs(retention - (1 - payout)) > 1e-5) {
      errors.push(`${id}.forecast_grid_v1.${period.period}: retention ${retention} is not 1 - payout ${payout}`);
    }
    if (Math.abs(ending - (beginning + earnings * retention)) > 1e-2) {
      errors.push(
        `${id}.forecast_grid_v1.${period.period}: book roll-forward ${ending} does not recompute from`
        + ` ${beginning} + ${earnings} * ${retention}`,
      );
    }
    if (Math.abs(roe - earnings / beginning) > 1e-5) {
      errors.push(`${id}.forecast_grid_v1.${period.period}: roe ${roe} does not recompute from earnings / book`);
    }
    if (finite(discountRate) && Math.abs(residualIncome - (roe - discountRate) * beginning) > 1e-2) {
      errors.push(
        `${id}.forecast_grid_v1.${period.period}: residual income ${residualIncome} does not recompute from`
        + ` (roe - discount_rate) * book_value_beginning`,
      );
    }
    const previousEnding = gridPeriods[index - 1]?.book_value_ending?.value;
    if (index > 0 && finite(previousEnding) && Math.abs(beginning - previousEnding) > 1e-2) {
      errors.push(
        `${id}.forecast_grid_v1.${period.period}: opening book ${beginning} does not continue the prior`
        + ` period's closing book ${previousEnding}`,
      );
    }
  }

  if (finite(low) && finite(high) && low > 0) {
    const expectedWidth = round(high / low, 4);
    if (finite(range.range?.width_ratio) && Math.abs(range.range.width_ratio - expectedWidth) > 1e-3) {
      errors.push(`${id}.valuation_range_v1: width_ratio ${range.range.width_ratio} does not recompute (${expectedWidth})`);
    }
    const observedPrice = item?.observed?.price?.value;
    if (finite(observedPrice)) {
      const expectedPosition = observedPrice < low ? "below_range" : observedPrice > high ? "above_range" : "within_range";
      if (range.price_context?.position !== expectedPosition) {
        errors.push(
          `${id}.valuation_range_v1: price position ${range.price_context?.position} does not recompute`
          + ` from price ${observedPrice} against ${low}~${high} (expected ${expectedPosition})`,
        );
      }
      if (range.price_context?.observed_price !== observedPrice) {
        errors.push(`${id}.valuation_range_v1: price_context.observed_price does not match the observed price`);
      }
    }
  }
}

function validateCcmpDirectForecastGrid(item, payload, errors) {
  const grid = item?.derived?.forecast_grid_v1;
  const periods = Array.isArray(grid?.periods) ? grid.periods : [];
  if (periods.length === 0) {
    if (grid?.schema_version !== "forecast_grid_v1") errors.push("CCMP.forecast_grid_v1: schema_version required");
    if (grid?.source_tier !== "blocked_missing_source") errors.push("CCMP.forecast_grid_v1: blocked_missing_source tier required");
    if (grid?.public_status !== "blocked_missing_direct_forecast") {
      errors.push("CCMP.forecast_grid_v1: blocked_missing_direct_forecast status required");
    }
    if (typeof grid?.reason !== "string" || !grid.reason.trim()) {
      errors.push("CCMP.forecast_grid_v1: blocked forecast requires a reason");
    }
    return false;
  }
  if (grid?.schema_version !== "forecast_grid_v1") errors.push("CCMP.forecast_grid_v1: schema_version required");
  if (grid?.source_tier !== "direct_index_source") errors.push("CCMP.forecast_grid_v1: direct_index_source tier required");
  if (grid?.public_status !== "ready_inputs_only_no_fair_value") {
    errors.push("CCMP.forecast_grid_v1: ready_inputs_only_no_fair_value status required");
  }
  if (periods.length !== 3) {
    errors.push("CCMP.forecast_grid_v1: exactly 3 direct periods required");
    return false;
  }
  const expectedPeriods = ["fy1", "fy2", "fy3"];
  const expectedSources = ["best_eps", "best_eps_fy2", "best_eps_fy3"];
  const expectedFormulas = {
    book_value_beginning: ["current_price / benchmark_px_to_book_ratio", "prior_period_book_value_ending", "prior_period_book_value_ending"],
    book_value_ending: "book_value_beginning + earnings_proxy * (1 - payout_ratio)",
    roe_on_beginning_book: "earnings_proxy / book_value_beginning",
    direct_index_roe: "earnings_proxy / book_value_beginning",
    payout_ratio: "derived.payout_ratio",
    retention_ratio: "1 - payout_ratio",
    dividend_yield_implied: "payout_ratio * (earnings_proxy / current_price)",
    pe_ratio: "current_price / earnings_proxy",
    peg_ratio: "pe_ratio / (derived.explicit_eps_growth_3y * 100)",
    residual_income_proxy: "(roe_on_beginning_book - cost_of_equity) * book_value_beginning",
  };
  const directAsOf = grid.coverage?.best_eps_asof;
  if (!isRealCalendarDate(directAsOf)) errors.push("CCMP.forecast_grid_v1.coverage.best_eps_asof: real source date required");
  if (grid.coverage?.source_tier !== "direct_index_source") errors.push("CCMP.forecast_grid_v1.coverage: direct_index_source tier required");
  if (grid.coverage?.availability_status !== "available") errors.push("CCMP.forecast_grid_v1.coverage: available status required");
  const exactSpot = item.observed?.price?.value;
  const exactSpotAsOf = item.observed?.price?.as_of;
  const priceToBook = item.observed?.price_to_book?.value;
  const payout = item.derived?.payout_ratio?.value;
  const costOfEquity = item.derived?.cost_of_equity?.value;
  const explicitGrowth = item.derived?.explicit_eps_growth_3y?.value;
  if (isRealCalendarDate(directAsOf) && isRealCalendarDate(exactSpotAsOf) && directAsOf > exactSpotAsOf) {
    errors.push("CCMP.forecast_grid_v1.coverage.best_eps_asof: future relative to exact spot as_of");
  }
  let beginningBook = finite(exactSpot) && finite(priceToBook) && priceToBook > 0 ? exactSpot / priceToBook : null;
  for (const [rowIndex, row] of periods.entries()) {
    const period = expectedPeriods[rowIndex];
    if (row?.period !== period) errors.push(`CCMP.forecast_grid_v1.periods[${rowIndex}]: period must be ${period}`);
    const earnings = row?.earnings_proxy;
    if (earnings?.source_tier !== "observed_source") errors.push(`CCMP.forecast_grid_v1.${period}.earnings_proxy: observed_source tier required`);
    if (earnings?.source_field !== `sections.nasdaq_composite.data[-1].${expectedSources[rowIndex]}`) {
      errors.push(`CCMP.forecast_grid_v1.${period}.earnings_proxy: direct benchmark source_field required`);
    }
    if (earnings?.availability_status !== "available" || earnings?.availability_as_of !== directAsOf) {
      errors.push(`CCMP.forecast_grid_v1.${period}.earnings_proxy: direct availability metadata required`);
    }
    validateObservedSourceDate(earnings, `CCMP.forecast_grid_v1.${period}.earnings_proxy`, payload.generated_at, errors);
    if (directAsOf && earnings?.as_of !== directAsOf) {
      errors.push(`CCMP.forecast_grid_v1.${period}.earnings_proxy: source clock must equal best_eps_asof`);
    }
    if (!finite(earnings?.value) || earnings.value <= 0) {
      errors.push(`CCMP.forecast_grid_v1.${period}.earnings_proxy: positive direct EPS required`);
    }
    const growth = row?.eps_growth;
    if (growth?.source_tier !== "derived_formula") errors.push(`CCMP.forecast_grid_v1.${period}.eps_growth: derived_formula tier required`);
    const expectedGrowthFormula = rowIndex === 0
      ? "direct_benchmark_eps_fy1_growth_not_published"
      : `direct_benchmark_eps_fy${rowIndex}_to_fy${rowIndex + 1} / direct_benchmark_eps_fy${rowIndex}`;
    if (growth?.formula !== expectedGrowthFormula) errors.push(`CCMP.forecast_grid_v1.${period}.eps_growth: direct formula required`);
    if (rowIndex === 0) {
      if (growth?.value !== null) errors.push("CCMP.forecast_grid_v1.fy1.eps_growth: missing direct FY1 growth must remain null");
    } else if (!finite(growth?.value)) {
      errors.push(`CCMP.forecast_grid_v1.${period}.eps_growth: direct adjacent EPS growth required`);
    }
    for (const [key, formula] of Object.entries(expectedFormulas)) {
      const expected = Array.isArray(formula) ? formula[rowIndex] : formula;
      if (row?.[key]?.formula !== expected) errors.push(`CCMP.forecast_grid_v1.${period}.${key}: canonical formula required`);
      if (row?.[key]?.source_tier !== "derived_formula") errors.push(`CCMP.forecast_grid_v1.${period}.${key}: derived_formula tier required`);
    }
    for (const key of ["book_value_beginning", "book_value_ending", "roe_on_beginning_book", "direct_index_roe", "payout_ratio", "retention_ratio", "dividend_yield_implied", "pe_ratio", "peg_ratio", "residual_income_proxy"]) {
      const value = row?.[key]?.value;
      if (value !== null && value !== undefined && !finite(value)) errors.push(`CCMP.forecast_grid_v1.${period}.${key}: finite value required when present`);
    }
    if (finite(earnings?.value) && finite(beginningBook) && finite(payout)) {
      const expectedEndingBook = beginningBook + earnings.value * (1 - payout);
      if (!approximatelyEqual(row.book_value_ending?.value, expectedEndingBook, 1e-3)) {
        errors.push(`CCMP.forecast_grid_v1.${period}.book_value_ending: does not recompute from direct EPS and payout`);
      }
    }
    if (finite(earnings?.value) && finite(beginningBook) && beginningBook > 0
      && !approximatelyEqual(row.roe_on_beginning_book?.value, earnings.value / beginningBook, 1e-6)) {
      errors.push(`CCMP.forecast_grid_v1.${period}.roe_on_beginning_book: does not recompute from direct EPS and book`);
    }
    if (finite(payout) && !approximatelyEqual(row.payout_ratio?.value, payout, 1e-9)) {
      errors.push(`CCMP.forecast_grid_v1.${period}.payout_ratio: does not match derived payout_ratio`);
    }
    if (finite(payout) && !approximatelyEqual(row.retention_ratio?.value, 1 - payout, 1e-9)) {
      errors.push(`CCMP.forecast_grid_v1.${period}.retention_ratio: does not recompute as 1 - payout`);
    }
    if (finite(explicitGrowth) && explicitGrowth > 0 && finite(row.pe_ratio?.value)
      && !approximatelyEqual(row.peg_ratio?.value, row.pe_ratio.value / (explicitGrowth * 100), 1e-4)) {
      errors.push(`CCMP.forecast_grid_v1.${period}.peg_ratio: does not recompute from explicit direct growth`);
    }
    if (finite(row.book_value_ending?.value)) beginningBook = row.book_value_ending.value;
  }
  const gridText = JSON.stringify(grid);
  if (/methodology_derived_index_weight_source|proxy_diagnostic|proxy_inputs_v1|QQQ|ONEQ/i.test(gridText)) {
    errors.push("CCMP.forecast_grid_v1: proxy or methodology source is forbidden on direct output");
  }
  return true;
}

function validateCcmpIndex(item, payload, errors, warnings) {
  if (!item) {
    errors.push("CCMP: index payload missing");
    return;
  }
  if (item.id !== "CCMP") errors.push("CCMP: identity mismatch");
  if (item.role !== "secondary_input_only") errors.push("CCMP: secondary_input_only role required");
  if (!Array.isArray(item.blockers)) errors.push("CCMP: blockers must be an array");
  if ("valuation_range_v1" in (item.derived ?? {})) errors.push("CCMP: secondary input must not carry a valuation range");
  if (item.derived?.proxy_inputs_v1) errors.push("CCMP: proxy_inputs_v1 must not exist on exact CCMP output");
  const sourceUnavailable = item.blockers?.some((row) => row?.code === "source_unavailable");
  if (sourceUnavailable) {
    validateUnavailableIndexShape(item, "CCMP", errors, warnings, payload);
    return;
  }
  const ready = item.public_status === "ready_inputs_and_forecast_grid";
  const caveat = item.public_status === "input_only_ccmp_direct_with_caveats";
  if (!ready && !caveat) errors.push(`CCMP: invalid public_status ${item.public_status ?? "(missing)"}`);
  if (ready && item.blockers?.length) errors.push("CCMP: false-ready: direct CCMP has blockers");
  if (!ready && item.blockers?.length) warnings.push(`CCMP: ${item.public_status}; ${item.blockers.length} lane blocker(s)`);

  for (const key of ["price", "benchmark_price", "forward_eps", "forward_pe", "price_to_book", "roe"]) {
    const field = item.observed?.[key];
    if (!["forward_pe", "roe"].includes(key)) {
      if (!finite(field?.value) || field.value <= 0) errors.push(`CCMP.${key}: positive observed value required`);
    } else if (field?.value !== null && field?.value !== undefined && !finite(field.value)) {
      errors.push(`CCMP.${key}: finite observed value required when present`);
    }
    if (field?.source_tier !== "observed_source") errors.push(`CCMP.${key}: observed_source tier required`);
    if (typeof field?.source !== "string" || !field.source.trim()) errors.push(`CCMP.${key}: source is required`);
    if (typeof field?.source_field !== "string" || !field.source_field.trim()) errors.push(`CCMP.${key}: source_field is required`);
    validateObservedSourceDate(field, `CCMP.${key}`, payload.generated_at, errors);
    validateObservedFreshness(field, `CCMP.${key}`, payload.generated_at, errors, key === "price" ? "us_market" : "us_market");
    if (key === "price") validateExactSpotIdentity(field, "CCMP", errors);
  }
  const spotAsOf = item.observed?.price?.as_of;
  const payout = item.derived?.payout_ratio;
  const payoutAvailable = finite(payout?.value);
  if (!payoutAvailable) {
    if (payout?.source_tier !== "blocked_missing_source") errors.push("CCMP.payout_ratio: blocked_missing_source tier required when unavailable");
    if (typeof payout?.reason !== "string" || !payout.reason.trim()) errors.push("CCMP.payout_ratio: blocked value requires a reason");
    if (!item.blockers?.some((row) => row?.code === "ccmp_measured_index_yield_unavailable")) {
      errors.push("CCMP.payout_ratio: measured FRED yield blocker is required when unavailable");
    }
  } else {
    if (payout.source_tier !== "derived_formula") errors.push("CCMP.payout_ratio: derived_formula tier required");
    if (payout.formula !== "trailing_measured_index_dividend_yield * exact_spot / benchmark_best_eps") {
      errors.push("CCMP.payout_ratio: exact FRED measured-yield formula required");
    }
    const coverage = payout.coverage;
    const yieldValue = coverage?.dividend_yield;
    if (!finite(yieldValue) || yieldValue < 0 || yieldValue > MAX_PLAUSIBLE_INDEX_DIVIDEND_YIELD) {
      errors.push("CCMP.payout_ratio: measured dividend yield is outside the plausibility gate");
    }
    const exactSpotValue = finite(coverage?.exact_spot_value) ? coverage.exact_spot_value : item.observed.price.value;
    if (!approximatelyEqual(payout.value, yieldValue * exactSpotValue / item.observed.forward_eps.value, 1e-10)) {
      errors.push("CCMP.payout_ratio: value does not recompute from exact spot, measured yield, and FY1 EPS");
    }
    if (coverage?.availability_status !== "available" || coverage?.availability_as_of !== coverage?.dividend_yield_as_of) {
      errors.push("CCMP.payout_ratio: availability metadata must identify the measured yield date");
    }
    if (coverage?.dividend_yield_as_of !== spotAsOf || coverage?.exact_spot_as_of !== spotAsOf) {
      errors.push("CCMP.payout_ratio: FRED yield and exact spot must share the spot as_of date");
    }
    const clocks = coverage?.source_clocks;
    for (const key of ["total_return_last_observation", "price_return_last_observation", "aligned_last_observation", "requested_as_of", "used_observation", "anchor_observation", "first_knowable_at", "all_used_inputs_at_or_before"]) {
      if (!isRealCalendarDate(clocks?.[key])) errors.push(`CCMP.payout_ratio.source_clocks.${key}: real date required`);
      else if (clocks[key] > spotAsOf) errors.push(`CCMP.payout_ratio.source_clocks.${key}: future source date is forbidden`);
    }
    if (clocks?.requested_as_of !== spotAsOf || clocks?.used_observation !== spotAsOf || clocks?.all_used_inputs_at_or_before !== spotAsOf) {
      errors.push("CCMP.payout_ratio.source_clocks: exact spot as_of alignment is required");
    }
    if (Array.isArray(payout.sources) && payout.sources.some((source) => /QQQ|ONEQ|proxy|fallback/i.test(source))) {
      errors.push("CCMP.payout_ratio: QQQ/proxy/fallback source is forbidden");
    }
  }

  const rates = ["risk_free_rate", "equity_risk_premium"];
  for (const key of rates) {
    const field = item.observed?.[key];
    if (field?.value === null || field?.value === undefined) {
      if (field?.source_tier !== "blocked_missing_source") errors.push(`CCMP.${key}: blocked_missing_source tier required when unavailable`);
      continue;
    }
    if (!finite(field.value) || field.value <= 0) errors.push(`CCMP.${key}: positive finite observed value required`);
    if (field.source_tier !== "observed_source") errors.push(`CCMP.${key}: observed_source tier required`);
    validateObservedSourceDate(field, `CCMP.${key}`, payload.generated_at, errors);
    if (field.availability_status !== "available" || field.availability_as_of !== field.as_of) {
      errors.push(`CCMP.${key}: availability metadata must match as_of`);
    }
  }
  if (item.observed?.risk_free_rate?.source_field !== "series.DGS10[-1].value / 100") {
    if (finite(item.observed?.risk_free_rate?.value)) errors.push("CCMP.risk_free_rate: DGS10 source_field required");
  }
  if (item.observed?.equity_risk_premium?.source_field !== "us_erp") {
    if (finite(item.observed?.equity_risk_premium?.value)) errors.push("CCMP.equity_risk_premium: Damodaran us_erp source_field required");
  }
  const cost = item.derived?.cost_of_equity;
  const costAvailable = finite(cost?.value);
  if (costAvailable) {
    if (cost.source_tier !== "derived_formula") errors.push("CCMP.cost_of_equity: derived_formula tier required");
    if (cost.formula !== "risk_free_rate + equity_risk_premium") errors.push("CCMP.cost_of_equity: canonical formula required");
    if (!finite(item.observed.risk_free_rate?.value) || !finite(item.observed.equity_risk_premium?.value)
      || !approximatelyEqual(cost.value, item.observed.risk_free_rate.value + item.observed.equity_risk_premium.value, 1e-9)) {
      errors.push("CCMP.cost_of_equity: value does not recompute from US DGS10 and ERP");
    }
  } else if (cost?.source_tier !== "blocked_missing_source") {
    errors.push("CCMP.cost_of_equity: blocked_missing_source tier required when unavailable");
  }

  const explicit = item.derived?.explicit_eps_growth_3y;
  const explicitAvailable = finite(explicit?.value);
  if (explicitAvailable) {
    if (explicit.source_tier !== "derived_formula") errors.push("CCMP.explicit_eps_growth_3y: derived_formula tier required");
    if (explicit.coverage?.source_tier !== "direct_index_source") errors.push("CCMP.explicit_eps_growth_3y: direct source marker required");
    const eps1 = explicit.coverage?.eps_fy1;
    const eps3 = explicit.coverage?.eps_fy3;
    if (!finite(eps1) || !finite(eps3) || !approximatelyEqual(explicit.value, (eps3 / eps1) ** (1 / 2) - 1, 1e-10)) {
      errors.push("CCMP.explicit_eps_growth_3y: value does not recompute from direct FY1/FY3 EPS");
    }
    if (!isRealCalendarDate(explicit.coverage?.best_eps_asof) || explicit.coverage.best_eps_asof > spotAsOf) {
      errors.push("CCMP.explicit_eps_growth_3y: direct forecast clock fails PIT");
    }
  } else {
    if (explicit?.source_tier !== "blocked_missing_source") errors.push("CCMP.explicit_eps_growth_3y: blocked_missing_source tier required when unavailable");
    if (typeof explicit?.reason !== "string" || !explicit.reason.trim()) errors.push("CCMP.explicit_eps_growth_3y: blocked value requires a reason");
  }

  const directGrid = validateCcmpDirectForecastGrid(item, payload, errors);
  if (ready !== directGrid || (ready && (!payoutAvailable || !costAvailable))) {
    errors.push("CCMP: public_status does not match direct forecast, payout, and cost availability");
  }
}

function validateKospiDartPayout(item, payload, errors, warnings, minCoveredWeight, ready) {
  const payout = item?.derived?.payout_ratio;
  const coverage = payout?.coverage;
  const pointerBlocker = item?.blockers?.some((row) => row?.code === "kospi_dart_payout_pointer_unavailable");
  if (!finite(payout?.value)) {
    if (payout?.source_tier !== "blocked_missing_source") {
      errors.push("KOSPI.payout_ratio: blocked_missing_source tier required when the DART pointer is unavailable");
    }
    if (typeof payout?.reason !== "string" || !payout.reason.trim()) {
      errors.push("KOSPI.payout_ratio: blocked value requires a reason");
    }
    if (!pointerBlocker) {
      errors.push("KOSPI.payout_ratio: pointer-unavailable blocker is required when no direct payout is available");
    }
    if (coverage?.source_tier !== KOSPI_DART_SOURCE_TIER || coverage?.availability_status !== "blocked") {
      errors.push("KOSPI.payout_ratio: blocked DART coverage metadata is required");
    }
    return;
  }

  if (payout.source_tier !== "derived_formula") errors.push("KOSPI.payout_ratio: derived_formula tier required");
  if (payout.direct_source_tier !== KOSPI_DART_SOURCE_TIER) {
    errors.push(`KOSPI.payout_ratio: ${KOSPI_DART_SOURCE_TIER} direct source marker required`);
  }
  if (payout.formula !== KOSPI_DART_PAYOUT_FORMULA) {
    errors.push("KOSPI.payout_ratio: exact OpenDART artifact formula required");
  }
  if (payout.value < 0 || payout.value > 1) errors.push("KOSPI.payout_ratio: payout must be in [0,1]");
  if (coverage?.source_tier !== KOSPI_DART_SOURCE_TIER) {
    errors.push(`KOSPI.payout_ratio: coverage must carry ${KOSPI_DART_SOURCE_TIER}`);
  }
  if (coverage?.availability_status !== "available"
    || !isRealCalendarDate(coverage?.availability_as_of)
    || payout.availability_status !== "available"
    || payout.availability_as_of !== coverage.availability_as_of) {
    errors.push("KOSPI.payout_ratio: direct availability metadata is required");
  }
  if (!finite(coverage?.covered_weight_ratio) || coverage.covered_weight_ratio < minCoveredWeight
    || coverage.covered_weight_ratio > 1
    || coverage.pass !== true
    || !finite(coverage.gate) || coverage.gate < DEFAULT_MIN_COVERED_WEIGHT
    || coverage.covered_weight_ratio < coverage.gate) {
    if (ready) errors.push("KOSPI.payout_ratio: direct coverage is below the enforced floor");
    else warnings.push("KOSPI.payout_ratio: direct coverage is below the enforced floor");
  }
  if (coverage?.covered_weight !== coverage?.covered_weight_ratio) {
    errors.push("KOSPI.payout_ratio: covered_weight and covered_weight_ratio must match");
  }
  if (coverage?.pointer_path !== KOSPI_DART_POINTER_FILE) {
    errors.push("KOSPI.payout_ratio: exact current pointer path is required");
  }
  if (coverage?.pointer_schema_version !== KOSPI_DART_POINTER_SCHEMA
    || coverage?.artifact_schema_version !== KOSPI_DART_ARTIFACT_SCHEMA) {
    errors.push("KOSPI.payout_ratio: DART pointer/artifact schema mapping is invalid");
  }
  if (!Number.isInteger(coverage?.selected_fy) || coverage.selected_fy < 2000
    || coverage?.selected_artifact !== `${KOSPI_DART_ARTIFACT_ROOT}/fy${coverage.selected_fy}.json`) {
    errors.push("KOSPI.payout_ratio: selected FY artifact path is invalid");
  }
  if (typeof coverage?.pointer_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(coverage.pointer_sha256)) {
    errors.push("KOSPI.payout_ratio: selected artifact SHA-256 is required");
  }
  const clocks = coverage?.source_clocks;
  const clockKeys = [
    "pointer_first_knowable_at",
    "bridge_as_of",
    "benchmark_as_of",
    "availability_as_of",
    "all_used_inputs_at_or_before",
  ];
  for (const key of clockKeys) {
    if (!isRealCalendarDate(clocks?.[key])) errors.push(`KOSPI.payout_ratio.source_clocks.${key}: real date required`);
  }
  const expectedAvailability = [
    clocks?.pointer_first_knowable_at,
    clocks?.bridge_as_of,
    clocks?.benchmark_as_of,
  ].filter((date) => isRealCalendarDate(date)).sort().at(-1);
  if (expectedAvailability !== coverage?.availability_as_of
    || clocks?.availability_as_of !== coverage?.availability_as_of
    || clocks?.all_used_inputs_at_or_before !== coverage?.availability_as_of) {
    errors.push("KOSPI.payout_ratio: availability_as_of must be the latest economic DART source clock");
  }
  const exactSpotAsOf = item?.observed?.price?.as_of;
  if (isRealCalendarDate(coverage?.availability_as_of)
    && isRealCalendarDate(exactSpotAsOf)
    && coverage.availability_as_of > exactSpotAsOf) {
    if (ready) errors.push("KOSPI.payout_ratio: DART availability is after the exact KRX price clock");
    else warnings.push("KOSPI.payout_ratio: DART availability is after the exact KRX price clock");
  }
  if (!finite(coverage?.index_dividend_yield) || coverage.index_dividend_yield < 0
    || !finite(coverage?.earnings_yield) || coverage.earnings_yield <= 0
    || !approximatelyEqual(payout.value, coverage.index_dividend_yield / coverage.earnings_yield, 1e-12)) {
    errors.push("KOSPI.payout_ratio: value must rederive from the selected DART artifact payout operands");
  }
  const bridge = coverage?.provenance?.bridge;
  const benchmark = coverage?.provenance?.benchmark;
  if (typeof bridge?.source !== "string" || !bridge.source.trim()
    || typeof bridge?.source_field !== "string" || !bridge.source_field.trim()
    || !isRealCalendarDate(bridge?.as_of)
    || !Number.isInteger(bridge?.row_count) || bridge.row_count <= 0
    || typeof benchmark?.source !== "string" || !benchmark.source.trim()
    || !isRealCalendarDate(benchmark?.as_of)) {
    errors.push("KOSPI.payout_ratio: bridge and benchmark provenance is required");
  }
  const payoutText = JSON.stringify(payout);
  if (perIssuerKeyPaths(payout).length > 0 || /per_issuer\s*[:=]/i.test(payoutText)) {
    errors.push("KOSPI.payout_ratio: per-issuer data must not reach the top-level payout field");
  }
  if (coverage?.first_knowable_at !== undefined && parseUtcInstant(coverage.first_knowable_at) === null) {
    errors.push("KOSPI.payout_ratio: first_knowable_at must be a strict UTC instant");
  }
  if (coverage?.pointer_batch_date !== undefined && !isRealCalendarDate(coverage.pointer_batch_date)) {
    errors.push("KOSPI.payout_ratio: pointer batch date is invalid");
  }
  if (coverage?.artifact_batch_date !== undefined && !isRealCalendarDate(coverage.artifact_batch_date)) {
    errors.push("KOSPI.payout_ratio: artifact batch date is invalid");
  }
  if (coverage?.first_knowable_at?.slice?.(0, 10) > coverage?.artifact_batch_date) {
    errors.push("KOSPI.payout_ratio: first knowable date cannot follow the artifact batch date");
  }
  if (payload?.indices?.KOSPI?.derived?.legacy_payout_ratio_qa?.sources?.some((source) => source === coverage?.selected_artifact)) {
    warnings.push("KOSPI legacy payout diagnostics unexpectedly name the DART artifact");
  }
}

export function validateRimIndexInputs(payload, { minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT } = {}) {
  const errors = [];
  const warnings = [];
  if (payload?.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (payload?.output_scope !== OUTPUT_SCOPE) errors.push(`output_scope must be ${OUTPUT_SCOPE}`);
  if (payload?.policy?.no_public_single_target !== true) {
    errors.push("policy.no_public_single_target must stay true under the range scope");
  }
  if (!payload?.source_tier_counts || Object.keys(payload.source_tier_counts).length === 0) {
    errors.push("source_tier_counts is required");
  }
  for (const id of ["SPX", "NDX"]) {
    const item = payload?.indices?.[id];
    if (!item) {
      errors.push(`${id}: index payload missing`);
      continue;
    }
    if (item.id !== id) errors.push(`${id}: identity mismatch`);
    if (item.role !== "primary_public_v1") errors.push(`${id}: primary_public_v1 role required`);
    if (!Array.isArray(item.blockers)) errors.push(`${id}: blockers must be an array`);
    validateValuationRange(item, id, errors, payload);
    const sourceUnavailable = item.blockers?.some((row) => row?.code === "source_unavailable");
    if (sourceUnavailable) {
      validateUnavailableIndexShape(item, id, errors, warnings, payload);
      continue;
    }
    const declaredReady = item.public_status === "ready_inputs_and_forecast_grid";
    const declaredDegraded = item.public_status === "input_only_primary_with_caveats";
    if (!declaredReady && !declaredDegraded) {
      errors.push(`${id}: invalid primary public_status ${item.public_status ?? "(missing)"}`);
    }
    const availability = (message) => {
      if (declaredReady) errors.push(`${id}: false-ready: ${message}`);
      else warnings.push(`${id}: ${message}`);
    };
    if (item.blockers?.length) {
      if (declaredReady) errors.push(`${id}: false-ready: primary index has blockers`);
      else warnings.push(`${id}: ${item.blockers.length} lane degradation blocker(s)`);
    }
    for (const key of ["price", "benchmark_price", "forward_eps", "forward_pe", "price_to_book", "roe", "risk_free_rate", "equity_risk_premium"]) {
      const field = item.observed?.[key];
      if (!["forward_pe", "roe"].includes(key)) {
        if (field?.value === null || field?.value === undefined) availability(`${key}: observed value is unavailable`);
        else if (!finite(field.value) || field.value <= 0) errors.push(`${id}.${key}: positive finite observed value required`);
      } else if (field?.value !== null && field?.value !== undefined && !finite(field.value)) {
        errors.push(`${id}.${key}: finite observed value required when present`);
      }
      if (field?.source_tier !== "observed_source") errors.push(`${id}.${key}: observed_source tier required`);
      if (typeof field?.source !== "string" || !field.source.trim()) errors.push(`${id}.${key}: source is required`);
      if (typeof field?.source_field !== "string" || !field.source_field.trim()) errors.push(`${id}.${key}: source_field is required`);
      validateObservedSourceDate(field, `${id}.${key}`, payload.generated_at, errors);
      if (["price", "benchmark_price", "forward_eps", "forward_pe", "price_to_book", "roe"].includes(key)) {
        validateObservedFreshness(
          field,
          `${id}.${key}`,
          payload.generated_at,
          errors,
          key === "price" ? spotFreshnessForId(id, field?.as_of, payload.generated_at).freshness_calendar : "us_market",
        );
      }
      if (key === "price") validateExactSpotIdentity(field, id, errors);
    }
    const spotFreshness = spotFreshnessForId(id, item.observed?.price?.as_of, payload.generated_at);
    if (spotFreshness.future_date_anomaly) errors.push(`${id}: spot source date anomaly`);
    if (spotFreshness.status === "refresh_recommended") {
      const named = item.warnings?.some((row) => row?.code === "spot_source_refresh_recommended");
      if (!named) errors.push(`${id}: stale spot source must be named in warnings`);
      else warnings.push(`${id}: stale spot source; last-known spot retained with as-of disclosed`);
    }
    const benchmarkFreshness = rimObservedPriceFreshness(item.observed?.benchmark_price?.as_of, payload.generated_at);
    if (benchmarkFreshness.future_date_anomaly) errors.push(`${id}: benchmark source date anomaly`);
    if (benchmarkFreshness.status === "refresh_recommended") {
      const named = item.warnings?.some((row) => row?.code === "benchmark_source_refresh_recommended");
      if (!named) errors.push(`${id}: stale benchmark must be named in warnings`);
      else warnings.push(`${id}: stale benchmark source; last-known values retained with as-of disclosed`);
    }
    if (item.derived?.payout_ratio?.source_tier !== "derived_formula") errors.push(`${id}.payout_ratio: derived_formula tier required`);
    if (item.derived?.explicit_eps_growth_3y?.source_tier !== "derived_formula") errors.push(`${id}.explicit_eps_growth_3y: derived_formula tier required`);
    if (item.derived?.cost_of_equity?.source_tier !== "derived_formula") errors.push(`${id}.cost_of_equity: derived_formula tier required`);
    if (item.derived?.cost_of_equity?.value === null || item.derived?.cost_of_equity?.value === undefined) {
      availability("cost_of_equity: value is unavailable");
    } else if (!finite(item.derived.cost_of_equity.value) || item.derived.cost_of_equity.value <= 0) {
      errors.push(`${id}.cost_of_equity: positive finite value required`);
    }
    validateCoreFormulaIntegrity(item, id, errors);
    const growthCoverage = item.derived?.explicit_eps_growth_3y?.coverage?.covered_weight_ratio;
    if (!finite(growthCoverage) || growthCoverage < minCoveredWeight) {
      availability(`explicit_eps_growth_3y: covered_weight_ratio below ${minCoveredWeight}`);
    }
    const payoutCoverage = item.derived?.payout_ratio?.coverage?.covered_weight_ratio;
    if (!finite(payoutCoverage) || payoutCoverage < minCoveredWeight) {
      availability(`payout_ratio: covered_weight_ratio below ${minCoveredWeight}`);
    }
    const grid = item.derived?.forecast_grid_v1;
    if (grid?.schema_version !== "forecast_grid_v1") errors.push(`${id}.forecast_grid_v1: schema_version required`);
    const expectedGridStatus = declaredReady
      ? "ready_inputs_only_no_fair_value"
      : "input_only_primary_with_caveats_no_fair_value";
    if (grid?.public_status !== expectedGridStatus) {
      errors.push(`${id}.forecast_grid_v1: public_status must be ${expectedGridStatus}`);
    }
    if (!Array.isArray(grid?.periods) || grid.periods.length !== 3) {
      errors.push(`${id}.forecast_grid_v1: exactly 3 periods required`);
    } else {
      const expectedPeriods = ["fy1", "fy2", "fy3"];
      const expectedDerivationDepth = ["source_anchored_or_one_step", "chained_roll_forward", "chained_roll_forward"];
      const expectedSourceConfidence = ["source_snapshot_base_effect_sensitive", "compounded_derived", "compounded_derived"];
      const expectedGrowthBasis = ["source_reported_eps_growth_snapshot", "forward_eps_ratio", "forward_eps_ratio"];
      const expectedGrowthUsage = ["context_only_not_earnings_roll_forward", "earnings_path_roll_forward", "earnings_path_roll_forward"];
      const requiredForecastKeys = [
        "earnings_proxy",
        "eps_growth",
        "book_value_beginning",
        "book_value_ending",
        "roe_on_beginning_book",
        "stock_action_weighted_roe",
        "payout_ratio",
        "retention_ratio",
        "dividend_yield_implied",
        "pe_ratio",
        "peg_ratio",
        "residual_income_proxy",
      ];
      for (let rowIndex = 0; rowIndex < grid.periods.length; rowIndex += 1) {
        const row = grid.periods[rowIndex];
        if (row?.period !== expectedPeriods[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.periods[${rowIndex}]: period must be ${expectedPeriods[rowIndex]}`);
        }
        if (row?.derivation_depth !== expectedDerivationDepth[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.derivation_depth: expected ${expectedDerivationDepth[rowIndex]}`);
        }
        if (row?.source_confidence !== expectedSourceConfidence[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.source_confidence: expected ${expectedSourceConfidence[rowIndex]}`);
        }
        if (row?.growth_basis !== expectedGrowthBasis[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.growth_basis: expected ${expectedGrowthBasis[rowIndex]}`);
        }
        if (row?.growth_usage !== expectedGrowthUsage[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.growth_usage: expected ${expectedGrowthUsage[rowIndex]}`);
        }
        for (const key of requiredForecastKeys) {
          const field = row?.[key];
          if (field?.source_tier !== "derived_formula") {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: derived_formula tier required`);
          }
          if (field?.value === null || field?.value === undefined) {
            availability(`forecast_grid_v1.${row?.period ?? rowIndex}.${key}: value is unavailable`);
          } else if (!finite(field.value)) {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: finite value required`);
          }
        }
        const expectedFormulas = {
          earnings_proxy: rowIndex === 0
            ? "benchmark_best_eps_anchor"
            : "prior_period_earnings_proxy * (1 + weighted_forward_eps_growth)",
          eps_growth: rowIndex === 0
            ? "weighted_average(stock_action.estimateSnapshot.epsGrowth.fy1) / 100"
            : `weighted_average((forward_eps_fy${rowIndex + 1} / forward_eps_fy${rowIndex}) - 1)`,
          book_value_beginning: rowIndex === 0
            ? "current_price / benchmark_px_to_book_ratio"
            : "prior_period_book_value_ending",
          book_value_ending: "book_value_beginning + earnings_proxy * (1 - payout_ratio)",
          roe_on_beginning_book: "earnings_proxy / book_value_beginning",
          stock_action_weighted_roe: `weighted_average(stock_action.profitabilitySnapshot.roe.${row?.period}) / 100`,
          payout_ratio: id === "KOSPI"
            ? "derived.payout_ratio"
            : "stock_action_index_weighted_dividend_yield / benchmark_earnings_yield",
          retention_ratio: "1 - payout_ratio",
          dividend_yield_implied: "payout_ratio * (earnings_proxy / current_price)",
          pe_ratio: "current_price / earnings_proxy",
          peg_ratio: "pe_ratio / (derived.explicit_eps_growth_3y * 100)",
          residual_income_proxy: "(roe_on_beginning_book - cost_of_equity) * book_value_beginning",
        };
        for (const [key, formula] of Object.entries(expectedFormulas)) {
          if (row?.[key]?.formula !== formula) {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: canonical formula required`);
          }
        }
        if (row?.peg_ratio?.formula !== "pe_ratio / (derived.explicit_eps_growth_3y * 100)") {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.peg_ratio: canonical explicit_eps_growth_3y formula required`);
        }
        if (!Array.isArray(row?.peg_ratio?.sources) || !row.peg_ratio.sources.includes("derived.explicit_eps_growth_3y")) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.peg_ratio: derived.explicit_eps_growth_3y source required`);
        }
        if (rowIndex === 0) {
          const growthNotes = Array.isArray(row?.eps_growth?.notes) ? row.eps_growth.notes.join(" ") : "";
          const earningsNotes = Array.isArray(row?.earnings_proxy?.notes) ? row.earnings_proxy.notes.join(" ") : "";
          if (!/not applied|not used|not multiplied/i.test(`${growthNotes} ${earningsNotes}`)) {
            errors.push(`${id}.forecast_grid_v1.fy1: eps_growth must disclose that it is not used to roll earnings_proxy`);
          }
        }
        for (const key of ["eps_growth", "stock_action_weighted_roe"]) {
          const coverage = row?.[key]?.coverage?.covered_weight_ratio;
          if (!finite(coverage) || coverage < minCoveredWeight) {
            availability(`forecast_grid_v1.${row?.period ?? rowIndex}.${key}: covered_weight_ratio below ${minCoveredWeight}`);
          }
        }
      }
    }
  }
  // Secondary and backlog lanes stay input-only. Emitting even a refused range
  // for them would invite a consumer to build a card that can never fill.
  for (const id of SECONDARY_INDICES.map((row) => row.id)) {
    if (payload?.indices?.[id]?.derived && "valuation_range_v1" in payload.indices[id].derived) {
      errors.push(`${id}: secondary and backlog indices must not carry a valuation range`);
    }
  }
  validateCcmpIndex(payload?.indices?.CCMP, payload, errors, warnings);
  for (const id of ["KOSPI", "SOX"]) {
    const item = payload?.indices?.[id];
    if (!item) {
      errors.push(`${id}: index payload missing`);
      continue;
    }
    if (item.id !== id) errors.push(`${id}: identity mismatch`);
    if (!Array.isArray(item.blockers)) errors.push(`${id}: blockers must be an array`);
    const sourceUnavailable = item.blockers?.some((row) => row?.code === "source_unavailable");
    if (sourceUnavailable) {
      validateUnavailableIndexShape(item, id, errors, warnings, payload);
      continue;
    }
    const ready = item.public_status === "ready_inputs_and_forecast_grid";
    const caveatStatus = id === "KOSPI"
      ? "input_only_krx_exact_weights_with_caveats"
      : "input_only_sox_methodology_weights_with_caveats";
    const exactInputs = ready || item.public_status === caveatStatus;
    if (!exactInputs && item.public_status !== "blocked_or_input_only") {
      errors.push(`${id}: invalid secondary public_status ${item.public_status ?? "(missing)"}`);
    }
    if (ready && item.blockers?.length) errors.push(`${id}: false-ready: secondary index has blockers`);
    if (!ready && item.blockers?.length) {
      warnings.push(`${id}: ${item.public_status}; ${item.blockers.length} lane blocker(s)`);
    }
    for (const key of ["price", "benchmark_price", "forward_eps", "forward_pe", "price_to_book", "roe"]) {
      const field = item.observed?.[key];
      if (!["forward_pe", "roe"].includes(key)) {
        if (!finite(field?.value) || field.value <= 0) errors.push(`${id}.${key}: positive observed value required`);
      } else if (field?.value !== null && field?.value !== undefined && !finite(field.value)) {
        errors.push(`${id}.${key}: finite observed value required when present`);
      }
      if (field?.source_tier !== "observed_source") errors.push(`${id}.${key}: observed_source tier required`);
      if (typeof field?.source !== "string" || !field.source.trim()) errors.push(`${id}.${key}: source is required`);
      if (typeof field?.source_field !== "string" || !field.source_field.trim()) errors.push(`${id}.${key}: source_field is required`);
      validateObservedSourceDate(field, `${id}.${key}`, payload.generated_at, errors);
      validateObservedFreshness(
        field,
        `${id}.${key}`,
        payload.generated_at,
        errors,
        key === "price" ? spotFreshnessForId(id, field?.as_of, payload.generated_at).freshness_calendar : "us_market",
      );
      if (key === "price") validateExactSpotIdentity(field, id, errors);
    }
    const spotFreshness = spotFreshnessForId(id, item.observed?.price?.as_of, payload.generated_at);
    if (spotFreshness.future_date_anomaly) errors.push(`${id}: spot source date anomaly`);
    if (spotFreshness.status === "refresh_recommended") {
      const named = item.warnings?.some((row) => row?.code === "spot_source_refresh_recommended");
      if (!named) errors.push(`${id}: stale spot source must be named in warnings`);
      else warnings.push(`${id}: stale spot source; last-known spot retained with as-of disclosed`);
    }
    const benchmarkFreshness = rimObservedPriceFreshness(item.observed?.benchmark_price?.as_of, payload.generated_at);
    if (benchmarkFreshness.future_date_anomaly) errors.push(`${id}: benchmark source date anomaly`);
    if (benchmarkFreshness.status === "refresh_recommended") {
      const named = item.warnings?.some((row) => row?.code === "benchmark_source_refresh_recommended");
      if (!named) errors.push(`${id}: stale benchmark must be named in warnings`);
      else warnings.push(`${id}: stale benchmark source; last-known values retained with as-of disclosed`);
    }
    if (id === "KOSPI") {
      validateKospiDartPayout(item, payload, errors, warnings, minCoveredWeight, ready);
    }
    if (!exactInputs) {
      if (item.derived?.book_value?.formula !== "current_price / price_to_book") {
        errors.push(`${id}.book_value: canonical formula required`);
      }
      for (const key of ["payout_ratio", "explicit_eps_growth_3y"]) {
        const field = item.derived?.[key];
        if (field?.value !== null || typeof field?.reason !== "string" || !field.reason.trim()) {
          errors.push(`${id}.${key}: blocked value must be null with a reason`);
        }
      }
      continue;
    }
    const availability = (message) => {
      if (ready) errors.push(`${id}: false-ready: ${message}`);
      else warnings.push(`${id}: ${message}`);
    };
    for (const key of ["risk_free_rate", "equity_risk_premium"]) {
      const field = item.observed?.[key];
      if (field?.value === null || field?.value === undefined) availability(`${key}: observed value is unavailable`);
      else if (!finite(field.value) || field.value <= 0) errors.push(`${id}.${key}: positive observed value required`);
      if (field?.source_tier !== "observed_source") errors.push(`${id}.${key}: observed_source tier required`);
      validateObservedSourceDate(field, `${id}.${key}`, payload.generated_at, errors);
    }
    for (const key of ["payout_ratio", "explicit_eps_growth_3y", "cost_of_equity"]) {
      const field = item.derived?.[key];
      const payoutBlocked = id === "KOSPI" && key === "payout_ratio" && !finite(field?.value);
      if (payoutBlocked) {
        if (field?.source_tier !== "blocked_missing_source") {
          errors.push(`${id}.${key}: blocked_missing_source tier required when the DART pointer is unavailable`);
        }
      } else if (field?.source_tier !== "derived_formula") {
        errors.push(`${id}.${key}: derived_formula tier required`);
      }
    }
    validateCoreFormulaIntegrity(item, id, errors);
    const growthCoverage = item.derived?.explicit_eps_growth_3y?.coverage?.covered_weight_ratio;
    if (!finite(growthCoverage) || growthCoverage < minCoveredWeight) {
      availability(`explicit_eps_growth_3y: covered_weight_ratio below ${minCoveredWeight}`);
    }
    const payoutCoverage = item.derived?.payout_ratio?.coverage?.covered_weight_ratio;
    if (!finite(payoutCoverage) || payoutCoverage < minCoveredWeight) {
      availability(`payout_ratio: covered_weight_ratio below ${minCoveredWeight}`);
    }
    const grid = item.derived?.forecast_grid_v1;
    if (grid?.schema_version !== "forecast_grid_v1") errors.push(`${id}.forecast_grid_v1: schema_version required`);
    const expectedGridStatus = id === "KOSPI"
      ? "input_only_krx_exact_weights_no_fair_value"
      : "input_only_sox_methodology_weights_no_fair_value";
    if (grid?.public_status !== expectedGridStatus) {
      errors.push(`${id}.forecast_grid_v1: public_status must be ${expectedGridStatus}`);
    }
    if (!Array.isArray(grid?.periods) || grid.periods.length !== 3) {
      errors.push(`${id}.forecast_grid_v1: exactly 3 periods required`);
    } else {
      for (const [rowIndex, row] of grid.periods.entries()) {
        if (row?.period !== ["fy1", "fy2", "fy3"][rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.periods[${rowIndex}]: canonical period order required`);
        }
        for (const key of ["earnings_proxy", "eps_growth", "book_value_beginning", "book_value_ending", "roe_on_beginning_book", "stock_action_weighted_roe", "payout_ratio", "retention_ratio", "dividend_yield_implied", "pe_ratio", "peg_ratio", "residual_income_proxy"]) {
          const field = row?.[key];
          if (field?.source_tier !== "derived_formula") {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: derived_formula tier required`);
          }
          if (field?.value === null || field?.value === undefined) availability(`forecast_grid_v1.${row?.period ?? rowIndex}.${key}: value is unavailable`);
          else if (!finite(field.value)) errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: finite value required`);
        }
        if (row?.peg_ratio?.formula !== "pe_ratio / (derived.explicit_eps_growth_3y * 100)") {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.peg_ratio: canonical formula required`);
        }
      }
    }
    if (id === "SOX") {
      if (item.derived?.proxy_inputs_v1) errors.push("SOX.proxy_inputs_v1: must not exist on ready SOX methodology output");
      const diagnostic = payload?.coverage_diagnostics?.stock_action?.SOX;
      if (diagnostic?.index_id !== "SOX") {
        errors.push("SOX coverage diagnostic index_id must be exactly SOX");
      }
      if (diagnostic?.source_tier !== "methodology_derived_index_weight_source") {
        errors.push("SOX coverage diagnostic must use methodology_derived_index_weight_source");
      }
      if (diagnostic?.official_weight_columns_available !== false) {
        errors.push("SOX coverage diagnostic must disclose official_weight_columns_available=false");
      }
      if (grid?.coverage?.index_diagnostics?.index_id !== "SOX") {
        errors.push("SOX forecast_grid_v1.coverage.index_diagnostics.index_id must be exactly SOX");
      }
    }
  }
  const kospiRiskFree = payload?.indices?.KOSPI?.observed?.risk_free_rate;
  const kospiRiskFreeSourceFields = [
    kospiRiskFree?.source,
    kospiRiskFree?.source_field,
    kospiRiskFree?.candidate?.series_id,
  ].filter(Boolean).join(" ");
  if (/\bDGS10\b/i.test(kospiRiskFreeSourceFields)) {
    errors.push("KOSPI must not use DGS10 as risk_free_rate");
  }
  for (const [id, item] of Object.entries(payload?.indices ?? {})) {
    const proxy = item?.derived?.proxy_inputs_v1;
    if (!proxy) continue;
    if (item.public_status === "ready_inputs_and_forecast_grid") {
      errors.push(`${id}.proxy_inputs_v1: proxy inputs must not make the index public-ready`);
    }
    if (!Array.isArray(item.blockers) || item.blockers.length === 0) {
      errors.push(`${id}.proxy_inputs_v1: top-level blockers are required`);
    }
    if (proxy.schema_version !== "proxy_inputs_v1") {
      errors.push(`${id}.proxy_inputs_v1: schema_version required`);
    }
    if (proxy.source_tier !== "proxy_diagnostic") {
      errors.push(`${id}.proxy_inputs_v1: source_tier must be proxy_diagnostic`);
    }
    if (proxy.exact_index_substitute !== false) {
      errors.push(`${id}.proxy_inputs_v1: exact_index_substitute must be false`);
    }
    if (proxy.public_status !== "proxy_input_only_exact_index_blocked") {
      errors.push(`${id}.proxy_inputs_v1: public_status must be proxy_input_only_exact_index_blocked`);
    }
    const proxyCoverage = proxy.coverage?.forward_eps_fy1_fy3_weight_ratio;
    if (!finite(proxyCoverage) || proxyCoverage < minCoveredWeight) {
      warnings.push(`${id}.proxy_inputs_v1: forward_eps_fy1_fy3_weight_ratio below ${minCoveredWeight}`);
    }
    for (const key of ["payout_ratio", "explicit_eps_growth_3y", "cost_of_equity"]) {
      if (proxy.key_inputs?.[key]?.source_tier !== "derived_formula") {
        errors.push(`${id}.proxy_inputs_v1.key_inputs.${key}: derived_formula tier required`);
      }
    }
    const grid = proxy.forecast_grid_v1;
    if (grid?.schema_version !== "forecast_grid_v1") {
      errors.push(`${id}.proxy_inputs_v1.forecast_grid_v1: schema_version required`);
    }
    if (grid?.public_status !== "proxy_input_only_no_fair_value_exact_index_blocked") {
      errors.push(`${id}.proxy_inputs_v1.forecast_grid_v1: public_status must be proxy_input_only_no_fair_value_exact_index_blocked`);
    }
    if (!Array.isArray(grid?.periods) || grid.periods.length !== 3) {
      errors.push(`${id}.proxy_inputs_v1.forecast_grid_v1: exactly 3 periods required`);
    }
  }
  const forbidden = scanForbiddenKeys(payload);
  if (forbidden.length > 0) errors.push(`forbidden output keys: ${forbidden.join(", ")}`);
  return { ok: errors.length === 0, errors, warnings };
}

export function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    write: true,
    publicMirror: true,
    check: false,
    minCoveredWeight: DEFAULT_MIN_COVERED_WEIGHT,
    dataRoot: dataRoot,
    publicDataRoot: publicDataRoot,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      args.check = true;
      args.write = false;
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--no-write") {
      args.write = false;
    } else if (arg === "--no-public-mirror") {
      args.publicMirror = false;
    } else if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length);
    } else if (arg === "--output") {
      args.output = argv[++i];
    } else if (arg.startsWith("--min-covered-weight=")) {
      args.minCoveredWeight = Number(arg.slice("--min-covered-weight=".length));
    } else if (arg === "--min-covered-weight") {
      args.minCoveredWeight = Number(argv[++i]);
    } else if (arg.startsWith("--data-root=")) {
      args.dataRoot = path.resolve(arg.slice("--data-root=".length));
    } else if (arg === "--data-root") {
      args.dataRoot = path.resolve(argv[++i]);
    } else if (arg.startsWith("--public-data-root=")) {
      args.publicDataRoot = path.resolve(arg.slice("--public-data-root=".length));
    } else if (arg === "--public-data-root") {
      args.publicDataRoot = path.resolve(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!finite(args.minCoveredWeight) || args.minCoveredWeight <= 0 || args.minCoveredWeight > 1) {
    throw new Error("--min-covered-weight must be between 0 and 1");
  }
  const outputPath = path.join(args.dataRoot, args.output);
  const currentPayload = fs.existsSync(outputPath) ? readJson(outputPath) : null;
  const generatedAt = args.check && currentPayload?.generated_at
    ? currentPayload.generated_at
    : new Date().toISOString();
  const payload = buildRimIndexInputs({ dataRootOverride: args.dataRoot, generatedAt, minCoveredWeight: args.minCoveredWeight });
  const validation = validateRimIndexInputs(payload, { minCoveredWeight: args.minCoveredWeight });
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  if (args.check) {
    if (!currentPayload) throw new Error(`${path.join("data", args.output)} is missing`);
    if (JSON.stringify(currentPayload) !== JSON.stringify(payload)) {
      throw new Error(`${path.join("data", args.output)} is not up to date`);
    }
    if (args.publicMirror) {
      const mirrorPath = path.join(args.publicDataRoot, args.output);
      const currentMirror = fs.existsSync(mirrorPath) ? readJson(mirrorPath) : null;
      const publicPayload = buildPublicRimMirror(payload);
      if (!currentMirror) throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is missing`);
      if (JSON.stringify(currentMirror) !== JSON.stringify(publicPayload)) {
        throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is not up to date`);
      }
    }
  }
  if (args.write) {
    writeJson(args.output, payload, [args.dataRoot]);
    if (args.publicMirror) {
      writeJson(args.output, buildPublicRimMirror(payload), [args.publicDataRoot]);
    }
  }
  const report = {
    ok: validation.ok,
    wrote: args.write ? [path.join("data", args.output), ...(args.publicMirror ? [path.join("100xfenok-next/public/data", args.output)] : [])] : [],
    primary_indices: PRIMARY_INDICES.map((item) => item.id),
    secondary_or_backlog_indices: SECONDARY_INDICES.map((item) => item.id),
    source_tier_counts: payload.source_tier_counts,
    warnings: validation.warnings,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

// ============================================================================
// E2 — canonical top-down index RIM (feno_index_rim_v1, criteria 2f660ac003)
// FENO canonical terminal: CV3 = (LTROE − Ke) × B3 / Ke; no hidden growth knob.
// ============================================================================

export function deriveNormalizedLongTermRoe(benchmarkRows, cutoffDate, years = 10) {
  const DAY = 86400000;
  const cutoffMs = Date.parse(`${cutoffDate}T00:00:00Z`);
  const startMs = cutoffMs - Math.floor(years * 365.25) * DAY;
  const roes = (benchmarkRows ?? [])
    .filter((row) => row && Number.isFinite(row.roe))
    .filter((row) => {
      const ms = Date.parse(`${row.date}T00:00:00Z`);
      return ms >= startMs && ms <= cutoffMs;
    })
    .map((row) => row.roe)
    .sort((a, b) => a - b);
  if (roes.length === 0) return { base: null, n_observations: 0 };
  const q = (p) => roes[Math.min(roes.length - 1, Math.floor(p * (roes.length - 1)))];
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const mid = roes.length / 2;
  const base = roes.length % 2 === 1 ? roes[Math.floor(mid)] : (roes[mid - 1] + roes[mid]) / 2;
  return {
    base,
    n_observations: roes.length,
    q25: q(0.25),
    q75: q(0.75),
    min: roes[0],
    max: roes.at(-1),
    window: `${startDate} .. ${cutoffDate}`,
    rule: `median of index ROE over trailing ${years} calendar years ending at the latest benchmark source date, after dropping non-finite values`,
  };
}

export function computeTopDownRimValue({ bookValueBeginning, epsPath, payoutRatio, costOfEquity, ltroe }) {
  if (![bookValueBeginning, payoutRatio, costOfEquity, ltroe].every(Number.isFinite)
    || bookValueBeginning <= 0 || costOfEquity <= 0) {
    return { value: null, blocker: "operand_missing_or_nonpositive" };
  }
  const eps = [1, 2, 3].map((i) => Number(epsPath?.[i - 1]));
  if (!eps.every(Number.isFinite)) return { value: null, blocker: "eps_path_incomplete" };
  const ke = costOfEquity;
  const retention = 1 - payoutRatio;
  const B = [bookValueBeginning];
  for (let t = 0; t < 3; t += 1) B.push(B[t] + eps[t] * retention);
  const B3 = B[3];
  if (B3 <= 0) return { value: null, blocker: "terminal_book_nonpositive" };
  const ri = [0, 1, 2].map((t) => eps[t] - ke * B[t]);
  const cv3 = ((ltroe - ke) * B3) / ke;
  const explicitPv = ri.reduce((sum, r, t) => sum + r / (1 + ke) ** (t + 1), 0);
  const value = bookValueBeginning + explicitPv + cv3 / (1 + ke) ** 3;
  if (!Number.isFinite(value)) return { value: null, blocker: "non_finite_value" };
  return {
    value,
    book: { b0: B[0], b1: B[1], b2: B[2], b3: B3 },
    ri: { ri1: ri[0], ri2: ri[1], ri3: ri[2] },
    cv3,
    explicit_pv: explicitPv,
    ke,
    ltroe,
  };
}

export function buildRimScenarioGrid({
  bookValueBeginning, epsPath, payoutRatio, riskFreeRate, erpBase, ltroeBase,
  erpWidth = 0.005, ltroeWidth = 0.005,
}) {
  const erp = { low: erpBase - erpWidth, base: erpBase, high: erpBase + erpWidth };
  const ltroe = { low: ltroeBase - ltroeWidth, base: ltroeBase, high: ltroeBase + ltroeWidth };
  const cells = {};
  const grid = [];
  for (const [erpKey, erpV] of Object.entries(erp)) {
    for (const [ltKey, ltV] of Object.entries(ltroe)) {
      const ke = riskFreeRate + erpV;
      const result = computeTopDownRimValue({ bookValueBeginning, epsPath, payoutRatio, costOfEquity: ke, ltroe: ltV });
      const cell = {
        erp: { key: erpKey, value: erpV }, ltroe: { key: ltKey, value: ltV },
        ke, value: result.value, blocker: result.blocker ?? null,
        cv3: result.cv3 ?? null,
      };
      cells[`${erpKey}_${ltKey}`] = cell;
      grid.push(cell);
    }
  }
  const finiteValues = grid.map((c) => c.value).filter(Number.isFinite);
  const mean = finiteValues.length === 9 ? finiteValues.reduce((a, x) => a + x, 0) / 9 : null;
  const bear = cells.high_low?.value ?? null;
  const base = cells.base_base?.value ?? null;
  const bull = cells.low_high?.value ?? null;
  // monotonicity hard gate (criteria §monotonicity_hard_gate)
  const monotonic = (() => {
    if (finiteValues.length !== 9) return false;
    for (const ltKey of ["low", "base", "high"]) {
      const lowKe = cells[`low_${ltKey}`].value;
      const baseKe = cells[`base_${ltKey}`].value;
      const highKe = cells[`high_${ltKey}`].value;
      if (lowKe < baseKe || baseKe < highKe) return false; // lower ERP must not lower value
    }
    for (const erpKey of ["low", "base", "high"]) {
      const l = cells[`${erpKey}_low`].value;
      const b = cells[`${erpKey}_base`].value;
      const h = cells[`${erpKey}_high`].value;
      if (h < b || b < l) return false; // higher LTROE must not lower value
    }
    return bull >= base && base >= bear;
  })();
  return {
    cells, grid,
    erp, ltroe,
    BEAR: bear, BASE: base, BULL: bull, GRID_MEAN: mean,
    monotonicity_passed: monotonic,
  };
}

export function computeReverseImpliedLtroe({
  price, bookValueBeginning, epsPath, payoutRatio, costOfEquity, bounds = [0.0, 1.50],
}) {
  const f = (lt) => computeTopDownRimValue({ bookValueBeginning, epsPath, payoutRatio, costOfEquity, ltroe: lt }).value - price;
  let [lo, hi] = bounds;
  const fLo = f(lo), fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
    return { solved: false, reason: "bound_evaluation_non_finite", bounds, converged: false };
  }
  if (fLo * fHi > 0) {
    return { solved: false, reason: "price_outside_monotone_range", bounds, f_at_lo: fLo, f_at_hi: fHi, converged: false };
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return { solved: false, reason: "mid_non_finite", converged: false };
    if (Math.abs(fm) < 1e-8 || (hi - lo) < 1e-10) {
      return { solved: true, value: mid, bounds, iterations: i + 1, converged: true, residual: fm };
    }
    if (fLo * fm <= 0) hi = mid; else { lo = mid; }
  }
  return { solved: false, reason: "iterations_exhausted", converged: false };
}

export function computeReverseImpliedErp({
  price, bookValueBeginning, epsPath, payoutRatio, riskFreeRate, ltroe, bounds = [-0.02, 0.30],
}) {
  const f = (erp) => computeTopDownRimValue({
    bookValueBeginning, epsPath, payoutRatio, costOfEquity: riskFreeRate + erp, ltroe,
  }).value - price;
  let [lo, hi] = bounds;
  const fLo = f(lo), fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
    return { solved: false, reason: "bound_evaluation_non_finite", bounds, converged: false };
  }
  if (fLo * fHi > 0) {
    return { solved: false, reason: "price_outside_monotone_range", bounds, f_at_lo: fLo, f_at_hi: fHi, converged: false };
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return { solved: false, reason: "mid_non_finite", converged: false };
    if (Math.abs(fm) < 1e-8 || (hi - lo) < 1e-10) {
      return { solved: true, value: mid, bounds, iterations: i + 1, converged: true, residual: fm };
    }
    if (fLo * fm <= 0) hi = mid; else { lo = mid; }
  }
  return { solved: false, reason: "iterations_exhausted", converged: false };
}

export function measurePayoutRouteValuationImpact({ gridA, gridB }) {
  const cell = (g, key) => g.cells[key]?.value ?? null;
  const baseShift = Math.abs(cell(gridB, "base_base") - cell(gridA, "base_base")) / Math.abs(cell(gridA, "base_base"));
  const meanShift = Math.abs(gridB.GRID_MEAN - gridA.GRID_MEAN) / Math.abs(gridA.GRID_MEAN);
  const orderingA = gridA.monotonicity_passed;
  const orderingB = gridB.monotonicity_passed;
  const thresholds = { base_cell_shift: 0.05, grid_mean_shift: 0.05, ordering: "Bear ≤ Base ≤ Bull under both routes" };
  const allPass = Number.isFinite(baseShift) && baseShift <= thresholds.base_cell_shift
    && Number.isFinite(meanShift) && meanShift <= thresholds.grid_mean_shift
    && orderingA && orderingB;
  return {
    payout_routes_materially_reconciled: allPass,
    base_cell_shift: Number.isFinite(baseShift) ? round(baseShift, 6) : null,
    grid_mean_shift: Number.isFinite(meanShift) ? round(meanShift, 6) : null,
    ordering_a_passed: orderingA,
    ordering_b_passed: orderingB,
    thresholds,
    note: "thresholds frozen in criteria before results (payout.materiality_thresholds_frozen_before_results)",
  };
}

export function buildQqqEquivalent({ currentQqq, currentNdx, ndxScenarios }) {
  const scale = currentNdx > 0 ? currentQqq / currentNdx : null;
  const map = (v) => (Number.isFinite(v) && scale !== null ? v * scale : null);
  return {
    formula: "QQQ_s = current_QQQ × (NDX_s / current_NDX)",
    current_qqq: currentQqq,
    current_ndx: currentNdx,
    scale,
    bear: map(ndxScenarios.BEAR),
    base: map(ndxScenarios.BASE),
    bull: map(ndxScenarios.BULL),
    grid_mean: map(ndxScenarios.GRID_MEAN),
    cells: Object.fromEntries(Object.entries(ndxScenarios.cells ?? {}).map(([k, c]) => [k, { ...c, value: map(c.value) }])),
    label: "NDX-ratio indicative equivalent — not a reconstructed ETF NAV fair value",
    caveats: ["expense ratio and tracking difference are disclosed and do not block the number"],
  };
}
