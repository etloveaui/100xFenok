#!/usr/bin/env node
// #365 P2: per-lane last_attempt provenance. Proves (a) last_attempt FOLLOWS the
// injected recovery state (value-changing injection), (b) storeless lanes emit
// honest null + reason, (c) the public projection redacts the run_id runtime
// identity while keeping event_name/observed_at.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildDetectionAttemptDetail,
  compactLastAttempt,
  loadCommittedDetectionAttemptDetails,
} from "./build-fenok-data-health-kpi.mjs";
import { projectPublicKpi } from "./lib/kpi-runtime-projection.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- (a) value-changing injection: last_attempt tracks the injected current_attempt ---
const injectA = { current_attempt: { run_id: "111", event_name: "schedule", observed_at: "2026-07-19T01:00:00Z", extra: "ignored" } };
const injectB = { current_attempt: { run_id: "222", event_name: "workflow_run", observed_at: "2026-07-19T02:00:00Z" } };
const a = compactLastAttempt(injectA);
const b = compactLastAttempt(injectB);
assert.deepEqual(a, { run_id: "111", event_name: "schedule", observed_at: "2026-07-19T01:00:00Z" }, "last_attempt is the 3-field compaction of the injected current_attempt");
assert.equal(b.run_id, "222", "a DIFFERENT injected recovery state yields a DIFFERENT run_id");
assert.equal(b.event_name, "workflow_run");
assert.notEqual(a.run_id, b.run_id, "last_attempt follows the injection, not a constant");

// --- (b) storeless / attempt-less lanes are honest null ---
assert.equal(compactLastAttempt(null), null, "no recovery state -> null");
assert.equal(compactLastAttempt(undefined), null, "undefined recovery state -> null");
assert.equal(compactLastAttempt({}), null, "recovery state without current_attempt -> null");
assert.equal(compactLastAttempt({ current_attempt: [] }), null, "malformed current_attempt -> null");

// --- (c) public projection redacts run_id, keeps event_name/observed_at ---
const rootDoc = {
  schema_version: "fenok-data-health-kpi/v2",
  lanes: [
    { id: "recovering_lane", details: { last_attempt: { run_id: "999", event_name: "schedule", observed_at: "2026-07-19T03:00:00Z" }, last_attempt_reason: null } },
    { id: "storeless_lane", details: { last_attempt: null, last_attempt_reason: "lane has no recovery store" } },
  ],
};
const pub = projectPublicKpi(rootDoc, "2026-07-19T04:00:00Z");
const pubLane = pub.lanes.find((l) => l.id === "recovering_lane");
assert.deepEqual(Object.keys(pubLane.details.last_attempt).sort(), ["event_name", "observed_at"], "public last_attempt drops run_id");
assert.equal("run_id" in pubLane.details.last_attempt, false, "public mirror must NOT expose the run_id runtime identity");
assert.equal(pubLane.details.last_attempt.event_name, "schedule", "public keeps event_name");
assert.equal(pubLane.details.last_attempt.observed_at, "2026-07-19T03:00:00Z", "public keeps observed_at");
// private root is untouched by the (deep-copying) projector.
assert.equal(rootDoc.lanes[0].details.last_attempt.run_id, "999", "private root still carries run_id (projector deep-copies)");
// storeless lane passes through as null.
const pubStoreless = pub.lanes.find((l) => l.id === "storeless_lane");
assert.equal(pubStoreless.details.last_attempt, null, "storeless last_attempt stays null in public");
assert.equal(pubStoreless.details.last_attempt_reason, "lane has no recovery store", "reason preserved");

console.log(JSON.stringify({ ok: true, suite: "kpi last_attempt (injection + storeless + public redaction)" }, null, 2));

// --- (d) committed detection-shard attempt clock is public-safe and outcome-bound ---
const gdelt = buildDetectionAttemptDetail({
  rows: [{
    observed_at: "2026-07-31T16:24:24.940Z",
    execution: "returned",
    exception_kind: null,
    http_status: 200,
    rate_limited: false,
    decode: "ok",
    payload: "non_empty",
    assertions: [{ id: "articles_array", passed: false }],
    retry_reason: "rate_limited",
  }],
});
assert.deepEqual(gdelt, {
  last_attempt: {
    event_name: null,
    observed_at: "2026-07-31T16:24:24.940Z",
    outcome: "failed",
    failure_class: "assertion",
  },
  last_attempt_reason: null,
}, "GDELT failed shard evidence must replace the previous null attempt clock");

const missingYahoo = buildDetectionAttemptDetail({ status: "missing" });
assert.deepEqual(missingYahoo, {
  last_attempt: null,
  last_attempt_reason: "detection attempt shard missing",
}, "missing Yahoo shard must remain explicit missing evidence");

const publicGdelt = projectPublicKpi({ lanes: [{ id: "gdelt_news_tone", details: gdelt }] }, "2026-08-01T00:00:00Z");
assert.deepEqual(publicGdelt.lanes[0].details.last_attempt, gdelt.last_attempt,
  "public KPI must preserve the normalized attempt outcome and failure class");

const shardLanes = ["gdelt_news_tone", "yahoo_batch_quote_history"]
  .map((id) => LANE_REGISTRY.lanes.find((lane) => lane.id === id));
const committed = loadCommittedDetectionAttemptDetails(shardLanes, { dataRoot: path.join(REPO_ROOT, "data") });

// Expected last attempt is derived from the committed raw shard (no dated
// literals): fail closed on a missing shard or zero attempts, then mirror the
// loader's latest-observed_at selection.
const gdeltShardPath = path.join(
  REPO_ROOT, "data", "admin", "data-supply-state", "detection-attempts", "gdelt_news_tone.json");
const gdeltShard = JSON.parse(fs.readFileSync(gdeltShardPath, "utf8"));
assert.ok(Array.isArray(gdeltShard?.attempts) && gdeltShard.attempts.length > 0,
  "committed GDELT shard must exist with at least one attempt (fail closed, not skipped)");
const expectedGdeltAttempt = [...gdeltShard.attempts]
  .filter((row) => row && Number.isFinite(Date.parse(row.observed_at)))
  .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))[0];
assert.ok(expectedGdeltAttempt,
  "committed GDELT shard must contain an observed attempt (fail closed, not skipped)");
const expectedGdeltOutcome =
  (expectedGdeltAttempt.assertions ?? []).every((a) => a?.passed === true) ? "success" : "failed";
assert.equal(committed.gdelt_news_tone.last_attempt.outcome, expectedGdeltOutcome,
  "committed GDELT shard must produce the assertion-derived public attempt outcome");
assert.equal(committed.gdelt_news_tone.last_attempt.observed_at, expectedGdeltAttempt.observed_at,
  "committed GDELT shard must provide its latest observed_at");

// The live repository may legitimately gain a Yahoo attempt shard after this
// test was authored. Build the missing-shard case in an isolated fixture root
// instead of depending on the current checkout's mutable data state.
const missingShardDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "100x-kpi-last-attempt-"));
const fixtureDetectionRoot = path.join(missingShardDataRoot, "admin", "data-supply-state", "detection-attempts");
fs.mkdirSync(fixtureDetectionRoot, { recursive: true });
fs.copyFileSync(gdeltShardPath, path.join(fixtureDetectionRoot, "gdelt_news_tone.json"));
try {
  const fixtureCommitted = loadCommittedDetectionAttemptDetails(shardLanes, { dataRoot: missingShardDataRoot });
  assert.deepEqual(fixtureCommitted.gdelt_news_tone, committed.gdelt_news_tone,
    "isolated fixture must preserve the committed GDELT attempt detail");
  assert.deepEqual(fixtureCommitted.yahoo_batch_quote_history, missingYahoo,
    "missing Yahoo shard must not fall back to the private recovery index clock");
} finally {
  fs.rmSync(missingShardDataRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({ ok: true, suite: "detection attempt clock (GDELT failure + Yahoo missing + public projection)" }, null, 2));
