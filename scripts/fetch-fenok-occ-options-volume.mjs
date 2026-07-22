#!/usr/bin/env node
/**
 * Fetch bounded OCC option volume query CSVs and publish derived-only ticker
 * option-activity proxies. Raw OCC CSV files stay under _private/admin.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  attemptResult,
  atomicWrite,
  classifyEndpointResponse,
  defaultAttemptId,
  returnedTuple,
  threwTuple,
  transportError,
  unobservedTuple,
  worstRequestResult,
  writeMergedAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";
import { isUsTradingDate } from "./fetch-fenok-finra-daily-private.mjs";
import { OCC_OPTIONS_FORMULA_VERSION } from "./lib/fenok-proxy-formula-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow");

const SCHEMA_VERSION = "fenok-occ-options-volume/v0.1";
const FORMULA_VERSION = OCC_OPTIONS_FORMULA_VERSION;
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_flow_sources_20260628.md";
const OCC_CACHE_DIR = path.join(privateRoot, "occ_options_volume");
const OUTPUT_FILE = "computed/fenok_occ_options_volume.json";
const HISTORY_FILE = "computed/fenok_occ_options_volume_history.json";
const AVAILABILITY_FILE = "computed/fenok_occ_options_availability.json";
const OCC_LANE_ID = "occ_options_volume";
const OCC_LKG_KEY = "occ_options_volume";
const CONTROLLED_FAILURE_LANE_IDS = Object.freeze([OCC_LANE_ID, "finra_short_volume"]);
const OCC_FRESHNESS_MARKER_SCHEMA = "fenok-occ-freshness-marker/v1";
const DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];
const DEFAULT_ALL_ELIGIBLE_BATCH_SIZE = 50;
const DEFAULT_ALL_ELIGIBLE_MAX_REQUESTS = 100;
const DEFAULT_ALL_ELIGIBLE_FAIL_THRESHOLD = 5;
const OCC_ENDPOINT = "https://marketdata.theocc.com/volume-query";
const OCC_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "occ-bounded-persistence/v1",
  basis: "source_date",
  scope: "per_ticker",
  max_distinct_source_dates_per_ticker: 100,
  eviction: "oldest_source_date_first",
});
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
    s0OccClassShare: false,
    s0OccMissing: false,
    s0OccPartialMissing: false,
    sleepMs: 250,
    startAfter: "",
  };
  let maxWalkbackDaysExplicit = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--all-eligible") args.allEligible = true;
    else if (arg === "--s0-occ-class-share") args.s0OccClassShare = true;
    else if (arg === "--s0-occ-missing") args.s0OccMissing = true;
    else if (arg === "--s0-occ-partial-missing") args.s0OccPartialMissing = true;
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
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const batchModeCount = [args.allEligible, args.s0OccClassShare, args.s0OccMissing, args.s0OccPartialMissing].filter(Boolean).length;
  if (batchModeCount > 1) throw new Error("Choose only one of --all-eligible, --s0-occ-class-share, --s0-occ-missing, or --s0-occ-partial-missing");
  if (args.allEligible || args.s0OccClassShare || args.s0OccMissing || args.s0OccPartialMissing) {
    if (!maxWalkbackDaysExplicit) args.maxWalkbackDays = 0;
    if (args.batchSize <= 0) args.batchSize = DEFAULT_ALL_ELIGIBLE_BATCH_SIZE;
    if (args.maxRequests <= 0) args.maxRequests = DEFAULT_ALL_ELIGIBLE_MAX_REQUESTS;
    if (args.failThreshold <= 0) args.failThreshold = DEFAULT_ALL_ELIGIBLE_FAIL_THRESHOLD;
  }
  return args;
}

function parseControlledFailureLanes(value, eventName) {
  const raw = String(value ?? "");
  if (raw.trim() === "") return [];
  const tokens = raw.split(",").map((token) => token.trim());
  if (tokens.some((token) => token === "")) {
    throw new Error("empty controlled failure lane token");
  }
  for (const token of tokens) {
    if (!CONTROLLED_FAILURE_LANE_IDS.includes(token)) {
      throw new Error(`unknown controlled failure lane: ${token}`);
    }
  }
  if (eventName !== "workflow_dispatch") {
    throw new Error("controlled failure lanes are allowed only for workflow_dispatch");
  }
  return [...new Set(tokens)];
}

function controlledOccFailureResult() {
  return {
    ...attemptResult("transport_error", threwTuple("transport")),
    reason: "controlled_failure",
    controlled: true,
  };
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

function assertValidSourceDate(sourceDate) {
  const normalized = String(sourceDate ?? "");
  if (!/^\d{8}$/.test(normalized)) {
    throw new Error(`invalid source_date: ${normalized || "<empty>"}`);
  }
  const parsed = new Date(Date.UTC(
    Number(normalized.slice(0, 4)),
    Number(normalized.slice(4, 6)) - 1,
    Number(normalized.slice(6, 8)),
  ));
  if (ymdFromDate(parsed) !== normalized) {
    throw new Error(`invalid source_date: ${normalized}`);
  }
  return normalized;
}

function retainLatestTickerSourceDates(collections, policy = OCC_PERSISTENCE_POLICY) {
  const maxDates = Number(policy?.max_distinct_source_dates_per_ticker);
  if (!Number.isInteger(maxDates) || maxDates <= 0) {
    throw new Error("invalid OCC persistence max_distinct_source_dates_per_ticker");
  }

  const datesByTicker = new Map();
  for (const [name, rows] of Object.entries(collections ?? {})) {
    if (!Array.isArray(rows)) throw new Error(`invalid persistence collection: ${name}`);
    for (const row of rows) {
      const ticker = normalizeTicker(row?.ticker);
      if (!ticker) throw new Error(`invalid persistence ticker in ${name}`);
      const sourceDate = assertValidSourceDate(row?.source_date);
      if (!datesByTicker.has(ticker)) datesByTicker.set(ticker, new Set());
      datesByTicker.get(ticker).add(sourceDate);
    }
  }

  const retainedDatesByTicker = new Map();
  for (const [ticker, dates] of datesByTicker) {
    retainedDatesByTicker.set(ticker, new Set([...dates].sort().reverse().slice(0, maxDates)));
  }

  const retainedCollections = {};
  const collectionStats = {};
  for (const [name, rows] of Object.entries(collections ?? {})) {
    const retainedRows = rows.filter((row) => (
      retainedDatesByTicker.get(normalizeTicker(row.ticker))?.has(String(row.source_date))
    ));
    retainedCollections[name] = retainedRows;
    collectionStats[name] = {
      before: rows.length,
      retained: retainedRows.length,
      pruned: rows.length - retainedRows.length,
    };
  }

  return {
    collections: retainedCollections,
    stats: {
      retained_tickers: retainedDatesByTicker.size,
      collections: collectionStats,
    },
  };
}

function persistenceMetadata(previous, stats) {
  const lastMergePrunedRows = Object.values(stats.collections)
    .reduce((sum, collection) => sum + collection.pruned, 0);
  const previousTotal = Number(previous?.persistence_state?.total_pruned_rows);
  return {
    persistence_policy: OCC_PERSISTENCE_POLICY,
    persistence_state: {
      retained_tickers: stats.retained_tickers,
      collections: stats.collections,
      last_merge_pruned_rows: lastMergePrunedRows,
      total_pruned_rows: (Number.isFinite(previousTotal) ? previousTotal : 0) + lastMergePrunedRows,
    },
  };
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
  if (out.length === 0) {
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      const day = d.getUTCDay();
      if (day === 0 || day === 6) continue;
      out.push(ymdFromDate(d));
      break;
    }
  }
  return out;
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function normalizeSignalsTicker(ticker) {
  return normalizeTicker(ticker).replaceAll(".", "-");
}

function plainOccUnderlying(ticker) {
  return /^[A-Z][A-Z0-9]{0,11}$/.test(normalizeTicker(ticker));
}

function brkClassShareAcceptedForm(ticker) {
  const normalized = normalizeSignalsTicker(ticker);
  if (normalized === "BRK-A") return "BRK.A";
  if (normalized === "BRK-B") return "BRK.B";
  return null;
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

function loadAllEligibleUniverse({ eligibleManifest = "", limit = 0 } = {}) {
  let out = readEligibleManifest(eligibleManifest);
  if (!out) {
    const fenokSignals = readJson("computed/fenok_signals.json", {});
    const rows = Array.isArray(fenokSignals.rows) ? fenokSignals.rows : [];
    out = rows
      .filter((row) => row.market_scope === "us")
      .map((row) => normalizeTicker(row.ticker))
      .filter(Boolean);
  }
  // OCC listed-options endpoint uses plain US underlyings. Exclude foreign
  // suffixes and share-class punctuation unless an owner-reviewed manifest
  // maps them explicitly later.
  out = [...new Set(out.map(normalizeTicker))]
    .filter((ticker) => /^[A-Z][A-Z0-9]{0,11}$/.test(ticker))
    .sort();
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function occAvailabilityStatusByTicker() {
  const availability = readJson(AVAILABILITY_FILE, {});
  const byTicker = new Map();
  for (const row of Array.isArray(availability.rows) ? availability.rows : []) {
    const ticker = normalizeSignalsTicker(row?.ticker);
    const status = String(row?.status ?? "").trim();
    if (!ticker || !status) continue;
    byTicker.set(ticker, status);
  }
  return byTicker;
}

function loadS0OccMissingUniverse({ limit = 0, priorStatuses = [] } = {}) {
  const fenokSignals = readJson("computed/fenok_signals.json", {});
  const occOptions = readJson(OUTPUT_FILE, {});
  const occTickers = new Set((Array.isArray(occOptions.rows) ? occOptions.rows : [])
    .map((row) => normalizeSignalsTicker(row.ticker_normalized ?? row.ticker))
    .filter(Boolean));
  const priorStatusSet = new Set(priorStatuses);
  const priorStatusByTicker = priorStatusSet.size > 0 ? occAvailabilityStatusByTicker() : null;
  const rows = Array.isArray(fenokSignals.rows) ? fenokSignals.rows : [];
  let out = rows
    .filter((row) => row.market === "US")
    .map((row) => normalizeSignalsTicker(row.ticker_normalized ?? row.ticker))
    .filter((ticker) => ticker && plainOccUnderlying(ticker) && !occTickers.has(ticker))
    .filter((ticker) => !priorStatusSet.size || priorStatusSet.has(priorStatusByTicker.get(ticker)));
  out = [...new Set(out)].sort();
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function loadS0OccPartialMissingUniverse({ limit = 0 } = {}) {
  return loadS0OccMissingUniverse({
    limit,
    priorStatuses: ["partial_no_record_or_form_gap"],
  });
}

function loadS0OccClassShareUniverse({ limit = 0 } = {}) {
  const fenokSignals = readJson("computed/fenok_signals.json", {});
  const occOptions = readJson(OUTPUT_FILE, {});
  const occTickers = new Set((Array.isArray(occOptions.rows) ? occOptions.rows : [])
    .map((row) => normalizeSignalsTicker(row.ticker_normalized ?? row.ticker))
    .filter(Boolean));
  const rows = Array.isArray(fenokSignals.rows) ? fenokSignals.rows : [];
  let out = rows
    .filter((row) => row.market === "US_CLASS")
    .map((row) => normalizeSignalsTicker(row.ticker_normalized ?? row.ticker))
    .filter((ticker) => /^BRK-[AB]$/.test(ticker) && !occTickers.has(ticker))
    .map(brkClassShareAcceptedForm)
    .filter(Boolean);
  out = [...new Set(out)].sort();
  if (limit > 0) out = out.slice(0, limit);
  return out;
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
  out = [...new Set(out)].filter((ticker) => /^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function resolveTickerUniverse(args) {
  if (args.s0OccClassShare) {
    const eligibleTickers = loadS0OccClassShareUniverse({ limit: args.limit });
    return {
      mode: "s0_occ_class_share_accepted_form_batched",
      eligible_count: eligibleTickers.length,
      excluded_note: "active S0 BRK class-share OCC gaps only; accepted forms use dotted underlyings BRK.A/BRK.B and do not include foreign suffix rows",
      accepted_form_policy: "owner_review_required_before_promotion; plan-only first, then bounded explicit class-share smoke",
      tickers: applyTickerBatch(eligibleTickers, {
        batchIndex: args.batchIndex,
        batchSize: args.batchSize,
        startAfter: args.startAfter,
      }),
    };
  }
  if (args.s0OccPartialMissing) {
    const eligibleTickers = loadS0OccPartialMissingUniverse({ limit: args.limit });
    return {
      mode: "s0_occ_partial_no_record_plain_us_batched",
      eligible_count: eligibleTickers.length,
      excluded_note: "active S0 plain-US OCC gaps previously attempted with one loaded side and one no_record side; both-side no_record remains evidence-only",
      prior_status_filter: ["partial_no_record_or_form_gap"],
      tickers: applyTickerBatch(eligibleTickers, {
        batchIndex: args.batchIndex,
        batchSize: args.batchSize,
        startAfter: args.startAfter,
      }),
    };
  }
  if (args.s0OccMissing) {
    const eligibleTickers = loadS0OccMissingUniverse({ limit: args.limit });
    return {
      mode: "s0_occ_missing_plain_us_batched",
      eligible_count: eligibleTickers.length,
      excluded_note: "active S0 market=US plain underlyings missing from computed OCC rows; US_CLASS/non-plain rows require mapping policy",
      tickers: applyTickerBatch(eligibleTickers, {
        batchIndex: args.batchIndex,
        batchSize: args.batchSize,
        startAfter: args.startAfter,
      }),
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

function fetchResponse(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
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

function classifyOccEndpointResponse(response) {
  if (response?.statusCode === 200 && /^No record\(s\) found\s*$/i.test(String(response.body ?? "").trim())) {
    return {
      ...attemptResult("empty_payload", returnedTuple({
        httpStatus: 200,
        decode: "ok",
        payload: "empty",
      })),
      expectedUnavailable: true,
      expectedKind: "no_record",
    };
  }
  const classified = classifyEndpointResponse(response, {
    laneId: "occ_options_volume",
    decodeBody: (body) => ({ rows: parseOccCsv(body) }),
  });
  // WHOLE-BODY match, not a prefix. A prefix anchor accepted any body that
  // merely STARTED with the provider's sentence, so a gateway page or truncated
  // payload appended after it would still be classified expectedUnavailable.
  // Since expectedUnavailable rows are excluded from both reduceOccEndpointResults
  // and the systemic scan, an all-endpoint decode failure shaped that way would
  // reduce to workflow_unobserved and, with a complete LKG, exit 0 as degraded —
  // silently masking a real fault. Anything beyond the sentence and its date now
  // falls through as an actionable decode_error and escalates as it should.
  if (response?.statusCode === 200
    && /^Report date cannot be greater than \d{1,2}\/\d{1,2}\/\d{4}\.?$/i.test(String(response.body ?? "").trim())) {
    return {
      ...classified,
      expectedUnavailable: true,
      expectedKind: "date_not_available",
    };
  }
  return {
    ...classified,
    expectedUnavailable: false,
    expectedKind: null,
  };
}

function reduceOccEndpointResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return attemptResult("workflow_unobserved", unobservedTuple());
  }
  const ready = results.filter((result) => result.status === "ready");
  const actionable = results.filter((result) => result.expectedUnavailable !== true);
  if (actionable.length === 0) {
    // Exact provider no-record/future-date responses are neutral for a
    // multi-batch run. The canonical shard retains another batch's observed
    // tuple, while an all-neutral run remains explicitly unobserved.
    return attemptResult("workflow_unobserved", unobservedTuple());
  }
  if (ready.length > 0 && actionable.every((result) => result.status === "ready")) {
    return worstRequestResult(ready);
  }
  return worstRequestResult(actionable);
}

// A corrupt-classified OCC failure aborts the whole edge-daily workflow with a
// bare reason token. On 2026-07-21 and 07-22 batch 3/5 died on `decode_error`
// having printed nothing at all, so no one could tell which endpoint broke.
// This emits failure IDENTITY only — never provider bodies, because this
// repository is public and OCC raw rows are private.
const OCC_FAILURE_DIAGNOSTIC_KEYS = [
  "ticker", "symbol", "side", "endpoint", "endpointKind", "url_kind",
  "status", "reason", "expectedUnavailable", "expectedKind",
  "statusCode", "status_code", "http_status", "decode", "payload",
  "returned", "observed_at", "exceptionKind",
];
const OCC_FAILURE_DIAGNOSTIC_LIMIT = 8;

function redactOccEndpointRow(row, depth = 0) {
  if (!row || typeof row !== "object") return { shape: typeof row };
  const out = {};
  for (const key of OCC_FAILURE_DIAGNOSTIC_KEYS) {
    if (!(key in row)) continue;
    const value = row[key];
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = typeof value === "string" ? value.slice(0, 120) : value;
    } else if (typeof value === "object" && depth < 2) {
      out[key] = redactOccEndpointRow(value, depth + 1);
    }
  }
  return out;
}

function reportOccCorruptFailure({ reason, endpointResults, batchIndex = null }) {
  const rows = Array.isArray(endpointResults) ? endpointResults : [];
  const offenders = rows.filter((row) => row?.status !== "ready");
  console.error(
    `::error::OCC corrupt failure reason=${reason} batch_index=${batchIndex ?? "unknown"}`
    + ` endpoint_rows=${rows.length} non_ready_rows=${offenders.length}`,
  );
  for (const row of offenders.slice(0, OCC_FAILURE_DIAGNOSTIC_LIMIT)) {
    console.error(`::error::OCC failing endpoint ${JSON.stringify(redactOccEndpointRow(row))}`);
  }
  if (offenders.length > OCC_FAILURE_DIAGNOSTIC_LIMIT) {
    console.error(
      `::error::OCC failing endpoint list truncated: ${offenders.length - OCC_FAILURE_DIAGNOSTIC_LIMIT} more`,
    );
  }
}

function thrownEndpointResult(error) {
  const exceptionKind = transportError(error) ? "transport" : "unexpected";
  return attemptResult(
    exceptionKind === "transport" ? "transport_error" : "unexpected_error",
    threwTuple(exceptionKind),
  );
}

function stableAttemptId(prefix, observedAt) {
  const runId = String(process.env.GITHUB_RUN_ID || "").trim();
  const runAttempt = String(process.env.GITHUB_RUN_ATTEMPT || "1").trim();
  return runId ? `${prefix}-${runId}-${runAttempt}` : defaultAttemptId(prefix, observedAt);
}

function classifyOccError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/No record\(s\) found/i.test(message)) return "no_record";
  if (/timeout|HTTP 5\d\d|ECONNRESET|ETIMEDOUT/i.test(message)) return "transient_failed";
  return "failed";
}

async function loadOccCsv({ ymd, ticker, side, noFetch, request, cacheDir }) {
  const cachePath = path.join(cacheDir, ymd, `${ticker}_${side}.csv`);
  if (fs.existsSync(cachePath)) {
    return {
      text: fs.readFileSync(cachePath, "utf8"),
      source_url: occQueryUrl({ ymd, ticker, side }),
      cache_path: path.relative(repoRoot, cachePath),
      cache_hit: true,
      response: null,
    };
  }
  if (noFetch) {
    return {
      text: "",
      source_url: occQueryUrl({ ymd, ticker, side }),
      cache_path: path.relative(repoRoot, cachePath),
      cache_hit: false,
      missing_no_fetch: true,
      response: null,
    };
  }
  const url = occQueryUrl({ ymd, ticker, side });
  const response = await request(url);
  const text = String(response.body ?? "");
  if (response.statusCode >= 200 && response.statusCode < 300
    && !/^Report date cannot be greater than /i.test(text.trim())) {
    ensureDir(cachePath);
    fs.writeFileSync(cachePath, text, "utf8");
  }
  return {
    text,
    source_url: url,
    cache_path: path.relative(repoRoot, cachePath),
    cache_hit: false,
    response,
  };
}

async function loadOccSideWithEvidence({ ymd, ticker, side, noFetch, request, cacheDir }) {
  try {
    const load = await loadOccCsv({ ymd, ticker, side, noFetch, request, cacheDir });
    const base = {
      ticker,
      source_date: ymd,
      side,
      attempted_form: ticker,
      cache_hit: load.cache_hit === true,
      no_fetch: noFetch === true,
    };
    if (load.missing_no_fetch) {
      return {
        load,
        evidence: {
          ...base,
          status: "cache_missing_no_fetch",
          error_class: "cache_missing_no_fetch",
        },
        endpointResult: null,
      };
    }
    const endpointResult = load.response ? classifyOccEndpointResponse(load.response) : null;
    if (endpointResult && endpointResult.status !== "ready") {
      const status = endpointResult.expectedKind === "no_record"
        ? "no_record"
        : ["rate_limited", "http_error", "transport_error"].includes(endpointResult.reason)
          ? "transient_failed"
          : "failed";
      return {
        load,
        evidence: {
          ...base,
          status,
          error_class: status,
          error: endpointResult.reason,
        },
        endpointResult,
      };
    }
    try {
      parseOccCsv(load.text);
      return {
        load,
        evidence: {
          ...base,
          status: "loaded",
          error_class: null,
        },
        endpointResult,
      };
    } catch (error) {
      return {
        load,
        evidence: {
          ...base,
          status: classifyOccError(error),
          error_class: classifyOccError(error),
          error: String(error.message ?? error).slice(0, 240),
        },
        endpointResult,
      };
    }
  } catch (error) {
    const endpointResult = thrownEndpointResult(error);
    return {
      load: null,
      evidence: {
        ticker,
        source_date: ymd,
        side,
        attempted_form: ticker,
        cache_hit: false,
        no_fetch: noFetch === true,
        status: classifyOccError(error),
        error_class: classifyOccError(error),
        error: String(error.message ?? error).slice(0, 240),
      },
      endpointResult,
    };
  }
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

// OCC call/put volume log-ratio -> 0..100 skew score (declared calibration).
// Anchored on the latest-per-ticker projection of
// data/computed/fenok_occ_options_volume.json (686 scored rows, measured
// 2026-07-18; 685 rows source-dated 2026-07-17):
//   p5=-0.889  p10=-0.421  p25=0.065  p50=0.649
//   p75=1.531  p90=2.594  p95=3.446
// Rounded p5/p95 endpoints (-0.90/+3.45) keep measured saturation near 10%.
// The mapping is piecewise around log-ratio 0 so equal call/put volume remains
// exactly neutral at 50 despite the empirically call-skewed cross-section.
const OPTIONS_LOG_RATIO_FLOOR = -0.9; // ~p5 of 2026-07-18 latest projection
const OPTIONS_LOG_RATIO_NEUTRAL = 0;
const OPTIONS_LOG_RATIO_CEIL = 3.45; // ~p95 of 2026-07-18 latest projection

function scoreOptionsLogRatio(logRatio) {
  if (!Number.isFinite(logRatio)) return null;
  if (logRatio <= OPTIONS_LOG_RATIO_NEUTRAL) {
    const lowerSpan = OPTIONS_LOG_RATIO_NEUTRAL - OPTIONS_LOG_RATIO_FLOOR;
    return round(clamp(50 * ((logRatio - OPTIONS_LOG_RATIO_FLOOR) / lowerSpan)), 2);
  }
  const upperSpan = OPTIONS_LOG_RATIO_CEIL - OPTIONS_LOG_RATIO_NEUTRAL;
  return round(clamp(50 + (50 * ((logRatio - OPTIONS_LOG_RATIO_NEUTRAL) / upperSpan))), 2);
}

function scoreOptionsVolume(callVolume, putVolume) {
  if (callVolume + putVolume <= 0) return null;
  return scoreOptionsLogRatio(Math.log((callVolume + 1) / (putVolume + 1)));
}

function directionFromOptionsVolume(score) {
  if (!Number.isFinite(score)) return "unavailable";
  if (score >= 60) return "call_volume_skew_proxy";
  if (score <= 40) return "put_volume_skew_proxy";
  return "balanced_volume_proxy";
}

function rowsForAcceptedOccSide({ load, evidence }) {
  if (evidence?.status === "loaded") return parseOccCsv(load.text);
  if (evidence?.status === "no_record") return [];
  throw new Error(`Cannot build OCC row from side status=${evidence?.status ?? "unknown"}`);
}

function buildTickerRow({ ticker, ymd, callLoad, putLoad, callEvidence = { status: "loaded" }, putEvidence = { status: "loaded" } }) {
  const callRows = rowsForAcceptedOccSide({ load: callLoad, evidence: callEvidence });
  const putRows = rowsForAcceptedOccSide({ load: putLoad, evidence: putEvidence });
  const callVolume = callRows.reduce((sum, row) => sum + row.quantity, 0);
  const putVolume = putRows.reduce((sum, row) => sum + row.quantity, 0);
  const totalVolume = callVolume + putVolume;
  const score = scoreOptionsVolume(callVolume, putVolume);
  const exchanges = [...new Set([...callRows, ...putRows].map((row) => row.exchange).filter(Boolean))].sort();
  const actdate = callRows[0]?.actdate ?? putRows[0]?.actdate ?? null;
  const sideStatuses = { C: callEvidence.status, P: putEvidence.status };
  const noRecordSides = Object.entries(sideStatuses)
    .filter(([, status]) => status === "no_record")
    .map(([side]) => side)
    .sort();
  const acceptedFormPolicy = noRecordSides.length > 0
    ? "one_side_loaded_one_side_no_record_zero_volume_side"
    : "both_sides_loaded";
  return {
    ticker,
    as_of: isoFromYmd(ymd),
    source_date: ymd,
    confidence: score == null ? "low" : "medium",
    coverage_ratio: totalVolume > 0 ? (noRecordSides.length > 0 ? 0.5 : 0.65) : 0,
    accepted_form: ticker,
    accepted_form_policy: acceptedFormPolicy,
    side_statuses: sideStatuses,
    zero_volume_sides: noRecordSides,
    source_families: ["OCC Volume Query"],
    raw_cache_paths: [callLoad?.cache_path, putLoad?.cache_path].filter(Boolean),
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

async function loadRowsForDate({ ymd, tickers, noFetch, sleepMs, failThreshold, request, cacheDir }) {
  const rows = [];
  const attempts = [];
  const sideAttempts = [];
  const tickerAvailability = [];
  const endpointResults = [];
  for (const ticker of tickers) {
    const call = await loadOccSideWithEvidence({ ymd, ticker, side: "C", noFetch, request, cacheDir });
    if (call.endpointResult) endpointResults.push(call.endpointResult);
    if (sleepMs > 0 && call.load && !call.load.cache_hit) await sleep(sleepMs);
    const put = await loadOccSideWithEvidence({ ymd, ticker, side: "P", noFetch, request, cacheDir });
    if (put.endpointResult) endpointResults.push(put.endpointResult);
    if (sleepMs > 0 && put.load && !put.load.cache_hit) await sleep(sleepMs);
    sideAttempts.push(call.evidence, put.evidence);
    const summary = summarizeTickerAvailability({ ticker, ymd, sideAttempts: [call.evidence, put.evidence] });
    tickerAvailability.push(summary);
    if (summary.accepted_form) {
      rows.push(buildTickerRow({
        ticker,
        ymd,
        callLoad: call.load,
        putLoad: put.load,
        callEvidence: call.evidence,
        putEvidence: put.evidence,
      }));
      continue;
    }
    attempts.push({
      ticker,
      status: summary.status,
      side_statuses: summary.side_statuses,
      accepted_form: summary.accepted_form,
      accepted_form_policy: summary.accepted_form_policy,
      scoring_row_eligible: summary.scoring_row_eligible,
      coverage_row_eligible: summary.coverage_row_eligible,
      no_listed_options_policy_status: summary.no_listed_options_policy_status,
      attempted_forms: summary.attempted_forms,
    });
    if (failThreshold > 0 && attempts.filter((attempt) => ["failed", "transient_failed"].includes(attempt.status)).length >= failThreshold) {
        attempts.push({ ticker, status: "stopped_fail_threshold", fail_threshold: failThreshold });
        break;
    }
  }
  return {
    ymd,
    rows,
    attempts,
    side_attempts: sideAttempts,
    ticker_availability: tickerAvailability,
    endpoint_results: endpointResults,
  };
}

function summarizeTickerAvailability({ ticker, ymd, sideAttempts }) {
  const sideStatuses = Object.fromEntries(sideAttempts.map((attempt) => [attempt.side, attempt.status]));
  const hasLoaded = sideAttempts.some((attempt) => attempt.status === "loaded");
  const hasNoRecord = sideAttempts.some((attempt) => attempt.status === "no_record");
  let status = "unavailable";
  if (sideAttempts.every((attempt) => attempt.status === "loaded")) status = "options_activity_available";
  else if (sideAttempts.every((attempt) => attempt.status === "no_record")) status = "no_record";
  else if (sideAttempts.some((attempt) => attempt.status === "cache_missing_no_fetch")) status = "cache_missing_no_fetch";
  else if (sideAttempts.some((attempt) => attempt.status === "transient_failed")) status = "transient_failed";
  else if (sideAttempts.some((attempt) => attempt.status === "no_record")) status = "partial_no_record_or_form_gap";
  else if (sideAttempts.some((attempt) => attempt.status === "failed")) status = "failed";
  const acceptedForm = status === "options_activity_available" || (status === "partial_no_record_or_form_gap" && hasLoaded && hasNoRecord)
    ? ticker
    : null;
  const acceptedFormPolicy = status === "options_activity_available"
    ? "both_sides_loaded"
    : status === "partial_no_record_or_form_gap" && acceptedForm
      ? "one_side_loaded_one_side_no_record_zero_volume_side"
      : null;
  return {
    ticker,
    source_date: ymd,
    attempted_forms: [ticker],
    accepted_form: acceptedForm,
    accepted_form_policy: acceptedFormPolicy,
    scoring_row_eligible: Boolean(acceptedForm),
    coverage_row_eligible: Boolean(acceptedForm),
    no_listed_options_policy_status: status === "no_record" ? "pending_owner_acceptance" : null,
    status,
    side_statuses: sideStatuses,
    evidence_policy: status === "no_record"
      ? "Both C and P sides returned OCC no-record for the attempted form/date; this is not a permanent no-listed-options proof without accepted-form policy."
      : status === "partial_no_record_or_form_gap" && acceptedForm
        ? "One side returned OCC rows and the other returned OCC no-record for the accepted form/date; the no-record side is treated as zero volume, not as a no-listed-options proof."
      : null,
  };
}

function buildCoverage(rows, attempts = []) {
  const unresolved = attempts.filter((attempt) => attempt?.status !== "stopped_fail_threshold");
  const hardFailures = unresolved.filter((attempt) => ["failed", "transient_failed"].includes(attempt?.status));
  return {
    row_count: rows.length,
    with_options_activity_score: rows.filter((row) => row.options_activity_proxy.score_0_100 != null).length,
    total_call_volume: round(rows.reduce((sum, row) => sum + (row.options_activity_proxy.call_volume ?? 0), 0), 0),
    total_put_volume: round(rows.reduce((sum, row) => sum + (row.options_activity_proxy.put_volume ?? 0), 0), 0),
    confidence_counts: rows.reduce((acc, row) => {
      acc[row.confidence] = (acc[row.confidence] ?? 0) + 1;
      return acc;
    }, {}),
    failed_attempts: hardFailures.length,
    unresolved_attempts: unresolved.length,
    stopped_fail_threshold: attempts.some((attempt) => attempt?.status === "stopped_fail_threshold"),
  };
}

function summarizeDateAttempt({ ymd, rows = [], attempts = [], ticker_availability = [] }) {
  const statusCounts = ticker_availability.reduce((acc, row) => {
    const status = String(row?.status || "unknown");
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  const hardFailureCount = attempts.filter((attempt) => ["failed", "transient_failed"].includes(attempt?.status)).length;
  const usableRows = rows.filter((row) => Number(row?.options_activity_proxy?.total_volume) > 0).length;
  return {
    source_date: isoFromYmd(ymd),
    accepted_rows: rows.length,
    usable_rows: usableRows,
    status_counts: statusCounts,
    hard_failure_count: hardFailureCount,
    stopped_fail_threshold: attempts.some((attempt) => attempt?.status === "stopped_fail_threshold"),
  };
}

function buildOccBatchAttempt({
  attemptRef,
  attemptNumber,
  batchIndex,
  selectedTickers,
  targetYmd,
  servedYmd,
  dateAttempts,
  observedAt = isoNow(),
}) {
  const targetSourceDate = targetYmd ? isoFromYmd(targetYmd) : null;
  const servedSourceDate = servedYmd ? isoFromYmd(servedYmd) : null;
  let status = "no_selected_scope";
  if (selectedTickers > 0 && !servedSourceDate) status = "unavailable";
  else if (selectedTickers > 0 && servedSourceDate !== targetSourceDate) status = "degraded_walkback";
  else if (selectedTickers > 0) status = "ready_current";
  const targetAttempt = (dateAttempts || []).find((row) => row?.source_date === targetSourceDate) || dateAttempts?.[0] || {};
  const targetReason = `${Number(targetAttempt.usable_rows) || 0} usable rows`
    + (Number(targetAttempt.hard_failure_count) > 0 ? `; ${targetAttempt.hard_failure_count} hard failures` : "")
    + (targetAttempt.stopped_fail_threshold === true ? "; threshold stop recorded" : "");
  const message = status === "ready_current"
    ? `OCC target ${targetSourceDate} is current and served without fallback.`
    : status === "degraded_walkback"
      ? `OCC target ${targetSourceDate} was unavailable (${targetReason}); serving fallback dated ${servedSourceDate}.`
      : status === "unavailable"
        ? `OCC target ${targetSourceDate} is unavailable (${targetReason}); no fallback in the allowed window was usable.`
        : "OCC batch selected no tickers; it does not overwrite non-empty current-run evidence.";
  return {
    attempt_ref: String(attemptRef || "local"),
    attempt_number: Number(attemptNumber) || 1,
    observed_at: observedAt,
    batch_index: Number(batchIndex) || 0,
    selected_tickers: Number(selectedTickers) || 0,
    target_source_date: targetSourceDate,
    served_source_date: servedSourceDate,
    status,
    fallback_active: status === "degraded_walkback",
    message,
    date_attempts: Array.isArray(dateAttempts) ? dateAttempts : [],
  };
}

function mergeOccCurrentAttempt(previous, batchAttempt) {
  const sameRun = previous?.attempt_ref === batchAttempt.attempt_ref
    && Number(previous?.attempt_number) === Number(batchAttempt.attempt_number);
  const priorBatches = sameRun && Array.isArray(previous?.batches) ? previous.batches : [];
  const { attempt_ref, attempt_number, observed_at, ...batch } = batchAttempt;
  const byIndex = new Map(priorBatches.map((row) => [Number(row.batch_index), row]));
  byIndex.set(Number(batch.batch_index), batch);
  const batches = [...byIndex.values()].sort((a, b) => Number(a.batch_index) - Number(b.batch_index)).slice(-100);
  const nonEmpty = batches.filter((row) => Number(row.selected_tickers) > 0);
  const statusRank = { no_selected_scope: 0, ready_current: 1, degraded_walkback: 2, unavailable: 3 };
  const worst = nonEmpty.reduce((current, row) => (
    (statusRank[row.status] ?? 3) > (statusRank[current?.status] ?? -1) ? row : current
  ), null);
  const status = worst?.status || "no_selected_scope";
  const servedDates = [...new Set(nonEmpty.map((row) => row.served_source_date).filter(Boolean))].sort();
  const selectedTickers = nonEmpty.reduce((sum, row) => sum + Number(row.selected_tickers || 0), 0);
  const fallbackActive = nonEmpty.some((row) => row.status === "degraded_walkback");
  const message = status === "ready_current"
    ? `OCC target ${worst.target_source_date} is current across ${nonEmpty.length} non-empty batch(es); no fallback is active.`
    : status === "degraded_walkback"
      ? `${worst.message} Current run remains degraded across ${nonEmpty.length} non-empty batch(es).`
      : status === "unavailable"
        ? `${worst.message} Current run has an unavailable non-empty batch.`
        : "OCC current run has no selected ticker scope; prior-run data is unchanged.";
  return {
    attempt_ref,
    attempt_number,
    observed_at,
    target_source_date: worst?.target_source_date || batch.target_source_date || null,
    served_source_date: status === "unavailable" ? null : servedDates[0] || null,
    status,
    fallback_active: fallbackActive,
    selected_tickers: selectedTickers,
    message,
    batch_retention_limit: 100,
    batches,
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

function buildAvailabilitySnapshot({ ymd, generatedAt, universe, sideAttempts, tickerAvailability, requestBudget }) {
  return {
    schema_version: "fenok-occ-options-availability/v0.1",
    generated_at: generatedAt,
    formula_version: FORMULA_VERSION,
    purpose: "Derived OCC availability evidence. No raw CSV rows or private cache paths.",
    raw_policy: {
      raw_cache_public: false,
      raw_rows_included: false,
      private_artifact_paths_included: false,
    },
    source_date: ymd,
    collection_mode: universe.mode,
    selected_tickers: universe.tickers.length,
    eligible_count: universe.eligible_count,
    request_budget: requestBudget,
    side_attempts: sideAttempts,
    rows: tickerAvailability,
  };
}

function mergeAvailabilitySnapshot(previous, snapshot) {
  const existingRows = Array.isArray(previous?.rows) ? previous.rows : [];
  const incomingKeys = new Set(snapshot.rows.map((row) => `${row.ticker}|${row.source_date}|${row.attempted_forms.join("+")}`));
  const keptRows = existingRows.filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}|${(row.attempted_forms ?? []).join("+")}`));
  const existingSideAttempts = Array.isArray(previous?.side_attempts) ? previous.side_attempts : [];
  const incomingSideKeys = new Set(snapshot.side_attempts.map((row) => `${row.ticker}|${row.source_date}|${row.side}|${row.attempted_form}`));
  const keptSideAttempts = existingSideAttempts.filter((row) => !incomingSideKeys.has(`${row.ticker}|${row.source_date}|${row.side}|${row.attempted_form}`));
  const mergedRows = [...keptRows, ...snapshot.rows].sort((a, b) => (
    String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
  ));
  const mergedSideAttempts = [...keptSideAttempts, ...snapshot.side_attempts].sort((a, b) => (
    String(a.ticker).localeCompare(String(b.ticker))
    || String(a.source_date).localeCompare(String(b.source_date))
    || String(a.side).localeCompare(String(b.side))
  ));
  const retained = retainLatestTickerSourceDates({
    rows: mergedRows,
    side_attempts: mergedSideAttempts,
  });
  const rows = retained.collections.rows;
  return {
    ...snapshot,
    ...persistenceMetadata(previous, retained.stats),
    current_attempt: snapshot.current_attempt ?? previous?.current_attempt ?? null,
    previous_generated_at: previous?.generated_at ?? null,
    upsert_policy: {
      key: ["ticker", "source_date", "attempted_forms"],
      replaced_rows: existingRows.length - keptRows.length,
      added_rows: snapshot.rows.length,
      cumulative_rows: rows.length,
    },
    side_attempts: retained.collections.side_attempts,
    rows,
  };
}

function mergeOutputSnapshot(previous, snapshot) {
  const existingRows = Array.isArray(previous?.rows) ? previous.rows.map((row) => {
    const score = scoreOptionsVolume(
      row.options_activity_proxy?.call_volume,
      row.options_activity_proxy?.put_volume,
    );
    return {
      ...row,
      options_activity_proxy: {
        ...row.options_activity_proxy,
        score_0_100: score,
        direction: directionFromOptionsVolume(score),
      },
    };
  }) : [];
  const incomingKeys = new Set(snapshot.rows.map((row) => `${row.ticker}|${row.source_date}`));
  const kept = existingRows.filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}`));
  const mergedRows = [...kept, ...snapshot.rows].sort((a, b) => (
    String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
  ));
  const retained = retainLatestTickerSourceDates({ rows: mergedRows });
  const rows = retained.collections.rows;
  return {
    ...snapshot,
    ...persistenceMetadata(previous, retained.stats),
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
  const rows = Array.isArray(history.rows) ? history.rows.map((row) => ({
    ...row,
    netOptionsProxyScore: scoreOptionsVolume(row.callVolume, row.putVolume),
  })) : [];
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
  const mergedRows = [...kept, ...incoming].sort((a, b) => (
    String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
  ));
  const retained = retainLatestTickerSourceDates({ rows: mergedRows });
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    ...persistenceMetadata(history, retained.stats),
    raw_policy: {
      third_party_raw_public: false,
      rows_are_derived_only: true,
    },
    rows: retained.collections.rows,
  };
}

function occOutputSourceAsOf(document) {
  const dates = Array.isArray(document?.rows)
    ? document.rows
      .map((row) => String(row?.source_date ?? ""))
      .filter((value) => /^\d{8}$/.test(value))
      .map(isoFromYmd)
    : [];
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function validOccOutputDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)
    || document.schema_version !== 1
    || document.formula_version !== FORMULA_VERSION
    || document.public_surface_status !== "admin_private_derived_only_public_summary_source"
    || document.raw_policy?.raw_cache_public !== false
    || document.raw_policy?.third_party_raw_public !== false
    || document.raw_policy?.full_public_mirror !== false
    || !Array.isArray(document.rows) || document.rows.length === 0) {
    return false;
  }
  if (!document.rows.every((row) => {
    const sourceDate = String(row?.source_date ?? "");
    if (!/^\d{8}$/.test(sourceDate) || row?.as_of !== isoFromYmd(sourceDate)) return false;
    try {
      assertValidSourceDate(sourceDate);
    } catch {
      return false;
    }
    return typeof row?.ticker === "string" && row.ticker.length > 0
      && Number.isFinite(row?.options_activity_proxy?.total_volume);
  })) return false;
  return occOutputSourceAsOf(document) !== null;
}

function occFreshnessMarkerPathFor(storeRepoRoot) {
  return path.join(storeRepoRoot, "data", "admin", OCC_LANE_ID, "current", `${OCC_LKG_KEY}.json`);
}

function buildOccFreshnessMarker({ candidateDocument, generatedAt }) {
  if (!validOccOutputDocument(candidateDocument)) {
    throw new Error("OCC freshness marker requires a valid public-safe derived payload");
  }
  const sourceAsOf = candidateDocument.current_attempt?.served_source_date;
  const compactSourceDate = typeof sourceAsOf === "string" ? sourceAsOf.replaceAll("-", "") : "";
  if (!["ready_current", "degraded_walkback"].includes(candidateDocument.current_attempt?.status)
    || !/^\d{8}$/.test(compactSourceDate)
    || !candidateDocument.rows.some((row) => row?.source_date === compactSourceDate)) {
    throw new Error("OCC freshness marker source date is not bound to this run's ready provider rows");
  }
  const payloadBytes = Buffer.from(`${JSON.stringify(candidateDocument, null, 2)}\n`, "utf8");
  return {
    schema_version: OCC_FRESHNESS_MARKER_SCHEMA,
    lane_id: OCC_LANE_ID,
    source_as_of: sourceAsOf,
    row_count: candidateDocument.rows.length,
    payload_sha256: createHash("sha256").update(payloadBytes).digest("hex"),
    generated_at: generatedAt,
    raw_public: false,
    public_mirror_allowed: false,
  };
}

function validOccFreshnessMarker(document) {
  return Boolean(document)
    && typeof document === "object"
    && !Array.isArray(document)
    && document.schema_version === OCC_FRESHNESS_MARKER_SCHEMA
    && document.lane_id === OCC_LANE_ID
    && typeof document.source_as_of === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(document.source_as_of)
    && Number.isFinite(Date.parse(document.source_as_of))
    && Number.isInteger(document.row_count) && document.row_count > 0
    && typeof document.payload_sha256 === "string" && /^[0-9a-f]{64}$/.test(document.payload_sha256)
    && typeof document.generated_at === "string" && document.generated_at.endsWith("Z")
    && Number.isFinite(Date.parse(document.generated_at))
    && document.raw_public === false
    && document.public_mirror_allowed === false;
}

function occFreshnessMarkerSourceAsOf(document) {
  return validOccFreshnessMarker(document) ? document.source_as_of : null;
}

function occLkgArtifactDescriptor(markerPath) {
  return {
    key: OCC_LKG_KEY,
    canonicalPath: markerPath,
    validateDocument: validOccFreshnessMarker,
    sourceAsOf: occFreshnessMarkerSourceAsOf,
  };
}

function buildOccLkgCandidate({ repoRoot: storeRepoRoot, markerPath, candidateDocument, run }) {
  const marker = buildOccFreshnessMarker({ candidateDocument, generatedAt: run.observedAt });
  const serialized = `${JSON.stringify(marker, null, 2)}\n`;
  const payloadBytes = Buffer.from(serialized, "utf8");
  const sourceAsOf = marker.source_as_of;
  const currentPath = markerPath ?? occFreshnessMarkerPathFor(storeRepoRoot);
  const currentRelativePath = path.relative(storeRepoRoot, path.resolve(currentPath)).split(path.sep).join("/");
  return {
    key: OCC_LKG_KEY,
    currentRelativePath,
    payloadBytes,
    sourceAsOf,
    validateDocument: validOccFreshnessMarker,
    deriveSourceAsOf: occFreshnessMarkerSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes,
      sourceAsOf,
      validateDocument: validOccFreshnessMarker,
      deriveSourceAsOf: occFreshnessMarkerSourceAsOf,
      candidateContainsObservation: (candidate, provider) => JSON.stringify(candidate) === JSON.stringify(provider),
      run,
    }),
  };
}

// Anchor LKG health to the newest expected US trading date in the candidate
// window. A holiday target may legitimately walk back to that date; an older
// fallback means the newest trading date is still unserved and remains a real
// failure.
function computeOccLkgOutcome({ dates, currentAttempt, candidateDocument }) {
  const tradingDates = (dates ?? []).filter((date) => isUsTradingDate(date)).sort();
  if (tradingDates.length === 0) return { kind: "expected_absence" };
  const newestTradingDate = tradingDates[tradingDates.length - 1];
  const servedSourceDate = currentAttempt?.served_source_date;
  const servedYmd = typeof servedSourceDate === "string" ? servedSourceDate.replaceAll("-", "") : "";
  const candidateAttempt = candidateDocument?.current_attempt;
  if (["ready_current", "degraded_walkback"].includes(currentAttempt?.status)
    && /^\d{8}$/.test(servedYmd)
    && servedYmd >= newestTradingDate
    && candidateAttempt?.status === currentAttempt.status
    && candidateAttempt?.served_source_date === servedSourceDate
    && validOccOutputDocument(candidateDocument)) {
    return { kind: "success", sourceAsOf: servedSourceDate, newestTradingDate };
  }
  return { kind: "failure" };
}

function applyOccLkgStore({
  repoRoot: storeRepoRoot,
  markerPath,
  candidateDocument,
  dates,
  currentAttempt,
  endpointResults,
  run,
  controlledFailure = false,
}) {
  const currentMarkerPath = markerPath ?? occFreshnessMarkerPathFor(storeRepoRoot);
  const store = new LaneLkgStore({ repoRoot: storeRepoRoot, laneId: OCC_LANE_ID });
  const artifact = occLkgArtifactDescriptor(currentMarkerPath);
  const effectiveCurrentAttempt = controlledFailure
    ? { ...currentAttempt, status: "unavailable", served_source_date: null }
    : currentAttempt;
  const effectiveCandidateDocument = controlledFailure ? null : candidateDocument;
  const effectiveEndpointResults = controlledFailure
    && !(endpointResults ?? []).some((row) => row?.controlled === true)
    ? [...(endpointResults ?? []), controlledOccFailureResult()]
    : (endpointResults ?? []);
  const outcome = computeOccLkgOutcome({
    dates,
    currentAttempt: effectiveCurrentAttempt,
    candidateDocument: effectiveCandidateDocument,
  });

  if (outcome.kind === "expected_absence") {
    return { kind: "expected_absence", updated: false };
  }
  if (outcome.kind === "failure") {
    const reduced = reduceOccEndpointResults(effectiveEndpointResults);
    // Only ACTIONABLE rows may escalate to a systemic reason. OCC answers some
    // requests with HTTP 200 carrying prose instead of CSV — "No record(s)
    // found", "Report date cannot be greater than <date>" — which parseOccCsv
    // cannot decode, so those rows carry reason "decode_error" even though
    // classifyOccEndpointResponse has already marked them expectedUnavailable.
    // reduceOccEndpointResults excludes them for exactly that reason; scanning
    // them here contradicted it and turned an ordinary provider answer into a
    // corrupt-classified hard failure that took the whole edge-daily workflow
    // down on 2026-07-21 and 07-22 (runs 29799765665, 29889729136).
    const systemicCandidates = effectiveEndpointResults.filter((row) => row?.expectedUnavailable !== true);
    const reason = controlledFailure
      ? "controlled_failure"
      : systemicLkgFailureReason(systemicCandidates.map((row) => row?.reason))
        ?? reduced.reason
        ?? "workflow_unobserved";
    const failure = store.recordFailure({ artifacts: [artifact], run, reason });
    return {
      kind: "failure",
      updated: false,
      reason,
      retrySet: failure.retrySet,
      ...classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg }),
    };
  }

  const candidate = buildOccLkgCandidate({
    repoRoot: storeRepoRoot,
    markerPath: currentMarkerPath,
    candidateDocument,
    run,
  });
  const snapshot = store.stateSnapshot();
  const priorItem = snapshot.items[OCC_LKG_KEY];
  const retryActive = priorItem?.retry === true;
  const priorSourceAsOf = priorItem?.current?.source_as_of;
  if (!retryActive && typeof priorSourceAsOf === "string"
    && Number.isFinite(Date.parse(priorSourceAsOf))
    && Date.parse(candidate.sourceAsOf) <= Date.parse(priorSourceAsOf)) {
    return { kind: "not_newer", updated: false, sourceAsOf: candidate.sourceAsOf };
  }
  if (retryActive && !isNaturalScheduleRun(run)) {
    return {
      kind: "recovery_requires_schedule",
      updated: false,
      reason: "recovery_requires_schedule",
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }

  const [decision] = store.evaluatePromotionCandidates([candidate], run);
  if (!decision.eligible) {
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
      store.recordPromotionDeferral({ artifacts: [candidate], run, reason: decision.reason });
    }
    return {
      kind: "not_promotable",
      updated: false,
      reason: decision.reason,
      degraded: true,
      corrupt: false,
      exitCode: 0,
    };
  }

  atomicWrite(currentMarkerPath, candidate.payloadBytes);
  const success = store.recordSuccess({ artifacts: [candidate], run });
  const recovered = success.state.items[OCC_LKG_KEY]?.recovered_at === run.observedAt;
  return { kind: "success", updated: true, recovered, sourceAsOf: candidate.sourceAsOf, exitCode: 0 };
}

function shouldManageOccLkg({ args, universe, selectedTickers }) {
  if (args.noWrite || args.noFetch || args.planOnly || args.date || !args.allEligible) return false;
  const selectedTickerCount = Number(selectedTickers);
  if (!Number.isInteger(selectedTickerCount) || selectedTickerCount <= 0) return false;
  const batchSize = Number(args.batchSize);
  if (!Number.isInteger(batchSize) || batchSize <= 0) return false;
  return (Number(args.batchIndex) + 1) * batchSize >= Number(universe.eligible_count);
}

function validateOccControlledFailureMode(args) {
  const incompatible = [];
  if (args.noFetch) incompatible.push("--no-fetch");
  if (args.noWrite) incompatible.push("--no-write");
  if (args.planOnly) incompatible.push("--plan-only");
  if (args.date) incompatible.push("--date");
  if (!args.allEligible) incompatible.push("--all-eligible is required");
  if (incompatible.length > 0) {
    throw new Error(`OCC controlled failure is incompatible with: ${incompatible.join(", ")}`);
  }
}

function controlledOccFailureDisposition({ args, universe, selectedTickers }) {
  const eligibleCount = Math.max(0, Number(universe?.eligible_count) || 0);
  const batchSize = Math.max(0, Number(args?.batchSize) || 0);
  const batchIndex = Math.max(0, Number(args?.batchIndex) || 0);
  const batchWindowEnd = Math.min(eligibleCount, (batchIndex + 1) * batchSize);
  const finalBatch = shouldManageOccLkg({ args, universe, selectedTickers });
  return {
    action: finalBatch ? "inject" : Number(selectedTickers) > 0 ? "defer" : "incomplete_coverage",
    final_batch: finalBatch,
    batch_window_end: batchWindowEnd,
    remaining_after_batch_window: Math.max(0, eligibleCount - batchWindowEnd),
  };
}

function controlledOccCollectionCoverage({ args, universe, selectedTickers, disposition }) {
  return {
    complete: false,
    status: "not_attempted_controlled_failure",
    eligible_count: Number(universe.eligible_count),
    selected_tickers: Number(selectedTickers),
    collected_tickers: 0,
    batch_index: Number(args.batchIndex),
    batch_size: Number(args.batchSize),
    final_batch: disposition.final_batch,
    batch_window_end: disposition.batch_window_end,
    remaining_after_batch_window: disposition.remaining_after_batch_window,
  };
}

async function build(args, {
  request = fetchResponse,
  cacheDir = OCC_CACHE_DIR,
  attemptShardPath = path.join(repoRoot, "data/admin/data-supply-state/detection-attempts/occ_options_volume.json"),
  observedAt = new Date().toISOString(),
  attemptId = stableAttemptId("occ-options-volume", observedAt),
  lkgRepoRoot = repoRoot,
  lkgMarkerPath = occFreshnessMarkerPathFor(lkgRepoRoot),
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureLanes = process.env.INPUT_CONTROLLED_FAILURE_LANES || "",
} = {}) {
  const injectedLanes = parseControlledFailureLanes(controlledFailureLanes, eventName);
  const controlledOccFailure = injectedLanes.includes(OCC_LANE_ID);
  if (controlledOccFailure) validateOccControlledFailureMode(args);
  const universe = resolveTickerUniverse(args);
  const tickers = universe.tickers;
  const dates = candidateDates({ requestedDate: args.date, maxWalkbackDays: args.maxWalkbackDays });
  const manageLkg = shouldManageOccLkg({ args, universe, selectedTickers: tickers.length });
  const run = {
    runId: String(runId),
    runAttempt: Number(runAttempt),
    eventName,
    observedAt,
  };
  const estimatedMaxLiveRequests = estimateMaxLiveRequests({ tickers, dates });
  if (controlledOccFailure) {
    const disposition = controlledOccFailureDisposition({
      args,
      universe,
      selectedTickers: tickers.length,
    });
    const collectionCoverage = controlledOccCollectionCoverage({
      args,
      universe,
      selectedTickers: tickers.length,
      disposition,
    });
    if (disposition.action !== "inject") {
      return {
        controlled_failure: true,
        injection_applied: false,
        status: disposition.action === "defer" ? "deferred" : "incomplete_coverage",
        reason: disposition.action === "defer"
          ? "controlled_failure_deferred_until_final_all_eligible_batch"
          : "controlled_failure_not_applied_empty_or_out_of_range_batch",
        wrote: false,
        source_artifacts_written: false,
        recovery_state_written: false,
        collection_coverage: collectionCoverage,
      };
    }

    const controlledResult = controlledOccFailureResult();
    const currentAttempt = {
      attempt_ref: String(run.runId),
      attempt_number: Number(run.runAttempt),
      observed_at: run.observedAt,
      target_source_date: isoFromYmd(dates[0]),
      served_source_date: null,
      status: "unavailable",
      fallback_active: false,
      selected_tickers: tickers.length,
      message: "owner-approved workflow_dispatch OCC controlled failure",
      batch_retention_limit: 100,
      batches: [],
    };
    const lkgRecovery = applyOccLkgStore({
      repoRoot: lkgRepoRoot,
      markerPath: lkgMarkerPath,
      candidateDocument: null,
      dates,
      currentAttempt,
      endpointResults: [controlledResult],
      run,
      controlledFailure: true,
    });
    writeMergedAttemptShard({
      laneId: OCC_LANE_ID,
      attemptShardPath,
      observedAt,
      attemptId,
      result: controlledResult,
    });
    if (lkgRecovery?.corrupt) {
      throw new Error(`OCC controlled failure requires a valid retained marker/LKG seed: ${lkgRecovery.reason}`);
    }
    const injectionApplied = lkgRecovery?.kind === "failure";
    return {
      controlled_failure: true,
      injection_applied: injectionApplied,
      status: injectionApplied ? "recorded" : "not_recorded",
      reason: injectionApplied ? "controlled_failure" : lkgRecovery?.kind ?? "controlled_failure_not_recorded",
      wrote: false,
      source_artifacts_written: false,
      recovery_state_written: injectionApplied,
      collection_coverage: collectionCoverage,
      lkg_recovery: lkgRecovery,
    };
  }
  if (args.planOnly) {
    return {
      plan_only: true,
      schema_version: SCHEMA_VERSION,
      formula_version: FORMULA_VERSION,
      collection_mode: universe.mode,
      eligible_count: universe.eligible_count,
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
      raw_cache_dir: path.relative(repoRoot, cacheDir),
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      availability_file: `data/${AVAILABILITY_FILE}`,
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

  const endpointResults = [];
  try {
    if (!args.noFetch && args.maxRequests > 0 && estimatedMaxLiveRequests > args.maxRequests) {
      throw new Error(`OCC request budget exceeded: estimated ${estimatedMaxLiveRequests}, max ${args.maxRequests}. Use --plan-only, smaller --batch-size, or explicit approval.`);
    }

    const dateAttempts = [];
    for (const ymd of dates) {
      const result = await loadRowsForDate({
      ymd,
      tickers,
      noFetch: args.noFetch,
      sleepMs: args.sleepMs,
      failThreshold: args.failThreshold,
      request,
      cacheDir,
      });
      endpointResults.push(...result.endpoint_results);
      dateAttempts.push(summarizeDateAttempt(result));
      const availabilitySnapshot = buildAvailabilitySnapshot({
      ymd,
      generatedAt: isoNow(),
      universe,
      sideAttempts: result.side_attempts,
      tickerAvailability: result.ticker_availability,
      requestBudget: {
        estimated_max_live_requests: estimatedMaxLiveRequests,
        max_requests: args.maxRequests || null,
      },
    });
      const availability = mergeAvailabilitySnapshot(readJson(AVAILABILITY_FILE, null), availabilitySnapshot);
      if (!args.noWrite && (result.side_attempts.length > 0 || result.ticker_availability.length > 0)) {
        writeJson(AVAILABILITY_FILE, availability);
      }
      const usableRows = result.rows.filter((row) => row.options_activity_proxy.total_volume > 0);
      if (usableRows.length === 0) {
        if (args.maxWalkbackDays === 0 || ymd === dates.at(-1)) {
        const batchAttempt = buildOccBatchAttempt({
          attemptRef: process.env.GITHUB_RUN_ID || "local",
          attemptNumber: process.env.GITHUB_RUN_ATTEMPT || 1,
          batchIndex: args.batchIndex,
          selectedTickers: tickers.length,
          targetYmd: dates[0],
          servedYmd: null,
          dateAttempts,
        });
        const currentAttempt = mergeOccCurrentAttempt(availability.current_attempt, batchAttempt);
        const previousOutput = readJson(OUTPUT_FILE, null);
        const candidateDocument = previousOutput
          ? { ...previousOutput, current_attempt: currentAttempt }
          : null;
        const lkgRecovery = manageLkg
          ? applyOccLkgStore({
            repoRoot: lkgRepoRoot,
            markerPath: lkgMarkerPath,
            candidateDocument,
            dates,
            currentAttempt,
            endpointResults,
            run,
          })
          : null;
        if (lkgRecovery?.corrupt) {
          reportOccCorruptFailure({ reason: lkgRecovery.reason, endpointResults });
          throw new Error(`OCC LKG failure is corrupt: ${lkgRecovery.reason}`);
        }
        let wrote = false;
        if (!args.noWrite && tickers.length > 0) {
          writeJson(AVAILABILITY_FILE, { ...availability, current_attempt: currentAttempt });
          if (previousOutput) {
            writeJson(OUTPUT_FILE, {
              ...previousOutput,
              current_attempt: mergeOccCurrentAttempt(previousOutput.current_attempt, batchAttempt),
            });
          }
          wrote = true;
        }
        if (lkgRecovery?.updated) wrote = true;
        if (currentAttempt.status === "unavailable") console.log(`::warning:: ${currentAttempt.message}`);
          return {
          output_file: `data/${OUTPUT_FILE}`,
          history_file: `data/${HISTORY_FILE}`,
          availability_file: `data/${AVAILABILITY_FILE}`,
          wrote,
          no_usable_rows: true,
          occ_source_date: ymd,
          availability_policy: OCC_AVAILABILITY_POLICY,
          coverage: buildCoverage([], result.attempts),
          collection_mode: universe.mode,
          selected_tickers: tickers.length,
          request_budget: {
            estimated_max_live_requests: estimatedMaxLiveRequests,
            max_requests: args.maxRequests || null,
          },
          date_attempts: dateAttempts,
          current_attempt: currentAttempt,
          lkg_recovery: lkgRecovery,
          availability_summary: {
            rows: availability.rows.length,
            latest_status_counts: availability.rows.reduce((acc, row) => {
              acc[row.status] = (acc[row.status] ?? 0) + 1;
              return acc;
            }, {}),
          },
          };
        }
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
      const batchAttempt = buildOccBatchAttempt({
      attemptRef: process.env.GITHUB_RUN_ID || "local",
      attemptNumber: process.env.GITHUB_RUN_ATTEMPT || 1,
      batchIndex: args.batchIndex,
      selectedTickers: tickers.length,
      targetYmd: dates[0],
      servedYmd: ymd,
      dateAttempts,
    });
      const previousOutput = readJson(OUTPUT_FILE, null);
      snapshot.current_attempt = mergeOccCurrentAttempt(previousOutput?.current_attempt, batchAttempt);
      const outputSnapshot = mergeOutputSnapshot(previousOutput, snapshot);
      const availabilityWithAttempt = {
      ...availability,
      current_attempt: mergeOccCurrentAttempt(availability.current_attempt, batchAttempt),
    };
      const history = mergeHistory(outputSnapshot);
      const lkgRecovery = manageLkg
        ? applyOccLkgStore({
          repoRoot: lkgRepoRoot,
          markerPath: lkgMarkerPath,
          candidateDocument: outputSnapshot,
          dates,
          currentAttempt: outputSnapshot.current_attempt,
          endpointResults,
          run,
        })
        : null;
      if (lkgRecovery?.corrupt) {
        reportOccCorruptFailure({
          reason: lkgRecovery.reason,
          endpointResults,
          batchIndex: args.batchIndex,
        });
        throw new Error(`OCC LKG failure is corrupt: ${lkgRecovery.reason}`);
      }
      if (!args.noWrite) {
        writeJson(OUTPUT_FILE, outputSnapshot);
        writeJson(HISTORY_FILE, history);
        writeJson(AVAILABILITY_FILE, availabilityWithAttempt);
      }
      if (outputSnapshot.current_attempt.status === "degraded_walkback") {
        console.log(`::warning:: ${outputSnapshot.current_attempt.message}`);
      }
      return {
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      availability_file: `data/${AVAILABILITY_FILE}`,
      wrote: !args.noWrite,
      occ_source_date: ymd,
      availability_policy: OCC_AVAILABILITY_POLICY,
      coverage: outputSnapshot.coverage,
      batch_coverage: snapshot.coverage,
      collection_mode: universe.mode,
      selected_tickers: tickers.length,
      request_budget: {
        estimated_max_live_requests: estimatedMaxLiveRequests,
        max_requests: args.maxRequests || null,
      },
      date_attempts: dateAttempts,
      current_attempt: outputSnapshot.current_attempt,
      lkg_recovery: lkgRecovery,
      reference_rows: outputSnapshot.rows.filter((row) => DEFAULT_REFERENCE_TICKERS.includes(row.ticker)),
      };
    }
    throw new Error(`No OCC option volume rows available in requested window: ${JSON.stringify(dateAttempts)}`);
  } finally {
    writeMergedAttemptShard({
      laneId: "occ_options_volume",
      attemptShardPath,
      observedAt,
      attemptId,
      result: reduceOccEndpointResults(endpointResults),
    });
  }
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
  applyOccLkgStore,
  applyTickerBatch,
  build,
  buildOccFreshnessMarker,
  buildOccLkgCandidate,
  buildOccBatchAttempt,
  buildCoverage,
  buildAvailabilitySnapshot,
  buildRowsForTest,
  candidateDates,
  classifyOccEndpointResponse,
  controlledOccFailureDisposition,
  directionFromOptionsVolume,
  estimateMaxLiveRequests,
  loadAllEligibleUniverse,
  loadS0OccClassShareUniverse,
  loadS0OccMissingUniverse,
  loadS0OccPartialMissingUniverse,
  mergeAvailabilitySnapshot,
  mergeOccCurrentAttempt,
  mergeOutputSnapshot,
  OCC_AVAILABILITY_POLICY,
  OCC_FRESHNESS_MARKER_SCHEMA,
  OCC_LANE_ID,
  OCC_LKG_KEY,
  OCC_PERSISTENCE_POLICY,
  occFreshnessMarkerPathFor,
  occFreshnessMarkerSourceAsOf,
  occOutputSourceAsOf,
  parseOccCsv,
  parseControlledFailureLanes,
  parseArgs,
  reduceOccEndpointResults,
  retainLatestTickerSourceDates,
  scoreOptionsLogRatio,
  scoreOptionsVolume,
  shouldManageOccLkg,
  summarizeTickerAvailability,
  summarizeDateAttempt,
  validOccFreshnessMarker,
  validOccOutputDocument,
};

function buildRowsForTest({ ticker, ymd, callCsv, putCsv, callStatus = "loaded", putStatus = "loaded" }) {
  return buildTickerRow({
    ticker,
    ymd,
    callLoad: { text: callCsv, cache_path: "_private/test/C.csv" },
    putLoad: { text: putCsv, cache_path: "_private/test/P.csv" },
    callEvidence: { status: callStatus },
    putEvidence: { status: putStatus },
  });
}
