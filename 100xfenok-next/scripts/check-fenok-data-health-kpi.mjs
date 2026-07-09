#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ROOT_KPI_PATH = path.join(REPO_ROOT, "data", "admin", "fenok-data-health-kpi.json");
const PUBLIC_KPI_PATH = path.join(APP_ROOT, "public", "data", "admin", "fenok-data-health-kpi.json");
const SCHEMA_VERSION = "fenok-data-health-kpi/v1";
const REQUIRED_LANES = new Set([
  "stock_s0_active_daily_gate",
  "stock_s1_candidate_gate",
  "etf_public_and_daily_gate",
  "rim_inputs",
  "product_surface_freshness",
  "finra_occ_plain_us_and_mapping_policy",
  "automation_contract",
  "public_mirror_safety",
]);
const FORBIDDEN_PUBLIC_TOKENS = [
  "_private/",
  "\"private_manifest_file\"",
  "\"manifest_file\"",
  "\"tickers\"",
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(REPO_ROOT, filePath)} read failed: ${error.message}`);
  }
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function validatePayload(payload, errors, { publicMirror = false } = {}) {
  assert(payload?.schema_version === SCHEMA_VERSION, `schema_version must be ${SCHEMA_VERSION}`, errors);
  assert(typeof payload?.generated_at === "string" && payload.generated_at.length >= 10, "generated_at is required", errors);
  assert(payload?.status === "ready", `status must be ready, got ${payload?.status ?? "missing"}`, errors);
  assert(payload?.raw_policy?.public_mirror_allowed === true, "raw_policy.public_mirror_allowed must be true", errors);
  assert(payload?.raw_policy?.raw_rows_included === false, "raw_policy.raw_rows_included must be false", errors);
  assert(payload?.raw_policy?.private_artifact_paths_included === false, "raw_policy.private_artifact_paths_included must be false", errors);
  assert(payload?.raw_policy?.private_ledgers_included === false, "raw_policy.private_ledgers_included must be false", errors);
  assert(Array.isArray(payload?.lanes) && payload.lanes.length >= REQUIRED_LANES.size, "lanes are required", errors);
  assert(Number(payload?.totals?.required_not_ready || 0) === 0, "totals.required_not_ready must be zero", errors);

  const lanesById = new Map((payload?.lanes || []).map((lane) => [lane?.id, lane]));
  for (const laneId of REQUIRED_LANES) {
    const lane = lanesById.get(laneId);
    assert(Boolean(lane), `${laneId}: lane missing`, errors);
    assert(lane?.status === "ready", `${laneId}: lane status must be ready`, errors);
    for (const check of lane?.checks || []) {
      if (check?.required === false) continue;
      assert(check?.status === "ready", `${laneId}/${check?.id || "check"}: required check is ${check?.status}`, errors);
    }
  }

  const artifacts = Array.isArray(payload?.source_artifacts) ? payload.source_artifacts : [];
  const unsafePublicArtifacts = artifacts.filter((artifact) => artifact?.public_mirror === true && artifact?.public_safe !== true);
  assert(unsafePublicArtifacts.length === 0, `public source artifacts must be public_safe: ${unsafePublicArtifacts.map((item) => item.id).join(", ")}`, errors);

  if (publicMirror) {
    const text = fs.readFileSync(PUBLIC_KPI_PATH, "utf8");
    for (const token of FORBIDDEN_PUBLIC_TOKENS) {
      assert(!text.includes(token), `public KPI contains forbidden token ${token}`, errors);
    }
  }
}

const rootPayload = readJson(ROOT_KPI_PATH);
const publicPayload = readJson(PUBLIC_KPI_PATH);
const errors = [];

validatePayload(rootPayload, errors);
validatePayload(publicPayload, errors, { publicMirror: true });
assert(JSON.stringify(rootPayload) === JSON.stringify(publicPayload), "public KPI mirror must match root KPI", errors);

if (errors.length) {
  console.error("fenok data health KPI check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  schema_version: rootPayload.schema_version,
  generated_at: rootPayload.generated_at,
  status: rootPayload.status,
  lanes: rootPayload.totals?.lanes ?? rootPayload.lanes.length,
}, null, 2));
