#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_PATTERNS = [
  /^admin\/fenok-s1-stock-promotion-gate-plan\.json$/,
  /^admin\/fenok-s1-stock-public-promotion-dry-run\.json$/,
  /^admin\/fenok-s1-public-mutation-enable-readiness\.json$/,
  /^admin\/fenok-edge-etf-daily1y-readiness\.json$/,
  /^admin\/fenok-edge-etf-daily1y-fetchable-plan\.json$/,
  /^admin\/fenok-etf-daily1y-dispatch-plan\.json$/,
  /^admin\/fenok-etf-core-daily-basket\.json$/,
  /^admin\/fenok-s0-finra-occ-mapping-ledger\.json$/,
  /^admin\/data-supply-detection-floor\.json$/,
  // The FENO RIM research records: every operand, the frozen calibration
  // constants, and the fitted discount equation. Only the redacted projection
  // built by build-fenok-rim-sustainable-public-projection.mjs may be
  // published, so the raw artifacts are forbidden here rather than left to a
  // reviewer noticing a stray copy. fair-values.json and payout-history.json
  // are the two deliberately public ones and are not listed.
  /^computed\/fenok-rim\/sustainable-index-ranges\.json$/,
  /^computed\/fenok-rim\/identification-receipt\.json$/,
  /^computed\/fenok-rim\/input-diagnostics\.json$/,
  /^computed\/fenok-rim\/index-residual-roe-diagnostic\.json$/,
  /^computed\/fenok-rim\/membership-sensitivity-2026\.json$/,
  /^computed\/fenok-rim\/russell2000-official-fundamentals\.json$/,
  /^computed\/fenok-rim\/russell2000-history\//,
  // The RIM index directory is canonical-only except for the exact public
  // inputs projection. This catch-all keeps newly added criteria, canonical
  // current, historical, or arbitrary siblings from becoming public by
  // omission.
  /^computed\/rim-index\/(?!inputs\.json$).+/,
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
  "admin/slickcharts-daily-delivery",
  // Raw per-ticker Yahoo batch quote/history admin store (declared exception).
  // Canonical-only; must never reach the public mirror (asset-budget gate).
  "admin/yahoo-batch-quote-history",
  // Private derived proxies (apewisdom_attention / gdelt_news_tone lanes) must
  // never reach the public mirror.
  "computed/fenok_news_tone_proxy.json",
  "computed/fenok_news_tone_proxy_history.json",
  "computed/fenok_social_attention_proxy.json",
  "computed/fenok_social_attention_proxy_history.json",
  "yf/etf-details",
  "yf/estimates-archive",
  "yf/migration-evidence",
  // The dated Russell factsheet captures belong here too, but this list is
  // asserted equal to deriveForbiddenPrivateDataSupplyRoots(); adding a root by
  // hand breaks that parity. The tree is still withheld — sync-static-overrides
  // removes it before this guard runs — and it is registered properly as part
  // of the registry-derived allowlist work.
];

const DETECTION_FLOOR_REPORT_RELATIVE_PATH = "admin/data-supply-detection-floor.json";

export const FORBIDDEN_PUBLIC_TOKENS = [
  "_private/",
  "\"private_manifest_file\"",
  "\"manifest_file\"",
  "admin/data-supply-state/",
  "admin/slickcharts-daily-delivery/",
  "admin/yahoo-batch-quote-history/",
  "data/yf/migration-evidence/",
];

export function forbiddenPublicTokensInText(text) {
  return FORBIDDEN_PUBLIC_TOKENS.filter((token) => text.includes(token));
}

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
const STOCKANALYSIS_ETF_SHARD_ONLY_MODE = "shard-only";
const STOCKANALYSIS_ETF_LEGACY_MODE = "legacy-fallback";

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
  for (const item of publicFiles.filter((file) => file.relativePath.startsWith(prefix)
    && !file.relativePath.startsWith(`${prefix}shards/`)
    && file.relativePath.endsWith(".json"))) {
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

function strictStockanalysisEtfPayload(payload, ticker) {
  return payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && payload.schema_version === "stockanalysis/v1"
    && payload.ticker === ticker
    && payload.asset_type === "etf"
    && payload.source === "stockanalysis"
    && payload.source_provider !== "yahoo_finance"
    && payload.detail_status !== "yf_fallback";
}

function validTimestampRange(value) {
  if (!value || typeof value !== "object" || !Number.isInteger(value.present_count) || value.present_count < 0) return false;
  if (value.present_count === 0) return value.min === null && value.max === null;
  return isoTimestamp(value.min) && isoTimestamp(value.max);
}

async function validateStockanalysisEtfShards({ canonicalDataRoot, publicDataRoot, publicFiles, violations }) {
  const prefix = "stockanalysis/etfs/shards/";
  const shardFiles = publicFiles.filter((file) => file.relativePath.startsWith(prefix));
  const canonicalRoot = path.join(canonicalDataRoot, "stockanalysis", "etfs");
  const canonicalRootStat = lstatIfPresent(canonicalRoot);
  if (canonicalRootStat?.isSymbolicLink() || (canonicalRootStat && !canonicalRootStat.isDirectory())) {
    violations.push("data/stockanalysis/etfs: canonical ETF root must be a real directory");
    return;
  }
  if (canonicalRootStat) {
    for (const entry of fs.readdirSync(canonicalRoot, { withFileTypes: true })) {
      const entryPath = path.join(canonicalRoot, entry.name);
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink() || stat.isDirectory() || !stat.isFile() || !entry.name.endsWith(".json")) {
        violations.push(`data/stockanalysis/etfs/${entry.name}: canonical ETF root may contain only top-level JSON files`);
      }
    }
  }
  const canonicalNodes = walkRegularFiles(canonicalRoot, violations, "data/stockanalysis/etfs");
  const canonicalFiles = canonicalNodes
    .filter((file) => !file.relativePath.includes("/") && file.relativePath.endsWith(".json"));
  if (shardFiles.length === 0) {
    if (canonicalFiles.length > 0) {
      violations.push("StockAnalysis ETF shard projection is missing while canonical ETF payloads exist");
    }
    return;
  }
  const {
    STOCKANALYSIS_ETF_SHARD_ALGORITHM,
    STOCKANALYSIS_ETF_SHARD_COMPATIBILITY_MODE,
    STOCKANALYSIS_ETF_SHARD_COUNT,
    STOCKANALYSIS_ETF_SHARD_MAX_BYTES,
    STOCKANALYSIS_ETF_SHARD_MANIFEST_SCHEMA,
    STOCKANALYSIS_ETF_SHARD_SCHEMA,
    stockanalysisEtfManifestSha256,
    stockanalysisEtfPayloadDocumentFromShard,
    stockanalysisEtfShardFileNameForId,
    stockanalysisEtfShardId,
    stockanalysisEtfSnapshotId,
    stockanalysisEtfSourceBindingSha256,
    stockanalysisEtfTickerKey,
  } = await import("../src/lib/stockanalysis-etf-shard.mjs");

  const manifestPath = path.join(publicDataRoot, "stockanalysis", "etfs", "shards", "index.json");
  const parsedManifest = parseJsonFile(manifestPath, "StockAnalysis ETF shard manifest", violations);
  if (!parsedManifest) return;
  const manifest = parsedManifest.value;
  const shards = Array.isArray(manifest.shards) ? manifest.shards : null;
  if (
    manifest.schema_version !== STOCKANALYSIS_ETF_SHARD_MANIFEST_SCHEMA
    || ![STOCKANALYSIS_ETF_SHARD_ONLY_MODE, STOCKANALYSIS_ETF_LEGACY_MODE, STOCKANALYSIS_ETF_SHARD_COMPATIBILITY_MODE].includes(manifest.compatibility_mode)
    || manifest.shard_algorithm !== STOCKANALYSIS_ETF_SHARD_ALGORITHM
    || manifest.shard_count !== STOCKANALYSIS_ETF_SHARD_COUNT
    || !Number.isInteger(manifest.payload_count)
    || manifest.payload_count < 0
    || !HEX64.test(manifest.snapshot_id || "")
    || !HEX64.test(manifest.manifest_sha256 || "")
    || manifest.manifest_sha256 !== stockanalysisEtfManifestSha256(manifest)
    || !isoTimestamp(manifest.generated_at)
    || !manifest.source_timestamp_range
    || !validTimestampRange(manifest.source_timestamp_range.source_as_of)
    || !validTimestampRange(manifest.source_timestamp_range.fetched_at)
    || manifest.provenance?.canonical_root !== "data/stockanalysis/etfs"
    || !HEX64.test(manifest.provenance?.source_payload_sha256 || "")
    || !shards
    || shards.length !== STOCKANALYSIS_ETF_SHARD_COUNT
  ) {
    violations.push("StockAnalysis ETF shard manifest contract is invalid");
    return;
  }

  const expectedPaths = new Set(["stockanalysis/etfs/shards/index.json"]);
  const shardEntries = new Map();
  for (let position = 0; position < shards.length; position += 1) {
    const entry = shards[position];
    if (
      !entry
      || !Number.isInteger(entry.id)
      || entry.id < 0
      || entry.id >= STOCKANALYSIS_ETF_SHARD_COUNT
      || entry.id !== position
      || shardEntries.has(entry.id)
      || entry.path !== `snapshots/${manifest.snapshot_id}/${stockanalysisEtfShardFileNameForId(entry.id)}`
      || !HEX64.test(entry.sha256 || "")
      || !Number.isInteger(entry.member_count)
      || entry.member_count < 0
      || !Number.isInteger(entry.byte_length)
      || entry.byte_length < 0
      || entry.byte_length > STOCKANALYSIS_ETF_SHARD_MAX_BYTES
    ) {
      violations.push("StockAnalysis ETF shard manifest entry is invalid");
      continue;
    }
    shardEntries.set(entry.id, entry);
    expectedPaths.add(`stockanalysis/etfs/shards/${entry.path}`);
  }
  if (shardEntries.size !== STOCKANALYSIS_ETF_SHARD_COUNT) return;
  if ([...shardEntries.values()].reduce((sum, entry) => sum + entry.member_count, 0) !== manifest.payload_count) {
    violations.push("StockAnalysis ETF shard manifest payload/member count mismatch");
  }

  const actualPaths = new Set(shardFiles.map((file) => file.relativePath));
  for (const expectedPath of expectedPaths) {
    if (!actualPaths.has(expectedPath)) violations.push(`StockAnalysis ETF shard projection is missing ${expectedPath}`);
  }
  for (const actualPath of actualPaths) {
    if (!expectedPaths.has(actualPath)) violations.push(`StockAnalysis ETF shard projection has an unlisted file ${actualPath}`);
  }

  for (const item of canonicalNodes) {
    if (item.relativePath.includes("/") || !item.relativePath.endsWith(".json")) {
      violations.push(`data/stockanalysis/etfs/${item.relativePath}: canonical ETF root may contain only top-level JSON files`);
    }
  }
  const canonicalPayloads = new Map();
  for (const item of canonicalFiles) {
    const ticker = path.posix.basename(item.relativePath, ".json");
    try {
      const raw = item.bytes.toString("utf8");
      const payload = JSON.parse(raw);
      if (!strictStockanalysisEtfPayload(payload, ticker)) {
        violations.push(`data/stockanalysis/etfs/${item.relativePath}: strict StockAnalysis identity mismatch`);
        continue;
      }
      canonicalPayloads.set(ticker, { raw, payload, sha256: sha256(item.bytes) });
    } catch (error) {
      violations.push(`data/stockanalysis/etfs/${item.relativePath}: invalid JSON (${error.message})`);
    }
  }

  const directLegacyTickers = publicFiles
    .filter((file) => file.relativePath.startsWith("stockanalysis/etfs/")
      && !file.relativePath.startsWith(prefix)
      && !file.relativePath.slice("stockanalysis/etfs/".length).includes("/")
      && file.relativePath.endsWith(".json"))
    .map((file) => path.posix.basename(file.relativePath, ".json"))
    .sort();
  const canonicalTickers = [...canonicalPayloads.keys()].sort();
  const canonicalSourceSha256 = stockanalysisEtfSourceBindingSha256(
    canonicalTickers.map((ticker) => ({ ticker, sha256: canonicalPayloads.get(ticker).sha256 })),
  );
  if (
    manifest.provenance.source_payload_sha256 !== canonicalSourceSha256
    || manifest.snapshot_id !== stockanalysisEtfSnapshotId(canonicalSourceSha256)
  ) {
    violations.push("StockAnalysis ETF shard manifest canonical provenance digest mismatch");
  }
  if (manifest.compatibility_mode === STOCKANALYSIS_ETF_SHARD_ONLY_MODE) {
    if (directLegacyTickers.length > 0) {
      violations.push("StockAnalysis ETF shard-only projection must contain zero public top-level ETF files");
    }
  } else if (JSON.stringify(directLegacyTickers) !== JSON.stringify(canonicalTickers)) {
    violations.push("StockAnalysis ETF legacy-fallback set must exactly match canonical ETF payloads");
  }

  const shardedPayloads = new Map();
  for (const [shardId, entry] of shardEntries) {
    const relativePath = `stockanalysis/etfs/shards/${entry.path}`;
    const item = shardFiles.find((file) => file.relativePath === relativePath);
    if (!item) continue;
    if (sha256(item.bytes) !== entry.sha256 || item.bytes.length !== entry.byte_length) {
      violations.push(`StockAnalysis ETF shard ${entry.id}: hash/byte-length mismatch`);
      continue;
    }
    let shard;
    try {
      shard = JSON.parse(item.bytes.toString("utf8"));
    } catch (error) {
      violations.push(`StockAnalysis ETF shard ${entry.id}: invalid JSON (${error.message})`);
      continue;
    }
    if (
      !shard
      || typeof shard !== "object"
      || Array.isArray(shard)
      || shard.schema_version !== STOCKANALYSIS_ETF_SHARD_SCHEMA
      || shard.shard_algorithm !== STOCKANALYSIS_ETF_SHARD_ALGORITHM
      || shard.shard_count !== STOCKANALYSIS_ETF_SHARD_COUNT
      || shard.shard_id !== shardId
      || !shard.entries
      || typeof shard.entries !== "object"
      || Array.isArray(shard.entries)
    ) {
      violations.push(`StockAnalysis ETF shard ${entry.id}: contract mismatch`);
      continue;
    }
    const tickers = Object.keys(shard.entries).sort();
    if (tickers.length !== entry.member_count) violations.push(`StockAnalysis ETF shard ${entry.id}: member count mismatch`);
    for (const ticker of tickers) {
      let normalizedTicker;
      try {
        normalizedTicker = stockanalysisEtfTickerKey(ticker);
      } catch {
        violations.push(`StockAnalysis ETF shard ${entry.id}: invalid ticker ${ticker}`);
        continue;
      }
      const document = stockanalysisEtfPayloadDocumentFromShard(shard, ticker);
      const canonical = canonicalPayloads.get(ticker);
      if (
        normalizedTicker !== ticker
        || stockanalysisEtfShardId(ticker) !== shardId
        || shardedPayloads.has(ticker)
        || !document
        || !canonical
        || document.raw !== canonical.raw
        || sha256(document.raw) !== canonical.sha256
        || canonicalJson(document.value) !== canonicalJson(canonical.payload)
      ) {
        violations.push(`StockAnalysis ETF shard ${entry.id}: payload identity/provenance mismatch for ${ticker}`);
        continue;
      }
      shardedPayloads.set(ticker, document.value);
    }
  }
  if (manifest.payload_count !== canonicalTickers.length || JSON.stringify([...shardedPayloads.keys()].sort()) !== JSON.stringify(canonicalTickers)) {
    violations.push("StockAnalysis ETF shard payload membership must exactly match canonical ETF payloads");
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

export async function checkPublicMirror({ appRoot, repoRoot }) {
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
    for (const token of forbiddenPublicTokensInText(text)) {
      violations.push(`public/data/${item.relativePath}: unsafe token ${token}`);
    }
  }

  scanYardneyRawKeys(publicDataRoot, "public/data", violations);
  scanYardneyRawKeys(canonicalDataRoot, "data", violations);
  validateLegacyEtfFiles({ canonicalDataRoot, publicDataRoot, publicFiles, violations });
  await validateStockanalysisEtfShards({ canonicalDataRoot, publicDataRoot, publicFiles, violations });
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
  const result = await checkPublicMirror({ appRoot: defaultAppRoot, repoRoot: path.resolve(defaultAppRoot, "..") });
  if (!result.ok) {
    console.error("[fenok-public-mirror-guard] forbidden public files:");
    for (const violation of result.violations) console.error(`- ${violation}`);
    process.exit(1);
  }
  console.log(`[fenok-public-mirror-guard] ok (${result.checkedFiles} public data files checked)`);
}
