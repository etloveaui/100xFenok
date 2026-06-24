#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { expectedEntityKeyPolicy, isValidEntityKey, makeEntityKey } from "../../scripts/lib/entity-key-policy.mjs";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ROOT_GRAPH_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph.json");
const PUBLIC_GRAPH_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph.json");
const ROOT_STOCK_INDEX_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph_stock_index.json");
const PUBLIC_STOCK_INDEX_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph_stock_index.json");
const ROOT_STOCK_SERVICES_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph_stock_services.json");
const PUBLIC_STOCK_SERVICES_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph_stock_services.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function comparableGraph(payload) {
  return JSON.stringify({
    schema_version: payload?.schema_version,
    source_as_of: payload?.source_as_of,
    key_policy: payload?.key_policy,
    totals: payload?.totals,
    diagnostics: payload?.diagnostics,
    nodes: payload?.nodes,
  });
}

function comparableKeyPolicy(payload) {
  return JSON.stringify(payload?.key_policy ?? null);
}

const graph = readJson(ROOT_GRAPH_PATH);
const publicGraph = readJson(PUBLIC_GRAPH_PATH);
const stockIndex = readJson(ROOT_STOCK_INDEX_PATH);
const publicStockIndex = readJson(PUBLIC_STOCK_INDEX_PATH);
const stockServices = readJson(ROOT_STOCK_SERVICES_PATH);
const publicStockServices = readJson(PUBLIC_STOCK_SERVICES_PATH);
const errors = [];
const expectedPolicy = expectedEntityKeyPolicy();
const expectedPolicyJson = JSON.stringify(expectedPolicy);
const allowedConfidenceLabels = new Set(["high", "medium", "low", "unknown"]);
const allowedResolutionMethods = new Set(["direct", "alias", "regex"]);
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

assert(graph.schema_version === "data-entity-graph/v1", "schema_version must be data-entity-graph/v1", errors);
assert(typeof graph.generated_at === "string", "generated_at is required", errors);
assert(typeof graph.source_as_of?.stocks_analyzer === "string", "stocks_analyzer source_as_of is required", errors);
assert(typeof graph.source_as_of?.stock_action_index === "string", "stock_action_index source_as_of is required", errors);
assert(typeof graph.source_as_of?.edgar_summaries === "string", "edgar_summaries source_as_of is required", errors);
assert(comparableKeyPolicy(graph) === expectedPolicyJson, "graph key_policy must match canonical registry", errors);
assert(comparableGraph(graph) === comparableGraph(publicGraph), "public entity graph mirror must match root graph", errors);

assert(stockIndex.schema_version === "data-entity-graph-stock-index/v1", "stock index schema_version must be data-entity-graph-stock-index/v1", errors);
assert(typeof stockIndex.generated_at === "string", "stock index generated_at is required", errors);
assert(comparableKeyPolicy(stockIndex) === expectedPolicyJson, "stock index key_policy must match canonical registry", errors);
assert(JSON.stringify(stockIndex) === JSON.stringify(publicStockIndex), "public stock index mirror must match root stock index", errors);
assert((stockIndex.totals?.stocks || 0) === (graph.totals?.stocks || 0), "stock index total must match graph stock total", errors);
assert((stockIndex.totals?.with_market_facts || 0) === (graph.totals?.stocks_with_market_facts || 0), "stock index market_facts total must match graph", errors);
assert((stockIndex.totals?.with_filings || 0) === (graph.totals?.stocks_with_filings || 0), "stock index filings total must match graph", errors);
assert((stockIndex.totals?.with_sec_13f || 0) === (graph.totals?.stocks_with_13f || 0), "stock index 13F total must match graph", errors);
assert(stockIndex.stocks?.NVDA?.flags?.market_facts === true, "stock index NVDA must link market_facts", errors);
assert(stockIndex.stocks?.NVDA?.flags?.filings === true, "stock index NVDA must link filings", errors);
assert(stockIndex.stocks?.NVDA?.flags?.sec_13f === true, "stock index NVDA must link 13F", errors);

assert(stockServices.schema_version === "data-entity-graph-stock-services/v1", "stock services schema_version must be data-entity-graph-stock-services/v1", errors);
assert(typeof stockServices.generated_at === "string", "stock services generated_at is required", errors);
assert(comparableKeyPolicy(stockServices) === expectedPolicyJson, "stock services key_policy must match canonical registry", errors);
assert(JSON.stringify(stockServices) === JSON.stringify(publicStockServices), "public stock services mirror must match root stock services", errors);
assert((stockServices.totals?.stocks || 0) === (graph.totals?.stocks || 0), "stock services stock total must match graph stock total", errors);
assert((stockServices.totals?.with_single_stock_etfs || 0) === (graph.totals?.stocks_with_single_stock_etfs || 0), "stock services single-stock ETF total must match graph", errors);
assert((stockIndex.totals?.with_single_stock_etfs || 0) === (stockServices.totals?.with_single_stock_etfs || 0), "stock index single-stock ETF total must match services", errors);
assert((stockServices.totals?.single_stock_etfs || 0) >= 100, "single-stock ETF service links should cover at least 100 ETFs", errors);
assert(stockIndex.stocks?.NVDA?.flags?.single_stock_etfs === true, "stock index NVDA must link single-stock ETFs", errors);
assert((stockServices.stocks?.NVDA?.single_stock_etfs || []).length >= 4, "stock services NVDA must list single-stock ETFs", errors);

const nodeGroups = graph.nodes || {};
const nodeGroupKinds = {
  stocks: "stock",
  etfs: "etf",
  sectors: "sector",
  etf_categories: "etf_category",
  filings: "filing",
  sec13f: "sec13f",
};
const allNodes = [
  ...(nodeGroups.stocks || []),
  ...(nodeGroups.etfs || []),
  ...(nodeGroups.sectors || []),
  ...(nodeGroups.etf_categories || []),
  ...(nodeGroups.filings || []),
  ...(nodeGroups.sec13f || []),
];
const nodeIds = new Set();
const nodesById = new Map();
for (const node of allNodes) {
  assert(typeof node.id === "string" && node.id.length > 0, "every node needs an id", errors);
  assert(!nodeIds.has(node.id), `duplicate node id: ${node.id}`, errors);
  nodeIds.add(node.id);
  nodesById.set(node.id, node);
}

for (const [group, kind] of Object.entries(nodeGroupKinds)) {
  for (const node of nodeGroups[group] || []) {
    assert(isValidEntityKey(kind, node.id), `${node.id}: invalid ${kind} canonical key`, errors);
  }
}

assert((graph.totals?.stocks || 0) >= 1000, "stock graph should cover at least 1000 stocks", errors);
assert((graph.totals?.etfs || 0) >= 5000, "ETF graph should cover at least 5000 ETFs", errors);
assert((graph.totals?.stocks_with_market_facts || 0) >= 1000, "stock market_facts links should cover at least 1000 stocks", errors);
assert((graph.totals?.stocks_with_filings || 0) >= 150, "filing links should cover at least 150 stocks", errors);
assert((graph.totals?.stocks_with_13f || 0) >= 450, "13F links should cover at least 450 stocks", errors);
assert((graph.totals?.stocks_with_single_stock_etfs || 0) >= 50, "single-stock ETF reverse links should cover at least 50 stocks", errors);
assert((graph.totals?.sectors || 0) >= 10, "sector graph should contain canonical sectors", errors);
assert((graph.diagnostics?.stock_alias_collisions || 0) < 200, "stock alias collision diagnostics should stay below 200", errors);

for (const stock of nodeGroups.stocks || []) {
  assert(stock.id === makeEntityKey("stock", stock.ticker), `${stock.id}: stock id must match ticker key`, errors);
  assert(stock.source_links?.stocks_analyzer === true, `${stock.id}: stocks_analyzer link is required`, errors);
  assert(stock.source_links?.stock_action_index === true, `${stock.id}: stock_action_index link is required`, errors);
  assert(typeof stock.as_of?.profile === "string", `${stock.id}: profile as_of is required`, errors);
  assert(Array.isArray(stock.relations), `${stock.id}: relations are required`, errors);
  assert(Array.isArray(stock.service_flags), `${stock.id}: service_flags are required`, errors);
  for (const flag of stock.service_flags || []) {
    assert(allowedServiceFlags.has(flag), `${stock.id}: unknown service flag ${flag}`, errors);
  }
  assert(stock.service_flags?.includes("screener"), `${stock.id}: stock service flags must include screener`, errors);
  assert(stock.service_flags?.includes("stock_detail"), `${stock.id}: stock service flags must include stock_detail`, errors);
}

for (const etf of nodeGroups.etfs || []) {
  assert(etf.id === makeEntityKey("etf", etf.ticker), `${etf.id}: ETF id must match ticker key`, errors);
  assert(etf.source_links?.etf_universe === true, `${etf.id}: etf_universe link is required`, errors);
  assert(typeof etf.as_of?.etf_universe === "string", `${etf.id}: etf_universe as_of is required`, errors);
  assert(allowedConfidenceLabels.has(etf.confidence?.label), `${etf.id}: ETF confidence label must be known`, errors);
  assert(Array.isArray(etf.service_flags), `${etf.id}: ETF service_flags are required`, errors);
  for (const flag of etf.service_flags || []) {
    assert(allowedServiceFlags.has(flag), `${etf.id}: unknown service flag ${flag}`, errors);
  }
  assert(etf.service_flags?.includes("etf_center"), `${etf.id}: ETF service flags must include etf_center`, errors);
}

for (const node of [...(nodeGroups.stocks || []), ...(nodeGroups.etfs || [])]) {
  for (const relation of node.relations || []) {
    assert(nodeIds.has(relation.target), `${node.id}: broken relation target ${relation.target}`, errors);
  }
}

for (const [ticker, row] of Object.entries(stockServices.stocks || {})) {
  const stockKey = makeEntityKey("stock", ticker);
  const stockNode = nodesById.get(stockKey);
  assert(row.target_key === stockKey, `${ticker}: services target_key must match stock key`, errors);
  assert(Boolean(stockIndex.stocks?.[ticker]?.flags?.single_stock_etfs), `${ticker}: services entry needs stock index single_stock_etfs flag`, errors);
  for (const etf of row.single_stock_etfs || []) {
    const etfKey = makeEntityKey("etf", etf.ticker);
    const etfNode = nodesById.get(etfKey);
    assert(etf.etf_key === etfKey, `${ticker}: services ETF etf_key must match ticker key: ${etf.ticker}`, errors);
    assert(etf.target_key === stockKey, `${ticker}: services ETF target_key must match stock key: ${etf.ticker}`, errors);
    assert(etf.canonical_underlying_ticker === ticker, `${ticker}: services ETF canonical_underlying_ticker must match stock ticker: ${etf.ticker}`, errors);
    assert(allowedConfidenceLabels.has(etf.confidence), `${ticker}: services ETF confidence label must be known: ${etf.ticker}`, errors);
    assert(allowedResolutionMethods.has(etf.resolution_method), `${ticker}: services ETF needs known resolution_method: ${etf.ticker}`, errors);
    assert(nodeIds.has(etfKey), `${ticker}: services ETF target not in graph: ${etf.ticker}`, errors);
    assert(etfNode?.service_flags?.includes("single_stock"), `${ticker}: services ETF must carry single_stock service flag: ${etf.ticker}`, errors);
    assert((etfNode?.relations || []).some((relation) => relation.type === "tracks_underlying" && relation.target === stockKey), `${ticker}: services ETF must track stock target in graph: ${etf.ticker}`, errors);
    assert((stockNode?.relations || []).some((relation) => relation.type === "referenced_by_single_stock_etf" && relation.target === etfKey), `${ticker}: stock node must carry reverse single-stock ETF relation: ${etf.ticker}`, errors);
    assert(typeof etf.classification_source === "string" && etf.classification_source.length > 0, `${ticker}: services ETF needs classification_source: ${etf.ticker}`, errors);
    assert(typeof etf.raw_underlying === "string" && etf.raw_underlying.length > 0, `${ticker}: services ETF needs raw_underlying: ${etf.ticker}`, errors);
    if (etf.resolution_method === "regex") {
      assert(etf.raw_underlying.toUpperCase().includes(etf.canonical_underlying_ticker), `${ticker}: regex-resolved ETF should include ticker token in raw_underlying: ${etf.ticker}`, errors);
    }
  }
}

for (const [ticker, row] of Object.entries(stockIndex.stocks || {})) {
  const flags = row.flags || {};
  const expectedConnectionCount = [
    flags.market_facts,
    flags.filings,
    flags.sec_13f,
    flags.index_membership,
  ].filter(Boolean).length;
  const serviceLinks = stockServices.stocks?.[ticker]?.single_stock_etfs || [];
  assert(row.connection_count === expectedConnectionCount, `${ticker}: connection_count must count core 4 sources only`, errors);
  assert((row.service_count || 0) === serviceLinks.length, `${ticker}: service_count must match stock services single_stock_etfs length`, errors);
  assert(Boolean(flags.single_stock_etfs) === serviceLinks.length > 0, `${ticker}: single_stock_etfs flag must match service sidecar`, errors);
}

if (errors.length) {
  console.error("data graph check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  totals: graph.totals,
  source_as_of: graph.source_as_of,
}, null, 2));
