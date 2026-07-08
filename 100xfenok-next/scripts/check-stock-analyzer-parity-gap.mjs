#!/usr/bin/env node
/**
 * Stock Analyzer legacy/native KPI parity gap report.
 *
 * This is a read-only harness for the remap track. It compares representative
 * KPI fields between the native data spine and the legacy Stock Analyzer KPI
 * summary, then reports the current gap without blocking normal route QA.
 */

import fs from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");

const DEFAULT_TICKERS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "AVGO",
  "BRK.B",
  "JPM",
  "LLY",
  "V",
];

const PATHS = {
  native: path.join(APP_ROOT, "public/data/global-scouter/core/stocks_analyzer.json"),
  legacyKpi: path.join(REPO_ROOT, "tools/stock_analyzer/data/enhanced_summary_data.json"),
  legacyFull: path.join(REPO_ROOT, "tools/stock_analyzer/data/enhanced_summary_data_full.json"),
};

const FIELD_MAP = [
  {
    id: "price",
    native: ["price"],
    legacy: ["현재가", "Price"],
    tolerance: 0.05,
  },
  {
    id: "market_cap_usd_mn",
    native: ["marketCap"],
    legacy: ["(USD mn)"],
    tolerance: 0.05,
  },
  {
    id: "per",
    native: ["per"],
    legacy: ["PER (Oct-25)", "PER (Fwd)"],
    tolerance: 0.1,
  },
  {
    id: "pbr",
    native: ["pbr"],
    legacy: ["PBR (Oct-25)", "PBR (Fwd)"],
    tolerance: 0.1,
  },
  {
    id: "roe_forward",
    native: ["roe"],
    legacy: ["ROE (Fwd)"],
    tolerance: 0.05,
  },
  {
    id: "opm_forward",
    native: ["opm"],
    legacy: ["OPM (Fwd)"],
    tolerance: 0.05,
  },
  {
    id: "momentum_3m",
    native: ["momentum3m", "growthRate"],
    legacy: ["3 M"],
    tolerance: 0.05,
  },
  {
    id: "momentum_12m",
    native: ["momentum12m", "return12m"],
    legacy: ["12 M"],
    tolerance: 0.05,
  },
];

function parseArgs(argv) {
  const args = {
    json: false,
    requireParity: false,
    tickers: DEFAULT_TICKERS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--require-parity") {
      args.requireParity = true;
      continue;
    }
    if (arg === "--tickers") {
      args.tickers = parseTickers(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--tickers=")) {
      args.tickers = parseTickers(arg.slice("--tickers=".length));
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return args;
}

function parseTickers(value) {
  return String(value || "")
    .split(",")
    .map((ticker) => normalizeTicker(ticker))
    .filter(Boolean);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const sanitized = value.replace(/,/g, "").trim();
    if (!sanitized) return null;
    const parsed = Number(sanitized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstFinite(row, keys) {
  for (const key of keys) {
    const value = toFiniteNumber(row?.[key]);
    if (value !== null) return { key, value };
  }
  return { key: null, value: null };
}

function indexRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const ticker = normalizeTicker(row?.symbol ?? row?.Ticker);
    if (ticker && !map.has(ticker)) map.set(ticker, row);
  }
  return map;
}

function compareValue(nativeValue, legacyValue, tolerance) {
  if (nativeValue === null || legacyValue === null) {
    return {
      comparable: false,
      within_tolerance: false,
      absolute_delta: null,
      relative_delta: null,
    };
  }

  const absoluteDelta = nativeValue - legacyValue;
  const denominator = Math.max(Math.abs(legacyValue), 1e-9);
  const relativeDelta = Math.abs(absoluteDelta) / denominator;

  return {
    comparable: true,
    within_tolerance: relativeDelta <= tolerance,
    absolute_delta: absoluteDelta,
    relative_delta: relativeDelta,
  };
}

function compareTicker(ticker, nativeRow, legacyRow) {
  const fields = FIELD_MAP.map((field) => {
    const nativeMetric = firstFinite(nativeRow, field.native);
    const legacyMetric = firstFinite(legacyRow, field.legacy);
    const comparison = compareValue(nativeMetric.value, legacyMetric.value, field.tolerance);

    return {
      field: field.id,
      native_key: nativeMetric.key,
      legacy_key: legacyMetric.key,
      native_value: nativeMetric.value,
      legacy_value: legacyMetric.value,
      tolerance: field.tolerance,
      ...comparison,
    };
  });

  return {
    ticker,
    native_present: Boolean(nativeRow),
    legacy_present: Boolean(legacyRow),
    fields,
  };
}

function summarizeField(rows, fieldId) {
  const values = rows
    .map((row) => row.fields.find((field) => field.field === fieldId))
    .filter(Boolean);
  const comparable = values.filter((field) => field.comparable);
  const within = comparable.filter((field) => field.within_tolerance);
  const relativeDeltas = comparable
    .map((field) => field.relative_delta)
    .filter((value) => typeof value === "number")
    .sort((a, b) => a - b);
  const median =
    relativeDeltas.length === 0
      ? null
      : relativeDeltas[Math.floor(relativeDeltas.length / 2)];

  return {
    field: fieldId,
    comparable: comparable.length,
    within_tolerance: within.length,
    median_relative_delta: median,
  };
}

function buildReport(args) {
  const nativePayload = loadJson(PATHS.native);
  const legacyPayload = loadJson(PATHS.legacyKpi);
  const legacyFullPayload = loadJson(PATHS.legacyFull);

  const nativeRows = Array.isArray(nativePayload.data) ? nativePayload.data : [];
  const legacyRows = Array.isArray(legacyPayload.companies) ? legacyPayload.companies : [];
  const legacyFullRows = Array.isArray(legacyFullPayload.companies) ? legacyFullPayload.companies : [];

  const nativeMap = indexRows(nativeRows);
  const legacyMap = indexRows(legacyRows);

  const commonTickers = [...nativeMap.keys()].filter((ticker) => legacyMap.has(ticker));
  const representativeRows = args.tickers.map((ticker) =>
    compareTicker(ticker, nativeMap.get(ticker), legacyMap.get(ticker)),
  );

  const fieldSummary = FIELD_MAP.map((field) => summarizeField(representativeRows, field.id));
  const parityReady =
    representativeRows.every((row) => row.native_present && row.legacy_present) &&
    fieldSummary.every((field) => field.comparable > 0 && field.comparable === field.within_tolerance);

  return {
    ok: true,
    parity_ready: parityReady,
    note: "Legacy KPI data is older/different-source; current deltas are expected until a promotion branch closes parity.",
    paths: {
      native: path.relative(APP_ROOT, PATHS.native),
      legacy_kpi: path.relative(APP_ROOT, PATHS.legacyKpi),
      legacy_full: path.relative(APP_ROOT, PATHS.legacyFull),
    },
    counts: {
      native: nativeRows.length,
      legacy_kpi: legacyRows.length,
      legacy_full: legacyFullRows.length,
      common_native_legacy_kpi: commonTickers.length,
    },
    tickers: args.tickers,
    field_summary: fieldSummary,
    representative_rows: representativeRows,
  };
}

function formatPct(value) {
  if (typeof value !== "number") return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function printHuman(report) {
  console.log("[qa:stock-analyzer-parity-gap] OK");
  console.log(`parity_ready=${report.parity_ready}`);
  console.log(
    `counts=native:${report.counts.native} legacy_kpi:${report.counts.legacy_kpi} legacy_full:${report.counts.legacy_full} common:${report.counts.common_native_legacy_kpi}`,
  );
  console.log(`tickers=${report.tickers.join(",")}`);
  console.log("field_summary:");
  for (const field of report.field_summary) {
    console.log(
      `  - ${field.field}: comparable=${field.comparable} within=${field.within_tolerance} median_delta=${formatPct(field.median_relative_delta)}`,
    );
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }

  if (args.requireParity && !report.parity_ready) process.exit(1);
}

main();
