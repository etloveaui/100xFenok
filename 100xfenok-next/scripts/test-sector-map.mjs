#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Load sector-map.json
// ---------------------------------------------------------------------------

const sectorMapPath = join(REPO_ROOT, "src", "lib", "design", "sector-map.json");
const sectorMap = JSON.parse(readFileSync(sectorMapPath, "utf8"));

// ---------------------------------------------------------------------------
// Load actual sector values from stocks_analyzer.json
// ---------------------------------------------------------------------------

const stocksPath = join(REPO_ROOT, "public", "data", "global-scouter", "core", "stocks_analyzer.json");
const stocksData = JSON.parse(readFileSync(stocksPath, "utf8"));

/** @type {Set<string>} */
const actualSectors = new Set();
for (const entry of stocksData.data ?? []) {
  if (entry.sector && typeof entry.sector === "string") {
    actualSectors.add(entry.sector.trim());
  }
}

// ---------------------------------------------------------------------------
// (a) Every actual sector maps to a non-"Other" canonical
// ---------------------------------------------------------------------------

console.log(`Actual unique sectors in stocks_analyzer.json: ${actualSectors.size}`);

const mapped = new Map();
/** @type {string[]} */
const unmapped = [];

for (const raw of actualSectors) {
  const canonical = sectorMap.scouterToCanonical[raw];
  if (!canonical || canonical === "Other") {
    unmapped.push(raw);
  } else {
    mapped.set(raw, canonical);
  }
}

if (unmapped.length > 0) {
  console.error(`FAIL: ${unmapped.length} sector(s) map to "Other" or missing:`, unmapped);
  process.exit(1);
}
console.log(`  (a) All ${mapped.size} actual sectors map to non-"Other" canonical: PASS`);

// ---------------------------------------------------------------------------
// (b) Every canonical entry has color + labelKo
// ---------------------------------------------------------------------------

let missing = 0;
for (const c of sectorMap.canonical) {
  if (typeof sectorMap.colors[c] !== "string") {
    console.error(`FAIL: canonical "${c}" missing color`);
    missing++;
  }
  if (typeof sectorMap.labelsKo[c] !== "string") {
    console.error(`FAIL: canonical "${c}" missing labelsKo`);
    missing++;
  }
}
if (missing > 0) {
  process.exit(1);
}
console.log(`  (b) All ${sectorMap.canonical.length} canonical sectors have color + labelsKo: PASS`);

// ---------------------------------------------------------------------------
// (c) Unknown label falls back to "Other" (JSON contract: key absent)
// ---------------------------------------------------------------------------

assert.equal(
  sectorMap.scouterToCanonical["__NONEXISTENT_SECTOR__"] ?? "Other",
  "Other",
  "Missing key should fall back to 'Other'",
);
console.log("  (c) Unknown sector falls back to 'Other': PASS");

// ---------------------------------------------------------------------------
// (d) All 11 GICS names map non-"Other"
// ---------------------------------------------------------------------------

const expectedGics = [
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Health Care",
  "Industrials",
  "Information Technology",
  "Materials",
  "Real Estate",
  "Utilities",
];

const gicsMap = sectorMap.gicsToCanonical;
if (!gicsMap || typeof gicsMap !== "object") {
  console.error("FAIL: gicsToCanonical missing from sector-map.json");
  process.exit(1);
}

/** @type {string[]} */
const gicsUnmapped = [];
for (const gics of expectedGics) {
  const canonical = gicsMap[gics];
  if (!canonical || canonical === "Other") {
    gicsUnmapped.push(gics);
  }
}
if (gicsUnmapped.length > 0) {
  console.error(`FAIL: ${gicsUnmapped.length} GICS name(s) map to "Other" or missing:`, gicsUnmapped);
  process.exit(1);
}
console.log(`  (d) All ${expectedGics.length} GICS names map to non-"Other" canonical: PASS`);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const canonicalCounts = new Map();
for (const c of sectorMap.canonical) {
  canonicalCounts.set(c, 0);
}
for (const raw of actualSectors) {
  const c = sectorMap.scouterToCanonical[raw];
  canonicalCounts.set(c, (canonicalCounts.get(c) ?? 0) + 1);
}

console.log(`\nSummary: ${actualSectors.size} scouter sectors → ${sectorMap.canonical.length} canonical groups`);
for (const [c, count] of canonicalCounts) {
  console.log(`  ${c}: ${count} scouter sector(s)`);
}

console.log("\ntest-sector-map PASS");
