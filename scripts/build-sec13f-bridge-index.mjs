#!/usr/bin/env node
/**
 * Build the review-only SEC 13F boundary index.
 *
 * This artifact records the SEC tickers outside the Global Scouter analyzer
 * universe without widening the entity graph or changing any public consumer.
 * It is intentionally derived from committed inputs and is safe to regenerate
 * after the Stocks Analyzer / SEC 13F pipeline runs.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "data/computed/sec13f_bridge_index.json");
const ESTIMATE_FIELDS = [
  "earnings_estimate",
  "revenue_estimate",
  "growth_estimates",
  "eps_trend",
  "eps_revisions",
  "recommendations_summary",
];

const SOURCE_PATHS = Object.freeze({
  analyzer: "data/global-scouter/core/stocks_analyzer.json",
  action_index: "data/computed/stock_action_index.json",
  market_facts: "data/computed/market_facts/index.json",
  sec13f_by_ticker: "data/sec-13f/by_ticker.json",
  sec13f_summary: "data/sec-13f/summary.json",
});

function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`${relativePath} read failed: ${error.message}`);
  }
}

function readOptionalJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  return readJson(relativePath);
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

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256File(relativePath) {
  return sha256Bytes(fs.readFileSync(path.join(ROOT, relativePath)));
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

function deterministicGeneratedAt(values) {
  const valid = values
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .map((value) => new Date(value).toISOString());
  return valid.length ? valid.sort().at(-1) : null;
}

function estimateState(ticker) {
  const relativePath = `data/yf/finance/${ticker}.json`;
  const payload = readOptionalJson(relativePath);
  if (!payload) {
    return {
      file: false,
      path: relativePath,
      state: "absent",
      source_as_of: null,
      fields_present: [],
      missing_fields: [...ESTIMATE_FIELDS],
    };
  }
  const data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const fieldsPresent = ESTIMATE_FIELDS.filter((field) => isNonEmpty(data[field]));
  const missingFields = ESTIMATE_FIELDS.filter((field) => !fieldsPresent.includes(field));
  return {
    file: true,
    path: relativePath,
    state: missingFields.length === 0 ? "full" : "incomplete",
    source_as_of: payload.source_as_of ?? null,
    fields_present: fieldsPresent,
    missing_fields: missingFields,
  };
}

function classify({ action, marketFacts }) {
  if (action && marketFacts?.asset_type === "stock") {
    return {
      type: "sec13f_extension_stock",
      classes: ["action_plus_market_facts"],
    };
  }
  if (!action && marketFacts) {
    return {
      type: "sec13f_market_facts_only",
      classes: ["market_facts_only", "no_action_index_overlap"],
    };
  }
  if (!action && !marketFacts) {
    return {
      type: "sec13f_unresolved",
      classes: ["no_action_index_overlap", "no_market_facts"],
    };
  }
  return {
    type: "sec13f_action_index_only",
    classes: ["action_index_only"],
  };
}

function buildBridgeIndex() {
  const analyzer = readJson(SOURCE_PATHS.analyzer);
  const actionIndex = readJson(SOURCE_PATHS.action_index);
  const marketFactsIndex = readJson(SOURCE_PATHS.market_facts);
  const sec13fByTicker = readJson(SOURCE_PATHS.sec13f_by_ticker);
  const sec13fSummary = readJson(SOURCE_PATHS.sec13f_summary);

  const analyzerTickers = new Set((analyzer.data ?? []).map((row) => normalizeTicker(row.symbol)).filter(Boolean));
  const actionByTicker = new Map(
    (actionIndex.rows ?? [])
      .map((row) => [normalizeTicker(row.symbol), row])
      .filter(([ticker]) => ticker),
  );
  const marketFactsByTicker = new Map(
    (marketFactsIndex.rows ?? [])
      .map((row) => [normalizeTicker(row.ticker), row])
      .filter(([ticker]) => ticker),
  );
  const sec13fTickers = Object.keys(sec13fByTicker)
    .map(normalizeTicker)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const sec13fSet = new Set(sec13fTickers);
  const coreIntersection = sec13fTickers.filter((ticker) => analyzerTickers.has(ticker));
  const outsideCore = sec13fTickers.filter((ticker) => !analyzerTickers.has(ticker));

  const yfPaths = outsideCore
    .filter((ticker) => actionByTicker.has(ticker) && marketFactsByTicker.get(ticker)?.asset_type === "stock")
    .map((ticker) => `data/yf/finance/${ticker}.json`)
    .filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));
  const marketFactsDetailPaths = outsideCore
    .filter((ticker) => marketFactsByTicker.has(ticker))
    .map((ticker) => `data/computed/market_facts/tickers/${ticker}.json`)
    .filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath)));

  const rows = outsideCore.map((ticker) => {
    const action = actionByTicker.get(ticker) ?? null;
    const marketFacts = marketFactsByTicker.get(ticker) ?? null;
    const marketFactsDetail = marketFacts
      ? readOptionalJson(`data/computed/market_facts/tickers/${ticker}.json`)
      : null;
    const classification = classify({ action, marketFacts });
    const estimate = estimateState(ticker);
    const priceFact = marketFacts?.asset_type === "stock" ? marketFactsDetail?.facts?.price ?? null : null;
    const marketFactsPriceObserved = isFiniteNumber(priceFact?.value) && priceFact?.confidence === "observed";
    const actionPricePresent = isFiniteNumber(action?.price);
    const actionValuationPresent = isFiniteNumber(action?.per) || isFiniteNumber(action?.peForward);
    const estimateAccounted = estimate.state === "full" || estimate.state === "incomplete";
    const sec13f = sec13fByTicker[ticker] ?? {};

    return {
      ticker,
      classification,
      source_links: {
        sec13f_by_ticker: true,
        global_scouter_core: false,
        stock_action_index: Boolean(action),
        market_facts: Boolean(marketFacts),
        yf_finance: estimate.file,
      },
      sec13f: {
        holders_count: Array.isArray(sec13f.holders) ? sec13f.holders.length : 0,
        total_market_value: isFiniteNumber(sec13f.total_market_value) ? sec13f.total_market_value : null,
      },
      market_facts: marketFacts
        ? {
            asset_type: marketFacts.asset_type ?? null,
            source_as_of: marketFactsDetail?.source_as_of ?? null,
            price: {
              present: isFiniteNumber(priceFact?.value),
              value: isFiniteNumber(priceFact?.value) ? priceFact.value : null,
              confidence: priceFact?.confidence ?? null,
              source: priceFact?.source ?? null,
              as_of: priceFact?.as_of ?? null,
            },
          }
        : null,
      stock_action_index: action
        ? {
            price: isFiniteNumber(action.price) ? action.price : null,
            market_cap: isFiniteNumber(action.marketCap) ? action.marketCap : null,
            per: isFiniteNumber(action.per) ? action.per : null,
            forward_pe: isFiniteNumber(action.peForward) ? action.peForward : null,
            confidence_label: action.confidenceLabel ?? null,
            quality_flags: Array.isArray(action.quality_flags) ? [...action.quality_flags] : [],
          }
        : null,
      yf_estimates: estimate,
      completeness: {
        market_facts_price_observed: marketFactsPriceObserved,
        action_price_present: actionPricePresent,
        action_valuation_present: actionValuationPresent,
        yf_estimate_or_absent_reason: estimateAccounted,
        bridge_field_floor: marketFactsPriceObserved && actionPricePresent && actionValuationPresent && estimateAccounted,
        per_present: isFiniteNumber(action?.per),
        forward_pe_present: isFiniteNumber(action?.peForward),
      },
      acceptance: {
        promotion_status: "held",
        reason: "missing_global_scouter_core_row",
        producer_typed_marker: false,
        current_consumer: null,
        public_route: null,
        live_readback: "not_verified",
      },
    };
  });

  const countClass = (className) => rows.filter((row) => row.classification.classes.includes(className)).length;
  const countType = (type) => rows.filter((row) => row.classification.type === type).length;
  const extensionRows = rows.filter((row) => row.classification.type === "sec13f_extension_stock");
  const marketFactsOnlyRows = rows.filter((row) => row.classification.type === "sec13f_market_facts_only");
  const unresolvedRows = rows.filter((row) => row.classification.type === "sec13f_unresolved");
  const sourceGeneratedAt = deterministicGeneratedAt([
    analyzer.generated_at,
    actionIndex.generated_at,
    marketFactsIndex.generated_at,
    sec13fSummary.metadata?.source_generated_at,
  ]);

  return {
    schema_version: "sec13f-bridge-index/v1",
    generated_at: sourceGeneratedAt,
    purpose: "Review-only typed inventory of SEC 13F tickers outside the Global Scouter analyzer universe.",
    contract: {
      candidate_type: "sec13f_extension_stock",
      consumer: "none; review-only until owner-approved bridge contract",
      public_route: null,
      live_readback: "not_verified",
      producer_typed_marker: false,
      graph_expansion: "held",
      freshness_credit: false,
      completeness_floor: [
        "market_facts.facts.price.value with confidence=observed",
        "stock_action_index price plus valuation field",
        "full YF estimate block or explicit missing-field reason",
      ],
    },
    source_files: SOURCE_PATHS,
    source_as_of: {
      stocks_analyzer: analyzer.source_date ?? null,
      stock_action_index: actionIndex.source_date ?? null,
      market_facts: marketFactsIndex.core_surface_source_as_of ?? null,
      sec13f: sec13fSummary.metadata?.source_quarter ?? null,
    },
    input_fingerprints: {
      analyzer: sha256File(SOURCE_PATHS.analyzer),
      action_index: sha256File(SOURCE_PATHS.action_index),
      market_facts: sha256File(SOURCE_PATHS.market_facts),
      sec13f_by_ticker: sha256File(SOURCE_PATHS.sec13f_by_ticker),
      sec13f_summary: sha256File(SOURCE_PATHS.sec13f_summary),
      market_facts_details: {
        file_count: marketFactsDetailPaths.length,
        sha256: aggregateFileDigest(marketFactsDetailPaths),
      },
      yf_finance_candidates: {
        file_count: yfPaths.length,
        sha256: aggregateFileDigest(yfPaths),
      },
    },
    graph_invariants: {
      core_stock_count: analyzerTickers.size,
      sec13f_ticker_count: sec13fSet.size,
      core_intersection_count: coreIntersection.length,
      warning_threshold: 450,
      graph_mutation_applied: false,
      public_surface_mutation_applied: false,
    },
    counts: {
      sec13f_outside_core: outsideCore.length,
      action_plus_market_facts: countClass("action_plus_market_facts"),
      market_facts_only: countClass("market_facts_only"),
      no_action_index_overlap: countClass("no_action_index_overlap"),
      no_market_facts: countClass("no_market_facts"),
      action_index_only: countClass("action_index_only"),
      sec13f_extension_stock: countType("sec13f_extension_stock"),
      sec13f_market_facts_only: countType("sec13f_market_facts_only"),
      sec13f_unresolved: countType("sec13f_unresolved"),
      estimate: {
        extension_full: extensionRows.filter((row) => row.yf_estimates.state === "full").length,
        extension_incomplete: extensionRows.filter((row) => row.yf_estimates.state === "incomplete").length,
        market_facts_only_incomplete: marketFactsOnlyRows.filter((row) => row.yf_estimates.state === "incomplete").length,
        unresolved_absent: unresolvedRows.filter((row) => row.yf_estimates.state === "absent").length,
        as_of: {
          bridge_generated_at: sourceGeneratedAt,
          yf_finance: deterministicGeneratedAt(rows.map((row) => row.yf_estimates.source_as_of)),
          market_facts: marketFactsIndex.core_surface_source_as_of ?? null,
          sec13f: sec13fSummary.metadata?.source_quarter ?? null,
        },
      },
      price_observed_extension: extensionRows.filter((row) => row.completeness.market_facts_price_observed).length,
      price_observed_extension_as_of: marketFactsIndex.core_surface_source_as_of ?? null,
    },
    rows,
  };
}

const payload = buildBridgeIndex();
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`);
console.log(
  `sec13f bridge index: outside_core=${payload.counts.sec13f_outside_core} `
  + `action_plus_market_facts=${payload.counts.action_plus_market_facts} `
  + `market_facts_only=${payload.counts.market_facts_only} `
  + `no_action_index_overlap=${payload.counts.no_action_index_overlap}`,
);

export { buildBridgeIndex };
