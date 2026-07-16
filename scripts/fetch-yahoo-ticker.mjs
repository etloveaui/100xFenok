#!/usr/bin/env node

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAttemptRow,
  buildSingleLaneShard,
  classifyEndpointResponse,
  foldWorstTuples,
  threwTuple,
  transportError,
  tupleStatus,
  writeJsonAtomic,
} from "./lib/data-supply-attempt-shard.mjs";
import { ProducerLkgStateStore, assessRecoveryExit } from "./lib/producer-lkg-state.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TICKERS = Object.freeze(["TQQQ", "SOXL"]);
const WORKER_BASE = "https://ticker-api.etloveaui.workers.dev/api/ticker";
const FATAL_FAILURE_KINDS = new Set(["auth", "rate_limited", "decode", "schema_drift", "unexpected"]);

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function requestBytes(url, _symbol, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { Accept: "application/json" } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Yahoo ticker request timed out"), { code: "ETIMEDOUT" })));
    request.on("error", reject);
  });
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function quoteFromPayload(symbol, payload, { requireSymbol = false } = {}) {
  if (requireSymbol && payload?.symbol !== symbol) return null;
  const price = toFiniteNumber(payload?.price);
  if (price === null || price <= 0) return null;
  const regularMarketTime = toFiniteNumber(payload.regularMarketTime);
  if (regularMarketTime === null || regularMarketTime <= 0) return null;
  const previousClose = toFiniteNumber(payload.previousClose) ?? price;
  const change = toFiniteNumber(payload.change) ?? (price - previousClose);
  const changePercent = toFiniteNumber(payload.changePercent) ?? (previousClose > 0 ? (change / previousClose) * 100 : 0);
  return {
    symbol,
    price,
    previousClose,
    change,
    changePercent,
    marketState: String(payload.marketState ?? "UNKNOWN"),
    regularMarketTime,
    currency: payload.currency ?? null,
    exchangeName: payload.exchangeName ?? null,
  };
}

function finiteJson(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteJson);
  if (value && typeof value === "object") return Object.values(value).every(finiteJson);
  return true;
}

function validQuote(key, payload) {
  return payload?.symbol === key.replace(/\.json$/u, "")
    && typeof payload?.price === "number"
    && Number.isFinite(payload.price)
    && payload.price > 0
    && typeof payload?.regularMarketTime === "number"
    && Number.isFinite(payload.regularMarketTime)
    && payload.regularMarketTime > 0
    && finiteJson(payload);
}

function quoteBytes(quote) {
  return Buffer.from(`${JSON.stringify(quote, null, 2)}\n`);
}

function readCanonical(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return payload?.tickers && typeof payload.tickers === "object" ? payload : null;
  } catch {
    return null;
  }
}

function priorQuoteBytes(prior, symbol) {
  const row = prior?.tickers?.[symbol];
  if (!row) return null;
  const quote = quoteFromPayload(symbol, row);
  return quote && validQuote(`${symbol}.json`, quote) ? quoteBytes(quote) : null;
}

function runContext(attemptId, eventName, observedAt) {
  const match = String(attemptId).match(/^gh-(\d+)-(\d+)-yahoo$/u);
  const runAttempt = Number(match?.[2] ?? process.env.GITHUB_RUN_ATTEMPT ?? 1);
  return {
    run_id: match?.[1] ?? String(attemptId),
    run_attempt: runAttempt,
    event_name: eventName,
    natural: eventName === "schedule" && runAttempt === 1,
    observed_at: observedAt,
  };
}

function stateStore(stateRoot) {
  return new ProducerLkgStateStore({
    root: stateRoot,
    laneId: "yahoo_hourly_ticker",
    publicRoot: "data/admin/yahoo-hourly-ticker",
    validatePayload: validQuote,
    progressMarker(_key, payload) {
      return new Date(payload.regularMarketTime * 1000).toISOString();
    },
  });
}

function failureKind(result) {
  const tuple = result.tuple;
  if (tuple?.execution === "threw") return tuple.exception_kind === "transport" ? "transport" : "unexpected";
  if ([401, 403].includes(tuple?.http_status)) return "auth";
  if (tuple?.http_status === 429) return "rate_limited";
  if (tuple?.decode === "error") return "decode";
  if (tuple?.http_status < 200 || tuple?.http_status >= 300) return "http";
  return "schema_drift";
}

function parseList(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function validateYahooControlledFailureTickers(value, eventName) {
  const tickers = [...new Set(parseList(value).map((item) => item.toUpperCase()))];
  if (tickers.length > 0 && eventName !== "workflow_dispatch") {
    throw new Error("controlled_failure_tickers is allowed only for workflow_dispatch");
  }
  for (const ticker of tickers) {
    if (!TICKERS.includes(ticker)) throw new Error(`unknown controlled failure ticker: ${ticker}`);
  }
  return tickers;
}

function classifyResponse(response, symbol) {
  const classified = classifyEndpointResponse(response, { laneId: "yahoo_ticker_macro" });
  const measuredQuote = quoteFromPayload(symbol, classified.document, { requireSymbol: true });
  const tuple = classified.status === "ready" && measuredQuote === null
    ? {
        ...classified.attempt,
        assertions: classified.attempt.assertions.map((assertion) => ({
          ...assertion,
          passed: assertion.passed && measuredQuote !== null,
        })),
      }
    : classified.attempt;
  const quote = classified.status === "ready" ? measuredQuote : null;
  return {
    tuple,
    quote,
    message: quote ? null : (classified.reason === "ok" ? `Worker payload for ${symbol} has no valid price` : classified.reason),
  };
}

async function evaluateTicker({ symbol, request, sleep, maxRetries }) {
  const url = `${WORKER_BASE}?symbol=${encodeURIComponent(symbol)}`;
  let finalResult = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(1000 * (2 ** (attempt - 1)));
    try {
      finalResult = classifyResponse(await request(url, symbol), symbol);
    } catch (error) {
      const kind = transportError(error) ? "transport" : "unexpected";
      finalResult = { tuple: threwTuple(kind), quote: null, message: error.message };
    }
    if (finalResult.quote !== null || tupleStatus(finalResult.tuple) === "ready") break;
  }
  return finalResult;
}

export async function runYahooTicker({
  canonicalPath = path.join(REPO_ROOT, "data", "macro", "yahoo-ticker.json"),
  publicPath = path.join(REPO_ROOT, "100xfenok-next", "public", "data", "macro", "yahoo-ticker.json"),
  attemptShardPath = path.join(REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "yahoo_ticker_macro.json"),
  stateRoot = path.join(REPO_ROOT, "data", "admin", "yahoo-hourly-ticker"),
  request = requestBytes,
  sleep = sleepMs,
  maxRetries = 2,
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-yahoo`,
  eventName = process.env.GITHUB_EVENT_NAME ?? null,
  controlledFailureTickers = [],
} = {}) {
  const results = [];
  const errors = [];
  const controlled = validateYahooControlledFailureTickers(controlledFailureTickers, eventName);
  for (const symbol of TICKERS) {
    const current = controlled.includes(symbol)
      ? { tuple: threwTuple("unexpected"), quote: null, message: "owner-approved workflow_dispatch chaos injection", controlled: true }
      : await evaluateTicker({ symbol, request, sleep, maxRetries });
    results.push(current);
    if (current.quote) {
      console.log(`${symbol}: price=${current.quote.price} change=${current.quote.change.toFixed(4)} (${current.quote.changePercent.toFixed(2)}%)`);
    } else {
      errors.push({ symbol, message: current.message ?? tupleStatus(current.tuple), failure_kind: current.controlled ? "controlled" : failureKind(current) });
      console.error(`${symbol}: ERROR — ${errors.at(-1).message}`);
    }
    await sleep(500);
  }

  const tuple = foldWorstTuples(results.map((result) => result.tuple));
  const row = buildAttemptRow({ laneId: "yahoo_ticker_macro", memberId: null, observedAt, attemptId, tuple });
  const shard = buildSingleLaneShard({ laneId: "yahoo_ticker_macro", row });
  writeJsonAtomic(attemptShardPath, shard);

  const store = stateStore(stateRoot);
  const prior = readCanonical(canonicalPath);
  const run = runContext(attemptId, eventName, observedAt);
  const degradedKeys = [];
  const failedKeys = [];
  const fatalKeys = [];
  const outputQuotes = {};
  for (let index = 0; index < TICKERS.length; index += 1) {
    const symbol = TICKERS[index];
    const key = `${symbol}.json`;
    const result = results[index];
    if (result.quote) {
      const candidate = store.recordCandidate({
        key,
        payloadBytes: quoteBytes(result.quote),
        canonicalRef: `data/macro/yahoo-ticker.json#/tickers/${symbol}`,
        run,
      });
      if (!candidate.accepted) {
        degradedKeys.push(key);
        if (!candidate.deferred) failedKeys.push(key);
      }
    } else {
      const kind = result.controlled ? "controlled" : failureKind(result);
      store.recordFailure({
        key,
        error: result.message ?? kind,
        failureKind: kind,
        fallbackBytes: priorQuoteBytes(prior, symbol),
        canonicalRef: `data/macro/yahoo-ticker.json#/tickers/${symbol}`,
        run,
      });
      degradedKeys.push(key);
      failedKeys.push(key);
      if (FATAL_FAILURE_KINDS.has(kind)) fatalKeys.push(key);
    }
    const retained = store.validRetainedLkg(key);
    if (retained.valid) {
      const { symbol: _symbol, ...quote } = retained.payload;
      outputQuotes[symbol] = quote;
    }
  }
  const index = store.buildIndex({ keys: TICKERS.map((symbol) => `${symbol}.json`), run });
  const assessment = assessRecoveryExit({ store, index, failedKeys, fatalKeys });
  const complete = TICKERS.every((symbol) => outputQuotes[symbol]);
  const exitCode = complete ? assessment.exit_code : 2;
  const ok = complete && exitCode === 0;
  if (ok) {
    const output = {
      updated: observedAt,
      source: "ticker-api-worker (yahoo-finance origin)",
      endpoint: WORKER_BASE,
      tickers: outputQuotes,
      ...(errors.length > 0 ? { errors } : {}),
    };
    writeJsonAtomic(canonicalPath, output);
    writeJsonAtomic(publicPath, output);
  }
  return {
    ok,
    updated: ok,
    exitCode,
    reason: tupleStatus(tuple),
    row,
    shard,
    errors,
    degradedKeys: degradedKeys.map((key) => key.replace(/\.json$/u, "")),
    reasons: assessment.reasons,
    index,
  };
}

async function main() {
  const eventName = process.env.GITHUB_EVENT_NAME ?? null;
  const controlledFailureTickers = validateYahooControlledFailureTickers(
    process.env.INPUT_CONTROLLED_FAILURE_TICKERS ?? "",
    eventName,
  );
  const result = await runYahooTicker({ eventName, controlledFailureTickers });
  console.log(JSON.stringify({ ok: result.ok, exit_code: result.exitCode, degraded_keys: result.degradedKeys, reason: result.reason, attempt: result.row }));
  process.exitCode = result.exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error);
  process.exitCode = 2;
});
