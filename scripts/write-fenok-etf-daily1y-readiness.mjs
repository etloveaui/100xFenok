#!/usr/bin/env node
/**
 * Persist a no-fetch S3 ETF daily 1Y readiness artifact.
 *
 * This script turns the existing StockAnalysis history-gap scan into a durable
 * admin-only readiness artifact. It does not fetch remote data and it does not
 * promote ETF coverage to DAILY/GATED while fetchable gaps remain.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isDaily1yReport,
  reportClassificationDate,
} from "../100xfenok-next/scripts/history-gap-profile.mjs";
import { createEffectiveEtfDetailReader } from "./effective-etf-detail-reader.mjs";
import {
  classifyDaily1yShortHistory,
  daily1yClassificationProjection,
  daily1ySeriesEvidence,
} from "./lib/etf-daily1y-history-classifier.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_REL_PATH = "data/admin/fenok-edge-etf-daily1y-readiness.json";
const FETCHABLE_PLAN_REL_PATH = "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json";
const DAILY_1Y_MIN_ROWS = 200;
const STOCKANALYSIS_DETAIL_DIR_REL = "data/stockanalysis/etfs";
const YF_FINANCE_DIR_REL = "data/yf/finance";
const PENDING_LEDGER_REL = "data/stockanalysis/backfill/pending_ledger.json";
const RECENT_TERMINAL_MAX_AGE_HOURS = 48;
const MONTH_NAME_TO_INDEX = new Map([
  ["jan", 0],
  ["january", 0],
  ["feb", 1],
  ["february", 1],
  ["mar", 2],
  ["march", 2],
  ["apr", 3],
  ["april", 3],
  ["may", 4],
  ["jun", 5],
  ["june", 5],
  ["jul", 6],
  ["july", 6],
  ["aug", 7],
  ["august", 7],
  ["sep", 8],
  ["sept", 8],
  ["september", 8],
  ["oct", 9],
  ["october", 9],
  ["nov", 10],
  ["november", 10],
  ["dec", 11],
  ["december", 11],
]);

function parseArgs(argv) {
  const dataRootIndex = argv.indexOf("--data-root");
  const dataRootEquals = argv.find((arg) => arg.startsWith("--data-root="));
  return {
    check: argv.includes("--check"),
    noWrite: argv.includes("--no-write"),
    json: argv.includes("--json"),
    dataRoot: path.resolve(
      dataRootEquals?.slice("--data-root=".length)
        ?? (dataRootIndex >= 0 ? argv[dataRootIndex + 1] : REPO_ROOT),
    ),
  };
}

function abs(relPath, rootDir = REPO_ROOT) {
  return path.join(rootDir, relPath);
}

function readJson(relPath, rootDir = REPO_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(abs(relPath, rootDir), "utf8"));
  } catch (error) {
    throw new Error(`${relPath} read failed: ${error.message}`);
  }
}

function readJsonOrNull(relPath, rootDir = REPO_ROOT) {
  try {
    return readJson(relPath, rootDir);
  } catch {
    return null;
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function writeJson(relPath, payload, rootDir = REPO_ROOT) {
  const target = abs(relPath, rootDir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function findTrack(index, id) {
  return asArray(index?.public_scoring_readiness?.tracks).find((track) => track?.id === id) ?? null;
}

function findDailyCheck(readiness, id) {
  return asArray(readiness?.daily_checks).find((check) => check?.id === id) ?? null;
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function rowsForPeriod(payload, period) {
  const normalizedPeriods = asObject(asObject(payload?.normalized).history_periods);
  const rawPeriods = asObject(asObject(payload?.raw).history_periods);
  if (Array.isArray(normalizedPeriods[period])) return normalizedPeriods[period];
  if (Array.isArray(rawPeriods[period])) return rawPeriods[period];
  return [];
}

function isYahooFallbackDetail(payload) {
  return payload?.source_provider === "yahoo_finance"
    || payload?.source === "yahoo_finance"
    || payload?.detail_status === "yf_fallback";
}

function isPrimaryStockAnalysisDetail(payload) {
  return payload?.asset_type === "etf"
    && payload?.source_provider !== "yahoo_finance"
    && payload?.source !== "yahoo_finance";
}

function missingFailureBucket(entry) {
  const reason = String(entry?.failure_reason || "");
  if (reason.includes("quoteType is not ETF/MUTUALFUND")) return "missing_external_quote_type_mismatch";
  if (reason.includes("HTTP Error 404")) return "missing_source_unavailable";
  if (reason) return "missing_other_error";
  return "missing_untracked";
}

function daily1yFetchableSource(payload, { missingFile = false, pendingEntry = null } = {}) {
  if (missingFile) return missingFailureBucket(pendingEntry);
  if (isYahooFallbackDetail(payload)) return "yahoo_fallback_short_rows";
  if (isPrimaryStockAnalysisDetail(payload)) return "stockanalysis_short_rows";
  return "other_detail_short_rows";
}

function summarizeFetchableBreakdown(rows) {
  const counts = {};
  const samples = {};
  for (const row of rows) {
    const bucket = row.daily_1y_gap_source || "unknown";
    counts[bucket] = (counts[bucket] || 0) + 1;
    samples[bucket] = samples[bucket] || [];
    if (samples[bucket].length < 10) samples[bucket].push(row.ticker);
  }
  return {
    counts: Object.fromEntries(Object.entries(counts).sort()),
    samples: Object.fromEntries(Object.entries(samples).sort()),
  };
}

function parseStockAnalysisDate(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const text = value.trim();
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const month = MONTH_NAME_TO_INDEX.get(match[1].toLowerCase());
    if (month === undefined) return null;
    const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
    return Number.isFinite(date.valueOf())
      && date.getUTCFullYear() === Number(match[3])
      && date.getUTCMonth() === month
      && date.getUTCDate() === Number(match[2])
      ? date
      : null;
  }
  const isoMs = Date.parse(text);
  return Number.isFinite(isoMs) ? new Date(isoMs) : null;
}

function parseHistoryRowDate(row) {
  if (!row || typeof row !== "object") return null;
  for (const key of ["date", "t", "time"]) {
    const value = row[key];
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const ms = value > 10_000_000_000 ? value : value * 1000;
      const parsed = new Date(ms);
      if (Number.isFinite(parsed.valueOf())) return parsed;
    }
  }
  return null;
}

function earliestHistoryDate(rows) {
  let earliest = null;
  for (const row of asArray(rows)) {
    const parsed = parseHistoryRowDate(row);
    if (parsed && (!earliest || parsed < earliest)) earliest = parsed;
  }
  return earliest;
}

function parseTimestamp(value) {
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isFinite(parsed.valueOf()) ? parsed : null;
  }
  return null;
}

function ageHours(value, now = new Date()) {
  const parsed = parseTimestamp(value);
  if (!parsed) return null;
  return Math.max(0, (now.valueOf() - parsed.valueOf()) / 36e5);
}

function hasRecentPendingFailure(entry, now = new Date()) {
  const reason = String(entry?.failure_reason || "");
  if (!reason) return false;
  const lastAge = ageHours(entry?.last_attempt_utc, now);
  if (lastAge != null && lastAge <= RECENT_TERMINAL_MAX_AGE_HOURS) return true;
  const nextAttempt = parseTimestamp(entry?.next_attempt_after_utc);
  return Boolean(nextAttempt && nextAttempt > now);
}

function terminalDaily1yGapSource(payload, pendingEntry = null, now = new Date()) {
  const reason = String(pendingEntry?.failure_reason || "");
  if (hasRecentPendingFailure(pendingEntry, now)) {
    if (pendingEntry?.failure_class === "successful_short_history") {
      return "successful_short_history_cooldown";
    }
    if (reason.includes("quoteType is not ETF/MUTUALFUND")) return "provider_rejected_non_etf";
    if (reason.includes("HTTP Error 404")) return "source_unavailable_recent_failure";
    return "provider_recent_failure";
  }
  const fetchedAge = ageHours(payload?.fetched_at, now);
  if (fetchedAge != null && fetchedAge <= RECENT_TERMINAL_MAX_AGE_HOURS) {
    if (isYahooFallbackDetail(payload)) return "yahoo_fallback_recent_short_rows";
    if (isPrimaryStockAnalysisDetail(payload)) return "stockanalysis_recent_short_rows";
    return "other_recent_short_rows";
  }
  return null;
}

function etfDeclaredInception(payload) {
  const normalized = asObject(payload?.normalized);
  const raw = asObject(payload?.raw);
  const normalizedOverview = asObject(normalized.overview);
  const rawOverview = asObject(raw.overview);
  const candidates = [
    [normalizedOverview.inception, "normalized.overview.inception"],
    [rawOverview.inception, "raw.overview.inception"],
    [normalized.inceptionDate, "normalized.inceptionDate"],
    [raw.inceptionDate, "raw.inceptionDate"],
    [payload?.inceptionDate, "inceptionDate"],
  ];
  for (const [candidate, source] of candidates) {
    const parsed = parseStockAnalysisDate(candidate);
    if (parsed) return { date: parsed, source };
  }
  return { date: null, source: null };
}

export function etfInceptionDate(payload) {
  const declared = etfDeclaredInception(payload);
  if (declared.date) return declared.date;
  if (isYahooFallbackDetail(payload)) {
    return earliestHistoryDate(rowsForPeriod(payload, "daily_1y"));
  }
  return null;
}

function classifyHistoryGap(payload, missing, now = new Date(), pendingEntry = null) {
  const inception = etfInceptionDate(payload);
  const fetchable = [];
  const inceptionLimited = [];
  const terminalLimited = [];
  let terminalLimitSource = null;
  if (!inception) {
    fetchable.push(...missing);
  } else {
    const ageDays = Math.max(0, Math.floor((now.valueOf() - inception.valueOf()) / 86400000));
    for (const period of missing) {
      const years = Number(String(period).match(/_(\d+)y$/)?.[1] ?? 0);
      if (years && ageDays < years * 365) inceptionLimited.push(period);
      else fetchable.push(period);
    }
  }
  if (fetchable.includes("daily_1y")) {
    terminalLimitSource = terminalDaily1yGapSource(payload, pendingEntry, now);
    if (terminalLimitSource) {
      fetchable.splice(fetchable.indexOf("daily_1y"), 1);
      terminalLimited.push("daily_1y");
    }
  }
  return {
    fetchable,
    inceptionLimited,
    terminalLimited,
    terminalLimitSource,
    inceptionDate: inception ? inception.toISOString().slice(0, 10) : null,
  };
}

export function classifyDaily1yGap(payload, now = new Date(), pendingEntry = null, yfRows = []) {
  const rows = rowsForPeriod(payload, "daily_1y");
  const actualRows = daily1ySeriesEvidence(rows, now).valid_unique_date_count;
  if (actualRows >= DAILY_1Y_MIN_ROWS) {
    return { complete: true, actualRows, fetchable: [], inceptionLimited: [], terminalLimited: [], inceptionDate: null };
  }
  const declared = etfDeclaredInception(payload);
  const shortHistory = classifyDaily1yShortHistory({
    rows,
    yfRows,
    declaredInception: declared.date,
    declaredInceptionSource: declared.source,
    pendingEntry,
    now,
    selfHistoryAuthoritative: isYahooFallbackDetail(payload),
  });
  const evidence = { ...shortHistory };
  delete evidence.category;
  delete evidence.policy;
  const fetchable = shortHistory.category === "fetchable" ? ["daily_1y"] : [];
  const inceptionLimited = shortHistory.category === "inception_limited" ? ["daily_1y"] : [];
  const terminalLimited = shortHistory.category === "terminal_limited" ? ["daily_1y"] : [];
  let terminalLimitSource = shortHistory.category === "terminal_limited"
    ? shortHistory.classification_reason
    : null;
  if (fetchable.length > 0) {
    terminalLimitSource = terminalDaily1yGapSource(payload, pendingEntry, now);
    if (terminalLimitSource) {
      if (shortHistory.classification_reason === "provider_truncated_suspected") {
        terminalLimitSource = "provider_truncated_suspected";
      }
      fetchable.length = 0;
      terminalLimited.push("daily_1y");
    }
  }
  return {
    complete: false,
    actualRows,
    fetchable,
    inceptionLimited,
    terminalLimited,
    terminalLimitSource,
    inceptionDate: shortHistory.effective_start_date,
    classificationReason: shortHistory.classification_reason,
    classificationEvidence: evidence,
  };
}

function yfHistoryRows(ticker, rootDir = REPO_ROOT) {
  const relPath = `${YF_FINANCE_DIR_REL}/${ticker}.json`;
  const payload = readJsonOrNull(relPath, rootDir);
  const rows = payload?.data?.history_1y;
  return Array.isArray(rows) ? rows : null;
}

function daily1yGapProvenance(gap, payload) {
  return {
    classification_reason: gap.classificationReason ?? null,
    payload_fetched_at: payload?.fetched_at ?? null,
    daily_1y_classification: gap.classificationEvidence ?? null,
  };
}

function compactRows(rows) {
  return asArray(rows).slice(0, 10).map((row) => ({
    ticker: row?.ticker ?? null,
    actual_rows: row?.actual_rows ?? null,
    missing_file: row?.missing_file === true,
    inception_date: row?.inception_date ?? null,
    classification_reason: row?.classification_reason ?? null,
    effective_start_source: row?.daily_1y_classification?.effective_start_source ?? null,
  }));
}

function classificationEvidenceRow(row, bucket) {
  const evidence = row?.daily_1y_classification ?? {};
  return {
    ticker: row?.ticker ?? null,
    classification_bucket: bucket,
    classification_reason: row?.classification_reason ?? null,
    terminal_limit_source: row?.terminal_limit_source ?? null,
    payload_fetched_at: row?.payload_fetched_at ?? null,
    classification_as_of: evidence.classification_as_of ?? null,
    declared_inception_date: evidence.declared_inception_date ?? null,
    declared_inception_source_field: evidence.declared_inception_source_field ?? null,
    declared_inception_valid: evidence.declared_inception_valid === true,
    declared_inception_invalid_future: evidence.declared_inception_invalid_future === true,
    daily_1y_row_count: evidence.daily_1y_row_count ?? null,
    daily_1y_valid_unique_date_count: evidence.daily_1y_valid_unique_date_count ?? null,
    daily_1y_earliest_observation: evidence.daily_1y_earliest_observation ?? null,
    daily_1y_latest_observation: evidence.daily_1y_latest_observation ?? null,
    daily_1y_expected_trading_days: evidence.daily_1y_expected_trading_days ?? null,
    daily_1y_density: evidence.daily_1y_density ?? null,
    daily_1y_max_internal_gap_days: evidence.daily_1y_max_internal_gap_days ?? null,
    latest_observation_age_days: evidence.latest_observation_age_days ?? null,
    latest_observation_age_business_days: evidence.latest_observation_age_business_days ?? null,
    effective_start_date: evidence.effective_start_date ?? null,
    effective_start_source: evidence.effective_start_source ?? null,
    yf_crosscheck_rows: evidence.yf_crosscheck_rows ?? null,
    yf_crosscheck_earliest: evidence.yf_crosscheck_earliest ?? null,
    provider_truncation_suspected: evidence.provider_truncation_suspected === true,
    cross_provider_start_confirmed: evidence.cross_provider_start_confirmed === true,
    stable_observation_confirmed: evidence.stable_observation_confirmed === true,
    stable_observation_pinned_start: evidence.stable_observation_pinned_start ?? null,
    detail_source_kind: row?.detail_source_kind ?? null,
  };
}

function requireDate(value, label) {
  if (value === null || value === undefined || value === "") {
    throw new TypeError(`${label} must be a valid timestamp`);
  }
  const parsed = value instanceof Date ? new Date(value.valueOf()) : new Date(value);
  if (!Number.isFinite(parsed.valueOf())) throw new TypeError(`${label} must be a valid timestamp`);
  return parsed;
}

export function buildScoredEtfDaily1yFetchablePlan({
  signalSummary,
  historyGap,
  coverageIndex,
  generatedAt = new Date(),
  classificationAsOf,
  rootDir = REPO_ROOT,
} = {}) {
  const generatedAtDate = requireDate(generatedAt, "generatedAt");
  const classificationDate = requireDate(classificationAsOf, "classificationAsOf");
  if (classificationDate.valueOf() > generatedAtDate.valueOf()) {
    throw new Error("classificationAsOf must not be later than generatedAt");
  }
  const classificationIso = classificationDate.toISOString();
  const summaryRows = asArray(signalSummary?.rows);
  const summaryTickers = [...new Set(summaryRows.map((row) => normalizeTicker(row?.ticker)).filter(Boolean))].sort();
  const scored = historyGap?.daily_1y_gap?.scored_etfs ?? {};
  const s3Track = findTrack(coverageIndex, "etf_scoring_lane");
  const readiness = s3Track?.evidence_based_readiness ?? coverageIndex?.etf_universe?.evidence_based_readiness ?? null;
  const generatedDailyCheck = findDailyCheck(readiness, "etf_no_fetchable_daily_1y_gap");
  const pendingEntries = asObject(readJsonOrNull(PENDING_LEDGER_REL, rootDir)?.entries);
  const effectiveDetailReader = createEffectiveEtfDetailReader({ rootDir });

  const completeRows = [];
  const fetchableRows = [];
  const inceptionLimitedRows = [];
  const terminalLimitedRows = [];
  const yfRows = {
    complete: [],
    fetchable_or_missing: [],
  };
  const effectiveResolutionCounts = {
    stockanalysis_primary: 0,
    r2_active_selection: 0,
    r2_unavailable: 0,
    missing: 0,
  };

  for (const ticker of summaryTickers) {
    const yfHistory = yfHistoryRows(ticker, rootDir);
    const yfRowsCount = Array.isArray(yfHistory) ? yfHistory.length : null;
    const pendingEntry = asObject(pendingEntries[ticker]);
    const yfMissing = yfRowsCount == null || yfRowsCount < DAILY_1Y_MIN_ROWS;
    const yfRow = {
      ticker,
      yf_history_rows: yfRowsCount,
      yf_missing_file_or_history: yfRowsCount == null,
    };
    if (yfMissing) yfRows.fetchable_or_missing.push(yfRow);
    else yfRows.complete.push(yfRow);

    const resolved = effectiveDetailReader.resolve(ticker);
    effectiveResolutionCounts[resolved.sourceKind] = asNumber(effectiveResolutionCounts[resolved.sourceKind]) + 1;
    const resolutionEvidence = {
      detail_source_kind: resolved.sourceKind,
      primary_present: resolved.primaryPresent,
      data_supply_status: resolved.status,
      data_supply_resolution_state: resolved.selection?.resolution_state ?? null,
    };
    if (resolved.status === "unavailable") {
      terminalLimitedRows.push({
        ticker,
        actual_rows: 0,
        missing_file: true,
        yf_history_rows: yfRowsCount,
        terminal_limited_missing: ["daily_1y"],
        terminal_limit_source: "data_supply_unavailable",
        daily_1y_gap_source: "data_supply_unavailable",
        pending_consecutive_failures: asNumber(pendingEntry.consecutive_failures),
        pending_next_attempt_after_utc: pendingEntry.next_attempt_after_utc ?? null,
        ...resolutionEvidence,
      });
      continue;
    }
    if (resolved.status === "missing") {
      const terminalLimitSource = terminalDaily1yGapSource(null, pendingEntry, classificationDate);
      const row = {
        ticker,
        actual_rows: 0,
        missing_file: true,
        yf_history_rows: yfRowsCount,
        daily_1y_gap_source: terminalLimitSource || daily1yFetchableSource(null, { missingFile: true, pendingEntry }),
        terminal_limit_source: terminalLimitSource,
        pending_consecutive_failures: asNumber(pendingEntry.consecutive_failures),
        pending_next_attempt_after_utc: pendingEntry.next_attempt_after_utc ?? null,
        ...resolutionEvidence,
      };
      if (terminalLimitSource) {
        row.terminal_limited_missing = ["daily_1y"];
        terminalLimitedRows.push(row);
      } else {
        fetchableRows.push(row);
      }
      continue;
    }

    const payload = resolved.payload;
    const gap = classifyDaily1yGap(payload, classificationDate, pendingEntry, yfHistory || []);
    if (gap.complete) {
      completeRows.push({
        ticker,
        actual_rows: gap.actualRows,
        yf_history_rows: yfRowsCount,
        ...resolutionEvidence,
      });
    } else if (gap.fetchable.length > 0) {
      fetchableRows.push({
        ticker,
        actual_rows: gap.actualRows,
        missing_file: false,
        fetchable_missing: gap.fetchable,
        inception_limited_missing: gap.inceptionLimited,
        inception_date: gap.inceptionDate,
        yf_history_rows: yfRowsCount,
        daily_1y_gap_source: daily1yFetchableSource(payload),
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
        ...daily1yGapProvenance(gap, payload),
        ...resolutionEvidence,
      });
    } else if (gap.terminalLimited.length > 0) {
      terminalLimitedRows.push({
        ticker,
        actual_rows: gap.actualRows,
        missing_file: false,
        fetchable_missing: gap.fetchable,
        inception_limited_missing: gap.inceptionLimited,
        terminal_limited_missing: gap.terminalLimited,
        terminal_limit_source: gap.terminalLimitSource,
        inception_date: gap.inceptionDate,
        yf_history_rows: yfRowsCount,
        daily_1y_gap_source: gap.terminalLimitSource,
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
        pending_consecutive_failures: asNumber(pendingEntry.consecutive_failures),
        pending_next_attempt_after_utc: pendingEntry.next_attempt_after_utc ?? null,
        ...daily1yGapProvenance(gap, payload),
        ...resolutionEvidence,
      });
    } else if (gap.inceptionLimited.length > 0) {
      inceptionLimitedRows.push({
        ticker,
        actual_rows: gap.actualRows,
        missing_file: false,
        fetchable_missing: gap.fetchable,
        inception_limited_missing: gap.inceptionLimited,
        inception_date: gap.inceptionDate,
        yf_history_rows: yfRowsCount,
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
        ...daily1yGapProvenance(gap, payload),
        ...resolutionEvidence,
      });
    }
  }

  const denominator = summaryTickers.length;
  const classificationProjection = daily1yClassificationProjection({
    complete: completeRows,
    fetchable: fetchableRows,
    inceptionLimited: inceptionLimitedRows,
    terminalLimited: terminalLimitedRows,
  });
  const classificationEvidenceRows = [
    ...fetchableRows.map((row) => classificationEvidenceRow(row, "fetchable")),
    ...inceptionLimitedRows.map((row) => classificationEvidenceRow(row, "inception_limited")),
    ...terminalLimitedRows.map((row) => classificationEvidenceRow(row, "terminal_limited")),
  ]
    .filter((row) => row.classification_as_of)
    .sort((left, right) => left.ticker.localeCompare(right.ticker));
  const historyGapProjection = scored.classification_projection;
  const historyGapProjectionOk = Boolean(
    historyGapProjection
      && historyGapProjection.row_count === classificationProjection.row_count
      && historyGapProjection.sha256 === classificationProjection.sha256
      && JSON.stringify(historyGapProjection.reason_counts) === JSON.stringify(classificationProjection.reason_counts)
  );
  const equationOk = completeRows.length + fetchableRows.length + inceptionLimitedRows.length + terminalLimitedRows.length === denominator;
  const historyGapClockOk = historyGap?.classification_as_of === classificationIso;
  const coverageClockOk = !readiness || readiness.classification_as_of === classificationIso;
  const dailyCheckClockOk = !generatedDailyCheck || generatedDailyCheck.classification_as_of === classificationIso;
  const historyGapCountOk = (
    historyGapClockOk
    && asNumber(scored.scored_etf_count) === denominator
    && asNumber(scored.complete) === completeRows.length
    && asNumber(scored.fetchable) === fetchableRows.length
    && asNumber(scored.inception_limited) === inceptionLimitedRows.length
    && asNumber(scored.terminal_limited) === terminalLimitedRows.length
    && historyGapProjectionOk
  );
  const coverageCountOk = !readiness?.counts || (
    coverageClockOk
    && asNumber(readiness.counts.scored_public_etf) === denominator
    && asNumber(readiness.counts.fetchable_daily_1y_gap) === fetchableRows.length
    && asNumber(readiness.counts.inception_limited_daily_1y_gap) === inceptionLimitedRows.length
    && asNumber(readiness.counts.terminal_limited_daily_1y_gap) === terminalLimitedRows.length
  );
  const dailyCheckCountOk = !generatedDailyCheck || (
    dailyCheckClockOk
    && asNumber(generatedDailyCheck.fetchable_daily_1y_gap) === fetchableRows.length
    && asNumber(generatedDailyCheck.inception_limited_daily_1y_gap) === inceptionLimitedRows.length
    && asNumber(generatedDailyCheck.terminal_limited_daily_1y_gap) === terminalLimitedRows.length
  );
  const yfGapCount = yfRows.fetchable_or_missing.length;
  const batchSize = 120;
  const tickers = fetchableRows.map((row) => row.ticker);

  return {
    schema_version: "fenok-edge-etf-daily1y-fetchable-plan/v0.1",
    generated_at: generatedAtDate.toISOString(),
    classification_as_of: classificationIso,
    purpose: "Admin-only no-fetch selector for exact scored ETF daily 1Y fetchable gaps.",
    source_files: {
      etf_signal_summary: "data/computed/fenok_etf_signals_summary.json",
      stockanalysis_detail_dir: STOCKANALYSIS_DETAIL_DIR_REL,
      data_supply_active: "data/admin/data-supply-state/v1/domains/etf_detail/active.json",
      yf_finance_dir: YF_FINANCE_DIR_REL,
      history_gap_report: "data/stockanalysis/backfill/history_gap_report_latest.json",
      coverage_index: "data/admin/fenok-edge-coverage-index.json",
      output: FETCHABLE_PLAN_REL_PATH,
    },
    selector_policy: {
      network: "none",
      writes_raw: false,
      min_daily_1y_rows: DAILY_1Y_MIN_ROWS,
      universe: "scored ETFs from fenok_etf_signals_summary.json",
      dispatch_target: "fetch-stockanalysis.yml",
      dispatch_inputs: {
        history_gaps_only: "true",
        required_history_periods: "daily_1y",
        incremental_etf_limit: String(batchSize),
      },
      caveat: "The exact readiness blocker is effective ETF detail daily_1y continuity: true StockAnalysis primary first, then the verified R2 active selection. Raw local YF is cross-check-only and is never treated as selected authority.",
    },
    counts: {
      scored_etf_count: denominator,
      complete: completeRows.length,
      fetchable: fetchableRows.length,
      inception_limited: inceptionLimitedRows.length,
      terminal_limited: terminalLimitedRows.length,
      missing: fetchableRows.length + inceptionLimitedRows.length + terminalLimitedRows.length,
      equation_ok: equationOk,
      matches_history_gap_report: historyGapCountOk,
      matches_coverage_index: coverageCountOk,
      matches_coverage_index_daily_check: dailyCheckCountOk,
      history_gap_classification_clock_match: historyGapClockOk,
      coverage_index_classification_clock_match: coverageClockOk,
      coverage_index_daily_check_classification_clock_match: dailyCheckClockOk,
      history_gap_classification_projection_match: historyGapProjectionOk,
      classification_projection: classificationProjection,
      fetchable_breakdown: summarizeFetchableBreakdown(fetchableRows).counts,
      terminal_limited_breakdown: summarizeFetchableBreakdown(terminalLimitedRows).counts,
      effective_detail_resolution: effectiveResolutionCounts,
    },
    yf_local_crosscheck: {
      complete: yfRows.complete.length,
      missing_or_lt_min_rows: yfGapCount,
      min_daily_1y_rows: DAILY_1Y_MIN_ROWS,
      matches_exact_fetchable_selector: yfGapCount === fetchableRows.length,
      sample: yfRows.fetchable_or_missing.slice(0, 10),
      caveat: "Do not use the raw local YF-only count as the ETF readiness blocker; it is not R2-selected authority and over-selects versus the exact effective-detail continuity check.",
    },
    bounded_batches: {
      can_drive_bounded_ticker_batches: historyGapCountOk && coverageCountOk && dailyCheckCountOk && equationOk,
      default_batch_size: batchSize,
      batch_count: Math.ceil(tickers.length / batchSize),
      command_template: "fetch-stockanalysis.yml history_gaps_only=true required_history_periods=daily_1y incremental_etf_limit=120",
      first_batch_tickers: tickers.slice(0, batchSize),
    },
    classification_evidence: {
      schema_version: "fenok-edge-etf-daily1y-classification-evidence/v1",
      row_count: classificationEvidenceRows.length,
      rows: classificationEvidenceRows,
    },
    tickers,
    rows: fetchableRows,
    fetchable_breakdown: summarizeFetchableBreakdown(fetchableRows),
    samples: {
      fetchable: compactRows(fetchableRows),
      inception_limited: compactRows(inceptionLimitedRows),
      terminal_limited: compactRows(terminalLimitedRows),
      complete: compactRows(completeRows).slice(0, 5),
    },
  };
}

export function buildEtfDaily1yReadiness({ rootDir = REPO_ROOT, now = new Date() } = {}) {
  const generatedAt = requireDate(now, "now");
  const signalSummary = readJson("data/computed/fenok_etf_signals_summary.json", rootDir);
  const historyGap = readJson("data/stockanalysis/backfill/history_gap_report_latest.json", rootDir);
  if (!isDaily1yReport(historyGap)) {
    throw new Error("history gap report profile mismatch: expected daily_1y report_profile");
  }
  const coverageIndex = readJsonOrNull("data/admin/fenok-edge-coverage-index.json", rootDir);
  const s3Track = findTrack(coverageIndex, "etf_scoring_lane");
  const readiness = s3Track?.evidence_based_readiness ?? coverageIndex?.etf_universe?.evidence_based_readiness ?? null;
  const generatedDailyCheck = findDailyCheck(readiness, "etf_no_fetchable_daily_1y_gap");
  const classificationAsOf = reportClassificationDate(historyGap);
  const fetchablePlan = buildScoredEtfDaily1yFetchablePlan({
    signalSummary,
    historyGap,
    coverageIndex,
    generatedAt,
    classificationAsOf,
    rootDir,
  });

  const scored = historyGap?.daily_1y_gap?.scored_etfs ?? {};
  const denominator = asNumber(fetchablePlan.counts.scored_etf_count);
  const daily1yComplete = asNumber(fetchablePlan.counts.complete);
  const daily1yFetchable = asNumber(fetchablePlan.counts.fetchable);
  const inceptionLimited = asNumber(fetchablePlan.counts.inception_limited);
  const terminalLimited = asNumber(fetchablePlan.counts.terminal_limited);
  const daily1yMissing = asNumber(fetchablePlan.counts.missing, daily1yFetchable + inceptionLimited + terminalLimited);
  const equationTotal = daily1yComplete + daily1yFetchable + inceptionLimited + terminalLimited;
  const countEquationOk = fetchablePlan.counts.equation_ok === true
    && equationTotal === denominator
    && daily1yMissing === daily1yFetchable + inceptionLimited + terminalLimited;
  const summaryRows = asArray(signalSummary?.rows).length;
  const summaryCountOk = summaryRows === denominator;
  const coverageCountOk = !readiness?.counts || (
    asNumber(readiness.counts.scored_public_etf) === denominator
    && asNumber(readiness.counts.fetchable_daily_1y_gap) === daily1yFetchable
    && asNumber(readiness.counts.inception_limited_daily_1y_gap) === inceptionLimited
    && asNumber(readiness.counts.terminal_limited_daily_1y_gap) === terminalLimited
  );
  const dailyCheckCountOk = !generatedDailyCheck || (
    asNumber(generatedDailyCheck.fetchable_daily_1y_gap) === daily1yFetchable
    && asNumber(generatedDailyCheck.inception_limited_daily_1y_gap) === inceptionLimited
    && asNumber(generatedDailyCheck.terminal_limited_daily_1y_gap) === terminalLimited
  );
  const noFetchableDaily1yGap = daily1yFetchable === 0;
  const publicDoneClaimAllowed = Boolean(
    readiness?.public_ready
    && readiness?.daily_ready
    && readiness?.gated_ready
    && noFetchableDaily1yGap
    && fetchablePlan.counts.matches_history_gap_report
    && fetchablePlan.counts.matches_coverage_index
    && fetchablePlan.counts.matches_coverage_index_daily_check
  );

  const errors = [];
  if (!countEquationOk) {
    errors.push({
      id: "daily_1y_count_equation",
      detail: `complete+fetchable+inception_limited+terminal_limited=${equationTotal}, denominator=${denominator}, missing=${daily1yMissing}`,
    });
  }
  if (!summaryCountOk) {
    errors.push({
      id: "etf_signal_summary_row_count",
      detail: `summary_rows=${summaryRows}, denominator=${denominator}`,
    });
  }
  if (!coverageCountOk) {
    errors.push({
      id: "coverage_index_etf_daily1y_count_match",
      detail: "coverage index readiness counts differ from history-gap scored ETF counts",
    });
  }
  if (!dailyCheckCountOk) {
    errors.push({
      id: "coverage_index_daily_check_count_match",
      detail: "coverage index etf_no_fetchable_daily_1y_gap check differs from history-gap scored ETF counts",
    });
  }
  if (!fetchablePlan.counts.equation_ok) {
    errors.push({
      id: "fetchable_plan_count_equation",
      detail: "fetchable plan complete+fetchable+inception_limited does not match scored ETF denominator",
    });
  }
  if (!fetchablePlan.counts.matches_history_gap_report) {
    errors.push({
      id: "fetchable_plan_history_gap_report_match",
      detail: "fetchable plan counts or classification clock differ from the history-gap report",
    });
  }
  if (!fetchablePlan.counts.matches_coverage_index || !fetchablePlan.counts.matches_coverage_index_daily_check) {
    errors.push({
      id: "fetchable_plan_coverage_index_match",
      detail: "fetchable plan counts differ from coverage-index ETF daily readiness counts",
    });
  }

  const payload = {
    ok: errors.length === 0,
    schema_version: "fenok-edge-etf-daily1y-readiness-admin/v0.1",
    generated_at: generatedAt.toISOString(),
    classification_as_of: classificationAsOf.toISOString(),
    purpose: "Admin-only generated S3 ETF daily 1Y readiness evidence. Separates scored ETF public surface from DAILY/GATED readiness.",
    asset_type: "etf",
    stage: s3Track?.stage ?? null,
    readiness_status: publicDoneClaimAllowed ? "ready" : "not_ready",
    public_done_claim_allowed: publicDoneClaimAllowed,
    raw_policy: {
      raw_public: false,
      raw_rows_included: false,
      public_mirror_allowed: false,
      samples_are_diagnostic_only: true,
      service_gate: false,
      service_gate_owner: "data/admin/fenok-etf-core-daily-basket.json",
    },
    source_files: {
      etf_signal_summary: "data/computed/fenok_etf_signals_summary.json",
      history_gap_report: "data/stockanalysis/backfill/history_gap_report_latest.json",
      coverage_index: "data/admin/fenok-edge-coverage-index.json",
      output: OUT_REL_PATH,
      fetchable_plan_output: FETCHABLE_PLAN_REL_PATH,
    },
    daily_1y_readiness: {
      denominator,
      daily_1y_complete: daily1yComplete,
      daily_1y_missing: daily1yMissing,
      daily_1y_fetchable: daily1yFetchable,
      inception_limited_daily_1y_gap: inceptionLimited,
      terminal_limited_daily_1y_gap: terminalLimited,
      fetchable_breakdown: fetchablePlan.fetchable_breakdown,
      terminal_limited_breakdown: fetchablePlan.counts.terminal_limited_breakdown,
      etf_no_fetchable_daily_1y_gap: daily1yFetchable,
      count_equation: "daily_1y_complete + daily_1y_fetchable + inception_limited_daily_1y_gap + terminal_limited_daily_1y_gap == denominator",
      count_equation_ok: countEquationOk,
      no_fetchable_daily_1y_gap: noFetchableDaily1yGap,
      daily_ready: Boolean(readiness?.daily_ready),
      gated_ready: Boolean(readiness?.gated_ready),
      blockers: [
        ...(noFetchableDaily1yGap ? [] : ["etf_no_fetchable_daily_1y_gap"]),
        ...(readiness?.gated_ready ? [] : ["gated_ready"]),
      ],
      claim_scope: "full_scored_etf_universe_diagnostic",
      service_gate: false,
      caveat: "Only immediately fetchable daily 1Y gaps block the full scored-ETF diagnostic lane. ETF Core Daily Basket is the service daily/gated target; inception-limited and recent provider-terminal gaps are tracked but do not block by themselves.",
    },
    generated_count_checks: {
      summary_rows: summaryRows,
      summary_count_ok: summaryCountOk,
      coverage_index_count_ok: coverageCountOk,
      coverage_index_daily_check_count_ok: dailyCheckCountOk,
      coverage_index_fetchable_daily_1y_gap: readiness?.counts?.fetchable_daily_1y_gap ?? null,
      coverage_index_inception_limited_daily_1y_gap: readiness?.counts?.inception_limited_daily_1y_gap ?? null,
      coverage_index_terminal_limited_daily_1y_gap: readiness?.counts?.terminal_limited_daily_1y_gap ?? null,
      history_gap_report_count_ok: fetchablePlan.counts.matches_history_gap_report,
      history_gap_classification_clock_match: fetchablePlan.counts.history_gap_classification_clock_match,
      coverage_index_classification_clock_match: fetchablePlan.counts.coverage_index_classification_clock_match,
      coverage_index_daily_check_classification_clock_match: fetchablePlan.counts.coverage_index_daily_check_classification_clock_match,
      history_gap_report_scored_etf_count: asNumber(scored.scored_etf_count),
      history_gap_report_fetchable_daily_1y_gap: asNumber(scored.fetchable),
      history_gap_report_inception_limited_daily_1y_gap: asNumber(scored.inception_limited),
      history_gap_report_terminal_limited_daily_1y_gap: asNumber(scored.terminal_limited),
    },
    samples: {
      fetchable: compactRows(fetchablePlan.rows),
      inception_limited: compactRows(fetchablePlan.samples?.inception_limited),
      terminal_limited: compactRows(fetchablePlan.samples?.terminal_limited),
      complete: compactRows(fetchablePlan.samples?.complete).slice(0, 5),
    },
    exact_fetchable_plan: {
      output: FETCHABLE_PLAN_REL_PATH,
      fetchable_count: fetchablePlan.counts.fetchable,
      ticker_count: fetchablePlan.tickers.length,
      can_drive_bounded_ticker_batches: fetchablePlan.bounded_batches.can_drive_bounded_ticker_batches,
      batch_count: fetchablePlan.bounded_batches.batch_count,
      default_batch_size: fetchablePlan.bounded_batches.default_batch_size,
      yf_local_crosscheck_gap_count: fetchablePlan.yf_local_crosscheck.missing_or_lt_min_rows,
      yf_local_crosscheck_matches: fetchablePlan.yf_local_crosscheck.matches_exact_fetchable_selector,
      caveat: fetchablePlan.selector_policy.caveat,
    },
    recommended_dispatch: historyGap.recommended_dispatch ?? null,
    errors,
  };
  Object.defineProperty(payload, "fetchable_plan", {
    value: fetchablePlan,
    enumerable: false,
  });
  return payload;
}

function printHuman(payload) {
  const r = payload.daily_1y_readiness;
  console.log(`Fenok Edge ETF daily 1Y readiness: ${payload.ok ? "PASS" : "FAIL"}`);
  console.log(`- denominator=${r.denominator} complete=${r.daily_1y_complete} fetchable=${r.daily_1y_fetchable} inception_limited=${r.inception_limited_daily_1y_gap} terminal_limited=${r.terminal_limited_daily_1y_gap}`);
  console.log(`- count_equation_ok=${r.count_equation_ok} public_done_claim_allowed=${payload.public_done_claim_allowed} blockers=${r.blockers.join(",") || "none"}`);
  for (const error of payload.errors) console.error(`ERROR: ${error.id}: ${error.detail}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildEtfDaily1yReadiness({ rootDir: args.dataRoot });

  if (!args.noWrite) {
    writeJson(OUT_REL_PATH, payload, args.dataRoot);
    writeJson(FETCHABLE_PLAN_REL_PATH, payload.fetchable_plan, args.dataRoot);
  }
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else printHuman(payload);

  if (args.check && !payload.ok) process.exitCode = 1;
}
