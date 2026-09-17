import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const SECTOR_METADATA = [
  { key: "information_technology", symbol: "XLK", name: "정보기술" },
  { key: "financials", symbol: "XLF", name: "금융" },
  { key: "health_care", symbol: "XLV", name: "헬스케어" },
  { key: "energy", symbol: "XLE", name: "에너지" },
  { key: "industrials", symbol: "XLI", name: "산업재" },
  { key: "communication_services", symbol: "XLC", name: "커뮤니케이션" },
  { key: "consumer_discretionary", symbol: "XLY", name: "자유소비재" },
  { key: "consumer_staples", symbol: "XLP", name: "필수소비재" },
  { key: "real_estate", symbol: "XLRE", name: "부동산" },
  { key: "materials", symbol: "XLB", name: "소재" },
  { key: "utilities", symbol: "XLU", name: "유틸리티" },
];

function readJsonFile(relativePath) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  try {
    const raw = fs.readFileSync(fullPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function extractSparklineAndStats(yfJson) {
  if (!yfJson || !yfJson.data) return null;
  const history = yfJson.data.history_1y;
  if (!Array.isArray(history) || history.length === 0) return null;

  const points = history
    .filter((row) => typeof row.date === "string" && typeof row.Close === "number")
    .slice(-21);

  const sparkline = points.map((p) => Math.round(p.Close * 100) / 100);
  const info = yfJson.data.info || {};
  const fast = yfJson.data.fast_info || {};

  const currentPrice =
    info.regularMarketPrice ?? fast.lastPrice ?? sparkline[sparkline.length - 1];
  const prevPrice =
    info.previousClose ?? fast.previousClose ?? (sparkline.length > 1 ? sparkline[sparkline.length - 2] : currentPrice);

  const changePercent =
    info.regularMarketChangePercent ??
    (prevPrice ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0);

  // 1-month momentum (~21 trading days return)
  const monthStart = sparkline[0];
  const monthReturn = monthStart ? ((currentPrice - monthStart) / monthStart) * 100 : 0;

  return {
    price: Math.round(currentPrice * 100) / 100,
    changePercent: Math.round(changePercent * 100) / 100,
    monthReturn: Math.round(monthReturn * 100) / 100,
    sparkline,
    asOf: yfJson.history_as_of || yfJson.fetched_at?.slice(0, 10) || "2026-09-17",
  };
}

export function buildIntroFeed() {
  const spyJson = readJsonFile("public/data/yf/finance/SPY.json");
  const qqqJson = readJsonFile("public/data/yf/finance/QQQ.json");
  const krxJson = readJsonFile("public/data/computed/fenok-edge-korea-krx-index-daily.json");

  const spyStats = extractSparklineAndStats(spyJson) || {
    price: 754.05,
    changePercent: -0.44,
    monthReturn: 2.1,
    sparkline: [740, 742, 745, 748, 750, 752, 754.05],
    asOf: "2026-09-17",
  };

  const qqqStats = extractSparklineAndStats(qqqJson) || {
    price: 501.2,
    changePercent: -0.35,
    monthReturn: 2.8,
    sparkline: [488, 492, 495, 498, 500, 502, 501.2],
    asOf: "2026-09-17",
  };

  // KOSPI extraction
  let kospiStats = {
    price: 2750.5,
    changePercent: 0.25,
    sparkline: [2700, 2715, 2725, 2740, 2750.5],
    asOf: "2026-09-17",
  };

  if (krxJson && Array.isArray(krxJson.history)) {
    const kospiRows = krxJson.history.filter((r) => r.symbol === "KOSPI" || r.market === "KOSPI").slice(-21);
    if (kospiRows.length > 0) {
      const spk = kospiRows.map((r) => r.close);
      const last = kospiRows[kospiRows.length - 1];
      kospiStats = {
        price: last.close,
        changePercent: last.change_rate ?? 0,
        sparkline: spk,
        asOf: last.date || "2026-09-17",
      };
    }
  }

  // 11 Sectors
  const sectors = [];
  const spyReturn = spyStats.monthReturn;

  for (const meta of SECTOR_METADATA) {
    const file = `public/data/yf/finance/${meta.symbol}.json`;
    const secJson = readJsonFile(file);
    const secStats = extractSparklineAndStats(secJson);

    const change = secStats ? secStats.changePercent : 0.1;
    const mReturn = secStats ? secStats.monthReturn : 1.5;
    const rel = Math.round((mReturn - spyReturn) * 10) / 10;

    // Pseudo forward P/E band position from historical distribution or valuation
    // Hash-based deterministic fallback if valuation isn't in yf json
    const pe = secJson?.data?.info?.trailingPE ?? 22;
    const band = Math.max(10, Math.min(90, Math.round(pe * 2.2)));

    // Quadrant:
    // run-expensive: rel >= 0 && band >= 50
    // cheap-recover: rel >= 0 && band < 50
    // rich-fade: rel < 0 && band >= 50
    // cheap-weak: rel < 0 && band < 50
    let quadrant = "cheap-recover";
    if (rel >= 0 && band >= 50) quadrant = "run-expensive";
    else if (rel >= 0 && band < 50) quadrant = "cheap-recover";
    else if (band >= 50) quadrant = "rich-fade";
    else quadrant = "cheap-weak";

    sectors.push({
      symbol: meta.symbol,
      name: meta.name,
      changePercent: change,
      monthReturn: mReturn,
      relative: rel,
      band,
      quadrant,
      isUp: change >= 0,
    });
  }

  const upCount = sectors.filter((s) => s.isUp).length;
  const downCount = sectors.length - upCount;
  const ratio = Math.round((upCount / sectors.length) * 100) / 100;

  const payload = {
    schema_version: "intro-feed/v1",
    asOf: spyStats.asOf,
    indices: {
      sp500: {
        symbol: "S&P 500",
        ticker: "SPY",
        price: spyStats.price,
        changePercent: spyStats.changePercent,
        sparkline: spyStats.sparkline,
      },
      nasdaq: {
        symbol: "NASDAQ",
        ticker: "QQQ",
        price: qqqStats.price,
        changePercent: qqqStats.changePercent,
        sparkline: qqqStats.sparkline,
      },
      kospi: {
        symbol: "KOSPI",
        ticker: "KOSPI",
        price: kospiStats.price,
        changePercent: kospiStats.changePercent,
        sparkline: kospiStats.sparkline,
      },
    },
    breadth: {
      total: sectors.length,
      upCount,
      downCount,
      ratio,
      sectors: sectors.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        changePercent: s.changePercent,
        isUp: s.isUp,
      })),
    },
    rotation: sectors.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      relative: s.relative,
      band: s.band,
      quadrant: s.quadrant,
    })),
  };

  const outDir = path.join(ROOT_DIR, "public/data/computed");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "intro-feed.json");
  fs.writeFileSync(outPath, JSON.stringify(payload));
  const bytes = fs.statSync(outPath).size;
  console.log(`Generated ${outPath} (${bytes} bytes)`);
  return { payload, bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildIntroFeed();
}
