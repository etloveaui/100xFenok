#!/usr/bin/env node

// Fail-closed route guard for the daily 13F downstream lane. SEC ingestion is
// performed by the external CCH converter; this check prevents local Yahoo
// enrichment from making an old SEC source look current without provenance.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (relativePath) => JSON.parse(
  fs.readFileSync(path.join(root, relativePath), "utf8"),
);

const summary = readJson("data/sec-13f/summary.json");
const metadata = summary.metadata;
const consensus = readJson("data/sec-13f/analytics/consensus.json");
const consensusMetadata = consensus.metadata;

function quarterEndDate(year, quarter) {
  return new Date(Date.UTC(year, quarter * 3, 0, 23, 59, 59, 999));
}

function quarterKey(year, quarter) {
  return `${year}-Q${quarter}`;
}

function latestDueQuarter(now) {
  const currentYear = now.getUTCFullYear();
  const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
  let latest = null;
  for (let year = currentYear - 2; year <= currentYear; year += 1) {
    for (let quarter = 1; quarter <= 4; quarter += 1) {
      const due = new Date(quarterEndDate(year, quarter).getTime() + 45 * 24 * 60 * 60 * 1000);
      if (due <= now) latest = { year, quarter };
    }
  }
  if (!latest) return quarterKey(currentYear, Math.max(1, currentQuarter - 1));
  return quarterKey(latest.year, latest.quarter);
}

function compareQuarter(a, b) {
  const parse = (value) => {
    const match = String(value).match(/^(\d{4})-Q([1-4])$/u);
    return match ? Number(match[1]) * 4 + Number(match[2]) : -1;
  };
  return parse(a) - parse(b);
}

assert.ok(metadata && typeof metadata === "object", "13F summary metadata is required");
assert.match(
  String(metadata.source_generated_at ?? ""),
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u,
  "13F source_generated_at must preserve the upstream converter timestamp",
);
assert.match(
  String(metadata.source_quarter ?? ""),
  /^\d{4}-Q[1-4]$/u,
  "13F source_quarter must identify the upstream converter quarter",
);
assert.equal(metadata.partial_run, false, "13F source converter must not be partial");
assert.equal(metadata.publish_blocked, false, "13F source converter must not be publish-blocked");
assert.deepEqual(metadata.investor_errors, [], "13F source converter must have no investor errors");
assert.ok(Array.isArray(metadata.quarters_covered), "13F quarters_covered must be an array");
assert.equal(
  metadata.quarters_covered[0],
  metadata.source_quarter,
  "13F source_quarter must match the newest converter quarter",
);
const dueQuarter = latestDueQuarter(new Date());
assert.ok(
  compareQuarter(metadata.source_quarter, dueQuarter) >= 0,
  `13F source quarter ${metadata.source_quarter} is behind the latest due quarter ${dueQuarter}`,
);
assert.equal(
  consensusMetadata.quarter,
  metadata.source_quarter,
  "13F consensus quarter must match the converter source quarter",
);

const investorEntries = Object.entries(summary.investors ?? {});
const activeCount = investorEntries.filter(([, investor]) => (
  investor.latest_quarter === metadata.source_quarter
)).length;
assert.equal(activeCount, consensusMetadata.current_cohort_investors);
assert.equal(investorEntries.length, metadata.investor_count);
assert.equal(consensusMetadata.total_investors, activeCount);

console.log(
  `sec13f source route: ok (source_quarter=${metadata.source_quarter} ` +
  `cohort=${activeCount}/${investorEntries.length} ` +
  `latest_due_quarter=${dueQuarter} ` +
  `source_generated_at=${metadata.source_generated_at})`,
);
