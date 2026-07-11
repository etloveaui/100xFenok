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
  });
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/admin/data-supply-state")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/yf/etf-details")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/yf/migration-evidence")), false);
  assert.equal(fs.existsSync(path.join(appRoot, "public/data/safe/keep.json")), true);
  assert.ok(logs.some((line) => /removed 3 files/.test(line)), "redaction log must include the removed file count");

  const guardAfter = runGuard();
  assert.equal(guardAfter.status, 0, guardAfter.stderr || guardAfter.stdout);

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
    { rootsRemoved: 0, filesRemoved: 0, directoriesRemoved: 0 },
    "an absent tree must be an idempotent no-op",
  );

  const outside = path.join(fixtureRoot, "outside-state");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.json"), "{}\n", "utf8");
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

  const guardSymlink = runGuard();
  assert.notEqual(guardSymlink.status, 0, "guard must reject a symlink at a forbidden root");
  assert.match(guardSymlink.stderr, /public\/data\/yf\/etf-details: forbidden private data-supply root \(symlink\)/);

  console.log("test-data-supply-public-redaction: ok");
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}
