#!/usr/bin/env node

// Public-projection contract for the FENO RIM sustainable index ranges.
//
// The projection is an allowlist, not a mirror: only the fields named here
// survive, so a canonical artifact growing a new field fails loudly instead
// of leaking by accident. The test enforces the allowlist itself, the
// refusals, the identity scan and the opaque release id.
//
// DEC-289 (2026-08-05): the canonical artifact is under owner-ordered
// quarantine. The on-disk projection therefore publishes the QUARANTINE
// SHAPE — no rows, no internal blocker ids, no findings, one public state,
// one withheld reason. The row-projection rules are still tested against a
// promoted fixture so the reopen path stays covered by contract.

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
  releaseId,
  sha256,
} from "./build-fenok-rim-sustainable-public-projection.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CANONICAL = JSON.parse(fs.readFileSync(path.join(ROOT, CANONICAL_REL), "utf8"));
const RECEIPT = JSON.parse(fs.readFileSync(
  path.join(ROOT, "data/computed/fenok-rim/identification-receipt.json"),
  "utf8",
));

const clone = (value) => JSON.parse(JSON.stringify(value));

// The internal audit vocabulary. None of it may reach a public file.
const QUARANTINE_BLOCKER_IDS = [
  "model_validation_reopened",
  "twelve_month_output_targeting",
  "sealed_holdout_absent",
  "growth_model_not_validated",
];

// Every key path the projection is allowed to contain, `rows[]` collapsed to one
// shape. A key that appears in the output and not here fails the test.
const ALLOWED_DOCUMENT_KEYS = [
  "as_of", "generated_at", "policy", "promotion", "release", "rows", "schema_version", "withheld",
].sort();
const ALLOWED_ROW_KEYS = [
  "as_of", "assumptions", "confidence", "current_price", "expected_12m", "id", "label",
  "publication_status", "range", "upside",
].sort();
const ALLOWED_ASSUMPTION_KEYS = [
  "convexity_ratio", "convexity_status", "discount_rate", "explicit_years",
].sort();

const projection = buildFromDisk();

// --- quarantine shape (the on-disk reality under DEC-289) -------------------
assert.equal(projection.schema_version, PUBLIC_SCHEMA_VERSION);
assert.deepEqual(Object.keys(projection).sort(), ALLOWED_DOCUMENT_KEYS);
assert.equal(projection.policy.no_public_single_target, true);
assert.equal(projection.policy.emits_single_target, false);
assert.equal(projection.promotion.promoted, false, "the quarantined build is not promoted");
assert.equal(projection.promotion.public_state, "MODEL_REVALIDATION",
  "the quarantine declares exactly one public state");
assert.deepEqual(projection.promotion.findings, [],
  "no internal finding reaches a quarantined document");
assert.deepEqual(projection.rows, [], "the quarantine publishes no rows");
assert.deepEqual(projection.withheld, ["model_revalidation_in_progress"],
  "one withheld reason and no internal ids");

// The internal blocker ids and the audit vocabulary must not leak, in a key,
// a value, or a disclosed string.
const serialised = JSON.stringify(projection);
for (const id of QUARANTINE_BLOCKER_IDS) {
  assert.equal(serialised.includes(id), false,
    `internal blocker '${id}' must not reach the public projection`);
}
for (const fragment of ["share", "basis", "calibrated_on_published_claims", "payout", "median_roe", "lt_roe", "detail"]) {
  assert.equal(serialised.includes(fragment), false, `'${fragment}' must not reach the quarantined projection`);
}
assert.deepEqual(findForbiddenTokens(projection), [], "identity tokens in the quarantined projection");
for (const forbidden of ["point_estimate", "target", "fair_value", "midpoint", "mid"]) {
  assert.equal(serialised.includes(`"${forbidden}"`), false, `'${forbidden}' key must not reach the public projection`);
}

// --- promoted fixture: the row rules the reopen path must satisfy -----------
// Reopening needs BOTH gates clear: promotion and an eligible receipt. The
// fixture clears them together; the quarantined disk state keeps both closed.
const promotedCanonical = clone(CANONICAL);
promotedCanonical.promotion.promoted = true;
const promotedReceipt = clone(RECEIPT);
promotedReceipt.sustainable_calibration_receipt.promotion.eligible = true;
const promotedProjection = buildPublicProjection({ canonical: promotedCanonical, receipt: promotedReceipt });

assert.equal(promotedProjection.promotion.public_state, null,
  "a promoted document carries no quarantine state");
assert.ok(promotedProjection.rows.length > 0, "a promoted eligible document must publish rows");
for (const row of promotedProjection.rows) {
  assert.deepEqual(Object.keys(row).sort(), ALLOWED_ROW_KEYS, `${row.id}: row key set`);
  assert.deepEqual(Object.keys(row.assumptions).sort(), ALLOWED_ASSUMPTION_KEYS, `${row.id}: assumption key set`);
  assert.equal(row.publication_status, PUBLISHABLE_ROW_STATUS);
  for (const band of ["range", "upside", "expected_12m"]) {
    assert.deepEqual(Object.keys(row[band]).sort(), ["high", "low"], `${row.id}.${band} is two-ended`);
    assert.ok(row[band].low < row[band].high, `${row.id}.${band} is ordered and not collapsed`);
  }
}

// --- redaction ----------------------------------------------------------------
// The canonical blocks that must not survive the projection, by name, so the
// failure message says WHICH secret leaked rather than "key set changed".
for (const secret of [
  "calibration", "calibration_contract", "structure", "runtime_contract", "interpretation", "scope", "status",
]) {
  assert.equal(secret in projection, false, `canonical '${secret}' must not reach the public projection`);
  assert.equal(secret in promotedProjection, false, `canonical '${secret}' must not reach a promoted projection`);
}
for (const row of promotedProjection.rows) {
  for (const secret of ["inputs", "source_notes", "measured_growth_diagnostic", "input_freshness", "value", "out_of_scope_reason", "blocking_reasons"]) {
    assert.equal(secret in row, false, `${row.id}: canonical '${secret}' must not reach the public projection`);
  }
}
// The twelve-month share and its basis name where the constant was fitted. The
// endpoints are the product; how they were calibrated is not.
const serialisedPromoted = JSON.stringify(promotedProjection);
for (const fragment of ["share", "basis", "calibrated_on_published_claims", "payout", "median_roe", "lt_roe"]) {
  assert.equal(serialisedPromoted.includes(fragment), false, `'${fragment}' must not reach the public projection`);
}
assert.deepEqual(findForbiddenTokens(promotedProjection), [], "identity tokens in the promoted projection");
assert.ok(FORBIDDEN_PUBLIC_TOKENS.length > 0, "the identity token list must not be empty");
// The scan must actually be capable of failing.
assert.deepEqual(
  findForbiddenTokens({ note: "calibrated against Yoo" }),
  ["yoo"],
  "the identity scan must catch a planted token",
);

// --- no single target anywhere -------------------------------------------
for (const forbidden of ["point_estimate", "target", "fair_value", "midpoint", "mid"]) {
  assert.equal(serialisedPromoted.includes(`"${forbidden}"`), false, `'${forbidden}' key must not reach the public projection`);
}

// --- document-level refusals ----------------------------------------------
// Every document-level refusal now collapses to the quarantine shape: no
// rows, no internal reasons, one public withheld reason.
const notPromoted = clone(promotedCanonical);
notPromoted.promotion.promoted = false;
const refusedByPromotion = buildPublicProjection({ canonical: notPromoted, receipt: promotedReceipt });
assert.deepEqual(refusedByPromotion.rows, [], "an unpromoted document publishes no rows");
assert.deepEqual(refusedByPromotion.withheld, ["model_revalidation_in_progress"]);
assert.equal(refusedByPromotion.promotion.public_state, "MODEL_REVALIDATION");

const notEligible = clone(promotedReceipt);
notEligible.sustainable_calibration_receipt.promotion.eligible = false;
const refusedByReceipt = buildPublicProjection({ canonical: promotedCanonical, receipt: notEligible });
assert.deepEqual(refusedByReceipt.rows, [], "an ineligible calibration receipt publishes no rows");
assert.deepEqual(refusedByReceipt.withheld, ["model_revalidation_in_progress"]);

// A receipt whose eligibility flag is missing entirely is not eligibility.
const receiptWithoutFlag = clone(promotedReceipt);
delete receiptWithoutFlag.sustainable_calibration_receipt.promotion.eligible;
assert.deepEqual(
  buildPublicProjection({ canonical: promotedCanonical, receipt: receiptWithoutFlag }).rows,
  [],
  "an absent eligibility flag publishes no rows",
);

// --- row-level refusals ----------------------------------------------------
// A defective row is withheld by name while healthy rows still publish.
// Mutations target the CANONICAL row shape: the bands live under `value`.
const rowDefects = [
  ["a collapsed band", (row) => { row.value.range.high = row.value.range.low; }, "range_endpoints_incomplete"],
  ["an inverted band", (row) => { const band = row.value.range; const low = band.low; band.low = band.high; band.high = low; }, "range_endpoints_incomplete"],
  ["a missing upside endpoint", (row) => { delete row.value.upside.high; }, "upside_endpoints_incomplete"],
  ["a missing twelve-month endpoint", (row) => { delete row.value.expected_12m.low; }, "expected_12m_endpoints_incomplete"],
  ["a planted point estimate", (row) => { row.value.point_estimate = 11000; }, "point_estimate_present"],
  ["a downgraded publication status", (row) => { row.publication_status = "OUT_OF_SCOPE"; }, "publication_status=OUT_OF_SCOPE"],
  ["a non-false injection flag", (row) => { row.runtime_yoo_value_injection = true; }, "runtime_injection_flag_not_false"],
  ["a dropped value block", (row) => { row.value = null; }, "value_absent"],
  ["a blocking reason standing", (row) => { row.blocking_reasons = ["stale_or_future_input"]; }, "blocking_reasons=stale_or_future_input"],
];
for (const [label, mutate, reason] of rowDefects) {
  const mutated = clone(promotedCanonical);
  const firstId = mutated.rows.find((row) => row.publication_status === PUBLISHABLE_ROW_STATUS).id;
  mutate(mutated.rows.find((row) => row.id === firstId));
  const result = buildPublicProjection({ canonical: mutated, receipt: promotedReceipt });
  assert.equal(
    result.rows.some((row) => row.id === firstId), false,
    `${label}: ${firstId} must not publish`,
  );
  assert.ok(
    result.withheld.includes(`${firstId}: ${reason}`),
    `${label} must record '${firstId}: ${reason}', got ${JSON.stringify(result.withheld)}`,
  );
  // The other rows are unaffected: one bad row is withheld, not the document.
  assert.ok(result.rows.length > 0, `${label} must not empty the document`);
}

// Out-of-scope rows never publish and always say why they were withheld.
const outOfScope = promotedCanonical.rows.filter((row) => row.publication_status !== PUBLISHABLE_ROW_STATUS);
for (const row of outOfScope) {
  assert.equal(promotedProjection.rows.some((published) => published.id === row.id), false, `${row.id} must not publish`);
  assert.ok(promotedProjection.withheld.some((entry) => entry.startsWith(`${row.id}: `)), `${row.id} must be recorded as withheld`);
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
// Parity is proved by RECOMPUTING the release id from the sources on disk, not
// by trusting a hash the document publishes about itself. The published id is
// opaque, and these assertions are why it can stay opaque.
const canonicalSha = sha256(fs.readFileSync(path.join(ROOT, CANONICAL_REL), "utf8"));
const receiptSha = sha256(fs.readFileSync(path.join(ROOT, "data/computed/fenok-rim/identification-receipt.json"), "utf8"));
assert.equal(
  projection.release.id,
  releaseId(canonicalSha, receiptSha),
  "release id does not match the sources the projection was built from",
);
assert.deepEqual(Object.keys(projection.release), ["id"], "the release block carries only an id");
assert.match(projection.release.id, /^[0-9a-f]{16}$/, "the release id is an opaque 16-hex digest");
// A different canonical must produce a different id, or the id proves nothing.
assert.notEqual(releaseId(canonicalSha, receiptSha), releaseId(`${canonicalSha}x`, receiptSha));
assert.notEqual(releaseId(canonicalSha, receiptSha), releaseId(canonicalSha, `${receiptSha}x`));
// Neither source hash, nor the internal path, may appear in the published document.
for (const secret of [canonicalSha, receiptSha, CANONICAL_REL, "canonical_path", "sha256"]) {
  assert.equal(
    JSON.stringify(projection).includes(secret), false,
    `'${secret}' must not reach the public projection`,
  );
}

// The raw canonical artifact must never appear in the public mirror.
assert.equal(
  fs.existsSync(path.join(ROOT, "100xfenok-next/public", CANONICAL_REL.replace(/^data\//, "data/"))),
  false,
  "the canonical artifact must not be mirrored publicly",
);

process.stdout.write("test-build-fenok-rim-sustainable-public-projection: ok\n");
