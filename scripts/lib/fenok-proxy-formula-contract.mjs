export const FLOW_PROXY_FORMULA_VERSION = "fenok-flow-proxies-v0.3-short-pressure-calibration";
export const OCC_OPTIONS_FORMULA_VERSION = "fenok-occ-options-volume-v0.2-volume-skew-calibration";
export const NATIVE_SIGNAL_FORMULA_VERSION = "fenok-native-signals-v0.2.3-common-basis";

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
  };
}

export function assertProxyFormulaVersion(payload, expectedVersion, sourceLabel) {
  if (payload == null) return;
  const actualVersion = payload.formula_version ?? "missing";
  if (actualVersion !== expectedVersion) {
    throw new Error(`${sourceLabel} formula_version must be ${expectedVersion}; got ${actualVersion}`);
  }
}
