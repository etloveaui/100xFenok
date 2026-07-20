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

export const EXCLUDED_PUBLIC_DATA_ROOTS = Object.freeze([
  "admin/apewisdom_attention",
  "admin/data-supply-state",
  "admin/finra_short_volume",
  "admin/gdelt_news_tone",
  "admin/occ_options_volume",
  "admin/yahoo_private_options",
  "admin/fred_yardeni",
  "admin/edgar_filings",
  "admin/nasdaq_giw_sox",
  "admin/oecd_cli",
  "yf/etf-details",
  "yf/migration-evidence",
]);

export const EXCLUDED_PUBLIC_DATA_FILES = Object.freeze([
  "admin/data-supply-detection-floor.json",
  "admin/damodaran-shadow-parity.json",
  "admin/lane-commit-manifest.json",
  // Private derived proxies (apewisdom_attention / gdelt_news_tone lanes,
  // public_mirror:[]). Withheld from the public mirror; the fetch scripts
  // declare these admin_private_derived_only_not_public. These are single
  // JSON artifacts, so they live in the FILES list — a file-shaped entry in
  // the ROOTS list crashes the build once the artifact exists on disk
  // (2026-07-19 apewisdom first-run firing).
  "computed/fenok_news_tone_proxy.json",
  "computed/fenok_news_tone_proxy_history.json",
  "computed/fenok_social_attention_proxy.json",
  "computed/fenok_social_attention_proxy_history.json",
]);

const MARKET_FACTS_TICKER_ROOT = "computed/market_facts/tickers";
const MARKET_FACTS_SHARD_ROOT = "computed/market_facts/shards";
const MARKET_FACTS_ROOT = "computed/market_facts";

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

function isExcludedFile(relativePath) {
  return EXCLUDED_PUBLIC_DATA_FILES.includes(normalizedRelative(relativePath));
}

function isTransformedRoot(relativePath) {
  return normalizedRelative(relativePath) === MARKET_FACTS_TICKER_ROOT;
}

function collectSourceFiles(sourceRoot, sourceRootBinding) {
  const files = [];
  const directories = [];
  let excludedSourceRoots = 0;
  const excludedSourceFilePaths = [];
  const transformedSourceRoots = [];
  let marketFactsRootSeen = false;

  function visit(directory, relativeDirectory = "", directoryBinding = sourceRootBinding) {
    for (const entry of readStableDirectoryEntries(directoryBinding)) {
      const relativePath = normalizedRelative(path.posix.join(relativeDirectory, entry.name));
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        throw new Error(`source public-data path is a symlink: ${absolutePath}`);
      }
      if (relativePath === MARKET_FACTS_ROOT) {
        if (!stat.isDirectory()) {
          throw new Error(`canonical market-facts root must be a directory: ${absolutePath}`);
        }
        marketFactsRootSeen = true;
      }
      if (relativePath === MARKET_FACTS_SHARD_ROOT) {
        throw new Error(`canonical source must not contain public-only market-facts shards: ${absolutePath}`);
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
    transformedSourceRoots,
    marketFactsRootSeen,
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

  return { roots, transformedRoots, exactFiles, bindings };
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
  if (!marketFactsProjection) {
    assertNoOrphanedDestinationMarketFactsProjection(destination);
  }
  preflightDestinationPaths(destination, sourcePlan);
  const transformedRelativeRoots = marketFactsProjection
    ? [MARKET_FACTS_TICKER_ROOT, MARKET_FACTS_SHARD_ROOT]
    : [];
  const removalPlan = collectDestinationRemovalPlan(destination, transformedRelativeRoots);
  return {
    sourceRoot: source,
    destinationRoot: destination,
    files: sourcePlan.files,
    directories: sourcePlan.directories,
    excludedSourceRoots: sourcePlan.excludedSourceRoots,
    excludedSourceFiles: sourcePlan.excludedSourceFiles,
    excludedSourceFilePaths: sourcePlan.excludedSourceFilePaths,
    removals: removalPlan.roots,
    transformedRemovals: removalPlan.transformedRoots,
    exactRemovals: removalPlan.exactFiles,
    removalBindings: removalPlan.bindings,
    sourceBindings: [
      sourceRootBinding,
      ...(marketFactsProjection?.sourceBindings ?? []),
    ],
    marketFactsProjection,
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
    removedDestinationRoots: plan.removals.length,
    removedDestinationFiles: plan.removals.reduce((sum, item) => sum + item.files.length, 0),
    removedDestinationExactFiles: plan.exactRemovals.length,
    removedDestinationExactFilePaths: plan.exactRemovals.map((item) => item.relativePath),
    marketFactsTickerFiles: plan.marketFactsProjection?.tickerFiles ?? 0,
    marketFactsShardFiles: plan.marketFactsProjection?.shardFiles.length ?? 0,
    marketFactsShardBytes: plan.marketFactsProjection?.bytes ?? 0,
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
  }));
  revalidateSourceBindings(plan.sourceBindings, "after beforeMutation");
  revalidateDestinationRemovalPlan(plan.removalBindings);
  revalidateSourceBindings(plan.sourceBindings, "immediately before destination mutation");
  const removalBindingByPath = new Map(
    plan.removalBindings.map((binding) => [binding.filePath, binding]),
  );
  fs.mkdirSync(plan.destinationRoot, { recursive: true });
  removeDestinationExactFiles(plan.exactRemovals, removalBindingByPath);
  removeDestinationRoots(plan.removals, removalBindingByPath);
  removeDestinationRoots(plan.transformedRemovals, removalBindingByPath);
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
  logger(`[sync-public-data] copied ${result.filesCopied} files (${result.bytesCopied} bytes); sharded ${result.marketFactsTickerFiles} market-facts tickers into ${result.marketFactsShardFiles} files (${result.marketFactsShardBytes} bytes); excluded ${result.excludedSourceRoots} private roots; removed ${result.removedDestinationRoots} stale private roots; excluded ${result.excludedSourceFiles} exact files; removed ${result.removedDestinationExactFiles} stale exact files`);
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
    console.error("usage: sync-public-data.mjs (--check | --write) [--source <data>] [--destination <public/data>]");
    process.exit(2);
  }
  const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = syncPublicData({
    sourceRoot: getArg("--source") || path.resolve(appRoot, "..", "data"),
    destinationRoot: getArg("--destination") || path.join(appRoot, "public", "data"),
    dryRun: check,
  });
  console.log(JSON.stringify(result, null, 2));
}
