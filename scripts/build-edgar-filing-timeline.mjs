#!/usr/bin/env node
/**
 * SEC EDGAR filing timeline builder.
 *
 * Phase 1 is deliberately small-batch: generate original-only filing rows for
 * a limited stock universe, while preserving any existing Korean summary rows.
 *
 * Output:
 *   data/edgar/company_tickers.json
 *   data/edgar-korean-summaries/index.json
 *   data/edgar-korean-summaries/by-ticker/{ticker}.json
 *   100xfenok-next/public/data/edgar-korean-summaries/{index,by-ticker/*}.json
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

const ANALYZER_PATH = path.join(ROOT, "data/global-scouter/core/stocks_analyzer.json");
const EDGAR_CACHE_PATH = path.join(ROOT, "data/edgar/company_tickers.json");
const SUMMARY_ROOT = path.join(ROOT, "data/edgar-korean-summaries");
const PUBLIC_SUMMARY_ROOT = path.join(ROOT, "100xfenok-next/public/data/edgar-korean-summaries");
const SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions";
const DEFAULT_FORMS = ["10-K", "10-Q", "8-K", "20-F", "6-K"];
const DEFAULT_LIMIT = 50;
const DEFAULT_FILINGS_PER_TICKER = 12;
const DEFAULT_SLEEP_SECONDS = 0.6;
const USER_AGENT =
  process.env.SEC_USER_AGENT ??
  "100xFenok EDGAR filing timeline builder/1.0 (contact: no-reply@100xfenok.local)";

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    filingsPerTicker: DEFAULT_FILINGS_PER_TICKER,
    forms: DEFAULT_FORMS,
    sleep: DEFAULT_SLEEP_SECONDS,
    tickers: [],
    fullUniverse: false,
    planOnly: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--limit") {
      args.limit = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--filings-per-ticker") {
      args.filingsPerTicker = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--forms") {
      args.forms = next.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
      index += 1;
    } else if (arg === "--sleep") {
      args.sleep = Number.parseFloat(next);
      index += 1;
    } else if (arg === "--tickers") {
      args.tickers = next.split(",").map(normalizeTicker).filter(Boolean);
      index += 1;
    } else if (arg === "--full-universe") {
      args.fullUniverse = true;
    } else if (arg === "--plan-only") {
      args.planOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 0) args.limit = DEFAULT_LIMIT;
  if (!Number.isFinite(args.filingsPerTicker) || args.filingsPerTicker < 1) {
    args.filingsPerTicker = DEFAULT_FILINGS_PER_TICKER;
  }
  if (!Number.isFinite(args.sleep) || args.sleep < 0) args.sleep = DEFAULT_SLEEP_SECONDS;
  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/build-edgar-filing-timeline.mjs [options]

Options:
  --tickers AAPL,NVDA       explicit ticker list
  --limit 50               max universe tickers for phase-1 default
  --full-universe          ignore --limit and scan the full stock universe
  --filings-per-ticker 12  max newly discovered pending filings per ticker
  --forms 10-K,10-Q,8-K    SEC forms to include
  --sleep 0.6              seconds between SEC requests
  --plan-only              resolve candidates without writing outputs
`);
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function cik10(value) {
  const text = String(value ?? "").replace(/\D/g, "");
  return text.padStart(10, "0");
}

function cikNoLeadingZeros(value) {
  return String(Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function readExistingJson(filePath, fallback, guardFn) {
  return fs.existsSync(filePath) ? loadJsonGuarded(filePath, guardFn) : fallback;
}

function guardStocksAnalyzer(data, filePath) {
  requireKeys(data, filePath, ["data"]);
  requireArray(data.data, filePath, "data");
}

function guardExistingManifest(data, filePath) {
  requireObject(data, filePath);
  requireKeys(data, filePath, ["filings"]);
  requireArray(data.filings, filePath, "filings");
}

function loadUniverse(args) {
  if (args.tickers.length > 0) {
    return uniqueTickers(["NVDA", ...args.tickers]);
  }

  const analyzer = readExistingJson(ANALYZER_PATH, { data: [] }, guardStocksAnalyzer);
  const rows = Array.isArray(analyzer?.data) ? analyzer.data : [];
  const tickers = rows
    .filter((row) => row?.country === "US")
    .map((row) => normalizeTicker(row.symbol))
    .filter(Boolean);
  const limited = args.fullUniverse ? tickers : tickers.slice(0, args.limit);
  return uniqueTickers(["NVDA", ...limited]);
}

function uniqueTickers(values) {
  const seen = new Set();
  const result = [];
  for (const value of values.map(normalizeTicker).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function tickerAliases(ticker) {
  const normalized = normalizeTicker(ticker);
  const aliases = new Set([normalized]);
  aliases.add(normalized.replace(/\./g, "-"));
  aliases.add(normalized.replace(/-/g, "."));
  return [...aliases];
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`${url} HTTP ${response.status}`);
  return response.json();
}

async function loadCompanyTickers() {
  const payload = await fetchJson(SEC_COMPANY_TICKERS_URL);
  const rows = Object.values(payload)
    .map((row) => ({
      cik: cik10(row.cik_str),
      ticker: normalizeTicker(row.ticker),
      title: String(row.title ?? ""),
    }))
    .filter((row) => row.cik && row.ticker);

  const cache = {
    schemaVersion: 1,
    artifactType: "sec_company_tickers_cache",
    sourceUrl: SEC_COMPANY_TICKERS_URL,
    generatedAt: new Date().toISOString(),
    count: rows.length,
    rows,
  };
  return { rows, cache };
}

function buildCikMap(companyRows) {
  const map = new Map();
  for (const row of companyRows) {
    for (const alias of tickerAliases(row.ticker)) {
      if (!map.has(alias)) map.set(alias, row);
    }
  }
  return map;
}

async function fetchSubmissions(cik) {
  return fetchJson(`${SEC_SUBMISSIONS_BASE_URL}/CIK${cik}.json`);
}

function filingRowsFromSubmissions({ ticker, companyName, cik, submissions, forms, limit }) {
  const recent = submissions?.filings?.recent ?? {};
  const rows = [];
  const formValues = Array.isArray(recent.form) ? recent.form : [];
  const allowedForms = new Set(forms);
  for (let index = 0; index < formValues.length; index += 1) {
    const form = String(formValues[index] ?? "").toUpperCase();
    if (!allowedForms.has(form)) continue;
    const accession = String(recent.accessionNumber?.[index] ?? "");
    const primaryDocument = String(recent.primaryDocument?.[index] ?? "");
    const filingDate = String(recent.filingDate?.[index] ?? "");
    if (!accession || !primaryDocument || !filingDate) continue;
    const archiveAccession = accession.replace(/-/g, "");
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${cikNoLeadingZeros(cik)}/${archiveAccession}/${primaryDocument}`;
    rows.push({
      ticker,
      companyName,
      cik,
      form,
      accession,
      filingDate,
      periodEnd: recent.reportDate?.[index] || filingDate,
      title: `${companyName} ${form} (${filingDate})`,
      summaryPath: null,
      translationPath: null,
      sourceUrl,
      primaryDocUrl: sourceUrl,
      summaryStatus: "pending",
      translationStatus: "not_available",
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

function loadExistingManifests() {
  const manifests = new Map();
  const dirs = [
    path.join(SUMMARY_ROOT, "by-ticker"),
    path.join(PUBLIC_SUMMARY_ROOT, "by-ticker"),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const manifest = loadJsonGuarded(path.join(dir, file), guardExistingManifest);
      const ticker = normalizeTicker(manifest?.ticker ?? file.replace(/\.json$/, ""));
      if (ticker && !manifests.has(ticker)) manifests.set(ticker, manifest);
    }
  }
  return manifests;
}

function isReadySummaryRow(row) {
  return Boolean(row?.summaryPath || row?.translationPath);
}

function mergeFilings({ ticker, companyName, cik, existingManifest, discoveredRows, updated }) {
  const byAccession = new Map();
  const existingRows = Array.isArray(existingManifest?.filings) ? existingManifest.filings : [];

  for (const row of discoveredRows) {
    if (row?.accession) byAccession.set(row.accession, row);
  }

  for (const row of existingRows) {
    if (!row?.accession) continue;
    const existingReady = isReadySummaryRow(row);
    if (existingReady) {
      byAccession.set(row.accession, row);
    } else if (!byAccession.has(row.accession)) {
      byAccession.set(row.accession, { ...row, summaryPath: row.summaryPath ?? null });
    }
  }

  const filings = [...byAccession.values()].sort((a, b) => {
    const dateCompare = String(b.filingDate ?? "").localeCompare(String(a.filingDate ?? ""));
    if (dateCompare !== 0) return dateCompare;
    return String(b.accession ?? "").localeCompare(String(a.accession ?? ""));
  });
  const readyCount = filings.filter(isReadySummaryRow).length;

  return {
    schemaVersion: existingManifest?.schemaVersion ?? 1,
    artifactType: "edgar_korean_summary_ticker_manifest",
    ticker,
    companyName: existingManifest?.companyName ?? companyName,
    cik: existingManifest?.cik ?? cik,
    updated,
    source: "SEC EDGAR submissions and feno-edgar Korean summary artifacts",
    summaryStatus: readyCount > 0 ? "partial" : "pending",
    filings,
  };
}

function writeManifestMirror(ticker, manifest) {
  const fileName = `${ticker.toLowerCase()}.json`;
  writeJson(path.join(SUMMARY_ROOT, "by-ticker", fileName), manifest);
  writeJson(path.join(PUBLIC_SUMMARY_ROOT, "by-ticker", fileName), manifest);
}

function writeIndex({ manifests, updated }) {
  const tickers = [...manifests.keys()].sort();
  const byTicker = {};
  for (const ticker of tickers) {
    byTicker[ticker] = `/data/edgar-korean-summaries/by-ticker/${ticker.toLowerCase()}.json`;
  }
  const payload = {
    schemaVersion: 1,
    artifactType: "edgar_korean_summary_index",
    updated,
    generatedAt: new Date().toISOString(),
    tickers,
    byTicker,
  };
  writeJson(path.join(SUMMARY_ROOT, "index.json"), payload);
  writeJson(path.join(PUBLIC_SUMMARY_ROOT, "index.json"), payload);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const updated = new Date().toISOString().slice(0, 10);
  const universe = loadUniverse(args);
  console.log(
    `edgar_filing_timeline: candidates=${universe.length} limit=${args.fullUniverse ? "full" : args.limit} filings_per_ticker=${args.filingsPerTicker} forms=${args.forms.join(",")} plan_only=${args.planOnly}`,
  );

  const { rows: companyRows, cache } = await loadCompanyTickers();
  const cikMap = buildCikMap(companyRows);
  const existingManifests = loadExistingManifests();
  const nextManifests = new Map(existingManifests);
  const stats = { resolved: 0, unresolved: 0, fetched: 0, filings: 0, readyPreserved: 0, errors: 0 };

  if (!args.planOnly) {
    writeJson(EDGAR_CACHE_PATH, cache);
  }

  for (const ticker of universe) {
    const cikRow = tickerAliases(ticker).map((alias) => cikMap.get(alias)).find(Boolean);
    if (!cikRow) {
      stats.unresolved += 1;
      continue;
    }
    stats.resolved += 1;

    try {
      const submissions = await fetchSubmissions(cikRow.cik);
      stats.fetched += 1;
      const companyName = submissions?.name || cikRow.title || ticker;
      const discoveredRows = filingRowsFromSubmissions({
        ticker,
        companyName,
        cik: cikRow.cik,
        submissions,
        forms: args.forms,
        limit: args.filingsPerTicker,
      });
      stats.filings += discoveredRows.length;
      const existingManifest = existingManifests.get(ticker);
      const readyBefore = (existingManifest?.filings ?? []).filter(isReadySummaryRow).length;
      const manifest = mergeFilings({
        ticker,
        companyName,
        cik: cikRow.cik,
        existingManifest,
        discoveredRows,
        updated,
      });
      const readyAfter = manifest.filings.filter(isReadySummaryRow).length;
      stats.readyPreserved += Math.min(readyBefore, readyAfter);
      nextManifests.set(ticker, manifest);
      if (!args.planOnly && manifest.filings.length > 0) writeManifestMirror(ticker, manifest);
      console.log(`  ${ticker}: filings=${manifest.filings.length} ready=${readyAfter} cik=${cikRow.cik}`);
    } catch (error) {
      stats.errors += 1;
      console.warn(`  ${ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (args.sleep > 0) {
      await sleep(args.sleep * 1000);
    }
  }

  if (!args.planOnly) {
    writeIndex({ manifests: nextManifests, updated });
  }
  console.log(
    `edgar_filing_timeline: resolved=${stats.resolved} unresolved=${stats.unresolved} fetched=${stats.fetched} filings=${stats.filings} ready_preserved=${stats.readyPreserved} errors=${stats.errors}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
