import { createHash } from "node:crypto";
import { WIND_DOWN_PROFILE_MANIFEST_STORAGE_KEY } from "./windDownPagedStorage";

export const WINDDOWN_RECOVERY_SCHEMA_VERSION = 1 as const;
export const WINDDOWN_RECOVERY_KIND = "winddown-coordinator-recovery-snapshot" as const;
export const WINDDOWN_RECOVERY_MAX_BYTES = 5 * 1024 * 1024;
// A sealed copy contains a receipt and seal in addition to the downloadable
// snapshot envelope. Keep that verification scan bounded without rejecting a
// valid snapshot whose envelope is close to the logical transport limit.
export const WINDDOWN_RECOVERY_TARGET_SCAN_OVERHEAD_BYTES = 64 * 1024;
export const WINDDOWN_RECOVERY_DEFAULT_PAGE_SIZE = 100;
export const WINDDOWN_RECOVERY_MAX_PAGE_SIZE = 1_000;

export const WINDDOWN_RECOVERY_PROFILE_STORAGE_KEY = "mona-vnext-learning-profile";
export const WINDDOWN_RECOVERY_PROFILE_KV_KEY =
  "data/mona-vnext/owner-test/learning-profile.json";

// Every key in this namespace is owned by this module and is rejected when it
// arrives in an uploaded snapshot. Recovery metadata is written only after
// the source records have been committed in the target transaction.
export const WINDDOWN_RECOVERY_INTERNAL_PREFIX = "winddown-recovery:";
export const WINDDOWN_RECOVERY_SEAL_KEY = `${WINDDOWN_RECOVERY_INTERNAL_PREFIX}seal:v1`;
export const WINDDOWN_RECOVERY_RECEIPT_KEY = `${WINDDOWN_RECOVERY_INTERNAL_PREFIX}receipt:v1`;
export const WINDDOWN_RECOVERY_LEGACY_COPY_PREFIX = `${WINDDOWN_RECOVERY_INTERNAL_PREFIX}legacy:`;
export const WINDDOWN_RECOVERY_LEGACY_CHUNK_MAX_CODE_UNITS = 64 * 1024;
export const WINDDOWN_RECOVERY_LEGACY_CHUNK_MAX_JSON_BYTES = 512 * 1024;
export const WINDDOWN_RECOVERY_LEGACY_CHUNK_SUFFIX = ":chunk:";

export type WindDownRecoveryListOptions = {
  limit?: number;
  startAfter?: string;
  prefix?: string;
  reverse?: boolean;
};

export type WindDownRecoveryStorageTransaction = {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  list(options?: WindDownRecoveryListOptions): Promise<Map<string, unknown>>;
};

export type WindDownRecoveryStorage = WindDownRecoveryStorageTransaction & {
  transaction<T>(
    callback: (transaction: WindDownRecoveryStorageTransaction) => Promise<T>,
  ): Promise<T>;
};

export type WindDownRecoveryLegacyKv = {
  get(key: string): Promise<string | null>;
};

export type WindDownRecoverySnapshotRecord = {
  key: string;
  value: unknown;
};

export type WindDownRecoveryLegacyRecord = {
  key: string;
  rawValue: string;
};

export type WindDownRecoveryLegacyChunkManifest = {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: "winddown-recovery-legacy-chunk-manifest";
  encoding: "utf8-chunks";
  sourceKey: string;
  chunkCount: number;
  rawValueByteCount: number;
  jsonValueByteCount: number;
};

export type WindDownRecoverySnapshot = {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: typeof WINDDOWN_RECOVERY_KIND;
  createdAtIso: string;
  records: WindDownRecoverySnapshotRecord[];
  legacyKvRecords: WindDownRecoveryLegacyRecord[];
  recordCount: number;
  legacyRecordCount: number;
  byteCount: number;
  snapshotDigest: string;
};

export type WindDownRecoveryLimits = {
  pageSize?: number;
  maxBytes?: number;
  createdAtIso?: string;
  legacyProfileKey?: string;
};

export type WindDownRecoveryReceipt = {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: "winddown-recovery-restore-receipt";
  receiptId: string;
  targetName: string;
  snapshotDigest: string;
  recordCount: number;
  legacyRecordCount: number;
  verified: true;
};

export type WindDownRecoverySeal = {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: "winddown-recovery-seal";
  targetName: string;
  snapshotDigest: string;
  recordCount: number;
  legacyRecordCount: number;
  receiptId: string;
  recoveryOnly: true;
};

export type WindDownRecoveryRestoreResult = {
  ok: true;
  duplicate: boolean;
  targetName: string;
  snapshotDigest: string;
  recordCount: number;
  legacyRecordCount: number;
  receipt: WindDownRecoveryReceipt;
};

export type WindDownRecoveryErrorCode =
  | "WINDDOWN_RECOVERY_TOO_LARGE"
  | "WINDDOWN_RECOVERY_JSON_UNSAFE"
  | "WINDDOWN_RECOVERY_SNAPSHOT_INVALID"
  | "WINDDOWN_RECOVERY_TARGET_INVALID"
  | "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY"
  | "WINDDOWN_RECOVERY_TARGET_CORRUPT"
  | "WINDDOWN_RECOVERY_PAGINATION_INVALID"
  | "WINDDOWN_RECOVERY_LEGACY_INVALID"
  | "WINDDOWN_RECOVERY_STORAGE_INVALID";

export class WindDownRecoveryError extends Error {
  readonly status: number;

  constructor(
    readonly code: WindDownRecoveryErrorCode,
    message = code,
  ) {
    super(message);
    this.name = "WindDownRecoveryError";
    this.status = code === "WINDDOWN_RECOVERY_TOO_LARGE" ? 413 : 400;
  }
}

const textEncoder = new TextEncoder();

function compareUtf8Keys(left: string, right: string): number {
  const leftBytes = textEncoder.encode(left);
  const rightBytes = textEncoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftBytes[index] - rightBytes[index];
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function jsonUnsafe(path: string, reason: string): never {
  throw new WindDownRecoveryError(
    "WINDDOWN_RECOVERY_JSON_UNSAFE",
    `WINDDOWN_RECOVERY_JSON_UNSAFE:${path}:${reason}`,
  );
}

function assertJsonSafe(
  value: unknown,
  path = "$",
  ancestors = new WeakSet<object>(),
): asserts value is Exclude<unknown, undefined> {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "undefined") jsonUnsafe(path, "undefined");
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) jsonUnsafe(path, "nonfinite-number");
    return;
  }
  if (typeof value === "bigint") jsonUnsafe(path, "bigint");
  if (typeof value === "function" || typeof value === "symbol") jsonUnsafe(path, typeof value);
  if (typeof value !== "object") jsonUnsafe(path, typeof value);
  if (ancestors.has(value)) jsonUnsafe(path, "cycle");
  ancestors.add(value);

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!(index in value)) jsonUnsafe(`${path}[${index}]`, "array-hole");
      assertJsonSafe(value[index], `${path}[${index}]`, ancestors);
    }
  } else {
    if (!isPlainRecord(value)) jsonUnsafe(path, "non-plain-object");
    if (Object.getOwnPropertySymbols(value).length > 0) jsonUnsafe(path, "symbol-key");
    if (Object.prototype.hasOwnProperty.call(value, "toJSON")) jsonUnsafe(path, "toJSON");
    for (const key of Object.keys(value)) {
      assertJsonSafe(value[key], `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function canonicalJsonUnchecked(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJsonUnchecked(entry)).join(",")}]`;
  }
  if (isPlainRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareUtf8Keys)
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonUnchecked(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_JSON_UNSAFE",
      "WINDDOWN_RECOVERY_JSON_UNSAFE:serialization",
    );
  }
  return serialized;
}

function canonicalJson(value: unknown): string {
  assertJsonSafe(value);
  return canonicalJsonUnchecked(value);
}

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).byteLength;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function cloneJsonValue(value: unknown, path: string): unknown {
  assertJsonSafe(value, path);
  try {
    return structuredClone(value);
  } catch (error) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_JSON_UNSAFE",
      `WINDDOWN_RECOVERY_JSON_UNSAFE:${path}:clone:${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isInternalRecoveryKey(key: string): boolean {
  return key.startsWith(WINDDOWN_RECOVERY_INTERNAL_PREFIX);
}

function resolvePageSize(value: number | undefined): number {
  const pageSize = value ?? WINDDOWN_RECOVERY_DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > WINDDOWN_RECOVERY_MAX_PAGE_SIZE) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_PAGINATION_INVALID",
      `WINDDOWN_RECOVERY_PAGINATION_INVALID:page-size:${String(pageSize)}`,
    );
  }
  return pageSize;
}

function resolveMaxBytes(value: number | undefined): number {
  const maxBytes = value ?? WINDDOWN_RECOVERY_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > WINDDOWN_RECOVERY_MAX_BYTES) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TOO_LARGE",
      `WINDDOWN_RECOVERY_TOO_LARGE:max-bytes:${String(maxBytes)}`,
    );
  }
  return maxBytes;
}

function normalizeCreatedAtIso(value: string | undefined): string {
  if (value === undefined) return new Date().toISOString();
  if (typeof value !== "string") {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID",
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:created-at",
    );
  }
  let milliseconds: number;
  try {
    milliseconds = Date.parse(value);
  } catch {
    milliseconds = Number.NaN;
  }
  if (!Number.isFinite(milliseconds)) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID",
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:created-at",
    );
  }
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID",
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:created-at",
    );
  }
}

function snapshotPayload(input: {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: typeof WINDDOWN_RECOVERY_KIND;
  createdAtIso: string;
  records: readonly WindDownRecoverySnapshotRecord[];
  legacyKvRecords: readonly WindDownRecoveryLegacyRecord[];
}) {
  return {
    schemaVersion: input.schemaVersion,
    kind: input.kind,
    createdAtIso: input.createdAtIso,
    records: input.records,
    legacyKvRecords: input.legacyKvRecords,
  };
}

function jsonStringByteLength(value: string): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_JSON_UNSAFE",
      "WINDDOWN_RECOVERY_JSON_UNSAFE:string-serialization",
    );
  }
  return utf8ByteLength(serialized);
}

function canonicalJsonArrayByteLength(values: readonly unknown[]): number {
  let byteCount = 2;
  values.forEach((value, index) => {
    if (index > 0) byteCount += 1;
    byteCount += utf8ByteLength(canonicalJson(value));
  });
  return byteCount;
}

function canonicalJsonFieldByteLength(name: string, valueByteCount: number): number {
  return jsonStringByteLength(name) + 1 + valueByteCount;
}

function canonicalJsonScalarByteLength(value: unknown): number {
  return utf8ByteLength(canonicalJson(value));
}

function snapshotEnvelopeBytesFromParts(input: {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: typeof WINDDOWN_RECOVERY_KIND;
  createdAtIso: string;
  recordsByteCount: number;
  legacyKvRecordsByteCount: number;
  recordCount: number;
  legacyRecordCount: number;
}): number {
  const fields: Array<[string, number]> = [
    ["schemaVersion", canonicalJsonScalarByteLength(input.schemaVersion)],
    ["kind", canonicalJsonScalarByteLength(input.kind)],
    ["createdAtIso", canonicalJsonScalarByteLength(input.createdAtIso)],
    ["records", input.recordsByteCount],
    ["legacyKvRecords", input.legacyKvRecordsByteCount],
    ["recordCount", canonicalJsonScalarByteLength(input.recordCount)],
    ["legacyRecordCount", canonicalJsonScalarByteLength(input.legacyRecordCount)],
    ["byteCount", 0],
    ["snapshotDigest", jsonStringByteLength("0".repeat(64))],
  ];

  // The digest has a fixed 64-character representation. Iterate only over the
  // decimal byteCount field, whose width stabilizes after at most two passes.
  let byteCount = 0;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    fields[7][1] = canonicalJsonScalarByteLength(byteCount);
    const next = 2
      + fields.reduce(
        (total, [name, valueByteCount]) => total + canonicalJsonFieldByteLength(name, valueByteCount),
        0,
      )
      + fields.length - 1;
    if (next === byteCount) return next;
    byteCount = next;
  }
  return byteCount;
}

function snapshotEnvelopeBytes(snapshot: {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: typeof WINDDOWN_RECOVERY_KIND;
  createdAtIso: string;
  records: readonly WindDownRecoverySnapshotRecord[];
  legacyKvRecords: readonly WindDownRecoveryLegacyRecord[];
  recordCount: number;
  legacyRecordCount: number;
}): number {
  return snapshotEnvelopeBytesFromParts({
    schemaVersion: snapshot.schemaVersion,
    kind: snapshot.kind,
    createdAtIso: snapshot.createdAtIso,
    recordsByteCount: canonicalJsonArrayByteLength(snapshot.records),
    legacyKvRecordsByteCount: canonicalJsonArrayByteLength(snapshot.legacyKvRecords),
    recordCount: snapshot.recordCount,
    legacyRecordCount: snapshot.legacyRecordCount,
  });
}

type LegacyCopyProjection = {
  records: WindDownRecoverySnapshotRecord[];
  rawValue: string;
  rawValueKeys: string[];
};

function legacyChunkKeyForBase(baseKey: string, index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_LEGACY_INVALID",
      "WINDDOWN_RECOVERY_LEGACY_INVALID:chunk-index",
    );
  }
  return `${baseKey}${WINDDOWN_RECOVERY_LEGACY_CHUNK_SUFFIX}${String(index).padStart(8, "0")}`;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function splitLegacyRawValue(
  rawValue: string,
  baseKey: string,
): Array<{ key: string; value: string }> {
  const chunks: Array<{ key: string; value: string }> = [];
  let start = 0;
  while (start < rawValue.length) {
    let end = Math.min(
      start + WINDDOWN_RECOVERY_LEGACY_CHUNK_MAX_CODE_UNITS,
      rawValue.length,
    );
    // Keep a UTF-16 surrogate pair together so the reconstructed string is
    // byte-identical after concatenation, including non-BMP characters.
    if (
      end < rawValue.length
      && isHighSurrogate(rawValue.charCodeAt(end - 1))
      && isLowSurrogate(rawValue.charCodeAt(end))
    ) {
      end -= 1;
    }
    if (end <= start) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_LEGACY_INVALID",
        "WINDDOWN_RECOVERY_LEGACY_INVALID:chunk-boundary",
      );
    }
    const value = rawValue.slice(start, end);
    // The fixed code-unit bound has a 128 KiB margin below the 512 KiB JSON
    // payload limit even when every code unit is escaped as six bytes.
    if (jsonStringByteLength(value) > WINDDOWN_RECOVERY_LEGACY_CHUNK_MAX_JSON_BYTES) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_LEGACY_INVALID",
        "WINDDOWN_RECOVERY_LEGACY_INVALID:chunk-size",
      );
    }
    chunks.push({
      key: legacyChunkKeyForBase(baseKey, chunks.length),
      value,
    });
    start = end;
  }
  return chunks;
}

function legacyCopyProjection(record: WindDownRecoveryLegacyRecord): LegacyCopyProjection {
  const baseKey = legacyCopyKeyForSnapshotKey(record.key);
  const jsonValueByteCount = jsonStringByteLength(record.rawValue);
  if (jsonValueByteCount <= WINDDOWN_RECOVERY_LEGACY_CHUNK_MAX_JSON_BYTES) {
    return {
      records: [{ key: baseKey, value: record.rawValue }],
      rawValue: record.rawValue,
      rawValueKeys: [baseKey],
    };
  }

  const chunks = splitLegacyRawValue(record.rawValue, baseKey);
  const manifest: WindDownRecoveryLegacyChunkManifest = {
    schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
    kind: "winddown-recovery-legacy-chunk-manifest",
    encoding: "utf8-chunks",
    sourceKey: record.key,
    chunkCount: chunks.length,
    rawValueByteCount: utf8ByteLength(record.rawValue),
    jsonValueByteCount,
  };
  return {
    records: [{ key: baseKey, value: manifest }, ...chunks],
    rawValue: record.rawValue,
    rawValueKeys: chunks.map((chunk) => chunk.key),
  };
}

function snapshotDigest(snapshot: {
  schemaVersion: typeof WINDDOWN_RECOVERY_SCHEMA_VERSION;
  kind: typeof WINDDOWN_RECOVERY_KIND;
  createdAtIso: string;
  records: readonly WindDownRecoverySnapshotRecord[];
  legacyKvRecords: readonly WindDownRecoveryLegacyRecord[];
}): string {
  return sha256Hex(canonicalJson(snapshotPayload(snapshot)));
}

type RecordScanOptions = {
  pageSize: number;
  maxBytes: number;
  allowInternalKeys: boolean;
  measureRecord?: (record: WindDownRecoverySnapshotRecord, recordCount: number) => number;
};

class CanonicalJsonArraySizer {
  private byteCount = 2;
  private itemCount = 0;

  get bytes(): number {
    return this.byteCount;
  }

  add(value: unknown): number {
    if (this.itemCount > 0) this.byteCount += 1;
    this.byteCount += utf8ByteLength(canonicalJson(value));
    this.itemCount += 1;
    return this.byteCount;
  }
}

async function listAllStorageRecords(
  storage: Pick<WindDownRecoveryStorageTransaction, "list">,
  options: RecordScanOptions,
): Promise<WindDownRecoverySnapshotRecord[]> {
  const records: WindDownRecoverySnapshotRecord[] = [];
  const seen = new Set<string>();
  let startAfter: string | undefined;

  for (;;) {
    const page = await storage.list({
      limit: options.pageSize,
      ...(startAfter === undefined ? {} : { startAfter }),
    });
    if (!(page instanceof Map)) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_STORAGE_INVALID",
        "WINDDOWN_RECOVERY_STORAGE_INVALID:list-not-map",
      );
    }
    if (page.size === 0) break;
    if (page.size > options.pageSize) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_PAGINATION_INVALID",
        "WINDDOWN_RECOVERY_PAGINATION_INVALID:page-over-limit",
      );
    }

    const entries = [...page.entries()].sort(([left], [right]) => compareUtf8Keys(left, right));
    for (const [key, value] of entries) {
      if (typeof key !== "string" || key.length === 0) {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_STORAGE_INVALID",
          "WINDDOWN_RECOVERY_STORAGE_INVALID:key",
        );
      }
      if (startAfter !== undefined && compareUtf8Keys(key, startAfter) <= 0) {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_PAGINATION_INVALID",
          `WINDDOWN_RECOVERY_PAGINATION_INVALID:cursor:${key}`,
        );
      }
      if (seen.has(key)) {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_PAGINATION_INVALID",
          `WINDDOWN_RECOVERY_PAGINATION_INVALID:duplicate-key:${key}`,
        );
      }
      if (!options.allowInternalKeys && isInternalRecoveryKey(key)) {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_STORAGE_INVALID",
          `WINDDOWN_RECOVERY_STORAGE_INVALID:reserved-key:${key}`,
        );
      }
      const record = { key, value: cloneJsonValue(value, `$.records[${JSON.stringify(key)}]`) };
      records.push(record);
      seen.add(key);
      if (options.measureRecord && options.measureRecord(record, records.length) > options.maxBytes) {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_TOO_LARGE",
          "WINDDOWN_RECOVERY_TOO_LARGE:records",
        );
      }
    }

    const nextCursor = entries[entries.length - 1]?.[0];
    if (!nextCursor || (startAfter !== undefined && compareUtf8Keys(nextCursor, startAfter) <= 0)) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_PAGINATION_INVALID",
        "WINDDOWN_RECOVERY_PAGINATION_INVALID:cursor-did-not-advance",
      );
    }
    startAfter = nextCursor;
  }
  return records;
}

function assertStorage(storage: unknown): asserts storage is WindDownRecoveryStorage {
  if (
    !storage
    || typeof storage !== "object"
    || typeof (storage as { list?: unknown }).list !== "function"
    || typeof (storage as { get?: unknown }).get !== "function"
    || typeof (storage as { put?: unknown }).put !== "function"
    || typeof (storage as { transaction?: unknown }).transaction !== "function"
  ) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_STORAGE_INVALID",
      "WINDDOWN_RECOVERY_STORAGE_INVALID:missing-method",
    );
  }
}

function assertLegacyKv(value: unknown): asserts value is WindDownRecoveryLegacyKv {
  if (!value || typeof value !== "object" || typeof (value as { get?: unknown }).get !== "function") {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_LEGACY_INVALID",
      "WINDDOWN_RECOVERY_LEGACY_INVALID:missing-get",
    );
  }
}

function cloneSnapshot(snapshot: WindDownRecoverySnapshot): WindDownRecoverySnapshot {
  return {
    ...snapshot,
    records: snapshot.records.map((record) => ({
      key: record.key,
      value: cloneJsonValue(record.value, `$.records[${JSON.stringify(record.key)}]`),
    })),
    legacyKvRecords: snapshot.legacyKvRecords.map((record) => ({ ...record })),
  };
}

export async function exportWindDownRecoverySnapshot(args: {
  storage: WindDownRecoveryStorage;
  legacyKv?: WindDownRecoveryLegacyKv | null;
  pageSize?: number;
  maxBytes?: number;
  createdAtIso?: string;
  legacyProfileKey?: string;
}): Promise<WindDownRecoverySnapshot> {
  assertStorage(args.storage);
  const pageSize = resolvePageSize(args.pageSize);
  const maxBytes = resolveMaxBytes(args.maxBytes);
  const createdAtIso = normalizeCreatedAtIso(args.createdAtIso);
  const legacyProfileKey = args.legacyProfileKey ?? WINDDOWN_RECOVERY_PROFILE_KV_KEY;
  if (typeof legacyProfileKey !== "string" || !legacyProfileKey || isInternalRecoveryKey(legacyProfileKey)) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_LEGACY_INVALID",
      "WINDDOWN_RECOVERY_LEGACY_INVALID:key",
    );
  }
  if (args.legacyKv !== undefined && args.legacyKv !== null) assertLegacyKv(args.legacyKv);

  return args.storage.transaction(async (transaction) => {
    // Probe the profile inside the same read transaction before touching the
    // legacy mirror. This keeps the fallback read nonmutating and lets the
    // paged scan include its raw bytes in the bounded size check.
    const profileRecord = await transaction.get<unknown>(WINDDOWN_RECOVERY_PROFILE_STORAGE_KEY);
    const profileManifest = await transaction.get<unknown>(WIND_DOWN_PROFILE_MANIFEST_STORAGE_KEY);
    const legacyKvRecords: WindDownRecoveryLegacyRecord[] = [];
    const legacySizer = new CanonicalJsonArraySizer();
    if (profileRecord === undefined && profileManifest === undefined && args.legacyKv) {
      const rawValue = await args.legacyKv.get(legacyProfileKey);
      if (rawValue !== null) {
        if (typeof rawValue !== "string") {
          throw new WindDownRecoveryError(
            "WINDDOWN_RECOVERY_LEGACY_INVALID",
            "WINDDOWN_RECOVERY_LEGACY_INVALID:value",
          );
        }
        if (utf8ByteLength(rawValue) > maxBytes) {
          throw new WindDownRecoveryError(
            "WINDDOWN_RECOVERY_TOO_LARGE",
            "WINDDOWN_RECOVERY_TOO_LARGE:legacy-raw",
          );
        }
        legacyKvRecords.push({ key: legacyProfileKey, rawValue });
        legacySizer.add(legacyKvRecords[legacyKvRecords.length - 1]);
        const fallbackBytes = snapshotEnvelopeBytes({
          schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
          kind: WINDDOWN_RECOVERY_KIND,
          createdAtIso,
          records: [],
          legacyKvRecords,
          recordCount: 0,
          legacyRecordCount: legacyKvRecords.length,
        });
        if (fallbackBytes > maxBytes) {
          throw new WindDownRecoveryError(
            "WINDDOWN_RECOVERY_TOO_LARGE",
            `WINDDOWN_RECOVERY_TOO_LARGE:legacy:${fallbackBytes}`,
          );
        }
      }
    }
    const records = await listAllStorageRecords(transaction, {
      pageSize,
      maxBytes,
      allowInternalKeys: false,
      measureRecord: (() => {
        const recordSizer = new CanonicalJsonArraySizer();
        return (record: WindDownRecoverySnapshotRecord, recordCount: number) =>
          snapshotEnvelopeBytesFromParts({
            schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
            kind: WINDDOWN_RECOVERY_KIND,
            createdAtIso,
            recordsByteCount: recordSizer.add(record),
            legacyKvRecordsByteCount: legacySizer.bytes,
            recordCount,
            legacyRecordCount: legacyKvRecords.length,
          });
      })(),
    });
    const payload = snapshotPayload({
      schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
      kind: WINDDOWN_RECOVERY_KIND,
      createdAtIso,
      records,
      legacyKvRecords,
    });
    const byteCount = snapshotEnvelopeBytes({
      schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
      kind: WINDDOWN_RECOVERY_KIND,
      createdAtIso,
      records,
      legacyKvRecords,
      recordCount: records.length,
      legacyRecordCount: legacyKvRecords.length,
    });
    if (byteCount > maxBytes) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_TOO_LARGE",
        `WINDDOWN_RECOVERY_TOO_LARGE:payload:${byteCount}`,
      );
    }
    const snapshot: WindDownRecoverySnapshot = {
      schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
      kind: WINDDOWN_RECOVERY_KIND,
      createdAtIso,
      records,
      legacyKvRecords,
      recordCount: records.length,
      legacyRecordCount: legacyKvRecords.length,
      byteCount,
      snapshotDigest: snapshotDigest(payload),
    };
    return cloneSnapshot(snapshot);
  });
}

export type WindDownRecoveryValidation =
  | { ok: true; errors: [] }
  | { ok: false; errors: string[] };

function validationError(errors: string[], code: string) {
  if (!errors.includes(code)) errors.push(code);
}

function validIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const milliseconds = Date.parse(value);
    return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
  } catch {
    return false;
  }
}

export function validateWindDownRecoverySnapshot(
  value: unknown,
  maxBytes = WINDDOWN_RECOVERY_MAX_BYTES,
): WindDownRecoveryValidation {
  const errors: string[] = [];
  let resolvedMaxBytes: number;
  try {
    resolvedMaxBytes = resolveMaxBytes(maxBytes);
  } catch (error) {
    validationError(errors, error instanceof WindDownRecoveryError ? error.code : "WINDDOWN_RECOVERY_TOO_LARGE");
    resolvedMaxBytes = WINDDOWN_RECOVERY_MAX_BYTES;
  }
  if (!isPlainRecord(value)) {
    return { ok: false, errors: ["WINDDOWN_RECOVERY_SNAPSHOT_INVALID:shape"] };
  }
  const snapshot = value as Partial<WindDownRecoverySnapshot>;
  try {
    assertJsonSafe(snapshot);
  } catch (error) {
    validationError(
      errors,
      error instanceof WindDownRecoveryError ? error.code : "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:json",
    );
  }
  const allowedSnapshotFields = new Set([
    "schemaVersion",
    "kind",
    "createdAtIso",
    "records",
    "legacyKvRecords",
    "recordCount",
    "legacyRecordCount",
    "byteCount",
    "snapshotDigest",
  ]);
  for (const field of Object.keys(snapshot)) {
    if (!allowedSnapshotFields.has(field)) {
      validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:field:${field}`);
    }
  }
  if (Object.getOwnPropertySymbols(snapshot).length > 0) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:symbol-key");
  }
  if (snapshot.schemaVersion !== WINDDOWN_RECOVERY_SCHEMA_VERSION) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:schema");
  }
  if (snapshot.kind !== WINDDOWN_RECOVERY_KIND) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:kind");
  }
  if (!validIso(snapshot.createdAtIso)) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:created-at");
  }
  if (!Array.isArray(snapshot.records)) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:records");
  }
  if (!Array.isArray(snapshot.legacyKvRecords)) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-records");
  }
  if (!Number.isSafeInteger(snapshot.recordCount) || snapshot.recordCount! < 0) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:record-count");
  }
  if (!Number.isSafeInteger(snapshot.legacyRecordCount) || snapshot.legacyRecordCount! < 0) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-record-count");
  }
  if (!Number.isSafeInteger(snapshot.byteCount) || snapshot.byteCount! < 0) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:byte-count");
  }
  if (typeof snapshot.snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.snapshotDigest)) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:digest-shape");
  }

  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const legacyKvRecords = Array.isArray(snapshot.legacyKvRecords)
    ? snapshot.legacyKvRecords
    : [];
  const seenKeys = new Set<string>();
  let previousKey: string | undefined;
  for (const [index, candidate] of records.entries()) {
    if (!isPlainRecord(candidate) || Object.keys(candidate).length !== 2) {
      validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:record:${index}`);
      continue;
    }
    const key = candidate.key;
    if (typeof key !== "string" || key.length === 0) {
      validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:record-key:${index}`);
      continue;
    }
    if (isInternalRecoveryKey(key)) {
      validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:reserved-key:${key}`);
    }
    if (seenKeys.has(key)) validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:duplicate-key:${key}`);
    if (previousKey !== undefined && compareUtf8Keys(previousKey, key) >= 0) {
      validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:record-order");
    }
    previousKey = key;
    seenKeys.add(key);
    try {
      assertJsonSafe(candidate.value, `$.records[${JSON.stringify(key)}]`);
    } catch (error) {
      validationError(
        errors,
        error instanceof WindDownRecoveryError ? error.code : "WINDDOWN_RECOVERY_JSON_UNSAFE",
      );
    }
  }
  const seenLegacyKeys = new Set<string>();
  for (const [index, candidate] of legacyKvRecords.entries()) {
    if (!isPlainRecord(candidate) || Object.keys(candidate).length !== 2) {
      validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-record:${index}`);
      continue;
    }
    const key = candidate.key;
    if (
      typeof key !== "string"
      || key.length === 0
      || isInternalRecoveryKey(key)
      || typeof candidate.rawValue !== "string"
    ) {
      validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-value:${index}`);
      continue;
    }
    if (seenLegacyKeys.has(key)) validationError(errors, `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-duplicate:${key}`);
    seenLegacyKeys.add(key);
  }
  if (seenKeys.has(WINDDOWN_RECOVERY_PROFILE_STORAGE_KEY) && legacyKvRecords.length > 0) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-fallback-conflict");
  }
  if (snapshot.recordCount !== records.length) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:record-count-mismatch");
  }
  if (snapshot.legacyRecordCount !== legacyKvRecords.length) {
    validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:legacy-count-mismatch");
  }

  if (
    validIso(snapshot.createdAtIso)
    && snapshot.schemaVersion === WINDDOWN_RECOVERY_SCHEMA_VERSION
    && snapshot.kind === WINDDOWN_RECOVERY_KIND
  ) {
    try {
      const payload = snapshotPayload({
        schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
        kind: WINDDOWN_RECOVERY_KIND,
        createdAtIso: snapshot.createdAtIso,
        records: records as WindDownRecoverySnapshotRecord[],
        legacyKvRecords: legacyKvRecords as WindDownRecoveryLegacyRecord[],
      });
      const actualByteCount = snapshotEnvelopeBytes({
        schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
        kind: WINDDOWN_RECOVERY_KIND,
        createdAtIso: snapshot.createdAtIso,
        records: records as WindDownRecoverySnapshotRecord[],
        legacyKvRecords: legacyKvRecords as WindDownRecoveryLegacyRecord[],
        recordCount: records.length,
        legacyRecordCount: legacyKvRecords.length,
      });
      if (snapshot.byteCount !== actualByteCount) {
        validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:byte-count-mismatch");
      }
      if (actualByteCount > resolvedMaxBytes) validationError(errors, "WINDDOWN_RECOVERY_TOO_LARGE");
      if (
        typeof snapshot.snapshotDigest === "string"
        && /^[a-f0-9]{64}$/.test(snapshot.snapshotDigest)
        && snapshot.snapshotDigest !== snapshotDigest(payload)
      ) {
        validationError(errors, "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:checksum");
      }
    } catch (error) {
      validationError(
        errors,
        error instanceof WindDownRecoveryError ? error.code : "WINDDOWN_RECOVERY_SNAPSHOT_INVALID:serialization",
      );
    }
  }

  return errors.length === 0
    ? { ok: true, errors: [] }
    : { ok: false, errors };
}

export function recoveryCopyNameForSnapshot(snapshotDigest: string): string {
  if (typeof snapshotDigest !== "string" || !/^[a-f0-9]{64}$/.test(snapshotDigest)) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_INVALID",
      "WINDDOWN_RECOVERY_TARGET_INVALID:digest",
    );
  }
  return `recoverycopy:${snapshotDigest}`;
}

export function legacyCopyKeyForSnapshotKey(key: string): string {
  if (typeof key !== "string" || !key || isInternalRecoveryKey(key)) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_INVALID",
      "WINDDOWN_RECOVERY_TARGET_INVALID:legacy-key",
    );
  }
  return `${WINDDOWN_RECOVERY_LEGACY_COPY_PREFIX}${encodeURIComponent(key)}`;
}

function buildReceipt(
  snapshot: WindDownRecoverySnapshot,
  targetName: string,
): WindDownRecoveryReceipt {
  return {
    schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
    kind: "winddown-recovery-restore-receipt",
    receiptId: `winddown-recovery:${snapshot.snapshotDigest}`,
    targetName,
    snapshotDigest: snapshot.snapshotDigest,
    recordCount: snapshot.recordCount,
    legacyRecordCount: snapshot.legacyRecordCount,
    verified: true,
  };
}

function buildSeal(
  snapshot: WindDownRecoverySnapshot,
  targetName: string,
  receipt: WindDownRecoveryReceipt,
): WindDownRecoverySeal {
  return {
    schemaVersion: WINDDOWN_RECOVERY_SCHEMA_VERSION,
    kind: "winddown-recovery-seal",
    targetName,
    snapshotDigest: snapshot.snapshotDigest,
    recordCount: snapshot.recordCount,
    legacyRecordCount: snapshot.legacyRecordCount,
    receiptId: receipt.receiptId,
    recoveryOnly: true,
  };
}

function sameRawJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function expectedRestoredRecords(
  snapshot: WindDownRecoverySnapshot,
  receipt: WindDownRecoveryReceipt,
  seal: WindDownRecoverySeal,
): Map<string, unknown> {
  const expected = new Map<string, unknown>();
  for (const record of snapshot.records) expected.set(record.key, record.value);
  for (const legacyRecord of snapshot.legacyKvRecords) {
    for (const record of legacyCopyProjection(legacyRecord).records) {
      expected.set(record.key, record.value);
    }
  }
  expected.set(WINDDOWN_RECOVERY_RECEIPT_KEY, receipt);
  expected.set(WINDDOWN_RECOVERY_SEAL_KEY, seal);
  return expected;
}

function assertExactTarget(
  targetRecords: readonly WindDownRecoverySnapshotRecord[],
  expected: Map<string, unknown>,
) {
  if (targetRecords.length !== expected.size) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_CORRUPT",
      "WINDDOWN_RECOVERY_TARGET_CORRUPT:record-count",
    );
  }
  const seen = new Set<string>();
  for (const record of targetRecords) {
    if (!expected.has(record.key) || seen.has(record.key)) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_TARGET_CORRUPT",
        `WINDDOWN_RECOVERY_TARGET_CORRUPT:unexpected-key:${record.key}`,
      );
    }
    if (!sameRawJson(record.value, expected.get(record.key))) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_TARGET_CORRUPT",
        `WINDDOWN_RECOVERY_TARGET_CORRUPT:value:${record.key}`,
      );
    }
    seen.add(record.key);
  }
  for (const key of expected.keys()) {
    if (!seen.has(key)) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_TARGET_CORRUPT",
        `WINDDOWN_RECOVERY_TARGET_CORRUPT:missing-key:${key}`,
      );
    }
  }
}

function assertLegacyRawCopies(
  targetRecords: readonly WindDownRecoverySnapshotRecord[],
  snapshot: WindDownRecoverySnapshot,
): void {
  const values = new Map(targetRecords.map((record) => [record.key, record.value]));
  for (const legacyRecord of snapshot.legacyKvRecords) {
    const projection = legacyCopyProjection(legacyRecord);
    const reconstructed = projection.rawValueKeys.map((key) => {
      const value = values.get(key);
      if (typeof value !== "string") {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_TARGET_CORRUPT",
          `WINDDOWN_RECOVERY_TARGET_CORRUPT:legacy-chunk:${legacyRecord.key}`,
        );
      }
      return value;
    }).join("");
    if (reconstructed !== projection.rawValue) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_TARGET_CORRUPT",
        `WINDDOWN_RECOVERY_TARGET_CORRUPT:legacy-content:${legacyRecord.key}`,
      );
    }
  }
}

function assertSeal(
  value: unknown,
  snapshot: WindDownRecoverySnapshot,
  targetName: string,
): asserts value is WindDownRecoverySeal {
  if (
    !isPlainRecord(value)
    || value.schemaVersion !== WINDDOWN_RECOVERY_SCHEMA_VERSION
    || value.kind !== "winddown-recovery-seal"
    || value.targetName !== targetName
    || value.snapshotDigest !== snapshot.snapshotDigest
    || value.recordCount !== snapshot.recordCount
    || value.legacyRecordCount !== snapshot.legacyRecordCount
    || value.receiptId !== `winddown-recovery:${snapshot.snapshotDigest}`
    || value.recoveryOnly !== true
  ) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_CORRUPT",
      "WINDDOWN_RECOVERY_TARGET_CORRUPT:seal",
    );
  }
}

function assertReceipt(
  value: unknown,
  expected: WindDownRecoveryReceipt,
): asserts value is WindDownRecoveryReceipt {
  if (!isPlainRecord(value) || !sameRawJson(value, expected)) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_CORRUPT",
      "WINDDOWN_RECOVERY_TARGET_CORRUPT:receipt",
    );
  }
}

async function verifyCompleteTarget(
  transaction: Pick<WindDownRecoveryStorageTransaction, "list">,
  snapshot: WindDownRecoverySnapshot,
  targetName: string,
  receipt: WindDownRecoveryReceipt,
  expected: Map<string, unknown>,
  pageSize: number,
  targetScanMaxBytes: number,
): Promise<void> {
  const targetSizer = new CanonicalJsonArraySizer();
  let targetRecords: WindDownRecoverySnapshotRecord[];
  try {
    targetRecords = await listAllStorageRecords(transaction, {
      pageSize,
      maxBytes: targetScanMaxBytes,
      allowInternalKeys: true,
      measureRecord: (record) => targetSizer.add(record),
    });
  } catch (error) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_CORRUPT",
      `WINDDOWN_RECOVERY_TARGET_CORRUPT:scan:${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertReceipt(
    targetRecords.find((record) => record.key === WINDDOWN_RECOVERY_RECEIPT_KEY)?.value,
    receipt,
  );
  assertExactTarget(targetRecords, expected);
  assertLegacyRawCopies(targetRecords, snapshot);
  // Keep the argument in the verification seam so callers cannot accidentally
  // verify a target against a receipt from another deterministic copy.
  if (targetName !== receipt.targetName || snapshot.snapshotDigest !== receipt.snapshotDigest) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_CORRUPT",
      "WINDDOWN_RECOVERY_TARGET_CORRUPT:identity",
    );
  }
}

export function isWindDownRecoverySeal(value: unknown): value is WindDownRecoverySeal {
  if (!isPlainRecord(value)) return false;
  const snapshotDigest = value.snapshotDigest;
  const recordCount = value.recordCount;
  const legacyRecordCount = value.legacyRecordCount;
  if (
    Object.keys(value).length !== 8
    || Object.getOwnPropertySymbols(value).length !== 0
    || value.schemaVersion !== WINDDOWN_RECOVERY_SCHEMA_VERSION
    || value.kind !== "winddown-recovery-seal"
    || value.recoveryOnly !== true
    || typeof value.targetName !== "string"
    || typeof snapshotDigest !== "string"
    || !/^[a-f0-9]{64}$/.test(snapshotDigest)
    || typeof recordCount !== "number"
    || !Number.isSafeInteger(recordCount)
    || recordCount < 0
    || typeof legacyRecordCount !== "number"
    || !Number.isSafeInteger(legacyRecordCount)
    || legacyRecordCount < 0
    || value.receiptId !== `winddown-recovery:${snapshotDigest}`
  ) {
    return false;
  }
  return value.targetName === `recoverycopy:${snapshotDigest}`;
}

export async function restoreWindDownRecoverySnapshot(args: {
  storage: WindDownRecoveryStorage;
  snapshot: unknown;
  targetName: string;
  pageSize?: number;
  maxBytes?: number;
}): Promise<WindDownRecoveryRestoreResult> {
  assertStorage(args.storage);
  const pageSize = resolvePageSize(args.pageSize);
  const maxBytes = resolveMaxBytes(args.maxBytes);
  const validation = validateWindDownRecoverySnapshot(args.snapshot, maxBytes);
  if (!validation.ok) {
    if (validation.errors.includes("WINDDOWN_RECOVERY_TOO_LARGE")) {
      throw new WindDownRecoveryError("WINDDOWN_RECOVERY_TOO_LARGE");
    }
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_SNAPSHOT_INVALID",
      `WINDDOWN_RECOVERY_SNAPSHOT_INVALID:${validation.errors.join(",")}`,
    );
  }
  const snapshot = cloneSnapshot(args.snapshot as WindDownRecoverySnapshot);
  const expectedTargetName = recoveryCopyNameForSnapshot(snapshot.snapshotDigest);
  if (args.targetName !== expectedTargetName) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TARGET_INVALID",
      "WINDDOWN_RECOVERY_TARGET_INVALID:recovery-copy-name",
    );
  }
  const targetName = args.targetName;
  const receipt = buildReceipt(snapshot, targetName);
  const seal = buildSeal(snapshot, targetName, receipt);
  const expected = expectedRestoredRecords(snapshot, receipt, seal);
  const expectedBytes = canonicalJsonArrayByteLength(
    [...expected.entries()].map(([key, value]) => ({ key, value })),
  );
  const targetScanMaxBytes = maxBytes + WINDDOWN_RECOVERY_TARGET_SCAN_OVERHEAD_BYTES;
  if (expectedBytes > targetScanMaxBytes) {
    throw new WindDownRecoveryError(
      "WINDDOWN_RECOVERY_TOO_LARGE",
      "WINDDOWN_RECOVERY_TOO_LARGE:target-metadata",
    );
  }

  return args.storage.transaction(async (transaction) => {
    const existingSeal = await transaction.get<unknown>(WINDDOWN_RECOVERY_SEAL_KEY);
    const firstPage = await transaction.list({ limit: pageSize });
    if (!(firstPage instanceof Map)) {
      throw new WindDownRecoveryError(
        "WINDDOWN_RECOVERY_STORAGE_INVALID",
        "WINDDOWN_RECOVERY_STORAGE_INVALID:list-not-map",
      );
    }
    if (existingSeal === undefined) {
      if (firstPage.size > 0) {
        throw new WindDownRecoveryError(
          "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY",
          "WINDDOWN_RECOVERY_TARGET_NOT_EMPTY:missing-seal",
        );
      }
      for (const record of snapshot.records) {
        await transaction.put(record.key, cloneJsonValue(record.value, `$.records[${record.key}]`));
      }
      for (const record of snapshot.legacyKvRecords) {
        for (const copy of legacyCopyProjection(record).records) {
          await transaction.put(copy.key, copy.value);
        }
      }
      await transaction.put(WINDDOWN_RECOVERY_RECEIPT_KEY, receipt);
      // Publish the recovery-only marker last, after every source value and
      // receipt has succeeded inside the same transaction.
      await transaction.put(WINDDOWN_RECOVERY_SEAL_KEY, seal);
      await verifyCompleteTarget(
        transaction,
        snapshot,
        targetName,
        receipt,
        expected,
        pageSize,
        targetScanMaxBytes,
      );
      return {
        ok: true as const,
        duplicate: false,
        targetName,
        snapshotDigest: snapshot.snapshotDigest,
        recordCount: snapshot.recordCount,
        legacyRecordCount: snapshot.legacyRecordCount,
        receipt,
      };
    }

    assertSeal(existingSeal, snapshot, targetName);
    await verifyCompleteTarget(
      transaction,
      snapshot,
      targetName,
      receipt,
      expected,
      pageSize,
      targetScanMaxBytes,
    );
    return {
      ok: true as const,
      duplicate: true,
      targetName,
      snapshotDigest: snapshot.snapshotDigest,
      recordCount: snapshot.recordCount,
      legacyRecordCount: snapshot.legacyRecordCount,
      receipt,
    };
  });
}
