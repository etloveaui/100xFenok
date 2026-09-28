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

assert.equal(names(dailyRoot).length, 49, "daily-wrap source must remain 49 files");
assert.equal(names(alphaRoot).length, 3, "alpha-scout source must remain 3 files");
assert.equal(names(canonicalRoot).length, 52, "canonical union must remain 52 files");
assert.equal(names(siteDailyRoot).length, 49, "site-local daily-wrap mirror must remain preserved");
assert.equal(names(siteAlphaRoot).length, 3, "site-local alpha-scout mirror must remain preserved");

const tracked = spawnSync("git", ["ls-files", "--", "100xfenok-next/public/data/metadata"], {
  cwd: root,
  encoding: "utf8",
});
assert.equal(tracked.status, 0, tracked.stderr);
assert.equal(tracked.stdout.trim(), "", "canonical-only public metadata must have zero tracked twins");
for (const name of names(canonicalRoot)) {
  const ignored = spawnSync("git", ["check-ignore", "-q", `100xfenok-next/public/data/metadata/${name}`], { cwd: root });
  assert.equal(ignored.status, 0, `public metadata path must be ignored: ${name}`);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "site-metadata-sync-"));
const sourceRoot = path.join(fixtureRoot, "data");
const destinationRoot = path.join(fixtureRoot, "public-data");
fs.mkdirSync(path.join(sourceRoot, "metadata"), { recursive: true });
for (const name of names(canonicalRoot)) {
  fs.copyFileSync(path.join(canonicalRoot, name), path.join(sourceRoot, "metadata", name));
}
const result = syncPublicData({ sourceRoot, destinationRoot });
const reconstructed = names(path.join(destinationRoot, "metadata"));
assert.deepEqual(reconstructed, names(canonicalRoot), "generic sync must reconstruct the exact 52-path set");
for (const name of reconstructed) {
  assert.equal(
    fs.readFileSync(path.join(canonicalRoot, name)).equals(fs.readFileSync(path.join(destinationRoot, "metadata", name))),
    true,
    `generic sync byte mismatch: ${name}`,
  );
}
assert.equal(result.filesCopied, 52);

const canonicalManifest = JSON.parse(fs.readFileSync(path.join(root, "data/manifest.json"), "utf8"));
const publicManifest = JSON.parse(fs.readFileSync(path.join(root, "100xfenok-next/public/data/manifest.json"), "utf8"));
assert.equal(canonicalManifest.folders.metadata.file_count, 52);
assert.equal(publicManifest.folders.metadata.file_count, 52);

console.log("test-site-metadata-canonical-only: ok (52/52 byte-identical reconstruction; manifest 52)");
