#!/usr/bin/env node
// Deterministic tests for the canonical FENO Index RIM (feno-index-rim-canonical-criteria.json,
// frozen at 79717ab76f). No network.
//
// The point of these tests is the failure that made this phase necessary: two committed
// implementations of the same product number, differing by ~48% on SPX, because the economics were
// hand-written in two places. Test 1 is therefore the important one — it asserts that the runtime
// takes its economics from the canonical file rather than restating them.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalValue, canonicalGrid, CANONICAL, computeAll } from "./build-rim-index-final.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const OUT = path.join(repoRoot, "data", "computed", "rim-index");

let passed = 0;
const ok = (name) => { passed += 1; console.log(`PASS ${name}`); };

// ---- 1. no hand-restated economics: the script's source names no economic literal ----
const src = fs.readFileSync(path.join(__dirname, "build-rim-index-final.mjs"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");
for (const literal of ["0.0404", "0.0469", "0.0503", "0.2198", "0.3081", "0.0304", "0.90", "0.0300"]) {
  assert.ok(
    !src.includes(literal),
    `build-rim-index-final.mjs restates the economic literal ${literal}; it must read it from the canonical criteria`,
  );
}
ok("runtime restates no economic literal — every parameter is read from the canonical criteria");

// ---- 2. the canonical file is the one that was frozen ----
const criteriaPath = path.join(OUT, "feno-index-rim-canonical-criteria.json");
const receipt = JSON.parse(fs.readFileSync(path.join(OUT, "feno-index-rim-canonical-freeze-receipt.json"), "utf8"));
const { createHash } = await import("node:crypto");
const digest = createHash("sha256").update(fs.readFileSync(criteriaPath)).digest("hex");
assert.equal(digest, receipt.criteria_sha256, "canonical criteria hash does not match its freeze receipt");
ok(`canonical criteria hash matches the freeze receipt (${digest.slice(0, 12)})`);

// ---- 3. the frozen growth rule reproduces from its primary source ----
const sg = CANONICAL.stable_growth;
const gMacro = (1 + sg.primary_source.real_gdp_longer_run_median) * (1 + sg.primary_source.pce_inflation_longer_run_median) - 1;
assert.ok(Math.abs(gMacro - sg.g_macro_value) < 1e-12, `g_macro ${gMacro} != frozen ${sg.g_macro_value}`);
assert.equal(sg.g_base_value, Math.min(sg.g_macro_value, sg.rf_at_freeze.value), "g_base != min(g_macro, Rf)");
const G6 = CANONICAL.hard_gates.G6_terminal_sensitivity;
assert.ok(Math.abs(G6.g_low - Math.max(0, sg.g_base_value - 0.01)) < 1e-12, "g_low != max(0, g_base - 100bp)");
assert.ok(Math.abs(G6.g_high - Math.min(sg.rf_at_freeze.value, sg.g_base_value + 0.01)) < 1e-12, "g_high != min(Rf, g_base + 100bp)");
ok(`g_macro ${(gMacro * 100).toFixed(2)}% from the SEP longer-run medians; g_base ${(sg.g_base_value * 100).toFixed(2)}%; shadows ${(G6.g_low * 100).toFixed(2)}% / ${(G6.g_high * 100).toFixed(2)}%`);

// ---- 4. engine identity: value equals its own parts ----
const probe = canonicalValue({
  b0: 1000, epsPath: [100, 110, 120], payout: 0.20, ke: 0.10, ltroe: 0.15, g: 0.04,
});
assert.ok(Math.abs(probe.value - (probe.book.b0 + probe.explicit_pv + probe.terminal_pv)) < 1e-9, "V0 != B0 + explicit PV + terminal PV");
assert.ok(Math.abs(probe.cv3 - probe.ri.ri4 / (0.10 - 0.04)) < 1e-9, "CV3 != RI4 / (ke - g)");
assert.ok(Math.abs(probe.ri.ri4 - (0.15 - 0.10) * probe.book.b3) < 1e-9, "RI4 != (LTROE - ke) * B3");
assert.ok(Math.abs(probe.stable_retention - 0.04 / 0.15) < 1e-12, "stable retention != g / LTROE");
assert.ok(Math.abs(probe.terminal_share - probe.terminal_pv / probe.value) < 1e-12, "terminal share mismatch");
ok("engine identities hold: V0 decomposition, CV3 = RI4/(ke-g), RI4 = (LTROE-ke)*B3, retention = g/LTROE");

// ---- 5. the pole is refused, not silently divided through ----
const pole = canonicalValue({ b0: 1000, epsPath: [100, 110, 120], payout: 0.2, ke: 0.03, ltroe: 0.15, g: 0.04 });
assert.equal(pole.value, null, "ke <= g must not produce a value");
assert.equal(pole.blocker, "pole_ke_not_above_g");
ok("ke <= g is refused with an explicit blocker rather than a negative or infinite value");

// ---- 6. lowering g must lower value; the terminal is monotone in g ----
const lower = canonicalValue({ b0: 1000, epsPath: [100, 110, 120], payout: 0.2, ke: 0.10, ltroe: 0.15, g: 0.03 });
assert.ok(lower.value < probe.value, "a lower g must not raise the value");
ok("value is monotone increasing in g, as a stable-growth residual-income terminal requires");

// ---- 7. grid orientation: BEAR/BASE/BULL map to the frozen cells ----
const grid = canonicalGrid({
  b0: 1000, epsPath: [100, 110, 120], payout: 0.2, rf: 0.04,
  erp: { low: 0.045, base: 0.05, high: 0.055 },
  ltroeGrid: { low: 0.145, base: 0.15, high: 0.155 }, g: 0.03,
});
assert.equal(grid.BEAR, grid.cells.high_low.value, "BEAR must be erp high, ltroe low");
assert.equal(grid.BASE, grid.cells.base_base.value, "BASE must be erp base, ltroe base");
assert.equal(grid.BULL, grid.cells.low_high.value, "BULL must be erp low, ltroe high");
assert.ok(grid.BULL >= grid.BASE && grid.BASE >= grid.BEAR, "BULL >= BASE >= BEAR must hold");
assert.ok(grid.monotonicity_passed, "reference grid must pass monotonicity");
ok("grid orientation and ordering match the frozen scenario mapping");

// ---- 8. gate evaluation uses the recorded thresholds, on the live numbers ----
const r = computeAll();
assert.deepEqual(r.source_clock_failures, [], `source clock failures: ${JSON.stringify(r.source_clock_failures)}`);
const G = CANONICAL.hard_gates;
for (const idx of ["SPX", "NDX"]) {
  const x = r.indices[idx];
  const g = r.gates[idx];
  assert.equal(g.G1_pole_margin, x.grid.min_pole_margin >= G.G1_pole_margin.threshold);
  assert.equal(g.G2_terminal_share, x.grid.base_terminal_share <= G.G2_terminal_share.threshold);
  assert.equal(g.G6_terminal_sensitivity, x.sensitivity.max_abs_rel_move <= G.G6_terminal_sensitivity.threshold);
  assert.ok(x.grid.all_finite, `${idx} has a non-finite cell`);
}
ok("gate evaluation reproduces from the thresholds recorded in the canonical criteria");

// ---- 9. handler-independent parity, recomputed here rather than trusted ----
// A second, deliberately naive implementation of the same equations. If the engine ever drifts,
// this disagrees.
function naive(b0, eps, payout, ke, ltroe, g) {
  const ret = 1 - payout;
  const b1 = b0 + eps[0] * ret;
  const b2 = b1 + eps[1] * ret;
  const b3 = b2 + eps[2] * ret;
  const pv = (eps[0] - ke * b0) / (1 + ke)
    + (eps[1] - ke * b1) / (1 + ke) ** 2
    + (eps[2] - ke * b2) / (1 + ke) ** 3;
  return b0 + pv + ((ltroe - ke) * b3) / (ke - g) / (1 + ke) ** 3;
}
for (const idx of ["SPX", "NDX"]) {
  const x = r.indices[idx];
  const o = x.operands;
  const ke = CANONICAL.stable_growth.rf_at_freeze.value + CANONICAL.grids.erp.base;
  const expect = naive(o.b0, o.epsPath, o.payoutA, ke, CANONICAL.grids.ltroe[idx].base, CANONICAL.stable_growth.g_base_value);
  const rel = Math.abs(expect - x.grid.BASE) / Math.abs(expect);
  assert.ok(rel < 1e-12, `${idx} Base parity ${rel} — engine ${x.grid.BASE} vs naive ${expect}`);
  ok(`${idx} Base ${x.grid.BASE.toFixed(4)} reproduces independently (rel ${rel.toExponential(1)})`);
}

// ---- 10. the historical record is not rewritten ----
const e6 = JSON.parse(fs.readFileSync(path.join(OUT, "FENO_RIM_E6_FINAL_DECISION.json"), "utf8"));
assert.equal(e6.verdict, "FENO_INDEX_RIM_RESEARCH_ONLY", "the E6 historical-validation verdict must remain unchanged");
assert.equal(CANONICAL.historical_record_is_not_rewritten.e6_verdict, e6.verdict);
ok("E6 RESEARCH_ONLY remains the historical-validation verdict, unrewritten");

console.log(`\n${passed} checks passed`);
