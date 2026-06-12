#!/usr/bin/env node
/**
 * Normalize SEC 13F ticker-facing indexes after the upstream converter run.
 *
 * The converter can emit rows where SEC infoTable has no ticker and only a
 * company name. Browser surfaces need symbol keys, while unmapped rows should
 * remain auditable instead of silently disappearing.
 *
 * Outputs:
 *   - data/sec-13f/by_ticker.json (+ public mirror)
 *   - data/sec-13f/analytics/consensus.json (+ public mirror)
 *   - data/sec-13f/analytics/ticker_aliases.json (+ public mirror)
 *   - data/sec-13f/investors/*.json public mirror parity
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTickerResolver, SYMBOL_RE } from "./lib/sec13f-symbols.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVESTORS_DIR = path.join(ROOT, "data/sec-13f/investors");
const PUBLIC_INVESTORS_DIR = path.join(ROOT, "100xfenok-next/public/data/sec-13f/investors");
const BY_TICKER = "data/sec-13f/by_ticker.json";
const CONSENSUS = "data/sec-13f/analytics/consensus.json";
const ALIASES = "data/sec-13f/analytics/ticker_aliases.json";

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, data) {
  const rootPath = path.join(ROOT, relPath);
  const publicPath = path.join(ROOT, "100xfenok-next/public", relPath);
  for (const filePath of [rootPath, publicPath]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data));
  }
}

function copyInvestorMirror() {
  fs.mkdirSync(PUBLIC_INVESTORS_DIR, { recursive: true });
  const sourceFiles = fs.readdirSync(INVESTORS_DIR).filter((file) => file.endsWith(".json"));
  for (const file of sourceFiles) {
    fs.copyFileSync(path.join(INVESTORS_DIR, file), path.join(PUBLIC_INVESTORS_DIR, file));
  }
  return sourceFiles.length;
}

const round4 = (value) => Math.round(value * 10000) / 10000;

const previousConsensus = readJson(path.join(ROOT, CONSENSUS), {});
const metadata = previousConsensus.metadata ?? {};
const targetQuarter = metadata.quarter ?? null;
const excluded = new Set(metadata.excluded_stale_investors ?? []);
const totalInvestors = Number(metadata.current_cohort_investors ?? metadata.total_investors ?? 0);
const { resolveHoldingSymbol } = loadTickerResolver(ROOT);

const byTicker = new Map();
const aliases = new Map();
const unmapped = new Map();
const investorFiles = fs.readdirSync(INVESTORS_DIR).filter((file) => file.endsWith(".json"));
let activeInvestors = 0;
let sourceRows = 0;
let mappedRows = 0;
let unmappedRows = 0;

function aliasKey(rawKey, symbol) {
  return `${rawKey}::${symbol}`;
}

function recordAlias(result, holding) {
  if (!result.rawKey || result.rawKey === result.symbol) return;
  const key = aliasKey(result.rawKey, result.symbol);
  const current = aliases.get(key) ?? {
    raw_key: result.rawKey,
    normalized_key: result.normalizedKey,
    symbol: result.symbol,
    source: result.source,
    cusips: new Set(),
    rows: 0,
  };
  if (holding.cusip) current.cusips.add(String(holding.cusip));
  current.rows += 1;
  aliases.set(key, current);
}

function recordUnmapped(result, holding, investorId) {
  const key = result.rawKey || result.normalizedKey || "(blank)";
  const current = unmapped.get(key) ?? {
    raw_key: result.rawKey,
    normalized_key: result.normalizedKey,
    examples: new Set(),
    cusips: new Set(),
    rows: 0,
    market_value: 0,
  };
  if (holding.cusip) current.cusips.add(String(holding.cusip));
  if (holding.name) current.examples.add(String(holding.name));
  current.rows += 1;
  current.market_value += Number(holding.market_value ?? 0) || 0;
  current.investor = current.investor ?? investorId;
  unmapped.set(key, current);
}

function ensureSymbol(symbol) {
  if (!byTicker.has(symbol)) byTicker.set(symbol, new Map());
  return byTicker.get(symbol);
}

function addHolding(symbol, investorId, holding) {
  const investorMap = ensureSymbol(symbol);
  const current = investorMap.get(investorId) ?? {
    investor: investorId,
    shares: 0,
    market_value: 0,
    weight: 0,
    classes_held: new Set(),
    position_types: new Set(),
  };
  current.shares += Number(holding.shares ?? 0) || 0;
  current.market_value += Number(holding.market_value ?? 0) || 0;
  current.weight += Number(holding.weight ?? 0) || 0;
  if (holding.title_of_class) current.classes_held.add(String(holding.title_of_class));
  if (holding.put_call) current.position_types.add(String(holding.put_call));
  investorMap.set(investorId, current);
}

for (const file of investorFiles) {
  const id = path.basename(file, ".json");
  if (excluded.has(id)) continue;
  const payload = readJson(path.join(INVESTORS_DIR, file), {});
  const filings = payload.investor?.filings ?? [];
  const filing = targetQuarter
    ? filings.find((item) => item.quarter === targetQuarter)
    : filings.at(-1);
  if (!filing) continue;
  activeInvestors += 1;
  for (const holding of filing.holdings ?? []) {
    sourceRows += 1;
    const result = resolveHoldingSymbol(holding);
    if (!result.symbol || !SYMBOL_RE.test(result.symbol)) {
      unmappedRows += 1;
      recordUnmapped(result, holding, id);
      continue;
    }
    mappedRows += 1;
    recordAlias(result, holding);
    addHolding(result.symbol, id, holding);
  }
}

const byTickerOutput = {};
const consensus = {};
for (const [symbol, investorMap] of [...byTicker.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  const details = [...investorMap.values()]
    .sort((a, b) => b.market_value - a.market_value)
    .map((row) => ({
      investor: row.investor,
      shares: Math.round(row.shares),
      market_value: Math.round(row.market_value),
      weight: round4(row.weight),
      classes_held: [...row.classes_held].sort(),
      position_types: [...row.position_types].sort(),
    }));
  const holders = details.map((row) => row.investor).sort();
  byTickerOutput[symbol] = {
    holders,
    total_shares: details.reduce((sum, row) => sum + row.shares, 0),
    total_market_value: details.reduce((sum, row) => sum + row.market_value, 0),
    holder_details: details,
  };
  consensus[symbol] = {
    ticker: symbol,
    score: totalInvestors > 0 ? round4(Math.min(1, holders.length / totalInvestors)) : null,
    holders_count: holders.length,
    holders_list: holders,
  };
}

const aliasOutput = {
  schema_version: "sec-13f-ticker-aliases/v1",
  generated_at: new Date().toISOString(),
  quarter: targetQuarter,
  source_rows: sourceRows,
  mapped_rows: mappedRows,
  unmapped_rows: unmappedRows,
  aliases: [...aliases.values()]
    .sort((a, b) => a.raw_key.localeCompare(b.raw_key))
    .map((row) => ({
      raw_key: row.raw_key,
      normalized_key: row.normalized_key,
      symbol: row.symbol,
      source: row.source,
      rows: row.rows,
      cusips: [...row.cusips].sort(),
    })),
  unmapped: [...unmapped.values()]
    .sort((a, b) => b.market_value - a.market_value)
    .map((row) => ({
      raw_key: row.raw_key,
      normalized_key: row.normalized_key,
      rows: row.rows,
      market_value: Math.round(row.market_value),
      example_investor: row.investor,
      examples: [...row.examples].slice(0, 5),
      cusips: [...row.cusips].sort().slice(0, 10),
    })),
};

writeJson(BY_TICKER, byTickerOutput);
writeJson(CONSENSUS, {
  metadata: {
    ...metadata,
    generated_at: new Date().toISOString(),
    total_investors: totalInvestors || activeInvestors,
    current_cohort_investors: activeInvestors,
    tickers_count: Object.keys(consensus).length,
    normalized: true,
    alias_count: aliasOutput.aliases.length,
    unmapped_count: aliasOutput.unmapped.length,
  },
  consensus,
});
writeJson(ALIASES, aliasOutput);
const mirroredInvestors = copyInvestorMirror();

console.log(
  `13f_integrity: quarter=${targetQuarter} tickers=${Object.keys(consensus).length} ` +
    `aliases=${aliasOutput.aliases.length} unmapped=${aliasOutput.unmapped.length} ` +
    `investor_mirror=${mirroredInvestors}`,
);
