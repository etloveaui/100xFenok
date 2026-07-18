#!/usr/bin/env node
/**
 * Build Fenok-native short-term flow proxies from free/public sources.
 *
 * Current implemented slice:
 * - FINRA Daily Short Sale Volume TXT -> short pressure proxy
 * - FINRA Daily TotalVolume + local YF consolidated volume -> off-exchange
 *   activity proxy
 *
 * Raw FINRA files are cached under _private/admin only. Public mirrors are not
 * written by this script.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FLOW_PROXY_FORMULA_VERSION } from "./lib/fenok-proxy-formula-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow");

const SCHEMA_VERSION = "fenok-flow-proxies/v0.1";
const FORMULA_VERSION = FLOW_PROXY_FORMULA_VERSION;
const CONTRACT_DOCS = [
  "docs/planning/CONTRACT_fenok_short_pressure_sources_20260628.md",
  "docs/planning/CONTRACT_fenok_flow_sources_20260628.md",
];
const FINRA_CDN_TEMPLATE = "https://cdn.finra.org/equity/regsho/daily/CNMSshvol{date}.txt";
const FINRA_CACHE_DIR = path.join(privateRoot, "finra", "regsho_daily");
const OUTPUT_FILE = "computed/fenok_flow_proxies.json";
const HISTORY_FILE = "computed/fenok_flow_proxies_history.json";

const DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];

function parseArgs(argv) {
  const args = {
    date: "",
    tickers: "",
    limit: 0,
    maxWalkbackDays: 14,
    noFetch: false,
    noWrite: false,
    planOnly: false,
    referenceOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--date") args.date = next();
    else if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--max-walkback-days") args.maxWalkbackDays = Number(next()) || args.maxWalkbackDays;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--plan-only") args.planOnly = true;
    else if (arg === "--reference-only") args.referenceOnly = true;
    else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function ymdFromDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isoFromYmd(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function candidateDates({ requestedDate, maxWalkbackDays }) {
  if (requestedDate) return [requestedDate.replaceAll("-", "")];
  const out = [];
  const today = new Date();
  for (let i = 0; i <= maxWalkbackDays; i++) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const day = d.getUTCDay();
    if (day === 0 || day === 6) continue;
    out.push(ymdFromDate(d));
  }
  return out;
}

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot, relPath), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, payload) {
  const abs = path.join(dataRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function fetchText(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
          return;
        }
        resolve(data);
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

async function loadFinraDailyText({ ymdDates, noFetch }) {
  fs.mkdirSync(FINRA_CACHE_DIR, { recursive: true });
  const attempts = [];
  for (const ymd of ymdDates) {
    const cachePath = path.join(FINRA_CACHE_DIR, `CNMSshvol${ymd}.txt`);
    if (fs.existsSync(cachePath)) {
      return {
        ymd,
        text: fs.readFileSync(cachePath, "utf8"),
        source_url: FINRA_CDN_TEMPLATE.replace("{date}", ymd),
        cache_path: path.relative(repoRoot, cachePath),
        cache_hit: true,
        attempts,
      };
    }
    if (noFetch) {
      attempts.push({ ymd, status: "cache_missing_no_fetch" });
      continue;
    }
    const url = FINRA_CDN_TEMPLATE.replace("{date}", ymd);
    try {
      const text = await fetchText(url);
      fs.writeFileSync(cachePath, text, "utf8");
      return {
        ymd,
        text,
        source_url: url,
        cache_path: path.relative(repoRoot, cachePath),
        cache_hit: false,
        attempts,
      };
    } catch (err) {
      attempts.push({ ymd, status: "fetch_failed", error: err.message });
    }
  }
  throw new Error(`No FINRA daily file available in requested window: ${JSON.stringify(attempts)}`);
}

function parseFinraDaily(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines.shift();
  if (header !== "Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market") {
    throw new Error(`Unexpected FINRA header: ${header}`);
  }
  const bySymbol = new Map();
  for (const line of lines) {
    const [date, symbol, shortVolume, shortExemptVolume, totalVolume, market] = line.split("|");
    if (!date || !symbol) continue;
    const key = symbol.toUpperCase();
    const prev = bySymbol.get(key) ?? {
      date,
      symbol: key,
      short_volume: 0,
      short_exempt_volume: 0,
      total_volume: 0,
      markets: new Set(),
      row_count: 0,
    };
    prev.short_volume += Number(shortVolume) || 0;
    prev.short_exempt_volume += Number(shortExemptVolume) || 0;
    prev.total_volume += Number(totalVolume) || 0;
    for (const part of String(market ?? "").split(",")) {
      if (part) prev.markets.add(part);
    }
    prev.row_count += 1;
    bySymbol.set(key, prev);
  }
  return bySymbol;
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function loadTickerUniverse({ tickers, limit, referenceOnly }) {
  let out = [];
  if (tickers) {
    out = tickers.split(",").map(normalizeTicker).filter(Boolean);
  } else if (referenceOnly) {
    out = DEFAULT_REFERENCE_TICKERS.slice();
  } else {
    const fenokSignals = readJson("computed/fenok_signals.json", {});
    const rows = Array.isArray(fenokSignals.rows) ? fenokSignals.rows : [];
    out = rows
      .filter((row) => row.market_scope === "us")
      .map((row) => normalizeTicker(row.ticker))
      .filter(Boolean);
  }
  out = [...new Set(out)].filter((ticker) => /^[A-Z][A-Z0-9.\-]{0,11}$/.test(ticker));
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function latestYfHistoryOnOrBefore(ticker, isoDate) {
  const payload = readJson(`yf/finance/${ticker}.json`, null);
  const history = payload?.data?.history_1y;
  if (!Array.isArray(history)) return null;
  let best = null;
  for (const row of history) {
    const date = row?.date;
    if (!date || date > isoDate) continue;
    if (!best || date > best.date) best = row;
  }
  return best;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// FINRA short-volume ratio -> 0..100 pressure score (declared calibration).
// Anchored on data/computed/fenok_flow_proxies.json (687 scored US rows,
// measured 2026-07-18, source date 2026-07-17):
//   p5=0.281  p10=0.335  p25=0.430  p50=0.530  p75=0.637  p90=0.722  p95=0.771
// The retired [0.35, 0.70] band pinned 11.6% at 0 and 13.0% at 100
// (24.6% combined). Rounded p5/p95 endpoints restore discrimination while
// keeping exact-boundary saturation near 10% on the measured universe.
const SHORT_PRESSURE_RATIO_FLOOR = 0.28; // ~p5 of 2026-07-18 distribution
const SHORT_PRESSURE_RATIO_CEIL = 0.77; // ~p95 of 2026-07-18 distribution

function scoreShortPressure(shortRatio) {
  if (!Number.isFinite(shortRatio)) return null;
  const span = SHORT_PRESSURE_RATIO_CEIL - SHORT_PRESSURE_RATIO_FLOOR;
  return round(clamp(((shortRatio - SHORT_PRESSURE_RATIO_FLOOR) / span) * 100), 2);
}

// Off-exchange share -> 0..100 activity score (DEC-266-style declared calibration).
// Anchored on the measured off_exchange_share distribution of
// data/computed/fenok_flow_proxies.json (687 scored US rows, measured 2026-07-18):
//   p5=0.251  p10=0.278  p25=0.334  p50=0.405  p75=0.482  p90=0.567  p95=0.670
// The clamp endpoints are set at ~p5/p95 (0.25/0.65), NOT p10/p90, on purpose:
// endpoints exactly at p10/p90 pin ~20% of the real universe at 0 or 100 by
// construction, colliding with the distribution-sanity floor in the test. p5/p95
// endpoints keep real-data saturation near 10% while preserving discrimination
// across the bulk (four-bucket direction spread stays populated).
// The retired v0.1 band [0.10, 0.40] pinned 52.8% of rows at exactly 100 because
// the measured median share (0.405) already exceeded the old 0.40 ceiling.
const OFF_EXCHANGE_SHARE_FLOOR = 0.25; // ~p5 of 2026-07-18 measured distribution
const OFF_EXCHANGE_SHARE_CEIL = 0.65; // ~p95 of 2026-07-18 measured distribution

function scoreOffExchangeShare(share) {
  if (!Number.isFinite(share)) return null;
  const span = OFF_EXCHANGE_SHARE_CEIL - OFF_EXCHANGE_SHARE_FLOOR;
  return round(clamp(((share - OFF_EXCHANGE_SHARE_FLOOR) / span) * 100), 2);
}

function directionFromShortPressure(score) {
  if (!Number.isFinite(score)) return "unavailable";
  if (score >= 75) return "elevated_two_sided";
  if (score >= 50) return "watch";
  if (score <= 20) return "muted";
  return "normal";
}

function directionFromOffExchange(score) {
  if (!Number.isFinite(score)) return "unavailable";
  if (score >= 75) return "high_activity";
  if (score >= 50) return "elevated_activity";
  if (score <= 20) return "low_activity";
  return "normal_activity";
}

function buildRows({ tickers, finraRows, sourceYmd }) {
  const sourceIso = isoFromYmd(sourceYmd);
  return tickers.map((ticker) => {
    const finra = finraRows.get(ticker) ?? null;
    const yfHistory = latestYfHistoryOnOrBefore(ticker, sourceIso);
    const consolidatedVolume = Number(yfHistory?.Volume);
    const hasFinra = Boolean(finra && finra.total_volume > 0);
    const shortRatio = hasFinra ? finra.short_volume / finra.total_volume : null;
    const shortExemptRatio = hasFinra ? finra.short_exempt_volume / finra.total_volume : null;
    const offExchangeShare = hasFinra && consolidatedVolume > 0
      ? finra.total_volume / consolidatedVolume
      : null;
    const shortPressureProxyScore = scoreShortPressure(shortRatio);
    const offExchangeActivityProxyScore = scoreOffExchangeShare(offExchangeShare);
    const coverageRatio = (hasFinra ? 0.6 : 0) + (Number.isFinite(offExchangeShare) ? 0.4 : 0);
    const confidence = coverageRatio >= 0.95 ? "high" : coverageRatio >= 0.55 ? "medium" : "low";

    return {
      ticker,
      as_of: sourceIso,
      source_date: sourceYmd,
      confidence,
      coverage_ratio: round(coverageRatio, 2),
      freshness: {
        daily_finra_short_volume: hasFinra ? "daily" : "missing",
        consolidated_volume: Number.isFinite(consolidatedVolume) ? "local_yf_history_1y" : "missing",
      },
      source_families: [
        "FINRA Daily Short Sale Volume Files",
        Number.isFinite(consolidatedVolume) ? "local data/yf/finance history_1y volume" : null,
      ].filter(Boolean),
      short_pressure_proxy: {
        score_0_100: shortPressureProxyScore,
        direction: directionFromShortPressure(shortPressureProxyScore),
        short_volume_ratio: round(shortRatio, 6),
        short_exempt_ratio: round(shortExemptRatio, 6),
        short_volume: hasFinra ? round(finra.short_volume, 4) : null,
        short_exempt_volume: hasFinra ? round(finra.short_exempt_volume, 4) : null,
        total_volume: hasFinra ? round(finra.total_volume, 4) : null,
        caveat: "FINRA reported short-sale volume share; not short interest, borrow fee, utilization, or buy/sell direction.",
      },
      off_exchange_activity_proxy: {
        score_0_100: offExchangeActivityProxyScore,
        direction: directionFromOffExchange(offExchangeActivityProxyScore),
        off_exchange_share: round(offExchangeShare, 6),
        finra_total_volume: hasFinra ? round(finra.total_volume, 4) : null,
        consolidated_volume: Number.isFinite(consolidatedVolume) ? round(consolidatedVolume, 4) : null,
        consolidated_volume_date: yfHistory?.date ?? null,
        caveat: "FINRA reported off-exchange bucket proxy versus local consolidated volume; not true ATS-only dark-pool prints and not directional intent.",
      },
    };
  });
}

function buildSnapshot({ rows, finraLoad, generatedAt }) {
  return {
    schema_version: 1,
    generated_at: generatedAt,
    formula_version: FORMULA_VERSION,
    contract_docs: CONTRACT_DOCS,
    public_surface_status: "admin_private_derived_only_not_public",
    raw_policy: {
      external_collection: true,
      raw_cache_public: false,
      third_party_raw_public: false,
      full_public_mirror: false,
      raw_cache_path: finraLoad.cache_path,
      public_payload: null,
    },
    source_files: {
      finra_daily_short_sale_volume: finraLoad.source_url,
      local_yf_finance: "data/yf/finance/{TICKER}.json",
    },
    coverage: {
      row_count: rows.length,
      with_finra: rows.filter((row) => row.short_pressure_proxy.total_volume != null).length,
      with_consolidated_volume: rows.filter((row) => row.off_exchange_activity_proxy.consolidated_volume != null).length,
      with_off_exchange_score: rows.filter((row) => row.off_exchange_activity_proxy.score_0_100 != null).length,
      with_short_pressure_score: rows.filter((row) => row.short_pressure_proxy.score_0_100 != null).length,
      confidence_counts: rows.reduce((acc, row) => {
        acc[row.confidence] = (acc[row.confidence] ?? 0) + 1;
        return acc;
      }, {}),
    },
    semantics: {
      shortPressureProxyScore: "Higher means higher FINRA reported short-sale volume ratio; interpretation is two-sided.",
      offExchangeActivityProxyScore: "Higher means higher FINRA reported off-exchange activity share versus local consolidated volume; not true ATS-only dark-pool flow.",
    },
    rows,
  };
}

function mergeHistory(snapshot) {
  const history = readJson(HISTORY_FILE, {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    rows: [],
  });
  const rows = Array.isArray(history.rows) ? history.rows.map((row) => ({
    ...row,
    shortPressureProxyScore: scoreShortPressure(row.shortVolumeRatio),
    offExchangeActivityProxyScore: scoreOffExchangeShare(row.offExchangeShare),
  })) : [];
  const incoming = snapshot.rows.map((row) => ({
    ticker: row.ticker,
    as_of: row.as_of,
    source_date: row.source_date,
    confidence: row.confidence,
    coverage_ratio: row.coverage_ratio,
    shortPressureProxyScore: row.short_pressure_proxy.score_0_100,
    shortVolumeRatio: row.short_pressure_proxy.short_volume_ratio,
    offExchangeActivityProxyScore: row.off_exchange_activity_proxy.score_0_100,
    offExchangeShare: row.off_exchange_activity_proxy.off_exchange_share,
  }));
  const incomingKeys = new Set(incoming.map((row) => `${row.ticker}|${row.source_date}`));
  const kept = rows.filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}`));
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    raw_policy: {
      third_party_raw_public: false,
      rows_are_derived_only: true,
    },
    rows: [...kept, ...incoming].sort((a, b) => (
      String(a.ticker).localeCompare(String(b.ticker)) || String(a.source_date).localeCompare(String(b.source_date))
    )),
  };
}

async function build(args) {
  const tickers = loadTickerUniverse(args);
  const dates = candidateDates({ requestedDate: args.date, maxWalkbackDays: args.maxWalkbackDays });
  if (args.planOnly) {
    return {
      plan_only: true,
      schema_version: SCHEMA_VERSION,
      formula_version: FORMULA_VERSION,
      tickers: tickers.length,
      sample: tickers.slice(0, 20),
      candidate_dates: dates,
      raw_cache_dir: path.relative(repoRoot, FINRA_CACHE_DIR),
      output_file: `data/${OUTPUT_FILE}`,
      history_file: `data/${HISTORY_FILE}`,
      public_mirror: false,
    };
  }

  const finraLoad = await loadFinraDailyText({ ymdDates: dates, noFetch: args.noFetch });
  const finraRows = parseFinraDaily(finraLoad.text);
  const rows = buildRows({ tickers, finraRows, sourceYmd: finraLoad.ymd });
  const snapshot = buildSnapshot({ rows, finraLoad, generatedAt: isoNow() });
  const history = mergeHistory(snapshot);
  if (!args.noWrite) {
    writeJson(OUTPUT_FILE, snapshot);
    writeJson(HISTORY_FILE, history);
  }
  return {
    output_file: `data/${OUTPUT_FILE}`,
    history_file: `data/${HISTORY_FILE}`,
    wrote: !args.noWrite,
    finra_source_date: finraLoad.ymd,
    finra_cache_hit: finraLoad.cache_hit,
    coverage: snapshot.coverage,
    reference_rows: snapshot.rows.filter((row) => DEFAULT_REFERENCE_TICKERS.includes(row.ticker)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await build(args);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

export {
  buildRows,
  candidateDates,
  parseFinraDaily,
  scoreOffExchangeShare,
  scoreShortPressure,
};
