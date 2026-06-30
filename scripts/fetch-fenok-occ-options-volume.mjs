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
const DEFAULT_ALL_ELIGIBLE_BATCH_SIZE = 50;
const DEFAULT_ALL_ELIGIBLE_MAX_REQUESTS = 100;
const DEFAULT_ALL_ELIGIBLE_FAIL_THRESHOLD = 5;
const OCC_ENDPOINT = "https://marketdata.theocc.com/volume-query";
const OCC_PLAIN_UNDERLYING_RE = /^[A-Z][A-Z0-9]{0,11}$/;
const OCC_EXPLICIT_UNDERLYING_RE = /^[A-Z][A-Z0-9.\-]{0,11}$/;
const OCC_AVAILABILITY_POLICY = {
  source_id: "occ_volume_query",
  availability_status: "not_verified",
  public_docs_evidence: "https://www.theocc.com/market-data/market-data-reports/other-market-data-info/batch-processing/volume-query-batch-processing",
  exact_volume_query_release_time: null,
  caveat: "OCC volume-query endpoint and batch parameters are observed, but exact daily volume availability time is not confirmed from the public batch page. Product/Series approximate release times must not be treated as volume-query proof.",
  scheduler_guidance: {
    initial_daily_run_kst: "08:30",
    rationale: "Run in KST morning after FINRA's known worst-case KST availability, then let source-specific retries/polling discover OCC readiness until empirical polling replaces this placeholder.",
    do_not_default_to: ["23:45 ET", "12:45 KST"],
  },
  poll_window_kst: {
    start: "08:00",
    end: "10:30",
    status: "initial_unverified_window_pending_empirical_polling",
  },
};

function parseArgs(argv) {
  const args = {
    allEligible: false,
    batchIndex: 0,
    batchSize: 0,
    date: "",
    eligibleManifest: "",
    failThreshold: 0,
    tickers: "",
    limit: 0,
    maxWalkbackDays: 7,
    maxRequests: 0,
    noFetch: false,
    noWrite: false,
    planOnly: false,
    referenceOnly: false,
    s0OccMissing: false,
    sleepMs: 250,
    startAfter: "",
  };
  let maxWalkbackDaysExplicit = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--all-eligible") args.allEligible = true;
    else if (arg === "--batch-index") args.batchIndex = Number(next()) || 0;
    else if (arg === "--batch-size") args.batchSize = Number(next()) || 0;
    else if (arg === "--date") args.date = next();
    else if (arg === "--eligible-manifest") args.eligibleManifest = next();
    else if (arg === "--fail-threshold") args.failThreshold = Number(next()) || 0;
    else if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--max-walkback-days") {
      const parsed = Number(next());
      args.maxWalkbackDays = Number.isFinite(parsed) && parsed >= 0 ? parsed : args.maxWalkbackDays;
      maxWalkbackDaysExplicit = true;
    }
    else if (arg === "--max-requests") args.maxRequests = Number(next()) || 0;
    else if (arg === "--sleep-ms") args.sleepMs = Number(next()) || 0;
    else if (arg === "--start-after") args.startAfter = next();
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--reference-only") args.referenceOnly = true;
    else if (arg === "--s0-occ-missing") args.s0OccMissing = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const selectorCount = [args.allEligible, args.referenceOnly, args.s0OccMissing, Boolean(args.tickers)].filter(Boolean).length;
  if (selectorCount > 1) {
    throw new Error("Choose exactly one OCC ticker selector: --tickers, --reference-only, --all-eligible, or --s0-occ-missing");
  }
  if (args.allEligible) {
    if (!maxWalkbackDaysExplicit) args.maxWalkbackDays = 0;
    if (args.batchSize <= 0) args.batchSize = DEFAULT_ALL_ELIGIBLE_BATCH_SIZE;
    if (args.maxRequests <= 0) args.maxRequests = DEFAULT_ALL_ELIGIBLE_MAX_REQUESTS;
    if (args.failThreshold <= 0) args.failThreshold = DEFAULT_ALL_ELIGIBLE_FAIL_THRESHOLD;
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

function readEligibleManifest(relOrAbsPath) {
  if (!relOrAbsPath) return null;
  const absPath = path.isAbsolute(relOrAbsPath) ? relOrAbsPath : path.join(repoRoot, relOrAbsPath);
  const payload = JSON.parse(fs.readFileSync(absPath, "utf8"));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.tickers)) return payload.tickers;
  if (Array.isArray(payload.rows)) {
    return payload.rows.map((row) => row.ticker ?? row.symbol ?? row.underlying).filter(Boolean);
  }
  throw new Error(`Unsupported eligible manifest shape: ${relOrAbsPath}`);
}

function tickerRowsFromFenokSignals() {
  const fenokSignals = readJson("computed/fenok_signals.json", {});
  return Array.isArray(fenokSignals.rows) ? fenokSignals.rows : [];
}

function readCandidateTickers({ eligibleManifest = "", usOnly = false } = {}) {
  let out = readEligibleManifest(eligibleManifest);
  if (!out) {
    out = tickerRowsFromFenokSignals()
      .filter((row) => !usOnly || row.market_scope === "us")
      .map((row) => normalizeTicker(row.ticker))
      .filter(Boolean);
  }
  return [...new Set(out.map(normalizeTicker).filter(Boolean))].sort();
}

function loadAllEligibleUniverse({ eligibleManifest = "", limit = 0 } = {}) {
  let out = readCandidateTickers({ eligibleManifest, usOnly: true });
  // OCC listed-options endpoint uses plain US underlyings. Exclude foreign
  // suffixes and share-class punctuation unless an owner-reviewed manifest
  // maps them explicitly later.
  out = out.filter((ticker) => OCC_PLAIN_UNDERLYING_RE.test(ticker));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function loadOccCoveredTickers() {
  const output = readJson(OUTPUT_FILE, {});
  const history = readJson(HISTORY_FILE, {});
  const rows = [
    ...(Array.isArray(output?.rows) ? output.rows : []),
    ...(Array.isArray(history?.rows) ? history.rows : []),
  ];
  return new Set(rows.map((row) => normalizeTicker(row.ticker)).filter(Boolean));
}

function loadS0OccMissingUniverse({ eligibleManifest = "", limit = 0 } = {}) {
  const sourceTickers = readCandidateTickers({ eligibleManifest, usOnly: true });
  const covered = loadOccCoveredTickers();
  const missing = sourceTickers.filter((ticker) => !covered.has(ticker));
  const excluded = missing.filter((ticker) => !OCC_PLAIN_UNDERLYING_RE.test(ticker));
  let selectable = missing.filter((ticker) => OCC_PLAIN_UNDERLYING_RE.test(ticker));
  if (limit > 0) selectable = selectable.slice(0, limit);
  return {
    source_count: sourceTickers.length,
    covered_count: sourceTickers.filter((ticker) => covered.has(ticker)).length,
    missing_count: missing.length,
    occ_plain_selectable_count: missing.length - excluded.length,
    excluded_count: excluded.length,
    excluded_sample: excluded.slice(0, 20),
    tickers: selectable,
  };
}

function applyTickerBatch(tickers, { batchIndex = 0, batchSize = 0, startAfter = "" } = {}) {
  let out = [...tickers];
  const cursor = normalizeTicker(startAfter);
  if (cursor) {
    const idx = out.indexOf(cursor);
    if (idx >= 0) out = out.slice(idx + 1);
  }
  if (batchSize > 0) {
    const start = Math.max(0, batchIndex) * batchSize;
    out = out.slice(start, start + batchSize);
  }
  return out;
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
  out = [...new Set(out)].filter((ticker) => OCC_EXPLICIT_UNDERLYING_RE.test(ticker));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function resolveTickerUniverse(args) {
  if (args.s0OccMissing) {
    const missingUniverse = loadS0OccMissingUniverse({
      eligibleManifest: args.eligibleManifest,
      limit: args.limit,
    });
    const tickers = applyTickerBatch(missingUniverse.tickers, {
      batchIndex: args.batchIndex,
      batchSize: args.batchSize,
      startAfter: args.startAfter,
    });
    return {
      mode: "s0_occ_missing_batched",
      eligible_count: missingUniverse.occ_plain_selectable_count,
      excluded_note: "S0 tickers already covered by OCC are skipped; dotted/foreign suffixes are excluded until owner-reviewed OCC underlying mapping exists.",
      tickers,
      missing_selector: {
        source_count: missingUniverse.source_count,
        covered_count: missingUniverse.covered_count,
        missing_count: missingUniverse.missing_count,
        occ_plain_selectable_count: missingUniverse.occ_plain_selectable_count,
        excluded_count: missingUniverse.excluded_count,
        excluded_sample: missingUniverse.excluded_sample,
      },
    };
  }
  if (args.allEligible) {
    const eligibleTickers = loadAllEligibleUniverse({
      eligibleManifest: args.eligibleManifest,
      limit: args.limit,
    });
    return {
      mode: "all_eligible_batched",
      eligible_count: eligibleTickers.length,
      excluded_note: "plain OCC underlyings only; dotted/foreign suffixes require owner-reviewed mapping",
      tickers: applyTickerBatch(eligibleTickers, {
        batchIndex: args.batchIndex,
        batchSize: args.batchSize,
        startAfter: args.startAfter,
      }),
    };
  }
  const selected = loadTickerUniverse(args);
  return {
    mode: args.referenceOnly ? "reference_only" : "explicit_tickers",
    eligible_count: selected.length,
    excluded_note: null,
    tickers: selected,
  };
}

function estimateMaxLiveRequests({ tickers, dates }) {
  return tickers.length * dates.length * 2;
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

async function loadRowsForDate({ ymd, tickers, noFetch, sleepMs, failThreshold }) {
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
      if (failThreshold > 0 && attempts.filter((attempt) => attempt.status === "failed").length >= failThreshold) {
        attempts.push({ ticker, status: "stopped_fail_threshold", fail_threshold: failThreshold });
        break;
      }
    }
  }
  return { ymd, rows, attempts };
}

function buildCoverage(rows, attempts = []) {
  return {
    row_count: rows.length,
    with_options_activity_score: rows.filter((row) => row.options_activity_proxy.score_0_100 != null).length,
    total_call_volume: round(rows.reduce((sum, row) => sum + (row.options_activity_proxy.call_volume ?? 0), 0), 0),
    total_put_volume: round(rows.reduce((sum, row) => sum + (row.options_activity_proxy.put_volume ?? 0), 0), 0),
    confidence_counts: rows.reduce((acc, row) => {
      acc[row.confidence] = (acc[row.confidence] ?? 0) + 1;
      return acc;
    }, {}),
    failed_attempts: attempts.length,
  };
}

function buildNoRecordEvidence({
  generatedAt,
  universe,
  tickers,
  dates,
  dateResults,
  args,
  estimatedMaxLiveRequests,
}) {
  const attempts = dateResults.flatMap((item) => item.attempts.map((attempt) => ({
    ymd: item.ymd,
    ...attempt,
  })));
  const rows = dateResults.flatMap((item) => item.rows.map((row) => ({
    ymd: item.ymd,
    ticker: row.ticker,
    total_volume: row.options_activity_proxy?.total_volume ?? null,
    row_count: row.options_activity_proxy?.row_count ?? null,
  })));
  const statuses = [...new Set(attempts.map((attempt) => attempt.status).filter(Boolean))].sort();
  const allEmpty = rows.length > 0 && rows.every((row) => Number(row.total_volume ?? 0) <= 0);
  const cacheMissingNoFetch = statuses.includes("cache_missing_no_fetch");
  return {
    schema_version: "fenok-occ-availability-evidence/v0.1",
    generated_at: generatedAt,
    status: cacheMissingNoFetch ? "cache_missing_no_fetch" : allEmpty ? "all_empty_occ_records" : "no_usable_occ_records",
    collection_mode: universe.mode,
    no_fetch: Boolean(args.noFetch),
    no_write: Boolean(args.noWrite),
    selected_tickers: tickers.length,
    selected_sample: tickers.slice(0, 20),
    candidate_dates: dates,
    request_budget: {
      estimated_max_live_requests: estimatedMaxLiveRequests,
      max_requests: args.maxRequests || null,
      status: args.maxRequests > 0 && estimatedMaxLiveRequests > args.maxRequests ? "blocked_over_budget" : "within_budget",
    },
    evidence_counts: {
      date_count: dateResults.length,
      attempt_count: attempts.length,
      empty_row_count: rows.length,
      cache_missing_no_fetch: attempts.filter((attempt) => attempt.status === "cache_missing_no_fetch").length,
      failed: attempts.filter((attempt) => attempt.status === "failed").length,
    },
    statuses,
    date_results: dateResults.map((item) => ({
      ymd: item.ymd,
      rows: item.rows.length,
      attempts: item.attempts.length,
      empty_rows: item.rows.filter((row) => Number(row.options_activity_proxy?.total_volume ?? 0) <= 0).length,
      attempt_statuses: [...new Set(item.attempts.map((attempt) => attempt.status).filter(Boolean))].sort(),
    })),
    missing_selector: universe.missing_selector ?? null,
    raw_policy: {
      external_collection: !args.noFetch,
      raw_cache_public: false,
      third_party_raw_public: false,
      full_public_mirror: false,
    },
    availability_policy: OCC_AVAILABILITY_POLICY,
  };
}

function mergeNoRecordEvidence(previous, evidence) {
  const rows = Array.isArray(previous?.rows) ? previous.rows : [];
  const historyRows = Array.isArray(previous?.availability_evidence_history)
    ? previous.availability_evidence_history
    : [];
  const evidenceSummary = {
    generated_at: evidence.generated_at,
    status: evidence.status,
    collection_mode: evidence.collection_mode,
    no_fetch: evidence.no_fetch,
    selected_tickers: evidence.selected_tickers,
    candidate_dates: evidence.candidate_dates,
    evidence_counts: evidence.evidence_counts,
  };
  return {
    schema_version: previous?.schema_version ?? 1,
    generated_at: evidence.generated_at,
    formula_version: previous?.formula_version ?? FORMULA_VERSION,
    contract_doc: previous?.contract_doc ?? CONTRACT_DOC,
    public_surface_status: previous?.public_surface_status ?? "admin_private_derived_only_public_summary_source",
    raw_policy: previous?.raw_policy ?? {
      external_collection: false,
      raw_cache_public: false,
      third_party_raw_public: false,
      full_public_mirror: false,
      raw_cache_dir: path.relative(repoRoot, OCC_CACHE_DIR),
      public_payload: null,
    },
    query_contract: previous?.query_contract ?? {
      endpoint: OCC_ENDPOINT,
      format: "csv",
      volumeQueryType: "O",
      symbolType: "U",
      reportType: "D",
      productKind: "OSTK",
      accountType: "omitted_all_accounts",
      porc: "C_or_P",
    },
    availability_policy: OCC_AVAILABILITY_POLICY,
    collection_retry_policy: previous?.collection_retry_policy ?? {
      max_walkback_days: null,
      sleep_ms_between_side_queries: null,
      exact_release_time_verified: false,
      empirical_polling_required: true,
    },
    coverage: previous?.coverage ?? buildCoverage(rows, []),
    semantics: previous?.semantics ?? {
      netOptionsProxyScore: "Higher means higher OCC listed-options call-volume share versus put-volume share for the underlying on the source date. This is a volume-skew proxy, not real options flow, OPRA, or buyer/seller direction.",
    },
    previous_output_generated_at: previous?.generated_at ?? null,
    availability_evidence: evidence,
    availability_evidence_history: [...historyRows, evidenceSummary].slice(-30),
    attempts: previous?.attempts ?? [],
    rows,
  };
}

function buildSnapshot({ rows, ymd, generatedAt, attempts, maxWalkbackDays, sleepMs }) {
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
    availability_policy: OCC_AVAILABILITY_POLICY,
    collection_retry_policy: {
      max_walkback_days: maxWalkbackDays,
      sleep_ms_between_side_queries: sleepMs,
      exact_release_time_verified: false,
      empirical_polling_required: true,
    },
    coverage: buildCoverage(rows, attempts),
    semantics: {
      netOptionsProxyScore: "Higher means higher OCC listed-options call-volume share versus put-volume share for the underlying on the source date. This is a volume-skew proxy, not real options flow, OPRA, or buyer/seller direction.",
    },
    attempts,
    rows,
  };
}

function mergeOutputSnapshot(previous, snapshot) {
  const existingRows = Array.isArray(previous?.rows) ? previous.rows : [];
  if (existingRows.length === 0) return snapshot;
  const incomingKeys = new Set(snapshot.rows.map((row) => `${row.ticker}|${row.source_date}`));
  const kept = existingRows.filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}`));
  const rows = [...kept, ...snapshot.rows].sort((a, b) => (
    String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
  ));
  return {
    ...snapshot,
    batch_coverage: snapshot.coverage,
    previous_output_generated_at: previous?.generated_at ?? null,
    upsert_policy: {
      key: ["ticker", "source_date"],
      replaced_rows: existingRows.length - kept.length,
      added_rows: snapshot.rows.length - (existingRows.length - kept.length),
      cumulative_rows: rows.length,
    },
    coverage: buildCoverage(rows, snapshot.attempts),
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
  const next = {
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
  if (snapshot.availability_evidence) next.availability_evidence = snapshot.availability_evidence;
  if (snapshot.availability_evidence_history) next.availability_evidence_history = snapshot.availability_evidence_history;
  return next;
}

async function build(args) {
  const universe = resolveTickerUniverse(args);
  const tickers = universe.tickers;
  const dates = candidateDates({ requestedDate: args.date, maxWalkbackDays: args.maxWalkbackDays });
  const estimatedMaxLiveRequests = estimateMaxLiveRequests({ tickers, dates });
  if (args.planOnly) {
    return {
      plan_only: true,
      schema_version: SCHEMA_VERSION,
      formula_version: FORMULA_VERSION,
      collection_mode: universe.mode,
      eligible_count: universe.eligible_count,
      excluded_note: universe.excluded_note ?? null,
      missing_selector: universe.missing_selector ?? null,
      selected_tickers: tickers.length,
      sample: tickers.slice(0, 20),
      candidate_dates: dates,
      batch: {
        batch_index: args.batchIndex,
        batch_size: args.batchSize,
        start_after: args.startAfter || null,
      },
      request_budget: {
        estimated_max_live_requests: estimatedMaxLiveRequests,
        max_requests: args.maxRequests || null,
        status: args.maxRequests > 0 && estimatedMaxLiveRequests > args.maxRequests ? "blocked_over_budget" : "within_budget",
      },
      raw_cache_dir: path.relative(repoRoot, OCC_CACHE_DIR),
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      availability_policy: OCC_AVAILABILITY_POLICY,
      collection_retry_policy: {
        max_walkback_days: args.maxWalkbackDays,
        sleep_ms_between_side_queries: args.sleepMs,
        exact_release_time_verified: false,
        empirical_polling_required: true,
      },
      public_mirror: false,
    };
  }

  if (!args.noFetch && args.maxRequests > 0 && estimatedMaxLiveRequests > args.maxRequests) {
    throw new Error(`OCC request budget exceeded: estimated ${estimatedMaxLiveRequests}, max ${args.maxRequests}. Use --plan-only, smaller --batch-size, or explicit approval.`);
  }

  const dateAttempts = [];
  const noRecordResults = [];
  for (const ymd of dates) {
    const result = await loadRowsForDate({
      ymd,
      tickers,
      noFetch: args.noFetch,
      sleepMs: args.sleepMs,
      failThreshold: args.failThreshold,
    });
    dateAttempts.push({ ymd, rows: result.rows.length, failed_attempts: result.attempts.length });
    const usableRows = result.rows.filter((row) => row.options_activity_proxy.total_volume > 0);
    if (usableRows.length === 0) {
      noRecordResults.push(result);
      continue;
    }
    const snapshot = buildSnapshot({
      rows: result.rows,
      ymd,
      generatedAt: isoNow(),
      attempts: result.attempts,
      maxWalkbackDays: args.maxWalkbackDays,
      sleepMs: args.sleepMs,
    });
    const outputSnapshot = mergeOutputSnapshot(readJson(OUTPUT_FILE, null), snapshot);
    const history = mergeHistory(outputSnapshot);
    if (!args.noWrite) {
      writeJson(OUTPUT_FILE, outputSnapshot);
      writeJson(HISTORY_FILE, history);
    }
    return {
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      wrote: !args.noWrite,
      occ_source_date: ymd,
      availability_policy: OCC_AVAILABILITY_POLICY,
      coverage: outputSnapshot.coverage,
      batch_coverage: snapshot.coverage,
      collection_mode: universe.mode,
      missing_selector: universe.missing_selector ?? null,
      selected_tickers: tickers.length,
      request_budget: {
        estimated_max_live_requests: estimatedMaxLiveRequests,
        max_requests: args.maxRequests || null,
      },
      date_attempts: dateAttempts,
      reference_rows: outputSnapshot.rows.filter((row) => DEFAULT_REFERENCE_TICKERS.includes(row.ticker)),
    };
  }
  if (noRecordResults.length > 0) {
    const generatedAt = isoNow();
    const evidence = buildNoRecordEvidence({
      generatedAt,
      universe,
      tickers,
      dates,
      dateResults: noRecordResults,
      args,
      estimatedMaxLiveRequests,
    });
    const outputSnapshot = mergeNoRecordEvidence(readJson(OUTPUT_FILE, null), evidence);
    const history = mergeHistory(outputSnapshot);
    if (!args.noWrite) {
      writeJson(OUTPUT_FILE, outputSnapshot);
      writeJson(HISTORY_FILE, history);
    }
    return {
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      wrote: !args.noWrite,
      no_record_persisted: !args.noWrite,
      availability_evidence: evidence,
      coverage: outputSnapshot.coverage,
      collection_mode: universe.mode,
      missing_selector: universe.missing_selector ?? null,
      selected_tickers: tickers.length,
      request_budget: {
        estimated_max_live_requests: estimatedMaxLiveRequests,
        max_requests: args.maxRequests || null,
      },
      date_attempts: dateAttempts,
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
  applyTickerBatch,
  build,
  buildCoverage,
  buildNoRecordEvidence,
  buildRowsForTest,
  candidateDates,
  directionFromOptionsVolume,
  estimateMaxLiveRequests,
  loadAllEligibleUniverse,
  loadS0OccMissingUniverse,
  mergeNoRecordEvidence,
  mergeOutputSnapshot,
  OCC_AVAILABILITY_POLICY,
  parseOccCsv,
  parseArgs,
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
