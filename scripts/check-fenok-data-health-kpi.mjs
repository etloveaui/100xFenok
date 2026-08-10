#!/usr/bin/env node

// Independent checker for the private five-index canonical projection carried
// by rim_inputs. This file intentionally does not import the canonical
// producer, the canonical artifact validator, or the KPI builder. It checks
// the installed private bytes and the emitted KPI fields independently.

import fs from "node:fs";
import path from "node:path";
import {
  RIM_FIVE_CANONICAL_INDICES,
  RIM_FIVE_CANONICAL_IDENTITIES,
  RIM_FIVE_CANONICAL_ARTIFACT_REL,
  RIM_FIVE_CANONICAL_SCHEMA_VERSION,
  RIM_FIVE_CANONICAL_PUBLIC_STATUS,
  RIM_FIVE_CANONICAL_YOO_STATUS,
  RIM_FIVE_CANONICAL_BLOCKER_KEYS,
  RIM_FIVE_CANONICAL_SOURCE_CLOCK_KEYS,
  RIM_FIVE_CANONICAL_PUBLIC_MIRROR_RELS,
} from "./lib/kpi-contract-constants.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const KPI_REL = "data/admin/fenok-data-health-kpi.json";
const PUBLIC_KPI_REL = "100xfenok-next/public/data/admin/fenok-data-health-kpi.json";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP_RE = /(?:Z|[+-]\d{2}:\d{2})$/;
const PROMOTION_KEYS = new Set(["display_ready", "public_promotion", "public_promoted", "promoted", "mirrored"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(value, key) {
  return object(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function finite(value) {
  return Number.isFinite(value);
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validTimestamp(value) {
  return typeof value === "string" && TIMESTAMP_RE.test(value) && finite(Date.parse(value));
}

function pushUnique(list, message) {
  if (!list.includes(message)) list.push(message);
}

function promotionErrors(value, reasons) {
  if (Array.isArray(value)) {
    value.forEach((item) => promotionErrors(item, reasons));
    return;
  }
  if (!object(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (PROMOTION_KEYS.has(normalized) && child !== false) {
      pushUnique(reasons, "canonical artifact carries a true or non-false promotion/display flag");
    }
    if (normalized === "public" && child === true) {
      pushUnique(reasons, "canonical artifact carries a public=true promotion flag");
    }
    promotionErrors(child, reasons);
  }
}

function countBlockers(row, label, reasons) {
  const counts = { freshness: 0, pit: 0, direct_identity: 0 };
  const blockers = row?.blockers;
  if (!object(blockers)) {
    pushUnique(reasons, `${label}.blockers must be an object with direct_input/freshness/identity arrays`);
    return counts;
  }
  if (JSON.stringify(Object.keys(blockers).sort()) !== JSON.stringify([...RIM_FIVE_CANONICAL_BLOCKER_KEYS].sort())) {
    pushUnique(reasons, `${label}.blockers keys are malformed`);
  }
  for (const key of RIM_FIVE_CANONICAL_BLOCKER_KEYS) {
    if (!Array.isArray(blockers[key])) {
      pushUnique(reasons, `${label}.blockers.${key} must be an array`);
      continue;
    }
    for (const blocker of blockers[key]) {
      if (typeof blocker !== "string" || blocker.trim() === "") {
        pushUnique(reasons, `${label}.blockers.${key} must contain non-empty strings`);
      } else if (key === "freshness") {
        if (/\bPIT\b|point[- ]in[- ]time/i.test(blocker)) counts.pit += 1;
        else counts.freshness += 1;
      } else if (key === "direct_input" || key === "identity") {
        counts.direct_identity += 1;
      }
    }
  }
  return counts;
}

function validateClock(row, label, reasons) {
  const clock = row?.source_clock;
  if (!object(clock)) {
    pushUnique(reasons, `${label}.source_clock must be an object`);
    return null;
  }
  if (JSON.stringify(Object.keys(clock).sort()) !== JSON.stringify([...RIM_FIVE_CANONICAL_SOURCE_CLOCK_KEYS].sort())) {
    pushUnique(reasons, `${label}.source_clock keys are malformed`);
  }
  for (const key of RIM_FIVE_CANONICAL_SOURCE_CLOCK_KEYS) {
    if (clock[key] !== null && !validDate(clock[key])) {
      pushUnique(reasons, `${label}.source_clock.${key} must be null or YYYY-MM-DD`);
    }
  }
  if (row.status !== "READY" || !validDate(row.as_of)) return clock;
  if (clock.price_as_of !== row.as_of) pushUnique(reasons, `${label}.source_clock.price_as_of must equal row.as_of`);
  for (const key of RIM_FIVE_CANONICAL_SOURCE_CLOCK_KEYS) {
    if (!validDate(clock[key]) || clock[key] > row.as_of) {
      pushUnique(reasons, `${label}.source_clock.${key} must be present and PIT-safe`);
    }
  }
  return clock;
}

function orderViolations(rows) {
  const violations = [];
  for (let index = 0; index < RIM_FIVE_CANONICAL_INDICES.length - 1; index += 1) {
    const left = rows[index];
    const right = rows[index + 1];
    if (finite(left?.fair_value_upside) && finite(right?.fair_value_upside)
      && !(right.fair_value_upside > left.fair_value_upside)) {
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

function orderMet(rows) {
  return rows.length === RIM_FIVE_CANONICAL_INDICES.length
    && rows.every((row) => finite(row?.fair_value_upside))
    && rows.every((row, index) => index === 0 || row.fair_value_upside > rows[index - 1].fair_value_upside);
}

function emptySummary({ present = false, publicLeak = false } = {}) {
  return {
    canonical_present: present,
    canonical_file_present: present,
    canonical_parseable: false,
    canonical_public_status: null,
    ready_count: 0,
    null_count: 0,
    total_count: 0,
    stale_or_freshness_blocker_count: 0,
    freshness_blocker_count: 0,
    pit_blocker_count: 0,
    direct_or_identity_blocker_count: 0,
    order_diagnostic_state: "not_comparable",
    values_shifted: null,
    exact_yoo: null,
    yoo_status: null,
    private_only: present && !publicLeak,
    private_only_status: present ? (publicLeak ? "blocked" : "ok") : "not_comparable",
    public_leak: publicLeak,
    public_leak_status: publicLeak ? "blocked" : present ? "clear" : "not_comparable",
    warnings: [],
    blocking_reasons: [],
  };
}

function expectedSummary(artifact, { present = artifact != null, publicLeak = false, readFailure = null } = {}) {
  const summary = emptySummary({ present: present && artifact != null && readFailure == null, publicLeak });
  summary.canonical_file_present = present;
  const reasons = [];
  if (readFailure === "missing") reasons.push("private five-index canonical artifact is missing");
  if (readFailure === "unparseable") reasons.push("private five-index canonical artifact is unparseable JSON");
  if (!object(artifact)) {
    if (!readFailure) reasons.push("private five-index canonical artifact is not a JSON object");
    if (publicLeak) reasons.push("private five-index canonical artifact is present on a public mirror");
    if (publicLeak) summary.warnings.push("private-only policy is violated by a public canonical mirror");
    summary.blocking_reasons = [...new Set(reasons)];
    return { summary, reasons };
  }
  summary.canonical_parseable = true;
  summary.canonical_public_status = object(artifact.public_surface) ? artifact.public_surface.status ?? null : null;
  summary.exact_yoo = own(artifact, "exact_yoo") ? artifact.exact_yoo : null;
  summary.yoo_status = own(artifact, "yoo_status") ? artifact.yoo_status : null;
  if (artifact.schema_version !== RIM_FIVE_CANONICAL_SCHEMA_VERSION) reasons.push("canonical artifact schema_version is malformed");
  if (!validTimestamp(artifact.generated_at)) reasons.push("canonical artifact generated_at is malformed");
  if (summary.canonical_public_status !== RIM_FIVE_CANONICAL_PUBLIC_STATUS) {
    reasons.push("canonical artifact public_surface.status must remain QUARANTINED");
  }
  if (summary.exact_yoo !== false) reasons.push("canonical artifact exact_yoo must remain false");
  if (summary.yoo_status !== RIM_FIVE_CANONICAL_YOO_STATUS) reasons.push("canonical artifact yoo_status must remain NOT_IDENTIFIED");
  promotionErrors(artifact, reasons);
  if (publicLeak) reasons.push("private five-index canonical artifact is present on a public mirror");

  const rows = Array.isArray(artifact.rows) ? artifact.rows : [];
  summary.total_count = rows.length;
  if (!Array.isArray(artifact.rows)) reasons.push("canonical artifact rows must be an array");
  if (rows.length !== RIM_FIVE_CANONICAL_INDICES.length) reasons.push("canonical artifact rows must contain exactly five rows");
  if (JSON.stringify(rows.map((row) => row?.asset)) !== JSON.stringify(RIM_FIVE_CANONICAL_INDICES)) {
    reasons.push("canonical artifact rows must use the exact ordered five-index assets");
  }
  const rowClocks = new Map();
  for (const [index, row] of rows.entries()) {
    const expectedAsset = RIM_FIVE_CANONICAL_INDICES[index];
    const label = `canonical row ${index}${expectedAsset ? ` (${expectedAsset})` : ""}`;
    if (!object(row)) {
      reasons.push(`${label} must be an object`);
      continue;
    }
    if (row.asset !== expectedAsset) reasons.push(`${label}.asset is out of order`);
    if (JSON.stringify(row.identity) !== JSON.stringify(RIM_FIVE_CANONICAL_IDENTITIES[expectedAsset])) {
      reasons.push(`${label}.identity does not match the exact index contract`);
    }
    if (!["READY", "NULL"].includes(row.status)) {
      reasons.push(`${label}.status must be READY or NULL`);
      continue;
    }
    const counts = countBlockers(row, label, reasons);
    summary.freshness_blocker_count += counts.freshness + counts.pit;
    summary.stale_or_freshness_blocker_count += counts.freshness;
    summary.pit_blocker_count += counts.pit;
    summary.direct_or_identity_blocker_count += counts.direct_identity;
    const clock = validateClock(row, label, reasons);
    if (clock) rowClocks.set(row.asset, clock);
    promotionErrors(row, reasons);
    if (row.status === "READY") {
      summary.ready_count += 1;
      if (!finite(row.spot) || row.spot <= 0 || !finite(row.fair_value) || !finite(row.fair_value_upside)) {
        reasons.push(`${label} READY values must be finite`);
      }
      if (!validDate(row.as_of) || row.fair_value_as_of !== row.as_of) reasons.push(`${label} READY as-of values are malformed`);
      if (finite(row.spot) && row.spot > 0 && finite(row.fair_value) && finite(row.fair_value_upside)) {
        const expectedUpside = row.fair_value / row.spot - 1;
        const tolerance = 1e-9 * Math.max(1, Math.abs(expectedUpside));
        if (Math.abs(row.fair_value_upside - expectedUpside) > tolerance) reasons.push(`${label}.fair_value_upside arithmetic is malformed`);
      }
      for (const key of RIM_FIVE_CANONICAL_BLOCKER_KEYS) {
        if (Array.isArray(row.blockers?.[key]) && row.blockers[key].length > 0) reasons.push(`${label} READY rows cannot carry blockers`);
      }
    } else {
      summary.null_count += 1;
      for (const key of ["fair_value", "fair_value_as_of", "fair_value_upside"]) {
        if (!own(row, key) || row[key] !== null) reasons.push(`${label} NULL ${key} must be null`);
      }
      const blockerTotal = RIM_FIVE_CANONICAL_BLOCKER_KEYS.reduce(
        (sum, key) => sum + (Array.isArray(row.blockers?.[key]) ? row.blockers[key].length : 0),
        0,
      );
      if (blockerTotal === 0) reasons.push(`${label} NULL rows require an explicit blocker`);
    }
  }
  if (!object(artifact.source_clocks)) reasons.push("canonical artifact source_clocks must be an object");
  else {
    if (JSON.stringify(Object.keys(artifact.source_clocks).sort()) !== JSON.stringify([...RIM_FIVE_CANONICAL_INDICES].sort())) {
      reasons.push("canonical artifact source_clocks keys are malformed");
    }
    for (const asset of RIM_FIVE_CANONICAL_INDICES) {
      if (!own(artifact.source_clocks, asset) || JSON.stringify(artifact.source_clocks[asset]) !== JSON.stringify(rowClocks.get(asset))) {
        reasons.push(`canonical artifact source_clocks.${asset} does not match its row`);
      }
    }
  }

  const diagnostic = artifact.order_diagnostic;
  const nonFiniteRows = rows.filter((row) => !finite(row?.fair_value_upside)).map((row) => row?.asset ?? null);
  if (!object(diagnostic)) {
    reasons.push("canonical artifact order_diagnostic must be an object");
  } else {
    if (JSON.stringify(diagnostic.desired_order) !== JSON.stringify(RIM_FIVE_CANONICAL_INDICES)) reasons.push("canonical artifact order_diagnostic.desired_order is malformed");
    if (diagnostic.values_shifted !== false) reasons.push("canonical artifact values_shifted must remain false");
    summary.values_shifted = diagnostic.values_shifted;
    if (!Array.isArray(diagnostic.non_finite_rows) || JSON.stringify(diagnostic.non_finite_rows) !== JSON.stringify(nonFiniteRows)) {
      reasons.push("canonical artifact order_diagnostic.non_finite_rows is malformed");
    }
    if (!Array.isArray(diagnostic.violations)) reasons.push("canonical artifact order_diagnostic.violations must be an array");
    else if (nonFiniteRows.length === 0 && rows.length === RIM_FIVE_CANONICAL_INDICES.length) {
      if (diagnostic.desired_order_met !== orderMet(rows)) reasons.push("canonical artifact order_diagnostic.desired_order_met is dishonest");
      if (JSON.stringify(diagnostic.violations) !== JSON.stringify(orderViolations(rows))) reasons.push("canonical artifact order_diagnostic.violations are dishonest");
    }
    if (typeof diagnostic.desired_order_met !== "boolean") reasons.push("canonical artifact order_diagnostic.desired_order_met must be boolean");
    summary.order_diagnostic_state = nonFiniteRows.length > 0
      ? "not_comparable"
      : diagnostic.desired_order_met === true ? "met" : "not_met";
  }
  if (artifact.values_shifted === true) {
    summary.values_shifted = true;
    reasons.push("canonical artifact values_shifted must remain false");
  }
  if (summary.null_count > 0) {
    summary.warnings.push(`canonical five-index line has ${summary.null_count} NULL row(s): ${rows.filter((row) => row?.status === "NULL").map((row) => row.asset).join(", ")}`);
  }
  if (summary.canonical_public_status === RIM_FIVE_CANONICAL_PUBLIC_STATUS) {
    summary.warnings.push("canonical five-index line remains quarantined and is not public-ready");
  }
  if (summary.order_diagnostic_state === "not_comparable") {
    summary.warnings.push("canonical five-index natural order is not comparable while one or more rows are non-finite");
  } else if (summary.order_diagnostic_state === "not_met") {
    summary.warnings.push("canonical five-index natural order is not met; values were not shifted");
  }
  if (summary.stale_or_freshness_blocker_count > 0
    || summary.pit_blocker_count > 0
    || summary.direct_or_identity_blocker_count > 0) {
    summary.warnings.push(`canonical row blockers: stale_or_freshness=${summary.stale_or_freshness_blocker_count}, pit=${summary.pit_blocker_count}, direct_or_identity=${summary.direct_or_identity_blocker_count}`);
  }
  summary.blocking_reasons = [...new Set(reasons)];
  return { summary, reasons: [...new Set(reasons)] };
}

function readArtifact(root, { publicDataRoot = null } = {}) {
  const artifactPath = path.join(root, RIM_FIVE_CANONICAL_ARTIFACT_REL);
  let present = false;
  let artifact = null;
  let readFailure = null;
  try {
    const stat = fs.lstatSync(artifactPath);
    present = true;
    if (stat.isSymbolicLink() || !stat.isFile()) readFailure = "unparseable";
    else {
      try {
        artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      } catch {
        readFailure = "unparseable";
      }
    }
  } catch (error) {
    readFailure = error?.code === "ENOENT" ? "missing" : "unparseable";
    present = error?.code !== "ENOENT";
  }
  const publicRoot = publicDataRoot ?? path.join(root, "100xfenok-next", "public", "data");
  const publicDataMarker = "100xfenok-next/public/data/";
  const publicCandidates = RIM_FIVE_CANONICAL_PUBLIC_MIRROR_RELS.map((relative) => path.join(
    publicRoot,
    relative.startsWith(publicDataMarker) ? relative.slice(publicDataMarker.length) : relative,
  ));
  const publicLeak = publicCandidates.some((candidate) => {
    try { fs.lstatSync(candidate); return true; } catch { return false; }
  });
  return { artifact, present, publicLeak, readFailure };
}

function getArg(argv, flag) {
  const equal = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (equal) return equal.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? null : null;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) {
    throw new Error(`${filePath} read failed: ${error.message}`);
  }
}

function compareField(errors, details, expected, key) {
  if (JSON.stringify(details?.[key]) !== JSON.stringify(expected[key])) {
    errors.push(`rim_inputs.details.${key} does not match canonical health (${JSON.stringify(details?.[key])} vs ${JSON.stringify(expected[key])})`);
  }
}

export function checkRimInputsCanonicalHealth(rootDoc, {
  root = ROOT,
  publicDataRoot = null,
  artifact = undefined,
  canonicalPresent = undefined,
  publicLeak = undefined,
  readFailure = undefined,
} = {}) {
  const source = artifact === undefined
    ? readArtifact(root, { publicDataRoot })
    : {
        artifact,
        present: canonicalPresent ?? true,
        publicLeak: publicLeak ?? false,
        readFailure: readFailure ?? null,
      };
  const { summary, reasons } = expectedSummary(source.artifact, {
    present: source.present,
    publicLeak: source.publicLeak,
    readFailure: source.readFailure,
  });
  const errors = [];
  const warnings = [];
  const lane = Array.isArray(rootDoc?.lanes) ? rootDoc.lanes.find((item) => item?.id === "rim_inputs") : null;
  if (!lane) {
    errors.push("rim_inputs lane is missing");
    return { valid: false, errors, warnings, expected: summary, blocking_reasons: reasons };
  }
  const details = lane.details;
  if (!object(details)) errors.push("rim_inputs.details must be an object");
  for (const key of [
    "canonical_present", "canonical_public_status", "ready_count", "null_count", "total_count",
    "stale_or_freshness_blocker_count", "pit_blocker_count", "direct_or_identity_blocker_count",
    "order_diagnostic_state", "values_shifted", "exact_yoo", "yoo_status", "private_only", "public_leak",
  ]) compareField(errors, details, summary, key);
  for (const key of ["canonical_parseable", "canonical_file_present", "freshness_blocker_count", "private_only_status", "public_leak_status"]) {
    if (own(details, key)) compareField(errors, details, summary, key);
  }
  if (!Array.isArray(details?.warnings) || details.warnings.some((item) => typeof item !== "string")) {
    errors.push("rim_inputs.details.warnings must be an array of strings");
  } else if (JSON.stringify(details.warnings) !== JSON.stringify(summary.warnings)) {
    errors.push("rim_inputs.details.warnings do not match canonical warning evidence");
  }
  if (!Array.isArray(details?.blocking_reasons) || details.blocking_reasons.some((item) => typeof item !== "string")) {
    errors.push("rim_inputs.details.blocking_reasons must be an array of strings");
  } else if (JSON.stringify(details.blocking_reasons) !== JSON.stringify(reasons)) {
    errors.push("rim_inputs.details.blocking_reasons do not match canonical corruption evidence");
  }
  const integrity = lane.checks?.find((item) => item?.id === "canonical_integrity");
  if (!integrity) errors.push("rim_inputs canonical_integrity check is missing");
  else {
    const shouldBeReady = reasons.length === 0;
    if (integrity.status !== (shouldBeReady ? "ready" : "blocked")) {
      errors.push(`rim_inputs/canonical_integrity status does not match corruption state (${integrity.status})`);
    }
    if (integrity.platform_blocking !== true) errors.push("rim_inputs/canonical_integrity must be platform_blocking");
  }
  for (const reason of reasons) {
    errors.push(`canonical integrity violation: ${reason}`);
  }
  warnings.push(...summary.warnings);
  return { valid: errors.length === 0, errors, warnings, expected: summary, blocking_reasons: reasons };
}

export const validateRimInputsCanonicalHealth = checkRimInputsCanonicalHealth;

function main() {
  try {
    const dataRoot = getArg(process.argv.slice(2), "--data-root");
    const root = dataRoot ? path.resolve(dataRoot) : ROOT;
    const rootPath = path.join(root, KPI_REL);
    const publicPath = dataRoot
      ? path.join(root, "public", "data", "admin", "fenok-data-health-kpi.json")
      : path.join(root, PUBLIC_KPI_REL);
    const rootDoc = readJson(rootPath);
    const publicDoc = readJson(publicPath);
    const result = checkRimInputsCanonicalHealth(rootDoc, {
      root,
      publicDataRoot: dataRoot ? path.join(root, "public", "data") : null,
    });
    if (JSON.stringify(publicDoc?.lanes?.find((item) => item?.id === "rim_inputs")?.details)
      !== JSON.stringify(rootDoc?.lanes?.find((item) => item?.id === "rim_inputs")?.details)) {
      result.errors.push("public rim_inputs canonical details do not match the private KPI projection");
    }
    if (!result.valid || result.errors.length > 0) {
      console.error("fenok rim_inputs canonical KPI check failed");
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify({ ok: true, warnings: result.warnings.length, ...result.expected }, null, 2));
  } catch (error) {
    console.error(`fenok rim_inputs canonical KPI check failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
