#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { removePrivateDataSupplyPublicTrees } from "../sync-static-overrides.mjs";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-data-supply-public-redaction-"));
const appRoot = path.join(fixtureRoot, "100xfenok-next");
function writeFixture(relativePath, body = "{}\n") {
  const target = path.join(appRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

function jsonBody(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const detectionReportRelativePath = "public/data/admin/data-supply-detection-floor.json";
const detectionReportPath = path.join(appRoot, detectionReportRelativePath);

function removeNodeAt(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      fs.rmSync(target, { recursive: true });
    } else {
      fs.unlinkSync(target);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function removeFixtureNode(relativePath) {
  removeNodeAt(path.join(appRoot, relativePath));
}

try {
  writeFixture("public/data/safe/keep.json");

  writeFixture("public/data/admin/data-supply-state/v1/domains/etf_detail/active.json");
  writeFixture("public/data/yf/etf-details/IEFA.json");
  writeFixture("public/data/yf/migration-evidence/etf-details/IEFA.json");

  const logs = [];
  const removed = removePrivateDataSupplyPublicTrees({
    rootDir: appRoot,
    logger: (line) => logs.push(line),
  });
  assert.deepEqual(removed, {
    rootsRemoved: 3,
    filesRemoved: 3,
    directoriesRemoved: 7,
    staleFilesRemoved: 0,
  });
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/admin/data-supply-state")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/yf/etf-details")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/yf/migration-evidence")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/safe/keep.json")), true);
  assert.ok(logs.some((line) => /removed 3 files/.test(line)), "redaction log must include the removed file count");

  const safeSiblingPath = path.join(appRoot, "public/data/safe/keep.json");
  const safeSiblingBytes = fs.readFileSync(safeSiblingPath);
  const reportBody = jsonBody({
    schema_version: "data-supply-detection-floor/v1",
    generated_at: "2026-07-11T00:00:00Z",
    status: "shadow",
  });

  // Cleanup removes only the exact stale report and preserves safe siblings.
  // A second cleanup pass must remain an idempotent no-op.
  writeFixture(detectionReportRelativePath, reportBody);
  const reportOnlyLogs = [];
  const reportOnlyRemoved = removePrivateDataSupplyPublicTrees({
    rootDir: appRoot,
    logger: (line) => reportOnlyLogs.push(line),
  });
  assert.equal(reportOnlyRemoved.rootsRemoved, 0);
  assert.equal(reportOnlyRemoved.filesRemoved, 0);
  assert.equal(reportOnlyRemoved.directoriesRemoved, 0);
  assert.equal(reportOnlyRemoved.staleFilesRemoved, 1);
  assert.equal(fs.existsSync(detectionReportPath), false, "report-only cleanup must remove the exact file");
  assert.deepEqual(fs.readFileSync(safeSiblingPath), safeSiblingBytes, "report cleanup must preserve safe siblings");
  assert.ok(
    reportOnlyLogs.some((line) => /data-supply-detection-floor\.json/.test(line)),
    "report-only cleanup must log the exact removed path",
  );
  const reportOnlyRerun = removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} });
  assert.equal(reportOnlyRerun.rootsRemoved, 0);
  assert.equal(reportOnlyRerun.filesRemoved, 0);
  assert.equal(reportOnlyRerun.directoriesRemoved, 0);
  assert.equal(reportOnlyRerun.staleFilesRemoved, 0);
  assert.deepEqual(fs.readFileSync(safeSiblingPath), safeSiblingBytes, "idempotent cleanup must preserve safe siblings");

  // Every non-regular node at the exact report path is fail-closed and remains
  // untouched; cleanup must refuse directories, symlinks and special nodes.
  fs.mkdirSync(detectionReportPath);
  assert.throws(
    () => removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
    /directory|regular file|node type|unsafe/i,
    "cleanup must refuse an empty directory at the exact report path",
  );
  assert.equal(fs.lstatSync(detectionReportPath).isDirectory(), true);
  assert.deepEqual(fs.readFileSync(safeSiblingPath), safeSiblingBytes);
  removeNodeAt(detectionReportPath);

  const outsideReport = path.join(fixtureRoot, "outside-detection-report.json");
  fs.writeFileSync(outsideReport, "outside-report\n", "utf8");
  fs.symlinkSync(outsideReport, detectionReportPath, "file");
  assert.throws(
    () => removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
    /symlink/i,
    "cleanup must refuse a symlink at the exact report path",
  );
  assert.equal(fs.lstatSync(detectionReportPath).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(outsideReport, "utf8"), "outside-report\n");
  assert.deepEqual(fs.readFileSync(safeSiblingPath), safeSiblingBytes);
  removeNodeAt(detectionReportPath);

  fs.mkdirSync(path.dirname(detectionReportPath), { recursive: true });
  const mkfifoResult = spawnSync("mkfifo", [detectionReportPath], { encoding: "utf8" });
  assert.equal(mkfifoResult.status, 0, mkfifoResult.stderr || "mkfifo failed");
  assert.throws(
    () => removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
    /special|regular file|node type|fifo|unsafe/i,
    "cleanup must refuse a FIFO at the exact report path",
  );
  assert.equal(fs.lstatSync(detectionReportPath).isFIFO(), true);
  assert.deepEqual(fs.readFileSync(safeSiblingPath), safeSiblingBytes);
  removeNodeAt(detectionReportPath);

  // Cross-target direction 1: an unsafe report must prevent an earlier safe
  // private root from being removed.
  const reportUnsafePrivateRelative = "public/data/admin/data-supply-state/v1/report-unsafe-must-remain.json";
  const reportUnsafePrivatePath = path.join(appRoot, reportUnsafePrivateRelative);
  writeFixture(reportUnsafePrivateRelative, "private-must-remain\n");
  fs.symlinkSync(outsideReport, detectionReportPath, "file");
  assert.throws(
    () => removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
    /symlink/i,
    "an unsafe report must block every private-root removal",
  );
  assert.equal(fs.readFileSync(reportUnsafePrivatePath, "utf8"), "private-must-remain\n");
  assert.equal(fs.lstatSync(detectionReportPath).isSymbolicLink(), true);
  removeNodeAt(detectionReportPath);
  removeFixtureNode("public/data/admin/data-supply-state");

  // Identity drift between the report preflight and first mutation must abort
  // before any private-root or report byte is removed.
  const driftPrivateRelative = "public/data/admin/data-supply-state/v1/drift-must-remain.json";
  const driftPrivatePath = path.join(appRoot, driftPrivateRelative);
  const driftReplacementPath = path.join(fixtureRoot, "drift-replacement.json");
  writeFixture(driftPrivateRelative, "drift-private-must-remain\n");
  writeFixture(detectionReportRelativePath, "original-report\n");
  fs.writeFileSync(driftReplacementPath, "replacement-report\n", "utf8");
  const originalLstatSync = fs.lstatSync;
  let reportLstatCalls = 0;
  fs.lstatSync = function driftAwareLstatSync(target, ...args) {
    if (path.resolve(String(target)) === detectionReportPath) {
      reportLstatCalls += 1;
      if (reportLstatCalls === 2) fs.renameSync(driftReplacementPath, detectionReportPath);
    }
    return originalLstatSync.call(fs, target, ...args);
  };
  try {
    assert.throws(
      () => removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
      /changed|drift|identity/i,
      "report identity drift must abort before the first mutation",
    );
  } finally {
    fs.lstatSync = originalLstatSync;
  }
  assert.ok(reportLstatCalls >= 2, "cleanup must revalidate the report identity before mutation");
  assert.equal(fs.readFileSync(driftPrivatePath, "utf8"), "drift-private-must-remain\n");
  assert.equal(fs.readFileSync(detectionReportPath, "utf8"), "replacement-report\n");
  removeNodeAt(detectionReportPath);
  removeNodeAt(driftReplacementPath);
  removeFixtureNode("public/data/admin/data-supply-state");

  assert.deepEqual(
    removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
    { rootsRemoved: 0, filesRemoved: 0, directoriesRemoved: 0, staleFilesRemoved: 0 },
    "an absent tree must be an idempotent no-op",
  );

  const outside = path.join(fixtureRoot, "outside-state");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.json"), "{}\n", "utf8");
  writeFixture(detectionReportRelativePath, "report-must-remain\n");
  writeFixture("public/data/admin/data-supply-state/v1/must-remain.json");
  const symlinkPath = path.join(appRoot, "public/data/yf/etf-details");
  fs.symlinkSync(outside, symlinkPath, "dir");

  assert.throws(
    () => removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} }),
    /symlink/i,
    "redaction must refuse a symlinked forbidden root",
  );
  assert.equal(fs.lstatSync(symlinkPath).isSymbolicLink(), true, "refused symlink must remain untouched");
  assert.equal(
    fs.existsSync(path.join(appRoot, "public/data/admin/data-supply-state/v1/must-remain.json")),
    true,
    "preflight refusal must not partially remove an earlier allowlisted tree",
  );
  assert.equal(
    fs.readFileSync(detectionReportPath, "utf8"),
    "report-must-remain\n",
    "an unsafe private root must not partially remove the exact report",
  );

  // The public-data PRODUCER, not only sync-static, must strip private artifact
  // paths. sync-static sits in no producer path, so every regeneration through
  // sync-public-data.mjs republished the private tree structure the mirror guard
  // forbids. Run the real producer over a fixture and hold both halves of the
  // contract at once: the served projection is redacted, the canonical copy is
  // not, because the edge coverage-index builder reads it to open the private
  // manifests.
  {
    const producerMirrors = [
      "admin/fenok-flow-backfill-index.json",
      "admin/krx/lkg/bridge.json",
      "admin/taiwan-data-bridge-index.json",
      "computed/taiwan-data-bridge-index.json",
    ];
    const producerRoot = path.join(fixtureRoot, "producer");
    const producerSource = path.join(producerRoot, "data");
    const producerDestination = path.join(producerRoot, "100xfenok-next", "public", "data");
    const poisoned = {
      schema: "bridge/1",
      kept_field: "must survive",
      private_manifest_file: "_private/admin/taiwan/20260818/manifest.json",
      note: "raw captures stay under _private/admin/taiwan and never ship",
    };
    for (const relativePath of producerMirrors) {
      const target = path.join(producerSource, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, jsonBody(poisoned), "utf8");
    }
    const recoveryRoot = "admin/stockanalysis-recovery";
    const recoveryFixtures = {
      [`${recoveryRoot}/states/stock/SAFE.json`]: jsonBody({
        artifact_kind: "stock", entity: "SAFE", resolution_state: "lkg_primary", retry: true,
        lkg: { path: `data/${recoveryRoot}/lkg/stock/SAFE.json` },
      }),
      [`${recoveryRoot}/lkg/stock/SAFE.json`]: jsonBody({ ticker: "SAFE", retained_good: true }),
    };
    for (const [relativePath, body] of Object.entries(recoveryFixtures)) {
      for (const root of [producerSource, producerDestination]) {
        const target = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, body, "utf8");
      }
    }
    const servedRelativePath = "stockanalysis/stocks/SAFE.json";
    const servedBody = jsonBody({ ticker: "SAFE", source: "stockanalysis" });
    const servedSource = path.join(producerSource, servedRelativePath);
    fs.mkdirSync(path.dirname(servedSource), { recursive: true });
    fs.writeFileSync(servedSource, servedBody, "utf8");
    fs.mkdirSync(producerDestination, { recursive: true });

    const producer = spawnSync(process.execPath, [
      fileURLToPath(new URL("./sync-public-data.mjs", import.meta.url)),
      "--write",
      "--source", producerSource,
      "--destination", producerDestination,
    ], { encoding: "utf8" });
    assert.equal(producer.status, 0, `producer must succeed: ${producer.stderr}`);
    assert.equal(fs.existsSync(path.join(producerDestination, recoveryRoot)), false,
      "sync must prune the stale public recovery copy without republishing canonical recovery data");
    for (const [relativePath, body] of Object.entries(recoveryFixtures)) {
      assert.deepEqual(fs.readFileSync(path.join(producerSource, relativePath)), Buffer.from(body),
        "public recovery retirement must preserve exact canonical state and retained-good bytes");
    }
    assert.deepEqual(fs.readFileSync(path.join(producerDestination, servedRelativePath)), Buffer.from(servedBody),
      "ordinary StockAnalysis serving data must still reach the public projection");
    assert.deepEqual(fs.readFileSync(servedSource), Buffer.from(servedBody));

    for (const relativePath of producerMirrors) {
      const projectedBody = fs.readFileSync(path.join(producerDestination, relativePath), "utf8");
      const projected = JSON.parse(projectedBody);
      assert.equal(projected.kept_field, "must survive", `${relativePath}: unrelated fields must survive`);
      assert.ok(
        !Object.hasOwn(projected, "private_manifest_file"),
        `${relativePath}: the private reference key must be dropped`,
      );
      assert.ok(
        !projectedBody.includes("_private/"),
        `${relativePath}: no private path may reach the served projection`,
      );
      assert.match(projected.note, /<private-raw-tree>/);

      const canonicalBody = fs.readFileSync(path.join(producerSource, relativePath), "utf8");
      assert.ok(
        canonicalBody.includes("_private/") && canonicalBody.includes("private_manifest_file"),
        `${relativePath}: the canonical copy must keep its private reference`,
      );
    }
    console.log(`public-data producer redaction ok (${producerMirrors.length} mirrors stripped, canonical intact)`);
  }

  console.log("test-data-supply-public-redaction: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
