#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runEdgarFilingTimeline } from "./build-edgar-filing-timeline.mjs";
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
  assert.match(workflow, /detection-attempts\/edgar_filings\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /git add -A/);
}

console.log("test-build-edgar-filing-timeline: ok");
