#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  articleSeenAt,
  cleanCompanyName,
  computeTone,
  cueCounts,
  GDELT_HISTORY_PERSISTENCE_POLICY,
  MAX_GDELT_HISTORY_SOURCE_DATES,
  mergeHistory,
  observeAttempt,
  queryForTicker,
  runNewsTone,
} from "./fetch-fenok-news-tone-proxy.mjs";
import { attemptResult, returnedTuple, threwTuple } from "./lib/data-supply-attempt-shard.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LANE_ID = "gdelt_news_tone";
const WORKFLOW_REL = ".github/workflows/fetch-fenok-news-tone.yml";

assert.equal(cleanCompanyName("NVIDIA CORP Class A"), "NVIDIA A");
assert.equal(queryForTicker("NVDA", "NVIDIA CORP"), '"NVIDIA"');
assert.deepEqual(cueCounts("Analyst upgrades company after strong profit growth"), { positive: 3, negative: 0 });
assert.deepEqual(cueCounts("Company falls after weak warning and lawsuit"), { positive: 0, negative: 4 });
assert.equal(articleSeenAt("20260628T123456Z"), "2026-06-28T12:34:56.000Z");

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
    coverage: { row_count: 2, with_articles: 2, with_tone_score: 2, errors: [] },
    rows: [
      {
        ticker: "DASH",
        as_of: sourceFloor,
        direct_news_tone_proxy: { score_0_100: 55, attention_score_0_100: 4, article_count: 1 },
      },
      {
        ticker: "NVDA",
        as_of: latestSourceAsOf,
        direct_news_tone_proxy: { score_0_100: 60, attention_score_0_100: 8, article_count: 2 },
      },
    ],
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
  const shard = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "gdelt_news_tone.json"),
    "utf8",
  ));
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "articles_array", passed: false }],
    "controlled transport failures retain endpoint-contract assertion ids with failed verdicts");
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
  assert.equal(failed.retained, true, "a rate-limited first post-deploy run seeds LKG from the prior dated canonical");
  assert.equal(fs.readFileSync(canonicalPath, "utf8"), before);
  const state = JSON.parse(fs.readFileSync(
    path.join(root, "data", "admin", "gdelt_news_tone", "index.json"),
    "utf8",
  ));
  assert.equal(state.items.news_tone_proxy.lkg.source_as_of, "2026-07-23T12:00:00.000Z",
    "legacy LKG seed uses only the newest valid provider article seendate");
}

// --- Workflow contract (owned producer wiring, #366) ------------------------
{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, WORKFLOW_REL), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fenok-news-tone-proxy\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fenok-news-tone-proxy\.mjs/);
  assert.match(workflow, /controlled_failure/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE/);
  assert.match(workflow, /--reference-only --retries 2 --retry-backoff-ms 6500/);
  assert.match(workflow, new RegExp(`detection-attempts/${LANE_ID}\\.json`));
  assert.match(workflow, /data\/computed\/fenok_news_tone_proxy\.json/);
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

console.log("test-fetch-fenok-news-tone-proxy: ok");
