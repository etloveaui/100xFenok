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
// Per-family coordinators: publish, chaos and rollback talk to the family's
// OWN coordinator Durable Object instance; retention (bucket-level) talks to
// EVERY family's instance. The family name is passed as coordinatorName to the
// adapter and as the x-data-plane-family header through the remote shim; the
// worker route selects the instance by that header. One family can never
// displace another's active generation. Cutover is clean: each family restarts
// at sequence 0 in its own instance, the legacy shared instance keeps its
// history, and
// content-addressed objects make the first republish a no-op for the bucket.
//
// Retention (--retention, dry-run by default; --retention-delete for real
// deletion): collect objects/sha256/* payloads that NO retained manifest of
// ANY family references. Pointers and receipts are PER FAMILY (each family has
// its own coordinator instance, its own sequence and its own ledger), so the
// retained set is computed per family — the 3 newest generations of that
// family by created_at, that family's pointer active AND previous entries
// (non-negotiable, that is the family's rollback target), and that family's
// generations named by receipts still in state "prepared" — and then unioned.
// The OBJECT STORE stays shared and content-addressed, so the reference scan
// is the union across families: an object referenced by a retained manifest of
// family A survives even if the only other referencing generation belongs to
// family B and is otherwise collectable. Every manifest in the bucket is read,
// parsed and validated; ANY unreadable or corrupt manifest — or a retained
// generation whose manifest is missing — aborts the whole run with
// RETENTION_REFERENCE_SET_INCOMPLETE and ZERO deletions. Retention is
// BUCKET-LEVEL: it scans every family's own coordinator instance (pointer +
// prepared receipts) and rejects --family outright; a family that fails to
// answer aborts with RETENTION_FAMILY_UNREADABLE and ZERO deletions. Manifest
// keys, pointer keys, probe/* and the explicit RETENTION_PROTECTED_KEYS (the
// six keys the owner rule names: five P1 evidence objects + probe/lag.json)
// are never candidates. The dry run emits one JSON line listing every
// candidate with key, size and the reason it is unreferenced; real deletion
// additionally requires --retention-delete. The cost gate runs first in both
// modes even though DeleteObject is free on the free tier.
//
// Migration semantics (per-family coordinators): CLEAN CUTOVER. Both families
// restart at sequence 0 in their own instances; the legacy shared instance
// keeps its history untouched; objects are content-addressed, so the first
// republish into a fresh family instance writes nothing — putIfAbsent finds
// every payload already present and only the coordinator ledger and pointer
// change.
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

// --- retention ----------------------------------------------------------------
//
// computeRetentionPlan is a pure planner: it takes a bucket listing, every
// manifest body, and each family's pointer + prepared-but-unpromoted
// generation names, and decides exactly which objects/sha256/* keys may be
// deleted. Pointers/receipts are per family; the object store is shared, so
// the retained set is per family while the reference union is cross-family.
// It never touches the network, which is what makes the mandated retention
// cases testable offline.

// Keys retention must never collect, whatever the reference scan says.
// MEMBERSHIP RULE (owner mandate): exactly the five P1 live-pilot evidence
// objects and probe/lag.json are protected, and nothing else. A protected key
// needs an owner-named reason to be added — "we were not sure" is not one, and
// the list must never grow by default because an object being collected when
// nothing references it is the system working. Content-addressed probe objects
// (including our Step-0 probe) are deliberately NOT protected.
export const RETENTION_PROTECTED_KEYS = Object.freeze(new Set([
  "manifests/r2-live-pilot-1.json",
  "objects/sha256/32098e38aa809da54d44ca13df2c9031b259c14a1b600a0ef4b5fec7ca65ad8b",
  "objects/sha256/3d55e186eefcfdfd546005031b443221212eb4081b8c7ec279f135a657e531eb",
  "objects/sha256/7893ece3ecba0b3bea4ee13c4d780524f71e8e07f324d918a3c5c2b0c6544946",
  "objects/sha256/c612b423798aa69c3e5bc971d20c9352f11ff41ef8c84cca4d38938a5550e288",
  "probe/lag.json",
]));

export const RETENTION_KEEP_NEWEST = 3;
export const RETENTION_OBJECT_PREFIX = "objects/";
const GENERATION_MANIFEST_KEY = /^manifests\/.+-[0-9a-f]{16}\.json$/;

// manifestEntries: [{key, text|null}] for every manifests/* key in the bucket
// (text null when the object could not be read). objectEntries: [{key, size}]
// for every key in the bucket listing. families: [{ name, pointer,
// preparedGenerations }] — one entry per family, with THAT family's live
// pointer (or null) and the generation ids named by THAT family's receipts in
// state "prepared".
//
// Retained set, PER FAMILY: the keepNewest newest generation manifests of the
// family by created_at, the family's pointer active AND previous generation
// (non-negotiable — the family's rollback target), and the family's prepared-
// but-unpromoted generations. The reference union is then CROSS-FAMILY because
// the object store is shared: an object referenced by any retained manifest of
// any family survives.
//
// Returns { keepNewest, retainedGenerations, retainedByFamily, referencedKeys,
// candidates, skippedProtected, manifestCount }. candidates are
// [{key, size, reason}] sorted by key — the ONLY keys deletion may touch.
// Throws RETENTION_REFERENCE_SET_INCOMPLETE (before any deletion can happen)
// when any manifest is unreadable/corrupt or a retained generation has no
// manifest.
export function computeRetentionPlan({
  families = [],
  manifestEntries = [],
  objectEntries = [],
  keepNewest = RETENTION_KEEP_NEWEST,
  protectedKeys = RETENTION_PROTECTED_KEYS,
}) {
  const generationManifests = []; // [{key, manifest, family}]
  const nonGenerationManifests = []; // aliases / legacy keys: always retained
  for (const entry of manifestEntries) {
    let manifest = null;
    if (typeof entry.text === "string") {
      try {
        manifest = JSON.parse(entry.text);
      } catch {
        manifest = null;
      }
    }
    if (manifest === null) {
      fail("RETENTION_REFERENCE_SET_INCOMPLETE", `${entry.key}: unreadable or not JSON`);
    }
    try {
      validateGenerationManifest(manifest);
    } catch (error) {
      fail("RETENTION_REFERENCE_SET_INCOMPLETE", `${entry.key}: ${error.message}`);
    }
    if (GENERATION_MANIFEST_KEY.test(entry.key) && `manifests/${manifest.generation_id}.json` === entry.key) {
      generationManifests.push({
        key: entry.key,
        manifest,
        family: manifest.generation_id.slice(0, -17), // strip "-<hex16>"
      });
    } else {
      nonGenerationManifests.push({ key: entry.key, manifest });
    }
  }

  const familyStateByName = new Map(families.map((state) => [state.name, state]));
  const familyNames = new Set([
    ...generationManifests.map((entry) => entry.family),
    ...families.map((state) => state.name),
  ]);

  // Newest-N window per family, by created_at (ISO strings sort
  // lexicographically); generation_id breaks ties for determinism.
  const retainedIds = new Set();
  const retainedByFamily = {};
  for (const familyName of [...familyNames].sort()) {
    const ids = new Set();
    const ranked = generationManifests
      .filter((entry) => entry.family === familyName)
      .sort((left, right) => {
        if (left.manifest.created_at !== right.manifest.created_at) {
          return left.manifest.created_at < right.manifest.created_at ? 1 : -1;
        }
        return left.manifest.generation_id < right.manifest.generation_id ? 1 : -1;
      });
    for (const entry of ranked.slice(0, keepNewest)) ids.add(entry.manifest.generation_id);
    const state = familyStateByName.get(familyName);
    for (const id of [
      state?.pointer?.active?.generation_id,
      state?.pointer?.previous?.generation_id,
      ...(state?.preparedGenerations ?? []),
    ]) {
      if (id) ids.add(id);
    }
    retainedByFamily[familyName] = [...ids].sort();
    for (const id of ids) retainedIds.add(id);
  }

  const byGenerationId = new Map(
    generationManifests.map((entry) => [entry.manifest.generation_id, entry.manifest]),
  );
  const retainedManifests = [];
  for (const id of retainedIds) {
    const manifest = byGenerationId.get(id);
    if (!manifest) {
      fail("RETENTION_REFERENCE_SET_INCOMPLETE", `retained generation ${id} has no readable manifest`);
    }
    retainedManifests.push(manifest);
  }
  retainedManifests.push(...nonGenerationManifests.map((entry) => entry.manifest));

  const referencedKeys = new Set();
  for (const manifest of retainedManifests) {
    for (const asset of manifest.assets) referencedKeys.add(asset.object_key);
  }
  // Non-retained manifests still explain WHY a candidate is unreferenced.
  const referencingNonRetained = new Map(); // object_key -> [generation_id]
  for (const { manifest } of generationManifests) {
    if (retainedIds.has(manifest.generation_id)) continue;
    for (const asset of manifest.assets) {
      const list = referencingNonRetained.get(asset.object_key) ?? [];
      list.push(manifest.generation_id);
      referencingNonRetained.set(asset.object_key, list);
    }
  }

  const candidates = [];
  const skippedProtected = [];
  for (const { key, size } of objectEntries) {
    if (protectedKeys.has(key)) {
      skippedProtected.push(key);
      continue;
    }
    if (!key.startsWith(RETENTION_OBJECT_PREFIX)) continue; // manifests, pointers, probe/*: never collected
    if (referencedKeys.has(key)) continue;
    const nonRetained = referencingNonRetained.get(key);
    candidates.push({
      key,
      size: size ?? null,
      reason: nonRetained
        ? `referenced only by non-retained generation(s): ${nonRetained.sort().join(", ")}`
        : "orphaned: no manifest in the bucket references this object",
    });
  }
  candidates.sort((left, right) => left.key.localeCompare(right.key));
  skippedProtected.sort();

  return {
    keepNewest,
    retainedGenerations: [...retainedIds].sort(),
    retainedByFamily,
    referencedKeys: [...referencedKeys].sort(),
    candidates,
    skippedProtected,
    manifestCount: generationManifests.length + nonGenerationManifests.length,
  };
}

// Bucket-level family scan for retention: every family answers with its OWN
// coordinator instance's pointer and prepared-but-unpromoted receipts. A
// family that fails to answer aborts the whole run — an unreadable family is
// indistinguishable from one with no live generations, and guessing wrong
// deletes production data. Success with pointer null (family never published)
// is a legitimate answer and contributes nothing to the retained set.
export async function collectFamiliesRetentionState({ families, createPlane }) {
  const states = [];
  for (const name of families) {
    let inspection;
    try {
      inspection = await createPlane(name).inspect();
    } catch (error) {
      fail(
        "RETENTION_FAMILY_UNREADABLE",
        `${name}: ${error.code ?? "ERROR"}: ${error.message}`,
      );
    }
    const preparedGenerations = [...new Set((inspection?.receipts ?? [])
      .filter((receipt) => receipt?.state === "prepared")
      .map((receipt) => receipt.generation_id)
      .filter(Boolean))].sort();
    states.push({
      name,
      pointer: inspection?.pointer ?? null,
      preparedGenerations,
    });
  }
  return states;
}

// Execute an approved plan through an injected deleter (REST live, recording
// stub in tests). Individual delete failures never throw; they are collected
// so one bad key cannot strand the rest of the batch.
export async function executeRetentionPlan({ plan, deleteObject }) {
  const deleted = [];
  const failures = [];
  for (const candidate of plan.candidates) {
    const outcome = await deleteObject(candidate.key);
    if (outcome?.ok === false) {
      failures.push({ key: candidate.key, size: candidate.size, error: outcome.error ?? "delete failed" });
    } else {
      deleted.push({ key: candidate.key, size: candidate.size });
    }
  }
  return { deleted, failures };
}

// Exit evidence: resolve the active generation through the pointer and compare
// every asset byte-for-byte against the files read from disk.
export async function verifyGenerationParity({ pointerStore, objectStore, payloads }) {  const pointer = await pointerStore.get();
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

// --- retention REST helpers ---------------------------------------------------
// createR2RestBucket (byte-locked lib) maps list() to keys only and has no
// delete; retention needs key+size and DeleteObject, so these two helpers talk
// to the same account-level REST endpoint directly, mirroring the lib's retry
// policy (never retry 4xx; network/5xx get 3 attempts with backoff).
const R2_API_BASE = "https://api.cloudflare.com/client/v4/accounts";
const R2_REST_MAX_ATTEMPTS = 3;
const R2_REST_BACKOFF_BASE_MS = 200;

async function r2DataPlaneRequest({ accountId, bucket, token, fetchImpl, method, keyPath, query }) {
  const base = `${R2_API_BASE}/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucket)}/objects`;
  const url = `${base}${keyPath ? `/${encodeURIComponent(keyPath)}` : ""}${query ?? ""}`;
  let lastError = null;
  for (let attempt = 1; attempt <= R2_REST_MAX_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, { method, headers: { Authorization: `Bearer ${token}` } });
    } catch (error) {
      lastError = error;
      if (attempt < R2_REST_MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, R2_REST_BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      }
      continue;
    }
    if (response.status >= 500 && attempt < R2_REST_MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, R2_REST_BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      continue;
    }
    return response;
  }
  fail("R2_REST_NETWORK", lastError?.message ?? "request failed without a response");
}

// Full bucket listing with sizes (the retention report's per-object size).
export async function listR2ObjectsDetailed({ accountId, bucket, token, fetchImpl = fetch }) {
  const objects = [];
  let cursor;
  do {
    const query = `?per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const response = await r2DataPlaneRequest({
      accountId, bucket, token, fetchImpl, method: "GET", query,
    });
    if (!response.ok) {
      fail("R2_REST_HTTP", `list http ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    const body = await response.json();
    if (!body?.success) {
      fail("R2_REST_HTTP", `list envelope not successful: ${JSON.stringify(body?.errors ?? null)}`);
    }
    for (const object of body.result ?? []) {
      objects.push({ key: object.key, size: object.size ?? null });
    }
    cursor = body?.result_info?.cursor || undefined;
  } while (cursor);
  return objects;
}

// DeleteObject for one key. 404 means the key is already gone, which satisfies
// retention's intent, so it counts as ok. Never throws on an HTTP answer —
// returns {ok:false, error} so executeRetentionPlan can record the failure.
export async function deleteR2Object({ accountId, bucket, token, key, fetchImpl = fetch }) {
  try {
    const response = await r2DataPlaneRequest({
      accountId, bucket, token, fetchImpl, method: "DELETE", keyPath: key,
    });
    if (response.ok || response.status === 404) return { ok: true };
    return { ok: false, error: `http ${response.status}: ${(await response.text()).slice(0, 500)}` };
  } catch (error) {
    return { ok: false, error: `${error.code ?? "ERROR"}: ${error.message}` };
  }
}

function parseArgs(argv) {
  const args = {
    family: null, dryRun: false, json: false, tolerateGateBlock: false, chaos: null, rollback: false,
    retention: false, retentionDelete: false,
  };
  for (const arg of argv) {
    if (arg.startsWith("--family=")) args.family = arg.slice("--family=".length);
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--tolerate-gate-block") args.tolerateGateBlock = true;
    else if (arg === "--rollback") args.rollback = true;
    else if (arg === "--retention") args.retention = true;
    else if (arg === "--retention-delete") args.retentionDelete = true;
    else if (arg.startsWith("--chaos=")) {
      const mode = arg.slice("--chaos=".length);
      if (!CHAOS_MODES.includes(mode)) fail("ARGS_INVALID", `unknown chaos mode ${mode}`);
      args.chaos = mode;
    } else fail("ARGS_INVALID", arg);
  }
  if (!args.retention && !args.family) fail("ARGS_INVALID", "--family=<name> is required");
  if (args.retention && args.family) {
    fail("ARGS_INVALID", "--retention is bucket-level and accepts no --family (the named-family invocation is unsafe)");
  }
  if (args.rollback && args.chaos) fail("ARGS_INVALID", "--rollback cannot be combined with --chaos");
  if (args.retentionDelete && !args.retention) {
    fail("ARGS_INVALID", "--retention-delete requires --retention (dry-run is the default)");
  }
  if (args.retention && (args.chaos || args.rollback)) {
    fail("ARGS_INVALID", "--retention cannot be combined with --chaos or --rollback");
  }
  return args;
}

// Bucket-level retention: dry-run by default. Reads EVERY family's own
// coordinator instance (pointer + prepared receipts), unions the newest-3
// windows across all of them, and collects only objects/sha256/* keys no
// retained manifest of ANY family references. Any family that fails to answer,
// any unreadable manifest, or any retained generation with no manifest aborts
// with zero deletions (RETENTION_REFERENCE_SET_INCOMPLETE /
// RETENTION_FAMILY_UNREADABLE). DeleteObject is free on the free tier, so the
// gate still runs first with a small declaration. --family is deliberately not
// accepted anywhere on this path.
async function runRetention({ tolerateGateBlock, retentionDelete, json }) {
  const log = (line) => {
    if (!json) console.error(line);
  };
  const emit = (summary) => console.log(JSON.stringify(summary));

  const gateBefore = await runCostGate({ planClassA: 10, planBytes: 0, env: process.env });
  if (gateBefore.stdout.trim()) log(gateBefore.stdout.trim());
  if (gateBefore.code !== 0 && gateBefore.code !== 1) {
    if (gateBefore.stderr.trim()) console.error(gateBefore.stderr.trim());
    if (tolerateGateBlock) {
      emit({ result: "gate_blocked", mode: "retention", gate_exit: gateBefore.code });
      return;
    }
    console.error("publish-cloud-data-generation: cost gate blocked the retention run"
      + ` (exit ${gateBefore.code}); rerun with --tolerate-gate-block to record-and-skip`);
    process.exit(3);
  }

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

  const r2Bucket = createR2RestBucket({ accountId, bucket: R2_BUCKET, token });
  // Every family answers from its OWN coordinator instance (the worker route
  // selects it by the x-data-plane-family header). An unreadable family aborts
  // the whole run inside collectFamiliesRetentionState.
  const familiesState = await collectFamiliesRetentionState({
    families: Object.keys(FAMILIES).sort(),
    createPlane: (name) => createCloudflareCloudDataPlane({
      r2Bucket,
      coordinatorNamespace: createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family: name }),
      coordinatorName: name,
    }),
  });
  const readObject = async (key) => {
    const entry = await r2Bucket.get(key);
    if (entry === null) return null;
    return new Uint8Array(await entry.arrayBuffer());
  };
  const objectEntries = await listR2ObjectsDetailed({ accountId, bucket: R2_BUCKET, token });
  const manifestEntries = [];
  for (const { key } of objectEntries) {
    if (!key.startsWith("manifests/")) continue;
    const bytes = await readObject(key);
    manifestEntries.push({
      key,
      text: bytes instanceof Uint8Array ? new TextDecoder().decode(bytes) : null,
    });
  }
  const retentionPlan = computeRetentionPlan({
    families: familiesState,
    manifestEntries,
    objectEntries,
  });
  const report = {
    result: retentionDelete ? "retention_deleted" : "retention_dry_run",
    scope: "bucket-level",
    families_scanned: familiesState.map((state) => state.name),
    keep_newest: retentionPlan.keepNewest,
    manifests_read: retentionPlan.manifestCount,
    retained_generations: retentionPlan.retainedGenerations,
    prepared_generations: [...new Set(familiesState.flatMap((state) => state.preparedGenerations))].sort(),
    referenced_object_count: retentionPlan.referencedKeys.length,
    protected_keys_present: retentionPlan.skippedProtected,
    candidate_count: retentionPlan.candidates.length,
    candidate_bytes: retentionPlan.candidates.reduce((total, candidate) => total + (candidate.size ?? 0), 0),
    candidates: retentionPlan.candidates,
    gate_before: gateVerdict(gateBefore),
  };
  if (retentionDelete) {
    const executed = await executeRetentionPlan({
      plan: retentionPlan,
      deleteObject: (key) => deleteR2Object({ accountId, bucket: R2_BUCKET, token, key }),
    });
    report.deleted = executed.deleted;
    report.deleted_count = executed.deleted.length;
    report.delete_failures = executed.failures;
    emit(report);
    if (executed.failures.length > 0) {
      fail("RETENTION_DELETE_FAILED", `${executed.failures.length} object(s) could not be deleted`);
    }
    return;
  }
  emit(report); // dry-run: zero deletions, always exit 0
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = (...parts) => {
    if (!args.json) console.error(...parts);
  };
  const emit = (summary) => console.log(JSON.stringify(summary));

  // Retention is bucket-level, not family-level: it scans EVERY family and
  // deliberately accepts no --family (parseArgs rejects the combination).
  if (args.retention) {
    return runRetention({
      tolerateGateBlock: args.tolerateGateBlock,
      retentionDelete: args.retentionDelete,
      json: args.json,
    });
  }

  const family = FAMILIES[args.family];
  if (!family) {
    console.error(`publish-cloud-data-generation: unknown family ${args.family}`
      + ` (known: ${Object.keys(FAMILIES).join(", ")})`);
    process.exit(2);
  }

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

  if (args.dryRun && !args.retention) {
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
  // touches only the coordinator (DeleteObject is free on the free tier, so
  // retention declares a small but still generous plan) — the gate runs first
  // in every mode.
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
        mode: args.rollback ? "rollback" : (args.retention ? "retention" : "publish"),
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
      coordinatorNamespace: createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family: args.family }),
      coordinatorName: args.family,
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
  const coordinatorNamespace = createRemoteCoordinatorNamespace({ endpoint, key: writeKey, family: args.family });
  const plane = createCloudflareCloudDataPlane({
    r2Bucket: countingR2Bucket,
    coordinatorNamespace,
    coordinatorName: args.family,
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
