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
// Crash recovery: resolveExpectedPointerSequence also stabilizes a retry of an
// interrupted publish. If the manifest object for this generation is already
// stored (written before the crash) it is adopted verbatim so putIfAbsent
// stays byte-identical, and if the deterministic receipt id already exists in
// state "prepared" its created_at is reused as the publish `now` so
// ledger.prepare stays byte-identical (the contract rejects a same-id receipt
// with different bytes as RECEIPT_CONFLICT).
//
// Chaos drills (--chaos=<mode>, explicit opt-in only):
//   stale-sequence      publish with expectedPointerSequence one behind the
//                       live pointer; the contract's STALE_WRITER must surface
//                       and the pointer must not advance.
//   abort-after-prepare inject CHAOS_ABORT_AFTER_PREPARE from a pointerStore
//                       wrapper whose compareAndSwap throws before delegating,
//                       simulating a crash after ledger.prepare; the pointer
//                       must not advance and the receipt stays "prepared". An
//                       unchanged re-run then resumes the same receipt_id and
//                       advances the pointer exactly once (see above).
//
// Rollback (--rollback): restore the pointer's previous generation through the
// contract's rollbackGeneration. The live pointer is read first and the mode
// refuses with ROLLBACK_TARGET_MISSING unless previous is non-null; the live
// sequence is passed as expectedPointerSequence. Rollback moves the sequence
// FORWARD (never rewinds) and writes no objects — only the coordinator ledger
// and pointer change. The JSON summary reports the sequence and both
// generation ids before and after.
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
  rollbackGeneration,
  sha256Bytes,
  sha256Canonical,
  validateGenerationManifest,
  validatePublicationReceipt,
} from "./lib/cloud-data-plane-generation.mjs";
import { createCloudflareCloudDataPlane } from "./lib/cloud-data-plane-cloudflare-adapter.mjs";
import { createR2RestBucket } from "./lib/cloud-data-plane-r2-rest.mjs";
import { createRemoteCoordinatorNamespace } from "./lib/cloud-data-plane-remote-coordinator.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const GATE_SCRIPT = path.join(REPO_ROOT, "scripts", "check-r2-free-tier-usage.mjs");
const R2_BUCKET = "fenok-data-plane";
const DEFAULT_ACCOUNT_ID = "aeeb5ea3affe55a2219d08ea02dad9e1";

// Family descriptor table. Fields:
//   root             filesystem location of the source file(s), repo-relative
//   manifest_prefix  logical asset path prefix in the plane (defaults to root;
//                    must satisfy the contract's privacy prefixes: "data/" for
//                    private, "public/data/" or "public/generated/" for public)
//   files            explicit enrollment list (defaults to walking the whole
//                    root tree); paths are relative to root
//   privacy_class    "private" or "public" (contract-enforced against prefix)
//   plan             cost-gate declaration, >= 2x the real spend
//   policy           contract publication policy budgets
//   validate_public_payload  required for public families: the contract calls
//                    it on every public asset before writing
// P5+ adds more families here.
export const FAMILIES = {
  "oecd-cli": {
    root: "data/admin/oecd_cli",
    privacy_class: "private",
    // Gate declaration: >= 2x the measured 4 PutObject / 592,351 bytes.
    plan: { class_a: 40, bytes: 1_200_000 },
    policy: { max_assets: 64, max_total_bytes: 16_000_000 },
  },
  "fred-macro": {
    // Source lives under 100xfenok-next (READ ONLY — the standing prohibition
    // on editing 100xfenok-next/** is unaffected; it is only read as the
    // publish source) while the manifest path uses the contract's public
    // prefix, so root and manifest_prefix are deliberately different strings.
    root: "100xfenok-next/public/data/macro",
    manifest_prefix: "public/data/macro",
    files: ["fred-macro.json"],
    privacy_class: "public",
    // Gate declaration: >= 2x the measured 1 PutObject / 530,240 bytes.
    plan: { class_a: 10, bytes: 1_100_000 },
    policy: { max_assets: 8, max_total_bytes: 4_000_000 },
    validate_public_payload({ bytes }) {
      const value = JSON.parse(new TextDecoder().decode(bytes));
      return !Object.keys(value).some((key) => /token|secret|password|cookie/i.test(key));
    },
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
// privacy prefixes, e.g. "data/" for private, "public/data/" for public).
// Deterministic in content: identical file bytes always yield the same
// generation_id. Enrollment is the explicit files argument, else the family
// descriptor's files list, else a recursive walk of absRoot.
export async function buildFamilyManifest({
  familyName,
  absRoot,
  relRoot,
  files: explicitFiles = null,
  now = () => new Date().toISOString(),
}) {
  const family = FAMILIES[familyName];
  if (!family) fail("FAMILY_UNKNOWN", familyName);
  const enrolled = explicitFiles ?? family.files ?? null;
  const files = (enrolled ?? await walkFiles(absRoot))
    .sort((left, right) => left.localeCompare(right));
  if (files.length === 0) fail("FAMILY_EMPTY", absRoot);
  const payloads = new Map();
  const assets = [];
  for (const relative of files) {
    if (relative.startsWith("/") || relative.includes("\\") || relative.split("/").includes("..")) {
      fail("FAMILY_FILE_INVALID", relative);
    }
    let bytes;
    try {
      bytes = new Uint8Array(await readFile(path.join(absRoot, relative)));
    } catch (error) {
      fail("FAMILY_FILE_MISSING", `${relative} under ${absRoot} (${error.code ?? error.message})`);
    }
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

// The contract's deterministic publish receipt id for a given manifest and
// expected sequence (mirrors deterministicReceiptId in the byte-locked
// contract, which is not exported). Stable across retries of the same logical
// publish as long as the manifest bytes are.
export function deterministicPublishReceiptId({ manifest, expectedPointerSequence }) {
  const summary = validateGenerationManifest(manifest);
  return `publish-${expectedPointerSequence}-${summary.manifest_sha256.slice(0, 32)}`;
}

// Drift guard for the mirror above. Crash-retry depends on the locally
// computed receipt id matching the contract's format; if the contract's
// format ever changes, the ledger lookup would silently miss and crash-retry
// would quietly stop working. Called after every successful publishGeneration
// with the receipt the contract actually returned; a mismatch is a loud
// RECEIPT_ID_DRIFT failure, never a silent fallthrough.
export function assertPublishReceiptId({ manifest, expectedPointerSequence, receipt }) {
  const computed = deterministicPublishReceiptId({ manifest, expectedPointerSequence });
  if (receipt?.receipt_id !== computed) {
    fail(
      "RECEIPT_ID_DRIFT",
      `contract returned receipt_id ${receipt?.receipt_id ?? "<none>"}`
        + ` but deterministic computation gives ${computed}`,
    );
  }
  return computed;
}

// Decide the expectedPointerSequence for publishGeneration from the live
// pointer. Normal case: the live sequence (or 0 when no pointer exists).
// Resume case: the pointer already targets this exact generation, so we adopt
// the STORED manifest (byte-identical to what the pointer binds, including the
// original created_at) and pass sequence - 1; the contract then resumes the
// existing receipt through finalizeOrResumePromotion without advancing.
//
// Crash-retry stabilization (both cases): when the manifest object for this
// generation is already stored and binds the same source_sha, it is adopted
// verbatim so a rebuilt manifest with a fresh created_at cannot collide with
// the immutability guard. When the deterministic receipt id for the resolved
// sequence already exists in the ledger (a previous attempt crashed between
// ledger.prepare and compareAndSwap), its created_at is returned as
// resumeCreatedAt so the retried receipt is byte-identical and prepare stays
// idempotent. Without a prior interrupted attempt nothing changes. Because
// crash-retry leans on a local mirror of the contract's (unexported) receipt
// id format, every successful publish is followed by a drift guard
// (assertPublishReceiptId) that fails loudly with RECEIPT_ID_DRIFT if the
// contract's returned receipt_id and the mirror ever diverge.
export async function resolveExpectedPointerSequence({
  pointer,
  manifest,
  objectStore,
  ledger = null,
}) {
  const alreadyActive = pointer
    && pointer.active.generation_id === manifest.generation_id
    && pointer.source_sha === manifest.source_sha;
  const manifestKey = alreadyActive
    ? pointer.active.manifest_key
    : `manifests/${manifest.generation_id}.json`;
  const storedBytes = await objectStore.get(manifestKey);
  let effectiveManifest = manifest;
  if (storedBytes instanceof Uint8Array) {
    if (alreadyActive && sha256Bytes(storedBytes) !== pointer.active.manifest_sha256) {
      fail("STORED_MANIFEST_INTEGRITY", manifestKey);
    }
    const storedManifest = JSON.parse(new TextDecoder().decode(storedBytes));
    const storedSummary = validateGenerationManifest(storedManifest);
    if (
      storedSummary.manifest_sha256 !== sha256Bytes(storedBytes)
      || storedSummary.generation_id !== manifest.generation_id
      || storedManifest.source_sha !== manifest.source_sha
    ) {
      fail("STORED_MANIFEST_CROSS_BIND", manifestKey);
    }
    effectiveManifest = storedManifest;
  } else if (alreadyActive) {
    fail("STORED_MANIFEST_MISSING", manifestKey);
  }
  if (alreadyActive) {
    return {
      manifest: effectiveManifest,
      expectedPointerSequence: pointer.sequence - 1,
      resume: true,
      resumeCreatedAt: null,
    };
  }
  const expectedPointerSequence = pointer?.sequence ?? 0;
  let resumeCreatedAt = null;
  if (ledger) {
    const receiptId = deterministicPublishReceiptId({
      manifest: effectiveManifest,
      expectedPointerSequence,
    });
    const prior = await ledger.get(receiptId);
    if (prior) {
      validatePublicationReceipt(prior);
      const summary = validateGenerationManifest(effectiveManifest);
      if (
        prior.operation !== "publish"
        || prior.generation_id !== effectiveManifest.generation_id
        || prior.manifest_sha256 !== summary.manifest_sha256
        || prior.source_sha !== effectiveManifest.source_sha
        || prior.expected_pointer_sequence !== expectedPointerSequence
      ) {
        fail("RECEIPT_CROSS_BIND", receiptId);
      }
      resumeCreatedAt = prior.created_at;
    }
  }
  return {
    manifest: effectiveManifest,
    expectedPointerSequence,
    resume: false,
    resumeCreatedAt,
  };
}

// Chaos drills, injected only through the publisher's own --chaos flag.
export const CHAOS_MODES = Object.freeze(["stale-sequence", "abort-after-prepare"]);

// stale-sequence: publish with an expectedPointerSequence one behind the live
// pointer value. The contract re-reads the pointer and fails STALE_WRITER
// before any object write or ledger mutation.
export function chaosExpectedPointerSequence({ chaos, pointerSequence, resolved }) {
  if (chaos !== "stale-sequence") return resolved;
  if (!Number.isSafeInteger(pointerSequence) || pointerSequence < 1) {
    fail("CHAOS_PRECONDITION", "stale-sequence requires a live pointer with sequence >= 1");
  }
  return pointerSequence - 1;
}

// abort-after-prepare: wrap the pointerStore so compareAndSwap throws before
// delegating, simulating a crash after ledger.prepare returned. The CAS never
// crosses the wire; the receipt stays in state "prepared".
export function chaosPointerStore({ chaos, pointerStore }) {
  if (chaos !== "abort-after-prepare") return pointerStore;
  return {
    ...pointerStore,
    async compareAndSwap() {
      fail("CHAOS_ABORT_AFTER_PREPARE", "injected crash after ledger.prepare, before compareAndSwap");
    },
  };
}

// Rollback the active pointer to its previous generation via the contract's
// rollbackGeneration. The live pointer is read first and the call is refused
// with ROLLBACK_TARGET_MISSING (the contract's own code for this case) unless
// previous is non-null, so a refusal never reaches a write. The live sequence
// is passed as expectedPointerSequence; rollback moves the sequence forward
// and touches only the coordinator ledger and pointer — no object writes.
export async function rollbackLiveGeneration({
  objectStore,
  ledger,
  pointerStore,
  now,
}) {
  const pointer = await pointerStore.get();
  if (!pointer) {
    fail("ROLLBACK_TARGET_MISSING", "no active pointer — nothing to roll back");
  }
  if (!pointer.previous) {
    fail("ROLLBACK_TARGET_MISSING", "pointer has no previous generation — rollback refused before any write");
  }
  const result = await rollbackGeneration({
    expectedPointerSequence: pointer.sequence,
    objectStore,
    ledger,
    pointerStore,
    now,
  });
  return { pointerBefore: pointer, ...result };
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
  const args = {
    family: null, dryRun: false, json: false, tolerateGateBlock: false, chaos: null, rollback: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--tolerate-gate-block") args.tolerateGateBlock = true;
    else if (arg === "--rollback") args.rollback = true;
    else if (arg.startsWith("--chaos=")) {
      const mode = arg.slice("--chaos=".length);
      if (!CHAOS_MODES.includes(mode)) fail("ARGS_INVALID", `unknown chaos mode ${mode}`);
      args.chaos = mode;
    } else fail("ARGS_INVALID", arg);
  }
  if (!args.family) fail("ARGS_INVALID", "--family=<name> is required");
  if (args.rollback && args.chaos) fail("ARGS_INVALID", "--rollback cannot be combined with --chaos");
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
    relRoot: family.manifest_prefix ?? family.root,
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
      // Explicit-enrollment families also list each enrolled asset; tree
      // families (oecd-cli) keep the original summary shape byte-identical.
      ...(family.files
        ? {
          enrolled: manifest.assets.map((asset) => ({
            path: asset.path,
            bytes: asset.bytes,
            privacy_class: asset.privacy_class,
          })),
        }
        : {}),
      planned_class_a: family.plan.class_a,
      planned_bytes: family.plan.bytes,
      gate: "not_run",
    });
    return;
  }

  // 2. Cost gate (declares >= 2x the real spend) before any write. Rollback
  // touches only the coordinator (no object writes), so it declares a small
  // but still generous plan.
  const gatePlan = args.rollback ? { class_a: 10, bytes: 0 } : family.plan;
  const gateBefore = await runCostGate({
    planClassA: gatePlan.class_a,
    planBytes: gatePlan.bytes,
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
        mode: args.rollback ? "rollback" : "publish",
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

  // Rollback mode: pointer-only change through the contract's
  // rollbackGeneration; the summary records the sequence and both generation
  // ids before and after, because rollback moves the sequence FORWARD.
  if (args.rollback) {
    const plane = createCloudflareCloudDataPlane({
      r2Bucket: createR2RestBucket({ accountId, bucket: R2_BUCKET, token }),
      coordinatorNamespace: createRemoteCoordinatorNamespace({ endpoint, key: writeKey }),
    });
    const rolled = await rollbackLiveGeneration({
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: plane.pointerStore,
    });
    const pointerAfter = await plane.pointerStore.get();
    const gateAfter = await runCostGate({ planClassA: 0, planBytes: 0, env: process.env });
    emit({
      result: "rolled_back",
      receipt_id: rolled.receipt.receipt_id,
      receipt_state: rolled.receipt.state,
      pointer_sequence_before: rolled.pointerBefore.sequence,
      pointer_sequence_after: pointerAfter?.sequence ?? null,
      active_generation_before: rolled.pointerBefore.active.generation_id,
      previous_generation_before: rolled.pointerBefore.previous?.generation_id ?? null,
      active_generation_after: pointerAfter?.active.generation_id ?? null,
      previous_generation_after: pointerAfter?.previous?.generation_id ?? null,
      objects_written: 0,
      gate_before: gateVerdict(gateBefore),
      gate_after: gateVerdict(gateAfter),
    });
    return;
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
    ledger: plane.ledger,
  });
  if (args.chaos === "stale-sequence" && resolved.resume) {
    fail("CHAOS_PRECONDITION", "stale-sequence needs a generation the pointer does not already target");
  }
  const expectedForPublish = chaosExpectedPointerSequence({
    chaos: args.chaos,
    pointerSequence: pointerSequenceBefore,
    resolved: resolved.expectedPointerSequence,
  });
  const publishPointerStore = chaosPointerStore({
    chaos: args.chaos,
    pointerStore: plane.pointerStore,
  });
  const policy = {
    max_assets: family.policy.max_assets,
    max_total_bytes: family.policy.max_total_bytes,
    validate_freshness: () => true,
    // The contract invokes this on every public asset before writing;
    // public families must provide a real validator in the descriptor.
    validate_public_payload: family.validate_public_payload ?? (() => true),
  };
  let published;
  try {
    published = await publishGeneration({
      manifest: resolved.manifest,
      payloads,
      expectedPointerSequence: expectedForPublish,
      objectStore: plane.objectStore,
      ledger: plane.ledger,
      pointerStore: publishPointerStore,
      policy,
      now: resolved.resumeCreatedAt ? () => resolved.resumeCreatedAt : undefined,
    });
  } catch (error) {
    if (args.chaos === "stale-sequence" && error.code === "STALE_WRITER") {
      const pointerNow = await plane.pointerStore.get();
      const gateAfter = await runCostGate({ planClassA: 0, planBytes: 0, env: process.env });
      emit({
        result: "chaos_stale_writer",
        chaos: args.chaos,
        error_code: error.code,
        generation_id: manifest.generation_id,
        attempted_expected_sequence: expectedForPublish,
        pointer_sequence_before: pointerSequenceBefore,
        pointer_sequence_after: pointerNow?.sequence ?? 0,
        gate_before: gateVerdict(gateBefore),
        gate_after: gateVerdict(gateAfter),
      });
      return;
    }
    if (args.chaos === "abort-after-prepare" && error.code === "CHAOS_ABORT_AFTER_PREPARE") {
      const receiptId = deterministicPublishReceiptId({
        manifest: resolved.manifest,
        expectedPointerSequence: resolved.expectedPointerSequence,
      });
      const receipt = await plane.ledger.get(receiptId);
      const pointerNow = await plane.pointerStore.get();
      const gateAfter = await runCostGate({ planClassA: 0, planBytes: 0, env: process.env });
      emit({
        result: "chaos_abort_after_prepare",
        chaos: args.chaos,
        error_code: error.code,
        generation_id: manifest.generation_id,
        receipt_id: receiptId,
        receipt_state: receipt?.state ?? null,
        pointer_sequence_before: pointerSequenceBefore,
        pointer_sequence_after: pointerNow?.sequence ?? 0,
        gate_before: gateVerdict(gateBefore),
        gate_after: gateVerdict(gateAfter),
      });
      return;
    }
    throw error;
  }
  // Drift guard (only reached on a successful publish): the receipt id the
  // contract actually returned must equal our deterministic mirror of its
  // format. A mismatch means the contract's format changed and crash-retry
  // would silently miss — fail loudly before any summary claims success.
  assertPublishReceiptId({
    manifest: resolved.manifest,
    expectedPointerSequence: expectedForPublish,
    receipt: published.receipt,
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
