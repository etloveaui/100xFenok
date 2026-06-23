#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..");
const ROOT_COVERAGE_PATH = path.join(REPO_ROOT, "data", "admin", "product-surface-coverage.json");
const PUBLIC_COVERAGE_PATH = path.join(APP_ROOT, "public", "data", "admin", "product-surface-coverage.json");

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

function comparableCoverage(payload) {
  return JSON.stringify({
    schema_version: payload?.schema_version,
    generated_at: payload?.generated_at,
    totals: payload?.totals,
    surfaces: payload?.surfaces,
  });
}

function validateCoverage(payload, errors) {
  assert(payload?.schema_version === "product-surface-coverage/v1", "schema_version must be product-surface-coverage/v1", errors);
  assert(typeof payload?.generated_at === "string" && payload.generated_at.length >= 10, "generated_at is required", errors);
  assert(Array.isArray(payload?.surfaces) && payload.surfaces.length > 0, "surfaces are required", errors);
  assert(Number(payload?.totals?.stale || 0) === 0, "totals.stale must be zero for deploy", errors);
  assert(Number(payload?.totals?.unavailable || 0) === 0, "totals.unavailable must be zero for deploy", errors);
  assert(Number(payload?.totals?.error || 0) === 0, "totals.error must be zero for deploy", errors);

  for (const surface of payload?.surfaces || []) {
    const id = surface?.id || "(unknown)";
    assert(typeof surface?.as_of === "string" && surface.as_of.length >= 10, `${id}: surface as_of is required`, errors);
    assert(surface?.status !== "stale", `${id}: surface status is stale`, errors);
    assert(surface?.status !== "unavailable", `${id}: surface status is unavailable`, errors);
    assert(surface?.status !== "error", `${id}: surface status is error`, errors);

    const freshnessChecks = (surface?.checks || []).filter((check) => Object.prototype.hasOwnProperty.call(check || {}, "max_age_days"));
    assert(freshnessChecks.length > 0, `${id}: at least one freshness check is required`, errors);

    for (const check of freshnessChecks) {
      const label = check?.label || "(freshness check)";
      assert(typeof check?.as_of === "string" && check.as_of.length >= 10, `${id}/${label}: as_of is required`, errors);
      assert(typeof check?.age_days === "number", `${id}/${label}: age_days is required`, errors);
      assert(typeof check?.max_age_days === "number", `${id}/${label}: max_age_days is required`, errors);
      assert(check?.status !== "stale", `${id}/${label}: status is stale`, errors);
      assert(check?.status !== "unavailable", `${id}/${label}: status is unavailable`, errors);
      assert(check?.status !== "error", `${id}/${label}: status is error`, errors);
      if (typeof check?.age_days === "number" && typeof check?.max_age_days === "number") {
        assert(check.age_days <= check.max_age_days, `${id}/${label}: age_days ${check.age_days} exceeds max_age_days ${check.max_age_days}`, errors);
      }
    }
  }
}

const rootCoverage = readJson(ROOT_COVERAGE_PATH);
const publicCoverage = readJson(PUBLIC_COVERAGE_PATH);
const errors = [];

validateCoverage(rootCoverage, errors);
assert(
  comparableCoverage(rootCoverage) === comparableCoverage(publicCoverage),
  "public product-surface coverage mirror must match root coverage",
  errors,
);

if (errors.length) {
  console.error("data freshness check failed");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  generated_at: rootCoverage.generated_at,
  surfaces: rootCoverage.surfaces.length,
  statuses: rootCoverage.surfaces.reduce((acc, surface) => {
    acc[surface.status] = (acc[surface.status] || 0) + 1;
    return acc;
  }, {}),
}, null, 2));
