#!/usr/bin/env node

import https from "node:https";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const TICKERS = Object.freeze(["TQQQ", "SOXL"]);
const WORKER_BASE = "https://ticker-api.etloveaui.workers.dev/api/ticker";

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

function quoteFromPayload(symbol, payload) {
  const price = toFiniteNumber(payload?.price);
  if (price === null || price <= 0) return null;
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
    regularMarketTime: toFiniteNumber(payload.regularMarketTime),
    currency: payload.currency ?? null,
    exchangeName: payload.exchangeName ?? null,
  };
}

function classifyResponse(response, symbol) {
  const classified = classifyEndpointResponse(response, { laneId: "yahoo_ticker_macro" });
  const quote = quoteFromPayload(symbol, classified.document);
  return {
    tuple: classified.attempt,
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
  request = requestBytes,
  sleep = sleepMs,
  maxRetries = 2,
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-yahoo`,
} = {}) {
  const results = [];
  const tickers = {};
  const errors = [];
  for (const symbol of TICKERS) {
    const current = await evaluateTicker({ symbol, request, sleep, maxRetries });
    results.push(current);
    if (current.quote) {
      const { symbol: _symbol, ...quote } = current.quote;
      tickers[symbol] = quote;
      console.log(`${symbol}: price=${quote.price} change=${quote.change.toFixed(4)} (${quote.changePercent.toFixed(2)}%)`);
    } else {
      errors.push({ symbol, message: current.message ?? tupleStatus(current.tuple) });
      console.error(`${symbol}: ERROR — ${errors.at(-1).message}`);
    }
    await sleep(500);
  }

  const tuple = foldWorstTuples(results.map((result) => result.tuple));
  const row = buildAttemptRow({ laneId: "yahoo_ticker_macro", memberId: null, observedAt, attemptId, tuple });
  const shard = buildSingleLaneShard({ laneId: "yahoo_ticker_macro", row });
  writeJsonAtomic(attemptShardPath, shard);

  const ok = Object.keys(tickers).length > 0;
  if (ok) {
    const output = {
      updated: observedAt,
      source: "ticker-api-worker (yahoo-finance origin)",
      endpoint: WORKER_BASE,
      tickers,
      ...(errors.length > 0 ? { errors } : {}),
    };
    writeJsonAtomic(canonicalPath, output);
    writeJsonAtomic(publicPath, output);
  }
  return { ok, updated: ok, reason: tupleStatus(tuple), row, shard, errors };
}

async function main() {
  const result = await runYahooTicker();
  console.log(JSON.stringify({ ok: result.ok, reason: result.reason, attempt: result.row }));
  if (!result.ok) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
