#!/usr/bin/env node
/**
 * Private/admin FINRA source/backfill loader.
 *
 * Scope:
 * - Defaults to the FINRA CNMS daily short-volume dataset only.
 * - Writes only under _private/admin/fenok-flow/finra/.
 * - Does not create public/computed mirrors or product-facing scores.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow");
const FINRA_ROOT = path.join(privateRoot, "finra");
const REGSHO_DAILY_CACHE_DIR = path.join(FINRA_ROOT, "regsho_daily");
const MANIFEST_FILE = path.join(FINRA_ROOT, "manifests", "collection_manifest.json");
const DEFAULT_DATASET = "regsho-daily";
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BACKOFF_MS = 2000;
const DEFAULT_SLEEP_MS = 0;
const FINRA_AVAILABILITY_POLICY = {
  source_id: "finra_daily_short_sale_volume_files",
  availability_status: "official_release_by_time_verified",
  official_release_by_local_time: "18:00 America/New_York same trade date",
  official_evidence: "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files",
  kst_equivalent: {
    edt: "next-day 07:00 KST",
    est: "next-day 08:00 KST",
  },
  scheduler_guidance: {
    initial_daily_run_kst: "08:30",
    rationale: "Runs after the known FINRA 18:00 ET deadline in both EDT and EST; keep retries because rare late source/cdn updates are possible.",
    do_not_default_to: ["23:45 ET", "12:45 KST"],
  },
  poll_window_kst: {
    start: "07:05",
    end: "09:30",
  },
};

const DATASETS = {
  [DEFAULT_DATASET]: {
    dataset_id: DEFAULT_DATASET,
    provider: "FINRA",
    display_name: "CNMS daily short sale volume",
    cadence: "daily",
    cache_scope: "admin_private_only",
    raw_public: false,
    public_mirror_allowed: false,
    product_surface_allowed: false,
    endpoint_template: "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{date}.txt",
    cache_dir: REGSHO_DAILY_CACHE_DIR,
    availability_policy: FINRA_AVAILABILITY_POLICY,
    retry_policy: {
      retries: DEFAULT_RETRIES,
      retry_backoff_ms: DEFAULT_RETRY_BACKOFF_MS,
      sleep_ms_between_dates: DEFAULT_SLEEP_MS,
    },
  },
};

function parseArgs(argv) {
  const args = {
    dataset: DEFAULT_DATASET,
    date: "",
    from: "",
    to: "",
    inputFile: "",
    noFetch: false,
    noWrite: false,
    planOnly: false,
    retries: DEFAULT_RETRIES,
    retryBackoffMs: DEFAULT_RETRY_BACKOFF_MS,
    sleepMs: DEFAULT_SLEEP_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--dataset") args.dataset = next();
    else if (arg === "--date") args.date = next();
    else if (arg === "--from") args.from = next();
    else if (arg === "--to") args.to = next();
    else if (arg === "--input-file") args.inputFile = next();
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--retries") args.retries = Number(next()) || 0;
    else if (arg === "--retry-backoff-ms") args.retryBackoffMs = Number(next()) || 0;
    else if (arg === "--sleep-ms") args.sleepMs = Number(next()) || 0;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function datasetConfig(dataset) {
  const key = String(dataset ?? "").trim() || DEFAULT_DATASET;
  const config = DATASETS[key];
  if (!config) {
    throw new Error(`Unsupported FINRA dataset: ${dataset}. Enabled datasets: ${Object.keys(DATASETS).join(", ")}`);
  }
  return config;
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  const compact = raw.replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error(`Expected --date YYYYMMDD or YYYY-MM-DD, got: ${value}`);
  }
  return compact;
}

function isoFromYmd(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function ymdFromDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function latestWeekdayYmd(referenceDate = new Date()) {
  const d = new Date(Date.UTC(
    referenceDate.getUTCFullYear(),
    referenceDate.getUTCMonth(),
    referenceDate.getUTCDate(),
  ));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return ymdFromDate(d);
}

function expandDateRange({ date, from, to }) {
  if (date && (from || to)) {
    throw new Error("Use either --date or --from/--to, not both.");
  }
  if (date) return [normalizeDate(date)];
  if (from || to) {
    if (!from || !to) throw new Error("--from and --to must be provided together.");
    const start = normalizeDate(from);
    const end = normalizeDate(to);
    if (start > end) throw new Error(`Expected --from <= --to, got ${from} > ${to}`);
    const out = [];
    const cursor = new Date(Date.UTC(
      Number(start.slice(0, 4)),
      Number(start.slice(4, 6)) - 1,
      Number(start.slice(6, 8)),
    ));
    const endDate = new Date(Date.UTC(
      Number(end.slice(0, 4)),
      Number(end.slice(4, 6)) - 1,
      Number(end.slice(6, 8)),
    ));
    while (cursor <= endDate) {
      const day = cursor.getUTCDay();
      if (day !== 0 && day !== 6) out.push(ymdFromDate(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }
  return [latestWeekdayYmd()];
}

function endpointForDate(yyyymmdd) {
  return DATASETS[DEFAULT_DATASET].endpoint_template.replace("{date}", yyyymmdd);
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseDelimitedLine(line) {
  const [date, symbol, shortVolume, shortExemptVolume, totalVolume, market] = line.split("|");
  return {
    date: String(date ?? "").trim(),
    symbol: String(symbol ?? "").trim().toUpperCase(),
    shortVolume: numberValue(shortVolume),
    shortExemptVolume: numberValue(shortExemptVolume),
    totalVolume: numberValue(totalVolume),
    market: String(market ?? "").trim(),
  };
}

function parseFinraDailyShortVolume(text, expectedDate = "") {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split("|").map((part) => part.trim());
  const expectedHeader = ["Date", "Symbol", "ShortVolume", "ShortExemptVolume", "TotalVolume", "Market"];
  if (expectedHeader.some((part, index) => header[index] !== part)) {
    throw new Error(`Unexpected FINRA header: ${header.join("|")}`);
  }

  const rows = [];
  for (const line of lines.slice(1)) {
    const parsed = parseDelimitedLine(line);
    if (!parsed.symbol || parsed.shortVolume === null || parsed.totalVolume === null) continue;
    if (expectedDate && parsed.date !== expectedDate) continue;
    const shortVolumeRatio = parsed.totalVolume > 0 ? parsed.shortVolume / parsed.totalVolume : null;
    const shortExemptRatio = parsed.totalVolume > 0 ? (parsed.shortExemptVolume ?? 0) / parsed.totalVolume : null;
    rows.push({
      date: parsed.date,
      symbol: parsed.symbol,
      short_volume: parsed.shortVolume,
      short_exempt_volume: parsed.shortExemptVolume ?? 0,
      total_volume: parsed.totalVolume,
      short_volume_ratio: shortVolumeRatio,
      short_exempt_ratio: shortExemptRatio,
      market: parsed.market,
    });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function buildPayload({ yyyymmdd, sourceUrl, fetchedAt, rows }) {
  const dataset = DATASETS[DEFAULT_DATASET];
  return {
    schema_version: 1,
    provider: dataset.provider,
    dataset_id: dataset.dataset_id,
    dataset: dataset.display_name,
    date: yyyymmdd,
    as_of: isoFromYmd(yyyymmdd),
    generated_at: fetchedAt,
    source_url: sourceUrl,
    cache_scope: dataset.cache_scope,
    raw_public: dataset.raw_public,
    public_mirror_allowed: dataset.public_mirror_allowed,
    product_surface_allowed: dataset.product_surface_allowed,
    caveats: [
      "FINRA daily short-volume is an off-exchange/short-volume proxy, not true dark-pool intent.",
      "ShortVolume/TotalVolume is not buyer/seller direction.",
      "Rows must remain admin-private until owner/legal redistribution review clears a derived public surface.",
    ],
    fields: [
      "date",
      "symbol",
      "short_volume",
      "short_exempt_volume",
      "total_volume",
      "short_volume_ratio",
      "short_exempt_ratio",
      "market",
    ],
    row_count: rows.length,
    rows,
  };
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(`FINRA fetch failed: ${response.status} ${response.statusText}`);
    error.httpStatus = response.status;
    throw error;
  }
  return response.text();
}

function isMissingFileError(err) {
  // FINRA's CDN answers 403 (not 404) for files that do not exist, e.g. market
  // holidays inside the requested window or today's file before publication.
  return err && (err.httpStatus === 403 || err.httpStatus === 404);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTextWithRetry(url, { retries = DEFAULT_RETRIES, retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchText(url);
    } catch (err) {
      lastError = err;
      if (isMissingFileError(err)) break;
      if (attempt >= retries) break;
      if (retryBackoffMs > 0) await sleep(retryBackoffMs);
    }
  }
  throw lastError;
}

function cachePathForDate(yyyymmdd) {
  return path.join(REGSHO_DAILY_CACHE_DIR, `CNMSshvol${yyyymmdd}.json`);
}

function rawTextPathForDate(yyyymmdd) {
  return path.join(REGSHO_DAILY_CACHE_DIR, `CNMSshvol${yyyymmdd}.txt`);
}

function writeJson(abs, payload) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return abs;
}

function readJson(abs, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return fallback;
  }
}

function writeText(abs, text) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
  return abs;
}

function buildManifest({ previous, entries, generatedAt }) {
  const priorCollections = Array.isArray(previous?.collections) ? previous.collections : [];
  const incomingKeys = new Set(entries.map((entry) => `${entry.dataset_id}|${entry.date}`));
  const kept = priorCollections.filter((entry) => !incomingKeys.has(`${entry.dataset_id}|${entry.date}`));
  return {
    schema_version: 1,
    generated_at: generatedAt,
    cache_scope: "admin_private_only",
    raw_public: false,
    public_mirror_allowed: false,
    default_dataset: DEFAULT_DATASET,
    enabled_datasets: Object.values(DATASETS).map((dataset) => ({
      dataset_id: dataset.dataset_id,
      provider: dataset.provider,
      display_name: dataset.display_name,
      cadence: dataset.cadence,
      endpoint_template: dataset.endpoint_template,
      cache_scope: dataset.cache_scope,
      raw_public: dataset.raw_public,
      public_mirror_allowed: dataset.public_mirror_allowed,
      product_surface_allowed: dataset.product_surface_allowed,
      availability_policy: dataset.availability_policy,
      retry_policy: dataset.retry_policy,
    })),
    collections: [...kept, ...entries].sort((a, b) => (
      String(a.dataset_id).localeCompare(String(b.dataset_id)) || String(a.date).localeCompare(String(b.date))
    )),
  };
}

function manifestEntry({ payload, outputAbs, rawTextAbs, sourceUrl, sourceKind }) {
  return {
    dataset_id: payload.dataset_id,
    provider: payload.provider,
    date: payload.date,
    as_of: payload.as_of,
    generated_at: payload.generated_at,
    source_url: sourceUrl,
    source_kind: sourceKind,
    output_file: path.relative(repoRoot, outputAbs),
    raw_text_file: rawTextAbs ? path.relative(repoRoot, rawTextAbs) : null,
    row_count: payload.row_count,
    cache_scope: payload.cache_scope,
    raw_public: payload.raw_public,
    public_mirror_allowed: payload.public_mirror_allowed,
    product_surface_allowed: payload.product_surface_allowed,
  };
}

async function loadTextForDate({ yyyymmdd, inputFile, noFetch, retries, retryBackoffMs }) {
  const rawTextAbs = rawTextPathForDate(yyyymmdd);
  if (inputFile) {
    const abs = path.resolve(inputFile);
    return {
      text: fs.readFileSync(abs, "utf8"),
      sourceUrl: `file://${abs}`,
      sourceKind: "input_file",
      rawTextAbs: abs,
      shouldCacheRawText: false,
    };
  }
  if (fs.existsSync(rawTextAbs)) {
    return {
      text: fs.readFileSync(rawTextAbs, "utf8"),
      sourceUrl: `file://${rawTextAbs}`,
      sourceKind: "private_raw_cache",
      rawTextAbs,
      shouldCacheRawText: false,
    };
  }
  if (noFetch) {
    throw new Error(`FINRA raw cache missing for ${yyyymmdd}: ${path.relative(repoRoot, rawTextAbs)}`);
  }
  const sourceUrl = endpointForDate(yyyymmdd);
  return {
    text: await fetchTextWithRetry(sourceUrl, { retries, retryBackoffMs }),
    sourceUrl,
    sourceKind: "remote_fetch",
    rawTextAbs,
    shouldCacheRawText: true,
  };
}

async function collectRegshoDailyDate({ yyyymmdd, inputFile, noFetch, noWrite, generatedAt, retries, retryBackoffMs }) {
  const source = await loadTextForDate({ yyyymmdd, inputFile, noFetch, retries, retryBackoffMs });
  const rows = parseFinraDailyShortVolume(source.text, yyyymmdd);
  const payload = buildPayload({
    yyyymmdd,
    sourceUrl: source.sourceUrl,
    fetchedAt: generatedAt,
    rows,
  });
  const outputTarget = cachePathForDate(yyyymmdd);
  const outputAbs = noWrite ? outputTarget : writeJson(outputTarget, payload);
  const rawTextAbs = source.shouldCacheRawText && !noWrite
    ? writeText(source.rawTextAbs, source.text)
    : source.rawTextAbs;
  return {
    output_file: noWrite ? null : path.relative(repoRoot, outputAbs),
    planned_output_file: path.relative(repoRoot, outputTarget),
    raw_text_file: rawTextAbs ? path.relative(repoRoot, rawTextAbs) : null,
    wrote: !noWrite,
    row_count: payload.row_count,
    date: yyyymmdd,
    source_url: payload.source_url,
    source_kind: source.sourceKind,
    payload,
    outputAbs,
    rawTextAbs: rawTextAbs && rawTextAbs.startsWith(repoRoot) ? rawTextAbs : null,
  };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dataset = datasetConfig(args.dataset);
  const dates = expandDateRange(args);
  if (args.inputFile && dates.length !== 1) {
    throw new Error("--input-file can only be used with a single --date.");
  }
  if (args.planOnly) {
    return {
      plan_only: true,
      dataset: dataset.dataset_id,
      dates,
      no_fetch: args.noFetch,
      no_write: args.noWrite,
      outputs: dates.map((yyyymmdd) => ({
        date: yyyymmdd,
        output_file: path.relative(repoRoot, cachePathForDate(yyyymmdd)),
        raw_text_file: path.relative(repoRoot, rawTextPathForDate(yyyymmdd)),
        source_url: endpointForDate(yyyymmdd),
      })),
      manifest_file: path.relative(repoRoot, MANIFEST_FILE),
      availability_policy: dataset.availability_policy,
      retry_policy: {
        retries: args.retries,
        retry_backoff_ms: args.retryBackoffMs,
        sleep_ms_between_dates: args.sleepMs,
      },
      raw_public: dataset.raw_public,
      public_mirror_allowed: dataset.public_mirror_allowed,
      product_surface_allowed: dataset.product_surface_allowed,
    };
  }

  const generatedAt = new Date().toISOString();
  const results = [];
  const skippedDates = [];
  for (const yyyymmdd of dates) {
    try {
      results.push(await collectRegshoDailyDate({
        yyyymmdd,
        inputFile: args.inputFile,
        noFetch: args.noFetch,
        noWrite: args.noWrite,
        generatedAt,
        retries: args.retries,
        retryBackoffMs: args.retryBackoffMs,
      }));
    } catch (err) {
      if (!isMissingFileError(err)) throw err;
      // Holiday or not-yet-published file inside the window: record and move on
      // instead of failing the whole run (and with it the downstream data push).
      skippedDates.push({ date: yyyymmdd, reason: `not_published (HTTP ${err.httpStatus})` });
      console.warn(`[finra-daily] skip ${yyyymmdd}: file not published (HTTP ${err.httpStatus})`);
      continue;
    }
    if (args.sleepMs > 0) await sleep(args.sleepMs);
  }
  if (results.length === 0 && dates.length > 0) {
    throw new Error(
      `FINRA fetch produced no data for any requested date (${dates[0]}..${dates[dates.length - 1]}); ` +
      "all files missing — refusing to treat a fully-missing window as success.",
    );
  }

  let manifestFile = null;
  if (!args.noWrite) {
    const entries = results.map((result) => manifestEntry({
      payload: result.payload,
      outputAbs: result.outputAbs,
      rawTextAbs: result.rawTextAbs,
      sourceUrl: result.source_url,
      sourceKind: result.source_kind,
    }));
    const manifest = buildManifest({
      previous: readJson(MANIFEST_FILE, null),
      entries,
      generatedAt,
    });
    manifestFile = path.relative(repoRoot, writeJson(MANIFEST_FILE, manifest));
  }

  const totalRows = results.reduce((sum, result) => sum + result.row_count, 0);
  const first = results[0];
  return {
    dataset: dataset.dataset_id,
    dates,
    wrote: !args.noWrite,
    no_fetch: args.noFetch,
    availability_policy: dataset.availability_policy,
    retry_policy: {
      retries: args.retries,
      retry_backoff_ms: args.retryBackoffMs,
      sleep_ms_between_dates: args.sleepMs,
    },
    row_count: totalRows,
    output_file: results.length === 1 ? first.output_file : null,
    date: results.length === 1 ? first.date : null,
    source_url: results.length === 1 ? first.source_url : null,
    manifest_file: manifestFile,
    skipped_dates: skippedDates,
    outputs: results.map(({ payload, outputAbs, rawTextAbs, ...result }) => result),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((err) => {
      console.error(err.stack || err.message);
      process.exit(1);
    });
}

export {
  buildPayload,
  buildManifest,
  cachePathForDate,
  datasetConfig,
  endpointForDate,
  expandDateRange,
  FINRA_AVAILABILITY_POLICY,
  normalizeDate,
  parseFinraDailyShortVolume,
  rawTextPathForDate,
  run,
};
