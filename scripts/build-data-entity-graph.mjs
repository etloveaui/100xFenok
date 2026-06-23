#!/usr/bin/env node
/**
 * Build a service-oriented entity graph over the local DataPack.
 *
 * This is not a fetcher. It only connects existing artifacts by canonical keys
 * so product surfaces can reuse the same stock/ETF/filing/sector relationships.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_ROOT = path.join(ROOT, "data");
const PUBLIC_DATA_ROOT = path.join(ROOT, "100xfenok-next", "public", "data");

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_ROOT, relPath), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, payload) {
  for (const root of [DATA_ROOT, PUBLIC_DATA_ROOT]) {
    const outPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  }
}

function firstDate(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeTicker(value) {
  return String(value || "").trim().toUpperCase();
}

function fileExists(relPath) {
  return fs.existsSync(path.join(DATA_ROOT, relPath));
}

function addRelation(entity, type, target, evidence = {}) {
  if (!target) return;
  entity.relations.push({ type, target, ...evidence });
}

function confidenceRank(label) {
  if (label === "high") return 3;
  if (label === "medium") return 2;
  if (label === "low") return 1;
  return 0;
}

const stocksAnalyzer = readJson("global-scouter/core/stocks_analyzer.json", {});
const stockActionIndex = readJson("computed/stock_action_index.json", {});
const marketFactsIndex = readJson("computed/market_facts/index.json", {});
const edgarIndex = readJson("edgar-korean-summaries/index.json", {});
const sec13fSummary = readJson("sec-13f/summary.json", {});
const sec13fByTicker = readJson("sec-13f/by_ticker.json", {});
const guruHoldersIndex = readJson("sec-13f/analytics/guru_holders_index.json", {});
const etfUniverse = readJson("stockanalysis/etf_universe.json", {});

const analyzerRows = Array.isArray(stocksAnalyzer.data) ? stocksAnalyzer.data : [];
const actionRows = Array.isArray(stockActionIndex.rows) ? stockActionIndex.rows : [];
const etfRows = Array.isArray(etfUniverse.records) ? etfUniverse.records : [];
const edgarTickers = new Set((Array.isArray(edgarIndex.tickers) ? edgarIndex.tickers : []).map(normalizeTicker));
const sec13fTickers = new Set(Object.keys(sec13fByTicker).map(normalizeTicker));
const actionByTicker = new Map(actionRows.map((row) => [normalizeTicker(row.symbol), row]));
const analyzerByTicker = new Map(analyzerRows.map((row) => [normalizeTicker(row.symbol), row]));

const generatedAt = new Date().toISOString();
const sourceAsOf = {
  stocks_analyzer: firstDate(stocksAnalyzer.source_date, stocksAnalyzer.generated_at),
  stock_action_index: firstDate(stockActionIndex.source_date, stockActionIndex.generated_at),
  market_facts: firstDate(marketFactsIndex.generated_at),
  edgar_summaries: firstDate(edgarIndex.updated, edgarIndex.generatedAt, edgarIndex.generated_at),
  sec_13f: firstDate(sec13fSummary.metadata?.quarters_covered?.[0], guruHoldersIndex.metadata?.quarter, sec13fSummary.metadata?.generated_at),
  etf_universe: firstDate(etfUniverse.generated_at),
};

const sectorNodes = new Map();
const categoryNodes = new Map();
const filingNodes = new Map();

function touchSector(name) {
  if (!name) return null;
  const id = `sector:${name}`;
  if (!sectorNodes.has(id)) {
    sectorNodes.set(id, { id, type: "sector", label: name, stock_count: 0, etf_count: 0 });
  }
  return id;
}

function touchCategory(name) {
  if (!name) return null;
  const id = `etf_category:${name}`;
  if (!categoryNodes.has(id)) {
    categoryNodes.set(id, { id, type: "etf_category", label: name, etf_count: 0 });
  }
  return id;
}

function touchFiling(ticker) {
  const symbol = normalizeTicker(ticker);
  if (!symbol || !edgarTickers.has(symbol)) return null;
  const id = `filing:${symbol}`;
  if (!filingNodes.has(id)) {
    filingNodes.set(id, {
      id,
      type: "filing",
      ticker: symbol,
      route: `/stock/${symbol}?tab=filings`,
      source: "edgar-korean-summaries",
      as_of: sourceAsOf.edgar_summaries,
    });
  }
  return id;
}

const stockEntities = analyzerRows.map((row) => {
  const ticker = normalizeTicker(row.symbol);
  const action = actionByTicker.get(ticker);
  const marketFactsPath = `computed/market_facts/tickers/${ticker}.json`;
  const hasMarketFacts = fileExists(marketFactsPath);
  const hasEdgar = edgarTickers.has(ticker);
  const has13f = sec13fTickers.has(ticker);
  const canonicalSector = action?.canonicalSector || row.canonicalSector || null;
  const sectorId = touchSector(canonicalSector);
  if (sectorId) sectorNodes.get(sectorId).stock_count += 1;
  const filingId = touchFiling(ticker);
  const confidenceLabel = action?.confidenceLabel || "unknown";

  const entity = {
    id: `ticker:${ticker}`,
    type: "stock",
    ticker,
    label: action?.company || row.companyName || ticker,
    market: action?.market || null,
    market_scope: action?.marketScope || null,
    country: action?.country || row.country || null,
    canonical_sector: canonicalSector,
    route: `/stock/${ticker}`,
    confidence: {
      label: confidenceLabel,
      rank: confidenceRank(confidenceLabel),
      coverage_ratio: typeof action?.coverageRatio === "number" ? action.coverageRatio : null,
    },
    as_of: {
      profile: sourceAsOf.stocks_analyzer,
      action_index: sourceAsOf.stock_action_index,
      market_facts: hasMarketFacts ? sourceAsOf.market_facts : null,
      filings: hasEdgar ? sourceAsOf.edgar_summaries : null,
      sec_13f: has13f ? sourceAsOf.sec_13f : null,
    },
    source_links: {
      stocks_analyzer: true,
      stock_action_index: Boolean(action),
      market_facts: hasMarketFacts,
      edgar_summary: hasEdgar,
      sec_13f: has13f,
    },
    service_flags: [
      "screener",
      "stock_detail",
      ...(hasEdgar ? ["filings"] : []),
      ...(has13f ? ["smart_money"] : []),
      ...(action?.indexMembership?.length ? ["index_membership"] : []),
    ],
    relations: [],
  };

  addRelation(entity, "belongs_to_sector", sectorId, { source: "stock_action_index.canonicalSector" });
  addRelation(entity, "has_filing_summary", filingId, { source: "edgar-korean-summaries" });
  if (has13f) addRelation(entity, "held_by_13f_investors", `sec13f:${ticker}`, { source: "sec-13f/by_ticker" });
  return entity;
});

const stockNodeIds = new Set(stockEntities.map((entity) => entity.id));

const etfEntities = etfRows.map((row) => {
  const ticker = normalizeTicker(row.ticker);
  const marketFactsPath = `computed/market_facts/tickers/${ticker}.json`;
  const hasMarketFacts = fileExists(marketFactsPath);
  const categoryId = touchCategory(row.category || "Other");
  if (categoryId) categoryNodes.get(categoryId).etf_count += 1;

  const entity = {
    id: `etf:${ticker}`,
    type: "etf",
    ticker,
    label: row.name || ticker,
    category: row.category || null,
    route: `/etfs/${ticker}`,
    confidence: {
      label: row.classification?.confidence || "unknown",
      rank: confidenceRank(row.classification?.confidence),
      classification_source: row.classification?.source || null,
      underlying_raw: row.classification?.underlying || null,
    },
    as_of: {
      etf_universe: sourceAsOf.etf_universe,
      market_facts: hasMarketFacts ? sourceAsOf.market_facts : null,
    },
    source_links: {
      etf_universe: true,
      market_facts: hasMarketFacts,
      classification: Boolean(row.classification),
    },
    service_flags: [
      "etf_center",
      ...(row.classification?.is_leveraged ? ["leveraged"] : []),
      ...(row.classification?.is_inverse ? ["inverse"] : []),
      ...(row.classification?.is_single_stock ? ["single_stock"] : []),
    ],
    relations: [],
  };

  addRelation(entity, "belongs_to_etf_category", categoryId, { source: "stockanalysis/etf_universe" });
  const underlyingTarget = `ticker:${normalizeTicker(row.classification?.underlying)}`;
  if (stockNodeIds.has(underlyingTarget)) {
    addRelation(entity, "tracks_underlying", underlyingTarget, {
      source: row.classification.source || "classification",
    });
  }
  return entity;
});

const sec13fNodes = [...sec13fTickers].map((ticker) => ({
  id: `sec13f:${ticker}`,
  type: "sec13f_ticker",
  ticker,
  holder_count: guruHoldersIndex.holders?.[ticker] ?? sec13fByTicker[ticker]?.holders?.length ?? null,
  as_of: sourceAsOf.sec_13f,
}));

const payload = {
  schema_version: "data-entity-graph/v1",
  generated_at: generatedAt,
  source_as_of: sourceAsOf,
  source_files: [
    "global-scouter/core/stocks_analyzer.json",
    "computed/stock_action_index.json",
    "computed/market_facts/index.json",
    "computed/market_facts/tickers/*.json",
    "edgar-korean-summaries/index.json",
    "sec-13f/by_ticker.json",
    "sec-13f/analytics/guru_holders_index.json",
    "stockanalysis/etf_universe.json",
  ],
  key_policy: {
    stock: "ticker:<UPPERCASE_SYMBOL>",
    etf: "etf:<UPPERCASE_SYMBOL>",
    sector: "sector:<CANONICAL_GICS_LABEL>",
    filing: "filing:<UPPERCASE_SYMBOL>",
    sec13f: "sec13f:<UPPERCASE_SYMBOL>",
  },
  totals: {
    stocks: stockEntities.length,
    etfs: etfEntities.length,
    sectors: sectorNodes.size,
    etf_categories: categoryNodes.size,
    filing_nodes: filingNodes.size,
    sec13f_nodes: sec13fNodes.length,
    stocks_with_market_facts: stockEntities.filter((entity) => entity.source_links.market_facts).length,
    stocks_with_filings: stockEntities.filter((entity) => entity.source_links.edgar_summary).length,
    stocks_with_13f: stockEntities.filter((entity) => entity.source_links.sec_13f).length,
    etfs_with_market_facts: etfEntities.filter((entity) => entity.source_links.market_facts).length,
  },
  nodes: {
    stocks: stockEntities,
    etfs: etfEntities,
    sectors: [...sectorNodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    etf_categories: [...categoryNodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    filings: [...filingNodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    sec13f: sec13fNodes.sort((a, b) => a.id.localeCompare(b.id)),
  },
};

writeJson("computed/entity_graph.json", payload);
console.log(`entity graph written: ${payload.totals.stocks} stocks, ${payload.totals.etfs} ETFs`);
