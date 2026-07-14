#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { runFdicTier1 } from "./fetch-fdic-tier1.mjs";

const OBSERVED_AT = "2026-07-14T12:34:56.000Z";
const ATTEMPT_ID = "fdic-tier1-20260714t123456000z-test";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUARTERS = ["20251231", "20260331"];

function expectedAssertionIds(laneId) {
  const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
  return lane.endpoint_contract.assertions.map((assertion) => assertion.id);
}

function response(statusCode, payload) {
  return { statusCode, body: typeof payload === "string" ? payload : JSON.stringify(payload) };
}

function fdicRows(value) {
  return { data: [{ data: { RBC1AAJ: value } }, { data: { RBC1AAJ: value + 2 } }] };
}

function makePaths(root) {
  return {
    canonicalPath: path.join(root, "data", "macro", "fdic-tier1.json"),
    publicPath: path.join(root, "public", "data", "macro", "fdic-tier1.json"),
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fdic_tier1.json"),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertValidShard(shard) {
  assert.equal(validateAttemptShard(shard, shard.lane_id), true);
  assert.equal(validateAttemptEvidence({
    schema_version: "data-supply-detection-attempts/v1",
    attempts: shard.attempts,
  }), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-test-"));
  const paths = makePaths(root);
  const calls = [];
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => {
      calls.push(quarter);
      return response(200, fdicRows(quarter === QUARTERS[0] ? 12 : 14));
    },
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, QUARTERS);
  assert.deepEqual(fs.readFileSync(paths.canonicalPath), fs.readFileSync(paths.publicPath));
  const output = readJson(paths.canonicalPath);
  assert.equal(output.source, "FDIC");
  assert.deepEqual(output.data.map((row) => row.value), [13, 15]);
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.lane_id, "fdic_tier1");
  assert.equal(row.member_id, null);
  assert.equal(row.http_status, 200);
  assert.deepEqual(expectedAssertionIds("fdic_tier1"), ["bank_data_array"]);
  assert.deepEqual(row.assertions.map((assertion) => assertion.id), expectedAssertionIds("fdic_tier1"));
  assert.equal(row.assertions.every((assertion) => assertion.passed), true);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fetch-fdic-tier1-lkg-test-"));
  const paths = makePaths(root);
  fs.mkdirSync(path.dirname(paths.canonicalPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.publicPath), { recursive: true });
  const lkg = `${JSON.stringify({ marker: "lkg" }, null, 2)}\n`;
  fs.writeFileSync(paths.canonicalPath, lkg);
  fs.writeFileSync(paths.publicPath, lkg);
  const result = await runFdicTier1({
    ...paths,
    quarters: QUARTERS,
    request: async (_url, quarter) => quarter === QUARTERS[1]
      ? response(500, { error: "upstream" })
      : response(200, fdicRows(12)),
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    sleep: async () => {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "http_error");
  assert.equal(fs.readFileSync(paths.canonicalPath, "utf8"), lkg);
  assert.equal(fs.readFileSync(paths.publicPath, "utf8"), lkg);
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(shard.attempts[0].http_status, 500);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fdic.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fdic-tier1\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fdic-tier1\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /detection-attempts\/fdic_tier1\.json/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-fdic-tier1: ok");
