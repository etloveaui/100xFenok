import type { Dirent } from "node:fs";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { normalizeForFilePath } from "@/lib/ticker";
import type { z } from "zod";
import {
  benchmarkCatalogSchema,
  benchmarkSummarySchema,
  dataRootManifestSchema,
  folderSchemaMetaSchema,
  sentimentSeriesSchema,
  type BenchmarkCatalog,
  type BenchmarkSummary,
  type DataRootManifest,
  type FolderSchemaMeta,
  type SentimentSeries,
} from "@/schemas/data";

const PUBLIC_DATA_ROOT = path.join(process.cwd(), "public", "data");
const DATA_MANIFEST_PATH = path.join(PUBLIC_DATA_ROOT, "manifest.json");
const DATA_JSON_FILES_MANIFEST_PATH = path.join(
  process.cwd(),
  "public",
  "generated",
  "data-json-files-manifest.json",
);

const SENTIMENT_FILES = [
  "aaii",
  "cftc-sp500",
  "cnn-breadth",
  "cnn-components",
  "cnn-fear-greed",
  "cnn-junk-bond",
  "cnn-momentum",
  "cnn-put-call",
  "cnn-safe-haven",
  "cnn-strength",
  "crypto-fear-greed",
  "move",
  "vix",
] as const;

type SentimentFile = (typeof SENTIMENT_FILES)[number];

type DataFolderKey =
  | "admin"
  | "benchmarks"
  | "calendar"
  | "computed"
  | "sentiment"
  | "slickcharts"
  | "stockanalysis"
  | "damodaran"
  | "global-scouter"
  | "indices"
  | "macro"
  | "sec-13f"
  | "yardney"
  | "yf";

type JsonFileEntry = {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
};

type DataJsonManifestEntry = Omit<JsonFileEntry, "path">;
type DataJsonFilesByPath = Record<string, readonly DataJsonManifestEntry[]>;
type JsonRecord = Record<string, unknown>;
export type PublicJsonDocument = { raw: string; value: JsonRecord };
export type StockanalysisAssetKind = "etfs" | "stocks" | "financials";

let dataJsonFilesByPathPromise: Promise<DataJsonFilesByPath> | null = null;

async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readPublicDataFile(filePath);
  const parsed = JSON.parse(raw) as unknown;
  return schema.parse(parsed);
}

async function readPublicDataFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch (fsError) {
    const publicPath = toPublicPath(filePath);
    if (!publicPath) throw fsError;

    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const { env } = await getCloudflareContext({ async: true });
      const assets = env.ASSETS;
      if (!assets) throw fsError;

      const response = await assets.fetch(new URL(publicPath, "https://assets.local"));
      if (!response.ok) {
        throw new Error(`ASSET_FETCH_FAILED:${response.status}:${publicPath}`);
      }
      return await response.text();
    } catch {
      throw fsError;
    }
  }
}

function asJsonRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

async function readOptionalJsonRecord(filePath: string): Promise<JsonRecord | null> {
  try {
    return asJsonRecord(JSON.parse(await readPublicDataFile(filePath)) as unknown);
  } catch {
    return null;
  }
}

async function readStrictPublicJsonDocument(filePath: string): Promise<PublicJsonDocument | null> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink()) return null;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code !== "ENOENT") return null;
  }

  try {
    const raw = await readPublicDataFile(filePath);
    const value = asJsonRecord(JSON.parse(raw) as unknown);
    return value ? { raw, value } : null;
  } catch {
    return null;
  }
}

export function normalizeStockanalysisAssetKind(value: string): StockanalysisAssetKind | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "etfs" || normalized === "stocks" || normalized === "financials") return normalized;
  return null;
}

export function normalizeStockanalysisTicker(value: string): string | null {
  const normalized = normalizeForFilePath(value);
  if (!/^[A-Z0-9][A-Z0-9.-]{0,19}$/.test(normalized)) return null;
  return normalized;
}

export function normalizeStockanalysisSurfaceName(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(normalized)) return null;
  return normalized;
}

function toPublicPath(filePath: string): string | null {
  const relative = path.relative(path.join(process.cwd(), "public"), filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return `/${relative.split(path.sep).join("/")}`;
}

async function getRootDataManifest() {
  return readJson<DataRootManifest>(DATA_MANIFEST_PATH, dataRootManifestSchema);
}

async function getFolderSchemaMeta(folder: DataFolderKey): Promise<FolderSchemaMeta | null> {
  const schemaPath = path.join(PUBLIC_DATA_ROOT, folder, "schema.json");
  try {
    return await readJson<FolderSchemaMeta>(schemaPath, folderSchemaMetaSchema);
  } catch {
    return null;
  }
}

function getDataPathKey(publicBasePath: string) {
  return publicBasePath.replace(/^\/data\/?/, "") || ".";
}

function parseDataJsonFilesManifest(value: unknown): DataJsonFilesByPath {
  const manifest = asJsonRecord(value);
  if (!manifest) throw new Error("INVALID_DATA_JSON_FILES_MANIFEST");

  const parsed: Record<string, DataJsonManifestEntry[]> = {};
  for (const [directory, entries] of Object.entries(manifest)) {
    if (!Array.isArray(entries)) throw new Error(`INVALID_DATA_JSON_FILES_MANIFEST:${directory}`);

    parsed[directory] = entries.map((entry, index) => {
      const record = asJsonRecord(entry);
      if (
        !record ||
        typeof record.name !== "string" ||
        typeof record.sizeBytes !== "number" ||
        !Number.isFinite(record.sizeBytes) ||
        typeof record.updatedAt !== "string"
      ) {
        throw new Error(`INVALID_DATA_JSON_FILES_MANIFEST:${directory}:${index}`);
      }

      return {
        name: record.name,
        sizeBytes: record.sizeBytes,
        updatedAt: record.updatedAt,
      };
    });
  }

  return parsed;
}

async function getDataJsonFilesByPath(): Promise<DataJsonFilesByPath> {
  dataJsonFilesByPathPromise ??= readPublicDataFile(DATA_JSON_FILES_MANIFEST_PATH).then((raw) =>
    parseDataJsonFilesManifest(JSON.parse(raw) as unknown),
  );
  return dataJsonFilesByPathPromise;
}

async function getManifestJsonEntries(publicBasePath: string): Promise<DataJsonManifestEntry[]> {
  const key = getDataPathKey(publicBasePath);
  const manifest = await getDataJsonFilesByPath();
  return [...(manifest[key] ?? [])];
}

async function getAllManifestJsonEntries() {
  const manifest = await getDataJsonFilesByPath();
  return Object.entries(manifest)
    .flatMap(([directory, entries]) =>
      entries.map((entry) => ({
        directory,
        ...entry,
      })),
    );
}

async function listJsonFileNames(
  absDir: string,
  publicBasePath: string,
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return (await getManifestJsonEntries(publicBasePath))
      .filter((entry) => entry.name !== "schema.json")
      .map((entry) => entry.name);
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "schema.json")
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function getCategory(directory: string, name: string) {
  if (directory !== ".") return directory.split("/")[0] ?? "root";
  return name === "manifest.json" || name === "reports-index.json" ? "root" : "metadata";
}

function getConsumerLane(publicPath: string, category: string) {
  if (category === "root" || category === "metadata" || category === "admin") return "admin";
  if (category === "computed" && /audit|parity/i.test(publicPath)) return "admin";
  if (category === "calendar" || category === "computed") return "explore";
  if (category === "sec-13f") return "superinvestors";
  if (category === "yf") return "stock";
  if (category === "stockanalysis") {
    if (publicPath.includes("/backfill/")) return "admin";
    if (publicPath.includes("/surfaces/index.json")) return "admin";
    if (publicPath.includes("/surfaces/")) return "explore";
    if (publicPath.includes("/etf_universe.json")) return "explore";
    return "stock";
  }
  if (category === "global-scouter") {
    if (publicPath.includes("/stocks/detail/")) return "stock";
    if (publicPath.includes("/raw/") || publicPath.includes("/indicators/")) return "screener";
    return "screener";
  }
  if (category === "slickcharts") {
    if (publicPath.includes("/stocks/") || publicPath.includes("stocks-dividends") || publicPath.includes("stocks-returns")) {
      return "stock";
    }
    if (publicPath.includes("gainers") || publicPath.includes("losers") || publicPath.includes("membership")) {
      return "explore";
    }
    return "market";
  }
  if (category === "damodaran") {
    return publicPath.includes("industry") || publicPath.includes("credit") ? "stock" : "market";
  }
  if (category === "benchmarks" || category === "indices" || category === "macro" || category === "sentiment" || category === "yardney") {
    return "market";
  }
  return "admin";
}

function getContentClass(publicPath: string, category: string) {
  const key = publicPath.toLowerCase();
  if (key.includes("schema.json") || key.includes("manifest.json") || category === "root" || category === "metadata") return "metadata";
  if (category === "sec-13f") return key.includes("/investors/") ? "investor-history" : "investor-analytics";
  if (category === "yf") return "ticker-finance";
  if (category === "stockanalysis") {
    if (key.includes("/etf_universe.json")) return "etf-universe";
    if (key.includes("/backfill/")) return "fetch-audit";
    if (key.includes("/surfaces/")) return "market-event-surface";
    if (key.includes("/etfs/")) return "etf-holdings";
    if (key.includes("/stocks/")) return "stock-overview";
    return "ticker-finance";
  }
  if (key.includes("/stocks/detail/")) return "ticker-detail";
  if (key.includes("/stocks/")) return "ticker-slickcharts";
  if (category === "benchmarks") return "valuation-history";
  if (category === "indices") return "index-history";
  if (category === "macro") return "macro-series";
  if (category === "sentiment") return "sentiment-series";
  if (category === "slickcharts") return "market-structure";
  if (category === "damodaran") return "valuation-input";
  if (category === "computed" && key.includes("audit")) return "fetch-audit";
  if (category === "computed" && key.includes("parity")) return "source-parity";
  if (category === "computed") return "computed-signal";
  if (category === "calendar") return "event-calendar";
  return "dataset";
}

function hasHistoricalShape(publicPath: string, category: string) {
  const key = publicPath.toLowerCase();
  if (key.endsWith("/schema.json") || key.endsWith("/manifest.json") || key.endsWith("/reports-index.json")) return false;
  return (
    category === "benchmarks" ||
    category === "indices" ||
    category === "macro" ||
    category === "sentiment" ||
    category === "yardney" ||
    key.includes("/stocks/detail/") ||
    key.includes("/yf/finance/") ||
    key.includes("/sec-13f/investors/") ||
    key.includes("historical") ||
    key.includes("history") ||
    key.includes("returns") ||
    key.includes("drawdown") ||
    key.includes("performance") ||
    key.includes("gainers") ||
    key.includes("losers") ||
    key.includes("multi_quarter") ||
    key.includes("ratio")
  );
}

function addCount(target: Record<string, number>, key: string) {
  target[key] = (target[key] ?? 0) + 1;
}

export async function getDataAtlas() {
  const root = await getRootDataManifest();
  const entries = (await getAllManifestJsonEntries())
    .map((entry) => {
      const category = getCategory(entry.directory, entry.name);
      const relativePath = entry.directory === "." ? entry.name : `${entry.directory}/${entry.name}`;
      const publicPath = `/data/${relativePath}`;
      const consumerLane = getConsumerLane(publicPath, category);
      const historical = hasHistoricalShape(publicPath, category);

      return {
        path: publicPath,
        directory: entry.directory,
        category,
        name: entry.name,
        sizeBytes: entry.sizeBytes,
        sizeLabel: formatBytes(entry.sizeBytes),
        updatedAt: entry.updatedAt,
        contentClass: getContentClass(publicPath, category),
        consumerLane,
        historical,
      };
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  const categoryMap = new Map<string, {
    key: string;
    fileCount: number;
    totalSizeBytes: number;
    totalSizeLabel: string;
    historicalCount: number;
    directories: Set<string>;
    lanes: Record<string, number>;
    classes: Record<string, number>;
    declaredFileCount: number | null;
    updated: string | null;
    source: string | null;
    description: string | null;
  }>();

  for (const file of entries) {
    const meta = root.folders[file.category];
    const current = categoryMap.get(file.category) ?? {
      key: file.category,
      fileCount: 0,
      totalSizeBytes: 0,
      totalSizeLabel: "0 B",
      historicalCount: 0,
      directories: new Set<string>(),
      lanes: {},
      classes: {},
      declaredFileCount: meta?.file_count ?? null,
      updated: meta?.updated ?? null,
      source: meta?.source ?? null,
      description: meta?.description ?? null,
    };
    current.fileCount += 1;
    current.totalSizeBytes += file.sizeBytes;
    current.historicalCount += file.historical ? 1 : 0;
    current.directories.add(file.directory);
    addCount(current.lanes, file.consumerLane);
    addCount(current.classes, file.contentClass);
    current.totalSizeLabel = formatBytes(current.totalSizeBytes);
    categoryMap.set(file.category, current);
  }

  const categories = [...categoryMap.values()]
    .map((category) => ({
      ...category,
      directories: [...category.directories].sort(),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));

  const laneCounts: Record<string, number> = {};
  const classCounts: Record<string, number> = {};
  entries.forEach((entry) => {
    addCount(laneCounts, entry.consumerLane);
    addCount(classCounts, entry.contentClass);
  });

  return {
    generatedAt: new Date().toISOString(),
    manifestLastUpdated: root.last_updated ?? null,
    totals: {
      fileCount: entries.length,
      categoryCount: categories.length,
      directoryCount: new Set(entries.map((entry) => entry.directory)).size,
      totalSizeBytes: entries.reduce((total, entry) => total + entry.sizeBytes, 0),
      totalSizeLabel: formatBytes(entries.reduce((total, entry) => total + entry.sizeBytes, 0)),
      historicalCount: entries.filter((entry) => entry.historical).length,
      laneCounts,
      classCounts,
    },
    categories,
    files: entries,
  };
}

async function buildJsonSample(
  absDir: string,
  publicBasePath: string,
  sampleLimit: number,
): Promise<{ count: number; sample: JsonFileEntry[] }> {
  const names = await listJsonFileNames(absDir, publicBasePath);
  const manifestEntries = await getManifestJsonEntries(publicBasePath).catch(() => []);
  const manifestByName = new Map(
    manifestEntries.map((entry) => [entry.name, entry]),
  );
  const sampleNames = names.slice(0, sampleLimit);
  const sample = await Promise.all(
    sampleNames.map(async (name): Promise<JsonFileEntry> => {
      const absPath = path.join(absDir, name);
      const info = await stat(absPath).catch(() => null);
      const manifestEntry = manifestByName.get(name);
      return {
        name,
        path: `${publicBasePath}/${name}`,
        sizeBytes: info?.size ?? manifestEntry?.sizeBytes ?? 0,
        updatedAt: info?.mtime.toISOString() ?? manifestEntry?.updatedAt ?? "",
      };
    }),
  );

  return { count: names.length, sample };
}

async function getBaseMeta(folder: DataFolderKey) {
  const [root, schemaMeta] = await Promise.all([
    getRootDataManifest(),
    getFolderSchemaMeta(folder),
  ]);
  const manifestMeta = root.folders[folder];

  return {
    version: schemaMeta?.version ?? manifestMeta?.version ?? null,
    updated: schemaMeta?.updated ?? manifestMeta?.updated ?? null,
    source: schemaMeta?.source ?? manifestMeta?.source ?? null,
    updateFrequency:
      schemaMeta?.update_frequency ?? manifestMeta?.update_frequency ?? null,
    declaredFileCount: manifestMeta?.file_count ?? null,
    description: manifestMeta?.description ?? null,
  };
}

export async function getBenchmarksManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "benchmarks");
  const catalogPath = path.join(baseDir, "schema.json");
  const catalog = await readJson<BenchmarkCatalog>(catalogPath, benchmarkCatalogSchema);

  const summaryPath = path.join(baseDir, "summaries.json");
  const summary = await readJson<BenchmarkSummary>(summaryPath, benchmarkSummarySchema);
  const files = Object.entries(catalog.files)
    .filter(([fileName]) => fileName.endsWith(".json"))
    .map(([fileName, meta]) => ({
      id: fileName.replace(/\.json$/, ""),
      path: `/data/benchmarks/${fileName}`,
      description: meta.description ?? "",
      dateRange: meta.date_range ?? [],
      recordsPerIndex: meta.records_per_index ?? null,
      sectorCount: Array.isArray(meta.sectors) ? meta.sectors.length : null,
    }));

  return {
    generatedAt: summary.metadata.generated ?? null,
    basePath: "/data/benchmarks/",
    version: catalog.version,
    updated: catalog.updated,
    source: catalog.source ?? summary.metadata.source,
    files,
    summary: {
      path: "/data/benchmarks/summaries.json",
      seriesCount: Object.keys(summary.momentum).length,
      source: summary.metadata.source,
      version: summary.metadata.version,
    },
  };
}

export async function getSentimentManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "sentiment");
  const files = await Promise.all(
    SENTIMENT_FILES.map(async (file): Promise<{
      id: SentimentFile;
      path: string;
      recordCount: number;
      latestDate: string | null;
      fields: string[];
    }> => {
      const jsonPath = path.join(baseDir, `${file}.json`);
      const dataset = await readJson<SentimentSeries>(jsonPath, sentimentSeriesSchema);
      const latest = dataset.at(-1) ?? null;
      const fields = dataset[0] ? Object.keys(dataset[0]).sort() : [];

      return {
        id: file,
        path: `/data/sentiment/${file}.json`,
        recordCount: dataset.length,
        latestDate: latest?.date ?? null,
        fields,
      };
    }),
  );

  const meta = await getBaseMeta("sentiment");
  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/sentiment/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    declaredFileCount: meta.declaredFileCount,
    files,
  };
}

export async function getSlickchartsManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "slickcharts");
  const stocksDir = path.join(baseDir, "stocks");
  const [meta, topLevel, stocks] = await Promise.all([
    getBaseMeta("slickcharts"),
    buildJsonSample(baseDir, "/data/slickcharts", 40),
    buildJsonSample(stocksDir, "/data/slickcharts/stocks", 25),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/slickcharts/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    declaredFileCount: meta.declaredFileCount,
    description: meta.description,
    files: {
      topLevelCount: topLevel.count,
      stockFileCount: stocks.count,
      topLevelSample: topLevel.sample,
      stockSample: stocks.sample,
    },
  };
}

export async function getStockanalysisManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "stockanalysis");
  const etfsDir = path.join(baseDir, "etfs");
  const stocksDir = path.join(baseDir, "stocks");
  const financialsDir = path.join(baseDir, "financials");
  const backfillDir = path.join(baseDir, "backfill");
  const coverageDir = path.join(baseDir, "coverage");
  const surfacesDir = path.join(baseDir, "surfaces");
  const universePath = path.join(baseDir, "etf_universe.json");
  const indexPath = path.join(baseDir, "index.json");
  const latestBackfillPath = path.join(backfillDir, "latest.json");
  const etfCoveragePath = path.join(coverageDir, "etf_detail.json");
  const surfaceIndexPath = path.join(surfacesDir, "index.json");

  const [meta, topLevel, etfs, stocks, financials, backfill, coverage, surfaces, universe, index, latestBackfill, etfCoverage, surfaceIndex] =
    await Promise.all([
      getBaseMeta("stockanalysis"),
      buildJsonSample(baseDir, "/data/stockanalysis", 20),
      buildJsonSample(etfsDir, "/data/stockanalysis/etfs", 30),
      buildJsonSample(stocksDir, "/data/stockanalysis/stocks", 30),
      buildJsonSample(financialsDir, "/data/stockanalysis/financials", 30),
      buildJsonSample(backfillDir, "/data/stockanalysis/backfill", 20),
      buildJsonSample(coverageDir, "/data/stockanalysis/coverage", 10),
      buildJsonSample(surfacesDir, "/data/stockanalysis/surfaces", 30),
      readOptionalJsonRecord(universePath),
      readOptionalJsonRecord(indexPath),
      readOptionalJsonRecord(latestBackfillPath),
      readOptionalJsonRecord(etfCoveragePath),
      readOptionalJsonRecord(surfaceIndexPath),
    ]);

  const universeRecords = Array.isArray(universe?.records)
    ? universe.records.slice(0, 10)
    : [];
  const indexResults = Array.isArray(index?.results) ? index.results.slice(0, 10) : [];
  const latestBackfillResults = Array.isArray(latestBackfill?.results)
    ? latestBackfill.results.slice(0, 10)
    : [];
  const surfaceResults = Array.isArray(surfaceIndex?.results)
    ? surfaceIndex.results
    : [];

  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/stockanalysis/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    declaredFileCount: meta.declaredFileCount,
    description: meta.description,
    files: {
      topLevelCount: topLevel.count,
      etfFileCount: etfs.count,
      stockFileCount: stocks.count,
      financialFileCount: financials.count,
      backfillFileCount: backfill.count,
      coverageFileCount: coverage.count,
      surfaceFileCount: surfaces.count,
      topLevelSample: topLevel.sample,
      etfSample: etfs.sample,
      stockSample: stocks.sample,
      financialSample: financials.sample,
      backfillSample: backfill.sample,
      coverageSample: coverage.sample,
      surfaceSample: surfaces.sample,
      etfUniverse: universe ? "/data/stockanalysis/etf_universe.json" : null,
      index: index ? "/data/stockanalysis/index.json" : null,
      latestBackfill: latestBackfill ? "/data/stockanalysis/backfill/latest.json" : null,
      etfCoverage: etfCoverage ? "/data/stockanalysis/coverage/etf_detail.json" : null,
      surfaceIndex: surfaceIndex ? "/data/stockanalysis/surfaces/index.json" : null,
    },
    universe: universe
      ? {
          generated_at: universe.generated_at ?? null,
          asset_type: universe.asset_type ?? null,
          counts: universe.counts ?? null,
          warnings: universe.warnings ?? null,
          sample_records: universeRecords,
        }
      : null,
    index: index
      ? {
          generated_at: index.generated_at ?? null,
          counts: index.counts ?? null,
          stop_reason: index.stop_reason ?? null,
          sample_results: indexResults,
        }
      : null,
    latestBackfill: latestBackfill
      ? {
          generated_at: latestBackfill.generated_at ?? null,
          counts: latestBackfill.counts ?? null,
          stop_reason: latestBackfill.stop_reason ?? null,
          sample_results: latestBackfillResults,
        }
      : null,
    coverage: etfCoverage
      ? {
          generated_at: etfCoverage.generated_at ?? null,
          status: etfCoverage.status ?? null,
          counts: etfCoverage.counts ?? null,
          samples: etfCoverage.samples ?? null,
        }
      : null,
    surfaces: surfaceIndex
      ? {
          generated_at: surfaceIndex.generated_at ?? null,
          counts: surfaceIndex.counts ?? null,
          sample_results: surfaceResults,
        }
      : null,
  };
}

export async function getStockanalysisAsset(
  assetKind: StockanalysisAssetKind,
  ticker: string,
) {
  const assetPath = path.join(PUBLIC_DATA_ROOT, "stockanalysis", assetKind, `${ticker}.json`);
  return readOptionalJsonRecord(assetPath);
}

export async function getStockanalysisAssetDocument(
  assetKind: StockanalysisAssetKind,
  ticker: string,
) {
  const assetPath = path.join(PUBLIC_DATA_ROOT, "stockanalysis", assetKind, `${ticker}.json`);
  return readStrictPublicJsonDocument(assetPath);
}

export async function getDataSupplyEtfEnrollmentDocument() {
  return readStrictPublicJsonDocument(path.join(
    PUBLIC_DATA_ROOT,
    "computed",
    "data-supply",
    "etf-detail",
    "enrollment.json",
  ));
}

export async function getDataSupplyEtfIndexDocument() {
  return readStrictPublicJsonDocument(path.join(
    PUBLIC_DATA_ROOT,
    "computed",
    "data-supply",
    "etf-detail",
    "index.json",
  ));
}

export async function getDataSupplyEtfPayloadDocument(ticker: string) {
  return readStrictPublicJsonDocument(path.join(
    PUBLIC_DATA_ROOT,
    "computed",
    "data-supply",
    "etf-detail",
    "payloads",
    `${ticker}.json`,
  ));
}

export async function getStockanalysisEtfUniverse() {
  const universePath = path.join(PUBLIC_DATA_ROOT, "stockanalysis", "etf_universe.json");
  return readOptionalJsonRecord(universePath);
}

export async function getStockanalysisSurface(surfaceName: string) {
  const surfacePath = path.join(PUBLIC_DATA_ROOT, "stockanalysis", "surfaces", `${surfaceName}.json`);
  return readOptionalJsonRecord(surfacePath);
}

export async function getDamodaranManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "damodaran");
  const [meta, files] = await Promise.all([
    getBaseMeta("damodaran"),
    buildJsonSample(baseDir, "/data/damodaran", 20),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/damodaran/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    declaredFileCount: meta.declaredFileCount,
    description: meta.description,
    files: {
      count: files.count,
      sample: files.sample,
    },
  };
}

export async function getMacroManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "macro");
  const [meta, files] = await Promise.all([
    getBaseMeta("macro"),
    buildJsonSample(baseDir, "/data/macro", 10),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/macro/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    declaredFileCount: meta.declaredFileCount,
    description: meta.description,
    files: {
      count: files.count,
      sample: files.sample,
    },
  };
}

export async function getSec13fManifest() {
  const baseDir = path.join(PUBLIC_DATA_ROOT, "sec-13f");
  const investorsDir = path.join(baseDir, "investors");
  const [meta, rootFiles, investors] = await Promise.all([
    getBaseMeta("sec-13f"),
    buildJsonSample(baseDir, "/data/sec-13f", 20),
    buildJsonSample(investorsDir, "/data/sec-13f/investors", 30),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/sec-13f/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    declaredFileCount: meta.declaredFileCount,
    description: meta.description,
    files: {
      rootJsonCount: rootFiles.count,
      investorFileCount: investors.count,
      rootSample: rootFiles.sample,
      investorSample: investors.sample,
    },
  };
}

export async function getMarketQualityManifest() {
  const auditPath = path.join(PUBLIC_DATA_ROOT, "computed", "market_data_audit.json");
  const sourceParityPath = path.join(PUBLIC_DATA_ROOT, "computed", "market_source_parity.json");
  const [meta, audit, sourceParity] = await Promise.all([
    getBaseMeta("computed"),
    readOptionalJsonRecord(auditPath),
    readOptionalJsonRecord(sourceParityPath),
  ]);

  const backfill = asJsonRecord(audit?.backfill);
  const readyForFinalize = backfill?.ready_for_finalize === true;
  const topDivergences = Array.isArray(sourceParity?.top_divergences)
    ? sourceParity.top_divergences.slice(0, 20)
    : [];

  return {
    generatedAt: new Date().toISOString(),
    basePath: "/data/computed/",
    version: meta.version,
    updated: meta.updated,
    source: meta.source,
    updateFrequency: meta.updateFrequency,
    files: {
      audit: audit ? "/data/computed/market_data_audit.json" : null,
      sourceParity: sourceParity ? "/data/computed/market_source_parity.json" : null,
    },
    status: audit ? (readyForFinalize ? "ready" : "in_progress") : "not_available",
    audit: audit
      ? {
          generated_at: audit.generated_at ?? null,
          stockanalysis: audit.stockanalysis ?? null,
          backfill: backfill
            ? {
                chunk_files: backfill.chunk_files ?? null,
                expected_chunk_files: backfill.expected_chunk_files ?? null,
                next_expected_offset: backfill.next_expected_offset ?? null,
                ready_for_finalize: readyForFinalize,
                hard_error_count: backfill.hard_error_count ?? null,
                status_counts: backfill.status_counts ?? null,
                error_kinds: backfill.error_kinds ?? null,
              }
            : null,
          market_facts: audit.market_facts ?? null,
          market_source_parity: audit.market_source_parity ?? null,
        }
      : null,
    sourceParity: sourceParity
      ? {
          generated_at: sourceParity.generated_at ?? null,
          summary: sourceParity.summary ?? null,
          top_divergences: topDivergences,
        }
      : null,
  };
}
