#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildLaneCommitManifest, validateLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const WORKFLOW = ".github/workflows/update-manifest.yml";
const STAGE = "always_if_exists";

function fail(message) {
  throw new Error(`update-manifest central staging: ${message}`);
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: null });
  if (result.error) fail(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`git ${args[0]} failed: ${(result.stderr?.toString("utf8") || result.stdout?.toString("utf8") || `status ${result.status}`).trim()}`);
  return result.stdout;
}

function nulPaths(buffer) {
  return buffer.toString("utf8").split("\0").filter(Boolean);
}

function assertSafePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.split("/").includes("..") || /[\u0000-\u001f\u007f]/.test(value)) {
    fail(`${label} is unsafe`);
  }
}

function parseArgs(argv) {
  const options = { repoRoot: DEFAULT_REPO_ROOT, manifestPath: null, mode: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--repo-root", "--manifest"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      index += 1;
      if (argument === "--repo-root") options.repoRoot = path.resolve(value);
      else options.manifestPath = path.resolve(value);
    } else if (["--check", "--stage", "--clean-untracked-after-reset", "--assert-clean-after-reset"].includes(argument)) {
      if (options.mode) fail("select exactly one operation");
      options.mode = argument.slice(2);
    } else fail(`unknown argument: ${argument}`);
  }
  if (!options.mode) fail("select exactly one operation");
  options.repoRoot = fs.realpathSync(options.repoRoot);
  options.manifestPath ??= path.join(options.repoRoot, "data/admin/lane-commit-manifest.json");
  return options;
}

function loadPolicy(options) {
  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
  validateLaneCommitManifest(manifest);
  const builtPaths = buildLaneCommitManifest().update_manifest.central_commit_paths;
  const paths = manifest.update_manifest.central_commit_paths;
  if (canonicalJson(paths) !== canonicalJson(builtPaths)) fail("central_commit_paths are stale");
  if (paths.length !== 60 || new Set(paths).size !== paths.length) fail("central_commit_paths must contain exactly 60 unique paths");
  const specs = manifest.workflows[WORKFLOW]?.stages?.[STAGE];
  if (!Array.isArray(specs) || canonicalJson(specs.map((spec) => spec.path)) !== canonicalJson(paths)) fail("workflow central stage is stale");
  for (const [index, spec] of specs.entries()) {
    assertSafePath(spec.path, `central_commit_paths[${index}]`);
    if (!["file", "directory"].includes(spec.kind) || spec.required !== false) fail(`central_commit_paths[${index}] policy is invalid`);
  }
  return { digest: manifest.registry_digest, paths, specs };
}

function pathCovered(candidate, specs) {
  return specs.some((spec) => candidate === spec.path || (spec.kind === "directory" && candidate.startsWith(`${spec.path}/`)));
}

function listScoped(repoRoot, args, paths) {
  return nulPaths(runGit(repoRoot, [...args, "--", ...paths]));
}

function listCached(repoRoot) {
  return nulPaths(runGit(repoRoot, ["diff", "--cached", "--name-only", "-z"]));
}

function assertNoOutOfPolicyStaged(repoRoot, specs) {
  const outside = listCached(repoRoot).filter((candidate) => !pathCovered(candidate, specs));
  if (outside.length) fail(`out-of-policy staged paths: ${outside.join(", ")}`);
}

function collectChanged(repoRoot, policy) {
  const changed = new Set([
    ...listScoped(repoRoot, ["diff", "--name-only", "-z"], policy.paths),
    ...listScoped(repoRoot, ["diff", "--cached", "--name-only", "-z"], policy.paths),
    ...listScoped(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], policy.paths),
  ]);
  return [...changed].sort();
}

function collectUntracked(repoRoot, policy) {
  return listScoped(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], policy.paths).sort();
}

function collectIgnored(repoRoot, policy) {
  return listScoped(repoRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], policy.paths).sort();
}

function assertCleanAfterReset(repoRoot, policy) {
  assertNoOutOfPolicyStaged(repoRoot, policy.specs);
  const cached = listCached(repoRoot);
  const changed = collectChanged(repoRoot, policy);
  const ignored = collectIgnored(repoRoot, policy);
  if (cached.length || changed.length || ignored.length) {
    fail(`reset left central state: cached=${cached.length} changed=${changed.length} ignored=${ignored.length}`);
  }
  return { changed: 0, staged: 0 };
}

function cleanUntrackedAfterReset(repoRoot, policy) {
  assertNoOutOfPolicyStaged(repoRoot, policy.specs);
  const cached = listCached(repoRoot);
  const tracked = listScoped(repoRoot, ["diff", "--name-only", "-z"], policy.paths);
  if (cached.length || tracked.length) {
    fail(`cleanup requires clean tracked state: cached=${cached.length} changed=${tracked.length}`);
  }
  const untracked = collectUntracked(repoRoot, policy);
  if (untracked.length) runGit(repoRoot, ["clean", "-fd", "--", ...untracked]);
  return assertCleanAfterReset(repoRoot, policy);
}

function stagePolicy(repoRoot, policy) {
  assertNoOutOfPolicyStaged(repoRoot, policy.specs);
  const before = collectChanged(repoRoot, policy);
  if (before.length === 0) fail("no central changes to stage");
  runGit(repoRoot, ["add", "-A", "--", ...before]);
  assertNoOutOfPolicyStaged(repoRoot, policy.specs);
  const unstaged = [
    ...listScoped(repoRoot, ["diff", "--name-only", "-z"], policy.paths),
    ...listScoped(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"], policy.paths),
  ];
  if (unstaged.length) fail(`central paths remain unstaged: ${unstaged.join(", ")}`);
  const staged = listCached(repoRoot).filter((candidate) => pathCovered(candidate, policy.specs)).sort();
  if (staged.length === 0) fail("central staging produced an empty index");
  return { changed: before.length, staged: staged.length };
}

export function runCentralStaging(options) {
  const policy = loadPolicy(options);
  assertNoOutOfPolicyStaged(options.repoRoot, policy.specs);
  if (options.mode === "clean-untracked-after-reset") return { ...cleanUntrackedAfterReset(options.repoRoot, policy), digest: policy.digest, declared: policy.paths.length };
  if (options.mode === "assert-clean-after-reset") return { ...assertCleanAfterReset(options.repoRoot, policy), digest: policy.digest, declared: policy.paths.length };
  if (options.mode === "stage") return { ...stagePolicy(options.repoRoot, policy), digest: policy.digest, declared: policy.paths.length };
  const changed = collectChanged(options.repoRoot, policy).length;
  return { digest: policy.digest, declared: policy.paths.length, changed, staged: listCached(options.repoRoot).filter((candidate) => pathCovered(candidate, policy.specs)).length };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = runCentralStaging(options);
    console.log(`update-manifest central staging proof: digest=${result.digest.slice(0, 12)} mode=${options.mode} declared=${result.declared} changed=${result.changed} staged=${result.staged}`);
    if (options.mode === "check" && result.changed === 0) process.exitCode = 3;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
