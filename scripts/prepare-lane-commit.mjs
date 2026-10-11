#!/usr/bin/env node
// Transfer only an already-staged lane difference to the short Git writer job.
// Preparation, provider calls and regeneration remain outside the writer lock.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const SUPPORTED = new Set(["pins-autosync.yml", "fetch-defillama.yml", "fetch-yahoo-ticker.yml"]);
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const fail = (message) => { throw new Error(`lane commit: ${message}`); };
function relative(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_./-]+$/.test(value)
    || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) fail("invalid path");
  return value;
}
export function git(args, { cwd = process.cwd(), input, timeout = 30_000 } = {}) {
  return execFileSync("git", args, { cwd, input, timeout, maxBuffer: MAX_TOTAL, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
function policy(workflow, success) {
  if (!SUPPORTED.has(workflow) || typeof success !== "boolean") fail("unsupported workflow or outcome");
  const p = LANE_REGISTRY.workflow_policies[`.github/workflows/${workflow}`];
  const specs = [...p.stages.always_if_exists, ...(success ? p.stages.success_if_exists : [])];
  // These three lanes use only exact paths/directories. Do not silently turn a
  // future glob/dynamic policy into a wider transfer permission.
  if (specs.some((s) => !["file", "directory"].includes(s.kind))) fail("unsupported lane path kind");
  const matches = (name, spec) => name === spec.path || (spec.kind === "directory" && name.startsWith(`${spec.path}/`));
  return { specs, allows: (name) => specs.some((s) => matches(name, s)) && !p.exclude.some((s) => matches(name, s)) };
}
function inputRoots(workflow) {
  const common = ["scripts", ".github/workflows", "100xfenok-next/scripts", "100xfenok-next/src/lib"];
  if (workflow === "pins-autosync.yml") {
    // The projection reads control-room attempts, source stamps, alarm and KPI
    // data. Conservative tree fingerprints include every current input without
    // downloading these directories in the writer checkout.
    return [...common, "data/admin", "data/global-scouter/core/metadata.json"];
  }
  const lanes = LANE_REGISTRY.lanes.filter((lane) => lane.owner_workflow === `.github/workflows/${workflow}`);
  return [...new Set([...common, ...lanes.flatMap((lane) => [lane.roots.admin_store, ...lane.roots.canonical_outputs]).filter(Boolean)])].sort();
}
function objectAt(root, ref, name) {
  const result = git(["ls-tree", "-z", ref, "--", relative(name)], { cwd: root }).toString();
  if (!result) return null;
  const rows = result.split("\0").filter(Boolean);
  if (rows.length !== 1) fail("ambiguous tree path");
  const match = /^(\d{6}) (blob|tree) ([a-f0-9]{40})\t(.+)$/.exec(rows[0]);
  if (!match || match[4] !== name) fail("unexpected tree entry");
  return { mode: match[1], type: match[2], oid: match[3] };
}
function inputsAt(root, workflow, ref = "HEAD") {
  return Object.fromEntries(inputRoots(workflow).map((name) => [name, objectAt(root, ref, name)]));
}
function identity(env) {
  if (!/^\d+$/.test(env.GITHUB_RUN_ID ?? "") || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? "")) fail("missing run identity");
  return { run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function indexClean(root) {
  if (git(["diff", "--cached", "--name-only", "-z"], { cwd: root }).length) fail("writer index already contains changes");
}
export function prepare({ root = process.cwd(), workflow, success, env = process.env }) {
  const binding = identity(env);
  const { allows } = policy(workflow, success);
  const names = git(["diff", "--cached", "--name-only", "--no-renames", "-z"], { cwd: root }).toString().split("\0").filter(Boolean).sort();
  let total = 0;
  const entries = names.map((name) => {
    relative(name);
    if (!allows(name)) fail(`staged path outside lane: ${name}`);
    const row = git(["ls-files", "--stage", "-z", "--", name], { cwd: root }).toString();
    const match = /^100644 ([a-f0-9]{40}) 0\t([^\0]+)\0$/.exec(row);
    if (!match || match[2] !== name) fail(`only regular, nondeleted stage-zero files can transfer: ${name}`);
    const bytes = git(["show", `:${name}`], { cwd: root });
    total += bytes.length;
    if (bytes.length > MAX_BYTES || total > MAX_TOTAL) fail("candidate exceeds transfer budget");
    const before = objectAt(root, "HEAD", name);
    if (before && (before.type !== "blob" || before.mode !== "100644")) fail("unsupported baseline mode");
    return { path: name, before, oid: match[1], bytes: bytes.length, sha256: digest(bytes), body: bytes.toString("base64") };
  });
  return { schema: "lane-commit/v1", workflow, success, ...binding,
    base: git(["rev-parse", "HEAD"], { cwd: root }).toString().trim(), inputs: inputsAt(root, workflow), entries };
}
export function apply({ root = process.cwd(), workflow, artifact, env = process.env }) {
  indexClean(root);
  const binding = identity(env);
  if (artifact?.schema !== "lane-commit/v1" || artifact.workflow !== workflow
    || artifact.run_id !== binding.run_id || artifact.run_attempt !== binding.run_attempt || !SHA.test(artifact.base)) fail("candidate binding mismatch");
  const { allows } = policy(workflow, artifact.success);
  if (!Array.isArray(artifact.entries) || artifact.entries.length > 1000) fail("invalid candidate entries");
  const expectedInputs = inputRoots(workflow);
  if (!same(Object.keys(artifact.inputs ?? {}), expectedInputs)) fail("candidate input membership mismatch");
  if (!same(inputsAt(root, workflow, artifact.base), artifact.inputs)) fail("candidate input baseline mismatch");
  const seen = new Set(); let total = 0;
  // Verify ALL entries before touching the index or writing any blob.
  const entries = artifact.entries.map((entry) => {
    const name = relative(entry.path);
    if (seen.has(name) || !allows(name)) fail("duplicate or disallowed candidate path");
    seen.add(name);
    if (typeof entry.body !== "string" || entry.body.length > MAX_BYTES * 1.34) fail("invalid candidate body");
    const bytes = Buffer.from(entry.body, "base64"); total += bytes.length;
    if (bytes.toString("base64") !== entry.body || bytes.length !== entry.bytes || bytes.length > MAX_BYTES
      || total > MAX_TOTAL || digest(bytes) !== entry.sha256) fail("candidate digest/size mismatch");
    const oid = crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    if (oid !== entry.oid) fail("candidate Git object mismatch");
    if (entry.before !== null && (!SHA.test(entry.before?.oid) || entry.before.mode !== "100644" || entry.before.type !== "blob")) fail("invalid candidate baseline");
    if (!same(objectAt(root, artifact.base, name), entry.before)) fail("candidate output baseline mismatch");
    return { ...entry, bytes, current: objectAt(root, "HEAD", name) };
  });
  if (entries.every((e) => e.current?.mode === "100644" && e.current?.oid === e.oid)) return "unchanged";
  if (entries.some((e) => !same(e.current, e.before))) return "stale_output";
  if (!same(inputsAt(root, workflow), artifact.inputs)) return "stale_input";
  let sparse = false;
  try { sparse = git(["config", "--bool", "core.sparseCheckout"], { cwd: root }).toString().trim() === "true"; }
  catch { /* A normal checkout need not configure sparseCheckout. */ }
  for (const entry of entries) {
    const oid = git(["hash-object", "-w", "--stdin"], { cwd: root, input: entry.bytes }).toString().trim();
    if (oid !== entry.oid) fail("written Git blob mismatch");
    git(["update-index", "--add", "--cacheinfo", `100644,${oid},${entry.path}`], { cwd: root });
    // cacheinfo replaces index flags. Restore sparse omission so a missing
    // worktree payload is not mistaken for a deletion on the next push retry.
    if (sparse && !fs.existsSync(path.join(root, entry.path))) {
      git(["update-index", "--skip-worktree", "--", entry.path], { cwd: root });
    }
  }
  return "applied";
}
function output(name, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  console.log(`lane commit ${name}=${value}`);
}
function main() {
  const [command, workflow, artifactPath, outcome] = process.argv.slice(2);
  if (!artifactPath || !["prepare", "apply"].includes(command)) fail("usage: prepare-lane-commit.mjs prepare|apply WORKFLOW ARTIFACT [success|failure]");
  if (command === "prepare") {
    if (!["success", "failure"].includes(outcome)) fail("explicit preparation outcome required");
    const artifact = prepare({ workflow, success: outcome === "success" });
    if (artifact.entries.length) fs.writeFileSync(artifactPath, `${JSON.stringify(artifact)}\n`);
    output("changed", artifact.entries.length > 0);
  } else {
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_TOTAL * 1.4) fail("invalid artifact file");
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    if (!SHA.test(artifact?.base)) fail("invalid base revision");
    // A depth-one writer clone may not contain the preparation commit. Fetch
    // just that commit and its trees, never the full history or data blobs.
    try { git(["cat-file", "-e", `${artifact.base}^{commit}`]); }
    catch { git(["fetch", "--filter=blob:none", "--depth=1", "origin", artifact.base], { timeout: 60_000 }); }
    const status = apply({ workflow, artifact });
    output("status", status);
    if (status.startsWith("stale_")) console.log(`::notice::${status}: newer main inputs/outputs superseded this candidate; next scheduled run will regenerate`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
