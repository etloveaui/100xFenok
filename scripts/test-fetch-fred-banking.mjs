#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { validateAttemptEvidence, validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import {
  FRED_BANKING_GROUPS,
  runFredBanking,
} from "./fetch-fred-banking.mjs";

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

function observations(seriesId) {
  return { observations: [{ date: "2026-07-11", value: seriesId.length.toString() }] };
}

function makePaths(root) {
  const canonical = {};
  const publicPaths = {};
  for (const group of FRED_BANKING_GROUPS) {
    canonical[group.id] = path.join(root, "data", "macro", `fred-banking-${group.id}.json`);
    publicPaths[group.id] = path.join(root, "public", "data", "macro", `fred-banking-${group.id}.json`);
  }
  return {
    canonicalPaths: canonical,
    publicPaths,
    attemptShardPath: path.join(root, "data", "admin", "data-supply-state", "detection-attempts", "fred_banking.json"),
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
  for (const group of FRED_BANKING_GROUPS) {
    assert.deepEqual(fs.readFileSync(paths.canonicalPaths[group.id]), fs.readFileSync(paths.publicPaths[group.id]));
    assert.equal(readJson(paths.canonicalPaths[group.id]).type, group.id);
  }
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  assert.equal(shard.lane_id, "fred_banking");
  assert.equal(shard.attempts.length, 1, "three artifacts still emit one member attempt");
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
    fs.mkdirSync(path.dirname(paths.canonicalPaths[group.id]), { recursive: true });
    fs.mkdirSync(path.dirname(paths.publicPaths[group.id]), { recursive: true });
    fs.writeFileSync(paths.canonicalPaths[group.id], `${JSON.stringify({ marker: `lkg-${group.id}` })}\n`);
    fs.writeFileSync(paths.publicPaths[group.id], `${JSON.stringify({ marker: `lkg-${group.id}` })}\n`);
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
  const shard = readJson(paths.attemptShardPath);
  assertValidShard(shard);
  const row = shard.attempts[0];
  assert.equal(row.http_status, 429);
  assert.equal(row.rate_limited, true);
  for (const group of FRED_BANKING_GROUPS) {
    assert.equal(readJson(paths.canonicalPaths[group.id]).marker, `lkg-${group.id}`);
    assert.equal(readJson(paths.publicPaths[group.id]).marker, `lkg-${group.id}`);
  }
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "fetch-fred-banking.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-fetch-fred-banking\.mjs/);
  assert.match(workflow, /node scripts\/fetch-fred-banking\.mjs/);
  assert.doesNotMatch(workflow, /node << ['"]?EOF/);
  assert.match(workflow, /detection-attempts\/fred_banking\.json/);
  assert.match(workflow, /- name: Commit and push owned FRED banking data\n\s+if: \$\{\{ always\(\) \}\}/);
}

console.log("test-fetch-fred-banking: ok");
