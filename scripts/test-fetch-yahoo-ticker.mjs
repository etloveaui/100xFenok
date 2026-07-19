#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  publishYahooOutputPairAtomic,
  runYahooTicker,
  validateYahooControlledFailureTickers,
} from "./fetch-yahoo-ticker.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBSERVED_AT = "2026-07-14T05:00:00Z";
const ATTEMPT_ID = "gh-300-1-yahoo";

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function fileBytes(filePath) {
  return fs.readFileSync(filePath);
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

function quotePayloadBytes(symbol, price, regularMarketTime) {
  return Buffer.from(`${JSON.stringify(quote(symbol, price, regularMarketTime), null, 2)}\n`);
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
  assert.equal(state.promotion_contract, "provider_observation/v2");
  assert.equal(state.provider_observation.run_id, "302");
  assert.equal(state.provider_observation.run_attempt, 1);
  assert.equal(state.provider_observation.event_name, "schedule");
  assert.equal(state.provider_observation.source_as_of, new Date(1784002000 * 1000).toISOString());
  assert.equal(state.last_recovered_failure.run_id, "300");
  const published = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
  const publishedQuote = quotePayloadBytes("TQQQ", 52, 1784002000);
  assert.equal(state.current.payload_sha256, crypto.createHash("sha256").update(publishedQuote).digest("hex"));
  assert.equal(published.tickers.TQQQ.regularMarketTime, 1784002000);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-fatal-atomic-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const beforeCanonical = fileBytes(paths.canonicalPath);
  const beforePublic = fileBytes(paths.publicPath);
  const statePath = path.join(paths.stateRoot, "keys", "TQQQ.json");
  const lkgPath = path.join(paths.stateRoot, "lkg", "TQQQ.json");
  const beforeState = fileBytes(statePath);
  const beforeLkg = fileBytes(lkgPath);
  const fatal = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => symbol === "TQQQ"
      ? response(200, quote(symbol, 51, 1784001000))
      : response(401, { error: "unauthorized" }),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:10:00Z", attemptId: "gh-303-1-yahoo", eventName: "schedule",
  });
  assert.equal(fatal.exitCode, 2);
  assert.deepEqual(fileBytes(paths.canonicalPath), beforeCanonical, "fatal sibling leaves canonical byte-identical");
  assert.deepEqual(fileBytes(paths.publicPath), beforePublic, "fatal sibling leaves public byte-identical");
  assert.deepEqual(fileBytes(statePath), beforeState, "unpublished successful-key state cannot advance");
  assert.deepEqual(fileBytes(lkgPath), beforeLkg, "unpublished successful-key LKG cannot advance");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-publish-rollback-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const beforeCanonical = fileBytes(paths.canonicalPath);
  const beforePublic = fileBytes(paths.publicPath);
  const statePath = path.join(paths.stateRoot, "keys", "TQQQ.json");
  const lkgPath = path.join(paths.stateRoot, "lkg", "TQQQ.json");
  const beforeState = fileBytes(statePath);
  const beforeLkg = fileBytes(lkgPath);
  let replacements = 0;
  const failedPublish = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:20:00Z", attemptId: "gh-304-1-yahoo", eventName: "schedule",
    publishOutputPair: (args) => publishYahooOutputPairAtomic({
      ...args,
      replaceFile(source, target) {
        replacements += 1;
        if (replacements === 2) throw new Error("injected public publish failure");
        fs.renameSync(source, target);
      },
    }),
  });
  assert.equal(failedPublish.exitCode, 2);
  assert.match(failedPublish.reasons.join("; "), /publish/i);
  assert.deepEqual(fileBytes(paths.canonicalPath), beforeCanonical);
  assert.deepEqual(fileBytes(paths.publicPath), beforePublic);
  assert.deepEqual(fileBytes(statePath), beforeState);
  assert.deepEqual(fileBytes(lkgPath), beforeLkg);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-post-publish-tamper-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const guardedPaths = [
    paths.canonicalPath,
    paths.publicPath,
    path.join(paths.stateRoot, "index.json"),
    ...["TQQQ.json", "SOXL.json"].flatMap((key) => [path.join(paths.stateRoot, "keys", key), path.join(paths.stateRoot, "lkg", key)]),
  ];
  const before = new Map(guardedPaths.map((filePath) => [filePath, fileBytes(filePath)]));
  const tampered = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:22:00Z", attemptId: "gh-3042-1-yahoo", eventName: "schedule",
    publishOutputPair(args) {
      publishYahooOutputPairAtomic(args);
      const output = JSON.parse(fs.readFileSync(args.canonicalPath, "utf8"));
      output.tickers.TQQQ.price = 999;
      fs.writeFileSync(args.canonicalPath, `${JSON.stringify(output, null, 2)}\n`);
    },
  });
  assert.equal(tampered.exitCode, 2);
  assert.match(tampered.reasons.join("; "), /diverged from the accepted publication/);
  for (const filePath of guardedPaths) assert.deepEqual(fileBytes(filePath), before.get(filePath));
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-post-commit-pair-tamper-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const guardedPaths = [
    paths.canonicalPath,
    paths.publicPath,
    path.join(paths.stateRoot, "index.json"),
    ...["TQQQ.json", "SOXL.json"].flatMap((key) => [path.join(paths.stateRoot, "keys", key), path.join(paths.stateRoot, "lkg", key)]),
  ];
  const before = new Map(guardedPaths.map((filePath) => [filePath, fileBytes(filePath)]));
  let mutated = false;
  const tampered = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:23:00Z", attemptId: "gh-3043-1-yahoo", eventName: "schedule",
    commitPlannedCandidate(store, candidate) {
      const committed = store.commitCandidate(candidate);
      if (!mutated) {
        mutated = true;
        const output = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
        output.updated = "2099-01-01T00:00:00Z";
        const bytes = `${JSON.stringify(output, null, 2)}\n`;
        fs.writeFileSync(paths.canonicalPath, bytes);
        fs.writeFileSync(paths.publicPath, bytes);
      }
      return committed;
    },
  });
  assert.equal(tampered.exitCode, 2);
  assert.match(tampered.reasons.join("; "), /diverged from the accepted publication/);
  for (const filePath of guardedPaths) assert.deepEqual(fileBytes(filePath), before.get(filePath));
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-post-commit-anchor-tamper-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const guardedPaths = [
    paths.canonicalPath,
    paths.publicPath,
    path.join(paths.stateRoot, "index.json"),
    ...["TQQQ.json", "SOXL.json"].flatMap((key) => [
      path.join(paths.stateRoot, "keys", key),
      path.join(paths.stateRoot, "lkg", key),
      path.join(paths.stateRoot, "promotion-contracts", key),
    ]),
  ];
  const before = new Map(guardedPaths.map((filePath) => [filePath, fileBytes(filePath)]));
  let mutated = false;
  const tampered = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:24:00Z", attemptId: "gh-3044-1-yahoo", eventName: "schedule",
    commitPlannedCandidate(store, candidate) {
      const committed = store.commitCandidate(candidate);
      if (!mutated) {
        mutated = true;
        fs.writeFileSync(store.promotionAnchorPath(candidate.key), "{", "utf8");
      }
      return committed;
    },
  });
  assert.equal(tampered.exitCode, 2);
  assert.equal(tampered.updated, false);
  assert.match(tampered.reasons.join("; "), /committed TQQQ\.json proof state is invalid/);
  for (const filePath of guardedPaths) {
    assert.deepEqual(fileBytes(filePath), before.get(filePath), `${filePath} anchor rollback must be byte-identical`);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-post-commit-lkg-tamper-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const guardedPaths = [
    paths.canonicalPath,
    paths.publicPath,
    path.join(paths.stateRoot, "index.json"),
    ...["TQQQ.json", "SOXL.json"].flatMap((key) => [
      path.join(paths.stateRoot, "keys", key),
      path.join(paths.stateRoot, "lkg", key),
      path.join(paths.stateRoot, "promotion-contracts", key),
    ]),
  ];
  const before = new Map(guardedPaths.map((filePath) => [filePath, fileBytes(filePath)]));
  let mutated = false;
  const tampered = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:24:30Z", attemptId: "gh-3045-1-yahoo", eventName: "schedule",
    commitPlannedCandidate(store, candidate) {
      const committed = store.commitCandidate(candidate);
      if (!mutated) {
        mutated = true;
        fs.writeFileSync(store.lkgPath(candidate.key), "{}\n", "utf8");
      }
      return committed;
    },
  });
  assert.equal(tampered.exitCode, 2);
  assert.equal(tampered.updated, false);
  assert.match(tampered.reasons.join("; "), /committed TQQQ\.json LKG is invalid/);
  for (const filePath of guardedPaths) {
    assert.deepEqual(fileBytes(filePath), before.get(filePath), `${filePath} LKG rollback must be byte-identical`);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-state-rollback-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  const guardedPaths = [
    paths.canonicalPath,
    paths.publicPath,
    path.join(paths.stateRoot, "index.json"),
    ...["TQQQ.json", "SOXL.json"].flatMap((key) => [
      path.join(paths.stateRoot, "keys", key),
      path.join(paths.stateRoot, "lkg", key),
    ]),
  ];
  const before = new Map(guardedPaths.map((filePath) => [filePath, fileBytes(filePath)]));
  let commits = 0;
  const failedCommit = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:25:00Z", attemptId: "gh-3041-1-yahoo", eventName: "schedule",
    commitPlannedCandidate(store, candidate) {
      commits += 1;
      if (commits === 2) throw new Error("injected state commit failure");
      return store.commitCandidate(candidate);
    },
  });
  assert.equal(failedCommit.exitCode, 2);
  assert.match(failedCommit.reasons.join("; "), /transaction failed and was rolled back/);
  for (const filePath of guardedPaths) {
    assert.deepEqual(fileBytes(filePath), before.get(filePath), `${filePath} must roll back byte-identically`);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-mixed-rollback-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:30:00Z", attemptId: "gh-307-1-yahoo",
    eventName: "workflow_dispatch", controlledFailureTickers: ["TQQQ"],
  });
  const guardedPaths = [
    paths.canonicalPath,
    paths.publicPath,
    path.join(paths.stateRoot, "index.json"),
    ...["TQQQ.json", "SOXL.json"].flatMap((key) => [
      path.join(paths.stateRoot, "keys", key),
      path.join(paths.stateRoot, "lkg", key),
    ]),
  ];
  const before = new Map(guardedPaths.map((filePath) => [filePath, fileBytes(filePath)]));
  const failedMixed = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 52 : 42, 1784002000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:40:00Z", attemptId: "gh-308-1-yahoo",
    eventName: "workflow_dispatch",
    commitPlannedCandidate() { throw new Error("injected mixed state commit failure"); },
  });
  assert.equal(failedMixed.exitCode, 2);
  for (const filePath of guardedPaths) {
    assert.deepEqual(fileBytes(filePath), before.get(filePath), `${filePath} mixed rollback must be byte-identical`);
  }
  const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  const index = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "index.json"), "utf8"));
  assert.equal(state.latest_failure.run_id, "307");
  assert.equal(state.latest_promotion_deferral, undefined);
  assert.equal(index.current_attempt.run_id, "307", "state and index roll back to the same durable attempt");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-foreign-writer-"));
  const paths = pathsFor(root);
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000000)),
    sleep: async () => {}, maxRetries: 0, observedAt: OBSERVED_AT, attemptId: ATTEMPT_ID, eventName: "workflow_dispatch",
  });
  await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784001000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T05:30:00Z", attemptId: "gh-305-1-yahoo",
    eventName: "workflow_dispatch", controlledFailureTickers: ["TQQQ"],
  });
  const foreign = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
  const { symbol: _symbol, ...foreignTqqq } = quote("TQQQ", 99, 1784003000);
  foreign.tickers.TQQQ = foreignTqqq;
  fs.writeFileSync(paths.canonicalPath, `${JSON.stringify(foreign, null, 2)}\n`);
  fs.writeFileSync(paths.publicPath, `${JSON.stringify(foreign, null, 2)}\n`);
  const beforeCanonical = fileBytes(paths.canonicalPath);
  const beforePublic = fileBytes(paths.publicPath);
  const soxlStatePath = path.join(paths.stateRoot, "keys", "SOXL.json");
  const beforeSoxlState = fileBytes(soxlStatePath);

  const conflict = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 52 : 42, 1784002000)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-14T06:00:00Z", attemptId: "gh-306-1-yahoo", eventName: "schedule",
  });
  assert.equal(conflict.exitCode, 0);
  assert.equal(conflict.updated, false);
  assert.match(conflict.reasons.join("; "), /foreign_writer_conflict/);
  assert.deepEqual(fileBytes(paths.canonicalPath), beforeCanonical, "foreign canonical is never overwritten");
  assert.deepEqual(fileBytes(paths.publicPath), beforePublic);
  assert.deepEqual(fileBytes(soxlStatePath), beforeSoxlState, "unpublished sibling candidate state remains unchanged");
  const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  assert.equal(state.resolution_state, "lkg_primary");
  assert.equal(state.latest_failure.run_id, "305");
  assert.equal(state.latest_promotion_deferral.run_id, "306");
  assert.equal(state.latest_promotion_deferral.reason, "foreign_writer_conflict");
  const index = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "index.json"), "utf8"));
  assert.deepEqual(index.current_attempt.promotion_deferral_keys, ["TQQQ.json"]);
  assert.deepEqual({
    attempted: index.current_attempt.attempted,
    successes: index.current_attempt.successes,
    failed: index.current_attempt.failed,
    promotion_deferrals: index.current_attempt.promotion_deferrals,
  }, { attempted: 1, successes: 0, failed: 0, promotion_deferrals: 1 },
  "foreign-writer conflict leaves the unpublished sibling outside the current-attempt denominator");
}

{
  // Live 07-16 deadlock repro: committed pre-contract v1 states carrying 07-15 recovery
  // lineage (recovered_from_run_id without recovery_observation) made every hourly run
  // fetch fine, fail verifyCommittedYahooStates, roll back, and exit 2 — forever.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-yahoo-legacy-lineage-"));
  const paths = pathsFor(root);
  const seedTime = 1783990000;
  seedOutput(paths, seedTime);
  fs.mkdirSync(path.join(paths.stateRoot, "keys"), { recursive: true });
  fs.mkdirSync(path.join(paths.stateRoot, "lkg"), { recursive: true });
  for (const [symbol, price] of [["TQQQ", 49], ["SOXL", 39]]) {
    const retainedBytes = quotePayloadBytes(symbol, price, seedTime);
    const sha = crypto.createHash("sha256").update(retainedBytes).digest("hex");
    const sourceAsOf = new Date(seedTime * 1000).toISOString();
    fs.writeFileSync(path.join(paths.stateRoot, "lkg", `${symbol}.json`), retainedBytes);
    fs.writeFileSync(path.join(paths.stateRoot, "keys", `${symbol}.json`), `${JSON.stringify({
      schema_version: "producer-lkg-key-state/v1",
      lane_id: "yahoo_hourly_ticker",
      key: `${symbol}.json`,
      updated_at: "2026-07-16T11:51:09.839Z",
      resolution_state: "fresh_primary",
      retry: false,
      current: { path: `data/macro/yahoo-ticker.json#/tickers/${symbol}`, payload_sha256: sha, source_as_of: sourceAsOf },
      canonical_ref: `data/macro/yahoo-ticker.json#/tickers/${symbol}`,
      lkg: { path: `data/admin/yahoo-hourly-ticker/lkg/${symbol}.json`, payload_sha256: sha, source_as_of: sourceAsOf },
      latest_failure: null,
      recovered_from_run_id: "29417720099",
      recovery_run_id: "29421917838",
      recovery_run_attempt: 1,
      recovery_event_name: "schedule",
      recovered_at: "2026-07-15T14:04:52.506Z",
      last_run_id: "29495869517",
      last_run_attempt: 1,
    }, null, 2)}\n`);
  }
  const healed = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 50 : 40, 1784000001)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-16T12:00:00Z", attemptId: "gh-400-1-yahoo", eventName: "schedule",
  });
  assert.equal(healed.exitCode, 0, `legacy-lineage states must publish, not roll back: ${healed.reasons.join("; ")}`);
  assert.equal(healed.updated, true);
  assert.deepEqual(healed.degradedKeys, []);
  const state = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  assert.equal(state.schema_version, "producer-lkg-key-state/v2");
  assert.equal(state.recovery_provenance_contract, "legacy_source_marker/v1");
  assert.equal(state.recovered_from_run_id, "29417720099", "the v1-era lineage survives the contract upgrade");
  assert.equal(state.recovery_observation, undefined);
  const index = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "index.json"), "utf8"));
  assert.equal(index.schema_version, "producer-lkg-index/v2", "healing also rewrites the index onto the v2 contract");
  const published = JSON.parse(fs.readFileSync(paths.canonicalPath, "utf8"));
  assert.equal(published.tickers.TQQQ.regularMarketTime, 1784000001);

  const nextHour = await runYahooTicker({
    ...paths,
    request: async (_url, symbol) => response(200, quote(symbol, symbol === "TQQQ" ? 51 : 41, 1784003601)),
    sleep: async () => {}, maxRetries: 0, observedAt: "2026-07-16T13:00:00Z", attemptId: "gh-401-1-yahoo", eventName: "schedule",
  });
  assert.equal(nextHour.exitCode, 0, "the declared lineage stays committable on the following hourly run");
  assert.equal(nextHour.updated, true);
  const nextState = JSON.parse(fs.readFileSync(path.join(paths.stateRoot, "keys", "TQQQ.json"), "utf8"));
  assert.equal(nextState.recovery_provenance_contract, "legacy_source_marker/v1");
  assert.equal(nextState.recovered_from_run_id, "29417720099");
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
  assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflow, /--stage always_if_exists/);
  assert.match(workflow, /--stage success_if_exists/);
  assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
  assert.doesNotMatch(workflow, /git add (?:-A|--all)/);
}


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-yahoo-ticker.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-yahoo-ticker.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes, ["yahoo_ticker_macro"], "the registry must attribute this lane to fetch-yahoo-ticker.yml");
}

console.log("test-fetch-yahoo-ticker: ok");
