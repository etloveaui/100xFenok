#!/usr/bin/env node
// Publish one data family to the cloud data plane (R2 objects + coordinator
// ledger/pointer) under the byte-locked contract in
// scripts/lib/cloud-data-plane-generation.mjs.
//
// Order of operations (non-negotiable):
//   1. Build the generation manifest from the files on disk.
//   2. Run the R2 free-tier cost gate as a child process with planned counts
//      at least 2x the real ones. Exit 2 from the gate stops everything.
//   3. publishGeneration with expectedPointerSequence read from the live
//      pointer (see resolveExpectedPointerSequence for the resume case).
//   4. Byte-parity verification resolved through the pointer ourselves
//      (resolvePublicAsset is unusable here: these assets are private).
//   5. One JSON summary line on stdout.
//
// Idempotent republish: generation_id derives from source_sha (the canonical
// (path, sha256) list), so unchanged content yields the same generation_id.
// When the live pointer already targets that generation we re-read the STORED
// manifest and pass expectedPointerSequence = pointer.sequence - 1, which is
// the only calling shape under which the contract's finalizeOrResumePromotion
// can resume the existing receipt instead of advancing the pointer. Passing
// the live sequence with a rebuilt manifest would instead collide with the
// contract's "active and previous generation must differ" rule.
//
// Env: CLOUDFLARE_API_TOKEN (gate + R2 REST), CLOUDFLARE_ACCOUNT_ID (defaulted
// below), DATA_PLANE_ENDPOINT, DATA_PLANE_WRITE_KEY. A missing endpoint or key
// is a clear error before any write; the token is enforced by the gate first.

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GENERATION_MANIFEST_SCHEMA,
  publishGeneration,
  sha256Bytes,
  sha256Canonical,
  validateGenerationManifest,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { createRemoteCoordinatorNamespace } from "./lib/cloud-data-plane-remote-coordinator.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "check-r2-free-tier-usage.mjs");
const R2_BUCKET = "fenok-data-plane";
const DEFAULT_ACCOUNT_ID = "aeeb5ea3affe55a2219d08ea02dad9e1";

// Family descriptor table. P4 adds FRED here.
export const FAMILIES = {
  "oecd-cli": {
    root: "data/admin/oecd_cli",
    privacy_class: "private",
    // Gate declaration: >= 2x the measured 4 PutObject / 592,351 bytes.
    plan: { class_a: 40, bytes: 1_200_000 },
    policy: { max_assets: 64, max_total_bytes: 16_000_000 },
  },
};

const CONTENT_TYPES = {
  ".json": "application/json",
  ".ndjson": "application/x-ndjson",
  ".csv": "text/csv",
};

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

async function walkFiles(absDir, prefix = "") {
  const entries = await readdir(absDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path.join(absDir, entry.name), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}

// Build the generation manifest for a family from the files under absRoot,
// recording asset paths relRoot-relative (they must satisfy the contract's
// privacy prefixes, e.g. "data/" for private). Deterministic in content:
// identical file bytes always yield the same generation_id.
export async function buildFamilyManifest({
  familyName,
  absRoot,
  relRoot,
  now = () => new Date().toISOString(),
}) {
  const family = FAMILIES[familyName];
  if (!family) fail("FAMILY_UNKNOWN", familyName);
  const files = (await walkFiles(absRoot)).sort((left, right) => left.localeCompare(right));
  if (files.length === 0) fail("FAMILY_EMPTY", absRoot);
  const payloads = new Map();
  const assets = [];
  for (const relative of files) {
    const bytes = new Uint8Array(await readFile(path.join(absRoot, relative)));
    const sha256 = sha256Bytes(bytes);
    const assetPath = `${relRoot}/${relative}`;
    assets.push({
      path: assetPath,
      object_key: `objects/sha256/${sha256}`,
      sha256,
      bytes: bytes.byteLength,
      content_type: CONTENT_TYPES[path.extname(relative).toLowerCase()] ?? "application/octet-stream",
      source_as_of: null,
      privacy_class: family.privacy_class,
    });
    payloads.set(assetPath, bytes);
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  const sourceSha = sha256Canonical(assets.map((asset) => [asset.path, asset.sha256]));
  const manifest = {
    schema_version: GENERATION_MANIFEST_SCHEMA,
    generation_id: `${familyName}-${sourceSha.slice(0, 16)}`,
    source_sha: sourceSha,
    created_at: now(),
    assets,
  };
  const summary = validateGenerationManifest(manifest);
  return { manifest, payloads, summary };
}

// Decide the expectedPointerSequence for publishGeneration from the live
// pointer. Normal case: the live sequence (or 0 when no pointer exists).
// Resume case: the pointer already targets this exact generation, so we adopt
// the STORED manifest (byte-identical to what the pointer binds, including the
// original created_at) and pass sequence - 1; the contract then resumes the
// existing receipt through finalizeOrResumePromotion without advancing.
export async function resolveExpectedPointerSequence({ pointer, manifest, objectStore }) {
  const alreadyActive = pointer
    && pointer.active.generation_id === manifest.generation_id
    && pointer.source_sha === manifest.source_sha;
  if (!alreadyActive) {
    return { manifest, expectedPointerSequence: pointer?.sequence ?? 0, resume: false };
  }
  const storedBytes = await objectStore.get(pointer.active.manifest_key);
  if (!(storedBytes instanceof Uint8Array)) {
    fail("STORED_MANIFEST_MISSING", pointer.active.manifest_key);
  }
  if (sha256Bytes(storedBytes) !== pointer.active.manifest_sha256) {
    fail("STORED_MANIFEST_INTEGRITY", pointer.active.manifest_key);
  }
  const storedManifest = JSON.parse(new TextDecoder().decode(storedBytes));
  const storedSummary = validateGenerationManifest(storedManifest);
  if (
    storedSummary.generation_id !== pointer.active.generation_id
    || storedSummary.manifest_sha256 !== pointer.active.manifest_sha256
    || storedManifest.source_sha !== manifest.source_sha
  ) {
    fail("STORED_MANIFEST_CROSS_BIND", pointer.active.manifest_key);
  }
  return {
    manifest: storedManifest,
    expectedPointerSequence: pointer.sequence - 1,
    resume: true,
  };
}

// Exit evidence: resolve the active generation through the pointer and compare
// every asset byte-for-byte against the files read from disk.
export async function verifyGenerationParity({ pointerStore, objectStore, payloads }) {
  const pointer = await pointerStore.get();
  if (!pointer) fail("PARITY_POINTER_MISSING", "no active pointer after publish");
  const manifestBytes = await objectStore.get(pointer.active.manifest_key);
  if (
    !(manifestBytes instanceof Uint8Array)
    || sha256Bytes(manifestBytes) !== pointer.active.manifest_sha256
  ) {
    fail("PARITY_MANIFEST_INTEGRITY", pointer.active.manifest_key);
  }
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const summary = validateGenerationManifest(manifest);
  if (
    summary.generation_id !== pointer.active.generation_id
    || summary.manifest_sha256 !== pointer.active.manifest_sha256
    || manifest.source_sha !== pointer.source_sha
  ) {
    fail("PARITY_MANIFEST_CROSS_BIND", pointer.active.manifest_key);
  }
  let bytes = 0;
  for (const asset of manifest.assets) {
    const stored = await objectStore.get(asset.object_key);
    if (
      !(stored instanceof Uint8Array)
      || stored.byteLength !== asset.bytes
      || sha256Bytes(stored) !== asset.sha256
    ) {
      fail("PARITY_ASSET_INTEGRITY", asset.path);
    }
    const local = payloads.get(asset.path);
    if (
      !(local instanceof Uint8Array)
      || local.byteLength !== stored.byteLength
      || !stored.every((byte, index) => byte === local[index])
    ) {
      fail("PARITY_ASSET_MISMATCH", asset.path);
    }
    bytes += stored.byteLength;
  }
  return { assets: manifest.assets.length, bytes, pointer };
}

function runCostGate({ planClassA, planBytes, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      GATE_SCRIPT,
      `--plan-class-a=${planClassA}`,
      `--plan-bytes=${planBytes}`,
    ], { cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({
      code,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    }));
  });
}

function gateVerdict(gate) {
  if (gate.code === 0) return "ok";
  if (gate.code === 1) return "warn";
  return "blocked";
}

function parseArgs(argv) {
  const args = { family: null, dryRun: false, json: false, tolerateGateBlock: false };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--tolerate-gate-block") args.tolerateGateBlock = true;
    else fail("ARGS_INVALID", arg);
  }
  if (!args.family) fail("ARGS_INVALID", "--family=<name> is required");
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const family = FAMILIES[args.family];
  if (!family) {
    console.error(`publish-cloud-data-generation: unknown family ${args.family}`
      + ` (known: ${Object.keys(FAMILIES).join(", ")})`);
    process.exit(2);
  }
  const log = (...parts) => {
    if (!args.json) console.error(...parts);
  };
  const emit = (summary) => console.log(JSON.stringify(summary));

  // 1. Manifest from disk.
  const { manifest, payloads, summary } = await buildFamilyManifest({
    familyName: args.family,
    absRoot: path.join(REPO_ROOT, family.root),
    relRoot: family.root,
  });
  const uniqueAssetKeys = new Set(manifest.assets.map((asset) => asset.object_key)).size;
  const plan = {
    assets: summary.asset_count,
    total_bytes: summary.total_bytes,
    unique_object_keys: uniqueAssetKeys + 1, // + manifest object
    objects_deduped: summary.asset_count - uniqueAssetKeys,
  };
  log(`family ${args.family}: ${plan.assets} assets, ${plan.total_bytes} bytes,`
    + ` ${plan.unique_object_keys} unique objects (${plan.objects_deduped} deduped)`
    + ` -> generation ${manifest.generation_id}`);

  if (args.dryRun) {
    emit({
      result: "dry_run",
      generation_id: manifest.generation_id,
      ...plan,
      planned_class_a: family.plan.class_a,
      planned_bytes: family.plan.bytes,
      gate: "not_run",
    });
    return;
  }

  // 2. Cost gate (declares >= 2x the real spend) before any write.
  const gateBefore = await runCostGate({
    planClassA: family.plan.class_a,
    planBytes: family.plan.bytes,
    env: process.env,
  });
  if (!args.json && gateBefore.stdout.trim()) {
    console.error(gateBefore.stdout.trim());
  }
  if (gateBefore.code !== 0 && gateBefore.code !== 1) {
    if (gateBefore.stderr.trim()) console.error(gateBefore.stderr.trim());
    if (args.tolerateGateBlock) {
      emit({
        result: "gate_blocked",
        generation_id: manifest.generation_id,
        gate_exit: gateBefore.code,
        ...plan,
      });
      return;
    }
    console.error("publish-cloud-data-generation: cost gate blocked the publish"
      + ` (exit ${gateBefore.code}); rerun with --tolerate-gate-block to record-and-skip`);
    process.exit(3);
  }

  // Env for the live write, checked after the gate and before any write.
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const endpoint = process.env.DATA_PLANE_ENDPOINT;
  const writeKey = process.env.DATA_PLANE_WRITE_KEY;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
  const missing = [
    ["CLOUDFLARE_API_TOKEN", token],
    ["DATA_PLANE_ENDPOINT", endpoint],
    ["DATA_PLANE_WRITE_KEY", writeKey],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    console.error(`publish-cloud-data-generation: missing env ${missing.join(", ")} — no write attempted`);
    process.exit(2);
  }

  // 3. Publish through the REST R2 bridge + remote coordinator shim.
  const r2Bucket = createR2RestBucket({ accountId, bucket: R2_BUCKET, token });
  let objectsWritten = 0;
  const countingR2Bucket = {
    ...r2Bucket,
    async put(key, bytes) {
      await r2Bucket.put(key, bytes);
      objectsWritten += 1;
    },
  };
  const coordinatorNamespace = createRemoteCoordinatorNamespace({ endpoint, key: writeKey });
  const plane = createCloudflareCloudDataPlane({
    r2Bucket: countingR2Bucket,
    coordinatorNamespace,
  });
  const livePointer = await plane.pointerStore.get();
  const pointerSequenceBefore = livePointer?.sequence ?? 0;
  const resolved = await resolveExpectedPointerSequence({
    pointer: livePointer,
    manifest,
    objectStore: plane.objectStore,
  });
  const policy = {
    max_assets: family.policy.max_assets,
    max_total_bytes: family.policy.max_total_bytes,
    validate_freshness: () => true,
    validate_public_payload: () => true,
  };
  const published = await publishGeneration({
    manifest: resolved.manifest,
    payloads,
    expectedPointerSequence: resolved.expectedPointerSequence,
    objectStore: plane.objectStore,
    ledger: plane.ledger,
    pointerStore: plane.pointerStore,
    policy,
  });
  log(`${resolved.resume ? "resumed" : "published"} generation ${manifest.generation_id}:`
    + ` pointer ${pointerSequenceBefore} -> ${published.pointer.sequence},`
    + ` receipt ${published.receipt.receipt_id} (${published.receipt.state})`);

  // 4. Parity verification, resolved through the pointer ourselves.
  const parity = await verifyGenerationParity({
    pointerStore: plane.pointerStore,
    objectStore: plane.objectStore,
    payloads,
  });
  log(`byte parity ok: ${parity.assets}/${parity.assets} assets, ${parity.bytes} bytes`);

  // 5. Gate again after the write batch, then the single JSON summary line.
  const gateAfter = await runCostGate({ planClassA: 0, planBytes: 0, env: process.env });
  emit({
    result: resolved.resume ? "resumed" : "published",
    generation_id: manifest.generation_id,
    source_sha: manifest.source_sha,
    receipt_id: published.receipt.receipt_id,
    receipt_state: published.receipt.state,
    pointer_sequence_before: pointerSequenceBefore,
    pointer_sequence_after: published.pointer.sequence,
    ...plan,
    objects_written: objectsWritten,
    objects_already_present: plan.unique_object_keys - objectsWritten,
    parity: "ok",
    gate_before: gateVerdict(gateBefore),
    gate_after: gateVerdict(gateAfter),
  });
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error(`publish-cloud-data-generation: ${error.code ?? "ERROR"}: ${error.message}`);
    process.exit(1);
  }
}
