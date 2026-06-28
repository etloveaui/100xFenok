#!/usr/bin/env node
/**
 * Build a Fenok-native all-axis Signal Lens proxy artifact.
 *
 * This consolidates the screenshot-derived methodology into Fenok-owned axes:
 * long-term native signals, SPY tracking similarity, richer technical proxy,
 * and flow proxies that were collected into derived/admin-only artifacts.
 *
 * No raw third-party rows are mirrored to public assets.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");

const FORMULA_VERSION = "fenok-signal-lens-proxies-v0.1";
const OUTPUT_FILE = "computed/fenok_signal_lens_proxies.json";
const SUMMARY_FILE = "computed/fenok_signal_lens_proxies_summary.json";
const HISTORY_FILE = "computed/fenok_signal_lens_proxies_history.json";
const SPY_TICKER = "SPY";
const DEFAULT_REFERENCE_TICKERS = ["DASH", "UNH", "PYPL", "RDDT", "COIN", "MU", "PLTR", "NVDA"];

function parseArgs(argv) {
  const args = {
    tickers: "",
    limit: 0,
    referenceOnly: false,
    noWrite: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--reference-only") args.referenceOnly = true;
    else if (arg === "--no-write") args.noWrite = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function readJson(relPath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot, relPath), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(relPath, payload, { compact = false } = {}) {
  const abs = path.join(dataRoot, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const body = compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2);
  fs.writeFileSync(abs, `${body}\n`, "utf8");
}

function finite(value) {
  return Number.isFinite(value);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  if (!finite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min = 0, max = 100) {
  if (!finite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function loadTickerUniverse({ tickers, referenceOnly, limit }) {
  let out = [];
  if (tickers) {
    out = tickers.split(",").map(normalizeTicker).filter(Boolean);
  } else if (referenceOnly) {
    out = DEFAULT_REFERENCE_TICKERS.slice();
  } else {
    const fenokSignals = readJson("computed/fenok_signals.json", {});
    out = (fenokSignals.rows ?? [])
      .filter((row) => row.market_scope === "us")
      .map((row) => normalizeTicker(row.ticker))
      .filter(Boolean);
  }
  out = [...new Set(out)];
  if (limit > 0) out = out.slice(0, limit);
  return out;
}

function loadHistory(ticker) {
  const payload = readJson(`yf/finance/${ticker}.json`, {});
  const history = payload?.data?.history_1y;
  if (!Array.isArray(history)) return [];
  return history
    .map((row) => ({
      date: row.date,
      close: num(row.Close ?? row.close),
      volume: num(row.Volume ?? row.volume),
    }))
    .filter((row) => row.date && finite(row.close) && row.close > 0)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function returnsByDate(history) {
  const out = new Map();
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]?.close;
    const cur = history[i]?.close;
    if (finite(prev) && finite(cur) && prev > 0) {
      out.set(history[i].date, cur / prev - 1);
    }
  }
  return out;
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const meanA = ax.reduce((sum, v) => sum + v, 0) / n;
  const meanB = bx.reduce((sum, v) => sum + v, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA;
    const db = bx[i] - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  if (varA === 0 || varB === 0) return null;
  return cov / Math.sqrt(varA * varB);
}

function beta(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 30) return null;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const meanA = ax.reduce((sum, v) => sum + v, 0) / n;
  const meanB = bx.reduce((sum, v) => sum + v, 0) / n;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    cov += (ax[i] - meanA) * (bx[i] - meanB);
    varB += (bx[i] - meanB) ** 2;
  }
  if (varB === 0) return null;
  return cov / varB;
}

function alignReturns(tickerHistory, spyHistory) {
  const tickerReturns = returnsByDate(tickerHistory);
  const spyReturns = returnsByDate(spyHistory);
  const ticker = [];
  const spy = [];
  for (const [date, value] of tickerReturns.entries()) {
    if (!spyReturns.has(date)) continue;
    ticker.push(value);
    spy.push(spyReturns.get(date));
  }
  return { ticker, spy };
}

function sp500TrackingSignal(tickerHistory, spyHistory) {
  const aligned = alignReturns(tickerHistory, spyHistory);
  const corr = correlation(aligned.ticker, aligned.spy);
  const b = beta(aligned.ticker, aligned.spy);
  const score = finite(corr) ? clamp(((corr + 1) / 2) * 100) : null;
  return {
    score_0_100: round(score),
    direction: !finite(score) ? "unavailable" : score >= 80 ? "tracks_sp500" : score <= 45 ? "idiosyncratic" : "mixed",
    correlation_1y: round(corr, 4),
    beta_1y: round(b, 4),
    overlap_days: aligned.ticker.length,
    basis: "daily_return_correlation_vs_spy_1y",
  };
}

function movingAverage(values, window) {
  if (values.length < window) return null;
  const slice = values.slice(-window);
  return slice.reduce((sum, v) => sum + v, 0) / window;
}

function percentileRank(value, low, high) {
  return clamp(((value - low) / (high - low)) * 100);
}

function rsi(closes, window = 14) {
  if (closes.length <= window) return null;
  const slice = closes.slice(-(window + 1));
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

function technicalIndicatorSignal(history) {
  const closes = history.map((row) => row.close).filter(finite);
  const volumes = history.map((row) => row.volume).filter(finite);
  if (closes.length < 50) {
    return {
      score_0_100: null,
      direction: "unavailable",
      basis: "insufficient_local_ohlcv_history",
      coverage_ratio: round(closes.length / 50, 2),
    };
  }

  const latest = closes.at(-1);
  const close20 = closes.length > 20 ? closes.at(-21) : null;
  const close60 = closes.length > 60 ? closes.at(-61) : null;
  const ma20 = movingAverage(closes, 20);
  const ma50 = movingAverage(closes, 50);
  const ma200 = movingAverage(closes, 200);
  const rsi14 = rsi(closes, 14);
  const avgVol20 = movingAverage(volumes, 20);
  const latestVol = volumes.at(-1);

  const components = [
    { key: "return_20d", score: close20 ? percentileRank(latest / close20 - 1, -0.15, 0.2) : null, weight: 0.25 },
    { key: "return_60d", score: close60 ? percentileRank(latest / close60 - 1, -0.25, 0.35) : null, weight: 0.2 },
    { key: "ma20_position", score: ma20 ? (latest >= ma20 ? 80 : 30) : null, weight: 0.15 },
    { key: "ma50_position", score: ma50 ? (latest >= ma50 ? 80 : 30) : null, weight: 0.15 },
    { key: "ma200_position", score: ma200 ? (latest >= ma200 ? 80 : 30) : null, weight: 0.1 },
    { key: "rsi14", score: finite(rsi14) ? (rsi14 >= 70 ? 72 : rsi14 <= 30 ? 28 : percentileRank(rsi14, 30, 70)) : null, weight: 0.1 },
    { key: "volume_surge", score: avgVol20 && latestVol ? percentileRank(latestVol / avgVol20, 0.5, 2.0) : null, weight: 0.05 },
  ];

  let weighted = 0;
  let total = 0;
  const details = {};
  for (const component of components) {
    details[component.key] = round(component.score);
    if (!finite(component.score)) continue;
    weighted += component.score * component.weight;
    total += component.weight;
  }
  const score = total > 0 ? weighted / total : null;
  return {
    score_0_100: round(score),
    direction: !finite(score) ? "unavailable" : score >= 70 ? "constructive" : score <= 35 ? "stressed" : "neutral",
    coverage_ratio: round(total / components.reduce((sum, item) => sum + item.weight, 0), 2),
    basis: "local_1y_ohlcv_rsi_ma_momentum_volume_proxy",
    indicators: {
      latest_close: round(latest, 4),
      ma20: round(ma20, 4),
      ma50: round(ma50, 4),
      ma200: round(ma200, 4),
      rsi14: round(rsi14, 2),
      latest_volume: round(latestVol, 0),
      avg_volume_20d: round(avgVol20, 0),
      components: details,
    },
  };
}

function optionSignal(ticker, occIndex) {
  const occ = occIndex.get(ticker) ?? null;
  const proxy = occ?.options_activity_proxy ?? null;
  if (!finite(proxy?.score_0_100)) {
    return {
      score_0_100: null,
      direction: "unavailable",
      coverage_ratio: 0,
      basis: "occ_options_volume_missing",
      caveat: "OCC listed-options volume skew proxy requires an OCC volume-query row for this ticker/date.",
    };
  }
  return {
    score_0_100: proxy.score_0_100,
    direction: proxy.direction ?? "unavailable",
    coverage_ratio: occ.coverage_ratio ?? 0.65,
    basis: "occ_listed_options_volume_skew_proxy",
    source_date: occ.source_date ?? null,
    call_volume: proxy.call_volume ?? null,
    put_volume: proxy.put_volume ?? null,
    total_volume: proxy.total_volume ?? null,
    put_call_volume_ratio: proxy.put_call_volume_ratio ?? null,
    caveat: proxy.caveat ?? "OCC listed-options volume skew proxy only; not real options flow, OPRA, greeks, premium, sweeps, blocks, or buyer/seller direction.",
  };
}

function findFenokRowIndex() {
  const fenokSignals = readJson("computed/fenok_signals.json", {});
  const index = new Map();
  for (const row of fenokSignals.rows ?? []) {
    index.set(normalizeTicker(row.ticker), row);
  }
  return index;
}

function findFlowRowIndex() {
  const flow = readJson("computed/fenok_flow_proxies.json", {});
  const index = new Map();
  for (const row of flow.rows ?? []) {
    index.set(normalizeTicker(row.ticker), row);
  }
  return index;
}

function findNewsRowIndex() {
  const news = readJson("computed/fenok_news_tone_proxy.json", {});
  const index = new Map();
  for (const row of news.rows ?? []) {
    index.set(normalizeTicker(row.ticker), row);
  }
  return index;
}

function findOccOptionsRowIndex() {
  const occ = readJson("computed/fenok_occ_options_volume.json", {});
  const index = new Map();
  for (const row of occ.rows ?? []) {
    index.set(normalizeTicker(row.ticker), row);
  }
  return index;
}

function signalScore(signal) {
  return signal?.score_0_100 ?? null;
}

function buildRows(args) {
  const tickers = loadTickerUniverse(args);
  const fenokIndex = findFenokRowIndex();
  const flowIndex = findFlowRowIndex();
  const newsIndex = findNewsRowIndex();
  const occIndex = findOccOptionsRowIndex();
  const spyHistory = loadHistory(SPY_TICKER);

  return tickers.map((ticker) => {
    const fenok = fenokIndex.get(ticker) ?? {};
    const flow = flowIndex.get(ticker) ?? {};
    const news = newsIndex.get(ticker) ?? {};
    const history = loadHistory(ticker);
    const spyTracking = sp500TrackingSignal(history, spyHistory);
    const technicalIndicator = technicalIndicatorSignal(history);
    const optionsProxy = optionSignal(ticker, occIndex);

    const profitabilityScore = signalScore(fenok.signals?.profitability);
    const durabilityProfitabilityScore = signalScore(fenok.signals?.durability_profitability);
    const growthScore = signalScore(fenok.signals?.growth);
    const existingTechnicalFlowScore = signalScore(fenok.signals?.technical_flow);
    const upsidePotentialScore = fenok.signals?.upside_downside?.upside_score_0_100 ?? null;
    const downsidePressureScore = fenok.signals?.upside_downside?.downside_score_0_100 ?? null;

    return {
      ticker,
      company: fenok.company ?? ticker,
      as_of: fenok.as_of ?? null,
      market_scope: fenok.market_scope ?? null,
      source_families: [
        "computed/fenok_signals.json",
        "data/yf/finance/{TICKER}.json",
        "data/yf/finance/SPY.json",
        flow.ticker ? "computed/fenok_flow_proxies.json" : null,
        occIndex.has(ticker) ? "computed/fenok_occ_options_volume.json" : null,
      ].filter(Boolean),
      long_term: {
        profitabilityScore,
        durabilityProfitabilityScore,
        growthScore,
        upsidePotentialScore,
        downsidePressureScore,
        peerSimilarityScore: signalScore(fenok.signals?.market_similarity),
        sp500TrackingSimilarityScore: spyTracking.score_0_100,
        sp500TrackingSimilarity: spyTracking,
      },
      short_term: {
        technicalFlowScore: existingTechnicalFlowScore,
        technicalIndicatorProxyScore: technicalIndicator.score_0_100,
        technicalIndicatorProxy: technicalIndicator,
        netOptionsProxyScore: optionsProxy.score_0_100,
        netOptionsProxy: optionsProxy,
        offExchangeActivityProxyScore: flow.off_exchange_activity_proxy?.score_0_100 ?? null,
        offExchangeActivityProxy: flow.off_exchange_activity_proxy ?? null,
        shortPressureProxyScore: flow.short_pressure_proxy?.score_0_100 ?? null,
        shortPressureProxy: flow.short_pressure_proxy ?? null,
        directNewsToneProxyScore: news.direct_news_tone_proxy?.score_0_100 ?? null,
        directNewsToneProxy: news.direct_news_tone_proxy ?? {
          score_0_100: null,
          direction: "unavailable",
          coverage_ratio: 0,
          basis: "source_not_collected_or_rate_limited",
          caveat: "Social/news tone is missing for this ticker. Use direct corpus or approved GDELT/IR source only after source contract approval.",
        },
      },
      methodology_status: {
        copied_third_party_score: false,
        all_axes_represented: true,
        implemented_axes: [
          "profitability",
          "durability_profitability",
          "growth",
          "upside_potential",
          "downside_pressure",
          "peer_similarity",
          "sp500_tracking_similarity",
          "technical_indicator_proxy",
          "off_exchange_activity_proxy",
          "short_pressure_proxy",
          optionsProxy.score_0_100 == null ? null : "net_options_proxy",
        ].filter(Boolean),
        pending_axes: [
          optionsProxy.score_0_100 == null ? "net_options_proxy_requires_targeted_option_snapshot" : null,
          news.direct_news_tone_proxy?.score_0_100 == null ? "direct_news_tone_proxy_requires_source_or_rate_limit_retry" : null,
        ].filter(Boolean),
      },
    };
  });
}

function buildSummary(snapshot) {
  const fields = [
    "ticker",
    "company",
    "asOf",
    "profitabilityScore",
    "durabilityProfitabilityScore",
    "growthScore",
    "upsidePotentialScore",
    "downsidePressureScore",
    "peerSimilarityScore",
    "sp500TrackingSimilarityScore",
    "technicalFlowScore",
    "technicalIndicatorProxyScore",
    "netOptionsProxyScore",
    "offExchangeActivityProxyScore",
    "shortPressureProxyScore",
    "directNewsToneProxyScore",
  ];
  return {
    schema_version: 1,
    generated_at: snapshot.generated_at,
    source_file: OUTPUT_FILE,
    formula_version: snapshot.formula_version,
    public_surface_status: "private_admin_summary_not_public_mirror",
    fields,
    coverage: snapshot.coverage,
    rows: snapshot.rows.map((row) => [
      row.ticker,
      row.company,
      row.as_of,
      row.long_term.profitabilityScore,
      row.long_term.durabilityProfitabilityScore,
      row.long_term.growthScore,
      row.long_term.upsidePotentialScore,
      row.long_term.downsidePressureScore,
      row.long_term.peerSimilarityScore,
      row.long_term.sp500TrackingSimilarityScore,
      row.short_term.technicalFlowScore,
      row.short_term.technicalIndicatorProxyScore,
      row.short_term.netOptionsProxyScore,
      row.short_term.offExchangeActivityProxyScore,
      row.short_term.shortPressureProxyScore,
      row.short_term.directNewsToneProxyScore,
    ]),
  };
}

function buildCoverage(rows) {
  const axisGetters = {
    profitability: (row) => row.long_term.profitabilityScore,
    durability_profitability: (row) => row.long_term.durabilityProfitabilityScore,
    growth: (row) => row.long_term.growthScore,
    upside_potential: (row) => row.long_term.upsidePotentialScore,
    downside_pressure: (row) => row.long_term.downsidePressureScore,
    peer_similarity: (row) => row.long_term.peerSimilarityScore,
    sp500_tracking_similarity: (row) => row.long_term.sp500TrackingSimilarityScore,
    technical_flow: (row) => row.short_term.technicalFlowScore,
    technical_indicator_proxy: (row) => row.short_term.technicalIndicatorProxyScore,
    net_options_proxy: (row) => row.short_term.netOptionsProxyScore,
    off_exchange_activity_proxy: (row) => row.short_term.offExchangeActivityProxyScore,
    short_pressure_proxy: (row) => row.short_term.shortPressureProxyScore,
    direct_news_tone_proxy: (row) => row.short_term.directNewsToneProxyScore,
  };
  return {
    row_count: rows.length,
    axis_counts: Object.fromEntries(
      Object.entries(axisGetters).map(([key, getter]) => [key, rows.filter((row) => finite(getter(row))).length]),
    ),
  };
}

function mergeHistory(snapshot) {
  const history = readJson(HISTORY_FILE, {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    rows: [],
  });
  const current = snapshot.rows.map((row) => ({
    ticker: row.ticker,
    as_of: row.as_of,
    generated_at: snapshot.generated_at,
    sp500TrackingSimilarityScore: row.long_term.sp500TrackingSimilarityScore,
    technicalIndicatorProxyScore: row.short_term.technicalIndicatorProxyScore,
    netOptionsProxyScore: row.short_term.netOptionsProxyScore,
    offExchangeActivityProxyScore: row.short_term.offExchangeActivityProxyScore,
    shortPressureProxyScore: row.short_term.shortPressureProxyScore,
  }));
  const keys = new Set(current.map((row) => `${row.ticker}|${row.as_of}`));
  const kept = (history.rows ?? []).filter((row) => !keys.has(`${row.ticker}|${row.as_of}`));
  return {
    schema_version: 1,
    formula_version: FORMULA_VERSION,
    generated_at: snapshot.generated_at,
    rows: [...kept, ...current].sort((a, b) => (
      String(a.ticker).localeCompare(String(b.ticker)) || String(a.as_of).localeCompare(String(b.as_of))
    )),
  };
}

function build(args) {
  const generatedAt = isoNow();
  const rows = buildRows(args);
  const snapshot = {
    schema_version: 1,
    generated_at: generatedAt,
    formula_version: FORMULA_VERSION,
    source_files: [
      "computed/fenok_signals.json",
      "computed/fenok_flow_proxies.json",
      "yf/finance/{TICKER}.json",
      "yf/finance/SPY.json",
    ],
    public_surface_status: "private_admin_derived_only_not_public",
    raw_policy: {
      third_party_raw_public: false,
      full_public_mirror: false,
      copied_third_party_score_public: false,
      public_payload: null,
    },
    coverage: buildCoverage(rows),
    rows,
  };
  const summary = buildSummary(snapshot);
  const history = mergeHistory(snapshot);
  if (!args.noWrite) {
    writeJson(OUTPUT_FILE, snapshot);
    writeJson(SUMMARY_FILE, summary, { compact: true });
    writeJson(HISTORY_FILE, history);
  }
  return { snapshot, summary, history };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { snapshot } = build(args);
  console.log(JSON.stringify({
    generated_at: snapshot.generated_at,
    output_file: `data/${OUTPUT_FILE}`,
    summary_file: `data/${SUMMARY_FILE}`,
    history_file: `data/${HISTORY_FILE}`,
    wrote: !args.noWrite,
    coverage: snapshot.coverage,
    reference_rows: snapshot.rows.filter((row) => DEFAULT_REFERENCE_TICKERS.includes(row.ticker)).map((row) => ({
      ticker: row.ticker,
      sp500TrackingSimilarityScore: row.long_term.sp500TrackingSimilarityScore,
      technicalIndicatorProxyScore: row.short_term.technicalIndicatorProxyScore,
      netOptionsProxyScore: row.short_term.netOptionsProxyScore,
      offExchangeActivityProxyScore: row.short_term.offExchangeActivityProxyScore,
      shortPressureProxyScore: row.short_term.shortPressureProxyScore,
      pending_axes: row.methodology_status.pending_axes,
    })),
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}

export {
  alignReturns,
  buildCoverage,
  buildRows,
  correlation,
  sp500TrackingSignal,
  technicalIndicatorSignal,
};
