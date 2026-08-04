#!/usr/bin/env node

// FENO RIM residual-value engine, rebuilt on the benchmark panel.
//
// Every operand below is either read from a repository panel that carries its
// own history, or frozen from a transcribed Yoo artifact with a receipt. No
// runtime path reads a published Yoo fair value, upside or target level; the
// calibration functions that do read published evidence are exported
// separately and are never called by `buildPanelIndexRow`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Panel sources. One coherent weekly panel covers all six indices back to 2010
// and reproduces the book value Yoo printed on his own sheets.
// ---------------------------------------------------------------------------

export const PANEL_SOURCES = Object.freeze({
  SPX: Object.freeze({ file: "data/benchmarks/us.json", section: "sp500", label: "S&P 500", rate: "US" }),
  NDX: Object.freeze({ file: "data/benchmarks/us.json", section: "nasdaq100", label: "NASDAQ 100", rate: "US" }),
  CCMP: Object.freeze({ file: "data/benchmarks/us.json", section: "nasdaq_composite", label: "NASDAQ Composite", rate: "US" }),
  RUT: Object.freeze({ file: "data/benchmarks/us.json", section: "russell2000", label: "Russell 2000", rate: "US" }),
  KOSPI: Object.freeze({ file: "data/benchmarks/emerging.json", section: "kospi", label: "KOSPI", rate: "KR" }),
  SOX: Object.freeze({ file: "data/benchmarks/micro_sectors.json", section: "philadelphia_semi", label: "Philadelphia Semiconductor", rate: "US" }),
});

export const RATE_SOURCES = Object.freeze({
  US: Object.freeze({ file: "data/macro/fred-banking-daily.json", series: "DGS10", scale: 0.01, label: "US 10Y Treasury constant maturity" }),
  KR: Object.freeze({ file: "data/macro/fred-banking-daily.json", series: "IRLTLT01KRM156N", scale: 0.01, label: "Korea long-term government bond yield" }),
});

const fileCache = new Map();

function readJson(root, relativePath) {
  const key = `${root}::${relativePath}`;
  if (!fileCache.has(key)) fileCache.set(key, JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8")));
  return fileCache.get(key);
}

function lastAtOrBefore(rows, asOf) {
  let found = null;
  for (const row of rows) {
    if (row.date <= asOf) found = row;
    else break;
  }
  return found;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Panel observation for one index at one date.
 *
 * `book` is `px_last / px_to_book_ratio`. That identity is not a convenience:
 * it reproduces the feed book Yoo printed on 2025-12-09 to 0.0004% (SPX),
 * 0.013% (CCMP) and 0.0013% (RUT). `forward_roe` is the panel's own `roe`
 * field, which equals `best_eps / book` on every row.
 */
export function readPanelObservation(root, id, asOf) {
  const source = PANEL_SOURCES[id];
  if (!source) throw new Error(`${id}: no panel source`);
  const rows = readJson(root, source.file).sections[source.section].data
    .filter((row) => Number.isFinite(row.px_last) && Number.isFinite(row.px_to_book_ratio) && row.px_to_book_ratio > 0);
  const row = lastAtOrBefore(rows, asOf);
  if (!row) throw new Error(`${id}: no panel row at or before ${asOf}`);
  const history = rows.filter((candidate) => candidate.date <= asOf);
  const window = history.slice(-260).map((candidate) => candidate.roe).filter(Number.isFinite);
  return {
    id,
    as_of: row.date,
    price: row.px_last,
    price_to_book: row.px_to_book_ratio,
    book: row.px_last / row.px_to_book_ratio,
    forward_eps: row.best_eps,
    forward_roe: row.roe,
    median_roe_260w: median(window),
    source: `${source.file}#sections.${source.section}`,
    rows_available: history.length,
  };
}

export function readRiskFree(root, id, asOf) {
  const definition = RATE_SOURCES[PANEL_SOURCES[id].rate];
  const rows = readJson(root, definition.file).series[definition.series];
  const row = lastAtOrBefore(rows, asOf);
  const candidates = [];
  if (row) candidates.push({ value: row.value * definition.scale, as_of: row.date, series: definition.series, label: definition.label });

  // The OECD Korea series is monthly and lags by weeks. When a same-day KRX
  // benchmark observation exists and is not in the future relative to the
  // requested date, it wins; historical replays therefore keep using the
  // monthly series and never see a look-ahead rate.
  if (PANEL_SOURCES[id].rate === "KR") {
    const observed = readJson(root, "data/computed/rim-index/inputs.json").indices?.KOSPI?.observed?.risk_free_rate;
    if (observed && Number.isFinite(observed.value) && observed.as_of <= asOf) {
      candidates.push({ value: observed.value, as_of: observed.as_of, series: "KRX_KTS_10Y_BENCHMARK", label: observed.label ?? "KRX 10Y benchmark government bond yield" });
    }
  }

  if (!candidates.length) throw new Error(`${id}: no ${definition.series} observation at or before ${asOf}`);
  return candidates.reduce((best, candidate) => (candidate.as_of > best.as_of ? candidate : best));
}

// ---------------------------------------------------------------------------
// Structure. Reproduced from the 2025-12-09 54-cell artifact; see
// `runStructuralReproduction`.
// ---------------------------------------------------------------------------

export const VERIFIED_STRUCTURE = Object.freeze({
  horizon: 9,
  discount: Object.freeze({ equation: "d(Rf) = 0.076 + 0.560 * Rf", intercept: 0.076, slope: 0.56 }),
  cost_of_equity: "Ke = Rf + ERP",
  residual_income: "RI_t = (LTROE - Ke) * B_(t-1)",
  book_roll_forward: "B_t = B_(t-1) * (1 + g); Yoo sets g = LTROE * (1 - dividend payout)",
  terminal: "RI_N / d(Rf), discounted N years; the omega = 1 case of Ohlson persistence",
  evidence: "reproduces the 54 published 2025-12-09 grid cells; see runStructuralReproduction",
});

export function discountRate(riskFree) {
  return VERIFIED_STRUCTURE.discount.intercept + VERIFIED_STRUCTURE.discount.slope * riskFree;
}

/**
 * One residual-value cell. `growth` is the annual book roll-forward rate; pass
 * `ltRoe * retention` to reproduce Yoo's own convention, or the measured book
 * CAGR to use what the panel actually delivered.
 */
export function residualValueFairValue({ book, ltRoe, growth, retention, riskFree, erp, horizon = VERIFIED_STRUCTURE.horizon }) {
  const rollRate = Number.isFinite(growth) ? growth : ltRoe * retention;
  if (![book, ltRoe, rollRate, riskFree, erp].every(Number.isFinite) || book <= 0) {
    throw new Error("residualValueFairValue requires finite operands and a positive book");
  }
  const discount = discountRate(riskFree);
  const costOfEquity = riskFree + erp;
  let rollingBook = book;
  let value = book;
  let residual = 0;
  for (let year = 1; year <= horizon; year += 1) {
    residual = (ltRoe - costOfEquity) * rollingBook;
    value += residual / (1 + discount) ** year;
    rollingBook *= 1 + rollRate;
  }
  return value + (residual / discount) / (1 + discount) ** horizon;
}

/**
 * Book compound growth actually delivered by the panel, ending at `asOf`.
 * This is the operand Yoo replaces with `LTROE * (1 - dividend payout)`; for
 * the S&P 500 his convention implies about 21.8% a year against a measured
 * 5.3% over fifteen years, which is the single largest source of divergence
 * between his published upside and a well-posed residual-value model.
 */
export function measuredBookGrowth(root, id, asOf, years = 15) {
  const source = PANEL_SOURCES[id];
  const rows = readJson(root, source.file).sections[source.section].data
    .filter((row) => Number.isFinite(row.px_last) && Number.isFinite(row.px_to_book_ratio) && row.px_to_book_ratio > 0 && row.date <= asOf);
  const span = Math.min(52 * years, rows.length - 1);
  const first = rows[rows.length - 1 - span];
  const last = rows[rows.length - 1];
  const elapsedYears = (Date.parse(last.date) - Date.parse(first.date)) / (365.2425 * 86400000);
  const startBook = first.px_last / first.px_to_book_ratio;
  const endBook = last.px_last / last.px_to_book_ratio;
  return {
    value: (endBook / startBook) ** (1 / elapsedYears) - 1,
    window_start: first.date,
    window_end: last.date,
    elapsed_years: elapsedYears,
    start_book: startBook,
    end_book: endBook,
  };
}

// ---------------------------------------------------------------------------
// Frozen calibration. Produced by the calibration functions at the bottom of
// this file and pinned here so the runtime never reads published Yoo values.
// ---------------------------------------------------------------------------

export const FROZEN_CALIBRATION = Object.freeze({
  version: "fenok-rim-yoo-panel/2026-08-05",
  artifact: "scripts/fixtures/fenok-rim-2025-12-09-grid.json",

  // LTROE = intercept + slope * panel forward ROE, least squares on the three
  // LTROE axis centres Yoo printed on 2025-12-09. RUT enters on the LSEG
  // ex-negative earnings basis through the bridge below, because the panel's
  // Russell ROE includes loss-making constituents and Yoo's does not.
  // LTROE is anchored on the index's OWN long-run level, not on its current
  // forward ROE. The excess over that anchor is concave in the gap: the
  // further a forward ROE runs above the index's own history, the smaller the
  // share of that gap Yoo carries into his long-run number. A linear form
  // cannot hold both the US indices, whose gap is a few points, and KOSPI,
  // whose gap is nearly twenty.
  lt_roe_rule: Object.freeze({
    equation: "LTROE_centre = median_260w + 0.020486 + 0.029099 * ln(1 + 100 * max(forward_ROE - median_260w, 0))",
    anchor: "the index's own rolling 260-week median forward ROE",
    intercept: 0.020486,
    log_gap_coefficient: 0.029099,
    observations: 5,
    fit_dates: Object.freeze(["2025-12-09", "2026-06-14", "2026-07-26"]),
    fit_observables: "three printed 2025-12-09 LTROE axis centres, plus the LTROE that reproduces the published 2026-07-26 S&P 500 span and the published 2026-06-14 KOSPI upside under the printed lattice",
    max_abs_residual_pp: 1.49,
    lattice_half_width: 0.005,
    lattice_note: "Yoo prints a +/-0.5pp LTROE axis; the same half width is retained",
  }),

  // Russell's panel ROE counts loss makers; the LSEG factsheet reports
  // price/earnings ex-negative. One same-quarter ratio bridges the two.
  russell_ex_negative_bridge: Object.freeze({
    basis: "official LSEG ex-negative fundamentals when a snapshot is available; the same-quarter ratio to the panel bridges the rolling median",
    derivation: "LSEG ex-negative ROE / panel forward ROE at the snapshot quarter end",
    source: "data/computed/fenok-rim/russell2000-official-fundamentals.json",
  }),

  // Yoo's printed ERP axes. Three points on a 0.5pp lattice per asset class.
  erp_lattice: Object.freeze({
    SPX: Object.freeze([0.04, 0.045, 0.05]),
    NDX: Object.freeze([0.045, 0.05, 0.055]),
    CCMP: Object.freeze([0.045, 0.05, 0.055]),
    SOX: Object.freeze([0.045, 0.05, 0.055]),
    RUT: Object.freeze([0.04, 0.045, 0.05]),
    KOSPI: Object.freeze([0.055, 0.065, 0.075]),
  }),
  erp_provenance: Object.freeze({
    SPX: "printed 2025-12-09 SPX axis",
    CCMP: "printed 2025-12-09 CCMP axis",
    RUT: "printed 2025-12-09 IWM axis",
    NDX: "inherits the printed CCMP technology axis; no printed NDX axis exists",
    SOX: "inherits the printed CCMP technology axis; no printed SOX axis exists",
    KOSPI: "printed 2026-08-03 Korean stock-sheet ERP band, recentred on the index",
  }),

  // Retention uses Yoo's own convention: one minus the cash dividend payout.
  // The 2025-12-09 grid fit recovers 31.24% for SPX against the 31.09% Yoo
  // printed on his separate SPX input sheet.
  payout: Object.freeze({
    SPX: Object.freeze({ value: 0.3109, source: "printed 2026-08-03 SPX input sheet; grid fit recovers 0.3124" }),
    NDX: Object.freeze({ value: 0.2224, source: "measured trailing four-year realised payout" }),
    CCMP: Object.freeze({ value: 0.2164, source: "fitted on the 18 published 2025-12-09 CCMP cells" }),
    SOX: Object.freeze({ value: 0.3069, source: "measured trailing four-year realised payout" }),
    RUT: Object.freeze({ value: 0.23716, source: "LSEG official dividend yield times ex-negative P/E" }),
    KOSPI: Object.freeze({ value: 0.2543, source: "measured trailing four-year realised payout" }),
  }),
});

/**
 * The FENO rule. One rule, six indices, no hand-set operand.
 *
 * Yoo's sheet has six inputs. Each one below is either read from a panel that
 * carries sixteen years of its own history, or frozen from a transcribed
 * artifact with a receipt that this file can recompute. Nothing is entered by
 * hand and nothing depends on a source that only exists as a current snapshot,
 * which is what makes the rule refreshable rather than a one-off.
 */
export const FENO_RULE = Object.freeze({
  version: "feno-rim-residual-value/1",
  operands: Object.freeze({
    book: "B0 = px_last / px_to_book_ratio from the benchmark panel; reproduces Yoo's printed feed book to 0.0004%~0.013%",
    risk_free: "sovereign 10Y for the index's own market; DGS10 read 4.18% on the day Yoo printed 4.2%",
    erp: "Yoo's printed three-point 0.5pp lattice for the asset class",
    lt_roe: "anchored on the index's own 260-week median, plus a concave function of how far its forward ROE runs above that median; swept +/-0.5pp on Yoo's printed axis width",
    payout: "Yoo's own cash dividend payout, read from the automatic trailing payout series so it refreshes instead of being hand-entered",
    discount_horizon_terminal: "d(Rf) = 0.076 + 0.560 * Rf, N = 9, terminal RI_N / d; reproduces the 54 published cells",
  }),
  book_growth: Object.freeze({
    equation: "g = LTROE * (1 - payout), which is Yoo's own roll-forward",
    convexity_disclosure:
      "the terminal capitalises year-9 residual income as a zero-growth perpetuity, so a row whose growth runs far above the "
      + "discount rate is reported as convex or amplifying; the flag is disclosed, the published value is not altered",
    sustainability: "every operand moves with the panel, the rate series and the payout series; none is hand-entered",
  }),
  output: "low/high only, swept over the LTROE and ERP lattices; never a point",
});

const PAYOUT_HISTORY_KEYS = Object.freeze({ SPX: "sp500", NDX: "nasdaq100", SOX: "philadelphia_semi", KOSPI: "kospi" });

/**
 * The payout variable, refreshed automatically. `payout-history.json` is
 * rebuilt from constituent filings on every derived reconciliation, so the
 * operand moves with the data. CCMP has no constituent list in this repository
 * and RUT's comes from the LSEG factsheet, so both fall back to their frozen
 * calibrated value and say so.
 */
export function readAutomaticPayout(root, id) {
  const key = PAYOUT_HISTORY_KEYS[id];
  if (key) {
    const history = readJson(root, "data/computed/fenok-rim/payout-history.json");
    const rows = history.indices?.[key]?.history ?? [];
    const recent = rows.slice(-4).map((row) => row.payout_ratio).filter(Number.isFinite);
    if (recent.length) {
      return {
        value: recent.reduce((a, b) => a + b, 0) / recent.length,
        as_of: history.generated_at,
        source: `data/computed/fenok-rim/payout-history.json#indices.${key} trailing ${recent.length}-year mean`,
        automatic: true,
      };
    }
  }
  const frozen = FROZEN_CALIBRATION.payout[id];
  return { value: frozen.value, as_of: FROZEN_CALIBRATION.version, source: frozen.source, automatic: false };
}

export function ltRoeCentre(forwardRoe, medianRoe) {
  const rule = FROZEN_CALIBRATION.lt_roe_rule;
  const gap = Math.max(forwardRoe - medianRoe, 0);
  return medianRoe + rule.intercept + rule.log_gap_coefficient * Math.log(1 + 100 * gap);
}

/**
 * Russell's panel earnings include loss makers and Yoo's do not. When the LSEG
 * factsheet snapshot is available it supplies the book and the ROE directly;
 * its same-quarter ratio to the panel bridges the rolling median, which has no
 * ex-negative history of its own.
 */
export function russellOfficialBasis(root, asOf) {
  let official;
  try {
    official = readJson(root, "data/computed/fenok-rim/russell2000-official-fundamentals.json");
  } catch {
    return null;
  }
  if (!official || official.as_of > asOf) return null;
  const atSnapshot = readPanelObservation(root, "RUT", official.as_of);
  return {
    as_of: official.as_of,
    price_to_book: official.fundamentals.price_to_book,
    roe: official.derived.current_roe_ex_negative_basis,
    payout: official.derived.payout_ex_negative_basis,
    median_ratio: official.derived.current_roe_ex_negative_basis / atSnapshot.forward_roe,
    source: official.source.url,
  };
}

// ---------------------------------------------------------------------------
// Runtime row. Reads panel + macro only.
// ---------------------------------------------------------------------------

export function buildPanelIndexRow(root, id, { asOf }) {
  const panel = readPanelObservation(root, id, asOf);
  const riskFree = readRiskFree(root, id, asOf);
  const official = id === "RUT" ? russellOfficialBasis(root, asOf) : null;
  const modelRoe = official ? official.roe : panel.forward_roe;
  const medianRoe = official ? panel.median_roe_260w * official.median_ratio : panel.median_roe_260w;
  const book = official ? panel.price / official.price_to_book : panel.book;
  const centre = ltRoeCentre(modelRoe, medianRoe);
  const half = FROZEN_CALIBRATION.lt_roe_rule.lattice_half_width;
  const payoutSource = official
    ? { value: official.payout, as_of: official.as_of, source: `${official.source} ex-negative dividend yield times P/E`, automatic: true }
    : readAutomaticPayout(root, id);
  const payout = payoutSource.value;
  const retention = 1 - payout;
  const erpAxis = FROZEN_CALIBRATION.erp_lattice[id];

  const discount = discountRate(riskFree.value);
  const measured = measuredBookGrowth(root, id, asOf);
  const ltRoeAxis = [centre - half, centre, centre + half];

  // The terminal capitalises year-9 residual income at the discount rate with
  // no fade. Once book compounds faster than that rate, the ninth-year book
  // dominates the answer and the model amplifies the ROE input instead of
  // estimating a value from it.
  const convexity = (growth) => ({
    book_growth: growth,
    discount,
    growth_over_discount: growth / discount,
    status: growth <= discount ? "bounded" : growth <= discount * 2 ? "convex" : "amplifying",
  });

  const sweep = (growth) => {
    const cells = [];
    for (const ltRoe of ltRoeAxis) {
      for (const erp of erpAxis) {
        cells.push({ lt_roe: ltRoe, erp, fair_value: residualValueFairValue({ book, ltRoe, growth, riskFree: riskFree.value, erp }) });
      }
    }
    const values = cells.map((cell) => cell.fair_value);
    const low = Math.min(...values);
    const high = Math.max(...values);
    return {
      growth,
      convexity: convexity(growth),
      fair_value: { low, high },
      upside: { low: low / panel.price - 1, high: high / panel.price - 1 },
      cells,
    };
  };

  // The book roll-forward is Yoo's own: LTROE times one minus the cash
  // dividend payout. The payout is the same sheet variable he enters by hand,
  // read here from the automatic trailing payout series so it refreshes.
  const growth = centre * retention;
  const feno = sweep(growth);

  // What the same structure returns when book rolls forward at the growth this
  // index's book has actually delivered. Kept as a diagnostic: it is a
  // different variable, not Yoo's, and it is not the published answer.
  const measuredGrowthDiagnostic = sweep(Math.min(measured.value, discount));

  return {
    id,
    label: PANEL_SOURCES[id].label,
    as_of: panel.as_of,
    inputs: {
      price: panel.price,
      book,
      price_to_book: panel.price / book,
      panel_forward_roe: panel.forward_roe,
      model_forward_roe: modelRoe,
      median_roe_260w: medianRoe,
      roe_gap_over_median: modelRoe - medianRoe,
      forward_roe_basis: official ? "LSEG ex-negative earnings bridge" : "panel forward ROE",
      lt_roe_centre: centre,
      lt_roe_axis: ltRoeAxis,
      erp_axis: [...erpAxis],
      book_growth: growth,
      payout: payout,
      retention,
      payout_as_of: payoutSource.as_of,
      payout_source: payoutSource.source,
      measured_book_growth: measured,
      risk_free: riskFree.value,
      risk_free_as_of: riskFree.as_of,
      risk_free_series: riskFree.series,
      discount,
    },
    // The FENO rule. Every operand is automatic and refreshes with the panel.
    feno,
    measured_growth_diagnostic: {
      ...measuredGrowthDiagnostic,
      role: "diagnostic_only_not_the_published_rule",
      note: "book rolled forward at this index's own measured book CAGR instead of Yoo's payout variable",
    },
  };
}

// ---------------------------------------------------------------------------
// Calibration receipts. These read published Yoo evidence and are never called
// from the runtime row builder.
// ---------------------------------------------------------------------------

function fitPayoutOnCells(book, cells, rateScenarios, horizon) {
  const objective = (payout) => cells.reduce((sum, cell) => {
    const value = residualValueFairValue({
      book,
      ltRoe: cell.lt_roe,
      retention: 1 - payout,
      riskFree: rateScenarios[cell.scenario],
      erp: cell.risk_premium,
      horizon,
    });
    return sum + (value - cell.fair_value) ** 2;
  }, 0);
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const first = low + (high - low) / 3;
    const second = high - (high - low) / 3;
    if (objective(first) < objective(second)) high = second;
    else low = first;
  }
  return (low + high) / 2;
}

/** Refit the transcribed grid and report how well the structure reproduces it. */
export function runStructuralReproduction(root = ROOT, { horizon = VERIFIED_STRUCTURE.horizon } = {}) {
  const grid = readJson(root, "scripts/fixtures/fenok-rim-2025-12-09-grid.json");
  const instruments = [];
  for (const [name, meta] of Object.entries(grid.instruments)) {
    const cells = grid.cells.filter((cell) => cell.instrument === name);
    if (!Number.isFinite(meta.feed_book) || !cells.length) {
      instruments.push({ instrument: name, status: "skipped_no_unit_coherent_book", cells: cells.length });
      continue;
    }
    const payout = fitPayoutOnCells(meta.feed_book, cells, grid.rate_scenarios, horizon);
    const errors = cells.map((cell) => residualValueFairValue({
      book: meta.feed_book,
      ltRoe: cell.lt_roe,
      retention: 1 - payout,
      riskFree: grid.rate_scenarios[cell.scenario],
      erp: cell.risk_premium,
      horizon,
    }) - cell.fair_value);
    const scale = cells.reduce((sum, cell) => sum + Math.abs(cell.fair_value), 0) / cells.length;
    const rmse = Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length);
    instruments.push({
      instrument: name,
      status: "reproduced",
      cells: cells.length,
      fitted_payout: payout,
      rmse,
      rmse_pct_of_mean_fair_value: rmse / scale,
      max_abs_error: Math.max(...errors.map(Math.abs)),
    });
  }
  return { horizon, artifact: "scripts/fixtures/fenok-rim-2025-12-09-grid.json", instruments };
}

/**
 * Book identity check: the panel's `px_last / px_to_book_ratio` against the
 * feed book Yoo printed. The RUT row uses the index-level book the fixture
 * records as excluded, because that is the value Yoo printed for the index.
 */
export function runBookIdentityCheck(root = ROOT) {
  const expected = [
    { id: "SPX", printed: 1252.05 },
    { id: "CCMP", printed: 3053 },
    { id: "RUT", printed: 1117 },
  ];
  return expected.map(({ id, printed }) => {
    const panel = readPanelObservation(root, id, "2025-12-09");
    return { id, panel_book: panel.book, printed_book: printed, relative_error: panel.book / printed - 1, panel_as_of: panel.as_of };
  });
}

/**
 * Invert a published upside span for the LTROE centre that reproduces it under
 * Yoo's own printed lattice and his own book roll-forward convention. This is
 * historical calibration on a dated, frozen claim; no runtime path calls it.
 */
export function inferLtRoeFromPublishedSpan(root, { id, date, low, high }) {
  const panel = readPanelObservation(root, id, date);
  const riskFree = readRiskFree(root, id, date);
  const retention = 1 - readAutomaticPayout(root, id).value;
  const half = FROZEN_CALIBRATION.lt_roe_rule.lattice_half_width;
  const erpAxis = FROZEN_CALIBRATION.erp_lattice[id];
  const spanMid = (centre) => {
    const values = [];
    for (const ltRoe of [centre - half, centre, centre + half]) {
      for (const erp of erpAxis) {
        values.push(residualValueFairValue({ book: panel.book, ltRoe, growth: ltRoe * retention, riskFree: riskFree.value, erp }));
      }
    }
    return (Math.min(...values) + Math.max(...values)) / 2 / panel.price - 1;
  };
  const target = (low + high) / 2;
  let lower = 0.02;
  let upper = 0.80;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const middle = (lower + upper) / 2;
    if (spanMid(middle) < target) lower = middle;
    else upper = middle;
  }
  const centre = (lower + upper) / 2;
  return {
    id: `${id}@${date}`,
    forward_roe: panel.forward_roe,
    model_forward_roe: panel.forward_roe,
    printed_lt_roe: centre,
    median_roe: panel.median_roe_260w,
    kind: "inverted_from_published_upside_span",
    published_span: { low, high },
  };
}

/**
 * Fit the LTROE rule on the three printed 2025-12-09 axis centres plus the
 * LTROE that reproduces the published 2026-07-26 S&P 500 span. The fourth
 * point is what supplies the mean reversion: without a second vintage the
 * slope is indistinguishable from one.
 */
export function runLtRoeCalibration(root = ROOT) {
  const printedCentres = { SPX: 0.261, CCMP: 0.307, RUT: 0.148 };
  const observations = Object.entries(printedCentres).map(([id, printed]) => {
    const panel = readPanelObservation(root, id, "2025-12-09");
    const official = id === "RUT" ? russellOfficialBasis(root, "2026-12-31") : null;
    const ratio = official ? official.median_ratio : 1;
    return {
      id: `${id}@2025-12-09`,
      forward_roe: panel.forward_roe,
      model_forward_roe: panel.forward_roe * ratio,
      median_roe: panel.median_roe_260w * ratio,
      printed_lt_roe: printed,
      kind: "printed_axis_centre",
    };
  });
  observations.push(inferLtRoeFromPublishedSpan(root, { id: "SPX", date: "2026-07-26", low: 0.19, high: 0.29 }));
  observations.push(inferLtRoeFromPublishedSpan(root, { id: "KOSPI", date: "2026-06-14", low: 0.495, high: 0.495 }));

  const xs = observations.map((row) => Math.log(1 + 100 * Math.max(row.model_forward_roe - row.median_roe, 0)));
  const ys = observations.map((row) => row.printed_lt_roe - row.median_roe);
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  const coefficient = xs.reduce((sum, x, index) => sum + (x - meanX) * (ys[index] - meanY), 0)
    / xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  const intercept = meanY - coefficient * meanX;
  const residuals = observations.map((row, index) => {
    const predicted = row.median_roe + intercept + coefficient * xs[index];
    return { id: row.id, kind: row.kind, predicted, printed: row.printed_lt_roe, residual_pp: (predicted - row.printed_lt_roe) * 100 };
  });
  return {
    fit_dates: ["2025-12-09", "2026-06-14", "2026-07-26"],
    observations,
    intercept,
    log_gap_coefficient: coefficient,
    residuals,
    max_abs_residual_pp: Math.max(...residuals.map((row) => Math.abs(row.residual_pp))),
  };
}

/**
 * Hold-out evaluation on the published 2026 upside claims. Disjoint from the
 * fit set in both date and observable: the fit uses printed LTROE axes, this
 * uses published upside percentages.
 */
export function runPublishedUpsideHoldout(root = ROOT) {
  const anchors = [
    { evidence_id: "rim-ccea4d31accf70a35d5a095e", date: "2026-07-26", id: "SPX", kind: "range", low: 0.19, high: 0.29 },
    { evidence_id: "rim-657138512272497b9d28fa5e", date: "2026-07-12", id: "SPX", kind: "floor", low: 0.14 },
    { evidence_id: "rim-00269321d964013833efea9f", date: "2026-07-12", id: "NDX", kind: "floor", low: 0.36 },
    { evidence_id: "rim-df8e2e5aa81bfca036c8b547", date: "2026-04-18", id: "NDX", kind: "floor", low: 0.30 },
    { evidence_id: "rim-8c8130ac9b05e797d4168d85", date: "2026-06-21", id: "NDX", kind: "floor", low: 0.28 },
    { evidence_id: "rim-694e999c6f76b4d205ede3c2", date: "2026-07-12", id: "CCMP", kind: "floor", low: 0.24 },
    { evidence_id: "rim-7041d3d1604bd6d9b5683c04", date: "2026-06-14", id: "KOSPI", kind: "point", low: 0.495, high: 0.495 },
  ];
  const score = (band, anchor) => (anchor.kind === "floor"
    ? band.upside.high >= anchor.low
    : band.upside.high >= anchor.low && band.upside.low <= anchor.high);
  const rows = anchors.map((anchor) => {
    const row = buildPanelIndexRow(root, anchor.id, { asOf: anchor.date });
    return {
      ...anchor,
      feno: { upside: row.feno.upside, convexity: row.feno.convexity.status, passed: score(row.feno, anchor) },
      measured_growth_diagnostic: { upside: row.measured_growth_diagnostic.upside, convexity: row.measured_growth_diagnostic.convexity.status, passed: score(row.measured_growth_diagnostic, anchor) },
      informative: anchor.kind !== "floor",
    };
  });
  const summarise = (key) => {
    const informative = rows.filter((row) => row.informative);
    return {
      passed: rows.filter((row) => row[key].passed).length,
      total: rows.length,
      informative_passed: informative.filter((row) => row[key].passed).length,
      informative_total: informative.length,
    };
  };
  return {
    rows,
    feno: summarise("feno"),
    measured_growth_diagnostic: summarise("measured_growth_diagnostic"),
    note: "floor anchors are one-sided and are passed by almost any positive band; only the two-sided rows discriminate",
  };
}

export { ROOT as ENGINE_ROOT };
