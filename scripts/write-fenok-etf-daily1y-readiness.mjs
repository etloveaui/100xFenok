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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_REL_PATH = "data/admin/fenok-edge-etf-daily1y-readiness.json";
const FETCHABLE_PLAN_REL_PATH = "data/admin/fenok-edge-etf-daily1y-fetchable-plan.json";
const DAILY_1Y_MIN_ROWS = 200;
const STOCKANALYSIS_DETAIL_DIR_REL = "data/stockanalysis/etfs";
const YF_FINANCE_DIR_REL = "data/yf/finance";
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
  return {
    check: argv.includes("--check"),
    noWrite: argv.includes("--no-write"),
    json: argv.includes("--json"),
  };
}

function abs(relPath) {
  return path.join(REPO_ROOT, relPath);
}

function readJson(relPath) {
  try {
    return JSON.parse(fs.readFileSync(abs(relPath), "utf8"));
  } catch (error) {
    throw new Error(`${relPath} read failed: ${error.message}`);
  }
}

function readJsonOrNull(relPath) {
  try {
    return readJson(relPath);
  } catch {
    return null;
  }
}

function fileExists(relPath) {
  return fs.existsSync(abs(relPath));
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

function writeJson(relPath, payload) {
  const target = abs(relPath);
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

function etfInceptionDate(payload) {
  const normalized = asObject(payload?.normalized);
  const raw = asObject(payload?.raw);
  const normalizedOverview = asObject(normalized.overview);
  const rawOverview = asObject(raw.overview);
  const candidates = [
    normalizedOverview.inception,
    rawOverview.inception,
    normalized.inceptionDate,
    raw.inceptionDate,
    payload?.inceptionDate,
  ];
  for (const candidate of candidates) {
    const parsed = parseStockAnalysisDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function classifyHistoryGap(payload, missing, now = new Date()) {
  const inception = etfInceptionDate(payload);
  const fetchable = [];
  const inceptionLimited = [];
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
  return {
    fetchable,
    inceptionLimited,
    inceptionDate: inception ? inception.toISOString().slice(0, 10) : null,
  };
}

function classifyDaily1yGap(payload, now = new Date()) {
  const rows = rowsForPeriod(payload, "daily_1y");
  const actualRows = Array.isArray(rows) ? rows.length : 0;
  if (actualRows >= DAILY_1Y_MIN_ROWS) {
    return { complete: true, actualRows, fetchable: [], inceptionLimited: [], inceptionDate: null };
  }
  const gap = classifyHistoryGap(payload, ["daily_1y"], now);
  return {
    complete: false,
    actualRows,
    fetchable: gap.fetchable,
    inceptionLimited: gap.inceptionLimited,
    inceptionDate: gap.inceptionDate,
  };
}

function yfHistoryRows(ticker) {
  const relPath = `${YF_FINANCE_DIR_REL}/${ticker}.json`;
  const payload = readJsonOrNull(relPath);
  const rows = payload?.data?.history_1y;
  return Array.isArray(rows) ? rows.length : null;
}

function compactRows(rows) {
  return asArray(rows).slice(0, 10).map((row) => ({
    ticker: row?.ticker ?? null,
    actual_rows: row?.actual_rows ?? null,
    missing_file: row?.missing_file === true,
    inception_date: row?.inception_date ?? null,
  }));
}

export function buildScoredEtfDaily1yFetchablePlan({ signalSummary, historyGap, coverageIndex, now = new Date() } = {}) {
  const summaryRows = asArray(signalSummary?.rows);
  const summaryTickers = [...new Set(summaryRows.map((row) => normalizeTicker(row?.ticker)).filter(Boolean))].sort();
  const scored = historyGap?.daily_1y_gap?.scored_etfs ?? {};
  const s3Track = findTrack(coverageIndex, "etf_scoring_lane");
  const readiness = s3Track?.evidence_based_readiness ?? coverageIndex?.etf_universe?.evidence_based_readiness ?? null;
  const generatedDailyCheck = findDailyCheck(readiness, "etf_no_fetchable_daily_1y_gap");

  const completeRows = [];
  const fetchableRows = [];
  const inceptionLimitedRows = [];
  const yfRows = {
    complete: [],
    fetchable_or_missing: [],
  };

  for (const ticker of summaryTickers) {
    const yfRowsCount = yfHistoryRows(ticker);
    const yfMissing = yfRowsCount == null || yfRowsCount < DAILY_1Y_MIN_ROWS;
    const yfRow = {
      ticker,
      yf_history_rows: yfRowsCount,
      yf_missing_file_or_history: yfRowsCount == null,
    };
    if (yfMissing) yfRows.fetchable_or_missing.push(yfRow);
    else yfRows.complete.push(yfRow);

    const detailRelPath = `${STOCKANALYSIS_DETAIL_DIR_REL}/${ticker}.json`;
    if (!fileExists(detailRelPath)) {
      fetchableRows.push({
        ticker,
        actual_rows: 0,
        missing_file: true,
        yf_history_rows: yfRowsCount,
      });
      continue;
    }

    const payload = readJson(detailRelPath);
    const gap = classifyDaily1yGap(payload, now);
    if (gap.complete) {
      completeRows.push({
        ticker,
        actual_rows: gap.actualRows,
        yf_history_rows: yfRowsCount,
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
      });
    }
  }

  const denominator = summaryTickers.length;
  const equationOk = completeRows.length + fetchableRows.length + inceptionLimitedRows.length === denominator;
  const historyGapCountOk = (
    asNumber(scored.scored_etf_count) === denominator
    && asNumber(scored.complete) === completeRows.length
    && asNumber(scored.fetchable) === fetchableRows.length
    && asNumber(scored.inception_limited) === inceptionLimitedRows.length
  );
  const coverageCountOk = !readiness?.counts || (
    asNumber(readiness.counts.scored_public_etf) === denominator
    && asNumber(readiness.counts.fetchable_daily_1y_gap) === fetchableRows.length
    && asNumber(readiness.counts.inception_limited_daily_1y_gap) === inceptionLimitedRows.length
  );
  const dailyCheckCountOk = !generatedDailyCheck || (
    asNumber(generatedDailyCheck.fetchable_daily_1y_gap) === fetchableRows.length
    && asNumber(generatedDailyCheck.inception_limited_daily_1y_gap) === inceptionLimitedRows.length
  );
  const yfGapCount = yfRows.fetchable_or_missing.length;
  const batchSize = 120;
  const tickers = fetchableRows.map((row) => row.ticker);

  return {
    schema_version: "fenok-edge-etf-daily1y-fetchable-plan/v0.1",
    generated_at: new Date().toISOString(),
    purpose: "Admin-only no-fetch selector for exact scored ETF daily 1Y fetchable gaps.",
    source_files: {
      etf_signal_summary: "data/computed/fenok_etf_signals_summary.json",
      stockanalysis_detail_dir: STOCKANALYSIS_DETAIL_DIR_REL,
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
      caveat: "The exact 584 readiness blocker is StockAnalysis ETF detail daily_1y continuity. Local YF history_1y is reported as a cross-check only because the local YF cache is partial and would select a much broader set.",
    },
    counts: {
      scored_etf_count: denominator,
      complete: completeRows.length,
      fetchable: fetchableRows.length,
      inception_limited: inceptionLimitedRows.length,
      missing: fetchableRows.length + inceptionLimitedRows.length,
      equation_ok: equationOk,
      matches_history_gap_report: historyGapCountOk,
      matches_coverage_index: coverageCountOk,
      matches_coverage_index_daily_check: dailyCheckCountOk,
    },
    yf_local_crosscheck: {
      complete: yfRows.complete.length,
      missing_or_lt_min_rows: yfGapCount,
      min_daily_1y_rows: DAILY_1Y_MIN_ROWS,
      matches_exact_fetchable_selector: yfGapCount === fetchableRows.length,
      sample: yfRows.fetchable_or_missing.slice(0, 10),
      caveat: "Do not use the local YF-only count as the ETF readiness blocker unless the product contract changes; it currently over-selects versus the 584 StockAnalysis continuity blocker.",
    },
    bounded_batches: {
      can_drive_bounded_ticker_batches: historyGapCountOk && coverageCountOk && dailyCheckCountOk && equationOk,
      default_batch_size: batchSize,
      batch_count: Math.ceil(tickers.length / batchSize),
      command_template: "fetch-stockanalysis.yml history_gaps_only=true required_history_periods=daily_1y incremental_etf_limit=120",
      first_batch_tickers: tickers.slice(0, batchSize),
    },
    tickers,
    rows: fetchableRows,
    samples: {
      fetchable: compactRows(fetchableRows),
      inception_limited: compactRows(inceptionLimitedRows),
      complete: compactRows(completeRows).slice(0, 5),
    },
  };
}

export function buildEtfDaily1yReadiness() {
  const signalSummary = readJson("data/computed/fenok_etf_signals_summary.json");
  const historyGap = readJson("data/stockanalysis/backfill/history_gap_report_latest.json");
  const coverageIndex = readJsonOrNull("data/admin/fenok-edge-coverage-index.json");
  const s3Track = findTrack(coverageIndex, "etf_scoring_lane");
  const readiness = s3Track?.evidence_based_readiness ?? coverageIndex?.etf_universe?.evidence_based_readiness ?? null;
  const generatedDailyCheck = findDailyCheck(readiness, "etf_no_fetchable_daily_1y_gap");
  const fetchablePlan = buildScoredEtfDaily1yFetchablePlan({ signalSummary, historyGap, coverageIndex });

  const scored = historyGap?.daily_1y_gap?.scored_etfs ?? {};
  const denominator = asNumber(
    scored.scored_etf_count,
    asNumber(signalSummary?.coverage?.scored_public_etf, asArray(signalSummary?.rows).length),
  );
  const daily1yComplete = asNumber(scored.complete);
  const daily1yFetchable = asNumber(scored.fetchable);
  const inceptionLimited = asNumber(scored.inception_limited);
  const daily1yMissing = asNumber(scored.missing, daily1yFetchable + inceptionLimited);
  const equationTotal = daily1yComplete + daily1yFetchable + inceptionLimited;
  const countEquationOk = equationTotal === denominator
    && daily1yMissing === daily1yFetchable + inceptionLimited;
  const summaryRows = asArray(signalSummary?.rows).length;
  const summaryCountOk = summaryRows === denominator;
  const coverageCountOk = !readiness?.counts || (
    asNumber(readiness.counts.scored_public_etf) === denominator
    && asNumber(readiness.counts.fetchable_daily_1y_gap) === daily1yFetchable
    && asNumber(readiness.counts.inception_limited_daily_1y_gap) === inceptionLimited
  );
  const dailyCheckCountOk = !generatedDailyCheck || (
    asNumber(generatedDailyCheck.fetchable_daily_1y_gap) === daily1yFetchable
    && asNumber(generatedDailyCheck.inception_limited_daily_1y_gap) === inceptionLimited
  );
  const noFetchableDaily1yGap = daily1yFetchable === 0;
  const publicDoneClaimAllowed = Boolean(
    s3Track?.requirements?.public
    && s3Track?.requirements?.daily
    && s3Track?.requirements?.gated
    && noFetchableDaily1yGap
  );

  const errors = [];
  if (!countEquationOk) {
    errors.push({
      id: "daily_1y_count_equation",
      detail: `complete+fetchable+inception_limited=${equationTotal}, denominator=${denominator}, missing=${daily1yMissing}`,
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
      id: "fetchable_plan_history_gap_match",
      detail: "fetchable plan exact rows differ from history-gap scored ETF counts",
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
    generated_at: new Date().toISOString(),
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
      etf_no_fetchable_daily_1y_gap: daily1yFetchable,
      count_equation: "daily_1y_complete + daily_1y_fetchable + inception_limited_daily_1y_gap == denominator",
      count_equation_ok: countEquationOk,
      no_fetchable_daily_1y_gap: noFetchableDaily1yGap,
      daily_ready: Boolean(readiness?.daily_ready),
      gated_ready: Boolean(readiness?.gated_ready),
      blockers: [
        ...(noFetchableDaily1yGap ? [] : ["etf_no_fetchable_daily_1y_gap"]),
        ...(readiness?.gated_ready ? [] : ["gated_ready"]),
      ],
      caveat: "Fetchable daily 1Y gaps keep ETF daily=false. Inception-limited gaps are tracked but do not block by themselves.",
    },
    generated_count_checks: {
      summary_rows: summaryRows,
      summary_count_ok: summaryCountOk,
      coverage_index_count_ok: coverageCountOk,
      coverage_index_daily_check_count_ok: dailyCheckCountOk,
      coverage_index_fetchable_daily_1y_gap: readiness?.counts?.fetchable_daily_1y_gap ?? null,
      coverage_index_inception_limited_daily_1y_gap: readiness?.counts?.inception_limited_daily_1y_gap ?? null,
    },
    samples: {
      fetchable: compactRows(scored.samples?.fetchable),
      inception_limited: compactRows(scored.samples?.inception_limited),
      complete: compactRows(scored.samples?.complete).slice(0, 5),
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
  console.log(`- denominator=${r.denominator} complete=${r.daily_1y_complete} fetchable=${r.daily_1y_fetchable} inception_limited=${r.inception_limited_daily_1y_gap}`);
  console.log(`- count_equation_ok=${r.count_equation_ok} public_done_claim_allowed=${payload.public_done_claim_allowed} blockers=${r.blockers.join(",") || "none"}`);
  for (const error of payload.errors) console.error(`ERROR: ${error.id}: ${error.detail}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = parseArgs(process.argv.slice(2));
  const payload = buildEtfDaily1yReadiness();

  if (!args.noWrite) {
    writeJson(OUT_REL_PATH, payload);
    writeJson(FETCHABLE_PLAN_REL_PATH, payload.fetchable_plan);
  }
  if (args.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else printHuman(payload);

  if (args.check && !payload.ok) process.exitCode = 1;
}
