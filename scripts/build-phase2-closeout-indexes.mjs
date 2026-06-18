import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const publicDataRoot = path.join(repoRoot, "100xfenok-next", "public", "data");
const sectorMapPath = path.join(repoRoot, "100xfenok-next", "src", "lib", "design", "sector-map.json");
const appRoots = [
  path.join(repoRoot, "100xfenok-next", "src"),
  path.join(repoRoot, "100xfenok-next", "public", "admin"),
];

const generatedAt = new Date().toISOString();
const SECTOR_MAP = JSON.parse(fs.readFileSync(sectorMapPath, "utf8"));

// G0 v0.3 contract: keep all score constants in one place so the planning
// contract and this generator can be reviewed 1:1 without prose drift.
const ACTION_SCORE_CONFIG = Object.freeze({
  schema_version: 2,
  confidenceBlend: {
    signalWeight: 0.7,
    coverageWeight: 0.3,
  },
  confidenceThresholds: {
    high: 0.75,
    medium: 0.5,
  },
  evidenceGuard: {
    minEligibleFamiliesForAction: 3,
    minPresentFamiliesForAction: 3,
    lowEvidenceActionScoreCap: 49,
  },
  familyMax: {
    valuation: 20,
    momentum_revision: 22,
    income: 10,
    index_structure: 18,
    smart_money: 25,
    sector_smart_money: 5,
  },
  bucketThresholds: {
    smart_money: { minSmartMoneyPct: 0.5, minCoverageRatio: 0.5 },
    value_momentum: { minValuationPct: 0.5, minMomentumPct: 0.4, minCoverageRatio: 0.5 },
    index_core: { minIndexPct: 0.5, minCoverageRatio: 0.5 },
    income: { minIncomePct: 0.75, minCoverageRatio: 0.5 },
    momentum: { minMomentumPct: 0.55, minCoverageRatio: 0.5 },
  },
});

const STOCK_ACTION_SOURCES = [
  "global-scouter/core/stocks_analyzer.json",
  "global-scouter/stocks/detail/*.json",
  "global-scouter/core/revision_movers.json",
  "yf/quarter_closes.json",
  "sec-13f/by_sector.json",
  "sec-13f/analytics/guru_holders_index.json",
  "sec-13f/analytics/enhanced_consensus.json",
  "sec-13f/analytics/conviction_entries.json",
  "slickcharts/universe.json",
  "slickcharts/sp500-analysis.json",
  "slickcharts/nasdaq100-analysis.json",
  "slickcharts/dowjones-analysis.json",
  "slickcharts/stocks-returns.json",
  "slickcharts/stocks-dividends.json",
];

const MARKET_STRUCTURE_SOURCES = [
  "benchmarks/summaries.json",
  "computed/signals.json",
  "damodaran/credit_ratings.json",
  "macro/stablecoins.json",
  "macro/tga.json",
  "sentiment/aaii.json",
  "sentiment/cnn-components.json",
  "slickcharts/magnificent7.json",
  "slickcharts/sp500-marketcap.json",
  "slickcharts/membership-changes.json",
  "slickcharts/sp500-analysis.json",
  "slickcharts/nasdaq100-analysis.json",
  "slickcharts/dowjones-analysis.json",
];

const GENERATED_OUTPUTS = [
  "admin/data-usage-manifest.json",
  "computed/stock_action_index.json",
  "computed/stock_action_summary.json",
  "computed/market_structure_index.json",
];

const ESTIMATE_HORIZONS = ["fy1", "fy2", "fy3"];

const CATEGORY_USAGE = {
  admin: "Admin proof layer and notification caches",
  benchmarks: "market valuation, sector momentum, thermometer decomposition",
  calendar: "explore week-ahead and event risk",
  computed: "signal strip, market signal pulses, generated product indexes",
  damodaran: "ERP anchor and market-valuation risk premium context",
  "global-scouter": "screener base universe, detail panels, revision movers, bond/economic pulses",
  indices: "market trend and drawdown context",
  macro: "PMI/ISM/OECD, liquidity, banking, TGA/stablecoin depth",
  "sec-13f": "superinvestors, smart money panels, screener action reasons",
  sentiment: "dashboard, market valuation sentiment pulses, signal strip",
  slickcharts: "leaderboards, index structure, holdings, returns, dividends, action reasons",
  stockanalysis: "ETF workspace, market event route, ticker fallback APIs, Admin Data Lab collection visibility",
  yardney: "bond-yield valuation card",
  yf: "portfolio and stock detail quote fallbacks",
};

const DYNAMIC_PATTERNS = [
  {
    pattern: "global-scouter/stocks/detail/*.json",
    category: "global-scouter",
    usage: "Screener stock detail panel loads ticker detail on demand",
  },
  {
    pattern: "sec-13f/investors/*.json",
    category: "sec-13f",
    usage: "Superinvestor pages load investor files on demand",
  },
  {
    pattern: "slickcharts/stocks/*.json",
    category: "slickcharts",
    usage: "Screener detail panel loads per-stock SlickCharts history on demand",
  },
  {
    pattern: "yf/finance/*.json",
    category: "yf",
    usage: "Portfolio and stock detail quote fallbacks load ticker finance files on demand",
  },
  {
    pattern: "stockanalysis/etfs/*.json",
    category: "stockanalysis",
    usage: "ETF detail pages and StockAnalysis asset API load per-ETF detail files on demand",
  },
  {
    pattern: "stockanalysis/stocks/*.json",
    category: "stockanalysis",
    usage: "StockAnalysis asset API loads per-stock overview files on demand",
  },
  {
    pattern: "stockanalysis/financials/*.json",
    category: "stockanalysis",
    usage: "StockAnalysis financials API loads per-ticker financial files on demand",
  },
  {
    pattern: "stockanalysis/surfaces/*.json",
    category: "stockanalysis",
    usage: "Market events, ETF snapshot, and ticker surface APIs load collected StockAnalysis surfaces on demand",
  },
  {
    pattern: "stockanalysis/backfill/*.json",
    category: "stockanalysis",
    usage: "Admin Data Lab reads ETF backfill index, incremental proof, and pending ledger artifacts",
  },
];

function readJson(relPath, fallback = null) {
  const abs = path.join(dataRoot, relPath);
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(absPath) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
}

function writeJsonToBoth(relPath, payload, options = {}) {
  const existing = readJson(relPath, null);
  if (
    existing &&
    stablePayloadForCompare(existing) === stablePayloadForCompare(payload) &&
    typeof existing.generated_at === "string"
  ) {
    payload.generated_at = existing.generated_at;
  }

  const indent = options.compact ? 0 : 2;
  const body = `${JSON.stringify(payload, null, indent)}\n`;
  for (const root of [dataRoot, publicDataRoot]) {
    const abs = path.join(root, relPath);
    ensureDir(abs);
    fs.writeFileSync(abs, body, "utf8");
  }
}

function stablePayloadForCompare(payload) {
  if (!payload || typeof payload !== "object") return JSON.stringify(payload);
  return JSON.stringify({
    ...payload,
    generated_at: null,
  });
}

function collectJsonFiles(root) {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        out.push(path.relative(root, abs).split(path.sep).join("/"));
      }
    }
  }
  walk(root);
  return out.sort();
}

function collectTextFiles(root) {
  const out = [];
  const allowed = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".html", ".css", ".md"]);
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(abs);
      } else if (entry.isFile() && allowed.has(path.extname(entry.name))) {
        const rel = path.relative(repoRoot, abs).split(path.sep).join("/");
        if (rel === "100xfenok-next/src/generated/static-route-manifest.ts") continue;
        out.push(abs);
      }
    }
  }
  walk(root);
  return out;
}

function normalizeDataPath(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^\/+/, "")
    .replace(/^(\.\.\/)+/, "")
    .replace(/^public\//, "");
  if (trimmed.startsWith("data/")) return trimmed.slice("data/".length);
  return null;
}

function scanUsedDataPaths() {
  const paths = new Map();
  const regexes = [
    /["'`]((?:\/|\.\.\/)+data\/[^"'`)\s]+?\.json)["'`]/g,
    /path:\s*["'`]((?:\/|\.\.\/)+data\/[^"'`)\s]+?\.json)["'`]/g,
  ];

  for (const root of appRoots) {
    for (const file of collectTextFiles(root)) {
      const relFile = path.relative(repoRoot, file).split(path.sep).join("/");
      const text = fs.readFileSync(file, "utf8");
      for (const regex of regexes) {
        let match;
        while ((match = regex.exec(text)) !== null) {
          const relDataPath = normalizeDataPath(match[1]);
          if (!relDataPath) continue;
          if (!paths.has(relDataPath)) paths.set(relDataPath, []);
          paths.get(relDataPath).push(relFile);
        }
      }
    }
  }

  return Array.from(paths.entries())
    .map(([dataPath, consumers]) => ({
      dataPath,
      category: categoryOf(dataPath),
      consumers: Array.from(new Set(consumers)).sort(),
    }))
    .sort((a, b) => a.dataPath.localeCompare(b.dataPath));
}

function categoryOf(relPath) {
  return relPath.includes("/") ? relPath.split("/")[0] : "root";
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function num(value) {
  return finite(value) ? value : null;
}

function estimateNum(block, metric, key) {
  const value = block?.[metric]?.[key];
  return num(value);
}

const detailCache = new Map();

function stockDetail(symbol) {
  if (!symbol) return null;
  const key = String(symbol).trim().toUpperCase();
  if (!detailCache.has(key)) {
    const detail = readJson(`global-scouter/stocks/detail/${key}.json`, null);
    detailCache.set(key, detail && typeof detail === "object" ? detail : null);
  }
  return detailCache.get(key);
}

function ratioEstimateNum(existingBlock, metric, numeratorBlock, numeratorMetric, denominatorBlock, denominatorMetric, key) {
  const existing = estimateNum(existingBlock, metric, key);
  if (existing !== null) return round(existing, 2);
  const numerator = estimateNum(numeratorBlock, numeratorMetric, key);
  const denominator = estimateNum(denominatorBlock, denominatorMetric, key);
  if (numerator === null || denominator === null || denominator === 0) return null;
  return round((numerator / denominator) * 100, 2);
}

function stockEstimateSnapshot(symbol) {
  if (!symbol) return null;
  const detail = stockDetail(symbol);
  if (!detail || typeof detail !== "object") return null;
  const snapshot = {
    forwardPe: {
      fy1: estimateNum(detail.valuation_estimates, "per", "fy1"),
      fy2: estimateNum(detail.valuation_estimates, "per", "fy2"),
      fy3: estimateNum(detail.valuation_estimates, "per", "fy3"),
    },
    forwardEps: {
      fy1: estimateNum(detail.per_share_estimates, "eps", "fy1"),
      fy2: estimateNum(detail.per_share_estimates, "eps", "fy2"),
      fy3: estimateNum(detail.per_share_estimates, "eps", "fy3"),
    },
    revenueGrowth: {
      fy1: estimateNum(detail.growth_estimates, "revenue_growth", "fy1"),
      fy2: estimateNum(detail.growth_estimates, "revenue_growth", "fy2"),
      fy3: estimateNum(detail.growth_estimates, "revenue_growth", "fy3"),
    },
    epsGrowth: {
      fy1: estimateNum(detail.growth_estimates, "eps_growth", "fy1"),
      fy2: estimateNum(detail.growth_estimates, "eps_growth", "fy2"),
      fy3: estimateNum(detail.growth_estimates, "eps_growth", "fy3"),
    },
  };
  const hasValue = Object.values(snapshot).some((group) => Object.values(group).some((value) => value !== null));
  return hasValue ? snapshot : null;
}

function stockProfitabilityEstimateSnapshot(symbol) {
  if (!symbol) return null;
  const detail = stockDetail(symbol);
  if (!detail || typeof detail !== "object") return null;
  const snapshot = {
    grossMargin: {
      fy1: ratioEstimateNum(detail.profitability_estimates, "gross_margin", detail.income_statement_estimates, "gross_profit", detail.income_statement_estimates, "revenue", "fy1"),
      fy2: ratioEstimateNum(detail.profitability_estimates, "gross_margin", detail.income_statement_estimates, "gross_profit", detail.income_statement_estimates, "revenue", "fy2"),
      fy3: ratioEstimateNum(detail.profitability_estimates, "gross_margin", detail.income_statement_estimates, "gross_profit", detail.income_statement_estimates, "revenue", "fy3"),
    },
    operatingMargin: {
      fy1: ratioEstimateNum(detail.profitability_estimates, "operating_margin", detail.income_statement_estimates, "operating_income", detail.income_statement_estimates, "revenue", "fy1"),
      fy2: ratioEstimateNum(detail.profitability_estimates, "operating_margin", detail.income_statement_estimates, "operating_income", detail.income_statement_estimates, "revenue", "fy2"),
      fy3: ratioEstimateNum(detail.profitability_estimates, "operating_margin", detail.income_statement_estimates, "operating_income", detail.income_statement_estimates, "revenue", "fy3"),
    },
    roe: {
      fy1: ratioEstimateNum(detail.profitability_estimates, "roe", detail.income_statement_estimates, "net_income", detail.scale_estimates, "total_equity", "fy1"),
      fy2: ratioEstimateNum(detail.profitability_estimates, "roe", detail.income_statement_estimates, "net_income", detail.scale_estimates, "total_equity", "fy2"),
      fy3: ratioEstimateNum(detail.profitability_estimates, "roe", detail.income_statement_estimates, "net_income", detail.scale_estimates, "total_equity", "fy3"),
    },
  };
  const hasValue = Object.values(snapshot).some((group) => Object.values(group).some((value) => value !== null));
  return hasValue ? snapshot : null;
}

function round(value, digits = 4) {
  return finite(value) ? Number(value.toFixed(digits)) : null;
}

function percentFromPoint(value) {
  return finite(value) ? value / 100 : null;
}

function normalizeTicker(symbol) {
  const raw = String(symbol ?? "").trim().toUpperCase();
  if (!raw) return { ticker_normalized: "", market: "unknown" };
  if (raw.endsWith(".KS")) return { ticker_normalized: raw.replace(".KS", ""), market: "KRX" };
  if (raw.endsWith(".KQ")) return { ticker_normalized: raw.replace(".KQ", ""), market: "KOSDAQ" };
  if (raw.endsWith(".HK")) return { ticker_normalized: raw.replace(".HK", ""), market: "HKEX" };
  if (raw.endsWith(".SZ")) return { ticker_normalized: raw.replace(".SZ", ""), market: "SZSE" };
  if (raw.endsWith(".SS")) return { ticker_normalized: raw.replace(".SS", ""), market: "SSE" };
  if (/^\d{4,6}$/.test(raw)) return { ticker_normalized: raw, market: "ASIA" };
  if (raw.includes(".")) return { ticker_normalized: raw.replace(".", "-"), market: "US_CLASS" };
  return { ticker_normalized: raw, market: "US" };
}

function qualityFlags(stock, context) {
  const flags = [];
  if (stock.price === null || stock.price === undefined) flags.push("missing_price");
  if (stock.peForward === null || stock.peForward === undefined) flags.push("missing_forward_pe");
  if (stock.epsForward === null || stock.epsForward === undefined) flags.push("missing_forward_eps");
  if (!context.quarterClose) flags.push("missing_quarter_close_history");
  if (context.dividendHistory?.historyCount === 0) flags.push("no_dividend_history");
  if (context.convictionNameOnly) flags.push("conviction_name_not_ticker");
  return flags;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function canonicalSectorFromGics(raw) {
  if (typeof raw !== "string") return "Other";
  const trimmed = raw.trim();
  return SECTOR_MAP.gicsToCanonical?.[trimmed] ?? "Other";
}

function canonicalSectorFromScouter(raw) {
  if (typeof raw !== "string") return "Other";
  const trimmed = raw.trim();
  return SECTOR_MAP.scouterToCanonical?.[trimmed] ?? "Other";
}

function marketScopeFromMarket(market) {
  if (market === "US" || market === "US_CLASS") return "us";
  if (market === "KRX" || market === "KOSDAQ") return "korea";
  if (market === "HKEX" || market === "SSE" || market === "SZSE" || market === "ASIA") return "asia";
  return "other";
}

function actionFamily(key, { eligible, present, score, reason = null }) {
  const max = ACTION_SCORE_CONFIG.familyMax[key];
  const isEligible = Boolean(eligible);
  const isPresent = Boolean(isEligible && present);
  return {
    key,
    eligible: isEligible,
    present: isPresent,
    score: isPresent ? round(clamp(score ?? 0, 0, max), 2) : 0,
    max,
    reason,
  };
}

function compactFamily(family) {
  return {
    present: family.present,
    eligible: family.eligible,
    score: family.score,
    max: family.max,
  };
}

function familyPct(family) {
  return family?.present && family.max > 0 ? family.score / family.max : 0;
}

function percentile(values, p) {
  const nums = values.filter(finite).sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const idx = clamp(Math.ceil(nums.length * p) - 1, 0, nums.length - 1);
  return round(nums[idx], 2);
}

function countBy(rows, key) {
  return rows.reduce((acc, row) => {
    const value = row?.[key] ?? "unknown";
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function indexWeightMap() {
  const defs = [
    ["sp500", "slickcharts/sp500-analysis.json"],
    ["nasdaq100", "slickcharts/nasdaq100-analysis.json"],
    ["dowjones", "slickcharts/dowjones-analysis.json"],
  ];
  const map = new Map();
  for (const [index, relPath] of defs) {
    const doc = readJson(relPath, {});
    const rows = Array.isArray(doc?.analysis) ? doc.analysis : [];
    for (const row of rows) {
      if (typeof row.symbol !== "string") continue;
      const symbol = row.symbol.trim().toUpperCase();
      if (!map.has(symbol)) map.set(symbol, []);
      map.get(symbol).push({
        index,
        rank: num(row.rank),
        weight: num(row.weight),
        cumulativeWeight: num(row.cumulativeWeight),
      });
    }
  }
  return map;
}

function latestReturnMap() {
  const doc = readJson("slickcharts/stocks-returns.json", {});
  const map = new Map();
  for (const row of Array.isArray(doc?.stocks) ? doc.stocks : []) {
    if (typeof row.symbol !== "string") continue;
    const returns = Array.isArray(row.returns) ? row.returns : [];
    const latest = returns.find((item) => finite(item?.return)) ?? null;
    map.set(row.symbol.trim().toUpperCase(), {
      latestYear: num(latest?.year),
      latestReturn: percentFromPoint(latest?.return),
      historyCount: returns.length,
    });
  }
  return map;
}

function dividendMap() {
  const doc = readJson("slickcharts/stocks-dividends.json", {});
  const map = new Map();
  for (const row of Array.isArray(doc?.stocks) ? doc.stocks : []) {
    if (typeof row.symbol !== "string") continue;
    const dividends = Array.isArray(row.dividends) ? row.dividends : [];
    const latest = dividends[0] ?? null;
    const ttm = dividends.slice(0, 4).reduce((sum, item) => sum + (finite(item?.amount) ? item.amount : 0), 0);
    map.set(row.symbol.trim().toUpperCase(), {
      latestAmount: num(latest?.amount),
      latestExDate: typeof latest?.exDate === "string" ? latest.exDate : null,
      ttm: dividends.length > 0 ? round(ttm, 4) : null,
      historyCount: dividends.length,
    });
  }
  return map;
}

function quarterCloseMap() {
  const doc = readJson("yf/quarter_closes.json", {});
  const map = new Map();
  const tickers = doc?.tickers && typeof doc.tickers === "object" ? doc.tickers : {};
  for (const [symbol, row] of Object.entries(tickers)) {
    if (!row || typeof row !== "object") continue;
    const points = Object.entries(row)
      .filter(([date, value]) => date !== "latest" && finite(value))
      .sort(([a], [b]) => a.localeCompare(b));
    const first = points[0];
    const last = points[points.length - 1];
    const latest = row.latest && typeof row.latest === "object" ? row.latest : null;
    map.set(symbol.trim().toUpperCase(), {
      points: points.length,
      firstDate: first?.[0] ?? null,
      lastQuarterDate: last?.[0] ?? null,
      latestDate: typeof latest?.date === "string" ? latest.date : last?.[0] ?? null,
      latestClose: finite(latest?.close) ? latest.close : finite(last?.[1]) ? last[1] : null,
    });
  }
  return {
    meta: {
      schema_version: doc?.schema_version ?? null,
      generated_at: doc?.generated_at ?? null,
      quarters: Array.isArray(doc?.quarters) ? doc.quarters.length : null,
      tickers: Object.keys(tickers).length,
      missing: Array.isArray(doc?.missing) ? doc.missing.length : null,
    },
    map,
  };
}

function revisionMap() {
  const doc = readJson("global-scouter/core/revision_movers.json", {});
  const map = new Map();
  for (const [direction, rows] of [
    ["up", doc?.up],
    ["down", doc?.down],
  ]) {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (typeof row.ticker !== "string") continue;
      map.set(row.ticker.trim().toUpperCase(), {
        direction,
        change1w: num(row.change_1w),
        epsFy1: num(row.eps_fy1),
        asOf: typeof row.as_of === "string" ? row.as_of : null,
      });
    }
  }
  return map;
}

function sectorSmartMoneyMap() {
  const doc = readJson("sec-13f/by_sector.json", {});
  const map = new Map();
  for (const [sector, value] of Object.entries(doc)) {
    if (sector.startsWith("_") || !value || typeof value !== "object") continue;
    const canonicalSector = canonicalSectorFromGics(sector);
    map.set(canonicalSector, {
      sourceSector: sector,
      canonicalSector,
      investorCount: Array.isArray(value.investors) ? value.investors.length : 0,
      avgWeight: num(value.avg_weight),
      topHoldings: Array.isArray(value.top_holdings) ? value.top_holdings.slice(0, 10) : [],
    });
  }
  return map;
}

function convictionMap(knownSymbols) {
  const doc = readJson("sec-13f/analytics/conviction_entries.json", {});
  const map = new Map();
  let nameOnlyCount = 0;
  for (const group of ["high_conviction_new", "top_conviction_hold"]) {
    for (const row of Array.isArray(doc?.[group]) ? doc[group] : []) {
      if (typeof row.ticker !== "string") continue;
      const symbol = row.ticker.trim().toUpperCase();
      if (!knownSymbols.has(symbol)) {
        nameOnlyCount += 1;
        continue;
      }
      if (!map.has(symbol)) {
        map.set(symbol, {
          count: 0,
          investors: new Set(),
          maxWeight: 0,
          maxValue: 0,
          signals: new Set(),
        });
      }
      const item = map.get(symbol);
      item.count += 1;
      if (typeof row.investor === "string") item.investors.add(row.investor);
      if (finite(row.weight)) item.maxWeight = Math.max(item.maxWeight, row.weight);
      if (finite(row.value)) item.maxValue = Math.max(item.maxValue, row.value);
      if (typeof row.signal === "string") item.signals.add(row.signal);
    }
  }

  return {
    nameOnlyCount,
    map: new Map(
      Array.from(map.entries()).map(([symbol, item]) => [
        symbol,
        {
          count: item.count,
          investors: Array.from(item.investors).sort(),
          maxWeight: round(item.maxWeight, 4),
          maxValue: round(item.maxValue, 0),
          signals: Array.from(item.signals).sort(),
        },
      ]),
    ),
  };
}

function perBandPct(stock) {
  const current = num(stock.perBandCurrent);
  const min = num(stock.perBandMin);
  const max = num(stock.perBandMax);
  if (current === null || min === null || max === null || max <= min) return null;
  return clamp((current - min) / (max - min), 0, 1);
}

function perBandLabel(pct) {
  if (pct === null) return "밴드 없음";
  if (pct <= 0.25) return "저평가권";
  if (pct >= 0.75) return "고평가권";
  return "중립권";
}

function valuationFamily(stock) {
  const bandPct = perBandPct(stock);
  const peForward = num(stock.peForward);
  const per = num(stock.per);
  const fallbackPe = peForward ?? per;
  if (bandPct !== null) {
    const score = bandPct <= 0.25 ? 20 : bandPct <= 0.5 ? 14 : bandPct < 0.75 ? 8 : 2;
    return actionFamily("valuation", {
      eligible: true,
      present: true,
      score,
      reason: `PER 밴드 ${Math.round(bandPct * 100)}%`,
    });
  }
  if (fallbackPe !== null && fallbackPe > 0) {
    const score = fallbackPe <= 15 ? 14 : fallbackPe <= 25 ? 10 : fallbackPe <= 35 ? 6 : 2;
    return actionFamily("valuation", {
      eligible: true,
      present: true,
      score,
      reason: `${peForward !== null ? "Fwd " : ""}PER ${fallbackPe.toFixed(1)}`,
    });
  }
  return actionFamily("valuation", { eligible: false, present: false, score: 0 });
}

function momentumRevisionFamily(stock, revision) {
  const ret12m = num(stock.return12m);
  const momentum3m = num(stock.momentum3m ?? stock.growthRate);
  const eligible = ret12m !== null || momentum3m !== null || revision != null;
  let score = 0;
  const reasons = [];
  if (ret12m !== null) {
    score += ret12m >= 0.25 ? 8 : ret12m >= 0 ? 5 : ret12m >= -0.2 ? 2 : 1;
    reasons.push(`12M ${(ret12m * 100).toFixed(1)}%`);
  }
  if (momentum3m !== null) {
    score += momentum3m >= 0.1 ? 6 : momentum3m >= 0 ? 3 : 1;
  }
  if (revision?.direction === "up") {
    score += 8;
    reasons.push(`EPS 상향 ${revision.change1w?.toFixed(1) ?? "—"}`);
  } else if (revision?.direction === "down") {
    score += 1;
    reasons.push(`EPS 하향 ${revision.change1w?.toFixed(1) ?? "—"}`);
  }
  return actionFamily("momentum_revision", {
    eligible,
    present: eligible,
    score,
    reason: reasons[0] ?? null,
  });
}

function incomeFamily(stock, dividendHistory) {
  const dividendYield = num(stock.dividendYield);
  const ttm = num(dividendHistory?.ttm);
  const eligible = dividendYield !== null || ttm !== null || dividendHistory?.historyCount > 0;
  let score = 0;
  let reason = null;
  if (dividendYield !== null) {
    score = dividendYield >= 0.04 ? 10 : dividendYield >= 0.03 ? 8 : dividendYield >= 0.015 ? 5 : dividendYield > 0 ? 2 : 0;
    reason = `배당 ${(dividendYield * 100).toFixed(1)}%`;
  } else if (ttm !== null && ttm > 0) {
    score = 3;
    reason = `TTM 배당 ${ttm.toFixed(2)}`;
  }
  return actionFamily("income", {
    eligible,
    present: eligible,
    score,
    reason,
  });
}

function indexStructureFamily(context) {
  const memberships = context.universe?.indices ?? [];
  const weights = context.weights ?? [];
  const maxWeight = weights.reduce((max, row) => Math.max(max, finite(row.weight) ? row.weight : 0), 0);
  const eligible = context.marketScope === "us" || memberships.length > 0 || weights.length > 0;
  const present = memberships.length > 0 || weights.length > 0;
  const score = memberships.length * 4 + (maxWeight >= 2 ? Math.min(10, maxWeight * 1.2) : maxWeight > 0 ? 2 : 0);
  const reason = present
    ? `${memberships.length > 0 ? memberships.join("/") : "index"}${maxWeight > 0 ? ` ${maxWeight.toFixed(1)}%` : ""}`
    : null;
  return actionFamily("index_structure", { eligible, present, score, reason });
}

function smartMoneyFamily(context) {
  const guru = context.guruHolders;
  const consensus = context.consensus;
  const conviction = context.conviction;
  const eligible = context.marketScope === "us" || finite(guru) || consensus != null || conviction != null;
  const present = finite(guru) || finite(consensus?.equity_score) || conviction != null;
  let score = 0;
  const reasons = [];
  if (finite(guru)) {
    score += Math.min(10, guru);
    const equityHolders = num(consensus?.equity_holders ?? consensus?.equityHolders);
    const totalHolders = num(consensus?.total_holders ?? consensus?.totalHolders);
    if (finite(equityHolders) && finite(totalHolders) && totalHolders > equityHolders) {
      reasons.push(`기관 공시 주식 ${equityHolders}명 · 옵션/클래스 포함 ${totalHolders}명`);
    } else if (guru >= 5) {
      reasons.push(`고수 보유 ${guru}명`);
    }
  }
  if (finite(consensus?.equity_score)) {
    score += consensus.equity_score * 8;
    if (consensus.equity_score >= 0.5) reasons.push(`기관 공시 컨센서스 ${consensus.equity_score.toFixed(2)}`);
  }
  if (conviction) {
    score += Math.min(7, conviction.count * 2 + (conviction.maxWeight ?? 0) * 50);
    reasons.push(`고확신 기관 공시 ${conviction.count}건`);
  }
  return actionFamily("smart_money", {
    eligible,
    present,
    score,
    reason: reasons[0] ?? null,
  });
}

function sectorSmartMoneyFamily(context) {
  const sector = context.sectorSmartMoney;
  const eligible = context.canonicalSector !== "Other" && sector != null;
  const present = eligible && finite(sector.investorCount);
  const score = present ? Math.min(5, sector.investorCount / 8 + (sector.avgWeight ?? 0) * 50) : 0;
  const reason = present ? `섹터 기관 관심 ${context.canonicalSector} ${sector.investorCount}명` : null;
  return actionFamily("sector_smart_money", { eligible, present, score, reason });
}

function summarizeActionFamilies(families) {
  const all = Object.values(families);
  const eligible = all.filter((family) => family.eligible);
  const present = eligible.filter((family) => family.present);
  const presentMax = present.reduce((sum, family) => sum + family.max, 0);
  const eligibleMax = eligible.reduce((sum, family) => sum + family.max, 0);
  const familyScore = present.reduce((sum, family) => sum + family.score, 0);
  const signalScore = presentMax > 0 ? (familyScore / presentMax) * 100 : 0;
  const coverageRatio = eligibleMax > 0 ? presentMax / eligibleMax : 0;
  const blend = ACTION_SCORE_CONFIG.confidenceBlend;
  const rawActionScore = signalScore * (blend.signalWeight + blend.coverageWeight * coverageRatio);
  const lowEvidence =
    eligible.length < ACTION_SCORE_CONFIG.evidenceGuard.minEligibleFamiliesForAction ||
    present.length < ACTION_SCORE_CONFIG.evidenceGuard.minPresentFamiliesForAction;
  const actionScore = lowEvidence
    ? Math.min(rawActionScore, ACTION_SCORE_CONFIG.evidenceGuard.lowEvidenceActionScoreCap)
    : rawActionScore;
  const confidenceLabel =
    lowEvidence
      ? "low"
      : coverageRatio >= ACTION_SCORE_CONFIG.confidenceThresholds.high
      ? "high"
      : coverageRatio >= ACTION_SCORE_CONFIG.confidenceThresholds.medium
        ? "medium"
        : "low";
  return {
    signalScore: round(signalScore, 2),
    coverageRatio: round(coverageRatio, 4),
    actionScore: round(actionScore, 2),
    confidenceLabel,
    eligibleFamilyCount: eligible.length,
    presentFamilyCount: present.length,
    lowEvidence,
  };
}

function selectActionBucket(families, summary) {
  const thresholds = ACTION_SCORE_CONFIG.bucketThresholds;
  const coverage = summary.coverageRatio ?? 0;
  const p = {
    valuation: familyPct(families.valuation),
    momentum_revision: familyPct(families.momentum_revision),
    income: familyPct(families.income),
    index_structure: familyPct(families.index_structure),
    smart_money: familyPct(families.smart_money),
  };
  if (summary.lowEvidence) return { bucket: "watch", label: "관찰" };

  const candidates = [];
  if (p.smart_money >= thresholds.smart_money.minSmartMoneyPct && coverage >= thresholds.smart_money.minCoverageRatio) {
    candidates.push({ bucket: "smart_money", label: "기관/고수 주목", strength: p.smart_money });
  }
  if (
    p.valuation >= thresholds.value_momentum.minValuationPct &&
    p.momentum_revision >= thresholds.value_momentum.minMomentumPct &&
    coverage >= thresholds.value_momentum.minCoverageRatio
  ) {
    candidates.push({ bucket: "value_momentum", label: "밸류+모멘텀", strength: (p.valuation + p.momentum_revision) / 2 });
  }
  if (p.index_structure >= thresholds.index_core.minIndexPct && coverage >= thresholds.index_core.minCoverageRatio) {
    candidates.push({ bucket: "index_core", label: "지수 핵심", strength: p.index_structure });
  }
  if (p.income >= thresholds.income.minIncomePct && coverage >= thresholds.income.minCoverageRatio) {
    candidates.push({ bucket: "income", label: "배당 점검", strength: p.income });
  }
  if (p.momentum_revision >= thresholds.momentum.minMomentumPct && coverage >= thresholds.momentum.minCoverageRatio) {
    candidates.push({ bucket: "momentum", label: "모멘텀 리더", strength: p.momentum_revision });
  }

  const selected = candidates.sort((a, b) => b.strength - a.strength)[0];
  return selected ? { bucket: selected.bucket, label: selected.label } : { bucket: "watch", label: "관찰" };
}

function actionFrom(stock, context) {
  const familyList = [
    valuationFamily(stock),
    momentumRevisionFamily(stock, context.revision),
    incomeFamily(stock, context.dividendHistory),
    indexStructureFamily(context),
    smartMoneyFamily(context),
    sectorSmartMoneyFamily(context),
  ];
  const families = Object.fromEntries(familyList.map((family) => [family.key, family]));
  const summary = summarizeActionFamilies(families);
  const selected = selectActionBucket(families, summary);
  let reasons = familyList
    .filter((family) => family.present && family.reason)
    .sort((a, b) => b.score / b.max - a.score / a.max)
    .map((family) => family.reason);
  const equityHolders = num(context.consensus?.equity_holders ?? context.consensus?.equityHolders);
  const totalHolders = num(context.consensus?.total_holders ?? context.consensus?.totalHolders);
  if (finite(equityHolders) && finite(totalHolders) && totalHolders > equityHolders) {
    const smartReason = `기관 공시 주식 ${equityHolders}명 · 옵션/클래스 포함 ${totalHolders}명`;
    reasons = [smartReason, ...reasons.filter((reason) => reason !== smartReason)];
  }
  if (summary.lowEvidence) reasons.push("증거 부족");

  return {
    actionScore: summary.actionScore,
    signalScore: summary.signalScore,
    coverageRatio: summary.coverageRatio,
    confidenceLabel: summary.confidenceLabel,
    eligibleFamilyCount: summary.eligibleFamilyCount,
    presentFamilyCount: summary.presentFamilyCount,
    actionLabel: selected.label,
    actionBucket: selected.bucket,
    actionReasons: reasons.slice(0, 4),
    families: Object.fromEntries(Object.entries(families).map(([key, family]) => [key, compactFamily(family)])),
    scoreQualityFlags: summary.lowEvidence ? ["low_evidence"] : [],
    perBandPct: perBandPct(stock) !== null ? round(perBandPct(stock), 4) : null,
    perBandLabel: perBandLabel(perBandPct(stock)),
  };
}

function buildStockActionIndex() {
  const stocksDoc = readJson("global-scouter/core/stocks_analyzer.json", {});
  const rows = Array.isArray(stocksDoc?.data) ? stocksDoc.data : [];
  const universe = readJson("slickcharts/universe.json", {});
  const universeMap = new Map(
    (Array.isArray(universe?.stocks) ? universe.stocks : [])
      .filter((row) => typeof row.symbol === "string")
      .map((row) => [
        row.symbol.trim().toUpperCase(),
        {
          indices: Array.isArray(row.indices) ? row.indices : [],
          indexCount: num(row.indexCount),
        },
      ]),
  );
  const knownSymbols = new Set(rows.map((row) => String(row.symbol ?? "").trim().toUpperCase()).filter(Boolean));
  const guru = readJson("sec-13f/analytics/guru_holders_index.json", {});
  const consensus = readJson("sec-13f/analytics/enhanced_consensus.json", {});
  const weights = indexWeightMap();
  const returns = latestReturnMap();
  const dividends = dividendMap();
  const quarterCloses = quarterCloseMap();
  const revisions = revisionMap();
  const sectorSmartMoney = sectorSmartMoneyMap();
  const convictions = convictionMap(knownSymbols);

  const actionRows = rows
    .map((stock) => {
      const symbol = String(stock.symbol ?? "").trim().toUpperCase();
      const normalized = normalizeTicker(symbol);
      const marketScope = marketScopeFromMarket(normalized.market);
      const canonicalSector = canonicalSectorFromScouter(stock.sector);
      const estimateSnapshot = stockEstimateSnapshot(symbol);
      const profitabilitySnapshot = stockProfitabilityEstimateSnapshot(symbol);
      const context = {
        marketScope,
        canonicalSector,
        universe: universeMap.get(symbol) ?? { indices: [], indexCount: null },
        weights: weights.get(symbol) ?? [],
        guruHolders: num(guru?.holders?.[symbol]),
        consensus: consensus?.enhanced_consensus?.[symbol] ?? null,
        conviction: convictions.map.get(symbol) ?? null,
        convictionNameOnly: false,
        returnHistory: returns.get(symbol) ?? null,
        dividendHistory: dividends.get(symbol) ?? null,
        quarterClose: quarterCloses.map.get(symbol) ?? null,
        revision: revisions.get(symbol) ?? null,
        sectorSmartMoney: sectorSmartMoney.get(canonicalSector) ?? null,
      };
      const action = actionFrom(stock, context);
      const quality_flags = Array.from(new Set([...qualityFlags(stock, context), ...action.scoreQualityFlags])).sort();
      delete action.scoreQualityFlags;
      return {
        symbol,
        ...normalized,
        marketScope,
        company: stock.companyName ?? symbol,
        sector: stock.sector ?? null,
        canonicalSector,
        country: stock.country ?? null,
        price: num(stock.price),
        marketCap: num(stock.marketCap),
        per: num(stock.per),
        peForward: num(stock.peForward),
        dividendYield: num(stock.dividendYield),
        return12m: num(stock.return12m),
        ret1y: num(stock.ret1y),
        ret3y: num(stock.ret3y),
        ret5y: num(stock.ret5y),
        indexMembership: context.universe.indices,
        indexWeights: context.weights,
        guruHolders: context.guruHolders,
        consensus: context.consensus
          ? {
              equityScore: num(context.consensus.equity_score),
              equityHolders: num(context.consensus.equity_holders),
              totalHolders: num(context.consensus.total_holders),
              classesHeld: Array.isArray(context.consensus.classes_held) ? context.consensus.classes_held : [],
            }
          : null,
        conviction: context.conviction,
        sectorSmartMoney: context.sectorSmartMoney,
        estimateSnapshot,
        profitabilitySnapshot,
        revision: context.revision,
        slickReturn: context.returnHistory,
        dividendHistory: context.dividendHistory,
        quarterCloseHistory: context.quarterClose,
        quality_flags,
        detailHref: `/stock/${encodeURIComponent(symbol)}`,
        ...action,
      };
    })
    .filter((row) => row.symbol)
    .sort((a, b) => b.actionScore - a.actionScore || (b.marketCap ?? 0) - (a.marketCap ?? 0));

  const marketScopePercentiles = Object.entries(countBy(actionRows, "marketScope"))
    .map(([marketScopeKey, count]) => {
      const scopedRows = actionRows.filter((row) => row.marketScope === marketScopeKey);
      return {
        marketScope: marketScopeKey,
        count,
        signalScoreP50: percentile(scopedRows.map((row) => row.signalScore), 0.5),
        signalScoreP90: percentile(scopedRows.map((row) => row.signalScore), 0.9),
      };
    })
    .sort((a, b) => a.marketScope.localeCompare(b.marketScope));

  const familyCoverage = Object.keys(ACTION_SCORE_CONFIG.familyMax).map((family) => {
    const familyRows = actionRows.map((row) => row.families?.[family]).filter(Boolean);
    const eligibleCount = familyRows.filter((row) => row.eligible).length;
    const presentCount = familyRows.filter((row) => row.present).length;
    return {
      family,
      eligibleCount,
      presentCount,
      presentRatio: eligibleCount > 0 ? round(presentCount / eligibleCount, 4) : null,
    };
  });

  return {
    schema_version: ACTION_SCORE_CONFIG.schema_version,
    generated_at: generatedAt,
    source_date: stocksDoc?.source_date ?? null,
    source_files: STOCK_ACTION_SOURCES,
    score_contract: {
      version: "action-score-v0.3.1",
      config: ACTION_SCORE_CONFIG,
      doc: "docs/planning/CONTRACT_stock_action_score_v0_3_20260613.md",
    },
    coverage: {
      source_stock_count: rows.length,
      indexed_stock_count: actionRows.length,
      universe_stock_count: universe?.uniqueCount ?? null,
      guru_ticker_count: guru?.metadata?.tickers ?? Object.keys(guru?.holders ?? {}).length,
      conviction_matched_count: convictions.map.size,
      conviction_name_only_count: convictions.nameOnlyCount,
      quarter_close_ticker_count: quarterCloses.meta.tickers,
      estimate_snapshot_count: actionRows.filter((row) => row.estimateSnapshot !== null).length,
      ...Object.fromEntries(
        ESTIMATE_HORIZONS.flatMap((horizon) => [
          [`estimate_${horizon}_forward_pe_count`, actionRows.filter((row) => finite(row.estimateSnapshot?.forwardPe?.[horizon])).length],
          [`estimate_${horizon}_forward_eps_count`, actionRows.filter((row) => finite(row.estimateSnapshot?.forwardEps?.[horizon])).length],
          [`estimate_${horizon}_revenue_growth_count`, actionRows.filter((row) => finite(row.estimateSnapshot?.revenueGrowth?.[horizon])).length],
          [`estimate_${horizon}_eps_growth_count`, actionRows.filter((row) => finite(row.estimateSnapshot?.epsGrowth?.[horizon])).length],
        ]),
      ),
      profitability_estimate_snapshot_count: actionRows.filter((row) => row.profitabilitySnapshot !== null).length,
      ...Object.fromEntries(
        ESTIMATE_HORIZONS.flatMap((horizon) => [
          [`profitability_${horizon}_gross_margin_count`, actionRows.filter((row) => finite(row.profitabilitySnapshot?.grossMargin?.[horizon])).length],
          [`profitability_${horizon}_operating_margin_count`, actionRows.filter((row) => finite(row.profitabilitySnapshot?.operatingMargin?.[horizon])).length],
          [`profitability_${horizon}_roe_count`, actionRows.filter((row) => finite(row.profitabilitySnapshot?.roe?.[horizon])).length],
        ]),
      ),
      sector_smart_money_count: sectorSmartMoney.size,
      sector_smart_money_joined_count: actionRows.filter((row) => row.sectorSmartMoney != null).length,
      market_scope_counts: countBy(actionRows, "marketScope"),
      bucket_counts: countBy(actionRows, "actionBucket"),
      confidence_counts: countBy(actionRows, "confidenceLabel"),
      low_evidence_count: actionRows.filter((row) => row.quality_flags.includes("low_evidence")).length,
      signal_score_percentiles_by_scope: marketScopePercentiles,
      family_coverage: familyCoverage,
    },
    component_as_of: {
      quarter_closes_generated_at: quarterCloses.meta.generated_at,
      stocks_analyzer_source_date: stocksDoc?.source_date ?? null,
      guru_quarter: guru?.metadata?.quarter ?? null,
      slickcharts_universe_updated: universe?.updated ?? null,
    },
    rows: actionRows,
  };
}

function buildStockActionSummary(stockActionIndex) {
  const fields = [
    "symbol",
    "company",
    "sector",
    "marketScope",
    "actionScore",
    "confidenceLabel",
    "actionBucket",
    "actionLabel",
    "actionReasons",
    "lowEvidence",
    "guruHolders",
    "return12m",
    "forwardPeFy1",
    "forwardEpsFy1",
    "revenueGrowthFy1",
    "epsGrowthFy1",
    "grossMarginFy1",
    "operatingMarginFy1",
    "roeFy1",
    "forwardPeFy2",
    "forwardEpsFy2",
    "revenueGrowthFy2",
    "epsGrowthFy2",
    "grossMarginFy2",
    "operatingMarginFy2",
    "roeFy2",
    "forwardPeFy3",
    "forwardEpsFy3",
    "revenueGrowthFy3",
    "epsGrowthFy3",
    "grossMarginFy3",
    "operatingMarginFy3",
    "roeFy3",
  ];
  return {
    schema_version: 1,
    generated_at: stockActionIndex.generated_at,
    source_file: "computed/stock_action_index.json",
    fields,
    score_contract: {
      version: stockActionIndex.score_contract?.version ?? "action-score-v0.3.1",
      doc: stockActionIndex.score_contract?.doc ?? "docs/planning/CONTRACT_stock_action_score_v0_3_20260613.md",
    },
    coverage: {
      indexed_stock_count: stockActionIndex.coverage?.indexed_stock_count ?? stockActionIndex.rows.length,
      guru_ticker_count: stockActionIndex.coverage?.guru_ticker_count ?? null,
      conviction_matched_count: stockActionIndex.coverage?.conviction_matched_count ?? null,
      quarter_close_ticker_count: stockActionIndex.coverage?.quarter_close_ticker_count ?? null,
      estimate_snapshot_count: stockActionIndex.coverage?.estimate_snapshot_count ?? null,
      ...Object.fromEntries(
        ESTIMATE_HORIZONS.flatMap((horizon) => [
          [`estimate_${horizon}_forward_pe_count`, stockActionIndex.coverage?.[`estimate_${horizon}_forward_pe_count`] ?? null],
          [`estimate_${horizon}_forward_eps_count`, stockActionIndex.coverage?.[`estimate_${horizon}_forward_eps_count`] ?? null],
          [`estimate_${horizon}_revenue_growth_count`, stockActionIndex.coverage?.[`estimate_${horizon}_revenue_growth_count`] ?? null],
          [`estimate_${horizon}_eps_growth_count`, stockActionIndex.coverage?.[`estimate_${horizon}_eps_growth_count`] ?? null],
        ]),
      ),
      profitability_estimate_snapshot_count: stockActionIndex.coverage?.profitability_estimate_snapshot_count ?? null,
      ...Object.fromEntries(
        ESTIMATE_HORIZONS.flatMap((horizon) => [
          [`profitability_${horizon}_gross_margin_count`, stockActionIndex.coverage?.[`profitability_${horizon}_gross_margin_count`] ?? null],
          [`profitability_${horizon}_operating_margin_count`, stockActionIndex.coverage?.[`profitability_${horizon}_operating_margin_count`] ?? null],
          [`profitability_${horizon}_roe_count`, stockActionIndex.coverage?.[`profitability_${horizon}_roe_count`] ?? null],
        ]),
      ),
      market_scope_counts: stockActionIndex.coverage?.market_scope_counts ?? {},
      bucket_counts: stockActionIndex.coverage?.bucket_counts ?? {},
      confidence_counts: stockActionIndex.coverage?.confidence_counts ?? {},
      low_evidence_count: stockActionIndex.coverage?.low_evidence_count ?? null,
    },
    rows: stockActionIndex.rows.map((row) => [
      row.symbol,
      row.company ?? row.symbol,
      row.sector ?? null,
      row.marketScope ?? null,
      row.actionScore ?? null,
      row.confidenceLabel ?? null,
      row.actionBucket ?? null,
      row.actionLabel ?? null,
      Array.isArray(row.actionReasons) ? row.actionReasons.slice(0, 2) : [],
      Array.isArray(row.quality_flags) ? row.quality_flags.includes("low_evidence") : false,
      row.guruHolders ?? null,
      row.return12m ?? null,
      row.estimateSnapshot?.forwardPe?.fy1 ?? null,
      row.estimateSnapshot?.forwardEps?.fy1 ?? null,
      row.estimateSnapshot?.revenueGrowth?.fy1 ?? null,
      row.estimateSnapshot?.epsGrowth?.fy1 ?? null,
      row.profitabilitySnapshot?.grossMargin?.fy1 ?? null,
      row.profitabilitySnapshot?.operatingMargin?.fy1 ?? null,
      row.profitabilitySnapshot?.roe?.fy1 ?? null,
      row.estimateSnapshot?.forwardPe?.fy2 ?? null,
      row.estimateSnapshot?.forwardEps?.fy2 ?? null,
      row.estimateSnapshot?.revenueGrowth?.fy2 ?? null,
      row.estimateSnapshot?.epsGrowth?.fy2 ?? null,
      row.profitabilitySnapshot?.grossMargin?.fy2 ?? null,
      row.profitabilitySnapshot?.operatingMargin?.fy2 ?? null,
      row.profitabilitySnapshot?.roe?.fy2 ?? null,
      row.estimateSnapshot?.forwardPe?.fy3 ?? null,
      row.estimateSnapshot?.forwardEps?.fy3 ?? null,
      row.estimateSnapshot?.revenueGrowth?.fy3 ?? null,
      row.estimateSnapshot?.epsGrowth?.fy3 ?? null,
      row.profitabilitySnapshot?.grossMargin?.fy3 ?? null,
      row.profitabilitySnapshot?.operatingMargin?.fy3 ?? null,
      row.profitabilitySnapshot?.roe?.fy3 ?? null,
    ]),
  };
}

function analysisConcentration(relPath, label) {
  const doc = readJson(relPath, {});
  const rows = Array.isArray(doc?.analysis) ? doc.analysis : [];
  const sumTop = (n) => round(rows.slice(0, n).reduce((sum, row) => sum + (finite(row.weight) ? row.weight : 0), 0), 2);
  return {
    id: path.basename(relPath, "-analysis.json"),
    label,
    updated: doc?.updated ?? null,
    count: doc?.count ?? rows.length,
    top3Weight: sumTop(3),
    top10Weight: sumTop(10),
    leaders: rows.slice(0, 5).map((row) => ({
      symbol: row.symbol ?? null,
      company: row.company ?? null,
      weight: num(row.weight),
      cumulativeWeight: num(row.cumulativeWeight),
    })),
  };
}

function sampleSeries(rows, valueReader, limit = 52) {
  const series = (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const date = typeof row?.date === "string" ? row.date : null;
      const value = valueReader(row);
      return date && finite(value) ? { date, value: round(value, 4) } : null;
    })
    .filter(Boolean);
  if (series.length <= limit) return series;
  const step = Math.ceil(series.length / limit);
  const sampled = series.filter((_, index) => index % step === 0);
  const latest = series[series.length - 1];
  if (sampled[sampled.length - 1]?.date !== latest.date) sampled.push(latest);
  return sampled.slice(-limit);
}

function latestSeriesStats(relPath, label, scale = 1) {
  const doc = readJson(relPath, {});
  const rows = Array.isArray(doc?.series) ? doc.series : [];
  const latest = rows[rows.length - 1] ?? null;
  const prev7 = rows[Math.max(0, rows.length - 8)] ?? null;
  const prev30 = rows[Math.max(0, rows.length - 31)] ?? null;
  const value = finite(latest?.val) ? latest.val / scale : null;
  return {
    id: path.basename(relPath, ".json"),
    label,
    updated: doc?.updated ?? null,
    date: latest?.date ?? null,
    value,
    delta7d: value !== null && finite(prev7?.val) ? round(value - prev7.val / scale, 4) : null,
    delta30d: value !== null && finite(prev30?.val) ? round(value - prev30.val / scale, 4) : null,
    points: rows.length,
    trend: sampleSeries(rows.slice(-420), (row) => (finite(row?.val) ? row.val / scale : null), 42),
  };
}

function buildSentimentComponentSummary() {
  const rows = readJson("sentiment/cnn-components.json", []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { latestDate: null, points: 0, components: [] };
  }
  const latest = rows[rows.length - 1];
  const previous = rows[Math.max(0, rows.length - 8)];
  const keys = Object.keys(latest).filter((key) => key !== "date");
  return {
    latestDate: latest.date ?? null,
    points: rows.length,
    components: keys.map((key) => {
      const value = num(latest[key]);
      const prior = num(previous?.[key]);
      return {
        id: key,
        value,
        delta7d: value !== null && prior !== null ? round(value - prior, 2) : null,
        trend: sampleSeries(rows.slice(-90), (row) => num(row?.[key]), 30),
      };
    }),
  };
}

function buildAaiiSummary() {
  const rows = readJson("sentiment/aaii.json", []);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { latestDate: null, points: 0, bullish: null, neutral: null, bearish: null, spread: null, trend: [] };
  }
  const latest = rows[rows.length - 1] ?? {};
  const bullish = num(latest.bullish);
  const neutral = num(latest.neutral);
  const bearish = num(latest.bearish);
  const spread = bullish !== null && bearish !== null ? round(bullish - bearish, 2) : null;
  return {
    latestDate: latest.date ?? null,
    points: rows.length,
    bullish,
    neutral,
    bearish,
    spread,
    trend: sampleSeries(rows.slice(-260), (row) => {
      const bull = num(row?.bullish);
      const bear = num(row?.bearish);
      return bull !== null && bear !== null ? bull - bear : null;
    }, 52),
  };
}

function buildCreditRatingsSummary() {
  const doc = readJson("damodaran/credit_ratings.json", {});
  const tables = doc?.lookup_tables && typeof doc.lookup_tables === "object" ? doc.lookup_tables : {};
  return {
    sourceDate: doc?.metadata?.source_date ?? null,
    generatedAt: doc?.metadata?.generated_at ?? null,
    tableCount: Object.keys(tables).length,
    tables: Object.entries(tables).map(([id, rows]) => {
      const arr = Array.isArray(rows) ? rows : [];
      return {
        id,
        rows: arr.length,
        bestRating: arr[0]?.rating ?? null,
        worstRating: arr[arr.length - 1]?.rating ?? null,
        medianSpread: num(arr[Math.floor(arr.length / 2)]?.spread),
      };
    }),
  };
}

function componentAsOfFromSignals() {
  const doc = readJson("computed/signals.json", {});
  const signals = doc?.signals && typeof doc.signals === "object" ? doc.signals : {};
  return Object.entries(signals)
    .map(([id, value]) => ({
      id,
      asOf: typeof value?.as_of === "string" ? value.as_of : doc?.as_of ?? null,
      status: value?.overallStatus ?? null,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildBenchmarkMatrix(summaries) {
  const ids = [
    ["sp500", "S&P 500"],
    ["nasdaq100", "Nasdaq 100"],
    ["russell2000", "Russell 2000"],
    ["financials", "Financials"],
    ["information_technology", "Technology"],
    ["energy", "Energy"],
    ["south_korea", "Korea"],
    ["japan", "Japan"],
    ["china", "China"],
  ];
  return ids
    .map(([id, label]) => {
      const m = summaries?.source_summaries?.[id]?.momentum;
      if (!m) return null;
      return {
        id,
        label,
        price: m.px_last ?? null,
        eps: m.best_eps ?? null,
        pe: m.best_pe_ratio ?? null,
        pb: m.px_to_book_ratio ?? null,
        roe: m.roe ?? null,
      };
    })
    .filter(Boolean);
}

function buildMarketStructureIndex() {
  const membership = readJson("slickcharts/membership-changes.json", {});
  const magnificent7 = readJson("slickcharts/magnificent7.json", {});
  const sp500MarketCap = readJson("slickcharts/sp500-marketcap.json", {});
  const summaries = readJson("benchmarks/summaries.json", {});
  const changes = (Array.isArray(membership?.changes) ? membership.changes : [])
    .filter((row) => num(row.previousCount) !== 0)
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 12)
    .map((row) => ({
      date: row.date ?? null,
      index: row.index ?? null,
      added: Array.isArray(row.added) ? row.added : [],
      removed: Array.isArray(row.removed) ? row.removed : [],
      previousCount: num(row.previousCount),
      currentCount: num(row.currentCount),
    }));
  const magHoldings = Array.isArray(magnificent7?.holdings) ? magnificent7.holdings : [];
  const mag7IndexWeight = finite(magnificent7?.indexWeight)
    ? magnificent7.indexWeight
    : finite(magnificent7?.totalMarketCap) && finite(sp500MarketCap?.totalMarketCap) && sp500MarketCap.totalMarketCap > 0
      ? round((magnificent7.totalMarketCap / sp500MarketCap.totalMarketCap) * 100, 1)
      : null;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    source_files: MARKET_STRUCTURE_SOURCES,
    membershipChanges: {
      updated: membership?.updated ?? null,
      recent: changes,
    },
    magnificent7: {
      updated: magnificent7?.updated ?? null,
      totalMarketCap: num(magnificent7?.totalMarketCap),
      indexWeight: mag7IndexWeight,
      totalWeight: round(magHoldings.reduce((sum, row) => sum + (finite(row.weight) ? row.weight : 0), 0), 2),
      holdings: magHoldings.map((row) => ({
        rank: num(row.rank),
        symbol: row.symbol ?? null,
        company: row.company ?? null,
        weight: num(row.weight),
        changePercent: num(row.changePercent),
      })),
    },
    concentration: [
      analysisConcentration("slickcharts/sp500-analysis.json", "S&P 500"),
      analysisConcentration("slickcharts/nasdaq100-analysis.json", "Nasdaq 100"),
      analysisConcentration("slickcharts/dowjones-analysis.json", "Dow Jones"),
    ],
    benchmarkMatrix: {
      generated: summaries?.metadata?.generated ?? null,
      rows: buildBenchmarkMatrix(summaries),
    },
    liquidity: [
      latestSeriesStats("macro/tga.json", "Treasury General Account", 1000),
      latestSeriesStats("macro/stablecoins.json", "Stablecoin supply", 1_000_000_000),
    ],
    sentimentComponents: buildSentimentComponentSummary(),
    aaii: buildAaiiSummary(),
    creditRatings: buildCreditRatingsSummary(),
    component_as_of: componentAsOfFromSignals(),
  };
}

function buildUsageManifest() {
  const rootFiles = collectJsonFiles(dataRoot);
  const publicFiles = collectJsonFiles(publicDataRoot);
  const rootSet = new Set(rootFiles);
  const publicSet = new Set(publicFiles);
  const usedPaths = scanUsedDataPaths();
  const directUsedSet = new Set(usedPaths.map((item) => item.dataPath));
  const generatedSourceSet = new Set([...STOCK_ACTION_SOURCES, ...MARKET_STRUCTURE_SOURCES]);
  const categories = Array.from(new Set([...rootFiles.map(categoryOf), ...Object.keys(CATEGORY_USAGE)])).sort();
  const mirrored = rootFiles.filter((file) => publicSet.has(file));
  const missingPublic = rootFiles.filter((file) => !publicSet.has(file));
  const publicOnly = publicFiles.filter((file) => !rootSet.has(file));

  const categoryRows = categories.map((category) => {
    const rootCount = rootFiles.filter((file) => categoryOf(file) === category).length;
    const publicCount = publicFiles.filter((file) => categoryOf(file) === category).length;
    const directFetchCount = usedPaths.filter((item) => item.category === category).length;
    const generatedSourceCount = Array.from(generatedSourceSet).filter((file) => categoryOf(file) === category).length;
    const dynamicPatternCount = DYNAMIC_PATTERNS.filter((item) => item.category === category).length;
    const status = directFetchCount > 0 || generatedSourceCount > 0 || dynamicPatternCount > 0 ? "active" : "catalog_only";
    return {
      category,
      rootJsonCount: rootCount,
      publicJsonCount: publicCount,
      directFetchCount,
      dynamicPatternCount,
      generatedSourceCount,
      status,
      usage: CATEGORY_USAGE[category] ?? "manifest/catalog coverage",
    };
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    totals: {
      rootJsonCount: rootFiles.length,
      publicJsonCount: publicFiles.length,
      mirroredRootJsonCount: mirrored.length,
      missingPublicMirrorCount: missingPublic.length,
      publicOnlyJsonCount: publicOnly.length,
      directDataFetchCount: usedPaths.length,
      dynamicPatternCount: DYNAMIC_PATTERNS.length,
    },
    mirror_sync_status: missingPublic.length === 0 ? "ok" : "partial",
    generatedIndexes: GENERATED_OUTPUTS.map((output) => ({
      path: output,
      mirrored: output === "admin/data-usage-manifest.json" ? true : rootSet.has(output) && publicSet.has(output),
      sourceFiles: output.includes("stock_action")
        ? STOCK_ACTION_SOURCES
        : output.includes("market_structure")
          ? MARKET_STRUCTURE_SOURCES
          : [...STOCK_ACTION_SOURCES, ...MARKET_STRUCTURE_SOURCES],
    })),
    categories: categoryRows,
    directFetches: usedPaths,
    dynamicPatterns: DYNAMIC_PATTERNS,
    component_as_of: {
      computed_signals: componentAsOfFromSignals(),
    },
    mirrorGaps: {
      missingPublic: missingPublic.slice(0, 50),
      publicOnly: publicOnly.slice(0, 50),
    },
  };
}

function main() {
  const stockActionIndex = buildStockActionIndex();
  writeJsonToBoth("computed/stock_action_index.json", stockActionIndex);

  const stockActionSummary = buildStockActionSummary(stockActionIndex);
  writeJsonToBoth("computed/stock_action_summary.json", stockActionSummary, { compact: true });

  const marketStructureIndex = buildMarketStructureIndex();
  writeJsonToBoth("computed/market_structure_index.json", marketStructureIndex);

  const usageManifest = buildUsageManifest();
  writeJsonToBoth("admin/data-usage-manifest.json", usageManifest);

  console.log(JSON.stringify({
    generated_at: stockActionIndex.generated_at,
    stock_action_rows: stockActionIndex.rows.length,
    stock_action_summary_bytes: Buffer.byteLength(`${JSON.stringify(stockActionSummary)}\n`, "utf8"),
    market_structure_sources: marketStructureIndex.source_files.length,
    usage_root_json: usageManifest.totals.rootJsonCount,
    usage_direct_fetches: usageManifest.totals.directDataFetchCount,
  }, null, 2));
}

main();
