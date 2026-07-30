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

const STOCKANALYSIS_ETF_SHARD_ONLY_MODE = "shard-only";

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
  const prefix = "data/computed/data-supply/etf-detail/";
  const projection = files.filter((item) => item.relativePath.startsWith(prefix));
  const enrollmentFiles = projection.filter((item) => item.relativePath === `${prefix}enrollment.json`).length;
  const indexFiles = projection.filter((item) => item.relativePath === `${prefix}index.json`).length;
  const payloadFiles = projection.filter((item) => /^data\/computed\/data-supply\/etf-detail\/payloads\/[^/]+\.json$/.test(item.relativePath)).length;
  const recognized = enrollmentFiles + indexFiles + payloadFiles;
  if (recognized !== projection.length) {
    const unknown = projection.filter((item) => (
      item.relativePath !== `${prefix}enrollment.json`
      && item.relativePath !== `${prefix}index.json`
      && !/^data\/computed\/data-supply\/etf-detail\/payloads\/[^/]+\.json$/.test(item.relativePath)
    ));
    throw new Error(`unexpected R2.4 projection assets: ${unknown.map((item) => item.relativePath).join(", ")}`);
  }
  return {
    enrollment_files: enrollmentFiles,
    index_files: indexFiles,
    payload_files: payloadFiles,
    total_files: projection.length,
  };
}

function validateProjectionCounts(assetRoot, counts) {
  if (counts.enrollment_files !== 1 || counts.index_files !== 1) {
    throw new Error(`R2.4 asset projection requires one enrollment and one index file: ${JSON.stringify(counts)}`);
  }
  const indexPath = path.join(assetRoot, "data", "computed", "data-supply", "etf-detail", "index.json");
  let index;
  try {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  } catch (error) {
    throw new Error(`R2.4 asset index is invalid JSON: ${error.message}`);
  }
  if (!Number.isInteger(index?.selected_count) || index.selected_count < 0) {
    throw new Error("R2.4 asset index selected_count is invalid");
  }
  if (counts.payload_files !== index.selected_count || counts.total_files !== index.selected_count + 2) {
    throw new Error(`R2.4 asset projection count mismatch: index=${index.selected_count}, files=${JSON.stringify(counts)}`);
  }
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
  const dataSupplyProjection = projectionCounts(files);
  validateProjectionCounts(root, dataSupplyProjection);
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
