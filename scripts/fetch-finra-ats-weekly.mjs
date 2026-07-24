#!/usr/bin/env node
/**
 * FINRA OTC/ATS Weekly Summary collector.
 *
 * Raw provider rows are retained as bounded date shards under
 * data/admin/finra-ats/weeks/. Current/LKG artifacts remain row-free markers.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  atomicWrite,
  attemptResult,
  defaultAttemptId,
  returnedTuple,
  threwTuple,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
} from "./lib/data-supply-lkg-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = path.resolve(__dirname, "..");

export const FINRA_ATS_LANE_ID = "finra_ats_weekly";
export const FINRA_ATS_MARKER_SCHEMA = "fenok-finra-ats-weekly-marker/v1";
export const FINRA_ATS_LKG_KEY = "weekly-summary";
export const FINRA_ATS_SYMBOL_BATCH_SIZE = 250;
export const MAX_REQUESTS = 100;
export const ATTEMPT_ASSERTION_IDS = Object.freeze(["weekly_summary_rows", "weekly_summary_row_shape"]);

const TOKEN_ENDPOINT = "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials";
const WEEKLY_SUMMARY_ENDPOINT = "https://api.finra.org/data/group/otcMarket/name/weeklySummary";
const SUMMARY_TYPES = Object.freeze(["ATS_W_SMBL", "OTC_W_SMBL"]);
const RAW_SCHEMA = "fenok-finra-ats-weekly-raw/v1";
const HISTORY_LIMIT = 26;
const PAGE_LIMIT = 5000;

class CollectorError extends Error {
  constructor(reason, message, { statusCode = null, systemic = false, rateLimited = false, auth = "ok" } = {}) {
    super(message);
    this.name = "CollectorError";
    this.reason = reason;
    this.statusCode = statusCode;
    this.systemic = systemic;
    this.rateLimited = rateLimited;
    this.auth = auth;
  }
}

function isoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizedSymbol(value) {
  return String(value ?? "").trim().toUpperCase().replaceAll(".", "-");
}

function finraQuerySymbol(value) {
  const symbol = String(value ?? "").trim().toUpperCase();
  // FINRA US symbols are alphabetic-leading. A one-letter class suffix is kept
  // (BRK.B/BF.B); country suffixes and numeric foreign listings stay excluded.
  return /^[A-Z][A-Z0-9]{0,10}(?:\.[A-Z])?$/.test(symbol) ? symbol : null;
}

function dateAddDays(iso, days) {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function lastCompletedMonday(referenceDate = new Date()) {
  const date = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()));
  // Wednesday's natural schedule can use that week's Monday anchor. A run on
  // Monday itself instead falls back to the prior completed Monday.
  const daysSinceMonday = (date.getUTCDay() + 6) % 7 || 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.toISOString().slice(0, 10);
}

function withWalkback(targetWeekStart) {
  return [0, 1, 2].map((weeks) => dateAddDays(targetWeekStart, -7 * weeks));
}

export function summaryTargets(referenceDate = new Date()) {
  const completed = lastCompletedMonday(referenceDate);
  const t1 = dateAddDays(completed, -14);
  const t2Otce = dateAddDays(completed, -28);
  return {
    last_completed_monday: completed,
    t1: {
      tier_identifiers: ["T1"],
      target_week_start: t1,
      walkback_week_starts: withWalkback(t1),
    },
    t2_otce: {
      tier_identifiers: ["T2", "OTCE"],
      target_week_start: t2Otce,
      walkback_week_starts: withWalkback(t2Otce),
    },
  };
}

export function buildWeeklySummaryBody({ symbols, weekStartDate, tiers, offset = 0, limit = PAGE_LIMIT }) {
  if (!Array.isArray(symbols) || symbols.length === 0 || symbols.length > FINRA_ATS_SYMBOL_BATCH_SIZE) {
    throw new CollectorError("schema_drift", "tracked FINRA symbol batch is invalid", { systemic: true });
  }
  if (!isoDate(weekStartDate) || !Array.isArray(tiers) || tiers.length === 0 || !Number.isInteger(offset) || offset < 0) {
    throw new CollectorError("schema_drift", "weekly summary request shape is invalid", { systemic: true });
  }
  return {
    limit,
    offset,
    domainFilters: [
      { fieldName: "issueSymbolIdentifier", values: [...symbols] },
      { fieldName: "weekStartDate", values: [weekStartDate] },
      { fieldName: "tierIdentifier", values: [...tiers] },
      { fieldName: "summaryTypeCode", values: [...SUMMARY_TYPES] },
    ],
  };
}

export function batchTrackedSymbols(symbols, batchSize = FINRA_ATS_SYMBOL_BATCH_SIZE) {
  if (!Array.isArray(symbols) || symbols.length === 0 || !Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("FINRA tracked symbol batching inputs are invalid");
  }
  const batches = [];
  for (let index = 0; index < symbols.length; index += batchSize) batches.push(symbols.slice(index, index + batchSize));
  return batches;
}

export function createRequestBudget(maximum = MAX_REQUESTS, used = 0) {
  if (!Number.isInteger(maximum) || maximum < 1 || !Number.isInteger(used) || used < 0 || used > maximum) {
    throw new Error("request budget is invalid");
  }
  return {
    maximum,
    used,
    consume() {
      if (this.used >= this.maximum) {
        throw new CollectorError("budget_exceeded", `request budget exceeded at request ${this.used + 1}`, { systemic: true });
      }
      this.used += 1;
      return this.used;
    },
  };
}

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (String(key).toLowerCase() === wanted) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

export function parsePaginationTotal(headers) {
  const value = headerValue(headers, "record-total");
  if (!/^\d+$/.test(String(value ?? ""))) {
    throw new CollectorError("schema_drift", "weekly summary record-total header is missing or invalid", { systemic: true });
  }
  return Number(value);
}

function parseNonNegativeHeader(headers, name) {
  const value = headerValue(headers, name);
  if (!/^\d+$/.test(String(value ?? ""))) {
    throw new CollectorError("schema_drift", `weekly summary ${name} header is missing or invalid`, { systemic: true });
  }
  return Number(value);
}

function paginationHeaders(headers, { offset, limit, rows }) {
  const total = parsePaginationTotal(headers);
  const responseOffset = parseNonNegativeHeader(headers, "record-offset");
  const responseLimit = parseNonNegativeHeader(headers, "record-limit");
  const recordsOnPageValue = headerValue(headers, "total-records-on-page");
  const recordsOnPage = recordsOnPageValue === undefined
    ? rows.length
    : parseNonNegativeHeader(headers, "total-records-on-page");
  if (responseOffset !== offset || responseLimit !== limit || recordsOnPage !== rows.length || total < offset + rows.length) {
    throw new CollectorError("schema_drift", "pagination header mismatch", { systemic: true });
  }
  return total;
}

export function loadTrackedUniverse(repoRoot = DEFAULT_REPO_ROOT) {
  const universePath = path.join(repoRoot, "data", "computed", "fenok_signals.json");
  let document;
  let bytes;
  try {
    bytes = fs.readFileSync(universePath);
    document = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CollectorError("schema_drift", `tracked universe is unreadable: ${error.message}`, { systemic: true });
  }
  if (!Array.isArray(document?.rows)) {
    throw new CollectorError("schema_drift", "tracked universe rows are missing", { systemic: true });
  }
  const canonicalBySymbol = new Map();
  const querySymbols = [];
  let usRows = 0;
  let excludedRows = 0;
  for (const row of document.rows) {
    if (row?.market_scope !== "us") continue;
    usRows += 1;
    const querySymbol = finraQuerySymbol(row?.ticker);
    if (!querySymbol) {
      excludedRows += 1;
      continue;
    }
    const canonical = String(row?.ticker ?? "").trim().toUpperCase();
    const key = normalizedSymbol(row?.ticker_normalized || querySymbol);
    if (!canonicalBySymbol.has(key)) canonicalBySymbol.set(key, canonical);
    querySymbols.push(querySymbol);
  }
  const deduplicated = [...new Set(querySymbols)].sort();
  if (deduplicated.length === 0) {
    throw new CollectorError("schema_drift", "tracked US FINRA universe is empty", { systemic: true });
  }
  return {
    universe_path: universePath,
    universe_relative_path: "data/computed/fenok_signals.json",
    universe_sha256: createHash("sha256").update(bytes).digest("hex"),
    query_symbols: deduplicated,
    canonical_by_symbol: canonicalBySymbol,
    counts: {
      source_rows: document.rows.length,
      us_rows: usRows,
      selected: deduplicated.length,
      mapped: canonicalBySymbol.size,
      excluded: excludedRows,
    },
  };
}

function validNumberLike(value) {
  return Number.isFinite(Number(value));
}

function validSummaryRow(row, { weekStartDate, tiers, universe, batchSymbolKeys }) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const symbolKey = normalizedSymbol(row.issueSymbolIdentifier);
  return typeof row.issueSymbolIdentifier === "string" && row.issueSymbolIdentifier.trim() !== ""
    && universe.canonical_by_symbol.has(symbolKey)
    && batchSymbolKeys.has(symbolKey)
    && row.weekStartDate === weekStartDate
    && row.summaryStartDate === weekStartDate
    && isoDate(row.summaryStartDate)
    && tiers.includes(row.tierIdentifier)
    && SUMMARY_TYPES.includes(row.summaryTypeCode)
    && typeof row.issueName === "string" && row.issueName.trim() !== ""
    && validNumberLike(row.totalWeeklyShareQuantity)
    && validNumberLike(row.totalWeeklyTradeCount)
    && validNumberLike(row.totalNotionalSum);
}

async function defaultRequest({ url, method, headers, body }) {
  const response = await fetch(url, { method, headers, body });
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

function oauthHeaders(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
  return {
    authorization: `Basic ${basic}`,
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
}

async function acquireAccessToken({ request, budget, clientId, clientSecret, tokenEndpoint = TOKEN_ENDPOINT }) {
  if (!clientId || !clientSecret) {
    throw new CollectorError("auth_error", "FINRA OAuth client credentials are required", { systemic: true, auth: "rejected" });
  }
  budget.consume();
  let response;
  try {
    response = await request({
      url: tokenEndpoint,
      method: "POST",
      headers: oauthHeaders(clientId, clientSecret),
      body: undefined,
    });
  } catch (error) {
    throw new CollectorError("auth_error", `FINRA OAuth request failed: ${error.message}`, { systemic: true, auth: "rejected" });
  }
  const statusCode = response?.statusCode;
  if (statusCode === 429) throw new CollectorError("rate_limited", "FINRA OAuth rate limited", { statusCode, systemic: true, rateLimited: true, auth: "rejected" });
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
    throw new CollectorError("auth_error", `FINRA OAuth failed with HTTP ${statusCode}`, { statusCode, systemic: true, auth: "rejected" });
  }
  let document;
  try {
    document = JSON.parse(String(response.body ?? ""));
  } catch {
    throw new CollectorError("schema_drift", "FINRA OAuth response is not JSON", { statusCode, systemic: true });
  }
  if (typeof document?.access_token !== "string" || document.access_token.trim() === ""
    || String(document?.token_type ?? "").toLowerCase() !== "bearer"
    || !Number.isFinite(Number(document?.expires_in)) || Number(document.expires_in) <= 0) {
    throw new CollectorError("auth_error", "FINRA OAuth response is missing a usable Bearer token", { statusCode, systemic: true, auth: "rejected" });
  }
  return { access_token: document.access_token, auth_path: "oauth_client_credentials" };
}

async function requestPage({ request, accessToken, budget, body, endpoint = WEEKLY_SUMMARY_ENDPOINT }) {
  budget.consume();
  let response;
  try {
    response = await request({
      url: endpoint,
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new CollectorError("transport_error", `FINRA weekly summary request failed: ${error.message}`, { systemic: false });
  }
  const statusCode = response?.statusCode;
  if (statusCode === 204) return { kind: "empty", statusCode, rows: [] };
  if (statusCode === 401 || statusCode === 403) throw new CollectorError("auth_error", `FINRA weekly summary authorization failed: ${statusCode}`, { statusCode, systemic: true, auth: "rejected" });
  if (statusCode === 429) throw new CollectorError("rate_limited", "FINRA weekly summary rate limited", { statusCode, systemic: true, rateLimited: true });
  if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
    throw new CollectorError("http_error", `FINRA weekly summary failed with HTTP ${statusCode}`, { statusCode });
  }
  let rows;
  try {
    rows = JSON.parse(String(response.body ?? ""));
  } catch {
    throw new CollectorError("schema_drift", "FINRA weekly summary response is not JSON", { statusCode, systemic: true });
  }
  if (!Array.isArray(rows)) throw new CollectorError("schema_drift", "FINRA weekly summary response is not an array", { statusCode, systemic: true });
  const total = paginationHeaders(response.headers, { offset: body.offset, limit: body.limit, rows });
  if (total === 0 && rows.length !== 0) throw new CollectorError("schema_drift", "pagination header mismatch: zero total with rows", { statusCode, systemic: true });
  if (total > 0 && rows.length === 0) throw new CollectorError("schema_drift", "pagination header mismatch: positive total with empty page", { statusCode, systemic: true });
  if (rows.length > total) throw new CollectorError("schema_drift", "pagination header mismatch: page exceeds total", { statusCode, systemic: true });
  return { kind: rows.length === 0 ? "empty" : "rows", statusCode, rows, total };
}

async function fetchSymbolBatch({ request, accessToken, budget, universe, symbols, weekStartDate, tiers, endpoint }) {
  const rows = [];
  const batchSymbolKeys = new Set(symbols.map((symbol) => normalizedSymbol(symbol)));
  let offset = 0;
  let total = null;
  while (true) {
    const body = buildWeeklySummaryBody({ symbols, weekStartDate, tiers, offset });
    const page = await requestPage({ request, accessToken, budget, body, endpoint });
    if (page.kind === "empty") {
      if (offset === 0 && page.total === 0) return { kind: "empty", rows: [] };
      if (offset === 0 && page.statusCode === 204) return { kind: "empty", rows: [] };
      throw new CollectorError("schema_drift", "pagination header mismatch: premature empty page", { statusCode: page.statusCode, systemic: true });
    }
    if (total === null) total = page.total;
    if (total > PAGE_LIMIT) {
      throw new CollectorError("schema_drift", "FINRA weekly summary batch exceeds 5,000-row aggregate grain", { statusCode: page.statusCode, systemic: true });
    }
    if (page.total !== total) throw new CollectorError("schema_drift", "pagination header mismatch: total changed between pages", { statusCode: page.statusCode, systemic: true });
    rows.push(...page.rows);
    if (rows.length > total) throw new CollectorError("schema_drift", "pagination header mismatch: received too many rows", { statusCode: page.statusCode, systemic: true });
    if (rows.length === total) break;
    offset = rows.length;
  }
  if (!rows.every((row) => validSummaryRow(row, { weekStartDate, tiers, universe, batchSymbolKeys }))) {
    throw new CollectorError("schema_drift", "FINRA weekly summary row shape or tier/source-date validation failed", { systemic: true });
  }
  return { kind: "ready", rows };
}

async function fetchCandidate({ request, accessToken, budget, universe, weekStartDate, tiers, endpoint }) {
  const rows = [];
  for (const symbols of batchTrackedSymbols(universe.query_symbols)) {
    const batch = await fetchSymbolBatch({ request, accessToken, budget, universe, symbols, weekStartDate, tiers, endpoint });
    if (batch.kind === "ready") rows.push(...batch.rows);
  }
  return rows.length === 0 ? { kind: "empty", rows: [] } : { kind: "ready", rows };
}

export async function collectPartition({ request = defaultRequest, accessToken, budget, universe, partition, endpoint = WEEKLY_SUMMARY_ENDPOINT }) {
  if (!partition || !Array.isArray(partition.tier_identifiers) || !Array.isArray(partition.walkback_week_starts)) {
    throw new CollectorError("schema_drift", "weekly summary partition is invalid", { systemic: true });
  }
  for (const weekStartDate of partition.walkback_week_starts) {
    const candidate = await fetchCandidate({
      request,
      accessToken,
      budget,
      universe,
      weekStartDate,
      tiers: partition.tier_identifiers,
      endpoint,
    });
    if (candidate.kind === "ready") {
      return { complete: true, summary_start_date: weekStartDate, rows: candidate.rows, tier_identifiers: [...partition.tier_identifiers] };
    }
  }
  return { complete: false, reason: "empty_after_walkback", rows: [], tier_identifiers: [...partition.tier_identifiers] };
}

export function markerPathFor(repoRoot = DEFAULT_REPO_ROOT) {
  return path.join(repoRoot, "data", "admin", "finra-ats", "current", "weekly-summary.json");
}

function weeksRootFor(repoRoot = DEFAULT_REPO_ROOT) {
  return path.join(repoRoot, "data", "admin", "finra-ats", "weeks");
}

function rawWeekPathFor(repoRoot, summaryStartDate) {
  return path.join(weeksRootFor(repoRoot), `${summaryStartDate}.json`);
}

export function buildMarker({ generatedAt, partitions }) {
  if (!Array.isArray(partitions) || partitions.length !== 2 || !partitions.every((partition) => Array.isArray(partition.rows))) {
    throw new Error("complete T1 and T2/OTCE partitions are required for marker");
  }
  const normalized = partitions.map((partition) => ({
    tier_group: partition.tier_group,
    tier_identifiers: [...partition.tier_identifiers],
    summary_start_date: partition.summary_start_date,
    row_count: partition.rows.length,
  }));
  const t1 = normalized.find((partition) => partition.tier_group === "t1");
  const t2Otce = normalized.find((partition) => partition.tier_group === "t2_otce");
  if (!t1 || !t2Otce || !isoDate(t1.summary_start_date) || !isoDate(t2Otce.summary_start_date)) {
    throw new Error("marker partitions are invalid");
  }
  return {
    schema_version: FINRA_ATS_MARKER_SCHEMA,
    lane_id: FINRA_ATS_LANE_ID,
    source_as_of: [t1.summary_start_date, t2Otce.summary_start_date].sort()[0],
    generated_at: generatedAt,
    raw_public: false,
    public_mirror_allowed: false,
    rows_included: false,
    counts: {
      total_rows: t1.row_count + t2Otce.row_count,
      t1_rows: t1.row_count,
      t2_otce_rows: t2Otce.row_count,
    },
    partitions: [t1, t2Otce],
  };
}

export function validMarker(marker) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)
    || marker.schema_version !== FINRA_ATS_MARKER_SCHEMA || marker.lane_id !== FINRA_ATS_LANE_ID
    || !isoDate(marker.source_as_of) || typeof marker.generated_at !== "string" || !marker.generated_at.endsWith("Z")
    || marker.raw_public !== false || marker.public_mirror_allowed !== false || marker.rows_included !== false
    || Object.hasOwn(marker, "rows") || !Array.isArray(marker.partitions) || marker.partitions.length !== 2) return false;
  const counts = marker.counts;
  if (!counts || ![counts.total_rows, counts.t1_rows, counts.t2_otce_rows].every((value) => Number.isInteger(value) && value >= 0)
    || counts.total_rows !== counts.t1_rows + counts.t2_otce_rows) return false;
  const groups = new Set();
  for (const partition of marker.partitions) {
    if (!partition || typeof partition !== "object" || !["t1", "t2_otce"].includes(partition.tier_group)
      || groups.has(partition.tier_group) || !Array.isArray(partition.tier_identifiers)
      || !partition.tier_identifiers.every((tier) => ["T1", "T2", "OTCE"].includes(tier))
      || !isoDate(partition.summary_start_date) || !Number.isInteger(partition.row_count) || partition.row_count < 0) return false;
    groups.add(partition.tier_group);
  }
  const t1 = marker.partitions.find((partition) => partition.tier_group === "t1");
  const t2Otce = marker.partitions.find((partition) => partition.tier_group === "t2_otce");
  return groups.size === 2 && t1.row_count === counts.t1_rows && t2Otce.row_count === counts.t2_otce_rows
    && marker.source_as_of === [t1.summary_start_date, t2Otce.summary_start_date].sort()[0];
}

function validRawWeekRow(row, summaryStartDate) {
  return Boolean(row) && typeof row === "object" && !Array.isArray(row)
    && typeof row.issueSymbolIdentifier === "string" && row.issueSymbolIdentifier.trim() !== ""
    && typeof row.issueName === "string" && row.issueName.trim() !== ""
    && row.weekStartDate === summaryStartDate
    && row.summaryStartDate === summaryStartDate && isoDate(row.summaryStartDate)
    && ["T1", "T2", "OTCE"].includes(row.tierIdentifier)
    && SUMMARY_TYPES.includes(row.summaryTypeCode)
    && validNumberLike(row.totalWeeklyShareQuantity)
    && validNumberLike(row.totalWeeklyTradeCount)
    && validNumberLike(row.totalNotionalSum);
}

export function validRawWeekDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)
    || document.schema_version !== RAW_SCHEMA || document.lane_id !== FINRA_ATS_LANE_ID
    || !isoDate(document.summary_start_date) || typeof document.generated_at !== "string" || !document.generated_at.endsWith("Z")
    || document.raw_public !== false || document.public_mirror_allowed !== false
    || document.auth_path !== "oauth_client_credentials" || document.row_shape_valid !== true
    || !Number.isInteger(document.request_count) || document.request_count < 1
    || !isoDate(document.last_completed_monday)
    || !Array.isArray(document.rows) || document.rows.length === 0 || !Array.isArray(document.partitions) || document.partitions.length === 0) return false;
  if (["access_token", "token", "client_secret", "client_id", "body", "request_body", "response_body"].some((key) => Object.hasOwn(document, key))) return false;
  const universe = document.universe;
  if (!universe || universe.source_path !== "data/computed/fenok_signals.json" || !/^[0-9a-f]{64}$/.test(universe.source_sha256 ?? "")
    || ![universe.selected_count, universe.mapped_count, universe.excluded_count].every((value) => Number.isInteger(value) && value >= 0)) return false;
  if (!document.rows.every((row) => validRawWeekRow(row, document.summary_start_date))) return false;
  const partitionRows = document.partitions.reduce((sum, partition) => {
    if (!partition || typeof partition !== "object" || !Array.isArray(partition.tier_identifiers)
      || partition.summary_start_date !== document.summary_start_date || !Number.isInteger(partition.row_count) || partition.row_count < 0) return NaN;
    return sum + partition.row_count;
  }, 0);
  return Number.isInteger(partitionRows) && partitionRows === document.rows.length;
}

export function retainRawWeeks(entries, limit = HISTORY_LIMIT) {
  if (!Array.isArray(entries) || !Number.isInteger(limit) || limit < 1) throw new Error("FINRA ATS raw-week retention inputs are invalid");
  const byDate = new Map();
  for (const document of entries) {
    if (!validRawWeekDocument(document)) throw new Error("invalid FINRA ATS raw-week entry");
    const prior = byDate.get(document.summary_start_date);
    if (!prior || String(document.generated_at) >= String(prior.generated_at)) byDate.set(document.summary_start_date, document);
  }
  return {
    entries: [...byDate.values()].sort((a, b) => b.summary_start_date.localeCompare(a.summary_start_date)).slice(0, limit),
    pruned: Math.max(0, byDate.size - limit),
  };
}

function readWeeksStrict(repoRoot) {
  const root = weeksRootFor(repoRoot);
  if (!fs.existsSync(root)) return [];
  const directoryEntries = fs.readdirSync(root, { withFileTypes: true });
  const unexpected = directoryEntries.find((entry) => (
    !entry.isFile() || !/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)
  ));
  if (unexpected) {
    throw new CollectorError(
      "schema_drift",
      `FINRA ATS weeks directory contains an unexpected entry: ${unexpected.name}`,
      { systemic: true },
    );
  }
  const entries = directoryEntries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const filePath = path.join(root, entry.name);
      let document;
      try {
        document = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (error) {
        throw new CollectorError("schema_drift", `FINRA ATS retained week is invalid: ${error.message}`, { systemic: true });
      }
      if (!validRawWeekDocument(document) || path.basename(filePath, ".json") !== document.summary_start_date) {
        throw new CollectorError("schema_drift", "FINRA ATS retained week contract is invalid", { systemic: true });
      }
      return { filePath, document };
    });
  // Validate before any new raw/current write; malformed retained evidence is
  // never silently repaired by deleting it.
  retainRawWeeks(entries.map((entry) => entry.document));
  return entries;
}

function writeWeeks(repoRoot, entries, priorEntries) {
  const retained = retainRawWeeks(entries);
  const retainedDates = new Set(retained.entries.map((document) => document.summary_start_date));
  for (const document of retained.entries) {
    atomicWrite(rawWeekPathFor(repoRoot, document.summary_start_date), `${JSON.stringify(document, null, 2)}\n`);
  }
  for (const prior of priorEntries) {
    if (!retainedDates.has(prior.document.summary_start_date)) fs.unlinkSync(prior.filePath);
  }
  return retained;
}

function markerSourceAsOf(marker) {
  return validMarker(marker) ? marker.source_as_of : null;
}

function lkgArtifact(markerPath) {
  return {
    key: FINRA_ATS_LKG_KEY,
    canonicalPath: markerPath,
    validateDocument: validMarker,
    sourceAsOf: markerSourceAsOf,
  };
}

function atsLkgStore(repoRoot) {
  // The registry lane id is finra_ats_weekly while the approved admin storage
  // root is the human-facing data/admin/finra-ats/. Keep the state lane id for
  // KPI attribution, but bind every on-disk recovery path to that approved root.
  const store = new LaneLkgStore({ repoRoot, laneId: FINRA_ATS_LANE_ID });
  store.adminRoot = path.join(repoRoot, "data", "admin", "finra-ats");
  store.lkgRoot = path.join(store.adminRoot, "lkg");
  store.statePath = path.join(store.adminRoot, "index.json");
  store._lkgRelativePath = (key) => `data/admin/finra-ats/lkg/${key}.json`;
  return store;
}

function rawWeekDocuments({ generatedAt, targets, t1, t2Otce, budget, universe, authPath }) {
  const fragments = [
    { tier_group: "t1", tier_identifiers: ["T1"], summary_start_date: t1.summary_start_date, rows: t1.rows },
    {
      tier_group: "t2_otce",
      tier_identifiers: ["T2", "OTCE"],
      summary_start_date: t2Otce.summary_start_date,
      rows: t2Otce.rows,
    },
  ];
  const byDate = new Map();
  for (const fragment of fragments) {
    const prior = byDate.get(fragment.summary_start_date) ?? [];
    prior.push(fragment);
    byDate.set(fragment.summary_start_date, prior);
  }
  return [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([summaryStartDate, dateFragments]) => {
    const rows = dateFragments.flatMap((fragment) => fragment.rows);
    return {
      schema_version: RAW_SCHEMA,
      lane_id: FINRA_ATS_LANE_ID,
      summary_start_date: summaryStartDate,
      generated_at: generatedAt,
      raw_public: false,
      public_mirror_allowed: false,
      auth_path: authPath,
      row_shape_valid: true,
      request_count: budget.used,
      last_completed_monday: targets.last_completed_monday,
      universe: {
        source_path: universe.universe_relative_path,
        source_sha256: universe.universe_sha256,
        selected_count: universe.counts.selected,
        mapped_count: universe.counts.mapped,
        excluded_count: universe.counts.excluded,
      },
      partitions: dateFragments.map((fragment) => ({
        tier_group: fragment.tier_group,
        tier_identifiers: fragment.tier_identifiers,
        summary_start_date: fragment.summary_start_date,
        row_count: fragment.rows.length,
      })),
      rows,
    };
  });
}

function controlledFailureRequested(value, eventName) {
  const raw = String(value ?? "").trim();
  if (raw === "") return false;
  if (eventName !== "workflow_dispatch") throw new CollectorError("schema_drift", "controlled failure requires workflow_dispatch", { systemic: true });
  const values = raw.split(",").map((token) => token.trim());
  if (values.length !== 1 || !["transport", FINRA_ATS_LANE_ID].includes(values[0])) {
    throw new CollectorError("schema_drift", "unknown FINRA ATS controlled failure lane", { systemic: true });
  }
  return true;
}

function failureAttempt(error) {
  if (error?.reason === "controlled_failure") return attemptResult("transport_error", threwTuple("transport"));
  if (error?.reason === "auth_error") return attemptResult("auth_error", returnedTuple({ httpStatus: error.statusCode ?? 401, auth: "rejected" }));
  if (error?.reason === "rate_limited") return attemptResult("rate_limited", returnedTuple({ httpStatus: error.statusCode ?? 429, auth: error.auth ?? "ok", rateLimited: true }));
  if (error?.reason === "schema_drift" || error?.reason === "budget_exceeded") {
    return attemptResult("schema_drift", returnedTuple({
      httpStatus: error.statusCode ?? 200,
      auth: error.auth ?? "ok",
      decode: "ok",
      payload: "non_empty",
      assertions: ATTEMPT_ASSERTION_IDS.map((id) => ({ id, passed: false })),
    }));
  }
  if (error?.reason === "partial_partition") {
    return attemptResult("empty_payload", returnedTuple({
      httpStatus: 204,
      auth: error.auth ?? "ok",
      decode: "ok",
      payload: "empty",
      assertions: ATTEMPT_ASSERTION_IDS.map((id) => ({ id, passed: false })),
    }));
  }
  if (error?.reason === "http_error") return attemptResult("http_error", returnedTuple({ httpStatus: error.statusCode ?? 500, auth: error.auth ?? "ok" }));
  return attemptResult("unexpected_error", threwTuple("unexpected"));
}

function successAttempt(rows) {
  const document = { rows, row_shape_valid: true };
  return attemptResult("ok", returnedTuple({
    httpStatus: 200,
    auth: "ok",
    decode: "ok",
    payload: "non_empty",
    assertions: ATTEMPT_ASSERTION_IDS.map((id) => ({ id, passed: true })),
  }), document);
}

function safeFailure(store, artifact, runContext, error) {
  const reason = error.reason === "budget_exceeded" ? "unexpected_error" : error.reason;
  const failure = store.recordFailure({ artifacts: [artifact], run: runContext, reason });
  return { ...classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg, systemic: error.systemic === true }), retry_set: failure.retrySet };
}

export async function run({
  repoRoot = DEFAULT_REPO_ROOT,
  request = defaultRequest,
  clientId = process.env.FINRA_API_CLIENT_ID || "",
  clientSecret = process.env.FINRA_API_CLIENT_SECRET || "",
  controlledFailureLanes = process.env.INPUT_CONTROLLED_FAILURE || process.env.INPUT_CONTROLLED_FAILURE_LANES || "",
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("finra-ats-weekly", observedAt),
  referenceDate = new Date(),
  tokenEndpoint = TOKEN_ENDPOINT,
  weeklySummaryEndpoint = WEEKLY_SUMMARY_ENDPOINT,
  attemptWriter = writeAttemptShard,
} = {}) {
  const resolvedRoot = path.resolve(repoRoot);
  const markerPath = markerPathFor(resolvedRoot);
  const attemptShardPath = path.join(resolvedRoot, "data", "admin", "data-supply-state", "detection-attempts", "finra_ats.json");
  const runContext = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const store = atsLkgStore(resolvedRoot);
  const artifact = lkgArtifact(markerPath);
  let attempt = attemptResult("unexpected_error", threwTuple("unexpected"));
  let response = { exit_code: 2, degraded: false, corrupt: true, promoted: false, reason: "unexpected_error" };
  try {
    // Fail closed before raw/current writes if recovery state is malformed.
    const snapshot = store.stateSnapshot();
    const priorWeeks = readWeeksStrict(resolvedRoot);
    const controlled = controlledFailureRequested(controlledFailureLanes, eventName);
    if (controlled) {
      const error = new CollectorError("controlled_failure", "controlled FINRA ATS failure", { systemic: false });
      const disposition = safeFailure(store, artifact, runContext, error);
      attempt = failureAttempt(error);
      response = { exit_code: disposition.exitCode, degraded: disposition.degraded, corrupt: disposition.corrupt, promoted: false, reason: error.reason, controlled_failure: true, retry_set: disposition.retry_set };
      return response;
    }

    const universe = loadTrackedUniverse(resolvedRoot);
    const budget = createRequestBudget(MAX_REQUESTS);
    const token = await acquireAccessToken({ request, budget, clientId, clientSecret, tokenEndpoint });
    const targets = summaryTargets(referenceDate);
    const t1 = await collectPartition({ request, accessToken: token.access_token, budget, universe, partition: targets.t1, endpoint: weeklySummaryEndpoint });
    const t2Otce = await collectPartition({
      request,
      accessToken: token.access_token,
      budget,
      universe,
      partition: targets.t2_otce,
      endpoint: weeklySummaryEndpoint,
    });
    if (!t1.complete || !t2Otce.complete) {
      throw new CollectorError("partial_partition", "one or more FINRA ATS weekly partitions were unavailable after walkback");
    }
    const marker = buildMarker({
      generatedAt: observedAt,
      partitions: [
        { tier_group: "t1", tier_identifiers: ["T1"], summary_start_date: t1.summary_start_date, rows: t1.rows },
        {
          tier_group: "t2_otce",
          tier_identifiers: ["T2", "OTCE"],
          summary_start_date: t2Otce.summary_start_date,
          rows: t2Otce.rows,
        },
      ],
    });
    const markerBytes = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`, "utf8");
    const candidate = {
      key: FINRA_ATS_LKG_KEY,
      currentRelativePath: path.relative(resolvedRoot, markerPath).split(path.sep).join("/"),
      payloadBytes: markerBytes,
      sourceAsOf: marker.source_as_of,
      validateDocument: validMarker,
      deriveSourceAsOf: markerSourceAsOf,
      promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
      provider_observation: buildProviderObservationV2({
        payloadBytes: markerBytes,
        sourceAsOf: marker.source_as_of,
        validateDocument: validMarker,
        deriveSourceAsOf: markerSourceAsOf,
        candidateContainsObservation: (candidateDocument, providerDocument) => JSON.stringify(candidateDocument) === JSON.stringify(providerDocument),
        run: runContext,
      }),
    };
    const prior = snapshot.items[FINRA_ATS_LKG_KEY];
    const priorSource = prior?.current?.source_as_of;
    if (prior?.retry !== true && typeof priorSource === "string" && Date.parse(marker.source_as_of) <= Date.parse(priorSource)) {
      attempt = successAttempt([...t1.rows, ...t2Otce.rows]);
      response = { exit_code: 0, degraded: false, corrupt: false, promoted: false, reason: "not_newer", auth_path: token.auth_path, source_as_of: marker.source_as_of, request_count: budget.used };
      return response;
    }
    const [decision] = store.evaluatePromotionCandidates([candidate], runContext);
    if (!decision.eligible) {
      if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
        store.recordPromotionDeferral({ artifacts: [candidate], run: runContext, reason: decision.reason });
      }
      attempt = successAttempt([...t1.rows, ...t2Otce.rows]);
      response = { exit_code: 0, degraded: true, corrupt: false, promoted: false, reason: decision.reason, auth_path: token.auth_path, source_as_of: marker.source_as_of, request_count: budget.used };
      return response;
    }

    // All provider pages and both tier-delay groups are complete before the
    // first candidate write. No partial raw/current candidate is materialized.
    const rawWeeks = rawWeekDocuments({
      generatedAt: observedAt,
      targets,
      t1,
      t2Otce,
      budget,
      universe,
      authPath: token.auth_path,
    });
    writeWeeks(resolvedRoot, [...rawWeeks, ...priorWeeks.map((entry) => entry.document)], priorWeeks);
    atomicWrite(markerPath, markerBytes);
    const success = store.recordSuccess({ artifacts: [candidate], run: runContext });
    attempt = successAttempt([...t1.rows, ...t2Otce.rows]);
    response = { exit_code: 0, degraded: false, corrupt: false, promoted: true, recovered: success.state.items[FINRA_ATS_LKG_KEY]?.recovered_at === observedAt, auth_path: token.auth_path, source_as_of: marker.source_as_of, request_count: budget.used, counts: marker.counts };
    return response;
  } catch (caught) {
    const error = caught instanceof CollectorError
      ? caught
      : new CollectorError("unexpected_error", caught?.message ?? String(caught), { systemic: true });
    attempt = failureAttempt(error);
    try {
      const disposition = safeFailure(store, artifact, runContext, error);
      response = { exit_code: disposition.exitCode, degraded: disposition.degraded, corrupt: disposition.corrupt, promoted: false, reason: error.reason, retry_set: disposition.retry_set };
    } catch (stateError) {
      response = { exit_code: 2, degraded: false, corrupt: true, promoted: false, reason: error.reason, state_error: stateError.message };
    }
    return response;
  } finally {
    attemptWriter({ laneId: FINRA_ATS_LANE_ID, attemptShardPath, observedAt, attemptId, result: attempt });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().then((summary) => {
    // Keep CLI output body-free: token, raw rows, and provider response bodies
    // never cross stdout.
    console.log(JSON.stringify(summary));
    if (summary.exit_code > 0) process.exitCode = summary.exit_code;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 2;
  });
}
