#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, "..");

function fail(message) {
  throw new Error(`site metadata materialization: ${message}`);
}

function assertDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === "ENOENT") fail(`${label} is missing: ${directory}`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be a real directory: ${directory}`);
}

function readSource(directory, label) {
  assertDirectory(directory, label);
  const files = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      fail(`${label} contains a non-JSON regular file: ${entry.name}`);
    }
    const filePath = path.join(directory, entry.name);
    const body = fs.readFileSync(filePath);
    try {
      JSON.parse(body.toString("utf8"));
    } catch (error) {
      fail(`${label}/${entry.name} is invalid JSON: ${error.message}`);
    }
    files.set(entry.name, { body, source: `${label}/${entry.name}` });
  }
  return files;
}

export function collectSiteMetadata({ dailyWrapRoot, alphaScoutRoot }) {
  const merged = new Map();
  for (const [label, directory] of [["daily-wrap", dailyWrapRoot], ["alpha-scout", alphaScoutRoot]]) {
    for (const [name, item] of readSource(directory, label)) {
      const prior = merged.get(name);
      if (prior && !prior.body.equals(item.body)) {
        fail(`conflicting source bytes for ${name}: ${prior.source} != ${item.source}`);
      }
      if (!prior) merged.set(name, item);
    }
  }
  if (merged.size === 0) fail("source union is empty");
  return new Map([...merged.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function readDestination(directory) {
  if (!fs.existsSync(directory)) return new Map();
  return readSource(directory, "canonical");
}

function compare(expected, actual) {
  const missing = [];
  const stale = [];
  const changed = [];
  for (const [name, item] of expected) {
    const found = actual.get(name);
    if (!found) missing.push(name);
    else if (!item.body.equals(found.body)) changed.push(name);
  }
  for (const name of actual.keys()) if (!expected.has(name)) stale.push(name);
  return { missing, stale, changed };
}

function replaceDirectory(destinationRoot, files) {
  const parent = path.dirname(destinationRoot);
  fs.mkdirSync(parent, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(parent, `.${path.basename(destinationRoot)}.tmp-`));
  const backupRoot = path.join(parent, `.${path.basename(destinationRoot)}.previous-${process.pid}`);
  try {
    for (const [name, item] of files) fs.writeFileSync(path.join(tempRoot, name), item.body, { mode: 0o644 });
    if (fs.existsSync(destinationRoot)) fs.renameSync(destinationRoot, backupRoot);
    fs.renameSync(tempRoot, destinationRoot);
    fs.rmSync(backupRoot, { recursive: true, force: true });
  } catch (error) {
    if (!fs.existsSync(destinationRoot) && fs.existsSync(backupRoot)) fs.renameSync(backupRoot, destinationRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export function materializeSiteMetadata({ dailyWrapRoot, alphaScoutRoot, destinationRoot, write = false }) {
  const expected = collectSiteMetadata({ dailyWrapRoot, alphaScoutRoot });
  const before = readDestination(destinationRoot);
  const drift = compare(expected, before);
  const changed = drift.missing.length > 0 || drift.stale.length > 0 || drift.changed.length > 0;
  if (write && changed) replaceDirectory(destinationRoot, expected);
  if (!write && changed) {
    fail(`canonical drift: missing=${drift.missing.join(",") || "none"} stale=${drift.stale.join(",") || "none"} changed=${drift.changed.join(",") || "none"}`);
  }
  const after = write ? readDestination(destinationRoot) : before;
  const remaining = compare(expected, after);
  if (remaining.missing.length || remaining.stale.length || remaining.changed.length) fail("canonical replacement did not converge");
  return { count: expected.size, changed, files: [...expected.keys()] };
}

function getArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const check = process.argv.includes("--check");
  const write = process.argv.includes("--write");
  if (check === write) fail("select exactly one of --check or --write");
  const repoRoot = path.resolve(getArg("--repo-root") || DEFAULT_ROOT);
  const result = materializeSiteMetadata({
    dailyWrapRoot: path.resolve(repoRoot, getArg("--daily-wrap-root") || "100x/data/metadata"),
    alphaScoutRoot: path.resolve(repoRoot, getArg("--alpha-scout-root") || "alpha-scout/data/metadata"),
    destinationRoot: path.resolve(repoRoot, getArg("--destination") || "data/metadata"),
    write,
  });
  console.log(JSON.stringify(result));
}
