#!/usr/bin/env node
/**
 * check-public-data-asset-budget.mjs — early size gate for the public data
 * mirror (fh-654).
 *
 * Cloudflare serves the mirror from static assets, and a single asset may not
 * exceed 25 MiB. This gate runs inside the public-data sync step so an oversized
 * file fails the build immediately, naming the file, instead of surfacing later
 * as an opaque wrangler dry-run failure. Paths the lane registry routes elsewhere
 * are exempt by construction because they never reach the public mirror.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deriveExcludedPublicDataFiles } from "../../scripts/lib/lane-routing.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(SCRIPT_DIR, "..");
const rootFlagIndex = process.argv.indexOf("--public-root");
const PUBLIC_ROOT = rootFlagIndex >= 0 && process.argv[rootFlagIndex + 1]
  ? path.resolve(process.argv[rootFlagIndex + 1])
  : path.join(APP_ROOT, "public");
const PUBLIC_DATA_ROOT = path.join(PUBLIC_ROOT, "data");
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

const excludedFiles = new Set(
  deriveExcludedPublicDataFiles().map((relativePath) => `data/${relativePath}`),
);

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(absolutePath);
    } else if (entry.isFile()) {
      yield absolutePath;
    }
  }
}

function main() {
  if (!fs.existsSync(PUBLIC_DATA_ROOT)) {
    console.log("public data mirror absent; asset budget gate skipped");
    return 0;
  }
  const oversized = [];
  for (const absolutePath of walk(PUBLIC_DATA_ROOT)) {
    const relativePath = path.relative(PUBLIC_ROOT, absolutePath).split(path.sep).join("/");
    if (excludedFiles.has(relativePath)) continue;
    const size = fs.statSync(absolutePath).size;
    if (size > MAX_ASSET_BYTES) oversized.push({ relativePath, size });
  }
  if (oversized.length > 0) {
    for (const { relativePath, size } of oversized) {
      console.error(
        `oversized public asset: /${relativePath} is ${(size / (1024 * 1024)).toFixed(2)} MiB (limit 25 MiB)`,
      );
    }
    console.error(
      "public-data asset budget failed: split or route the named files before building the worker bundle",
    );
    return 1;
  }
  console.log("public-data asset budget ok (all mirrored files <= 25 MiB)");
  return 0;
}

process.exitCode = main();
