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
const KOSPI_KRX_BRIDGE_FILE = "admin/fenok-edge-korea-krx-daily-index.json";
const KOSPI_KRX_WEIGHT_KEY = "kospi_krx_mktcap";
const KOSPI_INPUT_FRESHNESS_MAX_DAYS = 2;
const SOX_GIW_CONSTITUENTS_FILE = "indices/nasdaq-giw-sox-constituents.json";
const SOX_DERIVED_WEIGHT_KEY = "sox_nasdaq_giw_methodology_mktcap";
const SOX_INPUT_FRESHNESS_MAX_DAYS = 7;
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
    label: "PHLX Semiconductor / SOX",
    role: "secondary_input_only",
    benchmarkFile: "benchmarks/micro_sectors.json",
    benchmarkSection: "philadelphia_semi",
    blockers: [
      "missing_sox_constituent_weight_path",
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
    diagnosticStatus: "rejected_not_kospi_benchmark",
    notes: [
      "iShares MSCI South Korea ETF holdings are MSCI Korea ETF holdings, not KOSPI constituent weights.",
      "Do not use EWY for KOSPI RIM when KRX KOSPI market-cap source files are available.",
    ],
  },
  SOX: {
    proxyTicker: "SOXX",
    source: "stockanalysis/etfs/SOXX.json",
    exactIndexSubstitute: false,
    notes: [
      "iShares Semiconductor ETF holdings are a proxy candidate only, not literal PHLX Semiconductor Index weights.",
      "SOXX is diagnostics-only; SOX RIM inputs use Nasdaq GIW official constituents when available.",
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

function readOptionalJson(absPath) {
  if (!fs.existsSync(absPath)) return null;
  return readJson(absPath);
}

function readDataJson(relPath, root = dataRoot) {
  return readJson(path.join(root, relPath));
}

function dataRootToRepoRoot(dataRootForReads) {
  return path.resolve(dataRootForReads, "..");
}

function toPosixPath(inputPath) {
  return String(inputPath ?? "").split(path.sep).join("/");
}

function parseKrxDate(dateValue) {
  const compact = String(dateValue ?? "").replaceAll("-", "");
  return /^\d{8}$/.test(compact) ? compact : null;
}

function daysBetweenIsoDates(startDate, endDate) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.round((end - start) / 86400000);
}

function krxInputFreshness(asOf, generatedAt) {
  const generatedDate = String(generatedAt ?? "").slice(0, 10);
  const ageDays = daysBetweenIsoDates(asOf, generatedDate);
  return {
    generated_at_date: generatedDate || null,
    calendar_age_days: ageDays,
    max_input_freshness_days: KOSPI_INPUT_FRESHNESS_MAX_DAYS,
    status: finite(ageDays) && ageDays <= KOSPI_INPUT_FRESHNESS_MAX_DAYS
      ? "fresh_enough_for_input_slice"
      : "refresh_recommended",
  };
}

function soxInputFreshness(asOf, generatedAt) {
  const generatedDate = String(generatedAt ?? "").slice(0, 10);
  const ageDays = daysBetweenIsoDates(asOf, generatedDate);
  return {
    generated_at_date: generatedDate || null,
    calendar_age_days: ageDays,
    max_input_freshness_days: SOX_INPUT_FRESHNESS_MAX_DAYS,
    status: finite(ageDays) && ageDays <= SOX_INPUT_FRESHNESS_MAX_DAYS
      ? "fresh_enough_for_input_slice"
      : "refresh_recommended",
  };
}

function writeJson(relPath, payload, roots) {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  for (const root of roots) {
    const absPath = path.join(root, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, body, "utf8");
  }
}

function sanitizePublicRimMirror(node) {
  if (Array.isArray(node)) {
    return node.map((item) => sanitizePublicRimMirror(item));
  }
  if (node && typeof node === "object") {
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [key, sanitizePublicRimMirror(value)]),
    );
  }
  if (typeof node === "string" && node.includes("_private/")) {
    return "admin_private_path_redacted";
  }
  return node;
}

export function buildPublicRimMirror(payload) {
  return {
    ...sanitizePublicRimMirror(payload),
    public_mirror_policy: {
      raw_public: false,
      raw_rows_included: false,
      private_artifact_paths_included: false,
      private_path_redaction: "strings_containing__private_are_replaced_with_admin_private_path_redacted",
    },
  };
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

function loadKrxBridge(dataRootForReads) {
  const bridgePath = path.join(dataRootForReads, KOSPI_KRX_BRIDGE_FILE);
  const bridge = readOptionalJson(bridgePath);
  if (!bridge?.private_artifacts?.raw_root || !bridge?.as_of) return null;
  const dateKey = parseKrxDate(bridge.as_of);
  if (!dateKey) return null;
  const repoRootForReads = dataRootToRepoRoot(dataRootForReads);
  return {
    bridge,
    bridge_source: KOSPI_KRX_BRIDGE_FILE,
    repo_root: repoRootForReads,
    raw_root_rel: toPosixPath(bridge.private_artifacts.raw_root),
    as_of: bridge.as_of,
    date_key: dateKey,
    raw_public: bridge.raw_public === true,
    license_or_terms_note: bridge.license_or_terms_note ?? null,
  };
}

function krxPrivatePath(bridgeInfo, ...parts) {
  const relPath = toPosixPath(path.posix.join(bridgeInfo.raw_root_rel, ...parts));
  return {
    relPath,
    absPath: path.join(bridgeInfo.repo_root, relPath),
  };
}

function loadKrxKospiBridgeWeights(bridgeInfo, generatedAt) {
  const input = bridgeInfo?.bridge?.derived_rim_inputs?.kospi_weights;
  const inputRows = Array.isArray(input?.rows) ? input.rows : [];
  const rows = inputRows
    .map((row) => {
      const weight = numberOrNull(row?.weight);
      const weightPct = numberOrNull(row?.weight_pct);
      return {
        code: String(row?.code ?? "").trim().toUpperCase(),
        name: String(row?.name ?? "").trim(),
        weight: finite(weight) ? weight : (finite(weightPct) ? weightPct / 100 : null),
        weight_pct: finite(weightPct) ? weightPct : (finite(weight) ? weight * 100 : null),
      };
    })
    .filter((row) => row.code && finite(row.weight) && row.weight > 0 && finite(row.weight_pct) && row.weight_pct > 0);
  if (!rows.length) return null;
  return {
    source: input?.source ?? `${bridgeInfo.bridge_source}#derived_rim_inputs.kospi_weights`,
    bridge_source: bridgeInfo.bridge_source,
    source_field: input?.source_field ?? "derived_rim_inputs.kospi_weights.rows[].weight",
    as_of: input?.as_of ?? bridgeInfo.as_of,
    raw_public: input?.raw_public === true,
    license_or_terms_note: input?.license_or_terms_note ?? bridgeInfo.license_or_terms_note,
    row_count: numberOrNull(input?.row_count) ?? rows.length,
    total_market_cap: numberOrNull(input?.total_market_cap),
    denominator: input?.denominator ?? {
      method: "issuer_level_market_cap_sum",
      label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
      unit: "KRW",
      value: numberOrNull(input?.total_market_cap),
    },
    freshness: krxInputFreshness(input?.as_of ?? bridgeInfo.as_of, generatedAt),
    derived_bridge_input: true,
    rows,
  };
}

function loadKrxKospiMarketCapWeights(dataRootForReads, generatedAt) {
  const bridgeInfo = loadKrxBridge(dataRootForReads);
  if (!bridgeInfo) return null;
  const bridgeFallback = loadKrxKospiBridgeWeights(bridgeInfo, generatedAt);
  const sourcePath = krxPrivatePath(
    bridgeInfo,
    "core_stock_index",
    "stk_bydd_trd",
    `${bridgeInfo.date_key}.json`,
  );
  const payload = readOptionalJson(sourcePath.absPath);
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const kospiRows = rows
    .filter((row) => row?.MKT_NM === "KOSPI")
    .map((row) => ({
      code: String(row?.ISU_CD ?? "").trim().toUpperCase(),
      name: String(row?.ISU_NM ?? "").trim(),
      close_price: numberOrNull(row?.TDD_CLSPRC),
      listed_shares: numberOrNull(row?.LIST_SHRS),
      market_cap: numberOrNull(row?.MKTCAP),
    }))
    .filter((row) => row.code && finite(row.market_cap) && row.market_cap > 0);
  const totalMktCap = kospiRows.reduce((sum, row) => sum + row.market_cap, 0);
  if (!finite(totalMktCap) || totalMktCap <= 0) return bridgeFallback;
  return {
    source: sourcePath.relPath,
    bridge_source: bridgeInfo.bridge_source,
    source_field: "OutBlock_1[MKT_NM=KOSPI].MKTCAP / sum(OutBlock_1[MKT_NM=KOSPI].MKTCAP)",
    as_of: bridgeInfo.as_of,
    raw_public: bridgeInfo.raw_public,
    license_or_terms_note: bridgeInfo.license_or_terms_note,
    row_count: kospiRows.length,
    total_market_cap: totalMktCap,
    denominator: {
      method: "issuer_level_market_cap_sum",
      label: "KRX KOSPI stock-daily issuer MKTCAP sum; matches KOSPI including foreign shares aggregate in kospi_dd_trd",
      unit: "KRW",
      value: totalMktCap,
    },
    freshness: krxInputFreshness(bridgeInfo.as_of, generatedAt),
    rows: kospiRows.map((row) => ({
      ...row,
      weight: row.market_cap / totalMktCap,
      weight_pct: (row.market_cap / totalMktCap) * 100,
    })),
  };
}

function loadKrxKorea10yBridge(bridgeInfo) {
  const input = bridgeInfo?.bridge?.derived_rim_inputs?.korea_10y;
  const value = numberOrNull(input?.value);
  if (!finite(value) || value <= 0) return null;
  return {
    value,
    date: input?.date ?? bridgeInfo.as_of,
    raw_value_percent: numberOrNull(input?.raw_value_percent),
    source: input?.source ?? `${bridgeInfo.bridge_source}#derived_rim_inputs.korea_10y`,
    source_field: input?.source_field ?? "derived_rim_inputs.korea_10y.value",
    label: input?.label ?? "KRX KTS 10Y benchmark government bond yield",
    raw_public: input?.raw_public === true,
    license_or_terms_note: input?.license_or_terms_note ?? bridgeInfo.license_or_terms_note,
    derived_bridge_input: true,
  };
}

function loadKrxKorea10y(dataRootForReads) {
  const bridgeInfo = loadKrxBridge(dataRootForReads);
  if (!bridgeInfo) return null;
  const bridgeFallback = loadKrxKorea10yBridge(bridgeInfo);
  const sourcePath = krxPrivatePath(
    bridgeInfo,
    "bond_commodity_esg",
    "kts_bydd_trd",
    `${bridgeInfo.date_key}.json`,
  );
  const payload = readOptionalJson(sourcePath.absPath);
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  const candidates = rows
    .map((row) => ({
      row,
      yieldPercent: numberOrNull(row?.CLSPRC_YD),
      term: String(row?.BND_EXP_TP_NM ?? "").trim(),
      benchmarkType: String(row?.GOVBND_ISU_TP_NM ?? "").trim(),
      name: String(row?.ISU_NM ?? "").trim(),
    }))
    .filter((item) => item.term === "10" && item.benchmarkType === "지표" && finite(item.yieldPercent) && item.yieldPercent > 0)
    .sort((a, b) => Number(a.name.includes("물가")) - Number(b.name.includes("물가")));
  const selected = candidates.find((item) => !item.name.includes("물가")) ?? candidates[0];
  if (!selected) return bridgeFallback;
  return {
    value: round(selected.yieldPercent / 100, 8),
    date: bridgeInfo.as_of,
    raw_value_percent: selected.yieldPercent,
    source: sourcePath.relPath,
    source_field: `OutBlock_1[ISU_NM=${selected.name},BND_EXP_TP_NM=10,GOVBND_ISU_TP_NM=지표].CLSPRC_YD / 100`,
    label: "KRX KTS 10Y benchmark government bond yield",
    raw_public: bridgeInfo.raw_public,
    license_or_terms_note: bridgeInfo.license_or_terms_note,
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

function stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights) {
  if (!krxWeights?.rows?.length) {
    return { indexRows: [], denominatorRows: [], missingSample: [] };
  }
  const lookup = stockActionLookup(stockActionPayload);
  const denominatorRows = [];
  const indexRows = [];
  const missingSample = [];
  for (const krxRow of krxWeights.rows) {
    const indexWeight = {
      index: KOSPI_KRX_WEIGHT_KEY,
      weight: krxRow.weight_pct,
      source_weight_unit: "percent",
    };
    denominatorRows.push({
      row: {
        symbol: krxRow.code,
        ticker_normalized: krxRow.code,
        company: krxRow.name,
      },
      indexWeight,
      krxRow,
    });
    const stockActionRow = lookup.get(krxRow.code);
    if (stockActionRow) {
      indexRows.push({ row: stockActionRow, indexWeight, krxRow });
    } else if (missingSample.length < 10) {
      missingSample.push(`${krxRow.code}:${krxRow.name}`);
    }
  }
  return { indexRows, denominatorRows, missingSample };
}

function capForSoxMarketCapRank(rankIndex) {
  if (rankIndex === 0) return 12;
  if (rankIndex === 1) return 10;
  if (rankIndex === 2) return 8;
  return 4;
}

function cappedSoxMarketCapWeights(rows) {
  const totalMarketCap = rows.reduce((sum, row) => sum + row.market_cap, 0);
  if (!finite(totalMarketCap) || totalMarketCap <= 0) return [];
  const byMarketCap = rows
    .map((row) => ({
      ...row,
      initial_weight_pct: (row.market_cap / totalMarketCap) * 100,
    }))
    .sort((a, b) => b.market_cap - a.market_cap);
  let working = byMarketCap.map((row, index) => ({
    ...row,
    market_cap_rank: index + 1,
    cap_pct: capForSoxMarketCapRank(index),
    weight_pct: row.initial_weight_pct,
    capped: false,
  }));
  for (let iteration = 0; iteration < 50; iteration += 1) {
    const overCap = working.filter((row) => row.weight_pct > row.cap_pct + 1e-10);
    if (!overCap.length) break;
    const excess = overCap.reduce((sum, row) => sum + (row.weight_pct - row.cap_pct), 0);
    const overSet = new Set(overCap.map((row) => row.symbol));
    working = working.map((row) => overSet.has(row.symbol)
      ? { ...row, weight_pct: row.cap_pct, capped: true }
      : row);
    const receivers = working.filter((row) => !overSet.has(row.symbol) && row.weight_pct < row.cap_pct - 1e-10);
    const receiverMarketCap = receivers.reduce((sum, row) => sum + row.market_cap, 0);
    if (!receivers.length || !finite(receiverMarketCap) || receiverMarketCap <= 0) break;
    working = working.map((row) => {
      if (!receivers.some((receiver) => receiver.symbol === row.symbol)) return row;
      return {
        ...row,
        weight_pct: row.weight_pct + (excess * row.market_cap / receiverMarketCap),
      };
    });
  }
  return working
    .map((row) => ({
      ...row,
      weight_pct: round(row.weight_pct, 8),
      weight: round(row.weight_pct / 100, 10),
      initial_weight_pct: round(row.initial_weight_pct, 8),
    }))
    .sort((a, b) => a.giw_rank - b.giw_rank);
}

function loadNasdaqGiwSoxConstituents(dataRootForReads) {
  const payload = readOptionalJson(path.join(dataRootForReads, SOX_GIW_CONSTITUENTS_FILE));
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const normalizedRows = rows
    .map((row, index) => ({
      giw_rank: numberOrNull(row?.rank) ?? index + 1,
      name: String(row?.name ?? "").trim(),
      symbol: String(row?.symbol ?? "").trim().toUpperCase(),
    }))
    .filter((row) => row.symbol);
  if (payload?.schema_version !== "nasdaq_giw_sox_constituents.v1" || normalizedRows.length < 25) {
    return null;
  }
  return {
    ...payload,
    rows: normalizedRows,
    row_count: numberOrNull(payload?.row_count) ?? normalizedRows.length,
  };
}

function loadSoxMethodologyWeights(dataRootForReads, stockActionPayload, generatedAt) {
  const constituents = loadNasdaqGiwSoxConstituents(dataRootForReads);
  if (!constituents) return null;
  const lookup = stockActionLookup(stockActionPayload);
  const missingSample = [];
  const marketCapRows = [];
  for (const constituent of constituents.rows) {
    const stockActionRow = lookup.get(constituent.symbol);
    const marketCap = numberOrNull(stockActionRow?.marketCap);
    if (stockActionRow && finite(marketCap) && marketCap > 0) {
      marketCapRows.push({
        ...constituent,
        market_cap: marketCap,
        stock_action_symbol: String(stockActionRow.symbol ?? constituent.symbol).trim().toUpperCase(),
      });
    } else if (missingSample.length < 10) {
      missingSample.push(constituent.symbol);
    }
  }
  if (marketCapRows.length < 25) return null;
  const totalMarketCap = marketCapRows.reduce((sum, row) => sum + row.market_cap, 0);
  const rows = cappedSoxMarketCapWeights(marketCapRows);
  return {
    index_key: SOX_DERIVED_WEIGHT_KEY,
    source_tier: "methodology_derived_index_weight_source",
    source: SOX_GIW_CONSTITUENTS_FILE,
    source_url: constituents.source_url ?? "https://indexes.nasdaqomx.com/Index/Weighting/SOX",
    source_field: "rows[].symbol + computed/stock_action_index.marketCap -> SOX methodology capped weights",
    access_scope: constituents.access_scope ?? "public_free_constituent_view_no_official_weight_columns",
    as_of: constituents.as_of ?? null,
    row_count: rows.length,
    total_market_cap: totalMarketCap,
    denominator: {
      method: "stock_action_market_cap_sum_for_official_giw_constituents",
      label: "SOX official Nasdaq GIW constituents weighted by stock_action market cap and SOX methodology caps",
      unit: "USD",
      value: totalMarketCap,
    },
    methodology: {
      source: "Nasdaq SOX methodology",
      source_url: "https://indexes.nasdaqomx.com/docs/methodology_SOX.pdf",
      weighting_scheme: "modified_market_capitalization_weighted",
      cap_schedule: {
        largest_market_cap: 0.12,
        second_largest_market_cap: 0.10,
        third_largest_market_cap: 0.08,
        other_constituents: 0.04,
      },
      redistribution: "excess_weight_proportionally_redistributed_to_lower_weighted_index_securities_iteratively",
    },
    freshness: soxInputFreshness(constituents.as_of, generatedAt),
    official_weight_columns_available: false,
    missing_sample: missingSample,
    rows,
    notes: [
      "Constituent identities come from Nasdaq GIW public SOX weighting endpoint.",
      "Official GIW weight columns are not available in the public free view, so weights are methodology-derived from stock_action market caps.",
      "SOXX/SOXQ ETF holdings remain diagnostics-only and are not promoted as exact SOX weights.",
    ],
  };
}

function stockActionRowsForSoxWeights(stockActionPayload, soxWeights) {
  if (!soxWeights?.rows?.length) {
    return { indexRows: [], denominatorRows: [], missingSample: [] };
  }
  const lookup = stockActionLookup(stockActionPayload);
  const denominatorRows = [];
  const indexRows = [];
  const missingSample = [];
  for (const soxRow of soxWeights.rows) {
    const indexWeight = {
      index: SOX_DERIVED_WEIGHT_KEY,
      weight: soxRow.weight_pct,
      source_weight_unit: "percent",
    };
    denominatorRows.push({
      row: {
        symbol: soxRow.symbol,
        ticker_normalized: soxRow.symbol,
        company: soxRow.name,
      },
      indexWeight,
      soxRow,
    });
    const stockActionRow = lookup.get(soxRow.symbol);
    if (stockActionRow) {
      indexRows.push({ row: stockActionRow, indexWeight, soxRow });
    } else if (missingSample.length < 10) {
      missingSample.push(soxRow.symbol);
    }
  }
  return { indexRows, denominatorRows, missingSample };
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
    value: coveredWeight > 0 ? round(weighted / coveredWeight, 9) : null,
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

function stockActionRowsForProxyCandidate(stockActionPayload, config, dataRootForReads) {
  const lookup = stockActionLookup(stockActionPayload);
  const payload = readDataJson(config.source, dataRootForReads);
  const holdings = Array.isArray(payload?.normalized?.holdings) ? payload.normalized.holdings : [];
  const indexKey = `${String(config.proxyTicker).toLowerCase()}_etf_proxy`;
  const denominatorRows = [];
  const indexRows = [];
  const missingSample = [];
  for (const holding of holdings) {
    const symbol = String(holding?.symbol ?? "").trim().toUpperCase();
    const weight = numberOrNull(holding?.weight_pct ?? holding?.weight);
    if (!finite(weight) || weight <= 0) continue;
    const indexWeight = {
      index: indexKey,
      weight,
      source_weight_unit: "percent",
    };
    denominatorRows.push({
      row: {
        symbol,
        ticker_normalized: symbol,
        company: String(holding?.name ?? holding?.company ?? "").trim(),
      },
      indexWeight,
      holding,
    });
    const row = lookup.get(symbol);
    if (row) {
      indexRows.push({ row, indexWeight, holding });
    } else if (missingSample.length < 10) {
      missingSample.push(symbol || "(blank)");
    }
  }
  return { payload, holdings, indexKey, denominatorRows, indexRows, missingSample };
}

function proxyDiagnosticStatus(config, forwardWeightRatio) {
  if (config.diagnosticStatus) return config.diagnosticStatus;
  if (config.exactIndexSubstitute) return "exact_candidate";
  return forwardWeightRatio >= DEFAULT_MIN_COVERED_WEIGHT
    ? "proxy_financials_coverage_ready_exact_index_blocked"
    : "proxy_coverage_below_threshold";
}

function proxyCandidateDiagnostic(config, joined) {
  const reportedWeight = joined.denominatorRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const resolvedWeight = joined.indexRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const forwardRows = joined.indexRows.filter(({ row }) => hasForwardEpsFy1Fy3(row));
  const forwardWeight = forwardRows.reduce((sum, { indexWeight }) => sum + numberOrNull(indexWeight.weight), 0);
  const resolvedWeightRatio = resolvedWeight / 100;
  const forwardWeightRatio = forwardWeight / 100;
  return {
    proxy_ticker: config.proxyTicker,
    source: config.source,
    source_tier: "proxy_diagnostic",
    exact_index_substitute: config.exactIndexSubstitute,
    fetched_at: joined.payload?.fetched_at ?? null,
    holdings_updated: joined.payload?.normalized?.holdings_updated ?? null,
    reported_holding_count: joined.payload?.normalized?.holding_count ?? joined.holdings.length,
    sampled_holding_rows: joined.holdings.length,
    reported_weight_total: round(reportedWeight, 4),
    resolved_rows: joined.indexRows.length,
    resolved_weight: round(resolvedWeight, 4),
    resolved_weight_ratio: round(resolvedWeightRatio, 6),
    resolved_weight_ratio_of_reported_holdings: reportedWeight > 0 ? round(resolvedWeight / reportedWeight, 6) : null,
    forward_eps_fy1_fy3_rows: forwardRows.length,
    forward_eps_fy1_fy3_weight: round(forwardWeight, 4),
    forward_eps_fy1_fy3_weight_ratio: round(forwardWeightRatio, 6),
    min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
    diagnostic_status: proxyDiagnosticStatus(config, forwardWeightRatio),
    missing_sample: joined.missingSample,
    notes: config.notes,
  };
}

function proxyConstituentCandidateDiagnostics(stockActionPayload, dataRootForReads) {
  const diagnostics = {};
  for (const [indexId, config] of Object.entries(PROXY_CONSTITUENT_CANDIDATES)) {
    const joined = stockActionRowsForProxyCandidate(stockActionPayload, config, dataRootForReads);
    diagnostics[indexId] = proxyCandidateDiagnostic(config, joined);
  }
  return diagnostics;
}

function krxKospiWeightDiagnostics(stockActionPayload, krxWeights) {
  if (!krxWeights) return null;
  const joined = stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const matched = weightedMetric(joined.indexRows, () => 1, denominatorOptions);
  const dividendYield = weightedMetric(joined.indexRows, (row) => numberOrNull(row?.dividendYield), denominatorOptions);
  const forwardGrowth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  return {
    index_key: KOSPI_KRX_WEIGHT_KEY,
    source_tier: "exact_index_weight_source",
    source: krxWeights.source,
    bridge_source: krxWeights.bridge_source,
    source_field: krxWeights.source_field,
    as_of: krxWeights.as_of,
    raw_public: krxWeights.raw_public,
    license_or_terms_note: krxWeights.license_or_terms_note,
    krx_rows: krxWeights.row_count,
    total_market_cap: krxWeights.total_market_cap,
    denominator: krxWeights.denominator,
    freshness: krxWeights.freshness,
    matched_stock_action_rows: joined.indexRows.length,
    matched_weight_ratio: matched.covered_weight_ratio,
    dividend_yield_rows: dividendYield.covered_rows,
    dividend_yield_weight_ratio: dividendYield.covered_weight_ratio,
    weighted_dividend_yield: round(dividendYield.value, 8),
    forward_eps_fy1_fy3_rows: forwardGrowth.covered_rows,
    forward_eps_fy1_fy3_weight_ratio: forwardGrowth.covered_weight_ratio,
    weighted_forward_eps_3y_cagr: round(forwardGrowth.value, 6),
    min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
    public_status: forwardGrowth.covered_weight_ratio >= DEFAULT_MIN_COVERED_WEIGHT
      ? "krx_exact_weights_financials_coverage_ready"
      : "krx_exact_weights_financials_coverage_below_threshold",
    missing_sample: joined.missingSample,
    notes: [
      "KOSPI weights use KRX issuer-level MKTCAP / total KOSPI MKTCAP, not ETF proxy holdings.",
      "The current denominator is the KOSPI stock-daily issuer MKTCAP sum, matching the KOSPI including foreign shares aggregate.",
      "Raw KRX rows stay private/admin; public payload carries derived coverage and private path references only.",
    ],
  };
}

function soxWeightDiagnostics(stockActionPayload, soxWeights) {
  if (!soxWeights) return null;
  const joined = stockActionRowsForSoxWeights(stockActionPayload, soxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const matched = weightedMetric(joined.indexRows, () => 1, denominatorOptions);
  const dividendYield = weightedMetric(joined.indexRows, (row) => numberOrNull(row?.dividendYield), denominatorOptions);
  const forwardGrowth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  const methodologyWeightTotal = soxWeights.rows.reduce((sum, row) => sum + numberOrNull(row.weight_pct), 0);
  const capViolationCount = soxWeights.rows.filter((row) => numberOrNull(row.weight_pct) > numberOrNull(row.cap_pct) + 0.000001).length;
  return {
    index_key: SOX_DERIVED_WEIGHT_KEY,
    source_tier: soxWeights.source_tier,
    source: soxWeights.source,
    source_url: soxWeights.source_url,
    source_field: soxWeights.source_field,
    access_scope: soxWeights.access_scope,
    as_of: soxWeights.as_of,
    official_weight_columns_available: soxWeights.official_weight_columns_available,
    methodology: soxWeights.methodology,
    constituent_rows: soxWeights.row_count,
    methodology_weight_rows: soxWeights.rows.length,
    methodology_weight_total: round(methodologyWeightTotal, 6),
    cap_violation_count: capViolationCount,
    top_weight_sample: soxWeights.rows
      .slice()
      .sort((a, b) => numberOrNull(b.weight_pct) - numberOrNull(a.weight_pct))
      .slice(0, 10)
      .map((row) => ({
        symbol: row.symbol,
        name: row.name,
        market_cap_rank: row.market_cap_rank,
        initial_weight_pct: row.initial_weight_pct,
        cap_pct: row.cap_pct,
        weight_pct: row.weight_pct,
        capped: row.capped,
      })),
    total_market_cap: soxWeights.total_market_cap,
    denominator: soxWeights.denominator,
    freshness: soxWeights.freshness,
    matched_stock_action_rows: joined.indexRows.length,
    matched_weight_ratio: matched.covered_weight_ratio,
    dividend_yield_rows: dividendYield.covered_rows,
    dividend_yield_weight_ratio: dividendYield.covered_weight_ratio,
    weighted_dividend_yield: round(dividendYield.value, 8),
    forward_eps_fy1_fy3_rows: forwardGrowth.covered_rows,
    forward_eps_fy1_fy3_weight_ratio: forwardGrowth.covered_weight_ratio,
    weighted_forward_eps_3y_cagr: round(forwardGrowth.value, 6),
    min_public_card_weight_ratio: DEFAULT_MIN_COVERED_WEIGHT,
    public_status: forwardGrowth.covered_weight_ratio >= DEFAULT_MIN_COVERED_WEIGHT
      ? "sox_methodology_weights_financials_coverage_ready"
      : "sox_methodology_weights_financials_coverage_below_threshold",
    missing_sample: Array.from(new Set([...soxWeights.missing_sample, ...joined.missingSample])).slice(0, 10),
    notes: soxWeights.notes,
  };
}

function koreaCoverageDiagnostics(stockActionPayload, krxWeights = null) {
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
    krx_kospi_weights: krxKospiWeightDiagnostics(stockActionPayload, krxWeights),
    public_status: krxWeights
      ? "krx_exact_weights_available"
      : (kospiWeightRows.length > 0 ? "candidate_ready" : "blocked_missing_kospi_index_weights"),
    notes: [
      krxWeights
        ? "KRX KOSPI market-cap weights are available; EWY is not used for KOSPI RIM inputs."
        : "Korea forward estimates exist, but KRX KOSPI index weights are required before public KOSPI RIM output.",
      "KOSPI RIM output publishes generated inputs only; raw KRX rows stay private/admin.",
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

function buildKrxKospiPayoutRatio(indexConfig, benchmarkRow, stockActionPayload, krxWeights) {
  const joined = stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const dividendYield = weightedMetric(joined.indexRows, (row) => numberOrNull(row?.dividendYield), denominatorOptions);
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "krx_kospi_mktcap_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", krxWeights.source, indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: KOSPI_KRX_WEIGHT_KEY,
      krx_weight_as_of: krxWeights.as_of,
      krx_weight_source: krxWeights.source,
      raw_public: krxWeights.raw_public,
      weighted_dividend_yield: round(dividendYield.value, 8),
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      unmatched_krx_sample: joined.missingSample,
      ...dividendYield,
    },
    notes: [
      "KRX KOSPI issuer market-cap weights are used directly; EWY/MSCI Korea ETF holdings are not used.",
      "Raw KRX rows stay private/admin; output is an input-only derived field, not a fair value.",
    ],
  });
}

function buildKrxKospiForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  krxWeights,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
) {
  const joined = stockActionRowsForKrxKospiWeights(stockActionPayload, krxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const growth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  return derivedValue({
    value: round(growth.value, 6),
    formula: "krx_kospi_mktcap_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", krxWeights.source],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: KOSPI_KRX_WEIGHT_KEY,
      krx_weight_as_of: krxWeights.as_of,
      krx_weight_source: krxWeights.source,
      raw_public: krxWeights.raw_public,
      min_covered_weight_ratio: minCoveredWeight,
      unmatched_krx_sample: joined.missingSample,
      ...growth,
    },
    notes: [
      "Not a live index-level consensus field; KRX exact market-cap weights are combined with stock_action forward EPS snapshots.",
      "KRX daily latest pull may need refresh before public card promotion.",
    ],
  });
}

function buildSoxPayoutRatio(indexConfig, benchmarkRow, stockActionPayload, soxWeights) {
  const joined = stockActionRowsForSoxWeights(stockActionPayload, soxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const dividendYield = weightedMetric(joined.indexRows, (row) => numberOrNull(row?.dividendYield), denominatorOptions);
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "sox_methodology_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", soxWeights.source, indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: SOX_DERIVED_WEIGHT_KEY,
      sox_constituents_as_of: soxWeights.as_of,
      sox_constituent_source: soxWeights.source,
      official_weight_columns_available: soxWeights.official_weight_columns_available,
      methodology_source: soxWeights.methodology.source_url,
      weighted_dividend_yield: round(dividendYield.value, 8),
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      unmatched_sox_sample: joined.missingSample,
      ...dividendYield,
    },
    notes: [
      "SOX official constituent identities are sourced from Nasdaq GIW public data.",
      "Weights are methodology-derived from stock_action market caps because GIW free view does not expose official weight columns.",
      "SOXX ETF holdings are not used in this top-level SOX payout input.",
    ],
  });
}

function buildSoxForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  soxWeights,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
) {
  const joined = stockActionRowsForSoxWeights(stockActionPayload, soxWeights);
  const denominatorOptions = { denominatorRows: joined.denominatorRows };
  const growth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, denominatorOptions);
  return derivedValue({
    value: round(growth.value, 6),
    formula: "sox_methodology_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", soxWeights.source],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      index_key: SOX_DERIVED_WEIGHT_KEY,
      sox_constituents_as_of: soxWeights.as_of,
      sox_constituent_source: soxWeights.source,
      official_weight_columns_available: soxWeights.official_weight_columns_available,
      methodology_source: soxWeights.methodology.source_url,
      min_covered_weight_ratio: minCoveredWeight,
      unmatched_sox_sample: joined.missingSample,
      ...growth,
    },
    notes: [
      "Not a live index-level consensus field; Nasdaq GIW constituents and methodology-derived weights are combined with stock_action forward EPS snapshots.",
      "A refreshed Nasdaq GIW file and stock_action rebuild are required before public card promotion.",
    ],
  });
}

function buildProxyPayoutRatio(indexConfig, benchmarkRow, stockActionPayload, proxyConfig, joined) {
  const dividendYield = weightedMetric(joined.indexRows, (row) => numberOrNull(row?.dividendYield), {
    denominatorRows: joined.denominatorRows,
  });
  const earningsYield = benchmarkRow.best_eps / benchmarkRow.px_last;
  const payoutRatio = finite(dividendYield.value) && earningsYield > 0
    ? dividendYield.value / earningsYield
    : null;
  return derivedValue({
    value: round(payoutRatio, 6),
    formula: "proxy_etf_weighted_dividend_yield / (benchmark_best_eps / benchmark_px_last)",
    sources: ["computed/stock_action_index.json", proxyConfig.source, indexConfig.benchmarkFile],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      proxy_ticker: proxyConfig.proxyTicker,
      proxy_source: proxyConfig.source,
      proxy_holdings_updated: joined.payload?.normalized?.holdings_updated ?? null,
      exact_index_substitute: proxyConfig.exactIndexSubstitute,
      benchmark_as_of: benchmarkRow.date,
      benchmark_earnings_yield: round(earningsYield, 8),
      weighted_dividend_yield: round(dividendYield.value, 8),
      unmatched_proxy_sample: joined.missingSample,
      ...dividendYield,
    },
    notes: [
      "ETF holdings are used only as proxy inputs; they are not official index constituent weights.",
      "Proxy payout is not promoted to the exact index payout_ratio field.",
    ],
  });
}

function buildProxyForwardEpsGrowth(
  indexConfig,
  stockActionPayload,
  proxyConfig,
  joined,
  minCoveredWeight = DEFAULT_MIN_COVERED_WEIGHT,
) {
  const growth = weightedMetric(joined.indexRows, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy1) && fy1 > 0 && finite(fy3) && fy3 > 0
      ? Math.exp(Math.log(fy3 / fy1) / 2) - 1
      : null;
  }, { denominatorRows: joined.denominatorRows });
  return derivedValue({
    value: round(growth.value, 6),
    formula: "proxy_etf_weighted_average(((forward_eps_fy3 / forward_eps_fy1)^(1/2)) - 1)",
    sources: ["computed/stock_action_index.json", proxyConfig.source],
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      proxy_ticker: proxyConfig.proxyTicker,
      proxy_source: proxyConfig.source,
      proxy_holdings_updated: joined.payload?.normalized?.holdings_updated ?? null,
      exact_index_substitute: proxyConfig.exactIndexSubstitute,
      min_covered_weight_ratio: minCoveredWeight,
      unmatched_proxy_sample: joined.missingSample,
      ...growth,
    },
    notes: [
      "ETF holdings are used only as proxy inputs; they are not official index constituent weights.",
      "Proxy growth is not promoted to the exact index explicit_eps_growth_3y field.",
    ],
  });
}

function buildProxyInputs(indexConfig, benchmarkRow, context) {
  const proxyConfig = PROXY_CONSTITUENT_CANDIDATES[indexConfig.id];
  if (!proxyConfig || proxyConfig.diagnosticStatus?.startsWith("rejected_")) return null;
  const joined = stockActionRowsForProxyCandidate(context.stockActionPayload, proxyConfig, context.dataRoot);
  const diagnostic = proxyCandidateDiagnostic(proxyConfig, joined);
  if (diagnostic.forward_eps_fy1_fy3_weight_ratio < context.minCoveredWeight) return null;
  const payoutRatio = buildProxyPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload, proxyConfig, joined);
  const explicitEpsGrowth3y = buildProxyForwardEpsGrowth(
    indexConfig,
    context.stockActionPayload,
    proxyConfig,
    joined,
    context.minCoveredWeight,
  );
  const costOfEquityValue = context.dgs10.value + context.usErp.value;
  return {
    schema_version: "proxy_inputs_v1",
    public_status: "proxy_input_only_exact_index_blocked",
    source_tier: "proxy_diagnostic",
    input_basis: "etf_holdings_proxy_not_official_index_weights",
    proxy_ticker: proxyConfig.proxyTicker,
    source: proxyConfig.source,
    exact_index_substitute: proxyConfig.exactIndexSubstitute,
    diagnostic_status: diagnostic.diagnostic_status,
    fetched_at: diagnostic.fetched_at,
    holdings_updated: diagnostic.holdings_updated,
    coverage: diagnostic,
    key_inputs: {
      payout_ratio: payoutRatio,
      explicit_eps_growth_3y: explicitEpsGrowth3y,
      cost_of_equity: derivedValue({
        value: round(costOfEquityValue, 8),
        formula: "risk_free_rate + equity_risk_premium",
        sources: ["macro/fred-banking-daily.json:series.DGS10", "damodaran/erp.json:us_erp"],
        notes: ["US proxy inputs use the same US risk-free and ERP policy as SPX/NDX."],
      }),
    },
    forecast_grid_v1: buildForecastGrid(
      indexConfig,
      benchmarkRow,
      context.stockActionPayload,
      payoutRatio,
      costOfEquityValue,
      explicitEpsGrowth3y,
      {
        indexRows: joined.indexRows,
        denominatorRows: joined.denominatorRows,
        indexKey: joined.indexKey,
        sourceRefs: ["computed/stock_action_index.json", proxyConfig.source],
        publicStatus: "proxy_input_only_no_fair_value_exact_index_blocked",
        indexDiagnostics: diagnostic,
        notes: [
          "This forecast grid is nested under proxy_inputs_v1 and must not be treated as public-ready exact index output.",
          "SOX top-level output must use Nasdaq GIW constituents or another verified index source; ETF proxy holdings are never exact index weights.",
        ],
      },
    ),
    blockers: [
      {
        code: "proxy_not_exact_index_constituents",
        severity: "public_blocker",
      },
      ...indexConfig.blockers.map((code) => ({
        code,
        severity: "public_blocker",
      })),
    ],
    notes: [
      "Proxy inputs are scenario diagnostics only; top-level exact payout_ratio and explicit_eps_growth_3y remain blocked.",
      ...proxyConfig.notes,
    ],
  };
}

function buildForecastGrid(
  indexConfig,
  benchmarkRow,
  stockActionPayload,
  payoutRatioField,
  costOfEquityValue,
  explicitEpsGrowth3yField,
  {
    indexRows = null,
    denominatorRows = null,
    indexKey = indexConfig.slickchartsIndex,
    sourceRefs = ["computed/stock_action_index.json"],
    publicStatus = "ready_inputs_only_no_fair_value",
    indexDiagnostics = null,
    notes = [],
  } = {},
) {
  const rowsForGrid = indexRows ?? stockActionRowsForIndex(stockActionPayload, indexKey);
  const metricOptions = denominatorRows ? { denominatorRows } : {};
  const fy1Growth = weightedMetric(rowsForGrid, (row) => {
    const value = numberOrNull(row?.estimateSnapshot?.epsGrowth?.fy1);
    return finite(value) ? value / 100 : null;
  }, metricOptions);
  const fy12Growth = weightedMetric(rowsForGrid, (row) => {
    const fy1 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy1);
    const fy2 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy2);
    return finite(fy1) && fy1 > 0 && finite(fy2) && fy2 > 0 ? (fy2 / fy1) - 1 : null;
  }, metricOptions);
  const fy23Growth = weightedMetric(rowsForGrid, (row) => {
    const fy2 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy2);
    const fy3 = numberOrNull(row?.estimateSnapshot?.forwardEps?.fy3);
    return finite(fy2) && fy2 > 0 && finite(fy3) && fy3 > 0 ? (fy3 / fy2) - 1 : null;
  }, metricOptions);
  const weightedRoe = {
    fy1: weightedMetric(rowsForGrid, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy1);
      return finite(value) ? value / 100 : null;
    }, metricOptions),
    fy2: weightedMetric(rowsForGrid, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy2);
      return finite(value) ? value / 100 : null;
    }, metricOptions),
    fy3: weightedMetric(rowsForGrid, (row) => {
      const value = numberOrNull(row?.profitabilitySnapshot?.roe?.fy3);
      return finite(value) ? value / 100 : null;
    }, metricOptions),
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
        sources: [indexConfig.benchmarkFile, ...sourceRefs],
        notes: item.period === "fy1"
          ? ["FY1 row anchors to benchmark_best_eps; row eps_growth is context-only and not multiplied into earnings_proxy."]
          : ["Row eps_growth is applied before this period's earnings_proxy is calculated."],
      }),
      eps_growth: formulaValue({
        value: round(item.growth.value, 6),
        formula: item.growthFormula,
        sources: sourceRefs,
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
        sources: sourceRefs,
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
    public_status: publicStatus,
    periods: rows,
    coverage: {
      stock_action_source_date: stockActionPayload?.source_date ?? null,
      stock_action_generated_at: stockActionPayload?.generated_at ?? null,
      index_key: indexKey,
      index_diagnostics: indexDiagnostics ?? stockActionIndexDiagnostics(stockActionPayload, indexKey),
    },
    notes: [
      "Forecast grid is a source-tiered input grid, not a target price or fair-value output.",
      "FY labels are stock_action forward estimate buckets; calendar-year labels require a separate reporting-period contract.",
      "PEG uses derived.explicit_eps_growth_3y as the canonical growth denominator.",
      "FY1 eps_growth is a source-reported context snapshot and is not used to roll earnings_proxy; FY2/FY3 eps_growth values are forward-EPS roll-forward ratios.",
      ...notes,
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
    const krRiskFree = context.krxKr10y ?? context.kr10y;
    if (krRiskFree) {
      observed.risk_free_rate = observedValue({
        value: krRiskFree.value,
        source: krRiskFree.source ?? "macro/fred-banking-daily.json",
        sourceField: krRiskFree.source_field ?? "series.IRLTLT01KRM156N[-1].value / 100",
        asOf: krRiskFree.date,
        label: krRiskFree.label ?? "Korea 10Y Government Bond Yield",
      });
      if (typeof krRiskFree.raw_public === "boolean") observed.risk_free_rate.raw_public = krRiskFree.raw_public;
      if (krRiskFree.license_or_terms_note) observed.risk_free_rate.license_or_terms_note = krRiskFree.license_or_terms_note;
    } else {
      observed.risk_free_rate = blockedValue({
        reason: "KR10Y source is not present in local 100x macro data and no KRX KTS 10Y bridge source was found.",
        candidate: {
          sources: ["FRED/OECD IRLTLT01KRM156N", "KRX KTS 10Y benchmark government bond yield"],
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
    if (context.krxKospiWeights) {
      const joined = stockActionRowsForKrxKospiWeights(context.stockActionPayload, context.krxKospiWeights);
      const payoutRatio = buildKrxKospiPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload, context.krxKospiWeights);
      const explicitEpsGrowth3y = buildKrxKospiForwardEpsGrowth(
        indexConfig,
        context.stockActionPayload,
        context.krxKospiWeights,
        context.minCoveredWeight,
      );
      const costOfEquityValue = krRiskFree && finite(observed.equity_risk_premium.value)
        ? krRiskFree.value + observed.equity_risk_premium.value
        : null;
      const blockers = [];
      if (!krRiskFree) {
        blockers.push({
          code: "country_risk_free_source_missing",
          severity: "public_blocker",
        });
      }
      if (context.krxKospiWeights.freshness?.status === "refresh_recommended") {
        blockers.push({
          code: "krx_kospi_daily_refresh_recommended",
          severity: "freshness_blocker",
        });
      }
      return {
        id: indexConfig.id,
        label: indexConfig.label,
        role: "secondary_input_only",
        public_status: blockers.length
          ? "input_only_krx_exact_weights_with_caveats"
          : "ready_inputs_and_forecast_grid",
        observed,
        derived: {
          book_value: buildBookValue(benchmarkRow),
          payout_ratio: payoutRatio,
          explicit_eps_growth_3y: explicitEpsGrowth3y,
          cost_of_equity: finite(costOfEquityValue)
            ? derivedValue({
              value: round(costOfEquityValue, 8),
              formula: "risk_free_rate + equity_risk_premium",
              sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
              notes: ["KOSPI uses Korea risk-free inputs only; DGS10 fallback is forbidden."],
            })
            : blockedValue({
              reason: "Cost of equity requires Korea risk-free rate and Korea ERP.",
            }),
          forecast_grid_v1: finite(costOfEquityValue)
            ? buildForecastGrid(
              indexConfig,
              benchmarkRow,
              context.stockActionPayload,
              payoutRatio,
              costOfEquityValue,
              explicitEpsGrowth3y,
              {
                indexRows: joined.indexRows,
                denominatorRows: joined.denominatorRows,
                indexKey: KOSPI_KRX_WEIGHT_KEY,
                sourceRefs: ["computed/stock_action_index.json", context.krxKospiWeights.source],
                publicStatus: "input_only_krx_exact_weights_no_fair_value",
                indexDiagnostics: krxKospiWeightDiagnostics(context.stockActionPayload, context.krxKospiWeights),
                notes: [
                  "KOSPI forecast grid uses KRX MKTCAP weights and stock_action financial snapshots.",
                  "Raw KRX rows stay private/admin; generated RIM inputs are safe for this public payload.",
                ],
              },
            )
            : blockedValue({
              reason: "Forecast grid requires a finite Korea cost of equity.",
            }),
        },
        assumptions: {},
        blockers,
      };
    }
  }
  if (indexConfig.id === "SOX") {
    observed.risk_free_rate = observedValue({
      value: context.dgs10.value,
      source: "macro/fred-banking-daily.json",
      sourceField: "series.DGS10[-1].value / 100",
      asOf: context.dgs10.date,
      label: "US 10Y Treasury",
    });
    observed.equity_risk_premium = observedValue({
      value: context.usErp.value,
      source: "damodaran/erp.json",
      sourceField: "us_erp",
      asOf: context.usErp.source_date,
      label: "Damodaran US ERP",
    });
    if (context.soxWeights) {
      const joined = stockActionRowsForSoxWeights(context.stockActionPayload, context.soxWeights);
      const payoutRatio = buildSoxPayoutRatio(indexConfig, benchmarkRow, context.stockActionPayload, context.soxWeights);
      const explicitEpsGrowth3y = buildSoxForwardEpsGrowth(
        indexConfig,
        context.stockActionPayload,
        context.soxWeights,
        context.minCoveredWeight,
      );
      const costOfEquityValue = context.dgs10.value + context.usErp.value;
      const blockers = [];
      if (context.soxWeights.freshness?.status === "refresh_recommended") {
        blockers.push({
          code: "sox_giw_daily_refresh_recommended",
          severity: "freshness_blocker",
        });
      }
      if ((payoutRatio.coverage?.covered_weight_ratio ?? 0) < context.minCoveredWeight) {
        blockers.push({
          code: "sox_payout_coverage_below_threshold",
          severity: "public_blocker",
        });
      }
      if ((explicitEpsGrowth3y.coverage?.covered_weight_ratio ?? 0) < context.minCoveredWeight) {
        blockers.push({
          code: "sox_forward_eps_coverage_below_threshold",
          severity: "public_blocker",
        });
      }
      return {
        id: indexConfig.id,
        label: indexConfig.label,
        role: "secondary_input_only",
        public_status: blockers.length
          ? "input_only_sox_methodology_weights_with_caveats"
          : "ready_inputs_and_forecast_grid",
        observed,
        derived: {
          book_value: buildBookValue(benchmarkRow),
          payout_ratio: payoutRatio,
          explicit_eps_growth_3y: explicitEpsGrowth3y,
          cost_of_equity: derivedValue({
            value: round(costOfEquityValue, 8),
            formula: "risk_free_rate + equity_risk_premium",
            sources: ["observed.risk_free_rate", "observed.equity_risk_premium"],
            notes: ["SOX uses US risk-free and Damodaran US ERP inputs; no house premium adjustment included."],
          }),
          forecast_grid_v1: buildForecastGrid(
            indexConfig,
            benchmarkRow,
            context.stockActionPayload,
            payoutRatio,
            costOfEquityValue,
            explicitEpsGrowth3y,
            {
              indexRows: joined.indexRows,
              denominatorRows: joined.denominatorRows,
              indexKey: SOX_DERIVED_WEIGHT_KEY,
              sourceRefs: ["computed/stock_action_index.json", context.soxWeights.source],
              publicStatus: "input_only_sox_methodology_weights_no_fair_value",
              indexDiagnostics: soxWeightDiagnostics(context.stockActionPayload, context.soxWeights),
              notes: [
                "SOX forecast grid uses Nasdaq GIW official constituents plus methodology-derived stock_action market-cap weights.",
                "Official GIW weight columns are not available in the public free view; generated weights are not licensed official weights.",
                "SOXX/SOXQ ETF holdings remain diagnostics-only and are not used as top-level SOX RIM weights.",
              ],
            },
          ),
        },
        assumptions: {},
        blockers,
      };
    }
  }
  const proxyInputs = buildProxyInputs(indexConfig, benchmarkRow, context);
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
      ...(proxyInputs ? { proxy_inputs_v1: proxyInputs } : {}),
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
  const stockActionPayload = readFrom("computed/stock_action_index.json");
  const context = {
    benchmarkPayloads,
    dgs10: loadDgs10(macroPayload),
    kr10y: loadKr10y(macroPayload),
    krxKr10y: loadKrxKorea10y(originalDataRoot),
    krxKospiWeights: loadKrxKospiMarketCapWeights(originalDataRoot, generatedAt),
    usErp: loadUsErp(erpPayload),
    erpPayload,
    stockActionPayload,
    soxWeights: loadSoxMethodologyWeights(originalDataRoot, stockActionPayload, generatedAt),
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
      forecast_grid_v1_scope: "SPX_NDX_plus_KOSPI_when_krx_exact_weights_available_inputs_only; proxy grids stay nested under proxy_inputs_v1",
      primary_indices: PRIMARY_INDICES.map((item) => item.id),
      secondary_or_backlog_indices: SECONDARY_INDICES.map((item) => item.id),
      kospi_weight_method: "KRX KOSPI issuer MKTCAP / total KOSPI MKTCAP when available",
      kospi_etf_proxy_policy: "EWY/MSCI Korea is diagnostics-only and must not be used as KOSPI RIM weights",
      sox_weight_method: "Nasdaq GIW official SOX constituents + stock_action market caps + published SOX methodology caps; not official GIW weight columns",
      proxy_input_policy: "ETF proxy inputs are not exact index substitutes and must not set publication_ready.",
    },
    indices,
    coverage_diagnostics: {
      stock_action: {
        SPX: stockActionIndexDiagnostics(context.stockActionPayload, "sp500"),
        NDX: stockActionIndexDiagnostics(context.stockActionPayload, "nasdaq100"),
        KOSPI: koreaCoverageDiagnostics(context.stockActionPayload, context.krxKospiWeights),
        SOX: soxWeightDiagnostics(context.stockActionPayload, context.soxWeights),
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
  for (const id of ["KOSPI", "SOX"]) {
    const item = payload?.indices?.[id];
    if (!item || item.public_status !== "ready_inputs_and_forecast_grid") continue;
    if (item.blockers?.length) errors.push(`${id}: ready secondary index must not have blockers`);
    for (const key of ["risk_free_rate", "equity_risk_premium"]) {
      const field = item.observed?.[key];
      if (!finite(field?.value) || field.value <= 0) errors.push(`${id}.${key}: positive observed value required`);
      if (field?.source_tier !== "observed_source") errors.push(`${id}.${key}: observed_source tier required`);
    }
    for (const key of ["payout_ratio", "explicit_eps_growth_3y", "cost_of_equity"]) {
      if (item.derived?.[key]?.source_tier !== "derived_formula") errors.push(`${id}.${key}: derived_formula tier required`);
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
    const expectedGridStatus = id === "KOSPI"
      ? "input_only_krx_exact_weights_no_fair_value"
      : "input_only_sox_methodology_weights_no_fair_value";
    if (grid?.public_status !== expectedGridStatus) {
      errors.push(`${id}.forecast_grid_v1: public_status must be ${expectedGridStatus}`);
    }
    if (!Array.isArray(grid?.periods) || grid.periods.length !== 3) {
      errors.push(`${id}.forecast_grid_v1: exactly 3 periods required`);
    }
    if (id === "SOX") {
      if (item.derived?.proxy_inputs_v1) errors.push("SOX.proxy_inputs_v1: must not exist on ready SOX methodology output");
      const diagnostic = payload?.coverage_diagnostics?.stock_action?.SOX;
      if (diagnostic?.source_tier !== "methodology_derived_index_weight_source") {
        errors.push("SOX coverage diagnostic must use methodology_derived_index_weight_source");
      }
      if (diagnostic?.official_weight_columns_available !== false) {
        errors.push("SOX coverage diagnostic must disclose official_weight_columns_available=false");
      }
    }
  }
  const kospiRiskFree = payload?.indices?.KOSPI?.observed?.risk_free_rate;
  const kospiRiskFreeSourceFields = [
    kospiRiskFree?.source,
    kospiRiskFree?.source_field,
    kospiRiskFree?.candidate?.series_id,
  ].filter(Boolean).join(" ");
  if (/\bDGS10\b/i.test(kospiRiskFreeSourceFields)) {
    errors.push("KOSPI must not use DGS10 as risk_free_rate");
  }
  for (const [id, item] of Object.entries(payload?.indices ?? {})) {
    const proxy = item?.derived?.proxy_inputs_v1;
    if (!proxy) continue;
    if (item.public_status === "ready_inputs_and_forecast_grid") {
      errors.push(`${id}.proxy_inputs_v1: proxy inputs must not make the index public-ready`);
    }
    if (!Array.isArray(item.blockers) || item.blockers.length === 0) {
      errors.push(`${id}.proxy_inputs_v1: top-level blockers are required`);
    }
    if (proxy.schema_version !== "proxy_inputs_v1") {
      errors.push(`${id}.proxy_inputs_v1: schema_version required`);
    }
    if (proxy.source_tier !== "proxy_diagnostic") {
      errors.push(`${id}.proxy_inputs_v1: source_tier must be proxy_diagnostic`);
    }
    if (proxy.exact_index_substitute !== false) {
      errors.push(`${id}.proxy_inputs_v1: exact_index_substitute must be false`);
    }
    if (proxy.public_status !== "proxy_input_only_exact_index_blocked") {
      errors.push(`${id}.proxy_inputs_v1: public_status must be proxy_input_only_exact_index_blocked`);
    }
    const proxyCoverage = proxy.coverage?.forward_eps_fy1_fy3_weight_ratio;
    if (!finite(proxyCoverage) || proxyCoverage < minCoveredWeight) {
      errors.push(`${id}.proxy_inputs_v1: forward_eps_fy1_fy3_weight_ratio below ${minCoveredWeight}`);
    }
    for (const key of ["payout_ratio", "explicit_eps_growth_3y", "cost_of_equity"]) {
      if (proxy.key_inputs?.[key]?.source_tier !== "derived_formula") {
        errors.push(`${id}.proxy_inputs_v1.key_inputs.${key}: derived_formula tier required`);
      }
    }
    const grid = proxy.forecast_grid_v1;
    if (grid?.schema_version !== "forecast_grid_v1") {
      errors.push(`${id}.proxy_inputs_v1.forecast_grid_v1: schema_version required`);
    }
    if (grid?.public_status !== "proxy_input_only_no_fair_value_exact_index_blocked") {
      errors.push(`${id}.proxy_inputs_v1.forecast_grid_v1: public_status must be proxy_input_only_no_fair_value_exact_index_blocked`);
    }
    if (!Array.isArray(grid?.periods) || grid.periods.length !== 3) {
      errors.push(`${id}.proxy_inputs_v1.forecast_grid_v1: exactly 3 periods required`);
    }
  }
  const forbidden = scanForbiddenKeys(payload);
  if (forbidden.length > 0) errors.push(`forbidden output keys: ${forbidden.join(", ")}`);
  return { ok: errors.length === 0, errors, warnings };
}

export function parseArgs(argv) {
  const args = {
    output: DEFAULT_OUTPUT,
    write: true,
    publicMirror: true,
    check: false,
    minCoveredWeight: DEFAULT_MIN_COVERED_WEIGHT,
    dataRoot: dataRoot,
    publicDataRoot: publicDataRoot,
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
    } else if (arg.startsWith("--data-root=")) {
      args.dataRoot = path.resolve(arg.slice("--data-root=".length));
    } else if (arg === "--data-root") {
      args.dataRoot = path.resolve(argv[++i]);
    } else if (arg.startsWith("--public-data-root=")) {
      args.publicDataRoot = path.resolve(arg.slice("--public-data-root=".length));
    } else if (arg === "--public-data-root") {
      args.publicDataRoot = path.resolve(argv[++i]);
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
  const outputPath = path.join(args.dataRoot, args.output);
  const currentPayload = fs.existsSync(outputPath) ? readJson(outputPath) : null;
  const generatedAt = args.check && currentPayload?.generated_at
    ? currentPayload.generated_at
    : new Date().toISOString();
  const payload = buildRimIndexInputs({ dataRootOverride: args.dataRoot, generatedAt, minCoveredWeight: args.minCoveredWeight });
  const validation = validateRimIndexInputs(payload, { minCoveredWeight: args.minCoveredWeight });
  if (!validation.ok) throw new Error(validation.errors.join("\n"));
  if (args.check) {
    if (!currentPayload) throw new Error(`${path.join("data", args.output)} is missing`);
    if (JSON.stringify(currentPayload) !== JSON.stringify(payload)) {
      throw new Error(`${path.join("data", args.output)} is not up to date`);
    }
    if (args.publicMirror) {
      const mirrorPath = path.join(args.publicDataRoot, args.output);
      const currentMirror = fs.existsSync(mirrorPath) ? readJson(mirrorPath) : null;
      const publicPayload = buildPublicRimMirror(payload);
      if (!currentMirror) throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is missing`);
      if (JSON.stringify(currentMirror) !== JSON.stringify(publicPayload)) {
        throw new Error(`${path.join("100xfenok-next/public/data", args.output)} is not up to date`);
      }
    }
  }
  if (args.write) {
    writeJson(args.output, payload, [args.dataRoot]);
    if (args.publicMirror) {
      writeJson(args.output, buildPublicRimMirror(payload), [args.publicDataRoot]);
    }
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
