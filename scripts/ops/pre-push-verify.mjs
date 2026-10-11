#!/usr/bin/env node
// Developer command on the authorized Linux verifier; never a CI/deploy entry.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const root = process.cwd();
const expected = process.argv[2];
const extras = process.argv[3];
if (process.platform !== "linux" || !/^[a-f0-9]{40}$/.test(expected ?? "")) {
  throw new Error("Run on the authorized Linux verification checkout: node scripts/ops/pre-push-verify.mjs EXACT_SHA [extra-commands.json]");
}
const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git(["rev-parse", "HEAD"]) !== expected) throw new Error("Verification HEAD differs from the publication candidate");
git(["diff", "--exit-code", "HEAD", "--", "."]);
const lockSha = crypto.createHash("sha256").update(fs.readFileSync("100xfenok-next/package-lock.json")).digest("hex");
if (process.env.FENOK_VERIFY_DEPENDENCY_LOCK_SHA !== lockSha || !fs.existsSync("100xfenok-next/node_modules/typescript")) {
  throw new Error("Install candidate dependencies or supply a cache bound to this exact package-lock SHA256");
}
const actionlint = process.env.ACTIONLINT_BIN ?? "actionlint";
if (!/^v?1\.7\.12\n/.test(execFileSync(actionlint, ["-version"], { encoding: "utf8" }))) throw new Error("Pinned actionlint v1.7.12 required");
const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", NEXT_TELEMETRY_DISABLED: "1",
  FENOK_REMOTE_HEAVY_NESTED_EXECUTION: "1", FENOK_REMOTE_HEAVY_EXPECTED_REVISION: expected };
const workflow = file => JSON.parse(execFileSync("ruby", ["-rjson", "-ryaml", "-e", "puts JSON.generate(YAML.load_file(ARGV[0]))", file], { encoding: "utf8" }));
function run(name, command, cwd = root, extraEnv = {}) {
  console.log(`CHECK ${name}`);
  const result = spawnSync("bash", ["-euo", "pipefail", "-c", command], { cwd, env: { ...env, ...extraEnv }, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${name} failed (${result.status ?? result.error?.message})`);
}
// Consume the actual workflow, so adding a Validate step cannot drift from this command.
for (const step of workflow(".github/workflows/validate-workflows.yml").jobs["validate-workflow-yaml"].steps) {
  if (!step.run || step.name === "Install pinned actionlint") continue;
  if (step.if || step.run.includes("${{")) throw new Error(`Review conditional/expression before local replay: ${step.name}`);
  run(step.name, step.run, root, step.env);
}
// Main pushes run generation, the full type check and the fast unit set.
for (const step of workflow(".github/workflows/app-quality.yml").jobs["app-quality"].steps) {
  if (["Generate build-time modules", "Typecheck", "Unit tests"].includes(step.name)) {
    run(step.name, step.run, path.join(root, "100xfenok-next"), step.env);
  }
}
if (extras) {
  const commands = JSON.parse(fs.readFileSync(extras, "utf8"));
  if (!Array.isArray(commands) || commands.some(row => typeof row.name !== "string" || typeof row.command !== "string")) throw new Error("Invalid extra check list");
  for (const row of commands) run(row.name, row.command);
}
git(["diff", "--exit-code", "HEAD", "--", "."]);
console.log(`PASS pre-push candidate ${expected}; package-lock ${lockSha}`);
