import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
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
  | "benchmarks"
  | "sentiment"
  | "slickcharts"
  | "damodaran"
  | "sec-13f";

type JsonFileEntry = {
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
};

async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  return schema.parse(parsed);
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

async function listJsonFileNames(absDir: string): Promise<string[]> {
  const entries = await readdir(absDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function buildJsonSample(
  absDir: string,
  publicBasePath: string,
  sampleLimit: number,
): Promise<{ count: number; sample: JsonFileEntry[] }> {
  const names = await listJsonFileNames(absDir);
  const sampleNames = names.slice(0, sampleLimit);
  const sample = await Promise.all(
    sampleNames.map(async (name): Promise<JsonFileEntry> => {
      const absPath = path.join(absDir, name);
      const info = await stat(absPath);
      return {
        name,
        path: `${publicBasePath}/${name}`,
        sizeBytes: info.size,
        updatedAt: info.mtime.toISOString(),
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
