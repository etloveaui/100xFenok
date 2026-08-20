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
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  loadJsonGuarded,
  requireArray,
  requireKeys,
  requireObject,
} from "./lib/guarded-json.mjs";
import {
  attemptResult,
  atomicWrite,
  classifyEndpointResponse,
  classifyHttpResponse,
  defaultAttemptId,
  threwTuple,
  transportError,
  worstRequestResult,
  writeAttemptShard,
} from "./lib/data-supply-attempt-shard.mjs";
import {
  LaneLkgStore,
  PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
  buildProviderObservationV2,
  classifyLkgFailure,
  isNaturalScheduleRun,
} from "./lib/data-supply-lkg-store.mjs";
import { boundedDiagnosticDetail, diagnosticSuffix } from "./lib/diagnostic-detail.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Last-known-good recovery lane. The published tree is far too large to snapshot
// (18MB / 1800+ files, company_tickers churn), so the store protects a small
// freshness marker (max eligible filingDate + coverage counts + tree digest)
// under data/admin/edgar_filings/, mirroring the finra/yardeni marker contract.
// EDGAR is a poll_only source: a quiet week (no new qualifying filing, weekend,
// federal holiday) is a VALID poll — never a failure; a due poll whose endpoint
// fails or schema-drifts IS a failure and retains the prior marker.
const EDGAR_LANE_ID = "edgar_filings";
const EDGAR_LKG_KEY = "edgar_filings";
const EDGAR_FRESHNESS_MARKER_SCHEMA = "fenok-edgar-freshness-marker/v1";

// Bounded persistence (P): mergeFilings accumulates per-ticker filings; bound the
// merged timeline to the latest 100 distinct filingDates per ticker. Sparse
// tickers are never evicted; malformed dates fail closed; re-runs are idempotent.
const EDGAR_PERSISTENCE_POLICY = Object.freeze({
  schema_version: "edgar-bounded-persistence/v1",
  basis: "filingDate",
  scope: "per_ticker",
  max_distinct_filing_dates_per_ticker: 100,
  eviction: "oldest_filing_date_first",
});

// Dispatch-only chaos injection (owner-approved R proof): "edgar_filings"
// fails the FIRST resolved ticker's submissions fetch through the real
// transport-error attempt result (the partial path); "bootstrap" fails the
// company_tickers bootstrap through the same path. Schedule/local events
// reject injection in code — a natural run can never be poisoned by accident.
const EDGAR_CONTROLLED_FAILURE_KEYS = Object.freeze(["edgar_filings", "bootstrap"]);
function validateControlledEdgarFailure(value, eventName) {
  if (!value) return null;
  if (eventName !== "workflow_dispatch") throw new Error("controlled failure requires workflow_dispatch");
  if (!EDGAR_CONTROLLED_FAILURE_KEYS.includes(value)) {
    throw new Error(`unknown controlled EDGAR key: ${value}`);
  }
  return value;
}

const DEFAULT_PATHS = Object.freeze({
  analyzerPath: path.join(ROOT, "data/global-scouter/core/stocks_analyzer.json"),
  edgarCachePath: path.join(ROOT, "data/edgar/company_tickers.json"),
  summaryRoot: path.join(ROOT, "data/edgar-korean-summaries"),
  publicSummaryRoot: path.join(ROOT, "100xfenok-next/public/data/edgar-korean-summaries"),
  attemptShardPath: path.join(ROOT, "data/admin/data-supply-state/detection-attempts/edgar_filings.json"),
});
const SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SEC_SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions";
const DEFAULT_FORMS = ["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K"];
const FOREIGN_FORM_SECTION_REQUESTS = Object.freeze({
  "6-K": Object.freeze(["foreign_report"]),
  "20-F": Object.freeze(["item_3d", "item_5"]),
  "40-F": Object.freeze(["risk_factors", "mda"]),
});
const FOREIGN_FORMS = new Set(Object.keys(FOREIGN_FORM_SECTION_REQUESTS));
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
  --forms 10-K,10-Q,8-K,20-F,40-F,6-K    SEC forms to include
  --sleep 0.6              seconds between SEC requests
  --plan-only              skip data artifacts but still publish attempt telemetry
`);
}

function normalizeTicker(value) {
  return String(value ?? "").trim().toUpperCase();
}

function cik10(value) {
  const text = String(value ?? "").replace(/\D/g, "");
  return text.padStart(10, "0");
}

function strictCik10(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  return text.padStart(10, "0");
}

function cikNoLeadingZeros(value) {
  const digits = String(value ?? "").trim();
  if (!/^\d+$/.test(digits)) return null;
  if (!digits) return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isSafeInteger(parsed) ? String(parsed) : null;
}

function isForeignForm(form) {
  return FOREIGN_FORMS.has(String(form ?? "").trim().toUpperCase());
}

function accessionDigits(value) {
  const accession = String(value ?? "").trim();
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  return accession.replace(/-/g, "");
}

function secArchiveIdentity(sourceUrl) {
  try {
    const parsed = new URL(String(sourceUrl ?? ""));
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.sec.gov") return null;
    const match = /^\/Archives\/edgar\/data\/(\d+)\/(\d{18})(?:\/|$)/i.exec(parsed.pathname);
    if (!match) return null;
    return {
      cik: strictCik10(match[1]),
      accession: match[2],
    };
  } catch {
    return null;
  }
}

function validateForeignFilingIdentity(row, label = "EDGAR foreign filing", expectedTicker = null, expectedCik = null) {
  const ticker = normalizeTicker(row?.ticker);
 const form = String(row?.form ?? "").trim().toUpperCase();
 const cik = strictCik10(row?.cik);
  const accession = String(row?.accession ?? "").trim();
  const accessionId = accessionDigits(accession);
  const sourceUrl = String(row?.sourceUrl ?? "").trim();
  const sourceIdentity = secArchiveIdentity(sourceUrl);
  const normalizedExpectedTicker = expectedTicker === null || expectedTicker === undefined ? null : normalizeTicker(expectedTicker);
  const normalizedExpectedCik = expectedCik === null || expectedCik === undefined ? null : strictCik10(expectedCik);
 if (!ticker || !form || !cik || cik === "0000000000" || !accessionId || !sourceIdentity) {
    throw new Error(`${label}: foreign filing identity is incomplete`);
 }
  if (!isForeignForm(form)) throw new Error(`${label}: unsupported foreign form ${form}`);
 if (normalizedExpectedTicker === null || !normalizedExpectedTicker || ticker !== normalizedExpectedTicker) {
   throw new Error("foreign filing ticker is not bound to expected ticker: " + label);
 }
 if (normalizedExpectedCik === null || !normalizedExpectedCik || cik !== normalizedExpectedCik) {
   throw new Error("foreign filing CIK is not bound to expected CIK: " + label);
 }
  if (sourceIdentity.cik !== cik || sourceIdentity.accession !== accessionId) {
    throw new Error(`${label}: source URL is not bound to CIK ${cik} and accession ${accession}`);
  }
  return Object.freeze({ ticker, form, cik, accession, sourceUrl });
}

function filingIdentityKey(row) {
  return [
    normalizeTicker(row?.ticker),
    String(row?.form ?? "").trim().toUpperCase(),
    String(row?.accession ?? "").trim(),
    strictCik10(row?.cik),
  ].join("|");
}

function foreignFilingIdentityKey(row) {
  return isForeignForm(row?.form) ? filingIdentityKey(row) : null;
}

function assertFilingIdentityCompatibility(first, second, label) {
  const firstForeign = isForeignForm(first?.form);
  const secondForeign = isForeignForm(second?.form);
  if (firstForeign !== secondForeign) {
    throw new Error("domestic/foreign filing identity conflict: " + label);
  }
  if (firstForeign && foreignFilingIdentityKey(first) !== foreignFilingIdentityKey(second)) {
    throw new Error("conflicting foreign filing identity: " + label);
  }
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

const EDGAR_PUBLICATION_JOURNAL_SCHEMA = "edgar-publication-transaction/v1";

function publicationJournalPath(paths) {
  return path.join(
    path.dirname(paths.summaryRoot),
    ".edgar-korean-summaries-publication-transaction.json",
  );
}

function removeFiles(fileSystem, filePaths) {
  const errors = [];
  for (const filePath of filePaths) {
    if (!filePath) continue;
    try {
      fileSystem.rmSync(filePath, { force: true });
    } catch (error) {
      errors.push(new Error(`${filePath}: ${error.message}`, { cause: error }));
    }
  }
  return errors;
}

function writeTransactionJournal(fileSystem, journalPath, journal) {
  fileSystem.mkdirSync(path.dirname(journalPath), { recursive: true });
  const temporary = `${journalPath}.${journal.transaction_id}.${journal.phase}.tmp`;
  const staleErrors = removeFiles(fileSystem, [temporary]);
  if (staleErrors.length > 0) {
    throw new AggregateError(staleErrors, "stale EDGAR publication journal temp cleanup failed");
  }
  try {
    fileSystem.writeFileSync(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: "wx" });
    fileSystem.renameSync(temporary, journalPath);
  } catch (error) {
    const cleanupErrors = removeFiles(fileSystem, [temporary]);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "EDGAR publication journal write and cleanup failed",
      );
    }
    throw error;
  }
}

function prospectiveRealPath(fileSystem, filePath) {
  let ancestor = path.resolve(filePath);
  const missing = [];
  while (!fileSystem.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error(`no existing ancestor for path: ${filePath}`);
    missing.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  return path.resolve(fileSystem.realpathSync(ancestor), ...missing);
}

function pathWithinRoots(fileSystem, filePath, allowedRoots) {
  const resolved = prospectiveRealPath(fileSystem, filePath);
  return allowedRoots.some((root) => {
    const relative = path.relative(prospectiveRealPath(fileSystem, root), resolved);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  });
}

function loadTransactionJournal(fileSystem, journalPath, allowedRoots) {
  let journal;
  try {
    journal = JSON.parse(fileSystem.readFileSync(journalPath, "utf8"));
  } catch (error) {
    throw new Error(`EDGAR publication journal is unreadable: ${error.message}`, { cause: error });
  }
  const validRoots = Array.isArray(allowedRoots) && allowedRoots.length > 0;
  const journalTargets = new Set();
  const validEntries = validRoots && Array.isArray(journal?.entries) && journal.entries.every((entry) => {
    if (
      typeof entry?.file_path !== "string"
      || typeof entry?.temp_path !== "string"
      || (entry.backup_path !== null && typeof entry.backup_path !== "string")
      || !path.isAbsolute(entry.file_path)
      || !path.isAbsolute(entry.temp_path)
      || (entry.backup_path !== null && !path.isAbsolute(entry.backup_path))
      || !pathWithinRoots(fileSystem, entry.file_path, allowedRoots)
      || journalTargets.has(path.resolve(entry.file_path))
      || path.dirname(path.resolve(entry.temp_path)) !== path.dirname(path.resolve(entry.file_path))
      || !path.basename(entry.temp_path).startsWith(
        `.${path.basename(entry.file_path)}.${journal.transaction_id}.`,
      )
      || !entry.temp_path.endsWith(".tmp")
    ) return false;
    journalTargets.add(path.resolve(entry.file_path));
    return entry.backup_path === null || entry.backup_path === `${entry.temp_path}.backup`;
  });
  if (
    journal?.schema_version !== EDGAR_PUBLICATION_JOURNAL_SCHEMA
    || !["staging", "prepared", "committed", "rolled_back"].includes(journal.phase)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      journal.transaction_id ?? "",
    )
    || !validRoots
    || !validEntries
  ) {
    throw new Error("EDGAR publication journal contract is invalid");
  }
  return journal;
}

function cleanupTransaction(fileSystem, journalPath, journal) {
  const artifactPaths = journal.entries.flatMap((entry) => [
    entry.temp_path,
    entry.backup_path,
    `${entry.temp_path}.restore`,
  ]);
  artifactPaths.push(
    `${journalPath}.${journal.transaction_id}.tmp`,
    ...["staging", "prepared", "committed", "rolled_back"].map(
      (phase) => `${journalPath}.${journal.transaction_id}.${phase}.tmp`,
    ),
  );
  const artifactErrors = removeFiles(fileSystem, artifactPaths);
  if (artifactErrors.length > 0) {
    throw new AggregateError(artifactErrors, "EDGAR publication transaction cleanup failed");
  }
  const journalErrors = removeFiles(fileSystem, [journalPath]);
  if (journalErrors.length > 0) {
    throw new AggregateError(journalErrors, "EDGAR publication journal cleanup failed");
  }
}

function recoverJsonBundleTransaction(journalPath, {
  fileSystem = fs,
  allowedRoots,
} = {}) {
  if (
    !Array.isArray(allowedRoots)
    || allowedRoots.length === 0
    || !path.isAbsolute(journalPath)
    || !pathWithinRoots(
      fileSystem,
      journalPath,
      [path.dirname(path.resolve(allowedRoots[0]))],
    )
  ) {
    throw new Error("EDGAR publication journal path or allowed roots are invalid");
  }
  if (!fileSystem.existsSync(journalPath)) return { recovered: false, phase: null };
  const journal = loadTransactionJournal(fileSystem, journalPath, allowedRoots);
  if (["staging", "committed", "rolled_back"].includes(journal.phase)) {
    cleanupTransaction(fileSystem, journalPath, journal);
    return { recovered: true, phase: journal.phase };
  }

  const rollbackErrors = [];
  for (const entry of [...journal.entries].reverse()) {
    const restorePath = `${entry.temp_path}.restore`;
    try {
      if (entry.backup_path === null) {
        fileSystem.rmSync(entry.file_path, { force: true });
      } else {
        if (!fileSystem.existsSync(entry.backup_path)) {
          throw new Error(`missing EDGAR publication backup: ${entry.backup_path}`);
        }
        fileSystem.writeFileSync(
          restorePath,
          fileSystem.readFileSync(entry.backup_path),
          { flag: "wx" },
        );
        fileSystem.renameSync(restorePath, entry.file_path);
      }
    } catch (error) {
      rollbackErrors.push(new Error(`${entry.file_path}: ${error.message}`, { cause: error }));
    } finally {
      rollbackErrors.push(...removeFiles(fileSystem, [restorePath]));
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(
      rollbackErrors,
      "EDGAR publication rollback is incomplete; journal retained for the next run",
    );
  }
  const rolledBack = { ...journal, phase: "rolled_back" };
  writeTransactionJournal(fileSystem, journalPath, rolledBack);
  cleanupTransaction(fileSystem, journalPath, rolledBack);
  return { recovered: true, phase: "rolled_back" };
}

function writeJsonBundleTransaction(entries, {
  fileSystem = fs,
  journalPath,
  allowedRoots,
} = {}) {
  if (!journalPath) throw new Error("EDGAR publication transaction requires a journal path");
  if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
    throw new Error("EDGAR publication transaction requires allowed roots");
  }
  recoverJsonBundleTransaction(journalPath, { fileSystem, allowedRoots });
  const seen = new Set();
  const transactionId = randomUUID();
  const staged = [];
  let journalWritten = false;

  for (const [index, entry] of entries.entries()) {
    const resolvedTarget = path.resolve(entry.filePath);
    if (
      !path.isAbsolute(entry.filePath)
      || !pathWithinRoots(fileSystem, resolvedTarget, allowedRoots)
    ) {
      throw new Error(`EDGAR publication target is outside the allowed roots: ${entry.filePath}`);
    }
    if (seen.has(resolvedTarget)) {
      throw new Error(`duplicate EDGAR publication target: ${entry.filePath}`);
    }
    seen.add(resolvedTarget);
    const tempPath = path.join(
      path.dirname(resolvedTarget),
      `.${path.basename(resolvedTarget)}.${transactionId}.${index}.tmp`,
    );
    const backupPath = fileSystem.existsSync(resolvedTarget)
      ? `${tempPath}.backup`
      : null;
    staged.push({ ...entry, filePath: resolvedTarget, tempPath, backupPath });
  }

  let journal = {
    schema_version: EDGAR_PUBLICATION_JOURNAL_SCHEMA,
    transaction_id: transactionId,
    phase: "staging",
    entries: staged.map((entry) => ({
      file_path: entry.filePath,
      temp_path: entry.tempPath,
      backup_path: entry.backupPath,
    })),
  };
  try {
    writeTransactionJournal(fileSystem, journalPath, journal);
    journalWritten = true;
    for (const entry of staged) {
      fileSystem.mkdirSync(path.dirname(entry.filePath), { recursive: true });
      if (entry.backupPath) {
        fileSystem.writeFileSync(
          entry.backupPath,
          fileSystem.readFileSync(entry.filePath),
          { flag: "wx" },
        );
      }
      fileSystem.writeFileSync(
        entry.tempPath,
        `${JSON.stringify(entry.payload, null, 2)}\n`,
        { flag: "wx" },
      );
    }
    journal = { ...journal, phase: "prepared" };
    writeTransactionJournal(fileSystem, journalPath, journal);
    for (const entry of staged) {
      fileSystem.renameSync(entry.tempPath, entry.filePath);
    }
    const committed = { ...journal, phase: "committed" };
    writeTransactionJournal(fileSystem, journalPath, committed);
    cleanupTransaction(fileSystem, journalPath, committed);
  } catch (transactionError) {
    if (!journalWritten) {
      const cleanupErrors = removeFiles(
        fileSystem,
        staged.flatMap((entry) => [entry.tempPath, entry.backupPath]),
      );
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [transactionError, ...cleanupErrors],
          "EDGAR publication transaction setup and cleanup failed",
        );
      }
      throw transactionError;
    }
    try {
      recoverJsonBundleTransaction(journalPath, { fileSystem, allowedRoots });
    } catch (rollbackError) {
      throw new AggregateError(
        [transactionError, rollbackError],
        "EDGAR publication transaction failed; recovery journal retained",
      );
    }
    throw transactionError;
  }
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

function loadUniverse(args, paths) {
  if (args.tickers.length > 0) {
    return uniqueTickers(["NVDA", ...args.tickers]);
  }

  const analyzer = readExistingJson(paths.analyzerPath, { data: [] }, guardStocksAnalyzer);
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

export async function requestBytes(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });
  return { statusCode: response.status, body: await response.text() };
}

async function loadCompanyTickers(request, observedAt) {
  const classified = classifyHttpResponse(await request(SEC_COMPANY_TICKERS_URL));
  if (classified.status !== "ready") return { result: classified, rows: [], cache: null };
  const payload = classified.document;
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
    generatedAt: observedAt,
    count: rows.length,
    rows,
  };
  return { result: classified, rows, cache };
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

async function fetchSubmissions(cik, request) {
  return classifyEndpointResponse(
    await request(`${SEC_SUBMISSIONS_BASE_URL}/CIK${cik}.json`),
    { laneId: "edgar_filings" },
  );
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
    const archiveCik = cikNoLeadingZeros(cik);
    if (!archiveCik || !/^\d+$/.test(archiveAccession)) continue;
    const sourceUrl = `https://www.sec.gov/Archives/edgar/data/${archiveCik}/${archiveAccession}/${primaryDocument}`;
    const row = {
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
    };
    if (isForeignForm(form)) {
      validateForeignFilingIdentity(row, `${ticker}/${form}/${accession}`, ticker, cik);
      row.sectionsRequested = [...FOREIGN_FORM_SECTION_REQUESTS[form]];
    }
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

function loadExistingManifests(paths) {
  const manifests = new Map();
  const dirs = [
    path.join(paths.summaryRoot, "by-ticker"),
    path.join(paths.publicSummaryRoot, "by-ticker"),
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

function assertValidFilingDate(value) {
  const text = String(value ?? "");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parsed = match ? new Date(`${text}T00:00:00Z`) : null;
  if (
    !parsed
    || !Number.isFinite(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== text
  ) {
    throw new Error(`invalid EDGAR persistence filingDate: ${value}`);
  }
  return text;
}

// Bounded persistence (OCC-consistent recipe): retain only filings whose
// filingDate is within the ticker's newest N distinct filingDates. A ticker with
// fewer distinct dates is never pruned (sparse-ticker non-eviction); any
// malformed filingDate throws (fail-closed); applying the cap twice is a no-op
// (idempotent).
function retainLatestFilingDates(filings, policy = EDGAR_PERSISTENCE_POLICY) {
  const maxDates = Number(policy?.max_distinct_filing_dates_per_ticker);
  if (!Number.isInteger(maxDates) || maxDates <= 0) {
    throw new Error("invalid EDGAR persistence max_distinct_filing_dates_per_ticker");
  }
  const rows = Array.isArray(filings) ? filings : [];
  const dates = new Set();
  for (const row of rows) dates.add(assertValidFilingDate(row?.filingDate));
  const retainedDates = new Set([...dates].sort().reverse().slice(0, maxDates));
  const retained = rows.filter((row) => retainedDates.has(String(row.filingDate)));
  return {
    rows: retained,
    stats: {
      distinct_filing_dates: dates.size,
      filings_before: rows.length,
      filings_retained: retained.length,
      pruned: rows.length - retained.length,
    },
  };
}

// Upgrade every already-published ticker manifest through the same bounded
// persistence contract used for newly fetched tickers. This lets the normal
// limited universe poll migrate the entire canonical tree without pretending
// that unqueried tickers were freshly acquired. Existing provenance/status
// fields remain untouched; malformed dates fail the whole publication closed.
function applyPersistenceToExistingManifest(manifest) {
  const capped = retainLatestFilingDates(manifest?.filings);
  const previousTotalPruned = Number(manifest?.persistence_state?.total_pruned_filings);
  const prunedThisMigration = capped.stats.pruned;
  return {
    ...manifest,
    persistence_policy: EDGAR_PERSISTENCE_POLICY,
    persistence_state: {
      distinct_filing_dates: capped.stats.distinct_filing_dates,
      filings_before: capped.stats.filings_before,
      filings_retained: capped.stats.filings_retained,
      pruned_this_merge: prunedThisMigration,
      total_pruned_filings: (Number.isFinite(previousTotalPruned) ? previousTotalPruned : 0)
        + prunedThisMigration,
    },
    filings: capped.rows,
  };
}

function mergeFilings({ ticker, companyName, cik, existingManifest, discoveredRows, updated }) {
  const byAccession = new Map();
  const existingRows = Array.isArray(existingManifest?.filings) ? existingManifest.filings : [];
  const hasForeignRows = [...existingRows, ...(Array.isArray(discoveredRows) ? discoveredRows : [])]
    .some((row) => isForeignForm(row?.form));
  if (hasForeignRows) {
    const discoveryCik = strictCik10(cik);
    const manifestCik = existingManifest?.cik === undefined || existingManifest?.cik === null
      ? discoveryCik
      : strictCik10(existingManifest.cik);
    if (!discoveryCik || !manifestCik || discoveryCik !== manifestCik) {
      throw new Error("foreign manifest/discovery CIK conflict: " + ticker);
    }
  }

  for (const row of discoveredRows) {
    const previousRow = row?.accession ? byAccession.get(row.accession) : null;
    if (previousRow) assertFilingIdentityCompatibility(previousRow, row, ticker + "/" + row.accession);
    if (isForeignForm(row?.form)) {
      validateForeignFilingIdentity(row, `${ticker}/${row.form}/${row.accession}`, ticker, cik);
      const previous = byAccession.get(row.accession);
      if (previous && foreignFilingIdentityKey(previous) !== foreignFilingIdentityKey(row)) {
        throw new Error(`${ticker}/${row.accession}: conflicting foreign filing identity`);
      }
    }
    if (row?.accession) byAccession.set(row.accession, row);
  }

  for (const row of existingRows) {
    if (!row?.accession) continue;
    const discoveredRow = byAccession.get(row.accession);
    if (discoveredRow) assertFilingIdentityCompatibility(discoveredRow, row, ticker + "/" + row.accession);
    if (isForeignForm(row?.form)) {
      validateForeignFilingIdentity(row, `${ticker}/${row.form}/${row.accession}`, ticker, cik);
      const discovered = byAccession.get(row.accession);
      if (discovered && foreignFilingIdentityKey(discovered) !== foreignFilingIdentityKey(row)) {
        throw new Error(`${ticker}/${row.accession}: existing foreign filing identity conflicts with SEC discovery`);
      }
    }
    const existingReady = isReadySummaryRow(row);
    if (existingReady) {
      byAccession.set(row.accession, row);
    } else if (!byAccession.has(row.accession)) {
      byAccession.set(row.accession, { ...row, summaryPath: row.summaryPath ?? null });
    }
  }

  const merged = [...byAccession.values()].sort((a, b) => {
    const dateCompare = String(b.filingDate ?? "").localeCompare(String(a.filingDate ?? ""));
    if (dateCompare !== 0) return dateCompare;
    return String(b.accession ?? "").localeCompare(String(a.accession ?? ""));
  });
  const capped = retainLatestFilingDates(merged);
  const filings = capped.rows;
  const readyCount = filings.filter(isReadySummaryRow).length;
  const previousTotalPruned = Number(existingManifest?.persistence_state?.total_pruned_filings);
  const prunedThisMerge = capped.stats.pruned;

  return {
    schemaVersion: existingManifest?.schemaVersion ?? 1,
    artifactType: "edgar_korean_summary_ticker_manifest",
    ticker,
    companyName: existingManifest?.companyName ?? companyName,
    cik: existingManifest?.cik ?? cik,
    updated,
    source: "SEC EDGAR submissions and feno-edgar Korean summary artifacts",
    summaryStatus: readyCount > 0 ? "partial" : "pending",
    persistence_policy: EDGAR_PERSISTENCE_POLICY,
    persistence_state: {
      distinct_filing_dates: capped.stats.distinct_filing_dates,
      filings_before: capped.stats.filings_before,
      filings_retained: capped.stats.filings_retained,
      pruned_this_merge: prunedThisMerge,
      total_pruned_filings: (Number.isFinite(previousTotalPruned) ? previousTotalPruned : 0) + prunedThisMerge,
    },
    filings,
  };
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function edgarMarkerPathFor(storeRepoRoot) {
  return path.join(storeRepoRoot, "data", "admin", EDGAR_LANE_ID, "current", `${EDGAR_LKG_KEY}.json`);
}

function maxFilingDateAcrossManifests(manifests) {
  const dates = [];
  for (const manifest of (manifests?.values() ?? [])) {
    for (const row of (manifest?.filings ?? [])) {
      const date = String(row?.filingDate ?? "");
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))) dates.push(date);
    }
  }
  return dates.length > 0 ? dates.sort().at(-1) : null;
}

// The freshness marker is the store's canonical: a small record of the newest
// eligible filingDate across the published tree, coverage counts, and a digest
// of the per-ticker (count, newest-date) tuples. It never snapshots the 18MB
// tree itself and carries no filing payloads.
function buildEdgarFreshnessMarker({ manifests, stats, generatedAt }) {
  const tree = [...(manifests?.entries() ?? [])]
    .map(([ticker, manifest]) => {
      const filings = Array.isArray(manifest?.filings) ? manifest.filings : [];
      const newest = filings.reduce((acc, row) => {
        const date = String(row?.filingDate ?? "");
        return date > acc ? date : acc;
      }, "");
      return [ticker, filings.length, newest || null];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  const sourceAsOf = maxFilingDateAcrossManifests(manifests);
  if (sourceAsOf === null) throw new Error("EDGAR freshness marker requires at least one dated filing in the published tree");
  return {
    schema_version: EDGAR_FRESHNESS_MARKER_SCHEMA,
    lane_id: EDGAR_LANE_ID,
    source_as_of: sourceAsOf,
    coverage: {
      tickers_total: manifests.size,
      tickers_fetched: Number(stats?.fetched ?? 0),
      tickers_resolved: Number(stats?.resolved ?? 0),
      filings_total: tree.reduce((sum, row) => sum + row[1], 0),
    },
    payload_sha256: sha256Hex(Buffer.from(JSON.stringify(tree), "utf8")),
    generated_at: generatedAt,
    raw_public: false,
    public_mirror_allowed: false,
  };
}

function validEdgarFreshnessMarker(doc) {
  return Boolean(doc)
    && typeof doc === "object"
    && !Array.isArray(doc)
    && doc.schema_version === EDGAR_FRESHNESS_MARKER_SCHEMA
    && doc.lane_id === EDGAR_LANE_ID
    && typeof doc.source_as_of === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(doc.source_as_of)
    && Number.isFinite(Date.parse(doc.source_as_of))
    && Number.isInteger(doc.coverage?.tickers_total) && doc.coverage.tickers_total > 0
    && Number.isInteger(doc.coverage?.filings_total) && doc.coverage.filings_total > 0
    && typeof doc.payload_sha256 === "string" && /^[0-9a-f]{64}$/.test(doc.payload_sha256)
    && typeof doc.generated_at === "string" && doc.generated_at.endsWith("Z")
    && Number.isFinite(Date.parse(doc.generated_at))
    && doc.raw_public === false
    && doc.public_mirror_allowed === false;
}

function edgarMarkerSourceAsOf(doc) {
  return validEdgarFreshnessMarker(doc) ? doc.source_as_of : null;
}

// Additive LKG recovery wrapper around the weekly poll. It never mutates the
// detection attempt shard and never rewrites manifests; it only maintains the
// store's freshness marker, LKG copy, and recovery index under
// data/admin/edgar_filings/, finalized ONCE after the whole ticker loop.
// Outcome semantics (poll_only):
//   - full clean poll (bootstrap + every resolved ticker ready) = SUCCESS
//     (promoted only when the provider's newest filingDate strictly advances);
//   - a full clean poll with no newer filingDate = EXPECTED ABSENCE (not_newer),
//     a valid quiet week, never a failure;
//   - any endpoint failure, partial result, or schema drift = FAILURE
//     (prior marker retained, retry parked; systemic classes are corruption).
function applyEdgarLkgStore({ repoRoot: storeRepoRoot, markerPath, manifests, stats, telemetry, run }) {
  const store = new LaneLkgStore({ repoRoot: storeRepoRoot, laneId: EDGAR_LANE_ID });
  const artifact = {
    key: EDGAR_LKG_KEY,
    canonicalPath: markerPath,
    validateDocument: validEdgarFreshnessMarker,
    sourceAsOf: edgarMarkerSourceAsOf,
  };

  if (telemetry?.status !== "ready") {
    const reason = telemetry?.reason ?? "unexpected_error";
    const failure = store.recordFailure({ artifacts: [artifact], run, reason });
    return {
      kind: "failure",
      updated: false,
      reason,
      retrySet: failure.retrySet,
      ...classifyLkgFailure({ reason, hasCompleteLkg: failure.hasCompleteLkg }),
    };
  }

  const marker = buildEdgarFreshnessMarker({ manifests, stats, generatedAt: run.observedAt });
  const serialized = `${JSON.stringify(marker, null, 2)}\n`;
  const payloadBytes = Buffer.from(serialized, "utf8");
  const sourceAsOf = marker.source_as_of;
  const markerRelative = path.relative(storeRepoRoot, path.resolve(markerPath)).split(path.sep).join("/");

  const snapshot = store.stateSnapshot();
  const priorItem = snapshot.items[EDGAR_LKG_KEY];
  const retryActive = priorItem?.retry === true;
  const priorSourceAsOf = priorItem?.current?.source_as_of;
  // Quiet-week guard: outside an active retry, only advance the freshness anchor
  // when the provider's newest filingDate is strictly newer. A clean poll with
  // no new qualifying filing is expected absence, never a failure. During a
  // retry the store's own advancement gate governs.
  if (!retryActive && typeof priorSourceAsOf === "string"
    && Number.isFinite(Date.parse(priorSourceAsOf))
    && Date.parse(sourceAsOf) <= Date.parse(priorSourceAsOf)) {
    return { kind: "not_newer", updated: false, sourceAsOf };
  }

  const candidate = {
    key: EDGAR_LKG_KEY,
    currentRelativePath: markerRelative,
    payloadBytes,
    sourceAsOf,
    validateDocument: validEdgarFreshnessMarker,
    deriveSourceAsOf: edgarMarkerSourceAsOf,
    promotion_contract: PROMOTION_CONTRACT_PROVIDER_OBSERVATION_V2,
    provider_observation: buildProviderObservationV2({
      payloadBytes,
      sourceAsOf,
      validateDocument: validEdgarFreshnessMarker,
      deriveSourceAsOf: edgarMarkerSourceAsOf,
      candidateContainsObservation: (candidateDocument, providerDocument) => (
        JSON.stringify(candidateDocument) === JSON.stringify(providerDocument)
      ),
      run,
    }),
  };

  if (retryActive && !isNaturalScheduleRun(run)) {
    return { kind: "recovery_requires_schedule", updated: false, reason: "recovery_requires_schedule", degraded: true, corrupt: false, exitCode: 0 };
  }

  const [decision] = store.evaluatePromotionCandidates([candidate], run);
  if (!decision.eligible) {
    if (["foreign_writer_conflict", "recovery_not_advanced_by_provider"].includes(decision.reason)) {
      store.recordPromotionDeferral({ artifacts: [candidate], run, reason: decision.reason });
    }
    return { kind: "not_promotable", updated: false, reason: decision.reason, degraded: true, corrupt: false, exitCode: 0 };
  }

  atomicWrite(markerPath, serialized);
  const success = store.recordSuccess({ artifacts: [candidate], run });
  const recovered = success.state.items[EDGAR_LKG_KEY]?.recovered_at === run.observedAt;
  return { kind: "success", updated: true, recovered, sourceAsOf };
}

function manifestMirrorEntries(paths, ticker, manifest) {
  const fileName = `${ticker.toLowerCase()}.json`;
  return [
    { filePath: path.join(paths.summaryRoot, "by-ticker", fileName), payload: manifest },
    { filePath: path.join(paths.publicSummaryRoot, "by-ticker", fileName), payload: manifest },
  ];
}

function buildIndex({ manifests, updated, generatedAt }) {
  const tickers = [...manifests.keys()].sort();
  const byTicker = {};
  for (const ticker of tickers) {
    byTicker[ticker] = `/data/edgar-korean-summaries/by-ticker/${ticker.toLowerCase()}.json`;
  }
  return {
    schemaVersion: 1,
    artifactType: "edgar_korean_summary_index",
    updated,
    generatedAt,
    tickers,
    byTicker,
  };
}

function writePublicationBundle(paths, {
  manifests,
  updated,
  generatedAt,
}) {
  const entries = [];
  for (const [ticker, manifest] of manifests) {
    entries.push(...manifestMirrorEntries(paths, ticker, manifest));
  }
  const index = buildIndex({ manifests, updated, generatedAt });
  entries.push(
    { filePath: path.join(paths.summaryRoot, "index.json"), payload: index },
    { filePath: path.join(paths.publicSummaryRoot, "index.json"), payload: index },
  );
  writeJsonBundleTransaction(entries, {
    journalPath: publicationJournalPath(paths),
    allowedRoots: [paths.summaryRoot, paths.publicSummaryRoot],
  });
}

function thrownResult(error) {
  const exceptionKind = transportError(error) ? "transport" : "unexpected";
  return {
    ...attemptResult(
      exceptionKind === "transport" ? "transport_error" : "unexpected_error",
      threwTuple(exceptionKind),
    ),
    failure_detail: boundedDiagnosticDetail(error),
  };
}

function noSubmissionRequestResult() {
  return {
    ...attemptResult("unexpected_error", threwTuple("unexpected")),
    failure_detail: boundedDiagnosticDetail(new Error("no EDGAR submission endpoints were requested")),
  };
}

export async function runEdgarFilingTimeline({
  argv = process.argv.slice(2),
  paths = DEFAULT_PATHS,
  request = requestBytes,
  observedAt = new Date().toISOString(),
  attemptId = defaultAttemptId("edgar-filings", observedAt),
  sleepFn = sleep,
  lkgRepoRoot = null,
  runId = process.env.GITHUB_RUN_ID || "local",
  runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1),
  eventName = process.env.GITHUB_EVENT_NAME || "local",
  controlledFailureKey = process.env.INPUT_CONTROLLED_FAILURE_KEY || "",
} = {}) {
  const injected = validateControlledEdgarFailure(controlledFailureKey.trim(), eventName);
  let injectedTickerDone = false;
  let args = null;
  const requestResults = [];
  let bootstrapResult = null;
  const stats = { resolved: 0, unresolved: 0, fetched: 0, filings: 0, readyPreserved: 0, errors: 0 };
  let fatalError = null;
  let lkgOutcome = null;

  try {
    args = parseArgs(argv);
    recoverJsonBundleTransaction(publicationJournalPath(paths), {
      allowedRoots: [paths.summaryRoot, paths.publicSummaryRoot],
    });
    // Additive LKG recovery: engage only for the automatic weekly universe poll
    // (no --tickers override, no --full-universe, no --plan-only). Manual subset
    // polls, backfills, plan-only runs, and every caller without an explicit
    // lkgRepoRoot never touch the shared recovery state. Detection attempt
    // shard emission below is untouched.
    const manageLkg = lkgRepoRoot !== null && !args.planOnly && args.tickers.length === 0 && !args.fullUniverse;
    const storeRun = {
      runId: String(runId),
      runAttempt: Number(runAttempt),
      eventName,
      observedAt,
    };
    const storeMarkerPath = manageLkg ? edgarMarkerPathFor(lkgRepoRoot) : null;
    const updated = observedAt.slice(0, 10);
    const universe = loadUniverse(args, paths);
    console.log(
      `edgar_filing_timeline: candidates=${universe.length} limit=${args.fullUniverse ? "full" : args.limit} filings_per_ticker=${args.filingsPerTicker} forms=${args.forms.join(",")} plan_only=${args.planOnly}`,
    );
    let company;
    try {
      if (injected === "bootstrap") {
        // Chaos injection: the bootstrap fails via the real transport-error
        // attempt result — the same path a genuine network failure takes.
        bootstrapResult = attemptResult("transport_error", threwTuple("transport"));
      } else {
        company = await loadCompanyTickers(request, observedAt);
        bootstrapResult = company.result;
      }
    } catch (error) {
      bootstrapResult = thrownResult(error);
    }
    if (bootstrapResult.status !== "ready") {
      if (manageLkg) {
        lkgOutcome = applyEdgarLkgStore({
          repoRoot: lkgRepoRoot,
          markerPath: storeMarkerPath,
          manifests: new Map(),
          stats,
          telemetry: bootstrapResult,
          run: storeRun,
        });
        if (lkgOutcome.corrupt) {
          throw new Error(`SEC company ticker bootstrap failed: ${bootstrapResult.reason}${diagnosticSuffix(bootstrapResult.failure_detail)}; EDGAR LKG failure is corrupt: ${lkgOutcome.reason}`);
        }
        return {
          ok: false,
          reason: bootstrapResult.reason,
          failure_detail: bootstrapResult.failure_detail ?? null,
          telemetry_status: bootstrapResult.status,
          telemetry_reason: bootstrapResult.reason,
          stats,
          lkg: lkgOutcome,
        };
      }
      throw new Error(`SEC company ticker bootstrap failed: ${bootstrapResult.reason}${diagnosticSuffix(bootstrapResult.failure_detail)}`);
    }
    const cikMap = buildCikMap(company.rows);
    const existingManifests = loadExistingManifests(paths);
    const nextManifests = new Map(
      [...existingManifests.entries()].map(([ticker, manifest]) => [
        ticker,
        applyPersistenceToExistingManifest(manifest),
      ]),
    );

    if (!args.planOnly) writeJson(paths.edgarCachePath, company.cache);

    for (const ticker of universe) {
      const cikRow = tickerAliases(ticker).map((alias) => cikMap.get(alias)).find(Boolean);
      if (!cikRow) {
        stats.unresolved += 1;
        continue;
      }
      stats.resolved += 1;
      let endpointResult;
      try {
        if (injected === "edgar_filings" && !injectedTickerDone) {
          // Chaos injection: the first resolved ticker's submissions fetch
          // fails via the real transport-error attempt result (partial path).
          injectedTickerDone = true;
          endpointResult = attemptResult("transport_error", threwTuple("transport"));
        } else {
          endpointResult = await fetchSubmissions(cikRow.cik, request);
        }
      } catch (error) {
        endpointResult = thrownResult(error);
      }
      requestResults.push(endpointResult);
      if (endpointResult.status !== "ready") {
        stats.errors += 1;
        console.warn(`  ${ticker}: SEC submissions ${endpointResult.reason}${diagnosticSuffix(endpointResult.failure_detail)}`);
      } else {
        const submissions = endpointResult.document;
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
        const existingManifest = nextManifests.get(ticker);
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
        console.log(`  ${ticker}: filings=${manifest.filings.length} ready=${readyAfter} cik=${cikRow.cik}`);
      }
      if (args.sleep > 0) await sleepFn(args.sleep * 1000);
    }

    if (!args.planOnly && stats.fetched > 0) {
      writePublicationBundle(paths, {
        manifests: nextManifests,
        updated,
        generatedAt: observedAt,
      });
    }

    if (manageLkg) {
      const telemetry = requestResults.length > 0
        ? worstRequestResult(requestResults)
        : noSubmissionRequestResult();
      lkgOutcome = applyEdgarLkgStore({
        repoRoot: lkgRepoRoot,
        markerPath: storeMarkerPath,
        manifests: nextManifests,
        stats,
        telemetry,
        run: storeRun,
      });
      if (lkgOutcome.corrupt) {
        throw new Error(`EDGAR LKG failure is corrupt${diagnosticSuffix(telemetry.failure_detail)}: ${lkgOutcome.reason}`);
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    const telemetry = requestResults.length > 0
      ? worstRequestResult(requestResults)
      : bootstrapResult && bootstrapResult.status !== "ready"
        ? bootstrapResult
        : noSubmissionRequestResult();
    writeAttemptShard({
      laneId: "edgar_filings",
      attemptShardPath: paths.attemptShardPath,
      observedAt,
      attemptId,
      result: telemetry,
    });
  }
  if (fatalError) throw fatalError;
  const telemetry = requestResults.length > 0
    ? worstRequestResult(requestResults)
    : bootstrapResult && bootstrapResult.status !== "ready"
      ? bootstrapResult
      : noSubmissionRequestResult();
  console.log(
    `edgar_filing_timeline: resolved=${stats.resolved} unresolved=${stats.unresolved} fetched=${stats.fetched} filings=${stats.filings} ready_preserved=${stats.readyPreserved} errors=${stats.errors}`,
  );
  const produced = stats.fetched > 0;
  return {
    ok: produced,
    reason: produced ? "ok" : telemetry.reason === "ok" ? "unexpected_error" : telemetry.reason,
    failure_detail: produced ? null : telemetry.failure_detail ?? null,
    telemetry_status: telemetry.status,
    telemetry_reason: telemetry.reason,
    stats,
    lkg: lkgOutcome,
  };
}

// The production CLI engages the LKG recovery store BY DEFAULT; library callers
// (tests, embedders) opt in explicitly via their own lkgRepoRoot. These are the
// exact options the CLI entry passes — exporting them lets the test suite pin
// the CLI-vs-library engagement parity class (calling the runner with no
// options silently lands the store inert: proven live by run 29642839382).
export const CLI_RUN_OPTIONS = Object.freeze({ lkgRepoRoot: ROOT });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runEdgarFilingTimeline(CLI_RUN_OPTIONS).then((result) => {
    // DEC-264: a degraded lane (valid LKG retained, retry parked, KPI-named)
    // exits 0 so the workflow commits the honest retry state; only true
    // corruption (no provable LKG, or a systemic break) exits non-zero.
    if (!result.ok) {
      const prefix = result.lkg?.degraded ? "[degraded]" : "[corrupt]";
      console.warn(`${prefix} EDGAR filings ${result.reason}${diagnosticSuffix(result.failure_detail)}`);
      process.exitCode = result.lkg?.exitCode ?? 2;
    }
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}

export {
  applyPersistenceToExistingManifest,
  applyEdgarLkgStore,
  buildEdgarFreshnessMarker,
  edgarMarkerPathFor,
  edgarMarkerSourceAsOf,
  filingRowsFromSubmissions,
  FOREIGN_FORM_SECTION_REQUESTS,
  isForeignForm,
  maxFilingDateAcrossManifests,
  mergeFilings,
  retainLatestFilingDates,
  secArchiveIdentity,
  validateForeignFilingIdentity,
  validEdgarFreshnessMarker,
  recoverJsonBundleTransaction,
  writeJsonBundleTransaction,
  EDGAR_PUBLICATION_JOURNAL_SCHEMA,
  EDGAR_FRESHNESS_MARKER_SCHEMA,
  EDGAR_LANE_ID,
  EDGAR_LKG_KEY,
  EDGAR_PERSISTENCE_POLICY,
};
