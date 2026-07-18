#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCOUNT_TYPES,
  ATTEMPT_SHARD_SCHEMA,
  MAX_SERIES_DAYS,
  TGA_PERSISTENCE_POLICY,
  retainLatestTgaSeriesDays,
  runTreasuryTga,
} from "./fetch-treasury-tga.mjs";
import { validateAttemptEvidence } from "./build-data-supply-detection-floor.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "tga-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function response(statusCode, payload) {
  return {
    statusCode,
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}

function rowsFor(accountType, index = 0) {
  return {
    data: [
      {
        record_date: "2026-07-11",
        open_today_bal: String(700_000 + index),
        account_type: accountType,
      },
    ],
  };
}

function validDocument({ sourceDate = "2026-07-11", observedAt = OBSERVED_AT } = {}) {
  const raw = Object.fromEntries(ACCOUNT_TYPES.map((accountType, index) => [
    ["fra", "tga", "tgaOpening"][index],
    rowsFor(accountType, index).data.map((row) => ({ ...row, record_date: sourceDate })),
  ]));
  return {
    updated: observedAt,
    source: "Treasury FiscalData",
    endpoint: "accounting/dts/operating_cash_balance",
    series: [{ date: sourceDate, val: 700_002 }],
    raw,
  };
}

function makePaths(root) {
  return {
    canonicalPath: path.join(root, "data", "macro", "tga.json"),
    publicPath: path.join(root, "100xfenok-next", "public", "data", "macro", "tga.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "treasury_tga.json"),
    statePath: path.join(root, "data", "admin", "treasury_tga", "index.json"),
    lkgPath: path.join(root, "data", "admin", "treasury_tga", "lkg", "tga.json"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function runCase(request, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-test-"));
  const paths = makePaths(root);
  const result = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request,
    observedAt: options.observedAt ?? OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: options.runId ?? "natural-success",
    runAttempt: options.runAttempt ?? 1,
    eventName: options.eventName ?? "schedule",
    controlledFailureKey: options.controlledFailureKey ?? "",
  });
  return { root, paths, result, shard: readJson(paths.attemptShardPath) };
}

function assertShardShape(shard) {
  assert.deepEqual(Object.keys(shard), ["schema_version", "lane_id", "attempts"]);
  assert.equal(shard.schema_version, ATTEMPT_SHARD_SCHEMA);
  assert.equal(shard.lane_id, "treasury_tga");
  assert.equal(shard.attempts.length, 1);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  const row = shard.attempts[0];
  assert.deepEqual(Object.keys(row), [
    "lane_id",
    "member_id",
    "attempt_id",
    "observed_at",
    "execution",
    "exception_kind",
    "http_status",
    "auth",
    "rate_limited",
    "decode",
    "payload",
    "assertions",
  ]);
  assert.equal(row.lane_id, "treasury_tga");
  assert.equal(row.member_id, null);
  assert.equal(row.attempt_id, ATTEMPT_ID);
  assert.equal(row.observed_at, OBSERVED_AT);
  return row;
}

{
  let calls = 0;
  const { paths, result, shard } = await runCase(async (_url, accountType) => {
    const index = ACCOUNT_TYPES.indexOf(accountType);
    calls += 1;
    return response(200, rowsFor(accountType, index));
  });
  assert.equal(calls, 3);
  assert.equal(result.ok, true);
  assert.equal(result.reason, "ok");
  assert.equal(result.updated, true);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), fs.readFileSync(paths.publicPath));
  const output = readJson(paths.canonicalPath);
  assert.equal(output.source, "Treasury FiscalData");
  assert.equal(output.series.length, 1);
  assert.equal(output.series[0].date, "2026-07-11");
  assert.equal(output.raw.fra.length, 1);
  assert.equal(output.raw.tga.length, 1);
  assert.equal(output.raw.tgaOpening.length, 1);
  const state = readJson(paths.statePath);
  assert.deepEqual(state.retry_set, []);
  assert.equal(state.items.tga.resolution_state, "fresh_primary");
  assert.equal(state.items.tga.current.source_as_of, "2026-07-11");
  assert.equal(fs.existsSync(paths.lkgPath), false);
  const row = assertShardShape(shard);
  assert.deepEqual(row, {
    lane_id: "treasury_tga",
    member_id: null,
    attempt_id: ATTEMPT_ID,
    observed_at: OBSERVED_AT,
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    auth: "not_applicable",
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "data_array", passed: true }],
  });
}

async function assertFailureCase({ failingResponse, expected, failingIndex = 1 }) {
  const { paths, result, shard } = await runCase(async (_url, accountType) => {
    const index = ACCOUNT_TYPES.indexOf(accountType);
    if (index === failingIndex) {
      if (failingResponse instanceof Error) throw failingResponse;
      return failingResponse;
    }
    return response(200, rowsFor(accountType, index));
  });
  assert.equal(result.ok, false);
  assert.equal(result.updated, false);
  assert.equal(result.reason, expected.reason);
  assert.equal(result.exitCode, 2);
  assert.equal(fs.existsSync(paths.canonicalPath), false);
  assert.equal(fs.existsSync(paths.publicPath), false);
  const row = assertShardShape(shard);
  for (const [key, value] of Object.entries(expected.row)) assert.deepEqual(row[key], value, key);
}

await assertFailureCase({
  failingResponse: response(429, { error: "rate limit" }),
  expected: {
    reason: "rate_limited",
    row: {
      execution: "returned",
      exception_kind: null,
      http_status: 429,
      auth: "not_applicable",
      rate_limited: true,
      decode: "not_attempted",
      payload: "not_available",
      assertions: [],
    },
  },
});

{
  const { result, shard } = await runCase(async (_url, accountType) => {
    const index = ACCOUNT_TYPES.indexOf(accountType);
    if (index === 0) return response(200, { data: {} });
    if (index === 2) return response(429, { error: "rate limit" });
    return response(200, rowsFor(accountType, index));
  });
  assert.equal(result.reason, "rate_limited", "unavailable must outrank drift");
  const row = assertShardShape(shard);
  assert.equal(row.http_status, 429);
}

await assertFailureCase({
  failingResponse: response(401, { error: "unauthorized" }),
  expected: {
    reason: "auth_error",
    row: {
      execution: "returned",
      exception_kind: null,
      http_status: 401,
      auth: "rejected",
      rate_limited: false,
      decode: "not_attempted",
      payload: "not_available",
      assertions: [],
    },
  },
});

await assertFailureCase({
  failingResponse: response(200, "{not-json"),
  expected: {
    reason: "decode_error",
    row: {
      execution: "returned",
      http_status: 200,
      auth: "not_applicable",
      rate_limited: false,
      decode: "error",
      payload: "not_available",
      assertions: [],
    },
  },
});

await assertFailureCase({
  failingResponse: response(200, { data: [] }),
  expected: {
    reason: "empty_payload",
    row: {
      execution: "returned",
      http_status: 200,
      auth: "not_applicable",
      rate_limited: false,
      decode: "ok",
      payload: "empty",
      assertions: [],
    },
  },
});

await assertFailureCase({
  failingResponse: response(200, { data: {} }),
  expected: {
    reason: "schema_drift",
    row: {
      execution: "returned",
      http_status: 200,
      auth: "not_applicable",
      rate_limited: false,
      decode: "ok",
      payload: "non_empty",
      assertions: [{ id: "data_array", passed: false }],
    },
  },
});

await assertFailureCase({
  failingResponse: Object.assign(new Error("socket reset"), { code: "ECONNRESET" }),
  expected: {
    reason: "transport_error",
    row: {
      execution: "threw",
      exception_kind: "transport",
      http_status: null,
      auth: "not_applicable",
      rate_limited: false,
      decode: "not_attempted",
      payload: "not_available",
      assertions: [],
    },
  },
});

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-lkg-test-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const lkg = `${JSON.stringify(validDocument(), null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, lkg);
  fs.writeFileSync(paths.publicPath, lkg);
  let controlledCalls = 0;
  const result = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: async (_url, accountType) => {
      assert.notEqual(accountType, ACCOUNT_TYPES[1], "controlled bucket must bypass the provider");
      controlledCalls += 1;
      return response(200, rowsFor(accountType));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "chaos-run-1",
    runAttempt: 1,
    eventName: "workflow_dispatch",
    controlledFailureKey: "tga",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "controlled_failure");
  assert.equal(result.degraded, true);
  assert.equal(result.exitCode, 0);
  assert.equal(controlledCalls, 2);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.lkgPath, "utf8"), lkg);
  const retainedState = readJson(paths.statePath);
  assert.deepEqual(retainedState.retry_set, ["tga"]);
  assert.equal(retainedState.items.tga.resolution_state, "lkg_primary");
  assert.equal(retainedState.items.tga.latest_failure.run_id, "chaos-run-1");
  assert.match(retainedState.items.tga.lkg.payload_sha256, /^[a-f0-9]{64}$/);

  const healthyRequest = async (_url, accountType) => response(200, rowsFor(accountType));
  for (const gate of [
    { eventName: "workflow_dispatch", runAttempt: 1, reason: "recovery_requires_schedule" },
    { eventName: "schedule", runAttempt: 2, reason: "recovery_requires_schedule" },
  ]) {
    const held = await runTreasuryTga({
      ...paths,
      repoRoot: root,
      request: async (_url, accountType) => response(200, {
        data: rowsFor(accountType, 10).data.map((row) => ({ ...row, record_date: "2026-07-12" })),
      }),
      observedAt: "2026-07-15T12:34:56.000Z",
      attemptId: ATTEMPT_ID,
      runId: `held-${gate.eventName}-${gate.runAttempt}`,
      ...gate,
    });
    assert.equal(held.reason, gate.reason);
    assert.equal(held.exitCode, 0);
    assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  }

  const sameSource = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: healthyRequest,
    observedAt: "2026-07-15T12:34:56.000Z",
    attemptId: ATTEMPT_ID,
    runId: "natural-same-source",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");
  assert.equal(sameSource.exitCode, 0);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  assert.equal(readJson(paths.statePath).items.tga.latest_promotion_deferral.reason, "recovery_not_advanced_by_provider");
  assert.equal(readJson(paths.statePath).items.tga.latest_promotion_deferral.run_id, "natural-same-source");

  const recovered = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: async (_url, accountType) => response(200, {
      data: rowsFor(accountType).data.map((row) => ({ ...row, record_date: "2026-07-12" })),
    }),
    observedAt: "2026-07-15T18:34:56.000Z",
    attemptId: ATTEMPT_ID,
    runId: "natural-recovery",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(paths.statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.tga.resolution_state, "fresh_primary");
  assert.equal(recoveredState.items.tga.recovered_from_run_id, "chaos-run-1");
  assert.equal(recoveredState.items.tga.recovery_run_id, "natural-recovery");
  assert.equal(recoveredState.items.tga.recovery_run_attempt, 1);
  assert.equal(recoveredState.items.tga.recovery_event_name, "schedule");
  assert.equal(recoveredState.items.tga.current.source_as_of, "2026-07-12");
}

async function seededFailure({
  request,
  sourceDate = "2026-07-11",
  eventName = "schedule",
  controlledFailureKey = "",
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-seeded-failure-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const bytes = `${JSON.stringify(validDocument({ sourceDate }), null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, bytes);
  fs.writeFileSync(paths.publicPath, bytes);
  const result = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "seeded-failure",
    runAttempt: 1,
    eventName,
    controlledFailureKey,
  });
  return { paths, bytes, result };
}

{
  const partial = await seededFailure({
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[2]
      ? response(503, { error: "upstream" })
      : response(200, rowsFor(accountType)),
  });
  assert.equal(partial.result.reason, "http_error");
  assert.equal(partial.result.degraded, true);
  assert.equal(partial.result.exitCode, 0);
  assert.equal(fs.readFileSync(partial.paths.canonicalPath, "utf8"), partial.bytes);

  const concurrentNaturalFailure = await seededFailure({
    eventName: "workflow_dispatch",
    controlledFailureKey: "tga",
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[2]
      ? response(503, { error: "real upstream failure" })
      : response(200, rowsFor(accountType)),
  });
  assert.equal(concurrentNaturalFailure.result.reason, "http_error", "chaos must not hide a concurrent natural failure");
  assert.equal(concurrentNaturalFailure.result.degraded, true);
  assert.equal(readJson(concurrentNaturalFailure.paths.statePath).items.tga.latest_failure.reason, "http_error");
  const concurrentAttempt = assertShardShape(readJson(concurrentNaturalFailure.paths.attemptShardPath));
  assert.equal(concurrentAttempt.execution, "returned");
  assert.equal(concurrentAttempt.http_status, 503, "attempt evidence must name the natural failure, not injected transport");

  const controlledWithNaturalOutage = await seededFailure({
    eventName: "workflow_dispatch",
    controlledFailureKey: "tga",
    request: async () => response(503, { error: "natural outage" }),
  });
  assert.equal(controlledWithNaturalOutage.result.reason, "http_error");
  assert.equal(controlledWithNaturalOutage.result.corrupt, true);
  assert.equal(controlledWithNaturalOutage.result.exitCode, 2);
  assert.equal(readJson(controlledWithNaturalOutage.paths.statePath).items.tga.latest_failure.reason, "http_error");
  assert.equal(assertShardShape(readJson(controlledWithNaturalOutage.paths.attemptShardPath)).http_status, 503);

  for (const failingResponse of [
    response(401, { error: "auth" }),
    response(429, { error: "rate" }),
    response(200, "{broken"),
    response(200, { data: {} }),
    response(200, { data: [] }),
    response(404, { error: "not found" }),
  ]) {
    const fatal = await seededFailure({
      request: async (_url, accountType) => accountType === ACCOUNT_TYPES[1]
        ? failingResponse
        : response(200, rowsFor(accountType)),
    });
    assert.equal(fatal.result.exitCode, 2);
    assert.equal(fatal.result.corrupt, true);
    assert.equal(fs.readFileSync(fatal.paths.canonicalPath, "utf8"), fatal.bytes);
  }
}

{
  const systemic = await seededFailure({ request: async () => response(503, { error: "outage" }) });
  assert.equal(systemic.result.exitCode, 2);
  assert.equal(systemic.result.corrupt, true);

  const malformed = await seededFailure({
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[0]
      ? response(200, { data: [{ record_date: "2026-07-11", open_today_bal: null }] })
      : response(200, rowsFor(accountType)),
  });
  assert.equal(malformed.result.reason, "schema_drift");
  assert.equal(malformed.result.exitCode, 2);
  assertShardShape(readJson(malformed.paths.attemptShardPath));

  const future = await seededFailure({
    request: async (_url, accountType) => response(200, {
      data: rowsFor(accountType).data.map((row) => ({ ...row, record_date: "2026-07-20" })),
    }),
  });
  assert.equal(future.result.reason, "future_source");
  assert.equal(future.result.exitCode, 2);
  assertShardShape(readJson(future.paths.attemptShardPath));
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-source-guard-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const currentBytes = `${JSON.stringify(validDocument({ sourceDate: "2026-07-11" }), null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, currentBytes);
  fs.writeFileSync(paths.publicPath, currentBytes);
  const equal = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: async (_url, accountType) => response(200, rowsFor(accountType)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "equal-source",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(equal.reason, "unchanged_source");
  assert.equal(equal.updated, false);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), currentBytes);
  assert.equal(readJson(paths.statePath).items.tga.current.source_as_of, "2026-07-11");

  const regression = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: async (_url, accountType) => response(200, {
      data: rowsFor(accountType).data.map((row) => ({ ...row, record_date: "2026-07-10" })),
    }),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "source-regression",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(regression.reason, "source_regression");
  assert.equal(regression.degraded, true);
  assert.equal(regression.exitCode, 0);
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), currentBytes);
  assert.equal(fs.readFileSync(paths.lkgPath, "utf8"), currentBytes);
}

{
  const invalidDate = await seededFailure({
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[0]
      ? response(200, { data: [{ record_date: "2026-02-31", open_today_bal: "1" }] })
      : response(200, rowsFor(accountType)),
  });
  assert.equal(invalidDate.result.reason, "schema_drift");
  assert.equal(invalidDate.result.exitCode, 2);

  const mismatched = validDocument();
  mismatched.series[0].val = -1;
  const mismatchedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-mismatched-lkg-"));
  const mismatchedPaths = makePaths(mismatchedRoot);
  fs.mkdirSync(path.dirname(mismatchedPaths.canonicalPath), { recursive: true });
  fs.writeFileSync(mismatchedPaths.canonicalPath, `${JSON.stringify(mismatched, null, 2)}\n`);
  const rejectedMismatch = await runTreasuryTga({
    ...mismatchedPaths,
    repoRoot: mismatchedRoot,
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[2]
      ? response(503, { error: "partial" })
      : response(200, rowsFor(accountType)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "mismatched-lkg",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(rejectedMismatch.exitCode, 2, "series/raw mismatch cannot qualify as retained LKG");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-corrupt-lkg-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.writeFileSync(paths.canonicalPath, `${JSON.stringify(validDocument(), null, 2)}\n`);
  await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: async () => response(503, { error: "partial" }),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "seed-lkg",
    runAttempt: 1,
    eventName: "workflow_dispatch",
    controlledFailureKey: "tga",
  });
  fs.rmSync(paths.canonicalPath);
  fs.writeFileSync(paths.lkgPath, "{}\n");
  const corrupt = await runTreasuryTga({
    ...paths,
    repoRoot: root,
    request: async (_url, accountType) => accountType === ACCOUNT_TYPES[2]
      ? response(503, { error: "partial" })
      : response(200, rowsFor(accountType)),
    observedAt: "2026-07-15T12:34:56.000Z",
    attemptId: ATTEMPT_ID,
    runId: "corrupt-lkg",
    runAttempt: 1,
    eventName: "schedule",
  });
  assert.equal(corrupt.exitCode, 2);
  assert.equal(corrupt.corrupt, true);
}

await assert.rejects(
  runTreasuryTga({
    repoRoot: fs.mkdtempSync(path.join(os.tmpdir(), "fetch-tga-invalid-chaos-")),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    runId: "invalid-chaos",
    runAttempt: 1,
    eventName: "schedule",
    controlledFailureKey: "tga",
  }),
  /controlled failure requires workflow_dispatch/,
);

{
  const sourceDates = Array.from({ length: MAX_SERIES_DAYS + 2 }, (_, index) => {
    const date = new Date(Date.UTC(1980, 0, 1 + index));
    return date.toISOString().slice(0, 10);
  });
  const raw = Object.fromEntries(["fra", "tga", "tgaOpening"].map((key, bucketIndex) => [
    key,
    sourceDates.map((recordDate, rowIndex) => ({
      record_date: recordDate,
      open_today_bal: String((bucketIndex + 1) * 1_000_000 + rowIndex),
    })),
  ]));

  const retained = retainLatestTgaSeriesDays(raw);
  assert.equal(retained.series.length, MAX_SERIES_DAYS);
  assert.equal(retained.series[0].date, sourceDates[2], "oldest source days are evicted first");
  assert.equal(retained.series.at(-1).date, sourceDates.at(-1), "newest source day is retained");
  assert.deepEqual(Object.values(retained.raw).map((rows) => rows.length), [
    MAX_SERIES_DAYS,
    MAX_SERIES_DAYS,
    MAX_SERIES_DAYS,
  ]);
  assert.deepEqual(retained.stats, {
    provider_rows: (MAX_SERIES_DAYS + 2) * 3,
    valid_series_days: MAX_SERIES_DAYS + 2,
    retained_series_days: MAX_SERIES_DAYS,
    pruned_series_days: 2,
    retained_raw_rows: MAX_SERIES_DAYS * 3,
    pruned_raw_rows: 6,
    oldest_retained_date: sourceDates[2],
    newest_retained_date: sourceDates.at(-1),
  });

  const retainedAgain = retainLatestTgaSeriesDays(retained.raw);
  assert.deepEqual(retainedAgain.raw, retained.raw, "bounded Treasury persistence is idempotent");
  assert.deepEqual(retainedAgain.series, retained.series, "series projection is idempotent");
  assert.equal(retainedAgain.stats.pruned_series_days, 0);

  const { paths, result } = await runCase(async (_url, accountType) => response(200, {
    data: raw[["fra", "tga", "tgaOpening"][ACCOUNT_TYPES.indexOf(accountType)]],
  }));
  assert.equal(result.ok, true);
  const output = readJson(paths.canonicalPath);
  assert.deepEqual(output.persistence_policy, TGA_PERSISTENCE_POLICY);
  assert.deepEqual(output.persistence_state, retained.stats);
  assert.deepEqual(output.series, retained.series);
  assert.deepEqual(output.raw, retained.raw);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-treasury-tga.yml"), "utf8");
  assert.match(workflow, /node scripts\/fetch-treasury-tga\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /data\/admin\/data-supply-state\/detection-attempts\/treasury_tga\.json/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.match(workflow, /data\/admin\/treasury_tga\/index\.json/);
  assert.match(workflow, /data\/admin\/treasury_tga\/lkg\/tga\.json/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.doesNotMatch(workflow, /data-supply-detection-floor\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-treasury-tga: ok");
