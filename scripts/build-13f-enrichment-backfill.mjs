#!/usr/bin/env node
/**
 * Backfill SEC 13F public holdings with local YF finance metadata.
 *
 * The upstream converter can be run with live Yahoo disabled. This script keeps
 * the publish path deterministic by using only checked-in local YF artifacts:
 *   - data/yf/finance/*.json for sector/industry/market cap
 *   - data/yf/quarter_closes.json for report-date close and latest close
 *
 * Outputs:
 *   - data/sec-13f/investors/*.json (+ public mirror)
 *   - data/sec-13f/summary.json (+ public mirror)
 *   - data/sec-13f/by_sector.json (+ public mirror)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadTickerResolver,
  normalizeCompanyName,
  SYMBOL_RE,
} from "./lib/sec13f-symbols.mjs";
import {
  loadJsonGuarded,
  requireArray,
  requireKeys,
  requireNumber,
  requireObject,
} from "./lib/guarded-json.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INVESTORS_DIR = path.join(ROOT, "data/sec-13f/investors");
const PUBLIC_INVESTORS_DIR = path.join(ROOT, "100xfenok-next/public/data/sec-13f/investors");
const SUMMARY_PATH = path.join(ROOT, "data/sec-13f/summary.json");
const BY_SECTOR_PATH = path.join(ROOT, "data/sec-13f/by_sector.json");
const YF_DIR = path.join(ROOT, "data/yf/finance");
const YF_SUMMARY_PATH = path.join(YF_DIR, "_summary.json");
const QUARTER_CLOSES_PATH = path.join(ROOT, "data/yf/quarter_closes.json");

const ABS_BUCKETS = [
  [200_000_000_000, "mega"],
  [10_000_000_000, "large"],
  [2_000_000_000, "mid"],
  [300_000_000, "small"],
  [0, "micro"],
];

const YAHOO_SECTOR_TO_GICS = new Map([
  ["Basic Materials", "Materials"],
  ["Communication Services", "Communication Services"],
  ["Consumer Cyclical", "Consumer Discretionary"],
  ["Consumer Defensive", "Consumer Staples"],
  ["Energy", "Energy"],
  ["Financial Services", "Financials"],
  ["Financial", "Financials"],
  ["Financials", "Financials"],
  ["Healthcare", "Health Care"],
  ["Health Care", "Health Care"],
  ["Industrials", "Industrials"],
  ["Real Estate", "Real Estate"],
  ["Technology", "Information Technology"],
  ["Utilities", "Utilities"],
]);

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeRootAndPublic(relPath, data) {
  writeJson(path.join(ROOT, relPath), data);
  writeJson(path.join(ROOT, "100xfenok-next/public", relPath), data);
}

function readExistingJson(filePath, fallback, guardFn) {
  return fs.existsSync(filePath) ? loadJsonGuarded(filePath, guardFn) : fallback;
}

function guardYfSummary(data, filePath) {
  requireKeys(data, filePath, ["count", "ok", "failed", "errors"]);
  requireNumber(data.count, filePath, "count");
  requireNumber(data.ok, filePath, "ok");
  requireNumber(data.failed, filePath, "failed");
  if (!Array.isArray(data.errors) && typeof data.errors !== "number") {
    throw new Error("errors must be an array or number");
  }
}

function requireNonNegativeInteger(value, filePath, key) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${filePath}: ${key} must be a non-negative integer`);
  }
}

function guardQuarterCloses(data, filePath) {
  requireKeys(data, filePath, ["tickers"]);
  requireObject(data.tickers, filePath, "tickers");
}

function guardYfProfile(data, filePath) {
  requireKeys(data, filePath, ["data"]);
  requireObject(data.data, filePath, "data");
}

function guardInvestorDoc(data, filePath) {
  requireKeys(data, filePath, ["investor"]);
  requireObject(data.investor, filePath, "investor");
  requireKeys(data.investor, filePath, ["filings"], "investor");
  requireArray(data.investor.filings, filePath, "investor.filings");
}

function guardSummaryDoc(data, filePath) {
  requireObject(data, filePath);
}

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function classifyMarketCap(marketCap) {
  if (!(marketCap > 0)) return "unknown";
  for (const [threshold, label] of ABS_BUCKETS) {
    if (marketCap >= threshold) return label;
  }
  return "unknown";
}

function percentileCut(values, ratio) {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  return values[Math.floor((values.length - 1) * ratio)];
}

function assignRelativeBuckets(holdings) {
  const caps = holdings
    .map((h) => numberOrNull(h.market_cap_usd))
    .filter((v) => v !== null && v > 0)
    .sort((a, b) => a - b);
  if (!caps.length) {
    for (const holding of holdings) delete holding.market_cap_bucket_rel;
    return;
  }

  const q20 = percentileCut(caps, 0.2);
  const q40 = percentileCut(caps, 0.4);
  const q60 = percentileCut(caps, 0.6);
  const q80 = percentileCut(caps, 0.8);
  for (const holding of holdings) {
    const cap = numberOrNull(holding.market_cap_usd);
    if (!(cap > 0)) {
      delete holding.market_cap_bucket_rel;
    } else if (cap <= q20) {
      holding.market_cap_bucket_rel = "q1";
    } else if (cap <= q40) {
      holding.market_cap_bucket_rel = "q2";
    } else if (cap <= q60) {
      holding.market_cap_bucket_rel = "q3";
    } else if (cap <= q80) {
      holding.market_cap_bucket_rel = "q4";
    } else {
      holding.market_cap_bucket_rel = "q5";
    }
  }
}

function normalizeSector(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return YAHOO_SECTOR_TO_GICS.get(raw) ?? raw;
}

function dateFromTimestamp(value) {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}

function dateFromUnixSeconds(value) {
  const seconds = numberOrNull(value);
  if (!(seconds > 0)) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function quarterEnd(quarter) {
  const match = String(quarter ?? "").match(/^(\d{4})-Q([1-4])$/);
  if (!match) return null;
  const year = match[1];
  return {
    1: `${year}-03-31`,
    2: `${year}-06-30`,
    3: `${year}-09-30`,
    4: `${year}-12-31`,
  }[match[2]];
}

function loadYfSummaryState() {
  if (!fs.existsSync(YF_SUMMARY_PATH)) {
    return {
      summary: { count: 0, ok: 0, failed: 0, errors: [], generated_at: null },
      warnings: ["YF finance summary is unavailable; preserving existing 13F enrichment where source rows are absent"],
    };
  }
  const summary = loadJsonGuarded(YF_SUMMARY_PATH, guardYfSummary);
  const count = Number(summary.count ?? 0);
  const ok = Number(summary.ok ?? 0);
  const failed = Number(summary.failed ?? 0);
  const errors = Array.isArray(summary.errors) ? summary.errors.length : Number(summary.errors ?? 0);
  for (const [key, value] of [["count", count], ["ok", ok], ["failed", failed], ["errors", errors]]) {
    requireNonNegativeInteger(value, YF_SUMMARY_PATH, key);
  }
  if (ok + failed !== count || errors !== failed) {
    throw new Error(
      `YF finance summary count reconciliation failed: count=${count} ok=${ok} failed=${failed} errors=${errors}`,
    );
  }
  if (failed > 0 && !Array.isArray(summary.errors)) {
    throw new Error("YF finance summary must name every failed ticker before partial 13F enrichment can preserve LKG safely");
  }
  const failedSymbols = new Set();
  if (Array.isArray(summary.errors)) {
    for (const [index, row] of summary.errors.entries()) {
      const ticker = String(row?.ticker ?? "").trim().toUpperCase();
      if (!ticker || !SYMBOL_RE.test(ticker)) {
        throw new Error(`${YF_SUMMARY_PATH}: errors[${index}].ticker must be a valid symbol`);
      }
      if (failedSymbols.has(ticker)) {
        throw new Error(`${YF_SUMMARY_PATH}: duplicate failed ticker ${ticker}`);
      }
      failedSymbols.add(ticker);
    }
  }
  const warnings = [];
  if (count === 0) warnings.push("YF finance summary has no rows");
  if (failed > 0) {
    const sample = [...failedSymbols].slice(0, 10).join(", ") || "symbols unavailable";
    warnings.push(`YF finance is partial: ${failed}/${count} tickers failed (${sample}); those 13F fields remain LKG`);
  }
  return { summary, warnings, failedSymbols };
}

const {
  summary: yfSummary,
  warnings: yfWarnings,
  failedSymbols: yfFailedSymbols = new Set(),
} = loadYfSummaryState();
const quarterDoc = readExistingJson(QUARTER_CLOSES_PATH, {}, guardQuarterCloses);
const quarterCloses = quarterDoc.tickers ?? {};
const resolver = loadTickerResolver(ROOT);
const profileCache = new Map();

function profileForSymbol(symbol) {
  const clean = String(symbol ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(clean)) return null;
  if (profileCache.has(clean)) return profileCache.get(clean);
  if (yfFailedSymbols.has(clean)) {
    profileCache.set(clean, null);
    return null;
  }

  const filePath = path.join(YF_DIR, `${clean}.json`);
  if (!fs.existsSync(filePath)) {
    profileCache.set(clean, null);
    return null;
  }

  const payload = loadJsonGuarded(filePath, guardYfProfile);
  const payloadTicker = String(payload.ticker ?? "").trim().toUpperCase();
  if (payloadTicker !== clean) {
    throw new Error(`${filePath}: ticker identity mismatch; expected ${clean}, got ${payloadTicker || "(missing)"}`);
  }
  const info = payload.data?.info ?? {};
  const fetchedAt = dateFromTimestamp(payload.fetched_at);
  const sourceAsOf = dateFromUnixSeconds(info.regularMarketTime);
  if (sourceAsOf && fetchedAt && sourceAsOf > fetchedAt) {
    throw new Error(`${filePath}: regularMarketTime ${sourceAsOf} is after fetched_at ${fetchedAt}`);
  }
  const profile = {
    symbol: clean,
    fetched_at: fetchedAt,
    source_as_of: sourceAsOf,
    sector: normalizeSector(info.sector),
    industry: typeof info.industry === "string" && info.industry.trim() ? info.industry.trim() : null,
    market_cap: numberOrNull(info.marketCap),
    latest_price:
      numberOrNull(info.currentPrice) ??
      numberOrNull(info.regularMarketPrice) ??
      numberOrNull(info.previousClose),
  };
  profileCache.set(clean, profile);
  return profile;
}

function resolveProfile(holding) {
  const raw = String(holding?.ticker ?? "").trim().toUpperCase();
  const candidates = [];
  if (raw) {
    candidates.push(raw, raw.replace(".", "-"), raw.replace("-", "."));
  }
  const resolved = resolver.resolveHoldingSymbol(holding);
  if (resolved.symbol) candidates.push(resolved.symbol);
  const nameHit = resolver.nameMap.get(normalizeCompanyName(holding?.name));
  if (nameHit?.symbol) candidates.push(nameHit.symbol);

  for (const candidate of candidates) {
    const profile = profileForSymbol(candidate);
    if (profile) return profile;
  }
  return null;
}

function priceSnapshot(symbol, filing) {
  const closes = quarterCloses[symbol];
  if (!closes) return null;
  const reportDate = filing.report_date ?? quarterEnd(filing.quarter);
  const base = numberOrNull(closes[reportDate]);
  const latest = numberOrNull(closes.latest?.close);
  if (!(base > 0) || !(latest > 0)) return null;
  const latestDate = closes.latest?.date ?? null;
  const returnPct = ((latest - base) / base) * 100;
  return {
    price_at_filing: base,
    price_latest: latest,
    return_since_filing_pct: Math.round(returnPct * 10000) / 10000,
    return_as_of: latestDate,
  };
}

function backfillHolding(holding, filing, stats) {
  stats.total += 1;
  const profile = resolveProfile(holding);
  if (!profile) {
    stats.profileMiss += 1;
    return;
  }

  stats.profileHit += 1;
  stats.profileSymbols.add(profile.symbol);
  let touched = false;

  if (!holding.sector && profile.sector) {
    holding.sector = profile.sector;
    touched = true;
  }
  if (profile.industry) {
    holding.industry = profile.industry;
    touched = true;
  }
  if (profile.market_cap !== null && profile.market_cap > 0) {
    holding.market_cap_usd = profile.market_cap;
    holding.market_cap_bucket_abs = classifyMarketCap(profile.market_cap);
    holding.market_cap_as_of = profile.source_as_of;
    holding.market_cap_as_of_reason = profile.source_as_of
      ? null
      : "Yahoo profile did not publish a usable regularMarketTime for this observation";
    holding.market_cap_source = "yf-local";
    touched = true;
  }

  const snapshot = priceSnapshot(profile.symbol, filing);
  if (snapshot) {
    holding.price_at_filing = snapshot.price_at_filing;
    holding.price_latest = snapshot.price_latest;
    holding.return_since_filing_pct = snapshot.return_since_filing_pct;
    holding.return_as_of = snapshot.return_as_of;
    holding.price_source = "yf-quarter-close-local";
    touched = true;
  }

  if (touched) {
    holding.enrichment_source = "yf-local";
    if (profile.symbol !== String(holding.ticker ?? "").trim().toUpperCase()) {
      holding.enrichment_symbol = profile.symbol;
    } else {
      delete holding.enrichment_symbol;
    }
    stats.touched += 1;
  }
}

function collectCoverage(investorDocs) {
  const stats = {
    total: 0,
    sector: 0,
    industry: 0,
    market_cap: 0,
    price_at_filing: 0,
    return_since_filing: 0,
    sourceMix: new Map(),
  };
  for (const doc of investorDocs) {
    for (const filing of doc.investor?.filings ?? []) {
      for (const holding of filing.holdings ?? []) {
        stats.total += 1;
        if (holding.sector) stats.sector += 1;
        if (holding.industry) stats.industry += 1;
        if (numberOrNull(holding.market_cap_usd) !== null) stats.market_cap += 1;
        if (numberOrNull(holding.price_at_filing) !== null) stats.price_at_filing += 1;
        if (numberOrNull(holding.return_since_filing_pct) !== null) stats.return_since_filing += 1;
        const source = holding.enrichment_source || "unknown";
        stats.sourceMix.set(source, (stats.sourceMix.get(source) ?? 0) + 1);
      }
    }
  }
  const ratio = (value) => Math.round((value / Math.max(stats.total, 1)) * 10000) / 10000;
  return {
    total_holdings: stats.total,
    coverage: {
      sector: ratio(stats.sector),
      industry: ratio(stats.industry),
      market_cap: ratio(stats.market_cap),
      price_at_filing: ratio(stats.price_at_filing),
      return_since_filing: ratio(stats.return_since_filing),
    },
    sourceMix: Object.fromEntries([...stats.sourceMix.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

function buildBySector(investorDocs) {
  const sectors = new Map();
  const sourceMix = new Map();
  for (const doc of investorDocs) {
    const investorId = doc.__id;
    const latest = doc.investor?.filings?.at(-1);
    if (!latest) continue;
    for (const holding of latest.holdings ?? []) {
      const sector = holding.sector || "Other";
      const source = holding.enrichment_source || "unknown";
      const weight = numberOrNull(holding.weight) ?? 0;
      const ticker = holding.ticker || holding.name || "UNKNOWN";
      sourceMix.set(source, (sourceMix.get(source) ?? 0) + 1);
      if (!sectors.has(sector)) {
        sectors.set(sector, {
          investors: new Set(),
          weights: [],
          top_holdings: [],
        });
      }
      const row = sectors.get(sector);
      row.investors.add(investorId);
      row.weights.push(weight);
      if (!row.top_holdings.includes(ticker)) row.top_holdings.push(ticker);
    }
  }

  const output = {};
  for (const [sector, row] of [...sectors.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const avgWeight = row.weights.length
      ? row.weights.reduce((sum, value) => sum + value, 0) / row.weights.length
      : 0;
    output[sector] = {
      investors: [...row.investors].sort(),
      avg_weight: Math.round(avgWeight * 10000) / 10000,
      top_holdings: row.top_holdings.slice(0, 10),
    };
  }
  output._meta = {
    source_mix: Object.fromEntries([...sourceMix.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
  return output;
}

const investorFiles = fs.readdirSync(INVESTORS_DIR).filter((file) => file.endsWith(".json")).sort();
const investorDocs = [];
const backfillStats = {
  total: 0,
  touched: 0,
  profileHit: 0,
  profileMiss: 0,
  profileSymbols: new Set(),
};
const generatedAt = new Date().toISOString();

for (const file of investorFiles) {
  const id = path.basename(file, ".json");
  const doc = loadJsonGuarded(path.join(INVESTORS_DIR, file), guardInvestorDoc);
  doc.__id = id;
  for (const filing of doc.investor?.filings ?? []) {
    for (const holding of filing.holdings ?? []) {
      backfillHolding(holding, filing, backfillStats);
    }
    assignRelativeBuckets(filing.holdings ?? []);
  }
  doc.metadata = {
    ...(doc.metadata ?? {}),
    enrichment_backfill: {
      source: "local_yf_finance",
      status: yfWarnings.length > 0 ? "degraded" : "ready",
      warnings: yfWarnings,
      generated_at: generatedAt,
    },
  };
  investorDocs.push(doc);
}

const coverage = collectCoverage(investorDocs);
const bySector = buildBySector(investorDocs);
for (const doc of investorDocs) {
  const id = doc.__id;
  delete doc.__id;
  writeJson(path.join(INVESTORS_DIR, `${id}.json`), doc);
  writeJson(path.join(PUBLIC_INVESTORS_DIR, `${id}.json`), doc);
}

const summary = readExistingJson(SUMMARY_PATH, {}, guardSummaryDoc);
summary.metadata = {
  ...(summary.metadata ?? {}),
  enrichment_coverage: coverage.coverage,
  enrichment_source_mix: coverage.sourceMix,
  enrichment_denominator: "public_filtered_holdings",
  enrichment_backfill: {
    source: "local_yf_finance",
    status: yfWarnings.length > 0 ? "degraded" : "ready",
    warnings: yfWarnings,
    generated_at: generatedAt,
    yf_finance_generated_at: yfSummary.generated_at ?? null,
    yf_finance_files: yfSummary.count ?? null,
    yf_quarter_closes_generated_at: quarterDoc.generated_at ?? null,
    total_holdings: coverage.total_holdings,
    profile_hit_rows: backfillStats.profileHit,
    profile_miss_rows: backfillStats.profileMiss,
    touched_rows: backfillStats.touched,
    unique_profile_symbols: backfillStats.profileSymbols.size,
    sector_method: "Yahoo sector normalized to GICS where local profile is available; existing converter sector preserved",
    price_method: "report_date quarter close to latest close from local data/yf/quarter_closes.json",
  },
  mode: {
    ...(summary.metadata?.mode ?? {}),
    local_yf_backfill: true,
  },
};
writeRootAndPublic("data/sec-13f/summary.json", summary);
writeRootAndPublic("data/sec-13f/by_sector.json", bySector);

for (const warning of yfWarnings) console.warn(`::warning:: 13F enrichment degraded: ${warning}`);

console.log(
  `13f_enrichment_backfill: holdings=${coverage.total_holdings} ` +
    `touched=${backfillStats.touched} profile_hits=${backfillStats.profileHit} ` +
    `sector=${coverage.coverage.sector} industry=${coverage.coverage.industry} ` +
    `market_cap=${coverage.coverage.market_cap} price=${coverage.coverage.price_at_filing}`,
);
