#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXCLUDED_PUBLIC_DATA_ROOTS = Object.freeze([
  "admin/data-supply-state",
  "yf/etf-details",
  "yf/migration-evidence",
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

function collectSourceFiles(sourceRoot) {
  const files = [];
  const directories = [];
  let excludedSourceRoots = 0;

  function visit(directory, relativeDirectory = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = normalizedRelative(path.posix.join(relativeDirectory, entry.name));
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`source public-data path is a symlink: ${absolutePath}`);
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
  return { files, directories, excludedSourceRoots };
}

function collectRemovalTree(directory, files, directories) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink()) throw new Error(`destination excluded root is a symlink: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`destination excluded root is not a directory: ${directory}`);
  directories.push(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const entryStat = fs.lstatSync(entryPath);
    if (entryStat.isSymbolicLink()) throw new Error(`destination excluded tree contains a symlink: ${entryPath}`);
    if (entryStat.isDirectory()) collectRemovalTree(entryPath, files, directories);
    else if (entryStat.isFile()) files.push(entryPath);
    else throw new Error(`destination excluded tree contains a special file: ${entryPath}`);
  }
}

function collectDestinationRemovals(destinationRoot) {
  const roots = [];
  for (const relativeRoot of EXCLUDED_PUBLIC_DATA_ROOTS) {
    const target = path.join(destinationRoot, ...relativeRoot.split("/"));
    const stat = lstatIfPresent(target);
    if (!stat) continue;
    const files = [];
    const directories = [];
    collectRemovalTree(target, files, directories);
    roots.push({ relativeRoot, files, directories });
  }
  return roots;
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

function removeDestinationRoots(removals) {
  for (const removal of removals) {
    for (const filePath of removal.files) fs.unlinkSync(filePath);
    for (const directory of [...removal.directories].reverse()) fs.rmdirSync(directory);
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
  const removals = destinationStat ? collectDestinationRemovals(destination) : [];
  return {
    sourceRoot: source,
    destinationRoot: destination,
    files: sourcePlan.files,
    directories: sourcePlan.directories,
    excludedSourceRoots: sourcePlan.excludedSourceRoots,
    removals,
  };
}

export function syncPublicData({ sourceRoot, destinationRoot, dryRun = false, logger = console.log }) {
  const plan = planPublicDataSync({ sourceRoot, destinationRoot });
  const result = {
    sourceRoot: plan.sourceRoot,
    destinationRoot: plan.destinationRoot,
    dryRun,
    filesCopied: plan.files.length,
    bytesCopied: plan.files.reduce((sum, item) => sum + item.size, 0),
    excludedSourceRoots: plan.excludedSourceRoots,
    removedDestinationRoots: plan.removals.length,
    removedDestinationFiles: plan.removals.reduce((sum, item) => sum + item.files.length, 0),
  };
  if (dryRun) return result;

  fs.mkdirSync(plan.destinationRoot, { recursive: true });
  removeDestinationRoots(plan.removals);
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
  logger(`[sync-public-data] copied ${result.filesCopied} files (${result.bytesCopied} bytes); excluded ${result.excludedSourceRoots} private roots; removed ${result.removedDestinationRoots} stale private roots`);
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
