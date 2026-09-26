import { createHash } from "node:crypto";

import { canonicalJson } from "./json-canonical.mjs";

export const GENERATION_MANIFEST_SCHEMA = "100x-cloud-data-generation/v1";
export const ACTIVE_POINTER_SCHEMA = "100x-cloud-data-pointer/v1";
export const PUBLICATION_RECEIPT_SCHEMA = "100x-cloud-data-publication-receipt/v1";

const SHA256 = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MIME_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i;
const PUBLIC_PREFIXES = Object.freeze(["public/data/", "public/generated/"]);
const PRIVATE_PREFIXES = Object.freeze(["data/"]);
export const DEFAULT_REMOTE_IO_CONCURRENCY = 8;
const PROGRESS_EVERY = 500;

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
}

// Keep remote I/O bounded without copying the task payloads into another
// collection. A failed task rejects the pool; workers already in flight may
// settle, but callers must not continue into their commit protocol.
export async function runBoundedAsyncPool(
  tasks,
  task,
  concurrency = DEFAULT_REMOTE_IO_CONCURRENCY,
) {
  if (
    !Number.isSafeInteger(concurrency)
    || concurrency < 1
    || concurrency > DEFAULT_REMOTE_IO_CONCURRENCY
  ) {
    fail("REMOTE_IO_CONCURRENCY_INVALID", String(concurrency));
  }
  if (typeof task !== "function") fail("REMOTE_IO_TASK_INVALID", "task must be a function");
  const iterator = tasks?.[Symbol.iterator]?.();
  if (!iterator) fail("REMOTE_IO_TASKS_INVALID", "tasks must be iterable");
  let failed = false;
  let firstFailure;
  const worker = async () => {
    while (true) {
      if (failed) return;
      let next;
      try {
        next = iterator.next();
        if (next.done) return;
        await task(next.value);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
        }
        return;
      }
    }
  };
  await Promise.allSettled(Array.from({ length: concurrency }, worker));
  if (failed) throw firstFailure;
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, context) {
  if (!plainObject(value)) fail("SCHEMA_INVALID", `${context} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (canonicalJson(actual) !== canonicalJson(wanted)) {
    fail("SCHEMA_INVALID", `${context} keys must be exactly ${wanted.join(",")}`);
  }
}

function safeId(value, context) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail("SCHEMA_INVALID", `${context} must be a safe identifier`);
  }
  return value;
}

function sha256Hex(value, context) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("SCHEMA_INVALID", `${context} must be a lowercase SHA-256`);
  }
  return value;
}

function nonnegativeInteger(value, context) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("SCHEMA_INVALID", `${context} must be a non-negative safe integer`);
  }
  return value;
}

function positiveInteger(value, context) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("SCHEMA_INVALID", `${context} must be a positive safe integer`);
  }
  return value;
}

function isoInstant(value, context) {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    fail("SCHEMA_INVALID", `${context} must be an ISO-8601 UTC instant`);
  }
  return value;
}

function isoDayOrNull(value, context) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail("SCHEMA_INVALID", `${context} must be an ISO day or null`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail("SCHEMA_INVALID", `${context} must be a real ISO day`);
  }
  return value;
}

function normalizedPath(value, context) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("\\")
    || value.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail("PATH_INVALID", `${context} must be a normalized relative path`);
  }
  return value;
}

function objectKey(value, expectedSha, context) {
  const key = normalizedPath(value, context);
  if (key !== `objects/sha256/${expectedSha}`) {
    fail("OBJECT_KEY_INVALID", `${context} must be content-addressed by asset SHA-256`);
  }
  return key;
}

function manifestKey(value, generationId, context) {
  const key = normalizedPath(value, context);
  if (key !== `manifests/${generationId}.json`) {
    fail("MANIFEST_KEY_INVALID", `${context} must match generation id`);
  }
  return key;
}

function allowedPrivacyPath(pathValue, privacyClass) {
  if (privacyClass === "public") {
    return PUBLIC_PREFIXES.some((prefix) => pathValue.startsWith(prefix));
  }
  if (privacyClass === "private") {
    return PRIVATE_PREFIXES.some((prefix) => pathValue.startsWith(prefix))
      && !PUBLIC_PREFIXES.some((prefix) => pathValue.startsWith(prefix));
  }
  return false;
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Canonical(value) {
  return sha256Bytes(canonicalJson(value));
}

export function validateGenerationManifest(value) {
  exactKeys(
    value,
    ["schema_version", "generation_id", "source_sha", "created_at", "assets"],
    "generation manifest",
  );
  if (value.schema_version !== GENERATION_MANIFEST_SCHEMA) {
    fail("SCHEMA_INVALID", `generation manifest schema must be ${GENERATION_MANIFEST_SCHEMA}`);
  }
  const generationId = safeId(value.generation_id, "generation_id");
  sha256Hex(value.source_sha, "source_sha");
  isoInstant(value.created_at, "created_at");
  if (!Array.isArray(value.assets) || value.assets.length === 0) {
    fail("SCHEMA_INVALID", "assets must be a non-empty array");
  }
  const seenPaths = new Set();
  let previousPath = null;
  for (const [index, asset] of value.assets.entries()) {
    exactKeys(
      asset,
      ["path", "object_key", "sha256", "bytes", "content_type", "source_as_of", "privacy_class"],
      `assets[${index}]`,
    );
    const assetPath = normalizedPath(asset.path, `assets[${index}].path`);
    if (seenPaths.has(assetPath)) fail("PATH_DUPLICATE", assetPath);
    if (previousPath !== null && previousPath.localeCompare(assetPath) >= 0) {
      fail("MANIFEST_ORDER_INVALID", "assets must be sorted by path");
    }
    seenPaths.add(assetPath);
    previousPath = assetPath;
    const assetSha = sha256Hex(asset.sha256, `assets[${index}].sha256`);
    objectKey(asset.object_key, assetSha, `assets[${index}].object_key`);
    nonnegativeInteger(asset.bytes, `assets[${index}].bytes`);
    if (typeof asset.content_type !== "string" || !MIME_TYPE.test(asset.content_type)) {
      fail("SCHEMA_INVALID", `assets[${index}].content_type must be a MIME type`);
    }
    isoDayOrNull(asset.source_as_of, `assets[${index}].source_as_of`);
    if (!allowedPrivacyPath(assetPath, asset.privacy_class)) {
      fail("PRIVACY_PATH_INVALID", `${asset.privacy_class}:${assetPath}`);
    }
  }
  return {
    generation_id: generationId,
    manifest_sha256: sha256Canonical(value),
    asset_count: value.assets.length,
    total_bytes: value.assets.reduce((sum, asset) => sum + asset.bytes, 0),
  };
}

function validatePointerTarget(value, context) {
  exactKeys(value, ["generation_id", "manifest_key", "manifest_sha256"], context);
  const generationId = safeId(value.generation_id, `${context}.generation_id`);
  manifestKey(value.manifest_key, generationId, `${context}.manifest_key`);
  sha256Hex(value.manifest_sha256, `${context}.manifest_sha256`);
  return value;
}

export function validateActivePointer(value) {
  exactKeys(
    value,
    [
      "schema_version",
      "sequence",
      "active",
      "previous",
      "source_sha",
      "prepared_receipt_id",
      "promoted_at",
    ],
    "active pointer",
  );
  if (value.schema_version !== ACTIVE_POINTER_SCHEMA) {
    fail("SCHEMA_INVALID", `active pointer schema must be ${ACTIVE_POINTER_SCHEMA}`);
  }
  positiveInteger(value.sequence, "sequence");
  validatePointerTarget(value.active, "active");
  if (value.previous !== null) validatePointerTarget(value.previous, "previous");
  if (value.previous?.generation_id === value.active.generation_id) {
    fail("POINTER_INVALID", "active and previous generation must differ");
  }
  sha256Hex(value.source_sha, "source_sha");
  safeId(value.prepared_receipt_id, "prepared_receipt_id");
  isoInstant(value.promoted_at, "promoted_at");
  return value;
}

export function validatePublicationReceipt(value) {
  exactKeys(
    value,
    [
      "schema_version",
      "receipt_id",
      "operation",
      "state",
      "generation_id",
      "manifest_sha256",
      "source_sha",
      "expected_pointer_sequence",
      "created_at",
      "promoted_pointer_sequence",
    ],
    "publication receipt",
  );
  if (value.schema_version !== PUBLICATION_RECEIPT_SCHEMA) {
    fail("SCHEMA_INVALID", `publication receipt schema must be ${PUBLICATION_RECEIPT_SCHEMA}`);
  }
  safeId(value.receipt_id, "receipt_id");
  if (value.operation !== "publish" && value.operation !== "rollback") {
    fail("SCHEMA_INVALID", "receipt operation must be publish or rollback");
  }
  if (value.state !== "prepared" && value.state !== "promoted") {
    fail("SCHEMA_INVALID", "receipt state must be prepared or promoted");
  }
  safeId(value.generation_id, "generation_id");
  sha256Hex(value.manifest_sha256, "manifest_sha256");
  sha256Hex(value.source_sha, "source_sha");
  nonnegativeInteger(value.expected_pointer_sequence, "expected_pointer_sequence");
  isoInstant(value.created_at, "created_at");
  if (value.state === "prepared" && value.promoted_pointer_sequence !== null) {
    fail("RECEIPT_INVALID", "prepared receipt cannot have a promoted sequence");
  }
  if (value.state === "promoted") {
    positiveInteger(value.promoted_pointer_sequence, "promoted_pointer_sequence");
  }
  return value;
}

function bytesEqual(left, right) {
  const leftBytes = left instanceof Uint8Array ? left : new Uint8Array(left);
  const rightBytes = right instanceof Uint8Array ? right : new Uint8Array(right);
  return leftBytes.length === rightBytes.length
    && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

function pointerTarget(manifest, manifestSha256) {
  return {
    generation_id: manifest.generation_id,
    manifest_key: `manifests/${manifest.generation_id}.json`,
    manifest_sha256: manifestSha256,
  };
}

function deterministicReceiptId(operation, manifestSha256, expectedPointerSequence) {
  return `${operation}-${expectedPointerSequence}-${manifestSha256.slice(0, 32)}`;
}

function samePointerTarget(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function receiptMatchesPointer(receipt, receiptId, pointer, expectedPointerSequence, operation) {
  if (!receipt) return false;
  validatePublicationReceipt(receipt);
  return receipt.receipt_id === receiptId
    && receipt.operation === operation
    && receipt.expected_pointer_sequence === expectedPointerSequence
    && receipt.generation_id === pointer.active.generation_id
    && receipt.manifest_sha256 === pointer.active.manifest_sha256
    && receipt.source_sha === pointer.source_sha
    && (
      receipt.state === "prepared"
      || receipt.promoted_pointer_sequence === pointer.sequence
    );
}

function validatePublicationPolicy(policy, summary) {
  exactKeys(
    policy,
    ["max_assets", "max_total_bytes", "validate_freshness", "validate_public_payload"],
    "publication policy",
  );
  positiveInteger(policy.max_assets, "publication policy max_assets");
  positiveInteger(policy.max_total_bytes, "publication policy max_total_bytes");
  if (typeof policy.validate_freshness !== "function") {
    fail("PUBLICATION_POLICY_INVALID", "validate_freshness must be a function");
  }
  if (typeof policy.validate_public_payload !== "function") {
    fail("PUBLICATION_POLICY_INVALID", "validate_public_payload must be a function");
  }
  if (summary.asset_count > policy.max_assets || summary.total_bytes > policy.max_total_bytes) {
    fail("PUBLICATION_BUDGET_EXCEEDED", `${summary.asset_count}:${summary.total_bytes}`);
  }
}

async function finalizeOrResumePromotion({
  manifest,
  summary,
  expectedPointerSequence,
  receiptId,
  ledger,
  pointerStore,
}) {
  const pointer = await pointerStore.get();
  const receipt = await ledger.get(receiptId);
  const target = pointerTarget(manifest, summary.manifest_sha256);
  if (pointer?.sequence === expectedPointerSequence + 1) validateActivePointer(pointer);
  if (
    pointer?.sequence === expectedPointerSequence + 1
    && pointer.prepared_receipt_id === receiptId
    && pointer.source_sha === manifest.source_sha
    && samePointerTarget(pointer.active, target)
    && receiptMatchesPointer(receipt, receiptId, pointer, expectedPointerSequence, "publish")
    && receipt?.state === "prepared"
  ) {
    const promoted = {
      ...receipt,
      state: "promoted",
      promoted_pointer_sequence: pointer.sequence,
    };
    validatePublicationReceipt(promoted);
    await ledger.markPromoted(promoted);
    return { pointer, receipt: promoted, summary };
  }
  if (
    pointer?.sequence === expectedPointerSequence + 1
    && pointer.prepared_receipt_id === receiptId
    && pointer.source_sha === manifest.source_sha
    && samePointerTarget(pointer.active, target)
    && receiptMatchesPointer(receipt, receiptId, pointer, expectedPointerSequence, "publish")
    && receipt?.state === "promoted"
  ) {
    return { pointer, receipt, summary };
  }
  return null;
}

async function finalizeAdvancedPointer({
  expectedPointerSequence,
  receiptId,
  ledger,
  pointerStore,
}) {
  const pointer = await pointerStore.get();
  if (pointer?.sequence !== expectedPointerSequence + 1) return null;
  validateActivePointer(pointer);
  const effectiveReceiptId = receiptId ?? pointer.prepared_receipt_id;
  if (pointer.prepared_receipt_id !== effectiveReceiptId) return null;
  const receipt = await ledger.get(effectiveReceiptId);
  if (!receiptMatchesPointer(
    receipt,
    effectiveReceiptId,
    pointer,
    expectedPointerSequence,
    "rollback",
  )) return null;
  if (receipt.state === "promoted") return { pointer, receipt };
  const promoted = {
    ...receipt,
    state: "promoted",
    promoted_pointer_sequence: pointer.sequence,
  };
  validatePublicationReceipt(promoted);
  await ledger.markPromoted(promoted);
  return { pointer, receipt: promoted };
}

function validateReusableObjects(reusableObjects, manifest) {
  if (reusableObjects === null) return new Map();
  if (!(reusableObjects instanceof Map)) {
    fail("PUBLISH_REUSE_INVALID", "reusableObjects must be a Map or null");
  }
  const manifestBytesByKey = new Map();
  for (const asset of manifest.assets) {
    const prior = manifestBytesByKey.get(asset.object_key);
    if (prior !== undefined && prior !== asset.bytes) {
      fail("PUBLISH_REUSE_INVALID", `${asset.object_key} has inconsistent manifest lengths`);
    }
    manifestBytesByKey.set(asset.object_key, asset.bytes);
  }
  const validated = new Map();
  for (const [key, bytes] of reusableObjects) {
    if (!manifestBytesByKey.has(key)) {
      fail("PUBLISH_REUSE_INVALID", `${key} is not a payload object in the manifest`);
    }
    if (!Number.isInteger(bytes) || bytes < 0 || manifestBytesByKey.get(key) !== bytes) {
      fail("PUBLISH_REUSE_INVALID", `${key} byte length does not match the manifest`);
    }
    validated.set(key, bytes);
  }
  return validated;
}

// Reuse is derived inside the shared contract so a caller cannot skip remote
// objects by supplying an arbitrary key/length map. Every object outside this
// proof is byte-compared or written and read back before pointer promotion, so
// a promoted generation never depends on a later payload-parity step.
export async function planActiveGenerationReuse({ pointer, manifest, objectStore }) {
  validateGenerationManifest(manifest);
  if (!pointer) return new Map();
  validateActivePointer(pointer);
  const basis = pointer.active;
  const basisManifestBytes = await objectStore.get(basis.manifest_key);
  if (
    !(basisManifestBytes instanceof Uint8Array)
    || sha256Bytes(basisManifestBytes) !== basis.manifest_sha256
  ) {
    fail("REUSE_BASIS_MANIFEST_INTEGRITY", basis.manifest_key);
  }
  let basisManifest;
  try {
    basisManifest = JSON.parse(new TextDecoder().decode(basisManifestBytes));
  } catch {
    fail("REUSE_BASIS_MANIFEST_INTEGRITY", basis.manifest_key);
  }
  const basisSummary = validateGenerationManifest(basisManifest);
  if (
    basisSummary.generation_id !== basis.generation_id
    || basisSummary.manifest_sha256 !== basis.manifest_sha256
    || (basis === pointer.active && basisManifest.source_sha !== pointer.source_sha)
  ) {
    fail("REUSE_BASIS_MANIFEST_CROSS_BIND", basis.manifest_key);
  }
  const basisBytesByKey = new Map(
    basisManifest.assets.map((asset) => [asset.object_key, asset.bytes]),
  );
  const listedBytesByKey = new Map();
  for (const entry of await objectStore.list()) {
    listedBytesByKey.set(entry.key, entry.bytes);
  }
  const reusableObjects = new Map();
  for (const asset of manifest.assets) {
    if (
      basisBytesByKey.get(asset.object_key) === asset.bytes
      && listedBytesByKey.get(asset.object_key) === asset.bytes
    ) {
      reusableObjects.set(asset.object_key, asset.bytes);
    }
  }
  return reusableObjects;
}

export function planGenerationObjectWrites(manifest, reusableObjects = new Map()) {
  validateGenerationManifest(manifest);
  const reusable = validateReusableObjects(reusableObjects, manifest);
  const pending = new Map(manifest.assets
    .filter((asset) => !reusable.has(asset.object_key))
    .map((asset) => [asset.object_key, asset.bytes]));
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest)).byteLength;
  const bytes = [...pending.values()].reduce((sum, value) => sum + value, manifestBytes);
  return { bytes, objects: pending.size + 1, reused_objects: reusable.size };
}

function publicationVerification(manifest, reusableObjects, resumed = false) {
  if (resumed) {
    const reusedAssets = manifest.assets
      .filter((asset) => reusableObjects.has(asset.object_key)).length;
    return {
      verifiedObjects: new Map(reusableObjects),
      body_verified_assets: 0,
      body_verified_objects: 0,
      reused_assets: reusedAssets,
      reused_objects: reusableObjects.size,
    };
  }
  const verifiedObjects = new Map(
    manifest.assets.map((asset) => [asset.object_key, asset.bytes]),
  );
  const reusedAssets = manifest.assets
    .filter((asset) => reusableObjects.has(asset.object_key)).length;
  const bodyVerifiedObjects = new Set(
    manifest.assets
      .filter((asset) => !reusableObjects.has(asset.object_key))
      .map((asset) => asset.object_key),
  ).size;
  return {
    verifiedObjects,
    body_verified_assets: manifest.assets.length - reusedAssets,
    body_verified_objects: bodyVerifiedObjects,
    reused_assets: reusedAssets,
    reused_objects: reusableObjects.size,
  };
}

export async function publishGeneration({
  manifest,
  payloads,
  reuseActiveGeneration = false,
  maxObjectWriteBytes = null,
  expectedPointerSequence,
  objectStore,
  ledger,
  pointerStore,
  policy,
  now = () => new Date().toISOString(),
  receiptId = null,
  // Optional progress hook for the object write pool: onProgress({done, total})
  // fires every PROGRESS_EVERY objects and once at completion. The pool itself
  // stays silent; callers that run under a job timeout wire this to stderr so
  // a slow-but-healthy publish is distinguishable from a stall.
  onProgress = null,
}) {
  const summary = validateGenerationManifest(manifest);
  validatePublicationPolicy(policy, summary);
  nonnegativeInteger(expectedPointerSequence, "expectedPointerSequence");
  if (!(payloads instanceof Map)) fail("PUBLISH_INPUT_INVALID", "payloads must be a Map");
  if (typeof reuseActiveGeneration !== "boolean") {
    fail("PUBLISH_REUSE_INVALID", "reuseActiveGeneration must be boolean");
  }
  if (maxObjectWriteBytes !== null) nonnegativeInteger(maxObjectWriteBytes, "maxObjectWriteBytes");
  const id = safeId(
    receiptId ?? deterministicReceiptId("publish", summary.manifest_sha256, expectedPointerSequence),
    "publication receipt id",
  );
  const recovered = await finalizeOrResumePromotion({
    manifest,
    summary,
    expectedPointerSequence,
    receiptId: id,
    ledger,
    pointerStore,
  });
  if (recovered) {
    const reusableObjects = reuseActiveGeneration
      ? await planActiveGenerationReuse({ pointer: recovered.pointer, manifest, objectStore })
      : null;
    const verification = reuseActiveGeneration
      ? publicationVerification(manifest, reusableObjects, true)
      : null;
    return { ...recovered, summary, reusableObjects, verification };
  }
  const currentPointer = await pointerStore.get();
  if ((currentPointer?.sequence ?? 0) !== expectedPointerSequence) {
    fail("STALE_WRITER", `expected pointer sequence ${expectedPointerSequence}`);
  }
  if (currentPointer) validateActivePointer(currentPointer);

  for (const asset of manifest.assets) {
    const payload = payloads.get(asset.path);
    if (!(payload instanceof Uint8Array)) fail("PAYLOAD_MISSING", asset.path);
    if (payload.byteLength !== asset.bytes || sha256Bytes(payload) !== asset.sha256) {
      fail("PAYLOAD_INTEGRITY_INVALID", asset.path);
    }
    if (await policy.validate_freshness(asset) !== true) {
      fail("FRESHNESS_POLICY_REJECTED", asset.path);
    }
    if (
      asset.privacy_class === "public"
      && await policy.validate_public_payload({ asset, bytes: new Uint8Array(payload) }) !== true
    ) {
      fail("PUBLIC_PAYLOAD_REJECTED", asset.path);
    }
  }

  const reusableObjects = reuseActiveGeneration
    ? await planActiveGenerationReuse({ pointer: currentPointer, manifest, objectStore })
    : null;
  const validatedReusableObjects = validateReusableObjects(reusableObjects, manifest);

  // Recompute from the live proof immediately before the first object write.
  // A disappearing object or changed listing must not exceed the gated budget.
  const objectWritePlan = planGenerationObjectWrites(manifest, validatedReusableObjects);
  if (maxObjectWriteBytes !== null && objectWritePlan.bytes > maxObjectWriteBytes) {
    fail("PUBLISH_WRITE_BUDGET_EXCEEDED", "live object writes exceed the approved preflight byte budget");
  }

  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const immutableObjectsByKey = new Map(
    manifest.assets
      .filter((asset) => !validatedReusableObjects.has(asset.object_key))
      .map((asset) => ({
        key: asset.object_key,
        bytes: payloads.get(asset.path),
        sha256: asset.sha256,
      }))
      .map((object) => [object.key, object]),
  );
  const totalImmutableObjects = immutableObjectsByKey.size + 1; // payloads + manifest
  // The generation manifest is written FIRST, before any payload object (fh-465).
  // The manifest is the retention-visible record of this generation's references:
  // from the first payload write onward the generation is its family's newest, so
  // every reused (possibly old) object it names is inside the retained window and
  // a concurrent retention sweep can no longer collect a blob this publish reuses.
  // While the manifest raced inside the payload pool, a receipt-less and
  // manifest-less window existed in which exactly that could happen.
  const manifestObjectKey = `manifests/${manifest.generation_id}.json`;
  {
    const outcome = await objectStore.putIfAbsent(manifestObjectKey, manifestBytes);
    if (outcome?.alreadyPresent !== true) {
      const stored = await objectStore.get(manifestObjectKey);
      if (!(stored instanceof Uint8Array) || sha256Bytes(stored) !== summary.manifest_sha256) {
        fail("OBJECT_READBACK_INVALID", manifestObjectKey);
      }
    }
  }
  let publishedObjectCount = 1; // the manifest is the first durable object
  // putIfAbsent result contract: { written, alreadyPresent }. When the
  // content-addressed object already exists byte-identically, the existence
  // path itself proved immutability, so the caller's immediate readback would
  // be a redundant GET and is skipped. A newly written object (or an adapter
  // that returns no result) still gets the immediate readback. Callers may
  // omit only objects backed by a validated active-generation presence and
  // length proof; final parity body-checks every object outside that proof.
  await runBoundedAsyncPool(immutableObjectsByKey.values(), async (object) => {
    const outcome = await objectStore.putIfAbsent(object.key, object.bytes);
    if (outcome?.alreadyPresent !== true) {
      const stored = await objectStore.get(object.key);
      if (!(stored instanceof Uint8Array) || sha256Bytes(stored) !== object.sha256) {
        fail("OBJECT_READBACK_INVALID", object.key);
      }
    }
    if (onProgress) {
      publishedObjectCount += 1;
      if (publishedObjectCount % PROGRESS_EVERY === 0) {
        onProgress({ done: publishedObjectCount, total: totalImmutableObjects });
      }
    }
  });
  if (onProgress) {
    onProgress({ done: publishedObjectCount, total: totalImmutableObjects });
  }

  const prepared = {
    schema_version: PUBLICATION_RECEIPT_SCHEMA,
    receipt_id: id,
    operation: "publish",
    state: "prepared",
    generation_id: manifest.generation_id,
    manifest_sha256: summary.manifest_sha256,
    source_sha: manifest.source_sha,
    expected_pointer_sequence: expectedPointerSequence,
    created_at: isoInstant(now(), "publication time"),
    promoted_pointer_sequence: null,
  };
  validatePublicationReceipt(prepared);
  await ledger.prepare(prepared);
  const nextPointer = {
    schema_version: ACTIVE_POINTER_SCHEMA,
    sequence: expectedPointerSequence + 1,
    active: pointerTarget(manifest, summary.manifest_sha256),
    previous: currentPointer?.active ?? null,
    source_sha: manifest.source_sha,
    prepared_receipt_id: id,
    promoted_at: isoInstant(now(), "promotion time"),
  };
  validateActivePointer(nextPointer);
  await pointerStore.compareAndSwap(expectedPointerSequence, nextPointer);
  const readBack = await pointerStore.get();
  if (canonicalJson(readBack) !== canonicalJson(nextPointer)) {
    fail("POINTER_READBACK_INVALID", manifest.generation_id);
  }
  const promoted = {
    ...prepared,
    state: "promoted",
    promoted_pointer_sequence: nextPointer.sequence,
  };
  validatePublicationReceipt(promoted);
  await ledger.markPromoted(promoted);
  const verification = reuseActiveGeneration
    ? publicationVerification(manifest, validatedReusableObjects)
    : null;
  return { pointer: nextPointer, receipt: promoted, summary, reusableObjects, verification };
}

export async function rollbackGeneration({
  expectedPointerSequence,
  objectStore,
  ledger,
  pointerStore,
  now = () => new Date().toISOString(),
  receiptId = null,
}) {
  positiveInteger(expectedPointerSequence, "expectedPointerSequence");
  const recovered = await finalizeAdvancedPointer({
    expectedPointerSequence,
    receiptId,
    ledger,
    pointerStore,
  });
  if (recovered) {
    return {
      ...recovered,
      summary: {
        generation_id: recovered.pointer.active.generation_id,
        manifest_sha256: recovered.pointer.active.manifest_sha256,
      },
    };
  }
  const current = await pointerStore.get();
  if (!current || current.sequence !== expectedPointerSequence) {
    fail("STALE_WRITER", `expected pointer sequence ${expectedPointerSequence}`);
  }
  validateActivePointer(current);
  if (!current.previous) fail("ROLLBACK_TARGET_MISSING", "pointer has no previous generation");
  const storedManifest = await objectStore.get(current.previous.manifest_key);
  if (
    !(storedManifest instanceof Uint8Array)
    || sha256Bytes(storedManifest) !== current.previous.manifest_sha256
  ) {
    fail("ROLLBACK_MANIFEST_INVALID", current.previous.generation_id);
  }
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder().decode(storedManifest));
  } catch {
    fail("ROLLBACK_MANIFEST_INVALID", current.previous.generation_id);
  }
  const summary = validateGenerationManifest(manifest);
  if (
    summary.generation_id !== current.previous.generation_id
    || summary.manifest_sha256 !== current.previous.manifest_sha256
  ) {
    fail("ROLLBACK_MANIFEST_INVALID", current.previous.generation_id);
  }
  // Presence and declared length, from one listing, instead of a body read per
  // asset. Keys are content-addressed and the manifest was verified above, so
  // the digest every asset is SUPPOSED to have is already known; what a listing
  // cannot restate is that the stored bytes still hash to it. That residual is
  // R2 storage integrity, which the parity gate proved for this generation at
  // publish time and which retention cannot undo, since pointer.previous is
  // never a collection candidate. Re-reading every payload to restate it cost
  // more than the rollback job's own timeout allowed.
  const listedBytesByKey = new Map();
  for (const entry of await objectStore.list()) {
    listedBytesByKey.set(entry.key, entry.bytes);
  }
  for (const asset of manifest.assets) {
    if (!listedBytesByKey.has(asset.object_key)) {
      fail("ROLLBACK_PAYLOAD_INVALID", `${asset.path} (object not listed)`);
    }
    const listedBytes = listedBytesByKey.get(asset.object_key);
    if (listedBytes !== asset.bytes) {
      fail(
        "ROLLBACK_PAYLOAD_INVALID",
        `${asset.path} (listed ${listedBytes} bytes, manifest declares ${asset.bytes})`,
      );
    }
  }

  const id = safeId(
    receiptId ?? deterministicReceiptId("rollback", summary.manifest_sha256, expectedPointerSequence),
    "rollback receipt id",
  );
  const prepared = {
    schema_version: PUBLICATION_RECEIPT_SCHEMA,
    receipt_id: id,
    operation: "rollback",
    state: "prepared",
    generation_id: current.previous.generation_id,
    manifest_sha256: current.previous.manifest_sha256,
    source_sha: manifest.source_sha,
    expected_pointer_sequence: expectedPointerSequence,
    created_at: isoInstant(now(), "rollback time"),
    promoted_pointer_sequence: null,
  };
  validatePublicationReceipt(prepared);
  await ledger.prepare(prepared);
  const nextPointer = {
    schema_version: ACTIVE_POINTER_SCHEMA,
    sequence: expectedPointerSequence + 1,
    active: current.previous,
    previous: current.active,
    source_sha: manifest.source_sha,
    prepared_receipt_id: id,
    promoted_at: isoInstant(now(), "rollback promotion time"),
  };
  validateActivePointer(nextPointer);
  await pointerStore.compareAndSwap(expectedPointerSequence, nextPointer);
  const readBack = await pointerStore.get();
  if (canonicalJson(readBack) !== canonicalJson(nextPointer)) {
    fail("POINTER_READBACK_INVALID", manifest.generation_id);
  }
  const promoted = {
    ...prepared,
    state: "promoted",
    promoted_pointer_sequence: nextPointer.sequence,
  };
  await ledger.markPromoted(promoted);
  return { pointer: nextPointer, receipt: promoted, summary };
}

export async function resolveGenerationAsset({
  assetPath,
  expectedPrivacyClass,
  pointerStore,
  objectStore,
}) {
  if (expectedPrivacyClass !== "public" && expectedPrivacyClass !== "private") {
    return { kind: "unavailable", reason: "PRIVACY_CLASS_INVALID" };
  }
  let normalized;
  try {
    normalized = normalizedPath(assetPath.replace(/^\/+/, ""), "assetPath");
  } catch (error) {
    return { kind: "unavailable", reason: error.code ?? "PATH_INVALID" };
  }
  try {
    const pointer = await pointerStore.get();
    if (!pointer) return { kind: "unavailable", reason: "ACTIVE_POINTER_UNAVAILABLE" };
    validateActivePointer(pointer);
    const manifestBytes = await objectStore.get(pointer.active.manifest_key);
    if (
      !(manifestBytes instanceof Uint8Array)
      || sha256Bytes(manifestBytes) !== pointer.active.manifest_sha256
    ) {
      return { kind: "unavailable", reason: "MANIFEST_INTEGRITY_UNAVAILABLE" };
    }
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const summary = validateGenerationManifest(manifest);
    if (
      summary.generation_id !== pointer.active.generation_id
      || summary.manifest_sha256 !== pointer.active.manifest_sha256
      || manifest.source_sha !== pointer.source_sha
    ) {
      return { kind: "unavailable", reason: "MANIFEST_CROSS_BIND_INVALID" };
    }
    const asset = manifest.assets.find((entry) => entry.path === normalized);
    if (!asset || asset.privacy_class !== expectedPrivacyClass) return { kind: "not_enrolled" };
    const payload = await objectStore.get(asset.object_key);
    if (
      !(payload instanceof Uint8Array)
      || payload.byteLength !== asset.bytes
      || sha256Bytes(payload) !== asset.sha256
    ) {
      return { kind: "unavailable", reason: "PAYLOAD_INTEGRITY_UNAVAILABLE" };
    }
    return {
      kind: "ok",
      bytes: payload,
      content_type: asset.content_type,
      source_as_of: asset.source_as_of,
      generation_id: manifest.generation_id,
      published_at: manifest.created_at,
    };
  } catch {
    return { kind: "unavailable", reason: "DATA_PLANE_INTEGRITY_UNAVAILABLE" };
  }
}

export async function resolvePublicAsset({
  publicPath,
  pointerStore,
  objectStore,
}) {
  return resolveGenerationAsset({
    assetPath: publicPath,
    expectedPrivacyClass: "public",
    pointerStore,
    objectStore,
  });
}

export function createMemoryCloudDataPlane() {
  const objects = new Map();
  const receipts = new Map();
  let pointer = null;
  return {
    objectStore: {
      async putIfAbsent(key, bytes) {
        const prior = objects.get(key);
        if (prior && !bytesEqual(prior, bytes)) fail("IMMUTABILITY_VIOLATION", key);
        if (!prior) {
          objects.set(key, new Uint8Array(bytes));
          return { written: true, alreadyPresent: false };
        }
        return { written: false, alreadyPresent: true };
      },
      async get(key) {
        const value = objects.get(key);
        return value ? new Uint8Array(value) : null;
      },
      async list() {
        return [...objects.entries()].map(([key, value]) => ({ key, bytes: value.byteLength }));
      },
    },
    ledger: {
      async prepare(receipt) {
        validatePublicationReceipt(receipt);
        const prior = receipts.get(receipt.receipt_id);
        if (prior && canonicalJson(prior) !== canonicalJson(receipt)) {
          fail("RECEIPT_CONFLICT", receipt.receipt_id);
        }
        receipts.set(receipt.receipt_id, structuredClone(receipt));
      },
      async markPromoted(receipt) {
        validatePublicationReceipt(receipt);
        const prior = receipts.get(receipt.receipt_id);
        if (!prior || prior.state !== "prepared") fail("RECEIPT_NOT_PREPARED", receipt.receipt_id);
        receipts.set(receipt.receipt_id, structuredClone(receipt));
      },
      async get(receiptId) {
        return receipts.has(receiptId) ? structuredClone(receipts.get(receiptId)) : null;
      },
    },
    pointerStore: {
      async get() {
        return pointer ? structuredClone(pointer) : null;
      },
      async compareAndSwap(expectedSequence, nextPointer) {
        const actualSequence = pointer?.sequence ?? 0;
        if (actualSequence !== expectedSequence) fail("STALE_WRITER", `${expectedSequence}:${actualSequence}`);
        validateActivePointer(nextPointer);
        if (nextPointer.sequence !== expectedSequence + 1) {
          fail("POINTER_SEQUENCE_INVALID", `${expectedSequence}:${nextPointer.sequence}`);
        }
        pointer = structuredClone(nextPointer);
      },
    },
    inspect() {
      return {
        object_keys: [...objects.keys()].sort(),
        receipts: [...receipts.values()].map(structuredClone),
        pointer: pointer ? structuredClone(pointer) : null,
      };
    },
  };
}
