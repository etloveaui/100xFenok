#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildLaneCommitManifest, validateLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

function fail(message) {
  throw new Error(`update-manifest materialization: ${message}`);
}

function isWithin(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertSafeRelative(value, label) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.split("/").includes("..") || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} is unsafe`);
  }
}

function lstatIfExists(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertNoSymlinkComponents(target, allowRoot, label) {
  const relative = path.relative(allowRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail(`${label} escapes its allow-root`);
  let current = allowRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = lstatIfExists(current);
    if (!stat) break;
    if (stat.isSymbolicLink()) fail(`${label} contains a symlink`);
  }
}

function assertTreeHasNoSymlinks(root, label) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail(`${label} contains a symlink`);
    if (entry.isDirectory()) assertTreeHasNoSymlinks(target, label);
  }
}

function treeContainsFile(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && treeContainsFile(path.join(root, entry.name))) return true;
  }
  return false;
}

function pathsOverlap(left, right) {
  return isWithin(left, right) || isWithin(right, left);
}

function routeKey(route) {
  return `${route.source}\u0000${route.destination}`;
}

export function validateMaterializationRoutes({ repoRoot, routes }) {
  const resolvedRepo = fs.realpathSync(repoRoot);
  const sourceAllow = path.join(resolvedRepo, "data");
  const destinationAllow = path.join(resolvedRepo, "100xfenok-next/public/data");
  for (const [allowRoot, label] of [[sourceAllow, "source allow-root"], [destinationAllow, "destination allow-root"]]) {
    const stat = lstatIfExists(allowRoot);
    if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail(`${label} must be a real directory`);
    if (!isWithin(fs.realpathSync(allowRoot), resolvedRepo)) fail(`${label} escapes repo root`);
  }
  const seenRoutes = new Set();
  const seenDestinations = new Set();
  const prepared = [];
  for (const [index, route] of routes.entries()) {
    assertSafeRelative(route.source, `routes[${index}].source`);
    assertSafeRelative(route.destination, `routes[${index}].destination`);
    if (!route.source.startsWith("data/")) fail(`routes[${index}] source is outside canonical data root`);
    if (!route.destination.startsWith("100xfenok-next/public/data/")) fail(`routes[${index}] destination is outside public data root`);
    if (seenRoutes.has(routeKey(route))) fail(`routes[${index}] duplicates a route`);
    if (seenDestinations.has(route.destination)) fail(`routes[${index}] duplicates a destination`);
    seenRoutes.add(routeKey(route));
    seenDestinations.add(route.destination);
    if (route.mode === "cp_file") {
      if (route.delete !== false || route.trailing_slash !== false) fail(`routes[${index}] cp_file flags are invalid`);
    } else if (route.mode === "rsync_tree") {
      if (route.delete !== true || route.trailing_slash !== true) fail(`routes[${index}] rsync_tree flags are invalid`);
    } else fail(`routes[${index}] mode is invalid`);
    const sourceAbs = path.resolve(resolvedRepo, route.source);
    const destinationAbs = path.resolve(resolvedRepo, route.destination);
    if (!isWithin(sourceAbs, sourceAllow) || sourceAbs === sourceAllow) fail(`routes[${index}] source escapes canonical data root`);
    if (!isWithin(destinationAbs, destinationAllow) || destinationAbs === destinationAllow) fail(`routes[${index}] destination escapes public data root`);
    if (pathsOverlap(sourceAbs, destinationAbs)) fail(`routes[${index}] source and destination overlap`);
    assertNoSymlinkComponents(sourceAbs, sourceAllow, `routes[${index}] source`);
    assertNoSymlinkComponents(destinationAbs, destinationAllow, `routes[${index}] destination`);
    const sourceStat = lstatIfExists(sourceAbs);
    if (!sourceStat) {
      if (route.required) fail(`routes[${index}] required source is missing`);
      prepared.push({ ...route, sourceAbs, destinationAbs, skip: true });
      continue;
    }
    if (sourceStat.isSymbolicLink()) fail(`routes[${index}] source contains a symlink`);
    if (route.mode === "cp_file" && !sourceStat.isFile()) fail(`routes[${index}] cp_file source is not a file`);
    if (route.mode === "rsync_tree" && !sourceStat.isDirectory()) fail(`routes[${index}] rsync_tree source is not a directory`);
    if (route.mode === "rsync_tree" && !treeContainsFile(sourceAbs)) fail(`routes[${index}] rsync_tree source is empty`);
    const destinationStat = lstatIfExists(destinationAbs);
    if (destinationStat?.isSymbolicLink()) fail(`routes[${index}] destination contains a symlink`);
    if (destinationStat && route.mode === "cp_file" && !destinationStat.isFile()) fail(`routes[${index}] cp_file destination is not a file`);
    if (destinationStat && route.mode === "rsync_tree" && !destinationStat.isDirectory()) fail(`routes[${index}] rsync_tree destination is not a directory`);
    if (route.mode === "rsync_tree") {
      assertTreeHasNoSymlinks(sourceAbs, `routes[${index}] source`);
      if (destinationStat) assertTreeHasNoSymlinks(destinationAbs, `routes[${index}] destination`);
    }
    prepared.push({ ...route, sourceAbs, destinationAbs, skip: false });
  }
  return { repoRoot: resolvedRepo, prepared };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) fail(`${command} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  return result.stdout;
}

function listTree(root, prefix = "") {
  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const target = path.join(root, entry.name);
    if (entry.isSymbolicLink()) fail("tree parity encountered a symlink");
    if (entry.isDirectory()) rows.push([`${relative}/`, null], ...listTree(target, relative));
    else if (entry.isFile()) rows.push([relative, fs.readFileSync(target)]);
    else fail("tree parity encountered an unsupported entry");
  }
  return rows;
}

function assertTreeParity(source, destination) {
  const left = listTree(source);
  const right = listTree(destination);
  if (left.length !== right.length) fail("rsync tree parity count differs");
  for (let index = 0; index < left.length; index += 1) {
    const [leftPath, leftContents] = left[index];
    const [rightPath, rightContents] = right[index];
    const contentsDiffer = leftContents === null
      ? rightContents !== null
      : rightContents === null || !leftContents.equals(rightContents);
    if (leftPath !== rightPath || contentsDiffer) fail("rsync tree parity differs");
  }
}

function assertNoUntracked(repoRoot, routes) {
  for (const route of routes) {
    const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "--", route.source], { cwd: repoRoot });
    const ignored = run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "--", route.source], { cwd: repoRoot });
    if (untracked.trim() || ignored.trim()) fail(`untracked or ignored pre-reset route source content: ${route.source}`);
  }
}

export function orderMaterializations(routes) {
  return [...routes].sort((left, right) => {
    const leftRank = left.mode === "cp_file" ? 0 : 1;
    const rightRank = right.mode === "cp_file" ? 0 : 1;
    return leftRank - rightRank;
  });
}

function parseArgs(argv) {
  const options = { repoRoot: DEFAULT_REPO_ROOT, manifestPath: null, all: false, routeSources: [], validateOnly: false, assertNoUntracked: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--repo-root", "--manifest", "--route-source"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      if (argument === "--repo-root") options.repoRoot = path.resolve(value);
      else if (argument === "--manifest") options.manifestPath = path.resolve(value);
      else options.routeSources.push(value);
    } else if (argument === "--all") options.all = true;
    else if (argument === "--validate-only") options.validateOnly = true;
    else if (argument === "--assert-no-untracked") options.assertNoUntracked = true;
    else fail(`unknown argument: ${argument}`);
  }
  if (options.all === (options.routeSources.length > 0)) fail("select exactly --all or one or more --route-source values");
  options.manifestPath ??= path.join(options.repoRoot, "data/admin/lane-commit-manifest.json");
  return options;
}

export function materializeUpdateManifestRoutes(options) {
  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
  validateLaneCommitManifest(manifest);
  const builtRoutes = buildLaneCommitManifest().update_manifest.materializations;
  if (canonicalJson(manifest.update_manifest.materializations) !== canonicalJson(builtRoutes)) fail("manifest materializations are stale");
  const routes = manifest.update_manifest.materializations;
  const validation = validateMaterializationRoutes({ repoRoot: options.repoRoot, routes });
  const selected = options.all
    ? validation.prepared
    : options.routeSources.map((source) => {
      const matches = validation.prepared.filter((route) => route.source === source);
      if (matches.length !== 1) fail(`route source must match exactly once: ${source}`);
      return matches[0];
    });
  if (new Set(selected.map((route) => route.source)).size !== selected.length) fail("route source selection contains duplicates");
  if (options.assertNoUntracked) assertNoUntracked(validation.repoRoot, selected);
  if (options.validateOnly) return { count: selected.length, digest: manifest.registry_digest, materialized: 0 };
  let materialized = 0;
  for (const route of orderMaterializations(selected)) {
    if (route.skip) continue;
    if (route.mode === "cp_file") {
      fs.mkdirSync(path.dirname(route.destinationAbs), { recursive: true });
      fs.copyFileSync(route.sourceAbs, route.destinationAbs);
      if (!fs.readFileSync(route.sourceAbs).equals(fs.readFileSync(route.destinationAbs))) fail("cp_file parity differs");
    } else {
      fs.mkdirSync(route.destinationAbs, { recursive: true });
      run("rsync", ["-a", "--checksum", "--delete", `${route.sourceAbs}/`, `${route.destinationAbs}/`], { cwd: validation.repoRoot });
      assertTreeParity(route.sourceAbs, route.destinationAbs);
    }
    materialized += 1;
  }
  return { count: selected.length, digest: manifest.registry_digest, materialized };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = materializeUpdateManifestRoutes(options);
    console.log(`update-manifest materialization proof: digest=${result.digest.slice(0, 12)} selected=${result.count} materialized=${result.materialized}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
