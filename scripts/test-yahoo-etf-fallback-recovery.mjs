#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";
import {
  YAHOO_ETF_FALLBACK_LANE_ID,
  decodeYahooEtfTickerKey,
  encodeYahooEtfTickerKey,
  listYahooEtfFallbackRetryTargets,
  promoteYahooEtfFallbackCandidate,
  recordYahooEtfFallbackControlledFailure,
  recordYahooEtfFallbackFailure,
} from "./yahoo-etf-fallback-recovery.mjs";

const TICKER = "TQQQ";
const FAILURE_RUN = Object.freeze({
  runId: "row4-chaos",
  runAttempt: 1,
  eventName: "workflow_dispatch",
  observedAt: "2026-07-28T01:00:00Z",
});
const RECOVERY_RUN = Object.freeze({
  runId: "row4-natural",
  runAttempt: 1,
  eventName: "schedule",
  observedAt: "2026-07-29T01:00:00Z",
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeBytes(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
}

function jsonBytes(document) {
  return Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
}

function providerPayload(ticker, sourceAsOf, value = 100) {
  const seconds = Math.floor(Date.parse(sourceAsOf) / 1000);
  return {
    schema_version: "yf-finance/v2",
    ticker,
    fetched_at: "2026-07-29T01:00:10Z",
    profile: "etf",
    data: {
      info: {
        symbol: ticker,
        quoteType: "ETF",
        regularMarketTime: seconds,
        currentPrice: value,
      },
      history_1y: [
        { date: sourceAsOf.slice(0, 10), close: value },
      ],
    },
    source: "yahoo_finance",
    source_context: "stockanalysis_etf_fallback",
    source_as_of: sourceAsOf,
    source_as_of_reason: null,
  };
}

function candidatePayload(ticker, sourceAsOf, value = 100) {
  const provider = providerPayload(ticker, sourceAsOf, value);
  return {
    schema_version: "yf-etf-detail/v1",
    source: "yahoo_finance",
    source_provider: "yahoo_finance",
    detail_status: "yf_fallback",
    asset_type: "etf",
    ticker,
    source_as_of: sourceAsOf,
    source_as_of_reason: null,
    fetched_at: provider.fetched_at,
    normalized: {
      quote: { p: value, u: sourceAsOf, ex: "yahoo_finance" },
      history: provider.data.history_1y,
      history_periods: { daily_1y: provider.data.history_1y },
    },
    raw: { yf: provider.data },
  };
}

function paths(root, ticker = TICKER) {
  const key = encodeYahooEtfTickerKey(ticker);
  return {
    key,
    canonical: path.join(root, "data", "yf", "etf-details", `${ticker}.json`),
    provider: path.join(root, "data", "yf", "finance", `${ticker}.json`),
    publicProvider: path.join(root, "100xfenok-next", "public", "data", "yf", "finance", `${ticker}.json`),
    index: path.join(root, "data", "admin", YAHOO_ETF_FALLBACK_LANE_ID, "index.json"),
    lkg: path.join(root, "data", "admin", YAHOO_ETF_FALLBACK_LANE_ID, "lkg", `${key}.json`),
  };
}

function seedCanonical(root, sourceAsOf = "2026-07-27T15:15:05Z", value = 90) {
  const target = paths(root).canonical;
  const bytes = jsonBytes(candidatePayload(TICKER, sourceAsOf, value));
  writeBytes(target, bytes);
  return bytes;
}

function makeFailedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yahoo-etf-fallback-recovery-"));
  const before = seedCanonical(root);
  const result = recordYahooEtfFallbackControlledFailure({
    repoRoot: root,
    ticker: TICKER,
    run: FAILURE_RUN,
  });
  return { root, before, result };
}

assert.equal(encodeYahooEtfTickerKey("BRK.B"), "ticker_42524b2e42");
assert.equal(decodeYahooEtfTickerKey("ticker_42524b2e42"), "BRK.B");
assert.equal(decodeYahooEtfTickerKey(encodeYahooEtfTickerKey("ABC-1")), "ABC-1");
for (const invalid of ["", "../TQQQ", "TQQQ/../../x", "tqqq", "A".repeat(13)]) {
  assert.throws(() => encodeYahooEtfTickerKey(invalid), /ticker/i);
}
for (const invalid of ["tqqq", "ticker_", "ticker_0", "ticker_zz", "ticker_2e2e2f"]) {
  assert.throws(() => decodeYahooEtfTickerKey(invalid), /key|ticker/i);
}

{
  const { root, before, result } = makeFailedRoot();
  try {
    const target = paths(root);
    assert.equal(result.kind, "failure");
    assert.equal(result.reason, "controlled_failure");
    assert.equal(result.hasCompleteLkg, true);
    assert.equal(result.degraded, true);
    assert.equal(result.corrupt, false);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.retrySet, [target.key]);
    assert.deepEqual(fs.readFileSync(target.canonical), before, "controlled failure must not rewrite canonical bytes");
    assert.deepEqual(fs.readFileSync(target.lkg), before, "LKG must be byte-identical to canonical");
    const state = JSON.parse(fs.readFileSync(target.index, "utf8"));
    assert.equal(state.schema_version, "data-supply-lkg-state/v1");
    assert.equal(state.lane_id, YAHOO_ETF_FALLBACK_LANE_ID);
    assert.equal(state.items[target.key].lkg.payload_sha256, sha256(before));
    assert.equal(state.items[target.key].latest_failure.run_id, FAILURE_RUN.runId);
    assert.equal(state.items[target.key].latest_failure.reason, "controlled_failure");
    assert.deepEqual(listYahooEtfFallbackRetryTargets({ repoRoot: root }), [TICKER]);
    const cli = spawnSync(
      process.execPath,
      [new URL("./yahoo-etf-fallback-recovery.mjs", import.meta.url).pathname],
      {
        input: JSON.stringify({ action: "retry_targets", repo_root: root }),
        encoding: "utf8",
      },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(JSON.parse(cli.stdout), { retry_targets: [TICKER] });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yahoo-etf-no-canonical-"));
  try {
    assert.throws(
      () => recordYahooEtfFallbackControlledFailure({
        repoRoot: root,
        ticker: TICKER,
        run: FAILURE_RUN,
      }),
      /complete retained LKG/i,
    );
    assert.equal(fs.existsSync(paths(root).index), false);
    assert.equal(fs.existsSync(paths(root).lkg), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yahoo-etf-schedule-chaos-"));
  try {
    seedCanonical(root);
    assert.throws(
      () => recordYahooEtfFallbackControlledFailure({
        repoRoot: root,
        ticker: TICKER,
        run: RECOVERY_RUN,
      }),
      /workflow_dispatch/,
    );
    assert.throws(
      () => recordYahooEtfFallbackFailure({
        repoRoot: root,
        ticker: TICKER,
        run: RECOVERY_RUN,
        reason: "controlled_failure",
        requireCompleteLkg: true,
      }),
      /workflow_dispatch/,
      "the lower-level failure API must not bypass the controlled dispatch gate",
    );
    assert.equal(fs.existsSync(paths(root).index), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, before } = makeFailedRoot();
  try {
    const target = paths(root);
    const provider = providerPayload(TICKER, "2026-07-28T15:15:05Z", 101);
    provider.source_as_of = "2026-07-29T15:15:05Z";
    assert.throws(
      () => promoteYahooEtfFallbackCandidate({
        repoRoot: root,
        ticker: TICKER,
        candidateBytes: jsonBytes(candidatePayload(TICKER, "2026-07-28T15:15:05Z", 101)),
        providerBytes: jsonBytes(provider),
        run: RECOVERY_RUN,
      }),
      /provider observation is invalid/,
      "a claimed provider source_as_of must be derived from the provider payload",
    );
    assert.deepEqual(fs.readFileSync(target.canonical), before);
    assert.equal(fs.existsSync(target.provider), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, before } = makeFailedRoot();
  try {
    const target = paths(root);
    const candidateBytes = jsonBytes(candidatePayload(TICKER, "2026-07-28T15:15:05Z", 101));
    const providerBytes = jsonBytes(providerPayload(TICKER, "2026-07-28T15:15:05Z", 101));
    const result = promoteYahooEtfFallbackCandidate({
      repoRoot: root,
      ticker: TICKER,
      candidateBytes,
      providerBytes,
      run: RECOVERY_RUN,
      mirrorPublic: true,
    });
    assert.equal(result.kind, "success");
    assert.equal(result.updated, true);
    assert.equal(result.recovered, true);
    assert.deepEqual(fs.readFileSync(target.canonical), candidateBytes);
    assert.deepEqual(fs.readFileSync(target.provider), providerBytes);
    assert.deepEqual(fs.readFileSync(target.publicProvider), providerBytes);
    assert.deepEqual(fs.readFileSync(target.lkg), before, "recovery retains the prior exact LKG");
    const state = JSON.parse(fs.readFileSync(target.index, "utf8"));
    const item = state.items[target.key];
    assert.deepEqual(state.retry_set, []);
    assert.equal(item.retry, false);
    assert.equal(item.resolution_state, "fresh_primary");
    assert.equal(item.current.payload_sha256, sha256(candidateBytes));
    assert.equal(item.current.source_as_of, "2026-07-28T15:15:05Z");
    assert.equal(item.lkg.payload_sha256, sha256(before));
    assert.equal(item.recovered_from_run_id, FAILURE_RUN.runId);
    assert.equal(item.recovery_run_id, RECOVERY_RUN.runId);
    assert.equal(item.recovery_run_attempt, 1);
    assert.equal(item.recovery_event_name, "schedule");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const [label, run] of [
  ["dispatch", { ...RECOVERY_RUN, runId: "manual", eventName: "workflow_dispatch" }],
  ["attempt 2", { ...RECOVERY_RUN, runId: "rerun", runAttempt: 2 }],
]) {
  const { root, before } = makeFailedRoot();
  try {
    const target = paths(root);
    const indexBefore = fs.readFileSync(target.index);
    const candidateBytes = jsonBytes(candidatePayload(TICKER, "2026-07-28T15:15:05Z", 101));
    const providerBytes = jsonBytes(providerPayload(TICKER, "2026-07-28T15:15:05Z", 101));
    const result = promoteYahooEtfFallbackCandidate({
      repoRoot: root,
      ticker: TICKER,
      candidateBytes,
      providerBytes,
      run,
    });
    assert.equal(result.kind, "deferred", label);
    assert.equal(result.reason, "recovery_requires_schedule", label);
    assert.deepEqual(fs.readFileSync(target.canonical), before, label);
    assert.deepEqual(fs.readFileSync(target.index), indexBefore, label);
    assert.equal(fs.existsSync(target.provider), false, label);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, before } = makeFailedRoot();
  try {
    const target = paths(root);
    const sourceAsOf = "2026-07-27T15:15:05Z";
    const result = promoteYahooEtfFallbackCandidate({
      repoRoot: root,
      ticker: TICKER,
      candidateBytes: jsonBytes(candidatePayload(TICKER, sourceAsOf, 91)),
      providerBytes: jsonBytes(providerPayload(TICKER, sourceAsOf, 91)),
      run: RECOVERY_RUN,
    });
    assert.equal(result.kind, "deferred");
    assert.equal(result.reason, "recovery_not_advanced_by_provider");
    assert.deepEqual(fs.readFileSync(target.canonical), before);
    assert.equal(fs.existsSync(target.provider), false);
    const state = JSON.parse(fs.readFileSync(target.index, "utf8"));
    assert.equal(state.items[target.key].latest_promotion_deferral.reason, "recovery_not_advanced_by_provider");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, before } = makeFailedRoot();
  try {
    const target = paths(root);
    const sourceAsOf = "2026-07-28T15:15:05Z";
    const result = promoteYahooEtfFallbackCandidate({
      repoRoot: root,
      ticker: TICKER,
      candidateBytes: jsonBytes(candidatePayload(TICKER, sourceAsOf, 101)),
      providerBytes: jsonBytes(providerPayload(TICKER, sourceAsOf, 999)),
      run: RECOVERY_RUN,
    });
    assert.equal(result.kind, "deferred");
    assert.equal(result.reason, "foreign_writer_conflict");
    assert.deepEqual(fs.readFileSync(target.canonical), before);
    assert.equal(fs.existsSync(target.provider), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

{
  const { root, before } = makeFailedRoot();
  try {
    const target = paths(root);
    const indexBefore = fs.readFileSync(target.index);
    const providerBefore = Buffer.from("prior private provider bytes\n");
    const publicProviderBefore = Buffer.from("prior public provider bytes\n");
    writeBytes(target.provider, providerBefore);
    writeBytes(target.publicProvider, publicProviderBefore);
    const candidateBytes = jsonBytes(candidatePayload(TICKER, "2026-07-28T15:15:05Z", 101));
    const providerBytes = jsonBytes(providerPayload(TICKER, "2026-07-28T15:15:05Z", 101));
    const actualStore = new LaneLkgStore({ repoRoot: root, laneId: YAHOO_ETF_FALLBACK_LANE_ID });
    const throwingStore = Object.create(actualStore);
    throwingStore.recordSuccess = () => {
      fs.writeFileSync(target.index, "torn state\n");
      throw new Error("injected state write failure");
    };
    assert.throws(
      () => promoteYahooEtfFallbackCandidate({
        repoRoot: root,
        ticker: TICKER,
        candidateBytes,
        providerBytes,
        run: RECOVERY_RUN,
        mirrorPublic: true,
        store: throwingStore,
      }),
      /rolled back|state write failure/i,
    );
    assert.deepEqual(fs.readFileSync(target.canonical), before);
    assert.deepEqual(fs.readFileSync(target.index), indexBefore);
    assert.deepEqual(fs.readFileSync(target.lkg), before);
    assert.deepEqual(fs.readFileSync(target.provider), providerBefore);
    assert.deepEqual(fs.readFileSync(target.publicProvider), publicProviderBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("PASS yahoo ETF fallback recovery adapter");
