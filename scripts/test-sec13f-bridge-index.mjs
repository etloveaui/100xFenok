#!/usr/bin/env node
/** Independent regression gate for the review-only SEC 13F boundary index. */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_PATH = path.join(ROOT, "data/computed/sec13f_bridge_index.json");
const ESTIMATE_FIELDS = [
  "earnings_estimate",
  "revenue_estimate",
  "growth_estimates",
  "eps_trend",
  "eps_revisions",
  "recommendations_summary",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmpty(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "";
}

function deterministicGeneratedAt(values) {
  const valid = values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .map((value) => new Date(value).toISOString());
  return valid.length ? valid.sort().at(-1) : null;
}

function sha256File(relativePath) {
  return crypto.createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, relativePath)))
    .digest("hex");
}

function aggregateFileDigest(relativePaths) {
  const hash = crypto.createHash("sha256");
  for (const relativePath of [...relativePaths].sort()) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(ROOT, relativePath)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

const index = readJson("data/computed/sec13f_bridge_index.json");
const analyzer = readJson("data/global-scouter/core/stocks_analyzer.json");
const actionIndex = readJson("data/computed/stock_action_index.json");
const marketFactsIndex = readJson("data/computed/market_facts/index.json");
const sec13fByTicker = readJson("data/sec-13f/by_ticker.json");
const sec13fSummary = readJson("data/sec-13f/summary.json");

assert.equal(index.schema_version, "sec13f-bridge-index/v1");
assert.equal(index.contract.graph_expansion, "held");
assert.equal(index.contract.freshness_credit, false);
assert.equal(index.contract.consumer, "none; review-only until owner-approved bridge contract");
assert.equal(index.contract.public_route, null);
assert.equal(index.contract.live_readback, "not_verified");
assert.equal(index.graph_invariants.graph_mutation_applied, false);
assert.equal(index.graph_invariants.public_surface_mutation_applied, false);

const core = new Set((analyzer.data ?? []).map((row) => normalizeTicker(row.symbol)).filter(Boolean));
const action = new Map(
  (actionIndex.rows ?? [])
    .map((row) => [normalizeTicker(row.symbol), row])
    .filter(([ticker]) => ticker),
);
const marketFacts = new Map(
  (marketFactsIndex.rows ?? [])
    .map((row) => [normalizeTicker(row.ticker), row])
    .filter(([ticker]) => ticker),
);
const secTickers = Object.keys(sec13fByTicker).map(normalizeTicker).filter(Boolean).sort();
const outside = secTickers.filter((ticker) => !core.has(ticker));
const intersection = secTickers.filter((ticker) => core.has(ticker));

// DEC-325 is an intentional regression pin. DEC-379 expanded the canonical
// 13F cohort from 60 to 63 investors; these post-reseal counts keep that
// approved source expansion from silently widening the product surface.
assert.equal(core.size, 1066, "Global Scouter analyzer core count drifted");
assert.equal(secTickers.length, 1025, "SEC 13F ticker count drifted");
assert.equal(intersection.length, 424, "SEC 13F/core intersection drifted");
assert.equal(outside.length, 601, "SEC 13F outside-core boundary drifted");

const expected = new Map();
for (const ticker of outside) {
  const actionRow = action.get(ticker) ?? null;
  const marketRow = marketFacts.get(ticker) ?? null;
  const type = actionRow && marketRow?.asset_type === "stock"
    ? "sec13f_extension_stock"
    : !actionRow && marketRow
      ? "sec13f_market_facts_only"
      : !actionRow && !marketRow
        ? "sec13f_unresolved"
        : "sec13f_action_index_only";
  const classes = type === "sec13f_extension_stock"
    ? ["action_plus_market_facts"]
    : type === "sec13f_market_facts_only"
      ? ["market_facts_only", "no_action_index_overlap"]
      : type === "sec13f_unresolved"
        ? ["no_action_index_overlap", "no_market_facts"]
        : ["action_index_only"];
  expected.set(ticker, { type, classes, actionRow, marketRow });
}

assert.equal(index.rows.length, outside.length);
assert.deepEqual(index.rows.map((row) => row.ticker), [...outside].sort());
assert.equal(new Set(index.rows.map((row) => row.ticker)).size, index.rows.length);
for (const row of index.rows) {
  const expectedRow = expected.get(row.ticker);
  assert.ok(expectedRow, `${row.ticker} is not an outside-core SEC ticker`);
  assert.equal(row.classification.type, expectedRow.type, `${row.ticker} type drift`);
  assert.deepEqual(row.classification.classes, expectedRow.classes, `${row.ticker} class drift`);
  assert.equal(row.source_links.global_scouter_core, false);
  assert.equal(row.acceptance.producer_typed_marker, false);
  assert.equal(row.acceptance.promotion_status, "held");
  assert.equal(row.acceptance.current_consumer, null);
  assert.equal(row.acceptance.public_route, null);
  assert.equal(row.acceptance.live_readback, "not_verified");
}

const countClass = (name) => index.rows.filter((row) => row.classification.classes.includes(name)).length;
assert.equal(countClass("action_plus_market_facts"), 76);
assert.equal(countClass("market_facts_only"), 36);
assert.equal(countClass("no_action_index_overlap"), 525);
assert.equal(countClass("no_market_facts"), 489);
assert.equal(countClass("action_index_only"), 0);
assert.equal(index.counts.sec13f_extension_stock, 76);
assert.equal(index.counts.sec13f_market_facts_only, 36);
assert.equal(index.counts.sec13f_unresolved, 489);

const extensionRows = index.rows.filter((row) => row.classification.type === "sec13f_extension_stock");
assert.equal(extensionRows.length, 76);
assert.equal(extensionRows.filter((row) => row.completeness.per_present).length, 69);
assert.equal(extensionRows.filter((row) => !row.completeness.per_present).length, 7);
assert.equal(extensionRows.filter((row) => row.completeness.forward_pe_present).length, 76);
assert.equal(extensionRows.filter((row) => row.completeness.market_facts_price_observed).length, 76);
assert.equal(extensionRows.filter((row) => row.completeness.bridge_field_floor).length, 76);
// Re-pinned 2026-08-21 from 38/38. The Yahoo broad-finance lane had not
// published since 2026-08-16, so these rows were starved of current estimates;
// restoring publication moved 36 rows from incomplete to full in one refresh.
// Structural counts are deliberately unchanged - 76 extension rows, 36
// market-facts-only, 525 no-overlap, 489 unresolved, 601 outside-core - so this
// is completeness improving, not the graph expanding.
assert.equal(extensionRows.filter((row) => row.yf_estimates.state === "full").length, 74);
assert.equal(extensionRows.filter((row) => row.yf_estimates.state === "incomplete").length, 2);
assert.deepEqual(index.counts.estimate, {
  extension_full: 74,
  extension_incomplete: 2,
  market_facts_only_incomplete: 36,
  unresolved_absent: 489,
  as_of: {
    bridge_generated_at: index.generated_at,
    yf_finance: deterministicGeneratedAt(index.rows.map((row) => row.yf_estimates.source_as_of)),
    market_facts: marketFactsIndex.core_surface_source_as_of ?? null,
    sec13f: sec13fSummary.metadata?.source_quarter ?? null,
  },
});
assert.equal(index.counts.price_observed_extension, 76);
assert.equal(index.counts.price_observed_extension_as_of, marketFactsIndex.core_surface_source_as_of ?? null);

const expectedYfPaths = extensionRows.map((row) => row.yf_estimates.path).filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
const expectedMarketFactsDetailPaths = outside
  .filter((ticker) => marketFacts.has(ticker))
  .map((ticker) => `data/computed/market_facts/tickers/${ticker}.json`)
  .filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
assert.equal(index.input_fingerprints.analyzer, sha256File("data/global-scouter/core/stocks_analyzer.json"));
assert.equal(index.input_fingerprints.action_index, sha256File("data/computed/stock_action_index.json"));
assert.equal(index.input_fingerprints.market_facts, sha256File("data/computed/market_facts/index.json"));
assert.equal(index.input_fingerprints.sec13f_by_ticker, sha256File("data/sec-13f/by_ticker.json"));
assert.equal(index.input_fingerprints.sec13f_summary, sha256File("data/sec-13f/summary.json"));
assert.equal(index.input_fingerprints.market_facts_details.file_count, expectedMarketFactsDetailPaths.length);
assert.equal(index.input_fingerprints.market_facts_details.sha256, aggregateFileDigest(expectedMarketFactsDetailPaths));
assert.equal(index.input_fingerprints.yf_finance_candidates.file_count, expectedYfPaths.length);
assert.equal(index.input_fingerprints.yf_finance_candidates.sha256, aggregateFileDigest(expectedYfPaths));
assert.equal(index.source_as_of.sec13f, sec13fSummary.metadata?.source_quarter ?? null);

for (const row of extensionRows) {
  const actionRow = action.get(row.ticker);
  const marketRow = marketFacts.get(row.ticker);
  const marketFactsDetail = readJson(`data/computed/market_facts/tickers/${row.ticker}.json`);
  const priceFact = marketFactsDetail.facts?.price;
  const yf = readJson(row.yf_estimates.path);
  const missing = ESTIMATE_FIELDS.filter((field) => !isNonEmpty(yf.data?.[field]));
  assert.equal(row.market_facts.asset_type, "stock");
  assert.equal(row.market_facts.price.value, priceFact?.value ?? null);
  assert.equal(row.market_facts.price.confidence, priceFact?.confidence ?? null);
  assert.equal(row.stock_action_index.per, isFiniteNumber(actionRow.per) ? actionRow.per : null);
  assert.equal(row.stock_action_index.forward_pe, isFiniteNumber(actionRow.peForward) ? actionRow.peForward : null);
  assert.equal(row.yf_estimates.state, missing.length === 0 ? "full" : "incomplete");
  assert.deepEqual(row.yf_estimates.missing_fields, missing);
}

console.log(
  `sec13f bridge index: ok (core=${core.size}, sec13f=${secTickers.length}, `
  + `intersection=${intersection.length}, outside=${outside.length}, extension=${extensionRows.length})`,
);
