export const FLOW_PROXY_FORMULA_VERSION = "fenok-flow-proxies-v0.3-short-pressure-calibration";
export const OCC_OPTIONS_FORMULA_VERSION = "fenok-occ-options-volume-v0.2-volume-skew-calibration";
export const NATIVE_SIGNAL_FORMULA_VERSION = "fenok-native-signals-v0.2.4-null-comparable";

const SHORT_TERM_COMMON_KEYS = [
  "technical_flow",
  "volume_liquidity_trend",
  "short_term_relative_strength",
];
const SUPPORTED_MARKET_SCOPES = new Set(["us", "korea", "asia"]);

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round(value, digits = 2) {
  return Number(value.toFixed(digits));
}

function unavailableShortTermComposite() {
  return {
    shortTermCommonBasisScore: null,
    shortTermCommonBasisCall: null,
    shortTermConvictionScore: null,
    shortTermConvictionCall: null,
    shortTermInputCount: null,
    shortTermBasisCode: null,
    shortTermComparableScore: null,
    shortTermComparableCall: null,
  };
}

export function shortTermConvictionCallFromScore(score) {
  if (!finite(score)) return null;
  if (score >= 70) return "concentrated";
  if (score <= 40) return "diluted";
  return "mixed";
}

export function buildShortTermConvictionComposite(signals, marketScope) {
  const normalizedMarketScope = String(marketScope ?? "").trim().toLowerCase();
  if (!SUPPORTED_MARKET_SCOPES.has(normalizedMarketScope)) return unavailableShortTermComposite();

  const commonScores = SHORT_TERM_COMMON_KEYS.map((key) => signals?.[key]?.score_0_100);
  if (!commonScores.every(finite)) return unavailableShortTermComposite();

  const shortTermCommonBasisScore = round(
    commonScores.reduce((sum, score) => sum + score, 0) / commonScores.length,
  );
  const localScores = [...commonScores];
  if (normalizedMarketScope === "us") {
    const optionsScore = signals?.net_options_proxy?.score_0_100;
    const shortPressureScore = signals?.short_pressure_proxy?.score_0_100;
    if (finite(optionsScore)) localScores.push(optionsScore);
    if (finite(shortPressureScore)) localScores.push(100 - shortPressureScore);
  }
  const shortTermConvictionScore = round(
    localScores.reduce((sum, score) => sum + score, 0) / localScores.length,
  );

  return {
    shortTermCommonBasisScore,
    shortTermCommonBasisCall: shortTermConvictionCallFromScore(shortTermCommonBasisScore),
    shortTermConvictionScore,
    shortTermConvictionCall: shortTermConvictionCallFromScore(shortTermConvictionScore),
    shortTermInputCount: localScores.length,
    shortTermBasisCode: localScores.length > commonScores.length ? "us_enriched_v1" : "common_3_v1",
    // Cross-market comparability stays fail-closed until the normalized-axis
    // producer contract is implemented and independently calibrated.
    shortTermComparableScore: null,
    shortTermComparableCall: null,
  };
}

// Long-term conviction score (장기 6축 종합): the stated aggregation for the
// LONG-TERM axis set is the plain mean of the five present axes —
// profitability, growth, upside, inverted downside pressure, and durability —
// with no weighting constants: each axis counts equally and missing axes are
// dropped, never imputed. This is the "장기 스코어" the UI shows; the
// short-term composite (buildShortTermConvictionComposite) is the "단기
// 스코어". Owner mandate 2026-08-03: the integrated single "Fenok Edge"
// score is retired; these two are the substance.
export function buildLongTermConvictionScore(signals) {
  const downsidePressure = signals?.upside_downside?.downside_score_0_100;
  const presentScores = [
    signals?.profitability?.score_0_100,
    signals?.growth?.score_0_100,
    signals?.upside_downside?.upside_score_0_100,
    finite(downsidePressure) ? 100 - downsidePressure : null,
    signals?.durability_profitability?.score_0_100,
  ].filter(finite);
  if (presentScores.length === 0) return null;
  const total = presentScores.reduce((sum, score) => sum + score, 0);
  return Math.round((total / presentScores.length) * 100) / 100;
}

export function assertProxyFormulaVersion(payload, expectedVersion, sourceLabel) {
  if (payload == null) return;
  const actualVersion = payload.formula_version ?? "missing";
  if (actualVersion !== expectedVersion) {
    throw new Error(`${sourceLabel} formula_version must be ${expectedVersion}; got ${actualVersion}`);
  }
}
