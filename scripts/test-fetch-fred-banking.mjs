#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  deriveTrailingIndexDividendYield,
} from "./lib/index-dividend-yield.mjs";
import {
  FRED_BANKING_GROUPS,
  FRED_NASDAQ_REQUEST_DAYS,
  FRED_NASDAQ_REQUEST_WINDOW,
  runFredBanking,
} from "./fetch-fred-banking.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "fred-banking-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function observations(seriesId, date = "2026-07-11") {
  return { observations: [{ date, value: seriesId.length.toString() }] };
}

function makePaths(root) {
  const canonical = {};
  for (const group of FRED_BANKING_GROUPS) {
    canonical[group.id] = path.join(root, "data", "macro", `fred-banking-${group.id}.json`);
  }
  return {
    repoRoot: root,
    canonicalPaths: canonical,
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_banking.json"),
  };
}

function publicPathFor(root, groupId) {
  return path.join(root, "public", "data", "macro", `fred-banking-${groupId}.json`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const DAY_MS = 86_400_000;

function addDays(date, delta) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

function requestedDays(url) {
  const start = url.searchParams.get("observation_start");
  const end = url.searchParams.get("observation_end");
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS;
}

function assertValidShard(shard) {
  assert.equal(validateAttemptShard(shard, shard.lane_id), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
}

{
  assert.deepEqual(FRED_BANKING_GROUPS.map((group) => group.id), ["daily", "weekly", "monthly", "quarterly"]);
  const daily = FRED_BANKING_GROUPS.find((group) => group.id === "daily");
  const monthly = FRED_BANKING_GROUPS.find((group) => group.id === "monthly");
  const quarterly = FRED_BANKING_GROUPS.find((group) => group.id === "quarterly");
  const dailyIds = daily.series.map((row) => row.id);
  const monthlyIds = monthly.series.map((row) => row.id);
  assert.deepEqual(dailyIds, [
    "DGS10",
    "BAMLH0A0HYM2",
    "NASDAQCOM",
    "NASDAQXCMP",
  ]);
  assert.deepEqual(monthlyIds, [
    "IRLTLT01KRM156N",
  ]);
  assert.deepEqual(dailyIds.filter((id) => monthlyIds.includes(id)), [], "daily and monthly memberships must be disjoint");
  assert.deepEqual(quarterly.series.map((row) => row.id), [
    "DRALACBN",
    "DRCCLACBS",
    "DRCLACBS",
    "DRBLACBS",
    "DRCRELEXFACBS",
    "BOGZ1FL010000016Q",
    "CORALACBN",
    "CORCCACBS",
    "CORCACBS",
    "CORBLACBS",
    "CORCREXFACBS",
  ]);
  assert.equal(quarterly.days, 9999, "quarterly request lag remains explicit");
  assert.equal(FRED_NASDAQ_REQUEST_WINDOW.lookbackDays, 365);
  assert.equal(FRED_NASDAQ_REQUEST_WINDOW.freshnessMarginDays, 10);
  assert.equal(FRED_NASDAQ_REQUEST_WINDOW.nonTradingMarginDays, 7);
  assert.equal(FRED_NASDAQ_REQUEST_DAYS, 382);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-window-test-"));
  const paths = makePaths(root);
  const requested = new Map();
  const result = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (url, seriesId) => {
      requested.set(seriesId, new URL(url));
      return response(200, observations(seriesId));
    },
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-window-test",
    sleep: async () => {},
  });
  assert.equal(result.ok, true);

  const daily = FRED_BANKING_GROUPS.find((group) => group.id === "daily");
  const expectedDays = new Map(daily.series.map((series) => [series.id, series.requestDays ?? daily.days]));
  assert.deepEqual([...expectedDays.entries()], [
    ["DGS10", 9999],
    ["BAMLH0A0HYM2", 9999],
    ["NASDAQCOM", FRED_NASDAQ_REQUEST_DAYS],
    ["NASDAQXCMP", FRED_NASDAQ_REQUEST_DAYS],
  ]);
  assert.equal(requested.size, 4, "daily fetch must issue four requests");
  assert.equal(requested.has("IRLTLT01KRM156N"), false, "daily fetch must not request the monthly Korea series");
  for (const [seriesId, days] of expectedDays) {
    const url = requested.get(seriesId);
    assert.ok(url, `${seriesId} request was captured`);
    assert.equal(requestedDays(url), days, `${seriesId} request span`);
    assert.equal(url.searchParams.get("observation_start"), addDays("2026-07-14", -days));
    assert.equal(url.searchParams.get("observation_end"), "2026-07-14");
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-source-as-of-test-"));
  const paths = makePaths(root);
  const terminalDates = new Map([
    ["DGS10", "2026-07-14"],
    ["BAMLH0A0HYM2", "2026-07-13"],
    ["NASDAQCOM", "2026-07-12"],
    ["NASDAQXCMP", "2026-07-11"],
  ]);
  const calls = [];
  const result = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      calls.push(seriesId);
      return response(200, observations(seriesId, terminalDates.get(seriesId)));
    },
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-source-as-of-test",
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 4, "daily source_as_of must be based on four requests");
  assert.deepEqual([...new Set(calls)].sort(), [...terminalDates.keys()].sort());
  const daily = readJson(paths.canonicalPaths.daily);
  assert.equal(daily.source_as_of, "2026-07-11", "daily source_as_of follows the oldest terminal date among its four series");
  assert.deepEqual(Object.keys(daily.series).sort(), [...terminalDates.keys()].sort());
}

{
  // The bounded request must retain the exact anchor even when t-365 is a
  // weekend or an exchange holiday; this tests dates, not fitted output values.
  const scenarios = [
    {
      name: "Sunday target",
      observedAt: "2026-08-03",
      asOf: "2026-08-03",
      terminalDate: "2026-08-03",
      anchorDate: "2025-08-01",
    },
    {
      name: "Thanksgiving target",
      observedAt: "2026-11-30",
      asOf: "2026-11-30",
      terminalDate: "2026-11-27",
      anchorDate: "2025-11-26",
    },
  ];
  for (const scenario of scenarios) {
    assert.ok(
      addDays(scenario.observedAt, -FRED_NASDAQ_REQUEST_DAYS) <= scenario.anchorDate,
      `${scenario.name}: bounded start must include the prior trading-day anchor`,
    );
    const derived = deriveTrailingIndexDividendYield({
      totalReturnRows: [
        { date: scenario.anchorDate, value: 1000 },
        { date: scenario.terminalDate, value: 1100 },
      ],
      priceReturnRows: [
        { date: scenario.anchorDate, value: 100 },
        { date: scenario.terminalDate, value: 100 },
      ],
      asOf: scenario.asOf,
    });
    assert.equal(derived.ok, true, `${scenario.name}: exact one-year yield remains computable`);
    assert.equal(derived.date, scenario.terminalDate);
    assert.equal(derived.anchor_date, scenario.anchorDate);
    assert.ok(Math.abs(derived.value - 0.1) <= 1e-12, `${scenario.name}: yield formula result`);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-test-"));
  const paths = makePaths(root);
  const calls = [];
  const result = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      calls.push(seriesId);
      return response(200, observations(seriesId));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, FRED_BANKING_GROUPS.flatMap((group) => group.series.map((row) => row.id)));
  assert.equal(calls.length, 18, "all cadence groups must issue eighteen series requests");
  assert.equal(calls.filter((seriesId) => seriesId === "IRLTLT01KRM156N").length, 1, "Korea series remains monthly-only");
  for (const group of FRED_BANKING_GROUPS) {
    assert.equal(fs.existsSync(publicPathFor(root, group.id)), false, "a successful run must not create the public mirror file");
    assert.equal(readJson(paths.canonicalPaths[group.id]).type, group.id);
  }
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(shard.lane_id, "fred_banking");
  assert.equal(shard.attempts.length, 1, "four cadence artifacts still emit one lane attempt");
  const row = shard.attempts[0];
  assert.equal(row.member_id, null);
  assert.equal(row.http_status, 200);
  assert.equal(row.auth, "ok");
  assert.deepEqual(expectedAssertionIds("fred_banking"), ["observations_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fred_banking"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-worst-test-"));
  const paths = makePaths(root);
  for (const group of FRED_BANKING_GROUPS) {
    const publicPath = publicPathFor(root, group.id);
    fs.mkdirSync(path.dirname(paths.canonicalPaths[group.id]), { recursive: true });
    fs.mkdirSync(path.dirname(publicPath), { recursive: true });
    fs.writeFileSync(paths.canonicalPaths[group.id], `${JSON.stringify({ marker: `lkg-${group.id}` })}\n`);
    fs.writeFileSync(publicPath, `${JSON.stringify({ marker: `lkg-${group.id}` })}\n`);
  }
  const result = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      if (seriesId === "DGS10") return response(200, { observations: {} });
      if (seriesId === "DPSACBW027SBOG") return response(429, { error: "rate limit" });
      return response(200, observations(seriesId));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited", "unavailable must outrank drift");
  assert.equal(result.exitCode, 2, "systemic failure with invalid canonical artifacts is fatal");
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
  for (const group of FRED_BANKING_GROUPS) {
    assert.equal(readJson(paths.canonicalPaths[group.id]).marker, `lkg-${group.id}`);
    assert.equal(readJson(publicPathFor(root, group.id)).marker, `lkg-${group.id}`);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-source-binding-test-"));
  const paths = makePaths(root);
  await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fred-banking-binding-baseline",
    runId: "binding-baseline",
    sleep: async () => {},
  });
  const tampered = readJson(paths.canonicalPaths.daily);
  tampered.source_as_of = "2026-07-10";
  fs.writeFileSync(paths.canonicalPaths.daily, `${JSON.stringify(tampered, null, 2)}\n`);
  const failed = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "DGS10",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:00:00.000Z",
    attemptId: "fred-banking-binding-failure",
    runId: "binding-failure",
    sleep: async () => {},
  });
  assert.equal(failed.exitCode, 2, "declared source_as_of must match the payload series boundary before becoming LKG");
  assert.equal(failed.corrupt, true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-chaos-test-"));
  const paths = makePaths(root);
  const baselineCalls = [];
  const baseline = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      baselineCalls.push(seriesId);
      return response(200, observations(seriesId));
    },
    observedAt: "2026-07-14T11:00:00.000Z",
    attemptId: "fred-banking-baseline",
    runId: "baseline-run",
    sleep: async () => {},
  });
  assert.equal(baseline.ok, true);
  assert.equal(baselineCalls.length, 18, "recovery baseline must cover every owned series once");
  const failedCalls = [];
  const failed = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      failedCalls.push(seriesId);
      return response(200, observations(seriesId));
    },
    controlledFailureKey: "DGS10",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:00:00.000Z",
    attemptId: "fred-banking-controlled-failure",
    runId: "controlled-failure-run",
    sleep: async () => {},
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.equal(failedCalls.length, 17, "controlled daily failure must skip only DGS10 while retaining the monthly request");
  assert.equal(failedCalls.filter((seriesId) => seriesId === "IRLTLT01KRM156N").length, 1);
  assert.deepEqual(failed.retrySet, [
    "daily",
    "monthly",
    "quarterly",
    "weekly",
  ]);
  const statePath = path.join(root, "data", "admin", "fred_banking", "index.json");
  const state = readJson(statePath);
  assert.equal(state.items.daily.resolution_state, "lkg_primary");
  for (const key of failed.retrySet) {
    assert.equal(fs.existsSync(path.join(root, "data", "admin", "fred_banking", "lkg", `${key}.json`)), true);
  }

  const dailySeries = new Set(FRED_BANKING_GROUPS.find((group) => group.id === "daily").series.map((item) => item.id));
  const partial = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, dailySeries.has(seriesId) ? "2026-07-12" : "2026-07-11")),
    eventName: "workflow_dispatch",
    observedAt: "2026-07-14T12:30:00.000Z",
    attemptId: "fred-banking-partial-recovery",
    runId: "partial-recovery-run",
    sleep: async () => {},
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.degraded, true);
  assert.equal(partial.updated, false);
  assert.equal(partial.reason, "recovery_requires_schedule");
  assert.deepEqual(partial.retrySet, ["daily", "monthly", "quarterly", "weekly"]);
  const partialState = readJson(statePath);
  assert.equal(partialState.items.daily.resolution_state, "lkg_primary");
  assert.equal(partialState.items.monthly.resolution_state, "lkg_primary");
  assert.equal(partialState.items.weekly.resolution_state, "lkg_primary");
  assert.equal(partialState.items.quarterly.resolution_state, "lkg_primary");
  assert.equal(readJson(paths.canonicalPaths.daily).source_as_of, "2026-07-11", "manual recovery candidate must not overwrite canonical payload");

  const scheduledPartial = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, dailySeries.has(seriesId) ? "2026-07-12" : "2026-07-11")),
    eventName: "schedule",
    observedAt: "2026-07-14T12:45:00.000Z",
    attemptId: "fred-banking-scheduled-partial-recovery",
    runId: "scheduled-partial-recovery-run",
    sleep: async () => {},
  });
  assert.equal(scheduledPartial.ok, false);
  assert.equal(scheduledPartial.degraded, true);
  assert.equal(scheduledPartial.updated, true);
  assert.equal(scheduledPartial.recovered, true);
  assert.deepEqual(scheduledPartial.retrySet, ["monthly", "quarterly", "weekly"]);
  const scheduledPartialState = readJson(statePath);
  assert.equal(scheduledPartialState.items.daily.resolution_state, "fresh_primary");
  assert.equal(scheduledPartialState.items.daily.recovered_from_run_id, "controlled-failure-run");
  assert.equal(scheduledPartialState.items.monthly.resolution_state, "lkg_primary");

  const recovered = await runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId, "2026-07-12")),
    eventName: "schedule",
    observedAt: "2026-07-14T13:00:00.000Z",
    attemptId: "fred-banking-recovery",
    runId: "recovery-run",
    sleep: async () => {},
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  for (const key of failed.retrySet) {
    assert.equal(recoveredState.items[key].resolution_state, "fresh_primary");
    assert.equal(recoveredState.items[key].promotion_contract, "provider_observation/v2");
    assert.equal(recoveredState.items[key].recovered_from_run_id, "controlled-failure-run");
  }

  await assert.rejects(() => runFredBanking({
    ...paths,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "DGS10",
    eventName: "schedule",
    observedAt: "2026-07-14T14:00:00.000Z",
    attemptId: "fred-banking-invalid-chaos",
    runId: "invalid-chaos",
    sleep: async () => {},
  }), /workflow_dispatch/);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-controlled-membership-test-"));
  const paths = makePaths(root);
  await assert.rejects(() => runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async () => response(200, observations("IRLTLT01KRM156N")),
    controlledFailureKey: "IRLTLT01KRM156N",
    eventName: "workflow_dispatch",
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-daily-korea-controlled-failure",
    runId: "daily-korea-controlled-failure",
    sleep: async () => {},
  }), /unknown controlled FRED banking key/);

  let monthlyRequests = 0;
  const monthlyFailure = await runFredBanking({
    ...paths,
    type: "monthly",
    apiKey: "test-key",
    request: async () => {
      monthlyRequests += 1;
      return response(200, observations("IRLTLT01KRM156N"));
    },
    controlledFailureKey: "IRLTLT01KRM156N",
    eventName: "workflow_dispatch",
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-monthly-korea-controlled-failure",
    runId: "monthly-korea-controlled-failure",
    sleep: async () => {},
  });
  assert.equal(monthlyFailure.ok, false);
  assert.equal(monthlyFailure.reason, "controlled_failure", "monthly remains the valid controlled-failure owner");
  assert.equal(monthlyRequests, 0, "controlled monthly failure is injected before the provider request");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-diagnostic-"));
  const paths = makePaths(root);
  const secret = "fred-banking-secret-must-not-leak";
  const failed = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => {
      if (seriesId === "DGS10") {
        throw Object.assign(new Error(`socket reset token=${secret}`), { code: "ECONNRESET" });
      }
      return response(200, observations(seriesId));
    },
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-diagnostic",
    runId: "fred-banking-diagnostic",
    sleep: async () => {},
  });
  assert.equal(failed.reason, "transport_error", "reason enum must remain stable");
  assert.match(failed.failure_detail, /Error: socket reset/, "caught error identity must reach the run result");
  assert.match(failed.failure_detail, /token=\[redacted\]/, "diagnostic detail must redact secrets");
  assert.doesNotMatch(failed.failure_detail, new RegExp(secret), "diagnostic detail must not leak a secret");
  assert(failed.failure_detail.length <= 320, "diagnostic detail must stay bounded");
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(Object.hasOwn(shard.attempts[0], "failure_detail"), false, "attempt shard schema must remain unchanged");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-controlled-no-detail-"));
  const paths = makePaths(root);
  const failed = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, observations(seriesId)),
    controlledFailureKey: "DGS10",
    eventName: "workflow_dispatch",
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-controlled-no-detail",
    runId: "fred-banking-controlled-no-detail",
    sleep: async () => {},
  });
  assert.equal(failed.failure_detail ?? null, null, "controlled synthetic failures must not invent diagnostic detail");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-banking-missing-key-detail-"));
  const paths = makePaths(root);
  const failed = await runFredBanking({
    ...paths,
    type: "daily",
    apiKey: "",
    request: async () => {
      throw new Error("missing-key path must not call the provider");
    },
    observedAt: OBSERVED_AT,
    attemptId: "fred-banking-missing-key-detail",
    runId: "fred-banking-missing-key-detail",
    sleep: async () => {},
  });
  assert.equal(failed.reason, "unexpected_error", "missing credentials retain the stable reason enum");
  assert.equal(failed.failure_detail, "FRED API key is unavailable", "generic missing-key failure needs a safe cause");
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(Object.hasOwn(shard.attempts[0], "failure_detail"), false, "attempt shard schema must remain unchanged");
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fred-banking.yml"), "utf8");
  const producer = fs.readFileSync(new URL("./fetch-fred-banking.mjs", import.meta.url), "utf8");
  assert.match(producer, /diagnosticSuffix\(result\.failure_detail\)/, "CLI failures must append bounded diagnostic detail");
  assert.match(workflow, /node scripts\/test-fetch-fred-banking\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fred-banking\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.match(workflow, /detection-attempts\/fred_banking\.json/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.match(workflow, /data\/admin\/fred_banking\/index\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/daily\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/weekly\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/monthly\.json/);
  assert.match(workflow, /data\/admin\/fred_banking\/lkg\/quarterly\.json/);
  assert.match(workflow, /data\/macro\/fred-banking-monthly\.json/);
  assert.doesNotMatch(workflow, /100xfenok-next\/public\/data\/macro\/fred-banking/);
  assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflow, /--stage always_if_exists/);
  assert.match(workflow, /--stage success_if_exists/);
  assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
  assert.match(workflow, /- name: Commit and push owned FRED banking data\n\s+if: \$\{\{ always\(\) \}\}/);
}


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-fred-banking.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-fred-banking.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), ["fred_banking"].sort(), "registry lane attribution for this workflow");
}

console.log("test-fetch-fred-banking: ok");
