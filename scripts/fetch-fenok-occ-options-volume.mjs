#!/usr/bin/env node
/**
 * Fetch bounded OCC option volume query CSVs and publish derived-only ticker
 * option-activity proxies. Raw OCC CSV files stay under _private/admin.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow");

const SCHEMA_VERSION = "fenok-occ-options-volume/v0.1";
const FORMULA_VERSION = "fenok-occ-options-volume-v0.1";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_flow_sources_20260628.md";
const OCC_CACHE_DIR = path.join(privateRoot, "occ_options_volume");
const OUTPUT_FILE = "computed/fenok_occ_options_volume.json";
const HISTORY_FILE = "computed/fenok_occ_options_volume_history.json";
const DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];
const OCC_ENDPOINT = "https://marketdata.theocc.com/volume-query";

function parseArgs(argv) {
  const args = {
    date: "",
    tickers: "",
    limit: 0,
    maxWalkbackDays: 7,
    noFetch: false,
    noWrite: false,
    planOnly: false,
    referenceOnly: false,
    sleepMs: 250,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--date") args.date = next();
    else if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--max-walkback-days") args.maxWalkbackDays = Number(next()) || args.maxWalkbackDays;
    else if (arg === "--sleep-ms") args.sleepMs = Number(next()) || 0;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--reference-only") args.referenceOnly = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function ymdFromDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isoFromYmd(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function candidateDates({ requestedDate, maxWalkbackDays }) {
  const out = [];
  const startYmd = requestedDate ? requestedDate.replaceAll("-", "") : ymdFromDate(new Date());
  const today = new Date(Date.UTC(
    Number(startYmd.slice(0, 4)),
    Number(startYmd.slice(4, 6)) - 1,
    Number(startYmd.slice(6, 8)),
  ));
  for (let i = 0; i <= maxWalkbackDays; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push(ymdFromDate(d));
  }
  return out;
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function loadTickerUniverse({ tickers, referenceOnly, limit }) {
  let out = [];
  if (tickers) {
    out = tickers.split(",").map(normalizeTicker).filter(Boolean);
  } else if (referenceOnly) {
    out = DEFAULT_REFERENCE_TICKERS.slice();
  } else {
    throw new Error("OCC collection is bounded: pass --tickers or --reference-only");
  }
  out = [...new Set(out)].filter((ticker) => /^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function ensureDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot, relPath), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, payload) {
  const abs = path.join(dataRoot, relPath);
  ensureDir(abs);
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function occQueryUrl({ ymd, ticker, side }) {
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
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

function splitCsvLine(line) {
  const out = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function parseOccCsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const required = ["quantity", "underlying", "symbol", "actype", "porc", "exchange", "actdate"];
  for (const key of required) {
    if (!headers.includes(key)) throw new Error(`Unexpected OCC CSV header, missing ${key}: ${lines[0]}`);
  }
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, idx) => [header, values[idx] ?? ""]));
    return {
      quantity: Number(row.quantity) || 0,
      underlying: row.underlying,
      symbol: row.symbol,
      actype: row.actype,
      porc: row.porc,
      exchange: row.exchange,
      actdate: row.actdate,
    };
  });
}

async function loadOccCsv({ ymd, ticker, side, noFetch }) {
  const cachePath = path.join(OCC_CACHE_DIR, ymd, `${ticker}_${side}.csv`);
  if (fs.existsSync(cachePath)) {
    return {
      text: fs.readFileSync(cachePath, "utf8"),
      source_url: occQueryUrl({ ymd, ticker, side }),
      cache_path: path.relative(repoRoot, cachePath),
      cache_hit: true,
    };
  }
  if (noFetch) {
    return {
      text: "",
      source_url: occQueryUrl({ ymd, ticker, side }),
      cache_path: path.relative(repoRoot, cachePath),
      cache_hit: false,
      missing_no_fetch: true,
    };
  }
  const url = occQueryUrl({ ymd, ticker, side });
  const text = await fetchText(url);
  ensureDir(cachePath);
  fs.writeFileSync(cachePath, text, "utf8");
  return {
    text,
    source_url: url,
    cache_path: path.relative(repoRoot, cachePath),
    cache_hit: false,
  };
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function scoreOptionsVolume(callVolume, putVolume) {
  if (callVolume + putVolume <= 0) return null;
  const logRatio = Math.log((callVolume + 1) / (putVolume + 1));
  return round(clamp(50 + (18 * logRatio)), 2);
}

function directionFromOptionsVolume(score) {
  if (!Number.isFinite(score)) return "unavailable";
  if (score >= 60) return "call_volume_skew_proxy";
  if (score <= 40) return "put_volume_skew_proxy";
  return "balanced_volume_proxy";
}

function buildTickerRow({ ticker, ymd, callLoad, putLoad }) {
  const callRows = parseOccCsv(callLoad.text);
  const putRows = parseOccCsv(putLoad.text);
  const callVolume = callRows.reduce((sum, row) => sum + row.quantity, 0);
  const putVolume = putRows.reduce((sum, row) => sum + row.quantity, 0);
  const totalVolume = callVolume + putVolume;
  const score = scoreOptionsVolume(callVolume, putVolume);
  const exchanges = [...new Set([...callRows, ...putRows].map((row) => row.exchange).filter(Boolean))].sort();
  const actdate = callRows[0]?.actdate ?? putRows[0]?.actdate ?? null;
  return {
    ticker,
    as_of: isoFromYmd(ymd),
    source_date: ymd,
    confidence: score == null ? "low" : "medium",
    coverage_ratio: totalVolume > 0 ? 0.65 : 0,
    source_families: ["OCC Volume Query"],
    raw_cache_paths: [callLoad.cache_path, putLoad.cache_path].filter(Boolean),
    options_activity_proxy: {
      score_0_100: score,
      direction: directionFromOptionsVolume(score),
      call_volume: round(callVolume, 0),
      put_volume: round(putVolume, 0),
      total_volume: round(totalVolume, 0),
      call_share: totalVolume > 0 ? round(callVolume / totalVolume, 6) : null,
      put_call_volume_ratio: callVolume > 0 ? round(putVolume / callVolume, 6) : null,
      row_count: callRows.length + putRows.length,
      exchange_count: exchanges.length,
      actdate,
      caveat: "OCC listed-options volume skew proxy only; not real options flow, OPRA, greeks, premium, sweeps, blocks, or buyer/seller direction.",
    },
  };
}

async function loadRowsForDate({ ymd, tickers, noFetch, sleepMs }) {
  const rows = [];
  const attempts = [];
  for (const ticker of tickers) {
    try {
      const callLoad = await loadOccCsv({ ymd, ticker, side: "C", noFetch });
      if (sleepMs > 0 && !callLoad.cache_hit) await sleep(sleepMs);
      const putLoad = await loadOccCsv({ ymd, ticker, side: "P", noFetch });
      if (sleepMs > 0 && !putLoad.cache_hit) await sleep(sleepMs);
      if (callLoad.missing_no_fetch || putLoad.missing_no_fetch) {
        attempts.push({ ticker, status: "cache_missing_no_fetch" });
        continue;
      }
      rows.push(buildTickerRow({ ticker, ymd, callLoad, putLoad }));
    } catch (err) {
      attempts.push({ ticker, status: "failed", error: err.message });
    }
  }
  return { ymd, rows, attempts };
}

function buildSnapshot({ rows, ymd, generatedAt, attempts }) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    public_surface_status: "admin_private_derived_only_public_summary_source",
    raw_policy: {
      external_collection: true,
      raw_cache_public: false,
      third_party_raw_public: false,
      full_public_mirror: false,
      raw_cache_dir: path.relative(repoRoot, path.join(OCC_CACHE_DIR, ymd)),
      public_payload: null,
    },
    query_contract: {
      endpoint: OCC_ENDPOINT,
      reportDate: ymd,
      format: "csv",
      volumeQueryType: "O",
      symbolType: "U",
      reportType: "D",
      productKind: "OSTK",
      accountType: "omitted_all_accounts",
      porc: "C_or_P",
    },
    coverage: {
      row_count: rows.length,
      with_options_activity_score: rows.filter((row) => row.options_activity_proxy.score_0_100 != null).length,
      total_call_volume: round(rows.reduce((sum, row) => sum + (row.options_activity_proxy.call_volume ?? 0), 0), 0),
      total_put_volume: round(rows.reduce((sum, row) => sum + (row.options_activity_proxy.put_volume ?? 0), 0), 0),
      confidence_counts: rows.reduce((acc, row) => {
        acc[row.confidence] = (acc[row.confidence] ?? 0) + 1;
        return acc;
      }, {}),
      failed_attempts: attempts.length,
    },
    semantics: {
      netOptionsProxyScore: "Higher means higher OCC listed-options call-volume share versus put-volume share for the underlying on the source date. This is a volume-skew proxy, not real options flow, OPRA, or buyer/seller direction.",
    },
    attempts,
    rows,
  };
}

function mergeHistory(snapshot) {
  const history = readJson(HISTORY_FILE, {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    rows: [],
  });
  const rows = Array.isArray(history.rows) ? history.rows : [];
  const incoming = snapshot.rows.map((row) => ({
    ticker: row.ticker,
    as_of: row.as_of,
    source_date: row.source_date,
    confidence: row.confidence,
    coverage_ratio: row.coverage_ratio,
    netOptionsProxyScore: row.options_activity_proxy.score_0_100,
    callVolume: row.options_activity_proxy.call_volume,
    putVolume: row.options_activity_proxy.put_volume,
    totalVolume: row.options_activity_proxy.total_volume,
    putCallVolumeRatio: row.options_activity_proxy.put_call_volume_ratio,
  }));
  const incomingKeys = new Set(incoming.map((row) => `${row.ticker}|${row.source_date}`));
  const kept = rows.filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}`));
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    raw_policy: {
      third_party_raw_public: false,
      rows_are_derived_only: true,
    },
    rows: [...kept, ...incoming].sort((a, b) => (
      String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
    )),
  };
}

async function build(args) {
  const tickers = loadTickerUniverse(args);
  const dates = candidateDates({ requestedDate: args.date, maxWalkbackDays: args.maxWalkbackDays });
  if (args.planOnly) {
    return {
      plan_only: true,
      schema_version: SCHEMA_VERSION,
      formula_version: FORMULA_VERSION,
      tickers: tickers.length,
      sample: tickers.slice(0, 20),
      candidate_dates: dates,
      raw_cache_dir: path.relative(repoRoot, OCC_CACHE_DIR),
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      public_mirror: false,
    };
  }

  const dateAttempts = [];
  for (const ymd of dates) {
    const result = await loadRowsForDate({ ymd, tickers, noFetch: args.noFetch, sleepMs: args.sleepMs });
    dateAttempts.push({ ymd, rows: result.rows.length, failed_attempts: result.attempts.length });
    const usableRows = result.rows.filter((row) => row.options_activity_proxy.total_volume > 0);
    if (usableRows.length === 0) continue;
    const snapshot = buildSnapshot({
      rows: result.rows,
      ymd,
      generatedAt: isoNow(),
      attempts: result.attempts,
    });
    const history = mergeHistory(snapshot);
    if (!args.noWrite) {
      writeJson(OUTPUT_FILE, snapshot);
      writeJson(HISTORY_FILE, history);
    }
    return {
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      wrote: !args.noWrite,
      occ_source_date: ymd,
      coverage: snapshot.coverage,
      date_attempts: dateAttempts,
      reference_rows: snapshot.rows.filter((row) => DEFAULT_REFERENCE_TICKERS.includes(row.ticker)),
    };
  }
  throw new Error(`No OCC option volume rows available in requested window: ${JSON.stringify(dateAttempts)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await build(args);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

export {
  buildRowsForTest,
  candidateDates,
  directionFromOptionsVolume,
  parseOccCsv,
  scoreOptionsVolume,
};

function buildRowsForTest({ ticker, ymd, callCsv, putCsv }) {
  return buildTickerRow({
    ticker,
    ymd,
    callLoad: { text: callCsv, cache_path: "_private/test/C.csv" },
    putLoad: { text: putCsv, cache_path: "_private/test/P.csv" },
  });
}
