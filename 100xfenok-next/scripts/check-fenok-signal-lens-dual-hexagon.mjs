#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  NATIVE_SIGNAL_FORMULA_VERSION,
  buildShortTermConvictionComposite,
  shortTermConvictionCallFromScore,
} from "../../scripts/lib/fenok-proxy-formula-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(appRoot, "public", "data");

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

const PUBLIC_SUMMARY_FIELDS = [
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
  "shortTermCommonBasisScore",
  "shortTermCommonBasisCall",
  "shortTermInputCount",
  "shortTermBasisCode",
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
const PUBLIC_SUMMARY_TOP_LEVEL_KEYS = [
  "contract_doc",
  "coverage",
  "field_semantics",
  "fields",
  "formula_version",
  "generated_at",
  "public_surface_status",
  "rows",
  "schema_version",
  "source_file",
];
const FULL_SHORT_TERM_COMPOSITE_KEYS = [
  "common_basis_score_0_100",
  "common_basis_call",
  "conviction_score_0_100",
  "conviction_call",
  "input_count",
  "basis_code",
];
const PRIVATE_SOURCE_PUBLIC_PATH = path.join(publicDataRoot, "computed/fenok_signals.json");

// FenokSignalLensCard.tsx contract removed 2026-07-06 (legacy L2): the card
// was the ?v2=0 stock branch surface; the CANVAS+ equivalents live in
// screener/StockDetailPanel.tsx whose contract below covers the same markers.
const UI_CONTRACTS = [
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
      "Fenok Edge Score",
      "Short Edge",
      "Long Edge",
    ],
  },
  {
    // Chart body split out of FenokSignalRadarHexagon.tsx (ssr:false isolation,
    // P1 bundle diet 2026-07-06); the null-honesty render contract lives in the
    // chart implementation file.
    file: "src/components/screener/FenokSignalRadarHexagonChart.tsx",
    markers: [
      "score: isFiniteNumber(axis.score) ? axis.score : null",
      "axis.score !== null ? axis.score : null",
      "axis.score !== null ? Math.round(axis.score) : \"—\"",
      "미확인",
      "axis.score !== null ? pointRadius : 0",
    ],
  },
];

const AWKWARD_SIGNAL_COPY_MARKERS = [
  "위약",
  "우호",
  "하방안전",
  "숏안전",
  "역수",
  "오프거래소",
  "뉴스톤",
  "동등가중",
  "매수권유",
  "Feno 자동",
  "압박",
];

function readJsonArtifact(absPath, label, errors) {
  try {
    const raw = fs.readFileSync(absPath, "utf8");
    return { exists: true, raw, value: JSON.parse(raw) };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, raw: null, value: null };
    errors.push(`read ${label}: ${error.message}`);
    return { exists: true, raw: null, value: null };
  }
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

function rawSourceScore(sourceRow, axis) {
  return sourceRow?.signals?.[axis.sourceKey]?.[axis.sourceScoreKey];
}

function validScore(value) {
  return finite(value) && value >= 0 && value <= 100;
}

function hasMissingSignalReason(sourceRow, axis) {
  const signal = sourceRow?.signals?.[axis.sourceKey];
  if (!signal || typeof signal !== "object" || Array.isArray(signal)) return false;
  if (rawSourceScore(sourceRow, axis) != null) return false;
  const status = typeof signal.status === "string" ? signal.status.trim().toLowerCase() : "";
  const basis = typeof signal.basis === "string" ? signal.basis.trim().toLowerCase() : "";
  const direction = typeof signal.direction === "string" ? signal.direction.trim().toLowerCase() : "";
  const positiveState = /^(ready|available|fresh|complete|done|ok)(?:_|$)/;
  const missingState = /(?:missing|unavailable|not_(?:available|present|covered)|no_(?:data|source|input|coverage))/;
  if (positiveState.test(status) || positiveState.test(basis)) return false;
  if (direction && direction !== "unavailable") return false;
  return direction === "unavailable"
    || signal.coverage_ratio === 0
    || missingState.test(status)
    || missingState.test(basis)
    || (Array.isArray(signal.missing_inputs) && signal.missing_inputs.length > 0);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sameKeys(value, expected) {
  return isObject(value)
    && sameJson(Object.keys(value).sort(), [...expected].sort());
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
  return buildShortTermConvictionComposite(sourceRow?.signals, sourceRow?.market_scope);
}

function validateFullShortTermComposite(ticker, sourceRow, errors) {
  const actual = sourceRow?.short_term_composite;
  if (!sameKeys(actual, FULL_SHORT_TERM_COMPOSITE_KEYS)) {
    errors.push(`${ticker}: short_term_composite must contain the exact Stage A fields`);
    return;
  }
  const expectedComposite = computeShortTermComposite(sourceRow);
  const expected = {
    common_basis_score_0_100: expectedComposite.shortTermCommonBasisScore,
    common_basis_call: expectedComposite.shortTermCommonBasisCall,
    conviction_score_0_100: expectedComposite.shortTermConvictionScore,
    conviction_call: expectedComposite.shortTermConvictionCall,
    input_count: expectedComposite.shortTermInputCount,
    basis_code: expectedComposite.shortTermBasisCode,
  };
  for (const key of FULL_SHORT_TERM_COMPOSITE_KEYS) {
    if (actual[key] !== expected[key]) {
      errors.push(`${ticker}: short_term_composite.${key} ${actual[key]} != recomputed ${expected[key]}`);
    }
  }
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

function readUiContractFile(file, errors) {
  const absPath = path.join(appRoot, file);
  if (!fs.existsSync(absPath)) {
    errors.push(`${file}: missing UI consumer file`);
    return null;
  }
  try {
    return fs.readFileSync(absPath, "utf8");
  } catch (error) {
    errors.push(`${file}: cannot read UI consumer file: ${error.message}`);
    return null;
  }
}

function requireUiContracts(errors) {
  for (const contract of UI_CONTRACTS) {
    const text = readUiContractFile(contract.file, errors);
    if (text == null) continue;
    for (const marker of contract.markers) {
      if (!text.includes(marker)) errors.push(`${contract.file}: missing marker '${marker}'`);
    }
  }
  for (const file of [
    "src/app/screener/StockDetailPanel.tsx",
  ]) {
    const text = readUiContractFile(file, errors);
    if (text == null) continue;
    const shortPressureBlock = /key:\s*"shortPressureProxy"[\s\S]*?fullLabel:\s*"숏압력 완화"[\s\S]*?invertScore:\s*true[\s\S]*?높을수록 압력 낮음/.test(text);
    if (!shortPressureBlock) {
      errors.push(`${file}: shortPressureProxy hexagon axis must render as inverted safety display`);
    }
    if (!text.includes('spokeLabel: "숏완화"')) {
      errors.push(`${file}: shortPressureProxy spoke label must render as compact Korean copy '숏완화'`);
    }
    if (!text.includes("getDisplaySignalHelpBands(helpKey, invertedDisplay)")) {
      errors.push(`${file}: signal help bands must use display-aware inverted bands`);
    }
    for (const marker of AWKWARD_SIGNAL_COPY_MARKERS) {
      if (text.includes(marker)) {
        errors.push(`${file}: signal lens copy must not use awkward marker '${marker}'`);
      }
    }
  }

  const helpConfigFile = "src/lib/fenok-signals/signal-help-config.ts";
  const helpConfig = readUiContractFile(helpConfigFile, errors);
  if (helpConfig != null) {
    for (const marker of [
      "const SHORT_PRESSURE_SAFETY_BANDS",
      "const DOWNSIDE_SAFETY_BANDS",
      "export function getDisplaySignalHelpBands",
      "export function getDisplaySignalLabel",
      "export function getDisplaySignalInterpretation",
      "하락 압력 완화",
      "숏압력 완화",
      "장외거래",
      "뉴스 톤",
      "약함",
      "양호",
    ]) {
      if (!helpConfig.includes(marker)) {
        errors.push(`${helpConfigFile}: missing display-aware help marker '${marker}'`);
      }
    }
    for (const marker of AWKWARD_SIGNAL_COPY_MARKERS) {
      if (helpConfig.includes(marker)) {
        errors.push(`${helpConfigFile}: signal help copy must not use awkward marker '${marker}'`);
      }
    }
  }

  const directionKoFile = "src/lib/fenok-signals/direction-ko.ts";
  const directionKo = readUiContractFile(directionKoFile, errors);
  if (directionKo != null
    && (!directionKo.includes('stressed: "압력 큼"') || directionKo.includes("압박"))) {
    errors.push(`${directionKoFile}: stressed direction label must render as '압력 큼'`);
  }

  const popoverFile = "src/components/screener/FenokSignalHelpPopover.tsx";
  const popover = readUiContractFile(popoverFile, errors);
  if (popover != null && !popover.includes("usePopoverPosition(triggerRef, popoverRef, placement, isOpen)")) {
    errors.push(`${popoverFile}: popover positioning must be recalculated when opened`);
  }

  const popoverHookFile = "src/hooks/usePopoverPosition.ts";
  const popoverHook = readUiContractFile(popoverHookFile, errors);
  if (popoverHook != null
    && (!popoverHook.includes("enabled = true") || !popoverHook.includes("if (!enabled)") || !popoverHook.includes("placement, enabled"))) {
    errors.push(`${popoverHookFile}: hook must expose an enabled gate and rerun on open state`);
  }
}

const errors = [];
const warnings = [];
const examples = {};
requireUiContracts(errors);

const stockActionPath = path.join(dataRoot, "computed/stock_action_index.json");
const sourceSummaryPath = path.join(dataRoot, "computed/fenok_signals_summary.json");
const publicSummaryPath = path.join(publicDataRoot, "computed/fenok_signals_summary.json");
const sourcePath = path.join(dataRoot, "computed/fenok_signals.json");
const marketFactsIndexPath = path.join(dataRoot, "computed/market_facts/index.json");
const stockActionArtifact = readJsonArtifact(stockActionPath, "data/computed/stock_action_index.json", errors);
const sourceSummaryArtifact = readJsonArtifact(sourceSummaryPath, "data/computed/fenok_signals_summary.json", errors);
const publicSummaryArtifact = readJsonArtifact(publicSummaryPath, "public/data/computed/fenok_signals_summary.json", errors);
const sourceArtifact = readJsonArtifact(sourcePath, "data/computed/fenok_signals.json", errors);
const marketFactsArtifact = readJsonArtifact(marketFactsIndexPath, "data/computed/market_facts/index.json", errors);

if (!stockActionArtifact.exists) warnings.push("Fenok Signal Lens is DEGRADED: stock_action_index source artifact is missing");
if (!sourceArtifact.exists) warnings.push("Fenok Signal Lens is DEGRADED: full signal source artifact is missing");
if (!marketFactsArtifact.exists) warnings.push("Fenok Signal Lens is DEGRADED: market_facts index source artifact is missing");
if (!sourceSummaryArtifact.exists && !publicSummaryArtifact.exists) {
  warnings.push("Fenok Signal Lens is DEGRADED: root and public summary artifacts are both missing");
} else if (sourceSummaryArtifact.exists !== publicSummaryArtifact.exists) {
  errors.push("Fenok Signal Lens summary mirror is one-sided between root and public");
} else if (sourceSummaryArtifact.raw != null && publicSummaryArtifact.raw != null
  && sourceSummaryArtifact.raw !== publicSummaryArtifact.raw) {
  errors.push("data/computed/fenok_signals_summary.json and public/data/computed/fenok_signals_summary.json differ");
}
if (fs.existsSync(PRIVATE_SOURCE_PUBLIC_PATH)) {
  errors.push("private full Fenok signal payload must not exist under public/data/computed/fenok_signals.json");
}

for (const [artifact, name] of [
  [stockActionArtifact, "stock_action_index"],
  [sourceSummaryArtifact, "Fenok signal summary"],
  [publicSummaryArtifact, "public Fenok signal summary"],
  [sourceArtifact, "Fenok signal source"],
  [marketFactsArtifact, "market_facts index"],
]) {
  if (artifact.exists && !isObject(artifact.value)) errors.push(`${name} must be a JSON object`);
}

const stockActionIndex = isObject(stockActionArtifact.value) ? stockActionArtifact.value : {};
const summary = isObject(sourceSummaryArtifact.value) ? sourceSummaryArtifact.value : {};
const publicSummary = isObject(publicSummaryArtifact.value) ? publicSummaryArtifact.value : {};
const source = isObject(sourceArtifact.value) ? sourceArtifact.value : {};
const marketFactsIndex = isObject(marketFactsArtifact.value) ? marketFactsArtifact.value : {};

const stockActionRows = Array.isArray(stockActionIndex.rows) ? stockActionIndex.rows : [];
const summaryFields = Array.isArray(summary.fields) ? summary.fields : [];
const summaryRows = Array.isArray(summary.rows) ? summary.rows : [];
const sourceRows = Array.isArray(source.rows) ? source.rows : [];
const marketFactsRows = Array.isArray(marketFactsIndex.rows) ? marketFactsIndex.rows : [];

if (stockActionArtifact.value && !Array.isArray(stockActionIndex.rows)) errors.push("stock_action_index.rows must be an array");
if (sourceSummaryArtifact.value && !Array.isArray(summary.fields)) errors.push("summary.fields must be an array");
if (sourceSummaryArtifact.value && !Array.isArray(summary.rows)) errors.push("summary.rows must be an array");
if (sourceArtifact.value && !Array.isArray(source.rows)) errors.push("source fenok_signals.rows must be an array");
if (marketFactsArtifact.value && !Array.isArray(marketFactsIndex.rows)) errors.push("market_facts index.rows must be an array");

if (sourceSummaryArtifact.value && !sameKeys(summary, PUBLIC_SUMMARY_TOP_LEVEL_KEYS)) {
  errors.push("Fenok signal summary contains an unexpected or missing public top-level field");
}
if (publicSummaryArtifact.value && !sameKeys(publicSummary, PUBLIC_SUMMARY_TOP_LEVEL_KEYS)) {
  errors.push("public Fenok signal summary contains an unexpected or missing public top-level field");
}
if (sourceSummaryArtifact.value && !sameJson(summaryFields, PUBLIC_SUMMARY_FIELDS)) {
  errors.push("Fenok signal summary fields differ from the public allowlist");
}
if (sourceSummaryArtifact.value && (typeof summary.generated_at !== "string" || summary.generated_at.trim() === "")) {
  errors.push("Fenok signal summary generated_at must be a non-empty string");
}
if (sourceArtifact.value && (typeof source.generated_at !== "string" || source.generated_at.trim() === "")) {
  errors.push("Fenok signal source generated_at must be a non-empty string");
}
for (const [label, payload] of [
  ["source fenok_signals", sourceArtifact.value],
  ["root Fenok signal summary", sourceSummaryArtifact.value],
  ["public Fenok signal summary", publicSummaryArtifact.value],
]) {
  if (payload && payload.formula_version !== NATIVE_SIGNAL_FORMULA_VERSION) {
    errors.push(`${label} formula_version must be ${NATIVE_SIGNAL_FORMULA_VERSION}; got ${payload.formula_version ?? "missing"}`);
  }
}
for (const [index, row] of summaryRows.entries()) {
  if (!Array.isArray(row)) errors.push(`summary row ${index} must be a compact array`);
  else if (row.length !== summaryFields.length) {
    errors.push(`summary row ${index} length ${row.length} != fields length ${summaryFields.length}`);
  }
  if (!Array.isArray(row)) continue;
  const ticker = tickerOf(fieldValue(row, summaryFields, "ticker")) || `row ${index}`;
  for (const key of ["convictionScore", "upsideDownsideScore"]) {
    const value = fieldValue(row, summaryFields, key);
    if (value != null && !validScore(value)) errors.push(`${ticker}: ${key} must be null or a finite 0..100 number`);
  }
  for (const key of ["coverageRatio", "durabilityProfitabilityCoverage"]) {
    const value = fieldValue(row, summaryFields, key);
    if (value != null && (!finite(value) || value < 0 || value > 1)) {
      errors.push(`${ticker}: ${key} must be null or a finite 0..1 number`);
    }
  }
}
for (const [index, row] of sourceRows.entries()) {
  if (!isObject(row)) {
    errors.push(`source row ${index} must be an object`);
    continue;
  }
  const ticker = tickerOf(row.ticker) || `source row ${index}`;
  if (!isObject(row.signals)) errors.push(`${ticker}: signals must be an object`);
  if (row.formula_version !== NATIVE_SIGNAL_FORMULA_VERSION) {
    errors.push(`${ticker}: formula_version must be ${NATIVE_SIGNAL_FORMULA_VERSION}; got ${row.formula_version ?? "missing"}`);
  }
  validateFullShortTermComposite(ticker, row, errors);
}

if (stockActionArtifact.value) {
  const indexedCount = stockActionIndex.coverage?.indexed_stock_count;
  if (!Number.isInteger(indexedCount) || indexedCount < 0) {
    errors.push(`stock_action_index coverage.indexed_stock_count must be a non-negative integer, got ${indexedCount}`);
  } else if (indexedCount !== stockActionRows.length) {
    errors.push(`count reconciliation failed: stock_action_index indexed_stock_count ${indexedCount} != rows ${stockActionRows.length}`);
  }
}
if (sourceSummaryArtifact.value) {
  if (!Number.isInteger(summary.coverage?.row_count) || summary.coverage.row_count < 0) {
    errors.push(`summary coverage.row_count must be a non-negative integer, got ${summary.coverage?.row_count}`);
  } else if (summary.coverage.row_count !== summaryRows.length) {
    errors.push(`count reconciliation failed: summary coverage.row_count ${summary.coverage.row_count} != actual summary rows ${summaryRows.length}`);
  }
}
if (sourceArtifact.value) {
  if (!Number.isInteger(source.coverage?.row_count) || source.coverage.row_count < 0) {
    errors.push(`source coverage.row_count must be a non-negative integer, got ${source.coverage?.row_count}`);
  } else if (source.coverage.row_count !== sourceRows.length) {
    errors.push(`count reconciliation failed: source coverage.row_count ${source.coverage.row_count} != actual source rows ${sourceRows.length}`);
  }
}
if (marketFactsArtifact.value) {
  if (!Number.isInteger(marketFactsIndex.count) || marketFactsIndex.count < 0) {
    errors.push(`market_facts count must be a non-negative integer, got ${marketFactsIndex.count}`);
  } else if (marketFactsIndex.count !== marketFactsRows.length) {
    errors.push(`count reconciliation failed: market_facts count ${marketFactsIndex.count} != rows ${marketFactsRows.length}`);
  }
}

const stockActionTickers = stockActionRows.map((row) => tickerOf(row?.symbol));
for (const [index, row] of stockActionRows.entries()) {
  if (!isObject(row)) {
    errors.push(`stock_action_index row ${index} must be an object`);
    continue;
  }
  if (!tickerOf(row.symbol)) errors.push(`stock_action_index row ${index} missing stock identity`);
  if (row.asset_type != null && row.asset_type !== "stock") {
    errors.push(`stock_action_index contains non-stock row '${tickerOf(row.symbol) || index}'`);
  }
}
const activeTickers = stockActionRows
  .filter((row) => isObject(row) && (row.asset_type ?? "stock") === "stock")
  .map((row) => tickerOf(row.symbol))
  .filter(Boolean);
const summaryTickers = summaryRows.map((row) => tickerOf(fieldValue(row, summaryFields, "ticker")));
const sourceTickers = sourceRows.map((row) => tickerOf(row?.ticker));
const summaryByTicker = new Map(summaryRows.map((row, index) => [summaryTickers[index], row]));
const sourceByTicker = new Map(sourceRows.map((row, index) => [sourceTickers[index], row]));
const activeTickerSet = new Set(activeTickers);
const hasActiveUniverse = stockActionArtifact.value && Array.isArray(stockActionIndex.rows);
const analysisTickers = hasActiveUniverse
  ? activeTickers
  : [...new Set([...summaryTickers, ...sourceTickers].filter(Boolean))].sort();

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
  honestNullScores: 0,
  summaryBehindSource: 0,
  unreasonedNullScores: 0,
};

function inspectAxis(ticker, summaryRow, sourceRow, axis) {
  const summaryValue = fieldValue(summaryRow, summaryFields, axis.summaryKey);
  const rawSourceValue = rawSourceScore(sourceRow, axis);
  const summaryIsValid = validScore(summaryValue);
  const sourceIsValid = validScore(rawSourceValue);

  if (summaryValue != null && !summaryIsValid) {
    errors.push(`${ticker}: ${axis.summaryKey} must be null or a finite 0..100 number`);
  }
  if (rawSourceValue != null && !sourceIsValid) {
    errors.push(`${ticker}: source ${axis.sourceKey}.${axis.sourceScoreKey} must be null or a finite 0..100 number`);
  }

  if (summaryIsValid) axisCounts[axis.key] += 1;
  else axisMissingCounts[axis.key] += 1;

  if (summaryIsValid && sourceIsValid && !nearlyEqual(summaryValue, rawSourceValue, 0.001)) {
    errors.push(`${ticker}: ${axis.summaryKey} summary/source mismatch (${summaryValue} != ${rawSourceValue})`);
  } else if (summaryIsValid && rawSourceValue == null) {
    counts.unsupportedZero += summaryValue === 0 ? 1 : 0;
    errors.push(`${ticker}: false-ready ${axis.summaryKey} is finite but source ${axis.sourceKey}.${axis.sourceScoreKey} is missing`);
  } else if (summaryValue == null && sourceIsValid) {
    counts.summaryBehindSource += 1;
    addExample(examples, "summaryBehindSource", `${ticker}:${axis.summaryKey}`);
  } else if (summaryValue == null && rawSourceValue == null) {
    if (hasMissingSignalReason(sourceRow, axis)) {
      counts.honestNullScores += 1;
      addExample(examples, "honestNullScores", `${ticker}:${axis.summaryKey}`);
    } else {
      counts.unreasonedNullScores += 1;
      errors.push(`${ticker}: ${axis.summaryKey} null score lacks an existing source reason`);
    }
  }

  return summaryIsValid;
}

function validateStandaloneSummaryRow(ticker, summaryRow) {
  const scoreFields = [
    ...LONG_AXES.map((axis) => axis.summaryKey),
    ...SHORT_AXES.map((axis) => axis.summaryKey),
    "longTermConvictionScore",
    "shortTermScore",
    "shortTermConvictionScore",
  ];
  for (const key of scoreFields) {
    const value = fieldValue(summaryRow, summaryFields, key);
    if (value != null && !validScore(value)) errors.push(`${ticker}: ${key} must be null or a finite 0..100 number`);
  }
}

function validateStandaloneSourceRow(ticker, sourceRow) {
  for (const axis of [...LONG_AXES, ...SHORT_AXES]) {
    const value = rawSourceScore(sourceRow, axis);
    if (value != null && !validScore(value)) {
      errors.push(`${ticker}: source ${axis.sourceKey}.${axis.sourceScoreKey} must be null or a finite 0..100 number`);
    } else if (value == null && !hasMissingSignalReason(sourceRow, axis)) {
      errors.push(`${ticker}: source ${axis.sourceKey}.${axis.sourceScoreKey} null score lacks an existing reason`);
    }
  }
}

if (sourceSummaryArtifact.value && summaryRows.length > 0
  && (marketFactsIndex?.count === summaryRows.length || marketFactsIndex?.coverage?.etf === summaryRows.length)) {
  errors.push("fenok signal summary appears to be using market_facts total/ETF denominator instead of S0 active stocks");
}
if (sourceSummaryArtifact.value && sourceArtifact.value && summary.generated_at !== source.generated_at) {
  warnings.push("Fenok Signal Lens is DEGRADED: full source and summary generation times are behind one another");
}

for (const duplicate of duplicateValues(stockActionTickers.filter(Boolean))) errors.push(`active stock duplicate ticker '${duplicate}'`);
for (const duplicate of duplicateValues(summaryTickers.filter(Boolean))) errors.push(`summary duplicate ticker '${duplicate}'`);
for (const duplicate of duplicateValues(sourceTickers.filter(Boolean))) errors.push(`source duplicate ticker '${duplicate}'`);
for (const ticker of summaryByTicker.keys()) {
  if (!ticker) errors.push("summary row missing ticker identity");
  else if (hasActiveUniverse && !activeTickerSet.has(ticker)) errors.push(`summary contains ticker outside active stock universe '${ticker}'`);
}
for (const ticker of sourceByTicker.keys()) {
  if (!ticker) errors.push("source row missing ticker identity");
  else if (hasActiveUniverse && !activeTickerSet.has(ticker)) errors.push(`source contains ticker outside active stock universe '${ticker}'`);
}

const contaminatedSourceTickers = new Set();
for (const sourceRow of sourceRows) {
  const ticker = tickerOf(sourceRow?.ticker);
  if (sourceRow?.asset_type != null && sourceRow.asset_type !== "stock") {
    contaminatedSourceTickers.add(ticker || "<missing>");
  }
  if (!ticker) continue;
  const marketFactsPath = path.join(dataRoot, "computed/market_facts/tickers", `${ticker}.json`);
  if (!fs.existsSync(marketFactsPath)) continue;
  const marketFactsArtifact = readJsonArtifact(
    marketFactsPath,
    `data/computed/market_facts/tickers/${ticker}.json`,
    errors,
  );
  if (marketFactsArtifact.exists && !isObject(marketFactsArtifact.value)) {
    errors.push(`${ticker}: market_facts payload must be a JSON object`);
  } else if (marketFactsArtifact.value?.asset_type !== "stock") {
    contaminatedSourceTickers.add(ticker);
  }
}
counts.etfRows = contaminatedSourceTickers.size;
for (const ticker of [...contaminatedSourceTickers].slice(0, 8)) addExample(examples, "etfRows", ticker);

for (const ticker of analysisTickers) {
  const summaryRow = summaryByTicker.get(ticker);
  const sourceRow = sourceByTicker.get(ticker);

  if (!summaryRow) {
    counts.missingSummaryRows += 1;
    addExample(examples, "missingSummaryRows", ticker);
  }
  if (!sourceRow) {
    counts.missingSourceRows += 1;
    addExample(examples, "missingSourceRows", ticker);
  }
  if (summaryRow && !sourceRow) validateStandaloneSummaryRow(ticker, summaryRow);
  if (sourceRow && !summaryRow) validateStandaloneSourceRow(ticker, sourceRow);
  if (!summaryRow || !sourceRow) continue;

  const summaryAsOf = fieldValue(summaryRow, summaryFields, "asOf");
  if (typeof summaryAsOf === "string" && typeof sourceRow.as_of === "string" && summaryAsOf !== sourceRow.as_of) {
    counts.summaryBehindSource += 1;
    addExample(examples, "summaryBehindSource", ticker);
  }

  let longAvailable = 0;
  let shortAvailable = 0;
  for (const axis of LONG_AXES) {
    if (inspectAxis(ticker, summaryRow, sourceRow, axis)) longAvailable += 1;
  }
  for (const axis of SHORT_AXES) {
    if (inspectAxis(ticker, summaryRow, sourceRow, axis)) shortAvailable += 1;
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

  if (longTermScore == null) {
    counts.longGroupMissing += 1;
    addExample(examples, "longGroupMissing", ticker);
    if (expectedLong !== null) {
      counts.summaryBehindSource += 1;
      addExample(examples, "summaryBehindSource", `${ticker}:longTermConvictionScore`);
    }
  } else if (!validScore(longTermScore)) {
    errors.push(`${ticker}: longTermConvictionScore must be null or a finite 0..100 number`);
  } else if (!nearlyEqual(longTermScore, expectedLong)) {
    counts.compositeMismatch += 1;
    errors.push(`${ticker}: false-ready longTermConvictionScore ${longTermScore} != recomputed ${expectedLong}`);
  }
  if (shortTermScore == null) {
    counts.shortGroupMissing += 1;
    addExample(examples, "shortGroupMissing", ticker);
    if (expectedShort.shortTermConvictionScore !== null) {
      counts.summaryBehindSource += 1;
      addExample(examples, "summaryBehindSource", `${ticker}:shortTermConvictionScore`);
    }
  } else if (!validScore(shortTermScore)) {
    errors.push(`${ticker}: shortTermConvictionScore must be null or a finite 0..100 number`);
  } else if (!nearlyEqual(shortTermScore, expectedShort.shortTermConvictionScore)) {
    counts.compositeMismatch += 1;
    errors.push(`${ticker}: false-ready shortTermConvictionScore ${shortTermScore} != recomputed ${expectedShort.shortTermConvictionScore}`);
  }
  if (shortTermAlias == null && shortTermScore == null) {
    // Honest missing group score: the lane degrades below without inventing an alias.
  } else if (!validScore(shortTermAlias)) {
    errors.push(`${ticker}: shortTermScore alias must be null or a finite 0..100 number`);
  } else if (!nearlyEqual(shortTermAlias, shortTermScore, 0.001)) {
    errors.push(`${ticker}: shortTermScore alias ${shortTermAlias} != shortTermConvictionScore ${shortTermScore}`);
  }

  const longCall = fieldValue(summaryRow, summaryFields, "longTermConvictionCall");
  const shortCall = fieldValue(summaryRow, summaryFields, "shortTermConvictionCall");
  const commonBasisScore = fieldValue(summaryRow, summaryFields, "shortTermCommonBasisScore");
  const commonBasisCall = fieldValue(summaryRow, summaryFields, "shortTermCommonBasisCall");
  const shortTermInputCount = fieldValue(summaryRow, summaryFields, "shortTermInputCount");
  const shortTermBasisCode = fieldValue(summaryRow, summaryFields, "shortTermBasisCode");
  if (longCall !== convictionCallFromScore(longTermScore)) {
    counts.callMismatch += 1;
    errors.push(`${ticker}: longTermConvictionCall ${longCall} does not match score ${longTermScore}`);
  }
  if (shortCall !== shortTermConvictionCallFromScore(shortTermScore)) {
    counts.callMismatch += 1;
    errors.push(`${ticker}: shortTermConvictionCall ${shortCall} does not match score ${shortTermScore}`);
  }
  if (commonBasisScore === null && expectedShort.shortTermCommonBasisScore === null) {
    // Honest missing common basis: both producer and summary fail closed.
  } else if (commonBasisScore !== null && !validScore(commonBasisScore)) {
    errors.push(`${ticker}: shortTermCommonBasisScore must be null or a finite 0..100 number`);
  } else if (!nearlyEqual(commonBasisScore, expectedShort.shortTermCommonBasisScore)) {
    counts.compositeMismatch += 1;
    errors.push(`${ticker}: shortTermCommonBasisScore ${commonBasisScore} != recomputed ${expectedShort.shortTermCommonBasisScore}`);
  }
  if (commonBasisCall !== shortTermConvictionCallFromScore(commonBasisScore)) {
    counts.callMismatch += 1;
    errors.push(`${ticker}: shortTermCommonBasisCall ${commonBasisCall} does not match score ${commonBasisScore}`);
  }
  if (shortTermInputCount !== expectedShort.shortTermInputCount) {
    errors.push(`${ticker}: shortTermInputCount ${shortTermInputCount} != recomputed ${expectedShort.shortTermInputCount}`);
  }
  if (shortTermBasisCode !== expectedShort.shortTermBasisCode) {
    errors.push(`${ticker}: shortTermBasisCode ${shortTermBasisCode} != recomputed ${expectedShort.shortTermBasisCode}`);
  }
}

if (activeTickers.length === 0) warnings.push("Fenok Signal Lens is DEGRADED: active stock universe is empty");
if (counts.missingSummaryRows > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.missingSummaryRows} active stocks missing summary rows`);
if (counts.missingSourceRows > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.missingSourceRows} active stocks missing source rows`);
if (counts.longGroupMissing > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.longGroupMissing} active stocks missing long-term group score`);
if (counts.shortGroupMissing > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.shortGroupMissing} active stocks missing short-term group score`);
if (counts.longHexagonEmpty > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.longHexagonEmpty} active stocks have no long-term hexagon axes`);
if (counts.shortHexagonEmpty > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.shortHexagonEmpty} active stocks have no short-term hexagon axes`);
if (counts.honestNullScores > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.honestNullScores} null axis score(s) retain source reasons`);
if (counts.summaryBehindSource > 0) warnings.push(`Fenok Signal Lens is DEGRADED: ${counts.summaryBehindSource} summary value(s) are behind available source evidence`);
if (counts.etfRows > 0) errors.push(`${counts.etfRows} Fenok stock signal row(s) are ETF-contaminated`);

if (counts.fullLongHexagon < activeTickers.length) {
  warnings.push(`full long-term 6-axis coverage is ${counts.fullLongHexagon}/${activeTickers.length}; missing axes must render as null/미확인, not as done.`);
}
if (counts.fullShortHexagon < activeTickers.length) {
  warnings.push(`full short-term 6-axis coverage is ${counts.fullShortHexagon}/${activeTickers.length}; optional proxy gaps must render as null/미확인, not as done.`);
}

const report = {
  ok: errors.length === 0,
  status: errors.length > 0 ? "blocked" : warnings.length > 0 ? "degraded" : "ready",
  scope: "public stock_action_index active stock universe",
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
