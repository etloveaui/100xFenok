#!/usr/bin/env node
/**
 * Build script: 13F portfolio visualization views.
 *
 * Per investor: quarterly sector-weight history (stacked bar / pie source)
 * and latest-quarter treemap rows (weight × sector × 3m-return proxy).
 * Plus a cohort-aggregated "total" treemap for the latest global quarter.
 *
 * Run: node scripts/build-13f-portfolio-views.mjs
 * Output: data/sec-13f/analytics/portfolio_views.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INVESTORS_DIR = path.join(ROOT, "data/sec-13f/investors");
const OUTPUT = path.join(ROOT, "data/sec-13f/analytics/portfolio_views.json");
const PUBLIC_MIRROR_DIR = path.join(
  ROOT,
  "100xfenok-next/public/data/sec-13f/analytics",
);
const SECTOR_MAP_PATH = path.join(
  ROOT,
  "100xfenok-next/src/lib/design/sector-map.json",
);
const STOCKS_ANALYZER_PATH = path.join(
  ROOT,
  "data/global-scouter/core/stocks_analyzer.json",
);

const TREEMAP_TOP_N = 50;
const TOTAL_TREEMAP_TOP_N = 100;

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function writeBoth(rootPath, data) {
  writeJson(rootPath, data);
  writeJson(path.join(PUBLIC_MIRROR_DIR, path.basename(rootPath)), data);
}

const round4 = (x) => Math.round(x * 10000) / 10000;

/* ── sector + return-proxy joins ── */
const sectorMap = loadJson(SECTOR_MAP_PATH);
const gicsToCanonical = sectorMap.gicsToCanonical ?? {};
const scouterToCanonical = sectorMap.scouterToCanonical ?? {};
const CANONICAL = sectorMap.canonical;

const scouterByTicker = new Map();
for (const row of loadJson(STOCKS_ANALYZER_PATH).data ?? []) {
  if (!row.symbol) continue;
  scouterByTicker.set(row.symbol, {
    sector: row.sector ?? null,
    m3: typeof row.momentum3m === "number" ? row.momentum3m : null,
  });
}

const ETF_NAME_PATTERN =
  /\b(ETF|ISHARES|SPDR|VANGUARD INDEX|INVESCO QQQ|WISDOMTREE|TRUST SERIES)\b/i;

function resolveCanonical(gicsRaw, ticker, name) {
  if (name && ETF_NAME_PATTERN.test(name)) return "Other";
  if (gicsRaw) {
    const c = gicsToCanonical[String(gicsRaw).trim()];
    if (c) return c;
  }
  const scouter = scouterByTicker.get(ticker);
  if (scouter?.sector) {
    const c = scouterToCanonical[String(scouter.sector).trim()];
    if (c) return c;
  }
  return "Other";
}

function returnProxy(ticker) {
  const m3 = scouterByTicker.get(ticker)?.m3;
  return typeof m3 === "number" ? round4(m3) : null;
}

/* ── aggregate one filing by ticker ── */
function aggByTicker(filing) {
  const map = new Map();
  for (const h of filing.holdings ?? []) {
    const ticker = h.ticker?.trim();
    if (!ticker || !(h.market_value > 0)) continue;
    const cur = map.get(ticker) ?? { value: 0, name: h.name, gics: null };
    cur.value += h.market_value;
    if (!cur.gics && h.sector) cur.gics = h.sector;
    map.set(ticker, cur);
  }
  return map;
}

function sectorWeights(agg) {
  const total = [...agg.values()].reduce((s, h) => s + h.value, 0);
  const bySector = Object.fromEntries(CANONICAL.map((c) => [c, 0]));
  if (total <= 0) return bySector;
  for (const [ticker, h] of agg) {
    bySector[resolveCanonical(h.gics, ticker, h.name)] += h.value / total;
  }
  for (const c of CANONICAL) bySector[c] = round4(bySector[c]);
  return bySector;
}

function treemapRows(agg, topN) {
  const total = [...agg.values()].reduce((s, h) => s + h.value, 0);
  if (total <= 0) return [];
  const rows = [...agg.entries()]
    .map(([ticker, h]) => ({
      ticker,
      name: h.name,
      sector: resolveCanonical(h.gics, ticker, h.name),
      weight: round4(h.value / total),
      value: Math.round(h.value),
      ret: returnProxy(ticker),
    }))
    .sort((a, b) => b.weight - a.weight);
  const top = rows.slice(0, topN);
  const rest = rows.slice(topN);
  if (rest.length > 0) {
    top.push({
      ticker: "_OTHERS",
      name: `기타 ${rest.length}종목`,
      sector: "Other",
      weight: round4(rest.reduce((s, r) => s + r.weight, 0)),
      value: rest.reduce((s, r) => s + r.value, 0),
      ret: null,
    });
  }
  return top;
}

/* ── per investor ── */
const investorFiles = fs
  .readdirSync(INVESTORS_DIR)
  .filter((f) => f.endsWith(".json"));

const investors = {};
const latestAggs = [];
let globalQuarter = null;

for (const file of investorFiles) {
  const id = path.basename(file, ".json");
  const { investor } = loadJson(path.join(INVESTORS_DIR, file));
  const filings = investor.filings ?? [];
  if (!filings.length) continue;

  const quarters = filings.map((f) => f.quarter);
  const history = Object.fromEntries(CANONICAL.map((c) => [c, []]));
  for (const filing of filings) {
    const weights = sectorWeights(aggByTicker(filing));
    for (const c of CANONICAL) history[c].push(weights[c]);
  }

  const latest = filings.at(-1);
  const latestAgg = aggByTicker(latest);
  investors[id] = {
    name: investor.name,
    quarter: latest.quarter,
    quarters,
    sector_history: history,
    treemap: treemapRows(latestAgg, TREEMAP_TOP_N),
  };

  if (!globalQuarter || latest.quarter > globalQuarter) {
    globalQuarter = latest.quarter;
  }
  latestAggs.push({ quarter: latest.quarter, agg: latestAgg });
}

/* ── cohort total (latest global quarter only) ── */
const totalAgg = new Map();
let cohortCount = 0;
for (const { quarter, agg } of latestAggs) {
  if (quarter !== globalQuarter) continue;
  cohortCount += 1;
  for (const [ticker, h] of agg) {
    const cur = totalAgg.get(ticker) ?? { value: 0, name: h.name, gics: null };
    cur.value += h.value;
    if (!cur.gics && h.gics) cur.gics = h.gics;
    totalAgg.set(ticker, cur);
  }
}

/* ── cohort sector history (smart-money trend, last 12 global quarters) ── */
const quarterSet = new Set();
for (const file of investorFiles) {
  const { investor } = loadJson(path.join(INVESTORS_DIR, file));
  for (const f of investor.filings ?? []) quarterSet.add(f.quarter);
}
const historyQuarters = [...quarterSet].sort().slice(-12);
const cohortByQuarter = new Map(
  historyQuarters.map((q) => [q, Object.fromEntries(CANONICAL.map((c) => [c, 0]))]),
);
const cohortTotals = new Map(historyQuarters.map((q) => [q, 0]));
for (const file of investorFiles) {
  const { investor } = loadJson(path.join(INVESTORS_DIR, file));
  for (const filing of investor.filings ?? []) {
    if (!cohortByQuarter.has(filing.quarter)) continue;
    const agg = aggByTicker(filing);
    const bucket = cohortByQuarter.get(filing.quarter);
    for (const [ticker, h] of agg) {
      bucket[resolveCanonical(h.gics, ticker, h.name)] += h.value;
      cohortTotals.set(filing.quarter, cohortTotals.get(filing.quarter) + h.value);
    }
  }
}
const totalSectorHistory = Object.fromEntries(
  CANONICAL.map((c) => [
    c,
    historyQuarters.map((q) => {
      const t = cohortTotals.get(q);
      return t > 0 ? round4(cohortByQuarter.get(q)[c] / t) : 0;
    }),
  ]),
);

const output = {
  metadata: {
    quarter: globalQuarter,
    cohort_count: cohortCount,
    return_proxy:
      "momentum3m from global-scouter (~3-month return, approximation of return since quarter end)",
    sector_chain: "filing GICS enrichment -> scouter join -> Other (ETF name guard)",
    generated_at: new Date().toISOString(),
    disclaimer:
      "Estimated from 13F quarter-end snapshots (45-day lag). Sector weights are value-based on reported long positions only.",
  },
  total: {
    treemap: treemapRows(totalAgg, TOTAL_TREEMAP_TOP_N),
    sectors: sectorWeights(totalAgg),
    sector_history: { quarters: historyQuarters, series: totalSectorHistory },
  },
  investors,
};

writeBoth(OUTPUT, output);

const size = fs.statSync(OUTPUT).size;
console.log(
  `portfolio_views: quarter=${globalQuarter} cohort=${cohortCount} investors=${Object.keys(investors).length} size=${(size / 1024).toFixed(0)}KB`,
);
console.log(`written: ${OUTPUT}`);
console.log(`mirror:  ${path.join(PUBLIC_MIRROR_DIR, path.basename(OUTPUT))}`);
