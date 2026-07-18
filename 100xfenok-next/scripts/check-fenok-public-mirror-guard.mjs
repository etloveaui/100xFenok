#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PATTERNS = [
  /^admin\/fenok-s1-stock-promotion-gate-plan\.json$/,
  /^admin\/fenok-s1-stock-public-promotion-dry-run\.json$/,
  /^admin\/fenok-s1-public-mutation-enable-readiness\.json$/,
  /^admin\/fenok-edge-etf-daily1y-readiness\.json$/,
  /^admin\/fenok-edge-etf-daily1y-fetchable-plan\.json$/,
  /^admin\/fenok-etf-daily1y-dispatch-plan\.json$/,
  /^admin\/fenok-etf-core-daily-basket\.json$/,
  /^admin\/fenok-s0-finra-occ-mapping-ledger\.json$/,
  /^admin\/data-supply-detection-floor\.json$/,
  /^computed\/fenok_signals\.json$/,
  /^computed\/fenok_etf_signals\.json$/,
  /^computed\/etf_action_index\.json$/,
  /^computed\/fenok_flow_proxies.*\.json$/,
  /^computed\/fenok_occ_options_volume.*\.json$/,
  /^computed\/fenok_news_tone_proxy.*\.json$/,
  /^computed\/fenok_signal_lens_proxies.*\.json$/,
  /^computed\/fenok_social_attention_proxy.*\.json$/,
  /^computed\/fenok_apewisdom.*\.json$/,
];

const FORBIDDEN_RAW_PATTERNS = [
  /\.(csv|txt)$/i,
  /(^|\/)(finra|occ|apewisdom|gdelt|reddit|social)(\/|_)/i,
];

export const FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS = [
  "admin/data-supply-state",
  "yf/etf-details",
  "yf/migration-evidence",
];

const DETECTION_FLOOR_REPORT_RELATIVE_PATH = "admin/data-supply-detection-floor.json";

const FORBIDDEN_PUBLIC_TOKENS = [
  "_private/",
  "\"private_manifest_file\"",
  "\"manifest_file\"",
  "admin/data-supply-state/",
  "data/yf/migration-evidence/",
];

const FORBIDDEN_INDEX_KEYS = new Set([
  "provider",
  "provider_id",
  "source_provider",
  "provider_path",
  "payload_ref",
  "endpoint",
  "endpoint_url",
  "endpoint_family",
  "observation",
  "observations",
  "observation_id",
  "candidate_event_id",
  "candidate_event_ids",
  "evidence_event_ids",
]);

const FORBIDDEN_YARDNEY_RAW_KEYS = new Set([
  "moodys_aaa", "moodys_baa", "spread_avg", "raw_moodys_aaa", "raw_moodys_baa",
  "fred_aaa", "fred_baa", "waaa", "wbaa", "WAAA", "WBAA", "aaa_yield",
  "baa_yield", "corporate_aaa", "corporate_baa",
]);

const PROJECTION_REL = "computed/data-supply/etf-detail";
const ENROLLMENT_SCHEMA = "data-supply-etf-detail-enrollment/v1";
const INDEX_SCHEMA = "data-supply-etf-detail-public-index/v1";
const HEX64 = /^[0-9a-f]{64}$/;
const TICKER = /^[A-Z0-9][A-Z0-9._-]*$/;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function lstatIfPresent(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function walkRegularFiles(root, violations, displayPrefix) {
  if (!fs.existsSync(root)) return [];
  const out = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolutePath);
      const relativePath = toPosix(path.relative(root, absolutePath));
      if (stat.isSymbolicLink()) {
        violations.push(`${displayPrefix}/${relativePath}: symlink is forbidden`);
      } else if (stat.isDirectory()) {
        visit(absolutePath);
      } else if (stat.isFile()) {
        out.push({ absolutePath, relativePath, bytes: fs.readFileSync(absolutePath) });
      } else {
        violations.push(`${displayPrefix}/${relativePath}: special file is forbidden`);
      }
    }
  }
  visit(root);
  return out;
}

function parseJsonFile(filePath, label, violations) {
  const stat = lstatIfPresent(filePath);
  if (!stat) {
    violations.push(`${label}: missing`);
    return null;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    violations.push(`${label}: must be a regular file`);
    return null;
  }
  const bytes = fs.readFileSync(filePath);
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      violations.push(`${label}: top-level JSON must be an object`);
      return null;
    }
    return { value, bytes };
  } catch (error) {
    violations.push(`${label}: invalid JSON (${error.message})`);
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined || !Number.isFinite(value) && typeof value === "number") {
    throw new Error("non-canonical JSON value");
  }
  return encoded;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalSha256(value) {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}

function withoutIndexSha(index) {
  const copy = { ...index };
  delete copy.index_sha256;
  return copy;
}

function isoTimestamp(value) {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function collectForbiddenKeys(value, pathLabel = "index", hits = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${pathLabel}[${index}]`, hits));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_INDEX_KEYS.has(key)) hits.push(`${pathLabel}.${key}`);
      collectForbiddenKeys(child, `${pathLabel}.${key}`, hits);
    }
  }
  return hits;
}

function expectedPayloadPaths(ticker) {
  return new Set([
    `payloads/${ticker}.json`,
    `${PROJECTION_REL}/payloads/${ticker}.json`,
    `data/${PROJECTION_REL}/payloads/${ticker}.json`,
    `/data/${PROJECTION_REL}/payloads/${ticker}.json`,
  ]);
}

function validateEntry(ticker, entry, publicProjectionRoot, canonicalProjectionRoot, violations) {
  const label = `R2.4 index entry ${ticker}`;
  if (!TICKER.test(ticker) || !entry || typeof entry !== "object" || Array.isArray(entry)) {
    violations.push(`${label}: invalid ticker or entry shape`);
    return { selected: false, state: null };
  }
  if (entry.ticker !== ticker || entry.enrollment_state !== "enrolled") {
    violations.push(`${label}: ticker/enrollment identity mismatch`);
  }

  if (entry.resolution_state === "unavailable") {
    for (const key of ["provider_role", "fallback_depth", "source_as_of", "payload_sha256", "payload_path"]) {
      if (entry[key] !== null) violations.push(`${label}: unavailable ${key} must be null`);
    }
    if (entry.recovery_transition !== "unavailable") {
      violations.push(`${label}: unavailable transition is required`);
    }
    return { selected: false, state: "unavailable" };
  }

  const role = entry.resolution_state === "fresh_primary" || entry.resolution_state === "lkg_primary"
    ? "primary"
    : entry.resolution_state === "fresh_fallback" || entry.resolution_state === "lkg_fallback"
      ? "fallback"
      : null;
  if (!role) violations.push(`${label}: unsupported selected resolution_state ${entry.resolution_state}`);
  if (entry.provider_role !== role) violations.push(`${label}: provider_role does not match resolution_state`);
  if (!Number.isInteger(entry.fallback_depth) || entry.fallback_depth < 0) violations.push(`${label}: invalid fallback_depth`);
  if (!isoTimestamp(entry.source_as_of) || !isoTimestamp(entry.selected_at)) violations.push(`${label}: invalid source/selection timestamp`);
  if (typeof entry.reason_code !== "string" || !entry.reason_code) violations.push(`${label}: reason_code is required`);
  if (!HEX64.test(entry.payload_sha256 || "")) violations.push(`${label}: invalid payload_sha256`);
  if (!expectedPayloadPaths(ticker).has(entry.payload_path)) violations.push(`${label}: invalid payload_path`);

  const relativePayload = path.join("payloads", `${ticker}.json`);
  const publicPayload = parseJsonFile(path.join(publicProjectionRoot, relativePayload), `public R2.4 payload ${ticker}`, violations);
  const canonicalPayload = parseJsonFile(path.join(canonicalProjectionRoot, relativePayload), `canonical R2.4 payload ${ticker}`, violations);
  if (publicPayload && canonicalPayload && !publicPayload.bytes.equals(canonicalPayload.bytes)) {
    violations.push(`${label}: canonical/public payload bytes differ`);
  }
  if (publicPayload) {
    if (sha256(publicPayload.bytes) !== entry.payload_sha256) violations.push(`${label}: payload SHA mismatch`);
    const payload = publicPayload.value;
    if (payload.ticker !== ticker || payload.asset_type !== "etf") violations.push(`${label}: payload identity mismatch`);
    if (payload.source_as_of !== entry.source_as_of) violations.push(`${label}: source_as_of differs from immutable payload`);
    if (Object.prototype.hasOwnProperty.call(payload, "data_supply")) violations.push(`${label}: selected payload collides with data_supply metadata`);
  }
  return { selected: true, state: entry.resolution_state };
}

function validateProjection({ canonicalDataRoot, publicDataRoot, violations }) {
  const canonicalProjectionRoot = path.join(canonicalDataRoot, ...PROJECTION_REL.split("/"));
  const publicProjectionRoot = path.join(publicDataRoot, ...PROJECTION_REL.split("/"));
  const projectionPresent = [canonicalProjectionRoot, publicProjectionRoot].some((root) => lstatIfPresent(root));
  if (!projectionPresent) return;

  const canonicalEnrollment = parseJsonFile(path.join(canonicalProjectionRoot, "enrollment.json"), "canonical R2.4 enrollment", violations);
  const publicEnrollment = parseJsonFile(path.join(publicProjectionRoot, "enrollment.json"), "public R2.4 enrollment", violations);
  const canonicalIndex = parseJsonFile(path.join(canonicalProjectionRoot, "index.json"), "canonical R2.4 index", violations);
  const publicIndex = parseJsonFile(path.join(publicProjectionRoot, "index.json"), "public R2.4 index", violations);
  if (!canonicalEnrollment || !publicEnrollment || !canonicalIndex || !publicIndex) return;
  if (!canonicalEnrollment.bytes.equals(publicEnrollment.bytes)) violations.push("R2.4 enrollment canonical/public bytes differ");
  if (!canonicalIndex.bytes.equals(publicIndex.bytes)) violations.push("R2.4 index canonical/public bytes differ");

  const enrollment = publicEnrollment.value;
  const index = publicIndex.value;
  if (enrollment.schema_version !== ENROLLMENT_SCHEMA || enrollment.domain !== "etf_detail") violations.push("R2.4 enrollment schema/domain mismatch");
  if (index.schema_version !== INDEX_SCHEMA || index.domain !== "etf_detail") violations.push("R2.4 index schema/domain mismatch");
  for (const field of ["active_transaction_id", "active_generation_manifest_sha256", "membership_sha256"]) {
    if (enrollment[field] !== index[field]) violations.push(`R2.4 enrollment/index ${field} mismatch`);
  }
  if (!HEX64.test(enrollment.active_transaction_id || "") || !HEX64.test(enrollment.active_generation_manifest_sha256 || "")) {
    violations.push("R2.4 active transaction/manifest digest is invalid");
  }
  const computedIndexSha = canonicalSha256(withoutIndexSha(index));
  if (index.index_sha256 !== computedIndexSha || enrollment.index_sha256 !== computedIndexSha) {
    violations.push("R2.4 index_sha256 cross-binding mismatch");
  }
  if (/https?:\/\//i.test(publicIndex.bytes.toString("utf8"))) violations.push("R2.4 public index exposes endpoint URL text");

  const tickers = enrollment.tickers;
  if (!Array.isArray(tickers) || tickers.some((ticker) => !TICKER.test(ticker))) {
    violations.push("R2.4 enrollment tickers are invalid");
    return;
  }
  const sortedTickers = [...tickers].sort();
  if (new Set(tickers).size !== tickers.length || JSON.stringify(tickers) !== JSON.stringify(sortedTickers)) {
    violations.push("R2.4 enrollment tickers must be sorted and unique");
  }
  if (enrollment.enrolled_count !== tickers.length || index.enrolled_count !== tickers.length) violations.push("R2.4 enrolled_count mismatch");
  const membershipSha = canonicalSha256(sortedTickers);
  if (membershipSha !== enrollment.membership_sha256 || membershipSha !== index.membership_sha256) {
    violations.push("R2.4 membership_sha256 mismatch");
  }

  const entries = index.entries;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    violations.push("R2.4 index entries must be an object");
    return;
  }
  const entryTickers = Object.keys(entries);
  if (JSON.stringify(entryTickers) !== JSON.stringify(sortedTickers)) violations.push("R2.4 entries must exactly match sorted enrollment tickers");
  for (const hit of collectForbiddenKeys(index)) violations.push(`R2.4 public index exposes forbidden key ${hit}`);

  const stateCounts = {};
  let selectedCount = 0;
  let unavailableCount = 0;
  const selectedTickers = [];
  for (const ticker of sortedTickers) {
    const result = validateEntry(ticker, entries[ticker], publicProjectionRoot, canonicalProjectionRoot, violations);
    stateCounts[result.state] = (stateCounts[result.state] || 0) + 1;
    if (result.selected) {
      selectedCount += 1;
      selectedTickers.push(ticker);
    } else unavailableCount += 1;
  }
  if (index.selected_count !== selectedCount || index.unavailable_count !== unavailableCount || selectedCount + unavailableCount !== tickers.length) {
    violations.push("R2.4 selected/unavailable partition mismatch");
  }
  const declaredStateCounts = index.state_counts || index.counts?.states;
  if (declaredStateCounts && canonicalJson(declaredStateCounts) !== canonicalJson(stateCounts)) violations.push("R2.4 state counts mismatch");

  const publicPayloadDir = path.join(publicProjectionRoot, "payloads");
  const payloadFiles = walkRegularFiles(publicPayloadDir, violations, `public/data/${PROJECTION_REL}/payloads`)
    .filter((item) => item.relativePath.endsWith(".json"))
    .map((item) => item.relativePath.replace(/\.json$/, ""))
    .sort();
  if (JSON.stringify(payloadFiles) !== JSON.stringify(selectedTickers)) violations.push("R2.4 projection contains missing/orphan payloads");
  const canonicalPayloadDir = path.join(canonicalProjectionRoot, "payloads");
  const canonicalPayloadFiles = walkRegularFiles(canonicalPayloadDir, violations, `data/${PROJECTION_REL}/payloads`)
    .filter((item) => item.relativePath.endsWith(".json"))
    .map((item) => item.relativePath.replace(/\.json$/, ""))
    .sort();
  if (JSON.stringify(canonicalPayloadFiles) !== JSON.stringify(selectedTickers)) violations.push("R2.4 canonical projection contains missing/orphan payloads");
}

function validateLegacyEtfFiles({ canonicalDataRoot, publicFiles, violations }) {
  const prefix = "stockanalysis/etfs/";
  for (const item of publicFiles.filter((file) => file.relativePath.startsWith(prefix) && file.relativePath.endsWith(".json"))) {
    let payload;
    try {
      payload = JSON.parse(item.bytes.toString("utf8"));
    } catch (error) {
      violations.push(`public/data/${item.relativePath}: invalid legacy ETF JSON (${error.message})`);
      continue;
    }
    const ticker = path.posix.basename(item.relativePath, ".json");
    const yahooMarked = payload?.source_provider === "yahoo_finance" || payload?.source === "yahoo_finance" || payload?.detail_status === "yf_fallback";
    if (yahooMarked) violations.push(`public/data/${item.relativePath}: Yahoo-marked legacy ETF detail is forbidden`);
    if (payload?.schema_version !== "stockanalysis/v1" || payload?.ticker !== ticker || payload?.asset_type !== "etf" || payload?.source !== "stockanalysis" || payload?.source_provider === "yahoo_finance") {
      violations.push(`public/data/${item.relativePath}: strict StockAnalysis identity mismatch`);
    }
    const canonicalPath = path.join(canonicalDataRoot, ...item.relativePath.split("/"));
    const stat = lstatIfPresent(canonicalPath);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      violations.push(`public/data/${item.relativePath}: canonical true-primary counterpart is missing`);
    } else if (!item.bytes.equals(fs.readFileSync(canonicalPath))) {
      violations.push(`public/data/${item.relativePath}: canonical/public true-primary bytes differ`);
    }
  }
}

function scanYardneyRawKeys(root, displayPrefix, violations) {
  for (const item of walkRegularFiles(path.join(root, "yardney"), violations, `${displayPrefix}/yardney`)) {
    if (!item.relativePath.endsWith(".json")) continue;
    const text = item.bytes.toString("utf8");
    for (const match of text.matchAll(/"([^"]+)"\s*:/g)) {
      if (FORBIDDEN_YARDNEY_RAW_KEYS.has(match[1])) violations.push(`${displayPrefix}/yardney/${item.relativePath}: forbidden Yardney raw key ${match[1]}`);
    }
  }
}

export function checkPublicMirror({ appRoot, repoRoot }) {
  const publicDataRoot = path.join(appRoot, "public", "data");
  const canonicalDataRoot = path.join(repoRoot, "data");
  const violations = [];
  const detectionFloorReportPath = path.join(
    publicDataRoot,
    ...DETECTION_FLOOR_REPORT_RELATIVE_PATH.split("/"),
  );
  if (lstatIfPresent(detectionFloorReportPath)) {
    violations.push(`public/data/${DETECTION_FLOOR_REPORT_RELATIVE_PATH}: forbidden public node`);
  }
  const publicFiles = walkRegularFiles(publicDataRoot, violations, "public/data");
  const relativeFiles = publicFiles.map((item) => item.relativePath);

  for (const relativePath of relativeFiles) {
    if (FORBIDDEN_PATTERNS.some((pattern) => pattern.test(relativePath)) || FORBIDDEN_RAW_PATTERNS.some((pattern) => pattern.test(relativePath))) {
      violations.push(`public/data/${relativePath}: forbidden public file`);
    }
  }
  for (const relativeRoot of FORBIDDEN_PRIVATE_DATA_SUPPLY_ROOTS) {
    const rootPath = path.join(publicDataRoot, ...relativeRoot.split("/"));
    const stat = lstatIfPresent(rootPath);
    if (stat) violations.push(`public/data/${relativeRoot}: forbidden private data-supply root${stat.isSymbolicLink() ? " (symlink)" : ""}`);
  }
  for (const item of publicFiles.filter((file) => file.relativePath.endsWith(".json"))) {
    const text = item.bytes.toString("utf8");
    for (const token of FORBIDDEN_PUBLIC_TOKENS) {
      if (text.includes(token)) violations.push(`public/data/${item.relativePath}: unsafe token ${token}`);
    }
  }

  scanYardneyRawKeys(publicDataRoot, "public/data", violations);
  scanYardneyRawKeys(canonicalDataRoot, "data", violations);
  validateLegacyEtfFiles({ canonicalDataRoot, publicDataRoot, publicFiles, violations });
  validateProjection({ canonicalDataRoot, publicDataRoot, violations });

  const edgePath = path.join(publicDataRoot, "admin", "fenok-edge-coverage-index.json");
  if (fs.existsSync(edgePath)) {
    const parsed = parseJsonFile(edgePath, "public edge coverage mirror", violations);
    if (parsed) {
      const text = parsed.bytes.toString("utf8");
      const mirror = parsed.value;
      if (mirror.schema_version !== "fenok-edge-coverage-index-public/v0.1") violations.push("admin/fenok-edge-coverage-index.json: unsafe schema");
      if (mirror.raw_policy?.raw_public !== false || mirror.raw_policy?.raw_rows_included !== false || mirror.raw_policy?.private_artifact_paths_included !== false) {
        violations.push("admin/fenok-edge-coverage-index.json: unsafe raw_policy");
      }
      for (const token of ["_private/", "\"private_manifest_file\"", "\"manifest_file\"", "\"target_universe\"", "\"tickers\"", "\"source_file\""]) {
        if (text.includes(token)) violations.push(`admin/fenok-edge-coverage-index.json: unsafe token ${token}`);
      }
    }
  }
  return { ok: violations.length === 0, checkedFiles: publicFiles.length, violations };
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(scriptDir, "..");
const isMain = process.argv[1]
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  const result = checkPublicMirror({ appRoot: defaultAppRoot, repoRoot: path.resolve(defaultAppRoot, "..") });
  if (!result.ok) {
    console.error("[fenok-public-mirror-guard] forbidden public files:");
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log(`[fenok-public-mirror-guard] ok (${result.checkedFiles} public data files checked)`);
}
