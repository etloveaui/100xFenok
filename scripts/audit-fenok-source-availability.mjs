#!/usr/bin/env node
/**
 * Lightweight availability audit harness for Fenok Flow source timing.
 *
 * Default mode is safe: no live fetch and no private write. Use --fetch --write
 * only when intentionally polling source availability.
 */

import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow");
const availabilityRoot = path.join(privateRoot, "availability");

const SCHEMA_VERSION = "fenok-source-availability-audit/v0.1";
const DEFAULT_SOURCES = [
  "finra-regsho-daily",
  "occ-volume-query",
  "apewisdom-all-stocks",
  "nasdaq-symbol-files",
  "fred-release-calendar",
];
const SUPPORTED_SOURCES = new Set([...DEFAULT_SOURCES, "apewisdom-attention"]);
const DEFAULT_TICKER = "NVDA";
const DEFAULT_OCC_SIDE = "both";
const DEFAULT_APEWISDOM_PAGE = 1;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_BYTES = 2_000_000;
const OUTPUT_FILE = path.join(availabilityRoot, "source_availability_audit_latest.json");
const HISTORY_FILE = path.join(availabilityRoot, "source_availability_audit_history.ndjson");

function parseArgs(argv) {
  const args = {
    date: "",
    sources: DEFAULT_SOURCES.join(","),
    ticker: DEFAULT_TICKER,
    occSide: DEFAULT_OCC_SIDE,
    apewisdomPage: DEFAULT_APEWISDOM_PAGE,
    fetch: false,
    write: false,
    planOnly: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxBytes: DEFAULT_MAX_BYTES,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--date") args.date = next();
    else if (arg === "--sources") args.sources = next();
    else if (arg === "--ticker") args.ticker = next();
    else if (arg === "--occ-side") args.occSide = next();
    else if (arg === "--apewisdom-page") args.apewisdomPage = Number(next()) || DEFAULT_APEWISDOM_PAGE;
    else if (arg === "--fetch") args.fetch = true;
    else if (arg === "--no-fetch") args.fetch = false;
    else if (arg === "--write") args.write = true;
    else if (arg === "--no-write") args.write = false;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--timeout-ms") args.timeoutMs = Number(next()) || DEFAULT_TIMEOUT_MS;
    else if (arg === "--max-bytes") args.maxBytes = Number(next()) || DEFAULT_MAX_BYTES;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.ticker = normalizeTicker(args.ticker);
  args.occSide = normalizeOccSide(args.occSide);
  args.apewisdomPage = normalizePositiveInteger(args.apewisdomPage, "--apewisdom-page");
  return args;
}

function normalizeTicker(value) {
  const ticker = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker)) {
    throw new Error(`Expected --ticker to be a bounded US ticker symbol, got: ${value}`);
  }
  return ticker;
}

function normalizeOccSide(value) {
  const side = String(value ?? "").trim().toUpperCase();
  if (side === "BOTH") return "both";
  if (side === "C" || side === "P") return side;
  throw new Error(`Expected --occ-side C, P, or both, got: ${value}`);
}

function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`Expected ${label} to be a positive integer, got: ${value}`);
  }
  return number;
}

function normalizeDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return latestWeekdayYmd();
  const compact = raw.replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error(`Expected --date YYYYMMDD or YYYY-MM-DD, got: ${value}`);
  }
  return compact;
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

function isoFromYmd(yyyymmdd) {
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

function kstIso(date) {
  const shifted = new Date(date.getTime() + (9 * 60 * 60 * 1000));
  return shifted.toISOString().replace("Z", "+09:00");
}

function rel(absPath) {
  return path.relative(repoRoot, absPath);
}

function finraUrl(yyyymmdd) {
  return `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${yyyymmdd}.txt`;
}

function occUrl({ yyyymmdd, ticker, side }) {
  const params = new URLSearchParams({
    reportDate: yyyymmdd,
    format: "csv",
    volumeQueryType: "O",
    symbolType: "U",
    symbol: ticker,
    reportType: "D",
    productKind: "OSTK",
    porc: side,
  });
  return `https://marketdata.theocc.com/volume-query?${params.toString()}`;
}

function apeWisdomUrl(page) {
  if (page <= 1) return "https://apewisdom.io/api/v1.0/filter/all-stocks";
  return `https://apewisdom.io/api/v1.0/filter/all-stocks/page/${page}`;
}

function fredCalendarUrl(yyyymmdd) {
  return `https://fred.stlouisfed.org/releases/calendar?date=${isoFromYmd(yyyymmdd)}`;
}

function selectedSources(args) {
  const requested = String(args.sources ?? "")
    .split(",")
    .map((source) => source.trim())
    .filter(Boolean);
  for (const source of requested) {
    if (!SUPPORTED_SOURCES.has(source)) throw new Error(`Unsupported source: ${source}`);
  }
  return [...new Set(requested)];
}

function buildSourceDefinitions(args) {
  const yyyymmdd = normalizeDate(args.date);
  const sourceDateIso = isoFromYmd(yyyymmdd);
  const definitions = [];

  for (const source of selectedSources(args)) {
    if (source === "finra-regsho-daily") {
      definitions.push({
        source_id: source,
        provider: "FINRA",
        display_name: "FINRA CNMS daily short sale volume",
        source_date: yyyymmdd,
        source_date_iso: sourceDateIso,
        credential_required: false,
        checks: [
          {
            check_id: "finra-cnms-daily",
            source_url: finraUrl(yyyymmdd),
            parser_id: "finra-regsho-daily-text",
            row_count_required: true,
            expects_source_date_match: true,
            cache_candidates: [
              {
                path: path.join(privateRoot, "finra", "regsho_daily", `CNMSshvol${yyyymmdd}.txt`),
                parser_id: "finra-regsho-daily-text",
              },
              {
                path: path.join(privateRoot, "finra", "regsho_daily", `CNMSshvol${yyyymmdd}.json`),
                parser_id: "finra-regsho-daily-json",
              },
            ],
          },
        ],
      });
    } else if (source === "occ-volume-query") {
      const sides = args.occSide === "both" ? ["C", "P"] : [args.occSide];
      definitions.push({
        source_id: source,
        provider: "OCC",
        display_name: "OCC volume-query option volume CSV",
        source_date: yyyymmdd,
        source_date_iso: sourceDateIso,
        credential_required: false,
        ticker: args.ticker,
        checks: sides.map((side) => ({
          check_id: `occ-${args.ticker}-${side}`,
          side,
          source_url: occUrl({ yyyymmdd, ticker: args.ticker, side }),
          parser_id: "occ-volume-query-csv",
          row_count_required: true,
          expects_source_date_match: true,
          cache_candidates: [
            {
              path: path.join(privateRoot, "occ_options_volume", yyyymmdd, `${args.ticker}_${side}.csv`),
              parser_id: "occ-volume-query-csv",
            },
          ],
        })),
      });
    } else if (source === "apewisdom-all-stocks" || source === "apewisdom-attention") {
      definitions.push({
        source_id: source,
        provider: "ApeWisdom",
        display_name: "ApeWisdom all-stocks attention aggregate",
        source_date: yyyymmdd,
        source_date_iso: sourceDateIso,
        credential_required: false,
        checks: [
          {
            check_id: `apewisdom-all-stocks-page-${args.apewisdomPage}`,
            page: args.apewisdomPage,
            source_url: apeWisdomUrl(args.apewisdomPage),
            parser_id: "apewisdom-all-stocks-json",
            row_count_required: true,
            expects_source_date_match: false,
            cache_candidates: [
              {
                path: path.join(privateRoot, "apewisdom", "all-stocks", yyyymmdd, `page-${args.apewisdomPage}.json`),
                parser_id: "apewisdom-all-stocks-json",
              },
            ],
          },
        ],
      });
    } else if (source === "nasdaq-symbol-files") {
      definitions.push({
        source_id: source,
        provider: "Nasdaq Trader",
        display_name: "Nasdaq Trader symbol directory files",
        source_date: yyyymmdd,
        source_date_iso: sourceDateIso,
        credential_required: false,
        checks: [
          {
            check_id: "nasdaqlisted",
            source_url: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
            parser_id: "nasdaq-symbol-file",
            row_count_required: true,
            expects_source_date_match: false,
            cache_candidates: [],
          },
          {
            check_id: "otherlisted",
            source_url: "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
            parser_id: "nasdaq-symbol-file",
            row_count_required: true,
            expects_source_date_match: false,
            cache_candidates: [],
          },
        ],
      });
    } else if (source === "fred-release-calendar") {
      definitions.push({
        source_id: source,
        provider: "FRED",
        display_name: "FRED public release calendar page",
        source_date: yyyymmdd,
        source_date_iso: sourceDateIso,
        credential_required: false,
        checks: [
          {
            check_id: "fred-release-calendar-html",
            source_url: fredCalendarUrl(yyyymmdd),
            parser_id: "fred-release-calendar-html",
            row_count_required: false,
            expects_source_date_match: false,
            cache_candidates: [],
          },
        ],
      });
    }
  }

  return definitions;
}

function buildPlan(args = parseArgs([])) {
  const definitions = buildSourceDefinitions(args);
  return {
    plan_only: true,
    schema_version: SCHEMA_VERSION,
    mode: args.fetch ? "live_http_probe" : "safe_no_fetch_private_cache_probe",
    fetch_enabled: args.fetch,
    write_enabled: args.write,
    source_date: definitions[0]?.source_date ?? normalizeDate(args.date),
    source_date_iso: definitions[0]?.source_date_iso ?? isoFromYmd(normalizeDate(args.date)),
    output_file: rel(OUTPUT_FILE),
    history_file: rel(HISTORY_FILE),
    sources: definitions.map((definition) => ({
      ...definition,
      checks: definition.checks.map((check) => ({
        ...check,
        cache_candidates: check.cache_candidates.map((candidate) => ({
          path: rel(candidate.path),
          parser_id: candidate.parser_id,
        })),
      })),
    })),
  };
}

function splitDelimitedLine(line, delimiter = ",") {
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
    } else if (char === delimiter && !quoted) {
      out.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  out.push(current);
  return out;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseFinraRegshoText(text, expectedDate = "") {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { file_date_marker: null, row_count: 0, date_matches: null };
  }
  const header = lines[0].split("|").map((part) => part.trim());
  const expectedHeader = ["Date", "Symbol", "ShortVolume", "ShortExemptVolume", "TotalVolume", "Market"];
  if (expectedHeader.some((part, index) => header[index] !== part)) {
    throw new Error(`Unexpected FINRA header: ${header.join("|")}`);
  }
  const rowDates = [];
  let rowCount = 0;
  for (const line of lines.slice(1)) {
    const [date, symbol, shortVolume, shortExemptVolume, totalVolume] = line.split("|");
    if (!symbol || !shortVolume || !totalVolume) continue;
    rowDates.push(String(date ?? "").trim());
    rowCount += 1;
    void shortExemptVolume;
  }
  const uniqueDates = [...new Set(rowDates.filter(Boolean))].sort();
  const marker = uniqueDates.length === 1 ? uniqueDates[0] : uniqueDates.join(",");
  return {
    file_date_marker: marker || null,
    row_count: rowCount,
    date_matches: expectedDate && marker ? uniqueDates.includes(expectedDate) : null,
  };
}

function parseFinraRegshoJson(text, expectedDate = "") {
  const payload = JSON.parse(String(text ?? "{}"));
  const marker = String(payload.date ?? payload.as_of ?? payload.rows?.[0]?.date ?? "").replaceAll("-", "");
  const rowCount = Number(payload.row_count ?? payload.rows?.length ?? 0);
  return {
    file_date_marker: marker || null,
    row_count: Number.isFinite(rowCount) ? rowCount : 0,
    date_matches: expectedDate && marker ? marker === expectedDate : null,
  };
}

function parseOccDate(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return raw.replaceAll("-", "");
  return `${match[3]}${match[1].padStart(2, "0")}${match[2].padStart(2, "0")}`;
}

function parseOccCsv(text, expectedDate = "") {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { file_date_marker: null, row_count: 0, date_matches: null };
  }
  const headers = splitDelimitedLine(lines[0]).map((header) => header.trim().toLowerCase());
  const required = ["quantity", "underlying", "symbol", "actype", "porc", "exchange", "actdate"];
  for (const key of required) {
    if (!headers.includes(key)) throw new Error(`Unexpected OCC CSV header, missing ${key}: ${lines[0]}`);
  }
  const actdateIndex = headers.indexOf("actdate");
  const dates = [];
  let rowCount = 0;
  for (const line of lines.slice(1)) {
    const values = splitDelimitedLine(line);
    if (values.length < headers.length - 1) continue;
    rowCount += 1;
    dates.push(parseOccDate(values[actdateIndex]));
  }
  const uniqueDates = [...new Set(dates.filter(Boolean))].sort();
  const marker = uniqueDates.length === 1 ? uniqueDates[0] : uniqueDates.join(",");
  return {
    file_date_marker: marker || null,
    row_count: rowCount,
    date_matches: expectedDate && marker ? uniqueDates.includes(expectedDate) : null,
  };
}

function parseNasdaqFileCreationTime(line) {
  const match = String(line ?? "").match(/File Creation Time:\s*(\d{2})(\d{2})(\d{4})/i);
  if (!match) return null;
  return `${match[3]}${match[1]}${match[2]}`;
}

function parseNasdaqSymbolFile(text) {
  const lines = String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { file_date_marker: null, row_count: 0, date_matches: null };
  }
  const footer = lines.find((line) => /^File Creation Time:/i.test(line));
  const dataLines = lines.slice(1).filter((line) => !/^File Creation Time:/i.test(line));
  return {
    file_date_marker: parseNasdaqFileCreationTime(footer),
    row_count: dataLines.length,
    date_matches: null,
  };
}

function parseFredReleaseCalendarHtml(text, expectedDate = "") {
  const body = String(text ?? "");
  const releaseLinks = body.match(/href="\/release\//g) ?? [];
  const marker = body.includes(isoFromYmd(expectedDate)) ? expectedDate : null;
  return {
    file_date_marker: marker,
    row_count: releaseLinks.length,
    date_matches: null,
  };
}

function normalizeApeWisdomRow(row) {
  return {
    ticker: String(row?.ticker ?? "").trim().toUpperCase(),
    rank: numberValue(row?.rank),
    mentions: numberValue(row?.mentions),
    upvotes: numberValue(row?.upvotes),
    mentions_24h_ago: numberValue(row?.mentions_24h_ago),
  };
}

function signatureHash(rows) {
  return createHash("sha256")
    .update(JSON.stringify(rows))
    .digest("hex");
}

function parseApeWisdomAllStocksJson(text) {
  const payload = JSON.parse(String(text ?? "{}"));
  const results = Array.isArray(payload.results) ? payload.results : [];
  const topRows = results
    .slice(0, 20)
    .map(normalizeApeWisdomRow)
    .filter((row) => row.ticker);
  const top20DeltaMarker = topRows
    .map((row) => [
      row.rank ?? "",
      row.ticker,
      row.mentions ?? "",
      row.upvotes ?? "",
      row.mentions_24h_ago ?? "",
    ].join(":"))
    .join("|");
  return {
    file_date_marker: null,
    row_count: results.length,
    results_count: numberValue(payload.count) ?? results.length,
    pages: numberValue(payload.pages),
    current_page: numberValue(payload.current_page),
    top_rows: topRows,
    top20_delta_marker: top20DeltaMarker || null,
    top20_signature_sha256: topRows.length > 0 ? signatureHash(topRows) : null,
    date_matches: null,
  };
}

function parseAvailabilityPayload(parserId, text, { expectedDate = "" } = {}) {
  if (parserId === "finra-regsho-daily-text") return parseFinraRegshoText(text, expectedDate);
  if (parserId === "finra-regsho-daily-json") return parseFinraRegshoJson(text, expectedDate);
  if (parserId === "occ-volume-query-csv") return parseOccCsv(text, expectedDate);
  if (parserId === "apewisdom-all-stocks-json") return parseApeWisdomAllStocksJson(text);
  if (parserId === "nasdaq-symbol-file") return parseNasdaqSymbolFile(text);
  if (parserId === "fred-release-calendar-html") return parseFredReleaseCalendarHtml(text, expectedDate);
  throw new Error(`Unsupported parser: ${parserId}`);
}

function deriveCheckAvailabilityStatus({
  fetchEnabled,
  cacheHit,
  httpStatus,
  parseResult,
  rowCountRequired,
  expectsSourceDateMatch,
  error,
}) {
  if (error) return fetchEnabled ? "fetch_or_parse_error" : "cache_parse_error";
  if (!fetchEnabled && !cacheHit) return "cache_missing_no_fetch";
  if (fetchEnabled && httpStatus !== null && httpStatus !== undefined) {
    if (httpStatus === 404) return "not_available_yet";
    if (httpStatus === 403 || httpStatus === 429) return "blocked_or_rate_limited";
    if (httpStatus < 200 || httpStatus >= 300) return "http_unavailable";
  }
  if (expectsSourceDateMatch && parseResult?.date_matches === false) return "date_mismatch";
  if (rowCountRequired && Number(parseResult?.row_count ?? 0) <= 0) return "empty_response";
  return cacheHit && !fetchEnabled ? "available_from_private_cache" : "available";
}

function aggregateAvailabilityStatus(checks) {
  const statuses = checks.map((check) => check.availability_status);
  const available = new Set(["available", "available_from_private_cache"]);
  if (statuses.length === 0) return "not_checked";
  if (statuses.every((status) => available.has(status))) {
    return statuses.every((status) => status === "available_from_private_cache")
      ? "available_from_private_cache"
      : "available";
  }
  if (statuses.some((status) => available.has(status))) return "partial_available";
  if (statuses.every((status) => status === "cache_missing_no_fetch")) return "not_checked_no_fetch";
  if (statuses.includes("date_mismatch")) return "date_mismatch";
  if (statuses.includes("blocked_or_rate_limited")) return "blocked_or_rate_limited";
  if (statuses.includes("fetch_or_parse_error")) return "fetch_or_parse_error";
  if (statuses.includes("not_available_yet")) return "not_available_yet";
  if (statuses.includes("empty_response")) return "empty_response";
  return statuses[0] ?? "unknown";
}

async function fetchTextWithLimit(url, { timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "FenokAvailabilityAudit/0.1" },
    });
    const reader = response.body?.getReader();
    const chunks = [];
    let bytesRead = 0;
    let truncated = false;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const room = maxBytes - bytesRead;
        if (room <= 0) {
          truncated = true;
          await reader.cancel();
          break;
        }
        if (value.byteLength > room) {
          chunks.push(value.slice(0, room));
          bytesRead += room;
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        bytesRead += value.byteLength;
      }
    }
    const text = new TextDecoder("utf-8").decode(Buffer.concat(chunks));
    return {
      http_status: response.status,
      ok: response.ok,
      final_url: response.url,
      bytes_read: bytesRead,
      truncated,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function readCacheCandidate(check) {
  for (const candidate of check.cache_candidates) {
    if (fs.existsSync(candidate.path)) {
      return {
        cache_hit: true,
        cache_path: rel(candidate.path),
        parser_id: candidate.parser_id,
        text: fs.readFileSync(candidate.path, "utf8"),
      };
    }
  }
  return {
    cache_hit: false,
    cache_path: check.cache_candidates[0] ? rel(check.cache_candidates[0].path) : null,
    parser_id: check.parser_id,
    text: "",
  };
}

async function auditCheck(check, source, args, checkedAt) {
  const base = {
    check_id: check.check_id,
    checked_at_utc: checkedAt.toISOString(),
    checked_at_kst: kstIso(checkedAt),
    source_url: check.source_url,
    source_date: source.source_date,
    source_date_iso: source.source_date_iso,
    http_status: null,
    cache_hit: false,
    cache_path: null,
    file_date_marker: null,
    row_count: null,
    results_count: null,
    pages: null,
    current_page: null,
    top_rows: null,
    top20_delta_marker: null,
    top20_signature_sha256: null,
    bytes_read: null,
    truncated: false,
    availability_status: "not_checked",
    error: null,
  };

  try {
    let parserId = check.parser_id;
    let text = "";
    if (args.fetch) {
      const fetched = await fetchTextWithLimit(check.source_url, args);
      base.http_status = fetched.http_status;
      base.bytes_read = fetched.bytes_read;
      base.truncated = fetched.truncated;
      if (!fetched.ok) {
        base.availability_status = deriveCheckAvailabilityStatus({
          fetchEnabled: true,
          cacheHit: false,
          httpStatus: fetched.http_status,
          parseResult: null,
          rowCountRequired: check.row_count_required,
          expectsSourceDateMatch: check.expects_source_date_match,
          error: null,
        });
        return base;
      }
      text = fetched.text;
    } else {
      const cached = readCacheCandidate(check);
      base.cache_hit = cached.cache_hit;
      base.cache_path = cached.cache_path;
      parserId = cached.parser_id;
      text = cached.text;
      if (!cached.cache_hit) {
        base.availability_status = deriveCheckAvailabilityStatus({
          fetchEnabled: false,
          cacheHit: false,
          httpStatus: null,
          parseResult: null,
          rowCountRequired: check.row_count_required,
          expectsSourceDateMatch: check.expects_source_date_match,
          error: null,
        });
        return base;
      }
    }

    const parsed = parseAvailabilityPayload(parserId, text, { expectedDate: source.source_date });
    base.file_date_marker = parsed.file_date_marker;
    base.row_count = parsed.row_count;
    base.results_count = parsed.results_count ?? null;
    base.pages = parsed.pages ?? null;
    base.current_page = parsed.current_page ?? null;
    base.top_rows = parsed.top_rows ?? null;
    base.top20_delta_marker = parsed.top20_delta_marker ?? null;
    base.top20_signature_sha256 = parsed.top20_signature_sha256 ?? null;
    base.availability_status = deriveCheckAvailabilityStatus({
      fetchEnabled: args.fetch,
      cacheHit: base.cache_hit,
      httpStatus: base.http_status,
      parseResult: parsed,
      rowCountRequired: check.row_count_required,
      expectsSourceDateMatch: check.expects_source_date_match,
      error: null,
    });
    return base;
  } catch (err) {
    base.error = err.message;
    base.availability_status = deriveCheckAvailabilityStatus({
      fetchEnabled: args.fetch,
      cacheHit: base.cache_hit,
      httpStatus: base.http_status,
      parseResult: null,
      rowCountRequired: check.row_count_required,
      expectsSourceDateMatch: check.expects_source_date_match,
      error: err,
    });
    return base;
  }
}

function summarizeSource(definition, checks) {
  const httpStatuses = Object.fromEntries(checks.map((check) => [check.check_id, check.http_status]));
  const fileDateMarkers = Object.fromEntries(checks.map((check) => [check.check_id, check.file_date_marker]));
  const top20Signatures = Object.fromEntries(checks.map((check) => [check.check_id, check.top20_signature_sha256]));
  const knownRowCounts = checks
    .map((check) => check.row_count)
    .filter((count) => Number.isFinite(count));
  const rowCount = knownRowCounts.length > 0
    ? knownRowCounts.reduce((sum, count) => sum + count, 0)
    : null;
  return {
    source_id: definition.source_id,
    provider: definition.provider,
    display_name: definition.display_name,
    source_date: definition.source_date,
    source_date_iso: definition.source_date_iso,
    credential_required: definition.credential_required,
    checked_at_utc: checks[0]?.checked_at_utc ?? null,
    checked_at_kst: checks[0]?.checked_at_kst ?? null,
    http_status: checks.length === 1 ? checks[0].http_status : null,
    http_statuses: httpStatuses,
    file_date_marker: checks.length === 1 ? checks[0].file_date_marker : fileDateMarkers,
    row_count: rowCount,
    results_count: checks.length === 1 ? checks[0].results_count : null,
    pages: checks.length === 1 ? checks[0].pages : null,
    current_page: checks.length === 1 ? checks[0].current_page : null,
    top20_delta_marker: checks.length === 1 ? checks[0].top20_delta_marker : null,
    top20_signature_sha256: checks.length === 1 ? checks[0].top20_signature_sha256 : top20Signatures,
    availability_status: aggregateAvailabilityStatus(checks),
    checks,
  };
}

function writeAudit(summary) {
  fs.mkdirSync(availabilityRoot, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(summary)}\n`, "utf8");
  return {
    output_file: rel(OUTPUT_FILE),
    history_file: rel(HISTORY_FILE),
  };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const plan = buildPlan(args);
  if (args.planOnly) return plan;

  const checkedAt = new Date();
  const definitions = buildSourceDefinitions(args);
  const sources = [];
  for (const definition of definitions) {
    const checks = [];
    for (const check of definition.checks) {
      checks.push(await auditCheck(check, definition, args, checkedAt));
    }
    sources.push(summarizeSource(definition, checks));
  }

  const summary = {
    schema_version: SCHEMA_VERSION,
    generated_at: checkedAt.toISOString(),
    checked_at_utc: checkedAt.toISOString(),
    checked_at_kst: kstIso(checkedAt),
    mode: args.fetch ? "live_http_probe" : "safe_no_fetch_private_cache_probe",
    fetch_enabled: args.fetch,
    write_enabled: args.write,
    source_date: plan.source_date,
    source_date_iso: plan.source_date_iso,
    output_file: args.write ? rel(OUTPUT_FILE) : null,
    history_file: args.write ? rel(HISTORY_FILE) : null,
    sources,
  };

  if (args.write) {
    const wrote = writeAudit(summary);
    summary.output_file = wrote.output_file;
    summary.history_file = wrote.history_file;
  }

  return summary;
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
  aggregateAvailabilityStatus,
  buildPlan,
  buildSourceDefinitions,
  deriveCheckAvailabilityStatus,
  normalizeDate,
  parseArgs,
  parseAvailabilityPayload,
  run,
};
