#!/usr/bin/env node
/**
 * fetch-sentiment.mjs — Daily sentiment series refresher
 *
 * Replaces the manual Google Apps Script path (cnn.gs / vix.gs) that left the
 * dashboard sentiment series frozen because there was NO fetch cron. Pulls the
 * same free sources and MERGES-BY-DATE into the existing arrays — today's date
 * is updated in place if present, otherwise appended and the array re-sorted.
 * History is NEVER overwritten.
 *
 * Targets (array of { date, ... } objects, written to BOTH the repo-root SSOT
 * `data/sentiment/` and the Next.js build mirror `100xfenok-next/public/data/sentiment/`):
 *   - cnn-fear-greed.json   {date, score}                (CNN proxy)
 *   - cnn-components.json    {date, market_momentum,...}  (CNN proxy, 7 components)
 *   - cnn-put-call.json      {date, value, rating}        (CNN proxy put/call data tail)
 *   - cnn-momentum.json      {date, value, rating}        (CNN proxy component tail)
 *   - cnn-strength.json      {date, value, rating}        (CNN proxy component tail)
 *   - cnn-breadth.json       {date, value, rating}        (CNN proxy component tail)
 *   - cnn-junk-bond.json     {date, value, rating}        (CNN proxy component tail)
 *   - cnn-safe-haven.json    {date, value, rating}        (CNN proxy component tail)
 *   - vix.json               {date, value}                (Yahoo ^VIX close)
 *   - move.json              {date, value}                (Yahoo ^MOVE close)
 *   - cftc-sp500.json        {date, long, short, net, openInterest} (CFTC COT)
 *   - crypto-fear-greed.json {date, value, classification}(alternative.me)
 *
 * Deferred:
 *   aaii.json (still spreadsheet/import based; no robust free JSON source)
 *
 * Resilience: each source is independent. A 429 / network failure / shape
 * change for one source logs an error and is skipped; other sources still
 * commit. Process exits non-zero ONLY if every source failed (so the workflow
 * surfaces a total outage but tolerates a partial one).
 *
 * Usage:
 *   node scripts/fetch-sentiment.mjs
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Canonical SSOT + the build-consumed mirror. The Next.js app serves
// `/data/sentiment/*` from public/data (see useDashboardData.ts / data-loader.ts),
// while data/sentiment/ is the source of truth the GAS scripts historically
// wrote. fetch-fred-banking.yml established the dual-write pattern; we follow it.
const OUTPUT_DIRS = [
  path.join(REPO_ROOT, 'data', 'sentiment'),
  path.join(REPO_ROOT, '100xfenok-next', 'public', 'data', 'sentiment'),
];

const CNN_PROXY_URL = 'https://fed-proxy.etloveaui.workers.dev/cnn';
const CRYPTO_FNG_URL = 'https://api.alternative.me/fng/?limit=1';
const YAHOO_VIX_SYMBOL = '^VIX';
const YAHOO_MOVE_SYMBOL = '^MOVE';
const CFTC_COT_URL = 'https://publicreporting.cftc.gov/resource/jun7-fc8e.json?market_and_exchange_names=S%26P%20500%20Consolidated%20-%20CHICAGO%20MERCANTILE%20EXCHANGE&$limit=1&$order=report_date_as_yyyy_mm_dd%20DESC';

const CNN_COMPONENT_TAIL_FILES = [
  ['market_momentum_sp500', 'cnn-momentum.json'],
  ['stock_price_strength', 'cnn-strength.json'],
  ['stock_price_breadth', 'cnn-breadth.json'],
  ['junk_bond_demand', 'cnn-junk-bond.json'],
  ['safe_haven_demand', 'cnn-safe-haven.json'],
];

const today = new Date().toISOString().slice(0, 10);

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function fetchJson(url, { headers = {}, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 160)}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`JSON parse failed: ${e.message} :: ${data.slice(0, 120)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
  });
}

// ─── Merge-by-date (cnn.gs / vix.gs semantics) ─────────────────────────────────

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Read the existing array from the FIRST output dir (the SSOT). Both mirrors
 * are kept identical, so the SSOT copy is authoritative for the merge base.
 */
function readExisting(fileName) {
  const ssotPath = path.join(OUTPUT_DIRS[0], fileName);
  try {
    const parsed = JSON.parse(fs.readFileSync(ssotPath, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Merge a single dated entry into an array: update in place if the date exists,
 * else append and re-sort ascending by date — exactly like cnn.gs/vix.gs.
 * Returns { array, action: 'updated' | 'appended', before, after }.
 */
function mergeByDate(existing, entry) {
  const arr = existing.slice();
  const before = arr.length;
  const idx = arr.findIndex((d) => d && d.date === entry.date);
  let action;
  if (idx >= 0) {
    arr[idx] = entry;
    action = 'updated';
  } else {
    arr.push(entry);
    arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    action = 'appended';
  }
  return { array: arr, action, before, after: arr.length };
}

function writeAll(fileName, array) {
  const json = JSON.stringify(array, null, 2) + '\n';
  for (const dir of OUTPUT_DIRS) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, fileName), json);
  }
}

// ─── Source handlers ────────────────────────────────────────────────────────────

async function runCnn() {
  const data = await fetchJson(CNN_PROXY_URL);
  const fg = data.fear_and_greed;
  if (!fg || typeof fg.score !== 'number') {
    throw new Error('CNN proxy missing fear_and_greed.score');
  }

  const results = [];

  // 1) cnn-fear-greed.json — {date, score: round1}
  {
    const entry = { date: today, score: round1(fg.score) };
    const r = mergeByDate(readExisting('cnn-fear-greed.json'), entry);
    writeAll('cnn-fear-greed.json', r.array);
    results.push({ file: 'cnn-fear-greed.json', ...r, sample: entry });
  }

  // 2) cnn-components.json — 7 component scores (match existing shape)
  {
    const c = {
      market_momentum: data.market_momentum_sp500,
      stock_strength: data.stock_price_strength,
      stock_breadth: data.stock_price_breadth,
      put_call: data.put_call_options,
      volatility: data.market_volatility_vix,
      safe_haven: data.safe_haven_demand,
      junk_bond: data.junk_bond_demand,
    };
    for (const [k, v] of Object.entries(c)) {
      if (!v || typeof v.score !== 'number') {
        throw new Error(`CNN proxy missing component score: ${k}`);
      }
    }
    const entry = {
      date: today,
      market_momentum: round1(c.market_momentum.score),
      stock_strength: round1(c.stock_strength.score),
      stock_breadth: round1(c.stock_breadth.score),
      put_call: round1(c.put_call.score),
      volatility: round1(c.volatility.score),
      safe_haven: round1(c.safe_haven.score),
      junk_bond: round1(c.junk_bond.score),
    };
    const r = mergeByDate(readExisting('cnn-components.json'), entry);
    writeAll('cnn-components.json', r.array);
    results.push({ file: 'cnn-components.json', ...r, sample: entry });
  }

  // 3) cnn-put-call.json — {date, value, rating}
  // The put/call ratio value is the latest point in put_call_options.data[].y
  // (a ratio like 0.58), and the per-point rating is data[].rating.
  {
    const pc = data.put_call_options;
    const series = Array.isArray(pc?.data) ? pc.data : [];
    const last = series.length ? series[series.length - 1] : null;
    if (!last || typeof last.y !== 'number') {
      throw new Error('CNN proxy missing put_call_options.data tail');
    }
    const entry = {
      date: today,
      value: Math.round(last.y * 100) / 100,
      rating: String(last.rating ?? pc.rating ?? '').toLowerCase(),
    };
    const r = mergeByDate(readExisting('cnn-put-call.json'), entry);
    writeAll('cnn-put-call.json', r.array);
    results.push({ file: 'cnn-put-call.json', ...r, sample: entry });
  }

  // 4) Individual CNN component files consumed by the legacy macro-monitor
  // detail charts. These used to depend on cnn-components.gs.
  for (const [componentKey, fileName] of CNN_COMPONENT_TAIL_FILES) {
    const component = data[componentKey];
    const series = Array.isArray(component?.data) ? component.data : [];
    const last = series.length ? series[series.length - 1] : null;
    if (!last || typeof last.y !== 'number') {
      throw new Error(`CNN proxy missing ${componentKey}.data tail`);
    }
    const entry = {
      date: today,
      value: Math.round(last.y * 100) / 100,
      rating: String(last.rating ?? component.rating ?? '').toLowerCase(),
    };
    const r = mergeByDate(readExisting(fileName), entry);
    writeAll(fileName, r.array);
    results.push({ file: fileName, ...r, sample: entry });
  }

  return results;
}

async function runYahooCloseSeries({ symbol, fileName, label }) {
  const now = Math.floor(Date.now() / 1000);
  const start = now - 15 * 24 * 60 * 60; // 15-day window, like vix.gs / move.gs
  const encodedSymbol = encodeURIComponent(symbol);
  const qs = `period1=${start}&period2=${now}&interval=1d`;
  const hosts = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?${qs}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?${qs}`,
  ];

  let json = null;
  let lastErr = null;
  for (const url of hosts) {
    try {
      json = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!json) throw lastErr ?? new Error(`${label}: all hosts failed`);

  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp;
  const closes = result?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(timestamps) || !Array.isArray(closes) || timestamps.length === 0) {
    throw new Error(`${label}: empty chart payload`);
  }

  // Build the new points, then merge each into the existing series. Yahoo's
  // 15-day window covers any recent gap, so a missed run self-heals.
  const newPoints = [];
  for (let i = 0; i < timestamps.length; i++) {
    if (closes[i] == null) continue;
    const d = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    newPoints.push({ date: d, value: Math.round(closes[i] * 100) / 100 });
  }
  if (newPoints.length === 0) throw new Error(`${label}: no non-null closes`);

  let arr = readExisting(fileName);
  let appended = 0;
  let updated = 0;
  let lastSample = null;
  for (const p of newPoints) {
    const r = mergeByDate(arr, p);
    arr = r.array;
    if (r.action === 'appended') appended++; else updated++;
    lastSample = p;
  }
  writeAll(fileName, arr);
  return [{
    file: fileName,
    action: appended ? 'appended' : 'updated',
    before: arr.length - appended,
    after: arr.length,
    appended,
    updated,
    sample: lastSample,
  }];
}

async function runVix() {
  return runYahooCloseSeries({ symbol: YAHOO_VIX_SYMBOL, fileName: 'vix.json', label: 'Yahoo VIX' });
}

async function runMove() {
  return runYahooCloseSeries({ symbol: YAHOO_MOVE_SYMBOL, fileName: 'move.json', label: 'Yahoo MOVE' });
}

async function runCftc() {
  const data = await fetchJson(CFTC_COT_URL);
  const latest = Array.isArray(data) ? data[0] : null;
  if (!latest) {
    throw new Error('CFTC COT: empty payload');
  }
  const date = String(latest.report_date_as_yyyy_mm_dd ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('CFTC COT: missing report_date_as_yyyy_mm_dd');
  }

  const long = Number.parseInt(latest.noncomm_positions_long_all ?? '0', 10);
  const short = Number.parseInt(latest.noncomm_positions_short_all ?? '0', 10);
  const openInterest = Number.parseInt(latest.open_interest_all ?? '0', 10);
  if (![long, short, openInterest].every(Number.isFinite)) {
    throw new Error('CFTC COT: invalid numeric fields');
  }

  const entry = {
    date,
    long,
    short,
    net: long - short,
    openInterest,
  };
  const r = mergeByDate(readExisting('cftc-sp500.json'), entry);
  writeAll('cftc-sp500.json', r.array);
  return [{ file: 'cftc-sp500.json', ...r, sample: entry }];
}

async function runCrypto() {
  const data = await fetchJson(CRYPTO_FNG_URL);
  const row = Array.isArray(data?.data) ? data.data[0] : null;
  if (!row || row.value == null) {
    throw new Error('alternative.me missing data[0].value');
  }
  // Use the source's own timestamp date (UTC) so the point lands on the day the
  // index was actually computed, matching the existing crypto-fear-greed.json.
  const ts = Number(row.timestamp);
  const srcDate = Number.isFinite(ts)
    ? new Date(ts * 1000).toISOString().slice(0, 10)
    : today;
  const entry = {
    date: srcDate,
    value: Number(row.value),
    classification: String(row.value_classification ?? ''),
  };
  const r = mergeByDate(readExisting('crypto-fear-greed.json'), entry);
  writeAll('crypto-fear-greed.json', r.array);
  return [{ file: 'crypto-fear-greed.json', ...r, sample: entry }];
}

// ─── Orchestration ──────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('fetch-sentiment.mjs');
  console.log(`  date    : ${today}`);
  console.log(`  outputs : ${OUTPUT_DIRS.map((d) => path.relative(REPO_ROOT, d)).join(', ')}`);
  console.log('='.repeat(60));

  const sources = [
    ['CNN (proxy)', runCnn],
    ['VIX (Yahoo)', runVix],
    ['MOVE (Yahoo)', runMove],
    ['CFTC COT', runCftc],
    ['Crypto (alternative.me)', runCrypto],
  ];

  let okCount = 0;
  let failCount = 0;

  for (const [label, fn] of sources) {
    try {
      const results = await fn();
      okCount++;
      for (const r of results) {
        const counts = r.appended != null
          ? `appended ${r.appended}, updated ${r.updated}`
          : `${r.action} (len ${r.before}→${r.after})`;
        console.log(`✅ ${label} → ${r.file}: ${counts}`);
        console.log(`   sample: ${JSON.stringify(r.sample)}`);
      }
    } catch (e) {
      failCount++;
      console.error(`⚠️  ${label} FAILED (skipped, others continue): ${e.message}`);
    }
  }

  console.log('─'.repeat(60));
  console.log(`Done: ${okCount} source group(s) ok, ${failCount} failed.`);

  if (okCount === 0) {
    console.error('❌ All sources failed — exiting non-zero.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
