import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { QUADRANT_LABEL, rotationPoints } from "../src/lib/sectors/rotation";
import type { SectorRow } from "../src/lib/sectors/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const SECTOR_DEFINITIONS = [
  { key: "information_technology", etf: "XLK", name: "정보기술" },
  { key: "financials", etf: "XLF", name: "금융" },
  { key: "health_care", etf: "XLV", name: "헬스케어" },
  { key: "energy", etf: "XLE", name: "에너지" },
  { key: "industrials", etf: "XLI", name: "산업재" },
  { key: "communication_services", etf: "XLC", name: "커뮤니케이션" },
  { key: "consumer_discretionary", etf: "XLY", name: "자유소비재" },
  { key: "consumer_staples", etf: "XLP", name: "필수소비재" },
  { key: "real_estate", etf: "XLRE", name: "부동산" },
  { key: "materials", etf: "XLB", name: "소재" },
  { key: "utilities", etf: "XLU", name: "유틸리티" },
];

function findJsonFile(candidateRelPaths: string[]): any | null {
  for (const rel of candidateRelPaths) {
    const full = path.resolve(ROOT_DIR, rel);
    if (fs.existsSync(full)) {
      try {
        const raw = fs.readFileSync(full, "utf8");
        return JSON.parse(raw);
      } catch {
        continue;
      }
    }
  }
  return null;
}

interface SparklineStats {
  symbol: string;
  ticker: string;
  price: number;
  changePercent: number;
  sparkline: number[];
  asOf: string;
}

function extractSparklineAndStats(
  yfJson: any,
  symbol: string,
  ticker: string,
  sliceCount = 21,
): SparklineStats | null {
  if (!yfJson || !yfJson.data) return null;
  const history = yfJson.data.history_1y;
  if (!Array.isArray(history) || history.length === 0) return null;

  const points = history
    .filter((row: any) => typeof row.date === "string" && typeof row.Close === "number" && Number.isFinite(row.Close))
    .slice(-sliceCount);

  if (points.length === 0) return null;
  const sparkline = points.map((p: any) => Math.round(p.Close * 100) / 100);
  const info = yfJson.data.info || {};
  const fast = yfJson.data.fast_info || {};

  const currentPrice = info.regularMarketPrice ?? fast.lastPrice ?? sparkline[sparkline.length - 1];
  const prevPrice = info.previousClose ?? fast.previousClose ?? (sparkline.length > 1 ? sparkline[sparkline.length - 2] : null);

  if (typeof currentPrice !== "number" || !Number.isFinite(currentPrice)) return null;

  const changePercent = info.regularMarketChangePercent ?? (prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : null);
  if (changePercent === null || !Number.isFinite(changePercent)) return null;

  const asOf = yfJson.history_as_of || yfJson.fetched_at?.slice(0, 10) || points[points.length - 1].date?.slice(0, 10) || null;
  if (!asOf || typeof asOf !== "string") return null;

  return {
    symbol,
    ticker,
    price: Math.round(currentPrice * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    sparkline,
    asOf,
  };
}

const PE_BAND_WINDOW_YEARS = 5;

function fiveYearCutoff(latestDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(latestDate.trim());
  if (!match) return "0000-00-00";
  const [, year, month, day] = match;
  return `${String(Number(year) - PE_BAND_WINDOW_YEARS).padStart(4, "0")}-${month}-${day}`;
}

function buildPeBand(points: any[] | undefined, latest: number | null) {
  if (latest === null || !Array.isArray(points)) return null;
  const dated = points
    .map((point) => ({
      date: typeof point.date === "string" ? point.date.trim() : null,
      value: typeof point.best_pe_ratio === "number" ? point.best_pe_ratio : null,
    }))
    .filter((entry): entry is { date: string; value: number } => entry.date !== null && entry.value !== null && entry.value > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (dated.length < 2) return null;
  const cutoff = fiveYearCutoff(dated[dated.length - 1].date);
  const windowed = dated.filter((entry) => entry.date >= cutoff);
  if (windowed.length < 2) return null;
  const values = windowed.map((entry) => entry.value);
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return null;
  const belowOrEqual = sorted.filter((value) => value <= latest).length;
  return {
    min,
    max,
    percentile: Math.min(1, Math.max(0, (belowOrEqual - 1) / (sorted.length - 1))),
  };
}

export function buildIntroFeed() {
  const sourceDates: string[] = [];

  // 1. S&P 500 (SPY): last 63 closes (~3 months sparkline per feed shape addendum)
  const spyJson = findJsonFile([
    "public/data/yf/finance/SPY.json",
    "../data/admin/yahoo-batch-quote-history/lkg/SPY.json",
  ]);
  const spyStats = extractSparklineAndStats(spyJson, "S&P 500", "SPY", 63);
  if (spyStats?.asOf) sourceDates.push(spyStats.asOf);

  // 2. NASDAQ (QQQ): last 63 closes (~3 months sparkline per feed shape addendum)
  const qqqJson = findJsonFile([
    "public/data/yf/finance/QQQ.json",
    "../data/admin/yahoo-batch-quote-history/lkg/QQQ.json",
  ]);
  const qqqStats = extractSparklineAndStats(qqqJson, "NASDAQ", "QQQ", 63);
  if (qqqStats?.asOf) sourceDates.push(qqqStats.asOf);

  // 3. KOSPI from KRX index dataset (per-index asOf included)
  let kospiStats: SparklineStats | null = null;
  const krxJson = findJsonFile([
    "public/data/computed/fenok-edge-korea-krx-index-daily.json",
    "../data/computed/fenok-edge-korea-krx-index-daily.json",
  ]);
  if (krxJson && Array.isArray(krxJson.indices)) {
    const kospiRows = krxJson.indices
      .filter((r: any) => r.index_name === "코스피" && typeof r.close === "number" && Number.isFinite(r.close))
      .sort((a: any, b: any) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      .slice(-21);
    if (kospiRows.length > 0) {
      const last = kospiRows[kospiRows.length - 1];
      const asOf = last.date || krxJson.as_of || null;
      if (asOf) sourceDates.push(asOf);
      kospiStats = {
        symbol: "KOSPI",
        ticker: "KOSPI",
        price: Math.round(last.close * 100) / 100,
        changePercent: typeof last.change_pct === "number" ? Math.round(last.change_pct * 100) / 100 : 0,
        sparkline: kospiRows.map((r: any) => Math.round(r.close * 100) / 100),
        asOf: asOf ?? "",
      };
    }
  }

  // 4. 11 Sector Breadth Bars (last 21 trading days)
  const breadthSectors: Array<{ symbol: string; name: string; changePercent: number; isUp: boolean }> = [];
  let breadthMissing = 0;

  for (const sec of SECTOR_DEFINITIONS) {
    const secJson = findJsonFile([
      `public/data/yf/finance/${sec.etf}.json`,
      `../data/admin/yahoo-batch-quote-history/lkg/${sec.etf}.json`,
    ]);
    const secStats = extractSparklineAndStats(secJson, sec.name, sec.etf, 21);
    if (!secStats) {
      breadthMissing += 1;
      continue;
    }
    if (secStats.asOf) sourceDates.push(secStats.asOf);
    breadthSectors.push({
      symbol: sec.etf,
      name: sec.name,
      changePercent: secStats.changePercent,
      isUp: secStats.changePercent >= 0,
    });
  }

  const upCount = breadthSectors.filter((s) => s.isUp).length;
  const downCount = breadthSectors.length - upCount;
  const ratio = breadthSectors.length > 0 ? Math.round((upCount / breadthSectors.length) * 100) / 100 : 0;

  // 5. Rotation computed from benchmarks & us_sectors & etfs index
  // If us_sectors.json or summaries.json is absent at build, emit rotation: null and log it
  const usSectors = findJsonFile([
    "public/data/benchmarks/us_sectors.json",
    "../data/benchmarks/us_sectors.json",
  ]);
  const summaries = findJsonFile([
    "public/data/benchmarks/summaries.json",
    "../data/benchmarks/summaries.json",
  ]);
  const etfs = findJsonFile([
    "public/data/global-scouter/etfs/index.json",
    "../data/global-scouter/etfs/index.json",
  ]);

  let rotationPayload: any = null;

  if (!usSectors || !summaries) {
    console.warn("[intro-feed] us_sectors or summaries absent at build time -> emitting rotation: null");
  } else {
    if (usSectors?.metadata?.version) sourceDates.push(usSectors.metadata.version);
    if (summaries?.metadata?.version) sourceDates.push(summaries.metadata.version);

    const rows: SectorRow[] = SECTOR_DEFINITIONS.map((sector) => {
      const valData = usSectors?.sections?.[sector.key]?.data;
      const valLatest = Array.isArray(valData) && valData.length > 0 ? valData[valData.length - 1] : null;
      const pe = typeof valLatest?.best_pe_ratio === "number" ? valLatest.best_pe_ratio : null;
      const peBand = buildPeBand(valData, pe);

      const rawMomentum = summaries?.momentum?.[sector.key];
      const momentum = {
        "1w": typeof rawMomentum?.["1w"] === "number" ? rawMomentum["1w"] : null,
        "1m": typeof rawMomentum?.["1m"] === "number" ? rawMomentum["1m"] : null,
        "3m": typeof rawMomentum?.["3m"] === "number" ? rawMomentum["3m"] : null,
      };

      const etf = etfs?.etfs?.[sector.etf];
      const etfInfo = etf
        ? {
            ticker: sector.etf,
            category: etf.category ?? null,
            marketCap: typeof etf.market_cap === "number" ? etf.market_cap : null,
            returns: etf.returns ?? {},
            cagr: etf.cagr ?? {},
            beta: typeof etf.beta === "number" ? etf.beta : null,
            expenseRatio: typeof etf.expense_ratio === "number" ? etf.expense_ratio : null,
          }
        : null;

      return {
        key: sector.key,
        etf: sector.etf,
        name: sector.name,
        momentum,
        dayChange: null,
        price: null,
        marketState: null,
        etfInfo,
        valuation: valLatest ? { pe, pb: valLatest.px_to_book_ratio ?? null, roe: valLatest.roe ?? null, peBand } : null,
        smartMoney: null,
      };
    });

    const benchmarkMomentum = summaries?.momentum?.sp500?.["1m"] ?? null;
    const pts = rotationPoints(rows, "1m", benchmarkMomentum);
    const rotationMissing = SECTOR_DEFINITIONS.length - pts.length;

    // rotation entries = rotation.ts RotationPoint fields verbatim
    // (symbol, name, relative, bandPct, quadrant id) plus the window key used
    const rotationSectors = pts.map((p) => ({
      symbol: p.row.etf,
      name: p.row.name,
      relative: Math.round(p.relative * 100) / 100,
      bandPct: p.band !== null ? Math.round(p.band * 10) / 10 : null,
      quadrant: p.quadrant,
      quadrantLabel: p.quadrant ? QUADRANT_LABEL[p.quadrant] : null,
      window: "1m",
    }));

    rotationPayload = {
      window: "1m",
      windowLabel: "1개월",
      missing: rotationMissing,
      sectors: rotationSectors,
    };
  }

  const latestAsOf = sourceDates.length > 0 ? [...sourceDates].sort().reverse()[0] : null;

  const payload = {
    schema_version: "intro-feed/v2",
    asOf: latestAsOf,
    indices: {
      sp500: spyStats,
      nasdaq: qqqStats,
      kospi: kospiStats,
    },
    breadth: {
      total: SECTOR_DEFINITIONS.length,
      missing: breadthMissing,
      upCount,
      downCount,
      ratio,
      sectors: breadthSectors,
    },
    rotation: rotationPayload,
  };

  const outDir = path.join(ROOT_DIR, "public/data/computed");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "intro-feed.json");
  fs.writeFileSync(outPath, JSON.stringify(payload));
  const bytes = fs.statSync(outPath).size;

  // Builder's printed summary: (sectors count, rotation present/absent, asOf)
  console.log(`[intro-feed] sectors=${breadthSectors.length} rotation=${rotationPayload ? "present" : "absent"} asOf=${latestAsOf}`);

  return { payload, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildIntroFeed();
}
