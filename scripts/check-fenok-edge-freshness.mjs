#!/usr/bin/env node
/**
 * Validate Fenok Edge coverage/freshness semantics.
 *
 * This is a local admin gate. It reads derived stats only and fails closed on
 * missing/stale counted daily sources, raw-public leakage, or unsafe public
 * readiness claims.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-edge-coverage-index.json");
const PUBLIC_DATA_ROOT = path.join(REPO_ROOT, "100xfenok-next", "public", "data");
const PUBLIC_INDEX_PATH = path.join(PUBLIC_DATA_ROOT, "admin", "fenok-edge-coverage-index.json");
const JSON_MODE = process.argv.includes("--json");
const REQUIRE_ACTIVE_S0_DAILY_GATED = process.argv.includes("--require-active-s0-daily-gated");
const EXPECTED_ACTIVE_S0_STOCK_COUNT = 1066;
const ACTIVE_S0_TRACK_ID = "active_stock_scoring_current";
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

function fmt(status) {
  if (status === "ready") return "OK";
  if (status === "blocked_for_numerator" || status === "not_in_universe") return "WARN";
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

function freshnessReady(checks, id) {
  return findById(checks, id)?.status === "ready";
}

function fullSourceCoverage(row) {
  return Boolean(row)
    && row.availability_status === "ready"
    && Number(row.denominator) > 0
    && Number(row.covered_count) === Number(row.denominator);
}

function requirementsReady(requirements) {
  return Boolean(requirements?.public && requirements?.daily && requirements?.gated)
    && Object.values(requirements ?? {}).every(Boolean);
}

function activeS0DailyGatedReady(track, activeCount) {
  return Boolean(track)
    && activeCount === EXPECTED_ACTIVE_S0_STOCK_COUNT
    && Number(track.denominator) === activeCount
    && track.readiness_status === "ready"
    && track.public_done_claim_allowed === true
    && requirementsReady(track.requirements);
}

function publicMirrorEvidence(index, activeTotal) {
  let mirror = null;
  let read_error = null;
  const exists = fs.existsSync(PUBLIC_INDEX_PATH);
  if (exists) {
    try {
      mirror = JSON.parse(fs.readFileSync(PUBLIC_INDEX_PATH, "utf8"));
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
  const generated_at_matches = Boolean(mirror) && mirror.generated_at === index.generated_at;
  const active_total_matches = Boolean(mirror) && Number(mirror.active_scoring_universe?.total) === activeTotal;
  return {
    public_index_path: path.relative(REPO_ROOT, PUBLIC_INDEX_PATH),
    exists,
    read_error,
    generated_at_matches,
    active_total_matches,
    forbidden_public_files: forbidden_public_files.slice(0, 12),
    forbidden_public_file_count: forbidden_public_files.length,
    ready: exists
      && !read_error
      && generated_at_matches
      && active_total_matches
      && forbidden_public_files.length === 0,
  };
}

function buildActiveS0Evidence(index, activeTotal, activeTrack, sourceRows, composites, freshnessChecks) {
  const krx = findById(sourceRows, "krx_issuer_daily_latest_full_proof");
  const finra = findById(sourceRows, "us_finra_flow_proxy");
  const occ = findById(sourceRows, "us_occ_options_proxy");
  const asiaGap = composites.remaining_asia_ex_taiwan ?? {};
  const mirror = publicMirrorEvidence(index, activeTotal);
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
    check("no_asia_ex_taiwan_gap", Number(asiaGap.count) === 0, {
      count: Number(asiaGap.count) || 0,
      denominator: asiaGap.denominator ?? activeTotal,
    }),
    check("counted_sources_fresh", ["coverage_index_generated", "korea_counted_source_date", "us_flow_source_date", "us_occ_source_date"]
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
const activeTotal = Number(active.total) || 0;
const activeMarketTotal = sumCounts(active.by_market);
const buckets = active.buckets ?? {};
const sourceAvailability = index.source_availability ?? {};
const sourceRows = asArray(sourceAvailability.sources);
const composites = index.source_availability_composites ?? {};
const readiness = index.public_scoring_readiness ?? {};
const readinessTracks = asArray(readiness.tracks);
const activeS0ReadinessTrack = readinessTracks.find((track) => track?.id === ACTIVE_S0_TRACK_ID);
const freshnessChecks = asArray(index.freshness_gate?.checks);
const activeS0Evidence = buildActiveS0Evidence(index, activeTotal, activeS0ReadinessTrack, sourceRows, composites, freshnessChecks);

if (!activeTotal) add(errors, "active_scoring_universe.total must be derived and non-zero");
if (activeMarketTotal && activeMarketTotal !== activeTotal) {
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

if (sourceAvailability.not_public_scoring !== true) {
  add(errors, "source_availability must be marked not_public_scoring=true");
}
for (const row of sourceRows) {
  if (Number(row.covered_count) > Number(row.denominator)) {
    add(errors, `${row.id}: covered_count exceeds denominator`);
  }
  if (row.not_public_scoring !== true) {
    add(errors, `${row.id}: source availability row must be not_public_scoring=true`);
  }
  if (!row.claim_scope || row.claim_scope === "public_scoring") {
    add(errors, `${row.id}: source availability row has unsafe claim_scope=${row.claim_scope}`);
  }
  if (row.availability_status === "missing" || row.availability_status === "stale") {
    add(errors, `${row.id}: ${row.availability_status}`, row);
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

if (REQUIRE_ACTIVE_S0_DAILY_GATED) {
  if (activeTotal !== EXPECTED_ACTIVE_S0_STOCK_COUNT) {
    add(errors, `strict S0 gate requires active_scoring_universe.total=${EXPECTED_ACTIVE_S0_STOCK_COUNT}; got ${activeTotal}`);
  }
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
  if (check.status === "stale" || check.status === "missing") {
    add(errors, `${check.id}: ${check.status}`, check);
  } else if (check.status !== "ready") {
    add(warnings, `${check.id}: ${check.status}`, check);
  }
}

const result = {
  ok: errors.length === 0,
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
    expected_active_stock_count: EXPECTED_ACTIVE_S0_STOCK_COUNT,
    active_stock_count: activeTotal,
    track_id: ACTIVE_S0_TRACK_ID,
    track_found: Boolean(activeS0ReadinessTrack),
    ok: activeS0DailyGatedReady(activeS0ReadinessTrack, activeTotal),
    stage: activeS0ReadinessTrack?.stage ?? null,
    readiness_status: activeS0ReadinessTrack?.readiness_status ?? null,
    public_done_claim_allowed: activeS0ReadinessTrack?.public_done_claim_allowed === true,
    requirements: activeS0ReadinessTrack?.requirements ?? null,
  } : null,
  active_s0_daily_gated_evidence: activeS0Evidence,
  checks: freshnessChecks.map((check) => ({
    id: check.id,
    status: check.status,
    result: fmt(check.status),
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
  console.log(`Fenok Edge freshness gate: ${result.ok ? "PASS" : "FAIL"}`);
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
  for (const check of result.checks) {
    console.log(`- ${check.result} ${check.id}${check.source_date ? ` source_date=${check.source_date}` : ""}${check.age_days != null ? ` age_days=${check.age_days}` : ""}`);
  }
  console.log(`active S0 evidence: daily_ready=${activeS0Evidence.daily_ready} gated_ready=${activeS0Evidence.gated_ready} blockers=${activeS0Evidence.blockers.join(",") || "none"}`);
  for (const warning of warnings) console.log(`WARN: ${warning.message}`);
  for (const error of errors) console.error(`ERROR: ${error.message}`);
}

process.exit(errors.length ? 1 : 0);
