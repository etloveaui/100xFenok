#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  buildFenoYardeniPayload,
  parseFredObservations,
  runFenoYardeni,
} from "./build-feno-yardeni-model.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const seedPayload = {
  meta: {
    model: "yardney_model",
    frequency: "weekly",
  },
  data: [
    {
      date: "2009-12-25",
      spx: 1100,
      eps: 80,
      bond_per: 20,
      fair_value: 1600,
      premium_pct: -31.25,
    },
    {
      date: "2010-01-01",
      spx: 1115.1,
      eps: 77.8493,
      bond_per: 20,
      fair_value: 1556.99,
      premium_pct: -28.38,
    },
  ],
};

const benchmarkPayload = {
  metadata: {
    version: "fixture-benchmark",
    generated: "2026-07-08T00:00:00.000Z",
    source: "Bloomberg Terminal",
  },
  sections: {
    sp500: {
      data: [
        {
          date: "2010-01-01",
          px_last: 1115.1,
          best_eps: 78.6127,
        },
        {
          date: "2010-01-08",
          px_last: 1144.98,
          best_eps: 79.1824,
        },
        {
          date: "2010-01-15",
          px_last: 1136.03,
          best_eps: 79.6816,
        },
      ],
    },
  },
};

const fredSeries = {
  WAAA: [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-08", value: 5.2 },
  ],
  WBAA: [
    { date: "2010-01-01", value: 6 },
    { date: "2010-01-08", value: 6.2 },
  ],
};

const { publicPayload, privatePayload, report } = buildFenoYardeniPayload({
  seedPayload,
  benchmarkPayload,
  fredSeries,
  generatedAt: "2026-07-08T00:00:00.000Z",
  generatedBy: "test",
});

assert.equal(publicPayload.meta.model, "feno_yardeni_model");
assert.equal(publicPayload.meta.public_schema_version, "yardney_model_public_v1");
assert.equal(publicPayload.meta.bond_yield_components_included, false);
assert.equal(publicPayload.data.length, 3);
assert.equal(publicPayload.data[0].date, "2009-12-25");
assert.equal(publicPayload.data[0].fair_value, 1600);

const firstComputed = publicPayload.data[1];
assert.deepEqual(firstComputed, {
  date: "2010-01-01",
  spx: 1115.1,
  eps: 78.6127,
  bond_per: 18.18,
  fair_value: 1429.18,
  premium_pct: -21.98,
});

assert.equal(publicPayload.data[2].date, "2010-01-08");
assert.equal(publicPayload.data.some((row) => row.date === "2010-01-15"), false);
assert.equal(report.seed_preserved_records, 1);
assert.equal(report.computed_records, 2);
assert.equal(report.skipped_benchmark_records, 1);

const publicText = JSON.stringify(publicPayload);
for (const forbidden of [
  "moodys_aaa",
  "moodys_baa",
  "spread_avg",
  "WAAA\":",
  "WBAA\":",
  "fred_aaa",
  "fred_baa",
]) {
  assert.equal(publicText.includes(forbidden), false, `public payload leaked ${forbidden}`);
}

assert.equal(privatePayload.data[1].moodys_aaa, 5);
assert.equal(privatePayload.data[1].moodys_baa, 6);
assert.equal(privatePayload.data[1].spread_avg, 5.5);

assert.deepEqual(
  parseFredObservations({
    observations: [
      { date: "2010-01-01", value: "5.00" },
      { date: "2010-01-08", value: "." },
      { date: "2010-01-15", value: "5.15" },
    ],
  }, "WAAA"),
  [
    { date: "2010-01-01", value: 5 },
    { date: "2010-01-15", value: 5.15 },
  ],
);

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function makeRunPaths(root) {
  return {
    publicOutputPath: path.join(root, "data", "yardney", "yardney_model.json"),
    publicMirrorPath: path.join(root, "public", "data", "yardney", "yardney_model.json"),
    privateOutputPath: path.join(root, "private", "yardney_model_full.json"),
    privateFredCachePath: path.join(root, "private", "fred_yardeni_yields.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_yardeni.json"),
  };
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-yardeni-test-"));
  const paths = makeRunPaths(root);
  const result = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: async (_url, seriesId) => response(200, {
      observations: fredSeries[seriesId].map((row) => ({ date: row.date, value: String(row.value) })),
    }),
    observedAt: "2026-07-14T12:34:56.000Z",
    attemptId: "fred-yardeni-20260714t123456000z-test",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readFileSync(paths.publicOutputPath), fs.readFileSync(paths.publicMirrorPath));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "fred_yardeni"), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  assert.equal(shard.lane_id, "fred_yardeni");
  assert.equal(shard.attempts.length, 1);
  const row = shard.attempts[0];
  assert.equal(row.member_id, null);
  assert.equal(row.http_status, 200);
  assert.equal(row.auth, "ok");
  assert.deepEqual(expectedAssertionIds("fred_yardeni"), ["observations_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fred_yardeni"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fred-yardeni-lkg-test-"));
  const paths = makeRunPaths(root);
  fs.mkdirSync(path.dirname(paths.publicOutputPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicMirrorPath), { recursive: true });
  const lkg = `${JSON.stringify({ marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.publicOutputPath, lkg);
  fs.writeFileSync(paths.publicMirrorPath, lkg);
  const result = await runFenoYardeni({
    ...paths,
    seedPayload,
    privateSeedPayload: null,
    benchmarkPayload,
    apiKey: "test-key",
    request: async (_url, seriesId) => seriesId === "WBAA"
      ? response(429, { error: "rate limit" })
      : response(200, { observations: fredSeries.WAAA }),
    observedAt: "2026-07-14T12:34:56.000Z",
    attemptId: "fred-yardeni-20260714t123456000z-test",
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "rate_limited");
  assert.equal(fs.readFileSync(paths.publicOutputPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicMirrorPath, "utf8"), lkg);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "fred_yardeni"), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fred-yardeni.yml"), "utf8");
  assert.match(workflow, /detection-attempts\/fred_yardeni\.json/);
  assert.match(workflow, /- name: Commit and push Feno Yardeni data\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("build-feno-yardeni-model tests passed");
