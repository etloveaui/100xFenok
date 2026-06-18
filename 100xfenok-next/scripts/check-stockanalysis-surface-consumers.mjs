#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

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

const ROUTE_CONTRACTS = {
  "/admin/data-lab": {
    files: [
      "src/app/admin/data-lab/page.tsx",
      "public/admin/data-lab/app/renderer.js",
    ],
    contains: [
      ["public/admin/data-lab/app/renderer.js", "renderMarketDataAudit"],
    ],
  },
  "/api/data/stockanalysis/etf-snapshot": {
    files: ["src/app/api/data/stockanalysis/etf-snapshot/route.ts"],
  },
  "/etfs": {
    files: [
      "src/app/etfs/page.tsx",
      "src/app/etfs/EtfSurfaceSnapshotCard.tsx",
      "src/app/api/data/stockanalysis/etf-snapshot/route.ts",
    ],
  },
  "/etfs/new": {
    files: [
      "src/app/etfs/new/page.tsx",
      "src/app/etfs/new/NewEtfsList.tsx",
    ],
  },
  "/etfs/[ticker]": {
    files: [
      "src/app/etfs/[ticker]/page.tsx",
      "src/app/etfs/[ticker]/EtfDetailClient.tsx",
      "src/app/api/data/stockanalysis/[assetType]/[ticker]/route.ts",
    ],
  },
  "/market/events": {
    files: [
      "src/app/market/events/page.tsx",
      "src/app/market/events/MarketEventsClient.tsx",
      "src/app/api/data/stockanalysis/surfaces/[surface]/route.ts",
    ],
  },
  "/stock/[ticker]": {
    files: [
      "src/app/stock/[ticker]/page.tsx",
      "src/app/stock/[ticker]/StockDetailClient.tsx",
      "src/app/stock/[ticker]/TickerSurfaceEventsCard.tsx",
      "src/app/api/data/stockanalysis/ticker/[ticker]/surfaces/route.ts",
    ],
    contains: [
      ["src/app/stock/[ticker]/StockDetailClient.tsx", "TickerSurfaceEventsCard"],
      ["src/app/stock/[ticker]/TickerSurfaceEventsCard.tsx", "/api/data/stockanalysis/ticker/"],
    ],
  },
};

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pathOf(relPath) {
  return `${ROOT}/${relPath}`;
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
const routeContractsChecked = new Set();

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
    const route = String(consumer?.route || "").trim();
    if (!route) errors.push(`${surface}: consumer missing route`);
    if (!String(consumer?.label || "").trim()) errors.push(`${surface}: consumer missing label`);
    const contract = ROUTE_CONTRACTS[route];
    if (!contract) {
      errors.push(`${surface}: consumer route '${route}' is not in active route contracts`);
      continue;
    }
    routeContractsChecked.add(route);
    for (const relPath of contract.files) {
      if (!existsSync(pathOf(relPath))) errors.push(`${surface}: consumer route '${route}' missing file ${relPath}`);
    }
    for (const [relPath, needle] of contract.contains ?? []) {
      if (!existsSync(pathOf(relPath)) || !readFileSync(pathOf(relPath), "utf8").includes(needle)) {
        errors.push(`${surface}: consumer route '${route}' missing code marker '${needle}' in ${relPath}`);
      }
    }
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

if (!routeContractsChecked.has("/market/events")) errors.push("surface consumer contracts must include /market/events");
if (!routeContractsChecked.has("/stock/[ticker]")) errors.push("surface consumer contracts must include /stock/[ticker]");

if (errors.length > 0) fail(errors);

console.log(`stockanalysis surface consumer check passed (${consumerSurfaces.size}/${indexSurfaces.size} surfaces)`);
