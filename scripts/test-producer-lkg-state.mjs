#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ProducerLkgStateStore,
  assessRecoveryExit,
} from "./lib/producer-lkg-state.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "producer-lkg-state-"));
const stateRoot = path.join(root, "data", "admin", "fixture-lane");
const run = (runId, observedAt = "2026-07-15T01:00:00Z") => ({
  run_id: runId,
  run_attempt: 1,
  event_name: "workflow_dispatch",
  natural: false,
  observed_at: observedAt,
});
const naturalRun = (runId, observedAt = "2026-07-15T01:00:00Z") => ({
  ...run(runId, observedAt),
  event_name: "schedule",
  natural: true,
});
const bytes = (sourceAsOf, value = 1) => Buffer.from(`${JSON.stringify({
  schema_version: "fixture/v1",
  key: "alpha.json",
  source_as_of: sourceAsOf,
  value,
}, null, 2)}\n`);
const parse = (payloadBytes) => JSON.parse(payloadBytes.toString("utf8"));
const makeStore = (rootPath, candidateContainsObservation = undefined) => new ProducerLkgStateStore({
  root: rootPath,
  laneId: "fixture_lane",
  publicRoot: "data/admin/fixture-lane",
  validatePayload(key, payload) {
    return payload?.schema_version === "fixture/v1" && payload?.key === key;
  },
  progressMarker(_key, payload) {
    return payload?.source_as_of ?? null;
  },
  ...(candidateContainsObservation ? { candidateContainsObservation } : {}),
});
const store = makeStore(stateRoot);

{
  const target = makeStore(path.join(root, "same-date-acquisition"));
  const original = bytes("2026-07-14", 1);
  target.recordCandidate({ key: "alpha.json", payloadBytes: original, canonicalRef: "data/source/alpha.json", run: run("seed") });
  target.recordFailure({ key: "alpha.json", error: "transport", failureKind: "transport", fallbackBytes: original, canonicalRef: "data/source/alpha.json", run: run("failure") });
  const sameDate = target.recordCandidate({ key: "alpha.json", payloadBytes: bytes("2026-07-14", 2), canonicalRef: "data/source/alpha.json", run: { ...run("local"), run_attempt: 2 } });
  assert.equal(sameDate.accepted, true, "a valid same-date acquisition must recover without natural/manual/run attestation");
  assert.equal(sameDate.state.current.source_as_of, "2026-07-14", "recovery must retain the actual source date");
}


{
  const original=bytes("2026-07-14",1);
  const args={key:"alpha.json",canonicalRef:"data/source/alpha.json",run:run("local")};
  assert.equal(store.recordCandidate({...args,payloadBytes:original}).accepted,true);
  const failed=store.recordFailure({...args,error:"transport",failureKind:"transport",fallbackBytes:original});
  assert.equal(failed.resolution_state,"lkg_primary");
  assert.deepEqual(fs.readFileSync(store.lkgPath(args.key)),original);
  assert.equal(failed.latest_failure.failure_kind,"transport");
  const invalid=Buffer.from("{}");
  assert.throws(()=>store.recordCandidate({...args,payloadBytes:invalid}),/validation/);
  assert.deepEqual(fs.readFileSync(store.lkgPath(args.key)),original);
  assert.equal(store.planCandidate({...args,payloadBytes:bytes("2026-07-13")}).reason,"source_regression");
  assert.throws(()=>store.planCandidate({...args,payloadBytes:bytes("2026-07-16")}),/future/);
  assert.throws(()=>store.planCandidate({...args,payloadBytes:original,canonicalRef:"../outside"}),/inside/);
  const index=store.buildIndex({keys:[args.key],run:args.run});
  assert.deepEqual(index.retry_keys,[args.key]);
  assert.equal(index.current_attempt.failed,1);
  assert.equal(assessRecoveryExit({store,failedKeys:[args.key]}).exit_code,0);
  assert.equal(assessRecoveryExit({store,failedKeys:[args.key],fatalKeys:[args.key]}).exit_code,2);
  fs.writeFileSync(store.lkgPath(args.key),bytes("2026-07-14",9));
  assert.equal(store.validRetainedLkg(args.key).valid,false);
  assert.equal(store.planCandidate({...args,payloadBytes:bytes("2026-07-15")}).corrupt,true);
  assert.equal(assessRecoveryExit({store,failedKeys:[args.key]}).exit_code,2);
}
{
  const target=makeStore(path.join(root,"unavailable"));
  const args={key:"alpha.json",canonicalRef:"data/source/alpha.json",run:run("local")};
  const failed=target.recordFailure({...args,error:"transport",failureKind:"transport",fallbackBytes:null});
  assert.equal(failed.resolution_state,"unavailable");
  assert.equal(target.recordCandidate({...args,payloadBytes:bytes("2026-07-14")}).accepted,true);
}
console.log("producer LKG behavioral tests complete");
