#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  DEFILLAMA_ENDPOINTS,
  DEFILLAMA_LANE_ID,
  runDefillama,
} from "./fetch-defillama.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function chart(date = "2026-07-16", value = 305_000_000_000) {
  return [{
    date: Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000),
    totalCirculating: { peggedUSD: value },
  }];
}

function stablecoins() {
  return { peggedAssets: [{ id: "1", name: "Tether", symbol: "USDT" }] };
}

function paths(root) {
  return {
    repoRoot: root,
    canonicalPath: path.join(root, "data", "macro", "stablecoins.json"),
    publicPath: path.join(root, "public", "data", "macro", "stablecoins.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", `${DEFILLAMA_LANE_ID}.json`),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function runCase(root, {
  chartDate = "2026-07-16",
  request,
  eventName = "workflow_dispatch",
  controlledFailureEndpoint = "",
  runId = "baseline-run",
  runAttempt = 1,
  observedAt = "2026-07-16T04:00:00.000Z",
} = {}) {
  return runDefillama({
    ...paths(root),
    request: request ?? (async (_url, endpoint) => (
      endpoint === "chart" ? response(200, chart(chartDate)) : response(200, stablecoins())
    )),
    eventName,
    controlledFailureEndpoint,
    runId,
    runAttempt,
    observedAt,
    attemptId: `defillama-${runId}`,
    sleep: async () => {},
  });
}

{
  assert.deepEqual(DEFILLAMA_ENDPOINTS.map((row) => row.key), ["chart", "stablecoins"]);
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === DEFILLAMA_LANE_ID);
  assert.ok(lane, "DefiLlama must be registered in the detection config");
  assert.equal(lane.enforcement, "live", "K flipped live by 844dfab743 on a real committed attempt shard; reverting to shadow must be an equally conscious edit here");
  assert.equal(lane.kpi_required, true);
  assert.deepEqual(lane.endpoint_contract.assertions.map((row) => row.id), ["chart_array", "pegged_assets_array"]);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-defillama-ready-"));
  const result = await runCase(root);
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(fs.readFileSync(paths(root).canonicalPath), fs.readFileSync(paths(root).publicPath));
  const output = readJson(paths(root).canonicalPath);
  assert.equal(output.source, "DefiLlama");
  assert.equal(output.series.at(-1).date, "2026-07-16");
  assert.equal(output.current, 305_000_000_000);
  assert.equal(output.peggedAssets.length, 1);

  const shard = readJson(paths(root).attemptShardPath);
  assert.equal(validateAttemptShard(shard, DEFILLAMA_LANE_ID), true);
  assert.deepEqual(shard.attempts[0].assertions, [
    { id: "chart_array", passed: true },
    { id: "pegged_assets_array", passed: true },
  ]);
  const state = readJson(path.join(root, "data", "admin", DEFILLAMA_LANE_ID, "index.json"));
  assert.deepEqual(state.retry_set, []);
  assert.equal(state.items.stablecoins.resolution_state, "fresh_primary");
  assert.equal(state.items.stablecoins.promotion_contract, "provider_observation/v2");
}

for (const failure of [
  {
    name: "auth",
    request: async (_url, endpoint) => endpoint === "chart" ? response(401, { error: "unauthorized" }) : response(200, stablecoins()),
    expected: { reason: "auth_error", auth: "rejected", decode: "not_attempted", payload: "not_available" },
  },
  {
    name: "decode",
    request: async (_url, endpoint) => endpoint === "chart" ? response(200, "{broken") : response(200, stablecoins()),
    expected: { reason: "decode_error", auth: "not_applicable", decode: "error", payload: "not_available" },
  },
  {
    name: "empty",
    request: async (_url, endpoint) => endpoint === "chart" ? response(200, []) : response(200, stablecoins()),
    expected: { reason: "empty_payload", auth: "not_applicable", decode: "ok", payload: "empty" },
  },
  {
    name: "schema",
    request: async (_url, endpoint) => endpoint === "chart" ? response(200, { rows: [] }) : response(200, stablecoins()),
    expected: { reason: "schema_drift", auth: "not_applicable", decode: "ok", payload: "non_empty" },
  },
]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fetch-defillama-${failure.name}-`));
  const result = await runCase(root, { request: failure.request, runId: failure.name });
  assert.equal(result.ok, false, failure.name);
  assert.equal(result.reason, failure.expected.reason, failure.name);
  assert.equal(result.exitCode, 2, failure.name);
  const row = readJson(paths(root).attemptShardPath).attempts[0];
  assert.equal(row.auth, failure.expected.auth, failure.name);
  assert.equal(row.decode, failure.expected.decode, failure.name);
  assert.equal(row.payload, failure.expected.payload, failure.name);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-defillama-chaos-"));
  await runCase(root, { chartDate: "2026-07-15", runId: "seed-run", observedAt: "2026-07-15T04:00:00.000Z" });
  const canonicalBefore = fs.readFileSync(paths(root).canonicalPath, "utf8");

  const failed = await runCase(root, {
    chartDate: "2026-07-16",
    controlledFailureEndpoint: "chart",
    runId: "chaos-run",
    observedAt: "2026-07-16T04:00:00.000Z",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.degraded, true);
  assert.equal(failed.corrupt, false);
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.retrySet, ["stablecoins"]);
  assert.equal(fs.readFileSync(paths(root).canonicalPath, "utf8"), canonicalBefore);

  const statePath = path.join(root, "data", "admin", DEFILLAMA_LANE_ID, "index.json");
  const lkgPath = path.join(root, "data", "admin", DEFILLAMA_LANE_ID, "lkg", "stablecoins.json");
  const retained = readJson(statePath);
  assert.equal(retained.items.stablecoins.resolution_state, "lkg_primary");
  assert.equal(retained.items.stablecoins.latest_failure.run_id, "chaos-run");
  assert.equal(
    retained.items.stablecoins.lkg.payload_sha256,
    createHash("sha256").update(fs.readFileSync(lkgPath)).digest("hex"),
  );

  const manual = await runCase(root, {
    chartDate: "2026-07-16",
    runId: "manual-run",
    observedAt: "2026-07-16T05:00:00.000Z",
  });
  assert.equal(manual.reason, "recovery_requires_schedule");
  assert.equal(fs.readFileSync(paths(root).canonicalPath, "utf8"), canonicalBefore);

  const sameSource = await runCase(root, {
    chartDate: "2026-07-15",
    eventName: "schedule",
    runId: "same-source-run",
    observedAt: "2026-07-16T06:00:00.000Z",
  });
  assert.equal(sameSource.reason, "recovery_not_advanced_by_provider");

  const recovered = await runCase(root, {
    chartDate: "2026-07-16",
    eventName: "schedule",
    runId: "natural-recovery-run",
    observedAt: "2026-07-16T07:00:00.000Z",
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.recovered, true);
  const state = readJson(statePath);
  assert.deepEqual(state.retry_set, []);
  assert.equal(state.items.stablecoins.resolution_state, "fresh_primary");
  assert.equal(state.items.stablecoins.recovered_from_run_id, "chaos-run");
  assert.equal(state.items.stablecoins.recovery_event_name, "schedule");

  await assert.rejects(() => runCase(root, {
    controlledFailureEndpoint: "chart",
    eventName: "schedule",
    runId: "invalid-schedule-chaos",
  }), /workflow_dispatch/);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-defillama-no-lkg-"));
  const failed = await runCase(root, {
    controlledFailureEndpoint: "chart",
    runId: "no-lkg-chaos",
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.corrupt, true);
  assert.equal(failed.exitCode, 2);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-defillama-systemic-"));
  await runCase(root, { runId: "seed-run" });
  const failed = await runCase(root, {
    runId: "systemic-run",
    request: async () => response(503, { error: "upstream" }),
  });
  assert.equal(failed.reason, "http_error");
  assert.equal(failed.corrupt, true);
  assert.equal(failed.exitCode, 2);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-defillama.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-defillama\.mjs/);
  assert.match(workflow, /node scripts\/fetch-defillama\.mjs/);
  assert.match(workflow, /controlled_failure_endpoint/);
  assert.match(workflow, /INPUT_CONTROLLED_FAILURE_ENDPOINT/);
  assert.match(workflow, new RegExp(`detection-attempts/${DEFILLAMA_LANE_ID}\\.json`));
  assert.match(workflow, new RegExp(`data/admin/${DEFILLAMA_LANE_ID}/index\\.json`));
  assert.match(workflow, new RegExp(`data/admin/${DEFILLAMA_LANE_ID}/lkg/stablecoins\\.json`));
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.doesNotMatch(workflow, /git add -A/);
}

console.log("test-fetch-defillama: ok");
