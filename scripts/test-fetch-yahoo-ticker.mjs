#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  runYahooTicker,
  validateYahooControlledFailureTickers,
} from "./fetch-yahoo-ticker.mjs";

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
    stateRoot: path.join(root, "data", "admin", "yahoo-hourly-ticker"),
  };
}

function quote(symbol, price, regularMarketTime = 1784000000) {
  return {
    symbol,
    price,
    previousClose: price - 1,
    change: 1,
    changePercent: 1,
    marketState: "REGULAR",
    regularMarketTime,
    currency: "USD",
    exchangeName: "NMS",
  };
}

function seedOutput(paths, sourceTime = 1783990000) {
  const output = {
    updated: "2026-07-14T04:00:00Z",
    source: "ticker-api-worker (yahoo-finance origin)",
    endpoint: "https://ticker-api.etloveaui.workers.dev/api/ticker",
    tickers: {
      TQQQ: (({ symbol: _symbol, ...row }) => row)(quote("TQQQ", 49, sourceTime)),
      SOXL: (({ symbol: _symbol, ...row }) => row)(quote("SOXL", 39, sourceTime)),
    },
  };
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  fs.writeFileSync(paths.canonicalPath, `${JSON.stringify(output, null, 2)}\n`);
  fs.writeFileSync(paths.publicPath, `${JSON.stringify(output, null, 2)}\n`);
  return output;
}

async function runCase(request, { seed = false, ...options } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-test-"));
  const paths = pathsFor(root);
  if (seed) seedOutput(paths);
  const result = await runYahooTicker({
    ...paths,
    request,
    sleep: async () => {},
    maxRetries: 0,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    eventName: "workflow_dispatch",
    ...options,
  });
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "yahoo_ticker_macro"), true);
  assert.equal(shard.attempts[0].member_id, null);
  return { result, shard, paths };
}

assert.deepEqual(validateYahooControlledFailureTickers("TQQQ", "workflow_dispatch"), ["TQQQ"]);
assert.throws(() => validateYahooControlledFailureTickers("TQQQ", "schedule"), /workflow_dispatch/);
assert.throws(() => validateYahooControlledFailureTickers("AAPL", "workflow_dispatch"), /unknown/);

{
  const { result, shard, paths } = await runCase(async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40)));
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.reason, "ready", "the measured flat Worker payload satisfies its endpoint contract");
  assert.equal(shard.attempts[0].assertions[0].id, "chart_result_array");
  assert.equal(shard.attempts[0].assertions[0].passed, true);
  const output = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
  assert.deepEqual(Object.keys(output.tickers), ["TQQQ", "SOXL"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.publicPath, "utf8")), output);
}

for (const missingField of ["symbol", "price", "regularMarketTime"]) {
  const { result, shard } = await runCase(async (_url, symbol) => {
    const payload = quote(symbol, symbol === "TQQQ" ? 50 : 40);
    if (symbol === "TQQQ") delete payload[missingField];
    return response(200, payload);
  });
  assert.equal(result.exitCode, 2, `missing ${missingField} must be corrupt without LKG`);
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "chart_result_array", passed: false }]);
}

for (const mutate of [
  (payload) => { payload.symbol = "WRONG"; },
  (payload) => { payload.price = 0; },
  (payload) => { payload.regularMarketTime = 0; },
]) {
  const { result, shard } = await runCase(async (_url, symbol) => {
    const payload = quote(symbol, symbol === "TQQQ" ? 50 : 40);
    if (symbol === "TQQQ") mutate(payload);
    return response(200, payload);
  });
  assert.equal(result.exitCode, 2, "semantically invalid Worker payload must be corrupt without LKG");
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "chart_result_array", passed: false }]);
}

{
  const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
  const { result, shard, paths } = await runCase(async (_url, symbol) => {
    if (symbol === "TQQQ") throw error;
    return response(200, quote(symbol, 40, 1784000001));
  }, { seed: true });
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0, "transport failure with an exact retained LKG is degraded, not corrupt");
  assert.deepEqual(result.degradedKeys, ["TQQQ"]);
  assert.equal(shard.attempts[0].execution, "threw");
  const output = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
  assert.deepEqual(Object.keys(output.tickers), ["TQQQ", "SOXL"]);
  assert.equal(output.tickers.TQQQ.price, 49, "the failed key keeps its previous quote");
  const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  assert.equal(state.resolution_state, "lkg_primary");
  assert.equal(state.retry, true);
  assert.equal(state.latest_failure.run_id, "300");
  const index = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "index.json"), "utf8"));
  assert.deepEqual(index.keys, ["TQQQ.json", "SOXL.json"]);
  assert.deepEqual(index.retry_keys, ["TQQQ.json"]);
  assert.deepEqual(index.current_attempt.failed_keys, ["TQQQ.json"]);
}

{
  const { result } = await runCase(async (_url, symbol) => response(200, symbol === "TQQQ"
    ? { ...quote(symbol, 50), regularMarketTime: null }
    : quote(symbol, 40)));
  assert.equal(result.exitCode, 2, "a quote without an honest source time is corrupt, not a fresh LKG candidate");
}

{
  const error = Object.assign(new Error("reset"), { code: "ECONNRESET" });
  const { result, shard, paths } = await runCase(async () => { throw error; });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(shard.attempts[0].execution, "threw");
  assert.equal(shard.attempts[0].exception_kind, "transport");
  assert.equal(fs.existsSync(paths.canonicalPath), false);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-recovery-"));
  const paths = pathsFor(root);
  seedOutput(paths, 1783990000);
  const failure = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000001)),
    sleep: async () => {},
    maxRetries: 0,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    eventName: "workflow_dispatch",
    controlledFailureTickers: ["TQQQ"],
  });
  assert.equal(failure.exitCode, 0);
  assert.deepEqual(failure.degradedKeys, ["TQQQ"]);

  const manualGreen = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {},
    maxRetries: 0,
    observedAt: "2026-07-14T05:30:00Z",
    attemptId: "gh-301-1-yahoo",
    eventName: "workflow_dispatch",
  });
  assert.equal(manualGreen.exitCode, 0);
  assert.deepEqual(manualGreen.degradedKeys, ["TQQQ"], "manual green dispatch retains LKG and cannot promote recovery");
  const retained = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  assert.equal(retained.resolution_state, "lkg_primary");
  assert.equal(retained.latest_failure.run_id, "300");

  const recovered = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 52 : 42, 1784002000)),
    sleep: async () => {},
    maxRetries: 0,
    observedAt: "2026-07-14T06:00:00Z",
    attemptId: "gh-302-1-yahoo",
    eventName: "schedule",
  });
  assert.equal(recovered.exitCode, 0);
  const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  assert.equal(state.resolution_state, "fresh_primary");
  assert.equal(state.retry, false);
  assert.equal(state.recovered_from_run_id, "300");
  assert.equal(state.recovery_event_name, "schedule");
  assert.equal(state.recovery_run_attempt, 1);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-yahoo-ticker.yml"), "utf8");
  assert.match(workflow, /node scripts\/fetch-yahoo-ticker\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /detection-attempts\/yahoo_ticker_macro\.json/);
  assert.match(workflow, /controlled_failure_tickers/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_TICKERS/);
  assert.match(workflow, /data\/admin\/yahoo-hourly-ticker/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /git add (?:-A|--all)/);
}

console.log("test-fetch-yahoo-ticker: ok");
