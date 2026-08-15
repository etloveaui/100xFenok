#!/usr/bin/env node

// Evidence gate for the SEC 13F boundary: a refresh must retain a real
// historical series, and every runtime public path must remain covered by the
// canonical-to-public materialization contract. This test never writes data.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildLaneCommitManifest } from "./build-lane-commit-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEC_ROOT = path.join(ROOT, "data/sec-13f");
const INVESTORS_ROOT = path.join(SEC_ROOT, "investors");
const CLIENT_HOOK = path.join(ROOT, "100xfenok-next/src/hooks/use13FData.ts");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function quarterOrdinal(value) {
  const match = String(value).match(/^(\d{4})-Q([1-4])$/u);
  return match ? Number(match[1]) * 4 + Number(match[2]) : null;
}

function assertQuarter(value, label) {
  assert.notEqual(quarterOrdinal(value), null, `${label} must be YYYY-QN`);
}

const summary = readJson("data/sec-13f/summary.json");
const metadata = summary.metadata;
const consensus = readJson("data/sec-13f/analytics/consensus.json");
const byTicker = readJson("data/sec-13f/by_ticker.json");

assert.ok(metadata && typeof metadata === "object", "13F metadata is required");
assert.equal(metadata.partial_run, false, "13F refresh must not be partial");
assert.equal(metadata.publish_blocked, false, "13F refresh must not be publish-blocked");
assert.deepEqual(metadata.investor_errors, [], "13F refresh must have no investor errors");
assert.match(String(metadata.source_quarter), /^\d{4}-Q[1-4]$/u);
assert.match(String(metadata.source_generated_at), /^\d{4}-\d{2}-\d{2}T/u);

const coveredQuarters = metadata.quarters_covered;
assert.ok(Array.isArray(coveredQuarters), "13F quarters_covered must be an array");
assert.ok(coveredQuarters.length >= 21, "13F output must retain the full fresh-fetch history window");
assert.equal(new Set(coveredQuarters).size, coveredQuarters.length, "13F quarters_covered must be unique");
coveredQuarters.forEach((quarter, index) => {
  assertQuarter(quarter, `metadata.quarters_covered[${index}]`);
});
assert.equal(coveredQuarters[0], metadata.source_quarter, "newest retained quarter must be the source quarter");

const investorEntries = Object.entries(summary.investors ?? {});
assert.equal(investorEntries.length, metadata.investor_count, "summary investor count must match metadata");
const investorFiles = fs.readdirSync(INVESTORS_ROOT)
  .filter((name) => name.endsWith(".json"))
  .map((name) => name.slice(0, -5))
  .sort();
assert.deepEqual(
  investorFiles,
  investorEntries.map(([id]) => id).sort(),
  "summary and investor payload registries must stay aligned",
);

let currentCohort = 0;
for (const [investorId, summaryInvestor] of investorEntries) {
  const payload = readJson(`data/sec-13f/investors/${investorId}.json`);
  const filings = payload?.investor?.filings;
  assert.ok(Array.isArray(filings) && filings.length > 0, `${investorId} must retain filing snapshots`);
  const seen = new Set();
  let previousOrdinal = null;
  for (const [index, filing] of filings.entries()) {
    assertQuarter(filing.quarter, `${investorId}.filings[${index}].quarter`);
    const ordinal = quarterOrdinal(filing.quarter);
    assert.ok(!seen.has(filing.quarter), `${investorId} has duplicate quarter ${filing.quarter}`);
    assert.ok(previousOrdinal === null || ordinal >= previousOrdinal, `${investorId} filings must be chronological`);
    assert.ok(coveredQuarters.includes(filing.quarter), `${investorId} uses an unlisted quarter ${filing.quarter}`);
    seen.add(filing.quarter);
    previousOrdinal = ordinal;
  }
  assert.equal(summaryInvestor.latest_quarter, filings.at(-1).quarter, `${investorId} summary latest quarter drift`);
  if (summaryInvestor.latest_quarter === metadata.source_quarter) currentCohort += 1;
}

assert.equal(currentCohort, consensus.metadata.current_cohort_investors, "current cohort must match consensus metadata");
assert.ok(Object.keys(byTicker).length > 0, "13F ticker projection must not be empty");

const materializations = buildLaneCommitManifest().update_manifest.materializations;
const secRoutes = materializations.filter((route) => route.source.startsWith("data/sec-13f/"));
const routeBySource = new Map(secRoutes.map((route) => [route.source, route]));
const canonicalJsonFiles = [];
const collectJson = (directory, prefix = "") => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJson(absolute, relative);
    else if (entry.isFile() && entry.name.endsWith(".json")) canonicalJsonFiles.push(relative);
  }
};
collectJson(SEC_ROOT);
for (const relative of canonicalJsonFiles.filter((value) => !value.startsWith("investors/"))) {
  const route = routeBySource.get(`data/sec-13f/${relative}`);
  if (relative === "schema.json") continue;
  assert.ok(route, `runtime SEC 13F payload lacks a materialization route: ${relative}`);
  assert.equal(route.destination, `100xfenok-next/public/data/sec-13f/${relative}`);
  assert.equal(route.mode, "cp_file");
}

const investorRoute = routeBySource.get("data/sec-13f/investors");
assert.ok(investorRoute, "SEC 13F investor directory lacks a materialization route");
assert.equal(investorRoute.mode, "rsync_tree");
assert.equal(investorRoute.delete, true);
assert.deepEqual(investorRoute.excludes, ["griffin.json"]);

const hook = fs.readFileSync(CLIENT_HOOK, "utf8");
const clientPaths = [
  "/data/sec-13f/analytics/consensus.json",
  "/data/sec-13f/summary.json",
  "/data/sec-13f/by_ticker.json",
  "/data/sec-13f/analytics/enhanced_consensus.json",
  "/data/sec-13f/by_sector.json",
  "/data/sec-13f/analytics/conviction_entries.json",
];
for (const clientPath of clientPaths) {
  assert.match(hook, new RegExp(clientPath.replaceAll("/", "\\/")), `client path is missing: ${clientPath}`);
  const relative = clientPath.slice("/data/".length);
  assert.ok(routeBySource.has(`data/${relative}`), `client path lacks a canonical route: ${clientPath}`);
}
assert.match(hook, /\/data\/sec-13f\/investors\/\$\{name\}\.json/u, "investor detail route is missing");

console.log(
  `sec13f retention/web contract: ok (${investorEntries.length} investors, `
  + `${coveredQuarters.length} retained quarters, ${currentCohort} current, `
  + `${secRoutes.length} materialization routes, ${clientPaths.length} client paths)`,
);
