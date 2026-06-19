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
const REQUIRED_PERIODS = ["monthly_3y", "monthly_5y"];

const argv = new Set(process.argv.slice(2));
const WRITE_REPORT = argv.has("--write-report");

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
  const missingByPeriod = Object.fromEntries(REQUIRED_PERIODS.map((period) => [period, 0]));

  for (const fileName of detailFiles) {
    const payload = readJson(path.join(DETAIL_DIR, fileName));
    if (!isPrimaryStockAnalysisDetail(payload)) continue;
    const ticker = payload.ticker || fileName.replace(/\.json$/, "");
    const missing = REQUIRED_PERIODS.filter((period) => rowsForPeriod(payload, period).length === 0);
    const row = { ticker, missing };
    primaryRows.push(row);
    if (missing.length === 0) {
      completeRows.push(row);
    } else {
      missingRows.push(row);
      for (const period of missing) missingByPeriod[period] += 1;
    }
  }

  const plan = existsSync(PLAN_PATH) ? readJson(PLAN_PATH) : null;
  const audit = existsSync(AUDIT_PATH) ? readJson(AUDIT_PATH) : null;
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
    coverage_pct: percent(completeRows.length, primaryRows.length),
    missing_by_period: missingByPeriod,
    samples: {
      missing: missingRows.slice(0, 10),
      complete: completeRows.slice(0, 5),
    },
    incremental_plan: plan
      ? {
          generated_at: plan.generated_at,
          operation: plan.operation,
          mode: plan.mode,
          network: plan.policy?.network,
          counts: plan.counts,
          first5: Array.isArray(plan.etfs) ? plan.etfs.slice(0, 5) : [],
          matches_current_gap: Number(plan.counts?.history_gap || 0) === missingRows.length,
        }
      : null,
    market_facts_return_3y: {
      etf: Number(return3y.etf || 0),
      stockanalysis_history: Number(return3y.stockanalysis_history || 0),
      etf_coverage_pct: Number(return3y.etf_coverage_pct || 0),
      etf_denominator: Number(denominators.etf || 0),
      stockanalysis_universe_denominator: Number(denominators.stockanalysis_universe || 0),
    },
    recommended_dispatch: {
      workflow: "fetch-stockanalysis.yml",
      inputs: {
        history_gaps_only: "true",
        required_history_periods: REQUIRED_PERIODS.join(","),
        incremental_etf_limit: "120",
      },
      note: "External StockAnalysis calls; run only after explicit approval.",
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
      `incremental_plan history_gap=${plan.counts?.history_gap} does not match current missing_required_history=${missingRows.length}`,
    );
  }
}

main();
