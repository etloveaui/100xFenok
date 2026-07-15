#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  LaneLkgStore,
  allNaturalRequestsFailed,
  classifyLkgFailure,
  systemicLkgFailureReason,
} from "./lib/data-supply-lkg-store.mjs";

const FAILURE_RUN = Object.freeze({
  runId: "4001",
  runAttempt: 1,
  observedAt: "2026-07-15T01:00:00.000Z",
});
const RECOVERY_RUN = Object.freeze({
  runId: "4002",
  runAttempt: 1,
  observedAt: "2026-07-15T02:00:00.000Z",
});

function writeJson(filePath, document) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function validFixture(document) {
  return document?.schema === "fixture/v1"
    && typeof document?.source_as_of === "string"
    && Array.isArray(document?.rows)
    && document.rows.length > 0;
}

function descriptor(repoRoot, key = "macro") {
  return {
    key,
    canonicalPath: path.join(repoRoot, "data", `${key}.json`),
    validateDocument: validFixture,
    sourceAsOf: (document) => document.source_as_of,
  };
}

function candidate(key, sourceAsOf, value = 2) {
  const document = { schema: "fixture/v1", source_as_of: sourceAsOf, rows: [{ value }] };
  return {
    key,
    currentRelativePath: `data/${key}.json`,
    payloadBytes: Buffer.from(`${JSON.stringify(document, null, 2)}\n`),
    sourceAsOf,
    validateDocument: validFixture,
    deriveSourceAsOf: (document) => document.source_as_of,
  };
}

{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-store-"));
  const artifact = descriptor(repoRoot);
  writeJson(artifact.canonicalPath, {
    schema: "fixture/v1",
    source_as_of: "2026-07-14",
    rows: [{ value: 1 }],
  });
  const store = new LaneLkgStore({ repoRoot, laneId: "fred_macro" });
  const failed = store.recordFailure({
    artifacts: [artifact],
    run: FAILURE_RUN,
    reason: "controlled_failure",
  });

  assert.equal(failed.hasCompleteLkg, true);
  assert.deepEqual(failed.retrySet, ["macro"]);
  const lkgPath = path.join(repoRoot, "data", "admin", "fred_macro", "lkg", "macro.json");
  const statePath = path.join(repoRoot, "data", "admin", "fred_macro", "index.json");
  const lkgBytes = fs.readFileSync(lkgPath);
  const state = readJson(statePath);
  assert.equal(state.schema_version, "data-supply-lkg-state/v1");
  assert.equal(state.lane_id, "fred_macro");
  assert.deepEqual(state.retry_set, ["macro"]);
  assert.equal(state.items.macro.resolution_state, "lkg_primary");
  assert.equal(state.items.macro.current.path, "data/admin/fred_macro/lkg/macro.json");
  assert.equal(state.items.macro.current.payload_sha256, sha256(lkgBytes));
  assert.equal(state.items.macro.lkg.payload_sha256, sha256(lkgBytes));
  assert.equal(state.items.macro.latest_failure.run_id, FAILURE_RUN.runId);
  assert.equal(store.validRetainedLkg("macro", validFixture, (document) => document.source_as_of), true);

  state.items.macro.current.payload_sha256 = "b".repeat(64);
  writeJson(statePath, state);
  assert.equal(store.validRetainedLkg("macro", validFixture, (document) => document.source_as_of), false, "current and LKG digests must be bound");
  state.items.macro.current.payload_sha256 = state.items.macro.lkg.payload_sha256;
  writeJson(statePath, state);

  state.items.macro.current.source_as_of = "2026-07-13";
  state.items.macro.lkg.source_as_of = "2026-07-13";
  writeJson(statePath, state);
  assert.equal(store.validRetainedLkg("macro", validFixture, (document) => document.source_as_of), false, "LKG source boundary must be payload-bound");
  state.items.macro.current.source_as_of = "2026-07-14";
  state.items.macro.lkg.source_as_of = "2026-07-14";
  writeJson(statePath, state);

  fs.appendFileSync(lkgPath, "tampered\n");
  assert.equal(store.validRetainedLkg("macro", validFixture, (document) => document.source_as_of), false, "digest-bound LKG rejects tampering");
}

{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-multi-recovery-"));
  const daily = descriptor(repoRoot, "daily");
  const quarterly = descriptor(repoRoot, "quarterly");
  for (const artifact of [daily, quarterly]) {
    writeJson(artifact.canonicalPath, {
      schema: "fixture/v1",
      source_as_of: "2026-07-14",
      rows: [{ value: 1 }],
    });
  }
  const store = new LaneLkgStore({ repoRoot, laneId: "fred_banking" });
  store.recordFailure({ artifacts: [daily, quarterly], run: FAILURE_RUN, reason: "controlled_failure" });
  assert.equal(store.recoveryCandidateAdvances([
    candidate("daily", "2026-07-15"),
    candidate("quarterly", "2026-07-14"),
  ]), false, "one advancing key must not launder another retained LKG");
  assert.deepEqual(store.promotableCandidates([
    candidate("daily", "2026-07-15"),
    candidate("quarterly", "2026-07-14"),
  ]).map((item) => item.key), ["daily"], "only the advancing key may recover");
  assert.equal(store.recoveryCandidateAdvances([
    candidate("daily", "2026-07-15"),
    candidate("quarterly", "2026-07-15"),
  ]), true);

  const corruptStatePath = path.join(repoRoot, "data", "admin", "fred_banking", "index.json");
  const corruptState = readJson(corruptStatePath);
  corruptState.retry_set = ["daily"];
  writeJson(corruptStatePath, corruptState);
  assert.throws(() => store.stateSnapshot(), /retry_set is inconsistent/);
}

{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-no-canonical-"));
  const store = new LaneLkgStore({ repoRoot, laneId: "fdic_tier1" });
  const failed = store.recordFailure({
    artifacts: [descriptor(repoRoot, "fdic-tier1")],
    run: FAILURE_RUN,
    reason: "transport_error",
  });
  assert.equal(failed.hasCompleteLkg, false);
  assert.deepEqual(failed.retrySet, ["fdic-tier1"]);
  assert.equal(failed.state.items["fdic-tier1"].resolution_state, "unavailable");
  assert.deepEqual(store.promotableCandidates([candidate("fdic-tier1", "2026-07-15")]).map((item) => item.key), ["fdic-tier1"]);
  assert.deepEqual(classifyLkgFailure({ reason: "transport_error", hasCompleteLkg: false }), {
    degraded: false,
    corrupt: true,
    exitCode: 2,
  });
}

{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-path-test-"));
  const store = new LaneLkgStore({ repoRoot, laneId: "fred_macro" });
  assert.throws(() => store.promotableCandidates([{
    ...candidate("macro", "2026-07-15"),
    currentRelativePath: "../outside.json",
  }]), /inside repoRoot/);
}

{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-recovery-"));
  const artifact = descriptor(repoRoot);
  writeJson(artifact.canonicalPath, {
    schema: "fixture/v1",
    source_as_of: "2026-07-14",
    rows: [{ value: 1 }],
  });
  const store = new LaneLkgStore({ repoRoot, laneId: "fred_macro" });
  store.recordFailure({ artifacts: [artifact], run: FAILURE_RUN, reason: "controlled_failure" });

  assert.equal(store.recoveryCandidateAdvances([candidate("macro", "2026-07-14")]), false);
  const advanced = candidate("macro", "2026-07-15");
  assert.equal(store.recoveryCandidateAdvances([advanced]), true);
  const recovered = store.recordSuccess({ artifacts: [advanced], run: RECOVERY_RUN });
  assert.deepEqual(recovered.retrySet, []);
  assert.equal(recovered.state.items.macro.resolution_state, "fresh_primary");
  assert.equal(recovered.state.items.macro.retry, false);
  assert.equal(recovered.state.items.macro.current.payload_sha256, sha256(advanced.payloadBytes));
  assert.equal(recovered.state.items.macro.recovered_from_run_id, FAILURE_RUN.runId);
  assert.equal(recovered.state.items.macro.last_recovered_failure.run_id, FAILURE_RUN.runId);
  assert.equal(recovered.state.items.macro.latest_failure, undefined);
}

assert.deepEqual(classifyLkgFailure({ reason: "http_error", hasCompleteLkg: true }), {
  degraded: true,
  corrupt: false,
  exitCode: 0,
});
assert.deepEqual(classifyLkgFailure({ reason: "controlled_failure", hasCompleteLkg: true }), {
  degraded: true,
  corrupt: false,
  exitCode: 0,
});
assert.deepEqual(classifyLkgFailure({ reason: "http_error", hasCompleteLkg: true, systemic: true }), {
  degraded: false,
  corrupt: true,
  exitCode: 2,
});
assert.equal(allNaturalRequestsFailed([
  { status: "unavailable", controlled: true },
  { status: "ready", controlled: false },
], (row) => row.controlled), false);
assert.equal(allNaturalRequestsFailed([
  { status: "unavailable", controlled: true },
  { status: "unavailable", controlled: false },
], (row) => row.controlled), true);
for (const reason of ["auth_error", "rate_limited", "decode_error", "schema_drift", "empty_payload", "future_source", "unexpected_error"]) {
  assert.deepEqual(classifyLkgFailure({ reason, hasCompleteLkg: true }), {
    degraded: false,
    corrupt: true,
    exitCode: 2,
  }, reason);
}
assert.equal(systemicLkgFailureReason(["http_error", "auth_error"]), "auth_error");
assert.equal(systemicLkgFailureReason(["transport_error", "controlled_failure"]), null);

console.log("test-data-supply-lkg-store: ok");
