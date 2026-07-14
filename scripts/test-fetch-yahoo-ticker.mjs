#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { runYahooTicker } from "./fetch-yahoo-ticker.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBSERVED_AT = "2026-07-14T05:00:00Z";
const ATTEMPT_ID = "gh-300-1-yahoo";

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function pathsFor(root) {
  return {
    canonicalPath: path.join(root, "data", "macro", "yahoo-ticker.json"),
    publicPath: path.join(root, "public", "data", "macro", "yahoo-ticker.json"),
    attemptShardPath: path.join(root, "attempts", "yahoo_ticker_macro.json"),
  };
}

function quote(symbol, price) {
  return {
    symbol,
    price,
    previousClose: price - 1,
    change: 1,
    changePercent: 1,
    marketState: "REGULAR",
    regularMarketTime: 1784000000,
    currency: "USD",
    exchangeName: "NMS",
  };
}

async function runCase(request) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-test-"));
  const paths = pathsFor(root);
  const result = await runYahooTicker({
    ...paths,
    request,
    sleep: async () => {},
    maxRetries: 0,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
  });
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "yahoo_ticker_macro"), true);
  assert.equal(shard.attempts[0].member_id, null);
  return { result, shard, paths };
}

{
  const { result, shard, paths } = await runCase(async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40)));
  assert.equal(result.ok, true);
  assert.equal(result.reason, "drift", "the live worker shape does not satisfy the configured Yahoo chart endpoint");
  assert.equal(shard.attempts[0].assertions[0].id, "chart_result_array");
  assert.equal(shard.attempts[0].assertions[0].passed, false, "the flat worker response exposes the configured /chart/result mismatch");
  const output = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
  assert.deepEqual(Object.keys(output.tickers), ["TQQQ", "SOXL"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.publicPath, "utf8")), output);
}

{
  const { result, shard, paths } = await runCase(async (_url, symbol) => (
    symbol === "TQQQ" ? response(429, { error: "rate" }) : response(200, quote(symbol, 40))
  ));
  assert.equal(result.ok, true, "partial ticker publishing behavior is preserved");
  assert.equal(shard.attempts[0].http_status, 429, "the two requests fold worst-of");
  assert.equal(shard.attempts[0].assertions.length, 0);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8")).tickers), ["SOXL"]);
}

{
  const { shard } = await runCase(async (_url, symbol) => response(200, symbol === "TQQQ" ? { price: null } : quote(symbol, 40)));
  assert.equal(shard.attempts[0].assertions[0].passed, false);
}

{
  const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
  const { result, shard, paths } = await runCase(async () => { throw error; });
  assert.equal(result.ok, false);
  assert.equal(shard.attempts[0].execution, "threw");
  assert.equal(shard.attempts[0].exception_kind, "transport");
  assert.equal(fs.existsSync(paths.canonicalPath), false);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-yahoo-ticker.yml"), "utf8");
  assert.match(workflow, /node scripts\/fetch-yahoo-ticker\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /detection-attempts\/yahoo_ticker_macro\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-yahoo-ticker: ok");
