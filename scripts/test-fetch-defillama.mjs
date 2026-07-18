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
  DEFILLAMA_MAX_SERIES_DAYS,
  DEFILLAMA_PERSISTENCE_POLICY,
  boundDefillamaSeries,
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

function chartRange(count, start = "2016-01-01") {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_unused, index) => ({
    date: Math.floor((startMs + index * 86_400_000) / 1000),
    totalCirculating: { peggedUSD: 1_000_000 + index },
  }));
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

function canonicalDocument(series = [{ date: "2026-07-16", val: 10 }], extra = {}) {
  return {
    updated: "2026-07-16T04:00:00.000Z",
    source: "DefiLlama",
    current: series.at(-1)?.val ?? 0,
    series,
    stablecoins: [],
    peggedAssets: [{ id: "1", name: "Tether", symbol: "USDT" }],
    ...extra,
  };
}

async function assertCanonicalValidity(document, expectedValid, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `fetch-defillama-validator-${name}-`));
  fs.mkdirSync(path.dirname(paths(root).canonicalPath), { recursive: true });
  fs.writeFileSync(paths(root).canonicalPath, `${JSON.stringify(document, null, 2)}\n`);
  const result = await runCase(root, {
    controlledFailureEndpoint: "chart",
    runId: `validator-${name}`,
  });
  assert.equal(result.degraded, expectedValid, name);
  assert.equal(result.corrupt, !expectedValid, name);
}

async function runCase(root, {
  chartDate = "2026-07-16",
  chartPayload,
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
      endpoint === "chart" ? response(200, chartPayload ?? chart(chartDate)) : response(200, stablecoins())
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
  assert.equal(DEFILLAMA_MAX_SERIES_DAYS, 3_650);
  assert.deepEqual(DEFILLAMA_PERSISTENCE_POLICY, {
    schema_version: "defillama-bounded-persistence/v1",
    basis: "source_date",
    scope: "series",
    max_series_days: 3_650,
    eviction: "oldest_source_date_first",
  });

  const providerChart = chartRange(DEFILLAMA_MAX_SERIES_DAYS + 2).reverse();
  assert.throws(
    () => boundDefillamaSeries(providerChart, { max_series_days: 0 }),
    /invalid DefiLlama persistence max_series_days/,
  );
  const firstPass = boundDefillamaSeries(providerChart);
  const secondPass = boundDefillamaSeries(providerChart);
  assert.deepEqual(secondPass, firstPass, "bounding the same provider payload must be idempotent");
  assert.equal(firstPass.series.length, DEFILLAMA_MAX_SERIES_DAYS);
  assert.equal(firstPass.series.at(0).date, "2016-01-03");
  assert.equal(firstPass.series.at(-1).date, "2025-12-30");
  assert.deepEqual(firstPass.persistence_state, {
    available_days: DEFILLAMA_MAX_SERIES_DAYS + 2,
    retained_days: DEFILLAMA_MAX_SERIES_DAYS,
    pruned_days: 2,
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-defillama-bounded-"));
  const result = await runCase(root, { chartPayload: providerChart, runId: "bounded-run" });
  assert.equal(result.ok, true);
  const output = readJson(paths(root).canonicalPath);
  assert.deepEqual(output.persistence_policy, DEFILLAMA_PERSISTENCE_POLICY);
  assert.deepEqual(output.persistence_state, firstPass.persistence_state);
  assert.deepEqual(output.series, firstPass.series);
  assert.equal(output.current, firstPass.series.at(-1).val);
}

{
  for (const [name, malformedRow] of [
    ["invalid-date", { date: "not-an-epoch", totalCirculating: { peggedUSD: 1 } }],
    ["missing-value", { date: chart("2026-07-17")[0].date, totalCirculating: {} }],
  ]) {
    const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), `fetch-defillama-${name}-`));
    await assert.rejects(
      () => runCase(malformedRoot, {
        chartPayload: [...chart("2026-07-16"), malformedRow],
        runId: name,
      }),
      /invalid DefiLlama chart row/,
    );
  }

  const duplicateChart = [...chart("2026-07-16", 10), ...chart("2026-07-16", 20)];
  const duplicateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-defillama-duplicate-chart-"));
  await assert.rejects(
    () => runCase(duplicateRoot, { chartPayload: duplicateChart, runId: "duplicate-chart" }),
    /duplicate DefiLlama chart source date: 2026-07-16/,
  );
}

{
  const policy = structuredClone(DEFILLAMA_PERSISTENCE_POLICY);
  const state = { available_days: 1, retained_days: 1, pruned_days: 0 };
  await assertCanonicalValidity(canonicalDocument(), true, "legacy-no-metadata");
  await assertCanonicalValidity(canonicalDocument(undefined, {
    persistence_policy: policy,
    persistence_state: state,
  }), true, "modern-valid");
  await assertCanonicalValidity(canonicalDocument(undefined, {
    persistence_policy: policy,
  }), false, "policy-without-state");
  await assertCanonicalValidity(canonicalDocument(undefined, {
    persistence_state: state,
  }), false, "state-without-policy");
  await assertCanonicalValidity(canonicalDocument(undefined, {
    persistence_policy: { ...policy, unexpected: true },
    persistence_state: state,
  }), false, "non-exact-policy");

  const oversizedSeries = chartRange(DEFILLAMA_MAX_SERIES_DAYS + 1).map((row) => ({
    date: new Date(row.date * 1000).toISOString().slice(0, 10),
    val: row.totalCirculating.peggedUSD,
  }));
  await assertCanonicalValidity(canonicalDocument(oversizedSeries, {
    persistence_policy: policy,
    persistence_state: {
      available_days: oversizedSeries.length,
      retained_days: oversizedSeries.length,
      pruned_days: 0,
    },
  }), false, "over-cap");
  await assertCanonicalValidity(canonicalDocument([
    { date: "2026-07-16", val: 10 },
    { date: "2026-07-15", val: 9 },
  ], {
    persistence_policy: policy,
    persistence_state: { available_days: 2, retained_days: 2, pruned_days: 0 },
  }), false, "not-ascending");
  await assertCanonicalValidity(canonicalDocument([
    { date: "2026-07-16", val: 10 },
    { date: "2026-07-16", val: 11 },
  ], {
    persistence_policy: policy,
    persistence_state: { available_days: 2, retained_days: 2, pruned_days: 0 },
  }), false, "duplicate-date");
  await assertCanonicalValidity(canonicalDocument([
    { date: "2026-02-30", val: 10 },
  ], {
    persistence_policy: policy,
    persistence_state: state,
  }), false, "invalid-calendar-date");
  await assertCanonicalValidity(canonicalDocument(undefined, {
    current: 11,
    persistence_policy: policy,
    persistence_state: state,
  }), false, "current-mismatch");
  await assertCanonicalValidity(canonicalDocument(undefined, {
    persistence_policy: policy,
    persistence_state: { available_days: 1, retained_days: 1, pruned_days: 1 },
  }), false, "state-arithmetic-mismatch");
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
