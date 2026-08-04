import assert from "node:assert/strict";
import fs from "node:fs";
import {
  checkCalibration,
  computeCase,
  computeCell,
  RIM_CALIBRATION_ANCHORS,
  RIM_EXPLICIT_YEARS,
  RIM_GRID_STEP,
  RIM_RATE_SCENARIO_10Y,
  RIM_KR_RISK_FREE_ANCHOR,
  discountRate,
  resolvePayout,
} from "./build-fenok-rim-index.mjs";

// PERMANENT REGRESSION: the engine must reproduce every captured 2025-12-09
// grid CELL, not one hand-picked value. Each sheet is a 3x3 of LT ROE x risk
// premium, printed twice — once at the observed 10Y (4.2%) and once at a 3.5%
// scenario — so three sheets give 54 independent targets. Book values come from
// our own benchmark feed on that date, never from a figure fitted to make the
// formula pass. Cross-checked on a separate slide: with these same parameters
// the 선진국/신흥국 master tables reproduce to -1.6%~-6.6% using our feed's PBR,
// while his displayed PBR column misses by +14%~+41% — his table PBR is a
// display figure, our feed's book is what the model consumes.
{
  const IWM = 2521.484 / 250.87;   // his Russell sheet is quoted on IWM
  const SHEETS = [
    {
      name: "S&P 500", bookValue: 6870.4 / 5.4873, retention: 1 - 0.3109,
      roes: [0.256, 0.261, 0.266], erps: [0.050, 0.045, 0.040],
      cells: {
        0.042: [[6723, 6887, 7051], [6978, 7144, 7311], [7239, 7408, 7578]],
        0.035: [[7253, 7427, 7600], [7527, 7703, 7880], [7807, 7986, 8166]],
      },
    },
    {
      name: "NASDAQ Composite", bookValue: 23578.13 / 7.7239, retention: 1 - 0.2180,
      roes: [0.302, 0.307, 0.312], erps: [0.055, 0.050, 0.045],
      cells: {
        0.042: [[26362, 26923, 27485], [27362, 27934, 28505], [28389, 28971, 29553]],
        0.035: [[28508, 29104, 29699], [29586, 30192, 30798], [30692, 31310, 31927]],
      },
    },
    {
      name: "Russell 2000", bookValue: (2521.484 / 2.2574) / IWM, retention: 1 - 0.045,
      roes: [0.143, 0.148, 0.153], erps: [0.050, 0.045, 0.040],
      cells: {
        0.042: [[234.3, 245.7, 257.2], [248.7, 260.4, 272.1], [263.7, 275.6, 287.5]],
        0.035: [[256.1, 268.2, 280.3], [271.7, 284.0, 296.3], [287.8, 300.4, 312.9]],
      },
    },
  ];
  let worst = 0;
  let count = 0;
  for (const sheet of SHEETS) {
    for (const [rf, grid] of Object.entries(sheet.cells)) {
      sheet.roes.forEach((roe, i) => sheet.erps.forEach((erp, j) => {
        const v = computeCell({
          bookValue: sheet.bookValue, roePath: [roe], retention: sheet.retention,
          riskFree: Number(rf), erp,
        });
        const err = Math.abs(v / grid[i][j] - 1);
        worst = Math.max(worst, err);
        count += 1;
        assert.ok(err < 0.02, `${sheet.name} cell drifted (LT ROE ${roe}, RP ${erp}, Rf ${rf}): ${v} vs ${grid[i][j]}`);
      }));
    }
  }
  assert.equal(count, 54, "every captured grid cell must be checked");
  assert.ok(worst < 0.015, `sheet reproduction degraded: worst cell ${(worst * 100).toFixed(2)}%`);
}

// OUT-OF-SAMPLE: a second week of sheets (2025-11-28), never used to fit any
// parameter. Two things are asserted. The 3.5% scenario grids must reproduce at
// a known risk-free rate, and the current-rate grids must RECOVER their own
// risk-free rate — the sheets never print it, but the transcript for that week
// says "10년 국채 금리는 지금 현재 4% 수준", and both indices independently solve
// to about 4.05%. That is the formula predicting an input it was never given.
{
  const WEEK1 = [
    {
      name: "S&P 500 (2025-11-28)", bookValue: 6849.09 / 5.4698, retention: 1 - 0.3109,
      roes: [0.255, 0.260, 0.265], erps: [0.050, 0.045, 0.040],
      scenario35: [[7197, 7370, 7543], [7469, 7645, 7821], [7749, 7928, 8106]],
      current: [[6767, 6933, 7099], [7025, 7193, 7361], [7289, 7459, 7630]],
    },
    {
      name: "NASDAQ Composite (2025-11-28)", bookValue: 23365.69 / 7.6514, retention: 1 - 0.2180,
      roes: [0.300, 0.305, 0.310], erps: [0.055, 0.050, 0.045],
      scenario35: [[28138, 28731, 29324], [29208, 29812, 30416], [30308, 30923, 31538]],
      current: [[26408, 26974, 27539], [27416, 27992, 28568], [28452, 29038, 29624]],
    },
  ];
  const gridRms = (sheet, riskFree, grid) => {
    let sum = 0;
    sheet.roes.forEach((roe, i) => sheet.erps.forEach((erp, j) => {
      const v = computeCell({ bookValue: sheet.bookValue, roePath: [roe], retention: sheet.retention, riskFree, erp });
      sum += (v / grid[i][j] - 1) ** 2;
    }));
    return Math.sqrt(sum / 9);
  };
  for (const sheet of WEEK1) {
    const known = gridRms(sheet, 0.035, sheet.scenario35);
    assert.ok(known < 0.02, `${sheet.name} 3.5% scenario drifted: ${(known * 100).toFixed(2)}%`);
    let bestRf = null;
    let bestErr = Infinity;
    for (let rf = 0.02; rf <= 0.06; rf += 0.00025) {
      const err = gridRms(sheet, rf, sheet.current);
      if (err < bestErr) { bestErr = err; bestRf = rf; }
    }
    assert.ok(bestErr < 0.01, `${sheet.name} current grid drifted: ${(bestErr * 100).toFixed(2)}%`);
    assert.ok(Math.abs(bestRf - 0.0405) < 0.004, `${sheet.name} recovered risk-free ${bestRf}, expected about 4.05%`);
  }
}

// The two rates are genuinely distinct: the risk premium must not reach the
// discounting. On the captured S&P grid a 1%p risk-free move shifts fair value
// about 11.2% while a 1%p risk-premium move shifts it about 4.77%; an engine
// that discounted at Ke would make these equal.
{
  const base = { bookValue: 1252, roePath: [0.261], retention: 1 - 0.3109 };
  const rfSens = computeCell({ ...base, riskFree: 0.032, erp: 0.045 })
    / computeCell({ ...base, riskFree: 0.042, erp: 0.045 }) - 1;
  const rpSens = computeCell({ ...base, riskFree: 0.042, erp: 0.035 })
    / computeCell({ ...base, riskFree: 0.042, erp: 0.045 }) - 1;
  assert.ok(Math.abs(rfSens - 0.112) < 0.02, `risk-free sensitivity drifted: ${rfSens}`);
  assert.ok(Math.abs(rpSens - 0.0477) < 0.01, `risk-premium sensitivity drifted: ${rpSens}`);
  assert.ok(rfSens > rpSens * 2, "the two rates must stay distinct");
}

// The live build calls computeCase, not computeCell, so the reproduction has to
// hold through that path too — the previous suite validated a form the build did
// not use, which is how a three-year ROE path shipped for months against sheets
// that only ever carry one. computeCase's centre must equal the sheet centre, and
// passing a path must not change the answer.
{
  const sheet = {
    px: 6870.4, bookValue: 6870.4 / 5.4873, retention: 1 - 0.3109,
    riskFree: 0.042, erpCenter: 0.045,
  };
  const flat = computeCase({ ...sheet, roePath: [0.261] });
  assert.ok(Math.abs(flat.fair_value / 7144 - 1) < 0.02, `computeCase centre drifted: ${flat.fair_value}`);
  const withPath = computeCase({ ...sheet, roePath: [0.261, 0.24, 0.22] });
  assert.equal(withPath.fair_value, flat.fair_value, "only the long-run ROE may drive the model");
  assert.ok(flat.upside_min_pct < flat.upside_pct && flat.upside_pct < flat.upside_max_pct);
}

// Formula shape, hand-computable. With retention 0 the book never grows and the
// residual is constant, so the explicit annuity plus the terminal collapse to a
// perpetuity discounted at the DISCOUNT rate, not at Ke:
//   V = B0 + (ROE - Ke) * B0 / disc
// B0=1000, ROE 20%, Ke = 4% + 6% = 10%, disc = 7.6% + 0.56*4% = 9.84%
//   -> V = 1000 + 100/0.0984 = 2016.26
{
  const v = computeCell({ bookValue: 1000, roePath: [0.2], retention: 0, riskFree: 0.04, erp: 0.06 });
  const closed = 1000 + (0.2 - 0.10) * 1000 / discountRate(0.04);
  assert.equal(Math.round(v * 100) / 100, Math.round(closed * 100) / 100);
  assert.equal(Math.round(v * 100) / 100, 2016.26);
}

// Retention grows book and value; ROE below Ke stays below book.
{
  const flat = computeCell({ bookValue: 1000, roePath: [0.2], retention: 0, riskFree: 0.04, erp: 0.06 });
  const grown = computeCell({ bookValue: 1000, roePath: [0.2], retention: 0.5, riskFree: 0.04, erp: 0.06 });
  assert.ok(grown > flat);
  const weak = computeCell({ bookValue: 1000, roePath: [0.05], retention: 0.5, riskFree: 0.04, erp: 0.06 });
  assert.ok(weak < 1000);
}

// Case grid: mean strictly between min and max; a lower 10Y raises value;
// the tail shift only moves years beyond the consensus path.
{
  const base = { px: 1500, bookValue: 1000, roePath: [0.3], retention: 0.8, erpCenter: 0.05 };
  const cur = computeCase({ ...base, riskFree: 0.0468 });
  const low = computeCase({ ...base, riskFree: RIM_RATE_SCENARIO_10Y });
  assert.ok(low.fair_value > cur.fair_value);
  assert.ok(cur.upside_min_pct < cur.upside_pct && cur.upside_pct < cur.upside_max_pct);
}

// Calibration verdicts on the single-case row shape.
{
  const mk = (key, upside, fair) => ({ key, status: "ready", rate_current: { upside_pct: upside, fair_value: fair } });
  // Anchors are his published figures: S&P as a fair-value range, NASDAQ 100 and
  // KOSPI as upside percentages. A row inside its anchor passes, one outside
  // diverges.
  const results = checkCalibration([mk("sp500", 9, 8830), mk("nasdaq100", 5, 30000), mk("kospi", 50, 9800)]);
  assert.equal(results.find((r) => r.key === "sp500").status, "within_tolerance");
  assert.equal(results.find((r) => r.key === "nasdaq100").status, "diverged");
  assert.equal(results.find((r) => r.key === "kospi").status, "within_tolerance");
  const far = checkCalibration([mk("sp500", 9, 4000), mk("kospi", 260, 24000)]);
  assert.equal(far.find((r) => r.key === "sp500").status, "diverged");
  assert.equal(far.find((r) => r.key === "kospi").status, "diverged");
  assert.ok(checkCalibration([]).every((r) => r.status === "unavailable"));
}

// GUARD 1 — the artifact must be reproducible from its own record.
//
// Twice in one day a green suite hid a wrong engine, both times because the test
// fed inputs the build never used: first a book value that appeared in no source,
// then a flat ROE while the build passed a three-year path. Asserting hand-written
// inputs cannot catch that. This instead reads the SHIPPED artifact and recomputes
// every row from the numbers that row itself records. If the build consumes
// anything it does not disclose, or discloses anything it does not consume, the
// recomputation misses and this fails.
{
  const artifactPath = new URL("../data/computed/fenok-rim/fair-values.json", import.meta.url);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const ready = (artifact.rows ?? []).filter((r) => r.status === "ready");
  assert.ok(ready.length >= 4, "artifact must carry ready rows to audit");
  for (const row of ready) {
    const recomputed = computeCase({
      px: row.px_last,
      bookValue: row.book_value,
      roePath: row.roe_path,
      retention: row.retention,
      riskFree: row.risk_free,
      erpCenter: row.erp_center,
    });
    const drift = Math.abs(recomputed.fair_value / row.rate_current.fair_value - 1);
    assert.ok(
      drift < 0.005,
      `${row.name}: the artifact is not reproducible from its own recorded inputs `
      + `(recorded ${row.rate_current.fair_value}, recomputed ${recomputed.fair_value.toFixed(2)}). `
      + "Either the build uses an input it does not disclose, or it discloses one it does not use.",
    );
  }
}

// GUARD 2 — every constant the model consumes must be documented.
//
// The provenance block silently went stale and described an engine that no longer
// existed: a retired ERP source, a five-year horizon, a three-year ROE path, and
// two discount coefficients that were never recorded at all. Nothing checked that
// the record matched the code. This does.
{
  const artifactPath = new URL("../data/computed/fenok-rim/fair-values.json", import.meta.url);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const prov = artifact.constants_provenance ?? {};
  const REQUIRED = [
    "price", "book_value", "roe", "risk_free_us", "risk_free_kr",
    "explicit_years", "discount_rate",
    "grid_step", "rate_scenario", "fair_value_definition",
    "erp_centers", "retention",
    "calibration_anchors",
  ];
  for (const key of REQUIRED) {
    assert.ok(prov[key], `constants_provenance is missing ${key} — an undocumented constant is an unexamined one`);
    assert.ok(prov[key].why && prov[key].why.length > 20, `${key} needs a why`);
    assert.ok(prov[key].refresh, `${key} needs a refresh rule`);
    assert.ok(["observed", "fitted", "read", "anchor", "target"].includes(prov[key].kind),
      `${key} needs a kind: observed, fitted, read, anchor or target`);
  }
  // The record must not claim a formula the engine no longer runs.
  const asText = JSON.stringify(prov);
  for (const stale of ["N=5", "Damodaran country ERP for each", "three-year", "internal source catalog"]) {
    assert.ok(!asText.includes(stale), `constants_provenance still says "${stale}" — it has drifted from the code`);
  }
  // Anything fitted-but-unexplained, or a known-open input, must say so.
  assert.ok(prov.discount_rate.open, "the discount slope has no mechanism and must keep saying so");
  assert.ok(prov.roe.open, "his long-run ROE is not our ROE field and must keep saying so");
}

// GUARD 3 — a hand-delivered export that never arrived must not pass silently.
//
// The benchmark workbook and the Global Scouter export come in weekly by hand.
// No workflow can chase them, so the only defence is that the artifact reports
// their age and says when one is late. A build that stops reporting this would
// go back to reusing a missed week without comment.
{
  const artifactPath = new URL("../data/computed/fenok-rim/fair-values.json", import.meta.url);
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const exports_ = artifact.weekly_exports ?? [];
  assert.equal(exports_.length, 2, "both hand-delivered exports must be reported");
  for (const e of exports_) {
    assert.ok(e.label && e.note, "each export needs a label and a readable note");
    assert.ok(e.age_days === null || Number.isFinite(e.age_days), `${e.label}: age must be a number or explicitly null`);
    if (Number.isFinite(e.age_days)) {
      assert.equal(e.late, e.age_days > 10, `${e.label}: lateness must follow the stated window`);
    }
  }
}

// Contract pins.
assert.equal(RIM_EXPLICIT_YEARS, 9, "9 explicit years reproduces all 54 captured grid cells; 8 and 10 do not");
assert.equal(RIM_GRID_STEP, 0.005);
assert.ok(RIM_CALIBRATION_ANCHORS.length >= 3);
// The discount rate is a function of the risk-free rate alone. Fitting a
// risk-premium or ROE term into it drives those coefficients to zero.
assert.ok(Math.abs(discountRate(0.042) - 0.0995) < 0.0005, "discount at Rf 4.2% must be ~9.95%");
assert.ok(Math.abs(discountRate(0.035) - 0.0956) < 0.0005, "discount at Rf 3.5% must be ~9.56%");
assert.ok(discountRate(0.05) > discountRate(0.03), "discount must rise with the risk-free rate");

// RECURRENCE GUARD — the calibration harness must score the engine the build
// runs. It kept its own payout table for a while: it scored KOSPI at a 13.82%
// payout while the build resolved 37.89% from the sheet anchor, so the ranking
// it printed — including the 3.0% mean error that justified the 2.3x ROE bound —
// described an engine nobody ships. Correcting it moved that candidate to 7.4%.
//
// This asserts BEHAVIOUR, not the presence of an import: every row the harness
// scores must carry the retention and risk-free the engine's own resolvers
// return. A future copy-paste of the table would fail here even if the import
// line survived.
{
  const { PUBLISHED, evaluate, loadContext } = await import("./check-fenok-rim-calibration.mjs");
  assert.ok(PUBLISHED.length >= 10, "the harness must keep its published anchor series");
  const rows = evaluate(loadContext());
  assert.ok(rows.length >= 8, "the harness must still score most of its anchors");
  for (const row of rows) {
    const expected = resolvePayout(row.key, null);
    assert.ok(expected, `${row.key}: the engine must resolve a retention for every scored index`);
    assert.equal(
      row.retention,
      expected.value,
      `${row.date} ${row.key}: harness retention must equal the engine's resolved retention`,
    );
    // A dated row must be priced at the rate observable on its own date. Scoring
    // every row at today's rate lets a ROE candidate absorb rate-date error and
    // be rewarded for it, which is what the harness did: six US dates all at
    // 4.68% and both KOSPI dates at the 4.4% engine anchor.
    assert.ok(
      row.riskFreeSource && !row.riskFreeSource.startsWith("FALLBACK"),
      `${row.date} ${row.key}: every scored anchor needs a dated risk-free, got "${row.riskFreeSource}"`,
    );
  }
  assert.ok(
    new Set(rows.map((r) => r.riskFree)).size > 1,
    "rows spanning different dates must not all be priced at one rate",
  );
  assert.ok(
    Number.isFinite(RIM_KR_RISK_FREE_ANCHOR.value),
    "the engine's Korean anchor stays the fallback for a KOSPI date with no dated capture",
  );
}

console.log("build-fenok-rim-index tests passed");
