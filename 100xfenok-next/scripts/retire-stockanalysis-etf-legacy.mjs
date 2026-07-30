#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  STOCKANALYSIS_ETF_SHARD_COUNT,
  stockanalysisEtfManifestSha256,
} from "../src/lib/stockanalysis-etf-shard.mjs";

export const RETIREMENT_PLAN_SCHEMA = "stockanalysis-etf-legacy-retirement/v1";
export const RETIREMENT_JOURNAL_SCHEMA = "stockanalysis-etf-legacy-retirement-journal/v1";
export const EXPECTED_LEGACY_ETF_COUNT = 5586;

const sha = (body) => crypto.createHash("sha256").update(body).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
};
const stable = (value) => `${JSON.stringify(canonical(value), null, 2)}\n`;
const fail = (message) => { throw new Error(message); };

function safeRoot(root, label) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail(`${label} must be a real directory`);
  return path.resolve(root);
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  fs.renameSync(tmp, file);
}

function atomicBytes(file, body) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, body, { flag: "wx" });
  fs.renameSync(tmp, file);
}

function planDigest(plan) {
  return sha(stable({ ...plan, plan_sha256: null }));
}

function journalDigest(journal) {
  return sha(stable({ ...journal, journal_sha256: null }));
}

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[A-Z0-9][A-Z0-9.-]{0,19}\.json$/.test(entry.name))
    .map((entry) => {
      const body = fs.readFileSync(path.join(root, entry.name));
      return { path: entry.name, bytes: body.length, sha256: sha(body) };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function shardState(publicRoot) {
  const root = path.join(publicRoot, "shards");
  safeRoot(root, "shard root");
  const manifestPath = path.join(root, "index.json");
  const manifestBody = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBody);
  if (
    manifest.shard_count !== STOCKANALYSIS_ETF_SHARD_COUNT
    || manifest.shards?.length !== STOCKANALYSIS_ETF_SHARD_COUNT
  ) fail("invalid shard manifest");
  const inventory = [{ path: "index.json", bytes: manifestBody.length, sha256: sha(manifestBody) }];
  for (const entry of manifest.shards) {
    const candidate = path.resolve(root, entry.path);
    if (!candidate.startsWith(`${root}${path.sep}`)) fail("unsafe shard path");
    const body = fs.readFileSync(candidate);
    if (body.length !== entry.byte_length || sha(body) !== entry.sha256) fail(`shard mismatch: ${entry.path}`);
    inventory.push({ path: entry.path, bytes: body.length, sha256: entry.sha256 });
  }
  return { manifest, inventory };
}

function loadPlan(planPath, expectedTargetCount) {
  const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
  if (plan.schema_version !== RETIREMENT_PLAN_SCHEMA) fail("invalid retirement plan");
  if (expectedTargetCount != null && plan.target_count !== expectedTargetCount) {
    fail(`target_count must be exactly ${expectedTargetCount}`);
  }
  if (plan.plan_sha256 !== planDigest(plan)) fail("retirement plan digest mismatch");
  return plan;
}

export function buildRetirementPlan({ canonicalRoot, publicRoot, lockedSourceSha, expectedTargetCount = EXPECTED_LEGACY_ETF_COUNT }) {
  canonicalRoot = safeRoot(canonicalRoot, "canonical root");
  publicRoot = safeRoot(publicRoot, "public root");
  const canonical = files(canonicalRoot);
  const targets = files(publicRoot);
  if (expectedTargetCount != null && targets.length !== expectedTargetCount) {
    fail(`expected exactly ${expectedTargetCount} legacy ETF files; found ${targets.length}`);
  }
  if (canonical.length !== targets.length) fail(`canonical/public count mismatch: ${canonical.length}/${targets.length}`);
  for (let index = 0; index < canonical.length; index += 1) {
    if (JSON.stringify(canonical[index]) !== JSON.stringify(targets[index])) fail(`canonical/public byte mismatch: ${targets[index]?.path}`);
  }
  const shards = shardState(publicRoot);
  if (shards.manifest.payload_count !== canonical.length) fail("shard payload count mismatch");
  const plan = {
    schema_version: RETIREMENT_PLAN_SCHEMA,
    locked_source_sha: lockedSourceSha,
    canonical_root: canonicalRoot,
    public_root: publicRoot,
    target_count: targets.length,
    targets,
    shard_inventory: shards.inventory,
    original_compatibility_mode: shards.manifest.compatibility_mode,
    original_manifest: shards.manifest,
    original_manifest_raw: fs.readFileSync(path.join(publicRoot, "shards", "index.json"), "utf8"),
    original_manifest_sha256: sha(fs.readFileSync(path.join(publicRoot, "shards", "index.json"))),
  };
  plan.plan_sha256 = planDigest({ ...plan, plan_sha256: null });
  return plan;
}

export function writeRetirementPlan({ outputPath, ...options }) {
  const plan = buildRetirementPlan(options);
  atomicJson(outputPath, plan);
  return plan;
}

function journal(planPath, journalPath) {
  if (fs.existsSync(journalPath)) {
    const value = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    if (value.schema_version !== RETIREMENT_JOURNAL_SCHEMA || value.plan_path !== path.resolve(planPath)) fail("invalid journal");
    if (value.journal_sha256 !== journalDigest(value)) fail("journal digest mismatch");
    return value;
  }
  return {
    schema_version: RETIREMENT_JOURNAL_SCHEMA,
    plan_path: path.resolve(planPath),
    progress: { apply: {}, restore: {} },
    status: { apply: "not_started", restore: "not_started" },
    journal_sha256: null,
  };
}

function saveJournal(file, value) {
  value.journal_sha256 = journalDigest(value);
  atomicJson(file, value);
}

function transition(state, operation, target, next, journalPath) {
  const previous = state.progress[operation][target];
  const expected = previous == null ? "intent" : previous === "intent" ? "mutated" : previous === "mutated" ? "committed" : null;
  if (expected !== next) fail(`invalid ${operation} transition ${previous ?? "fresh"} -> ${next}`);
  state.progress[operation][target] = next;
  saveJournal(journalPath, state);
}

function trigger(interruptAfter, point) {
  if (interruptAfter === point) throw new Error(`injected interruption after ${point}`);
}

function verifyShards(plan) {
  const current = shardState(plan.public_root);
  if (!["legacy-fallback", "shard-only"].includes(current.manifest.compatibility_mode)) fail("shard compatibility mode drift");
  if (JSON.stringify(current.inventory.slice(1)) !== JSON.stringify(plan.shard_inventory.slice(1))) fail("shard payload inventory drift");
}

function transitionManifest(plan, mode) {
  const manifestPath = path.join(plan.public_root, "shards", "index.json");
  const current = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (current.compatibility_mode === mode) return;
  if (!["legacy-fallback", "shard-only"].includes(current.compatibility_mode) || !["legacy-fallback", "shard-only"].includes(mode)) {
    fail(`ETF shard compatibility mode drift: ${current.compatibility_mode} -> ${mode}`);
  }
  if (mode === plan.original_compatibility_mode) {
    atomicBytes(manifestPath, Buffer.from(plan.original_manifest_raw, "utf8"));
    if (sha(fs.readFileSync(manifestPath)) !== plan.original_manifest_sha256) fail("original ETF shard manifest restore mismatch");
    return;
  }
  current.compatibility_mode = mode;
  current.manifest_sha256 = stockanalysisEtfManifestSha256(current);
  atomicJson(manifestPath, current);
}

export function applyRetirementPlan({ planPath, journalPath, interruptAfter = null, expectedTargetCount = EXPECTED_LEGACY_ETF_COUNT }) {
  const plan = loadPlan(planPath, expectedTargetCount);
  verifyShards(plan);
  const state = journal(planPath, journalPath);
  for (const target of plan.targets) {
    let phase = state.progress.apply[target.path];
    if (phase === "committed") continue;
    const file = path.join(plan.public_root, target.path);
    if (!phase) {
      if (!fs.existsSync(file)) fail(`unrecorded missing target: ${target.path}`);
      const body = fs.readFileSync(file);
      if (body.length !== target.bytes || sha(body) !== target.sha256) fail(`target drift: ${target.path}`);
      transition(state, "apply", target.path, "intent", journalPath);
      trigger(interruptAfter, "apply-intent");
      phase = "intent";
    }
    if (phase === "intent") {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      transition(state, "apply", target.path, "mutated", journalPath);
      trigger(interruptAfter, "apply-mutation");
      phase = "mutated";
    }
    if (phase === "mutated") {
      if (fs.existsSync(file)) fail(`apply target remains: ${target.path}`);
      transition(state, "apply", target.path, "committed", journalPath);
      trigger(interruptAfter, "apply-commit");
    }
  }
  if (files(plan.public_root).length !== 0) fail("direct legacy ETF files remain");
  transitionManifest(plan, "shard-only");
  state.status.apply = "completed";
  saveJournal(journalPath, state);
  return { status: "applied", retired: plan.target_count, shard_files: plan.shard_inventory.length };
}

export function restoreRetirementPlan({ planPath, journalPath, interruptAfter = null, expectedTargetCount = EXPECTED_LEGACY_ETF_COUNT }) {
  const plan = loadPlan(planPath, expectedTargetCount);
  const state = journal(planPath, journalPath);
  for (const target of plan.targets) {
    let phase = state.progress.restore[target.path];
    if (phase === "committed") continue;
    const source = path.join(plan.canonical_root, target.path);
    const body = fs.readFileSync(source);
    if (body.length !== target.bytes || sha(body) !== target.sha256) fail(`canonical drift: ${target.path}`);
    const destination = path.join(plan.public_root, target.path);
    if (!phase) {
      if (fs.existsSync(destination)) fail(`unexpected restore target: ${target.path}`);
      transition(state, "restore", target.path, "intent", journalPath);
      trigger(interruptAfter, "restore-intent");
      phase = "intent";
    }
    if (phase === "intent") {
      if (!fs.existsSync(destination)) fs.writeFileSync(destination, body, { flag: "wx" });
      transition(state, "restore", target.path, "mutated", journalPath);
      trigger(interruptAfter, "restore-mutation");
      phase = "mutated";
    }
    if (phase === "mutated") {
      const restored = fs.readFileSync(destination);
      if (restored.length !== target.bytes || sha(restored) !== target.sha256) fail(`restore mismatch: ${target.path}`);
      transition(state, "restore", target.path, "committed", journalPath);
      trigger(interruptAfter, "restore-commit");
    }
  }
  transitionManifest(plan, plan.original_compatibility_mode);
  state.status.restore = "completed";
  saveJournal(journalPath, state);
  return { status: "restored", restored: plan.target_count };
}

export function verifyEmittedEtfAssets({ assetRoot }) {
  const publicRoot = safeRoot(
    path.join(assetRoot, "data", "stockanalysis", "etfs"),
    "emitted ETF asset root",
  );
  const direct = files(publicRoot);
  const shard = shardState(publicRoot);
  if (direct.length !== 0) fail(`emitted direct legacy ETF count must be zero; got ${direct.length}`);
  if (shard.manifest.compatibility_mode !== "shard-only") fail("emitted ETF manifest is not shard-only");
  const expectedShardAssets = STOCKANALYSIS_ETF_SHARD_COUNT + 1;
  if (shard.inventory.length !== expectedShardAssets) {
    fail(`expected ${expectedShardAssets} emitted ETF shard assets; got ${shard.inventory.length}`);
  }
  return {
    direct_legacy_etf_count: 0,
    shard_file_count: shard.inventory.length,
    payload_count: shard.manifest.payload_count,
    snapshot_id: shard.manifest.snapshot_id,
  };
}

export function recordWranglerEvidence({
  wranglerOutputPath,
  wranglerLogPath,
  buildEvidencePath,
  assetBudgetPath,
  sourceSha,
  buildId,
  versionId,
}) {
  const output = fs.readFileSync(wranglerOutputPath, "utf8");
  const log = fs.readFileSync(wranglerLogPath, "utf8");
  const build = JSON.parse(fs.readFileSync(buildEvidencePath, "utf8"));
  const budget = JSON.parse(fs.readFileSync(assetBudgetPath, "utf8"));
  const match = `${output}\n${log}`.match(/(?:Uploaded|Uploading)\s+(\d+)\s+(?:files|assets)/i);
  return {
    schema_version: "stockanalysis-etf-retirement-deploy-evidence/v1",
    source_sha: sourceSha,
    build_id: buildId,
    version_id: versionId,
    uploaded_asset_count: match ? Number(match[1]) : null,
    measured_asset_count: budget.regular_file_count,
    uploaded_etf_shard_count: build.shard_file_count,
    uploaded_direct_legacy_etf_count: build.direct_legacy_etf_count,
    build_evidence_sha256: sha(fs.readFileSync(buildEvidencePath)),
    wrangler_output_sha256: sha(fs.readFileSync(wranglerOutputPath)),
    wrangler_log_sha256: sha(fs.readFileSync(wranglerLogPath)),
  };
}

function args(argv) {
  const out = { mode: argv[2] };
  for (let i = 3; i < argv.length; i += 2) out[argv[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[i + 1];
  return out;
}

async function main() {
  const o = args(process.argv);
  const count = o.expectedTargetCount == null ? EXPECTED_LEGACY_ETF_COUNT : Number(o.expectedTargetCount);
  const result = o.mode === "--plan"
    ? writeRetirementPlan({ outputPath: o.output, canonicalRoot: o.canonicalRoot, publicRoot: o.publicRoot, lockedSourceSha: o.lockedSourceSha, expectedTargetCount: count })
    : o.mode === "--apply"
      ? applyRetirementPlan({ planPath: o.planPath, journalPath: o.journal, expectedTargetCount: count })
      : o.mode === "--restore"
        ? restoreRetirementPlan({ planPath: o.planPath, journalPath: o.journal, expectedTargetCount: count })
        : fail("choose --plan, --apply, or --restore");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
