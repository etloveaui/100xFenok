#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { syncPublicData } from "../100xfenok-next/scripts/sync-public-data.mjs";

const names = (directory) => fs.readdirSync(directory)
  .filter((name) => fs.lstatSync(path.join(directory, name)).isFile())
  .sort();


const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-metadata-sync-"));
const sourceRoot = path.join(fixtureRoot, "data");
const destinationRoot = path.join(fixtureRoot, "public-data");
fs.mkdirSync(path.join(sourceRoot, "metadata"), { recursive: true });
const fixtures = {
  'daily.json': '{"date":"2026-01-01","title":"Daily fixture"}\n',
  'alpha-scout.json': '{"date":"2026-01-02","title":"Alpha fixture"}\n',
};
for (const [name, contents] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(sourceRoot, 'metadata', name), contents);
}
const result = syncPublicData({ sourceRoot, destinationRoot });
const reconstructed = names(path.join(destinationRoot, "metadata"));
assert.deepEqual(reconstructed, Object.keys(fixtures).sort(), "generic sync must reconstruct the canonical metadata");
for (const name of reconstructed) {
  assert.equal(
    fs.readFileSync(path.join(destinationRoot, "metadata", name), "utf8") === fixtures[name],
    true,
    `generic sync byte mismatch: ${name}`,
  );
}

console.log("test-site-metadata-canonical-only: ok (canonical metadata reconstruction)");
