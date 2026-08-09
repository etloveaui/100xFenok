#!/usr/bin/env node

// Deterministic tests for the owner-ordered current FENO RIM research line.
// No network. Every number is derived at runtime: raw centers are imported
// from the calibration functions, floors are parsed from the evidence
// fixture, and the SOXX spot is read at full precision from the yf snapshot.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildOwnerOrderedCurrent,
  validateOwnerOrderedSelection,
  OWNER_ORDER,
  MIN_ADJACENT_GAP,
} from "./build-fenok-rim-owner-ordered-current.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "data/computed/rim-index/FENO_RIM_OWNER_ORDERED_CURRENT.json");

let passed = 0;
const ok = (name) => {
  passed += 1;
  console.log(`PASS ${name}`);
};

const FIXED_GENERATED_AT = "2026-08-09T00:00:00.000Z";
const artifact = buildOwnerOrderedCurrent(undefined, { generatedAt: FIXED_GENERATED_AT });
const rows = new Map(artifact.rows.map((row) => [row.asset, row]));

assert.deepEqual(
  buildOwnerOrderedCurrent(undefined, { generatedAt: FIXED_GENERATED_AT }),
  artifact,
  "the artifact must be deterministic for a fixed generated-at",
);

// ---- 1. exact evidence ids, labels and dates per row ----
const expectedEvidence = {
  SPX: { id: "rim-ccea4d31accf70a35d5a095e", date: "2026-07-26", asset: "SP500", metric: "RIM 12m 상승여력(%)" },
  CCMP: { id: "rim-694e999c6f76b4d205ede3c2", date: "2026-07-12", asset: "NASDAQ", metric: "RIM 6~12m 상승여력(%, 최소)" },
  NDX: { id: "rim-00269321d964013833efea9f", date: "2026-07-12", asset: "NASDAQ100", metric: "RIM 6~12m 상승여력(%, 최소)" },
  SOXX: { id: "rim-1d69c85650aa0c41e37616c7", date: "2026-06-28", asset: "SOXX", metric: "RIM 6~12m 상승여력(%)" },
  KOSPI: { id: "rim-7041d3d1604bd6d9b5683c04", date: "2026-06-14", asset: "KOSPI", metric: "RIM 12m 상승여력(%)" },
};
for (const [asset, expected] of Object.entries(expectedEvidence)) {
  const evidence = rows.get(asset).floor_evidence;
  assert.equal(evidence.evidence_id, expected.id, `${asset} evidence_id`);
  assert.equal(evidence.date, expected.date, `${asset} date`);
  assert.equal(evidence.asset, expected.asset, `${asset} fixture asset label`);
  assert.equal(evidence.metric, expected.metric, `${asset} metric label`);
}
ok("five rows carry the exact evidence ids, dates and labels");

// ---- 2. published floors are parsed from the fixture, not restated ----
const fixture = JSON.parse(
  fs.readFileSync(path.join(ROOT, "scripts/fixtures/fenok-rim-calibration-evidence.json"), "utf8"),
);
const claims = new Map(fixture.claims.map((claim) => [claim.evidence_id, claim]));
for (const asset of OWNER_ORDER) {
  const row = rows.get(asset);
  const claim = claims.get(row.floor_evidence.evidence_id);
  assert.equal(claim.raw_value, row.floor_evidence.raw_value, `${asset} raw_value must travel from the fixture`);
  assert.equal(row.floor, row.floor, `${asset} floor finite`);
}
assert.equal(rows.get("SPX").floor, 0.19, "SPX floor must be the lower edge 19% of 19~29");
assert.equal(rows.get("CCMP").floor, 0.24, "CCMP floor must be 24% minimum");
assert.equal(rows.get("NDX").floor, 0.36, "NDX floor must be 36% minimum");
assert.equal(rows.get("SOXX").floor, 0.63, "SOXX floor must be 63%");
assert.equal(rows.get("KOSPI").floor, 0.495, "KOSPI floor must be the published 49.5%, not a derived 65%");
ok("floors parse from the fixture: SPX 19 (lower edge), CCMP 24, NDX 36, SOXX 63, KOSPI 49.5");

// ---- 3. raw centers are the derived model centers, not hand-written ----
assert.ok(Math.abs(rows.get("NDX").raw_center - 0.4380349918153845) < 1e-12, "NDX raw center mismatch");
assert.ok(Math.abs(rows.get("KOSPI").raw_center - 0.8391200821334757) < 1e-12, "KOSPI raw center mismatch");
for (const asset of ["SPX", "CCMP", "SOXX"]) {
  assert.ok(rows.get(asset).raw_center < rows.get(asset).floor, `${asset} raw center must sit below its floor`);
}
assert.ok(
  rows.get("SOXX").raw_center_instrument.includes("SOX"),
  "SOXX raw center must be explicitly marked as SOX-index based",
);
assert.equal(rows.get("SOXX").raw_center_source, "buildCurrentYooLogicSharedInferredRanges");
assert.equal(rows.get("CCMP").raw_center_source, "buildCurrentExtendedYooLogicProxyRanges");
ok("raw centers derive from the two calibration functions; SOXX center is marked SOX-based");

// ---- 4. selected = max(raw_center, floor) with the expected values ----
const expectedSelected = {
  SPX: 0.19,
  CCMP: 0.24,
  NDX: 0.4380349918153845,
  SOXX: 0.63,
  KOSPI: 0.8391200821334757,
};
for (const [asset, value] of Object.entries(expectedSelected)) {
  assert.ok(Math.abs(rows.get(asset).selected - value) < 1e-12, `${asset} selected ${rows.get(asset).selected} != ${value}`);
  assert.equal(
    rows.get(asset).selected,
    Math.max(rows.get(asset).raw_center, rows.get(asset).floor),
    `${asset} selected must be max(raw_center, floor)`,
  );
}
ok("selected matches expected values and the max(raw_center, floor) rule");

// ---- 5. SOXX spot at full precision from the yf snapshot ----
const soxx = JSON.parse(fs.readFileSync(path.join(ROOT, "data/yf/finance/SOXX.json"), "utf8"));
assert.equal(soxx.data.fast_info.lastPrice, 543.27001953125, "yf snapshot lastPrice must be the full-precision value");
assert.equal(rows.get("SOXX").spot, 543.27001953125, "SOXX spot must carry full precision");
assert.equal(rows.get("SOXX").as_of, "2026-08-07", "SOXX source_as_of must be 2026-08-07");
ok("SOXX spot reads 543.27001953125 at full precision, as_of 2026-08-07");

// ---- 6. fair-value arithmetic: fair_value = spot * (1 + selected) ----
for (const row of artifact.rows) {
  const expected = row.spot * (1 + row.selected);
  assert.ok(
    Math.abs(row.fair_value - expected) < 1e-6,
    `${row.asset} fair value ${row.fair_value} != spot*(1+selected) ${expected}`,
  );
}
ok("fair values are recomputed as spot * (1 + selected)");

// ---- 7. positivity, uniqueness, strict order, adjacent gaps >= 2pp ----
const ordered = validateOwnerOrderedSelection(artifact.rows);
assert.deepEqual(ordered, OWNER_ORDER.map((asset) => rows.get(asset).selected));
for (let i = 0; i < ordered.length - 1; i += 1) {
  const gap = artifact.adjacent_gaps[i].gap;
  assert.ok(gap >= MIN_ADJACENT_GAP - 1e-12, `${OWNER_ORDER[i]} -> ${OWNER_ORDER[i + 1]} gap ${gap} < 2pp`);
}
assert.equal(artifact.adjacent_gaps.length, OWNER_ORDER.length - 1);
ok("selected is positive, unique, strictly ordered, with every adjacent gap >= 2pp");

// ---- 8. determination split: 3 floor-determined, 2 model-center, 0 order-adjusted ----
assert.deepEqual(artifact.determination_split.floor_determined_rows, ["SPX", "CCMP", "SOXX"]);
assert.deepEqual(artifact.determination_split.model_center_determined_rows, ["NDX", "KOSPI"]);
assert.equal(artifact.determination_split.floor_determined, 3);
assert.equal(artifact.determination_split.model_center_determined, 2);
assert.equal(artifact.determination_split.order_adjusted, 0);
for (const asset of ["SPX", "CCMP", "SOXX"]) assert.equal(rows.get(asset).determined_by, "published_floor");
for (const asset of ["NDX", "KOSPI"]) assert.equal(rows.get(asset).determined_by, "model_center");
ok("determination split is 3 floor-determined / 2 model-center-determined / 0 order-adjusted");

// ---- 9. classification and quarantine ----
assert.equal(artifact.classification, "OWNER_CONSTRAINED_ACTIONABLE_RESEARCH_LINE");
assert.equal(artifact.exact_yoo, false);
assert.equal(artifact.public_promotion, false);
assert.equal(artifact.yoo_status, "NOT_IDENTIFIED");
assert.equal(artifact.public_surface.status, "QUARANTINED");
ok("artifact is OWNER_CONSTRAINED_ACTIONABLE_RESEARCH_LINE, exact_yoo=false, public promotion=false, quarantined");

// ---- 10. CCMP proxy caveat and SOXX basis caveat are declared ----
assert.ok(
  rows.get("CCMP").caveats.some((caveat) => caveat.includes("FENO_MAPPING")),
  "CCMP must declare the NASDAQ fixture mapping as FENO_MAPPING, not independently explicit",
);
assert.ok(
  rows.get("SOXX").caveats.some((caveat) => caveat.includes("SOX")),
  "SOXX must declare its SOX-index raw-center basis",
);
ok("CCMP mapping and SOXX basis caveats are carried on the rows");

// ---- 11. the builder hardcodes none of the derived numbers ----
const builderSrc = fs
  .readFileSync(path.join(__dirname, "build-fenok-rim-owner-ordered-current.mjs"), "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("//"))
  .join("\n");
for (const literal of [
  "0.4380349918153845",
  "0.8391200821334757",
  "543.27001953125",
  "989.353694",
  "0.495",
  "0.19",
  "0.24",
  "0.36",
  "0.63",
]) {
  assert.ok(!builderSrc.includes(literal), `builder restates the derived literal ${literal}`);
}
ok("builder restates no derived raw center, spot, floor or fair value");

// ---- 12. QQQ equivalent: current * (1 + NDX selected) ----
const qqqFinal = JSON.parse(
  fs.readFileSync(path.join(ROOT, "data/computed/rim-index/FENO_RIM_FINAL_CURRENT_QQQ.json"), "utf8"),
);
const expectedQqq = qqqFinal.current * (1 + rows.get("NDX").selected);
assert.equal(artifact.qqq_equivalent.current, qqqFinal.current);
assert.ok(Math.abs(artifact.qqq_equivalent.fair_value - expectedQqq) < 1e-9, "QQQ equivalent arithmetic mismatch");
assert.ok(Math.abs(artifact.qqq_equivalent.fair_value - 989.353694) < 1e-3, "QQQ equivalent off the expected level");
ok(`QQQ equivalent ${artifact.qqq_equivalent.fair_value.toFixed(6)} reproduces (expected ~989.353694)`);

// ---- 13. CLI run writes the identical artifact the function returns ----
execFileSync(process.execPath, [path.join(__dirname, "build-fenok-rim-owner-ordered-current.mjs")], {
  cwd: ROOT,
  stdio: "pipe",
});
const onDisk = JSON.parse(fs.readFileSync(OUT, "utf8"));
assert.ok(Number.isFinite(Date.parse(onDisk.generated_at)), "the written artifact must carry a valid generated_at");
assert.deepEqual(
  { ...onDisk, generated_at: artifact.generated_at },
  artifact,
  "the written artifact must equal the in-process build apart from its generated_at",
);
ok("CLI writes data/computed/rim-index/FENO_RIM_OWNER_ORDERED_CURRENT.json identical to the build");

// ---- 14. validation rejects violations ----
const badOrder = artifact.rows.map((row) => ({ ...row }));
badOrder.find((row) => row.asset === "NDX").selected = 0.7; // above SOXX 0.63 -> order violated
assert.throws(() => validateOwnerOrderedSelection(badOrder), /strictly ordered/, "unordered rows must throw");
const duplicate = artifact.rows.map((row) => ({ ...row, selected: 0.3 }));
assert.throws(() => validateOwnerOrderedSelection(duplicate), /duplicate/, "duplicate selected values must throw");
const smallGap = artifact.rows.map((row) => ({ ...row }));
smallGap[1].selected = smallGap[0].selected + 0.005;
assert.throws(() => validateOwnerOrderedSelection(smallGap), /adjacent gap/, "sub-2pp adjacent gap must throw");
const nonPositive = artifact.rows.map((row) => ({ ...row, selected: -0.1 }));
assert.throws(() => validateOwnerOrderedSelection(nonPositive), /positive/, "non-positive selected must throw");
ok("validation throws on unordered, duplicate, sub-2pp and non-positive selections");

console.log(`\n${passed} checks passed`);
