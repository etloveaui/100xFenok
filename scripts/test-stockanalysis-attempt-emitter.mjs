#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ATTEMPT_SCHEMA,
  classifyAttempt,
  validateAttemptEvidence,
  validateAttemptShard,
} from "./build-data-supply-detection-floor.mjs";
import {
  DATA_SUPPLY_DETECTION_CONFIG,
  validateDetectionConfig,
} from "./lib/data-supply-detection-config.mjs";
import {
  emitStockAnalysisAttempt,
} from "./emit-stockanalysis-attempt.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const ATTEMPT_ID = "gh-900-1";
const OBSERVED_AT = "2026-07-16T09:30:00.000Z";

function lane(id) {
  return DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === id);
}

function readShard(root, id) {
  return JSON.parse(fs.readFileSync(path.join(root, `${id}.json`), "utf8"));
}

assert.equal(validateDetectionConfig(DATA_SUPPLY_DETECTION_CONFIG), true);
// Flipped live by 844dfab743 on a real committed attempt shard; reverting to "shadow" must be an equally conscious edit here.
assert.equal(lane("yahoo_etf_fallback").enforcement, "live");
assert.equal(lane("yahoo_etf_fallback").endpoint_contract.transport, "library");
assert.equal(lane("stockanalysis_etf_universe").enforcement, "live");
assert.equal(
  Object.hasOwn(lane("stockanalysis_etf_universe").endpoint_contract, "transport"),
  false,
  "undeclared endpoint transport remains HTTP",
);
assert.deepEqual(
  lane("stockanalysis_etf_universe").freshness.source_basis,
  [],
  "a provider-dateless artifact must not promote collected_at into source_as_of",
);
assert.equal(lane("stockanalysis_surfaces").enforcement, "shadow");
assert.equal(lane("stockanalysis_surfaces").kpi_required, false);
assert.equal(lane("stockanalysis_stock_financial").enforcement, "live");
assert.equal(lane("stockanalysis_stock_financial").kpi_required, true);
assert.equal(lane("stockanalysis_stock_financial").endpoint_contract.transport, "library");
assert.deepEqual(
  lane("stockanalysis_stock_financial").endpoint_contract.assertions
    .filter((assertion) => assertion.kind === "exact")
    .map((assertion) => [assertion.id, assertion.pointer, assertion.value]),
  [
    ["stock_financial_requested", "/counts/requested", 8],
    ["stock_financial_stock_ok", "/counts/stock_ok", 8],
    ["stock_financial_financial_ok", "/counts/financial_ok", 8],
    ["stock_financial_failed", "/counts/failed", 0],
    ["stock_financial_tickers", "/tickers", ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "JPM"]],
  ],
);
assert.deepEqual(
  lane("stockanalysis_surfaces").freshness.source_basis,
  [],
  "surface collection must not fabricate an aggregate provider source date",
);
const surfaceArtifactContract = lane("stockanalysis_surfaces").producer_members[0].artifact_contracts[0];
const surfaceAssertions = surfaceArtifactContract.assertions;
assert.deepEqual(
  surfaceAssertions.filter((assertion) => assertion.kind === "exact")
    .map((assertion) => [assertion.id, assertion.pointer, assertion.value]),
  [
    ["source_stockanalysis", "/source", "stockanalysis"],
    ["asset_type_surface_index", "/asset_type", "surface_index"],
    ["surface_index_canonical_requested", "/counts/surfaces_requested", 25],
    ["surface_index_canonical_ok", "/counts/ok", 25],
    ["surface_index_canonical_failures", "/counts/failed", 0],
  ],
  "the canonical core index must prove its full 25-surface acquisition, not a partial attempt",
);
const surfaceResultsAssertion = surfaceAssertions.find((assertion) => assertion.id === "surface_index_results");
assert.equal(surfaceResultsAssertion?.kind, "object_array_fields");
assert.equal(surfaceResultsAssertion?.min, 25, "canonical surface index needs one distinct row per core surface");
assert.equal(surfaceResultsAssertion?.unique_by, "surface");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "stockanalysis-attempt-"));
try {
  const empty = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: ATTEMPT_ID,
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 0, observations: [] },
  });
  assert.equal(empty.candidates, 0);
  assert.equal(empty.retry_count, 0);
  assert.equal(empty.latency_ms, 0);
  assert.equal(empty.outcome, "no_fallback_candidates");
  assert.equal(empty.http_status, null);
  assert.equal(classifyAttempt(empty).reason, "ok");
  validateAttemptShard(readShard(root, "yahoo_etf_fallback"), "yahoo_etf_fallback");
  const libraryShard = readShard(root, "yahoo_etf_fallback");
  const fabricatedLibraryStatus = structuredClone(libraryShard);
  fabricatedLibraryStatus.attempts[0].http_status = 200;
  assert.throws(
    () => validateAttemptShard(fabricatedLibraryStatus, "yahoo_etf_fallback"),
    /fabricates an HTTP status/,
  );
  const missingLibraryEvidence = structuredClone(libraryShard);
  delete missingLibraryEvidence.attempts[0].retry_count;
  assert.throws(() => validateAttemptShard(missingLibraryEvidence, "yahoo_etf_fallback"), /keys must be exactly/);
  const negativeLibraryEvidence = structuredClone(libraryShard);
  negativeLibraryEvidence.attempts[0].latency_ms = -1;
  assert.throws(() => validateAttemptShard(negativeLibraryEvidence, "yahoo_etf_fallback"), /library evidence is invalid/);

  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-901-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      fabricated_http_status: 200,
      observations: [],
    },
  }), /fabricated|http_status|library/i);

  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "stockanalysis_etf_universe",
    shardRoot: root,
    attemptId: "gh-902-1",
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 0, observations: [] },
  }), /transport|http/i);
  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902b-1",
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 1, fallback_enabled: true, observations: [] },
  }), /candidate_count/);
  assert.throws(() => emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902c-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 0,
      fallback_enabled: true,
      observations: [{ execution: "returned", retry_count: 0, latency_ms: 1, outcome: "success", document: {} }],
    },
  }), /zero candidates/);
  const disabled = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902d-1",
    observedAt: OBSERVED_AT,
    envelope: { transport: "library", candidate_count: 1, fallback_enabled: false, observations: [] },
  });
  assert.equal(disabled.outcome, "not_attempted");
  assert.equal(classifyAttempt(disabled).status, "unavailable");

  const returnedError = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902e-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        exception_kind: null,
        retry_count: 2,
        latency_ms: 81,
        outcome: "error",
      }],
    },
  });
  assert.equal(returnedError.execution, "returned");
  assert.equal(returnedError.exception_kind, null);
  assert.equal(returnedError.retry_count, 2);
  assert.equal(returnedError.latency_ms, 81);
  assert.equal(returnedError.outcome, "error");
  assert.equal(classifyAttempt(returnedError).reason, "unexpected_error");

  const producerFailure = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-902f-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 0,
      observations: [],
      producer_failure: { execution: "threw", exception_kind: "unexpected" },
    },
  });
  assert.equal(producerFailure.execution, "threw");
  assert.equal(producerFailure.candidates, 0);
  assert.equal(classifyAttempt(producerFailure).reason, "unexpected_error");

  const yahooReady = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-903-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 125,
        outcome: "success",
        document: { info: { symbol: "SPY", quoteType: "ETF" } },
      }],
    },
  });
  assert.equal(yahooReady.http_status, null);
  assert.equal(yahooReady.outcome, "success");
  assert.deepEqual(yahooReady.assertions, [{ id: "yahoo_etf_identity", passed: true }]);
  assert.equal(classifyAttempt(yahooReady).reason, "ok");

  const yahooDrift = emitStockAnalysisAttempt({
    laneId: "yahoo_etf_fallback",
    shardRoot: root,
    attemptId: "gh-904-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 30,
        outcome: "success",
        document: { info: { symbol: "SPY" } },
      }],
    },
  });
  assert.equal(classifyAttempt(yahooDrift).reason, "schema_drift");

  const universeReady = emitStockAnalysisAttempt({
    laneId: "stockanalysis_etf_universe",
    shardRoot: root,
    attemptId: "gh-905-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [{
        status_code: 200,
        document: { rows: [{ ticker: "SPY", name: "SPDR S&P 500 ETF Trust" }] },
      }],
    },
  });
  assert.equal(universeReady.http_status, 200);
  assert.equal(classifyAttempt(universeReady).reason, "ok");
  const nullHttpStatus = readShard(root, "stockanalysis_etf_universe");
  nullHttpStatus.attempts[0].http_status = null;
  assert.throws(() => validateAttemptShard(nullHttpStatus, "stockanalysis_etf_universe"), /returned tuple is invalid/);
  const httpWithLibraryEvidence = readShard(root, "stockanalysis_etf_universe");
  Object.assign(httpWithLibraryEvidence.attempts[0], {
    candidates: 1,
    retry_count: 0,
    latency_ms: 1,
    outcome: "success",
  });
  assert.throws(() => validateAttemptShard(httpWithLibraryEvidence, "stockanalysis_etf_universe"), /keys must be exactly/);

  const universeEmpty = emitStockAnalysisAttempt({
    laneId: "stockanalysis_etf_universe",
    shardRoot: root,
    attemptId: "gh-906-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [{ status_code: 200, document: { rows: [] } }],
    },
  });
  assert.equal(classifyAttempt(universeEmpty).reason, "empty_payload");

  const surfacesReady = emitStockAnalysisAttempt({
    laneId: "stockanalysis_surfaces",
    shardRoot: root,
    attemptId: "gh-907-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [{
        status_code: 200,
        document: {
          results: [{
            surface: "actions_recent",
            status: "ok",
            endpoint: "/actions/__data.json?x-sveltekit-invalidated=01",
            tables: 0,
            rows: 12,
            latency_ms: 42,
          }],
        },
      }],
    },
  });
  assert.equal(surfacesReady.http_status, 200);
  assert.equal(classifyAttempt(surfacesReady).reason, "ok");
  validateAttemptShard(readShard(root, "stockanalysis_surfaces"), "stockanalysis_surfaces");

  const stockFinancialReady = emitStockAnalysisAttempt({
    laneId: "stockanalysis_stock_financial",
    shardRoot: root,
    attemptId: "gh-907-stock-financial-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 0,
        outcome: "success",
        document: {
          counts: { requested: 8, stock_ok: 8, financial_ok: 8, failed: 0 },
          tickers: ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "JPM"],
          pairs: Array.from({ length: 8 }, (_, index) => ({
            ticker: `T${index}`,
            stock_path: `data/stockanalysis/stocks/T${index}.json`,
            financial_path: `data/stockanalysis/financials/T${index}.json`,
          })),
        },
      }],
    },
  });
  assert.equal(classifyAttempt(stockFinancialReady).reason, "ok");
  validateAttemptShard(readShard(root, "stockanalysis_stock_financial"), "stockanalysis_stock_financial");

  const stockFinancialTorn = emitStockAnalysisAttempt({
    laneId: "stockanalysis_stock_financial",
    shardRoot: root,
    attemptId: "gh-907-stock-financial-torn-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 0,
        outcome: "success",
        document: {
          counts: { requested: 8, stock_ok: 8, financial_ok: 7, failed: 1 },
          tickers: ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA"],
          pairs: Array.from({ length: 7 }, (_, index) => ({
            ticker: `T${index}`,
            stock_path: `data/stockanalysis/stocks/T${index}.json`,
            financial_path: `data/stockanalysis/financials/T${index}.json`,
          })),
        },
      }],
    },
  });
  assert.equal(classifyAttempt(stockFinancialTorn).reason, "schema_drift",
    "a torn stock/financial batch must not report ready");

  const stockFinancialWrongRoster = emitStockAnalysisAttempt({
    laneId: "stockanalysis_stock_financial",
    shardRoot: root,
    attemptId: "gh-907-stock-financial-wrong-roster-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "library",
      candidate_count: 1,
      observations: [{
        execution: "returned",
        retry_count: 0,
        latency_ms: 0,
        outcome: "success",
        document: {
          counts: { requested: 8, stock_ok: 8, financial_ok: 8, failed: 0 },
          tickers: ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD"],
          pairs: ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD"].map((ticker) => ({
            ticker,
            stock_path: `data/stockanalysis/stocks/${ticker}.json`,
            financial_path: `data/stockanalysis/financials/${ticker}.json`,
          })),
        },
      }],
    },
  });
  assert.equal(classifyAttempt(stockFinancialWrongRoster).reason, "schema_drift",
    "a different eight-ticker roster must not impersonate the bounded scheduled basket");

  const surfaceUnexpectedAfterSuccess = emitStockAnalysisAttempt({
    laneId: "stockanalysis_surfaces",
    shardRoot: root,
    attemptId: "gh-907b-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [
        {
          status_code: 200,
          document: {
            results: [{
              surface: "actions_recent",
              status: "ok",
              endpoint: "/actions/__data.json?x-sveltekit-invalidated=01",
              tables: 0,
              rows: 12,
              latency_ms: 42,
            }],
          },
        },
        { execution: "threw", exception_kind: "unexpected" },
      ],
    },
  });
  assert.equal(surfaceUnexpectedAfterSuccess.execution, "threw");
  assert.equal(surfaceUnexpectedAfterSuccess.exception_kind, "unexpected");
  assert.equal(classifyAttempt(surfaceUnexpectedAfterSuccess).reason, "unexpected_error",
    "a later unhandled surface failure must dominate earlier HTTP success");

  const surfaceSchemaDrift = emitStockAnalysisAttempt({
    laneId: "stockanalysis_surfaces",
    shardRoot: root,
    attemptId: "gh-908-1",
    observedAt: OBSERVED_AT,
    envelope: {
      transport: "http",
      observations: [{
        status_code: 200,
        document: { results: [{ surface: "", status: "ok", endpoint: "/actions/", tables: 0, rows: 0, latency_ms: 0 }] },
      }],
    },
  });
  assert.equal(classifyAttempt(surfaceSchemaDrift).reason, "schema_drift");
  const merged = {
    schema_version: ATTEMPT_SCHEMA,
    attempts: [
      ...readShard(root, "yahoo_etf_fallback").attempts,
      ...readShard(root, "stockanalysis_etf_universe").attempts,
      ...readShard(root, "stockanalysis_surfaces").attempts,
      ...readShard(root, "stockanalysis_stock_financial").attempts,
    ],
  };
  assert.equal(validateAttemptEvidence(merged), true, "lane-specific attempt IDs merge without collision");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const workflow = fs.readFileSync(new URL("../.github/workflows/fetch-stockanalysis.yml", import.meta.url), "utf8");
const laneManifest = JSON.parse(fs.readFileSync(
  new URL("../data/admin/lane-commit-manifest.json", import.meta.url),
  "utf8",
));
const stockanalysisLanePolicy = JSON.stringify(
  laneManifest.workflows[".github/workflows/fetch-stockanalysis.yml"],
);
assert.match(workflow, /test-stockanalysis-attempt-emitter\.mjs/);
assert.match(workflow, /stockanalysis_artifact\.py audit-stage/);
assert.match(stockanalysisLanePolicy, /detection-attempts\/yahoo_etf_fallback\.json/);
assert.match(stockanalysisLanePolicy, /detection-attempts\/stockanalysis_etf_universe\.json/);
assert.match(stockanalysisLanePolicy, /detection-attempts\/stockanalysis_surfaces\.json/);
assert.match(stockanalysisLanePolicy, /detection-attempts\/stockanalysis_stock_financial\.json/);


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-stockanalysis.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText: `${workflowText}\n${stockanalysisLanePolicy}`,
    workflowRel: ".github/workflows/fetch-stockanalysis.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), [
    "stockanalysis_etf_universe",
    "stockanalysis_stock_financial",
    "stockanalysis_surfaces",
    "yahoo_etf_fallback",
  ].sort(), "registry lane attribution for this workflow");
}

console.log("PASS stockanalysis attempt emitter");
