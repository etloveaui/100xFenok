#!/usr/bin/env node

// Contract tests — floor-free five-index canonical RIM builder
// (scripts/build-rim-index-five-canonical.mjs).
//
// Owner-pinned interfaces:
//   - implementation: scripts/build-rim-index-five-canonical.mjs
//   - output: data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json
//   - exports: FIVE_INDICES, buildFiveIndexCanonical(root, options={}),
//     fiveIndexOrderDiagnostic(rows)
//   - criteria: data/computed/rim-index/feno-index-rim-five-canonical-
//     criteria.json (rules and gate limits only; no frozen result values;
//     the frozen SPX/NDX criteria values are never reused as operands)
//   - metadata: exact_yoo=false and yoo_status=NOT_IDENTIFIED;
//     public_surface=QUARANTINED
//   - primary scalar: same-as-of fair_value_upside = fair_value / spot - 1;
//     no horizon conversion
//   - fail-closed rows: any missing/non-direct/proxy-mixed operand, any
//     operand whose availability date is after the row price as-of (PIT),
//     any SOXX-sourced SOX price, or any gate failure emits NULL with
//     explicit blockers
//   - CCMP (missing forecast/payout) emits NULL; KOSPI becomes READY only
//     when the producer supplies the validated direct OpenDART aggregate
//   - the desired owner order is a boolean diagnostic only: never reorder,
//     never shift, never throw
//
// The real-root status is producer-owned and may advance as source clocks or
// exact-index inputs improve. The test pins the fail-closed contract and
// metadata, not a stale snapshot of READY versus NULL rows.
//
// Synthetic roots copy the committed criteria, inputs.json and benchmark
// files into throwaway temp dirs, then re-stamp every operand availability
// date to the row price as-of and re-mark SOX provenance as exact-index so
// the engine path is exercised with committed economic values. The real
// data tree is never written. No network. The real floor-evidence fixture
// is never read.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalValue } from "./build-rim-index-final.mjs";
import {
  FIVE_INDICES,
  buildFiveIndexCanonical,
  fiveIndexOrderDiagnostic,
} from "./build-rim-index-five-canonical.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_REL = "data/computed/rim-index/FENO_RIM_FIVE_CANONICAL_CURRENT.json";
const CRITERIA_REL = "data/computed/rim-index/feno-index-rim-five-canonical-criteria.json";
const INPUTS_REL = "data/computed/rim-index/inputs.json";
const FLOOR_EVIDENCE_REL = "scripts/fixtures/fenok-rim-calibration-evidence.json";
const OLD_CRITERIA_REL = "data/computed/rim-index/feno-index-rim-canonical-criteria.json";
const BENCHMARK_FILES = [
  "data/benchmarks/us.json",
  "data/benchmarks/micro_sectors.json",
  "data/benchmarks/emerging.json",
];

const FIXED_GENERATED_AT = "2026-08-09T00:00:00.000Z";
const DESIRED_ORDER = ["SPX", "CCMP", "NDX", "SOX", "KOSPI"];
const IDENTITY_NAMES = Object.freeze({
  CCMP: "Nasdaq Composite",
  NDX: "Nasdaq-100",
  SOX: "Philadelphia Semiconductor Index",
});
const ECONOMIC_DATE_KEYS = new Set([
  "as_of",
  "date",
  "availability_date",
  "availability_as_of",
  "benchmark_as_of",
  "coverage_date",
  "coverage_as_of",
  "effective_date",
  "erp_as_of",
  "forecast_as_of",
  "index_as_of",
  "observation_date",
  "observation_as_of",
  "payout_as_of",
  "period_date",
  "price_as_of",
  "rf_as_of",
  "source_date",
  "source_as_of",
  "stock_action_source_date",
  "sox_constituents_as_of",
  "krx_weight_as_of",
]);
const isEconomicDateKey = (key) => typeof key === "string"
  && ECONOMIC_DATE_KEYS.has(key.toLowerCase())
  && !/generated|collected|fetched|processed|created|written|_at$/i.test(key);

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`PASS ${name}`);
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const clone = (value) => JSON.parse(JSON.stringify(value));
const finite = Number.isFinite;
const rowsOf = (artifact) => new Map(artifact.rows.map((row) => [row.asset, row]));
const statusOf = (artifact, asset) => rowsOf(artifact).get(asset).status;
const blockersOf = (artifact, asset, group) => rowsOf(artifact).get(asset).blockers[group];
const identityOf = (artifact, asset) => rowsOf(artifact).get(asset).identity.name;

// ---------------------------------------------------------------------------
// synthetic-root helpers
// ---------------------------------------------------------------------------

const createdDirs = [];

// Re-stamp every operand availability date to the row price as-of and re-mark
// SOX provenance as exact-index. This is the only data fabrication allowed:
// dates and provenance markers change; every economic value stays committed.
function cleanDates(inputs) {
  const restampDates = (obj, priceAsOf) => {
    if (obj == null || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) restampDates(item, priceAsOf);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (isEconomicDateKey(key) && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        obj[key] = priceAsOf;
      } else if (value && typeof value === "object") {
        restampDates(value, priceAsOf);
      }
    }
  };
  for (const idx of FIVE_INDICES) {
    const entry = inputs.indices[idx];
    const priceAsOf = entry.observed.price.as_of;
    for (const key of Object.keys(entry.observed)) {
      const field = entry.observed[key];
      if (key !== "price" && field && typeof field === "object" && typeof field.as_of === "string") {
        field.as_of = priceAsOf;
      }
    }
    restampDates(entry.derived.payout_ratio, priceAsOf);
    restampDates(entry.derived.forecast_grid_v1, priceAsOf);
  }
  // Mirror the producer's real shape: indices/sox.json is accepted only when
  // the observed payload also carries an explicit provider symbol.
  inputs.indices.SOX.observed.price.source = "indices/sox.json";
  inputs.indices.SOX.observed.price.source_field = "rows[-1].value";
  inputs.indices.SOX.observed.price.identity = {
    provider_symbol: "^SOX",
    canonical_index: "SOX",
  };
  inputs.indices.SOX.derived.forecast_grid_v1.public_status = "input_only_sox_methodology_weights_no_fair_value";
  inputs.indices.SOX.derived.forecast_grid_v1.coverage.index_diagnostics.index_id = "SOX";
}

// Throwaway root: committed criteria + inputs + benchmark files, cleaned,
// optionally mutated, plus optional extra files.
function makeSyntheticRoot({ mutateInputs, mutateCriteria, mutateBenchmarks, extraFiles } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rim-five-canonical-"));
  createdDirs.push(dir);
  const copy = (rel) => {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), target);
  };
  copy(CRITERIA_REL);
  copy(INPUTS_REL);
  for (const rel of BENCHMARK_FILES) copy(rel);

  const inputsPath = path.join(dir, INPUTS_REL);
  const inputs = readJson(inputsPath);
  cleanDates(inputs);
  if (mutateInputs) mutateInputs(inputs);
  fs.writeFileSync(inputsPath, `${JSON.stringify(inputs, null, 2)}\n`);

  if (mutateCriteria) {
    const criteriaPath = path.join(dir, CRITERIA_REL);
    const criteriaPayload = readJson(criteriaPath);
    mutateCriteria(criteriaPayload);
    fs.writeFileSync(criteriaPath, `${JSON.stringify(criteriaPayload, null, 2)}\n`);
  }

  if (mutateBenchmarks) {
    for (const rel of BENCHMARK_FILES) {
      const benchmarkPath = path.join(dir, rel);
      const payload = readJson(benchmarkPath);
      mutateBenchmarks(payload, rel, dir);
      fs.writeFileSync(benchmarkPath, `${JSON.stringify(payload, null, 2)}\n`);
    }
  }

  for (const [rel, payload] of Object.entries(extraFiles ?? {})) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof payload === "string" ? payload : `${JSON.stringify(payload, null, 2)}\n`);
  }
  return dir;
}

function recomputeViolations(rows) {
  const byAsset = new Map(rows.map((row) => [row.asset, row]));
  const violations = [];
  for (let i = 0; i < DESIRED_ORDER.length - 1; i += 1) {
    const a = byAsset.get(DESIRED_ORDER[i]);
    const b = byAsset.get(DESIRED_ORDER[i + 1]);
    if (a && b && finite(a.fair_value_upside) && finite(b.fair_value_upside)
      && !(b.fair_value_upside > a.fair_value_upside)) {
      violations.push({ asset_a: a.asset, asset_b: b.asset, value_a: a.fair_value_upside, value_b: b.fair_value_upside });
    }
  }
  return violations;
}

// Per-row contract: identity, exactly one upside scalar, no floor, no order
// projection fields, grouped direct-input/freshness/identity blockers, and
// same-as-of fair-value arithmetic on READY rows.
function assertRowContract(row) {
  assert.ok(
    typeof row.identity === "object" && typeof row.identity.name === "string" && row.identity.name.length > 0,
    `${row.asset} must carry a non-empty identity name`,
  );
  assert.deepEqual(
    Object.keys(row).filter((key) => key.includes("upside")),
    ["fair_value_upside"],
    `${row.asset} must expose exactly one upside scalar: fair_value_upside`,
  );
  for (const key of Object.keys(row)) {
    assert.ok(!/12m|twelve/i.test(key), `${row.asset} must carry no horizon-conversion field (${key})`);
  }
  assert.ok(!("floor" in row), `${row.asset} must be floor-free`);
  assert.ok(!("selected" in row) && !("gap_to_next" in row), `${row.asset} must carry no order-projection fields`);
  assert.deepEqual(
    Object.keys(row.blockers).sort(),
    ["direct_input", "freshness", "identity"],
    `${row.asset} blockers must be grouped as direct-input/freshness/identity`,
  );
  for (const group of Object.values(row.blockers)) {
    assert.ok(Array.isArray(group) && group.every((blocker) => typeof blocker === "string"),
      `${row.asset} blocker groups must be string arrays`);
  }
  if (row.status === "READY") {
    assert.ok(finite(row.spot) && row.spot > 0, `${row.asset} READY row needs a positive spot`);
    assert.ok(finite(row.fair_value), `${row.asset} READY row needs a finite fair_value`);
    assert.ok(finite(row.fair_value_upside), `${row.asset} READY row needs a finite fair_value_upside`);
    assert.ok(Number.isFinite(Date.parse(row.as_of)), `${row.asset} as_of must be a valid date`);
    assert.equal(row.fair_value_as_of, row.as_of, `${row.asset} fair value must be same-as-of with the price`);
    assert.ok(
      Math.abs(row.fair_value_upside - (row.fair_value / row.spot - 1)) < 1e-9,
      `${row.asset} fair_value_upside must equal fair_value / spot - 1`,
    );
    assert.deepEqual(row.blockers.direct_input, [], `${row.asset} READY row must have no direct-input blockers`);
    assert.deepEqual(row.blockers.freshness, [], `${row.asset} READY row must have no freshness blockers`);
    assert.deepEqual(row.blockers.identity, [], `${row.asset} READY row must have no identity blockers`);
  } else if (row.status === "NULL") {
    assert.equal(row.fair_value_upside, null, `${row.asset} NULL row must emit a null fair_value_upside`);
    assert.equal(row.fair_value, null, `${row.asset} NULL row must emit a null fair_value`);
    assert.ok(
      row.blockers.direct_input.length + row.blockers.freshness.length + row.blockers.identity.length > 0,
      `${row.asset} NULL row must carry at least one blocker`,
    );
  } else {
    assert.fail(`${row.asset}: unexpected status ${JSON.stringify(row.status)}`);
  }
}

// ---- 1. exports and the exact index order ----
assert.equal(typeof buildFiveIndexCanonical, "function", "buildFiveIndexCanonical must be exported");
assert.equal(typeof fiveIndexOrderDiagnostic, "function", "fiveIndexOrderDiagnostic must be exported");
assert.deepEqual(FIVE_INDICES, ["SPX", "CCMP", "NDX", "SOX", "KOSPI"], "FIVE_INDICES order is contract-pinned");
ok("exports FIVE_INDICES, buildFiveIndexCanonical, fiveIndexOrderDiagnostic with the pinned order");

// ---- 2. the prospective criteria authority must exist ----
assert.ok(
  fs.existsSync(path.join(ROOT, CRITERIA_REL)),
  "feno-index-rim-five-canonical-criteria.json is a required dependency",
);
const criteria = readJson(path.join(ROOT, CRITERIA_REL));
assert.equal(typeof criteria, "object", "the five-canonical criteria must parse as JSON");
assert.deepEqual(criteria.identity, { SPX: "S&P 500", CCMP: "Nasdaq Composite", NDX: "Nasdaq-100", SOX: "Philadelphia Semiconductor Index", KOSPI: "KOSPI" },
  "the criteria must pin the exact five IDs and identity names");
assert.deepEqual(criteria.directness.required_operands, [
  "observed.price",
  "observed.price_to_book",
  "observed.forward_eps",
  "derived.book_value",
  "derived.payout_ratio",
  "derived.forecast_grid_v1.periods[*].earnings_proxy",
  "derived.forecast_grid_v1.coverage.index_diagnostics",
  "observed.risk_free_rate",
  "observed.equity_risk_premium",
], "the criteria must enumerate every directness-gated operand");
assert.ok(criteria.freshness.required_price_metadata.includes("future_date_anomaly"),
  "the criteria must require complete price freshness metadata");
assert.ok(criteria.source_clocks.economic_date_key_allowlist.includes("stock_action_source_date"),
  "the criteria must whitelist economic source dates explicitly");
assert.equal(criteria.directness.sox_methodology_exception.admissible_source_tier,
  "methodology_derived_index_weight_source", "the SOX exception must pin its otherwise-prohibited source tier");
assert.deepEqual(criteria.directness.sox_methodology_exception.required_cap_schedule, {
  largest_market_cap: 0.12,
  second_largest_market_cap: 0.1,
  third_largest_market_cap: 0.08,
  other_constituents: 0.04,
}, "the SOX exception must pin the published 12/10/8/4 cap schedule");
assert.equal(criteria.directness.sox_methodology_exception.min_financial_coverage_ratio, 0.75,
  "the SOX methodology coverage floor must remain 0.75");
ok("the five-canonical criteria file exists and pins the five IDs and identity names");

// ---- 3. real-root build: deterministic, fail-closed, measured statuses ----
const artifact = buildFiveIndexCanonical(ROOT, { generatedAt: FIXED_GENERATED_AT });
assert.deepEqual(
  buildFiveIndexCanonical(ROOT, { generatedAt: FIXED_GENERATED_AT }),
  artifact,
  "the artifact must be deterministic for a fixed generated-at",
);
assert.equal(artifact.generated_at, FIXED_GENERATED_AT);
assert.equal(artifact.exact_yoo, false, "exact_yoo must be false");
assert.equal(artifact.yoo_status, "NOT_IDENTIFIED", "yoo status must be NOT_IDENTIFIED");
const surfaceStatus = typeof artifact.public_surface === "string"
  ? artifact.public_surface
  : artifact.public_surface?.status;
assert.equal(surfaceStatus, "QUARANTINED", "public_surface must be QUARANTINED");
assert.equal(artifact.criteria, CRITERIA_REL, "the artifact must name the five-canonical criteria as its authority");
assert.equal(artifact.primary_scalar, "fair_value_upside", "the primary scalar must be fair_value_upside");
assert.equal(artifact.horizon, "same_as_of", "the primary scalar is same-as-of; no horizon conversion");
assert.ok(!Object.keys(artifact).some((key) => /12m|twelve/i.test(key)), "the artifact must carry no horizon-conversion field");
assert.equal(artifact.rows.length, 5, "there must be rows for all five assets");
assert.deepEqual(artifact.rows.map((row) => row.asset), FIVE_INDICES,
  "rows must stay in FIVE_INDICES order and never be reordered");
for (const row of artifact.rows) assertRowContract(row);
const rows = rowsOf(artifact);
assert.equal(rows.get("CCMP").identity.name, IDENTITY_NAMES.CCMP, "CCMP identity must be Nasdaq Composite");
assert.equal(rows.get("NDX").identity.name, IDENTITY_NAMES.NDX, "NDX identity must be Nasdaq-100");
assert.equal(rows.get("SOX").identity.name, IDENTITY_NAMES.SOX, "SOX identity must be Philadelphia Semiconductor Index");

// Producer-owned statuses are accepted only through the row contract: READY
// rows must be complete and NULL rows must carry explicit blockers.
for (const asset of FIVE_INDICES) {
  assert.ok(["READY", "NULL"].includes(rows.get(asset).status), `${asset} must use READY or NULL only`);
  if (rows.get(asset).status === "NULL") {
    assert.ok(
      blockersOf(artifact, asset, "direct_input").length
        + blockersOf(artifact, asset, "freshness").length
        + blockersOf(artifact, asset, "identity").length > 0,
      `${asset} NULL must carry an explicit blocker`,
    );
  }
}
ok("real-root build is deterministic and every producer-owned row remains fail-closed");

// ---- 4. the desired owner order is a boolean diagnostic only ----
const makeOrdered = (upsides) => clone(artifact.rows).map((row, i) => ({ ...row, fair_value_upside: upsides[i] }));
const orderedRows = makeOrdered([0.05, 0.1, 0.2, 0.3, 0.4]);
assert.equal(typeof fiveIndexOrderDiagnostic(orderedRows), "boolean", "the diagnostic must return a boolean");
assert.equal(fiveIndexOrderDiagnostic(orderedRows), true, "strictly increasing finite upsides must report true");
assert.equal(fiveIndexOrderDiagnostic([...orderedRows].reverse()), true,
  "the diagnostic must be asset-keyed, not positional");
assert.equal(fiveIndexOrderDiagnostic(makeOrdered([0.9, 0.1, 0.2, 0.3, 0.4])), false,
  "a violated desired order must report false, not throw");
assert.equal(fiveIndexOrderDiagnostic(makeOrdered([null, null, null, null, null])), false,
  "non-finite upsides must report false, not throw");
const purityProbe = clone(artifact.rows);
fiveIndexOrderDiagnostic(purityProbe);
assert.deepEqual(purityProbe, artifact.rows, "the diagnostic must never mutate its input rows");
assert.ok(artifact.order_diagnostic, "the artifact must carry an order_diagnostic");
assert.deepEqual(artifact.order_diagnostic.desired_order, DESIRED_ORDER, "the diagnostic must pin the desired owner order");
assert.equal(artifact.order_diagnostic.desired_order_met, fiveIndexOrderDiagnostic(artifact.rows),
  "the artifact diagnostic must agree with the exported diagnostic");
assert.deepEqual(artifact.order_diagnostic.violations, recomputeViolations(artifact.rows),
  "violations must report exactly the non-increasing adjacent pairs");
assert.deepEqual(
  artifact.order_diagnostic.non_finite_rows,
  artifact.rows.filter((row) => !finite(row.fair_value_upside)).map((row) => row.asset),
  "non-finite rows must be reported as such",
);
assert.equal(artifact.order_diagnostic.values_shifted, false,
  "the diagnostic must never shift values to satisfy the order");
ok("order diagnostic reports honestly: boolean, asset-keyed, non-mutating, consistent, values never shifted");

// Forced violation at artifact level on a clean synthetic root: halve only
// the exact NDX spot input. Its canonical fair value is unchanged while its
// same-as-of upside rises above SOX, creating a deterministic NDX -> SOX
// strict-order break without changing identity, provenance or model operands.
const violationRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    inputs.indices.NDX.observed.price.value *= 0.5;
  },
});
const violationArtifact = buildFiveIndexCanonical(violationRoot, { generatedAt: FIXED_GENERATED_AT });
const violationRows = rowsOf(violationArtifact);
assert.equal(statusOf(violationArtifact, "SPX"), "READY", "the clean synthetic violation root must compute SPX");
assert.equal(statusOf(violationArtifact, "NDX"), "READY", "the cloned NDX row must compute");
assert.ok(violationRows.get("NDX").fair_value_upside > violationRows.get("SOX").fair_value_upside,
  "the denominator-only fixture must create an NDX -> SOX violation");
assert.equal(violationArtifact.order_diagnostic.desired_order_met, false,
  "an order failure must be reported, not repaired");
assert.ok(
  violationArtifact.order_diagnostic.violations.some((v) => v.asset_a === "NDX" && v.asset_b === "SOX"),
  "the NDX -> SOX non-increasing pair must be reported",
);
assert.equal(violationArtifact.order_diagnostic.values_shifted, false, "values must not be shifted to force order");
assert.deepEqual(violationArtifact.rows.map((row) => row.asset), FIVE_INDICES, "rows must not be reordered");
ok("artifact-level order failure is reported honestly without throwing or shifting values");

// ---- 5. clean synthetic baseline: engine path exercised ----
const baselineRoot = makeSyntheticRoot({});
const baseline = buildFiveIndexCanonical(baselineRoot, { generatedAt: FIXED_GENERATED_AT });
for (const asset of ["SPX", "NDX", "SOX", "KOSPI"]) {
  assert.equal(statusOf(baseline, asset), "READY", `${asset} must be READY on the clean synthetic baseline`);
  assertRowContract(rowsOf(baseline).get(asset));
}
for (const asset of ["CCMP"]) {
  assert.equal(statusOf(baseline, asset), "NULL", `${asset} must be NULL on the clean synthetic baseline`);
}
// Engine parity: the builder's fair value must be exactly the index-agnostic
// canonical engine's base cell for the same operands.
for (const asset of ["SPX", "NDX", "SOX", "KOSPI"]) {
  const row = rowsOf(baseline).get(asset);
  const parity = canonicalValue({
    b0: row.book_value,
    epsPath: row.eps_path,
    payout: row.payout,
    ke: row.ke,
    ltroe: row.ltroe,
    g: row.g,
  });
  assert.ok(parity.value !== null && Math.abs(parity.value - row.fair_value) < 1e-9,
    `${asset} fair value must match the canonical engine base cell`);
}
ok("clean synthetic baseline computes SPX/NDX/SOX/KOSPI READY with canonical-engine parity; CCMP stays NULL");

// A spot-only change must move the same-as-of upside through its denominator,
// not cause the builder to fit or replace the canonical fair value.
const spotMutationRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => { inputs.indices.SPX.observed.price.value += 100; },
});
const spotMutationArtifact = buildFiveIndexCanonical(spotMutationRoot, { generatedAt: FIXED_GENERATED_AT });
const baselineSpx = rowsOf(baseline).get("SPX");
const mutatedSpx = rowsOf(spotMutationArtifact).get("SPX");
assert.equal(mutatedSpx.fair_value, baselineSpx.fair_value,
  "a spot-only change must not fit or replace the canonical fair value");
assert.notEqual(mutatedSpx.fair_value_upside, baselineSpx.fair_value_upside,
  "a spot-only change must change the denominator-derived upside");
assert.equal(mutatedSpx.fair_value_upside, mutatedSpx.fair_value / mutatedSpx.spot - 1,
  "spot-only changes must preserve the fair_value / spot - 1 scalar");
ok("spot changes are denominator-only: no per-index fitting or hard-coded output target is applied");

// ---- 6. published floor evidence cannot affect the output ----
// baselineRoot has no fixture at all; this root adds a mutated one.
const floorRoot = makeSyntheticRoot({
  extraFiles: {
    [FLOOR_EVIDENCE_REL]: { source_ledger: "MUTATED", claims: [{ evidence_id: "rim-mutated", raw_value: "999" }] },
  },
});
const withFloor = buildFiveIndexCanonical(floorRoot, { generatedAt: FIXED_GENERATED_AT });
assert.deepEqual(withFloor, baseline,
  "adding or mutating published floor evidence must not change the output");
for (const row of withFloor.rows) {
  assert.ok(!("floor" in row), "rows stay floor-free even when floor evidence is present");
}
ok("floor evidence is inert: baseline (absent) and mutated fixture build identically");

// ---- 7. the frozen SPX/NDX canonical criteria must never be reused ----
const oldCriteria = readJson(path.join(ROOT, OLD_CRITERIA_REL));
oldCriteria.grids.ltroe.SPX = { low: 0.99, base: 0.999, high: 0.999 };
oldCriteria.grids.erp.base = 0.99;
oldCriteria.stable_growth.g_base_value = 0.09;
const oldCriteriaRoot = makeSyntheticRoot({ extraFiles: { [OLD_CRITERIA_REL]: oldCriteria } });
const withOldCriteria = buildFiveIndexCanonical(oldCriteriaRoot, { generatedAt: FIXED_GENERATED_AT });
assert.deepEqual(withOldCriteria, baseline,
  "mutated frozen SPX/NDX criteria values must not leak into the five-canonical output");
ok("the frozen feno-index-rim-canonical-criteria.json is never read as a dynamic operand");

// ---- 8. stale required inputs emit NULL with a freshness blocker ----
const staleRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const price = inputs.indices.SPX.observed.price;
    price.as_of = "2020-01-01";
    price.freshness.status = "stale";
    price.freshness.calendar_age_days = 99999;
  },
});
const staleArtifact = buildFiveIndexCanonical(staleRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(staleArtifact, "SPX"), "NULL", "a stale SPX price must emit NULL");
assert.ok(blockersOf(staleArtifact, "SPX", "freshness").length > 0, "stale SPX must carry a freshness blocker");
assert.equal(statusOf(staleArtifact, "NDX"), "READY", "other rows must stay unaffected by the SPX staleness");
ok("stale required input emits NULL with a freshness blocker");

// ---- 9. non-direct (proxy-marked) required inputs emit NULL ----
const proxyRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    inputs.indices.SPX.derived.forecast_grid_v1.public_status = "proxy_financials_coverage_ready_exact_index_blocked";
  },
});
const proxyArtifact = buildFiveIndexCanonical(proxyRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(proxyArtifact, "SPX"), "NULL", "a proxy-marked forecast must emit NULL");
assert.match(blockersOf(proxyArtifact, "SPX", "direct_input").join(" "), /proxy/i,
  "a non-direct input must carry a direct-input blocker");
assert.equal(statusOf(proxyArtifact, "NDX"), "READY", "other rows must stay unaffected by the SPX proxy marker");
ok("non-direct (proxy-marked) required input emits NULL with a direct-input blocker");

// ---- 10. every required operand is directness-gated ----
const directnessMutations = [
  ["price", (inputs) => { inputs.indices.SPX.observed.price.source_tier = "proxy_diagnostic"; }],
  ["price_to_book", (inputs) => { inputs.indices.SPX.observed.price_to_book.source_tier = "proxy_diagnostic"; }],
  ["forward_eps", (inputs) => { inputs.indices.SPX.observed.forward_eps.source_tier = "proxy_diagnostic"; }],
  ["book_value", (inputs) => { inputs.indices.SPX.derived.book_value.source_tier = "proxy_diagnostic"; }],
  ["payout_ratio", (inputs) => { inputs.indices.SPX.derived.payout_ratio.source_tier = "proxy_diagnostic"; }],
  ["forecast_grid_v1 FY1 earnings_proxy", (inputs) => {
    inputs.indices.SPX.derived.forecast_grid_v1.periods[0].earnings_proxy.source_tier = "proxy_diagnostic";
  }],
  ["forecast_grid_v1 public_status", (inputs) => {
    delete inputs.indices.SPX.derived.forecast_grid_v1.public_status;
  }],
  ["forecast_grid_v1 coverage.index_diagnostics", (inputs) => {
    inputs.indices.SPX.derived.forecast_grid_v1.coverage.index_diagnostics.source_tier = "proxy_diagnostic";
  }],
  ["risk_free_rate", (inputs) => { inputs.indices.SPX.observed.risk_free_rate.source_tier = "proxy_diagnostic"; }],
  ["equity_risk_premium", (inputs) => { inputs.indices.SPX.observed.equity_risk_premium.source_tier = "proxy_diagnostic"; }],
];
for (const [label, mutateInputs] of directnessMutations) {
  const directnessRoot = makeSyntheticRoot({ mutateInputs });
  const directnessArtifact = buildFiveIndexCanonical(directnessRoot, { generatedAt: FIXED_GENERATED_AT });
  assert.equal(statusOf(directnessArtifact, "SPX"), "NULL", `${label} non-direct tier must emit NULL`);
  assert.match(
    blockersOf(directnessArtifact, "SPX", "direct_input").join(" "),
    new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    `${label} must carry a direct-input blocker`,
  );
}
ok("directness checks every required price, valuation, forecast, payout, Rf, and ERP operand");

// Exact artifact identity is not inherited from mutable criteria or source
// prose. A renamed criterion or provider mapping fails the affected row.
const renamedIdentityRoot = makeSyntheticRoot({
  mutateCriteria: (criteria) => { criteria.identity.SPX = "S&P proxy"; },
});
const renamedIdentityArtifact = buildFiveIndexCanonical(renamedIdentityRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(renamedIdentityArtifact, "SPX"), "NULL");
assert.match(blockersOf(renamedIdentityArtifact, "SPX", "identity").join(" "), /criteria identity.*S&P 500/i);
assert.deepEqual(rowsOf(renamedIdentityArtifact).get("SPX").identity, { id: "SPX", name: "S&P 500" });
ok("mutable criteria cannot rename the exact five-index artifact identities");

// Fabricating three finite CCMP periods is insufficient: the canonical layer
// independently requires converter-owned FY1/FY2/FY3 fields and best_eps_asof
// provenance.
const fabricatedCcmpRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const ccmp = inputs.indices.CCMP.derived.forecast_grid_v1;
    const ndx = inputs.indices.NDX.derived.forecast_grid_v1;
    ccmp.public_status = "ready_inputs_only_no_fair_value";
    ccmp.source_tier = "direct_index_source";
    ccmp.periods = clone(ndx.periods);
    ccmp.coverage = clone(ndx.coverage);
  },
});
const fabricatedCcmpArtifact = buildFiveIndexCanonical(fabricatedCcmpRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(fabricatedCcmpArtifact, "CCMP"), "NULL");
assert.match(blockersOf(fabricatedCcmpArtifact, "CCMP", "direct_input").join(" "), /FY1\/FY2\/FY3.*best_eps_asof.*proof/i);
ok("CCMP finite periods remain NULL without direct FY2/FY3/as-of provenance proof");

// READY KOSPI retains the exact private pointer-selected aggregate digest and
// clocks. Corrupting the hash must fail closed before valuation.
const baselineKospi = rowsOf(baseline).get("KOSPI");
assert.equal(baselineKospi.direct_provenance.pointer_path, "computed/fenok-rim/kospi-dart-payout/current.json");
assert.match(baselineKospi.direct_provenance.selected_artifact_sha256, /^[a-f0-9]{64}$/);
assert.equal(baselineKospi.direct_provenance.payout_ratio, baselineKospi.payout);
const badKospiProofRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    inputs.indices.KOSPI.derived.payout_ratio.coverage.pointer_sha256 = "0".repeat(63);
  },
});
const badKospiProofArtifact = buildFiveIndexCanonical(badKospiProofRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(badKospiProofArtifact, "KOSPI"), "NULL");
assert.match(blockersOf(badKospiProofArtifact, "KOSPI", "direct_input").join(" "), /OpenDART pointer\/hash\/provenance/i);
ok("KOSPI READY retains exact DART provenance and malformed hash fails closed");

// ---- 11. SOXX as the SOX headline is an identity failure ----
const soxxRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const price = inputs.indices.SOX.observed.price;
    price.source = "yf/finance/SOXX.json";
    price.source_field = "data.fast_info.lastPrice";
  },
});
const soxxArtifact = buildFiveIndexCanonical(soxxRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(soxxArtifact, "SOX"), "NULL", "an SOXX-sourced SOX price must emit NULL");
assert.match(blockersOf(soxxArtifact, "SOX", "identity").join(" "), /SOXX/i,
  "the SOXX ETF headline must fire an identity blocker");
assert.equal(identityOf(soxxArtifact, "SOX"), IDENTITY_NAMES.SOX,
  "a blocked SOX row must still pin the Philadelphia Semiconductor identity");
ok("SOXX-as-SOX-headline emits NULL with an identity blocker; the target identity stays pinned");

// ---- 12. the real indices/sox.json shape needs explicit ^SOX identity ----
const soxPathOnlyRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const entry = inputs.indices.SOX;
    entry.observed.price.source = "indices/sox.json";
    entry.observed.price.source_field = "rows[-1].value";
    delete entry.observed.price.identity;
  },
});
const soxPathOnlyArtifact = buildFiveIndexCanonical(soxPathOnlyRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(soxPathOnlyArtifact, "SOX"), "NULL",
  "indices/sox.json with rows[-1].value but no identity metadata must emit NULL");
assert.match(blockersOf(soxPathOnlyArtifact, "SOX", "identity").join(" "), /identity|\^SOX/i,
  "path-only SOX input must carry an identity blocker");
ok("the indices/sox.json filename and generic value field are not whitelisted as SOX identity");

const explicitProviderRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const entry = inputs.indices.SOX;
    entry.observed.price.source = "indices/sox.json";
    entry.observed.price.source_field = "rows[-1].value";
    entry.observed.price.identity = {
      provider_symbol: "^SOX",
      canonical_index: "SOX",
    };
  },
});
const explicitProviderArtifact = buildFiveIndexCanonical(explicitProviderRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(explicitProviderArtifact, "SOX"), "READY",
  "indices/sox.json with observed.price.identity.provider_symbol ^SOX must pass identity");
assert.deepEqual(blockersOf(explicitProviderArtifact, "SOX", "identity"), [],
  "explicit observed ^SOX identity must clear identity blockers");
ok("the real producer-shaped indices/sox.json fixture passes only with explicit observed ^SOX identity");

const wrongProviderRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    inputs.indices.SOX.observed.price.identity = {
      provider_symbol: "SOXX",
      canonical_index: "SOX",
    };
  },
});
const wrongProviderArtifact = buildFiveIndexCanonical(wrongProviderRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(wrongProviderArtifact, "SOX"), "NULL", "a non-exact provider symbol must emit NULL");
assert.match(blockersOf(wrongProviderArtifact, "SOX", "identity").join(" "), /SOXX|exactly \^SOX/i,
  "a non-exact provider symbol must carry an identity blocker");
ok("only exact provider_symbol ^SOX is accepted; SOXX identity remains rejected");

// ---- 13. source text alone cannot replace exact provider identity ----
const directSoxRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const price = inputs.indices.SOX.observed.price;
    price.source = "provider/daily-index.json";
    price.source_field = "rows[symbol=^SOX].close";
    delete inputs.indices.SOX.observed.price.identity;
  },
});
const directSoxArtifact = buildFiveIndexCanonical(directSoxRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(directSoxArtifact, "SOX"), "NULL", "a direct ^SOX source_field without exact identity must fail closed");
assert.match(blockersOf(directSoxArtifact, "SOX", "identity").join(" "), /identity|\^SOX/i,
  "source text alone must not replace exact provider identity metadata");
ok("direct ^SOX source text is insufficient without exact identity metadata");

// ---- 14. the SOX methodology exception is narrow, complete, and fail-closed ----
const methodologyTierRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const entry = inputs.indices.SOX;
    entry.derived.payout_ratio.source_tier = "methodology_derived_index_weight_source";
    for (const period of entry.derived.forecast_grid_v1.periods) {
      period.earnings_proxy.source_tier = "methodology_derived_index_weight_source";
    }
  },
});
const methodologyTierArtifact = buildFiveIndexCanonical(methodologyTierRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(methodologyTierArtifact, "SOX"), "READY",
  "the complete SOX contract must admit its narrowly scoped methodology source tier");
assert.deepEqual(blockersOf(methodologyTierArtifact, "SOX", "direct_input"), [],
  "the complete SOX methodology contract must clear direct-input blockers");
assert.equal(methodologyTierArtifact.public_surface.status, "QUARANTINED",
  "methodology admission must not promote the public surface");
ok("complete SOX GIW plus 12/10/8/4 methodology evidence is admitted while remaining quarantined");

const soxMethodologyMutations = [
  ["wrong cap", /cap_schedule\.largest_market_cap/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.methodology.cap_schedule.largest_market_cap = 0.11;
  }],
  ["missing disclosure", /official_weight_columns_available/i, (entry) => {
    delete entry.derived.forecast_grid_v1.coverage.index_diagnostics.official_weight_columns_available;
  }],
  ["coverage below floor", /below 0\.75/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.dividend_yield_weight_ratio = 0.74;
  }],
  ["SOXX source token", /forbidden source token SOXX|constituent source/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.source = "yf/finance/SOXX.json";
  }],
  ["SOXQ source token", /forbidden source token SOXQ/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.source_url = "https://example.invalid/SOXQ";
  }],
  ["ETF source token", /forbidden source token ETF/i, (entry) => {
    entry.derived.payout_ratio.sources.push("ETF/semiconductor-holdings.json");
  }],
  ["proxy source token", /forbidden source token proxy/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.source_field = "proxy constituent holdings";
  }],
  ["stale methodology", /freshness status|calendar_age_days/i, (entry) => {
    const freshness = entry.derived.forecast_grid_v1.coverage.index_diagnostics.freshness;
    freshness.status = "stale";
    freshness.calendar_age_days = 8;
  }],
  ["wrong row count", /constituent_rows/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.constituent_rows = 29;
  }],
  ["wrong source", /constituent source/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.source = "indices/custom-sox-members.json";
  }],
  ["wrong index id", /index_id/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.index_id = "SOXX";
  }],
  ["wrong source tier", /source_tier/i, (entry) => {
    entry.derived.forecast_grid_v1.coverage.index_diagnostics.source_tier = "derived_formula";
  }],
  ["fair-value promotion field", /fair-value output field/i, (entry) => {
    entry.derived.forecast_grid_v1.fair_value = 1;
  }],
];
for (const [label, expectedBlocker, mutateEntry] of soxMethodologyMutations) {
  const negativeRoot = makeSyntheticRoot({
    mutateInputs: (inputs) => mutateEntry(inputs.indices.SOX),
  });
  const negativeArtifact = buildFiveIndexCanonical(negativeRoot, { generatedAt: FIXED_GENERATED_AT });
  assert.equal(statusOf(negativeArtifact, "SOX"), "NULL", `${label} must emit NULL`);
  assert.match(blockersOf(negativeArtifact, "SOX", "direct_input").join(" "), expectedBlocker,
    `${label} must name the failed SOX methodology gate`);
}
ok("SOX methodology negatives reject cap, disclosure, coverage, SOXX/SOXQ/ETF/proxy, freshness, rows, source, index, tier, and promotion");

const nonSoxMethodologyRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    inputs.indices.SPX.derived.forecast_grid_v1.public_status = "input_only_spx_methodology_weights_no_fair_value";
  },
});
const nonSoxMethodologyArtifact = buildFiveIndexCanonical(nonSoxMethodologyRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(nonSoxMethodologyArtifact, "SPX"), "NULL",
  "methodology-marked SPX must not inherit the SOX exception");
assert.match(blockersOf(nonSoxMethodologyArtifact, "SPX", "direct_input").join(" "), /SOX-only/i,
  "non-SOX methodology rejection must name the SOX-only scope");
ok("methodology-marked grids remain prohibited for every non-SOX index");

// ---- 15. KOSPI payout zero or unverified emits NULL, not value-plus-warning ----
const unverifiedRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    inputs.indices.KOSPI.derived.payout_ratio = { value: 0.3, source_tier: "house_assumption", reason: "unverified payout" };
  },
});
const unverifiedArtifact = buildFiveIndexCanonical(unverifiedRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(unverifiedArtifact, "KOSPI"), "NULL", "an unverified KOSPI payout must emit NULL");
assert.equal(rowsOf(unverifiedArtifact).get("KOSPI").fair_value, null,
  "KOSPI must never emit a value-plus-warning");
assert.match(blockersOf(unverifiedArtifact, "KOSPI", "direct_input").join(" "), /payout/i,
  "the KOSPI NULL must name the payout blocker");
ok("KOSPI payout == 0 (committed inputs) and unverified (synthetic) both emit NULL with a payout blocker");

// ---- 14. missing or invalid price freshness metadata fails closed ----
const freshnessMutations = [
  ["missing freshness object", (inputs) => { delete inputs.indices.SPX.observed.price.freshness; }],
  ["missing freshness status", (inputs) => { delete inputs.indices.SPX.observed.price.freshness.status; }],
  ["invalid freshness age", (inputs) => { inputs.indices.SPX.observed.price.freshness.calendar_age_days = "9"; }],
  ["missing future anomaly flag", (inputs) => { delete inputs.indices.SPX.observed.price.freshness.future_date_anomaly; }],
  ["invalid price availability", (inputs) => { inputs.indices.SPX.observed.price.as_of = "not-a-date"; }],
];
for (const [label, mutateInputs] of freshnessMutations) {
  const freshnessRoot = makeSyntheticRoot({ mutateInputs });
  const freshnessArtifact = buildFiveIndexCanonical(freshnessRoot, { generatedAt: FIXED_GENERATED_AT });
  assert.equal(statusOf(freshnessArtifact, "SPX"), "NULL", `${label} must emit NULL`);
  assert.ok(blockersOf(freshnessArtifact, "SPX", "freshness").length > 0,
    `${label} must carry freshness blockers`);
}
ok("missing and invalid price freshness or price availability metadata fail closed");

// ---- 15. every required economic availability clock is PIT-checked ----
const availabilityMutations = [
  ["payout", (inputs) => {
    delete inputs.indices.SPX.derived.payout_ratio.coverage.stock_action_source_date;
    delete inputs.indices.SPX.derived.payout_ratio.coverage.benchmark_as_of;
  }],
  ["forecast", (inputs) => {
    delete inputs.indices.SPX.derived.forecast_grid_v1.coverage.stock_action_source_date;
    delete inputs.indices.SPX.derived.payout_ratio.coverage.stock_action_source_date;
    delete inputs.indices.SPX.derived.payout_ratio.coverage.benchmark_as_of;
    delete inputs.indices.SPX.observed.forward_eps.as_of;
  }],
  ["risk-free rate", (inputs) => { delete inputs.indices.SPX.observed.risk_free_rate.as_of; }],
  ["equity risk premium", (inputs) => { inputs.indices.SPX.observed.equity_risk_premium.as_of = "invalid"; }],
  ["book value", (inputs) => { delete inputs.indices.SPX.observed.price_to_book.as_of; }],
];
for (const [label, mutateInputs] of availabilityMutations) {
  const availabilityRoot = makeSyntheticRoot({ mutateInputs });
  const availabilityArtifact = buildFiveIndexCanonical(availabilityRoot, { generatedAt: FIXED_GENERATED_AT });
  assert.equal(statusOf(availabilityArtifact, "SPX"), "NULL", `${label} availability must emit NULL`);
  assert.match(
    blockersOf(availabilityArtifact, "SPX", "freshness").join(" "),
    new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    `${label} availability must be named in freshness blockers`,
  );
}
ok("missing and invalid payout, forecast, book-value, Rf, and ERP availability clocks fail closed");

// ---- 16. generated_at_date never satisfies an economic PIT clock ----
const generatedOnlyRoot = makeSyntheticRoot({
  mutateInputs: (inputs) => {
    const entry = inputs.indices.SPX;
    delete entry.derived.payout_ratio.coverage.stock_action_source_date;
    delete entry.derived.payout_ratio.coverage.benchmark_as_of;
    delete entry.derived.forecast_grid_v1.coverage.stock_action_source_date;
    delete entry.observed.forward_eps.as_of;
  },
});
const generatedOnlyArtifact = buildFiveIndexCanonical(generatedOnlyRoot, { generatedAt: FIXED_GENERATED_AT });
const generatedOnlyRow = rowsOf(generatedOnlyArtifact).get("SPX");
assert.equal(generatedOnlyRow.status, "NULL", "processing timestamps alone must not make SPX PIT-ready");
assert.equal(generatedOnlyRow.source_clock.payout_availability, null,
  "generated_at_date must not become payout availability");
assert.equal(generatedOnlyRow.source_clock.forecast_availability, null,
  "generated_at_date must not become forecast availability");
assert.ok(!blockersOf(generatedOnlyArtifact, "SPX", "freshness").some((blocker) => blocker.includes("2026-08-09")),
  "processing timestamp 2026-08-09 must not be reported as economic availability");
ok("generated_at_date is excluded from the economic date whitelist and cannot satisfy PIT");

// ---- 17. missing macro growth has no hidden fallback ----
const missingMacroRoot = makeSyntheticRoot({
  mutateCriteria: (payload) => { delete payload.stable_growth.g_macro_value; },
});
const missingMacroArtifact = buildFiveIndexCanonical(missingMacroRoot, { generatedAt: FIXED_GENERATED_AT });
for (const asset of ["SPX", "NDX", "SOX"]) {
  assert.equal(statusOf(missingMacroArtifact, asset), "NULL", `${asset} must be NULL without g_macro`);
  assert.match(blockersOf(missingMacroArtifact, asset, "direct_input").join(" "), /g_macro|macro growth/i,
    `${asset} must name the missing macro growth blocker`);
  assert.equal(rowsOf(missingMacroArtifact).get(asset).g, null, `${asset} must not synthesize a g value`);
}
ok("missing g_macro yields explicit NULL blockers without a numeric fallback");

// ---- 18. gate limits are criteria-driven and fail closed when absent ----
const missingGateRoot = makeSyntheticRoot({
  mutateCriteria: (payload) => { delete payload.grid.erp_half_width_pp; },
});
const missingGateArtifact = buildFiveIndexCanonical(missingGateRoot, { generatedAt: FIXED_GENERATED_AT });
assert.equal(statusOf(missingGateArtifact, "SPX"), "NULL", "missing grid policy must emit NULL");
assert.match(blockersOf(missingGateArtifact, "SPX", "direct_input").join(" "), /criteria grid\/gate limits/i,
  "missing grid policy must carry an explicit blocker");
ok("missing gate/grid policy does not receive a hidden hard-coded default");

const failingGateRoot = makeSyntheticRoot({
  mutateCriteria: (payload) => { payload.hard_gates.G1_pole_margin.limit = 1; },
});
const failingGateArtifact = buildFiveIndexCanonical(failingGateRoot, { generatedAt: FIXED_GENERATED_AT });
const failingGateRow = rowsOf(failingGateArtifact).get("SPX");
assert.equal(failingGateRow.status, "NULL", "a failed pole gate must emit NULL");
assert.equal(failingGateRow.gates.pole_margin, false, "the failed pole gate must be recorded");
assert.match(blockersOf(failingGateArtifact, "SPX", "direct_input").join(" "), /gate failures.*pole_margin/i,
  "a failed pole gate must carry an explicit blocker");
ok("hard gate failures are evaluated from canonical-grid diagnostics and emit explicit NULL blockers");

// ---- 19. static isolation: imports, banned legacy paths, engine parity ----
const builderSrc = fs
  .readFileSync(path.join(__dirname, "build-rim-index-five-canonical.mjs"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
assert.ok(builderSrc.includes(OUT_REL), "the builder must pin the contract output path");
const importSpecifiers = [...builderSrc.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
for (const specifier of importSpecifiers) {
  assert.ok(
    specifier.startsWith("node:")
      || specifier === "./build-rim-index-final.mjs"
      || specifier === "./build-rim-index.mjs",
    `unexpected import ${specifier} — only node builtins and the index-agnostic canonical engine are allowed`,
  );
}
for (const banned of [
  FLOOR_EVIDENCE_REL,
  OLD_CRITERIA_REL,
  "yf/finance/SOXX.json",
  "build-fenok-rim-owner-ordered-current",
  "OWNER_ORDERED",
  "owner-ordered",
  "fenok-rim-calibration",
  "yoo-replica",
  "fenok-rim-yoo",
  "YooLogic",
  "FENO_RIM_YOO",
  "build-rim-index-e5",
  "feno-index-rim-terminal-criteria",
  "FENO_RIM_TERMINAL_ADJUDICATION",
]) {
  assert.ok(!builderSrc.includes(banned), `the builder must never reference ${banned}`);
}
assert.ok(!/12m|twelve/i.test(builderSrc), "the builder must never reference a horizon conversion");
assert.ok(!/\?\?\s*0\.0404/.test(builderSrc), "the builder must not carry a hidden g_macro fallback");
ok("builder source pins the output path, imports only node builtins + the canonical engine, and never references floor/legacy/alternate-terminal paths");

for (const dir of createdDirs) {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} checks passed`);
