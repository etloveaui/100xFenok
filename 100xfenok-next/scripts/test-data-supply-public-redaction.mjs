#!/usr/bin/env node

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { removePrivateDataSupplyPublicTrees } from "../sync-static-overrides.mjs";

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fenok-data-supply-public-redaction-"));
const appRoot = path.join(fixtureRoot, "100xfenok-next");
const guardSource = fileURLToPath(new URL("./check-fenok-public-mirror-guard.mjs", import.meta.url));
const guardFixture = path.join(appRoot, "scripts", "check-fenok-public-mirror-guard.mjs");

function writeFixture(relativePath, body = "{}\n") {
  const target = path.join(appRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

function writeRepoFixture(relativePath, body = "{}\n") {
  const target = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalSha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function jsonBody(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeValidProjection(entryOverrides = {}) {
  const ticker = "FBC";
  const sourceAsOf = "2026-07-10T00:00:00Z";
  const payload = {
    schema_version: "yf-etf-detail/v1",
    ticker,
    asset_type: "etf",
    source_provider: "yahoo_finance",
    source_as_of: sourceAsOf,
    detail_status: "yf_fallback",
    normalized: {},
  };
  const payloadBody = jsonBody(payload);
  const payloadSha = crypto.createHash("sha256").update(payloadBody).digest("hex");
  const membershipSha = canonicalSha256([ticker]);
  const entry = {
    ticker,
    enrollment_state: "enrolled",
    resolution_state: "fresh_fallback",
    provider_role: "fallback",
    fallback_depth: 1,
    source_as_of: sourceAsOf,
    selected_at: "2026-07-10T01:00:00Z",
    reason_code: "primary_unavailable_fallback_valid",
    payload_sha256: payloadSha,
    payload_path: `data/computed/data-supply/etf-detail/payloads/${ticker}.json`,
    ...entryOverrides,
  };
  const indexCore = {
    schema_version: "data-supply-etf-detail-public-index/v1",
    domain: "etf_detail",
    generated_at: "2026-07-11T00:00:00Z",
    active_transaction_id: "a".repeat(64),
    active_generation_manifest_sha256: "b".repeat(64),
    membership_sha256: membershipSha,
    enrolled_count: 1,
    selected_count: entry.resolution_state === "unavailable" ? 0 : 1,
    unavailable_count: entry.resolution_state === "unavailable" ? 1 : 0,
    state_counts: { [entry.resolution_state]: 1 },
    entries: { [ticker]: entry },
  };
  const index = { ...indexCore, index_sha256: canonicalSha256(indexCore) };
  const enrollment = {
    schema_version: "data-supply-etf-detail-enrollment/v1",
    domain: "etf_detail",
    generated_at: "2026-07-11T00:00:00Z",
    active_transaction_id: index.active_transaction_id,
    active_generation_manifest_sha256: index.active_generation_manifest_sha256,
    index_sha256: index.index_sha256,
    membership_sha256: membershipSha,
    enrolled_count: 1,
    tickers: [ticker],
  };
  for (const prefix of ["data", "100xfenok-next/public/data"]) {
    writeRepoFixture(`${prefix}/computed/data-supply/etf-detail/enrollment.json`, jsonBody(enrollment));
    writeRepoFixture(`${prefix}/computed/data-supply/etf-detail/index.json`, jsonBody(index));
    if (entry.resolution_state !== "unavailable") {
      writeRepoFixture(`${prefix}/computed/data-supply/etf-detail/payloads/${ticker}.json`, payloadBody);
    }
  }
}

function runGuard() {
  return spawnSync(process.execPath, [guardFixture], {
    cwd: appRoot,
    encoding: "utf8",
  });
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

function assertDetectionReportGuardRejected(message) {
  const result = runGuard();
  assert.notEqual(result.status, 0, message);
  assert.match(
    `${result.stderr}\n${result.stdout}`,
    /data-supply-detection-floor\.json/,
    "guard error must name the exact detection-floor report path",
  );
}

try {
  fs.mkdirSync(path.dirname(guardFixture), { recursive: true });
  fs.copyFileSync(guardSource, guardFixture);
  writeFixture("public/data/safe/keep.json");

  writeFixture("public/data/admin/data-supply-state/v1/domains/etf_detail/active.json");
  writeFixture("public/data/yf/etf-details/IEFA.json");
  writeFixture("public/data/yf/migration-evidence/etf-details/IEFA.json");

  const guardBefore = runGuard();
  assert.notEqual(guardBefore.status, 0, "guard must reject copied private data-supply trees");
  assert.match(
    guardBefore.stderr,
    /public\/data\/admin\/data-supply-state/,
    "guard error must name the forbidden data-supply state root",
  );

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

  const guardAfter = runGuard();
  assert.equal(guardAfter.status, 0, guardAfter.stderr || guardAfter.stdout);

  const safeSiblingPath = path.join(appRoot, "public/data/safe/keep.json");
  const safeSiblingBytes = fs.readFileSync(safeSiblingPath);
  const reportBody = jsonBody({
    schema_version: "data-supply-detection-floor/v1",
    generated_at: "2026-07-11T00:00:00Z",
    status: "shadow",
  });

  // Stage 2 RED: an otherwise safe-shaped exact report must be rejected before
  // cleanup, removed by the existing public-redaction API, then rejected by
  // neither the guard nor a second idempotent cleanup pass.
  writeFixture(detectionReportRelativePath, reportBody);
  assertDetectionReportGuardRejected(
    "Stage 2 RED: guard must reject the exact detection-floor report file",
  );
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
  const reportGuardAfter = runGuard();
  assert.equal(reportGuardAfter.status, 0, reportGuardAfter.stderr || reportGuardAfter.stdout);

  const reportOnlyRerun = removePrivateDataSupplyPublicTrees({ rootDir: appRoot, logger: () => {} });
  assert.equal(reportOnlyRerun.rootsRemoved, 0);
  assert.equal(reportOnlyRerun.filesRemoved, 0);
  assert.equal(reportOnlyRerun.directoriesRemoved, 0);
  assert.equal(reportOnlyRerun.staleFilesRemoved, 0);
  assert.deepEqual(fs.readFileSync(safeSiblingPath), safeSiblingBytes, "idempotent cleanup must preserve safe siblings");

  // Every non-regular node at the exact report path is fail-closed and remains
  // untouched. The guard must reject the empty-directory case explicitly; its
  // generic tree walk already rejects symlinks and special nodes.
  fs.mkdirSync(detectionReportPath);
  assertDetectionReportGuardRejected("guard must reject an empty directory at the exact report path");
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
  assertDetectionReportGuardRejected("guard must reject a symlink at the exact report path");
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
  assertDetectionReportGuardRejected("guard must reject a FIFO at the exact report path");
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

  writeFixture("public/data/stockanalysis/etfs/AAA.json", jsonBody({
    schema_version: "yf-etf-detail/v1",
    ticker: "AAA",
    asset_type: "etf",
    source_provider: "yahoo_finance",
    detail_status: "yf_fallback",
  }));
  const yahooLegacy = runGuard();
  assert.notEqual(yahooLegacy.status, 0, "guard must reject Yahoo-marked legacy ETF detail");
  assert.match(yahooLegacy.stderr, /Yahoo-marked legacy ETF detail is forbidden/);
  fs.rmSync(path.join(appRoot, "public/data/stockanalysis"), { recursive: true, force: true });

  writeValidProjection();
  const validProjection = runGuard();
  assert.equal(validProjection.status, 0, validProjection.stderr || validProjection.stdout);

  writeFixture("public/data/computed/data-supply/etf-detail/payloads/ORPHAN.json", "{}\n");
  const orphanProjection = runGuard();
  assert.notEqual(orphanProjection.status, 0, "guard must reject orphan projection payloads");
  assert.match(orphanProjection.stderr, /missing\/orphan payloads/);
  fs.rmSync(path.join(appRoot, "public/data/computed/data-supply/etf-detail/payloads/ORPHAN.json"));

  writeValidProjection({ source_as_of: "2026-07-11T00:00:00Z" });
  const replacedSourceTime = runGuard();
  assert.notEqual(replacedSourceTime.status, 0, "guard must reject source-time substitution");
  assert.match(replacedSourceTime.stderr, /source_as_of differs from immutable payload/);

  writeValidProjection({ resolution_state: "mystery", provider_role: "fallback" });
  const invalidState = runGuard();
  assert.notEqual(invalidState.status, 0, "guard must reject unknown selected states");
  assert.match(invalidState.stderr, /unsupported selected resolution_state/);

  writeValidProjection();
  writeFixture("public/data/safe/private-token.json", jsonBody({ path: "admin/data-supply-state/v1/private.json" }));
  const leakedToken = runGuard();
  assert.notEqual(leakedToken.status, 0, "guard must reject private state path tokens");
  assert.match(leakedToken.stderr, /unsafe token admin\/data-supply-state\//);
  fs.rmSync(path.join(appRoot, "public/data/safe/private-token.json"));

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

  const guardSymlink = runGuard();
  assert.notEqual(guardSymlink.status, 0, "guard must reject a symlink at a forbidden root");
  assert.match(guardSymlink.stderr, /public\/data\/yf\/etf-details: forbidden private data-supply root \(symlink\)/);

  console.log("test-data-supply-public-redaction: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
