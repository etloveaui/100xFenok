#!/usr/bin/env node
// Lane Registry completeness checker — SHADOW (report-only, always exit 0).
//
// Walks the first level of data/admin/ and reconciles it with the lane
// registry in both directions:
//   - any tree root (directory) not declared as a lane's roots.admin_store and
//     not covered by a declared exception -> ::warning undeclared_root
//   - any tree file not covered by a declared exception -> ::warning undeclared_file
//   - any registry admin_store absent from the tree -> ::warning absent_store_root
//     (expected while a lane's first natural run is still pending)
//   - any declared exception whose path no longer exists -> ::warning stale_exception
//
// NO enforcement in step 1: findings are loud, the exit code is always 0.
// Flipping to fail-closed is migration step 2 (BACKLOG #366).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANE_REGISTRY,
  declaredAdminRoots,
  declaredExceptionPaths,
} from "./lib/lane-registry.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");
const ADMIN_REL = path.join("data", "admin");

export function checkLaneRegistryCompleteness({
  repoRoot = DEFAULT_REPO_ROOT,
  registry = LANE_REGISTRY,
  warn = (message) => console.log(`::warning:: ${message}`),
  info = (message) => console.log(message),
} = {}) {
  const adminRoot = path.join(repoRoot, ADMIN_REL);
  const adminRoots = declaredAdminRoots();
  const exceptionRoots = new Set(declaredExceptionPaths("root"));
  const exceptionFiles = new Set(declaredExceptionPaths("file"));

  const undeclared_roots = [];
  const undeclared_files = [];
  const absent_store_roots = [];
  const stale_exceptions = [];

  const entries = fs.existsSync(adminRoot)
    ? fs.readdirSync(adminRoot, { withFileTypes: true })
    : [];
  let checkedRoots = 0;
  let checkedFiles = 0;
  for (const entry of entries) {
    const rel = `${ADMIN_REL.split(path.sep).join("/")}/${entry.name}`;
    if (entry.isDirectory()) {
      checkedRoots += 1;
      if (!adminRoots.has(rel) && !exceptionRoots.has(rel)) undeclared_roots.push(rel);
    } else if (entry.isFile()) {
      checkedFiles += 1;
      if (!exceptionFiles.has(rel)) undeclared_files.push(rel);
    }
  }

  for (const laneValue of registry.lanes) {
    const store = laneValue.roots.admin_store;
    if (store === null) continue;
    if (!fs.existsSync(path.join(repoRoot, store))) {
      absent_store_roots.push({ lane: laneValue.id, path: store });
    }
  }

  for (const exception of registry.declared_exceptions) {
    if (exception.may_be_absent === true) continue;
    if (!fs.existsSync(path.join(repoRoot, exception.path))) {
      stale_exceptions.push(exception.path);
    }
  }

  for (const root of undeclared_roots) {
    warn(`lane-registry undeclared_root: ${root} exists on the tree but no lane record or declared exception covers it`);
  }
  for (const file of undeclared_files) {
    warn(`lane-registry undeclared_file: ${file} exists on the tree but no declared exception covers it`);
  }
  for (const row of absent_store_roots) {
    warn(`lane-registry absent_store_root: ${row.path} declared by lane ${row.lane} is absent from the tree (pending first store-writing run?)`);
  }
  for (const stale of stale_exceptions) {
    warn(`lane-registry stale_exception: ${stale} is declared but no longer exists on the tree`);
  }

  const summary = {
    lane_count: registry.lanes.length,
    checked_roots: checkedRoots,
    checked_files: checkedFiles,
    undeclared_roots,
    undeclared_files,
    absent_store_roots,
    stale_exceptions,
    clean: undeclared_roots.length === 0
      && undeclared_files.length === 0
      && absent_store_roots.length === 0
      && stale_exceptions.length === 0,
  };
  info(`lane-registry completeness (shadow): lanes=${summary.lane_count} roots=${summary.checked_roots} files=${summary.checked_files} undeclared_roots=${undeclared_roots.length} undeclared_files=${undeclared_files.length} absent_store_roots=${absent_store_roots.length} stale_exceptions=${stale_exceptions.length}`);
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // SHADOW: report-only by contract; never fail the build in step 1.
  checkLaneRegistryCompleteness();
  process.exit(0);
}
