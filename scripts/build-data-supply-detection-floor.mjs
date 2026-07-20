#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATA_SUPPLY_DETECTION_CONFIG,
  canonicalJson,
  validateDetectionConfig,
} from "./lib/data-supply-detection-config.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const REPO_ROOT = path.resolve(__dirname, "..");
export const FIXTURE_ROOT = path.join(REPO_ROOT, "scripts", "fixtures", "data_supply", "detection_floor");
export const CALENDAR_PATH = path.join(REPO_ROOT, "scripts", "lib", "data-supply-detection-calendars.json");
export const REPORT_BASENAME = "data-supply-detection-floor.json";
export const REPORT_SCHEMA = "data-supply-detection-floor/v1";
export const ATTEMPT_SCHEMA = "data-supply-detection-attempts/v1";
export const ATTEMPT_SHARD_SCHEMA = "data-supply-detection-attempt-shard/v1";

const HEX_16 = /^[0-9a-f]{16}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;
const ATTEMPT_IDENTIFIER = /^[a-z][a-z0-9_-]{0,95}$/;
const FINAL_REASON_CODES = new Set([
  "ok",
  "missing_artifact",
  "workflow_unobserved",
  "transport_error",
  "http_error",
  "auth_error",
  "rate_limited",
  "decode_error",
  "schema_drift",
  "empty_payload",
  "future_source",
  "stale",
  "unexpected_error",
]);
const STATUSES = new Set(["ready", "unobserved", "stale", "drift", "unavailable"]);
const STATUS_SEVERITY = Object.freeze({ ready: 0, unobserved: 1, stale: 2, drift: 3, unavailable: 4 });
const REASON_STATUS = Object.freeze({
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
const ATTEMPT_KEYS = Object.freeze([
  "lane_id",
  "member_id",
  "attempt_id",
  "observed_at",
  "execution",
  "exception_kind",
  "http_status",
  "auth",
  "rate_limited",
  "decode",
  "payload",
  "assertions",
]);
const LIBRARY_ATTEMPT_KEYS = Object.freeze([
  ...ATTEMPT_KEYS,
  "candidates",
  "retry_count",
  "latency_ms",
  "outcome",
]);
const FAILPOINTS = new Set([
  "before_temp_open",
  "after_temp_open",
  "mid_write",
  "after_temp_fsync",
  "after_temp_validation",
  "before_rename",
  "after_rename_before_parent_fsync",
  "after_parent_fsync",
]);

export class DetectionFloorError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "DetectionFloorError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new DetectionFloorError(code, message);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, expected, context) {
  if (!isPlainObject(value)) fail("schema_error", `${context} must be a plain object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail("schema_error", `${context} keys must be exactly ${wanted.join(",")}`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function digestConfig(config) {
  validateDetectionConfig(config);
  return sha256(Buffer.from(canonicalJson(config), "utf8"));
}

function strictUtc(value, context, { allowDate = false } = {}) {
  if (typeof value !== "string" || !(RFC3339_UTC.test(value) || (allowDate && DATE_ONLY.test(value)))) {
    fail("clock_error", `${context} must be canonical UTC${allowDate ? " or YYYY-MM-DD" : ""}`);
  }
  const normalized = DATE_ONLY.test(value) ? `${value}T00:00:00Z` : value;
  const epoch = Date.parse(normalized);
  if (!Number.isFinite(epoch)) fail("clock_error", `${context} is not a real date`);
  const date = new Date(epoch);
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    fail("clock_error", `${context} is not a real calendar date`);
  }
  return { value, epoch, date };
}

function noDotComponents(raw) {
  return raw.split(path.sep).every((component) => component !== "." && component !== "..");
}

function physicalAncestors(absPath, fsModule = fs) {
  const parsed = path.parse(absPath);
  const components = absPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const rows = [];
  let cursor = parsed.root;
  for (const component of components) {
    cursor = path.join(cursor, component);
    const stat = fsModule.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("unsafe_path", `physical ancestor is not a real directory: ${cursor}`);
    }
    rows.push({ path: cursor, dev: stat.dev, ino: stat.ino });
  }
  return rows;
}

export function canonicalExistingDirectory(raw, { fsModule = fs, secure = false } = {}) {
  if (typeof raw !== "string" || raw.length === 0 || raw.includes("\0") || !path.isAbsolute(raw) || !noDotComponents(raw)) {
    fail("unsafe_path", "directory must be a normalized absolute path");
  }
  let lexical;
  try {
    lexical = fsModule.lstatSync(raw);
  } catch (error) {
    fail("unsafe_path", `directory is missing: ${error.message}`);
  }
  if (lexical.isSymbolicLink() || !lexical.isDirectory()) fail("unsafe_path", "directory leaf must be a real directory");
  const real = fsModule.realpathSync.native ? fsModule.realpathSync.native(raw) : fsModule.realpathSync(raw);
  const stat = fsModule.lstatSync(real);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("unsafe_path", "physical directory is invalid");
  const ancestors = physicalAncestors(real, fsModule);
  if (secure && typeof process.getuid === "function") {
    if (stat.uid !== process.getuid()) fail("unsafe_path", "output root is not owned by the current uid");
    if ((stat.mode & 0o022) !== 0) fail("unsafe_path", "output root is group/world writable");
  }
  return { raw, real, dev: stat.dev, ino: stat.ino, mode: stat.mode, uid: stat.uid, ancestors };
}

export function containsPath(parentReal, childReal) {
  const relative = path.relative(parentReal, childReal);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

export function pathsOverlap(aReal, bReal) {
  return containsPath(aReal, bReal) || containsPath(bReal, aReal);
}

function canonicalExistingFile(raw, allowedRoots, { fsModule = fs } = {}) {
  if (typeof raw !== "string" || !path.isAbsolute(raw) || raw.includes("\0") || !noDotComponents(raw)) {
    fail("unsafe_path", "fixture file must be a normalized absolute path");
  }
  const lexical = fsModule.lstatSync(raw);
  if (lexical.isSymbolicLink() || !lexical.isFile()) fail("unsafe_path", "fixture input must be a regular non-symlink file");
  const real = fsModule.realpathSync.native ? fsModule.realpathSync.native(raw) : fsModule.realpathSync(raw);
  const parent = path.dirname(real);
  physicalAncestors(parent, fsModule);
  if (!allowedRoots.some((root) => containsPath(root.real, real))) fail("unsafe_path", "fixture input is outside allowlisted roots");
  const stat = fsModule.lstatSync(real);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.dev !== lexical.dev || stat.ino !== lexical.ino || stat.nlink !== 1) {
    fail("unsafe_path", "fixture input identity changed");
  }
  return { real, dev: stat.dev, ino: stat.ino };
}

function pathInfoMatches(info, fsModule = fs) {
  const stat = fsModule.lstatSync(info.real);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== info.dev || stat.ino !== info.ino) return false;
  for (const expected of info.ancestors) {
    const current = fsModule.lstatSync(expected.path);
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== expected.dev || current.ino !== expected.ino) return false;
  }
  return true;
}

function fixedProtectedRoots(repoRoot, artifactRoot, fsModule = fs) {
  const repo = canonicalExistingDirectory(repoRoot, { fsModule });
  const outer = canonicalExistingDirectory(path.resolve(repo.real, "../.."), { fsModule });
  const artifact = canonicalExistingDirectory(artifactRoot, { fsModule });
  const roots = [repo, outer, artifact];
  for (const candidate of [
    path.join(repo.real, "data"),
    path.join(repo.real, "100xfenok-next", "public"),
    path.join(repo.real, "100xfenok-next", ".next"),
    path.join(repo.real, "100xfenok-next", ".open-next"),
    path.join(repo.real, "dist"),
    path.join(repo.real, "build"),
  ]) {
    if (fsModule.existsSync(candidate)) roots.push(canonicalExistingDirectory(candidate, { fsModule }));
  }
  return roots;
}

function reportFileLooksValid(finalPath, config, fsModule = fs) {
  if (!fsModule.existsSync(finalPath)) return false;
  let fd = null;
  try {
    const lexical = fsModule.lstatSync(finalPath);
    if (!lexical.isFile() || lexical.isSymbolicLink() || lexical.nlink !== 1) return false;
    fd = fsModule.openSync(finalPath, fsModule.constants.O_RDONLY | fsModule.constants.O_NOFOLLOW);
    const opened = fsModule.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== lexical.dev || opened.ino !== lexical.ino) return false;
    const parsed = JSON.parse(fsModule.readFileSync(fd, "utf8"));
    validateDetectionReport(parsed, config);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fsModule.closeSync(fd); } catch {}
    }
  }
}

function validateInventory(context, phase, tempName = null, fsModule = fs) {
  const entries = fsModule.readdirSync(context.output.real).sort();
  const finalExists = entries.includes(REPORT_BASENAME);
  const allowed = phase === "temp_live"
    ? [REPORT_BASENAME, tempName].filter(Boolean)
    : [REPORT_BASENAME];
  if (entries.some((entry) => !allowed.includes(entry))) fail("unsafe_path", `unexpected output-root entry during ${phase}`);
  if (phase === "post_rename" && (entries.length !== 1 || entries[0] !== REPORT_BASENAME)) {
    fail("atomic_write_error", "success inventory must contain exactly the final report");
  }
  if (phase === "pre_temp" && finalExists && !reportFileLooksValid(context.finalPath, context.config, fsModule)) {
    fail("unsafe_path", "prior final is not a valid regular v1 report");
  }
  if (phase === "temp_live" && (!tempName || !entries.includes(tempName))) {
    fail("atomic_write_error", "owned temp is missing during temp-live phase");
  }
}

function validateOutputContext(context, phase, tempName = null, fsModule = fs) {
  if (!pathInfoMatches(context.output, fsModule)) fail("unsafe_path", "output root identity changed");
  for (const protectedRoot of context.protectedRoots) {
    if (!pathInfoMatches(protectedRoot, fsModule)) fail("unsafe_path", "protected-root identity changed");
    if (pathsOverlap(context.output.real, protectedRoot.real)) fail("unsafe_path", "output root overlaps a protected root");
  }
  if (path.dirname(context.finalPath) !== context.output.real) fail("unsafe_path", "final path escaped output root");
  if (fsModule.existsSync(context.finalPath)) {
    const finalStat = fsModule.lstatSync(context.finalPath);
    if (finalStat.isSymbolicLink() || !finalStat.isFile()) fail("unsafe_path", "final target is not a regular file");
  }
  validateInventory(context, phase, tempName, fsModule);
}

function validateRootBoundary(context, rootFd, phase, tempName = null, fsModule = fs) {
  validateOutputContext(context, phase, tempName, fsModule);
  const rootStat = fsModule.fstatSync(rootFd);
  if (!rootStat.isDirectory() || rootStat.dev !== context.output.dev || rootStat.ino !== context.output.ino) {
    fail("unsafe_path", "opened output-root identity changed");
  }
}

export function prepareOutputContext({ outputRoot, artifactRoot, config = DATA_SUPPLY_DETECTION_CONFIG, fsModule = fs }) {
  if (fsModule.constants.O_NOFOLLOW == null || fsModule.constants.O_DIRECTORY == null) {
    fail("unsupported_platform", "O_NOFOLLOW and O_DIRECTORY are required");
  }
  const output = canonicalExistingDirectory(outputRoot, { fsModule, secure: true });
  const protectedRoots = fixedProtectedRoots(REPO_ROOT, artifactRoot, fsModule);
  const finalPath = path.join(output.real, REPORT_BASENAME);
  validateDetectionConfig(config);
  const context = { output, protectedRoots, finalPath, config };
  validateOutputContext(context, "pre_temp", null, fsModule);
  return context;
}

function readPointer(document, pointer) {
  if (pointer === "") return document;
  let current = document;
  for (const token of pointer.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function assertArtifact(document, assertion) {
  const value = readPointer(document, assertion.pointer);
  if (assertion.kind === "required_pointer") return value !== undefined;
  if (assertion.kind === "type") return value !== undefined && jsonType(value) === assertion.expected;
  if (assertion.kind === "enum") return value !== undefined && assertion.values.some((entry) => canonicalJson(entry) === canonicalJson(value));
  if (assertion.kind === "min_rows") return Array.isArray(value) && value.length >= assertion.min;
  if (assertion.kind === "min_keys") return isPlainObject(value) && Object.keys(value).length >= assertion.min;
  if (assertion.kind === "object_array_fields") {
    if (!Array.isArray(value) || value.length < assertion.min) return false;
    const unique = new Set();
    for (const row of value) {
      if (!isPlainObject(row)
        || !Object.entries(assertion.fields).every(([field, expected]) => jsonType(row[field]) === expected)
        || assertion.non_empty_fields.some((field) => row[field].trim() === "")) return false;
      const identity = row[assertion.unique_by];
      const normalizedIdentity = typeof identity === "string" ? identity.trim().toUpperCase() : identity;
      if (unique.has(normalizedIdentity)) return false;
      unique.add(normalizedIdentity);
    }
    return true;
  }
  if (assertion.kind === "counted_identity_rows") {
    const count = value?.[assertion.count_field];
    const identities = value?.[assertion.identities_field];
    const rows = value?.[assertion.rows_field];
    if (!Number.isInteger(count) || count < assertion.min || !Array.isArray(identities) || !Array.isArray(rows)
      || identities.length !== count || rows.length !== count) return false;
    const unique = new Set();
    return rows.every((row, index) => {
      const identity = row?.[assertion.row_identity_field];
      const normalizedIdentity = typeof identity === "string" ? identity.trim().toUpperCase() : identity;
      if (!isPlainObject(row) || row[assertion.row_rank_field] !== index + 1
        || assertion.row_string_fields.some((field) => typeof row[field] !== "string" || row[field].trim() === "")
        || identities[index] !== identity || unique.has(normalizedIdentity)) return false;
      unique.add(normalizedIdentity);
      return true;
    });
  }
  if (assertion.kind === "exact") return value !== undefined && canonicalJson(value) === canonicalJson(assertion.value);
  if (assertion.kind === "non_empty_series") {
    return isPlainObject(value) && Object.keys(value).length > 0
      && Object.values(value).every((series) => Array.isArray(series) && series.length > 0 && series.some((entry) => entry != null));
  }
  fail("schema_error", `unknown artifact assertion ${assertion.kind}`);
}

function canonicalTimestamp(epoch) {
  return new Date(epoch).toISOString().replace(/\.000Z$/, "Z");
}

function normalizeSourceValue(value, format) {
  if (format === "date") return strictUtc(value, "artifact source date", { allowDate: true }).value;
  if (format === "rfc3339") {
    const match = typeof value === "string"
      ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
      : null;
    if (!match) fail("clock_error", "artifact source timestamp is invalid");
    const epoch = Date.parse(value);
    if (!Number.isFinite(epoch)) fail("clock_error", "artifact source timestamp is invalid");
    const offsetMinutes = match[7] === "Z" ? 0 : (match[8] === "+" ? 1 : -1) * (Number(match[9]) * 60 + Number(match[10]));
    if (Math.abs(offsetMinutes) > 14 * 60) fail("clock_error", "artifact source offset is invalid");
    const local = new Date(epoch + offsetMinutes * 60_000);
    if (local.getUTCFullYear() !== Number(match[1]) || local.getUTCMonth() + 1 !== Number(match[2]) || local.getUTCDate() !== Number(match[3])
      || local.getUTCHours() !== Number(match[4]) || local.getUTCMinutes() !== Number(match[5]) || local.getUTCSeconds() !== Number(match[6])) {
      fail("clock_error", "artifact source timestamp is not a real date");
    }
    return canonicalTimestamp(epoch);
  }
  if (format === "yyyymmdd") {
    if (typeof value !== "string" || !/^\d{8}$/.test(value)) fail("clock_error", "artifact source YYYYMMDD is invalid");
    const normalized = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    strictUtc(normalized, "artifact source YYYYMMDD", { allowDate: true });
    return normalized;
  }
  if (format === "unix_seconds") {
    if (!Number.isSafeInteger(value) || value < 0) fail("clock_error", "artifact source unix seconds is invalid");
    return canonicalTimestamp(value * 1000);
  }
  fail("schema_error", `unknown source format ${format}`);
}

function quarterEnd(value) {
  const match = typeof value === "string" ? /^(\d{4})-Q([1-4])$/.exec(value) : null;
  if (!match) fail("clock_error", "artifact quarter is invalid");
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  const month = quarter * 3;
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function extractSourceAsOf(document, selector) {
  let candidates;
  if (selector.kind === "pointer") {
    candidates = [readPointer(document, selector.pointer)];
  } else if (selector.kind === "max_array_field") {
    const rows = readPointer(document, selector.pointer);
    if (!Array.isArray(rows) || rows.length === 0) fail("clock_error", "source selector array is empty");
    candidates = rows.map((row) => isPlainObject(row) ? row[selector.field] : undefined);
  } else if (selector.kind === "max_object_series_field") {
    const series = readPointer(document, selector.pointer);
    if (!isPlainObject(series) || Object.keys(series).length === 0) fail("clock_error", "source selector series object is empty");
    candidates = Object.values(series).flatMap((rows) => Array.isArray(rows) ? rows.map((row) => isPlainObject(row) ? row[selector.field] : undefined) : [undefined]);
  } else if (selector.kind === "max_object_field") {
    const object = readPointer(document, selector.pointer);
    if (!isPlainObject(object) || Object.keys(object).length === 0) fail("clock_error", "source selector object is empty");
    candidates = Object.values(object).map((row) => isPlainObject(row) ? row[selector.field] : undefined);
  } else if (selector.kind === "max_quarter") {
    const quarters = readPointer(document, selector.pointer);
    if (!Array.isArray(quarters) || quarters.length === 0) fail("clock_error", "source selector quarter array is empty");
    candidates = quarters.map(quarterEnd);
    selector = { ...selector, format: "date" };
  } else {
    fail("schema_error", `unknown source selector ${selector.kind}`);
  }
  if (candidates.length === 0 || candidates.some((candidate) => candidate === undefined || candidate === null)) fail("clock_error", "source selector is incomplete");
  const normalized = candidates.map((candidate) => normalizeSourceValue(candidate, selector.format));
  return normalized.reduce((latest, candidate) => {
    const latestEpoch = strictUtc(latest, "artifact source", { allowDate: true }).epoch;
    const candidateEpoch = strictUtc(candidate, "artifact source", { allowDate: true }).epoch;
    return candidateEpoch > latestEpoch ? candidate : latest;
  });
}

function safeArtifactPath(artifactRootInfo, relativePath, fsModule = fs) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) || relativePath.includes("\\") || relativePath.includes("\0")) {
    fail("unsafe_path", "artifact path is not bounded relative POSIX form");
  }
  const components = relativePath.split("/");
  if (components.some((component) => !component || component === "." || component === ".." || component.includes("*"))) {
    fail("unsafe_path", "artifact path contains an unsafe component");
  }
  const absolute = path.join(artifactRootInfo.real, ...components);
  if (!containsPath(artifactRootInfo.real, absolute)) fail("unsafe_path", "artifact path escaped root");
  let cursor = artifactRootInfo.real;
  for (const component of components) {
    cursor = path.join(cursor, component);
    let stat;
    try {
      stat = fsModule.lstatSync(cursor);
    } catch (error) {
      if (error?.code === "ENOENT") return { absolute, missing: true };
      throw error;
    }
    if (stat.isSymbolicLink()) fail("unsafe_path", `artifact path traverses symlink: ${relativePath}`);
  }
  const stat = fsModule.lstatSync(absolute);
  if (!stat.isFile()) fail("unsafe_path", `artifact target is not regular: ${relativePath}`);
  const real = fsModule.realpathSync.native ? fsModule.realpathSync.native(absolute) : fsModule.realpathSync(absolute);
  if (!containsPath(artifactRootInfo.real, real)) fail("unsafe_path", "artifact real path escaped root");
  return { absolute: real, missing: false, dev: stat.dev, ino: stat.ino, size: stat.size };
}

function resolveArtifactContractPaths(contract, artifactRootInfo, fsModule = fs) {
  if (contract.selection === "single") return [safeArtifactPath(artifactRootInfo, contract.path, fsModule)];
  const components = contract.path.split("/");
  const pattern = components.pop();
  if (contract.selection !== "all" || !pattern?.includes("*")) fail("schema_error", "artifact glob selection is invalid");
  const parentRelative = components.join("/");
  let parent = artifactRootInfo.real;
  for (const component of components) {
    parent = path.join(parent, component);
    let stat;
    try {
      stat = fsModule.lstatSync(parent);
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail("unsafe_path", `artifact glob parent is unsafe: ${parentRelative}`);
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", ".*");
  const matcher = new RegExp(`^${escaped}$`);
  return fsModule.readdirSync(parent)
    .filter((name) => matcher.test(name))
    .sort()
    .map((name) => safeArtifactPath(artifactRootInfo, `${parentRelative}/${name}`, fsModule));
}

function reasonResult(reason, extra = {}) {
  if (!FINAL_REASON_CODES.has(reason)) fail("schema_error", `unknown reason ${reason}`);
  const status = REASON_STATUS[reason];
  if (!STATUSES.has(status)) fail("schema_error", `reason ${reason} has no status`);
  return { status, reason, ...extra };
}

function evaluateArtifactFile(contract, resolved, artifactRootInfo, fsModule = fs) {
  let document;
  let fd = null;
  try {
    fd = fsModule.openSync(resolved.absolute, fsModule.constants.O_RDONLY | fsModule.constants.O_NOFOLLOW);
    const opened = fsModule.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== resolved.dev || opened.ino !== resolved.ino || opened.size > 64 * 1024 * 1024) {
      fail("unsafe_path", "artifact identity changed or exceeds the read bound");
    }
    document = JSON.parse(fsModule.readFileSync(fd, "utf8"));
  } catch (error) {
    if (error instanceof DetectionFloorError) throw error;
    return reasonResult("decode_error", { source_as_of: null });
  } finally {
    if (fd !== null) {
      try { fsModule.closeSync(fd); } catch {}
    }
  }
  if (!pathInfoMatches(artifactRootInfo, fsModule)) fail("unsafe_path", "artifact root identity changed during read");
  if (contract.schema_version !== null) {
    const actualSchemaVersion = readPointer(document, contract.schema_version.pointer);
    if (actualSchemaVersion === undefined || canonicalJson(actualSchemaVersion) !== canonicalJson(contract.schema_version.value)) {
      return reasonResult("schema_drift", { source_as_of: null });
    }
  }
  for (const assertion of contract.assertions) {
    if (assertArtifact(document, assertion)) continue;
    const reason = assertion.kind === "min_rows" || assertion.kind === "min_keys" || assertion.kind === "non_empty_series" ? "empty_payload" : "schema_drift";
    return reasonResult(reason, { source_as_of: null });
  }
  if (contract.source_selector.kind === "not_applicable") return reasonResult("ok", { source_as_of: null, source_required: false });
  let source;
  try {
    source = extractSourceAsOf(document, contract.source_selector);
  } catch {
    return { status: "unavailable", reason: "schema_drift", source_as_of: null };
  }
  return reasonResult("ok", { source_as_of: source, source_required: true });
}

function evaluateArtifactContract(contract, artifactRootInfo, claimedPaths, fsModule = fs) {
  if (!pathInfoMatches(artifactRootInfo, fsModule)) fail("unsafe_path", "artifact root identity changed");
  const resolvedPaths = resolveArtifactContractPaths(contract, artifactRootInfo, fsModule);
  if (resolvedPaths.length === 0) return [reasonResult("missing_artifact", { source_as_of: null, source_required: true })];
  const results = [];
  for (const resolved of resolvedPaths) {
    if (resolved.missing) {
      results.push(reasonResult("missing_artifact", { source_as_of: null, source_required: true }));
      continue;
    }
    if (claimedPaths.has(resolved.absolute)) fail("schema_error", `duplicate canonical artifact path ${resolved.absolute}`);
    claimedPaths.add(resolved.absolute);
    results.push(evaluateArtifactFile(contract, resolved, artifactRootInfo, fsModule));
  }
  return results;
}

function calendarById(calendars, id) {
  const row = calendars.calendars.find((candidate) => candidate.id === id);
  if (!row) fail("calendar_error", `calendar ${id} is missing`);
  return row;
}

const calendarFormatters = new Map();
const scheduleOccurrenceCache = new WeakMap();

function calendarParts(epoch, timezone) {
  let formatter = calendarFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    calendarFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epoch)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const ordinal = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    ordinal,
    weekday: new Date(ordinal * 86_400_000).getUTCDay(),
    iso: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function sourceOrdinal(sourceEpoch, sourceValue, calendar) {
  if (typeof sourceValue === "string" && DATE_ONLY.test(sourceValue)) {
    const [year, month, day] = sourceValue.split("-").map(Number);
    return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  }
  return calendarParts(sourceEpoch, calendar.timezone).ordinal;
}

function businessDayAge(sourceEpoch, nowEpoch, calendar, sourceValue = null) {
  let cursor = sourceOrdinal(sourceEpoch, sourceValue, calendar) + 1;
  const end = calendarParts(nowEpoch, calendar.timezone).ordinal;
  const holidays = new Set(calendar.holidays);
  let count = 0;
  while (cursor <= end) {
    const date = new Date(cursor * 86_400_000);
    const iso = date.toISOString().slice(0, 10);
    if (!calendar.weekend_days.includes(date.getUTCDay()) && !holidays.has(iso)) count += 1;
    cursor += 1;
    if (count > 100_000) fail("calendar_error", "business-day age is unbounded");
  }
  return count;
}

function calendarDayAge(sourceEpoch, nowEpoch, calendar, sourceValue = null) {
  return calendarParts(nowEpoch, calendar.timezone).ordinal - sourceOrdinal(sourceEpoch, sourceValue, calendar);
}

function parseCronField(raw, min, max, context) {
  const values = new Set();
  for (const token of raw.split(",")) {
    const [base, stepRaw] = token.split("/");
    if (token.split("/").length > 2) fail("calendar_error", `${context} has an invalid step`);
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isSafeInteger(step) || step < 1) fail("calendar_error", `${context} has an invalid step`);
    let start;
    let end;
    if (base === "*") {
      start = min;
      end = max;
    } else if (/^\d+-\d+$/.test(base)) {
      [start, end] = base.split("-").map(Number);
    } else if (/^\d+$/.test(base)) {
      start = Number(base);
      end = start;
    } else {
      fail("calendar_error", `${context} has an invalid token`);
    }
    if (start < min || end > max || start > end) fail("calendar_error", `${context} is out of range`);
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values;
}

function parseCron(cron) {
  const fields = typeof cron === "string" ? cron.split(" ") : [];
  if (fields.length !== 5) fail("calendar_error", "cron must have five fields");
  return {
    minute: parseCronField(fields[0], 0, 59, "cron minute"),
    hour: parseCronField(fields[1], 0, 23, "cron hour"),
    day: parseCronField(fields[2], 1, 31, "cron day"),
    month: parseCronField(fields[3], 1, 12, "cron month"),
    weekday: parseCronField(fields[4], 0, 6, "cron weekday"),
    dayWildcard: fields[2] === "*",
    weekdayWildcard: fields[4] === "*",
  };
}

function cronMatches(epoch, parsed, calendar) {
  const parts = calendarParts(epoch, "UTC");
  const calendarDate = calendarParts(epoch, calendar.timezone).iso;
  if (calendar.holidays.includes(calendarDate)) return false;
  if (!parsed.minute.has(parts.minute) || !parsed.hour.has(parts.hour) || !parsed.month.has(parts.month)) return false;
  const dayMatch = parsed.day.has(parts.day);
  const weekdayMatch = parsed.weekday.has(parts.weekday);
  if (parsed.dayWildcard && parsed.weekdayWildcard) return true;
  if (parsed.dayWildcard) return weekdayMatch;
  if (parsed.weekdayWildcard) return dayMatch;
  return dayMatch || weekdayMatch;
}

function graceElapsed(occurrenceEpoch, nowEpoch, grace, calendar) {
  if (grace.unit === "hours") return nowEpoch - occurrenceEpoch >= grace.value * 3_600_000;
  const occurrence = calendarParts(occurrenceEpoch, calendar.timezone);
  const now = calendarParts(nowEpoch, calendar.timezone);
  const age = grace.unit === "calendar_days"
    ? now.ordinal - occurrence.ordinal
    : businessDayAge(occurrenceEpoch, nowEpoch, calendar);
  if (age !== grace.value) return age > grace.value;
  return now.hour * 60 + now.minute >= occurrence.hour * 60 + occurrence.minute;
}

function latestDueOccurrence(schedule, nowEpoch, calendar, calendars) {
  let cache = scheduleOccurrenceCache.get(calendars);
  if (!cache) {
    cache = new Map();
    scheduleOccurrenceCache.set(calendars, cache);
  }
  const key = `${schedule.id}:${nowEpoch}`;
  if (cache.has(key)) return cache.get(key);
  const parsed = parseCron(schedule.cron);
  let cursor = Math.floor(nowEpoch / 60_000) * 60_000;
  const floor = cursor - 400 * 86_400_000;
  while (cursor >= floor) {
    if (cronMatches(cursor, parsed, calendar) && graceElapsed(cursor, nowEpoch, schedule.grace, calendar)) {
      cache.set(key, cursor);
      return cursor;
    }
    cursor -= 60_000;
  }
  fail("calendar_error", `no due occurrence found for ${schedule.id}`);
}

export function evaluateAttemptCadence(observedAt, cronSchedules, calendarId, nowValue, calendars) {
  if (observedAt === null) return reasonResult("workflow_unobserved", { observed_at: null });
  const observed = strictUtc(observedAt, "attempt observed_at");
  const now = strictUtc(nowValue, "now");
  if (observed.epoch > now.epoch) return reasonResult("future_source", { observed_at: observedAt });
  const calendar = calendarById(calendars, calendarId);
  if (!Array.isArray(cronSchedules) || cronSchedules.length === 0) fail("calendar_error", "scheduled member has no cron");
  const results = cronSchedules.map((cron) => {
    const matches = calendars.schedules.filter((schedule) => schedule.cron === cron && schedule.calendar_id === calendarId);
    if (matches.length !== 1) fail("calendar_error", `cron ${cron} must have exactly one grace contract`);
    const due = latestDueOccurrence(matches[0], now.epoch, calendar, calendars);
    return observed.epoch >= due
      ? reasonResult("ok", { observed_at: observedAt })
      : reasonResult("stale", { observed_at: observedAt });
  });
  return worstResult(results);
}

// Point-in-time attempt coverage only: shard v1 has neither event_name nor
// retained history, so a manual attempt can satisfy a slot and a later attempt
// can hide an older gap. The public contract calls missing rows "suspected".
export function buildFetchCronAttemptCoverage({
  report,
  calendars,
  nowValue = null,
  config = DATA_SUPPLY_DETECTION_CONFIG,
}) {
  if (report !== null && report !== undefined) validateDetectionReport(report, config);
  validateConfigCalendarBindings(config, calendars);
  const evaluatedAt = report?.generated_at ?? nowValue;
  const now = strictUtc(evaluatedAt, report ? "report.generated_at" : "nowValue");
  const rows = [];
  let scheduledMembers = 0;

  config.lanes.forEach((lane, laneIndex) => {
    const reportLane = report?.lanes[laneIndex] ?? null;
    lane.producer_members.forEach((member, memberIndex) => {
      const scheduled = member.cadence_declaration?.kind === "github_workflow"
        && member.schedule.length > 0;
      if (!scheduled) return;
      scheduledMembers += 1;
      const reportMember = lane.monitoring_mode === "composite"
        ? reportLane?.members[memberIndex] ?? null
        : reportLane;
      const endpoint = reportMember?.endpoint ?? {
        status: "unobserved",
        reason: "workflow_unobserved",
        observed_at: null,
      };
      const observedEpoch = endpoint.observed_at === null
        ? null
        : strictUtc(endpoint.observed_at, `${lane.id}:${member.id}.observed_at`).epoch;
      const calendar = calendarById(calendars, member.cadence_calendar);

      for (const cron of member.schedule) {
        const matches = calendars.schedules.filter((schedule) => (
          schedule.cron === cron && schedule.calendar_id === member.cadence_calendar
        ));
        if (matches.length !== 1) {
          fail("calendar_error", `cron ${cron} must have exactly one grace contract`);
        }
        const schedule = matches[0];
        const expectedEpoch = latestDueOccurrence(schedule, now.epoch, calendar, calendars);
        rows.push({
          lane_id: lane.id,
          member_id: member.id,
          workflow: member.workflow,
          schedule_id: schedule.id,
          cron,
          calendar_id: member.cadence_calendar,
          expected_at: new Date(expectedEpoch).toISOString(),
          observed_at: endpoint.observed_at,
          state: observedEpoch !== null && observedEpoch <= now.epoch && observedEpoch >= expectedEpoch
            ? "observed"
            : null,
          producer_status: endpoint.status,
          producer_reason: endpoint.reason,
        });
      }
    });
  });

  const groupObserved = new Map();
  for (const row of rows) {
    const key = `${row.workflow}\u0000${row.cron}`;
    groupObserved.set(key, groupObserved.get(key) === true || row.state === "observed");
  }
  for (const row of rows) {
    if (row.state === "observed") continue;
    row.state = groupObserved.get(`${row.workflow}\u0000${row.cron}`)
      ? "attempt_gap"
      : "suspected_skip";
  }

  const counts = {
    scheduled_members: scheduledMembers,
    schedule_bindings: rows.length,
    observed: rows.filter((row) => row.state === "observed").length,
    suspected_skips: rows.filter((row) => row.state === "suspected_skip").length,
    attempt_gaps: rows.filter((row) => row.state === "attempt_gap").length,
  };
  if (counts.observed + counts.suspected_skips + counts.attempt_gaps !== counts.schedule_bindings) {
    fail("schema_error", "fetch cron attempt coverage counts are inconsistent");
  }

  return {
    schema_version: "fetch-cron-attempt-coverage/v1",
    mode: "shadow",
    evaluated_at: now.value,
    status: counts.suspected_skips > 0 || counts.attempt_gaps > 0 ? "warning" : "ready",
    deployment_blocking: false,
    counts,
    rows,
  };
}

export function evaluateFreshness(sourceAsOf, policy, nowValue, calendars) {
  if (sourceAsOf == null) return reasonResult("schema_drift", { source_as_of: null, age: null, unit: policy.unit });
  const source = strictUtc(sourceAsOf, "source_as_of", { allowDate: true });
  const now = strictUtc(nowValue, "now");
  const calendar = calendarById(calendars, policy.calendar);
  const localDateFuture = DATE_ONLY.test(source.value)
    && sourceOrdinal(source.epoch, source.value, calendar) > calendarParts(now.epoch, calendar.timezone).ordinal;
  if (source.epoch > now.epoch || localDateFuture) return reasonResult("future_source", { source_as_of: sourceAsOf, age: null, unit: policy.unit });
  if (policy.unit === "due_window") {
    if (policy.due_policy.kind === "source_date_plus_days") {
      const due = source.epoch + policy.due_policy.days * 86_400_000;
      return now.epoch <= due
        ? reasonResult("ok", { source_as_of: sourceAsOf, age: null, unit: "due_window" })
        : reasonResult("stale", { source_as_of: sourceAsOf, age: null, unit: "due_window" });
    }
    if (policy.due_policy.kind === "unowned") {
      let age;
      if (policy.due_policy.age_unit === "hours") age = (now.epoch - source.epoch) / 3_600_000;
      else if (policy.due_policy.age_unit === "calendar_days") age = calendarDayAge(source.epoch, now.epoch, calendar, source.value);
      else if (policy.due_policy.age_unit === "business_days") age = businessDayAge(source.epoch, now.epoch, calendar, source.value);
      else fail("calendar_error", "unowned age unit is invalid");
      return reasonResult("ok", { source_as_of: sourceAsOf, age, unit: "due_window" });
    }
    return reasonResult("ok", { source_as_of: sourceAsOf, age: null, unit: "due_window" });
  }
  let age;
  if (policy.unit === "hours") age = (now.epoch - source.epoch) / 3_600_000;
  else if (policy.unit === "calendar_days") age = calendarDayAge(source.epoch, now.epoch, calendar, source.value);
  else if (policy.unit === "business_days") age = businessDayAge(source.epoch, now.epoch, calendar, source.value);
  else fail("calendar_error", `unknown freshness unit ${policy.unit}`);
  return age <= policy.max_staleness
    ? reasonResult("ok", { source_as_of: sourceAsOf, age, unit: policy.unit })
    : reasonResult("stale", { source_as_of: sourceAsOf, age, unit: policy.unit });
}

function worstResult(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail("schema_error", "cannot fold an empty status list");
  return rows.reduce((worst, current) => {
    if (!STATUSES.has(current.status) || !FINAL_REASON_CODES.has(current.reason)) fail("schema_error", "unknown folded status/reason");
    if (!worst || STATUS_SEVERITY[current.status] > STATUS_SEVERITY[worst.status]) return current;
    return worst;
  }, null);
}

function worstMemberArtifact(members) {
  if (!Array.isArray(members) || members.length === 0) fail("schema_error", "cannot fold an empty member list");
  return members.map((member) => member.artifact).reduce((worst, current) => {
    if (!STATUSES.has(current.status) || !FINAL_REASON_CODES.has(current.reason)) fail("schema_error", "unknown member artifact status/reason");
    if (!worst || STATUS_SEVERITY[current.status] > STATUS_SEVERITY[worst.status]) return current;
    if (STATUS_SEVERITY[current.status] < STATUS_SEVERITY[worst.status]) return worst;
    const currentAge = Number.isFinite(current.age) ? current.age : null;
    const worstAge = Number.isFinite(worst.age) ? worst.age : null;
    if (currentAge !== null && (worstAge === null || currentAge > worstAge)) return current;
    return worst;
  }, null);
}

function foldSourceTimes(rows, policy) {
  const sourceRows = rows.filter((row) => row.source_required !== false);
  if (sourceRows.length === 0) return null;
  if (sourceRows.some((row) => row.source_as_of == null)) return null;
  const values = sourceRows.map((row) => strictUtc(row.source_as_of, "source_as_of", { allowDate: true }));
  if (policy.fold === "oldest") return values.reduce((a, b) => a.epoch <= b.epoch ? a : b).value;
  if (policy.fold === "latest") return values.reduce((a, b) => a.epoch >= b.epoch ? a : b).value;
  if (policy.fold === "member_worst" && values.length === 1) return values[0].value;
  fail("schema_error", "member_worst source fold requires evaluated member states");
}

export function validateCalendars(calendars) {
  exactKeys(calendars, ["schema_version", "calendars", "schedules", "cases"], "calendar fixture");
  if (calendars.schema_version !== "data-supply-detection-calendars/v1" || !Array.isArray(calendars.calendars) || !Array.isArray(calendars.schedules) || !Array.isArray(calendars.cases)) {
    fail("calendar_error", "calendar fixture schema is invalid");
  }
  const ids = new Set();
  for (const row of calendars.calendars) {
    exactKeys(row, ["id", "timezone", "weekend_days", "holidays"], `calendar ${row?.id ?? "?"}`);
    if (!IDENTIFIER.test(row.id) || ids.has(row.id) || !new Set(["UTC", "America/New_York"]).has(row.timezone)) fail("calendar_error", "calendar identity/timezone is invalid");
    ids.add(row.id);
    if (!Array.isArray(row.weekend_days) || row.weekend_days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) fail("calendar_error", "weekend_days is invalid");
    if (!Array.isArray(row.holidays)) fail("calendar_error", "holidays must be an array");
    row.holidays.forEach((holiday) => strictUtc(holiday, "holiday", { allowDate: true }));
  }
  const scheduleIds = new Set();
  const scheduleContracts = new Set();
  for (const row of calendars.schedules) {
    exactKeys(row, ["id", "cron", "calendar_id", "grace"], `schedule ${row?.id ?? "?"}`);
    if (!IDENTIFIER.test(row.id) || scheduleIds.has(row.id) || !ids.has(row.calendar_id) || typeof row.cron !== "string") fail("calendar_error", "schedule identity is invalid");
    scheduleIds.add(row.id);
    parseCron(row.cron);
    const scheduleKey = `${row.calendar_id}:${row.cron}`;
    if (scheduleContracts.has(scheduleKey)) fail("calendar_error", "duplicate cron/calendar grace contract");
    scheduleContracts.add(scheduleKey);
    exactKeys(row.grace, ["unit", "value"], `${row.id}.grace`);
    if (!new Set(["hours", "calendar_days", "business_days"]).has(row.grace.unit) || !Number.isFinite(row.grace.value) || row.grace.value <= 0) fail("calendar_error", "schedule grace is invalid");
    if (row.grace.unit !== "hours" && !Number.isSafeInteger(row.grace.value)) fail("calendar_error", "calendar/business grace must be an integer");
  }
  const caseIds = new Set();
  for (const row of calendars.cases) {
    if (!isPlainObject(row) || !IDENTIFIER.test(row.id) || caseIds.has(row.id) || !new Set(["freshness", "schedule"]).has(row.kind)) fail("calendar_error", "calendar case identity is invalid");
    caseIds.add(row.id);
    if (row.kind === "schedule") {
      exactKeys(row, ["id", "kind", "schedule_id", "now", "observed_at", "expected"], `calendar case ${row.id}`);
      if (!scheduleIds.has(row.schedule_id)) fail("calendar_error", `${row.id} schedule is missing`);
      strictUtc(row.now, `${row.id}.now`);
      if (row.observed_at !== null) strictUtc(row.observed_at, `${row.id}.observed_at`);
    } else {
      const dueWindow = row.unit === "due_window";
      exactKeys(row, dueWindow
        ? ["id", "kind", "calendar_id", "now", "source_as_of", "unit", "due_policy", "expected"]
        : ["id", "kind", "calendar_id", "now", "source_as_of", "unit", "max_staleness", "expected"], `calendar case ${row.id}`);
      if (!ids.has(row.calendar_id)) fail("calendar_error", `${row.id} calendar is missing`);
      strictUtc(row.now, `${row.id}.now`);
      strictUtc(row.source_as_of, `${row.id}.source_as_of`, { allowDate: true });
      if (!dueWindow && (!Number.isFinite(row.max_staleness) || row.max_staleness <= 0)) fail("calendar_error", `${row.id} max_staleness is invalid`);
      if (dueWindow && !isPlainObject(row.due_policy)) fail("calendar_error", `${row.id} due_policy is invalid`);
    }
    if (!new Set(["ready", "stale", "future_source", "workflow_unobserved"]).has(row.expected)) fail("calendar_error", `${row.id} expected result is invalid`);
  }
}

export function validateConfigCalendarBindings(config, calendars) {
  validateDetectionConfig(config);
  validateCalendars(calendars);
  const calendarIds = new Set(calendars.calendars.map((row) => row.id));
  for (const lane of config.lanes) {
    if (!calendarIds.has(lane.freshness.calendar)) fail("calendar_error", `${lane.id} source freshness calendar is missing`);
    for (const member of lane.producer_members) {
      if (member.cadence_declaration === null) continue;
      if (!calendarIds.has(member.cadence_calendar)) fail("calendar_error", `${lane.id}:${member.id} cadence calendar is missing`);
      for (const cron of member.schedule) {
        const matches = calendars.schedules.filter((schedule) => schedule.cron === cron && schedule.calendar_id === member.cadence_calendar);
        if (matches.length !== 1) fail("calendar_error", `${lane.id}:${member.id} cron ${cron} must have exactly one cadence grace contract`);
      }
    }
  }
  return true;
}

export function validateAttemptEvidence(document, config = DATA_SUPPLY_DETECTION_CONFIG) {
  exactKeys(document, ["schema_version", "attempts"], "attempt evidence");
  if (document.schema_version !== ATTEMPT_SCHEMA || !Array.isArray(document.attempts)) fail("schema_error", "attempt evidence schema is invalid");
  const laneMap = new Map(config.lanes.map((lane) => [lane.id, lane]));
  const seen = new Set();
  const attemptIds = new Set();
  for (const [index, row] of document.attempts.entries()) {
    const lane = laneMap.get(row.lane_id);
    if (!lane) fail("schema_error", `unknown attempt lane ${row.lane_id}`);
    const libraryTransport = lane.endpoint_contract.transport === "library";
    exactKeys(row, libraryTransport ? LIBRARY_ATTEMPT_KEYS : ATTEMPT_KEYS, `attempts[${index}]`);
    const composite = lane.monitoring_mode === "composite";
    const memberIds = new Set(lane.producer_members.map((member) => member.id));
    if (composite ? !memberIds.has(row.member_id) : row.member_id !== null) fail("schema_error", `invalid attempt member for ${lane.id}`);
    const key = `${row.lane_id}:${row.member_id ?? "_lane"}`;
    if (seen.has(key)) fail("schema_error", `duplicate attempt ${key}`);
    seen.add(key);
    if (!new Set(["unobserved", "returned", "threw"]).has(row.execution)) fail("schema_error", `${key} execution is invalid`);
    if (!new Set([null, "transport", "unexpected"]).has(row.exception_kind)) fail("schema_error", `${key} exception_kind is invalid`);
    if (!new Set(["ok", "rejected", "not_applicable"]).has(row.auth)) fail("schema_error", `${key} auth is invalid`);
    if (!new Set(["ok", "error", "not_attempted"]).has(row.decode)) fail("schema_error", `${key} decode is invalid`);
    if (!new Set(["non_empty", "empty", "not_available"]).has(row.payload)) fail("schema_error", `${key} payload is invalid`);
    if (typeof row.rate_limited !== "boolean" || !Array.isArray(row.assertions)) fail("schema_error", `${key} typed fields are invalid`);
    const assertionIds = new Set();
    row.assertions.forEach((assertion, assertionIndex) => {
      exactKeys(assertion, ["id", "passed"], `${key}.assertions[${assertionIndex}]`);
      if (!IDENTIFIER.test(assertion.id) || assertionIds.has(assertion.id) || typeof assertion.passed !== "boolean") fail("schema_error", `${key} assertion is invalid`);
      assertionIds.add(assertion.id);
    });
    const expectedAssertionIds = lane.endpoint_contract.assertions.map((assertion) => assertion.id).sort();
    const actualAssertionIds = [...assertionIds].sort();
    const hasExactAssertions = canonicalJson(expectedAssertionIds) === canonicalJson(actualAssertionIds);
    if (row.execution === "unobserved") {
      if (row.attempt_id !== null || row.observed_at !== null || row.exception_kind !== null || row.http_status !== null || row.auth !== "not_applicable" || row.rate_limited || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) {
        fail("schema_error", `${key} unobserved tuple is contradictory`);
      }
      if (libraryTransport && (row.candidates !== null || row.retry_count !== null || row.latency_ms !== null || row.outcome !== null)) {
        fail("schema_error", `${key} unobserved library evidence is contradictory`);
      }
    } else {
      if (typeof row.attempt_id !== "string" || !ATTEMPT_IDENTIFIER.test(row.attempt_id) || attemptIds.has(row.attempt_id)) fail("schema_error", `${key} attempt_id is invalid/duplicate`);
      attemptIds.add(row.attempt_id);
      strictUtc(row.observed_at, `${key}.observed_at`);
      if (libraryTransport) {
        if (row.http_status !== null) fail("schema_error", `${key} library tuple fabricates an HTTP status`);
        if (!Number.isSafeInteger(row.candidates) || row.candidates < 0
          || !Number.isSafeInteger(row.retry_count) || row.retry_count < 0
          || !Number.isFinite(row.latency_ms) || row.latency_ms < 0
          || !new Set(["success", "no_fallback_candidates", "not_attempted", "error"]).has(row.outcome)) {
          fail("schema_error", `${key} library evidence is invalid`);
        }
        if (row.execution === "threw") {
          if (row.outcome !== "error"
            || !new Set(["transport", "unexpected"]).has(row.exception_kind)
            || row.auth !== "not_applicable" || row.rate_limited
            || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) {
            fail("schema_error", `${key} threw library tuple is contradictory`);
          }
        } else if (row.outcome === "no_fallback_candidates") {
          if (row.candidates !== 0 || row.retry_count !== 0 || row.latency_ms !== 0
            || row.exception_kind !== null || row.auth !== "not_applicable" || row.rate_limited
            || row.decode !== "not_attempted" || row.payload !== "empty" || row.assertions.length) {
            fail("schema_error", `${key} empty-candidate library tuple is contradictory`);
          }
        } else if (row.outcome === "success") {
          if (row.candidates < 1 || row.exception_kind !== null
            || row.auth !== "not_applicable" || row.rate_limited
            || row.decode !== "ok" || row.payload !== "non_empty" || !hasExactAssertions) {
            fail("schema_error", `${key} successful library tuple is contradictory`);
          }
        } else if (row.outcome === "not_attempted") {
          if (row.candidates < 1 || row.retry_count !== 0 || row.latency_ms !== 0
            || row.exception_kind !== null || row.auth !== "not_applicable" || row.rate_limited
            || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) {
            fail("schema_error", `${key} unattempted library tuple is contradictory`);
          }
        } else if (row.outcome === "error") {
          if (row.candidates < 1 || row.exception_kind !== null
            || row.auth !== "not_applicable" || row.rate_limited
            || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) {
            fail("schema_error", `${key} returned library error tuple is contradictory`);
          }
        } else {
          fail("schema_error", `${key} returned library tuple has an unsupported outcome`);
        }
      } else if (row.execution === "threw") {
        if (!new Set(["transport", "unexpected"]).has(row.exception_kind) || row.http_status !== null || row.auth !== "not_applicable" || row.rate_limited || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) fail("schema_error", `${key} threw tuple is contradictory`);
      } else {
        if (row.exception_kind !== null || !Number.isInteger(row.http_status) || row.http_status < 100 || row.http_status > 599) fail("schema_error", `${key} returned tuple is invalid`);
        const finraMissingResponse = row.lane_id === "finra_short_volume"
          && row.http_status === 403
          && row.auth === "not_applicable";
        const authFailure = row.http_status === 401 || (row.http_status === 403 && !finraMissingResponse);
        const rateFailure = row.http_status === 429;
        const otherHttpFailure = (row.http_status < 200 || row.http_status >= 300) && !authFailure && !rateFailure;
        if (authFailure) {
          if (row.auth !== "rejected" || row.rate_limited || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) fail("schema_error", `${key} auth tuple is contradictory`);
        } else if (rateFailure) {
          if (!row.rate_limited || !new Set(["ok", "not_applicable"]).has(row.auth) || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) fail("schema_error", `${key} rate tuple is contradictory`);
        } else if (otherHttpFailure) {
          if (row.auth !== "not_applicable" || row.rate_limited || row.decode !== "not_attempted" || row.payload !== "not_available" || row.assertions.length) fail("schema_error", `${key} HTTP tuple is contradictory`);
        } else if (row.decode === "error") {
          if (!new Set(["ok", "not_applicable"]).has(row.auth) || row.rate_limited || row.payload !== "not_available" || row.assertions.length) fail("schema_error", `${key} decode tuple is contradictory`);
        } else if (row.decode === "ok") {
          if (!new Set(["ok", "not_applicable"]).has(row.auth) || row.rate_limited || row.payload === "not_available") fail("schema_error", `${key} decoded tuple is contradictory`);
          if (row.payload === "empty" ? row.assertions.length !== 0 : !hasExactAssertions) fail("schema_error", `${key} assertion set is invalid`);
        } else fail("schema_error", `${key} successful HTTP tuple did not decode`);
      }
    }
  }
  return true;
}

export function validateAttemptShard(document, expectedLaneId, config = DATA_SUPPLY_DETECTION_CONFIG) {
  exactKeys(document, ["schema_version", "lane_id", "attempts"], "attempt shard");
  if (document.schema_version !== ATTEMPT_SHARD_SCHEMA || document.lane_id !== expectedLaneId || !IDENTIFIER.test(expectedLaneId)) {
    fail("schema_error", "attempt shard schema/filename identity is invalid");
  }
  const lane = config.lanes.find((candidate) => candidate.id === expectedLaneId);
  if (!lane) fail("schema_error", `unknown attempt shard lane ${expectedLaneId}`);
  if (!Array.isArray(document.attempts) || document.attempts.some((row) => row?.lane_id !== expectedLaneId)) {
    fail("schema_error", `${expectedLaneId} shard contains cross-lane evidence`);
  }
  validateAttemptEvidence({ schema_version: ATTEMPT_SCHEMA, attempts: document.attempts }, config);
  const expectedMembers = lane.monitoring_mode === "composite"
    ? lane.producer_members.map((member) => member.id)
    : [null];
  const actualMembers = document.attempts.map((row) => row.member_id);
  if (canonicalJson(actualMembers) !== canonicalJson(expectedMembers)) {
    fail("schema_error", `${expectedLaneId} shard must contain every member exactly once in config order`);
  }
  return true;
}

export function loadAttemptShards({ shardRoot, config = DATA_SUPPLY_DETECTION_CONFIG }) {
  validateDetectionConfig(config);
  const root = canonicalExistingDirectory(shardRoot);
  if (!pathInfoMatches(root)) fail("unsafe_path", "attempt shard root identity changed");
  const laneIds = new Set(config.lanes.map((lane) => lane.id));
  const byLane = new Map();
  for (const entry of fs.readdirSync(root.real, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const match = /^([a-z][a-z0-9_]{0,63})\.json$/.exec(entry.name);
    if (!match || !entry.isFile() || entry.isSymbolicLink()) fail("unsafe_path", `unexpected attempt shard entry ${entry.name}`);
    const laneId = match[1];
    if (!laneIds.has(laneId) || byLane.has(laneId)) fail("schema_error", `unknown or duplicate attempt shard ${laneId}`);
    const filePath = path.join(root.real, entry.name);
    const document = readJsonStrict(filePath, [root]);
    validateAttemptShard(document, laneId, config);
    byLane.set(laneId, document.attempts);
  }
  if (!pathInfoMatches(root)) fail("unsafe_path", "attempt shard root identity changed during merge");
  const merged = {
    schema_version: ATTEMPT_SCHEMA,
    attempts: config.lanes.flatMap((lane) => byLane.get(lane.id) ?? []),
  };
  validateAttemptEvidence(merged, config);
  return merged;
}

export function classifyAttempt(row) {
  if (!row || row.execution === "unobserved") return reasonResult("workflow_unobserved", { observed_at: null });
  if (row.execution === "threw") return reasonResult(row.exception_kind === "transport" ? "transport_error" : "unexpected_error", { observed_at: row.observed_at });
  if (row.outcome === "no_fallback_candidates") return reasonResult("ok", { observed_at: row.observed_at });
  if (row.outcome === "not_attempted") return reasonResult("unexpected_error", { observed_at: row.observed_at });
  if (row.outcome === "error") return reasonResult("unexpected_error", { observed_at: row.observed_at });
  if (row.outcome === "success") {
    if (row.assertions.some((assertion) => assertion.passed === false)) return reasonResult("schema_drift", { observed_at: row.observed_at });
    return reasonResult("ok", { observed_at: row.observed_at });
  }
  if (row.http_status === 401 || (row.http_status === 403 && row.auth === "rejected")) {
    return reasonResult("auth_error", { observed_at: row.observed_at });
  }
  if (row.http_status === 429) return reasonResult("rate_limited", { observed_at: row.observed_at });
  if (row.http_status < 200 || row.http_status >= 300) return reasonResult("http_error", { observed_at: row.observed_at });
  if (row.decode === "error") return reasonResult("decode_error", { observed_at: row.observed_at });
  if (row.payload === "empty") return reasonResult("empty_payload", { observed_at: row.observed_at });
  if (row.assertions.some((assertion) => assertion.passed === false)) return reasonResult("schema_drift", { observed_at: row.observed_at });
  return reasonResult("ok", { observed_at: row.observed_at });
}

function attemptMap(document) {
  return new Map(document.attempts.map((row) => [`${row.lane_id}:${row.member_id ?? "_lane"}`, row]));
}

function evaluateMember(lane, member, attemptsByKey, artifactRootInfo, claimedPaths, now, calendars, fsModule = fs) {
  const attemptKey = `${lane.id}:${lane.monitoring_mode === "composite" ? member.id : "_lane"}`;
  const row = attemptsByKey.get(attemptKey) ?? null;
  const hasDeclaredCadence = member.cadence_declaration !== null;
  const endpoint = hasDeclaredCadence
    ? worstResult([
      classifyAttempt(row),
      evaluateAttemptCadence(row?.observed_at ?? null, member.schedule, member.cadence_calendar, now, calendars),
    ])
    : reasonResult("workflow_unobserved", { observed_at: null });
  const artifacts = member.artifact_contracts.flatMap((contract) => evaluateArtifactContract(contract, artifactRootInfo, claimedPaths, fsModule));
  const artifactWorst = worstResult(artifacts);
  const sourceAsOf = foldSourceTimes(artifacts, lane.freshness);
  const hasSourceContract = artifacts.some((artifact) => artifact.source_required !== false);
  const freshness = artifactWorst.status === "ready" && hasSourceContract
    ? evaluateFreshness(sourceAsOf, lane.freshness, now, calendars)
    : artifactWorst.status === "ready"
      ? reasonResult("ok", { source_as_of: null, age: null, unit: lane.freshness.unit })
      : { ...artifactWorst, source_as_of: sourceAsOf, age: null, unit: lane.freshness.unit };
  const artifact = worstResult([artifactWorst, freshness]);
  const combined = worstResult([endpoint, artifact]);
  return {
    id: member.id,
    status: combined.status,
    reason: combined.reason,
    endpoint: { status: endpoint.status, reason: endpoint.reason, observed_at: endpoint.observed_at ?? null },
    artifact: {
      status: artifact.status,
      reason: artifact.reason,
      source_as_of: sourceAsOf,
      age: freshness.age ?? null,
      unit: lane.freshness.unit,
    },
  };
}

function zeroCounts() {
  return { ready: 0, stale: 0, drift: 0, unavailable: 0, unobserved: 0 };
}

function increment(counts, status) {
  if (!(status in counts)) fail("schema_error", `unknown count status ${status}`);
  counts[status] += 1;
}

export function buildDetectionReport({
  config = DATA_SUPPLY_DETECTION_CONFIG,
  artifactRoot,
  attempts,
  now,
  calendars,
  fsModule = fs,
}) {
  validateDetectionConfig(config);
  validateAttemptEvidence(attempts, config);
  validateConfigCalendarBindings(config, calendars);
  strictUtc(now, "now");
  const artifactRootInfo = canonicalExistingDirectory(artifactRoot, { fsModule });
  const byAttempt = attemptMap(attempts);
  const claimedArtifactPaths = new Set();
  const logicalCounts = zeroCounts();
  const memberCounts = zeroCounts();
  const monitoringModeCounts = { post_fetch_artifact: 0, artifact_only: 0, composite: 0 };
  const lanes = config.lanes.map((lane) => {
    monitoringModeCounts[lane.monitoring_mode] += 1;
    const members = lane.producer_members.map((member) => evaluateMember(lane, member, byAttempt, artifactRootInfo, claimedArtifactPaths, now, calendars, fsModule));
    members.forEach((member) => increment(memberCounts, member.status));
    const laneWorst = worstResult(members);
    increment(logicalCounts, laneWorst.status);
    const firstMember = members[0];
    const endpointWorst = worstResult(members.map((member) => member.endpoint));
    const artifactWorst = lane.freshness.fold === "member_worst"
      ? worstMemberArtifact(members)
      : worstResult(members.map((member) => member.artifact));
    const sourceValues = members.map((member) => member.artifact.source_as_of).filter((value) => value != null);
    const laneSource = lane.freshness.fold === "member_worst"
      ? artifactWorst.source_as_of
      : sourceValues.length === members.length
        ? foldSourceTimes(sourceValues.map((source_as_of) => ({ source_as_of })), lane.freshness)
        : null;
    const laneRow = {
      id: lane.id,
      label: lane.label,
      enforcement: lane.enforcement,
      kpi_required: lane.kpi_required,
      monitoring_mode: lane.monitoring_mode,
      status: laneWorst.status,
      reason: laneWorst.reason,
      endpoint: lane.monitoring_mode === "composite" ? endpointWorst : firstMember.endpoint,
      artifact: {
        status: artifactWorst.status,
        reason: artifactWorst.reason,
        source_as_of: laneSource,
        age: artifactWorst.age,
        unit: lane.freshness.unit,
      },
      affected_surface_ids: [...lane.affected_surface_ids],
    };
    if (lane.monitoring_mode === "composite") laneRow.members = members;
    return laneRow;
  });
  const counts = {
    ...logicalCounts,
    producer_members_ready: memberCounts.ready,
    producer_members_stale: memberCounts.stale,
    producer_members_drift: memberCounts.drift,
    producer_members_unavailable: memberCounts.unavailable,
    producer_members_unobserved: memberCounts.unobserved,
  };
  if (lanes.length !== config.logical_lane_count
    || Object.values(memberCounts).reduce((sum, value) => sum + value, 0) !== config.producer_member_count) {
    fail("schema_error", "report denominator changed");
  }
  const report = {
    schema_version: REPORT_SCHEMA,
    generated_at: now,
    config_digest: digestConfig(config),
    logical_lane_count: config.logical_lane_count,
    producer_member_count: config.producer_member_count,
    counts,
    monitoring_mode_counts: monitoringModeCounts,
    lanes,
  };
  validateDetectionReport(report, config);
  return report;
}

function validateStatusReason(row, context, { allowUnavailableSchemaDrift = false } = {}) {
  if (!STATUSES.has(row.status) || !FINAL_REASON_CODES.has(row.reason)) fail("schema_error", `${context} has an unknown status/reason`);
  const compatible = REASON_STATUS[row.reason] === row.status
    || (allowUnavailableSchemaDrift && row.status === "unavailable" && row.reason === "schema_drift");
  if (!compatible) fail("schema_error", `${context} status/reason is contradictory`);
}

function validateEndpointReport(row, context) {
  exactKeys(row, ["status", "reason", "observed_at"], context);
  validateStatusReason(row, context);
  if (row.observed_at === null) {
    if (row.reason !== "workflow_unobserved") fail("schema_error", `${context}.observed_at is missing`);
  } else {
    strictUtc(row.observed_at, `${context}.observed_at`);
    if (row.reason === "workflow_unobserved") fail("schema_error", `${context}.observed_at contradicts unobserved state`);
  }
}

function validateArtifactReport(row, context, freshnessPolicy) {
  exactKeys(row, ["status", "reason", "source_as_of", "age", "unit"], context);
  validateStatusReason(row, context, { allowUnavailableSchemaDrift: row.source_as_of === null });
  if (row.unit !== freshnessPolicy.unit) fail("schema_error", `${context}.unit does not match config`);
  if (row.source_as_of !== null) strictUtc(row.source_as_of, `${context}.source_as_of`, { allowDate: true });
  if (row.age !== null && (!Number.isFinite(row.age) || row.age < 0)) fail("schema_error", `${context}.age is invalid`);
  if (row.unit === "due_window" && row.age !== null && freshnessPolicy.due_policy.kind !== "unowned") fail("schema_error", `${context}.age must be null for this due_window`);
}

function worstStatus(rows) {
  return rows.reduce((worst, row) => STATUS_SEVERITY[row.status] > STATUS_SEVERITY[worst] ? row.status : worst, "ready");
}

export function validateDetectionReport(report, config = DATA_SUPPLY_DETECTION_CONFIG) {
  validateDetectionConfig(config);
  exactKeys(report, [
    "schema_version",
    "generated_at",
    "config_digest",
    "logical_lane_count",
    "producer_member_count",
    "counts",
    "monitoring_mode_counts",
    "lanes",
  ], "report");
  if (report.schema_version !== REPORT_SCHEMA || report.config_digest !== digestConfig(config)) fail("schema_error", "report schema/config digest is invalid");
  strictUtc(report.generated_at, "report.generated_at");
  if (report.logical_lane_count !== config.logical_lane_count
    || report.producer_member_count !== config.producer_member_count
    || !Array.isArray(report.lanes)
    || report.lanes.length !== config.logical_lane_count) {
    fail("schema_error", "report denominator is invalid");
  }
  const countKeys = [
    "ready", "stale", "drift", "unavailable", "unobserved",
    "producer_members_ready", "producer_members_stale", "producer_members_drift", "producer_members_unavailable", "producer_members_unobserved",
  ];
  exactKeys(report.counts, countKeys, "report.counts");
  for (const key of countKeys) {
    if (!Number.isInteger(report.counts[key]) || report.counts[key] < 0) fail("schema_error", `report.counts.${key} is invalid`);
  }
  exactKeys(report.monitoring_mode_counts, ["post_fetch_artifact", "artifact_only", "composite"], "report.monitoring_mode_counts");
  for (const value of Object.values(report.monitoring_mode_counts)) {
    if (!Number.isInteger(value) || value < 0) fail("schema_error", "report monitoring-mode count is invalid");
  }

  const logicalCounts = zeroCounts();
  const memberCounts = zeroCounts();
  const modeCounts = { post_fetch_artifact: 0, artifact_only: 0, composite: 0 };
  report.lanes.forEach((row, index) => {
    const laneConfig = config.lanes[index];
    const composite = laneConfig.monitoring_mode === "composite";
    exactKeys(row, composite
      ? ["id", "label", "enforcement", "kpi_required", "monitoring_mode", "status", "reason", "endpoint", "artifact", "affected_surface_ids", "members"]
      : ["id", "label", "enforcement", "kpi_required", "monitoring_mode", "status", "reason", "endpoint", "artifact", "affected_surface_ids"], `report.lanes[${index}]`);
    if (row.id !== laneConfig.id || row.label !== laneConfig.label || row.monitoring_mode !== laneConfig.monitoring_mode
      || row.enforcement !== laneConfig.enforcement || row.kpi_required !== laneConfig.kpi_required
      || canonicalJson(row.affected_surface_ids) !== canonicalJson(laneConfig.affected_surface_ids)) {
      fail("schema_error", `report.lanes[${index}] does not match config identity`);
    }
    validateStatusReason(row, `report.lanes[${index}]`, { allowUnavailableSchemaDrift: true });
    validateEndpointReport(row.endpoint, `report.lanes[${index}].endpoint`);
    validateArtifactReport(row.artifact, `report.lanes[${index}].artifact`, laneConfig.freshness);
    modeCounts[row.monitoring_mode] += 1;
    increment(logicalCounts, row.status);

    const componentRows = [row.endpoint, row.artifact];
    if (composite) {
      if (!Array.isArray(row.members) || row.members.length !== laneConfig.producer_members.length) fail("schema_error", `${row.id}.members denominator is invalid`);
      row.members.forEach((memberRow, memberIndex) => {
        exactKeys(memberRow, ["id", "status", "reason", "endpoint", "artifact"], `${row.id}.members[${memberIndex}]`);
        if (memberRow.id !== laneConfig.producer_members[memberIndex].id) fail("schema_error", `${row.id}.members[${memberIndex}] identity is invalid`);
        validateStatusReason(memberRow, `${row.id}.members[${memberIndex}]`, { allowUnavailableSchemaDrift: true });
        validateEndpointReport(memberRow.endpoint, `${row.id}.members[${memberIndex}].endpoint`);
        validateArtifactReport(memberRow.artifact, `${row.id}.members[${memberIndex}].artifact`, laneConfig.freshness);
        if (memberRow.status !== worstStatus([memberRow.endpoint, memberRow.artifact])) fail("schema_error", `${row.id}.${memberRow.id} status does not match components`);
        if (![memberRow.endpoint, memberRow.artifact].some((part) => part.status === memberRow.status && part.reason === memberRow.reason)) {
          fail("schema_error", `${row.id}.${memberRow.id} reason does not match its worst component`);
        }
        increment(memberCounts, memberRow.status);
      });
      componentRows.push(...row.members);
    } else {
      const hiddenMemberStatus = worstStatus(componentRows);
      increment(memberCounts, hiddenMemberStatus);
    }
    if (row.status !== worstStatus(componentRows)) fail("schema_error", `${row.id} status does not match components`);
    if (!componentRows.some((part) => part.status === row.status && part.reason === row.reason)) fail("schema_error", `${row.id} reason does not match its worst component`);
  });

  const expectedCounts = {
    ...logicalCounts,
    producer_members_ready: memberCounts.ready,
    producer_members_stale: memberCounts.stale,
    producer_members_drift: memberCounts.drift,
    producer_members_unavailable: memberCounts.unavailable,
    producer_members_unobserved: memberCounts.unobserved,
  };
  if (canonicalJson(report.counts) !== canonicalJson(expectedCounts) || canonicalJson(report.monitoring_mode_counts) !== canonicalJson(modeCounts)) {
    fail("schema_error", "report aggregate counts are inconsistent");
  }
  canonicalJson(report);
  return true;
}

function invokeFailpoint(failpoint, name, context = {}) {
  if (typeof failpoint === "function") {
    failpoint(name, context);
    return;
  }
  if (failpoint === name) fail("injected_failure", name);
  if (failpoint != null && typeof failpoint !== "string") fail("schema_error", "failpoint must be string, function, or null");
}

function ownedTempStatMatches(tempPath, expected, fsModule = fs) {
  try {
    const stat = fsModule.lstatSync(tempPath);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.dev === expected.dev && stat.ino === expected.ino;
  } catch {
    return false;
  }
}

export function projectReportAtomic({
  report,
  outputRoot,
  artifactRoot,
  config = DATA_SUPPLY_DETECTION_CONFIG,
  fsModule = fs,
  failpoint = null,
  tempToken = randomBytes(8).toString("hex"),
}) {
  if (!HEX_16.test(tempToken)) fail("schema_error", "tempToken must be 16 lowercase hex characters");
  if (typeof failpoint === "string" && !FAILPOINTS.has(failpoint)) fail("schema_error", `unknown failpoint ${failpoint}`);
  validateDetectionReport(report, config);
  const bytes = Buffer.from(`${canonicalJson(report)}\n`, "utf8");
  const reportFileSha256 = sha256(bytes);
  const context = prepareOutputContext({ outputRoot, artifactRoot, config, fsModule });
  const tempName = `.${REPORT_BASENAME}.${process.pid}.${tempToken}.tmp`;
  const tempPath = path.join(context.output.real, tempName);
  let rootFd = null;
  let tempFd = null;
  let tempStat = null;
  let renamed = false;
  try {
    rootFd = fsModule.openSync(context.output.real, fsModule.constants.O_RDONLY | fsModule.constants.O_DIRECTORY | fsModule.constants.O_NOFOLLOW);
    const rootStat = fsModule.fstatSync(rootFd);
    if (rootStat.dev !== context.output.dev || rootStat.ino !== context.output.ino) fail("unsafe_path", "opened root identity mismatch");
    validateRootBoundary(context, rootFd, "pre_temp", null, fsModule);
    invokeFailpoint(failpoint, "before_temp_open", { context });
    validateRootBoundary(context, rootFd, "pre_temp", null, fsModule);
    tempFd = fsModule.openSync(tempPath, fsModule.constants.O_WRONLY | fsModule.constants.O_CREAT | fsModule.constants.O_EXCL | fsModule.constants.O_NOFOLLOW, 0o600);
    tempStat = fsModule.fstatSync(tempFd);
    if (!tempStat.isFile() || tempStat.nlink !== 1 || tempStat.dev !== rootStat.dev || (tempStat.mode & 0o777) !== 0o600) {
      fail("atomic_write_error", "temp is not an owned same-filesystem regular file");
    }
    invokeFailpoint(failpoint, "after_temp_open", { context, tempPath });
    validateRootBoundary(context, rootFd, "temp_live", tempName, fsModule);
    if (!ownedTempStatMatches(tempPath, tempStat, fsModule)) fail("unsafe_path", "temp identity changed after open");
    const split = Math.max(1, Math.floor(bytes.length / 2));
    let offset = 0;
    for (const chunkEnd of [split, bytes.length]) {
      while (offset < chunkEnd) {
        const requested = chunkEnd - offset;
        const written = fsModule.writeSync(tempFd, bytes, offset, requested, null);
        if (!Number.isInteger(written) || written !== requested) fail("atomic_write_error", "write was short or made no progress");
        offset += written;
      }
      if (chunkEnd === split) {
        invokeFailpoint(failpoint, "mid_write", { context, tempPath });
        validateRootBoundary(context, rootFd, "temp_live", tempName, fsModule);
        if (!ownedTempStatMatches(tempPath, tempStat, fsModule)) fail("unsafe_path", "temp identity changed during write");
      }
    }
    fsModule.fsyncSync(tempFd);
    fsModule.closeSync(tempFd);
    tempFd = null;
    invokeFailpoint(failpoint, "after_temp_fsync", { context, tempPath });
    validateRootBoundary(context, rootFd, "temp_live", tempName, fsModule);
    if (!ownedTempStatMatches(tempPath, tempStat, fsModule)) fail("unsafe_path", "temp identity changed before readback");
    const readbackFd = fsModule.openSync(tempPath, fsModule.constants.O_RDONLY | fsModule.constants.O_NOFOLLOW);
    let tempBytes;
    try {
      const readbackStat = fsModule.fstatSync(readbackFd);
      if (!readbackStat.isFile() || readbackStat.nlink !== 1 || readbackStat.dev !== tempStat.dev || readbackStat.ino !== tempStat.ino) {
        fail("unsafe_path", "temp identity changed during readback");
      }
      tempBytes = fsModule.readFileSync(readbackFd);
    } finally {
      fsModule.closeSync(readbackFd);
    }
    if (!tempBytes.equals(bytes) || sha256(tempBytes) !== reportFileSha256) fail("atomic_write_error", "temp readback mismatch");
    const parsed = JSON.parse(tempBytes.toString("utf8"));
    if (parsed.schema_version !== REPORT_SCHEMA || parsed.config_digest !== report.config_digest) fail("atomic_write_error", "temp schema/digest mismatch");
    invokeFailpoint(failpoint, "after_temp_validation", { context, tempPath });
    validateRootBoundary(context, rootFd, "temp_live", tempName, fsModule);
    invokeFailpoint(failpoint, "before_rename", { context, tempPath });
    validateRootBoundary(context, rootFd, "temp_live", tempName, fsModule);
    if (!ownedTempStatMatches(tempPath, tempStat, fsModule)) fail("unsafe_path", "temp identity changed before rename");
    fsModule.renameSync(tempPath, context.finalPath);
    renamed = true;
    invokeFailpoint(failpoint, "after_rename_before_parent_fsync", { context });
    validateRootBoundary(context, rootFd, "post_rename", null, fsModule);
    const finalFd = fsModule.openSync(context.finalPath, fsModule.constants.O_RDONLY | fsModule.constants.O_NOFOLLOW);
    try {
      const finalStat = fsModule.fstatSync(finalFd);
      if (!finalStat.isFile() || finalStat.nlink !== 1 || finalStat.dev !== tempStat.dev || finalStat.ino !== tempStat.ino) {
        fail("unsafe_path", "final identity does not match renamed temp");
      }
      const finalBytes = fsModule.readFileSync(finalFd);
      if (!finalBytes.equals(bytes) || sha256(finalBytes) !== reportFileSha256) fail("atomic_write_error", "final readback mismatch");
    } finally {
      fsModule.closeSync(finalFd);
    }
    validateRootBoundary(context, rootFd, "post_rename", null, fsModule);
    fsModule.fsyncSync(rootFd);
    invokeFailpoint(failpoint, "after_parent_fsync", { context });
    validateRootBoundary(context, rootFd, "post_rename", null, fsModule);
    fsModule.closeSync(rootFd);
    rootFd = null;
    validateOutputContext(context, "post_rename", null, fsModule);
    return { report_path: context.finalPath, report_file_sha256: reportFileSha256, bytes: bytes.length };
  } catch (error) {
    if (tempFd !== null) {
      try { fsModule.closeSync(tempFd); } catch {}
    }
    if (!renamed && tempStat && ownedTempStatMatches(tempPath, tempStat, fsModule) && pathInfoMatches(context.output, fsModule)) {
      try { fsModule.unlinkSync(tempPath); } catch {}
    }
    throw error;
  } finally {
    if (rootFd !== null) {
      try { fsModule.closeSync(rootFd); } catch {}
    }
  }
}

export function detectAndProject({
  config = DATA_SUPPLY_DETECTION_CONFIG,
  artifactRoot,
  attempts,
  now,
  calendars,
  outputRoot,
  fsAdapter = fs,
  failpoint = null,
  tempToken,
}) {
  const report = buildDetectionReport({ config, artifactRoot, attempts, now, calendars, fsModule: fsAdapter });
  const projection = projectReportAtomic({ report, outputRoot, artifactRoot, config, fsModule: fsAdapter, failpoint, tempToken });
  return { report, ...projection };
}

function parseArgs(argv) {
  if (argv.length === 2 && argv[0] === "--verify-report") return { mode: "verify", reportPath: argv[1] };
  const allowed = new Set(["--artifact-root", "--attempt-evidence", "--attempt-shard-root", "--calendar-fixture", "--calendars", "--now", "--output-root"]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(flag) || value == null || values[flag] != null) fail("cli_error", `invalid CLI flag ${flag ?? "<missing>"}`);
    values[flag] = value;
  }
  const required = ["--artifact-root", "--now", "--output-root"];
  const attemptInputs = ["--attempt-evidence", "--attempt-shard-root"].filter((flag) => values[flag] != null);
  const calendarInputs = ["--calendar-fixture", "--calendars"].filter((flag) => values[flag] != null);
  if (argv.length % 2 !== 0 || required.some((flag) => values[flag] == null) || attemptInputs.length !== 1 || calendarInputs.length !== 1) {
    fail("cli_error", "build requires artifact/now/output and exactly one attempt source plus one calendar source");
  }
  return { mode: "build", values };
}

function readJsonStrict(filePath, allowedRoots) {
  const info = canonicalExistingFile(filePath, allowedRoots);
  let fd = null;
  try {
    fd = fs.openSync(info.real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > 4 * 1024 * 1024) {
      fail("unsafe_path", "fixture input changed or exceeds the read bound");
    }
    const text = fs.readFileSync(fd, "utf8");
    const after = fs.lstatSync(info.real);
    if (!after.isFile() || after.isSymbolicLink() || after.dev !== info.dev || after.ino !== info.ino) fail("unsafe_path", "fixture input changed during read");
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof DetectionFloorError) throw error;
    fail("decode_error", `${path.basename(info.real)} JSON read failed: ${error.message}`);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

export function verifyDetectionReportFile({ reportPath, config = DATA_SUPPLY_DETECTION_CONFIG }) {
  if (typeof reportPath !== "string" || path.basename(reportPath) !== REPORT_BASENAME) {
    fail("unsafe_path", `verified report must be named ${REPORT_BASENAME}`);
  }
  const parent = canonicalExistingDirectory(path.dirname(reportPath));
  const info = canonicalExistingFile(reportPath, [parent]);
  let fd = null;
  try {
    fd = fs.openSync(info.real, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > 4 * 1024 * 1024) {
      fail("unsafe_path", "report changed or exceeds the read bound");
    }
    const bytes = fs.readFileSync(fd);
    const report = JSON.parse(bytes.toString("utf8"));
    validateDetectionReport(report, config);
    const canonicalBytes = Buffer.from(`${canonicalJson(report)}\n`, "utf8");
    if (!bytes.equals(canonicalBytes)) fail("schema_error", "report bytes are not canonical JSON plus newline");
    return {
      schema_version: report.schema_version,
      report_file_sha256: sha256(bytes),
      logical_lane_count: report.logical_lane_count,
      producer_member_count: report.producer_member_count,
    };
  } catch (error) {
    if (error instanceof DetectionFloorError) throw error;
    fail("decode_error", `${REPORT_BASENAME} verification failed: ${error.message}`);
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.mode === "verify") {
    process.stdout.write(`${canonicalJson(verifyDetectionReportFile({ reportPath: parsed.reportPath }))}\n`);
    return;
  }
  const args = parsed.values;
  const artifactRoot = canonicalExistingDirectory(args["--artifact-root"]);
  const fixtureRoot = canonicalExistingDirectory(FIXTURE_ROOT);
  const attempts = args["--attempt-shard-root"]
    ? loadAttemptShards({ shardRoot: args["--attempt-shard-root"] })
    : readJsonStrict(args["--attempt-evidence"], [fixtureRoot, artifactRoot]);
  const calendars = args["--calendars"]
    ? readJsonStrict(args["--calendars"], [canonicalExistingDirectory(path.dirname(CALENDAR_PATH))])
    : readJsonStrict(args["--calendar-fixture"], [fixtureRoot, artifactRoot]);
  if (args["--calendars"] && fs.realpathSync.native(args["--calendars"]) !== fs.realpathSync.native(CALENDAR_PATH)) {
    fail("unsafe_path", "--calendars must use the canonical detection calendar SSOT");
  }
  const result = detectAndProject({
    artifactRoot: artifactRoot.real,
    attempts,
    now: args["--now"],
    calendars,
    outputRoot: args["--output-root"],
  });
  process.stdout.write(`${canonicalJson({
    schema_version: result.report.schema_version,
    report_file_sha256: result.report_file_sha256,
    logical_lane_count: result.report.logical_lane_count,
    producer_member_count: result.report.producer_member_count,
  })}\n`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirect) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
