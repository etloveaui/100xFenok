#!/usr/bin/env node
/**
 * test-cloud-data-plane-account-usage.mjs — contract tests for the authenticated
 * account-usage baseline that feeds scripts/check-cloud-data-plane-budget.mjs.
 *
 * The budget checker completes a metric only when the account baseline AND the
 * request demand both carry the field, so a baseline alone can never turn its
 * verdict green. Test 1 pins that discovery: it is the reason this module exists
 * as an admission-gate input rather than a usage dashboard.
 *
 * No network. The collector's pure layer takes already-fetched analytics rows,
 * so normalisation and fail-closed behaviour are testable offline; the CLI owns
 * the fetch.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  ACCOUNT_BASELINE_SCHEMA,
  buildAccountBaseline,
  normalizeD1,
  normalizeKv,
  normalizeR2,
} from "./lib/cloud-data-plane-account-usage.mjs";
import { buildCloudDataPlaneReport } from "./lib/cloud-data-plane-budget.mjs";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Observed 2026-08-14 from the Cloudflare GraphQL analytics API. Kept as the
// fixture so the arithmetic is checked against a real shape, not an invented one.
const R2_STORAGE = { objectCount: 1554, payloadSize: 149_915_970 };
const R2_OPERATIONS = [
  { actionType: "GetObject", requests: 30_200 },
  { actionType: "ListObjects", requests: 840 },
  { actionType: "PutObject", requests: 1_380 },
  { actionType: "ListBuckets", requests: 460 },
  { actionType: "HeadBucket", requests: 460 },
];
const D1_SUMS = { readQueries: 696, writeQueries: 21, rowsRead: 4_393, rowsWritten: 43 };
const KV_OPERATIONS = [
  { actionType: "read", requests: 730 },
  { actionType: "write", requests: 30 },
  { actionType: "list", requests: 20 },
];

const WINDOW = { elapsedDays: 14, monthDays: 30 };

// The ledger does not exist yet, so every declared table starts at zero rows.
// The key must still be present: the checker treats an absent baseline row count
// as unmeasured, not as none.
function verifiedBaseline({ perTableRows = {} } = {}) {
  return buildAccountBaseline({
    verifiedOn: "2026-08-14",
    scope: "cloudflare-account-test",
    r2: normalizeR2({ storage: R2_STORAGE, operations: R2_OPERATIONS, window: WINDOW }),
    d1: normalizeD1({ sums: D1_SUMS, databaseBytes: 339_968, accountBytes: 339_968, perTableRows, window: WINDOW }),
    kv: normalizeKv({ operations: KV_OPERATIONS, storedBytes: 0, pointers: 0, window: WINDOW }),
  });
}

// --- Test 1: a verified baseline with no demand cannot complete the checker ---
{
  const baseline = verifiedBaseline();
  assert.equal(baseline.status, "verified");
  const report = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, accountBaseline: baseline });
  const metrics = [
    ...Object.values(report.budget.r2.metrics),
    ...Object.values(report.budget.d1.metrics),
    ...Object.values(report.budget.kv.metrics),
  ];
  assert.equal(metrics.length, 13);
  // Storage completes from the repo inventory plus the baseline's unrelated
  // figures, so it is the one metric a baseline can finish alone. Every metric
  // that measures added load needs the demand profile, which is what makes this
  // an admission gate for a candidate migration rather than a usage dashboard.
  const operationMetrics = metrics.filter((entry) => entry !== report.budget.r2.metrics.decimal_gb_month);
  assert.equal(
    operationMetrics.every((entry) => entry.complete === false),
    true,
    "without a demand profile every added-load metric must stay incomplete",
  );
  assert.notEqual(report.budget.verdict, "pass");
}

// --- Test 2: period normalisation projects a partial month onto the policy bases ---
{
  const r2 = normalizeR2({ storage: R2_STORAGE, operations: R2_OPERATIONS, window: WINDOW });
  // Class A is put + copy + list + bucket-level listing/head; Class B is object reads.
  assert.equal(r2.class_a.put, Math.ceil((1_380 / 14) * 30));
  assert.equal(r2.class_a.copy, 0);
  assert.equal(r2.class_a.list, Math.ceil(((840 + 460 + 460) / 14) * 30));
  assert.equal(r2.class_b_operations_per_month, Math.ceil((30_200 / 14) * 30));
  assert.equal(r2.unrelated_objects, 1_554);
  assert.equal(r2.unrelated_storage_byte_days, 149_915_970 * 30);

  const d1 = normalizeD1({ sums: D1_SUMS, databaseBytes: 339_968, accountBytes: 339_968, window: WINDOW });
  assert.equal(d1.rows_read_per_day, Math.ceil(4_393 / 14));
  assert.equal(d1.rows_written_per_day, Math.ceil(43 / 14));
  assert.equal(d1.database_bytes, 339_968);
  assert.deepEqual(d1.per_table_rows, {});

  const kv = normalizeKv({ operations: KV_OPERATIONS, storedBytes: 0, pointers: 0, window: WINDOW });
  // Cloudflare meters KV list operations against their own daily limit, but this
  // project's policy carries only reads and writes. List is folded into reads,
  // which over-counts against a limit it does not belong to — the safe direction
  // for an admission check, and stated here rather than hidden in the summation.
  assert.equal(kv.reads_per_day, Math.ceil((730 + 20) / 14));
  assert.equal(kv.writes_per_day, Math.ceil(30 / 14));

  // A full month must not be inflated.
  const full = normalizeR2({ storage: R2_STORAGE, operations: R2_OPERATIONS, window: { elapsedDays: 30, monthDays: 30 } });
  assert.equal(full.class_a.put, 1_380);
}

// --- Test 3: fail closed rather than reporting a low number ---
{
  assert.throws(
    () => normalizeR2({ storage: R2_STORAGE, operations: R2_OPERATIONS, window: { elapsedDays: 0, monthDays: 30 } }),
    /elapsed/i,
    "a zero-length window must fail rather than divide into a misleading figure",
  );
  assert.throws(
    () => normalizeR2({ storage: null, operations: R2_OPERATIONS, window: WINDOW }),
    /storage/i,
    "a missing storage sample must fail rather than default to zero bytes",
  );
  assert.throws(
    () => normalizeD1({ sums: { readQueries: 1 }, databaseBytes: 0, accountBytes: 0, window: WINDOW }),
    /rowsRead|rowsWritten/i,
    "a partial D1 response must fail rather than treat absent rows as none",
  );
  assert.throws(
    () => buildAccountBaseline({ verifiedOn: "2026-08-14", scope: "s", r2: null, d1: {}, kv: {} }),
    /r2/i,
    "an absent service branch must fail rather than emit a verified envelope",
  );
  const unauthorized = buildAccountBaseline({
    verifiedOn: "2026-08-14",
    scope: "cloudflare-account-test",
    r2: normalizeR2({ storage: R2_STORAGE, operations: R2_OPERATIONS, window: WINDOW }),
    d1: normalizeD1({ sums: D1_SUMS, databaseBytes: 0, accountBytes: 0, window: WINDOW }),
    kv: normalizeKv({ operations: KV_OPERATIONS, storedBytes: 0, pointers: 0, window: WINDOW }),
    errors: [{ message: "Authentication error" }],
  });
  assert.notEqual(unauthorized.status, "verified", "an API error must never produce a verified envelope");
  assert.equal(unauthorized.schema_version, ACCOUNT_BASELINE_SCHEMA);
}

// --- Test 4: baseline plus demand reaches a measured verdict; malformed input does not ---
{
  const demand = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "scripts/fixtures/cloud-data-plane/etf-migration-demand.json"), "utf8"),
  );
  const baseline = verifiedBaseline({
    perTableRows: Object.fromEntries(demand.d1.tables.map((table) => [table.id, 0])),
  });
  const report = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, accountBaseline: baseline, requestDemand: demand });
  const metrics = [
    ...Object.values(report.budget.r2.metrics),
    ...Object.values(report.budget.d1.metrics),
    ...Object.values(report.budget.kv.metrics),
  ];
  assert.equal(
    metrics.every((entry) => entry.complete === true),
    true,
    "baseline plus demand must complete every metric",
  );
  assert.ok(["pass", "fail"].includes(report.budget.verdict), "the verdict must be measured, not not_verified");

  const brokenDemand = { ...demand, status: "draft" };
  const brokenReport = buildCloudDataPlaneReport({
    repoRoot: REPO_ROOT,
    accountBaseline: baseline,
    requestDemand: brokenDemand,
  });
  // Storage is excluded for the same reason as in the first case: it does not
  // depend on the demand profile at all. What must not survive a malformed
  // demand is every metric that measures added load.
  assert.equal(
    Object.entries(brokenReport.budget.r2.metrics)
      .filter(([key]) => key !== "decimal_gb_month")
      .every(([, entry]) => entry.complete === false),
    true,
    "an unverified demand must not be accepted for any added-load metric",
  );
}

// --- Test 5: the emitted envelope satisfies the checker's inputVerified contract ---
{
  const baseline = verifiedBaseline();
  for (const key of ["status", "schema_version", "verified_on", "scope", "period"]) {
    assert.equal(typeof baseline[key], "string", `${key} must be a string`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-account-usage-"));
  try {
    const file = path.join(dir, "baseline.json");
    fs.writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
    const roundTripped = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(roundTripped, baseline, "the envelope must survive a JSON round trip unchanged");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log("test-cloud-data-plane-account-usage: ok");
