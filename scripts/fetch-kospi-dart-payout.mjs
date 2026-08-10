#!/usr/bin/env node
/**
 * fetch-kospi-dart-payout.mjs — annual KOSPI fiscal-year dividend payout
 * collector from OpenDART (금융감독원) with resumable receipts and a
 * fail-closed, index-level aggregate.
 *
 * Schedule: annually, after 5/15 (KOSPI 사업보고서 season ends 3/31, audited
 * filings complete ~5/15). Target FY defaults to the previous calendar year.
 *
 * Pipeline:
 *   1. GET corpCode.xml (zip) -> exact uppercase 6-character stock_code master.
 *   2. Load the exact KRX KOSPI market-cap weights from the tracked admin
 *      bridge's derived_rim_inputs.kospi_weights rows. The bridge is a
 *      public-safe derived surface backed by private raw KRX paths; its schema,
 *      denominator, source field, and freshness envelope are verified before
 *      use. Never synthetic, never name-matched.
 *   3. For each KOSPI issuer (1 req/sec, bounded retries/backoff):
 *      GET alotMatter.json (bsns_year=<fy>, reprt_code=11011); raw bodies are
 *      cached privately with sha256 receipts under
 *      _private/admin/fenok-edge-korea/dart/kospi-alotmatter-fy<fy>/.
 *      Done receipts resume (skip); error receipts retry on the next run.
 *   4. Aggregate -> data/computed/fenok-rim/kospi-dart-payout/fy<fy>.json
 *      and atomically select it via kospi-dart-payout/current.json.
 *      (index-level only: coverage, yield, payout, provenance; no per-issuer
 *      rows, no secrets). Coverage gate >= 0.75, else fail closed with no
 *      artifact.
 *
 * Credential: env OPEN_DART_API_KEY (never printed, never committed; the value
 * is used only inside request URLs, and every log/error string is redacted).
 */

import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  API_KEY_ENV,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  BENCHMARK_MAX_AGE_DAYS,
  KRX_WEIGHTS_MAX_AGE_DAYS,
  MIN_COVERAGE,
  REQUEST_INTERVAL_MS,
  ANNUAL_FILING_MAX_AGE_DAYS,
  PAYOUT_ARTIFACT_ROOT,
  aggregateKospiDartPayout,
  buildAlotMatterUrl,
  buildCorpCodeUrl,
  buildIndexArtifact,
  buildCurrentPointer,
  constants,
  defaultFiscalYear,
  daysBetween,
  isKrxStockCode,
  isRetryableHttp,
  isValidCoverageGate,
  parseCorpCodeXml,
  redactApiKey,
  redactCrtfcKey,
  toIsoKey,
  unzipCorpCodeXml,
} from "./lib/kospi-dart-payout.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..");

export const PRIVATE_DART_REL = path.join("_private", "admin", "fenok-edge-korea", "dart");
export const WEIGHTS_REL = path.join("data", "admin", "fenok-edge-korea-krx-daily-index.json");
export const BENCHMARK_REL = path.join("data", "benchmarks", "emerging.json");
export const ARTIFACT_DIR_REL = path.join(...PAYOUT_ARTIFACT_ROOT.split("/"));
export const CURRENT_POINTER_REL = path.join(ARTIFACT_DIR_REL, "current.json");

export const RECEIPTS_SCHEMA = "kospi_dart_payout_receipts.v1";
export const CORPCODE_RECEIPT_SCHEMA = "kospi_dart_payout_corpcode.v1";
const USER_AGENT = "100xFenok-kospi-dart-payout/1.0";

function collectorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readJsonIfExists(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error && (error.code === "ENOENT" || error.code === "EISDIR")) return null;
    throw error;
  }
}

function readJsonRequired(filePath, label) {
  const doc = readJsonIfExists(filePath);
  if (doc === null) throw collectorError("missing_input", `${label} not found at ${filePath}`);
  return doc;
}

function normalizeRepoRelative(value) {
  if (typeof value !== "string" || value.trim() === "" || path.isAbsolute(value)) return null;
  const normalized = value.split("\\").join("/");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return null;
  return path.normalize(normalized);
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function atomicWriteBytes(filePath, bytes) {
  const target = path.resolve(filePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}`);
  fs.writeFileSync(tmp, bytes);
  fs.renameSync(tmp, target);
}

function atomicWriteJson(filePath, value) {
  atomicWriteBytes(filePath, Buffer.from(serializeJson(value), "utf8"));
}

function assertFresh(asOf, nowIso, label, code, maxAgeDays) {
  const sourceDate = toIsoKey(asOf);
  const currentDate = toIsoKey(nowIso);
  if (!sourceDate || !currentDate) {
    throw collectorError(code, `${label} carries an invalid as-of date`);
  }
  const age = daysBetween(currentDate, sourceDate);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeDays) {
    throw collectorError(code, `${label} as_of ${sourceDate} is ${Math.round(age)} days old (gate ${maxAgeDays})`);
  }
}

export function requestBytes(url, { timeoutMs = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": USER_AGENT } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(
      Object.assign(new Error("KOSPI DART request timed out"), { code: "ETIMEDOUT" }),
    ));
    request.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Input loaders (runtime sources; all fail closed).
// ---------------------------------------------------------------------------

export function loadKrxWeights(repoRoot = REPO_ROOT) {
  const bridge = readJsonRequired(path.join(repoRoot, WEIGHTS_REL), "KRX bridge");
  if (bridge?.schema_version !== "fenok-edge-korea-krx-bridge/v1"
    || bridge?.source !== "KRX_OPEN_API") {
    throw collectorError("invalid_weights_source", `${WEIGHTS_REL} is not a KRX bridge document`);
  }
  const derived = bridge.derived_rim_inputs;
  const weights = derived?.kospi_weights;
  const source = normalizeRepoRelative(weights?.source);
  const asOf = toIsoKey(weights?.as_of);
  const bridgeAsOf = toIsoKey(bridge.as_of);
  const freshnessAsOf = toIsoKey(bridge.freshness?.as_of);
  if (derived?.schema_version !== "krx_derived_rim_inputs.v1"
    || derived.status !== "ready"
    || !Array.isArray(derived.missing)
    || derived.missing.length !== 0
    || !weights
    || weights.raw_public !== false
    || !source
    || !/^_private\/admin\/fenok-edge-korea\/daily\/[^/]+\/raw\/core_stock_index\/stk_bydd_trd\/\d{8}\.json$/.test(source)
    || weights.source_field !== "OutBlock_1[MKT_NM=KOSPI].MKTCAP / sum(OutBlock_1[MKT_NM=KOSPI].MKTCAP)"
    || !asOf
    || !bridgeAsOf
    || asOf !== bridgeAsOf
    || !freshnessAsOf
    || freshnessAsOf !== asOf
    || !source.endsWith(`/${asOf.replaceAll("-", "")}.json`)) {
    throw collectorError("invalid_weights_source", `${WEIGHTS_REL} derived KRX weight schema/provenance is invalid`);
  }
  if (!Number.isSafeInteger(weights.row_count)
    || !Array.isArray(weights.rows)
    || weights.row_count !== weights.rows.length
    || weights.row_count === 0
    || !Number.isFinite(Number(weights.total_market_cap))
    || Number(weights.total_market_cap) <= 0
    || weights.denominator?.method !== "issuer_level_market_cap_sum"
    || weights.denominator?.unit !== "KRW"
    || Number(weights.denominator?.value) !== Number(weights.total_market_cap)) {
    throw collectorError("invalid_weights_source", `${WEIGHTS_REL} KRX weight denominator/rows are invalid`);
  }

  const rows = [];
  const seenCodes = new Set();
  let weightSum = 0;
  for (const row of weights.rows) {
    const code = String(row?.code ?? "").trim().toUpperCase();
    const weight = Number(row?.weight);
    if (!/^[A-Z0-9]{6}$/.test(code) || !Number.isFinite(weight) || weight <= 0 || weight > 1) {
      throw collectorError("invalid_weight", `KRX KOSPI derived weight row is invalid for code="${code}"`);
    }
    if (seenCodes.has(code)) throw collectorError("invalid_weight", `duplicate KRX KOSPI derived code ${code}`);
    seenCodes.add(code);
    if (row.weight_pct !== undefined) {
      const weightPct = Number(row.weight_pct);
      if (!Number.isFinite(weightPct) || Math.abs(weightPct - weight * 100) > 1e-6) {
        throw collectorError("invalid_weight", `KRX KOSPI weight_pct disagrees for code="${code}"`);
      }
    }
    weightSum += weight;
    rows.push({ code, weight });
  }
  if (!Number.isFinite(weightSum) || weightSum < 0.99 || weightSum > 1.01) {
    throw collectorError("invalid_weight", `${WEIGHTS_REL} KRX weights do not sum to approximately 1`);
  }
  return {
    rows,
    asOf,
    rowCount: weights.row_count,
    source: WEIGHTS_REL,
    privateSource: source,
    sourceField: weights.source_field,
  };
}

export function loadBenchmarkKospi(repoRoot = REPO_ROOT) {
  const doc = readJsonRequired(path.join(repoRoot, BENCHMARK_REL), "KOSPI benchmark");
  const data = doc?.sections?.kospi?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw collectorError("missing_benchmark", `${BENCHMARK_REL} sections.kospi.data is missing/empty`);
  }
  const datedRows = data.map((candidate) => ({ candidate, date: toIsoKey(candidate?.date) }));
  if (datedRows.some((entry) => !entry.date)) {
    throw collectorError("invalid_benchmark", `${BENCHMARK_REL} contains an invalid KOSPI date`);
  }
  const row = datedRows.sort((a, b) => a.date.localeCompare(b.date)).at(-1).candidate;
  const bestEps = Number(row.best_eps);
  const pxLast = Number(row.px_last);
  if (!Number.isFinite(bestEps) || bestEps <= 0) {
    throw collectorError("nonpositive_eps", `${BENCHMARK_REL} latest kospi best_eps=${row.best_eps}`);
  }
  if (!Number.isFinite(pxLast) || pxLast <= 0) {
    throw collectorError("nonpositive_price", `${BENCHMARK_REL} latest kospi px_last=${row.px_last}`);
  }
  return { bestEps, pxLast, asOf: toIsoKey(row.date), source: BENCHMARK_REL };
}

// ---------------------------------------------------------------------------
// corpCode.xml (zip) fetch + private cache.
// ---------------------------------------------------------------------------

function corpCodePaths(repoRoot) {
  const dir = path.join(repoRoot, PRIVATE_DART_REL, "corpcode");
  return { dir, receiptPath: path.join(dir, "receipt.json"), zipPath: path.join(dir, "corpCode.xml.zip") };
}

async function fetchCorpCodeRows({ repoRoot, apiKey, request, nowIso, refresh }) {
  const { dir, receiptPath, zipPath } = corpCodePaths(repoRoot);
  const receipt = readJsonIfExists(receiptPath);
  const cacheRel = path.join(PRIVATE_DART_REL, "corpcode", "corpCode.xml.zip");
  const cachedZip = receipt?.schema_version === CORPCODE_RECEIPT_SCHEMA
    && receipt.cached_path === cacheRel
    && fileExists(zipPath)
    ? fs.readFileSync(zipPath)
    : null;
  if (!refresh && cachedZip && /^[a-f0-9]{64}$/.test(String(receipt.sha256)) && receipt.sha256 === sha256Hex(cachedZip)) {
    const parsed = parseCorpCodeXml(unzipCorpCodeXml(cachedZip)?.xml ?? "");
    if (parsed.ok) {
      return {
        companies: parsed.companies,
        cached: true,
        source: cacheRel,
        receiptPath: path.join(PRIVATE_DART_REL, "corpcode", "receipt.json"),
        sha256: receipt.sha256,
      };
    }
  }

  const response = await request(buildCorpCodeUrl(apiKey));
  if (response.statusCode !== 200) {
    throw collectorError("api_error", `corpCode.xml http ${response.statusCode}`);
  }
  const unzipped = unzipCorpCodeXml(response.body);
  if (!unzipped.ok) throw collectorError(unzipped.code, unzipped.reason);
  const parsed = parseCorpCodeXml(unzipped.xml);
  if (!parsed.ok) throw collectorError(parsed.code, parsed.reason);
  const rel = path.join(PRIVATE_DART_REL, "corpcode", "corpCode.xml.zip");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(zipPath, response.body);
  atomicWriteJson(receiptPath, {
    schema_version: CORPCODE_RECEIPT_SCHEMA,
    fetched_at: nowIso,
    http_status: 200,
    sha256: sha256Hex(response.body),
    cached_path: rel,
    rows: parsed.companies.length,
  });
  return {
    companies: parsed.companies,
    cached: false,
    source: rel,
    receiptPath: path.join(PRIVATE_DART_REL, "corpcode", "receipt.json"),
    sha256: sha256Hex(response.body),
  };
}

// ---------------------------------------------------------------------------
// alotMatter.json per-issuer fetch: 1 req/sec, bounded retries/backoff,
// receipts for resume.
// ---------------------------------------------------------------------------

export function backoffMs(attemptIndex) {
  // attemptIndex 1 = wait before the 2nd attempt, 2 = before the 3rd, ...
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attemptIndex - 1), BACKOFF_MAX_MS);
}

export async function fetchAlotMatterWithRetry({
  corpCode,
  apiKey,
  fy,
  request,
  sleep,
}) {
  let lastHttp = 0;
  let lastApiStatus = null;
  let lastReason = "";
  for (let attempt = 1; attempt <= constants.MAX_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 1) await sleep(backoffMs(attempt - 1));
    try {
      const response = await request(buildAlotMatterUrl(apiKey, corpCode, fy));
      lastHttp = response.statusCode;
      if (response.statusCode === 200) {
        let parsed = null;
        try {
          parsed = JSON.parse(response.body.toString("utf8"));
        } catch {
          // fall through to the api_error path below
        }
        if (parsed && String(parsed.status) === "000") {
          return { ok: true, json: parsed, http_status: 200, api_status: "000", attempts: attempt };
        }
        lastApiStatus = parsed?.status ?? "unparsable";
        lastReason = `alotMatter api_status=${lastApiStatus}`;
      } else {
        lastReason = `alotMatter http ${response.statusCode}`;
      }
      if (isRetryableHttp(lastHttp) && attempt < constants.MAX_FETCH_ATTEMPTS) continue;
      return {
        ok: false,
        http_status: lastHttp,
        api_status: lastApiStatus,
        reason: lastReason,
        attempts: attempt,
      };
    } catch (error) {
      lastHttp = 0;
      lastReason = `transport: ${error instanceof Error ? error.message : String(error)}`;
      if (attempt < constants.MAX_FETCH_ATTEMPTS) continue;
      return { ok: false, http_status: 0, api_status: null, reason: lastReason, attempts: attempt };
    }
  }
  return { ok: false, http_status: lastHttp, api_status: lastApiStatus, reason: lastReason, attempts: constants.MAX_FETCH_ATTEMPTS };
}

export function loadReceipts(repoRoot, fy) {
  const pathValue = path.join(repoRoot, PRIVATE_DART_REL, `kospi-alotmatter-fy${fy}`, "receipts.json");
  const doc = readJsonIfExists(pathValue);
  if (doc === null) return { pathValue, receipts: {} };
  if (doc?.schema_version !== RECEIPTS_SCHEMA
    || !doc.receipts
    || typeof doc.receipts !== "object"
    || Array.isArray(doc.receipts)) {
    throw collectorError("invalid_receipts", `${pathValue} schema mismatch`);
  }
  return { pathValue, receipts: doc.receipts };
}

export function saveReceipts({ repoRoot, fy, receipts, nowIso }) {
  const pathValue = path.join(repoRoot, PRIVATE_DART_REL, `kospi-alotmatter-fy${fy}`, "receipts.json");
  atomicWriteJson(pathValue, {
    schema_version: RECEIPTS_SCHEMA,
    fy,
    updated_at: nowIso,
    receipts,
  });
  return pathValue;
}

// ---------------------------------------------------------------------------
// Orchestration — the testable core.
// ---------------------------------------------------------------------------

export async function runKospiDartPayout({
  repoRoot = REPO_ROOT,
  fy = null,
  apiKey = null,
  request = requestBytes,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  nowIso = new Date().toISOString(),
  refreshCorpCode = false,
  minCoverage = MIN_COVERAGE,
  emitArtifact = true,
} = {}) {
  const redact = (text) => redactCrtfcKey(redactApiKey(text, apiKey));
  try {
    const fyNum = fy ?? defaultFiscalYear(nowIso);
    if (!Number.isInteger(fyNum) || fyNum < 2000) {
      throw collectorError("invalid_fy", `fy=${fyNum}`);
    }
    if (!isValidCoverageGate(minCoverage)) {
      throw collectorError("invalid_coverage_gate", `minCoverage=${minCoverage}; required range is ${MIN_COVERAGE}..1`);
    }
    if (!apiKey) {
      throw collectorError("missing_api_key", `env ${API_KEY_ENV} is required (value never printed)`);
    }

    const weights = loadKrxWeights(repoRoot);
    assertFresh(weights.asOf, nowIso, "KRX bridge kospi_weights", "stale_weights", KRX_WEIGHTS_MAX_AGE_DAYS);
    const benchmark = loadBenchmarkKospi(repoRoot);
    assertFresh(benchmark.asOf, nowIso, "KOSPI benchmark", "stale_benchmark", BENCHMARK_MAX_AGE_DAYS);

    const corpCode = await fetchCorpCodeRows({
      repoRoot,
      apiKey,
      request,
      nowIso,
      refresh: refreshCorpCode,
    });
    if (corpCode.companies.length === 0) {
      throw collectorError("missing_companies", "corpCode.xml parsed to zero companies");
    }

    // Exact uppercase 6-character stock_code join; only issuers present in BOTH the bridge
    // and the DART master are fetch targets (never name-matched).
    const stockToCorp = new Map(
      corpCode.companies
        .filter((row) => isKrxStockCode(row.stock_code))
        .map((row) => [row.stock_code, row.corp_code]),
    );
    const targets = weights.rows
      .map((row) => ({ code: String(row.code).trim(), corp: stockToCorp.get(String(row.code).trim()) }))
      .filter((target) => target.corp !== undefined)
      .sort((a, b) => (a.corp < b.corp ? -1 : a.corp > b.corp ? 1 : 0));

    const alotDirRel = path.join(PRIVATE_DART_REL, `kospi-alotmatter-fy${fyNum}`);
    const receipts = loadReceipts(repoRoot, fyNum);
    let fetched = 0;
    let resumed = 0;
    let failed = 0;
    let needsRateInterval = !corpCode.cached;

    for (const target of targets) {
      const cachedRel = path.join(alotDirRel, `${target.corp}.json`);
      const cachedPath = path.join(repoRoot, cachedRel);
      const receipt = receipts.receipts[target.corp];
      if (receipt?.status === "done"
        && receipt.cached_path === cachedRel
        && fileExists(cachedPath)
        && /^[a-f0-9]{64}$/.test(String(receipt.sha256))
        && receipt.sha256 === sha256Hex(fs.readFileSync(cachedPath))) {
        resumed += 1;
        continue;
      }
      if (needsRateInterval) await sleep(REQUEST_INTERVAL_MS); // official 1 req/sec across all DART endpoints
      fetched += 1;
      needsRateInterval = true;
      const outcome = await fetchAlotMatterWithRetry({ corpCode: target.corp, apiKey, fy: fyNum, request, sleep });
      if (outcome.ok) {
        atomicWriteJson(cachedPath, outcome.json);
        receipts.receipts[target.corp] = {
          status: "done",
          http_status: 200,
          api_status: "000",
          fetched_at: nowIso,
          cached_path: cachedRel,
          sha256: sha256Hex(fs.readFileSync(cachedPath)),
        };
      } else {
        failed += 1;
        receipts.receipts[target.corp] = {
          status: "error",
          http_status: outcome.http_status,
          api_status: outcome.api_status,
          fetched_at: nowIso,
          reason: redact(outcome.reason),
        };
      }
      if (fetched % 25 === 0) saveReceipts({ repoRoot, fy: fyNum, receipts: receipts.receipts, nowIso });
    }
    saveReceipts({ repoRoot, fy: fyNum, receipts: receipts.receipts, nowIso });

    // Rebuild responses from the private cache (done receipts only).
    const responses = new Map();
    for (const target of targets) {
      const receipt = receipts.receipts[target.corp];
      if (receipt?.status !== "done") continue;
      const expectedRel = path.join(alotDirRel, `${target.corp}.json`);
      if (receipt.cached_path !== expectedRel || !fileExists(path.join(repoRoot, expectedRel))) {
        throw collectorError("receipt_mismatch", `done receipt for ${target.corp} has no expected private cache`);
      }
      const body = readJsonIfExists(path.join(repoRoot, expectedRel));
      if (body === null) throw collectorError("receipt_mismatch", `done receipt for ${target.corp} has invalid JSON cache`);
      responses.set(target.corp, body);
    }
    // Sanity: every target we fetched successfully must be in the responses;
    // anything else would silently shrink coverage.
    if (responses.size < targets.length - failed) {
      throw collectorError("receipt_mismatch", "done receipts do not cover all successful fetches");
    }

    const aggregate = aggregateKospiDartPayout({
      companies: corpCode.companies,
      weights: weights.rows,
      responses,
      bestEps: benchmark.bestEps,
      pxLast: benchmark.pxLast,
      fy: fyNum,
      asOf: nowIso,
      minCoverage,
      maxAnnualFilingAgeDays: ANNUAL_FILING_MAX_AGE_DAYS,
    });
    if (!aggregate.ok) {
      return {
        ok: false,
        code: aggregate.code,
        reason: redact(aggregate.reason),
        diagnostics: aggregate.diagnostics,
        summary: { fy: fyNum, fetched, resumed, failed },
      };
    }

    const artifactRel = path.join(ARTIFACT_DIR_REL, `fy${fyNum}.json`);
    const artifact = {
      ...buildIndexArtifact(aggregate),
      provenance: {
        bridge: {
          source: weights.source,
          private_source: weights.privateSource,
          source_field: weights.sourceField,
          as_of: weights.asOf,
          row_count: weights.rowCount,
        },
        benchmark: { source: BENCHMARK_REL, as_of: benchmark.asOf },
        corpcode: {
          source: corpCode.source,
          receipt: corpCode.receiptPath,
          sha256: corpCode.sha256,
        },
        annual_filings: {
          endpoint: "alotMatter.json",
          report_code: "11011",
          fiscal_year: fyNum,
          settlement_date_rule: "selected row stlm_dt year equals bsns_year; filing date is on or after stlm_dt",
          max_age_days: ANNUAL_FILING_MAX_AGE_DAYS,
          receipts: path.join(PRIVATE_DART_REL, `kospi-alotmatter-fy${fyNum}`, "receipts.json"),
        },
        private_cache_root: PRIVATE_DART_REL,
      },
    };
    if (!artifact.ok) {
      throw collectorError(artifact.code, artifact.reason);
    }
    const artifactBytes = Buffer.from(serializeJson(artifact), "utf8");
    const artifactSha256 = sha256Hex(artifactBytes);
    const current = buildCurrentPointer({
      artifactPath: artifactRel.split(path.sep).join("/"),
      artifact,
      sha256: artifactSha256,
    });
    if (current.ok === false) {
      throw collectorError(current.code, current.reason);
    }
    if (emitArtifact) {
      atomicWriteBytes(path.join(repoRoot, artifactRel), artifactBytes);
      atomicWriteJson(path.join(repoRoot, CURRENT_POINTER_REL), current);
    }

    return {
      ok: true,
      artifactRel,
      currentRel: CURRENT_POINTER_REL,
      artifactSha256,
      coverage: aggregate.coverage,
      diagnostics: aggregate.diagnostics,
      index_dividend_yield: aggregate.index_dividend_yield,
      payout_ratio: aggregate.payout_ratio,
      earnings_yield: aggregate.earnings_yield,
      first_knowable_at: aggregate.first_knowable_at,
      summary: { fy: fyNum, fetched, resumed, failed },
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "collector_error",
      reason: redact(error instanceof Error ? error.message : String(error)),
    };
  }
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const options = { fy: null, refreshCorpCode: false, minCoverage: MIN_COVERAGE };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fy") {
      options.fy = Number(argv[index + 1]);
      if (!Number.isInteger(options.fy)) throw collectorError("invalid_fy", `--fy expects an integer year, got ${argv[index + 1]}`);
      index += 1;
    } else if (arg === "--refresh-corpcode") {
      options.refreshCorpCode = true;
    } else if (arg === "--min-coverage") {
      options.minCoverage = Number(argv[index + 1]);
      if (!isValidCoverageGate(options.minCoverage)) {
        throw collectorError(
          "invalid_coverage_gate",
          `--min-coverage expects a number from ${MIN_COVERAGE} through 1, got ${argv[index + 1]}`,
        );
      }
      index += 1;
    } else {
      throw collectorError("usage", `unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env[API_KEY_ENV] ?? null; // value is never printed
  const result = await runKospiDartPayout({ ...options, apiKey });
  if (!result.ok) {
    console.error(`KOSPI DART payout: FAIL ${result.code}: ${result.reason}`);
    process.exit(1);
  }
  console.log(`KOSPI DART payout FY${result.summary.fy}: ok`);
  console.log(`  coverage ${(result.coverage.covered_weight * 100).toFixed(2)}% (${result.coverage.valid_issuers}/${result.coverage.universe_issuers})`);
  console.log(`  index_dividend_yield ${result.index_dividend_yield.toFixed(6)}`);
  console.log(`  payout_ratio ${result.payout_ratio.toFixed(6)}`);
  console.log(`  earnings_yield ${result.earnings_yield.toFixed(6)}`);
  console.log(`  first_knowable_at ${result.first_knowable_at}`);
  console.log(`  fetched ${result.summary.fetched}, resumed ${result.summary.resumed}, failed ${result.summary.failed}`);
  console.log(`  artifact ${result.artifactRel}`);
  console.log(`  current ${result.currentRel}`);
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const safeMessage = redactCrtfcKey(redactApiKey(message, process.env[API_KEY_ENV] ?? null));
    console.error(`KOSPI DART payout: FAIL ${error?.code ?? "cli_error"}: ${safeMessage}`);
    process.exit(1);
  });
}
