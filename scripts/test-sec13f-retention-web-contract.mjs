#!/usr/bin/env node

// Evidence gate for the SEC 13F boundary: a refresh must retain a real
// historical series, and every runtime public path must remain covered by the
// canonical-to-public materialization contract. This test never writes data.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { UPDATE_MANIFEST_MATERIALIZATIONS } from "./materialize-update-manifest-routes.mjs";
import { derivedPrivateFileOutputs } from "./lib/derived-asset-registry.mjs";
import { PRIVATE_PUBLIC_PATHS } from "../100xfenok-next/scripts/cloud-data-plane/cloud-data-plane-routing-authority.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEC_ROOT = path.join(ROOT, "data/sec-13f");
const INVESTORS_ROOT = path.join(SEC_ROOT, "investors");
const CLIENT_HOOK = path.join(ROOT, "100xfenok-next/src/hooks/use13FData.ts");
const PUBLIC_SEC_ROOT = path.join(ROOT, "100xfenok-next/public/data/sec-13f");
const PUBLIC_INVESTORS_ROOT = path.join(ROOT, "100xfenok-next/public/data/sec-13f/investors");
const WORKER_PATH = path.join(ROOT, "100xfenok-next/worker.ts");

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
const schema = readJson("data/sec-13f/schema.json");
const metadata = summary.metadata;
const consensus = readJson("data/sec-13f/analytics/consensus.json");
const byTicker = readJson("data/sec-13f/by_ticker.json");
const factorExposure = readJson("data/sec-13f/analytics/factor_exposures_summary.json");

assert.ok(metadata && typeof metadata === "object", "13F metadata is required");
assert.equal(metadata.partial_run, false, "13F refresh must not be partial");
assert.equal(metadata.publish_blocked, false, "13F refresh must not be publish-blocked");
assert.deepEqual(metadata.investor_errors, [], "13F refresh must have no investor errors");
assert.match(String(metadata.source_quarter), /^\d{4}-Q[1-4]$/u);
assert.match(String(metadata.source_generated_at), /^\d{4}-\d{2}-\d{2}T/u);

const coveredQuarters = metadata.quarters_covered;
assert.ok(Array.isArray(coveredQuarters), "13F quarters_covered must be an array");
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
assert.equal(
  fs.existsSync(path.join(PUBLIC_INVESTORS_ROOT, "griffin.json")),
  false,
  "private griffin investor payload must be absent from the local public projection",
);
for (const relativePath of ["README.md", "schema.json", "analytics/factor_exposures_summary.json"]) {
  assert.equal(
    fs.existsSync(path.join(PUBLIC_SEC_ROOT, relativePath)),
    false,
    `canonical-only SEC 13F public twin must be absent: ${relativePath}`,
  );
}
assert.equal(
  factorExposure.raw_data_boundary,
  "admin_private_path_redacted",
  "factor-exposure canonical payload must carry the public-safe private boundary",
);
assert.doesNotMatch(
  JSON.stringify(factorExposure),
  /_private\/admin\/fama_french\/raw/u,
  "factor-exposure public payload must not disclose the private raw-cache path",
);
assert.ok(
  schema.files?.["analytics/factor_exposures_summary.json"],
  "13F schema must declare the factor-exposure summary route",
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

const materializations = UPDATE_MANIFEST_MATERIALIZATIONS;
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
for (const relativePath of ["README.md", "schema.json"]) {
  const route = routeBySource.get(`data/sec-13f/${relativePath}`);
  assert.ok(route, `SEC 13F documentation payload lacks a materialization route: ${relativePath}`);
  assert.equal(route.destination, `100xfenok-next/public/data/sec-13f/${relativePath}`);
  assert.equal(route.mode, "cp_file");
}

for (const privatePath of [
  "/data/sec-13f/investors/griffin.json",
]) {
  assert.equal(
    PRIVATE_PUBLIC_PATHS.has(privatePath),
    true,
    `routing authority must deny the private SEC 13F path: ${privatePath}`,
  );
}
const publicBridgePath = "/data/computed/sec13f_bridge_index.json";
assert.equal(
  PRIVATE_PUBLIC_PATHS.has(publicBridgePath),
  false,
  `routing authority must allow the live SEC 13F bridge: ${publicBridgePath}`,
);
for (const relativePath of derivedPrivateFileOutputs()) {
  const publicPath = `/${relativePath}`;
  assert.equal(PRIVATE_PUBLIC_PATHS.has(publicPath), true, `routing authority missing: ${publicPath}`);
}
console.log(
  `sec13f retention/web contract: ok (${investorEntries.length} investors, `
  + `${coveredQuarters.length} retained quarters, ${currentCohort} current, `
  + `${secRoutes.length} materialization routes)`,
);
