#!/usr/bin/env node
// K1/K3 fixtures for the slim health KPI. All source and output paths stay in a temp root.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildKpiDocuments } from "./build-fenok-data-health-kpi.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";
import { deriveFamilyFreshness } from "./ops/check-pipeline-job-health.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-kpi-k1-k3-"));
const canonicalPath = path.join(root, "data", "macro", "fred-macro.json");
const publicDataRoot = path.join(root, "public", "data");
const now = "2026-09-28T03:00:00Z";
const good = { source_as_of: "2026-09-26", series: [{ date: "2026-09-26", value: 1 }] };
const valid = (doc) => doc !== null && typeof doc === "object" && !Array.isArray(doc)
  && /^\d{4}-\d{2}-\d{2}$/.test(doc.source_as_of ?? "")
  && Array.isArray(doc.series) && doc.series.length > 0;
const sourceAsOf = (doc) => doc.source_as_of;
const run = (id, observedAt) => ({ runId: id, runAttempt: 1, eventName: "schedule", observedAt });
const candidate = (bytes, sourceDate = "2026-09-26") => ({
  key: "fred_macro",
  payloadBytes: Buffer.from(bytes),
  currentRelativePath: "data/macro/fred-macro.json",
  validateDocument: valid,
  deriveSourceAsOf: sourceAsOf,
  sourceAsOf: sourceDate,
  promotion_contract: "legacy_source_marker/v1",
});

try {
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
  fs.writeFileSync(canonicalPath, `${JSON.stringify(good)}\n`);
  const store = new LaneLkgStore({ repoRoot: root, laneId: "fred_macro" });
  store.recordSuccess({
    artifacts: [candidate(JSON.stringify(good))],
    run: run("1", "2026-09-26T12:00:00Z"),
  });
  const before = store.stateSnapshot();
  const goodBytes = fs.readFileSync(canonicalPath);

  // K1: empty, malformed, and wrong-shape/date inputs cannot replace good data.
  for (const [name, bytes, date] of [
    ["empty", "", "2026-09-27"],
    ["malformed", "{", "2026-09-27"],
    ["wrong shape", JSON.stringify({ source_as_of: "2026-09-27", series: [] }), "2026-09-27"],
    ["wrong date", JSON.stringify(good), "2026-09-27"],
  ]) {
    assert.throws(() => store.recordSuccess({
      artifacts: [candidate(bytes, date)],
      run: run(`bad-${name}`, "2026-09-27T12:00:00Z"),
    }), undefined, `${name} must be rejected`);
    assert.deepEqual(store.stateSnapshot(), before, `${name} must preserve the good LKG state`);
    assert.deepEqual(fs.readFileSync(canonicalPath), goodBytes, `${name} must preserve served bytes`);
  }

  // K3: one source date and one DEC-417 status per set, with public paths redacted.
  const { rootDoc, publicDoc } = buildKpiDocuments(now, {
    dataRoot: path.join(root, "data"), publicDataRoot,
  });
  assert.ok(Array.isArray(rootDoc.sets) && rootDoc.sets.length > 0);
  const row = rootDoc.sets.find((set) => set.set === "fred_macro");
  assert.ok(row, "FRED fixture must appear as one data set");
  assert.deepEqual(Object.keys(row).sort(), [
    "set", "served_path", "newest_source_date", "max_age", "last_success_at",
    "consecutive_failures", "serving_lkg", "status",
  ].sort());
  assert.equal(row.served_path, "data/macro/fred-macro.json");
  assert.equal(row.newest_source_date, "2026-09-26");
  assert.match(row.max_age, /^\d+d$/);
  assert.equal(row.last_success_at, "2026-09-26T12:00:00Z");
  assert.equal(row.consecutive_failures, 0);
  assert.equal(row.serving_lkg, false);
  assert.ok(["fresh", "delayed", "stopped"].includes(row.status));
  assert.ok(Array.isArray(publicDoc.sets));
  assert.equal(JSON.stringify(publicDoc).includes("data/admin/fred_macro"), false);

  // Existing alarm path changes state on the second consecutive failed fetch.
  const records = [
    { result: "published", observed_at: "2026-09-26T12:00:00Z" },
    { result: "failed", observed_at: "2026-09-27T12:00:00Z" },
  ];
  const first = deriveFamilyFreshness({ records, now, maxAgeHours: 100 });
  assert.equal(first.consecutive_non_success, 1);
  assert.equal(first.state, "delayed");
  const second = deriveFamilyFreshness({
    records: [...records, { result: "failed", observed_at: "2026-09-28T02:00:00Z" }],
    now, maxAgeHours: 100,
  });
  assert.equal(second.consecutive_non_success, 2);
  assert.equal(second.state, "unavailable");
  assert.ok(second.triggered_by.includes("consecutive_non_success"));
  console.log("K1/K3 KPI fixtures passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
