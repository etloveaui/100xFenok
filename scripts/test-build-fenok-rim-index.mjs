import assert from "node:assert/strict";
import {
  checkCalibration,
  computeCase,
  computeCell,
  RIM_CALIBRATION_ANCHORS,
  RIM_EXPLICIT_YEARS,
  RIM_GRID_STEP,
  RIM_RATE_SCENARIO_10Y,
} from "./build-fenok-rim-index.mjs";

// PERMANENT REGRESSION: the engine must keep reproducing the captured
// 2025-12-09 source sheet outputs. If these drift, the formula changed.
// S&P 500: px 6,870 / PBR 4.35, flat ROE 26.1%, Ke = 4.2% + 4.5%,
// payout 31.09% -> sheet fair value 7,144 (tolerance 2%).
{
  const v = computeCell({
    bookValue: 6870 / 4.35, roePath: [0.261], retention: 1 - 0.3109,
    riskFree: 0.042, erp: 0.045,
  });
  assert.ok(Math.abs(v / 7144 - 1) < 0.02, `SPX reproduction drifted: ${v}`);
}
// Russell 2000 (IWM): px 251 / PBR 1.94, flat ROE 14.8%, Ke = 4.2% + 4.5%,
// payout 25% -> sheet fair value 260.4 (tolerance 2%).
{
  const v = computeCell({
    bookValue: 251 / 1.94, roePath: [0.148], retention: 0.75,
    riskFree: 0.042, erp: 0.045,
  });
  assert.ok(Math.abs(v / 260.4 - 1) < 0.02, `Russell reproduction drifted: ${v}`);
}

// Formula shape: terminal uses the FINAL year's residual (on B_{N-1}), so a
// hand-computable flat case matches the closed form V = B0 * ROE/Ke when
// retention -> 0 (book never grows, RI constant):
//   B0=1000, ROE 20%, Ke 10% -> V = 1000 + sum(100/1.1^t) + 100/(0.1*1.1^5)
//   = 1000 + 379.08 + 620.92 = 2000 = B0 * ROE/Ke.
{
  const v = computeCell({ bookValue: 1000, roePath: [0.2], retention: 0, riskFree: 0.04, erp: 0.06 });
  assert.equal(Math.round(v * 100) / 100, 2000);
}

// Retention grows book and value; ROE below Ke stays below book.
{
  const grown = computeCell({ bookValue: 1000, roePath: [0.2], retention: 0.5, riskFree: 0.04, erp: 0.06 });
  assert.ok(grown > 2000);
  const weak = computeCell({ bookValue: 1000, roePath: [0.05], retention: 0.5, riskFree: 0.04, erp: 0.06 });
  assert.ok(weak < 1000);
}

// Case grid: mean strictly between min and max; a lower 10Y raises value;
// the tail shift only moves years beyond the consensus path.
{
  const base = { px: 1500, bookValue: 1000, roePath: [0.3, 0.25, 0.2], retention: 0.8, erpCenter: 0.05 };
  const cur = computeCase({ ...base, riskFree: 0.0468 });
  const low = computeCase({ ...base, riskFree: RIM_RATE_SCENARIO_10Y });
  assert.ok(low.fair_value > cur.fair_value);
  assert.ok(cur.upside_min_pct < cur.upside_pct && cur.upside_pct < cur.upside_max_pct);
}

// Calibration verdicts on the single-case row shape.
{
  const mk = (key, upside, fair) => ({ key, status: "ready", rate_current: { upside_pct: upside, fair_value: fair } });
  const results = checkCalibration([mk("sp500", 9, 8000), mk("nasdaq100", 5, 30000), mk("kospi", 60, 10500)]);
  assert.equal(results.find((r) => r.key === "sp500").status, "within_tolerance");
  assert.equal(results.find((r) => r.key === "nasdaq100").status, "diverged");
  assert.equal(results.find((r) => r.key === "kospi").status, "within_tolerance");
  assert.ok(checkCalibration([]).every((r) => r.status === "unavailable"));
}

// Contract pins.
assert.equal(RIM_EXPLICIT_YEARS, 5, "owner spec: 3~5-year horizon; 5 reproduces the sheets");
assert.equal(RIM_GRID_STEP, 0.005);
assert.ok(RIM_CALIBRATION_ANCHORS.length >= 3);

console.log("build-fenok-rim-index tests passed");
