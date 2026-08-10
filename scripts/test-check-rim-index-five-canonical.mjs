#!/usr/bin/env node

// Contract tests for check-rim-index-five-canonical.mjs. These tests validate
// the committed artifact and cloned throwaway JSON only; they never invoke the
// quarantined builder and never write the repository's generated artifact.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_REL,
  FIVE_INDICES,
  validateFiveIndexCanonicalArtifact,
  validateFiveIndexCanonicalFile,
} from "./check-rim-index-five-canonical.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT_PATH = path.join(ROOT, ARTIFACT_REL);
const CHECKER_PATH = path.join(ROOT, "scripts/check-rim-index-five-canonical.mjs");
const artifact = JSON.parse(fs.readFileSync(ARTIFACT_PATH, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const byAsset = (payload, asset) => payload.rows.find((row) => row.asset === asset);
const noErrors = (payload, options = {}) => {
  const result = validateFiveIndexCanonicalArtifact(payload, options);
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
  assert.equal(result.valid, true);
  return result;
};
const rejects = (mutate, pattern, name) => {
  const candidate = clone(artifact);
  mutate(candidate);
  const result = validateFiveIndexCanonicalArtifact(candidate, { root: ROOT });
  assert.equal(result.valid, false, `${name} must fail`);
  assert.match(result.errors.join("\n"), pattern, `${name} error must identify the violated contract`);
  console.log(`PASS ${name}`);
};

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`PASS ${name}`);
};

// 1. The validator is an artifact checker, not a second invocation of the
// producer. The source may mention the producer path as prose, but it must not
// import the builder module.
const checkerSource = fs.readFileSync(CHECKER_PATH, "utf8");
assert.doesNotMatch(checkerSource, /from\s+["']\.\/build-rim-index-five-canonical\.mjs["']/);
ok("validator is independent of the quarantined builder");

// 2. The real tracked artifact is the default input and is warning-valid even
// when its legitimate producer-owned rows are NULL.
const beforeBytes = fs.readFileSync(ARTIFACT_PATH);
const realResult = validateFiveIndexCanonicalFile({ root: ROOT });
assert.equal(realResult.valid, true, realResult.errors.join("\n"));
assert.deepEqual(realResult.warnings, artifact.rows.filter((row) => row.status === "NULL").map((row) => row.asset));
assert.equal(fs.readFileSync(ARTIFACT_PATH).equals(beforeBytes), true, "validation must not rewrite the generated artifact");
assert.deepEqual(artifact.rows.map((row) => row.asset), FIVE_INDICES);
ok("actual private artifact validates without rewriting and NULL rows remain warning-valid");

// 3. Structural row and metadata contracts.
rejects((payload) => { payload.rows.reverse(); }, /exact ordered assets/, "rows must stay in the exact order");
rejects((payload) => { payload.rows.pop(); }, /exactly 5 rows/, "artifact must contain exactly five rows");
rejects((payload) => { byAsset(payload, "SPX").status = "BROKEN"; }, /READY or NULL/, "row status is closed to READY or NULL");
rejects((payload) => { byAsset(payload, "SPX").fair_value_upside += 0.01; }, /fair_value_upside must equal/, "READY upside arithmetic is checked");
rejects((payload) => { byAsset(payload, "SPX").fair_value_as_of = "2026-08-06"; }, /fair_value_as_of must equal/, "READY fair-value as-of must match price as-of");
rejects((payload) => { byAsset(payload, "SPX").spot = Number.POSITIVE_INFINITY; }, /spot must be finite/, "READY spot must be finite");
rejects((payload) => { byAsset(payload, "SPX").blockers.direct_input.push("tampered"); }, /direct_input.*must be empty/, "READY direct-input blockers must be empty");
rejects((payload) => { byAsset(payload, "SPX").blockers.freshness.push("tampered"); }, /freshness.*must be empty/, "READY freshness blockers must be empty");
rejects((payload) => { byAsset(payload, "SPX").blockers.identity.push("tampered"); }, /identity.*must be empty/, "READY identity blockers must be empty");
rejects((payload) => { byAsset(payload, "SPX").identity.name = "S&P proxy"; }, /identity must equal the exact SPX identity contract/, "exact row identity names are enforced");
rejects((payload) => { delete byAsset(payload, "KOSPI").direct_provenance; }, /direct_provenance is required for READY KOSPI/, "READY KOSPI requires retained DART provenance");
rejects((payload) => { byAsset(payload, "KOSPI").direct_provenance.selected_artifact_sha256 = "f".repeat(64); }, /installed DART pointer.*selected artifact bytes/, "KOSPI selected artifact hash is bound to installed bytes");
rejects((payload) => { byAsset(payload, "KOSPI").direct_provenance.payout_ratio += 0.01; }, /payout_ratio must equal row.payout/, "KOSPI provenance payout must equal the valued operand");
rejects((payload) => { byAsset(payload, "CCMP").fair_value = 1; }, /fair_value must be null for NULL/, "NULL fair value cannot be promoted");
rejects((payload) => {
  const row = byAsset(payload, "CCMP");
  row.blockers.direct_input = [];
  row.blockers.freshness = [];
  row.blockers.identity = [];
}, /NULL row must carry at least one explicit blocker/, "NULL rows require an explicit blocker");
ok("READY and NULL row contracts fail closed independently");

// 4. Freshness/PIT clocks are enforced only for READY rows. The committed
// KOSPI NULL intentionally carries a later payout/forecast clock, which must
// remain an explainable warning rather than becoming a global failure.
rejects((payload) => { byAsset(payload, "SPX").source_clock.price_as_of = "2026-08-06"; }, /price_as_of must equal row.as_of/, "price source clock must match row as-of");
rejects((payload) => { byAsset(payload, "SPX").source_clock.erp_as_of = "2026-08-08"; }, /after price as-of/, "READY source clocks must satisfy PIT");
rejects((payload) => { byAsset(payload, "SPX").source_clock.rf_as_of = null; }, /rf_as_of is required/, "READY source clocks cannot be missing");
const nullClockCandidate = clone(artifact);
byAsset(nullClockCandidate, "KOSPI").source_clock.payout_availability = "2026-08-07";
byAsset(nullClockCandidate, "KOSPI").source_clock.forecast_availability = "2026-08-07";
nullClockCandidate.source_clocks.KOSPI = clone(byAsset(nullClockCandidate, "KOSPI").source_clock);
noErrors(nullClockCandidate);
ok("NULL PIT violations remain warning-valid while READY PIT violations fail");

// 5. The top-level source clock projection is a copy of the row clocks.
rejects((payload) => { payload.source_clocks.SPX = {}; }, /source_clocks\.SPX must equal/, "top-level source clocks must match row clocks");

// 6. Quarantine and identity metadata cannot drift into a public/promotion
// state, including flags added at a nested row location.
rejects((payload) => { payload.exact_yoo = true; }, /exact_yoo must be false/, "exact_yoo must remain false");
rejects((payload) => { payload.yoo_status = "IDENTIFIED"; }, /yoo_status must be NOT_IDENTIFIED/, "yoo status must remain NOT_IDENTIFIED");
rejects((payload) => { payload.public_surface.status = "PUBLIC"; }, /public_surface.status must remain QUARANTINED/, "public surface must remain quarantined");
rejects((payload) => { payload.display_ready = true; }, /display_ready must be false or absent/, "display-ready promotion is forbidden");
rejects((payload) => { byAsset(payload, "SPX").public_promotion = true; }, /public_promotion must be false or absent/, "nested public promotion is forbidden");
ok("quarantine, exact identity, and nested promotion guards are strict");

// 7. The diagnostic is honest when all values exist, but a partial five-row
// line is not rejected merely because its natural order cannot be compared.
const partialDiagnostic = clone(artifact);
partialDiagnostic.order_diagnostic.desired_order_met = true;
noErrors(partialDiagnostic);
const finiteOrder = clone(artifact);
const finiteUpsides = [0.4, 0.2, 0.3, 0.1, 0.05];
for (const [index, row] of finiteOrder.rows.entries()) {
  row.status = "READY";
  row.blockers = { direct_input: [], freshness: [], identity: [] };
  row.fair_value = row.spot * (1 + finiteUpsides[index]);
  row.fair_value_as_of = row.as_of;
  row.fair_value_upside = finiteUpsides[index];
  row.source_clock = Object.fromEntries([
    ["price_as_of", row.as_of],
    ["benchmark_as_of", row.as_of],
    ["payout_availability", row.as_of],
    ["forecast_availability", row.as_of],
    ["rf_as_of", row.as_of],
    ["erp_as_of", row.as_of],
  ]);
}
finiteOrder.source_clocks = Object.fromEntries(finiteOrder.rows.map((row) => [row.asset, row.source_clock]));
finiteOrder.order_diagnostic.non_finite_rows = [];
finiteOrder.order_diagnostic.desired_order_met = false;
finiteOrder.order_diagnostic.violations = [
  { asset_a: "SPX", asset_b: "CCMP", value_a: 0.4, value_b: 0.2 },
  { asset_a: "NDX", asset_b: "SOX", value_a: 0.3, value_b: 0.1 },
  { asset_a: "SOX", asset_b: "KOSPI", value_a: 0.1, value_b: 0.05 },
];
noErrors(finiteOrder);
const dishonestOrder = clone(finiteOrder);
dishonestOrder.order_diagnostic.desired_order_met = true;
const dishonestResult = validateFiveIndexCanonicalArtifact(dishonestOrder, { root: ROOT });
assert.equal(dishonestResult.valid, false);
assert.match(dishonestResult.errors.join("\n"), /desired_order_met/);
ok("order comparison is skipped for partial rows but checked honestly when all five are finite");

// 8. A public mirror is a hard failure even if the private artifact bytes are
// otherwise valid. Use a separate temp root so no repository generated file is
// created or altered.
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-five-validator-"));
try {
  const privatePath = path.join(tempRoot, ARTIFACT_REL);
  const mirrorPath = path.join(tempRoot, "100xfenok-next/public/data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json");
  fs.mkdirSync(path.dirname(privatePath), { recursive: true });
  fs.mkdirSync(path.dirname(mirrorPath), { recursive: true });
  fs.writeFileSync(privatePath, `${JSON.stringify(artifact, null, 2)}\n`);
  fs.writeFileSync(mirrorPath, "{}\n");
  const mirrored = validateFiveIndexCanonicalFile({ root: tempRoot });
  assert.equal(mirrored.valid, false);
  assert.match(mirrored.errors.join("\n"), /mirrored/);
  ok("public mirror path is rejected from the actual-file validation path");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

// 9. Malformed actual files fail before any row interpretation.
const malformedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rim-five-validator-malformed-"));
try {
  const malformedPath = path.join(malformedRoot, ARTIFACT_REL);
  fs.mkdirSync(path.dirname(malformedPath), { recursive: true });
  fs.writeFileSync(malformedPath, "not-json\n");
  const malformed = validateFiveIndexCanonicalFile({ root: malformedRoot });
  assert.equal(malformed.valid, false);
  assert.match(malformed.errors.join("\n"), /invalid JSON/);
  ok("invalid actual artifact JSON fails closed");
} finally {
  fs.rmSync(malformedRoot, { recursive: true, force: true });
}

// 10. The CLI reads the actual tracked file and returns a warning-valid zero
// status; this is the command used immediately before KPI generation.
const cli = spawnSync(process.execPath, [CHECKER_PATH], { cwd: ROOT, encoding: "utf8" });
assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
assert.match(cli.stdout, /public_surface=QUARANTINED/);
ok("validator CLI succeeds on the actual private artifact");

console.log(`\n${passed} checks passed`);
