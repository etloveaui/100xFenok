#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DERIVED_ASSET_REGISTRY } from "./lib/derived-asset-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".py", ".sh", ".ts", ".tsx"]);
const SCRIPT_COMMAND_RE = /\b(?:node|nodejs|tsx|python3?|bash|sh)\s+(?:-[A-Za-z0-9_-]+\s+)*([^\s"'`;|&]+\.(?:cjs|js|mjs|py|sh|ts|tsx))(?=$|[\s"'`;|&])/g;
const NPM_RUN_RE = /\bnpm\s+(?:--prefix\s+([^\s"'`;|&]+)\s+)?run\s+([A-Za-z0-9:_-]+)/g;
const MODULE_IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()\s*["']([^"']+)["']/g;
const CHILD_PROCESS_RE = /\b(?:spawnSync|spawn|execFileSync|execFile|fork)\s*\(/;
const SCRIPT_LITERAL_RE = /["'](scripts\/[^"']+\.(?:cjs|js|mjs|py|sh|ts|tsx))["']/g;

function fail(message) {
  throw new Error(`derived-asset-workflow-parity: ${message}`);
}

function readText(relativePath) {
  const absolute = path.join(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolute)) fail(`referenced file is missing: ${relativePath}`);
  return fs.readFileSync(absolute, "utf8");
}

function normalizeScriptRef(rawRef, contextDir) {
  const absolute = path.resolve(contextDir, rawRef);
  const relative = path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || !relative.startsWith("scripts/")) return null;
  if (!SCRIPT_EXTENSIONS.has(path.extname(relative))) return null;
  return relative;
}

function normalizeModuleRef(rawRef, currentFile) {
  if (!rawRef.startsWith(".")) return null;
  const currentAbsolute = path.join(REPO_ROOT, currentFile);
  const base = path.resolve(path.dirname(currentAbsolute), rawRef);
  const candidates = path.extname(base)
    ? [base]
    : [...SCRIPT_EXTENSIONS].map((extension) => `${base}${extension}`);
  for (const candidate of candidates) {
    const relative = path.relative(REPO_ROOT, candidate).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || !relative.startsWith("scripts/")) continue;
    if (!SCRIPT_EXTENSIONS.has(path.extname(relative)) || !fs.existsSync(candidate)) continue;
    return relative;
  }
  return null;
}

function packageJsonPaths(prefix, contextDir) {
  if (prefix) {
    return [path.join(path.resolve(contextDir, prefix), "package.json")];
  }
  return [
    path.join(contextDir, "package.json"),
    path.join(REPO_ROOT, "package.json"),
    path.join(REPO_ROOT, "100xfenok-next", "package.json"),
  ];
}

function packageScriptCommands(prefix, scriptName, contextDir) {
  const commands = [];
  const seen = new Set();
  for (const packagePath of packageJsonPaths(prefix, contextDir)) {
    if (seen.has(packagePath) || !fs.existsSync(packagePath)) continue;
    seen.add(packagePath);
    const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    const command = packageJson.scripts?.[scriptName];
    if (typeof command === "string") {
      commands.push({ command, contextDir: path.dirname(packagePath) });
    }
  }
  return commands;
}

function extractScriptRefs(text, contextDir) {
  const refs = new Set();
  for (const match of text.matchAll(SCRIPT_COMMAND_RE)) {
    const relative = normalizeScriptRef(match[1], contextDir);
    if (relative) refs.add(relative);
  }
  return refs;
}

function extractModuleRefs(text, currentFile) {
  if (!currentFile) return new Set();
  const refs = new Set();
  for (const match of text.matchAll(MODULE_IMPORT_RE)) {
    const relative = normalizeModuleRef(match[1], currentFile);
    if (relative) refs.add(relative);
  }
  return refs;
}

function extractChildProcessRefs(text, currentFile) {
  if (!currentFile || currentFile.startsWith("scripts/test-") || !CHILD_PROCESS_RE.test(text)) {
    return new Set();
  }
  const refs = new Set();
  for (const match of text.matchAll(SCRIPT_LITERAL_RE)) {
    const relative = normalizeScriptRef(match[1], REPO_ROOT);
    if (relative) refs.add(relative);
  }
  return refs;
}

function workflowScriptClosure(workflowPath) {
  const visitedFiles = new Set();
  const queuedFiles = new Set();
  const visitedPackageRuns = new Set();
  const queue = [{ relativePath: workflowPath, contextDir: REPO_ROOT }];
  const invoked = new Set();

  function enqueueFile(relativePath, contextDir) {
    if (queuedFiles.has(relativePath)) return;
    queuedFiles.add(relativePath);
    queue.push({ relativePath, contextDir });
  }

  function enqueueText(text, contextDir, sourceLabel, currentFile = null) {
    for (const relativePath of extractScriptRefs(text, contextDir)) {
      invoked.add(relativePath);
      if (!visitedFiles.has(relativePath)) enqueueFile(relativePath, REPO_ROOT);
    }
    for (const relativePath of extractModuleRefs(text, currentFile)) {
      invoked.add(relativePath);
      if (!visitedFiles.has(relativePath)) enqueueFile(relativePath, REPO_ROOT);
    }
    for (const relativePath of extractChildProcessRefs(text, currentFile)) {
      invoked.add(relativePath);
      if (!visitedFiles.has(relativePath)) enqueueFile(relativePath, REPO_ROOT);
    }
    for (const match of text.matchAll(NPM_RUN_RE)) {
      const prefix = match[1] ?? null;
      const scriptName = match[2];
      const runKey = `${prefix ?? "<implicit>"}:${scriptName}:${contextDir}`;
      if (visitedPackageRuns.has(runKey)) continue;
      visitedPackageRuns.add(runKey);
      const commands = packageScriptCommands(prefix, scriptName, contextDir);
      if (commands.length === 0) fail(`${sourceLabel} invokes missing npm script ${scriptName}`);
      for (const { command, contextDir: packageDir } of commands) {
        enqueueText(command, packageDir, `${sourceLabel} -> npm run ${scriptName}`);
      }
    }
  }

  while (queue.length > 0) {
    const { relativePath, contextDir } = queue.shift();
    if (visitedFiles.has(relativePath)) continue;
    visitedFiles.add(relativePath);
    const text = readText(relativePath);
    enqueueText(text, contextDir, relativePath, relativePath);
  }
  return { invoked, visitedFiles };
}

function findMissingInvocations(registry) {
  const activeAssets = registry.assets.filter((asset) => asset.lifecycle === "active");
  const missing = [];
  for (const asset of activeAssets) {
    const closure = workflowScriptClosure(asset.owner_workflow);
    if (!closure.invoked.has(asset.writer)) {
      missing.push({
        asset: asset.id,
        owner_workflow: asset.owner_workflow,
        writer: asset.writer,
        reachable_scripts: [...closure.invoked].sort(),
      });
    }
  }
  return { activeAssets, missing };
}

const { activeAssets, missing } = findMissingInvocations(DERIVED_ASSET_REGISTRY);
assert.deepEqual(
  missing,
  [],
  `active derived assets must have an owner workflow invocation:\n${JSON.stringify(missing, null, 2)}`,
);

const syntheticDrift = JSON.parse(JSON.stringify(DERIVED_ASSET_REGISTRY));
const syntheticTarget = syntheticDrift.assets.find((asset) => asset.lifecycle === "active");
syntheticTarget.writer = "scripts/__not_invoked_by_owner_workflow__.mjs";
assert.equal(
  findMissingInvocations(syntheticDrift).missing.some((entry) => entry.asset === syntheticTarget.id),
  true,
  "the parity gate must fail when an active writer is removed from its runner closure",
);

console.log(`test-derived-asset-workflow-parity: ok (${activeAssets.length} active assets)`);
