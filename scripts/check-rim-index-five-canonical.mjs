#!/usr/bin/env node

// Strict artifact validator for the quarantined five-index canonical RIM line.
// This checker intentionally reads the installed artifact and does not import
// or invoke the producer. A successful build is therefore not a substitute for
// validating the bytes that the central writer is about to consume.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const FIVE_INDICES = Object.freeze(["SPX", "CCMP", "NDX", "SOX", "KOSPI"]);
export const EXACT_IDENTITIES = Object.freeze({
  SPX: Object.freeze({ id: "SPX", name: "S&P 500" }),
  CCMP: Object.freeze({ id: "CCMP", name: "Nasdaq Composite" }),
  NDX: Object.freeze({ id: "NDX", name: "Nasdaq-100" }),
  SOX: Object.freeze({ id: "SOX", name: "Philadelphia Semiconductor Index" }),
  KOSPI: Object.freeze({ id: "KOSPI", name: "KOSPI" }),
});
export const ARTIFACT_REL = "data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json";
export const CRITERIA_REL = "data/computed/rim-index/feno-index-rim-five-canonical-criteria.json";
export const PUBLIC_MIRROR_RELS = Object.freeze([
  "100xfenok-next/public/data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json",
  "100xfenok-next/public/data/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "feno_rim_five_canonical_current.v1";
const PRIMARY_SCALAR = "fair_value_upside";
const HORIZON = "same_as_of";
const SOURCE_CLOCK_KEYS = Object.freeze([
  "price_as_of",
  "benchmark_as_of",
  "payout_availability",
  "forecast_availability",
  "rf_as_of",
  "erp_as_of",
]);
const BLOCKER_KEYS = Object.freeze(["direct_input", "freshness", "identity"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LOWER_HEX_64 = /^[a-f0-9]{64}$/;
const KOSPI_DART_POINTER_PATH = "computed/fenok-rim/kospi-dart-payout/current.json";
const KOSPI_DART_ARTIFACT_PATH = /^data\/computed\/fenok-rim\/kospi-dart-payout\/fy(\d{4})\.json$/;
const TIMESTAMP_RE = /(?:Z|[+-]\d{2}:\d{2})$/;
const PROMOTION_FLAG_KEYS = new Set([
  "display_ready",
  "public_promotion",
  "public_promoted",
  "promoted",
  "mirrored",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return isObject(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function finite(value) {
  return Number.isFinite(value);
}

function validEconomicDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year
    && candidate.getUTCMonth() === month - 1
    && candidate.getUTCDate() === day;
}

function validTimestamp(value) {
  return typeof value === "string" && TIMESTAMP_RE.test(value) && finite(Date.parse(value));
}

function dateNotAfter(value, upperBound) {
  return validEconomicDate(value) && validEconomicDate(upperBound) && value <= upperBound;
}

function add(errors, message) {
  errors.push(message);
}

function expectedOrderMet(rows) {
  for (let index = 0; index < FIVE_INDICES.length - 1; index += 1) {
    if (!(rows[index].fair_value_upside < rows[index + 1].fair_value_upside)) return false;
  }
  return true;
}

function expectedViolations(rows) {
  const violations = [];
  for (let index = 0; index < FIVE_INDICES.length - 1; index += 1) {
    const left = rows[index];
    const right = rows[index + 1];
    if (!(right.fair_value_upside > left.fair_value_upside)) {
      violations.push({
        asset_a: left.asset,
        asset_b: right.asset,
        value_a: left.fair_value_upside,
        value_b: right.fair_value_upside,
      });
    }
  }
  return violations;
}

function collectPromotionErrors(value, trail, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectPromotionErrors(item, `${trail}[${index}]`, errors));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (PROMOTION_FLAG_KEYS.has(normalized) && child !== false) {
      add(errors, `${trail}.${key} must be false or absent; quarantined artifact cannot be promoted or mirrored`);
    }
    if (normalized === "public" && child === true) {
      add(errors, `${trail}.${key} must not be true for a quarantined artifact`);
    }
    collectPromotionErrors(child, `${trail}.${key}`, errors);
  }
}

function validateBlockers(row, rowLabel, errors) {
  const blockers = row.blockers;
  if (!isObject(blockers)) {
    add(errors, `${rowLabel}.blockers must be an object with direct_input/freshness/identity arrays`);
    return { direct_input: [], freshness: [], identity: [] };
  }
  const actualKeys = Object.keys(blockers).sort();
  const expectedKeys = [...BLOCKER_KEYS].sort();
  if (!isDeepStrictEqual(actualKeys, expectedKeys)) {
    add(errors, `${rowLabel}.blockers keys must be exactly ${BLOCKER_KEYS.join(",")}`);
  }
  const normalized = {};
  for (const key of BLOCKER_KEYS) {
    const group = blockers[key];
    normalized[key] = Array.isArray(group) ? group : [];
    if (!Array.isArray(group)) {
      add(errors, `${rowLabel}.blockers.${key} must be an array`);
      continue;
    }
    for (const [index, blocker] of group.entries()) {
      if (typeof blocker !== "string" || blocker.trim().length === 0) {
        add(errors, `${rowLabel}.blockers.${key}[${index}] must be a non-empty string`);
      }
    }
  }
  return normalized;
}

function validateSourceClock(row, rowLabel, status, errors) {
  const clock = row.source_clock;
  if (!isObject(clock)) {
    add(errors, `${rowLabel}.source_clock must be an object`);
    return null;
  }
  const actualKeys = Object.keys(clock).sort();
  const expectedKeys = [...SOURCE_CLOCK_KEYS].sort();
  if (!isDeepStrictEqual(actualKeys, expectedKeys)) {
    add(errors, `${rowLabel}.source_clock keys must be exactly ${SOURCE_CLOCK_KEYS.join(",")}`);
  }
  for (const key of SOURCE_CLOCK_KEYS) {
    const value = clock[key];
    if (value !== null && !validEconomicDate(value)) {
      add(errors, `${rowLabel}.source_clock.${key} must be null or YYYY-MM-DD`);
    }
  }

  if (status !== "READY") return clock;
  if (!validEconomicDate(row.as_of)) {
    add(errors, `${rowLabel}.as_of must be a valid YYYY-MM-DD date for READY rows`);
    return clock;
  }
  if (clock.price_as_of !== row.as_of) {
    add(errors, `${rowLabel}.source_clock.price_as_of must equal row.as_of`);
  }
  for (const key of SOURCE_CLOCK_KEYS) {
    if (!validEconomicDate(clock[key])) {
      add(errors, `${rowLabel}.source_clock.${key} is required for READY rows`);
    } else if (!dateNotAfter(clock[key], row.as_of)) {
      add(errors, `${rowLabel}.source_clock.${key} ${clock[key]} is after price as-of ${row.as_of}`);
    }
  }
  return clock;
}

function validateDirectProvenance(row, rowLabel, status, errors, root) {
  if (row.asset !== "KOSPI") {
    if (row.direct_provenance !== null) add(errors, `${rowLabel}.direct_provenance must be null outside KOSPI`);
    return;
  }
  if (status !== "READY") {
    if (row.direct_provenance !== null && !isObject(row.direct_provenance)) {
      add(errors, `${rowLabel}.direct_provenance must be null or an object for NULL KOSPI`);
    }
    return;
  }
  const proof = row.direct_provenance;
  if (!isObject(proof)) {
    add(errors, `${rowLabel}.direct_provenance is required for READY KOSPI`);
    return;
  }
  const expectedKeys = [
    "availability_as_of",
    "covered_weight_ratio",
    "first_knowable_at",
    "payout_ratio",
    "pointer_path",
    "selected_artifact",
    "selected_artifact_sha256",
    "selected_fy",
    "source_clocks",
    "source_tier",
  ].sort();
  if (!isDeepStrictEqual(Object.keys(proof).sort(), expectedKeys)) {
    add(errors, `${rowLabel}.direct_provenance keys do not match the KOSPI DART contract`);
  }
  const artifactMatch = typeof proof.selected_artifact === "string"
    ? proof.selected_artifact.match(KOSPI_DART_ARTIFACT_PATH)
    : null;
  if (proof.source_tier !== "direct_official_derived") add(errors, `${rowLabel}.direct_provenance.source_tier must be direct_official_derived`);
  if (proof.pointer_path !== KOSPI_DART_POINTER_PATH) add(errors, `${rowLabel}.direct_provenance.pointer_path must be the exact private current pointer`);
  if (!artifactMatch) add(errors, `${rowLabel}.direct_provenance.selected_artifact must be the exact FY artifact path`);
  if (!LOWER_HEX_64.test(proof.selected_artifact_sha256 ?? "")) add(errors, `${rowLabel}.direct_provenance.selected_artifact_sha256 must be 64 lowercase hex`);
  if (!artifactMatch || Number(proof.selected_fy) !== Number(artifactMatch[1])) add(errors, `${rowLabel}.direct_provenance.selected_fy must match selected_artifact`);
  if (!validTimestamp(proof.first_knowable_at) || !proof.first_knowable_at.endsWith("Z")) add(errors, `${rowLabel}.direct_provenance.first_knowable_at must be a strict UTC timestamp`);
  if (!dateNotAfter(proof.availability_as_of, row.as_of)) add(errors, `${rowLabel}.direct_provenance.availability_as_of must be at or before row.as_of`);
  if (!finite(proof.payout_ratio) || proof.payout_ratio !== row.payout) add(errors, `${rowLabel}.direct_provenance.payout_ratio must equal row.payout`);
  if (!finite(proof.covered_weight_ratio) || proof.covered_weight_ratio < 0.75 || proof.covered_weight_ratio > 1) add(errors, `${rowLabel}.direct_provenance.covered_weight_ratio must be within [0.75,1]`);
  const clocks = proof.source_clocks;
  const clockKeys = [
    "all_used_inputs_at_or_before",
    "availability_as_of",
    "benchmark_as_of",
    "bridge_as_of",
    "pointer_first_knowable_at",
  ].sort();
  if (!isObject(clocks) || !isDeepStrictEqual(Object.keys(clocks ?? {}).sort(), clockKeys)) {
    add(errors, `${rowLabel}.direct_provenance.source_clocks keys do not match the DART contract`);
    return;
  }
  for (const [key, value] of Object.entries(clocks)) {
    if (!dateNotAfter(value, row.as_of)) add(errors, `${rowLabel}.direct_provenance.source_clocks.${key} must be at or before row.as_of`);
  }
  const firstKnowableDate = validTimestamp(proof.first_knowable_at) ? proof.first_knowable_at.slice(0, 10) : null;
  if (clocks.pointer_first_knowable_at !== firstKnowableDate) add(errors, `${rowLabel}.direct_provenance pointer first-knowable clock mismatch`);
  if (clocks.availability_as_of !== proof.availability_as_of
    || clocks.all_used_inputs_at_or_before !== proof.availability_as_of
    || row.source_clock.payout_availability !== proof.availability_as_of) {
    add(errors, `${rowLabel}.direct_provenance availability clocks must equal the row payout clock`);
  }
  try {
    const pointerPath = path.join(root, "data", proof.pointer_path);
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    const selectedPath = path.join(root, proof.selected_artifact);
    const selectedBytes = fs.readFileSync(selectedPath);
    const selectedHash = createHash("sha256").update(selectedBytes).digest("hex");
    if (pointer.schema_version !== "kospi_dart_payout_pointer.v1"
      || pointer.selected_artifact !== proof.selected_artifact
      || Number(pointer.fy) !== Number(proof.selected_fy)
      || pointer.sha256 !== proof.selected_artifact_sha256
      || pointer.first_knowable_at !== proof.first_knowable_at
      || selectedHash !== proof.selected_artifact_sha256) {
      add(errors, `${rowLabel}.direct_provenance does not match the installed DART pointer and selected artifact bytes`);
    }
  } catch (error) {
    add(errors, `${rowLabel}.direct_provenance installed DART proof is unreadable (${error.message})`);
  }
}

function validateRows(artifact, errors, root) {
  if (!Array.isArray(artifact.rows)) {
    add(errors, "rows must be an array");
    return { rows: [], clocks: new Map() };
  }
  if (artifact.rows.length !== FIVE_INDICES.length) {
    add(errors, `rows must contain exactly ${FIVE_INDICES.length} rows`);
  }
  if (!isDeepStrictEqual(artifact.rows.map((row) => row?.asset), FIVE_INDICES)) {
    add(errors, `rows must use the exact ordered assets ${FIVE_INDICES.join(",")}`);
  }

  const rowClocks = new Map();
  for (const [index, row] of artifact.rows.entries()) {
    const expectedAsset = FIVE_INDICES[index];
    const rowLabel = `rows[${index}]${expectedAsset ? `(${expectedAsset})` : ""}`;
    if (!isObject(row)) {
      add(errors, `${rowLabel} must be an object`);
      continue;
    }
    if (row.asset !== expectedAsset) {
      add(errors, `${rowLabel}.asset must be ${expectedAsset ?? "absent"}`);
    }
    if (!isDeepStrictEqual(row.identity, EXACT_IDENTITIES[expectedAsset])) {
      add(errors, `${rowLabel}.identity must equal the exact ${expectedAsset} identity contract`);
    }
    const upsideKeys = Object.keys(row).filter((key) => key.toLowerCase().includes("upside"));
    if (!isDeepStrictEqual(upsideKeys, ["fair_value_upside"])) {
      add(errors, `${rowLabel} must expose only fair_value_upside as its upside scalar`);
    }
    for (const key of Object.keys(row)) {
      if (/12m|twelve/i.test(key)) add(errors, `${rowLabel}.${key} must not convert the same-as-of scalar to a 12m horizon`);
      if (key === "selected" || key === "gap_to_next") add(errors, `${rowLabel}.${key} is an order-projection field and is forbidden`);
    }

    const blockers = validateBlockers(row, rowLabel, errors);
    const status = row.status;
    if (status !== "READY" && status !== "NULL") {
      add(errors, `${rowLabel}.status must be READY or NULL`);
    }
    const clock = validateSourceClock(row, rowLabel, status, errors);
    if (clock) rowClocks.set(row.asset, clock);
    validateDirectProvenance(row, rowLabel, status, errors, root);
    collectPromotionErrors(row, rowLabel, errors);

    if (status === "READY") {
      if (!finite(row.spot) || row.spot <= 0) add(errors, `${rowLabel}.spot must be finite and positive for READY rows`);
      if (!finite(row.fair_value)) add(errors, `${rowLabel}.fair_value must be finite for READY rows`);
      if (!finite(row.fair_value_upside)) add(errors, `${rowLabel}.fair_value_upside must be finite for READY rows`);
      if (!validEconomicDate(row.as_of)) add(errors, `${rowLabel}.as_of must be a valid YYYY-MM-DD date for READY rows`);
      if (row.fair_value_as_of !== row.as_of) add(errors, `${rowLabel}.fair_value_as_of must equal row.as_of for READY rows`);
      if (finite(row.spot) && row.spot > 0 && finite(row.fair_value) && finite(row.fair_value_upside)) {
        const expectedUpside = row.fair_value / row.spot - 1;
        const tolerance = 1e-9 * Math.max(1, Math.abs(expectedUpside));
        if (Math.abs(row.fair_value_upside - expectedUpside) > tolerance) {
          add(errors, `${rowLabel}.fair_value_upside must equal fair_value / spot - 1`);
        }
      }
      for (const key of BLOCKER_KEYS) {
        if (blockers[key].length !== 0) add(errors, `${rowLabel}.blockers.${key} must be empty for READY rows`);
      }
    } else if (status === "NULL") {
      for (const key of ["fair_value", "fair_value_as_of", "fair_value_upside"]) {
        if (!hasOwn(row, key) || row[key] !== null) add(errors, `${rowLabel}.${key} must be null for NULL rows`);
      }
      const blockerCount = BLOCKER_KEYS.reduce((sum, key) => sum + blockers[key].length, 0);
      if (blockerCount === 0) add(errors, `${rowLabel} NULL row must carry at least one explicit blocker`);
    }
  }
  return { rows: artifact.rows, clocks: rowClocks };
}

function validateOrderDiagnostic(artifact, rows, errors) {
  const diagnostic = artifact.order_diagnostic;
  if (!isObject(diagnostic)) {
    add(errors, "order_diagnostic must be an object");
    return;
  }
  if (!isDeepStrictEqual(diagnostic.desired_order, FIVE_INDICES)) {
    add(errors, `order_diagnostic.desired_order must be ${FIVE_INDICES.join(",")}`);
  }
  if (diagnostic.values_shifted !== false) add(errors, "order_diagnostic.values_shifted must be false");
  if (typeof diagnostic.desired_order_met !== "boolean") add(errors, "order_diagnostic.desired_order_met must be boolean");
  if (!Array.isArray(diagnostic.non_finite_rows)) add(errors, "order_diagnostic.non_finite_rows must be an array");
  if (!Array.isArray(diagnostic.violations)) add(errors, "order_diagnostic.violations must be an array");

  const nonFiniteRows = rows.filter((row) => !finite(row?.fair_value_upside)).map((row) => row?.asset ?? null);
  if (Array.isArray(diagnostic.non_finite_rows) && !isDeepStrictEqual(diagnostic.non_finite_rows, nonFiniteRows)) {
    add(errors, "order_diagnostic.non_finite_rows must name exactly the rows without finite fair_value_upside");
  }
  if (!Array.isArray(diagnostic.violations)) return;
  for (const [index, violation] of diagnostic.violations.entries()) {
    if (!isObject(violation)
      || !FIVE_INDICES.includes(violation.asset_a)
      || !FIVE_INDICES.includes(violation.asset_b)
      || !finite(violation.value_a)
      || !finite(violation.value_b)) {
      add(errors, `order_diagnostic.violations[${index}] must carry finite asset-keyed values`);
    }
  }

  // A partial line is legitimate while rows are NULL. Do not infer or reject
  // an owner order from a non-finite five-row set. Once all five are finite,
  // however, the diagnostic must be honest even when the natural order fails.
  if (nonFiniteRows.length === 0 && rows.length === FIVE_INDICES.length) {
    const actualMet = expectedOrderMet(rows);
    if (diagnostic.desired_order_met !== actualMet) {
      add(errors, "order_diagnostic.desired_order_met does not match the natural finite-row order");
    }
    const expected = expectedViolations(rows);
    if (!isDeepStrictEqual(diagnostic.violations, expected)) {
      add(errors, "order_diagnostic.violations does not match the natural finite-row order");
    }
  }
}

function validatePublicQuarantine(artifact, errors) {
  if (artifact.public_surface?.status !== "QUARANTINED") {
    add(errors, "public_surface.status must remain QUARANTINED");
  }
  if (artifact.exact_yoo !== false) add(errors, "exact_yoo must be false");
  if (artifact.yoo_status !== "NOT_IDENTIFIED") add(errors, "yoo_status must be NOT_IDENTIFIED");
  collectPromotionErrors(artifact, "artifact", errors);
}

function validatePublicMirror(root, artifactPath, errors) {
  if (!root) return;
  const resolvedRoot = path.resolve(root);
  if (artifactPath) {
    const relative = path.relative(resolvedRoot, path.resolve(artifactPath)).split(path.sep).join("/");
    if (relative.startsWith("100xfenok-next/public/") || relative.startsWith("public/")) {
      add(errors, `artifact path ${relative} is inside a public mirror`);
    }
  }
  for (const relative of PUBLIC_MIRROR_RELS) {
    const candidate = path.join(resolvedRoot, relative);
    try {
      fs.lstatSync(candidate);
      add(errors, `quarantined artifact is mirrored at ${relative}`);
    } catch (error) {
      if (error?.code !== "ENOENT") add(errors, `cannot inspect possible public mirror ${relative}: ${error.message}`);
    }
  }
}

export function validateFiveIndexCanonicalArtifact(artifact, { root = ROOT, artifactPath = null } = {}) {
  const errors = [];
  if (!isObject(artifact)) {
    return { valid: false, errors: ["artifact must be a JSON object"], warnings: [], artifact: null };
  }
  if (artifact.schema_version !== SCHEMA_VERSION) add(errors, `schema_version must be ${SCHEMA_VERSION}`);
  if (artifact.criteria !== CRITERIA_REL) add(errors, `criteria must be ${CRITERIA_REL}`);
  if (typeof artifact.generated_at !== "string" || !validTimestamp(artifact.generated_at)) {
    add(errors, "generated_at must be an ISO timestamp");
  }
  if (artifact.primary_scalar !== PRIMARY_SCALAR) add(errors, `primary_scalar must be ${PRIMARY_SCALAR}`);
  if (artifact.horizon !== HORIZON) add(errors, `horizon must be ${HORIZON}`);
  validatePublicQuarantine(artifact, errors);

  const { rows, clocks } = validateRows(artifact, errors, root);
  if (isObject(artifact.source_clocks)) {
    const actualKeys = Object.keys(artifact.source_clocks).sort();
    const expectedKeys = [...FIVE_INDICES].sort();
    if (!isDeepStrictEqual(actualKeys, expectedKeys)) {
      add(errors, `source_clocks must contain exactly ${FIVE_INDICES.join(",")}`);
    }
    for (const asset of FIVE_INDICES) {
      if (!isDeepStrictEqual(artifact.source_clocks[asset], clocks.get(asset))) {
        add(errors, `source_clocks.${asset} must equal rows[asset=${asset}].source_clock`);
      }
    }
  } else {
    add(errors, "source_clocks must be an object");
  }
  validateOrderDiagnostic(artifact, rows, errors);
  validatePublicMirror(root, artifactPath, errors);

  const warnings = rows.filter((row) => row?.status === "NULL").map((row) => row.asset);
  return { valid: errors.length === 0, errors, warnings, artifact };
}

function resolveArtifactPath(root, artifactPath) {
  if (!artifactPath) return path.join(root, ARTIFACT_REL);
  return path.isAbsolute(artifactPath) ? artifactPath : path.resolve(root, artifactPath);
}

export function validateFiveIndexCanonicalFile({ root = ROOT, artifactPath = null } = {}) {
  const resolvedRoot = path.resolve(root);
  const resolvedArtifact = resolveArtifactPath(resolvedRoot, artifactPath);
  const label = path.relative(resolvedRoot, resolvedArtifact).split(path.sep).join("/") || resolvedArtifact;
  let stat;
  try {
    stat = fs.lstatSync(resolvedArtifact);
  } catch (error) {
    return { valid: false, errors: [`${label}: cannot read artifact (${error.message})`], warnings: [], artifact: null };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { valid: false, errors: [`${label}: artifact must be a regular file, not a symlink or directory`], warnings: [], artifact: null };
  }
  let artifact;
  try {
    artifact = JSON.parse(fs.readFileSync(resolvedArtifact, "utf8"));
  } catch (error) {
    return { valid: false, errors: [`${label}: invalid JSON (${error.message})`], warnings: [], artifact: null };
  }
  const result = validateFiveIndexCanonicalArtifact(artifact, {
    root: resolvedRoot,
    artifactPath: resolvedArtifact,
  });
  return {
    ...result,
    errors: result.errors.map((message) => `${label}: ${message}`),
  };
}

function parseArgs(argv) {
  const options = { root: ROOT, artifactPath: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--root" || argument === "--artifact") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} requires a path`);
      if (argument === "--root") options.root = path.resolve(value);
      else options.artifactPath = value;
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  return options;
}

function main() {
  try {
    const result = validateFiveIndexCanonicalFile(parseArgs(process.argv.slice(2)));
    if (!result.valid) {
      for (const error of result.errors) console.error(`FAIL ${error}`);
      process.exitCode = 1;
      return;
    }
    const readyCount = result.artifact.rows.filter((row) => row.status === "READY").length;
    const nullCount = result.artifact.rows.filter((row) => row.status === "NULL").length;
    console.log(`check-rim-index-five-canonical: ok (READY=${readyCount}, NULL=${nullCount}, public_surface=QUARANTINED)`);
  } catch (error) {
    console.error(`FAIL ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
