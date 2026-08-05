// Fail-closed identification helpers for Fenok RIM.
//
// This module does not change the valuation formula and cannot promote a
// publication. It proves two narrower things:
//   1. whether the frozen bracket transfers to grids whose non-scale operands
//      are printed on the same image; and
//   2. whether a candidate definition survives a genuinely later observation
//      without using inputs that became knowable after that observation.

import { rimBracket } from "./analyze-fenok-rim-identifiability.mjs";
import { isSha256 } from "./lib/fenok-rim-calibration-receipt.mjs";

const finitePositive = (value) => Number.isFinite(value) && value > 0;

export function compareCalibrationReceiptIdentity(committed, rebuilt) {
  for (const [label, receipt] of [["committed", committed], ["rebuilt", rebuilt]]) {
    if (receipt?.schema_version !== "fenok-rim-calibration-receipt/v1") {
      throw new Error(`${label} calibration receipt schema mismatch`);
    }
    for (const field of ["receipt_sha256", "measurement_receipt_sha256", "source_snapshot_sha256", "proxy_decision_sha256", "parameter_sha256"]) {
      if (!isSha256(receipt[field])) throw new Error(`${label} calibration receipt ${field} invalid`);
    }
    if (typeof receipt.algorithm?.id !== "string" || typeof receipt.algorithm?.version !== "string"
      || !isSha256(receipt.algorithm?.source_sha256)) {
      throw new Error(`${label} calibration receipt algorithm identity invalid`);
    }
  }
  return {
    semantic_identity_equal: committed.receipt_sha256 === rebuilt.receipt_sha256,
    measurement_identity_equal: committed.measurement_receipt_sha256 === rebuilt.measurement_receipt_sha256,
    source_snapshot_equal: committed.source_snapshot_sha256 === rebuilt.source_snapshot_sha256,
  };
}

function instant(value, label) {
  const match = typeof value === "string"
    ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/)
    : null;
  if (!match) {
    throw new Error(`${label} must be an ISO timestamp with timezone`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  if (zone !== "Z") {
    const offsetHours = Number(zone.slice(1, 3));
    const offsetMinutes = Number(zone.slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) {
      throw new Error(`${label} must have a valid timezone offset`);
    }
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${label} must be a valid timestamp`);
  return ms;
}

function sha256(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} must be a lowercase sha256`);
  }
  return value;
}

function predictionVintage(prediction, label) {
  if (!Array.isArray(prediction?.dependencies) || prediction.dependencies.length === 0) {
    return { rejected: "missing_dependency_receipt" };
  }
  const dependencyIds = new Set();
  let available = -Infinity;
  let firstSeen = -Infinity;
  try {
    sha256(prediction.content_sha256, `${label} content_sha256`);
    for (const dependency of prediction.dependencies) {
      if (typeof dependency?.id !== "string" || !dependency.id || dependencyIds.has(dependency.id)) {
        return { rejected: "invalid_dependency_receipt" };
      }
      dependencyIds.add(dependency.id);
      sha256(dependency.content_sha256, `${label}/${dependency.id} content_sha256`);
      available = Math.max(available, instant(dependency.available_as_of, `${label}/${dependency.id} available_as_of`));
      firstSeen = Math.max(firstSeen, instant(dependency.first_seen_at, `${label}/${dependency.id} first_seen_at`));
    }
    const declaredAvailable = instant(prediction.available_as_of, `${label} available_as_of`);
    const declaredFirstSeen = instant(prediction.first_seen_at, `${label} first_seen_at`);
    if (declaredAvailable !== available || declaredFirstSeen !== firstSeen) {
      return { rejected: "dependency_vintage_mismatch" };
    }
  } catch {
    return { rejected: "invalid_dependency_receipt" };
  }
  return { available, firstSeen };
}

export function validatePrintedOperandFixture(fixture) {
  const fail = (message) => { throw new Error(`printed-operand fixture invalid: ${message}`); };
  if (fixture?.schema_version !== "fenok-rim-printed-operands/v2") fail("schema_version");
  if (fixture?.model_family !== "RIM") fail("model_family");
  const instruments = Object.entries(fixture?.instruments ?? {});
  if (instruments.length < 2) fail("at least two instruments required");
  for (const [id, instrument] of instruments) {
    const artifact = fixture.artifacts?.[id];
    if (typeof artifact?.path !== "string" || !/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? "")) fail(`${id} artifact`);
    if (instrument?.artifact !== artifact.path) fail(`${id} artifact link`);
    if (!finitePositive(instrument?.printed?.risk_free) || !finitePositive(instrument?.printed?.payout)) fail(`${id} printed rates`);
    if (!finitePositive(instrument?.printed?.payout_display_resolution)) fail(`${id} printed payout display resolution`);
    if (!finitePositive(instrument?.printed?.roe_display_resolution)) fail(`${id} printed ROE display resolution`);
    if (!finitePositive(instrument?.printed?.last_price)) fail(`${id} printed last price`);
    if (instrument?.printed?.source !== "same_image") fail(`${id} printed source`);
    const path = instrument?.printed?.forecast_path;
    if (!Array.isArray(path) || path.length < 4) fail(`${id} printed forecast path`);
    if (!path.some((row) => row.year === instrument.printed.latest_actual_year && row.estimate === false)) fail(`${id} latest actual year`);
    if (!path.every((row) => typeof row.year === "string" && typeof row.estimate === "boolean"
      && [row.net_income, row.total_equity, row.roe, row.pbr].every(finitePositive))) fail(`${id} forecast path values`);
    if (!Array.isArray(instrument?.grids) || instrument.grids.length !== 2) fail(`${id} grids`);
    const gridIds = new Set();
    for (const grid of instrument.grids) {
      if (typeof grid?.id !== "string" || gridIds.has(grid.id)) fail(`${id} grid id`);
      gridIds.add(grid.id);
      if (!Array.isArray(grid?.cells) || grid.cells.length !== 9) fail(`${id}/${grid.id} cells`);
      if (!finitePositive(grid?.printed_fair_value)) fail(`${id}/${grid.id} printed fair value`);
      const coordinates = new Set();
      for (const cell of grid.cells) {
        if (!Number.isInteger(cell?.row) || cell.row < 0 || cell.row > 2 || !Number.isInteger(cell?.col) || cell.col < 0 || cell.col > 2) fail(`${id}/${grid.id} coordinate`);
        coordinates.add(`${cell.row}:${cell.col}`);
        if (![cell.roe, cell.erp, cell.fair_value].every(finitePositive)) fail(`${id}/${grid.id} cell values`);
        if (cell.source !== "same_image") fail(`${id}/${grid.id} cell source`);
      }
      if (coordinates.size !== 9) fail(`${id}/${grid.id} duplicate coordinate`);
      const roundedMean = Math.round(grid.cells.reduce((sum, cell) => sum + cell.fair_value, 0) / grid.cells.length);
      if (roundedMean !== grid.printed_fair_value) fail(`${id}/${grid.id} panel fair-value checksum`);
    }
  }
  return fixture;
}

export function solveBookFromPrintedGrid({ cells, riskFree, payout }) {
  if (!Array.isArray(cells) || cells.length === 0) throw new Error("cells required");
  if (!finitePositive(riskFree) || !Number.isFinite(payout) || payout < 0 || payout > 1) throw new Error("risk-free rate and payout in [0,1] required");
  const rows = cells.map((cell) => {
    if (![cell?.roe, cell?.erp, cell?.fair_value].every(finitePositive)) throw new Error("finite positive grid cell required");
    return {
      roe: cell.roe,
      fair: cell.fair_value,
      coefficient: rimBracket({ roe: cell.roe, rf: riskFree, premium: cell.erp, payout }),
    };
  });
  const numerator = rows.reduce((sum, row) => sum + row.coefficient / row.fair, 0);
  const denominator = rows.reduce((sum, row) => sum + (row.coefficient / row.fair) ** 2, 0);
  const solvedBook = numerator / denominator;
  const residuals = rows.map((row) => solvedBook * row.coefficient / row.fair - 1);
  const gridRms = Math.sqrt(residuals.reduce((sum, value) => sum + value ** 2, 0) / residuals.length);
  const meanRoe = rows.reduce((sum, row) => sum + row.roe, 0) / rows.length;
  const meanResidual = residuals.reduce((sum, value) => sum + value, 0) / residuals.length;
  const slopeDenominator = rows.reduce((sum, row) => sum + (row.roe - meanRoe) ** 2, 0);
  const residualRoeSlope = slopeDenominator === 0 ? 0 : rows.reduce(
    (sum, row, index) => sum + (row.roe - meanRoe) * (residuals[index] - meanResidual),
    0,
  ) / slopeDenominator;
  const roeValues = rows.map((row) => row.roe);
  return {
    cells: rows.length,
    fit_objective: "relative_rms",
    solved_book: solvedBook,
    grid_rms: gridRms,
    max_abs_error: Math.max(...residuals.map(Math.abs)),
    residual_roe_slope: residualRoeSlope,
    residual_roe_span: residualRoeSlope * (Math.max(...roeValues) - Math.min(...roeValues)),
  };
}

export function solveZeroResidualRoeSlopePayout({ cells, riskFree }) {
  const slopeAt = (payout) => solveBookFromPrintedGrid({ cells, riskFree, payout }).residual_roe_slope;
  const brackets = [];
  const scanSteps = 4096;
  let left = 0;
  let leftSlope = slopeAt(left);
  for (let step = 1; step <= scanSteps; step += 1) {
    const right = step / scanSteps;
    const rightSlope = slopeAt(right);
    if (leftSlope === 0) brackets.push([left, left]);
    else if (rightSlope === 0 || Math.sign(leftSlope) !== Math.sign(rightSlope)) brackets.push([left, right]);
    left = right;
    leftSlope = rightSlope;
  }
  const unique = brackets.filter((bracket, index) => (
    index === 0 || bracket[0] !== brackets[index - 1][1] || bracket[0] !== bracket[1]
  ));
  if (unique.length !== 1) throw new Error(`expected one zero residual-ROE slope payout, found ${unique.length}`);
  let [lo, hi] = unique[0];
  if (lo === hi) return lo;
  let loSlope = slopeAt(lo);
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const mid = (lo + hi) / 2;
    const midSlope = slopeAt(mid);
    if (midSlope === 0) return mid;
    if (Math.sign(loSlope) === Math.sign(midSlope)) {
      lo = mid;
      loSlope = midSlope;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export function findPrintedRoeRoundingWitness({ cells, riskFree, payout, roeDisplayResolution }) {
  if (!Array.isArray(cells) || cells.length !== 9 || !finitePositive(roeDisplayResolution)) {
    throw new Error("nine cells and positive ROE display resolution required");
  }
  const printedRows = [0, 1, 2].map((row) => {
    const values = [...new Set(cells.filter((cell) => cell.row === row).map((cell) => cell.roe))];
    if (values.length !== 1) throw new Error(`ROE row ${row} must have one printed value`);
    return values[0];
  });
  if (!(printedRows[0] < printedRows[1] && printedRows[1] < printedRows[2])) {
    throw new Error("printed ROE rows must be strictly increasing");
  }
  const adjustedCells = (shift) => cells.map((cell) => ({
    ...cell,
    roe: cell.row === 0 ? cell.roe + shift : cell.row === 2 ? cell.roe - shift : cell.roe,
  }));
  const evaluate = (shift) => solveBookFromPrintedGrid({ cells: adjustedCells(shift), riskFree, payout });
  const halfResolution = roeDisplayResolution / 2;
  let lo = 0;
  let hi = halfResolution;
  let loResult = evaluate(lo);
  const hiResult = evaluate(hi);
  if (!Number.isFinite(loResult.residual_roe_slope) || !Number.isFinite(hiResult.residual_roe_slope)) {
    throw new Error("non-finite ROE-rounding endpoint slope");
  }
  if (loResult.residual_roe_slope !== 0 && Math.sign(loResult.residual_roe_slope) === Math.sign(hiResult.residual_roe_slope)) {
    return {
      found: false,
      path: "lower_row_plus_t_middle_fixed_upper_row_minus_t",
      shift_interval: [0, halfResolution],
      endpoint_slopes: [loResult.residual_roe_slope, hiResult.residual_roe_slope],
    };
  }
  if (loResult.residual_roe_slope !== 0) {
    for (let iteration = 0; iteration < 100; iteration += 1) {
      const mid = (lo + hi) / 2;
      const midResult = evaluate(mid);
      if (Math.sign(loResult.residual_roe_slope) === Math.sign(midResult.residual_roe_slope)) {
        lo = mid;
        loResult = midResult;
      } else {
        hi = mid;
      }
    }
  }
  const shift = loResult.residual_roe_slope === 0 ? lo : (lo + hi) / 2;
  const result = evaluate(shift);
  const adjustedRows = [printedRows[0] + shift, printedRows[1], printedRows[2] - shift];
  if (!(adjustedRows[0] < adjustedRows[1] && adjustedRows[1] < adjustedRows[2])) {
    throw new Error("ROE-rounding witness breaks row order");
  }
  if (Math.abs(result.residual_roe_slope) > 1e-12) throw new Error("ROE-rounding witness slope exceeds tolerance");
  return {
    found: true,
    scope: "within_panel_only",
    path: "lower_row_plus_t_middle_fixed_upper_row_minus_t",
    shift_interval: [0, halfResolution],
    endpoint_slopes: [evaluate(0).residual_roe_slope, hiResult.residual_roe_slope],
    shift,
    bound_saturated: Math.abs(shift - halfResolution) <= 1e-12,
    adjusted_roes: adjustedRows,
    solved_book: result.solved_book,
    grid_rms: result.grid_rms,
    max_abs_error: result.max_abs_error,
    residual_roe_slope: result.residual_roe_slope,
    residual_roe_span: result.residual_roe_span,
  };
}

function solveSharedBook(grids, riskFree, payout) {
  const cells = grids.flatMap((grid) => grid.cells);
  return solveBookFromPrintedGrid({ cells, riskFree, payout });
}

function printedAccountingDiagnostics(instrument) {
  const path = instrument.printed.forecast_path;
  const actual = path.find((row) => row.year === instrument.printed.latest_actual_year && row.estimate === false);
  const rollForward = [];
  for (let index = path.indexOf(actual) + 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const predicted = previous.total_equity + current.net_income * (1 - instrument.printed.payout);
    rollForward.push({
      from: previous.year,
      to: current.year,
      printed_total_equity: current.total_equity,
      predicted_total_equity: predicted,
      relative_error: predicted / current.total_equity - 1,
    });
  }
  return {
    same_sheet_book_basis: {
      method: "last_price_divided_by_latest_actual_pbr",
      period: actual.year,
      last_price: instrument.printed.last_price,
      pbr: actual.pbr,
      book_per_share: instrument.printed.last_price / actual.pbr,
      independent_validation: false,
      limitation: "PBR-derived book is same-sheet and reproducible but circular as an independent book validation.",
    },
    printed_book_roll_forward: {
      equation: "B_t = B_(t-1) + NI_t * (1 - payout)",
      source: "same_image_printed_intermediates",
      identified_scope: "forecast_accounting_path_only_not_rim_B0_mapping",
      rows: rollForward,
      max_abs_relative_error: Math.max(...rollForward.map((row) => Math.abs(row.relative_error))),
    },
  };
}

function rowValues(grid) {
  return [0, 1, 2].map((row) => {
    const values = [...new Set(grid.cells.filter((cell) => cell.row === row).map((cell) => cell.roe))];
    if (values.length !== 1) throw new Error(`${grid.id}: each printed row needs one ROE`);
    return values[0];
  });
}

function adjustedGrids(grids, shifts) {
  return grids.map((grid, gridIndex) => ({
    ...grid,
    cells: grid.cells.map((cell) => ({ ...cell, roe: cell.roe + shifts[gridIndex * 3 + cell.row] })),
  }));
}

function minimizeCoordinate(fn, lo, hi) {
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - ratio * (b - a);
  let d = a + ratio * (b - a);
  let fc = fn(c);
  let fd = fn(d);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    if (fc <= fd) {
      b = d; d = c; fd = fc; c = b - ratio * (b - a); fc = fn(c);
    } else {
      a = c; c = d; fc = fd; d = a + ratio * (b - a); fd = fn(d);
    }
  }
  return [lo, hi, (a + b) / 2].map((value) => ({ value, score: fn(value) }))
    .sort((left, right) => left.score - right.score)[0];
}

export function profileSharedBookUnderPrintedRoeRounding({ grids, riskFree, payout, roeDisplayResolution }) {
  if (!Array.isArray(grids) || grids.length !== 2 || !finitePositive(roeDisplayResolution)) {
    throw new Error("two grids and positive ROE display resolution required");
  }
  const printedRows = grids.flatMap(rowValues);
  const half = roeDisplayResolution / 2;
  const dimensionCount = printedRows.length;
  const evaluate = (shifts) => solveSharedBook(adjustedGrids(grids, shifts), riskFree, payout);
  const seeds = [Array(dimensionCount).fill(0)];
  for (let mask = 0; mask < 2 ** dimensionCount; mask += 1) {
    seeds.push(Array.from({ length: dimensionCount }, (_, index) => (mask & (1 << index) ? half : -half)));
  }
  let best = null;
  for (const seed of seeds) {
    const shifts = [...seed];
    for (let sweep = 0; sweep < 20; sweep += 1) {
      let changed = false;
      for (let dimension = 0; dimension < dimensionCount; dimension += 1) {
        const before = shifts[dimension];
        const optimum = minimizeCoordinate((value) => {
          const candidate = [...shifts];
          candidate[dimension] = value;
          return evaluate(candidate).grid_rms;
        }, -half, half);
        shifts[dimension] = optimum.value;
        if (Math.abs(before - optimum.value) > 1e-14) changed = true;
      }
      if (!changed) break;
    }
    const solved = evaluate(shifts);
    if (!best || solved.grid_rms < best.solved.grid_rms) best = { shifts: [...shifts], solved };
  }
  const saturationTolerance = 1e-10;
  const saturated = best.shifts.map((shift) => Math.abs(Math.abs(shift) - half) <= saturationTolerance);
  return {
    search_method: "deterministic_multistart_bounded_coordinate_minimization",
    optimization_status: "numerical_diagnostic_not_global_proof",
    shift_interval: [-half, half],
    printed_roes: printedRows,
    adjusted_roes: printedRows.map((value, index) => value + best.shifts[index]),
    shifts: best.shifts,
    bound_saturated: saturated,
    saturated_count: saturated.filter(Boolean).length,
    gate: { metric: "relative_rms", threshold: 0.005, value: best.solved.grid_rms, passed: best.solved.grid_rms <= 0.005 },
    solved_book: best.solved.solved_book,
    max_abs_error: best.solved.max_abs_error,
  };
}

export function buildStructuralTransferReceipt(fixture, { externalBooks = {}, externalBookTolerance = 0.03 } = {}) {
  validatePrintedOperandFixture(fixture);
  const cases = [];
  const instruments = [];
  for (const [id, instrument] of Object.entries(fixture.instruments).sort(([a], [b]) => a.localeCompare(b))) {
    const solvedCases = instrument.grids.map((grid) => {
      const solved = solveBookFromPrintedGrid({ cells: grid.cells, riskFree: instrument.printed.risk_free, payout: instrument.printed.payout });
      const zeroSlopePayout = solveZeroResidualRoeSlopePayout({ cells: grid.cells, riskFree: instrument.printed.risk_free });
      const payoutGap = zeroSlopePayout - instrument.printed.payout;
      const roundingWitness = findPrintedRoeRoundingWitness({
        cells: grid.cells,
        riskFree: instrument.printed.risk_free,
        payout: instrument.printed.payout,
        roeDisplayResolution: instrument.printed.roe_display_resolution,
      });
      return {
        instrument: id,
        grid: grid.id,
        diagnostic_scope: "within_panel_only",
        printed_payout: instrument.printed.payout,
        printed_payout_display_resolution: instrument.printed.payout_display_resolution,
        payout_zero_residual_roe_slope: zeroSlopePayout,
        printed_to_zero_slope_payout_gap: payoutGap,
        exact_printed_input_structural_conflict: Math.abs(payoutGap) > instrument.printed.payout_display_resolution / 2,
        printed_roe_rounding_zero_slope_witness: roundingWitness,
        ...solved,
      };
    });
    cases.push(...solvedCases);
    const external = externalBooks[id] ?? null;
    const externalDiffs = external && finitePositive(external.value)
      ? solvedCases.map((row) => Math.abs(row.solved_book / external.value - 1))
      : [];
    const shared = solveSharedBook(instrument.grids, instrument.printed.risk_free, instrument.printed.payout);
    const roundedShared = profileSharedBookUnderPrintedRoeRounding({
      grids: instrument.grids,
      riskFree: instrument.printed.risk_free,
      payout: instrument.printed.payout,
      roeDisplayResolution: instrument.printed.roe_display_resolution,
    });
    const panelBooks = solvedCases.map((row) => row.solved_book);
    const accounting = printedAccountingDiagnostics(instrument);
    const sameSheetToExternal = external && finitePositive(external.value)
      ? accounting.same_sheet_book_basis.book_per_share / external.value - 1
      : null;
    instruments.push({
      id,
      ...accounting,
      external_book_cross_check: {
        source: external,
        same_sheet_to_external_relative_difference: sameSheetToExternal,
        comparison_status: "diagnostic_mixed_basis_not_a_promotion_gate",
      },
      legacy_panel_fit_to_external_min_abs_pct: externalDiffs.length ? Math.min(...externalDiffs) : null,
      legacy_panel_fit_to_external_max_abs_pct: externalDiffs.length ? Math.max(...externalDiffs) : null,
      cross_panel_exact_book_equality: {
        panel_books: panelBooks,
        max_relative_difference: Math.max(...panelBooks) / Math.min(...panelBooks) - 1,
        equal: Math.max(...panelBooks) / Math.min(...panelBooks) - 1 <= 1e-12,
      },
      cross_panel_relative_rms_gate: {
        fit_objective: shared.fit_objective,
        exact_printed_roes: { solved_book: shared.solved_book, relative_rms: shared.grid_rms, threshold: 0.005, passed: shared.grid_rms <= 0.005 },
        printed_roe_rounding_profile: roundedShared,
        clean_pass: roundedShared.gate.passed && roundedShared.saturated_count === 0,
      },
    });
  }
  const localShapePass = cases.every((row) => row.grid_rms <= 0.005 && row.max_abs_error <= 0.005);
  const blocking = [];
  if (instruments.some((row) => !row.cross_panel_exact_book_equality.equal)) blocking.push("exact_cross_panel_book_equality_fails");
  if (instruments.some((row) => !row.cross_panel_relative_rms_gate.printed_roe_rounding_profile.gate.passed)) blocking.push("rounded_cross_panel_shared_book_gate_fails");
  if (instruments.some((row) => row.cross_panel_relative_rms_gate.printed_roe_rounding_profile.gate.passed
    && row.cross_panel_relative_rms_gate.printed_roe_rounding_profile.saturated_count > 0)) blocking.push("rounded_shared_book_gate_pass_is_boundary_saturated");
  if (cases.some((row) => row.exact_printed_input_structural_conflict)) blocking.push("printed_payout_residual_roe_conflict");
  if (cases.some((row) => row.printed_roe_rounding_zero_slope_witness.found)) blocking.push("printed_roe_rounding_can_remove_slope");
  blocking.push("same_sheet_book_basis_is_pbr_derived_not_independent", "temporal_holdout_not_run", "alternative_structures_not_profiled");
  return {
    schema_version: "fenok-rim-structural-transfer-receipt/v2",
    source_date: fixture.source_date,
    status: localShapePass ? "structural_transfer_only" : "structural_transfer_failed",
    local_shape_pass: localShapePass,
    exact_printed_input_structural_conflict: cases.some((row) => row.exact_printed_input_structural_conflict),
    structural_conflict_scope: "within_panel_slope_exact_cross_panel_equality_and_gate_level_shared_book_are_separate_diagnostics_component_or_form_not_identified",
    display_rounding_robust: !cases.some((row) => row.printed_roe_rounding_zero_slope_witness.found),
    printed_roe_rounding_can_remove_conflict: cases.some((row) => row.printed_roe_rounding_zero_slope_witness.found),
    same_sheet_payout_count: Object.keys(fixture.instruments).length,
    production_identified: false,
    cases,
    instruments,
    blocking_reasons: [...new Set(blocking)].sort(),
  };
}

function validateTarget(observation) {
  if (!observation || typeof observation.evidence_id !== "string") throw new Error("evidence_id required");
  instant(observation.observation_at, `${observation.evidence_id} observation_at`);
  if (!["point", "range", "floor"].includes(observation.type)) throw new Error(`${observation.evidence_id} type`);
  if (observation.type === "range") {
    if (!Array.isArray(observation.target) || observation.target.length !== 2 || !observation.target.every(finitePositive) || observation.target[0] > observation.target[1]) throw new Error(`${observation.evidence_id} range`);
  } else if (!finitePositive(observation.target)) {
    throw new Error(`${observation.evidence_id} target`);
  }
}

function scoreRows(observations, candidate) {
  const boundedErrors = [];
  let boundedHits = 0;
  let floorCount = 0;
  let floorViolations = 0;
  for (const observation of observations) {
    const prediction = candidate.predictions?.[observation.evidence_id];
    if (!prediction || !finitePositive(prediction.value)) return { rejected: "missing_prediction" };
    const vintage = predictionVintage(prediction, `${candidate.id}/${observation.evidence_id}`);
    if (vintage.rejected) return vintage;
    const { available, firstSeen } = vintage;
    const observed = instant(observation.observation_at, `${observation.evidence_id} observation_at`);
    if (available > observed || firstSeen > observed) return { rejected: "temporal_leakage" };
    if (observation.type === "floor") {
      floorCount += 1;
      if (prediction.value < observation.target) floorViolations += 1;
      continue;
    }
    let error = 0;
    if (observation.type === "point") {
      error = Math.abs(Math.log(prediction.value / observation.target));
    } else if (prediction.value < observation.target[0]) {
      error = Math.abs(Math.log(prediction.value / observation.target[0]));
    } else if (prediction.value > observation.target[1]) {
      error = Math.abs(Math.log(prediction.value / observation.target[1]));
    }
    boundedErrors.push(error);
    if (error === 0) boundedHits += 1;
  }
  return {
    bounded_count: boundedErrors.length,
    bounded_hits: boundedHits,
    bounded_mae: boundedErrors.length ? boundedErrors.reduce((sum, value) => sum + value, 0) / boundedErrors.length : null,
    floor_count: floorCount,
    floor_violations: floorViolations,
  };
}

function selectedCandidateReceipt(candidate, observations) {
  if (!candidate) return null;
  return {
    id: candidate.id,
    definition_sha256: candidate.definition_sha256,
    frozen_at: candidate.frozen_at,
    prediction_receipts: observations.map((observation) => {
      const prediction = candidate.predictions[observation.evidence_id];
      if (!prediction) return { evidence_id: observation.evidence_id, missing: true };
      const dependenciesValid = Array.isArray(prediction.dependencies)
        && prediction.dependencies.length > 0
        && prediction.dependencies.every((dependency) => dependency && typeof dependency.id === "string" && dependency.id);
      return {
        evidence_id: observation.evidence_id,
        value: prediction.value,
        content_sha256: prediction.content_sha256,
        available_as_of: prediction.available_as_of,
        first_seen_at: prediction.first_seen_at,
        dependencies: dependenciesValid
          ? [...prediction.dependencies].sort((a, b) => a.id.localeCompare(b.id))
          : [],
        dependency_receipt_missing: !Array.isArray(prediction.dependencies) || prediction.dependencies.length === 0,
        dependency_receipt_invalid: Array.isArray(prediction.dependencies) && !dependenciesValid,
      };
    }).sort((a, b) => a.evidence_id.localeCompare(b.evidence_id)),
  };
}

export function buildTemporalReceipt({ observations, candidates, cutoff, boundedHoldoutThreshold = 0.05, minimumBoundedHoldout = 1 }) {
  const cutoffMs = instant(cutoff, "cutoff");
  const sortedObservations = [...observations].sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  sortedObservations.forEach(validateTarget);
  if (new Set(sortedObservations.map((row) => row.evidence_id)).size !== sortedObservations.length) {
    throw new Error("duplicate evidence_id");
  }
  if (new Set(candidates.map((candidate) => candidate?.id)).size !== candidates.length) {
    throw new Error("duplicate candidate id");
  }
  const eligible = sortedObservations.filter((row) => row.model_family === "RIM" && row.identity_status === "verified");
  const unscoreable = sortedObservations.filter((row) => !eligible.includes(row)).map((row) => row.evidence_id);
  const fit = eligible.filter((row) => instant(row.observation_at, `${row.evidence_id} observation_at`) <= cutoffMs);
  const holdout = eligible.filter((row) => instant(row.observation_at, `${row.evidence_id} observation_at`) > cutoffMs);
  const accepted = [];
  const rejected = [];
  for (const candidate of [...candidates].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!candidate || typeof candidate.id !== "string") throw new Error("candidate id required");
    sha256(candidate.definition_sha256, `${candidate.id} definition_sha256`);
    if (instant(candidate.frozen_at, `${candidate.id} frozen_at`) > cutoffMs) {
      rejected.push({ id: candidate.id, reason: "candidate_not_frozen_before_holdout" });
      continue;
    }
    const fitScore = scoreRows(fit, candidate);
    if (fitScore.rejected) {
      rejected.push({ id: candidate.id, reason: fitScore.rejected });
      continue;
    }
    if (fitScore.floor_violations > 0 || fitScore.bounded_count === 0) {
      rejected.push({ id: candidate.id, reason: fitScore.floor_violations > 0 ? "fit_floor_violation" : "no_bounded_fit" });
      continue;
    }
    accepted.push({ candidate, fit: fitScore });
  }
  accepted.sort((a, b) => a.fit.bounded_mae - b.fit.bounded_mae || b.fit.bounded_hits - a.fit.bounded_hits || a.candidate.id.localeCompare(b.candidate.id));
  const winner = accepted[0] ?? null;
  const holdoutScore = winner ? scoreRows(holdout, winner.candidate) : null;
  const blocking = [];
  if (!winner) blocking.push("no_admissible_fit_candidate");
  if (holdoutScore?.rejected) blocking.push(holdoutScore.rejected);
  if (!holdoutScore || holdoutScore.bounded_count < minimumBoundedHoldout) blocking.push("insufficient_bounded_holdout");
  if (unscoreable.some((id) => {
    const row = sortedObservations.find((observation) => observation.evidence_id === id);
    return row && instant(row.observation_at, `${id} observation_at`) > cutoffMs;
  })) blocking.push("unscoreable_holdout_evidence");
  const holdoutPassed = Boolean(
    holdoutScore
    && !holdoutScore.rejected
    && holdoutScore.bounded_count >= minimumBoundedHoldout
    && holdoutScore.floor_violations === 0
    && holdoutScore.bounded_mae <= boundedHoldoutThreshold,
  );
  const status = blocking.length ? "blocked" : holdoutPassed ? "passed" : "failed";
  return {
    schema_version: "fenok-rim-temporal-identification-receipt/v1",
    cutoff,
    selected_candidate_id: winner?.candidate.id ?? null,
    selected_candidate: selectedCandidateReceipt(winner?.candidate ?? null, [...fit, ...holdout]),
    fit_evidence_ids: fit.map((row) => row.evidence_id).sort(),
    holdout_evidence_ids: holdout.map((row) => row.evidence_id).sort(),
    unscoreable_evidence_ids: unscoreable.sort(),
    rejected_candidates: rejected.sort((a, b) => a.id.localeCompare(b.id)),
    fit: winner?.fit ?? null,
    holdout: holdoutScore && !holdoutScore.rejected ? { ...holdoutScore, passed: holdoutPassed } : null,
    bounded_holdout_threshold: boundedHoldoutThreshold,
    status,
    passed: status === "passed",
    blocking_reasons: [...new Set(blocking)].sort(),
  };
}
