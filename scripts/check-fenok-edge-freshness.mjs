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
const JSON_MODE = process.argv.includes("--json");

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

function requirementsReady(requirements) {
  return Boolean(requirements?.public && requirements?.daily && requirements?.gated)
    && Object.values(requirements ?? {}).every(Boolean);
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
const freshnessChecks = asArray(index.freshness_gate?.checks);

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
  for (const check of result.checks) {
    console.log(`- ${check.result} ${check.id}${check.source_date ? ` source_date=${check.source_date}` : ""}${check.age_days != null ? ` age_days=${check.age_days}` : ""}`);
  }
  for (const warning of warnings) console.log(`WARN: ${warning.message}`);
  for (const error of errors) console.error(`ERROR: ${error.message}`);
}

process.exit(errors.length ? 1 : 0);
