#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");

const SCHEMA_VERSION = "rim_index_inputs.v1";
const DEFAULT_OUTPUT = "computed/rim-index/inputs.json";
const DEFAULT_MIN_COVERED_WEIGHT = 0.75;
const ASSUMPTION_VERSION = "rim-assumptions-20260708";
const REVIEWED_AT = "2026-07-08";

const PRIMARY_INDICES = [
  {
    id: "SPX",
    label: "S&P 500",
    benchmarkFile: "benchmarks/us.json",
    benchmarkSection: "sp500",
    slickchartsIndex: "sp500",
    yieldFile: "slickcharts/sp500-yield.json",
  },
  {
    id: "NDX",
    label: "Nasdaq 100",
    benchmarkFile: "benchmarks/us.json",
    benchmarkSection: "nasdaq100",
    slickchartsIndex: "nasdaq100",
    yieldFile: "slickcharts/nasdaq100-yield.json",
  },
];

const SECONDARY_INDICES = [
  {
    id: "CCMP",
    label: "Nasdaq Composite",
    role: "secondary_input_only",
    benchmarkFile: "benchmarks/us.json",
    benchmarkSection: "nasdaq_composite",
    blockers: [
      "missing_named_constituent_weight_path",
      "missing_named_index_yield_path",
      "payout_and_growth_not_public_card_ready",
    ],
  },
  {
    id: "KOSPI",
    label: "KOSPI",
    role: "backlog_blocked",
    benchmarkFile: "benchmarks/emerging.json",
    benchmarkSection: "kospi",
    country: "Korea",
    blockers: [
      "country_risk_free_source_solved_not_wired",
      "missing_kospi_constituent_weight_path",
    ],
  },
  {
    id: "SOX",
    label: "PHLX Semiconductor / SOX candidate",
    role: "backlog_blocked",
    benchmarkFile: "benchmarks/micro_sectors.json",
    benchmarkSection: "philadelphia_semi",
    blockers: [
      "identity_mapping_philadelphia_semi_to_sox_unverified",
      "missing_sox_constituent_weight_path",
      "missing_sox_index_yield_path",
      "missing_sox_payout_coverage",
    ],
  },
];

const PROXY_CONSTITUENT_CANDIDATES = {
  CCMP: {
    proxyTicker: "ONEQ",
    source: "stockanalysis/etfs/ONEQ.json",
    exactIndexSubstitute: false,
    notes: [
      "Fidelity Nasdaq Composite ETF holdings are a proxy candidate only, not official Nasdaq Composite constituent weights.",
      "Top holding coverage is below the primary public-card threshold, so exact CCMP blockers remain.",
    ],
  },
  KOSPI: {
    proxyTicker: "EWY",
    source: "stockanalysis/etfs/EWY.json",
    exactIndexSubstitute: false,
    notes: [
      "iShares MSCI South Korea ETF holdings are a proxy candidate only, not official KOSPI constituent weights.",
      "KRX holding symbols are normalized for diagnostics only; public KOSPI RIM still requires an explicit proxy label or official KOSPI weights.",
    ],
  },
  SOX: {
    proxyTicker: "SOXX",
    source: "stockanalysis/etfs/SOXX.json",
    exactIndexSubstitute: false,
    notes: [
      "iShares Semiconductor ETF holdings are a proxy candidate only, not literal PHLX Semiconductor Index weights.",
      "High proxy coverage does not remove the SOX identity-mapping blocker.",
    ],
  },
};

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function numberOrNull(value) {
  const num = Number(value);
  return finite(num) ? num : null;
}

function round(value, digits = 6) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function readJson(absPath) {
  return JSON.parse(fs.readFileSync(absPath, "utf8"));
}

function readDataJson(relPath, root = dataRoot) {
  return readJson(path.join(root, relPath));
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body, "utf8");
  }
}

function latestDatedRow(rows, label) {
  const usable = (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row?.date === "string")
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (usable.length === 0) throw new Error(`${label}: no dated rows`);
  return usable.at(-1);
}

function latestBenchmarkRow(payload, section, sourceLabel) {
  const rows = payload?.sections?.[section]?.data;
  const row = latestDatedRow(rows, `${sourceLabel}:${section}`);
  const pxLast = numberOrNull(row.px_last);
  const bestEps = numberOrNull(row.best_eps);
  const priceToBook = numberOrNull(row.px_to_book_ratio);
  const roe = numberOrNull(row.roe);
  if (!finite(pxLast) || pxLast <= 0) throw new Error(`${sourceLabel}:${section}: invalid px_last`);
  if (!finite(bestEps) || bestEps <= 0) throw new Error(`${sourceLabel}:${section}: invalid best_eps`);
  if (!finite(priceToBook) || priceToBook <= 0) throw new Error(`${sourceLabel}:${section}: invalid px_to_book_ratio`);
  return {
    date: row.date,
    px_last: pxLast,
    best_eps: bestEps,
    best_pe_ratio: numberOrNull(row.best_pe_ratio),
    px_to_book_ratio: priceToBook,
    roe,
  };
}

function observedValue({ value, source, sourceField, asOf, label = null }) {
  return {
    value,
    source,
    source_field: sourceField,
    source_tier: "observed_source",
    as_of: asOf,
    ...(label ? { label } : {}),
  };
}

function derivedValue({ value, formula, sources, coverage = null, qa = null, notes = [] }) {
  return {
    value,
    formula,
    sources,
    source_tier: "derived_formula",
    ...(coverage ? { coverage } : {}),
    ...(qa ? { qa } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function formulaValue({ value, formula, sources, sourceTier = "derived_formula", coverage = null, notes = [] }) {
  return {
    value,
    formula,
    sources,
    source_tier: sourceTier,
    ...(coverage ? { coverage } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function blockedValue({ reason, candidate = null, sourceTier = "blocked_missing_source" }) {
  return {
    value: null,
    source_tier: sourceTier,
    reason,
    ...(candidate ? { candidate } : {}),
  };
}

function loadDgs10(macroPayload) {
  const row = latestDatedRow(macroPayload?.series?.DGS10, "macro/fred-banking-daily.json:series.DGS10");
  const value = numberOrNull(row.value);
  if (!finite(value) || value <= 0) throw new Error("DGS10 latest value is missing or invalid");
  return {
    value: round(value / 100, 8),
    date: row.date,
    raw_value_percent: value,
  };
}

function loadKr10y(macroPayload) {
  const rows = macroPayload?.series?.IRLTLT01KRM156N;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = latestDatedRow(rows, "macro/fred-banking-daily.json:series.IRLTLT01KRM156N");
  const value = numberOrNull(row.value);
  if (!finite(value) || value <= 0) return null;
  return {
    value: round(value / 100, 8),
    date: row.date,
    raw_value_percent: value,
  };
}

function loadUsErp(erpPayload) {
  const value = numberOrNull(erpPayload?.us_erp);
  if (!finite(value) || value <= 0) throw new Error("damodaran/erp.json: us_erp missing or invalid");
  return {
    value: round(value, 8),
    source_date: erpPayload?.metadata?.source_date ?? null,
    generated_at: erpPayload?.metadata?.generated_at ?? null,
  };
}

function buildBenchmarkObservedInputs(indexConfig, benchmarkRow) {
  const source = indexConfig.benchmarkFile;
  const prefix = `sections.${indexConfig.benchmarkSection}.data[-1]`;
  return {
    price: observedValue({
      value: round(benchmarkRow.px_last, 4),
      source,
      sourceField: `${prefix}.px_last`,
      asOf: benchmarkRow.date,
    }),
    forward_eps: observedValue({
      value: round(benchmarkRow.best_eps, 4),
      source,
      sourceField: `${prefix}.best_eps`,
      asOf: benchmarkRow.date,
    }),
    forward_pe: observedValue({
      value: round(benchmarkRow.best_pe_ratio, 4),
      source,
      sourceField: `${prefix}.best_pe_ratio`,
      asOf: benchmarkRow.date,
    }),
    price_to_book: observedValue({
      value: round(benchmarkRow.px_to_book_ratio, 4),
      source,
      sourceField: `${prefix}.px_to_book_ratio`,
      asOf: benchmarkRow.date,
    }),
    roe: observedValue({
      value: round(benchmarkRow.roe, 4),
      source,
      sourceField: `${prefix}.roe`,
      asOf: benchmarkRow.date,
    }),
  };
}

function buildBookValue(benchmarkRow) {
  return derivedValue({
    value: round(benchmarkRow.px_last / benchmarkRow.px_to_book_ratio, 4),
    formula: "price / price_to_book",
    sources: ["observed.price", "observed.price_to_book"],
  });
}

function buildPayoutRatio(indexConfig, benchmarkRow, yieldPayload, {
  dataRootForReads = dataRoot,
  yfRoot = path.join(dataRootForReads, "yf", "finance"),
} = {}) {
  const dividendYieldPct = numberOrNull(yieldPayload?.yield);
  if (!finite(dividendYieldPct) || dividendYieldPct < 0) {
    throw new Error(`${indexConfig.yieldFile}: yield missing or invalid`);
  }
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = earningsYield > 0 ? (dividendYieldPct / 100) / earningsYield : null;
  const holdingsPayload = readJson(path.join(dataRootForReads, `slickcharts/${indexConfig.slickchartsIndex}.json`));
  const holdings = Array.isArray(holdingsPayload?.holdings) ? holdingsPayload.holdings : [];
  const qa = weightedYfPayoutRatio(holdings, yfRoot);
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "(index_dividend_yield_pct / 100) / (benchmark_best_eps / benchmark_px_last)",
    sources: [indexConfig.yieldFile, indexConfig.benchmarkFile],
    coverage: {
      primary_formula: "index_yield_over_benchmark_earnings_yield",
      index_yield_as_of: yieldPayload?.updated ?? null,
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
    },
    qa: {
      formula: "index-weighted YF payoutRatio cross-check",
      ...qa,
    },
    notes: ["Not an observed index-level payout series; coverage-tagged derived input only."],
  });
}

function weightedYfPayoutRatio(holdings, yfRoot) {
  let totalWeight = 0;
  let coveredWeight = 0;
  let weighted = 0;
  const missingSample = [];
  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? "").toUpperCase();
    const weight = numberOrNull(holding?.weight);
    if (!symbol || !finite(weight) || weight <= 0) continue;
    totalWeight += weight;
    const filePath = path.join(yfRoot, `${symbol}.json`);
    let payoutRatio = null;
    if (fs.existsSync(filePath)) {
      payoutRatio = numberOrNull(readJson(filePath)?.data?.info?.payoutRatio);
    }
    if (finite(payoutRatio) && payoutRatio >= 0 && payoutRatio < 2) {
      coveredWeight += weight;
      weighted += weight * payoutRatio;
    } else if (missingSample.length < 10) {
      missingSample.push(symbol);
    }
  }
  return {
    value: coveredWeight > 0 ? round(weighted / coveredWeight, 6) : null,
    total_weight: round(totalWeight, 4),
    covered_weight: round(coveredWeight, 4),
    covered_weight_ratio: totalWeight > 0 ? round(coveredWeight / totalWeight, 6) : null,
    missing_sample: missingSample,
  };
}

function stockActionBySymbol(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  return new Map(rows.map((row) => [String(row.symbol ?? row.ticker_normalized ?? "").toUpperCase(), row]));
}

function addStockActionLookupKey(map, key, row) {
  const normalized = String(key ?? "").trim().toUpperCase();
  if (normalized) map.set(normalized, row);
}

function stockActionLookup(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const map = new Map();
  for (const row of rows) {
    addStockActionLookupKey(map, row?.symbol, row);
    addStockActionLookupKey(map, row?.ticker_normalized, row);
    const ticker = String(row?.ticker_normalized ?? "").trim().toUpperCase();
    if (/^\d{6}$/.test(ticker)) {
      addStockActionLookupKey(map, `!KRX/${ticker}`, row);
      addStockActionLookupKey(map, `${ticker}.KS`, row);
      addStockActionLookupKey(map, `${ticker}.KQ`, row);
    }
  }
  return map;
}

function stockActionRowsForIndex(stockActionPayload, indexKey) {
  const rows = Array.isArray(stockActionPayload?.rows) ? stockActionPayload.rows : [];
  return rows
    .map((row) => ({
      row,
      indexWeight: (row?.indexWeights ?? []).find((item) => item?.index === indexKey),
    }))
    .filter(({ indexWeight }) => finite(numberOrNull(indexWeight?.weight)) && numberOrNull(indexWeight.weight) > 0);
}

function weightedMetric(indexRows, metricFn, { denominatorRows = indexRows, missingLimit = 10 } = {}) {
  const denominatorWeight = denominatorRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  let coveredWeight = 0;
  let coveredRows = 0;
  let weighted = 0;
  const missingSample = [];
  for (const item of indexRows) {
    const weight = numberOrNull(item.indexWeight.weight);
    const value = metricFn(item.row);
    if (finite(value)) {
      coveredWeight += weight;
      coveredRows += 1;
      weighted += weight * value;
    } else if (missingSample.length < missingLimit) {
      missingSample.push(String(item.row?.symbol ?? item.row?.ticker_normalized ?? "unknown"));
    }
  }
  return {
    value: coveredWeight > 0 ? weighted / coveredWeight : null,
    covered_rows: coveredRows,
    total_rows: denominatorRows.length,
    total_weight: round(denominatorWeight, 4),
    covered_weight: round(coveredWeight, 4),
    covered_weight_ratio: denominatorWeight > 0 ? round(coveredWeight / denominatorWeight, 6) : null,
    missing_sample: missingSample,
  };
}

function stockActionIndexDiagnostics(stockActionPayload, indexKey) {
  const indexRows = stockActionRowsForIndex(stockActionPayload, indexKey);
  const totalWeight = indexRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const forwardRows = indexRows.filter(({ row }) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0;
  });
  return {
    index_key: indexKey,
    index_weight_rows: indexRows.length,
    index_weight_total: round(totalWeight, 4),
    forward_eps_fy1_fy3_rows: forwardRows.length,
    forward_eps_fy1_fy3_weight: round(forwardRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0), 4),
  };
}

function hasForwardEpsFy1Fy3(row) {
  const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
  const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
  return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0;
}

function proxyConstituentCandidateDiagnostics(stockActionPayload, dataRootForReads) {
  const lookup = stockActionLookup(stockActionPayload);
  const diagnostics = {};
  for (const [indexId, config] of Object.entries(PROXY_CONSTITUENT_CANDIDATES)) {
    const payload = readDataJson(config.source, dataRootForReads);
    const holdings = Array.isArray(payload?.normalized?.holdings) ? payload.normalized.holdings : [];
    let reportedWeight = 0;
    let resolvedWeight = 0;
    let resolvedRows = 0;
    let forwardWeight = 0;
    let forwardRows = 0;
    const missingSample = [];
    for (const holding of holdings) {
      const symbol = String(holding?.symbol ?? "").trim().toUpperCase();
      const weight = numberOrNull(holding?.weight_pct ?? holding?.weight);
      if (!finite(weight) || weight <= 0) continue;
      reportedWeight += weight;
      const row = lookup.get(symbol);
      if (row) {
        resolvedWeight += weight;
        resolvedRows += 1;
        if (hasForwardEpsFy1Fy3(row)) {
          forwardWeight += weight;
          forwardRows += 1;
        }
      } else if (missingSample.length < 10) {
        missingSample.push(symbol || "(blank)");
      }
    }
    const resolvedWeightRatio = resolvedWeight / 100;
    const forwardWeightRatio = forwardWeight / 100;
    diagnostics[indexId] = {
      proxy_ticker: config.proxyTicker,
      source: config.source,
      source_tier: "proxy_diagnostic",
      exact_index_substitute: config.exactIndexSubstitute,
      fetched_at: payload?.fetched_at ?? null,
      holdings_updated: payload?.normalized?.holdings_updated ?? null,
      reported_holding_count: payload?.normalized?.holding_count ?? holdings.length,
      sampled_holding_rows: holdings.length,
      reported_weight_total: round(reportedWeight, 4),
      resolved_rows: resolvedRows,
      resolved_weight: round(resolvedWeight, 4),
      resolved_weight_ratio: round(resolvedWeightRatio, 6),
      resolved_weight_ratio_of_reported_holdings: reportedWeight > 0 ? round(resolvedWeight / reportedWeight, 6) : null,
      forward_eps_fy1_fy3_rows: forwardRows,
      forward_eps_fy1_fy3_weight: round(forwardWeight, 4),
      forward_eps_fy1_fy3_weight_ratio: round(forwardWeightRatio, 6),
      min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
      diagnostic_status: config.exactIndexSubstitute
        ? "exact_candidate"
        : (forwardWeightRatio >= DEFAULT_MIN_COVERED_WEIGHT ? "proxy_financials_coverage_ready_exact_index_blocked" : "proxy_coverage_below_threshold"),
      missing_sample: missingSample,
      notes: config.notes,
    };
  }
  return diagnostics;
}

function koreaCoverageDiagnostics(stockActionPayload) {
  const rows = Array.isArray(stockActionPayload?.rows) ? stockActionPayload.rows : [];
  const koreaRows = rows.filter((row) => row?.marketScope === "korea");
  const forwardRows = koreaRows.filter((row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0;
  });
  const marketCapForwardRows = forwardRows.filter((row) => finite(numberOrNull(row?.marketCap)) && numberOrNull(row.marketCap) > 0);
  const kospiWeightRows = rows.filter((row) => (row?.indexWeights ?? []).some((item) => item?.index === "kospi"));
  return {
    market_scope: "korea",
    korea_rows: koreaRows.length,
    forward_eps_fy1_fy3_rows: forwardRows.length,
    market_cap_forward_rows: marketCapForwardRows.length,
    kospi_index_weight_rows: kospiWeightRows.length,
    public_status: kospiWeightRows.length > 0 ? "candidate_ready" : "blocked_missing_kospi_index_weights",
    notes: [
      "Korea forward estimates exist, but official KOSPI index weights are required before public KOSPI RIM output.",
      "A market-cap weighted Korea proxy is technically possible but must be owner-approved and proxy-labeled.",
    ],
  };
}

function buildStockActionPayoutRatio(indexConfig, benchmarkRow, stockActionPayload) {
  const indexRows = stockActionRowsForIndex(stockActionPayload, indexConfig.slickchartsIndex);
  const dividendYield = weightedMetric(indexRows, (row) => numberOrNull(row?.dividendYield));
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "stock_action_index_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: indexConfig.slickchartsIndex,
      weighted_dividend_yield: round(dividendYield.value, 8),
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      ...dividendYield,
    },
    notes: ["Index-weighted direct dividend-yield route; retained with SlickCharts/YF cross-checks in legacy_payout_ratio_qa."],
  });
}

function buildForecastGrid(indexConfig, benchmarkRow, stockActionPayload, payoutRatioField, costOfEquityValue, explicitEpsGrowth3yField) {
  const indexRows = stockActionRowsForIndex(stockActionPayload, indexConfig.slickchartsIndex);
  const source = "computed/stock_action_index.json";
  const fy1Growth = weightedMetric(indexRows, (row) => {
    const value = numberOrNull(row?.estimateSnapshot?.epsGrowth?.fy1);
    return finite(value) ? value / 100 : null;
  });
  const fy12Growth = weightedMetric(indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy2 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy2);
    return finite(fy1) && fy1 > 0 && finite(fy2) && fy2 > 0 ? (fy2 / fy1) - 1 : null;
  });
  const fy23Growth = weightedMetric(indexRows, (row) => {
    const fy2 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy2);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy2) && fy2 > 0 && finite(fy3) && fy3 > 0 ? (fy3 / fy2) - 1 : null;
  });
  const weightedRoe = {
    fy1: weightedMetric(indexRows, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy1);
      return finite(value) ? value / 100 : null;
    }),
    fy2: weightedMetric(indexRows, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy2);
      return finite(value) ? value / 100 : null;
    }),
    fy3: weightedMetric(indexRows, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy3);
      return finite(value) ? value / 100 : null;
    }),
  };
  const payoutRatio = numberOrNull(payoutRatioField?.value);
  const retentionRatio = finite(payoutRatio) ? Math.max(0, 1 - payoutRatio) : null;
  const price = benchmarkRow.px_last;
  const costOfEquity = numberOrNull(costOfEquityValue);
  const canonicalPegGrowth = numberOrNull(explicitEpsGrowth3yField?.value);
  let beginningBook = benchmarkRow.px_last / benchmarkRow.px_to_book_ratio;
  let earningsProxy = benchmarkRow.best_eps;
  const periods = [
    {
      period: "fy1",
      growth: fy1Growth,
      growthFormula: "weighted_average(stock_action.estimateSnapshot.epsGrowth.fy1) / 100",
      derivationDepth: "source_anchored_or_one_step",
      sourceConfidence: "source_snapshot_base_effect_sensitive",
      growthBasis: "source_reported_eps_growth_snapshot",
      growthUsage: "context_only_not_earnings_roll_forward",
      growthNotes: [
        "FY1 eps_growth is the source-reported analyst growth snapshot; it is base-effect sensitive and is not applied to the FY1 earnings_proxy anchor.",
      ],
    },
    {
      period: "fy2",
      growth: fy12Growth,
      growthFormula: "weighted_average((forward_eps_fy2 / forward_eps_fy1) - 1)",
      derivationDepth: "chained_roll_forward",
      sourceConfidence: "compounded_derived",
      growthBasis: "forward_eps_ratio",
      growthUsage: "earnings_path_roll_forward",
      growthNotes: ["Forward EPS ratio used to roll the prior earnings_proxy into this period."],
    },
    {
      period: "fy3",
      growth: fy23Growth,
      growthFormula: "weighted_average((forward_eps_fy3 / forward_eps_fy2) - 1)",
      derivationDepth: "chained_roll_forward",
      sourceConfidence: "compounded_derived",
      growthBasis: "forward_eps_ratio",
      growthUsage: "earnings_path_roll_forward",
      growthNotes: ["Forward EPS ratio used to roll the prior earnings_proxy into this period."],
    },
  ];
  const rows = [];
  for (const item of periods) {
    if (item.period === "fy2" && finite(item.growth.value)) earningsProxy *= (1 + item.growth.value);
    if (item.period === "fy3" && finite(item.growth.value)) earningsProxy *= (1 + item.growth.value);
    const endingBook = finite(retentionRatio) ? beginningBook + earningsProxy * retentionRatio : null;
    const roeBeginning = beginningBook > 0 ? earningsProxy / beginningBook : null;
    const peRatio = earningsProxy > 0 ? price / earningsProxy : null;
    const pegRatio = finite(canonicalPegGrowth) && canonicalPegGrowth > 0 ? peRatio / (canonicalPegGrowth * 100) : null;
    const residualIncomeProxy = finite(roeBeginning) && finite(costOfEquity)
      ? (roeBeginning - costOfEquity) * beginningBook
      : null;
    rows.push({
      period: item.period,
      derivation_depth: item.derivationDepth,
      source_confidence: item.sourceConfidence,
      growth_basis: item.growthBasis,
      growth_usage: item.growthUsage,
      earnings_proxy: formulaValue({
        value: round(earningsProxy, 4),
        formula: item.period === "fy1" ? "benchmark_best_eps_anchor" : "prior_period_earnings_proxy * (1 + weighted_forward_eps_growth)",
        sources: [indexConfig.benchmarkFile, source],
        notes: item.period === "fy1"
          ? ["FY1 row anchors to benchmark_best_eps; row eps_growth is context-only and not multiplied into earnings_proxy."]
          : ["Row eps_growth is applied before this period's earnings_proxy is calculated."],
      }),
      eps_growth: formulaValue({
        value: round(item.growth.value, 6),
        formula: item.growthFormula,
        sources: [source],
        coverage: item.growth,
        notes: item.growthNotes,
      }),
      book_value_beginning: formulaValue({
        value: round(beginningBook, 4),
        formula: item.period === "fy1" ? "benchmark_px_last / benchmark_px_to_book_ratio" : "prior_period_book_value_ending",
        sources: [indexConfig.benchmarkFile, "prior_period"],
      }),
      book_value_ending: formulaValue({
        value: round(endingBook, 4),
        formula: "book_value_beginning + earnings_proxy * (1 - payout_ratio)",
        sources: ["forecast_grid_v1.earnings_proxy", "derived.payout_ratio"],
      }),
      roe_on_beginning_book: formulaValue({
        value: round(roeBeginning, 6),
        formula: "earnings_proxy / book_value_beginning",
        sources: ["forecast_grid_v1.earnings_proxy", "forecast_grid_v1.book_value_beginning"],
      }),
      stock_action_weighted_roe: formulaValue({
        value: round(weightedRoe[item.period].value, 6),
        formula: `weighted_average(stock_action.profitabilitySnapshot.roe.${item.period}) / 100`,
        sources: [source],
        coverage: weightedRoe[item.period],
      }),
      payout_ratio: formulaValue({
        value: round(payoutRatio, 6),
        formula: "stock_action_index_weighted_dividend_yield / benchmark_earnings_yield",
        sources: ["derived.payout_ratio"],
      }),
      retention_ratio: formulaValue({
        value: round(retentionRatio, 6),
        formula: "1 - payout_ratio",
        sources: ["forecast_grid_v1.payout_ratio"],
      }),
      dividend_yield_implied: formulaValue({
        value: round(finite(payoutRatio) ? payoutRatio * (earningsProxy / price) : null, 8),
        formula: "payout_ratio * (earnings_proxy / current_price)",
        sources: ["forecast_grid_v1.payout_ratio", "forecast_grid_v1.earnings_proxy", "observed.price"],
      }),
      pe_ratio: formulaValue({
        value: round(peRatio, 4),
        formula: "current_price / earnings_proxy",
        sources: ["observed.price", "forecast_grid_v1.earnings_proxy"],
      }),
      peg_ratio: formulaValue({
        value: round(pegRatio, 4),
        formula: "pe_ratio / (derived.explicit_eps_growth_3y * 100)",
        sources: ["forecast_grid_v1.pe_ratio", "derived.explicit_eps_growth_3y"],
        notes: ["Canonical PEG denominator uses explicit_eps_growth_3y; row eps_growth remains path-growth context."],
      }),
      residual_income_proxy: formulaValue({
        value: round(residualIncomeProxy, 4),
        formula: "(roe_on_beginning_book - cost_of_equity) * book_value_beginning",
        sources: ["forecast_grid_v1.roe_on_beginning_book", "derived.cost_of_equity", "forecast_grid_v1.book_value_beginning"],
        notes: ["Scenario input only; no fair value or target price is emitted."],
      }),
    });
    if (finite(endingBook)) beginningBook = endingBook;
  }
  return {
    schema_version: "forecast_grid_v1",
    public_status: "ready_inputs_only_no_fair_value",
    periods: rows,
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      stock_action_generated_at: stockActionPayload?.generated_at ?? null,
      index_diagnostics: stockActionIndexDiagnostics(stockActionPayload, indexConfig.slickchartsIndex),
    },
    notes: [
      "Forecast grid is a source-tiered input grid, not a target price or fair-value output.",
      "FY labels are stock_action forward estimate buckets; calendar-year labels require a separate reporting-period contract.",
      "PEG uses derived.explicit_eps_growth_3y as the canonical growth denominator.",
      "FY1 eps_growth is a source-reported context snapshot and is not used to roll earnings_proxy; FY2/FY3 eps_growth values are forward-EPS roll-forward ratios.",
    ],
  };
}

function buildForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
  dataRootForReads = dataRoot,
) {
  const holdingsPayload = readJson(path.join(dataRootForReads, `slickcharts/${indexConfig.slickchartsIndex}.json`));
  const holdings = Array.isArray(holdingsPayload?.holdings) ? holdingsPayload.holdings : [];
  const bySymbol = stockActionBySymbol(stockActionPayload);
  let totalWeight = 0;
  let coveredWeight = 0;
  let weightedCagr = 0;
  let coveredRows = 0;
  const missingSample = [];
  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? "").toUpperCase();
    const weight = numberOrNull(holding?.weight);
    if (!symbol || !finite(weight) || weight <= 0) continue;
    totalWeight += weight;
    const row = bySymbol.get(symbol);
    const indexWeight = (row?.indexWeights ?? []).find((item) => item?.index === indexConfig.slickchartsIndex);
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    if (indexWeight && finite(fy1) && finite(fy3) && fy1 > 0 && fy3 > 0) {
      const cagr = Math.exp(Math.log(fy3 / fy1) / 2) - 1;
      coveredWeight += weight;
      weightedCagr += weight * cagr;
      coveredRows += 1;
    } else if (missingSample.length < 10) {
      missingSample.push(symbol);
    }
  }
  const coveredWeightRatio = totalWeight > 0 ? coveredWeight / totalWeight : null;
  const value = coveredWeight > 0 ? weightedCagr / coveredWeight : null;
  return derivedValue({
    value: round(value, 6),
    formula: "weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", `slickcharts/${indexConfig.slickchartsIndex}.json`],
    coverage: {
      total_weight: round(totalWeight, 4),
      covered_weight: round(coveredWeight, 4),
      covered_weight_ratio: round(coveredWeightRatio, 6),
      covered_rows: coveredRows,
      min_covered_weight_ratio: minCoveredWeight,
      missing_sample: missingSample,
    },
    notes: ["Not a live index-level consensus field; coverage-tagged derived input only."],
  });
}

function buildPrimaryIndex(indexConfig, context) {
  const benchmarkPayload = context.benchmarkPayloads.get(indexConfig.benchmarkFile);
  const benchmarkRow = latestBenchmarkRow(benchmarkPayload, indexConfig.benchmarkSection, indexConfig.benchmarkFile);
  const dgs10 = context.dgs10;
  const usErp = context.usErp;
  const yieldPayload = readDataJson(indexConfig.yieldFile, context.dataRoot);
  const payoutRatio = buildStockActionPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload);
  const legacyPayoutRatio = buildPayoutRatio(indexConfig, benchmarkRow, yieldPayload, {
    dataRootForReads: context.dataRoot,
  });
  const explicitEpsGrowth3y = buildForwardEpsGrowth(
    indexConfig,
    context.stockActionPayload,
    context.minCoveredWeight,
    context.dataRoot,
  );
  return {
    id: indexConfig.id,
    label: indexConfig.label,
    role: "primary_public_v1",
    public_status: "ready_inputs_and_forecast_grid",
    observed: {
      ...buildBenchmarkObservedInputs(indexConfig, benchmarkRow),
      risk_free_rate: observedValue({
        value: dgs10.value,
        source: "macro/fred-banking-daily.json",
        sourceField: "series.DGS10[-1].value / 100",
        asOf: dgs10.date,
        label: "US 10Y Treasury",
      }),
      equity_risk_premium: observedValue({
        value: usErp.value,
        source: "damodaran/erp.json",
        sourceField: "us_erp",
        asOf: usErp.source_date,
        label: "Damodaran US ERP",
      }),
    },
    derived: {
      book_value: buildBookValue(benchmarkRow),
      payout_ratio: payoutRatio,
      legacy_payout_ratio_qa: legacyPayoutRatio,
      explicit_eps_growth_3y: explicitEpsGrowth3y,
      cost_of_equity: derivedValue({
        value: round(dgs10.value + usErp.value, 8),
        formula: "risk_free_rate + equity_risk_premium",
        sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
        notes: ["No house premium adjustment included in public inputs slice."],
      }),
      forecast_grid_v1: buildForecastGrid(
        indexConfig,
        benchmarkRow,
        context.stockActionPayload,
        payoutRatio,
        dgs10.value + usErp.value,
        explicitEpsGrowth3y,
      ),
    },
    assumptions: {
      terminal_growth: {
        value: null,
        source_tier: "house_assumption",
        assumption_version: ASSUMPTION_VERSION,
        reviewed_at: REVIEWED_AT,
        status: "not_in_inputs_slice",
      },
      fade_years: {
        value: null,
        source_tier: "house_assumption",
        assumption_version: ASSUMPTION_VERSION,
        reviewed_at: REVIEWED_AT,
        status: "not_in_inputs_slice",
      },
    },
    blockers: [],
  };
}

function buildSecondaryIndex(indexConfig, context) {
  const benchmarkPayload = context.benchmarkPayloads.get(indexConfig.benchmarkFile);
  const benchmarkRow = latestBenchmarkRow(benchmarkPayload, indexConfig.benchmarkSection, indexConfig.benchmarkFile);
  const observed = buildBenchmarkObservedInputs(indexConfig, benchmarkRow);
  if (indexConfig.id === "KOSPI") {
    if (context.kr10y) {
      observed.risk_free_rate = observedValue({
        value: context.kr10y.value,
        source: "macro/fred-banking-daily.json",
        sourceField: "series.IRLTLT01KRM156N[-1].value / 100",
        asOf: context.kr10y.date,
        label: "Korea 10Y Government Bond Yield",
      });
    } else {
      observed.risk_free_rate = blockedValue({
        reason: "KR10Y source is solved via FRED/OECD IRLTLT01KRM156N but not present in local 100x data yet.",
        candidate: {
          source: "FRED/OECD",
          series_id: "IRLTLT01KRM156N",
          frequency: "monthly",
          note: "Collect before any public KOSPI RIM output; do not reuse DGS10.",
        },
        sourceTier: "blocked_not_wired",
      });
    }
    observed.equity_risk_premium = observedValue({
      value: round(numberOrNull(context.erpPayload?.countries?.Korea?.equity_risk_premium), 8),
      source: "damodaran/erp.json",
      sourceField: "countries.Korea.equity_risk_premium",
      asOf: context.erpPayload?.metadata?.source_date ?? null,
      label: "Damodaran Korea ERP",
    });
  }
  return {
    id: indexConfig.id,
    label: indexConfig.label,
    role: indexConfig.role,
    public_status: "blocked_or_input_only",
    observed,
    derived: {
      book_value: buildBookValue(benchmarkRow),
      payout_ratio: blockedValue({
        reason: "Exact index payout derivation requires named constituent weights and/or index yield coverage.",
      }),
      explicit_eps_growth_3y: blockedValue({
        reason: "Exact index growth derivation requires named constituent weights with sufficient forward EPS coverage.",
      }),
    },
    assumptions: {},
    blockers: indexConfig.blockers
      .filter((code) => !(indexConfig.id === "KOSPI" && context.kr10y && code === "country_risk_free_source_solved_not_wired"))
      .map((code) => ({
      code,
      severity: indexConfig.id === "CCMP" ? "public_card_blocker" : "public_blocker",
    })),
  };
}

function collectSourceTierCounts(node, counts = {}) {
  if (Array.isArray(node)) {
    for (const item of node) collectSourceTierCounts(item, counts);
  } else if (node && typeof node === "object") {
    if (typeof node.source_tier === "string") {
      counts[node.source_tier] = (counts[node.source_tier] ?? 0) + 1;
    }
    for (const value of Object.values(node)) collectSourceTierCounts(value, counts);
  }
  return counts;
}

function scanForbiddenKeys(node, pathParts = [], matches = []) {
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanForbiddenKeys(item, [...pathParts, String(index)], matches));
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      const next = [...pathParts, key];
      if (["fair_value", "target_price"].includes(key)) matches.push(next.join("."));
      scanForbiddenKeys(value, next, matches);
    }
  }
  return matches;
}

export function buildRimIndexInputs({
  dataRootOverride = dataRoot,
  generatedAt = new Date().toISOString(),
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
} = {}) {
  const originalDataRoot = dataRootOverride;
  const readFrom = (relPath) => readDataJson(relPath, originalDataRoot);
  const benchmarkPayloads = new Map();
  for (const item of [...PRIMARY_INDICES, ...SECONDARY_INDICES]) {
    if (!benchmarkPayloads.has(item.benchmarkFile)) benchmarkPayloads.set(item.benchmarkFile, readFrom(item.benchmarkFile));
  }
  const macroPayload = readFrom("macro/fred-banking-daily.json");
  const erpPayload = readFrom("damodaran/erp.json");
  const context = {
    benchmarkPayloads,
    dgs10: loadDgs10(macroPayload),
    kr10y: loadKr10y(macroPayload),
    usErp: loadUsErp(erpPayload),
    erpPayload,
    stockActionPayload: readFrom("computed/stock_action_index.json"),
    minCoveredWeight,
    dataRoot: originalDataRoot,
  };
  const indices = {};
  for (const item of PRIMARY_INDICES) indices[item.id] = buildPrimaryIndex(item, context);
  for (const item of SECONDARY_INDICES) indices[item.id] = buildSecondaryIndex(item, context);
  const payload = {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt,
    generated_by: "scripts/build-rim-index.mjs",
    product: "Fenok Index RIM Workbench",
    output_scope: "inputs_only_no_fair_value",
    path: DEFAULT_OUTPUT,
    policy: {
      no_public_single_target: true,
      no_kospi_dgs10_fallback: true,
      source_tier_required: true,
      forecast_grid_v1_scope: "SPX_NDX_inputs_only",
      primary_indices: PRIMARY_INDICES.map((item) => item.id),
      secondary_or_backlog_indices: SECONDARY_INDICES.map((item) => item.id),
    },
    indices,
    coverage_diagnostics: {
      stock_action: {
        SPX: stockActionIndexDiagnostics(context.stockActionPayload, "sp500"),
        NDX: stockActionIndexDiagnostics(context.stockActionPayload, "nasdaq100"),
        KOSPI: koreaCoverageDiagnostics(context.stockActionPayload),
      },
      proxy_constituent_candidates: proxyConstituentCandidateDiagnostics(context.stockActionPayload, originalDataRoot),
    },
  };
  payload.source_tier_counts = collectSourceTierCounts(payload);
  return payload;
}

export function validateRimIndexInputs(payload, { minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT } = {}) {
  const errors = [];
  const warnings = [];
  if (payload?.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (payload?.output_scope !== "inputs_only_no_fair_value") errors.push("output_scope must be inputs_only_no_fair_value");
  if (!payload?.source_tier_counts || Object.keys(payload.source_tier_counts).length === 0) {
    errors.push("source_tier_counts is required");
  }
  for (const id of ["SPX", "NDX"]) {
    const item = payload?.indices?.[id];
    if (!item) {
      errors.push(`${id}: index payload missing`);
      continue;
    }
    if (item.blockers?.length) errors.push(`${id}: primary index must not have blockers`);
    for (const key of ["price", "forward_eps", "price_to_book", "risk_free_rate", "equity_risk_premium"]) {
      const field = item.observed?.[key];
      if (!finite(field?.value) || field.value <= 0) errors.push(`${id}.${key}: positive observed value required`);
      if (field?.source_tier !== "observed_source") errors.push(`${id}.${key}: observed_source tier required`);
    }
    if (item.derived?.payout_ratio?.source_tier !== "derived_formula") errors.push(`${id}.payout_ratio: derived_formula tier required`);
    if (item.derived?.explicit_eps_growth_3y?.source_tier !== "derived_formula") errors.push(`${id}.explicit_eps_growth_3y: derived_formula tier required`);
    if (item.derived?.cost_of_equity?.source_tier !== "derived_formula") errors.push(`${id}.cost_of_equity: derived_formula tier required`);
    if (!finite(item.derived?.cost_of_equity?.value) || item.derived.cost_of_equity.value <= 0) {
      errors.push(`${id}.cost_of_equity: positive value required`);
    }
    const growthCoverage = item.derived?.explicit_eps_growth_3y?.coverage?.covered_weight_ratio;
    if (!finite(growthCoverage) || growthCoverage < minCoveredWeight) {
      errors.push(`${id}.explicit_eps_growth_3y: covered_weight_ratio below ${minCoveredWeight}`);
    }
    const payoutCoverage = item.derived?.payout_ratio?.coverage?.covered_weight_ratio;
    if (!finite(payoutCoverage) || payoutCoverage < minCoveredWeight) {
      errors.push(`${id}.payout_ratio: covered_weight_ratio below ${minCoveredWeight}`);
    }
    const grid = item.derived?.forecast_grid_v1;
    if (grid?.schema_version !== "forecast_grid_v1") errors.push(`${id}.forecast_grid_v1: schema_version required`);
    if (grid?.public_status !== "ready_inputs_only_no_fair_value") {
      errors.push(`${id}.forecast_grid_v1: public_status must be ready_inputs_only_no_fair_value`);
    }
    if (!Array.isArray(grid?.periods) || grid.periods.length !== 3) {
      errors.push(`${id}.forecast_grid_v1: exactly 3 periods required`);
    } else {
      const expectedPeriods = ["fy1", "fy2", "fy3"];
      const expectedDerivationDepth = ["source_anchored_or_one_step", "chained_roll_forward", "chained_roll_forward"];
      const expectedSourceConfidence = ["source_snapshot_base_effect_sensitive", "compounded_derived", "compounded_derived"];
      const expectedGrowthBasis = ["source_reported_eps_growth_snapshot", "forward_eps_ratio", "forward_eps_ratio"];
      const expectedGrowthUsage = ["context_only_not_earnings_roll_forward", "earnings_path_roll_forward", "earnings_path_roll_forward"];
      const requiredForecastKeys = [
        "earnings_proxy",
        "eps_growth",
        "book_value_beginning",
        "book_value_ending",
        "roe_on_beginning_book",
        "stock_action_weighted_roe",
        "payout_ratio",
        "retention_ratio",
        "dividend_yield_implied",
        "pe_ratio",
        "peg_ratio",
        "residual_income_proxy",
      ];
      for (let rowIndex = 0; rowIndex < grid.periods.length; rowIndex += 1) {
        const row = grid.periods[rowIndex];
        if (row?.period !== expectedPeriods[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.periods[${rowIndex}]: period must be ${expectedPeriods[rowIndex]}`);
        }
        if (row?.derivation_depth !== expectedDerivationDepth[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.derivation_depth: expected ${expectedDerivationDepth[rowIndex]}`);
        }
        if (row?.source_confidence !== expectedSourceConfidence[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.source_confidence: expected ${expectedSourceConfidence[rowIndex]}`);
        }
        if (row?.growth_basis !== expectedGrowthBasis[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.growth_basis: expected ${expectedGrowthBasis[rowIndex]}`);
        }
        if (row?.growth_usage !== expectedGrowthUsage[rowIndex]) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.growth_usage: expected ${expectedGrowthUsage[rowIndex]}`);
        }
        for (const key of requiredForecastKeys) {
          const field = row?.[key];
          if (field?.source_tier !== "derived_formula") {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: derived_formula tier required`);
          }
          if (!finite(field?.value)) {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: finite value required`);
          }
        }
        if (row?.peg_ratio?.formula !== "pe_ratio / (derived.explicit_eps_growth_3y * 100)") {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.peg_ratio: canonical explicit_eps_growth_3y formula required`);
        }
        if (!Array.isArray(row?.peg_ratio?.sources) || !row.peg_ratio.sources.includes("derived.explicit_eps_growth_3y")) {
          errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.peg_ratio: derived.explicit_eps_growth_3y source required`);
        }
        if (rowIndex === 0) {
          const growthNotes = Array.isArray(row?.eps_growth?.notes) ? row.eps_growth.notes.join(" ") : "";
          const earningsNotes = Array.isArray(row?.earnings_proxy?.notes) ? row.earnings_proxy.notes.join(" ") : "";
          if (!/not applied|not used|not multiplied/i.test(`${growthNotes} ${earningsNotes}`)) {
            errors.push(`${id}.forecast_grid_v1.fy1: eps_growth must disclose that it is not used to roll earnings_proxy`);
          }
        }
        for (const key of ["eps_growth", "stock_action_weighted_roe"]) {
          const coverage = row?.[key]?.coverage?.covered_weight_ratio;
          if (!finite(coverage) || coverage < minCoveredWeight) {
            errors.push(`${id}.forecast_grid_v1.${row?.period ?? rowIndex}.${key}: covered_weight_ratio below ${minCoveredWeight}`);
          }
        }
      }
    }
  }
  const kospiRiskFree = payload?.indices?.KOSPI?.observed?.risk_free_rate;
  const kospiRiskFreeSourceFields = [
    kospiRiskFree?.source,
    kospiRiskFree?.source_field,
    kospiRiskFree?.candidate?.series_id,
  ].filter(Boolean).join(" ");
  if (kospiRiskFree?.source === "macro/fred-banking-daily.json" || /\bDGS10\b/i.test(kospiRiskFreeSourceFields)) {
    errors.push("KOSPI must not use DGS10 as risk_free_rate");
  }
  const forbidden = scanForbiddenKeys(payload);
  if (forbidden.length > 0) errors.push(`forbidden output keys: ${forbidden.join(", ")}`);
  if (!payload?.indices?.SOX?.blockers?.some((item) => item.code === "identity_mapping_philadelphia_semi_to_sox_unverified")) {
    warnings.push("SOX identity mapping blocker is expected until verified");
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    write: true,
    publicMirror: true,
    check: false,
    minCoveredWeight: DEFAULT_MIN_COVERED_WEIGHT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      args.check = true;
      args.write = false;
    } else if (arg === "--write") {
      args.write = true;
    } else if (arg === "--no-write") {
      args.write = false;
    } else if (arg === "--no-public-mirror") {
      args.publicMirror = false;
    } else if (arg.startsWith("--output=")) {
      args.output = arg.slice("--output=".length);
    } else if (arg === "--output") {
      args.output = argv[++i];
    } else if (arg.startsWith("--min-covered-weight=")) {
      args.minCoveredWeight = Number(arg.slice("--min-covered-weight=".length));
    } else if (arg === "--min-covered-weight") {
      args.minCoveredWeight = Number(argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!finite(args.minCoveredWeight) || args.minCoveredWeight <= 0 || args.minCoveredWeight > 1) {
    throw new Error("--min-covered-weight must be between 0 and 1");
  }
  const outputPath = path.join(dataRoot, args.output);
  const currentPayload = fs.existsSync(outputPath) ? readJson(outputPath) : null;
  const generatedAt = args.check && currentPayload?.generated_at
    ? currentPayload.generated_at
    : new Date().toISOString();
  const payload = buildRimIndexInputs({ generatedAt, minCoveredWeight: args.minCoveredWeight });
  const validation = validateRimIndexInputs(payload, { minCoveredWeight: args.minCoveredWeight });
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  if (args.check) {
    if (!currentPayload) throw new Error(`${path.join("data", args.output)} is missing`);
    if (JSON.stringify(currentPayload) !== JSON.stringify(payload)) {
      throw new Error(`${path.join("data", args.output)} is not up to date`);
    }
    if (args.publicMirror) {
      const mirrorPath = path.join(publicDataRoot, args.output);
      const currentMirror = fs.existsSync(mirrorPath) ? readJson(mirrorPath) : null;
      if (!currentMirror) throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is missing`);
      if (JSON.stringify(currentMirror) !== JSON.stringify(payload)) {
        throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is not up to date`);
      }
    }
  }
  if (args.write) {
    writeJson(args.output, payload, args.publicMirror ? [dataRoot, publicDataRoot] : [dataRoot]);
  }
  const report = {
    ok: validation.ok,
    wrote: args.write ? [path.join("data", args.output), ...(args.publicMirror ? [path.join("100xfenok-next/public/data", args.output)] : [])] : [],
    primary_indices: PRIMARY_INDICES.map((item) => item.id),
    secondary_or_backlog_indices: SECONDARY_INDICES.map((item) => item.id),
    source_tier_counts: payload.source_tier_counts,
    warnings: validation.warnings,
  };
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
