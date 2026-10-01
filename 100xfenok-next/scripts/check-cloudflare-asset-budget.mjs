#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STOCKANALYSIS_ETF_SHARD_COMPATIBILITY_MODE,
  STOCKANALYSIS_ETF_SHARD_COUNT,
  stockanalysisEtfManifestSha256,
  stockanalysisEtfShardManifestIsValid,
} from "../src/lib/stockanalysis-etf-shard.mjs";
import {
  decodeDataShardHeader,
  MAX_DATA_SHARD_BYTES,
  MAX_DATA_SHARD_INDEX_BYTES,
} from "../src/lib/public-data-binary-shard.mjs";

const STOCKANALYSIS_ETF_SHARD_ONLY_MODE = "shard-only";
const DATA_SUPPLY_ETF_DETAIL_PREFIX = "data/computed/data-supply/etf-detail/";
const DATA_SUPPLY_ETF_DETAIL_RAW_PAYLOAD_PATTERN = /^data\/computed\/data-supply\/etf-detail\/payloads\/[^/]+\.json$/;
const DATA_SUPPLY_ETF_DETAIL_PACKED_PAYLOAD_PATTERN = /^data\/computed\/data-supply\/etf-detail\/payloads\/_shards\/([0-9a-f]{2})\.bin$/;
const DATA_SUPPLY_ETF_DETAIL_TICKER_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export const DEFAULT_ASSET_LIMIT = 20_000;
export const DEFAULT_ASSET_WARNING_LIMIT = 19_000;

function atomicWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  JSON.parse(fs.readFileSync(temporary, "utf8"));
  fs.renameSync(temporary, filePath);
}

function collectRegularFiles(assetRoot) {
  const files = [];
  const canonicalPaths = new Map();

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) throw new Error(`asset tree contains symlink: ${absolutePath}`);
      if (stat.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!stat.isFile()) throw new Error(`asset tree contains special file: ${absolutePath}`);
      const relativePath = path.relative(assetRoot, absolutePath).split(path.sep).join("/");
      const canonical = relativePath.normalize("NFC").toLowerCase();
      const previous = canonicalPaths.get(canonical);
      if (previous && previous !== relativePath) {
        throw new Error(`duplicate manifest path after canonicalization: ${previous} / ${relativePath}`);
      }
      canonicalPaths.set(canonical, relativePath);
      files.push({ relativePath, size: stat.size });
    }
  }

  visit(assetRoot);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function projectionCounts(files) {
  const prefix = DATA_SUPPLY_ETF_DETAIL_PREFIX;
  const projection = files.filter((item) => item.relativePath.startsWith(prefix));
  const enrollmentFiles = projection.filter((item) => item.relativePath === prefix + "enrollment.json").length;
  const indexFiles = projection.filter((item) => item.relativePath === prefix + "index.json").length;
  const payloadFiles = projection.filter((item) => DATA_SUPPLY_ETF_DETAIL_RAW_PAYLOAD_PATTERN.test(item.relativePath)).length;
  const packedFiles = projection.filter((item) => DATA_SUPPLY_ETF_DETAIL_PACKED_PAYLOAD_PATTERN.test(item.relativePath)).length;
  if (payloadFiles > 0 && packedFiles > 0) {
    throw new Error("R2.4 asset projection mixes raw payloads and packed shards");
  }
  const recognized = enrollmentFiles + indexFiles + payloadFiles + packedFiles;
  if (recognized !== projection.length) {
    const unknown = projection.filter((item) => (
      item.relativePath !== prefix + "enrollment.json"
      && item.relativePath !== prefix + "index.json"
      && !DATA_SUPPLY_ETF_DETAIL_RAW_PAYLOAD_PATTERN.test(item.relativePath)
      && !DATA_SUPPLY_ETF_DETAIL_PACKED_PAYLOAD_PATTERN.test(item.relativePath)
    ));
    throw new Error("unexpected R2.4 projection assets: " + unknown.map((item) => item.relativePath).join(", "));
  }
  const counts = {
    enrollment_files: enrollmentFiles,
    index_files: indexFiles,
    payload_files: payloadFiles,
    total_files: projection.length,
  };
  if (packedFiles > 0) counts.packed_files = packedFiles;
  return counts;
}

function readExactly(fd, length, position) {
  const bytes = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const count = fs.readSync(fd, bytes, offset, length - offset, position + offset);
    if (count === 0) throw new Error("unexpected end of packed shard while reading its header");
    offset += count;
  }
  return bytes;
}

function tickerBucketId(ticker) {
  const firstFourDigestBytes = crypto.createHash("sha256").update(ticker, "utf8").digest().readUInt32BE(0);
  return (firstFourDigestBytes % 256).toString(16).padStart(2, "0");
}

function readPackedShardHeader(assetRoot, file, bucketId) {
  const absolutePath = path.join(assetRoot, ...file.relativePath.split("/"));
  const fd = fs.openSync(absolutePath, "r");
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error("packed shard must be a regular file: " + file.relativePath);
    if (stat.size !== file.size) throw new Error("packed shard size changed while checking assets: " + file.relativePath);
    if (stat.size > MAX_DATA_SHARD_BYTES) throw new Error("packed shard exceeds byte limit: " + file.relativePath);
    if (stat.size < 8) throw new Error("packed shard header is truncated: " + file.relativePath);

    const fixedHeader = readExactly(fd, 8, 0);
    if (fixedHeader.toString("ascii", 0, 4) !== "FNPK") {
      throw new Error("packed shard magic is invalid: " + file.relativePath);
    }
    const indexBytesLength = fixedHeader.readUInt32BE(4);
    if (indexBytesLength === 0 || indexBytesLength > MAX_DATA_SHARD_INDEX_BYTES) {
      throw new Error("packed shard index length is invalid: " + file.relativePath);
    }
    const bodyOffset = 8 + indexBytesLength;
    if (bodyOffset > stat.size) throw new Error("packed shard index is truncated: " + file.relativePath);

    const header = Buffer.alloc(bodyOffset);
    fixedHeader.copy(header, 0);
    readExactly(fd, indexBytesLength, 8).copy(header, 8);
    const decoded = decodeDataShardHeader(header);
    if (!decoded || !decoded.index || typeof decoded.index !== "object" || Array.isArray(decoded.index)) {
      throw new Error("packed shard index must be an object: " + file.relativePath);
    }
    if (decoded.bodyOffset !== bodyOffset) {
      throw new Error("packed shard body offset is inconsistent: " + file.relativePath);
    }

    const indexText = new TextDecoder("utf-8", { fatal: true }).decode(header.subarray(8));
    const textualKeys = [...indexText.matchAll(/"([^"\\]*)"\s*:/g)].map((match) => match[1]);
    const indexKeys = Object.keys(decoded.index);
    if (textualKeys.length !== indexKeys.length) {
      throw new Error("packed shard index has duplicate or invalid keys: " + file.relativePath);
    }
    const seenKeys = new Set();
    for (const ticker of textualKeys) {
      if (!DATA_SUPPLY_ETF_DETAIL_TICKER_PATTERN.test(ticker)) {
        throw new Error("packed shard has an invalid ticker key: " + ticker);
      }
      if (seenKeys.has(ticker)) throw new Error("packed shard repeats ticker " + ticker);
      seenKeys.add(ticker);
    }
    if (indexKeys.some((ticker) => !seenKeys.has(ticker))) {
      throw new Error("packed shard index keys cannot be reconciled: " + file.relativePath);
    }
    if (indexKeys.length === 0) throw new Error("packed shard contains no payload entries: " + file.relativePath);

    return {
      index: decoded.index,
      bodyOffset,
      bodyBytes: stat.size - bodyOffset,
      filePath: file.relativePath,
      bucketId,
    };
  } catch (error) {
    if (error.message.startsWith("packed shard")) throw error;
    throw new Error("packed shard header is invalid (" + file.relativePath + "): " + error.message);
  } finally {
    fs.closeSync(fd);
  }
}

function selectedIndexEntries(index) {
  if (!index.entries || typeof index.entries !== "object" || Array.isArray(index.entries)) {
    throw new Error("R2.4 packed asset index entries are invalid");
  }
  const selected = new Map();
  for (const [ticker, entry] of Object.entries(index.entries)) {
    if (!DATA_SUPPLY_ETF_DETAIL_TICKER_PATTERN.test(ticker)) {
      throw new Error("R2.4 asset index has an invalid ticker key: " + ticker);
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || entry.ticker !== ticker) {
      throw new Error("R2.4 asset index entry is invalid: " + ticker);
    }
    if (entry.payload_path === null && entry.payload_sha256 === null) continue;
    if (entry.payload_path !== "payloads/" + ticker + ".json" || !SHA256_HEX_PATTERN.test(entry.payload_sha256 || "")) {
      throw new Error("R2.4 asset index selected payload metadata is invalid: " + ticker);
    }
    selected.set(ticker, entry.payload_sha256);
  }
  if (selected.size !== index.selected_count) {
    throw new Error("R2.4 asset index selected_count mismatch: declared=" + index.selected_count + ", entries=" + selected.size);
  }
  return selected;
}

function validatePackedProjection(assetRoot, counts, files, index) {
  if (counts.packed_files > 256) {
    throw new Error("R2.4 packed asset projection exceeds 256 buckets: " + counts.packed_files);
  }
  if (counts.total_files !== counts.packed_files + 2) {
    throw new Error("R2.4 packed asset projection count mismatch: " + JSON.stringify(counts));
  }

  const selected = selectedIndexEntries(index);
  const packedFiles = files.filter((item) => DATA_SUPPLY_ETF_DETAIL_PACKED_PAYLOAD_PATTERN.test(item.relativePath));
  const seenTickers = new Set();
  for (const file of packedFiles) {
    const bucketId = DATA_SUPPLY_ETF_DETAIL_PACKED_PAYLOAD_PATTERN.exec(file.relativePath)[1];
    const shard = readPackedShardHeader(assetRoot, file, bucketId);
    const intervals = [];
    for (const [ticker, row] of Object.entries(shard.index)) {
      if (!DATA_SUPPLY_ETF_DETAIL_TICKER_PATTERN.test(ticker)) {
        throw new Error("packed shard has an invalid ticker key: " + ticker);
      }
      if (seenTickers.has(ticker)) throw new Error("packed shard repeats ticker across buckets: " + ticker);
      if (tickerBucketId(ticker) !== shard.bucketId) {
        throw new Error("packed shard ticker is routed to the wrong bucket: " + ticker);
      }
      const expectedSha256 = selected.get(ticker);
      if (!expectedSha256) throw new Error("packed shard contains a ticker absent from selected index entries: " + ticker);
      if (!Array.isArray(row) || row.length !== 3) {
        throw new Error("packed shard record metadata is invalid: " + ticker);
      }
      const [offset, byteLength, sha256] = row;
      if (
        !Number.isSafeInteger(offset)
        || offset < 0
        || !Number.isSafeInteger(byteLength)
        || byteLength <= 0
        || !SHA256_HEX_PATTERN.test(sha256 || "")
        || !Number.isSafeInteger(offset + byteLength)
        || offset + byteLength > shard.bodyBytes
      ) {
        throw new Error("packed shard record bounds or digest are invalid: " + ticker);
      }
      if (sha256 !== expectedSha256) {
        throw new Error("packed shard digest differs from selected index entry: " + ticker);
      }
      seenTickers.add(ticker);
      intervals.push({ start: offset, end: offset + byteLength });
    }
    intervals.sort((left, right) => left.start - right.start);
    let coveredBytes = 0;
    for (const interval of intervals) {
      if (interval.start !== coveredBytes) {
        throw new Error("packed shard body has a gap or overlapping records: " + file.relativePath);
      }
      coveredBytes = interval.end;
    }
    if (coveredBytes !== shard.bodyBytes) {
      throw new Error("packed shard body has unindexed bytes: " + file.relativePath);
    }
  }

  if (seenTickers.size !== selected.size) {
    const missing = [...selected.keys()].filter((ticker) => !seenTickers.has(ticker));
    throw new Error("packed shard members differ from selected index entries; missing=" + missing.length);
  }
  return {
    enrollment_files: counts.enrollment_files,
    index_files: counts.index_files,
    payload_files: index.selected_count,
    total_files: counts.total_files,
    packed_files: counts.packed_files,
  };
}

function validateProjectionCounts(assetRoot, counts, files) {
  if (counts.enrollment_files !== 1 || counts.index_files !== 1) {
    throw new Error("R2.4 asset projection requires one enrollment and one index file: " + JSON.stringify(counts));
  }
  const indexPath = path.join(assetRoot, "data", "computed", "data-supply", "etf-detail", "index.json");
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    throw new Error("R2.4 asset index is invalid JSON: " + error.message);
  }
  if (!Number.isInteger(index?.selected_count) || index.selected_count < 0) {
    throw new Error("R2.4 asset index selected_count is invalid");
  }
  if (Object.prototype.hasOwnProperty.call(counts, "packed_files")) {
    return validatePackedProjection(assetRoot, counts, files, index);
  }
  if (counts.payload_files !== index.selected_count || counts.total_files !== index.selected_count + 2) {
    throw new Error("R2.4 asset projection count mismatch: index=" + index.selected_count + ", files=" + JSON.stringify(counts));
  }
  return counts;
}

function validateGeneratedDataManifest(assetRoot) {
  const manifestPath = path.join(assetRoot, "generated", "data-json-files-manifest.json");
  if (!fs.existsSync(manifestPath)) return { present: false, path_count: 0 };
  const stat = fs.lstatSync(manifestPath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`generated data manifest must be a regular file: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`generated data manifest is invalid JSON: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("generated data manifest must be an object");
  const seen = new Set();
  let count = 0;
  for (const [directory, rows] of Object.entries(manifest)) {
    if (!Array.isArray(rows)) throw new Error(`generated data manifest directory ${directory} must be an array`);
    for (const row of rows) {
      if (!row || typeof row.name !== "string" || !row.name.trim()) throw new Error(`generated data manifest entry in ${directory} has no name`);
      const relativePath = path.posix.normalize(path.posix.join(directory, row.name));
      if (relativePath.startsWith("../") || path.posix.isAbsolute(relativePath)) throw new Error(`generated data manifest path escapes data root: ${relativePath}`);
      const canonical = relativePath.normalize("NFC").toLowerCase();
      if (seen.has(canonical)) throw new Error(`duplicate manifest path: ${relativePath}`);
      seen.add(canonical);
      count += 1;
    }
  }
  return { present: true, path_count: count };
}

function collectDirectLegacyEtfFiles(root, label) {
  const directory = path.join(root, "data", "stockanalysis", "etfs");
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} StockAnalysis ETF root must be a real directory: ${directory}`);
  }
  const files = new Map();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.name.endsWith(".json")) continue;
    const absolutePath = path.join(directory, entry.name);
    const entryStat = fs.lstatSync(absolutePath);
    if (entryStat.isSymbolicLink() || !entryStat.isFile()) {
      throw new Error(`${label} legacy ETF fallback must be a regular file: ${absolutePath}`);
    }
    files.set(entry.name, { absolutePath, size: entryStat.size });
  }
  return files;
}

function isPublicStockanalysisEtfManifestValid(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  const originalDigestValid = manifest.manifest_sha256 === stockanalysisEtfManifestSha256(manifest);
  if (!originalDigestValid) return false;
  if (stockanalysisEtfShardManifestIsValid(manifest)) return true;
  if (manifest.compatibility_mode !== STOCKANALYSIS_ETF_SHARD_ONLY_MODE) return false;
  // The runtime validator in older checkouts only knows legacy-fallback. Run
  // that structural validator against an equivalent mode while preserving the
  // original digest check above; newer runtimes validate shard-only directly.
  const legacyEquivalent = { ...manifest, compatibility_mode: STOCKANALYSIS_ETF_SHARD_COMPATIBILITY_MODE };
  legacyEquivalent.manifest_sha256 = stockanalysisEtfManifestSha256(legacyEquivalent);
  return stockanalysisEtfShardManifestIsValid(legacyEquivalent);
}

function validateStockanalysisEtfShardAssets(assetRoot, files, expectedPublicRoot) {
  const prefix = "data/stockanalysis/etfs/shards/";
  const projected = files.filter((item) => item.relativePath.startsWith(prefix));
  if (projected.length === 0) {
    throw new Error("StockAnalysis ETF shard projection is missing from emitted assets");
  }
  const byPath = new Map(projected.map((item) => [item.relativePath, item]));
  const manifestRelativePath = `${prefix}index.json`;
  const manifestFile = byPath.get(manifestRelativePath);
  if (!manifestFile) throw new Error("StockAnalysis ETF shard manifest is missing from emitted assets");
  const emittedManifestPath = path.join(assetRoot, ...manifestRelativePath.split("/"));
  const expectedManifestPath = path.join(expectedPublicRoot, ...manifestRelativePath.split("/"));
  const expectedManifestStat = fs.lstatSync(expectedManifestPath);
  if (expectedManifestStat.isSymbolicLink() || !expectedManifestStat.isFile()) {
    throw new Error(`current public StockAnalysis ETF shard manifest must be a regular file: ${expectedManifestPath}`);
  }
  const emittedManifestBytes = fs.readFileSync(emittedManifestPath);
  const expectedManifestBytes = fs.readFileSync(expectedManifestPath);
  if (!emittedManifestBytes.equals(expectedManifestBytes)) {
    throw new Error("StockAnalysis ETF emitted shard manifest differs from the current public projection");
  }
  let manifest;
  try {
    manifest = JSON.parse(emittedManifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`StockAnalysis ETF emitted shard manifest is invalid JSON: ${error.message}`);
  }
  if (!isPublicStockanalysisEtfManifestValid(manifest)) {
    throw new Error("StockAnalysis ETF emitted shard manifest contract is invalid");
  }
  const expectedPaths = new Set([manifestRelativePath]);
  let largest = { byte_length: 0, member_count: 0, path: null };
  for (const entry of manifest.shards) {
    const relativePath = `${prefix}${entry.path}`;
    expectedPaths.add(relativePath);
    const file = byPath.get(relativePath);
    if (!file) throw new Error(`StockAnalysis ETF emitted shard is missing: ${relativePath}`);
    const absolutePath = path.join(assetRoot, ...relativePath.split("/"));
    const bytes = fs.readFileSync(absolutePath);
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    if (file.size !== entry.byte_length || bytes.length !== entry.byte_length || digest !== entry.sha256) {
      throw new Error(`StockAnalysis ETF emitted shard hash/byte-length mismatch: ${relativePath}`);
    }
    if (entry.byte_length > largest.byte_length) {
      largest = {
        byte_length: entry.byte_length,
        member_count: entry.member_count,
        path: relativePath,
      };
    }
  }
  for (const relativePath of byPath.keys()) {
    if (!expectedPaths.has(relativePath)) {
      throw new Error(`StockAnalysis ETF emitted shard projection has an unlisted asset: ${relativePath}`);
    }
  }
  if (manifest.shards.length !== STOCKANALYSIS_ETF_SHARD_COUNT || projected.length !== STOCKANALYSIS_ETF_SHARD_COUNT + 1) {
    throw new Error(`StockAnalysis ETF emitted shard asset count mismatch: manifest=${manifest.shards.length}, assets=${projected.length}`);
  }
  const emittedLegacy = collectDirectLegacyEtfFiles(assetRoot, "emitted asset");
  const expectedLegacy = collectDirectLegacyEtfFiles(expectedPublicRoot, "current public");
  const emittedNames = [...emittedLegacy.keys()].sort();
  const expectedNames = [...expectedLegacy.keys()].sort();
  if (manifest.compatibility_mode === STOCKANALYSIS_ETF_SHARD_ONLY_MODE) {
    if (emittedNames.length !== 0 || expectedNames.length !== 0) {
      throw new Error(`StockAnalysis ETF shard-only projection requires zero direct ETF assets: emitted=${emittedNames.length}, expected=${expectedNames.length}`);
    }
  } else {
    if (JSON.stringify(emittedNames) !== JSON.stringify(expectedNames)) {
      throw new Error(`StockAnalysis ETF emitted legacy fallback set differs from current public projection: emitted=${emittedNames.length}, expected=${expectedNames.length}`);
    }
    for (const name of expectedNames) {
      const emitted = emittedLegacy.get(name);
      const expected = expectedLegacy.get(name);
      if (
        emitted.size !== expected.size
        || !fs.readFileSync(emitted.absolutePath).equals(fs.readFileSync(expected.absolutePath))
      ) {
        throw new Error(`StockAnalysis ETF emitted legacy fallback bytes differ from current public projection: ${name}`);
      }
    }
  }
  return {
    manifest_files: 1,
    shard_files: manifest.shards.length,
    total_files: projected.length,
    payload_count: manifest.payload_count,
    snapshot_id: manifest.snapshot_id,
    source_manifest_sha256: crypto.createHash("sha256").update(expectedManifestBytes).digest("hex"),
    legacy_fallback_files: emittedLegacy.size,
    largest_shard_bytes: largest.byte_length,
    largest_shard_member_count: largest.member_count,
    largest_shard_path: largest.path,
  };
}

export function inspectCloudflareAssetBudget({
  assetRoot,
  reportPath,
  expectedPublicRoot = null,
  limit = DEFAULT_ASSET_LIMIT,
  warningLimit = null,
}) {
  const root = path.resolve(assetRoot);
  const report = path.resolve(reportPath);
  const expectedRoot = path.resolve(expectedPublicRoot || path.join(path.dirname(path.dirname(root)), "public"));
  const relativeReport = path.relative(root, report);
  if (!relativeReport.startsWith("..") || path.isAbsolute(relativeReport)) {
    throw new Error(`asset budget report must live outside asset root: ${report}`);
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`counted asset root must be a real directory: ${root}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`asset limit must be a positive integer: ${limit}`);
  const effectiveWarningLimit = warningLimit ?? Math.min(DEFAULT_ASSET_WARNING_LIMIT, limit - 1);
  if (!Number.isInteger(effectiveWarningLimit) || effectiveWarningLimit <= 0 || effectiveWarningLimit >= limit) {
    throw new Error(`asset warning limit must be a positive integer below the hard limit: ${effectiveWarningLimit}`);
  }

  const files = collectRegularFiles(root);
  const generatedDataManifest = validateGeneratedDataManifest(root);
  const count = files.length;
  const dataSupplyProjection = validateProjectionCounts(root, projectionCounts(files), files);
  const stockanalysisEtfShards = validateStockanalysisEtfShardAssets(root, files, expectedRoot);
  const payload = {
    schema_version: "cloudflare-asset-budget/v1",
    counted_root: root,
    regular_file_count: count,
    limit,
    headroom: limit - count,
    warning_limit: effectiveWarningLimit,
    warning_headroom: effectiveWarningLimit - count,
    safety_status: count >= effectiveWarningLimit ? "warning" : "pass",
    status: count < limit ? "pass" : "fail",
    data_supply_projection: dataSupplyProjection,
    stockanalysis_etf_shards: stockanalysisEtfShards,
    generated_data_manifest: generatedDataManifest,
  };
  atomicWriteJson(report, payload);
  if (count >= limit) {
    throw new Error(`Cloudflare asset limit reached: ${count} >= ${limit}; report=${report}`);
  }
  return payload;
}

function getArg(name) {
  const exact = process.argv.indexOf(name);
  if (exact >= 0 && exact + 1 < process.argv.length) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const item = process.argv.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = inspectCloudflareAssetBudget({
      assetRoot: getArg("--asset-root") || path.join(appRoot, ".open-next", "assets"),
      reportPath: getArg("--report") || path.join(appRoot, ".open-next", "asset-budget-report.json"),
      limit: Number(getArg("--limit") || DEFAULT_ASSET_LIMIT),
      warningLimit: Number(getArg("--warning-limit") || DEFAULT_ASSET_WARNING_LIMIT),
    });
    if (result.safety_status === "warning") {
      console.warn(`[check-cloudflare-asset-budget] safety warning: ${result.regular_file_count} assets leaves ${result.headroom} before the ${result.limit} hard limit`);
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[check-cloudflare-asset-budget] ${error.message}`);
    process.exit(1);
  }
}
