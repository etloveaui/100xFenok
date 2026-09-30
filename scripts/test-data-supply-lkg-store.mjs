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
  eventName: "workflow_dispatch",
  observedAt: "2026-07-15T01:00:00.000Z",
});
const RECOVERY_RUN = Object.freeze({
  runId: "4002",
  runAttempt: 1,
  eventName: "schedule",
  observedAt: "2026-07-15T02:00:00.000Z",
});
const MANUAL_RUN = Object.freeze({
  runId: "4003",
  runAttempt: 1,
  eventName: "workflow_dispatch",
  observedAt: "2026-07-15T01:30:00.000Z",
});
const SCHEDULE_RERUN = Object.freeze({
  runId: "4004",
  runAttempt: 2,
  eventName: "schedule",
  observedAt: "2026-07-15T01:45:00.000Z",
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
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-same-date-"));
  const artifact = descriptor(repoRoot);
  writeJson(artifact.canonicalPath, { schema: "fixture/v1", source_as_of: "2026-07-14", rows: [{ value: 1 }] });
  const store = new LaneLkgStore({ repoRoot, laneId: "same_date" });
  store.recordFailure({ artifacts: [artifact], run: FAILURE_RUN, reason: "transport_error" });
  const sameDate = candidate("macro", "2026-07-14", 2);
  assert.equal(store.recoveryCandidateAdvances([sameDate], { ...MANUAL_RUN, runId: "local", runAttempt: 2 }), true,
    "a valid same-date acquisition must recover without natural/manual/run attestation");
  store.recordSuccess({ artifacts: [sameDate], run: { ...MANUAL_RUN, runId: "local", runAttempt: 2 } });
  assert.equal(store.stateSnapshot().items.macro.current.source_as_of, "2026-07-14", "recovery must not invent a later source date");
}


{
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lane-lkg-bytes-"));
  const artifact = descriptor(repoRoot);
  const original = Buffer.from(JSON.stringify({schema:"fixture/v1",source_as_of:"2026-07-14",rows:[{value:1}]}));
  fs.mkdirSync(path.dirname(artifact.canonicalPath), {recursive:true});
  fs.writeFileSync(artifact.canonicalPath, original);
  const store = new LaneLkgStore({repoRoot,laneId:"fixture"});
  const failed = store.recordFailure({artifacts:[artifact],run:FAILURE_RUN,reason:"transport_error"});
  const lkgPath = path.join(repoRoot,"data/admin/fixture/lkg/macro.json");
  assert.equal(failed.hasCompleteLkg,true);
  assert.deepEqual(fs.readFileSync(lkgPath),original);
  assert.equal(failed.state.items.macro.latest_failure.reason,"transport_error");
  fs.writeFileSync(artifact.canonicalPath,"{bad json");
  store.recordFailure({artifacts:[artifact],run:MANUAL_RUN,reason:"transport_error"});
  assert.deepEqual(fs.readFileSync(lkgPath),original,"invalid current data must preserve good bytes");
  assert.equal(store.recoveryCandidateAdvances([candidate("macro","2026-07-13")],RECOVERY_RUN),false);
  assert.throws(()=>store.recordSuccess({artifacts:[candidate("macro","2026-07-16")],run:RECOVERY_RUN}),/future/);
  assert.throws(()=>store.recordSuccess({artifacts:[{...candidate("macro","2026-07-14"),payloadBytes:Buffer.from("{}")}],run:RECOVERY_RUN}),/invalid/);
  assert.throws(()=>store.recordSuccess({artifacts:[{...candidate("macro","2026-07-14"),sourceAsOf:"2026-07-15"}],run:RECOVERY_RUN}),/payload-bound/);
  assert.throws(()=>store.recordSuccess({artifacts:[{...candidate("macro","2026-07-14"),currentRelativePath:"../outside.json"}],run:RECOVERY_RUN}),/inside/);
  const before=fs.readFileSync(store.statePath);
  assert.throws(()=>store.recordSuccess({artifacts:[candidate("macro","2026-07-14"),{...candidate("peer","2026-07-14"),payloadBytes:Buffer.from("{}")}],run:RECOVERY_RUN}),/invalid/);
  assert.deepEqual(fs.readFileSync(store.statePath),before,"family validation must finish before state writes");
  fs.writeFileSync(lkgPath,Buffer.from(JSON.stringify({schema:"fixture/v1",source_as_of:"2026-07-14",rows:[{value:9}]})));
  assert.equal(store.validRetainedLkg("macro",validFixture,d=>d.source_as_of),false,"tampered retained data must fail its byte binding");
}
assert.deepEqual(classifyLkgFailure({reason:"transport_error",hasCompleteLkg:true}),{degraded:true,corrupt:false,exitCode:0});
assert.equal(classifyLkgFailure({reason:"schema_drift",hasCompleteLkg:true}).exitCode,2);
assert.equal(classifyLkgFailure({reason:"transport_error",hasCompleteLkg:false}).exitCode,2);
assert.equal(systemicLkgFailureReason(["transport_error","rate_limited"]),"rate_limited");
assert.equal(allNaturalRequestsFailed([{status:"unavailable"},{status:"ready"}],(_,i)=>i===1),true);
assert.equal(allNaturalRequestsFailed([{status:"ready"}]),false);
console.log("data-supply LKG behavioral tests complete");
