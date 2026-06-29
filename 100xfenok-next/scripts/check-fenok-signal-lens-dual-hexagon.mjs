#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(appRoot, "public", "data");

const EXPECTED_ACTIVE_STOCK_COUNT = 1066;

const LONG_AXES = [
  { key: "profitability", summaryKey: "profitabilityScore", sourceKey: "profitability", sourceScoreKey: "score_0_100" },
  { key: "growth", summaryKey: "growthScore", sourceKey: "growth", sourceScoreKey: "score_0_100" },
  { key: "upsidePotential", summaryKey: "upsidePotentialScore", sourceKey: "upside_downside", sourceScoreKey: "upside_score_0_100" },
  { key: "downsidePressure", summaryKey: "downsidePressureScore", sourceKey: "upside_downside", sourceScoreKey: "downside_score_0_100", invertedDisplay: true },
  { key: "marketSimilarity", summaryKey: "marketSimilarityScore", sourceKey: "market_similarity", sourceScoreKey: "score_0_100" },
  { key: "durabilityProfitability", summaryKey: "durabilityProfitabilityScore", sourceKey: "durability_profitability", sourceScoreKey: "score_0_100" },
];

const SHORT_AXES = [
  { key: "technicalFlow", summaryKey: "technicalFlowScore", sourceKey: "technical_flow", sourceScoreKey: "score_0_100" },
  { key: "volumeLiquidityTrend", summaryKey: "volumeLiquidityTrendScore", sourceKey: "volume_liquidity_trend", sourceScoreKey: "score_0_100" },
  { key: "shortTermRelativeStrength", summaryKey: "shortTermRelativeStrengthScore", sourceKey: "short_term_relative_strength", sourceScoreKey: "score_0_100" },
  { key: "netOptionsProxy", summaryKey: "netOptionsProxyScore", sourceKey: "net_options_proxy", sourceScoreKey: "score_0_100" },
  { key: "offExchangeActivityProxy", summaryKey: "offExchangeActivityProxyScore", sourceKey: "off_exchange_activity_proxy", sourceScoreKey: "score_0_100", contextual: true },
  { key: "shortPressureProxy", summaryKey: "shortPressureProxyScore", sourceKey: "short_pressure_proxy", sourceScoreKey: "score_0_100", invertedDisplay: true },
];

const REQUIRED_SUMMARY_FIELDS = [
  "ticker",
  "longTermConvictionScore",
  "longTermConvictionCall",
  "shortTermScore",
  "shortTermConvictionScore",
  "shortTermConvictionCall",
  ...LONG_AXES.map((axis) => axis.summaryKey),
  ...SHORT_AXES.map((axis) => axis.summaryKey),
];

const UI_CONTRACTS = [
  {
    file: "src/app/stock/[ticker]/FenokSignalLensCard.tsx",
    markers: [
      "const LONG_TERM_AXIS_CONFIG",
      "const SHORT_TERM_AXIS_CONFIG",
      "function buildLongTermAxes",
      "function buildShortTermAxes",
      "FenokSignalRadarHexagon title=\"Short-term\"",
      "FenokSignalRadarHexagon title=\"Long-term\"",
    ],
  },
  {
    file: "src/hooks/useScreenerData.ts",
    markers: [
      "loadFenokSignalsSummaryMap",
      "fenokShortTermConvictionScore",
      "fenokLongTermConvictionScore",
      "netOptionsProxyScore",
      "shortPressureProxyScore",
    ],
  },
  {
    file: "src/app/screener/StockDetailPanel.tsx",
    markers: [
      "const DETAIL_LONG_TERM_AXIS_CONFIG",
      "const DETAIL_SHORT_TERM_AXIS_CONFIG",
      "function buildDetailLongTermAxes",
      "function buildDetailShortTermAxes",
      "FenokSignalRadarHexagonPair",
    ],
  },
  {
    file: "src/components/screener/FenokSignalRadarHexagon.tsx",
    markers: [
      "score: isFiniteNumber(axis.score) ? axis.score : null",
      "axis.score !== null ? axis.score : null",
      "axis.score !== null ? Math.round(axis.score) : \"—\"",
      "미확인",
      "axis.score !== null ? pointRadius : 0",
    ],
  },
];

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function round2(value) {
  return finite(value) ? Number(value.toFixed(2)) : null;
}

function nearlyEqual(a, b, epsilon = 0.011) {
  return finite(a) && finite(b) && Math.abs(a - b) <= epsilon;
}

function tickerOf(value) {
  return String(value ?? "").trim().toUpperCase();
}

function fieldValue(row, fields, key) {
  if (Array.isArray(row)) {
    const index = fields.indexOf(key);
    return index >= 0 ? row[index] : undefined;
  }
  return row?.[key];
}

function sourceScore(sourceRow, axis) {
  const signal = sourceRow?.signals?.[axis.sourceKey];
  const value = signal?.[axis.sourceScoreKey];
  return finite(value) ? value : null;
}

function convictionCallFromScore(score) {
  if (score !== null && score >= 70) return "concentrated";
  if (score !== null && score <= 40) return "diluted";
  return "mixed";
}

function average(scores) {
  const present = scores.filter(finite);
  return present.length > 0 ? round2(present.reduce((sum, score) => sum + score, 0) / present.length) : null;
}

function computeLongTermComposite(sourceRow) {
  const signals = sourceRow?.signals ?? {};
  const downsidePressure = signals.upside_downside?.downside_score_0_100;
  return average([
    signals.profitability?.score_0_100,
    signals.growth?.score_0_100,
    signals.upside_downside?.upside_score_0_100,
    finite(downsidePressure) ? 100 - downsidePressure : null,
    signals.durability_profitability?.score_0_100,
  ]);
}

function computeShortTermComposite(sourceRow) {
  const signals = sourceRow?.signals ?? {};
  const shortPressure = signals.short_pressure_proxy?.score_0_100;
  return average([
    signals.technical_flow?.score_0_100,
    signals.volume_liquidity_trend?.score_0_100,
    signals.short_term_relative_strength?.score_0_100,
    signals.net_options_proxy?.score_0_100,
    finite(shortPressure) ? 100 - shortPressure : null,
  ]);
}

function first(items, limit = 8) {
  return items.slice(0, limit);
}

function addExample(bucket, key, value) {
  if (!bucket[key]) bucket[key] = [];
  if (bucket[key].length < 8) bucket[key].push(value);
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}

function requireUiContracts(errors) {
  for (const contract of UI_CONTRACTS) {
    const absPath = path.join(appRoot, contract.file);
    if (!fs.existsSync(absPath)) {
      errors.push(`${contract.file}: missing UI consumer file`);
      continue;
    }
    const text = fs.readFileSync(absPath, "utf8");
    for (const marker of contract.markers) {
      if (!text.includes(marker)) errors.push(`${contract.file}: missing marker '${marker}'`);
    }
  }
}

const activePayload = readJson(path.join(dataRoot, "global-scouter/core/stocks_analyzer.json"));
const sourceSummaryRaw = fs.readFileSync(path.join(dataRoot, "computed/fenok_signals_summary.json"), "utf8");
const publicSummaryRaw = fs.readFileSync(path.join(publicDataRoot, "computed/fenok_signals_summary.json"), "utf8");
const summary = JSON.parse(sourceSummaryRaw);
const source = readJson(path.join(dataRoot, "computed/fenok_signals.json"));
const marketFactsIndex = readJson(path.join(dataRoot, "computed/market_facts/index.json"));

const activeTickers = (Array.isArray(activePayload.data) ? activePayload.data : [])
  .map((row) => tickerOf(row?.symbol))
  .filter(Boolean);
const summaryFields = Array.isArray(summary.fields) ? summary.fields : [];
const summaryRows = Array.isArray(summary.rows) ? summary.rows : [];
const sourceRows = Array.isArray(source.rows) ? source.rows : [];

const summaryByTicker = new Map(summaryRows.map((row) => [tickerOf(fieldValue(row, summaryFields, "ticker")), row]));
const sourceByTicker = new Map(sourceRows.map((row) => [tickerOf(row?.ticker), row]));

const errors = [];
const warnings = [];
const examples = {};
const axisCounts = Object.fromEntries([...LONG_AXES, ...SHORT_AXES].map((axis) => [axis.key, 0]));
const axisMissingCounts = Object.fromEntries([...LONG_AXES, ...SHORT_AXES].map((axis) => [axis.key, 0]));
const counts = {
  activeStocks: activeTickers.length,
  summaryRows: summaryRows.length,
  sourceRows: sourceRows.length,
  missingSummaryRows: 0,
  missingSourceRows: 0,
  longGroupMissing: 0,
  shortGroupMissing: 0,
  longHexagonEmpty: 0,
  shortHexagonEmpty: 0,
  fullLongHexagon: 0,
  fullShortHexagon: 0,
  unsupportedZero: 0,
  compositeMismatch: 0,
  callMismatch: 0,
  etfRows: 0,
};

if (activeTickers.length !== EXPECTED_ACTIVE_STOCK_COUNT) {
  errors.push(`active stock universe count ${activeTickers.length} != ${EXPECTED_ACTIVE_STOCK_COUNT}`);
}
if (summary.coverage?.row_count !== activeTickers.length) {
  errors.push(`summary coverage.row_count ${summary.coverage?.row_count} != active stock count ${activeTickers.length}`);
}
if (summaryRows.length !== activeTickers.length) {
  errors.push(`summary rows ${summaryRows.length} != active stock count ${activeTickers.length}`);
}
if (sourceRows.length !== activeTickers.length) {
  errors.push(`source fenok_signals rows ${sourceRows.length} != active stock count ${activeTickers.length}`);
}
if (sourceSummaryRaw !== publicSummaryRaw) {
  errors.push("data/computed/fenok_signals_summary.json and public/data/computed/fenok_signals_summary.json differ");
}
if (marketFactsIndex?.count === summaryRows.length || marketFactsIndex?.coverage?.etf === summaryRows.length) {
  errors.push("fenok signal summary appears to be using market_facts total/ETF denominator instead of S0 active stocks");
}

for (const field of REQUIRED_SUMMARY_FIELDS) {
  if (!summaryFields.includes(field)) errors.push(`summary missing required field '${field}'`);
}

for (const duplicate of duplicateValues(activeTickers)) errors.push(`active stock duplicate ticker '${duplicate}'`);
for (const duplicate of duplicateValues([...summaryByTicker.keys()].filter(Boolean))) errors.push(`summary duplicate ticker '${duplicate}'`);
for (const duplicate of duplicateValues([...sourceByTicker.keys()].filter(Boolean))) errors.push(`source duplicate ticker '${duplicate}'`);

requireUiContracts(errors);

for (const ticker of activeTickers) {
  const summaryRow = summaryByTicker.get(ticker);
  const sourceRow = sourceByTicker.get(ticker);

  if (!summaryRow) {
    counts.missingSummaryRows += 1;
    addExample(examples, "missingSummaryRows", ticker);
    continue;
  }
  if (!sourceRow) {
    counts.missingSourceRows += 1;
    addExample(examples, "missingSourceRows", ticker);
    continue;
  }

  const marketFactsPath = path.join(dataRoot, "computed/market_facts/tickers", `${ticker}.json`);
  if (fs.existsSync(marketFactsPath)) {
    const marketFacts = readJson(marketFactsPath);
    if (marketFacts?.asset_type === "etf") {
      counts.etfRows += 1;
      addExample(examples, "etfRows", ticker);
    }
  }

  let longAvailable = 0;
  let shortAvailable = 0;
  for (const axis of LONG_AXES) {
    const summaryValue = fieldValue(summaryRow, summaryFields, axis.summaryKey);
    const sourceValue = sourceScore(sourceRow, axis);
    if (finite(summaryValue)) {
      axisCounts[axis.key] += 1;
      longAvailable += 1;
    } else {
      axisMissingCounts[axis.key] += 1;
    }
    if (finite(sourceValue) && !nearlyEqual(summaryValue, sourceValue, 0.001)) {
      errors.push(`${ticker}: ${axis.summaryKey} summary/source mismatch (${summaryValue} != ${sourceValue})`);
    }
    if (!finite(sourceValue) && finite(summaryValue)) {
      counts.unsupportedZero += summaryValue === 0 ? 1 : 0;
      errors.push(`${ticker}: ${axis.summaryKey} is finite in summary but source ${axis.sourceKey}.${axis.sourceScoreKey} is missing`);
    }
  }
  for (const axis of SHORT_AXES) {
    const summaryValue = fieldValue(summaryRow, summaryFields, axis.summaryKey);
    const sourceValue = sourceScore(sourceRow, axis);
    if (finite(summaryValue)) {
      axisCounts[axis.key] += 1;
      shortAvailable += 1;
    } else {
      axisMissingCounts[axis.key] += 1;
    }
    if (finite(sourceValue) && !nearlyEqual(summaryValue, sourceValue, 0.001)) {
      errors.push(`${ticker}: ${axis.summaryKey} summary/source mismatch (${summaryValue} != ${sourceValue})`);
    }
    if (!finite(sourceValue) && finite(summaryValue)) {
      counts.unsupportedZero += summaryValue === 0 ? 1 : 0;
      errors.push(`${ticker}: ${axis.summaryKey} is finite in summary but source ${axis.sourceKey}.${axis.sourceScoreKey} is missing`);
    }
  }

  if (longAvailable === 0) {
    counts.longHexagonEmpty += 1;
    addExample(examples, "longHexagonEmpty", ticker);
  }
  if (shortAvailable === 0) {
    counts.shortHexagonEmpty += 1;
    addExample(examples, "shortHexagonEmpty", ticker);
  }
  if (longAvailable === LONG_AXES.length) counts.fullLongHexagon += 1;
  if (shortAvailable === SHORT_AXES.length) counts.fullShortHexagon += 1;

  const longTermScore = fieldValue(summaryRow, summaryFields, "longTermConvictionScore");
  const shortTermScore = fieldValue(summaryRow, summaryFields, "shortTermConvictionScore");
  const shortTermAlias = fieldValue(summaryRow, summaryFields, "shortTermScore");
  const expectedLong = computeLongTermComposite(sourceRow);
  const expectedShort = computeShortTermComposite(sourceRow);

  if (!finite(longTermScore)) {
    counts.longGroupMissing += 1;
    addExample(examples, "longGroupMissing", ticker);
  } else if (!nearlyEqual(longTermScore, expectedLong)) {
    counts.compositeMismatch += 1;
    errors.push(`${ticker}: longTermConvictionScore ${longTermScore} != recomputed ${expectedLong}`);
  }
  if (!finite(shortTermScore)) {
    counts.shortGroupMissing += 1;
    addExample(examples, "shortGroupMissing", ticker);
  } else if (!nearlyEqual(shortTermScore, expectedShort)) {
    counts.compositeMismatch += 1;
    errors.push(`${ticker}: shortTermConvictionScore ${shortTermScore} != recomputed ${expectedShort}`);
  }
  if (!nearlyEqual(shortTermAlias, shortTermScore, 0.001)) {
    errors.push(`${ticker}: shortTermScore alias ${shortTermAlias} != shortTermConvictionScore ${shortTermScore}`);
  }

  const longCall = fieldValue(summaryRow, summaryFields, "longTermConvictionCall");
  const shortCall = fieldValue(summaryRow, summaryFields, "shortTermConvictionCall");
  if (longCall !== convictionCallFromScore(longTermScore)) {
    counts.callMismatch += 1;
    errors.push(`${ticker}: longTermConvictionCall ${longCall} does not match score ${longTermScore}`);
  }
  if (shortCall !== convictionCallFromScore(shortTermScore)) {
    counts.callMismatch += 1;
    errors.push(`${ticker}: shortTermConvictionCall ${shortCall} does not match score ${shortTermScore}`);
  }
}

if (counts.missingSummaryRows > 0) errors.push(`${counts.missingSummaryRows} active stocks missing summary rows`);
if (counts.missingSourceRows > 0) errors.push(`${counts.missingSourceRows} active stocks missing source rows`);
if (counts.longGroupMissing > 0) errors.push(`${counts.longGroupMissing} active stocks missing long-term group score`);
if (counts.shortGroupMissing > 0) errors.push(`${counts.shortGroupMissing} active stocks missing short-term group score`);
if (counts.longHexagonEmpty > 0) errors.push(`${counts.longHexagonEmpty} active stocks have no long-term hexagon axes`);
if (counts.shortHexagonEmpty > 0) errors.push(`${counts.shortHexagonEmpty} active stocks have no short-term hexagon axes`);
if (counts.etfRows > 0) errors.push(`${counts.etfRows} active signal rows are market_facts ETF rows`);

if (counts.fullLongHexagon < activeTickers.length) {
  warnings.push(`full long-term 6-axis coverage is ${counts.fullLongHexagon}/${activeTickers.length}; missing axes must render as null/미확인, not as done.`);
}
if (counts.fullShortHexagon < activeTickers.length) {
  warnings.push(`full short-term 6-axis coverage is ${counts.fullShortHexagon}/${activeTickers.length}; optional proxy gaps must render as null/미확인, not as done.`);
}

const report = {
  ok: errors.length === 0,
  scope: "S0 active stock universe only",
  counts,
  axisCounts,
  axisMissingCounts,
  examples,
  warnings,
};

if (errors.length > 0) {
  console.error("[fenok-signal-lens] dual-hexagon gate failed");
  for (const message of first(errors, 30)) console.error(`- ${message}`);
  if (errors.length > 30) console.error(`- ... ${errors.length - 30} more`);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

console.log(JSON.stringify(report, null, 2));
