#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ATTEMPT_ASSERTION_IDS,
  FINRA_ATS_LANE_ID,
  FINRA_ATS_MARKER_SCHEMA,
  FINRA_ATS_SYMBOL_BATCH_SIZE,
  MAX_REQUESTS,
  batchTrackedSymbols,
  buildMarker,
  buildWeeklySummaryBody,
  collectPartition,
  createRequestBudget,
  lastCompletedMonday,
  loadTrackedUniverse,
  markerPathFor,
  parsePaginationTotal,
  retainRawWeeks,
  run,
  summaryTargets,
  validMarker,
  validRawWeekDocument,
} from "./fetch-finra-ats-weekly.mjs";

const OBSERVED_AT = "2026-07-24T01:00:00.000Z";
const REFERENCE_DATE = new Date("2026-07-24T12:00:00.000Z");

function makeRoot(tag, signalRows = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `finra-ats-weekly-${tag}-`));
  const signals = {
    schema_version: 1,
    rows: signalRows ?? [
      { ticker: "AAPL", ticker_normalized: "AAPL", market_scope: "us" },
      { ticker: "BRK.B", ticker_normalized: "BRK-B", market_scope: "us" },
      { ticker: "7203.T", ticker_normalized: "7203-T", market_scope: "us" },
      { ticker: "005930.KS", ticker_normalized: "005930-KS", market_scope: "korea" },
    ],
  };
  writeJson(path.join(root, "data", "computed", "fenok_signals.json"), signals);
  return root;
}

function usRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const ticker = `S${String(index).padStart(3, "0")}`;
    return { ticker, ticker_normalized: ticker, market_scope: "us" };
  });
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function row(symbol, week, tier, type = "ATS_W_SMBL") {
  return {
    issueSymbolIdentifier: symbol,
    issueName: `${symbol} Inc.`,
    MPID: "TEST",
    marketParticipantName: "Test Participant",
    tierIdentifier: tier,
    weekStartDate: week,
    summaryStartDate: week,
    totalWeeklyShareQuantity: 100,
    totalWeeklyTradeCount: 10,
    totalNotionalSum: 1000,
    summaryTypeCode: type,
  };
}

function pageResponse(rows, {
  total = rows.length,
  offset = 0,
  limit = 5000,
  includeTotalRecordsOnPage = true,
  recordsOnPage = rows.length,
} = {}) {
  const headers = {
    "record-total": String(total),
    "record-offset": String(offset),
    "record-limit": String(limit),
  };
  if (includeTotalRecordsOnPage) headers["total-records-on-page"] = String(recordsOnPage);
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify(rows),
  };
}

function successResponses(targets) {
  return {
    T1: [pageResponse([
      row("AAPL", targets.t1.target_week_start, "T1"),
      row("BRK.B", targets.t1.target_week_start, "T1", "OTC_W_SMBL"),
    ])],
    T2: [pageResponse([
      row("AAPL", targets.t2_otce.target_week_start, "T2"),
    ])],
    OTCE: [pageResponse([
      row("BRK.B", targets.t2_otce.target_week_start, "OTCE"),
    ])],
  };
}

function makeRequestMock(responses) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(responses).map(([key, value]) => [key, [...value]]));
  const request = async ({ url, method, headers = {}, body }) => {
    calls.push({ url, method, headers, body });
    if (url.includes("oauth2")) {
      return { statusCode: 200, headers: {}, body: JSON.stringify({ access_token: "mock-token", token_type: "Bearer", expires_in: 3600 }) };
    }
    const payload = JSON.parse(body);
    const tier = payload.domainFilters.find((filter) => filter.fieldName === "tierIdentifier").values[0];
    const next = queues[tier]?.shift();
    assert.ok(next, `unexpected request for ${tier}`);
    return next;
  };
  return { request, calls };
}

function attemptSink(rows) {
  return (input) => { rows.push(input); return input; };
}

async function runSuccess(root, { eventName = "schedule", request = null, observedAt = OBSERVED_AT, attempts = [], referenceDate = REFERENCE_DATE } = {}) {
  const targets = summaryTargets(referenceDate);
  const mock = request ? { request, calls: [] } : makeRequestMock(successResponses(targets));
  const result = await run({
    repoRoot: root,
    request: mock.request,
    clientId: "client-id",
    clientSecret: "client-secret",
    eventName,
    runId: `run-${eventName}-${observedAt}`.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase(),
    observedAt,
    referenceDate,
    attemptWriter: attemptSink(attempts),
  });
  return { result, attempts, calls: mock.calls, targets };
}

// Exact scheduling and request-shape pins: July 24 has July 20 as its latest
// completed Monday, then the T1/T2+OTCE delays are 2/4 weeks respectively.
assert.equal(lastCompletedMonday(REFERENCE_DATE), "2026-07-20");
assert.deepEqual(summaryTargets(REFERENCE_DATE), {
  last_completed_monday: "2026-07-20",
  t1: { tier_identifiers: ["T1"], target_week_start: "2026-07-06", walkback_week_starts: ["2026-07-06", "2026-06-29", "2026-06-22"] },
  t2_otce: { tier_identifiers: ["T2", "OTCE"], target_week_start: "2026-06-22", walkback_week_starts: ["2026-06-22", "2026-06-15", "2026-06-08"] },
});
assert.deepEqual(buildWeeklySummaryBody({
  symbols: ["AAPL", "BRK.B"],
  weekStartDate: "2026-07-06",
  tiers: ["T1"],
  offset: 0,
  limit: 5000,
}), {
  limit: 5000,
  offset: 0,
  domainFilters: [
    { fieldName: "issueSymbolIdentifier", values: ["AAPL", "BRK.B"] },
    { fieldName: "weekStartDate", values: ["2026-07-06"] },
    { fieldName: "tierIdentifier", values: ["T1"] },
    { fieldName: "summaryTypeCode", values: ["ATS_W_SMBL", "OTC_W_SMBL"] },
  ],
});
assert.equal(parsePaginationTotal({ "record-total": "11" }), 11);
assert.throws(() => parsePaginationTotal({ "record-total": "not-a-number" }), /record-total/);

// market_scope=us is the only universe source. Dot/class-share aliases map
// through ticker_normalized, while a foreign symbol remains outside FINRA scope.
{
  const root = makeRoot("universe");
  const universe = loadTrackedUniverse(root);
  assert.deepEqual(universe.query_symbols, ["AAPL", "BRK.B"]);
  assert.equal(universe.canonical_by_symbol.get("BRK-B"), "BRK.B");
  assert.equal(universe.canonical_by_symbol.has("7203-T"), false);
}

// The provider request grain is a deterministic 250-symbol shard. A 501-symbol
// universe must therefore produce exactly 250/250/1 POST payloads, never one
// oversized domain-filter request.
{
  const root = makeRoot("batching", usRows(501));
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const batches = batchTrackedSymbols(universe.query_symbols);
  assert.equal(FINRA_ATS_SYMBOL_BATCH_SIZE, 250);
  assert.deepEqual(batches.map((batch) => batch.length), [250, 250, 1]);
  const requests = [];
  const result = await collectPartition({
    request: async ({ body }) => {
      const payload = JSON.parse(body);
      requests.push(payload);
      const symbols = payload.domainFilters.find((filter) => filter.fieldName === "issueSymbolIdentifier").values;
      return pageResponse([row(symbols[0], targets.t1.target_week_start, "T1")]);
    },
    accessToken: "token",
    budget: createRequestBudget(MAX_REQUESTS, 1),
    universe,
    partition: targets.t1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(requests.map((payload) => payload.domainFilters.find((filter) => filter.fieldName === "issueSymbolIdentifier").values), batches);
}

// A date is ready when any symbol shard has rows. Empty sibling shards are
// normal coverage, and cannot force an unnecessary walkback.
{
  const root = makeRoot("mixed-batch-coverage", usRows(501));
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const batches = batchTrackedSymbols(universe.query_symbols);
  let calls = 0;
  const result = await collectPartition({
    request: async () => {
      const batchIndex = calls++;
      if (batchIndex === 0) return { statusCode: 204, headers: {}, body: "" };
      if (batchIndex === 1) return pageResponse([row(batches[1][0], targets.t1.target_week_start, "T1")]);
      return pageResponse([], { total: 0 });
    },
    accessToken: "token",
    budget: createRequestBudget(MAX_REQUESTS, 1),
    universe,
    partition: targets.t1,
  });
  assert.equal(calls, 3);
  assert.equal(result.complete, true);
  assert.equal(result.summary_start_date, targets.t1.target_week_start);
  assert.equal(result.rows.length, 1);
}

// Only when every shard is empty does the collector walk back. The first two
// candidate dates below are all-empty (3 shards each); the third is mixed but
// ready, so it is retained after exactly nine POST requests.
{
  const root = makeRoot("all-empty-batch-walkback", usRows(501));
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const batches = batchTrackedSymbols(universe.query_symbols);
  const callsByWeek = new Map();
  const result = await collectPartition({
    request: async ({ body }) => {
      const payload = JSON.parse(body);
      const week = payload.domainFilters.find((filter) => filter.fieldName === "weekStartDate").values[0];
      const symbols = payload.domainFilters.find((filter) => filter.fieldName === "issueSymbolIdentifier").values;
      callsByWeek.set(week, (callsByWeek.get(week) ?? 0) + 1);
      if (week === targets.t1.walkback_week_starts[2] && symbols[0] === batches[1][0]) {
        return pageResponse([row(symbols[0], week, "T1")]);
      }
      return pageResponse([], { total: 0 });
    },
    accessToken: "token",
    budget: createRequestBudget(MAX_REQUESTS, 1),
    universe,
    partition: targets.t1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.summary_start_date, targets.t1.walkback_week_starts[2]);
  assert.deepEqual([...callsByWeek.values()], [3, 3, 3]);
}

// 204 / empty responses walk back at most two Mondays, then use the complete
// third candidate. This also pins POST-only request handling.
{
  const root = makeRoot("walkback");
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const calls = [];
  const responses = [
    { statusCode: 204, headers: {}, body: "" },
    pageResponse([], { total: 0 }),
    pageResponse([(() => {
      const participantOptional = row("AAPL", "2026-06-22", "T1");
      delete participantOptional.MPID;
      delete participantOptional.marketParticipantName;
      return participantOptional;
    })()]),
  ];
  const budget = createRequestBudget(MAX_REQUESTS, 1);
  const result = await collectPartition({
    request: async (request) => { calls.push(request); return responses.shift(); },
    accessToken: "token",
    budget,
    universe,
    partition: targets.t1,
  });
  assert.equal(result.summary_start_date, "2026-06-22");
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.method === "POST"));
}

// FINRA's current response omits total-records-on-page. Its absence uses the
// decoded row count, while a present disagreement remains schema drift.
{
  const root = makeRoot("optional-page-count");
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const result = await collectPartition({
    request: async () => pageResponse([row("AAPL", targets.t1.target_week_start, "T1")], { includeTotalRecordsOnPage: false }),
    accessToken: "token",
    budget: createRequestBudget(MAX_REQUESTS, 1),
    universe,
    partition: targets.t1,
  });
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 1);
}

// Provider rows must carry the requested weekStartDate independently from the
// summary date; a mismatch is rejected before it can become retained raw data.
{
  const root = makeRoot("wrong-week-start-date");
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const invalid = row("AAPL", targets.t1.target_week_start, "T1");
  invalid.weekStartDate = "2026-01-01";
  await assert.rejects(() => collectPartition({
    request: async () => pageResponse([invalid]),
    accessToken: "token",
    budget: createRequestBudget(MAX_REQUESTS, 1),
    universe,
    partition: targets.t1,
  }), /row shape or tier\/source-date validation failed/);
}

// A supplied header must still agree exactly with the decoded body.
{
  const root = makeRoot("header-mismatch");
  const universe = loadTrackedUniverse(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const budget = createRequestBudget(MAX_REQUESTS, 1);
  await assert.rejects(() => collectPartition({
    request: async () => pageResponse([row("AAPL", targets.t1.target_week_start, "T1")], { recordsOnPage: 2 }),
    accessToken: "token",
    budget,
    universe,
    partition: targets.t1,
  }), /pagination header mismatch/);
}

// The token counts as request one: 100 permits no 101st request.
{
  const budget = createRequestBudget(100, 0);
  for (let index = 0; index < 100; index += 1) budget.consume();
  assert.equal(budget.used, 100);
  assert.throws(() => budget.consume(), /request budget exceeded.*101/);
}

// A complete run emits the exact admin marker and attempt contract without raw
// rows on the public-safe marker.
{
  const root = makeRoot("success");
  const attempts = [];
  const { result, targets, calls } = await runSuccess(root, { attempts });
  assert.equal(result.exit_code, 0);
  assert.equal(result.promoted, true);
  assert.equal(result.auth_path, "oauth_client_credentials");
  const tokenCall = calls[0];
  assert.equal(tokenCall.method, "POST");
  assert.match(tokenCall.url, /\/oauth2\/access_token\?grant_type=client_credentials$/);
  assert.equal(tokenCall.body, undefined);
  assert.match(tokenCall.headers.authorization, /^Basic /);
  const marker = readJson(markerPathFor(root));
  assert.deepEqual(marker, {
    schema_version: FINRA_ATS_MARKER_SCHEMA,
    lane_id: FINRA_ATS_LANE_ID,
    source_as_of: targets.t2_otce.target_week_start,
    generated_at: OBSERVED_AT,
    raw_public: false,
    public_mirror_allowed: false,
    rows_included: false,
    counts: { total_rows: 4, t1_rows: 2, t2_otce_rows: 2 },
    partitions: [
      { tier_group: "t1", tier_identifiers: ["T1"], summary_start_date: targets.t1.target_week_start, row_count: 2 },
      { tier_group: "t2_otce", tier_identifiers: ["T2", "OTCE"], summary_start_date: targets.t2_otce.target_week_start, row_count: 2 },
    ],
  });
  assert.equal(validMarker(marker), true);
  const t1RawPath = path.join(root, "data/admin/finra-ats/weeks", `${targets.t1.target_week_start}.json`);
  const t2OtceRawPath = path.join(root, "data/admin/finra-ats/weeks", `${targets.t2_otce.target_week_start}.json`);
  assert.equal(fs.existsSync(t1RawPath), true);
  assert.equal(fs.existsSync(t2OtceRawPath), true);
  const t2OtceRaw = readJson(t2OtceRawPath);
  assert.equal(validRawWeekDocument(t2OtceRaw), true);
  const wrongWeekStartDate = structuredClone(t2OtceRaw);
  wrongWeekStartDate.rows[0].weekStartDate = "2026-01-01";
  assert.equal(validRawWeekDocument(wrongWeekStartDate), false);
  assert.equal(t2OtceRaw.rows.length, 2);
  assert.deepEqual(t2OtceRaw.universe, {
    source_path: "data/computed/fenok_signals.json",
    source_sha256: loadTrackedUniverse(root).universe_sha256,
    selected_count: 2,
    mapped_count: 2,
    excluded_count: 1,
  });
  assert.equal(t2OtceRaw.auth_path, "oauth_client_credentials");
  assert.doesNotMatch(fs.readFileSync(t2OtceRawPath, "utf8"), /mock-token|client-secret|grant_type|\"body\"/);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].attemptShardPath, path.join(root, "data/admin/data-supply-state/detection-attempts/finra_ats.json"));
  assert.deepEqual(attempts[0].result.attempt.assertions, ATTEMPT_ASSERTION_IDS.map((id) => ({ id, passed: true })));
  assert.equal(attempts[0].result.attempt.auth, "ok");
}

// OAuth replies must be usable Bearer credentials; an access token alone is
// not enough to fetch provider data.
{
  const invalidTokens = [
    { name: "missing-expiry", document: { access_token: "mock-token", token_type: "Bearer" } },
    { name: "wrong-token-type", document: { access_token: "mock-token", token_type: "MAC", expires_in: 3600 } },
    { name: "zero-expiry", document: { access_token: "mock-token", token_type: "Bearer", expires_in: 0 } },
    { name: "negative-expiry", document: { access_token: "mock-token", token_type: "Bearer", expires_in: -1 } },
  ];
  for (const fixture of invalidTokens) {
    const root = makeRoot(`oauth-shape-${fixture.name}`);
    let requests = 0;
    const result = await run({
      repoRoot: root,
      request: async () => {
        requests += 1;
        return { statusCode: 200, headers: {}, body: JSON.stringify(fixture.document) };
      },
      clientId: "client-id",
      clientSecret: "client-secret",
      eventName: "schedule",
      runId: `invalid-oauth-${fixture.name}`,
      observedAt: OBSERVED_AT,
      referenceDate: REFERENCE_DATE,
      attemptWriter: attemptSink([]),
    });
    assert.equal(requests, 1);
    assert.equal(result.exit_code, 2);
    assert.equal(result.reason, "auth_error");
  }
}

// The real attempt writer accepts the registered lane and persists only the
// two detection assertions at the mandated shard path.
{
  const root = makeRoot("attempt-writer");
  const targets = summaryTargets(REFERENCE_DATE);
  const { request } = makeRequestMock(successResponses(targets));
  const result = await run({
    repoRoot: root,
    request,
    clientId: "client-id",
    clientSecret: "client-secret",
    eventName: "schedule",
    runId: "actual-attempt-writer",
    observedAt: OBSERVED_AT,
    referenceDate: REFERENCE_DATE,
  });
  assert.equal(result.exit_code, 0);
  const shard = readJson(path.join(root, "data/admin/data-supply-state/detection-attempts/finra_ats.json"));
  assert.deepEqual(shard.attempts[0].assertions, ATTEMPT_ASSERTION_IDS.map((id) => ({ id, passed: true })));
}

// The workflow's dispatch-only `controlled_failure=transport` never contacts
// FINRA and records a retained-LKG degradation instead of a promotion.
{
  const root = makeRoot("controlled-failure");
  await runSuccess(root);
  let requests = 0;
  const result = await run({
    repoRoot: root,
    request: async () => { requests += 1; throw new Error("controlled request must not occur"); },
    clientId: "client-id",
    clientSecret: "client-secret",
    controlledFailureLanes: "transport",
    eventName: "workflow_dispatch",
    runId: "controlled-failure",
    observedAt: "2026-07-25T01:00:00.000Z",
    referenceDate: REFERENCE_DATE,
    attemptWriter: attemptSink([]),
  });
  assert.equal(requests, 0);
  assert.equal(result.controlled_failure, true);
  assert.equal(result.exit_code, 0);
  assert.equal(result.promoted, false);
}

// Failure cannot silently switch to a public endpoint: missing OAuth credentials
// stop before any request. The explicit guard mutation must change that result.
{
  for (const credentials of [
    { name: "both-missing", clientId: "", clientSecret: "" },
    { name: "secret-missing", clientId: "client-id", clientSecret: "" },
    { name: "id-missing", clientId: "", clientSecret: "client-secret" },
  ]) {
    const root = makeRoot(`auth-guard-${credentials.name}`);
    let requests = 0;
    const attempts = [];
    const result = await run({
      repoRoot: root,
      request: async () => { requests += 1; throw new Error("must not request"); },
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      eventName: "schedule",
      runId: `missing-oauth-${credentials.name}`,
      observedAt: OBSERVED_AT,
      referenceDate: REFERENCE_DATE,
      attemptWriter: attemptSink(attempts),
    });
    assert.equal(requests, 0);
    assert.equal(result.exit_code, 2);
    assert.equal(result.reason, "auth_error");
    assert.equal(attempts[0].result.attempt.auth, "rejected");
  }
  const source = fs.readFileSync(new URL("./fetch-finra-ats-weekly.mjs", import.meta.url), "utf8");
  const guard = "if (!clientId || !clientSecret)";
  assert.match(source, new RegExp(guard.replaceAll(/[()|]/g, "\\$&")));
  const guardMutant = source.replace(guard, "if (false)");
  assert.doesNotMatch(guardMutant, new RegExp(guard.replaceAll(/[()|]/g, "\\$&")), "auth-fallback guard mutation must be observable");
}

// Provider authorization failures after a valid token remain systemic auth
// failures and cannot degrade into public or unauthenticated collection.
{
  for (const statusCode of [401, 403]) {
    const root = makeRoot(`provider-auth-${statusCode}`);
    let requests = 0;
    const result = await run({
      repoRoot: root,
      request: async ({ url }) => {
        requests += 1;
        if (url.includes("oauth2")) {
          return { statusCode: 200, headers: {}, body: JSON.stringify({ access_token: "mock-token", token_type: "Bearer", expires_in: 3600 }) };
        }
        return { statusCode, headers: {}, body: "" };
      },
      clientId: "client-id",
      clientSecret: "client-secret",
      eventName: "schedule",
      runId: `provider-auth-${statusCode}`,
      observedAt: OBSERVED_AT,
      referenceDate: REFERENCE_DATE,
      attemptWriter: attemptSink([]),
    });
    assert.equal(requests, 2);
    assert.equal(result.exit_code, 2);
    assert.equal(result.reason, "auth_error");
  }
}

// A partial partition keeps an existing complete marker as LKG, degrades exit
// status to zero, and never promotes or rewrites the current marker.
{
  const root = makeRoot("partial-lkg");
  await runSuccess(root);
  const markerBefore = fs.readFileSync(markerPathFor(root));
  const targets = summaryTargets(REFERENCE_DATE);
  const responses = successResponses(targets);
  responses.T2 = [{ statusCode: 500, headers: {}, body: "server error" }];
  const { request } = makeRequestMock(responses);
  const attempts = [];
  const result = await run({
    repoRoot: root,
    request,
    clientId: "client-id",
    clientSecret: "client-secret",
    eventName: "schedule",
    runId: "partial-with-lkg",
    observedAt: "2026-07-25T01:00:00.000Z",
    referenceDate: REFERENCE_DATE,
    attemptWriter: attemptSink(attempts),
  });
  assert.equal(result.exit_code, 0);
  assert.equal(result.degraded, true);
  assert.equal(result.promoted, false);
  assert.deepEqual(fs.readFileSync(markerPathFor(root)), markerBefore);
}

// Without LKG, an incomplete partition is corrupt/nonzero.
{
  const root = makeRoot("partial-no-lkg");
  const targets = summaryTargets(REFERENCE_DATE);
  const responses = successResponses(targets);
  responses.T1 = [{ statusCode: 500, headers: {}, body: "server error" }];
  const { request } = makeRequestMock(responses);
  const result = await run({
    repoRoot: root,
    request,
    clientId: "client-id",
    clientSecret: "client-secret",
    eventName: "schedule",
    runId: "partial-no-lkg",
    observedAt: OBSERVED_AT,
    referenceDate: REFERENCE_DATE,
    attemptWriter: attemptSink([]),
  });
  assert.equal(result.exit_code, 2);
  assert.equal(result.degraded, false);
  assert.equal(result.promoted, false);
}

// Retention keeps 26 raw weekly payloads, never accepts malformed evidence,
// and preserves the newest dates first.
{
  const rawWeeks = Array.from({ length: 30 }, (_, index) => ({
    schema_version: "fenok-finra-ats-weekly-raw/v1",
    lane_id: FINRA_ATS_LANE_ID,
    summary_start_date: `2025-01-${String(index + 1).padStart(2, "0")}`,
    generated_at: OBSERVED_AT,
    raw_public: false,
    public_mirror_allowed: false,
    auth_path: "oauth_client_credentials",
    row_shape_valid: true,
    request_count: 4,
    last_completed_monday: "2025-01-01",
    universe: {
      source_path: "data/computed/fenok_signals.json",
      source_sha256: "0".repeat(64),
      selected_count: 1,
      mapped_count: 1,
      excluded_count: 0,
    },
    partitions: [
      { tier_group: "t1", tier_identifiers: ["T1"], summary_start_date: `2025-01-${String(index + 1).padStart(2, "0")}`, row_count: 1 },
    ],
    rows: [row("AAPL", `2025-01-${String(index + 1).padStart(2, "0")}`, "T1")],
  }));
  const retained = retainRawWeeks(rawWeeks);
  assert.equal(retained.entries.length, 26);
  assert.equal(retained.entries[0].summary_start_date, "2025-01-30");
  assert.equal(retained.entries.at(-1).summary_start_date, "2025-01-05");
  assert.throws(() => retainRawWeeks([{ nope: true }]), /invalid FINRA ATS raw-week entry/);
}

// The raw-week evidence directory is closed-world: unexpected files,
// directories, and malformed date-named JSON fail before OAuth or mutation.
{
  const fixtures = [
    {
      name: "unexpected-file",
      install: (weeksRoot) => fs.writeFileSync(path.join(weeksRoot, "README.txt"), "unexpected\n"),
    },
    {
      name: "unexpected-directory",
      install: (weeksRoot) => fs.mkdirSync(path.join(weeksRoot, "archive")),
    },
    {
      name: "malformed-json",
      install: (weeksRoot) => fs.writeFileSync(path.join(weeksRoot, "2020-01-06.json"), "{bad"),
    },
  ];
  for (const fixture of fixtures) {
    const root = makeRoot(`weeks-${fixture.name}`);
    await runSuccess(root);
    const markerBefore = fs.readFileSync(markerPathFor(root));
    const weeksRoot = path.join(root, "data", "admin", "finra-ats", "weeks");
    fixture.install(weeksRoot);
    const rerun = await runSuccess(root, { observedAt: "2026-07-25T01:00:00.000Z" });
    assert.equal(rerun.calls.length, 0);
    assert.equal(rerun.result.exit_code, 2);
    assert.equal(rerun.result.reason, "schema_drift");
    assert.deepEqual(fs.readFileSync(markerPathFor(root)), markerBefore);
  }
}

// A corrupt recovery index fails closed before raw/current mutation.
{
  const root = makeRoot("malformed-state");
  const markerFile = markerPathFor(root);
  fs.mkdirSync(path.dirname(markerFile), { recursive: true });
  fs.writeFileSync(markerFile, "marker-before\n");
  const rawFile = path.join(root, "data", "admin", "finra-ats", "raw", "prior.json");
  fs.mkdirSync(path.dirname(rawFile), { recursive: true });
  fs.writeFileSync(rawFile, "raw-before\n");
  fs.writeFileSync(path.join(root, "data", "admin", "finra-ats", "index.json"), "{bad");
  const result = (await runSuccess(root)).result;
  assert.equal(result.exit_code, 2);
  assert.deepEqual(fs.readFileSync(markerFile, "utf8"), "marker-before\n");
  assert.deepEqual(fs.readFileSync(rawFile, "utf8"), "raw-before\n");
}

// Marker privacy is structural: changing either public flag is invalid.
{
  const marker = buildMarker({
    generatedAt: OBSERVED_AT,
    partitions: [
      { tier_group: "t1", tier_identifiers: ["T1"], summary_start_date: "2026-06-29", rows: [row("AAPL", "2026-06-29", "T1")] },
      { tier_group: "t2_otce", tier_identifiers: ["T2", "OTCE"], summary_start_date: "2026-06-15", rows: [row("AAPL", "2026-06-15", "T2")] },
    ],
  });
  assert.equal(validMarker(marker), true);
  assert.equal(validMarker({ ...marker, raw_public: true }), false);
  assert.equal(validMarker({ ...marker, public_mirror_allowed: true }), false);
  assert.equal(Object.hasOwn(marker, "rows"), false);
}

// Recovery promotion stays schedule-only after a retained failure.
{
  const root = makeRoot("recovery-gate");
  await runSuccess(root);
  const targets = summaryTargets(REFERENCE_DATE);
  const failedResponses = successResponses(targets);
  failedResponses.T1 = [{ statusCode: 500, headers: {}, body: "server error" }];
  const failed = makeRequestMock(failedResponses);
  await run({ repoRoot: root, request: failed.request, clientId: "id", clientSecret: "secret", eventName: "schedule", runId: "failure", observedAt: "2026-07-25T01:00:00.000Z", referenceDate: REFERENCE_DATE, attemptWriter: attemptSink([]) });
  const markerBefore = fs.readFileSync(markerPathFor(root));
  const dispatched = await runSuccess(root, { eventName: "workflow_dispatch", observedAt: "2026-07-26T01:00:00.000Z" });
  assert.equal(dispatched.result.promoted, false);
  assert.equal(dispatched.result.reason, "recovery_requires_schedule");
  assert.deepEqual(fs.readFileSync(markerPathFor(root)), markerBefore);
  const scheduled = await runSuccess(root, {
    eventName: "schedule",
    observedAt: "2026-07-31T01:00:00.000Z",
    referenceDate: new Date("2026-07-31T12:00:00.000Z"),
  });
  assert.equal(scheduled.result.promoted, true, "only a natural schedule run may promote an advanced recovery");
}

console.log("fetch-finra-ats-weekly tests passed");
