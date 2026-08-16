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

function fail(code, detail) {
  const error = new Error(`${code}:${detail}`);
  error.code = code;
  throw error;
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

export async function publishGeneration({
  manifest,
  payloads,
  expectedPointerSequence,
  objectStore,
  ledger,
  pointerStore,
  policy,
  now = () => new Date().toISOString(),
  receiptId = null,
}) {
  const summary = validateGenerationManifest(manifest);
  validatePublicationPolicy(policy, summary);
  nonnegativeInteger(expectedPointerSequence, "expectedPointerSequence");
  if (!(payloads instanceof Map)) fail("PUBLISH_INPUT_INVALID", "payloads must be a Map");
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
  if (recovered) return recovered;
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

  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const immutableObjectsByKey = new Map([
    ...manifest.assets.map((asset) => ({
      key: asset.object_key,
      bytes: payloads.get(asset.path),
      sha256: asset.sha256,
    })),
    {
      key: `manifests/${manifest.generation_id}.json`,
      bytes: manifestBytes,
      sha256: summary.manifest_sha256,
    },
  ].map((object) => [object.key, object]));
  // putIfAbsent result contract: { written, alreadyPresent }. When the
  // content-addressed object already exists byte-identically, the existence
  // path itself proved immutability, so the caller's immediate readback would
  // be a redundant GET and is skipped. A newly written object (or an adapter
  // that returns no result) still gets the immediate readback, and the final
  // post-promotion parity GET below stays mandatory for every asset.
  for (const object of immutableObjectsByKey.values()) {
    const outcome = await objectStore.putIfAbsent(object.key, object.bytes);
    if (outcome?.alreadyPresent !== true) {
      const stored = await objectStore.get(object.key);
      if (!(stored instanceof Uint8Array) || sha256Bytes(stored) !== object.sha256) {
        fail("OBJECT_READBACK_INVALID", object.key);
      }
    }
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
  return { pointer: nextPointer, receipt: promoted, summary };
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
  for (const asset of manifest.assets) {
    const payload = await objectStore.get(asset.object_key);
    if (
      !(payload instanceof Uint8Array)
      || payload.byteLength !== asset.bytes
      || sha256Bytes(payload) !== asset.sha256
    ) {
      fail("ROLLBACK_PAYLOAD_INVALID", asset.path);
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

export async function resolvePublicAsset({
  publicPath,
  pointerStore,
  objectStore,
}) {
  let normalized;
  try {
    normalized = normalizedPath(publicPath.replace(/^\/+/, ""), "publicPath");
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
    if (!asset || asset.privacy_class !== "public") return { kind: "not_enrolled" };
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
