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
const guardSource = fileURLToPath(new URL("./check-fenok-public-mirror-guard.mjs", import.meta.url));
const guardFixture = path.join(appRoot, "scripts", "check-fenok-public-mirror-guard.mjs");

function writeFixture(relativePath, body = "{}\n") {
  const target = path.join(appRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, body, "utf8");
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
