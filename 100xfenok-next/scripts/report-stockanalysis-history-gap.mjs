#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_DIR = path.resolve(ROOT, "..", "data", "stockanalysis");
const DETAIL_DIR = path.join(SOURCE_DIR, "etfs");
const PLAN_PATH = path.join(SOURCE_DIR, "backfill", "incremental_plan_latest.json");
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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
      const years = historyPeriodRequiredYears(period);
      if (years && ageDays < years * 365) {
        inceptionLimited.push(period);
      } else {
        fetchable.push(period);
      }
    }
  }
  return {
    fetchable,
    inceptionLimited,
    inceptionDate: inception ? inception.toISOString().slice(0, 10) : null,
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
  const missingByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));
  const fetchableByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));
  const inceptionLimitedByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));

  for (const fileName of detailFiles) {
    const payload = readJson(path.join(DETAIL_DIR, fileName));
    if (!isPrimaryStockAnalysisDetail(payload)) continue;
    const ticker = payload.ticker || fileName.replace(/\.json$/, "");
    const missing = REQUIRED_PERIODS.filter((period) => rowsForPeriod(payload, period).length === 0);
    const gap = classifyHistoryGap(payload, missing);
    const row = {
      ticker,
      missing,
      fetchable_missing: gap.fetchable,
      inception_limited_missing: gap.inceptionLimited,
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
    }
  }

  const plan = existsSync(PLAN_PATH) ? readJson(PLAN_PATH) : null;
  const audit = existsSync(AUDIT_PATH) ? readJson(AUDIT_PATH) : null;
  const planRequiredPeriods = Array.isArray(plan?.required_history_periods) ? plan.required_history_periods : [];
  const marketFacts = asObject(audit?.market_facts);
  const return3y = asObject(marketFacts.return_field_coverage).return_3y_avg || {};
  const denominators = asObject(marketFacts.return_field_denominators);

  const report = {
    schema_version: "stockanalysis-history-gap-report/v1",
    generated_at: new Date().toISOString(),
    required_history_periods: REQUIRED_PERIODS,
    primary_stockanalysis_detail_files: primaryRows.length,
    complete_required_history: completeRows.length,
    missing_required_history: missingRows.length,
    fetchable_required_history: fetchableGapRows.length,
    inception_limited_required_history: inceptionLimitedRows.length,
    coverage_pct: percent(completeRows.length, primaryRows.length),
    missing_by_period: missingByPeriod,
    fetchable_by_period: fetchableByPeriod,
    inception_limited_by_period: inceptionLimitedByPeriod,
    samples: {
      missing: missingRows.slice(0, 10),
      fetchable: fetchableGapRows.slice(0, 10),
      inception_limited: inceptionLimitedRows.slice(0, 10),
      complete: completeRows.slice(0, 5),
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
          matches_current_gap: Number(plan.counts?.history_gap || 0) === fetchableGapRows.length,
          matches_total_gap: Number(plan.counts?.total_history_gap ?? plan.counts?.history_gap ?? 0) === missingRows.length,
          matches_inception_limited: Number(plan.counts?.inception_limited_history_gap || 0) === inceptionLimitedRows.length,
          matches_required_periods: planRequiredPeriods.join(",") === REQUIRED_PERIODS.join(","),
        }
      : null,
    market_facts_return_3y: {
      etf: Number(return3y.etf || 0),
      stockanalysis_history: Number(return3y.stockanalysis_history || 0),
      etf_coverage_pct: Number(return3y.etf_coverage_pct || 0),
      etf_denominator: Number(denominators.etf || 0),
      stockanalysis_universe_denominator: Number(denominators.stockanalysis_universe || 0),
    },
    recommended_dispatch: fetchableGapRows.length > 0
      ? {
          status: "owner_gated",
          workflow: "fetch-stockanalysis.yml",
          inputs: {
            history_gaps_only: "true",
            required_history_periods: REQUIRED_PERIODS.join(","),
            incremental_etf_limit: "120",
          },
          note: "External StockAnalysis calls; run only after explicit approval.",
        }
      : {
          status: "not_recommended",
          workflow: "fetch-stockanalysis.yml",
          inputs: null,
          note: "All current gaps are inception-limited; a live fetch is expected to be futile until the funds age into the requested windows.",
        },
  };

  console.log(JSON.stringify(report, null, 2));

  if (WRITE_REPORT) {
    writeJson(REPORT_PATH, report);
    writeJson(PUBLIC_REPORT_PATH, report);
    console.error(`wrote ${REPORT_PATH}`);
    console.error(`wrote ${PUBLIC_REPORT_PATH}`);
  }

  if (plan && !report.incremental_plan.matches_current_gap) {
    throw new Error(
      `incremental_plan history_gap=${plan.counts?.history_gap} does not match current fetchable_required_history=${fetchableGapRows.length}`,
    );
  }
  if (plan && !report.incremental_plan.matches_total_gap) {
    throw new Error(
      `incremental_plan total_history_gap=${plan.counts?.total_history_gap} does not match current missing_required_history=${missingRows.length}`,
    );
  }
  if (plan && !report.incremental_plan.matches_inception_limited) {
    throw new Error(
      `incremental_plan inception_limited_history_gap=${plan.counts?.inception_limited_history_gap} does not match current inception_limited_required_history=${inceptionLimitedRows.length}`,
    );
  }
  if (plan && !report.incremental_plan.matches_required_periods) {
    throw new Error(
      `incremental_plan required_history_periods=${planRequiredPeriods.join(",")} does not match report required_history_periods=${REQUIRED_PERIODS.join(",")}`,
    );
  }
}

main();
