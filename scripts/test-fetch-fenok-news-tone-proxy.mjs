#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  articleSeenAt,
  buildLegacyTocSnapshot,
  buildSnapshotDocument,
  cleanCompanyName,
  collectLegacyTocArticles,
  computeTone,
  cueCounts,
  decodeLegacyTocGzip,
  GDELT_HISTORY_PERSISTENCE_POLICY,
  main,
  matchLegacyTocTickers,
  MAX_GDELT_HISTORY_SOURCE_DATES,
  mergeHistory,
  observeAttempt,
  queryForTicker,
  runNewsTone,
  validToneSnapshot,
} from "./fetch-fenok-news-tone-proxy.mjs";
import { classifyAttempt } from "./build-data-supply-detection-floor.mjs";
import { attemptResult, returnedTuple, threwTuple } from "./lib/data-supply-attempt-shard.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANE_ID = "gdelt_news_tone";
const WORKFLOW_REL = ".github/workflows/fetch-fenok-news-tone.yml";
const REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];

assert.equal(cleanCompanyName("NVIDIA CORP Class A"), "NVIDIA A");
assert.equal(queryForTicker("NVDA", "NVIDIA CORP"), '"NVIDIA"');
assert.deepEqual(cueCounts("Analyst upgrades company after strong profit growth"), { positive: 3, negative: 0 });
assert.deepEqual(cueCounts("Company falls after weak warning and lawsuit"), { positive: 0, negative: 4 });
assert.equal(articleSeenAt("20260628T123456Z"), "2026-06-28T12:34:56.000Z");

{
  assert.deepEqual(
    matchLegacyTocTickers({
      title: "Reddit expands partnership with NVIDIA",
      url: "https://example.test/reddit-nvidia",
    }),
    ["RDDT", "NVDA"],
  );
  assert.deepEqual(
    matchLegacyTocTickers({
      title: "Redditch manufacturer acquires microntroladores supplier",
      url: "https://example.test/redditch-microntroladores",
    }),
    [],
    "word-boundary aliases must not create false Reddit or Micron matches",
  );
}

{
  const records = [
    {
      date: "2026-07-28T02:47:00.000Z",
      lang: "en",
      title: "NVIDIA launches strong new platform",
      url: "https://example.test/nvidia-launch",
    },
    {
      date: "2026-07-28T02:47:00.000Z",
      lang: "en",
      title: "NVIDIA launches strong new platform",
      url: "https://example.test/nvidia-launch",
    },
    {
      date: "2026-07-28T02:31:00.000Z",
      lang: "en",
      title: "NVIDIA expands partnership",
      url: "https://example.test/nvidia-partnership",
    },
  ];
  const articles = collectLegacyTocArticles(records, {
    expectedTickers: ["NVDA"],
    maxRecords: 1,
  });
  assert.equal(articles.NVDA.length, 1, "legacy TOC URLs are deduplicated and bounded per ticker");
  assert.equal(articles.NVDA[0].seendate, "2026-07-28T02:47:00.000Z");
  assert.throws(
    () => decodeLegacyTocGzip(zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024 + 1))),
    /larger than|output length|Cannot create/,
    "a compressed TOC payload cannot expand beyond the per-file decompression ceiling",
  );
}

{
  const companyNames = {
    DASH: "DoorDash",
    UNH: "UnitedHealth",
    PYPL: "PayPal",
    RDDT: "Reddit",
    COIN: "Coinbase",
    MU: "Micron",
    PLTR: "Palantir",
    NVDA: "NVIDIA",
  };
  const records = Object.entries(companyNames).map(([ticker, company], index) => ({
    date: `2026-07-28T0${Math.floor(index / 6)}:${String(10 + index).padStart(2, "0")}:00.000Z`,
    lang: "en",
    title: `${company} reports strong growth`,
    url: `https://example.test/${ticker.toLowerCase()}-growth`,
  }));
  const snapshot = buildLegacyTocSnapshot({
    records,
    expectedTickers: REFERENCE_TICKERS,
    companyNames,
    generatedAt: "2026-07-28T03:00:00.000Z",
  });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.coverage.complete, true);
  assert.deepEqual(snapshot.rows.map((row) => row.ticker), REFERENCE_TICKERS);
  assert(snapshot.rows.every((row) => row.source_families.includes("GDELT Web Legacy NGrams TOC")));
}

const positive = computeTone({
  ticker: "TEST",
  company: "Test Inc",
  payload: {
    fetched_at: "2026-06-28T00:00:00Z",
    articles: [
      { title: "Test beats expectations with strong growth", seendate: "20260627T123456Z" },
      { title: "Analysts upgrade Test after record profit", seendate: "20260628T123456Z" },
    ],
  },
});
assert(positive.direct_news_tone_proxy.score_0_100 > 50);
assert.equal(positive.direct_news_tone_proxy.article_count, 2);
assert.equal(positive.as_of, "2026-06-28T12:34:56.000Z");
assert.equal(positive.as_of_reason, null);

const empty = computeTone({
  ticker: "EMPTY",
  company: "Empty Inc",
  payload: { fetched_at: null, articles: [] },
});
assert.equal(empty.direct_news_tone_proxy.score_0_100, null);
assert.equal(empty.confidence, "very_low");
assert.equal(empty.as_of, null);
assert.match(empty.as_of_reason, /seendate/);

function rawResponse(statusCode, body) {
  return { statusCode, body: typeof body === "string" ? body : JSON.stringify(body) };
}

function toneSnapshot({ latestSourceAsOf, sourceFloor = "2026-07-20T12:00:00.000Z" }) {
  return {
    schema_version: 1,
    generated_at: "2026-07-24T14:43:00.000Z",
    // The producer keeps the aggregate floor for the public document. The LKG
    // marker must use the registry-aligned maximum row source date instead.
    source_as_of: sourceFloor,
    source_as_of_reason: null,
    status: "ready",
    formula_version: "fenok-news-tone-proxy-v0.1-gdelt-headlines",
    coverage: {
      expected_tickers: REFERENCE_TICKERS,
      expected_row_count: REFERENCE_TICKERS.length,
      observed_row_count: REFERENCE_TICKERS.length,
      row_count: REFERENCE_TICKERS.length,
      with_articles: REFERENCE_TICKERS.length,
      with_tone_score: REFERENCE_TICKERS.length,
      unavailable_row_count: 0,
      unavailable_tickers: [],
      missing_tickers: [],
      duplicate_tickers: [],
      unexpected_tickers: [],
      invalid_ticker_row_count: 0,
      complete: true,
      errors: [],
    },
    rows: REFERENCE_TICKERS.map((ticker) => ({
      ticker,
      as_of: ticker === "NVDA" ? latestSourceAsOf : sourceFloor,
      direct_news_tone_proxy: {
        score_0_100: ticker === "NVDA" ? 60 : 55,
        attention_score_0_100: ticker === "NVDA" ? 8 : 4,
        article_count: ticker === "NVDA" ? 2 : 1,
      },
    })),
  };
}

const readyProbe = () => ({
  result: attemptResult("ok", returnedTuple({
    httpStatus: 200,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "articles_array", passed: true }],
  })),
});
const rateLimitedProbe = () => ({
  result: attemptResult("rate_limited", returnedTuple({
    httpStatus: 429,
    rateLimited: true,
  })),
});
const rateLimitedAfterRetryProbe = () => ({
  result: attemptResult("rate_limited", returnedTuple({
    httpStatus: 429,
    rateLimited: true,
    retryReason: "rate_limited",
    retryCount: 2,
    retryWaitMs: 19500,
  })),
});
const transportProbe = () => ({ result: attemptResult("transport_error", threwTuple("transport")) });

async function runLkgCase(root, snapshot, {
  eventName = "workflow_dispatch",
  runAttempt = 1,
  runId = "gdelt-test-run",
  observedAt = "2026-07-24T14:43:00.000Z",
  probe = readyProbe,
} = {}) {
  return runNewsTone({
    repoRoot: root,
    args: { noWrite: false, maxRecords: 25, retries: 2, retryBackoffMs: 6500 },
    observedAt,
    runId,
    runAttempt,
    eventName,
    attemptId: `gdelt-${runId}-${runAttempt}`,
    observeAttemptFn: async () => probe(),
    buildFn: async () => snapshot,
  });
}

{
  const responses = [
    rawResponse(429, "rate limited"),
    rawResponse(200, { articles: [{ title: "DoorDash expands partnership" }] }),
  ];
  const sleeps = [];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => responses.shift(),
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(observed.result.status, "ready");
  assert.equal(observed.result.reason, "ok");
  assert.equal(observed.result.attempt.retry_reason, "rate_limited");
  assert.equal(observed.result.attempt.retry_count, 1);
  assert.equal(observed.result.attempt.retry_wait_ms, 6500);
  assert.deepEqual(sleeps, [6500]);
}

{
  const responses = [
    rawResponse(200, "Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com for larger queries."),
    rawResponse(200, { articles: [{ title: "DoorDash expands partnership" }] }),
  ];
  const sleeps = [];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => responses.shift(),
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(observed.result.status, "ready");
  assert.equal(observed.result.reason, "ok");
  assert.equal(observed.result.attempt.retry_reason, "rate_limited");
  assert.equal(observed.result.attempt.retry_count, 1);
  assert.deepEqual(sleeps, [6500],
    "HTTP 200 throttle advisory must use the bounded retry path rather than schema-drift handling");
}

{
  const responses = [
    rawResponse(200, "All high-traffic users should switch to our ngrams dataset."),
    rawResponse(200, "Please limit requests to one every 5 seconds."),
    rawResponse(200, "Please limit requests to one every 5 seconds."),
  ];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => responses.shift(),
    sleepFn: async () => {},
  });
  assert.equal(observed.result.reason, "rate_limited");
  assert.equal(observed.result.attempt.http_status, 200);
  assert.equal(observed.result.attempt.rate_limited, true);
  assert.equal(observed.result.attempt.decode, "error");
  assert.deepEqual(observed.result.attempt.assertions, [{ id: "articles_array", passed: false }]);
  assert.equal(observed.result.attempt.retry_count, 2);
}

{
  const responses = [
    rawResponse(429, "rate limited"),
    rawResponse(429, "rate limited"),
    rawResponse(429, "rate limited"),
  ];
  const sleeps = [];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => responses.shift(),
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(observed.result.status, "unavailable");
  assert.equal(observed.result.reason, "rate_limited");
  assert.equal(observed.result.attempt.http_status, 429);
  assert.deepEqual(observed.result.attempt.assertions, [{ id: "articles_array", passed: false }],
    "rate-limited attempt shards retain the GDELT endpoint-contract assertion id");
  assert.equal(observed.result.attempt.retry_count, 2);
  assert.equal(observed.result.attempt.retry_wait_ms, 19500);
  assert.deepEqual(sleeps, [6500, 13000]);
}

{
  const responses = [
    rawResponse(429, "rate limited"),
    rawResponse(503, "upstream unavailable"),
  ];
  const sleeps = [];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => responses.shift(),
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(observed.result.reason, "rate_limited", "a later 5xx cannot launder the initiating 429 storm");
  assert.equal(observed.result.attempt.http_status, 429);
  assert.equal(observed.result.attempt.retry_count, 1);
  assert.deepEqual(sleeps, [6500]);
  assert.equal(responses.length, 0, "non-429 after a retry ends the bounded probe");
}

{
  const responses = [
    rawResponse(429, "rate limited"),
    rawResponse(200, {}),
  ];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => responses.shift(),
    sleepFn: async () => {},
  });
  assert.equal(observed.result.reason, "schema_drift", "a retry must not launder malformed provider schema");
  assert.equal(observed.result.attempt.retry_reason, "rate_limited");
  assert.equal(observed.result.attempt.retry_count, 1);
}

for (const firstFailure of [
  rawResponse(503, "upstream unavailable"),
  rawResponse(403, "forbidden"),
]) {
  let calls = 0;
  const sleeps = [];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: false,
    rawGetFn: async () => {
      calls += 1;
      return firstFailure;
    },
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(calls, 1, `${firstFailure.statusCode} is not a rate-limit retry trigger`);
  assert.deepEqual(sleeps, []);
  assert.equal(Object.hasOwn(observed.result.attempt, "retry_count"), false);
}

{
  let calls = 0;
  const sleeps = [];
  const observed = await observeAttempt({
    maxRecords: 25,
    retries: 2,
    retryBackoffMs: 6500,
    controlledFailure: true,
    rawGetFn: async () => {
      calls += 1;
      throw new Error("must not run");
    },
    sleepFn: async (ms) => sleeps.push(ms),
  });
  assert.equal(observed.result.reason, "transport_error");
  assert.equal(calls, 0);
  assert.deepEqual(sleeps, []);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-fallback-"));
  const fallbackSnapshot = toneSnapshot({ latestSourceAsOf: "2026-07-28T02:47:00.000Z" });
  const calls = [];
  const outcome = await runNewsTone({
    repoRoot: root,
    args: { noWrite: true, noFetch: false, maxRecords: 25, retries: 0, retryBackoffMs: 1 },
    observedAt: "2026-07-28T03:00:00.000Z",
    runId: "gdelt-fallback-success",
    runAttempt: 1,
    eventName: "schedule",
    observeAttemptFn: async () => rateLimitedAfterRetryProbe(),
    fallbackFn: async () => {
      calls.push("fallback");
      return { snapshot: fallbackSnapshot };
    },
    buildFn: async () => {
      calls.push("doc-build");
      throw new Error("DOC builder must not run after fallback success");
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.reason, "ok");
  assert.equal(outcome.result.status, "ready");
  assert.equal(outcome.result.attempt.http_status, 200);
  assert.equal(outcome.result.attempt.retry_reason, "rate_limited",
    "the ready fallback shard must preserve the initiating DOC API rate limit");
  assert.equal(outcome.result.attempt.retry_count, 2);
  assert.equal(outcome.result.attempt.retry_wait_ms, 19500);
  assert.deepEqual(calls, ["fallback"]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-no-retry-fallback-"));
  let fallbackCalls = 0;
  const outcome = await runNewsTone({
    repoRoot: root,
    args: { noWrite: true, noFetch: false, maxRecords: 25, retries: 0, retryBackoffMs: 1 },
    observedAt: "2026-07-28T03:00:00.000Z",
    runId: "gdelt-no-retry-fallback",
    runAttempt: 1,
    eventName: "schedule",
    observeAttemptFn: async () => rateLimitedProbe(),
    fallbackFn: async () => {
      fallbackCalls += 1;
      return { snapshot: toneSnapshot({ latestSourceAsOf: "2026-07-28T02:47:00.000Z" }) };
    },
  });
  assert.equal(outcome.reason, "rate_limited");
  assert.equal(outcome.result.attempt.http_status, 429);
  assert.equal(outcome.result.attempt.rate_limited, true);
  assert.equal(fallbackCalls, 0,
    "a no-retry 429 cannot be overwritten by a fallback tuple with no primary-failure evidence");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-fallback-partial-"));
  const partialSnapshot = buildSnapshotDocument({
    generatedAt: "2026-07-28T03:00:00.000Z",
    expectedTickers: REFERENCE_TICKERS,
    rows: [toneSnapshot({ latestSourceAsOf: "2026-07-28T02:47:00.000Z" }).rows.at(-1)],
  });
  const outcome = await runNewsTone({
    repoRoot: root,
    args: { noWrite: true, noFetch: false, maxRecords: 25, retries: 0, retryBackoffMs: 1 },
    observedAt: "2026-07-28T03:00:00.000Z",
    runId: "gdelt-fallback-partial",
    runAttempt: 1,
    eventName: "schedule",
    observeAttemptFn: async () => rateLimitedAfterRetryProbe(),
    fallbackFn: async () => ({ snapshot: partialSnapshot }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, "rate_limited",
    "an incomplete TOC basket must preserve the initiating DOC API rate-limit failure");
  assert.equal(outcome.result.status, "unavailable");
}

// --- Bounded LKG / promotion / retention (Class-B) ---------------------------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-lkg-"));
  const baseline = toneSnapshot({ latestSourceAsOf: "2026-07-23T12:00:00.000Z" });
  const initial = await runLkgCase(root, baseline, { runId: "seed" });
  assert.equal(initial.ok, true);

  const canonicalPath = path.join(root, "data", "computed", "fenok_news_tone_proxy.json");
  const beforeFailure = fs.readFileSync(canonicalPath, "utf8");
  const failed = await runLkgCase(root, baseline, {
    runId: "rate-limited",
    observedAt: "2026-07-24T15:00:00.000Z",
    probe: rateLimitedProbe,
  });
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0, "shadow GDELT rate limiting remains graceful after retaining LKG");
  assert.deepEqual(failed.retrySet, ["news_tone_proxy"]);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), beforeFailure, "provider failure must retain yesterday's canonical tone");

  const failureShard = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "gdelt_news_tone.json"),
    "utf8",
  ));
  assert.deepEqual(failureShard.attempts[0].assertions, [{ id: "articles_array", passed: false }],
    "rate-limited LKG attempts preserve endpoint-contract assertion ids with a failed verdict");

  const statePath = path.join(root, "data", "admin", "gdelt_news_tone", "index.json");
  const lkgPath = path.join(root, "data", "admin", "gdelt_news_tone", "lkg", "news_tone_proxy.json");
  const retained = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(retained.items.news_tone_proxy.resolution_state, "lkg_primary");
  assert.equal(retained.items.news_tone_proxy.retry, true);
  assert.equal(retained.items.news_tone_proxy.lkg.source_as_of, "2026-07-23T12:00:00.000Z",
    "LKG marker follows max rows[].as_of, matching the registry selector rather than top-level source floor");
  assert.equal(fs.readFileSync(lkgPath, "utf8"), beforeFailure);

  const advanced = toneSnapshot({ latestSourceAsOf: "2026-07-24T12:00:00.000Z" });
  const manual = await runLkgCase(root, advanced, {
    runId: "manual-recovery",
    observedAt: "2026-07-24T16:00:00.000Z",
  });
  assert.equal(manual.reason, "recovery_requires_schedule");
  assert.equal(manual.degraded, true);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), beforeFailure, "dispatch must not promote a GDELT recovery");

  const scheduleRetry = await runLkgCase(root, advanced, {
    eventName: "schedule",
    runAttempt: 2,
    runId: "schedule-retry",
    observedAt: "2026-07-24T16:30:00.000Z",
  });
  assert.equal(scheduleRetry.reason, "recovery_requires_schedule");
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), beforeFailure, "scheduled retries are not natural recovery attempts");

  const recovered = await runLkgCase(root, advanced, {
    eventName: "schedule",
    runId: "natural-recovery",
    observedAt: "2026-07-24T17:00:00.000Z",
  });
  assert.equal(recovered.ok, true);
  const recoveredState = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.news_tone_proxy.recovered_from_run_id, "rate-limited");
  assert.equal(recoveredState.items.news_tone_proxy.recovery_event_name, "schedule");
  assert.equal(recoveredState.items.news_tone_proxy.provider_observation.source_as_of, "2026-07-24T12:00:00.000Z");

  const successShard = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "gdelt_news_tone.json"),
    "utf8",
  ));
  assert.deepEqual(successShard.attempts[0].assertions, [{ id: "articles_array", passed: true }],
    "LKG state changes must preserve endpoint-contract assertion ids in attempt shards");
}

{
  const sourceDates = Array.from({ length: MAX_GDELT_HISTORY_SOURCE_DATES + 1 }, (_, index) => {
    const date = new Date(Date.UTC(2025, 0, index + 1));
    return date.toISOString().slice(0, 10);
  });
  const retained = mergeHistory({
    schema_version: 1,
    generated_at: "2026-07-24T14:43:00.000Z",
    source_as_of: `${sourceDates.at(-1)}T12:00:00.000Z`,
    source_as_of_reason: null,
    status: "ready",
    formula_version: "fenok-news-tone-proxy-v0.1-gdelt-headlines",
    coverage: { row_count: 1, with_articles: 1, with_tone_score: 1, errors: [] },
    rows: [{
      ticker: "NVDA",
      as_of: `${sourceDates.at(-1)}T12:00:00.000Z`,
      direct_news_tone_proxy: { score_0_100: 60, attention_score_0_100: 8, article_count: 2 },
    }],
  }, {
    history: {
      schema_version: 1,
      formula_version: "fenok-news-tone-proxy-v0.1-gdelt-headlines",
      rows: sourceDates.slice(0, -1).map((sourceDate, index) => ({
        ticker: `OLD${String(index).padStart(3, "0")}`,
        as_of: `${sourceDate}T12:00:00.000Z`,
        source_date: sourceDate,
        generated_at: `${sourceDate}T12:00:00.000Z`,
        directNewsToneProxyScore: 50,
        newsAttentionScore: 1,
        articleCount: 1,
      })),
    },
  });
  assert.equal(MAX_GDELT_HISTORY_SOURCE_DATES, 100, "mirror the FINRA bounded source-date retention convention");
  assert.equal(GDELT_HISTORY_PERSISTENCE_POLICY.max_distinct_source_dates, 100);
  assert.equal(retained.rows.length, MAX_GDELT_HISTORY_SOURCE_DATES);
  assert.equal(retained.rows.some((row) => row.source_date === sourceDates[0]), false, "oldest provider source date is evicted first");
  assert(retained.rows.some((row) => row.ticker === "NVDA"), "newest GDELT snapshot rows must survive retention");
  assert.deepEqual(retained.persistence_state, {
    available_source_dates: MAX_GDELT_HISTORY_SOURCE_DATES + 1,
    retained_source_dates: MAX_GDELT_HISTORY_SOURCE_DATES,
    pruned_source_dates: 1,
    legacy_unbound_rows_dropped: 0,
  });
  const migrated = mergeHistory(toneSnapshot({ latestSourceAsOf: "2026-07-24T12:00:00.000Z" }), {
    history: {
      rows: [
        { ticker: "LEGACY_VALID", as_of: "2026-07-21T12:00:00.000Z" },
        { ticker: "LEGACY_UNBOUND", as_of: null },
      ],
    },
  });
  assert.equal(migrated.persistence_state.legacy_unbound_rows_dropped, 1,
    "the first policy rotation drops only provider-date-unbound legacy rows");
  assert.equal(migrated.rows.some((row) => row.ticker === "LEGACY_VALID"), true,
    "valid legacy rows remain available after the bounded-policy migration");
  assert.equal(migrated.rows.some((row) => row.ticker === "LEGACY_UNBOUND"), false);
  assert.throws(() => mergeHistory({
    schema_version: 1,
    generated_at: "2026-07-24T14:43:00.000Z",
    source_as_of: "2026-07-24T12:00:00.000Z",
    source_as_of_reason: null,
    status: "ready",
    formula_version: "fenok-news-tone-proxy-v0.1-gdelt-headlines",
    coverage: { row_count: 1, with_articles: 1, with_tone_score: 1, errors: [] },
    rows: [{
      ticker: "NVDA",
      as_of: "2026-07-24T12:00:00.000Z",
      direct_news_tone_proxy: { score_0_100: 60, attention_score_0_100: 8, article_count: 2 },
    }],
  }, {
    history: {
      persistence_policy: GDELT_HISTORY_PERSISTENCE_POLICY,
      rows: [{ ticker: "BROKEN", as_of: "2026-02-31T12:00:00.000Z", source_date: "2026-02-31" }],
    },
  }), /invalid provider source date/, "malformed persisted source dates fail closed");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-transport-"));
  const failed = await runLkgCase(root, toneSnapshot({ latestSourceAsOf: "2026-07-23T12:00:00.000Z" }), {
    runId: "controlled-transport",
    observedAt: "2026-07-24T19:00:00.000Z",
    probe: transportProbe,
  });
  assert.equal(failed.reason, "transport_error");
  assert.equal(failed.retained, false);
  assert.equal(failed.degraded, false);
  assert.equal(failed.corrupt, true);
  assert.equal(failed.exitCode, 2, "a failed run without a complete exact-basket LKG must fail closed");
  const shard = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "gdelt_news_tone.json"),
    "utf8",
  ));
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "articles_array", passed: false }],
    "controlled transport failures retain endpoint-contract assertion ids with failed verdicts");
}

{
  const errors = [];
  const exitCode = await main({
    argv: ["--reference-only"],
    runNewsToneFn: async () => ({
      ok: false,
      reason: "rate_limited",
      retrySet: ["news_tone_proxy"],
      exitCode: 2,
    }),
    error: (message) => errors.push(message),
  });
  assert.equal(exitCode, 2, "the CLI must propagate an unrecoverable producer exit code");
  assert.deepEqual(errors, [
    "[degraded] GDELT news tone rate_limited; retry set: news_tone_proxy",
  ]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-dateless-"));
  const baseline = toneSnapshot({ latestSourceAsOf: "2026-07-23T12:00:00.000Z" });
  await runLkgCase(root, baseline, { runId: "dateless-seed" });
  const canonicalPath = path.join(root, "data", "computed", "fenok_news_tone_proxy.json");
  const before = fs.readFileSync(canonicalPath, "utf8");
  const dateless = structuredClone(baseline);
  dateless.rows[1].as_of = null;
  const rejected = await runLkgCase(root, dateless, {
    runId: "dateless-provider",
    observedAt: "2026-07-24T18:00:00.000Z",
  });
  assert.equal(rejected.reason, "schema_drift");
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), before,
    "a ready-labelled snapshot with a missing provider seendate must never become recovery canonical");
  const state = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "gdelt_news_tone", "index.json"),
    "utf8",
  ));
  assert.equal(state.items.news_tone_proxy.resolution_state, "lkg_primary");
  assert.deepEqual(state.retry_set, ["news_tone_proxy"]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-legacy-lkg-"));
  const canonicalPath = path.join(root, "data", "computed", "fenok_news_tone_proxy.json");
  const legacy = toneSnapshot({ latestSourceAsOf: "2026-07-23T12:00:00.000Z" });
  legacy.status = "degraded";
  legacy.source_as_of = null;
  legacy.source_as_of_reason = "legacy aggregate floor unavailable";
  legacy.rows.push({
    ticker: "UNBOUND",
    as_of: null,
    direct_news_tone_proxy: { score_0_100: null, attention_score_0_100: null, article_count: 0 },
  });
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
  fs.writeFileSync(canonicalPath, `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
  const before = fs.readFileSync(canonicalPath, "utf8");
  const failed = await runLkgCase(root, legacy, {
    runId: "legacy-rate-limited",
    observedAt: "2026-07-24T20:00:00.000Z",
    probe: rateLimitedProbe,
  });
  assert.equal(failed.retained, false, "a partial legacy canonical is not a complete exact-basket LKG");
  assert.equal(failed.degraded, false);
  assert.equal(failed.corrupt, true);
  assert.equal(failed.exitCode, 2);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), before);
  const state = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "gdelt_news_tone", "index.json"),
    "utf8",
  ));
  assert.equal(state.items.news_tone_proxy.resolution_state, "unavailable");
  assert.equal(state.items.news_tone_proxy.retry, true);
  assert.equal(state.items.news_tone_proxy.lkg ?? null, null);
}

// --- Workflow contract (owned producer wiring, #366) ------------------------
{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  const producer = fs.readFileSync(path.join(REPO_ROOT, "scripts", "fetch-fenok-news-tone-proxy.mjs"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fenok-news-tone-proxy\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fenok-news-tone-proxy\.mjs/);
  assert.match(workflow, /controlled_failure/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE/);
  assert.match(workflow, /--reference-only --retries 2 --retry-backoff-ms 6500/);
  assert.match(workflow, new RegExp(`detection-attempts/${LANE_ID}\\.json`));
  assert.match(workflow, /data\/computed\/fenok_news_tone_proxy\.json/);
  assert.match(
    producer,
    /main\(\)[\s\S]*?\.then\(\(exitCode\) => \{[\s\S]*?process\.exitCode = exitCode;/,
    "the executable entrypoint must map main's returned status onto the process",
  );
  assert.match(workflow, /data\/computed\/fenok_news_tone_proxy_history\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflow, /--stage always_if_exists/);
  assert.match(workflow, /--stage success_if_exists/);
  assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
}

// --- Lane Registry ⇄ commit-shard completeness gate (#366 step 4) -----------
{
  const workflowText = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: WORKFLOW_REL,
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), [LANE_ID].sort(), "registry lane attribution for this workflow");
}

// --- Complete-reference readiness -------------------------------------------
// The live score is a fixed reference-basket comparison. A 3/8 partial basket
// remains useful diagnostic evidence, but it cannot be ready or replace the
// prior complete LKG.
const toneRow = (ticker, asOf, articleCount = 1) => ({
  ticker,
  as_of: asOf,
  company: ticker,
  confidence: asOf ? "low" : "very_low",
  direct_news_tone_proxy: {
    score_0_100: asOf ? 55 : null,
    attention_score_0_100: asOf ? 4 : null,
    article_count: articleCount,
  },
});

{
  const doc = buildSnapshotDocument({
    expectedTickers: REFERENCE_TICKERS,
    rows: REFERENCE_TICKERS.map((ticker, index) => (
      index < 3 ? toneRow(ticker, `2026-07-${String(25 - index).padStart(2, "0")}T02:00:00.000Z`) : toneRow(ticker, null, 0)
    )),
    errors: REFERENCE_TICKERS.slice(3).map((ticker) => ({ ticker, error: "GDELT 429" })),
    generatedAt: "2026-07-25T15:53:14.450Z",
  });
  assert.equal(doc.status, "degraded", "3/8 reference coverage must not be live-scoreable");
  assert.deepEqual(doc.rows.map((row) => row.ticker), REFERENCE_TICKERS.slice(0, 3));
  assert.equal(doc.source_as_of, "2026-07-23T02:00:00.000Z");
  assert.deepEqual(doc.coverage.expected_tickers, REFERENCE_TICKERS);
  assert.equal(doc.coverage.expected_row_count, 8);
  assert.equal(doc.coverage.observed_row_count, 8);
  assert.equal(doc.coverage.row_count, 3);
  assert.equal(doc.coverage.unavailable_row_count, 5, "unavailable references stay explicit");
  assert.deepEqual(doc.coverage.unavailable_tickers, REFERENCE_TICKERS.slice(3).sort());
  assert.deepEqual(doc.coverage.missing_tickers, []);
  assert.deepEqual(doc.coverage.duplicate_tickers, []);
  assert.equal(doc.coverage.complete, false);
  assert.match(doc.source_as_of_reason, /partial/i, "a partial floor must say so");
  assert.equal(validToneSnapshot(doc), false, "a partial document must never promote");
}

{
  // Nothing dated at all is a real acquisition failure: publish nothing.
  const doc = buildSnapshotDocument({
    expectedTickers: ["DASH", "PYPL"],
    rows: [toneRow("DASH", null, 0), toneRow("PYPL", null, 0)],
    errors: [{ ticker: "DASH", error: "GDELT 429" }, { ticker: "PYPL", error: "GDELT 429" }],
    generatedAt: "2026-07-25T15:53:14.450Z",
  });
  assert.equal(doc.status, "degraded");
  assert.deepEqual(doc.rows, []);
  assert.equal(doc.source_as_of, null);
  assert.equal(doc.coverage.expected_row_count, 2);
  assert.equal(doc.coverage.unavailable_row_count, 2);
  assert.equal(doc.coverage.complete, false);
  assert.equal(validToneSnapshot(doc), false, "an empty document must never promote");
}

{
  // Only the exact fixed reference set is live-promotable.
  const doc = buildSnapshotDocument({
    expectedTickers: REFERENCE_TICKERS,
    rows: REFERENCE_TICKERS.map((ticker, index) => (
      toneRow(ticker, `2026-07-${String(25 - index).padStart(2, "0")}T02:00:00.000Z`)
    )),
    errors: [],
    generatedAt: "2026-07-25T15:53:14.450Z",
  });
  assert.equal(doc.status, "ready");
  assert.deepEqual(doc.coverage.expected_tickers, REFERENCE_TICKERS);
  assert.equal(doc.coverage.expected_row_count, 8);
  assert.equal(doc.coverage.observed_row_count, 8);
  assert.equal(doc.coverage.row_count, 8);
  assert.equal(doc.coverage.unavailable_row_count, 0);
  assert.deepEqual(doc.coverage.missing_tickers, []);
  assert.deepEqual(doc.coverage.duplicate_tickers, []);
  assert.deepEqual(doc.coverage.unexpected_tickers, []);
  assert.equal(doc.coverage.complete, true);
  assert.equal(doc.source_as_of_reason, null);
  assert.equal(doc.source_as_of, "2026-07-18T02:00:00.000Z", "floor stays the oldest dated row");
  assert.equal(validToneSnapshot(doc), true);
}

{
  const omitted = buildSnapshotDocument({
    expectedTickers: REFERENCE_TICKERS,
    rows: REFERENCE_TICKERS.slice(0, -1).map((ticker) => toneRow(ticker, "2026-07-25T02:00:00.000Z")),
    errors: [],
    generatedAt: "2026-07-25T15:53:14.450Z",
  });
  assert.equal(omitted.status, "degraded");
  assert.equal(omitted.coverage.expected_row_count, 8);
  assert.equal(omitted.coverage.observed_row_count, 7);
  assert.deepEqual(omitted.coverage.missing_tickers, ["NVDA"]);
  assert.deepEqual(omitted.coverage.unavailable_tickers, ["NVDA"]);
  assert.equal(validToneSnapshot(omitted), false, "an omitted reference row must never promote");
}

{
  const duplicate = buildSnapshotDocument({
    expectedTickers: REFERENCE_TICKERS,
    rows: [
      ...REFERENCE_TICKERS.map((ticker) => toneRow(ticker, "2026-07-25T02:00:00.000Z")),
      toneRow("DASH", "2026-07-25T02:00:00.000Z"),
    ],
    errors: [],
    generatedAt: "2026-07-25T15:53:14.450Z",
  });
  assert.equal(duplicate.status, "degraded");
  assert.equal(duplicate.coverage.expected_row_count, 8);
  assert.equal(duplicate.coverage.observed_row_count, 9);
  assert.deepEqual(duplicate.coverage.missing_tickers, []);
  assert.deepEqual(duplicate.coverage.duplicate_tickers, ["DASH"]);
  assert.equal(validToneSnapshot(duplicate), false, "a duplicate reference row must never promote");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-reference-coverage-"));
  const complete = buildSnapshotDocument({
    expectedTickers: REFERENCE_TICKERS,
    rows: REFERENCE_TICKERS.map((ticker, index) => (
      toneRow(ticker, `2026-07-${String(18 + index).padStart(2, "0")}T02:00:00.000Z`)
    )),
    errors: [],
    generatedAt: "2026-07-25T15:53:14.450Z",
  });
  const seeded = await runLkgCase(root, complete, { runId: "complete-eight-seed" });
  assert.equal(seeded.ok, true, "8/8 reference coverage remains promotable");
  const shardPath = path.join(
    root, "data", "admin", "data-supply-state", "detection-attempts", "gdelt_news_tone.json",
  );
  const completeShard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
  assert.equal(classifyAttempt(completeShard.attempts[0]).status, "ready",
    "the detection floor keeps complete reference coverage ready");
  const canonicalPath = path.join(root, "data", "computed", "fenok_news_tone_proxy.json");
  const beforePartial = fs.readFileSync(canonicalPath, "utf8");

  const partial = buildSnapshotDocument({
    expectedTickers: REFERENCE_TICKERS,
    rows: REFERENCE_TICKERS.map((ticker, index) => (
      index < 3 ? toneRow(ticker, `2026-07-${String(26 - index).padStart(2, "0")}T02:00:00.000Z`) : toneRow(ticker, null, 0)
    )),
    errors: REFERENCE_TICKERS.slice(3).map((ticker) => ({ ticker, error: "GDELT 429" })),
    generatedAt: "2026-07-26T15:53:14.450Z",
  });
  const rejected = await runLkgCase(root, partial, {
    runId: "partial-three-of-eight",
    observedAt: "2026-07-26T15:53:14.450Z",
  });
  assert.equal(rejected.reason, "schema_drift");
  assert.equal(rejected.degraded, true);
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), beforePartial,
    "3/8 collection must retain the prior complete canonical");
  const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "articles_array", passed: false }],
    "the attempt floor must not report ready when reference coverage is partial");
  assert.equal(classifyAttempt(shard.attempts[0]).status, "drift",
    "the detection floor must reject partial reference coverage");
}

// --- Thrown-builder failures must carry the error identity out ---------------
// Run 30164248573 (2026-07-25, natural schedule) fetched successfully — the 429
// backoff worked, http 200, payload non_empty — and then burned 5m31s before
// printing exactly `[degraded] GDELT news tone unexpected_error`. The bare catch
// discarded the thrown error, so the failure was undiagnosable from CI alone.
// The `reason` enum stays stable for the LKG store; the identity travels beside
// it. Message text is truncated because provider payloads can reach the message.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-thrown-"));
  const outcome = await runNewsTone({
    repoRoot: root,
    args: { noWrite: true, maxRecords: 25, retries: 0, retryBackoffMs: 1 },
    observedAt: "2026-07-25T15:53:14.450Z",
    runId: "gdelt-thrown-run",
    runAttempt: 1,
    eventName: "schedule",
    attemptId: "gdelt-thrown-run-1",
    observeAttemptFn: async () => readyProbe(),
    buildFn: async () => {
      throw new TypeError("snapshot builder exploded");
    },
  });
  assert.equal(outcome.reason, "unexpected_error", "reason enum stays stable for the store");
  assert.match(outcome.failure_detail, /TypeError/, "error class must survive the catch");
  assert.match(outcome.failure_detail, /snapshot builder exploded/, "error message must survive the catch");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-longmsg-"));
  const outcome = await runNewsTone({
    repoRoot: root,
    args: { noWrite: true, maxRecords: 25, retries: 0, retryBackoffMs: 1 },
    observedAt: "2026-07-25T15:53:14.450Z",
    runId: "gdelt-longmsg-run",
    runAttempt: 1,
    eventName: "schedule",
    attemptId: "gdelt-longmsg-run-1",
    observeAttemptFn: async () => readyProbe(),
    buildFn: async () => {
      throw new Error("x".repeat(5000));
    },
  });
  assert.equal(outcome.reason, "unexpected_error");
  assert(outcome.failure_detail.length <= 320,
    `failure_detail must stay bounded, got ${outcome.failure_detail.length}`);
}

// A success carries no failure detail — the field must not become permanent noise.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-nodetail-"));
  const outcome = await runNewsTone({
    repoRoot: root,
    args: { noWrite: true, maxRecords: 25, retries: 0, retryBackoffMs: 1 },
    observedAt: "2026-07-25T15:53:14.450Z",
    runId: "gdelt-nodetail-run",
    runAttempt: 1,
    eventName: "schedule",
    attemptId: "gdelt-nodetail-run-1",
    observeAttemptFn: async () => readyProbe(),
    buildFn: async () => toneSnapshot({ latestSourceAsOf: "2026-07-23T12:00:00.000Z" }),
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.failure_detail ?? null, null);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-gdelt-news-tone-probe-cooldown-"));
  const events = [];
  const outcome = await runNewsTone({
    repoRoot: root,
    args: {
      noWrite: true,
      noFetch: false,
      maxRecords: 25,
      retries: 0,
      retryBackoffMs: 1,
      sleepMs: 5500,
    },
    observedAt: "2026-07-25T15:53:14.450Z",
    runId: "gdelt-probe-cooldown",
    runAttempt: 1,
    eventName: "schedule",
    attemptId: "gdelt-probe-cooldown-1",
    observeAttemptFn: async () => {
      events.push("probe");
      return readyProbe();
    },
    sleepFn: async (milliseconds) => {
      events.push(`sleep:${milliseconds}`);
    },
    buildFn: async () => {
      events.push("build");
      return toneSnapshot({ latestSourceAsOf: "2026-07-23T12:00:00.000Z" });
    },
  });
  assert.equal(outcome.ok, true);
  assert.deepEqual(events, ["probe", "sleep:5500", "build"],
    "the first ticker fetch must wait one provider interval after the reachability probe");
}

console.log("test-fetch-fenok-news-tone-proxy: ok");
