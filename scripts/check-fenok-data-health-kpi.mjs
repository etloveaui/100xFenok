#!/usr/bin/env node

// Validate the small, nonblocking per-data-set health projection. Freshness
// affects the reported status, never this check's exit code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";
import {
  DETECTION_CALENDARS,
  HEALTH_SET_EXCLUSIONS,
  publicServedPath,
  readDetectionFloorRows,
  summarizeDataSetFreshness,
} from "./lib/fenok-data-health-freshness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KPI_REL = path.join("admin", "fenok-data-health-kpi.json");
const CURRENT_SCHEMA_VERSION = "fenok-data-health-kpi/v4";
const LEGACY_SCHEMA_VERSION = "fenok-data-health-kpi/v3";
const SUPPORTED_SCHEMA_VERSIONS = new Set([LEGACY_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION]);
const BASE_SET_KEYS = ["set", "served_path", "newest_source_date", "max_age", "status"];
const OPTIONAL_SET_KEYS = [
  "date_basis",
  "oldest_source_date",
  "oldest_source_member",
  "fresh_members",
  "total_members",
  "serving_lkg",
];
const ALLOWED_STATUS = new Set(["fresh", "delayed", "stopped", "unknown"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dataSetLanes(registry = LANE_REGISTRY) {
  return registry.lanes.filter((lane) => (
    lane.lane_class === "detection_floor" && !HEALTH_SET_EXCLUSIONS.has(lane.id)
  ));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateDocument(document, label, expectedLanes, floorRows, calendars, dataRoot, freshnessCache) {
  const errors = [];
  if (!object(document)) return [`${label} must be a JSON object`];
  if (!SUPPORTED_SCHEMA_VERSIONS.has(document.schema_version)) {
    errors.push(`${label}.schema_version must be ${CURRENT_SCHEMA_VERSION} or ${LEGACY_SCHEMA_VERSION}`);
  }
  const isLegacy = document.schema_version === LEGACY_SCHEMA_VERSION;
  const generatedAtValid = typeof document.generated_at === "string" && Number.isFinite(Date.parse(document.generated_at));
  if (!generatedAtValid) {
    errors.push(`${label}.generated_at must be a valid timestamp`);
  }
  if (JSON.stringify(Object.keys(document).sort()) !== JSON.stringify(["generated_at", "schema_version", "sets"].sort())) {
    errors.push(`${label} has unexpected top-level fields`);
  }
  if (!Array.isArray(document.sets)) {
    errors.push(`${label}.sets must be an array`);
    return errors;
  }
  const byId = new Map(expectedLanes.map((lane) => [lane.id, lane]));
  const seen = new Set();
  for (const [index, row] of document.sets.entries()) {
    const context = `${label}.sets[${index}]`;
    if (!object(row) || typeof row.set !== "string" || !byId.has(row.set) || seen.has(row.set)) {
      errors.push(`${context}.set must identify one unique detection-floor data set`);
      continue;
    }
    seen.add(row.set);
    const lane = byId.get(row.set);
    const cacheKey = `${lane.id}\u0000${document.generated_at}`;
    let expected = freshnessCache.get(cacheKey);
    if (!expected) {
      expected = summarizeDataSetFreshness(
        lane,
        floorRows.get(lane.id),
        document.generated_at,
        calendars,
        dataRoot,
      );
      freshnessCache.set(cacheKey, expected);
    }
    const hasLkg = Object.hasOwn(row, "serving_lkg");
    const rowKeys = Object.keys(row);
    for (const key of BASE_SET_KEYS) {
      if (!Object.hasOwn(row, key)) errors.push(`${context} is missing ${key}`);
    }
    const unexpectedKeys = rowKeys.filter((key) => !BASE_SET_KEYS.includes(key) && !OPTIONAL_SET_KEYS.includes(key));
    if (unexpectedKeys.length > 0) errors.push(`${context} has unexpected fields`);
    if (row.served_path !== null && typeof row.served_path !== "string") {
      errors.push(`${context}.served_path must be a string or null`);
    }
    const approvedPath = publicServedPath(lane);
    if (row.served_path !== approvedPath && !(isLegacy && row.served_path === null)) {
      errors.push(`${context}.served_path is not the registry-approved public path`);
    }
    if (row.newest_source_date !== null && !validDate(row.newest_source_date)) {
      errors.push(`${context}.newest_source_date must be a calendar date or null`);
    }
    if (row.max_age !== null && (typeof row.max_age !== "string" || row.max_age.length === 0)) {
      errors.push(`${context}.max_age must be a nonempty string or null`);
    }
    if (!ALLOWED_STATUS.has(row.status)) errors.push(`${context}.status must be fresh, delayed, stopped, or unknown`);
    if (generatedAtValid && !isLegacy) {
      if (row.newest_source_date !== expected.newest_source_date) {
        errors.push(`${context}.newest_source_date does not match source-date evidence`);
      }
      if (row.max_age !== expected.max_age) errors.push(`${context}.max_age does not match freshness-policy`);
      if (row.status !== expected.status) errors.push(`${context}.status does not match source age and freshness-policy`);
    }
    if (generatedAtValid) {
      if (Object.hasOwn(row, "date_basis") && row.date_basis !== expected.date_basis) {
        errors.push(`${context}.date_basis does not match source-date evidence`);
      }
      if (Object.hasOwn(row, "oldest_source_date") && row.oldest_source_date !== expected.oldest_source_date) {
        errors.push(`${context}.oldest_source_date does not match source-date evidence`);
      }
      if (Object.hasOwn(row, "oldest_source_member") && row.oldest_source_member !== expected.oldest_source_member) {
        errors.push(`${context}.oldest_source_member does not match source-date evidence`);
      }
      if (Object.hasOwn(row, "fresh_members") && row.fresh_members !== expected.fresh_members) {
        errors.push(`${context}.fresh_members does not match member freshness`);
      }
      if (Object.hasOwn(row, "total_members") && row.total_members !== expected.total_members) {
        errors.push(`${context}.total_members does not match member count`);
      }
    }
    if (Object.hasOwn(row, "date_basis") && !["collected", "mixed"].includes(row.date_basis)) {
      errors.push(`${context}.date_basis must be collected or mixed when present`);
    }
    if (Object.hasOwn(row, "oldest_source_date")
      && row.oldest_source_date !== null && !validDate(row.oldest_source_date)) {
      errors.push(`${context}.oldest_source_date must be a calendar date or null`);
    }
    if (Object.hasOwn(row, "oldest_source_member")
      && row.oldest_source_member !== null && typeof row.oldest_source_member !== "string") {
      errors.push(`${context}.oldest_source_member must be a string or null`);
    }
    if (Object.hasOwn(row, "fresh_members")
      && (!Number.isInteger(row.fresh_members) || row.fresh_members < 0)) {
      errors.push(`${context}.fresh_members must be a nonnegative integer`);
    }
    if (Object.hasOwn(row, "total_members")
      && (!Number.isInteger(row.total_members) || row.total_members < 1)) {
      errors.push(`${context}.total_members must be a positive integer`);
    }
    if (Object.hasOwn(row, "fresh_members") && Object.hasOwn(row, "total_members")
      && row.fresh_members > row.total_members) {
      errors.push(`${context}.fresh_members cannot exceed total_members`);
    }
    if (hasLkg && typeof row.serving_lkg !== "boolean") errors.push(`${context}.serving_lkg must be a boolean when present`);
  }
  for (const lane of expectedLanes) {
    if (!seen.has(lane.id)) errors.push(`${label}.sets is missing ${lane.id}`);
  }
  return errors;
}

export function validateKpiDocuments(rootDoc, publicDoc, {
  registry = LANE_REGISTRY,
  dataRoot = path.join(ROOT, "data"),
  calendars = DETECTION_CALENDARS,
} = {}) {
  const lanes = dataSetLanes(registry);
  const floorRows = readDetectionFloorRows(dataRoot);
  const freshnessCache = new Map();
  const errors = [
    ...validateDocument(rootDoc, "private KPI", lanes, floorRows, calendars, dataRoot, freshnessCache),
    ...validateDocument(publicDoc, "public KPI", lanes, floorRows, calendars, dataRoot, freshnessCache),
  ];
  if (JSON.stringify(rootDoc) !== JSON.stringify(publicDoc)) {
    errors.push("public KPI must match the public-safe canonical KPI document");
  }
  const warnings = (Array.isArray(rootDoc?.sets) ? rootDoc.sets : [])
    .filter((row) => ALLOWED_STATUS.has(row?.status) && row.status !== "fresh")
    .map((row) => `${row.set} source age is ${row.status}`);
  return { errors, warnings, set_count: Array.isArray(rootDoc?.sets) ? rootDoc.sets.length : 0 };
}

function getArg(flag) {
  const equal = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (equal) return equal.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

export function executeCheckerRun({ dataRoot = getArg("--data-root") } = {}) {
  const repoRoot = dataRoot ? path.resolve(dataRoot) : ROOT;
  const rootKpiPath = path.join(repoRoot, "data", KPI_REL);
  const appPublicPath = path.join(repoRoot, "100xfenok-next", "public", "data", KPI_REL);
  const fixturePublicPath = path.join(repoRoot, "public", "data", KPI_REL);
  const publicKpiPath = fs.existsSync(appPublicPath) || !fs.existsSync(fixturePublicPath)
    ? appPublicPath : fixturePublicPath;
  let rootDoc;
  let publicDoc;
  try {
    rootDoc = readJson(rootKpiPath);
    publicDoc = readJson(publicKpiPath);
  } catch (error) {
    return {
      exit: 1,
      stdout: "",
      stderr: `fenok data health KPI check failed: ${error.message}\n`,
      errors: [error.message],
      warnings: [],
    };
  }
  const result = validateKpiDocuments(rootDoc, publicDoc, { dataRoot: path.join(repoRoot, "data") });
  const statusCounts = Object.fromEntries([...ALLOWED_STATUS].map((status) => [
    status,
    rootDoc?.sets?.filter((row) => row?.status === status).length ?? 0,
  ]));
  const stderr = result.warnings.map((warning) => `::warning:: fenok KPI ${warning}`).join("\n");
  if (result.errors.length > 0) {
    const lines = ["fenok data health KPI check failed", ...result.errors.map((error) => `- ${error}`)];
    return { exit: 1, stdout: "", stderr: `${stderr ? `${stderr}\n` : ""}${lines.join("\n")}\n`, ...result };
  }
  const summary = {
    ok: true,
    schema_version: rootDoc.schema_version,
    generated_at: rootDoc.generated_at,
    sets: result.set_count,
    status_counts: statusCounts,
    warnings: result.warnings.length,
  };
  return {
    exit: 0,
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
    stderr: stderr ? `${stderr}\n` : "",
    summary,
    ...result,
  };
}

function main() {
  const result = executeCheckerRun();
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.exit !== 0) process.exit(result.exit);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
