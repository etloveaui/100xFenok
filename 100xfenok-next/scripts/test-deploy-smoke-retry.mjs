#!/usr/bin/env node

import assert from "node:assert/strict";
import { DEPLOY_SMOKE_ATTEMPTS } from "./deploy-smoke-retry.mjs";

import {
  checkIframeTarget,
  fetchAssetStatus,
  fetchRouteHtml,
  firstIframeSrc,
} from "./check-route-iframe-contract.mjs";
import {
  buildProducerEvidence,
  fetchProducerJson,
} from "./smoke-stockanalysis-routes.mjs";

function response(status, body = "", url = "https://example.test/probe") {
  return {
    status,
    ok: status >= 200 && status < 300,
    url,
    headers: { get: () => null },
    text: async () => body,
  };
}

function responseWithLength(status, body, contentLength) {
  const result = response(status, body);
  result.headers = { get: (name) => name.toLowerCase() === "content-length" ? String(contentLength) : null };
  return result;
}

function sequenceFetch(steps) {
  const calls = [];
  const fetchImpl = async (...args) => {
    calls.push(args);
    const step = steps.shift();
    if (step instanceof Error) throw step;
    return step;
  };
  return { calls, fetchImpl };
}

const noSleep = async () => {};

console.log("# deploy smoke bounded-retry fixtures");
assert.equal(DEPLOY_SMOKE_ATTEMPTS, 3, "production deploy-smoke retry bound must stay exactly 3 attempts");

{
  const mock = sequenceFetch([
    response(503),
    response(200),
  ]);
  const status = await fetchAssetStatus(
    new URL("https://example.test"),
    "/alpha-scout/index.html?embed=1",
    "",
    {
      attempts: 3,
      delayMs: 0,
      fetchImpl: mock.fetchImpl,
      sleep: noSleep,
      timeoutMs: 50,
    },
  );
  assert.equal(status, 200);
  assert.equal(mock.calls.length, 2, "iframe asset HEAD must retry an HTTP 503");
  console.log("  ok - iframe asset HEAD retries 503 then passes");
}

{
  const mock = sequenceFetch([
    response(503),
    new TypeError("transient fetch failure"),
    response(200, '<iframe src="/alpha-scout/index.html?embed=1"></iframe>'),
  ]);
  const result = await fetchRouteHtml(new URL("https://example.test"), "/alpha-scout", "", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: mock.fetchImpl,
    sleep: noSleep,
    timeoutMs: 50,
  });
  assert.equal(result.status, 200);
  assert.equal(mock.calls.length, 3, "iframe route must retry retryable transport/5xx failures within the bound");
  console.log("  ok - iframe route retries 503/fetch-error then passes on attempt 3");
}

{
  const mock = sequenceFetch([
    response(200, '<iframe src="/wrong.html?embed=1"></iframe>'),
  ]);
  const result = await fetchRouteHtml(new URL("https://example.test"), "/alpha-scout", "", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: mock.fetchImpl,
    sleep: noSleep,
    timeoutMs: 50,
  });
  const iframeSrc = firstIframeSrc(result.text);
  assert.deepEqual(
    checkIframeTarget(new URL("https://example.test"), "/alpha-scout", "/alpha-scout/index.html", iframeSrc),
    ["/alpha-scout: iframe path mismatch: actual=/wrong.html expected=/alpha-scout/index.html"],
  );
  assert.equal(mock.calls.length, 1, "wrong iframe src is a contract failure and must not trigger a refetch");
  console.log("  ok - wrong iframe src hard-fails without retry");
}

{
  const mock = sequenceFetch([response(403, "forbidden")]);
  const result = await fetchRouteHtml(new URL("https://example.test"), "/admin", "", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: mock.fetchImpl,
    sleep: noSleep,
    timeoutMs: 50,
  });
  assert.equal(result.status, 403);
  assert.equal(mock.calls.length, 1, "HTTP 403 must not retry");
  console.log("  ok - iframe HTTP 403 remains one-shot");
}

{
  const redirectLoop = new TypeError("fetch failed", { cause: new Error("redirect count exceeded") });
  const mock = sequenceFetch([redirectLoop]);
  await assert.rejects(
    fetchRouteHtml(new URL("https://example.test"), "/admin", "", {
      attempts: 3,
      delayMs: 0,
      fetchImpl: mock.fetchImpl,
      sleep: noSleep,
      timeoutMs: 50,
    }),
    /fetch failed/,
  );
  assert.equal(mock.calls.length, 1, "redirect loops are protocol defects and must not retry");
  console.log("  ok - iframe redirect loop remains one-shot");
}

{
  const mock = sequenceFetch([
    new TypeError("producer fetch failed"),
    response(503),
    response(200, JSON.stringify({ source_date: "2026-07-18" })),
  ]);
  const payload = await fetchProducerJson("https://example.test/data/producer.json", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: mock.fetchImpl,
    sleep: noSleep,
    timeoutMs: 50,
  });
  assert.equal(payload.source_date, "2026-07-18");
  assert.equal(mock.calls.length, 3, "producer read must retry fetch-error/5xx within the bound");
  console.log("  ok - producer read retries fetch-error/503 then passes on attempt 3");
}

{
  const mock = sequenceFetch([
    responseWithLength(200, "{}", 50),
    response(200, JSON.stringify({ source_date: "2026-07-18" })),
  ]);
  const payload = await fetchProducerJson("https://example.test/data/producer.json", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: mock.fetchImpl,
    sleep: noSleep,
    timeoutMs: 50,
  });
  assert.equal(payload.source_date, "2026-07-18");
  assert.equal(mock.calls.length, 2, "truncated producer bodies remain retryable transport failures");
  console.log("  ok - truncated producer body retries then passes");
}

{
  const mock = sequenceFetch([response(403, "forbidden")]);
  await assert.rejects(
    fetchProducerJson("https://example.test/data/producer.json", {
      attempts: 3,
      delayMs: 0,
      fetchImpl: mock.fetchImpl,
      sleep: noSleep,
      timeoutMs: 50,
    }),
    /returned HTTP 403/,
  );
  assert.equal(mock.calls.length, 1, "producer HTTP 403 must not retry");
  console.log("  ok - producer HTTP 403 remains one-shot");
}

{
  const mock = sequenceFetch([response(429, "rate limited")]);
  await assert.rejects(
    fetchProducerJson("https://example.test/data/producer.json", {
      attempts: 3,
      delayMs: 0,
      fetchImpl: mock.fetchImpl,
      sleep: noSleep,
      timeoutMs: 50,
    }),
    /returned HTTP 429/,
  );
  assert.equal(mock.calls.length, 1, "producer HTTP 429 is outside this deploy-smoke retry contract");
  console.log("  ok - producer HTTP 429 remains one-shot");
}

{
  const mock = sequenceFetch([response(500), response(503), response(502)]);
  await assert.rejects(
    fetchProducerJson("https://example.test/data/producer.json", {
      attempts: 3,
      delayMs: 0,
      fetchImpl: mock.fetchImpl,
      sleep: noSleep,
      timeoutMs: 50,
    }),
    /returned HTTP 502/,
  );
  assert.equal(mock.calls.length, 3, "persistent producer 5xx must stop after exactly 3 attempts");
  console.log("  ok - persistent producer 5xx stops at the 3-attempt bound");
}

{
  const mock = sequenceFetch([
    response(200, JSON.stringify({ source_date: "2099-01-01" })),
  ]);
  const stocksAnalyzer = await fetchProducerJson("https://example.test/data/stocks.json", {
    attempts: 3,
    delayMs: 0,
    fetchImpl: mock.fetchImpl,
    sleep: noSleep,
    timeoutMs: 50,
  });
  assert.throws(() => buildProducerEvidence({
    marketFacts: { core_surface_source_as_of: "2026-07-18" },
    rimInputs: {
      indices: {
        KOSPI: { observed: { price: { as_of: "2026-07-18" } } },
        SOX: { observed: { price: { as_of: "2026-07-18" } } },
      },
    },
    yardeni: { data: [{ date: "2026-07-18" }] },
    stocksAnalyzer,
  }), /cannot be in the future/);
  assert.equal(mock.calls.length, 1, "fabricated producer dates are contract failures and must not refetch");
  console.log("  ok - fabricated producer date hard-fails without retry");
}

console.log("deploy smoke retry fixtures: PASS");
