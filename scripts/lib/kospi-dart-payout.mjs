/**
 * kospi-dart-payout.mjs — pure KOSPI fiscal-year dividend-yield / payout
 * aggregation from OpenDART (금융감독원) alotMatter.json + corpCode.xml,
 * joined to the exact KRX KOSPI market-cap weights supplied by the tracked
 * admin bridge, which is derived from private raw KRX output. No network, no
 * filesystem, no API key, no clock:
 * every function here is deterministic and dependency-free (Node builtins
 * only).
 *
 * Tier contract (aggregate, index-level):
 *   trailing realised, fiscal-year, current-membership index dividend yield;
 *   payout = index_dividend_yield / (best_eps / px_last); fail closed.
 *
 * The API key (env OPEN_DART_API_KEY) never enters this module. URL builders
 * and collectors that need it must pass it explicitly and must route every
 * log/error string through the redaction helpers below.
 */

import zlib from "node:zlib";

export const SE_CASH_DIVIDEND_YIELD = "현금배당수익률(%)";
export const MIN_COVERAGE = 0.75;
export const PAYOUT_ARTIFACT_SCHEMA = "kospi_dart_payout.v1";
export const PAYOUT_POINTER_SCHEMA = "kospi_dart_payout_pointer.v1";
export const PAYOUT_ARTIFACT_ROOT = "data/computed/fenok-rim/kospi-dart-payout";
export const YIELD_MAX = 0.15; // sanity band for index-level fiscal-year yield
export const PAYOUT_MAX = 1.0;
export const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
export const ISO_INSTANT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
export const KRX_STOCK_CODE_RE = /^[A-Z0-9]{6}$/;

export const API_KEY_ENV = "OPEN_DART_API_KEY";
export const DART_ENDPOINT = "https://opendart.fss.or.kr/api";
export const ALOTMATTER_PATH = "alotMatter.json";
export const CORPCODE_PATH = "corpCode.xml";
export const REPRT_CODE_ANNUAL = "11011"; // 사업보고서 (annual report)

// Rate / retry contract (enforced by the collector, expressed here so tests
// and the workflow share one source of truth).
export const REQUESTS_PER_SECOND = 1;
export const REQUEST_INTERVAL_MS = 1000;
export const MAX_FETCH_ATTEMPTS = 3;
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 8000;

// Freshness gates are intentionally separate. KRX weights are a daily market
// snapshot; annual filings are expected to remain usable across the annual
// reporting cycle and therefore have a different, longer age bound.
export const KRX_WEIGHTS_MAX_AGE_DAYS = 7;
export const BENCHMARK_MAX_AGE_DAYS = 14;
export const ANNUAL_FILING_MAX_AGE_DAYS = 450;

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

export function isRetryableHttp(statusCode) {
  return statusCode === 429 || (Number.isInteger(statusCode) && statusCode >= 500 && statusCode <= 599);
}

export function isKrxStockCode(value) {
  return typeof value === "string" && KRX_STOCK_CODE_RE.test(value);
}

export function isValidCoverageGate(value) {
  return Number.isFinite(value) && value >= MIN_COVERAGE && value <= 1;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Validate a calendar date without allowing Date.parse to normalize invalid
 * input (for example, 2026-02-30 -> a March date).
 */
export function isValidIsoDate(value) {
  if (typeof value !== "string" || !ISO_RE.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return year >= 1900 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * Return the date portion only for a strict ISO date or UTC instant. Arbitrary
 * strings are rejected rather than sliced into a plausible-looking date.
 */
export function toIsoKey(value) {
  if (isValidIsoDate(value)) return value;
  if (typeof value !== "string" || !ISO_INSTANT_RE.test(value)) return null;
  const date = value.slice(0, 10);
  if (!isValidIsoDate(date) || !Number.isFinite(Date.parse(value))) return null;
  return date;
}

export function daysBetween(isoAfter, isoBefore) {
  const after = toIsoKey(isoAfter);
  const before = toIsoKey(isoBefore);
  if (!after || !before) return Number.POSITIVE_INFINITY;
  const a = Date.parse(`${after}T00:00:00Z`);
  const b = Date.parse(`${before}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return (a - b) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Redaction — the only sanctioned way API-key-bearing text leaves this lane.
// ---------------------------------------------------------------------------

/**
 * Mask the value of every crtfc_key query parameter in arbitrary text.
 * Deterministic and key-value-agnostic; safe to run on any log line, error
 * message, or stack trace that could contain a URL.
 */
export function redactCrtfcKey(text) {
  return String(text ?? "").replace(/(crtfc_key=)[^&\s"'`<>]+/g, "$1[REDACTED]");
}

/**
 * Replace exact occurrences of the raw API key value with a placeholder.
 * Belt-and-suspenders for anything that might carry the bare key outside a
 * crtfc_key parameter (e.g. an exception message embedding a full URL).
 */
export function redactApiKey(text, apiKey) {
  if (!apiKey) return String(text ?? "");
  return String(text ?? "").split(apiKey).join("[REDACTED]");
}

export function buildCorpCodeUrl(apiKey) {
  return `${DART_ENDPOINT}/${CORPCODE_PATH}?${new URLSearchParams({ crtfc_key: String(apiKey) })}`;
}

export function buildAlotMatterUrl(apiKey, corpCode, fy) {
  return `${DART_ENDPOINT}/${ALOTMATTER_PATH}?${new URLSearchParams({
    crtfc_key: String(apiKey),
    corp_code: String(corpCode),
    bsns_year: String(fy),
    reprt_code: REPRT_CODE_ANNUAL,
  })}`;
}

// ---------------------------------------------------------------------------
// corpCode.xml — company master (8-digit corp_code -> 6-character KRX stock_code).
// ---------------------------------------------------------------------------

const XML_LIST_RE = /<list>([\s\S]*?)<\/list>/g;
// A requested business year is aggregate-wide configuration. Every other
// parser result belongs to one issuer and therefore becomes a coverage miss;
// the strict parser still decides whether that issuer has a usable row.
const GLOBAL_ANNUAL_PARSE_CODES = new Set(["invalid_business_year"]);
// The four fields DART emits per row are plain text; corp names may carry XML
// entities but only identifier fields matter for the join, so the capture above
// is a deterministic row split and the field extraction below is exact.
function readField(rowText, field) {
  const match = rowText.match(new RegExp(`<${field}>([\\s\\S]*?)<\\/${field}>`));
  return match ? match[1].trim() : "";
}

/**
 * Parse the CORPCODE.xml body (already inflated to UTF-8 text) into DART
 * company rows. Rows are exact uppercase 6-character stock_code joins: malformed rows or a
 * duplicated corp_code/stock_code mapping fail closed rather than guess.
 *
 * @param {string} xmlText  decompressed CORPCODE.xml
 * @returns {{ok:true, companies:Array<{corp_code,stock_code,corp_name,modify_date}>}
 *           |{ok:false, code, reason}}
 */
export function parseCorpCodeXml(xmlText) {
  if (typeof xmlText !== "string") return fail("invalid_corpcode_xml", "corpCode.xml body is not text");
  const rows = [];
  let match;
  XML_LIST_RE.lastIndex = 0;
  while ((match = XML_LIST_RE.exec(xmlText)) !== null) {
    const block = match[1];
    const corpCode = readField(block, "corp_code");
    const stockCode = readField(block, "stock_code");
    const corpName = readField(block, "corp_name");
    const modifyDate = readField(block, "modify_date");
    if (!/^\d{8}$/.test(corpCode)) {
      return fail("invalid_corpcode_xml", "corp_code is not exactly 8 digits");
    }
    if (stockCode !== "" && !isKrxStockCode(stockCode)) {
      return fail("invalid_corpcode_xml", `stock_code is not exactly 6 uppercase alphanumeric characters (corp ${corpCode})`);
    }
    rows.push({ corp_code: corpCode, stock_code: stockCode, corp_name: corpName, modify_date: modifyDate });
  }
  if (rows.length === 0) {
    return fail("invalid_corpcode_xml", "no <list> rows found in corpCode.xml");
  }
  const byCorp = new Map();
  const byStock = new Map();
  for (const row of rows) {
    const prior = byCorp.get(row.corp_code);
    if (prior && (prior.stock_code !== row.stock_code || prior.corp_name !== row.corp_name)) {
      return fail("invalid_corpcode_xml", `duplicate corp_code ${row.corp_code} with conflicting content`);
    }
    byCorp.set(row.corp_code, row);
    if (row.stock_code) {
      const stock = byStock.get(row.stock_code);
      if (stock && stock.corp_code !== row.corp_code) {
        return fail("invalid_corpcode_xml", `duplicate stock_code ${row.stock_code} maps to different corp_code`);
      }
      byStock.set(row.stock_code, row);
    }
  }
  return { ok: true, companies: rows };
}

// ---------------------------------------------------------------------------
// corpCode.xml submission is a zip carrying a single CORPCODE.xml entry.
// ---------------------------------------------------------------------------

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DATA_DESCRIPTOR_SIGNATURE = 0x08074b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const UTF8_FLAG = 0x0800;
const SUPPORTED_FLAGS = DATA_DESCRIPTOR_FLAG | UTF8_FLAG;
const MAX_EOCD_COMMENT_BYTES = 0xffff;
const MAX_CORPCODE_XML_BYTES = 64 * 1024 * 1024;

const CRC32_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  CRC32_TABLE[index] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function findEocdOffset(zipBuffer) {
  const minimum = Math.max(0, zipBuffer.length - 22 - MAX_EOCD_COMMENT_BYTES);
  for (let offset = zipBuffer.length - 22; offset >= minimum; offset -= 1) {
    if (zipBuffer.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY) continue;
    const commentLength = zipBuffer.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === zipBuffer.length) return offset;
  }
  return -1;
}

function readSingleCentralEntry(zipBuffer, eocdOffset) {
  const diskNumber = zipBuffer.readUInt16LE(eocdOffset + 4);
  const centralDisk = zipBuffer.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = zipBuffer.readUInt16LE(eocdOffset + 8);
  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    return fail("invalid_corpcode_zip", "multi-disk zip is unsupported");
  }
  if (totalEntries !== 1) {
    return fail("invalid_corpcode_zip", `corpCode zip must contain exactly one entry (found ${totalEntries})`);
  }
  if (centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    return fail("invalid_corpcode_zip", "ZIP64 metadata is unsupported");
  }
  if (centralOffset + centralSize !== eocdOffset || centralSize < 46) {
    return fail("invalid_corpcode_zip", "central directory bounds are invalid");
  }
  if (centralOffset + 46 > eocdOffset || zipBuffer.readUInt32LE(centralOffset) !== CENTRAL_FILE_HEADER) {
    return fail("invalid_corpcode_zip", "central directory entry is missing or truncated");
  }

  const versionNeeded = zipBuffer.readUInt16LE(centralOffset + 6);
  const flags = zipBuffer.readUInt16LE(centralOffset + 8);
  const method = zipBuffer.readUInt16LE(centralOffset + 10);
  const expectedCrc = zipBuffer.readUInt32LE(centralOffset + 16);
  const compressedSize = zipBuffer.readUInt32LE(centralOffset + 20);
  const uncompressedSize = zipBuffer.readUInt32LE(centralOffset + 24);
  const nameLength = zipBuffer.readUInt16LE(centralOffset + 28);
  const extraLength = zipBuffer.readUInt16LE(centralOffset + 30);
  const commentLength = zipBuffer.readUInt16LE(centralOffset + 32);
  const startDisk = zipBuffer.readUInt16LE(centralOffset + 34);
  const localHeaderOffset = zipBuffer.readUInt32LE(centralOffset + 42);
  const centralEnd = centralOffset + 46 + nameLength + extraLength + commentLength;
  if (centralEnd !== eocdOffset || centralEnd - centralOffset !== centralSize) {
    return fail("invalid_corpcode_zip", "central directory entry length does not match EOCD metadata");
  }
  if (versionNeeded < 10 || versionNeeded > 20 || startDisk !== 0) {
    return fail("invalid_corpcode_zip", "central directory version/disk metadata is unsupported");
  }
  if ((flags & ~SUPPORTED_FLAGS) !== 0) {
    return fail("invalid_corpcode_zip", `unsupported general-purpose flags 0x${flags.toString(16).padStart(4, "0")}`);
  }
  if (![METHOD_STORED, METHOD_DEFLATE].includes(method)) {
    return fail("invalid_corpcode_zip", `unsupported compression method ${method}`);
  }
  if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
    return fail("invalid_corpcode_zip", "ZIP64 entry metadata is unsupported");
  }
  if (uncompressedSize <= 0 || uncompressedSize > MAX_CORPCODE_XML_BYTES) {
    return fail("invalid_corpcode_zip", `uncompressed XML size ${uncompressedSize} is outside the supported bound`);
  }
  if (compressedSize <= 0 || (method === METHOD_STORED && compressedSize !== uncompressedSize)) {
    return fail("invalid_corpcode_zip", "compressed size is invalid for the declared method");
  }

  const nameStart = centralOffset + 46;
  const nameBytes = zipBuffer.subarray(nameStart, nameStart + nameLength);
  const name = nameBytes.toString("utf8");
  if (!nameBytes.equals(Buffer.from(name, "utf8")) || name.toUpperCase() !== "CORPCODE.XML") {
    return fail("invalid_corpcode_zip", `unexpected corpCode zip entry name ${JSON.stringify(name)}`);
  }
  return {
    ok: true,
    entry: {
      compressedSize,
      expectedCrc,
      flags,
      localHeaderOffset,
      method,
      name,
      nameBytes,
      uncompressedSize,
      versionNeeded,
    },
    centralOffset,
  };
}

/**
 * Inflate the single CORPCODE.xml entry from a standard ZIP. EOCD and central
 * directory metadata are authoritative, which supports OpenDART's real bit-3
 * data-descriptor archive where the local header carries zero CRC/sizes.
 * Deterministic and fail-closed: multi-entry/multi-disk/ZIP64 archives,
 * unsupported flags/methods, inconsistent headers/descriptors, invalid bounds,
 * size drift, and CRC drift are rejected.
 *
 * @param {Buffer} zipBuffer
 * @returns {{ok:true, name:string, data:Buffer}|{ok:false, code, reason}}
 */
export function unzipFirstEntry(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length < 22 + 46 + 30) {
    return fail("invalid_corpcode_zip", "empty or truncated zip buffer");
  }
  const eocdOffset = findEocdOffset(zipBuffer);
  if (eocdOffset < 0) return fail("invalid_corpcode_zip", "EOCD record is missing or truncated");
  const central = readSingleCentralEntry(zipBuffer, eocdOffset);
  if (!central.ok) return central;
  const { entry, centralOffset } = central;
  const localOffset = entry.localHeaderOffset;
  if (localOffset + 30 > centralOffset || zipBuffer.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
    return fail("invalid_corpcode_zip", "local header offset/signature is invalid");
  }
  const localVersion = zipBuffer.readUInt16LE(localOffset + 4);
  const localFlags = zipBuffer.readUInt16LE(localOffset + 6);
  const localMethod = zipBuffer.readUInt16LE(localOffset + 8);
  const localCrc = zipBuffer.readUInt32LE(localOffset + 14);
  const localCompressedSize = zipBuffer.readUInt32LE(localOffset + 18);
  const localUncompressedSize = zipBuffer.readUInt32LE(localOffset + 22);
  const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
  const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
  const localNameStart = localOffset + 30;
  const dataStart = localNameStart + localNameLength + localExtraLength;
  if (dataStart > centralOffset) return fail("invalid_corpcode_zip", "local header name/extra bounds are invalid");
  const localNameBytes = zipBuffer.subarray(localNameStart, localNameStart + localNameLength);
  if (localVersion !== entry.versionNeeded
    || localFlags !== entry.flags
    || localMethod !== entry.method
    || !localNameBytes.equals(entry.nameBytes)) {
    return fail("invalid_corpcode_zip", "local and central entry metadata disagree");
  }
  const usesDescriptor = (entry.flags & DATA_DESCRIPTOR_FLAG) !== 0;
  if (usesDescriptor) {
    if ((localCrc !== 0 && localCrc !== entry.expectedCrc)
      || (localCompressedSize !== 0 && localCompressedSize !== entry.compressedSize)
      || (localUncompressedSize !== 0 && localUncompressedSize !== entry.uncompressedSize)) {
      return fail("invalid_corpcode_zip", "bit-3 local header contains conflicting CRC/sizes");
    }
  } else if (localCrc !== entry.expectedCrc
    || localCompressedSize !== entry.compressedSize
    || localUncompressedSize !== entry.uncompressedSize) {
    return fail("invalid_corpcode_zip", "local and central CRC/sizes disagree");
  }

  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > centralOffset) return fail("invalid_corpcode_zip", "compressed entry exceeds central-directory boundary");
  if (usesDescriptor) {
    let descriptorOffset = dataEnd;
    let descriptorBytes = 12;
    if (descriptorOffset + 16 === centralOffset
      && zipBuffer.readUInt32LE(descriptorOffset) === DATA_DESCRIPTOR_SIGNATURE) {
      descriptorOffset += 4;
      descriptorBytes = 16;
    }
    if (dataEnd + descriptorBytes !== centralOffset) {
      return fail("invalid_corpcode_zip", "data descriptor bounds/signature are invalid");
    }
    const descriptorCrc = zipBuffer.readUInt32LE(descriptorOffset);
    const descriptorCompressedSize = zipBuffer.readUInt32LE(descriptorOffset + 4);
    const descriptorUncompressedSize = zipBuffer.readUInt32LE(descriptorOffset + 8);
    if (descriptorCrc !== entry.expectedCrc
      || descriptorCompressedSize !== entry.compressedSize
      || descriptorUncompressedSize !== entry.uncompressedSize) {
      return fail("invalid_corpcode_zip", "data descriptor CRC/sizes disagree with central directory");
    }
  } else if (dataEnd !== centralOffset) {
    return fail("invalid_corpcode_zip", "unexpected bytes between entry data and central directory");
  }

  const compressed = zipBuffer.subarray(dataStart, dataEnd);
  let data;
  if (entry.method === METHOD_STORED) {
    data = compressed;
  } else {
    try {
      data = zlib.inflateRawSync(compressed, { maxOutputLength: entry.uncompressedSize });
    } catch {
      return fail("invalid_corpcode_zip", `deflate inflate failed for ${entry.name}`);
    }
  }
  if (data.length !== entry.uncompressedSize) {
    return fail("invalid_corpcode_zip", "inflated size disagrees with central directory");
  }
  if (crc32(data) !== entry.expectedCrc) {
    return fail("invalid_corpcode_zip", "inflated CRC disagrees with central directory");
  }
  return { ok: true, name: entry.name, data };
}

export function unzipCorpCodeXml(zipBuffer) {
  const entry = unzipFirstEntry(zipBuffer);
  if (!entry.ok) return entry;
  return { ok: true, xml: entry.data.toString("utf8") };
}

// ---------------------------------------------------------------------------
// alotMatter.json — per-company per-FY dividend rows.
// ---------------------------------------------------------------------------

export function parseFilingDate(rceptNo) {
  const digits = String(rceptNo ?? "");
  if (!/^\d{14}$/.test(digits)) return null;
  const date = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidIsoDate(date) ? date : null;
}

/**
 * Parse one company's alotMatter.json response into its common-share cash
 * dividend yield (fraction) for the latest eligible filing.
 *
 * Semantics:
 *  - status !== "000" or a missing list -> api_error / missing_list (fail)
 *  - only se='현금배당수익률(%)' rows are eligible
 *  - only an explicit, unambiguous stock_knd='보통주' row is eligible;
 *    missing or unfamiliar share-class labels are ignored rather than guessed
 *  - thstrm is a percent string: '2.5' -> 0.025; '-', '', or '0' -> 0 (valid
 *    declared zero); anything unparsable or outside [0, YIELD_MAX] is skipped
 *  - rows without a parseable filing date are skipped
 *  - every otherwise eligible row must carry an exact stlm_dt whose calendar
 *    year equals the requested bsns_year, and filing_date must be >= stlm_dt;
 *    latest filing then wins by rcept_no
 *  - latest-receipt rows must agree on yield and settlement date; conflicts
 *    fail closed rather than being resolved by input order
 *
 * @param {object} response  OpenDART alotMatter.json body ({status, list?})
 * @param {object} [options]  {corpCode,businessYear} request context
 * @returns {{ok:true, corpCode, yieldFraction, filingDate, settlementDate}|{ok:false, code}}
 */
export function parseAlotMatterList(response, { corpCode, businessYear } = {}) {
  if (!response || typeof response !== "object") {
    return fail("invalid_api_response", "alotMatter response is not an object");
  }
  if (String(response.status) !== "000") {
    return fail("api_error", `alotMatter status=${response.status}`);
  }
  if (!Array.isArray(response.list)) {
    return fail("missing_list", "alotMatter response has no list");
  }
  if (!Number.isInteger(businessYear) || businessYear < 2000) {
    return fail("invalid_business_year", `businessYear=${businessYear}`);
  }

  const candidates = [];
  for (const row of response.list) {
    if (!row || typeof row !== "object") continue;
    if (row.se !== SE_CASH_DIVIDEND_YIELD) continue;
    const stockKnd = row.stock_knd == null ? "" : String(row.stock_knd).trim();
    if (stockKnd !== "보통주") continue; // missing, preferred, and other classes
    const raw = String(row.thstrm ?? "").trim();
    let yieldFraction;
    if (raw === "" || raw === "-" || raw === "0") {
      yieldFraction = 0; // declared no cash dividend — valid zero
    } else {
      const num = Number(raw);
      if (!Number.isFinite(num)) continue;
      yieldFraction = num / 100; // percent -> fraction
    }
    if (!(yieldFraction >= 0 && yieldFraction <= YIELD_MAX)) continue; // implausible row
    const rceptNo = String(row.rcept_no ?? "");
    const filingDate = parseFilingDate(rceptNo);
    if (!filingDate) continue; // cannot age this row — fail closed
    const settlementDate = String(row.stlm_dt ?? "").trim();
    if (!isValidIsoDate(settlementDate)) {
      return fail("invalid_settlement_date", `${corpCode ?? "unknown corp"}: annual row has invalid stlm_dt`);
    }
    if (Number(settlementDate.slice(0, 4)) !== businessYear) {
      return fail(
        "settlement_year_mismatch",
        `${corpCode ?? "unknown corp"}: stlm_dt ${settlementDate} is not in requested business year ${businessYear}`,
      );
    }
    if (filingDate < settlementDate) {
      return fail(
        "filing_before_settlement",
        `${corpCode ?? "unknown corp"}: filing ${filingDate} precedes settlement ${settlementDate}`,
      );
    }
    candidates.push({ row, yieldFraction, filingDate, rceptNo, settlementDate });
  }
  if (candidates.length === 0) {
    return fail("no_common_dividend_row", "no valid common-share cash dividend yield row");
  }
  const latestReceipt = candidates.reduce(
    (latest, candidate) => (candidate.rceptNo > latest ? candidate.rceptNo : latest),
    candidates[0].rceptNo,
  );
  let selected = null;
  for (const candidate of candidates.filter((item) => item.rceptNo === latestReceipt)) {
    if (selected
      && (selected.yieldFraction !== candidate.yieldFraction
        || selected.settlementDate !== candidate.settlementDate)) {
      return fail("conflicting_latest_rows", `${corpCode ?? "unknown corp"}: latest common-share rows conflict`);
    }
    selected = candidate;
  }
  return {
    ok: true,
    corpCode,
    yieldFraction: selected.yieldFraction,
    filingDate: selected.filingDate,
    settlementDate: selected.settlementDate,
  };
}

// ---------------------------------------------------------------------------
// Aggregation — join DART dividends to exact KRX weights, index yield, payout.
// ---------------------------------------------------------------------------

/**
 * Aggregate per-company DART cash dividend yields with exact KRX market-cap
 * weights into the index-level payout ratio, fail-closed.
 *
 * @param {object} input
 * @param {Array<{corp_code,stock_code}>} input.companies   DART corpCode.xml rows
 * @param {Array<{code,weight}>} input.weights             KRX bridge kospi_weights rows
 * @param {Map<string,object>} input.responses             corp_code -> alotMatter.json body
 * @param {number} input.bestEps                           benchmark forward FY1 EPS
 * @param {number} input.pxLast                            benchmark index price
 * @param {number} input.fy                                fiscal year of the annual reports
 * @param {string} [input.asOf]                            batch run date (ISO); issuer evidence outside its freshness window is missing
 * @param {number} [input.minCoverage=MIN_COVERAGE]
 * @param {number} [input.maxAnnualFilingAgeDays=ANNUAL_FILING_MAX_AGE_DAYS]
 * @returns {{ok:true, ...}|{ok:false, code, reason}}
 */
export function aggregateKospiDartPayout({
  companies,
  weights,
  responses,
  bestEps,
  pxLast,
  fy,
  asOf = null,
  minCoverage = MIN_COVERAGE,
  fyEndDate = null,
  maxAnnualFilingAgeDays = ANNUAL_FILING_MAX_AGE_DAYS,
}) {
  if (!Array.isArray(weights) || weights.length === 0) {
    return fail("missing_weights", "weights array is empty");
  }
  if (!Array.isArray(companies) || companies.length === 0) {
    return fail("missing_companies", "DART company list is empty");
  }
  if (!Number.isInteger(fy) || fy < 2000) return fail("invalid_fy", `fy=${fy}`);
  if (!Number.isFinite(bestEps) || bestEps <= 0) {
    return fail("nonpositive_eps", `bestEps=${bestEps}`);
  }
  if (!Number.isFinite(pxLast) || pxLast <= 0) {
    return fail("nonpositive_price", `pxLast=${pxLast}`);
  }
  if (!isValidCoverageGate(minCoverage)) {
    return fail("invalid_coverage_gate", `minCoverage=${minCoverage}`);
  }
  if (fyEndDate !== null) {
    return fail("unsupported_fy_end_override", "issuer settlement dates must come from each selected OpenDART row");
  }
  if (!Number.isFinite(maxAnnualFilingAgeDays) || maxAnnualFilingAgeDays < 0) {
    return fail("invalid_filing_freshness_gate", `maxAnnualFilingAgeDays=${maxAnnualFilingAgeDays}`);
  }
  const asOfIsoInput = asOf === null ? null : toIsoKey(asOf);
  if (asOf !== null && !asOfIsoInput) {
    return fail("invalid_asof", `asOf=${asOf}`);
  }

  // 1) weight normalization (deterministic; guards input scale errors). Sort by
  //    code BEFORE accumulation so floating-point sums are order-independent.
  const raw = [];
  const seenWeightCodes = new Set();
  for (const row of weights) {
    const code = String(row?.code ?? "").trim();
    const w = Number(row?.weight);
    if (!/^[A-Z0-9]{6}$/.test(code.toUpperCase()) || !Number.isFinite(w) || w < 0) {
      return fail("invalid_weight", `code="${code}" weight=${row?.weight}`);
    }
    const normalizedCode = code.toUpperCase();
    if (seenWeightCodes.has(normalizedCode)) return fail("invalid_weight", `duplicate code="${normalizedCode}"`);
    seenWeightCodes.add(normalizedCode);
    raw.push({ code: normalizedCode, w });
  }
  raw.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  let weightSum = 0;
  for (const { w } of raw) weightSum += w;
  if (!(weightSum > 0)) return fail("invalid_weight", "total weight is not positive");
  const weightByCode = new Map(raw.map((r) => [r.code, r.w / weightSum]));

  // 2) DART company lookup: exact uppercase 6-character stock_code -> 8-digit corp_code.
  const corpByStock = new Map();
  const stockByCorp = new Map();
  for (const c of companies) {
    const stock = String(c?.stock_code ?? "").trim();
    // DART's full master includes unlisted companies with an intentionally
    // empty stock_code. They are outside the exact KRX join and must not turn
    // a valid full-master parse into an aggregate-wide failure.
    if (stock === "") continue;
    const corp = String(c?.corp_code ?? "").trim();
    if (!isKrxStockCode(stock) || !/^\d{8}$/.test(corp)) {
      return fail("invalid_company_row", `stock_code="${stock}" corp_code="${corp}"`);
    }
    const prior = corpByStock.get(stock);
    if (prior && prior !== corp) {
      return fail("invalid_company_row", `duplicate stock_code ${stock} with different corp_code`);
    }
    const priorStock = stockByCorp.get(corp);
    if (priorStock && priorStock !== stock) {
      return fail("invalid_company_row", `duplicate corp_code ${corp} with different stock_code`);
    }
    corpByStock.set(stock, corp);
    stockByCorp.set(corp, stock);
  }

  // 3) join + parse issuer candidates; per-issuer rows are for private/provenance use only.
  let coveredWeight = 0;
  let indexYield = 0;
  let validIssuers = 0;
  let universeWeight = 0;
  let universeIssuers = 0;
  let universeNotInDart = 0;
  let universeApiError = 0;
  let parseFailureCount = 0;
  const parseFailureByCode = new Map();
  const parsedIssuers = [];
  // Production supplies the collector's explicit nowIso, so the batch as-of
  // is fixed before the issuer loop begins.
  let asOfIso = asOfIsoInput;
  const perIssuer = [];
  let lastFilingDate = null;
  let oldestSettlementDate = null;
  let newestSettlementDate = null;

  const recordParseFailure = (code) => {
    const normalizedCode = String(code || "parse_failure");
    parseFailureCount += 1;
    parseFailureByCode.set(normalizedCode, (parseFailureByCode.get(normalizedCode) ?? 0) + 1);
  };
  const diagnostics = () => ({
    parse_failure_count: parseFailureCount,
    parse_failure_by_code: Object.fromEntries(
      [...parseFailureByCode.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  });

  for (const [code, w] of weightByCode) {
    universeWeight += w;
    universeIssuers += 1;
    const corp = corpByStock.get(code);
    if (!corp) {
      universeNotInDart += 1;
      continue; // not in DART list -> missing
    }
    const res = responses?.get(corp);
    if (!res) {
      universeApiError += 1;
      recordParseFailure("api_error");
      continue; // no response at all -> missing
    }
    const parsed = parseAlotMatterList(res, { corpCode: corp, businessYear: fy });
    if (!parsed.ok) {
      if (GLOBAL_ANNUAL_PARSE_CODES.has(parsed.code)) {
        return fail(parsed.code, parsed.reason);
      }
      universeApiError += 1;
      recordParseFailure(parsed.code);
      continue; // api_error / no valid row -> missing
    }
    parsedIssuers.push({ code, weight: w, parsed });
  }

  // Fix the batch as-of before any issuer contributes. Production always
  // supplies the explicit collector nowIso; the fallback retains the pure
  // aggregate's historical optional-asOf behavior for direct callers.
  if (!asOfIso) {
    asOfIso = parsedIssuers.reduce(
      (latest, issuer) => (!latest || issuer.parsed.filingDate > latest ? issuer.parsed.filingDate : latest),
      null,
    );
  }

  // Freshness is issuer-level evidence. A future/stale filing or settlement
  // excludes only that issuer; coverage decides whether the remaining set is
  // sufficient for publication.
  for (const { code, weight: w, parsed } of parsedIssuers) {
    let freshnessFailure = null;
    for (const [label, evidenceDate] of [
      ["filing", parsed.filingDate],
      ["settlement", parsed.settlementDate],
    ]) {
      const age = daysBetween(asOfIso, evidenceDate);
      if (!Number.isFinite(age) || age < 0) {
        freshnessFailure = {
          code: "stale_filings",
          reason: `${code}: ${label} date is after asOf ${asOfIso}`,
        };
        break;
      }
      if (age > maxAnnualFilingAgeDays) {
        freshnessFailure = {
          code: "stale_filing_freshness",
          reason: `${code}: ${label} ${evidenceDate} is ${Math.round(age)} days old (gate ${maxAnnualFilingAgeDays})`,
        };
        break;
      }
    }
    if (freshnessFailure) {
      universeApiError += 1;
      recordParseFailure(freshnessFailure.code);
      continue;
    }

    const yieldFraction = parsed.yieldFraction ?? 0;
    coveredWeight += w;
    validIssuers += 1;
    indexYield += w * yieldFraction; // missing -> 0 per tier contract
    if (!lastFilingDate || parsed.filingDate > lastFilingDate) lastFilingDate = parsed.filingDate;
    if (!oldestSettlementDate || parsed.settlementDate < oldestSettlementDate) oldestSettlementDate = parsed.settlementDate;
    if (!newestSettlementDate || parsed.settlementDate > newestSettlementDate) newestSettlementDate = parsed.settlementDate;
    perIssuer.push({
      isu_srt_cd: code,
      yield: yieldFraction,
      weight: w,
      filing_date: parsed.filingDate,
      settlement_date: parsed.settlementDate,
    });
  }

  if (validIssuers === 0) {
    return fail("no_valid_issuers", "no issuer passed the join", { diagnostics: diagnostics() });
  }
  const coverage = coveredWeight / universeWeight;
  if (coverage < minCoverage) {
    return fail(
      "coverage_below_threshold",
      `coverage ${(coverage * 100).toFixed(2)}% < ${(minCoverage * 100).toFixed(2)}% (valid ${validIssuers}/${universeIssuers})`,
      {
        coverage,
        valid_issuers: validIssuers,
        universe_issuers: universeIssuers,
        diagnostics: diagnostics(),
      },
    );
  }
  if (!(indexYield >= 0 && indexYield <= YIELD_MAX)) {
    return fail("yield_out_of_band", `indexYield=${indexYield}`);
  }

  // 4) payout chain: same formula the RIM builder uses.
  const earningsYield = bestEps / pxLast;
  const payout = indexYield / earningsYield;
  if (!(payout >= 0 && payout <= PAYOUT_MAX)) {
    return fail("payout_out_of_gate", `payout=${payout}`);
  }

  return {
    ok: true,
    fy,
    asOf: asOfIso,
    status: "ready",
    coverage: {
      covered_weight: coverage,
      gate: minCoverage,
      pass: true,
      valid_issuers: validIssuers,
      universe_issuers: universeIssuers,
      missing_not_in_dart: universeNotInDart,
      missing_api_error: universeApiError,
    },
    diagnostics: diagnostics(),
    index_dividend_yield: indexYield,
    payout_ratio: payout,
    earnings_yield: earningsYield,
    first_knowable_at: `${lastFilingDate}T00:00:00Z`,
    settlement_date_range: {
      earliest: oldestSettlementDate,
      latest: newestSettlementDate,
    },
    per_issuer: perIssuer.sort((a, b) => (a.isu_srt_cd < b.isu_srt_cd ? -1 : 1)),
    metadata: {
      tier: "trailing_realised_fy_index_level",
      basis: "sum(w_i * common-share cash dividend yield) over current KRX KOSPI membership",
      missing_treated_as: "zero dividend, excluded from coverage numerator",
      historical_membership_claim: false,
      fiscal_year_rule: "row stlm_dt calendar year must equal requested bsns_year; filing date must be on or after stlm_dt",
      annual_filing_freshness: {
        max_age_days: maxAnnualFilingAgeDays,
        newest_filing_date: lastFilingDate,
        oldest_filing_date: perIssuer.reduce(
          (oldest, issuer) => (!oldest || issuer.filing_date < oldest ? issuer.filing_date : oldest),
          null,
        ),
        newest_settlement_date: newestSettlementDate,
        oldest_settlement_date: oldestSettlementDate,
      },
      per_issuer_redistribution: "never included in the public artifact; retained only in the private raw cache",
      sources: [
        "OpenDART alotMatter.json (금융감독원, official free API)",
        "OpenDART corpCode.xml exact uppercase 6-character stock_code join",
        "KRX private stk_bydd_trd MKTCAP rows (exact issuer-level weights, supplied at runtime)",
      ],
    },
  };
}

/**
 * Reduce a full aggregate result to the public index-level artifact.
 * Fail-closed: a non-ok result propagates as {ok:false, code}; the ok result
 * is returned WITHOUT per-issuer rows so no private per-issuer data ever
 * reaches data/computed. Deterministic (no clock).
 */
export function buildIndexArtifact(result) {
  if (!result?.ok) {
    return {
      ok: false,
      code: result?.code ?? "aggregation_failed",
      reason: result?.reason ?? "aggregation did not succeed",
    };
  }
  if (!isValidCoverageGate(result.coverage?.gate)
    || result.coverage?.pass !== true
    || !Number.isFinite(result.coverage?.covered_weight)
    || result.coverage.covered_weight < result.coverage.gate) {
    return fail("invalid_coverage_gate", "successful aggregate does not carry a passing coverage gate at or above the floor");
  }
  const { per_issuer, ...indexOnly } = result;
  return {
    schema_version: PAYOUT_ARTIFACT_SCHEMA,
    ...indexOnly,
    per_issuer_rows: per_issuer.length, // count only; no row data
  };
}

/**
 * Build the sole mutable selector for deterministic FY artifacts. The caller
 * supplies the SHA-256 of the exact serialized artifact bytes; this function
 * never searches the filesystem or guesses a fiscal year.
 */
export function buildCurrentPointer({ artifactPath, artifact, sha256 }) {
  if (!artifact?.ok || artifact.schema_version !== PAYOUT_ARTIFACT_SCHEMA) {
    return fail("invalid_artifact_pointer", "selected FY artifact is not a successful payout artifact");
  }
  if (!Number.isInteger(artifact.fy) || artifact.fy < 2000) {
    return fail("invalid_artifact_pointer", `fy=${artifact?.fy}`);
  }
  const expectedPath = `${PAYOUT_ARTIFACT_ROOT}/fy${artifact.fy}.json`;
  if (artifactPath !== expectedPath) {
    return fail("invalid_artifact_pointer", `selected_artifact must be ${expectedPath}`);
  }
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    return fail("invalid_artifact_pointer", "selected artifact SHA-256 is invalid");
  }
  const asOf = toIsoKey(artifact.asOf);
  if (!asOf || artifact.asOf !== asOf || !ISO_INSTANT_RE.test(String(artifact.first_knowable_at ?? ""))) {
    return fail("invalid_artifact_pointer", "selected artifact dates are invalid");
  }
  const coverage = artifact.coverage;
  if (!isValidCoverageGate(coverage?.gate)
    || coverage?.pass !== true
    || !Number.isFinite(coverage?.covered_weight)
    || coverage.covered_weight < coverage.gate
    || coverage.covered_weight > 1) {
    return fail("invalid_artifact_pointer", "selected artifact coverage does not pass the enforced floor");
  }
  return {
    schema_version: PAYOUT_POINTER_SCHEMA,
    selected_artifact: artifactPath,
    fy: artifact.fy,
    sha256,
    as_of: asOf,
    first_knowable_at: artifact.first_knowable_at,
    coverage: {
      covered_weight: coverage.covered_weight,
      gate: coverage.gate,
      pass: true,
    },
  };
}

/** Previous calendar year of an ISO instant — the default target fiscal year. */
export function defaultFiscalYear(nowIso) {
  const iso = toIsoKey(nowIso);
  const year = iso ? Number(iso.slice(0, 4)) : null;
  return Number.isInteger(year) && year >= 2000 ? year - 1 : null;
}

export const constants = Object.freeze({
  SE_CASH_DIVIDEND_YIELD,
  MIN_COVERAGE,
  PAYOUT_ARTIFACT_SCHEMA,
  PAYOUT_POINTER_SCHEMA,
  PAYOUT_ARTIFACT_ROOT,
  YIELD_MAX,
  PAYOUT_MAX,
  KRX_WEIGHTS_MAX_AGE_DAYS,
  BENCHMARK_MAX_AGE_DAYS,
  ANNUAL_FILING_MAX_AGE_DAYS,
  API_KEY_ENV,
  DART_ENDPOINT,
  ALOTMATTER_PATH,
  CORPCODE_PATH,
  REPRT_CODE_ANNUAL,
  REQUESTS_PER_SECOND,
  REQUEST_INTERVAL_MS,
  MAX_FETCH_ATTEMPTS,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
});
