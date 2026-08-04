// Fail-closed identification helpers for Fenok RIM.
//
// This module does not change the valuation formula and cannot promote a
// publication. It proves two narrower things:
//   1. whether the frozen bracket transfers to grids whose non-scale operands
//      are printed on the same image; and
//   2. whether a candidate definition survives a genuinely later observation
//      without using inputs that became knowable after that observation.

import { rimBracket } from "./analyze-fenok-rim-identifiability.mjs";

const finitePositive = (value) => Number.isFinite(value) && value > 0;

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
  if (fixture?.schema_version !== "fenok-rim-printed-operands/v1") fail("schema_version");
  if (fixture?.model_family !== "RIM") fail("model_family");
  const instruments = Object.entries(fixture?.instruments ?? {});
  if (instruments.length < 2) fail("at least two instruments required");
  for (const [id, instrument] of instruments) {
    const artifact = fixture.artifacts?.[id];
    if (typeof artifact?.path !== "string" || !/^[a-f0-9]{64}$/.test(artifact?.sha256 ?? "")) fail(`${id} artifact`);
    if (instrument?.artifact !== artifact.path) fail(`${id} artifact link`);
    if (!finitePositive(instrument?.printed?.risk_free) || !finitePositive(instrument?.printed?.payout)) fail(`${id} printed rates`);
    if (instrument?.printed?.source !== "same_image") fail(`${id} printed source`);
    if (!Array.isArray(instrument?.grids) || instrument.grids.length !== 2) fail(`${id} grids`);
    const gridIds = new Set();
    for (const grid of instrument.grids) {
      if (typeof grid?.id !== "string" || gridIds.has(grid.id)) fail(`${id} grid id`);
      gridIds.add(grid.id);
      if (!Array.isArray(grid?.cells) || grid.cells.length !== 9) fail(`${id}/${grid.id} cells`);
      const coordinates = new Set();
      for (const cell of grid.cells) {
        if (!Number.isInteger(cell?.row) || cell.row < 0 || cell.row > 2 || !Number.isInteger(cell?.col) || cell.col < 0 || cell.col > 2) fail(`${id}/${grid.id} coordinate`);
        coordinates.add(`${cell.row}:${cell.col}`);
        if (![cell.roe, cell.erp, cell.fair_value].every(finitePositive)) fail(`${id}/${grid.id} cell values`);
        if (cell.source !== "same_image") fail(`${id}/${grid.id} cell source`);
      }
      if (coordinates.size !== 9) fail(`${id}/${grid.id} duplicate coordinate`);
    }
  }
  return fixture;
}

export function solveBookFromPrintedGrid({ cells, riskFree, payout }) {
  if (!Array.isArray(cells) || cells.length === 0) throw new Error("cells required");
  if (!finitePositive(riskFree) || !finitePositive(payout)) throw new Error("printed risk-free and payout required");
  const rows = cells.map((cell) => {
    if (![cell?.roe, cell?.erp, cell?.fair_value].every(finitePositive)) throw new Error("finite positive grid cell required");
    return {
      roe: cell.roe,
      fair: cell.fair_value,
      coefficient: rimBracket({ roe: cell.roe, rf: riskFree, premium: cell.erp, payout }),
    };
  });
  const numerator = rows.reduce((sum, row) => sum + row.coefficient * row.fair, 0);
  const denominator = rows.reduce((sum, row) => sum + row.coefficient ** 2, 0);
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
    solved_book: solvedBook,
    grid_rms: gridRms,
    max_abs_error: Math.max(...residuals.map(Math.abs)),
    residual_roe_slope: residualRoeSlope,
    residual_roe_span: residualRoeSlope * (Math.max(...roeValues) - Math.min(...roeValues)),
  };
}

function solveSharedBook(grids, riskFree, payout) {
  const cells = grids.flatMap((grid) => grid.cells);
  return solveBookFromPrintedGrid({ cells, riskFree, payout });
}

export function buildStructuralTransferReceipt(fixture, { externalBooks = {}, externalBookTolerance = 0.03 } = {}) {
  validatePrintedOperandFixture(fixture);
  const cases = [];
  const instruments = [];
  for (const [id, instrument] of Object.entries(fixture.instruments).sort(([a], [b]) => a.localeCompare(b))) {
    const solvedCases = instrument.grids.map((grid) => ({
      instrument: id,
      grid: grid.id,
      ...solveBookFromPrintedGrid({ cells: grid.cells, riskFree: instrument.printed.risk_free, payout: instrument.printed.payout }),
    }));
    cases.push(...solvedCases);
    const external = externalBooks[id] ?? null;
    const externalDiffs = external && finitePositive(external.value)
      ? solvedCases.map((row) => Math.abs(row.solved_book / external.value - 1))
      : [];
    const shared = solveSharedBook(instrument.grids, instrument.printed.risk_free, instrument.printed.payout);
    instruments.push({
      id,
      external_book: external,
      external_book_min_abs_pct: externalDiffs.length ? Math.min(...externalDiffs) : null,
      external_book_max_abs_pct: externalDiffs.length ? Math.max(...externalDiffs) : null,
      external_book_pass: externalDiffs.length > 0 && externalDiffs.every((value) => value <= externalBookTolerance),
      shared_book: shared.solved_book,
      shared_book_rms: shared.grid_rms,
      shared_book_pass: shared.grid_rms <= 0.005,
    });
  }
  const localShapePass = cases.every((row) => row.grid_rms <= 0.005 && row.max_abs_error <= 0.005);
  const blocking = [];
  if (instruments.some((row) => !row.external_book_pass)) blocking.push("external_book_basis_mismatch");
  if (instruments.some((row) => !row.shared_book_pass)) blocking.push("shared_book_across_panels_not_identified");
  blocking.push("temporal_holdout_not_run", "alternative_structures_not_profiled");
  return {
    schema_version: "fenok-rim-structural-transfer-receipt/v1",
    source_date: fixture.source_date,
    status: localShapePass ? "structural_transfer_only" : "structural_transfer_failed",
    local_shape_pass: localShapePass,
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
