#!/usr/bin/env node
/**
 * Build a lightweight SlickCharts discovery summary for Explore/Screener UI.
 *
 * Inputs stay as rich source files under data/slickcharts. The browser should
 * not fetch multi-MB mover histories just to render first-screen leaderboards.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PATHS = {
  gainers: path.join(ROOT, "data/slickcharts/gainers.json"),
  losers: path.join(ROOT, "data/slickcharts/losers.json"),
  universe: path.join(ROOT, "data/slickcharts/universe.json"),
  analyzer: path.join(ROOT, "data/global-scouter/core/stocks_analyzer.json"),
  slickIndex: path.join(ROOT, "data/global-scouter/core/slick_index.json"),
  output: path.join(ROOT, "data/slickcharts/discovery-summary.json"),
  publicOutput: path.join(ROOT, "100xfenok-next/public/data/slickcharts/discovery-summary.json"),
};

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function datePart(value) {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : null;
}

function stockMaps(analyzer) {
  const rows = Array.isArray(analyzer?.data) ? analyzer.data : [];
  const map = new Map();
  for (const row of rows) {
    if (typeof row?.symbol !== "string" || row.symbol.trim() === "") continue;
    map.set(row.symbol.trim().toUpperCase(), row);
  }
  return map;
}

function withMeta(row, analyzerMap) {
  const symbol = typeof row?.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
  const meta = analyzerMap.get(symbol);
  return {
    symbol,
    company: row?.company ?? meta?.companyName ?? symbol,
    sector: meta?.sector ?? null,
    price: finite(row?.price ?? meta?.price),
    change: finite(row?.change),
    changePercent: finite(row?.changePercent),
    marketCap: finite(meta?.marketCap),
  };
}

function latestMoverSide(doc, key, analyzerMap) {
  const latest = Array.isArray(doc?.history) ? doc.history[0] : null;
  const rows = Array.isArray(latest?.[key]) ? latest[key] : [];
  return {
    date: latest?.date ?? null,
    count: finite(latest?.count) ?? rows.length,
    historyCount: Array.isArray(doc?.history) ? doc.history.length : 0,
    updated: doc?.updated ?? null,
    rows: rows.slice(0, 12).map((row) => ({
      rank: finite(row?.rank),
      ...withMeta(row, analyzerMap),
    })),
  };
}

function rankedFromSlickIndex({ slickIndex, analyzerMap, key, limit = 12, desc = true }) {
  const data = slickIndex?.data && typeof slickIndex.data === "object" ? slickIndex.data : {};
  return Object.entries(data)
    .map(([symbol, rec]) => {
      const meta = analyzerMap.get(symbol);
      const value = finite(rec?.[key]);
      return {
        symbol,
        company: meta?.companyName ?? symbol,
        sector: meta?.sector ?? null,
        value,
        price: finite(meta?.price),
        marketCap: finite(meta?.marketCap),
      };
    })
    .filter((row) => row.value !== null)
    .sort((a, b) => (desc ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0)))
    .slice(0, limit);
}

function rankedFromAnalyzer({ analyzerMap, key, limit = 12, desc = true }) {
  return [...analyzerMap.values()]
    .map((meta) => ({
      symbol: meta.symbol,
      company: meta.companyName ?? meta.symbol,
      sector: meta.sector ?? null,
      value: finite(meta?.[key]),
      price: finite(meta?.price),
      marketCap: finite(meta?.marketCap),
    }))
    .filter((row) => row.value !== null)
    .sort((a, b) => (desc ? (b.value ?? 0) - (a.value ?? 0) : (a.value ?? 0) - (b.value ?? 0)))
    .slice(0, limit);
}

function indexOverlap(universe, analyzerMap) {
  const stocks = Array.isArray(universe?.stocks) ? universe.stocks : [];
  return stocks
    .filter((row) => finite(row?.indexCount) && row.indexCount > 1)
    .map((row) => {
      const symbol = String(row.symbol ?? "").trim().toUpperCase();
      const meta = analyzerMap.get(symbol);
      return {
        symbol,
        company: meta?.companyName ?? symbol,
        sector: meta?.sector ?? null,
        indices: Array.isArray(row.indices) ? row.indices : [],
        indexCount: finite(row.indexCount),
      };
    })
    .sort((a, b) => (b.indexCount ?? 0) - (a.indexCount ?? 0) || a.symbol.localeCompare(b.symbol))
    .slice(0, 20);
}

function main() {
  const gainers = loadJson(PATHS.gainers);
  const losers = loadJson(PATHS.losers);
  const universe = loadJson(PATHS.universe);
  const analyzer = loadJson(PATHS.analyzer);
  const slickIndex = loadJson(PATHS.slickIndex);
  const analyzerMap = stockMaps(analyzer);

  const payload = {
    generated_at: new Date().toISOString(),
    source: "slickcharts",
    source_files: {
      gainers: { updated: gainers.updated ?? null, bytes: fs.statSync(PATHS.gainers).size },
      losers: { updated: losers.updated ?? null, bytes: fs.statSync(PATHS.losers).size },
      universe: { updated: universe.updated ?? null, uniqueCount: universe.uniqueCount ?? null },
      stocks_analyzer: {
        generated_at: analyzer.generated_at ?? null,
        source_date: analyzer.source_date ?? null,
        count: analyzer.count ?? null,
      },
      slick_index: { generated_at: slickIndex.generated_at ?? null, count: slickIndex.count ?? null },
    },
    movers: {
      gainers: latestMoverSide(gainers, "gainers", analyzerMap),
      losers: latestMoverSide(losers, "losers", analyzerMap),
    },
    returns: {
      asOf: datePart(slickIndex.generated_at),
      best1y: rankedFromSlickIndex({ slickIndex, analyzerMap, key: "ret1y" }),
      worst1y: rankedFromSlickIndex({ slickIndex, analyzerMap, key: "ret1y", desc: false }),
      best3y: rankedFromSlickIndex({ slickIndex, analyzerMap, key: "ret3y" }),
    },
    dividends: {
      asOf: analyzer.source_date ?? datePart(analyzer.generated_at),
      highYield: rankedFromAnalyzer({ analyzerMap, key: "dividendYield" }),
      highTtm: rankedFromSlickIndex({ slickIndex, analyzerMap, key: "dividendTtm" }),
    },
    universe: {
      uniqueCount: universe.uniqueCount ?? null,
      indexCounts: universe.indexCounts ?? null,
      overlap: indexOverlap(universe, analyzerMap),
    },
  };

  writeJson(PATHS.output, payload);
  writeJson(PATHS.publicOutput, payload);
  console.log(`[build-slickcharts-discovery] wrote ${PATHS.output}`);
  console.log(`[build-slickcharts-discovery] wrote ${PATHS.publicOutput}`);
}

try {
  main();
} catch (error) {
  console.error(`[build-slickcharts-discovery] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
