#!/usr/bin/env node
// Deterministic tests for E2/E3 (feno_index_rim_v1 criteria 2f660ac003).
// Pure-function checks on the canonical grid + frozen criteria numbers; no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  deriveNormalizedLongTermRoe,
  computeTopDownRimValue,
  buildRimScenarioGrid,
  computeReverseImpliedLtroe,
  computeReverseImpliedErp,
  measurePayoutRouteValuationImpact,
  buildQqqEquivalent,
} from "./build-rim-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const OUT = path.join(dataRoot, "computed", "rim-index");
const CRITERIA = JSON.parse(fs.readFileSync(path.join(OUT, "feno-index-rim-v1-criteria.json"), "utf8"));
const bench = JSON.parse(fs.readFileSync(path.join(dataRoot, "benchmarks/us.json"), "utf8")).sections;

let passed = 0;
const ok = (name) => { passed += 1; console.log(`PASS ${name}`); };

// ---- 1. LTROE recompute matches the frozen criteria bases ----
for (const [idx, section, frozen] of [["SPX", "sp500", 0.21980], ["NDX", "nasdaq100", 0.30810]]) {
  const cutoff = CRITERIA.ltroe_grid.window.split(" .. ")[1];
  const r = deriveNormalizedLongTermRoe(bench[section].data, cutoff, 10);
  assert.ok(Math.abs(r.base - frozen) < 1e-9, `${idx} LTROE base ${r.base} != frozen ${frozen}`);
  assert.equal(r.n_observations, CRITERIA.ltroe_grid[idx].n_observations, `${idx} n`);
  ok(`LTROE ${idx} = ${r.base.toFixed(5)} (frozen ${frozen}, n=${r.n_observations})`);
}

// ---- 2. canonical value formula: manual cross-check ----
const v = computeTopDownRimValue({
  bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207015, costOfEquity: 0.0966, ltroe: 0.2198,
});
assert.ok(Number.isFinite(v.value));
// manual: B roll + RI + CV3
const ret = 1 - 0.207015;
let B0 = 1315.9252, B1 = B0 + 383.3257 * ret, B2 = B1 + 452.9469 * ret, B3 = B2 + 537.4319 * ret;
const ke = 0.0966;
const ri1 = 383.3257 - ke * B0, ri2 = 452.9469 - ke * B1, ri3 = 537.4319 - ke * B2;
const cv3 = (0.2198 - ke) * B3 / ke;
const manual = B0 + ri1 / (1 + ke) + ri2 / (1 + ke) ** 2 + ri3 / (1 + ke) ** 3 + cv3 / (1 + ke) ** 3;
assert.ok(Math.abs(v.value - manual) < 0.01, `formula dev ${Math.abs(v.value - manual)}`);
ok(`canonical V0 = ${v.value.toFixed(2)} (manual ${manual.toFixed(2)})`);

// ---- 3. monotonicity hard gate ----
const grid = buildRimScenarioGrid({
  bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207015, riskFreeRate: 0.0463, erpBase: 0.0503, ltroeBase: 0.2198,
});
assert.equal(grid.monotonicity_passed, true);
assert.ok(grid.BULL >= grid.BASE && grid.BASE >= grid.BEAR);
ok(`grid monotonic (bear ${grid.BEAR.toFixed(1)} <= base ${grid.BASE.toFixed(1)} <= bull ${grid.BULL.toFixed(1)})`);

// ---- 4. reverse-implied: solved value reproduces the price ----
const ri = computeReverseImpliedLtroe({
  price: 7489.72, bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207015, costOfEquity: 0.0463 + 0.0503,
});
assert.equal(ri.solved, true);
const repriced = computeTopDownRimValue({
  bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207015, costOfEquity: 0.0463 + 0.0503, ltroe: ri.value,
}).value;
assert.ok(Math.abs(repriced - 7489.72) < 0.05, `implied LTROE reprices to ${repriced}`);
ok(`reverse implied LTROE = ${ri.value.toFixed(5)} -> V0 ${repriced.toFixed(1)}`);

const re = computeReverseImpliedErp({
  price: 7489.72, bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207015, riskFreeRate: 0.0463, ltroe: 0.2198,
});
assert.equal(re.solved, true);
const repriced2 = computeTopDownRimValue({
  bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207015, costOfEquity: 0.0463 + re.value, ltroe: 0.2198,
}).value;
assert.ok(Math.abs(repriced2 - 7489.72) < 0.05, `implied ERP reprices to ${repriced2}`);
ok(`reverse implied ERP = ${re.value.toFixed(5)} -> V0 ${repriced2.toFixed(1)}`);

// ---- 5. payout route materiality ----
const gridB = buildRimScenarioGrid({
  bookValueBeginning: 1315.9252, epsPath: [383.3257, 452.9469, 537.4319],
  payoutRatio: 0.207111, riskFreeRate: 0.0463, erpBase: 0.0503, ltroeBase: 0.2198,
});
const impact = measurePayoutRouteValuationImpact({ gridA: grid, gridB });
assert.ok(impact.base_cell_shift <= 0.05);
assert.ok(impact.grid_mean_shift <= 0.05);
assert.ok(impact.payout_routes_materially_reconciled);
ok(`payout impact base shift ${(impact.base_cell_shift * 100).toFixed(3)}% reconciled`);

// ---- 6. QQQ equivalent ----
const qqq = buildQqqEquivalent({ currentQqq: 721.7, currentNdx: 28274.2, ndxScenarios: grid });
assert.ok(Math.abs(qqq.base - 721.7 * (grid.BASE / 28274.2)) < 1e-9);
ok(`QQQ equivalent base = ${qqq.base.toFixed(2)} (scale ${qqq.scale.toFixed(6)})`);

console.log(`\n${passed} tests passed`);
