#!/usr/bin/env node
/**
 * Build script: 13F quarter-over-quarter trades ranking.
 *
 * For each investor with a filing in the latest global quarter, diff the
 * latest two filings into per-ticker share changes, estimate traded amounts
 * using per-quarter prices (median of market_value/shares across filings),
 * then aggregate across investors into bought/sold rankings.
 *
 * Run: node scripts/build-13f-trades.mjs
 * Output: data/sec-13f/analytics/trades_ranking.json (+ public mirror)
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
const OUTPUT = path.join(ROOT, "data/sec-13f/analytics/trades_ranking.json");
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

const TOP_N = 50;

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeBoth(rootPath, data) {
  writeJson(rootPath, data);
  writeJson(path.join(PUBLIC_MIRROR_DIR, path.basename(rootPath)), data);
}

function median(values) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function guardSectorMap(data, filePath) {
  requireKeys(data, filePath, ["gicsToCanonical", "scouterToCanonical"]);
  requireObject(data.gicsToCanonical, filePath, "gicsToCanonical");
  requireObject(data.scouterToCanonical, filePath, "scouterToCanonical");
}

function guardStocksAnalyzer(data, filePath) {
  requireKeys(data, filePath, ["data"]);
  requireArray(data.data, filePath, "data");
}

function guardInvestorDoc(data, filePath) {
  requireKeys(data, filePath, ["investor"]);
  requireObject(data.investor, filePath, "investor");
  requireKeys(data.investor, filePath, ["filings"], "investor");
  requireArray(data.investor.filings, filePath, "investor.filings");
}

/* ── sector resolution (SSOT: sector-map.json, soft dependency) ── */
let gicsToCanonical = {};
let scouterToCanonical = {};
if (fs.existsSync(SECTOR_MAP_PATH)) {
  const sectorMap = loadJsonGuarded(SECTOR_MAP_PATH, guardSectorMap);
  gicsToCanonical = sectorMap.gicsToCanonical ?? {};
  scouterToCanonical = sectorMap.scouterToCanonical ?? {};
} else {
  console.warn(`[warn] sector-map.json not found — canonical sectors omitted`);
}

const scouterSectorByTicker = new Map();
if (fs.existsSync(STOCKS_ANALYZER_PATH)) {
  for (const row of loadJsonGuarded(STOCKS_ANALYZER_PATH, guardStocksAnalyzer).data ?? []) {
    if (row.symbol && row.sector) scouterSectorByTicker.set(row.symbol, row.sector);
  }
}

const ETF_NAME_PATTERN =
  /\b(ETF|ISHARES|SPDR|VANGUARD INDEX|INVESCO QQQ|WISDOMTREE|TRUST SERIES)\b/i;

function resolveCanonical(gicsRaw, ticker, name) {
  // Source enrichment mislabels index ETFs (SPY/IVV → "Financials") — bucket as Other.
  if (name && ETF_NAME_PATTERN.test(name)) return "Other";
  if (gicsRaw) {
    const c = gicsToCanonical[String(gicsRaw).trim()];
    if (c) return c;
  }
  const scouterRaw = scouterSectorByTicker.get(ticker);
  if (scouterRaw) {
    const c = scouterToCanonical[String(scouterRaw).trim()];
    if (c) return c;
  }
  return "Other";
}

/* ── load investors, pick latest global quarter cohort ── */
const investorFiles = fs
  .readdirSync(INVESTORS_DIR)
  .filter((f) => f.endsWith(".json"));

const investors = investorFiles.map((file) => {
  const id = path.basename(file, ".json");
  const { investor } = loadJsonGuarded(path.join(INVESTORS_DIR, file), guardInvestorDoc);
  return { id, name: investor.name, entity: investor.entity, filings: investor.filings };
});

const latestQuarter = investors
  .map((inv) => inv.filings.at(-1)?.quarter)
  .filter(Boolean)
  .sort()
  .at(-1);

const included = [];
const excluded = [];
for (const inv of investors) {
  const last = inv.filings.at(-1);
  if (last?.quarter === latestQuarter && inv.filings.length >= 2) {
    included.push(inv);
  } else {
    excluded.push({ id: inv.id, latest_quarter: last?.quarter ?? null });
  }
}

/* ── aggregate holdings by ticker within a filing ── */
function aggByTicker(filing) {
  const map = new Map();
  for (const h of filing.holdings ?? []) {
    const ticker = h.ticker?.trim();
    if (!ticker) continue;
    const cur = map.get(ticker) ?? {
      shares: 0,
      value: 0,
      name: h.name,
      gics: null,
    };
    cur.shares += h.shares ?? 0;
    cur.value += h.market_value ?? 0;
    if (!cur.gics && h.sector) cur.gics = h.sector;
    map.set(ticker, cur);
  }
  return map;
}

/* ── per-quarter price maps: median(market_value/shares) ── */
function buildPriceMap(filingsByInvestor) {
  const samples = new Map();
  for (const agg of filingsByInvestor) {
    for (const [ticker, h] of agg) {
      if (h.shares > 0 && h.value > 0) {
        if (!samples.has(ticker)) samples.set(ticker, []);
        samples.get(ticker).push(h.value / h.shares);
      }
    }
  }
  const prices = new Map();
  for (const [ticker, list] of samples) prices.set(ticker, median(list));
  return prices;
}

const nowAggs = included.map((inv) => aggByTicker(inv.filings.at(-1)));
const prevAggs = included.map((inv) => aggByTicker(inv.filings.at(-2)));
const priceNow = buildPriceMap(nowAggs);
const pricePrev = buildPriceMap(prevAggs);

/* ── share normalization guard ──
 * Quarter-end prices must agree across filers. When a holding's implied
 * price (value/shares) deviates >2x from the cohort median, the shares
 * field is untrustworthy (unit/parsing anomaly in source filing) — derive
 * effective shares from market_value instead. */
let shareNormalizedCount = 0;
function effectiveShares(h, priceMap, ticker) {
  if (!h) return 0;
  const med = priceMap.get(ticker);
  if (!med || h.value <= 0) return h.shares ?? 0;
  if (!h.shares || h.shares <= 0) {
    shareNormalizedCount += 1;
    return h.value / med;
  }
  const implied = h.value / h.shares;
  if (implied / med > 2 || implied / med < 0.5) {
    shareNormalizedCount += 1;
    return h.value / med;
  }
  return h.shares;
}

/* ── diff per investor, aggregate per ticker ── */
const bought = new Map();
const sold = new Map();
let skippedNoPrice = 0;

included.forEach((inv, idx) => {
  const now = nowAggs[idx];
  const prev = prevAggs[idx];
  const tickers = new Set([...now.keys(), ...prev.keys()]);

  for (const ticker of tickers) {
    const n = now.get(ticker);
    const p = prev.get(ticker);
    const dShares =
      effectiveShares(n, priceNow, ticker) -
      effectiveShares(p, pricePrev, ticker);
    if (dShares === 0) continue;

    const price = priceNow.get(ticker) ?? pricePrev.get(ticker);
    if (!price) {
      skippedNoPrice += 1;
      continue;
    }

    const amount = Math.abs(dShares) * price;
    const bucket = dShares > 0 ? bought : sold;
    const row = bucket.get(ticker) ?? {
      ticker,
      name: n?.name ?? p?.name ?? ticker,
      gics: n?.gics ?? p?.gics ?? null,
      amount: 0,
      investors: [],
      new_count: 0,
      exit_count: 0,
    };
    row.amount += amount;
    row.investors.push({ id: inv.id, name: inv.name, amount: Math.round(amount) });
    if (dShares > 0 && !p) row.new_count += 1;
    if (dShares < 0 && !n) row.exit_count += 1;
    bucket.set(ticker, row);
  }
});

function toRanking(bucket, changeKey) {
  return [...bucket.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, TOP_N)
    .map((row, i) => {
      const top = row.investors.sort((a, b) => b.amount - a.amount)[0];
      return {
        rank: i + 1,
        ticker: row.ticker,
        name: row.name,
        sector: resolveCanonical(row.gics, row.ticker, row.name),
        sector_gics: row.gics,
        amount: Math.round(row.amount),
        investors_count: row.investors.length,
        [changeKey]: row[changeKey],
        top_investor: top,
      };
    });
}

const output = {
  metadata: {
    quarter: latestQuarter,
    investors_included: included.map((inv) => inv.id),
    investors_excluded: excluded,
    price_method:
      "per-quarter median(market_value/shares) across cohort filings; amount = |Δshares| × price",
    skipped_no_price: skippedNoPrice,
    share_normalized_count: shareNormalizedCount,
    top_n: TOP_N,
    generated_at: new Date().toISOString(),
    disclaimer:
      "Estimated from 13F quarter-end snapshots (45-day lag). Intra-quarter trades, short positions, and non-13F assets are not captured.",
  },
  bought: toRanking(bought, "new_count"),
  sold: toRanking(sold, "exit_count"),
};

writeBoth(OUTPUT, output);

console.log(
  `trades_ranking: quarter=${latestQuarter} cohort=${included.length}/${investors.length} ` +
    `bought=${bought.size} sold=${sold.size} (top ${TOP_N} each) skippedNoPrice=${skippedNoPrice}`,
);
console.log(`written: ${OUTPUT}`);
console.log(`mirror:  ${path.join(PUBLIC_MIRROR_DIR, path.basename(OUTPUT))}`);
