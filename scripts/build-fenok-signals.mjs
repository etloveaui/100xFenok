import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const FORMULA_VERSION = "fenok-native-signals-v0.2.1-phase-b";
const CONTRACT_DOC = "docs/planning/CONTRACT_fenok_native_signals_v0_2_phase_a_20260628.md";
const PUBLIC_SURFACE_STATUS = "phase_b_v0_2_stock_signal_lens_approved_summary_public";
const SOURCE_FILE = "computed/stock_action_index.json";
const OUTPUT_FILE = "computed/fenok_signals.json";
const SUMMARY_OUTPUT_FILE = "computed/fenok_signals_summary.json";
const STOCKANALYSIS_FINANCIALS_DIR = "stockanalysis/financials";
const OCC_OPTIONS_VOLUME_FILE = "computed/fenok_occ_options_volume.json";
const NATIVE_SIGNAL_KEYS = ["profitability", "growth", "technical_flow", "upside_downside", "market_similarity"];
const PHASE_A_SIGNAL_KEYS = ["durability_profitability"];
const PHASE_B_SIGNAL_KEYS = [
  "volume_liquidity_trend",
  "short_term_relative_strength",
  "net_options_proxy",
  "off_exchange_activity_proxy",
  "short_pressure_proxy",
];
const CONVICTION_SIGNAL_KEYS = ["profitability", "growth", "technical_flow", "upside_downside"];

const HORIZON_WEIGHTS = [
  ["fy1", 0.5],
  ["fy2", 0.3],
  ["fy3", 0.2],
];

const SECTOR_DURABILITY_CAPS = {
  Technology: { grossMargin: 100, operatingMargin: 60, roe: 70, roic: 70, fcfMargin: 55 },
  Healthcare: { grossMargin: 65, operatingMargin: 30, roe: 35, roic: 35, fcfMargin: 12 },
  Industrials: { grossMargin: 70, operatingMargin: 40, roe: 45, roic: 45, fcfMargin: 25 },
  default: { grossMargin: 75, operatingMargin: 40, roe: 45, roic: 45, fcfMargin: 25 },
};

function readJson(relPath) {
  return JSON.parse(fs.readFileSync(path.join(dataRoot, relPath), "utf8"));
}

function readOptionalJson(relPath) {
  const abs = path.join(dataRoot, relPath);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function readFinancialsByTicker(tickers) {
  return new Map(
    tickers.map((ticker) => [
      ticker,
      readOptionalJson(path.join(STOCKANALYSIS_FINANCIALS_DIR, `${ticker}.json`)),
    ]),
  );
}

function readFlowProxiesByTicker() {
  const flow = readOptionalJson("computed/fenok_flow_proxies.json");
  const rows = Array.isArray(flow?.rows) ? flow.rows : [];
  return new Map(rows.map((row) => [String(row.ticker ?? "").toUpperCase(), row]));
}

function readOccOptionsByTicker() {
  const payload = readOptionalJson(OCC_OPTIONS_VOLUME_FILE);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return new Map(rows.map((row) => [String(row.ticker ?? "").toUpperCase(), row]));
}

function ensureDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function writeJson(relPath, payload, roots, options = {}) {
  const indent = options.compact ? 0 : 2;
  const body = `${JSON.stringify(payload, null, indent)}\n`;
  for (const root of roots) {
    const abs = path.join(root, relPath);
    ensureDir(abs);
    fs.writeFileSync(abs, body, "utf8");
  }
}

function writeJsonToRoot(relPath, payload, options = {}) {
  writeJson(relPath, payload, [dataRoot], options);
}

function writeJsonToBoth(relPath, payload, options = {}) {
  writeJson(relPath, payload, [dataRoot, publicDataRoot], options);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function num(value) {
  return finite(value) ? value : null;
}

function round(value, digits = 4) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function loadPriceHistory(ticker) {
  const payload = readOptionalJson(`yf/finance/${ticker}.json`);
  const history = payload?.data?.history_1y;
  if (!Array.isArray(history)) return [];
  return history
    .map((row) => ({
      date: row.date,
      close: num(row.Close ?? row.close),
      volume: num(row.Volume ?? row.volume),
    }))
    .filter((row) => row.date && finite(row.close) && row.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function loadSpotQuote(ticker) {
  const payload = readOptionalJson(`yf/finance/${ticker}.json`);
  const info = payload?.data?.info ?? {};
  const fastInfo = payload?.data?.fast_info ?? {};
  const currentPrice = num(info.currentPrice ?? fastInfo.lastPrice);
  const previousClose = num(info.previousClose ?? fastInfo.previousClose);
  if (currentPrice === null || previousClose === null || previousClose <= 0) return null;
  return {
    currentPrice,
    previousClose,
    fetched_at: payload?.fetched_at ?? null,
  };
}

function movingAverage(values, window) {
  if (!Array.isArray(values) || values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / window;
}

function returnOver(history, days) {
  if (!Array.isArray(history) || history.length <= days) return null;
  const latest = history.at(-1)?.close;
  const prior = history.at(-(days + 1))?.close;
  return finite(latest) && finite(prior) && prior > 0 ? latest / prior - 1 : null;
}

function scoreRange(value, low, high) {
  return finite(value) && high > low ? round(clamp(((value - low) / (high - low)) * 100), 2) : null;
}

function weightedAverage(block, metric) {
  let numerator = 0;
  let denominator = 0;
  for (const [horizon, weight] of HORIZON_WEIGHTS) {
    const value = num(block?.[metric]?.[horizon]);
    if (value === null) continue;
    numerator += value * weight;
    denominator += weight;
  }
  return denominator > 0 ? round(numerator / denominator, 4) : null;
}

function absoluteCapScore(value, cap) {
  return finite(value) && finite(cap) && cap > 0 ? round(clamp((value / cap) * 100), 2) : null;
}

function weightedObservedScore(components) {
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  let observedWeight = 0;
  let weighted = 0;
  for (const component of components) {
    if (!finite(component.score)) continue;
    observedWeight += component.weight;
    weighted += component.score * component.weight;
  }

  const observedOnlyScore = observedWeight > 0 ? weighted / observedWeight : null;
  const coverageRatio = totalWeight > 0 ? observedWeight / totalWeight : null;
  return {
    score: round(observedOnlyScore, 2),
    coverage_adjusted_score: finite(observedOnlyScore) && finite(coverageRatio)
      ? round(observedOnlyScore * coverageRatio, 2)
      : null,
    observed_weight: round(observedWeight, 4),
    total_weight: round(totalWeight, 4),
    coverage_ratio: round(coverageRatio, 4),
    missing_keys: components
      .filter((component) => !finite(component.score))
      .map((component) => component.key),
  };
}

function sectorDurabilityCaps(row) {
  return SECTOR_DURABILITY_CAPS[row?.canonicalSector] ?? SECTOR_DURABILITY_CAPS.default;
}

function signalComponentValue(signal, componentKey) {
  const value = signal?.components?.[componentKey]?.value;
  return finite(value) ? value : null;
}

function statementRows(financials, section) {
  return financials?.statements?.annual?.[section]?.rows ?? [];
}

function statementPeriods(financials, section) {
  return financials?.statements?.annual?.[section]?.periods ?? [];
}

function statementValues(financials, section, field) {
  const row = statementRows(financials, section).find((item) => item.field === field);
  return Array.isArray(row?.values) ? row.values : [];
}

function annualStatementValues(financials, section, fields, limit = 5) {
  const periods = statementPeriods(financials, section);
  const startIndex = periods[0] === "TTM" ? 1 : 0;
  for (const field of fields) {
    const values = statementValues(financials, section, field)
      .slice(startIndex, startIndex + limit)
      .filter(finite);
    if (values.length > 0) return { field, values };
  }
  return { field: null, values: [] };
}

function average(values) {
  const finiteValues = Array.isArray(values) ? values.filter(finite) : [];
  if (finiteValues.length === 0) return null;
  return finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length;
}

function latestAnnualValue(annualValues) {
  return Array.isArray(annualValues?.values) && finite(annualValues.values[0])
    ? { field: annualValues.field, value: annualValues.values[0] }
    : { field: annualValues?.field ?? null, value: null };
}

function toPercent(value) {
  return finite(value) ? value * 100 : null;
}

function positiveHistory(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      score: null,
      positive_count: 0,
      years: 0,
      consecutive_positive_from_latest: 0,
    };
  }

  const positiveCount = values.filter((value) => finite(value) && value > 0).length;
  let consecutivePositiveFromLatest = 0;
  for (const value of values) {
    if (!finite(value) || value <= 0) break;
    consecutivePositiveFromLatest += 1;
  }

  const countScore = (positiveCount / values.length) * 100;
  const consecutiveScore = (consecutivePositiveFromLatest / values.length) * 100;
  return {
    score: round((countScore + consecutiveScore) / 2, 2),
    positive_count: positiveCount,
    years: values.length,
    consecutive_positive_from_latest: consecutivePositiveFromLatest,
  };
}

function positiveEarningsScore({ operatingMargin, roe, latestEps }) {
  if (finite(latestEps)) return latestEps > 0 ? 100 : 15;
  if (!finite(operatingMargin) && !finite(roe)) return null;
  const positiveCount = [operatingMargin, roe].filter((value) => finite(value) && value > 0).length;
  if (positiveCount === 2) return 100;
  if (positiveCount === 1) return 65;
  return 15;
}

function revisionScore(revision) {
  if (!revision || typeof revision !== "object") return null;
  if (revision.direction === "up") return 80 + clamp(num(revision.change1w) ?? 0, 0, 20);
  if (revision.direction === "down") return 20 - clamp(Math.abs(num(revision.change1w) ?? 0), 0, 20);
  return 50;
}

function momentumConsistency(row) {
  const values = [num(row.return12m), num(row.ret1y), num(row.slickReturn?.latestReturn)].filter((value) => value !== null);
  if (values.length < 2) return null;
  const positives = values.filter((value) => value > 0).length;
  const negatives = values.filter((value) => value < 0).length;
  if (positives === values.length) return 80;
  if (negatives === values.length) return 20;
  return 50;
}

function lowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function percentileRank(values, value, { higherIsBetter = true, rawRank = false } = {}) {
  if (!finite(value) || values.length === 0) return null;
  if (values.length === 1) return 50;
  const lower = lowerBound(values, value);
  const upper = upperBound(values, value);
  const midpoint = (lower + upper - 1) / 2;
  const rank = clamp((midpoint / (values.length - 1)) * 100);
  if (rawRank) return round(rank, 2);
  return round(higherIsBetter ? rank : 100 - rank, 2);
}

function metricValue(row, key) {
  switch (key) {
    case "gross_margin_avg":
      return weightedAverage(row.profitabilitySnapshot, "grossMargin");
    case "operating_margin_avg":
      return weightedAverage(row.profitabilitySnapshot, "operatingMargin");
    case "roe_avg":
      return weightedAverage(row.profitabilitySnapshot, "roe");
    case "revenue_growth_avg":
      return weightedAverage(row.estimateSnapshot, "revenueGrowth");
    case "eps_growth_avg":
      return weightedAverage(row.estimateSnapshot, "epsGrowth");
    case "forward_eps_growth_span": {
      const fy1 = num(row.estimateSnapshot?.forwardEps?.fy1);
      const fy3 = num(row.estimateSnapshot?.forwardEps?.fy3);
      return fy1 !== null && fy1 !== 0 && fy3 !== null ? round(((fy3 - fy1) / Math.abs(fy1)) * 100, 4) : null;
    }
    case "return12m":
      return num(row.return12m);
    case "ret1y":
      return num(row.ret1y);
    case "slick_latest_return":
      return num(row.slickReturn?.latestReturn);
    case "negative_return12m": {
      const value = num(row.return12m);
      return value === null ? null : -value;
    }
    case "forward_pe":
      return num(row.peForward ?? row.estimateSnapshot?.forwardPe?.fy1 ?? row.per);
    case "per_band_pct":
      return num(row.perBandPct);
    case "valuation_room": {
      const band = num(row.perBandPct);
      return band === null ? null : 1 - band;
    }
    case "log_market_cap": {
      const marketCap = num(row.marketCap);
      return marketCap !== null && marketCap > 0 ? Math.log10(marketCap) : null;
    }
    default:
      return null;
  }
}

const METRIC_DEFS = [
  { key: "gross_margin_avg", higherIsBetter: true },
  { key: "operating_margin_avg", higherIsBetter: true },
  { key: "roe_avg", higherIsBetter: true },
  { key: "revenue_growth_avg", higherIsBetter: true },
  { key: "eps_growth_avg", higherIsBetter: true },
  { key: "forward_eps_growth_span", higherIsBetter: true },
  { key: "return12m", higherIsBetter: true },
  { key: "ret1y", higherIsBetter: true },
  { key: "slick_latest_return", higherIsBetter: true },
  { key: "negative_return12m", higherIsBetter: true },
  { key: "forward_pe", higherIsBetter: false },
  { key: "per_band_pct", higherIsBetter: false },
  { key: "valuation_room", higherIsBetter: true },
  { key: "log_market_cap", higherIsBetter: true },
];

function peerKeys(row) {
  const scope = row.marketScope ?? "unknown";
  const sector = row.canonicalSector ?? "Other";
  return [
    { key: `scope:${scope}|sector:${sector}`, min: 12, label: "market_sector" },
    { key: `scope:${scope}`, min: 35, label: "market_scope" },
    { key: "all", min: 1, label: "global" },
  ];
}

function buildMetricStats(rows) {
  const stats = new Map();
  for (const def of METRIC_DEFS) {
    const groups = new Map();
    for (const row of rows) {
      const value = metricValue(row, def.key);
      if (!finite(value)) continue;
      const scope = row.marketScope ?? "unknown";
      const sector = row.canonicalSector ?? "Other";
      for (const key of [`scope:${scope}|sector:${sector}`, `scope:${scope}`, "all"]) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(value);
      }
    }
    for (const values of groups.values()) values.sort((a, b) => a - b);
    stats.set(def.key, { ...def, groups });
  }
  return stats;
}

function metricComponent(stats, row, key, options = {}) {
  const def = stats.get(key);
  const value = metricValue(row, key);
  if (!def || !finite(value)) return null;
  for (const peerKey of peerKeys(row)) {
    const values = def.groups.get(peerKey.key) ?? [];
    if (values.length < peerKey.min) continue;
    return {
      value: round(value, 4),
      score: percentileRank(values, value, {
        higherIsBetter: options.rawRank ? true : (options.higherIsBetter ?? def.higherIsBetter),
        rawRank: Boolean(options.rawRank),
      }),
      peer_group: peerKey.label,
      peer_count: values.length,
    };
  }
  return null;
}

function customComponent(value, score) {
  if (!finite(score)) return null;
  return {
    value: finite(value) ? round(value, 4) : null,
    score: round(clamp(score), 2),
    peer_group: "rule",
    peer_count: null,
  };
}

function scoreFromComponents(componentDefs) {
  let scoreNumerator = 0;
  let presentWeight = 0;
  let totalWeight = 0;
  const components = {};
  for (const item of componentDefs) {
    totalWeight += item.weight;
    if (!item.component || !finite(item.component.score)) {
      components[item.key] = null;
      continue;
    }
    scoreNumerator += item.component.score * item.weight;
    presentWeight += item.weight;
    components[item.key] = item.component;
  }

  return {
    score: presentWeight > 0 ? round(scoreNumerator / presentWeight, 2) : null,
    coverage_ratio: totalWeight > 0 ? round(presentWeight / totalWeight, 4) : 0,
    components,
  };
}

function confidenceFromCoverage(coverageRatio, baseCoverage = 1) {
  const blended = (coverageRatio * 0.7) + ((num(baseCoverage) ?? 0) * 0.3);
  if (blended >= 0.75) return "high";
  if (blended >= 0.5) return "medium";
  return "low";
}

function directionFromScore(score) {
  if (!finite(score)) return "unavailable";
  if (score >= 70) return "strong";
  if (score >= 55) return "constructive";
  if (score >= 45) return "neutral";
  if (score >= 30) return "weak";
  return "stressed";
}

function buildProfitabilitySignal(stats, row) {
  const result = scoreFromComponents([
    { key: "gross_margin_avg", weight: 0.25, component: metricComponent(stats, row, "gross_margin_avg") },
    { key: "operating_margin_avg", weight: 0.4, component: metricComponent(stats, row, "operating_margin_avg") },
    { key: "roe_avg", weight: 0.35, component: metricComponent(stats, row, "roe_avg") },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    components: result.components,
  };
}

function buildDurabilityProfitabilitySignal(row, profitability, financials) {
  const caps = sectorDurabilityCaps(row);
  const grossMargin = signalComponentValue(profitability, "gross_margin_avg");
  const operatingMargin = signalComponentValue(profitability, "operating_margin_avg");
  const roe = signalComponentValue(profitability, "roe_avg");
  const epsHistory = annualStatementValues(financials, "income", ["epsDiluted", "epsBasic"]);
  const latestEps = latestAnnualValue(epsHistory);
  const fcfMarginHistory = annualStatementValues(financials, "cash_flow", ["fcfMargin"]);
  const fallbackFcfMarginHistory = annualStatementValues(financials, "income", ["fcfMargin"]);
  const roicHistory = annualStatementValues(financials, "ratios", ["roic"]);
  const fcfHistory = annualStatementValues(financials, "cash_flow", ["fcf"]);
  const fallbackFcfHistory = annualStatementValues(financials, "income", ["fcf"]);
  const fcfMarginAnnual = fcfMarginHistory.values.length > 0 ? fcfMarginHistory : fallbackFcfMarginHistory;
  const fcfAnnual = fcfHistory.values.length > 0 ? fcfHistory : fallbackFcfHistory;
  const avgFcfMargin = {
    field: fcfMarginAnnual.field,
    value: average(fcfMarginAnnual.values),
  };
  const latestRoic = latestAnnualValue(roicHistory);

  const grossMarginScore = absoluteCapScore(grossMargin, caps.grossMargin);
  const operatingMarginScore = absoluteCapScore(operatingMargin, caps.operatingMargin);
  const marginLevel = weightedObservedScore([
    { key: "gross_margin_avg", score: grossMarginScore, weight: 0.4 },
    { key: "operating_margin_avg", score: operatingMarginScore, weight: 0.6 },
  ]);

  const roeScore = absoluteCapScore(roe, caps.roe);
  const roic = toPercent(latestRoic.value);
  const roicScore = absoluteCapScore(roic, caps.roic);
  const returnEfficiency = weightedObservedScore([
    { key: "roe_avg", score: roeScore, weight: 0.7 },
    { key: "roic", score: roicScore, weight: 0.3 },
  ]);

  const fcfMarginScore = absoluteCapScore(toPercent(avgFcfMargin.value), caps.fcfMargin);
  const fcfStability = positiveHistory(fcfAnnual.values);
  const positiveFcfCountScore = fcfStability.years > 0
    ? round((fcfStability.positive_count / fcfStability.years) * 100, 2)
    : null;
  const cashDurability = weightedObservedScore([
    { key: "average_fcf_margin", score: fcfMarginScore, weight: 0.65 },
    { key: "positive_fcf_count", score: positiveFcfCountScore, weight: 0.35 },
  ]);

  const epsStability = positiveHistory(epsHistory.values);
  const multiYearStability = weightedObservedScore([
    { key: "positive_eps_history", score: epsStability.score, weight: 0.5 },
    { key: "positive_fcf_history", score: fcfStability.score, weight: 0.5 },
  ]);

  const components = [
    { key: "positive_earnings", score: positiveEarningsScore({ operatingMargin, roe, latestEps: latestEps.value }), weight: 0.2 },
    { key: "cash_durability", score: cashDurability.score, weight: 0.2 },
    { key: "margin_level", score: marginLevel.score, weight: 0.25 },
    { key: "roe_roic_efficiency", score: returnEfficiency.score, weight: 0.25 },
    { key: "multi_year_stability", score: multiYearStability.score, weight: 0.1 },
  ];
  const result = weightedObservedScore(components);

  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio ?? 0, row.coverageRatio),
    basis: "observed_only_absolute_durability_phase_a",
    observed_only_score_0_100: result.score,
    coverage_adjusted_score_0_100: result.coverage_adjusted_score,
    missing_inputs: result.missing_keys,
    financials_source: financials ? {
      path: `${STOCKANALYSIS_FINANCIALS_DIR}/${financials.ticker}.json`,
      role: financials.role ?? null,
    } : null,
    sector_caps: caps,
    components: {
      positive_earnings: {
        score: components[0].score,
        operating_margin: operatingMargin,
        roe,
        latest_eps: latestEps.value,
        source_field: latestEps.field,
        note: finite(latestEps.value)
          ? "based on latest EPS from local stockanalysis financials"
          : "inferred from positive operating margin and ROE",
      },
      cash_durability: {
        score: cashDurability.score,
        coverage_ratio: cashDurability.coverage_ratio,
        average_fcf_margin: toPercent(avgFcfMargin.value),
        fcf_margin_field: avgFcfMargin.field,
        fcf_margin_score: fcfMarginScore,
        fcf_field: fcfAnnual.field,
        fcf_positive_count: fcfStability.positive_count,
        fcf_years: fcfStability.years,
        positive_fcf_count_score: positiveFcfCountScore,
        status: cashDurability.score === null ? "missing_financials_input" : "available_from_local_stockanalysis",
      },
      margin_level: {
        score: marginLevel.score,
        coverage_ratio: marginLevel.coverage_ratio,
        gross_margin: grossMargin,
        gross_margin_score: grossMarginScore,
        operating_margin: operatingMargin,
        operating_margin_score: operatingMarginScore,
      },
      roe_roic_efficiency: {
        score: returnEfficiency.score,
        coverage_ratio: returnEfficiency.coverage_ratio,
        roe,
        roe_score: roeScore,
        roic,
        roic_field: latestRoic.field,
        roic_score: roicScore,
        note: finite(roic)
          ? "ROE from Fenok profitability signal plus ROIC from local stockanalysis financials"
          : "ROIC missing; ROE available when profitability signal exists",
      },
      multi_year_stability: {
        score: multiYearStability.score,
        coverage_ratio: multiYearStability.coverage_ratio,
        eps_field: epsHistory.field,
        eps_positive_count: epsStability.positive_count,
        eps_years: epsStability.years,
        eps_consecutive_positive_from_latest: epsStability.consecutive_positive_from_latest,
        fcf_field: fcfAnnual.field,
        fcf_positive_count: fcfStability.positive_count,
        fcf_years: fcfStability.years,
        fcf_consecutive_positive_from_latest: fcfStability.consecutive_positive_from_latest,
        status: multiYearStability.score === null ? "missing_history_input" : "available_from_local_stockanalysis",
      },
    },
  };
}

function buildGrowthSignal(stats, row) {
  const revision = revisionScore(row.revision);
  const result = scoreFromComponents([
    { key: "revenue_growth_avg", weight: 0.35, component: metricComponent(stats, row, "revenue_growth_avg") },
    { key: "eps_growth_avg", weight: 0.4, component: metricComponent(stats, row, "eps_growth_avg") },
    { key: "forward_eps_growth_span", weight: 0.15, component: metricComponent(stats, row, "forward_eps_growth_span") },
    { key: "revision_direction", weight: 0.1, component: customComponent(row.revision?.change1w, revision) },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    components: result.components,
  };
}

function buildTechnicalSignal(stats, row) {
  const consistency = momentumConsistency(row);
  const result = scoreFromComponents([
    { key: "return12m", weight: 0.45, component: metricComponent(stats, row, "return12m") },
    { key: "ret1y", weight: 0.25, component: metricComponent(stats, row, "ret1y") },
    { key: "slick_latest_return", weight: 0.2, component: metricComponent(stats, row, "slick_latest_return") },
    { key: "momentum_consistency", weight: 0.1, component: customComponent(null, consistency) },
  ]);
  if (result.score === null) {
    const quote = loadSpotQuote(row.symbol);
    const oneDayReturn = quote ? quote.currentPrice / quote.previousClose - 1 : null;
    const fallbackScore = finite(oneDayReturn) ? scoreRange(oneDayReturn, -0.08, 0.08) : null;
    if (fallbackScore !== null) {
      return {
        score_0_100: fallbackScore,
        direction: directionFromScore(fallbackScore),
        coverage_ratio: 0.1,
        confidence: confidenceFromCoverage(0.1, row.coverageRatio),
        basis: "local_yf_spot_quote_fallback_when_ohlcv_history_is_short",
        caveat: "Uses currentPrice versus previousClose only when 12m/local OHLCV technical inputs are unavailable; this is a minimal short-term axis, not a trend model.",
        source_fetched_at: quote.fetched_at,
        components: {
          ...result.components,
          spot_price_move_1d: customComponent(oneDayReturn, fallbackScore),
        },
      };
    }
  }
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    components: result.components,
  };
}

function buildUpsideDownsideSignal(stats, row, profitability, growth, technical) {
  const revision = revisionScore(row.revision);
  const upside = scoreFromComponents([
    { key: "valuation_room", weight: 0.3, component: metricComponent(stats, row, "valuation_room") },
    { key: "forward_pe_discount", weight: 0.2, component: metricComponent(stats, row, "forward_pe") },
    { key: "growth_support", weight: 0.25, component: customComponent(null, growth.score_0_100) },
    { key: "technical_confirmation", weight: 0.15, component: customComponent(null, technical.score_0_100) },
    { key: "revision_support", weight: 0.1, component: customComponent(row.revision?.change1w, revision) },
  ]);
  const downsideRevision = revision === null ? null : 100 - revision;
  const downside = scoreFromComponents([
    { key: "valuation_crowding", weight: 0.3, component: metricComponent(stats, row, "per_band_pct", { higherIsBetter: true }) },
    { key: "forward_pe_pressure", weight: 0.2, component: metricComponent(stats, row, "forward_pe", { higherIsBetter: true }) },
    { key: "negative_momentum", weight: 0.2, component: metricComponent(stats, row, "negative_return12m") },
    { key: "profitability_gap", weight: 0.15, component: customComponent(null, profitability.score_0_100 === null ? null : 100 - profitability.score_0_100) },
    { key: "revision_pressure", weight: 0.15, component: customComponent(row.revision?.change1w, downsideRevision) },
  ]);

  const netScore = finite(upside.score) && finite(downside.score) ? round(clamp(50 + ((upside.score - downside.score) / 2)), 2) : null;
  let direction = "unavailable";
  if (finite(upside.score) && finite(downside.score)) {
    if (upside.score >= 65 && upside.score - downside.score >= 15) direction = "upside_bias";
    else if (downside.score >= 65 && downside.score - upside.score >= 15) direction = "downside_bias";
    else direction = "balanced";
  }

  const coverageRatio = round((upside.coverage_ratio + downside.coverage_ratio) / 2, 4);
  return {
    score_0_100: netScore,
    direction,
    coverage_ratio: coverageRatio,
    confidence: confidenceFromCoverage(coverageRatio, row.coverageRatio),
    upside_score_0_100: upside.score,
    downside_score_0_100: downside.score,
    components: {
      upside: upside.components,
      downside: downside.components,
    },
  };
}

function buildVolumeLiquidityTrendSignal(row) {
  const history = loadPriceHistory(row.symbol);
  const closes = history.map((item) => item.close).filter(finite);
  const volumes = history.map((item) => item.volume).filter(finite);
  const latestClose = closes.at(-1);
  const latestVolume = volumes.at(-1);
  const avgVolume20 = movingAverage(volumes, 20);
  const avgVolume60 = movingAverage(volumes, 60);
  const return20d = returnOver(history, 20);
  const dollarVolume20 = finite(latestClose) && finite(avgVolume20) ? latestClose * avgVolume20 : null;
  const volumeTrend = finite(avgVolume20) && finite(avgVolume60) && avgVolume60 > 0 ? avgVolume20 / avgVolume60 : null;
  const latestVolumeRatio = finite(latestVolume) && finite(avgVolume20) && avgVolume20 > 0 ? latestVolume / avgVolume20 : null;
  const result = scoreFromComponents([
    { key: "dollar_liquidity_20d", weight: 0.35, component: customComponent(dollarVolume20, finite(dollarVolume20) && dollarVolume20 > 0 ? scoreRange(Math.log10(dollarVolume20), 6, 10) : null) },
    { key: "volume_trend_20d_vs_60d", weight: 0.25, component: customComponent(volumeTrend, scoreRange(volumeTrend, 0.65, 1.5)) },
    { key: "latest_volume_vs_20d", weight: 0.15, component: customComponent(latestVolumeRatio, scoreRange(latestVolumeRatio, 0.5, 2.0)) },
    { key: "price_confirmation_20d", weight: 0.25, component: customComponent(return20d, scoreRange(return20d, -0.12, 0.22)) },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    basis: "local_yf_1y_volume_liquidity_trend_proxy",
    caveat: "Volume/liquidity trend is a local OHLCV proxy, not true order flow.",
    components: result.components,
  };
}

function buildShortTermRelativeStrengthSignal(row, spyHistory) {
  const history = loadPriceHistory(row.symbol);
  const ticker20d = returnOver(history, 20);
  const ticker60d = returnOver(history, 60);
  const spy20d = returnOver(spyHistory, 20);
  const spy60d = returnOver(spyHistory, 60);
  const relative20d = finite(ticker20d) && finite(spy20d) ? ticker20d - spy20d : null;
  const relative60d = finite(ticker60d) && finite(spy60d) ? ticker60d - spy60d : null;
  const result = scoreFromComponents([
    { key: "relative_return_20d_vs_spy", weight: 0.45, component: customComponent(relative20d, scoreRange(relative20d, -0.12, 0.18)) },
    { key: "relative_return_60d_vs_spy", weight: 0.35, component: customComponent(relative60d, scoreRange(relative60d, -0.18, 0.3)) },
    { key: "absolute_return_20d", weight: 0.2, component: customComponent(ticker20d, scoreRange(ticker20d, -0.12, 0.22)) },
  ]);
  return {
    score_0_100: result.score,
    direction: directionFromScore(result.score),
    coverage_ratio: result.coverage_ratio,
    confidence: confidenceFromCoverage(result.coverage_ratio, row.coverageRatio),
    basis: "local_yf_20d_60d_relative_strength_vs_spy",
    caveat: "Short-term relative strength is a price-return proxy versus SPY, not a forecast.",
    components: result.components,
  };
}

function buildOptionsActivityProxySignal(row, occOptionsByTicker) {
  const occ = occOptionsByTicker.get(String(row.symbol ?? "").toUpperCase()) ?? null;
  const proxy = occ?.options_activity_proxy ?? null;
  if (!finite(proxy?.score_0_100)) {
    return {
      score_0_100: null,
      direction: "unavailable",
      coverage_ratio: 0,
      confidence: "low",
      basis: "occ_listed_options_volume_missing",
      caveat: "Options activity proxy requires an OCC listed-options volume row; no raw OCC CSV is public.",
    };
  }
  return {
    score_0_100: proxy.score_0_100,
    direction: proxy.direction ?? "unavailable",
    coverage_ratio: occ.coverage_ratio ?? 0.65,
    confidence: confidenceFromCoverage(occ.coverage_ratio ?? 0.65, row.coverageRatio),
    basis: "computed_occ_listed_options_volume_skew_proxy",
    caveat: proxy.caveat ?? "OCC listed-options volume skew proxy only; not real options flow, OPRA, greeks, premium, sweeps, blocks, or buyer/seller direction.",
    source_date: occ.source_date ?? null,
    components: {
      call_volume: { value: proxy.call_volume ?? null, score: null, peer_group: "occ", peer_count: proxy.row_count ?? null },
      put_volume: { value: proxy.put_volume ?? null, score: null, peer_group: "occ", peer_count: proxy.row_count ?? null },
      total_volume: { value: proxy.total_volume ?? null, score: null, peer_group: "occ", peer_count: proxy.row_count ?? null },
      call_share: customComponent(proxy.call_share ?? null, scoreRange(proxy.call_share ?? null, 0.35, 0.65)),
      put_call_volume_ratio: customComponent(proxy.put_call_volume_ratio ?? null, scoreRange(proxy.put_call_volume_ratio ?? null, 0.5, 1.5)),
    },
  };
}

function buildFlowProxySignal(row, flowByTicker, kind) {
  const flow = flowByTicker.get(String(row.symbol ?? "").toUpperCase());
  const source = kind === "off_exchange_activity_proxy"
    ? flow?.off_exchange_activity_proxy
    : flow?.short_pressure_proxy;
  const label = kind === "off_exchange_activity_proxy" ? "off_exchange_activity_proxy" : "short_pressure_proxy";
  const fallbackCaveat = kind === "off_exchange_activity_proxy"
    ? "Off-exchange activity proxy uses FINRA reported off-exchange volume share; it is not ATS-only dark-pool flow."
    : "Short-volume pressure proxy uses FINRA reported short-sale volume share; it is not short interest.";
  return {
    score_0_100: source?.score_0_100 ?? null,
    direction: source?.direction ?? "unavailable",
    coverage_ratio: source?.score_0_100 == null ? 0 : (flow?.coverage_ratio ?? 0.6),
    confidence: confidenceFromCoverage(source?.score_0_100 == null ? 0 : (flow?.coverage_ratio ?? 0.6), row.coverageRatio),
    basis: `computed_fenok_flow_proxies_${label}`,
    caveat: source?.caveat ?? fallbackCaveat,
    source_date: flow?.source_date ?? null,
    components: source ?? null,
  };
}

function rawRankComponent(stats, row, key) {
  return metricComponent(stats, row, key, { rawRank: true });
}

function buildVector(stats, row, signals) {
  const features = {
    market_cap_rank: rawRankComponent(stats, row, "log_market_cap")?.score,
    forward_pe_rank: rawRankComponent(stats, row, "forward_pe")?.score,
    per_band_rank: rawRankComponent(stats, row, "per_band_pct")?.score,
    profitability_score: signals.profitability.score_0_100,
    growth_score: signals.growth.score_0_100,
    technical_flow_score: signals.technical_flow.score_0_100,
    return12m_rank: rawRankComponent(stats, row, "return12m")?.score,
  };
  return Object.fromEntries(
    Object.entries(features)
      .filter(([, value]) => finite(value))
      .map(([key, value]) => [key, round(value / 100, 4)]),
  );
}

function similarity(a, b) {
  const common = Object.keys(a).filter((key) => finite(a[key]) && finite(b[key]));
  if (common.length < 4) return null;
  const meanSquaredDistance = common.reduce((sum, key) => sum + ((a[key] - b[key]) ** 2), 0) / common.length;
  const distance = Math.sqrt(meanSquaredDistance);
  return {
    score: round(clamp((1 - distance) * 100), 2),
    shared_feature_count: common.length,
  };
}

function candidatePeers(rows, row) {
  let candidates = rows.filter(
    (other) =>
      other.symbol !== row.symbol &&
      other.marketScope === row.marketScope &&
      other.canonicalSector === row.canonicalSector,
  );
  let peerGroup = "market_sector";
  if (candidates.length < 10) {
    candidates = rows.filter((other) => other.symbol !== row.symbol && other.marketScope === row.marketScope);
    peerGroup = "market_scope";
  }
  if (candidates.length < 10) {
    candidates = rows.filter((other) => other.symbol !== row.symbol);
    peerGroup = "global";
  }
  return { candidates, peerGroup };
}

function buildMarketSimilaritySignals(rows, vectors, resultRows) {
  const bySymbol = new Map(resultRows.map((row) => [row.ticker, row]));
  for (const row of rows) {
    const current = bySymbol.get(row.symbol);
    const vector = vectors.get(row.symbol) ?? {};
    const { candidates, peerGroup } = candidatePeers(rows, row);
    const peers = candidates
      .map((other) => {
        const sim = similarity(vector, vectors.get(other.symbol) ?? {});
        return sim
          ? {
              ticker: other.symbol,
              company: other.company ?? other.symbol,
              market_scope: other.marketScope ?? null,
              canonical_sector: other.canonicalSector ?? null,
              similarity_score: sim.score,
              shared_feature_count: sim.shared_feature_count,
            }
          : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.similarity_score - a.similarity_score || a.ticker.localeCompare(b.ticker))
      .slice(0, 5);

    const featureCoverage = Object.keys(vector).length / 7;
    const peerCoverage = Math.min(1, candidates.length / 20);
    const coverageRatio = round(featureCoverage * peerCoverage, 4);
    const score = peers.length > 0 ? round(peers.slice(0, 3).reduce((sum, peer) => sum + peer.similarity_score, 0) / Math.min(3, peers.length), 2) : null;

    current.signals.market_similarity = {
      score_0_100: score,
      direction: score === null ? "unavailable" : "peer_comparable",
      coverage_ratio: coverageRatio,
      confidence: confidenceFromCoverage(coverageRatio, row.coverageRatio),
      peer_group: peerGroup,
      peer_count: candidates.length,
      vector_feature_count: Object.keys(vector).length,
      nearest_peers: peers,
    };
  }
}

function compactSignalCoverage(signals, keys = NATIVE_SIGNAL_KEYS) {
  const entries = keys.map((key) => signals?.[key]);
  const available = entries.filter((signal) => finite(signal?.score_0_100));
  return {
    available_signal_count: available.length,
    coverage_ratio: round(entries.reduce((sum, signal) => sum + (num(signal?.coverage_ratio) ?? 0), 0) / entries.length, 4),
  };
}

function buildConvictionComposite(signals) {
  const presentScores = CONVICTION_SIGNAL_KEYS
    .map((key) => signals?.[key]?.score_0_100)
    .filter(finite);
  const convictionScore = presentScores.length >= 3
    ? round(presentScores.reduce((sum, score) => sum + score, 0) / presentScores.length, 2)
    : null;

  if (convictionScore !== null && convictionScore >= 70) return { convictionScore, convictionCall: "concentrated" };
  if (convictionScore !== null && convictionScore <= 40) return { convictionScore, convictionCall: "diluted" };
  return { convictionScore, convictionCall: "mixed" };
}

function buildLongTermConvictionScore(signals) {
  const downsidePressure = signals?.upside_downside?.downside_score_0_100;
  const presentScores = [
    signals?.profitability?.score_0_100,
    signals?.growth?.score_0_100,
    signals?.upside_downside?.upside_score_0_100,
    finite(downsidePressure) ? 100 - downsidePressure : null,
    signals?.durability_profitability?.score_0_100,
  ].filter(finite);
  return presentScores.length > 0
    ? round(presentScores.reduce((sum, score) => sum + score, 0) / presentScores.length, 2)
    : null;
}

function convictionCallFromScore(score) {
  if (score !== null && score >= 70) return "concentrated";
  if (score !== null && score <= 40) return "diluted";
  return "mixed";
}

function buildShortTermConvictionComposite(signals) {
  const shortPressure = signals?.short_pressure_proxy?.score_0_100;
  const presentScores = [
    signals?.technical_flow?.score_0_100,
    signals?.volume_liquidity_trend?.score_0_100,
    signals?.short_term_relative_strength?.score_0_100,
    signals?.net_options_proxy?.score_0_100,
    finite(shortPressure) ? 100 - shortPressure : null,
  ].filter(finite);
  const shortTermConvictionScore = presentScores.length > 0
    ? round(presentScores.reduce((sum, score) => sum + score, 0) / presentScores.length, 2)
    : null;
  return {
    shortTermConvictionScore,
    shortTermConvictionCall: convictionCallFromScore(shortTermConvictionScore),
  };
}

function buildFenokSignalsSummary(fenokSignals) {
  const fields = [
    "ticker",
    "company",
    "marketScope",
    "canonicalSector",
    "asOf",
    "confidence",
    "coverageRatio",
    "profitabilityScore",
    "profitabilityDirection",
    "growthScore",
    "growthDirection",
    "technicalFlowScore",
    "technicalFlowDirection",
    "upsideDownsideScore",
    "upsideDownsideDirection",
    "marketSimilarityScore",
    "marketSimilarityDirection",
    "convictionScore",
    "convictionCall",
    "longTermConvictionScore",
    "longTermConvictionCall",
    "shortTermScore",
    "shortTermConvictionScore",
    "shortTermConvictionCall",
    "durabilityProfitabilityScore",
    "durabilityProfitabilityCoverage",
    "upsidePotentialScore",
    "downsidePressureScore",
    "volumeLiquidityTrendScore",
    "volumeLiquidityTrendDirection",
    "shortTermRelativeStrengthScore",
    "shortTermRelativeStrengthDirection",
    "netOptionsProxyScore",
    "offExchangeActivityProxyScore",
    "shortPressureProxyScore",
  ];

  return {
    schema_version: 1,
    generated_at: fenokSignals.generated_at,
    source_file: OUTPUT_FILE,
    formula_version: fenokSignals.formula_version,
    contract_doc: CONTRACT_DOC,
    public_surface_status: PUBLIC_SURFACE_STATUS,
    field_semantics: {
      shortTermScore: "Alias of shortTermConvictionScore for current UI group-score consumers.",
      shortTermConvictionScore: "Directional short-term mean: technical flow, volume/liquidity trend, relative strength, options-activity proxy, and inverted short-volume pressure when present. Off-exchange activity is excluded because it is non-directional.",
      volumeLiquidityTrendScore: "Local OHLCV volume/liquidity trend proxy, not true order flow.",
      shortTermRelativeStrengthScore: "Local 20d/60d relative-strength proxy versus SPY, not a forecast.",
      netOptionsProxyScore: "OCC listed-options volume skew proxy derived from underlying-level call/put quantities; not real options flow, not OPRA, and not buyer/seller direction.",
      offExchangeActivityProxyScore: "FINRA reported off-exchange activity proxy; not ATS-only dark-pool flow and not directional intent.",
      shortPressureProxyScore: "FINRA reported short-sale volume pressure proxy; not short interest, borrow fee, utilization, or buy/sell direction.",
      directCorpusToneProxyScore: "Private/admin only; never included in this public summary.",
    },
    fields,
    coverage: {
      row_count: fenokSignals.coverage.row_count,
      signal_counts: fenokSignals.coverage.signal_counts,
      confidence_counts: fenokSignals.coverage.confidence_counts,
      market_scope_counts: fenokSignals.coverage.market_scope_counts,
    },
    rows: fenokSignals.rows.map((row) => {
      const conviction = buildConvictionComposite(row.signals);
      const longTermConvictionScore = buildLongTermConvictionScore(row.signals);
      const shortTermConviction = buildShortTermConvictionComposite(row.signals);
      return [
        row.ticker,
        row.company,
        row.market_scope,
        row.canonical_sector,
        row.as_of,
        row.confidence,
        row.coverage_ratio,
        row.signals.profitability?.score_0_100 ?? null,
        row.signals.profitability?.direction ?? "unavailable",
        row.signals.growth?.score_0_100 ?? null,
        row.signals.growth?.direction ?? "unavailable",
        row.signals.technical_flow?.score_0_100 ?? null,
        row.signals.technical_flow?.direction ?? "unavailable",
        row.signals.upside_downside?.score_0_100 ?? null,
        row.signals.upside_downside?.direction ?? "unavailable",
        row.signals.market_similarity?.score_0_100 ?? null,
        row.signals.market_similarity?.direction ?? "unavailable",
        conviction.convictionScore,
        conviction.convictionCall,
        longTermConvictionScore,
        convictionCallFromScore(longTermConvictionScore),
        shortTermConviction.shortTermConvictionScore,
        shortTermConviction.shortTermConvictionScore,
        shortTermConviction.shortTermConvictionCall,
        row.signals.durability_profitability?.score_0_100 ?? null,
        row.signals.durability_profitability?.coverage_ratio ?? null,
        row.signals.upside_downside?.upside_score_0_100 ?? null,
        row.signals.upside_downside?.downside_score_0_100 ?? null,
        row.signals.volume_liquidity_trend?.score_0_100 ?? null,
        row.signals.volume_liquidity_trend?.direction ?? "unavailable",
        row.signals.short_term_relative_strength?.score_0_100 ?? null,
        row.signals.short_term_relative_strength?.direction ?? "unavailable",
        row.signals.net_options_proxy?.score_0_100 ?? null,
        row.signals.off_exchange_activity_proxy?.score_0_100 ?? null,
        row.signals.short_pressure_proxy?.score_0_100 ?? null,
      ];
    }),
  };
}

function buildFenokSignals(stockActionIndex) {
  const rows = (Array.isArray(stockActionIndex.rows) ? stockActionIndex.rows : []).filter(
    (row) => (row.asset_type ?? "stock") === "stock",
  );
  const stats = buildMetricStats(rows);
  const financialsByTicker = readFinancialsByTicker(rows.map((row) => row.symbol).filter(Boolean));
  const flowByTicker = readFlowProxiesByTicker();
  const occOptionsByTicker = readOccOptionsByTicker();
  const spyHistory = loadPriceHistory("SPY");
  const generatedAt = new Date().toISOString();
  const vectors = new Map();

  const resultRows = rows.map((row) => {
    const profitability = buildProfitabilitySignal(stats, row);
    const durabilityProfitability = buildDurabilityProfitabilitySignal(row, profitability, financialsByTicker.get(row.symbol));
    const growth = buildGrowthSignal(stats, row);
    const technicalFlow = buildTechnicalSignal(stats, row);
    const upsideDownside = buildUpsideDownsideSignal(stats, row, profitability, growth, technicalFlow);
    const volumeLiquidityTrend = buildVolumeLiquidityTrendSignal(row);
    const shortTermRelativeStrength = buildShortTermRelativeStrengthSignal(row, spyHistory);
    const netOptionsProxy = buildOptionsActivityProxySignal(row, occOptionsByTicker);
    const offExchangeActivityProxy = buildFlowProxySignal(row, flowByTicker, "off_exchange_activity_proxy");
    const shortPressureProxy = buildFlowProxySignal(row, flowByTicker, "short_pressure_proxy");
    const signals = {
      profitability,
      durability_profitability: durabilityProfitability,
      growth,
      technical_flow: technicalFlow,
      upside_downside: upsideDownside,
      market_similarity: null,
      volume_liquidity_trend: volumeLiquidityTrend,
      short_term_relative_strength: shortTermRelativeStrength,
      net_options_proxy: netOptionsProxy,
      off_exchange_activity_proxy: offExchangeActivityProxy,
      short_pressure_proxy: shortPressureProxy,
    };
    const nativeCoverage = compactSignalCoverage(signals);
    vectors.set(row.symbol, buildVector(stats, row, signals));

    return {
      ticker: row.symbol,
      ticker_normalized: row.ticker_normalized ?? null,
      company: row.company ?? row.symbol,
      market_scope: row.marketScope ?? null,
      market: row.market ?? null,
      canonical_sector: row.canonicalSector ?? null,
      as_of: stockActionIndex.generated_at ?? generatedAt,
      formula_version: FORMULA_VERSION,
      confidence: confidenceFromCoverage(nativeCoverage.coverage_ratio, row.coverageRatio),
      coverage_ratio: nativeCoverage.coverage_ratio,
      source_families: [
        "computed/stock_action_index.json",
        "global-scouter/stocks/detail/*.json",
        "global-scouter/core/revision_movers.json",
        "yf/quarter_closes.json",
        "slickcharts/stocks-returns.json",
        "stockanalysis/financials/*.json",
        "yf/finance/{TICKER}.json",
        "yf/finance/SPY.json",
        flowByTicker.has(String(row.symbol ?? "").toUpperCase()) ? "computed/fenok_flow_proxies.json" : null,
        occOptionsByTicker.has(String(row.symbol ?? "").toUpperCase()) ? OCC_OPTIONS_VOLUME_FILE : null,
      ].filter(Boolean),
      stock_action_context: {
        action_score: num(row.actionScore),
        signal_score: num(row.signalScore),
        coverage_ratio: num(row.coverageRatio),
        confidence_label: row.confidenceLabel ?? null,
        action_bucket: row.actionBucket ?? null,
      },
      signals,
    };
  });

  buildMarketSimilaritySignals(rows, vectors, resultRows);
  for (const row of resultRows) {
    const nativeCoverage = compactSignalCoverage(row.signals);
    row.coverage_ratio = nativeCoverage.coverage_ratio;
    row.confidence = confidenceFromCoverage(row.coverage_ratio, row.stock_action_context.coverage_ratio);
  }

  const signalKeys = [...NATIVE_SIGNAL_KEYS, ...PHASE_A_SIGNAL_KEYS, ...PHASE_B_SIGNAL_KEYS];
  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_file: SOURCE_FILE,
    source_generated_at: stockActionIndex.generated_at ?? null,
    source_score_contract: stockActionIndex.score_contract?.version ?? null,
    formula_version: FORMULA_VERSION,
    contract_doc: CONTRACT_DOC,
    public_surface_status: PUBLIC_SURFACE_STATUS,
    raw_policy: {
      external_collection: false,
      full_public_mirror: false,
      third_party_raw_public: false,
      private_proxy_sources: true,
      direct_corpus_tone_public: false,
      public_payload: SUMMARY_OUTPUT_FILE,
    },
    signal_keys: signalKeys,
    missing_class_a_inputs: {
      analyst_target_upside: "not_present_in_stock_action_index; upside_downside v0 uses valuation band, forward PE, growth, revision, and momentum proxies",
      true_volume_flow: "not_present_in_stock_action_index; technical_flow and volume_liquidity_trend use local OHLCV proxies, not true order flow",
      short_interest: "not_free_daily; short_pressure_proxy uses FINRA reported short-sale volume share, not short interest",
      true_options_flow: "not_free_official; net_options_proxy uses OCC listed-options volume skew, not real options flow, OPRA, greeks, premium, sweeps, blocks, or buyer/seller direction",
      dark_pool_ats: "not_free_daily; off_exchange_activity_proxy is FINRA reported off-exchange bucket, not ATS-only dark-pool prints",
      social_news: "directCorpusTone remains private/admin only and is not included in public summary",
    },
    coverage: {
      row_count: resultRows.length,
      signal_counts: Object.fromEntries(
        signalKeys.map((key) => [
          key,
          resultRows.filter((row) => finite(row.signals?.[key]?.score_0_100)).length,
        ]),
      ),
      confidence_counts: resultRows.reduce((acc, row) => {
        acc[row.confidence] = (acc[row.confidence] ?? 0) + 1;
        return acc;
      }, {}),
      market_scope_counts: resultRows.reduce((acc, row) => {
        const key = row.market_scope ?? "unknown";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    rows: resultRows.sort((a, b) => b.coverage_ratio - a.coverage_ratio || a.ticker.localeCompare(b.ticker)),
  };
}

function main() {
  const stockActionIndex = readJson(SOURCE_FILE);
  const fenokSignals = buildFenokSignals(stockActionIndex);
  writeJsonToRoot(OUTPUT_FILE, fenokSignals);

  const fenokSignalsSummary = buildFenokSignalsSummary(fenokSignals);
  writeJsonToBoth(SUMMARY_OUTPUT_FILE, fenokSignalsSummary, { compact: true });

  console.log(JSON.stringify({
    generated_at: fenokSignals.generated_at,
    rows: fenokSignals.rows.length,
    signal_counts: fenokSignals.coverage.signal_counts,
    confidence_counts: fenokSignals.coverage.confidence_counts,
    output: OUTPUT_FILE,
    summary_output: SUMMARY_OUTPUT_FILE,
    summary_bytes: Buffer.byteLength(`${JSON.stringify(fenokSignalsSummary)}\n`, "utf8"),
  }, null, 2));
}

main();
