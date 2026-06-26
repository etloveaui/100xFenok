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
import {
  loadJsonGuarded,
  requireArray,
  requireKeys,
  requireObject,
} from "./lib/guarded-json.mjs";

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

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

function writeBoth(rootPath, data) {
  writeJson(rootPath, data);
  writeJson(path.join(PUBLIC_MIRROR_DIR, path.basename(rootPath)), data);
}

const round4 = (x) => Math.round(x * 10000) / 10000;

function guardSectorMap(data, filePath) {
  requireKeys(data, filePath, ["canonical", "gicsToCanonical", "scouterToCanonical"]);
  requireArray(data.canonical, filePath, "canonical");
  requireObject(data.gicsToCanonical, filePath, "gicsToCanonical");
  requireObject(data.scouterToCanonical, filePath, "scouterToCanonical");
}

function guardStocksAnalyzer(data, filePath) {
  requireKeys(data, filePath, ["data"]);
  requireArray(data.data, filePath, "data");
}

function guardQuarterCloses(data, filePath) {
  requireKeys(data, filePath, ["tickers"]);
  requireObject(data.tickers, filePath, "tickers");
}

function guardInvestorDoc(data, filePath) {
  requireKeys(data, filePath, ["investor"]);
  requireObject(data.investor, filePath, "investor");
  requireKeys(data.investor, filePath, ["filings"], "investor");
  requireArray(data.investor.filings, filePath, "investor.filings");
}

/* ── sector + return-proxy joins ── */
const sectorMap = loadJsonGuarded(SECTOR_MAP_PATH, guardSectorMap);
const gicsToCanonical = sectorMap.gicsToCanonical ?? {};
const scouterToCanonical = sectorMap.scouterToCanonical ?? {};
const CANONICAL = sectorMap.canonical;

const scouterByTicker = new Map();
for (const row of loadJsonGuarded(STOCKS_ANALYZER_PATH, guardStocksAnalyzer).data ?? []) {
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

/* ── quarter-end close snapshot (actual return since quarter end) ── */
const QUARTER_CLOSES_PATH = path.join(ROOT, "data/yf/quarter_closes.json");
const quarterCloses = fs.existsSync(QUARTER_CLOSES_PATH)
  ? loadJsonGuarded(QUARTER_CLOSES_PATH, guardQuarterCloses).tickers
  : {};

function closeAt(ticker, isoDate) {
  const v = quarterCloses[ticker]?.[isoDate];
  return typeof v === "number" ? v : null;
}

function latestClose(ticker) {
  const l = quarterCloses[ticker]?.latest;
  return typeof l?.close === "number" ? l.close : null;
}

/** Actual return since quarter end; falls back to 3m momentum proxy. */
function returnSinceQuarterEnd(ticker, reportDate) {
  const base = closeAt(ticker, reportDate);
  const now = latestClose(ticker);
  if (base && now) return round4(now / base - 1);
  return returnProxy(ticker);
}

/**
 * Quarterly portfolio performance vs SPY (buy-at-quarter-end assumption).
 * Each segment return = covered-weight-renormalized sum of holding returns.
 * Index starts at 100 on the first report date.
 */
function performanceSeries(filings) {
  const points = filings
    .filter((f) => f.report_date)
    .map((f) => ({ date: f.report_date, agg: aggByTicker(f) }));
  if (points.length < 2 && !(points.length === 1 && latestClose("SPY"))) {
    return null;
  }

  const dates = points.map((p) => p.date);
  const spyLatest = quarterCloses.SPY?.latest ?? null;
  if (spyLatest) dates.push(spyLatest.date);

  const portfolio = [100];
  const coverage = [];
  for (let i = 0; i < points.length; i += 1) {
    const isLast = i === points.length - 1;
    const fromDate = points[i].date;
    const agg = points[i].agg;
    const total = [...agg.values()].reduce((s, h) => s + h.value, 0);
    if (total <= 0) {
      portfolio.push(portfolio.at(-1));
      coverage.push(0);
      if (isLast && !spyLatest) break;
      continue;
    }
    let covered = 0;
    let weightedReturn = 0;
    for (const [ticker, h] of agg) {
      const base = closeAt(ticker, fromDate);
      const end = isLast
        ? latestClose(ticker)
        : closeAt(ticker, points[i + 1].date);
      if (!base || !end) continue;
      const w = h.value / total;
      covered += w;
      weightedReturn += w * (end / base - 1);
    }
    if (isLast && !spyLatest) break;
    const segReturn = covered > 0 ? weightedReturn / covered : 0;
    portfolio.push(round4(portfolio.at(-1) * (1 + segReturn)));
    coverage.push(round4(covered));
  }

  const spy = [];
  const spyBase = closeAt("SPY", dates[0]);
  if (spyBase) {
    for (const d of dates) {
      const c = d === spyLatest?.date ? spyLatest.close : closeAt("SPY", d);
      spy.push(c ? round4((c / spyBase) * 100) : null);
    }
  }

  if (portfolio.length !== dates.length) return null;
  return {
    dates,
    portfolio: portfolio.map(round4),
    spy: spy.length === dates.length ? spy : null,
    coverage,
  };
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

function treemapRows(agg, topN, reportDate) {
  const total = [...agg.values()].reduce((s, h) => s + h.value, 0);
  if (total <= 0) return [];
  const rows = [...agg.entries()]
    .map(([ticker, h]) => ({
      ticker,
      name: h.name,
      sector: resolveCanonical(h.gics, ticker, h.name),
      weight: round4(h.value / total),
      value: Math.round(h.value),
      ret: reportDate
        ? returnSinceQuarterEnd(ticker, reportDate)
        : returnProxy(ticker),
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
  const { investor } = loadJsonGuarded(path.join(INVESTORS_DIR, file), guardInvestorDoc);
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
    treemap: treemapRows(latestAgg, TREEMAP_TOP_N, latest.report_date),
    performance: performanceSeries(filings),
  };

  if (!globalQuarter || latest.quarter > globalQuarter) {
    globalQuarter = latest.quarter;
  }
  latestAggs.push({
    quarter: latest.quarter,
    report_date: latest.report_date,
    agg: latestAgg,
  });
}

/* ── cohort total (latest global quarter only) ── */
const totalAgg = new Map();
let cohortCount = 0;
let globalReportDate = null;
for (const { quarter, report_date, agg } of latestAggs) {
  if (quarter !== globalQuarter) continue;
  cohortCount += 1;
  if (report_date) globalReportDate = report_date;
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
  const { investor } = loadJsonGuarded(path.join(INVESTORS_DIR, file), guardInvestorDoc);
  for (const f of investor.filings ?? []) quarterSet.add(f.quarter);
}
const historyQuarters = [...quarterSet].sort().slice(-12);
const cohortByQuarter = new Map(
  historyQuarters.map((q) => [q, Object.fromEntries(CANONICAL.map((c) => [c, 0]))]),
);
const cohortTotals = new Map(historyQuarters.map((q) => [q, 0]));
for (const file of investorFiles) {
  const { investor } = loadJsonGuarded(path.join(INVESTORS_DIR, file), guardInvestorDoc);
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
    return_source:
      "yf quarter-end adjusted close -> latest (data/yf/quarter_closes.json); fallback momentum3m proxy when snapshot missing",
    performance_method:
      "buy-at-quarter-end, covered-weight renormalized, index base 100 vs SPY",
    sector_chain: "filing GICS enrichment -> scouter join -> Other (ETF name guard)",
    generated_at: new Date().toISOString(),
    disclaimer:
      "Estimated from 13F quarter-end snapshots (45-day lag). Sector weights are value-based on reported long positions only.",
  },
  total: {
    treemap: treemapRows(totalAgg, TOTAL_TREEMAP_TOP_N, globalReportDate),
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
