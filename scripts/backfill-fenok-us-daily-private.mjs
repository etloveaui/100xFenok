#!/usr/bin/env node
/**
 * Private-only US daily backfill smoke runner for Fenok Flow source research.
 *
 * Raw files and the manifest are written only under:
 * _private/admin/fenok-flow/backfill/<run-id>/
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const DEFAULT_END_DATE = "20260626";
const DEFAULT_DAYS = 5;
const DEFAULT_REQUESTED_DAYS = 252;
const DEFAULT_RUN_ID = "20260629";
const DEFAULT_SLEEP_MS = 150;
const DEFAULT_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];

const FINRA_REGSHO_ENDPOINT = "https://cdn.finra.org/equity/regsho/daily";
const OCC_ENDPOINT = "https://marketdata.theocc.com/volume-query";

const FINRA_WEEKLY_REFERENCE_FILES = [
  "_private/admin/fenok-flow/finra/weekly_summary/date_filtered/WEEKLYSUMMARY_weekStartDate_2025-06-30_limit10_20260629T084041Z.json",
  "_private/admin/fenok-flow/finra/weekly_summary/WEEKLYSUMMARY_tail_seed_20250630_offset54002955_limit5.json",
];

const SEC_REFERENCE_MANIFEST = "_private/admin/fenok-flow/manifests/us_finish_slice_20260629T084041Z.json";

function parseArgs(argv) {
  const args = {
    days: DEFAULT_DAYS,
    endDate: DEFAULT_END_DATE,
    maxOccRequests: 0,
    noFetch: false,
    planOnly: false,
    requestedDays: DEFAULT_REQUESTED_DAYS,
    runId: DEFAULT_RUN_ID,
    sleepMs: DEFAULT_SLEEP_MS,
    tickers: DEFAULT_TICKERS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--days") args.days = Number(next()) || args.days;
    else if (arg === "--end-date") args.endDate = normalizeYmd(next());
    else if (arg === "--max-occ-requests") args.maxOccRequests = Number(next()) || 0;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--requested-days") args.requestedDays = Number(next()) || args.requestedDays;
    else if (arg === "--run-id") args.runId = next() || args.runId;
    else if (arg === "--sleep-ms") args.sleepMs = Number(next()) || 0;
    else if (arg === "--tickers") args.tickers = parseTickers(next());
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (args.days <= 0) throw new Error("--days must be positive.");
  if (args.requestedDays < args.days) args.requestedDays = args.days;
  if (args.tickers.length === 0) throw new Error("--tickers resolved to an empty universe.");
  return args;
}

function parseTickers(value) {
  return [...new Set(String(value)
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter((ticker) => /^[A-Z][A-Z0-9]{0,11}$/.test(ticker)))]
    .sort();
}

function normalizeYmd(value) {
  const out = String(value ?? "").replaceAll("-", "");
  if (!/^\d{8}$/.test(out)) throw new Error(`Expected YYYYMMDD date, got: ${value}`);
  return out;
}

function isoNow() {
  return new Date().toISOString();
}

function isoFromYmd(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function dateFromYmd(ymd) {
  return new Date(Date.UTC(
    Number(ymd.slice(0, 4)),
    Number(ymd.slice(4, 6)) - 1,
    Number(ymd.slice(6, 8)),
  ));
}

function ymdFromDate(date) {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function addUtcDays(date, delta) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + delta));
}

function observedFixedHoliday(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  const dow = date.getUTCDay();
  if (dow === 0) return ymdFromDate(addUtcDays(date, 1));
  if (dow === 6) return ymdFromDate(addUtcDays(date, -1));
  return ymdFromDate(date);
}

function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
  let count = 0;
  for (let day = 1; day <= 31; day++) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    if (date.getUTCMonth() !== monthIndex) break;
    if (date.getUTCDay() === weekday) count += 1;
    if (count === nth) return ymdFromDate(date);
  }
  throw new Error(`Could not calculate holiday for ${year}-${monthIndex + 1}`);
}

function lastWeekdayOfMonth(year, monthIndex, weekday) {
  for (let day = 31; day >= 1; day--) {
    const date = new Date(Date.UTC(year, monthIndex, day));
    if (date.getUTCMonth() !== monthIndex) continue;
    if (date.getUTCDay() === weekday) return ymdFromDate(date);
  }
  throw new Error(`Could not calculate holiday for ${year}-${monthIndex + 1}`);
}

function easterYmd(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymdFromDate(new Date(Date.UTC(year, month, day)));
}

function nyseHolidaySet(year) {
  const easter = dateFromYmd(easterYmd(year));
  return new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekdayOfMonth(year, 0, 1, 3),
    nthWeekdayOfMonth(year, 1, 1, 3),
    ymdFromDate(addUtcDays(easter, -2)),
    lastWeekdayOfMonth(year, 4, 1),
    observedFixedHoliday(year, 5, 19),
    observedFixedHoliday(year, 6, 4),
    nthWeekdayOfMonth(year, 8, 1, 1),
    nthWeekdayOfMonth(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]);
}

function isTradingDay(ymd) {
  const date = dateFromYmd(ymd);
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !nyseHolidaySet(date.getUTCFullYear()).has(ymd);
}

function previousTradingDays(endYmd, count) {
  const out = [];
  let cursor = dateFromYmd(endYmd);
  while (out.length < count) {
    const ymd = ymdFromDate(cursor);
    if (isTradingDay(ymd)) out.push(ymd);
    cursor = addUtcDays(cursor, -1);
  }
  return out.reverse();
}

function ensureParent(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function writeText(absPath, text) {
  ensureParent(absPath);
  fs.writeFileSync(absPath, text, "utf8");
  return absPath;
}

function writeJson(absPath, payload) {
  return writeText(absPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function rel(absPath) {
  return path.relative(repoRoot, absPath);
}

function readJsonIfExists(relPath) {
  const absPath = path.join(repoRoot, relPath);
  if (!fs.existsSync(absPath)) return null;
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchText(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${url}`));
          return;
        }
        resolve(data);
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms: ${url}`));
    });
    req.on("error", reject);
  });
}

async function fetchTextWithRetry(url, options = {}) {
  const retries = options.retries ?? 2;
  const retryBackoffMs = options.retryBackoffMs ?? 500;
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchText(url, options);
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(retryBackoffMs);
    }
  }
  throw lastError;
}

function finraUrl(ymd) {
  return `${FINRA_REGSHO_ENDPOINT}/CNMSshvol${ymd}.txt`;
}

function occUrl({ ymd, ticker, side }) {
  const params = new URLSearchParams({
    reportDate: ymd,
    format: "csv",
    volumeQueryType: "O",
    symbolType: "U",
    symbol: ticker,
    reportType: "D",
    productKind: "OSTK",
    porc: side,
  });
  return `${OCC_ENDPOINT}?${params.toString()}`;
}

function countFinraRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{8}\|/.test(line)).length;
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseOccCsvStats(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { row_count: 0, quantity: 0, header_ok: false };
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const quantityIdx = headers.indexOf("quantity");
  const required = ["quantity", "underlying", "symbol", "actype", "porc", "exchange", "actdate"];
  const headerOk = required.every((header) => headers.includes(header));
  if (!headerOk || quantityIdx < 0) {
    return { row_count: 0, quantity: 0, header_ok: false, header: lines[0] };
  }
  const quantities = lines.slice(1).map((line) => Number(splitCsvLine(line)[quantityIdx]) || 0);
  return {
    row_count: lines.length - 1,
    quantity: quantities.reduce((sum, value) => sum + value, 0),
    header_ok: true,
  };
}

async function loadOrFetchRaw({ absPath, url, noFetch }) {
  if (fs.existsSync(absPath)) {
    return {
      text: fs.readFileSync(absPath, "utf8"),
      source_kind: "backfill_cache",
      http_status: 200,
      http_status_source: "cache_success",
    };
  }
  if (noFetch) {
    throw new Error(`cache missing and --no-fetch set: ${rel(absPath)}`);
  }
  const text = await fetchTextWithRetry(url);
  writeText(absPath, text);
  return { text, source_kind: "remote_fetch", http_status: 200, http_status_source: "remote_fetch" };
}

async function collectFinraDaily({ date, baseDir, noFetch }) {
  const rawAbs = path.join(baseDir, "finra", "regsho_daily", `CNMSshvol${date}.txt`);
  const summaryAbs = path.join(baseDir, "finra", "regsho_daily", `CNMSshvol${date}.summary.json`);
  const url = finraUrl(date);
  try {
    const load = await loadOrFetchRaw({ absPath: rawAbs, url, noFetch });
    const rowCount = countFinraRows(load.text);
    const status = rowCount > 0 ? "success" : "empty";
    const payload = {
      source_id: "finra_regsho_daily_cnms",
      provider: "FINRA",
      endpoint_class: "daily-history",
      date,
      market_date: date,
      source_date: date,
      as_of: isoFromYmd(date),
      fetched_at: new Date().toISOString(),
      status,
      row_count: rowCount,
      http_status: load.http_status,
      http_status_source: load.http_status_source,
      source_url: url,
      source_kind: load.source_kind,
      raw_text_file: rel(rawAbs),
      raw_public: false,
      license_or_terms_note: "Private admin cache only; no public raw mirror.",
      caveat: "Daily short-volume transparency data; not short interest, not borrow availability, and not a complete directional flow signal.",
    };
    writeJson(summaryAbs, payload);
    return { ...payload, summary_file: rel(summaryAbs) };
  } catch (err) {
    return {
      source_id: "finra_regsho_daily_cnms",
      provider: "FINRA",
      endpoint_class: "daily-history",
      date,
      market_date: date,
      source_date: date,
      as_of: isoFromYmd(date),
      fetched_at: new Date().toISOString(),
      status: "failed",
      row_count: 0,
      http_status: null,
      http_status_source: "request_failed",
      source_url: url,
      raw_text_file: rel(rawAbs),
      raw_public: false,
      failed_reason: err.message,
      license_or_terms_note: "Private admin cache only; no public raw mirror.",
      error: err.message,
    };
  }
}

async function collectOccDate({ date, tickers, baseDir, noFetch, sleepMs }) {
  const rows = [];
  const attempts = [];
  for (const ticker of tickers) {
    const bySide = {};
    for (const side of ["C", "P"]) {
      const rawAbs = path.join(baseDir, "occ_options_volume", date, `${ticker}_${side}.csv`);
      const url = occUrl({ ymd: date, ticker, side });
      try {
        const load = await loadOrFetchRaw({ absPath: rawAbs, url, noFetch });
        const stats = parseOccCsvStats(load.text);
        const status = stats.header_ok ? (stats.row_count > 0 ? "success" : "empty") : "failed";
        const entry = {
          ticker,
          side,
          endpoint_class: "daily-history",
          market_date: date,
          source_date: date,
          status,
          row_count: stats.row_count,
          quantity: stats.quantity,
          http_status: load.http_status,
          http_status_source: load.http_status_source,
          source_url: url,
          source_kind: load.source_kind,
          raw_csv_file: rel(rawAbs),
          raw_public: false,
          license_or_terms_note: "Private admin cache only; no public raw mirror.",
          failed_reason: stats.header_ok ? null : `Unexpected OCC CSV header: ${stats.header ?? "missing"}`,
          error: stats.header_ok ? null : `Unexpected OCC CSV header: ${stats.header ?? "missing"}`,
        };
        bySide[side] = entry;
        attempts.push(entry);
      } catch (err) {
        const entry = {
          ticker,
          side,
          endpoint_class: "daily-history",
          market_date: date,
          source_date: date,
          status: "failed",
          row_count: 0,
          quantity: 0,
          http_status: null,
          http_status_source: "request_failed",
          source_url: url,
          raw_csv_file: rel(rawAbs),
          raw_public: false,
          failed_reason: err.message,
          license_or_terms_note: "Private admin cache only; no public raw mirror.",
          error: err.message,
        };
        bySide[side] = entry;
        attempts.push(entry);
      }
      if (sleepMs > 0) await sleep(sleepMs);
    }
    const call = bySide.C ?? { row_count: 0, quantity: 0, status: "failed" };
    const put = bySide.P ?? { row_count: 0, quantity: 0, status: "failed" };
    const totalVolume = call.quantity + put.quantity;
    const score = totalVolume > 0
      ? Math.max(0, Math.min(100, 50 + (18 * Math.log((call.quantity + 1) / (put.quantity + 1)))))
      : null;
    rows.push({
      ticker,
      source_date: date,
      status: [call.status, put.status].includes("failed")
        ? "failed"
        : totalVolume > 0 ? "success" : "empty",
      call_rows: call.row_count,
      put_rows: put.row_count,
      call_volume: call.quantity,
      put_volume: put.quantity,
      total_volume: totalVolume,
      options_volume_skew_score_0_100: Number.isFinite(score) ? Math.round(score * 100) / 100 : null,
      raw_csv_files: [call.raw_csv_file, put.raw_csv_file].filter(Boolean),
    });
  }
  const summaryAbs = path.join(baseDir, "occ_options_volume", date, "daily_summary.json");
  const summary = {
    source_id: "occ_listed_options_volume",
    provider: "OCC",
    date,
    as_of: isoFromYmd(date),
    status: attempts.some((attempt) => attempt.status === "failed")
      ? "partial"
      : attempts.every((attempt) => attempt.status === "empty") ? "empty" : "success",
    ticker_count: tickers.length,
    endpoint_class: "daily-history",
    market_date: date,
    source_date: date,
    fetched_at: new Date().toISOString(),
    side_request_count: attempts.length,
    side_success_count: attempts.filter((attempt) => attempt.status === "success").length,
    side_empty_count: attempts.filter((attempt) => attempt.status === "empty").length,
    side_failed_count: attempts.filter((attempt) => attempt.status === "failed").length,
    row_count: attempts.reduce((sum, attempt) => sum + attempt.row_count, 0),
    call_volume: rows.reduce((sum, row) => sum + row.call_volume, 0),
    put_volume: rows.reduce((sum, row) => sum + row.put_volume, 0),
    rows,
    attempts,
    raw_public: false,
    license_or_terms_note: "Private admin cache only; no public raw mirror.",
    caveat: "OCC listed-options volume skew proxy only; not OPRA, premium, greeks, sweeps, blocks, or buyer/seller direction.",
  };
  writeJson(summaryAbs, summary);
  return { ...summary, summary_file: rel(summaryAbs) };
}

function loadWeeklyReference() {
  const files = FINRA_WEEKLY_REFERENCE_FILES.map((relPath) => {
    const payload = readJsonIfExists(relPath);
    return {
      file: relPath,
      present: payload != null,
      row_count: Array.isArray(payload?.rows) ? payload.rows.length : payload?.row_count ?? null,
      status: payload?.status ?? null,
    };
  });
  const rowCount = files.reduce((sum, file) => sum + (Number(file.row_count) || 0), 0);
  return {
    source_id: "finra_weekly_summary_reference",
    provider: "FINRA",
    cadence: "weekly_reference",
    endpoint_class: "periodic",
    status: files.every((file) => file.present) ? "success" : "failed",
    row_count: rowCount,
    files,
    raw_public: false,
    license_or_terms_note: "Existing private admin reference files only; no public raw mirror.",
    caveat: "Weekly FINRA summary is a slower reference/context source, not a daily scoring axis by itself.",
  };
}

function loadSecReference() {
  const manifest = readJsonIfExists(SEC_REFERENCE_MANIFEST);
  const companyfacts = Array.isArray(manifest?.collections)
    ? manifest.collections.find((entry) => entry.ticker === "NVDA" && Number(entry.concept_count) > 0)
    : null;
  return {
    source_id: "sec_companyfacts_periodic_reference",
    provider: "SEC",
    cadence: "periodic_reference",
    endpoint_class: "periodic",
    status: companyfacts ? "success" : "failed",
    manifest_file: SEC_REFERENCE_MANIFEST,
    ticker: companyfacts?.ticker ?? null,
    concept_count: companyfacts?.concept_count ?? null,
    fact_value_count: companyfacts?.fact_value_count ?? null,
    output_file: companyfacts?.output_file ?? null,
    raw_public: false,
    license_or_terms_note: "Existing private admin reference file only; no daily raw backfill.",
    caveat: "SEC companyfacts is periodic fundamentals reference data; it should refresh on filings, not daily market cadence.",
  };
}

function compactFailures(items) {
  return items
    .filter((item) => item.status === "failed" || item.side_failed_count > 0)
    .slice(0, 50)
    .map((item) => ({
      source_id: item.source_id,
      date: item.date,
      ticker: item.ticker,
      side: item.side,
      status: item.status,
      error: item.error ?? null,
      side_failed_count: item.side_failed_count ?? null,
    }));
}

function sourceRollup(sourceId, items, extra = {}) {
  const failed = items.filter((item) => item.status === "failed" || item.status === "partial").length;
  const empty = items.filter((item) => item.status === "empty").length;
  const success = items.length - failed - empty;
  return {
    source_id: sourceId,
    status: failed > 0 ? "partial" : empty === items.length ? "empty" : "success",
    date_count: items.length,
    success_count: success,
    failed_count: failed,
    empty_count: empty,
    row_count: items.reduce((sum, item) => sum + (Number(item.row_count) || 0), 0),
    failures: compactFailures(items),
    ...extra,
  };
}

function buildManifest({ args, dates, requestedDates, generatedAt, finraResults, occResults, weeklyReference, secReference, baseDir }) {
  const allDaily = [...finraResults, ...occResults];
  const estimatedOccRequestsForRequestedWindow = args.requestedDays * args.tickers.length * 2;
  const manifest = {
    schema_version: "fenok-us-daily-backfill-private/v0.1",
    generated_at: generatedAt,
    run_id: args.runId,
    cache_scope: "admin_private_only",
    raw_public: false,
    public_mirror_allowed: false,
    commit_or_push_performed: false,
    raw_policy: {
      base_dir: rel(baseDir),
      raw_public: false,
      public_mirror_allowed: false,
      private_raw_only: true,
      no_credentials_required_for_recorded_urls: true,
    },
    end_date: args.endDate,
    requested_date_count: args.requestedDays,
    date_count: dates.length,
    dates,
    target_universe: {
      mode: "explicit_reference_tickers",
      ticker_count: args.tickers.length,
      tickers: args.tickers,
      caveat: "Plain OCC underlyings only; dotted/foreign suffixes require owner-reviewed mapping before full universe expansion.",
    },
    source_count: 4,
    daily_source_count: 2,
    reference_source_count: 2,
    status_counts: {
      success: allDaily.filter((item) => item.status === "success").length,
      partial_or_failed: allDaily.filter((item) => item.status === "partial" || item.status === "failed").length,
      empty: allDaily.filter((item) => item.status === "empty").length,
    },
    totals: {
      finra_regsho_daily_rows: finraResults.reduce((sum, item) => sum + item.row_count, 0),
      occ_csv_rows: occResults.reduce((sum, item) => sum + item.row_count, 0),
      occ_call_volume: occResults.reduce((sum, item) => sum + item.call_volume, 0),
      occ_put_volume: occResults.reduce((sum, item) => sum + item.put_volume, 0),
    },
    sources: [
      sourceRollup("finra_regsho_daily_cnms", finraResults, {
        provider: "FINRA",
        cadence: "daily",
        endpoint_class: "daily-history",
        endpoint_template: `${FINRA_REGSHO_ENDPOINT}/CNMSshvol{YYYYMMDD}.txt`,
        raw_dir: rel(path.join(baseDir, "finra", "regsho_daily")),
        raw_public: false,
        license_or_terms_note: "Private admin cache only; no public raw mirror.",
        caveat: "Daily short-volume transparency data; not short interest, not borrow availability, and not a complete directional flow signal.",
      }),
      sourceRollup("occ_listed_options_volume", occResults, {
        provider: "OCC",
        cadence: "daily",
        endpoint_class: "daily-history",
        endpoint: OCC_ENDPOINT,
        raw_dir: rel(path.join(baseDir, "occ_options_volume")),
        side_request_count: occResults.reduce((sum, item) => sum + item.side_request_count, 0),
        side_success_count: occResults.reduce((sum, item) => sum + item.side_success_count, 0),
        side_empty_count: occResults.reduce((sum, item) => sum + item.side_empty_count, 0),
        side_failed_count: occResults.reduce((sum, item) => sum + item.side_failed_count, 0),
        raw_public: false,
        license_or_terms_note: "Private admin cache only; no public raw mirror.",
        caveat: "OCC listed-options volume skew proxy only; not OPRA, premium, greeks, sweeps, blocks, or buyer/seller direction.",
      }),
      weeklyReference,
      secReference,
    ],
    normalized_score_candidates: [
      {
        axis: "short_volume_pressure",
        source: "FINRA Reg SHO Daily CNMS",
        input: "short_volume / total_volume by ticker/date",
        caveat: "FINRA reported short-sale volume share; not short interest, borrow fee, utilization, or buy/sell direction.",
      },
      {
        axis: "options_volume_skew",
        source: "OCC Listed Options Volume Query",
        input: "call_volume share vs put_volume share by ticker/date",
        caveat: "OCC listed-options volume skew proxy only; not OPRA, premium, greeks, sweeps, blocks, or buyer/seller direction.",
      },
      {
        axis: "weekly_context",
        source: "FINRA Weekly Summary",
        input: "weekly reference rows where relevant",
        caveat: "Delayed ATS/OTC overlay; never same-day dark-pool flow and not a daily scoring axis by itself.",
      },
      {
        axis: "fundamental_reference",
        source: "SEC companyfacts",
        input: "periodic XBRL company facts",
        caveat: "SEC companyfacts is periodic fundamentals reference data; refresh on filing cadence, not daily market cadence.",
      },
    ],
    full_cost_estimate: {
      request_budget: {
        max_occ_requests: args.maxOccRequests || null,
        sleep_ms_between_occ_side_queries: args.sleepMs,
        retries_per_raw_fetch: 2,
      },
      requested_trading_dates_preview: {
        first: requestedDates[0],
        last: requestedDates[requestedDates.length - 1],
        date_count: requestedDates.length,
        calendar: "weekday plus common NYSE full-holiday exclusion",
      },
      estimated_finra_daily_requests: args.requestedDays,
      estimated_occ_side_requests: estimatedOccRequestsForRequestedWindow,
      estimate_formula: "requested_date_count * ticker_count * 2 option sides",
      current_smoke_occ_side_requests: dates.length * args.tickers.length * 2,
      recommendation: "Run full 252-day OCC in batches with explicit request budget/rate limits; FINRA daily can run as one bounded batch.",
    },
    outputs: {
      base_dir: rel(baseDir),
      manifest_file: rel(path.join(baseDir, "manifests", `us_daily_backfill_smoke_${dates.length}d_${args.endDate}.json`)),
      finra_daily_summaries: finraResults.map((item) => item.summary_file).filter(Boolean),
      occ_daily_summaries: occResults.map((item) => item.summary_file).filter(Boolean),
    },
  };
  return manifest;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dates = previousTradingDays(args.endDate, args.days);
  const requestedDates = previousTradingDays(args.endDate, args.requestedDays);
  const estimatedOccRequests = dates.length * args.tickers.length * 2;
  const baseDir = path.join(repoRoot, "_private", "admin", "fenok-flow", "backfill", args.runId);
  const manifestFile = path.join(baseDir, "manifests", `us_daily_backfill_smoke_${dates.length}d_${args.endDate}.json`);

  const plan = {
    plan_only: args.planOnly,
    end_date: args.endDate,
    days: args.days,
    dates,
    requested_days: args.requestedDays,
    requested_dates_first_last: [requestedDates[0], requestedDates[requestedDates.length - 1]],
    tickers: args.tickers,
    estimated_occ_side_requests: estimatedOccRequests,
    max_occ_requests: args.maxOccRequests || null,
    base_dir: rel(baseDir),
    manifest_file: rel(manifestFile),
  };
  if (args.planOnly) return plan;
  if (args.maxOccRequests > 0 && estimatedOccRequests > args.maxOccRequests) {
    throw new Error(`OCC request budget exceeded: estimated ${estimatedOccRequests}, max ${args.maxOccRequests}`);
  }

  const generatedAt = isoNow();
  const finraResults = [];
  for (const date of dates) {
    finraResults.push(await collectFinraDaily({ date, baseDir, noFetch: args.noFetch }));
  }

  const occResults = [];
  for (const date of dates) {
    occResults.push(await collectOccDate({
      date,
      tickers: args.tickers,
      baseDir,
      noFetch: args.noFetch,
      sleepMs: args.sleepMs,
    }));
  }

  const weeklyReference = loadWeeklyReference();
  const secReference = loadSecReference();
  const manifest = buildManifest({
    args,
    dates,
    requestedDates,
    generatedAt,
    finraResults,
    occResults,
    weeklyReference,
    secReference,
    baseDir,
  });
  writeJson(manifestFile, manifest);
  return {
    wrote: true,
    manifest_file: rel(manifestFile),
    date_count: manifest.date_count,
    source_count: manifest.source_count,
    status_counts: manifest.status_counts,
    totals: manifest.totals,
    full_cost_estimate: manifest.full_cost_estimate,
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
  buildManifest,
  countFinraRows,
  isTradingDay,
  parseOccCsvStats,
  previousTradingDays,
  run,
};
