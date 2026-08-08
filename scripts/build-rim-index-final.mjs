#!/usr/bin/env node
// FINAL — current SPX / NDX / QQQ from the canonical SSOT only.
//
// Every economic parameter is read from feno-index-rim-canonical-criteria.json. Nothing about the
// formula, the grids, the growth rule or the gate thresholds is restated here. That is the point of
// the file: the ~48% SPX split between the candidate-A runtime and the candidate-B E5 script existed
// because the economics lived in two hand-written places. They now live in one.
//
// Reads only committed sources. Writes six artifacts into data/computed/rim-index/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildRimIndexInputs, deriveNormalizedLongTermRoe } from "./build-rim-index.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const OUT = path.join(dataRoot, "computed", "rim-index");

export const CANONICAL = JSON.parse(
  fs.readFileSync(path.join(OUT, "feno-index-rim-canonical-criteria.json"), "utf8"),
);

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(dataRoot, rel), "utf8"));
const writeJson = (name, payload) =>
  fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(payload, null, 2)}\n`);
const round = (v, d = 6) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

// ---------------------------------------------------------------------------
// the engine — the canonical equations, and only them
// ---------------------------------------------------------------------------
export function canonicalValue({ b0, epsPath, payout, ke, ltroe, g }) {
  if (![b0, payout, ke, ltroe, g].every(Number.isFinite) || b0 <= 0) {
    return { value: null, blocker: "operand_missing_or_nonpositive" };
  }
  const eps = [0, 1, 2].map((i) => Number(epsPath?.[i]));
  if (!eps.every(Number.isFinite)) return { value: null, blocker: "eps_path_incomplete" };
  if (!(ke > g)) return { value: null, blocker: "pole_ke_not_above_g" };

  const retention = 1 - payout;
  const B = [b0];
  for (let t = 0; t < 3; t += 1) B.push(B[t] + eps[t] * retention);
  const b3 = B[3];
  if (b3 <= 0) return { value: null, blocker: "terminal_book_nonpositive" };

  const ri = [0, 1, 2].map((t) => eps[t] - ke * B[t]);
  const ri4 = (ltroe - ke) * b3;
  const cv3 = ri4 / (ke - g);
  const explicitPv = ri.reduce((sum, r, t) => sum + r / (1 + ke) ** (t + 1), 0);
  const terminalPv = cv3 / (1 + ke) ** 3;
  const value = b0 + explicitPv + terminalPv;
  if (!Number.isFinite(value)) return { value: null, blocker: "non_finite_value" };

  return {
    value,
    book: { b0, b1: B[1], b2: B[2], b3 },
    ri: { ri1: ri[0], ri2: ri[1], ri3: ri[2], ri4 },
    cv3,
    explicit_pv: explicitPv,
    terminal_pv: terminalPv,
    terminal_share: terminalPv / value,
    stable_retention: g / ltroe,
    pole_margin: ke - g,
    ke,
    ltroe,
    g,
  };
}

export function canonicalGrid({ b0, epsPath, payout, rf, erp, ltroeGrid, g }) {
  const cells = {};
  for (const [erpKey, erpV] of Object.entries({ low: erp.low, base: erp.base, high: erp.high })) {
    for (const [ltKey, ltV] of Object.entries(ltroeGrid)) {
      const ke = rf + erpV;
      const r = canonicalValue({ b0, epsPath, payout, ke, ltroe: ltV, g });
      cells[`${erpKey}_${ltKey}`] = {
        erp: { key: erpKey, value: erpV },
        ltroe: { key: ltKey, value: ltV },
        ke,
        ...r,
      };
    }
  }
  const values = Object.values(cells).map((c) => c.value);
  const allFinite = values.length === 9 && values.every(Number.isFinite);
  const monotonic = (() => {
    if (!allFinite) return false;
    for (const lt of ["low", "base", "high"]) {
      // higher ERP must not raise value
      if (cells[`low_${lt}`].value < cells[`base_${lt}`].value) return false;
      if (cells[`base_${lt}`].value < cells[`high_${lt}`].value) return false;
    }
    for (const e of ["low", "base", "high"]) {
      // higher LTROE must not lower value
      if (cells[`${e}_high`].value < cells[`${e}_base`].value) return false;
      if (cells[`${e}_base`].value < cells[`${e}_low`].value) return false;
    }
    return cells.low_high.value >= cells.base_base.value
      && cells.base_base.value >= cells.high_low.value;
  })();

  return {
    cells,
    BEAR: cells.high_low.value,
    BASE: cells.base_base.value,
    BULL: cells.low_high.value,
    GRID_MEAN: allFinite ? values.reduce((a, x) => a + x, 0) / 9 : null,
    all_finite: allFinite,
    monotonicity_passed: monotonic,
    min_pole_margin: allFinite ? Math.min(...Object.values(cells).map((c) => c.pole_margin)) : null,
    max_terminal_share: allFinite ? Math.max(...Object.values(cells).map((c) => c.terminal_share)) : null,
    base_terminal_share: cells.base_base.terminal_share,
    stable_retention_range: allFinite
      ? {
        min: Math.min(...Object.values(cells).map((c) => c.stable_retention)),
        max: Math.max(...Object.values(cells).map((c) => c.stable_retention)),
      }
      : null,
  };
}

function bisect(f, lo, hi) {
  const fLo = f(lo);
  const fHi = f(hi);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) {
    return { solved: false, reason: "bound_evaluation_non_finite", bounds: [lo, hi] };
  }
  if (fLo * fHi > 0) {
    return { solved: false, reason: "price_outside_monotone_range", bounds: [lo, hi], f_at_lo: fLo, f_at_hi: fHi };
  }
  let a = lo;
  let b = hi;
  for (let i = 0; i < 300; i += 1) {
    const mid = (a + b) / 2;
    const fm = f(mid);
    if (!Number.isFinite(fm)) return { solved: false, reason: "mid_non_finite" };
    if (Math.abs(fm) < 1e-8 || b - a < 1e-12) {
      return { solved: true, value: mid, iterations: i + 1, residual: fm, bounds: [lo, hi] };
    }
    if (fLo * fm <= 0) b = mid; else a = mid;
  }
  return { solved: false, reason: "iterations_exhausted" };
}

// ---------------------------------------------------------------------------
// operands — committed sources, asserted against the frozen source clocks
// ---------------------------------------------------------------------------
export function loadOperands() {
  const clocks = CANONICAL.source_clocks;
  const failures = [];

  const dgs10 = readJson("macro/fred-banking-daily.json").series?.DGS10 ?? [];
  const latestRf = [...dgs10].reverse().find((r) => Number.isFinite(r.value));
  const frozenRf = CANONICAL.stable_growth.rf_at_freeze;
  if (!latestRf || latestRf.date !== frozenRf.as_of) {
    failures.push(`DGS10 latest is ${latestRf?.date ?? "missing"}, frozen as-of is ${frozenRf.as_of}`);
  } else if (Math.abs(latestRf.value / 100 - frozenRf.value) > 1e-12) {
    failures.push(`DGS10 ${frozenRf.as_of} is ${latestRf.value / 100}, frozen value is ${frozenRf.value}`);
  }
  const rf = frozenRf.value;

  const erpPayload = readJson("damodaran/erp.json");
  const erpLive = erpPayload.us_erp ?? erpPayload.countries?.["United States"]?.equity_risk_premium;
  if (Math.abs(erpLive - CANONICAL.grids.erp.base) > 1e-12) {
    failures.push(`Damodaran US ERP live ${erpLive} != frozen base ${CANONICAL.grids.erp.base}`);
  }
  if (erpPayload.metadata?.source_date !== "April 1, 2026") {
    failures.push(`ERP source_date is ${erpPayload.metadata?.source_date}, frozen clock is ${clocks.erp.as_of}`);
  }

  const inputs = buildRimIndexInputs({ dataRootOverride: dataRoot, generatedAt: new Date().toISOString() });
  const benchmarkSections = { SPX: "sp500", NDX: "nasdaq100" };
  const benchmarks = readJson("benchmarks/us.json");

  const per = {};
  for (const idx of ["SPX", "NDX"]) {
    const entry = inputs.indices[idx];
    const rows = benchmarks.sections[benchmarkSections[idx]].data;
    const cutoff = CANONICAL.grids.ltroe.window.split(" .. ")[1];
    const recomputed = deriveNormalizedLongTermRoe(rows, cutoff, 10);
    const frozenBase = CANONICAL.grids.ltroe[idx].base;
    if (Math.abs(recomputed.base - frozenBase) > 1e-9) {
      failures.push(`${idx} LTROE recompute ${recomputed.base} != frozen base ${frozenBase}`);
    }
    per[idx] = {
      b0: entry.derived.book_value.value,
      epsPath: entry.derived.forecast_grid_v1.periods.map((p) => p.earnings_proxy.value),
      payoutA: entry.derived.payout_ratio.value,
      payoutB: entry.derived.legacy_payout_ratio_qa.value,
      price: entry.observed.price.value,
      ltroe_recomputed: { base: recomputed.base, n: recomputed.n_observations },
    };
  }

  const qqqPayload = readJson("yf/finance/QQQ.json");
  const qqqRow = [...(qqqPayload?.data?.history_1y ?? [])]
    .reverse()
    .find((r) => r?.date && r.date <= clocks.benchmark_price_eps_pb_roe.as_of && Number.isFinite(r.Close));
  if (!qqqRow) failures.push("QQQ close at the benchmark as-of date is missing");

  return { rf, erpLive, per, qqqPrice: qqqRow ? round(qqqRow.Close, 2) : null, source_clock_failures: failures };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
export function computeAll() {
  const ops = loadOperands();
  const gBase = CANONICAL.stable_growth.g_base_value;
  const gLow = CANONICAL.hard_gates.G6_terminal_sensitivity.g_low;
  const gHigh = CANONICAL.hard_gates.G6_terminal_sensitivity.g_high;
  const erp = CANONICAL.grids.erp;

  const result = { source_clock_failures: ops.source_clock_failures, indices: {} };

  for (const idx of ["SPX", "NDX"]) {
    const o = ops.per[idx];
    const ltroeGrid = {
      low: CANONICAL.grids.ltroe[idx].low,
      base: CANONICAL.grids.ltroe[idx].base,
      high: CANONICAL.grids.ltroe[idx].high,
    };
    const common = { b0: o.b0, epsPath: o.epsPath, payout: o.payoutA, rf: ops.rf, erp, ltroeGrid };

    const grid = canonicalGrid({ ...common, g: gBase });
    const gridLow = canonicalGrid({ ...common, g: gLow });
    const gridHigh = canonicalGrid({ ...common, g: gHigh });
    const gridB = canonicalGrid({ ...common, payout: o.payoutB, g: gBase });

    const keBase = ops.rf + erp.base;
    const impliedLtroe = bisect(
      (lt) => canonicalValue({ b0: o.b0, epsPath: o.epsPath, payout: o.payoutA, ke: keBase, ltroe: lt, g: gBase }).value - o.price,
      0.0, 1.5,
    );
    // The implied-ERP search domain is bounded by the model's own pole: ke must stay above g, so
    // erp must stay above g - rf. The old [-0.02, 0.30] bounds predate the stable-growth terminal
    // and put the lower bound inside the pole, where the value is undefined. The lower bound is
    // therefore the ERP that leaves a 50bp pole margin. This is a diagnostic solver, not a gate —
    // no READY condition reads it — so the domain fix carries no fitting risk.
    const erpPoleFloor = gBase - ops.rf + 0.005;
    const impliedErp = bisect(
      (e) => canonicalValue({ b0: o.b0, epsPath: o.epsPath, payout: o.payoutA, ke: ops.rf + e, ltroe: ltroeGrid.base, g: gBase }).value - o.price,
      erpPoleFloor, 0.30,
    );
    impliedErp.domain_note = `lower bound ${round(erpPoleFloor, 6)} = g_base - Rf + 0.005, the 50bp pole margin`;

    const sensLow = gridLow.BASE / grid.BASE - 1;
    const sensHigh = gridHigh.BASE / grid.BASE - 1;
    const envelope = [gridLow.BASE, grid.BASE, gridHigh.BASE];
    const fairValueOverlap = Math.min(...envelope) <= o.price && o.price <= Math.max(...envelope);

    const baseShift = Math.abs(gridB.BASE - grid.BASE) / Math.abs(grid.BASE);
    const meanShift = Math.abs(gridB.GRID_MEAN - grid.GRID_MEAN) / Math.abs(grid.GRID_MEAN);

    result.indices[idx] = {
      operands: o,
      grid,
      grid_g_low: gridLow,
      grid_g_high: gridHigh,
      grid_payout_b: gridB,
      reverse: { implied_ltroe: impliedLtroe, implied_erp: impliedErp },
      sensitivity: {
        g_base: gBase, g_low: gLow, g_high: gHigh,
        base_at_g_base: grid.BASE, base_at_g_low: gridLow.BASE, base_at_g_high: gridHigh.BASE,
        rel_move_g_low: sensLow, rel_move_g_high: sensHigh,
        max_abs_rel_move: Math.max(Math.abs(sensLow), Math.abs(sensHigh)),
        fair_value_overlap: fairValueOverlap,
      },
      payout_impact: {
        route_a: o.payoutA, route_b: o.payoutB,
        base_cell_shift: baseShift, grid_mean_shift: meanShift,
        ordering_a_passed: grid.monotonicity_passed, ordering_b_passed: gridB.monotonicity_passed,
        grid_b: { BEAR: gridB.BEAR, BASE: gridB.BASE, BULL: gridB.BULL, GRID_MEAN: gridB.GRID_MEAN },
      },
    };
  }

  // QQQ — NDX ratio equivalent
  const ndx = result.indices.NDX;
  const scale = ops.qqqPrice / ndx.operands.price;
  result.qqq = {
    formula: CANONICAL.qqq.formula,
    label: CANONICAL.qqq.label,
    current: ops.qqqPrice,
    scale,
    bear: ndx.grid.BEAR * scale,
    base: ndx.grid.BASE * scale,
    bull: ndx.grid.BULL * scale,
    grid_mean: ndx.grid.GRID_MEAN * scale,
    base_at_g_low: ndx.grid_g_low.BASE * scale,
    base_at_g_high: ndx.grid_g_high.BASE * scale,
    caveats: CANONICAL.qqq.caveats,
  };

  // gate evaluation, thresholds read from the canonical file
  const G = CANONICAL.hard_gates;
  const gates = {};
  for (const idx of ["SPX", "NDX"]) {
    const r = result.indices[idx];
    gates[idx] = {
      G1_pole_margin: r.grid.min_pole_margin >= G.G1_pole_margin.threshold,
      G2_terminal_share: r.grid.base_terminal_share <= G.G2_terminal_share.threshold,
      G3_stable_retention: r.grid.stable_retention_range.min >= 0 && r.grid.stable_retention_range.max <= 1,
      G4_finite: r.grid.all_finite,
      G5_monotonicity: r.grid.monotonicity_passed,
      G6_terminal_sensitivity: r.sensitivity.max_abs_rel_move <= G.G6_terminal_sensitivity.threshold,
      G7_payout_materiality:
        r.payout_impact.base_cell_shift <= CANONICAL.payout.materiality_thresholds.base_cell_shift_max
        && r.payout_impact.grid_mean_shift <= CANONICAL.payout.materiality_thresholds.grid_mean_shift_max
        && r.payout_impact.ordering_a_passed && r.payout_impact.ordering_b_passed,
    };
  }
  result.gates = gates;
  return result;
}

// ---------------------------------------------------------------------------
// artifacts
// ---------------------------------------------------------------------------
function main() {
  const r = computeAll();
  const stamp = {
    schema_version: "feno_index_rim_final.v1",
    canonical_criteria: "feno-index-rim-canonical-criteria.json",
    canonical_criteria_sha256: "9100ea6014ebfd01e53a8b3714be220780286285dc892d9372488cc490a7354d",
    criteria_frozen_at_commit: "79717ab76f",
    source_clocks: CANONICAL.source_clocks,
    oldest_input: CANONICAL.source_clocks.oldest_binding_input,
    public_surface: CANONICAL.public_surface,
  };

  for (const idx of ["SPX", "NDX"]) {
    const x = r.indices[idx];
    const p = x.operands.price;
    writeJson(`FENO_RIM_FINAL_CURRENT_${idx}.json`, {
      ...stamp,
      asset: idx,
      current: { price: p, as_of: CANONICAL.source_clocks.benchmark_price_eps_pb_roe.as_of },
      scenarios: {
        bear: round(x.grid.BEAR, 2), base: round(x.grid.BASE, 2),
        bull: round(x.grid.BULL, 2), grid_mean: round(x.grid.GRID_MEAN, 2),
        bear_delta_pct: round((x.grid.BEAR / p - 1) * 100, 1),
        base_delta_pct: round((x.grid.BASE / p - 1) * 100, 1),
        bull_delta_pct: round((x.grid.BULL / p - 1) * 100, 1),
        grid_mean_delta_pct: round((x.grid.GRID_MEAN / p - 1) * 100, 1),
      },
      full_3x3: Object.fromEntries(Object.entries(x.grid.cells).map(([k, c]) => [k, {
        erp: c.erp.value, ltroe: c.ltroe.value, ke: round(c.ke, 6),
        value: round(c.value, 2), terminal_share: round(c.terminal_share, 6),
        pole_margin: round(c.pole_margin, 6), stable_retention: round(c.stable_retention, 6),
      }])),
      inputs_that_define_the_number: {
        rf: CANONICAL.stable_growth.rf_at_freeze,
        erp: CANONICAL.grids.erp,
        ltroe: CANONICAL.grids.ltroe[idx],
        ltroe_recomputed: x.operands.ltroe_recomputed,
        g_base: CANONICAL.stable_growth.g_base_value,
        g_base_source: CANONICAL.stable_growth.primary_source,
        ke_base: round(CANONICAL.stable_growth.rf_at_freeze.value + CANONICAL.grids.erp.base, 6),
        eps_path: x.operands.epsPath,
        book_value_beginning: x.operands.b0,
        payout_route_a: x.operands.payoutA,
      },
      terminal: {
        base_terminal_share: round(x.grid.base_terminal_share, 6),
        max_terminal_share: round(x.grid.max_terminal_share, 6),
        min_pole_margin: round(x.grid.min_pole_margin, 6),
        stable_retention_range: x.grid.stable_retention_range,
      },
      sensitivity_100bp: x.sensitivity,
      gates: r.gates[idx],
      monotonicity_passed: x.grid.monotonicity_passed,
    });
  }

  writeJson("FENO_RIM_FINAL_CURRENT_QQQ.json", {
    ...stamp,
    asset: "QQQ",
    ...r.qqq,
    scenarios: {
      bear: round(r.qqq.bear, 2), base: round(r.qqq.base, 2),
      bull: round(r.qqq.bull, 2), grid_mean: round(r.qqq.grid_mean, 2),
      base_delta_pct: round((r.qqq.base / r.qqq.current - 1) * 100, 1),
      bull_delta_pct: round((r.qqq.bull / r.qqq.current - 1) * 100, 1),
      bear_delta_pct: round((r.qqq.bear / r.qqq.current - 1) * 100, 1),
    },
  });

  writeJson("FENO_RIM_FINAL_TERMINAL_SENSITIVITY.json", {
    ...stamp,
    rule: CANONICAL.hard_gates.G6_terminal_sensitivity,
    replaces: CANONICAL.hard_gates.G6_terminal_sensitivity.replaces,
    SPX: r.indices.SPX.sensitivity,
    NDX: r.indices.NDX.sensitivity,
    qqq_envelope: { base_at_g_low: round(r.qqq.base_at_g_low, 2), base: round(r.qqq.base, 2), base_at_g_high: round(r.qqq.base_at_g_high, 2) },
  });

  writeJson("FENO_RIM_FINAL_REVERSE_IMPLIED.json", {
    ...stamp,
    note: "Solve the current market price for implied LTROE at ERP base and implied ERP at LTROE base, under the canonical terminal. Reverse-implied output never retunes Base.",
    SPX: r.indices.SPX.reverse,
    NDX: r.indices.NDX.reverse,
  });

  writeJson("FENO_RIM_FINAL_PAYOUT_IMPACT.json", {
    ...stamp,
    thresholds: CANONICAL.payout.materiality_thresholds,
    SPX: r.indices.SPX.payout_impact,
    NDX: r.indices.NDX.payout_impact,
  });

  console.log(JSON.stringify({
    source_clock_failures: r.source_clock_failures,
    SPX: { current: r.indices.SPX.operands.price, ...{ bear: round(r.indices.SPX.grid.BEAR, 2), base: round(r.indices.SPX.grid.BASE, 2), bull: round(r.indices.SPX.grid.BULL, 2), mean: round(r.indices.SPX.grid.GRID_MEAN, 2) } },
    NDX: { current: r.indices.NDX.operands.price, ...{ bear: round(r.indices.NDX.grid.BEAR, 2), base: round(r.indices.NDX.grid.BASE, 2), bull: round(r.indices.NDX.grid.BULL, 2), mean: round(r.indices.NDX.grid.GRID_MEAN, 2) } },
    QQQ: { current: r.qqq.current, bear: round(r.qqq.bear, 2), base: round(r.qqq.base, 2), bull: round(r.qqq.bull, 2) },
    terminal_share: { SPX: round(r.indices.SPX.grid.base_terminal_share, 4), NDX: round(r.indices.NDX.grid.base_terminal_share, 4) },
    min_pole_margin: { SPX: round(r.indices.SPX.grid.min_pole_margin, 4), NDX: round(r.indices.NDX.grid.min_pole_margin, 4) },
    sensitivity_max_abs: { SPX: round(r.indices.SPX.sensitivity.max_abs_rel_move, 4), NDX: round(r.indices.NDX.sensitivity.max_abs_rel_move, 4) },
    fair_value_overlap: { SPX: r.indices.SPX.sensitivity.fair_value_overlap, NDX: r.indices.NDX.sensitivity.fair_value_overlap },
    reverse_implied: {
      SPX: { ltroe: round(r.indices.SPX.reverse.implied_ltroe.value, 5), erp: round(r.indices.SPX.reverse.implied_erp.value, 5) },
      NDX: { ltroe: round(r.indices.NDX.reverse.implied_ltroe.value, 5), erp: round(r.indices.NDX.reverse.implied_erp.value, 5) },
    },
    payout_shift: { SPX: round(r.indices.SPX.payout_impact.base_cell_shift, 5), NDX: round(r.indices.NDX.payout_impact.base_cell_shift, 5) },
    gates: r.gates,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
