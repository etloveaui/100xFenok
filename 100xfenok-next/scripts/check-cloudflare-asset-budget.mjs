#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ASSET_LIMIT = 20_000;

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

export function inspectCloudflareAssetBudget({
  assetRoot,
  reportPath,
  limit = DEFAULT_ASSET_LIMIT,
}) {
  const root = path.resolve(assetRoot);
  const report = path.resolve(reportPath);
  const relativeReport = path.relative(root, report);
  if (!relativeReport.startsWith("..") || path.isAbsolute(relativeReport)) {
    throw new Error(`asset budget report must live outside asset root: ${report}`);
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`counted asset root must be a real directory: ${root}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`asset limit must be a positive integer: ${limit}`);

  const files = collectRegularFiles(root);
  const generatedDataManifest = validateGeneratedDataManifest(root);
  const count = files.length;
  const dataSupplyProjection = projectionCounts(files);
  validateProjectionCounts(root, dataSupplyProjection);
  const payload = {
    schema_version: "cloudflare-asset-budget/v1",
    counted_root: root,
    regular_file_count: count,
    limit,
    headroom: limit - count,
    status: count < limit ? "pass" : "fail",
    data_supply_projection: dataSupplyProjection,
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
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`[check-cloudflare-asset-budget] ${error.message}`);
    process.exit(1);
  }
}
