#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EDGAR_PUBLICATION_JOURNAL_SCHEMA,
  FOREIGN_FORM_SECTION_REQUESTS,
  applyPersistenceToExistingManifest,
  mergeFilings,
  recoverJsonBundleTransaction,
  retainLatestFilingDates,
  runEdgarFilingTimeline,
  writeJsonBundleTransaction,
} from "./build-edgar-filing-timeline.mjs";
import { validateAttemptShard } from "./build-data-supply-detection-floor.mjs";
import { DATA_SUPPLY_DETECTION_CONFIG } from "./lib/data-supply-detection-config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OBSERVED_AT = "2026-07-15T02:00:00Z";
const ATTEMPT_ID = "edgar-filings-test-1";

function response(statusCode, document) {
  return {
    statusCode,
    body: typeof document === "string" ? document : JSON.stringify(document),
  };
}

function pathsFor(root) {
  return {
    analyzerPath: path.join(root, "data/global-scouter/core/stocks_analyzer.json"),
    edgarCachePath: path.join(root, "data/edgar/company_tickers.json"),
    summaryRoot: path.join(root, "data/edgar-korean-summaries"),
    publicSummaryRoot: path.join(root, "100xfenok-next/public/data/edgar-korean-summaries"),
    attemptShardPath: path.join(root, "data/admin/data-supply-state/detection-attempts/edgar_filings.json"),
  };
}

function companyTickers() {
  return {
    0: { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" },
    1: { cik_str: 320193, ticker: "AAPL", title: "APPLE INC" },
    2: { cik_str: 1973239, ticker: "ARM", title: "ARM HOLDINGS PLC" },
  };
}

function submissions(form = ["10-Q"]) {
  return {
    name: "NVIDIA CORP",
    filings: {
      recent: {
        form,
        accessionNumber: ["0001045810-26-000001"],
        primaryDocument: ["nvda-20260714.htm"],
        filingDate: ["2026-07-14"],
        reportDate: ["2026-06-30"],
      },
    },
  };
}

function foreignSubmissions() {
  return {
    name: "ARM HOLDINGS PLC",
    filings: {
      recent: {
        form: ["6-K", "20-F", "S-1"],
        accessionNumber: [
          "0001973239-26-000060",
          "0001973239-26-000097",
          "0001973239-26-000120",
        ],
        primaryDocument: [
          "arm-form6k.htm",
          "arm-20260331.htm",
          "arm-s1.htm",
        ],
        filingDate: ["2026-06-05", "2026-05-26", "2026-05-20"],
        reportDate: ["2026-06-05", "2026-03-31", "2026-05-20"],
      },
    },
  };
}

const edgar = DATA_SUPPLY_DETECTION_CONFIG.lanes.find((lane) => lane.id === "edgar_filings");
assert.deepEqual(edgar.endpoint_contract.assertions, [{
  id: "recent_form_array",
  kind: "type",
  pointer: "/filings/recent/form",
  expected: "array",
}]);

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-ready-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: ATTEMPT_ID,
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  });
  assert.equal(result.ok, true);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.lane_id, "edgar_filings");
  assert.equal(shard.attempts[0].attempt_id, ATTEMPT_ID);
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "recent_form_array", passed: true }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(paths.summaryRoot, "index.json"), "utf8")).tickers.includes("NVDA"), true);
  assert.deepEqual(
    fs.readFileSync(path.join(paths.summaryRoot, "by-ticker/nvda.json")),
    fs.readFileSync(path.join(paths.publicSummaryRoot, "by-ticker/nvda.json")),
  );
}

// Foreign submissions retain a bound ticker/form/CIK/accession/archive URL
// identity and carry the section contract used by downstream summary QA.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-foreign-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "ARM", "--forms", "6-K,20-F,40-F", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-foreign",
    request: async (url) => {
      if (url.includes("company_tickers")) return response(200, companyTickers());
      return url.includes("CIK0001973239")
        ? response(200, foreignSubmissions())
        : response(200, submissions());
    },
  });
  assert.equal(result.ok, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.summaryRoot, "by-ticker/arm.json"), "utf8"));
  assert.deepEqual(manifest.filings.map((row) => row.form), ["6-K", "20-F"]);
  assert.deepEqual(manifest.filings.map((row) => row.sectionsRequested), [
    FOREIGN_FORM_SECTION_REQUESTS["6-K"],
    FOREIGN_FORM_SECTION_REQUESTS["20-F"],
  ]);
  for (const row of manifest.filings) {
    assert.equal(row.ticker, "ARM");
    assert.equal(row.cik, "0001973239");
    assert.match(row.accession, /^\d{10}-\d{2}-\d{6}$/);
    assert.match(
      row.sourceUrl,
      new RegExp("/Archives/edgar/data/1973239/" + row.accession.replace(/-/g, "") + "/"),
    );
    assert.equal(row.summaryStatus, "pending");
    assert.equal(row.summaryPath, null);
  }
}

// A form with no current rows remains an honest pending/empty manifest; the
// builder must not fabricate a ready 40-F artifact.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-foreign-zero-40f-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "ARM", "--forms", "40-F", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-foreign-zero-40f",
    request: async (url) => {
      if (url.includes("company_tickers")) return response(200, companyTickers());
      return url.includes("CIK0001973239")
        ? response(200, foreignSubmissions())
        : response(200, submissions(["40-F"]));
    },
  });
  assert.equal(result.ok, true);
  const manifest = JSON.parse(fs.readFileSync(path.join(paths.summaryRoot, "by-ticker/arm.json"), "utf8"));
  assert.deepEqual(manifest.filings, []);
  assert.equal(manifest.summaryStatus, "pending");
}

// Foreign identity conflicts fail closed, while a ready row keeps its
// previously published SEC source URL when discovery returns another exhibit.
{
  const accession = "0001973239-26-000060";
  const archiveAccession = accession.replace(/-/g, "");
  const primaryUrl = "https://www.sec.gov/Archives/edgar/data/1973239/" + archiveAccession + "/arm-form6k.htm";
  const exhibitUrl = "https://www.sec.gov/Archives/edgar/data/1973239/" + archiveAccession + "/arm-exhibit.htm";
  const ready = {
    ticker: "ARM",
    companyName: "ARM HOLDINGS PLC",
    cik: "0001973239",
    form: "6-K",
    accession,
    filingDate: "2026-06-05",
    periodEnd: "2026-06-05",
    title: "ARM HOLDINGS PLC 6-K (2026-06-05)",
    summaryPath: "/data/edgar-korean-summaries/pilot/arm-6-k.json",
    translationPath: null,
    sourceUrl: primaryUrl,
    summaryStatus: "ready",
    translationStatus: "not_available",
  };
  const merged = mergeFilings({
    ticker: "ARM",
    companyName: "ARM HOLDINGS PLC",
    cik: "0001973239",
    existingManifest: { filings: [ready] },
    discoveredRows: [{ ...ready, summaryPath: null, sourceUrl: exhibitUrl }],
    updated: "2026-07-18",
  });
  assert.equal(merged.filings[0].sourceUrl, primaryUrl);
  for (const candidate of [
    { ...ready, ticker: undefined, summaryPath: null },
    { ...ready, ticker: "NVDA", summaryPath: null },
    { ...ready, cik: "0001086888", sourceUrl: "https://www.sec.gov/Archives/edgar/data/1086888/" + archiveAccession + "/other.htm", summaryPath: null },
    { ...ready, cik: "x0001973239", summaryPath: null },
    { ...ready, sourceUrl: "https://example.com/filing", summaryPath: null },
  ]) {
    assert.throws(
      () => mergeFilings({
        ticker: "ARM",
        companyName: "ARM HOLDINGS PLC",
        cik: "0001973239",
        existingManifest: null,
        discoveredRows: [candidate],
        updated: "2026-07-18",
      }),
      /foreign filing/,
    );
  }
  const domestic = { ...ready, form: "8-K", summaryPath: null };
  assert.throws(
    () => mergeFilings({
      ticker: "ARM",
      companyName: "ARM HOLDINGS PLC",
      cik: "0001973239",
      existingManifest: null,
      discoveredRows: [ready, domestic],
      updated: "2026-07-18",
    }),
    /domestic\/foreign filing identity conflict/,
  );
  assert.throws(
    () => mergeFilings({
      ticker: "ARM",
      companyName: "ARM HOLDINGS PLC",
      cik: "0001973239",
      existingManifest: null,
      discoveredRows: [domestic, ready],
      updated: "2026-07-18",
    }),
    /domestic\/foreign filing identity conflict/,
  );
  assert.throws(
    () => mergeFilings({
      ticker: "ARM",
      companyName: "ARM HOLDINGS PLC",
      cik: "0001973239",
      existingManifest: { cik: "0001973239", filings: [domestic] },
      discoveredRows: [ready],
      updated: "2026-07-18",
    }),
    /domestic\/foreign filing identity conflict/,
  );
  assert.throws(
    () => mergeFilings({
      ticker: "ARM",
      companyName: "ARM HOLDINGS PLC",
      cik: "0001973239",
      existingManifest: { cik: "0001973239", filings: [ready] },
      discoveredRows: [domestic],
      updated: "2026-07-18",
    }),
    /domestic\/foreign filing identity conflict/,
  );
  assert.throws(
    () => mergeFilings({
      ticker: "ARM",
      companyName: "ARM HOLDINGS PLC",
      cik: "0001973239",
      existingManifest: { cik: "0001086888", filings: [ready] },
      discoveredRows: [ready],
      updated: "2026-07-18",
    }),
    /manifest\/discovery CIK conflict/,
  );
  assert.throws(
    () => mergeFilings({
      ticker: "ARM",
      companyName: "ARM HOLDINGS PLC",
      cik: "0001973239",
      existingManifest: null,
      discoveredRows: [
        { ...ready, summaryPath: null },
        {
          ...ready,
          cik: "0001086888",
          sourceUrl: "https://www.sec.gov/Archives/edgar/data/1086888/" + archiveAccession + "/other.htm",
        },
      ],
      updated: "2026-07-18",
    }),
    /conflicting foreign filing identity/,
  );
}

// A successful limited poll migrates every pre-existing ticker manifest, even
// when that ticker was not queried in the current acquisition batch.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-tree-migration-"));
  const paths = pathsFor(root);
  const legacyAapl = {
    schemaVersion: 1,
    artifactType: "edgar_korean_summary_ticker_manifest",
    ticker: "AAPL",
    companyName: "APPLE INC",
    cik: "0000320193",
    updated: "2026-06-21",
    source: "legacy source attribution",
    summaryStatus: "partial",
    filings: [{
      accession: "0000320193-26-000001",
      filingDate: "2026-06-20",
      summaryPath: "/legacy/aapl-summary.md",
      translationPath: null,
    }],
  };
  const privateAapl = path.join(paths.summaryRoot, "by-ticker/aapl.json");
  fs.mkdirSync(path.dirname(privateAapl), { recursive: true });
  fs.writeFileSync(privateAapl, `${JSON.stringify(legacyAapl, null, 2)}\n`);

  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-tree-migration",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  });

  assert.equal(result.ok, true);
  const migratedPrivate = JSON.parse(fs.readFileSync(privateAapl, "utf8"));
  const migratedPublicPath = path.join(paths.publicSummaryRoot, "by-ticker/aapl.json");
  const migratedPublic = JSON.parse(fs.readFileSync(migratedPublicPath, "utf8"));
  assert.deepEqual(
    fs.readFileSync(migratedPublicPath),
    fs.readFileSync(privateAapl),
    "unqueried ticker mirrors stay byte-equivalent after migration",
  );
  assert.deepEqual(migratedPublic, migratedPrivate);
  assert.equal(migratedPrivate.updated, legacyAapl.updated, "unqueried acquisition timestamp is preserved");
  assert.equal(migratedPrivate.source, legacyAapl.source, "unqueried provenance is preserved");
  assert.equal(migratedPrivate.summaryStatus, legacyAapl.summaryStatus, "unqueried status is preserved");
  assert.deepEqual(migratedPrivate.filings, legacyAapl.filings, "sparse unqueried filings are preserved");
  assert.equal(migratedPrivate.persistence_policy.max_distinct_filing_dates_per_ticker, 100);
  assert.deepEqual(migratedPrivate.persistence_state, {
    distinct_filing_dates: 1,
    filings_before: 1,
    filings_retained: 1,
    pruned_this_merge: 0,
    total_pruned_filings: 0,
  });
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-plan-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0", "--plan-only"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-plan",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  });
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(paths.attemptShardPath), true, "plan-only still emits attempt evidence");
  assert.equal(fs.existsSync(paths.edgarCachePath), false);
  assert.equal(fs.existsSync(path.join(paths.summaryRoot, "index.json")), false);
}

// If no ticker is acquired successfully, the pending tree migration is not
// published; only the attempt evidence may change.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-migration-no-publish-"));
  const paths = pathsFor(root);
  const legacyAapl = {
    ticker: "AAPL",
    updated: "2026-06-21",
    filings: [{ accession: "legacy-aapl", filingDate: "2026-06-20" }],
  };
  const privateAapl = path.join(paths.summaryRoot, "by-ticker/aapl.json");
  fs.mkdirSync(path.dirname(privateAapl), { recursive: true });
  fs.writeFileSync(privateAapl, `${JSON.stringify(legacyAapl, null, 2)}\n`);
  const before = fs.readFileSync(privateAapl);

  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-migration-no-publish",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(503, "unavailable"),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(fs.readFileSync(privateAapl), before, "failed acquisition leaves legacy canonical bytes untouched");
  assert.equal(
    fs.existsSync(path.join(paths.publicSummaryRoot, "by-ticker/aapl.json")),
    false,
    "failed acquisition does not create a migrated public mirror",
  );
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-partial-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA,AAPL", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-partial",
    request: async (url) => {
      if (url.includes("company_tickers")) return response(200, companyTickers());
      return url.includes("CIK0000320193")
        ? response(429, "rate limited")
        : response(200, submissions());
    },
  });
  assert.equal(result.ok, true, "one valid ticker keeps publishable producer output");
  assert.equal(result.telemetry_reason, "rate_limited");
  assert.equal(fs.existsSync(path.join(paths.summaryRoot, "by-ticker/nvda.json")), true);
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(shard.attempts[0].http_status, 429, "shard retains the partial failure");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-unresolved-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-unresolved",
    request: async () => response(200, {}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unexpected_error");
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.attempts[0].execution, "threw");
}

// A naturally thrown SEC request retains a bounded, sanitized detail on the
// returned failure object; the detection attempt shard remains schema-stable.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-diagnostic-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-diagnostic",
    request: async (url) => {
      if (url.includes("company_tickers")) return response(200, companyTickers());
      const error = new Error("SEC submissions socket reset Bearer secret-token https://sec.example/submissions?token=private");
      error.code = "ECONNRESET";
      throw error;
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "transport_error");
  assert.match(result.failure_detail ?? "", /SEC submissions socket reset/, "natural request failure retains a diagnostic detail");
  assert.ok(result.failure_detail.length <= 320, "diagnostic detail stays bounded");
  assert.equal(result.failure_detail.includes("secret-token"), false, "diagnostic detail redacts bearer credentials");
  assert.equal(result.failure_detail.includes("token=private"), false, "diagnostic detail redacts URL query values");
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(Object.hasOwn(shard.attempts[0], "failure_detail"), false, "attempt shard schema remains unchanged");
}

// A resolved bootstrap with no matching ticker still reports the generic
// unexpected_error with a safe, bounded detail instead of a blank cause.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-no-request-diagnostic-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-no-request-diagnostic",
    request: async () => response(200, {}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unexpected_error");
  assert.match(result.failure_detail ?? "", /no EDGAR submission endpoints were requested/, "no-request fallback retains a safe static detail");
  assert.ok(result.failure_detail.length <= 320, "fallback detail stays bounded");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-guard-failure-"));
  const paths = pathsFor(root);
  fs.mkdirSync(path.dirname(paths.analyzerPath), { recursive: true });
  fs.writeFileSync(paths.analyzerPath, JSON.stringify({ bad: true }), "utf8");
  await assert.rejects(() => runEdgarFilingTimeline({
    argv: [],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-guard",
    request: async () => { throw new Error("request must not run"); },
  }));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.attempts[0].exception_kind, "unexpected");
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-write-failure-"));
  const paths = pathsFor(root);
  const blocker = path.join(root, "summary-root-is-a-file");
  fs.writeFileSync(blocker, "not a directory", "utf8");
  paths.summaryRoot = blocker;
  await assert.rejects(() => runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-write-failure",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  }));
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.equal(validateAttemptShard(shard, "edgar_filings"), true);
  assert.equal(shard.attempts[0].assertions[0].passed, true);
}

// Publication stages every private/public file before replacing any canonical
// target. A failure preparing the public side must leave the private tree and
// its index byte-identical instead of exposing a half-migrated tree.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-atomic-publication-"));
  const paths = pathsFor(root);
  const legacyAapl = {
    ticker: "AAPL",
    updated: "2026-06-21",
    filings: [{ accession: "legacy-aapl", filingDate: "2026-06-20" }],
  };
  const privateAapl = path.join(paths.summaryRoot, "by-ticker/aapl.json");
  const privateIndex = path.join(paths.summaryRoot, "index.json");
  fs.mkdirSync(path.dirname(privateAapl), { recursive: true });
  fs.writeFileSync(privateAapl, `${JSON.stringify(legacyAapl, null, 2)}\n`);
  fs.writeFileSync(privateIndex, `${JSON.stringify({ tickers: ["AAPL"] }, null, 2)}\n`);
  const aaplBefore = fs.readFileSync(privateAapl);
  const indexBefore = fs.readFileSync(privateIndex);
  const publicBlocker = path.join(root, "public-root-is-a-file");
  fs.writeFileSync(publicBlocker, "not a directory", "utf8");
  paths.publicSummaryRoot = publicBlocker;

  await assert.rejects(() => runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-atomic-publication",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions()),
  }));

  assert.deepEqual(fs.readFileSync(privateAapl), aaplBefore, "private manifest rolls back before canonical replacement");
  assert.deepEqual(fs.readFileSync(privateIndex), indexBefore, "private index remains byte-identical");
  assert.deepEqual(
    fs.readdirSync(path.dirname(privateAapl)).sort(),
    ["aapl.json"],
    "staged private files are cleaned after public preparation fails",
  );
}

// A failure after canonical replacement begins restores every file already
// replaced and removes the remaining staged files.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-atomic-rollback-"));
  const first = path.join(root, "first.json");
  const second = path.join(root, "second.json");
  const journalPath = path.join(root, "transaction.json");
  fs.writeFileSync(first, "{\"value\":\"old-first\"}\n");
  fs.writeFileSync(second, "{\"value\":\"old-second\"}\n");
  const firstBefore = fs.readFileSync(first);
  const secondBefore = fs.readFileSync(second);
  let renameCalls = 0;
  const failingFileSystem = Object.create(fs);
  failingFileSystem.renameSync = (...args) => {
    renameCalls += 1;
    if (renameCalls === 4) throw new Error("injected second-target rename failure");
    return fs.renameSync(...args);
  };

  assert.throws(
    () => writeJsonBundleTransaction([
      { filePath: first, payload: { value: "new-first" } },
      { filePath: second, payload: { value: "new-second" } },
    ], { fileSystem: failingFileSystem, journalPath, allowedRoots: [root] }),
    /injected second-target rename failure/,
  );
  assert.deepEqual(fs.readFileSync(first), firstBefore, "first replacement is rolled back");
  assert.deepEqual(fs.readFileSync(second), secondBefore, "uncommitted second target is untouched");
  assert.deepEqual(
    fs.readdirSync(root).sort(),
    ["first.json", "second.json"],
    "transaction temp and rollback files are cleaned",
  );
}

// If rollback itself is interrupted, the durable prepared journal keeps every
// backup needed for the next invocation to restore the old generation.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-journal-recovery-"));
  const first = path.join(root, "first.json");
  const second = path.join(root, "second.json");
  const journalPath = path.join(root, "transaction.json");
  fs.writeFileSync(first, "{\"value\":\"old-first\"}\n");
  fs.writeFileSync(second, "{\"value\":\"old-second\"}\n");
  const firstBefore = fs.readFileSync(first);
  const secondBefore = fs.readFileSync(second);
  let renameCalls = 0;
  const doublyFailingFileSystem = Object.create(fs);
  doublyFailingFileSystem.renameSync = (...args) => {
    renameCalls += 1;
    if (renameCalls === 4 || renameCalls === 6) {
      throw new Error(`injected rename failure ${renameCalls}`);
    }
    return fs.renameSync(...args);
  };

  assert.throws(
    () => writeJsonBundleTransaction([
      { filePath: first, payload: { value: "new-first" } },
      { filePath: second, payload: { value: "new-second" } },
    ], { fileSystem: doublyFailingFileSystem, journalPath, allowedRoots: [root] }),
    /recovery journal retained/,
  );
  assert.equal(fs.existsSync(journalPath), true, "prepared journal survives incomplete rollback");
  const pendingJournal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  const staleLegacyJournalTemp = `${journalPath}.${pendingJournal.transaction_id}.tmp`;
  const staleRolledBackJournalTemp = `${journalPath}.${pendingJournal.transaction_id}.rolled_back.tmp`;
  fs.writeFileSync(staleLegacyJournalTemp, "interrupted legacy phase write");
  fs.writeFileSync(staleRolledBackJournalTemp, "interrupted rolled-back phase write");
  const recovery = recoverJsonBundleTransaction(journalPath, { allowedRoots: [root] });
  assert.deepEqual(recovery, { recovered: true, phase: "rolled_back" });
  assert.deepEqual(fs.readFileSync(first), firstBefore);
  assert.deepEqual(fs.readFileSync(second), secondBefore);
  assert.deepEqual(
    fs.readdirSync(root).sort(),
    ["first.json", "second.json"],
    "one next-run recovery cleans journal, stale phase temps, backups, and staged files",
  );
}

// A tampered recovery journal cannot target paths outside the two approved
// summary roots.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-journal-scope-"));
  const allowedRoot = path.join(root, "allowed");
  const outside = path.join(root, "outside.json");
  const journalPath = path.join(root, "transaction.json");
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.writeFileSync(outside, "{\"protected\":true}\n");
  const outsideBefore = fs.readFileSync(outside);
  const transactionId = "00000000-0000-4000-8000-000000000000";
  const tempPath = path.join(root, `.outside.json.${transactionId}.0.tmp`);
  fs.writeFileSync(journalPath, `${JSON.stringify({
    schema_version: EDGAR_PUBLICATION_JOURNAL_SCHEMA,
    transaction_id: transactionId,
    phase: "prepared",
    entries: [{
      file_path: outside,
      temp_path: tempPath,
      backup_path: null,
    }],
  }, null, 2)}\n`);
  assert.throws(
    () => recoverJsonBundleTransaction(journalPath, { allowedRoots: [allowedRoot] }),
    /journal contract is invalid/,
  );
  assert.deepEqual(fs.readFileSync(outside), outsideBefore);
  assert.equal(fs.existsSync(journalPath), true, "invalid journal is retained for manual inspection");
}

// The initial write path enforces the same roots before creating a journal,
// not only when a later recovery loads one.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-write-scope-"));
  const allowedRoot = path.join(root, "allowed");
  const outside = path.join(root, "outside.json");
  const journalPath = path.join(root, "transaction.json");
  fs.mkdirSync(allowedRoot, { recursive: true });
  assert.throws(
    () => writeJsonBundleTransaction([
      { filePath: outside, payload: { escaped: true } },
    ], { journalPath, allowedRoots: [allowedRoot] }),
    /outside the allowed roots/,
  );
  assert.equal(fs.existsSync(outside), false);
  assert.equal(fs.existsSync(journalPath), false);
}

// Lexically in-root paths are still rejected when an existing symlinked parent
// resolves outside the approved root, for both fresh writes and journal replay.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-symlink-scope-"));
  const allowedRoot = path.join(root, "allowed");
  const outsideRoot = path.join(root, "outside");
  const link = path.join(allowedRoot, "link");
  const victim = path.join(outsideRoot, "victim.json");
  const targetThroughLink = path.join(link, "victim.json");
  const journalPath = path.join(root, "transaction.json");
  fs.mkdirSync(allowedRoot, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });
  fs.writeFileSync(victim, "{\"protected\":true}\n");
  const victimBefore = fs.readFileSync(victim);
  fs.symlinkSync(outsideRoot, link);

  assert.throws(
    () => writeJsonBundleTransaction([
      { filePath: targetThroughLink, payload: { escaped: true } },
    ], { journalPath, allowedRoots: [allowedRoot] }),
    /outside the allowed roots/,
  );

  const transactionId = "00000000-0000-4000-8000-000000000000";
  const tempPath = path.join(link, `.victim.json.${transactionId}.0.tmp`);
  fs.writeFileSync(journalPath, `${JSON.stringify({
    schema_version: EDGAR_PUBLICATION_JOURNAL_SCHEMA,
    transaction_id: transactionId,
    phase: "prepared",
    entries: [{
      file_path: targetThroughLink,
      temp_path: tempPath,
      backup_path: null,
    }],
  }, null, 2)}\n`);
  assert.throws(
    () => recoverJsonBundleTransaction(journalPath, { allowedRoots: [allowedRoot] }),
    /journal contract is invalid/,
  );
  assert.deepEqual(fs.readFileSync(victim), victimBefore);
  assert.equal(fs.existsSync(journalPath), true);
}

// A successful response with zero allowed forms still publishes the manifest
// named by the index, preserving exact index/file parity.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-zero-qualified-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-zero-qualified",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions(["S-1"])),
  });
  assert.equal(result.ok, true);
  const index = JSON.parse(fs.readFileSync(path.join(paths.summaryRoot, "index.json"), "utf8"));
  assert.deepEqual(index.tickers, ["NVDA"]);
  const privateManifest = path.join(paths.summaryRoot, "by-ticker/nvda.json");
  const publicManifest = path.join(paths.publicSummaryRoot, "by-ticker/nvda.json");
  assert.equal(fs.existsSync(privateManifest), true);
  assert.deepEqual(fs.readFileSync(privateManifest), fs.readFileSync(publicManifest));
  assert.deepEqual(JSON.parse(fs.readFileSync(privateManifest, "utf8")).filings, []);
}

{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "edgar-emitter-drift-"));
  const paths = pathsFor(root);
  const result = await runEdgarFilingTimeline({
    argv: ["--tickers", "NVDA", "--sleep", "0"],
    paths,
    observedAt: OBSERVED_AT,
    attemptId: "edgar-filings-test-drift",
    request: async (url) => url.includes("company_tickers")
      ? response(200, companyTickers())
      : response(200, submissions({ not: "an array" })),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "schema_drift");
  const shard = JSON.parse(fs.readFileSync(paths.attemptShardPath, "utf8"));
  assert.deepEqual(shard.attempts[0].assertions, [{ id: "recent_form_array", passed: false }]);
}

{
  const workflow = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/fetch-edgar-filings.yml"), "utf8");
  assert.match(workflow, /node scripts\/test-build-edgar-filing-timeline\.mjs/);
  assert.match(workflow, /node scripts\/test-build-edgar-lkg-recovery\.mjs/);
  assert.match(workflow, /detection-attempts\/edgar_filings\.json/);
  assert.match(workflow, /10-K,10-Q,8-K,20-F,40-F,6-K/);
  assert.match(workflow, /qa:edgar-translations/);
  assert.match(workflow, /- name: Commit and push\n\s+if: \$\{\{ always\(\) \}\}/);
  assert.doesNotMatch(workflow, /git add -A/);
}

// --- Bounded persistence (P): merged timelines are capped per ticker --------
{
  const dayMs = 24 * 60 * 60 * 1000;
  const dateAt = (index) => new Date(Date.UTC(2025, 0, 1) + index * dayMs).toISOString().slice(0, 10);
  const filing = (index, extra = {}) => ({
    accession: `acc-${index}`,
    filingDate: dateAt(index),
    form: "8-K",
    summaryPath: null,
    translationPath: null,
    ...extra,
  });

  // cap enforcement + eviction order: 105 distinct dates -> newest 100 retained,
  // oldest filingDate evicted first.
  const existingManifest = {
    filings: Array.from({ length: 105 }, (_, index) => filing(index)),
  };
  const discovered = [filing(105), filing(106)];
  const merged = mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest,
    discoveredRows: discovered,
    updated: "2026-07-18",
  });
  assert.equal(merged.filings.length, 100, "merged timeline is bounded at the cap");
  const retainedDates = new Set(merged.filings.map((row) => row.filingDate));
  assert.equal(retainedDates.size, 100);
  assert.equal(retainedDates.has(dateAt(0)), false, "oldest filingDate is evicted first");
  assert.equal(retainedDates.has(dateAt(6)), false);
  assert.equal(retainedDates.has(dateAt(7)), true, "newest 100 distinct dates are retained");
  assert.equal(retainedDates.has(dateAt(106)), true);
  assert.equal(merged.filings[0].filingDate, dateAt(106), "descending order preserved");
  assert.equal(merged.persistence_policy.max_distinct_filing_dates_per_ticker, 100);
  assert.equal(merged.persistence_state.distinct_filing_dates, 107);
  assert.equal(merged.persistence_state.filings_before, 107);
  assert.equal(merged.persistence_state.filings_retained, 100);
  assert.equal(merged.persistence_state.pruned_this_merge, 7);
  assert.equal(merged.persistence_state.total_pruned_filings, 7);

  // sparse-ticker non-eviction: a ticker below the cap is never pruned.
  const sparse = mergeFilings({
    ticker: "AAPL",
    companyName: "APPLE INC",
    cik: "0000320193",
    existingManifest: { filings: [filing(1), filing(2), filing(3)] },
    discoveredRows: [],
    updated: "2026-07-18",
  });
  assert.equal(sparse.filings.length, 3, "sparse tickers are never evicted");
  assert.equal(sparse.persistence_state.pruned_this_merge, 0);

  // idempotency: merging the capped result with no new discoveries is a no-op.
  const again = mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest: merged,
    discoveredRows: [],
    updated: "2026-07-19",
  });
  assert.deepEqual(
    again.filings.map((row) => row.accession),
    merged.filings.map((row) => row.accession),
    "re-running the cap is idempotent",
  );
  assert.equal(again.persistence_state.pruned_this_merge, 0);
  assert.equal(again.persistence_state.total_pruned_filings, 7, "cumulative prune count is stable under idempotent re-runs");

  // malformed dates fail closed.
  assert.throws(() => mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest: { filings: [{ accession: "bad-1", filingDate: "not-a-date" }] },
    discoveredRows: [],
    updated: "2026-07-18",
  }), /invalid EDGAR persistence filingDate/, "a malformed filingDate must fail closed");
  assert.throws(() => mergeFilings({
    ticker: "NVDA",
    companyName: "NVIDIA CORP",
    cik: "0001045810",
    existingManifest: null,
    discoveredRows: [filing(1, { filingDate: "2026-13-40" })],
    updated: "2026-07-18",
  }), /invalid EDGAR persistence filingDate/);

  // retainLatestFilingDates rejects a non-positive cap outright.
  assert.throws(() => retainLatestFilingDates([], { max_distinct_filing_dates_per_ticker: 0 }), /invalid EDGAR persistence/);

  // Existing-manifest migration preserves metadata, prunes once, and keeps the
  // cumulative counter stable on subsequent applications.
  const legacy = {
    ticker: "NVDA",
    updated: "2026-06-21",
    source: "legacy source",
    summaryStatus: "partial",
    filings: Array.from({ length: 105 }, (_, index) => filing(index)),
  };
  const migrated = applyPersistenceToExistingManifest(legacy);
  assert.equal(migrated.updated, legacy.updated);
  assert.equal(migrated.source, legacy.source);
  assert.equal(migrated.summaryStatus, legacy.summaryStatus);
  assert.equal(migrated.filings.length, 100);
  assert.equal(migrated.persistence_state.pruned_this_merge, 5);
  assert.equal(migrated.persistence_state.total_pruned_filings, 5);
  const migratedAgain = applyPersistenceToExistingManifest(migrated);
  assert.deepEqual(migratedAgain.filings, migrated.filings);
  assert.equal(migratedAgain.persistence_state.pruned_this_merge, 0);
  assert.equal(migratedAgain.persistence_state.total_pruned_filings, 5);
  assert.throws(
    () => applyPersistenceToExistingManifest({
      ticker: "BROKEN",
      filings: [{ accession: "bad", filingDate: "2026-99-99" }],
    }),
    /invalid EDGAR persistence filingDate/,
    "an unqueried malformed manifest blocks the full-tree migration",
  );
  assert.throws(
    () => applyPersistenceToExistingManifest({
      ticker: "NORMALIZED-BAD-DATE",
      filings: [{ accession: "bad", filingDate: "2026-02-30" }],
    }),
    /invalid EDGAR persistence filingDate/,
    "calendar-overflow dates must not pass through Date normalization",
  );
}

console.log("test-build-edgar-filing-timeline: ok");
