#!/usr/bin/env node
/**
 * split-oversized-sec13f-investors.mjs — size-triggered split of the SEC 13F
 * investor public mirror (fh-654).
 *
 * The public mirror is the surface Cloudflare serves from static assets, where a
 * single asset may not exceed 25 MiB. This step compact-serializes every investor
 * mirror file and, when the compact form would still exceed the split trigger
 * (16 MiB, conservative below the 25 MiB asset limit), rewrites the file as a
 * small parts manifest plus quarter-range part files under `<investor>/`. Parts
 * are packed at quarter boundaries by actual serialized bytes and may never
 * exceed 20 MiB each; a single quarter over the cap fails the build by name.
 * Consumers that understand the manifest load the parts and keep the complete
 * history; every other investor keeps a single unchanged file.
 *
 * Registry-excluded paths (for example the private griffin investor) never reach
 * the public mirror and are ignored here. Re-running is idempotent: an existing
 * parts manifest is left as written.
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
const INVESTORS_DIR = path.join(PUBLIC_ROOT, "data/sec-13f/investors");
const MANIFEST_SCHEMA = "sec13f-investor-parts/v1";
const DEFAULT_CAP_BYTES = 16 * 1024 * 1024;
const DEFAULT_PART_CAP_BYTES = 20 * 1024 * 1024;

function readCap(envName, fallback) {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`invalid ${envName}: ${raw}`);
  }
  return parsed;
}

const capBytes = readCap("SEC13F_INVESTOR_SPLIT_CAP_BYTES", DEFAULT_CAP_BYTES);
const partCapBytes = readCap("SEC13F_INVESTOR_PART_CAP_BYTES", DEFAULT_PART_CAP_BYTES);

const excludedFiles = new Set(
  deriveExcludedPublicDataFiles().map((relativePath) => `data/${relativePath}`),
);

function compactBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function oversizedQuarterError(id, quarter) {
  return new Error(
    `single quarter ${quarter ?? "?"} of ${id} exceeds the ${partCapBytes}-byte part cap`,
  );
}

function packParts(id, filings) {
  const parts = [];
  let current = [];
  for (const filing of filings) {
    const candidate = [...current, filing];
    if (Buffer.byteLength(JSON.stringify({ filings: candidate })) > partCapBytes) {
      if (current.length === 0) throw oversizedQuarterError(id, filing?.quarter);
      parts.push(current);
      current = [filing];
      if (Buffer.byteLength(JSON.stringify({ filings: current })) > partCapBytes) {
        throw oversizedQuarterError(id, filing?.quarter);
      }
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

function splitInvestor(absolutePath, id, investor, filings, rest) {
  const partsDir = path.join(INVESTORS_DIR, id);
  fs.rmSync(partsDir, { recursive: true, force: true });
  fs.mkdirSync(partsDir, { recursive: true });
  const parts = [];
  for (const slice of packParts(id, filings)) {
    const partName = `part-${String(parts.length + 1).padStart(2, "0")}.json`;
    const body = JSON.stringify({ filings: slice });
    if (Buffer.byteLength(body) > partCapBytes) {
      throw oversizedQuarterError(id, slice[0]?.quarter);
    }
    fs.writeFileSync(path.join(partsDir, partName), body);
    parts.push({
      path: `/data/sec-13f/investors/${id}/${partName}`,
      count: slice.length,
      quarters: [slice[0]?.quarter ?? null, slice[slice.length - 1]?.quarter ?? null],
    });
  }
  const manifest = {
    ...rest,
    schema: MANIFEST_SCHEMA,
    investor,
    filings_total: filings.length,
    parts,
  };
  fs.writeFileSync(absolutePath, JSON.stringify(manifest));
  console.log(`split ${id}: ${filings.length} quarters -> ${parts.length} parts`);
}

function main() {
  if (!fs.existsSync(INVESTORS_DIR)) {
    console.log("sec-13f investor mirror absent; nothing to split");
    return 0;
  }
  let compacted = 0;
  let split = 0;
  const entries = fs.readdirSync(INVESTORS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = path.join(INVESTORS_DIR, entry.name);
    const relativePath = path.relative(PUBLIC_ROOT, absolutePath).split(path.sep).join("/");
    if (excludedFiles.has(relativePath)) continue;
    const data = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
    if (data?.schema === MANIFEST_SCHEMA) continue;
    const investor = data?.investor;
    const filings = investor?.filings;
    if (!investor || !Array.isArray(filings)) {
      throw new Error(`unexpected SEC 13F investor mirror shape: ${relativePath}`);
    }
    if (compactBytes(data) <= capBytes) {
      fs.writeFileSync(absolutePath, JSON.stringify(data));
      compacted += 1;
      continue;
    }
    const { filings: _filings, ...investorMeta } = investor;
    const { investor: _investor, ...rest } = data;
    splitInvestor(absolutePath, path.basename(entry.name, ".json"), investorMeta, filings, rest);
    split += 1;
  }
  console.log(
    `sec-13f investor mirror: ${entries.length} files, ${compacted} compacted, ${split} split (cap ${capBytes} bytes)`,
  );
  return 0;
}

process.exitCode = main();
