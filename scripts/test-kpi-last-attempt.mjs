#!/usr/bin/env node
// #365 P2: per-lane last_attempt provenance. Proves (a) last_attempt FOLLOWS the
// injected recovery state (value-changing injection), (b) storeless lanes emit
// honest null + reason, (c) the public projection redacts the run_id runtime
// identity while keeping event_name/observed_at.

import assert from "node:assert/strict";

import { compactLastAttempt } from "./build-fenok-data-health-kpi.mjs";
import { projectPublicKpi } from "./lib/kpi-runtime-projection.mjs";

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
