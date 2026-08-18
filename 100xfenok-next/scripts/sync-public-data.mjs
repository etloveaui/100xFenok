#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MARKET_FACTS_SHARD_COUNT,
  marketFactsShardFileName,
  marketFactsShardFileNameForId,
  marketFactsTickerKey,
} from "../src/lib/market-facts-shard.mjs";
import {
  STOCKANALYSIS_ETF_SHARD_ALGORITHM,
  STOCKANALYSIS_ETF_SHARD_COUNT,
  STOCKANALYSIS_ETF_SHARD_MAX_BYTES,
  STOCKANALYSIS_ETF_SHARD_MANIFEST_SCHEMA,
  STOCKANALYSIS_ETF_SHARD_SCHEMA,
  sha256Text,
  stockanalysisEtfManifestSha256,
  stockanalysisEtfShardFileNameForId,
  stockanalysisEtfShardId,
  stockanalysisEtfSnapshotId,
  stockanalysisEtfSourceBindingSha256,
  stockanalysisEtfTickerKey,
} from "../src/lib/stockanalysis-etf-shard.mjs";
import {
  DERIVED_ASSET_REGISTRY,
  derivedPrivateFileOutputs,
} from "../../scripts/lib/derived-asset-registry.mjs";
import {
  deriveExcludedPublicDataFiles,
  deriveExcludedPublicDataRoots,
} from "../../scripts/lib/lane-routing.mjs";
import { redactPrivateArtifactPathMirrors } from "../sync-static-overrides.mjs";

const CANONICAL_DATA_PREFIX = "data/";
const PUBLIC_DATA_PREFIX = "100xfenok-next/public/data/";

// Registry-derived #366 privacy boundary. A newly registered private admin
// store or file-shaped private canonical is excluded immediately instead of
// waiting for a second hand-list edit.
export const EXCLUDED_PUBLIC_DATA_ROOTS = Object.freeze(deriveExcludedPublicDataRoots());

// Exact-file exclusions combine the lane registry's private canonical files
// with the derived-asset registry's private single-file outputs. Directory-
// shaped derived assets use the restricted allowlist below; a file cannot be
// protected by directory traversal. Both registries are authoritative, so a
// new private file must be declared before the generic walk can copy it.
export function deriveRestrictedDerivedPublicDataFiles(registry = DERIVED_ASSET_REGISTRY) {
  return derivedPrivateFileOutputs(registry)
    .map((relativePath) => relativePath.slice(CANONICAL_DATA_PREFIX.length));
}

export const RESTRICTED_DERIVED_PUBLIC_DATA_FILES = Object.freeze(
  deriveRestrictedDerivedPublicDataFiles(),
);

export const EXCLUDED_PUBLIC_DATA_FILES = Object.freeze([
  ...new Set([
    ...deriveExcludedPublicDataFiles(),
    ...deriveRestrictedDerivedPublicDataFiles(),
  ]),
].sort());

// A directory-shaped derived asset may expose either its whole directory or a
// reviewed set of files. The latter is a fail-closed allowlist: adding another
// canonical child does not publish it until the registry explicitly names it.
export function deriveRestrictedDerivedPublicDataRoots(registry = DERIVED_ASSET_REGISTRY) {
  const policies = [];
  for (const asset of registry.assets) {
    for (const output of asset.outputs) {
      if (output.kind !== "directory" || !output.path.startsWith(CANONICAL_DATA_PREFIX)) continue;
      const relativeRoot = output.path.slice(CANONICAL_DATA_PREFIX.length);
      const publicSpecs = asset.public_outputs
        .filter((spec) => spec.path.startsWith(PUBLIC_DATA_PREFIX))
        .map((spec) => ({ ...spec, relativePath: spec.path.slice(PUBLIC_DATA_PREFIX.length) }))
        .filter((spec) => spec.relativePath === relativeRoot || spec.relativePath.startsWith(`${relativeRoot}/`));
      if (publicSpecs.some((spec) => spec.kind === "directory" && spec.relativePath === relativeRoot)) continue;
      policies.push({
        assetId: asset.id,
        relativeRoot,
        allowedFiles: publicSpecs
          .filter((spec) => spec.kind === "file")
          .map((spec) => spec.relativePath)
          .sort(),
      });
    }
  }
  return policies.sort((left, right) => left.relativeRoot.localeCompare(right.relativeRoot));
}

export const RESTRICTED_DERIVED_PUBLIC_DATA_ROOTS = Object.freeze(
  deriveRestrictedDerivedPublicDataRoots().map((policy) => Object.freeze({
    ...policy,
    allowedFiles: Object.freeze([...policy.allowedFiles]),
  })),
);

const MARKET_FACTS_TICKER_ROOT = "computed/market_facts/tickers";
const MARKET_FACTS_SHARD_ROOT = "computed/market_facts/shards";
const MARKET_FACTS_ROOT = "computed/market_facts";
const STOCKANALYSIS_ETF_ROOT = "stockanalysis/etfs";
const STOCKANALYSIS_ETF_SHARD_ROOT = "stockanalysis/etfs/shards";
// ETF detail files are canonical-only inputs. The public projection is shard-only;
// keep this as a local policy constant so a stale direct file cannot be copied
// back into public/data by the generic sync walk.
const STOCKANALYSIS_ETF_PUBLIC_MODE = "shard-only";

const IDENTITY_FIELDS = Object.freeze([
  "dev",
  "ino",
  "mode",
  "nlink",
  "uid",
  "gid",
  "rdev",
  "size",
  "blksize",
  "blocks",
  "mtimeNs",
  "ctimeNs",
  "birthtimeNs",
]);

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectory(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${filePath}`);
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory: ${filePath}`);
}

function lstatBigintIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function statIdentity(stat) {
  if (!stat) return null;
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, String(stat[field] ?? "")]));
}

function sameIdentity(left, right) {
  return IDENTITY_FIELDS.every((field) => left?.[field] === right?.[field]);
}

function captureSourceBinding(filePath, label, expectedKind) {
  const stat = lstatBigintIfPresent(filePath);
  if (!stat) throw new Error(`${label} is missing: ${filePath}`);
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${filePath}`);
  if (expectedKind === "directory" && !stat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${filePath}`);
  }
  if (expectedKind === "file" && !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  return { filePath, label, expectedKind, identity: statIdentity(stat) };
}

function revalidateSourceBindings(bindings, phase) {
  for (const binding of bindings) {
    const stat = lstatBigintIfPresent(binding.filePath);
    const identity = statIdentity(stat);
    const expectedKindMatches = binding.expectedKind === "directory"
      ? stat?.isDirectory()
      : stat?.isFile();
    if (stat?.isSymbolicLink() || !expectedKindMatches || !sameIdentity(binding.identity, identity)) {
      throw new Error(`source identity drift ${phase}: ${binding.label}: ${binding.filePath}`);
    }
  }
}

function readStableDirectoryEntries(binding) {
  revalidateSourceBindings([binding], "before directory enumeration");
  const entries = fs.readdirSync(binding.filePath, { withFileTypes: true });
  revalidateSourceBindings([binding], "after directory enumeration");
  return entries;
}

function normalizedRelative(relativePath) {
  const portable = String(relativePath).split(path.sep).join("/");
  const normalized = path.posix.normalize(portable).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error(`unsafe relative path: ${relativePath}`);
  }
  return normalized;
}

function isExcludedRoot(relativePath) {
  return EXCLUDED_PUBLIC_DATA_ROOTS.includes(normalizedRelative(relativePath));
}

function isCoveredByExcludedRoot(relativePath) {
  const normalized = normalizedRelative(relativePath);
  return EXCLUDED_PUBLIC_DATA_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function isExcludedFile(relativePath) {
  return EXCLUDED_PUBLIC_DATA_FILES.includes(normalizedRelative(relativePath));
}

function isTransformedRoot(relativePath) {
  return normalizedRelative(relativePath) === MARKET_FACTS_TICKER_ROOT;
}

function restrictedDerivedDisposition(relativePath, isDirectory) {
  const normalized = normalizedRelative(relativePath);
  for (const policy of RESTRICTED_DERIVED_PUBLIC_DATA_ROOTS) {
    if (normalized !== policy.relativeRoot && !normalized.startsWith(`${policy.relativeRoot}/`)) continue;
    if (normalized === policy.relativeRoot) return isDirectory ? "traverse" : "reject";
    if (isDirectory) {
      return policy.allowedFiles.some((allowed) => allowed.startsWith(`${normalized}/`))
        ? "traverse"
        : "reject";
    }
    return policy.allowedFiles.includes(normalized) ? "allow" : "reject";
  }
  return "unrestricted";
}

function collectSourceFiles(sourceRoot, sourceRootBinding) {
  const files = [];
  const directories = [];
  let excludedSourceRoots = 0;
  const excludedSourceFilePaths = [];
  const restrictedSourceRootPaths = [];
  const restrictedSourceFilePaths = [];
  const transformedSourceRoots = [];
  let marketFactsRootSeen = false;
  let stockanalysisEtfRootSeen = false;

  function visit(directory, relativeDirectory = "", directoryBinding = sourceRootBinding) {
    for (const entry of readStableDirectoryEntries(directoryBinding)) {
      const relativePath = normalizedRelative(path.posix.join(relativeDirectory, entry.name));
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`source public-data path is a symlink: ${absolutePath}`);
      }
      const restrictedDisposition = restrictedDerivedDisposition(relativePath, stat.isDirectory());
      if (restrictedDisposition === "reject") {
        if (stat.isDirectory()) restrictedSourceRootPaths.push(relativePath);
        else if (stat.isFile()) restrictedSourceFilePaths.push(relativePath);
        else throw new Error(`restricted derived source path is not a regular file or directory: ${absolutePath}`);
        continue;
      }
      if (relativePath === MARKET_FACTS_ROOT) {
        if (!stat.isDirectory()) {
          throw new Error(`canonical market-facts root must be a directory: ${absolutePath}`);
        }
        marketFactsRootSeen = true;
      }
      if (relativePath === STOCKANALYSIS_ETF_ROOT) {
        if (!stat.isDirectory()) {
          throw new Error(`canonical StockAnalysis ETF root must be a directory: ${absolutePath}`);
        }
        stockanalysisEtfRootSeen = true;
        // Canonical ETF details are transformed into shards below. Never add
        // their direct files to the generic copy plan.
        continue;
      }
      if (relativePath === MARKET_FACTS_SHARD_ROOT) {
        throw new Error(`canonical source must not contain public-only market-facts shards: ${absolutePath}`);
      }
      if (relativePath === STOCKANALYSIS_ETF_SHARD_ROOT) {
        throw new Error(`canonical source must not contain public-only StockAnalysis ETF shards: ${absolutePath}`);
      }
      if (isExcludedFile(relativePath)) {
        if (!stat.isFile()) {
          throw new Error(`excluded source file must be a regular file: ${absolutePath}`);
        }
        excludedSourceFilePaths.push(relativePath);
        continue;
      }
      if (isExcludedRoot(relativePath)) {
        if (!stat.isDirectory()) {
          throw new Error(`excluded source root must be a directory: ${absolutePath}`);
        }
        excludedSourceRoots += 1;
        continue;
      }
      if (isTransformedRoot(relativePath)) {
        if (!stat.isDirectory()) {
          throw new Error(`transformed source root must be a directory: ${absolutePath}`);
        }
        transformedSourceRoots.push({
          relativeRoot: relativePath,
          absolutePath,
          sourceBinding: captureSourceBinding(absolutePath, "market-facts ticker root", "directory"),
        });
        continue;
      }
      if (stat.isDirectory()) {
        directories.push(relativePath);
        visit(
          absolutePath,
          relativePath,
          captureSourceBinding(absolutePath, "source public-data directory", "directory"),
        );
      } else if (stat.isFile()) {
        files.push({ relativePath, absolutePath, size: stat.size });
      } else {
        throw new Error(`source public-data path is not a regular file or directory: ${absolutePath}`);
      }
    }
  }

  visit(sourceRoot);
  return {
    files,
    directories,
    excludedSourceRoots,
    excludedSourceFiles: excludedSourceFilePaths.length,
    excludedSourceFilePaths,
    restrictedSourceRoots: restrictedSourceRootPaths.length,
    restrictedSourceRootPaths,
    restrictedSourceFiles: restrictedSourceFilePaths.length,
    restrictedSourceFilePaths,
    transformedSourceRoots,
    marketFactsRootSeen,
    stockanalysisEtfRootSeen,
  };
}

function readBoundMarketFactsFile(filePath) {
  const binding = captureSourceBinding(filePath, "market-facts source file", "file");
  if (typeof fs.constants.O_NOFOLLOW !== "number") {
    throw new Error("market-facts source read requires O_NOFOLLOW support");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const openedIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(binding.identity, openedIdentity)) {
      throw new Error(`source identity drift while opening market-facts source file: ${filePath}`);
    }
    const body = fs.readFileSync(descriptor, "utf8");
    const readIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(binding.identity, readIdentity)) {
      throw new Error(`source identity drift while reading market-facts source file: ${filePath}`);
    }
    revalidateSourceBindings([binding], "after market-facts source read");
    return { binding, body };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function parseMarketFactsPayload(body, filePath, ticker) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`invalid market-facts JSON ${filePath}: ${error.message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`market-facts payload must be an object: ${filePath}`);
  }
  if (marketFactsTickerKey(payload.ticker) !== ticker) {
    throw new Error(`market-facts ticker mismatch: ${filePath}`);
  }
  return payload;
}

function buildMarketFactsShardProjection(transformedSourceRoots) {
  if (transformedSourceRoots.length === 0) return null;
  if (transformedSourceRoots.length !== 1 || transformedSourceRoots[0].relativeRoot !== MARKET_FACTS_TICKER_ROOT) {
    throw new Error("market-facts public projection requires exactly one canonical ticker root");
  }
  const [{ absolutePath, sourceBinding }] = transformedSourceRoots;
  const shards = Array.from({ length: MARKET_FACTS_SHARD_COUNT }, () => ({}));
  const sourceBindings = [sourceBinding];
  let tickerFiles = 0;
  const entries = readStableDirectoryEntries(sourceBinding)
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const filePath = path.join(absolutePath, entry.name);
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`market-facts source path is a symlink: ${filePath}`);
    if (!stat.isFile() || !entry.name.endsWith(".json")) {
      throw new Error(`market-facts ticker root may contain only JSON files: ${filePath}`);
    }
    const ticker = entry.name.slice(0, -5);
    if (marketFactsTickerKey(ticker) !== ticker) {
      throw new Error(`market-facts filename must use the canonical ticker: ${filePath}`);
    }
    const { binding, body } = readBoundMarketFactsFile(filePath);
    const payload = parseMarketFactsPayload(body, filePath, ticker);
    sourceBindings.push(binding);
    const shardFileName = marketFactsShardFileName(ticker);
    const shardId = Number.parseInt(shardFileName.slice(0, -5), 10);
    shards[shardId][ticker] = payload;
    tickerFiles += 1;
  }
  revalidateSourceBindings([sourceBinding], "after market-facts projection");
  const shardFiles = shards.map((payload, shardId) => {
    const body = `${JSON.stringify(payload)}\n`;
    return {
      relativePath: `${MARKET_FACTS_SHARD_ROOT}/${marketFactsShardFileNameForId(shardId)}`,
      body,
      size: Buffer.byteLength(body),
    };
  });
  return {
    tickerFiles,
    shardFiles,
    bytes: shardFiles.reduce((sum, item) => sum + item.size, 0),
    sourceBindings,
  };
}

function readBoundStockanalysisEtfFile(filePath) {
  const binding = captureSourceBinding(filePath, "StockAnalysis ETF source file", "file");
  if (typeof fs.constants.O_NOFOLLOW !== "number") {
    throw new Error("StockAnalysis ETF source read requires O_NOFOLLOW support");
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const openedIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(binding.identity, openedIdentity)) {
      throw new Error(`source identity drift while opening StockAnalysis ETF source file: ${filePath}`);
    }
    const body = fs.readFileSync(descriptor, "utf8");
    const readIdentity = statIdentity(fs.fstatSync(descriptor, { bigint: true }));
    if (!sameIdentity(binding.identity, readIdentity)) {
      throw new Error(`source identity drift while reading StockAnalysis ETF source file: ${filePath}`);
    }
    revalidateSourceBindings([binding], "after StockAnalysis ETF source read");
    return { binding, body };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function isoTimestamp(value) {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function parseStockanalysisEtfPayload(body, filePath, ticker) {
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error(`invalid StockAnalysis ETF JSON ${filePath}: ${error.message}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`StockAnalysis ETF payload must be an object: ${filePath}`);
  }
  if (
    payload.ticker !== ticker
    || payload.schema_version !== "stockanalysis/v1"
    || payload.asset_type !== "etf"
    || payload.source !== "stockanalysis"
    || payload.source_provider === "yahoo_finance"
    || payload.detail_status === "yf_fallback"
    || !isoTimestamp(payload.fetched_at)
    || (payload.source_as_of !== undefined && payload.source_as_of !== null && !isoTimestamp(payload.source_as_of))
  ) {
    throw new Error(`strict StockAnalysis ETF identity/timestamp mismatch: ${filePath}`);
  }
  return payload;
}

function timestampRange(values) {
  const ordered = [...values].sort();
  return { min: ordered.at(0) ?? null, max: ordered.at(-1) ?? null, present_count: ordered.length };
}

function buildStockanalysisEtfShardProjection(sourceRoot) {
  const absolutePath = path.join(sourceRoot, ...STOCKANALYSIS_ETF_ROOT.split("/"));
  if (!lstatIfPresent(absolutePath)) return null;
  const sourceBinding = captureSourceBinding(absolutePath, "StockAnalysis ETF root", "directory");
  const sourceBindings = [sourceBinding];
  const shards = Array.from({ length: STOCKANALYSIS_ETF_SHARD_COUNT }, () => ({}));
  const sourceRows = [];
  const sourceAsOf = [];
  const fetchedAt = [];
  const entries = readStableDirectoryEntries(sourceBinding)
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const filePath = path.join(absolutePath, entry.name);
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw new Error(`StockAnalysis ETF source path is a symlink: ${filePath}`);
    if (!stat.isFile() || !entry.name.endsWith(".json")) {
      throw new Error(`StockAnalysis ETF source root may contain only JSON files: ${filePath}`);
    }
    const ticker = entry.name.slice(0, -5);
    if (stockanalysisEtfTickerKey(ticker) !== ticker) {
      throw new Error(`StockAnalysis ETF filename must use the canonical ticker: ${filePath}`);
    }
    const { binding, body } = readBoundStockanalysisEtfFile(filePath);
    const payload = parseStockanalysisEtfPayload(body, filePath, ticker);
    sourceBindings.push(binding);
    shards[stockanalysisEtfShardId(ticker)][ticker] = {
      raw: body,
      sha256: sha256Text(body),
    };
    sourceRows.push({ ticker, sha256: sha256Text(body) });
    if (isoTimestamp(payload.source_as_of)) sourceAsOf.push(payload.source_as_of);
    fetchedAt.push(payload.fetched_at);
  }
  revalidateSourceBindings([sourceBinding], "after StockAnalysis ETF projection");

  const sourceSha256 = stockanalysisEtfSourceBindingSha256(sourceRows);
  const snapshotId = stockanalysisEtfSnapshotId(sourceSha256);
  const shardFiles = shards.map((entriesByTicker, shardId) => {
    const sortedEntries = {};
    for (const key of Object.keys(entriesByTicker).sort()) {
      sortedEntries[key] = entriesByTicker[key];
    }
    const body = `${JSON.stringify({
      schema_version: STOCKANALYSIS_ETF_SHARD_SCHEMA,
      shard_algorithm: STOCKANALYSIS_ETF_SHARD_ALGORITHM,
      shard_count: STOCKANALYSIS_ETF_SHARD_COUNT,
      shard_id: shardId,
      entries: sortedEntries,
    })}\n`;
    const byteLength = Buffer.byteLength(body);
    if (byteLength > STOCKANALYSIS_ETF_SHARD_MAX_BYTES) {
      throw new Error(
        `StockAnalysis ETF shard ${shardId} exceeds the ${STOCKANALYSIS_ETF_SHARD_MAX_BYTES}-byte asset limit: ${byteLength}`,
      );
    }
    return {
      shardId,
      relativePath: `snapshots/${snapshotId}/${stockanalysisEtfShardFileNameForId(shardId)}`,
      body,
      sha256: sha256Text(body),
      byteLength,
      memberCount: Object.keys(entriesByTicker).length,
    };
  });
  const manifest = {
    schema_version: STOCKANALYSIS_ETF_SHARD_MANIFEST_SCHEMA,
    compatibility_mode: STOCKANALYSIS_ETF_PUBLIC_MODE,
    shard_algorithm: STOCKANALYSIS_ETF_SHARD_ALGORITHM,
    shard_count: STOCKANALYSIS_ETF_SHARD_COUNT,
    payload_count: sourceRows.length,
    snapshot_id: snapshotId,
    generated_at: timestampRange(fetchedAt).max,
    source_timestamp_range: {
      source_as_of: timestampRange(sourceAsOf),
      fetched_at: timestampRange(fetchedAt),
    },
    provenance: {
      canonical_root: "data/stockanalysis/etfs",
      source_payload_sha256: sourceSha256,
    },
    shards: shardFiles.map((item) => ({
      id: item.shardId,
      path: item.relativePath,
      sha256: item.sha256,
      member_count: item.memberCount,
      byte_length: item.byteLength,
    })),
  };
  manifest.manifest_sha256 = stockanalysisEtfManifestSha256(manifest);
  return {
    tickerFiles: sourceRows.length,
    sourceBindings,
    snapshotId,
    shardFiles,
    manifestBody: `${JSON.stringify(manifest)}\n`,
    bytes: shardFiles.reduce((sum, item) => sum + item.byteLength, 0),
  };
}

function collectRemovalTree(directory, stat, files, directories, capture) {
  if (stat.isSymbolicLink()) throw new Error(`destination excluded root is a symlink: ${directory}`);
  if (!stat.isDirectory()) throw new Error(`destination excluded root is not a directory: ${directory}`);
  directories.push(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const entryStat = capture(entryPath, "destination excluded tree node");
    if (!entryStat) throw new Error(`destination removal identity drift during preflight: ${entryPath}`);
    if (entryStat.isSymbolicLink()) throw new Error(`destination excluded tree contains a symlink: ${entryPath}`);
    if (entryStat.isDirectory()) collectRemovalTree(entryPath, entryStat, files, directories, capture);
    else if (entryStat.isFile()) files.push(entryPath);
    else throw new Error(`destination excluded tree contains a special file: ${entryPath}`);
  }
}

function collectDestinationRemovalPlan(destinationRoot, transformedRelativeRoots = []) {
  const bindings = [];
  const bindingByPath = new Map();
  function capture(filePath, label) {
    const stat = lstatBigintIfPresent(filePath);
    const identity = statIdentity(stat);
    const existing = bindingByPath.get(filePath);
    if (existing) {
      if (!sameIdentity(existing.identity, identity)) {
        throw new Error(`destination removal identity drift during preflight: ${label}: ${filePath}`);
      }
      return stat;
    }
    const binding = { filePath, label, identity };
    bindingByPath.set(filePath, binding);
    bindings.push(binding);
    return stat;
  }

  const destinationStat = capture(destinationRoot, "destination root");
  if (destinationStat?.isSymbolicLink()) {
    throw new Error(`destination root must not be a symlink: ${destinationRoot}`);
  }
  if (destinationStat && !destinationStat.isDirectory()) {
    throw new Error(`destination root must be a directory: ${destinationRoot}`);
  }

  for (const relativeParent of ["admin", "yf"]) {
    const parentPath = path.join(destinationRoot, relativeParent);
    const parentStat = capture(parentPath, "destination removal parent");
    if (parentStat?.isSymbolicLink()) {
      throw new Error(`destination removal parent is a symlink: ${parentPath}`);
    }
    if (parentStat && !parentStat.isDirectory()) {
      throw new Error(`destination removal parent is not a directory: ${parentPath}`);
    }
  }

  for (const relativeRoot of transformedRelativeRoots) {
    const segments = relativeRoot.split("/").slice(0, -1);
    let cursor = destinationRoot;
    for (const segment of segments) {
      cursor = path.join(cursor, segment);
      const stat = capture(cursor, "destination transformed parent");
      if (stat?.isSymbolicLink()) {
        throw new Error(`destination transformed parent is a symlink: ${cursor}`);
      }
      if (stat && !stat.isDirectory()) {
        throw new Error(`destination transformed parent is not a directory: ${cursor}`);
      }
    }
  }

  const roots = [];
  for (const relativeRoot of EXCLUDED_PUBLIC_DATA_ROOTS) {
    const target = path.join(destinationRoot, ...relativeRoot.split("/"));
    const stat = capture(target, "destination excluded root");
    if (!stat) continue;
    const files = [];
    const directories = [];
    collectRemovalTree(target, stat, files, directories, capture);
    roots.push({ relativeRoot, files, directories });
  }

  const transformedRoots = [];
  for (const relativeRoot of transformedRelativeRoots) {
    const target = path.join(destinationRoot, ...relativeRoot.split("/"));
    const stat = capture(target, "destination transformed root");
    if (!stat) continue;
    const files = [];
    const directories = [];
    collectRemovalTree(target, stat, files, directories, capture);
    transformedRoots.push({ relativeRoot, files, directories });
  }

  const exactFiles = [];
  for (const relativePath of EXCLUDED_PUBLIC_DATA_FILES) {
    const target = path.join(destinationRoot, ...relativePath.split("/"));
    const stat = capture(target, "destination excluded exact file");
    if (!stat) continue;
    if (stat.isSymbolicLink()) {
      throw new Error(`destination excluded exact file is a symlink: ${target}`);
    }
    if (!stat.isFile()) {
      throw new Error(`destination excluded exact file must be a regular file: ${target}`);
    }
    exactFiles.push({ relativePath, filePath: target });
  }

  const restrictedRoots = [];
  const restrictedExactFiles = [];
  function visitRestrictedDirectory(directory, relativeDirectory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      const relativePath = normalizedRelative(path.posix.join(relativeDirectory, entry.name));
      const stat = capture(entryPath, "destination restricted derived node");
      if (!stat) throw new Error(`destination removal identity drift during preflight: ${entryPath}`);
      if (stat.isSymbolicLink()) throw new Error(`destination restricted derived tree contains a symlink: ${entryPath}`);
      const disposition = restrictedDerivedDisposition(relativePath, stat.isDirectory());
      if (disposition === "traverse") {
        if (!stat.isDirectory()) throw new Error(`destination restricted derived parent is not a directory: ${entryPath}`);
        visitRestrictedDirectory(entryPath, relativePath);
      } else if (disposition === "allow") {
        if (!stat.isFile()) throw new Error(`destination allowlisted derived output is not a regular file: ${entryPath}`);
      } else if (isCoveredByExcludedRoot(relativePath)) {
        // The exact private root is already in the generic removal plan. Do
        // not schedule the same node again through a broader derived-asset
        // allowlist, or mutation-time identity checks will see a double delete.
        continue;
      } else if (stat.isDirectory()) {
        const files = [];
        const directories = [];
        collectRemovalTree(entryPath, stat, files, directories, capture);
        restrictedRoots.push({ relativeRoot: relativePath, files, directories });
      } else if (stat.isFile()) {
        restrictedExactFiles.push({ relativePath, filePath: entryPath });
      } else {
        throw new Error(`destination restricted derived tree contains a special file: ${entryPath}`);
      }
    }
  }
  for (const policy of RESTRICTED_DERIVED_PUBLIC_DATA_ROOTS) {
    const target = path.join(destinationRoot, ...policy.relativeRoot.split("/"));
    const stat = capture(target, "destination restricted derived root");
    if (!stat) continue;
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`destination restricted derived root must be a real directory: ${target}`);
    }
    visitRestrictedDirectory(target, policy.relativeRoot);
  }

  return { roots, transformedRoots, exactFiles, restrictedRoots, restrictedExactFiles, bindings };
}

function revalidateDestinationRemovalPlan(bindings) {
  for (const binding of bindings) {
    const identity = statIdentity(lstatBigintIfPresent(binding.filePath));
    if (!sameIdentity(binding.identity, identity)) {
      throw new Error(`destination removal identity drift: ${binding.label}: ${binding.filePath}`);
    }
  }
}

function preflightDestinationPaths(destinationRoot, sourcePlan) {
  if (!lstatIfPresent(destinationRoot)) return;
  for (const item of [
    ...sourcePlan.directories.map((relativePath) => ({ relativePath, expectsDirectory: true })),
    ...sourcePlan.files.map(({ relativePath }) => ({ relativePath, expectsDirectory: false })),
  ]) {
    const segments = item.relativePath.split("/");
    let cursor = destinationRoot;
    for (let index = 0; index < segments.length; index += 1) {
      cursor = path.join(cursor, segments[index]);
      const stat = lstatIfPresent(cursor);
      if (!stat) break;
      if (stat.isSymbolicLink()) throw new Error(`destination public-data path is a symlink: ${cursor}`);
      const final = index === segments.length - 1;
      if (!final && !stat.isDirectory()) throw new Error(`destination public-data parent is not a directory: ${cursor}`);
      if (final && item.expectsDirectory && !stat.isDirectory()) throw new Error(`destination directory path is not a directory: ${cursor}`);
      if (final && !item.expectsDirectory && !stat.isFile()) throw new Error(`destination file path is not a regular file: ${cursor}`);
    }
  }
}

function assertNoOrphanedDestinationMarketFactsProjection(destinationRoot) {
  for (const relativeRoot of [MARKET_FACTS_TICKER_ROOT, MARKET_FACTS_SHARD_ROOT]) {
    const target = path.join(destinationRoot, ...relativeRoot.split("/"));
    if (lstatIfPresent(target)) {
      throw new Error(
        `destination contains ${relativeRoot} without the canonical market-facts ticker source: ${target}`,
      );
    }
  }
}

function assertNoOrphanedDestinationStockanalysisEtfProjection(destinationRoot) {
  const target = path.join(destinationRoot, ...STOCKANALYSIS_ETF_ROOT.split("/"));
  if (lstatIfPresent(target)) {
    throw new Error(
      `destination contains ${STOCKANALYSIS_ETF_ROOT} without the canonical StockAnalysis ETF source: ${target}`,
    );
  }
}

function removeDirectStockanalysisEtfFiles(destinationRoot) {
  const etfRoot = path.join(destinationRoot, ...STOCKANALYSIS_ETF_ROOT.split("/"));
  const stat = lstatIfPresent(etfRoot);
  if (!stat) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`StockAnalysis ETF destination root must be a real directory: ${etfRoot}`);
  }
  for (const entry of fs.readdirSync(etfRoot, { withFileTypes: true })) {
    if (entry.name === "shards") continue;
    const entryPath = path.join(etfRoot, entry.name);
    const entryStat = fs.lstatSync(entryPath);
    if (entryStat.isSymbolicLink() || !entryStat.isFile() || !entry.name.endsWith(".json")) {
      throw new Error(`StockAnalysis ETF direct public path is unsafe: ${entryPath}`);
    }
    fs.unlinkSync(entryPath);
  }
}

function assertRemovalBinding(bindingByPath, filePath, expectedKind, stableOnly = false) {
  const binding = bindingByPath.get(filePath);
  const stat = lstatBigintIfPresent(filePath);
  const kind = !stat ? "absent" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "unsafe";
  if (!binding || kind !== expectedKind) {
    throw new Error(`destination removal node changed before mutation: ${filePath}`);
  }
  const current = statIdentity(stat);
  const fields = stableOnly ? ["dev", "ino", "mode"] : IDENTITY_FIELDS;
  if (!fields.every((field) => binding.identity?.[field] === current?.[field])) {
    throw new Error(`destination removal identity drift before mutation: ${filePath}`);
  }
}

function removeDestinationRoots(removals, bindingByPath) {
  for (const removal of removals) {
    for (const filePath of removal.files) {
      assertRemovalBinding(bindingByPath, filePath, "file");
      fs.unlinkSync(filePath);
    }
    for (const directory of [...removal.directories].reverse()) {
      assertRemovalBinding(bindingByPath, directory, "directory", true);
      fs.rmdirSync(directory);
    }
  }
}

function removeDestinationExactFiles(removals, bindingByPath) {
  for (const removal of removals) {
    assertRemovalBinding(bindingByPath, removal.filePath, "file");
    fs.unlinkSync(removal.filePath);
  }
}

function removeOwnedProjectionNode(nodePath) {
  const stat = fs.lstatSync(nodePath);
  if (stat.isSymbolicLink()) throw new Error(`StockAnalysis ETF shard projection must not contain a symlink: ${nodePath}`);
  if (stat.isFile()) {
    fs.unlinkSync(nodePath);
    return;
  }
  if (!stat.isDirectory()) throw new Error(`StockAnalysis ETF shard projection contains a special file: ${nodePath}`);
  for (const entry of fs.readdirSync(nodePath, { withFileTypes: true })) {
    removeOwnedProjectionNode(path.join(nodePath, entry.name));
  }
  fs.rmdirSync(nodePath);
}

/**
 * The immutable snapshot is written and verified first. The one small pointer
 * (`index.json`) flips last with rename(), so a partial writer is invisible to
 * the dual-read resolver and it remains able to use legacy ticker files.
 */
function publishStockanalysisEtfShardProjection(destinationRoot, projection) {
  if (!projection) return;
  const destinationStat = lstatIfPresent(destinationRoot);
  if (destinationStat?.isSymbolicLink() || (destinationStat && !destinationStat.isDirectory())) {
    throw new Error(`StockAnalysis ETF shard destination root must be a real directory: ${destinationRoot}`);
  }
  let parentCursor = destinationRoot;
  for (const segment of ["stockanalysis", "etfs"]) {
    parentCursor = path.join(parentCursor, segment);
    const parentStat = lstatIfPresent(parentCursor);
    if (parentStat?.isSymbolicLink() || (parentStat && !parentStat.isDirectory())) {
      throw new Error(`StockAnalysis ETF shard destination parent must be a real directory: ${parentCursor}`);
    }
  }
  const shardRoot = path.join(destinationRoot, ...STOCKANALYSIS_ETF_SHARD_ROOT.split("/"));
  const rootStat = lstatIfPresent(shardRoot);
  if (rootStat?.isSymbolicLink() || (rootStat && !rootStat.isDirectory())) {
    throw new Error(`StockAnalysis ETF shard destination must be a real directory: ${shardRoot}`);
  }
  fs.mkdirSync(shardRoot, { recursive: true });

  const stageRoot = path.join(shardRoot, `.stage-${projection.snapshotId}-${process.pid}`);
  const manifestPath = path.join(shardRoot, "index.json");
  const manifestTemporary = `${manifestPath}.tmp-${process.pid}`;
  const manifestStat = lstatIfPresent(manifestPath);
  if (manifestStat?.isSymbolicLink() || (manifestStat && !manifestStat.isFile())) {
    throw new Error(`StockAnalysis ETF shard manifest must be a regular file: ${manifestPath}`);
  }
  if (lstatIfPresent(stageRoot)) throw new Error(`StockAnalysis ETF shard staging path already exists: ${stageRoot}`);
  fs.mkdirSync(stageRoot, { recursive: true });
  try {
    for (const item of projection.shardFiles) {
      const stagedPath = path.join(stageRoot, ...item.relativePath.split("/"));
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.writeFileSync(stagedPath, item.body, "utf8");
      const stagedStat = fs.lstatSync(stagedPath);
      if (!stagedStat.isFile() || stagedStat.isSymbolicLink() || sha256Text(fs.readFileSync(stagedPath, "utf8")) !== item.sha256) {
        throw new Error(`StockAnalysis ETF shard staging verification failed: ${stagedPath}`);
      }
    }
    const stagedSnapshot = path.join(stageRoot, "snapshots", projection.snapshotId);
    const snapshotRoot = path.join(shardRoot, "snapshots");
    const finalSnapshot = path.join(snapshotRoot, projection.snapshotId);
    const snapshotRootStat = lstatIfPresent(snapshotRoot);
    if (snapshotRootStat?.isSymbolicLink() || (snapshotRootStat && !snapshotRootStat.isDirectory())) {
      throw new Error(`StockAnalysis ETF shard snapshots root must be a real directory: ${snapshotRoot}`);
    }
    fs.mkdirSync(snapshotRoot, { recursive: true });
    const finalSnapshotStat = lstatIfPresent(finalSnapshot);
    if (finalSnapshotStat) {
      if (finalSnapshotStat.isSymbolicLink() || !finalSnapshotStat.isDirectory()) {
        throw new Error(`StockAnalysis ETF shard snapshot path is unsafe: ${finalSnapshot}`);
      }
      const expectedSnapshotFiles = new Set(
        projection.shardFiles.map((item) => stockanalysisEtfShardFileNameForId(item.shardId)),
      );
      for (const entry of fs.readdirSync(finalSnapshot, { withFileTypes: true })) {
        const existingPath = path.join(finalSnapshot, entry.name);
        const existing = fs.lstatSync(existingPath);
        if (
          !expectedSnapshotFiles.has(entry.name)
          || existing.isSymbolicLink()
          || !existing.isFile()
        ) {
          throw new Error(`StockAnalysis ETF immutable snapshot contains an unlisted or unsafe node: ${existingPath}`);
        }
      }
      for (const item of projection.shardFiles) {
        const existingPath = path.join(finalSnapshot, stockanalysisEtfShardFileNameForId(item.shardId));
        const existing = lstatIfPresent(existingPath);
        if (!existing || existing.isSymbolicLink() || !existing.isFile() || sha256Text(fs.readFileSync(existingPath, "utf8")) !== item.sha256) {
          throw new Error(`StockAnalysis ETF immutable snapshot conflicts with current projection: ${existingPath}`);
        }
      }
      removeOwnedProjectionNode(stagedSnapshot);
    } else {
      fs.renameSync(stagedSnapshot, finalSnapshot);
    }
    fs.rmdirSync(path.join(stageRoot, "snapshots"));
    fs.rmdirSync(stageRoot);

    if (lstatIfPresent(manifestTemporary)) throw new Error(`StockAnalysis ETF manifest temporary path already exists: ${manifestTemporary}`);
    fs.writeFileSync(manifestTemporary, projection.manifestBody, "utf8");
    JSON.parse(fs.readFileSync(manifestTemporary, "utf8"));
    fs.renameSync(manifestTemporary, manifestPath);
  } finally {
    if (lstatIfPresent(stageRoot)) removeOwnedProjectionNode(stageRoot);
    if (lstatIfPresent(manifestTemporary)) removeOwnedProjectionNode(manifestTemporary);
  }

  for (const entry of fs.readdirSync(shardRoot, { withFileTypes: true })) {
    const entryPath = path.join(shardRoot, entry.name);
    if (entry.name === "index.json") continue;
    if (entry.name === "snapshots") {
      const snapshotStat = fs.lstatSync(entryPath);
      if (snapshotStat.isSymbolicLink() || !snapshotStat.isDirectory()) {
        throw new Error(`StockAnalysis ETF shard snapshots root is unsafe: ${entryPath}`);
      }
      for (const snapshotEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
        if (snapshotEntry.name !== projection.snapshotId) {
          removeOwnedProjectionNode(path.join(entryPath, snapshotEntry.name));
        }
      }
      continue;
    }
    removeOwnedProjectionNode(entryPath);
  }
}

/**
 * Produce only the ETF compatibility projection. This deliberately avoids the
 * full public sync because that operation also transforms market-facts data.
 */
export function syncStockanalysisEtfShardProjection({
  sourceRoot,
  destinationRoot,
  dryRun = false,
  logger = console.log,
}) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  assertDirectory(source, "source root");
  if (lstatIfPresent(destination)) assertDirectory(destination, "destination root");
  const projection = buildStockanalysisEtfShardProjection(source);
  const result = {
    sourceRoot: source,
    destinationRoot: destination,
    dryRun,
    stockanalysisEtfTickerFiles: projection?.tickerFiles ?? 0,
    stockanalysisEtfShardFiles: projection?.shardFiles.length ?? 0,
    stockanalysisEtfShardBytes: projection?.bytes ?? 0,
    stockanalysisEtfManifestFiles: projection ? 1 : 0,
  };
  if (dryRun || !projection) return result;
  revalidateSourceBindings(projection.sourceBindings, "immediately before StockAnalysis ETF shard publication");
  removeDirectStockanalysisEtfFiles(destination);
  publishStockanalysisEtfShardProjection(destination, projection);
  logger(`[sync-public-data] projected ${result.stockanalysisEtfTickerFiles} StockAnalysis ETF tickers into ${result.stockanalysisEtfShardFiles} shards plus ${result.stockanalysisEtfManifestFiles} manifest`);
  return result;
}

export function planPublicDataSync({ sourceRoot, destinationRoot }) {
  const source = path.resolve(sourceRoot);
  const destination = path.resolve(destinationRoot);
  assertDirectory(source, "source root");
  const sourceRootBinding = captureSourceBinding(source, "source root", "directory");
  const destinationStat = lstatIfPresent(destination);
  if (destinationStat) assertDirectory(destination, "destination root");
  const sourcePlan = collectSourceFiles(source, sourceRootBinding);
  if (sourcePlan.marketFactsRootSeen && sourcePlan.transformedSourceRoots.length === 0) {
    throw new Error("canonical market-facts root exists without its ticker source root");
  }
  const marketFactsProjection = buildMarketFactsShardProjection(sourcePlan.transformedSourceRoots);
  const stockanalysisEtfProjection = buildStockanalysisEtfShardProjection(source);
  if (!marketFactsProjection) {
    assertNoOrphanedDestinationMarketFactsProjection(destination);
  }
  if (!stockanalysisEtfProjection && !sourcePlan.stockanalysisEtfRootSeen) {
    assertNoOrphanedDestinationStockanalysisEtfProjection(destination);
  }
  preflightDestinationPaths(destination, sourcePlan);
  const transformedRelativeRoots = marketFactsProjection
    ? [MARKET_FACTS_TICKER_ROOT, MARKET_FACTS_SHARD_ROOT]
    : [];
  if (stockanalysisEtfProjection) transformedRelativeRoots.push(STOCKANALYSIS_ETF_ROOT);
  const removalPlan = collectDestinationRemovalPlan(destination, transformedRelativeRoots);
  return {
    sourceRoot: source,
    destinationRoot: destination,
    files: sourcePlan.files,
    directories: sourcePlan.directories,
    excludedSourceRoots: sourcePlan.excludedSourceRoots,
    excludedSourceFiles: sourcePlan.excludedSourceFiles,
    excludedSourceFilePaths: sourcePlan.excludedSourceFilePaths,
    restrictedSourceRoots: sourcePlan.restrictedSourceRoots,
    restrictedSourceRootPaths: sourcePlan.restrictedSourceRootPaths,
    restrictedSourceFiles: sourcePlan.restrictedSourceFiles,
    restrictedSourceFilePaths: sourcePlan.restrictedSourceFilePaths,
    removals: removalPlan.roots,
    transformedRemovals: removalPlan.transformedRoots,
    exactRemovals: removalPlan.exactFiles,
    restrictedRemovals: removalPlan.restrictedRoots,
    restrictedExactRemovals: removalPlan.restrictedExactFiles,
    removalBindings: removalPlan.bindings,
    sourceBindings: [
      sourceRootBinding,
      ...(marketFactsProjection?.sourceBindings ?? []),
      ...(stockanalysisEtfProjection?.sourceBindings ?? []),
    ],
    marketFactsProjection,
    stockanalysisEtfProjection,
  };
}

export function syncPublicData({
  sourceRoot,
  destinationRoot,
  dryRun = false,
  logger = console.log,
  beforeMutation = null,
}) {
  if (beforeMutation !== null && typeof beforeMutation !== "function") {
    throw new TypeError("beforeMutation must be a function");
  }
  const plan = planPublicDataSync({ sourceRoot, destinationRoot });
  const result = {
    sourceRoot: plan.sourceRoot,
    destinationRoot: plan.destinationRoot,
    dryRun,
    filesCopied: plan.files.length,
    bytesCopied: plan.files.reduce((sum, item) => sum + item.size, 0),
    excludedSourceRoots: plan.excludedSourceRoots,
    excludedSourceFiles: plan.excludedSourceFiles,
    excludedSourceFilePaths: [...plan.excludedSourceFilePaths],
    restrictedSourceRoots: plan.restrictedSourceRoots,
    restrictedSourceRootPaths: [...plan.restrictedSourceRootPaths],
    restrictedSourceFiles: plan.restrictedSourceFiles,
    restrictedSourceFilePaths: [...plan.restrictedSourceFilePaths],
    removedDestinationRoots: plan.removals.length,
    removedDestinationFiles: plan.removals.reduce((sum, item) => sum + item.files.length, 0),
    removedDestinationExactFiles: plan.exactRemovals.length,
    removedDestinationExactFilePaths: plan.exactRemovals.map((item) => item.relativePath),
    removedRestrictedDestinationRoots: plan.restrictedRemovals.length,
    removedRestrictedDestinationFiles: plan.restrictedRemovals.reduce((sum, item) => sum + item.files.length, 0),
    removedRestrictedDestinationExactFiles: plan.restrictedExactRemovals.length,
    removedRestrictedDestinationPaths: [
      ...plan.restrictedRemovals.map((item) => item.relativeRoot),
      ...plan.restrictedExactRemovals.map((item) => item.relativePath),
    ],
    marketFactsTickerFiles: plan.marketFactsProjection?.tickerFiles ?? 0,
    marketFactsShardFiles: plan.marketFactsProjection?.shardFiles.length ?? 0,
    marketFactsShardBytes: plan.marketFactsProjection?.bytes ?? 0,
    stockanalysisEtfTickerFiles: plan.stockanalysisEtfProjection?.tickerFiles ?? 0,
    stockanalysisEtfShardFiles: plan.stockanalysisEtfProjection?.shardFiles.length ?? 0,
    stockanalysisEtfShardBytes: plan.stockanalysisEtfProjection?.bytes ?? 0,
    stockanalysisEtfManifestFiles: plan.stockanalysisEtfProjection ? 1 : 0,
    removedTransformedDestinationRoots: plan.transformedRemovals.length,
    removedTransformedDestinationFiles: plan.transformedRemovals.reduce((sum, item) => sum + item.files.length, 0),
  };
  if (dryRun) return result;

  beforeMutation?.(Object.freeze({
    sourceRoot: plan.sourceRoot,
    destinationRoot: plan.destinationRoot,
    removedDestinationRoots: plan.removals.map((item) => item.relativeRoot),
    removedTransformedDestinationRoots: plan.transformedRemovals.map((item) => item.relativeRoot),
    removedDestinationExactFilePaths: [...result.removedDestinationExactFilePaths],
    removedRestrictedDestinationPaths: [...result.removedRestrictedDestinationPaths],
  }));
  revalidateSourceBindings(plan.sourceBindings, "after beforeMutation");
  revalidateDestinationRemovalPlan(plan.removalBindings);
  revalidateSourceBindings(plan.sourceBindings, "immediately before destination mutation");
  const removalBindingByPath = new Map(
    plan.removalBindings.map((binding) => [binding.filePath, binding]),
  );
  fs.mkdirSync(plan.destinationRoot, { recursive: true });
  removeDestinationExactFiles(plan.exactRemovals, removalBindingByPath);
  removeDestinationExactFiles(plan.restrictedExactRemovals, removalBindingByPath);
  removeDestinationRoots(plan.removals, removalBindingByPath);
  removeDestinationRoots(plan.transformedRemovals, removalBindingByPath);
  removeDestinationRoots(plan.restrictedRemovals, removalBindingByPath);
  for (const relativeDirectory of plan.directories) {
    fs.mkdirSync(path.join(plan.destinationRoot, ...relativeDirectory.split("/")), { recursive: true });
  }
  for (const item of plan.files) {
    const target = path.join(plan.destinationRoot, ...item.relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const targetStat = lstatIfPresent(target);
    if (targetStat?.isSymbolicLink()) throw new Error(`destination file is a symlink: ${target}`);
    if (targetStat && !targetStat.isFile()) throw new Error(`destination path is not a regular file: ${target}`);
    fs.copyFileSync(item.absolutePath, target);
  }
  for (const item of plan.marketFactsProjection?.shardFiles ?? []) {
    const target = path.join(plan.destinationRoot, ...item.relativePath.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const targetStat = lstatIfPresent(target);
    if (targetStat?.isSymbolicLink()) throw new Error(`destination shard path is a symlink: ${target}`);
    if (targetStat && !targetStat.isFile()) throw new Error(`destination shard path is not a regular file: ${target}`);
    fs.writeFileSync(target, item.body);
  }
  publishStockanalysisEtfShardProjection(plan.destinationRoot, plan.stockanalysisEtfProjection);
  logger(`[sync-public-data] copied ${result.filesCopied} files (${result.bytesCopied} bytes); sharded ${result.marketFactsTickerFiles} market-facts tickers into ${result.marketFactsShardFiles} files (${result.marketFactsShardBytes} bytes) and ${result.stockanalysisEtfTickerFiles} StockAnalysis ETF tickers into ${result.stockanalysisEtfShardFiles} files plus ${result.stockanalysisEtfManifestFiles} manifest; excluded ${result.excludedSourceRoots} private roots; removed ${result.removedDestinationRoots} stale private roots; excluded ${result.excludedSourceFiles} exact files; removed ${result.removedDestinationExactFiles} stale exact files; restricted ${result.restrictedSourceFiles} derived files and ${result.restrictedSourceRoots} derived roots; removed ${result.removedRestrictedDestinationExactFiles} stale restricted files and ${result.removedRestrictedDestinationRoots} stale restricted roots`);
  return result;
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
  const check = process.argv.includes("--check");
  const write = process.argv.includes("--write");
  if (check === write) {
    console.error("usage: sync-public-data.mjs (--check | --write) [--etf-shards-only] [--source <data>] [--destination <public/data>]");
    process.exit(2);
  }
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const options = {
    sourceRoot: getArg("--source") || path.resolve(appRoot, "..", "data"),
    destinationRoot: getArg("--destination") || path.join(appRoot, "public", "data"),
    dryRun: check,
  };
  const result = process.argv.includes("--etf-shards-only")
    ? syncStockanalysisEtfShardProjection(options)
    : syncPublicData(options);
  // The canonical copies keep their private-artifact references - the edge
  // coverage-index builder reads them to open the private manifests - so the
  // redaction belongs to the projection, immediately after it is written. Doing
  // it here rather than only in sync-static is the point: sync-static is not in
  // any producer path, so every regeneration through this script republished the
  // private tree structure that the mirror guard forbids.
  //
  // The base is derived from the destination actually written, not from this
  // script's own package root, so a run pointed at another tree redacts that
  // tree and never the real mirror.
  if (write) {
    redactPrivateArtifactPathMirrors({
      rootDir: path.resolve(options.destinationRoot, "..", ".."),
    });
  }
  console.log(JSON.stringify(result, null, 2));
}
