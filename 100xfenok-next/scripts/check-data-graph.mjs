#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ROOT_GRAPH_PATH = path.join(REPO_ROOT, "data", "computed", "entity_graph.json");
const PUBLIC_GRAPH_PATH = path.join(APP_ROOT, "public", "data", "computed", "entity_graph.json");

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
const errors = [];

assert(graph.schema_version === "data-entity-graph/v1", "schema_version must be data-entity-graph/v1", errors);
assert(typeof graph.generated_at === "string", "generated_at is required", errors);
assert(typeof graph.source_as_of?.stocks_analyzer === "string", "stocks_analyzer source_as_of is required", errors);
assert(typeof graph.source_as_of?.stock_action_index === "string", "stock_action_index source_as_of is required", errors);
assert(typeof graph.source_as_of?.edgar_summaries === "string", "edgar_summaries source_as_of is required", errors);
assert(comparableGraph(graph) === comparableGraph(publicGraph), "public entity graph mirror must match root graph", errors);

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
