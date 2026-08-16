#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildReview,
  DEFAULT_OUTPUT,
  SCHEMA_VERSION,
  stableComparable,
} from "./audit-fenok-edge-proxy-coverage.mjs";
import {
  FLOW_PROXY_FORMULA_VERSION,
  NATIVE_SIGNAL_FORMULA_VERSION,
  OCC_OPTIONS_FORMULA_VERSION,
} from "./lib/fenok-proxy-formula-contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const report = buildReview();

assert.equal(report.schema_version, SCHEMA_VERSION);
assert.equal(report.acceptance_checks.ok, true);
assert.deepEqual(report.formula_versions, {
  finra_flow: FLOW_PROXY_FORMULA_VERSION,
  occ_options: OCC_OPTIONS_FORMULA_VERSION,
  native_signals: NATIVE_SIGNAL_FORMULA_VERSION,
});
assert.equal(report.review_boundary.public_bundle_safe, false);
assert.equal(report.review_boundary.public_route, null);
assert.equal(report.review_boundary.live_readback, "not_verified");
assert.equal(report.review_boundary.freshness_credit, false);
assert.equal(report.review_boundary.s1_public_mutation, false);
assert.equal(report.review_boundary.external_fetch, false);

const denominator = report.denominators.eligible_plain_us;
const partition = report.coverage.classification_counts;
assert.equal(Object.values(partition).reduce((sum, count) => sum + count, 0), denominator);
assert.equal(
  report.row_partitions.eligible_with_both_proxy.length
    + report.row_partitions.eligible_with_any_proxy.filter(
      (ticker) => !report.row_partitions.eligible_with_both_proxy.includes(ticker),
    ).length
    + report.row_partitions.eligible_gap.length,
  denominator,
);
assert.equal(
  report.row_partitions.eligible_with_any_proxy.some((ticker) => report.row_partitions.eligible_gap.includes(ticker)),
  false,
);
assert.equal(
  report.row_partitions.eligible_gap.every((ticker) => report.rows.find((row) => row.ticker === ticker)?.classification === "neither"),
  true,
);
assert.equal(new Set(report.rows.map((row) => row.ticker)).size, denominator);
assert.ok(report.blocked_policy_buckets.finra_non_plain_mapping_required > 0);
assert.ok(report.blocked_policy_buckets.occ_non_plain_mapping_required > 0);

for (const row of report.rows) {
  assert.equal(row.market, "US");
  assert.match(row.ticker, /^[A-Z][A-Z0-9]{0,11}$/);
  assert.equal("short_pressure_proxy" in row, false);
  assert.equal("options_activity_proxy" in row, false);
}

const artifactPath = path.join(repoRoot, DEFAULT_OUTPUT);
assert.equal(fs.existsSync(artifactPath), true, "review artifact must be committed");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
assert.deepEqual(stableComparable(artifact), stableComparable(report));

console.log(JSON.stringify({
  ok: true,
  suite: "fenok-edge-proxy-coverage-review",
  denominator,
  classification_counts: partition,
  formula_versions_bound: true,
  review_only_boundary: true,
}, null, 2));
