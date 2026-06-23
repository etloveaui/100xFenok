#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

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
    nodes: payload?.nodes,
  });
}

const graph = readJson(ROOT_GRAPH_PATH);
const publicGraph = readJson(PUBLIC_GRAPH_PATH);
const stockIndex = readJson(ROOT_STOCK_INDEX_PATH);
const publicStockIndex = readJson(PUBLIC_STOCK_INDEX_PATH);
const stockServices = readJson(ROOT_STOCK_SERVICES_PATH);
const publicStockServices = readJson(PUBLIC_STOCK_SERVICES_PATH);
const errors = [];

assert(graph.schema_version === "data-entity-graph/v1", "schema_version must be data-entity-graph/v1", errors);
assert(typeof graph.generated_at === "string", "generated_at is required", errors);
assert(typeof graph.source_as_of?.stocks_analyzer === "string", "stocks_analyzer source_as_of is required", errors);
assert(typeof graph.source_as_of?.stock_action_index === "string", "stock_action_index source_as_of is required", errors);
assert(typeof graph.source_as_of?.edgar_summaries === "string", "edgar_summaries source_as_of is required", errors);
assert(comparableGraph(graph) === comparableGraph(publicGraph), "public entity graph mirror must match root graph", errors);

assert(stockIndex.schema_version === "data-entity-graph-stock-index/v1", "stock index schema_version must be data-entity-graph-stock-index/v1", errors);
assert(typeof stockIndex.generated_at === "string", "stock index generated_at is required", errors);
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
assert(JSON.stringify(stockServices) === JSON.stringify(publicStockServices), "public stock services mirror must match root stock services", errors);
assert((stockServices.totals?.stocks || 0) === (graph.totals?.stocks || 0), "stock services stock total must match graph stock total", errors);
assert((stockServices.totals?.with_single_stock_etfs || 0) === (graph.totals?.stocks_with_single_stock_etfs || 0), "stock services single-stock ETF total must match graph", errors);
assert((stockIndex.totals?.with_single_stock_etfs || 0) === (stockServices.totals?.with_single_stock_etfs || 0), "stock index single-stock ETF total must match services", errors);
assert((stockServices.totals?.single_stock_etfs || 0) >= 100, "single-stock ETF service links should cover at least 100 ETFs", errors);
assert(stockIndex.stocks?.NVDA?.flags?.single_stock_etfs === true, "stock index NVDA must link single-stock ETFs", errors);
assert((stockServices.stocks?.NVDA?.single_stock_etfs || []).length >= 4, "stock services NVDA must list single-stock ETFs", errors);

const nodeGroups = graph.nodes || {};
const allNodes = [
  ...(nodeGroups.stocks || []),
  ...(nodeGroups.etfs || []),
  ...(nodeGroups.sectors || []),
  ...(nodeGroups.etf_categories || []),
  ...(nodeGroups.filings || []),
  ...(nodeGroups.sec13f || []),
];
const nodeIds = new Set();
for (const node of allNodes) {
  assert(typeof node.id === "string" && node.id.length > 0, "every node needs an id", errors);
  assert(!nodeIds.has(node.id), `duplicate node id: ${node.id}`, errors);
  nodeIds.add(node.id);
}

assert((graph.totals?.stocks || 0) >= 1000, "stock graph should cover at least 1000 stocks", errors);
assert((graph.totals?.etfs || 0) >= 5000, "ETF graph should cover at least 5000 ETFs", errors);
assert((graph.totals?.stocks_with_market_facts || 0) >= 1000, "stock market_facts links should cover at least 1000 stocks", errors);
assert((graph.totals?.stocks_with_filings || 0) >= 150, "filing links should cover at least 150 stocks", errors);
assert((graph.totals?.stocks_with_13f || 0) >= 450, "13F links should cover at least 450 stocks", errors);
assert((graph.totals?.stocks_with_single_stock_etfs || 0) >= 50, "single-stock ETF reverse links should cover at least 50 stocks", errors);
assert((graph.totals?.sectors || 0) >= 10, "sector graph should contain canonical sectors", errors);

for (const stock of nodeGroups.stocks || []) {
  assert(stock.id === `ticker:${stock.ticker}`, `${stock.id}: stock id must match ticker key`, errors);
  assert(stock.source_links?.stocks_analyzer === true, `${stock.id}: stocks_analyzer link is required`, errors);
  assert(stock.source_links?.stock_action_index === true, `${stock.id}: stock_action_index link is required`, errors);
  assert(typeof stock.as_of?.profile === "string", `${stock.id}: profile as_of is required`, errors);
  assert(Array.isArray(stock.relations), `${stock.id}: relations are required`, errors);
}

for (const etf of nodeGroups.etfs || []) {
  assert(etf.id === `etf:${etf.ticker}`, `${etf.id}: ETF id must match ticker key`, errors);
  assert(etf.source_links?.etf_universe === true, `${etf.id}: etf_universe link is required`, errors);
  assert(typeof etf.as_of?.etf_universe === "string", `${etf.id}: etf_universe as_of is required`, errors);
}

for (const node of [...(nodeGroups.stocks || []), ...(nodeGroups.etfs || [])]) {
  for (const relation of node.relations || []) {
    assert(nodeIds.has(relation.target), `${node.id}: broken relation target ${relation.target}`, errors);
  }
}

for (const [ticker, row] of Object.entries(stockServices.stocks || {})) {
  assert(Boolean(stockIndex.stocks?.[ticker]?.flags?.single_stock_etfs), `${ticker}: services entry needs stock index single_stock_etfs flag`, errors);
  for (const etf of row.single_stock_etfs || []) {
    assert(nodeIds.has(`etf:${etf.ticker}`), `${ticker}: services ETF target not in graph: ${etf.ticker}`, errors);
  }
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
