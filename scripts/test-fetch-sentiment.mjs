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
  cryptoSourceStamp,
  SENTIMENT_LKG_SOURCE_FILES,
  SENTIMENT_LKG_SOURCE_KEYS,
  recordSentimentAttemptTuple,
  runSentiment,
} from "./fetch-sentiment.mjs";
import { evaluateEndpointAssertions, returnedTuple } from "./lib/data-supply-attempt-shard.mjs";
import { checkWorkflowCommitShardsAgainstRegistry } from "./check-lane-registry-commit-shards.mjs";

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

assert.deepEqual(SENTIMENT_LKG_SOURCE_KEYS, ["cnn", "cftc", "vix", "move", "crypto"]);
assert.deepEqual(Object.keys(SENTIMENT_LKG_SOURCE_FILES), SENTIMENT_LKG_SOURCE_KEYS);
assert.equal(SENTIMENT_LKG_SOURCE_FILES.cnn.length, 8);
assert.deepEqual(cryptoSourceStamp("1784678400"), {
  source_as_of: "2026-07-22",
  source_as_of_reason: null,
});
assert.deepEqual(cryptoSourceStamp("not-a-timestamp"), {
  source_as_of: null,
  source_as_of_reason: "alternative.me data[0].timestamp is missing or invalid",
});
assert.deepEqual(cryptoSourceStamp(null), {
  source_as_of: null,
  source_as_of_reason: "alternative.me data[0].timestamp is missing or invalid",
});

function resultRow(file, date, value) {
  const array = [{ date, value }];
  return { file, array, action: "updated", before: 1, after: 1, sample: array[0], providerRows: [array[0]] };
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
  return SENTIMENT_LKG_SOURCE_KEYS.map((key, sourceIndex) => ({
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
    assert.equal(state.items[key].promotion_contract, "provider_observation/v2");
    assert.equal(fs.existsSync(path.join(root, "data", "admin", "sentiment", "current", `${key}.json`)), true);
  }
  assert.deepEqual(
    readJson(path.join(root, "data", "admin", "sentiment", "source-observations", "crypto.json")),
    {
      schema_version: "sentiment-source-observation/v1",
      source_key: "crypto",
      source_as_of: "2026-07-14",
      source_as_of_reason: null,
      observed_at: "2026-07-14T22:00:00.000Z",
      run_id: "baseline-run",
      run_attempt: 1,
      event_name: "workflow_dispatch",
    },
  );
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
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-foreign-writer-"));
  await runCase(root);
  await runCase(root, {
    date: "2026-07-15",
    controlledFailureSource: "vix",
    runId: "foreign-chaos-run",
    observedAt: "2026-07-15T22:00:00.000Z",
  });
  const canonicalVix = path.join(root, "data", "sentiment", "vix.json");
  const publicVix = path.join(root, "public", "data", "sentiment", "vix.json");
  const foreignRows = [...readJson(canonicalVix), { date: "2026-07-16", value: 99 }];
  const foreignBytes = `${JSON.stringify(foreignRows, null, 2)}\n`;
  fs.writeFileSync(canonicalVix, foreignBytes);
  fs.writeFileSync(publicVix, foreignBytes);

  const conflict = await runCase(root, {
    date: "2026-07-15",
    eventName: "schedule",
    runId: "foreign-schedule-run",
    observedAt: "2026-07-16T22:00:00.000Z",
    overrides: {
      vix: async () => {
        recordSentimentAttemptTuple(READY_TUPLE);
        const providerRow = { date: "2026-07-15", value: 17 };
        return [{
          file: "vix.json",
          array: [...foreignRows, providerRow].sort((a, b) => a.date.localeCompare(b.date)),
          action: "appended",
          before: foreignRows.length,
          after: foreignRows.length + 1,
          sample: providerRow,
          providerRows: [providerRow],
        }];
      },
    },
  });
  assert.equal(conflict.reason, "foreign_writer_conflict");
  assert.equal(conflict.degraded, true);
  assert.equal(conflict.corrupt, false);
  assert.equal(conflict.exitCode, 0);
  assert.deepEqual(conflict.retrySet, ["vix"]);
  assert.equal(fs.readFileSync(canonicalVix, "utf8"), foreignBytes, "foreign canonical must not be overwritten");
  assert.equal(fs.readFileSync(publicVix, "utf8"), foreignBytes);
  const state = readJson(path.join(root, "data", "admin", "sentiment", "index.json"));
  assert.equal(state.items.vix.resolution_state, "lkg_primary");
  assert.equal(state.items.vix.latest_failure.run_id, "foreign-chaos-run", "deferral preserves failure lineage");
  assert.equal(state.items.vix.latest_promotion_deferral.reason, "foreign_writer_conflict");
  assert.equal(state.items.vix.latest_promotion_deferral.run_id, "foreign-schedule-run");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-cross-key-"));
  await runCase(root);
  await runCase(root, { controlledFailureSource: "cnn", runId: "chaos-cnn" });
  await runCase(root, { controlledFailureSource: "cftc", runId: "chaos-cftc" });
  const partial = await runCase(root, {
    date: "2026-07-15",
    eventName: "schedule",
    runId: "cross-key-schedule",
    observedAt: "2026-07-15T22:00:00.000Z",
    overrides: {
      cftc: async () => {
        recordSentimentAttemptTuple(READY_TUPLE);
        return [resultRow("cftc-sp500.json", "2026-07-14", 10)];
      },
    },
  });
  assert.equal(partial.degraded, true);
  assert.deepEqual(partial.recoveredSources, ["cnn"], "one key may recover without laundering another key");
  assert.deepEqual(partial.retrySet, ["cftc"]);
  const state = readJson(path.join(root, "data", "admin", "sentiment", "index.json"));
  assert.equal(state.items.cnn.resolution_state, "fresh_primary");
  assert.equal(state.items.cnn.recovered_from_run_id, "chaos-cnn");
  assert.equal(state.items.cftc.resolution_state, "lkg_primary");
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-sentiment-crypto-dateless-"));
  await runCase(root);
  const canonicalCrypto = path.join(root, "data", "sentiment", "crypto-fear-greed.json");
  const before = fs.readFileSync(canonicalCrypto, "utf8");
  const sourceAsOfReason = "alternative.me data[0].timestamp is missing or invalid";
  const failed = await runCase(root, {
    date: "2026-07-15",
    runId: "crypto-invalid-timestamp",
    observedAt: "2026-07-15T22:00:00.000Z",
    overrides: {
      crypto: async () => {
        recordSentimentAttemptTuple({
          ...READY_TUPLE,
          assertions: [{ id: "series_array", passed: false }],
        });
        throw Object.assign(new Error(sourceAsOfReason), {
          sourceAsOf: null,
          sourceAsOfReason,
        });
      },
    },
  });
  assert.equal(failed.reason, "schema_drift");
  assert.equal(failed.corrupt, true);
  assert.equal(fs.readFileSync(canonicalCrypto, "utf8"), before, "invalid provider time must not append a fetch-day row");
  assert.deepEqual(
    failed.sourceOutcomes.find((row) => row.key === "crypto"),
    {
      key: "crypto",
      status: "failed",
      reason: "schema_drift",
      source_as_of: null,
      source_as_of_reason: sourceAsOfReason,
    },
  );
  const state = readJson(path.join(root, "data", "admin", "sentiment", "index.json"));
  assert.equal(state.items.crypto.resolution_state, "lkg_primary");
  assert.equal(state.items.crypto.retry, true);
  assert.equal(fs.existsSync(path.join(root, "data", "admin", "sentiment", "lkg", "crypto.json")), true);
  assert.deepEqual(
    readJson(path.join(root, "data", "admin", "sentiment", "source-observations", "crypto.json")),
    {
      schema_version: "sentiment-source-observation/v1",
      source_key: "crypto",
      source_as_of: null,
      source_as_of_reason: sourceAsOfReason,
      observed_at: "2026-07-15T22:00:00.000Z",
      run_id: "crypto-invalid-timestamp",
      run_attempt: 1,
      event_name: "workflow_dispatch",
    },
  );
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
  assert.match(workflow, /data\/admin\/sentiment\/source-observations\/crypto\.json/);
  assert.match(workflow, /scripts\/stage-lane-manifest\.sh/);
  assert.match(workflow, /--stage always_if_exists/);
  assert.match(workflow, /--stage success_if_exists/);
  assert.match(workflow, /FETCH_OUTCOME.*success[\s\S]*--stage success_if_exists/);
  assert.match(workflow, /- name: Commit sentiment data\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /git add -A/);
}


// Lane Registry ⇄ commit-shard completeness gate (#366 step 4).
{
  const workflowText = fs.readFileSync(new URL("../.github/workflows/fetch-sentiment.yml", import.meta.url), "utf8");
  const gate = checkWorkflowCommitShardsAgainstRegistry({
    workflowText,
    workflowRel: ".github/workflows/fetch-sentiment.yml",
  });
  assert.deepEqual(gate.missing_in_workflow, [],
    `declared shards the workflow never commits: ${JSON.stringify(gate.missing_in_workflow)}`);
  assert.deepEqual(gate.undeclared_in_workflow, [],
    `allowlist paths with no registry record: ${JSON.stringify(gate.undeclared_in_workflow)}`);
  assert.deepEqual(gate.lanes.sort(), ["sentiment"].sort(), "registry lane attribution for this workflow");
}

console.log("test-fetch-sentiment: ok");
