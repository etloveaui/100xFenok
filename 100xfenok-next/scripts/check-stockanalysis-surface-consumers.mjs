#!/usr/bin/env node

import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const SURFACE_INDEX_PATH = `${ROOT}/public/data/stockanalysis/surfaces/index.json`;
const PUBLIC_CONSUMERS_PATH = `${ROOT}/public/data/stockanalysis/surface_consumers.json`;
const SOURCE_CONSUMERS_PATH = `${ROOT}/../data/stockanalysis/surface_consumers.json`;

const CODE_FILES = [
  `${ROOT}/src/app/market/events/MarketEventsClient.tsx`,
  `${ROOT}/src/app/api/data/stockanalysis/etf-snapshot/route.ts`,
  `${ROOT}/src/app/api/data/stockanalysis/[assetType]/[ticker]/route.ts`,
  `${ROOT}/src/app/api/data/stockanalysis/ticker/[ticker]/surfaces/route.ts`,
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function fail(messages) {
  console.error("stockanalysis surface consumer check failed");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}

const index = readJson(SURFACE_INDEX_PATH);
const publicConsumers = readJson(PUBLIC_CONSUMERS_PATH);
const sourceConsumersRaw = readFileSync(SOURCE_CONSUMERS_PATH, "utf8");
const publicConsumersRaw = readFileSync(PUBLIC_CONSUMERS_PATH, "utf8");

const indexSurfaces = new Set((Array.isArray(index.results) ? index.results : [])
  .map((row) => String(row?.surface || "").trim())
  .filter(Boolean));

const consumerRows = Array.isArray(publicConsumers.surfaces) ? publicConsumers.surfaces : [];
const consumerSurfaces = new Set();
const errors = [];

if (sourceConsumersRaw !== publicConsumersRaw) {
  errors.push("source data/stockanalysis/surface_consumers.json and public mirror differ");
}

for (const row of consumerRows) {
  const surface = String(row?.surface || "").trim();
  if (!surface) {
    errors.push("consumer row is missing surface");
    continue;
  }
  if (consumerSurfaces.has(surface)) errors.push(`${surface}: duplicate consumer row`);
  consumerSurfaces.add(surface);
  if (!indexSurfaces.has(surface)) errors.push(`${surface}: not present in surfaces/index.json`);
  const consumers = Array.isArray(row?.consumers) ? row.consumers : [];
  if (consumers.length === 0) errors.push(`${surface}: missing consumers`);
  for (const consumer of consumers) {
    if (!String(consumer?.route || "").trim()) errors.push(`${surface}: consumer missing route`);
    if (!String(consumer?.label || "").trim()) errors.push(`${surface}: consumer missing label`);
  }
}

for (const surface of indexSurfaces) {
  if (!consumerSurfaces.has(surface)) errors.push(`${surface}: missing from surface_consumers.json`);
}

const referencedByCode = new Set();
for (const file of CODE_FILES) {
  const text = readFileSync(file, "utf8");
  for (const surface of indexSurfaces) {
    if (text.includes(`"${surface}"`) || text.includes(`/${surface}`)) {
      referencedByCode.add(surface);
    }
  }
}

for (const surface of referencedByCode) {
  if (!consumerSurfaces.has(surface)) errors.push(`${surface}: referenced by UI/API code but missing consumer entry`);
}

if (errors.length > 0) fail(errors);

console.log(`stockanalysis surface consumer check passed (${consumerSurfaces.size}/${indexSurfaces.size} surfaces)`);
