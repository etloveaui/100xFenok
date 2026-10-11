#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncPublicData } from "../100xfenok-next/scripts/sync-public-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = path.join(root, "data/metadata");
const dailyRoot = path.join(root, "100x/data/metadata");
const alphaRoot = path.join(root, "alpha-scout/data/metadata");
const publicRoot = path.join(root, "100xfenok-next/public/data/metadata");
const siteDailyRoot = path.join(root, "100xfenok-next/public/100x/data/metadata");
const siteAlphaRoot = path.join(root, "100xfenok-next/public/alpha-scout/data/metadata");
const names = (directory) => fs.readdirSync(directory)
  .filter((name) => fs.lstatSync(path.join(directory, name)).isFile())
  .sort();


const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-metadata-sync-"));
const sourceRoot = path.join(fixtureRoot, "data");
const destinationRoot = path.join(fixtureRoot, "public-data");
fs.mkdirSync(path.join(sourceRoot, "metadata"), { recursive: true });
for (const name of names(canonicalRoot)) {
  fs.copyFileSync(path.join(canonicalRoot, name), path.join(sourceRoot, "metadata", name));
}
const result = syncPublicData({ sourceRoot, destinationRoot });
const reconstructed = names(path.join(destinationRoot, "metadata"));
assert.deepEqual(reconstructed, names(canonicalRoot), "generic sync must reconstruct the canonical metadata");
for (const name of reconstructed) {
  assert.equal(
    fs.readFileSync(path.join(canonicalRoot, name)).equals(fs.readFileSync(path.join(destinationRoot, "metadata", name))),
    true,
    `generic sync byte mismatch: ${name}`,
  );
}

console.log("test-site-metadata-canonical-only: ok (canonical metadata reconstruction)");
