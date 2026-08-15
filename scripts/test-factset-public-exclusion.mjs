#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const family = "factset-earnings-insight";
const publicRoot = path.join(ROOT, "100xfenok-next", "public", "data", family);
const canonicalRoot = path.join(ROOT, "data", family);
const removed = [
  "fetch-parent.py",
  "fetch.py",
  "parse.py",
  "probe-log.jsonl",
  "zacks-render-test.py",
];
const receipt = "archives/receipt.json";

for (const relative of removed) {
  const publicPath = path.join(publicRoot, relative);
  const canonicalPath = path.join(canonicalRoot, relative);
  assert.equal(fs.existsSync(publicPath), false, `public FactSet residue remains: ${relative}`);
  assert.equal(fs.existsSync(canonicalPath), true, `canonical FactSet control file missing: ${relative}`);
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "-q", "--", `100xfenok-next/public/data/${family}/${relative}`], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(ignored.status, 0, `public FactSet residue is not ignored: ${relative}`);
}

assert.deepEqual(
  fs.readFileSync(path.join(publicRoot, receipt)),
  fs.readFileSync(path.join(canonicalRoot, receipt)),
  "the retained public provenance receipt must remain byte-identical",
);

const overrides = fs.readFileSync(path.join(ROOT, "100xfenok-next", "sync-static-overrides.mjs"), "utf8");
for (const relative of removed) {
  assert.equal(
    overrides.includes(`public/data/${family}/${relative}`),
    true,
    `sync-static-overrides must remove ${relative}`,
  );
}

const usageManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data/admin/data-usage-manifest.json"), "utf8"));
const usageEntries = Array.isArray(usageManifest)
  ? usageManifest
  : (usageManifest.categories ?? usageManifest.entries ?? usageManifest.families ?? []);
const usage = usageEntries.find((entry) => entry.category === family);
assert.deepEqual(
  {
    publicJsonCount: usage?.publicJsonCount,
    directFetchCount: usage?.directFetchCount,
    status: usage?.status,
  },
  { publicJsonCount: 1, directFetchCount: 0, status: "catalog_only" },
  "the retained receipt remains the catalog-only public boundary",
);

console.log("[test-factset-public-exclusion] OK");
