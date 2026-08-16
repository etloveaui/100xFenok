#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { removePrivateEdgarPublicTree } from "../100xfenok-next/sync-static-overrides.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(ROOT, "100xfenok-next", "public", "data", "edgar");
const canonicalRoot = path.join(ROOT, "data", "edgar");
const rimFiles = fs.readdirSync(path.join(canonicalRoot, "rim-dow"))
  .filter((name) => name.endsWith(".json"))
  .sort();
assert.equal(rimFiles.length, 30, "the bounded RIM-DOW public exclusion must cover all 30 canonical inputs");

const removed = ["company_tickers.json", ...rimFiles.map((name) => `rim-dow/${name}`)];
for (const relative of removed) {
  const publicPath = path.join(publicRoot, relative);
  const canonicalPath = path.join(canonicalRoot, relative);
  assert.equal(fs.existsSync(publicPath), false, `public EDGAR research copy remains: ${relative}`);
  assert.equal(fs.existsSync(canonicalPath), true, `canonical EDGAR input missing: ${relative}`);
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", `100xfenok-next/public/data/edgar/${relative}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(ignored.status, 0, `public EDGAR research copy is not ignored: ${relative}`);
}

const receipts = [
  "r1-panel/dei-refetch-receipt.json",
  "r1-panel/duration-refetch-receipt.json",
  "r1-panel/price-fetch-receipt.json",
  "r1-panel/primary-e-fetch-receipt.json",
  "r1-panel/sic-fetch-receipt.json",
  "r2-panel/dividend-fetch-receipt.json",
  "r3-panel/r3-dividend-fetch-receipt.json",
  "r3-panel/r3-price-fetch-receipt.json",
];
for (const relative of receipts) {
  assert.deepEqual(
    fs.readFileSync(path.join(publicRoot, relative)),
    fs.readFileSync(path.join(canonicalRoot, relative)),
    `retained EDGAR receipt must remain byte-identical: ${relative}`,
  );
}

const overrides = fs.readFileSync(path.join(ROOT, "100xfenok-next", "sync-static-overrides.mjs"), "utf8");
for (const relative of removed) {
  assert.equal(
    overrides.includes(`public/data/edgar/${relative}`),
    true,
    `sync-static-overrides must remove ${relative}`,
  );
}

function listFiles(directory, prefix = "", result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(absolute, relative, result);
    else result.push(relative);
  }
  return result.sort();
}

assert.deepEqual(
  listFiles(publicRoot),
  receipts.slice().sort(),
  "public EDGAR must retain receipts only; ignored cache residue is not an allowed boundary",
);

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-public-boundary-"));
try {
  const fixturePublic = path.join(fixtureRoot, "public/data/edgar");
  fs.mkdirSync(path.join(fixturePublic, "r1-panel/prices"), { recursive: true });
  fs.mkdirSync(path.join(fixturePublic, "r2-panel"), { recursive: true });
  fs.writeFileSync(path.join(fixturePublic, "r1-panel/prices/KEY.json"), "private\n");
  fs.writeFileSync(path.join(fixturePublic, "r2-panel/dividend-fetch-receipt.json"), "receipt\n");
  const result = removePrivateEdgarPublicTree({ baseDir: fixtureRoot, logger: () => {} });
  assert.equal(result.filesRemoved, 1, "fixture private EDGAR cache must be removed");
  assert.equal(fs.existsSync(path.join(fixturePublic, "r1-panel/prices/KEY.json")), false);
  assert.equal(fs.existsSync(path.join(fixturePublic, "r2-panel/dividend-fetch-receipt.json")), true);
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

assert.deepEqual(
  fs.readFileSync(path.join(ROOT, "data/manifest.json")),
  fs.readFileSync(path.join(ROOT, "100xfenok-next/public/data/manifest.json")),
  "the public catalog must remain the canonical data catalog; only the explicit EDGAR public boundary changes",
);

console.log("[test-edgar-public-exclusion] OK");
