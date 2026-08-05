#!/usr/bin/env node

// What this test defends: the public projection is an allowlist, and the two
// copies on disk are the same bytes as what the allowlist produces right now.
//
// The redaction assertions are written against the KEY SET, not against a list
// of fields we happen to dislike. A denylist passes the moment the canonical
// artifact grows a new field; an allowlist fails, which is the behaviour we want
// from a file that ships to the open internet.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_REL,
  FORBIDDEN_PUBLIC_TOKENS,
  PROJECTION_BASENAME,
  PUBLIC_SCHEMA_VERSION,
  PUBLISHABLE_ROW_STATUS,
  buildFromDisk,
  buildPublicProjection,
  findForbiddenTokens,
  sha256,
} from "./build-fenok-rim-sustainable-public-projection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = JSON.parse(fs.readFileSync(path.join(ROOT, CANONICAL_REL), "utf8"));
const RECEIPT = JSON.parse(fs.readFileSync(
  path.join(ROOT, "data/computed/fenok-rim/identification-receipt.json"),
  "utf8",
));

const clone = (value) => JSON.parse(JSON.stringify(value));

// Every key path the projection is allowed to contain, `rows[]` collapsed to one
// shape. A key that appears in the output and not here fails the test.
const ALLOWED_DOCUMENT_KEYS = [
  "as_of", "generated_at", "policy", "promotion", "rows", "schema_version", "source", "withheld",
].sort();
const ALLOWED_ROW_KEYS = [
  "as_of", "assumptions", "confidence", "current_price", "expected_12m", "id", "label",
  "publication_status", "range", "upside",
].sort();
const ALLOWED_ASSUMPTION_KEYS = [
  "convexity_ratio", "convexity_status", "discount_rate", "explicit_years",
].sort();

const projection = buildFromDisk();

// --- shape ----------------------------------------------------------------
assert.equal(projection.schema_version, PUBLIC_SCHEMA_VERSION);
assert.deepEqual(Object.keys(projection).sort(), ALLOWED_DOCUMENT_KEYS);
assert.equal(projection.policy.no_public_single_target, true);
assert.equal(projection.policy.emits_single_target, false);
assert.ok(projection.rows.length > 0, "a promoted eligible document must publish rows");
for (const row of projection.rows) {
  assert.deepEqual(Object.keys(row).sort(), ALLOWED_ROW_KEYS, `${row.id}: row key set`);
  assert.deepEqual(Object.keys(row.assumptions).sort(), ALLOWED_ASSUMPTION_KEYS, `${row.id}: assumption key set`);
  assert.equal(row.publication_status, PUBLISHABLE_ROW_STATUS);
  for (const band of ["range", "upside", "expected_12m"]) {
    assert.deepEqual(Object.keys(row[band]).sort(), ["high", "low"], `${row.id}.${band} is two-ended`);
    assert.ok(row[band].low < row[band].high, `${row.id}.${band} is ordered and not collapsed`);
  }
}

// --- redaction ------------------------------------------------------------
// The canonical blocks that must not survive the projection, by name, so the
// failure message says WHICH secret leaked rather than "key set changed".
for (const secret of [
  "calibration", "calibration_contract", "structure", "runtime_contract", "interpretation", "scope", "status",
]) {
  assert.equal(secret in projection, false, `canonical '${secret}' must not reach the public projection`);
}
for (const row of projection.rows) {
  for (const secret of ["inputs", "source_notes", "measured_growth_diagnostic", "input_freshness", "value", "out_of_scope_reason", "blocking_reasons"]) {
    assert.equal(secret in row, false, `${row.id}: canonical '${secret}' must not reach the public projection`);
  }
}
// The twelve-month share and its basis name where the constant was fitted. The
// endpoints are the product; how they were calibrated is not.
const serialised = JSON.stringify(projection);
for (const fragment of ["share", "basis", "calibrated_on_published_claims", "payout", "median_roe", "lt_roe"]) {
  assert.equal(serialised.includes(fragment), false, `'${fragment}' must not reach the public projection`);
}
assert.deepEqual(findForbiddenTokens(projection), [], "identity tokens in the public projection");
assert.ok(FORBIDDEN_PUBLIC_TOKENS.length > 0, "the identity token list must not be empty");
// The scan must actually be capable of failing.
assert.deepEqual(
  findForbiddenTokens({ note: "calibrated against Yoo" }),
  ["yoo"],
  "the identity scan must catch a planted token",
);

// --- no single target anywhere -------------------------------------------
for (const forbidden of ["point_estimate", "target", "fair_value", "midpoint", "mid"]) {
  assert.equal(serialised.includes(`"${forbidden}"`), false, `'${forbidden}' key must not reach the public projection`);
}

// --- document-level refusals ----------------------------------------------
const notPromoted = clone(CANONICAL);
notPromoted.promotion.promoted = false;
const refusedByPromotion = buildPublicProjection({ canonical: notPromoted, receipt: RECEIPT });
assert.deepEqual(refusedByPromotion.rows, [], "an unpromoted document publishes no rows");
assert.ok(refusedByPromotion.withheld.includes("canonical_not_promoted"));

const notEligible = clone(RECEIPT);
notEligible.sustainable_calibration_receipt.promotion.eligible = false;
const refusedByReceipt = buildPublicProjection({ canonical: CANONICAL, receipt: notEligible });
assert.deepEqual(refusedByReceipt.rows, [], "an ineligible calibration receipt publishes no rows");
assert.ok(refusedByReceipt.withheld.includes("calibration_receipt_not_eligible"));

// A receipt whose eligibility flag is missing entirely is not eligibility.
const receiptWithoutFlag = clone(RECEIPT);
delete receiptWithoutFlag.sustainable_calibration_receipt.promotion.eligible;
assert.deepEqual(
  buildPublicProjection({ canonical: CANONICAL, receipt: receiptWithoutFlag }).rows,
  [],
  "an absent eligibility flag publishes no rows",
);

// --- row-level refusals ---------------------------------------------------
const firstId = CANONICAL.rows.find((row) => row.publication_status === PUBLISHABLE_ROW_STATUS).id;
function projectWithMutatedFirstRow(mutate) {
  const mutated = clone(CANONICAL);
  mutate(mutated.rows.find((row) => row.id === firstId));
  return buildPublicProjection({ canonical: mutated, receipt: RECEIPT });
}
const cases = [
  ["a collapsed range", (row) => { row.value.range.high = row.value.range.low; }, "range_endpoints_incomplete"],
  ["a missing high endpoint", (row) => { row.value.range.high = null; }, "range_endpoints_incomplete"],
  ["a collapsed twelve-month range", (row) => { row.value.expected_12m.high = row.value.expected_12m.low; }, "expected_12m_endpoints_incomplete"],
  ["a missing upside endpoint", (row) => { delete row.value.upside.low; }, "upside_endpoints_incomplete"],
  ["an inverted range", (row) => { const { low, high } = row.value.range; row.value.range.low = high; row.value.range.high = low; }, "range_endpoints_incomplete"],
  ["a point estimate", (row) => { row.value.point_estimate = 11000; }, "point_estimate_present"],
  ["a runtime injection flag", (row) => { row.runtime_yoo_value_injection = true; }, "runtime_injection_flag_not_false"],
  ["a blocking reason", (row) => { row.blocking_reasons = ["panel_stale"]; }, "blocking_reasons=panel_stale"],
  ["a downgraded publication status", (row) => { row.publication_status = "OUT_OF_SCOPE"; }, "publication_status=OUT_OF_SCOPE"],
  ["an absent discount rate", (row) => { row.value.convexity.discount = null; }, "discount_rate_absent"],
];
for (const [label, mutate, reason] of cases) {
  const result = projectWithMutatedFirstRow(mutate);
  assert.equal(
    result.rows.some((row) => row.id === firstId), false,
    `${label} must withhold ${firstId}`,
  );
  assert.ok(
    result.withheld.includes(`${firstId}: ${reason}`),
    `${label} must record '${firstId}: ${reason}', got ${JSON.stringify(result.withheld)}`,
  );
  // The other rows are unaffected: one bad row is withheld, not the document.
  assert.ok(result.rows.length > 0, `${label} must not empty the document`);
}

// Out-of-scope rows never publish and always say why they were withheld.
const outOfScope = CANONICAL.rows.filter((row) => row.publication_status !== PUBLISHABLE_ROW_STATUS);
for (const row of outOfScope) {
  assert.equal(projection.rows.some((published) => published.id === row.id), false, `${row.id} must not publish`);
  assert.ok(projection.withheld.some((entry) => entry.startsWith(`${row.id}: `)), `${row.id} must be recorded as withheld`);
}

// --- parity between the two copies on disk and the current build ----------
const serialisedBuild = `${JSON.stringify(projection, null, 2)}\n`;
for (const rel of [
  path.join("data/computed/fenok-rim", PROJECTION_BASENAME),
  path.join("100xfenok-next/public/data/computed/fenok-rim", PROJECTION_BASENAME),
]) {
  const onDisk = fs.readFileSync(path.join(ROOT, rel), "utf8");
  assert.equal(onDisk, serialisedBuild, `${rel} is stale; rerun the projection builder`);
}
// The recorded canonical hash is the file the projection actually came from.
assert.equal(
  projection.source.canonical_sha256,
  sha256(fs.readFileSync(path.join(ROOT, CANONICAL_REL), "utf8")),
  "recorded canonical hash does not match the canonical artifact",
);

// The raw canonical artifact must never appear in the public mirror.
assert.equal(
  fs.existsSync(path.join(ROOT, "100xfenok-next/public", CANONICAL_REL.replace(/^data\//, "data/"))),
  false,
  "the canonical artifact must not be mirrored publicly",
);

process.stdout.write("test-build-fenok-rim-sustainable-public-projection: ok\n");
