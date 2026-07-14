#!/usr/bin/env node
/**
 * Build a service-oriented entity graph over the local DataPack.
 *
 * This is not a fetcher. It only connects existing artifacts by canonical keys
 * so product surfaces can reuse the same stock/ETF/filing/sector relationships.
 */

import fs from "node:fs";
import path from "node:path";
import { ENTITY_KEY_POLICY, makeEntityKey, normalizeEntitySymbol } from "./lib/entity-key-policy.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DATA_ROOT = path.join(ROOT, "data");
const PUBLIC_DATA_ROOT = path.join(ROOT, "100xfenok-next", "public", "data");
const NO_AGGREGATE_SOURCE_DATE = "provider publishes no aggregate source date";
const SOURCE_FLOOR_UNAVAILABLE = "producer has not emitted a complete source-date floor";

function readJson(relPath, fallback = null) {
  const fullPath = path.join(DATA_ROOT, relPath);
  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw new Error(`Cannot read valid JSON from ${fullPath}: ${error?.message || error}`, { cause: error });
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
  return normalizeEntitySymbol(value);
}

function tickerVariants(value) {
  const normalized = normalizeTicker(value);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  if (normalized.includes("-")) variants.add(normalized.replace(/-/g, "."));
  if (normalized.includes(".")) variants.add(normalized.replace(/\./g, "-"));
  return [...variants].filter(Boolean);
}

function normalizeAlias(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function aliasCandidates(value) {
  const base = normalizeAlias(value);
  if (!base) return [];
  const candidates = new Set([base]);
  const withoutSuffix = base
    .replace(/\b(common stock|common shares|ordinary shares|class [a-z])\b/g, " ")
    .replace(/\b(incorporated|inc|corp|corporation|company|co|ltd|limited|plc|holdings?|group|sa|nv|ag|se|adr|ads)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (withoutSuffix) candidates.add(withoutSuffix);
  if (withoutSuffix.endsWith(" com")) candidates.add(withoutSuffix.replace(/\s+com$/, ""));
  return [...candidates].filter(Boolean);
}

function fileExists(relPath) {
  return fs.existsSync(path.join(DATA_ROOT, relPath));
}

function marketFactsSourceForTicker(ticker) {
  const payload = readJson(`computed/market_facts/tickers/${ticker}.json`, null);
  return firstDate(payload?.source_as_of);
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
const stockAliasMap = new Map();
const stockAliasCollisions = [];
const stockAliasNonUsSkips = [];
const singleStockEtfUnresolved = [];

function addStockAlias(alias, ticker, source) {
  const rawAlias = String(alias || "").trim();
  if (!rawAlias) return;
  for (const normalized of aliasCandidates(alias)) {
    const existing = stockAliasMap.get(normalized);
    if (existing && existing.ticker !== ticker) {
      const candidates = new Set([...(existing.candidates || []), existing.ticker, ticker].filter(Boolean));
      stockAliasCollisions.push({
        alias: normalized,
        existing: existing.ticker || null,
        existing_source: existing.source,
        skipped: ticker,
        skipped_source: source,
      });
      stockAliasMap.set(normalized, {
        ticker: null,
        source: "ambiguous",
        raw_alias: normalized,
        matched_alias: normalized,
        ambiguous: true,
        candidates: [...candidates].sort(),
      });
      continue;
    }
    if (!existing) stockAliasMap.set(normalized, { ticker, source, raw_alias: rawAlias, matched_alias: normalized });
  }
}

for (const row of analyzerRows) {
  const ticker = normalizeTicker(row.symbol);
  if (!ticker) continue;
  addStockAlias(ticker, ticker, "stocks_analyzer.symbol");
  addStockAlias(row.companyName, ticker, "stocks_analyzer.companyName");
}

for (const row of actionRows) {
  const ticker = normalizeTicker(row.symbol);
  if (!ticker) continue;
  addStockAlias(ticker, ticker, "stock_action_index.symbol");
  addStockAlias(row.company, ticker, "stock_action_index.company");
}

const generatedAt = new Date().toISOString();
const sourceAsOf = {
  stocks_analyzer: firstDate(stocksAnalyzer.source_date),
  stock_action_index: firstDate(stockActionIndex.source_date),
  market_facts: firstDate(marketFactsIndex.core_surface_source_as_of),
  edgar_summaries: null,
  sec_13f: firstDate(sec13fSummary.metadata?.quarters_covered?.[0], guruHoldersIndex.metadata?.quarter),
  etf_universe: null,
};
const sourceAsOfReason = Object.fromEntries(Object.entries({
  stocks_analyzer: SOURCE_FLOOR_UNAVAILABLE,
  stock_action_index: SOURCE_FLOOR_UNAVAILABLE,
  market_facts: SOURCE_FLOOR_UNAVAILABLE,
  edgar_summaries: NO_AGGREGATE_SOURCE_DATE,
  sec_13f: SOURCE_FLOOR_UNAVAILABLE,
  etf_universe: NO_AGGREGATE_SOURCE_DATE,
}).map(([source, reason]) => [source, sourceAsOf[source] ? null : reason]));

const sectorNodes = new Map();
const categoryNodes = new Map();
const filingNodes = new Map();

function touchSector(name) {
  if (!name) return null;
  const id = makeEntityKey("sector", name);
  if (!id) return null;
  if (!sectorNodes.has(id)) {
    sectorNodes.set(id, { id, type: "sector", label: name, stock_count: 0, etf_count: 0 });
  }
  return id;
}

function touchCategory(name) {
  if (!name) return null;
  const id = makeEntityKey("etf_category", name);
  if (!id) return null;
  if (!categoryNodes.has(id)) {
    categoryNodes.set(id, { id, type: "etf_category", label: name, etf_count: 0 });
  }
  return id;
}

function touchFiling(ticker) {
  const symbol = normalizeTicker(ticker);
  if (!symbol || !edgarTickers.has(symbol)) return null;
  const id = makeEntityKey("filing", symbol);
  if (!id) return null;
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
  const marketFactsSource = hasMarketFacts ? marketFactsSourceForTicker(ticker) : null;
  const hasEdgar = edgarTickers.has(ticker);
  const has13f = sec13fTickers.has(ticker);
  const canonicalSector = action?.canonicalSector || row.canonicalSector || null;
  const sectorId = touchSector(canonicalSector);
  if (sectorId) sectorNodes.get(sectorId).stock_count += 1;
  const filingId = touchFiling(ticker);
  const confidenceLabel = action?.confidenceLabel || "unknown";

  const entity = {
    id: makeEntityKey("stock", ticker),
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
      market_facts: marketFactsSource,
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
  if (has13f) addRelation(entity, "held_by_13f_investors", makeEntityKey("sec13f", ticker), { source: "sec-13f/by_ticker" });
  return entity;
});

const stockNodeIds = new Set(stockEntities.map((entity) => entity.id));
const stockEntityByTicker = new Map(stockEntities.map((entity) => [entity.ticker, entity]));

function isUsScopedStock(ticker) {
  const entity = stockEntityByTicker.get(ticker);
  return entity?.market_scope === "us" || entity?.country === "US" || entity?.market === "US" || entity?.market === "US_CLASS";
}

function resolveUnderlyingTicker(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  for (const symbol of tickerVariants(raw)) {
    if (stockNodeIds.has(makeEntityKey("stock", symbol))) {
      const direct = normalizeTicker(raw);
      return {
        ticker: symbol,
        method: symbol === direct ? "direct" : "symbol_variant",
        source: symbol === direct ? "raw_underlying.symbol" : "raw_underlying.symbol_variant",
        matched_alias: symbol,
      };
    }
  }

  for (const candidate of aliasCandidates(raw)) {
    const aliasRecord = stockAliasMap.get(candidate);
    const aliasTicker = aliasRecord?.ticker;
    if (aliasTicker && stockNodeIds.has(makeEntityKey("stock", aliasTicker))) {
      if (isUsScopedStock(aliasTicker)) {
        return {
          ticker: aliasTicker,
          method: "alias",
          source: aliasRecord.source,
          matched_alias: aliasRecord.matched_alias,
        };
      }
      stockAliasNonUsSkips.push({ raw, alias: candidate, skipped: aliasTicker, skipped_source: aliasRecord.source });
    }
  }

  const symbolMatches = raw.toUpperCase().match(/\b[A-Z]{1,5}(?:\.[A-Z])?\b/g) || [];
  for (const symbol of symbolMatches) {
    for (const ticker of tickerVariants(symbol)) {
      if (stockNodeIds.has(makeEntityKey("stock", ticker))) {
        return { ticker, method: "regex", source: "raw_underlying.symbol_token", matched_alias: ticker };
      }
    }
  }

  return null;
}

const etfEntities = etfRows.map((row) => {
  const ticker = normalizeTicker(row.ticker);
  const marketFactsPath = `computed/market_facts/tickers/${ticker}.json`;
  const hasMarketFacts = fileExists(marketFactsPath);
  const marketFactsSource = hasMarketFacts ? marketFactsSourceForTicker(ticker) : null;
  const categoryId = touchCategory(row.category || "Other");
  if (categoryId) categoryNodes.get(categoryId).etf_count += 1;
  const rawUnderlying = row.classification?.underlying || null;
  const underlyingMatch = resolveUnderlyingTicker(rawUnderlying);
  const underlyingTicker = underlyingMatch?.ticker || null;
  const underlyingTarget = underlyingTicker ? makeEntityKey("stock", underlyingTicker) : null;
  if (row.classification?.is_single_stock && !underlyingTarget) {
    singleStockEtfUnresolved.push({
      ticker,
      label: row.name || ticker,
      raw_underlying: rawUnderlying,
      classification_source: row.classification?.source || null,
      confidence: row.classification?.confidence || null,
      reason: rawUnderlying ? "no_canonical_us_stock_match" : "missing_underlying",
    });
  }
  const resolutionNote = underlyingMatch && (row.classification?.confidence !== "high" || underlyingMatch.method !== "direct")
    ? [
        row.classification?.confidence ? `classification_confidence=${row.classification.confidence}` : null,
        `resolution_method=${underlyingMatch.method}`,
        underlyingMatch.source ? `resolution_source=${underlyingMatch.source}` : null,
      ].filter(Boolean).join("; ")
    : null;

  const entity = {
    id: makeEntityKey("etf", ticker),
    type: "etf",
    ticker,
    label: row.name || ticker,
    category: row.category || null,
    route: `/etfs/${ticker}`,
    confidence: {
      label: row.classification?.confidence || "unknown",
      rank: confidenceRank(row.classification?.confidence),
      classification_source: row.classification?.source || null,
      underlying_raw: rawUnderlying,
      canonical_underlying_ticker: underlyingTicker,
      canonical_underlying_key: underlyingTarget,
      resolution_method: underlyingMatch?.method || null,
      resolution_source: underlyingMatch?.source || null,
      matched_alias: underlyingMatch?.matched_alias || null,
      resolution_note: resolutionNote,
    },
    as_of: {
      etf_universe: sourceAsOf.etf_universe,
      market_facts: marketFactsSource,
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
  if (underlyingTarget) {
    addRelation(entity, "tracks_underlying", underlyingTarget, {
      source: row.classification.source || "classification",
      raw_underlying: rawUnderlying,
      canonical_underlying_ticker: underlyingTicker,
      resolution_method: underlyingMatch.method,
      resolution_source: underlyingMatch.source,
      matched_alias: underlyingMatch.matched_alias,
      resolution_note: resolutionNote,
    });
  }
  return entity;
});

const etfsByUnderlying = new Map();
for (const etf of etfEntities) {
  const relation = etf.relations.find((item) => item.type === "tracks_underlying" && item.target);
  if (!relation) continue;
  const ticker = relation.target.replace(/^ticker:/, "");
  const links = etfsByUnderlying.get(ticker) || [];
  links.push({
    etf_key: etf.id,
    target_key: relation.target,
    ticker: etf.ticker,
    label: etf.label,
    route: etf.route,
    category: etf.category,
    confidence: etf.confidence?.label || null,
    classification_source: relation.source || etf.confidence?.classification_source || null,
    raw_underlying: relation.raw_underlying || etf.confidence?.underlying_raw || null,
    canonical_underlying_ticker: relation.canonical_underlying_ticker || ticker,
    resolution_method: relation.resolution_method || etf.confidence?.resolution_method || null,
    resolution_source: relation.resolution_source || etf.confidence?.resolution_source || null,
    matched_alias: relation.matched_alias || etf.confidence?.matched_alias || null,
    resolution_note: relation.resolution_note || etf.confidence?.resolution_note || null,
    market_facts: Boolean(etf.source_links?.market_facts),
    service_flags: etf.service_flags,
    as_of: {
      etf_universe: etf.as_of?.etf_universe || null,
      market_facts: etf.as_of?.market_facts || null,
    },
  });
  etfsByUnderlying.set(ticker, links);

  const stockEntity = stockEntityByTicker.get(ticker);
  if (stockEntity) {
    addRelation(stockEntity, "referenced_by_single_stock_etf", etf.id, {
      source: relation.source || "classification",
      raw_underlying: relation.raw_underlying || null,
      canonical_underlying_ticker: relation.canonical_underlying_ticker || ticker,
      resolution_method: relation.resolution_method || null,
      resolution_source: relation.resolution_source || null,
      matched_alias: relation.matched_alias || null,
      resolution_note: relation.resolution_note || null,
    });
  }
}

for (const links of etfsByUnderlying.values()) {
  links.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

const sec13fNodes = [...sec13fTickers].map((ticker) => ({
  id: makeEntityKey("sec13f", ticker),
  type: "sec13f_ticker",
  ticker,
  holder_count: guruHoldersIndex.holders?.[ticker] ?? sec13fByTicker[ticker]?.holders?.length ?? null,
  as_of: sourceAsOf.sec_13f,
}));

const payload = {
  schema_version: "data-entity-graph/v1",
  generated_at: generatedAt,
  source_as_of: sourceAsOf,
  source_as_of_reason: sourceAsOfReason,
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
  key_policy: ENTITY_KEY_POLICY,
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
    stocks_with_single_stock_etfs: stockEntities.filter((entity) => etfsByUnderlying.has(entity.ticker)).length,
    etfs_with_market_facts: etfEntities.filter((entity) => entity.source_links.market_facts).length,
  },
  diagnostics: {
    stock_alias_collisions: stockAliasCollisions.length,
    stock_alias_collision_examples: stockAliasCollisions.slice(0, 10),
    stock_alias_non_us_skips: stockAliasNonUsSkips.length,
    stock_alias_non_us_skip_examples: stockAliasNonUsSkips.slice(0, 10),
    single_stock_etfs_unresolved: singleStockEtfUnresolved.length,
    single_stock_etfs_unresolved_list: singleStockEtfUnresolved.sort((a, b) => a.ticker.localeCompare(b.ticker)),
    market_facts_core_price_source_complete: marketFactsIndex.source_stamp_diagnostics?.core_price_source_complete === true,
    market_facts_core_price_missing_count: Number(marketFactsIndex.source_stamp_diagnostics?.core_price_missing_count) || 0,
    market_facts_core_price_missing_tickers: Array.isArray(marketFactsIndex.source_stamp_diagnostics?.core_price_missing_tickers)
      ? marketFactsIndex.source_stamp_diagnostics.core_price_missing_tickers
      : [],
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

const stockIndexEntries = Object.fromEntries(stockEntities.map((entity) => {
  const relatedEtfs = etfsByUnderlying.get(entity.ticker) || [];
  const flags = {
    market_facts: Boolean(entity.source_links.market_facts),
    filings: Boolean(entity.source_links.edgar_summary),
    sec_13f: Boolean(entity.source_links.sec_13f),
    index_membership: entity.service_flags.includes("index_membership"),
    single_stock_etfs: relatedEtfs.length > 0,
  };
  const connectionCount = [
    flags.market_facts,
    flags.filings,
    flags.sec_13f,
    flags.index_membership,
  ].filter(Boolean).length;
  return [entity.ticker, {
    key: entity.id,
    ticker: entity.ticker,
    label: entity.label,
    route: entity.route,
    canonical_sector: entity.canonical_sector,
    confidence: entity.confidence,
    flags,
    connection_count: connectionCount,
    service_count: relatedEtfs.length,
    as_of: entity.as_of,
    relations: entity.relations.map((relation) => ({
      type: relation.type,
      target: relation.target,
    })),
  }];
}));

const stockIndexPayload = {
  schema_version: "data-entity-graph-stock-index/v1",
  generated_at: generatedAt,
  source_as_of: sourceAsOf,
  source_as_of_reason: sourceAsOfReason,
  key_policy: ENTITY_KEY_POLICY,
  totals: {
    stocks: stockEntities.length,
    with_market_facts: stockEntities.filter((entity) => entity.source_links.market_facts).length,
    with_filings: stockEntities.filter((entity) => entity.source_links.edgar_summary).length,
    with_sec_13f: stockEntities.filter((entity) => entity.source_links.sec_13f).length,
    with_index_membership: stockEntities.filter((entity) => entity.service_flags.includes("index_membership")).length,
    with_single_stock_etfs: stockEntities.filter((entity) => etfsByUnderlying.has(entity.ticker)).length,
  },
  stocks: stockIndexEntries,
};

const stockServiceEntries = Object.fromEntries([...etfsByUnderlying.entries()].map(([ticker, links]) => [ticker, {
  target_key: makeEntityKey("stock", ticker),
  ticker,
  route: `/stock/${ticker}`,
  single_stock_etfs: links,
  as_of: {
    etf_universe: sourceAsOf.etf_universe,
    market_facts: stockEntityByTicker.get(ticker)?.as_of?.market_facts ?? null,
  },
}]));

const stockServicesPayload = {
  schema_version: "data-entity-graph-stock-services/v1",
  generated_at: generatedAt,
  source_as_of: sourceAsOf,
  source_as_of_reason: sourceAsOfReason,
  key_policy: ENTITY_KEY_POLICY,
  totals: {
    stocks: stockEntities.length,
    with_single_stock_etfs: Object.keys(stockServiceEntries).length,
    single_stock_etfs: [...etfsByUnderlying.values()].reduce((sum, links) => sum + links.length, 0),
  },
  stocks: stockServiceEntries,
};

writeJson("computed/entity_graph.json", payload);
writeJson("computed/entity_graph_stock_index.json", stockIndexPayload);
writeJson("computed/entity_graph_stock_services.json", stockServicesPayload);
console.log(`entity graph written: ${payload.totals.stocks} stocks, ${payload.totals.etfs} ETFs`);
console.log(`entity graph stock index written: ${stockIndexPayload.totals.stocks} stocks`);
console.log(`entity graph stock services written: ${stockServicesPayload.totals.with_single_stock_etfs} stocks with single-stock ETFs`);
