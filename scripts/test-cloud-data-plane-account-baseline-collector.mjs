import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ACCOUNT_QUERY,
  buildQueryVariables,
  elapsedDaysBetween,
  extractAccountRows,
  fetchAccountRows,
} from "./lib/cloud-data-plane-account-query.mjs";
import { collectBaseline, parseArgs } from "./collect-cloud-data-plane-account-baseline.mjs";
import { buildCloudDataPlaneReport } from "./lib/cloud-data-plane-budget.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACCOUNT = "aeeb5ea3affe55a2219d08ea02dad9e1";
const TOKEN = "test-token-must-never-be-echoed";

// Shaped after the 2026-08-14 observation so the offline path exercises a real
// response shape rather than an invented one. No live call is made here.
function okResponse(overrides = {}) {
  return {
    data: {
      viewer: {
        accounts: [{
          r2StorageAdaptiveGroups: [{ max: { objectCount: 1554, payloadSize: 149_915_970 } }],
          r2OperationsAdaptiveGroups: [
            { dimensions: { actionType: "GetObject" }, sum: { requests: 30_200 } },
            { dimensions: { actionType: "ListObjects" }, sum: { requests: 840 } },
            { dimensions: { actionType: "PutObject" }, sum: { requests: 1_380 } },
            { dimensions: { actionType: "ListBuckets" }, sum: { requests: 460 } },
            { dimensions: { actionType: "HeadBucket" }, sum: { requests: 460 } },
          ],
          d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 696, writeQueries: 21, rowsRead: 4_393, rowsWritten: 43 } }],
          kvOperationsAdaptiveGroups: [
            { dimensions: { actionType: "read" }, sum: { requests: 730 } },
            { dimensions: { actionType: "write" }, sum: { requests: 30 } },
            { dimensions: { actionType: "list" }, sum: { requests: 20 } },
          ],
          ...overrides,
        }],
      },
    },
  };
}

function transportFor(body, seen = null) {
  return async (call) => {
    if (seen) seen.push(call);
    return typeof body === "function" ? body(call) : body;
  };
}

async function assertRejects(run, fragment) {
  await assert.rejects(run, (error) => {
    assert.match(error.message, new RegExp(fragment));
    // No refusal may leak the credential.
    assert.equal(error.message.includes(TOKEN), false, "an error message must never contain the token");
    return true;
  });
}

function baseOptions(overrides = {}) {
  return {
    accountTag: ACCOUNT,
    since: "2026-08-01",
    until: "2026-08-14",
    monthDays: 30,
    scope: null,
    tables: ["publication_generations"],
    out: path.join(os.tmpdir(), "unused-baseline.json"),
    ...overrides,
  };
}

// --- the document is read-only by inspection, not by intention ---
{
  assert.match(ACCOUNT_QUERY, /^query /, "the document must be a query, never a mutation");
  assert.equal(/\bmutation\b/i.test(ACCOUNT_QUERY), false);
  for (const forbidden of ["create", "delete", "update", "put ", "write("]) {
    assert.equal(ACCOUNT_QUERY.toLowerCase().includes(forbidden), false, `query must not contain ${forbidden}`);
  }
  // Only analytics aggregation sets are requested.
  for (const dataset of ["r2StorageAdaptiveGroups", "r2OperationsAdaptiveGroups", "d1AnalyticsAdaptiveGroups", "kvOperationsAdaptiveGroups"]) {
    assert.ok(ACCOUNT_QUERY.includes(dataset));
  }
}

// --- the account is explicit, and the window is inclusive ---
{
  assert.throws(() => buildQueryVariables({ since: "2026-08-01", until: "2026-08-14" }), /accountTag is required/);
  assert.throws(() => buildQueryVariables({ accountTag: ACCOUNT, since: "08-01-2026", until: "2026-08-14" }), /ISO date/);
  assert.throws(() => buildQueryVariables({ accountTag: ACCOUNT, since: "2026-08-14", until: "2026-08-01" }), /must not be after/);
  const variables = buildQueryVariables({ accountTag: ACCOUNT, since: "2026-08-01", until: "2026-08-14" });
  assert.equal(variables.accountTag, ACCOUNT);
  assert.equal(variables.datetimeSince, "2026-08-01T00:00:00Z");
  assert.equal(elapsedDaysBetween("2026-08-01", "2026-08-14"), 14);
  assert.equal(elapsedDaysBetween("2026-08-14", "2026-08-14"), 1);
}

// --- nothing performs network by itself ---
{
  await assertRejects(() => fetchAccountRows({ accountTag: ACCOUNT, since: "2026-08-01", until: "2026-08-14", token: TOKEN }), "transport function is required");
  await assertRejects(() => fetchAccountRows({ transport: transportFor(okResponse()), accountTag: ACCOUNT, since: "2026-08-01", until: "2026-08-14" }), "API token is required");
  await assertRejects(() => collectBaseline(baseOptions(), { transport: transportFor(okResponse()) }), "is not set");
}

// --- every partial or unauthorised response refuses instead of reading as zero ---
{
  const cases = [
    [{ errors: [{ message: "unauthorized dataset" }], data: { viewer: { accounts: [] } } }, "returned errors"],
    [{ success: false, data: { viewer: { accounts: [] } } }, "success=false"],
    [{ data: { viewer: { accounts: [] } } }, "not be authorised"],
    [{ data: { viewer: { accounts: [{}, {}] } } }, "more than one account"],
    [{ data: { viewer: {} } }, "no viewer.accounts"],
    [okResponse({ r2OperationsAdaptiveGroups: undefined }), "r2OperationsAdaptiveGroups is missing"],
    [okResponse({ r2StorageAdaptiveGroups: [] }), "empty window is not zero usage"],
    [okResponse({ r2StorageAdaptiveGroups: [{ max: { objectCount: 1 } }] }), "missing objectCount or payloadSize"],
    [okResponse({ d1AnalyticsAdaptiveGroups: [{ sum: { readQueries: 1 } }] }), "non-negative writeQueries"],
    [okResponse({ kvOperationsAdaptiveGroups: [{ dimensions: {}, sum: { requests: 1 } }] }), "missing actionType"],
  ];
  for (const [body, fragment] of cases) {
    assert.throws(() => extractAccountRows(body, { accountTag: ACCOUNT }), new RegExp(fragment), `expected refusal: ${fragment}`);
  }
}

// --- argument handling fails closed ---
{
  assert.throws(() => parseArgs(["--since", "2026-08-01", "--until", "2026-08-14", "--out", "x"]), /--account-tag is required/);
  assert.throws(() => parseArgs(["--account-tag", ACCOUNT, "--out", "x"]), /window is never guessed/);
  assert.throws(() => parseArgs(["--account-tag", ACCOUNT, "--since", "2026-08-01", "--until", "2026-08-14"]), /--out is required/);
  assert.throws(() => parseArgs(["--account-tag"]), /--account-tag requires a value/);
  assert.throws(() => parseArgs(["--bucket", "x"]), /unknown argument/);
  const parsed = parseArgs(["--account-tag", ACCOUNT, "--since", "2026-08-01", "--until", "2026-08-14", "--out", "out.json", "--table", "a", "--table", "b"]);
  assert.deepEqual(parsed.tables, ["a", "b"]);
  assert.equal(parsed.monthDays, 30);
}

// --- happy path: verified baseline, token handed to exactly one place ---
{
  const seen = [];
  const baseline = await collectBaseline(baseOptions(), { transport: transportFor(okResponse(), seen), token: TOKEN });
  assert.equal(seen.length, 1, "exactly one request per collection");
  assert.equal(seen[0].token, TOKEN);
  assert.equal(seen[0].variables.accountTag, ACCOUNT);
  assert.equal(baseline.status, "verified");
  assert.deepEqual(baseline.measured_window, { since: "2026-08-01", until: "2026-08-14", elapsed_days: 14, month_days: 30 });

  const serialized = JSON.stringify(baseline);
  assert.equal(serialized.includes(TOKEN), false, "the baseline must never carry the credential");

  // The declared ledger table is present at zero rows rather than absent, because
  // absent reads as unmeasured and would keep the gate closed for the wrong reason.
  assert.ok(JSON.stringify(baseline.d1).includes("publication_generations"));
}

// --- the collected baseline is what closes the scoped candidate gate ---
{
  const baseline = await collectBaseline(baseOptions(), { transport: transportFor(okResponse()), token: TOKEN });
  const demand = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "scripts", "fixtures", "cloud-data-plane", "etf-migration-demand.json"), "utf8"));

  const scoped = buildCloudDataPlaneReport({
    repoRoot: REPO_ROOT,
    candidateId: "stockanalysis_etf_detail",
    accountBaseline: baseline,
    requestDemand: demand,
  });
  const estate = buildCloudDataPlaneReport({ repoRoot: REPO_ROOT, accountBaseline: baseline, requestDemand: demand });

  // Three slots stay three in both, and the scoped run stays labelled.
  assert.deepEqual(scoped.budget.assumptions.r2_slots, ["current", "previous", "in_progress"]);
  assert.equal(scoped.inventory_scope.kind, "candidate");

  // The whole point of scoping: the estate figure fails the planning line and the
  // candidate figure does not, without touching the slot model.
  assert.equal(estate.budget.r2.planning_line.verdict, "fail");
  assert.notEqual(scoped.budget.r2.planning_line.verdict, "fail");
  assert.equal(scoped.budget.r2.metrics.decimal_gb_month.complete, true);
  assert.ok(scoped.budget.r2.metrics.decimal_gb_month.lower_bound < estate.budget.r2.metrics.decimal_gb_month.lower_bound);
}

process.stdout.write("test-cloud-data-plane-account-baseline-collector: ok\n");
