#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  buildSentimentDetectionDocument,
  SENTIMENT_LKG_SOURCE_FILES,
  SENTIMENT_LKG_SOURCE_KEYS,
  recordSentimentAttemptTuple,
  runSentiment,
} from "./fetch-sentiment.mjs";
import { evaluateEndpointAssertions, returnedTuple } from "./lib/data-supply-attempt-shard.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const READY_TUPLE = {
  execution: "returned",
  exception_kind: null,
  http_status: 200,
  auth: "not_applicable",
  rate_limited: false,
  decode: "ok",
  payload: "non_empty",
  assertions: [],
};

assert.deepEqual(SENTIMENT_LKG_SOURCE_KEYS, ["cnn", "cftc", "vix", "move"]);
assert.deepEqual(Object.keys(SENTIMENT_LKG_SOURCE_FILES), SENTIMENT_LKG_SOURCE_KEYS);
assert.equal(SENTIMENT_LKG_SOURCE_FILES.cnn.length, 8);

function resultRow(file, date, value) {
  const array = [{ date, value }];
  return { file, array, action: "updated", before: 1, after: 1, sample: array[0] };
}

{
  const valid = buildSentimentDetectionDocument([
    { sourceKey: "vix", results: [resultRow("vix.json", "2026-07-14", 16.5)] },
  ]);
  assert.deepEqual(evaluateEndpointAssertions("sentiment", valid), [{ id: "series_array", passed: true }]);

  for (const broken of [
    [],
    [{ sourceKey: "vix", results: [] }],
    [{ sourceKey: "vix", results: [{ ...resultRow("vix.json", "2026-07-14", 16.5), array: [] }] }],
    [{ sourceKey: "vix", results: [{ ...resultRow("vix.json", "2026-07-14", 16.5), array: [{ value: 16.5 }] }] }],
    [{ sourceKey: "vix", results: [{ ...resultRow("vix.json", "2026-07-14", 16.5), array: [{ date: "2026-07-14" }] }] }],
    [{ sourceKey: "vix", results: [{ ...resultRow("vix.json", "2026-07-14", 16.5), array: [{ date: "2026-07-14", value: null }] }] }],
  ]) {
    assert.deepEqual(evaluateEndpointAssertions("sentiment", buildSentimentDetectionDocument(broken)), [
      { id: "series_array", passed: false },
    ]);
  }
}

function sourceDescriptors(date, overrides = {}) {
  const lkgSources = SENTIMENT_LKG_SOURCE_KEYS.map((key, sourceIndex) => ({
    key,
    label: key.toUpperCase(),
    fileNames: SENTIMENT_LKG_SOURCE_FILES[key],
    lkg: true,
    run: async () => {
      if (overrides[key]) return overrides[key]();
      recordSentimentAttemptTuple(READY_TUPLE);
      return SENTIMENT_LKG_SOURCE_FILES[key].map((file, fileIndex) => resultRow(file, date, sourceIndex * 10 + fileIndex));
    },
  }));
  return [
    ...lkgSources,
    {
      key: "crypto",
      label: "CRYPTO",
      fileNames: ["crypto-fear-greed.json"],
      lkg: false,
      run: async () => {
        if (overrides.crypto) return overrides.crypto();
        recordSentimentAttemptTuple(READY_TUPLE);
        return [resultRow("crypto-fear-greed.json", date, 50)];
      },
    },
  ];
}

function makePaths(root) {
  return {
    repoRoot: root,
    outputDirs: [path.join(root, "data", "sentiment"), path.join(root, "public", "data", "sentiment")],
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "sentiment.json"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function runCase(root, {
  date = "2026-07-14",
  overrides = {},
  eventName = "workflow_dispatch",
  controlledFailureSource = "",
  runId = "baseline-run",
  runAttempt = 1,
  observedAt = "2026-07-14T22:00:00.000Z",
} = {}) {
  return runSentiment({
    ...makePaths(root),
    sources: sourceDescriptors(date, overrides),
    eventName,
    controlledFailureSource,
    runId,
    runAttempt,
    observedAt,
    attemptId: `sentiment-${runId}`,
    quiet: true,
  });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-baseline-"));
  const result = await runCase(root);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  const shard = readJson(makePaths(root).attemptShardPath);
  assert.equal(validateAttemptShard(shard, "sentiment"), true);
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "series_array", passed: true }]);
  const state = readJson(path.join(root, "data", "admin", "sentiment", "index.json"));
  assert.deepEqual(state.retry_set, []);
  assert.deepEqual(Object.keys(state.items), SENTIMENT_LKG_SOURCE_KEYS);
  for (const key of SENTIMENT_LKG_SOURCE_KEYS) {
    assert.equal(state.items[key].resolution_state, "fresh_primary");
    assert.equal(state.items[key].retry, false);
    assert.equal(fs.existsSync(path.join(root, "data", "admin", "sentiment", "current", `${key}.json`)), true);
  }
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-chaos-"));
  await runCase(root);
  const canonicalVix = path.join(root, "data", "sentiment", "vix.json");
  const publicVix = path.join(root, "public", "data", "sentiment", "vix.json");
  const before = fs.readFileSync(canonicalVix, "utf8");

  const failed = await runCase(root, {
    date: "2026-07-15",
    controlledFailureSource: "vix",
    runId: "chaos-run",
    observedAt: "2026-07-15T22:00:00.000Z",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["vix"]);
  assert.equal(fs.readFileSync(canonicalVix, "utf8"), before);
  assert.equal(fs.readFileSync(publicVix, "utf8"), before);

  const statePath = path.join(root, "data", "admin", "sentiment", "index.json");
  const lkgPath = path.join(root, "data", "admin", "sentiment", "lkg", "vix.json");
  const retained = readJson(statePath);
  assert.equal(retained.items.vix.resolution_state, "lkg_primary");
  assert.equal(retained.items.vix.latest_failure.run_id, "chaos-run");
  assert.equal(retained.items.vix.lkg.payload_sha256, createHash("sha256").update(fs.readFileSync(lkgPath)).digest("hex"));

  const manual = await runCase(root, {
    date: "2026-07-15",
    runId: "manual-run",
    observedAt: "2026-07-15T23:00:00.000Z",
  });
  assert.equal(manual.ok, false);
  assert.equal(manual.reason, "recovery_requires_schedule");
  assert.equal(fs.readFileSync(canonicalVix, "utf8"), before, "dispatch must not promote a recovery candidate");

  const sameSource = await runCase(root, {
    eventName: "schedule",
    runId: "same-source-run",
    observedAt: "2026-07-16T00:00:00.000Z",
  });
  assert.equal(sameSource.ok, false);
  assert.equal(sameSource.reason, "recovery_not_advanced");
  assert.equal(fs.readFileSync(canonicalVix, "utf8"), before);

  const recovered = await runCase(root, {
    date: "2026-07-15",
    eventName: "schedule",
    runId: "scheduled-recovery-run",
    observedAt: "2026-07-16T22:00:00.000Z",
  });
  assert.equal(recovered.ok, true);
  assert.deepEqual(recovered.recoveredSources, ["vix"]);
  const recoveredState = readJson(statePath);
  assert.deepEqual(recoveredState.retry_set, []);
  assert.equal(recoveredState.items.vix.resolution_state, "fresh_primary");
  assert.equal(recoveredState.items.vix.recovered_from_run_id, "chaos-run");
  assert.equal(recoveredState.items.vix.recovery_event_name, "schedule");
  assert.equal(readJson(canonicalVix).at(-1).date, "2026-07-15");

  await assert.rejects(() => runCase(root, {
    controlledFailureSource: "cnn",
    eventName: "schedule",
    runId: "invalid-schedule-chaos",
  }), /workflow_dispatch/);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-no-lkg-"));
  const failed = await runCase(root, {
    controlledFailureSource: "vix",
    runId: "no-lkg-chaos",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.corrupt, true);
  assert.equal(failed.exitCode, 2, "controlled failure without retained source data is corruption");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-systemic-"));
  await runCase(root);
  const canonicalVix = path.join(root, "data", "sentiment", "vix.json");
  const before = fs.readFileSync(canonicalVix, "utf8");
  const failed = await runCase(root, {
    runId: "decode-failure",
    observedAt: "2026-07-15T22:00:00.000Z",
    overrides: {
      vix: async () => {
        recordSentimentAttemptTuple(returnedTuple({ httpStatus: 200, decode: "error" }));
        throw new Error("decode failed");
      },
    },
  });
  assert.equal(failed.reason, "decode_error");
  assert.equal(failed.corrupt, true);
  assert.equal(failed.exitCode, 2, "systemic source corruption stays fatal even with LKG");
  assert.equal(fs.readFileSync(canonicalVix, "utf8"), before);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-multi-retry-"));
  await runCase(root);
  let latest;
  for (const key of SENTIMENT_LKG_SOURCE_KEYS) {
    latest = await runCase(root, {
      controlledFailureSource: key,
      runId: `chaos-${key}`,
      observedAt: "2026-07-15T22:00:00.000Z",
    });
  }
  assert.equal(latest.degraded, true);
  assert.equal(latest.corrupt, false);
  assert.equal(latest.exitCode, 0, "recovery deferrals are not a natural-request systemic outage");
  assert.deepEqual(latest.retrySet, SENTIMENT_LKG_SOURCE_KEYS.slice().sort());

  const retryAttempt = await runCase(root, {
    date: "2026-07-15",
    eventName: "schedule",
    runAttempt: 2,
    runId: "schedule-retry-attempt-2",
    observedAt: "2026-07-16T22:00:00.000Z",
  });
  assert.equal(retryAttempt.degraded, true);
  assert.equal(retryAttempt.corrupt, false);
  assert.equal(retryAttempt.exitCode, 0, "schedule retry attempts cannot promote but remain degraded");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-false-green-"));
  const result = await runCase(root, {
    overrides: {
      cnn: async () => SENTIMENT_LKG_SOURCE_FILES.cnn.map((file, index) => resultRow(file, "2026-07-14", index)),
    },
  });
  assert.equal(result.ok, false);
  assert.equal(readJson(makePaths(root).attemptShardPath).attempts[0].execution, "threw");
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-sentiment.yml"), "utf8");
  assert.match(workflow, /controlled_failure_source/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_SOURCE/);
  assert.match(workflow, /data\/admin\/sentiment\/index\.json/);
  assert.match(workflow, /data\/admin\/sentiment\/current\/\*\.json/);
  assert.match(workflow, /data\/admin\/sentiment\/lkg\/\*\.json/);
  assert.match(workflow, /- name: Commit sentiment data\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /git add -A/);
}

console.log("test-fetch-sentiment: ok");
