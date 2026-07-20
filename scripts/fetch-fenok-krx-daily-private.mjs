#!/usr/bin/env node
/**
 * Private/admin Korea KRX daily fetcher.
 *
 * Raw KRX Open API payloads stay under _private/admin. The tracked bridge index
 * contains counts, private path references, and public-safe derived RIM inputs
 * only; it must never carry raw KRX rows.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const MARKET = "Korea";
const SOURCE = "KRX_OPEN_API";
const BASE_URL = "https://data-dbg.krx.co.kr/svc/apis";
const SCRIPT_PATH = "scripts/fetch-fenok-krx-daily-private.mjs";
const BRIDGE_INDEX_DEFAULT = "data/admin/fenok-edge-korea-krx-daily-index.json";
// Slice 1 public-safe surface: aggregate index-level daily closes only (no
// per-issuer rows). Public serving authorized by the owner's 2026-07-19 KRX
// permission grant. data/computed/ is served by the public sync/mirror pipeline.
const PUBLIC_INDEX_CLOSES_DEFAULT = "data/computed/fenok-edge-korea-krx-index-daily.json";
// Slice 2 public-safe surface: one KOSDAQ market-level concentration aggregate.
// It intentionally contains no issuer rows, codes, names, or private paths.
const PUBLIC_KOSDAQ_MARKET_CAP_DEFAULT = "data/computed/fenok-edge-korea-krx-kosdaq-market-cap-aggregate.json";
const PUBLIC_KOSDAQ_TOP_N = 10;
// Index (idx) endpoints whose aggregate rows are public-safe. Per-issuer
// endpoints are deliberately excluded from the public surface.
const PUBLIC_INDEX_ENDPOINTS = [
  { api_id: "krx_dd_trd", market: "KRX_ALL" },
  { api_id: "kospi_dd_trd", market: "KOSPI" },
  { api_id: "kosdaq_dd_trd", market: "KOSDAQ" },
];
const DEFAULT_OUTPUT_PARENT = "_private/admin/fenok-edge-korea/daily";
const DEFAULT_DAYS = 1;
const FULL_TARGET_TRADING_DAYS = 252;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_SLEEP_MS = 250;
const DEFAULT_MAX_CALLS = 40;
const DEFAULT_FAIL_THRESHOLD = 0;
const LICENSE_OR_TERMS_NOTE =
  "KRX usage permission granted by owner 2026-07-19; public serving of derived/aggregate surfaces authorized; raw per-issuer row redistribution still governed per-slice.";
const SNAPSHOT_ENDPOINTS = new Set(["sri_bond_info", "esg_index_info", "esg_etp_info"]);
const REQUIRED_DAILY_ISSUER_ENDPOINTS = new Set(["stk_bydd_trd", "ksq_bydd_trd"]);

const ENDPOINT_GROUPS = [
  {
    group: "core_stock_index",
    normalized_score_axis: "price_volume_index_liquidity",
    endpoints: [
      { api_id: "krx_dd_trd", category: "idx", source_role: "KRX all-market index daily" },
      { api_id: "kospi_dd_trd", category: "idx", source_role: "KOSPI index daily" },
      { api_id: "kosdaq_dd_trd", category: "idx", source_role: "KOSDAQ index daily" },
      { api_id: "stk_bydd_trd", category: "sto", source_role: "KOSPI stock daily trade" },
      { api_id: "ksq_bydd_trd", category: "sto", source_role: "KOSDAQ stock daily trade" },
      { api_id: "stk_isu_base_info", category: "sto", source_role: "KOSPI issuer master" },
      { api_id: "ksq_isu_base_info", category: "sto", source_role: "KOSDAQ issuer master" },
      { api_id: "knx_bydd_trd", category: "sto", source_role: "KONEX stock daily trade" },
      { api_id: "knx_isu_base_info", category: "sto", source_role: "KONEX issuer master" },
    ],
  },
  {
    group: "derivatives_products",
    normalized_score_axis: "derivatives_etp_risk_appetite",
    endpoints: [
      { api_id: "etf_bydd_trd", category: "etp", source_role: "ETF daily trade" },
      { api_id: "etn_bydd_trd", category: "etp", source_role: "ETN daily trade" },
      { api_id: "elw_bydd_trd", category: "etp", source_role: "ELW daily trade" },
      { api_id: "fut_bydd_trd", category: "drv", source_role: "index futures daily trade" },
      { api_id: "eqsfu_stk_bydd_trd", category: "drv", source_role: "single-stock futures daily trade" },
      { api_id: "eqkfu_ksq_bydd_trd", category: "drv", source_role: "KOSDAQ futures daily trade" },
      { api_id: "opt_bydd_trd", category: "drv", source_role: "index options daily trade" },
      { api_id: "eqsop_bydd_trd", category: "drv", source_role: "single-stock options daily trade" },
      { api_id: "eqkop_bydd_trd", category: "drv", source_role: "KOSDAQ options daily trade" },
      { api_id: "drvprod_dd_trd", category: "idx", source_role: "derivatives product index daily" },
    ],
  },
  {
    group: "bond_commodity_esg",
    normalized_score_axis: "rates_credit_commodity_esg_overlay",
    endpoints: [
      { api_id: "bon_dd_trd", category: "idx", source_role: "bond index daily" },
      { api_id: "kts_bydd_trd", category: "bon", source_role: "KTS bond daily trade" },
      { api_id: "bnd_bydd_trd", category: "bon", source_role: "bond daily trade" },
      { api_id: "smb_bydd_trd", category: "bon", source_role: "small bond daily trade" },
      { api_id: "sri_bond_info", category: "esg", source_role: "SRI bond info snapshot" },
      { api_id: "sw_bydd_trd", category: "sto", source_role: "warrant daily trade" },
      { api_id: "sr_bydd_trd", category: "sto", source_role: "subscription right daily trade" },
      { api_id: "oil_bydd_trd", category: "gen", source_role: "oil daily trade" },
      { api_id: "gold_bydd_trd", category: "gen", source_role: "gold daily trade" },
      { api_id: "ets_bydd_trd", category: "gen", source_role: "ETS daily trade" },
      { api_id: "esg_index_info", category: "esg", source_role: "ESG index info snapshot" },
      { api_id: "esg_etp_info", category: "esg", source_role: "ESG ETP info snapshot" },
    ],
  },
];

function usage() {
  return [
    "Usage: node scripts/fetch-fenok-krx-daily-private.mjs [options]",
    "",
    "Options:",
    "  --end-date YYYYMMDD              KRX basDd end date. Default: latest KST weekday.",
    "  --days N                         Weekday count. Default: 1.",
    "  --run-id ID                      Run id. Default: krx_daily_<end-date>.",
    "  --output-root PATH               Private output root. Default: _private/admin/fenok-edge-korea/daily/<run-id>.",
    "  --bridge-index PATH              Tracked bridge index path. Default: data/admin/fenok-edge-korea-krx-daily-index.json",
    "  --public-index-closes PATH       Public-safe aggregate index closes path. Default: data/computed/fenok-edge-korea-krx-index-daily.json.",
    "  --public-kosdaq-market-cap PATH  Public-safe KOSDAQ top-10 market-cap aggregate path.",
    "  --concurrency N                  Bounded request concurrency. Default: 2.",
    "  --timeout-ms N                   Per request timeout. Default: 30000.",
    "  --sleep-ms N                     Sleep after each request attempt. Default: 250.",
    "  --max-calls N                    Hard call budget. Default: 40.",
    "  --fail-threshold N               Allowed failed files. Default: 0.",
    "  --plan-only                      Print plan only; no credential, network, or writes.",
    "  --no-fetch                       Use existing private raw files only.",
    "  --no-write                       Do not write raw/manifests/bridge index.",
    "  --allow-large-run                Allow calls above --max-calls.",
    "  --allow-empty-daily              Do not fail on empty KOSPI/KOSDAQ daily issuer rows.",
    "  --scheduled-run                  Mark bridge index as cron-installed.",
  ].join("\n");
}

function parseBooleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null) return fallback;
  return /^(1|true|yes)$/i.test(value);
}

function readFlag(argv, i) {
  const arg = argv[i];
  const key = arg.slice(2);
  const value = argv[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
  return [key, value, i + 1];
}

function parseArgs(argv) {
  const args = {
    allowEmptyDaily: parseBooleanEnv("KRX_ALLOW_EMPTY_DAILY", false),
    allowLargeRun: parseBooleanEnv("KRX_ALLOW_LARGE_RUN", false),
    bridgeIndex: process.env.KRX_BRIDGE_INDEX || BRIDGE_INDEX_DEFAULT,
    concurrency: Number.parseInt(process.env.KRX_CONCURRENCY || String(DEFAULT_CONCURRENCY), 10),
    days: Number.parseInt(process.env.KRX_DAYS || String(DEFAULT_DAYS), 10),
    endDate: process.env.KRX_END_DATE || "",
    failThreshold: Number.parseInt(process.env.KRX_FAIL_THRESHOLD || String(DEFAULT_FAIL_THRESHOLD), 10),
    maxCalls: Number.parseInt(process.env.KRX_MAX_CALLS || String(DEFAULT_MAX_CALLS), 10),
    noFetch: parseBooleanEnv("KRX_NO_FETCH", false),
    noWrite: parseBooleanEnv("KRX_NO_WRITE", false),
    outputRoot: process.env.KRX_OUTPUT_ROOT || "",
    publicKosdaqMarketCap: process.env.KRX_PUBLIC_KOSDAQ_MARKET_CAP || PUBLIC_KOSDAQ_MARKET_CAP_DEFAULT,
    planOnly: parseBooleanEnv("KRX_PLAN_ONLY", false),
    runId: process.env.KRX_RUN_ID || "",
    scheduledRun: parseBooleanEnv("KRX_SCHEDULED_RUN", false),
    sleepMs: Number.parseInt(process.env.KRX_SLEEP_MS || String(DEFAULT_SLEEP_MS), 10),
    timeoutMs: Number.parseInt(process.env.KRX_TIMEOUT_MS || String(DEFAULT_REQUEST_TIMEOUT_MS), 10),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--allow-empty-daily") args.allowEmptyDaily = true;
    else if (arg === "--allow-large-run") args.allowLargeRun = true;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--scheduled-run") args.scheduledRun = true;
    else if (arg.startsWith("--")) {
      const [key, value, nextIndex] = readFlag(argv, i);
      i = nextIndex;
      if (key === "bridge-index") args.bridgeIndex = value;
      else if (key === "public-index-closes") args.publicIndexCloses = value;
      else if (key === "public-kosdaq-market-cap") args.publicKosdaqMarketCap = value;
      else if (key === "concurrency") args.concurrency = Number.parseInt(value, 10);
      else if (key === "days") args.days = Number.parseInt(value, 10);
      else if (key === "end-date") args.endDate = value;
      else if (key === "fail-threshold") args.failThreshold = Number.parseInt(value, 10);
      else if (key === "max-calls") args.maxCalls = Number.parseInt(value, 10);
      else if (key === "output-root") args.outputRoot = value;
      else if (key === "run-id") args.runId = value;
      else if (key === "sleep-ms") args.sleepMs = Number.parseInt(value, 10);
      else if (key === "timeout-ms") args.timeoutMs = Number.parseInt(value, 10);
      else throw new Error(`Unknown argument: ${arg}`);
    } else {
      throw new Error(`Unknown positional argument: ${arg}`);
    }
  }

  return args;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertBasDd(value, label) {
  if (!/^\d{8}$/.test(String(value ?? ""))) throw new Error(`${label} must be YYYYMMDD: ${value}`);
}

function normalizeBasDd(value, label = "date") {
  const raw = String(value ?? "").trim().replaceAll("-", "");
  assertBasDd(raw, label);
  return raw;
}

function addDaysBasDd(basDd, deltaDays) {
  assertBasDd(basDd, "basDd");
  const date = new Date(Date.UTC(Number(basDd.slice(0, 4)), Number(basDd.slice(4, 6)) - 1, Number(basDd.slice(6, 8))));
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
}

function isWeekdayBasDd(basDd) {
  const date = new Date(Date.UTC(Number(basDd.slice(0, 4)), Number(basDd.slice(4, 6)) - 1, Number(basDd.slice(6, 8))));
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function latestKstWeekday(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  let cursor = fmt.format(now).replaceAll("-", "");
  while (!isWeekdayBasDd(cursor)) cursor = addDaysBasDd(cursor, -1);
  return cursor;
}

function generateWeekdayDates(endDate, days) {
  const normalizedEnd = normalizeBasDd(endDate, "end-date");
  if (!Number.isInteger(days) || days < 1) throw new Error(`days must be a positive integer: ${days}`);
  const dates = [];
  let cursor = normalizedEnd;
  while (dates.length < days) {
    if (isWeekdayBasDd(cursor)) dates.push(cursor);
    cursor = addDaysBasDd(cursor, -1);
  }
  return dates.reverse();
}

function isoDate(basDd) {
  return `${basDd.slice(0, 4)}-${basDd.slice(4, 6)}-${basDd.slice(6, 8)}`;
}

function resolveRepoPath(value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(REPO_ROOT, value);
}

function repoRel(value) {
  const abs = path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
  return path.relative(REPO_ROOT, abs).split(path.sep).join("/");
}

function endpointClass(apiId) {
  if (apiId.endsWith("_isu_base_info") || SNAPSHOT_ENDPOINTS.has(apiId)) return "snapshot";
  return "daily-history";
}

function endpointList() {
  return ENDPOINT_GROUPS.flatMap((group) =>
    group.endpoints.map((endpoint) => ({
      ...endpoint,
      endpoint_class: endpointClass(endpoint.api_id),
      group: group.group,
      normalized_score_axis: group.normalized_score_axis,
    })),
  );
}

function buildTasks(dates) {
  return endpointList().flatMap((endpoint) => dates.map((basDd) => ({ basDd, endpoint })));
}

function sanitizedUrl(endpoint, basDd) {
  return `${BASE_URL}/${endpoint.category}/${endpoint.api_id}?basDd=${basDd}`;
}

function getRowCount(data) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return 0;
  return Object.values(data).reduce((maxRows, value) => (Array.isArray(value) ? Math.max(maxRows, value.length) : maxRows), 0);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value) {
  const num = Number(value);
  return finite(num) ? num : null;
}

function round(value, digits = 6) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function compactDate(value) {
  const compact = String(value ?? "").replaceAll("-", "");
  return /^\d{8}$/.test(compact) ? compact : null;
}

function readOptionalJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hasKrErrorPayload(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  return Object.prototype.hasOwnProperty.call(data, "respCode") || Object.prototype.hasOwnProperty.call(data, "respMsg");
}

function shortErrorMessage(error) {
  return String(error && error.message ? error.message : error).slice(0, 240);
}

function buildConfig(rawArgs) {
  const endDate = normalizeBasDd(rawArgs.endDate || latestKstWeekday(), "end-date");
  const runId = rawArgs.runId || `krx_daily_${endDate}`;
  const outputRoot = resolveRepoPath(rawArgs.outputRoot || path.join(DEFAULT_OUTPUT_PARENT, runId));
  const bridgeIndexPath = resolveRepoPath(rawArgs.bridgeIndex || BRIDGE_INDEX_DEFAULT);
  const publicIndexClosesPath = resolveRepoPath(rawArgs.publicIndexCloses || PUBLIC_INDEX_CLOSES_DEFAULT);
  const publicKosdaqMarketCapPath = resolveRepoPath(rawArgs.publicKosdaqMarketCap || PUBLIC_KOSDAQ_MARKET_CAP_DEFAULT);
  const dates = generateWeekdayDates(endDate, rawArgs.days);
  const endpoints = endpointList();
  const estimatedCalls = dates.length * endpoints.length;
  const requestBudget = {
    estimated_daily_calls: endpoints.length,
    estimated_calls: estimatedCalls,
    estimated_full_252_calls: FULL_TARGET_TRADING_DAYS * endpoints.length,
    max_calls_per_run: rawArgs.maxCalls,
    status: rawArgs.allowLargeRun || estimatedCalls <= rawArgs.maxCalls ? "within_budget" : "blocked_over_budget",
    concurrency_default: DEFAULT_CONCURRENCY,
    concurrency_used: rawArgs.concurrency,
    sleep_ms_between_attempts: rawArgs.sleepMs,
    timeout_ms_default: DEFAULT_REQUEST_TIMEOUT_MS,
    timeout_ms_used: rawArgs.timeoutMs,
    credential_source: "KRX_OPEN_API_AUTH_KEY env only",
  };

  if (!Number.isInteger(rawArgs.concurrency) || rawArgs.concurrency < 1) throw new Error(`concurrency must be a positive integer: ${rawArgs.concurrency}`);
  if (!Number.isInteger(rawArgs.timeoutMs) || rawArgs.timeoutMs < 1000) throw new Error(`timeout-ms must be >= 1000: ${rawArgs.timeoutMs}`);
  if (!Number.isInteger(rawArgs.sleepMs) || rawArgs.sleepMs < 0) throw new Error(`sleep-ms must be >= 0: ${rawArgs.sleepMs}`);
  if (!Number.isInteger(rawArgs.maxCalls) || rawArgs.maxCalls < 1) throw new Error(`max-calls must be >= 1: ${rawArgs.maxCalls}`);
  if (!Number.isInteger(rawArgs.failThreshold) || rawArgs.failThreshold < 0) throw new Error(`fail-threshold must be >= 0: ${rawArgs.failThreshold}`);

  return {
    ...rawArgs,
    bridgeIndexPath,
    publicIndexClosesPath,
    publicKosdaqMarketCapPath,
    dates,
    endDate,
    endpoints,
    estimatedCalls,
    outputRoot,
    requestBudget,
    runId,
  };
}

function dailyCommandTemplate() {
  return [
    "KRX_END_DATE=YYYYMMDD",
    "KRX_DAYS=1",
    "KRX_RUN_ID=krx_daily_YYYYMMDD",
    `KRX_BRIDGE_INDEX=${BRIDGE_INDEX_DEFAULT}`,
    `node ${SCRIPT_PATH}`,
  ].join(" ");
}

function batchCommandTemplate({ endDate = "YYYYMMDD", days = 20, runId = "krx_backfill_20d_YYYYMMDD" } = {}) {
  return [
    `KRX_END_DATE=${endDate}`,
    `KRX_DAYS=${days}`,
    `KRX_RUN_ID=${runId}`,
    `KRX_OUTPUT_ROOT=${path.join(DEFAULT_OUTPUT_PARENT, runId)}`,
    `KRX_BRIDGE_INDEX=${BRIDGE_INDEX_DEFAULT}`,
    `node ${SCRIPT_PATH}`,
  ].join(" ");
}

function dataAdminBridgeRef(bridgeIndexPath) {
  const rel = repoRel(bridgeIndexPath);
  if (!rel.startsWith("data/")) {
    return {
      category: null,
      file: null,
      note: "Bridge index is outside data/; read by explicit path.",
    };
  }
  const [, category, ...rest] = rel.split("/");
  return {
    category,
    file: rest.join("/"),
    jq_example: `jq '{as_of, freshness, latest_run, normalized_score_candidates}' \"$DATA_ROOT/${category}/${rest.join("/")}\"`,
  };
}

async function fetchJson(endpoint, basDd, authKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(sanitizedUrl(endpoint, basDd), {
      method: "GET",
      signal: controller.signal,
      headers: {
        AUTH_KEY: authKey,
        "User-Agent": "Mozilla/5.0 fenok-krx-private-fetcher/1.0",
      },
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { parse_error: "non_json_response", body_preview: text.slice(0, 200) };
    }
    if (!response.ok) {
      return { data, error: `HTTP ${response.status}`, http_status: response.status, row_count: 0, status: "failed" };
    }
    if (hasKrErrorPayload(data)) {
      return { data, error: "KRX error payload", http_status: response.status, row_count: 0, status: "failed" };
    }
    const rowCount = getRowCount(data);
    return { data, http_status: response.status, row_count: rowCount, status: rowCount > 0 ? "success" : "empty" };
  } finally {
    clearTimeout(timer);
  }
}

function readCachedRaw(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const rowCount = getRowCount(data);
    return { data, http_status: null, row_count: rowCount, source_kind: "private_raw_cache", status: rowCount > 0 ? "success" : "empty" };
  } catch (error) {
    return {
      data: { error: `raw cache missing under --no-fetch: ${repoRel(filePath)}` },
      error: shortErrorMessage(error),
      http_status: null,
      row_count: 0,
      source_kind: "cache_missing_no_fetch",
      status: "failed",
    };
  }
}

async function runLimited(tasks, limit, sleepMs, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(tasks[currentIndex], currentIndex);
      if (sleepMs > 0) await sleep(sleepMs);
    }
  });
  await Promise.all(workers);
}

function emptySummary() {
  return {
    total_files: 0,
    success_files: 0,
    empty_files: 0,
    failed_files: 0,
    total_rows: 0,
    failed_reasons: {},
  };
}

function addSummary(summary, result) {
  summary.total_files += 1;
  summary[`${result.status}_files`] += 1;
  summary.total_rows += result.row_count || 0;
  if (result.status === "failed") {
    const key = result.error || "unknown";
    summary.failed_reasons[key] = (summary.failed_reasons[key] || 0) + 1;
  }
}

function countEndpointClasses(files) {
  return files.reduce((acc, file) => {
    const key = file.endpoint_class || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function normalizedScoreCandidates() {
  return ENDPOINT_GROUPS.map((group) => ({
    axis: group.normalized_score_axis,
    source: `${SOURCE}:${group.group}`,
    endpoint_count: group.endpoints.length,
    caveat:
      group.group === "core_stock_index"
        ? "Daily price/index rows are strong scoring inputs; issuer-master endpoints are snapshots and need as-of handling."
        : group.group === "derivatives_products"
          ? "Derivatives and ETP flow can support risk-appetite overlays; option series granularity requires aggregation before scoring."
          : "Bond, commodity, warrant, rights, and ESG snapshots are overlays; some endpoints are low-row or reference-like and should not be treated as full daily issuer panels.",
  }));
}

function endpointClassMap() {
  return endpointList().map((endpoint) => ({
    group: endpoint.group,
    api_id: endpoint.api_id,
    category: endpoint.category,
    axis: endpoint.normalized_score_axis,
    source_role: endpoint.source_role,
    endpoint_class: endpoint.endpoint_class,
    url_shape: `${BASE_URL}/${endpoint.category}/${endpoint.api_id}?basDd={YYYYMMDD}`,
  }));
}

function buildKrxKospiDerivedWeights(manifest, config) {
  const asOf = manifest?.date_range?.end_date;
  const dateKey = compactDate(asOf);
  if (!dateKey) return null;
  const sourcePath = path.join(config.outputRoot, "raw", "core_stock_index", "stk_bydd_trd", `${dateKey}.json`);
  const payload = readOptionalJson(sourcePath);
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const kospiRows = rows
    .filter((row) => row?.MKT_NM === "KOSPI")
    .map((row) => ({
      code: String(row?.ISU_CD ?? "").trim().toUpperCase(),
      name: String(row?.ISU_NM ?? "").trim(),
      market_cap: numberOrNull(row?.MKTCAP),
    }))
    .filter((row) => row.code && finite(row.market_cap) && row.market_cap > 0);
  const totalMarketCap = kospiRows.reduce((sum, row) => sum + row.market_cap, 0);
  if (!finite(totalMarketCap) || totalMarketCap <= 0) return null;
  return {
    source: repoRel(sourcePath),
    source_field: "OutBlock_1[MKT_NM=KOSPI].MKTCAP / sum(OutBlock_1[MKT_NM=KOSPI].MKTCAP)",
    as_of: asOf,
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
    row_count: kospiRows.length,
    total_market_cap: totalMarketCap,
    denominator: {
      method: "issuer_level_market_cap_sum",
      label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
      unit: "KRW",
      value: totalMarketCap,
    },
    rows: kospiRows.map((row) => {
      const weight = row.market_cap / totalMarketCap;
      return {
        code: row.code,
        name: row.name,
        weight: round(weight, 12),
        weight_pct: round(weight * 100, 10),
      };
    }),
  };
}

// Slice 1: aggregate index-level daily closes from the idx endpoints only.
// Public-safe by construction — index rows carry NO issue code/name, and any
// per-issuer row that appears is explicitly excluded (defense in depth). Field
// names follow the KRX Open API idx schema (IDX_NM / CLSPRC_IDX / CMPPREVDD_IDX
// / FLUC_RT / ACC_TRDVOL / ACC_TRDVAL, class IDX_CLSS); web-corroborated but
// NOT yet verified against a live idx payload (KRX secret is owner-held) — the
// row_count / raw_input_row_count fields make any field-name mismatch loud.
function buildKrxPublicIndexCloses(manifest, config) {
  const asOf = manifest?.date_range?.end_date ?? null;
  const dateKey = compactDate(asOf);
  const indices = [];
  let rawInputRowCount = 0;
  let excludedIssuerRows = 0;
  if (dateKey) {
    for (const endpoint of PUBLIC_INDEX_ENDPOINTS) {
      const sourcePath = path.join(config.outputRoot, "raw", "core_stock_index", endpoint.api_id, `${dateKey}.json`);
      const payload = readOptionalJson(sourcePath);
      const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
      rawInputRowCount += rows.length;
      for (const row of rows) {
        // Aggregate index-level only: reject any per-issuer row outright.
        if (row?.ISU_CD != null || row?.ISU_NM != null) {
          excludedIssuerRows += 1;
          continue;
        }
        const indexName = String(row?.IDX_NM ?? "").trim();
        const close = numberOrNull(row?.CLSPRC_IDX);
        if (!indexName || !finite(close)) continue;
        indices.push({
          market: endpoint.market,
          index_class: String(row?.IDX_CLSS ?? "").trim() || null,
          index_name: indexName,
          date: asOf,
          close,
          change: numberOrNull(row?.CMPPREVDD_IDX),
          change_pct: numberOrNull(row?.FLUC_RT),
          open: numberOrNull(row?.OPNPRC_IDX),
          high: numberOrNull(row?.HGPRC_IDX),
          low: numberOrNull(row?.LWPRC_IDX),
          acc_trade_volume: numberOrNull(row?.ACC_TRDVOL),
          acc_trade_value: numberOrNull(row?.ACC_TRDVAL),
        });
      }
    }
  }
  indices.sort((a, b) => a.market.localeCompare(b.market) || a.index_name.localeCompare(b.index_name));
  return {
    schema_version: "fenok_krx_public_index_daily.v1",
    market: MARKET,
    source: SOURCE,
    source_endpoints: PUBLIC_INDEX_ENDPOINTS.map((endpoint) => `idx/${endpoint.api_id}`),
    public_serving: true,
    aggregate_only: true,
    per_issuer_rows: false,
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
    generated_at: manifest?.completed_at ?? new Date().toISOString(),
    as_of: asOf,
    status: indices.length > 0 ? "ready" : "unavailable",
    row_count: indices.length,
    raw_input_row_count: rawInputRowCount,
    excluded_issuer_rows: excludedIssuerRows,
    notes: [
      "Aggregate KRX index-level daily closes (all-market / KOSPI / KOSDAQ index series). Public serving authorized by owner 2026-07-19.",
      "No per-issuer rows: any issue-coded row in the raw idx payload is excluded. Raw KRX capture stays private/admin.",
    ],
    indices,
  };
}

// Slice 2: mirror the existing KOSPI market-cap weighting method for KOSDAQ,
// but publish only the top-N aggregate concentration. Issuer identity and
// issuer-level weights remain private/deferred to Slice 3.
function buildKrxPublicKosdaqMarketCapAggregate(manifest, config) {
  const asOf = manifest?.date_range?.end_date ?? null;
  const dateKey = compactDate(asOf);
  const sourcePath = dateKey
    ? path.join(config.outputRoot, "raw", "core_stock_index", "ksq_bydd_trd", `${dateKey}.json`)
    : null;
  const payload = sourcePath ? readOptionalJson(sourcePath) : null;
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const marketRows = rows.filter((row) => row?.MKT_NM === "KOSDAQ");
  const marketCaps = marketRows
    .map((row) => ({
      code: String(row?.ISU_CD ?? "").trim().toUpperCase(),
      marketCap: numberOrNull(row?.MKTCAP),
    }))
    .filter((row) => row.code && finite(row.marketCap) && row.marketCap > 0)
    .map((row) => row.marketCap)
    .sort((a, b) => b - a);
  const totalMarketCap = marketCaps.reduce((sum, value) => sum + value, 0);
  const topNMarketCap = marketCaps.slice(0, PUBLIC_KOSDAQ_TOP_N).reduce((sum, value) => sum + value, 0);
  const ready = marketCaps.length >= PUBLIC_KOSDAQ_TOP_N && finite(totalMarketCap) && totalMarketCap > 0;
  const topNWeight = ready ? topNMarketCap / totalMarketCap : null;

  return {
    schema_version: "fenok_krx_public_kosdaq_market_cap_aggregate.v1",
    market: "KOSDAQ",
    source: SOURCE,
    source_endpoint: "sto/ksq_bydd_trd",
    public_serving: true,
    aggregate_only: true,
    per_issuer_rows: false,
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
    generated_at: manifest?.completed_at ?? new Date().toISOString(),
    as_of: asOf,
    status: ready ? "ready" : "unavailable",
    raw_input_row_count: rows.length,
    excluded_non_kosdaq_rows: rows.length - marketRows.length,
    excluded_invalid_market_cap_rows: marketRows.length - marketCaps.length,
    issuer_count: marketCaps.length,
    unit: "KRW",
    weight_method: "issuer market capitalization divided by valid KOSDAQ market capitalization sum; public output is top-N aggregate only",
    total_market_cap: ready ? totalMarketCap : null,
    top_n: PUBLIC_KOSDAQ_TOP_N,
    top_n_market_cap: ready ? topNMarketCap : null,
    top_n_weight: ready ? round(topNWeight, 12) : null,
    top_n_weight_pct: ready ? round(topNWeight * 100, 10) : null,
    notes: [
      "Derived KOSDAQ top-10 market-cap concentration aggregate. Public serving authorized by owner 2026-07-19.",
      "No issuer rows, codes, names, individual weights, raw fields, or private paths are included.",
    ],
  };
}

function buildKrxKorea10yDerivedYield(manifest, config) {
  const asOf = manifest?.date_range?.end_date;
  const dateKey = compactDate(asOf);
  if (!dateKey) return null;
  const sourcePath = path.join(config.outputRoot, "raw", "bond_commodity_esg", "kts_bydd_trd", `${dateKey}.json`);
  const payload = readOptionalJson(sourcePath);
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const candidates = rows
    .map((row) => ({
      row,
      yieldPercent: numberOrNull(row?.CLSPRC_YD),
      term: String(row?.BND_EXP_TP_NM ?? "").trim(),
      benchmarkType: String(row?.GOVBND_ISU_TP_NM ?? "").trim(),
      name: String(row?.ISU_NM ?? "").trim(),
    }))
    .filter((item) => item.term === "10" && item.benchmarkType === "지표" && finite(item.yieldPercent) && item.yieldPercent > 0)
    .sort((a, b) => Number(a.name.includes("물가")) - Number(b.name.includes("물가")));
  const selected = candidates.find((item) => !item.name.includes("물가")) ?? candidates[0];
  if (!selected) return null;
  return {
    value: round(selected.yieldPercent / 100, 8),
    date: asOf,
    raw_value_percent: selected.yieldPercent,
    source: repoRel(sourcePath),
    source_field: `OutBlock_1[ISU_NM=${selected.name},BND_EXP_TP_NM=10,GOVBND_ISU_TP_NM=지표].CLSPRC_YD / 100`,
    label: "KRX KTS 10Y benchmark government bond yield",
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
  };
}

function buildDerivedRimInputs(manifest, config) {
  const kospiWeights = buildKrxKospiDerivedWeights(manifest, config);
  const korea10y = buildKrxKorea10yDerivedYield(manifest, config);
  const missing = [
    ...(kospiWeights ? [] : ["kospi_weights"]),
    ...(korea10y ? [] : ["korea_10y"]),
  ];
  return {
    schema_version: "krx_derived_rim_inputs.v1",
    generated_at: manifest?.completed_at ?? new Date().toISOString(),
    as_of: manifest?.date_range?.end_date ?? null,
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
    status: missing.length === 0 ? "ready" : "partial_or_unavailable",
    missing,
    kospi_weights: kospiWeights,
    korea_10y: korea10y,
    notes: [
      "Derived RIM inputs are computed from private KRX raw files so generic CI can rebuild RIM without publishing raw rows.",
      "Rows contain issuer code/name plus derived KOSPI weights only; raw KRX records, prices, shares, and per-row market caps stay private/admin.",
    ],
  };
}

function buildBridgeIndex(manifest, groupManifests, config) {
  const groupSummaries = Object.fromEntries(
    Object.entries(groupManifests).map(([group, groupManifest]) => [
      group,
      {
        manifest_path: repoRel(path.join(config.outputRoot, group, "manifest.json")),
        endpoint_count: groupManifest.endpoint_count,
        date_count: groupManifest.date_count,
        summary: groupManifest.summary,
        endpoint_class_counts: countEndpointClasses(groupManifest.files),
      },
    ]),
  );
  const derivedRimInputs = buildDerivedRimInputs(manifest, config);

  return {
    schema_version: "fenok-edge-korea-krx-bridge/v1",
    generated_at: new Date().toISOString(),
    market: MARKET,
    source: SOURCE,
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
    bridge_scope: derivedRimInputs.status === "ready"
      ? "stats_and_public_safe_rim_inputs_private_path_refs_no_raw_rows"
      : "stats_only_private_path_refs_no_raw_rows",
    as_of: manifest.date_range.end_date,
    freshness: {
      as_of: manifest.date_range.end_date,
      source_date_min: manifest.date_range.dates[0],
      source_date_max: manifest.date_range.dates[manifest.date_range.dates.length - 1],
      date_count: manifest.date_range.date_count,
      fetched_at: manifest.fetched_at,
      completed_at: manifest.completed_at,
    },
    feno_data_read: dataAdminBridgeRef(config.bridgeIndexPath),
    private_artifacts: {
      output_root: repoRel(config.outputRoot),
      top_manifest_path: repoRel(path.join(config.outputRoot, "manifest.json")),
      raw_root: repoRel(path.join(config.outputRoot, "raw")),
      group_manifests: Object.fromEntries(
        Object.keys(groupManifests).map((group) => [group, repoRel(path.join(config.outputRoot, group, "manifest.json"))]),
      ),
    },
    latest_run: {
      run_id: config.runId,
      backfill_type: manifest.backfill_type,
      full_252_status: manifest.full_252_status,
      planned_full_trading_day_count: manifest.date_range.planned_full_trading_day_count,
      endpoint_count: manifest.endpoint_count,
      attempted_call_count: manifest.attempted_call_count,
      summary: manifest.summary,
      endpoint_class_counts: countEndpointClasses(manifest.files),
      group_summaries: groupSummaries,
    },
    normalized_score_candidates: manifest.normalized_score_candidates,
    request_budget: manifest.request_budget,
    derived_rim_inputs: derivedRimInputs,
    daily_command: dailyCommandTemplate(),
    daily_accumulation: {
      automatic_cron_installed: config.scheduledRun,
      latest_daily_manifest_path: repoRel(path.join(config.outputRoot, "manifest.json")),
      latest_run_id: config.runId,
      raw_storage_policy: "_private/admin only",
      bridge_index_path: repoRel(config.bridgeIndexPath),
      fail_closed_policy: {
        max_calls_per_run: config.maxCalls,
        fail_threshold: config.failThreshold,
        required_non_empty_daily_issuer_endpoints: [...REQUIRED_DAILY_ISSUER_ENDPOINTS].sort(),
        allow_empty_daily: config.allowEmptyDaily,
      },
    },
    first_safe_batch_plan: {
      requires_user_approval: true,
      end_date: "YYYYMMDD",
      trading_days: 20,
      estimated_calls: 20 * manifest.endpoint_count,
      command: batchCommandTemplate(),
    },
  };
}

function buildPlan(config) {
  return {
    ok: config.requestBudget.status === "within_budget",
    mode: "plan_only",
    market: MARKET,
    source: SOURCE,
    raw_public: false,
    license_or_terms_note: LICENSE_OR_TERMS_NOTE,
    dates: config.dates,
    run_id: config.runId,
    output_root: repoRel(config.outputRoot),
    bridge_index: repoRel(config.bridgeIndexPath),
    endpoint_count: config.endpoints.length,
    endpoint_class_counts: countEndpointClasses(config.endpoints),
    request_budget: config.requestBudget,
    no_fetch: config.noFetch,
    no_write: config.noWrite,
    scheduled_run: config.scheduledRun,
    daily_command: dailyCommandTemplate(),
  };
}

function buildManifest(config, startedAt) {
  return {
    market: MARKET,
    source: SOURCE,
    run_id: config.runId,
    backfill_type: config.days === 1 ? "krx-daily-scheduled-accumulation" : "krx-daily-accumulation-runner",
    full_252_status: config.days >= FULL_TARGET_TRADING_DAYS ? "run_requested" : "not_run_heavy",
    full_252_reason:
      config.days >= FULL_TARGET_TRADING_DAYS
        ? "Runner was invoked with days >= planned 252 trading-day target."
        : "Daily scheduler is bounded by --max-calls; larger historical runs require explicit allow-large-run.",
    fetched_at: startedAt,
    date_range: {
      end_date: isoDate(config.endDate),
      dates: config.dates.map(isoDate),
      date_count: config.dates.length,
      planned_full_trading_day_count: FULL_TARGET_TRADING_DAYS,
      trading_day_generation_note: "Generated as weekdays only; exchange holiday calendar is not applied by this runner.",
    },
    endpoint_count: config.endpoints.length,
    attempted_call_count: config.estimatedCalls,
    estimated_full_252_calls: FULL_TARGET_TRADING_DAYS * config.endpoints.length,
    request_budget: config.requestBudget,
    daily_accumulation: {
      automatic_cron_installed: config.scheduledRun,
      raw_storage_policy: "_private/admin only",
      bridge_index_path: repoRel(config.bridgeIndexPath),
    },
    request_contract: {
      host: "https://data-dbg.krx.co.kr",
      path_shape: "/svc/apis/{category}/{api_id}",
      auth_location: "request header AUTH_KEY",
      date_param: "basDd",
      secret_safe: "AUTH_KEY value is read from env only and is not written to outputs.",
    },
    runtime: {
      concurrency: config.concurrency,
      request_timeout_ms: config.timeoutMs,
      sleep_ms_between_attempts: config.sleepMs,
      node_version: process.version,
      output_root: repoRel(config.outputRoot),
      bridge_index_path: repoRel(config.bridgeIndexPath),
      no_fetch: config.noFetch,
      no_write: config.noWrite,
    },
    summary: emptySummary(),
    normalized_score_candidates: normalizedScoreCandidates(),
    endpoint_class_map: endpointClassMap(),
    files: [],
  };
}

function buildGroupManifests(config, startedAt) {
  return Object.fromEntries(
    ENDPOINT_GROUPS.map((group) => [
      group.group,
      {
        market: MARKET,
        source: SOURCE,
        group: group.group,
        axis: group.normalized_score_axis,
        fetched_at: startedAt,
        date_count: config.dates.length,
        endpoint_count: group.endpoints.length,
        summary: emptySummary(),
        files: [],
      },
    ]),
  );
}

function validateRun(manifest, config) {
  const errors = [];
  if (config.requestBudget.status !== "within_budget") {
    errors.push(`request budget blocked: estimated_calls=${config.estimatedCalls} max_calls=${config.maxCalls}`);
  }
  if (manifest.summary.failed_files > config.failThreshold) {
    errors.push(`failed_files=${manifest.summary.failed_files} exceeds fail_threshold=${config.failThreshold}`);
  }
  if (!config.allowEmptyDaily) {
    for (const date of config.dates.map(isoDate)) {
      for (const apiId of REQUIRED_DAILY_ISSUER_ENDPOINTS) {
        const requiredRows = manifest.files
          .filter((file) => file.date === date && file.api_id === apiId)
          .reduce((sum, file) => sum + (Number(file.row_count) || 0), 0);
        if (requiredRows <= 0) {
          errors.push(`required KRX issuer daily rows are empty for ${date}: endpoint=${apiId}`);
        }
      }
    }
  }
  // Slice 2 is a required top-10 public aggregate. It must stay fail-closed
  // even when allow-empty-daily is used for broader private/admin diagnostics.
  for (const date of config.dates.map(isoDate)) {
    const kosdaqRows = manifest.files
      .filter((file) => file.date === date && file.api_id === "ksq_bydd_trd")
      .reduce((sum, file) => sum + (Number(file.row_count) || 0), 0);
    if (kosdaqRows < PUBLIC_KOSDAQ_TOP_N) {
      errors.push(`public KOSDAQ top-10 aggregate is incomplete for ${date}: endpoint=ksq_bydd_trd rows=${kosdaqRows} minimum=${PUBLIC_KOSDAQ_TOP_N}`);
    }
  }
  return errors;
}

async function run(argv = process.argv.slice(2)) {
  const config = buildConfig(parseArgs(argv));
  if (config.planOnly) return buildPlan(config);
  if (config.requestBudget.status !== "within_budget") throw new Error(`KRX request budget blocked: ${JSON.stringify(config.requestBudget)}`);

  const authKey = process.env.KRX_OPEN_API_AUTH_KEY;
  if (!config.noFetch && !authKey) throw new Error("KRX_OPEN_API_AUTH_KEY environment variable is not defined.");
  if (!config.noWrite) ensureDir(config.outputRoot);

  const startedAt = new Date().toISOString();
  const manifest = buildManifest(config, startedAt);
  const groupManifests = buildGroupManifests(config, startedAt);
  const tasks = buildTasks(config.dates);

  console.log(`Starting ${MARKET} KRX daily fetch: ${tasks.length} calls, output=${repoRel(config.outputRoot)}`);

  await runLimited(tasks, config.concurrency, config.sleepMs, async (task, index) => {
    const rawDir = path.join(config.outputRoot, "raw", task.endpoint.group, task.endpoint.api_id);
    const fileName = `${task.basDd}.json`;
    const filePath = path.join(rawDir, fileName);
    const baseRecord = {
      axis: task.endpoint.normalized_score_axis,
      basDd: task.basDd,
      category: task.endpoint.category,
      date: isoDate(task.basDd),
      endpoint_class: task.endpoint.endpoint_class,
      fetched_at: startedAt,
      group: task.endpoint.group,
      api_id: task.endpoint.api_id,
      license_or_terms_note: LICENSE_OR_TERMS_NOTE,
      market_date: isoDate(task.basDd),
      raw_public: false,
      source_date: isoDate(task.basDd),
      source_url: sanitizedUrl(task.endpoint, task.basDd),
      url_sanitized: sanitizedUrl(task.endpoint, task.basDd),
    };

    let result;
    if (config.noFetch) {
      result = readCachedRaw(filePath);
    } else {
      try {
        result = await fetchJson(task.endpoint, task.basDd, authKey, config.timeoutMs);
      } catch (error) {
        result = {
          data: { error: shortErrorMessage(error) },
          error: shortErrorMessage(error),
          http_status: null,
          row_count: 0,
          status: "failed",
        };
      }
    }

    const serialized = `${JSON.stringify(result.data, null, 2)}\n`;
    if (!config.noWrite) {
      ensureDir(rawDir);
      fs.writeFileSync(filePath, serialized, "utf8");
    }
    const fileRecord = {
      ...baseRecord,
      name: fileName,
      path: repoRel(filePath),
      http_status: result.http_status,
      row_count: result.row_count || 0,
      size_bytes: config.noWrite ? Buffer.byteLength(serialized) : fs.statSync(filePath).size,
      source_kind: result.source_kind || (config.noFetch ? "private_raw_cache" : "remote_fetch"),
      status: result.status,
      failed_reason: result.status === "failed" ? result.error || "unknown" : null,
      ...(result.error ? { error: result.error } : {}),
    };

    manifest.files.push(fileRecord);
    groupManifests[task.endpoint.group].files.push(fileRecord);
    addSummary(manifest.summary, result);
    addSummary(groupManifests[task.endpoint.group].summary, result);

    const count = index + 1;
    if (count === 1 || count % 10 === 0 || count === tasks.length) console.log(`Progress ${count}/${tasks.length}`);
  });

  manifest.files.sort((a, b) => `${a.group}:${a.basDd}:${a.api_id}`.localeCompare(`${b.group}:${b.basDd}:${b.api_id}`));
  for (const groupManifest of Object.values(groupManifests)) {
    groupManifest.files.sort((a, b) => `${a.date}:${a.api_id}`.localeCompare(`${b.date}:${b.api_id}`));
  }
  manifest.completed_at = new Date().toISOString();
  manifest.validation_errors = validateRun(manifest, config);
  manifest.ok = manifest.validation_errors.length === 0;

  if (!config.noWrite) {
    for (const [group, groupManifest] of Object.entries(groupManifests)) {
      const groupDir = path.join(config.outputRoot, group);
      ensureDir(groupDir);
      fs.writeFileSync(path.join(groupDir, "manifest.json"), `${JSON.stringify(groupManifest, null, 2)}\n`, "utf8");
    }
    fs.writeFileSync(path.join(config.outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const bridgeIndex = buildBridgeIndex(manifest, groupManifests, config);
    ensureDir(path.dirname(config.bridgeIndexPath));
    fs.writeFileSync(config.bridgeIndexPath, `${JSON.stringify(bridgeIndex, null, 2)}\n`, "utf8");

    // Slice 1: public-safe aggregate index closes (data/computed, mirrored).
    const publicIndexCloses = buildKrxPublicIndexCloses(manifest, config);
    ensureDir(path.dirname(config.publicIndexClosesPath));
    fs.writeFileSync(config.publicIndexClosesPath, `${JSON.stringify(publicIndexCloses, null, 2)}\n`, "utf8");

    const publicKosdaqMarketCap = buildKrxPublicKosdaqMarketCapAggregate(manifest, config);
    ensureDir(path.dirname(config.publicKosdaqMarketCapPath));
    fs.writeFileSync(config.publicKosdaqMarketCapPath, `${JSON.stringify(publicKosdaqMarketCap, null, 2)}\n`, "utf8");
  }

  const result = {
    ok: manifest.ok,
    run_id: config.runId,
    dates: config.dates,
    output_root: repoRel(config.outputRoot),
    bridge_index: repoRel(config.bridgeIndexPath),
    public_index_closes: repoRel(config.publicIndexClosesPath),
    public_kosdaq_market_cap: repoRel(config.publicKosdaqMarketCapPath),
    summary: manifest.summary,
    validation_errors: manifest.validation_errors,
    wrote: !config.noWrite,
  };

  console.log(JSON.stringify(result, null, 2));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().then((result) => {
    if (result?.mode === "plan_only") console.log(JSON.stringify(result, null, 2));
    if (result?.ok === false) process.exitCode = 1;
  }).catch((error) => {
    console.error(shortErrorMessage(error));
    process.exit(1);
  });
}

export {
  buildBridgeIndex,
  buildConfig,
  buildKrxPublicIndexCloses,
  buildKrxPublicKosdaqMarketCapAggregate,
  buildPlan,
  endpointClass,
  generateWeekdayDates,
  getRowCount,
  latestKstWeekday,
  parseArgs,
  run,
  validateRun,
};
