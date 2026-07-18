#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  mergeFilings,
  retainLatestFilingDates,
  runEdgarFilingTimeline,
} from "./build-edgar-filing-timeline.mjs";
import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OBSERVED_AT = "2026-07-15T02:00:00Z";
const ATTEMPT_ID = "edgar-filings-test-1";

function response(statusCode, document) {
  return {
    statusCode,
    body: typeof document === "string" ? document : JSON.stringify(document),
  };
}

function pathsFor(root) {
  return {
    analyzerPath: path.join(root, "data/global-scouter/core/stocks_analyzer.json"),
    edgarCachePath: path.join(root, "data/edgar/company_tickers.json"),
    summaryRoot: path.join(root, "data/edgar-korean-summaries"),
    publicSummaryRoot: path.join(root, "100xfenok-next/public/data/edgar-korean-summaries"),
    attemptShardPath: path.join(root, "data/admin/data-supply-state/detection-attempts/edgar_filings.json"),
  };
}

function companyTickers() {
  return {
    0: { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
    1: { cik_str: 320193, ticker: "AAPL", title: "APPLE INC" },
  };
}

function submissions(form = ["10-Q"]) {
  return {
    name: "NVIDIA CORP",
    filings: {
      recent: {
        form,
        accessionNumber: ["0001045810-26-000001"],
        primaryDocument: ["nvda-20260714.htm"],
        filingDate: ["2026-07-14"],
        reportDate: ["2026-06-30"],
      },
    },
  };
}

const edgar = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((lane) => lane.id === "edgar_filings");
assert.deepEqual(edgar.endpoint_contract.assertions, [{
  id: "recent_form_array",
  kind: "type",
  pointer: "/filings/recent/form",
  expected: "array",
}]);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-ready-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  });
  assert.equal(result.ok, true);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.lane_id, "edgar_filings");
  assert.equal(shard.attempts[0].attempt_id, ATTEMPT_ID);
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "recent_form_array", passed: true }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.summaryRoot, "index.json"), "utf8")).tickers.includes("NVDA"), true);
  assert.deepEqual(
    fs.readFileSync(path.join(paths.summaryRoot, "by-ticker/nvda.json")),
    fs.readFileSync(path.join(paths.publicSummaryRoot, "by-ticker/nvda.json")),
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-plan-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0", "--plan-only"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-plan",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(paths.attemptShardPath), true, "plan-only still emits attempt evidence");
  assert.equal(fs.existsSync(paths.edgarCachePath), false);
  assert.equal(fs.existsSync(path.join(paths.summaryRoot, "index.json")), false);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-partial-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA,AAPL", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-partial",
    request: async (url) => {
      if (url.includes("company_tickers")) return response(200, companyTickers());
      return url.includes("CIK0000320193")
        ? response(429, "rate limited")
        : response(200, submissions());
    },
  });
  assert.equal(result.ok, true, "one valid ticker keeps publishable producer output");
  assert.equal(result.telemetry_reason, "rate_limited");
  assert.equal(fs.existsSync(path.join(paths.summaryRoot, "by-ticker/nvda.json")), true);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].http_status, 429, "shard retains the partial failure");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-unresolved-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-unresolved",
    request: async () => response(200, {}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unexpected_error");
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.attempts[0].execution, "threw");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-guard-failure-"));
  const paths = pathsFor(root);
  fs.mkdirSync(path.dirname(paths.analyzerPath), { recursive: true });
  fs.writeFileSync(paths.analyzerPath, JSON.stringify({ bad: true }), "utf8");
  await assert.rejects(() => runEdgarFilingTimeline({
    argv: [],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-guard",
    request: async () => { throw new Error("request must not run"); },
  }));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.attempts[0].exception_kind, "unexpected");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-write-failure-"));
  const paths = pathsFor(root);
  const blocker = path.join(root, "summary-root-is-a-file");
  fs.writeFileSync(blocker, "not a directory", "utf8");
  paths.summaryRoot = blocker;
  await assert.rejects(() => runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-write-failure",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  }));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.attempts[0].assertions[0].passed, true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-drift-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-drift",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions({ not: "an array" })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "schema_drift");
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "recent_form_array", passed: false }]);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/fetch-edgar-filings.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-build-edgar-filing-timeline\.mjs/);
  assert.match(workflow, /node scripts\/test-build-edgar-lkg-recovery\.mjs/);
  assert.match(workflow, /detection-attempts\/edgar_filings\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /git add -A/);
}

// --- Bounded persistence (P): merged timelines are capped per ticker --------
{
  const dayMs = 24 * 60 * 60 * 1000;
  const dateAt = (index) => new Date(Date.UTC(2025, 0, 1) + index * dayMs).toISOString().slice(0, 10);
  const filing = (index, extra = {}) => ({
    accession: `acc-${index}`,
    filingDate: dateAt(index),
    form: "8-K",
    summaryPath: null,
    translationPath: null,
    ...extra,
  });

  // cap enforcement + eviction order: 105 distinct dates -> newest 100 retained,
  // oldest filingDate evicted first.
  const existingManifest = {
    filings: Array.from({ length: 105 }, (_, index) => filing(index)),
  };
  const discovered = [filing(105), filing(106)];
  const merged = mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest,
    discoveredRows: discovered,
    updated: "2026-07-18",
  });
  assert.equal(merged.filings.length, 100, "merged timeline is bounded at the cap");
  const retainedDates = new Set(merged.filings.map((row) => row.filingDate));
  assert.equal(retainedDates.size, 100);
  assert.equal(retainedDates.has(dateAt(0)), false, "oldest filingDate is evicted first");
  assert.equal(retainedDates.has(dateAt(6)), false);
  assert.equal(retainedDates.has(dateAt(7)), true, "newest 100 distinct dates are retained");
  assert.equal(retainedDates.has(dateAt(106)), true);
  assert.equal(merged.filings[0].filingDate, dateAt(106), "descending order preserved");
  assert.equal(merged.persistence_policy.max_distinct_filing_dates_per_ticker, 100);
  assert.equal(merged.persistence_state.distinct_filing_dates, 107);
  assert.equal(merged.persistence_state.filings_before, 107);
  assert.equal(merged.persistence_state.filings_retained, 100);
  assert.equal(merged.persistence_state.pruned_this_merge, 7);
  assert.equal(merged.persistence_state.total_pruned_filings, 7);

  // sparse-ticker non-eviction: a ticker below the cap is never pruned.
  const sparse = mergeFilings({
    ticker: "AAPL",
    companyName: "APPLE INC",
    cik: "0000320193",
    existingManifest: { filings: [filing(1), filing(2), filing(3)] },
    discoveredRows: [],
    updated: "2026-07-18",
  });
  assert.equal(sparse.filings.length, 3, "sparse tickers are never evicted");
  assert.equal(sparse.persistence_state.pruned_this_merge, 0);

  // idempotency: merging the capped result with no new discoveries is a no-op.
  const again = mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest: merged,
    discoveredRows: [],
    updated: "2026-07-19",
  });
  assert.deepEqual(
    again.filings.map((row) => row.accession),
    merged.filings.map((row) => row.accession),
    "re-running the cap is idempotent",
  );
  assert.equal(again.persistence_state.pruned_this_merge, 0);
  assert.equal(again.persistence_state.total_pruned_filings, 7, "cumulative prune count is stable under idempotent re-runs");

  // malformed dates fail closed.
  assert.throws(() => mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest: { filings: [{ accession: "bad-1", filingDate: "not-a-date" }] },
    discoveredRows: [],
    updated: "2026-07-18",
  }), /invalid EDGAR persistence filingDate/, "a malformed filingDate must fail closed");
  assert.throws(() => mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest: null,
    discoveredRows: [filing(1, { filingDate: "2026-13-40" })],
    updated: "2026-07-18",
  }), /invalid EDGAR persistence filingDate/);

  // retainLatestFilingDates rejects a non-positive cap outright.
  assert.throws(() => retainLatestFilingDates([], { max_distinct_filing_dates_per_ticker: 0 }), /invalid EDGAR persistence/);
}

console.log("test-build-edgar-filing-timeline: ok");
