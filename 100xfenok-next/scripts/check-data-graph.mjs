#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { expectedEntityKeyPolicy, isValidEntityKey, makeEntityKey } from "../../scripts/lib/entity-key-policy.mjs";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ROOT_GRAPH_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph.json");
const PUBLIC_GRAPH_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph.json");
const ROOT_STOCK_INDEX_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph_stock_index.json");
const PUBLIC_STOCK_INDEX_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph_stock_index.json");
const ROOT_STOCK_SERVICES_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph_stock_services.json");
const PUBLIC_STOCK_SERVICES_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph_stock_services.json");
const STOCKS_ANALYZER_PATH = path.join(REPO_ROOT, "data", "global-scouter", "core", "stocks_analyzer.json");
const STOCK_ACTION_INDEX_PATH = path.join(REPO_ROOT, "data", "computed", "stock_action_index.json");
const MARKET_FACTS_INDEX_PATH = path.join(REPO_ROOT, "data", "computed", "market_facts", "index.json");
const MARKET_FACTS_TICKER_ROOT = path.join(REPO_ROOT, "data", "computed", "market_facts", "tickers");
const EDGAR_INDEX_PATH = path.join(REPO_ROOT, "data", "edgar-korean-summaries", "index.json");
const SEC13F_SUMMARY_PATH = path.join(REPO_ROOT, "data", "sec-13f", "summary.json");
const SEC13F_BY_TICKER_PATH = path.join(REPO_ROOT, "data", "sec-13f", "by_ticker.json");
const GURU_HOLDERS_PATH = path.join(REPO_ROOT, "data", "sec-13f", "analytics", "guru_holders_index.json");
const ETF_UNIVERSE_PATH = path.join(REPO_ROOT, "data", "stockanalysis", "etf_universe.json");
const NO_AGGREGATE_SOURCE_DATE = "provider publishes no aggregate source date";
const SOURCE_KEYS = ["stocks_analyzer", "stock_action_index", "market_facts", "edgar_summaries", "sec_13f", "etf_universe"];
const NODE_GROUP_KINDS = {
  stocks: "stock",
  etfs: "etf",
  sectors: "sector",
  etf_categories: "etf_category",
  filings: "filing",
  sec13f: "sec13f",
};
const NODE_TOTAL_KEYS = {
  stocks: "stocks",
  etfs: "etfs",
  sectors: "sectors",
  etf_categories: "etf_categories",
  filings: "filing_nodes",
  sec13f: "sec13f_nodes",
};

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function warn(condition, message, warnings) {
  if (!condition) warnings.push(message);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonState(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, payload: null, error: null };
  try {
    return { exists: true, payload: JSON.parse(fs.readFileSync(filePath, "utf8")), error: null };
  } catch (error) {
    return { exists: true, payload: null, error };
  }
}

function readProducedPair(label, rootPath, publicPath, errors, warnings) {
  const root = readJsonState(rootPath);
  const publicMirror = readJsonState(publicPath);
  if (!root.exists && !publicMirror.exists) {
    warnings.push(`${label}: root and public artifacts are both missing`);
    return null;
  }
  assert(root.exists === publicMirror.exists, `${label}: root/public mirror divergence (one artifact is missing)`, errors);
  if (root.error) errors.push(`${path.relative(REPO_ROOT, rootPath)} is malformed: ${root.error.message}`);
  if (publicMirror.error) errors.push(`${path.relative(REPO_ROOT, publicPath)} is malformed: ${publicMirror.error.message}`);
  if (root.payload !== null && publicMirror.payload !== null) {
    assert(isDeepStrictEqual(root.payload, publicMirror.payload), `${label}: root/public mirror divergence`, errors);
  }
  return root.payload !== null && publicMirror.payload !== null
    ? { root: root.payload, publicMirror: publicMirror.payload }
    : null;
}

function readOptionalProducer(label, filePath, errors, warnings) {
  const state = readJsonState(filePath);
  if (!state.exists) {
    warnings.push(`${label}: producer artifact is missing`);
    return null;
  }
  if (state.error) {
    errors.push(`${label}: producer artifact is malformed: ${state.error.message}`);
    return null;
  }
  if (!plainObject(state.payload)) {
    errors.push(`${label}: producer artifact must be a JSON object`);
    return null;
  }
  validateFiniteNumbers(state.payload, `${label} producer`, errors);
  return state.payload;
}

function isRealCalendarDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sourceDay(value) {
  if (!nonEmptyString(value)) return null;
  const text = value.trim();
  const day = text.slice(0, 10);
  if (!isRealCalendarDay(day)) return null;
  if (text.length === 10) return day;
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  return timestampPattern.test(text) && Number.isFinite(new Date(text).getTime()) ? day : null;
}

function normalizedSourceStamp(value) {
  if (!nonEmptyString(value)) return null;
  const text = value.trim();
  const quarter = text.match(/^(\d{4})-Q([1-4])$/);
  if (quarter) {
    return { kind: "quarter", key: text, order: Number(quarter[1]) * 4 + Number(quarter[2]) };
  }
  const day = sourceDay(text);
  return day ? { kind: "day", key: day, order: new Date(`${day}T00:00:00.000Z`).getTime() } : null;
}

function currentStampOrder(kind) {
  const now = new Date();
  if (kind === "quarter") return now.getUTCFullYear() * 4 + Math.floor(now.getUTCMonth() / 3) + 1;
  return new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`).getTime();
}

function validateFiniteNumbers(value, context, errors) {
  if (typeof value === "number") {
    assert(Number.isFinite(value), `${context} must be finite`, errors);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateFiniteNumbers(item, `${context}[${index}]`, errors));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) validateFiniteNumbers(item, `${context}.${key}`, errors);
  }
}

const marketFactsTickerEvidenceCache = new Map();
const marketFactsSourceAsOfMigrationPendingTickers = new Set();

function marketFactsTickerSource(ticker, errors) {
  if (marketFactsTickerEvidenceCache.has(ticker)) return marketFactsTickerEvidenceCache.get(ticker);
  const state = readJsonState(path.join(MARKET_FACTS_TICKER_ROOT, `${ticker}.json`));
  if (!state.exists) {
    const evidence = { exists: false, sourceAsOf: null };
    marketFactsTickerEvidenceCache.set(ticker, evidence);
    return evidence;
  }
  if (state.error || !plainObject(state.payload)) {
    errors.push(`${ticker}: market_facts producer payload is malformed`);
    const evidence = { exists: true, sourceAsOf: null };
    marketFactsTickerEvidenceCache.set(ticker, evidence);
    return evidence;
  }
  const payload = state.payload;
  assert(payload.ticker === ticker, `${ticker}: market_facts producer ticker identity mismatch`, errors);
  const hasSourceAsOf = Object.prototype.hasOwnProperty.call(payload, "source_as_of");
  const hasSourceAsOfScope = Object.prototype.hasOwnProperty.call(payload, "source_as_of_scope");
  const hasSourceAsOfReason = Object.prototype.hasOwnProperty.call(payload, "source_as_of_reason");
  if (!hasSourceAsOf && !hasSourceAsOfScope && !hasSourceAsOfReason) {
    marketFactsSourceAsOfMigrationPendingTickers.add(ticker);
    const evidence = { exists: true, sourceAsOf: null, sourceAsOfMigrationPending: true };
    marketFactsTickerEvidenceCache.set(ticker, evidence);
    return evidence;
  }
  const sourceAsOf = payload.source_as_of;
  const selectedPriceSource = sourceDay(payload?.facts?.price?.as_of);
  assert(payload.source_as_of_scope === "selected_price_fact", `${ticker}: market_facts source_as_of scope must name the selected price fact`, errors);
  if (sourceAsOf === null) {
    assert(nonEmptyString(payload.source_as_of_reason), `${ticker}: null market_facts source_as_of requires a reason`, errors);
    assert(selectedPriceSource === null, `${ticker}: null market_facts source_as_of contradicts the selected price fact`, errors);
  } else {
    const sourceAsOfDay = sourceDay(sourceAsOf);
    assert(sourceAsOfDay !== null, `${ticker}: market_facts source_as_of must be a real source date or null`, errors);
    assert(sourceAsOfDay <= new Date().toISOString().slice(0, 10), `${ticker}: market_facts source_as_of cannot be future-dated`, errors);
    assert(sourceAsOfDay === selectedPriceSource, `${ticker}: market_facts source_as_of must equal the selected price fact source date`, errors);
    assert(payload.source_as_of_reason === null, `${ticker}: dated market_facts source_as_of must have a null reason`, errors);
  }
  const evidence = { exists: true, sourceAsOf: sourceDay(sourceAsOf) };
  marketFactsTickerEvidenceCache.set(ticker, evidence);
  return evidence;
}

function producerStamp(payload, value, label, errors, warnings) {
  if (!payload) return null;
  if (value === null || value === undefined || value === "") {
    warnings.push(`${label}: producer source evidence is missing`);
    return null;
  }
  const normalized = normalizedSourceStamp(value);
  if (!normalized || normalized.order > currentStampOrder(normalized.kind)) {
    errors.push(`${label}: producer source evidence is malformed or future-dated`);
    return null;
  }
  return value.trim();
}

function buildProducerEvidence(errors, warnings) {
  const stocksAnalyzer = readOptionalProducer("stocks_analyzer", STOCKS_ANALYZER_PATH, errors, warnings);
  const stockActionIndex = readOptionalProducer("stock_action_index", STOCK_ACTION_INDEX_PATH, errors, warnings);
  const marketFactsIndex = readOptionalProducer("market_facts", MARKET_FACTS_INDEX_PATH, errors, warnings);
  readOptionalProducer("edgar_summaries", EDGAR_INDEX_PATH, errors, warnings);
  const sec13fSummary = readOptionalProducer("sec_13f_summary", SEC13F_SUMMARY_PATH, errors, warnings);
  readOptionalProducer("sec_13f_by_ticker", SEC13F_BY_TICKER_PATH, errors, warnings);
  const guruHolders = readOptionalProducer("guru_holders", GURU_HOLDERS_PATH, errors, warnings);
  readOptionalProducer("etf_universe", ETF_UNIVERSE_PATH, errors, warnings);

  if (sec13fSummary?.metadata?.quarters_covered !== undefined && !Array.isArray(sec13fSummary.metadata.quarters_covered)) {
    errors.push("sec_13f_summary.metadata.quarters_covered must be an array when present");
  }
  const summaryQuarter = producerStamp(
    sec13fSummary,
    Array.isArray(sec13fSummary?.metadata?.quarters_covered) ? sec13fSummary.metadata.quarters_covered[0] : null,
    "sec_13f_summary.metadata.quarters_covered[0]",
    errors,
    warnings,
  );
  const guruQuarter = producerStamp(
    guruHolders,
    guruHolders?.metadata?.quarter,
    "guru_holders.metadata.quarter",
    errors,
    warnings,
  );
  if (summaryQuarter && guruQuarter) {
    const summary = normalizedSourceStamp(summaryQuarter);
    const guru = normalizedSourceStamp(guruQuarter);
    warn(summary?.kind === guru?.kind && summary?.key === guru?.key, "sec_13f producer evidence is behind across source artifacts", warnings);
  }
  const marketFactsSourceDiagnosticKeys = [
    "core_price_source_complete",
    "core_price_missing_count",
    "core_price_missing_tickers",
  ];
  const marketFactsSourceDiagnostics = plainObject(marketFactsIndex?.source_stamp_diagnostics)
    ? marketFactsIndex.source_stamp_diagnostics
    : {};
  const marketFactsSourceDiagnosticPresence = marketFactsSourceDiagnosticKeys.map((key) => (
    Object.prototype.hasOwnProperty.call(marketFactsSourceDiagnostics, key)
  ));

  return new Map([
    ["stocks_analyzer", {
      expected: producerStamp(stocksAnalyzer, stocksAnalyzer?.source_date, "stocks_analyzer.source_date", errors, warnings),
      intentionalNull: false,
      verifiable: Boolean(stocksAnalyzer),
    }],
    ["stock_action_index", {
      expected: producerStamp(stockActionIndex, stockActionIndex?.source_date, "stock_action_index.source_date", errors, warnings),
      intentionalNull: false,
      verifiable: Boolean(stockActionIndex),
    }],
    ["market_facts", {
      expected: producerStamp(marketFactsIndex, marketFactsIndex?.core_surface_source_as_of, "market_facts.core_surface_source_as_of", errors, warnings),
      intentionalNull: false,
      verifiable: Boolean(marketFactsIndex),
      sourceComplete: marketFactsIndex?.source_stamp_diagnostics?.core_price_source_complete === true,
      missingCount: marketFactsIndex?.source_stamp_diagnostics?.core_price_missing_count ?? null,
      missingTickers: marketFactsIndex?.source_stamp_diagnostics?.core_price_missing_tickers ?? null,
      tickerCount: Array.isArray(marketFactsIndex?.rows) ? marketFactsIndex.rows.length : null,
      tickers: Array.isArray(marketFactsIndex?.rows)
        ? marketFactsIndex.rows.map((row) => row?.ticker).filter(nonEmptyString)
        : [],
      sourceDiagnosticsMigrationPending: Boolean(marketFactsIndex)
        && marketFactsSourceDiagnosticPresence.every((present) => !present),
      sourceDiagnosticsMigrationPartial: marketFactsSourceDiagnosticPresence.some(Boolean)
        && !marketFactsSourceDiagnosticPresence.every(Boolean),
    }],
    ["edgar_summaries", { expected: null, intentionalNull: true, requiredReason: NO_AGGREGATE_SOURCE_DATE }],
    ["sec_13f", {
      expected: summaryQuarter ?? guruQuarter,
      intentionalNull: false,
      verifiable: Boolean(sec13fSummary || guruHolders),
    }],
    ["etf_universe", { expected: null, intentionalNull: true, requiredReason: NO_AGGREGATE_SOURCE_DATE }],
  ]);
}

function validateSourceTruth(payload, context, producerEvidence, errors, warnings) {
  assert(plainObject(payload?.source_as_of), `${context}.source_as_of must be an object`, errors);
  assert(plainObject(payload?.source_as_of_reason), `${context}.source_as_of_reason must be an object`, errors);
  const sourceAsOf = plainObject(payload?.source_as_of) ? payload.source_as_of : {};
  const sourceReasons = plainObject(payload?.source_as_of_reason) ? payload.source_as_of_reason : {};

  for (const source of SOURCE_KEYS) {
    const hasSource = Object.prototype.hasOwnProperty.call(sourceAsOf, source);
    const hasReason = Object.prototype.hasOwnProperty.call(sourceReasons, source);
    assert(hasSource, `${context}.${source} source_as_of key is required`, errors);
    assert(hasReason, `${context}.${source} source_as_of_reason key is required`, errors);
    if (!hasSource || !hasReason) continue;

    const actual = sourceAsOf[source];
    const reason = sourceReasons[source];
    const evidence = producerEvidence.get(source);
    if (actual === null) {
      assert(nonEmptyString(reason), `${context}.${source}: null source_as_of requires a nonempty reason`, errors);
      if (evidence?.requiredReason) {
        assert(reason === evidence.requiredReason, `${context}.${source}: source_as_of_reason must match the explicit source contract`, errors);
      }
      if (nonEmptyString(reason)) warnings.push(`${context}.${source}: source_as_of is unavailable (${reason.trim()})`);
      if (evidence?.expected) warnings.push(`${context}.${source}: source_as_of is behind producer evidence`);
      continue;
    }

    const actualStamp = normalizedSourceStamp(actual);
    assert(Boolean(actualStamp), `${context}.${source}: source_as_of must be a valid source date or quarter`, errors);
    if (actualStamp) {
      assert(actualStamp.order <= currentStampOrder(actualStamp.kind), `${context}.${source}: source_as_of cannot be future-dated`, errors);
    }
    assert(reason === null, `${context}.${source}: dated source_as_of must have a null reason`, errors);
    if (evidence?.intentionalNull) {
      errors.push(`${context}.${source}: source_as_of is unsupported by producer evidence`);
      continue;
    }
    if (!evidence?.expected) {
      if (evidence?.verifiable) {
        errors.push(`${context}.${source}: source_as_of has no producer evidence`);
      } else {
        warnings.push(`${context}.${source}: source_as_of cannot be verified because its producer artifact is missing`);
      }
      continue;
    }
    const expectedStamp = normalizedSourceStamp(evidence.expected);
    if (!actualStamp || !expectedStamp || actualStamp.kind !== expectedStamp.kind) {
      errors.push(`${context}.${source}: source_as_of does not match producer evidence type`);
    } else if (actualStamp.order > expectedStamp.order) {
      errors.push(`${context}.${source}: source_as_of is newer than producer evidence`);
    } else if (actualStamp.order < expectedStamp.order) {
      warnings.push(`${context}.${source}: source_as_of is behind producer evidence`);
    }
  }
}

function validateGeneratedAt(value, context, errors) {
  assert(nonEmptyString(value) && Number.isFinite(new Date(value).getTime()), `${context}.generated_at must be a valid timestamp`, errors);
}

function validateTotals(totals, context, errors) {
  assert(plainObject(totals), `${context}.totals must be an object`, errors);
  for (const [key, value] of Object.entries(plainObject(totals) ? totals : {})) {
    assert(Number.isInteger(value) && value >= 0, `${context}.totals.${key} must be a non-negative integer`, errors);
  }
}

function validateSourceFiles(payload, errors) {
  assert(Array.isArray(payload?.source_files) && payload.source_files.length > 0, "graph.source_files must be a nonempty array", errors);
  for (const sourceFile of Array.isArray(payload?.source_files) ? payload.source_files : []) {
    assert(nonEmptyString(sourceFile), "graph.source_files entries must be nonempty strings", errors);
    if (!nonEmptyString(sourceFile)) continue;
    const segments = sourceFile.split(/[\\/]+/);
    assert(!path.isAbsolute(sourceFile) && !segments.includes(".."), `graph.source_files must not leak a private path: ${sourceFile}`, errors);
  }
}

function comparableKeyPolicy(payload) {
  return JSON.stringify(payload?.key_policy ?? null);
}

const errors = [];
const warnings = [];
const graphPair = readProducedPair("entity graph", ROOT_GRAPH_PATH, PUBLIC_GRAPH_PATH, errors, warnings);
const stockIndexPair = readProducedPair("entity graph stock index", ROOT_STOCK_INDEX_PATH, PUBLIC_STOCK_INDEX_PATH, errors, warnings);
const stockServicesPair = readProducedPair("entity graph stock services", ROOT_STOCK_SERVICES_PATH, PUBLIC_STOCK_SERVICES_PATH, errors, warnings);
const graph = graphPair?.root ?? null;
const stockIndex = stockIndexPair?.root ?? null;
const stockServices = stockServicesPair?.root ?? null;
const producerEvidence = buildProducerEvidence(errors, warnings);
for (const ticker of producerEvidence.get("market_facts")?.tickers ?? []) {
  marketFactsTickerSource(ticker, errors);
}
const expectedPolicyJson = JSON.stringify(expectedEntityKeyPolicy());
const allowedConfidenceLabels = new Set(["high", "medium", "low", "unknown"]);
const allowedResolutionMethods = new Set(["direct", "symbol_variant", "alias", "regex"]);
const allowedServiceFlags = new Set([
  "screener",
  "stock_detail",
  "filings",
  "smart_money",
  "index_membership",
  "etf_center",
  "leveraged",
  "inverse",
  "single_stock",
]);

const nodeGroups = Object.fromEntries(Object.keys(NODE_GROUP_KINDS).map((group) => [group, []]));
const nodeIds = new Set();
const nodesById = new Map();

if (graph) {
  assert(plainObject(graph), "graph must be a JSON object", errors);
  assert(graph.schema_version === "data-entity-graph/v1", "schema_version must be data-entity-graph/v1", errors);
  validateGeneratedAt(graph.generated_at, "graph", errors);
  validateFiniteNumbers(graph, "graph", errors);
  validateTotals(graph.totals, "graph", errors);
  validateSourceTruth(graph, "graph", producerEvidence, errors, warnings);
  assert(comparableKeyPolicy(graph) === expectedPolicyJson, "graph key_policy must match canonical registry", errors);
  validateSourceFiles(graph, errors);
  assert(plainObject(graph.nodes), "graph.nodes must be an object", errors);
  for (const group of Object.keys(NODE_GROUP_KINDS)) {
    const rows = graph.nodes?.[group];
    assert(Array.isArray(rows), `graph.nodes.${group} must be an array`, errors);
    nodeGroups[group] = Array.isArray(rows) ? rows : [];
    const totalKey = NODE_TOTAL_KEYS[group];
    assert(graph.totals?.[totalKey] === nodeGroups[group].length, `graph.totals.${totalKey} must match graph.nodes.${group} length`, errors);
  }
}

const stockIndexRows = plainObject(stockIndex?.stocks) ? stockIndex.stocks : {};
if (stockIndex) {
  assert(plainObject(stockIndex), "stock index must be a JSON object", errors);
  assert(stockIndex.schema_version === "data-entity-graph-stock-index/v1", "stock index schema_version must be data-entity-graph-stock-index/v1", errors);
  validateGeneratedAt(stockIndex.generated_at, "stock index", errors);
  validateFiniteNumbers(stockIndex, "stockIndex", errors);
  validateTotals(stockIndex.totals, "stock index", errors);
  assert(plainObject(stockIndex.stocks), "stock index stocks must be an object", errors);
  assert(stockIndex.totals?.stocks === Object.keys(stockIndexRows).length, "stock index totals.stocks must match stocks entry count", errors);
  assert(comparableKeyPolicy(stockIndex) === expectedPolicyJson, "stock index key_policy must match canonical registry", errors);
  if (graph) {
    assert(isDeepStrictEqual(stockIndex.source_as_of, graph.source_as_of), "stock index source_as_of must match graph", errors);
    assert(isDeepStrictEqual(stockIndex.source_as_of_reason, graph.source_as_of_reason), "stock index source_as_of_reason must match graph", errors);
  } else {
    validateSourceTruth(stockIndex, "stock index", producerEvidence, errors, warnings);
  }
}

const stockServiceRows = plainObject(stockServices?.stocks) ? stockServices.stocks : {};
if (stockServices) {
  assert(plainObject(stockServices), "stock services must be a JSON object", errors);
  assert(stockServices.schema_version === "data-entity-graph-stock-services/v1", "stock services schema_version must be data-entity-graph-stock-services/v1", errors);
  validateGeneratedAt(stockServices.generated_at, "stock services", errors);
  validateFiniteNumbers(stockServices, "stockServices", errors);
  validateTotals(stockServices.totals, "stock services", errors);
  assert(plainObject(stockServices.stocks), "stock services stocks must be an object", errors);
  const serviceEntryCount = Object.keys(stockServiceRows).length;
  const singleStockEtfCount = Object.values(stockServiceRows).reduce(
    (sum, row) => sum + (Array.isArray(row?.single_stock_etfs) ? row.single_stock_etfs.length : 0),
    0,
  );
  assert(stockServices.totals?.with_single_stock_etfs === serviceEntryCount, "stock services totals.with_single_stock_etfs must match stocks entry count", errors);
  assert(stockServices.totals?.single_stock_etfs === singleStockEtfCount, "stock services totals.single_stock_etfs must match linked ETF count", errors);
  assert(comparableKeyPolicy(stockServices) === expectedPolicyJson, "stock services key_policy must match canonical registry", errors);
  if (graph) {
    assert(isDeepStrictEqual(stockServices.source_as_of, graph.source_as_of), "stock services source_as_of must match graph", errors);
    assert(isDeepStrictEqual(stockServices.source_as_of_reason, graph.source_as_of_reason), "stock services source_as_of_reason must match graph", errors);
  } else {
    validateSourceTruth(stockServices, "stock services", producerEvidence, errors, warnings);
  }
}

if (graph && stockIndex) {
  assert(stockIndex.totals?.stocks === graph.totals?.stocks, "stock index total must match graph stock total", errors);
  assert(stockIndex.totals?.with_market_facts === graph.totals?.stocks_with_market_facts, "stock index market_facts total must match graph", errors);
  assert(stockIndex.totals?.with_filings === graph.totals?.stocks_with_filings, "stock index filings total must match graph", errors);
  assert(stockIndex.totals?.with_sec_13f === graph.totals?.stocks_with_13f, "stock index 13F total must match graph", errors);
  warn(stockIndexRows.NVDA?.flags?.market_facts === true, "NVDA market_facts coverage is unavailable", warnings);
  warn(stockIndexRows.NVDA?.flags?.filings === true, "NVDA filings coverage is unavailable", warnings);
  warn(stockIndexRows.NVDA?.flags?.sec_13f === true, "NVDA 13F coverage is unavailable", warnings);
}

if (graph && stockServices) {
  assert(stockServices.totals?.stocks === graph.totals?.stocks, "stock services stock total must match graph stock total", errors);
  assert(stockServices.totals?.with_single_stock_etfs === graph.totals?.stocks_with_single_stock_etfs, "stock services single-stock ETF total must match graph", errors);
}
if (stockIndex && stockServices) {
  assert(isDeepStrictEqual(stockIndex.source_as_of, stockServices.source_as_of), "stock sidecar source_as_of values must match", errors);
  assert(isDeepStrictEqual(stockIndex.source_as_of_reason, stockServices.source_as_of_reason), "stock sidecar source_as_of_reason values must match", errors);
  assert(stockIndex.totals?.with_single_stock_etfs === stockServices.totals?.with_single_stock_etfs, "stock index single-stock ETF total must match services", errors);
  warn(stockServices.totals?.single_stock_etfs >= 100, "single-stock ETF service coverage is below 100 ETFs", warnings);
  warn(stockIndexRows.NVDA?.flags?.single_stock_etfs === true, "NVDA single-stock ETF coverage is unavailable", warnings);
  warn((stockServiceRows.NVDA?.single_stock_etfs || []).length >= 4, "NVDA single-stock ETF coverage is below four products", warnings);
}

if (graph) {
  const allNodes = Object.values(nodeGroups).flat();
  for (const node of allNodes) {
    assert(plainObject(node), "every node must be an object", errors);
    assert(nonEmptyString(node?.id), "every node needs an id", errors);
    if (!nonEmptyString(node?.id)) continue;
    assert(!nodeIds.has(node.id), `duplicate node id: ${node.id}`, errors);
    nodeIds.add(node.id);
    nodesById.set(node.id, node);
  }

  const stockTickers = new Set(nodeGroups.stocks.map((node) => node?.ticker).filter(nonEmptyString));
  const etfTickers = new Set(nodeGroups.etfs.map((node) => node?.ticker).filter(nonEmptyString));
  for (const ticker of stockTickers) {
    assert(!etfTickers.has(ticker), `${ticker}: ticker cannot be both stock and ETF`, errors);
  }

  for (const [group, kind] of Object.entries(NODE_GROUP_KINDS)) {
    for (const node of nodeGroups[group]) {
      assert(isValidEntityKey(kind, node?.id), `${node?.id}: invalid ${kind} canonical key`, errors);
    }
  }

  warn(graph.totals?.stocks >= 1000, "stock graph coverage is below 1000 stocks", warnings);
  warn(graph.totals?.etfs >= 5000, "ETF graph coverage is below 5000 ETFs", warnings);
  warn(graph.totals?.stocks_with_market_facts >= 1000, "market_facts coverage is below 1000 stocks", warnings);
  warn(graph.totals?.stocks_with_filings >= 150, "filing coverage is below 150 stocks", warnings);
  warn(graph.totals?.stocks_with_13f >= 450, "13F coverage is below 450 stocks", warnings);
  warn(graph.totals?.stocks_with_single_stock_etfs >= 50, "single-stock ETF reverse coverage is below 50 stocks", warnings);
  warn(graph.totals?.sectors >= 10, "sector graph should contain canonical sectors", warnings);
  assert(Number.isInteger(graph.diagnostics?.stock_alias_collisions) && graph.diagnostics.stock_alias_collisions < 200, "stock alias collision diagnostics should stay below 200", errors);
  assert(Number.isInteger(graph.diagnostics?.single_stock_etfs_unresolved), "single-stock ETF unresolved diagnostic count is required", errors);
  assert(Array.isArray(graph.diagnostics?.single_stock_etfs_unresolved_list), "single-stock ETF unresolved diagnostic list is required", errors);
  assert(
    graph.diagnostics?.single_stock_etfs_unresolved === graph.diagnostics?.single_stock_etfs_unresolved_list?.length,
    "single-stock ETF unresolved diagnostic count must match list length",
    errors,
  );
  const marketFactsEvidence = producerEvidence.get("market_facts");
  if (marketFactsEvidence?.sourceDiagnosticsMigrationPending) {
    warnings.push("market_facts source-stamp diagnostics pending producer regeneration");
  } else {
    assert(
      marketFactsEvidence?.sourceDiagnosticsMigrationPartial !== true,
      "market_facts source-stamp diagnostics migration is partial",
      errors,
    );
    assert(
      graph.diagnostics?.market_facts_core_price_source_complete === marketFactsEvidence?.sourceComplete,
      "market_facts source completeness must match producer diagnostics",
      errors,
    );
    assert(
      graph.diagnostics?.market_facts_core_price_missing_count === marketFactsEvidence?.missingCount,
      "market_facts missing-source count must match producer diagnostics",
      errors,
    );
    assert(
      isDeepStrictEqual(graph.diagnostics?.market_facts_core_price_missing_tickers, marketFactsEvidence?.missingTickers),
      "market_facts missing-source ticker list must match producer diagnostics",
      errors,
    );
    if (marketFactsEvidence?.missingCount > 0) {
      warnings.push(`market_facts source dates are partial for ${marketFactsEvidence.missingCount} core ticker(s): ${(marketFactsEvidence.missingTickers || []).join(", ")}`);
    }
  }

  for (const stock of nodeGroups.stocks) {
    assert(nonEmptyString(stock?.ticker), `${stock?.id}: stock ticker is required`, errors);
    assert(stock?.type === "stock", `${stock?.id}: stock node type must be stock`, errors);
    assert(stock?.id === makeEntityKey("stock", stock?.ticker), `${stock?.id}: stock id must match ticker key`, errors);
    warn(stock?.source_links?.stocks_analyzer === true, `${stock?.id}: stocks_analyzer lane is unavailable`, warnings);
    warn(stock?.source_links?.stock_action_index === true, `${stock?.id}: stock_action_index lane is unavailable`, warnings);
    assert(stock?.as_of?.profile === graph.source_as_of?.stocks_analyzer, `${stock?.id}: profile as_of must match stocks_analyzer source`, errors);
    assert(stock?.as_of?.action_index === graph.source_as_of?.stock_action_index, `${stock?.id}: action_index as_of must match source`, errors);
    const stockMarketFactsEvidence = marketFactsTickerSource(stock.ticker, errors);
    assert(stock?.source_links?.market_facts === stockMarketFactsEvidence.exists, `${stock?.id}: market_facts source linkage must match producer file`, errors);
    assert(stock?.as_of?.market_facts === (stockMarketFactsEvidence.exists ? stockMarketFactsEvidence.sourceAsOf : null), `${stock?.id}: market_facts as_of must match ticker producer evidence`, errors);
    assert(stock?.as_of?.filings === (stock?.source_links?.edgar_summary ? graph.source_as_of?.edgar_summaries : null), `${stock?.id}: filings as_of must match source linkage`, errors);
    assert(stock?.as_of?.sec_13f === (stock?.source_links?.sec_13f ? graph.source_as_of?.sec_13f : null), `${stock?.id}: sec_13f as_of must match source linkage`, errors);
    if (stockIndex) assert(isDeepStrictEqual(stockIndexRows[stock.ticker]?.as_of, stock?.as_of), `${stock?.id}: stock index as_of must match graph node`, errors);
    assert(Array.isArray(stock?.relations), `${stock?.id}: relations are required`, errors);
    assert(Array.isArray(stock?.service_flags), `${stock?.id}: service_flags are required`, errors);
    for (const flag of Array.isArray(stock?.service_flags) ? stock.service_flags : []) {
      assert(allowedServiceFlags.has(flag), `${stock?.id}: unknown service flag ${flag}`, errors);
    }
    warn(stock?.service_flags?.includes("screener"), `${stock?.id}: screener service is unavailable`, warnings);
    warn(stock?.service_flags?.includes("stock_detail"), `${stock?.id}: stock detail service is unavailable`, warnings);
  }

  for (const etf of nodeGroups.etfs) {
    assert(nonEmptyString(etf?.ticker), `${etf?.id}: ETF ticker is required`, errors);
    assert(etf?.type === "etf", `${etf?.id}: ETF node type must be etf`, errors);
    assert(etf?.id === makeEntityKey("etf", etf?.ticker), `${etf?.id}: ETF id must match ticker key`, errors);
    warn(etf?.source_links?.etf_universe === true, `${etf?.id}: ETF universe lane is unavailable`, warnings);
    assert(etf?.as_of?.etf_universe === graph.source_as_of?.etf_universe, `${etf?.id}: etf_universe as_of must match honest aggregate source`, errors);
    const etfMarketFactsEvidence = marketFactsTickerSource(etf.ticker, errors);
    assert(etf?.source_links?.market_facts === etfMarketFactsEvidence.exists, `${etf?.id}: market_facts source linkage must match producer file`, errors);
    assert(etf?.as_of?.market_facts === (etfMarketFactsEvidence.exists ? etfMarketFactsEvidence.sourceAsOf : null), `${etf?.id}: market_facts as_of must match ticker producer evidence`, errors);
    assert(allowedConfidenceLabels.has(etf?.confidence?.label), `${etf?.id}: ETF confidence label must be known`, errors);
    assert(Array.isArray(etf?.service_flags), `${etf?.id}: ETF service_flags are required`, errors);
    for (const flag of Array.isArray(etf?.service_flags) ? etf.service_flags : []) {
      assert(allowedServiceFlags.has(flag), `${etf?.id}: unknown service flag ${flag}`, errors);
    }
    warn(etf?.service_flags?.includes("etf_center"), `${etf?.id}: ETF center service is unavailable`, warnings);
  }

  for (const filing of nodeGroups.filings) {
    assert(filing?.as_of === graph.source_as_of?.edgar_summaries, `${filing?.id}: filing as_of must match EDGAR aggregate source`, errors);
  }
  for (const row of nodeGroups.sec13f) {
    assert(row?.as_of === graph.source_as_of?.sec_13f, `${row?.id}: 13F as_of must match source`, errors);
  }
  for (const node of [...nodeGroups.stocks, ...nodeGroups.etfs]) {
    for (const relation of Array.isArray(node?.relations) ? node.relations : []) {
      assert(nodeIds.has(relation?.target), `${node?.id}: broken relation target ${relation?.target}`, errors);
    }
  }
}

if (stockServices) {
  for (const [ticker, row] of Object.entries(stockServiceRows)) {
    assert(plainObject(row), `${ticker}: services entry must be an object`, errors);
    const stockKey = makeEntityKey("stock", ticker);
    const stockNode = nodesById.get(stockKey);
    assert(row?.target_key === stockKey, `${ticker}: services target_key must match stock key`, errors);
    assert(row?.ticker === ticker, `${ticker}: services ticker must match entry key`, errors);
    assert(row?.as_of?.etf_universe === stockServices.source_as_of?.etf_universe, `${ticker}: services etf_universe as_of must match source`, errors);
    assert(row?.as_of?.market_facts === marketFactsTickerSource(ticker, errors).sourceAsOf, `${ticker}: services market_facts as_of must match ticker producer evidence`, errors);
    if (stockIndex) assert(Boolean(stockIndexRows[ticker]?.flags?.single_stock_etfs), `${ticker}: services entry needs stock index single_stock_etfs flag`, errors);
    assert(Array.isArray(row?.single_stock_etfs), `${ticker}: services single_stock_etfs must be an array`, errors);
    for (const etf of Array.isArray(row?.single_stock_etfs) ? row.single_stock_etfs : []) {
      const etfKey = makeEntityKey("etf", etf?.ticker);
      const etfNode = nodesById.get(etfKey);
      assert(etf?.etf_key === etfKey, `${ticker}: services ETF etf_key must match ticker key: ${etf?.ticker}`, errors);
      assert(etf?.target_key === stockKey, `${ticker}: services ETF target_key must match stock key: ${etf?.ticker}`, errors);
      assert(etf?.as_of?.etf_universe === stockServices.source_as_of?.etf_universe, `${ticker}: services ETF etf_universe as_of must match source: ${etf?.ticker}`, errors);
      assert(etf?.as_of?.market_facts === marketFactsTickerSource(etf?.ticker, errors).sourceAsOf, `${ticker}: services ETF market_facts as_of must match ticker producer evidence: ${etf?.ticker}`, errors);
      assert(etf?.canonical_underlying_ticker === ticker, `${ticker}: services ETF canonical_underlying_ticker must match stock ticker: ${etf?.ticker}`, errors);
      assert(allowedConfidenceLabels.has(etf?.confidence), `${ticker}: services ETF confidence label must be known: ${etf?.ticker}`, errors);
      assert(allowedResolutionMethods.has(etf?.resolution_method), `${ticker}: services ETF needs known resolution_method: ${etf?.ticker}`, errors);
      if (graph) {
        assert(nodeIds.has(etfKey), `${ticker}: services ETF target not in graph: ${etf?.ticker}`, errors);
        assert(etfNode?.service_flags?.includes("single_stock"), `${ticker}: services ETF must carry single_stock service flag: ${etf?.ticker}`, errors);
        assert((etfNode?.relations || []).some((relation) => relation.type === "tracks_underlying" && relation.target === stockKey), `${ticker}: services ETF must track stock target in graph: ${etf?.ticker}`, errors);
        assert((stockNode?.relations || []).some((relation) => relation.type === "referenced_by_single_stock_etf" && relation.target === etfKey), `${ticker}: stock node must carry reverse single-stock ETF relation: ${etf?.ticker}`, errors);
      }
      assert(nonEmptyString(etf?.classification_source), `${ticker}: services ETF needs classification_source: ${etf?.ticker}`, errors);
      assert(nonEmptyString(etf?.raw_underlying), `${ticker}: services ETF needs raw_underlying: ${etf?.ticker}`, errors);
      assert(nonEmptyString(etf?.resolution_source), `${ticker}: services ETF needs resolution_source: ${etf?.ticker}`, errors);
      assert(nonEmptyString(etf?.matched_alias), `${ticker}: services ETF needs matched_alias: ${etf?.ticker}`, errors);
      if (etf?.confidence !== "high" || etf?.resolution_method !== "direct") {
        assert(nonEmptyString(etf?.resolution_note), `${ticker}: non-direct or non-high services ETF needs resolution_note: ${etf?.ticker}`, errors);
      }
      if (etf?.resolution_method === "regex" && nonEmptyString(etf?.raw_underlying)) {
        assert(etf.raw_underlying.toUpperCase().includes(etf?.canonical_underlying_ticker), `${ticker}: regex-resolved ETF should include ticker token in raw_underlying: ${etf?.ticker}`, errors);
      }
    }
  }
}

if (stockIndex) {
  for (const [ticker, row] of Object.entries(stockIndexRows)) {
    assert(plainObject(row), `${ticker}: stock index entry must be an object`, errors);
    const stockKey = makeEntityKey("stock", ticker);
    assert(row?.key === stockKey, `${ticker}: stock index key must match ticker key`, errors);
    assert(row?.ticker === ticker, `${ticker}: stock index ticker must match entry key`, errors);
    const flags = plainObject(row?.flags) ? row.flags : {};
    const expectedConnectionCount = [flags.market_facts, flags.filings, flags.sec_13f, flags.index_membership].filter(Boolean).length;
    assert(row?.connection_count === expectedConnectionCount, `${ticker}: connection_count must count core 4 sources only`, errors);
    if (stockServices) {
      const serviceLinks = stockServiceRows[ticker]?.single_stock_etfs || [];
      assert((row?.service_count || 0) === serviceLinks.length, `${ticker}: service_count must match stock services single_stock_etfs length`, errors);
      assert(Boolean(flags.single_stock_etfs) === (serviceLinks.length > 0), `${ticker}: single_stock_etfs flag must match service sidecar`, errors);
    }
  }
}

const marketFactsSourceAsOfMigrationPendingCount = marketFactsSourceAsOfMigrationPendingTickers.size;
const marketFactsSourceAsOfMigrationTotalCount = producerEvidence.get("market_facts")?.tickerCount
  ?? marketFactsTickerEvidenceCache.size;
if (marketFactsSourceAsOfMigrationPendingCount > 0) {
  warnings.push(
    `${marketFactsSourceAsOfMigrationPendingCount} of ${marketFactsSourceAsOfMigrationTotalCount} market_facts tickers pending source_as_of_scope migration; will resolve as the producer regenerates them`,
  );
}

if (errors.length) {
  console.error("data graph check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const uniqueWarnings = [...new Set(warnings)];
for (const warning of uniqueWarnings) console.warn(`::warning:: data graph degraded: ${warning}`);

console.log(JSON.stringify({
  ok: true,
  status: uniqueWarnings.length > 0 ? "degraded" : "ready",
  warnings: uniqueWarnings,
  totals: graph?.totals ?? stockIndex?.totals ?? stockServices?.totals ?? null,
  source_as_of: graph?.source_as_of ?? stockIndex?.source_as_of ?? stockServices?.source_as_of ?? null,
  source_as_of_reason: graph?.source_as_of_reason ?? stockIndex?.source_as_of_reason ?? stockServices?.source_as_of_reason ?? null,
  migration: {
    market_facts_source_as_of_scope: {
      status: marketFactsSourceAsOfMigrationPendingCount > 0 ? "degraded" : "ready",
      pending_count: marketFactsSourceAsOfMigrationPendingCount,
      total_count: marketFactsSourceAsOfMigrationTotalCount,
    },
  },
}, null, 2));
