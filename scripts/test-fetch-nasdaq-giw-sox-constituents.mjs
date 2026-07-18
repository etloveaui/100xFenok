#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { runNasdaqGiwSox, rotateSoxSnapshotHistory, retainLatestSnapshotDates, soxHistoryPathFor, validSoxHistory, SOX_PERSISTENCE_POLICY } from "./fetch-nasdaq-giw-sox-constituents.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OBSERVED_AT = "2026-07-16T02:00:00.000Z";
const DATES = ["2026-07-16", "2026-07-15"];

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function weightingPayload(prefix = "SOX", count = 30) {
  return {
    aaData: Array.from({ length: count }, (_, index) => ({
      Symbol: `${prefix}${String(index + 1).padStart(2, "0")}`,
      Name: `Company ${index + 1}`,
    })),
  };
}

function makePaths(root) {
  return {
    repoRoot: root,
    canonicalPath: path.join(root, "data", "indices", "nasdaq-giw-sox-constituents.json"),
    publicPath: path.join(root, "public", "data", "indices", "nasdaq-giw-sox-constituents.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "nasdaq_giw_sox.json"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function expectedAssertionIds() {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === "nasdaq_giw_sox");
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function assertValidShard(filePath) {
  const shard = readJson(filePath);
  assert.equal(validateAttemptShard(shard, "nasdaq_giw_sox"), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  return shard.attempts[0];
}

async function seedBaseline(paths, { asOf = DATES[1], prefix = "BASE", runId = "baseline-run" } = {}) {
  const result = await runNasdaqGiwSox({
    ...paths,
    dates: [asOf],
    request: async () => response(200, weightingPayload(prefix)),
    observedAt: "2026-07-16T01:00:00.000Z",
    attemptId: `${runId}-attempt`,
    runId,
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(result.ok, true);
  return fs.readFileSync(paths.canonicalPath);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-ready-"));
  const paths = makePaths(root);
  const result = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: async (_url, tradeDate) => tradeDate === DATES[0]
      ? response(200, { aaData: [] })
      : response(200, weightingPayload()),
    observedAt: OBSERVED_AT,
    attemptId: "sox-ready-attempt",
    runId: "sox-ready-run",
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.asOf, DATES[1]);
  assert.equal(readJson(paths.canonicalPath).row_count, 30);
  const attempt = assertValidShard(paths.attemptShardPath);
  assert.equal(attempt.http_status, 200);
  assert.deepEqual(expectedAssertionIds(), ["weighting_rows_array"]);
  assert.deepEqual(attempt.assertions.map((row) => row.id), expectedAssertionIds());
  assert.equal(attempt.assertions.every((row) => row.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-single-key-transient-"));
  const paths = makePaths(root);
  const canonicalBefore = await seedBaseline(paths);

  // SOX is one logical artifact, not a bundle of independent series. Therefore
  // an all-lookback 5xx/network ratio carries no corruption signal: with a
  // valid LKG it must degrade and retain provenance instead of exiting fatal.
  const failed = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: async () => response(503, { error: "upstream unavailable" }),
    observedAt: OBSERVED_AT,
    attemptId: "sox-all-transient-attempt",
    runId: "sox-all-transient-run",
    eventName: "workflow_dispatch",
    publicMirror: false,
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "http_error");
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["constituents"]);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBefore);
  const state = readJson(path.join(root, "data", "admin", "nasdaq_giw_sox", "index.json"));
  assert.equal(state.items.constituents.resolution_state, "lkg_primary");
  assert.equal(state.items.constituents.latest_failure.run_id, "sox-all-transient-run");
  assert.deepEqual(
    fs.readFileSync(path.join(root, "data", "admin", "nasdaq_giw_sox", "lkg", "constituents.json")),
    canonicalBefore,
  );

  const networkFailed = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }); },
    observedAt: "2026-07-16T02:05:00.000Z",
    attemptId: "sox-network-attempt",
    runId: "sox-network-run",
    eventName: "workflow_dispatch",
    publicMirror: false,
  });
  assert.equal(networkFailed.reason, "transport_error");
  assert.equal(networkFailed.exitCode, 0);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-controlled-chaos-"));
  const paths = makePaths(root);
  const canonicalBefore = await seedBaseline(paths, { runId: "controlled-chaos-baseline" });
  let requestCalls = 0;
  const failed = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: async () => {
      requestCalls += 1;
      return response(200, weightingPayload());
    },
    controlledFailureKey: "constituents",
    eventName: "workflow_dispatch",
    observedAt: "2026-07-16T02:07:00.000Z",
    attemptId: "sox-controlled-chaos-attempt",
    runId: "sox-controlled-chaos-run",
    publicMirror: false,
  });
  assert.equal(requestCalls, 0, "dispatch chaos must not call the provider");
  assert.equal(failed.reason, "controlled_failure");
  assert.equal(failed.degraded, true);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["constituents"]);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBefore);
  const attempt = assertValidShard(paths.attemptShardPath);
  assert.equal(attempt.execution, "threw");
  assert.equal(attempt.exception_kind, "transport");
}

for (const failureCase of [
  { id: "auth", expected: "auth_error", request: async () => response(401, { error: "unauthorized" }) },
  { id: "rate", expected: "rate_limited", request: async () => response(429, { error: "rate limit" }) },
  { id: "client-http", expected: "http_error", request: async () => response(400, { error: "bad request" }) },
  { id: "decode", expected: "decode_error", request: async () => response(200, "not-json") },
  {
    id: "contaminated",
    expected: "schema_drift",
    request: async () => response(200, {
      aaData: Array.from({ length: 30 }, (_, index) => ({ Symbol: index === 29 ? "" : `BAD${index}`, Name: `Company ${index}` })),
    }),
  },
  {
    id: "normalized-duplicate",
    expected: "schema_drift",
    request: async () => response(200, {
      aaData: Array.from({ length: 30 }, (_, index) => ({
        Symbol: index === 29 ? " bad0 " : `BAD${index}`,
        Name: `Company ${index}`,
      })),
    }),
  },
]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fetch-sox-${failureCase.id}-`));
  const paths = makePaths(root);
  const canonicalBefore = await seedBaseline(paths, { runId: `${failureCase.id}-baseline` });
  const failed = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: failureCase.request,
    observedAt: OBSERVED_AT,
    attemptId: `sox-${failureCase.id}-attempt`,
    runId: `sox-${failureCase.id}-run`,
    eventName: "workflow_dispatch",
    publicMirror: false,
  });
  assert.equal(failed.reason, failureCase.expected, failureCase.id);
  assert.equal(failed.corrupt, true, failureCase.id);
  assert.equal(failed.exitCode, 2, failureCase.id);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBefore, failureCase.id);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-no-lkg-"));
  const paths = makePaths(root);
  const failed = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: async () => response(500, { error: "upstream" }),
    observedAt: OBSERVED_AT,
    attemptId: "sox-no-lkg-attempt",
    runId: "sox-no-lkg-run",
    eventName: "workflow_dispatch",
    publicMirror: false,
  });
  assert.equal(failed.reason, "http_error");
  assert.equal(failed.exitCode, 2);
  assert.equal(failed.corrupt, true);
  assert.deepEqual(failed.retrySet, ["constituents"]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-source-regression-"));
  const paths = makePaths(root);
  const canonicalBefore = await seedBaseline(paths, { asOf: "2026-07-16", runId: "source-regression-baseline" });
  const regressed = await runNasdaqGiwSox({
    ...paths,
    dates: ["2026-07-15"],
    request: async () => response(200, weightingPayload("OLDER")),
    observedAt: "2026-07-16T02:08:00.000Z",
    attemptId: "sox-source-regression-attempt",
    runId: "sox-source-regression-run",
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(regressed.reason, "source_regression");
  assert.equal(regressed.degraded, true);
  assert.equal(regressed.exitCode, 0);
  assert.deepEqual(regressed.retrySet, ["constituents"]);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBefore, "older provider source cannot overwrite canonical");
  const state = readJson(path.join(root, "data", "admin", "nasdaq_giw_sox", "index.json"));
  assert.equal(state.items.constituents.lkg.source_as_of, "2026-07-16");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-recovery-"));
  const paths = makePaths(root);
  await seedBaseline(paths, { asOf: "2026-07-15", runId: "recovery-baseline" });
  await runNasdaqGiwSox({
    ...paths,
    dates: ["2026-07-15"],
    request: async () => response(503, { error: "upstream" }),
    observedAt: "2026-07-16T02:10:00.000Z",
    attemptId: "sox-recovery-failure-attempt",
    runId: "sox-recovery-failure-run",
    eventName: "workflow_dispatch",
    publicMirror: false,
  });
  const canonicalBeforeRecovery = fs.readFileSync(paths.canonicalPath);

  const manualAdvanced = await runNasdaqGiwSox({
    ...paths,
    dates: ["2026-07-16"],
    request: async () => response(200, weightingPayload("NEW")),
    observedAt: "2026-07-16T02:20:00.000Z",
    attemptId: "sox-manual-recovery-attempt",
    runId: "sox-manual-recovery-run",
    eventName: "workflow_dispatch",
    publicMirror: false,
  });
  assert.equal(manualAdvanced.reason, "recovery_requires_schedule");
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBeforeRecovery);

  const retryAttemptAdvanced = await runNasdaqGiwSox({
    ...paths,
    dates: ["2026-07-16"],
    request: async () => response(200, weightingPayload("RETRY")),
    observedAt: "2026-07-16T02:25:00.000Z",
    attemptId: "sox-retry-attempt-recovery",
    runId: "sox-retry-attempt-run",
    runAttempt: 2,
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(retryAttemptAdvanced.reason, "recovery_requires_schedule");
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBeforeRecovery);

  const sameSource = await runNasdaqGiwSox({
    ...paths,
    dates: ["2026-07-15"],
    request: async () => response(200, weightingPayload("SAME")),
    observedAt: "2026-07-16T02:30:00.000Z",
    attemptId: "sox-same-source-attempt",
    runId: "sox-same-source-run",
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), canonicalBeforeRecovery);

  const recovered = await runNasdaqGiwSox({
    ...paths,
    dates: ["2026-07-16"],
    request: async () => response(200, weightingPayload("NEW")),
    observedAt: "2026-07-16T02:40:00.000Z",
    attemptId: "sox-natural-recovery-attempt",
    runId: "sox-natural-recovery-run",
    runAttempt: 1,
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const state = readJson(path.join(root, "data", "admin", "nasdaq_giw_sox", "index.json"));
  assert.deepEqual(state.retry_set, []);
  assert.equal(state.items.constituents.resolution_state, "fresh_primary");
  assert.equal(state.items.constituents.promotion_contract, "provider_observation/v2");
  assert.equal(state.items.constituents.recovered_from_run_id, "sox-recovery-failure-run");
  assert.equal(state.items.constituents.recovery_run_id, "sox-natural-recovery-run");
  assert.equal(state.items.constituents.recovery_event_name, "schedule");
}

await assert.rejects(() => runNasdaqGiwSox({
  ...makePaths(fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-invalid-chaos-"))),
  dates: DATES,
  request: async () => response(200, weightingPayload()),
  controlledFailureKey: "constituents",
  eventName: "schedule",
  observedAt: OBSERVED_AT,
  attemptId: "sox-invalid-chaos-attempt",
  runId: "sox-invalid-chaos-run",
  publicMirror: false,
}), /workflow_dispatch/);

// --- Bounded persistence (P): bounded dated-snapshot sidecar -----------------
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sox-history-"));
  const paths = makePaths(root);
  const seed = await runNasdaqGiwSox({
    ...paths,
    dates: DATES,
    request: async () => response(200, weightingPayload("SOX")),
    observedAt: OBSERVED_AT,
    attemptId: "sox-history-seed-attempt",
    runId: "sox-history-seed-run",
    eventName: "schedule",
    publicMirror: false,
  });
  assert.equal(seed.ok, true);
  assert.equal(seed.history.entries_retained, 1, "a fresh-primary promotion rotates the sidecar");
  const historyFile = soxHistoryPathFor(root);
  assert.equal(validSoxHistory(readJson(historyFile)), true);

  // cap enforcement + eviction order: 105 distinct dates -> newest 100 retained.
  const base = readJson(paths.canonicalPath);
  const payloadAt = (date) => ({ ...base, as_of: date, generated_at: `${date}T02:00:00.000Z` });
  const dateAt = (index) => new Date(Date.UTC(2025, 0, 1) + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const entries = [];
  for (let index = 0; index < 105; index += 1) {
    entries.push(rotateSoxSnapshotHistory({ repoRoot: root, payload: payloadAt(dateAt(index)), generatedAt: `${dateAt(index)}T03:00:00Z` }).history.entries[0]
      ?? null);
  }
  const history = readJson(historyFile);
  assert.equal(history.entries.length, 100, "sidecar is bounded at the cap");
  assert.equal(history.entries[0].as_of, "2026-07-16", "the seed date is the newest of the 106 distinct dates");
  assert.equal(history.entries.some((entry) => entry.as_of === dateAt(5)), false, "oldest dates evicted first (106 -> 100)");
  assert.equal(history.entries.some((entry) => entry.as_of === dateAt(6)), true);
  assert.equal(history.persistence_policy.max_distinct_source_dates, 100);

  // sparse history is never pruned; duplicate dates collapse (idempotent).
  const sparse = retainLatestSnapshotDates(history.entries.slice(0, 3));
  assert.equal(sparse.entries.length, 3);
  assert.equal(sparse.stats.pruned, 0);
  const dupe = rotateSoxSnapshotHistory({
    repoRoot: root,
    payload: { ...payloadAt(dateAt(104)), generated_at: `${dateAt(104)}T04:00:00Z` },
    generatedAt: `${dateAt(104)}T04:00:00Z`,
  });
  assert.equal(dupe.history.entries.length, 100, "re-rotating the same date replaces, never duplicates");
  assert.equal(dupe.history.entries.find((entry) => entry.as_of === dateAt(104))?.snapshot.generated_at, `${dateAt(104)}T04:00:00Z`);

  // malformed entries and corrupt history fail closed.
  assert.throws(() => retainLatestSnapshotDates([{ as_of: "not-a-date" }]), /invalid SOX history entry/);
  assert.throws(() => retainLatestSnapshotDates([], { max_distinct_source_dates: 0 }), /invalid SOX persistence/);
  fs.writeFileSync(historyFile, "{corrupt", "utf8");
  assert.throws(
    () => rotateSoxSnapshotHistory({ repoRoot: root, payload: payloadAt("2026-01-01"), generatedAt: "2026-01-01T00:00:00Z" }),
    /corrupt/,
    "a corrupt existing history must fail closed instead of dropping dates",
  );
  assert.equal(SOX_PERSISTENCE_POLICY.max_distinct_source_dates, 100);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-nasdaq-giw-sox.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-nasdaq-giw-sox-constituents\.mjs/);
  assert.match(workflow, /controlled_failure_key/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_KEY/);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/);
  assert.match(workflow, /detection-attempts\/nasdaq_giw_sox\.json/);
  assert.match(workflow, /data\/admin\/nasdaq_giw_sox\/index\.json/);
  assert.match(workflow, /data\/admin\/nasdaq_giw_sox\/lkg\/constituents\.json/);
  assert.doesNotMatch(workflow, /git add -A/);
  assert.doesNotMatch(workflow, /public\/data\/indices\/nasdaq-giw-sox-constituents\.json/);
}


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-nasdaq-giw-sox.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-nasdaq-giw-sox.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), ["nasdaq_giw_sox"].sort(), "registry lane attribution for this workflow");
}

console.log("test-fetch-nasdaq-giw-sox-constituents: ok");
