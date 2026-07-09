#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = path.resolve(ROOT, "..", "data", "stockanalysis");
const DETAIL_DIR = path.join(SOURCE_DIR, "etfs");
const PLAN_PATH = path.join(SOURCE_DIR, "backfill", "incremental_plan_latest.json");
const PENDING_LEDGER_PATH = path.join(SOURCE_DIR, "backfill", "pending_ledger.json");
const REPORT_PATH = path.join(SOURCE_DIR, "backfill", "history_gap_report_latest.json");
const PUBLIC_REPORT_PATH = path.join(ROOT, "public", "data", "stockanalysis", "backfill", "history_gap_report_latest.json");
const AUDIT_PATH = path.resolve(ROOT, "..", "data", "computed", "market_data_audit.json");
const DEFAULT_REQUIRED_PERIODS = ["monthly_3y", "monthly_5y"];
const ALLOWED_PERIODS = new Set(["daily_1y", "weekly_1y", "monthly_1y", "weekly_3y", "monthly_3y", "monthly_5y"]);
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

const args = parseArgs(process.argv.slice(2));
const WRITE_REPORT = args.flags.has("--write-report");
const REQUIRED_PERIODS = parseRequiredPeriods(args.options.get("--required-history-periods") || process.env.INPUT_REQUIRED_HISTORY_PERIODS || "");
const ENFORCE_INCREMENTAL_PLAN = REQUIRED_PERIODS.join(",") === DEFAULT_REQUIRED_PERIODS.join(",");
const RECENT_TERMINAL_MAX_AGE_HOURS = 48;

function parseArgs(argv) {
  const flags = new Set();
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.split("=", 2);
    if (inlineValue !== undefined) {
      options.set(key, inlineValue);
      continue;
    }
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      options.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { flags, options };
}

function parseRequiredPeriods(value) {
  const periods = value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : DEFAULT_REQUIRED_PERIODS;
  const unique = [];
  for (const period of periods) {
    if (!ALLOWED_PERIODS.has(period)) {
      throw new Error(`Unsupported history period: ${period}`);
    }
    if (!unique.includes(period)) unique.push(period);
  }
  if (unique.length === 0) return DEFAULT_REQUIRED_PERIODS;
  return unique;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonOrNull(filePath) {
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function rowsForPeriod(payload, period) {
  const normalized = asObject(payload.normalized);
  const raw = asObject(payload.raw);
  const normalizedPeriods = asObject(normalized.history_periods);
  const rawPeriods = asObject(raw.history_periods);
  if (Array.isArray(normalizedPeriods[period])) return normalizedPeriods[period];
  if (Array.isArray(rawPeriods[period])) return rawPeriods[period];
  return [];
}

function isPrimaryStockAnalysisDetail(payload) {
  if (payload.asset_type !== "etf") return false;
  if (payload.source_provider === "yahoo_finance") return false;
  if (payload.source === "yahoo_finance") return false;
  return true;
}

function isYahooFallbackDetail(payload) {
  return payload?.source_provider === "yahoo_finance"
    || payload?.source === "yahoo_finance"
    || payload?.detail_status === "yf_fallback";
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

function historyPeriodRequiredYears(period) {
  const match = String(period).match(/_(\d+)y$/);
  return match ? Number(match[1]) : null;
}

function parseStockAnalysisDate(value) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const text = value.trim();
  const match = text.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (match) {
    const month = MONTH_NAME_TO_INDEX.get(match[1].toLowerCase());
    if (month === undefined) return null;
    const date = new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
    return Number.isFinite(date.valueOf()) ? date : null;
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

function etfInceptionDate(payload) {
  const normalized = asObject(payload.normalized);
  const raw = asObject(payload.raw);
  const normalizedOverview = asObject(normalized.overview);
  const rawOverview = asObject(raw.overview);
  const candidates = [
    normalizedOverview.inception,
    rawOverview.inception,
    normalized.inceptionDate,
    raw.inceptionDate,
    payload.inceptionDate,
  ];
  for (const candidate of candidates) {
    const parsed = parseStockAnalysisDate(candidate);
    if (parsed) return parsed;
  }
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
      const years = historyPeriodRequiredYears(period);
      if (years && ageDays < years * 365) {
        inceptionLimited.push(period);
      } else {
        fetchable.push(period);
      }
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

const DAILY_1Y_MIN_ROWS = 200;

function classifyDaily1yGap(payload, now = new Date(), pendingEntry = null) {
  const rows = rowsForPeriod(payload, "daily_1y");
  const actualRows = Array.isArray(rows) ? rows.length : 0;
  if (actualRows >= DAILY_1Y_MIN_ROWS) {
    return { complete: true, actualRows, fetchable: [], inceptionLimited: [], terminalLimited: [] };
  }
  const gap = classifyHistoryGap(payload, ["daily_1y"], now, pendingEntry);
  return {
    complete: false,
    actualRows,
    fetchable: gap.fetchable,
    inceptionLimited: gap.inceptionLimited,
    terminalLimited: gap.terminalLimited,
    terminalLimitSource: gap.terminalLimitSource,
    inceptionDate: gap.inceptionDate,
  };
}

function percent(part, total) {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
}

function writeJson(filePath, payload) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function tickersFromRows(rows) {
  if (!Array.isArray(rows)) return [];
  const tickers = rows
    .map((row) => {
      if (typeof row === "string") return row.trim();
      if (row && typeof row === "object" && typeof row.ticker === "string") return row.ticker.trim();
      return "";
    })
    .filter(Boolean);
  return Array.from(new Set(tickers)).sort();
}

function differenceFromSet(tickers, allowed) {
  return tickers.filter((ticker) => !allowed.has(ticker));
}

function main() {
  if (!existsSync(DETAIL_DIR)) {
    throw new Error(`ETF detail directory not found: ${DETAIL_DIR}`);
  }

  const detailFiles = readdirSync(DETAIL_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();

  const primaryRows = [];
  const completeRows = [];
  const missingRows = [];
  const fetchableGapRows = [];
  const inceptionLimitedRows = [];
  const terminalLimitedRows = [];
  const missingByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));
  const fetchableByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));
  const inceptionLimitedByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));
  const terminalLimitedByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));

  const daily1yCompleteRows = [];
  const daily1yFetchableRows = [];
  const daily1yInceptionLimitedRows = [];
  const daily1yTerminalLimitedRows = [];
  const now = new Date();
  const pendingLedger = existsSync(PENDING_LEDGER_PATH) ? readJson(PENDING_LEDGER_PATH) : null;
  const pendingEntries = asObject(pendingLedger?.entries);

  for (const fileName of detailFiles) {
    const payload = readJson(path.join(DETAIL_DIR, fileName));
    const ticker = payload.ticker || fileName.replace(/\.json$/, "");
    const pendingEntry = asObject(pendingEntries[ticker]);

    // Daily 1Y continuity check applies to every ETF detail file, not only primary StockAnalysis payloads.
    const daily1yGap = classifyDaily1yGap(payload, now, pendingEntry);
    if (daily1yGap.complete) {
      daily1yCompleteRows.push({ ticker, actual_rows: daily1yGap.actualRows });
    } else if (daily1yGap.fetchable.length > 0) {
      daily1yFetchableRows.push({
        ticker,
        actual_rows: daily1yGap.actualRows,
        fetchable_missing: daily1yGap.fetchable,
        inception_limited_missing: daily1yGap.inceptionLimited,
        inception_date: daily1yGap.inceptionDate,
        daily_1y_gap_source: daily1yFetchableSource(payload),
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
      });
    } else if (daily1yGap.terminalLimited.length > 0) {
      daily1yTerminalLimitedRows.push({
        ticker,
        actual_rows: daily1yGap.actualRows,
        fetchable_missing: daily1yGap.fetchable,
        inception_limited_missing: daily1yGap.inceptionLimited,
        terminal_limited_missing: daily1yGap.terminalLimited,
        terminal_limit_source: daily1yGap.terminalLimitSource,
        inception_date: daily1yGap.inceptionDate,
        daily_1y_gap_source: daily1yGap.terminalLimitSource,
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
        pending_consecutive_failures: Number(pendingEntry.consecutive_failures || 0),
        pending_next_attempt_after_utc: pendingEntry.next_attempt_after_utc || null,
      });
    } else if (daily1yGap.inceptionLimited.length > 0) {
      daily1yInceptionLimitedRows.push({
        ticker,
        actual_rows: daily1yGap.actualRows,
        fetchable_missing: daily1yGap.fetchable,
        inception_limited_missing: daily1yGap.inceptionLimited,
        inception_date: daily1yGap.inceptionDate,
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
      });
    }

    if (!isPrimaryStockAnalysisDetail(payload)) continue;
    const missing = REQUIRED_PERIODS.filter((period) => rowsForPeriod(payload, period).length === 0);
    const gap = classifyHistoryGap(payload, missing, now, pendingEntry);
    const row = {
      ticker,
      missing,
      fetchable_missing: gap.fetchable,
      inception_limited_missing: gap.inceptionLimited,
      terminal_limited_missing: gap.terminalLimited,
      terminal_limit_source: gap.terminalLimitSource,
      inception_date: gap.inceptionDate,
    };
    primaryRows.push(row);
    if (missing.length === 0) {
      completeRows.push(row);
    } else {
      missingRows.push(row);
      for (const period of missing) missingByPeriod[period] += 1;
      if (gap.fetchable.length > 0) {
        fetchableGapRows.push(row);
        for (const period of gap.fetchable) fetchableByPeriod[period] += 1;
      }
      if (gap.inceptionLimited.length > 0 && gap.fetchable.length === 0) {
        inceptionLimitedRows.push(row);
      }
      for (const period of gap.inceptionLimited) inceptionLimitedByPeriod[period] += 1;
      if (gap.terminalLimited.length > 0 && gap.fetchable.length === 0) {
        terminalLimitedRows.push(row);
      }
      for (const period of gap.terminalLimited) terminalLimitedByPeriod[period] += 1;
    }
  }

  const plan = existsSync(PLAN_PATH) ? readJson(PLAN_PATH) : null;
  const audit = existsSync(AUDIT_PATH) ? readJson(AUDIT_PATH) : null;
  const planRequiredPeriods = Array.isArray(plan?.required_history_periods) ? plan.required_history_periods : [];
  const planBackfill = asObject(plan?.incremental_etf_backfill);
  const nestedSelectedTickers = tickersFromRows(planBackfill.selected);
  const planSelectedTickers = nestedSelectedTickers.length > 0 ? nestedSelectedTickers : tickersFromRows(plan?.etfs);
  const planInceptionTickers = tickersFromRows(planBackfill.inception_limited);
  const planTotalTickers = Array.from(new Set([...planSelectedTickers, ...planInceptionTickers])).sort();
  const fetchableScanTickers = new Set(tickersFromRows(fetchableGapRows));
  const inceptionScanTickers = new Set(tickersFromRows(inceptionLimitedRows));
  const missingScanTickers = new Set(tickersFromRows(missingRows));
  const subsetMissingTickers = {
    fetchable: differenceFromSet(planSelectedTickers, fetchableScanTickers),
    total: differenceFromSet(planTotalTickers, missingScanTickers),
    inception_limited: differenceFromSet(planInceptionTickers, inceptionScanTickers),
  };
  const subsetOfFullScan = {
    fetchable: subsetMissingTickers.fetchable.length === 0,
    total: subsetMissingTickers.total.length === 0,
    inception_limited: subsetMissingTickers.inception_limited.length === 0,
    missing_tickers: subsetMissingTickers,
  };
  const strictCountMatches = {
    current_gap: Number(plan?.counts?.history_gap || 0) === fetchableGapRows.length,
    total_gap: Number(plan?.counts?.total_history_gap ?? plan?.counts?.history_gap ?? 0) === missingRows.length,
    inception_limited: Number(plan?.counts?.inception_limited_history_gap || 0) === inceptionLimitedRows.length,
    required_periods: planRequiredPeriods.join(",") === REQUIRED_PERIODS.join(","),
  };
  const enforceIncrementalPlan = ENFORCE_INCREMENTAL_PLAN && strictCountMatches.required_periods;
  const marketFacts = asObject(audit?.market_facts);
  const return3y = asObject(marketFacts.return_field_coverage).return_3y_avg || {};
  const denominators = asObject(marketFacts.return_field_denominators);

  // Separate daily-1Y gap view for the scored/public ETF universe (the denominator that matters for done claims).
  const scoredEtfSummary = readJsonOrNull(path.join(SOURCE_DIR, "..", "computed", "fenok_etf_signals_summary.json"));
  const scoredEtfTickers = new Set(
    (Array.isArray(scoredEtfSummary?.rows) ? scoredEtfSummary.rows : [])
      .map((row) => String(row?.ticker ?? "").trim().toUpperCase())
      .filter(Boolean),
  );
  const scoredDaily1yCompleteRows = [];
  const scoredDaily1yFetchableRows = [];
  const scoredDaily1yInceptionLimitedRows = [];
  const scoredDaily1yTerminalLimitedRows = [];
  for (const ticker of scoredEtfTickers) {
    const filePath = path.join(DETAIL_DIR, `${ticker}.json`);
    const pendingEntry = asObject(pendingEntries[ticker]);
    if (!existsSync(filePath)) {
      const terminalLimitSource = terminalDaily1yGapSource(null, pendingEntry, now);
      const row = {
        ticker,
        actual_rows: 0,
        missing_file: true,
        daily_1y_gap_source: terminalLimitSource || daily1yFetchableSource(null, { missingFile: true, pendingEntry }),
        terminal_limit_source: terminalLimitSource,
        pending_consecutive_failures: Number(pendingEntry.consecutive_failures || 0),
        pending_next_attempt_after_utc: pendingEntry.next_attempt_after_utc || null,
      };
      if (terminalLimitSource) {
        row.terminal_limited_missing = ["daily_1y"];
        scoredDaily1yTerminalLimitedRows.push(row);
      } else {
        scoredDaily1yFetchableRows.push(row);
      }
      continue;
    }
    const payload = readJson(filePath);
    const gap = classifyDaily1yGap(payload, now, pendingEntry);
    if (gap.complete) {
      scoredDaily1yCompleteRows.push({ ticker, actual_rows: gap.actualRows });
    } else if (gap.fetchable.length > 0) {
      scoredDaily1yFetchableRows.push({
        ticker,
        actual_rows: gap.actualRows,
        fetchable_missing: gap.fetchable,
        inception_limited_missing: gap.inceptionLimited,
        inception_date: gap.inceptionDate,
        daily_1y_gap_source: daily1yFetchableSource(payload),
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
      });
    } else if (gap.terminalLimited.length > 0) {
      scoredDaily1yTerminalLimitedRows.push({
        ticker,
        actual_rows: gap.actualRows,
        fetchable_missing: gap.fetchable,
        inception_limited_missing: gap.inceptionLimited,
        terminal_limited_missing: gap.terminalLimited,
        terminal_limit_source: gap.terminalLimitSource,
        inception_date: gap.inceptionDate,
        daily_1y_gap_source: gap.terminalLimitSource,
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
        pending_consecutive_failures: Number(pendingEntry.consecutive_failures || 0),
        pending_next_attempt_after_utc: pendingEntry.next_attempt_after_utc || null,
      });
    } else if (gap.inceptionLimited.length > 0) {
      scoredDaily1yInceptionLimitedRows.push({
        ticker,
        actual_rows: gap.actualRows,
        fetchable_missing: gap.fetchable,
        inception_limited_missing: gap.inceptionLimited,
        inception_date: gap.inceptionDate,
        source_provider: payload.source_provider || payload.source || null,
        detail_status: payload.detail_status || null,
      });
    }
  }

  const report = {
    schema_version: "stockanalysis-history-gap-report/v1",
    generated_at: new Date().toISOString(),
    required_history_periods: REQUIRED_PERIODS,
    primary_stockanalysis_detail_files: primaryRows.length,
    complete_required_history: completeRows.length,
    missing_required_history: missingRows.length,
    fetchable_required_history: fetchableGapRows.length,
    inception_limited_required_history: inceptionLimitedRows.length,
    terminal_limited_required_history: terminalLimitedRows.length,
    coverage_pct: percent(completeRows.length, primaryRows.length),
    missing_by_period: missingByPeriod,
    fetchable_by_period: fetchableByPeriod,
    inception_limited_by_period: inceptionLimitedByPeriod,
    terminal_limited_by_period: terminalLimitedByPeriod,
    samples: {
      missing: missingRows.slice(0, 10),
      fetchable: fetchableGapRows.slice(0, 10),
      inception_limited: inceptionLimitedRows.slice(0, 10),
      terminal_limited: terminalLimitedRows.slice(0, 10),
      complete: completeRows.slice(0, 5),
    },
    daily_1y_gap: {
      min_rows: DAILY_1Y_MIN_ROWS,
      detail_files_scanned: detailFiles.length,
      complete: daily1yCompleteRows.length,
      missing: daily1yFetchableRows.length + daily1yInceptionLimitedRows.length + daily1yTerminalLimitedRows.length,
      fetchable: daily1yFetchableRows.length,
      inception_limited: daily1yInceptionLimitedRows.length,
      terminal_limited: daily1yTerminalLimitedRows.length,
      fetchable_breakdown: summarizeFetchableBreakdown(daily1yFetchableRows),
      terminal_limited_breakdown: summarizeFetchableBreakdown(daily1yTerminalLimitedRows),
      samples: {
        fetchable: daily1yFetchableRows.slice(0, 10),
        inception_limited: daily1yInceptionLimitedRows.slice(0, 10),
        terminal_limited: daily1yTerminalLimitedRows.slice(0, 10),
        complete: daily1yCompleteRows.slice(0, 5),
      },
      scored_etfs: {
        scored_etf_count: scoredEtfTickers.size,
        complete: scoredDaily1yCompleteRows.length,
        missing: scoredDaily1yFetchableRows.length + scoredDaily1yInceptionLimitedRows.length + scoredDaily1yTerminalLimitedRows.length,
        fetchable: scoredDaily1yFetchableRows.length,
        inception_limited: scoredDaily1yInceptionLimitedRows.length,
        terminal_limited: scoredDaily1yTerminalLimitedRows.length,
        fetchable_breakdown: summarizeFetchableBreakdown(scoredDaily1yFetchableRows),
        terminal_limited_breakdown: summarizeFetchableBreakdown(scoredDaily1yTerminalLimitedRows),
        samples: {
          fetchable: scoredDaily1yFetchableRows.slice(0, 10),
          inception_limited: scoredDaily1yInceptionLimitedRows.slice(0, 10),
          terminal_limited: scoredDaily1yTerminalLimitedRows.slice(0, 10),
          complete: scoredDaily1yCompleteRows.slice(0, 5),
        },
      },
      caveat: "StockAnalysis ETF detail daily 1Y continuity is required; fetchable gaps are the immediate backfill queue. Inception-limited and recent terminal provider-limited gaps are tracked but do not block by themselves.",
    },
    incremental_plan: plan
      ? {
          generated_at: plan.generated_at,
          operation: plan.operation,
          mode: plan.mode,
          network: plan.policy?.network,
          required_history_periods: planRequiredPeriods,
          counts: plan.counts,
          first5: Array.isArray(plan.etfs) ? plan.etfs.slice(0, 5) : [],
          matches_current_gap: strictCountMatches.current_gap,
          matches_total_gap: strictCountMatches.total_gap,
          matches_inception_limited: strictCountMatches.inception_limited,
          matches_required_periods: strictCountMatches.required_periods,
          strict_count_matches: strictCountMatches,
          subset_of_full_scan: subsetOfFullScan,
          enforcement: {
            enforced: enforceIncrementalPlan,
            caveat: enforceIncrementalPlan
              ? "The default required-history report enforces incremental_plan consistency."
              : ENFORCE_INCREMENTAL_PLAN && !strictCountMatches.required_periods
                ? "The current incremental_plan targets different required_history_periods and is informational for this default report."
              : "Non-default reports, including daily_1y ETF continuity, keep incremental_plan consistency informational because exact ETF fetchable selection is emitted separately.",
          },
        }
      : null,
    market_facts_return_3y: {
      etf: Number(return3y.etf || 0),
      stockanalysis_history: Number(return3y.stockanalysis_history || 0),
      etf_coverage_pct: Number(return3y.etf_coverage_pct || 0),
      etf_denominator: Number(denominators.etf || 0),
      stockanalysis_universe_denominator: Number(denominators.stockanalysis_universe || 0),
    },
    recommended_dispatch: fetchableGapRows.length > 0 && REQUIRED_PERIODS.join(",") !== "daily_1y"
      ? {
          status: "manual_dispatch_recommended",
          workflow: "fetch-stockanalysis.yml",
          inputs: {
            history_gaps_only: "true",
            required_history_periods: REQUIRED_PERIODS.join(","),
            incremental_etf_limit: "120",
          },
          note: "Default multi-year required-history gaps are not the daily 1Y scheduled catch-up lane; external manual dispatch still requires explicit owner approval.",
        }
      : scoredDaily1yFetchableRows.length > 0
        ? {
            status: "scheduled_backfill_active",
            workflow: "fetch-stockanalysis.yml",
            schedule: "50 22 * * 1-5",
            schedule_kst: "Tue-Sat 07:50",
            inputs: {
              history_gaps_only: "true",
              required_history_periods: "daily_1y",
              incremental_etf_limit: "120",
            },
            note: "The weekday scheduled lane drains scored ETF daily 1Y continuity gaps at 120 per run. Manual reruns remain owner-gated and this diagnostic lane is not the ETF service gate.",
          }
        : {
            status: "not_recommended",
            workflow: "fetch-stockanalysis.yml",
            inputs: null,
            note: "No current scored ETF daily 1Y gap is immediately fetchable. Remaining gaps are inception-limited or recent terminal provider-limited states that the scheduled lane will revisit as they age or cooldown expires.",
          },
  };

  console.log(JSON.stringify(report, null, 2));

  if (WRITE_REPORT) {
    writeJson(REPORT_PATH, report);
    writeJson(PUBLIC_REPORT_PATH, report);
    console.error(`wrote ${REPORT_PATH}`);
    console.error(`wrote ${PUBLIC_REPORT_PATH}`);
  }

  if (plan && report.incremental_plan.enforcement.enforced && !report.incremental_plan.subset_of_full_scan.fetchable) {
    throw new Error(
      `incremental_plan selected tickers are not in current fetchable full-scan: ${report.incremental_plan.subset_of_full_scan.missing_tickers.fetchable.join(",")}`,
    );
  }
  if (plan && report.incremental_plan.enforcement.enforced && !report.incremental_plan.subset_of_full_scan.total) {
    throw new Error(
      `incremental_plan total tickers are not in current missing full-scan: ${report.incremental_plan.subset_of_full_scan.missing_tickers.total.join(",")}`,
    );
  }
  if (plan && report.incremental_plan.enforcement.enforced && !report.incremental_plan.subset_of_full_scan.inception_limited) {
    throw new Error(
      `incremental_plan inception-limited tickers are not in current inception-limited full-scan: ${report.incremental_plan.subset_of_full_scan.missing_tickers.inception_limited.join(",")}`,
    );
  }
}

main();
