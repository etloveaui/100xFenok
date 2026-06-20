#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const ROOT = process.cwd();

const SOURCE_UNIVERSE_PATH = `${ROOT}/../data/stockanalysis/etf_universe.json`;
const PUBLIC_UNIVERSE_PATH = `${ROOT}/public/data/stockanalysis/etf_universe.json`;
const SOURCE_SCREENER_PATH = `${ROOT}/../data/stockanalysis/surfaces/etf_screener.json`;
const PUBLIC_SCREENER_PATH = `${ROOT}/public/data/stockanalysis/surfaces/etf_screener.json`;

const REQUIRED_DETAIL_FILES = ["IEFA", "SQQQ", "TQQQ", "TSLL"];
const ETF_DETAIL_FIELDS = [
  "expenseRatio",
  "expense_ratio",
  "dividendYield",
  "dividend_yield",
  "sharesOut",
  "beta",
  "inceptionDate",
  "provider_page",
  "etf_website",
  "performance",
];

function readText(path) {
  return readFileSync(path, "utf8");
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function assertMirror(label, sourcePath, publicPath, errors) {
  assert(readText(sourcePath) === readText(publicPath), `${label}: source and public mirror differ`, errors);
}

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function cleanTicker(value) {
  return String(value ?? "")
    .replace(/^\$/, "")
    .trim()
    .toUpperCase();
}

function cleanText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text !== "-" ? text : null;
}

function numericValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/[$,%\s,]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function rowsFromSurface(payload) {
  if (!payload || typeof payload !== "object") return [];
  const records = Array.isArray(payload.records) ? payload.records : [];
  const tableRecords = Array.isArray(payload.tables)
    ? payload.tables.flatMap((table) => {
        const record = asRecord(table);
        return Array.isArray(record?.records) ? record.records : [];
      })
    : [];

  return [...records, ...tableRecords].map(asRecord).filter(Boolean);
}

function classificationFrom(...values) {
  for (const value of values) {
    const record = asRecord(value);
    if (record) return record;
  }
  return null;
}

function compactRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== null && value !== undefined),
  );
}

function pickRecordFields(record, fields) {
  if (!record) return {};
  return Object.fromEntries(
    fields
      .filter((field) => field in record)
      .map((field) => [field, record[field]]),
  );
}

function classificationCounts(records) {
  const classified = records.filter((row) => asRecord(row.classification));
  return {
    classified: classified.length,
    coverage_pct: records.length > 0 ? Number(((classified.length / records.length) * 100).toFixed(2)) : 0,
    leveraged: records.filter((row) => asRecord(row.classification)?.is_leveraged === true).length,
    inverse: records.filter((row) => asRecord(row.classification)?.is_inverse === true).length,
    single_stock: records.filter((row) => asRecord(row.classification)?.is_single_stock === true).length,
  };
}

function buildMergedUniverse(universePayload, screenerPayload) {
  const universeRows = rowsFromSurface(universePayload);
  const screenerRows = rowsFromSurface(screenerPayload);
  const recordsByTicker = new Map();

  for (const row of universeRows) {
    const ticker = cleanTicker(row.ticker ?? row.s ?? row.symbol);
    if (!ticker) continue;
    recordsByTicker.set(ticker, compactRecord({
      ticker,
      name: cleanText(row.name ?? row.n) ?? ticker,
      category: cleanText(row.category) ?? null,
      aum_raw: cleanText(row.aum_raw),
      aum: numericValue(row.aum),
      source_page: numericValue(row.source_page),
      ...pickRecordFields(row, ETF_DETAIL_FIELDS),
      classification: classificationFrom(row.classification),
    }));
  }

  let screenerOnly = 0;
  for (const row of screenerRows) {
    const ticker = cleanTicker(row.s ?? row.ticker ?? row.symbol);
    if (!ticker) continue;
    const existing = recordsByTicker.get(ticker);
    if (!existing) screenerOnly += 1;
    // Screener fields are fresher for catalog browsing, so they enrich the universe row.
    recordsByTicker.set(ticker, compactRecord({
      ...(existing ?? {}),
      ticker,
      name: cleanText(existing?.name) ?? cleanText(row.n ?? row.name) ?? ticker,
      category: cleanText(existing?.category) ?? cleanText(row.assetClass) ?? null,
      aum_raw: cleanText(existing?.aum_raw),
      aum: numericValue(existing?.aum) ?? numericValue(row.aum),
      source_page: numericValue(existing?.source_page),
      ...pickRecordFields(existing, ETF_DETAIL_FIELDS),
      ...pickRecordFields(row, ETF_DETAIL_FIELDS),
      assetClass: cleanText(row.assetClass),
      price: numericValue(row.price),
      change: numericValue(row.change),
      volume: numericValue(row.volume),
      holdings: numericValue(row.holdings),
      classification: classificationFrom(existing?.classification, row.classification),
    }));
  }

  const records = [...recordsByTicker.values()].sort((a, b) => {
    const aumA = numericValue(a.aum) ?? -1;
    const aumB = numericValue(b.aum) ?? -1;
    return aumB - aumA || cleanTicker(a.ticker).localeCompare(cleanTicker(b.ticker));
  });

  return {
    counts: {
      records: records.length,
      etf_universe: universeRows.length,
      etf_screener: screenerRows.length,
      screener_only: screenerOnly,
      with_price: records.filter((row) => typeof row.price === "number").length,
      with_volume: records.filter((row) => typeof row.volume === "number").length,
      with_holdings: records.filter((row) => typeof row.holdings === "number").length,
      with_expense_ratio: records.filter((row) => numericValue(row.expense_ratio ?? row.expenseRatio) !== null).length,
      with_performance: records.filter((row) => asRecord(row.performance) !== null).length,
      classification: classificationCounts(records),
      source_classification: {
        etf_universe: classificationCounts(universeRows),
        etf_screener: classificationCounts(screenerRows),
      },
    },
    records,
  };
}

function findTicker(records, ticker) {
  return records.find((row) => cleanTicker(row?.ticker) === ticker);
}

function assertTickerContract(payload, ticker, contract, errors) {
  const row = findTicker(payload.records, ticker);
  assert(row, `${ticker}: missing from merged ETF universe`, errors);
  if (!row) return;

  for (const field of contract.numericFields ?? []) {
    assert(typeof row[field] === "number", `${ticker}: ${field} must be numeric`, errors);
  }

  if (contract.leveraged !== undefined) {
    assert(row.classification?.is_leveraged === contract.leveraged, `${ticker}: leveraged classification mismatch`, errors);
  }
  if (contract.singleStock !== undefined) {
    assert(row.classification?.is_single_stock === contract.singleStock, `${ticker}: single-stock classification mismatch`, errors);
  }
  if (contract.inverse !== undefined) {
    assert(row.classification?.is_inverse === contract.inverse, `${ticker}: inverse classification mismatch`, errors);
  }
  if (contract.leverageFactor !== undefined) {
    assert(Number(row.classification?.leverage_factor) === contract.leverageFactor, `${ticker}: leverage factor mismatch`, errors);
  }
}

function assertEtfHistoryPeriods(payload, ticker, errors) {
  const periods = asRecord(payload?.normalized?.history_periods);
  assert(periods, `${ticker}: normalized.history_periods missing`, errors);
  if (!periods) return;

  const daily = Array.isArray(periods.daily_1y) ? periods.daily_1y : [];
  const weekly = Array.isArray(periods.weekly_1y) ? periods.weekly_1y : [];
  const monthly = Array.isArray(periods.monthly_1y) ? periods.monthly_1y : [];
  assert(daily.length >= 200, `${ticker}: daily_1y history expected >= 200 rows, got ${daily.length}`, errors);
  assert(weekly.length >= 45, `${ticker}: weekly_1y history expected >= 45 rows, got ${weekly.length}`, errors);
  assert(monthly.length >= 10, `${ticker}: monthly_1y history expected >= 10 rows, got ${monthly.length}`, errors);
}

const errors = [];

assertMirror("ETF universe", SOURCE_UNIVERSE_PATH, PUBLIC_UNIVERSE_PATH, errors);
assertMirror("ETF screener", SOURCE_SCREENER_PATH, PUBLIC_SCREENER_PATH, errors);

const universe = readJson(PUBLIC_UNIVERSE_PATH);
const screener = readJson(PUBLIC_SCREENER_PATH);
const merged = buildMergedUniverse(universe, screener);
const counts = merged.counts;

assert(counts.etf_universe >= 5200, `ETF universe source expected >= 5200 rows, got ${counts.etf_universe}`, errors);
assert(counts.etf_screener >= 5250, `ETF screener source expected >= 5250 rows, got ${counts.etf_screener}`, errors);
assert(counts.records >= 5250, `Merged ETF universe expected >= 5250 rows, got ${counts.records}`, errors);
assert(counts.records >= counts.etf_universe, "Merged ETF universe must cover the source universe rows", errors);
assert(counts.records >= counts.etf_screener, "Merged ETF universe must cover the screener rows", errors);
assert(counts.with_price >= 5000, `Merged ETF universe expected price coverage >= 5000, got ${counts.with_price}`, errors);
assert(counts.with_volume >= 4500, `Merged ETF universe expected volume coverage >= 4500, got ${counts.with_volume}`, errors);
assert(counts.with_holdings >= 4900, `Merged ETF universe expected holdings coverage >= 4900, got ${counts.with_holdings}`, errors);
assert(counts.with_expense_ratio >= 5000, `Merged ETF universe expected expense-ratio coverage >= 5000, got ${counts.with_expense_ratio}`, errors);
assert(counts.with_performance >= 4400, `Merged ETF universe expected performance coverage >= 4400, got ${counts.with_performance}`, errors);
assert(counts.classification?.classified === counts.records, `Merged ETF universe classification coverage expected ${counts.records}, got ${counts.classification?.classified}`, errors);
assert(counts.classification?.coverage_pct === 100, `Merged ETF universe classification coverage expected 100%, got ${counts.classification?.coverage_pct}`, errors);
if (counts.records === counts.etf_screener) {
  const screenerClassification = counts.source_classification?.etf_screener;
  assert(counts.classification?.leveraged === screenerClassification?.leveraged, `Merged ETF universe leveraged count drift: expected screener ${screenerClassification?.leveraged}, got ${counts.classification?.leveraged}`, errors);
  assert(counts.classification?.single_stock === screenerClassification?.single_stock, `Merged ETF universe single-stock count drift: expected screener ${screenerClassification?.single_stock}, got ${counts.classification?.single_stock}`, errors);
  assert(counts.classification?.inverse === screenerClassification?.inverse, `Merged ETF universe inverse count drift: expected screener ${screenerClassification?.inverse}, got ${counts.classification?.inverse}`, errors);
}

assertTickerContract(merged, "VOO", {
  numericFields: ["aum", "price", "volume", "holdings", "expense_ratio"],
}, errors);
const voo = findTicker(merged.records, "VOO");
assert(voo?.performance?.tr1y !== undefined, "VOO: 1Y performance must be promoted into ETF universe", errors);

assertTickerContract(merged, "IEFA", {
  numericFields: ["aum", "price", "volume", "holdings"],
}, errors);
assertTickerContract(merged, "TQQQ", {
  numericFields: ["aum", "price", "volume", "holdings"],
  leveraged: true,
  singleStock: false,
  inverse: false,
  leverageFactor: 3,
}, errors);
assertTickerContract(merged, "SQQQ", {
  numericFields: ["aum", "price", "volume", "holdings"],
  leveraged: true,
  singleStock: false,
  inverse: true,
  leverageFactor: 3,
}, errors);
assertTickerContract(merged, "TSLL", {
  numericFields: ["aum", "price", "volume", "holdings"],
  leveraged: true,
  singleStock: true,
  inverse: false,
  leverageFactor: 2,
}, errors);

for (const ticker of REQUIRED_DETAIL_FILES) {
  const publicPath = `${ROOT}/public/data/stockanalysis/etfs/${ticker}.json`;
  const sourcePath = `${ROOT}/../data/stockanalysis/etfs/${ticker}.json`;
  assert(existsSync(publicPath), `${ticker}: public ETF detail file missing`, errors);
  assert(existsSync(sourcePath), `${ticker}: source ETF detail file missing`, errors);
  if (existsSync(publicPath) && existsSync(sourcePath)) {
    assertMirror(`${ticker} ETF detail`, sourcePath, publicPath, errors);
    assertEtfHistoryPeriods(readJson(publicPath), ticker, errors);
  }
}

if (errors.length > 0) {
  console.error("stockanalysis ETF universe check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `stockanalysis ETF universe check passed ` +
    `(${counts.records} records, ${counts.with_price} prices, ${counts.with_volume} volumes, ` +
    `${counts.with_holdings} holdings, ${counts.with_expense_ratio} expense ratios, ${counts.with_performance} performance rows, ` +
    `${counts.classification.leveraged}/${counts.classification.single_stock}/${counts.classification.inverse} classification flags)`,
);
