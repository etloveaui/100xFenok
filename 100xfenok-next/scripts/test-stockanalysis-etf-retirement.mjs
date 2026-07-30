import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyRetirementPlan,
  buildRetirementPlan,
  restoreRetirementPlan,
  verifyEmittedEtfAssets,
  writeRetirementPlan,
} from "./retire-stockanalysis-etf-legacy.mjs";

const hash = (body) => crypto.createHash("sha256").update(body).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "etf-retirement-"));
const canonicalRoot = path.join(root, "canonical");
const assetRoot = path.join(root, "assets");
const publicRoot = path.join(assetRoot, "data", "stockanalysis", "etfs");
const shardRoot = path.join(publicRoot, "shards", "snapshots", "s");
fs.mkdirSync(canonicalRoot, { recursive: true });
fs.mkdirSync(shardRoot, { recursive: true });
for (const ticker of ["AAA", "BBB"]) {
  const body = `${JSON.stringify({ ticker })}\n`;
  fs.writeFileSync(path.join(canonicalRoot, `${ticker}.json`), body);
  fs.writeFileSync(path.join(publicRoot, `${ticker}.json`), body);
}
const shardBody = "{}\n";
const shards = Array.from({ length: 128 }, (_, id) => {
  const relative = `snapshots/s/${String(id).padStart(3, "0")}.json`;
  fs.writeFileSync(path.join(publicRoot, "shards", relative), shardBody);
  return { id, path: relative, byte_length: shardBody.length, sha256: hash(shardBody) };
});
fs.writeFileSync(path.join(publicRoot, "shards", "index.json"), `${JSON.stringify({
  compatibility_mode: "legacy-fallback",
  shard_count: 128,
  payload_count: 2,
  shards,
})}\n`);
const planPath = path.join(root, "plan.json");
const journalPath = path.join(root, "journal.json");
try {
  assert.throws(
    () => buildRetirementPlan({ canonicalRoot, publicRoot, lockedSourceSha: "0".repeat(40), expectedTargetCount: 3 }),
    /expected exactly 3/,
  );
  const plan = writeRetirementPlan({
    outputPath: planPath,
    canonicalRoot,
    publicRoot,
    lockedSourceSha: "0".repeat(40),
    expectedTargetCount: 2,
  });
  assert.equal(plan.target_count, 2);
  assert.equal(applyRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).retired, 2);
  assert.equal(fs.readdirSync(publicRoot).filter((name) => name.endsWith(".json")).length, 0);
  assert.equal(
    verifyEmittedEtfAssets({ assetRoot: path.relative(process.cwd(), assetRoot) }).payload_count,
    2,
  );
  assert.equal(applyRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).retired, 2);
  assert.equal(restoreRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).restored, 2);
  for (const ticker of ["AAA", "BBB"]) {
    assert.deepEqual(fs.readFileSync(path.join(publicRoot, `${ticker}.json`)), fs.readFileSync(path.join(canonicalRoot, `${ticker}.json`)));
  }
  for (const point of ["apply-intent", "apply-mutation", "apply-commit"]) {
    fs.rmSync(journalPath, { force: true });
    assert.throws(
      () => applyRetirementPlan({ planPath, journalPath, expectedTargetCount: 2, interruptAfter: point }),
      new RegExp(`injected interruption after ${point}`),
    );
    assert.equal(applyRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).retired, 2);
    assert.equal(restoreRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).restored, 2);
  }
  for (const point of ["restore-intent", "restore-mutation", "restore-commit"]) {
    fs.rmSync(journalPath, { force: true });
    assert.equal(applyRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).retired, 2);
    assert.throws(
      () => restoreRetirementPlan({ planPath, journalPath, expectedTargetCount: 2, interruptAfter: point }),
      new RegExp(`injected interruption after ${point}`),
    );
    assert.equal(restoreRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }).restored, 2);
  }
  const tampered = JSON.parse(fs.readFileSync(planPath, "utf8"));
  tampered.targets[0].bytes += 1;
  fs.writeFileSync(planPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(
    () => applyRetirementPlan({ planPath, journalPath, expectedTargetCount: 2 }),
    /retirement plan digest mismatch/,
  );
  console.log("stockanalysis ETF retirement tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
