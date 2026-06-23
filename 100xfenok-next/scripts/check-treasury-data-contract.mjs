#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const ROUTE_PATH = "src/app/api/data/route.ts";
const SOURCE_MIRROR = path.join("..", "data", "macro", "tga.json");
const PUBLIC_MIRROR = path.join("public", "data", "macro", "tga.json");

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`missing file: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

const errors = [];
const route = read(ROUTE_PATH);

for (const needle of [
  'TREASURY_CONTRACT_VERSION = "treasury-tga.v1"',
  'dataset: "treasury-tga"',
  "schemaVersion: TREASURY_CONTRACT_VERSION",
  'source: TreasuryTgaSource',
  'treasury-tga-datapack',
  'treasury-fiscaldata-fallback',
  "makeDataState",
  "staleAfter",
  "mirror_unavailable_or_empty",
  "/data/macro/tga.json",
]) {
  assert(route.includes(needle), `${ROUTE_PATH}: missing '${needle}'`, errors);
}

const source = readJson(SOURCE_MIRROR);
const mirror = readJson(PUBLIC_MIRROR);

assert(JSON.stringify(source) === JSON.stringify(mirror), "Treasury TGA source/public mirror mismatch", errors);
assert(typeof source.updated === "string" && source.updated.length > 0, "Treasury TGA mirror missing updated timestamp", errors);
assert(Array.isArray(source.series) && source.series.length > 0, "Treasury TGA mirror has no series rows", errors);

const last = source.series?.at(-1);
assert(typeof last?.date === "string" && last.date.length > 0, "Treasury TGA mirror last row missing date", errors);
assert(last?.val !== null && last?.val !== undefined, "Treasury TGA mirror last row missing value", errors);

if (errors.length > 0) {
  console.error("treasury data contract check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`treasury data contract check passed (${source.series.length} rows, updated ${source.updated})`);
