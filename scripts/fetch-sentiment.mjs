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
 * Resilience: each source is independent. Transport/HTTP failures retain a
 * sha256-bound LKG and join the retry set with exit 0. Missing LKG, systemic
 * outage, or auth/decode/schema corruption exits non-zero. Recovery promotion
 * requires an attempt-1 natural schedule run whose source date advances.
 *
 * Usage:
 *   node scripts/fetch-sentiment.mjs
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  atomicWrite,
  buildAttemptRow,
  buildSingleLaneShard,
  classifyHttpResponse,
  foldWorstTuples,
  threwTuple,
  transportError,
  tupleStatus,
  writeJsonAtomic,
} from './lib/data-supply-attempt-shard.mjs';
import {
  LaneLkgStore,
  classifyLkgFailure,
  isNaturalScheduleRun,
} from './lib/data-supply-lkg-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// Canonical SSOT + the build-consumed mirror. The Next.js app serves
// `/data/sentiment/*` from public/data (see useDashboardData.ts / data-loader.ts),
// while data/sentiment/ is the source of truth the GAS scripts historically
// wrote. fetch-fred-banking.yml established the dual-write pattern; we follow it.
const DEFAULT_OUTPUT_DIRS = [
  path.join(REPO_ROOT, 'data', 'sentiment'),
  path.join(REPO_ROOT, '100xfenok-next', 'public', 'data', 'sentiment'),
];

export const SENTIMENT_LKG_SOURCE_FILES = Object.freeze({
  cnn: Object.freeze([
    'cnn-fear-greed.json',
    'cnn-components.json',
    'cnn-put-call.json',
    'cnn-momentum.json',
    'cnn-strength.json',
    'cnn-breadth.json',
    'cnn-junk-bond.json',
    'cnn-safe-haven.json',
  ]),
  cftc: Object.freeze(['cftc-sp500.json']),
  vix: Object.freeze(['vix.json']),
  move: Object.freeze(['move.json']),
});
export const SENTIMENT_LKG_SOURCE_KEYS = Object.freeze(Object.keys(SENTIMENT_LKG_SOURCE_FILES));
const SENTIMENT_BUNDLE_SCHEMA = 'sentiment-source-bundle/v1';

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
let sentimentAttemptTuples = [];

export function recordSentimentAttemptTuple(tuple) {
  sentimentAttemptTuples.push(tuple);
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { headers = {}, timeoutMs = 30000 } = {}) {
  const MAX_RETRIES = 2;
  const BACKOFFS_MS = [1000, 2000, 4000];
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BACKOFFS_MS[Math.min(attempt - 1, BACKOFFS_MS.length - 1)] ?? 1000;
        console.error(`[retry] ${url} attempt ${attempt + 1}/${MAX_RETRIES + 1} after ${delay}ms`);
        await sleepMs(delay);
      }
      const response = await new Promise((resolve, reject) => {
        const req = https.get(url, { headers }, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode ?? 0, body: data });
          });
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs, () => {
          req.destroy(Object.assign(new Error(`timeout after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
        });
      });
      const classified = classifyHttpResponse(response);
      if (classified.attempt.execution === 'returned' && classified.attempt.decode === 'ok') {
        recordSentimentAttemptTuple(classified.attempt);
        return classified.document;
      }
      throw Object.assign(new Error(classified.reason), { attemptTuple: classified.attempt });
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) continue;
      const tuple = err.attemptTuple ?? threwTuple(transportError(err) ? 'transport' : 'unexpected');
      recordSentimentAttemptTuple(tuple);
      err.attemptRecorded = true;
    }
  }
  throw lastError;
}

// ─── Merge-by-date (cnn.gs / vix.gs semantics) ─────────────────────────────────

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Read the existing array from the FIRST output dir (the SSOT). Both mirrors
 * are kept identical, so the SSOT copy is authoritative for the merge base.
 */
function readExisting(fileName, outputDirs = DEFAULT_OUTPUT_DIRS) {
  const ssotPath = path.join(outputDirs[0], fileName);
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

function writeAll(fileName, array, outputDirs = DEFAULT_OUTPUT_DIRS) {
  const json = JSON.stringify(array, null, 2) + '\n';
  for (const dir of outputDirs) {
    fs.mkdirSync(dir, { recursive: true });
    atomicWrite(path.join(dir, fileName), json);
  }
}

// ─── Source handlers ────────────────────────────────────────────────────────────

async function runCnn(readExistingFn = readExisting) {
  const data = await fetchJson(CNN_PROXY_URL);
  const fg = data.fear_and_greed;
  if (!fg || typeof fg.score !== 'number') {
    throw new Error('CNN proxy missing fear_and_greed.score');
  }

  const results = [];

  // 1) cnn-fear-greed.json — {date, score: round1}
  {
    const entry = { date: today, score: round1(fg.score) };
    const r = mergeByDate(readExistingFn('cnn-fear-greed.json'), entry);
    results.push({ file: 'cnn-fear-greed.json', array: r.array, ...r, sample: entry });
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
    const r = mergeByDate(readExistingFn('cnn-components.json'), entry);
    results.push({ file: 'cnn-components.json', array: r.array, ...r, sample: entry });
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
    const r = mergeByDate(readExistingFn('cnn-put-call.json'), entry);
    results.push({ file: 'cnn-put-call.json', array: r.array, ...r, sample: entry });
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
    const r = mergeByDate(readExistingFn(fileName), entry);
    results.push({ file: fileName, array: r.array, ...r, sample: entry });
  }

  return results;
}

async function runYahooCloseSeries({ symbol, fileName, label, readExistingFn = readExisting }) {
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

  let arr = readExistingFn(fileName);
  let appended = 0;
  let updated = 0;
  let lastSample = null;
  for (const p of newPoints) {
    const r = mergeByDate(arr, p);
    arr = r.array;
    if (r.action === 'appended') appended++; else updated++;
    lastSample = p;
  }
  return [{
    file: fileName,
    array: arr,
    action: appended ? 'appended' : 'updated',
    before: arr.length - appended,
    after: arr.length,
    appended,
    updated,
    sample: lastSample,
  }];
}

async function runVix(readExistingFn = readExisting) {
  return runYahooCloseSeries({ symbol: YAHOO_VIX_SYMBOL, fileName: 'vix.json', label: 'Yahoo VIX', readExistingFn });
}

async function runMove(readExistingFn = readExisting) {
  return runYahooCloseSeries({ symbol: YAHOO_MOVE_SYMBOL, fileName: 'move.json', label: 'Yahoo MOVE', readExistingFn });
}

async function runCftc(readExistingFn = readExisting) {
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
  const r = mergeByDate(readExistingFn('cftc-sp500.json'), entry);
  return [{ file: 'cftc-sp500.json', array: r.array, ...r, sample: entry }];
}

async function runCrypto(readExistingFn = readExisting) {
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
  const r = mergeByDate(readExistingFn('crypto-fear-greed.json'), entry);
  return [{ file: 'crypto-fear-greed.json', array: r.array, ...r, sample: entry }];
}

// ─── Orchestration ──────────────────────────────────────────────────────────────

function validSeriesArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((row) => (
    row && typeof row === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
  ));
}

function sourceAsOfFromFiles(files) {
  const dates = Object.values(files)
    .flatMap((rows) => rows.map((row) => row.date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

function buildSourceBundle(key, fileNames, results) {
  const byFile = new Map(results.map((result) => [result.file, result.array]));
  if (byFile.size !== fileNames.length || fileNames.some((fileName) => !validSeriesArray(byFile.get(fileName)))) {
    throw new Error(`${key}: incomplete or invalid normalized source bundle`);
  }
  const files = Object.fromEntries(fileNames.map((fileName) => [fileName, byFile.get(fileName)]));
  const sourceAsOf = sourceAsOfFromFiles(files);
  if (!sourceAsOf) throw new Error(`${key}: source bundle has no valid source date`);
  return {
    schema_version: SENTIMENT_BUNDLE_SCHEMA,
    source_key: key,
    source_as_of: sourceAsOf,
    files,
  };
}

function validSourceBundle(key, fileNames, document) {
  if (document?.schema_version !== SENTIMENT_BUNDLE_SCHEMA || document?.source_key !== key
    || !document.files || typeof document.files !== 'object' || Array.isArray(document.files)) return false;
  const actualNames = Object.keys(document.files);
  if (actualNames.length !== fileNames.length || fileNames.some((fileName) => !validSeriesArray(document.files[fileName]))) {
    return false;
  }
  return sourceAsOfFromFiles(document.files) === document.source_as_of;
}

function serializeBundle(bundle) {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

function tupleReason(tuple) {
  if (tuple?.execution === 'threw') {
    return tuple.exception_kind === 'transport' ? 'transport_error' : 'unexpected_error';
  }
  if (tuple?.execution !== 'returned') return 'unexpected_error';
  if (tuple.http_status === 401 || tuple.http_status === 403) return 'auth_error';
  if (tuple.http_status === 429 || tuple.rate_limited === true) return 'rate_limited';
  if (tuple.http_status < 200 || tuple.http_status >= 300) return 'http_error';
  if (tuple.decode === 'error') return 'decode_error';
  if (tuple.payload === 'empty') return 'empty_payload';
  if (tuple.assertions?.some((assertion) => assertion.passed === false)) return 'schema_drift';
  return tupleStatus(tuple) === 'ready' ? 'ok' : 'unexpected_error';
}

function validateControlledFailureSource(value, eventName, sources) {
  if (!value) return null;
  if (eventName !== 'workflow_dispatch') throw new Error('controlled failure requires workflow_dispatch');
  if (!sources.some((source) => source.lkg === true && source.key === value)) {
    throw new Error(`unknown controlled sentiment source: ${value}`);
  }
  return value;
}

function defaultSources() {
  return [
    { key: 'cnn', label: 'CNN (proxy)', fileNames: SENTIMENT_LKG_SOURCE_FILES.cnn, lkg: true, run: runCnn },
    { key: 'cftc', label: 'CFTC COT', fileNames: SENTIMENT_LKG_SOURCE_FILES.cftc, lkg: true, run: runCftc },
    { key: 'vix', label: 'VIX (Yahoo)', fileNames: SENTIMENT_LKG_SOURCE_FILES.vix, lkg: true, run: runVix },
    { key: 'move', label: 'MOVE (Yahoo)', fileNames: SENTIMENT_LKG_SOURCE_FILES.move, lkg: true, run: runMove },
    { key: 'crypto', label: 'Crypto (alternative.me)', fileNames: ['crypto-fear-greed.json'], lkg: false, run: runCrypto },
  ];
}

function currentBundlePath(repoRoot, key) {
  return path.join(repoRoot, 'data', 'admin', 'sentiment', 'current', `${key}.json`);
}

function currentBundleRelativePath(key) {
  return `data/admin/sentiment/current/${key}.json`;
}

function bundleArtifact(repoRoot, source) {
  return {
    key: source.key,
    canonicalPath: currentBundlePath(repoRoot, source.key),
    validateDocument: (document) => validSourceBundle(source.key, source.fileNames, document),
    sourceAsOf: (document) => document?.source_as_of ?? null,
  };
}

function bundleCandidate(source, bundle, serialized) {
  return {
    key: source.key,
    currentRelativePath: currentBundleRelativePath(source.key),
    payloadBytes: Buffer.from(serialized),
    sourceAsOf: bundle.source_as_of,
    validateDocument: (document) => validSourceBundle(source.key, source.fileNames, document),
    deriveSourceAsOf: (document) => document?.source_as_of ?? null,
  };
}

function publishSourceResults(results, outputDirs) {
  for (const result of results) writeAll(result.file, result.array, outputDirs);
}

function bootstrapCurrentBundle(repoRoot, source, outputDirs) {
  const files = Object.fromEntries(source.fileNames.map((fileName) => [fileName, readExisting(fileName, outputDirs)]));
  if (source.fileNames.some((fileName) => !validSeriesArray(files[fileName]))) return false;
  const bundle = {
    schema_version: SENTIMENT_BUNDLE_SCHEMA,
    source_key: source.key,
    source_as_of: sourceAsOfFromFiles(files),
    files,
  };
  if (!validSourceBundle(source.key, source.fileNames, bundle)) return false;
  atomicWrite(currentBundlePath(repoRoot, source.key), serializeBundle(bundle));
  return true;
}

export async function runSentiment({
  repoRoot = REPO_ROOT,
  outputDirs = [
    path.join(repoRoot, 'data', 'sentiment'),
    path.join(repoRoot, '100xfenok-next', 'public', 'data', 'sentiment'),
  ],
  sources = defaultSources(),
  attemptShardPath = path.join(repoRoot, 'data', 'admin', 'data-supply-state', 'detection-attempts', 'sentiment.json'),
  observedAt = new Date().toISOString(),
  attemptId = `gh-${process.env.GITHUB_RUN_ID ?? Date.now()}-${process.env.GITHUB_RUN_ATTEMPT ?? 1}-sentiment`,
  runId = process.env.GITHUB_RUN_ID || 'local',
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || 'local',
  controlledFailureSource = process.env.INPUT_CONTROLLED_FAILURE_SOURCE || '',
  quiet = false,
} = {}) {
  sentimentAttemptTuples = [];
  const injectedSource = validateControlledFailureSource(controlledFailureSource.trim(), eventName, sources);
  const run = { runId: String(runId), runAttempt: Number(runAttempt), eventName, observedAt };
  const lkgStore = new LaneLkgStore({ repoRoot, laneId: 'sentiment' });
  const trackedSources = sources.filter((source) => source.lkg === true);
  if (!quiet) {
    console.log('='.repeat(60));
    console.log('fetch-sentiment.mjs');
    console.log(`  date    : ${today}`);
    console.log(`  outputs : ${outputDirs.map((d) => path.relative(repoRoot, d)).join(', ')}`);
    console.log('='.repeat(60));
  }

  let okCount = 0;
  let failCount = 0;
  const failedTracked = [];
  const recoveredSources = [];
  const classifications = [];
  const sourceOutcomes = [];

  for (const source of sources) {
    const tupleCountBefore = sentimentAttemptTuples.length;
    try {
      if (source.key === injectedSource) {
        recordSentimentAttemptTuple(threwTuple('transport'));
        throw new Error('controlled failure');
      }
      const readExistingFn = (fileName) => readExisting(fileName, outputDirs);
      const results = await source.run(readExistingFn);
      const sourceTuples = sentimentAttemptTuples.slice(tupleCountBefore);
      if (sourceTuples.length === 0) throw new Error('source returned without current-attempt evidence');
      if (sourceTuples.some((tuple) => tupleStatus(tuple) !== 'ready')) {
        throw new Error(tupleReason(foldWorstTuples(sourceTuples)));
      }

      if (source.lkg === true) {
        const bundle = buildSourceBundle(source.key, source.fileNames, results);
        const serialized = serializeBundle(bundle);
        const candidate = bundleCandidate(source, bundle, serialized);
        const before = lkgStore.stateSnapshot().items[source.key];
        if (before?.retry === true && !isNaturalScheduleRun(run)) {
          failedTracked.push({ source, reason: 'recovery_requires_schedule', requestFailed: false });
          classifications.push({ degraded: true, corrupt: false, exitCode: 0 });
          sourceOutcomes.push({ key: source.key, status: 'degraded', reason: 'recovery_requires_schedule' });
          failCount++;
          continue;
        }
        if (lkgStore.promotableCandidates([candidate], run).length === 0) {
          failedTracked.push({ source, reason: 'recovery_not_advanced', requestFailed: false });
          classifications.push({ degraded: true, corrupt: false, exitCode: 0 });
          sourceOutcomes.push({ key: source.key, status: 'degraded', reason: 'recovery_not_advanced' });
          failCount++;
          continue;
        }
        publishSourceResults(results, outputDirs);
        atomicWrite(currentBundlePath(repoRoot, source.key), serialized);
        const success = lkgStore.recordSuccess({ artifacts: [candidate], run });
        if (success.state.items[source.key]?.recovered_at === observedAt) recoveredSources.push(source.key);
      } else {
        publishSourceResults(results, outputDirs);
      }
      okCount++;
      sourceOutcomes.push({ key: source.key, status: 'ready', reason: 'ok' });
      for (const r of results) {
        const counts = r.appended != null
          ? `appended ${r.appended}, updated ${r.updated}`
          : `${r.action} (len ${r.before}→${r.after})`;
        if (!quiet) {
          console.log(`✅ ${source.label} → ${r.file}: ${counts}`);
          console.log(`   sample: ${JSON.stringify(r.sample)}`);
        }
      }
    } catch (e) {
      const sourceTuples = sentimentAttemptTuples.slice(tupleCountBefore);
      if (sourceTuples.length === 0 || sourceTuples.every((tuple) => tupleStatus(tuple) === 'ready')) {
        recordSentimentAttemptTuple(threwTuple('unexpected'));
      }
      failCount++;
      const failureTuple = foldWorstTuples(sentimentAttemptTuples.slice(tupleCountBefore));
      const reason = source.key === injectedSource ? 'controlled_failure' : tupleReason(failureTuple);
      sourceOutcomes.push({ key: source.key, status: 'failed', reason });
      if (source.lkg === true) {
        bootstrapCurrentBundle(repoRoot, source, outputDirs);
        const failure = lkgStore.recordFailure({ artifacts: [bundleArtifact(repoRoot, source)], run, reason });
        const classification = classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg });
        failedTracked.push({ source, reason, requestFailed: source.key !== injectedSource });
        classifications.push(classification);
      }
      if (!quiet) console.error(`⚠️  ${source.label} FAILED (retained, others continue): ${e.message}`);
    }
  }

  if (sentimentAttemptTuples.length === 0) recordSentimentAttemptTuple(threwTuple('unexpected'));
  let tuple = foldWorstTuples(sentimentAttemptTuples);
  if (tupleStatus(tuple) === 'ready') {
    tuple = { ...tuple, assertions: [{ id: 'series_array', passed: true }] };
  }
  const row = buildAttemptRow({ laneId: 'sentiment', memberId: null, observedAt, attemptId, tuple });
  const shard = buildSingleLaneShard({ laneId: 'sentiment', row });
  writeJsonAtomic(attemptShardPath, shard);

  const naturalTracked = trackedSources.filter((source) => source.key !== injectedSource);
  const naturalFailures = failedTracked.filter((failure) => failure.requestFailed).map((failure) => failure.source.key);
  const systemicOutage = naturalTracked.length > 0 && naturalTracked.every((source) => naturalFailures.includes(source.key));
  const corrupt = systemicOutage || classifications.some((classification) => classification.corrupt);
  const trackedOk = failedTracked.length === 0;
  const retrySet = lkgStore.stateSnapshot().retry_set;
  const reason = failedTracked[0]?.reason ?? 'ok';

  if (!quiet) {
    console.log('─'.repeat(60));
    console.log(`Done: ${okCount} source group(s) ok, ${failCount} failed.`);
    console.log(JSON.stringify({ attempt: row }));
  }
  return {
    ok: trackedOk,
    reason,
    okCount,
    failCount,
    row,
    shard,
    retrySet,
    recoveredSources,
    sourceOutcomes,
    degraded: !trackedOk && !corrupt,
    corrupt: !trackedOk && corrupt,
    exitCode: trackedOk ? 0 : (corrupt ? 2 : 0),
  };
}

async function main() {
  const result = await runSentiment();
  if (!result.ok) {
    const prefix = result.degraded ? '[degraded]' : '[corrupt]';
    const message = `${prefix} sentiment ${result.reason}; retry set: ${result.retrySet.join(', ') || 'none'}`;
    if (result.degraded) console.log(message);
    else console.error(message);
    process.exitCode = result.exitCode;
    return;
  }
  console.log(`Saved ${result.okCount} sentiment source group(s) and current-attempt evidence${result.recoveredSources.length ? `; recovered from LKG: ${result.recoveredSources.join(', ')}` : ''}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) main().catch((err) => {
  console.error('Fatal:', err);
  process.exitCode = 1;
});
