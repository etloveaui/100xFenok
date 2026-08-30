import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PATCH_MARK = Symbol.for("fenok.kpiFixtureHermeticFsGuard");
const ALLOWED_ROOTS = globalThis[PATCH_MARK]?.allowedRoots ?? new Set();
const ORIGINAL_REALPATH_SYNC = globalThis[PATCH_MARK]?.realpathSync ?? fs.realpathSync.bind(fs);

function normalizePath(value) {
  if (typeof value === "number") return null;
  if (value instanceof URL) return path.resolve(fileURLToPath(value));
  if (Buffer.isBuffer(value)) return path.resolve(value.toString());
  if (typeof value !== "string") return null;
  return path.resolve(value);
}

function isWithinAllowedRoot(candidate) {
  let cursor = candidate;
  while (true) {
    const parent = path.dirname(cursor);
    if (ALLOWED_ROOTS.has(cursor) && (cursor === candidate || parent !== cursor)) return true;
    if (parent === cursor) return false;
    cursor = parent;
  }
}

function containsDataSegment(candidate) {
  return candidate.split(path.sep).includes("data");
}

export function registerKpiFixtureRoot(root) {
  const normalized = normalizePath(root);
  if (!normalized) throw new TypeError("KPI hermetic fixture root must be a filesystem path");
  ALLOWED_ROOTS.add(normalized);
  try {
    ALLOWED_ROOTS.add(ORIGINAL_REALPATH_SYNC(normalized));
  } catch {
    // A root may be registered immediately after allocation and before its first child exists.
  }
  return normalized;
}

export function assertKpiFixtureDataReadAllowed(candidate, operation = "read") {
  const normalized = normalizePath(candidate);
  if (!normalized) return;
  const candidates = [normalized];
  try {
    const resolved = ORIGINAL_REALPATH_SYNC(normalized);
    if (resolved !== normalized) candidates.push(resolved);
  } catch {
    // Missing paths are checked lexically. Existing symlink targets are checked above.
  }
  if (candidates.every((pathToCheck) => !containsDataSegment(pathToCheck))) return;
  if (candidates.every(isWithinAllowedRoot)) return;
  const error = new Error(
    `KPI fixture hermeticity violation: ${operation} refused outside declared fixture roots: ${normalized}`,
  );
  error.code = "ERR_KPI_FIXTURE_LIVE_DATA_READ";
  throw error;
}

function wrapPathMethod(target, name) {
  const original = target[name];
  if (typeof original !== "function") return;
  target[name] = function guardedPathMethod(candidate, ...args) {
    assertKpiFixtureDataReadAllowed(candidate, name);
    return original.call(this, candidate, ...args);
  };
}

function wrapCopyMethod(target, name) {
  const original = target[name];
  if (typeof original !== "function") return;
  target[name] = function guardedCopyMethod(source, destination, ...args) {
    assertKpiFixtureDataReadAllowed(source, `${name} source`);
    assertKpiFixtureDataReadAllowed(destination, `${name} destination`);
    return original.call(this, source, destination, ...args);
  };
}

for (const root of String(process.env.KPI_HERMETIC_FIXTURE_ROOTS ?? "")
  .split(path.delimiter)
  .filter(Boolean)) {
  registerKpiFixtureRoot(root);
}

if (!globalThis[PATCH_MARK]) {
  globalThis[PATCH_MARK] = { allowedRoots: ALLOWED_ROOTS, realpathSync: ORIGINAL_REALPATH_SYNC };
  for (const name of [
    "access",
    "accessSync",
    "createReadStream",
    "existsSync",
    "glob",
    "globSync",
    "lstat",
    "lstatSync",
    "open",
    "openSync",
    "opendir",
    "opendirSync",
    "readFile",
    "readFileSync",
    "readdir",
    "readdirSync",
    "readlink",
    "readlinkSync",
    "realpath",
    "realpathSync",
    "stat",
    "statSync",
  ]) wrapPathMethod(fs, name);
  for (const name of ["copyFileSync", "cpSync"]) wrapCopyMethod(fs, name);

  for (const name of ["access", "lstat", "open", "readFile", "readdir", "readlink", "realpath", "stat"]) {
    wrapPathMethod(fs.promises, name);
  }
  for (const name of ["copyFile", "cp"]) wrapCopyMethod(fs.promises, name);
  syncBuiltinESMExports();
}
