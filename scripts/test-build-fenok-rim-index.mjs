import assert from "node:assert/strict";
import {
  checkCalibration,
  computeCase,
  computeCell,
  RIM_CALIBRATION_ANCHORS,
  RIM_EXPLICIT_YEARS,
  RIM_GRID_STEP,
  RIM_KR_RISK_FREE_ANCHOR,
  RIM_LT_HAIRCUT,
  RIM_RATE_SCENARIO_10Y,
} from "./build-fenok-rim-index.mjs";

// Hand-computed cell: B0 = 1000, path [0.2, 0.2, 0.2], retention 0.5,
// rf 0.04 + ERP 0.06 -> r = 0.10.
//   RI PVs: 100/1.1 + 110/1.21 + 121/1.331 = 272.73
//   terminal book = 1331, LT ROE 0.15 -> (0.05*1331)/0.10 = 665.5, PV 500
//   V = 1000 + 272.73 + 500 = 1772.73
{
  const v = computeCell({
    bookValue: 1000, roePath: [0.2, 0.2, 0.2], retention: 0.5,
    riskFree: 0.04, erp: 0.06, ltRoe: 0.15,
  });
  assert.equal(Math.round(v * 100) / 100, 1772.73);
}

// A per-year fading path lowers the value versus a constant path.
{
  const constant = computeCell({ bookValue: 1000, roePath: [0.2, 0.2, 0.2], retention: 0.5, riskFree: 0.04, erp: 0.06, ltRoe: 0.15 });
  const fading = computeCell({ bookValue: 1000, roePath: [0.2, 0.18, 0.15], retention: 0.5, riskFree: 0.04, erp: 0.06, ltRoe: 0.15 });
  assert.ok(fading < constant);
}

// Case: 3x3 grid mean sits strictly between min and max; LT center is the
// path average times the haircut; higher haircut (Likely) beats Worst; the
// 3.5% rate scenario raises value whenever rates are above 3.5%.
{
  const base = { px: 1500, bookValue: 1000, roePath: [0.3, 0.25, 0.2], retention: 0.8, erpCenter: 0.05 };
  const likely = computeCase({ ...base, riskFree: 0.0468, haircut: RIM_LT_HAIRCUT.likely });
  const worst = computeCase({ ...base, riskFree: 0.0468, haircut: RIM_LT_HAIRCUT.worst });
  const scenario = computeCase({ ...base, riskFree: RIM_RATE_SCENARIO_10Y, haircut: RIM_LT_HAIRCUT.likely });
  assert.equal(likely.lt_roe_center, Math.round(0.25 * RIM_LT_HAIRCUT.likely * 10000) / 10000);
  assert.ok(likely.fair_value > worst.fair_value);
  assert.ok(scenario.fair_value > likely.fair_value, "a lower 10Y raises fair value");
  assert.ok(likely.upside_min_pct < likely.upside_pct && likely.upside_pct < likely.upside_max_pct);
}

// ROE below r produces a value below book — negative spreads reduce, never inflate.
{
  const v = computeCell({ bookValue: 1000, roePath: [0.05, 0.05, 0.05], retention: 0.5, riskFree: 0.05, erp: 0.05, ltRoe: 0.05 });
  assert.ok(v < 1000);
}

// Calibration verdicts: tolerance windows and the KOSPI fair-range path.
{
  const mk = (key, upside, fair) => ({
    key, status: "ready",
    likely: { rate_current: { upside_pct: upside, fair_value: fair } },
  });
  const results = checkCalibration([
    mk("sp500", 9, 8000),
    mk("nasdaq100", 5, 30000),
    mk("kospi", 60, 10500),
  ]);
  assert.equal(results.find((r) => r.key === "sp500").status, "within_tolerance");
  assert.equal(results.find((r) => r.key === "nasdaq100").status, "diverged");
  assert.equal(results.find((r) => r.key === "kospi").status, "within_tolerance");
  assert.ok(checkCalibration([]).every((r) => r.status === "unavailable"));
}

// Contract pins: the self-computing constants stay declared and justified.
assert.equal(RIM_EXPLICIT_YEARS, 3);
assert.equal(RIM_GRID_STEP, 0.005, "0.5%p grid spacing read off every sheet");
assert.equal(RIM_RATE_SCENARIO_10Y, 0.035);
assert.equal(RIM_KR_RISK_FREE_ANCHOR.value, 0.044, "KR 10Y anchor until an automated lane exists");
assert.deepEqual(RIM_LT_HAIRCUT, { likely: 0.93, worst: 0.85 });
assert.ok(RIM_CALIBRATION_ANCHORS.length >= 3);

console.log("build-fenok-rim-index tests passed");
