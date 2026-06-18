#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const ROOT = process.cwd();

const SOURCE_UNIVERSE_PATH = `${ROOT}/../data/stockanalysis/etf_universe.json`;
const PUBLIC_UNIVERSE_PATH = `${ROOT}/public/data/stockanalysis/etf_universe.json`;
const SOURCE_SCREENER_PATH = `${ROOT}/../data/stockanalysis/surfaces/etf_screener.json`;
const PUBLIC_SCREENER_PATH = `${ROOT}/public/data/stockanalysis/surfaces/etf_screener.json`;

const REQUIRED_DETAIL_FILES = ["IEFA", "SQQQ", "TQQQ", "TSLL"];

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
  }
}

if (errors.length > 0) {
  console.error("stockanalysis ETF universe check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `stockanalysis ETF universe check passed ` +
    `(${counts.records} records, ${counts.with_price} prices, ${counts.with_volume} volumes, ${counts.with_holdings} holdings)`,
);
