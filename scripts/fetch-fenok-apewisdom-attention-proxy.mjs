#!/usr/bin/env node
/**
 * Fetch ApeWisdom stock mention aggregates and build a private-derived Fenok
 * social-attention proxy.
 *
 * Raw API pages stay under _private/admin/fenok-flow/apewisdom. The computed
 * artifact is internal by default and must not be mirrored publicly.
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dataRoot = path.join(repoRoot, "data");
const privateRoot = path.join(repoRoot, "_private", "admin", "fenok-flow", "apewisdom");

const DEFAULT_FILTER = "all-stocks";
const SCHEMA_VERSION = "fenok-social-attention-proxy/v0.1";
const FORMULA_VERSION = "fenok-social-attention-v0.1-apewisdom";
const OUTPUT_FILE = "computed/fenok_social_attention_proxy.json";
const HISTORY_FILE = "computed/fenok_social_attention_proxy_history.json";

const SUPPORTED_FILTERS = new Set([
  "all",
  "all-stocks",
  "all-crypto",
  "4chan",
  "CryptoCurrency",
  "CryptoCurrencies",
  "Bitcoin",
  "SatoshiStreetBets",
  "CryptoMoonShots",
  "CryptoMarkets",
  "stocks",
  "wallstreetbets",
  "options",
  "WallStreetbetsELITE",
  "Wallstreetbetsnew",
  "SPACs",
  "investing",
  "Daytrading",
]);

function parseArgs(argv) {
  const args = {
    filter: DEFAULT_FILTER,
    maxPages: 10,
    tickers: "",
    limit: 0,
    noFetch: false,
    noWrite: false,
    inputFile: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i] ?? "";
    if (arg === "--filter") args.filter = next();
    else if (arg === "--max-pages") args.maxPages = Number(next()) || args.maxPages;
    else if (arg === "--tickers") args.tickers = next();
    else if (arg === "--limit") args.limit = Number(next()) || 0;
    else if (arg === "--no-fetch") args.noFetch = true;
    else if (arg === "--no-write") args.noWrite = true;
    else if (arg === "--input-file") args.inputFile = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!SUPPORTED_FILTERS.has(args.filter)) throw new Error(`Unsupported ApeWisdom filter: ${args.filter}`);
  return args;
}

function isoNow() {
  return new Date().toISOString();
}

function ymdNow() {
  const d = new Date();
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
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
  return abs;
}

function writePrivateJson(abs, payload) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeTicker(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replaceAll(",", "").trim());
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function apeWisdomUrl(filter, page) {
  if (page <= 1) return `https://apewisdom.io/api/v1.0/filter/${encodeURIComponent(filter)}`;
  return `https://apewisdom.io/api/v1.0/filter/${encodeURIComponent(filter)}/page/${page}`;
}

function fetchJson(url, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "FenokResearch/1.0" } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(new Error(`Invalid JSON: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout after ${timeoutMs}ms`)));
  });
}

function loadTickerUniverse({ tickers, limit }) {
  let out = [];
  if (tickers) {
    out = tickers.split(",").map(normalizeTicker).filter(Boolean);
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

function normalizeApeRows(pages) {
  const rows = [];
  for (const page of pages) {
    for (const row of page.results ?? []) {
      const ticker = normalizeTicker(row.ticker);
      if (!ticker) continue;
      rows.push({
        rank: numberValue(row.rank),
        ticker,
        name: String(row.name ?? "").trim(),
        mentions: numberValue(row.mentions),
        upvotes: numberValue(row.upvotes),
        rank_24h_ago: numberValue(row.rank_24h_ago),
        mentions_24h_ago: numberValue(row.mentions_24h_ago),
      });
    }
  }
  return rows;
}

function attentionScoreFromRank(rank, count) {
  if (!Number.isFinite(rank) || !Number.isFinite(count) || count <= 1) return null;
  return round(clamp(100 - ((rank - 1) / (count - 1)) * 100), 2);
}

function momentumScore({ mentions, mentions_24h_ago: previousMentions }) {
  if (!Number.isFinite(mentions) || !Number.isFinite(previousMentions)) return null;
  const scale = Math.max(1, Math.sqrt(previousMentions + 1));
  return round(clamp(50 + 20 * Math.tanh((mentions - previousMentions) / scale)), 2);
}

function buildRows({ universeTickers, apeRows, count, sourceDate }) {
  const byTicker = new Map(apeRows.map((row) => [row.ticker, row]));
  return universeTickers.map((ticker) => {
    const row = byTicker.get(ticker) ?? null;
    const hasRow = Boolean(row);
    const score = hasRow ? attentionScoreFromRank(row.rank, count) : null;
    return {
      ticker,
      as_of: sourceDate,
      source_date: sourceDate,
      confidence: hasRow ? "medium" : "low",
      coverage_ratio: hasRow ? 1 : 0,
      source_family: "ApeWisdom all-stocks aggregate",
      caveat_code: "attention_proxy_not_sentiment",
      social_attention_proxy: {
        score_0_100: score,
        momentum_score_0_100: hasRow ? momentumScore(row) : null,
        rank: hasRow ? row.rank : null,
        mentions: hasRow ? row.mentions : null,
        upvotes: hasRow ? row.upvotes : null,
        rank_24h_ago: hasRow ? row.rank_24h_ago : null,
        mentions_24h_ago: hasRow ? row.mentions_24h_ago : null,
        caveat: "ApeWisdom ticker-level mention aggregate; attention proxy only, not sentiment, bullishness, or Reddit raw corpus.",
      },
    };
  });
}

async function loadPages({ filter, maxPages, inputFile, noFetch, cacheDate }) {
  if (inputFile) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(inputFile), "utf8"));
    return Array.isArray(payload) ? payload : [payload];
  }
  const pages = [];
  let totalPages = maxPages;
  for (let page = 1; page <= totalPages && page <= maxPages; page++) {
    const cachePath = path.join(privateRoot, filter, cacheDate, `page-${page}.json`);
    if (fs.existsSync(cachePath)) {
      pages.push(JSON.parse(fs.readFileSync(cachePath, "utf8")));
    } else {
      if (noFetch) break;
      const payload = await fetchJson(apeWisdomUrl(filter, page));
      writePrivateJson(cachePath, payload);
      pages.push(payload);
    }
    const last = pages[pages.length - 1];
    totalPages = Math.min(maxPages, Number(last.pages) || maxPages);
  }
  return pages;
}

function buildSnapshot({ filter, pages, rows, sourceDate, generatedAt }) {
  const firstPage = pages[0] ?? {};
  const count = Number(firstPage.count) || rows.length;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    formula_version: FORMULA_VERSION,
    source: {
      provider: "ApeWisdom",
      filter,
      source_url: apeWisdomUrl(filter, 1),
      source_date: sourceDate,
      pages_collected: pages.length,
      reported_count: count,
    },
    public_surface_status: "admin_private_derived_only_not_public",
    raw_policy: {
      external_collection: true,
      raw_cache_public: false,
      third_party_raw_public: false,
      raw_cache_path: path.relative(repoRoot, path.join(privateRoot, filter, sourceDate)),
      public_payload: null,
    },
    semantics: {
      socialAttentionProxyScore: "Higher means a higher ApeWisdom mention rank within the selected aggregate feed; not sentiment or direction.",
      socialAttentionMomentumScore: "Higher means mentions increased versus ApeWisdom's 24h-ago mention field.",
    },
    coverage: {
      row_count: rows.length,
      with_attention: rows.filter((row) => row.social_attention_proxy.score_0_100 != null).length,
      source_reported_count: count,
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
  const incoming = snapshot.rows
    .filter((row) => row.social_attention_proxy.score_0_100 != null)
    .map((row) => ({
      ticker: row.ticker,
      as_of: row.as_of,
      source_date: row.source_date,
      confidence: row.confidence,
      socialAttentionProxyScore: row.social_attention_proxy.score_0_100,
      socialAttentionMomentumScore: row.social_attention_proxy.momentum_score_0_100,
      mentions: row.social_attention_proxy.mentions,
      rank: row.social_attention_proxy.rank,
    }));
  const incomingKeys = new Set(incoming.map((row) => `${row.ticker}|${row.source_date}`));
  const kept = (history.rows ?? []).filter((row) => !incomingKeys.has(`${row.ticker}|${row.source_date}`));
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
  const cacheDate = ymdNow();
  const pages = await loadPages({
    filter: args.filter,
    maxPages: args.maxPages,
    inputFile: args.inputFile,
    noFetch: args.noFetch,
    cacheDate,
  });
  const firstPage = pages[0] ?? {};
  const apeRows = normalizeApeRows(pages);
  const tickers = loadTickerUniverse(args);
  const sourceDate = cacheDate;
  const rows = buildRows({
    universeTickers: tickers,
    apeRows,
    count: Number(firstPage.count) || apeRows.length,
    sourceDate,
  });
  const snapshot = buildSnapshot({
    filter: args.filter,
    pages,
    rows,
    sourceDate,
    generatedAt: isoNow(),
  });
  const history = mergeHistory(snapshot);
  if (!args.noWrite) {
    writeJson(OUTPUT_FILE, snapshot);
    writeJson(HISTORY_FILE, history);
  }
  return {
    output_file: `data/${OUTPUT_FILE}`,
    history_file: `data/${HISTORY_FILE}`,
    wrote: !args.noWrite,
    filter: args.filter,
    pages_collected: pages.length,
    coverage: snapshot.coverage,
    sample_rows: snapshot.rows
      .filter((row) => row.social_attention_proxy.score_0_100 != null)
      .slice(0, 8),
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
  attentionScoreFromRank,
  buildRows,
  momentumScore,
  normalizeApeRows,
  parseArgs,
};
