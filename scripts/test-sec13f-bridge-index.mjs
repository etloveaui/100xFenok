#!/usr/bin/env node
/** Independent regression gate for the SEC 13F bridge index (live, honest 424/1,031 coverage). */

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

function readOptionalJson(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath)) ? readJson(relativePath) : null;
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
assert.equal(index.contract.consumer, "public/superinvestors and /data/computed/sec13f_bridge_index.json (honest 424/1,031 coverage)");
assert.equal(index.contract.public_route, "/data/computed/sec13f_bridge_index.json");
assert.equal(index.contract.live_readback, "verified");
assert.equal(index.contract.producer_typed_marker, true);
assert.equal(index.graph_invariants.graph_mutation_applied, false);
assert.equal(index.graph_invariants.public_surface_mutation_applied, true);

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
// Re-pinned 2026-08-21 from 1025/601. The pin did its job and the drift is
// legitimate: it is exactly one ticker, VGK. Yahoo broad-finance publication
// resumed at 8149bcc810 and populated data/yf/finance/VGK.json longName, which
// had been null; loadYfUniverse registers longName as a resolvable company
// name, and normalizeCompanyName maps both "Vanguard FTSE Europe ETF" and the
// 13F filings' "VANGUARD FTSE EUROPE ETF" (18 holdings, all previously
// ticker=null) onto VANGUARD FTSE EUROPE. The prior shortName
// "Vanguard FTSEEuropean ETF" normalizes to VANGUARD FTSEEUROPEAN and did not
// collide, which is why those holdings were unmapped until now. Measured:
// consensus unmapped_count 181 -> 180, alias_count 314 -> 315.
// core.size and intersection are deliberately NOT re-pinned - VGK is outside
// the Global Scouter core, so 1066 and 424 holding still is the evidence that
// this is one resolver mapping and not the graph expanding.
// Re-pinned 2026-09-20: exact CUSIPs resolve Liberty Live classes to LLYVA
// and LLYVK instead of IVE. Independent before/after ticker-set comparison
// adds exactly these two unresolved outside-core rows; no ticker is removed.
// Core, intersection, and enriched extension counts remain unchanged.
// Re-pinned 2026-09-25 against the CI-regenerated tree (run 36094280988
// publish e785ad7e2e; full-history 13F drop 413bc36373). The outside-core set
// gained exactly COMM, HL, SANM - all unresolved rows - and removed none:
// secTickers 1028 -> 1031, outside 604 -> 607, unresolved 491 -> 492,
// no-overlap 528 -> 529, no-mf 491 -> 492. Extension/action_plus 76 -> 78 and
// per_present 67 -> 69 had already drifted in the Sep 24 committed refresh and
// are re-pinned to the same measured values. core 1066 and intersection 424
// are unchanged: source-data growth and resolution, not the graph expanding.
assert.equal(core.size, 1066, "Global Scouter analyzer core count drifted");
assert.equal(secTickers.length, 1032, "SEC 13F ticker count drifted");
assert.equal(intersection.length, 424, "SEC 13F/core intersection drifted");
assert.equal(outside.length, 608, "SEC 13F outside-core boundary drifted");

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
  const priceFact = marketRow?.asset_type === "stock"
    ? readOptionalJson(`data/computed/market_facts/tickers/${ticker}.json`)?.facts?.price
    : null;
  const yf = readOptionalJson(`data/yf/finance/${ticker}.json`);
  const missingFields = ESTIMATE_FIELDS.filter((field) => !isNonEmpty(yf?.data?.[field]));
  const estimateState = !yf ? "absent" : missingFields.length === 0 ? "full" : "incomplete";
  const marketFactsPriceObserved = isFiniteNumber(priceFact?.value) && priceFact?.confidence === "observed";
  const actionPricePresent = isFiniteNumber(actionRow?.price);
  const actionValuationPresent = isFiniteNumber(actionRow?.per) || isFiniteNumber(actionRow?.peForward);
  const estimateAccounted = estimateState === "full" || estimateState === "incomplete";
  const completeness = {
    market_facts_price_observed: marketFactsPriceObserved,
    action_price_present: actionPricePresent,
    action_valuation_present: actionValuationPresent,
    yf_estimate_or_absent_reason: estimateAccounted,
    bridge_field_floor: marketFactsPriceObserved && actionPricePresent && actionValuationPresent && estimateAccounted,
    per_present: isFiniteNumber(actionRow?.per),
    forward_pe_present: isFiniteNumber(actionRow?.peForward),
  };
  expected.set(ticker, { type, classes, actionRow, marketRow, completeness, estimateState, missingFields });
}

assert.equal(index.rows.length, outside.length);
assert.deepEqual(index.rows.map((row) => row.ticker), [...outside].sort());
assert.equal(new Set(index.rows.map((row) => row.ticker)).size, index.rows.length);
for (const row of index.rows) {
  const expectedRow = expected.get(row.ticker);
  assert.ok(expectedRow, `${row.ticker} is not an outside-core SEC ticker`);
  assert.equal(row.classification.type, expectedRow.type, `${row.ticker} type drift`);
  assert.deepEqual(row.classification.classes, expectedRow.classes, `${row.ticker} class drift`);
  assert.deepEqual(row.completeness, expectedRow.completeness, `${row.ticker} completeness drift`);
  assert.equal(row.yf_estimates.state, expectedRow.estimateState, `${row.ticker} estimate state drift`);
  assert.deepEqual(row.yf_estimates.missing_fields, expectedRow.missingFields, `${row.ticker} missing estimate fields drift`);
  assert.equal(row.source_links.global_scouter_core, false);
  assert.equal(row.acceptance.producer_typed_marker, true);
  assert.equal(row.acceptance.promotion_status, "promoted");
  assert.equal(row.acceptance.current_consumer, "public/superinvestors and /data/computed/sec13f_bridge_index.json");
  assert.equal(row.acceptance.public_route, "/data/computed/sec13f_bridge_index.json");
  assert.equal(row.acceptance.live_readback, "verified");
}

const countClass = (name) => index.rows.filter((row) => row.classification.classes.includes(name)).length;
const expectedRows = [...expected.values()];
const expectedClassCount = (name) => expectedRows.filter((row) => row.classes.includes(name)).length;
const expectedTypeCount = (type) => expectedRows.filter((row) => row.type === type).length;
// Source enrichment may move an existing ticker between classes; the graph
// boundary stays pinned above while every aggregate remains source-derived.
for (const name of ["action_plus_market_facts", "market_facts_only", "no_action_index_overlap", "no_market_facts", "action_index_only"]) {
  assert.equal(countClass(name), expectedClassCount(name), `${name} row count drift`);
  assert.equal(index.counts[name], expectedClassCount(name), `${name} aggregate drift`);
}
for (const type of ["sec13f_extension_stock", "sec13f_market_facts_only", "sec13f_unresolved"]) {
  assert.equal(index.counts[type], expectedTypeCount(type), `${type} aggregate drift`);
}

const extensionRows = index.rows.filter((row) => row.classification.type === "sec13f_extension_stock");
const expectedExtensionRows = expectedRows.filter((row) => row.type === "sec13f_extension_stock");
const expectedCompletenessCount = (name) => expectedExtensionRows.filter((row) => row.completeness[name]).length;
const expectedEstimateCount = (type, state) => expectedRows.filter((row) => row.type === type && row.estimateState === state).length;
assert.equal(extensionRows.length, expectedExtensionRows.length);
assert.equal(extensionRows.filter((row) => row.completeness.per_present).length, expectedCompletenessCount("per_present"));
assert.equal(extensionRows.filter((row) => !row.completeness.per_present).length, expectedExtensionRows.length - expectedCompletenessCount("per_present"));
assert.equal(extensionRows.filter((row) => row.completeness.forward_pe_present).length, expectedCompletenessCount("forward_pe_present"));
assert.equal(extensionRows.filter((row) => row.completeness.market_facts_price_observed).length, expectedCompletenessCount("market_facts_price_observed"));
assert.equal(extensionRows.filter((row) => row.completeness.bridge_field_floor).length, expectedCompletenessCount("bridge_field_floor"));
assert.equal(extensionRows.filter((row) => row.yf_estimates.state === "full").length, expectedEstimateCount("sec13f_extension_stock", "full"));
assert.equal(extensionRows.filter((row) => row.yf_estimates.state === "incomplete").length, expectedEstimateCount("sec13f_extension_stock", "incomplete"));
assert.deepEqual(index.counts.estimate, {
  extension_full: expectedEstimateCount("sec13f_extension_stock", "full"),
  extension_incomplete: expectedEstimateCount("sec13f_extension_stock", "incomplete"),
  market_facts_only_incomplete: expectedEstimateCount("sec13f_market_facts_only", "incomplete"),
  unresolved_absent: expectedEstimateCount("sec13f_unresolved", "absent"),
  as_of: {
    bridge_generated_at: index.generated_at,
    yf_finance: deterministicGeneratedAt(index.rows.map((row) => row.yf_estimates.source_as_of)),
    market_facts: marketFactsIndex.core_surface_source_as_of ?? null,
    sec13f: sec13fSummary.metadata?.source_quarter ?? null,
  },
});
assert.equal(index.counts.price_observed_extension, expectedCompletenessCount("market_facts_price_observed"));
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
  assert.equal(row.completeness.bridge_field_floor, true, `${row.ticker} extension bridge field floor failed`);
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
