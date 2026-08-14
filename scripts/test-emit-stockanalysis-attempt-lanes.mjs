import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";
import { LANE_REGISTRY } from "./lib/lane-registry.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EMITTER = path.join(REPO_ROOT, "scripts", "emit-stockanalysis-attempt.mjs");
const OWNER_WORKFLOW = ".github/workflows/fetch-stockanalysis.yml";

// Why this suite exists: on 2026-08-14 run 31791326158 fetched 100/100 ETF
// payloads and then died emitting the attempt shard, because the emitter carried
// a hand-written lane list that had not learned about stockanalysis_etf_detail.
// The registry, the detection config and the producer all knew; one list did not.
// Every check here asks the same question — can each lane this workflow owns
// actually be emitted — so the answer can never again depend on someone
// remembering a fourth place.

const ownedLanes = LANE_REGISTRY.lanes
  .filter((lane) => lane.owner_workflow === OWNER_WORKFLOW)
  .map((lane) => lane.id)
  .sort();

function emit(laneId, envelope) {
  const shardRoot = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "fenok-emit-lanes-"));
  try {
    const result = spawnSync(process.execPath, [
      EMITTER,
      "--lane", laneId,
      "--attempt-id", `test-${laneId}-1`,
      "--observed-at", "2026-08-14T00:00:00Z",
      "--shard-root", shardRoot,
    ], { input: JSON.stringify(envelope), encoding: "utf8", cwd: REPO_ROOT });
    return { ...result, shardRoot };
  } finally {
    fs.rmSync(shardRoot, { recursive: true, force: true });
  }
}

// --- every owned lane is emittable, and the set is not empty ---
{
  assert.ok(ownedLanes.length >= 5, `expected the StockAnalysis workflow to own several lanes, got ${ownedLanes.length}`);
  assert.ok(ownedLanes.includes("stockanalysis_etf_detail"), "the lane whose absence broke run 31791326158 must be covered");

  for (const laneId of ownedLanes) {
    const lane = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((row) => row.id === laneId);
    assert.ok(lane, `${laneId} is registry-owned but absent from the detection config`);
    // A minimal envelope in the shape the lane's transport expects. The point is
    // lane ACCEPTANCE, not classification: a rejected lane fails before any
    // envelope is read, with the message that broke the run.
    const envelope = lane.endpoint_contract.transport === "library"
      ? { transport: "library", candidate_count: 0, observations: [] }
      : { transport: "http", observations: [] };
    const result = emit(laneId, envelope);
    assert.equal(
      /unsupported StockAnalysis attempt lane/.test(result.stderr ?? ""),
      false,
      `${laneId} is owned by ${OWNER_WORKFLOW} but the emitter rejects it: ${result.stderr}`,
    );
  }
}

// --- the restriction still holds: a lane this workflow does not own is refused ---
{
  const foreign = LANE_REGISTRY.lanes.find((lane) => lane.owner_workflow !== OWNER_WORKFLOW);
  assert.ok(foreign, "the registry must contain a lane owned by another workflow");
  const result = emit(foreign.id, { transport: "http", observations: [] });
  assert.notEqual(result.status, 0, `${foreign.id} belongs to another workflow and must be refused`);
  assert.match(result.stderr ?? "", /unsupported StockAnalysis attempt lane/);
}

// --- an id in no registry at all is refused ---
{
  const result = emit("not_a_lane_at_all", { transport: "http", observations: [] });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr ?? "", /unsupported StockAnalysis attempt lane/);
}

process.stdout.write(`test-emit-stockanalysis-attempt-lanes: ok (${ownedLanes.length} owned lanes)\n`);
