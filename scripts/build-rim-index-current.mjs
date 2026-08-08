#!/usr/bin/env node
// E3 — CURRENT SPX / NDX / QQQ top-down RIM numbers FIRST (feno_index_rim_v1, criteria 2f660ac003).
// Reuses the committed benchmark readers, forecast_grid_v1, payout routes and sanitizers from
// build-rim-index.mjs. Writes the six deliverables into data/computed/rim-index/.
// Hard gates: monotonicity (criteria §monotonicity_hard_gate). No commit, no public surface.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildRimIndexInputs,
  deriveNormalizedLongTermRoe,
  buildRimScenarioGrid,
  computeReverseImpliedLtroe,
  computeReverseImpliedErp,
  measurePayoutRouteValuationImpact,
  buildQqqEquivalent,
} from "./build-rim-index.mjs";

function round(value, digits = 6) {
  return Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const OUT = path.join(dataRoot, "computed", "rim-index");
const CRITERIA = JSON.parse(fs.readFileSync(path.join(OUT, "feno-index-rim-v1-criteria.json"), "utf8"));

function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(dataRoot, rel), "utf8")); }
function writeJson(name, payload) { fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(payload, null, 2)}\n`); }

const benchmarkPayloads = new Map();
for (const f of ["benchmarks/us.json"]) benchmarkPayloads.set(f, readJson(f));
const macro = readJson("macro/fred-banking-daily.json");
const dgs10Rows = macro.series?.DGS10 ?? [];
// Criteria froze the Rf at 2026-08-05 = 4.63 (feno-index-rim-v1-criteria.json observed_inputs).
// The fred file has since gained a 2026-08-06 observation; the frozen as-of value is used to
// keep every input identical to the criteria snapshot, and the fresh reading is recorded.
const frozenRf = CRITERIA.observed_inputs.risk_free_rate;
const rfRow = [...dgs10Rows].reverse().find((r) => Number.isFinite(r.value));
if (!rfRow) throw new Error("DGS10 missing");
const frozenRow = dgs10Rows.find((r) => r.date === frozenRf.as_of);
if (!frozenRow || Math.abs(frozenRow.value / 100 - frozenRf.value) > 1e-9) {
  throw new Error(`DGS10 frozen as-of ${frozenRf.as_of} missing or changed in source`);
}
const rf = frozenRf.value;
const rfLive = rfRow.value / 100;

const erpPayload = readJson("damodaran/erp.json");
const erpBase = erpPayload.us_erp ?? erpPayload.countries?.["United States"]?.equity_risk_premium;
if (!Number.isFinite(erpBase)) throw new Error("Damodaran US ERP missing");

// Reuse the committed inputs builder for the forecast grid + payout routes (reads the same
// committed sources; the grid EPS path and payout ratios are the observed lane).
const inputs = buildRimIndexInputs({ dataRootOverride: dataRoot, generatedAt: new Date().toISOString() });
const indices = inputs.indices;

function indexInputs(idx, config) {
  const section = config.benchmarkSection;
  const benchmarkRows = readJson("benchmarks/us.json").sections[section].data;
  const entry = indices[idx];
  const forecastGrid = entry.derived.forecast_grid_v1;
  const epsPath = forecastGrid.periods.map((p) => p.earnings_proxy.value);
  const payoutA = entry.derived.payout_ratio.value;
  const payoutB = entry.derived.legacy_payout_ratio_qa.value;
  const bookValueBeginning = entry.derived.book_value.value;
  const price = entry.observed.price.value;
  return { benchmarkRows, entry, epsPath, payoutA, payoutB, bookValueBeginning, price };
}

const CFG = {
  SPX: { benchmarkSection: "sp500" },
  NDX: { benchmarkSection: "nasdaq100" },
};
const ltroeBase = { SPX: CRITERIA.ltroe_grid.SPX.base, NDX: CRITERIA.ltroe_grid.NDX.base };
const erpGrid = { low: CRITERIA.erp_grid.low, base: CRITERIA.erp_grid.base, high: CRITERIA.erp_grid.high };

// ---- per-index: LTROE recompute (must match the frozen criteria numbers) ----
const ltroeRecomputed = {};
for (const idx of ["SPX", "NDX"]) {
  const { benchmarkRows } = indexInputs(idx, CFG[idx]);
  const cutoff = CRITERIA.ltroe_grid.window.split(" .. ")[1];
  ltroeRecomputed[idx] = deriveNormalizedLongTermRoe(benchmarkRows, cutoff, 10);
  const frozen = ltroeBase[idx];
  const match = Math.abs(ltroeRecomputed[idx].base - frozen) < 1e-9;
  console.log(idx, "LTROE recomputed:", round(ltroeRecomputed[idx].base, 5),
    "| frozen:", frozen, "| n:", ltroeRecomputed[idx].n_observations, "| match:", match);
  if (!match) throw new Error(`${idx} LTROE recompute does not match the frozen criteria base`);
}

// ---- scenario grids (Route A primary) ----
const scenarios = {};
const reverse = {};
for (const idx of ["SPX", "NDX"]) {
  const { epsPath, payoutA, bookValueBeginning, price } = indexInputs(idx, CFG[idx]);
  const grid = buildRimScenarioGrid({
    bookValueBeginning, epsPath, payoutRatio: payoutA,
    riskFreeRate: rf, erpBase: CRITERIA.erp_grid.base, ltroeBase: ltroeBase[idx],
  });
  if (!grid.monotonicity_passed) throw new Error(`${idx} monotonicity hard gate FAILED`);
  scenarios[idx] = grid;
  const impliedLtroe = computeReverseImpliedLtroe({
    price, bookValueBeginning, epsPath, payoutRatio: payoutA,
    costOfEquity: rf + CRITERIA.erp_grid.base, bounds: CRITERIA.reverse_implied.solver_bounds.ltroe,
  });
  const impliedErp = computeReverseImpliedErp({
    price, bookValueBeginning, epsPath, payoutRatio: payoutA,
    riskFreeRate: rf, ltroe: ltroeBase[idx], bounds: CRITERIA.reverse_implied.solver_bounds.erp,
  });
  reverse[idx] = { implied_ltroe: impliedLtroe, implied_erp: impliedErp };
  console.log(idx, "| BEAR:", round(grid.BEAR, 1), "| BASE:", round(grid.BASE, 1), "| BULL:", round(grid.BULL, 1),
    "| mean:", round(grid.GRID_MEAN, 1), "| current:", price,
    "| implied LTROE:", round(impliedLtroe.value ?? NaN, 5), "| implied ERP:", round(impliedErp.value ?? NaN, 5));
}

// ---- payout route materiality (Route B through the whole grid) ----
const payoutImpact = {};
for (const idx of ["SPX", "NDX"]) {
  const { epsPath, payoutB, bookValueBeginning } = indexInputs(idx, CFG[idx]);
  const gridB = buildRimScenarioGrid({
    bookValueBeginning, epsPath, payoutRatio: payoutB,
    riskFreeRate: rf, erpBase: CRITERIA.erp_grid.base, ltroeBase: ltroeBase[idx],
  });
  const impact = measurePayoutRouteValuationImpact({ gridA: scenarios[idx], gridB });
  payoutImpact[idx] = {
    payout_route_a: indexInputs(idx, CFG[idx]).payoutA,
    payout_route_b: payoutB,
    raw_payout_divergence: Math.abs(payoutB - indexInputs(idx, CFG[idx]).payoutA) / indexInputs(idx, CFG[idx]).payoutA,
    ...impact,
    grid_b: { BEAR: gridB.BEAR, BASE: gridB.BASE, BULL: gridB.BULL, GRID_MEAN: gridB.GRID_MEAN },
  };
  console.log(idx, "payout impact | base shift:", payoutImpact[idx].base_cell_shift,
    "| grid mean shift:", payoutImpact[idx].grid_mean_shift,
    "| reconciled:", payoutImpact[idx].payout_routes_materially_reconciled);
}

// ---- QQQ ----
const qqqPayload = readJson("yf/finance/QQQ.json");
// Same-as-of discipline: NDX current is the 2026-07-31 benchmark row, so the QQQ leg uses the
// 2026-07-31 close from the same yf history, not the 2026-08-07 live quote (which would mix as-of).
const qqqHist = (qqqPayload?.data?.history_1y ?? []);
const qqqRow = [...qqqHist].reverse().find((r) => r?.date && r.date <= "2026-07-31" && Number.isFinite(r.Close));
const qqqPriceRaw = qqqRow?.Close;
const qqqPrice = Number.isFinite(qqqPriceRaw) ? round(qqqPriceRaw, 2) : qqqPriceRaw;
const qqqLive = qqqPayload?.data?.fast_info?.lastPrice;
if (!Number.isFinite(qqqPrice)) throw new Error("QQQ price missing (2026-07-31 close)");
const ndxPrice = indices.NDX.observed.price.value;
const qqq = buildQqqEquivalent({ currentQqq: qqqPrice, currentNdx: ndxPrice, ndxScenarios: scenarios.NDX });

// ---- deliverables ----
const asOfNote = {
  "as_of_dates": {
    "benchmark (price/EPS/PB/ROE)": "2026-07-31",
    "risk_free_rate (DGS10)": frozenRf.as_of,
    "erp (Damodaran US)": "2026-04-01",
    "ltroe_window": CRITERIA.ltroe_grid.window,
    "oldest_input": "2026-04-01 (Damodaran ERP)",
  },
  "evidence_status": "RESEARCH_PREVIEW",
  "forward_book_status": "UNRESOLVED (top-down index lane; bottom-up lane demoted to research)",
  "public_surface": "PUBLIC_ROWS = [], PUBLIC_STATE = MODEL_REVALIDATION",
};

function currentArtifact(idx) {
  const { price, payoutA } = indexInputs(idx, CFG[idx]);
  const s = scenarios[idx];
  const baseDelta = (s.BASE / price) - 1;
  const bullDelta = (s.BULL / price) - 1;
  const bearDelta = (s.BEAR / price) - 1;
  const gridMeanDelta = (s.GRID_MEAN / price) - 1;
  return {
    schema_version: "feno_index_rim_v1_current.v1",
    criteria: "feno-index-rim-v1-criteria.json 2f660ac003",
    asset: idx,
    current: { price, as_of: "2026-07-31" },
    scenarios: {
      bear: round(s.BEAR, 2), base: round(s.BASE, 2), bull: round(s.BULL, 2),
      grid_mean: round(s.GRID_MEAN, 2),
      bear_delta_pct: round(bearDelta * 100, 1), base_delta_pct: round(baseDelta * 100, 1),
      bull_delta_pct: round(bullDelta * 100, 1), grid_mean_delta_pct: round(gridMeanDelta * 100, 1),
    },
    full_3x3: Object.fromEntries(Object.entries(s.cells).map(([k, c]) => [
      k, { erp: c.erp.value, ltroe: c.ltroe.value, ke: round(c.ke, 4), value: round(c.value, 2) },
    ])),
    erp_grid: s.erp, ltroe_grid: s.ltroe,
    ke: { rf, rf_date: frozenRf.as_of, base_ke: round(rf + erpGrid.base, 4), live_reading_note: `fred file latest ${rfRow.date} = ${rfLive * 100}% — criteria-frozen ${frozenRf.as_of} = ${frozenRf.value * 100}% used` },
    ltroe_recomputed: { base: round(ltroeRecomputed[idx].base, 5), n: ltroeRecomputed[idx].n_observations },
    payout: { route_a: payoutA, route_b: indexInputs(idx, CFG[idx]).payoutB },
    eps_path: indexInputs(idx, CFG[idx]).epsPath,
    book_value_beginning: indexInputs(idx, CFG[idx]).bookValueBeginning,
    monotonicity_passed: s.monotonicity_passed,
    ...asOfNote,
  };
}

const spxArtifact = currentArtifact("SPX");
const ndxArtifact = currentArtifact("NDX");
const qqqArtifact = {
  schema_version: "feno_index_rim_v1_current.v1",
  criteria: "feno-index-rim-v1-criteria.json 2f660ac003",
  asset: "QQQ",
  current: { price: qqqPrice, as_of: "2026-07-31", note: `QQQ 2026-07-31 close from yf/finance/QQQ.json history_1y (same as-of as NDX benchmark); live quote ${Number.isFinite(qqqLive) ? round(qqqLive, 2) : "n/a"} (2026-08-07) recorded for reference` },
  scenarios: {
    bear: round(qqq.bear, 2), base: round(qqq.base, 2), bull: round(qqq.bull, 2),
    grid_mean: round(qqq.grid_mean, 2),
    bear_delta_pct: round((qqq.bear / qqqPrice - 1) * 100, 1),
    base_delta_pct: round((qqq.base / qqqPrice - 1) * 100, 1),
    bull_delta_pct: round((qqq.bull / qqqPrice - 1) * 100, 1),
    grid_mean_delta_pct: round((qqq.grid_mean / qqqPrice - 1) * 100, 1),
  },
  formula: qqq.formula, scale: qqq.scale, label: qqq.label, caveats: qqq.caveats,
  ...asOfNote,
};

const reverseArtifact = {
  schema_version: "feno_index_rim_v1_reverse_implied.v1",
  criteria: "feno-index-rim-v1-criteria.json 2f660ac003",
  note: "Solve current market price for implied LTROE at ERP_BASE and implied ERP at LTROE_BASE. Reverse-implied output never retunes Base (criteria §reverse_implied).",
  solver_bounds: CRITERIA.reverse_implied.solver_bounds,
  alarm_flags: CRITERIA.reverse_implied.alarm_flags_frozen_before_results,
  SPX: reverse.SPX,
  NDX: reverse.NDX,
  ...asOfNote,
};

const payoutArtifact = {
  schema_version: "feno_index_rim_v1_payout_impact.v1",
  criteria: "feno-index-rim-v1-criteria.json 2f660ac003",
  thresholds: CRITERIA.payout.materiality_thresholds_frozen_before_results,
  SPX: payoutImpact.SPX,
  NDX: payoutImpact.NDX,
  ...asOfNote,
};

// Owner view — numbers first, no methodology prose before the table.
const ownerView = `## FENO RIM — CURRENT (2026-08-08, top-down index lane)

| Asset | Current | Bear | Base | Bull | Grid Mean | Base Δ | Bull Δ |
|---|---:|---:|---:|---:|---:|---:|---:|
| SPX | ${spxArtifact.current.price} | ${spxArtifact.scenarios.bear} | ${spxArtifact.scenarios.base} | ${spxArtifact.scenarios.bull} | ${spxArtifact.scenarios.grid_mean} | ${spxArtifact.scenarios.base_delta_pct}% | ${spxArtifact.scenarios.bull_delta_pct}% |
| NDX | ${ndxArtifact.current.price} | ${ndxArtifact.scenarios.bear} | ${ndxArtifact.scenarios.base} | ${ndxArtifact.scenarios.bull} | ${ndxArtifact.scenarios.grid_mean} | ${ndxArtifact.scenarios.base_delta_pct}% | ${ndxArtifact.scenarios.bull_delta_pct}% |
| QQQ equivalent | $${qqqPrice} | $${qqqArtifact.scenarios.bear} | $${qqqArtifact.scenarios.base} | $${qqqArtifact.scenarios.bull} | $${qqqArtifact.scenarios.grid_mean} | ${qqqArtifact.scenarios.base_delta_pct}% | ${qqqArtifact.scenarios.bull_delta_pct}% |

### SPX 3×3 (ERP × LTROE)

| | LTROE low | LTROE base | LTROE high |
|---|---:|---:|---:|
| ERP low (bull) | ${spxArtifact.full_3x3.low_low.value} | ${spxArtifact.full_3x3.low_base.value} | ${spxArtifact.full_3x3.low_high.value} |
| ERP base | ${spxArtifact.full_3x3.base_low.value} | ${spxArtifact.full_3x3.base_base.value} | ${spxArtifact.full_3x3.base_high.value} |
| ERP high (bear) | ${spxArtifact.full_3x3.high_low.value} | ${spxArtifact.full_3x3.high_base.value} | ${spxArtifact.full_3x3.high_high.value} |

### NDX 3×3 (ERP × LTROE)

| | LTROE low | LTROE base | LTROE high |
|---|---:|---:|---:|
| ERP low (bull) | ${ndxArtifact.full_3x3.low_low.value} | ${ndxArtifact.full_3x3.low_base.value} | ${ndxArtifact.full_3x3.low_high.value} |
| ERP base | ${ndxArtifact.full_3x3.base_low.value} | ${ndxArtifact.full_3x3.base_base.value} | ${ndxArtifact.full_3x3.base_high.value} |
| ERP high (bear) | ${ndxArtifact.full_3x3.high_low.value} | ${ndxArtifact.full_3x3.high_base.value} | ${ndxArtifact.full_3x3.high_high.value} |

ERP: low ${(erpGrid.low * 100).toFixed(2)}% / base ${(erpGrid.base * 100).toFixed(2)}% / high ${(erpGrid.high * 100).toFixed(2)}%
LTROE: SPX ${(ltroeBase.SPX * 100).toFixed(2)}% (recomputed ${(ltroeRecomputed.SPX.base * 100).toFixed(2)}%, n=${ltroeRecomputed.SPX.n_observations}) /
NDX ${(ltroeBase.NDX * 100).toFixed(2)}% (recomputed ${(ltroeRecomputed.NDX.base * 100).toFixed(2)}%, n=${ltroeRecomputed.NDX.n_observations})
Rf: ${(rf * 100).toFixed(2)}% (${frozenRf.as_of}, criteria-frozen) | Ke base: ${(spxArtifact.ke.base_ke * 100).toFixed(2)}%
FY1/FY2/FY3 EPS: SPX ${spxArtifact.eps_path.join(" / ")} | NDX ${ndxArtifact.eps_path.join(" / ")}
Payout route A/B: SPX ${payoutImpact.SPX.payout_route_a.toFixed(4)} / ${payoutImpact.SPX.payout_route_b.toFixed(4)} | NDX ${payoutImpact.NDX.payout_route_a.toFixed(4)} / ${payoutImpact.NDX.payout_route_b.toFixed(4)}
Payout materially reconciled: SPX ${payoutImpact.SPX.payout_routes_materially_reconciled} (base shift ${(payoutImpact.SPX.base_cell_shift * 100).toFixed(2)}%) / NDX ${payoutImpact.NDX.payout_routes_materially_reconciled} (base shift ${(payoutImpact.NDX.base_cell_shift * 100).toFixed(2)}%)
Reverse-implied LTROE (at ERP base): SPX ${reverse.SPX.implied_ltroe.solved ? (reverse.SPX.implied_ltroe.value * 100).toFixed(2) + "%" : "NOT SOLVED"} / NDX ${reverse.NDX.implied_ltroe.solved ? (reverse.NDX.implied_ltroe.value * 100).toFixed(2) + "%" : "NOT SOLVED"}
Reverse-implied ERP (at LTROE base): SPX ${reverse.SPX.implied_erp.solved ? (reverse.SPX.implied_erp.value * 100).toFixed(2) + "%" : "NOT SOLVED"} / NDX ${reverse.NDX.implied_erp.solved ? (reverse.NDX.implied_erp.value * 100).toFixed(2) + "%" : "NOT SOLVED"}
Source dates: benchmark 2026-07-31 | DGS10 ${frozenRf.as_of} (criteria-frozen; fred live ${rfRow.date}) | Damodaran ERP 2026-04-01 (OLDEST input) | LTROE window ${CRITERIA.ltroe_grid.window}
Confidence: **RESEARCH PREVIEW / NOT VALIDATED** (forward-book UNRESOLVED; top-down lane; monotonicity gate passed)
QQQ: NDX-ratio indicative equivalent (current QQQ × NDX_s / current NDX); expense/tracking caveats disclosed.
`;

writeJson("FENO_RIM_CURRENT_SPX.json", spxArtifact);
writeJson("FENO_RIM_CURRENT_NDX.json", ndxArtifact);
writeJson("FENO_RIM_CURRENT_QQQ.json", qqqArtifact);
writeJson("FENO_RIM_REVERSE_IMPLIED.json", reverseArtifact);
writeJson("FENO_RIM_PAYOUT_VALUATION_IMPACT.json", payoutArtifact);
fs.writeFileSync(path.join(OUT, "FENO_RIM_CURRENT_OWNER_VIEW.md"), ownerView);
console.log("written 6 deliverables to", OUT);
