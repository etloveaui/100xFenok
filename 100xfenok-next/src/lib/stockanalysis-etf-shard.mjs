import crypto from "node:crypto";

export const STOCKANALYSIS_ETF_SHARD_COUNT = 1024;
export const STOCKANALYSIS_ETF_SHARD_MAX_BYTES = 25 * 1024 * 1024;
export const STOCKANALYSIS_ETF_SHARD_ALGORITHM = "fnv1a32-utf16-v1";
export const STOCKANALYSIS_ETF_SHARD_SCHEMA = "stockanalysis-etf-shard/v2";
export const STOCKANALYSIS_ETF_SHARD_MANIFEST_SCHEMA = "stockanalysis-etf-shards/v2";
export const STOCKANALYSIS_ETF_SHARD_COMPATIBILITY_MODE = "shard-only";

const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,19}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * This deliberately mirrors normalizeStockanalysisTicker() without importing
 * TypeScript into the build script: remove one display "$", canonicalize case,
 * discard non-file characters, then apply the route-length contract.
 */
export function stockanalysisEtfTickerKey(value) {
  const ticker = String(value ?? "")
    .trim()
    .replace(/^\$/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
  if (!TICKER_PATTERN.test(ticker)) throw new Error(`invalid StockAnalysis ETF ticker: ${value}`);
  return ticker;
}

export function stockanalysisEtfShardId(value) {
  const ticker = stockanalysisEtfTickerKey(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < ticker.length; index += 1) {
    hash ^= ticker.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash & (STOCKANALYSIS_ETF_SHARD_COUNT - 1);
}

export function stockanalysisEtfShardFileNameForId(shardId) {
  if (!Number.isInteger(shardId) || shardId < 0 || shardId >= STOCKANALYSIS_ETF_SHARD_COUNT) {
    throw new RangeError(`StockAnalysis ETF shard id out of range: ${shardId}`);
  }
  return `${String(shardId).padStart(3, "0")}.json`;
}

export function stockanalysisEtfShardFileName(value) {
  return stockanalysisEtfShardFileNameForId(stockanalysisEtfShardId(value));
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function stockanalysisEtfManifestSha256(manifest) {
  const copy = { ...manifest };
  delete copy.manifest_sha256;
  return sha256Text(stableJson(copy));
}

export function stockanalysisEtfSourceBindingSha256(rows) {
  return sha256Text(stableJson({
    schema_version: "stockanalysis-etf-source-binding/v1",
    rows: [...rows].sort((left, right) => left.ticker.localeCompare(right.ticker)),
  }));
}

export function stockanalysisEtfSnapshotId(sourcePayloadSha256) {
  if (!SHA256_PATTERN.test(sourcePayloadSha256 ?? "")) {
    throw new Error("invalid StockAnalysis ETF source payload SHA-256");
  }
  return sha256Text(stableJson({
    schema_version: "stockanalysis-etf-snapshot-binding/v1",
    source_payload_sha256: sourcePayloadSha256,
    shard_algorithm: STOCKANALYSIS_ETF_SHARD_ALGORITHM,
    shard_count: STOCKANALYSIS_ETF_SHARD_COUNT,
  }));
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function validSnapshotId(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function expectedShardPath(snapshotId, shardId) {
  return `snapshots/${snapshotId}/${stockanalysisEtfShardFileNameForId(shardId)}`;
}

function validatedStockanalysisEtfShardManifest(manifest) {
  const record = asRecord(manifest);
  if (
    !record
    || record.schema_version !== STOCKANALYSIS_ETF_SHARD_MANIFEST_SCHEMA
    || record.compatibility_mode !== STOCKANALYSIS_ETF_SHARD_COMPATIBILITY_MODE
    || record.shard_algorithm !== STOCKANALYSIS_ETF_SHARD_ALGORITHM
    || record.shard_count !== STOCKANALYSIS_ETF_SHARD_COUNT
    || !Number.isInteger(record.payload_count)
    || record.payload_count < 0
    || !validSnapshotId(record.snapshot_id)
    || !SHA256_PATTERN.test(record.manifest_sha256 ?? "")
    || record.manifest_sha256 !== stockanalysisEtfManifestSha256(record)
    || !Array.isArray(record.shards)
    || record.shards.length !== STOCKANALYSIS_ETF_SHARD_COUNT
  ) return null;

  const ids = new Set();
  for (let position = 0; position < record.shards.length; position += 1) {
    const candidate = record.shards[position];
    const shard = asRecord(candidate);
    if (
      !shard
      || !Number.isInteger(shard.id)
      || shard.id < 0
      || shard.id >= STOCKANALYSIS_ETF_SHARD_COUNT
      || shard.id !== position
      || ids.has(shard.id)
      || shard.path !== expectedShardPath(record.snapshot_id, shard.id)
      || !SHA256_PATTERN.test(shard.sha256 ?? "")
      || !Number.isInteger(shard.member_count)
      || shard.member_count < 0
      || !Number.isInteger(shard.byte_length)
      || shard.byte_length < 0
      || shard.byte_length > STOCKANALYSIS_ETF_SHARD_MAX_BYTES
    ) return null;
    ids.add(shard.id);
  }
  if (record.shards.reduce((sum, shard) => sum + shard.member_count, 0) !== record.payload_count) return null;
  return record;
}

export function stockanalysisEtfShardManifestIsValid(manifest) {
  return validatedStockanalysisEtfShardManifest(manifest) !== null;
}

/**
 * Validate the public manifest as a whole before any shard path is used.  A
 * null result is intentionally non-throwing so the server can return the
 * typed shard-integrity-unavailable result without touching a direct file.
 */
export function stockanalysisEtfShardManifestEntry(manifest, value) {
  const ticker = stockanalysisEtfTickerKey(value);
  const record = validatedStockanalysisEtfShardManifest(manifest);
  if (!record) return null;
  const shardId = stockanalysisEtfShardId(ticker);
  const entry = record.shards[shardId];
  return { ticker, shardId, snapshotId: record.snapshot_id, entry };
}

function strictStockanalysisEtfPayload(payload, ticker) {
  return payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && payload.schema_version === "stockanalysis/v1"
    && payload.ticker === ticker
    && payload.asset_type === "etf"
    && payload.source === "stockanalysis"
    && payload.source_provider !== "yahoo_finance"
    && payload.detail_status !== "yf_fallback";
}

export function stockanalysisEtfPayloadDocumentFromShard(shard, value) {
  const record = asRecord(shard);
  const entries = asRecord(record?.entries);
  const result = stockanalysisEtfPayloadDocumentResultFromShard(
    shard,
    value,
    entries ? Object.keys(entries).length : -1,
  );
  return result.kind === "ok" ? result.document : null;
}

export function stockanalysisEtfPayloadDocumentResultFromShard(shard, value, expectedMemberCount) {
  const ticker = stockanalysisEtfTickerKey(value);
  const record = asRecord(shard);
  if (
    !record
    || record.schema_version !== STOCKANALYSIS_ETF_SHARD_SCHEMA
    || record.shard_algorithm !== STOCKANALYSIS_ETF_SHARD_ALGORITHM
    || record.shard_count !== STOCKANALYSIS_ETF_SHARD_COUNT
    || record.shard_id !== stockanalysisEtfShardId(ticker)
    || !Number.isInteger(expectedMemberCount)
    || expectedMemberCount < 0
  ) return { kind: "shard_integrity_unavailable", reason: "invalid_shard_envelope" };
  const entries = asRecord(record.entries);
  if (!entries) return { kind: "shard_integrity_unavailable", reason: "invalid_shard_entries" };
  const memberKeys = Object.keys(entries);
  if (memberKeys.length !== expectedMemberCount) {
    return { kind: "shard_integrity_unavailable", reason: "shard_member_count_mismatch" };
  }

  let selectedDocument = null;
  for (const memberTicker of memberKeys) {
    let canonicalTicker;
    try {
      canonicalTicker = stockanalysisEtfTickerKey(memberTicker);
    } catch {
      return { kind: "shard_integrity_unavailable", reason: "invalid_member_ticker" };
    }
    if (canonicalTicker !== memberTicker || stockanalysisEtfShardId(memberTicker) !== record.shard_id) {
      return { kind: "shard_integrity_unavailable", reason: "wrong_shard_membership" };
    }
    const entry = asRecord(entries[memberTicker]);
    if (
      !entry
      || typeof entry.raw !== "string"
      || !SHA256_PATTERN.test(entry.sha256 ?? "")
      || sha256Text(entry.raw) !== entry.sha256
    ) {
      return { kind: "shard_integrity_unavailable", reason: "invalid_member_digest" };
    }
    let payload;
    try {
      payload = JSON.parse(entry.raw);
    } catch {
      return { kind: "shard_integrity_unavailable", reason: "invalid_embedded_json" };
    }
    if (!strictStockanalysisEtfPayload(payload, memberTicker)) {
      return { kind: "shard_integrity_unavailable", reason: "invalid_embedded_identity" };
    }
    if (memberTicker === ticker) selectedDocument = { raw: entry.raw, value: payload };
  }
  return selectedDocument
    ? { kind: "ok", document: selectedDocument }
    : { kind: "ticker_not_found" };
}

/**
 * Runtime-only fast path. The caller must first verify the complete shard raw
 * byte length and SHA-256 against the validated manifest. This still validates
 * every member key and envelope, but hashes and parses only the requested
 * payload so unrelated members do not multiply Worker CPU cost.
 */
export function stockanalysisEtfPayloadDocumentResultFromVerifiedShard(shard, value, expectedMemberCount) {
  const ticker = stockanalysisEtfTickerKey(value);
  const record = asRecord(shard);
  if (
    !record
    || record.schema_version !== STOCKANALYSIS_ETF_SHARD_SCHEMA
    || record.shard_algorithm !== STOCKANALYSIS_ETF_SHARD_ALGORITHM
    || record.shard_count !== STOCKANALYSIS_ETF_SHARD_COUNT
    || record.shard_id !== stockanalysisEtfShardId(ticker)
    || !Number.isInteger(expectedMemberCount)
    || expectedMemberCount < 0
  ) return { kind: "shard_integrity_unavailable", reason: "invalid_shard_envelope" };
  const entries = asRecord(record.entries);
  if (!entries) return { kind: "shard_integrity_unavailable", reason: "invalid_shard_entries" };
  const memberKeys = Object.keys(entries);
  if (memberKeys.length !== expectedMemberCount) {
    return { kind: "shard_integrity_unavailable", reason: "shard_member_count_mismatch" };
  }

  let selectedEntry = null;
  for (const memberTicker of memberKeys) {
    let canonicalTicker;
    try {
      canonicalTicker = stockanalysisEtfTickerKey(memberTicker);
    } catch {
      return { kind: "shard_integrity_unavailable", reason: "invalid_member_ticker" };
    }
    if (canonicalTicker !== memberTicker || stockanalysisEtfShardId(memberTicker) !== record.shard_id) {
      return { kind: "shard_integrity_unavailable", reason: "wrong_shard_membership" };
    }
    const entry = asRecord(entries[memberTicker]);
    if (
      !entry
      || !SHA256_PATTERN.test(entry.sha256 ?? "")
    ) {
      return { kind: "shard_integrity_unavailable", reason: "invalid_member_envelope" };
    }
    if (memberTicker === ticker) selectedEntry = entry;
  }
  if (!selectedEntry) return { kind: "ticker_not_found" };
  if (
    typeof selectedEntry.raw !== "string"
    || sha256Text(selectedEntry.raw) !== selectedEntry.sha256
  ) {
    return { kind: "shard_integrity_unavailable", reason: "invalid_member_digest" };
  }
  let payload;
  try {
    payload = JSON.parse(selectedEntry.raw);
  } catch {
    return { kind: "shard_integrity_unavailable", reason: "invalid_embedded_json" };
  }
  if (!strictStockanalysisEtfPayload(payload, ticker)) {
    return { kind: "shard_integrity_unavailable", reason: "invalid_embedded_identity" };
  }
  return { kind: "ok", document: { raw: selectedEntry.raw, value: payload } };
}

export function stockanalysisEtfPayloadFromShard(shard, value) {
  return stockanalysisEtfPayloadDocumentFromShard(shard, value)?.value ?? null;
}
