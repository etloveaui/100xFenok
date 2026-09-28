#!/usr/bin/env node
// K1/K3 fixtures for the slim health KPI. All source and output paths stay in a temp root.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildKpiDocuments } from "./build-fenok-data-health-kpi.mjs";
import { validateKpiDocuments } from "./check-fenok-data-health-kpi.mjs";
import { LaneLkgStore } from "./lib/data-supply-lkg-store.mjs";

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

  // A fresh source can be served from LKG while its age still meets policy.
  store.recordFailure({
    artifacts: [{
      key: "fred_macro",
      canonicalPath,
      validateDocument: valid,
      sourceAsOf,
    }],
    run: run("failed-fetch", "2026-09-27T12:00:00Z"),
    reason: "http_error",
  });
  const floorPath = path.join(root, "data", "admin", "data-supply-detection-floor.json");
  fs.mkdirSync(path.dirname(floorPath), { recursive: true });
  fs.writeFileSync(floorPath, `${JSON.stringify({
    schema_version: "data-supply-detection-floor/v2",
    lanes: [
      {
        id: "fred_macro",
        status: "unavailable",
        artifact: { status: "ready", source_as_of: "2026-09-26" },
      },
      {
        id: "treasury_tga",
        status: "ready",
        artifact: { status: "ready", source_as_of: "2026-09-25" },
      },
      {
        id: "fred_banking",
        status: "ready",
        artifact: { status: "ready", source_as_of: "2026-01-01" },
        source_artifacts: [
          { id: "fred_banking_daily", path: "data/macro/fred-banking-daily.json", source_as_of: "2026-09-01" },
          { id: "fred_banking_weekly", path: "data/macro/fred-banking-weekly.json", source_as_of: "2026-09-16" },
          { id: "fred_banking_monthly", path: "data/macro/fred-banking-monthly.json", source_as_of: "2026-08-01" },
          { id: "fred_banking_quarterly", path: "data/macro/fred-banking-quarterly.json", source_as_of: "2026-01-01" },
        ],
      },
    ],
  })}\n`);

  // K3: one source date and one freshness-policy status per set.
  const { rootDoc, publicDoc } = buildKpiDocuments(now, {
    dataRoot: path.join(root, "data"), publicDataRoot,
  });
  assert.ok(Array.isArray(rootDoc.sets) && rootDoc.sets.length > 0);
  const row = rootDoc.sets.find((set) => set.set === "fred_macro");
  assert.ok(row, "FRED fixture must appear as one data set");
  assert.deepEqual(Object.keys(row).sort(), [
    "set", "served_path", "newest_source_date", "max_age", "serving_lkg", "status",
  ].sort());
  assert.equal(row.served_path, "data/macro/fred-macro.json");
  assert.equal(row.newest_source_date, "2026-09-26");
  assert.match(row.max_age, /^\d+d$/);
  assert.equal(row.serving_lkg, true);
  assert.equal(row.status, "fresh", "status follows source age even when the floor reports an unavailable attempt");
  const tga = rootDoc.sets.find((set) => set.set === "treasury_tga");
  assert.ok(tga, "Treasury TGA fixture must appear as one data set");
  assert.equal(tga.status, "fresh", "US federal holidays are applied when judging TGA source age");
  const banking = rootDoc.sets.find((set) => set.set === "fred_banking");
  assert.ok(banking, "FRED banking fixture must appear as one data set");
  assert.equal(banking.newest_source_date, "2026-09-16");
  assert.equal(banking.status, "stopped", "a stale daily file cannot be hidden by the quarterly policy/date");
  const checked = validateKpiDocuments(rootDoc, publicDoc, { dataRoot: path.join(root, "data") });
  assert.deepEqual(checked.errors, [], "the checker accepts the same calendar- and file-policy-aware result");
  const badTga = structuredClone(rootDoc);
  badTga.sets.find((set) => set.set === "treasury_tga").status = "stopped";
  const rejected = validateKpiDocuments(badTga, publicDoc, { dataRoot: path.join(root, "data") });
  assert.ok(
    rejected.errors.some((error) => error.includes("status does not match source age and freshness-policy")),
    "the checker rejects a declared TGA status that disagrees with source freshness",
  );
  assert.ok(Array.isArray(publicDoc.sets));
  assert.equal(JSON.stringify(publicDoc).includes("data/admin/fred_macro"), false);
  console.log("K1/K3 KPI fixtures passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
