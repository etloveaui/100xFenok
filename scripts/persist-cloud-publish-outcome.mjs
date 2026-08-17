#!/usr/bin/env node

// Persist one real cloud publish outcome after the publisher step has
// completed. The publisher writes only its per-family shard; this helper
// validates that exact path against the canonical lane registry/manifest,
// commits no other path, and rebases/pushes with bounded concurrent-writer
// retries. Workflow callers run this step with always(); a helper failure is a
// separate workflow failure while the preceding publisher outcome stays intact.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildLaneCommitManifest } from "./build-lane-commit-manifest.mjs";
import { writeJsonAtomic } from "./lib/data-supply-attempt-shard.mjs";
import { canonicalJson } from "./lib/json-canonical.mjs";
import { PLANE_PUBLISH_OUTCOME_BINDINGS } from "./lib/lane-registry.mjs";
import {
  mergePublishOutcomeShards,
  validatePublishOutcomeShard,
} from "./lib/publish-outcome-shard.mjs";

const DEFAULT_MANIFEST = "data/admin/lane-commit-manifest.json";
const DEFAULT_BRANCH = "main";
const DEFAULT_ATTEMPTS = 5;
const PUBLISHER_STEP_OUTCOMES = new Set(["success", "failure", "skipped"]);

function parseArgs(argv) {
  const args = {
    family: null,
    workflow: null,
    publisherOutcome: null,
    repoRoot: process.cwd(),
    manifest: DEFAULT_MANIFEST,
    branch: process.env.GITHUB_REF_NAME || DEFAULT_BRANCH,
    maxAttempts: DEFAULT_ATTEMPTS,
  };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg.startsWith("--workflow=")) args.workflow = arg.slice("--workflow=".length);
    else if (arg.startsWith("--publisher-outcome=")) args.publisherOutcome = arg.slice("--publisher-outcome=".length);
    else if (arg.startsWith("--repo-root=")) args.repoRoot = arg.slice("--repo-root=".length);
    else if (arg.startsWith("--manifest=")) args.manifest = arg.slice("--manifest=".length);
    else if (arg.startsWith("--branch=")) args.branch = arg.slice("--branch=".length);
    else if (arg.startsWith("--max-attempts=")) args.maxAttempts = Number(arg.slice("--max-attempts=".length));
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!args.family || !args.workflow) throw new Error("--family and --workflow are required");
  if (!PUBLISHER_STEP_OUTCOMES.has(args.publisherOutcome)) {
    throw new Error("--publisher-outcome must be success, failure, or skipped");
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(args.workflow) || args.workflow.includes("..")) throw new Error("invalid workflow path");
  if (!/^[A-Za-z0-9._/-]+$/.test(args.branch) || args.branch.includes("..")) throw new Error("invalid branch");
  if (!Number.isInteger(args.maxAttempts) || args.maxAttempts < 1 || args.maxAttempts > 10) {
    throw new Error("--max-attempts must be an integer from 1 to 10");
  }
  args.repoRoot = path.resolve(args.repoRoot);
  args.manifest = path.isAbsolute(args.manifest)
    ? args.manifest
    : path.join(args.repoRoot, args.manifest);
  return args;
}

function boundedDiagnostic(value) {
  return String(value ?? "")
    .replace(/https:\/\/[^@\s]+@/g, "https://***@")
    .replace(/\b(token|key|secret)=\S+/gi, "$1=***")
    .trim()
    .slice(0, 500);
}

function runGit(repoRoot, args, { allowFailure = false, env = {} } = {}) {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const detail = boundedDiagnostic(result.stderr || result.stdout);
    throw new Error(`git ${args[0]} failed${detail ? `: ${detail}` : ""}`);
  }
  return result;
}

function statusPaths(repoRoot) {
  const output = runGit(repoRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout;
  const entries = output.split("\0").filter(Boolean);
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const status = entry.slice(0, 2);
    const file = entry.slice(3);
    paths.push(file);
    if (status[0] === "R" || status[0] === "C") {
      index += 1;
      if (entries[index]) paths.push(entries[index]);
    }
  }
  return paths;
}

function readShard(filePath, family) {
  const shard = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validatePublishOutcomeShard(shard, family);
  return shard;
}

function readHeadShard(repoRoot, shardPath, family) {
  const listing = runGit(repoRoot, ["ls-tree", "--name-only", "HEAD", "--", shardPath]);
  if (listing.stdout.trim() === "") return null;
  const result = runGit(repoRoot, ["show", `HEAD:${shardPath}`]);
  const shard = JSON.parse(result.stdout);
  validatePublishOutcomeShard(shard, family);
  return shard;
}

function validateOwnership({ family, workflow, manifestPath }) {
  const binding = PLANE_PUBLISH_OUTCOME_BINDINGS[family];
  if (!binding) throw new Error(`unknown publish family: ${family}`);
  if (binding.workflow !== workflow) {
    throw new Error(`family ${family} belongs to ${binding.workflow}, not ${workflow}`);
  }
  const persisted = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const canonical = buildLaneCommitManifest();
  if (canonicalJson(persisted) !== canonicalJson(canonical)) {
    throw new Error("lane commit manifest is stale");
  }
  const shard = `data/admin/data-supply-state/publish-outcomes/${family}.json`;
  const specs = persisted.workflows?.[workflow]?.stages?.always_if_exists;
  if (!Array.isArray(specs) || !specs.some((spec) => (
    spec?.kind === "file" && spec.path === shard && spec.required === false
  ))) {
    throw new Error(`manifest does not declare owned shard ${shard}`);
  }
  return shard;
}

function conflictPaths(repoRoot) {
  return runGit(repoRoot, ["diff", "--name-only", "--diff-filter=U"]).stdout.trim().split("\n").filter(Boolean);
}

function resolveOwnedRebaseConflict({ repoRoot, shardPath, family, savedShard }) {
  const conflicts = conflictPaths(repoRoot);
  if (conflicts.length !== 1 || conflicts[0] !== shardPath) {
    runGit(repoRoot, ["rebase", "--abort"], { allowFailure: true });
    throw new Error(`rebase conflict outside owned shard: ${conflicts.join(",") || "unknown"}`);
  }
  const upstreamText = runGit(repoRoot, ["show", `:2:${shardPath}`]).stdout;
  const upstream = JSON.parse(upstreamText);
  validatePublishOutcomeShard(upstream, family);
  const merged = mergePublishOutcomeShards({ family, shards: [upstream, savedShard] });
  writeJsonAtomic(path.join(repoRoot, shardPath), merged);
  runGit(repoRoot, ["add", "--", shardPath]);
  if (runGit(repoRoot, ["diff", "--cached", "--quiet"], { allowFailure: true }).status === 0) {
    runGit(repoRoot, ["rebase", "--skip"]);
  } else {
    runGit(repoRoot, ["rebase", "--continue"], { env: { GIT_EDITOR: "true" } });
  }
}

function canonicalizeSavedOutcome({ repoRoot, shardPath, family, savedShard, branch }) {
  const current = readShard(path.join(repoRoot, shardPath), family);
  const merged = mergePublishOutcomeShards({ family, shards: [current, savedShard] });
  if (canonicalJson(current) === canonicalJson(merged)) return;
  writeJsonAtomic(path.join(repoRoot, shardPath), merged);
  runGit(repoRoot, ["add", "--", shardPath]);
  const ahead = Number(runGit(repoRoot, ["rev-list", "--count", `origin/${branch}..HEAD`]).stdout.trim());
  if (ahead > 0) runGit(repoRoot, ["commit", "--amend", "--no-edit"]);
  else runGit(repoRoot, ["commit", "-m", `ops: persist ${family} publish outcome [skip ci]`]);
}

export function persistPublishOutcome({
  family,
  workflow,
  publisherOutcome,
  repoRoot = process.cwd(),
  manifestPath = path.join(repoRoot, DEFAULT_MANIFEST),
  branch = process.env.GITHUB_REF_NAME || DEFAULT_BRANCH,
  maxAttempts = DEFAULT_ATTEMPTS,
  log = (line) => console.error(line),
} = {}) {
  if (!PUBLISHER_STEP_OUTCOMES.has(publisherOutcome)) {
    throw new Error("publisherOutcome must be success, failure, or skipped");
  }
  const shardPath = validateOwnership({ family, workflow, manifestPath });
  const absoluteShard = path.join(repoRoot, shardPath);
  if (!fs.existsSync(absoluteShard)) {
    if (publisherOutcome === "skipped") {
      log(`publisher skipped and outcome shard is absent for ${family}; nothing to persist`);
      return { persisted: false, reason: "skipped_absent", shardPath };
    }
    throw new Error(`publisher ${publisherOutcome} but outcome shard is absent for ${family}`);
  }
  const changedPaths = statusPaths(repoRoot);
  const unrelated = changedPaths.filter((candidate) => candidate !== shardPath);
  if (unrelated.length > 0) {
    throw new Error(`refusing dirty paths outside owned shard: ${unrelated.join(",")}`);
  }
  const shardChanged = changedPaths.includes(shardPath);
  if (!shardChanged) {
    if (publisherOutcome === "skipped") {
      log(`publisher skipped and outcome shard is unchanged for ${family}; nothing to persist`);
      return { persisted: false, reason: "skipped_unchanged", shardPath };
    }
    throw new Error(`publisher ${publisherOutcome} but outcome shard is unchanged for ${family}`);
  }
  if (publisherOutcome === "skipped") {
    throw new Error(`publisher skipped but outcome shard changed for ${family}`);
  }
  const incomingShard = readShard(absoluteShard, family);
  const headShard = readHeadShard(repoRoot, shardPath, family);
  const savedShard = headShard
    ? mergePublishOutcomeShards({ family, shards: [headShard, incomingShard] })
    : incomingShard;
  if (canonicalJson(incomingShard) !== canonicalJson(savedShard)) {
    writeJsonAtomic(absoluteShard, savedShard);
  }
  runGit(repoRoot, ["config", "user.name", "github-actions[bot]"]);
  runGit(repoRoot, ["config", "user.email", "github-actions[bot]@users.noreply.github.com"]);
  runGit(repoRoot, ["add", "--", shardPath]);
  if (runGit(repoRoot, ["diff", "--cached", "--quiet"], { allowFailure: true }).status === 0) {
    throw new Error(`publisher ${publisherOutcome} but owned shard has no staged evidence for ${family}`);
  }
  runGit(repoRoot, ["commit", "-m", `ops: persist ${family} publish outcome [skip ci]`]);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    runGit(repoRoot, ["fetch", "origin", branch]);
    const rebased = runGit(repoRoot, ["rebase", `origin/${branch}`], { allowFailure: true });
    if (rebased.status !== 0) {
      resolveOwnedRebaseConflict({ repoRoot, shardPath, family, savedShard });
    }
    canonicalizeSavedOutcome({ repoRoot, shardPath, family, savedShard, branch });
    const pushed = runGit(repoRoot, ["push", "origin", `HEAD:${branch}`], { allowFailure: true });
    if (pushed.status === 0) {
      log(`persisted ${family} publish outcome to ${branch}`);
      return { persisted: true, shardPath, attempt };
    }
    log(`publish outcome push race for ${family} on attempt ${attempt}; retrying`);
  }
  throw new Error(`publish outcome push failed after ${maxAttempts} attempts for ${family}`);
}

export async function runPersistenceCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  return persistPublishOutcome({
    family: args.family,
    workflow: args.workflow,
    publisherOutcome: args.publisherOutcome,
    repoRoot: args.repoRoot,
    manifestPath: args.manifest,
    branch: args.branch,
    maxAttempts: args.maxAttempts,
  });
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    await runPersistenceCli();
  } catch (error) {
    console.error(`persist-cloud-publish-outcome: ${boundedDiagnostic(error.message)}`);
    process.exitCode = 1;
  }
}
