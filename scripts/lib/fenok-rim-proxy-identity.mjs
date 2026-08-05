import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// A price bridge needs roughly half a year of weekly observations and must stay
// within one percent of one scale factor. Payout bases must agree within five
// percent. These are promotion gates, not statistical confidence claims.
export const DEFAULT_PROXY_IDENTITY_THRESHOLDS = Object.freeze({
  price_min_intersections: 30,
  price_max_relative_deviation: 0.01,
  payout_max_relative_divergence: 0.05,
});

const finitePositive = (value) => Number.isFinite(value) && value > 0;

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function observationMap(rows) {
  const result = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row?.date === "string" && finitePositive(row.value)) result.set(row.date, row.value);
  }
  return result;
}

export function auditPriceUnitBridge(indexRows, proxyRows, thresholds = DEFAULT_PROXY_IDENTITY_THRESHOLDS) {
  const proxyByDate = observationMap(proxyRows);
  const intersections = [];
  for (const [date, indexValue] of observationMap(indexRows)) {
    const proxyValue = proxyByDate.get(date);
    if (finitePositive(proxyValue)) intersections.push({ date, index_value: indexValue, proxy_value: proxyValue, ratio: indexValue / proxyValue });
  }
  intersections.sort((left, right) => left.date.localeCompare(right.date));
  const ratios = intersections.map((row) => row.ratio);
  if (ratios.length === 0) {
    return {
      dimension: "price_unit_bridge",
      passed: false,
      scoreable: false,
      reason: "no_exact_date_intersections",
      intersection_count: 0,
      ratio_median: null,
      coefficient_of_variation: null,
      max_relative_deviation: null,
      intersections,
    };
  }
  const ratioMedian = median(ratios);
  const ratioMean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  const standardDeviation = Math.sqrt(
    ratios.reduce((sum, value) => sum + (value - ratioMean) ** 2, 0) / ratios.length,
  );
  const coefficientOfVariation = standardDeviation / ratioMean;
  const maxRelativeDeviation = Math.max(...ratios.map((value) => Math.abs(value / ratioMedian - 1)));
  const enoughSamples = ratios.length >= thresholds.price_min_intersections;
  const stableScale = maxRelativeDeviation <= thresholds.price_max_relative_deviation;
  return {
    dimension: "price_unit_bridge",
    passed: enoughSamples && stableScale,
    scoreable: true,
    reason: !enoughSamples
      ? "insufficient_exact_date_intersections"
      : stableScale ? "stable_price_scale" : "price_scale_deviation_exceeds_gate",
    intersection_count: ratios.length,
    first_intersection_date: intersections[0].date,
    last_intersection_date: intersections.at(-1).date,
    ratio_median: ratioMedian,
    ratio_mean: ratioMean,
    coefficient_of_variation: coefficientOfVariation,
    max_relative_deviation: maxRelativeDeviation,
    threshold: {
      min_intersections: thresholds.price_min_intersections,
      max_relative_deviation: thresholds.price_max_relative_deviation,
    },
    intersections,
  };
}

export function auditBookRoeIdentity(evidence) {
  const requiredValues = [
    evidence?.target_book,
    evidence?.proxy_book,
    evidence?.target_roe,
    evidence?.proxy_roe,
  ];
  const complete = requiredValues.every(finitePositive);
  const sameBasis = typeof evidence?.basis_id === "string" && evidence.basis_id.length > 0
    && evidence.basis_id === evidence?.proxy_basis_id;
  const sameVintage = typeof evidence?.as_of === "string" && evidence.as_of === evidence?.proxy_as_of;
  const explicitlyValidated = evidence?.validated === true;
  const passed = complete && sameBasis && sameVintage && explicitlyValidated;
  return {
    dimension: "book_roe_identity",
    passed,
    scoreable: complete && sameBasis && sameVintage,
    reason: passed
      ? "validated_same_basis_book_and_roe"
      : !complete ? "book_or_roe_missing" : !sameBasis ? "book_roe_basis_mismatch_or_missing" : !sameVintage ? "book_roe_vintage_mismatch" : "independent_identity_validation_missing",
    complete,
    same_basis: sameBasis,
    same_vintage: sameVintage,
    explicitly_validated: explicitlyValidated,
    blockers: Array.isArray(evidence?.blockers) ? [...evidence.blockers] : [],
  };
}

export function auditPayoutIdentity(proxyPayout, targetPayout, thresholds = DEFAULT_PROXY_IDENTITY_THRESHOLDS) {
  if (!finitePositive(proxyPayout) || !finitePositive(targetPayout)) {
    return {
      dimension: "payout_identity",
      passed: false,
      scoreable: false,
      reason: "positive_proxy_and_target_payout_required",
      proxy_payout: finitePositive(proxyPayout) ? proxyPayout : null,
      target_payout: finitePositive(targetPayout) ? targetPayout : null,
      relative_divergence: null,
    };
  }
  // Relative to the smaller value so a 20% upward and downward gap cannot
  // produce different identity verdicts merely by swapping operands.
  const relativeDivergence = Math.abs(proxyPayout - targetPayout) / Math.min(proxyPayout, targetPayout);
  const passed = relativeDivergence <= thresholds.payout_max_relative_divergence + Number.EPSILON * 8;
  return {
    dimension: "payout_identity",
    passed,
    scoreable: true,
    reason: passed ? "payout_divergence_within_gate" : "payout_divergence_exceeds_gate",
    proxy_payout: proxyPayout,
    target_payout: targetPayout,
    relative_divergence: relativeDivergence,
    divergence_basis: "absolute_gap_divided_by_smaller_payout",
    threshold: thresholds.payout_max_relative_divergence,
  };
}

function latestAtOrBefore(rows, observationCutoff, availabilityCutoff) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => (
      typeof row?.date === "string"
      && typeof row?.available_as_of === "string"
      && row.date <= observationCutoff
      && row.available_as_of <= availabilityCutoff
      && finitePositive(row.value)
    ))
    .sort((left, right) => left.date.localeCompare(right.date))
    .at(-1) ?? null;
}

function tradingDayDistance(firstDate, secondDate, tradingDates) {
  if (!Array.isArray(tradingDates) || tradingDates.length === 0) return null;
  const low = firstDate < secondDate ? firstDate : secondDate;
  const high = firstDate < secondDate ? secondDate : firstDate;
  return new Set(tradingDates.filter((date) => typeof date === "string" && date > low && date <= high)).size;
}

export function auditHistoricalClaimIdentity({
  claim,
  targetIdentity,
  proxyIdentity,
  indexRows,
  proxyRows,
  priceBridge,
  translatedIdentityValidated = false,
  upstreamProxyGates = {},
  tradingDates = [],
}, thresholds = DEFAULT_PROXY_IDENTITY_THRESHOLDS) {
  if (
    typeof claim?.observation_at !== "string"
    || typeof claim?.available_as_of !== "string"
    || typeof claim?.asset !== "string"
  ) {
    return {
      dimension: "historical_claim_identity",
      passed: false,
      scoreable: false,
      reason: "claim_identity_observation_and_availability_required",
    };
  }
  const targetClaim = claim.asset === targetIdentity;
  const proxyClaim = claim.asset === proxyIdentity;
  const indexObservation = latestAtOrBefore(indexRows, claim.observation_at, claim.available_as_of);
  const proxyObservation = latestAtOrBefore(proxyRows, claim.observation_at, claim.available_as_of);
  const upstreamGatesPassed = ["price_unit_bridge", "book_roe_identity", "payout_identity"]
    .every((id) => upstreamProxyGates?.[id]?.passed === true);
  if (targetClaim) {
    const passed = indexObservation !== null;
    return {
      dimension: "historical_claim_identity",
      passed,
      scoreable: passed,
      reason: passed ? "target_claim_has_point_in_time_target_observation" : "point_in_time_target_observation_missing",
      claim_observation_at: claim.observation_at,
      claim_available_as_of: claim.available_as_of,
      claim_asset: claim.asset,
      target_identity: targetIdentity,
      proxy_identity: proxyIdentity,
      translated_identity_validated: false,
      upstream_proxy_gates_passed: null,
      index_observation: indexObservation,
      proxy_observation: null,
      matched_trading_day_distance: null,
      point_in_time_ratio: null,
      point_in_time_ratio_relative_deviation: null,
    };
  }
  const sameObservationDate = indexObservation?.date === proxyObservation?.date;
  const matchedTradingDayDistance = indexObservation && proxyObservation
    ? tradingDayDistance(indexObservation.date, proxyObservation.date, tradingDates)
    : null;
  const datesWithinGate = matchedTradingDayDistance !== null && matchedTradingDayDistance <= 1;
  const pointRatio = indexObservation && proxyObservation ? indexObservation.value / proxyObservation.value : null;
  const ratioDeviation = finitePositive(pointRatio) && finitePositive(priceBridge?.ratio_median)
    ? Math.abs(pointRatio / priceBridge.ratio_median - 1)
    : null;
  const pointInTimeScalePassed = datesWithinGate
    && ratioDeviation !== null
    && ratioDeviation <= thresholds.price_max_relative_deviation;
  const identityPassed = proxyClaim && translatedIdentityValidated === true;
  const passed = identityPassed && upstreamGatesPassed && pointInTimeScalePassed;
  return {
    dimension: "historical_claim_identity",
    passed,
    scoreable: passed,
    reason: !identityPassed
      ? "claim_names_proxy_without_validated_target_translation"
      : !upstreamGatesPassed ? "upstream_proxy_identity_gate_failed"
      : !indexObservation || !proxyObservation ? "point_in_time_price_missing"
        : !datesWithinGate ? "point_in_time_prices_more_than_one_trading_day_apart"
          : !pointInTimeScalePassed ? "point_in_time_ratio_outside_bridge" : "claim_identity_and_point_in_time_bridge_validated",
    claim_observation_at: claim.observation_at,
    claim_available_as_of: claim.available_as_of,
    claim_asset: claim.asset,
    target_identity: targetIdentity,
    proxy_identity: proxyIdentity,
    translated_identity_validated: translatedIdentityValidated === true,
    upstream_proxy_gates_passed: upstreamGatesPassed,
    index_observation: indexObservation,
    proxy_observation: proxyObservation,
    point_in_time_ratio: pointRatio,
    point_in_time_ratio_relative_deviation: ratioDeviation,
    same_observation_date: sameObservationDate,
    matched_trading_day_distance: matchedTradingDayDistance,
  };
}

export function auditProxyIdentity(input, thresholds = DEFAULT_PROXY_IDENTITY_THRESHOLDS) {
  const price = auditPriceUnitBridge(input.index_rows, input.proxy_rows, thresholds);
  const bookRoe = auditBookRoeIdentity(input.book_roe_evidence);
  const payout = auditPayoutIdentity(input.proxy_payout, input.target_payout, thresholds);
  const dimensions = {
    price_unit_bridge: price,
    book_roe_identity: bookRoe,
    payout_identity: payout,
    historical_claim_identity: auditHistoricalClaimIdentity({
      claim: input.historical_claim,
      targetIdentity: input.target_identity,
      proxyIdentity: input.proxy_identity,
      indexRows: input.index_rows,
      proxyRows: input.proxy_rows,
      priceBridge: price,
      translatedIdentityValidated: input.historical_claim_translation_validated,
      tradingDates: [...new Set([
        ...input.index_rows.map((row) => row.date),
        ...input.proxy_rows.map((row) => row.date),
      ])],
      upstreamProxyGates: {
        price_unit_bridge: price,
        book_roe_identity: bookRoe,
        payout_identity: payout,
      },
    }, thresholds),
  };
  return {
    schema_version: "fenok_rim_proxy_identity_audit.v1",
    target_identity: input.target_identity,
    proxy_identity: input.proxy_identity,
    passed: Object.values(dimensions).every((dimension) => dimension.passed === true),
    scoreable: Object.values(dimensions).every((dimension) => dimension.scoreable === true),
    dimensions,
  };
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function benchmarkRows(payload, section) {
  return payload.sections[section].data.map((row) => ({ date: row.date, value: row.px_last, available_as_of: row.date }));
}

function trackerRows(payload) {
  return payload.data.history_1y.map((row) => ({ date: row.date, value: row.Close, available_as_of: row.date }));
}

export function readCurrentRepoProxyIdentityInputs(root = ROOT) {
  const us = readJson(root, "data/benchmarks/us.json");
  const micro = readJson(root, "data/benchmarks/micro_sectors.json");
  const iwm = readJson(root, "data/yf/finance/IWM.json");
  const soxx = readJson(root, "data/yf/finance/SOXX.json");
  const sustainable = readJson(root, "data/computed/fenok-rim/sustainable-index-ranges.json");
  const officialRut = readJson(root, "data/computed/fenok-rim/russell2000-official-fundamentals.json");
  const fairValues = readJson(root, "data/computed/fenok-rim/fair-values.json");
  const grid = readJson(root, "scripts/fixtures/fenok-rim-2025-12-09-grid.json");
  const claims = readJson(root, "scripts/fixtures/fenok-rim-calibration-evidence.json");
  const rutRange = sustainable.rows.find((row) => row.id === "RUT");
  const soxRange = sustainable.rows.find((row) => row.id === "SOX");
  const soxFairValue = fairValues.rows.find((row) => row.key === "philadelphia_semi");
  const soxClaim = claims.claims.find((row) => row.date === "2026-06-28" && row.asset === "SOXX");

  return {
    RUT_IWM: {
      target_identity: "Russell 2000",
      proxy_identity: "IWM",
      index_rows: benchmarkRows(us, "russell2000"),
      proxy_rows: trackerRows(iwm),
      book_roe_evidence: {
        target_book: rutRange.inputs.book,
        proxy_book: grid.instruments.IWM.feed_book,
        target_roe: officialRut.derived.current_roe_ex_negative_basis,
        proxy_roe: grid.instruments.IWM.lt_roe_axis?.[1],
        basis_id: "exact_index_ex_negative",
        proxy_basis_id: null,
        as_of: officialRut.as_of,
        proxy_as_of: grid.artifacts.IWM.capture_date,
        validated: false,
        blockers: ["fixture_feed_book_missing", "unit_coherent_book_and_roe_bridge_unvalidated"],
      },
      proxy_payout: rutRange.inputs.payout,
      target_payout: officialRut.derived.payout_ex_negative_basis,
      payout_context: { target_source: "LSEG official ex-negative basis", tracker: rutRange.inputs.payout_tracker },
      historical_claim: {
        observation_at: grid.artifacts.IWM.capture_date,
        available_as_of: grid.artifacts.IWM.capture_date,
        asset: "IWM",
        evidence: grid.instrument_identity.IWM,
      },
      historical_claim_translation_validated: false,
    },
    SOX_SOXX: {
      target_identity: "PHLX Semiconductor / SOX",
      proxy_identity: "SOXX",
      index_rows: benchmarkRows(micro, "philadelphia_semi"),
      proxy_rows: trackerRows(soxx),
      book_roe_evidence: {
        target_book: soxRange.inputs.book,
        proxy_book: soxx.data.info.bookValue,
        target_roe: soxRange.inputs.panel_forward_roe,
        proxy_roe: null,
        basis_id: "nasdaq_giw_methodology_index",
        proxy_basis_id: "soxx_fund_holdings",
        as_of: soxRange.as_of,
        proxy_as_of: soxx.fetched_at?.slice(0, 10),
        validated: false,
        blockers: ["SOXX_not_PHLX", "unit_coherent_book_and_roe_bridge_unvalidated"],
      },
      proxy_payout: soxRange.inputs.payout,
      target_payout: soxFairValue.payout_basis_comparison.forward_current.value,
      payout_context: {
        target_source: "Nasdaq GIW methodology-derived current payout",
        realised_trailing_mean: soxFairValue.payout_basis_comparison.realised_trailing.mean,
        realised_trailing_reasons: soxFairValue.payout_basis_comparison.realised_trailing.reason,
        tracker: soxRange.inputs.payout_tracker,
      },
      historical_claim: soxClaim ? {
        observation_at: soxClaim.date,
        available_as_of: soxClaim.date,
        asset: soxClaim.asset,
        evidence_id: soxClaim.evidence_id,
      } : null,
      historical_claim_translation_validated: false,
    },
  };
}

export function readCurrentRepoProxyIdentityAudit(root = ROOT, thresholds = DEFAULT_PROXY_IDENTITY_THRESHOLDS) {
  const inputs = readCurrentRepoProxyIdentityInputs(root);
  return Object.fromEntries(Object.entries(inputs).map(([id, input]) => [id, auditProxyIdentity(input, thresholds)]));
}
