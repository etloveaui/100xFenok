#!/usr/bin/env node
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "yardney");

const DEFAULT_SEED = path.join(dataRoot, "yardney", "yardney_model.json");
const DEFAULT_BENCHMARKS = path.join(dataRoot, "benchmarks", "us.json");
const DEFAULT_PUBLIC_OUT = path.join(dataRoot, "yardney", "yardney_model.json");
const DEFAULT_PUBLIC_MIRROR = path.join(publicDataRoot, "yardney", "yardney_model.json");
const DEFAULT_PRIVATE_OUT = path.join(privateRoot, "yardney_model_full.json");
const DEFAULT_PRIVATE_FRED_CACHE = path.join(privateRoot, "fred_yardeni_yields.json");

const FRED_SERIES = [
  { id: "WAAA", label: "Moody's Seasoned Aaa Corporate Bond Yield" },
  { id: "WBAA", label: "Moody's Seasoned Baa Corporate Bond Yield" },
];

const PUBLIC_COLUMNS = {
  date: "Weekly Friday date",
  spx: "S&P 500 Index",
  eps: "S&P 500 EPS",
  bond_per: "Bond PER",
  fair_value: "Estimated fair value = EPS x bond_per",
  premium_pct: "(SPX - fair_value) / fair_value x 100",
};

const PRIVATE_COLUMNS = {
  date: "Weekly Friday date",
  moodys_aaa: "FRED WAAA weekly Aaa corporate bond yield (%)",
  moodys_baa: "FRED WBAA weekly Baa corporate bond yield (%)",
  spread_avg: "Average of Aaa and Baa yield (%)",
  spx: "S&P 500 Index",
  eps: "S&P 500 EPS",
  bond_per: "Bond PER = 100 / average yield",
  fair_value: "Estimated fair value = EPS x bond_per",
  premium_pct: "(SPX - fair_value) / fair_value x 100",
};

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 2) {
  if (!finite(value)) return null;
  return Number(value.toFixed(digits));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function stablePublicPayloadForCheck(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return {
    ...payload,
    meta: {
      ...(payload.meta ?? {}),
      generated_at: null,
    },
  };
}

function sortedUnique(records, label) {
  const seen = new Set();
  let previous = "";
  for (const record of records) {
    if (!record.date || typeof record.date !== "string") {
      throw new Error(`${label}: record without date`);
    }
    if (seen.has(record.date)) {
      throw new Error(`${label}: duplicate date ${record.date}`);
    }
    if (previous && record.date < previous) {
      throw new Error(`${label}: records are not sorted at ${record.date}`);
    }
    seen.add(record.date);
    previous = record.date;
  }
  return records;
}

function normalizePublicSeedRecord(record) {
  return {
    date: String(record.date),
    spx: round(Number(record.spx), 2),
    eps: round(Number(record.eps), 4),
    bond_per: round(Number(record.bond_per), 2),
    fair_value: round(Number(record.fair_value), 2),
    premium_pct: round(Number(record.premium_pct), 2),
  };
}

function normalizePrivateSeedRecord(record) {
  const normalized = normalizePublicSeedRecord(record);
  if (finite(Number(record.moodys_aaa))) normalized.moodys_aaa = round(Number(record.moodys_aaa), 4);
  if (finite(Number(record.moodys_baa))) normalized.moodys_baa = round(Number(record.moodys_baa), 4);
  if (finite(Number(record.spread_avg))) normalized.spread_avg = round(Number(record.spread_avg), 4);
  return normalized;
}

function seriesMap(rows) {
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && typeof row.date === "string" && finite(Number(row.value)))
      .map((row) => [row.date, Number(row.value)]),
  );
}

function latestDate(rows) {
  const dates = (Array.isArray(rows) ? rows : [])
    .map((row) => row?.date)
    .filter((date) => typeof date === "string");
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function extractBenchmarkRows(payload) {
  const rows = payload?.sections?.sp500?.data;
  if (!Array.isArray(rows)) {
    throw new Error("benchmarks/us.json: sections.sp500.data[] is required");
  }
  return rows
    .map((row) => ({
      date: String(row.date ?? ""),
      spx: Number(row.px_last),
      eps: Number(row.best_eps),
    }))
    .filter((row) => row.date && finite(row.spx) && finite(row.eps) && row.eps > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildComputedPublicRecord(benchmark, aaaYield, baaYield) {
  const spx = round(benchmark.spx, 2);
  const eps = round(benchmark.eps, 4);
  const averageYield = (aaaYield + baaYield) / 2;
  const bondPer = round(100 / averageYield, 2);
  const fairValue = round(eps * bondPer, 2);
  const premiumPct = round(((spx - fairValue) / fairValue) * 100, 2);
  return {
    date: benchmark.date,
    spx,
    eps,
    bond_per: bondPer,
    fair_value: fairValue,
    premium_pct: premiumPct,
  };
}

function buildComputedPrivateRecord(publicRecord, aaaYield, baaYield) {
  return {
    date: publicRecord.date,
    moodys_aaa: round(aaaYield, 4),
    moodys_baa: round(baaYield, 4),
    spread_avg: round((aaaYield + baaYield) / 2, 4),
    spx: publicRecord.spx,
    eps: publicRecord.eps,
    bond_per: publicRecord.bond_per,
    fair_value: publicRecord.fair_value,
    premium_pct: publicRecord.premium_pct,
  };
}

export function buildFenoYardeniPayload({
  seedPayload,
  privateSeedPayload = null,
  benchmarkPayload,
  fredSeries,
  generatedAt = new Date().toISOString(),
  generatedBy = "codex",
} = {}) {
  const seedRecords = sortedUnique(
    (seedPayload?.data ?? []).map(normalizePublicSeedRecord),
    "public seed",
  );
  if (seedRecords.length === 0) throw new Error("public seed has no records");

  const privateSeedRows = Array.isArray(privateSeedPayload?.data)
    ? sortedUnique(privateSeedPayload.data.map(normalizePrivateSeedRecord), "private seed")
    : [];
  const privateSeedByDate = new Map(privateSeedRows.map((record) => [record.date, record]));

  const benchmarkRows = extractBenchmarkRows(benchmarkPayload);
  if (benchmarkRows.length === 0) throw new Error("benchmark source has no usable S&P 500 rows");

  const firstBenchmarkDate = benchmarkRows[0].date;
  const aaaByDate = seriesMap(fredSeries?.WAAA);
  const baaByDate = seriesMap(fredSeries?.WBAA);
  if (aaaByDate.size === 0 || baaByDate.size === 0) {
    throw new Error("FRED WAAA/WBAA series are required");
  }

  const preservedSeed = seedRecords.filter((record) => record.date < firstBenchmarkDate);
  const preservedPrivateSeed = preservedSeed.map((record) => privateSeedByDate.get(record.date) ?? record);
  const computedPublic = [];
  const computedPrivate = [];
  const skippedBenchmarkDates = [];

  for (const row of benchmarkRows) {
    const aaaYield = aaaByDate.get(row.date);
    const baaYield = baaByDate.get(row.date);
    if (!finite(aaaYield) || !finite(baaYield)) {
      skippedBenchmarkDates.push(row.date);
      continue;
    }
    const publicRecord = buildComputedPublicRecord(row, aaaYield, baaYield);
    computedPublic.push(publicRecord);
    computedPrivate.push(buildComputedPrivateRecord(publicRecord, aaaYield, baaYield));
  }

  const publicRows = sortedUnique([...preservedSeed, ...computedPublic], "public output");
  const privateRows = sortedUnique([...preservedPrivateSeed, ...computedPrivate], "private output");
  const last = publicRows.at(-1);
  const firstComputed = computedPublic[0] ?? null;
  const lastComputed = computedPublic.at(-1) ?? null;

  const sourceComponents = {
    bond_yield_input: FRED_SERIES.map((series) => ({
      series_id: series.id,
      label: series.label,
      latest_date: latestDate(fredSeries?.[series.id] ?? []),
    })),
    spx_eps_input: {
      file: "data/benchmarks/us.json",
      section: "sp500",
      fields: ["px_last", "best_eps"],
      source: benchmarkPayload?.metadata?.source ?? null,
      version: benchmarkPayload?.metadata?.version ?? null,
      generated: benchmarkPayload?.metadata?.generated ?? null,
    },
    preserved_seed_input: {
      file: "data/yardney/yardney_model.json",
      range: preservedSeed.length > 0 ? `${preservedSeed[0].date} ~ ${preservedSeed.at(-1).date}` : null,
      records: preservedSeed.length,
    },
  };

  const commonMeta = {
    model: "feno_yardeni_model",
    model_version: "feno_yardeni_fred_v1",
    description: "Feno Yardeni Bond PER to S&P 500 Fair Value",
    frequency: "weekly",
    date_range: `${publicRows[0].date} ~ ${last.date}`,
    total_records: publicRows.length,
    generated_at: generatedAt,
    generated_by: generatedBy,
    calculation_source: "FRED series/observations API corporate bond yields plus 100x benchmark S&P 500 price/EPS; benchmark EPS/SPX currently comes from the existing Bloomberg-sourced benchmarks pipeline; pre-benchmark history preserved from verified seed.",
    source_components: sourceComponents,
    formulas: {
      bond_per: "100 / average(Aaa corporate yield, Baa corporate yield)",
      fair_value: "S&P 500 EPS x bond_per",
      premium_pct: "(S&P 500 - fair_value) / fair_value x 100",
    },
    last_update: {
      mode: "feno_yardeni_rebuild",
      seed_preserved_records: preservedSeed.length,
      computed_records: computedPublic.length,
      skipped_benchmark_records: skippedBenchmarkDates.length,
      skipped_benchmark_dates_sample: skippedBenchmarkDates.slice(0, 12),
      first_computed_date: firstComputed?.date ?? null,
      last_computed_date: lastComputed?.date ?? null,
      last_public_date: last.date,
    },
  };

  const publicPayload = {
    meta: {
      ...commonMeta,
      columns: PUBLIC_COLUMNS,
      public_schema_version: "yardney_model_public_v1",
      public_payload: true,
      bond_yield_components_included: false,
    },
    data: publicRows,
  };

  const privatePayload = {
    meta: {
      ...commonMeta,
      columns: PRIVATE_COLUMNS,
      public_payload: false,
      bond_yield_components_included: true,
    },
    data: privateRows,
  };

  return {
    publicPayload,
    privatePayload,
    report: {
      seed_preserved_records: preservedSeed.length,
      computed_records: computedPublic.length,
      skipped_benchmark_records: skippedBenchmarkDates.length,
      first_output_date: publicRows[0].date,
      last_output_date: last.date,
      first_computed_date: firstComputed?.date ?? null,
      last_computed_date: lastComputed?.date ?? null,
    },
  };
}

export function parseFredObservations(payload, seriesId) {
  const observations = payload?.observations;
  if (!Array.isArray(observations)) {
    throw new Error(`${seriesId}: FRED observations[] missing`);
  }
  return observations
    .filter((row) => row?.value !== ".")
    .map((row) => ({
      date: String(row.date ?? ""),
      value: Number(row.value),
    }))
    .filter((row) => row.date && finite(row.value));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`${url}: HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`${url}: JSON parse error - ${error.message}`));
        }
      });
    }).on("error", reject);
  });
}

async function fetchFredSeries(seriesId) {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) throw new Error("FRED_API_KEY secret missing");
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: "1990-01-01",
    sort_order: "asc",
  });
  const url = `https://api.stlouisfed.org/fred/series/observations?${params.toString()}`;
  return parseFredObservations(await fetchJson(url), seriesId);
}

function parseArgs(argv) {
  const args = {
    fetch: false,
    seed: DEFAULT_SEED,
    privateSeed: DEFAULT_PRIVATE_OUT,
    benchmarks: DEFAULT_BENCHMARKS,
    fredFile: "",
    output: DEFAULT_PUBLIC_OUT,
    mirror: DEFAULT_PUBLIC_MIRROR,
    privateOutput: DEFAULT_PRIVATE_OUT,
    privateFredCache: DEFAULT_PRIVATE_FRED_CACHE,
    check: false,
    noWrite: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fetch") args.fetch = true;
    else if (arg === "--check") args.check = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg.startsWith("--seed=")) args.seed = arg.slice("--seed=".length);
    else if (arg === "--seed") args.seed = argv[++i];
    else if (arg.startsWith("--private-seed=")) args.privateSeed = arg.slice("--private-seed=".length);
    else if (arg === "--private-seed") args.privateSeed = argv[++i];
    else if (arg.startsWith("--benchmarks=")) args.benchmarks = arg.slice("--benchmarks=".length);
    else if (arg === "--benchmarks") args.benchmarks = argv[++i];
    else if (arg.startsWith("--fred-file=")) args.fredFile = arg.slice("--fred-file=".length);
    else if (arg === "--fred-file") args.fredFile = argv[++i];
    else if (arg.startsWith("--output=")) args.output = arg.slice("--output=".length);
    else if (arg === "--output") args.output = argv[++i];
    else if (arg.startsWith("--mirror=")) args.mirror = arg.slice("--mirror=".length);
    else if (arg === "--mirror") args.mirror = argv[++i];
    else if (arg.startsWith("--private-output=")) args.privateOutput = arg.slice("--private-output=".length);
    else if (arg === "--private-output") args.privateOutput = argv[++i];
    else if (arg.startsWith("--private-fred-cache=")) args.privateFredCache = arg.slice("--private-fred-cache=".length);
    else if (arg === "--private-fred-cache") args.privateFredCache = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

async function loadFredSeries(args) {
  if (args.fredFile) return readJson(args.fredFile).series ?? readJson(args.fredFile);
  if (args.fetch) {
    const series = {};
    for (const item of FRED_SERIES) {
      series[item.id] = await fetchFredSeries(item.id);
    }
    return series;
  }
  throw new Error("Provide --fetch or --fred-file <path>");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedPayload = readJson(args.seed);
  const privateSeedPayload = fs.existsSync(args.privateSeed) ? readJson(args.privateSeed) : null;
  const benchmarkPayload = readJson(args.benchmarks);
  const fredSeries = await loadFredSeries(args);
  const generatedAt = new Date().toISOString();
  const { publicPayload, privatePayload, report } = buildFenoYardeniPayload({
    seedPayload,
    privateSeedPayload,
    benchmarkPayload,
    fredSeries,
    generatedAt,
    generatedBy: "build-feno-yardeni-model.mjs",
  });

  if (args.check) {
    const current = fs.existsSync(args.output) ? JSON.parse(fs.readFileSync(args.output, "utf8")) : null;
    if (JSON.stringify(stablePublicPayloadForCheck(current)) !== JSON.stringify(stablePublicPayloadForCheck(publicPayload))) {
      throw new Error(`${path.relative(repoRoot, args.output)} is not up to date`);
    }
  }

  if (!args.noWrite) {
    writeJson(args.output, publicPayload);
    writeJson(args.mirror, publicPayload);
    writeJson(args.privateOutput, privatePayload);
    if (args.fetch) {
      writeJson(args.privateFredCache, {
        fetched_at: generatedAt,
        source: "FRED series/observations API",
        series: fredSeries,
      });
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
