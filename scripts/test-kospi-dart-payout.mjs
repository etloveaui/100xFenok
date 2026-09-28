#!/usr/bin/env node
/**
 * test-kospi-dart-payout.mjs — focused tests for the KOSPI DART payout lane:
 * parser (alotMatter + corpCode.xml + zip), duplicates, units, share classes,
 * exact-stock-code mapping, coverage, stale FY, API errors, deterministic
 * aggregation, secret redaction, resume/retry, and the public artifact
 * contract. No network, no committed data mutation, no API key.
 *
 * Fixtures carry `synthetic: true`; synthetic-yield values are never labeled
 * "measured".
 *
 * Run: node scripts/test-kospi-dart-payout.mjs
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  API_KEY_ENV,
  BACKOFF_MAX_MS,
  BACKOFF_BASE_MS,
  MAX_FETCH_ATTEMPTS,
  MIN_COVERAGE,
  PAYOUT_ARTIFACT_SCHEMA,
  PAYOUT_POINTER_SCHEMA,
  REQUEST_INTERVAL_MS,
  ANNUAL_FILING_MAX_AGE_DAYS,
  aggregateKospiDartPayout,
  buildAlotMatterUrl,
  buildIndexArtifact,
  buildCurrentPointer,
  constants,
  defaultFiscalYear,
  parseAlotMatterList,
  parseCorpCodeXml,
  redactApiKey,
  redactCrtfcKey,
  unzipCorpCodeXml,
  unzipFirstEntry,
} from "./lib/kospi-dart-payout.mjs";

import {
  ARTIFACT_DIR_REL,
  CURRENT_POINTER_REL,
  PRIVATE_DART_REL,
  fetchAlotMatterWithRetry,
  loadKrxWeights,
  parseArgs,
  runKospiDartPayout,
  backoffMs,
} from "./fetch-kospi-dart-payout.mjs";

const closeTo = (actual, expected, tol = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} !~ ${expected} (tol ${tol})`);

let passed = 0;
const failures = [];
const registeredTests = [];
const TEST_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function test(name, fn) {
  registeredTests.push({ name, fn });
}

// ---------------------------------------------------------------------------
// Shared fixtures (synthetic — never labeled measured).
// ---------------------------------------------------------------------------

const SYNTH_LABEL = { synthetic: true, provenance: "fixture" };
const SYNTH_FY = 2025;
const SYNTH_STLM_DATE = "2025-12-31";
const PARSE_OPTIONS = { businessYear: SYNTH_FY };

const SYNTH_COMPANIES = [
  { corp_code: "00000001", stock_code: "005930" },
  { corp_code: "00000002", stock_code: "000660" },
  { corp_code: "00000003", stock_code: "005380" },
  { corp_code: "00000004", stock_code: "000270" },
  { corp_code: "00000005", stock_code: "051910" },
];

const SYNTH_WEIGHTS = [
  { code: "005930", weight: 0.4 },
  { code: "000660", weight: 0.25 },
  { code: "005380", weight: 0.15 },
  { code: "000270", weight: 0.12 },
  { code: "051910", weight: 0.08 },
];

const SYNTH_RESPONSES = new Map([
  ["00000001", {
    status: "000",
    list: [
      { rcept_no: "20260301000001", se: "주당현금배당금", stock_knd: "보통주", thstrm: "1444", stlm_dt: SYNTH_STLM_DATE },
      { rcept_no: "20260301000002", se: "현금배당수익률(%)", stock_knd: "우선주", thstrm: "2.1", stlm_dt: SYNTH_STLM_DATE },
      { rcept_no: "20260301000003", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.5", stlm_dt: SYNTH_STLM_DATE },
      { rcept_no: "20260301000004", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.6", stlm_dt: SYNTH_STLM_DATE },
    ],
    ...SYNTH_LABEL,
  }],
  ["00000002", { status: "000", list: [{ rcept_no: "20260302000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "-", stlm_dt: SYNTH_STLM_DATE }], ...SYNTH_LABEL }],
  ["00000003", { status: "000", list: [{ rcept_no: "20260303000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "4.0", stlm_dt: SYNTH_STLM_DATE }], ...SYNTH_LABEL }],
  ["00000004", { status: "000", list: [{ rcept_no: "20260304000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "1.0", stlm_dt: SYNTH_STLM_DATE }], ...SYNTH_LABEL }],
  ["00000005", { status: "019", message: "기타오류", ...SYNTH_LABEL }],
]);

const SYNTH_BENCH = { bestEps: 1197.098, pxLast: 6595.45 };
const SYNTH_AS_OF = "2026-06-01";
const SYNTH_INDEX_YIELD = 0.4 * 0.026 + 0.25 * 0 + 0.15 * 0.04 + 0.12 * 0.01; // 0.0176
const SYNTH_PAYOUT = SYNTH_INDEX_YIELD / (SYNTH_BENCH.bestEps / SYNTH_BENCH.pxLast);

function synthAggregateInputs(overrides = {}) {
  return {
    companies: SYNTH_COMPANIES,
    weights: SYNTH_WEIGHTS,
    responses: SYNTH_RESPONSES,
    bestEps: SYNTH_BENCH.bestEps,
    pxLast: SYNTH_BENCH.pxLast,
    fy: SYNTH_FY,
    asOf: SYNTH_AS_OF,
    ...overrides,
  };
}

const LOW_CONFLICT_WEIGHTS = [
  { code: "005930", weight: 0.02 },
  { code: "000660", weight: 0.25 },
  { code: "005380", weight: 0.15 },
  { code: "000270", weight: 0.12 },
  { code: "051910", weight: 0.46 },
];

const LARGE_CONFLICT_WEIGHTS = [
  { code: "005930", weight: 0.26 },
  { code: "000660", weight: 0.25 },
  { code: "005380", weight: 0.15 },
  { code: "000270", weight: 0.12 },
  { code: "051910", weight: 0.22 },
];

function conflictingAggregateResponses() {
  const responses = new Map(SYNTH_RESPONSES);
  responses.set("00000001", {
    status: "000",
    list: [
      { rcept_no: "20260318001274", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "5.40", stlm_dt: SYNTH_STLM_DATE },
      { rcept_no: "20260318001274", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "-", stlm_dt: SYNTH_STLM_DATE },
    ],
    ...SYNTH_LABEL,
  });
  responses.set("00000005", {
    status: "000",
    list: [{ rcept_no: "20260305000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.0", stlm_dt: SYNTH_STLM_DATE }],
    ...SYNTH_LABEL,
  });
  return responses;
}

// ---- zip helpers (single-entry standard zip, including bit-3 descriptors) --
const TEST_CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < TEST_CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  TEST_CRC32_TABLE[index] = value >>> 0;
}

function testCrc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = TEST_CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(xml, {
  method = 8,
  name = "CORPCODE.xml",
  dataDescriptor = false,
  descriptorSignature = true,
} = {}) {
  const data = Buffer.from(xml, "utf8");
  const nameBuf = Buffer.from(name, "utf8");
  const comp = method === 8 ? zlib.deflateRawSync(data) : data;
  const crc = testCrc32(data);
  const flags = dataDescriptor ? 0x0008 : 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(dataDescriptor ? 0 : crc, 14);
  local.writeUInt32LE(dataDescriptor ? 0 : comp.length, 18);
  local.writeUInt32LE(dataDescriptor ? 0 : data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);

  let descriptor = Buffer.alloc(0);
  if (dataDescriptor) {
    descriptor = Buffer.alloc(descriptorSignature ? 16 : 12);
    let offset = 0;
    if (descriptorSignature) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      offset = 4;
    }
    descriptor.writeUInt32LE(crc, offset);
    descriptor.writeUInt32LE(comp.length, offset + 4);
    descriptor.writeUInt32LE(data.length, offset + 8);
  }

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);

  const localSection = Buffer.concat([local, nameBuf, comp, descriptor]);
  const centralSection = Buffer.concat([central, nameBuf]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  return Buffer.concat([localSection, centralSection, eocd]);
}

function zipOffsets(zip) {
  const eocd = zip.length - 22;
  const central = zip.readUInt32LE(eocd + 16);
  const local = zip.readUInt32LE(central + 42);
  const localNameLength = zip.readUInt16LE(local + 26);
  const localExtraLength = zip.readUInt16LE(local + 28);
  const compressedSize = zip.readUInt32LE(central + 20);
  const data = local + 30 + localNameLength + localExtraLength;
  return { central, data, descriptor: data + compressedSize, eocd, local };
}

function corpCodeXml(companies, { name = "" } = {}) {
  const rows = companies.map((row) =>
    `<list><corp_code>${row.corp_code}</corp_code><corp_name>${row.corp_name ?? name}</corp_name>` +
    `<stock_code>${row.stock_code ?? ""}</stock_code><modify_date>${row.modify_date ?? ""}</modify_date></list>`);
  return `<?xml version="1.0" encoding="UTF-8"?><document>${rows.join("")}</document>`;
}

// ---- fake HTTP + temp repo builders -----------------------------------------
function makeFakeHttp(plan) {
  const calls = [];
  const handler = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/corpCode.xml?")) return plan.corpCode();
    const match = u.match(/[?&]corp_code=(\d+)/);
    const corp = match ? match[1] : "unknown";
    const attempt = calls.filter((value) => value.includes(`corp_code=${corp}`)).length;
    return plan.alotMatter(corp, attempt);
  };
  handler.calls = calls;
  handler.requestedCorps = () => [...new Set(calls.map((u) => (u.match(/[?&]corp_code=(\d+)/) ?? [])[1]).filter(Boolean))];
  return handler;
}

function makeTmpRepo({ bridgeAsOf = "2026-08-06", benchmarkAsOf = "2026-08-04", weights = SYNTH_WEIGHTS } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kospi-dart-test-"));
  const adminDir = path.join(root, "data", "admin");
  const benchDir = path.join(root, "data", "benchmarks");
  const compactBridgeDate = bridgeAsOf.replaceAll("-", "");
  const krxRunRel = path.join("_private", "admin", "fenok-edge-korea", "daily", `krx_daily_${compactBridgeDate}`);
  const krxRawRel = path.join(krxRunRel, "raw", "core_stock_index", "stk_bydd_trd", `${compactBridgeDate}.json`);
  fs.mkdirSync(adminDir, { recursive: true });
  fs.mkdirSync(benchDir, { recursive: true });
  fs.mkdirSync(path.join(root, path.dirname(krxRawRel)), { recursive: true });
  const rawRows = weights.map((row) => ({
    BAS_DD: compactBridgeDate,
    ISU_CD: row.code,
    ISU_NM: `fixture-${row.code}`,
    MKT_NM: "KOSPI",
    MKTCAP: String(Math.round(Number(row.weight) * 1_000_000)),
  }));
  fs.writeFileSync(path.join(root, krxRawRel), JSON.stringify({ OutBlock_1: rawRows }));
  fs.writeFileSync(path.join(root, krxRunRel, "manifest.json"), JSON.stringify({
    market: "Korea",
    source: "KRX_OPEN_API",
    run_id: `krx_daily_${compactBridgeDate}`,
    runtime: { output_root: krxRunRel },
    files: [{
      api_id: "stk_bydd_trd",
      group: "core_stock_index",
      path: krxRawRel,
      status: "success",
      raw_public: false,
      source_date: bridgeAsOf,
    }],
  }));
  fs.writeFileSync(path.join(adminDir, "fenok-edge-korea-krx-daily-index.json"), JSON.stringify({
    schema_version: "fenok-edge-korea-krx-bridge/v1",
    source: "KRX_OPEN_API",
    as_of: bridgeAsOf,
    freshness: { as_of: bridgeAsOf },
    private_artifacts: {
      output_root: krxRunRel,
      top_manifest_path: path.join(krxRunRel, "manifest.json"),
      raw_root: path.join(krxRunRel, "raw"),
    },
    derived_rim_inputs: {
      schema_version: "krx_derived_rim_inputs.v1",
      status: "ready",
      missing: [],
      as_of: bridgeAsOf,
      kospi_weights: {
        source: krxRawRel,
        source_field: "OutBlock_1[MKT_NM=KOSPI].MKTCAP / sum(OutBlock_1[MKT_NM=KOSPI].MKTCAP)",
        raw_public: false,
        as_of: bridgeAsOf,
        row_count: weights.length,
        total_market_cap: Math.round(weights.reduce((sum, row) => sum + Number(row.weight), 0) * 1_000_000),
        denominator: {
          method: "issuer_level_market_cap_sum",
          unit: "KRW",
          value: Math.round(weights.reduce((sum, row) => sum + Number(row.weight), 0) * 1_000_000),
        },
        rows: weights,
      },
    },
  }));
  fs.writeFileSync(path.join(benchDir, "emerging.json"), JSON.stringify({
    sections: { kospi: { name: "KOSPI", data: [
      { date: benchmarkAsOf, px_last: SYNTH_BENCH.pxLast, best_eps: SYNTH_BENCH.bestEps },
    ] } },
  }));
  return root;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// ---------------------------------------------------------------------------
// 1. PARSING — alotMatter rows, units, share classes, filing dates.
// ---------------------------------------------------------------------------

test("parser: selects se='현금배당수익률(%)' only; latest filing (max rcept_no) wins", () => {
  const result = parseAlotMatterList(SYNTH_RESPONSES.get("00000001"), { corpCode: "00000001", businessYear: SYNTH_FY });
  assert.equal(result.ok, true);
  closeTo(result.yieldFraction, 0.026, 1e-9); // 2.6% common-row of the latest filing
  assert.equal(result.filingDate, "2026-03-01");
  assert.equal(result.settlementDate, SYNTH_STLM_DATE);
});

test("parser: percent string converts to fraction ('2.5' -> 0.025)", () => {
  const result = parseAlotMatterList(
    { status: "000", list: [{ rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.5", stlm_dt: SYNTH_STLM_DATE }] },
    PARSE_OPTIONS,
  );
  assert.equal(result.ok, true);
  closeTo(result.yieldFraction, 0.025, 1e-9);
});

test("parser: '-' , '', and '0' are declared zero dividends (valid, not gaps)", () => {
  for (const thstrm of ["-", "", "0"]) {
    const result = parseAlotMatterList(
      { status: "000", list: [{ rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm, stlm_dt: SYNTH_STLM_DATE }] },
      PARSE_OPTIONS,
    );
    assert.equal(result.ok, true, `thstrm=${JSON.stringify(thstrm)}`);
    assert.equal(result.yieldFraction, 0);
  }
});

test("parser: unparsable thstrm row is skipped; all-invalid -> no_common_dividend_row", () => {
  const result = parseAlotMatterList(
    { status: "000", list: [{ rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "N/A", stlm_dt: SYNTH_STLM_DATE }] },
    PARSE_OPTIONS,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_common_dividend_row");
});

test("parser: out-of-band yield (>YIELD_MAX) row is skipped", () => {
  const result = parseAlotMatterList(
    { status: "000", list: [{ rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "200", stlm_dt: SYNTH_STLM_DATE }] },
    PARSE_OPTIONS,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_common_dividend_row");
});

test("parser: share classes — preferred shares ignored; missing stock_knd fails closed", () => {
  const result = parseAlotMatterList(
    {
      status: "000",
      list: [
        { rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "우선주", thstrm: "3.0", stlm_dt: SYNTH_STLM_DATE },
        { rcept_no: "20260301000002", se: "현금배당수익률(%)", thstrm: "1.5", stlm_dt: SYNTH_STLM_DATE },
      ],
    },
    PARSE_OPTIONS,
  );
  assert.equal(result.ok, false);
  assert.equal(result.code, "no_common_dividend_row");
});

test("parser: filing date requires strict 14-digit rcept_no and valid calendar date", () => {
  assert.equal(
    parseAlotMatterList(
      { status: "000", list: [{ rcept_no: "20260315000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.5", stlm_dt: SYNTH_STLM_DATE }] },
      PARSE_OPTIONS,
    ).filingDate,
    "2026-03-15",
  );
  const bad = parseAlotMatterList(
    { status: "000", list: [{ rcept_no: "not-a-date", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.5", stlm_dt: SYNTH_STLM_DATE }] },
    PARSE_OPTIONS,
  );
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "no_common_dividend_row");
  const invalidCalendar = parseAlotMatterList(
    { status: "000", list: [{ rcept_no: "20260230000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.5", stlm_dt: SYNTH_STLM_DATE }] },
    PARSE_OPTIONS,
  );
  assert.equal(invalidCalendar.ok, false);
  assert.equal(invalidCalendar.code, "no_common_dividend_row");
});

test("parser: 6/30 and 12/31 settlement dates are valid for requested business year", () => {
  const june = parseAlotMatterList({
    status: "000",
    list: [{
      rcept_no: "20250918000340",
      se: "현금배당수익률(%)",
      stock_knd: "보통주",
      thstrm: "-",
      stlm_dt: "2025-06-30",
    }],
  }, { corpCode: "00120872", businessYear: 2025 });
  assert.equal(june.ok, true, june.reason);
  assert.equal(june.filingDate, "2025-09-18");
  assert.equal(june.settlementDate, "2025-06-30");

  const december = parseAlotMatterList({
    status: "000",
    list: [{
      rcept_no: "20260315000001",
      se: "현금배당수익률(%)",
      stock_knd: "보통주",
      thstrm: "1.0",
      stlm_dt: "2025-12-31",
    }],
  }, PARSE_OPTIONS);
  assert.equal(december.ok, true, december.reason);
  assert.equal(december.settlementDate, "2025-12-31");
});

test("parser: settlement date is mandatory, calendar-valid, in business year, and not after filing", () => {
  const row = {
    rcept_no: "20250918000340",
    se: "현금배당수익률(%)",
    stock_knd: "보통주",
    thstrm: "-",
  };
  assert.equal(parseAlotMatterList({ status: "000", list: [row] }, PARSE_OPTIONS).code, "invalid_settlement_date");
  assert.equal(parseAlotMatterList({ status: "000", list: [{ ...row, stlm_dt: "2025-02-30" }] }, PARSE_OPTIONS).code, "invalid_settlement_date");
  assert.equal(parseAlotMatterList({ status: "000", list: [{ ...row, stlm_dt: "2024-06-30" }] }, PARSE_OPTIONS).code, "settlement_year_mismatch");
  assert.equal(parseAlotMatterList({ status: "000", list: [{ ...row, rcept_no: "20250315000340", stlm_dt: "2025-06-30" }] }, PARSE_OPTIONS).code, "filing_before_settlement");
  assert.equal(parseAlotMatterList({ status: "000", list: [{ ...row, stlm_dt: "2025-06-30" }] }, {}).code, "invalid_business_year");
  assert.equal(parseAlotMatterList({
    status: "000",
    list: [
      { ...row, rcept_no: "20250301000001" },
      { ...row, rcept_no: "20250918000340", stlm_dt: "2025-06-30" },
    ],
  }, PARSE_OPTIONS).code, "invalid_settlement_date", "an older eligible row cannot hide invalid settlement evidence");
});

test("parser: conflicting latest rows fail deterministically regardless of input order", () => {
  const rowA = { rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.5", stlm_dt: SYNTH_STLM_DATE };
  const rowB = { rcept_no: "20260301000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.6", stlm_dt: SYNTH_STLM_DATE };
  const forward = parseAlotMatterList({ status: "000", list: [rowA, rowB] }, PARSE_OPTIONS);
  const reversed = parseAlotMatterList({ status: "000", list: [rowB, rowA] }, PARSE_OPTIONS);
  assert.equal(forward.code, "conflicting_latest_rows");
  assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
  const settlementConflict = parseAlotMatterList({
    status: "000",
    list: [rowA, { ...rowA, stlm_dt: "2025-06-30" }],
  }, PARSE_OPTIONS);
  assert.equal(settlementConflict.code, "conflicting_latest_rows");
});

test("parser: conflicting latest rows never resolve to a selected or zero value", () => {
  const result = parseAlotMatterList({
    status: "000",
    list: [
      { rcept_no: "20260318001274", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "5.40", stlm_dt: SYNTH_STLM_DATE },
      { rcept_no: "20260318001274", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "-", stlm_dt: SYNTH_STLM_DATE },
    ],
  }, PARSE_OPTIONS);
  assert.equal(result.ok, false);
  assert.equal(result.code, "conflicting_latest_rows");
  assert.equal("yieldFraction" in result, false);
});

test("parser: API error status -> api_error; missing list -> missing_list; non-object -> invalid_api_response", () => {
  assert.equal(parseAlotMatterList({ status: "019" }, PARSE_OPTIONS).code, "api_error");
  assert.equal(parseAlotMatterList({ status: "000" }, PARSE_OPTIONS).code, "missing_list");
  assert.equal(parseAlotMatterList(null, PARSE_OPTIONS).code, "invalid_api_response");
  assert.equal(parseAlotMatterList(undefined, PARSE_OPTIONS).code, "invalid_api_response");
});

// ---- corpCode.xml parsing + zip --------------------------------------------

test("corpcode: parses numeric and alphanumeric exact 6-character stock_code joins", () => {
  const xml = corpCodeXml([
    { corp_code: "00000001", stock_code: "005930", corp_name: "삼성전자" },
    { corp_code: "00000002", stock_code: "", corp_name: "비상장법인" },
    { corp_code: "00000003", stock_code: "000660", corp_name: "SK하이닉스" },
    { corp_code: "01933981", stock_code: "0068Y0", corp_name: "BNK 3 SPAC" },
  ]);
  const result = parseCorpCodeXml(xml);
  assert.equal(result.ok, true);
  assert.deepEqual(result.companies.map((row) => row.stock_code), ["005930", "", "000660", "0068Y0"]);
});

test("corpcode: malformed corp_code or stock_code fails closed", () => {
  assert.equal(parseCorpCodeXml(corpCodeXml([{ corp_code: "123", stock_code: "005930" }])).code, "invalid_corpcode_xml");
  for (const stock_code of ["0068y0", "0068-0", "0068Y", "0068Y00"]) {
    assert.equal(parseCorpCodeXml(corpCodeXml([{ corp_code: "01933981", stock_code }])).code, "invalid_corpcode_xml");
  }
});

test("corpcode: conflicting corp_code or stock_code maps fail closed", () => {
  assert.equal(parseCorpCodeXml(corpCodeXml([
    { corp_code: "00000001", stock_code: "005930" },
    { corp_code: "00000001", stock_code: "005931" },
  ])).code, "invalid_corpcode_xml");
  assert.equal(parseCorpCodeXml(corpCodeXml([
    { corp_code: "00000001", stock_code: "005930" },
    { corp_code: "00000002", stock_code: "005930" },
  ])).code, "invalid_corpcode_xml");
  assert.equal(parseCorpCodeXml("").code, "invalid_corpcode_xml");
});

test("corpcode: non-text body fails closed", () => {
  assert.equal(parseCorpCodeXml(null).code, "invalid_corpcode_xml");
  assert.equal(parseCorpCodeXml(42).code, "invalid_corpcode_xml");
});

test("zip: deflate entry inflates to the xml body", () => {
  const xml = corpCodeXml(SYNTH_COMPANIES);
  const zip = buildZip(xml);
  const result = unzipCorpCodeXml(zip);
  assert.equal(result.ok, true);
  assert.equal(result.xml, xml);
});

test("zip: OpenDART-style bit-3 descriptor uses central sizes when local sizes are zero", () => {
  const xml = corpCodeXml(SYNTH_COMPANIES);
  const zip = buildZip(xml, { dataDescriptor: true });
  const { local } = zipOffsets(zip);
  assert.equal(zip.readUInt16LE(local + 6), 0x0008);
  assert.equal(zip.readUInt16LE(local + 8), 8);
  assert.equal(zip.readUInt32LE(local + 14), 0);
  assert.equal(zip.readUInt32LE(local + 18), 0);
  assert.equal(zip.readUInt32LE(local + 22), 0);
  const result = unzipCorpCodeXml(zip);
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.xml, xml);
});

test("zip: bit-3 descriptor without optional signature is accepted", () => {
  const xml = corpCodeXml(SYNTH_COMPANIES);
  const result = unzipCorpCodeXml(buildZip(xml, { dataDescriptor: true, descriptorSignature: false }));
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.xml, xml);
});

test("zip: stored entry works; unsupported method/name/multiple entries fail closed", () => {
  const xml = corpCodeXml(SYNTH_COMPANIES);
  assert.equal(unzipCorpCodeXml(buildZip(xml, { method: 0 })).ok, true);
  assert.equal(unzipCorpCodeXml(Buffer.from("not a zip")).ok, false);
  assert.equal(unzipFirstEntry(buildZip(xml).subarray(0, 20)).ok, false);
  assert.equal(unzipCorpCodeXml(buildZip(xml, { method: 9 })).ok, false);
  assert.equal(unzipCorpCodeXml(buildZip(xml, { name: "OTHER.xml" })).ok, false);
  const multiple = Buffer.from(buildZip(xml));
  const { eocd } = zipOffsets(multiple);
  multiple.writeUInt16LE(2, eocd + 8);
  multiple.writeUInt16LE(2, eocd + 10);
  assert.equal(unzipCorpCodeXml(multiple).ok, false);
});

test("zip: corrupt central-directory and local-header offsets/sizes fail closed", () => {
  const xml = corpCodeXml(SYNTH_COMPANIES);
  const base = buildZip(xml, { dataDescriptor: true });
  const offsets = zipOffsets(base);

  const centralOffset = Buffer.from(base);
  centralOffset.writeUInt32LE(offsets.central + 1, offsets.eocd + 16);
  assert.equal(unzipCorpCodeXml(centralOffset).ok, false);

  const localOffset = Buffer.from(base);
  localOffset.writeUInt32LE(offsets.central, offsets.central + 42);
  assert.equal(unzipCorpCodeXml(localOffset).ok, false);

  const compressedSize = Buffer.from(base);
  compressedSize.writeUInt32LE(compressedSize.readUInt32LE(offsets.central + 20) + 1, offsets.central + 20);
  assert.equal(unzipCorpCodeXml(compressedSize).ok, false);

  const uncompressedSize = Buffer.from(base);
  uncompressedSize.writeUInt32LE(uncompressedSize.readUInt32LE(offsets.central + 24) + 1, offsets.central + 24);
  assert.equal(unzipCorpCodeXml(uncompressedSize).ok, false);
});

test("zip: corrupt data descriptor and CRC fail closed", () => {
  const xml = corpCodeXml(SYNTH_COMPANIES);
  const base = buildZip(xml, { dataDescriptor: true });
  const offsets = zipOffsets(base);

  const descriptor = Buffer.from(base);
  descriptor.writeUInt32LE(descriptor.readUInt32LE(offsets.descriptor + 8) + 1, offsets.descriptor + 8);
  assert.equal(unzipCorpCodeXml(descriptor).ok, false);

  const crc = Buffer.from(base);
  const wrongCrc = (crc.readUInt32LE(offsets.central + 16) + 1) >>> 0;
  crc.writeUInt32LE(wrongCrc, offsets.central + 16);
  crc.writeUInt32LE(wrongCrc, offsets.descriptor + 4);
  assert.equal(unzipCorpCodeXml(crc).ok, false);
});

// ---------------------------------------------------------------------------
// 2. AGGREGATION — units, mapping, coverage, stale FY, gates, determinism.
// ---------------------------------------------------------------------------

test("aggregate: synthetic exact values (coverage 0.92, yield 0.0176, payout gate)", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs());
  assert.equal(result.ok, true, result.reason);
  closeTo(result.index_dividend_yield, SYNTH_INDEX_YIELD, 1e-9);
  closeTo(result.coverage.covered_weight, 0.92, 1e-9);
  closeTo(result.payout_ratio, SYNTH_PAYOUT, 1e-9);
  assert.equal(result.per_issuer.length, 4, "051910 missing via API error");
  assert.equal(result.first_knowable_at, "2026-03-04T00:00:00Z");
});

test("aggregate: payout formula is weighted_yield / (best_eps / px_last)", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs());
  closeTo(result.earnings_yield, SYNTH_BENCH.bestEps / SYNTH_BENCH.pxLast, 1e-9);
  closeTo(result.payout_ratio, result.index_dividend_yield / result.earnings_yield, 1e-9);
});

test("aggregate: low-weight conflicting issuer is missing with deterministic public diagnostics", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs({
    weights: LOW_CONFLICT_WEIGHTS,
    responses: conflictingAggregateResponses(),
  }));
  assert.equal(result.ok, true, result.reason);
  closeTo(result.coverage.covered_weight, 0.98, 1e-9);
  assert.equal(result.diagnostics.parse_failure_count, 1);
  assert.deepEqual(result.diagnostics.parse_failure_by_code, { conflicting_latest_rows: 1 });
  assert.equal(result.per_issuer.some((row) => row.isu_srt_cd === "005930"), false);
  assert.equal(JSON.stringify(result.diagnostics).includes("005930"), false);
  assert.equal(JSON.stringify(buildIndexArtifact(result).diagnostics).includes("00000001"), false);
});

test("aggregate: conflicting issuer weight above the floor fails coverage", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs({
    weights: LARGE_CONFLICT_WEIGHTS,
    responses: conflictingAggregateResponses(),
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "coverage_below_threshold");
  closeTo(result.coverage, 0.74, 1e-9);
  assert.equal(result.diagnostics.parse_failure_count, 1);
  assert.deepEqual(result.diagnostics.parse_failure_by_code, { conflicting_latest_rows: 1 });
});

test("aggregate: conflicting 5.40 and '-' rows make no guessed contribution", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs({
    weights: LOW_CONFLICT_WEIGHTS,
    responses: conflictingAggregateResponses(),
  }));
  assert.equal(result.ok, true, result.reason);
  // Only B/C/D/E contribute: 0.25*0 + 0.15*0.04 + 0.12*0.01 + 0.46*0.02.
  closeTo(result.index_dividend_yield, 0.0164, 1e-9);
  assert.ok(result.index_dividend_yield < 0.02, "the conflicting 5.40% row must not be included");
});

test("aggregate: invalid requested business year remains a global fatal", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs({ fy: 1999 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_fy");
  const parserResult = parseAlotMatterList(SYNTH_RESPONSES.get("00000002"), { businessYear: 1999 });
  assert.equal(parserResult.code, "invalid_business_year");
});

test("mapping: duplicate stock_code with different corp_code fails closed", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs({
    companies: [...SYNTH_COMPANIES, { corp_code: "99999999", stock_code: "005930" }],
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "invalid_company_row");
});

test("mapping: mixed listed and unlisted empty stock_code rows aggregate successfully", () => {
  const baseline = aggregateKospiDartPayout(synthAggregateInputs());
  const mixed = aggregateKospiDartPayout(synthAggregateInputs({
    companies: [
      ...SYNTH_COMPANIES,
      { corp_code: "00434003", stock_code: "", corp_name: "unlisted fixture" },
    ],
  }));
  assert.equal(mixed.ok, true, mixed.reason);
  assert.equal(JSON.stringify(mixed), JSON.stringify(baseline));
});

test("mapping: malformed nonempty stock_code or its corp_code fails closed", () => {
  for (const company of [
    { corp_code: "01933981", stock_code: "0068-0" },
    { corp_code: "1933981", stock_code: "0068Y0" },
  ]) {
    const result = aggregateKospiDartPayout(synthAggregateInputs({
      companies: [...SYNTH_COMPANIES, company],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_company_row");
  }
});

test("mapping: alphanumeric stock_code joins exactly and conflicting corp_code fails closed", () => {
  const inputs = synthAggregateInputs({
    companies: [...SYNTH_COMPANIES, { corp_code: "01933981", stock_code: "0068Y0" }],
    weights: [...SYNTH_WEIGHTS, { code: "0068Y0", weight: 0.01 }],
    responses: new Map([
      ...SYNTH_RESPONSES,
      ["01933981", {
        status: "000",
        list: [{ rcept_no: "20260315000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "1.0", stlm_dt: SYNTH_STLM_DATE }],
        ...SYNTH_LABEL,
      }],
    ]),
  });
  assert.equal(aggregateKospiDartPayout(inputs).ok, true);

  const conflict = aggregateKospiDartPayout({
    ...inputs,
    companies: [...inputs.companies, { corp_code: "01933981", stock_code: "0068Y1" }],
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "invalid_company_row");
});

test("mapping: company absent from DART list -> missing (coverage hit), never name-matched", () => {
  const partial = SYNTH_COMPANIES.slice(0, 4);
  const result = aggregateKospiDartPayout(synthAggregateInputs({ companies: partial }));
  assert.equal(result.ok, true, result.reason);
  closeTo(result.coverage.covered_weight, 0.92, 1e-9); // 051910 already missing via API error
  assert.equal(result.coverage.missing_not_in_dart + result.coverage.missing_api_error, 1);
});

test("mapping: missing weighted DART code is counted and fails at the coverage gate", () => {
  const result = aggregateKospiDartPayout(synthAggregateInputs({
    companies: SYNTH_COMPANIES.slice(0, 2), // exact mapped weight is only 0.65
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, "coverage_below_threshold");
  closeTo(result.coverage, 0.65, 1e-9);
  assert.equal(result.valid_issuers, 2);
  assert.equal(result.universe_issuers, 5);
});

test("coverage: below 0.75 fails closed; empty responses -> no_valid_issuers", () => {
  const thin = aggregateKospiDartPayout(synthAggregateInputs({
    responses: new Map([["00000001", SYNTH_RESPONSES.get("00000001")]]), // only 0.40 weight
  }));
  assert.equal(thin.ok, false);
  assert.equal(thin.code, "coverage_below_threshold");
  closeTo(thin.coverage, 0.4, 1e-9);

  const none = aggregateKospiDartPayout(synthAggregateInputs({ responses: new Map() }));
  assert.equal(none.code, "no_valid_issuers");
});

test("coverage: minCoverage cannot lower the exported 0.75 floor", () => {
  assert.equal(MIN_COVERAGE, 0.75);
  assert.equal(aggregateKospiDartPayout(synthAggregateInputs({ minCoverage: 0.5 })).code, "invalid_coverage_gate");
  assert.equal(aggregateKospiDartPayout(synthAggregateInputs({ minCoverage: MIN_COVERAGE })).ok, true);
  assert.equal(aggregateKospiDartPayout(synthAggregateInputs({ minCoverage: 1.5 })).code, "invalid_coverage_gate");
  assert.throws(() => parseArgs(["--min-coverage", "0.749999"]), /0\.75 through 1/);
  assert.equal(parseArgs(["--min-coverage", "0.9"]).minCoverage, 0.9);
});

test("gates: nonpositive EPS/price fail closed; tiny EPS overflows payout gate", () => {
  const base = synthAggregateInputs();
  assert.equal(aggregateKospiDartPayout({ ...base, bestEps: 0 }).code, "nonpositive_eps");
  assert.equal(aggregateKospiDartPayout({ ...base, bestEps: -5 }).code, "nonpositive_eps");
  assert.equal(aggregateKospiDartPayout({ ...base, pxLast: 0 }).code, "nonpositive_price");
  const overflow = aggregateKospiDartPayout({ ...base, bestEps: 1 });
  assert.equal(overflow.code, "payout_out_of_gate");
  assert.equal(aggregateKospiDartPayout({ ...base, asOf: "2026-06-01 trailing" }).code, "invalid_asof");
  assert.equal(aggregateKospiDartPayout({ ...base, fyEndDate: "2025-12-31" }).code, "unsupported_fy_end_override");
});

test("settlement semantics: 6/30 issuer aggregates without a December year-end assumption", () => {
  const responses = new Map(SYNTH_RESPONSES);
  responses.set("00000001", {
    status: "000",
    list: [{
      rcept_no: "20250918000340",
      se: "현금배당수익률(%)",
      stock_knd: "보통주",
      thstrm: "-",
      stlm_dt: "2025-06-30",
    }],
    ...SYNTH_LABEL,
  });
  const result = aggregateKospiDartPayout(synthAggregateInputs({ responses }));
  assert.equal(result.ok, true, result.reason);
  const issuer = result.per_issuer.find((row) => row.isu_srt_cd === "005930");
  assert.equal(issuer.filing_date, "2025-09-18");
  assert.equal(issuer.settlement_date, "2025-06-30");
  assert.deepEqual(result.settlement_date_range, { earliest: "2025-06-30", latest: "2025-12-31" });
  assert.equal(result.metadata.annual_filing_freshness.oldest_settlement_date, "2025-06-30");

  const staleSettlement = aggregateKospiDartPayout(synthAggregateInputs({
    weights: LARGE_CONFLICT_WEIGHTS,
    responses: new Map([
      ...responses,
      ["00000005", {
        status: "000",
        list: [{ rcept_no: "20260305000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.0", stlm_dt: SYNTH_STLM_DATE }],
        ...SYNTH_LABEL,
      }],
    ]),
    asOf: "2026-10-01", // filing is 378d old, settlement is 458d old
  }));
  assert.equal(staleSettlement.code, "coverage_below_threshold");
  closeTo(staleSettlement.coverage, 0.74, 1e-9);
  assert.equal(staleSettlement.diagnostics.parse_failure_count, 1);
  assert.deepEqual(staleSettlement.diagnostics.parse_failure_by_code, { stale_filing_freshness: 1 });
});

test("freshness: low-weight stale issuer is missing before contribution", () => {
  const responses = conflictingAggregateResponses();
  responses.set("00000001", {
    status: "000",
    list: [{ rcept_no: "20260401000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "5.40", stlm_dt: "2025-03-31" }],
    ...SYNTH_LABEL,
  });
  const result = aggregateKospiDartPayout(synthAggregateInputs({
    weights: LOW_CONFLICT_WEIGHTS,
    responses,
    asOf: "2026-08-10", // 2025-03-31 settlement is 497 days old
  }));
  assert.equal(result.ok, true, result.reason);
  closeTo(result.coverage.covered_weight, 0.98, 1e-9);
  assert.equal(result.diagnostics.parse_failure_count, 1);
  assert.deepEqual(result.diagnostics.parse_failure_by_code, { stale_filing_freshness: 1 });
  assert.equal(result.per_issuer.some((row) => row.isu_srt_cd === "005930"), false);
  closeTo(result.index_dividend_yield, 0.0164, 1e-9);
  assert.equal(result.first_knowable_at, "2026-03-05T00:00:00Z");
  assert.deepEqual(result.settlement_date_range, { earliest: SYNTH_STLM_DATE, latest: SYNTH_STLM_DATE });
  assert.equal(result.metadata.annual_filing_freshness.oldest_settlement_date, SYNTH_STLM_DATE);
});

test("stale FY: filing before settlement is missing coverage; asOf before last filing fails closed", () => {
  const staleFiling = aggregateKospiDartPayout(synthAggregateInputs({
    responses: new Map([
      ["00000001", { status: "000", list: [{ rcept_no: "20250315000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "2.0", stlm_dt: "2025-06-30" }] }],
      ["00000002", SYNTH_RESPONSES.get("00000002")],
      ["00000003", SYNTH_RESPONSES.get("00000003")],
      ["00000004", SYNTH_RESPONSES.get("00000004")],
    ]),
  }));
  assert.equal(staleFiling.ok, false);
  assert.equal(staleFiling.code, "coverage_below_threshold");
  assert.equal(staleFiling.diagnostics.parse_failure_count, 2);
  assert.deepEqual(staleFiling.diagnostics.parse_failure_by_code, {
    api_error: 1,
    filing_before_settlement: 1,
  });

  const earlyAsOf = aggregateKospiDartPayout(synthAggregateInputs({ asOf: "2026-02-01" }));
  assert.equal(earlyAsOf.ok, false);
  assert.equal(earlyAsOf.code, "no_valid_issuers");
  assert.equal(earlyAsOf.diagnostics.parse_failure_count, 5);
  assert.deepEqual(earlyAsOf.diagnostics.parse_failure_by_code, { api_error: 1, stale_filings: 4 });

  const oldAsOf = aggregateKospiDartPayout(synthAggregateInputs({ asOf: "2027-06-30" }));
  assert.equal(oldAsOf.ok, false);
  assert.equal(oldAsOf.code, "no_valid_issuers");
  assert.equal(oldAsOf.diagnostics.parse_failure_count, 5);
  assert.deepEqual(oldAsOf.diagnostics.parse_failure_by_code, { api_error: 1, stale_filing_freshness: 4 });
  assert.ok(ANNUAL_FILING_MAX_AGE_DAYS > 180, "annual filing gate must be distinct from the old blanket gate");
});

test("determinism: shuffled inputs produce byte-identical output", () => {
  const base = synthAggregateInputs();
  const a = aggregateKospiDartPayout(base);
  const b = aggregateKospiDartPayout({
    ...base,
    companies: [...SYNTH_COMPANIES].reverse(),
    weights: [...SYNTH_WEIGHTS].reverse(),
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("determinism + structure: 943 tracked-admin derived weights load and aggregate order-independently", () => {
  const weights = Array.from({ length: 943 }, (_, index) => ({
    code: String(100000 + index),
    weight: 1 / 943,
  }));
  const root = makeTmpRepo({ weights });
  const loaded = loadKrxWeights(root);
  assert.equal(loaded.rowCount, 943);
  assert.equal(loaded.source, path.join("data", "admin", "fenok-edge-korea-krx-daily-index.json"));
  const companies = loaded.rows.map((row, index) => ({
    corp_code: String(90000000 + index),
    stock_code: String(row.code),
  }));
  const responses = new Map(companies.map((company) => [company.corp_code, {
    status: "000",
    list: [{ rcept_no: "20260315000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "1.88", stlm_dt: SYNTH_STLM_DATE }],
    ...SYNTH_LABEL,
  }]));
  const base = {
    companies,
    weights: loaded.rows,
    responses,
    bestEps: SYNTH_BENCH.bestEps,
    pxLast: SYNTH_BENCH.pxLast,
    fy: 2025,
    asOf: "2026-06-01",
  };
  const a = aggregateKospiDartPayout(base);
  assert.equal(a.ok, true, a.reason);
  closeTo(a.coverage.covered_weight, 1.0, 1e-9);
  closeTo(a.index_dividend_yield, 0.0188, 1e-9);
  const b = aggregateKospiDartPayout({
    ...base,
    companies: [...companies].reverse(),
    weights: [...loaded.rows].reverse(),
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "943-input aggregation must be order-independent");
  assert.equal(JSON.stringify(a).includes("measured"), false, "fixture values must never be labeled measured");
});

// ---------------------------------------------------------------------------
// 3. REDACTION.
// ---------------------------------------------------------------------------

test("redaction: crtfc_key values are masked regardless of key content", () => {
  const url = buildAlotMatterUrl("SUPER-SECRET-TOKEN", "00000001", 2025);
  const cleaned = redactCrtfcKey(`failed to fetch ${url} with status 500`);
  assert.match(cleaned, /crtfc_key=\[REDACTED\]/);
  assert.equal(cleaned.includes("SUPER-SECRET-TOKEN"), false);
});

test("redaction: bare key value is masked anywhere in text", () => {
  assert.equal(redactApiKey("x-apikey-a1b2c3 and more", "a1b2c3"), "x-apikey-[REDACTED] and more");
  assert.equal(redactApiKey("no key", null), "no key");
});

test("redaction: collector error conveys a URL-bearing transport failure without the key", async () => {
  const root = makeTmpRepo();
  const apiKey = "k-sup3rs3cret";
  const leakingRequest = async (url) => {
    throw new Error(`boom while requesting ${url}`);
  };
  const result = await runKospiDartPayout({
    repoRoot: root,
    fy: 2025,
    apiKey,
    request: leakingRequest,
    sleep: async () => {},
    nowIso: "2026-08-10T12:00:00.000Z",
  });
  // corpCode fetch throws first (before per-issuer URL use), but the redaction
  // contract must hold for every error path that can carry a URL.
  assert.equal(result.ok, false);
  assert.equal(result.reason.includes(apiKey), false);
  assert.equal(result.reason.includes("[REDACTED]"), true);
});

test("redaction: URL builder keys are never part of collector summaries", () => {
  const apiKey = "k-n3v3rprint";
  assert.equal(buildAlotMatterUrl(apiKey, "00000001", 2025).includes("crtfc_key=k-" + "n3v3rprint"), true);
  assert.equal(redactCrtfcKey(buildAlotMatterUrl(apiKey, "00000001", 2025)).includes(apiKey), false);
  assert.equal(constants.API_KEY_ENV, "OPEN_DART_API_KEY");
});

// ---------------------------------------------------------------------------
// 4. RESUME / RETRY / RATE LIMIT — collector behavior with injected http.
// ---------------------------------------------------------------------------

function resumePlan() {
  const plan = {
    corpCode() { return { statusCode: 200, body: buildZip(corpCodeXml(SYNTH_COMPANIES)) }; },
    alotMatter(corp, attempt) {
      const common = { stock_knd: "보통주", stlm_dt: SYNTH_STLM_DATE };
      const yields = {
        "00000001": { thstrm: "2.0", rcept: "20260304000001" },
        "00000002": { thstrm: "1.5", rcept: "20260304000002" },
        "00000003": { thstrm: "1.0", rcept: "20260304000003" },
        "00000004": { thstrm: "3.0", rcept: "20260304000004" },
      };
      if (corp === "00000002" && attempt <= 1) return { statusCode: 429, body: "rate limited" };
      if (corp === "00000003" && attempt <= 3 && attempt < 4) {
        return { statusCode: 502, body: "bad gateway" };
      }
      const row = yields[corp];
      if (!row) return { statusCode: 200, body: JSON.stringify({ status: "013", message: "no data" }) };
      return {
        statusCode: 200,
        body: JSON.stringify({
          status: "000",
          list: [{ rcept_no: row.rcept, se: "현금배당수익률(%)", ...common, thstrm: row.thstrm }, { ...SYNTH_LABEL }],
        }),
      };
    },
  };
  // run 2: corp 00000003 succeeds on the first retry attempt.
  const plan2 = {
    corpCode() { throw new Error("corpCode should be served from cache on resume"); },
    alotMatter(corp, attempt) {
      if (corp !== "00000003") throw new Error(`unexpected refetch of ${corp}`);
      return { statusCode: 200, body: "{\"status\":\"000\",\"list\":[{\"rcept_no\":\"20260304000003\",\"se\":\"현금배당수익률(%)\",\"stock_knd\":\"보통주\",\"thstrm\":\"1.0\",\"stlm_dt\":\"2025-12-31\"}]}" };
    },
  };
  return { plan, plan2 };
}

// 4-issuer weight sets so resume runs never depend on the 5th issuer.
const RESUME_WEIGHTS_4 = [
  { code: "005930", weight: 0.4 },
  { code: "000660", weight: 0.25 },
  { code: "005380", weight: 0.15 },
  { code: "000270", weight: 0.2 },
];
const RESUME_WEIGHTS_4_SMALL_A = [
  { code: "005930", weight: 0.1 },
  { code: "000660", weight: 0.3 },
  { code: "005380", weight: 0.25 },
  { code: "000270", weight: 0.35 },
];

{
  const { plan, plan2 } = resumePlan();
  const root = makeTmpRepo({ weights: RESUME_WEIGHTS_4 });
  const sleeps = [];
  const requests1 = makeFakeHttp(plan);

  test("resume/retry: run1 fetches with bounded retries/backoff and writes receipts", async () => {
    const result = await runKospiDartPayout({
      repoRoot: root,
      fy: 2025,
      apiKey: "k-resume",
      request: requests1,
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
      nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(result.ok, true, result.reason);
    // corpCode(1) + A(1) + B(2) + C(3) + D(1)
    const corp502Calls = requests1.calls.filter((url) => url.includes("corp_code=00000003")).length;
    const corp429Calls = requests1.calls.filter((url) => url.includes("corp_code=00000002")).length;
    assert.equal(corp502Calls, 3, "C bounded at MAX_FETCH_ATTEMPTS");
    assert.equal(corp429Calls, 2, "B retried once after 429");
    assert.equal(result.summary.fetched, 4);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.diagnostics.parse_failure_count, 1);
    assert.deepEqual(result.diagnostics.parse_failure_by_code, { api_error: 1 });
    closeTo(result.coverage.covered_weight, 0.85, 1e-9); // A+B+D covered, C missing
    // rate limit (between issuers) + bounded backoff only
    assert.ok(sleeps.every((ms) => ms >= REQUEST_INTERVAL_MS - 1 && ms <= BACKOFF_MAX_MS));
    assert.ok(sleeps.some((ms) => ms > REQUEST_INTERVAL_MS), "retry backoff grew beyond the base interval");
    // receipts persisted privately
    const receiptsPath = path.join(root, PRIVATE_DART_REL, "kospi-alotmatter-fy2025", "receipts.json");
    const receipts = readJson(receiptsPath);
    assert.equal(receipts.receipts["00000002"].status, "done");
    assert.equal(receipts.receipts["00000003"].status, "error");
    const cacheFile = path.join(root, receipts.receipts["00000002"].cached_path);
    assert.ok(fs.existsSync(cacheFile), "raw body cached under _private/admin");
    // Aggregate and exact selector live only under their dedicated public root.
    assert.equal(result.artifactRel, path.join(ARTIFACT_DIR_REL, "fy2025.json"));
    assert.equal(result.currentRel, CURRENT_POINTER_REL);
    assert.ok(fs.existsSync(path.join(root, result.artifactRel)));
    assert.ok(fs.existsSync(path.join(root, result.currentRel)));
  });

  test("resume/retry: run2 resumes done receipts and retries only the failed issuer", async () => {
    const requests2 = makeFakeHttp(plan2);
    const result = await runKospiDartPayout({
      repoRoot: root,
      fy: 2025,
      apiKey: "k-resume",
      request: requests2,
      sleep: () => Promise.resolve(),
      nowIso: "2026-08-10T13:00:00.000Z",
    });
    assert.equal(result.ok, true, result.reason);
    assert.equal(result.summary.resumed, 3, "A/B/D resumed from receipts");
    assert.equal(result.summary.fetched, 1, "only C refetched");
    assert.deepEqual(result.diagnostics, { parse_failure_count: 0, parse_failure_by_code: {} });
    assert.equal(requests2.calls.filter((url) => url.includes("corp_code=00000003")).length, 1);
    closeTo(result.coverage.covered_weight, 1.0, 1e-9);
    // receipts updated: C now done
    const receipts = readJson(path.join(root, PRIVATE_DART_REL, "kospi-alotmatter-fy2025", "receipts.json"));
    assert.equal(receipts.receipts["00000003"].status, "done");
  });
}

{
  test("resume/retry: a corrupted cached body breaks the cohash and refetches", async () => {
    const { plan, plan2 } = resumePlan();
    const root = makeTmpRepo({ weights: RESUME_WEIGHTS_4_SMALL_A });
    const requests1 = makeFakeHttp(plan);
    const run1 = await runKospiDartPayout({
      repoRoot: root, fy: 2025, apiKey: "k-resume",
      request: requests1, sleep: () => Promise.resolve(), nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(run1.ok, true, run1.reason);
    closeTo(run1.coverage.covered_weight, 0.75, 1e-9); // A+B+D exactly at the gate
    const receipts = readJson(path.join(root, PRIVATE_DART_REL, "kospi-alotmatter-fy2025", "receipts.json"));
    const donePath = path.join(root, receipts.receipts["00000001"].cached_path);
    fs.writeFileSync(donePath, "{\"corrupted\":true}");

    // Serve 500 for A so its refetch yields an error receipt -> A missing on run2.
    const requests2 = makeFakeHttp({
      corpCode: () => { throw new Error("unexpected"); },
      alotMatter: (corp, attempt) => {
        if (corp === "00000001") return { statusCode: 500, body: "boom" };
        if (corp === "00000003") return { statusCode: 200, body: "{\"status\":\"000\",\"list\":[{\"rcept_no\":\"20260304000003\",\"se\":\"현금배당수익률(%)\",\"stock_knd\":\"보통주\",\"thstrm\":\"1.0\",\"stlm_dt\":\"2025-12-31\"}]}" };
        throw new Error(`unexpected refetch ${corp}`);
      },
    });
    const run2 = await runKospiDartPayout({
      repoRoot: root, fy: 2025, apiKey: "k-resume",
      request: requests2, sleep: () => Promise.resolve(), nowIso: "2026-08-10T13:00:00.000Z",
    });
    assert.equal(run2.ok, true, run2.reason);
    assert.equal(requests2.calls.filter((url) => url.includes("corp_code=00000001")).length, MAX_FETCH_ATTEMPTS);
    assert.equal(run2.summary.resumed, 2);
    assert.equal(run2.summary.fetched, 2);
    closeTo(run2.coverage.covered_weight, 0.9, 1e-9); // B+C+D (A lost)
  });
}

{
  test("retry: backoff sequence is bounded (cap 8s) and grows 1s -> 2s", () => {
    assert.equal(backoffMs(1), BACKOFF_BASE_MS);
    assert.equal(backoffMs(2), BACKOFF_BASE_MS * 2);
    assert.equal(backoffMs(5), BACKOFF_MAX_MS);
    assert.equal(backoffMs(99), BACKOFF_MAX_MS);
  });

  test("retry: transport errors are retried to the bound then surfaced", async () => {
    let calls = 0;
    const result = await fetchAlotMatterWithRetry({
      corpCode: "00000001",
      apiKey: "k",
      fy: 2025,
      request: () => { calls += 1; throw new Error("socket hang up"); },
      sleep: () => Promise.resolve(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.attempts, MAX_FETCH_ATTEMPTS);
    assert.equal(calls, MAX_FETCH_ATTEMPTS);
  });
}

// ---------------------------------------------------------------------------
// 5. COLLECTOR FAIL-CLOSED INPUT GATES + ARTIFACT CONTRACT.
// ---------------------------------------------------------------------------

{
  test("collector: missing env key fails closed before any request", async () => {
    const root = makeTmpRepo();
    let requests = 0;
    const result = await runKospiDartPayout({
      repoRoot: root, fy: 2025, apiKey: null,
      request: () => { requests += 1; throw new Error("should not be called"); },
      sleep: () => Promise.resolve(), nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "missing_api_key");
    assert.equal(requests, 0);
  });

  test("collector: coverage override below 0.75 fails before filesystem or network", async () => {
    let requests = 0;
    const result = await runKospiDartPayout({
      repoRoot: path.join(os.tmpdir(), "kospi-dart-nonexistent-root"),
      fy: 2025, apiKey: "k", minCoverage: 0.5,
      request: () => { requests += 1; throw new Error("should not be called"); },
      sleep: () => Promise.resolve(), nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "invalid_coverage_gate");
    assert.equal(requests, 0);
  });

  test("collector: missing bridge / benchmark / stale inputs fail closed", async () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kospi-dart-empty-"));
    const noBridge = await runKospiDartPayout({
      repoRoot: emptyRoot, fy: 2025, apiKey: "k",
      request: () => { throw new Error("no network"); }, sleep: () => Promise.resolve(),
      nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(noBridge.ok, false);
    assert.equal(noBridge.code, "missing_input");

    const staleRoot = makeTmpRepo({ bridgeAsOf: "2025-01-01" });
    const staleBridge = await runKospiDartPayout({
      repoRoot: staleRoot, fy: 2025, apiKey: "k",
      request: () => { throw new Error("no network"); }, sleep: () => Promise.resolve(),
      nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(staleBridge.ok, false);
    assert.equal(staleBridge.code, "stale_weights");

    const staleBenchRoot = makeTmpRepo({ benchmarkAsOf: "2025-01-01" });
    const staleBench = await runKospiDartPayout({
      repoRoot: staleBenchRoot, fy: 2025, apiKey: "k",
      request: () => { throw new Error("no network"); }, sleep: () => Promise.resolve(),
      nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(staleBench.code, "stale_benchmark");
  });

  test("collector: coverage below gate fails closed and writes no artifact", async () => {
    const root = makeTmpRepo({ weights: [{ code: "005930", weight: 1 }] }); // universe: only 005930
    // corpCode.xml maps the target, but alotMatter returns "no data" (013),
    // so the issuer is missing -> coverage 0 -> below the gate.
    const plan = {
      corpCode: () => ({ statusCode: 200, body: buildZip(corpCodeXml([{ corp_code: "00000001", stock_code: "005930" }])) }),
      alotMatter: () => ({ statusCode: 200, body: "{\"status\":\"013\",\"message\":\"no data\"}" }),
    };
    const result = await runKospiDartPayout({
      repoRoot: root, fy: 2025, apiKey: "k",
      request: makeFakeHttp(plan), sleep: () => Promise.resolve(),
      nowIso: "2026-08-10T12:00:00.000Z", minCoverage: 0.75,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, "no_valid_issuers");
    assert.equal(fs.existsSync(path.join(root, ARTIFACT_DIR_REL, "fy2025.json")), false);
    assert.equal(fs.existsSync(path.join(root, CURRENT_POINTER_REL)), false);
  });

  test("collector: mixed full master targets listed code and rerun resumes without refetch", async () => {
    const root = makeTmpRepo({ weights: [{ code: "0068Y0", weight: 1 }] });
    const request = makeFakeHttp({
      corpCode: () => ({
        statusCode: 200,
        body: buildZip(corpCodeXml([
          { corp_code: "00434003", stock_code: "", corp_name: "unlisted fixture" },
          { corp_code: "01933981", stock_code: "0068Y0", corp_name: "BNK 3 SPAC" },
        ])),
      }),
      alotMatter: () => ({
        statusCode: 200,
        body: JSON.stringify({
          status: "000",
          list: [{ rcept_no: "20260315000001", se: "현금배당수익률(%)", stock_knd: "보통주", thstrm: "1.0", stlm_dt: SYNTH_STLM_DATE }],
        }),
      }),
    });
    const result = await runKospiDartPayout({
      repoRoot: root, fy: 2025, apiKey: "k", request,
      sleep: () => Promise.resolve(), nowIso: "2026-08-10T12:00:00.000Z",
    });
    assert.equal(result.ok, true, result.reason);
    assert.deepEqual(request.requestedCorps(), ["01933981"]);

    const artifactBefore = fs.readFileSync(path.join(root, result.artifactRel));
    const pointerBefore = fs.readFileSync(path.join(root, result.currentRel));
    const resumed = await runKospiDartPayout({
      repoRoot: root, fy: 2025, apiKey: "k",
      request: () => { throw new Error("all private responses should resume"); },
      sleep: () => Promise.resolve(), nowIso: "2026-08-10T18:00:00.000Z",
    });
    assert.equal(resumed.ok, true, resumed.reason);
    assert.equal(resumed.summary.resumed, 1);
    assert.deepEqual(fs.readFileSync(path.join(root, resumed.artifactRel)), artifactBefore);
    assert.deepEqual(fs.readFileSync(path.join(root, resumed.currentRel)), pointerBefore);
  });
}

test("artifact contract: public index artifact strips per-issuer rows and carries provenance", () => {
  const full = aggregateKospiDartPayout(synthAggregateInputs());
  const artifact = buildIndexArtifact(full);
  assert.equal(artifact.ok, true);
  assert.equal(artifact.schema_version, PAYOUT_ARTIFACT_SCHEMA);
  assert.equal("per_issuer" in artifact, false);
  assert.equal(artifact.per_issuer_rows, 4);
  assert.equal(artifact.coverage.pass, true);
  assert.ok(artifact.payout_ratio >= 0 && artifact.payout_ratio <= 1);
  assert.equal(artifact.metadata.per_issuer_redistribution.includes("never included"), true);
  assert.equal(JSON.stringify(artifact).includes("measured"), false);
  assert.equal(buildIndexArtifact({ ok: false, code: "coverage_below_threshold", reason: "x" }).code, "coverage_below_threshold");
  assert.equal(buildIndexArtifact({
    ...full,
    coverage: { ...full.coverage, gate: 0.5, pass: true },
  }).code, "invalid_coverage_gate");
});

test("artifact contract: current pointer pins one exact FY path, digest, dates, and passing coverage", () => {
  const artifact = buildIndexArtifact(aggregateKospiDartPayout(synthAggregateInputs()));
  const artifactPath = "data/computed/fenok-rim/kospi-dart-payout/fy2025.json";
  const sha256 = "a".repeat(64);
  const pointer = buildCurrentPointer({ artifactPath, artifact, sha256 });
  assert.equal(pointer.schema_version, PAYOUT_POINTER_SCHEMA);
  assert.equal(pointer.selected_artifact, artifactPath);
  assert.equal(pointer.fy, 2025);
  assert.equal(pointer.sha256, sha256);
  assert.equal(pointer.as_of, SYNTH_AS_OF);
  assert.equal(pointer.first_knowable_at, artifact.first_knowable_at);
  assert.deepEqual(pointer.coverage, {
    covered_weight: artifact.coverage.covered_weight,
    gate: MIN_COVERAGE,
    pass: true,
  });
  assert.equal(buildCurrentPointer({ artifactPath: "data/computed/fenok-rim/kospi-dart-payout/fy2024.json", artifact, sha256 }).code, "invalid_artifact_pointer");
  assert.equal(buildCurrentPointer({ artifactPath, artifact, sha256: "bad" }).code, "invalid_artifact_pointer");
  assert.equal(buildCurrentPointer({
    artifactPath,
    artifact: { ...artifact, coverage: { covered_weight: 0.5, gate: 0.5, pass: true } },
    sha256,
  }).code, "invalid_artifact_pointer");
});

test("artifact contract: collector-written artifact holds no per-issuer row and no secret", async () => {
  const { plan } = resumePlan();
  const root = makeTmpRepo();
  const apiKey = "k-artifact-secret";
  const result = await runKospiDartPayout({
    repoRoot: root, fy: 2025, apiKey,
    request: makeFakeHttp(plan), sleep: () => Promise.resolve(),
    nowIso: "2026-08-10T12:00:00.000Z",
  });
  assert.equal(result.ok, true, result.reason);
  const artifactText = fs.readFileSync(path.join(root, result.artifactRel), "utf8");
  const artifact = JSON.parse(artifactText);
  const pointerText = fs.readFileSync(path.join(root, result.currentRel), "utf8");
  const pointer = JSON.parse(pointerText);
  assert.equal("per_issuer" in artifact, false);
  assert.equal(artifactText.includes(apiKey), false);
  assert.equal(artifact.provenance.bridge.source.endsWith("fenok-edge-korea-krx-daily-index.json"), true);
  assert.equal(artifact.provenance.private_cache_root, PRIVATE_DART_REL);
  assert.deepEqual(artifact.settlement_date_range, { earliest: SYNTH_STLM_DATE, latest: SYNTH_STLM_DATE });
  assert.equal(artifact.metadata.annual_filing_freshness.oldest_settlement_date, SYNTH_STLM_DATE);
  assert.match(artifact.provenance.annual_filings.settlement_date_rule, /stlm_dt year equals bsns_year/);
  assert.ok(artifact.covered_weight === undefined || artifact.coverage.pass === true);
  assert.equal("generated_at" in artifact, false);
  assert.equal("cached" in artifact.provenance.corpcode, false);
  assert.equal("resume" in artifact.provenance, false);
  assert.equal(pointer.selected_artifact, result.artifactRel.split(path.sep).join("/"));
  assert.equal(pointer.fy, 2025);
  assert.equal(pointer.sha256, crypto.createHash("sha256").update(artifactText).digest("hex"));
  assert.equal(pointer.sha256, result.artifactSha256);
  assert.equal(pointer.as_of, artifact.asOf);
  assert.equal(pointer.first_knowable_at, artifact.first_knowable_at);
  assert.deepEqual(pointer.coverage, {
    covered_weight: artifact.coverage.covered_weight,
    gate: artifact.coverage.gate,
    pass: true,
  });
  assert.equal(pointerText.includes(apiKey), false);
});

test("automatic workflow is retired while the standalone collector remains available", () => {
  assert.equal(
    fs.existsSync(path.join(TEST_REPO_ROOT, ".github", "workflows", "fetch-kospi-dart-payout.yml")),
    false,
    "DEC-302 must remove the automatic KOSPI DART workflow",
  );
  assert.equal(fs.existsSync(path.join(TEST_REPO_ROOT, "scripts", "fetch-kospi-dart-payout.mjs")), true);
  assert.equal(fs.existsSync(path.join(TEST_REPO_ROOT, "scripts", "test-kospi-dart-payout.mjs")), true);
});

test("defaultFiscalYear: previous calendar year", () => {
  assert.equal(defaultFiscalYear("2026-08-10T12:00:00Z"), 2025);
  assert.equal(defaultFiscalYear("2026-01-01T00:00:00Z"), 2025);
  assert.equal(defaultFiscalYear("garbage"), null);
});

// ---------------------------------------------------------------------------
// 6. Fixture hygiene — synthetic fixture values are never presented as measured.
// ---------------------------------------------------------------------------
{
  test("fixtures: every synthetic fixture is labeled synthetic and never 'measured'", () => {
    const serialized = JSON.stringify({
      responses: [...SYNTH_RESPONSES.entries()],
      weights: SYNTH_WEIGHTS,
      companies: SYNTH_COMPANIES,
    });
    assert.equal(serialized.includes("measured"), false);
    for (const [corp, body] of SYNTH_RESPONSES) {
      if (body && typeof body === "object" && "synthetic" in body) {
        assert.equal(body.synthetic, true);
      }
    }
    assert.equal(SYNTH_LABEL.synthetic, true);
    // And the aggregate metadata makes no measured claim either.
    const artifact = buildIndexArtifact(aggregateKospiDartPayout(synthAggregateInputs()));
    assert.equal(JSON.stringify(artifact).includes("measured"), false);
  });
}

async function runRegisteredTests() {
  for (const { name, fn } of registeredTests) {
    try {
      await fn();
      passed += 1;
      console.log(`PASS ${name}`);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) {
    console.error(`\n${failures.length} of ${passed + failures.length} tests FAILED`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${passed} tests passed.`);
}

await runRegisteredTests();
