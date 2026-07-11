#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXCLUDED_PUBLIC_DATA_ROOTS = Object.freeze([
  "admin/data-supply-state",
  "yf/etf-details",
  "yf/migration-evidence",
]);

export const EXCLUDED_PUBLIC_DATA_FILES = Object.freeze([
  "admin/data-supply-detection-floor.json",
]);

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectory(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${filePath}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${filePath}`);
}

function normalizedRelative(relativePath) {
  const portable = String(relativePath).split(path.sep).join("/");
  const normalized = path.posix.normalize(portable).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`unsafe relative path: ${relativePath}`);
  }
  return normalized;
}

function isExcludedRoot(relativePath) {
  return EXCLUDED_PUBLIC_DATA_ROOTS.includes(normalizedRelative(relativePath));
}

function isExcludedFile(relativePath) {
  return EXCLUDED_PUBLIC_DATA_FILES.includes(normalizedRelative(relativePath));
}

function collectSourceFiles(sourceRoot) {
  const files = [];
  const directories = [];
  let excludedSourceRoots = 0;
  const excludedSourceFilePaths = [];

  function visit(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = normalizedRelative(path.posix.join(relativeDirectory, entry.name));
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`source public-data path is a symlink: ${absolutePath}`);
      }
      if (isExcludedFile(relativePath)) {
        if (!stat.isFile()) {
          throw new Error(`excluded source file must be a regular file: ${absolutePath}`);
        }
        excludedSourceFilePaths.push(relativePath);
        continue;
      }
      if (isExcludedRoot(relativePath)) {
        if (!stat.isDirectory()) {
          throw new Error(`excluded source root must be a directory: ${absolutePath}`);
        }
        excludedSourceRoots += 1;
        continue;
      }
      if (stat.isDirectory()) {
        directories.push(relativePath);
        visit(absolutePath, relativePath);
      } else if (stat.isFile()) {
        files.push({ relativePath, absolutePath, size: stat.size });
      } else {
        throw new Error(`source public-data path is not a regular file or directory: ${absolutePath}`);
      }
    }
  }

  visit(sourceRoot);
  return {
    files,
    directories,
    excludedSourceRoots,
    excludedSourceFiles: excludedSourceFilePaths.length,
    excludedSourceFilePaths,
  };
}

const IDENTITY_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "nlink",
  "uid",
  "gid",
  "rdev",
  "size",
  "blksize",
  "blocks",
  "mtimeNs",
  "ctimeNs",
  "birthtimeNs",
]);

function lstatBigintIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function statIdentity(stat) {
  if (!stat) return null;
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, String(stat[field] ?? "")]));
}

function sameIdentity(left, right) {
  return IDENTITY_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function collectRemovalTree(directory, stat, files, directories, capture) {
  if (stat.isSymbolicLink()) throw new Error(`destination excluded root is a symlink: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`destination excluded root is not a directory: ${directory}`);
  directories.push(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const entryStat = capture(entryPath, "destination excluded tree node");
    if (!entryStat) throw new Error(`destination removal identity drift during preflight: ${entryPath}`);
    if (entryStat.isSymbolicLink()) throw new Error(`destination excluded tree contains a symlink: ${entryPath}`);
    if (entryStat.isDirectory()) collectRemovalTree(entryPath, entryStat, files, directories, capture);
    else if (entryStat.isFile()) files.push(entryPath);
    else throw new Error(`destination excluded tree contains a special file: ${entryPath}`);
  }
}

function collectDestinationRemovalPlan(destinationRoot) {
  const bindings = [];
  const bindingByPath = new Map();
  function capture(filePath, label) {
    const stat = lstatBigintIfPresent(filePath);
    const identity = statIdentity(stat);
    const existing = bindingByPath.get(filePath);
    if (existing) {
      if (!sameIdentity(existing.identity, identity)) {
        throw new Error(`destination removal identity drift during preflight: ${label}: ${filePath}`);
      }
      return stat;
    }
    const binding = { filePath, label, identity };
    bindingByPath.set(filePath, binding);
    bindings.push(binding);
    return stat;
  }

  const destinationStat = capture(destinationRoot, "destination root");
  if (destinationStat?.isSymbolicLink()) {
    throw new Error(`destination root must not be a symlink: ${destinationRoot}`);
  }
  if (destinationStat && !destinationStat.isDirectory()) {
    throw new Error(`destination root must be a directory: ${destinationRoot}`);
  }

  for (const relativeParent of ["admin", "yf"]) {
    const parentPath = path.join(destinationRoot, relativeParent);
    const parentStat = capture(parentPath, "destination removal parent");
    if (parentStat?.isSymbolicLink()) {
      throw new Error(`destination removal parent is a symlink: ${parentPath}`);
    }
    if (parentStat && !parentStat.isDirectory()) {
      throw new Error(`destination removal parent is not a directory: ${parentPath}`);
    }
  }

  const roots = [];
  for (const relativeRoot of EXCLUDED_PUBLIC_DATA_ROOTS) {
    const target = path.join(destinationRoot, ...relativeRoot.split("/"));
    const stat = capture(target, "destination excluded root");
    if (!stat) continue;
    const files = [];
    const directories = [];
    collectRemovalTree(target, stat, files, directories, capture);
    roots.push({ relativeRoot, files, directories });
  }

  const exactFiles = [];
  for (const relativePath of EXCLUDED_PUBLIC_DATA_FILES) {
    const target = path.join(destinationRoot, ...relativePath.split("/"));
    const stat = capture(target, "destination excluded exact file");
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`destination excluded exact file is a symlink: ${target}`);
    }
    if (!stat.isFile()) {
      throw new Error(`destination excluded exact file must be a regular file: ${target}`);
    }
    exactFiles.push({ relativePath, filePath: target });
  }

  return { roots, exactFiles, bindings };
}

function revalidateDestinationRemovalPlan(bindings) {
  for (const binding of bindings) {
    const identity = statIdentity(lstatBigintIfPresent(binding.filePath));
    if (!sameIdentity(binding.identity, identity)) {
      throw new Error(`destination removal identity drift: ${binding.label}: ${binding.filePath}`);
    }
  }
}

function preflightDestinationPaths(destinationRoot, sourcePlan) {
  if (!lstatIfPresent(destinationRoot)) return;
  for (const item of [
    ...sourcePlan.directories.map((relativePath) => ({ relativePath, expectsDirectory: true })),
    ...sourcePlan.files.map(({ relativePath }) => ({ relativePath, expectsDirectory: false })),
  ]) {
    const segments = item.relativePath.split("/");
    let cursor = destinationRoot;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]);
      const stat = lstatIfPresent(cursor);
      if (!stat) break;
      if (stat.isSymbolicLink()) throw new Error(`destination public-data path is a symlink: ${cursor}`);
      const final = index === segments.length - 1;
      if (!final && !stat.isDirectory()) throw new Error(`destination public-data parent is not a directory: ${cursor}`);
      if (final && item.expectsDirectory && !stat.isDirectory()) throw new Error(`destination directory path is not a directory: ${cursor}`);
      if (final && !item.expectsDirectory && !stat.isFile()) throw new Error(`destination file path is not a regular file: ${cursor}`);
    }
  }
}

function assertRemovalBinding(bindingByPath, filePath, expectedKind, stableOnly = false) {
  const binding = bindingByPath.get(filePath);
  const stat = lstatBigintIfPresent(filePath);
  const kind = !stat ? "absent" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "unsafe";
  if (!binding || kind !== expectedKind) {
    throw new Error(`destination removal node changed before mutation: ${filePath}`);
  }
  const current = statIdentity(stat);
  const fields = stableOnly ? ["dev", "ino", "mode"] : IDENTITY_FIELDS;
  if (!fields.every((field) => binding.identity?.[field] === current?.[field])) {
    throw new Error(`destination removal identity drift before mutation: ${filePath}`);
  }
}

function removeDestinationRoots(removals, bindingByPath) {
  for (const removal of removals) {
    for (const filePath of removal.files) {
      assertRemovalBinding(bindingByPath, filePath, "file");
      fs.unlinkSync(filePath);
    }
    for (const directory of [...removal.directories].reverse()) {
      assertRemovalBinding(bindingByPath, directory, "directory", true);
      fs.rmdirSync(directory);
    }
  }
}

function removeDestinationExactFiles(removals, bindingByPath) {
  for (const removal of removals) {
    assertRemovalBinding(bindingByPath, removal.filePath, "file");
    fs.unlinkSync(removal.filePath);
  }
}

export function planPublicDataSync({ sourceRoot, destinationRoot }) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  assertDirectory(source, "source root");
  const destinationStat = lstatIfPresent(destination);
  if (destinationStat) assertDirectory(destination, "destination root");
  const sourcePlan = collectSourceFiles(source);
  preflightDestinationPaths(destination, sourcePlan);
  const removalPlan = collectDestinationRemovalPlan(destination);
  return {
    sourceRoot: source,
    destinationRoot: destination,
    files: sourcePlan.files,
    directories: sourcePlan.directories,
    excludedSourceRoots: sourcePlan.excludedSourceRoots,
    excludedSourceFiles: sourcePlan.excludedSourceFiles,
    excludedSourceFilePaths: sourcePlan.excludedSourceFilePaths,
    removals: removalPlan.roots,
    exactRemovals: removalPlan.exactFiles,
    removalBindings: removalPlan.bindings,
  };
}

export function syncPublicData({
  sourceRoot,
  destinationRoot,
  dryRun = false,
  logger = console.log,
  beforeMutation = null,
}) {
  if (beforeMutation !== null && typeof beforeMutation !== "function") {
    throw new TypeError("beforeMutation must be a function");
  }
  const plan = planPublicDataSync({ sourceRoot, destinationRoot });
  const result = {
    sourceRoot: plan.sourceRoot,
    destinationRoot: plan.destinationRoot,
    dryRun,
    filesCopied: plan.files.length,
    bytesCopied: plan.files.reduce((sum, item) => sum + item.size, 0),
    excludedSourceRoots: plan.excludedSourceRoots,
    excludedSourceFiles: plan.excludedSourceFiles,
    excludedSourceFilePaths: [...plan.excludedSourceFilePaths],
    removedDestinationRoots: plan.removals.length,
    removedDestinationFiles: plan.removals.reduce((sum, item) => sum + item.files.length, 0),
    removedDestinationExactFiles: plan.exactRemovals.length,
    removedDestinationExactFilePaths: plan.exactRemovals.map((item) => item.relativePath),
  };
  if (dryRun) return result;

  beforeMutation?.(Object.freeze({
    sourceRoot: plan.sourceRoot,
    destinationRoot: plan.destinationRoot,
    removedDestinationRoots: plan.removals.map((item) => item.relativeRoot),
    removedDestinationExactFilePaths: [...result.removedDestinationExactFilePaths],
  }));
  revalidateDestinationRemovalPlan(plan.removalBindings);
  const removalBindingByPath = new Map(
    plan.removalBindings.map((binding) => [binding.filePath, binding]),
  );
  fs.mkdirSync(plan.destinationRoot, { recursive: true });
  removeDestinationExactFiles(plan.exactRemovals, removalBindingByPath);
  removeDestinationRoots(plan.removals, removalBindingByPath);
  for (const relativeDirectory of plan.directories) {
    fs.mkdirSync(path.join(plan.destinationRoot, ...relativeDirectory.split("/")), { recursive: true });
  }
  for (const item of plan.files) {
    const target = path.join(plan.destinationRoot, ...item.relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const targetStat = lstatIfPresent(target);
    if (targetStat?.isSymbolicLink()) throw new Error(`destination file is a symlink: ${target}`);
    if (targetStat && !targetStat.isFile()) throw new Error(`destination path is not a regular file: ${target}`);
    fs.copyFileSync(item.absolutePath, target);
  }
  logger(`[sync-public-data] copied ${result.filesCopied} files (${result.bytesCopied} bytes); excluded ${result.excludedSourceRoots} private roots; removed ${result.removedDestinationRoots} stale private roots; excluded ${result.excludedSourceFiles} exact files; removed ${result.removedDestinationExactFiles} stale exact files`);
  return result;
}

function getArg(name) {
  const exact = process.argv.indexOf(name);
  if (exact >= 0 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const check = process.argv.includes("--check");
  const write = process.argv.includes("--write");
  if (check === write) {
    console.error("usage: sync-public-data.mjs (--check | --write) [--source <data>] [--destination <public/data>]");
    process.exit(2);
  }
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = syncPublicData({
    sourceRoot: getArg("--source") || path.resolve(appRoot, "..", "data"),
    destinationRoot: getArg("--destination") || path.join(appRoot, "public", "data"),
    dryRun: check,
  });
  console.log(JSON.stringify(result, null, 2));
}
