#!/usr/bin/env node
/**
 * Validate Fenok Edge coverage/freshness semantics.
 *
 * This is a local admin gate. It reads derived stats only. Deploy verification
 * reports missing/stale source availability as lane-local degradation while
 * still failing on corruption, unsafe public claims, and false-ready evidence.
 * The explicit S0 DAILY/GATED proof remains strict.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IS_DIRECT_RUN = process.argv[1] ? path.resolve(process.argv[1]) === __filename : false;
const REPO_ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-edge-coverage-index.json");
const S0_FINRA_OCC_LEDGER_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-s0-finra-occ-mapping-ledger.json");
const PUBLIC_DATA_ROOT = path.join(REPO_ROOT, "100xfenok-next", "public", "data");
const PUBLIC_INDEX_PATH = path.join(PUBLIC_DATA_ROOT, "admin", "fenok-edge-coverage-index.json");
const JSON_MODE = process.argv.includes("--json");
const REQUIRE_ACTIVE_S0_DAILY_GATED = process.argv.includes("--require-active-s0-daily-gated");
const LANE_LOCAL_DEGRADATION_MODE = !REQUIRE_ACTIVE_S0_DAILY_GATED;
const PUBLIC_BUNDLE_MODE = process.argv.includes("--public-bundle") || process.argv.includes("--warn-stale-counted-sources");
const ACTIVE_S0_TRACK_ID = "active_stock_scoring_current";
const S0_LEDGER_MAX_GENERATED_LAG_MS = 10 * 60 * 1000;
const DEGRADED_AVAILABILITY_STATUSES = new Set(["stale", "missing", "partial", "behind", "unavailable", "error"]);
const SOURCE_AVAILABILITY_STATUSES = new Set(["ready", "partial", "missing", "stale", "behind", "unavailable", "error", "not_in_universe"]);
const DEGRADED_FRESHNESS_STATUSES = new Set([
  ...DEGRADED_AVAILABILITY_STATUSES,
  "blocked_fetchable_gap",
  "blocked_fetchable_daily_gap",
  "blocked_for_numerator",
  "not_in_universe",
]);
const FULL_COVERAGE_CLAIM_SCOPES = new Set(["source_available", "proxy_source_available", "yf_daily_source_available"]);
const PUBLIC_FORBIDDEN_PATTERNS = [
  /^computed\/fenok_signals\.json$/,
  /^computed\/fenok_etf_signals\.json$/,
  /^computed\/fenok_flow_proxies.*\.json$/,
  /^computed\/fenok_occ_options_volume.*\.json$/,
  /^computed\/fenok_news_tone_proxy.*\.json$/,
  /^computed\/fenok_signal_lens_proxies.*\.json$/,
  /^computed\/fenok_social_attention_proxy.*\.json$/,
  /^computed\/fenok_apewisdom.*\.json$/,
];
const PUBLIC_FORBIDDEN_RAW_PATTERNS = [
  /\.(csv|txt)$/i,
  /(^|\/)(finra|occ|apewisdom|gdelt|reddit|social)(\/|_)/i,
];

function readJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(REPO_ROOT, absPath)} read failed: ${error.message}`);
  }
}

function add(list, message, extra = {}) {
  list.push({ message, ...extra });
}

function fmt(status, degraded = false) {
  if (degraded) return "DEGRADED";
  if (status === "ready") return "OK";
  if (String(status ?? "").startsWith("blocked") || status === "not_in_universe") return "WARN";
  return "FAIL";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sumCounts(rows, key = "count") {
  return asArray(rows).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function findById(rows, id) {
  return asArray(rows).find((row) => row?.id === id) ?? null;
}

function walkFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(abs));
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

function publicRel(absPath) {
  return path.relative(PUBLIC_DATA_ROOT, absPath).split(path.sep).join("/");
}

function check(id, ok, detail = {}) {
  return { id, ok: Boolean(ok), ...detail };
}

function toEpochMs(value) {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : null;
}

function freshnessReady(checks, id) {
  return findById(checks, id)?.status === "ready";
}

function warnOnlyAvailabilityIssue(value, enabled = LANE_LOCAL_DEGRADATION_MODE) {
  const status = value?.status ?? value?.availability_status;
  return enabled && DEGRADED_FRESHNESS_STATUSES.has(status);
}

function fullSourceCoverage(row) {
  return Boolean(row)
    && row.availability_status === "ready"
    && Number(row.denominator) > 0
    && Number(row.covered_count) === Number(row.denominator);
}

function sourceAvailabilityIntegrityErrors(row) {
  const errors = [];
  if (!row || typeof row !== "object" || Array.isArray(row)) return ["source availability row must be an object"];
  if (typeof row.id !== "string" || !row.id.trim()) errors.push("source availability row id must be a non-empty string");
  const covered = row.covered_count;
  const denominator = row.denominator;
  if (!Number.isInteger(covered) || covered < 0) errors.push(`${row.id}: covered_count must be a non-negative integer`);
  if (!Number.isInteger(denominator) || denominator < 0) errors.push(`${row.id}: denominator must be a non-negative integer`);
  if (!SOURCE_AVAILABILITY_STATUSES.has(row.availability_status)) {
    errors.push(`${row.id}: unknown availability_status=${row.availability_status}`);
  }
  if (Number.isInteger(covered) && Number.isInteger(denominator) && covered > denominator) {
    errors.push(`${row.id}: covered_count exceeds denominator`);
  }
  if (row.availability_status === "ready"
    && FULL_COVERAGE_CLAIM_SCOPES.has(row.claim_scope)
    && (denominator <= 0 || covered !== denominator)) {
    errors.push(`${row.id}: false-ready availability ${covered}/${denominator}`);
  }
  if (row.claim_scope === "run_health") {
    const targetCount = row.target_universe?.ticker_count;
    if (!Number.isInteger(targetCount) || targetCount < 0) {
      errors.push(`${row.id}: run_health target_universe.ticker_count must be a non-negative integer`);
    } else if (covered !== targetCount) {
      errors.push(`${row.id}: run_health covered_count ${covered} != target ticker_count ${targetCount}`);
    }
  }
  if (row.availability_status === "partial" && !(denominator > 0 && covered > 0 && covered < denominator)) {
    errors.push(`${row.id}: partial availability must satisfy 0 < covered_count < denominator`);
  }
  return errors;
}

function requirementsReady(requirements) {
  return Boolean(requirements?.public && requirements?.daily && requirements?.gated)
    && Object.values(requirements ?? {}).every(Boolean);
}

function activeS0DailyGatedReady(track, activeCount) {
  return Boolean(track)
    && Number(activeCount) > 0
    && Number(track.denominator) === activeCount
    && track.readiness_status === "ready"
    && track.public_done_claim_allowed === true
    && requirementsReady(track.requirements);
}

function compactPublicSourceRow(row) {
  return {
    id: row.id,
    label: row.label,
    covered_count: row.covered_count,
    denominator: row.denominator,
    denominator_label: row.denominator_label,
    coverage_pct: row.coverage_pct,
    active_scoring_coverage_pct: row.active_scoring_coverage_pct,
    source_date: row.source_date,
    availability_status: row.availability_status,
    claim_scope: row.claim_scope,
    not_public_scoring: row.not_public_scoring === true,
    caveat: row.caveat,
  };
}

function expectedPublicMirror(index) {
  return {
    schema_version: "fenok-edge-coverage-index-public/v0.1",
    source_schema_version: index.schema_version,
    generated_at: index.generated_at,
    purpose: "Compact public admin readiness mirror. Contains derived counts/status only; no raw rows, private manifests, target ticker lists, or private artifact paths.",
    raw_policy: {
      raw_public: index.raw_policy?.raw_public === true,
      raw_rows_included: index.raw_policy?.raw_rows_included === true,
      private_artifact_paths_included: false,
    },
    active_scoring_universe: {
      generated_at: index.active_scoring_universe?.generated_at ?? null,
      current_only: index.active_scoring_universe?.current_only === true,
      total: index.active_scoring_universe?.total ?? null,
      by_market: index.active_scoring_universe?.by_market ?? [],
      buckets: index.active_scoring_universe?.buckets ?? {},
    },
    expanded_stock_candidate_universe: {
      generated_at: index.expanded_stock_candidate_universe?.generated_at ?? null,
      collected_asset_total: index.expanded_stock_candidate_universe?.collected_asset_total ?? null,
      collected_stock_candidates: index.expanded_stock_candidate_universe?.collected_stock_candidates ?? null,
      scored_public_stock: index.expanded_stock_candidate_universe?.scored_public_stock ?? null,
      stock_promotion_audit_gap: index.expanded_stock_candidate_universe?.stock_promotion_audit_gap ?? null,
      stage: index.expanded_stock_candidate_universe?.stage ?? null,
      public_done_claim_allowed: index.expanded_stock_candidate_universe?.public_done_claim_allowed === true,
      caveat: index.expanded_stock_candidate_universe?.caveat ?? null,
    },
    etf_universe: {
      collected_etf_candidates: index.etf_universe?.collected_etf_candidates ?? null,
      eligible_etf_count: index.etf_universe?.eligible_etf_count ?? null,
      stage: index.etf_universe?.stage ?? null,
      scored_public_etf: index.etf_universe?.scored_public_etf ?? null,
      public_done_claim_allowed: index.etf_universe?.public_done_claim_allowed === true,
      evidence_based_readiness: index.etf_universe?.evidence_based_readiness ?? null,
      core_daily_basket: index.etf_universe?.core_daily_basket ?? null,
      caveat: index.etf_universe?.caveat ?? null,
    },
    source_availability: {
      not_public_scoring: index.source_availability?.not_public_scoring === true,
      caveat: index.source_availability?.caveat ?? null,
      source_count: (index.source_availability?.sources ?? []).length,
      sources: (index.source_availability?.sources ?? []).map(compactPublicSourceRow),
    },
    source_availability_composites: index.source_availability_composites ?? null,
    public_scoring_readiness: index.public_scoring_readiness ?? null,
    freshness_gate: index.freshness_gate ?? null,
  };
}

function publicMirrorEvidence(index, activeTotal) {
  let mirror = null;
  let mirror_text = null;
  let read_error = null;
  const exists = fs.existsSync(PUBLIC_INDEX_PATH);
  if (exists) {
    try {
      mirror_text = fs.readFileSync(PUBLIC_INDEX_PATH, "utf8");
      mirror = JSON.parse(mirror_text);
    } catch (error) {
      read_error = error.message;
    }
  }
  const forbidden_public_files = walkFiles(PUBLIC_DATA_ROOT)
    .map(publicRel)
    .filter((rel) => (
      PUBLIC_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(rel))
      || PUBLIC_FORBIDDEN_RAW_PATTERNS.some((pattern) => pattern.test(rel))
    ));
  const unsafe_public_index_tokens = mirror_text ? [
    "_private/",
    "\"private_manifest_file\"",
    "\"manifest_file\"",
    "\"target_universe\"",
    "\"tickers\"",
    "\"source_file\"",
  ].filter((token) => mirror_text.includes(token)) : [];
  const schema_ok = Boolean(mirror)
    && mirror.schema_version === "fenok-edge-coverage-index-public/v0.1"
    && mirror.source_schema_version === index.schema_version;
  const raw_policy_safe = Boolean(mirror)
    && mirror.raw_policy?.raw_public === false
    && mirror.raw_policy?.raw_rows_included === false
    && mirror.raw_policy?.private_artifact_paths_included === false;
  const generated_at_matches = Boolean(mirror) && mirror.generated_at === index.generated_at;
  const active_total_matches = Boolean(mirror) && Number(mirror.active_scoring_universe?.total) === activeTotal;
  const exact_projection_matches = Boolean(mirror)
    && JSON.stringify(mirror) === JSON.stringify(expectedPublicMirror(index));
  return {
    public_index_path: path.relative(REPO_ROOT, PUBLIC_INDEX_PATH),
    exists,
    read_error,
    schema_ok,
    raw_policy_safe,
    generated_at_matches,
    active_total_matches,
    exact_projection_matches,
    unsafe_public_index_tokens,
    forbidden_public_files: forbidden_public_files.slice(0, 12),
    forbidden_public_file_count: forbidden_public_files.length,
    ready: exists
      && !read_error
      && schema_ok
      && raw_policy_safe
      && generated_at_matches
      && active_total_matches
      && exact_projection_matches
      && unsafe_public_index_tokens.length === 0
      && forbidden_public_files.length === 0,
  };
}

function buildActiveS0Evidence(index, activeTotal, activeTrack, sourceRows, composites, freshnessChecks) {
  const krx = findById(sourceRows, "krx_issuer_daily_latest_full_proof");
  const finra = findById(sourceRows, "us_finra_flow_proxy");
  const occ = findById(sourceRows, "us_occ_options_proxy");
  const usClassYf = findById(sourceRows, "us_class_yf_daily_source");
  const asiaYf = findById(sourceRows, "asia_ex_taiwan_yf_daily_source");
  const asiaGap = composites.remaining_asia_ex_taiwan ?? {};
  const mirror = publicMirrorEvidence(index, activeTotal);
  const asiaGapCount = Number(asiaGap.count) || 0;
  const daily_checks = [
    check("krx_full_daily_source_ready", fullSourceCoverage(krx) && freshnessReady(freshnessChecks, "korea_counted_source_date"), {
      covered_count: krx?.covered_count ?? null,
      denominator: krx?.denominator ?? null,
      source_date: krx?.source_date ?? null,
    }),
    check("finra_full_us_source_ready", fullSourceCoverage(finra) && freshnessReady(freshnessChecks, "us_flow_source_date"), {
      covered_count: finra?.covered_count ?? null,
      denominator: finra?.denominator ?? null,
      source_date: finra?.source_date ?? null,
    }),
    check("occ_full_us_source_ready", fullSourceCoverage(occ) && freshnessReady(freshnessChecks, "us_occ_source_date"), {
      covered_count: occ?.covered_count ?? null,
      denominator: occ?.denominator ?? null,
      source_date: occ?.source_date ?? null,
    }),
    check("us_class_yf_daily_source_ready", fullSourceCoverage(usClassYf) && freshnessReady(freshnessChecks, "us_class_yf_source_date"), {
      covered_count: usClassYf?.covered_count ?? null,
      denominator: usClassYf?.denominator ?? null,
      source_date: usClassYf?.source_date ?? null,
    }),
    check("asia_ex_taiwan_yf_daily_source_ready", fullSourceCoverage(asiaYf) && freshnessReady(freshnessChecks, "asia_ex_taiwan_yf_source_date"), {
      covered_count: asiaYf?.covered_count ?? null,
      denominator: asiaYf?.denominator ?? null,
      source_date: asiaYf?.source_date ?? null,
      remaining_gap_count: asiaGapCount,
    }),
    check("counted_sources_fresh", ["coverage_index_generated", "korea_counted_source_date", "us_flow_source_date", "us_occ_source_date", "us_class_yf_source_date", "asia_ex_taiwan_yf_source_date"]
      .every((id) => freshnessReady(freshnessChecks, id))),
  ];
  const daily_ready = daily_checks.every((item) => item.ok);
  const gated_checks = [
    check("daily_ready", daily_ready),
    check("raw_policy_private_only", index.raw_policy?.raw_public === false && index.raw_policy?.raw_rows_included === false),
    check("source_rows_not_public_scoring", index.source_availability?.not_public_scoring === true
      && sourceRows.every((row) => row?.not_public_scoring === true)),
    check("public_mirror_ready", mirror.ready, mirror),
  ];
  const gated_ready = gated_checks.every((item) => item.ok);
  return {
    track_id: ACTIVE_S0_TRACK_ID,
    track_stage: activeTrack?.stage ?? null,
    active_stock_count: activeTotal,
    track_denominator: activeTrack?.denominator ?? null,
    daily_ready,
    gated_ready,
    blockers: [...daily_checks, ...gated_checks].filter((item) => !item.ok).map((item) => item.id),
    daily_checks,
    gated_checks,
  };
}

function s0FinraOccLedgerEvidence(index, activeTotal) {
  let ledger = null;
  let read_error = null;
  const exists = fs.existsSync(S0_FINRA_OCC_LEDGER_PATH);
  if (exists) {
    try {
      ledger = readJson(S0_FINRA_OCC_LEDGER_PATH);
    } catch (error) {
      read_error = error.message;
    }
  }

  const indexGeneratedMs = toEpochMs(index.generated_at);
  const ledgerGeneratedMs = toEpochMs(ledger?.generated_at);
  const generated_lag_ms = indexGeneratedMs != null && ledgerGeneratedMs != null
    ? Math.max(0, indexGeneratedMs - ledgerGeneratedMs)
    : null;
  const generated_fresh = generated_lag_ms != null && generated_lag_ms <= S0_LEDGER_MAX_GENERATED_LAG_MS;

  const expectedRowCounts = {
    finra_excluded_us_class_or_non_plain_daily_ready: ledger?.counts?.finra_excluded_us_class_or_non_plain_daily_ready,
    finra_mapping_required_missing_row: ledger?.counts?.finra_mapping_required_missing_row,
    finra_source_ready_no_reported_row: ledger?.counts?.finra_source_ready_no_reported_row,
    finra_low_confidence_placeholder_policy_rows: ledger?.counts?.finra_low_confidence_placeholder_policy_rows,
    occ_non_plain_mapping_required: ledger?.counts?.occ_non_plain_mapping_required,
    occ_class_share_normalization_required: ledger?.counts?.occ_class_share_normalization_required,
    occ_no_listed_options_source_ready: ledger?.counts?.plain_us_occ_no_listed_options_source_ready,
  };
  const row_count_checks = Object.entries(expectedRowCounts).map(([key, expected]) => {
    const actual = asArray(ledger?.rows?.[key]).length;
    return { key, expected: Number(expected), actual, ok: actual === Number(expected) };
  });
  const sourceRows = asArray(index.source_availability?.sources);
  const finraSource = findById(sourceRows, "us_finra_flow_proxy");
  const occSource = findById(sourceRows, "us_occ_options_proxy");

  const integrity_ready = exists
    && !read_error
    && ledger?.schema_version === "fenok-s0-finra-occ-mapping-ledger/v0.1"
    && ledger?.raw_policy?.fetches_external_data === false
    && ledger?.raw_policy?.public_bundle_safe === false
    && ledger?.raw_policy?.admin_local_only === true
    && ledger?.raw_policy?.raw_private_cache_included === false
    && ledger?.service_boundary?.active_s0_daily_source_gate_blocker === false
    && Number(ledger?.counts?.active_us_total) === Number(index.active_scoring_universe?.buckets?.us)
    && Number(ledger?.counts?.plain_us_finra_denominator) === Number(finraSource?.denominator)
    && Number(ledger?.counts?.plain_us_finra_source_ready) === Number(finraSource?.covered_count)
    && Number(ledger?.counts?.plain_us_occ_denominator) === Number(occSource?.denominator)
    && Number(ledger?.counts?.plain_us_occ_source_ready) === Number(occSource?.covered_count)
    && Number(index.active_scoring_universe?.total) === Number(activeTotal)
    && row_count_checks.every((item) => item.ok);

  const evidence = {
    path: path.relative(REPO_ROOT, S0_FINRA_OCC_LEDGER_PATH),
    exists,
    read_error,
    schema_version: ledger?.schema_version ?? null,
    generated_at: ledger?.generated_at ?? null,
    index_generated_at: index.generated_at ?? null,
    generated_lag_ms,
    max_generated_lag_ms: S0_LEDGER_MAX_GENERATED_LAG_MS,
    generated_fresh,
    raw_policy: ledger?.raw_policy ?? null,
    service_boundary: ledger?.service_boundary ?? null,
    counts: ledger?.counts ?? null,
    row_count_checks,
    integrity_ready,
    ready: integrity_ready && generated_fresh,
  };

  return evidence;
}

function main() {
const index = readJson(INDEX_PATH);
const errors = [];
const warnings = [];

if (index.schema_version !== "fenok-edge-coverage-index/v0.2") {
  add(errors, "schema_version must be fenok-edge-coverage-index/v0.2");
}
if (index.raw_policy?.raw_public !== false || index.raw_policy?.raw_rows_included !== false) {
  add(errors, "raw_policy must confirm no public raw rows");
}

if (index.source_coverages || index.combined_coverage || index.universe) {
  add(errors, "legacy v0.1 keys source_coverages/combined_coverage/universe must not be present in v0.2");
}

const active = index.active_scoring_universe ?? {};
const activeTotalValid = Number.isInteger(active.total) && active.total >= 0;
const activeTotal = activeTotalValid ? active.total : 0;
const activeMarketTotal = sumCounts(active.by_market);
const buckets = active.buckets ?? {};
const sourceAvailability = index.source_availability ?? {};
const sourceRows = asArray(sourceAvailability.sources);
const composites = index.source_availability_composites ?? {};
const readiness = index.public_scoring_readiness ?? {};
const readinessTracks = asArray(readiness.tracks);
const activeS0ReadinessTrack = readinessTracks.find((track) => track?.id === ACTIVE_S0_TRACK_ID);
const etfReadinessTrack = readinessTracks.find((track) => track?.id === "etf_scoring_lane");
const etfEvidence = etfReadinessTrack?.evidence_based_readiness ?? index.etf_universe?.evidence_based_readiness ?? null;
const etfCoreReadinessTrack = readinessTracks.find((track) => track?.id === "etf_core_daily_basket");
const etfCoreEvidence = etfCoreReadinessTrack?.evidence_based_readiness ?? index.etf_universe?.core_daily_basket?.evidence_based_readiness ?? null;
const freshnessChecks = asArray(index.freshness_gate?.checks);
const activeS0Evidence = buildActiveS0Evidence(index, activeTotal, activeS0ReadinessTrack, sourceRows, composites, freshnessChecks);
const s0LedgerEvidence = s0FinraOccLedgerEvidence(index, activeTotal);
const publicBundleDegradedChecks = new Set();

function addAvailabilityProblem(id, message, detail = {}) {
  if (LANE_LOCAL_DEGRADATION_MODE) {
    publicBundleDegradedChecks.add(id);
    add(warnings, `${message} (lane-local degraded; deploy proceeds)`, {
      ...detail,
      degraded_for_public_bundle: true,
    });
    return;
  }
  add(errors, message, detail);
}

if (!activeTotalValid) add(errors, "active_scoring_universe.total must be a non-negative integer");
if (!Array.isArray(active.by_market)) add(errors, "active_scoring_universe.by_market must be an array");
for (const row of asArray(active.by_market)) {
  if (!row || typeof row !== "object" || Array.isArray(row) || !Number.isInteger(row.count) || row.count < 0) {
    add(errors, "active_scoring_universe.by_market rows need non-negative integer counts");
  }
}
for (const key of ["us", "korea", "asia_ex_taiwan", "explicit_taiwan"]) {
  if (!Number.isInteger(buckets[key]) || buckets[key] < 0) {
    add(errors, `active_scoring_universe.buckets.${key} must be a non-negative integer`);
  }
}
if (activeTotalValid && activeTotal === 0) {
  addAvailabilityProblem("active_scoring_universe", "active_scoring_universe is empty");
}
if (activeTotalValid && activeMarketTotal !== activeTotal) {
  add(errors, `active_scoring_universe.by_market sum ${activeMarketTotal} does not match total ${activeTotal}`);
}
if ((Number(buckets.us) || 0) + (Number(buckets.korea) || 0) + (Number(buckets.asia_ex_taiwan) || 0) + (Number(buckets.explicit_taiwan) || 0) !== activeTotal) {
  add(errors, "active_scoring_universe.buckets must sum to active_scoring_universe.total");
}
if (buckets.explicit_taiwan !== 0) {
  add(warnings, `Explicit Taiwan bucket is now ${buckets.explicit_taiwan}; re-evaluate numerator semantics.`);
}
if (asArray(active.taiwan_ticker_anomalies).length > 0) {
  add(warnings, `Taiwan ticker anomaly count=${active.taiwan_ticker_anomalies.length}; mapping cleanup required.`);
}
if (!Array.isArray(active.taiwan_ticker_anomalies)) {
  add(errors, "active_scoring_universe.taiwan_ticker_anomalies must be an array");
}

if (sourceAvailability.not_public_scoring !== true) {
  add(errors, "source_availability must be marked not_public_scoring=true");
}
if (!Array.isArray(sourceAvailability.sources)) add(errors, "source_availability.sources must be an array");
if (!Array.isArray(readiness.tracks)) add(errors, "public_scoring_readiness.tracks must be an array");
if (!Array.isArray(index.freshness_gate?.checks)) add(errors, "freshness_gate.checks must be an array");
const publicMirrorCheck = activeS0Evidence.gated_checks.find((item) => item.id === "public_mirror_ready");
if (!publicMirrorCheck?.ok) add(errors, "public Fenok Edge mirror must exactly match the safe root projection", publicMirrorCheck);
for (const row of sourceRows) {
  for (const message of sourceAvailabilityIntegrityErrors(row)) add(errors, message);
  if (!row || typeof row !== "object" || Array.isArray(row)) continue;
  if (row.not_public_scoring !== true) {
    add(errors, `${row.id}: source availability row must be not_public_scoring=true`);
  }
  if (!row.claim_scope || row.claim_scope === "public_scoring") {
    add(errors, `${row.id}: source availability row has unsafe claim_scope=${row.claim_scope}`);
  }
  if (DEGRADED_AVAILABILITY_STATUSES.has(row.availability_status)) {
    addAvailabilityProblem(row.id, `${row.id}: ${row.availability_status}`, row);
  }
}

if (composites.not_public_scoring !== true) {
  add(errors, "source_availability_composites must be marked not_public_scoring=true");
}
for (const [id, row] of Object.entries(composites)) {
  if (id === "not_public_scoring" || id === "caveat") continue;
  if (row?.not_public_scoring !== true) {
    add(errors, `${id}: composite must be not_public_scoring=true`);
  }
  if (String(row?.claim_scope ?? "").includes("public")) {
    add(errors, `${id}: composite claim_scope must not imply public scoring`);
  }
}

if (!Array.isArray(readiness.completion_ladder) || !readiness.completion_ladder.includes("PUBLIC") || !readiness.completion_ladder.includes("DAILY") || !readiness.completion_ladder.includes("GATED")) {
  add(errors, "public_scoring_readiness.completion_ladder must include PUBLIC, DAILY, and GATED");
}
for (const track of readinessTracks) {
  const ready = requirementsReady(track.requirements);
  if (track.public_done_claim_allowed === true && !ready) {
    add(errors, `${track.id}: public_done_claim_allowed requires PUBLIC+DAILY+GATED and all requirements true`);
  }
  if (track.readiness_status === "ready" && !ready) {
    add(errors, `${track.id}: readiness_status=ready requires PUBLIC+DAILY+GATED and all requirements true`);
  }
  if (track.public_done_claim_allowed !== true) {
    add(warnings, `${track.id}: public readiness incomplete`, {
      id: track.id,
      stage: track.stage,
      readiness_status: track.readiness_status,
    });
  }
}

if (activeS0ReadinessTrack?.requirements?.daily === true && activeS0Evidence.daily_ready !== true) {
  add(errors, `${ACTIVE_S0_TRACK_ID}: requirements.daily=true requires active_s0_daily_gated_evidence.daily_ready=true`);
}
if (activeS0ReadinessTrack?.requirements?.gated === true && activeS0Evidence.gated_ready !== true) {
  add(errors, `${ACTIVE_S0_TRACK_ID}: requirements.gated=true requires active_s0_daily_gated_evidence.gated_ready=true`);
}
if (activeS0ReadinessTrack?.readiness_status === "ready" && activeS0Evidence.gated_ready !== true) {
  add(errors, `${ACTIVE_S0_TRACK_ID}: readiness_status=ready requires active_s0_daily_gated_evidence.gated_ready=true`);
}
if (activeS0ReadinessTrack?.public_done_claim_allowed === true && activeS0Evidence.gated_ready !== true) {
  add(errors, `${ACTIVE_S0_TRACK_ID}: public_done_claim_allowed=true requires active_s0_daily_gated_evidence.gated_ready=true`);
}
if (!s0LedgerEvidence.exists) {
  add(errors, "s0_finra_occ_mapping_ledger: required count-reconciliation ledger is missing", s0LedgerEvidence);
} else if (s0LedgerEvidence.read_error || !s0LedgerEvidence.integrity_ready) {
  add(errors, "s0_finra_occ_mapping_ledger: ledger must be well-formed, admin-local, and internally count-consistent", s0LedgerEvidence);
} else if (!s0LedgerEvidence.generated_fresh) {
  addAvailabilityProblem("s0_finra_occ_mapping_ledger", "s0_finra_occ_mapping_ledger: ledger generation is behind the coverage index", s0LedgerEvidence);
}

if (etfReadinessTrack?.requirements?.public === true && etfEvidence?.public_ready !== true) {
  add(errors, "etf_scoring_lane: requirements.public=true requires evidence_based_readiness.public_ready=true");
}
if (etfReadinessTrack?.stage === "PUBLIC" && etfEvidence?.public_ready !== true) {
  add(errors, "etf_scoring_lane: stage=PUBLIC requires evidence_based_readiness.public_ready=true");
}
if (etfReadinessTrack?.requirements?.daily === true && etfEvidence?.daily_ready !== true) {
  add(errors, "etf_scoring_lane: requirements.daily=true requires evidence_based_readiness.daily_ready=true");
}
if (etfReadinessTrack?.requirements?.gated === true && etfEvidence?.gated_ready !== true) {
  add(errors, "etf_scoring_lane: requirements.gated=true requires evidence_based_readiness.gated_ready=true");
}
if (etfReadinessTrack?.readiness_status === "ready" && etfEvidence?.gated_ready !== true) {
  add(errors, "etf_scoring_lane: readiness_status=ready requires evidence_based_readiness.gated_ready=true");
}
if (etfReadinessTrack?.public_done_claim_allowed === true && etfEvidence?.gated_ready !== true) {
  add(errors, "etf_scoring_lane: public_done_claim_allowed=true requires evidence_based_readiness.gated_ready=true");
}

if (etfCoreReadinessTrack?.requirements?.daily === true && etfCoreEvidence?.daily_ready !== true) {
  add(errors, "etf_core_daily_basket: requirements.daily=true requires evidence_based_readiness.daily_ready=true");
}
if (etfCoreReadinessTrack?.requirements?.gated === true && etfCoreEvidence?.gated_ready !== true) {
  add(errors, "etf_core_daily_basket: requirements.gated=true requires evidence_based_readiness.gated_ready=true");
}
if (etfCoreReadinessTrack?.public_done_claim_allowed === true) {
  add(errors, "etf_core_daily_basket: public_done_claim_allowed must remain false until a product surface is explicitly gated");
}
if (etfCoreEvidence?.core_daily_basket_ready === true && Number(etfCoreEvidence?.counts?.stale_selected_count) > 0) {
  add(errors, "etf_core_daily_basket: ready evidence cannot include stale selected rows");
}
if (etfCoreEvidence?.core_daily_basket_ready === true && etfCoreEvidence?.generated_fresh !== true) {
  add(errors, "etf_core_daily_basket: ready evidence requires fresh generated artifact");
}

if (REQUIRE_ACTIVE_S0_DAILY_GATED) {
  if (!activeS0ReadinessTrack) {
    add(errors, `strict S0 gate requires public_scoring_readiness track '${ACTIVE_S0_TRACK_ID}'`);
  } else {
    if (Number(activeS0ReadinessTrack.denominator) !== activeTotal) {
      add(errors, `${ACTIVE_S0_TRACK_ID}: denominator ${activeS0ReadinessTrack.denominator} must equal active S0 total ${activeTotal}`);
    }
    for (const requirement of ["source_available", "normalized", "joined_to_target_universe", "scored", "public", "daily", "gated"]) {
      if (activeS0ReadinessTrack.requirements?.[requirement] !== true) {
        add(errors, `${ACTIVE_S0_TRACK_ID}: strict S0 DAILY/GATED requires requirements.${requirement}=true`);
      }
    }
    if (activeS0ReadinessTrack.readiness_status !== "ready") {
      add(errors, `${ACTIVE_S0_TRACK_ID}: strict S0 DAILY/GATED requires readiness_status=ready`);
    }
    if (activeS0ReadinessTrack.public_done_claim_allowed !== true) {
      add(errors, `${ACTIVE_S0_TRACK_ID}: strict S0 DAILY/GATED requires public_done_claim_allowed=true`);
    }
  }
}

for (const check of freshnessChecks) {
  if (DEGRADED_FRESHNESS_STATUSES.has(check.status)) {
    if (warnOnlyAvailabilityIssue(check)) addAvailabilityProblem(check.id, `${check.id}: ${check.status}`, check);
    else addAvailabilityProblem(check.id, `${check.id}: ${check.status}`, check);
  } else if (check.status !== "ready") {
    add(errors, `${check.id}: unknown freshness status ${check.status}`, check);
  }
}

const result = {
  mode: REQUIRE_ACTIVE_S0_DAILY_GATED ? "strict-s0-daily-gated" : PUBLIC_BUNDLE_MODE ? "public-bundle" : "deploy-verification",
  ok: errors.length === 0,
  status: errors.length > 0 ? "blocked" : warnings.length > 0 ? "degraded" : "ready",
  generated_at: index.generated_at,
  active_scoring_universe: {
    total: activeTotal,
    buckets,
  },
  source_availability: {
    not_public_scoring: sourceAvailability.not_public_scoring === true,
    source_count: sourceRows.length,
    composites_not_public_scoring: composites.not_public_scoring === true,
  },
  public_scoring_readiness: readinessTracks.map((track) => ({
    id: track.id,
    stage: track.stage,
    readiness_status: track.readiness_status,
    public_done_claim_allowed: track.public_done_claim_allowed === true,
    public_daily_gated: requirementsReady(track.requirements),
  })),
  strict_s0_daily_gated: REQUIRE_ACTIVE_S0_DAILY_GATED ? {
    required: true,
    expected_active_stock_count: activeTotal,
    expected_active_stock_count_source: "active_scoring_universe.total",
    active_stock_count: activeTotal,
    track_id: ACTIVE_S0_TRACK_ID,
    track_found: Boolean(activeS0ReadinessTrack),
    ok: activeS0DailyGatedReady(activeS0ReadinessTrack, activeTotal),
    stage: activeS0ReadinessTrack?.stage ?? null,
    readiness_status: activeS0ReadinessTrack?.readiness_status ?? null,
    public_done_claim_allowed: activeS0ReadinessTrack?.public_done_claim_allowed === true,
    requirements: activeS0ReadinessTrack?.requirements ?? null,
  } : null,
  public_deploy_warn_only: {
    stale_counted_sources: LANE_LOCAL_DEGRADATION_MODE,
    availability_issues: LANE_LOCAL_DEGRADATION_MODE,
    degraded_checks: [...publicBundleDegradedChecks],
  },
  active_s0_daily_gated_evidence: activeS0Evidence,
  s0_finra_occ_mapping_ledger_evidence: s0LedgerEvidence,
  etf_scoring_lane_evidence: etfEvidence,
  etf_core_daily_basket_evidence: etfCoreEvidence,
  checks: freshnessChecks.map((check) => ({
    id: check.id,
    status: check.status,
    degraded: publicBundleDegradedChecks.has(check.id),
    result: fmt(check.status, publicBundleDegradedChecks.has(check.id)),
    source_date: check.source_date ?? null,
    age_days: check.age_days ?? null,
  })),
  warning_count: warnings.length,
  warnings,
  error_count: errors.length,
  errors,
};

if (JSON_MODE) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Fenok Edge freshness gate: ${result.ok ? result.status === "degraded" ? "PASS (DEGRADED)" : "PASS" : "FAIL"}`);
  console.log(`generated_at: ${result.generated_at}`);
  console.log(`active scoring universe: ${activeTotal}`);
  console.log(`source availability rows: ${sourceRows.length} (not public scoring)`);
  for (const track of result.public_scoring_readiness) {
    console.log(`- ${track.public_done_claim_allowed ? "OK" : "WARN"} ${track.id} stage=${track.stage} public_done=${track.public_done_claim_allowed}`);
  }
  if (REQUIRE_ACTIVE_S0_DAILY_GATED) {
    const strict = result.strict_s0_daily_gated;
    console.log(`strict S0 DAILY/GATED: ${strict.ok ? "PASS" : "FAIL"} track=${strict.track_id} active=${strict.active_stock_count}/${strict.expected_active_stock_count}`);
  }
  if (PUBLIC_BUNDLE_MODE) {
    const degradedChecks = [...publicBundleDegradedChecks];
    console.log(`public bundle mode: ${degradedChecks.length ? `DEGRADED ${degradedChecks.join(",")}` : "no degraded checks"}`);
  }
  for (const check of result.checks) {
    console.log(`- ${check.result} ${check.id}${check.source_date ? ` source_date=${check.source_date}` : ""}${check.age_days != null ? ` age_days=${check.age_days}` : ""}`);
  }
  console.log(`active S0 evidence: daily_ready=${activeS0Evidence.daily_ready} gated_ready=${activeS0Evidence.gated_ready} blockers=${activeS0Evidence.blockers.join(",") || "none"}`);
  console.log(`S0 FINRA/OCC mapping ledger: ready=${s0LedgerEvidence.ready} generated_at=${s0LedgerEvidence.generated_at ?? "n/a"} lag_ms=${s0LedgerEvidence.generated_lag_ms ?? "n/a"}`);
  if (etfEvidence) {
    console.log(`ETF evidence: public_ready=${etfEvidence.public_ready} daily_ready=${etfEvidence.daily_ready} gated_ready=${etfEvidence.gated_ready} blockers=${asArray(etfEvidence.blockers).join(",") || "none"}`);
  }
  if (etfCoreEvidence) {
    console.log(`ETF core basket evidence: ready=${etfCoreEvidence.core_daily_basket_ready} selected=${etfCoreEvidence.counts?.selected_count ?? "n/a"} fresh=${etfCoreEvidence.counts?.fresh_selected_count ?? "n/a"} stale=${etfCoreEvidence.counts?.stale_selected_count ?? "n/a"} blockers=${asArray(etfCoreEvidence.blockers).join(",") || "none"}`);
  }
  for (const warning of warnings) console.log(`WARN: ${warning.message}`);
  for (const error of errors) console.error(`ERROR: ${error.message}`);
}

return errors.length ? 1 : 0;
}

if (IS_DIRECT_RUN) process.exit(main());

export {
  activeS0DailyGatedReady,
  freshnessReady,
  fullSourceCoverage,
  expectedPublicMirror,
  requirementsReady,
  s0FinraOccLedgerEvidence,
  sourceAvailabilityIntegrityErrors,
  warnOnlyAvailabilityIssue,
};
