const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export const MAX_DATA_SHARD_INDEX_BYTES = 64 * 1024;
export const MAX_DATA_SHARD_BYTES = 25 * 1024 * 1024;

export const PUBLIC_DATA_SHARD_FAMILIES = Object.freeze([
  Object.freeze({
    root: "computed/data-supply/etf-detail/payloads",
    bucketCount: 256,
    excludedNames: Object.freeze([]),
  }),
  Object.freeze({
    root: "yf/finance",
    bucketCount: 256,
    excludedNames: Object.freeze(["_summary.json"]),
  }),
  Object.freeze({
    root: "global-scouter/stocks/detail",
    bucketCount: 64,
    excludedNames: Object.freeze([]),
  }),
  Object.freeze({
    root: "slickcharts/stocks",
    bucketCount: 64,
    excludedNames: Object.freeze([]),
  }),
  Object.freeze({
    root: "edgar-korean-summaries/pilot",
    bucketCount: 32,
    excludedNames: Object.freeze([]),
  }),
  Object.freeze({
    root: "edgar-korean-summaries/translations",
    bucketCount: 32,
    excludedNames: Object.freeze([]),
  }),
  Object.freeze({
    root: "edgar-korean-summaries/by-ticker",
    bucketCount: 32,
    excludedNames: Object.freeze([]),
  }),
]);

const FNPK_MAGIC = [0x46, 0x4e, 0x50, 0x4b];
const SHA256_HEX = /^[0-9a-f]{64}$/;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecordTuple(value, maximumEnd) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error("Invalid FNPK index record tuple");
  }

  const [offset, length, sha256] = value;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    offset > maximumEnd ||
    length > maximumEnd - offset
  ) {
    throw new Error("Invalid FNPK index record bounds");
  }
  if (typeof sha256 !== "string" || !SHA256_HEX.test(sha256)) {
    throw new Error("Invalid FNPK index record SHA-256");
  }
  return [offset, length, sha256];
}

function copyAndValidateIndex(index, maximumEnd) {
  if (!isPlainObject(index)) {
    throw new Error("FNPK index must be a plain object");
  }

  const safeIndex = Object.create(null);
  for (const key of Reflect.ownKeys(index)) {
    if (typeof key !== "string") {
      throw new Error("FNPK index keys must be strings");
    }
    const descriptor = Object.getOwnPropertyDescriptor(index, key);
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, "value")) {
      throw new Error("FNPK index entries must be enumerable data properties");
    }
    safeIndex[key] = assertRecordTuple(descriptor.value, maximumEnd);
  }
  return safeIndex;
}

function validateDecodedIndex(index, bodyOffset) {
  if (!isPlainObject(index)) {
    throw new Error("FNPK index must be a plain object");
  }

  const maximumEnd = MAX_DATA_SHARD_BYTES - bodyOffset;
  if (maximumEnd < 0) {
    throw new Error("FNPK header exceeds the bucket byte limit");
  }

  for (const key of Object.keys(index)) {
    const descriptor = Object.getOwnPropertyDescriptor(index, key);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      throw new Error("FNPK index entries must be data properties");
    }
    assertRecordTuple(descriptor.value, maximumEnd);
  }
}

function decodeUtf8(bytes, label) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new Error(`Invalid UTF-8 in FNPK ${label}`);
  }
}

function parseIndex(indexBytes) {
  let parsed;
  try {
    parsed = JSON.parse(decodeUtf8(indexBytes, "index"));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid UTF-8")) {
      throw error;
    }
    throw new Error("Invalid JSON in FNPK index");
  }
  return parsed;
}

function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.subtle.digest !== "function") {
    throw new Error("Web Crypto SHA-256 is unavailable");
  }
  return cryptoApi;
}

function bytesToHex(bytes) {
  let result = "";
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, "0");
  }
  return result;
}

function hasForbiddenPathCharacter(value) {
  return /[\\/?#\u0000-\u001f\u007f]/u.test(value);
}

function hasForbiddenRawPathCharacter(value) {
  return /[\\?#\u0000-\u001f\u007f]/u.test(value);
}

function decodePathSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (
    decoded.length === 0 ||
    decoded === "." ||
    decoded === ".." ||
    hasForbiddenPathCharacter(decoded)
  ) {
    return null;
  }
  return decoded;
}

async function bucketForStem(stem, bucketCount) {
  const digest = new Uint8Array(
    await getCrypto().subtle.digest("SHA-256", encoder.encode(stem)),
  );
  const firstFourBytes = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  ).getUint32(0, false);
  return firstFourBytes % bucketCount;
}

export async function resolveLegacyDataShard(pathname) {
  if (
    typeof pathname !== "string" ||
    !pathname.startsWith("/data/") ||
    hasForbiddenRawPathCharacter(pathname)
  ) {
    return null;
  }

  const rawSegments = pathname.split("/");
  if (rawSegments[0] !== "" || rawSegments[1] !== "data") {
    return null;
  }

  const segments = ["", "data"];
  for (const rawSegment of rawSegments.slice(2)) {
    const segment = decodePathSegment(rawSegment);
    if (segment === null) {
      return null;
    }
    segments.push(segment);
  }

  for (const family of PUBLIC_DATA_SHARD_FAMILIES) {
    const rootSegments = family.root.split("/");
    if (segments.length !== rootSegments.length + 3) {
      continue;
    }

    let rootMatches = true;
    for (let index = 0; index < rootSegments.length; index += 1) {
      if (segments[index + 2] !== rootSegments[index]) {
        rootMatches = false;
        break;
      }
    }
    if (!rootMatches) {
      continue;
    }

    const filename = segments[segments.length - 1];
    if (
      !filename.endsWith(".json") ||
      filename.length === ".json".length ||
      family.excludedNames.includes(filename)
    ) {
      return null;
    }

    const stem = filename.slice(0, -".json".length);
    const bucket = await bucketForStem(stem, family.bucketCount);
    const bucketName = bucket.toString(16).padStart(2, "0");
    return {
      root: family.root,
      stem,
      bucketPath: `/data/${family.root}/_shards/${bucketName}.bin`,
    };
  }

  return null;
}

export function encodeDataShardHeader(index) {
  const safeIndex = copyAndValidateIndex(index, MAX_DATA_SHARD_BYTES);
  const json = JSON.stringify(safeIndex);
  const indexBytes = encoder.encode(json);
  if (indexBytes.byteLength > MAX_DATA_SHARD_INDEX_BYTES) {
    throw new Error("FNPK index exceeds 64 KiB");
  }

  const bodyOffset = 8 + indexBytes.byteLength;
  validateDecodedIndex(safeIndex, bodyOffset);

  const header = new Uint8Array(bodyOffset);
  header.set(FNPK_MAGIC, 0);
  new DataView(header.buffer, header.byteOffset, header.byteLength).setUint32(
    4,
    indexBytes.byteLength,
    false,
  );
  header.set(indexBytes, 8);
  return header;
}

export function decodeDataShardHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) {
    throw new Error("Truncated FNPK header");
  }
  for (let index = 0; index < FNPK_MAGIC.length; index += 1) {
    if (bytes[index] !== FNPK_MAGIC[index]) {
      throw new Error("Invalid FNPK magic");
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const indexLength = view.getUint32(4, false);
  if (indexLength > MAX_DATA_SHARD_INDEX_BYTES) {
    throw new Error("FNPK index exceeds 64 KiB");
  }

  const bodyOffset = 8 + indexLength;
  if (bytes.byteLength < bodyOffset) {
    throw new Error("Truncated FNPK index");
  }
  if (bodyOffset > MAX_DATA_SHARD_BYTES) {
    throw new Error("FNPK header exceeds the bucket byte limit");
  }

  const index = parseIndex(bytes.subarray(8, bodyOffset));
  validateDecodedIndex(index, bodyOffset);
  return { index, bodyOffset };
}

function createStreamCursor(reader) {
  let chunk = null;
  let chunkOffset = 0;
  let bytesPulled = 0;

  async function ensureChunk() {
    while (chunk === null || chunkOffset >= chunk.byteLength) {
      const result = await reader.read();
      if (result.done) {
        chunk = null;
        chunkOffset = 0;
        return false;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw new Error("FNPK body stream yielded a non-Uint8Array chunk");
      }
      if (result.value.byteLength === 0) {
        continue;
      }
      if (result.value.byteLength > MAX_DATA_SHARD_BYTES - bytesPulled) {
        throw new Error("FNPK bucket exceeds 25 MiB");
      }
      bytesPulled += result.value.byteLength;
      chunk = result.value;
      chunkOffset = 0;
    }
    return true;
  }

  return {
    async readExactly(length) {
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DATA_SHARD_BYTES) {
        throw new Error("Invalid FNPK read length");
      }
      const output = new Uint8Array(length);
      let written = 0;
      while (written < length) {
        if (!(await ensureChunk())) {
          throw new Error("Truncated FNPK body");
        }
        const take = Math.min(length - written, chunk.byteLength - chunkOffset);
        output.set(chunk.subarray(chunkOffset, chunkOffset + take), written);
        chunkOffset += take;
        written += take;
      }
      return output;
    },
    async skipExactly(length) {
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_DATA_SHARD_BYTES) {
        throw new Error("Invalid FNPK skip length");
      }
      let remaining = length;
      while (remaining > 0) {
        if (!(await ensureChunk())) {
          throw new Error("Truncated FNPK body");
        }
        const take = Math.min(remaining, chunk.byteLength - chunkOffset);
        chunkOffset += take;
        remaining -= take;
      }
    },
  };
}

export async function readDataShardRecord(body, stem) {
  if (typeof stem !== "string") {
    throw new TypeError("FNPK record stem must be a string");
  }
  if (!body || typeof body.getReader !== "function") {
    throw new TypeError("FNPK body must be a ReadableStream");
  }

  const reader = body.getReader();
  try {
    const cursor = createStreamCursor(reader);
    const prefix = await cursor.readExactly(8);
    const prefixView = new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength);
    if (
      prefix[0] !== FNPK_MAGIC[0] ||
      prefix[1] !== FNPK_MAGIC[1] ||
      prefix[2] !== FNPK_MAGIC[2] ||
      prefix[3] !== FNPK_MAGIC[3]
    ) {
      throw new Error("Invalid FNPK magic");
    }
    const indexLength = prefixView.getUint32(4, false);
    if (indexLength > MAX_DATA_SHARD_INDEX_BYTES) {
      throw new Error("FNPK index exceeds 64 KiB");
    }

    const indexBytes = await cursor.readExactly(indexLength);
    const header = new Uint8Array(8 + indexLength);
    header.set(prefix, 0);
    header.set(indexBytes, 8);
    const { index } = decodeDataShardHeader(header);

    if (!hasOwn(index, stem)) {
      return null;
    }
    const [bodyRelativeOffset, rawByteLength, expectedSha256] = index[stem];
    await cursor.skipExactly(bodyRelativeOffset);
    const bytes = await cursor.readExactly(rawByteLength);
    const actualSha256 = bytesToHex(
      new Uint8Array(await getCrypto().subtle.digest("SHA-256", bytes)),
    );
    if (actualSha256 !== expectedSha256) {
      throw new Error("FNPK record SHA-256 mismatch");
    }
    return { bytes, sha256: expectedSha256 };
  } finally {
    try {
      await reader.cancel();
    } catch {
      // Keep the parse or verification error when cancellation also fails.
    }
    try {
      reader.releaseLock();
    } catch {
      // A completed or errored stream can already have released this reader.
    }
  }
}
